import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import type {
  ManagerSummaryResponseDto,
  OnTimeRateThisWeekDto,
} from '../dto/manager-summary-response.dto.js';

/** startOfDay theo server local timezone (mirror pattern UC-126 §2.4). */
function startOfDay(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Mirror default `graceMinutes ?? 0` của `on-time-rate.service.ts` (module `analytics`) — KHÔNG
 * có system_configs key riêng cho ngưỡng này (đã verify T0, `DashboardOverviewConfigService`
 * chỉ đọc `analytics.dashboard_max_range_days`), nên hard-code cùng default 0 thay vì bịa key mới.
 */
const ON_TIME_GRACE_MINUTES = 0;

/**
 * ManagerSummaryService (CDB-RS-001) — dashboard tổng hợp cho MANAGER.
 * Module 100% READ-ONLY (DATA-01) — không INSERT/UPDATE/DELETE bảng nào.
 *
 * ARCH-02: KHÔNG import `MeetingsModule`/`AnalyticsModule` — điều kiện "pending meeting
 * requests chờ manager duyệt" và "on-time rate" viết lại bằng raw SQL tương đương logic đã có
 * ở `meetings.service.ts:5245-5253` và `on-time-rate.repository.ts` (mirror, không tái sử dụng
 * qua import cross-module).
 */
@Injectable()
export class ManagerSummaryService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async getSummary(managerId: string): Promise<ManagerSummaryResponseDto> {
    const now = new Date();
    const todayStart = startOfDay(now);

    const teamPresenceToday = await this.computeTeamPresenceToday(
      managerId,
      todayStart,
      now,
    );
    const pendingMeetingRequestsCount =
      await this.countPendingMeetingRequests(managerId);
    const onTimeRateThisWeek = await this.computeOnTimeRateThisWeek(
      managerId,
      now,
    );

    return {
      teamPresenceToday,
      pendingMeetingRequestsCount,
      onTimeRateThisWeek,
      // CDB-RS-001 spec §2.8: không có mapping zone↔team đáng tin cậy — để trống có chủ đích.
      teamZoneSecurityAlerts: { value: null, note: 'not_available' },
    };
  }

  /** R3 (spec): CHỈ `direct_manager_id` — KHÔNG mở rộng qua department (khác pending-requests). */
  private async computeTeamPresenceToday(
    managerId: string,
    todayStart: Date,
    now: Date,
  ): Promise<{ presentCount: number; totalCount: number }> {
    const teamMembers = await this.userRepo.find({
      where: { directManagerId: managerId, deletedAt: IsNull() },
      select: { id: true },
    });
    const totalCount = teamMembers.length;
    if (totalCount === 0) {
      return { presentCount: 0, totalCount: 0 };
    }

    const teamIds = teamMembers.map((u) => u.id);
    // Chỉ tính người có lượt cuối hôm nay là vào; ra rồi vào lại vẫn được tính.
    // id phá hòa khi hai lượt có cùng thời điểm, như thống kê theo phòng ban.
    const rows: Array<{ user_id: string }> = await this.dataSource.query(
      `WITH last_log AS (
         SELECT DISTINCT ON (user_id) user_id, direction
         FROM gate_access_logs
         WHERE user_id = ANY($1)
           AND direction IN ('enter', 'leave')
           AND access_time >= $2 AND access_time <= $3
         ORDER BY user_id, access_time DESC, id DESC
       )
       SELECT user_id FROM last_log WHERE direction = 'enter'`,
      [teamIds, todayStart, now],
    );
    return { presentCount: rows.length, totalCount };
  }

  /**
   * R2 (crux, spec): mirror ĐÚNG điều kiện 2-nhánh thật của `meetings.service.ts:5245-5253`
   * (direct report HOẶC department mà manager là `manager_user_id`), KHÔNG chỉ `direct_manager_id`.
   */
  private async countPendingMeetingRequests(
    managerId: string,
  ): Promise<number> {
    const rows: Array<{ count: string }> = await this.dataSource.query(
      `SELECT COUNT(DISTINCT mr.id)::text AS count
       FROM meeting_requests mr
       INNER JOIN users requester ON requester.id = mr.requested_by
       WHERE mr.approval_status = 'pending'
         AND (
           requester.direct_manager_id = $1
           OR requester.department_id IN (
             SELECT id FROM departments WHERE manager_user_id = $1
           )
         )`,
      [managerId],
    );
    return Number(rows[0]?.count ?? 0);
  }

  /**
   * R4 (crux, spec): dùng ĐÚNG ngưỡng "on-time" của `on-time-rate.repository.ts` (check-in trong
   * X phút sau giờ bắt đầu, X=`ON_TIME_GRACE_MINUTES`), scope theo `u.direct_manager_id = manager`
   * (khác `on-time-rate` gốc scope theo department) — phạm vi 7 ngày gần nhất.
   */
  private async computeOnTimeRateThisWeek(
    managerId: string,
    now: Date,
  ): Promise<OnTimeRateThisWeekDto> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const rows: Array<{ on_time_count: string; total_count: string }> =
      await this.dataSource.query(
        `WITH classified AS (
          SELECT
            CASE
              WHEN ar.id IS NULL OR ar.attendance_status = 'absent' OR NOT ar.is_present THEN 'absent'
              WHEN $1::int = 0 THEN
                CASE WHEN NOT ar.is_late THEN 'on_time' ELSE 'late' END
              ELSE
                CASE WHEN ar.late_minutes IS NULL OR ar.late_minutes <= $1::int THEN 'on_time' ELSE 'late' END
            END AS status_bucket
          FROM meeting_participants mp
          INNER JOIN meetings m ON m.id = mp.meeting_id
          INNER JOIN users u ON u.id = mp.user_id
          LEFT JOIN attendance_records ar ON ar.meeting_id = m.id AND ar.user_id = mp.user_id
          WHERE m.status = 'completed'
            AND m.deleted_at IS NULL
            AND mp.invitation_status <> 'declined'
            AND (ar.id IS NULL OR ar.attendance_status NOT IN ('invalidated', 'pending_review'))
            AND m.start_time >= $2
            AND m.start_time <= $3
            AND u.direct_manager_id = $4
        )
        SELECT
          COUNT(*) FILTER (WHERE status_bucket = 'on_time')::text AS on_time_count,
          COUNT(*)::text AS total_count
        FROM classified`,
        [ON_TIME_GRACE_MINUTES, sevenDaysAgo, now, managerId],
      );

    const onTimeCount = Number(rows[0]?.on_time_count ?? 0);
    const totalCount = Number(rows[0]?.total_count ?? 0);
    const rate =
      totalCount > 0 ? Math.round((onTimeCount / totalCount) * 1000) / 10 : 0;
    return { rate, sampleSize: totalCount };
  }
}
