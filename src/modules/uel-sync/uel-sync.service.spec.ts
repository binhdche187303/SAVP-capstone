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
    const deactivate = query.mock.calls.find(
      ([sql]) =>
        sql.includes('UPDATE departments') &&
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
    expect(paramsOf('UPDATE uel_sync_runs SET status = $2')).toEqual([
      'run-1',
      'succeeded',
      expect.any(String),
      expect.any(String),
      expect.any(String), // gaps
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
      '9001|261BMA202504',
    ]);
  });

  it('sessions: 2 lớp ghép dùng chung ma_lich_hoc ⇒ mỗi lớp 1 buổi riêng (khóa = mã lịch|mã lớp)', async () => {
    const { svc, query } = makeService(true, [
      tkbRow(),
      tkbRow(),
      tkbRow({ ma_lop_hoc_phan: '261BMA202505' }),
    ]);
    query.mockImplementation(
      fakeQuery({
        "semester_code || '|'": [
          ...sectionMap["semester_code || '|'"],
          { k: '2026-2027_HK01|BMA2025|261BMA202505', id: 'sec-2' },
        ],
      }),
    );
    const run = await svc.start({
      steps: ['sessions'],
      fromDate: '2026-11-12',
      toDate: '2026-11-12',
    });
    expect(run.results[0]).toMatchObject({ upserted: 2, skipped: 0 });
    const ins = query.mock.calls.filter(([sql]) =>
      sql.includes('INSERT INTO class_sessions'),
    );
    expect(ins.map((c) => [c[1]?.[0], c[1]?.[5]])).toEqual([
      ['sec-1', '9001|261BMA202504'],
      ['sec-2', '9001|261BMA202505'],
    ]);
  });

  it('sessions: giờ kết thúc API sai (17:45→17:35) ⇒ vẫn ghi, tính theo số tiết, không cảnh báo', async () => {
    const { svc, query } = makeService(true, [
      tkbRow({
        tiet_bat_dau: 13,
        so_tiet: 1,
        gio_bat_dau: '17:45',
        gio_ket_thuc: '17:35',
      }),
    ]);
    query.mockImplementation(fakeQuery(sectionMap));
    const run = await svc.start({
      steps: ['sessions'],
      fromDate: '2026-11-12',
      toDate: '2026-11-12',
    });
    expect(run.results[0]).toMatchObject({ upserted: 1, skipped: 0 });
    expect(run.results[0].warnings).toEqual([]);
    const ins = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO class_sessions'),
    );
    expect(ins?.[1]?.slice(3, 5)).toEqual([
      '2026-11-12T17:45:00+07:00',
      '2026-11-12T18:35:00+07:00',
    ]);
  });

  it('sessions: thời lượng học được từ buổi cùng tiết đã có trong DB', async () => {
    const { svc, query } = makeService(true, [
      tkbRow({
        tiet_bat_dau: 1,
        so_tiet: 5,
        gio_bat_dau: '07:00',
        gio_ket_thuc: null,
      }),
    ]);
    query.mockImplementation(
      fakeQuery({ ...sectionMap, 'AS minutes': [{ k: '1|5', minutes: 240 }] }),
    );
    const run = await svc.start({
      steps: ['sessions'],
      fromDate: '2026-11-12',
      toDate: '2026-11-12',
    });
    expect(run.results[0]).toMatchObject({ upserted: 1, skipped: 0 });
    const ins = query.mock.calls.find(([sql]) =>
      sql.includes('INSERT INTO class_sessions'),
    );
    expect(ins?.[1]?.[4]).toBe('2026-11-12T11:00:00+07:00');
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

    it('tự nhận học kỳ từ TKB, chạy lớp HP + đăng ký từng kỳ, lịch học tải lại TKB mới nhất', async () => {
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
      // TKB: tự nhận học kỳ đọc 1 lượt; bước sessions (chạy sau lớp HP/đăng ký, có thể 1–2h sau)
      // đọc lại để không ghi lịch cũ — và không giữ TKB cả năm trong bộ nhớ.
      const tkbCalls = all.mock.calls.filter(([api]) =>
        (api as string).includes('tkb_lophp_1ngay'),
      );
      expect(
        tkbCalls.map(([, f]) => (f as { ngay_hoc: string }).ngay_hoc),
      ).toEqual(['12/11/2026', '13/11/2026', '12/11/2026', '13/11/2026']);
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

    it('lịch cả năm học (> 120 ngày) vẫn chạy, không 400', async () => {
      const { svc } = makeService();
      const run = await svc.startAll(
        { ...plan, fromDate: '2026-11-17', toDate: '2027-08-31' },
        {},
      );
      expect(run.options.toDate).toBe('2027-08-31');
    });

    it('học kỳ chỉ định: buổi của kỳ khác bị bỏ qua lặng lẽ, vẫn hủy buổi đã bỏ của kỳ chỉ định', async () => {
      const { svc, query } = makeService();
      query.mockImplementation(fakeQuery(sectionMap));
      const all = (svc as unknown as { client: { all: jest.Mock } }).client.all;
      all.mockImplementation((api: string) =>
        Promise.resolve(
          api.includes('tkb_lophp_1ngay')
            ? [
                tkbRow(),
                tkbRow({
                  ma_lich_hoc: 9002,
                  hoc_ky: 'HK02',
                  ma_lop_hoc_phan: 'X2',
                }),
              ]
            : [],
        ),
      );
      const run = await svc.startAll(
        {
          ...plan,
          toDate: '2026-11-12',
          termMode: 'fixed',
          terms: [{ namHoc: '2026-2027', hocKy: 'HK01' }],
        },
        {},
      );
      const ses = run.results.find((r) => r.step === 'sessions');
      expect(ses).toMatchObject({ upserted: 1, skipped: 0 });
      expect(ses?.warnings).toEqual([]);
      const cancel = query.mock.calls.find(([sql]) =>
        sql.includes("SET status = 'cancelled'"),
      );
      expect(cancel?.[0]).toMatch(/semester_code/);
      expect(cancel?.[1]).toContain('2026-2027_HK01');
    });

    it('đang chạy → 409', async () => {
      const { svc } = makeService();
      const p = svc.startAll(plan, {});
      expect(() => svc.startAll(plan, {})).toThrow(ConflictException);
      await p;
    });
  });
});

