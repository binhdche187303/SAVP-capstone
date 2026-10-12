import { MigrationInterface, QueryRunner } from 'typeorm';

/** VIS-BE-001: tìm khách/người gặp không phân biệt dấu tiếng Việt (unaccent). Idempotent; không gỡ ở down. */
export class EnableUnaccentExtension20261012000004 implements MigrationInterface {
  name = 'EnableUnaccentExtension20261012000004';
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);
  }
  public async down(): Promise<void> {
    // Giữ lại extension: các module khác (live-meeting) cũng dùng.
  }
}
