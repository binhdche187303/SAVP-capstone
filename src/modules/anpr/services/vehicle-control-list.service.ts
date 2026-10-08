import {
  Injectable,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, type FindOptionsWhere } from 'typeorm';
import { VehicleControlListEntity } from '../entities/vehicle-control-list.entity.js';
import { normalizePlate } from '../utils/normalize-plate.js';
import type { CreateVehicleControlListDto } from '../dto/create-vehicle-control-list.dto.js';
import type { UpdateVehicleControlListDto } from '../dto/update-vehicle-control-list.dto.js';
import type { ListVehicleControlListQueryDto } from '../dto/list-vehicle-control-list-query.dto.js';
import type { PaginationMeta } from './vehicle-registration.service.js';

/** VAL-02/DATA-03: conflict trùng (plate, list_type) còn sống — dùng chung pre-check + safety-net 23505. */
const controlListConflict = (): ConflictException =>
  new ConflictException({
    code: 'PLATE_ALREADY_IN_CONTROL_LIST',
    message: 'Biển số này đã có trong danh sách kiểm soát',
  });

/** Đợt 3 (perf): TTL cache toàn bộ danh sách kiểm soát đang hiệu lực (bảng nhỏ, admin quản lý). */
const CONTROL_LIST_CACHE_MS = 60_000;

/**
 * VehicleControlListService (VCL-001 / UC8) — CRUD danh sách kiểm soát phương tiện
 * (blocklist/watchlist). Khác `VehicleRegistrationService` (xe hợp lệ của user) — bảng
 * này không có ownership, toàn bộ thao tác đều admin-gated ở tầng controller.
 *
 * File MỚI HOÀN TOÀN, KHÔNG đụng `VehicleRegistrationService` (spec §8 residual: chấp
 * nhận trùng nhỏ `isUniqueViolation` giữa 2 service để tránh động code UC1 đang chạy).
 */
@Injectable()
export class VehicleControlListService {
  constructor(
    @InjectRepository(VehicleControlListEntity)
    private readonly repo: Repository<VehicleControlListEntity>,
  ) {}

  private activeCache?: {
    at: number;
    byPlate: Map<string, VehicleControlListEntity>;
  };

  async create(
    currentUserId: string,
    dto: CreateVehicleControlListDto,
  ): Promise<VehicleControlListEntity> {
    const plateNumber = normalizePlate(dto.plateRaw);

    // DATA-03: pre-check trùng (plate_number, list_type) còn sống — bất kể active.
    const existing = await this.repo.findOne({
      where: { plateNumber, listType: dto.listType, deletedAt: IsNull() },
    });
    if (existing) {
      throw controlListConflict();
    }

    const entity = this.repo.create({
      plateNumber,
      plateRaw: dto.plateRaw,
      listType: dto.listType,
      reason: dto.reason ?? null,
      active: true,
      createdBy: currentUserId,
    });

    try {
      const saved = await this.repo.save(entity);
      this.activeCache = undefined;
      return saved;
    } catch (e) {
      // safety-net: partial-unique race → 23505 → 409 sạch, KHÔNG để lỗi DB phọt client.
      if (this.isUniqueViolation(e)) {
        throw controlListConflict();
      }
      throw e;
    }
  }

  async list(
    query: ListVehicleControlListQueryDto,
  ): Promise<{ items: VehicleControlListEntity[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: FindOptionsWhere<VehicleControlListEntity> = {
      deletedAt: IsNull(),
    };
    if (query.plate) {
      where.plateNumber = normalizePlate(query.plate);
    }
    if (query.listType) {
      where.listType = query.listType;
    }
    // active=false là filter hợp lệ — PHẢI check !== undefined, KHÔNG if-truthy.
    if (query.active !== undefined) {
      where.active = query.active;
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
   * checkControlList (VCC-001 / UC9) — đối chiếu THUẦN (pure lookup, KHÔNG side-effect).
   *
   * DATA-01: KHÔNG normalize lại `plateNumber` — caller (VehicleResolveService) đã normalize
   * từ UC4 (mirror DATA-03 UC5). DATA-02: một plate có thể có 2 dòng active cùng lúc
   * (blocklist + watchlist) — `order: {listType:'ASC'}` ưu tiên trả 'blocklist' (severity cao
   * hơn) vì 'blocklist' < 'watchlist' theo alphabet, KHÔNG phải may rủi ngầm định.
   */
  /**
   * Đợt 3 (perf): mỗi xe qua cổng KHÔNG còn 1 query — tra Map in-memory nạp lại mỗi
   * CONTROL_LIST_CACHE_MS (hoặc ngay khi create/update/softDelete). Thứ tự listType ASC
   * giữ nguyên ưu tiên cũ (blocklist trước watchlist).
   */
  async checkControlList(
    plateNumber: string,
  ): Promise<VehicleControlListEntity | null> {
    if (
      !this.activeCache ||
      Date.now() - this.activeCache.at >= CONTROL_LIST_CACHE_MS
    ) {
      const rows = await this.repo.find({
        where: { deletedAt: IsNull(), active: true },
        order: { listType: 'ASC' },
      });
      const byPlate = new Map<string, VehicleControlListEntity>();
      for (const row of rows) {
        if (!byPlate.has(row.plateNumber)) byPlate.set(row.plateNumber, row);
      }
      this.activeCache = { at: Date.now(), byPlate };
    }
    return this.activeCache.byPlate.get(plateNumber) ?? null;
  }

  async getDetail(id: string): Promise<VehicleControlListEntity> {
    const entity = await this.repo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException({
        code: 'CONTROL_LIST_ENTRY_NOT_FOUND',
        message: 'Không tìm thấy bản ghi kiểm soát phương tiện',
      });
    }
    return entity;
  }

  async update(
    id: string,
    dto: UpdateVehicleControlListDto,
  ): Promise<VehicleControlListEntity> {
    const entity = await this.getDetail(id);
    let changed = false;
    if (dto.reason !== undefined) {
      entity.reason = dto.reason;
      changed = true;
    }
    if (dto.active !== undefined) {
      entity.active = dto.active;
      changed = true;
    }
    if (!changed) {
      return entity; // no-op
    }
    const saved = await this.repo.save(entity);
    this.activeCache = undefined;
    return saved;
  }

  async softDelete(id: string): Promise<void> {
    await this.getDetail(id);
    await this.repo.softDelete(id);
    this.activeCache = undefined;
  }

  /** Postgres unique_violation = 23505 (TypeORM QueryFailedError.driverError.code). */
  private isUniqueViolation(e: unknown): boolean {
    const code =
      (e as { driverError?: { code?: string }; code?: string })?.driverError
        ?.code ?? (e as { code?: string })?.code;
    return code === '23505';
  }
}
