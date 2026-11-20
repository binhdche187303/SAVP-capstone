import {
  filterWhere,
  filterValues,
} from '../../../common/utils/filter-selection.js';
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, ILike, In, type FindOptionsWhere } from 'typeorm';
import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';
import { normalizePlate } from '../utils/normalize-plate.js';
import {
  ControlListSyncHook,
  type PlateReconcileResult,
} from './control-list-sync.hook.js';
import type { CreateVehicleRegistrationDto } from '../dto/create-vehicle-registration.dto.js';
import type { UpdateVehicleRegistrationDto } from '../dto/update-vehicle-registration.dto.js';
import type { VehicleStatus } from '../dto/update-vehicle-status.dto.js';
import type { ListVehicleRegistrationsQueryDto } from '../dto/list-vehicle-registrations-query.dto.js';
import type { AdminListVehicleRegistrationsQueryDto } from '../dto/admin-list-vehicle-registrations-query.dto.js';

/** Meta phân trang — mirror shape iot-devices (CLAUDE.md §8.4). */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// OQ-4: biển hợp lệ sau normalize — chỉ [A-Z0-9], dài 6–10.
const PLATE_FORMAT_RE = /^[0-9A-Z]+$/;
const PLATE_MIN = 6;
const PLATE_MAX = 10;

/** Số xe tối đa mỗi lần admin bấm "Đồng bộ HGVision" (đẩy tuần tự, không dồn HGVision). */
export const BULK_SYNC_MAX = 300;

export interface BulkSyncResult {
  /** false = chưa dùng HGVision (CAMERA_PROVIDER khác hgvision) → không làm gì. */
  enabled: boolean;
  total: number;
  synced: number;
  failed: number;
  pending: number;
  /** Số xe chưa đồng bộ còn lại sau lượt này (vượt BULK_SYNC_MAX) — bấm lại để đẩy tiếp. */
  remaining: number;
}

/** VAL-02: conflict trùng biển — dùng chung cho pre-check + safety-net 23505. */
const plateConflict = (): ConflictException =>
  new ConflictException({
    code: 'PLATE_ALREADY_REGISTERED',
    message: 'Biển số này đã được đăng ký',
  });

/**
 * VehicleRegistrationService (VPR-001 / UC1) — đăng ký biển số xe.
 *
 * `register(userId, dto)` dùng chung cho cả route user (userId từ JWT) và admin
 * (userId từ body) — controller quyết nguồn userId. Mirror iot-devices: pre-check + throw.
 */
@Injectable()
export class VehicleRegistrationService {
  constructor(
    @InjectRepository(VehicleRegistrationEntity)
    private readonly repo: Repository<VehicleRegistrationEntity>,
    private readonly syncHook: ControlListSyncHook,
  ) {}

  /**
   * Đẩy thay đổi sang HGVision (xe đăng ký = "Bình thường", chủ xe theo tài khoản) rồi đọc
   * lại dòng để trả trạng thái đồng bộ. Lỗi HGVision KHÔNG làm hỏng thao tác lưu ở SAVP.
   */
  private async afterChange(
    entity: VehicleRegistrationEntity,
  ): Promise<VehicleRegistrationEntity> {
    if (!this.syncHook.enabled) return entity;
    await this.syncHook.notify(entity.plateNumber);
    return (await this.repo.findOne({ where: { id: entity.id } })) ?? entity;
  }

