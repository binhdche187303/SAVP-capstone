export interface TimelineEventDto {
  eventTime: string;
  eventType: string;
  occupancyCount: number | null;
  userId: string | null;
  /**
   * "Người lạ" = eventType 'appear' + userId null (không nhận diện được danh tính).
   * Mirror công thức RAL-001/ALS-002 (ivss-room/zone-access-log.service.ts) nhưng CÓ
   * thêm điều kiện eventType — event 'count' (đếm người) LUÔN userId=null theo thiết
   * kế (writeCountEvent(), không gắn 1 người cụ thể) nên KHÔNG được coi là "người lạ".
   */
  isStranger: boolean;
}

export interface ZoneTimelineResponseDto {
  events: TimelineEventDto[];
  /** BR1: null nếu không xác định được (zone rỗng); false nếu zone chỉ có event userId=NULL. */
  personDataAvailable: boolean | null;
  /** Số lượt "bắt gặp" (event appear) của user trong khoảng thời gian; null khi không truyền userId. */
  sightingCount: number | null;
  message?: string;
  /**
   * Chỉ có khi khoảng > 31 ngày: BE tổng hợp sẵn (không trả sự kiện thô — có thể hàng triệu
   * dòng). Khi đó `events` chỉ là RECENT_LIMIT sự kiện appear/disappear gần nhất.
   */
  summary?: ZoneTimelineSummaryDto;
  /** Số đếm cho nút lọc (cả khoảng, không áp `status`); chỉ có khi khoảng có dữ liệu. */
  statusCounts?: { all: number; matched: number; stranger: number };
}

export interface ZoneTimelineSummaryDto {
  /** Tổng số sự kiện trong khoảng (mọi loại). */
  total: number;
  appearTotal: number;
  disappearTotal: number;
  /** 24 phần tử, index = giờ VN 0..23. */
  hourly: Array<{ hour: number; appear: number; disappear: number }>;
}
