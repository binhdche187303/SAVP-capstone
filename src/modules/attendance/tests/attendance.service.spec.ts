import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { AttendanceService } from '../services/attendance.service.js';
import { AuthzReadRepository } from '../../../modules/auth/repositories/authz-read.repository.js';
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
import {
  AttendanceRecordEntity,
  AttendanceRecordStatus,
} from '../entities/attendance-record.entity.js';
import { QueryAttendanceDto } from '../dto/query-attendance.dto.js';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let meetingRepo: jest.Mocked<Repository<MeetingEntity>>;
  let participantRepo: jest.Mocked<Repository<MeetingParticipantEntity>>;
  let userRepo: jest.Mocked<Repository<UserEntity>>;
  let attendanceRepo: jest.Mocked<Repository<AttendanceRecordEntity>>;
  let authzRead: jest.Mocked<AuthzReadRepository>;

  const mockMeeting = {
    id: 'meeting-uuid-1',
    title: 'Test Meeting',
    status: MeetingStatus.IN_PROGRESS,
    startTime: new Date('2026-06-16T09:00:00Z'),
    endTime: new Date('2026-06-16T10:00:00Z'),
    organizerId: 'organizer-uuid',
    hostId: 'host-uuid',
    roomId: 'room-uuid',
    description: null,
    meetingCode: 'MTG-001',
    meetingType: 'normal',
    meetingMode: 'offline',
    priority: 'normal',
    visibilityLevel: 'internal',
    actualStartTime: null,
    actualEndTime: null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as MeetingEntity;

  const mockParticipant = {
    id: 'participant-uuid-1',
    meetingId: 'meeting-uuid-1',
    userId: 'participant-uuid',
    participantRole: ParticipantRole.ATTENDEE,
    invitationStatus: InvitationStatus.ACCEPTED,
    isRequired: true,
    attendanceRequired: true,
    attendanceStatus: 'not_checked_in',
    joinedAt: null,
    leftAt: null,
    invitedBy: null,
    notes: null,
    responseAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: {
      id: 'participant-uuid',
      fullName: 'Nguyen Van A',
      email: 'nva@company.com',
      employeeCode: 'NV001',
      avatarUrl: null,
      departmentId: null,
      positionTitle: 'Developer',
      directManagerId: null,
      deletedAt: null,
    } as UserEntity,
  } as MeetingParticipantEntity;

  const mockAttendanceRecord = {
    id: 'record-uuid-1',
    meetingId: 'meeting-uuid-1',
    userId: 'participant-uuid',
    participantId: null,
    checkInMethod: 'door_camera',
    attendanceSource: 'camera',
    checkInTime: new Date('2026-06-16T08:55:00Z'),
    checkOutTime: null,
    firstDetectedAt: null,
    lastDetectedAt: null,
    isPresent: true,
    isLate: false,
    leftEarly: false,
    lateMinutes: null,
    presenceDurationMinutes: null,
    confidenceScore: null,
    attendanceStatus: AttendanceRecordStatus.PRESENT,
    verifiedBy: null,
    verifiedAt: null,
    note: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as AttendanceRecordEntity;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttendanceService,
        {
          provide: getRepositoryToken(MeetingEntity),
          useValue: {
            findOne: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(MeetingParticipantEntity),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            // getDirectReportIds tra phòng ban do user làm trưởng phòng — mặc định không có.
            manager: { query: jest.fn().mockResolvedValue([]) },
          },
        },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: {},
        },
        {
          provide: getRepositoryToken(AttendanceRecordEntity),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
        {
          provide: AuthzReadRepository,
          useValue: {
            getEffectiveRolesAndPermissions: jest
              .fn()
              .mockResolvedValue({ roles: [], permissions: [] }),
          },
        },
      ],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
    meetingRepo = module.get(getRepositoryToken(MeetingEntity));
    participantRepo = module.get(getRepositoryToken(MeetingParticipantEntity));
    userRepo = module.get(getRepositoryToken(UserEntity));
    attendanceRepo = module.get(getRepositoryToken(AttendanceRecordEntity));
    authzRead = module.get(AuthzReadRepository);
  });

  // ===== T022: validateAndGetMeeting =====
  describe('validateAndGetMeeting', () => {
    it('should return meeting when found with valid status', async () => {
      meetingRepo.findOne.mockResolvedValue(mockMeeting);
      const result = await service.validateAndGetMeeting('meeting-uuid-1');
      expect(result.id).toBe('meeting-uuid-1');
    });

    it('should throw NotFoundException when meeting not found', async () => {
      meetingRepo.findOne.mockResolvedValue(null);
      await expect(
        service.validateAndGetMeeting('nonexistent'),
      ).rejects.toThrow(NotFoundException);
    });

    // [2026-08-22] Doi hanh vi co y: truoc day meeting tuong lai -> 409
    // ATTENDANCE_NOT_OPEN_YET. Gate do da bo vi Host duoc bat dau hop som,
    // va diem danh truoc gio la hop le (van tinh dung gio).
    it('should ALLOW access when meeting is in the future (gate removed)', async () => {
      const futureMeeting = {
        ...mockMeeting,
        status: MeetingStatus.SCHEDULED,
        startTime: new Date('2099-01-01T00:00:00Z'),
      };
      meetingRepo.findOne.mockResolvedValue(futureMeeting);
      const result = await service.validateAndGetMeeting('meeting-uuid-1');
      expect(result.startTime).toEqual(new Date('2099-01-01T00:00:00Z'));
    });

    it('should still throw ConflictException when meeting status is not allowed', async () => {
      const draftMeeting = {
        ...mockMeeting,
        status: MeetingStatus.PENDING_APPROVAL,
        startTime: new Date('2099-01-01T00:00:00Z'),
      };
      meetingRepo.findOne.mockResolvedValue(draftMeeting);
      await expect(
        service.validateAndGetMeeting('meeting-uuid-1'),
      ).rejects.toThrow(ConflictException);
    });

    it('should allow access when meeting is scheduled and now >= start_time', async () => {
      const scheduledMeeting = {
        ...mockMeeting,
        status: MeetingStatus.SCHEDULED,
        startTime: new Date(),
      };
      meetingRepo.findOne.mockResolvedValue(scheduledMeeting);
      const result = await service.validateAndGetMeeting('meeting-uuid-1');
      expect(result.status).toBe(MeetingStatus.SCHEDULED);
    });
  });

  // ===== T023: checkAccess =====
  describe('checkAccess', () => {
    it('should give full access to organizer', async () => {
      const result = await service.checkAccess(mockMeeting, 'organizer-uuid');
      expect(result.canViewAttendanceSource).toBe(true);
    });

    it('should give full access to host', async () => {
      const result = await service.checkAccess(mockMeeting, 'host-uuid');
      expect(result.canViewAttendanceSource).toBe(true);
    });

    it('should give basic access to participant', async () => {
      participantRepo.findOne.mockResolvedValue(mockParticipant);
      participantRepo.find.mockResolvedValue([mockParticipant]);
      const result = await service.checkAccess(mockMeeting, 'participant-uuid');
      expect(result.canViewAttendanceSource).toBe(false);
    });

    it('should throw ForbiddenException for non-participant without admin', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      participantRepo.find.mockResolvedValue([]);
      await expect(
        service.checkAccess(mockMeeting, 'unknown-user'),
      ).rejects.toThrow(ForbiddenException);
    });

    // [FIX] checkIsAdmin() truoc day luon return false (stub chua lam xong,
    // "Will be enhanced with proper role check") — BUSINESS_ADMIN/SYSTEM_ADMIN
    // khong phai organizer/host/participant/manager cua 1 meeting cu the se bi
    // 403 PERMISSION_DENIED du co @RequirePermissions('attendance.read') o route.
    it('should give full access to BUSINESS_ADMIN even when not organizer/host/participant/manager', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      participantRepo.find.mockResolvedValue([]);
      authzRead.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['BUSINESS_ADMIN'],
        permissions: [],
      });
      const result = await service.checkAccess(mockMeeting, 'ba-user-uuid');
      expect(result.canViewAttendanceSource).toBe(true);
    });

    it('should give full access to SYSTEM_ADMIN even when not organizer/host/participant/manager', async () => {
      participantRepo.findOne.mockResolvedValue(null);
      participantRepo.find.mockResolvedValue([]);
      authzRead.getEffectiveRolesAndPermissions.mockResolvedValue({
        roles: ['SYSTEM_ADMIN'],
        permissions: [],
      });
      const result = await service.checkAccess(mockMeeting, 'sa-user-uuid');
      expect(result.canViewAttendanceSource).toBe(true);
    });
  });

  // ===== T024: deriveAttendanceStatus =====
  describe('deriveAttendanceStatus', () => {
    it('should return not_checked_in when no record and meeting in_progress', () => {
      const result = service.deriveAttendanceStatus(
        null,
        MeetingStatus.IN_PROGRESS,
        mockMeeting.startTime,
      );
      expect(result.attendanceStatus).toBe('not_checked_in');
      expect(result.isLate).toBe(false);
    });

    it('should return absent when no record and meeting completed', () => {
      const result = service.deriveAttendanceStatus(
        null,
        MeetingStatus.COMPLETED,
        mockMeeting.startTime,
      );
      expect(result.attendanceStatus).toBe('absent');
    });

    it('should return present when checkInTime <= startTime', () => {
      const record = {
        ...mockAttendanceRecord,
        checkInTime: new Date('2026-06-16T08:55:00Z'),
      };
      const result = service.deriveAttendanceStatus(
        record,
        MeetingStatus.IN_PROGRESS,
        new Date('2026-06-16T09:00:00Z'),
      );
      expect(result.attendanceStatus).toBe('present');
      expect(result.isLate).toBe(false);
    });

    it('should return late when checkInTime > startTime by 1s, no grace period', () => {
      const record = {
        ...mockAttendanceRecord,
        checkInTime: new Date('2026-06-16T09:00:01Z'),
      };
      const result = service.deriveAttendanceStatus(
        record,
        MeetingStatus.IN_PROGRESS,
        new Date('2026-06-16T09:00:00Z'),
      );
      expect(result.attendanceStatus).toBe('late');
      expect(result.isLate).toBe(true);
      expect(result.lateMinutes).toBe(1);
    });

    it('should return lateMinutes=2 when checkInTime > startTime by 65s', () => {
      const record = {
        ...mockAttendanceRecord,
        checkInTime: new Date('2026-06-16T09:01:05Z'),
      };
      const result = service.deriveAttendanceStatus(
        record,
        MeetingStatus.IN_PROGRESS,
        new Date('2026-06-16T09:00:00Z'),
      );
      expect(result.attendanceStatus).toBe('late');
      expect(result.lateMinutes).toBe(2);
    });

    it('should return left_early when leftEarly is true', () => {
      const record = {
        ...mockAttendanceRecord,
        leftEarly: true,
        attendanceStatus: AttendanceRecordStatus.LEFT_EARLY,
      };
      const result = service.deriveAttendanceStatus(
        record,
        MeetingStatus.IN_PROGRESS,
        mockMeeting.startTime,
      );
      expect(result.attendanceStatus).toBe('left_early');
    });

    it('should return pending_review when status is pending_review', () => {
      const record = {
        ...mockAttendanceRecord,
        attendanceStatus: AttendanceRecordStatus.PENDING_REVIEW,
        checkInTime: new Date('2026-06-16T08:55:00Z'),
      };
      const result = service.deriveAttendanceStatus(
        record,
        MeetingStatus.IN_PROGRESS,
        mockMeeting.startTime,
      );
      expect(result.attendanceStatus).toBe('pending_review');
    });
  });

  // ===== T025: buildSummary =====
  describe('buildSummary', () => {
    it('should calculate summary correctly for mixed status', () => {
      const { AttendanceItemDto } = require('../dto/attendance-item.dto.js');
      const items = [
        new AttendanceItemDto({
          attendanceStatus: 'present',
          isLate: false,
          lateMinutes: 0,
        }),
        new AttendanceItemDto({
          attendanceStatus: 'present',
          isLate: false,
          lateMinutes: 0,
        }),
        new AttendanceItemDto({
          attendanceStatus: 'late',
          isLate: true,
          lateMinutes: 5,
        }),
        new AttendanceItemDto({
          attendanceStatus: 'left_early',
          isLate: false,
          lateMinutes: 0,
        }),
        new AttendanceItemDto({
          attendanceStatus: 'not_checked_in',
          isLate: false,
          lateMinutes: 0,
        }),
        new AttendanceItemDto({
          attendanceStatus: 'not_checked_in',
          isLate: false,
          lateMinutes: 0,
        }),
      ];
      // Fill required fields
      items.forEach((i) => {
        i.participantId = 'x';
        i.userId = 'x';
        i.fullName = 'x';
        i.participantRole = 'attendee';
      });
      const summary = service.buildSummary(
        items as any,
        MeetingStatus.IN_PROGRESS,
      );
      expect(summary.totalParticipants).toBe(6);
      expect(summary.checkedInCount).toBe(4);
      expect(summary.presentCount).toBe(2);
      expect(summary.lateCount).toBe(1);
      expect(summary.notCheckedInCount).toBe(2);
      expect(summary.absentCount).toBe(0);
      expect(summary.attendanceRate).toBe(67);
      expect(summary.scope).toBe('internal_participants_only');
    });

    it('should calculate absent for completed meetings', () => {
      const { AttendanceItemDto } = require('../dto/attendance-item.dto.js');
      const items = [
        new AttendanceItemDto({
          attendanceStatus: 'absent',
          isLate: false,
          lateMinutes: 0,
        }),
        new AttendanceItemDto({
          attendanceStatus: 'absent',
          isLate: false,
          lateMinutes: 0,
        }),
      ];
      items.forEach((i) => {
        i.participantId = 'x';
        i.userId = 'x';
        i.fullName = 'x';
        i.participantRole = 'attendee';
      });
      const summary = service.buildSummary(
        items as any,
        MeetingStatus.COMPLETED,
      );
      expect(summary.absentCount).toBe(2);
    });
  });

  // ===== T026: applyFieldLevelAuth =====
  describe('applyFieldLevelAuth', () => {
    it('should keep all fields when canViewSource is true', () => {
      const { AttendanceItemDto } = require('../dto/attendance-item.dto.js');
      const items = [
        new AttendanceItemDto({
          userId: 'user-a',
          attendanceSource: 'camera',
          checkInMethod: 'door_camera',
        }),
      ];
      items.forEach((i) => {
        i.participantId = 'x';
        i.fullName = 'x';
        i.participantRole = 'attendee';
      });
      const result = service.applyFieldLevelAuth(
        items as any,
        'current-user',
        true,
        new Set(),
      );
      expect(result[0].attendanceSource).toBe('camera');
      expect(result[0].checkInMethod).toBe('door_camera');
    });

    it('should hide source for other participants when canViewSource is false', () => {
      const { AttendanceItemDto } = require('../dto/attendance-item.dto.js');
      const items = [
        new AttendanceItemDto({
          userId: 'other-user',
          attendanceSource: 'camera',
          checkInMethod: 'door_camera',
        }),
      ];
      items.forEach((i) => {
        i.participantId = 'x';
        i.fullName = 'x';
        i.participantRole = 'attendee';
      });
      const result = service.applyFieldLevelAuth(
        items as any,
        'current-user',
        false,
        new Set(),
      );
      expect(result[0].attendanceSource).toBeNull();
      expect(result[0].checkInMethod).toBeNull();
    });

    it('should keep source for the current user even when canViewSource is false', () => {
      const { AttendanceItemDto } = require('../dto/attendance-item.dto.js');
      const items = [
        new AttendanceItemDto({
          userId: 'current-user',
          attendanceSource: 'camera',
          checkInMethod: 'door_camera',
        }),
      ];
      items.forEach((i) => {
        i.participantId = 'x';
        i.fullName = 'x';
        i.participantRole = 'attendee';
      });
      const result = service.applyFieldLevelAuth(
        items as any,
        'current-user',
        false,
        new Set(),
      );
      expect(result[0].attendanceSource).toBe('camera');
      expect(result[0].checkInMethod).toBe('door_camera');
    });
  });
});
