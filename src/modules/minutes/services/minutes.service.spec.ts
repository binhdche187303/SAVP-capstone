/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */
import { DataSource } from 'typeorm';
import {
  ForbiddenException,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';

import { MinutesService } from './minutes.service.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { StorageService } from '../../storage/storage.service.js';
import {
  MediaFileEntity,
  MediaFileType,
} from '../../recording/entities/media-file.entity.js';
import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';

import { CreateDraftMinutesDto } from '../dto/create-draft-minutes.dto.js';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
  ParticipantAttendanceStatus,
} from '../../meetings/entities/meeting-participant.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
  MeetingMinutesVisibilityLevel,
  MeetingMinutesSource,
  MeetingMinutesContentFormat,
} from '../entities/meeting-minutes.entity.js';
import { MeetingMinutesShareEntity } from '../entities/meeting-minutes-share.entity.js';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import { TranscriptEntity } from '../../transcription/entities/transcript.entity.js';
import {
  NotificationEntity,
  NotificationType,
} from '../../notifications/entities/notification.entity.js';
import { IssueMinutesResponseDto } from '../dto/issue-minutes-response.dto.js';

describe('MinutesService', () => {
  let service: MinutesService;
  let dataSource: { transaction: jest.Mock };
  let auditLogsService: { logAction: jest.Mock };
  let meetingQueryBuilder: {
    setLock: jest.Mock;
    where: jest.Mock;
    getOne: jest.Mock;
  };
  let meetingRepo: { createQueryBuilder: jest.Mock };
  let minutesRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };
  let participantRepo: { find: jest.Mock };
  let em: { query: jest.Mock; getRepository: jest.Mock };
  let authzRepo: { getEffectiveRolesAndPermissions: jest.Mock };

  const authUser = { userId: 'host-1' };
  const meetingId = 'meeting-1';

  const baseMeeting: Partial<MeetingEntity> = {
    id: meetingId,
    title: 'Họp review Sprint 12',
    hostId: 'host-1',
    status: MeetingStatus.IN_PROGRESS,
    actualStartTime: new Date('2026-07-02T09:00:00Z'),
    actualEndTime: null,
    roomId: 'room-1',
    deletedAt: null,
  };

  const buildParticipant = (
    overrides: Partial<MeetingParticipantEntity>,
  ): MeetingParticipantEntity =>
    ({
      userId: 'user-x',
      participantRole: ParticipantRole.ATTENDEE,
      attendanceStatus: ParticipantAttendanceStatus.NOT_CHECKED_IN,
      joinedAt: null,
      leftAt: null,
      ...overrides,
    }) as MeetingParticipantEntity;

  beforeEach(() => {
    meetingQueryBuilder = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ ...baseMeeting }),
    };
    meetingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(meetingQueryBuilder),
    };
    minutesRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((data: any) => data),
      save: jest.fn((data: any) =>
        Promise.resolve({
          id: 'minutes-1',
          createdAt: new Date('2026-07-02T09:15:00Z'),
          versionNo: 1,
          ...data,
        }),
      ),
    };
    participantRepo = {
      find: jest.fn().mockResolvedValue([]),
    };

    em = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: unknown) => {
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MeetingParticipantEntity) return participantRepo;
        throw new Error(
          'Unexpected entity requested in test: ' + String(entity),
        );
      }),
    };

    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((cb: (manager: unknown) => unknown) => cb(em)),
    };

    auditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    };

    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    };

    service = new MinutesService(
      dataSource as unknown as DataSource,
      auditLogsService as unknown as AuditLogsService,
      authzRepo as unknown as AuthzReadRepository,
      {
        saveFile: jest.fn(),
        deleteFile: jest.fn(),
      } as unknown as StorageService,
      { get: jest.fn() } as unknown as ConfigService,
      { findAndCount: jest.fn() } as unknown as Repository<MediaFileEntity>,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createDraft - happy path', () => {
    it('creates a draft when meeting is in_progress', async () => {
      participantRepo.find.mockResolvedValue([
        buildParticipant({
          userId: 'host-1',
          participantRole: ParticipantRole.HOST,
          attendanceStatus: ParticipantAttendanceStatus.PRESENT,
          joinedAt: new Date(),
        }),
        buildParticipant({ userId: 'user-2' }),
      ]);

      const result = await service.createDraft(meetingId, {}, authUser);

      expect(result.status).toBe(MeetingMinutesStatus.DRAFT);
      expect(result.visibilityLevel).toBe(
        MeetingMinutesVisibilityLevel.PRIVATE,
      );
      expect(result.preparedBy).toBe('host-1');
      expect(result.title).toBe('Biên bản họp: Họp review Sprint 12');
      expect(result.meetingSnapshot.attendees).toHaveLength(2);
      expect(result.meetingSnapshot.actualEndTime).toBeNull();
      expect(auditLogsService.logAction).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'host-1',
          actionType: 'meeting_minutes_draft_created',
          entityType: 'meeting_minutes',
          entityId: 'minutes-1',
        }),
      );
    });

    it('uses custom title when provided', async () => {
      const dto: CreateDraftMinutesDto = { title: 'Biên bản tuỳ chỉnh' };
      const result = await service.createDraft(meetingId, dto, authUser);
      expect(result.title).toBe('Biên bản tuỳ chỉnh');
    });

    it('defaults contentFormat to template when not provided', async () => {
      const result = await service.createDraft(meetingId, {}, authUser);
      expect(result.contentFormat).toBe(MeetingMinutesContentFormat.TEMPLATE);
    });

    it('uses contentFormat=blank when explicitly chosen', async () => {
      const dto: CreateDraftMinutesDto = {
        contentFormat: MeetingMinutesContentFormat.BLANK,
      };
      const result = await service.createDraft(meetingId, dto, authUser);
      expect(result.contentFormat).toBe(MeetingMinutesContentFormat.BLANK);
    });

    it('allows creation when meeting is completed and reflects actualEndTime', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.COMPLETED,
        actualEndTime: new Date('2026-07-02T10:00:00Z'),
      });

      const result = await service.createDraft(meetingId, {}, authUser);
      expect(result.meetingSnapshot.meetingStatus).toBe(
        MeetingStatus.COMPLETED,
      );
      expect(result.meetingSnapshot.actualEndTime).toEqual(
        new Date('2026-07-02T10:00:00Z'),
      );
    });
  });

  describe('createDraft - error paths', () => {
    it('throws MEETING_NOT_FOUND when meeting does not exist', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue(null);

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws MEETING_NOT_FOUND when meeting is soft-deleted', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        deletedAt: new Date(),
      });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws MEETING_HOST_NOT_ASSIGNED when hostId is null', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        hostId: null,
      });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({ code: 'MEETING_HOST_NOT_ASSIGNED' }),
        }),
      });
    });

    it('throws NOT_MEETING_HOST when caller is not the host', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        hostId: 'someone-else',
      });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws MEETING_NOT_STARTED when meeting is scheduled', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.SCHEDULED,
      });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({ code: 'MEETING_NOT_STARTED' }),
        }),
      });
    });

    it('throws MEETING_CANCELLED when meeting is cancelled', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.CANCELLED,
      });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({ code: 'MEETING_CANCELLED' }),
        }),
      });
    });

    it('throws MINUTES_ALREADY_EXISTS when a draft already exists', async () => {
      minutesRepo.findOne.mockResolvedValue({ id: 'existing-minutes' });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({
            code: 'MINUTES_ALREADY_EXISTS',
            details: expect.objectContaining({
              existingMinutesId: 'existing-minutes',
            }),
          }),
        }),
      });

      expect(minutesRepo.save).not.toHaveBeenCalled();
    });

    it('maps a Postgres unique-violation (23505) on save to MINUTES_ALREADY_EXISTS (AC-013 race condition)', async () => {
      // Application-level dedup check passed (findOne returns null), but the
      // partial unique index ux_meeting_minutes_meeting_source_active still
      // rejects the insert — simulates a concurrent request winning the race
      // despite the pessimistic_write lock (defense-in-depth, plan.md 9.1).
      minutesRepo.save.mockRejectedValue({ code: '23505' });

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          error: expect.objectContaining({
            code: 'MINUTES_ALREADY_EXISTS',
            details: expect.objectContaining({ source: 'manual' }),
          }),
        }),
      });

      expect(auditLogsService.logAction).not.toHaveBeenCalled();
    });

    it('rethrows non-unique-violation errors from save without mapping them', async () => {
      minutesRepo.save.mockRejectedValue(new Error('connection reset'));

      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toThrow('connection reset');
    });

    it('does not call audit log when creation fails', async () => {
      meetingQueryBuilder.getOne.mockResolvedValue(null);
      await expect(
        service.createDraft(meetingId, {}, authUser),
      ).rejects.toThrow();
      expect(auditLogsService.logAction).not.toHaveBeenCalled();
    });
  });
});