describe('UEL synchronization preserves existing data on partial failure', () => {
  it('does not cancel existing sessions when a source session cannot map periods', async () => {
    const { svc, query } = makeService(true, [
      {
        ma_lop_hoc_phan: 'LHP1',
        ma_hoc_phan: 'HP1',
        nam_hoc: '2026-2027',
        hoc_ky: '1',
        ngay_hoc: '2026-11-10',
        tiet_bat_dau: 5,
        so_tiet: 3,
      },
    ]);
    query.mockImplementation(
      fakeQuery({
        'FROM study_periods': [
          { period_no: 1, start_time: '07:00', end_time: '07:50' },
        ],
        'semester_code ||': [{ k: '2026-2027_HK01|HP1|LHP1', id: 'class-1' }],
      }),
    );
    const run = await svc.start({
      steps: ['sessions'],
      fromDate: '2026-11-10',
      toDate: '2026-11-10',
    });
    expect(run.status).toBe('partial');
    expect(run.results[0].skipped).toBe(1);
    expect(run.results[0].warnings[0]).toMatch(/bảng tiết chưa có tiết/);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("SET status = 'cancelled'"),
      ),
    ).toBe(false);
  });

  it('does not deactivate departments if an incoming department fails to save', async () => {
    const { svc, query } = makeService(true, [
      { ma_phong_ban: 'K1', ten_phong_ban: 'Khoa 1' },
    ]);
    query.mockImplementation((sql, params) => {
      if (sql.includes('INSERT INTO departments'))
        return Promise.reject(new Error('write failure'));
      return fakeQuery()(sql, params);
    });
    const run = await svc.start({ steps: ['departments'] });
    expect(run.status).toBe('partial');
    expect(
      query.mock.calls.some(([sql]) => sql.includes('SET is_active = false')),
    ).toBe(false);
  });
});

// ─────────────── Lưu tiến độ, gộp mã trùng email, tự tạo SV còn thiếu ───────────────

type ApiFn = (api: string, filter?: Record<string, unknown>) => unknown[];

function makeServiceWith(api: ApiFn, extra: Record<string, unknown[]> = {}) {
  const all = jest.fn((a: string, f?: Record<string, unknown>) =>
    Promise.resolve(api(a, f)),
  );
  const client = { configured: true, all } as unknown as UelApiClient;
  const query = jest.fn<Promise<unknown[]>, [string, unknown[]?]>(
    fakeQuery({ 'INSERT INTO uel_sync_runs': [{ id: 'run-1' }], ...extra }),
  );
  const svc = new UelSyncService(client, { query } as unknown as DataSource);
  const calls = (needle: string) =>
    query.mock.calls.filter(([sql]) => sql.includes(needle));
  return { svc, query, all, calls };
}

