import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { StorageService } from '../../storage/storage.service.js';

/** system_configs.config_json: { [floorKey]: FloorPlanEntry }. */
export const FLOOR_PLANS_CONFIG_KEY = 'camera_layout.floor_plans';
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_DIMENSION = 20000;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

interface FloorPlanEntry {
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  updatedAt?: string;
}

export interface FloorPlanInfo {
  floorKey: string;
  mimeType: string;
  width: number;
  height: number;
  updatedAt?: string;
}

export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/** Kiểm tra chữ ký file thật (không tin mimetype trình duyệt gửi lên). */
const hasImageSignature = (b: Buffer): boolean =>
  (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) || // JPEG
  (b.length >= 4 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47) || // PNG
  (b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP');

const badRequest = (code: string, message: string) =>
  new BadRequestException({ code, message });

/**
 * 2.2.4 — Ảnh mặt bằng (bản vẽ) cho từng tầng trên Sơ đồ lắp đặt camera.
 * File lưu qua StorageService (local/S3), thông tin tầng → file lưu ở system_configs
 * [camera_layout.floor_plans] nên không cần bảng/migration mới. Vị trí camera vẫn lưu
 * ở metadata_json.layout (toạ độ theo hệ 1000 × chiều cao ảnh của FE).
 */
@Injectable()
export class FloorPlanService {
  private readonly logger = new Logger(FloorPlanService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storageService: StorageService,
  ) {}

  async list(): Promise<FloorPlanInfo[]> {
    const plans = await this.readPlans(this.dataSource.manager);
    return Object.entries(plans).map(([floorKey, p]) => ({
      floorKey,
      mimeType: p.mimeType,
      width: p.width,
      height: p.height,
      updatedAt: p.updatedAt,
    }));
  }

  async getImage(
    floorKey: string,
  ): Promise<{ stream: NodeJS.ReadableStream; mimeType: string }> {
    const plan = (await this.readPlans(this.dataSource.manager))[floorKey];
    if (!plan) throw this.notFound();
    return {
      stream: await this.storageService.getObjectStream(plan.storageKey),
      mimeType: plan.mimeType,
    };
  }

  async save(
    userId: string | null,
    floorKey: string,
    file: UploadedImage | undefined,
    width: number,
    height: number,
  ): Promise<FloorPlanInfo> {
    const key = (floorKey ?? '').trim();
    if (!key) throw badRequest('FLOOR_KEY_REQUIRED', 'Thiếu tên tầng.');
    if (!file?.buffer?.length) {
      throw badRequest(
        'FLOOR_PLAN_FILE_REQUIRED',
        'Vui lòng chọn ảnh mặt bằng.',
      );
    }
    if (
      !ALLOWED_MIME.includes(file.mimetype) ||
      !hasImageSignature(file.buffer)
    ) {
      throw badRequest(
        'FLOOR_PLAN_FILE_TYPE_INVALID',
        'Ảnh mặt bằng phải là JPG, PNG hoặc WEBP.',
      );
    }
    if (file.size > MAX_BYTES) {
      throw badRequest(
        'FLOOR_PLAN_FILE_TOO_LARGE',
        'Ảnh mặt bằng tối đa 10MB.',
      );
    }
    const validDim = (n: number) =>
      Number.isInteger(n) && n > 0 && n <= MAX_DIMENSION;
    if (!validDim(width) || !validDim(height)) {
      throw badRequest(
        'FLOOR_PLAN_SIZE_INVALID',
        'Kích thước ảnh mặt bằng không hợp lệ.',
      );
    }

    const saved = await this.storageService.saveFile({
      buffer: file.buffer,
      originalName: file.originalname,
      folder: 'floor-plans',
    });
    const entry: FloorPlanEntry = {
      storageKey: saved.storageKey,
      mimeType: file.mimetype,
      width,
      height,
      updatedAt: new Date().toISOString(),
    };

    let previousKey: string | undefined;
    await this.dataSource.transaction(async (manager) => {
      const plans = await this.readPlans(manager, true);
      previousKey = plans[key]?.storageKey;
      await this.writePlans(manager, { ...plans, [key]: entry }, userId);
    });
    await this.audit(userId, 'configure_floor_plan', {
      floor_key: key,
      storage_key: saved.storageKey,
    });
    if (previousKey && previousKey !== saved.storageKey) {
      await this.deleteFileSafe(previousKey);
    }
    return {
      floorKey: key,
      mimeType: entry.mimeType,
      width,
      height,
      updatedAt: entry.updatedAt,
    };
  }

  async remove(userId: string | null, floorKey: string): Promise<void> {
    let removedKey: string | undefined;
    await this.dataSource.transaction(async (manager) => {
      const plans = await this.readPlans(manager, true);
      if (!plans[floorKey]) throw this.notFound();
      removedKey = plans[floorKey].storageKey;
      const rest = { ...plans };
      delete rest[floorKey];
      await this.writePlans(manager, rest, userId);
    });
    await this.audit(userId, 'remove_floor_plan', { floor_key: floorKey });
    if (removedKey) await this.deleteFileSafe(removedKey);
  }

  private async readPlans(
    manager: EntityManager,
    forUpdate = false,
  ): Promise<Record<string, FloorPlanEntry>> {
    const rows: { id: string; config_json: Record<string, unknown> | null }[] =
      await manager.query(
        `SELECT id, config_json FROM system_configs
         WHERE config_key = $1 ORDER BY updated_at DESC LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
        [FLOOR_PLANS_CONFIG_KEY],
      );
    return (rows[0]?.config_json ?? {}) as Record<string, FloorPlanEntry>;
  }

  private async writePlans(
    manager: EntityManager,
    plans: Record<string, FloorPlanEntry>,
    userId: string | null,
  ): Promise<void> {
    const json = JSON.stringify(plans);
    const rows: { id: string }[] = await manager.query(
      `SELECT id FROM system_configs WHERE config_key = $1 ORDER BY updated_at DESC LIMIT 1`,
      [FLOOR_PLANS_CONFIG_KEY],
    );
    if (rows[0]) {
      await manager.query(
        `UPDATE system_configs
         SET config_json = $2::jsonb, version_no = version_no + 1, updated_by = $3, updated_at = now()
         WHERE id = $1`,
        [rows[0].id, json, userId],
      );
      return;
    }
    await manager.query(
      `INSERT INTO system_configs
         (config_key, config_value, config_json, value_type, config_group,
          description, is_sensitive, is_active, version_no, updated_by)
       VALUES ($1, NULL, $2::jsonb, 'json', 'iot', $3, false, true, 1, $4)`,
      [
        FLOOR_PLANS_CONFIG_KEY,
        json,
        'Ảnh mặt bằng theo tầng cho Sơ đồ lắp đặt camera',
        userId,
      ],
    );
  }

  private async audit(
    userId: string | null,
    actionType: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.dataSource.query(
      `INSERT INTO audit_logs (user_id, action_type, entity_type, severity, metadata_json)
       VALUES ($1, $2, 'system_configs', 'info', $3::jsonb)`,
      [userId, actionType, JSON.stringify(metadata)],
    );
  }

  private async deleteFileSafe(storageKey: string): Promise<void> {
    try {
      await this.storageService.deleteFile(storageKey);
    } catch (e) {
      this.logger.warn(
        `Không xoá được ảnh mặt bằng cũ ${storageKey}: ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'FLOOR_PLAN_NOT_FOUND',
      message: 'Tầng này chưa có ảnh mặt bằng.',
    });
  }
}
