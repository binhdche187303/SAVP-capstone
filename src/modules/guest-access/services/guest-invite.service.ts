import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { GuestAccessConfigService } from '../config/guest-access-config.service.js';
import { GuestAccessCacheService } from './guest-access-cache.service.js';
import {
  GUEST_INVITE_METADATA_KEY,
  GuestInviteStatus,
} from '../constants/guest-access.constants.js';
import { GUEST_ACCESS_ERROR_CODES } from '../constants/guest-access-error.constant.js';
import {
  DUMMY_TOKEN_HASH,
  buildGuestInviteLink,
  generateGuestInviteSecret,
  hashGuestInviteSecret,
  parseGuestInviteToken,
  timingSafeEqualHash,
} from '../utils/guest-invite-token.util.js';
import {
  GuestInviteIssueResult,
  GuestInviteMetadata,
} from '../types/guest-invite-metadata.type.js';

export interface ResolvedGuestInvite {
  externalParticipant: MeetingExternalParticipantEntity;
  meeting: MeetingEntity;
  guestInvite: GuestInviteMetadata;
}

/**
 * GuestInviteService — vòng đời lời mời khách trong `metadata_json.guestInvite`.
 *
 * KHÔNG thêm bảng mới (quyết định đã chốt). Mọi thao tác ghi PHẢI dùng
 * `jsonb_set` ở tầng SQL (FR-GLA-041) — xem `writeGuestInviteMetadata()`.
 */
