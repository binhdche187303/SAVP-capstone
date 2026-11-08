import { BadRequestException, ConflictException } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import type { UelApiClient } from './uel-api.client';
import { UelSyncService } from './uel-sync.service';

const DB_NOW = '2026-11-08 02:53:02.123456+00';

function makeDb() {
  return {
    query: jest.fn((sql: string) =>
      Promise.resolve(sql.includes('clock_timestamp()') ? [{ t: DB_NOW }] : []),
    ),
  };
}

function makeService(configured = true, items: unknown[] = []) {
  const client = {
    configured,
    all: jest.fn().mockResolvedValue(items),
  } as unknown as UelApiClient;
  const db = makeDb();
  const svc = new UelSyncService(client, db as unknown as DataSource);
  return Object.assign(svc, { db });
}

describe('UelSyncService.start', () => {
  it('chưa cấu hình API → 400', () => {
    expect(() => makeService(false).start({ steps: ['departments'] })).toThrow(
      BadRequestException,
    );
  });

  it('sections thiếu namHoc/hocKy → 400', () => {
    expect(() => makeService().start({ steps: ['sections'] })).toThrow(
      BadRequestException,
    );
  });

  it('sessions sai khoảng ngày / quá dài → 400', () => {
    const svc = makeService();
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
    const svc = makeService();
    const p = svc.start({ steps: ['departments'] });
    expect(() => svc.start({ steps: ['departments'] })).toThrow(
      ConflictException,
    );
    await p;
    expect(svc.isRunning).toBe(false);
  });

  it('sắp lại bước theo thứ tự phụ thuộc', async () => {
    const run = await makeService().start({ steps: ['staff', 'departments'] });
    expect(run.results.map((r) => r.step)).toEqual(['departments', 'staff']);
    expect(run.finishedAt).not.toBeNull();
  });

  it('mốc vô hiệu hóa lấy theo đồng hồ DB, không theo đồng hồ app', async () => {
    const svc = makeService(true, [
      { ma_phong_ban: 'K_HTTT', ten_phong_ban: 'Khoa HTTT' },
    ]);
    await svc.start({ steps: ['departments'] });
    const deactivate = svc.db.query.mock.calls.find(([sql]) =>
      String(sql).includes('SET is_active = false'),
    );
    expect(deactivate?.[1]).toEqual([DB_NOW]);
  });

  it('sessions khi study_periods trống → bước báo lỗi rõ ràng', async () => {
    const run = await makeService().start({
      steps: ['sessions'],
      fromDate: '2026-11-09',
      toDate: '2026-11-09',
    });
    expect(run.results[0].error).toMatch(/study_periods/);
  });
});
