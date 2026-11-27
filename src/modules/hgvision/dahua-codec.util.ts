import { createHash, randomBytes } from 'crypto';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** GET có HTTP Digest auth (camera Dahua CGI). */
async function digestGet(
  url: string,
  user: string,
  pass: string,
  timeoutMs = 8000,
): Promise<{ status: number; body: string }> {
  const first = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (first.status !== 401) {
    return { status: first.status, body: await first.text() };
  }
  await first.text();
  const h = first.headers.get('www-authenticate') ?? '';
  const p = (k: string) => new RegExp(`${k}="?([^",]+)"?`, 'i').exec(h)?.[1];
  const realm = p('realm') ?? '';
  const nonce = p('nonce') ?? '';
  const qop = p('qop') ? 'auth' : undefined;
  const opaque = p('opaque');
  const u = new URL(url);
  const uri = u.pathname + u.search;
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');
  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`GET:${uri}`);
  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);
  const auth =
    `Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"` +
    (qop ? `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"` : '') +
    (opaque ? `, opaque="${opaque}"` : '');
  const res = await fetch(url, {
    headers: { Authorization: auth },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, body: await res.text() };
}

/**
 * Ép cả luồng chính + phụ của camera Dahua sang H.264 qua CGI (gửi riêng từng luồng —
 * gộp 1 request thì firmware chỉ nhận luồng chính). Tắt SmartEncode trước vì H.265+ khoá codec.
 */
export async function dahuaForceH264(
  ip: string,
  user: string,
  pass: string,
): Promise<{ ok: boolean; message?: string }> {
  const base = `http://${ip}/cgi-bin/configManager.cgi?action=setConfig&`;
  const steps: Array<[string, string, boolean]> = [
    ['SmartEncode', 'SmartEncode[0].Enable=false', false],
    ['luồng chính', 'Encode[0].MainFormat[0].Video.Compression=H.264', true],
    ['luồng phụ', 'Encode[0].ExtraFormat[0].Video.Compression=H.264', true],
  ];
  const failed: string[] = [];
  try {
    for (const [label, q, required] of steps) {
      const r = await digestGet(base + q, user, pass);
      if (required && (r.status !== 200 || !/OK/i.test(r.body))) {
        failed.push(r.status === 401 ? `${label} (sai mật khẩu)` : label);
      }
    }
  } catch (e) {
    return {
      ok: false,
      message: `Không gọi được CGI camera: ${(e as Error).message}`,
    };
  }
  return failed.length
    ? { ok: false, message: `Không đổi được H.264: ${failed.join(', ')}` }
    : { ok: true };
}
