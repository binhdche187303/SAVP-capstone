import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, Not, type FindOptionsWhere } from 'typeorm';
import { PersonControlListEntity } from '../entities/person-control-list.entity.js';
import type { CreatePersonControlListDto } from '../dto/create-person-control-list.dto.js';
import type { UpdatePersonControlListDto } from '../dto/update-person-control-list.dto.js';
import type { QueryPersonControlListDto } from '../dto/query-person-control-list.dto.js';
import type { PaginationMeta } from '../types/pagination-meta.type.js';

const userConflict = (): ConflictException =>
  new ConflictException({
    code: 'PERSON_ALREADY_IN_CONTROL_LIST',
    message: 'Người dùng này đã có trong danh sách kiểm soát (theo user_id)',
  });

const faceProfileConflict = (): ConflictException =>
  new ConflictException({
    code: 'PERSON_ALREADY_IN_CONTROL_LIST',
    message:
      'Hồ sơ khuôn mặt này đã có trong danh sách kiểm soát (theo face_profile_id)',
  });

/**
 * PersonControlListService (PWL-001 / UC-125) — CRUD watchlist người, mirror
 * `VehicleControlListService` (UC8) nhưng cho người, với 2 khóa dedup ĐỘC LẬP
 * (`user_id`/`face_profile_id`, khác `alert_rules.zoneId` — không loại trừ nhau).
 */
@Injectable()
export class PersonControlListService {
  constructor(
    @InjectRepository(PersonControlListEntity)
    private readonly repo: Repository<PersonControlListEntity>,
  ) {}

