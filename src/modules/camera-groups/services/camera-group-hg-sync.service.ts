import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HgvisionClient } from '../../hgvision/hgvision.client.js';
import { HGVISION_CLIENT } from '../../hgvision/hgvision.constants.js';

/**
 * Đồng bộ MỘT CHIỀU nhóm camera SAVP → `camera_group` bên HGVision.
 * Chỉ áp cho thiết bị liên kết HGVision (metadata_json.source='hgvision', camera_name).
 * Camera thuộc nhiều nhóm SAVP → lấy nhóm có tên nhỏ nhất (HGVision chỉ cho 1 nhóm).
 * Lỗi HGVision chỉ ghi log, không chặn thao tác bên SAVP.
 */
@Injectable()
export class CameraGroupHgSyncService {
  private readonly logger = new Logger(CameraGroupHgSyncService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(HGVISION_CLIENT) private readonly client: HgvisionClient,
  ) {}

  async syncDevices(deviceIds: string[]): Promise<void> {
    if (deviceIds.length === 0) return;
    const rows: Array<{ camera_name: string; group_name: string | null }> =
      await this.dataSource.query(
        `SELECT d.metadata_json->>'camera_name' AS camera_name,
              (SELECT MIN(g.group_name) FROM camera_group_members m
                 JOIN camera_groups g ON g.id = m.group_id
                WHERE m.device_id = d.id) AS group_name
         FROM iot_devices d
        WHERE d.id = ANY($1::uuid[])
          AND d.metadata_json->>'source' = 'hgvision'
          AND COALESCE(d.metadata_json->>'camera_name', '') <> ''`,
        [deviceIds],
      );
    await Promise.all(
      rows.map(async (r) => {
        try {
          await this.client.updateCamera(r.camera_name, {
            camera_group: r.group_name ?? '',
          });
        } catch (e) {
          this.logger.warn(
            `Không đồng bộ nhóm sang HGVision cho "${r.camera_name}": ${(e as Error).message}`,
          );
        }
      }),
    );
  }

  async groupDeviceIds(groupId: string): Promise<string[]> {
    const rows: Array<{ device_id: string }> = await this.dataSource.query(
      `SELECT device_id FROM camera_group_members WHERE group_id = $1`,
      [groupId],
    );
    return rows.map((r) => r.device_id);
  }
}
