/**
 * HgvisionClient — gọi API tích hợp HGVision (docs/hgvision/openapi-1.0.0.json).
 *
 * Xác thực OAuth client credentials (POST /api/oauth/token), tự lấy token mới khi
 * sắp hết hạn và thử lại MỘT lần khi gặp 401. HGVision KHÔNG có webhook ⇒ sự kiện
 * lấy bằng cách poll GET /api/history (xem HgvisionPollerService).
 * SEC-01: KHÔNG log client_secret / access token.
 */

export interface HgvisionClientDeps {
  baseUrl: string; // vd http://192.168.1.10:8113
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
  /** HGVISION_WRITE_ENABLED — tắt mặc định để máy trường không bị ghi nhầm khi mới pull code. */
  writeEnabled?: boolean;
}

/** HistoryObject (OpenAPI) — chỉ các field SAVP dùng. Thời gian = epoch GIÂY. */
export interface HgvisionHistoryObject {
  object_id: string;
  camera_id: string; // tên camera
  object_type?: string;
  face_ident_text?: string;
  face_image_path?: string;
  lp_text?: string;
  lp_image_path?: string;
  object_image_path?: string;
  first_timestamp?: number;
  last_timestamp?: number;
  confidence?: number;
}

export interface HgvisionHistoryPage {
  total: number;
  page: number;
  page_size: number;
  data: HgvisionHistoryObject[];
}

export interface HgvisionHistoryQuery {
  startTime: number; // epoch giây
  endTime: number; // epoch giây
  hasFace?: boolean;
  page?: number;
  pageSize?: number;
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Field nhạy cảm của CameraObject (tài khoản camera, URL RTSP) — luôn bỏ trước khi trả ra ngoài BE. */
export const CAMERA_SECRET_FIELDS = [
  'username',
  'password',
  'camera_url',
  'url_playback',
  'main_url',
  'sub_url',
] as const;

/** CameraObject (GET /api/cameras). `camera_name` là khoá chính, chính là `camera_id` ở history. */
export interface HgvisionCamera {
  camera_name: string;
  camera_id?: string;
  camera_index?: number;
  camera_group?: string;
  status?: string; // Online | Offline
  live_hls_path?: string;
  using_ai?: boolean;
  using_face_recognition?: boolean;
  using_lp_recognition?: boolean;
  using_record?: boolean;
  fps?: number;
  ip_address?: string;
  avatar_path?: string;
  [k: string]: unknown;
}

export interface HgvisionCameraHealth {
  camera_name: string;
  camera_index?: number;
  level?: string; // good | warning | bad | offline
  reasons?: string[];
  notes?: string[];
  fps?: number;
  fps_expected?: number;
  bitrate_kbps?: number;
  latency_ms?: number | null;
  reachable?: boolean;
  stream_ready?: boolean;
  disconnects_24h?: number;
  updated_ms?: number;
  [k: string]: unknown;
}

export interface HgvisionCameraLog {
  id: number;
  level?: string;
  message?: string;
  [k: string]: unknown;
}

export interface HgvisionGroup {
  GROUP_NAME: string;
  DESCRIPTION?: string;
  LATITUDE?: number;
  LONGITUDE?: number;
  camera_count?: number;
}

export interface HgvisionCountingLine {
  line_id: string;
  line_name?: string;
  camera_name: string;
  in_count?: number;
  out_count?: number;
  object_types?: string[];
  [k: string]: unknown;
}

export interface HgvisionCounts {
  in_count: number;
  out_count: number;
  [k: string]: unknown;
}

export interface HgvisionTimeseriesPoint {
  bucket_start: number;
  in_count: number;
  out_count: number;
}

export interface HgvisionResources {
  cpu?: { percent: number };
  memory?: { percent: number; used?: number; total?: number };
  disk?: { percent: number; used?: number; total?: number };
  gpu?: { memory_percent?: number; utilization?: number; [k: string]: unknown };
}

export interface HgvisionPage<T> {
  total: number;
  page: number;
  page_size: number;
  data: T[];
}

export interface HgvisionListQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  isBlacklist?: boolean;
}

