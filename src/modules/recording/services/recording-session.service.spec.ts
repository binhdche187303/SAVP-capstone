/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import {
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from '@nestjs/common';
import { RecordingSessionService } from './recording-session.service.js';
import { RecordingProcessManager } from './recording-process-manager.js';
import { StorageService } from '../../storage/storage.service.js';
import { encryptSecret } from '../../../common/utils/secret-crypto.util.js';
import { redactUrl } from '../utils/ffmpeg.util.js';
import * as ffmpegUtil from '../utils/ffmpeg.util.js';
import { EventEmitter } from 'events';
import * as fs from 'fs';

jest.mock('fs');
const fsMock = fs as jest.Mocked<typeof fs>;

// REC-005: mock ffprobe (default null → fallback wall-clock; tests đặt Once khi cần probe).
jest.mock('../utils/ffprobe.util.js', () => ({
  probeMedia: jest.fn().mockResolvedValue(null),
  probeAudioDuration: jest.fn().mockResolvedValue(60),
}));
import { probeMedia } from '../utils/ffprobe.util.js';
const probeMock = probeMedia as jest.Mock;

describe('RecordingSessionService (REC-002)', () => {
  let service: RecordingSessionService;
  let dataSourceMock: any;
  let managerMock: any;
  let savedSession: any;

  const baseDevice = (over: any = {}) => ({
    id: 'cam-1',
    device_type: 'ip_camera',
    metadata_json: {
      rtsp_config: {
        rtsp_protocol: 'rtsp',
        rtsp_host: '10.0.0.5',
        rtsp_port: 554,
        rtsp_path: '/live',
      },
    },
    ...over,
  });

  // query() router theo SQL
  // [FIX 2026-08-11, R10] mặc định host=[{id:'u1'}] (userId 'u1' dùng khắp file này được coi
  // là host/organizer) để MỌI test hiện có (không liên quan ownership) tiếp tục qua được
  // assertHostOrAdmin() không đổi hành vi; test ownership riêng override host/role.
  const makeQuery =
    (opts: {
      meeting?: any[];
      device?: any[];
      active?: any[];
      cfg?: any[];
      host?: any[];
      role?: any[];
    }) =>
    (sql: string) => {
      if (sql.includes('FROM meetings'))
        return Promise.resolve(opts.meeting ?? [{ id: 'm1' }]);
      if (sql.includes('FROM iot_devices'))
        return Promise.resolve(opts.device ?? [baseDevice()]);
      if (sql.includes('FROM recording_sessions'))
        return Promise.resolve(opts.active ?? []);
      if (sql.includes('FROM recording_configs'))
        return Promise.resolve(opts.cfg ?? []);
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve(opts.host ?? [{ id: 'u1' }]);
      if (sql.includes('FROM user_roles'))
        return Promise.resolve(opts.role ?? []);
      return Promise.resolve([]);
    };

  beforeEach(async () => {
    process.env.RTSP_CRED_KEY = 'test_rtsp_cred_key_0123456789_abcdefghij';
    savedSession = null;
    dataSourceMock = {
      manager: {
        query: jest.fn(),
        create: jest.fn((_e: unknown, obj: any) => obj),
        save: jest.fn(async (_e: unknown, obj: any) => {
          savedSession = obj;
          return obj;
        }),
      },
    };
    // [FIX 2026-08-11, R1] startVideo() giờ bọc bước 4+8 trong dataSource.transaction() —
    // mock gọi callback với CHÍNH dataSourceMock.manager (mirror vehicle-resolve.service.spec.ts)
    // để mọi test hiện có (đã mock dataSourceMock.manager.query/create/save) tiếp tục chạy đúng.
    dataSourceMock.transaction = jest.fn((cb: (m: any) => unknown) =>
      cb(dataSourceMock.manager),
    );
    managerMock = {
      start: jest.fn(),
      has: jest.fn().mockReturnValue(true),
      get: jest.fn().mockReturnValue({ exitCode: null }),
      stop: jest.fn().mockResolvedValue('exited'),
    };
    // REC-007 probeStart: mặc định 'capturing' (file>0 ở vòng đầu).
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 1024 } as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: managerMock },
        { provide: StorageService, useValue: { saveFile: jest.fn() } },
      ],
    }).compile();
    service = module.get(RecordingSessionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('happy: 201 → session recording, spawn gọi', async () => {
    dataSourceMock.manager.query.mockImplementation(makeQuery({}));

    const r = await service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1');

    expect(r.status).toBe('recording');
    expect(r.sessionType).toBe('video');
    expect(r.cameraDeviceId).toBe('cam-1');
    expect(managerMock.start).toHaveBeenCalledTimes(1);
    expect(savedSession.status).toBe('recording');
    expect(savedSession.storageProvider).toBe('local');
    expect(savedSession.startedBy).toBe('u1');
  });

  it('404: meeting không tồn tại', async () => {
    dataSourceMock.manager.query.mockImplementation(makeQuery({ meeting: [] }));
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('400: device không phải ip_camera', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ device: [baseDevice({ device_type: 'microphone' })] }),
    );
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('400: thiếu rtsp_config', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ device: [baseDevice({ metadata_json: {} })] }),
    );
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ).rejects.toThrow(BadRequestException);
  });

  it('409: đã có session active', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ active: [{ id: 'sess-x' }] }),
    );
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ).rejects.toThrow(ConflictException);
  });

  it('REC-007 exited: ffmpeg thoát trong probe → 500 RECORDING_START_FAILED', async () => {
    dataSourceMock.manager.query.mockImplementation(makeQuery({}));
    managerMock.has.mockReturnValue(false); // process rơi khỏi Map → 'exited'
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1'),
    ).rejects.toThrow(InternalServerErrorException);
    expect(managerMock.stop).not.toHaveBeenCalled();
  });

  it('REC-007 no_data: camera tắt (file 0 hết cửa sổ) → 502 RECORDING_NO_VIDEO + failed', async () => {
    dataSourceMock.manager.query.mockImplementation(makeQuery({}));
    fsMock.existsSync.mockReturnValue(false); // không bao giờ capturing
    jest.useFakeTimers();
    const p = service
      .startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1')
      .catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(6000);
    const err = (await p) as BadGatewayException;
    jest.useRealTimers();

    expect(err).toBeInstanceOf(BadGatewayException);
    expect(err.getResponse()).toMatchObject({ code: 'RECORDING_NO_VIDEO' });
    // SEC: message KHÔNG lộ url/cred.
    expect(JSON.stringify(err.getResponse())).not.toContain('rtsp://');
    expect(managerMock.stop).toHaveBeenCalledTimes(1);
  });

  it('SEC: URL/password KHÔNG xuất hiện trong session lưu', async () => {
    // device có username + password mã hóa
    const enc = encryptSecret('super-secret-pass');
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({
        device: [
          baseDevice({
            metadata_json: {
              rtsp_config: {
                rtsp_protocol: 'rtsp',
                rtsp_host: '10.0.0.5',
                rtsp_port: 554,
                rtsp_path: '/live',
                rtsp_username: 'admin',
                rtsp_password_encrypted: enc,
              },
            },
          }),
        ],
      }),
    );

    await service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1');

    const dump = JSON.stringify(savedSession);
    expect(dump).not.toContain('super-secret-pass');
    expect(dump).not.toContain('admin:'); // không có user:pass trong record
    // url được truyền cho manager.start (đối số) có cred, nhưng KHÔNG lưu vào DB
    const passedUrl = managerMock.start.mock.calls[0][1];
    expect(passedUrl).toContain('super-secret-pass'); // chỉ trong bộ nhớ truyền spawn
    expect(savedSession.storagePath).not.toContain('super-secret-pass');
  });

  it('SEC: password ký tự đặc biệt → URL encode + redactUrl che sạch', async () => {
    const raw = 'p@ss:w/rd#1';
    const encoded = 'p%40ss%3Aw%2Frd%231';
    const enc = encryptSecret(raw);
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({
        device: [
          baseDevice({
            metadata_json: {
              rtsp_config: {
                rtsp_protocol: 'rtsp',
                rtsp_host: '10.0.0.5',
                rtsp_port: 554,
                rtsp_path: '/live',
                rtsp_username: 'admin',
                rtsp_password_encrypted: enc,
              },
            },
          }),
        ],
      }),
    );

    await service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1');

    const passedUrl = managerMock.start.mock.calls[0][1] as string;
    // password truyền cho ffmpeg ở dạng ĐÃ encode, KHÔNG còn dạng thô
    expect(passedUrl).toContain(encoded);
    expect(passedUrl).not.toContain(raw);
    expect(passedUrl).not.toContain('p@ss:w/rd');
    // redactUrl che sạch — không còn mảnh password nào
    const redacted = redactUrl(passedUrl);
    expect(redacted).toContain('//***@');
    expect(redacted).not.toContain(encoded);
    expect(redacted).not.toContain('p%40ss');
    expect(redacted).not.toContain(raw);
  });

  // ─── R10: ownership (Host/Organizer meeting hoặc Admin) ───
  it('[R10] host của meeting → 201 (không phải admin)', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ host: [{ id: 'u1' }], role: [] }),
    );
    const r = await service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u1');
    expect(r.status).toBe('recording');
  });

  it('[R10] không phải host và không phải admin → 403 PERMISSION_DENIED', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ host: [], role: [{ role_code: 'EMPLOYEE' }] }),
    );
    await expect(
      service.startVideo('m1', { cameraDeviceId: 'cam-1' }, 'u2'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('[R10] SYSTEM_ADMIN không phải host → vẫn 201 (bypass)', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ host: [], role: [{ role_code: 'SYSTEM_ADMIN' }] }),
    );
    const r = await service.startVideo(
      'm1',
      { cameraDeviceId: 'cam-1' },
      'admin1',
    );
    expect(r.status).toBe('recording');
  });
});

