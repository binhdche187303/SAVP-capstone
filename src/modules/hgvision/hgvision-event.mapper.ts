import type { IvssFaceEvent } from '../../common/ports/ivss-event-hook.js';
import type { HgvisionHistoryObject } from './hgvision.client.js';

/**
 * Đổi 1 sự kiện lịch sử HGVision → IvssFaceEvent để đi chung pipeline presence
 * (IvssPresenceIngestionService) mà KHÔNG sửa nghiệp vụ.
 *
 * - channelId: HGVision định danh camera bằng TÊN → tra system_configs
 *   [hgvision.camera_channel_map] {camera_name: channelId}; channelId này dùng lại
 *   ivss.channel_room_map / channel_presence_zone_map / channel_direction_map.
 * - personUid: face_ident_text (định danh đăng ký trên HGVision) → resolve qua
 *   device_user_mappings (metadata_json.source = 'hgvision').
 * - Trả null nếu không phải sự kiện khuôn mặt hoặc camera chưa ánh xạ.
 */
export function toIvssFaceEvent(
  obj: HgvisionHistoryObject,
  cameraChannelMap: Record<string, number>,
): IvssFaceEvent | null {
  if (!obj.face_image_path && !obj.face_ident_text) return null;

  const channelId = cameraChannelMap[obj.camera_id];
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
