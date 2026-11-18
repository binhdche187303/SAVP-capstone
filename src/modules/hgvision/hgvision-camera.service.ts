import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HgvisionCamera,
  HgvisionCameraHealth,
  HgvisionClient,
  HgvisionError,
  MediaSource,
} from './hgvision.client.js';
import { HGVISION_CLIENT } from './hgvision.constants.js';

/** Prefix toàn cục của BE (main.ts) — playlist HLS trả về dùng path tuyệt đối trên BE. */
const API_PREFIX = '/api/v1';
const LIST_TTL_MS = 5_000;
const STATIC_TTL_MS = 60_000;

export interface CameraOverviewItem {
  name: string;
  index: number | null;
  group: string | null;
  status: 'online' | 'offline';
  usingAi: boolean;
  usingFace: boolean;
  usingPlate: boolean;
  usingRecord: boolean;
  fps: number | null;
  health: {
    level: string | null;
    reasons: string[];
    fps: number | null;
    fpsExpected: number | null;
    bitrateKbps: number | null;
    latencyMs: number | null;
    disconnects24h: number | null;
    updatedAt: string | null;
  } | null;
  /** Path trên BE (đã gồm /api/v1) để FE phát HLS qua proxy; null nếu camera không có live. */
  liveUrl: string | null;
}

export interface HgvisionConnectionStatus {
  configured: boolean;
  reachable: boolean;
  baseUrl: string;
  scopes: string[];
  writeEnabled: boolean;
  error: string | null;
}

/**
 * HgvisionCameraService — lớp đọc camera HGVision cho FE (trang camera bảo vệ, trạng thái
 * camera). Cache ngắn để nhiều FE mở cùng lúc không dội HGVision. Tài khoản/RTSP camera đã
 * được client lọc bỏ (SEC-01). Lỗi HGVision được đổi sang HTTP rõ nghĩa: mất kết nối → 503.
 */
@Injectable()
export class HgvisionCameraService {
  private readonly logger = new Logger(HgvisionCameraService.name);
  private readonly cache = new Map<
    string,
    { at: number; value: Promise<unknown> }
  >();

  constructor(
    @Inject(HGVISION_CLIENT) private readonly client: HgvisionClient,
    private readonly config: ConfigService,
  ) {}

  private get configured(): boolean {
    return !!(
      this.config.get<string>('HGVISION_BASE_URL') &&
      this.config.get<string>('HGVISION_CLIENT_ID') &&
      this.config.get<string>('HGVISION_CLIENT_SECRET')
    );
  }

  async status(): Promise<HgvisionConnectionStatus> {
    const base: HgvisionConnectionStatus = {
      configured: this.configured,
      reachable: false,
      baseUrl: this.config.get<string>('HGVISION_BASE_URL', ''),
      scopes: [],
      writeEnabled: this.client.writeEnabled,
      error: null,
    };
    if (!base.configured) {
      return {
        ...base,
        error: 'Chưa cấu hình HGVISION_BASE_URL / CLIENT_ID / CLIENT_SECRET',
      };
    }
    try {
      await this.client.ping();
      return {
        ...base,
        reachable: true,
        scopes: [...this.client.grantedScopes],
      };
    } catch (e) {
      return { ...base, error: e instanceof Error ? e.message : 'unknown' };
    }
  }

  async listCameras(): Promise<CameraOverviewItem[]> {
    const [cams, health] = await Promise.all([
      this.cached('cameras', LIST_TTL_MS, () => this.client.listCameras()),
      // Thiếu quyền/endpoint health thì vẫn trả danh sách camera.
      this.cached('health', LIST_TTL_MS, () =>
        this.client.listCamerasHealth(),
      ).catch((e: unknown) => {
        this.logger.warn(`Không lấy được cameras/health: ${String(e)}`);
        return [] as HgvisionCameraHealth[];
      }),
    ]);
    const byName = new Map(health.map((h) => [h.camera_name, h]));
    return cams
      .map((c) => toOverview(c, byName.get(c.camera_name)))
      .sort((a, b) => (a.index ?? 1e9) - (b.index ?? 1e9));
  }

  cameraHealth(name: string) {
    return this.call(() => this.client.getCameraHealth(name));
  }

  cameraLogs(
    name: string,
    q: { limit?: number; beforeId?: number; level?: string },
  ) {
    return this.call(async () => {
      const res = await this.client.getCameraLogs(name, q);
      return {
        ...res,
        items: (res.items ?? []).map((i) => ({
          ...i,
          message: maskUrlCredentials(i.message),
          detail: maskUrlCredentials(i.detail),
        })),
      };
    });
  }