describe('addAttachment', () => {
  let service: MinutesService;
  let dataSource: { transaction: jest.Mock };
  let auditLogsService: { logAction: jest.Mock };
  let storageService: { saveFile: jest.Mock; deleteFile: jest.Mock };
  let configService: { get: jest.Mock };
  let mediaFileRepo: { findAndCount: jest.Mock };
  let em: { query: jest.Mock; getRepository: jest.Mock };
  let minutesQb: { setLock: jest.Mock; where: jest.Mock; getOne: jest.Mock };
  let minutesRepo: { createQueryBuilder: jest.Mock; findOne: jest.Mock };
  const authUser = { userId: 'host-1' };
  const minutesId = 'minutes-1';
  const baseMinutes = {
    id: minutesId,
    meetingId: 'meeting-1',
    preparedBy: 'host-1',
    status: MeetingMinutesStatus.DRAFT,
    deletedAt: null,
  } as any;
  const mockFile = {
    buffer: Buffer.from('fake-pdf'),
    originalname: 'report.pdf',
    mimetype: 'application/pdf',
    size: 1024 * 1024,
  };
  const mockStorageResult = {
    storageKey: 'minutes-attachments/uuid.pdf',
    publicUrl: 'http://localhost/uploads/minutes-attachments/uuid.pdf',
    sizeBytes: 1024 * 1024,
  };
  beforeEach(() => {
    minutesQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ ...baseMinutes }),
    };
    minutesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(minutesQb),
      findOne: jest.fn().mockResolvedValue(null),
    };
    const mediaInsert = jest.fn().mockResolvedValue(undefined);
    const auditInsert = jest.fn().mockResolvedValue(undefined);
    const mediaCount = jest.fn().mockResolvedValue(0);
    em = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MediaFileEntity)
          return {
            insert: mediaInsert,
            count: mediaCount,
            findOne: jest.fn(),
            update: jest.fn(),
          };
        if (entity.name === 'AuditLogEntity') return { insert: auditInsert };
        throw new Error('Unexpected: ' + String(entity));
      }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]), transaction: jest.fn((cb: (m: any) => any) => cb(em)) };
    auditLogsService = { logAction: jest.fn() };
    storageService = {
      saveFile: jest.fn().mockResolvedValue(mockStorageResult),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    configService = { get: jest.fn().mockReturnValue(undefined) };
    mediaFileRepo = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
    service = new MinutesService(
      dataSource as any,
      auditLogsService as any,
      {} as any,
      storageService as any,
      configService as any,
      mediaFileRepo as any,
    );
  });
  it('should upload file successfully', async () => {
    const result = await service.addAttachment(minutesId, mockFile, authUser);
    expect(result.fileName).toBe('report.pdf');
    expect(result.fileType).toBe(MediaFileType.MINUTES_ATTACHMENT);
    expect(result.mimeType).toBe('application/pdf');
    expect(result.uploadedBy).toBe('host-1');
  });
  it('should throw ATTACHMENT_FILE_REQUIRED when no file', async () => {
    await expect(
      service.addAttachment(minutesId, undefined as any, authUser),
    ).rejects.toThrow(BadRequestException);
  });
  it('should throw ATTACHMENT_FILE_TOO_LARGE', async () => {
    configService.get.mockImplementation((key: string) => {
      if (key === 'MINUTES_ATTACHMENT_MAX_BYTES') return 100;
      return undefined;
    });
    await expect(
      service.addAttachment(minutesId, mockFile, authUser),
    ).rejects.toThrow(BadRequestException);
  });
  it('should throw ATTACHMENT_FILE_TYPE_INVALID', async () => {
    await expect(
      service.addAttachment(
        minutesId,
        { ...mockFile, mimetype: 'application/x-msdownload' },
        authUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });
  it('should throw ATTACHMENT_FILE_TYPE_INVALID when extension does not match MIME type', async () => {
    await expect(
      service.addAttachment(
        minutesId,
        {
          ...mockFile,
          originalname: 'report.png',
          mimetype: 'application/pdf',
        },
        authUser,
      ),
    ).rejects.toThrow(BadRequestException);
  });
  it('should throw ATTACHMENT_STORAGE_FAILED', async () => {
    storageService.saveFile.mockRejectedValue(new Error('disk full'));
    await expect(
      service.addAttachment(minutesId, mockFile, authUser),
    ).rejects.toThrow(BadGatewayException);
  });
  it('should throw NOT_MINUTES_OWNER', async () => {
    minutesQb.getOne.mockResolvedValue({
      ...baseMinutes,
      preparedBy: 'other-user',
    });
    await expect(
      service.addAttachment(minutesId, mockFile, authUser),
    ).rejects.toThrow(ForbiddenException);
  });
  it('should throw MINUTES_NOT_DRAFT', async () => {
    minutesQb.getOne.mockResolvedValue({
      ...baseMinutes,
      status: MeetingMinutesStatus.PUBLISHED,
    });
    await expect(
      service.addAttachment(minutesId, mockFile, authUser),
    ).rejects.toThrow(ConflictException);
  });
  it('should throw MINUTES_NOT_FOUND', async () => {
    minutesQb.getOne.mockResolvedValue(null);
    await expect(
      service.addAttachment(minutesId, mockFile, authUser),
    ).rejects.toThrow(NotFoundException);
  });
  it('should cleanup storage on DB failure', async () => {
    dataSource.transaction.mockRejectedValue(new Error('DB error'));
    await expect(
      service.addAttachment(minutesId, mockFile, authUser),
    ).rejects.toThrow();
    expect(storageService.deleteFile).toHaveBeenCalled();
  });
});
describe('listAttachments', () => {
  let service: MinutesService;
  let dataSource: any;
  let auditLogsService: { logAction: jest.Mock };
  let storageService: { saveFile: jest.Mock; deleteFile: jest.Mock };
  let configService: { get: jest.Mock };
  let mediaFileRepo: { findAndCount: jest.Mock };
  let minutesRepo: { findOne: jest.Mock };
  const authUser = { userId: 'host-1' };
  const minutesId = 'minutes-1';
  beforeEach(() => {
    mediaFileRepo = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
    minutesRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: minutesId,
        preparedBy: 'host-1',
        deletedAt: null,
      }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn(),
      getRepository: jest.fn().mockReturnValue(minutesRepo),
    };
    auditLogsService = { logAction: jest.fn() };
    storageService = { saveFile: jest.fn(), deleteFile: jest.fn() };
    configService = { get: jest.fn().mockReturnValue(undefined) };
    service = new MinutesService(
      dataSource,
      auditLogsService as any,
      {} as any,
      storageService as any,
      configService as any,
      mediaFileRepo as any,
    );
  });
  it('should return empty list when no attachments', async () => {
    (service as any).loadMinutesForReadCheck = jest.fn().mockResolvedValue({});
    const result = await service.listAttachments(minutesId, authUser);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
  });
  it('should return attachments list', async () => {
    (service as any).loadMinutesForReadCheck = jest.fn().mockResolvedValue({});
    const file1 = {
      id: 'f1',
      fileName: 'a.pdf',
      fileType: MediaFileType.MINUTES_ATTACHMENT,
      mimeType: 'application/pdf',
      fileSizeBytes: '100',
      fileUrl: 'url1',
      uploadedBy: 'host-1',
      uploadedAt: new Date(),
    };
    mediaFileRepo.findAndCount.mockResolvedValue([[file1], 1]);
    const result = await service.listAttachments(minutesId, authUser);
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});
describe('listAttachments — quyền đọc (loadMinutesForReadCheck, UC-139/UC-140)', () => {
  let service: MinutesService;
  let minutesQb: {
    leftJoinAndSelect: jest.Mock;
    where: jest.Mock;
    andWhere: jest.Mock;
    getOne: jest.Mock;
  };
  let participantRepo: { count: jest.Mock };
  let shareRepo: { count: jest.Mock; createQueryBuilder: jest.Mock };
  let authzRepo: { getEffectiveRolesAndPermissions: jest.Mock };
  let mediaFileRepo: { findAndCount: jest.Mock };
  const authUser = { userId: 'user-1' };
  const minutesId = 'minutes-1';

  const baseMinutes = (
    status: MeetingMinutesStatus,
    preparedBy = 'other-user',
  ) => ({
    id: minutesId,
    preparedBy,
    status,
    meetingId: 'meeting-1',
    meeting: { id: 'meeting-1', hostId: 'host-1' },
    deletedAt: null,
  });

  beforeEach(() => {
    mediaFileRepo = { findAndCount: jest.fn().mockResolvedValue([[], 0]) };
    minutesQb = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn(),
    };
    participantRepo = { count: jest.fn().mockResolvedValue(0) };
    // feat-share-meeting-minutes: canAccessMinutes now also queries shares.
    // Default 0 shares → không thay đổi kỳ vọng cũ (non-host/participant → denied).
    // createQueryBuilder: findMinutesDetail cũng batch-load shares[] để embed vào response.
    shareRepo = {
      count: jest.fn().mockResolvedValue(0),
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue([]),
      }),
    };
    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: ['EMPLOYEE'] }),
    };
    const dataSource = {
      transaction: jest.fn(),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingParticipantEntity) return participantRepo;
        if (entity === MeetingMinutesShareEntity) return shareRepo;
        return { createQueryBuilder: () => minutesQb };
      }),
    };
    service = new MinutesService(
      dataSource as any,
      { logAction: jest.fn() } as any,
      authzRepo as any,
      { saveFile: jest.fn(), deleteFile: jest.fn() } as any,
      { get: jest.fn().mockReturnValue(undefined) } as any,
      mediaFileRepo as any,
    );
  });

  it('published + participant → được phép xem', async () => {
    minutesQb.getOne.mockResolvedValue(
      baseMinutes(MeetingMinutesStatus.PUBLISHED),
    );
    participantRepo.count.mockResolvedValue(1);
    await expect(service.listAttachments(minutesId, authUser)).resolves.toEqual(
      expect.objectContaining({ total: 0 }),
    );
  });

  it('published + không phải host/participant → bị từ chối', async () => {
    minutesQb.getOne.mockResolvedValue(
      baseMinutes(MeetingMinutesStatus.PUBLISHED),
    );
    participantRepo.count.mockResolvedValue(0);
    await expect(service.listAttachments(minutesId, authUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('draft + không phải preparedBy → bị từ chối dù là participant', async () => {
    minutesQb.getOne.mockResolvedValue(baseMinutes(MeetingMinutesStatus.DRAFT));
    participantRepo.count.mockResolvedValue(1);
    await expect(service.listAttachments(minutesId, authUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('BUSINESS_ADMIN → bỏ qua kiểm tra participant', async () => {
    minutesQb.getOne.mockResolvedValue(baseMinutes(MeetingMinutesStatus.DRAFT));
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['BUSINESS_ADMIN'],
    });
    await expect(service.listAttachments(minutesId, authUser)).resolves.toEqual(
      expect.objectContaining({ total: 0 }),
    );
    expect(participantRepo.count).not.toHaveBeenCalled();
  });

  it('bien ban khong ton tai → NotFoundException', async () => {
    minutesQb.getOne.mockResolvedValue(null);
    await expect(service.listAttachments(minutesId, authUser)).rejects.toThrow(
      NotFoundException,
    );
  });
});
describe('removeAttachment', () => {
  let service: MinutesService;
  let dataSource: { transaction: jest.Mock };
  let storageService: { saveFile: jest.Mock; deleteFile: jest.Mock };
  let configService: { get: jest.Mock };
  let em: { query: jest.Mock; getRepository: jest.Mock };
  let minutesQb: { setLock: jest.Mock; where: jest.Mock; getOne: jest.Mock };
  let minutesRepo: { createQueryBuilder: jest.Mock };
  const authUser = { userId: 'host-1' };
  const minutesId = 'minutes-1';
  const fileId = 'file-1';
  const baseMinutes = {
    id: minutesId,
    preparedBy: 'host-1',
    status: MeetingMinutesStatus.DRAFT,
    deletedAt: null,
  } as any;
  const baseMediaFile = {
    id: fileId,
    relatedEntityType: 'meeting_minutes',
    relatedEntityId: minutesId,
    storageKey: 'minutes-attachments/uuid.pdf',
    deletedAt: null,
  } as any;
  beforeEach(() => {
    minutesQb = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ ...baseMinutes }),
    };
    minutesRepo = { createQueryBuilder: jest.fn().mockReturnValue(minutesQb) };
    em = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MediaFileEntity)
          return {
            insert: jest.fn(),
            update: jest.fn().mockResolvedValue(undefined),
            findOne: jest.fn().mockResolvedValue({ ...baseMediaFile }),
            count: jest.fn(),
          };
        if (entity.name === 'AuditLogEntity')
          return { insert: jest.fn().mockResolvedValue(undefined) };
        throw new Error('Unexpected: ' + String(entity));
      }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]), transaction: jest.fn((cb: (m: any) => any) => cb(em)) };
    storageService = {
      saveFile: jest.fn(),
      deleteFile: jest.fn().mockResolvedValue(undefined),
    };
    configService = { get: jest.fn() };
    service = new MinutesService(
      dataSource as any,
      { logAction: jest.fn() } as any,
      {} as any,
      storageService as any,
      configService as any,
      { findAndCount: jest.fn() } as any,
    );
  });
  it('should soft-delete attachment successfully', async () => {
    const result = await service.removeAttachment(minutesId, fileId, authUser);
    expect(result.fileId).toBe(fileId);
    expect(result.deletedAt).toBeInstanceOf(Date);
    expect(storageService.deleteFile).toHaveBeenCalled();
  });
  it('should throw ATTACHMENT_NOT_FOUND when file does not exist', async () => {
    em.getRepository.mockImplementation((entity: any) => {
      if (entity === MeetingMinutesEntity) return minutesRepo;
      if (entity === MediaFileEntity)
        return {
          findOne: jest.fn().mockResolvedValue(null),
          update: jest.fn(),
          count: jest.fn(),
          insert: jest.fn(),
        };
      if (entity.name === 'AuditLogEntity') return { insert: jest.fn() };
      throw new Error('Unexpected');
    });
    await expect(
      service.removeAttachment(minutesId, fileId, authUser),
    ).rejects.toThrow(NotFoundException);
  });
  it('should throw NOT_MINUTES_OWNER', async () => {
    minutesQb.getOne.mockResolvedValue({
      ...baseMinutes,
      preparedBy: 'other-user',
    });
    await expect(
      service.removeAttachment(minutesId, fileId, authUser),
    ).rejects.toThrow(ForbiddenException);
  });
  it('should throw MINUTES_NOT_DRAFT', async () => {
    minutesQb.getOne.mockResolvedValue({
      ...baseMinutes,
      status: MeetingMinutesStatus.PUBLISHED,
    });
    await expect(
      service.removeAttachment(minutesId, fileId, authUser),
    ).rejects.toThrow(ConflictException);
  });
  it('should handle storage delete failure gracefully', async () => {
    storageService.deleteFile.mockRejectedValue(new Error('storage down'));
    const result = await service.removeAttachment(minutesId, fileId, authUser);
    expect(result.fileId).toBe(fileId);
  });
  it('should throw MINUTES_NOT_FOUND', async () => {
    minutesQb.getOne.mockResolvedValue(null);
    await expect(
      service.removeAttachment(minutesId, fileId, authUser),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('updateDraft service logic', () => {
  let service: MinutesService;
  let dataSource: any;
  let em: any;
  let minutesRepo: any;
  let meetingRepo: any;
  let auditLogsService: any;
  let websocketService: { emitToRoom: jest.Mock };

  beforeEach(() => {
    minutesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'min-1',
          meetingId: 'meet-1',
          preparedBy: 'host-1',
          status: MeetingMinutesStatus.DRAFT,
          versionNo: 1,
          title: 'Old Title',
          isLiveShared: false,
        }),
      }),
      save: jest.fn((m) => Promise.resolve(m)),
    };
    meetingRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'meet-1',
        hostId: 'host-1',
        status: MeetingStatus.COMPLETED,
      }),
    };
    em = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === MeetingParticipantEntity)
          return { find: jest.fn().mockResolvedValue([]) };
        throw new Error('Unexpected');
      }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((cb) => cb(em)),
    };
    auditLogsService = {
      logEntityChange: jest.fn().mockResolvedValue(undefined),
    };
    websocketService = { emitToRoom: jest.fn() };
    service = new MinutesService(
      dataSource,
      auditLogsService,
      {} as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      websocketService as any,
    );
  });

  it('updates draft successfully', async () => {
    const result = await service.updateDraft(
      'min-1',
      { versionNo: 1, title: 'New Title' },
      { userId: 'host-1' },
    );
    expect(result.title).toBe('New Title');
    expect(result.versionNo).toBe(2);
    expect(auditLogsService.logEntityChange).toHaveBeenCalled();
  });

  it('throws BadRequestException when no update field provided', async () => {
    await expect(
      service.updateDraft('min-1', { versionNo: 1 }, { userId: 'host-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws ForbiddenException when not owner', async () => {
    await expect(
      service.updateDraft(
        'min-1',
        { versionNo: 1, title: 'New' },
        { userId: 'other-1' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ConflictException when version conflict', async () => {
    await expect(
      service.updateDraft(
        'min-1',
        { versionNo: 2, title: 'New' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when minutes not found', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue(null);
    await expect(
      service.updateDraft(
        'min-1',
        { versionNo: 1, title: 'New Title' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when status is not draft', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      id: 'min-1',
      meetingId: 'meet-1',
      preparedBy: 'host-1',
      status: MeetingMinutesStatus.PUBLISHED,
      versionNo: 1,
      title: 'Old',
    });
    await expect(
      service.updateDraft(
        'min-1',
        { versionNo: 1, title: 'New Title' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('preserves AI confidence/evidence when editing decisions manually', async () => {
    const result = await service.updateDraft(
      'min-1',
      {
        versionNo: 1,
        decisionsJson: [
          {
            text: 'Chốt dùng schema thống nhất',
            confidence: 'high',
            evidence: 'phút 12:30 transcript',
          },
        ],
      },
      { userId: 'host-1' },
    );
    expect(result.decisionsJson[0]).toMatchObject({
      text: 'Chốt dùng schema thống nhất',
      confidence: 'high',
      evidence: 'phút 12:30 transcript',
    });
  });

  it('merges aiSummary edits but keeps read-only meta (provenance)', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      id: 'min-1',
      meetingId: 'meet-1',
      preparedBy: 'host-1',
      status: MeetingMinutesStatus.DRAFT,
      versionNo: 1,
      title: 'Old Title',
      aiSummaryJson: {
        keyPoints: ['cũ'],
        risks: [],
        openQuestions: [],
        uncertainParts: [],
        meta: { provider: 'mock', modelName: 'x', generatedByJobId: 'job-1' },
      },
    });
    const result = await service.updateDraft(
      'min-1',
      { versionNo: 1, aiSummary: { keyPoints: ['đã sửa tay'], risks: ['R1'] } },
      { userId: 'host-1' },
    );
    expect(result.aiSummaryJson).toMatchObject({
      keyPoints: ['đã sửa tay'],
      risks: ['R1'],
      // meta phải được giữ nguyên, không cho ghi đè
      meta: { provider: 'mock', modelName: 'x', generatedByJobId: 'job-1' },
    });
  });

  it('[AC-002][MKM-LIVE-01] emit minutes.draft.updated khi dang live-share va luu noi dung thanh cong', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      id: 'min-1',
      meetingId: 'meet-1',
      preparedBy: 'host-1',
      status: MeetingMinutesStatus.DRAFT,
      versionNo: 1,
      title: 'Old Title',
      isLiveShared: true,
    });
    const result = await service.updateDraft(
      'min-1',
      { versionNo: 1, title: 'New Title' },
      { userId: 'host-1' },
    );
    expect(websocketService.emitToRoom).toHaveBeenCalledWith(
      'meeting:meet-1',
      'minutes.draft.updated',
      expect.objectContaining({
        minutesId: 'min-1',
        versionNo: result.versionNo,
      }),
    );
  });

  it('[FR-007][MKM-LIVE-01] khong emit gi khi khong dang live-share', async () => {
    await service.updateDraft(
      'min-1',
      { versionNo: 1, title: 'New Title' },
      { userId: 'host-1' },
    );
    expect(websocketService.emitToRoom).not.toHaveBeenCalled();
  });
});

describe('toggleLiveShare service logic (MKM-LIVE-01)', () => {
  let service: MinutesService;
  let dataSource: any;
  let em: any;
  let minutesRepo: any;
  let meetingRepo: any;
  let auditLogsService: any;
  let websocketService: { emitToRoom: jest.Mock };

  const authUser = { userId: 'host-1' };
  const minutesId = 'minutes-1';
  const meetingId = 'meeting-1';

  const baseMinutes = {
    id: minutesId,
    meetingId,
    preparedBy: 'host-1',
    status: MeetingMinutesStatus.DRAFT,
    versionNo: 3,
    isLiveShared: false,
    deletedAt: null,
  };

  const baseMeeting = {
    id: meetingId,
    hostId: 'host-1',
    status: MeetingStatus.IN_PROGRESS,
  };

  beforeEach(() => {
    minutesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ ...baseMinutes }),
      }),
      save: jest.fn((m: any) => Promise.resolve({ ...m })),
    };
    meetingRepo = {
      findOne: jest.fn().mockResolvedValue({ ...baseMeeting }),
    };
    em = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MeetingEntity) return meetingRepo;
        throw new Error('Unexpected entity: ' + String(entity));
      }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((cb: any) => cb(em)),
    };
    auditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    };
    websocketService = { emitToRoom: jest.fn() };
    service = new MinutesService(
      dataSource,
      auditLogsService,
      {} as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      websocketService as any,
    );
  });

  it('[AC-001] bat live-share thanh cong: isLiveShared=true, audit log, emit live_started', async () => {
    const result = await service.toggleLiveShare(
      minutesId,
      { enabled: true },
      authUser,
    );
    expect(result.isLiveShared).toBe(true);
    expect(auditLogsService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'host-1',
        actionType: 'meeting_minutes_live_share_toggled',
        entityType: 'meeting_minutes',
        entityId: minutesId,
        metadataJson: { minutesId, enabled: true },
      }),
    );
    expect(websocketService.emitToRoom).toHaveBeenCalledWith(
      `meeting:${meetingId}`,
      'minutes.draft.live_started',
      { minutesId, versionNo: baseMinutes.versionNo },
    );
  });

  it('[AC-004] tat live-share thanh cong: isLiveShared=false, emit live_stopped', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      isLiveShared: true,
    });
    const result = await service.toggleLiveShare(
      minutesId,
      { enabled: false },
      authUser,
    );
    expect(result.isLiveShared).toBe(false);
    expect(websocketService.emitToRoom).toHaveBeenCalledWith(
      `meeting:${meetingId}`,
      'minutes.draft.live_stopped',
      { minutesId },
    );
  });

  it('[AC-005] khong phai preparedBy -> 403 NOT_MINUTES_OWNER, khong emit', async () => {
    await expect(
      service.toggleLiveShare(
        minutesId,
        { enabled: true },
        { userId: 'other-user' },
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(websocketService.emitToRoom).not.toHaveBeenCalled();
  });

  it('[AC-007] khong phai draft -> 409 MINUTES_NOT_DRAFT', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      status: MeetingMinutesStatus.PUBLISHED,
    });
    await expect(
      service.toggleLiveShare(minutesId, { enabled: true }, authUser),
    ).rejects.toThrow(ConflictException);
  });

  it('[AC-008] bat khi meeting khong in_progress -> 409 MEETING_NOT_IN_PROGRESS', async () => {
    meetingRepo.findOne.mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.SCHEDULED,
    });
    await expect(
      service.toggleLiveShare(minutesId, { enabled: true }, authUser),
    ).rejects.toThrow(ConflictException);
  });

  it('cho phep TAT ke ca khi meeting khong in_progress', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      isLiveShared: true,
    });
    meetingRepo.findOne.mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.COMPLETED,
    });
    const result = await service.toggleLiveShare(
      minutesId,
      { enabled: false },
      authUser,
    );
    expect(result.isLiveShared).toBe(false);
  });

  it('[AC-010] toggle lap lai gia tri cu -> idempotent, khong emit/audit/save them', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      isLiveShared: true,
    });
    const result = await service.toggleLiveShare(
      minutesId,
      { enabled: true },
      authUser,
    );
    expect(result.isLiveShared).toBe(true);
    expect(auditLogsService.logAction).not.toHaveBeenCalled();
    expect(websocketService.emitToRoom).not.toHaveBeenCalled();
    expect(minutesRepo.save).not.toHaveBeenCalled();
  });

  it('minutes khong ton tai -> 404 MEETING_MINUTES_NOT_FOUND', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue(null);
    await expect(
      service.toggleLiveShare(minutesId, { enabled: true }, authUser),
    ).rejects.toThrow(NotFoundException);
  });

  it('minutes da bi soft-delete -> 404 MEETING_MINUTES_NOT_FOUND', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      deletedAt: new Date(),
    });
    await expect(
      service.toggleLiveShare(minutesId, { enabled: true }, authUser),
    ).rejects.toThrow(NotFoundException);
  });

  it('van hoat dong binh thuong khi khong inject WebsocketService (optional, best-effort)', async () => {
    service = new MinutesService(
      dataSource,
      auditLogsService,
      {} as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
    const result = await service.toggleLiveShare(
      minutesId,
      { enabled: true },
      authUser,
    );
    expect(result.isLiveShared).toBe(true);
  });
});

