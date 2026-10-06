import type { ZoneEntity } from '../entities/zone.entity.js';
import type { IoTDeviceEntity } from '../../iot/entities/iot-device.entity.js';
import {
  toIotDeviceResponse,
  type IotDeviceResponseDto,
} from '../../iot/dto/iot-device-response.dto.js';

/**
 * ZoneResponse (ZNC-001 / UC-90) — shape trả ra client, field snake_case.
 *
 * KHÔNG trả `deleted_at` (chi tiết nội bộ của soft-delete).
 *
 * BE-fix: `iot_devices`/`equipments` CHỈ được điền khi caller truyền `devices` vào
 * `toZoneResponse` (route GET /zones/:id — UC-93). Route GET /zones (list) không truyền
 * để tránh N+1 query — 2 field này sẽ là `undefined` và bị lược khi serialize JSON.
 */
export interface ZoneResponse {
  id: string;
  zone_code: string;
  zone_name: string;
  zone_type: string;
  building: string | null;
  floor: string | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  metadata_json: Record<string, unknown> | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  iot_devices?: IotDeviceResponseDto[];
  equipments?: EquipmentSummary[];
}

/**
 * Tóm tắt equipment gắn với zone — suy ra từ quan hệ có sẵn
 * `iot_devices.equipment_id -> equipments` (schema hiện tại KHÔNG có `equipments.zone_id`,
 * nên đây là đường liên kết zone -> equipment duy nhất, xem `IotDevicesService.findByZoneId`).
 */
export interface EquipmentSummary {
  id: string;
  equipment_code: string;
  equipment_name: string;
  equipment_type: string;
  asset_status: string;
  health_status: string;
}

export function toZoneResponse(
  entity: ZoneEntity,
  devices?: IoTDeviceEntity[],
): ZoneResponse {
  const response: ZoneResponse = {
    id: entity.id,
    zone_code: entity.zoneCode,
    zone_name: entity.zoneName,
    zone_type: entity.zoneType,
    building: entity.building,
    floor: entity.floor,
    description: entity.description,
    latitude: entity.latitude ?? null,
    longitude: entity.longitude ?? null,
    metadata_json: entity.metadataJson,
    status: entity.status,
    created_at: entity.createdAt,
    updated_at: entity.updatedAt,
  };

  if (devices) {
    response.iot_devices = devices.map(toIotDeviceResponse);

    // Dedupe theo equipment.id — nhiều thiết bị lý thuyết có thể trỏ cùng 1 equipment.
    const equipmentById = new Map<string, EquipmentSummary>();
    for (const device of devices) {
      const eq = device.equipment;
      if (eq && !equipmentById.has(eq.id)) {
        equipmentById.set(eq.id, {
          id: eq.id,
          equipment_code: eq.equipmentCode,
          equipment_name: eq.equipmentName,
          equipment_type: eq.equipmentType,
          asset_status: eq.assetStatus,
          health_status: eq.healthStatus,
        });
      }
    }
    response.equipments = Array.from(equipmentById.values());
  }

  return response;
}
