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
} from '@nestjs/common';

import { MeetingsService } from '../services/meetings.service.js';
import { MeetingEntity, MeetingStatus } from '../entities/meeting.entity.js';
import { WarningTokenUtil } from '../utils/warning-token.util.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { StorageService } from '../../storage/storage.service.js';
import { MeetingExternalParticipantEntity } from '../entities/meeting-external-participant.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
} from '../entities/meeting-event.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { RemoveExternalParticipantBodyDto } from '../dto/remove-external-participant-body.dto.js';

describe('MeetingsService.removeExternalParticipant', () => {
  let service: MeetingsService;
  let dataSource: jest.Mocked<DataSource>;
  let em: jest.Mocked<EntityManager>;

  const mockMeeting = {
    id: 'meeting-1',
    status: MeetingStatus.SCHEDULED,
    organizerId: 'organizer-1',
    hostId: null,
    deletedAt: null,
    title: 'Test Meeting',
    startTime: new Date('2026-07-01T09:00:00Z'),
    endTime: new Date('2026-07-01T10:00:00Z'),
  } as MeetingEntity;

  const mockTarget = {
    id: 'ext-part-1',
    meetingId: 'meeting-1',
    fullName: 'Nguyen Van Khach',
    email: 'khach@partner.com',
  } as MeetingExternalParticipantEntity;

  const mockAuthUser = { userId: 'organizer-1' };

  beforeAll(async () => {
    em = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
    } as unknown as jest.Mocked<EntityManager>;

    dataSource = {
      getRepository: jest.fn().mockReturnValue({
        findOne: jest.fn(),
        createQueryBuilder: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn(),
        }),
      }),
      transaction: jest
        .fn()
        .mockImplementation(async (cb: (em: EntityManager) => Promise<any>) => {
          return cb(em);
        }),
      manager: {} as EntityManager,
    } as unknown as jest.Mocked<DataSource>;

    const warningTokenUtil = {
      generateToken: jest.fn(),
      verifyToken: jest.fn(),
    } as unknown as jest.Mocked<WarningTokenUtil>;

    const notificationsService = {
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

    // Default mocks
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: any) => {
        if (entity === MeetingEntity) {
          return { findOne: jest.fn().mockResolvedValue(mockMeeting) };
        }
        if (entity === MeetingExternalParticipantEntity) {
          return {
            findOne: jest.fn().mockResolvedValue(mockTarget),
          };
        }
        return { findOne: jest.fn().mockResolvedValue(null) };
      },
    );

    (dataSource.transaction as jest.Mock).mockImplementation(
      async (cb: any) => {
        return cb(em);
      },
    );

    em.findOne = jest.fn().mockResolvedValue(mockMeeting);
    em.delete = jest.fn().mockResolvedValue({ affected: 1 });
    em.create = jest.fn().mockReturnValue({});
    em.save = jest.fn().mockResolvedValue({});
  });

  // T022: Happy path
  it('should remove external participant successfully (T022)', async () => {
    const result = await service.removeExternalParticipant(
      'meeting-1',
      'ext-part-1',
      mockAuthUser,
      {},
    );

    expect(result.removed).toBe(true);
    expect(result.meetingId).toBe('meeting-1');
    expect(result.removedExternalParticipantId).toBe('ext-part-1');
  });

  // T024: Meeting not found
  it('should throw 404 when meeting not found (T024)', async () => {
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: any) => {
        if (entity === MeetingEntity) {
          return { findOne: jest.fn().mockResolvedValue(null) };
        }
        return { findOne: jest.fn().mockResolvedValue(null) };
      },
    );

    await expect(
      service.removeExternalParticipant(
        'bad-id',
        'ext-part-1',
        mockAuthUser,
        {},
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // T025: Wrong meeting status
  it('should throw 409 when meeting is not scheduled (T025)', async () => {
    const inProgressMeeting = {
      ...mockMeeting,
      status: MeetingStatus.IN_PROGRESS,
    };
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: any) => {
        if (entity === MeetingEntity) {
          return { findOne: jest.fn().mockResolvedValue(inProgressMeeting) };
        }
        return { findOne: jest.fn().mockResolvedValue(null) };
      },
    );

    await expect(
      service.removeExternalParticipant(
        'meeting-1',
        'ext-part-1',
        mockAuthUser,
        {},
      ),
    ).rejects.toThrow(ConflictException);
  });

  // T026: No permission
  it('should throw 403 when user has no permission (T026)', async () => {
    const unauthorizedUser = { userId: 'some-other-user' };

    await expect(
      service.removeExternalParticipant(
        'meeting-1',
        'ext-part-1',
        unauthorizedUser,
        {},
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // T030: Participant not in meeting
  it('should throw 404 when participant not in meeting (T030)', async () => {
    (dataSource.getRepository as jest.Mock).mockImplementation(
      (entity: any) => {
        if (entity === MeetingEntity) {
          return { findOne: jest.fn().mockResolvedValue(mockMeeting) };
        }
        if (entity === MeetingExternalParticipantEntity) {
          return { findOne: jest.fn().mockResolvedValue(null) };
        }
        return { findOne: jest.fn().mockResolvedValue(null) };
      },
    );

    await expect(
      service.removeExternalParticipant(
        'meeting-1',
        'bad-ext-id',
        mockAuthUser,
        {},
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // T032: scope=series rejected
  it('should throw 422 when scope=series (T032)', async () => {
    const body = new RemoveExternalParticipantBodyDto();
    body.scope = 'series';

    await expect(
      service.removeExternalParticipant(
        'meeting-1',
        'ext-part-1',
        mockAuthUser,
        {},
        body,
      ),
    ).rejects.toThrow(UnprocessableEntityException);
  });
});