  groups() {
    return this.cached('groups', STATIC_TTL_MS, () => this.client.listGroups());
  }

  resources() {
    return this.cached('resources', LIST_TTL_MS, () =>
      this.client.getResources(),
    );
  }

  /** Playlist live của 1 camera, đã viết lại mọi URI để đi qua proxy BE. */
  async livePlaylist(name: string): Promise<string> {
    const cams = await this.cached('cameras', LIST_TTL_MS, () =>
      this.client.listCameras(),
    );
    const cam = cams.find((c) => c.camera_name === name);
    if (!cam) throw new NotFoundException('Camera không tồn tại trên HGVision');
    const { source, path: upstream } = resolveLiveSource(
      cam.live_hls_path,
      name,
      this.config.get<string>('HGVISION_BASE_URL', ''),
    );
    const res = await this.call(() =>
      this.client.fetchPublicMedia(upstream, undefined, source),
    );
    const body = res.body.toString('utf8');
    assertHlsPlaylist(body);
    return rewritePlaylist(body, upstream, source);
  }

  /** Proxy 1 file media (segment, playlist con). Chặn mọi path API ngoài playback. */
  async media(path: string, range?: string, source: MediaSource = 'api') {
    assertMediaPath(path);
    const res = await this.call(() =>
      this.client.fetchPublicMedia(path, range, source),
    );
    const type = res.headers.get('content-type') ?? 'application/octet-stream';
    if (/mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(path)) {
      const body = res.body.toString('utf8');
      assertHlsPlaylist(body);
      return {
        status: 200,
        contentType: 'application/vnd.apple.mpegurl',
        body: Buffer.from(rewritePlaylist(body, path, source)),
        headers: {} as Record<string, string>,
      };
    }
    const headers: Record<string, string> = {};
    for (const h of ['content-range', 'accept-ranges', 'cache-control']) {
      const v = res.headers.get(h);
      if (v) headers[h] = v;
    }
    return { status: res.status, contentType: type, body: res.body, headers };
  }

