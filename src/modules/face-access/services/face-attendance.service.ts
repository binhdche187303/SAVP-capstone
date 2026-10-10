import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  FaceVerifyHook,
  FaceVerifyInput,
} from '../../../common/ports/face-verify-hook.js';
import {
  VISITOR_FACE_EVENT_HOOK,
  type VisitorFaceEventHook,
} from '../../../common/ports/visitor-face-event-hook.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { PersonWatchlistCheckService } from '../../alerts/services/person-watchlist-check.service.js';
import { getAttendanceLateGraceMinutes } from '../../attendance/utils/get-late-grace-minutes.util.js';

interface MappingRow {
  user_id: string;
  metadata_json: Record<string, unknown> | null;
}
interface MeetingRow {
  id: string;
  start_time: Date | string;
  end_time: Date | string;
  actual_end_time: Date | string | null;
  status: string;
}

/**
 * FaceAttendanceService (FAT-001 / Ticket C) — verify event → điểm danh.
 *
 * NC-1: CHỈ ghi điểm danh, KHÔNG gác/deny cửa.
 * NC-5: resolve user + meeting từ device_user_mappings (B), không tìm meeting active riêng.
 * NC-3: verify đầu = check-in; verify sau chỉ cập nhật last_detected_at.
 * Anomaly (no-mapping/no-meeting) chỉ log — raw event đã ở iot_device_events (spec §2.3).
 * SEC-03 parameterized, raw qua DataSource, DATA-01 no migration.
 */
