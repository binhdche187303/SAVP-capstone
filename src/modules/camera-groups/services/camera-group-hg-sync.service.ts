import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  HgvisionClient,
  HgvisionError,
} from '../../hgvision/hgvision.client.js';
import { HGVISION_CLIENT } from '../../hgvision/hgvision.constants.js';

/**
 * Đồng bộ MỘT CHIỀU nhóm camera SAVP → HGVision (/api/groups + camera_group của camera).
 *  - Tạo/sửa mô tả/xoá nhóm SAVP → tạo/sửa/xoá nhóm cùng tên bên HGVision.
 *  - Đổi tên: HGVision không cho đổi tên nhóm → tạo nhóm mới, chuyển camera, xoá nhóm cũ.
 *  - Thành viên: chỉ thiết bị liên kết HGVision (metadata_json.source='hgvision', camera_name).
 *    Camera thuộc nhiều nhóm SAVP → lấy nhóm tên nhỏ nhất (HGVision chỉ cho 1 nhóm).
 * Lỗi HGVision chỉ ghi log, không chặn thao tác bên SAVP.
 */
@Injectable()
export class CameraGroupHgSyncService {
  private readonly logger = new Logger(CameraGroupHgSyncService.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(HGVISION_CLIENT) private readonly client: HgvisionClient,
  ) {}

  async groupCreated(name: string, description?: string | null): Promise<void> {
    await this.safe(`tạo nhóm "${name}"`, () =>
      this.ensureGroup(name, description),
    );
  }

  async groupUpdated(
    groupId: string,
    oldName: string,
    newName: string,
    description?: string | null,
  ): Promise<void> {
    if (oldName === newName) {
      await this.safe(`sửa nhóm "${newName}"`, async () => {
        await this.ensureGroup(newName, description);
        await this.client.updateGroup(newName, description);
      });
      return;
    }
    await this.groupCreated(newName, description);
    await this.syncDevices(await this.groupDeviceIds(groupId));
    await this.safe(`xoá nhóm cũ "${oldName}"`, () =>
      this.client.deleteGroup(oldName),
    );
  }

  /** Gọi SAU khi đã xoá nhóm bên SAVP: chuyển camera về nhóm còn lại / Vãng lai rồi xoá nhóm. */
  async groupDeleted(name: string, memberIds: string[]): Promise<void> {
    await this.syncDevices(memberIds);
    await this.safe(`xoá nhóm "${name}"`, () => this.client.deleteGroup(name));
  }

  async syncDevices(deviceIds: string[]): Promise<void> {
    if (deviceIds.length === 0) return;
    const rows: Array<{
      camera_name: string;
      group_name: string | null;
      description: string | null;
    }> = await this.dataSource.query(
      `SELECT d.metadata_json->>'camera_name' AS camera_name, g.group_name, g.description
         FROM iot_devices d
         LEFT JOIN LATERAL (
              SELECT cg.group_name, cg.description FROM camera_group_members m
                JOIN camera_groups cg ON cg.id = m.group_id
               WHERE m.device_id = d.id ORDER BY cg.group_name LIMIT 1) g ON TRUE
        WHERE d.id = ANY($1::uuid[])
          AND d.metadata_json->>'source' = 'hgvision'
          AND COALESCE(d.metadata_json->>'camera_name', '') <> ''`,
      [deviceIds],
    );
    for (const r of rows) {
      await this.safe(`gán nhóm cho "${r.camera_name}"`, async () => {
        if (r.group_name) await this.ensureGroup(r.group_name, r.description);
        await this.client.updateCamera(r.camera_name, {
          camera_group: r.group_name ?? '',
        });
      });
    }
  }

  async groupDeviceIds(groupId: string): Promise<string[]> {
    const rows: Array<{ device_id: string }> = await this.dataSource.query(
      `SELECT device_id FROM camera_group_members WHERE group_id = $1`,
      [groupId],
    );
    return rows.map((r) => r.device_id);
  }

  /** Tạo nhóm nếu chưa có (409 = đã có → bỏ qua). */
  private async ensureGroup(
    name: string,
    description?: string | null,
  ): Promise<void> {
    try {
      await this.client.createGroup(name, description);
    } catch (e) {
      if (e instanceof HgvisionError && e.status === 409) return;
      throw e;
    }
  }

  private async safe(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.warn(`HGVision: không ${what}: ${(e as Error).message}`);
    }
  }
}
