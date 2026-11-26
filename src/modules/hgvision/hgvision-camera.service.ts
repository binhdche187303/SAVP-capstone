import type { CreateHgCameraDto } from './dto/create-hg-camera.dto.js';
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
  MediaSource,
} from './hgvision.client.js';
import { HGVISION_CLIENT } from './hgvision.constants.js';

/** Prefix toàn cục của BE (main.ts) — playlist HLS trả về dùng path tuyệt đối trên BE. */
const API_PREFIX = '/api/v1';
const LIST_TTL_MS = 5_000;
const STATIC_TTL_MS = 60_000;
/** Khoảng tìm xem lại tối đa (giống nút "1 ngày" trên HGVision). */
export const PLAYBACK_MAX_WINDOW_MS = 24 * 3600_000;
/** Tải MP4 tối đa 1 giờ: HGVision ghép file khi tải, khoảng dài rất nặng. */
export const PLAYBACK_MAX_DOWNLOAD_MS = 3600_000;
const PLAYBACK_DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

interface HgSegment {
  start_ms: number;
  end_ms: number;
  thumb_url?: string;
  file_url?: string;
}

export interface PlaybackRecordings {
  camera: string;
  fromMs: number;
  toMs: number;
  /** Các khoảng liên tục có ghi hình (đã cắt theo khoảng tìm). */
  ranges: { startMs: number; endMs: number }[];
  /** Từng đoạn ghi; thumbUrl là path trên BE (đã gồm /api/v1), cần Bearer token. */
  segments: { startMs: number; endMs: number; thumbUrl: string | null }[];
}

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
  /** Toạ độ camera trên HGVision (nút Bản đồ); null nếu chưa khai. */
  latitude: number | null;
  longitude: number | null;
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

  /** Thêm camera RTSP sang HGVision (thay vì thêm tay trên web HGVision). */
  async createCamera(dto: CreateHgCameraDto): Promise<{ name: string }> {
    const name = dto.name.trim();
    await this.call(() =>
      this.client.createCamera({
        camera_name: name,
        camera_url: dto.mainUrl.trim(),
        protocol_type: 'RTSP',
        ...(dto.subUrl?.trim() ? { sub_url: dto.subUrl.trim() } : {}),
        ...(dto.group?.trim() ? { camera_group: dto.group.trim() } : {}),
        ...(dto.latitude != null && dto.longitude != null
          ? { latitude: dto.latitude, longitude: dto.longitude }
          : {}),
        using_ai: dto.usingAi ?? true,
        using_face_recognition:
          (dto.usingAi ?? true) && (dto.usingFace ?? true),
        using_lp_recognition:
          (dto.usingAi ?? true) && (dto.usingPlate ?? false),
        using_record: dto.usingRecord ?? true,
        is_showing: dto.isShowing ?? true,
        auto_scan_sub_url: true,
      }),
    );
    this.cache.delete('cameras');
    this.cache.delete('health');
    this.cache.delete('groups');
    return { name };
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

  /** Path playlist live trên HGVision (tương đối HGVISION_BASE_URL) + trạng thái camera. */
  async liveSource(name: string): Promise<{
    upstream: string;
    source: MediaSource;
    online: boolean;
    zone: CameraZone | null;
  }> {
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
    const zones = await this.zoneMap();
    return {
      upstream,
      source,
      online: String(cam.status ?? '').toLowerCase() === 'online',
      zone: zones.get(normName(name)) ?? null,
    };
  }

  /** Playlist live của 1 camera, đã viết lại mọi URI để đi qua proxy BE. */
  async livePlaylist(name: string): Promise<string> {
    const { upstream, source } = await this.liveSource(name);
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

  // ───────────── Xem lại (playback) ─────────────

  /**
   * Các khoảng có ghi hình + danh sách đoạn ghi (kèm thumbnail qua proxy BE) của 1 camera.
   * HGVision trả 404 khi không có bản ghi ⇒ coi là rỗng. Danh sách đoạn lỗi (vd 503
   * playback DB chưa sẵn sàng) không làm hỏng danh sách khoảng.
   */
  async playbackRecordings(
    camera: string,
    fromMs: number,
    toMs: number,
  ): Promise<PlaybackRecordings> {
    assertPlaybackWindow(fromMs, toMs, PLAYBACK_MAX_WINDOW_MS);
    await this.assertCameraExists(camera);
    const q = playbackQuery(camera, fromMs, toMs);
    const json = async <T>(path: string): Promise<T[]> => {
      try {
        const res = await this.call(() => this.client.fetchPublicMedia(path));
        const data = JSON.parse(res.body.toString('utf8')) as unknown;
        return Array.isArray(data) ? (data as T[]) : [];
      } catch (e) {
        if (e instanceof HttpException && e.getStatus() === 404) return [];
        throw e;
      }
    };
    const [ranges, segments] = await Promise.all([
      json<{ start_ms: number; end_ms: number }>(
        `/api/playback/recordings?${q}`,
      ),
      json<HgSegment>(`/api/recording/segments?${q}`).catch(
        (e: unknown): HgSegment[] => {
          this.logger.warn(`Không lấy được recording/segments: ${String(e)}`);
          return [];
        },
      ),
    ]);
    const clip = (s: number, e: number) => ({
      startMs: Math.max(Number(s), fromMs),
      endMs: Math.min(Number(e), toMs),
    });
    return {
      camera,
      fromMs,
      toMs,
      ranges: ranges
        .filter((r) => Number.isFinite(r.start_ms) && Number.isFinite(r.end_ms))
        .map((r) => clip(r.start_ms, r.end_ms))
        .filter((r) => r.endMs > r.startMs)
        .sort((a, b) => a.startMs - b.startMs),
      segments: segments
        .filter((s) => Number.isFinite(s.start_ms) && Number.isFinite(s.end_ms))
        .map((s) => ({
          ...clip(s.start_ms, s.end_ms),
          thumbUrl: proxiedMediaUrl(s.thumb_url),
        }))
        .filter((s) => s.endMs > s.startMs)
        .sort((a, b) => a.startMs - b.startMs),
    };
  }

  /** Playlist HLS xem lại trong khoảng thời gian, URI đã viết lại qua proxy BE. */
  async playbackPlaylist(
    camera: string,
    fromMs: number,
    toMs: number,
  ): Promise<string> {
    assertPlaybackWindow(fromMs, toMs, PLAYBACK_MAX_WINDOW_MS);
    await this.assertCameraExists(camera);
    const path = `/api/playback/playlist?${playbackQuery(camera, fromMs, toMs)}`;
    const res = await this.call(() => this.client.fetchPublicMedia(path));
    const body = res.body.toString('utf8');
    assertHlsPlaylist(body);
    return rewritePlaylist(body, path);
  }

  /** Luồng MP4 để tải đoạn xem lại (tối đa PLAYBACK_MAX_DOWNLOAD_MS). */
  async playbackDownload(camera: string, fromMs: number, toMs: number) {
    assertPlaybackWindow(fromMs, toMs, PLAYBACK_MAX_DOWNLOAD_MS);
    await this.assertCameraExists(camera);
    const path = `/api/playback/download?${playbackQuery(camera, fromMs, toMs)}`;
    const res = await this.call(() =>
      this.client.streamPublicMedia(path, PLAYBACK_DOWNLOAD_TIMEOUT_MS),
    );
    return {
      body: res.body,
      contentLength: res.headers.get('content-length'),
      fileName: playbackFileName(camera, fromMs, toMs),
    };
  }

  private async assertCameraExists(name: string): Promise<void> {
    const cams = await this.cached('cameras', LIST_TTL_MS, () =>
      this.client.listCameras(),
    );
    if (!cams.some((c) => c.camera_name === name)) {
      throw new NotFoundException('Camera không tồn tại trên HGVision');
    }
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
    latitude: toCoord(c.latitude),
    longitude: toCoord(c.longitude),
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

/** from < to, cả hai hợp lệ, độ dài không vượt max. */
export function assertPlaybackWindow(
  fromMs: number,
  toMs: number,
  maxMs: number,
): void {
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs <= 0) {
    throw new BadRequestException('Thời gian bắt đầu/kết thúc không hợp lệ');
  }
  if (toMs <= fromMs) {
    throw new BadRequestException(
      'Thời gian kết thúc phải sau thời gian bắt đầu',
    );
  }
  if (toMs - fromMs > maxMs) {
    throw new BadRequestException(
      `Khoảng thời gian tối đa ${Math.round(maxMs / 60_000)} phút`,
    );
  }
}

function playbackQuery(camera: string, fromMs: number, toMs: number): string {
  return new URLSearchParams({
    camera_id: camera,
    start_time: String(Math.floor(fromMs)),
    end_time: String(Math.floor(toMs)),
  }).toString();
}

/**
 * thumb_url/file_url của HGVision là URL tuyệt đối theo Host BE đã gọi ⇒ chỉ giữ path,
 * đưa qua proxy /hgvision/stream (chỉ nhận /api/recording/... và /api/playback/...).
 */
export function proxiedMediaUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw, 'http://hg.local');
    const path = u.pathname + u.search;
    assertMediaPath(path);
    return `${API_PREFIX}/hgvision/stream?path=${encodeURIComponent(path)}`;
  } catch {
    return null;
  }
}

/** Tên file tải: <camera>_<yyyyMMdd-HHmm>_<HHmm>.mp4 theo giờ Việt Nam, bỏ ký tự lạ. */
export function playbackFileName(
  camera: string,
  fromMs: number,
  toMs: number,
): string {
  const vn = (ms: number) =>
    new Date(ms + 7 * 3600_000).toISOString().replace(/[-:]/g, '');
  const safe =
    camera
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/gi, 'd')
      .replace(/[^A-Za-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'camera';
  const a = vn(fromMs);
  const b = vn(toMs);
  return `${safe}_${a.slice(0, 8)}-${a.slice(9, 13)}_${b.slice(9, 13)}.mp4`;
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
        'Client HGVision thiếu quyền (scope) hoặc đã hết số camera theo giấy phép.',
      ],
      409: [HttpStatus.CONFLICT, 'HGVISION_CONFLICT', e.message],
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

/** HGVision trả toạ độ dạng số (có thể chuỗi); 0/không hợp lệ → null. */
function toCoord(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) && n !== 0 ? n : null;
}
