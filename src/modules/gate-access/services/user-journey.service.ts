import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  UserJourneyEventDto,
  UserJourneyResponseDto,
} from '../dto/user-journey-response.dto.js';

interface GateRow {
  access_time: Date | string;
  direction: string | null;
  plate_number: string | null;
  zone_name: string | null;
  /** FK trực tiếp → iot_device_events.id (có thể NULL nếu caller ghi log không truyền). */
  source_event_id: string | null;
}

interface MeetingRow {
  id: string;
  event_time: Date | string;
  direction: string | null;
  /** roomId đã resolve (e.room_id ⊕ payload.roomId) — khoá gộp phiên. Query đã lọc NOT NULL. */
  room_key: string;
  room_name: string | null;
  meeting_id: string | null;
}

interface ConfigRow {
  config_value: string | null;
}

interface ZoneRow {
  event_time: Date | string;
  event_type: string | null;
  zone_name: string | null;
  /**
   * [FIX 2026-08-18] FK → iot_device_events.id, đọc từ metadata_json.sourceEventId (ghi bởi
   * onFaceEvent() khi gọi writeAppearEvent() — xem ivss-presence-ingestion.service.ts).
   * KHÔNG phải cột riêng của zone_presence_events (bảng này không có snapshot_file_id) —
   * event gốc (kèm ảnh, nếu bridge có gửi) nằm ở iot_device_events, zone chỉ giữ tham chiếu
   * qua metadata. Có thể NULL (dữ liệu cũ trước khi field này được ghi, hoặc appear event
   * hiếm khi thiếu — xử lý null-safe y hệt gate/meeting).
   */
  source_event_id: string | null;
}

interface UserRow {
  full_name: string | null;
}

const FACE_EVENT_TYPE = 'ivss_face_event';

/** Khoảng ngày tối đa cho {@link UserJourneyService.getUserJourneyRange}. */
const MAX_RANGE_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * V3 — ngưỡng tách phiên RIÊNG của journey. KHÔNG dùng chung với luồng hiện diện họp.
 *
 * V2 từng tái dùng `ivss.presence.gap_threshold_seconds`. Test production cho thấy SAI:
 * key đó = 120s, phục vụ báo cáo HỌP (cần mịn, đo chính xác vào/ra một cuộc họp). Áp vào
 * timeline NGÀY thì một lần có mặt A102 17:39→17:50 — camera thấy mặt cách quãng 2–6 phút
 * vì người ngẩng lên/quay đi — bị xé thành 4 phiên rời.
 *
 * Hai mục đích khác nhau ⇒ hai ngưỡng khác nhau:
 *   ivss (họp):    120s — mịn.
 *   journey (ngày): 600s — thô. Vắng mặt camera 5–10 phút vẫn là "đang ở đó";
 *                   chỉ >10 phút mới coi là đã rời.
 *
 * ⚠ Đổi số ở đây KHÔNG ảnh hưởng ivss và ngược lại — đó là mục đích của việc tách key.
 */
const JOURNEY_GAP_CONFIG_KEY = 'campus.journey.gap_threshold_seconds';
const DEFAULT_GAP_SECONDS = 600;

/** "45 giây" / "9 phút" / "1 giờ 5 phút" — bản tiếng Việt cho `detail`.
 *
 * KHÔNG tái dùng `durationHuman()` của ivss-presence-report.service.ts: hàm đó `private`
 * và format kiểu "9m 00s" (dành cho bảng PDF), không phải câu người đọc. Không sửa file kia.
 */
const durationHuman = (ms: number): string => {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  if (totalSec < 60) return `${totalSec} giây`;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h === 0) return `${m} phút`;
  return m === 0 ? `${h} giờ` : `${h} giờ ${m} phút`;
};
/**
 * Múi giờ nghiệp vụ. Trùng giá trị với hằng cùng tên trong
 * ivss-room-access-log.service.ts — bản đó là `const` private không export được,
 * nên khai lại tại đây thay vì sửa file module khác. Đổi thì phải đổi CẢ HAI.
 */
