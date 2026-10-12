import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { MailService } from '../mail/mail.service.js';
import {
  escapeHtml,
  renderEmailLayout,
  renderParagraph,
} from '../mail/templates/layout.js';
import { BackgroundJobsService } from '../administration/services/background-jobs.service.js';
import {
  BackgroundJobEntity,
  BackgroundJobStatus,
} from '../administration/entities/background-job.entity.js';
import {
  NotificationEntity,
  NotificationDeliveryStatus,
} from './entities/notification.entity.js';
import { StorageService } from '../storage/storage.service.js';

interface SendEmailJobAttachment {
  storageKey: string;
  fileName: string;
  mimeType: string;
}

interface SendEmailJobData {
  notificationId: string;
  backgroundJobId: string;
  toEmails: string[];
  subject: string;
  content: string;
  emailHtml?: string;
  payloadJson?: Record<string, unknown>;
  /** File đính kèm (VD: PDF biên bản gửi khách ngoài) — tải bytes từ storage ngay trước khi gửi. */
  attachment?: SendEmailJobAttachment;
  /** Nhiều tệp đính kèm (RPT-CENTER: báo cáo định kỳ). Gộp với `attachment` cũ, bỏ trùng storageKey. */
  attachments?: SendEmailJobAttachment[];
}

@Injectable()
@Processor('notification')
export class NotificationWorkerService extends WorkerHost {
  private readonly logger = new Logger(NotificationWorkerService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly storageService: StorageService,
    @InjectRepository(NotificationEntity)
    private readonly notificationRepo: Repository<NotificationEntity>,
    @InjectRepository(BackgroundJobEntity)
    private readonly bgJobRepo: Repository<BackgroundJobEntity>,
  ) {
    super();
  }

  async process(
    job: Job<SendEmailJobData>,
  ): Promise<{ sent: boolean; notificationId: string }> {
    if (job.name !== 'send-email') {
      this.logger.warn(`[Worker] Unknown job type "${job.name}" � skipping`);
      return { sent: false, notificationId: '' };
    }

    const {
      notificationId,
      backgroundJobId,
      toEmails,
      subject,
      content,
      emailHtml,
      attachment,
      attachments: attachmentList,
    } = job.data;

    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });

    if (!notification) {
      this.logger.warn(
        `[Worker] Notification ${notificationId} not found � discarding job ${job.id}`,
      );
      await this.backgroundJobsService.markCompleted(backgroundJobId);
      return { sent: false, notificationId };
    }

    if (
      notification.deliveryStatus === NotificationDeliveryStatus.SENT ||
      notification.deliveryStatus === NotificationDeliveryStatus.FAILED ||
      notification.deliveryStatus === NotificationDeliveryStatus.CANCELLED
    ) {
      this.logger.warn(
        `[Worker] Notification ${notificationId} already ${notification.deliveryStatus} � skipping`,
      );
      await this.backgroundJobsService.markCompleted(backgroundJobId);
      return { sent: false, notificationId };
    }

    if (job.attemptsMade === 0) {
      await this.bgJobRepo.update(backgroundJobId, {
        status: BackgroundJobStatus.RUNNING,
        startedAt: new Date(),
      });
    }

    const recipients = Array.isArray(toEmails) ? toEmails : [toEmails];

    // Đính kèm (VD: PDF biên bản gửi khách ngoài) — tải bytes ngay trước khi
    // gửi thay vì mang buffer qua Redis job payload (payload chỉ mang storageKey).
    let attachments:
      | { filename: string; content: Buffer; contentType?: string }[]
      | undefined;
    const sources: SendEmailJobAttachment[] = [];
    for (const a of [...(attachment ? [attachment] : []), ...(attachmentList ?? [])]) {
      if (!sources.some((x) => x.storageKey === a.storageKey)) sources.push(a);
    }
    if (sources.length > 0) {
      // Một tệp tải lỗi → ném lỗi để BullMQ thử lại, tuyệt đối không gửi email thiếu tệp.
      attachments = [];
      for (const a of sources) {
        attachments.push({ filename: a.fileName, content: await this.storageService.downloadFile(a.storageKey), contentType: a.mimeType });
      }
    }

    const result = await this.mailService.sendMail({
      to: recipients,
      subject: subject || '(No subject)',
      html: emailHtml || this.wrapPlainTextAsHtml(content),
      text: this.stripHtmlTags(content),
      attachments,
    });

    if (!result.success) {
      throw new Error(result.error || 'MailService returned failure');
    }

    await this.notificationRepo.update(notificationId, {
      deliveryStatus: NotificationDeliveryStatus.SENT,
      sentAt: new Date(),
      deliveryResultJson: result.messageId
        ? { messageId: result.messageId }
        : null,
    });

    this.logger.log(
      `[Worker] Email sent � notification ${notificationId}, job ${job.id}`,
    );
    return { sent: true, notificationId };
  }

  @OnWorkerEvent('completed')
  async onJobCompleted(job: Job<SendEmailJobData>): Promise<void> {
    if (job.name !== 'send-email') return;
    await this.backgroundJobsService.markCompleted(job.data.backgroundJobId, {
      bullJobId: job.id,
    });
  }

  @OnWorkerEvent('failed')
  async onJobFailed(
    job: Job<SendEmailJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job || job.name !== 'send-email') return;
    const { notificationId, backgroundJobId } = job.data;
    const maxAttempts = job.opts.attempts || 3;
    const isFinal = job.attemptsMade >= maxAttempts;

    if (isFinal) {
      await this.notificationRepo.update(notificationId, {
        deliveryStatus: NotificationDeliveryStatus.FAILED,
        failureReason: error.message,
      });
      await this.backgroundJobsService.markFailed(
        backgroundJobId,
        error.message,
      );
      this.logger.error(
        `[Worker] Job ${job.id} FAILED after ${job.attemptsMade} attempts � notification ${notificationId}: ${error.message}`,
      );
    } else {
      await this.backgroundJobsService.markRetrying(backgroundJobId);
      await this.bgJobRepo.update(backgroundJobId, {
        errorMessage: error.message,
      });
      this.logger.warn(
        `[Worker] Job ${job.id} failed (attempt ${job.attemptsMade}/${maxAttempts}) � will retry: ${error.message}`,
      );
    }
  }

  /** Fallback khi caller chưa cung cấp emailHtml — bọc content plain-text vào layout chung. */
  private wrapPlainTextAsHtml(content: string): string {
    const escaped = escapeHtml(content).replace(/\n/g, '<br/>');
    return renderEmailLayout({
      heading: 'Thông báo',
      bodyHtml: renderParagraph(escaped),
    });
  }

  /** Dùng làm bản text/plain fallback — bóc tag HTML thô nếu content có chứa (VD <b>, <br/>). */
  private stripHtmlTags(content: string): string {
    return content.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  }
}
