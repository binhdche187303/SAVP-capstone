import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MeetingsService } from './meetings.service.js';
import type { AuthUser, ClientContext } from './meetings.service.js';
import { MeetingPrepService } from './meeting-prep.service.js';
import type { CreateMeetingDto, MeetingRecurrenceDto } from '../dto/create-meeting.dto.js';

/** VN không có giờ mùa hè ⇒ cộng/trừ cố định 7 giờ để lấy ngày địa phương. */
const VN_OFFSET_MS = 7 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const MAX_OCCURRENCES = 60;

export type SeriesScope = 'this' | 'following';

/**
 * Lịch UEL mục 16 — sự kiện lặp. Mỗi lần họp là một cuộc họp thật (phòng, thành viên,
 * điểm danh, biên bản riêng), cùng `recurrence_rule_id`; `parent_meeting_id` = lần đầu.
 */
@Injectable()
export class MeetingSeriesService {
  private readonly logger = new Logger(MeetingSeriesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly meetingsService: MeetingsService,
    private readonly prepService: MeetingPrepService,
  ) {}

  /** Danh sách các lần họp [start, end] theo quy tắc lặp, giữ nguyên giờ và thời lượng. */
  buildOccurrences(startIso: string, endIso: string, rec: MeetingRecurrenceDto): Array<{ date: string; start: Date; end: Date }> {
    const start = new Date(startIso);
    const duration = new Date(endIso).getTime() - start.getTime();
    if (!rec.endDate && !rec.count) {
      throw new BadRequestException({
        success: false,
        message: 'Vui lòng chọn ngày kết thúc hoặc số lần lặp',
        error: { code: 'RECURRENCE_END_REQUIRED', details: {} },
      });
    }
    const limit = Math.min(rec.count ?? MAX_OCCURRENCES, MAX_OCCURRENCES);
    const endDate = rec.endDate ? rec.endDate.slice(0, 10) : null;
    const local0 = new Date(start.getTime() + VN_OFFSET_MS); // giờ VN biểu diễn bằng UTC fields
    const dateOf = (d: Date) => d.toISOString().slice(0, 10);
    const weekdays =
      rec.type === 'weekly'
        ? new Set(rec.daysOfWeek?.length ? rec.daysOfWeek : [((local0.getUTCDay() + 6) % 7) + 1])
        : null;

    const out: Array<{ date: string; start: Date; end: Date }> = [];
    const push = (local: Date) => {
      const s = new Date(local.getTime() - VN_OFFSET_MS);
      out.push({ date: dateOf(local), start: s, end: new Date(s.getTime() + duration) });
    };
    for (let i = 0; out.length < limit && i < 800; i++) {
      let local: Date;
      if (rec.type === 'monthly') {
        local = new Date(local0);
        local.setUTCDate(1);
        local.setUTCMonth(local0.getUTCMonth() + i);
        const dim = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
        if (local0.getUTCDate() > dim) continue; // tháng không có ngày 31 ⇒ bỏ qua
        local.setUTCDate(local0.getUTCDate());
      } else {
        local = new Date(local0.getTime() + i * DAY_MS);
        if (weekdays && !weekdays.has(((local.getUTCDay() + 6) % 7) + 1)) continue;
      }
      if (endDate && dateOf(local) > endDate) break;
      push(local);
    }
    if (out.length < 2) {
      throw new BadRequestException({
        success: false,
        message: 'Lịch lặp phải có ít nhất 2 lần họp',
        error: { code: 'RECURRENCE_TOO_SHORT', details: {} },
      });
    }
    return out;
  }

