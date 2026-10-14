/**
 * IP khách thật phía sau reverse proxy (Render, Cloudflare…).
 *
 * `X-Forwarded-For` có dạng `<phần client tự điền>, <IP do proxy 1 nối thêm>, <IP do proxy 2 nối thêm>…`.
 * Phần bên TRÁI do chính client gửi nên giả được; chỉ phần các proxy của mình nối thêm (bên PHẢI) mới tin được.
 * Vì vậy lấy phần tử thứ `trustedHops` tính từ bên phải — `trustedHops` là số proxy đáng tin đứng trước ứng dụng
 * (1 = chỉ Render; 2 = Cloudflare + Render). `trustedHops = 0` → bỏ qua header, dùng địa chỉ kết nối trực tiếp.
 */
export function resolveClientIp(
  req: { headers: Record<string, unknown>; ip?: string; socket?: { remoteAddress?: string } },
  trustedHops: number,
): string {
  const direct = req.ip || req.socket?.remoteAddress || 'unknown';
  if (!(trustedHops > 0)) return direct;

  const raw = req.headers['x-forwarded-for'];
  const joined = Array.isArray(raw) ? raw.join(',') : String(raw ?? '');
  const hops = joined.split(',').map((s) => s.trim()).filter(Boolean);
  if (hops.length === 0) return direct;
  return hops.length >= trustedHops ? hops[hops.length - trustedHops] : hops[0];
}
