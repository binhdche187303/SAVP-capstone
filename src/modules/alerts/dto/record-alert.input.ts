/**
 * RecordAlertInput (ASC-001 / UC-123) — tham số cho `AlertsService.recordAlert()`.
 *
 * KHÔNG phải HTTP DTO (không qua class-validator/@Body) — đây là contract nội bộ cho
 * module khác (3d/UC-124/UC-125, UC-121 Bước 4 sau) gọi qua tham số hàm, đúng kiến trúc
 * một chiều đã chốt (`alerts` KHÔNG tự đi hỏi module khác).
 */
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RecordAlertInput {
  alertType: string;
  zoneId?: string | null;
  /** Nếu KHÔNG truyền, dùng bảng mặc định tĩnh theo `alertType` (spec §2.2). */
  severity?: AlertSeverity;
  triggeredAt?: Date;
  sourceEventId?: string | null;
  ruleId?: string | null;
  payloadJson?: Record<string, unknown> | null;
  /**
   * Gộp alert đang mở theo (alertType, zoneId, dedupeKey). Bỏ trống = gộp theo
   * (alertType, zoneId) như cũ. VD person_watchlist_match: userId → mỗi người 1 alert.
   */
  dedupeKey?: string | null;
}

export interface RecordAlertResult {
  alert: import('../entities/security-alert.entity.js').SecurityAlertEntity;
  isNew: boolean;
}
