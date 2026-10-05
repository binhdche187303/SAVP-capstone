import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  IsNull,
  Not,
  LessThanOrEqual,
  MoreThan,
  In,
} from 'typeorm';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../../modules/meetings/entities/meeting.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
  InvitationStatus,
} from '../../../modules/meetings/entities/meeting-participant.entity.js';
import { UserEntity } from '../../../modules/accounts/entities/user.entity.js';
import { DepartmentEntity } from '../../../modules/accounts/entities/department.entity.js';
import {
  AttendanceRecordEntity,
  AttendanceRecordStatus,
} from '../entities/attendance-record.entity.js';
import {
  QueryAttendanceDto,
  AttendanceQueryStatusList,
} from '../dto/query-attendance.dto.js';
import { AttendanceItemDto } from '../dto/attendance-item.dto.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { toManualAttendanceResponse } from '../dto/manual-attendance-response.dto.js';
import {
  AttendanceRecordDetailResponseDto,
  AttendanceEditHistoryItemDto,
} from '../dto/attendance-record-detail-response.dto.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';

/** Role codes (UPPERCASE — đúng seed thật) coi là admin cho mục đích bypass checkAccess. */
const ADMIN_ROLE_CODES = ['BUSINESS_ADMIN', 'SYSTEM_ADMIN'];

interface ParticipantWithUser {
  participantId: string;
  userId: string;
  fullName: string;
  avatarUrl: string | null;
  departmentName: string | null;
  positionTitle: string | null;
  participantRole: string;
  email: string | null;
  employeeCode: string | null;
  attendanceRecord: AttendanceRecordEntity | null;
}

