import { MeetingSeriesService } from '../services/meeting-series.service.js';
import { MeetingPrepService } from '../services/meeting-prep.service.js';
import { Test, TestingModule } from '@nestjs/testing';
import { MeetingsController } from '../controllers/meetings.controller.js';
import { MeetingsService } from '../services/meetings.service.js';
import { MeetingRequestReviewService } from '../services/meeting-request-review.service.js';
import { ParticipantImportService } from '../services/participant-import.service.js';
import { MeetingListService } from '../services/meeting-list.service.js';
import { MeetingUpdateService } from '../services/meeting-update.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import {
  AgendaAttachmentUploadResponseDto,
  DeleteAgendaAttachmentResponseDto,
} from '../dto/agenda-attachment.dto.js';

describe('MeetingsController — Agenda Attachment endpoints', () => {
  let controller: MeetingsController;
  let meetingsService: {
    addAgendaAttachment: jest.Mock;
    removeAgendaAttachment: jest.Mock;
  };

  const meetingId = 'meeting-uuid';
  const agendaId = 'agenda-uuid';
  const fileId = 'file-uuid';

  const mockFile = {
    buffer: Buffer.from('fake-pdf'),
    originalname: 'report.pdf',
    mimetype: 'application/pdf',
    size: 1024,
  };

  const mockUploadResponse = new AgendaAttachmentUploadResponseDto({
    id: fileId,
    agendaId,
    meetingId,
    fileName: 'report.pdf',
    mimeType: 'application/pdf',
    fileSizeBytes: '1024',
    fileUrl: 'http://localhost/uploads/agenda-attachments/report.pdf',
    uploadedBy: 'organizer-uuid',
    uploadedAt: new Date('2026-08-04T10:00:00Z'),
  });

  const mockDeleteResponse = new DeleteAgendaAttachmentResponseDto({
    fileId,
    agendaId,
    deletedAt: new Date('2026-08-04T10:05:00Z'),
  });

  beforeEach(async () => {
    meetingsService = {
      addAgendaAttachment: jest.fn(),
      removeAgendaAttachment: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeetingsController],
      providers: [
        { provide: MeetingSeriesService, useValue: {} },
        { provide: MeetingPrepService, useValue: {} },
        { provide: MeetingsService, useValue: meetingsService },
        { provide: MeetingRequestReviewService, useValue: {} },
        { provide: ParticipantImportService, useValue: {} },
        { provide: MeetingListService, useValue: {} },
        { provide: MeetingUpdateService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<MeetingsController>(MeetingsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('addAgendaAttachment', () => {
    it('calls service.addAgendaAttachment and returns a 201-shaped success envelope', async () => {
      meetingsService.addAgendaAttachment.mockResolvedValue(mockUploadResponse);

      const result = await controller.addAgendaAttachment(
        meetingId,
        agendaId,
        mockFile,
        { userId: 'organizer-uuid' },
      );

      expect(meetingsService.addAgendaAttachment).toHaveBeenCalledWith(
        meetingId,
        agendaId,
        mockFile,
        'organizer-uuid',
      );
      expect(result).toEqual({
        success: true,
        message: 'Đã đính kèm tài liệu thành công',
        data: mockUploadResponse,
      });
    });

    it('propagates errors thrown by the service (e.g. AGENDA_WRITE_FORBIDDEN)', async () => {
      meetingsService.addAgendaAttachment.mockRejectedValue(
        new Error('AGENDA_WRITE_FORBIDDEN'),
      );

      await expect(
        controller.addAgendaAttachment(meetingId, agendaId, mockFile, {
          userId: 'participant-uuid',
        }),
      ).rejects.toThrow('AGENDA_WRITE_FORBIDDEN');
    });
  });

  describe('removeAgendaAttachment', () => {
    it('calls service.removeAgendaAttachment and returns a standard success envelope', async () => {
      meetingsService.removeAgendaAttachment.mockResolvedValue(
        mockDeleteResponse,
      );

      const result = await controller.removeAgendaAttachment(
        meetingId,
        agendaId,
        fileId,
        { userId: 'organizer-uuid' },
      );

      expect(meetingsService.removeAgendaAttachment).toHaveBeenCalledWith(
        meetingId,
        agendaId,
        fileId,
        'organizer-uuid',
      );
      expect(result).toEqual({
        success: true,
        message: 'Đã gỡ tài liệu đính kèm',
        data: mockDeleteResponse,
      });
    });

    it('propagates errors thrown by the service (e.g. AGENDA_ATTACHMENT_NOT_FOUND)', async () => {
      meetingsService.removeAgendaAttachment.mockRejectedValue(
        new Error('AGENDA_ATTACHMENT_NOT_FOUND'),
      );

      await expect(
        controller.removeAgendaAttachment(meetingId, agendaId, fileId, {
          userId: 'organizer-uuid',
        }),
      ).rejects.toThrow('AGENDA_ATTACHMENT_NOT_FOUND');
    });
  });
});
