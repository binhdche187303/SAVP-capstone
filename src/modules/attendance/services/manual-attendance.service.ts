import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository, IsNull, Not } from 'typeorm';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../../modules/meetings/entities/meeting.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
  InvitationStatus,
} from '../../../modules/meetings/entities/meeting-participant.entity.js';
import {
  AttendanceRecordEntity,
  AttendanceRecordStatus,
  AttendanceSource,
  CheckInMethod,
} from '../entities/attendance-record.entity.js';
import { AuditLogsService } from '../../../modules/administration/services/audit-logs.service.js';
import { AuthzReadRepository } from '../../../modules/auth/repositories/authz-read.repository.js';
import { computeLateFlags } from '../utils/compute-late-flags.util.js';
import {
  getAttendanceEarlyLeaveMinutes,
  getAttendanceLateGraceMinutes,
} from '../utils/get-late-grace-minutes.util.js';
import {
  ManualAttendanceResponseDto,
  toManualAttendanceResponse,
} from '../dto/manual-attendance-response.dto.js';
import { CreateManualAttendanceDto } from '../dto/create-manual-attendance.dto.js';
import { UpdateAttendanceStatusDto } from '../dto/update-attendance-status.dto.js';
import { UpdateAttendanceProfileDto } from '../dto/update-attendance-profile.dto.js';
import { InvalidateAttendanceDto } from '../dto/invalidate-attendance.dto.js';

/** Role codes (UPPERCASE — đúng seed thật, plan §4.5) cho ownership-bypass. */
const SYSTEM_ADMIN = 'SYSTEM_ADMIN';
const BUSINESS_ADMIN = 'BUSINESS_ADMIN';

const AUDIT_ENTITY_TYPE = 'attendance_records';

/**
 * ManualAttendanceService (UC-B21) — phần GHI điểm danh thủ công.
 * Mirror data-access của read-side (`attendance.service.ts`): TypeORM `@InjectRepository`,
 * ném lỗi `new <Http>Exception({ message, error: 'CODE' })`. KHÔNG sửa read-side/cột entity.
 */

/** Host/Thư ký được sửa điểm danh tới 24 giờ sau giờ kết thúc cuộc họp. */
const ATTENDANCE_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000;
@Injectable()
export class ManualAttendanceService {
  private readonly logger = new Logger(ManualAttendanceService.name);

  constructor(
    @InjectRepository(MeetingEntity)
    private readonly meetingRepo: Repository<MeetingEntity>,
    @InjectRepository(MeetingParticipantEntity)
    private readonly participantRepo: Repository<MeetingParticipantEntity>,
    @InjectRepository(AttendanceRecordEntity)
    private readonly attendanceRecordRepo: Repository<AttendanceRecordEntity>,
    private readonly auditLogs: AuditLogsService,
    private readonly authzRead: AuthzReadRepository,
    private readonly configService: ConfigService,
  ) {}

  // ===== Endpoint #1: tạo bản ghi thủ công =====
  async createManual(
    meetingId: string,
    dto: CreateManualAttendanceDto,
    actorUserId: string,
  ): Promise<ManualAttendanceResponseDto> {
    const meeting = await this.loadMeetingAndGate(meetingId);
    await this.assertHostOrAdmin(meeting, actorUserId);

    // user phải là internal participant (invitation_status ≠ declined) — 422.
    const participant = await this.participantRepo.findOne({
      where: {
        meetingId,
        userId: dto.userId,
        invitationStatus: Not(InvitationStatus.DECLINED),
      },
    });
    if (!participant) {
      throw new UnprocessableEntityException({
        message: 'User is not a participant of this meeting',
        error: 'USER_NOT_PARTICIPANT',
      });
    }

    // pre-check trùng (meetingId,userId) mọi nguồn — 409 (FR-002).
    const existing = await this.attendanceRecordRepo.findOne({
      where: { meetingId, userId: dto.userId },
    });
    if (existing) {
      throw new ConflictException({
        message:
          'Attendance record already exists for this user in this meeting',
        error: 'ATTENDANCE_RECORD_EXISTS',
      });
    }

    const now = new Date();
    const checkInTime = dto.checkInTime ? new Date(dto.checkInTime) : now;
    // Cùng nguồn ân hạn với FaceAttendanceService (camera) — xem
    // get-late-grace-minutes.util.ts, tránh 2 luồng tính isLate lệch nhau.
    const graceMinutes = await getAttendanceLateGraceMinutes(
      this.attendanceRecordRepo.manager,
      this.configService,
    );
    const flags = computeLateFlags(
      checkInTime,
      meeting.startTime,
      null,
      meeting.endTime,
      graceMinutes,
    );

    const record = this.attendanceRecordRepo.create({
      meetingId,
      userId: dto.userId,
      participantId: participant.id,
      checkInMethod: CheckInMethod.MANUAL,
      attendanceSource: AttendanceSource.MANUAL,
      checkInTime,
      checkOutTime: null,
      isLate: flags.isLate,
      lateMinutes: flags.lateMinutes,
      leftEarly: flags.leftEarly,
      attendanceStatus: this.deriveStatus(flags),
      verifiedBy: actorUserId,
      verifiedAt: now,
      note: dto.note ?? null,
    });
    const saved = await this.attendanceRecordRepo.save(record);

    await this.writeAudit({
      userId: actorUserId,
      actionType: 'create_manual_attendance',
      entityType: AUDIT_ENTITY_TYPE,
      entityId: saved.id,
      metadataJson: {
        meetingId,
        userId: dto.userId,
        recordId: saved.id,
        actorUserId,
        source: 'manual',
        checkInTime: checkInTime.toISOString(),
      },
    });

    return toManualAttendanceResponse(saved);
  }

