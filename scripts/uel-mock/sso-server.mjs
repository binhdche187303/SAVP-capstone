#!/usr/bin/env node
/**
 * PSC SSO UEL giả lập — bám https://apps.uel.edu.vn/sso-docs (quickstart, token, profile, assignments).
 *
 *   node scripts/uel-mock/sso-server.mjs        # cổng 4020, client mock-client / mock-secret
 *
 * Trỏ BE vào:
 *   UEL_SSO_ENABLED=true
 *   UEL_SSO_BASE_URL=http://localhost:4020
 *   UEL_SSO_CLIENT_ID=mock-client
 *   UEL_SSO_CLIENT_SECRET=mock-secret
 *   UEL_SSO_REDIRECT_URI=http://localhost:3000/api/v1/auth/sso/callback
 *
 * Biến môi trường: UEL_MOCK_SSO_PORT, UEL_MOCK_SSO_CLIENT_ID, UEL_MOCK_SSO_CLIENT_SECRET,
 * UEL_MOCK_SSO_REDIRECT_URIS (phân tách dấu phẩy — redirect_uri được đăng ký), UEL_MOCK_VARIANT.
 *
 * Trang đăng nhập liệt kê cán bộ + sinh viên lấy từ fixtures.mjs (cùng dữ liệu với API Đào tạo
 * giả lập ⇒ sau khi chạy đồng bộ, mã SV / mã NS khớp tài khoản trong DB), kèm vài ca đặc biệt:
 * tài khoản chưa có trong hệ thống, tài khoản bị khóa ở UEL, nút "Hủy", và form tự nhập.
 */
import http from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { buildData } from './fixtures.mjs';

const PORT = Number(process.env.UEL_MOCK_SSO_PORT ?? 4020);
const CLIENT_ID = process.env.UEL_MOCK_SSO_CLIENT_ID ?? 'mock-client';
const CLIENT_SECRET = process.env.UEL_MOCK_SSO_CLIENT_SECRET ?? 'mock-secret';
const REDIRECT_URIS = (
  process.env.UEL_MOCK_SSO_REDIRECT_URIS ??
  'http://localhost:3000/api/v1/auth/sso/callback'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const VARIANT = Number(process.env.UEL_MOCK_VARIANT ?? 1);
const CODE_TTL_MS = 60_000;
const TOKEN_TTL_S = 300;
const BASE = `http://localhost:${PORT}`;

// ─── Người dùng giả lập ────────────────────────────────────────────────────
const data = buildData(VARIANT);
const users = new Map();
function addUser(u) {
  users.set(u.userName, { enabled: true, status: 'active', emailVerified: true, ...u });
}
for (const ns of data.nhanSu) {
  addUser({
    userName: ns.ma_nhan_su.toLowerCase(),
    firstName: ns.ten,
    lastName: ns.ho,
    email: ns.email ?? undefined,
    publicServantNumber: ns.ma_nhan_su,
    group: 'Cán bộ',
    position: ns.loai,
    department: ns.ten_phong_ban,
  });
}
for (const sv of data.svLopSv) {
  const parts = sv.ho_ten.split(' ');
  addUser({
    userName: sv.ma_sinh_vien.toLowerCase(),
    firstName: parts.pop(),
    lastName: parts.join(' '),
    email: sv.email ?? undefined,
    studentId: sv.ma_sinh_vien,
    group: 'Sinh viên',
    position: 'Sinh viên',
    department: sv.ma_lop,
  });
}
addUser({
  userName: 'chua.co.tk',
  firstName: 'Người',
  lastName: 'Ngoài Hệ Thống',
  email: 'nobody@mock.uel.test',
  studentId: 'K99999999',
  group: 'Ca đặc biệt',
  position: 'Sinh viên',
  department: 'Không có trong DB',
  note: 'Chưa có tài khoản trong hệ thống ⇒ SSO_ACCOUNT_NOT_LINKED',
});
addUser({
  userName: 'bi.khoa',
  firstName: 'Tài khoản',
  lastName: 'Bị Khóa',
  email: 'locked@mock.uel.test',
  publicServantNumber: 'NS003',
  status: 'inactive',
  enabled: false,
  group: 'Ca đặc biệt',
  position: 'Cán bộ',
  department: '—',
  note: 'Bị khóa ở UEL ⇒ SSO_ACCOUNT_INACTIVE',
});

// ─── Trạng thái trong bộ nhớ ───────────────────────────────────────────────
const codes = new Map(); // code → { user, clientId, redirectUri, codeChallenge, exp }
const tokens = new Map(); // accessToken → { user, exp }

// ─── HTTP helpers ──────────────────────────────────────────────────────────
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string';
  res.writeHead(status, {
    'Content-Type': isStr ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(isStr ? body : JSON.stringify(body));
}
const fail = (res, status, error, error_description) =>
  send(res, status, { error, error_description });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function bearer(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
  if (!m) return null;
  const t = tokens.get(m[1]);
  if (!t || t.exp < Date.now()) return null;
  return t.user;
}

function redirect(res, target, params) {
  const url = new URL(target);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  res.writeHead(302, { Location: url.toString(), 'Cache-Control': 'no-store' });
  res.end();
}

// ─── Trang đăng nhập ───────────────────────────────────────────────────────
function loginPage(q) {
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'scope']
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q.get(k))}">`)
    .join('');
  const groups = new Map();
  for (const u of users.values()) {
    if (!groups.has(u.group)) groups.set(u.group, []);
    groups.get(u.group).push(u);
  }
  const sections = [...groups.entries()]
    .map(
      ([g, list]) => `
    <h3>${esc(g)} <small>(${list.length})</small></h3>
    <div class="grid">${list
      .map(
        (u) => `
      <button name="user" value="${esc(u.userName)}" class="${u.status !== 'active' ? 'warn' : ''}">
        <b>${esc(u.lastName)} ${esc(u.firstName)}</b>
        <span>${esc(u.studentId ?? u.publicServantNumber ?? '')} · ${esc(u.position)}</span>
        <span>${esc(u.email ?? '(không có email)')}</span>
        ${u.note ? `<em>${esc(u.note)}</em>` : ''}
      </button>`,
      )
      .join('')}
    </div>`,
    )
    .join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8">
