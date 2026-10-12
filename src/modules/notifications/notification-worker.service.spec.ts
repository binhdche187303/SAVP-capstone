import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { NotificationWorkerService } from './notification-worker.service.js';
import { MailService } from '../mail/mail.service.js';
import { StorageService } from '../storage/storage.service.js';
import { BackgroundJobsService } from '../administration/services/background-jobs.service.js';
import {
  BackgroundJobEntity,
  BackgroundJobStatus,
} from '../administration/entities/background-job.entity.js';
import {
  NotificationEntity,
  NotificationDeliveryStatus,
} from './entities/notification.entity.js';

function makeMockJob(overrides: Partial<Job> & { data: any }): Job {
  return {
    id: 'bull-job-001',
    name: 'send-email',
    attemptsMade: 0,
    opts: { attempts: 3 } as any,
    ...overrides,
  } as unknown as Job;
}

describe('NotificationWorkerService', () => {
  let service: NotificationWorkerService;
  let mailService: jest.Mocked<MailService>;
  let backgroundJobsService: jest.Mocked<BackgroundJobsService>;
  let storageService: jest.Mocked<any>;
  let notificationRepo: jest.Mocked<any>;
  let bgJobRepo: jest.Mocked<any>;

  const testData = {
    notificationId: 'notif-uuid-1',
    backgroundJobId: 'bgjob-uuid-1',
    toEmails: ['user@example.com'],
    subject: 'Test Subject',
    content: '<p>Hello</p>',
  };

  beforeEach(async () => {
    mailService = {
      sendMail: jest.fn(),
    } as any;

    backgroundJobsService = {
      markCompleted: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
      markRetrying: jest.fn().mockResolvedValue(undefined),
    } as any;

    notificationRepo = {
      findOne: jest.fn(),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    bgJobRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };

    storageService = {
      downloadFile: jest.fn().mockResolvedValue(Buffer.from('PDF_BYTES')),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationWorkerService,
        { provide: MailService, useValue: mailService },
        { provide: BackgroundJobsService, useValue: backgroundJobsService },
        { provide: StorageService, useValue: storageService },
        {
          provide: getRepositoryToken(NotificationEntity),
          useValue: notificationRepo,
        },
        {
          provide: getRepositoryToken(BackgroundJobEntity),
          useValue: bgJobRepo,
        },
      ],
    }).compile();

    service = module.get<NotificationWorkerService>(NotificationWorkerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── T1: Email sent successfully ──
  it('[T1] should send email and mark notification SENT + bg_job COMPLETED', async () => {
    mailService.sendMail.mockResolvedValue({
      success: true,
      messageId: 'msg-001',
    });
    notificationRepo.findOne.mockResolvedValue({
      id: testData.notificationId,
      deliveryStatus: NotificationDeliveryStatus.QUEUED,
    });

    const job = makeMockJob({ data: testData, attemptsMade: 0 });
    const result = await service.process(job);

    expect(result.sent).toBe(true);
    expect(result.notificationId).toBe(testData.notificationId);

    // Marked RUNNING on first attempt
    expect(bgJobRepo.update).toHaveBeenCalledWith(testData.backgroundJobId, {
      status: BackgroundJobStatus.RUNNING,
      startedAt: expect.any(Date),
    });

    // Called mailService — no emailHtml provided, so worker wraps plain content
    // into the shared branded layout and derives a stripped-tag text fallback.
    expect(mailService.sendMail).toHaveBeenCalledWith({
      to: ['user@example.com'],
      subject: 'Test Subject',
      html: expect.stringContaining('Hello'),
      text: 'Hello',
    });

    // Marked notification SENT
    expect(notificationRepo.update).toHaveBeenCalledWith(
      testData.notificationId,
      {
        deliveryStatus: NotificationDeliveryStatus.SENT,
        sentAt: expect.any(Date),
        deliveryResultJson: { messageId: 'msg-001' },
      },
    );

    // completed event handler marks bg_job COMPLETED
    await service.onJobCompleted(job);
    expect(backgroundJobsService.markCompleted).toHaveBeenCalledWith(
      testData.backgroundJobId,
      { bullJobId: 'bull-job-001' },
    );
  });

  it('[T1b] should download attachment from storage and pass it to sendMail', async () => {
    mailService.sendMail.mockResolvedValue({
      success: true,
      messageId: 'msg-002',
    });
    notificationRepo.findOne.mockResolvedValue({
      id: testData.notificationId,
      deliveryStatus: NotificationDeliveryStatus.QUEUED,
    });

    const job = makeMockJob({
      data: {
        ...testData,
        attachment: {
          storageKey: 'exports/minutes-1.pdf',
          fileName: 'Bien_ban.pdf',
          mimeType: 'application/pdf',
        },
      },
      attemptsMade: 0,
    });
    await service.process(job);

    expect(storageService.downloadFile).toHaveBeenCalledWith(
      'exports/minutes-1.pdf',
    );
    expect(mailService.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        attachments: [
          {
            filename: 'Bien_ban.pdf',
            content: Buffer.from('PDF_BYTES'),
            contentType: 'application/pdf',
          },
        ],
      }),
    );
  });

  it('[T1c] RPT-CENTER: attachments[] → mọi tệp được tải và gửi, tên có dấu giữ nguyên', async () => {
    mailService.sendMail.mockResolvedValue({ success: true, messageId: 'msg-003' });
    notificationRepo.findOne.mockResolvedValue({ id: testData.notificationId, deliveryStatus: NotificationDeliveryStatus.QUEUED });
    const job = makeMockJob({
      data: {
        ...testData,
        attachments: [
          { storageKey: 'exports/a.pdf', fileName: 'Báo cáo Ra vào.pdf', mimeType: 'application/pdf' },
          { storageKey: 'exports/b.xlsx', fileName: 'Bảng dữ liệu.xlsx', mimeType: 'application/vnd.ms-excel' },
          { storageKey: 'exports/c.docx', fileName: 'Văn bản.docx', mimeType: 'application/msword' },
        ],
      },
      attemptsMade: 0,
    });
    await service.process(job);
    const sent = (mailService.sendMail as jest.Mock).mock.calls[0][0].attachments;
    expect(sent.map((a: { filename: string }) => a.filename)).toEqual(['Báo cáo Ra vào.pdf', 'Bảng dữ liệu.xlsx', 'Văn bản.docx']);
    expect(storageService.downloadFile).toHaveBeenCalledTimes(3);
  });

  it('[T1d] RPT-CENTER: có cả attachment cũ và attachments[] → gộp, không trùng storageKey', async () => {
    mailService.sendMail.mockResolvedValue({ success: true, messageId: 'msg-004' });
    notificationRepo.findOne.mockResolvedValue({ id: testData.notificationId, deliveryStatus: NotificationDeliveryStatus.QUEUED });
    const same = { storageKey: 'exports/x.pdf', fileName: 'x.pdf', mimeType: 'application/pdf' };
    const job = makeMockJob({
      data: { ...testData, attachment: same, attachments: [same, { storageKey: 'exports/y.pdf', fileName: 'y.pdf', mimeType: 'application/pdf' }] },
      attemptsMade: 0,
    });
    await service.process(job);
    const sent = (mailService.sendMail as jest.Mock).mock.calls[0][0].attachments;
    expect(sent.map((a: { filename: string }) => a.filename)).toEqual(['x.pdf', 'y.pdf']);
  });

  it('[T1e] RPT-CENTER: một tệp tải lỗi → job ném để BullMQ thử lại, không gửi mail thiếu tệp', async () => {
    notificationRepo.findOne.mockResolvedValue({ id: testData.notificationId, deliveryStatus: NotificationDeliveryStatus.QUEUED });
    (storageService.downloadFile as jest.Mock).mockRejectedValueOnce(new Error('S3 timeout'));
    const job = makeMockJob({
      data: { ...testData, attachments: [{ storageKey: 'exports/a.pdf', fileName: 'a.pdf', mimeType: 'application/pdf' }] },
      attemptsMade: 0,
    });
    await expect(service.process(job)).rejects.toThrow('S3 timeout');
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  // ── T2: Email fails, retries remain ──
  it('[T2] should throw error and mark bg_job RETRYING when email fails with retries left', async () => {
    mailService.sendMail.mockResolvedValue({
      success: false,
      error: 'SMTP timeout',
    });
    notificationRepo.findOne.mockResolvedValue({
      id: testData.notificationId,
      deliveryStatus: NotificationDeliveryStatus.QUEUED,
    });

    const job = makeMockJob({
      data: testData,
      attemptsMade: 1,
      opts: { attempts: 3 },
    });

    // process should throw so BullMQ retries
    await expect(service.process(job)).rejects.toThrow('SMTP timeout');

    // failed event with retries left
    await service.onJobFailed(job, new Error('SMTP timeout'));
    expect(backgroundJobsService.markRetrying).toHaveBeenCalledWith(
      testData.backgroundJobId,
    );
    expect(bgJobRepo.update).toHaveBeenCalledWith(testData.backgroundJobId, {
      errorMessage: 'SMTP timeout',
    });
    // NOT mark failed
    expect(backgroundJobsService.markFailed).not.toHaveBeenCalled();
    expect(notificationRepo.update).not.toHaveBeenCalledWith(
      testData.notificationId,
      expect.objectContaining({
        deliveryStatus: NotificationDeliveryStatus.FAILED,
      }),
    );
  });

  // ── T3: Email fails, final attempt exhausted ──
  it('[T3] should mark notification FAILED + bg_job FAILED when final attempt exhausted', async () => {
    mailService.sendMail.mockResolvedValue({
      success: false,
      error: 'Connection refused',
    });
    notificationRepo.findOne.mockResolvedValue({
      id: testData.notificationId,
      deliveryStatus: NotificationDeliveryStatus.QUEUED,
    });

    const job = makeMockJob({
      data: testData,
      attemptsMade: 3,
      opts: { attempts: 3 },
    });

    await expect(service.process(job)).rejects.toThrow('Connection refused');

    // failed event with final attempt
    await service.onJobFailed(job, new Error('Connection refused'));
    expect(notificationRepo.update).toHaveBeenCalledWith(
      testData.notificationId,
      {
        deliveryStatus: NotificationDeliveryStatus.FAILED,
        failureReason: 'Connection refused',
      },
    );
    expect(backgroundJobsService.markFailed).toHaveBeenCalledWith(
      testData.backgroundJobId,
      'Connection refused',
    );
    // NOT mark retrying
    expect(backgroundJobsService.markRetrying).not.toHaveBeenCalled();
  });

  // ── T4: Notification already SENT (idempotent) ──
  it('[T4] should skip and mark bg_job COMPLETED when notification already SENT', async () => {
    notificationRepo.findOne.mockResolvedValue({
      id: testData.notificationId,
      deliveryStatus: NotificationDeliveryStatus.SENT,
    });

    const job = makeMockJob({ data: testData });
    const result = await service.process(job);

    expect(result.sent).toBe(false);
    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(backgroundJobsService.markCompleted).toHaveBeenCalledWith(
      testData.backgroundJobId,
    );
  });

  // ── T5: Notification missing ──
  it('[T5] should skip gracefully when notification not found', async () => {
    notificationRepo.findOne.mockResolvedValue(null);

    const job = makeMockJob({ data: testData });
    const result = await service.process(job);

    expect(result.sent).toBe(false);
    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(backgroundJobsService.markCompleted).toHaveBeenCalledWith(
      testData.backgroundJobId,
    );
  });

  // ── T6: Multiple recipients ──
  it('[T6] should send email to multiple recipients', async () => {
    mailService.sendMail.mockResolvedValue({
      success: true,
      messageId: 'msg-002',
    });
    notificationRepo.findOne.mockResolvedValue({
      id: testData.notificationId,
      deliveryStatus: NotificationDeliveryStatus.QUEUED,
    });

    const multiData = {
      ...testData,
      toEmails: ['user1@example.com', 'user2@example.com'],
    };

    const job = makeMockJob({ data: multiData, attemptsMade: 0 });
    await service.process(job);

    expect(mailService.sendMail).toHaveBeenCalledWith({
      to: ['user1@example.com', 'user2@example.com'],
      subject: 'Test Subject',
      html: expect.stringContaining('Hello'),
      text: 'Hello',
    });
  });

  // ── Unknown job type ──
  it('should skip unknown job types gracefully', async () => {
    const job = makeMockJob({ name: 'unknown-job', data: {} });
    const result = await service.process(job);
    expect(result.sent).toBe(false);
    expect(mailService.sendMail).not.toHaveBeenCalled();
  });

  // ── Already FAILED notification ──
  it('should skip when notification already FAILED', async () => {
    notificationRepo.findOne.mockResolvedValue({
      id: testData.notificationId,
      deliveryStatus: NotificationDeliveryStatus.FAILED,
    });

    const job = makeMockJob({ data: testData });
    const result = await service.process(job);

    expect(result.sent).toBe(false);
    expect(mailService.sendMail).not.toHaveBeenCalled();
    expect(backgroundJobsService.markCompleted).toHaveBeenCalledWith(
      testData.backgroundJobId,
    );
  });

  // ── failed event with undefined job ──
  it('should handle onJobFailed with undefined job gracefully', async () => {
    await expect(
      service.onJobFailed(undefined, new Error('test')),
    ).resolves.toBeUndefined();
  });
});
