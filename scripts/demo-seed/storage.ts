import * as fs from 'fs';
import * as path from 'path';

/**
 * Lưu/xoá file ảnh demo giống StorageService của BE (đọc cùng biến .env: STORAGE_DRIVER,
 * STORAGE_LOCAL_PATH, STORAGE_S3_*). Mọi key nằm dưới DEMO_FOLDER để dễ nhận ra.
 */

export const DEMO_FOLDER = 'demo-seed-snapshots';

const driver = () => (process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local');
const localPath = () => process.env.STORAGE_LOCAL_PATH || './uploads';
const bucket = () => process.env.STORAGE_S3_BUCKET || '';

type Minio = {
  putObject(b: string, k: string, buf: Buffer, size: number): Promise<unknown>;
  removeObject(b: string, k: string): Promise<void>;
};
let minio: Minio | null = null;

async function s3(): Promise<Minio> {
  if (minio) return minio;
  const { Client } = await import('minio');
  // Cùng cách tách endpoint như StorageService.initMinioClient()
  const raw = process.env.STORAGE_S3_ENDPOINT || 'localhost';
  const [host, port] = raw.replace(/^https?:\/\//, '').split(':');
  minio = new Client({
    endPoint: host,
    port: Number(port || process.env.STORAGE_S3_PORT || 9000),
    useSSL:
      raw.startsWith('https://') || process.env.STORAGE_S3_USE_SSL === 'true',
    accessKey: process.env.STORAGE_S3_ACCESS_KEY || '',
    secretKey: process.env.STORAGE_S3_SECRET_KEY || '',
  });
  return minio;
}

export const storageProvider = driver;

export async function saveDemoFile(key: string, buf: Buffer): Promise<void> {
  if (driver() === 's3') {
    await (await s3()).putObject(bucket(), key, buf, buf.length);
    return;
  }
  const file = path.resolve(localPath(), key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

export async function deleteDemoFile(key: string): Promise<void> {
  if (driver() === 's3') {
    await (await s3()).removeObject(bucket(), key);
    return;
  }
  fs.rmSync(path.resolve(localPath(), key), { force: true });
}

/** Storage local: xoá luôn thư mục ảnh demo (đã rỗng sau khi xoá từng file). */
export function removeDemoFolder(): void {
  if (driver() === 'local')
    fs.rmSync(path.resolve(localPath(), DEMO_FOLDER), {
      recursive: true,
      force: true,
    });
}
