#!/usr/bin/env node
/**
 * Kiểm tra .env trước khi đưa lên server chính thức (production).
 *
 *   npm run preflight            # đọc ./.env
 *   node scripts/preflight-production.mjs path/to/.env
 *
 * Chỉ ĐỌC file, không sửa gì, không in ra giá trị bí mật.
 * Thoát mã 1 nếu còn lỗi ĐỎ (chặn deploy), mã 0 nếu chỉ còn cảnh báo VÀNG.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const envPath = resolve(process.argv[2] ?? '.env');
const examplePath = resolve('.env.example');

function parseEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

if (!existsSync(envPath)) {
  console.error(`Không tìm thấy ${envPath}. Hãy copy .env.example thành .env rồi điền giá trị.`);
  process.exit(1);
}

const env = parseEnv(envPath);
const example = parseEnv(examplePath);
const errors = [];
const warnings = [];
const isTrue = (v) => String(v ?? '').toLowerCase() === 'true';
const get = (k) => env[k] ?? '';

// ─── 1. Khoá bí mật (dùng để ký token đăng nhập) ────────────────────────────
const SECRETS = [
  'AUTH_ACCESS_TOKEN_SECRET',
  'AUTH_REFRESH_TOKEN_SECRET',
  'WARNING_TOKEN_SECRET',
  'GUEST_TOKEN_SECRET',
  'MEDIA_DOWNLOAD_TOKEN_SECRET',
  'NO_SHOW_CONFIRM_LINK_SECRET',
];
const seen = new Map();
for (const key of SECRETS) {
  const v = get(key);
  if (!v) {
    if (key !== 'NO_SHOW_CONFIRM_LINK_SECRET') errors.push(`${key} đang trống.`);
    continue;
  }
  if (v === example[key] || /change_me|your_|secret123|example/i.test(v)) {
    errors.push(`${key} vẫn là giá trị mẫu — ai đọc được mã nguồn cũng giả mạo được đăng nhập.`);
  } else if (v.length < 32) {
    errors.push(`${key} quá ngắn (${v.length} ký tự, cần ≥ 32).`);
  }
  if (seen.has(v)) errors.push(`${key} trùng với ${seen.get(v)} — mỗi khoá phải khác nhau.`);
  seen.set(v, key);
}

// ─── 2. Mật khẩu cơ sở dữ liệu / Redis / MinIO ──────────────────────────────
const WEAK = ['', '123456', '12345678', 'password', 'postgres', 'admin', 'change_me', 'minioadmin'];
const dbPass = get('DB_PASSWORD');
if (WEAK.includes(dbPass) || dbPass.length < 12) {
  errors.push('DB_PASSWORD yếu (trống / mặc định / < 12 ký tự).');
}
if (!get('REDIS_PASSWORD')) {
  warnings.push('REDIS_PASSWORD trống — nên đặt (docker-compose sẽ tự bật mật khẩu cho Redis).');
}
if (get('STORAGE_DRIVER') === 's3' && WEAK.includes(get('MINIO_ROOT_PASSWORD'))) {
  errors.push('Đang dùng S3/MinIO nhưng MINIO_ROOT_PASSWORD trống hoặc mặc định.');
}

// ─── 3. Chế độ chạy / tính năng chỉ dành cho test ───────────────────────────
const dockerNodeEnv = get('DOCKER_NODE_ENV') || 'production';
if (dockerNodeEnv !== 'production') {
  errors.push(`DOCKER_NODE_ENV=${dockerNodeEnv} — phải là production (nếu không, module /dev giả lập sẽ bật).`);
}
if (isTrue(get('DOCKER_DB_SYNCHRONIZE'))) {
  errors.push('DOCKER_DB_SYNCHRONIZE=true — TypeORM sẽ tự sửa bảng theo code, có thể mất dữ liệu.');
}
if (isTrue(get('MOCK_RECORDING_ENABLED'))) {
  errors.push('MOCK_RECORDING_ENABLED=true — bật camera/ghi hình giả lập và module /dev.');
}
if (isTrue(get('ZALO_ZBS_DEV_MODE'))) {
  warnings.push('ZALO_ZBS_DEV_MODE=true — (đã tự vô hiệu khi NODE_ENV=production) nên đặt false cho rõ ràng.');
}
if (isTrue(get('HGVISION_MOCK_FALLBACK_ENABLED'))) {
  warnings.push('HGVISION_MOCK_FALLBACK_ENABLED=true — khi mất kết nối HGVision sẽ hiện dữ liệu giả.');
}
if (isTrue(get('SWAGGER_ENABLED'))) {
  warnings.push('SWAGGER_ENABLED=true — trang /api/v1/docs liệt kê toàn bộ API cho bất kỳ ai.');
}
if (get('RATE_LIMIT_ENABLED') && !isTrue(get('RATE_LIMIT_ENABLED'))) {
  errors.push('RATE_LIMIT_ENABLED=false — tắt chống dò mật khẩu.');
}

// ─── 4. Địa chỉ công khai ───────────────────────────────────────────────────
// Mặc định CÙNG ĐỊA CHỈ: web gọi "/api/v1", nginx chuyển sang backend → chỉ cần PUBLIC_WEB_URL.
const feApi = get('FRONTEND_API_BASE_URL');
const twoAddressMode = Boolean(feApi) && !feApi.startsWith('/');
const urlKeys = twoAddressMode ? ['PUBLIC_WEB_URL', 'PUBLIC_API_URL'] : ['PUBLIC_WEB_URL'];
for (const key of urlKeys) {
  const v = get(key);
  if (!v) {
    errors.push(`${key} chưa đặt — backend sẽ dùng localhost (link mời khách, CORS, ảnh đại diện sẽ hỏng). Vd http://192.168.1.50:3001 hoặc https://savp.uel.edu.vn`);
  } else if (!/^https?:\/\/[^/]+/.test(v)) {
    errors.push(`${key}=${v} phải bắt đầu bằng http:// hoặc https://`);
  } else if (v.endsWith('/')) {
    errors.push(`${key} không được có dấu / ở cuối.`);
  } else if (/localhost|127\.0\.0\.1/.test(v)) {
    errors.push(`${key} trỏ localhost — máy khác không mở được link mời khách / ảnh đại diện.`);
  } else if (!v.startsWith('https://')) {
    warnings.push(`${key}=${v} chưa có https — chạy nội bộ thì tạm được, nhưng camera/micro trên trình duyệt sẽ bị chặn và mật khẩu không được mã hoá.`);
  }
}
if (twoAddressMode) {
  warnings.push('FRONTEND_API_BASE_URL đang là URL đầy đủ (chế độ 2 địa chỉ) — đổi địa chỉ sẽ phải build lại web. Để trống để dùng chế độ 1 địa chỉ.');
  if (/localhost|127\.0\.0\.1/.test(feApi)) {
    errors.push('FRONTEND_API_BASE_URL trỏ localhost — trình duyệt người dùng sẽ gọi vào máy của CHÍNH HỌ.');
  }
}

// ─── 5. Tích hợp ngoài ──────────────────────────────────────────────────────
if (!isTrue(get('MAIL_ENABLED'))) {
  warnings.push('MAIL_ENABLED=false — email OTP quên mật khẩu / thông báo sẽ KHÔNG được gửi.');
}
// Mọi địa chỉ dịch vụ ngoài (HGVision, IVSS bridge, LLM, SMTP, UEL…) trỏ localhost: trong Docker
// "localhost" là chính container backend → không tới được (vd HGVision báo 503 ở trang Ghi hình).
// Bỏ qua các biến docker-compose tự ghi đè (APP_URL, DB_HOST, REDIS_HOST…).
const COMPOSE_OVERRIDDEN = new Set([
  'APP_URL', 'API_PUBLIC_BASE_URL', 'STORAGE_PUBLIC_BASE_URL', 'GUEST_ACCESS_INVITE_BASE_URL',
  'DB_HOST', 'REDIS_HOST', 'BULL_REDIS_HOST', 'STORAGE_S3_ENDPOINT', 'PUBLIC_WEB_URL', 'PUBLIC_API_URL',
  'FRONTEND_API_BASE_URL', 'FRONTEND_WS_URL', 'UEL_SSO_FE_CALLBACK_URL',
]);
for (const [key, value] of Object.entries(env)) {
  if (COMPOSE_OVERRIDDEN.has(key) || !/(URL|HOST|ENDPOINT)$/.test(key)) continue;
  if (!/(^|\/\/|@)(localhost|127\.0\.0\.1)([:/]|$)/.test(value)) continue;
  if (/CALLBACK_URL$/.test(key)) {
    errors.push(`${key}=${value} trỏ localhost — đây là địa chỉ TRÌNH DUYỆT người dùng được chuyển về (vd sau đăng nhập SSO UEL); phải là địa chỉ web thật (PUBLIC_WEB_URL/...).`);
  } else {
    warnings.push(`${key} trỏ localhost — trong Docker "localhost" là chính container backend, không phải máy chủ. Dùng IP LAN của dịch vụ đó (hoặc host.docker.internal nếu chạy trên chính server).`);
  }
}
if (/test|local|change_me/i.test(get('IVSS_BRIDGE_TOKEN'))) {
  warnings.push('IVSS_BRIDGE_TOKEN có vẻ là token test — đổi sang chuỗi ngẫu nhiên dài.');
}
if (!get('BACKUP_DIR')) {
  warnings.push('BACKUP_DIR chưa đặt — bản sao lưu nằm trong ./backups cùng ổ với DB; hỏng ổ là mất cả hai.');
}

// ─── Kết quả ────────────────────────────────────────────────────────────────
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

console.log(`Kiểm tra: ${envPath}\n`);
for (const e of errors) console.log(red(`  ✗ ${e}`));
for (const w of warnings) console.log(yellow(`  ! ${w}`));
if (!errors.length && !warnings.length) console.log(green('  ✓ Không phát hiện vấn đề.'));
console.log(
  `\n${errors.length ? red(`${errors.length} lỗi (phải sửa)`) : green('0 lỗi')}, ` +
    `${warnings.length ? yellow(`${warnings.length} cảnh báo (nên xem)`) : '0 cảnh báo'}.`,
);
if (errors.length) {
  console.log('\nTạo khoá ngẫu nhiên: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"');
}
process.exit(errors.length ? 1 : 0);