// ─── REC-003: stopVideo ───
describe('RecordingSessionService.stopVideo (REC-003)', () => {
  let service: RecordingSessionService;
  let dataSourceMock: any;
  let managerMock: any;
  let qr: any;

  const baseSession = (over: any = {}) => ({
    id: 'sess-1',
    meeting_id: 'm1',
    status: 'recording',
    storage_path: '/rec/sess-1.mp4',
    started_at: new Date(Date.now() - 60000).toISOString(),
    paused_duration_seconds: 0,
    metadata_json: null,
    ...over,
  });

  // manager.query router: SELECT recording_sessions → session; UPDATE → [].
  // [FIX 2026-08-11, R10] mặc định host=[{id:'u1'}] (userId 'u1' dùng khắp block này coi
  // như host/organizer) để MỌI test hiện có tiếp tục qua assertHostOrAdmin() không đổi
  // hành vi; test ownership riêng override qua opts.host/opts.role.
  const selectReturns =
    (session: any[] | null, opts: { host?: any[]; role?: any[] } = {}) =>
    (sql: string): Promise<any[]> => {
      if (sql.includes('SELECT') && sql.includes('recording_sessions'))
        return Promise.resolve(session ?? []);
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve(opts.host ?? [{ id: 'u1' }]);
      if (sql.includes('FROM user_roles'))
        return Promise.resolve(opts.role ?? []);
      return Promise.resolve([]);
    };

  const fakeReadStream = () => {
    const s = new EventEmitter();
    process.nextTick(() => s.emit('end'));
    return s as any;
  };

  beforeEach(async () => {
    qr = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSourceMock = {
      manager: { query: jest.fn() },
      createQueryRunner: jest.fn(() => qr),
    };
    // [FIX 2026-08-11, R8] stopVideo() giờ bọc TOÀN BỘ thân hàm trong dataSource.transaction()
    // (khoá theo sessionId) — mock gọi callback với dataSourceMock.manager, giữ nguyên mọi
    // test hiện có (đã mock dataSourceMock.manager.query qua selectReturns()).
    dataSourceMock.transaction = jest.fn((cb: (m: any) => unknown) =>
      cb(dataSourceMock.manager),
    );
    managerMock = {
      has: jest.fn().mockReturnValue(true),
      stop: jest.fn().mockResolvedValue('exited'),
    };

    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 1024 } as any);
    fsMock.createReadStream.mockImplementation(() => fakeReadStream());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: managerMock },
        { provide: StorageService, useValue: { saveFile: jest.fn() } },
      ],
    }).compile();
    service = module.get(RecordingSessionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('happy: 200 stopped + INSERT media_files + UPDATE session', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );
    qr.query
      .mockResolvedValueOnce([{ id: 'media-1' }]) // INSERT RETURNING id
      .mockResolvedValueOnce(undefined); // UPDATE session

    const r = await service.stopVideo('m1', 'sess-1', 'u1');

    expect(r.status).toBe('stopped');
    expect(r.mediaFileId).toBe('media-1');
    expect(r.fileSizeBytes).toBe('1024');
    expect(r.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(r.captured).toBe(true); // REC-007
    expect(managerMock.stop).toHaveBeenCalledWith('sess-1');
    expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
    expect(qr.query).toHaveBeenCalledTimes(2);
    // INSERT đúng cột video/mp4/local
    const insertParams = qr.query.mock.calls[0][1];
    expect(insertParams).toEqual(
      expect.arrayContaining(['video', 'video/mp4', 'local']),
    );
  });

  it('404: session không tồn tại', async () => {
    dataSourceMock.manager.query.mockImplementation(selectReturns([]));
    await expect(service.stopVideo('m1', 'sess-1', 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404: meeting_id không khớp', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession({ meeting_id: 'other' })]),
    );
    await expect(service.stopVideo('m1', 'sess-1', 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('409: session không active (đã stopped)', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession({ status: 'stopped' })]),
    );
    await expect(service.stopVideo('m1', 'sess-1', 'u1')).rejects.toThrow(
      ConflictException,
    );
  });

  it('orphan: manager.has=false → vẫn stopped + metadata orphan_stop', async () => {
    managerMock.has.mockReturnValue(false);
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );
    qr.query
      .mockResolvedValueOnce([{ id: 'media-1' }])
      .mockResolvedValueOnce(undefined);

    const r = await service.stopVideo('m1', 'sess-1', 'u1');

    expect(r.status).toBe('stopped');
    expect(managerMock.stop).not.toHaveBeenCalled();
    // UPDATE (call thứ 2) chứa metadata_json có orphan_stop
    const updateParams = qr.query.mock.calls[1][1];
    const metaJson = updateParams.find(
      (p: unknown) => typeof p === 'string' && p.includes('orphan_stop'),
    );
    expect(metaJson).toBeDefined();
  });

  it('empty file: size 0 → stopped, KHÔNG media_files, mediaFileId null', async () => {
    fsMock.existsSync.mockReturnValue(false);
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );

    const r = await service.stopVideo('m1', 'sess-1', 'u1');

    expect(r.status).toBe('stopped');
    expect(r.mediaFileId).toBeNull();
    expect(r.fileSizeBytes).toBe('0');
    expect(r.captured).toBe(false); // REC-007
    expect(dataSourceMock.createQueryRunner).not.toHaveBeenCalled();
    // UPDATE empty-file đi qua manager.query với error_message='empty file'
    const calls = dataSourceMock.manager.query.mock.calls;
    const updateCall = calls.find((c: any[]) =>
      String(c[0]).includes('UPDATE recording_sessions'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual(expect.arrayContaining(['empty file']));
  });

  it('rollback: INSERT lỗi → 500 RECORDING_STOP_FAILED', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );
    qr.query.mockRejectedValueOnce(new Error('db insert failed'));

    await expect(service.stopVideo('m1', 'sess-1', 'u1')).rejects.toThrow(
      InternalServerErrorException,
    );
    expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(qr.release).toHaveBeenCalledTimes(1);
  });

  // ─── R10: ownership (Host/Organizer meeting hoặc Admin) ───
  it('[R10] host của meeting → 200 (không phải admin)', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()], { host: [{ id: 'u1' }], role: [] }),
    );
    qr.query
      .mockResolvedValueOnce([{ id: 'media-1' }])
      .mockResolvedValueOnce(undefined);
    const r = await service.stopVideo('m1', 'sess-1', 'u1');
    expect(r.status).toBe('stopped');
  });

  it('[R10] không phải host và không phải admin → 403 PERMISSION_DENIED', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()], {
        host: [],
        role: [{ role_code: 'EMPLOYEE' }],
      }),
    );
    await expect(service.stopVideo('m1', 'sess-1', 'u2')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('[R10] SYSTEM_ADMIN không phải host → vẫn 200 (bypass)', async () => {
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()], {
        host: [],
        role: [{ role_code: 'SYSTEM_ADMIN' }],
      }),
    );
    qr.query
      .mockResolvedValueOnce([{ id: 'media-1' }])
      .mockResolvedValueOnce(undefined);
    const r = await service.stopVideo('m1', 'sess-1', 'admin1');
    expect(r.status).toBe('stopped');
  });

  // ─── REC-005: ffprobe metadata ───
  it('REC-005 probe OK → duration ffprobe + metadata_json.probe', async () => {
    probeMock.mockResolvedValueOnce({
      durationSeconds: 120,
      width: 1920,
      height: 1080,
      videoCodec: 'h264',
      fps: 25,
      bitrate: 4000000,
    });
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );
    qr.query
      .mockResolvedValueOnce([{ id: 'media-1' }])
      .mockResolvedValueOnce(undefined);

    const r = await service.stopVideo('m1', 'sess-1', 'u1');

    expect(r.durationSeconds).toBe(120); // ffprobe, không phải wall-clock
    const insertParams = qr.query.mock.calls[0][1];
    const mediaMeta = insertParams[insertParams.length - 1] as string; // metadata_json $12
    expect(mediaMeta).toContain('probe');
    expect(mediaMeta).toContain('h264');
    expect(mediaMeta).toContain('ffprobe');
  });

  it('REC-005 probe null → fallback wall-clock + metadata_json KHÔNG có probe', async () => {
    probeMock.mockResolvedValueOnce(null);
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );
    qr.query
      .mockResolvedValueOnce([{ id: 'media-1' }])
      .mockResolvedValueOnce(undefined);

    await service.stopVideo('m1', 'sess-1', 'u1');

    const insertParams = qr.query.mock.calls[0][1];
    const mediaMeta = insertParams[insertParams.length - 1] as string;
    expect(mediaMeta).not.toContain('probe');
  });

  it('REC-005 merge: orphan_stop + probe cùng tồn tại (không đè)', async () => {
    managerMock.has.mockReturnValue(false); // orphan → metadata orphan_stop
    probeMock.mockResolvedValueOnce({
      durationSeconds: 90,
      width: 1280,
      height: 720,
      videoCodec: 'h264',
      fps: 30,
      bitrate: 2000000,
    });
    dataSourceMock.manager.query.mockImplementation(
      selectReturns([baseSession()]),
    );
    qr.query
      .mockResolvedValueOnce([{ id: 'media-1' }])
      .mockResolvedValueOnce(undefined);

    await service.stopVideo('m1', 'sess-1', 'u1');

    const insertParams = qr.query.mock.calls[0][1];
    const mediaMeta = insertParams[insertParams.length - 1] as string;
    expect(mediaMeta).toContain('orphan_stop');
    expect(mediaMeta).toContain('probe');
    // session UPDATE ($7) giữ metadata cũ — KHÔNG có probe
    const updateParams = qr.query.mock.calls[1][1];
    const sessionMeta = updateParams.find(
      (p: unknown) => typeof p === 'string' && p.includes('orphan_stop'),
    ) as string;
    expect(sessionMeta).not.toContain('probe');
  });
});