@Injectable()
export class FaceAttendanceService implements FaceVerifyHook {
  private readonly logger = new Logger(FaceAttendanceService.name);
  // Cho phép quét trễ sau giờ kết thúc bao nhiêu phút vẫn ghi (mặc định 0 = chặn ngay khi quá end).
  private static readonly POST_GRACE_MINUTES = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly websocketService: WebsocketService,
    private readonly personWatchlistCheckService: PersonWatchlistCheckService,
    // VIS-BE-001: phân hệ Khách (tùy chọn). Mapping nguồn 'visitor' đi sang đây, không điểm danh họp.
    @Optional() @Inject(VISITOR_FACE_EVENT_HOOK) private readonly visitorHook?: VisitorFaceEventHook,
  ) {}

  async onVerify(input: FaceVerifyInput): Promise<void> {
    const { deviceId, roomId, personId, personName, verifyTime, direction } =
      input;

    // NC-5: resolve (user, meeting) từ mapping.
    const resolved = await this.resolveMapping(deviceId, personId, personName);
    if (!resolved) {
      this.logger.warn(
        `verify unmatched: device=${deviceId} person_id=${personId ?? '∅'} person_name=${personName ?? '∅'} — no record.`,
      );
      return;
    }
    const { userId, meetingId, visitId } = resolved;

    // PWL-001: đối chiếu danh sách đối tượng theo dõi — MỌI lần nhận diện ra user,
    // kể cả khi mapping không gắn cuộc họp. NotThrow bên trong → không phá điểm danh.
    // KHÔNG await: callback trả lời thiết bị ngay, cảnh báo chạy nền (<1s).
    void this.personWatchlistCheckService.checkPersonWatchlist(userId, {
      deviceId,
      roomId,
    });

    // VIS-BE-001: khách đến làm việc — FaceGate đã tự kiểm khung giờ/khu vực; chỉ ghi nhận vào/ra.
    if (visitId) {
      if (!this.visitorHook) return;
      try {
        await this.visitorHook.onFaceGateVerify({
          visitId,
          deviceId,
          zoneId: await this.zoneOf(deviceId),
          direction: direction === 'out' ? 'out' : 'in',
          verifyTime,
        });
      } catch (e) {
        this.logger.warn(`visitor hook lỗi (device=${deviceId}): ${this.msgOf(e)}`);
      }
      return;
    }

    if (!meetingId) {
      this.logger.warn(
        `verify no-booking: user=${userId} device=${deviceId} — mapping không có bookingId, no record.`,
      );
      return;
    }

    // Load meeting. Không thấy → anomaly.
    const meetings: MeetingRow[] = await this.dataSource.manager.query(
      `SELECT id, start_time, end_time, actual_end_time, status
         FROM meetings WHERE id = $1 LIMIT 1`,
      [meetingId],
    );
    const meeting = meetings?.[0];
    if (!meeting) {
      this.logger.warn(
        `verify no-meeting: meetingId=${meetingId} (user=${userId}) không tồn tại — no record.`,
      );
      return;
    }

    // DCO-001: chiều RA → check-out (nhánh riêng). Chiều VÀO giữ NGUYÊN logic FAT-001.
    if (direction === 'out') {
      await this.checkOut(meeting, userId, verifyTime, deviceId, roomId);
      return;
    }

    // Gate "họp còn mở": đã completed/cancelled HOẶC verify sau giờ kết thúc → KHÔNG ghi.
    const effectiveEnd = new Date(meeting.actual_end_time ?? meeting.end_time);
    const postGraceMs = FaceAttendanceService.POST_GRACE_MINUTES * 60_000;
    const meetingClosed =
      meeting.status === 'completed' ||
      meeting.status === 'cancelled' ||
      verifyTime.getTime() > effectiveEnd.getTime() + postGraceMs;
    if (meetingClosed) {
      this.logger.warn(
        `verify after meeting closed: meeting=${meetingId} status=${meeting.status} verifyTime=${verifyTime.toISOString()} end=${effectiveEnd.toISOString()} — no record.`,
      );
      return;
    }

    // NC-2: late theo grace.
    const grace = await getAttendanceLateGraceMinutes(
      this.dataSource.manager,
      this.configService,
    );
    const start = new Date(meeting.start_time);
    const isLate = verifyTime.getTime() > start.getTime() + grace * 60_000;
    const lateMinutes = isLate
      ? Math.max(
          0,
          Math.round((verifyTime.getTime() - start.getTime()) / 60_000),
        )
      : 0;

    // Upsert record (NC-3).
    const existing: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT id FROM attendance_records WHERE meeting_id = $1 AND user_id = $2 LIMIT 1`,
      [meetingId, userId],
    );

    let recordId: string;
    let eventType: string;
    if (existing[0]) {
      recordId = existing[0].id;
      eventType = 'face_detected';
      await this.dataSource.manager.query(
        `UPDATE attendance_records SET last_detected_at = $2, updated_at = now() WHERE id = $1`,
        [recordId, verifyTime],
      );
    } else {
      const status = isLate ? 'late' : 'present';
      const inserted: Array<{ id: string }> =
        await this.dataSource.manager.query(
          `INSERT INTO attendance_records
             (meeting_id, user_id, check_in_method, attendance_source,
              check_in_time, first_detected_at, last_detected_at,
              is_present, is_late, late_minutes, attendance_status)
           VALUES ($1,$2,'door_camera','camera',$3,$3,$3,true,$4,$5,$6)
           RETURNING id`,
          [meetingId, userId, verifyTime, isLate, lateMinutes, status],
        );
      recordId = inserted[0].id;
      eventType = 'check_in';
    }

    // FR-006: ghi event mỗi verify.
    await this.dataSource.manager.query(
      `INSERT INTO attendance_events
         (meeting_id, attendance_record_id, user_id, room_id, device_id,
          event_type, event_time, source_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'camera')`,
      [meetingId, recordId, userId, roomId, deviceId, eventType, verifyTime],
    );

    this.logger.log(
      `attendance ${eventType}: user=${userId} meeting=${meetingId} late=${isLate} (+${lateMinutes}m).`,
    );

    // [FIX 2026-08-16] Emit WS ngay sau khi ghi attendance_records THÀNH CÔNG (KHÔNG
    // đụng logic tính is_late/ghi record ở trên) — chỉ cho lần điểm danh MỚI (INSERT,
    // eventType='check_in'), KHÔNG emit cho nhánh face_detected (chỉ cập nhật
    // last_detected_at của record đã có, không phải điểm danh mới). Room/pattern mirror
    // đúng `meeting:${meetingId}` đã dùng ở live-meeting.service.ts/no-show-lifecycle.service.ts
    // — best-effort, try/catch riêng, KHÔNG throw làm hỏng luồng điểm danh chính.
    if (eventType === 'check_in') {
      try {
        this.websocketService.emitToRoom(
          `meeting:${meetingId}`,
          'meeting.attendance.updated',
          {
            meetingId,
            userId,
            attendanceStatus: isLate ? 'late' : 'present',
            checkInTime: verifyTime.toISOString(),
          },
        );
      } catch (e) {
        this.logger.warn(
          `WS emit meeting.attendance.updated failed: ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    }
  }

  /**
   * DCO-001: ghi check-out khi quét RA. Yêu cầu đã check-in; idempotent (giữ lần ra
   * MUỘN nhất); `left_early` nếu ra trước giờ kết thúc. Event `check_out` (source_type
   * 'camera', khớp check_in) CHỈ ghi khi `check_out_time` thực sự đổi.
   *
   * Gate: `cancelled` → skip; quá `effectiveEnd + grace` → skip. `grace =
   * FACE_SYNC_GRACE_MINUTES` — CÙNG nguồn `deprovisionEndedMeetings`/`reconcile` để cửa
   * sổ OUT khớp đúng lúc mapping bị gỡ (xem spec §8.1).
   */
  private async checkOut(
    meeting: MeetingRow,
    userId: string,
    verifyTime: Date,
    deviceId: string,
    roomId: string | null,
  ): Promise<void> {
    if (meeting.status === 'cancelled') {
      this.logger.warn(
        `check-out skip (cancelled): meeting=${meeting.id} user=${userId}.`,
      );
      return;
    }

    const effectiveEnd = new Date(meeting.actual_end_time ?? meeting.end_time);
    const grace = this.configService.get<number>('FACE_SYNC_GRACE_MINUTES', 5);
    if (verifyTime.getTime() > effectiveEnd.getTime() + grace * 60_000) {
      this.logger.warn(
        `check-out skip (quá grace sau end): meeting=${meeting.id} user=${userId} verifyTime=${verifyTime.toISOString()} end=${effectiveEnd.toISOString()}.`,
      );
      return;
    }

    // Yêu cầu đã check-in.
    const rows: Array<{
      id: string;
      check_in_time: Date | string | null;
      check_out_time: Date | string | null;
    }> = await this.dataSource.manager.query(
      `SELECT id, check_in_time, check_out_time
         FROM attendance_records WHERE meeting_id = $1 AND user_id = $2 LIMIT 1`,
      [meeting.id, userId],
    );
    const rec = rows[0];
    if (!rec || rec.check_in_time == null) {
      this.logger.warn(
        `check-out skip (chưa từng check-in): meeting=${meeting.id} user=${userId}.`,
      );
      return;
    }

    // Idempotent: chỉ ghi khi check_out_time NULL hoặc verifyTime muộn hơn lần đã lưu.
    if (
      rec.check_out_time != null &&
      verifyTime.getTime() <= new Date(rec.check_out_time).getTime()
    ) {
      return; // KHÔNG update, KHÔNG event.
    }

    const leftEarly = verifyTime.getTime() < effectiveEnd.getTime();
    await this.dataSource.manager.query(
      `UPDATE attendance_records SET check_out_time = $2, left_early = $3, updated_at = now() WHERE id = $1`,
      [rec.id, verifyTime, leftEarly],
    );
    // Event check_out CHỈ khi thực ghi/đổi (source_type='camera' khớp event check_in).
    await this.dataSource.manager.query(
      `INSERT INTO attendance_events
         (meeting_id, attendance_record_id, user_id, room_id, device_id,
          event_type, event_time, source_type)
       VALUES ($1,$2,$3,$4,$5,'check_out',$6,'camera')`,
      [meeting.id, rec.id, userId, roomId, deviceId, verifyTime],
    );
    this.logger.log(
      `attendance check_out: user=${userId} meeting=${meeting.id} left_early=${leftEarly}.`,
    );

    try {
      this.websocketService.emitToRoom(
        `meeting:${meeting.id}`,
        'meeting.attendance.updated',
        {
          meetingId: meeting.id,
          userId,
          eventType: 'check_out',
          checkOutTime: verifyTime.toISOString(),
          leftEarly,
        },
      );
    } catch (e) {
      this.logger.warn(
        `WS emit meeting.attendance.updated failed: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * NC-5 resolve: device_id + device_person_id=personId (primary);
   * fallback device_person_code=personName. meetingId = metadata_json.bookingId.
   */
  private async resolveMapping(
    deviceId: string,
    personId: string | null,
    personName: string | null,
  ): Promise<{ userId: string; meetingId: string | null; visitId: string | null } | null> {
    // Chỉ match mapping ĐANG hiệu lực: sync_status='synced' + chưa soft-delete.
    // Mapping đã 'deleted' (sau deprovision) KHÔNG resolve → không ghi điểm danh
    // dù còn mặt sót trên cam.
    let rows: MappingRow[] = [];
    if (personId) {
      rows = await this.dataSource.manager.query(
        `SELECT user_id, metadata_json FROM device_user_mappings
         WHERE device_id = $1 AND device_person_id = $2
           AND sync_status = 'synced' AND deleted_at IS NULL
         ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`,
        [deviceId, personId],
      );
    }
    if (!rows[0] && personName) {
      rows = await this.dataSource.manager.query(
        `SELECT user_id, metadata_json FROM device_user_mappings
         WHERE device_id = $1 AND device_person_code = $2
           AND sync_status = 'synced' AND deleted_at IS NULL
         ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`,
        [deviceId, personName],
      );
    }
    const row = rows[0];
    if (!row) return null;

    const bookingId = row.metadata_json?.['bookingId'];
    const visitId = row.metadata_json?.['source'] === 'visitor' ? row.metadata_json?.['visitId'] : null;
    return {
      userId: row.user_id,
      meetingId: typeof bookingId === 'string' && bookingId ? bookingId : null,
      visitId: typeof visitId === 'string' && visitId ? visitId : null,
    };
  }

  /** Khu vực của thiết bị (iot_devices.zone_id); null nếu thiết bị gắn theo phòng. */
  private async zoneOf(deviceId: string): Promise<string | null> {
    const rows: Array<{ zone_id: string | null }> = await this.dataSource.manager.query(
      `SELECT zone_id FROM iot_devices WHERE id = $1 LIMIT 1`,
      [deviceId],
    );
    return rows?.[0]?.zone_id ?? null;
  }

  private msgOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