describe('lưu tiến độ lượt chạy', () => {
  it('ghi kết quả vào uel_sync_runs sau mỗi bước (không đợi hết lượt)', async () => {
    const { svc, calls } = makeServiceWith(() => []);
    await svc.start({ steps: ['departments', 'staff'] });
    const progress = calls('UPDATE uel_sync_runs SET results = $2');
    expect(progress).toHaveLength(2);
    expect(JSON.parse(progress[0][1]![1] as string)).toHaveLength(1);
    expect(JSON.parse(progress[1][1]![1] as string)).toHaveLength(2);
  });

  it('server khởi động lại ⇒ lượt dở đánh dấu failed + interrupted, giữ kết quả đã lưu', async () => {
    const { svc, calls } = makeServiceWith(() => []);
    await svc.onModuleInit();
    const sql = calls("SET status = 'failed'")[0][0];
    expect(sql).toContain('interrupted');
    expect(sql).not.toContain('results =');
  });

  it('lịch sử trả cờ interrupted', async () => {
    const { svc } = makeServiceWith(() => [], {
      'FROM uel_sync_runs r': [
        {
          id: 'x',
          trigger: 'schedule',
          status: 'failed',
          options: { interrupted: true },
          results: [],
          started_at: new Date(),
          finished_at: new Date(),
        },
      ],
    });
    const [h] = await svc.history();
    expect(h.interrupted).toBe(true);
  });
});

describe('SV: bậc / loại hình đào tạo theo lớp hành chính', () => {
  it('ghi bac_dao_tao + loai_hinh_dao_tao của lớp vào students', async () => {
    const { svc, calls } = makeServiceWith(
      (a) =>
        a === 'sinhvien/ds_lopsv'
          ? [
              {
                ma_lop: 'K24418',
                thuoc_khoa: null,
                bac_dao_tao: 'Đại học',
                loai_hinh_dao_tao: ' Chính quy ',
              },
            ]
          : a === 'sinhvien/ds_sv_lopsv'
            ? [
                {
                  ma_sinh_vien: 'K244181912',
                  ho_ten: 'Tất Kim Ngân',
                  email: 'ngantkk24418@st.uel.edu.vn',
                  ma_lop: 'K24418',
                },
              ]
            : [],
      { 'INSERT INTO users': [{ id: 'u-new' }] },
    );
    await svc.start({ steps: ['students'] });
    expect(calls('INSERT INTO students')[0][1]!.slice(1)).toEqual([
      'K244181912',
      'K24418',
      null,
      'Đại học',
      'Chính quy',
    ]);
  });
});

