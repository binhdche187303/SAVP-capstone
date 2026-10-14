import {
  translateActionTypeToVn,
  translateEntityTypeToVn,
  translateSeverityToVn,
} from '../constants/audit-log-vn-labels.constant.js';

/**
 * Unit tests cho bảng dịch tiếng Việt dùng trong export audit-logs XLSX
 * (Docs/Nam_Sent/be-audit-log-export-requirement.md §2, yêu cầu FE 2026-08-12).
 */
describe('audit-log-vn-labels.constant', () => {
  describe('translateActionTypeToVn', () => {
    it.each([
      ['LOGIN', 'Đăng nhập'],
      ['LOGIN_FAILED', 'Đăng nhập thất bại'],
      ['LOGOUT', 'Đăng xuất'],
      ['CREATE_USER', 'Thêm tài khoản'],
      ['UPDATE_USER', 'Cập nhật tài khoản'],
      ['LOCK_USER', 'Khóa tài khoản'],
      ['UNLOCK_USER', 'Mở khóa tài khoản'],
      ['DELETE_USER', 'Xóa tài khoản'],
      ['REGISTER_DEVICE', 'Đăng ký thiết bị'],
      ['UPDATE_DEVICE', 'Cập nhật thiết bị'],
      ['REMOVE_DEVICE', 'Vô hiệu hóa thiết bị'],
      ['DEVICE_OFFLINE', 'Thiết bị mất kết nối'],
      ['EXPORT_USERS', 'Xuất tệp nhân viên'],
      ['UPDATE_CONFIG', 'Cập nhật cấu hình hệ thống'],
    ])('maps %s -> %s', (raw, expected) => {
      expect(translateActionTypeToVn(raw)).toBe(expected);
    });

    it('is case-insensitive against the lookup table', () => {
      expect(translateActionTypeToVn('login')).toBe('Đăng nhập');
      expect(translateActionTypeToVn('Create_User')).toBe('Thêm tài khoản');
    });

    it('falls back to lowercase + underscore-to-space + keyword translation + capitalize', () => {
      expect(translateActionTypeToVn('view_detail')).toBe('Xem chi tiết');
      expect(translateActionTypeToVn('read_analytics')).toBe('Xem thống kê');
    });

    it('maps real action codes stored in audit_logs (same labels as FE)', () => {
      expect(translateActionTypeToVn('user_create')).toBe('Thêm tài khoản');
      expect(translateActionTypeToVn('ACCOUNT_LOCK')).toBe('Khóa tài khoản');
      expect(translateActionTypeToVn('auto_offline')).toBe(
        'Thiết bị mất kết nối',
      );
      expect(translateActionTypeToVn('read_analytics_on_time_rate')).toBe(
        'Xem thống kê tỷ lệ đúng giờ',
      );
      expect(translateActionTypeToVn('biometric.download')).toBe(
        'Tải xuống dữ liệu khuôn mặt',
      );
      expect(translateActionTypeToVn('export_audit_logs')).toBe(
        'Xuất nhật ký hệ thống',
      );
    });

    it('translates known prefixes for unmapped codes', () => {
      expect(translateActionTypeToVn('read_analytics_new_metric')).toBe(
        'Xem thống kê new metric',
      );
    });

    it('keeps unmapped words untranslated in the fallback path', () => {
      expect(translateActionTypeToVn('foo_bar.baz')).toBe('Foo bar baz');
    });
  });

  describe('translateEntityTypeToVn', () => {
    it.each([
      ['auth', 'Hệ thống xác thực'],
      ['users', 'Quản lý tài khoản'],
      ['iot-devices', 'Giám sát thiết bị IoT'],
      ['rooms', 'Quản lý phòng họp'],
      ['system-configurations', 'Cấu hình hệ thống'],
    ])('maps %s -> %s', (raw, expected) => {
      expect(translateEntityTypeToVn(raw)).toBe(expected);
    });

    it('passes through unmapped entity types unchanged', () => {
      expect(translateEntityTypeToVn('meeting')).toBe('meeting');
    });
  });

  describe('translateSeverityToVn', () => {
    it.each([
      ['info', 'Thành công'],
      ['warning', 'Cảnh báo'],
      ['error', 'Thất bại'],
      ['critical', 'Nghiêm trọng'],
    ])('maps %s -> %s', (raw, expected) => {
      expect(translateSeverityToVn(raw)).toBe(expected);
    });
  });
});