describe('linkResources service logic (UC-141)', () => {
  let service: MinutesService;
  let dataSource: any;
  let em: any;
  let minutesRepo: any;
  let meetingRepo: any;
  let mediaFileRepo: any;
  let transcriptRepo: any;
  let auditLogsService: any;

  const baseMinutes = () => ({
    id: 'min-1',
    meetingId: 'meet-1',
    preparedBy: 'host-1',
    status: MeetingMinutesStatus.DRAFT,
    linkedRecordingFileId: null,
    linkedTranscriptId: null,
  });

  beforeEach(() => {
    minutesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(baseMinutes()),
      }),
      save: jest.fn((m: any) =>
        Promise.resolve({ ...m, updatedAt: new Date() }),
      ),
    };
    meetingRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'meet-1',
        hostId: 'host-1',
        status: MeetingStatus.COMPLETED,
      }),
    };
    mediaFileRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'file-1',
        meetingId: 'meet-1',
        fileType: MediaFileType.VIDEO,
        deletedAt: null,
      }),
    };
    transcriptRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'transcript-1',
        meetingId: 'meet-1',
      }),
    };
    em = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === MediaFileEntity) return mediaFileRepo;
        if (entity === TranscriptEntity) return transcriptRepo;
        throw new Error('Unexpected entity: ' + entity);
      }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((cb) => cb(em)),
    };
    auditLogsService = {
      logEntityChange: jest.fn().mockResolvedValue(undefined),
    };
    service = new MinutesService(
      dataSource,
      auditLogsService,
      {} as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
  });

  it('links a recording file successfully', async () => {
    const result = await service.linkResources(
      'min-1',
      { recordingFileId: 'file-1' },
      { userId: 'host-1' },
    );
    expect(result.linkedRecordingFileId).toBe('file-1');
    expect(auditLogsService.logEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'meeting_minutes_resources_linked',
      }),
    );
  });

  it('links a transcript only, keeps recording untouched', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes(),
      linkedRecordingFileId: 'old-file',
    });
    const result = await service.linkResources(
      'min-1',
      { transcriptId: 'transcript-1' },
      { userId: 'host-1' },
    );
    expect(result.linkedTranscriptId).toBe('transcript-1');
    expect(result.linkedRecordingFileId).toBe('old-file');
  });

  it('unlinks recording when recordingFileId = null', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes(),
      linkedRecordingFileId: 'old-file',
    });
    const result = await service.linkResources(
      'min-1',
      { recordingFileId: null },
      { userId: 'host-1' },
    );
    expect(result.linkedRecordingFileId).toBeNull();
  });

  it('throws BadRequestException when no field provided', async () => {
    await expect(
      service.linkResources('min-1', {}, { userId: 'host-1' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws ForbiddenException when caller is not preparedBy nor host (Business Admin included)', async () => {
    await expect(
      service.linkResources(
        'min-1',
        { recordingFileId: 'file-1' },
        { userId: 'business-admin-1' },
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('allows meeting.hostId even when not preparedBy', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes(),
      preparedBy: 'someone-else',
    });
    const result = await service.linkResources(
      'min-1',
      { recordingFileId: 'file-1' },
      { userId: 'host-1' },
    );
    expect(result.linkedRecordingFileId).toBe('file-1');
  });

  it('throws NotFoundException when minutes not found', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue(null);
    await expect(
      service.linkResources(
        'min-1',
        { recordingFileId: 'file-1' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when minutes status is not draft', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes(),
      status: MeetingMinutesStatus.PUBLISHED,
    });
    await expect(
      service.linkResources(
        'min-1',
        { recordingFileId: 'file-1' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('throws ConflictException when meeting is not completed', async () => {
    meetingRepo.findOne.mockResolvedValue({
      id: 'meet-1',
      hostId: 'host-1',
      status: MeetingStatus.IN_PROGRESS,
    });
    await expect(
      service.linkResources(
        'min-1',
        { recordingFileId: 'file-1' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when recording file does not exist', async () => {
    mediaFileRepo.findOne.mockResolvedValue(null);
    await expect(
      service.linkResources(
        'min-1',
        { recordingFileId: 'missing' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws BadRequestException when file is not audio/video', async () => {
    mediaFileRepo.findOne.mockResolvedValue({
      id: 'file-1',
      meetingId: 'meet-1',
      fileType: MediaFileType.DOCUMENT,
      deletedAt: null,
    });
    await expect(
      service.linkResources(
        'min-1',
        { recordingFileId: 'file-1' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('throws ConflictException when recording file belongs to a different meeting', async () => {
    mediaFileRepo.findOne.mockResolvedValue({
      id: 'file-1',
      meetingId: 'other-meeting',
      fileType: MediaFileType.VIDEO,
      deletedAt: null,
    });
    await expect(
      service.linkResources(
        'min-1',
        { recordingFileId: 'file-1' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('throws NotFoundException when transcript does not exist', async () => {
    transcriptRepo.findOne.mockResolvedValue(null);
    await expect(
      service.linkResources(
        'min-1',
        { transcriptId: 'missing' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when transcript belongs to a different meeting', async () => {
    transcriptRepo.findOne.mockResolvedValue({
      id: 'transcript-1',
      meetingId: 'other-meeting',
    });
    await expect(
      service.linkResources(
        'min-1',
        { transcriptId: 'transcript-1' },
        { userId: 'host-1' },
      ),
    ).rejects.toThrow(ConflictException);
  });
});

describe('deleteDraft service logic', () => {
  let service: MinutesService;
  let dataSource: any;
  let em: any;
  let minutesRepo: any;
  let authzRepo: any;
  let notificationRepo: any;

  beforeEach(() => {
    minutesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'min-1',
          meetingId: 'meet-1',
          preparedBy: 'author-1',
          status: MeetingMinutesStatus.DRAFT,
        }),
      }),
      findOne: jest.fn().mockResolvedValue({
        id: 'min-1',
        preparedBy: 'author-1',
      }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    notificationRepo = {
      insert: jest.fn().mockResolvedValue({}),
    };
    em = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MeetingEntity)
          return {
            findOne: jest
              .fn()
              .mockResolvedValue({ id: 'meet-1', hostId: 'host-1' }),
          };
        if (entity === MediaFileEntity)
          return { update: jest.fn().mockResolvedValue({ affected: 0 }) };
        if (entity === AuditLogEntity)
          return { insert: jest.fn().mockResolvedValue({}) };
        throw new Error('Unexpected');
      }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((cb) => cb(em)),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === NotificationEntity) return notificationRepo;
        return { findOne: jest.fn() };
      }),
    };
    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: ['BUSINESS_ADMIN'], permissions: [] }),
    };
    service = new MinutesService(
      dataSource,
      { logAction: jest.fn() } as any,
      authzRepo,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
  });

  it('deletes draft and sends notification when admin deletes and preparedBy !== admin', async () => {
    const result = await service.deleteDraft('min-1', { userId: 'admin-1' });
    expect(result.deleted).toBe(true);
    expect(notificationRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserIdsJson: ['author-1'],
        notificationType: NotificationType.MINUTES_DELETED_BY_ADMIN,
      }),
    );
  });

  it('throws NotFoundException when minutes not found', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue(null);
    await expect(
      service.deleteDraft('min-1', { userId: 'user-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ConflictException when status is not draft', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      id: 'min-1',
      meetingId: 'meet-1',
      preparedBy: 'author-1',
      status: MeetingMinutesStatus.PUBLISHED,
    });
    await expect(
      service.deleteDraft('min-1', { userId: 'author-1' }),
    ).rejects.toThrow(ConflictException);
  });

  it('throws ForbiddenException when not owner and not admin', async () => {
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['INTERNAL_USER'],
      permissions: [],
    });
    await expect(
      service.deleteDraft('min-1', { userId: 'other-user' }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('searchMinutesByPerson service logic', () => {
  let service: MinutesService;
  let dataSource: any;
  let userRepo: any;
  let minutesRepo: any;
  let qb: any;

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn().mockResolvedValue({
        id: 'target-1',
        fullName: 'Target',
        email: 'target@test.com',
      }),
    };
    qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
    };
    minutesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === UserEntity) return userRepo;
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === RoomEntity)
          return { find: jest.fn().mockResolvedValue([]) };
        return { find: jest.fn().mockResolvedValue([]) };
      }),
    };
    service = new MinutesService(
      dataSource,
      {} as any,
      {
        getEffectiveRolesAndPermissions: jest
          .fn()
          .mockResolvedValue({ roles: ['SYSTEM_ADMIN'] }),
      } as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
  });

  it('searches minutes by person successfully', async () => {
    const result = await service.searchMinutesByPerson(
      { userId: 'target-1' },
      { userId: 'admin-1' },
    );
    expect(result.items).toHaveLength(0);
    expect(result.person.fullName).toBe('Target');
  });

  it('throws NotFoundException when user not found', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(
      service.searchMinutesByPerson(
        { userId: 'target-1' },
        { userId: 'admin-1' },
      ),
    ).rejects.toThrow(NotFoundException);
  });

  it('returns empty items if manager has no departments', async () => {
    service = new MinutesService(
      dataSource,
      {} as any,
      {
        getEffectiveRolesAndPermissions: jest
          .fn()
          .mockResolvedValue({ roles: ['MANAGER'] }),
      } as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
    dataSource.getRepository.mockImplementation((entity: any) => {
      if (entity === UserEntity) return userRepo;
      if (entity === MeetingMinutesEntity) return minutesRepo;
      if (entity.name === 'DepartmentEntity' || entity === 'DepartmentEntity')
        return { find: jest.fn().mockResolvedValue([]) };
      return { find: jest.fn().mockResolvedValue([]) };
    });
    const result = await service.searchMinutesByPerson(
      { userId: 'target-1' },
      { userId: 'manager-1' },
    );
    expect(result.items).toHaveLength(0);
  });
});

describe('findMinutesDetail service logic', () => {
  let service: MinutesService;
  let dataSource: any;
  let minutesRepo: any;
  let userRepo: any;

  beforeEach(() => {
    minutesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'min-1',
          meetingId: 'meet-1',
          status: MeetingMinutesStatus.PUBLISHED,
          preparedBy: 'author-1',
          attendeesSnapshotJson: [
            {
              userId: 'note-taker-1',
              participantRole: ParticipantRole.NOTE_TAKER,
              attendanceStatus: 'present',
            },
          ],
          meeting: {
            id: 'meet-1',
            title: 'Họp A',
            hostId: 'host-1',
          },
        }),
      }),
    };
    userRepo = {
      find: jest.fn().mockResolvedValue([
        {
          id: 'note-taker-1',
          fullName: 'Note Taker',
          email: 'note@test.com',
        },
      ]),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === UserEntity) return userRepo;
        if (entity === MeetingParticipantEntity)
          return { count: jest.fn().mockResolvedValue(0) };
        if (entity === RoomEntity) return { findOne: jest.fn() };
        if (entity === TranscriptEntity) return { findOne: jest.fn() };
        if (entity === MediaFileEntity)
          return { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
        if (entity === MeetingMinutesShareEntity)
          return {
            count: jest.fn().mockResolvedValue(0),
            createQueryBuilder: jest.fn().mockReturnValue({
              leftJoin: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              select: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              getRawMany: jest.fn().mockResolvedValue([]),
            }),
          };
        return { findOne: jest.fn(), count: jest.fn().mockResolvedValue(0) };
      }),
    };
    service = new MinutesService(
      dataSource,
      {} as any,
      {
        getEffectiveRolesAndPermissions: jest
          .fn()
          .mockResolvedValue({ roles: ['SYSTEM_ADMIN'] }),
      } as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
  });

  it('retrieves minutes detail and correctly maps noteTaker from attendeesSnapshotJson', async () => {
    const result = await service.findMinutesDetail('min-1', {
      userId: 'admin-1',
    });
    expect(result.generalInfo.noteTaker?.fullName).toBe('Note Taker');
  });

  it('throws NotFoundException when minutes not found', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue(null);
    await expect(
      service.findMinutesDetail('min-1', { userId: 'admin-1' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws ForbiddenException when user cannot access draft', async () => {
    service = new MinutesService(
      dataSource,
      {} as any,
      {
        getEffectiveRolesAndPermissions: jest
          .fn()
          .mockResolvedValue({ roles: ['INTERNAL_USER'] }),
      } as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      id: 'min-1',
      meetingId: 'meet-1',
      status: MeetingMinutesStatus.DRAFT,
      preparedBy: 'author-1',
      meeting: { id: 'meet-1', hostId: 'host-1' },
    });
    await expect(
      service.findMinutesDetail('min-1', { userId: 'other-user' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when user cannot access published minutes (not participant/host)', async () => {
    service = new MinutesService(
      dataSource,
      {} as any,
      {
        getEffectiveRolesAndPermissions: jest
          .fn()
          .mockResolvedValue({ roles: ['INTERNAL_USER'] }),
      } as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      id: 'min-1',
      meetingId: 'meet-1',
      status: MeetingMinutesStatus.PUBLISHED,
      preparedBy: 'author-1',
      meeting: { id: 'meet-1', hostId: 'host-1' },
    });
    dataSource.getRepository.mockImplementation((entity: any) => {
      if (entity === MeetingMinutesEntity) return minutesRepo;
      if (entity === MeetingParticipantEntity)
        return { count: jest.fn().mockResolvedValue(0) };
      return { findOne: jest.fn(), count: jest.fn().mockResolvedValue(0) };
    });
    await expect(
      service.findMinutesDetail('min-1', { userId: 'other-user' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('[AC-003] participant co the doc draft dang live-share (isLiveShared=true)', async () => {
    service = new MinutesService(
      dataSource,
      {} as any,
      {
        getEffectiveRolesAndPermissions: jest
          .fn()
          .mockResolvedValue({ roles: ['INTERNAL_USER'] }),
      } as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      id: 'min-1',
      meetingId: 'meet-1',
      status: MeetingMinutesStatus.DRAFT,
      preparedBy: 'author-1',
      isLiveShared: true,
      versionNo: 1,
      meeting: { id: 'meet-1', hostId: 'host-1' },
    });
    dataSource.getRepository.mockImplementation((entity: any) => {
      if (entity === MeetingMinutesEntity) return minutesRepo;
      if (entity === MeetingParticipantEntity)
        return { count: jest.fn().mockResolvedValue(1) }; // isParticipant = true
      if (entity === UserEntity) return userRepo;
      if (entity === MediaFileEntity)
        return { find: jest.fn().mockResolvedValue([]), findOne: jest.fn() };
      if (entity === MeetingMinutesShareEntity)
        return {
          count: jest.fn().mockResolvedValue(0),
          createQueryBuilder: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            orderBy: jest.fn().mockReturnThis(),
            getRawMany: jest.fn().mockResolvedValue([]),
          }),
        };
      return { findOne: jest.fn(), count: jest.fn().mockResolvedValue(0) };
    });
    const result = await service.findMinutesDetail('min-1', {
      userId: 'participant-1',
    });
    expect(result.status).toBe(MeetingMinutesStatus.DRAFT);
    expect(result.isLiveShared).toBe(true);
  });

  it('[AC-006][REGRESSION] participant VAN bi chan khi isLiveShared=false — hanh vi cu giu nguyen', async () => {
    service = new MinutesService(
      dataSource,
      {} as any,
      {
        getEffectiveRolesAndPermissions: jest
          .fn()
          .mockResolvedValue({ roles: ['INTERNAL_USER'] }),
      } as any,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      id: 'min-1',
      meetingId: 'meet-1',
      status: MeetingMinutesStatus.DRAFT,
      preparedBy: 'author-1',
      isLiveShared: false,
      meeting: { id: 'meet-1', hostId: 'host-1' },
    });
    dataSource.getRepository.mockImplementation((entity: any) => {
      if (entity === MeetingMinutesEntity) return minutesRepo;
      if (entity === MeetingParticipantEntity)
        return { count: jest.fn().mockResolvedValue(1) }; // la participant that su
      return { findOne: jest.fn(), count: jest.fn().mockResolvedValue(0) };
    });
    await expect(
      service.findMinutesDetail('min-1', { userId: 'participant-1' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('[T009/FR-016] response luon chua field isLiveShared dung gia tri', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      id: 'min-1',
      meetingId: 'meet-1',
      status: MeetingMinutesStatus.PUBLISHED,
      preparedBy: 'author-1',
      isLiveShared: false,
      meeting: { id: 'meet-1', hostId: 'host-1' },
    });
    const result = await service.findMinutesDetail('min-1', {
      userId: 'admin-1',
    });
    expect(result.isLiveShared).toBe(false);
  });
});

describe('issueMinutes service logic', () => {
  let service: MinutesService;
  let dataSource: any;
  let em: any;
  let minutesRepo: any;
  let meetingRepo: any;
  let participantRepo: any;
  let authzRepo: any;
  let auditLogsService: any;
  let notificationRepo: any;
  let websocketService: { emitToRoom: jest.Mock };

  const authUser = { userId: 'host-1' };
  const minutesId = 'minutes-1';
  const meetingId = 'meeting-1';

  const baseMinutes = {
    id: minutesId,
    meetingId,
    preparedBy: 'host-1',
    status: MeetingMinutesStatus.DRAFT,
    versionNo: 1,
    title: 'Bien ban hop Sprint 12',
    issuedBy: null,
    issuedAt: null,
    approvedBy: null,
    visibilityLevel: MeetingMinutesVisibilityLevel.PRIVATE,
    isLiveShared: false,
    deletedAt: null,
    updatedAt: new Date('2026-07-02T09:00:00Z'),
  };

  const baseMeeting = {
    id: meetingId,
    hostId: 'host-1',
    status: MeetingStatus.COMPLETED,
    title: 'Hop Sprint 12',
  };

  beforeEach(() => {
    minutesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ ...baseMinutes }),
      }),
      save: jest.fn((m) => Promise.resolve({ ...m, updatedAt: new Date() })),
    };
    meetingRepo = {
      findOne: jest.fn().mockResolvedValue({ ...baseMeeting }),
    };
    participantRepo = {
      find: jest
        .fn()
        .mockResolvedValue([
          { userId: 'participant-1' },
          { userId: 'participant-2' },
          { userId: 'participant-3' },
        ]),
    };
    notificationRepo = {
      insert: jest.fn().mockResolvedValue({}),
    };
    em = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === MeetingParticipantEntity) return participantRepo;
        if (entity === NotificationEntity) return notificationRepo;
        throw new Error('Unexpected entity: ' + String(entity));
      }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((cb: any) => cb(em)),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingParticipantEntity) return participantRepo;
        if (entity === NotificationEntity) return notificationRepo;
        throw new Error(
          'Unexpected entity in getRepository: ' + String(entity),
        );
      }),
    };
    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    };
    auditLogsService = {
      logEntityChange: jest.fn().mockResolvedValue(undefined),
    };
    websocketService = { emitToRoom: jest.fn() };
    service = new MinutesService(
      dataSource,
      auditLogsService,
      authzRepo,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
      websocketService as any,
    );
  });

  it('should publish draft successfully when owner (preparedBy) calls', async () => {
    const result = await service.issueMinutes(minutesId, authUser);
    expect(result.status).toBe(MeetingMinutesStatus.PUBLISHED);
    expect(result.issuedBy).toBe('host-1');
    expect(result.issuedAt).toBeInstanceOf(Date);
    expect(result.id).toBe(minutesId);
  });

  it('should publish when caller is meeting host (not preparedBy)', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      preparedBy: 'author-1',
    });
    meetingRepo.findOne.mockResolvedValue({ ...baseMeeting, hostId: 'host-1' });
    const result = await service.issueMinutes(minutesId, authUser);
    expect(result.status).toBe(MeetingMinutesStatus.PUBLISHED);
  });

  it('should publish when Business Admin calls (bypass ownership)', async () => {
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['BUSINESS_ADMIN'],
      permissions: ['meeting.minutes.issue'],
    });
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      preparedBy: 'someone-else',
    });
    meetingRepo.findOne.mockResolvedValue({
      ...baseMeeting,
      hostId: 'someone-else',
    });
    const result = await service.issueMinutes(minutesId, authUser);
    expect(result.status).toBe(MeetingMinutesStatus.PUBLISHED);
  });

  it('should publish when System Admin calls (bypass ownership)', async () => {
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['SYSTEM_ADMIN'],
      permissions: ['meeting.minutes.issue'],
    });
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      preparedBy: 'someone-else',
    });
    meetingRepo.findOne.mockResolvedValue({
      ...baseMeeting,
      hostId: 'someone-else',
    });
    const result = await service.issueMinutes(minutesId, authUser);
    expect(result.status).toBe(MeetingMinutesStatus.PUBLISHED);
  });

  it('should write audit log with correct action_type', async () => {
    await service.issueMinutes(minutesId, authUser);
    expect(auditLogsService.logEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'host-1',
        actionType: 'meeting_minutes_issued',
        entityType: 'meeting_minutes',
        entityId: minutesId,
        oldValueJson: { status: MeetingMinutesStatus.DRAFT },
        newValueJson: expect.objectContaining({
          status: MeetingMinutesStatus.PUBLISHED,
          issuedBy: 'host-1',
        }),
      }),
    );
  });

  it('should create notification for participants excluding actor', async () => {
    participantRepo.find.mockResolvedValue([
      { userId: 'host-1' },
      { userId: 'participant-1' },
      { userId: 'participant-2' },
      { userId: 'participant-3' },
    ]);
    await service.issueMinutes(minutesId, authUser);
    expect(notificationRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        notificationType: NotificationType.MINUTES_DISTRIBUTION,
        channel: 'in_app',
        recipientUserIdsJson: [
          'participant-1',
          'participant-2',
          'participant-3',
        ],
        relatedEntityType: 'meeting_minutes',
        relatedEntityId: minutesId,
      }),
    );
  });

  it('should not create notification when participant list is empty (after excluding actor)', async () => {
    participantRepo.find.mockResolvedValue([{ userId: 'host-1' }]);
    await service.issueMinutes(minutesId, authUser);
    expect(notificationRepo.insert).not.toHaveBeenCalled();
  });

  it('should return notifiedParticipantCount = 0 when no other participants', async () => {
    participantRepo.find.mockResolvedValue([{ userId: 'host-1' }]);
    const result = await service.issueMinutes(minutesId, authUser);
    expect(result.notifiedParticipantCount).toBe(0);
  });

  it('should throw NOT_MINUTES_OWNER when caller is participant (not owner/admin)', async () => {
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: [],
      permissions: [],
    });
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      preparedBy: 'author-1',
    });
    meetingRepo.findOne.mockResolvedValue({ ...baseMeeting, hostId: 'host-1' });
    await expect(
      service.issueMinutes(minutesId, { userId: 'random-participant' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should throw MINUTES_NOT_DRAFT when status is published (even for Admin)', async () => {
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['BUSINESS_ADMIN'],
      permissions: [],
    });
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      status: MeetingMinutesStatus.PUBLISHED,
    });
    await expect(service.issueMinutes(minutesId, authUser)).rejects.toThrow(
      ConflictException,
    );
  });

  it('should throw MEETING_NOT_COMPLETED when meeting is in_progress (even for Admin)', async () => {
    authzRepo.getEffectiveRolesAndPermissions.mockResolvedValue({
      roles: ['BUSINESS_ADMIN'],
      permissions: [],
    });
    meetingRepo.findOne.mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.IN_PROGRESS,
    });
    await expect(service.issueMinutes(minutesId, authUser)).rejects.toThrow(
      ConflictException,
    );
  });

  it('should throw MEETING_NOT_COMPLETED when meeting is cancelled', async () => {
    meetingRepo.findOne.mockResolvedValue({
      ...baseMeeting,
      status: MeetingStatus.CANCELLED,
    });
    await expect(service.issueMinutes(minutesId, authUser)).rejects.toThrow(
      ConflictException,
    );
  });

  it('should throw MINUTES_NOT_FOUND when minutes does not exist', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue(null);
    await expect(service.issueMinutes(minutesId, authUser)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should throw MINUTES_NOT_FOUND when minutes is soft-deleted', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      deletedAt: new Date(),
    });
    await expect(service.issueMinutes(minutesId, authUser)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should not change approved_by or visibility_level after publish', async () => {
    const result = await service.issueMinutes(minutesId, authUser);
    expect(result).not.toHaveProperty('approvedBy');
    expect(result).not.toHaveProperty('visibilityLevel');
  });

  it('should handle notification insert failure gracefully (best-effort)', async () => {
    notificationRepo.insert.mockRejectedValue(
      new Error('DB error on notification'),
    );
    const result = await service.issueMinutes(minutesId, authUser);
    expect(result.status).toBe(MeetingMinutesStatus.PUBLISHED);
    expect(result.notifiedParticipantCount).toBe(0);
  });

  it('[AC-009][MKM-LIVE-01] tu tat isLiveShared va emit live_stopped khi ban hanh 1 ban dang live-share', async () => {
    minutesRepo.createQueryBuilder().getOne.mockResolvedValue({
      ...baseMinutes,
      isLiveShared: true,
    });
    const result = await service.issueMinutes(minutesId, authUser);
    expect(result.status).toBe(MeetingMinutesStatus.PUBLISHED);
    expect(minutesRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({ isLiveShared: false }),
    );
    expect(websocketService.emitToRoom).toHaveBeenCalledWith(
      `meeting:${meetingId}`,
      'minutes.draft.live_stopped',
      { minutesId },
    );
  });

  it('[FR-014][MKM-LIVE-01] khong emit gi them khi ban hanh 1 ban KHONG dang live-share', async () => {
    await service.issueMinutes(minutesId, authUser);
    expect(websocketService.emitToRoom).not.toHaveBeenCalled();
  });
});