// ─── REC-004: getStatus ───
describe('RecordingSessionService.getStatus (REC-004)', () => {
  let service: RecordingSessionService;
  let dataSourceMock: any;
  let managerMock: any;

  const baseRow = (over: any = {}) => ({
    id: 'sess-1',
    meeting_id: 'm1',
    session_type: 'video',
    status: 'recording',
    started_at: new Date(Date.now() - 30000).toISOString(),
    stopped_at: null,
    paused_duration_seconds: 0,
    storage_path: '/rec/sess-1.mp4',
    file_size_bytes: null,
    duration_seconds: null,
    error_message: null,
    ...over,
  });

  beforeEach(async () => {
    dataSourceMock = { manager: { query: jest.fn() } };
    managerMock = { has: jest.fn().mockReturnValue(true) };
    fsMock.existsSync.mockReturnValue(true);
    fsMock.statSync.mockReturnValue({ size: 2048 } as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: managerMock },
        { provide: StorageService, useValue: { saveFile: jest.fn() } },
      ],
    }).compile();
    service = module.get(RecordingSessionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('live: durationSeconds wall-clock + fileSizeBytes từ fs.stat', async () => {
    dataSourceMock.manager.query.mockResolvedValue([baseRow()]);
    const r = await service.getStatus('m1', 'sess-1');
    expect(r.live).toBe(true);
    expect(r.durationSeconds).toBeGreaterThanOrEqual(0);
    expect(r.fileSizeBytes).toBe('2048');
    expect(r.hasProcessHandle).toBe(true);
    expect(r.captured).toBe(true); // file hiện > 0
    expect(r.errorMessage).toBeNull();
  });

  it('REC-007: failed surface errorMessage + captured=false', async () => {
    managerMock.has.mockReturnValue(false);
    dataSourceMock.manager.query.mockResolvedValue([
      baseRow({
        status: 'failed',
        stopped_at: new Date().toISOString(),
        file_size_bytes: '0',
        error_message: 'no video data received from camera',
      }),
    ]);
    const r = await service.getStatus('m1', 'sess-1');
    expect(r.errorMessage).toBe('no video data received from camera');
    expect(r.captured).toBe(false);
  });

  it('stopped: trả duration/size từ DB (không đọc fs)', async () => {
    managerMock.has.mockReturnValue(false);
    dataSourceMock.manager.query.mockResolvedValue([
      baseRow({
        status: 'stopped',
        stopped_at: new Date().toISOString(),
        duration_seconds: 120,
        file_size_bytes: '4096',
      }),
    ]);
    const r = await service.getStatus('m1', 'sess-1');
    expect(r.live).toBe(false);
    expect(r.durationSeconds).toBe(120);
    expect(r.fileSizeBytes).toBe('4096');
    expect(fsMock.statSync).not.toHaveBeenCalled();
  });

  it('404: session không tồn tại', async () => {
    dataSourceMock.manager.query.mockResolvedValue([]);
    await expect(service.getStatus('m1', 'sess-1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('404: meeting mismatch', async () => {
    dataSourceMock.manager.query.mockResolvedValue([
      baseRow({ meeting_id: 'other' }),
    ]);
    await expect(service.getStatus('m1', 'sess-1')).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('RecordingSessionService.uploadAudioForTranscription', () => {
  let service: RecordingSessionService;
  let dataSourceMock: any;
  let storageMock: any;
  let qr: any;

  const goodFile = () => ({
    buffer: Buffer.from('fake-m4a-bytes'),
    originalname: 'meeting.m4a',
    mimetype: 'audio/mp4',
    size: 14,
  });

  // query() router theo SQL — meeting tồn tại + user là host theo mặc định.
  const makeQuery =
    (opts: { meeting?: any[]; host?: any[]; roles?: any[] }) =>
    (sql: string) => {
      if (sql.includes('FROM meetings'))
        return Promise.resolve(opts.meeting ?? [{ id: 'm1' }]);
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve(opts.host ?? [{ id: 'mp-1' }]);
      if (sql.includes('FROM user_roles'))
        return Promise.resolve(opts.roles ?? []);
      return Promise.resolve([]);
    };

  beforeEach(async () => {
    qr = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue([{ id: 'media-1' }]),
      manager: {
        create: jest.fn((_e: unknown, obj: any) => obj),
        save: jest.fn().mockResolvedValue(undefined),
      },
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
    };
    dataSourceMock = {
      manager: { query: jest.fn().mockImplementation(makeQuery({})) },
      createQueryRunner: jest.fn(() => qr),
    };
    storageMock = {
      saveFile: jest.fn().mockResolvedValue({
        storageKey: 'recordings/m1/audio.m4a',
        publicUrl: 'http://localhost:3000/uploads/recordings/m1/audio.m4a',
        sizeBytes: 14,
      }),
      getDriver: jest.fn().mockReturnValue('s3'),
      getBucketName: jest.fn().mockReturnValue('capstone-media'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: {} },
        { provide: StorageService, useValue: storageMock },
      ],
    }).compile();
    service = module.get(RecordingSessionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('happy: host upload audio hợp lệ → tạo session + media_files qua MinIO', async () => {
    const result = await service.uploadAudioForTranscription(
      'm1',
      goodFile(),
      'u1',
    );

    expect(result.mediaFileId).toBe('media-1');
    expect(result.storageKey).toBe('recordings/m1/audio.m4a');
    expect(storageMock.saveFile).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'recordings/m1' }),
    );
    expect(qr.manager.save).toHaveBeenCalled();
    const insertParams = qr.query.mock.calls[0][1];
    expect(insertParams).toEqual(
      expect.arrayContaining(['audio', 's3', 'capstone-media']),
    );
    expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it('404: meeting không tồn tại', async () => {
    dataSourceMock.manager.query.mockImplementation(makeQuery({ meeting: [] }));
    await expect(
      service.uploadAudioForTranscription('m1', goodFile(), 'u1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('403: không phải host và không phải admin', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ host: [], roles: [{ role_code: 'INTERNAL_USER' }] }),
    );
    await expect(
      service.uploadAudioForTranscription('m1', goodFile(), 'u1'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('admin (không phải host) vẫn upload được', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ host: [], roles: [{ role_code: 'SYSTEM_ADMIN' }] }),
    );
    const result = await service.uploadAudioForTranscription(
      'm1',
      goodFile(),
      'u1',
    );
    expect(result.mediaFileId).toBe('media-1');
  });

  it('400: định dạng file không được hỗ trợ', async () => {
    await expect(
      service.uploadAudioForTranscription(
        'm1',
        { ...goodFile(), originalname: 'notes.txt' },
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('400: file rỗng', async () => {
    await expect(
      service.uploadAudioForTranscription(
        'm1',
        { ...goodFile(), buffer: Buffer.alloc(0) },
        'u1',
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('lỗi DB → rollback + 500 AUDIO_UPLOAD_FAILED', async () => {
    qr.query.mockRejectedValue(new Error('db insert failed'));
    await expect(
      service.uploadAudioForTranscription('m1', goodFile(), 'u1'),
    ).rejects.toThrow(InternalServerErrorException);
    expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
  });

  // BUG-15b (2026-08-06): FE (StationRecorder) nối thô nhiều Blob chunk MediaRecorder
  // → .webm thiếu Cues/Duration đúng → browser tua sai + probe duration ra null.
  // Remux (-c copy) sửa tận gốc lúc upload, best-effort, chỉ áp dụng cho .webm.
  describe('remux .webm (tua audio chính xác)', () => {
    const webmFile = () => ({
      buffer: Buffer.from('raw-fragmented-webm-bytes'),
      originalname: 'station_recording.webm',
      mimetype: 'audio/webm',
      size: 26,
    });

    const fakeFfmpegProc = (opts: { code?: number; error?: Error } = {}) => {
      const emitter = new EventEmitter() as any;
      emitter.kill = jest.fn();
      process.nextTick(() => {
        if (opts.error) emitter.emit('error', opts.error);
        else emitter.emit('close', opts.code ?? 0);
      });
      return emitter;
    };

    afterEach(() => jest.restoreAllMocks());

    it('remux thành công → lưu buffer đã remux (khác buffer gốc), size/checksum theo buffer mới', async () => {
      const remuxed = Buffer.from('fixed-webm-with-cues');
      jest
        .spyOn(ffmpegUtil, 'spawnFfmpegRemux')
        .mockImplementation(() => fakeFfmpegProc({ code: 0 }));
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(remuxed);

      const result = await service.uploadAudioForTranscription(
        'm1',
        webmFile(),
        'u1',
      );

      expect(result.mediaFileId).toBe('media-1');
      expect(storageMock.saveFile).toHaveBeenCalledWith(
        expect.objectContaining({ buffer: remuxed }),
      );
      const insertParams = qr.query.mock.calls[0][1];
      expect(insertParams[9]).toBe(String(remuxed.length)); // file_size_bytes
    });

    it('remux thất bại (exit code khác 0) → fallback dùng buffer gốc, upload vẫn thành công', async () => {
      jest
        .spyOn(ffmpegUtil, 'spawnFfmpegRemux')
        .mockImplementation(() => fakeFfmpegProc({ code: 1 }));

      const original = webmFile();
      const result = await service.uploadAudioForTranscription(
        'm1',
        original,
        'u1',
      );

      expect(result.mediaFileId).toBe('media-1');
      expect(storageMock.saveFile).toHaveBeenCalledWith(
        expect.objectContaining({ buffer: original.buffer }),
      );
    });

    it('remux ném lỗi spawn → fallback dùng buffer gốc, không chặn upload', async () => {
      jest
        .spyOn(ffmpegUtil, 'spawnFfmpegRemux')
        .mockImplementation(() =>
          fakeFfmpegProc({ error: new Error('ENOENT: ffmpeg not found') }),
        );

      const original = webmFile();
      const result = await service.uploadAudioForTranscription(
        'm1',
        original,
        'u1',
      );

      expect(result.mediaFileId).toBe('media-1');
      expect(storageMock.saveFile).toHaveBeenCalledWith(
        expect.objectContaining({ buffer: original.buffer }),
      );
    });

    it('file .m4a (không phải .webm) → KHÔNG gọi remux', async () => {
      const remuxSpy = jest.spyOn(ffmpegUtil, 'spawnFfmpegRemux');

      await service.uploadAudioForTranscription('m1', goodFile(), 'u1');

      expect(remuxSpy).not.toHaveBeenCalled();
    });
  });
});

describe('RecordingSessionService.createAudioSession', () => {
  let service: RecordingSessionService;
  let dataSourceMock: any;
  let savedSession: any;

  // query() router theo SQL — meeting tồn tại + user là host theo mặc định
  // (mirror pattern của describe uploadAudioForTranscription ở trên).
  const makeQuery =
    (opts: { meeting?: any[]; host?: any[]; roles?: any[] }) =>
    (sql: string) => {
      if (sql.includes('FROM meetings'))
        return Promise.resolve(opts.meeting ?? [{ id: 'm1' }]);
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve(opts.host ?? [{ id: 'mp-1' }]);
      if (sql.includes('FROM user_roles'))
        return Promise.resolve(opts.roles ?? []);
      return Promise.resolve([]);
    };

  beforeEach(async () => {
    savedSession = null;
    dataSourceMock = {
      manager: {
        query: jest.fn().mockImplementation(makeQuery({})),
        create: jest.fn((_e: unknown, obj: any) => obj),
        save: jest.fn(async (_e: unknown, obj: any) => {
          savedSession = obj;
          return obj;
        }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: {} },
        { provide: StorageService, useValue: { saveFile: jest.fn() } },
      ],
    }).compile();
    service = module.get(RecordingSessionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('happy: host tạo audio session rỗng → status=starting, không có file', async () => {
    const result = await service.createAudioSession('m1', 'u1', {});

    expect(result.sessionType).toBe('audio');
    expect(result.status).toBe('starting');
    expect(typeof result.recordingSessionId).toBe('string');
    expect(savedSession.sessionType).toBe('audio');
    expect(savedSession.sourceType).toBe('manual_upload');
    expect(savedSession.status).toBe('starting');
    expect(savedSession.startedBy).toBe('u1');
    expect(savedSession.metadataJson).toBeNull();
  });

  it('happy: notes được lưu vào metadataJson', async () => {
    await service.createAudioSession('m1', 'u1', { notes: 'ghi chu test' });
    expect(savedSession.metadataJson).toEqual({ notes: 'ghi chu test' });
  });

  it('404: meeting không tồn tại', async () => {
    dataSourceMock.manager.query.mockImplementation(makeQuery({ meeting: [] }));
    await expect(service.createAudioSession('m1', 'u1', {})).rejects.toThrow(
      NotFoundException,
    );
  });

  it('403: không phải host và không phải admin', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ host: [], roles: [{ role_code: 'INTERNAL_USER' }] }),
    );
    await expect(service.createAudioSession('m1', 'u1', {})).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('admin (không phải host) vẫn tạo được', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ host: [], roles: [{ role_code: 'SYSTEM_ADMIN' }] }),
    );
    const result = await service.createAudioSession('m1', 'u1', {});
    expect(result.status).toBe('starting');
  });
});

describe('RecordingSessionService.listRecordingSessions', () => {
  let service: RecordingSessionService;
  let dataSourceMock: any;

  const sessionRows = [
    {
      id: 'sess-2',
      session_type: 'audio',
      source_type: 'manual_upload',
      status: 'starting',
      started_at: new Date('2026-07-11T08:00:00Z'),
      stopped_at: null,
    },
    {
      id: 'sess-1',
      session_type: 'video',
      source_type: 'ip_camera',
      status: 'stopped',
      started_at: new Date('2026-07-11T07:00:00Z'),
      stopped_at: new Date('2026-07-11T07:10:00Z'),
    },
  ];

  // query() router theo SQL — meeting tồn tại + user là participant theo mặc định.
  const makeQuery =
    (opts: {
      meeting?: any[];
      participant?: any[];
      roles?: any[];
      sessions?: any[];
    }) =>
    (sql: string) => {
      if (sql.includes('FROM meetings'))
        return Promise.resolve(opts.meeting ?? [{ id: 'm1' }]);
      if (sql.includes('FROM meeting_participants'))
        return Promise.resolve(opts.participant ?? [{ id: 'mp-1' }]);
      if (sql.includes('FROM user_roles'))
        return Promise.resolve(opts.roles ?? []);
      if (sql.includes('FROM recording_sessions'))
        return Promise.resolve(opts.sessions ?? sessionRows);
      return Promise.resolve([]);
    };

  beforeEach(async () => {
    dataSourceMock = {
      manager: { query: jest.fn().mockImplementation(makeQuery({})) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RecordingSessionService,
        { provide: DataSource, useValue: dataSourceMock },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, d?: unknown) => d },
        },
        { provide: RecordingProcessManager, useValue: {} },
        { provide: StorageService, useValue: {} },
      ],
    }).compile();
    service = module.get(RecordingSessionService);
  });

  afterEach(() => jest.clearAllMocks());

  it('happy: participant xem được danh sách session, mới nhất trước', async () => {
    const result = await service.listRecordingSessions('m1', 'u1');
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      mediaFiles: [],
      recordingSessionId: 'sess-2',
      sessionType: 'audio',
      sourceType: 'manual_upload',
      status: 'starting',
      startedAt: sessionRows[0].started_at,
      stoppedAt: null,
    });
  });

  it('404: meeting không tồn tại', async () => {
    dataSourceMock.manager.query.mockImplementation(makeQuery({ meeting: [] }));
    await expect(service.listRecordingSessions('m1', 'u1')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('403: không phải participant và không phải admin', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ participant: [], roles: [{ role_code: 'EMPLOYEE' }] }),
    );
    await expect(service.listRecordingSessions('m1', 'u1')).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('admin (không phải participant) vẫn xem được', async () => {
    dataSourceMock.manager.query.mockImplementation(
      makeQuery({ participant: [], roles: [{ role_code: 'BUSINESS_ADMIN' }] }),
    );
    const result = await service.listRecordingSessions('m1', 'u1');
    expect(result).toHaveLength(2);
  });
});
