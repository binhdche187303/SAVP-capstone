/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { BadRequestException } from '@nestjs/common';
import { CameraTraceService } from './camera-trace.service.js';

const GROUP_ID = '11111111-1111-4111-8111-111111111111';
const DEVICE_ID = '22222222-2222-4222-8222-222222222222';
const CALLER = '33333333-3333-4333-8333-333333333333';
const range = { from: '2026-10-20T01:00:00.000Z', to: '2026-10-20T04:00:00.000Z' };

describe('CameraTraceService (họp 20/10 — truy vết theo camera/nhóm/khu vực)', () => {
  let service: CameraTraceService;
  let query: jest.Mock;
  let insert: jest.Mock;
  let roles: string[];
  let devices: any[];
  let events: any[];
  let captured: Array<{ sql: string; params: any[] }>;

  beforeEach(() => {
    captured = [];
    roles = ['SYSTEM_ADMIN'];
    devices = [{ id: DEVICE_ID, device_code: 'CAM-A1', device_name: 'Camera cổng A' }];
    events = [];
    insert = jest.fn().mockResolvedValue(undefined);
    query = jest.fn().mockImplementation((sql: string, params: any[]) => {
      captured.push({ sql, params });
      if (sql.includes('FROM user_roles')) return Promise.resolve(roles.map((role_code) => ({ role_code })));
      if (sql.includes('FROM iot_devices d')) return Promise.resolve(devices);
      if (sql.includes('WITH ev AS')) return Promise.resolve(events);
      return Promise.resolve([]);
    });
    service = new CameraTraceService({ query, manager: { insert } } as any);
  });

  const row = (over: any = {}) => ({
    id: 'e1',
    time: '2026-10-20T02:00:00.000Z',
    kind: 'zone',
    direction: 'appear',
    user_id: 'u1',
    user_name: 'Bùi Văn Long',
    employee_code: 'NV003',
    plate_number: null,
    room_name: null,
    device_id: DEVICE_ID,
    device_code: 'CAM-A1',
    device_name: 'Camera cổng A',
    zone_id: 'z1',
    zone_name: 'Tòa A',
    group_names: ['Tòa A', 'Cổng 1'],
    snapshot_event_id: 'snap1',
    ...over,
  });

  it('không chọn nhóm/camera/khu vực → 400 CAMERA_TRACE_FILTER_REQUIRED, không query', async () => {
    await expect(service.trace(CALLER, range as any)).rejects.toThrow(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('mốc kết thúc không sau mốc bắt đầu → 400', async () => {
    await expect(service.trace(CALLER, { groupId: GROUP_ID, from: range.to, to: range.from })).rejects.toThrow(BadRequestException);
  });

  it('khoảng > 31 ngày → 400', async () => {
    await expect(
      service.trace(CALLER, { groupId: GROUP_ID, from: '2026-08-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('nhóm không có camera → trả rỗng, KHÔNG quét bảng sự kiện', async () => {
    devices = [];
    const r = await service.trace(CALLER, { groupId: GROUP_ID, ...range });
    expect(r).toEqual({ devices: [], events: [], page: 1, limit: 100, hasMore: false });
    expect(captured.some((c) => c.sql.includes('WITH ev AS'))).toBe(false);
  });

  it('truyền đúng id nhóm vào bước resolve camera và id camera vào truy vấn sự kiện', async () => {
    events = [row()];
    await service.trace(CALLER, { groupId: GROUP_ID, ...range });
    const resolve = captured.find((c) => c.sql.includes('FROM iot_devices d'))!;
    expect(resolve.params).toEqual([null, GROUP_ID, null]);
    const evq = captured.find((c) => c.sql.includes('WITH ev AS'))!;
    expect(evq.params[0]).toEqual([DEVICE_ID]);
    expect(evq.sql).toContain('FROM gate_access_logs');
    expect(evq.sql).toContain('FROM zone_presence_events');
    expect(evq.sql).toContain("p.event_type <> 'count'");
  });

  it('map đủ thông tin nguồn camera: camera, khu vực, nhóm, ảnh bằng chứng', async () => {
    events = [row()];
    const r = await service.trace(CALLER, { deviceId: DEVICE_ID, ...range });
    expect(r.devices).toEqual([{ id: DEVICE_ID, deviceCode: 'CAM-A1', deviceName: 'Camera cổng A' }]);
    expect(r.events[0]).toEqual({
      id: 'e1',
      time: '2026-10-20T02:00:00.000Z',
      kind: 'zone',
      direction: 'appear',
      userId: 'u1',
      userName: 'Bùi Văn Long',
      employeeCode: 'NV003',
      plateNumber: null,
      roomName: null,
      deviceId: DEVICE_ID,
      deviceCode: 'CAM-A1',
      deviceName: 'Camera cổng A',
      zoneId: 'z1',
      zoneName: 'Tòa A',
      groupNames: ['Tòa A', 'Cổng 1'],
      snapshotEventId: 'snap1',
    });
  });

  it('phân trang: lấy limit+1 dòng để biết còn trang sau', async () => {
    events = [row({ id: 'a' }), row({ id: 'b' }), row({ id: 'c' })];
    const r = await service.trace(CALLER, { groupId: GROUP_ID, ...range, limit: 2 });
    expect(r.events.map((e) => e.id)).toEqual(['a', 'b']);
    expect(r.hasMore).toBe(true);
    const evq = captured.find((c) => c.sql.includes('WITH ev AS'))!;
    expect(evq.params.slice(4, 6)).toEqual([3, 0]); // limit+1, offset
  });

  it('SYSTEM_ADMIN: không giới hạn phạm vi người; MANAGER: chỉ người cùng phòng ban/cấp dưới', async () => {
    await service.trace(CALLER, { groupId: GROUP_ID, ...range });
    expect(captured.find((c) => c.sql.includes('WITH ev AS'))!.sql).not.toContain('direct_manager_id');

    captured.length = 0;
    roles = ['MANAGER'];
    await service.trace(CALLER, { groupId: GROUP_ID, ...range });
    const evq = captured.find((c) => c.sql.includes('WITH ev AS'))!;
    expect(evq.sql).toContain('direct_manager_id');
    expect(evq.params[6]).toBe(CALLER);
  });

  it('ghi audit camera_trace.view; lỗi ghi audit không làm hỏng kết quả', async () => {
    insert.mockRejectedValueOnce(new Error('db down'));
    await expect(service.trace(CALLER, { groupId: GROUP_ID, ...range })).resolves.toBeDefined();
    expect(insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actionType: 'camera_trace.view', entityId: GROUP_ID }),
    );
  });
});
