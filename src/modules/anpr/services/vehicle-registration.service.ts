import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, ILike, type FindOptionsWhere } from 'typeorm';
import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';
import { normalizePlate } from '../utils/normalize-plate.js';
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
  ) {}

  async register(
    userId: string,
    dto: CreateVehicleRegistrationDto,
  ): Promise<VehicleRegistrationEntity> {
    const plateNumber = normalizePlate(dto.plateRaw);

    // OQ-4: validate trên giá trị ĐÃ normalize.
    if (!this.isValidPlate(plateNumber)) {
      throw new BadRequestException({
        code: 'INVALID_PLATE',
        message:
          'Biển số không hợp lệ (cần 6–10 ký tự chữ-số, có cả chữ và số).',
      });
    }

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

    try {
      return await this.repo.save(entity);
    } catch (e) {
      // VAL-02 safety-net: partial-unique race → 23505 → 409 sạch, KHÔNG để lỗi DB phọt client.
      if (this.isUniqueViolation(e)) {
        throw plateConflict();
      }
      throw e;
    }
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
      where.status = query.status;
    }
    if (query.vehicleType) {
      where.vehicleType = query.vehicleType;
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
      qb.andWhere('vr.status = :status', { status: query.status });
    }
    if (query.vehicleType) {
      qb.andWhere('vr.vehicleType = :vt', { vt: query.vehicleType });
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
   * Sửa metadata (DATA-01: CHỈ note + vehicle_type). undefined→giữ nguyên,
   * null→xóa (set null). Cả 2 absent → no-op (KHÔNG save), trả nguyên trạng (OQ-5).
   */
  async updateMetadata(
    id: string,
    userId: string,
    dto: UpdateVehicleRegistrationDto,
  ): Promise<VehicleRegistrationEntity> {
    const entity = await this.loadOwned(id, userId);
    let changed = false;
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
    return this.repo.save(entity);
  }

  /** Đổi status active↔disabled (DATA-02). */
  async setStatus(
    id: string,
    userId: string,
    status: VehicleStatus,
  ): Promise<VehicleRegistrationEntity> {
    const entity = await this.loadOwned(id, userId);
    entity.status = status;
    return this.repo.save(entity);
  }

  /** Xóa-mềm (DATA-02: softDelete, KHÔNG hard-delete). Đã xóa → loadOwned 404. */
  async softDeleteOwned(id: string, userId: string): Promise<void> {
    await this.loadOwned(id, userId);
    await this.repo.softDelete(id);
  }

  /**
   * Admin xóa-mềm bất kỳ biển số nào (VPT-BE-05 / VPT-001).
   * KHÔNG fold userId — admin xoá hộ, không cần là chủ xe.
   * id không tồn tại / đã xoá → NotFoundException VEHICLE_NOT_FOUND_OR_FORBIDDEN.
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
