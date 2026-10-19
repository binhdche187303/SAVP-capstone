/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Readable } from 'stream';
import {
  FLOOR_PLANS_CONFIG_KEY,
  FloorPlanService,
} from './floor-plan.service.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const file = (overrides: Record<string, unknown> = {}) => ({
  buffer: PNG,
  mimetype: 'image/png',
  originalname: 'tang-1.png',
  size: PNG.length,
  ...overrides,
});

describe('FloorPlanService', () => {
  let service: FloorPlanService;
  let manager: any;
  let dataSource: any;
  let storage: any;
  let configRow: { id: string; config_json: Record<string, unknown> } | null;

  beforeEach(() => {
    configRow = null;
    manager = {
      query: jest.fn((sql: string) => {
        if (sql.includes('SELECT'))
          return Promise.resolve(configRow ? [configRow] : []);
        return Promise.resolve([]);
      }),
    };
    dataSource = {
      manager,
      query: jest.fn((sql: string) => manager.query(sql)),
      transaction: jest.fn((cb: (m: any) => Promise<unknown>) => cb(manager)),
    };
    storage = {
      saveFile: jest.fn(({ folder, originalName }) =>
        Promise.resolve({
          storageKey: `${folder}/new-${originalName}`,
          publicUrl: '',
          sizeBytes: 8,
        }),
      ),
      deleteFile: jest.fn().mockResolvedValue(undefined),
      getObjectStream: jest.fn().mockResolvedValue(Readable.from(['x'])),
    };
    service = new FloorPlanService(dataSource, storage);
  });

  const writtenJson = () => {
    const call = manager.query.mock.calls.find(([sql]: [string]) =>
      /^\s*(INSERT INTO system_configs|UPDATE system_configs)/.test(sql),
    );
    return JSON.parse(
      call[1].find((p: unknown) => typeof p === 'string' && p.startsWith('{')),
    );
  };

  describe('save', () => {
    it('lưu ảnh vào storage thư mục floor-plans và ghi cấu hình cho tầng', async () => {
      const r = await service.save(
        'admin',
        'Tòa A - Tầng 1',
        file(),
        1600,
        900,
      );

      expect(storage.saveFile).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'floor-plans', buffer: PNG }),
      );
      expect(r).toMatchObject({
        floorKey: 'Tòa A - Tầng 1',
        width: 1600,
        height: 900,
        mimeType: 'image/png',
      });
      const json = writtenJson();
      expect(json['Tòa A - Tầng 1']).toMatchObject({
        storageKey: 'floor-plans/new-tang-1.png',
        width: 1600,
        height: 900,
      });
    });

    it('giữ ảnh của các tầng khác, thay ảnh cũ cùng tầng và xoá file cũ', async () => {
      configRow = {
        id: 'cfg-1',
        config_json: {
          'Tòa A - Tầng 1': {
            storageKey: 'floor-plans/old.png',
            mimeType: 'image/png',
            width: 10,
            height: 10,
          },
          'Tòa B - Tầng 2': {
            storageKey: 'floor-plans/b2.png',
            mimeType: 'image/png',
            width: 10,
            height: 10,
          },
        },
      };

      await service.save(
        'admin',
        'Tòa A - Tầng 1',
        file({ buffer: JPG, mimetype: 'image/jpeg', originalname: 'a1.jpg' }),
        800,
        600,
      );

      const json = writtenJson();
      expect(Object.keys(json).sort()).toEqual([
        'Tòa A - Tầng 1',
        'Tòa B - Tầng 2',
      ]);
      expect(json['Tòa A - Tầng 1'].storageKey).toBe('floor-plans/new-a1.jpg');
      expect(storage.deleteFile).toHaveBeenCalledWith('floor-plans/old.png');
    });

    it('từ chối file không phải ảnh JPG/PNG/WEBP (kiểm tra cả nội dung file)', async () => {
      await expect(
        service.save(
          'admin',
          'T1',
          file({ mimetype: 'image/png', buffer: Buffer.from('%PDF-1.7') }),
          100,
          100,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.save(
          'admin',
          'T1',
          file({ mimetype: 'application/pdf' }),
          100,
          100,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(storage.saveFile).not.toHaveBeenCalled();
    });

    it('từ chối ảnh quá 10MB', async () => {
      await expect(
        service.save(
          'admin',
          'T1',
          file({ size: 10 * 1024 * 1024 + 1 }),
          100,
          100,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('từ chối thiếu tên tầng hoặc kích thước ảnh không hợp lệ', async () => {
      await expect(
        service.save('admin', '  ', file(), 100, 100),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.save('admin', 'T1', file(), 0, 100),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.save('admin', 'T1', file(), 100, Number.NaN),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  it('list: trả danh sách tầng đã có ảnh mặt bằng', async () => {
    configRow = {
      id: 'cfg-1',
      config_json: {
        'Tòa A - Tầng 1': {
          storageKey: 'k1',
          mimeType: 'image/png',
          width: 1600,
          height: 900,
          updatedAt: '2026-10-19T00:00:00.000Z',
        },
      },
    };

    const list = await service.list();

    expect(list).toEqual([
      {
        floorKey: 'Tòa A - Tầng 1',
        mimeType: 'image/png',
        width: 1600,
        height: 900,
        updatedAt: '2026-10-19T00:00:00.000Z',
      },
    ]);
    expect(manager.query.mock.calls[0][1]).toEqual([FLOOR_PLANS_CONFIG_KEY]);
  });

  describe('getImage', () => {
    it('tầng chưa có ảnh → 404', async () => {
      await expect(service.getImage('T9')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('trả stream ảnh từ storage kèm mime type', async () => {
      configRow = {
        id: 'cfg-1',
        config_json: {
          T1: { storageKey: 'k1', mimeType: 'image/png', width: 1, height: 1 },
        },
      };

      const r = await service.getImage('T1');

      expect(storage.getObjectStream).toHaveBeenCalledWith('k1');
      expect(r.mimeType).toBe('image/png');
    });
  });

  it('remove: xoá cấu hình của tầng và xoá file', async () => {
    configRow = {
      id: 'cfg-1',
      config_json: {
        T1: { storageKey: 'k1', mimeType: 'image/png', width: 1, height: 1 },
        T2: { storageKey: 'k2', mimeType: 'image/png', width: 1, height: 1 },
      },
    };

    await service.remove('admin', 'T1');

    expect(Object.keys(writtenJson())).toEqual(['T2']);
    expect(storage.deleteFile).toHaveBeenCalledWith('k1');
  });

  it('remove: tầng chưa có ảnh → 404', async () => {
    await expect(service.remove('admin', 'T9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
