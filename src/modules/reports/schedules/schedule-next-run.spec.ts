// Chép từ FE scheduleNextRun.test.js (17 ca). Chạy trong UTC như máy chủ production để chứng minh kết quả không phụ thuộc TZ.
process.env.TZ = 'UTC';
import { computeNextRun, resolvePeriod } from './schedule-next-run.js';

// 2026-10-07 là thứ Tư. 03:00Z = 10:00 giờ Việt Nam.
const NOW = new Date('2026-10-07T03:00:00.000Z');
const iso = (d: Date | null) => (d as Date).toISOString();
const base = { enabled: true, time: '08:00' };

describe('computeNextRun', () => {
    it('lịch tắt → null', () => {
        expect(computeNextRun({ ...base, enabled: false, frequency: 'daily' }, NOW)).toBeNull();
    });
    it('hằng ngày, giờ đã qua → ngày mai', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'daily' }, NOW))).toBe('2026-10-08T01:00:00.000Z');
    });
    it('hằng ngày, giờ chưa tới → hôm nay', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'daily', time: '17:00' }, NOW))).toBe('2026-10-07T10:00:00.000Z');
    });
    it('đúng bằng giờ gửi → lần sau', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'daily' }, new Date('2026-10-07T01:00:00.000Z')))).toBe('2026-10-08T01:00:00.000Z');
    });
    it('qua nửa đêm giờ Việt Nam nhưng UTC còn ngày cũ', () => {
        // 18:30Z ngày 07 = 01:30 ngày 08 ở Việt Nam
        expect(iso(computeNextRun({ ...base, frequency: 'daily' }, new Date('2026-10-07T18:30:00.000Z')))).toBe('2026-10-08T01:00:00.000Z');
    });
    it('hằng tuần thứ Hai', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'weekly', dayOfWeek: 1 }, NOW))).toBe('2026-10-12T01:00:00.000Z');
    });
    it('hằng tuần đúng hôm nay, giờ đã qua → tuần sau', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'weekly', dayOfWeek: 3 }, NOW))).toBe('2026-10-14T01:00:00.000Z');
    });
    it('hằng tuần đúng hôm nay, giờ chưa tới → hôm nay', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'weekly', dayOfWeek: 3, time: '17:00' }, NOW))).toBe('2026-10-07T10:00:00.000Z');
    });
    it('hằng tháng ngày 1', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'monthly', dayOfMonth: 1 }, NOW))).toBe('2026-11-01T01:00:00.000Z');
    });
    it('ngày cuối tháng 31 ngày', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'monthly', dayOfMonth: 'last' }, NOW))).toBe('2026-10-31T01:00:00.000Z');
    });
    it('ngày cuối tháng 2 năm không nhuận', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'monthly', dayOfMonth: 'last' }, new Date('2027-02-10T03:00:00.000Z')))).toBe('2027-02-28T01:00:00.000Z');
    });
    it('ngày cuối tháng 30 ngày, đúng giờ gửi → cuối tháng sau', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'monthly', dayOfMonth: 'last' }, new Date('2026-04-30T01:00:00.000Z')))).toBe('2026-05-31T01:00:00.000Z');
    });
    it('tần suất lạ → ném lỗi', () => {
        expect(() => computeNextRun({ ...base, frequency: 'yearly' }, NOW)).toThrow('Tần suất không hợp lệ');
    });
});

describe('resolvePeriod', () => {
    it('hôm qua', () => {
        expect(resolvePeriod('yesterday', NOW)).toEqual({ from: '2026-10-06', to: '2026-10-06' });
    });
    it('tuần trước tính từ thứ Hai đến Chủ nhật', () => {
        expect(resolvePeriod('last_week', NOW)).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    });
    it('tháng trước', () => {
        expect(resolvePeriod('last_month', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    });
    it('tháng trước của tháng 1 lùi về năm trước', () => {
        expect(resolvePeriod('last_month', new Date('2027-01-15T03:00:00.000Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    });
});
