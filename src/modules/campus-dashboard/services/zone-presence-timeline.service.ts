import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  In,
  IsNull,
  Not,
  Repository,
  type FindOptionsWhere,
} from 'typeorm';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import type {
  TimelineEventDto,
  ZoneTimelineResponseDto,
} from '../dto/zone-timeline-response.dto.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_MS = 31 * DAY_MS; // 31 ngày (spec §2.5) — trả sự kiện thô
/** > 31 ngày (tối đa ~1 năm): chỉ trả số liệu tổng hợp + vài sự kiện gần nhất. */
const MAX_SUMMARY_RANGE_MS = 366 * DAY_MS;
const RECENT_LIMIT = 30;
/** 'matched' = sự kiện gắn người đã nhận diện; 'stranger' = lượt xuất hiện không gắn người. */
export type TimelineStatus = 'matched' | 'stranger';
const STATUS_SQL: Record<TimelineStatus, string> = {
  matched: ' AND user_id IS NOT NULL',
  stranger: " AND event_type = 'appear' AND user_id IS NULL",
};
const BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
const NO_DATA_MESSAGE =
  'Không có dữ liệu hiện diện trong khoảng thời gian này.';

/**
 * ZonePresenceTimelineService (ZPT-001 / UC-119) — timeline hiện diện theo khu vực.
 *
 * Mô hình dữ liệu là NHẬT KÝ BẮT GẶP (sighting log): camera IVSS bắn `zone_presence_events`
 * mỗi khi *thấy* một người trong khung hình (giá trị hợp lệ duy nhất là
 * `ZONE_PRESENCE_EVENT_TYPES` = `appear`/`disappear`/`count` — xem
 * `zones/constants/zone-presence-event-type.constant.ts`), KHÔNG bắn khi người đó rời khung.
 * Vì vậy service này KHÔNG thể (và không cố) ghép cặp "vào/ra" để tính thời lượng lưu lại —
 * nguồn dữ liệu không đủ thông tin cho việc đó. `enter`/`exit` là giá trị của
 * `gate_access_logs.direction` (một bảng khác, ngữ nghĩa khác: đi qua ranh giới cổng) —
 * không được dùng nhầm ở đây.
 *
 * 100% READ-ONLY, không persist gì thêm (DATA-01).
 */
@Injectable()
export class ZonePresenceTimelineService {
  constructor(
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    @InjectRepository(ZonePresenceEventEntity)
    private readonly presenceRepo: Repository<ZonePresenceEventEntity>,
  ) {}

  async getTimeline(
    zoneId: string,
    from: Date,
    to: Date,
    userId?: string,
    status?: TimelineStatus,
  ): Promise<ZoneTimelineResponseDto> {
    const zone = await this.zoneRepo.findOne({
      where: { id: zoneId, deletedAt: IsNull() },
    });
    if (!zone) {
      throw new NotFoundException({
        code: 'ZONE_NOT_FOUND',
        message: 'Không tìm thấy khu vực',
      });
    }

    this.validateRange(from, to);
    // Số đếm cho các nút lọc luôn tính trên cả khoảng (không áp `status`).
    const statusCounts = await this.countByStatus(zoneId, from, to, userId);
    const withCounts = <T extends ZoneTimelineResponseDto>(r: T): T =>
      statusCounts.all > 0 ? { ...r, statusCounts } : r;

    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      return withCounts(
        await this.getSummary(zoneId, from, to, userId, status),
      );
    }

    const where: FindOptionsWhere<ZonePresenceEventEntity> = {
      zoneId,
      eventTime: Between(from, to),
      ...this.statusWhere(status),
    };
    if (userId) where.userId = userId;

    const events = await this.presenceRepo.find({
      where,
      order: { eventTime: 'ASC' },
    });

    if (events.length === 0) {
      return withCounts({
        events: [],
        personDataAvailable: null,
        sightingCount: null,
        message: NO_DATA_MESSAGE,
      });
    }

    const personDataAvailable = userId
      ? true
      : events.some((e) => e.userId !== null);

