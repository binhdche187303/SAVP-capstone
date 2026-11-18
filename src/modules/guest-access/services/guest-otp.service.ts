import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import * as crypto from 'crypto';
import { GuestInviteService } from './guest-invite.service.js';
import { GuestAccessCacheService } from './guest-access-cache.service.js';
import { GuestEmailService } from './guest-email.service.js';
import { GuestSessionService } from './guest-session.service.js';
import { GuestLobbyService } from './guest-lobby.service.js';
import { GuestAccessConfigService } from '../config/guest-access-config.service.js';
import { GUEST_ACCESS_ERROR_CODES } from '../constants/guest-access-error.constant.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuditLogSeverity } from '../../administration/entities/audit-log.entity.js';

export interface GuestInviteInfo {
  meetingTitle: string;
  startTime: Date;
  endTime: Date;
  hostName: string;
  maskedEmail: string;
  verificationMode: 'otp' | 'magic_click';
}

export interface GuestVerifyResult {
  guestToken: string;
  lobbyRequired: boolean;
  meetingId: string;
}

/**
 * GuestOtpService — luồng xem thông tin lời mời + gửi/xác minh OTP.
 *
 * Toàn bộ chống lạm dụng (đếm gửi/đếm sai/khóa tạm) dùng `RedisService` qua
 * `GuestAccessCacheService`. TUYỆT ĐỐI KHÔNG dùng `RateLimitGuard` hiện có
 * (`auth/guards/rate-limit.guard.ts`) — file đó là stub `return true`
 * (NFR-GLA-006).
 */
