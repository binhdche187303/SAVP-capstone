import { CloudinaryService } from '../../storage/cloudinary.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { GuestEmailService } from '../../guest-access/services/guest-email.service.js';
import { GuestInviteService } from '../../guest-access/services/guest-invite.service.js';
import { FaceProvisioningService } from '../../face-access/services/face-provisioning.service.js';
/* eslint-disable @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, EntityManager } from 'typeorm';
import {
  ConflictException,
  NotFoundException,
  ForbiddenException,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';

import { MeetingsService } from '../services/meetings.service.js';
import {
  MeetingEntity,
  MeetingStatus,
  MeetingVisibilityLevel,
} from '../entities/meeting.entity.js';
import { WarningTokenUtil } from '../utils/warning-token.util.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import { MeetingParticipantEntity } from '../entities/meeting-participant.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../entities/meeting-event.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { AddExternalParticipantDto } from '../dto/add-external-participant.dto.js';

describe('MeetingsService.addExternalParticipant', () => {
  let service: MeetingsService;
  let dataSource: jest.Mocked<DataSource>;
  let em: jest.Mocked<EntityManager>;
  let warningTokenUtil: jest.Mocked<WarningTokenUtil>;
  let notificationsService: jest.Mocked<NotificationsService>;

  const mockMeeting = {
    id: 'meeting-1',
    status: MeetingStatus.SCHEDULED,
    organizerId: 'organizer-1',
    hostId: null,
    visibilityLevel: MeetingVisibilityLevel.INTERNAL,
    roomId: null,
    deletedAt: null,
    title: 'Test Meeting',
    startTime: new Date('2026-07-01T09:00:00Z'),
    endTime: new Date('2026-07-01T10:00:00Z'),
  } as MeetingEntity;

  const mockExternalParticipant = {
    id: 'ext-part-1',
    meetingId: 'meeting-1',
    fullName: 'Nguyen Van Khach',
    email: 'khach@partner.com',
    organizationName: null,
    phoneNumber: null,
    participantRole: 'attendee',
    invitationStatus: 'pending',
  } as MeetingExternalParticipantEntity;

  const mockAuthUser = { userId: 'organizer-1' };

  const validDto: AddExternalParticipantDto = {
    fullName: 'Nguyen Van Khach',
    email: 'khach@partner.com',
  };

  beforeAll(async () => {
    em = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      getRepository: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    dataSource = {
      getRepository: jest.fn().mockReturnValue({
        findOne: jest.fn(),
        find: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn(),
          getMany: jest.fn(),
        }),
        count: jest.fn(),
        create: jest.fn(),
        save: jest.fn(),
      }),
      transaction: jest
        .fn()
        .mockImplementation(async (cb: (em: EntityManager) => Promise<any>) => {
          return cb(em);
        }),
      manager: {} as EntityManager,
    } as unknown as jest.Mocked<DataSource>;

    warningTokenUtil = {
      generateToken: jest.fn().mockReturnValue('mock-token'),
      verifyToken: jest.fn().mockReturnValue({ valid: true, warnings: [] }),
    } as unknown as jest.Mocked<WarningTokenUtil>;

    notificationsService = {
      enqueueEmailNotification: jest
        .fn()
        .mockResolvedValue({ notification: { id: 'notif-1' }, jobId: 'job-1' }),
      createNotification: jest.fn().mockResolvedValue({ id: 'notif-1' }),
    } as unknown as jest.Mocked<NotificationsService>;

    const authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    } as unknown as jest.Mocked<AuthzReadRepository>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: CloudinaryService, useValue: {} },
        { provide: WebsocketService, useValue: {} },
        { provide: GuestEmailService, useValue: {} },
        { provide: GuestInviteService, useValue: {} },
        { provide: FaceProvisioningService, useValue: { provisionMeeting: jest.fn().mockResolvedValue(undefined), deprovisionMeeting: jest.fn().mockResolvedValue(undefined), provisionParticipant: jest.fn().mockResolvedValue(undefined), deprovisionParticipant: jest.fn().mockResolvedValue(undefined) } },
        MeetingsService,
        { provide: DataSource, useValue: dataSource },
        { provide: WarningTokenUtil, useValue: warningTokenUtil },
        { provide: NotificationsService, useValue: notificationsService },
        { provide: AuthzReadRepository, useValue: authzRepo },
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
    // Default mock: meeting found
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: any) => {
        if (entity === MeetingEntity) {
          return {
            findOne: jest.fn().mockResolvedValue(mockMeeting),
            createQueryBuilder: jest.fn().mockReturnValue({
              innerJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              andWhere: jest.fn().mockReturnThis(),
              getOne: jest.fn().mockResolvedValue(null),
              getMany: jest.fn().mockResolvedValue([]),
            }),
          };
        }
        if (entity === MeetingExternalParticipantEntity) {
          return {
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              getOne: jest.fn().mockResolvedValue(null),
            }),
            create: jest.fn().mockReturnValue(mockExternalParticipant),
            save: jest.fn().mockResolvedValue(mockExternalParticipant),
          };
        }
        if (entity === MeetingParticipantEntity) {
          return { count: jest.fn().mockResolvedValue(0) };
        }
        if (entity === RoomEntity) {
          return { findOne: jest.fn().mockResolvedValue(null) };
        }
        if (entity === SystemConfigEntity) {
          return { findOne: jest.fn().mockResolvedValue(null) };
        }
        return {
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockReturnValue({}),
          save: jest.fn().mockResolvedValue({}),
        };
      },
    );

    // em.save — the first call persists the new participant and must return its id
    (em.save as jest.Mock).mockResolvedValue(mockExternalParticipant);
    (em.create as jest.Mock).mockImplementation(
      (_entity: any, data: any) => data,
    );

    // em.getRepository — used for the duplicate-email re-check inside the transaction
    (em.getRepository as jest.Mock).mockImplementation((entity: any) => {
      if (entity === MeetingExternalParticipantEntity) {
        return {
          createQueryBuilder: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnThis(),
            getOne: jest.fn().mockResolvedValue(null),
          }),
        };
      }
      return {
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
        }),
      };
    });

    // Transaction mock
    (dataSource.transaction as jest.Mock).mockImplementation(
      async (cb: any) => {
        return cb(em);
      },
    );
  });

  // T022: Happy path
  it('should add external participant successfully (T022)', async () => {
    const result = await service.addExternalParticipant(
      'meeting-1',
      validDto,
      mockAuthUser,
      {},
    );

    expect(result.externalParticipantId).toBeDefined();
    expect(result.email).toBe('khach@partner.com');
    expect(result.role).toBe('attendee');
    expect(result.status).toBe('pending');
  });

  // T023: Meeting not found
  it('should throw 404 when meeting not found (T023)', async () => {
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: any) => {
        if (entity === MeetingEntity) {
          return { findOne: jest.fn().mockResolvedValue(null) };
        }
        return { findOne: jest.fn().mockResolvedValue(null) };
      },
    );

    await expect(
      service.addExternalParticipant('bad-id', validDto, mockAuthUser, {}),
    ).rejects.toThrow(NotFoundException);
  });

  // T024: Wrong meeting status
  it('should throw 400 when meeting status is invalid (T024)', async () => {
    const cancelledMeeting = {
      ...mockMeeting,
      status: MeetingStatus.CANCELLED,
    };
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: any) => {
        if (entity === MeetingEntity) {
          return { findOne: jest.fn().mockResolvedValue(cancelledMeeting) };
        }
        return { findOne: jest.fn().mockResolvedValue(null) };
      },
    );

    await expect(
      service.addExternalParticipant('meeting-1', validDto, mockAuthUser, {}),
    ).rejects.toThrow(BadRequestException);
  });

  // T026: No permission, not owner
  it('should throw 403 when user has no permission (T026)', async () => {
    const unauthorizedUser = { userId: 'some-other-user' };

    await expect(
      service.addExternalParticipant(
        'meeting-1',
        validDto,
        unauthorizedUser,
        {},
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // T030: Duplicate email
  it('should throw 409 when email already exists (T030)', async () => {
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: any) => {
        if (entity === MeetingEntity) {
          return { findOne: jest.fn().mockResolvedValue(mockMeeting) };
        }
        if (entity === MeetingExternalParticipantEntity) {
          return {
            createQueryBuilder: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnThis(),
              getOne: jest.fn().mockResolvedValue(mockExternalParticipant),
            }),
          };
        }
        return { findOne: jest.fn().mockResolvedValue(null) };
      },
    );

    await expect(
      service.addExternalParticipant('meeting-1', validDto, mockAuthUser, {}),
    ).rejects.toThrow(ConflictException);
  });
});
