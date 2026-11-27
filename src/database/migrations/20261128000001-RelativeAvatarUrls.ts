import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ảnh đại diện lưu local trước đây ghi URL TUYỆT ĐỐI vào DB
 * (`http://<địa chỉ lúc upload>/uploads/avatars/...`). Đổi IP → tên miền / HTTPS thì mọi ảnh
 * cũ hỏng (sai host + trình duyệt chặn ảnh http trên trang https).
 *
 * Chuyển về đường dẫn tương đối `/uploads/avatars/...` — trình duyệt tự ghép với địa chỉ đang
 * mở (nginx chuyển /uploads sang backend). URL ngoài (Cloudinary…) giữ nguyên.
 */
export class RelativeAvatarUrls20261128000001 implements MigrationInterface {
  name = 'RelativeAvatarUrls20261128000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE users
         SET avatar_url = regexp_replace(avatar_url, '^https?://[^/]+(/uploads/avatars/)', '\\1')
       WHERE avatar_url ~ '^https?://[^/]+/uploads/avatars/'
    `);
    await queryRunner.query(`
      UPDATE media_files
         SET file_url = regexp_replace(file_url, '^https?://[^/]+(/uploads/avatars/)', '\\1')
       WHERE related_entity_type = 'user_avatar'
         AND file_url ~ '^https?://[^/]+/uploads/avatars/'
    `);
  }

  public async down(): Promise<void> {
    // Không khôi phục được host cũ (và cũng không nên) — đường dẫn tương đối vẫn hiển thị đúng.
  }
}