@Injectable()
export class GuestOtpService {
  constructor(
    private readonly guestInviteService: GuestInviteService,
    private readonly cache: GuestAccessCacheService,
    private readonly guestEmailService: GuestEmailService,
    private readonly guestSessionService: GuestSessionService,
    private readonly guestLobbyService: GuestLobbyService,
    private readonly config: GuestAccessConfigService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /** GET /guest/invites/:token — xem thông tin, KHÔNG đổi state nào. */
  async getInviteInfo(token: string): Promise<GuestInviteInfo> {
    const { externalParticipant, meeting } =
      await this.guestInviteService.resolveInvite(token);

    return {
      meetingTitle: meeting.title,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      hostName: meeting.host?.fullName ?? 'Chưa xác định',
      maskedEmail: maskEmail(externalParticipant.email ?? ''),
      verificationMode: this.config.getVerificationModeDefault(),
    };
  }

  /** POST /guest/invites/:token/otp — sinh + gửi OTP tới email đã lưu trong DB. */
  async requestOtp(token: string): Promise<void> {
    const { externalParticipant, meeting } =
      await this.guestInviteService.resolveInvite(token);
    this.assertWithinJoinWindow(meeting);

    const inviteId = externalParticipant.id;

    if (await this.cache.isOtpBlocked(inviteId)) {
      throw this.otpBlocked();
    }

    const sendCount = await this.cache.incrementOtpSendCount(inviteId);
    if (sendCount > this.config.getOtpMaxResends()) {
      throw this.tooManyOtpRequests();
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    await this.cache.setOtp(inviteId, otp);
    await this.cache.resetOtpAttempt(inviteId);

    await this.guestEmailService.sendOtp({
      to: externalParticipant.email as string,
      otp,
      meetingTitle: meeting.title,
    });

    await this.auditLogsService.logSecurityEvent({
      actionType: 'guest_otp_requested',
      entityType: 'meeting_external_participant',
      entityId: inviteId,
      severity: AuditLogSeverity.INFO,
      metadataJson: { externalParticipantId: inviteId, meetingId: meeting.id },
    });
  }

  /** POST /guest/invites/:token/verify — xác minh OTP, cấp phiên khách. */
  async verifyOtp(token: string, otp: string): Promise<GuestVerifyResult> {
    const { externalParticipant, meeting } =
      await this.guestInviteService.resolveInvite(token);
    this.assertWithinJoinWindow(meeting);

    const inviteId = externalParticipant.id;

    if (await this.cache.isOtpBlocked(inviteId)) {
      throw this.otpBlocked();
    }

    const storedHash = await this.cache.getOtpHash(inviteId);
    if (!storedHash) {
      throw this.otpInvalid();
    }

    const providedHash = crypto
      .createHash('sha256')
      .update(otp, 'utf8')
      .digest('hex');

    if (providedHash !== storedHash) {
      const attempts = await this.cache.incrementOtpAttempt(inviteId);
      if (attempts >= this.config.getOtpMaxVerifyAttempts()) {
        await this.cache.blockOtp(inviteId);
        await this.cache.deleteOtp(inviteId);
      }
      await this.auditLogsService.logSecurityEvent({
        actionType: 'guest_otp_verify_failed',
        entityType: 'meeting_external_participant',
        entityId: inviteId,
        severity: AuditLogSeverity.WARNING,
        metadataJson: {
          externalParticipantId: inviteId,
          meetingId: meeting.id,
        },
      });
      throw this.otpInvalid();
    }

    await this.cache.deleteOtp(inviteId);
    await this.cache.resetOtpAttempt(inviteId);
    await this.guestInviteService.markJoined(inviteId);

    const {
      token: guestToken,
      jti,
      expiresInSeconds,
    } = await this.guestSessionService.signGuestToken({
      externalParticipantId: inviteId,
      meetingId: meeting.id,
    });
    await this.cache.setSession(jti, expiresInSeconds);
    await this.cache.setCurrentJti(inviteId, jti, expiresInSeconds);

    const lobbyEnabled = await this.guestLobbyService.isLobbyEnabled(
      meeting.id,
    );
    if (lobbyEnabled) {
      await this.guestLobbyService.enqueue(meeting.id, inviteId);
    } else {
      await this.guestLobbyService.admitDirectly(inviteId);
    }

    await this.auditLogsService.logSecurityEvent({
      actionType: 'guest_otp_verified',
      entityType: 'meeting_external_participant',
      entityId: inviteId,
      severity: AuditLogSeverity.INFO,
      metadataJson: { externalParticipantId: inviteId, meetingId: meeting.id },
    });

    return { guestToken, lobbyRequired: lobbyEnabled, meetingId: meeting.id };
  }

  /**
   * FR-GLA-017: chỉ áp dụng cho gửi/xác minh OTP MỚI (chưa có phiên) — KHÔNG
   * áp dụng khi đọc nội dung sau khi đã admit (xem `GuestMeetingScopeGuard`
   * doc — 2 cơ chế tách biệt, không trùng lặp).
   */
  private assertWithinJoinWindow(meeting: MeetingEntity): void {
    const beforeMs = this.config.getJoinWindowBeforeMinutes() * 60_000;
    const afterMs = this.config.getJoinWindowAfterMinutes() * 60_000;
    const lowerBound = meeting.startTime.getTime() - beforeMs;
    const upperBound = meeting.endTime.getTime() + afterMs;
    const now = Date.now();
    if (now < lowerBound || now > upperBound) {
      throw new ConflictException({
        success: false,
        message: 'Ngoài thời gian cho phép tham gia cuộc họp.',
        error: {
          code: GUEST_ACCESS_ERROR_CODES.GUEST_JOIN_WINDOW_CLOSED,
          details: {},
        },
      });
    }
  }

  private otpInvalid(): ConflictException {
    return new ConflictException({
      success: false,
      message: 'Mã xác nhận không hợp lệ hoặc đã hết hạn.',
      error: { code: GUEST_ACCESS_ERROR_CODES.GUEST_OTP_INVALID, details: {} },
    });
  }

  private otpBlocked(): HttpException {
    return new HttpException(
      {
        success: false,
        message: 'Lời mời tạm thời bị khóa do nhập sai quá nhiều lần.',
        error: {
          code: GUEST_ACCESS_ERROR_CODES.GUEST_OTP_BLOCKED,
          details: {},
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private tooManyOtpRequests(): HttpException {
    return new HttpException(
      {
        success: false,
        message:
          'Bạn đã yêu cầu mã xác nhận quá nhiều lần. Vui lòng thử lại sau.',
        error: {
          code: GUEST_ACCESS_ERROR_CODES.GUEST_OTP_TOO_MANY_REQUESTS,
          details: {},
        },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** ng***@abc.com — giữ 2 ký tự đầu local-part + domain đầy đủ. */
export function maskEmail(email: string): string {
  const atIndex = email.indexOf('@');
  if (atIndex <= 0) return '***';
  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex);
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(local.length - visible.length, 3))}${domain}`;
}
