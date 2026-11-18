import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service.js';
import { HgvisionCameraService } from './hgvision-camera.service.js';
import {
  HgvisionSnapshotService,
  SNAPSHOT_ENTITY,
  snapshotFileName,
} from './hgvision-snapshot.service.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('data'),
]);

const row = {
  id: '11111111-1111-1111-1111-111111111111',
  file_name: 'cong-chinh_20261118-090507.png',
  file_size_bytes: '12',
  storage_key: 'camera-snapshots/x.png',
  uploaded_by: 'u1',
  uploaded_at: new Date('2026-11-18T02:05:07Z'),
  metadata_json: {
    cameraName: 'Cong chinh',
    zoneId: 'z1',
    zoneName: 'Cổng chính',
  },
  captured_by_name: 'Bảo vệ A',
};

function setup(opts: { online?: boolean; grab?: jest.Mock } = {}) {
  const cameras = {
    liveSource: jest.fn().mockResolvedValue({
      upstream: '/live/abc/index.m3u8',
      online: opts.online ?? true,
      zone: { id: 'z1', name: 'Cổng chính' },
    }),
  };
  const storage = {
    saveFile: jest.fn().mockResolvedValue({
      storageKey: 'camera-snapshots/x.png',
      publicUrl: '',
      sizeBytes: PNG.length,
    }),
    getDriver: jest.fn().mockReturnValue('local'),
    getObjectStream: jest.fn().mockResolvedValue('STREAM'),
  };
  const query = jest.fn((sql: string) => {
    if (sql.startsWith('INSERT')) return Promise.resolve([{ id: row.id }]);
    return Promise.resolve([row]);
  });
  const config = { get: jest.fn().mockReturnValue('http://hg.local:8113/') };
  const grab = opts.grab ?? jest.fn().mockResolvedValue(PNG);
  const svc = new HgvisionSnapshotService(
    cameras as unknown as HgvisionCameraService,
    storage as unknown as StorageService,
    { query } as unknown as DataSource,
    config as unknown as ConfigService,
    grab,
  );
  return { svc, cameras, storage, query, grab };
}

describe('HgvisionSnapshotService', () => {
  it('chụp khung hình từ luồng live HGVision, lưu storage + media_files', async () => {
    const { svc, storage, query, grab } = setup();
    const snap = await svc.capture('Cong chinh', 'u1');
    expect(grab).toHaveBeenCalledWith(
      'http://hg.local:8113/live/abc/index.m3u8',
      expect.any(Number),
    );
    expect(storage.saveFile).toHaveBeenCalledWith(
      expect.objectContaining({ buffer: PNG, folder: 'camera-snapshots' }),
    );
    const insert = query.mock.calls.find(([sql]) =>
      String(sql).startsWith('INSERT'),
    ) as unknown[];
    const params = insert[1] as unknown[];
    expect(params).toContain(SNAPSHOT_ENTITY);
    expect(params).toContain('u1');
    expect(JSON.parse(params[params.length - 1] as string)).toMatchObject({
      cameraName: 'Cong chinh',
      zoneName: 'Cổng chính',
    });
    expect(snap).toMatchObject({
      id: row.id,
      cameraName: 'Cong chinh',
      zoneName: 'Cổng chính',
      capturedByName: 'Bảo vệ A',
      fileUrl: `/api/v1/hgvision/snapshots/${row.id}/file`,
    });
  });

  it('camera mất kết nối → 409, không gọi ffmpeg', async () => {
    const { svc, grab } = setup({ online: false });
    await expect(svc.capture('Cong chinh', 'u1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(grab).not.toHaveBeenCalled();
  });

  it('ffmpeg lỗi hoặc dữ liệu không phải PNG → 502, không lưu file', async () => {
    const failed = setup({
      grab: jest.fn().mockRejectedValue(new Error('FFMPEG_TIMEOUT')),
    });
    await expect(failed.svc.capture('Cong chinh', 'u1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    const junk = setup({
      grab: jest.fn().mockResolvedValue(Buffer.from('not a png')),
    });
    await expect(junk.svc.capture('Cong chinh', 'u1')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    expect(junk.storage.saveFile).not.toHaveBeenCalled();
  });

  it('danh sách giới hạn số dòng và lọc theo camera', async () => {
    const { svc, query } = setup();
    await svc.list({ camera: ' Cong chinh ', limit: 999 });
    expect(query.mock.calls[0][1]).toEqual([
      SNAPSHOT_ENTITY,
      null,
      'Cong chinh',
      100,
    ]);
  });

  it('tải file: id không phải ảnh chụp → 404', async () => {
    const { svc, query } = setup();
    query.mockResolvedValueOnce([]);
    await expect(svc.file(row.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.file(row.id)).resolves.toMatchObject({
      stream: 'STREAM',
      fileName: row.file_name,
      sizeBytes: 12,
    });
  });

  it('tên file bỏ dấu và gắn thời điểm chụp', () => {
    expect(
      snapshotFileName('Cổng 1 hướng vào', new Date(2026, 10, 18, 9, 5, 7)),
    ).toBe('cong-1-huong-vao_20261118-090507.png');
  });
});
