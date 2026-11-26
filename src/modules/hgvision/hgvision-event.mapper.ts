import type { IvssFaceEvent } from '../../common/ports/ivss-event-hook.js';
import type { VehicleEvent } from '../../common/ports/vehicle-event-hook.js';
import { normalizePlate } from '../anpr/utils/normalize-plate.js';
import type { HgvisionHistoryObject } from './hgvision.client.js';

const cameraNameKey = (name: string): string => name
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[đĐ]/g, 'd')
  .trim()
  .replace(/\s+/g, ' ')
  .toLowerCase();

/** Prefer the exact upstream identifier; only use an unambiguous name alias. */
export function resolveCameraChannel(
  name: string,
  map: Record<string, number>,
): number | undefined {
  if (Object.prototype.hasOwnProperty.call(map, name)) return map[name];
  const key = cameraNameKey(name);
  if (!key) return undefined;
  const channels = new Set(Object.entries(map)
    .filter(([candidate]) => cameraNameKey(candidate) === key)
    .map(([, channel]) => channel));
  return channels.size === 1 ? channels.values().next().value : undefined;
}

/**
 * Đổi 1 sự kiện lịch sử HGVision → IvssFaceEvent để đi chung pipeline presence
 * (IvssPresenceIngestionService) mà KHÔNG sửa nghiệp vụ.
 *
 * - channelId: HGVision định danh camera bằng TÊN → tra system_configs
 *   [hgvision.camera_channel_map] {camera_name: channelId}; channelId này dùng lại
 *   ivss.channel_room_map / channel_presence_zone_map / channel_direction_map.
 * - personUid: face_ident_text (định danh đăng ký trên HGVision) → resolve qua
 *   device_user_mappings (metadata_json.source = 'hgvision').
 * - HGVision có thể chỉ trả object_image_path cho người đi bộ; vẫn nhận đó
 *   là event hiện diện để màn hình truy vết hiển thị ảnh.
 * - Trả null nếu không có ảnh/định danh hoặc camera chưa ánh xạ.
 */
export function toIvssFaceEvent(
  obj: HgvisionHistoryObject,
  cameraChannelMap: Record<string, number>,
): IvssFaceEvent | null {
  const objectType = obj.object_type?.trim().toLowerCase();
  const isPersonObject = objectType === 'pedestrian' || objectType === 'person';
  if (
    !obj.face_image_path &&
    !obj.face_ident_text &&
    !(isPersonObject && obj.object_image_path)
  ) {
    return null;
  }

  const channelId = resolveCameraChannel(obj.camera_id, cameraChannelMap);
  if (channelId === undefined) return null;

  const ts = obj.first_timestamp ?? obj.last_timestamp;
  if (ts === undefined) return null;

  const personUid = obj.face_ident_text?.trim() || undefined;
  return {
    type: 'face_recognized',
    channelId,
    personUid,
    name: personUid,
    similarity: obj.confidence,
    utc: new Date(ts * 1000).toISOString(),
  };
}

/**
 * Đổi 1 sự kiện lịch sử HGVision có biển số (lp_text) → VehicleEvent để đi chung
 * pipeline ANPR (VehicleResolveService) như webhook IVSS. Trả null nếu không có
 * biển số hoặc camera chưa ánh xạ.
 */
export function toVehicleEvent(
  obj: HgvisionHistoryObject,
  cameraChannelMap: Record<string, number>,
): VehicleEvent | null {
  const plateRaw = obj.lp_text?.trim();
  if (!plateRaw) return null;

  const channelId = resolveCameraChannel(obj.camera_id, cameraChannelMap);
  if (channelId === undefined) return null;

  const ts = obj.first_timestamp ?? obj.last_timestamp;
  if (ts === undefined) return null;

  return {
    plateRaw,
    plateNumber: normalizePlate(plateRaw),
    channelId,
    utc: new Date(ts * 1000).toISOString(),
    vehicleType: obj.object_type,
    ...(obj.lp_type ? { plateColor: obj.lp_type } : {}),
    ...(typeof obj.confidence === 'number' ? { confidence: obj.confidence } : {}),
    ...(obj.first_timestamp !== undefined && {
      firstSeenAt: new Date(obj.first_timestamp * 1000).toISOString(),
    }),
    ...(obj.last_timestamp !== undefined && {
      lastSeenAt: new Date(obj.last_timestamp * 1000).toISOString(),
    }),
  };
}

/** Parse config {camera_name: channelId}; bỏ entry có channelId không phải số nguyên. */
export function parseCameraChannelMap(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n === 'number' && Number.isInteger(n)) out[name] = n;
  }
  return out;
}
