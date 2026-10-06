import type { ZoneEntity } from '../../zones/entities/zone.entity.js';
import type { ZoneCoordinatesDto } from '../dto/dashboard-overview-response.dto.js';

/**
 * Toạ độ GPS của zone (migration 20260722000010) → `{lat, lng}`; thiếu một trong hai = `null`
 * (zone chưa được đặt vị trí, FE bỏ qua khi vẽ bản đồ). `Number()` phòng trường hợp driver
 * trả `numeric` dạng chuỗi.
 */
export function toZoneCoordinates(
  zone: Pick<ZoneEntity, 'latitude' | 'longitude'> | undefined | null,
): ZoneCoordinatesDto | null {
  if (!zone || zone.latitude == null || zone.longitude == null) return null;
  const lat = Number(zone.latitude);
  const lng = Number(zone.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}
