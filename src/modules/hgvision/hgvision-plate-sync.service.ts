import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { VehicleControlListEntity } from '../anpr/entities/vehicle-control-list.entity.js';
import { VehicleRegistrationEntity } from '../anpr/entities/vehicle-registration.entity.js';
import {
  ControlListSyncHook,
  type ControlListSyncHandler,
} from '../anpr/services/control-list-sync.hook.js';
import { HGVISION_CLIENT } from './hgvision.constants.js';
import { HgvisionClient, HgvisionError } from './hgvision.client.js';

/**
 * - pending: cờ ghi tắt; synced: khớp HGVision; failed: lỗi đẩy;
 * - mismatch: đối soát thấy bên HGVision bị sửa tay (KHÔNG ghi đè, chỉ báo);
 * - missing: đối soát thấy bị xoá bên HGVision nhưng chưa khôi phục (cờ ghi tắt / quá ngưỡng).
 */
export type PlateSyncStatus =
  | 'pending'
  | 'synced'
  | 'failed'
  | 'mismatch'
  | 'missing';

/** Dữ liệu SAVP muốn có trên HGVision cho 1 biển (null = không nên có). */
export interface ExpectedPlate {
  ident: string;
  lpInfor: string;
  isBlacklist: boolean;
  visibleTo: 'all';
}

/** Tính trạng thái mong muốn từ các dòng SAVP còn sống của 1 biển. */
export function expectedPlate(
  live: VehicleControlListEntity[],
  reg: VehicleRegistrationEntity | null,
): ExpectedPlate | null {
  const active = live.filter((r) => r.active);
  const regActive = reg?.status === 'active';
  if (active.length === 0 && !regActive) return null;
  return {
    ident: ownerIdent(reg),
    lpInfor: describe(active, regActive ? reg : null),
    isBlacklist: active.some((r) => r.listType === 'blocklist'),
    visibleTo: 'all',
  };
}

const ERROR_MAX = 255;

/**
 * HgvisionPlateSyncService — đẩy biển số SAVP sang HGVision.
 *
 * Một biển trên HGVision = gộp mọi dòng SAVP còn sống của biển đó, gồm danh sách kiểm soát
 * (vehicle_control_list) và xe đăng ký (vehicle_registrations — Phương tiện cá nhân /
 * Đăng ký xe nhân viên):
 *  - còn dòng kiểm soát active HOẶC xe đăng ký status=active → có trên HGVision;
 *    is_blacklist = có dòng blocklist active (danh sách đen do admin đặt luôn thắng),
 *    xe chỉ đăng ký → Bình thường (is_blacklist=0).
 *  - Chủ phương tiện (ident) = họ tên + mã NV/SV của tài khoản đăng ký xe; không có → 'SAVP'.
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
    @InjectRepository(VehicleRegistrationEntity)
    private readonly regRepo: Repository<VehicleRegistrationEntity>,
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
    const reg = await this.regRepo.findOne({
      where: { plateNumber, deletedAt: IsNull() },
      relations: { user: true },
    });

    if (!this.client.writeEnabled) {
      await this.mark(plateNumber, 'pending', null);
      return;
    }

    const owned =
      (await this.repo.exists({
        where: { plateNumber, hgvisionSyncedAt: Not(IsNull()) },
        withDeleted: true,
      })) ||
      (await this.regRepo.exists({
        where: { plateNumber, hgvisionSyncedAt: Not(IsNull()) },
        withDeleted: true,
      }));
    const input = expectedPlate(live, reg);
    const present = input !== null;

    try {
      if (input) {
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
      if (live.length > 0 || reg) await this.mark(plateNumber, 'synced', null);
    } catch (e) {
      const msg =
        !owned && present && isConflict(e)
          ? 'Biển đã có sẵn trên HGVision (không do SAVP tạo) — không ghi đè.'
          : errorText(e);
      this.logger.warn(`Đẩy biển ${plateNumber} sang HGVision lỗi: ${msg}`);
      await this.mark(plateNumber, 'failed', msg);
    }
  }

  /** Ghi trạng thái đồng bộ cho mọi dòng còn sống của biển (cả 2 bảng). */
  async mark(
    plateNumber: string,
    status: PlateSyncStatus,
    error: string | null,
  ): Promise<void> {
    const patch = {
      hgvisionSyncStatus: status,
      hgvisionSyncError: error?.slice(0, ERROR_MAX) ?? null,
      ...(status === 'synced' ? { hgvisionSyncedAt: new Date() } : {}),
    };
    const where = { plateNumber, deletedAt: IsNull() };
    await this.repo.update(where, patch);
    await this.regRepo.update(where, patch);
  }
}

/** Chủ phương tiện trên HGVision: "Họ tên - Mã" của tài khoản đăng ký xe, không có → 'SAVP'. */
function ownerIdent(reg: VehicleRegistrationEntity | null): string {
  const name = reg?.user?.fullName?.trim();
  if (!name) return 'SAVP';
  const code = reg?.user?.employeeCode?.trim();
  return (code ? `${name} - ${code}` : name).slice(0, ERROR_MAX);
}

function describe(
  rows: VehicleControlListEntity[],
  reg: VehicleRegistrationEntity | null,
): string {
  if (rows.length === 0) {
    const type = vehicleTypeLabel(reg?.vehicleType);
    return `SAVP - Xe đăng ký${type ? ` (${type})` : ''}`.slice(0, ERROR_MAX);
  }
  const black = rows.find((r) => r.listType === 'blocklist');
  const main = black ?? rows[0];
  const label = black ? 'Danh sách đen' : 'Theo dõi';
  const text = `SAVP - ${label}${main.reason ? `: ${main.reason}` : ''}`;
  return text.slice(0, ERROR_MAX);
}

const VEHICLE_TYPE_LABEL: Record<string, string> = {
  car: 'Ô tô',
  motorbike: 'Xe máy',
  motorcycle: 'Xe máy',
  bicycle: 'Xe đạp',
  truck: 'Xe tải',
  bus: 'Xe buýt',
};

/** Loại xe hiển thị trên HGVision (DB lưu car/motorbike…); loại lạ giữ nguyên. */
function vehicleTypeLabel(type: string | null | undefined): string {
  const t = type?.trim() ?? '';
  return VEHICLE_TYPE_LABEL[t.toLowerCase()] ?? t;
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
