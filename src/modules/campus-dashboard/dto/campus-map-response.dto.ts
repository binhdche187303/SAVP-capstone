import type {
  ZoneCameraStatusDto,
  ZoneCoordinatesDto,
  ZoneOccupancyDto,
} from './dashboard-overview-response.dto.js';

export interface MapCameraDto {
  deviceId: string;
  deviceCode: string;
  deviceName: string;
  deviceType: string;
  status: string;
  lastSeenAt: string | null;
}

export interface MapAlertDto {
  alertId: string;
  alertType: string;
  severity: string;
  status: string;
  triggeredAt: string;
  lastSeenAt: string | null;
  occurrenceCount: number;
}

export interface MapZoneAlertsDto {
  /** Số cảnh báo có hoạt động (`last_seen_at`/`triggered_at`) trong cửa sổ `hours`. */
  total: number;
  /** Trong số trên, số cảnh báo CHƯA xử lý xong (`status <> 'resolved'`). */
  open: number;
  /** Mức nghiêm trọng cao nhất trong số cảnh báo chưa xử lý; `null` nếu không có. */
  topOpenSeverity: string | null;
  /** Tối đa 5 cảnh báo gần nhất trong cửa sổ. */
  latest: MapAlertDto[];
}

export interface MapZoneDto {
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  zoneType: string;
  building: string | null;
  floor: string | null;
  status: string;
  /** `null` = zone chưa được đặt vị trí ⇒ FE không vẽ marker, chỉ liệt kê. */
  coordinates: ZoneCoordinatesDto | null;
  occupancy: ZoneOccupancyDto;
  cameraStatus: ZoneCameraStatusDto;
  cameras: MapCameraDto[];
  alerts: MapZoneAlertsDto;
}

export interface CampusMapSummaryDto {
  totalZones: number;
  zonesWithCoordinates: number;
  totalCameras: number;
  camerasOnline: number;
  alertsInWindow: number;
  openAlertsInWindow: number;
  /** Cảnh báo trong cửa sổ KHÔNG gắn zone (`zone_id` NULL) ⇒ không đặt được lên bản đồ. */
  unlocatedAlertsInWindow: number;
}

export interface CampusMapResponseDto {
  generatedAt: string;
  hours: number;
  since: string;
  summary: CampusMapSummaryDto;
  zones: MapZoneDto[];
}
