/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { DataSource } from 'typeorm';
import { VehicleUnknownService } from './vehicle-unknown.service.js';

const row = (over: any = {}) => ({
  id: 'evt-1',
  plate_number: '30A12345',
  channel_id: 5,
  direction: 'enter',
  event_time: new Date('2026-06-25T09:00:00.000Z'),
  utc: '2026-06-25T09:00:00.000Z',
  plate_color: 'white',
  vehicle_type: 'car',
  is_blacklisted: false,
  list_type: null,
  ...over,
});

describe('VehicleUnknownService (VUN-001 / UC6)', () => {
  let service: VehicleUnknownService;
  let dsMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

  // total = COUNT, rows = SELECT ... event_time DESC.
  const wire = (rows: any[] = [row()], total = 1) => {
    captured = [];
    dsMock.manager.query.mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('COUNT(*)')) return Promise.resolve([{ total }]);
      return Promise.resolve(rows);
    });
  };

  const countCall = () => captured.find((c) => c.sql.includes('COUNT(*)'));
  const rowsCall = () =>
    captured.find((c) =>
      c.sql.includes('ORDER BY iot_device_events.event_time DESC'),
    );

  const q = (over: any = {}) => ({ page: 1, limit: 20, ...over });

  beforeEach(() => {
    dsMock = { manager: { query: jest.fn() } };
    service = new VehicleUnknownService(dsMock as DataSource);
  });

  it('list: map đúng 10 field + meta (total=25 limit=20 → totalPages=2)', async () => {
    wire([row()], 25);
    const r = await service.listUnknown(q());
    expect(r.items[0]).toEqual({
      id: 'evt-1',
      plateNumber: '30A12345',
      channelId: 5,
      direction: 'enter',
      eventTime: new Date('2026-06-25T09:00:00.000Z'),
      utc: '2026-06-25T09:00:00.000Z',
      plateColor: 'white',
      vehicleType: 'car',
      isBlacklisted: false,
      listType: null,
    });
    expect(r.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
  });

  // ── B4 (FIX 2026-08-11): UI đọc gateDirection (ưu tiên) thay vì direction thô ──
  describe('B4: direction ưu tiên gateDirection, fallback direction (COALESCE)', () => {
    it("channel CÓ channel_direction_map ghi đè → SQL ưu tiên payload_json->>'gateDirection' TRƯỚC payload_json->>'direction' trong COALESCE", async () => {
      wire();
      await service.listUnknown(q());
      const sql = rowsCall()!.sql;
      expect(sql).toContain('COALESCE(');
      const gateIdx = sql.indexOf("payload_json->>'gateDirection'");
      const dirIdx = sql.indexOf("payload_json->>'direction'");
      expect(gateIdx).toBeGreaterThan(-1);
      expect(dirIdx).toBeGreaterThan(-1);
      expect(gateIdx).toBeLessThan(dirIdx); // gateDirection đứng TRƯỚC trong COALESCE → ưu tiên
    });

    it('channel KHÔNG có channel_direction_map → hiện đúng như cũ, không đổi', async () => {
      wire([row({ direction: 'enter' })]);
      const r = await service.listUnknown(q());
      expect(r.items[0].direction).toBe('enter');
    });

    it('dữ liệu CŨ (event ghi TRƯỚC fix này, payload KHÔNG có key gateDirection) → COALESCE fallback về direction gốc, không lỗi/không hiện trống', async () => {
      wire([row({ direction: 'leave' })]);
      const r = await service.listUnknown(q());
      expect(r.items[0].direction).toBe('leave');
    });
  });

  // ── id (F-F fix): FE dùng để gọi GET ivss/device-events/:id/snapshot ──
  it('id: SELECT có cột id + output item.id khớp đúng iot_device_events.id', async () => {
    wire([row({ id: 'a1b2c3d4-1111-2222-3333-444455556666' })]);
    const r = await service.listUnknown(q());
    expect(rowsCall()!.sql).toMatch(/SELECT iot_device_events\.id,/);
    expect(r.items[0].id).toBe('a1b2c3d4-1111-2222-3333-444455556666');
  });

  it('C1-isolation: SQL chứa event_type=ivss_vehicle_event + matchState=unmatched (KHÔNG face)', async () => {
    wire();
    await service.listUnknown(q());
    const sql = rowsCall()!.sql;
    expect(sql).toContain(
      "iot_device_events.event_type = 'ivss_vehicle_event'",
    );
    expect(sql).toContain(
      "iot_device_events.payload_json->>'matchState' = 'unmatched'",
    );
    expect(sql).not.toContain('face_verify');
    expect(sql).not.toContain('face_stranger');
  });

  it("JSON path TOP-LEVEL: payload_json->>'plateNumber' (1 mũi tên, KHÔNG nest)", async () => {
    wire();
    await service.listUnknown(q());
    const sql = rowsCall()!.sql;
    expect(sql).toContain("iot_device_events.payload_json->>'plateNumber'");
    expect(sql).not.toContain('extracted_fields');
  });

  it('channelId cast ::int', async () => {
    wire();
    await service.listUnknown(q());
    expect(rowsCall()!.sql).toContain(
      "(iot_device_events.payload_json->>'channelId')::int",
    );
  });

  // ── isBlacklisted/listType (recon 2026-08-08, R1-R3): LEFT JOIN security_alerts
  // qua FK source_event_id → iot_device_events.id (mirror VehicleHistoryService) ──
  describe('isBlacklisted/listType (LATERAL vehicle_control_list theo biển + thời điểm)', () => {
    it('STT 19: SQL lấy cờ từ vehicle_control_list theo biển + thời điểm (KHÔNG còn JOIN security_alerts)', async () => {
      wire();
      await service.listUnknown(q());
      const sql = rowsCall()!.sql;
      expect(sql).not.toContain('security_alerts');
      expect(sql).toContain('LEFT JOIN LATERAL');
      expect(sql).toContain('FROM vehicle_control_list vcl');
      expect(sql).toContain(
        "vcl.plate_number = iot_device_events.payload_json->>'plateNumber'",
      );
      expect(sql).toContain('vcl.active = true');
      // Dòng phải TỒN TẠI tại thời điểm xe qua (không gắn cờ ngược cho lượt cũ).
      expect(sql).toContain('vcl.created_at <= iot_device_events.event_time');
      expect(sql).toContain(
        'vcl.deleted_at IS NULL OR vcl.deleted_at > iot_device_events.event_time',
      );
      // DATA-02: blocklist ưu tiên hơn watchlist (alphabet ASC, mirror checkControlList).
      expect(sql).toContain('ORDER BY vcl.list_type ASC');
      expect(sql).toContain('vcl.list_type IS NOT NULL');
    });

    it('DONE: biển nằm trong control-list tại thời điểm xe qua → isBlacklisted=true, listType từ DB', async () => {
      wire([row({ is_blacklisted: true, list_type: 'blocklist' })]);
      const r = await service.listUnknown(q());
      expect(r.items[0].isBlacklisted).toBe(true);
      expect(r.items[0].listType).toBe('blocklist');
    });

    it('DONE: biển KHÔNG trong control-list → isBlacklisted=false, listType=null', async () => {
      wire([row({ is_blacklisted: false, list_type: null })]);
      const r = await service.listUnknown(q());
      expect(r.items[0].isBlacklisted).toBe(false);
      expect(r.items[0].listType).toBeNull();
    });

    it('COUNT query KHÔNG cần JOIN (isBlacklisted không phải filter, chỉ hiển thị)', async () => {
      wire();
      await service.listUnknown(q());
      expect(countCall()!.sql).not.toContain('vehicle_control_list');
    });
  });

  describe('time-range build động + bind index đúng (4 tổ hợp)', () => {
    it('không-from-không-to → KHÔNG event_time, params=[limit,offset]', async () => {
      wire();
      await service.listUnknown(q({ page: 1, limit: 20 }));
      const c = rowsCall()!;
      expect(c.sql).not.toContain('event_time >=');
      expect(c.sql).not.toContain('event_time <=');
      expect(c.sql).toContain('LIMIT $1 OFFSET $2');
      expect(c.params).toEqual([20, 0]);
    });

    it('chỉ-from → event_time >= $1, LIMIT $2 OFFSET $3', async () => {
      wire();
      await service.listUnknown(q({ from: '2026-06-01T00:00:00.000Z' }));
      const c = rowsCall()!;
      expect(c.sql).toContain('iot_device_events.event_time >= $1');
      expect(c.sql).toContain('LIMIT $2 OFFSET $3');
      expect(c.params).toEqual(['2026-06-01T00:00:00.000Z', 20, 0]);
    });

    it('chỉ-to → event_time <= $1, LIMIT $2 OFFSET $3', async () => {
      wire();
      await service.listUnknown(q({ to: '2026-06-30T00:00:00.000Z' }));
      const c = rowsCall()!;
      expect(c.sql).toContain('iot_device_events.event_time <= $1');
      expect(c.sql).toContain('LIMIT $2 OFFSET $3');
      expect(c.params).toEqual(['2026-06-30T00:00:00.000Z', 20, 0]);
    });

    it('cả-hai → >= $1 AND <= $2, LIMIT $3 OFFSET $4 (bind index không lệch)', async () => {
      wire();
      await service.listUnknown(
        q({ from: '2026-06-01T00:00:00.000Z', to: '2026-06-30T00:00:00.000Z' }),
      );
      const c = rowsCall()!;
      expect(c.sql).toContain('iot_device_events.event_time >= $1');
      expect(c.sql).toContain('iot_device_events.event_time <= $2');
      expect(c.sql).toContain('LIMIT $3 OFFSET $4');
      expect(c.params).toEqual([
        '2026-06-01T00:00:00.000Z',
        '2026-06-30T00:00:00.000Z',
        20,
        0,
      ]);
      // COUNT dùng CÙNG WHERE params (KHÔNG limit/offset).
      expect(countCall()!.params).toEqual([
        '2026-06-01T00:00:00.000Z',
        '2026-06-30T00:00:00.000Z',
      ]);
    });
  });

  it('list rỗng: COUNT 0 + rows [] → data:[], meta.total=0, totalPages=0', async () => {
    wire([], 0);
    const r = await service.listUnknown(q());
    expect(r.items).toEqual([]);
    expect(r.meta.total).toBe(0);
    expect(r.meta.totalPages).toBe(0);
  });

  it('pagination: page=2 limit=20 → LIMIT 20 OFFSET 20', async () => {
    wire();
    await service.listUnknown(q({ page: 2, limit: 20 }));
    expect(rowsCall()!.params.slice(-2)).toEqual([20, 20]);
  });

  it('query rỗng (KHÔNG page/limit) → default 1/20; COUNT [] → total 0', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)')) return Promise.resolve([]); // empty → ?? 0
      return Promise.resolve([]);
    });
    const r = await service.listUnknown({} as any);
    expect(r.meta.page).toBe(1);
    expect(r.meta.limit).toBe(20);
    expect(r.meta.total).toBe(0);
  });

  it('SEC-03/read-only: chỉ SELECT/COUNT (KHÔNG INSERT/UPDATE/DELETE)', async () => {
    wire();
    await service.listUnknown(q({ from: '2026-06-01T00:00:00.000Z' }));
    for (const c of captured) {
      expect(c.sql).toMatch(/^\s*SELECT/);
      expect(c.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
      // giá trị from qua bind param, KHÔNG nối chuỗi vào SQL.
      expect(c.sql).not.toContain('2026-06-01');
    }
  });
});
