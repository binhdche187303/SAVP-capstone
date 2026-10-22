/**
 * DTO phản hồi Zone Access Log (đường B, FIX 2026-08-11) — mirror gần như 1:1
 * `room-access-log-response.dto.ts` (RAL-001 / Màn 2), đổi room→zone.
 *
 * camelCase — khớp convention module ivss.
 */

import type { AccessLogPaginationDto } from './room-access-log-response.dto.js';

export type { AccessLogPaginationDto };

/** Mirror `RoomAccessLogUserDto` — CHỈ avatarUrl/email/department (xem lý do ở bản gốc). */
export interface ZoneAccessLogUserDto {
  avatarUrl: string | null;
  email: string | null;
  department: string | null;
}

export interface ZoneAccessLogEventDto {
  id: string;
  eventTime: string;
  userId: string | null;
  fullName: string | null;
  /** null khi userId null (event chưa khớp danh tính) — mirror owner:null ở AdminVehicleOwner. */
  user: ZoneAccessLogUserDto | null;
  zoneId: string;
  zoneName: string | null;
  direction: string | null;
  /** matched | unmatched_identity | unmatched_location | unmatched_both (ingestion:44-48). */
  matchState: string | null;
  similarity: number | null;
  /** Nguồn camera (họp 20/10: mọi log camera phải xác định được camera, nhóm camera). */
  deviceId: string | null;
  deviceCode: string | null;
  deviceName: string | null;
  groupNames: string[];
  /** userId NULL — KHÔNG nhận diện được danh tính (mirror isStranger RAL-001/ALS-002). */
  isStranger: boolean;
  /** matchState bắt đầu bằng 'unmatched' — ngữ nghĩa cũ, giữ song song isStranger. */
  isUnmatched: boolean;
}

export interface ZoneAccessLogResponseDto {
  zoneId: string;
  zoneName: string | null;
  date: string;
  /** Tổng số event khớp bộ lọc (TOÀN BỘ, không chỉ trang hiện tại) — bằng `pagination.total`. */
  totalEvents: number;
  /** Đếm trên TOÀN BỘ kết quả lọc, không phải chỉ trang hiện tại. */
  matchedCount: number;
  /** Đếm theo ngữ nghĩa `isUnmatched` (matchState 'unmatched*'), toàn bộ kết quả lọc. */
  unmatchedCount: number;
  pagination: AccessLogPaginationDto;
  events: ZoneAccessLogEventDto[];
}
