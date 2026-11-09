#!/usr/bin/env node
/**
 * API Đào tạo UEL giả lập — đúng quy ước trong tai-lieu-api-uelapi-20261102_v1.docx.
 *
 *   node scripts/uel-mock/server.mjs                 # cổng 4010, key "mock-key"
 *   UEL_MOCK_PORT=4010 UEL_MOCK_KEY=abc UEL_MOCK_VARIANT=2 node scripts/uel-mock/server.mjs
 *
 * Trỏ BE vào: UEL_API_BASE_URL=http://localhost:4010  UEL_API_KEY=mock-key
 *
 * - POST /gw/v1/uelapi/{subsystem}/{api}, header X-Api-Key, body JSON phẳng.
 * - Tham số lạ / sai kiểu → 400 Validation; sai key → 401; sai method → 405; sai Content-Type → 415.
 * - Không có dữ liệu → 404 Data.NotFound (giống tài liệu).
 * - UEL_MOCK_VARIANT=2: dữ liệu "lần sau" (1 cán bộ nghỉ, 1 SV rút học phần, 1 buổi bị hủy,
 *   đổi phòng 1 buổi) để kiểm tra phần vô hiệu hóa của đồng bộ.
 * - UEL_MOCK_RATE_LIMIT=n: trả 429 (Retry-After: 1) cho mỗi lần gọi thứ n.
 */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { buildData } from './fixtures.mjs';

const PORT = Number(process.env.UEL_MOCK_PORT ?? 4010);
const KEY = process.env.UEL_MOCK_KEY ?? 'mock-key';
const VARIANT = Number(process.env.UEL_MOCK_VARIANT ?? 1);
const RATE_EVERY = Number(process.env.UEL_MOCK_RATE_LIMIT ?? 0);
const MAX_BODY = 64 * 1024;

const data = buildData(VARIANT);

/** api → { filters: {name: 'string'|'integer'}, rows(filter) }. */
const APIS = {
  'nhansu/ds_nhansu': { filters: {}, rows: () => data.nhanSu },
  'nhansu/ds_phong_ban': { filters: {}, rows: () => data.phongBan },
  'nhansu/thong_tin_nhansu': {
    filters: { ma_nhan_su: 'string' },
    rows: (f) => data.nhanSu.filter(eq(f, 'ma_nhan_su')),
  },
  'sinhvien/ds_lopsv': { filters: {}, rows: () => data.lopSv },
  'sinhvien/ds_sv_lopsv': {
    filters: { ma_lop: 'string' },
    rows: (f) => data.svLopSv.filter(eq(f, 'ma_lop')),
  },
  'sinhvien/thong_tin_sv': {
    filters: { ma_sinh_vien: 'string' },
    rows: (f) => data.thongTinSv.filter(eq(f, 'ma_sinh_vien')),
  },
  'thoikhoabieu/chi_tiet_tkb_1buoi': {
    filters: { ma_buoi_hoc: 'integer' },
    rows: (f) => data.tkb1Buoi.filter(eq(f, 'ma_buoi_hoc')),
  },
  'thoikhoabieu/chi_tiet_tkb_gv_1ngay': {
    filters: { ngay_hoc: 'string', ma_giang_vien: 'string' },
    rows: (f) =>
      data.tkbNgay.filter(eq(f, 'ngay_hoc')).filter(eq(f, 'ma_giang_vien')),
  },
  'thoikhoabieu/chi_tiet_tkb_sv_1ngay': {
    filters: { ngay_hoc: 'string', ma_sinh_vien: 'string' },
    rows: (f) =>
      data.tkbSvNgay.filter(eq(f, 'ngay_hoc')).filter(eq(f, 'ma_sinh_vien')),
  },
  'thoikhoabieu/tkb_ds_lophp': {
    filters: { nam_hoc: 'string', hoc_ky: 'string' },
    rows: (f) => data.lopHp.filter(eq(f, 'nam_hoc')).filter(eq(f, 'hoc_ky')),
  },
  'thoikhoabieu/tkb_lophp_1ngay': {
    filters: { ngay_hoc: 'string' },
    rows: (f) => data.tkbNgay.filter(eq(f, 'ngay_hoc')),
  },
  'dkhp/dkhp_ds_dangkycua1lophocphan': {
    filters: { ma_lop_hoc_phan: 'string' },
    rows: (f) => data.dangKy.filter(eq(f, 'ma_lop_hoc_phan')),
  },
  'dkhp/dkhp_ds_dangkycua1sinhvien': {
    filters: { ma_sinh_vien: 'string' },
    rows: (f) => data.dangKy.filter(eq(f, 'ma_sinh_vien')),
  },
};