  // ===== Endpoint #2: cập nhật trạng thái =====
  async updateStatus(
    meetingId: string,
    recordId: string,
    dto: UpdateAttendanceStatusDto,
    actorUserId: string,
  ): Promise<ManualAttendanceResponseDto> {
    const meeting = await this.loadMeetingAndGate(meetingId);
    await this.assertHostOrAdmin(meeting, actorUserId);

    // Defensive (FR-005): không cho đặt invalidated qua endpoint này.
    if (
      (dto.attendanceStatus as string) ===
      (AttendanceRecordStatus.INVALIDATED as string)
    ) {
      throw new BadRequestException({
        message:
          'Cannot set status to invalidated here; use the invalidate endpoint',
        error: 'INVALID_STATUS',
      });
    }

    // Về sớm do chủ trì/thư ký ghi tay: bắt buộc ghi chú (quy định điểm danh dòng 4).
    const reason = dto.reason?.trim() ?? '';
    if (
      (dto.attendanceStatus as string) === (AttendanceRecordStatus.LEFT_EARLY as string) &&
      reason.length === 0
    ) {
      throw new BadRequestException({
        message: 'Vui lòng nhập ghi chú khi ghi nhận Về sớm',
        error: 'NOTE_REQUIRED',
      });
    }

    const record = await this.loadRecord(meetingId, recordId);
    const fromStatus = record.attendanceStatus;
    if (reason) record.note = reason;
    record.attendanceStatus = dto.attendanceStatus as AttendanceRecordStatus;
    if (dto.violationRuleCode !== undefined) {
      record.violationRuleCode = await this.resolveViolationRuleCode(
        dto.violationRuleCode,
      );
    }
    const saved = await this.attendanceRecordRepo.save(record);

    await this.writeAudit({
      userId: actorUserId,
      actionType: 'update_attendance_status',
      entityType: AUDIT_ENTITY_TYPE,
      entityId: saved.id,
      metadataJson: {
        recordId: saved.id,
        meetingId,
        fromStatus,
        toStatus: saved.attendanceStatus,
        reason: dto.reason ?? null,
        actorUserId,
      },
    });

    return toManualAttendanceResponse(saved);
  }

  // ===== Endpoint #3: chỉnh hồ sơ (check-in/out/note) =====
  async updateProfile(
    meetingId: string,
    recordId: string,
    dto: UpdateAttendanceProfileDto,
    actorUserId: string,
  ): Promise<ManualAttendanceResponseDto> {
    const meeting = await this.loadMeetingAndGate(meetingId);
    await this.assertHostOrAdmin(meeting, actorUserId);

    const record = await this.loadRecord(meetingId, recordId);

    const newCheckIn = dto.checkInTime
      ? new Date(dto.checkInTime)
      : record.checkInTime;
    const newCheckOut = dto.checkOutTime
      ? new Date(dto.checkOutTime)
      : record.checkOutTime;

    if (
      newCheckIn &&
      newCheckOut &&
      newCheckOut.getTime() < newCheckIn.getTime()
    ) {
      throw new UnprocessableEntityException({
        message: 'checkOutTime cannot be earlier than checkInTime',
        error: 'INVALID_TIME_RANGE',
      });
    }

    const changedFields: string[] = [];
    if (dto.checkInTime !== undefined) {
      record.checkInTime = newCheckIn;
      changedFields.push('checkInTime');
    }
    if (dto.checkOutTime !== undefined) {
      record.checkOutTime = newCheckOut;
      changedFields.push('checkOutTime');
    }
    if (dto.note !== undefined) {
      record.note = dto.note;
      changedFields.push('note');
    }

    // Tính lại flags nhưng KHÔNG đổi attendanceStatus (§1.4-9 — desync chủ ý).
    if (newCheckIn) {
      const graceMinutes = await getAttendanceLateGraceMinutes(
        this.attendanceRecordRepo.manager,
        this.configService,
      );
      const earlyLeaveMinutes = await getAttendanceEarlyLeaveMinutes(
        this.attendanceRecordRepo.manager,
      );
      const flags = computeLateFlags(
        newCheckIn,
        meeting.startTime,
        newCheckOut,
        meeting.endTime,
        graceMinutes,
        earlyLeaveMinutes,
      );
      record.isLate = flags.isLate;
      record.lateMinutes = flags.lateMinutes;
      record.leftEarly = flags.leftEarly;
    } else {
      record.leftEarly =
        newCheckOut !== null &&
        meeting.endTime !== null &&
        newCheckOut.getTime() < meeting.endTime.getTime();
    }

    const saved = await this.attendanceRecordRepo.save(record);

    await this.writeAudit({
      userId: actorUserId,
      actionType: 'update_attendance_record',
      entityType: AUDIT_ENTITY_TYPE,
      entityId: saved.id,
      metadataJson: {
        recordId: saved.id,
        meetingId,
        changedFields,
        reason: null,
        actorUserId,
      },
    });

    return toManualAttendanceResponse(saved);
  }

