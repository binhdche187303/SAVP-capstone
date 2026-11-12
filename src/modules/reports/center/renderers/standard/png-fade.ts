import * as zlib from 'zlib';

/**
 * Giải mã / mã hóa PNG tối thiểu để "pha" ảnh với nền trắng — dùng cho logo nền trong Excel.
 * Excel không có độ trong suốt cho ảnh đầu trang, còn gain/blacklevel của VML bị kẹp (sáng nhất ~24% đậm),
 * nên phải làm mờ sẵn điểm ảnh. Hỗ trợ PNG không xen kẽ (interlace) — loại phổ biến của logo;
 * ảnh không giải mã được trả về null để bên gọi tự xử lý.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const MAX_PIXELS = 25_000_000;

export interface RgbaImage { width: number; height: number; data: Buffer }

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function decodePng(buf: Buffer): RgbaImage | null {
  if (buf.length < 33 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  let w = 0, h = 0, depth = 0, type = -1, interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let pos = 8; pos + 8 <= buf.length;) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (kind === 'IHDR' && data.length >= 13) { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; type = data[9]; interlace = data[12]; }
    else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
  }
  const ch = CHANNELS[type];
  if (!ch || !w || !h || w * h > MAX_PIXELS || interlace !== 0 || ![1, 2, 4, 8, 16].includes(depth)) return null;
  if (type === 3 && !palette) return null;
  if ((type === 2 || type === 4 || type === 6) && depth < 8) return null;

  let raw: Buffer;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch { return null; }
  const stride = Math.ceil((w * ch * depth) / 8);
  if (raw.length < h * (stride + 1)) return null;
  const bpp = Math.max(1, (ch * depth) >> 3);

  // Bỏ bộ lọc từng dòng (None / Sub / Up / Average / Paeth).
  const px = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = px.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? out[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let pred: number;
      switch (filter) {
        case 0: pred = 0; break;
        case 1: pred = a; break;
        case 2: pred = b; break;
        case 3: pred = (a + b) >> 1; break;
        case 4: {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: return null;
      }
      out[i] = (line[i] + pred) & 0xff;
    }
    prev = out;
  }

  const max = (1 << Math.min(depth, 8)) - 1;
  const sample = (row: Buffer, idx: number): number => {
    if (depth === 8) return row[idx];
    if (depth === 16) return row[idx * 2]; // byte cao là đủ cho ảnh 8-bit đầu ra
    const bit = idx * depth;
    return (row[bit >> 3] >> (8 - depth - (bit & 7))) & max;
  };
  const gray = (v: number) => (depth >= 8 ? v : Math.round((v * 255) / max));

  const data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = px.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < w; x++) {
      const s = x * ch;
      const o = (y * w + x) * 4;
      let r: number, g: number, b: number, al = 255;
      if (type === 3) {
        const i = sample(row, x);
        r = palette![i * 3] ?? 0; g = palette![i * 3 + 1] ?? 0; b = palette![i * 3 + 2] ?? 0;
        if (trns && i < trns.length) al = trns[i];
      } else if (type === 0 || type === 4) {
        r = g = b = gray(sample(row, s));
        if (type === 4) al = sample(row, s + 1);
      } else {
        r = sample(row, s); g = sample(row, s + 1); b = sample(row, s + 2);
        if (type === 6) al = sample(row, s + 3);
      }
      data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = al;
    }
  }
  return { width: w, height: h, data };
}

export function encodePng(img: RgbaImage): Buffer {
  const chunk = (kind: string, body: Buffer) => {
    const t = Buffer.concat([Buffer.from(kind, 'latin1'), body]);
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(t));
    return Buffer.concat([len, t, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA 8-bit, không xen kẽ
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) img.data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/** Pha màu với giấy trắng: c' = 255 − o·(255 − c), giữ kênh alpha → in ra giống hệt ảnh có độ trong suốt `o`. */
export function fadePng(buf: Buffer, opacity: number): Buffer | null {
  const img = decodePng(buf);
  if (!img) return null;
  const o = Math.min(1, Math.max(0, opacity));
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.round(255 - o * (255 - d[i]));
    d[i + 1] = Math.round(255 - o * (255 - d[i + 1]));
    d[i + 2] = Math.round(255 - o * (255 - d[i + 2]));
  }
  return encodePng(img);
}