describe('gộp mã trùng email (cùng 1 người có 2 mã)', () => {
  const owner = (name: string, code = 'N23704064') => ({
    'WHERE lower(email) = lower($1)': [
      { id: 'u-owner', full_name: name, employee_code: code },
    ],
  });
  const studentApi: ApiFn = (a) =>
    a === 'sinhvien/ds_lopsv'
      ? [{ ma_lop: 'N23704-DB', thuoc_khoa: null }]
      : a === 'sinhvien/ds_sv_lopsv'
        ? [
            {
              ma_sinh_vien: 'N23704008',
              ho_ten: 'Nguyễn Đức Anh',
              email: 'anhnd23704@sdh.uel.edu.vn',
              ma_lop: 'N23704-DB',
            },
          ]
        : [];

  it('SV: email đã thuộc người cùng họ tên ⇒ lưu mã phụ, không tạo tài khoản mới, không cảnh báo', async () => {
    const { svc, calls } = makeServiceWith(studentApi, {
      ...owner('Nguyễn  đức Anh'),
      'FROM students WHERE user_id = $1': [
        { id: 'st-owner', student_code: 'N23704064' },
      ],
    });
    const run = await svc.start({ steps: ['students'] });
    expect(run.results[0]).toMatchObject({
      upserted: 1,
      skipped: 0,
      warnings: [],
    });
    expect(calls('INSERT INTO users')).toHaveLength(0);
    expect(calls('INSERT INTO students')).toHaveLength(0);
    expect(calls('INSERT INTO uel_code_aliases')[0][1]!.slice(0, 3)).toEqual([
      'student',
      'N23704008',
      'u-owner',
    ]);
  });

  it('SV: email trùng nhưng khác họ tên ⇒ không gộp, cảnh báo rõ', async () => {
    const { svc, calls } = makeServiceWith(studentApi, owner('Người Khác'));
    const run = await svc.start({ steps: ['students'] });
    expect(run.results[0].skipped).toBe(1);
    expect(run.results[0].warnings[0]).toMatch(/khác họ tên/);
    expect(calls('INSERT INTO uel_code_aliases')).toHaveLength(0);
  });

  it('cán bộ: mã thỉnh giảng trùng email cán bộ cơ hữu ⇒ mã phụ; không tính là bỏ qua nên vẫn xét nghỉ việc', async () => {
    const { svc, calls } = makeServiceWith(
      (a) =>
        a === 'nhansu/ds_nhansu'
          ? [
              {
                ma_nhan_su: 'SDH162',
                ho: 'Nguyễn Văn',
                ten: 'Luân',
                email: 'luannv@uel.edu.vn',
                loai: 'TG',
              },
            ]
          : [],
      owner('Nguyễn Văn Luân', '16.001'),
    );
    const run = await svc.start({ steps: ['staff'] });
    expect(run.results[0]).toMatchObject({ skipped: 0, warnings: [] });
    expect(calls('INSERT INTO uel_code_aliases')[0][1]!.slice(0, 3)).toEqual([
      'staff',
      'SDH162',
      'u-owner',
    ]);
    expect(calls("SET employment_status = 'resigned'")).toHaveLength(1);
  });

  it('giảng viên buổi học tìm theo cả mã phụ', async () => {
    const { svc, calls } = makeServiceWith(
      () => [
        {
          ngay_hoc: '2026-11-12',
          ma_lop_hoc_phan: '261BMA202504',
          ma_hoc_phan: 'BMA2025',
          nam_hoc: '2026-2027',
          hoc_ky: 'HK01',
          tiet_bat_dau: 1,
          so_tiet: 4,
          ma_lich_hoc: 9001,
          ma_giang_vien: 'SDH162',
          gio_bat_dau: '07:00',
          gio_ket_thuc: '11:00',
        },
      ],
      {
        "semester_code || '|'": [
          { k: '2026-2027_HK01|BMA2025|261BMA202504', id: 'sec-1' },
        ],
      },
    );
    await svc.start({
      steps: ['sessions'],
      fromDate: '2026-11-12',
      toDate: '2026-11-12',
    });
    expect(calls('SET lecturer_user_id = COALESCE')[0][0]).toContain(
      'uel_code_aliases',
    );
  });
});

describe('đăng ký: SV chưa có trong hệ thống', () => {
  const sections = {
    'FROM class_sections cs JOIN semesters': [
      { id: 'sec-1', class_code: '261BUU614324' },
    ],
  };
  const enrollApi =
    (codes: string[], info: Record<string, unknown> = {}): ApiFn =>
    (a, f) => {
      if (a === 'dkhp/dkhp_ds_dangkycua1lophocphan')
        return codes.map((c) => ({ ma_sinh_vien: c, ngay_dang_ky: null }));
      if (a === 'sinhvien/thong_tin_sv') {
        const it = info[String(f?.ma_sinh_vien)];
        return it ? [it] : [];
      }
      return [];
    };

  it('mã viết thường vẫn khớp SV đã có', async () => {
    const { svc, all } = makeServiceWith(enrollApi(['k235042513']), {
      ...sections,
      'FROM students WHERE deleted_at IS NULL': [
        { k: 'K235042513', id: 'st-1' },
      ],
    });
    const run = await svc.start({
      steps: ['enrollments'],
      namHoc: '2026-2027',
      hocKy: 'HK01',
    });
    expect(run.results[0]).toMatchObject({
      upserted: 1,
      skipped: 0,
      warnings: [],
    });
    expect(all).not.toHaveBeenCalledWith(
      'sinhvien/thong_tin_sv',
      expect.anything(),
    );
  });

  it('SV khóa cũ (K21) chưa có ⇒ tra thong_tin_sv, tạo SV rồi ghi đăng ký', async () => {
    const { svc, calls } = makeServiceWith(
      enrollApi(['K214080604'], {
        K214080604: {
          ma_sinh_vien: 'K214080604',
          ho_ten: 'Nguyễn Phú Quý',
          lop: 'K21408CA',
          khoa: 'Khoa Kinh tế đối ngoại',
          email: 'quynp21408ca@st.uel.edu.vn',
        },
      }),
      {
        ...sections,
        'INSERT INTO users': [{ id: 'u-new' }],
        'INSERT INTO students': [{ id: 'st-new' }],
      },
    );
    const run = await svc.start({
      steps: ['enrollments'],
      namHoc: '2026-2027',
      hocKy: 'HK01',
    });
    expect(run.results[0]).toMatchObject({
      upserted: 1,
      skipped: 0,
      warnings: [],
    });
    expect(calls('INSERT INTO students')[0][1]).toEqual([
      'u-new',
      'K214080604',
      'K21408CA',
      null,
      null,
      null,
    ]);
    expect(calls('INSERT INTO class_enrollments')[0][1]![1]).toBe('st-new');
  });

  it('UEL không có thông tin SV ⇒ vẫn cảnh báo', async () => {
    const { svc } = makeServiceWith(enrollApi(['X999']), sections);
    const run = await svc.start({
      steps: ['enrollments'],
      namHoc: '2026-2027',
      hocKy: 'HK01',
    });
    expect(run.results[0].skipped).toBe(1);
    expect(run.results[0].warnings[0]).toMatch(/1 SV không tìm thấy trên UEL/);
  });
});

