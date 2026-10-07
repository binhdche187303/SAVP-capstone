/**
 * DTO phản hồi UJN-001 — hành trình khuôn viên của MỘT người trong MỘT ngày,
 * ghép 3 KIỂU nguồn (xe qua cổng / check-in họp / hiện diện khu vực) thành 1 timeline.
 *
 * camelCase — khớp convention các DTO đọc của SAVP tầng service (vehicle-history,
 * ivss room access log).
 */

/** 3 KIỂU nguồn, KHÔNG phải 3 camera. Thêm cam zone mới vẫn là type 'zone'. */
export type UserJourneyEventType = 'gate' | 'meeting' | 'zone';

export interface UserJourneyEventDto {
  /**
   * UTC ISO — FE tự convert sang giờ VN để hiển thị.
   * Với meeting (phiên gộp) đây là thời điểm BẮT ĐẦU có mặt; sort dùng field này.
   */
  time: string;
  type: UserJourneyEventType;
  /**
   * gate: enter|leave · zone: appear|disappear · meeting: luôn `'session'`
   * (V2 gộp phiên nên không còn enter/leave lẻ). Null nếu nguồn không ghi.
   */
  direction: string | null;
  /** Câu mô tả người đọc được, dựng sẵn ở BE. */
  detail: string;
  /** Có ở gate + zone; null với meeting. */
  zoneName: string | null;
  /** Chỉ type='gate'. */
  plateNumber: string | null;
  /** Chỉ type='meeting'. */
  roomName: string | null;
  /** Chỉ type='meeting'. */
  meetingId: string | null;
  /**
   * [FIX 2026-08-09] FK → iot_device_events.id, dùng để FE hiện ảnh (mirror
   * ThumbnailImage/EventSnapshotModal). Có ở `gate` (g.event_id) và `meeting`
   * (id của event ĐẦU TIÊN trong phiên gộp). LUÔN null ở `zone` — cố ý,
   * KHÔNG đổi schema/query nguồn zone trong fix này.
   */
  sourceEventId?: string | null;

  // ── V2, CHỈ có ở type='meeting' (phiên gộp); gate/zone không set field nào dưới đây ──
  /** UTC ISO của event cuối phiên (kết thúc có mặt). */
  endTime?: string;
  /** endTime − time, mili-giây. 0 nếu phiên chỉ có 1 event. */
  durationMs?: number;
  /** Số lần camera thấy trong phiên — để minh bạch mức độ gộp. */
  eventCount?: number;
}

export interface UserJourneyResponseDto {
  userId: string;
  fullName: string | null;
  date: string;
  /** Chỉ có khi query theo khoảng ngày: ngày cuối của khoảng (`date` = ngày đầu). */
  to?: string;
  events: UserJourneyEventDto[];
  gateCount: number;
  /** V2: số PHIÊN có mặt phòng họp (đã gộp + lọc rác), KHÔNG phải số raw face event. */
  meetingCount: number;
  /** 0 là BÌNH THƯỜNG khi chưa lắp cam zone — không phải lỗi. */
  zoneCount: number;
}