<title>UEL SSO (giả lập)</title>
<style>
 body{font-family:system-ui,Segoe UI,sans-serif;margin:0;background:#f3f5f9;color:#1d2433}
 header{background:#0b3a82;color:#fff;padding:16px 28px}
 header small{opacity:.8}
 main{padding:20px 28px;max-width:1200px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
 button{display:flex;flex-direction:column;gap:2px;text-align:left;padding:10px 12px;border:1px solid #cdd5e3;border-radius:8px;background:#fff;cursor:pointer;font:inherit}
 button:hover{border-color:#0b3a82;box-shadow:0 0 0 2px #0b3a8233}
 button span{font-size:12px;color:#5b6577} button em{font-size:12px;color:#b45309}
 button.warn{background:#fff7ed}
 .bar{display:flex;gap:12px;align-items:center;margin:8px 0 16px}
 .cancel{background:#fee2e2;border-color:#fca5a5;flex-direction:row}
 fieldset{border:1px solid #cdd5e3;border-radius:8px;background:#fff;margin-top:20px}
 fieldset input{margin:4px 8px 4px 0;padding:6px}
 .note{font-size:13px;color:#5b6577}
</style></head><body>
<header><b>Trường Đại học Kinh tế - Luật · Đăng nhập một lần</b><br>
<small>MÔI TRƯỜNG GIẢ LẬP — chọn một người dùng để đăng nhập (không cần mật khẩu)</small></header>
<main>
 <p class="note">Ứng dụng yêu cầu: <b>${esc(q.get('client_id'))}</b> · scope <code>${esc(q.get('scope'))}</code><br>
 Sinh viên/cán bộ lấy từ API Đào tạo giả lập — phải chạy đồng bộ UEL trước thì hệ thống mới có tài khoản tương ứng.</p>
 <form method="post" action="/api/psc-sso/authorize/decision">${hidden}
  <div class="bar"><button class="cancel" name="decision" value="deny">✕ Hủy đăng nhập (access_denied)</button></div>
  ${sections}
 </form>
 <form method="post" action="/api/psc-sso/authorize/decision">${hidden}
  <fieldset><legend>Tự nhập danh tính</legend>
   <input name="c_userName" placeholder="userName" required>
   <input name="c_email" placeholder="email">
   <label><input type="checkbox" name="c_emailVerified" checked> emailVerified</label>
   <input name="c_studentId" placeholder="studentId (mã SV)">
   <input name="c_publicServantNumber" placeholder="publicServantNumber (mã NS)">
   <button name="user" value="__custom__" style="display:inline-flex">Đăng nhập</button>
  </fieldset>
 </form>
</main></body></html>`;
}

// ─── Routes ────────────────────────────────────────────────────────────────
async function handle(req, res) {
  const url = new URL(req.url, BASE);
  const path = url.pathname;

  if (req.method === 'GET' && path === '/api/psc-sso/.well-known/openid-configuration') {
    return send(
      res,
      200,
      {
        issuer: `${BASE}/api/psc-sso`,
        authorization_endpoint: `${BASE}/api/psc-sso/authorize`,
        token_endpoint: `${BASE}/api/auth/tokens/authorization-code`,
        userinfo_endpoint: `${BASE}/api/accounts/profile`,
        response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'profile', 'email'],
      },
      { 'Cache-Control': 'public, max-age=3600' },
    );
  }

  if (req.method === 'GET' && path === '/api/psc-sso/authorize') {
    const q = url.searchParams;
    if (q.get('client_id') !== CLIENT_ID) return send(res, 400, '<h3>client_id không hợp lệ</h3>');
    if (!REDIRECT_URIS.includes(q.get('redirect_uri') ?? ''))
      return send(res, 400, `<h3>redirect_uri chưa đăng ký: ${esc(q.get('redirect_uri'))}</h3>`);
    if (q.get('response_type') !== 'code')
      return redirect(res, q.get('redirect_uri'), { error: 'unsupported_response_type', state: q.get('state') });
    if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge'))
      return redirect(res, q.get('redirect_uri'), { error: 'invalid_request', error_description: 'PKCE S256 bắt buộc', state: q.get('state') });
    if (!q.get('state'))
      return redirect(res, q.get('redirect_uri'), { error: 'invalid_request', error_description: 'thiếu state' });
    return send(res, 200, loginPage(q));
  }

  if (req.method === 'POST' && path === '/api/psc-sso/authorize/decision') {
    const f = new URLSearchParams(await readBody(req));
    const redirectUri = f.get('redirect_uri') ?? '';
    if (f.get('client_id') !== CLIENT_ID || !REDIRECT_URIS.includes(redirectUri))
      return send(res, 400, '<h3>Yêu cầu không hợp lệ</h3>');
    const state = f.get('state');
    if (f.get('decision') === 'deny') return redirect(res, redirectUri, { error: 'access_denied', state });

    let user;
    if (f.get('user') === '__custom__') {
      user = {
        userName: f.get('c_userName') || 'custom',
        firstName: 'Tự',
        lastName: 'Nhập',
        email: f.get('c_email') || undefined,
        emailVerified: f.get('c_emailVerified') === 'on',
        studentId: f.get('c_studentId') || undefined,
        publicServantNumber: f.get('c_publicServantNumber') || undefined,
        enabled: true,
        status: 'active',
        position: '',
        department: '',
      };
    } else {
      user = users.get(f.get('user') ?? '');
      if (!user) return send(res, 400, '<h3>Không có người dùng này</h3>');
    }
    const code = randomBytes(24).toString('base64url');
    codes.set(code, {
      user,
      clientId: CLIENT_ID,
      redirectUri,
      codeChallenge: f.get('code_challenge'),
      exp: Date.now() + CODE_TTL_MS,
    });
    console.log(`[sso-mock] cấp code cho ${user.userName}`);
    return redirect(res, redirectUri, { code, state });
  }

  if (req.method === 'POST' && path === '/api/auth/tokens/authorization-code') {
    const m = /^Basic\s+(.+)$/i.exec(req.headers.authorization ?? '');
    const [id, secret] = m ? Buffer.from(m[1], 'base64').toString('utf8').split(':') : [];
    if (id !== CLIENT_ID || secret !== CLIENT_SECRET)
      return fail(res, 401, 'invalid_client', 'Sai client_id/client_secret');
    if (!(req.headers['content-type'] ?? '').includes('application/json'))
      return fail(res, 415, 'invalid_request', 'Content-Type phải là application/json');
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      return fail(res, 400, 'invalid_request', 'Body không phải JSON');
    }
    const entry = codes.get(body.authCode);
    codes.delete(body.authCode); // code dùng 1 lần
    if (!entry || entry.exp < Date.now()) return fail(res, 400, 'invalid_grant', 'authCode không hợp lệ hoặc đã hết hạn');
    if (body.clientUrl !== entry.redirectUri)
      return fail(res, 400, 'invalid_grant', 'clientUrl không khớp redirect_uri');
    // Tài liệu PSC không nêu code_verifier; nếu client gửi thì kiểm tra.
    const verifier = body.codeVerifier ?? body.code_verifier;
    if (verifier) {
      const ch = createHash('sha256').update(verifier).digest('base64url');
      if (ch !== entry.codeChallenge) return fail(res, 400, 'invalid_grant', 'code_verifier sai');
    }
    const accessToken = randomBytes(32).toString('base64url');
    tokens.set(accessToken, { user: entry.user, exp: Date.now() + TOKEN_TTL_S * 1000 });
    console.log(`[sso-mock] đổi code thành công cho ${entry.user.userName}`);
    return send(res, 200, {
      accessToken,
      expiresIn: TOKEN_TTL_S,
      tokenType: 'Bearer',
      idToken: `mock.${Buffer.from(JSON.stringify({ sub: entry.user.userName })).toString('base64url')}.sig`,
      ...(body.allowOfflineAccess
        ? { refreshToken: randomBytes(32).toString('base64url'), refreshExpiresIn: 86400 }
        : {}),
    });
  }

  if (req.method === 'POST' && path === '/api/accounts/profile') {
    const u = bearer(req);
    if (!u) return fail(res, 401, 'invalid_token', 'Access token không hợp lệ');
    return send(res, 200, {
      id: createHash('md5').update(u.userName).digest('hex'),
      userName: u.userName,
      firstName: u.firstName,
      lastName: u.lastName,
      email: u.email,
      emailVerified: u.emailVerified,
      enabled: u.enabled,
      profileMetadataGroup: { note: 'mock' },
    });
  }

  if (req.method === 'GET' && path === '/api/auth/tokens/assignments') {
    const u = bearer(req);
    if (!u) return fail(res, 401, 'invalid_token', 'Access token không hợp lệ');
    return send(res, 200, {
      userName: u.userName,
      ...(u.studentId ? { studentId: u.studentId } : {}),
      ...(u.publicServantNumber ? { publicServantNumber: u.publicServantNumber } : {}),
      status: u.status,
      assignments: [
        {
          assignment: u.studentId ? 'SV' : 'CB',
          unit: 'Trường Đại học Kinh tế - Luật',
          lastDepartment: u.department,
          position: u.position,
        },
      ],
    });
  }

  // Định dạng theo mẫu UEL gửi: { active, sub, username, preferredUsername, sid, scope, clientId, emailVerified, isPsc }
  if (req.method === 'POST' && path === '/api/auth/tokens/verify') {
    const u = bearer(req);
    if (!u) return send(res, 200, { active: false });
    return send(res, 200, {
      active: true,
      sub: createHash('md5').update(u.userName).digest('hex'),
      username: u.userName,
      preferredUsername: u.userName,
      sid: randomBytes(8).toString('hex'),
      scope: 'openid profile email',
      clientId: CLIENT_ID,
      emailVerified: u.emailVerified,
      isPsc: false,
    });
  }

  if (req.method === 'POST' && path === '/api/auth/sessions/logout') {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
    if (m) tokens.delete(m[1]);
    return send(res, 200, { success: true });
  }

  return fail(res, 404, 'not_found', `${req.method} ${path}`);
}

http
  .createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('[sso-mock]', e);
      if (!res.headersSent) fail(res, 500, 'server_error', e.message);
    });
  })
  .listen(PORT, () => {
    console.log(`[sso-mock] PSC SSO giả lập: ${BASE}`);
    console.log(`[sso-mock] client_id=${CLIENT_ID} client_secret=${CLIENT_SECRET}`);
    console.log(`[sso-mock] redirect_uri đăng ký: ${REDIRECT_URIS.join(', ')}`);
    console.log(`[sso-mock] ${users.size} người dùng giả lập`);
  });
