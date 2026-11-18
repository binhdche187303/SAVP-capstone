import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  BackgroundJobEntity,
  BackgroundJobStatus,
  BackgroundJobType,
} from '../entities/background-job.entity.js';
import { BackgroundJobStatusResponseDto } from '../dto/background-job-status-response.dto.js';

export interface CreateQueuedJobDto {
  jobType: BackgroundJobType;
  queueName?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  requestedBy?: string;
  priority?: number;
  scheduledAt?: Date;
  inputJson?: Record<string, unknown>;
  metadataJson?: Record<string, unknown>;
}

/**
 * BackgroundJobsService — Service dùng chung để track background jobs trong DB.
 *
 * Entity BackgroundJobEntity đã có sẵn trong DB v3.2 (bảng background_jobs).
 * Service này chỉ cung cấp CRUD lifecycle methods — không implement business logic.
 *
 * Luồng điển hình:
 * 1. createQueuedJob()  — khi enqueue
 * 2. markRunning()      — khi worker bắt đầu
 * 3. markCompleted() hoặc markFailed() — khi worker xong
 */
@Injectable()
export class BackgroundJobsService {
  private readonly logger = new Logger(BackgroundJobsService.name);

  constructor(
    @InjectRepository(BackgroundJobEntity)
    private readonly repo: Repository<BackgroundJobEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Tạo background job record với status=queued.
   */
  async createQueuedJob(dto: CreateQueuedJobDto): Promise<BackgroundJobEntity> {
    const job = this.repo.create({
      jobType: dto.jobType,
      queueName: dto.queueName ?? null,
      relatedEntityType: dto.relatedEntityType ?? null,
      relatedEntityId: dto.relatedEntityId ?? null,
      requestedBy: dto.requestedBy ?? null,
      priority: dto.priority ?? 0,
      scheduledAt: dto.scheduledAt ?? null,
      inputJson: dto.inputJson ?? null,
      metadataJson: dto.metadataJson ?? null,
      status: BackgroundJobStatus.QUEUED,
      retryCount: 0,
    });
    const saved = await this.repo.save(job);
    this.logger.debug(
      `[BackgroundJobs] Created job ${saved.id} — type: ${saved.jobType}`,
    );
    return saved;
  }

  /**
   * Đánh dấu job đang chạy.
   */
  async markRunning(id: string): Promise<void> {
    await this.repo.update(id, {
      status: BackgroundJobStatus.RUNNING,
      startedAt: new Date(),
    });
  }

  /**
   * Đánh dấu job hoàn thành.
   */
  async markCompleted(
    id: string,
    outputJson?: Record<string, unknown>,
  ): Promise<void> {
    const updatePayload: Partial<BackgroundJobEntity> = {
      status: BackgroundJobStatus.COMPLETED,
      completedAt: new Date(),
      errorMessage: null,
    };
    if (outputJson !== undefined) {
      updatePayload.outputJson = outputJson;
    }
    await this.repo.update(
      id,
      updatePayload as Parameters<typeof this.repo.update>[1],
    );
  }

  /**
   * Đánh dấu job thất bại.
   */
  async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.repo.update(id, {
      status: BackgroundJobStatus.FAILED,
      completedAt: new Date(),
      errorMessage,
    });
    this.logger.warn(`[BackgroundJobs] Job ${id} failed: ${errorMessage}`);
  }

  /**
   * Đánh dấu job đang retry — tăng retry_count.
   */
  async markRetrying(id: string): Promise<void> {
    await this.repo.increment({ id }, 'retryCount', 1);
    await this.repo.update(id, { status: BackgroundJobStatus.RETRYING });
  }

  /**
   * Hủy job.
   */
  async cancelJob(id: string): Promise<void> {
    await this.repo.update(id, {
      status: BackgroundJobStatus.CANCELLED,
      completedAt: new Date(),
    });
  }

  /**
   * Tìm job theo ID. Throw NotFoundException nếu không tìm thấy.
   */
  async findById(id: string): Promise<BackgroundJobEntity> {
    const job = await this.repo.findOne({ where: { id } });
    if (!job) {
      throw new NotFoundException(`BackgroundJob with id "${id}" not found.`);
    }
    return job;
  }

  /**
   * Tìm job theo ID (nullable — không throw).
   */
  async findByIdOrNull(id: string): Promise<BackgroundJobEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * T007 — Lấy trạng thái 1 background job cho client poll
   * (GET /api/v1/background-jobs/:id). Dùng chung cho mọi loại job async
   * (transcription, export report...), KHÔNG tạo route riêng cho transcription
   * (theo CLAUDE.md mục 22.13 + contract `transcription-api.md`).
   *
   * Authorization (KHÔNG dùng permission node vì chưa seed `background_job.*` —
   * dùng sẽ luôn 403, đúng bug đã ghi ở T-PERM-001): chỉ
   *   - người tạo job (`requested_by` = userId), HOẶC
   *   - role BUSINESS_ADMIN/SYSTEM_ADMIN
   * mới được xem. Tránh leak job/dữ liệu nội bộ giữa các user (CLAUDE.md mục 20).
   *
   * @throws NotFoundException  job không tồn tại (`BACKGROUND_JOB_NOT_FOUND`)
   * @throws ForbiddenException không phải owner và không phải admin (`PERMISSION_DENIED`)
   */
  async getJobStatusForUser(
    jobId: string,
    userId: string,
  ): Promise<BackgroundJobStatusResponseDto> {
    const job = await this.repo.findOne({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay background job.',
        error: { code: 'BACKGROUND_JOB_NOT_FOUND', details: {} },
      });
    }

    const isOwner = !!job.requestedBy && job.requestedBy === userId;
    if (!isOwner) {
      const isAdmin = await this.userHasAdminRole(userId);
      if (!isAdmin) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền xem tác vụ này.',
          error: { code: 'PERMISSION_DENIED', details: {} },
        });
      }
    }

    return this.toStatusView(job);
  }

  /**
   * Map entity -> view tối giản. Chỉ expose `errorMessage` khi failed và
   * `result` (outputJson) khi completed — tránh trả field nội bộ
   * (inputJson/metadataJson/requestedBy) ra ngoài.
   */
  private toStatusView(
    job: BackgroundJobEntity,
  ): BackgroundJobStatusResponseDto {
    return {
      jobId: job.id,
      jobType: job.jobType,
      status: job.status,
      relatedEntityType: job.relatedEntityType,
      relatedEntityId: job.relatedEntityId,
      retryCount: job.retryCount,
      scheduledAt: job.scheduledAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      errorMessage:
        job.status === BackgroundJobStatus.FAILED ? job.errorMessage : null,
      result:
        job.status === BackgroundJobStatus.COMPLETED ? job.outputJson : null,
      outputFileId: job.outputFileId,
    };
  }

  /**
   * Check role admin theo role_code thật trong DB (BUSINESS_ADMIN/SYSTEM_ADMIN)
   * — nhất quán với `TranscriptionService.isAdminRole`. KHÔNG check theo
   * permission code vì `admin.*` không được seed.
   */
  private async userHasAdminRole(userId: string): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT r.role_code
         FROM user_roles ur
         JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1
          AND r.is_active = true
          AND r.role_code = ANY($2)
        LIMIT 1`,
      [userId, ['BUSINESS_ADMIN', 'SYSTEM_ADMIN']],
    );
    return rows.length > 0;
  }
}
