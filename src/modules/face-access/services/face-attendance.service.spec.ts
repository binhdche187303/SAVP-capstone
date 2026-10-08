/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { FaceAttendanceService } from './face-attendance.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import { PersonWatchlistCheckService } from '../../alerts/services/person-watchlist-check.service.js';

const START = '2026-06-17T09:00:00.000Z';
const END = '2026-06-17T10:00:00.000Z';
// meeting mặc định: đang mở (in_progress), kết thúc 10:00, verify 09:00 → còn mở.
const openMeeting = (over: any = {}) => ({
  id: 'm1',
  start_time: START,
  end_time: END,
  actual_end_time: null,
  status: 'in_progress',
  ...over,
});
const input = (over: any = {}) => ({
  deviceId: 'dev1',
  roomId: 'room1',
  personId: '64',
  personName: 'u1:m1',
  verifyTime: new Date('2026-06-17T09:00:00.000Z'),
  direction: 'in',
  ...over,
});

const calls = (mock: jest.Mock, needle: string) =>
  mock.mock.calls.filter((c: any[]) => String(c[0]).includes(needle));

describe('FaceAttendanceService (FAT-001)', () => {
  let service: FaceAttendanceService;
  let dsMock: any;
  let wsMock: any;
  let watchlistMock: { checkPersonWatchlist: jest.Mock };

  // router mặc định: mapping khớp person_id, meeting tồn tại, chưa có record
  const router =
    (
      over: {
        mapping?: any[];
        mappingByCode?: any[];
        meeting?: any[];
        existing?: any[];
        checkoutRec?: any[];
        grace?: string | null;
      } = {},
    ) =>
    (sql: string) => {
      if (sql.includes('device_person_id = $2'))
        return Promise.resolve(
          over.mapping ?? [
            { user_id: 'u1', metadata_json: { bookingId: 'm1' } },
          ],
        );
      if (sql.includes('device_person_code = $2'))
        return Promise.resolve(over.mappingByCode ?? []);
      if (sql.includes('FROM meetings'))
        return Promise.resolve(over.meeting ?? [openMeeting()]);
      if (sql.includes('FROM system_configs'))
        return Promise.resolve([{ config_value: over.grace ?? null }]);
      // DCO-001 checkOut SELECT (id, check_in_time, check_out_time).
      if (sql.includes('check_in_time, check_out_time'))
        return Promise.resolve(over.checkoutRec ?? []);
      if (sql.includes('SELECT id FROM attendance_records'))
        return Promise.resolve(over.existing ?? []);
      if (sql.includes('INSERT INTO attendance_records'))
        return Promise.resolve([{ id: 'rec1' }]);
      return Promise.resolve(undefined);
    };

  beforeEach(async () => {
    dsMock = { manager: { query: jest.fn() } };
    wsMock = { emitToRoom: jest.fn() };
    watchlistMock = {
      checkPersonWatchlist: jest.fn().mockResolvedValue(undefined),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FaceAttendanceService,
        { provide: DataSource, useValue: dsMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: WebsocketService, useValue: wsMock },
        { provide: PersonWatchlistCheckService, useValue: watchlistMock },
      ],
    }).compile();
    service = module.get(FaceAttendanceService);
  });

  afterEach(() => jest.clearAllMocks());

  it('AC-001 happy đúng giờ: INSERT present + event check_in', async () => {
    dsMock.manager.query.mockImplementation(router());
    await service.onVerify(input());
    const ins = calls(dsMock.manager.query, 'INSERT INTO attendance_records');
    expect(ins.length).toBe(1);
    // params: [meetingId,userId,verifyTime,isLate,lateMinutes,status]
    expect(ins[0][1]).toEqual([
      'm1',
      'u1',
      input().verifyTime,
      false,
      0,
      'present',
    ]);
    const ev = calls(dsMock.manager.query, 'INSERT INTO attendance_events');
    expect(ev.length).toBe(1);
    expect(ev[0][1]).toEqual(
      expect.arrayContaining(['m1', 'rec1', 'u1', 'room1', 'dev1', 'check_in']),
    );
  });

  // ── [FIX 2026-08-16] WS emit meeting.attendance.updated ──
  it('[FIX 2026-08-16] check-in MỚI thành công → emit đúng sự kiện/room/payload', async () => {
    dsMock.manager.query.mockImplementation(router());
    await service.onVerify(input());
    expect(wsMock.emitToRoom).toHaveBeenCalledTimes(1);
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'meeting:m1',
      'meeting.attendance.updated',
      {
        meetingId: 'm1',
        userId: 'u1',
        attendanceStatus: 'present',
        checkInTime: input().verifyTime.toISOString(),
      },
    );
  });

  it('[FIX 2026-08-16] check-in MỚI nhưng trễ → payload attendanceStatus=late', async () => {
    dsMock.manager.query.mockImplementation(router({ grace: '5' }));
    const verifyTime = new Date('2026-06-17T09:20:00.000Z');
    await service.onVerify(input({ verifyTime }));
    expect(wsMock.emitToRoom).toHaveBeenCalledWith(
      'meeting:m1',
      'meeting.attendance.updated',
      expect.objectContaining({
        attendanceStatus: 'late',
        checkInTime: verifyTime.toISOString(),
      }),
    );
  });

  it('[FIX 2026-08-16] INSERT attendance_records thất bại (lỗi ghi) → KHÔNG emit gì cả', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO attendance_records'))
        return Promise.reject(new Error('db write failed'));
      return router()(sql);
    });
    await expect(service.onVerify(input())).rejects.toThrow('db write failed');
    expect(wsMock.emitToRoom).not.toHaveBeenCalled();
  });

  it('[FIX 2026-08-16] verify lặp (face_detected, KHÔNG phải điểm danh mới) → KHÔNG emit', async () => {
    dsMock.manager.query.mockImplementation(
      router({ existing: [{ id: 'rec1' }] }),
    );
    await service.onVerify(input());
    expect(wsMock.emitToRoom).not.toHaveBeenCalled();
  });

  it('[FIX 2026-08-16] emitToRoom ném lỗi → onVerify KHÔNG throw, ghi attendance vẫn thành công (best-effort)', async () => {
    dsMock.manager.query.mockImplementation(router());
    wsMock.emitToRoom.mockImplementation(() => {
      throw new Error('socket boom');
    });
    await expect(service.onVerify(input())).resolves.toBeUndefined();
    const ins = calls(dsMock.manager.query, 'INSERT INTO attendance_records');
    expect(ins.length).toBe(1);
  });

  it('AC-002 trễ quá grace: record late, is_late=true, late_minutes>0', async () => {
    dsMock.manager.query.mockImplementation(router({ grace: '5' }));
    // verify lúc 09:20 → trễ 20 phút (>5 grace)
    await service.onVerify(
      input({ verifyTime: new Date('2026-06-17T09:20:00.000Z') }),
    );
    const ins = calls(dsMock.manager.query, 'INSERT INTO attendance_records');
    expect(ins[0][1][3]).toBe(true); // isLate
    expect(ins[0][1][4]).toBe(20); // lateMinutes
    expect(ins[0][1][5]).toBe('late');
  });

  it('AC-002b trong grace: vẫn present (không late)', async () => {
    dsMock.manager.query.mockImplementation(router({ grace: '10' }));
    // verify 09:08 → trễ 8 phút < grace 10 → present
    await service.onVerify(
      input({ verifyTime: new Date('2026-06-17T09:08:00.000Z') }),
    );
    const ins = calls(dsMock.manager.query, 'INSERT INTO attendance_records');
    expect(ins[0][1][3]).toBe(false);
    expect(ins[0][1][5]).toBe('present');
  });

  it('AC-003 verify lặp: KHÔNG INSERT record, chỉ UPDATE last_detected + event face_detected', async () => {
    dsMock.manager.query.mockImplementation(
      router({ existing: [{ id: 'rec1' }] }),
    );
    await service.onVerify(input());
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_records').length,
    ).toBe(0);
    const upd = calls(dsMock.manager.query, 'UPDATE attendance_records');
    expect(upd.length).toBe(1);
    expect(upd[0][1]).toEqual(['rec1', input().verifyTime]);
    const ev = calls(dsMock.manager.query, 'INSERT INTO attendance_events');
    expect(ev[0][1]).toEqual(expect.arrayContaining(['face_detected']));
  });

  it('AC-004 no-mapping: warn, 0 record, 0 event, không throw', async () => {
    dsMock.manager.query.mockImplementation(
      router({ mapping: [], mappingByCode: [] }),
    );
    await expect(service.onVerify(input())).resolves.toBeUndefined();
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_records').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_events').length,
    ).toBe(0);
  });

  it('AC-004b mapping thiếu bookingId → unmatched', async () => {
    dsMock.manager.query.mockImplementation(
      router({ mapping: [{ user_id: 'u1', metadata_json: {} }] }),
    );
    await service.onVerify(input());
    expect(calls(dsMock.manager.query, 'FROM meetings').length).toBe(0);
    // PWL-001: vẫn đối chiếu watchlist dù không gắn cuộc họp.
    expect(watchlistMock.checkPersonWatchlist).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ deviceId: expect.any(String) }),
    );
  });

  it('PWL-001: nhận diện ra user → gọi checkPersonWatchlist kèm device/room', async () => {
    dsMock.manager.query.mockImplementation(router());
    const evt = input();
    await service.onVerify(evt);
    expect(watchlistMock.checkPersonWatchlist).toHaveBeenCalledTimes(1);
    expect(watchlistMock.checkPersonWatchlist.mock.calls[0][1]).toEqual({
      deviceId: evt.deviceId,
      roomId: evt.roomId,
    });
  });

  it('đợt 1: onVerify KHÔNG chờ watchlist (check treo vẫn trả về ngay)', async () => {
    dsMock.manager.query.mockImplementation(router());
    watchlistMock.checkPersonWatchlist.mockReturnValue(new Promise(() => {}));
    await expect(service.onVerify(input())).resolves.toBeUndefined();
    expect(watchlistMock.checkPersonWatchlist).toHaveBeenCalledTimes(1);
  });

  it('PWL-001: không resolve được user → KHÔNG đối chiếu watchlist', async () => {
    dsMock.manager.query.mockImplementation(
      router({ mapping: [], mappingByCode: [] }),
    );
    await service.onVerify(input());
    expect(watchlistMock.checkPersonWatchlist).not.toHaveBeenCalled();
  });

  it('fallback theo person_name khi person_id không khớp', async () => {
    dsMock.manager.query.mockImplementation(
      router({
        mapping: [],
        mappingByCode: [{ user_id: 'u9', metadata_json: { bookingId: 'm9' } }],
        meeting: [openMeeting({ id: 'm9' })],
      }),
    );
    await service.onVerify(input({ personId: null }));
    const ins = calls(dsMock.manager.query, 'INSERT INTO attendance_records');
    expect(ins[0][1][0]).toBe('m9');
    expect(ins[0][1][1]).toBe('u9');
  });

  it('gate hiệu lực: query mapping kèm guard sync_status=synced + deleted_at IS NULL', async () => {
    dsMock.manager.query.mockImplementation(router());
    await service.onVerify(input());
    const q = calls(dsMock.manager.query, 'device_person_id = $2');
    expect(q.length).toBe(1);
    expect(String(q[0][0])).toContain("sync_status = 'synced'");
    expect(String(q[0][0])).toContain('deleted_at IS NULL');
  });

  it('mapping đã deleted (DB lọc còn rỗng) → unmatched → no record', async () => {
    // sau deprovision, mapping sync_status='deleted' → guard lọc ra [] → không resolve.
    dsMock.manager.query.mockImplementation(
      router({ mapping: [], mappingByCode: [] }),
    );
    await service.onVerify(input());
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_records').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_events').length,
    ).toBe(0);
  });

  it('AC-005 no-meeting: warn, 0 record, không throw', async () => {
    dsMock.manager.query.mockImplementation(router({ meeting: [] }));
    await expect(service.onVerify(input())).resolves.toBeUndefined();
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_records').length,
    ).toBe(0);
  });

  it('gate: verifyTime > end_time (họp đã hết giờ) → no record/update/event', async () => {
    dsMock.manager.query.mockImplementation(router());
    // verify 10:30 > end 10:00 → đóng.
    await service.onVerify(
      input({ verifyTime: new Date('2026-06-17T10:30:00.000Z') }),
    );
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_records').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'UPDATE attendance_records').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_events').length,
    ).toBe(0);
  });

  it('gate: status=completed → skip (dù verify trong khung giờ)', async () => {
    dsMock.manager.query.mockImplementation(
      router({ meeting: [openMeeting({ status: 'completed' })] }),
    );
    await service.onVerify(input()); // verify 09:00 trong khung nhưng status completed
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_records').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_events').length,
    ).toBe(0);
  });

  it('gate: actual_end_time sớm hơn → dùng actual_end để chặn', async () => {
    dsMock.manager.query.mockImplementation(
      router({
        meeting: [openMeeting({ actual_end_time: '2026-06-17T09:15:00.000Z' })],
      }),
    );
    // verify 09:30 > actual_end 09:15 (dù end_time=10:00) → đóng.
    await service.onVerify(
      input({ verifyTime: new Date('2026-06-17T09:30:00.000Z') }),
    );
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_records').length,
    ).toBe(0);
  });

  it('grace: system_configs lỗi → fallback env/default, không throw', async () => {
    dsMock.manager.query.mockImplementation((sql: string) => {
      if (sql.includes('FROM system_configs'))
        return Promise.reject(new Error('db down'));
      return router()(sql);
    });
    await expect(service.onVerify(input())).resolves.toBeUndefined();
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_records').length,
    ).toBe(1);
  });

  // ── DCO-001: nhánh OUT (check-out) ──
  const outRec = (over: any = {}) => [
    { id: 'rec1', check_in_time: START, check_out_time: null, ...over },
  ];
  const out = (over: any = {}) => input({ direction: 'out', ...over });

  it('OUT + đã check-in, ra trước end → check_out_time + left_early=true + event check_out', async () => {
    dsMock.manager.query.mockImplementation(router({ checkoutRec: outRec() }));
    await service.onVerify(
      out({ verifyTime: new Date('2026-06-17T09:30:00.000Z') }),
    );
    const upd = calls(dsMock.manager.query, 'UPDATE attendance_records');
    expect(upd.length).toBe(1);
    expect(upd[0][1][0]).toBe('rec1');
    expect(upd[0][1][2]).toBe(true); // left_early (09:30 < end 10:00)
    const ev = calls(dsMock.manager.query, 'INSERT INTO attendance_events');
    expect(ev.length).toBe(1);
    expect(String(ev[0][0])).toContain("'check_out'");
    expect(String(ev[0][0])).toContain("'camera'");
  });

  it('OUT ra ≥ end trong grace → left_early=false', async () => {
    dsMock.manager.query.mockImplementation(router({ checkoutRec: outRec() }));
    // end 10:00, grace 5 → 10:03 hợp lệ; left_early=false.
    await service.onVerify(
      out({ verifyTime: new Date('2026-06-17T10:03:00.000Z') }),
    );
    const upd = calls(dsMock.manager.query, 'UPDATE attendance_records');
    expect(upd.length).toBe(1);
    expect(upd[0][1][2]).toBe(false);
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_events').length,
    ).toBe(1);
  });

  it('OUT idempotent: ra MUỘN hơn check_out_time đã lưu → UPDATE + event mới', async () => {
    dsMock.manager.query.mockImplementation(
      router({
        checkoutRec: outRec({ check_out_time: '2026-06-17T09:30:00.000Z' }),
      }),
    );
    await service.onVerify(
      out({ verifyTime: new Date('2026-06-17T09:45:00.000Z') }),
    );
    expect(
      calls(dsMock.manager.query, 'UPDATE attendance_records').length,
    ).toBe(1);
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_events').length,
    ).toBe(1);
  });

  it('OUT idempotent-skip: ra SỚM hơn check_out_time đã lưu → KHÔNG update, KHÔNG event', async () => {
    dsMock.manager.query.mockImplementation(
      router({
        checkoutRec: outRec({ check_out_time: '2026-06-17T09:45:00.000Z' }),
      }),
    );
    await service.onVerify(
      out({ verifyTime: new Date('2026-06-17T09:30:00.000Z') }),
    );
    expect(
      calls(dsMock.manager.query, 'UPDATE attendance_records').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_events').length,
    ).toBe(0);
  });

  it('OUT chưa từng check-in (no record) → warn, 0 update/event', async () => {
    dsMock.manager.query.mockImplementation(router({ checkoutRec: [] }));
    await service.onVerify(out());
    expect(
      calls(dsMock.manager.query, 'UPDATE attendance_records').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'INSERT INTO attendance_events').length,
    ).toBe(0);
  });

  it('OUT record có check_in_time NULL → warn, 0 ghi', async () => {
    dsMock.manager.query.mockImplementation(
      router({ checkoutRec: outRec({ check_in_time: null }) }),
    );
    await service.onVerify(out());
    expect(
      calls(dsMock.manager.query, 'UPDATE attendance_records').length,
    ).toBe(0);
  });

  it('OUT status=cancelled → bỏ qua (không tra record)', async () => {
    dsMock.manager.query.mockImplementation(
      router({
        meeting: [openMeeting({ status: 'cancelled' })],
        checkoutRec: outRec(),
      }),
    );
    await service.onVerify(out());
    expect(
      calls(dsMock.manager.query, 'check_in_time, check_out_time').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'UPDATE attendance_records').length,
    ).toBe(0);
  });

  it('OUT verifyTime > end + grace → warn/skip', async () => {
    dsMock.manager.query.mockImplementation(router({ checkoutRec: outRec() }));
    // end 10:00 + grace 5 = 10:05; verify 10:30 > 10:05 → skip.
    await service.onVerify(
      out({ verifyTime: new Date('2026-06-17T10:30:00.000Z') }),
    );
    expect(
      calls(dsMock.manager.query, 'check_in_time, check_out_time').length,
    ).toBe(0);
    expect(
      calls(dsMock.manager.query, 'UPDATE attendance_records').length,
    ).toBe(0);
  });

  it('OUT mapping unmatched → no record', async () => {
    dsMock.manager.query.mockImplementation(
      router({ mapping: [], mappingByCode: [] }),
    );
    await service.onVerify(out());
    expect(
      calls(dsMock.manager.query, 'check_in_time, check_out_time').length,
    ).toBe(0);
  });
});
