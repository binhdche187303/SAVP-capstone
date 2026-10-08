import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { maskSensitiveMetadata } from '../../../common/utils/masking.util.js';

@Injectable()
export class IotAuditRepository {
  async logDeviceCreation(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      metadataJson?: Record<string, any> | null;
    },
  ): Promise<void> {
    const maskedMetadata = maskSensitiveMetadata(params.metadataJson);

    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'create', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [
        params.userId,
        params.deviceId,
        maskedMetadata ? JSON.stringify(maskedMetadata) : null,
      ],
    );
  }

  async logAssignRoom(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      oldRoomId: string | null;
      newRoomId: string;
    },
  ): Promise<void> {
    const metadata = {
      old_room_id: params.oldRoomId,
      new_room_id: params.newRoomId,
    };

    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'assign_room', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [params.userId, params.deviceId, JSON.stringify(metadata)],
    );
  }

  async logDeviceUpdate(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      changes: Record<string, { old: unknown; new: unknown }>;
    },
  ): Promise<void> {
    // SEC-01: chỉ 4 trường allowlist (device_name/ip/mac/network) đi vào đây,
    // không chứa secret. KHÔNG ghi metadata_json của thiết bị.
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'update', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [
        params.userId,
        params.deviceId,
        JSON.stringify({ changed_fields: params.changes }),
      ],
    );
  }

  async logDeviceStatusChange(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      action: 'disable' | 'enable' | 'auto_offline' | 'auto_online';
      oldStatus: string;
      newStatus: string;
    },
  ): Promise<void> {
    // SEC-01: chỉ ghi thay đổi status (không secret). action_type = 'disable' | 'enable'.
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, $2, 'iot_devices', $3, 'info', $4::jsonb)
      `,
      [
        params.userId,
        params.action,
        params.deviceId,
        JSON.stringify({
          changed_fields: {
            status: { old: params.oldStatus, new: params.newStatus },
          },
        }),
      ],
    );
  }

  /** Như `logDeviceStatusChange` nhưng ghi cả lô bằng 1 câu INSERT (probe offline/online). */
  async logDeviceStatusChanges(
    entityManager: EntityManager,
    rows: Array<{
      userId: string | null;
      deviceId: string;
      action: 'auto_offline' | 'auto_online';
      oldStatus: string;
      newStatus: string;
    }>,
  ): Promise<void> {
    if (rows.length === 0) return;
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        SELECT (r->>'userId')::uuid, r->>'action', 'iot_devices', (r->>'deviceId')::uuid, 'info', r->'meta'
          FROM jsonb_array_elements($1::jsonb) r
      `,
      [
        JSON.stringify(
          rows.map((p) => ({
            userId: p.userId,
            action: p.action,
            deviceId: p.deviceId,
            meta: {
              changed_fields: {
                status: { old: p.oldStatus, new: p.newStatus },
              },
            },
          })),
        ),
      ],
    );
  }

  async logConfigureFaceServer(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      configMetadata: Record<string, any>;
    },
  ): Promise<void> {
    // metadata must not contain one_time_callback_token, callback_token_hash, or
    // password_encrypted (SEC-01: dù đã mã hoá, không cần lưu thêm 1 bản vào audit_logs)
    const safeMetadata = { ...params.configMetadata };
    delete safeMetadata.one_time_callback_token;
    delete safeMetadata.callback_token_hash;
    delete safeMetadata.password_encrypted;

    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'configure_face_server', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [params.userId, params.deviceId, JSON.stringify(safeMetadata)],
    );
  }

  async logRevokeFaceServerToken(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      reason: string | null;
    },
  ): Promise<void> {
    // SEC-01: KHÔNG ghi token/hash. reason là metadata không nhạy cảm.
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'revoke_face_server_token', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [
        params.userId,
        params.deviceId,
        JSON.stringify({ reason: params.reason }),
      ],
    );
  }

  async logRotateFaceServerToken(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
    },
  ): Promise<void> {
    // SEC-01: KHÔNG ghi token/hash mới — chỉ ghi sự kiện rotate.
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'rotate_face_server_token', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [params.userId, params.deviceId, JSON.stringify({ rotated: true })],
    );
  }

  async logConfigureRtsp(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      configMetadata: Record<string, any>;
      passwordProvided: boolean;
    },
  ): Promise<void> {
    // SEC-01: the real RTSP password must never reach this layer. We only record a
    // boolean derived from whether the caller supplied one in this request.
    const safeMetadata = { ...params.configMetadata };
    safeMetadata.rtsp_password_configured = params.passwordProvided;
    delete safeMetadata.rtsp_password;
    delete safeMetadata.rtsp_password_encrypted;

    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'configure_rtsp', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [params.userId, params.deviceId, JSON.stringify(safeMetadata)],
    );
  }

  /**
   * IAC-001 (UC-96) — audit cấu hình chức năng AI của camera. SEC-01: `configMetadata` CHỈ chứa
   * cụm `ai_config` (3 cờ boolean + configured_at) do service truyền — KHÔNG có phần khác của
   * `metadata_json` (rtsp_config...) và KHÔNG có secret. Mirror `logConfigureRtsp`.
   */
  async logConfigureAi(
    entityManager: EntityManager,
    params: {
      userId: string | null;
      deviceId: string;
      configMetadata: Record<string, any>;
    },
  ): Promise<void> {
    await entityManager.query(
      `
        INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, severity, metadata_json)
        VALUES ($1, 'configure_ai', 'iot_devices', $2, 'info', $3::jsonb)
      `,
      [params.userId, params.deviceId, JSON.stringify(params.configMetadata)],
    );
  }
}
