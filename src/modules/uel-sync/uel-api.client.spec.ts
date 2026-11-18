import { UelApiClient, UelApiError } from './uel-api.client';

function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function make(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const sleeps: number[] = [];
  const fetchFn = jest.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    const res = responses.shift();
    if (!res) throw new Error('hết response giả');
    return Promise.resolve(res);
  }) as unknown as typeof fetch;
  const client = new UelApiClient({
    baseUrl: 'https://api.uel.edu.vn/',
    projectCode: 'uelapi',
    apiKey: 'KEY',
    timeoutMs: 1000,
    fetchFn,
    sleepFn: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  return { client, calls, sleeps };
}

const page = (items: unknown[], p: number, totalPages: number) => ({
  items,
  total: totalPages,
  page: p,
  limit: 1000,
  totalPages,
});

const bodyOf = (init: RequestInit) =>
  JSON.parse(init.body as string) as Record<string, unknown>;

describe('UelApiClient', () => {
  it('POST đúng URL, header X-Api-Key, body phẳng có page/limit + filter', async () => {
    const { client, calls } = make([json(200, page([{ a: 1 }], 1, 1))]);
    const items = await client.all('sinhvien/ds_sv_lopsv', { ma_lop: 'K22' });
    expect(items).toEqual([{ a: 1 }]);
    expect(calls[0].url).toBe(
      'https://api.uel.edu.vn/gw/v1/uelapi/sinhvien/ds_sv_lopsv',
    );
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['X-Api-Key']).toBe(
      'KEY',
    );
    expect(bodyOf(calls[0].init)).toEqual({
      ma_lop: 'K22',
      page: 1,
      limit: 1000,
    });
  });

  it('all() gọi hết page 1..totalPages', async () => {
    const { client, calls } = make([
      json(200, page([1], 1, 3)),
      json(200, page([2], 2, 3)),
      json(200, page([3], 3, 3)),
    ]);
    expect(await client.all('x/y')).toEqual([1, 2, 3]);
    expect(calls.map((c) => bodyOf(c.init).page)).toEqual([1, 2, 3]);
  });

  it('429 → chờ Retry-After rồi thử lại', async () => {
    const { client, sleeps } = make([
      new Response(null, { status: 429, headers: { 'Retry-After': '5' } }),
      json(200, page([1], 1, 1)),
    ]);
    expect(await client.all('x/y')).toEqual([1]);
    expect(sleeps).toEqual([5000]);
  });

  it('404 Data.NotFound → trang rỗng', async () => {
    const { client } = make([
      json(404, {
        error: { code: 'Data.NotFound', message: 'Không có dữ liệu' },
        traceId: 't',
      }),
    ]);
    expect(await client.all('x/y')).toEqual([]);
  });

  it('400 → ném UelApiError kèm code + traceId, không thử lại', async () => {
    const { client, calls } = make([
      json(400, {
        error: { code: 'Validation', message: 'sai' },
        traceId: 'abc',
      }),
    ]);
    const err: unknown = await client.page('x/y').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UelApiError);
    expect((err as UelApiError).code).toBe('Validation');
    expect((err as UelApiError).traceId).toBe('abc');
    expect(calls).toHaveLength(1);
  });

  it('5xx quá số lần thử → ném lỗi', async () => {
    const { client, calls } = make(
      [1, 2, 3, 4].map(() => json(502, { error: { code: 'Source.Error' } })),
    );
    await expect(client.page('x/y')).rejects.toThrow('Source.Error');
    expect(calls).toHaveLength(4);
  });
});

describe('UelApiClient pagination safety', () => {
  it('rejects malformed pagination rather than applying a partial snapshot', async () => {
    const { client } = make([json(200, { items: [1], page: 1, total: 2 })]);
    await expect(client.all('x/y')).rejects.toThrow('phân trang không hợp lệ');
  });
  it('rejects a missing later page', async () => {
    const { client } = make([
      json(200, page([1], 1, 2)),
      json(404, { error: { code: 'Data.NotFound' } }),
    ]);
    await expect(client.all('x/y')).rejects.toThrow('phân trang UEL');
  });
});

describe('UelApiClient phân trang không ổn định', () => {
  const pg = (items: unknown[], p: number) => ({
    items,
    total: 3,
    page: p,
    limit: 2,
    totalPages: 2,
  });

  it('trang trả trùng/sót (UEL sắp xếp không ổn định) ⇒ tải lại tới khi đủ tổng số, bỏ trùng', async () => {
    const a = { ma: 'A' };
    const b = { ma: 'B' };
    const c = { ma: 'C' };
    const { client, calls } = make([
      json(200, pg([a, b], 1)),
      json(200, pg([b], 2)), // B lặp, C bị sót
      json(200, pg([a, c], 1)),
      json(200, pg([b], 2)),
    ]);
    expect(await client.all('x/y')).toEqual([a, b, c]);
    expect(calls.map((x) => bodyOf(x.init).page)).toEqual([1, 2, 1, 2]);
  });

  it('tải lại nhiều lần vẫn thiếu ⇒ ném lỗi (không áp dụng danh sách thiếu)', async () => {
    const a = { ma: 'A' };
    const b = { ma: 'B' };
    const { client } = make(
      Array.from({ length: 10 }, (_, i) =>
        json(200, pg(i % 2 === 0 ? [a, b] : [b], (i % 2) + 1)),
      ),
    );
    await expect(client.all('x/y')).rejects.toThrow('trả thiếu');
  });
  it('UEL trả dòng trùng y hệt trong cùng 1 trang (total đếm cả dòng trùng) ⇒ không báo thiếu, không tải lại', async () => {
    const a = { ma: 'A' };
    const b = { ma: 'B' };
    const { client, calls } = make([
      json(200, {
        items: [a, a, b],
        total: 3,
        page: 1,
        limit: 1000,
        totalPages: 1,
      }),
    ]);
    expect(await client.all('x/y')).toEqual([a, b]);
    expect(calls).toHaveLength(1);
  });

  it('nhiều trang, dòng trùng trong cùng 1 trang được tính vào tổng ⇒ đủ sau 1 lượt', async () => {
    const a = { ma: 'A' };
    const b = { ma: 'B' };
    const { client, calls } = make([
      json(200, pg([a, a], 1)),
      json(200, pg([b], 2)),
    ]);
    expect(await client.all('x/y')).toEqual([a, b]);
    expect(calls).toHaveLength(2);
  });
});
