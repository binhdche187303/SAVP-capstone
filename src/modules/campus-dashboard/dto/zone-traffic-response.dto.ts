export interface TrafficSeriesPointDto {
  zoneId: string;
  hourBucket: string;
  avgOccupancy: number;
  peakOccupancy: number;
}

export interface ZoneHeatmapDto {
  zoneId: string;
  zoneName: string;
  building: string | null;
  floor: string | null;
  avgOccupancy: number;
  peakOccupancy: number;
  peakAt: string | null;
  relativeDensity: number;
  /** Toạ độ GPS từ `zones.latitude/longitude`; `null` khi zone chưa được đặt vị trí. */
  coordinates: { lat: number; lng: number } | null;
}

export interface TrafficResponseDto {
  series: TrafficSeriesPointDto[];
  heatmap: ZoneHeatmapDto[];
}