interface AttendanceStatusResult {
  attendanceStatus: string;
  isLate: boolean;
  lateMinutes: number;
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    @InjectRepository(MeetingEntity)
    private readonly meetingRepo: Repository<MeetingEntity>,
    @InjectRepository(MeetingParticipantEntity)
    private readonly participantRepo: Repository<MeetingParticipantEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(AttendanceRecordEntity)
    private readonly attendanceRecordRepo: Repository<AttendanceRecordEntity>,
    private readonly authzRead: AuthzReadRepository,
  ) {}

  // ===== T011: validateAndGetMeeting =====
  async validateAndGetMeeting(meetingId: string): Promise<MeetingEntity> {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId, deletedAt: IsNull() },
    });

    if (!meeting) {
      throw new NotFoundException({
        message: 'Meeting not found',
        error: 'MEETING_NOT_FOUND',
      });
    }

    // [2026-08-22] BO gate `now < meeting.startTime`. Ly do: Host duoc phep bat
    // dau cuoc hop SOM hon gio len lich, khi do meeting.status = in_progress
    // nhung dong ho tuong van chua toi startTime => GET danh sach diem danh tra
    // 409 ATTENDANCE_NOT_OPEN_YET, FE hien toast "Danh sach diem danh chua duoc
    // mo" lap lai moi 15s. Diem danh SOM la hop le; computeLateFlags() da xu ly
    // dung (checkInTime <= startTime => isLate=false, lateMinutes=0 => dung gio).
    // Gate theo TRANG THAI meeting ben duoi van giu nguyen — do moi la rao chan
    // that su (draft/pending_approval/cancelled van bi chan).

    // Allowed statuses: scheduled, in_progress, completed
    const allowedStatuses: MeetingStatus[] = [
      MeetingStatus.SCHEDULED,
      MeetingStatus.IN_PROGRESS,
      MeetingStatus.COMPLETED,
    ];
    if (!allowedStatuses.includes(meeting.status)) {
      throw new ConflictException({
        message: 'Meeting is not in a state that allows viewing attendance',
        error: 'ATTENDANCE_NOT_OPEN_YET',
      });
    }

    return meeting;
  }

  // ===== T012: checkAccess =====
  async checkAccess(
    meeting: MeetingEntity,
    currentUserId: string,
  ): Promise<{
    canViewAttendanceSource: boolean;
    isManagerOfParticipantIds: Set<string>;
  }> {
    // Check 1: Organizer
    if (meeting.organizerId === currentUserId) {
      return {
        canViewAttendanceSource: true,
        isManagerOfParticipantIds: new Set(),
      };
    }

    // Check 2: Host
    if (meeting.hostId === currentUserId) {
      return {
        canViewAttendanceSource: true,
        isManagerOfParticipantIds: new Set(),
      };
    }

    // Check 3-4: Participant (including host role)
    const participant = await this.participantRepo.findOne({
      where: {
        meetingId: meeting.id,
        userId: currentUserId,
        invitationStatus: Not(InvitationStatus.DECLINED),
      },
    });

    if (participant) {
      if (participant.participantRole === ParticipantRole.HOST) {
        return {
          canViewAttendanceSource: true,
          isManagerOfParticipantIds: new Set(),
        };
      }
      // Basic participant access - check for manager scope
      const managedIds = await this.getDirectReportIds(
        currentUserId,
        meeting.id,
      );
      return {
        canViewAttendanceSource: managedIds.size > 0,
        isManagerOfParticipantIds: managedIds,
      };
    }

    // Check 5: Admin roles (simplified - check user_roles)
    const isAdmin = await this.checkIsAdmin(currentUserId);
    if (isAdmin) {
      return {
        canViewAttendanceSource: true,
        isManagerOfParticipantIds: new Set(),
      };
    }

    // Check 6: Direct manager (1 level)
    const managedIds = await this.getDirectReportIds(currentUserId, meeting.id);
    if (managedIds.size > 0) {
      return {
        canViewAttendanceSource: true,
        isManagerOfParticipantIds: managedIds,
      };
    }

    // No access
    throw new ForbiddenException({
      message: 'You do not have permission to view this attendance list',
      error: 'PERMISSION_DENIED',
    });
  }

  private async getDirectReportIds(
    managerUserId: string,
    meetingId: string,
  ): Promise<Set<string>> {
    const participants = await this.participantRepo.find({
      where: {
        meetingId,
        invitationStatus: Not(InvitationStatus.DECLINED),
      },
      relations: { user: true },
    });

    const directReportIds = new Set<string>();
    for (const p of participants) {
      if (p.user?.directManagerId === managerUserId) {
        directReportIds.add(p.userId);
      }
    }
    return directReportIds;
  }

  private async checkIsAdmin(userId: string): Promise<boolean> {
    const { roles } = await this.authzRead.getEffectiveRolesAndPermissions(
      userId,
    );
    return roles.some((r) => ADMIN_ROLE_CODES.includes(r));
  }

  // ===== T014: getParticipantsWithAttendance =====
  async getParticipantsWithAttendance(
    meetingId: string,
  ): Promise<ParticipantWithUser[]> {
    const participants = await this.participantRepo.find({
      where: {
        meetingId,
        invitationStatus: Not(InvitationStatus.DECLINED),
      },
      relations: {
        user: {
          department: true,
        },
      },
    });

    // [STT 5] Chống N+1: trước đây 1 query/participant. Nay lấy toàn bộ record của
    // meeting trong 1 query, giữ record mới nhất/user (cùng thứ tự updatedAt, createdAt DESC).
    const activeUserIds = participants
      .filter((p) => p.user && !p.user.deletedAt)
      .map((p) => p.userId);
    const latestByUser = new Map<string, AttendanceRecordEntity>();
    if (activeUserIds.length > 0) {
      const allRecords = await this.attendanceRecordRepo.find({
        where: { meetingId, userId: In(activeUserIds) },
        order: { updatedAt: 'DESC', createdAt: 'DESC' },
      });
      for (const rec of allRecords) {
        if (!latestByUser.has(rec.userId)) latestByUser.set(rec.userId, rec);
      }
    }

    const result: ParticipantWithUser[] = [];
    for (const p of participants) {
      if (!p.user || p.user.deletedAt) continue;

      result.push({
        participantId: p.id,
        userId: p.userId,
        fullName: p.user.fullName,
        avatarUrl: p.user.avatarUrl,
        departmentName: p.user.department?.departmentName ?? null,
        positionTitle: p.user.positionTitle,
        participantRole: p.participantRole,
        email: p.user.email,
        employeeCode: p.user.employeeCode,
        attendanceRecord: latestByUser.get(p.userId) ?? null,
      });
    }

    return result;
  }

  // ===== T015: deriveAttendanceStatus =====
  deriveAttendanceStatus(
    record: AttendanceRecordEntity | null,
    meetingStatus: MeetingStatus,
    meetingStartTime: Date,
  ): AttendanceStatusResult {
    // 1. No record or no check-in time
    if (!record || !record.checkInTime) {
      const isCompleted = meetingStatus === MeetingStatus.COMPLETED;
      return {
        attendanceStatus: isCompleted ? 'absent' : 'not_checked_in',
        isLate: false,
        lateMinutes: 0,
      };
    }

    // 2. left_early
    if (
      record.leftEarly ||
      record.attendanceStatus === AttendanceRecordStatus.LEFT_EARLY
    ) {
      return {
        attendanceStatus: 'left_early',
        isLate: record.isLate,
        lateMinutes: record.lateMinutes ?? 0,
      };
    }

    // 3. pending_review
    if (record.attendanceStatus === AttendanceRecordStatus.PENDING_REVIEW) {
      return {
        attendanceStatus: 'pending_review',
        isLate: record.isLate,
        lateMinutes: record.lateMinutes ?? 0,
      };
    }

    // 4. Use existing validated status if present
    if (record.attendanceStatus === AttendanceRecordStatus.PRESENT) {
      return { attendanceStatus: 'present', isLate: false, lateMinutes: 0 };
    }
    if (record.attendanceStatus === AttendanceRecordStatus.LATE) {
      return {
        attendanceStatus: 'late',
        isLate: true,
        lateMinutes: record.lateMinutes ?? 0,
      };
    }
    if (record.attendanceStatus === AttendanceRecordStatus.ABSENT) {
      return { attendanceStatus: 'absent', isLate: false, lateMinutes: 0 };
    }

    // 5-6. Derive from check_in_time vs start_time
    if (record.checkInTime > meetingStartTime) {
      const diffMs = record.checkInTime.getTime() - meetingStartTime.getTime();
      const lateMinutes = Math.max(1, Math.ceil(diffMs / 60000));
      return {
        attendanceStatus: 'late',
        isLate: true,
        lateMinutes,
      };
    }

    return { attendanceStatus: 'present', isLate: false, lateMinutes: 0 };
  }

  // ===== T016: buildSummary =====
  buildSummary(
    items: AttendanceItemDto[],
    meetingStatus: MeetingStatus,
  ): {
    scope: string;
    totalParticipants: number;
    checkedInCount: number;
    presentCount: number;
    lateCount: number;
    absentCount: number;
    notCheckedInCount: number;
    attendanceRate: number;
  } {
    const totalParticipants = items.length;
    let presentCount = 0;
    let lateCount = 0;
    let leftEarlyCount = 0;
    let notCheckedInCount = 0;
    let absentCount = 0;

    for (const item of items) {
      switch (item.attendanceStatus) {
        case 'present':
          presentCount++;
          break;
        case 'late':
          lateCount++;
          break;
        case 'left_early':
          leftEarlyCount++;
          break;
        case 'not_checked_in':
          notCheckedInCount++;
          break;
        case 'absent':
          absentCount++;
          break;
      }
    }

    const checkedInCount = presentCount + lateCount + leftEarlyCount;
    const attendanceRate =
      totalParticipants > 0
        ? Math.round((checkedInCount / totalParticipants) * 100)
        : 0;

    return {
      scope: 'internal_participants_only',
      totalParticipants,
      checkedInCount,
      presentCount,
      lateCount,
      absentCount:
        meetingStatus === MeetingStatus.COMPLETED
          ? absentCount + notCheckedInCount
          : 0,
      notCheckedInCount:
        meetingStatus !== MeetingStatus.COMPLETED ? notCheckedInCount : 0,
      attendanceRate,
    };
  }

  // ===== T017: applyFieldLevelAuth =====
  applyFieldLevelAuth(
    items: AttendanceItemDto[],
    currentUserId: string,
    canViewSource: boolean,
    managedParticipantIds: Set<string>,
  ): AttendanceItemDto[] {
    if (canViewSource) {
      return items; // Keep all fields
    }

    return items.map((item) => {
      const isSelf = item.userId === currentUserId;
      const isManaged = managedParticipantIds.has(item.userId);

      if (isSelf || isManaged) {
        return item; // Can see own source + if managed by this user
      }

      // Hide sensitive fields
      return {
        ...item,
        attendanceSource: null,
        checkInMethod: null,
      };
    });
  }

  // ===== T018: applyFilters =====
  applyFilters(
    items: AttendanceItemDto[],
    query: QueryAttendanceDto,
  ): AttendanceItemDto[] {
    let filtered = [...items];

    if (query.status && query.status !== 'all') {
      filtered = filtered.filter(
        (item) => item.attendanceStatus === query.status,
      );
    }

    if (query.search) {
      const searchLower = query.search.trim().toLowerCase();
      filtered = filtered.filter(
        (item) =>
          item.fullName.toLowerCase().includes(searchLower) ||
          (item as any).email?.toLowerCase().includes(searchLower) ||
          (item as any).employeeCode?.toLowerCase().includes(searchLower),
      );
    }

    return filtered;
  }

  // ===== T019: applyPagination =====
  applyPagination(
    items: AttendanceItemDto[],
    page: number,
    pageSize: number,
  ): {
    items: AttendanceItemDto[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  } {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);

    return {
      items: paged,
      meta: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  // ===== T009+T020: Main orchestrator =====
  async getAttendanceList(
    meetingId: string,
    currentUserId: string,
    query: QueryAttendanceDto,
  ): Promise<{ success: boolean; message: string; data: any; meta?: any }> {
    try {
      // Step 1: Validate meeting
      const meeting = await this.validateAndGetMeeting(meetingId);

      // Step 2: Check access
      const { canViewAttendanceSource, isManagerOfParticipantIds } =
        await this.checkAccess(meeting, currentUserId);

      // Step 3: Get participants with attendance data
      const participants = await this.getParticipantsWithAttendance(meetingId);

      // Step 4: Derive attendance status for each participant
      let items: AttendanceItemDto[] = participants.map((p) => {
        const derived = this.deriveAttendanceStatus(
          p.attendanceRecord,
          meeting.status,
          meeting.startTime,
        );

        return new AttendanceItemDto({
          // id bản ghi điểm danh (null nếu chưa điểm danh) — FE dùng cho route :recordId.
          id: p.attendanceRecord?.id ?? null,
          participantId: p.participantId,
          userId: p.userId,
          avatarUrl: p.avatarUrl,
          fullName: p.fullName,
          departmentName: p.departmentName,
          positionTitle: p.positionTitle,
          participantRole: p.participantRole,
          attendanceStatus: derived.attendanceStatus,
          checkInTime: p.attendanceRecord?.checkInTime?.toISOString() ?? null,
          attendanceSource: p.attendanceRecord?.attendanceSource ?? null,
          checkInMethod: p.attendanceRecord?.checkInMethod ?? null,
          isLate: derived.isLate,
          lateMinutes: derived.lateMinutes,
        });
      });

      // Step 5: Build summary
      const summary = this.buildSummary(items, meeting.status);

      // Step 6: Apply field-level auth
      items = this.applyFieldLevelAuth(
        items,
        currentUserId,
        canViewAttendanceSource,
        isManagerOfParticipantIds,
      );

      // Step 7: Apply filters
      items = this.applyFilters(items, query);

      // Step 8: Apply pagination
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const { items: pagedItems, meta } = this.applyPagination(
        items,
        page,
        pageSize,
      );

      // Build response
      return {
        success: true,
        message: 'Danh sach diem danh duoc truy xuat thanh cong',
        data: {
          meeting: {
            id: meeting.id,
            title: meeting.title,
            status: meeting.status,
            startTime: meeting.startTime.toISOString(),
            endTime: meeting.endTime.toISOString(),
            roomId: meeting.roomId,
          },
          permissions: {
            canViewAttendanceSource,
          },
          summary,
          items: pagedItems,
        },
        meta,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      this.logger.error(
        'Failed to get attendance list',
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        message: 'An internal error occurred while retrieving attendance list',
        error: 'INTERNAL_ERROR',
      });
    }
  }

  // ===== UC-82: getAttendanceRecordDetail (READ-only) =====
  /**
   * Xem chi tiết 1 bản ghi điểm danh + tên người/họp + editHistory (đọc lại audit_logs).
   * READ-only: KHÔNG mutation/transaction/audit-ghi. KHÔNG đổi constructor —
   * đọc audit qua attendanceRecordRepo.manager.getRepository(AuditLogEntity).
   */
  async getAttendanceRecordDetail(
    meetingId: string,
    recordId: string,
  ): Promise<AttendanceRecordDetailResponseDto> {
    // 1. Load record (kèm relation user + meeting cho tên); 404 nếu không có / khác meeting
    const record = await this.attendanceRecordRepo.findOne({
      where: { id: recordId, meetingId },
      relations: { user: true, meeting: true },
    });
    if (!record) {
      throw new NotFoundException({
        success: false,
        message: 'Attendance record not found',
        error: {
          code: 'ATTENDANCE_RECORD_NOT_FOUND',
          details: { meetingId, recordId },
        },
        timestamp: new Date().toISOString(),
        path: `/api/v1/meetings/${meetingId}/attendance/${recordId}`,
      });
    }

    // 2. editHistory: BATCH 1 query audit_logs (entityId=recordId, actionType IN 4 loại), sort asc
    const auditRepo =
      this.attendanceRecordRepo.manager.getRepository(AuditLogEntity);
    const auditRows = await auditRepo.find({
      where: {
        entityId: recordId,
        actionType: In([
          'create_manual_attendance',
          'update_attendance_status',
          'update_attendance_record',
          'invalidate_attendance',
        ]),
      },
      order: { createdAt: 'ASC' },
    });

    const editHistory: AttendanceEditHistoryItemDto[] = auditRows.map((row) => {
      // changes linh hoạt: có old/new → {old,new}; chỉ có metadata → metadata; else null
      let changes: Record<string, unknown> | null;
      if (row.oldValueJson !== null || row.newValueJson !== null) {
        changes = { old: row.oldValueJson, new: row.newValueJson };
      } else if (row.metadataJson !== null) {
        changes = row.metadataJson;
      } else {
        changes = null;
      }
      return {
        at: row.createdAt.toISOString(),
        actorUserId: row.userId,
        actionType: row.actionType,
        changes,
      };
    });

    // 3. Map base (tái dùng mapper §5) + tên người/họp + editHistory
    return {
      ...toManualAttendanceResponse(record),
      userFullName: record.user?.fullName ?? null,
      meetingTitle: record.meeting?.title ?? null,
      editHistory,
    };
  }
}
