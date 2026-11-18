export class NotificationListItemDto {
  id: string;
  notificationType: string;
  subject: string | null;
  content: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  priority: string;
  createdAt: Date;
  /** [BE-07] Trạng thái đã đọc — nguồn Redis, xem NotificationReadStateService. */
  isRead: boolean;
  /**
   * [Nhóm E, 2026-08-08] Dữ liệu cấu trúc bổ sung tùy notificationType — ví dụ
   * `meeting_request_rejected` có thể mang `{conflictDetails, suggestedAlternatives}`.
   * Cột `payload_json` đã tồn tại sẵn trong baseline, trước đây bị lọc bỏ ở DTO này.
   */
  payloadJson: Record<string, unknown> | null;
  /**
   * [Fix 2026-08-21, Bug 1/2] Trạng thái SỐNG của `no_show_cases` tương ứng
   * (tra theo `payloadJson.noShowCaseId`), KHÔNG PHẢI snapshot tĩnh
   * `payloadJson.kind` lúc notification được tạo (payloadJson KHÔNG BAO GIỜ
   * được cập nhật lại sau khi tạo — record lịch sử). null nếu không phải
   * notificationType='no_show_alert' hoặc case đã bị xóa.
   */
  noShowLiveStatus?: string | null;
  /** Chỉ có giá trị khi noShowLiveStatus='snoozed'. */
  noShowSnoozeUntil?: Date | string | null;
}
