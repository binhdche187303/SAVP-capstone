import { resolveClientIp } from './client-ip.util.js';

const req = (xff?: string, ip = '10.0.0.9') => ({
  headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
  ip,
});

describe('resolveClientIp', () => {
  it('1 proxy đáng tin: lấy phần tử CUỐI do proxy nối thêm, không tin phần client tự điền', () => {
    // client giả "6.6.6.6", proxy nối IP thật "203.0.113.7"
    expect(resolveClientIp(req('6.6.6.6, 203.0.113.7'), 1)).toBe('203.0.113.7');
  });

  it('client gửi nhiều lần header giả khác nhau vẫn ra cùng một IP thật', () => {
    const a = resolveClientIp(req('1.1.1.1, 203.0.113.7'), 1);
    const b = resolveClientIp(req('2.2.2.2, 203.0.113.7'), 1);
    expect(a).toBe(b);
  });

  it('2 proxy đáng tin (Cloudflare + Render): lấy phần tử thứ 2 từ bên phải', () => {
    expect(resolveClientIp(req('6.6.6.6, 203.0.113.7, 172.70.1.1'), 2)).toBe('203.0.113.7');
  });

  it('chuỗi ngắn hơn số proxy đáng tin → lấy phần tử đầu (không vượt biên mảng)', () => {
    expect(resolveClientIp(req('203.0.113.7'), 2)).toBe('203.0.113.7');
  });

  it('không có header → dùng địa chỉ kết nối trực tiếp', () => {
    expect(resolveClientIp(req(undefined, '198.51.100.4'), 1)).toBe('198.51.100.4');
  });

  it('hops = 0 → bỏ qua hoàn toàn X-Forwarded-For', () => {
    expect(resolveClientIp(req('6.6.6.6', '198.51.100.4'), 0)).toBe('198.51.100.4');
  });

  it('bỏ khoảng trắng và phần tử rỗng; không có gì dùng được → "unknown"', () => {
    expect(resolveClientIp(req(' , 203.0.113.7 , '), 1)).toBe('203.0.113.7');
    expect(resolveClientIp({ headers: {} }, 1)).toBe('unknown');
  });

  it('header dạng mảng (Node gộp nhiều header) vẫn xử lý được', () => {
    expect(resolveClientIp({ headers: { 'x-forwarded-for': ['6.6.6.6', '203.0.113.7'] }, ip: '10.0.0.9' }, 1)).toBe('203.0.113.7');
  });
});