  // ===== Endpoint #4: vô hiệu hóa (thứ tự nghiêm ngặt — plan §4.4) =====
  async invalidate(
    meetingId: string,
    recordId: string,
    dto: InvalidateAttendanceDto,
    actorUserId: string,
  ): Promise<ManualAttendanceResponseDto> {
    // (1) load record (+meeting) → 404.
    const record = await this.loadRecord(meetingId, recordId);
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId, deletedAt: IsNull() },
    });
    if (!meeting) {
      throw new NotFoundException({
        message: 'Meeting not found',
        error: 'MEETING_NOT_FOUND',
      });
    }

    // (2) gate trạng thái-meeting → 409.
    this.assertMeetingOpen(meeting);

    // (3) chỉ System Admin → 403.
    const { roles } =
      await this.authzRead.getEffectiveRolesAndPermissions(actorUserId);
    if (!roles.includes(SYSTEM_ADMIN)) {
      throw new ForbiddenException({
        message: 'Only System Admin can invalidate attendance records',
        error: 'PERMISSION_DENIED',
      });
    }

    // (4) thiếu reason → 400.
    if (!dto.reason || dto.reason.trim().length === 0) {
      throw new BadRequestException({
        message: 'reason is required to invalidate an attendance record',
        error: 'REASON_REQUIRED',
      });
    }

    // (5) đã INVALIDATED → 409.
    if (record.attendanceStatus === AttendanceRecordStatus.INVALIDATED) {
      throw new ConflictException({
        message: 'Attendance record is already invalidated',
        error: 'ALREADY_INVALIDATED',
      });
    }

    // (6) set INVALIDATED (giữ row).
    const previousStatus = record.attendanceStatus;
    record.attendanceStatus = AttendanceRecordStatus.INVALIDATED;
    const saved = await this.attendanceRecordRepo.save(record);

    await this.writeAudit({
      userId: actorUserId,
      actionType: 'invalidate_attendance',
      entityType: AUDIT_ENTITY_TYPE,
      entityId: saved.id,
      metadataJson: {
        recordId: saved.id,
        meetingId,
        previousStatus,
        attendanceSource: saved.attendanceSource,
        reason: dto.reason,
        actorUserId,
      },
    });

    return toManualAttendanceResponse(saved);
  }

  // ===== Helpers =====

  /** Load meeting (404) + meeting-status gate (409). Mirror read-side validateAndGetMeeting. */
  /** Hình thức thư ký chọn tay phải tồn tại + đang bật; null/'' = bỏ chọn (suy từ trạng thái). */
  private async resolveViolationRuleCode(
    code: string | null,
  ): Promise<string | null> {
    if (!code) return null;
    const rows: Array<{ rule_code: string }> =
      await this.attendanceRecordRepo.manager.query(
        `SELECT rule_code FROM attendance_violation_rules WHERE rule_code = $1 AND is_active = true LIMIT 1`,
        [code],
      );
    if (!rows.length) {
      throw new BadRequestException({
        message: 'Hình thức vi phạm không tồn tại hoặc đã tắt',
        error: 'INVALID_VIOLATION_RULE',
      });
    }
    return rows[0].rule_code;
  }

  private async loadMeetingAndGate(meetingId: string): Promise<MeetingEntity> {
    const meeting = await this.meetingRepo.findOne({
      where: { id: meetingId, deletedAt: IsNull() },
    });
    if (!meeting) {
      throw new NotFoundException({
        message: 'Meeting not found',
        error: 'MEETING_NOT_FOUND',
      });
    }
    if (meeting.attendanceEnabled === false) {
      throw new BadRequestException({
        message: 'Cuộc họp này không bật điểm danh',
        error: 'ATTENDANCE_DISABLED',
      });
    }
    this.assertMeetingOpen(meeting);
    return meeting;
  }

  /**
   * Gate trạng thái meeting → 409 ATTENDANCE_NOT_OPEN_YET.
   *
   * [2026-08-22] BỎ điều kiện `now < meeting.startTime`. Điểm danh thủ công
   * TRƯỚC giờ họp là hợp lệ (Host mở phòng sớm, chốt danh sách trước) — và
   * computeLateFlags() vốn đã tính đúng: checkInTime <= startTime ⇒
   * isLate=false, lateMinutes=0 ⇒ deriveStatus() trả "có mặt đúng giờ".
   * KHÔNG đụng tới luồng điểm danh khuôn mặt/IoT: FaceAttendanceService có
   * cửa sổ thời gian riêng (POST_GRACE_MINUTES / DEFAULT_LATE_GRACE_MINUTES)
   * và không gọi hàm này.
   */
  private assertMeetingOpen(meeting: MeetingEntity): void {
    const allowed: MeetingStatus[] = [
      MeetingStatus.SCHEDULED,
      MeetingStatus.IN_PROGRESS,
      MeetingStatus.COMPLETED,
    ];
    if (!allowed.includes(meeting.status)) {
      throw new ConflictException({
        message: 'Meeting is not in a state that allows manual attendance',
        error: 'ATTENDANCE_NOT_OPEN_YET',
      });
    }
  }

  /**
   * Ownership-check (§4.5): SYSTEM_ADMIN/BUSINESS_ADMIN bypass; else phải là Host hoặc Thư ký
   * của meeting. Host/Thư ký chỉ sửa được tới 24 giờ sau giờ kết thúc (409 ATTENDANCE_LOCKED).
   */
  private async assertHostOrAdmin(
    meeting: MeetingEntity,
    actorUserId: string,
  ): Promise<void> {
    const { roles } =
      await this.authzRead.getEffectiveRolesAndPermissions(actorUserId);
    if (roles.includes(SYSTEM_ADMIN) || roles.includes(BUSINESS_ADMIN)) {
      return;
    }
    const lockAt = new Date(meeting.endTime).getTime() + ATTENDANCE_EDIT_WINDOW_MS;
    if (Date.now() > lockAt) {
      throw new ConflictException({
        message: 'Đã quá 24 giờ sau khi cuộc họp kết thúc, không thể sửa điểm danh',
        error: 'ATTENDANCE_LOCKED',
      });
    }
    if (meeting.hostId && meeting.hostId === actorUserId) {
      return;
    }
    if (meeting.secretaryId && meeting.secretaryId === actorUserId) {
      return;
    }
    // Host theo participant_role='host' (spec mô tả host) — fallback.
    const hostParticipant = await this.participantRepo.findOne({
      where: {
        meetingId: meeting.id,
        userId: actorUserId,
        participantRole: ParticipantRole.HOST,
        invitationStatus: Not(InvitationStatus.DECLINED),
      },
    });
    if (hostParticipant) {
      return;
    }
    throw new ForbiddenException({
      message:
        'You do not have permission to manage attendance for this meeting',
      error: 'PERMISSION_DENIED',
    });
  }

  /** Load attendance record theo (recordId, meetingId) → 404 ATTENDANCE_RECORD_NOT_FOUND. */
  private async loadRecord(
    meetingId: string,
    recordId: string,
  ): Promise<AttendanceRecordEntity> {
    const record = await this.attendanceRecordRepo.findOne({
      where: { id: recordId, meetingId },
    });
    if (!record) {
      throw new NotFoundException({
        message: 'Attendance record not found',
        error: 'ATTENDANCE_RECORD_NOT_FOUND',
      });
    }
    return record;
  }

  /** Suy attendanceStatus khi tạo: left_early > late > present (spec §5.3). */
  private deriveStatus(flags: {
    isLate: boolean;
    leftEarly: boolean;
  }): AttendanceRecordStatus {
    if (flags.leftEarly) return AttendanceRecordStatus.LEFT_EARLY;
    if (flags.isLate) return AttendanceRecordStatus.LATE;
    return AttendanceRecordStatus.PRESENT;
  }

  /** Audit non-blocking (AC-012): lỗi audit chỉ log internal, KHÔNG fail request. */
  private async writeAudit(
    dto: Parameters<AuditLogsService['logAction']>[0],
  ): Promise<void> {
    try {
      await this.auditLogs.logAction(dto);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(
        `[ManualAttendance] audit write failed (non-blocking): ${message}`,
      );
    }
  }
}