  /**
   * Tạo chuỗi họp. Kiểm tra trùng phòng tất cả các lần trước; có ngày trùng (và chưa nằm
   * trong skipDates) ⇒ 409 kèm danh sách để FE hỏi người dùng bỏ qua các ngày đó.
   */
  async createSeries(dto: CreateMeetingDto, authUser: AuthUser, ctx: ClientContext) {
    const rec = dto.recurrence!;
    const skip = new Set((dto.skipDates ?? []).map((d) => d.slice(0, 10)));
    const all = this.buildOccurrences(dto.startTime, dto.endTime, rec);
    const occurrences = all.filter((o) => !skip.has(o.date));

    const conflicts: string[] = [];
    if (dto.roomId) {
      for (const o of occurrences) {
        const r = await this.meetingsService.getRoomAvailability(dto.roomId, o.start, o.end);
        if (r.hasConflict) conflicts.push(o.date);
      }
    }
    if (conflicts.length > 0) {
      throw new ConflictException({
        success: false,
        message: `Phòng đã có lịch vào ${conflicts.length} ngày trong chuỗi`,
        error: { code: 'RECURRENCE_ROOM_CONFLICT', details: { conflictDates: conflicts } },
      });
    }
    if (occurrences.length === 0) {
      throw new BadRequestException({
        success: false,
        message: 'Không còn lần họp nào sau khi bỏ qua các ngày trùng',
        error: { code: 'RECURRENCE_EMPTY', details: {} },
      });
    }

    const [rule] = await this.dataSource.query(
      `INSERT INTO meeting_recurrence_rules
         (recurrence_type, interval_value, days_of_week, day_of_month, start_date, end_date, occurrence_count, timezone, exception_dates_json, created_by)
       VALUES ($1, 1, $2, $3, $4, $5, $6, 'Asia/Ho_Chi_Minh', $7, $8) RETURNING id`,
      [
        rec.type,
        rec.type === 'weekly' ? (rec.daysOfWeek ?? []).join(',') || null : null,
        rec.type === 'monthly' ? new Date(all[0].start.getTime() + VN_OFFSET_MS).getUTCDate() : null,
        all[0].date,
        rec.endDate ? rec.endDate.slice(0, 10) : null,
        rec.count ?? null,
        skip.size ? JSON.stringify({ skipped: [...skip] }) : null,
        authUser.userId,
      ],
    );

    const { recurrence: _r, skipDates: _s, ...base } = dto;
    const created: Array<{ id: string; date: string; status: string }> = [];
    let parentId: string | null = null;
    let firstResult: Awaited<ReturnType<MeetingsService['create']>> | null = null;
    for (const o of occurrences) {
      const res = await this.meetingsService.create(
        { ...base, startTime: o.start.toISOString(), endTime: o.end.toISOString() } as CreateMeetingDto,
        authUser,
        ctx,
      );
      parentId ??= res.id;
      firstResult ??= res;
      await this.dataSource.query(
        `UPDATE meetings SET recurrence_rule_id = $2, parent_meeting_id = $3 WHERE id = $1`,
        [res.id, rule.id, res.id === parentId ? null : parentId],
      );
      await this.prepService.applyCreateOptions(res.id, {
        reportRequirement: dto.reportRequirement,
        signoff: dto.signoff,
      });
      created.push({ id: res.id, date: o.date, status: res.status });
    }
    return { ...firstResult!, series: { recurrenceRuleId: rule.id as string, occurrences: created } };
  }

