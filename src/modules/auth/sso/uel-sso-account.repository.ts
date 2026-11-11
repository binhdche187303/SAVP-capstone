import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

export type SsoMatchedBy =
  | 'student_code'
  | 'employee_code'
  | 'username_code'
  | 'email';

export interface SsoIdentity {
  studentId?: string | null;
  publicServantNumber?: string | null;
  /** Tên đăng nhập UEL (verify.preferredUsername / profile.userName). */
  userName?: string | null;
  email?: string | null;
  emailVerified?: boolean | null;
}

export type SsoLinkResult =
  | { kind: 'linked'; userId: string; matchedBy: SsoMatchedBy }
  | { kind: 'ambiguous'; matchedBy: SsoMatchedBy }
  | { kind: 'not_found' };

interface IdRow {
  id: string;
}

/**
 * Tìm tài khoản nội bộ khớp với danh tính SSO UEL. KHÔNG tự tạo tài khoản —
 * tài khoản phải có sẵn (đồng bộ từ API Đào tạo hoặc tạo tay).
 *
 * Thứ tự: mã SV → mã cán bộ → tên đăng nhập UEL (so với mã SV / mã cán bộ) →
 * email (chỉ khi PSC không báo email chưa xác thực; tên đăng nhập dạng email cũng dùng ở bước này).
 * Nếu 1 định danh khớp > 1 tài khoản ⇒ từ chối (ambiguous), không đoán.
 */
@Injectable()
export class UelSsoAccountRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findLinkedUser(identity: SsoIdentity): Promise<SsoLinkResult> {
    const studentId = clean(identity.studentId);
    if (studentId) {
      const r = pick(await this.byCode(studentId), 'student_code');
      if (r) return r;
    }

    const servantNo = clean(identity.publicServantNumber);
    if (servantNo) {
      const rows = await this.dataSource.query<IdRow[]>(
        `SELECT id FROM users
          WHERE deleted_at IS NULL AND upper(employee_code) = upper($1)
          LIMIT 2`,
        [servantNo],
      );
      const r = pick(rows, 'employee_code');
      if (r) return r;
    }

    const userName = clean(identity.userName);
    const userNameIsEmail = !!userName && userName.includes('@');
    if (userName && !userNameIsEmail) {
      const r = pick(await this.byCode(userName), 'username_code');
      if (r) return r;
    }

    const email = (
      clean(identity.email) ?? (userNameIsEmail ? userName : null)
    )?.toLowerCase();
    if (email && identity.emailVerified !== false) {
      const rows = await this.dataSource.query<IdRow[]>(
        `SELECT id FROM users
          WHERE deleted_at IS NULL AND lower(email) = $1
          LIMIT 2`,
        [email],
      );
      const r = pick(rows, 'email');
      if (r) return r;
    }

    return { kind: 'not_found' };
  }

  /** Tài khoản có mã SV (students.student_code) hoặc mã cán bộ (users.employee_code) = code. */
  private byCode(code: string): Promise<IdRow[]> {
    return this.dataSource.query<IdRow[]>(
      `SELECT DISTINCT u.id
         FROM users u
        WHERE u.deleted_at IS NULL
          AND (u.id IN (SELECT s.user_id FROM students s
                         WHERE s.deleted_at IS NULL AND s.user_id IS NOT NULL
                           AND upper(s.student_code) = upper($1))
               OR upper(u.employee_code) = upper($1))
        LIMIT 2`,
      [code],
    );
  }
}

function clean(v: string | null | undefined): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

function pick(rows: IdRow[], matchedBy: SsoMatchedBy): SsoLinkResult | null {
  if (rows.length === 1)
    return { kind: 'linked', userId: rows[0].id, matchedBy };
  if (rows.length > 1) return { kind: 'ambiguous', matchedBy };
  return null;
}
