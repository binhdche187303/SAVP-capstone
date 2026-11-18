import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  HgvisionCamera,
  HgvisionCameraHealth,
  HgvisionClient,
  HgvisionError,
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
  /** Khu vực SAVP của camera (gán ở thiết bị hoặc qua ánh xạ camera → kênh → khu vực); null nếu chưa gán. */
  zoneId: string | null;
  zoneName: string | null;
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
    @Optional() private readonly dataSource?: DataSource,
  ) {}

  private zoneCache: {
    at: number;
    value: Promise<Map<string, CameraZone>>;
  } | null = null;

  /**
   * Tên camera HGVision → khu vực SAVP. Ưu tiên khu vực gán trực tiếp cho thiết bị
   * (iot_devices.metadata_json.camera_name, source = hgvision), sau đó tới ánh xạ
   * hgvision.camera_channel_map → ivss.channel_presence_zone_map / ivss.channel_zone_map.
   * Lỗi DB không làm hỏng danh sách camera: trả map rỗng.
   */
  private zoneMap(): Promise<Map<string, CameraZone>> {
    if (this.zoneCache && Date.now() - this.zoneCache.at < STATIC_TTL_MS)
      return this.zoneCache.value;
    const value = this.loadZoneMap().catch((e: unknown) => {
      this.logger.warn(`Không đọc được khu vực camera: ${String(e)}`);
      this.zoneCache = null;
      return new Map<string, CameraZone>();
    });
    this.zoneCache = { at: Date.now(), value };
    return value;
  }

  private async loadZoneMap(): Promise<Map<string, CameraZone>> {
    const out = new Map<string, CameraZone>();
    if (!this.dataSource) return out;
    const q = this.dataSource.manager;
    const configs: { config_key: string; config_json: unknown }[] =
      await q.query(
        `SELECT config_key, config_json FROM system_configs
        WHERE is_active = true AND config_key IN
          ('hgvision.camera_channel_map', 'ivss.channel_presence_zone_map', 'ivss.channel_zone_map')`,
      );
    const cfg = (key: string) =>
      (configs.find((c) => c.config_key === key)?.config_json ?? {}) as Record<
        string,
        unknown
      >;
    const channelZone = {
      ...cfg('ivss.channel_zone_map'),
      ...cfg('ivss.channel_presence_zone_map'),
    };
    const byName = new Map<string, string>();
    for (const [name, channel] of Object.entries(
      cfg('hgvision.camera_channel_map'),
    )) {
      const zoneId = channelZone[String(channel)];
      if (typeof zoneId === 'string' && zoneId)
        byName.set(normName(name), zoneId);
    }
    const devices: { camera_name: string; zone_id: string }[] = await q.query(
      `SELECT metadata_json->>'camera_name' AS camera_name, zone_id::text AS zone_id
         FROM iot_devices
        WHERE zone_id IS NOT NULL AND metadata_json->>'source' = 'hgvision'
          AND COALESCE(metadata_json->>'camera_name', '') <> ''`,
    );
    for (const d of devices) byName.set(normName(d.camera_name), d.zone_id);
    if (byName.size === 0) return out;
    const zones: { id: string; zone_name: string }[] = await q.query(
      `SELECT id::text AS id, zone_name FROM zones WHERE deleted_at IS NULL AND id::text = ANY($1)`,
      [[...new Set(byName.values())]],
    );
    const zoneName = new Map(zones.map((z) => [z.id, z.zone_name]));
    for (const [name, id] of byName) {
      if (zoneName.has(id)) out.set(name, { id, name: zoneName.get(id)! });
    }
    return out;
  }

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
    const zones = await this.zoneMap();
    return cams
      .map((c) =>
        toOverview(
          c,
          byName.get(c.camera_name),
          zones.get(normName(c.camera_name)),
        ),
      )
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
  /** Path playlist live trên HGVision (tương đối HGVISION_BASE_URL) + trạng thái camera. */
  async liveSource(
    name: string,
  ): Promise<{ upstream: string; online: boolean; zone: CameraZone | null }> {
    const cams = await this.cached('cameras', LIST_TTL_MS, () =>
      this.client.listCameras(),
    );
    const cam = cams.find((c) => c.camera_name === name);
    if (!cam) throw new NotFoundException('Camera không tồn tại trên HGVision');
    const upstream = toUpstreamPath(
      cam.live_hls_path || `/live/${encodeURIComponent(name)}/index.m3u8`,
      this.config.get<string>('HGVISION_BASE_URL', ''),
    );
    const zones = await this.zoneMap();
    return {
      upstream,
      online: String(cam.status ?? '').toLowerCase() === 'online',
      zone: zones.get(normName(name)) ?? null,
    };
  }

  async livePlaylist(name: string): Promise<string> {
    const { upstream } = await this.liveSource(name);
    const res = await this.call(() => this.client.fetchPublicMedia(upstream));
    return rewritePlaylist(res.body.toString('utf8'), upstream);
  }

  /** Proxy 1 file media (segment .ts, playlist con). Chặn mọi path API ngoài playback. */
  async media(path: string, range?: string) {
    assertMediaPath(path);
    const res = await this.call(() =>
      this.client.fetchPublicMedia(path, range),
    );
    const type = res.headers.get('content-type') ?? 'application/octet-stream';
    if (/mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(path)) {
      return {
        status: 200,
        contentType: 'application/vnd.apple.mpegurl',
        body: Buffer.from(rewritePlaylist(res.body.toString('utf8'), path)),
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

export interface CameraZone {
  id: string;
  name: string;
}

/** So khớp tên camera không phân biệt hoa thường/khoảng trắng thừa. */
export const normName = (name: string) =>
  String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

function toOverview(
  c: HgvisionCamera,
  h?: HgvisionCameraHealth,
  zone?: CameraZone,
): CameraOverviewItem {
  const online = String(c.status ?? '').toLowerCase() === 'online';
  return {
    name: c.camera_name,
    index: c.camera_index ?? null,
    group: c.camera_group || null,
    zoneId: zone?.id ?? null,
    zoneName: zone?.name ?? null,
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

/** Viết lại URI trong playlist HLS (dòng segment + URI="…") sang proxy BE /hgvision/stream. */
export function rewritePlaylist(body: string, playlistPath: string): string {
  const base = new URL(playlistPath, 'http://hg.local');
  const proxied = (uri: string) => {
    const u = new URL(uri, base);
    if (u.host !== 'hg.local') return uri; // URL ngoài: giữ nguyên, không proxy
    return `${API_PREFIX}/hgvision/stream?path=${encodeURIComponent(u.pathname + u.search)}`;
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