describe('createDraft - MKM-MANUAL-01 source handling', () => {
  let service: MinutesService;
  let dataSource: any;
  let auditLogsService: any;
  let authzRepo: any;
  let minutesRepo: any;
  let meetingRepo: any;
  let participantRepo: any;
  let notificationRepo: any;
  let em: any;

  beforeEach(() => {
    minutesRepo = {
      findOne: jest.fn(),
      create: jest.fn((data) => data),
      save: jest.fn((data) => Promise.resolve({ id: 'minutes-1', ...data })),
    };
    auditLogsService = {
      logAction: jest.fn().mockResolvedValue(undefined),
    };
    meetingRepo = {
      createQueryBuilder: jest.fn().mockReturnValue({
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'meeting-1',
          hostId: 'host-1',
          status: MeetingStatus.COMPLETED,
          actualEndTime: new Date(),
        }),
      }),
      findOne: jest.fn().mockResolvedValue({ id: 'meeting-1' }),
    };
    participantRepo = { find: jest.fn().mockResolvedValue([]) };
    notificationRepo = { insert: jest.fn().mockResolvedValue({}) };
    em = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === MeetingParticipantEntity) return participantRepo;
        if (entity === NotificationEntity) return notificationRepo;
        throw new Error('Unexpected entity: ' + String(entity));
      }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      transaction: jest.fn((cb: any) => cb(em)),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === MeetingParticipantEntity) return participantRepo;
        if (entity === NotificationEntity) return notificationRepo;
        throw new Error('Unexpected entity: ' + String(entity));
      }),
    };
    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    };
    service = new MinutesService(
      dataSource,
      auditLogsService,
      authzRepo,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
  });

  it('creates manual draft successfully when AI minutes already exist for same meeting (AC-002)', async () => {
    minutesRepo.findOne.mockResolvedValue(null);
    const result = await service.createDraft(
      'meeting-1',
      { title: 'test' },
      { userId: 'host-1' },
    );
    expect(result.id).toBeDefined();
    expect(minutesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: MeetingMinutesSource.MANUAL }),
    );
  });

  it('rejects 409 when manual minutes already exist (AC-005)', async () => {
    minutesRepo.findOne.mockResolvedValue({
      id: 'existing-1',
      source: MeetingMinutesSource.MANUAL,
    });
    await expect(
      service.createDraft('meeting-1', { title: 'test' } as any, {
        userId: 'host-1',
      }),
    ).rejects.toThrow(ConflictException);
    try {
      await service.createDraft(
        'meeting-1',
        { title: 'test' },
        {
          userId: 'host-1',
        },
      );
    } catch (e: any) {
      const response = e.getResponse ? e.getResponse() : e.response;
      expect(response.error.details.source).toBe('manual');
    }
  });

  it('includes source=manual in audit log metadata', async () => {
    minutesRepo.findOne.mockResolvedValue(null);
    await service.createDraft(
      'meeting-1',
      { title: 'test' },
      {
        userId: 'host-1',
      },
    );
    expect(auditLogsService.logAction).toHaveBeenCalledWith(
      expect.objectContaining({
        metadataJson: expect.objectContaining({ source: 'manual' }),
      }),
    );
  });

  it('sets source=MANUAL in inserted minutes record', async () => {
    minutesRepo.findOne.mockResolvedValue(null);
    await service.createDraft(
      'meeting-1',
      { title: 'test' },
      {
        userId: 'host-1',
      },
    );
    expect(minutesRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ source: MeetingMinutesSource.MANUAL }),
    );
  });
});

