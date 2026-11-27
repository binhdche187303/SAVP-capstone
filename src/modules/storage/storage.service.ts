import { Injectable, Logger, OnModuleInit, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import type { Client as MinioClient } from 'minio';

export interface SaveFileOptions {
  /** Buffer hoặc nội dung file */
  buffer: Buffer;
  /** Tên file gốc (chỉ dùng để lấy extension) */
  originalName: string;
  /** Subfolder trong storage root (VD: 'recordings', 'avatars') */
  folder?: string;
  /** Key override — nếu không truyền sẽ auto-generate */
  storageKey?: string;
}

export interface SaveFileResult {
  storageKey: string;
  publicUrl: string;
  sizeBytes: number;
}

/**
 * StorageService — Quản lý file storage.
 *
 * Hiện tại: local adapter.
 * Tương lai: S3/MinIO adapter — chỉ cần implement interface tương tự.
 *
 * Mọi path đều resolve từ STORAGE_LOCAL_PATH (mặc định: ./uploads).
 * URL public được build từ STORAGE_PUBLIC_BASE_URL.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly storageDriver: string;
  private readonly localPath: string;
  private readonly publicBaseUrl: string;
  private readonly s3Bucket: string;
  private minioClient: MinioClient | null = null;

  constructor(private readonly configService: ConfigService) {
    this.storageDriver = this.configService.get<string>(
      'STORAGE_DRIVER',
      'local',
    );
    this.localPath = this.configService.get<string>(
      'STORAGE_LOCAL_PATH',
      './uploads',
    );
    this.publicBaseUrl = this.configService.get<string>(
      'STORAGE_PUBLIC_BASE_URL',
      'http://localhost:3000/uploads',
    );
    this.s3Bucket = this.configService.get<string>('STORAGE_S3_BUCKET', '');
  }

  async onModuleInit(): Promise<void> {
    if (this.storageDriver === 'local') {
      this.ensureLocalDirExists();
    } else if (this.storageDriver === 's3') {
      await this.initMinioClient();
      await this.ensureBucketExists();
    }
    this.logger.log(
      `StorageService initialized — driver: ${this.storageDriver}`,
    );
  }

  /**
   * Khởi tạo MinIO/S3 client. Dynamic import để package `minio` không bị
   * load ở môi trường test/driver=local (tránh phá Jest nếu chưa cần dùng).
   */
  private async initMinioClient(): Promise<void> {
    const { Client } = await import('minio');
    // Bug #1 (2026-07-29): cùng lỗi parse endpoint như worker AI transcription
    // (minio-audio-loader.ts) — endPoint MinIO SDK yêu cầu phải là hostname
    // THUẦN, không kèm cổng. Bản cũ chỉ bóc "http://" mà không tách cổng nên
    // "http://localhost:9000" bị truyền nguyên "localhost:9000" cho endPoint.
    const raw =
      this.configService.get<string>('STORAGE_S3_ENDPOINT', 'localhost') ||
      'localhost';
    const useSSLFromProto = raw.startsWith('https://');
    const withoutProto = raw.replace(/^https?:\/\//, '');
    const [host, portInEndpoint] = withoutProto.split(':');
    this.minioClient = new Client({
      endPoint: host,
      port: Number(
        portInEndpoint ||
          this.configService.get<number>('STORAGE_S3_PORT', 9000),
      ),
      useSSL:
        useSSLFromProto ||
        this.configService.get<boolean>('STORAGE_S3_USE_SSL', false),
      accessKey: this.configService.get<string>('STORAGE_S3_ACCESS_KEY', ''),
      secretKey: this.configService.get<string>('STORAGE_S3_SECRET_KEY', ''),
    });
  }

  private async ensureBucketExists(): Promise<void> {
    if (!this.minioClient || !this.s3Bucket) return;
    try {
      const exists = await this.minioClient.bucketExists(this.s3Bucket);
      if (!exists) {
        await this.minioClient.makeBucket(
          this.s3Bucket,
          this.configService.get<string>('STORAGE_S3_REGION', 'us-east-1'),
        );
        this.logger.log(`Created MinIO bucket: ${this.s3Bucket}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      this.logger.warn(`Could not verify/create MinIO bucket: ${message}`);
    }
  }

  private static async streamToBuffer(
    stream: NodeJS.ReadableStream,
  ): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  /**
   * Tạo thư mục uploads nếu chưa có.
   */
  private ensureLocalDirExists(): void {
    const resolvedPath = path.resolve(this.localPath);
    if (!fs.existsSync(resolvedPath)) {
      fs.mkdirSync(resolvedPath, { recursive: true });
      this.logger.log(`Created local storage directory: ${resolvedPath}`);
    }
  }

  /**
   * Sinh storage key từ folder + filename.
   * Format: <folder>/<timestamp>-<random>.<ext>
   */
  getStorageKey(originalName: string, folder?: string): string {
    const ext = path.extname(originalName).toLowerCase();
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    const filename = `${timestamp}-${random}${ext}`;
    return folder ? `${folder}/${filename}` : filename;
  }

  /**
   * Lưu file vào storage.
   * Hiện tại: local filesystem.
   */
  async saveFile(options: SaveFileOptions): Promise<SaveFileResult> {
    const storageKey =
      options.storageKey ??
      this.getStorageKey(options.originalName, options.folder);

    if (this.storageDriver === 's3') {
      if (!this.minioClient) {
        throw new Error('MinIO client is not initialized.');
      }
      await this.minioClient.putObject(
        this.s3Bucket,
        storageKey,
        options.buffer,
        options.buffer.length,
      );
      return {
        storageKey,
        publicUrl: this.getPublicUrl(storageKey),
        sizeBytes: options.buffer.length,
      };
    }

    const resolvedPath = path.resolve(this.localPath, storageKey);
    const dir = path.dirname(resolvedPath);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, options.buffer);

    return {
      storageKey,
      publicUrl: this.getPublicUrl(storageKey),
      sizeBytes: options.buffer.length,
    };
  }

  /**
   * Xóa file khỏi storage.
   */
  async deleteFile(storageKey: string): Promise<void> {
    if (this.storageDriver === 's3') {
      if (!this.minioClient) {
        throw new Error('MinIO client is not initialized.');
      }
      await this.minioClient.removeObject(this.s3Bucket, storageKey);
      this.logger.log(`Deleted file (s3): ${storageKey}`);
      return;
    }

    const resolvedPath = path.resolve(this.localPath, storageKey);
    if (fs.existsSync(resolvedPath)) {
      fs.unlinkSync(resolvedPath);
      this.logger.log(`Deleted file: ${storageKey}`);
    } else {
      this.logger.warn(`File not found for deletion: ${storageKey}`);
    }
  }

  /**
   * Đọc bytes file local (FPE-001). SEC-03: chống path-traversal — resolved phải nằm
   * trong localPath; file thiếu → ném lỗi rõ.
   * Chỉ hỗ trợ driver local — dùng downloadFile() cho driver s3/MinIO.
   */
  getFile(storageKey: string): Buffer {
    if (this.storageDriver !== 'local') {
      throw new Error(
        `Storage driver "${this.storageDriver}" is not yet implemented.`,
      );
    }
    const base = path.resolve(this.localPath);
    const resolved = path.resolve(this.localPath, storageKey);
    if (!(resolved === base || resolved.startsWith(base + path.sep))) {
      throw new Error('Invalid storage key (path traversal).');
    }
    if (!fs.existsSync(resolved)) {
      // 404 thay vì 500: file đã bị xoá / chưa đồng bộ không phải sự cố máy chủ.
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tệp.',
        error: { code: 'FILE_NOT_FOUND', details: {} },
      });
    }
    return fs.readFileSync(resolved);
  }

  /**
   * Đọc bytes file — hỗ trợ cả driver local và s3/MinIO.
   */
  async downloadFile(storageKey: string): Promise<Buffer> {
    if (this.storageDriver === 's3') {
      if (!this.minioClient) {
        throw new Error('MinIO client is not initialized.');
      }
      const stream = await this.minioClient.getObject(
        this.s3Bucket,
        storageKey,
      );
      return StorageService.streamToBuffer(stream);
    }
    return this.getFile(storageKey);
  }

  /**
   * Kích thước object (bytes) — dùng cho Content-Length/Content-Range khi stream
   * playback từ s3/MinIO, nơi không có fs.statSync().
   */
  async getObjectSize(storageKey: string): Promise<number> {
    if (this.storageDriver !== 's3') {
      const base = path.resolve(this.localPath);
      const resolved = path.resolve(this.localPath, storageKey);
      if (!(resolved === base || resolved.startsWith(base + path.sep))) {
        throw new Error('Invalid storage key (path traversal).');
      }
      return fs.statSync(resolved).size;
    }
    if (!this.minioClient) {
      throw new Error('MinIO client is not initialized.');
    }
    const stat = await this.minioClient.statObject(this.s3Bucket, storageKey);
    return stat.size;
  }

  /**
   * Stream object — hỗ trợ byte range để phục vụ HTTP Range (video/audio seek).
   * `start`/`end` là chỉ số byte INCLUSIVE (đúng ngữ nghĩa header Range), trong khi
   * MinIO getPartialObject nhận (offset, length) nên phải quy đổi.
   * Bỏ trống cả hai = lấy toàn bộ object.
   */
  async getObjectStream(
    storageKey: string,
    start?: number,
    end?: number,
  ): Promise<NodeJS.ReadableStream> {
    if (this.storageDriver !== 's3') {
      const base = path.resolve(this.localPath);
      const resolved = path.resolve(this.localPath, storageKey);
      if (!(resolved === base || resolved.startsWith(base + path.sep))) {
        throw new Error('Invalid storage key (path traversal).');
      }
      return start === undefined
        ? fs.createReadStream(resolved)
        : fs.createReadStream(resolved, { start, end });
    }
    if (!this.minioClient) {
      throw new Error('MinIO client is not initialized.');
    }
    if (start === undefined) {
      return this.minioClient.getObject(this.s3Bucket, storageKey);
    }
    const length = (end ?? 0) - start + 1;
    return this.minioClient.getPartialObject(
      this.s3Bucket,
      storageKey,
      start,
      length,
    );
  }

  /**
   * Sinh presigned URL có thời hạn ngắn để truy cập object trên MinIO/S3.
   * Chỉ áp dụng cho driver s3 — không tạo public URL cho private bucket.
   */
  async getSignedStorageUrl(
    storageKey: string,
    ttlSeconds = 600,
  ): Promise<string> {
    if (this.storageDriver !== 's3') {
      throw new Error('getSignedStorageUrl chỉ hỗ trợ driver s3.');
    }
    if (!this.minioClient) {
      throw new Error('MinIO client is not initialized.');
    }
    return this.minioClient.presignedGetObject(
      this.s3Bucket,
      storageKey,
      ttlSeconds,
    );
  }

  /**
   * Build public URL từ storageKey.
   */
  getPublicUrl(storageKey: string): string {
    const base = this.publicBaseUrl.replace(/\/$/, '');
    return `${base}/${storageKey}`;
  }

  /**
   * Kiểm tra thư mục local storage có tồn tại và có thể ghi không.
   * Dùng cho health check.
   */
  checkLocalStorageAccess(): {
    accessible: boolean;
    path: string;
    error?: string;
  } {
    if (this.storageDriver !== 'local') {
      return { accessible: true, path: 'remote', error: undefined };
    }

    const resolvedPath = path.resolve(this.localPath);
    try {
      if (!fs.existsSync(resolvedPath)) {
        return {
          accessible: false,
          path: resolvedPath,
          error: 'Directory does not exist',
        };
      }
      fs.accessSync(resolvedPath, fs.constants.W_OK);
      return { accessible: true, path: resolvedPath };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return { accessible: false, path: resolvedPath, error: message };
    }
  }

  /**
   * Generate a signed download token (HMAC-SHA256) for a media file.
   * Token contains mediaFileId + expiry, signed with MEDIA_DOWNLOAD_TOKEN_SECRET.
   */
  generateSignedDownloadToken(
    mediaFileId: string,
    ttlSeconds?: number,
  ): { token: string; expiresAt: string } {
    const secret = this.configService.get<string>(
      'MEDIA_DOWNLOAD_TOKEN_SECRET',
      '',
    );
    if (!secret) {
      throw new Error('MEDIA_DOWNLOAD_TOKEN_SECRET is not configured');
    }
    const defaultTtl = this.configService.get<number>(
      'MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS',
      600,
    );
    const ttl = ttlSeconds ?? defaultTtl;
    const expiresAtEpochMs = Date.now() + ttl * 1000;
    const expiresAt = new Date(expiresAtEpochMs).toISOString();
    const payload = mediaFileId + '|' + expiresAtEpochMs;
    const hmac = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
    const token = Buffer.from(payload + '.' + hmac).toString('base64url');
    return { token, expiresAt };
  }

  /**
   * Verify a signed download token. Returns the mediaFileId if valid, null otherwise.
   */
  verifySignedDownloadToken(token: string): { mediaFileId: string } | null {
    const secret = this.configService.get<string>(
      'MEDIA_DOWNLOAD_TOKEN_SECRET',
      '',
    );
    if (!secret) return null;
    let decoded;
    try {
      decoded = Buffer.from(token, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    const lastDot = decoded.lastIndexOf('.');
    if (lastDot === -1) return null;
    const payload = decoded.slice(0, lastDot);
    const receivedHmac = decoded.slice(lastDot + 1);
    const expectedHmac = crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
    if (receivedHmac.length !== expectedHmac.length) return null;
    try {
      if (
        !crypto.timingSafeEqual(
          Buffer.from(receivedHmac, 'utf8'),
          Buffer.from(expectedHmac, 'utf8'),
        )
      )
        return null;
    } catch {
      return null;
    }
    const lastPipe = payload.lastIndexOf('|');
    if (lastPipe === -1) return null;
    const mediaFileId = payload.slice(0, lastPipe);
    const expiresAtEpochMs = parseInt(payload.slice(lastPipe + 1), 10);
    if (Date.now() > expiresAtEpochMs) return null;
    return { mediaFileId };
  }
  getDriver(): string {
    return this.storageDriver;
  }

  /** Bucket hiện tại (chỉ có ý nghĩa khi driver=s3, null nếu driver=local). */
  getBucketName(): string | null {
    return this.storageDriver === 's3' ? this.s3Bucket || null : null;
  }
}
