import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * [2026-11-23] FaceID tự duyệt — hồ sơ "Cần kiểm tra" (pending_review) còn sót từ luồng
 * DUYỆT TAY cũ được duyệt luôn, để người dùng không bị kẹt ở trạng thái chờ.
 *
 * Mỗi user: hồ sơ pending_review MỚI NHẤT → active (gắn metadata.legacyAutoApprovedAt để
 * cron HGVision đối soát đẩy lên, kể cả bộ 1 ảnh); pending cũ hơn → rejected (superseded);
 * hồ sơ active cũ (nếu có) → revoked. Mapping kho chân dung IVSS hạ về pending như approve().
 * Ghi audit 'biometric.auto_approve_legacy' (user_id NULL = hệ thống).
 *
 * down(): không hoàn tác (dữ liệu nghiệp vụ, không đoán lại được trạng thái cũ).
 */
export class AutoApproveLegacyPendingFaceProfiles20261123000003 implements MigrationInterface {
  name = 'AutoApproveLegacyPendingFaceProfiles20261123000003';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TEMP TABLE tmp_fp_legacy_approve ON COMMIT DROP AS
      SELECT DISTINCT ON (user_id) id, user_id
        FROM face_profiles
       WHERE status = 'pending_review' AND deleted_at IS NULL
       ORDER BY user_id, COALESCE(last_updated_at, enrolled_at) DESC NULLS LAST, enrolled_at DESC NULLS LAST
    `);

    // Pending cũ hơn của cùng user → rejected.
    await queryRunner.query(`
      UPDATE face_profiles fp
         SET status = 'rejected',
             metadata_json = COALESCE(fp.metadata_json, '{}'::jsonb)
               || jsonb_build_object('supersededBy', t.id, 'supersededAt', now()),
             last_updated_at = now()
        FROM tmp_fp_legacy_approve t
       WHERE fp.user_id = t.user_id AND fp.id <> t.id
         AND fp.status = 'pending_review' AND fp.deleted_at IS NULL
    `);

    // Hồ sơ active cũ → revoked (bị thay bằng hồ sơ vừa duyệt).
    await queryRunner.query(`
      UPDATE face_profiles fp
         SET status = 'revoked',
             metadata_json = COALESCE(fp.metadata_json, '{}'::jsonb)
               || jsonb_build_object('replacedBy', t.id, 'replacedAt', now()),
             last_updated_at = now()
        FROM tmp_fp_legacy_approve t
       WHERE fp.user_id = t.user_id AND fp.id <> t.id
         AND fp.status = 'active' AND fp.deleted_at IS NULL
    `);

    await queryRunner.query(`
      UPDATE face_profiles fp
         SET status = 'active',
             metadata_json = COALESCE(fp.metadata_json, '{}'::jsonb)
               || jsonb_build_object('legacyAutoApprovedAt', now()),
             last_updated_at = now()
        FROM tmp_fp_legacy_approve t
       WHERE fp.id = t.id
    `);

    await queryRunner.query(`
      UPDATE device_user_mappings m
         SET sync_status = 'pending', face_registered = false,
             last_sync_error = NULL, updated_at = now()
        FROM tmp_fp_legacy_approve t
       WHERE m.user_id = t.user_id AND m.deleted_at IS NULL
         AND m.sync_status <> 'pending'
         AND m.metadata_json->>'source' = 'portrait'
    `);

    await queryRunner.query(`
      INSERT INTO audit_logs (user_id, action_type, entity_type, entity_id, old_value_json, new_value_json)
      SELECT NULL, 'biometric.auto_approve_legacy', 'face_profile', t.id,
             jsonb_build_object('status', 'pending_review'),
             jsonb_build_object('status', 'active', 'targetUserId', t.user_id)
        FROM tmp_fp_legacy_approve t
    `);
  }

  async down(): Promise<void> {
    // Không hoàn tác — xem ghi chú đầu file.
  }
}