/** Lọc "so khớp bằng"; bỏ trống / null = không lọc. */
function eq(filter, field) {
  const v = filter[field];
  return (row) => v === undefined || v === null || v === '' || row[field] === v;
}

let calls = 0;

const server = http.createServer((req, res) => {
  const traceId = randomBytes(16).toString('hex');
  res.setHeader('X-Trace-Id', traceId);
  const fail = (status, code, message, details) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { code, message, ...(details ? { details } : {}) }, traceId }));
    log(req, status);
  };

  const m = /^\/gw\/v1\/([^/]+)\/([^/]+\/[^/?]+)$/.exec(req.url ?? '');
  if (!m || m[1] !== 'uelapi' || !APIS[m[2]]) {
    return fail(404, 'Api.NotFound', 'API không tồn tại hoặc chưa được xuất bản.');
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return log(req, 405);
  }
  if (req.headers['x-api-key'] !== KEY) {
    return fail(401, 'ApiKey.Invalid', 'API key không hợp lệ, đã hết hạn hoặc IP không được phép.');
  }
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    return fail(415, 'Request.ContentType', 'Body phải là JSON (Content-Type: application/json).');
  }
  calls++;
  if (RATE_EVERY > 0 && calls % RATE_EVERY === 0) {
    res.writeHead(429, { 'Retry-After': '1' }).end();
    return log(req, 429);
  }

  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size <= MAX_BODY) chunks.push(c);
  });
  req.on('end', () => {
    if (size > MAX_BODY) return fail(413, 'Request.TooLarge', 'Body tối đa 64 KB.');
    let body;
    try {
      body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      return fail(400, 'Request.InvalidJson', 'Body không phải JSON hợp lệ.');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return fail(400, 'Request.InvalidJson', 'Body không phải JSON hợp lệ.');
    }

    const api = APIS[m[2]];
    const details = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== null && typeof v === 'object') {
        return fail(400, 'Request.Invalid', 'Tham số truy vấn không hợp lệ.');
      }
      const type = k === 'page' || k === 'limit' ? 'integer' : api.filters[k];
      if (!type) details[k] = ['Tham số không được hỗ trợ.'];
      else if (v !== null && type === 'integer' && !Number.isInteger(v)) details[k] = ['Sai kiểu.'];
      else if (v !== null && type === 'string' && typeof v !== 'string') details[k] = ['Sai kiểu.'];
    }
    const page = body.page ?? 1;
    const limit = body.limit ?? 200;
    if (!details.page && page < 1) details.page = ['page ngoài phạm vi.'];
    if (!details.limit && (limit < 1 || limit > 1000)) details.limit = ['limit ngoài phạm vi 1..1000.'];
    if (Object.keys(details).length) {
      return fail(400, 'Validation', 'Tham số truy vấn không hợp lệ.', details);
    }

    const all = api.rows(body);
    if (!all.length) return fail(404, 'Data.NotFound', 'Không có dữ liệu theo điều kiện.');
    const items = all.slice((page - 1) * limit, page * limit).map((row, i) => ({
      stt: (page - 1) * limit + i + 1,
      ...row,
    }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({ items, total: all.length, page, limit, totalPages: Math.ceil(all.length / limit) }),
    );
    log(req, 200, `${m[2]} ${JSON.stringify(body)} → ${items.length}/${all.length}`);
  });
});

function log(req, status, extra = '') {
  if (process.env.UEL_MOCK_QUIET) return;
  console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${status} ${extra}`);
}

server.listen(PORT, () => {
  console.log(
    `UEL mock (variant ${VARIANT}) http://localhost:${PORT}  key=${KEY}  ` +
      `học kỳ ${data.namHoc}/HK${data.hocKy}, lịch ${data.fromDate}..${data.toDate}`,
  );
});
