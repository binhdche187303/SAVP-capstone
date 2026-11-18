import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { MeetingExternalParticipantEntity } from '../../meetings/entities/meeting-external-participant.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuditLogSeverity } from '../../administration/entities/audit-log.entity.js';
import { GuestInviteService } from './guest-invite.service.js';
import { GuestEmailService } from './guest-email.service.js';
import { GuestLobbyService } from './guest-lobby.service.js';
import { GuestAccessCacheService } from './guest-access-cache.service.js';
import { GuestAccessConfigService } from '../config/guest-access-config.service.js';
import { GUEST_INVITE_METADATA_KEY } from '../constants/guest-access.constants.js';
import { GuestInviteMetadata } from '../types/guest-invite-metadata.type.js';
import { GUEST_ACCESS_ERROR_CODES } from '../constants/guest-access-error.constant.js';

const ADMIN_ROLES = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'];

export interface GuestSummary {
  externalParticipantId: string;
  fullName: string;
  organizationName: string | null;
  email: string | null;
  inviteStatus: GuestInviteMetadata['status'] | 'not_invited';
  lobbyStatus: string | null;
}

/**
 * GuestManagementService — API phía HOST quản lý lời mời/phòng chờ khách.
 *
 * Ownership-or-admin: Host của ĐÚNG meeting đó, hoặc Business/System Admin
 * bypass (mirror pattern `issueMinutes`/`shareMinutes`). Permission RBAC
 * (`meeting.guest.*`) là điều kiện CẦN — check ownership ở đây là điều kiện ĐỦ.
 */