describe('lớp HP: gán giảng viên theo họ tên (giang_vien là tên, không phải mã)', () => {
  const lophp = (giang_vien: string) => () => [
    {
      ma_lop_hoc_phan: '2615BDG100101',
      ma_hoc_phan: 'BDG1001',
      ten_hoc_phan: 'Triết học',
      so_tin_chi: 3,
      giang_vien,
    },
  ];
  const run = (gv: string, people: { lecturer_name: string; id: string }[]) => {
    const t = makeServiceWith(lophp(gv), {
      'INSERT INTO semesters': [{ id: 'sem-1' }],
      'INSERT INTO subjects': [{ id: 'sub-1' }],
      'AS lecturer_name': people,
    });
    return t;
  };
  const byName = (calls: (n: string) => [string, unknown[]?][]) =>
    calls('SET lecturer_user_id = $3').map(([, p]) => p);

  it('lưu tên GV theo UEL vào lớp HP (để báo cáo lý do chưa có GV)', async () => {
    const t = run('GS.Thomas Mastrullo', []);
    await t.svc.start({
      steps: ['sections'],
      namHoc: '2026-2027',
      hocKy: 'HK01',
    });
    const ins = t.calls('INSERT INTO class_sections')[0];
    expect(ins[0]).toContain('uel_lecturer_name');
    expect(ins[1]).toEqual([
      '2615BDG100101',
      'sem-1',
      'sub-1',
      'GS.Thomas Mastrullo',
    ]);
  });

  it('cuối lượt: lưu tóm tắt dữ liệu cần bổ sung (gaps) vào lịch sử', async () => {
    const t = run('TS. Lê Thanh Hòa', []);
    const r = await t.svc.start({
      steps: ['sections'],
      namHoc: '2026-2027',
      hocKy: 'HK01',
    });
    expect(r.gaps?.sections).toBeDefined();
    const fin = t.calls('UPDATE uel_sync_runs SET status = $2')[0];
    expect(fin[0]).toContain('gaps = $5::jsonb');
    expect(JSON.parse(fin[1]![4] as string)).toHaveProperty('students');
  });

  it('tên khớp đúng 1 cán bộ ⇒ gán GV + quyền TEACHER', async () => {
    const t = run('TS. Lê Thanh Hòa', [
      { lecturer_name: 'Lê Thanh  Hòa', id: 'u-1' },
    ]);
    await t.svc.start({
      steps: ['sections'],
      namHoc: '2026-2027',
      hocKy: 'HK01',
    });
    expect(byName(t.calls)).toEqual([['2615BDG100101', 'sem-1', 'u-1']]);
    expect(
      t
        .calls('INSERT INTO user_roles')
        .some(([, p]) => p?.[0] === 'u-1' && p?.[1] === 'TEACHER'),
    ).toBe(true);
  });

  it('trùng tên nhiều cán bộ ⇒ không gán (tránh nhầm người)', async () => {
    const t = run('TS. Lê Thanh Hòa', [
      { lecturer_name: 'Lê Thanh Hòa', id: 'u-1' },
      { lecturer_name: 'Lê Thanh Hòa', id: 'u-2' },
    ]);
    await t.svc.start({
      steps: ['sections'],
      namHoc: '2026-2027',
      hocKy: 'HK01',
    });
    expect(byName(t.calls)).toEqual([]);
  });
});
