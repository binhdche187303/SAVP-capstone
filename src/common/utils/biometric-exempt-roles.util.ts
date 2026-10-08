/**
 * BA đổi nghiệp vụ (2026-08-03): tài khoản giữ role BUSINESS_ADMIN hoặc SYSTEM_ADMIN
 * (bất kể có giữ thêm role khác hay không) không cần đăng ký sinh trắc học, vì các
 * role này không trực tiếp tham dự họp qua FaceGate.
 *
 * Dùng chung cho `auth` (login response) và `accounts` (self-service status/submit)
 * — đặt ở `common` để tránh cross-module import, cùng lý do với
 * `biometric-status-resolver.util.ts`.
 */
export const BIOMETRIC_EXEMPT_ROLE_CODES = [
  'BUSINESS_ADMIN',
  'SYSTEM_ADMIN',
];

export function isBiometricExemptRole(roleCodes: string[]): boolean {
  return roleCodes.some((code) => BIOMETRIC_EXEMPT_ROLE_CODES.includes(code));
}
