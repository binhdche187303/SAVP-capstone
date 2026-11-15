import { CloudinaryService } from '../../storage/cloudinary.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { GuestEmailService } from '../../guest-access/services/guest-email.service.js';
import { GuestInviteService } from '../../guest-access/services/guest-invite.service.js';
import { FaceProvisioningService } from '../../face-access/services/face-provisioning.service.js';
/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { MeetingsService } from '../services/meetings.service.js';
import { MeetingEntity, MeetingStatus } from '../entities/meeting.entity.js';
import { WarningTokenUtil } from '../utils/warning-token.util.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
  InvitationStatus,
} from '../entities/meeting-participant.entity.js';
import { MeetingAgendaEntity } from '../entities/meeting-agenda.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../entities/meeting-event.entity.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationDeliveryStatus,
} from '../../notifications/entities/notification.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import {
  BackgroundJobEntity,
  BackgroundJobType,
  BackgroundJobStatus,
} from '../../administration/entities/background-job.entity.js';
import { RemoveParticipantBodyDto } from '../dto/remove-participant-body.dto.js';
import { RemoveScope } from '../types/remove-scope.type.js';

describe('MeetingsService.removeParticipant', () => {
  let service: MeetingsService;
  let dataSource: jest.Mocked<DataSource>;
  let em: jest.Mocked<EntityManager>;

  const authUser = { userId: 'auth-user-uuid' };
  const targetUser = { userId: 'target-user-uuid' };
  const hostUser = { userId: 'host-user-uuid' };
  const organizerUser = { userId: 'organizer-user-uuid' };
  const adminUser = { userId: 'admin-user-uuid' };
  const clientContext = { ipAddress: '127.0.0.1', userAgent: 'test' };

  const mockMeeting = (overrides: Partial<MeetingEntity> = {}): MeetingEntity =>
    ({
      id: 'meeting-uuid',
      title: 'Test Meeting',
      status: MeetingStatus.SCHEDULED,
      organizerId: organizerUser.userId,
      hostId: hostUser.userId,
      startTime: new Date('2026-07-20T10:00:00Z'),
      endTime: new Date('2026-07-20T11:00:00Z'),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    }) as MeetingEntity;

  const mockParticipant = (
    overrides: Partial<MeetingParticipantEntity> = {},
  ): MeetingParticipantEntity =>
    ({
      id: 'participant-uuid',
      meetingId: 'meeting-uuid',
      userId: targetUser.userId,
      participantRole: ParticipantRole.ATTENDEE,
      invitationStatus: InvitationStatus.ACCEPTED,
      ...overrides,
    }) as MeetingParticipantEntity;

  const mockAgenda = (
    overrides: Partial<MeetingAgendaEntity> = {},
  ): MeetingAgendaEntity =>
    ({
      id: 'agenda-uuid',
      meetingId: 'meeting-uuid',
      ownerId: targetUser.userId,
      title: 'Test Agenda',
      ...overrides,
    }) as MeetingAgendaEntity;

  beforeAll(async () => {
    em = {
      findOne: jest.fn(),
      find: jest
        .fn()
        .mockResolvedValue([
          { id: targetUser.userId, email: 'target@example.com' },
        ]),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    dataSource = {
      getRepository: jest.fn(),
      transaction: jest.fn(),
      manager: em,
    } as unknown as jest.Mocked<DataSource>;

    const mockNotificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
      enqueueEmailNotification: jest
        .fn()
        .mockResolvedValue({ notification: { id: 'notif-1' } }),
    };

    const mockAuthzReadRepository = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: CloudinaryService, useValue: {} },
        { provide: WebsocketService, useValue: {} },
        { provide: GuestEmailService, useValue: {} },
        { provide: GuestInviteService, useValue: {} },
        { provide: FaceProvisioningService, useValue: { provisionMeeting: jest.fn().mockResolvedValue(undefined), deprovisionMeeting: jest.fn().mockResolvedValue(undefined), provisionParticipant: jest.fn().mockResolvedValue(undefined), deprovisionParticipant: jest.fn().mockResolvedValue(undefined) } },
        MeetingsService,
        { provide: DataSource, useValue: dataSource },
        WarningTokenUtil,
        { provide: NotificationsService, useValue: mockNotificationsService },
        { provide: AuthzReadRepository, useValue: mockAuthzReadRepository },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-secret') },
        },
        {
          provide: StorageService,
          useValue: {
            saveFile: jest.fn(),
            deleteFile: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();

    service = module.get<MeetingsService>(MeetingsService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── Happy Path ──

  it('T023: should remove participant successfully (Host)', async () => {
    const meeting = mockMeeting({ hostId: authUser.userId });
    const participant = mockParticipant();

    const mockGetRepo = jest.fn().mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      if (entity === MeetingParticipantEntity) {
        return {
          findOne: jest
            .fn()
            .mockResolvedValueOnce(participant)
            .mockResolvedValueOnce(participant),
        };
      }
      if (entity === MeetingAgendaEntity) {
        return { find: jest.fn().mockResolvedValue([]) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });
    dataSource.getRepository.mockImplementation(mockGetRepo);

    dataSource.transaction.mockImplementation(async (cb: any) => {
      em.findOne.mockResolvedValue(participant);
      em.create
        .mockReturnValueOnce({ id: 'event-uuid' })
        .mockReturnValueOnce({ id: 'notif-uuid' })
        .mockReturnValueOnce({ id: 'job-uuid' });
      return cb(em);
    });

    const result = await service.removeParticipant(
      'meeting-uuid',
      targetUser.userId,
      { userId: authUser.userId },
      clientContext,
      {},
    );

    expect(result.removed).toBe(true);
    expect(result.meetingId).toBe('meeting-uuid');
    expect(result.removedParticipantUserId).toBe(targetUser.userId);
    expect(result.notificationQueued).toBe(true);
    expect(result.notificationId).toBeDefined();
    expect(result.backgroundJobId).toBeDefined();
    expect(dataSource.transaction).toHaveBeenCalled();
  });

  it('T036: should store reason in event metadata when provided', async () => {
    const meeting = mockMeeting({ hostId: authUser.userId });
    const participant = mockParticipant();
    const reason = 'Sai phong ban';

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      if (entity === MeetingParticipantEntity) {
        return {
          findOne: jest
            .fn()
            .mockResolvedValueOnce(participant)
            .mockResolvedValueOnce(participant),
        };
      }
      if (entity === MeetingAgendaEntity) {
        return { find: jest.fn().mockResolvedValue([]) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    dataSource.transaction.mockImplementation(async (cb: any) => {
      em.findOne.mockResolvedValue(participant);
      em.create.mockReturnValue({ id: 'uuid' });
      return cb(em);
    });

    const result = await service.removeParticipant(
      'meeting-uuid',
      targetUser.userId,
      { userId: authUser.userId },
      clientContext,
      { reason },
    );

    expect(result.removed).toBe(true);
    expect(dataSource.transaction).toHaveBeenCalled();
  });

  // ── Error Cases ──

  it('T024: should throw 404 when meeting not found', async () => {
    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(null) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    await expect(
      service.removeParticipant(
        'nonexistent-uuid',
        targetUser.userId,
        { userId: authUser.userId },
        clientContext,
        {},
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('T025: should throw 409 when meeting is in_progress', async () => {
    const meeting = mockMeeting({
      hostId: authUser.userId,
      status: MeetingStatus.IN_PROGRESS,
    });

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    await expect(
      service.removeParticipant(
        'meeting-uuid',
        targetUser.userId,
        { userId: authUser.userId },
        clientContext,
        {},
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('T025: should throw 409 when meeting is completed', async () => {
    const meeting = mockMeeting({
      hostId: authUser.userId,
      status: MeetingStatus.COMPLETED,
    });

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    await expect(
      service.removeParticipant(
        'meeting-uuid',
        targetUser.userId,
        { userId: authUser.userId },
        clientContext,
        {},
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('T026: should throw 403 when requester is regular participant', async () => {
    const meeting = mockMeeting();
    const participant = mockParticipant({ userId: authUser.userId });

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      if (entity === MeetingParticipantEntity) {
        return { findOne: jest.fn().mockResolvedValue(participant) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    await expect(
      service.removeParticipant(
        'meeting-uuid',
        targetUser.userId,
        { userId: authUser.userId },
        clientContext,
        {},
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('T027: should throw 404 when participant not in meeting', async () => {
    const meeting = mockMeeting({ hostId: authUser.userId });

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      if (entity === MeetingParticipantEntity) {
        return { findOne: jest.fn().mockResolvedValue(null) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    await expect(
      service.removeParticipant(
        'meeting-uuid',
        targetUser.userId,
        { userId: authUser.userId },
        clientContext,
        {},
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('T028: should throw 409 when target is Host', async () => {
    const meeting = mockMeeting({
      hostId: hostUser.userId,
      organizerId: authUser.userId,
    });

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      if (entity === MeetingParticipantEntity) {
        return {
          findOne: jest
            .fn()
            .mockResolvedValue(mockParticipant({ userId: hostUser.userId })),
        };
      }
      if (entity === MeetingAgendaEntity) {
        return { find: jest.fn().mockResolvedValue([]) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    await expect(
      service.removeParticipant(
        'meeting-uuid',
        hostUser.userId,
        { userId: authUser.userId },
        clientContext,
        {},
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('T029: should throw 409 when target is Organizer', async () => {
    const meeting = mockMeeting({ hostId: authUser.userId });

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      if (entity === MeetingParticipantEntity) {
        return {
          findOne: jest
            .fn()
            .mockResolvedValue(
              mockParticipant({ userId: organizerUser.userId }),
            ),
        };
      }
      if (entity === MeetingAgendaEntity) {
        return { find: jest.fn().mockResolvedValue([]) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    await expect(
      service.removeParticipant(
        'meeting-uuid',
        organizerUser.userId,
        { userId: authUser.userId },
        clientContext,
        {},
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('T031: should throw 409 when target owns agenda items', async () => {
    const meeting = mockMeeting({ hostId: authUser.userId });
    const participant = mockParticipant();
    const ownedAgenda = mockAgenda();

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      if (entity === MeetingParticipantEntity) {
        return { findOne: jest.fn().mockResolvedValue(participant) };
      }
      if (entity === MeetingAgendaEntity) {
        return { find: jest.fn().mockResolvedValue([ownedAgenda]) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    await expect(
      service.removeParticipant(
        'meeting-uuid',
        targetUser.userId,
        { userId: authUser.userId },
        clientContext,
        {},
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('T032: should throw 422 when scope = series', async () => {
    const meeting = mockMeeting({ hostId: authUser.userId });
    const participant = mockParticipant();

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      if (entity === MeetingParticipantEntity) {
        return { findOne: jest.fn().mockResolvedValue(participant) };
      }
      if (entity === MeetingAgendaEntity) {
        return { find: jest.fn().mockResolvedValue([]) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    const body = new RemoveParticipantBodyDto();
    body.scope = RemoveScope.SERIES;

    await expect(
      service.removeParticipant(
        'meeting-uuid',
        targetUser.userId,
        { userId: authUser.userId },
        clientContext,
        body,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });

  it('T030: should throw 409 when Admin targets Host', async () => {
    const meeting = mockMeeting();

    const qb = {
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: adminUser.userId }),
    };

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === UserEntity) {
        return { createQueryBuilder: jest.fn().mockReturnValue(qb) };
      }
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      if (entity === MeetingParticipantEntity) {
        return {
          findOne: jest
            .fn()
            .mockResolvedValue(mockParticipant({ userId: hostUser.userId })),
        };
      }
      if (entity === MeetingAgendaEntity) {
        return { find: jest.fn().mockResolvedValue([]) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    await expect(
      service.removeParticipant(
        'meeting-uuid',
        hostUser.userId,
        { userId: adminUser.userId },
        clientContext,
        {},
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('T035: should throw 404 on duplicate remove (already removed)', async () => {
    const meeting = mockMeeting({ hostId: authUser.userId });

    dataSource.getRepository.mockImplementation((entity) => {
      if (entity === MeetingEntity) {
        return { findOne: jest.fn().mockResolvedValue(meeting) };
      }
      if (entity === MeetingParticipantEntity) {
        return { findOne: jest.fn().mockResolvedValue(null) };
      }
      return { findOne: jest.fn().mockResolvedValue(null) };
    });

    await expect(
      service.removeParticipant(
        'meeting-uuid',
        targetUser.userId,
        { userId: authUser.userId },
        clientContext,
        {},
      ),
    ).rejects.toThrow(NotFoundException);
  });
});
