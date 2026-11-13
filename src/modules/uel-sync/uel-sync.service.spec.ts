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
      expect.any(String),
    ]);
  });

  const tkbRow = (over: Record<string, unknown> = {}) => ({
    ngay_hoc: '2026-11-12',
    ma_lop_hoc_phan: '261BMA202504',
    ma_hoc_phan: 'BMA2025',
    nam_hoc: '2026-2027',
    hoc_ky: 'HK01',
    tiet_bat_dau: 1,
    so_tiet: 4,
    ma_phong_hoc: null,
    ma_lich_hoc: 9001,
    ma_giang_vien: 'GV0001',
    gio_bat_dau: '07:00',
    gio_ket_thuc: '11:00',
    ...over,
  });
  const sectionMap = {
    "semester_code || '|'": [
      { k: '2026-2027_HK01|BMA2025|261BMA202504', id: 'sec-1' },
    ],
  };

  it('sessions: study_periods trống vẫn ghi buổi theo gio_bat_dau/gio_ket_thuc API', async () => {
    const { svc, query } = makeService(true, [tkbRow()]);
    query.mockImplementation(fakeQuery(sectionMap));
    const run = await svc.start({
      steps: ['sessions'],
      fromDate: '2026-11-12',
      toDate: '2026-11-12',
    });
    expect(run.results[0]).toMatchObject({ upserted: 1, skipped: 0 });
    expect(run.results[0].error).toBeUndefined();
    const ins = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO class_sessions'),
    );
    expect(ins?.[1]?.slice(3, 6)).toEqual([
      '2026-11-12T07:00:00+07:00',
      '2026-11-12T11:00:00+07:00',
      '9001',
    ]);
  });

  it('sessions: thiếu giờ API và không có bảng tiết → bỏ qua + cảnh báo', async () => {
    const { svc, query } = makeService(true, [
      tkbRow({ gio_bat_dau: null, gio_ket_thuc: null }),
    ]);
    query.mockImplementation(fakeQuery(sectionMap));
    const run = await svc.start({
      steps: ['sessions'],
      fromDate: '2026-11-12',
      toDate: '2026-11-12',
    });
    expect(run.results[0]).toMatchObject({ upserted: 0, skipped: 1 });
    expect(run.results[0].warnings[0]).toMatch(/không có giờ/);
  });

  it('sessions theo người: gọi API GV/SV, gộp buổi trùng, không hủy buổi', async () => {
    const { svc, query } = makeService(true, [tkbRow()]);
    query.mockImplementation(fakeQuery(sectionMap));
    const all = (svc as unknown as { client: { all: jest.Mock } }).client.all;
    const run = await svc.start({
      steps: ['sessions'],
      fromDate: '2026-11-12',
      toDate: '2026-11-13',
      lecturerCodes: ['GV0001', ' GV0001 '],
      studentCodes: ['K240000001'],
    });
    const apis = all.mock.calls.map(([api]) => api as string);
    expect(apis).toHaveLength(4); // 2 mã × 2 ngày (GV0001 trùng bị gộp)
    expect(apis.some((a) => a.includes('tkb_lophp_1ngay'))).toBe(false);
    expect((all.mock.calls[0] as unknown[])[1]).toEqual({
      ma_giang_vien: 'GV0001',
      ngay_hoc: '12/11/2026', // UEL đòi dd/MM/yyyy
    });
    // Cùng ma_lich_hoc 9001 trả về 4 lần → chỉ ghi 1 lần.
    expect(run.results[0]).toMatchObject({ fetched: 4, upserted: 1 });
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("SET status = 'cancelled'"),
      ),
    ).toBe(false);
  });

  it('sessions theo người: quá nhiều lần gọi API → 400', () => {
    const { svc } = makeService();
    expect(() =>
      svc.start({
        steps: ['sessions'],
        fromDate: '2026-11-01',
        toDate: '2027-01-31',
        lecturerCodes: Array.from({ length: 10 }, (_, i) => `GV${i}`),
      }),
    ).toThrow(BadRequestException);
  });

  describe('startAll (đồng bộ toàn bộ)', () => {
    const plan = {
      fromDate: '2026-11-12',
      toDate: '2026-11-13',
      termMode: 'auto' as const,
      terms: [],
    };

    it('tự nhận học kỳ từ TKB, chạy lớp HP + đăng ký từng kỳ, lịch học dùng lại TKB đã tải', async () => {
      const { svc, query } = makeService();
      query.mockImplementation(fakeQuery(sectionMap));
      const all = (svc as unknown as { client: { all: jest.Mock } }).client.all;
      all.mockImplementation((api: string) =>
        Promise.resolve(
          api.includes('tkb_lophp_1ngay')
            ? [tkbRow(), tkbRow({ ma_lich_hoc: 9002, hoc_ky: 'HK02' })]
            : [],
        ),
      );
      const run = await svc.startAll(plan, { trigger: 'manual' });

      expect(run.options.terms).toEqual([
        { namHoc: '2026-2027', hocKy: 'HK01' },
        { namHoc: '2026-2027', hocKy: 'HK02' },
      ]);
      expect(
        run.results.map((r) => `${r.step}${r.term ? `:${r.term}` : ''}`),
      ).toEqual([
        'departments',
        'staff',
        'students',
        'sections:2026-2027 HK01',
        'sections:2026-2027 HK02',
        'enrollments:2026-2027 HK01',
        'enrollments:2026-2027 HK02',
        'sessions',
      ]);
      expect(run.currentStep).toBeNull();
      // TKB: 2 ngày chỉ gọi 1 lần mỗi ngày (lúc tự nhận học kỳ), bước sessions không gọi lại.
      const tkbCalls = all.mock.calls.filter(([api]) =>
        (api as string).includes('tkb_lophp_1ngay'),
      );
      expect(
        tkbCalls.map(([, f]) => (f as { ngay_hoc: string }).ngay_hoc),
      ).toEqual(['12/11/2026', '13/11/2026']);
      expect(run.results.at(-1)).toMatchObject({
        step: 'sessions',
        fetched: 4,
      });
    });

    it('học kỳ chỉ định → không đọc TKB để nhận kỳ', async () => {
      const { svc } = makeService();
      const run = await svc.startAll(
        {
          ...plan,
          termMode: 'fixed',
          terms: [{ namHoc: '2026-2027', hocKy: 'HK01' }],
        },
        {},
      );
      expect(
        run.results.filter((r) => r.step === 'sections').map((r) => r.term),
      ).toEqual(['2026-2027 HK01']);
    });

    it('không nhận được học kỳ nào → bước lớp HP/đăng ký báo lỗi, các bước khác vẫn chạy', async () => {
      const { svc } = makeService();
      const run = await svc.startAll(plan, {});
      expect(run.options.terms).toEqual([]);
      const sec = run.results.find((r) => r.step === 'sections');
      expect(sec?.error).toMatch(/Không nhận được học kỳ/);
      expect(
        run.results.find((r) => r.step === 'sessions')?.error,
      ).toBeUndefined();
      expect(run.status).toBe('partial');
    });

    it('API trả 0 buổi cho ngày DB đang có lịch → không hủy, chỉ cảnh báo', async () => {
      const { svc, query } = makeService();
      query.mockImplementation(
        fakeQuery({ 'count(*)::text AS n': [{ n: '120' }] }),
      );
      const run = await svc.startAll(plan, {});
      const ses = run.results.find((r) => r.step === 'sessions');
      expect(ses?.warnings[0]).toMatch(/không hủy/);
      expect(
        query.mock.calls.some(([sql]) =>
          sql.includes("SET status = 'cancelled'"),
        ),
      ).toBe(false);
    });

    it('đang chạy → 409', async () => {
      const { svc } = makeService();
      const p = svc.startAll(plan, {});
      expect(() => svc.startAll(plan, {})).toThrow(ConflictException);
      await p;
    });
  });
});