  private cached<T>(
    key: string,
    ttl: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value as Promise<T>;
    const value = this.call(load);
    this.cache.set(key, { at: Date.now(), value });
    // Lỗi không được nằm lại trong cache.
    value.catch(() => this.cache.delete(key));
    return value;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.configured) {
      throw new HttpException(
        {
          success: false,
          message: 'HGVision chưa được cấu hình trên máy chủ.',
          error: { code: 'HGVISION_NOT_CONFIGURED', details: {} },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    try {
      return await fn();
    } catch (e) {
      throw toHttp(e);
    }
  }
}

function toOverview(
  c: HgvisionCamera,
  h?: HgvisionCameraHealth,
): CameraOverviewItem {
  const online = String(c.status ?? '').toLowerCase() === 'online';
  return {
    name: c.camera_name,
    index: c.camera_index ?? null,
    group: c.camera_group || null,
    status: online ? 'online' : 'offline',
    usingAi: !!c.using_ai,
    usingFace: !!c.using_face_recognition,
    usingPlate: !!c.using_lp_recognition,
    usingRecord: !!c.using_record,
    fps: c.fps ?? null,
    health: h
      ? {
          level: h.level ?? null,
          reasons: h.reasons ?? [],
          fps: h.fps ?? null,
          fpsExpected: h.fps_expected ?? null,
          bitrateKbps: h.bitrate_kbps ?? null,
          latencyMs: h.latency_ms ?? null,
          disconnects24h: h.disconnects_24h ?? null,
          updatedAt: h.updated_ms ? new Date(h.updated_ms).toISOString() : null,
        }
      : null,
    liveUrl: `${API_PREFIX}/hgvision/live/${encodeURIComponent(c.camera_name)}/index.m3u8`,
  };
}

/** Che user:pass trong URL (rtsp://admin:123@ip → rtsp://***@ip) — nhật ký HGVision có thể chứa. */
export function maskUrlCredentials<T>(v: T): T {
  if (typeof v !== 'string') return v;
  return v.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@') as T;
}

/** live_hls_path có thể là path tương đối hoặc URL đầy đủ trỏ về chính HGVision. */
export function toUpstreamPath(raw: string, baseUrl: string): string {
  if (/^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    const b = baseUrl ? new URL(baseUrl) : null;
    if (b && u.host !== b.host) {
      throw new BadRequestException(
        'live_hls_path trỏ ra ngoài máy chủ HGVision',
      );
    }
    return u.pathname + u.search;
  }
  return raw.startsWith('/') ? raw : `/${raw}`;
}

export function assertMediaPath(path: string): void {
  const ok =
    path.startsWith('/') &&
    !path.startsWith('//') &&
    !path.includes('..') &&
    (!path.startsWith('/api/') ||
      path.startsWith('/api/playback/') ||
      path.startsWith('/api/recording/'));
  if (!ok) throw new BadRequestException('Đường dẫn media không hợp lệ');
}

/**
 * Xác định luồng live của camera. HGVision (OpenAPI) trả `live_hls_path` là TÊN path trên
 * MediaMTX (vd `afcd30ac-…` hoặc `…_sub`), không phải URL ⇒ phát qua HGVISION_HLS_BASE_URL
 * tại `/<tên>/index.m3u8`. Giá trị có dấu `/` hoặc URL đầy đủ thì coi là path trên :8113.
 */
export function resolveLiveSource(
  livePath: string | undefined,
  cameraName: string,
  baseUrl: string,
): { source: MediaSource; path: string } {
  const v = (livePath ?? '').trim();
  if (v && !v.includes('/')) {
    return { source: 'hls', path: `/${encodeURIComponent(v)}/index.m3u8` };
  }
  return {
    source: 'api',
    path: toUpstreamPath(
      v || `/live/${encodeURIComponent(cameraName)}/index.m3u8`,
      baseUrl,
    ),
  };
}

/** Nội dung phải là playlist HLS; HGVision trả trang HTML/đăng nhập khi sai path ⇒ báo 502 rõ ràng. */
export function assertHlsPlaylist(body: string): void {
  // trimStart() bỏ cả BOM U+FEFF.
  if (!body.trimStart().startsWith('#EXTM3U')) {
    throw new HttpException(
      {
        success: false,
        message: 'HGVision không trả luồng video (nội dung không phải HLS).',
        error: { code: 'HGVISION_LIVE_NOT_HLS', details: {} },
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}

/** Viết lại URI trong playlist HLS (dòng segment + URI="…") sang proxy BE /hgvision/stream. */
export function rewritePlaylist(
  body: string,
  playlistPath: string,
  source: MediaSource = 'api',
): string {
  const base = new URL(playlistPath, 'http://hg.local');
  const src = source === 'hls' ? '&src=hls' : '';
  const proxied = (uri: string) => {
    const u = new URL(uri, base);
    if (u.host !== 'hg.local') return uri; // URL ngoài: giữ nguyên, không proxy
    return `${API_PREFIX}/hgvision/stream?path=${encodeURIComponent(u.pathname + u.search)}${src}`;
  };
  return body
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#')) {
        return line.replace(
          /URI="([^"]+)"/g,
          (_m, uri: string) => `URI="${proxied(uri)}"`,
        );
      }
      return proxied(t);
    })
    .join('\n');
}

function toHttp(e: unknown): HttpException {
  if (e instanceof HttpException) return e;
  if (e instanceof HgvisionError) {
    const map: Record<number, [HttpStatus, string, string]> = {
      0: [
        HttpStatus.SERVICE_UNAVAILABLE,
        'HGVISION_UNAVAILABLE',
        'Không kết nối được HGVision.',
      ],
      400: [HttpStatus.BAD_REQUEST, 'HGVISION_BAD_REQUEST', e.message],
      401: [
        HttpStatus.BAD_GATEWAY,
        'HGVISION_AUTH_FAILED',
        'HGVision từ chối client id/secret.',
      ],
      403: [
        HttpStatus.BAD_GATEWAY,
        'HGVISION_SCOPE_MISSING',
        'Client HGVision thiếu quyền (scope).',
      ],
      404: [
        HttpStatus.NOT_FOUND,
        'HGVISION_NOT_FOUND',
        'Không tìm thấy trên HGVision.',
      ],
    };
    const [status, code, message] =
      e.code === 'WRITE_DISABLED'
        ? [HttpStatus.FORBIDDEN, 'HGVISION_WRITE_DISABLED', e.message]
        : (map[e.status] ?? [
            HttpStatus.BAD_GATEWAY,
            'HGVISION_ERROR',
            e.message,
          ]);
    return new HttpException(
      {
        success: false,
        message,
        error: { code, details: { upstreamStatus: e.status } },
      },
      status,
    );
  }
  return new HttpException(
    {
      success: false,
      message: 'Lỗi khi gọi HGVision.',
      error: { code: 'HGVISION_ERROR', details: {} },
    },
    HttpStatus.BAD_GATEWAY,
  );
}