describe('resolveOfficialMinutes', () => {
  let service: MinutesService;
  let dataSource: any;
  let auditLogsService: any;
  let authzRepo: any;
  let minutesRepo: any;

  beforeEach(() => {
    minutesRepo = {
      findOne: jest.fn(),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        throw new Error('Unexpected entity: ' + String(entity));
      }),
    };
    auditLogsService = { logAction: jest.fn() };
    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: [], permissions: [] }),
    };
    service = new MinutesService(
      dataSource,
      auditLogsService,
      authzRepo,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
  });

  it('returns manual minutes when both manual and AI exist (AC-009)', async () => {
    minutesRepo.findOne = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'manual-1',
        source: MeetingMinutesSource.MANUAL,
      })
      .mockResolvedValueOnce({ id: 'ai-1', source: MeetingMinutesSource.AI });
    const result = await service.resolveOfficialMinutes('meeting-1');
    expect(result).not.toBeNull();
    expect(result!.source).toBe(MeetingMinutesSource.MANUAL);
  });

  it('returns AI minutes when only AI exists (AC-010)', async () => {
    minutesRepo.findOne = jest
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'ai-1', source: MeetingMinutesSource.AI });
    const result = await service.resolveOfficialMinutes('meeting-1');
    expect(result).not.toBeNull();
    expect(result!.source).toBe(MeetingMinutesSource.AI);
  });

  it('returns null when no minutes exist', async () => {
    minutesRepo.findOne = jest.fn().mockResolvedValue(null);
    const result = await service.resolveOfficialMinutes('meeting-1');
    expect(result).toBeNull();
  });
});

