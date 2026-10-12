import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FaceProfileStatus } from '../../accounts/entities/face-profile.entity.js';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';
import { VisitorDeviceSync } from './visitor-device-sync.js';

export type FaceLifecycleResult = 'active' | 'revoked' | 'none';

/**
 * Vòng đời hồ sơ khuôn mặt của khách trên kho thường trực IVSS (spec §8.1).
 * Kho tự nạp mọi user `account_status='active'` có hồ sơ `active` và tự gỡ khi hồ sơ không còn `active` (cron 30 giây),
 * nên ở đây chỉ cần đổi `face_profiles.status`. Hồ sơ `active` khi khách còn ít nhất một lượt đã duyệt, đang ở trong
 * hoặc phải rời (camera còn phải thấy khách để cảnh báo). Không bao giờ ném lỗi ra ngoài `syncVisit`.
 */
@Injectable()
export class VisitorFaceLifecycleService extends VisitorDeviceSync {
  private readonly logger = new Logger(VisitorFaceLifecycleService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly faceProfiles: FaceProfileService,
  ) {
    super();
  }

  async sync(visitorId: string): Promise<FaceLifecycleResult> {
    const rows: Array<{ user_id: string; status: string | null; eligible: boolean }> = await this.dataSource.query(
      `SELECT vis.user_id, fp.status,
              EXISTS (SELECT 1 FROM visitor_visits v WHERE v.visitor_id = vis.id AND v.deleted_at IS NULL
                         AND v.status IN ('approved','checked_in','must_leave')) AS eligible
         FROM visitors vis LEFT JOIN face_profiles fp ON fp.user_id = vis.user_id AND fp.deleted_at IS NULL
        WHERE vis.id = $1 AND vis.deleted_at IS NULL`,
      [visitorId],
    );
    const row = rows[0];
    if (!row || row.status === null) return 'none';
    if (row.eligible) {
      if (row.status !== FaceProfileStatus.ACTIVE) await this.faceProfiles.setProfileStatus(row.user_id, FaceProfileStatus.ACTIVE, null);
      return 'active';
    }
    if (row.status === FaceProfileStatus.ACTIVE) {
      await this.faceProfiles.setProfileStatus(row.user_id, FaceProfileStatus.REVOKED, null);
      return 'revoked';
    }
    return 'none';
  }

  async syncVisit(visitId: string): Promise<void> {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(visitId)) return;
      const rows: Array<{ visitor_id: string }> = await this.dataSource.query(`SELECT visitor_id FROM visitor_visits WHERE id = $1`, [visitId]);
      if (rows[0]) await this.sync(rows[0].visitor_id);
    } catch (e) {
      this.logger.warn(`Đồng bộ khuôn mặt IVSS lượt ${visitId} thất bại: ${e instanceof Error ? e.message : 'unknown'}`);
    }
  }
}
