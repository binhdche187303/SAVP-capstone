import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CameraGroupDevicesDto, CreateCameraGroupDto, UpdateCameraGroupDto } from '../dto/camera-group.dto.js';

/** Loại thiết bị được xếp vào nhóm camera. */
export const CAMERA_DEVICE_TYPES = ['ip_camera', 'door_camera', 'room_camera', 'anpr_camera'];

export interface CameraGroupRow {
  id: string;
  group_code: string;
  group_name: string;
  description: string | null;
  zone_id: string | null;
  zone_name: string | null;
  purpose: string | null;
  device_count: number;
  offline_count: number;
  created_at: Date;
  updated_at: Date;
}

const GROUP_SELECT = `
  SELECT g.id, g.group_code, g.group_name, g.description, g.created_at, g.updated_at,
         g.zone_id, z.zone_name, g.purpose,
         COUNT(d.id)::int AS device_count,
         COUNT(d.id) FILTER (WHERE d.status = 'offline')::int AS offline_count
    FROM camera_groups g
    LEFT JOIN zones z ON z.id = g.zone_id AND z.deleted_at IS NULL
    LEFT JOIN camera_group_members m ON m.group_id = g.id
    LEFT JOIN iot_devices d ON d.id = m.device_id`;

/** CAMG-001 — CRUD nhóm camera và gán camera vào nhóm (n-n). */
@Injectable()
export class CameraGroupsService {
  constructor(private readonly dataSource: DataSource) {}

  list(search?: string): Promise<CameraGroupRow[]> {
    return this.dataSource.query(
      `${GROUP_SELECT}
        WHERE ($1::text IS NULL OR g.group_name ILIKE '%' || $1 || '%' OR g.group_code ILIKE '%' || $1 || '%')
        GROUP BY g.id, z.zone_name ORDER BY g.group_name`,
      [search?.trim() || null],
    );
  }

  async get(id: string) {
    const rows: CameraGroupRow[] = await this.dataSource.query(`${GROUP_SELECT} WHERE g.id = $1 GROUP BY g.id, z.zone_name`, [id]);
    if (rows.length === 0) throw this.notFound();
    const devices = await this.dataSource.query(
      `SELECT d.id, d.device_code, d.device_name, d.device_type, d.status, d.zone_id, d.last_seen_at, m.added_at
         FROM camera_group_members m JOIN iot_devices d ON d.id = m.device_id
        WHERE m.group_id = $1 ORDER BY d.device_name`,
      [id],
    );
    return { ...rows[0], devices };
  }

  async create(dto: CreateCameraGroupDto, userId: string) {
    try {
      const rows: Array<{ id: string }> = await this.dataSource.query(
        `INSERT INTO camera_groups (group_code, group_name, description, created_by, zone_id, purpose)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [dto.groupCode, dto.groupName, dto.description ?? null, userId, dto.zoneId ?? null, dto.purpose?.trim() || null],
      );
      return this.get(rows[0].id);
    } catch (e) {
      throw this.mapDuplicate(e);
    }
  }

  async update(id: string, dto: UpdateCameraGroupDto) {
    const res: unknown = await this.dataSource.query(
      `UPDATE camera_groups
          SET group_name = COALESCE($2, group_name),
              description = CASE WHEN $4 THEN $3 ELSE description END,
              zone_id = CASE WHEN $6 THEN $5::uuid ELSE zone_id END,
              purpose = CASE WHEN $8 THEN $7 ELSE purpose END,
              updated_at = NOW()
        WHERE id = $1 RETURNING id`,
      [
        id,
        dto.groupName ?? null,
        dto.description ?? null,
        dto.description !== undefined,
        dto.zoneId ?? null,
        dto.zoneId !== undefined,
        dto.purpose?.trim() || null,
        dto.purpose !== undefined,
      ],
    );
    if (!this.returnedAny(res)) throw this.notFound();
    return this.get(id);
  }

  async remove(id: string): Promise<void> {
    const res: unknown = await this.dataSource.query(`DELETE FROM camera_groups WHERE id = $1 RETURNING id`, [id]);
    if (!this.returnedAny(res)) throw this.notFound();
  }

  /** Thêm camera vào nhóm; đã có thì bỏ qua. Mọi id phải là camera tồn tại, không thì không thêm gì. */
  async addDevices(id: string, dto: CameraGroupDevicesDto) {
    await this.assertGroup(id);
    if (dto.deviceIds.length > 0) {
      const found: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM iot_devices WHERE id = ANY($1::uuid[]) AND device_type = ANY($2::text[])`,
        [dto.deviceIds, CAMERA_DEVICE_TYPES],
      );
      const have = new Set(found.map((r) => r.id));
      const bad = dto.deviceIds.filter((d) => !have.has(d));
      if (bad.length > 0) {
        throw new UnprocessableEntityException({
          code: 'CAMERA_GROUP_INVALID_DEVICE',
          message: 'Có thiết bị không tồn tại hoặc không phải camera.',
          device_ids: bad,
        });
      }
      await this.dataSource.query(
        `INSERT INTO camera_group_members (group_id, device_id)
         SELECT $1, UNNEST($2::uuid[]) ON CONFLICT DO NOTHING`,
        [id, dto.deviceIds],
      );
    }
    return this.get(id);
  }

  async removeDevice(id: string, deviceId: string) {
    await this.assertGroup(id);
    await this.dataSource.query(`DELETE FROM camera_group_members WHERE group_id = $1 AND device_id = $2`, [id, deviceId]);
    return this.get(id);
  }

  private async assertGroup(id: string): Promise<void> {
    const rows: unknown[] = await this.dataSource.query(`SELECT 1 FROM camera_groups WHERE id = $1`, [id]);
    if (rows.length === 0) throw this.notFound();
  }

  private notFound(): NotFoundException {
    return new NotFoundException({ code: 'CAMERA_GROUP_NOT_FOUND', message: 'Camera group not found.' });
  }

  private mapDuplicate(e: unknown): unknown {
    if ((e as { code?: string })?.code === '23505') {
      return new ConflictException({ code: 'CAMERA_GROUP_CODE_EXISTS', message: 'Mã nhóm camera đã tồn tại.' });
    }
    return e;
  }

  /** UPDATE/DELETE…RETURNING qua DataSource.query trả [rows,count]. */
  private returnedAny(res: unknown): boolean {
    if (Array.isArray(res) && res.length === 2 && Array.isArray(res[0])) return res[0].length > 0;
    return Array.isArray(res) && res.length > 0;
  }
}