const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';

/**
 * Biên ngày [00:00, 24:00) GIỜ VIỆT NAM cho cột `<col>`.
 *
 * ⚠ `::timestamp` BẮT BUỘC. Thiếu nó, Postgres ép `date` → `timestamptz` trước, khiến
 * `AT TIME ZONE` chạy CHIỀU NGƯỢC và trả `timestamp without time zone` ⇒ biên lệch +7h
 * SAI HƯỚNG (đã đo bằng psql khi làm ivss-room-access-log). RDS chạy UTC nên bắt buộc ép.
 */
const vnDayBounds = (col: string) => `
          AND ${col} >= ($2::date::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}')
          AND ${col} <  (($2::date + interval '1 day')::timestamp AT TIME ZONE '${BUSINESS_TIMEZONE}')`;

/**
 * UserJourneyService (UJN-001) — hành trình khuôn viên của 1 người trong 1 ngày.
 *
 * Ghép 3 KIỂU nguồn (KHÔNG phải 3 camera):
 *   1. `gate_access_logs`        — xe qua cổng (chỉ log CÓ user_id: hành trình theo NGƯỜI)
 *   2. `iot_device_events`       — có mặt phòng họp qua face (ivss_face_event), GỘP PHIÊN
 *   3. `zone_presence_events`    — hiện diện khu vực, GOM MỌI ZONE của user
 *
 * V2 — nguồn 2 KHÔNG liệt kê raw event nữa: 14 event thô (5 enter + 1 leave + 8 seen) của
 * một người ở A102 trong 17:39–17:50 từng đẻ ra 14 dòng, trong đó 8 dòng "không rõ phòng"
 * là rác. Nay lọc event thiếu roomId rồi gộp theo (phòng + khoảng cách thời gian)
 * ⇒ 1 dòng "Có mặt A102 (11 phút)". Nguồn 1 và 3 GIỮ NGUYÊN từng lượt — xem
 * {@link UserJourneyService.groupFaceSessions} để biết vì sao chỉ face mới gộp.
 *
 * ⭐ Nguồn 3 KHÔNG hard-code zone/cam: lọc theo `user_id`, lấy mọi `zone_id`. Lắp thêm
 * camera zone mới ⇒ chỉ khác `zone_id`, cùng bảng ⇒ endpoint TỰ có, không phải sửa code.
 *
 * 100% READ-ONLY: chỉ SELECT, không đụng webhook/ingest/writeGateLog/writeAppearEvent.
 * SEC-03: bind $1/$2 (tên timezone là hằng nội bộ, không phải input người dùng).
 */
@Injectable()
export class UserJourneyService {
  private readonly logger = new Logger(UserJourneyService.name);

  constructor(private readonly dataSource: DataSource) {}

