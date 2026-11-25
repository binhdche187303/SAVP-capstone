/**
 * ACCT-BIOMETRIC-SUBMIT-001 (FR-024) — Response cho POST /me/biometric-submission | biometric-scan.
 * [2026-11-23] Luôn tự duyệt ('approved'); trùng người khác chỉ gắn cờ phía quản trị (hậu kiểm).
 */
export class BiometricSubmissionResponseDto {
  faceProfileId: string;
  biometricReviewStatus: 'approved';
  submittedAt: string;
  sampleCount?: number;
  serverCheck?: 'passed' | 'skipped';
}