  /** Admin đồng bộ lại 1 xe đăng ký (vd lần trước lỗi hoặc lúc đó cờ ghi đang tắt). */
  async resync(id: string): Promise<VehicleRegistrationEntity> {
    const entity = await this.repo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException({
        code: 'VEHICLE_NOT_FOUND',
        message: 'Không tìm thấy biển số',
      });
    }
    return this.afterChange(entity);
  }

  async register(
    userId: string,
    dto: CreateVehicleRegistrationDto,
  ): Promise<VehicleRegistrationEntity> {
    const plateNumber = this.checkedPlate(dto.plateRaw);

    // OQ-3: pre-check trùng biển đang sống — KHÔNG lộ user nào giữ biển.
    const existing = await this.repo.findOne({
      where: { plateNumber, deletedAt: IsNull() },
    });
    if (existing) {
      throw plateConflict();
    }

    const entity = this.repo.create({
      userId,
      plateRaw: dto.plateRaw,
      plateNumber,
      vehicleType: dto.vehicleType ?? null,
      note: dto.note ?? null,
      status: 'active',
    });

    let saved: VehicleRegistrationEntity;
    try {
      saved = await this.repo.save(entity);
    } catch (e) {
      // VAL-02 safety-net: partial-unique race → 23505 → 409 sạch, KHÔNG để lỗi DB phọt client.
      if (this.isUniqueViolation(e)) {
        throw plateConflict();
      }
      throw e;
    }
    return this.afterChange(saved);
  }

  /**
   * Admin đẩy hàng loạt xe đăng ký chưa đồng bộ sang HGVision: xe đăng ký trước khi có tính
   * năng này (status NULL), lần trước lỗi (failed) hoặc lúc đó cờ ghi tắt (pending).
   * Tuần tự từng biển; tối đa BULK_SYNC_MAX xe/lần, cũ nhất trước.
   */
  /** Đối soát ngay SAVP ↔ HGVision (nút admin) — chạy cùng logic với job định kỳ. */
  reconcileHgvision(): Promise<PlateReconcileResult> {
    return this.syncHook.reconcile();
  }

  async resyncAll(): Promise<BulkSyncResult> {
    if (!this.syncHook.enabled) {
      return {
        enabled: false,
        total: 0,
        synced: 0,
        failed: 0,
        pending: 0,
        remaining: 0,
      };
    }
    const [rows, count] = await this.repo.findAndCount({
      where: [
        { deletedAt: IsNull(), hgvisionSyncStatus: IsNull() },
        {
          deletedAt: IsNull(),
          hgvisionSyncStatus: In(['pending', 'failed', 'missing']),
        },
      ],
      select: { id: true, plateNumber: true },
      order: { createdAt: 'ASC' },
      take: BULK_SYNC_MAX,
    });
    for (const r of rows) {
      await this.syncHook.notify(r.plateNumber);
    }
    const after = rows.length
      ? await this.repo.find({
          where: { id: In(rows.map((r) => r.id)) },
          select: { id: true, hgvisionSyncStatus: true },
        })
      : [];
    const countOf = (s: string) =>
      after.filter((a) => a.hgvisionSyncStatus === s).length;
    return {
      enabled: true,
      total: rows.length,
      synced: countOf('synced'),
      failed: countOf('failed'),
      pending: countOf('pending'),
      remaining: Math.max(0, count - rows.length),
    };
  }

  // ── UC2 (VPM-001): sửa / disable / xóa-mềm — chỉ biển CỦA MÌNH ──

  /**
   * CRUX ownership (SEC-01/02): load biển của current user, chưa xóa-mềm.
   * Fold ownership + existence + soft-delete vào 1 query → không khớp = 404
   * (KHÔNG 403, message trung tính — giấu tồn tại biển người khác).
   */
  private async loadOwned(
    id: string,
    userId: string,
  ): Promise<VehicleRegistrationEntity> {
    const entity = await this.repo.findOne({
      where: { id, userId, deletedAt: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException({
        code: 'VEHICLE_NOT_FOUND',
        message: 'Không tìm thấy biển số',
      });
    }
    return entity;
  }

  // ── UC3 (VPL-001): xem danh sách / chi tiết — chỉ biển CỦA MÌNH (read-only) ──

  /**
   * List biển của current user (SEC-01: lọc cứng userId + deletedAt IS NULL).
   * Filter optional: `status`/`vehicle_type` (exact), `plate` (normalize + ILike).
   * Phân trang mirror repo. Sort created_at DESC (OQ-5).
   *
   * UC-101: GIỮ findAndCount + toán tử ILike (route user không join/OR nên không cần
   * QueryBuilder) ⇒ test cũ VPL-001 assert findAndCount.where vẫn đúng, KHÔNG hồi quy.
   */
  async list(
    userId: string,
    query: ListVehicleRegistrationsQueryDto,
  ): Promise<{ items: VehicleRegistrationEntity[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Build where: KHÔNG để filter:undefined lọt vào (chỉ thêm khi có giá trị).
    const where: FindOptionsWhere<VehicleRegistrationEntity> = {
      userId,
      deletedAt: IsNull(),
    };
    if (query.status) {
      where.status = filterWhere(query.status);
    }
    if (query.vehicleType) {
      where.vehicleType = filterWhere(query.vehicleType);
    }
    if (query.plate) {
      // normalize trước ILike: '29a-123' → '%29A123%'. normalizePlate strip [^A-Z0-9]
      // ⇒ %/_ người dùng không thể thành wildcard LIKE (tự vệ sinh).
      where.plateNumber = ILike(`%${normalizePlate(query.plate)}%`);
    }

    const [items, total] = await this.repo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * List biển của MỌI người — route admin (UC-101 / VPL-002). KHÔNG fold userId.
   *
   * QueryBuilder (thay findAndCount) vì cần leftJoinAndSelect chủ xe + điều kiện OR trên
   * 2 cột đã join cho filter `owner`. LUÔN join `vr.user` (kể cả không lọc owner) vì response
   * admin luôn cần owner ⇒ bớt một nhánh rẽ. An toàn phân trang vì vr.user là ManyToOne
   * (không nhân dòng) ⇒ getManyAndCount() + skip/take vẫn đúng.
   *
   * Filter: `status`/`vehicle_type` exact, `plate` normalize+ILIKE, `user_id` exact,
   * `owner` ILIKE trên full_name OR email (KHÔNG normalize — tên người, không phải biển).
   * Mọi giá trị qua bound param (SEC-03). deletedAt IS NULL tường minh (DATA-01).
   */
  async listAll(
    query: AdminListVehicleRegistrationsQueryDto,
  ): Promise<{ items: VehicleRegistrationEntity[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.repo
      .createQueryBuilder('vr')
      .leftJoinAndSelect('vr.user', 'u')
      .where('vr.deletedAt IS NULL');

    if (query.status) {
      qb.andWhere('vr.status IN (:...status)', {
        status: filterValues(query.status),
      });
    }
    if (query.vehicleType) {
      qb.andWhere('vr.vehicleType IN (:...vt)', {
        vt: filterValues(query.vehicleType),
      });
    }
    if (query.plate) {
      qb.andWhere('vr.plateNumber ILIKE :p', {
        p: `%${normalizePlate(query.plate)}%`,
      });
    }
    if (query.userId) {
      qb.andWhere('vr.userId = :uid', { uid: query.userId });
    }
    if (query.owner) {
      qb.andWhere('(u.fullName ILIKE :o OR u.email ILIKE :o)', {
        o: `%${query.owner}%`,
      });
    }
    if (query.search) {
      // Escape ký tự đặc biệt của LIKE để từ khóa được so khớp nguyên văn
      const kw = `%${query.search.replace(/[\\%_]/g, '\\$&')}%`;
      const plate = normalizePlate(query.search);
      const plateCond = plate ? ' OR vr.plateNumber ILIKE :sp' : '';
      qb.andWhere(
        `(unaccent(u.fullName) ILIKE unaccent(:s) OR u.email ILIKE :s${plateCond})`,
        { s: kw, ...(plate ? { sp: `%${plate}%` } : {}) },
      );
    }

    const [items, total] = await qb
      .orderBy('vr.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      items,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Detail 1 biển của current user — TÁI DÙNG loadOwned (ownership + 404, OQ-3). */
  async getDetail(
    id: string,
    userId: string,
  ): Promise<VehicleRegistrationEntity> {
    return this.loadOwned(id, userId);
  }

  /**
   * Sửa xe (DATA-01: note + vehicle_type + plate_raw). undefined→giữ nguyên,
   * null→xóa (set null). Không có gì đổi → no-op (KHÔNG save), trả nguyên trạng (OQ-5).
   *
   * Đổi biển: sửa NGAY trên dòng cũ (giữ id → lịch sử ra vào `gate_access_logs` vẫn gắn
   * với xe). Biển mới kiểm định dạng + trùng như lúc đăng ký. Nếu biển cũ đã từng đẩy
   * sang HGVision, lưu 1 dòng "bia mộ" (bản sao đã xoá mềm, giữ `hgvision_synced_at`)
   * để syncPlate + job đối soát vẫn nhận biển cũ là của SAVP và xoá nó bên HGVision —
   * kể cả khi lần xoá ngay lúc đổi bị lỗi. Dòng sống reset trạng thái đồng bộ để biển
   * mới KHÔNG bị coi là "SAVP đã tạo" (tránh ghi đè biển người khác tạo bên HGVision).
   */
  async updateMetadata(
    id: string,
    userId: string,
    dto: UpdateVehicleRegistrationDto,
  ): Promise<VehicleRegistrationEntity> {
    const entity = await this.loadOwned(id, userId);
    let changed = false;
    let oldPlate: VehicleRegistrationEntity | null = null;
    if (dto.plateRaw !== undefined) {
      const plateNumber = this.checkedPlate(dto.plateRaw);
      if (plateNumber !== entity.plateNumber) {
        const dup = await this.repo.findOne({
          where: { plateNumber, deletedAt: IsNull() },
        });
        if (dup) throw plateConflict();
        oldPlate = { ...entity };
        entity.plateNumber = plateNumber;
      }
      if (dto.plateRaw !== entity.plateRaw) {
        entity.plateRaw = dto.plateRaw;
        changed = true;
      }
    }
    if (dto.vehicleType !== undefined) {
      entity.vehicleType = dto.vehicleType;
      changed = true;
    }
    if (dto.note !== undefined) {
      entity.note = dto.note;
      changed = true;
    }
    if (!changed) {
      return entity; // no-op
    }
    if (!oldPlate) return this.afterChange(await this.repo.save(entity));

    const old = oldPlate;
    let saved: VehicleRegistrationEntity;
    try {
      saved = await this.repo.manager.transaction(async (m) => {
        const r = m.getRepository(VehicleRegistrationEntity);
        if (old.hgvisionSyncedAt) {
          await r.insert({
            userId: old.userId,
            plateRaw: old.plateRaw,
            plateNumber: old.plateNumber,
            vehicleType: old.vehicleType,
            note: `Biển cũ, đã đổi sang ${entity.plateNumber}`.slice(0, 255),
            status: old.status,
            hgvisionSyncStatus: old.hgvisionSyncStatus,
            hgvisionSyncedAt: old.hgvisionSyncedAt,
            deletedAt: new Date(),
          });
        }
        entity.hgvisionSyncStatus = null;
        entity.hgvisionSyncedAt = null;
        entity.hgvisionSyncError = null;
        return r.save(entity);
      });
    } catch (e) {
      if (this.isUniqueViolation(e)) throw plateConflict();
      throw e;
    }
    // Biển cũ: không còn ai cần → syncPlate xoá bên HGVision (nhờ dòng bia mộ).
    await this.syncHook.notify(old.plateNumber);
    return this.afterChange(saved);
  }

  /** Chuẩn hoá + kiểm định dạng biển (OQ-4: validate trên giá trị ĐÃ normalize). */
  private checkedPlate(plateRaw: string): string {
    const plateNumber = normalizePlate(plateRaw);
    if (!this.isValidPlate(plateNumber)) {
      throw new BadRequestException({
        code: 'INVALID_PLATE',
        message:
          'Biển số không hợp lệ (cần 6–10 ký tự chữ-số, có cả chữ và số).',
      });
    }
    return plateNumber;
  }

  /** Đổi status active↔disabled (DATA-02). */
  async setStatus(
    id: string,
    userId: string,
    status: VehicleStatus,
  ): Promise<VehicleRegistrationEntity> {
    const entity = await this.loadOwned(id, userId);
    entity.status = status;
    return this.afterChange(await this.repo.save(entity));
  }

  /** Xóa-mềm (DATA-02: softDelete, KHÔNG hard-delete). Đã xóa → loadOwned 404. */
  async softDeleteOwned(id: string, userId: string): Promise<void> {
    const entity = await this.loadOwned(id, userId);
    await this.repo.softDelete(id);
    await this.syncHook.notify(entity.plateNumber);
  }

  /**
   * Admin xóa-mềm bất kỳ biển số nào (VPT-BE-05 / VPT-001).
   * KHÔNG fold userId — admin xóa hộ, không cần là chủ xe.
   * id không tồn tại / đã xóa → NotFoundException VEHICLE_NOT_FOUND_OR_FORBIDDEN.
   */
  async adminSoftDelete(id: string): Promise<void> {
    const entity = await this.repo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException({
        code: 'VEHICLE_NOT_FOUND_OR_FORBIDDEN',
        message: 'Không tìm thấy biển số',
      });
    }
    await this.repo.softDelete(id);
    await this.syncHook.notify(entity.plateNumber);
  }

  /** OQ-4: ^[0-9A-Z]+$ && dài 6–10 && ≥1 chữ && ≥1 số. */
  private isValidPlate(plate: string): boolean {
    if (
      !PLATE_FORMAT_RE.test(plate) ||
      plate.length < PLATE_MIN ||
      plate.length > PLATE_MAX
    ) {
      return false;
    }
    return /[A-Z]/.test(plate) && /[0-9]/.test(plate);
  }

  /** Postgres unique_violation = 23505 (TypeORM QueryFailedError.driverError.code). */
  private isUniqueViolation(e: unknown): boolean {
    const code =
      (e as { driverError?: { code?: string }; code?: string })?.driverError
        ?.code ?? (e as { code?: string })?.code;
    return code === '23505';
  }
}
