/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { MeetingsService } from '../services/meetings.service.js';
import { MeetingEntity, MeetingStatus } from '../entities/meeting.entity.js';
import {
  MeetingAgendaEntity,
  AgendaStatus,
} from '../entities/meeting-agenda.entity.js';
import { MediaFileEntity } from '../../recording/entities/media-file.entity.js';

describe('MeetingsService — Agenda Attachment (feat-attach-meeting-agenda-document)', () => {
  const meetingId = 'meeting-1';
  const agendaId = 'agenda-1';
  const organizerId = 'organizer-1';

  const baseMeeting = {
    id: meetingId,
    status: MeetingStatus.SCHEDULED,
    organizerId,
    hostId: null,
    deletedAt: null,
  } as any;

  const baseAgenda = {
    id: agendaId,
    meetingId,
    agendaOrder: 1,
    title: 'Sprint review',
    status: AgendaStatus.PLANNED,
  } as any;

  const mockFile = {
    buffer: Buffer.from('fake-pdf'),
    originalname: 'report.pdf',
    mimetype: 'application/pdf',
    size: 1024 * 1024,
  };

  const mockCloudinaryResult = {
    publicId: 'agenda-attachments/uuid.pdf',
    secureUrl: 'https://res.cloudinary.com/demo/raw/upload/agenda-attachments/uuid.pdf',
  };

  describe('addAgendaAttachment', () => {
    let service: MeetingsService;
    let dataSource: { getRepository: jest.Mock; transaction: jest.Mock };
    let cloudinaryService: {
      uploadRawFile: jest.Mock;
      deleteRawFile: jest.Mock;
      resolveMediaStorageProvider: jest.Mock;
    };
    let configService: { get: jest.Mock };

    let outerMeetingRepo: { findOne: jest.Mock };
    let outerAgendaRepo: { findOne: jest.Mock };

    let meetingQb: { setLock: jest.Mock; where: jest.Mock; getOne: jest.Mock };
    let innerMeetingRepo: { createQueryBuilder: jest.Mock };
    let innerAgendaRepo: { findOne: jest.Mock };
    let mediaFileRepo: { count: jest.Mock; insert: jest.Mock };
    let em: { getRepository: jest.Mock; create: jest.Mock; save: jest.Mock };

    beforeEach(() => {
      outerMeetingRepo = {
        findOne: jest.fn().mockResolvedValue({ ...baseMeeting }),
      };
      outerAgendaRepo = {
        findOne: jest.fn().mockResolvedValue({ ...baseAgenda }),
      };

      meetingQb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ ...baseMeeting }),
      };
      innerMeetingRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(meetingQb),
      };
      innerAgendaRepo = {
        findOne: jest.fn().mockResolvedValue({ ...baseAgenda }),
      };
      mediaFileRepo = {
        count: jest.fn().mockResolvedValue(0),
        insert: jest.fn().mockResolvedValue(undefined),
      };
      em = {
        getRepository: jest.fn((entity: any) => {
          if (entity === MeetingEntity) return innerMeetingRepo;
          if (entity === MeetingAgendaEntity) return innerAgendaRepo;
          if (entity === MediaFileEntity) return mediaFileRepo;
          throw new Error('Unexpected entity: ' + String(entity));
        }),
        create: jest.fn((_entity: any, data: any) => data),
        save: jest.fn().mockResolvedValue(undefined),
      };

      dataSource = {
        getRepository: jest.fn((entity: any) => {
          if (entity === MeetingEntity) return outerMeetingRepo;
          if (entity === MeetingAgendaEntity) return outerAgendaRepo;
          throw new Error('Unexpected entity: ' + String(entity));
        }),
        transaction: jest.fn((cb: (m: any) => any) => cb(em)),
      };

      cloudinaryService = {
        uploadRawFile: jest.fn().mockResolvedValue(mockCloudinaryResult),
        deleteRawFile: jest.fn().mockResolvedValue(undefined),
        resolveMediaStorageProvider: jest.fn().mockReturnValue('cloud_provider'),
      };
      configService = {
        get: jest.fn((_key: string, defaultValue?: any) => defaultValue),
      };

      service = new MeetingsService(
        dataSource as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        configService as any,
        {} as any,
        {} as any,
        undefined,
        undefined,
        cloudinaryService as any,
      );
    });

    it('uploads a file successfully', async () => {
      const result = await service.addAgendaAttachment(
        meetingId,
        agendaId,
        mockFile,
        organizerId,
      );

      expect(result.agendaId).toBe(agendaId);
      expect(result.meetingId).toBe(meetingId);
      expect(result.fileName).toBe('report.pdf');
      expect(result.mimeType).toBe('application/pdf');
      expect(result.uploadedBy).toBe(organizerId);
      expect(cloudinaryService.uploadRawFile).toHaveBeenCalledWith(
        mockFile.buffer,
        expect.stringContaining('agenda-attachments/'),
      );
      expect(mediaFileRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          relatedEntityType: 'meeting_agenda',
          relatedEntityId: agendaId,
          meetingId,
          fileType: 'document',
        }),
      );
    });

    // REGRESSION (2026-08-05): Multer/Busboy giải mã header filename multipart
    // theo latin1 mặc định; trình duyệt gửi byte UTF-8 thật cho tên có dấu →
    // ra mojibake nếu không sửa (phát hiện khi test thật với file
    // "SRS-tiếng-Việt-3.docx" → lưu thành "SRS-tiáº¿ng-Viá»t-3.docx").
    it('normalizes a UTF-8 filename that Multer mis-decoded as latin1 (mojibake fix)', async () => {
      const correctName = 'SRS-tiếng-Việt-3.docx';
      const mojibakeName = Buffer.from(correctName, 'utf8').toString('latin1');
      const file = {
        ...mockFile,
        originalname: mojibakeName,
        mimetype:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      };

      const result = await service.addAgendaAttachment(
        meetingId,
        agendaId,
        file,
        organizerId,
      );

      expect(result.fileName).toBe(correctName);
      expect(mediaFileRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({ fileName: correctName }),
      );
    });

    it('keeps a plain ASCII filename unchanged', async () => {
      const result = await service.addAgendaAttachment(
        meetingId,
        agendaId,
        mockFile,
        organizerId,
      );
      expect(result.fileName).toBe('report.pdf');
    });

    it('throws AGENDA_ATTACHMENT_FILE_REQUIRED when no file', async () => {
      await expect(
        service.addAgendaAttachment(
          meetingId,
          agendaId,
          undefined,
          organizerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws AGENDA_ATTACHMENT_FILE_TOO_LARGE', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'AGENDA_ATTACHMENT_MAX_BYTES') return 100;
        return undefined;
      });
      await expect(
        service.addAgendaAttachment(meetingId, agendaId, mockFile, organizerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws AGENDA_ATTACHMENT_FILE_TYPE_INVALID for disallowed mimetype', async () => {
      await expect(
        service.addAgendaAttachment(
          meetingId,
          agendaId,
          { ...mockFile, mimetype: 'application/x-msdownload' },
          organizerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws AGENDA_ATTACHMENT_FILE_TYPE_INVALID when extension does not match mimetype', async () => {
      await expect(
        service.addAgendaAttachment(
          meetingId,
          agendaId,
          { ...mockFile, originalname: 'report.png' },
          organizerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws MEETING_NOT_FOUND when meeting does not exist', async () => {
      outerMeetingRepo.findOne.mockResolvedValue(null);
      await expect(
        service.addAgendaAttachment(meetingId, agendaId, mockFile, organizerId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws AGENDA_WRITE_FORBIDDEN when caller is not organizer/host', async () => {
      await expect(
        service.addAgendaAttachment(
          meetingId,
          agendaId,
          mockFile,
          'someone-else',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws AGENDA_MEETING_STATUS_BLOCKED when meeting is not pending_approval/scheduled', async () => {
      outerMeetingRepo.findOne.mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.CANCELLED,
      });
      await expect(
        service.addAgendaAttachment(meetingId, agendaId, mockFile, organizerId),
      ).rejects.toThrow(ConflictException);
    });

    it('throws AGENDA_ITEM_NOT_FOUND when agenda item does not belong to meeting', async () => {
      outerAgendaRepo.findOne.mockResolvedValue(null);
      await expect(
        service.addAgendaAttachment(meetingId, agendaId, mockFile, organizerId),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws AGENDA_ATTACHMENT_STORAGE_FAILED when storage save fails', async () => {
      cloudinaryService.uploadRawFile.mockRejectedValue(new Error('disk full'));
      await expect(
        service.addAgendaAttachment(meetingId, agendaId, mockFile, organizerId),
      ).rejects.toThrow(BadGatewayException);
    });

    it('throws AGENDA_ATTACHMENT_LIMIT_EXCEEDED when max count reached', async () => {
      mediaFileRepo.count.mockResolvedValue(5);
      await expect(
        service.addAgendaAttachment(meetingId, agendaId, mockFile, organizerId),
      ).rejects.toThrow(ConflictException);
    });

    it('cleans up orphan storage file when the DB transaction fails', async () => {
      dataSource.transaction.mockRejectedValue(new Error('DB error'));
      await expect(
        service.addAgendaAttachment(meetingId, agendaId, mockFile, organizerId),
      ).rejects.toThrow();
      expect(cloudinaryService.deleteRawFile).toHaveBeenCalledWith(
        mockCloudinaryResult.publicId,
      );
    });
  });

  describe('removeAgendaAttachment', () => {
    let service: MeetingsService;
    let dataSource: { transaction: jest.Mock };
    let cloudinaryService: { uploadRawFile: jest.Mock; deleteRawFile: jest.Mock };
    let configService: { get: jest.Mock };

    let meetingQb: { setLock: jest.Mock; where: jest.Mock; getOne: jest.Mock };
    let meetingRepo: { createQueryBuilder: jest.Mock };
    let agendaRepo: { findOne: jest.Mock };
    let mediaFileRepo: { findOne: jest.Mock; update: jest.Mock };
    let em: { getRepository: jest.Mock; create: jest.Mock; save: jest.Mock };

    const fileId = 'file-1';
    const mockMediaFile = {
      id: fileId,
      relatedEntityType: 'meeting_agenda',
      relatedEntityId: agendaId,
      storageKey: 'agenda-attachments/file-1.pdf',
      deletedAt: null,
    };

    beforeEach(() => {
      meetingQb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ ...baseMeeting }),
      };
      meetingRepo = {
        createQueryBuilder: jest.fn().mockReturnValue(meetingQb),
      };
      agendaRepo = { findOne: jest.fn().mockResolvedValue({ ...baseAgenda }) };
      mediaFileRepo = {
        findOne: jest.fn().mockResolvedValue({ ...mockMediaFile }),
        update: jest.fn().mockResolvedValue(undefined),
      };
      em = {
        getRepository: jest.fn((entity: any) => {
          if (entity === MeetingEntity) return meetingRepo;
          if (entity === MeetingAgendaEntity) return agendaRepo;
          if (entity === MediaFileEntity) return mediaFileRepo;
          throw new Error('Unexpected entity: ' + String(entity));
        }),
        create: jest.fn((_entity: any, data: any) => data),
        save: jest.fn().mockResolvedValue(undefined),
      };
      dataSource = { transaction: jest.fn((cb: (m: any) => any) => cb(em)) };
      cloudinaryService = {
        uploadRawFile: jest.fn(),
        deleteRawFile: jest.fn().mockResolvedValue(undefined),
      };
      configService = {
        get: jest.fn((_key: string, defaultValue?: any) => defaultValue),
      };

      service = new MeetingsService(
        dataSource as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        configService as any,
        {} as any,
        {} as any,
        undefined,
        undefined,
        cloudinaryService as any,
      );
    });

    it('deletes an attachment successfully (soft-delete + best-effort storage cleanup)', async () => {
      const result = await service.removeAgendaAttachment(
        meetingId,
        agendaId,
        fileId,
        organizerId,
      );

      expect(result.fileId).toBe(fileId);
      expect(result.agendaId).toBe(agendaId);
      expect(mediaFileRepo.update).toHaveBeenCalledWith(
        { id: fileId },
        expect.objectContaining({ deletedAt: expect.any(Date) }),
      );
      expect(cloudinaryService.deleteRawFile).toHaveBeenCalledWith(
        mockMediaFile.storageKey,
      );
    });

    it('throws MEETING_NOT_FOUND when meeting does not exist', async () => {
      meetingQb.getOne.mockResolvedValue(null);
      await expect(
        service.removeAgendaAttachment(
          meetingId,
          agendaId,
          fileId,
          organizerId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws AGENDA_WRITE_FORBIDDEN when caller is not organizer/host', async () => {
      await expect(
        service.removeAgendaAttachment(
          meetingId,
          agendaId,
          fileId,
          'someone-else',
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws AGENDA_MEETING_STATUS_BLOCKED when meeting is not writable', async () => {
      meetingQb.getOne.mockResolvedValue({
        ...baseMeeting,
        status: MeetingStatus.COMPLETED,
      });
      await expect(
        service.removeAgendaAttachment(
          meetingId,
          agendaId,
          fileId,
          organizerId,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('throws AGENDA_ITEM_NOT_FOUND when agenda item does not belong to meeting', async () => {
      agendaRepo.findOne.mockResolvedValue(null);
      await expect(
        service.removeAgendaAttachment(
          meetingId,
          agendaId,
          fileId,
          organizerId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws AGENDA_ATTACHMENT_NOT_FOUND when file is already deleted/missing (idempotent delete)', async () => {
      mediaFileRepo.findOne.mockResolvedValue(null);
      await expect(
        service.removeAgendaAttachment(
          meetingId,
          agendaId,
          fileId,
          organizerId,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getAgendas — batched attachments (FR-007, no N+1)', () => {
    let service: MeetingsService;
    let dataSource: { getRepository: jest.Mock };
    let configService: { get: jest.Mock };
    let storageService: { saveFile: jest.Mock; deleteFile: jest.Mock };

    const otherAgendaId = 'agenda-2';

    beforeEach(() => {
      configService = {
        get: jest.fn((_key: string, defaultValue?: any) => defaultValue),
      };
      storageService = { saveFile: jest.fn(), deleteFile: jest.fn() };

      const meetingRepo = {
        findOne: jest.fn().mockResolvedValue({
          id: meetingId,
          organizerId,
          hostId: null,
          deletedAt: null,
          startTime: new Date('2026-07-01T09:00:00Z'),
          endTime: new Date('2026-07-01T10:00:00Z'),
          status: MeetingStatus.SCHEDULED,
        }),
      };
      const agendaRepo = {
        find: jest.fn().mockResolvedValue([
          { ...baseAgenda, id: agendaId, owner: null },
          { ...baseAgenda, id: otherAgendaId, owner: null },
        ]),
      };
      const mediaFileFind = jest.fn().mockResolvedValue([
        {
          id: 'file-1',
          relatedEntityId: agendaId,
          fileName: 'a.pdf',
          mimeType: 'application/pdf',
          fileSizeBytes: '100',
          fileUrl: 'http://x/a.pdf',
          uploadedBy: organizerId,
          uploadedAt: new Date(),
        },
      ]);
      const mediaFileRepo = { find: mediaFileFind };

      dataSource = {
        getRepository: jest.fn((entity: any) => {
          if (entity === MeetingEntity) return meetingRepo;
          if (entity === MeetingAgendaEntity) return agendaRepo;
          if (entity === MediaFileEntity) return mediaFileRepo;
          throw new Error('Unexpected entity: ' + String(entity));
        }),
      };

      service = new MeetingsService(
        dataSource as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        configService as any,
        storageService as any,
        {} as any,
      );
    });

    it('loads attachments for all agenda items with a single MediaFile query', async () => {
      const result = await service.getAgendas(meetingId, organizerId);

      expect(result.items).toHaveLength(2);
      const withAttachment = result.items.find((i) => i.id === agendaId);
      const withoutAttachment = result.items.find(
        (i) => i.id === otherAgendaId,
      );

      expect(withAttachment?.attachments).toHaveLength(1);
      expect(withAttachment?.attachments?.[0].fileName).toBe('a.pdf');
      expect(withoutAttachment?.attachments).toEqual([]);

      const mediaFileRepo = dataSource.getRepository(MediaFileEntity);
      expect(mediaFileRepo.find).toHaveBeenCalledTimes(1);
    });
  });
});