  /** Các lần họp trong chuỗi: lần này, hoặc lần này + các lần sau chưa diễn ra. */
  private async targets(meetingId: string, scope: SeriesScope) {
    const [m] = await this.dataSource.query(
      `SELECT id, recurrence_rule_id, start_time, end_time FROM meetings WHERE id = $1 AND deleted_at IS NULL`,
      [meetingId],
    );
    if (!m) {
      throw new NotFoundException({
        success: false,
        message: 'Cuộc họp không tồn tại',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }
    if (scope === 'this' || !m.recurrence_rule_id) return { meeting: m, ids: [m.id as string] };
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM meetings WHERE recurrence_rule_id = $1 AND deleted_at IS NULL
          AND start_time >= $2 AND status IN ('scheduled', 'pending_approval')
        ORDER BY start_time`,
      [m.recurrence_rule_id, m.start_time],
    );
    return { meeting: m, ids: rows.map((r) => r.id) };
  }

  /** Thông tin chuỗi cho trang chi tiết. */
  async getSeries(meetingId: string) {
    const [m] = await this.dataSource.query(
      `SELECT recurrence_rule_id FROM meetings WHERE id = $1 AND deleted_at IS NULL`,
      [meetingId],
    );
    if (!m?.recurrence_rule_id) return null;
    const [rule] = await this.dataSource.query(
      `SELECT recurrence_type, days_of_week, end_date, occurrence_count FROM meeting_recurrence_rules WHERE id = $1`,
      [m.recurrence_rule_id],
    );
    const items: Array<{ id: string; start_time: Date; status: string }> = await this.dataSource.query(
      `SELECT id, start_time, status FROM meetings WHERE recurrence_rule_id = $1 AND deleted_at IS NULL ORDER BY start_time`,
      [m.recurrence_rule_id],
    );
    return {
      recurrenceRuleId: m.recurrence_rule_id,
      type: rule?.recurrence_type,
      daysOfWeek: rule?.days_of_week ? String(rule.days_of_week).split(',').map(Number) : [],
      endDate: rule?.end_date ?? null,
      count: rule?.occurrence_count ?? null,
      index: items.findIndex((x) => x.id === meetingId) + 1,
      total: items.length,
      occurrences: items.map((x) => ({ id: x.id, startTime: x.start_time, status: x.status })),
    };
  }

  async cancelSeries(meetingId: string, scope: SeriesScope, authUser: AuthUser, ctx: ClientContext, reason?: string) {
    const { ids } = await this.targets(meetingId, scope);
    return this.runEach(ids, (id) => this.meetingsService.cancelMeeting(id, authUser, ctx, reason));
  }

  /** Đổi giờ: lần này hoặc dời cùng một khoảng (và cùng thời lượng mới) cho các lần sau. */
  async updateSeriesTime(
    meetingId: string,
    scope: SeriesScope,
    body: { startTime: string; endTime: string; changeReason?: string },
    authUser: AuthUser,
    ctx: ClientContext,
  ) {
    const { meeting, ids } = await this.targets(meetingId, scope);
    const delta = new Date(body.startTime).getTime() - new Date(meeting.start_time).getTime();
    const duration = new Date(body.endTime).getTime() - new Date(body.startTime).getTime();
    if (!(duration > 0)) {
      throw new BadRequestException({
        success: false,
        message: 'Giờ kết thúc phải sau giờ bắt đầu',
        error: { code: 'INVALID_TIME_RANGE', details: {} },
      });
    }
    const rows: Array<{ id: string; start_time: Date }> = await this.dataSource.query(
      `SELECT id, start_time FROM meetings WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    const startOf = new Map(rows.map((r) => [r.id, new Date(r.start_time).getTime()]));
    return this.runEach(ids, (id) => {
      const s = new Date(startOf.get(id)! + delta);
      return this.meetingsService.updateMeetingTime(
        id,
        { startTime: s.toISOString(), endTime: new Date(s.getTime() + duration).toISOString(), changeReason: body.changeReason },
        authUser,
        ctx,
      );
    });
  }

  /** Chạy từng lần; lần đầu (lần được chọn) lỗi ⇒ ném lỗi, các lần sau lỗi ⇒ gom vào failed. */
  private async runEach(ids: string[], fn: (id: string) => Promise<unknown>) {
    const done: string[] = [];
    const failed: Array<{ id: string; message: string }> = [];
    for (const id of ids) {
      try {
        await fn(id);
        done.push(id);
      } catch (e) {
        if (done.length === 0 && failed.length === 0 && (e instanceof ForbiddenException || ids.length === 1)) throw e;
        const resp = (e as { response?: { message?: string } }).response;
        failed.push({ id, message: resp?.message ?? (e instanceof Error ? e.message : 'Lỗi') });
        this.logger.warn(`series op ${id} failed: ${failed[failed.length - 1].message}`);
      }
    }
    return { updated: done, failed };
  }
}
