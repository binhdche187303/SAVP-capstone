import { HgvisionClient, HgvisionError } from './hgvision.client';

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
