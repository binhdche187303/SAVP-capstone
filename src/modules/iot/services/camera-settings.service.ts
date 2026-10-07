import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, In } from 'typeorm';
import {
  IoTDeviceEntity,
  IoTDeviceType,
} from '../entities/iot-device.entity.js';
import {
  ConfigureRecordingDto,
  SaveCameraLayoutDto,
} from '../dto/camera-settings.dto.js';

/**
 * Cấu hình theo từng camera cho phân hệ 2.2 — sơ đồ lắp đặt (2.2.4), lịch ghi/lưu trữ (2.2.7),
 * thống kê camera biển số (2.2.1). Theo tiền lệ `ai_config`/`rtsp_config`: lưu trong
 * `metadata_json` của thiết bị, KHÔNG thêm bảng.
 *
 * ⚠ Lịch ghi là TUYÊN BỐ cấu hình — BE chưa có kênh đẩy xuống NVR/recorder. Dung lượng đã dùng
 * đọc từ `metadata_json.recording_stats.used_gb` (job NVR ghi vào khi có thiết bị thật; hiện do
 * seed demo ghi).
 */

export const CAMERA_DEVICE_TYPES: readonly IoTDeviceType[] = [
  IoTDeviceType.IP_CAMERA,
  IoTDeviceType.DOOR_CAMERA,
  IoTDeviceType.ROOM_CAMERA,
  IoTDeviceType.ANPR_CAMERA,
];

const VEHICLE_EVENT_TYPE = 'ivss_vehicle_event';

export interface StorageUsage {
  capacity_gb: number;
  used_gb: number;
  devices: { device_id: string; used_gb: number | null }[];
}

export interface AnprCameraStats {
  device_id: string;
  total: number;
  enter: number;
  leave: number;
}

@Injectable()
export class CameraSettingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  private async findCamera(deviceId: string): Promise<IoTDeviceEntity> {
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });
    if (!device || !CAMERA_DEVICE_TYPES.includes(device.deviceType)) {
      throw new NotFoundException({
        code: 'CAMERA_NOT_FOUND',
        message: 'Camera not found.',
      });
    }
    return device;
  }

  private async audit(
    userId: string | null,
    deviceId: string,
    actionType: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
       VALUES ($1, $2, 'iot_devices', $3, 'info', $4::jsonb)`,
      [userId, actionType, deviceId, JSON.stringify(metadata)],
    );
  }

  /** 2.2.4 — lưu (hoặc reset) vị trí camera của 1 tầng vào metadata_json.layout. */
  async saveLayout(
    userId: string | null,
    dto: SaveCameraLayoutDto,
  ): Promise<{ updated: number }> {
    if (dto.reset) {
      const rows: { id: string }[] = await this.dataSource.query(
        `UPDATE iot_devices SET metadata_json = metadata_json - 'layout', updated_at = now()
         WHERE metadata_json->'layout'->>'floor_key' = $1
         RETURNING id`,
        [dto.floorKey],
      );
      return { updated: rows.length };
    }

    const positions = dto.positions ?? [];
    if (positions.length === 0) return { updated: 0 };

    const devices = await this.dataSource.manager.find(IoTDeviceEntity, {
      where: {
        id: In(positions.map((p) => p.deviceId)),
        deviceType: In([...CAMERA_DEVICE_TYPES]),
      },
    });
    const byId = new Map(devices.map((d) => [d.id, d]));

    await this.dataSource.transaction(async (manager) => {
      for (const p of positions) {
        const device = byId.get(p.deviceId);
        if (!device) continue;
        device.metadataJson = {
          ...(device.metadataJson || {}),
          layout: {
            floor_key: dto.floorKey,
            x: Math.round(p.x),
            y: Math.round(p.y),
            angle: p.angle,
          },
        };
        await manager.save(IoTDeviceEntity, device);
      }
    });
    if (devices.length > 0) {
      await this.audit(userId, devices[0].id, 'configure_layout', {
        floor_key: dto.floorKey,
        device_ids: devices.map((d) => d.id),
      });
    }
    return { updated: devices.length };
  }

  /** 2.2.7 — cấu hình lịch ghi hình & thời gian lưu trữ (ghi đè cả cụm). */
  async configureRecording(
    userId: string | null,
    deviceId: string,
    dto: ConfigureRecordingDto,
  ): Promise<IoTDeviceEntity> {
    const device = await this.findCamera(deviceId);
    const recording = {
      mode: dto.mode,
      retention_days: dto.retentionDays,
      bitrate_mbps: dto.bitrateMbps,
      schedule: dto.schedule,
      configured_at: new Date().toISOString(),
    };
    device.metadataJson = { ...(device.metadataJson || {}), recording };
    const saved = await this.dataSource.manager.save(IoTDeviceEntity, device);
    await this.audit(userId, deviceId, 'configure_recording', recording);
    return saved;
  }

  /** 2.2.7 — dung lượng lưu trữ: tổng ổ (env RECORDING_STORAGE_CAPACITY_GB) + đã dùng theo camera. */
  async getStorageUsage(): Promise<StorageUsage> {
    const rows: { id: string; used_gb: string | null }[] =
      await this.dataSource.query(
        `SELECT id, metadata_json->'recording_stats'->>'used_gb' AS used_gb
         FROM iot_devices WHERE device_type = ANY($1)`,
        [[...CAMERA_DEVICE_TYPES]],
      );
    const devices = rows.map((r) => ({
      device_id: r.id,
      used_gb: r.used_gb == null ? null : Number(r.used_gb),
    }));
    return {
      capacity_gb: Number(
        this.configService.get('RECORDING_STORAGE_CAPACITY_GB') ?? 20480,
      ),
      used_gb:
        Math.round(devices.reduce((s, d) => s + (d.used_gb ?? 0), 0) * 10) / 10,
      devices,
    };
  }

  /** 2.2.1 — số lượt xe theo từng camera biển số trong 1 ngày (giờ VN). */
  async getAnprStats(date?: string): Promise<AnprCameraStats[]> {
    const rows: {
      device_id: string;
      total: string;
      enter: string;
      leave: string;
    }[] = await this.dataSource.query(
      `SELECT d.id AS device_id,
              COUNT(e.id) AS total,
              COUNT(e.id) FILTER (WHERE e.payload_json->>'direction' = 'enter') AS enter,
              COUNT(e.id) FILTER (WHERE e.payload_json->>'direction' = 'leave') AS leave
       FROM iot_devices d
       LEFT JOIN iot_device_events e
         ON e.device_id = d.id
        AND e.event_type = $1
        AND (e.event_time AT TIME ZONE 'Asia/Ho_Chi_Minh')::date =
            COALESCE($2::date, (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date)
       WHERE d.device_type = $3
       GROUP BY d.id`,
      [VEHICLE_EVENT_TYPE, date ?? null, IoTDeviceType.ANPR_CAMERA],
    );
    return rows.map((r) => ({
      device_id: r.device_id,
      total: Number(r.total),
      enter: Number(r.enter),
      leave: Number(r.leave),
    }));
  }
}
