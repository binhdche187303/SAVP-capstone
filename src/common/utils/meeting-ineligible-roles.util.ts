/**
 * Quy định nghiệp vụ (2026-08-21): chỉ tài khoản role EMPLOYEE hoặc MANAGER được
 * mời/tham gia cuộc họp. BUSINESS_ADMIN và SYSTEM_ADMIN không tham dự họp qua hệ
 * thống (cùng lý do với biometric-exempt-roles.util.ts — các role này không đi
 * qua FaceGate/điểm danh cuộc họp).
 *
 * Dùng chung cho: autocomplete gợi ý người tham dự (GET /users), thêm thủ công
 * (addInternalParticipant) và import Excel (ParticipantImportService).
 */
export const MEETING_INELIGIBLE_ROLE_CODES = [
  'BUSINESS_ADMIN',
  'SYSTEM_ADMIN',
  'GUARD',
];

export function isMeetingIneligibleRole(roleCodes: string[]): boolean {
  return roleCodes.some((code) => MEETING_INELIGIBLE_ROLE_CODES.includes(code));
}
