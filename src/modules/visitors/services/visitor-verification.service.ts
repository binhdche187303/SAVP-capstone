import { ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { randomInt, randomUUID, createHash } from 'crypto';
import { RedisService } from '../../redis/redis.service.js';
import { FaceProfileService } from '../../accounts/services/face-profile.service.js';
import { normalizeVnPhone } from '../domain/phone.util.js';

interface VerificationSession {
  visitorId: string;
  contact: string;
  otpHash: string;
  attempts: number;
}

@Injectable()
export class VisitorVerificationService {
  private readonly logger = new Logger(VisitorVerificationService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    private readonly faceProfiles: FaceProfileService,
  ) {}

  async request(contactInput: string) {
    const contact = this.normalizeContact(contactInput);
    const visitor = await this.findVisitor(contact);
    if (!visitor) throw new NotFoundException({ success: false, message: 'Không tìm thấy thông tin khách đã đăng ký', error: { code: 'VISITOR_NOT_FOUND', details: {} } });

    const devMode = this.config.get<boolean>('ZALO_ZBS_DEV_MODE', false)
      && this.config.get<string>('NODE_ENV', 'development') !== 'production';
    const otp = devMode
      ? this.config.get<string>('ZALO_ZBS_DEV_OTP', '123456')
      : randomInt(100000, 1000000).toString();
    const verificationId = randomUUID();
    const ttl = this.config.get<number>('VISITOR_VERIFICATION_TTL_SECONDS', 300);
    if (devMode) {
      this.logger.warn(`[DEV] Bỏ qua Zalo OA, mã xác thực test cho ${this.maskContact(contact)}: ${otp}`);
    } else {
      await this.sendZaloTemplate(visitor.phone_number, otp);
    }
    await this.redis.setJsonWithTtl(`visitor:verification:${verificationId}`, {
      visitorId: visitor.id, contact, otpHash: this.hash(otp), attempts: 0,
    } satisfies VerificationSession, ttl);
    return {
      verificationId,
      channel: 'zalo_zbs',
      maskedContact: this.maskContact(contact),
      expiresInSeconds: ttl,
      ...(devMode ? { demoCode: otp } : {}),
    };
  }

  async verify(verificationId: string, code: string) {
    const key = `visitor:verification:${verificationId}`;
    const session = await this.redis.getJson<VerificationSession>(key);
    if (!session) throw new ConflictException({ success: false, message: 'Mã xác thực đã hết hạn hoặc không hợp lệ', error: { code: 'VISITOR_VERIFICATION_EXPIRED', details: {} } });
    if (session.attempts >= this.config.get<number>('VISITOR_VERIFICATION_MAX_ATTEMPTS', 5)) {
      await this.redis.del(key);
      throw new ConflictException({ success: false, message: 'Bạn đã nhập sai quá số lần cho phép', error: { code: 'VISITOR_VERIFICATION_BLOCKED', details: {} } });
    }
    if (this.hash(code) !== session.otpHash) {
      session.attempts += 1;
      await this.redis.setJsonWithTtl(key, session, Math.max(1, await this.redis.ttl(key)));
      throw new ConflictException({ success: false, message: 'Mã xác thực không đúng', error: { code: 'VISITOR_VERIFICATION_INVALID', details: {} } });
    }
    await this.redis.del(key);
    const rows = await this.dataSource.query(
      `SELECT vis.id, vis.full_name, vis.id_number, vis.phone_number, vis.email, vis.organization,
              (SELECT fp.primary_image_file_id FROM face_profiles fp
               WHERE fp.user_id = vis.user_id AND fp.deleted_at IS NULL AND fp.primary_image_file_id IS NOT NULL
               ORDER BY fp.last_updated_at DESC NULLS LAST, fp.enrolled_at DESC NULLS LAST LIMIT 1) AS face_media_id,
              EXISTS (
                SELECT 1 FROM face_profiles fp
                WHERE fp.user_id = vis.user_id AND fp.deleted_at IS NULL AND fp.primary_image_file_id IS NOT NULL
              ) AS has_face_profile
       FROM visitors vis WHERE vis.id = $1 AND vis.deleted_at IS NULL`,
      [session.visitorId],
    );
    const visitor = rows[0];
    if (!visitor) throw new NotFoundException({ success: false, message: 'Thông tin khách không còn tồn tại', error: { code: 'VISITOR_NOT_FOUND', details: {} } });
    const photoPreview = visitor.face_media_id ? await this.faceProfiles.getMediaDataUrl(visitor.face_media_id) : null;
    return { verified: true, verifiedAt: new Date().toISOString(), visitor: { fullName: visitor.full_name, idNumber: visitor.id_number || '', phone: visitor.phone_number, email: visitor.email || '', organization: visitor.organization || '', plateNumber: '', photo: null, photoPreview, hasFaceProfile: visitor.has_face_profile === true && Boolean(photoPreview) } };
  }

  private async findVisitor(contact: string) {
    const rows = await this.dataSource.query(
      `SELECT id, full_name, id_number, phone_number, email, organization FROM visitors
       WHERE deleted_at IS NULL AND (phone_number = $1 OR lower(email) = lower($2)) LIMIT 1`,
      [contact, contact],
    );
    return rows[0] ?? null;
  }

  private async sendZaloTemplate(phone: string, otp: string): Promise<void> {
    const enabled = this.config.get<boolean>('ZALO_ZBS_ENABLED', false);
    const token = this.config.get<string>('ZALO_ZBS_ACCESS_TOKEN', '');
    const templateId = this.config.get<string>('ZALO_ZBS_TEMPLATE_ID', '');
    if (!enabled || !token || !templateId) {
      throw new InternalServerErrorException({ success: false, message: 'Chưa cấu hình dịch vụ gửi mã Zalo OA', error: { code: 'ZALO_NOT_CONFIGURED', details: {} } });
    }
    const endpoint = this.config.get<string>('ZALO_ZBS_ENDPOINT', 'https://business.openapi.zalo.me/message/template');
    const expiresMinutes = Math.max(1, Math.ceil(this.config.get<number>('VISITOR_VERIFICATION_TTL_SECONDS', 300) / 60));
    const response = await fetch(`${endpoint}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phone: this.toZaloPhone(phone), template_id: templateId, template_data: { otp, expire_minutes: expiresMinutes }, tracking_id: `visitor-${randomUUID()}` }),
    });
    const body = await response.json().catch(() => null) as { error?: number; message?: string } | null;
    if (!response.ok || body?.error) {
      this.logger.error(`Zalo ZBS gửi OTP thất bại: HTTP ${response.status}, error=${body?.error ?? 'unknown'}`);
      throw new InternalServerErrorException({ success: false, message: 'Không thể gửi mã xác thực qua Zalo OA', error: { code: 'ZALO_SEND_FAILED', details: {} } });
    }
  }

  private normalizeContact(value: string): string {
    const raw = value.trim();
    if (/^\+?\d[\d\s().-]{8,}$/.test(raw)) return normalizeVnPhone(raw);
    return raw.toLowerCase();
  }

  private toZaloPhone(phone: string): string {
    return phone.startsWith('0') ? `84${phone.slice(1)}` : phone;
  }

  private hash(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }

  private maskContact(value: string): string {
    if (value.includes('@')) return `${value.slice(0, 2)}***${value.slice(value.indexOf('@'))}`;
    return `${value.slice(0, 3)}****${value.slice(-3)}`;
  }
}
