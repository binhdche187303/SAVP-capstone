import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { TokenService } from '../../src/modules/auth/services/token.service';

/**
 * Sinh access token THẬT (cùng secret/TTL/payload như đăng nhập) cho tài khoản có sẵn trong DB, để e2e
 * chạy qua toàn bộ guard của AppModule. Dùng tài khoản demo seed sẵn (sysadmin, emp.hr1, teacher.demo...).
 */
async function userOf(app: INestApplication, username: string): Promise<{ id: string; email: string }> {
  const rows: Array<{ id: string; email: string }> = await app
    .get(DataSource)
    .query(`SELECT id, email FROM users WHERE username = $1 AND deleted_at IS NULL`, [username]);
  if (!rows.length) throw new Error(`e2e: không có user "${username}" trong DB (cần dữ liệu demo đã seed)`);
  return rows[0];
}

export async function userIdOf(app: INestApplication, username: string): Promise<string> {
  return (await userOf(app, username)).id;
}

export async function bearerFor(app: INestApplication, username: string): Promise<string> {
  const user = await userOf(app, username);
  const token = await app.get(TokenService).generateAccessToken({ sub: user.id, jti: randomUUID(), email: user.email });
  return `Bearer ${token}`;
}
