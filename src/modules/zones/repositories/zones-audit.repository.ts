import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

/** Bảng đích của mọi bản ghi audit trong repository này (ZND-001 / UC-92). */
const ZONE_ENTITY_TYPE = 'zones';

/**
 * ZonesAuditRepository (ZND-001 / UC-92) — ghi vết thao tác trên `zones` vào `audit_logs`.
 *
 * Mỗi method nhận `EntityManager` của caller để chạy TRONG transaction của service — thao tác
 * và audit phải cùng sống hoặc cùng chết ("đã xóa nhưng không có audit" là mất dấu vết vĩnh viễn).
 *
 * Mirror `IotAuditRepository` nhưng KHÔNG tái dùng được nó: repo đó hard-code
 * `entity_type = 'iot_devices'` trong từng câu SQL.
 *
 * Đây là nơi DUY NHẤT lưu được ai thao tác trên zone: bảng `zones` không có
 * `created_by`/`updated_by`/`deleted_by` (migration 20260721000001).
 *
 * SEC-01: KHÔNG ghi nội dung `zones.metadata_json` vào audit — xem `logZoneUpdate`.
 */
@Injectable()
export class ZonesAuditRepository {
  async logZoneCreation(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      zoneId: string;
      zoneCode: string;
      zoneType: string;
    },
  ): Promise<void> {
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'create', $2, $3, 'info', $4::jsonb)
      `,
      [
        params.userId,
        ZONE_ENTITY_TYPE,
        params.zoneId,
        JSON.stringify({
          zone_code: params.zoneCode,
          zone_type: params.zoneType,
        }),
      ],
    );
  }

  /**
   * SEC-01 (bắt buộc): `zones.metadata_json` là túi tự do — kích thước không giới hạn và có
   * thể bị nhét cấu hình nhạy cảm. Nếu `changes` có khoá `metadataJson`, giá trị của nó được
   * THAY bằng cờ `{ changed: true }`; nội dung thật KHÔNG bao giờ đi vào `audit_logs`.
   * Tiền lệ: `IotAuditRepository.logDeviceUpdate` cũng cố ý không ghi metadata thiết bị.
   */
  async logZoneUpdate(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      zoneId: string;
      changes: Record<string, { old: unknown; new: unknown }>;
    },
  ): Promise<void> {
    const safeChanges: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params.changes)) {
      safeChanges[key] =
        key === 'metadataJson' ? { changed: true } : { ...value };
    }

    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'update', $2, $3, 'info', $4::jsonb)
      `,
      [
        params.userId,
        ZONE_ENTITY_TYPE,
        params.zoneId,
        JSON.stringify({ changed_fields: safeChanges }),
      ],
    );
  }

  /**
   * Gán thiết bị vào khu vực (ZNA-001 / UC-94).
   *
   * 1 bản ghi cho CẢ LÔ: gán là all-or-nothing (OQ-1) nên cả lô là một sự kiện.
   * `oldZoneIds` ghi lại zone cũ của từng thiết bị (null nếu chưa thuộc zone nào) — đây là
   * bằng chứng DUY NHẤT cho lần chuyển zone, vì UC-94 cho phép đè zone khác (OQ-3).
   *
   * SEC-01: CHỈ ghi id. TUYỆT ĐỐI không ghi `metadata_json`/tên/IP/secret của thiết bị.
   */
  async logZoneAssignDevices(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      zoneId: string;
      deviceIds: string[];
      oldZoneIds: Record<string, string | null>;
    },
  ): Promise<void> {
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'assign_device', $2, $3, 'info', $4::jsonb)
      `,
      [
        params.userId,
        ZONE_ENTITY_TYPE,
        params.zoneId,
        JSON.stringify({
          device_ids: params.deviceIds,
          old_zone_ids: params.oldZoneIds,
          new_zone_id: params.zoneId,
        }),
      ],
    );
  }

  /**
   * Gỡ thiết bị khỏi khu vực (ZNA-001 / UC-94) — `zone_id` về NULL.
   *
   * SEC-01: CHỈ ghi id, như `logZoneAssignDevices`.
   */
  async logZoneUnassignDevice(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      zoneId: string;
      deviceId: string;
    },
  ): Promise<void> {
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'unassign_device', $2, $3, 'info', $4::jsonb)
      `,
      [
        params.userId,
        ZONE_ENTITY_TYPE,
        params.zoneId,
        JSON.stringify({
          device_ids: [params.deviceId],
          old_zone_id: params.zoneId,
          new_zone_id: null,
        }),
      ],
    );
  }

  async logZoneDeletion(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      zoneId: string;
      zoneCode: string;
      zoneType: string;
    },
  ): Promise<void> {
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'delete', $2, $3, 'info', $4::jsonb)
      `,
      [
        params.userId,
        ZONE_ENTITY_TYPE,
        params.zoneId,
        JSON.stringify({
          zone_code: params.zoneCode,
          zone_type: params.zoneType,
        }),
      ],
    );
  }
}
