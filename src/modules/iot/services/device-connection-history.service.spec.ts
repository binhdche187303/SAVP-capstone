import {
  buildSegments,
  uptimePercent,
} from './device-connection-history.service.js';

const t = (h: number) => new Date(Date.UTC(2026, 9, 1, h));

describe('device connection history', () => {
  it('ghép các lần đổi status thành đoạn liên tục phủ kín cửa sổ', () => {
    const segs = buildSegments(t(0), t(10), 'online', [
      { at: t(2), old: 'online', new: 'offline' },
      { at: t(3), old: 'offline', new: 'online' },
    ]);
    expect(segs.map((s) => [s.status, s.from, s.to])).toEqual([
      ['online', t(0), t(2)],
      ['offline', t(2), t(3)],
      ['online', t(3), t(10)],
    ]);
  });

  it('lấy trạng thái đầu từ thay đổi trước cửa sổ, bỏ thay đổi trùng status', () => {
    const segs = buildSegments(t(5), t(10), 'online', [
      { at: t(1), old: 'online', new: 'offline' },
      { at: t(6), old: 'offline', new: 'offline' },
    ]);
    expect(segs).toEqual([{ status: 'offline', from: t(5), to: t(10) }]);
  });

  it('uptime bỏ qua thời gian disabled/maintenance', () => {
    const segs = buildSegments(t(0), t(10), 'online', [
      { at: t(3), old: 'online', new: 'offline' },
      { at: t(4), old: 'offline', new: 'disabled' },
    ]);
    // online 3h, offline 1h, disabled 6h → 75%
    expect(uptimePercent(segs, t(0))).toBe(75);
    expect(uptimePercent(segs, t(5))).toBeNull();
  });
});
