/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-assignment */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ManualAttendanceService } from '../services/manual-attendance.service.js';
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

// Cột hợp lệ của attendance_records (AC-013: chỉ set field/enum sẵn có).
const ALLOWED_ENTITY_FIELDS = new Set([
  'id',
  'meetingId',
  'participantId',
  'userId',
  'checkInMethod',
  'attendanceSource',
  'checkInTime',
  'checkOutTime',
  'firstDetectedAt',
  'lastDetectedAt',
  'isPresent',
  'isLate',
  'leftEarly',
  'lateMinutes',
  'presenceDurationMinutes',
  'confidenceScore',
  'attendanceStatus',
  'verifiedBy',
  'verifiedAt',
  'note',
  'createdAt',
  'updatedAt',
]);

const HOST_ID = 'host-uuid';
const ACTOR_HOST = HOST_ID;
const ACTOR_ADMIN = 'admin-uuid';
const TARGET_USER = 'participant-uuid';

const past = (iso = '2020-01-01T09:00:00Z') => new Date(iso);

/** Assert promise rejects với đúng Exception type + error code (qua getResponse()). */
async function expectErr(
  p: Promise<unknown>,
  Type: new (...a: never[]) => Error,
  code: string,
): Promise<void> {
  await p.then(
    () => {
      throw new Error(`Expected rejection with ${Type.name}/${code}`);
    },
    (e: unknown) => {
      expect(e).toBeInstanceOf(Type);
      const body = (e as { getResponse: () => unknown }).getResponse();
      expect((body as { error?: string }).error).toBe(code);
    },
  );
}