@Injectable()
export class GuestInviteService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: GuestAccessConfigService,
    private readonly cache: GuestAccessCacheService,
  ) {}

  /**
   * Sinh lời mời mới cho một khách. Nhận `EntityManager` để caller quyết định
   * ngữ cảnh transaction: `dataSource.manager` khi gọi độc lập (resend), hoặc
   * `EntityManager` của transaction `approve()` khi sinh lần đầu (FR-GLA-006).
   *
   * Ghi đè NGUYÊN KHỐI `guestInvite` cũ nếu có — mỗi khách chỉ có đúng 1 lời
   * mời hiệu lực tại một thời điểm (FR-GLA-005), khiến mã cũ mất hiệu lực
   * ngay lập tức.
   */
  async issueInvite(
    manager: EntityManager,
    params: {
      externalParticipantId: string;
      email: string;
      meetingEndTime: Date;
      issuedBy: string;
    },
  ): Promise<GuestInviteIssueResult> {
    const secret = generateGuestInviteSecret();
    const now = new Date();
    const expiresAt = new Date(
      params.meetingEndTime.getTime() +
        this.config.getInviteLinkTtlHours() * 3600 * 1000,
    );

    const guestInvite: GuestInviteMetadata = {
      tokenHash: hashGuestInviteSecret(secret),
      issuedAt: now.toISOString(),
      issuedBy: params.issuedBy,
      expiresAt: expiresAt.toISOString(),
      status: GuestInviteStatus.ACTIVE,
      invalidAfter: null,
      firstJoinedAt: null,
      lastJoinedAt: null,
    };

    await this.writeGuestInviteMetadata(
      manager,
      params.externalParticipantId,
      guestInvite,
    );

    return {
      externalParticipantId: params.externalParticipantId,
      email: params.email,
      secret,
      link: buildGuestInviteLink(
        this.config.getInviteBaseUrl(),
        params.externalParticipantId,
        secret,
      ),
      guestInvite,
    };
  }

  /**
   * Tra cứu + xác thực token link mời — dùng CHUNG cho cả 3 endpoint công
   * khai (xem invite / request OTP / verify OTP), theo đúng luồng validate
   * lặp lại ở plan.md mục 7.2-7.4 (bước 1-6/1-7).
   *
   * Trả cùng lỗi `GUEST_INVITE_INVALID` cho MỌI trường hợp "id không tồn tại"
   * hoặc "hash sai" (FR-GLA-028) — luôn thực hiện đủ bước hash + so sánh
   * timing-safe kể cả khi record không tồn tại, để giảm chênh lệch thời gian
   * phản hồi giữa 2 trường hợp (research.md rủi ro #3).
   */
  async resolveInvite(token: string): Promise<ResolvedGuestInvite> {
    const parsed = parseGuestInviteToken(token);
    if (!parsed) {
      throw this.invalidInvite();
    }

    const providedHash = hashGuestInviteSecret(parsed.secret);

    const externalParticipant = await this.dataSource
      .getRepository(MeetingExternalParticipantEntity)
      .findOne({
        where: { id: parsed.externalParticipantId },
        relations: { meeting: { host: true } },
      });

    if (!externalParticipant) {
      timingSafeEqualHash(providedHash, DUMMY_TOKEN_HASH);
      throw this.invalidInvite();
    }

    const guestInvite = externalParticipant.metadataJson?.[
      GUEST_INVITE_METADATA_KEY
    ] as GuestInviteMetadata | undefined;

    if (!guestInvite) {
      timingSafeEqualHash(providedHash, DUMMY_TOKEN_HASH);
      throw this.invalidInvite();
    }

    if (!timingSafeEqualHash(providedHash, guestInvite.tokenHash)) {
      throw this.invalidInvite();
    }

    if (guestInvite.status === GuestInviteStatus.REVOKED) {
      throw this.revokedInvite();
    }

    if (
      guestInvite.invalidAfter &&
      Date.now() > new Date(guestInvite.invalidAfter).getTime()
    ) {
      throw this.revokedInvite();
    }

    if (Date.now() > new Date(guestInvite.expiresAt).getTime()) {
      throw this.expiredInvite();
    }

    const meeting = externalParticipant.meeting;
    if (!meeting || meeting.deletedAt) {
      throw this.invalidInvite();
    }

    if (meeting.status === MeetingStatus.CANCELLED) {
      throw this.meetingCancelled();
    }

    return { externalParticipant, meeting, guestInvite };
  }

  /** Cập nhật trạng thái sau khi verify OTP thành công lần đầu/lần sau. */
  async markJoined(externalParticipantId: string): Promise<void> {
    const externalParticipant = await this.dataSource
      .getRepository(MeetingExternalParticipantEntity)
      .findOne({ where: { id: externalParticipantId } });
    const guestInvite = externalParticipant?.metadataJson?.[
      GUEST_INVITE_METADATA_KEY
    ] as GuestInviteMetadata | undefined;
    if (!guestInvite) return;

    const now = new Date().toISOString();
    const updated: GuestInviteMetadata = {
      ...guestInvite,
      status:
        guestInvite.status === GuestInviteStatus.ACTIVE
          ? GuestInviteStatus.USED
          : guestInvite.status,
      firstJoinedAt: guestInvite.firstJoinedAt ?? now,
      lastJoinedAt: now,
    };
    await this.writeGuestInviteMetadata(
      this.dataSource.manager,
      externalParticipantId,
      updated,
    );
  }

  /** Đặt `status = revoked`, `invalidAfter = now`. Dùng cho revoke/auto-revoke. */
  async markRevoked(externalParticipantId: string): Promise<void> {
    const externalParticipant = await this.dataSource
      .getRepository(MeetingExternalParticipantEntity)
      .findOne({ where: { id: externalParticipantId } });
    const guestInvite = externalParticipant?.metadataJson?.[
      GUEST_INVITE_METADATA_KEY
    ] as GuestInviteMetadata | undefined;
    if (!guestInvite) return;

    const updated: GuestInviteMetadata = {
      ...guestInvite,
      status: GuestInviteStatus.REVOKED,
      invalidAfter: new Date().toISOString(),
    };
    await this.writeGuestInviteMetadata(
      this.dataSource.manager,
      externalParticipantId,
      updated,
    );
  }

  /**
   * FR-GLA-015: thu hồi NGAY LẬP TỨC mọi phiên khách của một cuộc họp khi
   * meeting chuyển `cancelled`/`completed` — không chờ TTL tự nhiên hết hạn.
   *
   * BEST-EFFORT — gọi từ `cancelMeeting()`/`endMeeting()` SAU KHI transaction
   * chính đã commit; lỗi ở đây KHÔNG được rollback/chặn nghiệp vụ chính (mirror
   * pattern `writeNotificationFailureAudit`). Trả về số lời mời đã xử lý để
   * caller ghi audit/log nếu cần.
   */
  async revokeAllForMeeting(meetingId: string): Promise<number> {
    const externalParticipants = await this.dataSource
      .getRepository(MeetingExternalParticipantEntity)
      .find({ where: { meetingId } });

    let revokedCount = 0;
    for (const ep of externalParticipants) {
      const guestInvite = ep.metadataJson?.[GUEST_INVITE_METADATA_KEY] as
        | GuestInviteMetadata
        | undefined;
      if (!guestInvite || guestInvite.status === GuestInviteStatus.REVOKED) {
        continue;
      }

      await this.cache.setInviteInvalidAfter(ep.id);
      const currentJti = await this.cache.getCurrentJti(ep.id);
      if (currentJti) {
        await this.cache.revokeSession(
          currentJti,
          this.config.getSessionMaxHours() * 3600,
        );
      }
      await this.markRevoked(ep.id);
      revokedCount += 1;
    }
    return revokedCount;
  }

  /**
   * Ghi `metadata_json.guestInvite` bằng `jsonb_set` — BẮT BUỘC (FR-GLA-041).
   * KHÔNG đọc-sửa-ghi cả object trong JS/qua `repository.save()`, vì sẽ mất
   * dữ liệu khi 2 request ghi đồng thời và xóa nhầm các key khác của
   * `metadata_json`.
   */
  private async writeGuestInviteMetadata(
    manager: EntityManager,
    externalParticipantId: string,
    guestInvite: GuestInviteMetadata,
  ): Promise<void> {
    await manager.query(
      `UPDATE meeting_external_participants
       SET metadata_json = jsonb_set(
         COALESCE(metadata_json, '{}'::jsonb), '{${GUEST_INVITE_METADATA_KEY}}', $1::jsonb, true
       )
       WHERE id = $2`,
      [JSON.stringify(guestInvite), externalParticipantId],
    );
  }

  private invalidInvite(): BadRequestException {
    return new BadRequestException({
      success: false,
      message: 'Link mời không hợp lệ.',
      error: {
        code: GUEST_ACCESS_ERROR_CODES.GUEST_INVITE_INVALID,
        details: {},
      },
    });
  }

  private expiredInvite(): GoneException {
    return new GoneException({
      success: false,
      message: 'Link mời đã hết hạn.',
      error: {
        code: GUEST_ACCESS_ERROR_CODES.GUEST_INVITE_EXPIRED,
        details: {},
      },
    });
  }

  private revokedInvite(): GoneException {
    return new GoneException({
      success: false,
      message: 'Link mời đã bị thu hồi.',
      error: {
        code: GUEST_ACCESS_ERROR_CODES.GUEST_INVITE_REVOKED,
        details: {},
      },
    });
  }

  private meetingCancelled(): ConflictException {
    return new ConflictException({
      success: false,
      message: 'Cuộc họp đã bị hủy.',
      error: {
        code: GUEST_ACCESS_ERROR_CODES.GUEST_MEETING_CANCELLED,
        details: {},
      },
    });
  }
}
