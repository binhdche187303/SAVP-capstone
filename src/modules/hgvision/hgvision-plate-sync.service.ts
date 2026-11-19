import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { VehicleControlListEntity } from '../anpr/entities/vehicle-control-list.entity.js';
import {
  ControlListSyncHook,
  type ControlListSyncHandler,
} from '../anpr/services/control-list-sync.hook.js';
import { HGVISION_CLIENT } from './hgvision.constants.js';
import { HgvisionClient, HgvisionError } from './hgvision.client.js';

export type PlateSyncStatus = 'pending' | 'synced' | 'failed';

const ERROR_MAX = 255;

/**
 * HgvisionPlateSyncService — đẩy danh sách biển số kiểm soát SAVP sang HGVision.
 *
 * Một biển trên HGVision = gộp mọi dòng SAVP còn sống của biển đó:
 *  - còn ≥1 dòng active → có trên HGVision; is_blacklist = có dòng blocklist active.
 *  - không còn dòng active → xoá trên HGVision, NHƯNG chỉ khi biển do SAVP tạo
 *    (có dòng từng `hgvision_synced_at`, kể cả đã xoá mềm).
 * Biển có sẵn trên HGVision mà SAVP chưa từng tạo → KHÔNG ghi đè, KHÔNG xoá (báo failed).
 * Cờ HGVISION_WRITE_ENABLED=false → không gọi HGVision, đánh dấu `pending`.
 * Chỉ bật khi CAMERA_PROVIDER=hgvision.
 */
@Injectable()
export class HgvisionPlateSyncService
  implements ControlListSyncHandler, OnModuleInit
{
  private readonly logger = new Logger(HgvisionPlateSyncService.name);

  constructor(
    @Inject(HGVISION_CLIENT) private readonly client: HgvisionClient,
    @InjectRepository(VehicleControlListEntity)
    private readonly repo: Repository<VehicleControlListEntity>,
    private readonly hook: ControlListSyncHook,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('CAMERA_PROVIDER', 'ivss') !== 'hgvision') {
      return;
    }
    this.hook.register(this);
    this.logger.log(
      `Đồng bộ biển số SAVP → HGVision: ${this.client.writeEnabled ? 'BẬT ghi' : 'cờ ghi TẮT (đánh dấu pending)'}.`,
    );
  }

  async syncPlate(plateNumber: string): Promise<void> {
    const live = await this.repo.find({
      where: { plateNumber, deletedAt: IsNull() },
    });

    if (!this.client.writeEnabled) {
      await this.mark(plateNumber, 'pending', null);
      return;
    }

    const owned = await this.repo.exists({
      where: { plateNumber, hgvisionSyncedAt: Not(IsNull()) },
      withDeleted: true,
    });
    const active = live.filter((r) => r.active);

    try {
      if (active.length > 0) {
        const input = {
          ident: 'SAVP',
          lpInfor: describe(active),
          isBlacklist: active.some((r) => r.listType === 'blocklist'),
          visibleTo: 'all' as const,
        };
        if (owned) {
          try {
            await this.client.updatePlate(plateNumber, input);
          } catch (e) {
            if (!isNotFound(e)) throw e;
            // Bị xoá tay bên HGVision → tạo lại.
            await this.client.createPlate({
              licensePlate: plateNumber,
              ...input,
            });
          }
        } else {
          await this.client.createPlate({
            licensePlate: plateNumber,
            ...input,
          });
        }
        await this.mark(plateNumber, 'synced', null);
        return;
      }

      if (owned) {
        try {
          await this.client.deletePlate(plateNumber);
        } catch (e) {
          if (!isNotFound(e)) throw e;
        }
      }
      if (live.length > 0) await this.mark(plateNumber, 'synced', null);
    } catch (e) {
      const msg =
        !owned && active.length > 0 && isConflict(e)
          ? 'Biển đã có sẵn trên HGVision (không do SAVP tạo) — không ghi đè.'
          : errorText(e);
      this.logger.warn(`Đẩy biển ${plateNumber} sang HGVision lỗi: ${msg}`);
      await this.mark(plateNumber, 'failed', msg);
    }
  }

  private async mark(
    plateNumber: string,
    status: PlateSyncStatus,
    error: string | null,
  ): Promise<void> {
    await this.repo.update(
      { plateNumber, deletedAt: IsNull() },
      {
        hgvisionSyncStatus: status,
        hgvisionSyncError: error,
        ...(status === 'synced' ? { hgvisionSyncedAt: new Date() } : {}),
      },
    );
  }
}

function describe(rows: VehicleControlListEntity[]): string {
  const black = rows.find((r) => r.listType === 'blocklist');
  const main = black ?? rows[0];
  const label = black ? 'Danh sách đen' : 'Theo dõi';
  const text = `SAVP - ${label}${main.reason ? `: ${main.reason}` : ''}`;
  return text.slice(0, ERROR_MAX);
}

function isNotFound(e: unknown): boolean {
  return e instanceof HgvisionError && e.status === 404;
}

function isConflict(e: unknown): boolean {
  if (!(e instanceof HgvisionError)) return false;
  if (e.status === 409) return true;
  return (
    [400, 422].includes(e.status) &&
    /exist|duplicate|tồn tại|đã có/i.test(e.message)
  );
}

function errorText(e: unknown): string {
  const raw =
    e instanceof HgvisionError
      ? `${e.status ? `HTTP ${e.status}: ` : ''}${e.message}`
      : e instanceof Error
        ? e.message
        : String(e);
  // Phòng hờ: che token/credential nếu upstream lỡ trả về trong thông báo lỗi.
  return raw
    .replace(/Bearer\s+\S+/gi, 'Bearer ***')
    .replace(/\/\/[^@/\s]+@/g, '//***@')
    .slice(0, ERROR_MAX);
}
