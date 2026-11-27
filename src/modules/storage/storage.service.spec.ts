import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service.js';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

/**
 * Unit test cho StorageService.
 * Mock fs module — không đọc/ghi file thật.
 */

jest.mock('fs');
const mockFs = fs as jest.Mocked<typeof fs>;

describe('StorageService', () => {
  let service: StorageService;

  const mockConfigService = (overrides: Record<string, unknown> = {}) => ({
    get: jest.fn().mockImplementation((key: string, defaultValue?: unknown) => {
      const config: Record<string, unknown> = {
        STORAGE_DRIVER: 'local',
        STORAGE_LOCAL_PATH: './uploads',
        STORAGE_PUBLIC_BASE_URL: 'http://localhost:3000/uploads',
        ...overrides,
      };
      return config[key] ?? defaultValue;
    }),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Mock fs.existsSync để tránh tạo thư mục thật
    mockFs.existsSync.mockReturnValue(true);
    mockFs.accessSync.mockReturnValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: mockConfigService() },
      ],
    }).compile();

    service = module.get<StorageService>(StorageService);
    service.onModuleInit();
  });

  describe('getStorageKey()', () => {
    it('should generate key with extension and folder', () => {
      const key = service.getStorageKey('image.jpg', 'avatars');
      expect(key).toMatch(/^avatars\/\d+-[a-z0-9]+\.jpg$/);
    });

    it('should generate key without folder', () => {
      const key = service.getStorageKey('document.pdf');
      expect(key).toMatch(/^\d+-[a-z0-9]+\.pdf$/);
    });
  });

  describe('getPublicUrl()', () => {
    it('should return correct public URL', () => {
      const url = service.getPublicUrl('recordings/test-file.mp4');
      expect(url).toBe(
        'http://localhost:3000/uploads/recordings/test-file.mp4',
      );
    });

    it('should handle base URL with trailing slash', async () => {
      const module = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: mockConfigService({
              STORAGE_PUBLIC_BASE_URL: 'http://localhost:3000/uploads/',
            }),
          },
        ],
      }).compile();
      const svc = module.get<StorageService>(StorageService);
      const url = svc.getPublicUrl('test.jpg');
      expect(url).toBe('http://localhost:3000/uploads/test.jpg');
    });
  });

  describe('saveFile()', () => {
    it('should save file and return storageKey and publicUrl', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const buffer = Buffer.from('test content');
      const result = await service.saveFile({
        buffer,
        originalName: 'test.txt',
        folder: 'documents',
      });

      expect(result.storageKey).toMatch(/^documents\/\d+-[a-z0-9]+\.txt$/);
      expect(result.publicUrl).toContain('http://localhost:3000/uploads/');
      expect(result.sizeBytes).toBe(buffer.length);
      expect(mockFs.writeFileSync).toHaveBeenCalled();
    });

    it('should use provided storageKey when given', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.writeFileSync.mockReturnValue(undefined);

      const result = await service.saveFile({
        buffer: Buffer.from('content'),
        originalName: 'test.txt',
        storageKey: 'custom/key.txt',
      });

      expect(result.storageKey).toBe('custom/key.txt');
    });

    it('should throw if s3 driver used before MinIO client is initialized', async () => {
      const module = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: mockConfigService({ STORAGE_DRIVER: 's3' }),
          },
        ],
      }).compile();
      const svc = module.get<StorageService>(StorageService);
      // onModuleInit() (vốn khởi tạo minioClient) không được gọi trong test này.

      await expect(
        svc.saveFile({ buffer: Buffer.from('x'), originalName: 'x.txt' }),
      ).rejects.toThrow('MinIO client is not initialized');
    });
  });

  describe('deleteFile()', () => {
    it('should delete file if it exists', async () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.unlinkSync.mockReturnValue(undefined);

      await service.deleteFile('test/file.txt');
      expect(mockFs.unlinkSync).toHaveBeenCalled();
    });

    it('should not throw if file does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false);
      await expect(
        service.deleteFile('missing/file.txt'),
      ).resolves.not.toThrow();
    });
  });

  describe('checkLocalStorageAccess()', () => {
    it('should return accessible=true when directory exists and is writable', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.accessSync.mockReturnValue(undefined);

      const result = service.checkLocalStorageAccess();
      expect(result.accessible).toBe(true);
      expect(result.path).toContain(path.resolve('./uploads'));
    });

    it('should return accessible=false when directory does not exist', () => {
      mockFs.existsSync.mockReturnValue(false);

      const result = service.checkLocalStorageAccess();
      expect(result.accessible).toBe(false);
      expect(result.error).toContain('does not exist');
    });
  });

  describe('getDriver()', () => {
    it('should return the current storage driver', () => {
      expect(service.getDriver()).toBe('local');
    });
  });

  describe('getFile() (FPE-001)', () => {
    it('đọc bytes ok khi storageKey hợp lệ', () => {
      mockFs.existsSync.mockReturnValue(true);
      mockFs.readFileSync.mockReturnValue(Buffer.from('JPEGDATA'));
      const buf = service.getFile('face-profiles/abc.jpg');
      expect(buf.toString()).toBe('JPEGDATA');
    });

    it('SEC-03: path traversal → ném, KHÔNG đọc', () => {
      mockFs.readFileSync.mockClear();
      mockFs.existsSync.mockReturnValue(true);
      expect(() => service.getFile('../../../etc/passwd')).toThrow(
        /traversal/i,
      );
      expect(mockFs.readFileSync).not.toHaveBeenCalled();
    });

    it('file không tồn tại → ném', () => {
      mockFs.existsSync.mockReturnValue(false);
      // 404 (NotFoundException) thay vì Error thường → API trả 404 chứ không 500.
      expect(() => service.getFile('face-profiles/missing.jpg')).toThrow(
        NotFoundException,
      );
    });
  });

  describe('s3/MinIO driver (T-STORAGE-001)', () => {
    const buildS3Service = async (): Promise<{
      svc: StorageService;
      minioClient: {
        putObject: jest.Mock;
        getObject: jest.Mock;
        removeObject: jest.Mock;
        presignedGetObject: jest.Mock;
        bucketExists: jest.Mock;
        makeBucket: jest.Mock;
      };
    }> => {
      const module = await Test.createTestingModule({
        providers: [
          StorageService,
          {
            provide: ConfigService,
            useValue: mockConfigService({
              STORAGE_DRIVER: 's3',
              STORAGE_S3_BUCKET: 'recordings-test',
            }),
          },
        ],
      }).compile();
      const svc = module.get<StorageService>(StorageService);

      const minioClient = {
        putObject: jest.fn().mockResolvedValue(undefined),
        getObject: jest.fn(),
        removeObject: jest.fn().mockResolvedValue(undefined),
        presignedGetObject: jest.fn().mockResolvedValue('https://signed-url'),
        bucketExists: jest.fn().mockResolvedValue(true),
        makeBucket: jest.fn().mockResolvedValue(undefined),
      };
      // Bypass dynamic import('minio') thật — gán trực tiếp client đã mock,
      // tương đương trạng thái sau khi onModuleInit() chạy thành công.
      (svc as unknown as { minioClient: unknown }).minioClient = minioClient;

      return { svc, minioClient };
    };

    it('saveFile() gọi putObject với đúng bucket/key', async () => {
      const { svc, minioClient } = await buildS3Service();
      const result = await svc.saveFile({
        buffer: Buffer.from('audio-bytes'),
        originalName: 'meeting.wav',
        storageKey: 'recordings/meeting.wav',
      });

      expect(minioClient.putObject).toHaveBeenCalledWith(
        'recordings-test',
        'recordings/meeting.wav',
        expect.any(Buffer),
        'audio-bytes'.length,
      );
      expect(result.storageKey).toBe('recordings/meeting.wav');
    });

    it('downloadFile() đọc stream từ MinIO và trả về Buffer', async () => {
      const { svc, minioClient } = await buildS3Service();
      minioClient.getObject.mockResolvedValue(
        Readable.from([Buffer.from('hello '), Buffer.from('world')]),
      );

      const buf = await svc.downloadFile('recordings/meeting.wav');
      expect(buf.toString()).toBe('hello world');
      expect(minioClient.getObject).toHaveBeenCalledWith(
        'recordings-test',
        'recordings/meeting.wav',
      );
    });

    it('deleteFile() gọi removeObject', async () => {
      const { svc, minioClient } = await buildS3Service();
      await svc.deleteFile('recordings/meeting.wav');
      expect(minioClient.removeObject).toHaveBeenCalledWith(
        'recordings-test',
        'recordings/meeting.wav',
      );
    });

    it('getSignedStorageUrl() trả presigned URL có TTL', async () => {
      const { svc, minioClient } = await buildS3Service();
      const url = await svc.getSignedStorageUrl('recordings/meeting.wav', 300);
      expect(url).toBe('https://signed-url');
      expect(minioClient.presignedGetObject).toHaveBeenCalledWith(
        'recordings-test',
        'recordings/meeting.wav',
        300,
      );
    });

    it('getSignedStorageUrl() throw khi driver không phải s3', async () => {
      await expect(service.getSignedStorageUrl('any-key')).rejects.toThrow(
        /chỉ hỗ trợ driver s3/,
      );
    });
  });
});