describe('compareMinutes', () => {
  let service: MinutesService;
  let dataSource: any;
  let auditLogsService: any;
  let authzRepo: any;
  let minutesRepo: any;
  let meetingRepo: any;
  let mockQueryBuilder: any;

  beforeEach(() => {
    mockQueryBuilder = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    minutesRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
    meetingRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'meeting-1' }),
    };
    dataSource = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity: any) => {
        if (entity === MeetingMinutesEntity) return minutesRepo;
        if (entity === MeetingEntity) return meetingRepo;
        if (entity === RoomEntity)
          return { find: jest.fn().mockResolvedValue([]) };
        if (entity === UserEntity)
          return { find: jest.fn().mockResolvedValue([]) };
        throw new Error('Unexpected entity: ' + String(entity));
      }),
    };
    auditLogsService = { logAction: jest.fn() };
    authzRepo = {
      getEffectiveRolesAndPermissions: jest
        .fn()
        .mockResolvedValue({ roles: ['SYSTEM_ADMIN'], permissions: [] }),
    };
    service = new MinutesService(
      dataSource,
      auditLogsService,
      authzRepo,
      {} as any,
      { get: jest.fn() } as any,
      {} as any,
    );
  });

  it('returns both manual and AI when both exist (AC-006)', async () => {
    mockQueryBuilder.getMany.mockResolvedValue([
      {
        id: 'ai-1',
        source: MeetingMinutesSource.AI,
        meeting: { id: 'meeting-1' },
      },
      {
        id: 'manual-1',
        source: MeetingMinutesSource.MANUAL,
        meeting: { id: 'meeting-1' },
      },
    ]);
    const result = await service.compareMinutes('meeting-1', {
      userId: 'user-1',
    });
    expect(result.ai).toBeDefined();
    expect(result.manual).toBeDefined();
    expect(result.ai!.source).toBe(MeetingMinutesSource.AI);
    expect(result.manual!.source).toBe(MeetingMinutesSource.MANUAL);
  });

  it('returns null for manual when only AI exists (AC-007)', async () => {
    mockQueryBuilder.getMany.mockResolvedValue([
      {
        id: 'ai-1',
        source: MeetingMinutesSource.AI,
        meeting: { id: 'meeting-1' },
      },
    ]);
    const result = await service.compareMinutes('meeting-1', {
      userId: 'user-1',
    });
    expect(result.ai).toBeDefined();
    expect(result.manual).toBeNull();
  });

  it('throws 404 when meeting does not exist (AC-008)', async () => {
    meetingRepo.findOne.mockResolvedValue(null);
    await expect(
      service.compareMinutes('not-found', { userId: 'user-1' }),
    ).rejects.toThrow(NotFoundException);
  });
});