@Injectable()
export class GuestManagementService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly guestInviteService: GuestInviteService,
    private readonly guestEmailService: GuestEmailService,
    private readonly guestLobbyService: GuestLobbyService,
    private readonly cache: GuestAccessCacheService,
    private readonly config: GuestAccessConfigService,
    private readonly authzReadRepository: AuthzReadRepository,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async listGuests(meetingId: string, userId: string): Promise<GuestSummary[]> {
    const meeting = await this.assertOwnershipOrAdmin(meetingId, userId);
    const externalParticipants = await this.dataSource
      .getRepository(MeetingExternalParticipantEntity)
      .find({ where: { meetingId: meeting.id } });

    const summaries: GuestSummary[] = [];
    for (const ep of externalParticipants) {
      const guestInvite = ep.metadataJson?.[GUEST_INVITE_METADATA_KEY] as
        | GuestInviteMetadata
        | undefined;
      const lobbyStatus = await this.cache.getLobbyStatus(ep.id);
      summaries.push({
        externalParticipantId: ep.id,
        fullName: ep.fullName,
        organizationName: ep.organizationName ?? null,
        email: ep.email ?? null,
        inviteStatus: guestInvite?.status ?? 'not_invited',
        lobbyStatus,
      });
    }
    return summaries;
  }

  async listLobby(meetingId: string, userId: string): Promise<string[]> {
    const meeting = await this.assertOwnershipOrAdmin(meetingId, userId);
    return this.guestLobbyService.listWaiting(meeting.id);
  }

  async admit(
    meetingId: string,
    externalParticipantId: string,
    userId: string,
  ): Promise<void> {
    const meeting = await this.assertOwnershipOrAdmin(meetingId, userId);
    await this.guestLobbyService.admit(meeting.id, externalParticipantId);
    await this.auditLogsService.logAction({
      userId,
      actionType: 'guest_admitted',
      entityType: 'meeting_external_participant',
      entityId: externalParticipantId,
      severity: AuditLogSeverity.INFO,
      metadataJson: { meetingId: meeting.id, externalParticipantId },
    });
  }

  async reject(
    meetingId: string,
    externalParticipantId: string,
    userId: string,
  ): Promise<void> {
    const meeting = await this.assertOwnershipOrAdmin(meetingId, userId);
    await this.guestLobbyService.reject(
      meeting.id,
      externalParticipantId,
      this.config.getSessionMaxHours() * 3600,
    );
    await this.auditLogsService.logAction({
      userId,
      actionType: 'guest_rejected',
      entityType: 'meeting_external_participant',
      entityId: externalParticipantId,
      severity: AuditLogSeverity.WARNING,
      metadataJson: { meetingId: meeting.id, externalParticipantId },
    });
  }

  /** Sinh lời mời MỚI (ghi đè cũ — link cũ mất hiệu lực ngay, FR-GLA-005/013) + gửi lại mail. */
  async resendInvite(
    meetingId: string,
    externalParticipantId: string,
    userId: string,
  ): Promise<void> {
    const meeting = await this.assertOwnershipOrAdmin(meetingId, userId);
    const externalParticipant = await this.dataSource
      .getRepository(MeetingExternalParticipantEntity)
      .findOne({ where: { id: externalParticipantId, meetingId: meeting.id } });

    if (!externalParticipant) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy khách trong cuộc họp này.',
        error: { code: 'EXTERNAL_PARTICIPANT_NOT_FOUND', details: {} },
      });
    }
    if (!externalParticipant.email) {
      throw new NotFoundException({
        success: false,
        message: 'Khách chưa có email, không thể gửi lời mời.',
        error: {
          code: GUEST_ACCESS_ERROR_CODES.GUEST_EMAIL_MISSING,
          details: {},
        },
      });
    }

    // Thu hồi phiên hiện tại (nếu có) trước khi cấp lời mời mới — tránh 2
    // link cùng sống song song dù chỉ trong khoảnh khắc.
    const currentJti = await this.cache.getCurrentJti(externalParticipantId);
    if (currentJti) {
      await this.cache.revokeSession(
        currentJti,
        this.config.getSessionMaxHours() * 3600,
      );
    }

    const issued = await this.guestInviteService.issueInvite(
      this.dataSource.manager,
      {
        externalParticipantId,
        email: externalParticipant.email,
        meetingEndTime: meeting.endTime,
        issuedBy: userId,
      },
    );

    const host = meeting.hostId
      ? await this.dataSource
          .getRepository(UserEntity)
          .findOne({ where: { id: meeting.hostId } })
      : null;

    await this.guestEmailService.sendInviteLink({
      to: issued.email,
      meetingTitle: meeting.title,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      hostName: host?.fullName ?? 'Chưa xác định',
      link: issued.link,
    });

    await this.auditLogsService.logAction({
      userId,
      actionType: 'guest_invite_resent',
      entityType: 'meeting_external_participant',
      entityId: externalParticipantId,
      severity: AuditLogSeverity.INFO,
      metadataJson: { meetingId: meeting.id, externalParticipantId },
    });
  }

  async revokeAccess(
    meetingId: string,
    externalParticipantId: string,
    userId: string,
  ): Promise<void> {
    const meeting = await this.assertOwnershipOrAdmin(meetingId, userId);

    await this.cache.setInviteInvalidAfter(externalParticipantId);
    const currentJti = await this.cache.getCurrentJti(externalParticipantId);
    if (currentJti) {
      await this.cache.revokeSession(
        currentJti,
        this.config.getSessionMaxHours() * 3600,
      );
    }
    await this.guestInviteService.markRevoked(externalParticipantId);

    await this.auditLogsService.logAction({
      userId,
      actionType: 'guest_access_revoked',
      entityType: 'meeting_external_participant',
      entityId: externalParticipantId,
      severity: AuditLogSeverity.WARNING,
      metadataJson: { meetingId: meeting.id, externalParticipantId },
    });
  }

  private async assertOwnershipOrAdmin(
    meetingId: string,
    userId: string,
  ): Promise<MeetingEntity> {
    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: meetingId } });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy cuộc họp.',
        error: { code: 'MEETING_NOT_FOUND', details: {} },
      });
    }

    const { roles } =
      await this.authzReadRepository.getEffectiveRolesAndPermissions(userId);
    const isAdmin = roles.some((r) => ADMIN_ROLES.includes(r));
    const isHost = meeting.hostId === userId;

    if (!isAdmin && !isHost) {
      throw new ForbiddenException({
        success: false,
        message: 'Bạn không phải chủ trì của cuộc họp này.',
        error: {
          code: GUEST_ACCESS_ERROR_CODES.NOT_MEETING_HOST,
          details: {},
        },
      });
    }

    return meeting;
  }
}
