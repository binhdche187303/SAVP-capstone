import {
  HgvisionCameraImportService,
  zoneForCode,
} from './hgvision-camera-import.service.js';

describe('HgvisionCameraImportService', () => {
  const row = (code: string, ip: string) => ({
    code,
    ip,
    username: 'admin',
    password: 'x',
  });

  const make = (existingId: string | null = null) => {
    const ds = {
      query: jest.fn((sql: string) => {
        if (sql.includes('FROM iot_devices'))
          return Promise.resolve(existingId ? [{ id: existingId }] : []);
        if (sql.includes('FROM zones')) return Promise.resolve([]);
        if (sql.includes('INSERT INTO zones'))
          return Promise.resolve([{ id: 'z1' }]);
        return Promise.resolve([]);
      }),
    };
    const cameras = {
      listCameras: jest.fn().mockResolvedValue([{ name: 'G-2' }]),
      createCamera: jest.fn().mockResolvedValue({ name: 'x', h264: 'ok' }),
    };
    const svc = new HgvisionCameraImportService(ds as never, cameras as never);
    return { svc, ds, cameras };
  };

  it('ánh xạ tiền tố mã → khu vực', () => {
    expect(zoneForCode('G-1')?.code).toBe('A1_G');
    expect(zoneForCode('T1-6')?.code).toBe('A1_L1');
    expect(zoneForCode('T2-1')?.code).toBe('A1_L2');
    expect(zoneForCode('HT-2')?.code).toBe('A2_L1');
    expect(zoneForCode('B1-1')?.code).toBe('B1_G');
    expect(zoneForCode('Gate2A-3')?.code).toBe('GATE_2A');
    expect(zoneForCode('Gate2-3')?.code).toBe('GATE_2');
    expect(zoneForCode('X-1')).toBeNull();
  });

  it('dryRun không ghi DB, báo lỗi theo dòng', async () => {
    const { svc, ds, cameras } = make();
    const r = await svc.import({
      rows: [
        row('G-1', '10.43.31.222'),
        row('ABC', '10.43.31.1'),
        row('G-3', '999.1.1.1'),
        row('G-1', '10.43.31.9'),
      ],
    });
    expect(r.rows.map((x) => x.action)).toEqual([
      'create',
      'error',
      'error',
      'error',
    ]);
    expect(
      ds.query.mock.calls.every(([sql]) => !/INSERT|UPDATE/.test(sql)),
    ).toBe(true);
    expect(cameras.createCamera).not.toHaveBeenCalled();
  });

  it('trùng mã/IP → cập nhật thiết bị cũ', async () => {
    const { svc, ds } = make('dev-1');
    const r = await svc.import({
      rows: [row('G-1', '10.43.31.222')],
      dryRun: false,
    });
    expect(r.rows[0].action).toBe('update');
    expect(
      ds.query.mock.calls.some(([sql]) => sql.includes('UPDATE iot_devices')),
    ).toBe(true);
  });

  it('đẩy HGVision: bỏ qua camera đã có, lỗi HGVision vẫn giữ thiết bị SAVP', async () => {
    const { svc, cameras } = make();
    cameras.createCamera.mockRejectedValueOnce(new Error('onvif'));
    const r = await svc.import({
      rows: [row('G-1', '10.43.31.222'), row('G-2', '10.43.31.223')],
      dryRun: false,
      pushToHg: true,
    });
    expect(r.rows[0]).toMatchObject({ action: 'create', hg: 'failed' });
    expect(r.rows[1]).toMatchObject({ action: 'create', hg: 'exists' });
    expect(cameras.createCamera).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'G-1',
        protocol: 'ONVIF',
        group: 'Khối A1 – Tầng trệt',
      }),
    );
  });
});