describe('ManualAttendanceService (UC-B21)', () => {
  let service: ManualAttendanceService;
  let meetingRepo: jest.Mocked<Repository<MeetingEntity>>;
  let participantRepo: jest.Mocked<Repository<MeetingParticipantEntity>>;
  let attendanceRepo: jest.Mocked<Repository<AttendanceRecordEntity>>;
  let auditLogs: jest.Mocked<AuditLogsService>;
  let authzRead: jest.Mocked<AuthzReadRepository>;
  let configService: { get: jest.Mock };
  let attendanceManagerQuery: jest.Mock;

  const makeMeeting = (over: Partial<MeetingEntity> = {}): MeetingEntity =>
    ({
      id: 'meeting-uuid-1',
      status: MeetingStatus.IN_PROGRESS,
      startTime: past('2020-01-01T09:00:00Z'),
      endTime: past('2020-01-01T10:00:00Z'),
      organizerId: 'organizer-uuid',
      hostId: HOST_ID,
      deletedAt: null,
      ...over,
    }) as MeetingEntity;

  const makeParticipant = (
    over: Partial<MeetingParticipantEntity> = {},
  ): MeetingParticipantEntity =>
    ({
      id: 'participant-row-1',
      meetingId: 'meeting-uuid-1',
      userId: TARGET_USER,
      participantRole: ParticipantRole.ATTENDEE,
      invitationStatus: InvitationStatus.ACCEPTED,
      ...over,
    }) as MeetingParticipantEntity;

  const makeRecord = (
    over: Partial<AttendanceRecordEntity> = {},
  ): AttendanceRecordEntity =>
    ({
      id: 'record-uuid-1',
      meetingId: 'meeting-uuid-1',
      userId: TARGET_USER,
      participantId: 'participant-row-1',
      checkInMethod: CheckInMethod.MANUAL,
      attendanceSource: AttendanceSource.MANUAL,
      checkInTime: past('2020-01-01T09:00:00Z'),
      checkOutTime: null,
      isLate: false,
      lateMinutes: 0,
      leftEarly: false,
      attendanceStatus: AttendanceRecordStatus.PRESENT,
      verifiedBy: ACTOR_HOST,
      verifiedAt: past('2020-01-01T09:00:00Z'),
      note: null,
      createdAt: past('2020-01-01T09:00:00Z'),
      updatedAt: past('2020-01-01T09:00:00Z'),
      ...over,
    }) as AttendanceRecordEntity;

  beforeEach(async () => {
    const repoMock = () => ({
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    });
    // manager.query của attendanceRecordRepo — dùng bởi getAttendanceLateGraceMinutes()
    // (đọc system_configs['attendance.late_grace_minutes']). Mặc định resolve [] (không có
    // dòng nào — khớp trạng thái DB thật hiện tại), khiến hàm fallback về configService.get().
    attendanceManagerQuery = jest.fn().mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ManualAttendanceService,
        { provide: getRepositoryToken(MeetingEntity), useValue: repoMock() },
        {
          provide: getRepositoryToken(MeetingParticipantEntity),
          useValue: repoMock(),
        },
        {
          provide: getRepositoryToken(AttendanceRecordEntity),
          useValue: {
            ...repoMock(),
            manager: { query: attendanceManagerQuery },
          },
        },
        {
          provide: AuditLogsService,
          useValue: { logAction: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: AuthzReadRepository,
          useValue: {
            getEffectiveRolesAndPermissions: jest
              .fn()
              .mockResolvedValue({ roles: ['INTERNAL_USER'], permissions: [] }),
          },
        },
        {
          // Fallback no-grace mặc định (0) — giữ nguyên hành vi mọi test cũ.
          // Test riêng cho grace>0 override bằng configService.get.mockReturnValueOnce(15).
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(0) },
        },
      ],
    }).compile();

    service = module.get(ManualAttendanceService);
    meetingRepo = module.get(getRepositoryToken(MeetingEntity));
    participantRepo = module.get(getRepositoryToken(MeetingParticipantEntity));
    attendanceRepo = module.get(getRepositoryToken(AttendanceRecordEntity));
    auditLogs = module.get(AuditLogsService);
    authzRead = module.get(AuthzReadRepository);
    configService = module.get(ConfigService);

    // Default: create echoes arg (+ id/timestamps); save echoes arg.
    attendanceRepo.create.mockImplementation(
      (e) =>
        ({
          id: 'new-record',
          createdAt: past(),
          updatedAt: past(),
          ...e,
        }) as AttendanceRecordEntity,
    );
    attendanceRepo.save.mockImplementation((e) =>
      Promise.resolve(e as AttendanceRecordEntity),
    );
  });

  const asHost = () =>
    authzRead.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['INTERNAL_USER'],
      permissions: [],
    });
  const asRoles = (roles: string[]) =>
    authzRead.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles,
      permissions: [],
    });

  // ============ createManual ============
  describe('createManual', () => {
    it('AC-001 happy: tạo bản ghi source=manual, method=manual, verifiedBy=actor, status present đúng giờ', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      participantRepo.findOne.mockResolvedValue(makeParticipant());
      attendanceRepo.findOne.mockResolvedValue(null);

      const res = await service.createManual(
        'meeting-uuid-1',
        { userId: TARGET_USER, checkInTime: '2020-01-01T09:00:00Z' }, // == startTime → đúng giờ
        ACTOR_HOST,
      );

      expect(res.attendanceSource).toBe(AttendanceSource.MANUAL);
      expect(res.checkInMethod).toBe(CheckInMethod.MANUAL);
      expect(res.verifiedBy).toBe(ACTOR_HOST);
      expect(res.attendanceStatus).toBe(AttendanceRecordStatus.PRESENT);
      expect(res.isLate).toBe(false);
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'create_manual_attendance' }),
      );
    });

    it('AC-002 trễ: checkInTime > start → status late, lateMinutes>=1', async () => {
      asHost();
      const meeting = makeMeeting({
        startTime: new Date('2026-06-30T09:00:00Z'),
      });
      // gate cần now>=start → đặt meeting start ở quá khứ gần nhưng checkIn trễ hơn start
      meeting.startTime = past('2020-01-01T09:00:00Z');
      meetingRepo.findOne.mockResolvedValue(meeting);
      participantRepo.findOne.mockResolvedValue(makeParticipant());
      attendanceRepo.findOne.mockResolvedValue(null);

      const res = await service.createManual(
        'meeting-uuid-1',
        { userId: TARGET_USER, checkInTime: '2020-01-01T09:02:30Z' },
        ACTOR_HOST,
      );
      expect(res.attendanceStatus).toBe(AttendanceRecordStatus.LATE);
      expect(res.isLate).toBe(true);
      expect(res.lateMinutes).toBe(3);
    });

    // [2026-08-22] Đồng bộ ân hạn đi muộn với FaceAttendanceService (camera) —
    // computeLateFlags() giờ nhận graceMinutes từ getAttendanceLateGraceMinutes(),
    // cùng nguồn system_configs['attendance.late_grace_minutes'] mà camera đọc.
    describe('đồng bộ grace period với FaceAttendanceService (camera)', () => {
      it('grace=15 (từ system_configs), trễ 10 phút (trong ân hạn) → present, isLate=false', async () => {
        asHost();
        const meeting = makeMeeting({ startTime: past('2020-01-01T09:00:00Z') });
        meetingRepo.findOne.mockResolvedValue(meeting);
        participantRepo.findOne.mockResolvedValue(makeParticipant());
        attendanceRepo.findOne.mockResolvedValue(null);
        attendanceManagerQuery.mockResolvedValueOnce([{ config_value: '15' }]);

        const res = await service.createManual(
          'meeting-uuid-1',
          { userId: TARGET_USER, checkInTime: '2020-01-01T09:10:00Z' },
          ACTOR_HOST,
        );
        expect(res.isLate).toBe(false);
        expect(res.lateMinutes).toBe(0);
        expect(res.attendanceStatus).toBe(AttendanceRecordStatus.PRESENT);
      });

      it('grace=15 (từ system_configs), trễ 20 phút (vượt ân hạn) → late, isLate=true', async () => {
        asHost();
        const meeting = makeMeeting({ startTime: past('2020-01-01T09:00:00Z') });
        meetingRepo.findOne.mockResolvedValue(meeting);
        participantRepo.findOne.mockResolvedValue(makeParticipant());
        attendanceRepo.findOne.mockResolvedValue(null);
        attendanceManagerQuery.mockResolvedValueOnce([{ config_value: '15' }]);

        const res = await service.createManual(
          'meeting-uuid-1',
          { userId: TARGET_USER, checkInTime: '2020-01-01T09:20:00Z' },
          ACTOR_HOST,
        );
        expect(res.isLate).toBe(true);
        expect(res.lateMinutes).toBe(20);
        expect(res.attendanceStatus).toBe(AttendanceRecordStatus.LATE);
      });

      it('system_configs chưa có dòng nào (mảng rỗng) → fallback ConfigService.get, không throw', async () => {
        asHost();
        const meeting = makeMeeting({ startTime: past('2020-01-01T09:00:00Z') });
        meetingRepo.findOne.mockResolvedValue(meeting);
        participantRepo.findOne.mockResolvedValue(makeParticipant());
        attendanceRepo.findOne.mockResolvedValue(null);
        // attendanceManagerQuery mặc định resolve [] (từ beforeEach) — mô phỏng đúng
        // trạng thái DB thật hiện tại (chưa ai lưu config này qua SystemSettings).
        configService.get.mockReturnValueOnce(15);

        const res = await service.createManual(
          'meeting-uuid-1',
          { userId: TARGET_USER, checkInTime: '2020-01-01T09:10:00Z' },
          ACTOR_HOST,
        );
        expect(configService.get).toHaveBeenCalledWith(
          'ATTENDANCE_LATE_GRACE_MINUTES',
          0,
        );
        expect(res.isLate).toBe(false); // grace 15 (fallback) > trễ 10 phút
      });
    });

    it('AC-006 422: user không phải participant', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      participantRepo.findOne.mockResolvedValue(null);
      await expectErr(
        service.createManual(
          'meeting-uuid-1',
          { userId: TARGET_USER },
          ACTOR_HOST,
        ),
        UnprocessableEntityException,
        'USER_NOT_PARTICIPANT',
      );
    });

    it('AC-007 409: đã tồn tại bản ghi (meeting,user)', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      participantRepo.findOne.mockResolvedValue(makeParticipant());
      attendanceRepo.findOne.mockResolvedValue(makeRecord());
      await expectErr(
        service.createManual(
          'meeting-uuid-1',
          { userId: TARGET_USER },
          ACTOR_HOST,
        ),
        ConflictException,
        'ATTENDANCE_RECORD_EXISTS',
      );
    });

    it('AC-004/ERR-004 404: meeting không tồn tại / soft-deleted', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(null);
      await expectErr(
        service.createManual(
          'meeting-uuid-1',
          { userId: TARGET_USER },
          ACTOR_HOST,
        ),
        NotFoundException,
        'MEETING_NOT_FOUND',
      );
    });

    // [2026-08-22] Doi hanh vi co y: gate `now < startTime` da bo. Diem danh
    // thu cong TRUOC gio hop la hop le (Host mo phong som / chot danh sach
    // truoc), va computeLateFlags van tinh dung gio. Test nay gio khang dinh
    // KHONG con nem ATTENDANCE_NOT_OPEN_YET — request di tiep xuong cac buoc
    // validate sau (o day: user chua phai participant → 422).
    it('AC-014/ERR-012: meeting tương lai (now<start) KHÔNG còn bị chặn bởi ATTENDANCE_NOT_OPEN_YET', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(
        makeMeeting({
          startTime: new Date(Date.now() + 60 * 60 * 1000),
          status: MeetingStatus.SCHEDULED,
        }),
      );
      await expectErr(
        service.createManual(
          'meeting-uuid-1',
          { userId: TARGET_USER },
          ACTOR_HOST,
        ),
        UnprocessableEntityException,
        'USER_NOT_PARTICIPANT',
      );
    });

    it('AC-013: chỉ set field/enum sẵn có (không tạo field lạ)', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      participantRepo.findOne.mockResolvedValue(makeParticipant());
      attendanceRepo.findOne.mockResolvedValue(null);

      await service.createManual(
        'meeting-uuid-1',
        { userId: TARGET_USER, note: 'manual' },
        ACTOR_HOST,
      );
      const created = attendanceRepo.create.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      for (const key of Object.keys(created)) {
        expect(ALLOWED_ENTITY_FIELDS.has(key)).toBe(true);
      }
    });

    it('AC-012 audit non-blocking: logAction ném lỗi → vẫn tạo thành công', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      participantRepo.findOne.mockResolvedValue(makeParticipant());
      attendanceRepo.findOne.mockResolvedValue(null);
      auditLogs.logAction.mockRejectedValueOnce(new Error('audit down'));
      const res = await service.createManual(
        'meeting-uuid-1',
        { userId: TARGET_USER },
        ACTOR_HOST,
      );
      expect(res.id).toBeDefined();
    });
  });

  // ============ Ownership (§4.5) ============
  describe('ownership-check', () => {
    it('AC-009 403: Host không sở hữu meeting (không host-participant) → PERMISSION_DENIED', async () => {
      asRoles(['INTERNAL_USER']);
      meetingRepo.findOne.mockResolvedValue(
        makeMeeting({ hostId: 'someone-else' }),
      );
      participantRepo.findOne.mockResolvedValue(null); // fallback host-participant: none
      await expectErr(
        service.createManual(
          'meeting-uuid-1',
          { userId: TARGET_USER },
          'not-the-host',
        ),
        ForbiddenException,
        'PERMISSION_DENIED',
      );
    });

    it('AC-009 BUSINESS_ADMIN bypass ownership → tạo thành công dù không phải host', async () => {
      asRoles(['BUSINESS_ADMIN']);
      meetingRepo.findOne.mockResolvedValue(
        makeMeeting({ hostId: 'someone-else' }),
      );
      participantRepo.findOne.mockResolvedValue(makeParticipant());
      attendanceRepo.findOne.mockResolvedValue(null);
      const res = await service.createManual(
        'meeting-uuid-1',
        { userId: TARGET_USER },
        ACTOR_ADMIN,
      );
      expect(res.id).toBeDefined();
    });

    it('SYSTEM_ADMIN bypass ownership → tạo thành công', async () => {
      asRoles(['SYSTEM_ADMIN']);
      meetingRepo.findOne.mockResolvedValue(
        makeMeeting({ hostId: 'someone-else' }),
      );
      participantRepo.findOne.mockResolvedValue(makeParticipant());
      attendanceRepo.findOne.mockResolvedValue(null);
      const res = await service.createManual(
        'meeting-uuid-1',
        { userId: TARGET_USER },
        ACTOR_ADMIN,
      );
      expect(res.id).toBeDefined();
    });
  });

  // ============ updateStatus ============
  describe('updateStatus', () => {
    it('AC-003 happy: đổi status absent→late', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      attendanceRepo.findOne.mockResolvedValue(
        makeRecord({ attendanceStatus: AttendanceRecordStatus.ABSENT }),
      );
      const res = await service.updateStatus(
        'meeting-uuid-1',
        'record-uuid-1',
        { attendanceStatus: 'late' },
        ACTOR_HOST,
      );
      expect(res.attendanceStatus).toBe(AttendanceRecordStatus.LATE);
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'update_attendance_status',
          metadataJson: expect.objectContaining({
            fromStatus: AttendanceRecordStatus.ABSENT,
            toStatus: 'late',
          }),
        }),
      );
    });

    it('AC-005/FR-005 400: chặn set status=invalidated qua endpoint này', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      await expectErr(
        service.updateStatus(
          'meeting-uuid-1',
          'record-uuid-1',
          { attendanceStatus: 'invalidated' as never },
          ACTOR_HOST,
        ),
        BadRequestException,
        'INVALID_STATUS',
      );
    });

    it('ERR-005 404: record không tồn tại / không thuộc meeting', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      attendanceRepo.findOne.mockResolvedValue(null);
      await expectErr(
        service.updateStatus(
          'meeting-uuid-1',
          'record-uuid-1',
          { attendanceStatus: 'present' },
          ACTOR_HOST,
        ),
        Error,
        'ATTENDANCE_RECORD_NOT_FOUND',
      );
    });
  });

  // ============ updateProfile ============
  describe('updateProfile', () => {
    it('AC-008 tính lại flags nhưng KHÔNG đổi attendanceStatus (desync §1.4-9)', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      const record = makeRecord({
        attendanceStatus: AttendanceRecordStatus.PRESENT,
        isLate: false,
      });
      attendanceRepo.findOne.mockResolvedValue(record);

      const res = await service.updateProfile(
        'meeting-uuid-1',
        'record-uuid-1',
        { checkInTime: '2020-01-01T09:05:00Z' },
        ACTOR_HOST,
      );
      expect(res.isLate).toBe(true);
      expect(res.lateMinutes).toBe(5);
      expect(res.attendanceStatus).toBe(AttendanceRecordStatus.PRESENT); // KHÔNG đổi
    });

    it('[2026-08-22] updateProfile cũng đọc grace period (system_configs) — trong ân hạn → isLate=false, attendanceStatus vẫn KHÔNG đổi (desync chủ ý §1.4-9 giữ nguyên)', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      const record = makeRecord({
        attendanceStatus: AttendanceRecordStatus.PRESENT,
        isLate: false,
      });
      attendanceRepo.findOne.mockResolvedValue(record);
      attendanceManagerQuery.mockResolvedValueOnce([{ config_value: '15' }]);

      const res = await service.updateProfile(
        'meeting-uuid-1',
        'record-uuid-1',
        { checkInTime: '2020-01-01T09:05:00Z' }, // trễ 5 phút, trong ân hạn 15 phút
        ACTOR_HOST,
      );
      expect(res.isLate).toBe(false);
      expect(res.lateMinutes).toBe(0);
      expect(res.attendanceStatus).toBe(AttendanceRecordStatus.PRESENT); // vẫn KHÔNG đổi, chỉ công thức isLate đổi
    });

    it('AC-011/ERR-011 422: checkOutTime < checkInTime → INVALID_TIME_RANGE', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      attendanceRepo.findOne.mockResolvedValue(
        makeRecord({ checkInTime: past('2020-01-01T09:30:00Z') }),
      );
      await expectErr(
        service.updateProfile(
          'meeting-uuid-1',
          'record-uuid-1',
          { checkOutTime: '2020-01-01T09:10:00Z' },
          ACTOR_HOST,
        ),
        UnprocessableEntityException,
        'INVALID_TIME_RANGE',
      );
    });

    it('leftEarly=true khi checkOutTime < end_time quá mốc về sớm (15p), audit changedFields', async () => {
      asHost();
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      attendanceRepo.findOne.mockResolvedValue(makeRecord());
      const res = await service.updateProfile(
        'meeting-uuid-1',
        'record-uuid-1',
        { checkOutTime: '2020-01-01T09:40:00Z' },
        ACTOR_HOST,
      );
      expect(res.leftEarly).toBe(true);
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'update_attendance_record',
          metadataJson: expect.objectContaining({
            changedFields: ['checkOutTime'],
          }),
        }),
      );
    });
  });

  // ============ invalidate — TỪNG BẬC (404 → 409 gate → 403 → 400 → 409 already) ============
  describe('invalidate (thứ tự nghiêm ngặt — mỗi bậc 1 case)', () => {
    it('Bậc 1 — 404: record null → ATTENDANCE_RECORD_NOT_FOUND', async () => {
      attendanceRepo.findOne.mockResolvedValue(null);
      await expectErr(
        service.invalidate(
          'meeting-uuid-1',
          'record-uuid-1',
          { reason: 'x' },
          'sysadmin',
        ),
        NotFoundException,
        'ATTENDANCE_RECORD_NOT_FOUND',
      );
    });

    // [2026-08-22] Xem chu thich o createManual: gate thoi gian da bo, nen
    // meeting tuong lai khong con dung o bac 2 ma di tiep xuong bac quyen.
    it('Bậc 2 — meeting tương lai KHÔNG còn bị chặn, đi tiếp xuống gate quyền', async () => {
      attendanceRepo.findOne.mockResolvedValue(makeRecord());
      meetingRepo.findOne.mockResolvedValue(
        makeMeeting({
          startTime: new Date(Date.now() + 60 * 60 * 1000),
          status: MeetingStatus.SCHEDULED,
        }),
      );
      await expectErr(
        service.invalidate(
          'meeting-uuid-1',
          'record-uuid-1',
          { reason: 'x' },
          'sysadmin',
        ),
        ForbiddenException,
        'PERMISSION_DENIED',
      );
    });

    it('Bậc 3 — 403: record OK + actor KHÔNG SYSTEM_ADMIN (kể cả BUSINESS_ADMIN) → PERMISSION_DENIED', async () => {
      attendanceRepo.findOne.mockResolvedValue(makeRecord());
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      asRoles(['BUSINESS_ADMIN']); // BUSINESS_ADMIN KHÔNG được invalidate
      await expectErr(
        service.invalidate(
          'meeting-uuid-1',
          'record-uuid-1',
          { reason: 'x' },
          'biz-admin',
        ),
        ForbiddenException,
        'PERMISSION_DENIED',
      );
    });

    it('Bậc 4 — 400: record OK + SYSTEM_ADMIN + thiếu reason → REASON_REQUIRED', async () => {
      attendanceRepo.findOne.mockResolvedValue(makeRecord());
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      asRoles(['SYSTEM_ADMIN']);
      await expectErr(
        service.invalidate(
          'meeting-uuid-1',
          'record-uuid-1',
          { reason: '   ' },
          'sysadmin',
        ),
        BadRequestException,
        'REASON_REQUIRED',
      );
    });

    it('Bậc 5 — 409 already: record đã INVALIDATED → ALREADY_INVALIDATED', async () => {
      attendanceRepo.findOne.mockResolvedValue(
        makeRecord({ attendanceStatus: AttendanceRecordStatus.INVALIDATED }),
      );
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      asRoles(['SYSTEM_ADMIN']);
      await expectErr(
        service.invalidate(
          'meeting-uuid-1',
          'record-uuid-1',
          { reason: 'dup' },
          'sysadmin',
        ),
        ConflictException,
        'ALREADY_INVALIDATED',
      );
    });

    it('Bậc 6 — happy: set INVALIDATED (giữ row), audit invalidate_attendance', async () => {
      const record = makeRecord({
        attendanceStatus: AttendanceRecordStatus.PRESENT,
      });
      attendanceRepo.findOne.mockResolvedValue(record);
      meetingRepo.findOne.mockResolvedValue(makeMeeting());
      asRoles(['SYSTEM_ADMIN']);
      const res = await service.invalidate(
        'meeting-uuid-1',
        'record-uuid-1',
        { reason: 'mistake' },
        'sysadmin',
      );
      expect(res.attendanceStatus).toBe(AttendanceRecordStatus.INVALIDATED);
      expect(res.id).toBe('record-uuid-1'); // giữ nguyên row (không xóa)
      expect(auditLogs.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          actionType: 'invalidate_attendance',
          metadataJson: expect.objectContaining({
            previousStatus: AttendanceRecordStatus.PRESENT,
            reason: 'mistake',
          }),
        }),
      );
    });
  });
});
