import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { returnedRows } from '../../../common/utils/pg-result.util.js';
import { ConfigService } from '@nestjs/config';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import { StorageProvider } from '../../recording/entities/media-file.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import { generateFaceProfileCode } from '../utils/face-profile-code.util.js';

export interface UploadedPortrait {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

const ALLOWED_MIME = ['image/jpeg', 'image/png'];
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * FaceProfileService (FPE-001 / UC-17) — enroll portrait + đọc portrait bytes (cho Ticket B).
 *
 * SEC-03: validate file server-side. DATA-01: dùng media_files/face_profiles có sẵn (KHÔNG migration).
 * media_files entity ở module recording → INSERT/SELECT raw qua dataSource.manager.
 */
@Injectable()
export class FaceProfileService {
  private readonly logger = new Logger(FaceProfileService.name);

  constructor(
    @InjectRepository(FaceProfileEntity)
    private readonly faceProfileRepo: Repository<FaceProfileEntity>,
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
  ) {}

  /** UC-17: lưu ảnh chân dung → media_files → upsert face_profiles. */
  async enrollPortrait(
    userId: string,
    file: UploadedPortrait | undefined,
    enrolledBy: string | null,
  ): Promise<{ faceProfileId: string; mediaFileId: string; status: string }> {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Portrait file is required.',
      });
    }
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new BadRequestException({
        code: 'INVALID_FILE_TYPE',
        message: 'Portrait must be image/jpeg or image/png.',
      });
    }
    const maxBytes = this.configService.get<number>(
      'FACE_PORTRAIT_MAX_BYTES',
      DEFAULT_MAX_BYTES,
    );
    if (file.size > maxBytes) {
      throw new BadRequestException({
        code: 'FILE_TOO_LARGE',
        message: `Portrait exceeds ${maxBytes} bytes.`,
      });
    }

    const saved = await this.storageService.saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      folder: 'face-profiles',
    });
    const storageProvider = this.resolveStorageProvider();

    const insert: Array<{ id: string }> = await this.dataSource.manager.query(
      `INSERT INTO media_files
         (file_name, file_type, mime_type, storage_provider, storage_key,
          file_size_bytes, uploaded_by, related_entity_type, related_entity_id)
       VALUES ($1,'image',$2,$3,$4,$5,$6,'face_profile',$7)
       RETURNING id`,
      [
        saved.storageKey.split('/').pop() ?? saved.storageKey,
        file.mimetype,
        storageProvider,
        saved.storageKey,
        String(file.size),
        enrolledBy,
        userId,
      ],
    );
    const mediaFileId = insert[0].id;

    const now = new Date();
    const existing = await this.faceProfileRepo.findOne({ where: { userId } });
    let faceProfileId: string;
    if (existing) {
      await this.faceProfileRepo.update(existing.id, {
        primaryImageFileId: mediaFileId,
        status: FaceProfileStatus.PENDING_REVIEW,
        enrolledBy,
        lastUpdatedAt: now,
        sampleCount: (existing.sampleCount ?? 0) + 1,
      });
      faceProfileId = existing.id;
    } else {
      const created = await this.faceProfileRepo.save(
        this.faceProfileRepo.create({
          userId,
          profileCode: generateFaceProfileCode(),
          status: FaceProfileStatus.PENDING_REVIEW,
          primaryImageFileId: mediaFileId,
          enrolledBy,
          enrolledAt: now,
          sampleCount: 1,
        }),
      );
      faceProfileId = created.id;
    }

    return {
      faceProfileId,
      mediaFileId,
      status: FaceProfileStatus.PENDING_REVIEW,
    };
  }

  /** Map StorageService.getDriver() (env STORAGE_DRIVER) → đúng enum StorageProvider lưu DB. */
  private resolveStorageProvider(): StorageProvider {
    switch (this.storageService.getDriver()) {
      case 's3':
        return StorageProvider.S3;
      case 'local':
      default:
        return StorageProvider.LOCAL;
    }
  }

  /**
   * VIS-BE-001: đổi trạng thái hồ sơ khuôn mặt (kho thường trực IVSS tự nạp/gỡ theo `active`).
   * Chỉ cho `active` | `revoked` | `disabled` — `pending_review`/`rejected` thuộc luồng duyệt ảnh của quản trị.
   * Trả true nếu có đổi.
   */
  async setProfileStatus(
    userId: string,
    status: FaceProfileStatus.ACTIVE | FaceProfileStatus.REVOKED | FaceProfileStatus.DISABLED,
    actorId: string | null,
  ): Promise<boolean> {
    if (![FaceProfileStatus.ACTIVE, FaceProfileStatus.REVOKED, FaceProfileStatus.DISABLED].includes(status)) {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Trạng thái hồ sơ khuôn mặt không hợp lệ.' });
    }
    const rows = returnedRows<{ id: string }>(
      await this.dataSource.manager.query(
        `UPDATE face_profiles SET status = $2, last_updated_at = now()
          WHERE user_id = $1 AND deleted_at IS NULL AND status <> $2 RETURNING id`,
        [userId, status],
      ),
    );
    if (rows.length > 0) this.logger.log(`Hồ sơ khuôn mặt user ${userId} → ${status} (actor ${actorId ?? 'system'})`);
    return rows.length > 0;
  }

  /**
   * VIS-BE-001 (BR-V19): xóa ảnh và hồ sơ khuôn mặt — hồ sơ xóa mềm, media vô hiệu hóa, file bị xóa khỏi kho lưu trữ.
   * Chỉ dùng cho dữ liệu sinh trắc của khách hết hạn lưu giữ; lịch sử lượt khách ở nơi khác vẫn giữ.
   */
  async deletePortrait(userId: string, extraMediaIds: string[] = []): Promise<{ deleted: boolean }> {
    const profile = await this.faceProfileRepo.findOne({ where: { userId } });
    if (!profile && extraMediaIds.length === 0) return { deleted: false };
    const media: Array<{ id: string; storage_key: string }> = await this.dataSource.manager.query(
      `SELECT id, storage_key FROM media_files
        WHERE (id = $2 OR id = ANY($3::uuid[]) OR (related_entity_type = 'face_profile' AND related_entity_id = $1)) AND is_active = true`,
      [userId, profile?.primaryImageFileId ?? null, extraMediaIds],
    );
    for (const m of media) {
      try {
        await this.storageService.deleteFile(m.storage_key);
      } catch (e) {
        this.logger.warn(`Không xóa được file ${m.storage_key}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (media.length) {
      await this.dataSource.manager.query(`UPDATE media_files SET is_active = false WHERE id = ANY($1::uuid[])`, [media.map((m) => m.id)]);
    }
    if (profile) await this.faceProfileRepo.softDelete(profile.id);
    return { deleted: true };
  }

  /**
   * VIS-BE-001: ảnh của một media_files bất kỳ (kể cả ảnh chưa duyệt) dạng data URL — để màn chi tiết lượt khách
   * hiện ảnh đăng ký. Local đọc đĩa, cloud tải từ file_url. null nếu không đọc được (không ném).
   */
  async getMediaDataUrl(mediaFileId: string): Promise<string | null> {
    const rows: Array<{ storage_key: string; storage_provider: string; file_url: string | null; mime_type: string }> =
      await this.dataSource.manager.query(
        `SELECT storage_key, storage_provider, file_url, mime_type FROM media_files WHERE id = $1 LIMIT 1`,
        [mediaFileId],
      );
    const media = rows[0];
    if (!media) return null;
    try {
      let buffer: Buffer | null = null;
      if (media.storage_provider === 'local') {
        buffer = this.storageService.getFile(media.storage_key);
      } else if (media.file_url) {
        const res = await fetch(media.file_url);
        if (res.ok) buffer = Buffer.from(await res.arrayBuffer());
      }
      return buffer ? `data:${media.mime_type || 'image/jpeg'};base64,${buffer.toString('base64')}` : null;
    } catch (e) {
      this.logger.warn(`getMediaDataUrl ${mediaFileId} lỗi: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  /** Ticket B: đọc bytes portrait của user (local). null nếu không có. */
  async getPortraitBytes(userId: string): Promise<Buffer | null> {
    // R2 + VAL-01: chỉ lấy ảnh ĐÃ DUYỆT (ACTIVE). 1 user chỉ 1 ACTIVE (approve revoke cái cũ).
    const face = await this.faceProfileRepo.findOne({
      where: { userId, status: FaceProfileStatus.ACTIVE },
    });
    if (!face || !face.primaryImageFileId) return null;

    const rows: Array<{
      storage_key: string;
      storage_provider: string;
      file_url: string | null;
    }> = await this.dataSource.manager.query(
      `SELECT storage_key, storage_provider, file_url
       FROM media_files WHERE id = $1 LIMIT 1`,
      [face.primaryImageFileId],
    );
    const media = rows?.[0];
    if (!media) return null;

    // R4: local (luồng cũ) — đọc đĩa. getFile() đồng bộ (Buffer), throw nếu thiếu/path lạ.
    if (media.storage_provider === 'local') {
      try {
        return this.storageService.getFile(media.storage_key);
      } catch {
        return null;
      }
    }

    // R3 + R5: cloud (Cloudinary) — tải từ file_url (secureUrl https) → Buffer.
    if (media.storage_provider === 'cloud_provider') {
      if (!media.file_url) return null;
      try {
        const res = await fetch(media.file_url);
        if (!res.ok) {
          this.logger.warn(
            `getPortraitBytes: Cloudinary fetch ${res.status} for user ${userId}.`,
          );
          return null;
        }
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      } catch (e) {
        this.logger.warn(
          `getPortraitBytes: Cloudinary fetch error user ${userId}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        return null;
      }
    }

    // provider lạ → null an toàn.
    return null;
  }
}
