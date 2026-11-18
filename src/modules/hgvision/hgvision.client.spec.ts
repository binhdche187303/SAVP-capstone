import {
  HgvisionClient,
  HgvisionError,
  stripCameraSecrets,
} from './hgvision.client';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const tokenRes = () =>
  json(200, {
    access_token: 'tok-1',
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'history:read faces:read',
  });

type FetchCall = [URL, RequestInit];

const page = { total: 0, page: 1, page_size: 100, data: [] };

describe('HgvisionClient', () => {
  let fetchMock: jest.Mock;
  let client: HgvisionClient;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    client = new HgvisionClient({
      baseUrl: 'http://hg.local:8113',
      clientId: 'cli_x',
      clientSecret: 'sk_x',
      timeoutMs: 1000,
    });
  });

  it('lấy token rồi gọi /api/history với Bearer + query đúng', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(json(200, page));

    await client.searchHistory({ startTime: 100, endTime: 200, hasFace: true });

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as FetchCall;
    expect(String(tokenUrl)).toBe('http://hg.local:8113/api/oauth/token');
    expect(JSON.parse(tokenInit.body as string)).toEqual({
      grant_type: 'client_credentials',
      client_id: 'cli_x',
      client_secret: 'sk_x',
    });

    const [url, init] = fetchMock.mock.calls[1] as FetchCall;
    expect(String(url)).toBe(
      'http://hg.local:8113/api/history?start_time=100&end_time=200&page=1&page_size=100&has_face=true',
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer tok-1',
    );
    expect(client.grantedScopes).toEqual(['history:read', 'faces:read']);
  });

  it('dùng lại token còn hạn', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(json(200, page))
      .mockResolvedValueOnce(json(200, page));

    await client.searchHistory({ startTime: 1, endTime: 2 });
    await client.searchHistory({ startTime: 1, endTime: 2 });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('401 → lấy token mới và thử lại 1 lần', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(json(401, { error: 'Token expired' }))
      .mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(json(200, page));

    await expect(
      client.searchHistory({ startTime: 1, endTime: 2 }),
    ).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('sai client → HgvisionError kèm error_description', async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, {
        error: 'invalid_client',
        error_description: 'Client authentication failed',
      }),
    );

    await expect(
      client.searchHistory({ startTime: 1, endTime: 2 }),
    ).rejects.toMatchObject({
      status: 401,
      message: 'HGVision HTTP 401: Client authentication failed',
    });
  });

  it('không kết nối được → HgvisionError status 0', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const err: unknown = await client
      .searchHistory({ startTime: 1, endTime: 2 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HgvisionError);
    expect((err as HgvisionError).status).toBe(0);
  });

  it('chưa cấu hình base URL → lỗi rõ ràng, không gọi mạng', async () => {
    const c = new HgvisionClient({
      baseUrl: '',
      clientId: '',
      clientSecret: '',
      timeoutMs: 1000,
    });
    await expect(c.searchHistory({ startTime: 1, endTime: 2 })).rejects.toThrow(
      'HGVISION_BASE_URL chưa cấu hình.',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('HgvisionClient — camera / định danh', () => {
  let fetchMock: jest.Mock;
  const mk = (writeEnabled = false) =>
    new HgvisionClient({
      baseUrl: 'http://hg.local:8113',
      clientId: 'cli_x',
      clientSecret: 'sk_x',
      timeoutMs: 1000,
      writeEnabled,
    });

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  it('stripCameraSecrets bỏ tài khoản + URL RTSP', () => {
    const out = stripCameraSecrets({
      camera_name: 'A',
      username: 'admin',
      password: 'p',
      camera_url: 'rtsp://admin:p@x',
      url_playback: 'rtsp://y',
      main_url: 'rtsp://m',
      sub_url: 'rtsp://s',
      fps: 25,
    });
    expect(out).toEqual({ camera_name: 'A', fps: 25 });
  });

  it('listCameras không trả password/RTSP', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(
        json(200, [{ camera_name: 'A', password: 'p', camera_url: 'rtsp://' }]),
      );
    const cams = await mk().listCameras();
    expect(JSON.stringify(cams)).not.toMatch(/password|rtsp/);
  });

  it.each([
    [
      'registerFace',
      (c: HgvisionClient) => c.registerFace({ faceIdent: 'U1', images: [] }),
    ],
    ['deleteFace', (c: HgvisionClient) => c.deleteFace('U1')],
    [
      'createPlate',
      (c: HgvisionClient) =>
        c.createPlate({ licensePlate: '51A', ident: 'U1' }),
    ],
    [
      'setPlateBlacklist',
      (c: HgvisionClient) => c.setPlateBlacklist('51A', true),
    ],
  ])('%s bị chặn khi HGVISION_WRITE_ENABLED=false', async (_n, call) => {
    await expect(call(mk(false))).rejects.toMatchObject({
      code: 'WRITE_DISABLED',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('registerFace gửi multipart field file + face_ident', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(json(200, { success: true }));
    await mk(true).registerFace({
      faceIdent: 'U1',
      images: [{ data: Buffer.from('jpg') }],
    });
    const [url, init] = fetchMock.mock.calls[1] as FetchCall;
    expect(String(url)).toBe('http://hg.local:8113/api/identification/faces');
    expect(init.method).toBe('POST');
    const form = init.body as FormData;
    expect(form.get('face_ident')).toBe('U1');
    expect(form.getAll('file')).toHaveLength(1);
  });

  it('setPlateBlacklist gửi PATCH JSON, biển số được encode', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(json(200, {}));
    await mk(true).setPlateBlacklist('51A 123', true);
    const [url, init] = fetchMock.mock.calls[1] as FetchCall;
    expect(String(url)).toBe(
      'http://hg.local:8113/api/identification/license-plates/51A%20123',
    );
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ is_blacklist: true });
  });

  it('findFace 404 → null', async () => {
    fetchMock
      .mockResolvedValueOnce(tokenRes())
      .mockResolvedValueOnce(json(404, { error: 'not found' }));
    await expect(mk().findFace('U9')).resolves.toBeNull();
  });

  it('fetchPublicMedia chặn path không bắt đầu bằng / hoặc //host', async () => {
    await expect(mk().fetchPublicMedia('//evil/x')).rejects.toBeInstanceOf(
      HgvisionError,
    );
    await expect(mk().fetchPublicMedia('http://evil/x')).rejects.toBeInstanceOf(
      HgvisionError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
