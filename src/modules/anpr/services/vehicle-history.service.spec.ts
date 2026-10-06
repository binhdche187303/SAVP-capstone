/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import { DataSource } from 'typeorm';
import { VehicleHistoryService } from './vehicle-history.service.js';

const row = (over: any = {}) => ({
  id: 'evt-1',
  plate_number: '30A12345',
  channel_id: 5,
  direction: 'enter',
  match_state: 'matched',
  event_time: new Date('2026-06-25T09:00:00.000Z'),
  utc: '2026-06-25T09:00:00.000Z',
  user_id: 'u1',
  is_blacklisted: false,
  list_type: null,
  owner_id: null,
  owner_full_name: null,
  owner_avatar_url: null,
  owner_email: null,
  owner_department: null,
  ...over,
});

describe('VehicleHistoryService (VHI-001 / UC7)', () => {
  let service: VehicleHistoryService;
  let dsMock: any;
  let captured: Array<{ sql: string; params: any[] }>;

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
    service = new VehicleHistoryService(dsMock as DataSource);
  });

  // ── user-scope ──
  it("listForUser: WHERE payload_json->>'userId' = $1 (param u1); output KHÔNG userId, KHÔNG owner", async () => {
    wire();
    const r = await service.listForUser('u1', q());
    const sql = rowsCall()!.sql;
    expect(sql).toContain("iot_device_events.payload_json->>'userId' = $1");
    expect(rowsCall()!.params[0]).toBe('u1');
    // SELECT KHÔNG có user_id column → item không có userId.
    expect(sql).not.toContain('AS user_id');
    expect(r.items[0]).not.toHaveProperty('userId');
    // owner (yêu cầu FE 2026-08-08): privacy-by-design mirror userId — KHÔNG JOIN users
    // ở listForUser, KHÔNG có field owner trong output.
    expect(sql).not.toContain('LEFT JOIN users');
    expect(r.items[0]).not.toHaveProperty('owner');
  });

  it('listAll: WHERE chỉ event_type; output CÓ userId', async () => {
    wire();
    const r = await service.listAll(q());
    const sql = rowsCall()!.sql;
    expect(sql).toContain(
      "iot_device_events.event_type = 'ivss_vehicle_event'",
    );
    expect(sql).not.toContain("payload_json->>'userId' = $");
    expect(sql).toContain(
      "iot_device_events.payload_json->>'userId' AS user_id",
    );
    expect(r.items[0].userId).toBe('u1');
  });

  it('C1-isolation: event_type=ivss_vehicle_event (KHÔNG face)', async () => {
    wire();
    await service.listAll(q());
    const sql = rowsCall()!.sql;
    expect(sql).toContain(
      "iot_device_events.event_type = 'ivss_vehicle_event'",
    );
    expect(sql).not.toContain('face_verify');
    expect(sql).not.toContain('face_stranger');
  });

  it('channelId cast + output map đúng field', async () => {
    wire();
    const r = await service.listAll(q());
    expect(rowsCall()!.sql).toContain(
      "(iot_device_events.payload_json->>'channelId')::int",
    );
    expect(r.items[0]).toMatchObject({
      id: 'evt-1',
      plateNumber: '30A12345',
      channelId: 5,
      direction: 'enter',
      matchState: 'matched',
      utc: '2026-06-25T09:00:00.000Z',
    });
  });

  // ── B4 (FIX 2026-08-11): UI đọc gateDirection (ưu tiên) thay vì direction thô ──
  describe('B4: direction ưu tiên gateDirection, fallback direction (COALESCE)', () => {
    it("channel CÓ channel_direction_map ghi đè → SQL ưu tiên payload_json->>'gateDirection' TRƯỚC payload_json->>'direction' trong COALESCE", async () => {
      wire();
      await service.listAll(q());
      const sql = rowsCall()!.sql;
      expect(sql).toContain('COALESCE(');
      const gateIdx = sql.indexOf("payload_json->>'gateDirection'");
      const dirIdx = sql.indexOf("payload_json->>'direction'");
      expect(gateIdx).toBeGreaterThan(-1);
      expect(dirIdx).toBeGreaterThan(-1);
      expect(gateIdx).toBeLessThan(dirIdx); // gateDirection đứng TRƯỚC trong COALESCE → ưu tiên
    });

    it('channel KHÔNG có channel_direction_map (dữ liệu bình thường, gateDirection=direction ở nguồn ghi) → hiện đúng như cũ, không đổi', async () => {
      wire([row({ direction: 'enter' })]);
      const r = await service.listAll(q());
      expect(r.items[0].direction).toBe('enter');
    });

    it('dữ liệu CŨ (event ghi TRƯỚC fix này, payload KHÔNG có key gateDirection) → COALESCE fallback về direction gốc, không lỗi/không hiện trống', async () => {
      // Postgres THẬT: payload_json->>'gateDirection' trên hàng cũ trả NULL (key không tồn
      // tại) → COALESCE tự rơi xuống payload_json->>'direction'. Cú pháp COALESCE đã xác
      // nhận đúng thứ tự ở test trên; ở đây xác nhận tầng mapping đọc thẳng cột `direction`
      // (dù nguồn SQL là fallback) KHÔNG có nhánh riêng nào có thể làm rỗng/lỗi output.
      wire([row({ direction: 'leave' })]);
      const r = await service.listAll(q());
      expect(r.items[0].direction).toBe('leave');
    });
  });

  // ── id (F-F fix): FE dùng để gọi GET ivss/device-events/:id/snapshot ──
  it('id: SELECT có cột id + output item.id khớp đúng iot_device_events.id', async () => {
    wire([row({ id: 'a1b2c3d4-1111-2222-3333-444455556666' })]);
    const r = await service.listAll(q());
    expect(rowsCall()!.sql).toMatch(/SELECT iot_device_events\.id,/);
    expect(r.items[0].id).toBe('a1b2c3d4-1111-2222-3333-444455556666');
  });

  it('id: listForUser cũng trả đúng id (KHÔNG chỉ listAll)', async () => {
    wire([row({ id: 'evt-user-1' })]);
    const r = await service.listForUser('u1', q());
    expect(r.items[0].id).toBe('evt-user-1');
  });

  // ── isBlacklisted/listType (recon 2026-08-08, R1-R3): LEFT JOIN security_alerts
  // qua FK source_event_id → iot_device_events.id (KHÔNG match theo plateNumber+
  // thời gian). KHÔNG đụng luồng ghi (onVehicleEvent()/evaluate()) — chỉ tầng đọc. ──
  describe('isBlacklisted/listType (LATERAL vehicle_control_list theo biển + thời điểm)', () => {
    it('STT 19: SQL lấy cờ từ vehicle_control_list theo biển + thời điểm (KHÔNG còn JOIN security_alerts)', async () => {
      wire();
      await service.listAll(q());
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

    it('DONE: biển nằm trong control-list tại thời điểm xe qua → isBlacklisted=true, listType từ DB (listAll)', async () => {
      wire([row({ is_blacklisted: true, list_type: 'blocklist' })]);
      const r = await service.listAll(q());
      expect(r.items[0].isBlacklisted).toBe(true);
      expect(r.items[0].listType).toBe('blocklist');
    });

    it('DONE: biển KHÔNG trong control-list → isBlacklisted=false, listType=null (listAll)', async () => {
      wire([row({ is_blacklisted: false, list_type: null })]);
      const r = await service.listAll(q());
      expect(r.items[0].isBlacklisted).toBe(false);
      expect(r.items[0].listType).toBeNull();
    });

    it('DONE: listForUser cũng trả đúng isBlacklisted/listType (KHÔNG chỉ listAll)', async () => {
      wire([row({ is_blacklisted: true, list_type: 'watchlist' })]);
      const r = await service.listForUser('u1', q());
      expect(r.items[0].isBlacklisted).toBe(true);
      expect(r.items[0].listType).toBe('watchlist');
    });

    it('COUNT query KHÔNG cần LATERAL control-list (isBlacklisted không phải filter, chỉ hiển thị)', async () => {
      wire();
      await service.listAll(q());
      expect(countCall()!.sql).not.toContain('vehicle_control_list');
    });
  });

  // ── owner/ownerName (yêu cầu FE 2026-08-08): LEFT JOIN users/departments qua
  // payload_json->>'userId' — CHỈ ở listAll (mirror lý do privacy của userId). ──
  describe('owner/ownerName (LEFT JOIN users/departments — CHỈ listAll)', () => {
    it('SQL: LEFT JOIN users u ON u.id = (...)::uuid + LEFT JOIN departments d ON d.id = u.department_id', async () => {
      wire();
      await service.listAll(q());
      const sql = rowsCall()!.sql;
      expect(sql).toContain(
        "LEFT JOIN users u ON u.id = (iot_device_events.payload_json->>'userId')::uuid",
      );
      expect(sql).toContain(
        'LEFT JOIN departments d ON d.id = u.department_id',
      );
      expect(sql).toContain('u.full_name');
      expect(sql).toContain('u.avatar_url');
      expect(sql).toContain('u.email');
      expect(sql).toContain('d.department_name');
    });

    it('DONE: có user khớp → owner đầy đủ 5 field (id/fullName/avatarUrl/email/department)', async () => {
      wire([
        row({
          owner_id: 'u1',
          owner_full_name: 'Nguyễn Văn A',
          owner_avatar_url: 'https://example.com/avatar.jpg',
          owner_email: 'a.nguyen@email.com',
          owner_department: 'Phòng IT',
        }),
      ]);
      const r = await service.listAll(q());
      expect(r.items[0].owner).toEqual({
        id: 'u1',
        fullName: 'Nguyễn Văn A',
        avatarUrl: 'https://example.com/avatar.jpg',
        email: 'a.nguyen@email.com',
        department: 'Phòng IT',
      });
    });

    it('DONE: unmatched (userId null → JOIN không khớp) → owner=null', async () => {
      wire([row({ user_id: null, owner_id: null })]);
      const r = await service.listAll(q());
      expect(r.items[0].owner).toBeNull();
    });

    it('DONE: user chưa gán phòng ban (department_id null) → owner.department=null, các field khác vẫn đủ', async () => {
      wire([
        row({
          owner_id: 'u2',
          owner_full_name: 'Trần Thị B',
          owner_avatar_url: null,
          owner_email: 'b.tran@email.com',
          owner_department: null,
        }),
      ]);
      const r = await service.listAll(q());
      expect(r.items[0].owner).toEqual({
        id: 'u2',
        fullName: 'Trần Thị B',
        avatarUrl: null,
        email: 'b.tran@email.com',
        department: null,
      });
    });

    it('ownerName filter → u.full_name ILIKE $n với %wildcard%, bind đúng vị trí', async () => {
      wire();
      await service.listAll(q({ ownerName: 'Nguyễn' }));
      const c = rowsCall()!;
      expect(c.sql).toContain('u.full_name ILIKE $1');
      expect(c.params[0]).toBe('%Nguyễn%');
    });

    it('COUNT query CÓ JOIN users khi listAll (khác security_alerts) — cần cho filter ownerName chính xác', async () => {
      wire();
      await service.listAll(q({ ownerName: 'Nguyễn' }));
      expect(countCall()!.sql).toContain('LEFT JOIN users u');
      expect(countCall()!.sql).toContain('u.full_name ILIKE $1');
      expect(countCall()!.params[0]).toBe('%Nguyễn%');
    });

    it('ownerName KHÔNG có tác dụng ở listForUser (DTO field bị bỏ qua, KHÔNG lỗi)', async () => {
      wire();
      const r = await service.listForUser(
        'u1',
        q({ ownerName: 'Nguyễn' } as any),
      );
      const sql = rowsCall()!.sql;
      expect(sql).not.toContain('full_name');
      expect(r.items[0]).not.toHaveProperty('owner');
    });
  });

  // ── ràng buộc: plate filter normalize ──
  it('plate filter normalize (cứng): "30A-123.45" → bind param "30A12345"', async () => {
    wire();
    await service.listAll(q({ plateNumber: '30A-123.45' }));
    const c = rowsCall()!;
    expect(c.sql).toContain(
      "iot_device_events.payload_json->>'plateNumber' = $",
    );
    expect(c.params).toContain('30A12345');
    expect(c.params).not.toContain('30A-123.45');
  });

  it("admin matchState filter → payload_json->>'matchState' = $", async () => {
    wire();
    await service.listAll(q({ matchState: 'unmatched' }));
    const c = rowsCall()!;
    expect(c.sql).toContain(
      "iot_device_events.payload_json->>'matchState' = $1",
    );
    expect(c.params[0]).toBe('unmatched');
  });

  // ── bind index liên tục, CẢ 2 method ──
  it('bind index listForUser: userId=$1, from=$2, direction=$3, plate=$4, LIMIT $5 OFFSET $6', async () => {
    wire();
    await service.listForUser(
      'u1',
      q({
        from: '2026-06-01T00:00:00.000Z',
        direction: 'enter',
        plateNumber: '30A-123.45',
      }),
    );
    const c = rowsCall()!;
    expect(c.sql).toContain("iot_device_events.payload_json->>'userId' = $1");
    expect(c.sql).toContain('iot_device_events.event_time >= $2');
    expect(c.sql).toContain(
      "iot_device_events.payload_json->>'direction' = $3",
    );
    expect(c.sql).toContain(
      "iot_device_events.payload_json->>'plateNumber' = $4",
    );
    expect(c.sql).toContain('LIMIT $5 OFFSET $6');
    expect(c.params).toEqual([
      'u1',
      '2026-06-01T00:00:00.000Z',
      'enter',
      '30A12345',
      20,
      0,
    ]);
    // COUNT cùng filter params (KHÔNG limit/offset).
    expect(countCall()!.params).toEqual([
      'u1',
      '2026-06-01T00:00:00.000Z',
      'enter',
      '30A12345',
    ]);
  });

  it('bind index listAll: matchState=$1, from=$2, LIMIT $3 OFFSET $4 (không lệch)', async () => {
    wire();
    await service.listAll(
      q({ matchState: 'matched', from: '2026-06-01T00:00:00.000Z' }),
    );
    const c = rowsCall()!;
    expect(c.sql).toContain(
      "iot_device_events.payload_json->>'matchState' = $1",
    );
    expect(c.sql).toContain('iot_device_events.event_time >= $2');
    expect(c.sql).toContain('LIMIT $3 OFFSET $4');
    expect(c.params).toEqual(['matched', '2026-06-01T00:00:00.000Z', 20, 0]);
  });

  it('to filter → event_time <= $n', async () => {
    wire();
    await service.listAll(q({ to: '2026-06-30T00:00:00.000Z' }));
    expect(rowsCall()!.sql).toContain('iot_device_events.event_time <= $1');
  });

  it('meta total (COUNT, total=25 limit=20 → totalPages=2)', async () => {
    wire([row()], 25);
    const r = await service.listForUser('u1', q());
    expect(r.meta).toEqual({ page: 1, limit: 20, total: 25, totalPages: 2 });
  });

  it('pagination: page=2 limit=20 → LIMIT 20 OFFSET 20', async () => {
    wire();
    await service.listForUser('u1', q({ page: 2, limit: 20 }));
    expect(rowsCall()!.params.slice(-2)).toEqual([20, 20]);
  });

  it('list rỗng: COUNT 0 + rows [] → data:[], total 0, totalPages 0', async () => {
    wire([], 0);
    const r = await service.listAll(q());
    expect(r.items).toEqual([]);
    expect(r.meta.total).toBe(0);
    expect(r.meta.totalPages).toBe(0);
  });

  it('query rỗng → default page/limit; COUNT [] → total 0; user_id null → userId null', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('COUNT(*)')) return Promise.resolve([]); // → ?? 0
      return Promise.resolve([row({ user_id: null })]);
    });
    const r = await service.listAll({} as any);
    expect(r.meta.page).toBe(1);
    expect(r.meta.limit).toBe(20);
    expect(r.meta.total).toBe(0);
    expect(r.items[0].userId).toBeNull();
  });

  it('SEC-03/read-only: chỉ SELECT/COUNT, giá trị qua bind (KHÔNG nối chuỗi)', async () => {
    wire();
    await service.listForUser('u1', q({ from: '2026-06-01T00:00:00.000Z' }));
    for (const c of captured) {
      expect(c.sql).toMatch(/^\s*SELECT/);
      expect(c.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/i);
      expect(c.sql).not.toContain('2026-06-01');
      expect(c.sql).not.toContain('u1'); // userId qua param, không nối chuỗi
    }
  });
});
