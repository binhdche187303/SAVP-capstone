export interface ZoneCoordinatesDto {
  lat: number;
  lng: number;
}

export interface ZoneOccupancyDto {
  count: number | null;
  status: 'ok' | 'no_data';
}

export interface ZoneGateTrafficDto {
  entriesToday: number;
  exitsToday: number;
}

export interface ZoneCameraStatusDto {
  online: number;
  offline: number;
  disabled: number;
  maintenance: number;
  overall: 'no_device' | 'online' | 'degraded' | 'offline';
}

export interface ZoneOverviewDto {
  zoneId: string;
  zoneCode: string;
  zoneName: string;
  zoneType: string;
  /** Toạ độ GPS từ `zones.latitude/longitude`; `null` khi zone chưa được đặt vị trí. */
  coordinates: ZoneCoordinatesDto | null;
  occupancy: ZoneOccupancyDto;
  gateTraffic: ZoneGateTrafficDto;
  cameraStatus: ZoneCameraStatusDto;
}

export interface FloorOverviewDto {
  floor: string | null;
  zones: ZoneOverviewDto[];
}

export interface BuildingOverviewDto {
  building: string | null;
  floors: FloorOverviewDto[];
}

export interface DashboardOverviewResponseDto {
  generatedAt: string;
  buildings: BuildingOverviewDto[];
}
