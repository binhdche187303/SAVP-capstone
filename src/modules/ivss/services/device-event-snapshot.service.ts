import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { HGVISION_CLIENT } from '../../hgvision/hgvision.constants.js';
import type { HgvisionClient } from '../../hgvision/hgvision.client.js';
import { StorageService } from '../../storage/storage.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';

interface EventRow {
  snapshot_file_id: string | null;
  owner_user_id: string | null;
  remote_image_path: string | null;
  remote_plate_image_path: string | null;
}

/** full = ảnh đã lưu / ảnh toàn cảnh; plate = ảnh cắt biển số (chỉ nguồn HGVision). */
export type SnapshotKind = 'full' | 'plate';
interface MediaFileRow {
  storage_key: string;
  mime_type: string;
  file_name: string;
}

export interface DeviceEventSnapshot {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
  /** true = ảnh lấy trực tiếp từ HGVision (cho phép trình duyệt cache). */
  remote?: boolean;
}

/** Role được xem snapshot của BẤT KỲ event nào — không giới hạn chủ nhân. */
const ELEVATED_ROLES = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN', 'MANAGER'];

/**
 * DeviceEventSnapshotService (F-F) — đọc ảnh snapshot đã lưu bởi F-B/F-C/F-D
 * (iot_device_events.snapshot_file_id → media_files). READ-ONLY, KHÔNG đụng luồng
 * ghi. Stream bytes trực tiếp (KHÔNG trả publicUrl) — storage local hiện KHÔNG có
 * static file serving nào wire vào STORAGE_PUBLIC_BASE_URL, nên chỉ cách chắc chắn
 * chạy đúng trên cả driver local/s3 là đọc bytes qua storageService.downloadFile().
 *
 * [FIX 2026-08-13] Ownership-check cho EMPLOYEE — permission `ivss.access_log.read`
 * (gate ở IvssDeviceEventSnapshotController) vừa mở cho EMPLOYEE (modal presence tự
 * xem chính mình), nhưng permission đó KHÔNG tự giới hạn phạm vi theo route (dùng
 * chung cho Room Access Logs/Zone Access/User Journey — vốn chỉ SYSTEM_ADMIN/
 * BUSINESS_ADMIN/MANAGER trước đây). EMPLOYEE giờ CHỈ xem được ảnh của event có
 * `payload_json->>'userId'` khớp đúng chính họ — chặn dò UUID xem ảnh người khác.
 * SYSTEM_ADMIN/BUSINESS_ADMIN/MANAGER giữ nguyên KHÔNG giới hạn (0 thay đổi hành vi).
 * Không đủ dữ liệu để xác định chủ nhân (event thuộc domain khác không có `userId`
 * trong payload, VD ANPR/security alert) → mặc định TỪ CHỐI cho EMPLOYEE (an toàn hơn
 * mặc định cho phép).
 */
@Injectable()
export class DeviceEventSnapshotService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
    private readonly authzRepo: AuthzReadRepository,
    private readonly moduleRef: ModuleRef,
  ) {}

  async getSnapshot(
    eventId: string,
    callerId: string,
    kind: SnapshotKind = 'full',
  ): Promise<DeviceEventSnapshot> {
    const eventRows: EventRow[] = await this.dataSource.manager.query(
      `SELECT snapshot_file_id, payload_json->>'userId' AS owner_user_id,
              payload_json->>'remoteImagePath' AS remote_image_path,
              payload_json->>'remotePlateImagePath' AS remote_plate_image_path
         FROM iot_device_events WHERE id = $1 LIMIT 1`,
      [eventId],
    );
    const event = eventRows[0];
    const snapshotFileId = kind === 'full' ? event?.snapshot_file_id : null;
    // Đường dẫn ảnh HGVision lấy từ DB theo eventId — client KHÔNG bao giờ gửi path.
    const remotePath =
      kind === 'plate'
        ? event?.remote_plate_image_path
        : event?.remote_image_path || event?.remote_plate_image_path;
    if (!snapshotFileId && !remotePath) {
      throw new NotFoundException({
        code: 'DEVICE_EVENT_SNAPSHOT_NOT_FOUND',
        message: 'Sự kiện không tồn tại hoặc không có ảnh snapshot.',
      });
    }

    const { roles } =
      await this.authzRepo.getEffectiveRolesAndPermissions(callerId);
    const isElevated = roles.some((r) => ELEVATED_ROLES.includes(r));
    if (!isElevated && event.owner_user_id !== callerId) {
      throw new ForbiddenException({
        success: false,
        message: 'You can only view your own snapshot',
        error: { code: 'SELF_ONLY', details: {} },
      });
    }

    if (!snapshotFileId) return this.fetchRemote(remotePath!);

    const mediaRows: MediaFileRow[] = await this.dataSource.manager.query(
      `SELECT storage_key, mime_type, file_name FROM media_files WHERE id = $1 LIMIT 1`,
      [snapshotFileId],
    );
    const media = mediaRows[0];
    if (!media) {
      throw new NotFoundException({
        code: 'DEVICE_EVENT_SNAPSHOT_NOT_FOUND',
        message: 'File ảnh snapshot không tồn tại.',
      });
    }

    const buffer = await this.storageService.downloadFile(media.storage_key);
    return {
      buffer,
      mimeType: media.mime_type,
      fileName: media.file_name,
    };
  }

  /** Proxy ảnh từ HGVision (token chỉ nằm ở BE). HGVision lỗi/xoá ảnh → 404. */
  private async fetchRemote(path: string): Promise<DeviceEventSnapshot> {
    let client: HgvisionClient | undefined;
    try {
      client = this.moduleRef.get<HgvisionClient>(HGVISION_CLIENT, {
        strict: false,
      });
    } catch {
      client = undefined;
    }
    try {
      if (!client) throw new Error('no client');
      const base64 = await client.fetchImageBase64(path);
      return {
        buffer: Buffer.from(base64, 'base64'),
        mimeType: 'image/jpeg',
        fileName: path.split('/').pop() || 'snapshot.jpg',
        remote: true,
      };
    } catch {
      throw new NotFoundException({
        code: 'DEVICE_EVENT_SNAPSHOT_NOT_FOUND',
        message: 'Ảnh trên HGVision không còn hoặc không truy cập được.',
      });
    }
  }
}