  async create(
    dto: CreatePersonControlListDto,
    actorUserId: string,
  ): Promise<PersonControlListEntity> {
    const listType = dto.listType ?? 'watchlist';
    await this.assertNoConflict(dto.userId, dto.faceProfileId, listType);

    const entity = this.repo.create({
      userId: dto.userId ?? null,
      faceProfileId: dto.faceProfileId ?? null,
      displayName: dto.displayName,
      photoMediaFileId: dto.photoMediaFileId ?? null,
      listType,
      reason: dto.reason ?? null,
      priority: dto.priority ?? 'medium',
      active: dto.active ?? true,
      createdBy: actorUserId,
    });

    let saved: PersonControlListEntity;
    try {
      saved = await this.repo.save(entity);
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw dto.userId ? userConflict() : faceProfileConflict();
      }
      throw e;
    }
    if (dto.sourceEventIds?.length) {
      await this.markStrangerAlerts(saved, dto.sourceEventIds, actorUserId);
    }
    return saved;
  }

  /**
   * Đánh dấu "chuyển theo dõi" lên các cảnh báo `stranger` chứa lượt bảo vệ đã chọn.
   * KHÔNG đổi alert_type (giữ thống kê/rule) — chỉ ghi vào payload_json:
   * - occurrences[i] khớp sourceEventId → thêm watchlistName/watchlistPriority/personControlId;
   * - watchlistConversions[] → lịch sử: ai, lúc nào, tên, mức, các lượt.
   * FE hiển thị Loại "Đối tượng theo dõi (từ Người lạ)" khi có watchlistConversions.
   */
  private async markStrangerAlerts(
    record: PersonControlListEntity,
    eventIds: string[],
    actorUserId: string,
  ): Promise<void> {
    const mark = {
      personControlId: record.id,
      watchlistName: record.displayName,
      watchlistPriority: record.priority,
    };
    const conversion = {
      ...mark,
      at: new Date().toISOString(),
      byUserId: actorUserId,
      eventIds,
    };
    await this.repo.manager.query(
      `UPDATE security_alerts sa
          SET payload_json = jsonb_set(
                jsonb_set(
                  COALESCE(sa.payload_json, '{}'::jsonb),
                  '{occurrences}',
                  (
                    SELECT COALESCE(
                      jsonb_agg(
                        CASE WHEN elem ->> 'sourceEventId' = ANY($1::text[])
                             THEN elem || $2::jsonb ELSE elem END
                        ORDER BY ord
                      ),
                      '[]'::jsonb
                    )
                    FROM jsonb_array_elements(
                      COALESCE(sa.payload_json -> 'occurrences', '[]'::jsonb)
                    ) WITH ORDINALITY AS t(elem, ord)
                  ),
                  true
                ),
                '{watchlistConversions}',
                COALESCE(sa.payload_json -> 'watchlistConversions', '[]'::jsonb)
                  || jsonb_build_array($3::jsonb),
                true
              ),
              updated_at = NOW()
        WHERE sa.alert_type = 'stranger'
          AND (
            sa.source_event_id::text = ANY($1::text[])
            OR EXISTS (
              SELECT 1
              FROM jsonb_array_elements(
                COALESCE(sa.payload_json -> 'occurrences', '[]'::jsonb)
              ) e
              WHERE e ->> 'sourceEventId' = ANY($1::text[])
            )
          )`,
      [eventIds, JSON.stringify(mark), JSON.stringify(conversion)],
    );
  }

  async list(
    query: QueryPersonControlListDto,
  ): Promise<{ items: PersonControlListEntity[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: FindOptionsWhere<PersonControlListEntity> = {
      deletedAt: IsNull(),
    };
    if (query.listType) where.listType = query.listType;
    if (query.active !== undefined) where.active = query.active;
    if (query.userId) where.userId = query.userId;
    if (query.faceProfileId) where.faceProfileId = query.faceProfileId;

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

  async findOne(id: string): Promise<PersonControlListEntity> {
    const entity = await this.repo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!entity) {
      throw new NotFoundException({
        code: 'PERSON_CONTROL_LIST_ENTRY_NOT_FOUND',
        message: 'Không tìm thấy bản ghi kiểm soát người',
      });
    }
    return entity;
  }

  async update(
    id: string,
    dto: UpdatePersonControlListDto,
  ): Promise<PersonControlListEntity> {
    const entity = await this.findOne(id);

    const nextUserId =
      dto.userId !== undefined ? (dto.userId ?? null) : entity.userId;
    const nextFaceProfileId =
      dto.faceProfileId !== undefined
        ? (dto.faceProfileId ?? null)
        : entity.faceProfileId;
    const nextListType = dto.listType ?? entity.listType;

    const userChanged =
      nextUserId !== entity.userId || nextListType !== entity.listType;
    const faceChanged =
      nextFaceProfileId !== entity.faceProfileId ||
      nextListType !== entity.listType;

    if (userChanged && nextUserId) {
      await this.assertUserNoConflict(nextUserId, nextListType, id);
    }
    if (faceChanged && nextFaceProfileId) {
      await this.assertFaceProfileNoConflict(
        nextFaceProfileId,
        nextListType,
        id,
      );
    }

    entity.userId = nextUserId;
    entity.faceProfileId = nextFaceProfileId;
    entity.listType = nextListType;
    if (dto.displayName !== undefined) entity.displayName = dto.displayName;
    if (dto.photoMediaFileId !== undefined)
      entity.photoMediaFileId = dto.photoMediaFileId;
    if (dto.reason !== undefined) entity.reason = dto.reason;
    if (dto.priority !== undefined) entity.priority = dto.priority;
    if (dto.active !== undefined) entity.active = dto.active;

    try {
      return await this.repo.save(entity);
    } catch (e) {
      if (this.isUniqueViolation(e)) {
        throw nextUserId ? userConflict() : faceProfileConflict();
      }
      throw e;
    }
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.repo.softDelete(id);
  }

  /** §2.6: kiểm CẢ HAI điều kiện dedup nếu request có cả 2 trường (KHÔNG else-if). */
  private async assertNoConflict(
    userId: string | undefined,
    faceProfileId: string | undefined,
    listType: string,
  ): Promise<void> {
    if (userId) {
      await this.assertUserNoConflict(userId, listType);
    }
    if (faceProfileId) {
      await this.assertFaceProfileNoConflict(faceProfileId, listType);
    }
  }

  private async assertUserNoConflict(
    userId: string,
    listType: string,
    excludeId?: string,
  ): Promise<void> {
    const where: FindOptionsWhere<PersonControlListEntity> = {
      userId,
      listType,
      deletedAt: IsNull(),
    };
    if (excludeId) where.id = Not(excludeId);
    const existing = await this.repo.findOne({ where });
    if (existing) throw userConflict();
  }

  private async assertFaceProfileNoConflict(
    faceProfileId: string,
    listType: string,
    excludeId?: string,
  ): Promise<void> {
    const where: FindOptionsWhere<PersonControlListEntity> = {
      faceProfileId,
      listType,
      deletedAt: IsNull(),
    };
    if (excludeId) where.id = Not(excludeId);
    const existing = await this.repo.findOne({ where });
    if (existing) throw faceProfileConflict();
  }

  /** Postgres unique_violation = 23505 (TypeORM QueryFailedError.driverError.code). */
  private isUniqueViolation(e: unknown): boolean {
    const code =
      (e as { driverError?: { code?: string }; code?: string })?.driverError
        ?.code ?? (e as { code?: string })?.code;
    return code === '23505';
  }
}