export interface HgvisionFace {
  face_ident: string;
  face_infor?: string;
  is_blacklist?: number | boolean;
  visible_to?: string;
  [k: string]: unknown;
}

export interface HgvisionPlate {
  license_plate: string;
  ident?: string;
  lp_infor?: string;
  is_blacklist?: number | boolean;
  visible_to?: string;
  [k: string]: unknown;
}

export interface HgvisionFaceUpload {
  data: Buffer;
  filename?: string;
  contentType?: string; // image/jpeg | image/png
}

export interface HgvisionRegisterFaceInput {
  faceIdent: string; // = mã người dùng SAVP
  faceInfor?: string; // họ tên
  images: HgvisionFaceUpload[];
  isBlacklist?: boolean;
  visibleTo?: string;
  skipQualityCheck?: boolean;
}

export interface HgvisionRegisterResult {
  message?: string;
  registered: number;
  failed: number;
}

export interface HgvisionPlateInput {
  licensePlate: string;
  ident: string;
  lpInfor?: string;
  visibleTo?: string;
  isBlacklist?: boolean;
}

/** Bỏ tài khoản/URL RTSP camera — KHÔNG được để lọt xuống FE (SEC-01). */
export function stripCameraSecrets<T extends object>(cam: T): T {
  const out: Record<string, unknown> = { ...(cam as Record<string, unknown>) };
  for (const k of CAMERA_SECRET_FIELDS) delete out[k];
  return out as T;
}

const seg = (v: string) => encodeURIComponent(v);

function listParams(q: HgvisionListQuery): string {
  const p = new URLSearchParams({
    page: String(q.page ?? 1),
    page_size: String(q.pageSize ?? 50),
  });
  if (q.search) p.set('search', q.search);
  if (q.isBlacklist !== undefined)
    p.set('is_blacklist', q.isBlacklist ? '1' : '0');
  return p.toString();
}

export class HgvisionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HgvisionError';
  }
}

