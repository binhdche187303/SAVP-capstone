import { IoTDeviceEntity } from '../entities/iot-device.entity.js';
import { maskSensitiveMetadata } from '../../../common/utils/masking.util.js';

export class IotDeviceResponseDto {
  id: string;
  device_name: string;
  device_code: string;
  device_type: string;
  room_id: string | null;
  zone_id: string | null;
  ip_address: string | null;
  mac_address: string | null;
  status: string;
  health_status: string;
  last_seen_at: Date | null;
  metadata_json: Record<string, any> | null;
  created_by_name?: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toIotDeviceResponse(
  entity: IoTDeviceEntity,
): IotDeviceResponseDto {
  return {
    id: entity.id,
    device_name: entity.deviceName,
    device_code: entity.deviceCode,
    device_type: entity.deviceType,
    room_id: entity.roomId || null,
    zone_id: entity.zoneId || null,
    ip_address: entity.ipAddress,
    mac_address: entity.macAddress,
    status: entity.status,
    health_status: entity.healthStatus,
    last_seen_at: entity.lastSeenAt,
    metadata_json: maskSensitiveMetadata(entity.metadataJson),
    created_by_name: (entity as any).createdByName || null,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };
}
