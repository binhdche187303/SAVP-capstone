export class TrendPointDto {
  date: string;
  meetingCount: number;
  utilizationRate: number;
}

export class DashboardOverviewResponseDto {
  period: { from: string; to: string };
  meetingCount: number;
  /** Số phòng đang có cuộc họp in_progress tại thời điểm truy vấn. */
  activeRooms: number;
  utilizationRate: number;
  noShowRate: number;
  onTimeRate: number;
  recordingCount: number;
  activeUserCount: number;
  trend: TrendPointDto[];
}