/** Làm mới token sớm hơn hạn thật để tránh dùng token vừa hết hạn giữa chừng. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export class HgvisionClient {
  private token: string | null = null;
  private tokenExpiresAt = 0;
  private scopes: string[] = [];

  constructor(private readonly deps: HgvisionClientDeps) {}

  get grantedScopes(): readonly string[] {
    return this.scopes;
  }

  searchHistory(q: HgvisionHistoryQuery): Promise<HgvisionHistoryPage> {
    const params = new URLSearchParams({
      start_time: String(q.startTime),
      end_time: String(q.endTime),
      page: String(q.page ?? 1),
      page_size: String(q.pageSize ?? 100),
    });
    if (q.hasFace !== undefined) params.set('has_face', String(q.hasFace));
    return this.get<HgvisionHistoryPage>(`/api/history?${params.toString()}`);
  }

  /**
   * Tải ảnh `*_image_path` qua GET /api/media/images/{image_path} → base64 (không kèm
   * tiền tố data URL). Giữ nguyên dấu `/` trong path, chỉ encode từng đoạn.
   */
  async fetchImageBase64(imagePath: string): Promise<string> {
    const encoded = imagePath
      .replace(/^\/+/, '')
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    const res = await this.authedGet(`/api/media/images/${encoded}`, 'image/*');
    if (!res.ok) throw await this.toError(res);
    return Buffer.from(await res.arrayBuffer()).toString('base64');
  }

  /**
   * Tải file live/playback công khai của HGVision (HLS playlist, segment .ts) để BE proxy
   * xuống FE. Chỉ nhận path tương đối trên chính HGVISION_BASE_URL, KHÔNG nhận URL ngoài.
   */
  async fetchPublicMedia(
    path: string,
    range?: string,
  ): Promise<{ status: number; headers: Headers; body: Buffer }> {
    if (!path.startsWith('/') || path.startsWith('//')) {
      throw new HgvisionError('Đường dẫn media không hợp lệ.', 400);
    }
    const res = await this.fetchWithTimeout(path, {
      method: 'GET',
      headers: range ? { Range: range } : {},
    });
    if (!res.ok) throw await this.toError(res);
    return {
      status: res.status,
      headers: res.headers,
      body: Buffer.from(await res.arrayBuffer()),
    };
  }

  /** Thử lấy token: dùng cho trang kiểm tra kết nối. */
  async ping(): Promise<void> {
    await this.accessToken();
  }

  // ───────────── Camera (cameras:read) ─────────────

  /** Danh sách camera, ĐÃ bỏ tài khoản/URL RTSP. */
  async listCameras(): Promise<HgvisionCamera[]> {
    const cams = await this.get<HgvisionCamera[]>('/api/cameras');
    return (cams ?? []).map((c) => stripCameraSecrets(c));
  }

  async getCamera(name: string): Promise<HgvisionCamera> {
    return stripCameraSecrets(
      await this.get<HgvisionCamera>(`/api/cameras/${seg(name)}`),
    );
  }

  async listCameraStatuses(): Promise<HgvisionCamera[]> {
    const cams = await this.get<HgvisionCamera[]>('/api/cameras/statuses');
    return (cams ?? []).map((c) => stripCameraSecrets(c));
  }

  async listCamerasHealth(): Promise<HgvisionCameraHealth[]> {
    const res = await this.get<{ items?: HgvisionCameraHealth[] }>(
      '/api/cameras/health',
    );
    return res?.items ?? [];
  }

  getCameraHealth(name: string): Promise<HgvisionCameraHealth> {
    return this.get<HgvisionCameraHealth>(`/api/cameras/${seg(name)}/health`);
  }

  getCameraLogs(
    name: string,
    q: { limit?: number; beforeId?: number; level?: string } = {},
  ): Promise<{ items: HgvisionCameraLog[]; has_more: boolean }> {
    const p = new URLSearchParams({ limit: String(q.limit ?? 50) });
    if (q.beforeId) p.set('before_id', String(q.beforeId));
    if (q.level) p.set('level', q.level);
    return this.get(`/api/cameras/${seg(name)}/logs?${p.toString()}`);
  }

  listGroups(): Promise<HgvisionGroup[]> {
    return this.get<HgvisionGroup[]>('/api/groups');
  }

  // ───────────── Vạch đếm (counting:read) ─────────────

  listCountingLines(cameraName?: string): Promise<HgvisionCountingLine[]> {
    const q = cameraName ? `?camera_name=${seg(cameraName)}` : '';
    return this.get<HgvisionCountingLine[]>(`/api/counting-lines${q}`);
  }

  getCountingCounts(
    lineId: string,
    from: number,
    to: number,
  ): Promise<HgvisionCounts> {
    return this.get(
      `/api/counting-lines/${seg(lineId)}/counts?from=${from}&to=${to}`,
    );
  }

  getCountingTimeseries(
    lineId: string,
    from: number,
    to: number,
    bucketSec = 3600,
  ): Promise<HgvisionTimeseriesPoint[]> {
    return this.get(
      `/api/counting-lines/${seg(lineId)}/timeseries?from=${from}&to=${to}&bucket=${bucketSec}`,
    );
  }

  // ───────────── Dashboard (dashboard:read) ─────────────

  getResources(): Promise<HgvisionResources> {
    return this.get<HgvisionResources>('/api/dashboard/resources');
  }

  getDashboardStats(): Promise<Record<string, unknown>> {
    return this.get('/api/dashboard/stats');
  }

  // ───────────── Playback (public, không cần token) ─────────────

  getRecordings(
    cameraName: string,
    startTime: number,
    endTime: number,
  ): Promise<unknown> {
    return this.get(
      `/api/playback/recordings?camera_id=${seg(cameraName)}&start_time=${startTime}&end_time=${endTime}`,
      false,
    );
  }

  // ───────────── Định danh: đọc (faces:read / plates:read) ─────────────

  listFaces(q: HgvisionListQuery = {}): Promise<HgvisionPage<HgvisionFace>> {
    return this.get(`/api/identification/faces?${listParams(q)}`);
  }

  /** null nếu HGVision chưa có định danh này (404). */
  async findFace(faceIdent: string): Promise<HgvisionFace | null> {
    try {
      return await this.get<HgvisionFace>(
        `/api/identification/faces/${seg(faceIdent)}`,
      );
    } catch (e) {
      if (e instanceof HgvisionError && e.status === 404) return null;
      throw e;
    }
  }

  listPlates(q: HgvisionListQuery = {}): Promise<HgvisionPage<HgvisionPlate>> {
    return this.get(`/api/identification/license-plates?${listParams(q)}`);
  }

  // ───────────── Định danh: ghi — cần HGVISION_WRITE_ENABLED=true ─────────────

  get writeEnabled(): boolean {
    return !!this.deps.writeEnabled;
  }

  async registerFace(
    input: HgvisionRegisterFaceInput,
  ): Promise<HgvisionRegisterResult> {
    this.requireWrite();
    const form = new FormData();
    form.set('face_ident', input.faceIdent);
    if (input.faceInfor) form.set('face_infor', input.faceInfor);
    form.set('is_blacklist', input.isBlacklist ? 'true' : 'false');
    form.set('visible_to', input.visibleTo ?? 'admin_only');
    if (input.skipQualityCheck) form.set('skip_quality_check', 'true');
    this.appendImages(form, input.images);
    return this.request('POST', '/api/identification/faces', { form });
  }

  async addFaceImages(
    faceIdent: string,
    images: HgvisionFaceUpload[],
  ): Promise<HgvisionRegisterResult> {
    this.requireWrite();
    const form = new FormData();
    this.appendImages(form, images);
    return this.request(
      'POST',
      `/api/identification/faces/${seg(faceIdent)}/images`,
      { form },
    );
  }

  async updateFace(
    faceIdent: string,
    patch: { newName?: string; faceInfor?: string; isBlacklist?: boolean },
  ): Promise<HgvisionFace> {
    this.requireWrite();
    const body: Record<string, unknown> = {};
    if (patch.newName !== undefined) body.new_name = patch.newName;
    if (patch.faceInfor !== undefined) body.FACE_INFOR = patch.faceInfor;
    if (patch.isBlacklist !== undefined) body.is_blacklist = patch.isBlacklist;
    return this.request('PUT', `/api/identification/faces/${seg(faceIdent)}`, {
      json: body,
    });
  }

  async setFaceBlacklist(
    faceIdent: string,
    isBlacklist: boolean,
  ): Promise<HgvisionFace> {
    this.requireWrite();
    return this.request(
      'PATCH',
      `/api/identification/faces/${seg(faceIdent)}`,
      { json: { is_blacklist: isBlacklist } },
    );
  }

  async deleteFace(faceIdent: string): Promise<void> {
    this.requireWrite();
    await this.request('DELETE', `/api/identification/faces/${seg(faceIdent)}`);
  }

  async createPlate(input: HgvisionPlateInput): Promise<HgvisionPlate> {
    this.requireWrite();
    return this.request('POST', '/api/identification/license-plates', {
      json: {
        license_plate: input.licensePlate,
        ident: input.ident,
        lp_infor: input.lpInfor ?? '',
        visible_to: input.visibleTo ?? 'all',
        is_blacklist: !!input.isBlacklist,
      },
    });
  }

  async updatePlate(
    licensePlate: string,
    patch: Partial<Omit<HgvisionPlateInput, 'licensePlate'>>,
  ): Promise<HgvisionPlate> {
    this.requireWrite();
    const body: Record<string, unknown> = {};
    if (patch.ident !== undefined) body.ident = patch.ident;
    if (patch.lpInfor !== undefined) body.lp_infor = patch.lpInfor;
    if (patch.visibleTo !== undefined) body.visible_to = patch.visibleTo;
    if (patch.isBlacklist !== undefined) body.is_blacklist = patch.isBlacklist;
    return this.request(
      'PUT',
      `/api/identification/license-plates/${seg(licensePlate)}`,
      { json: body },
    );
  }

  async setPlateBlacklist(
    licensePlate: string,
    isBlacklist: boolean,
  ): Promise<HgvisionPlate> {
    this.requireWrite();
    return this.request(
      'PATCH',
      `/api/identification/license-plates/${seg(licensePlate)}`,
      { json: { is_blacklist: isBlacklist } },
    );
  }

  async deletePlate(licensePlate: string): Promise<void> {
    this.requireWrite();
    await this.request(
      'DELETE',
      `/api/identification/license-plates/${seg(licensePlate)}`,
    );
  }

  private appendImages(form: FormData, images: HgvisionFaceUpload[]): void {
    images.forEach((img, i) => {
      const type = img.contentType ?? 'image/jpeg';
      const ext = type.includes('png') ? 'png' : 'jpg';
      form.append(
        'file',
        new Blob([new Uint8Array(img.data)], { type }),
        img.filename ?? `face-${i + 1}.${ext}`,
      );
    });
  }

  private get<T>(path: string, auth = true): Promise<T> {
    return this.request<T>('GET', path, { auth });
  }

  private requireWrite(): void {
    if (!this.deps.writeEnabled) {
      throw new HgvisionError(
        'Ghi sang HGVision đang tắt (HGVISION_WRITE_ENABLED=false).',
        0,
        'WRITE_DISABLED',
      );
    }
  }

  /** Gọi API có xác thực, body JSON hoặc multipart. 401 → token mới, thử lại 1 lần. */
  private async request<T>(
    method: HttpMethod,
    path: string,
    opts: { json?: unknown; form?: FormData; auth?: boolean } = {},
  ): Promise<T> {
    const res = await this.raw(method, path, 'application/json', opts);
    if (!res.ok) throw await this.toError(res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private authedGet(path: string, accept: string): Promise<Response> {
    return this.raw('GET', path, accept, {});
  }

  private async raw(
    method: HttpMethod,
    path: string,
    accept: string,
    opts: { json?: unknown; form?: FormData; auth?: boolean },
  ): Promise<Response> {
    const build = async (): Promise<RequestInit> => {
      const headers: Record<string, string> = { Accept: accept };
      if (opts.auth !== false) {
        headers.Authorization = `Bearer ${await this.accessToken()}`;
      }
      let body: BodyInit | undefined;
      if (opts.form) body = opts.form;
      else if (opts.json !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(opts.json);
      }
      return { method, headers, body };
    };
    let res = await this.fetchWithTimeout(path, await build());
    if (res.status === 401 && opts.auth !== false) {
      // Token bị thu hồi/hết hạn sớm → lấy token mới, thử lại đúng 1 lần.
      this.token = null;
      res = await this.fetchWithTimeout(path, await build());
    }
    return res;
  }

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) return this.token;

    const res = await this.fetchWithTimeout('/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.deps.clientId,
        client_secret: this.deps.clientSecret,
      }),
    });
    if (!res.ok) throw await this.toError(res);

    const body = (await res.json()) as {
      access_token: string;
      expires_in: number;
      scope?: string;
    };
    this.token = body.access_token;
    this.tokenExpiresAt =
      Date.now() + body.expires_in * 1000 - TOKEN_REFRESH_MARGIN_MS;
    this.scopes = (body.scope ?? '').split(' ').filter(Boolean);
    return this.token;
  }

  private async fetchWithTimeout(
    path: string,
    init: RequestInit,
  ): Promise<Response> {
    if (!this.deps.baseUrl) {
      throw new HgvisionError('HGVISION_BASE_URL chưa cấu hình.', 0);
    }
    try {
      return await fetch(new URL(path, this.deps.baseUrl), {
        ...init,
        signal: AbortSignal.timeout(this.deps.timeoutMs),
      });
    } catch (e) {
      throw new HgvisionError(
        `Không kết nối được HGVision: ${e instanceof Error ? e.message : 'unknown'}`,
        0,
      );
    }
  }

  /** Lỗi HGVision: {error} hoặc OAuth {error, error_description}. */
  private async toError(res: Response): Promise<HgvisionError> {
    let detail = '';
    try {
      const body = (await res.json()) as {
        error?: string;
        error_description?: string;
      };
      detail = body.error_description ?? body.error ?? '';
    } catch {
      // body không phải JSON — chỉ dùng status.
    }
    return new HgvisionError(
      `HGVision HTTP ${res.status}${detail ? `: ${detail}` : ''}`,
      res.status,
    );
  }
}