  /** YYYY-MM-DD hôm nay THEO GIỜ VN — không phụ thuộc timezone tiến trình (EC2 chạy UTC). */
  private todayStr(): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: BUSINESS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }

  private toIso(v: Date | string): string {
    return new Date(v).toISOString();
  }

  /**
   * Ngưỡng tách phiên: `system_configs[campus.journey.gap_threshold_seconds]` — key RIÊNG
   * của journey, xem {@link JOURNEY_GAP_CONFIG_KEY}. TUYỆT ĐỐI không đọc key của ivss.
   *
   * Best-effort — bảng/hàng thiếu hoặc giá trị rác đều rơi về {@link DEFAULT_GAP_SECONDS},
   * KHÔNG làm hỏng cả timeline chỉ vì đọc config lỗi.
   *
   * TODO(nợ): cả hai key ngưỡng (`ivss.presence.*` và `campus.journey.*`) nên được seed
   * bằng migration để không mất khi reset DB — cùng cụm nợ với channel maps.
   */
  private async getGapThresholdSeconds(): Promise<number> {
    try {
      const rows: ConfigRow[] = await this.dataSource.manager.query(
        `SELECT config_value FROM system_configs
          WHERE config_key = $1 AND is_active = true
          LIMIT 1`,
        [JOURNEY_GAP_CONFIG_KEY],
      );
      const raw = rows[0]?.config_value;
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (Number.isInteger(n) && n > 0) return n;
      }
    } catch (e) {
      this.logger.warn(
        `read gap_threshold failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
    return DEFAULT_GAP_SECONDS;
  }

  /**
   * V2 — GỘP PHIÊN CÓ MẶT cho nguồn 2 (face).
   *
   * Vì sao chỉ face mới gộp: camera bắn liên tục khi người ĐỨNG YÊN trong phòng, nên raw
   * event là "người vẫn ở đó" chứ không phải "vừa xảy ra chuyện gì". Gate (vào cổng lúc X)
   * và zone (appear/disappear) là sự kiện RỜI RẠC ⇒ giữ nguyên từng lượt, KHÔNG gộp.
   *
   * Quy tắc tách: đổi phòng, HOẶC khoảng cách tới event trước > `gapSeconds`.
   * Đúng bằng ngưỡng thì vẫn CÙNG phiên (dùng `>`, không `>=`).
   *
   * @param rows đã ORDER BY event_time ASC và đã lọc room_key NOT NULL ở tầng SQL.
   */
  private groupFaceSessions(
    rows: MeetingRow[],
    gapSeconds: number,
  ): UserJourneyEventDto[] {
    const gapMs = gapSeconds * 1000;
    const sessions: Array<{
      roomKey: string;
      roomName: string | null;
      meetingId: string | null;
      /** id của event ĐẦU TIÊN trong phiên — đại diện ảnh (mirror cách occurrences chọn entry, KHÔNG đổi khi gộp thêm event). */
      sourceEventId: string;
      startMs: number;
      endMs: number;
      count: number;
    }> = [];

    for (const r of rows) {
      // Tầng SQL đã lọc, chặn thêm ở đây để không bao giờ gộp nhầm mọi event
      // "không rõ phòng" thành một phiên giả mang khoá null.
      if (!r.room_key) continue;
      const ms = new Date(r.event_time).getTime();
      const cur = sessions[sessions.length - 1];
      if (cur && cur.roomKey === r.room_key && ms - cur.endMs <= gapMs) {
        cur.endMs = ms;
        cur.count += 1;
        // Tên phòng / meeting có thể null ở event đầu (JOIN trượt, payload thiếu) —
        // lấy giá trị non-null ĐẦU TIÊN gặp được trong phiên.
        cur.roomName ??= r.room_name ?? null;
        cur.meetingId ??= r.meeting_id ?? null;
        // sourceEventId KHÔNG đổi — giữ nguyên id của event đầu phiên.
        continue;
      }
      sessions.push({
        roomKey: r.room_key,
        roomName: r.room_name ?? null,
        meetingId: r.meeting_id ?? null,
        sourceEventId: r.id,
        startMs: ms,
        endMs: ms,
        count: 1,
      });
    }

    return sessions.map((s) => {
      const durationMs = s.endMs - s.startMs;
      const room = s.roomName ?? 'phòng không rõ';
      return {
        time: new Date(s.startMs).toISOString(),
        endTime: new Date(s.endMs).toISOString(),
        type: 'meeting' as const,
        // 'session' — KHÔNG phải enter/leave lẻ. FE dựa vào đây để render dạng khoảng.
        direction: 'session',
        detail: `Có mặt ${room} (${durationHuman(durationMs)})`,
        zoneName: null,
        plateNumber: null,
        roomName: s.roomName,
        meetingId: s.meetingId,
        sourceEventId: s.sourceEventId,
        durationMs,
        eventCount: s.count,
      };
    });
  }

  async getUserJourney(
    userId: string,
    date?: string,
  ): Promise<UserJourneyResponseDto> {
    const day = date ?? this.todayStr();
    const params = [userId, day];

    // ── Tên người (1 query, không chặn nếu user đã xoá mềm) ──
    const users: UserRow[] = await this.dataSource.manager.query(
      `SELECT full_name FROM users WHERE id = $1 LIMIT 1`,
      [userId],
    );

    // ── Nguồn 1: xe qua cổng ──
    // sourceEventId = g.event_id (FK trực tiếp → iot_device_events.id, có sẵn ở schema —
    // xem recon 2026-08-09) — FE dùng để hiện ảnh, mirror ThumbnailImage/EventSnapshotModal.
    const gateRows: GateRow[] = await this.dataSource.manager.query(
      `SELECT g.access_time, g.direction, g.plate_number, z.zone_name,
              g.event_id AS source_event_id
         FROM gate_access_logs g
         LEFT JOIN zones z ON z.id = g.zone_id AND z.deleted_at IS NULL
        WHERE g.user_id = $1${vnDayBounds('g.access_time')}
        ORDER BY g.access_time ASC`,
      params,
    );

    // ── Nguồn 2: check-in/out phòng họp qua face ──
    // room_name lấy qua e.room_id, fallback payload_json->>'roomId' (UC5 ghi top-level).
    //
    // V2 — LỌC RÁC: chỉ nhận event ĐÃ RESOLVE được phòng. Camera bắn liên tục
    // `direction='seen'` không kèm roomId ("vào phòng không rõ") — đó là nhiễu, bỏ hẳn.
    // Event CÓ roomId nhưng direction='seen' thì GIỮ: người vẫn đang trong phòng, nó là
    // bằng chứng kéo dài phiên.
    const meetingRows: MeetingRow[] = await this.dataSource.manager.query(
      `SELECT e.id,
              e.event_time,
              e.payload_json->>'direction' AS direction,
              COALESCE(e.room_id, NULLIF(e.payload_json->>'roomId','')::uuid)::text AS room_key,
              r.room_name,
              COALESCE(e.meeting_id::text, e.payload_json->>'meetingId') AS meeting_id
         FROM iot_device_events e
         LEFT JOIN rooms r
                ON r.id = COALESCE(e.room_id, NULLIF(e.payload_json->>'roomId','')::uuid)
               AND r.deleted_at IS NULL
        WHERE e.event_type = $3
          AND e.payload_json->>'userId' = $1
          AND COALESCE(e.room_id, NULLIF(e.payload_json->>'roomId','')::uuid) IS NOT NULL${vnDayBounds('e.event_time')}
        ORDER BY e.event_time ASC`,
      [...params, FACE_EVENT_TYPE],
    );

    // ── Nguồn 3: hiện diện khu vực — MỌI zone của user (không lọc zone cụ thể) ──
    // [FIX 2026-08-18] Thêm metadata_json->>'sourceEventId' — FK sẵn có tới iot_device_events
    // (ghi bởi writeAppearEvent(), xem ZoneRow.source_event_id) để FE hiện ảnh snapshot cho
    // dòng zone, mirror ĐÚNG cách gate/meeting đã làm (source_event_id). KHÔNG đổi gì khác ở
    // đây — KHÔNG đụng writeAppearEvent()/bridge/DeviceEventSnapshotService.
    const zoneRows: ZoneRow[] = await this.dataSource.manager.query(
      `SELECT p.event_time, p.event_type, z.zone_name,
              p.metadata_json->>'sourceEventId' AS source_event_id
         FROM zone_presence_events p
         LEFT JOIN zones z ON z.id = p.zone_id AND z.deleted_at IS NULL
        WHERE p.user_id = $1${vnDayBounds('p.event_time')}
        ORDER BY p.event_time ASC`,
      params,
    );

    const gateEvents: UserJourneyEventDto[] = gateRows.map((r) => {
      const plate = r.plate_number ?? 'không rõ biển';
      const zone = r.zone_name ?? 'cổng không rõ';
      const verb = r.direction === 'leave' ? 'rời' : 'vào';
      return {
        time: this.toIso(r.access_time),
        type: 'gate',
        direction: r.direction ?? null,
        detail: `Xe ${plate} ${verb} ${zone}`,
        zoneName: r.zone_name ?? null,
        plateNumber: r.plate_number ?? null,
        roomName: null,
        meetingId: null,
        sourceEventId: r.source_event_id ?? null,
      };
    });

    const meetingEvents = this.groupFaceSessions(
      meetingRows,
      await this.getGapThresholdSeconds(),
    );

    const zoneEvents: UserJourneyEventDto[] = zoneRows.map((r) => {
      const zone = r.zone_name ?? 'khu vực không rõ';
      const verb = r.event_type === 'disappear' ? 'rời' : 'xuất hiện tại';
      return {
        time: this.toIso(r.event_time),
        type: 'zone',
        direction: r.event_type ?? null,
        detail: `Camera khu vực: ${verb} ${zone}`,
        zoneName: r.zone_name ?? null,
        plateNumber: null,
        roomName: null,
        meetingId: null,
        // [FIX 2026-08-18] Nợ kỹ thuật từ fix 2026-08-09 (commit 6b670f3, chỉ scope
        // gate+meeting) — giờ đọc thật từ metadata_json.sourceEventId (xem ZoneRow),
        // mirror đúng cách gate/meeting đã làm. null-safe: thiếu trong metadata (dữ liệu
        // cũ/edge case) → giữ null, KHÔNG throw, FE tự ẩn thumbnail (ThumbnailImage đã xử
        // lý null từ trước, không cần đổi FE).
        sourceEventId: r.source_event_id ?? null,
      };
    });

    // Gộp 3 nguồn → sort THEO THỜI GIAN TĂNG DẦN (so chuỗi ISO UTC là đủ, cùng định dạng).
    const events = [...gateEvents, ...meetingEvents, ...zoneEvents].sort(
      (a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0),
    );

    return {
      userId,
      fullName: users[0]?.full_name ?? null,
      date: day,
      events,
      gateCount: gateEvents.length,
      // V2: số PHIÊN có mặt, không phải số raw face event (raw đã gộp + lọc rác).
      meetingCount: meetingEvents.length,
      zoneCount: zoneEvents.length,
    };
  }

  /**
   * Hành trình theo KHOẢNG ngày [from, to] (tính cả 2 đầu, giờ VN) — tái dùng nguyên
   * {@link getUserJourney} cho từng ngày rồi ghép, để gộp phiên/biên ngày giữ đúng như bản 1 ngày.
   * Chạy tuần tự từng ngày (tối đa 31) để không chiếm hết connection pool.
   */
  async getUserJourneyRange(
    userId: string,
    from: string,
    to: string,
  ): Promise<UserJourneyResponseDto> {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      throw new BadRequestException('Ngày không hợp lệ');
    }
    if (end < start) {
      throw new BadRequestException(
        'Ngày kết thúc phải sau hoặc bằng ngày bắt đầu',
      );
    }
    const dayCount = Math.round((end - start) / DAY_MS) + 1;
    if (dayCount > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Khoảng ngày tối đa ${MAX_RANGE_DAYS} ngày`,
      );
    }

    const result: UserJourneyResponseDto = {
      userId,
      fullName: null,
      date: from,
      to,
      events: [],
      gateCount: 0,
      meetingCount: 0,
      zoneCount: 0,
    };
    for (let i = 0; i < dayCount; i++) {
      const day = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
      const dayJourney = await this.getUserJourney(userId, day);
      result.fullName ??= dayJourney.fullName;
      result.events.push(...dayJourney.events);
      result.gateCount += dayJourney.gateCount;
      result.meetingCount += dayJourney.meetingCount;
      result.zoneCount += dayJourney.zoneCount;
    }
    return result;
  }
}
