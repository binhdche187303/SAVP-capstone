import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { UelApiClient } from './uel-api.client';
import { UelSyncService } from './uel-sync.service';

const DB_NOW = '2026-11-08 02:53:02.123456+00';

type QueryFn = (sql: string, params?: unknown[]) => Promise<unknown[]>;

/** db.query giả: chỉ trả giá trị cho clock_timestamp() (+ các câu SQL truyền thêm). */
function fakeQuery(extra: Record<string, unknown[]> = {}): QueryFn {
  return (sql) => {
    if (sql.includes('clock_timestamp()'))
      return Promise.resolve([{ t: DB_NOW }]);
    const hit = Object.keys(extra).find((k) => sql.includes(k));
    return Promise.resolve(hit ? extra[hit] : []);
  };
}

function makeService(configured = true, items: unknown[] = []) {
  const client = {
    configured,
    all: jest.fn().mockResolvedValue(items),
  } as unknown as UelApiClient;
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>(fakeQuery());
  const svc = new UelSyncService(client, { query } as unknown as DataSource);
  return { svc, query };
}

describe('UelSyncService.start', () => {
  it('chưa cấu hình API → 400', () => {
    expect(() =>
      makeService(false).svc.start({ steps: ['departments'] }),
    ).toThrow(BadRequestException);
  });

  it('sections thiếu namHoc/hocKy → 400', () => {
    expect(() => makeService().svc.start({ steps: ['sections'] })).toThrow(
      BadRequestException,
    );
  });

  it('sessions sai khoảng ngày / quá dài → 400', () => {
    const { svc } = makeService();
    expect(() =>
      svc.start({
        steps: ['sessions'],
        fromDate: '2026-11-10',
        toDate: '2026-11-01',
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      svc.start({
        steps: ['sessions'],
        fromDate: '2026-01-01',
        toDate: '2026-12-31',
      }),
    ).toThrow(BadRequestException);
  });

  it('đang chạy → 409, xong thì mở khóa', async () => {
    const { svc } = makeService();
    const p = svc.start({ steps: ['departments'] });
    expect(() => svc.start({ steps: ['departments'] })).toThrow(
      ConflictException,
    );
    await p;
    expect(svc.isRunning).toBe(false);
  });

  it('sắp lại bước theo thứ tự phụ thuộc', async () => {
    const run = await makeService().svc.start({
      steps: ['staff', 'departments'],
    });
    expect(run.results.map((r) => r.step)).toEqual(['departments', 'staff']);
    expect(run.finishedAt).not.toBeNull();
  });

  it('mốc vô hiệu hóa lấy theo đồng hồ DB, không theo đồng hồ app', async () => {
    const { svc, query } = makeService(true, [
      { ma_phong_ban: 'K_HTTT', ten_phong_ban: 'Khoa HTTT' },
    ]);
    await svc.start({ steps: ['departments'] });
    const deactivate = query.mock.calls.find(([sql]) =>
      sql.includes('SET is_active = false'),
    );
    expect(deactivate?.[1]).toEqual([DB_NOW]);
  });

  it('ghi lượt chạy vào uel_sync_runs (bắt đầu + kết thúc)', async () => {
    const { svc, query } = makeService();
    query.mockImplementation(
      fakeQuery({ 'INSERT INTO uel_sync_runs': [{ id: 'run-1' }] }),
    );
    const run = await svc.start(
      { steps: ['departments'] },
      { trigger: 'manual', requestedBy: 'user-1' },
    );
    expect(run).toMatchObject({ id: 'run-1', status: 'succeeded' });
    const paramsOf = (needle: string) =>
      query.mock.calls.find(([sql]) => sql.includes(needle))?.[1];
    expect(paramsOf('INSERT INTO uel_sync_runs')).toEqual([
      'manual',
      'user-1',
      expect.any(String),
    ]);
    expect(paramsOf('UPDATE uel_sync_runs')).toEqual([
      'run-1',
      'succeeded',
      expect.any(String),
    ]);
  });

  it('sessions khi study_periods trống → bước báo lỗi rõ ràng', async () => {
    const run = await makeService().svc.start({
      steps: ['sessions'],
      fromDate: '2026-11-09',
      toDate: '2026-11-09',
    });
    expect(run.results[0].error).toMatch(/study_periods/);
  });
});