    return withCounts({
      events: this.toDto(events),
      personDataAvailable,
      sightingCount: userId ? events.length : null,
    });
  }

  private statusWhere(
    status?: TimelineStatus,
  ): FindOptionsWhere<ZonePresenceEventEntity> {
    if (status === 'matched') return { userId: Not(IsNull()) };
    if (status === 'stranger') return { userId: IsNull(), eventType: 'appear' };
    return {};
  }

  private async countByStatus(
    zoneId: string,
    from: Date,
    to: Date,
    userId?: string,
  ): Promise<{ all: number; matched: number; stranger: number }> {
    const params: unknown[] = [zoneId, from, to];
    if (userId) params.push(userId);
    const rows: Array<{ all: string; matched: string; stranger: string }> =
      await this.presenceRepo.query(
        `SELECT COUNT(*)::text AS all,
                COUNT(*) FILTER (WHERE user_id IS NOT NULL)::text AS matched,
                COUNT(*) FILTER (WHERE event_type = 'appear' AND user_id IS NULL)::text AS stranger
           FROM zone_presence_events
          WHERE zone_id = $1 AND event_time BETWEEN $2 AND $3${userId ? ' AND user_id = $4' : ''}`,
        params,
      );
    const r = rows[0];
    return {
      all: Number(r?.all ?? 0),
      matched: Number(r?.matched ?? 0),
      stranger: Number(r?.stranger ?? 0),
    };
  }

  private validateRange(from: Date, to: Date): void {
    if (to.getTime() - from.getTime() > MAX_SUMMARY_RANGE_MS) {
      throw new BadRequestException({
        code: 'INVALID_TIMELINE_RANGE',
        message: 'Khoảng thời gian tối đa 1 năm',
      });
    }
  }

  /** Khoảng dài: gom theo giờ ngay trong SQL thay vì kéo hết sự kiện thô về. */
  private async getSummary(
    zoneId: string,
    from: Date,
    to: Date,
    userId?: string,
    status?: TimelineStatus,
  ): Promise<ZoneTimelineResponseDto> {
    const params: unknown[] = [zoneId, from, to];
    let userSql = status ? STATUS_SQL[status] : '';
    if (userId) {
      params.push(userId);
      userSql += ` AND user_id = $4`;
    }
    const rows: Array<{
      hour: number;
      total: string;
      appear: string;
      disappear: string;
      has_person: boolean;
    }> = await this.presenceRepo.query(
      `SELECT EXTRACT(HOUR FROM event_time AT TIME ZONE '${BUSINESS_TIMEZONE}')::int AS hour,
              COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE event_type = 'appear')::text AS appear,
              COUNT(*) FILTER (WHERE event_type = 'disappear')::text AS disappear,
              BOOL_OR(user_id IS NOT NULL) AS has_person
         FROM zone_presence_events
        WHERE zone_id = $1 AND event_time BETWEEN $2 AND $3${userSql}
        GROUP BY 1`,
      params,
    );
    const hourly = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      appear: 0,
      disappear: 0,
    }));
    let total = 0;
    let personSeen = false;
    for (const r of rows) {
      const b = hourly[r.hour];
      if (!b) continue;
      b.appear = Number(r.appear);
      b.disappear = Number(r.disappear);
      total += Number(r.total);
      personSeen = personSeen || r.has_person;
    }
    if (total === 0) {
      return {
        events: [],
        personDataAvailable: null,
        sightingCount: null,
        message: NO_DATA_MESSAGE,
      };
    }
    const where: FindOptionsWhere<ZonePresenceEventEntity> = {
      zoneId,
      eventTime: Between(from, to),
      eventType: In(['appear', 'disappear']),
      ...this.statusWhere(status),
    };
    if (userId) where.userId = userId;
    const recent = await this.presenceRepo.find({
      where,
      order: { eventTime: 'DESC' },
      take: RECENT_LIMIT,
    });
    return {
      events: this.toDto(recent.reverse()),
      personDataAvailable: userId ? true : personSeen,
      sightingCount: userId ? total : null,
      summary: {
        total,
        appearTotal: hourly.reduce((n, b) => n + b.appear, 0),
        disappearTotal: hourly.reduce((n, b) => n + b.disappear, 0),
        hourly,
      },
    };
  }

  private toDto(events: ZonePresenceEventEntity[]): TimelineEventDto[] {
    return events.map((e) => ({
      eventTime: e.eventTime.toISOString(),
      eventType: e.eventType,
      occupancyCount: e.occupancyCount,
      userId: e.userId,
      // [2026-08-22] isStranger CHỈ áp dụng cho 'appear' (lượt bắt gặp 1 người cụ thể).
      // 'count' (đếm người, writeCountEvent()) LUÔN userId=null theo thiết kế — KHÔNG
      // phải "không nhận diện được", mà là sự kiện tổng hợp không gắn 1 người nào cả.
      // Gộp cả 2 vào 1 công thức `userId === null` sẽ gắn nhầm badge "Người lạ" cho
      // mọi dòng count (đa số dữ liệu bảng này).
      isStranger: e.eventType === 'appear' && e.userId === null,
    }));
  }
}
