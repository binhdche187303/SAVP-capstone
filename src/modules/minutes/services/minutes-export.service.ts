import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import { QueueService } from '../../queue/queue.service.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
} from '../entities/meeting-minutes.entity.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { CreateMinutesExportDto } from '../dto/create-minutes-export.dto.js';
import { CreateMinutesExportResponseDto } from '../dto/create-minutes-export-response.dto.js';
import {
  MINUTES_EXPORT_QUEUE_NAME,
  MINUTES_EXPORT_JOB_NAME,
} from '../constants/minutes-export-job.constants.js';

export interface MinutesExportAuthUser {
  userId: string;
}

/**
 * MinutesExportService (UC-147) — orchestrator tạo job xuất biên bản.
 *
 * Tách riêng khỏi MinutesService để không phải thêm dependency
 * (BackgroundJobsService/QueueService) vào constructor MinutesService (vốn đã
 * lớn và có nhiều unit test build tay theo arity cố định). Mirror pattern
 * MeetingActivityReportService của module reports.
 *
 * Luồng: validate published + ownership-or-admin → createQueuedJob → addJob →
 * trả 202 + jobId. Render/upload diễn ra bất đồng bộ trong MinutesExportWorkerProcessor.
 */
@Injectable()
export class MinutesExportService {
  private readonly logger = new Logger(MinutesExportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly authzRepo: AuthzReadRepository,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly queueService: QueueService,
  ) {}

  async createExportJob(
    minutesId: string,
    dto: CreateMinutesExportDto,
    authUser: MinutesExportAuthUser,
  ): Promise<CreateMinutesExportResponseDto> {
    // 1. Load minutes
    const minutes = await this.dataSource
      .getRepository(MeetingMinutesEntity)
      .findOne({ where: { id: minutesId } });
    if (!minutes || minutes.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Biên bản họp không tồn tại hoặc đã bị xóa',
        error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
      });
    }

    // 2. Load meeting (ownership check)
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: minutes.meetingId } });

    // 3. Ownership-or-admin
    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );
    if (!isAdmin) {
      const isOwner =
        minutes.preparedBy === authUser.userId ||
        meeting?.hostId === authUser.userId;
      if (!isOwner) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền xuất biên bản này',
          error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
        });
      }
    }

    // 4. Chỉ export khi published (FR-009)
    if (minutes.status !== MeetingMinutesStatus.PUBLISHED) {
      throw new ConflictException({
        success: false,
        message: 'Chỉ có thể xuất biên bản đã được ban hành',
        error: {
          code: 'MINUTES_NOT_PUBLISHED',
          details: { minutesId, currentStatus: minutes.status },
        },
      });
    }

    const includeTranscript = dto.includeTranscript ?? false;
    const includeActionItems = dto.includeActionItems ?? true;

    // 5. Tạo background job (queued)
    const backgroundJob = await this.backgroundJobsService.createQueuedJob({
      jobType: BackgroundJobType.EXPORT_MINUTES,
      requestedBy: authUser.userId,
      relatedEntityType: 'meeting_minutes',
      relatedEntityId: minutesId,
      inputJson: {
        minutesId,
        format: dto.format,
        includeTranscript,
        includeActionItems,
      },
    });

    // 6. Enqueue BullMQ job (queue đã đăng ký sẵn trong QueueModule)
    await this.queueService.addJob(
      MINUTES_EXPORT_QUEUE_NAME,
      MINUTES_EXPORT_JOB_NAME,
      {
        backgroundJobId: backgroundJob.id,
        minutesId,
        format: dto.format,
        includeTranscript,
        includeActionItems,
        requestedByUserId: authUser.userId,
      },
    );

    this.logger.log(
      `Minutes export job queued — jobId=${backgroundJob.id} minutesId=${minutesId} format=${dto.format}`,
    );

    return new CreateMinutesExportResponseDto({
      jobId: backgroundJob.id,
      status: 'queued',
      minutesId,
      format: dto.format,
      estimatedCompletion: null,
    });
  }
}
