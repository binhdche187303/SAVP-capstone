import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';
import { GuestAccessCacheService } from './guest-access-cache.service.js';
import { GuestAccessConfigService } from '../config/guest-access-config.service.js';
import { GuestLobbyStatus } from '../constants/guest-access.constants.js';
import { GUEST_ACCESS_ERROR_CODES } from '../constants/guest-access-error.constant.js';

const GLOBAL_LOBBY_CONFIG_KEY = 'guest_access.lobby_enabled';
const meetingLobbyConfigKey = (meetingId: string): string =>
  `guest_access.lobby_enabled:${meetingId}`;

/**
 * GuestLobbyService — phòng chờ (lobby) do host duyệt trước khi khách được
 * đọc nội dung cuộc họp (spec mục 7.2, quyết định đã chốt #2).
 *
 * `meetings` KHÔNG có cột `metadata_json` (đã xác nhận khi đọc entity) nên
 * override cấp-cuộc-họp lưu trong `system_configs` với key riêng theo
 * `meetingId` (fallback đã ghi trong data-model.md mục 1) — độ ưu tiên đọc:
 * override cấp meeting → mặc định toàn hệ thống (`system_configs`) → default
 * env (`GUEST_ACCESS_LOBBY_ENABLED_DEFAULT`), mirror pattern
 * `NoShowConfigService`.
 */
@Injectable()
export class GuestLobbyService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cache: GuestAccessCacheService,
    private readonly config: GuestAccessConfigService,
  ) {}

  async isLobbyEnabled(meetingId: string): Promise<boolean> {
    const repo = this.dataSource.getRepository(SystemConfigEntity);

    const override = await repo.findOne({
      where: { configKey: meetingLobbyConfigKey(meetingId), isActive: true },
    });
    if (override?.configValue === 'true' || override?.configValue === 'false') {
      return override.configValue === 'true';
    }

    const global = await repo.findOne({
      where: { configKey: GLOBAL_LOBBY_CONFIG_KEY, isActive: true },
    });
    if (global?.configValue === 'true' || global?.configValue === 'false') {
      return global.configValue === 'true';
    }

    return this.config.getLobbyEnabledDefault();
  }

  /** Đưa khách vào hàng chờ, đặt trạng thái `waiting`. */
  async enqueue(
    meetingId: string,
    externalParticipantId: string,
  ): Promise<void> {
    await this.cache.addToLobby(meetingId, externalParticipantId);
  }

  /** Bỏ qua phòng chờ — dùng khi lobby đang TẮT (FR-GLA-019). */
  async admitDirectly(externalParticipantId: string): Promise<void> {
    await this.cache.setLobbyStatus(
      externalParticipantId,
      GuestLobbyStatus.ADMITTED,
    );
  }

  async getStatus(
    externalParticipantId: string,
  ): Promise<GuestLobbyStatus | null> {
    return this.cache.getLobbyStatus(externalParticipantId);
  }

  /**
   * Đọc trạng thái lobby, nhưng tự động duyệt khách nếu cuộc họp đã tới giờ
   * bắt đầu (`meeting.start_time`) — khách không còn phải chờ host bấm
   * "Duyệt" khi đã tới giờ họp, host chỉ cần duyệt sớm cho khách vào trước
   * giờ nếu muốn.
   */
  async getStatusWithAutoAdmit(
    meetingId: string,
    externalParticipantId: string,
    meetingStartTime: Date | undefined,
  ): Promise<GuestLobbyStatus | null> {
    const status = await this.getStatus(externalParticipantId);
    const meetingHasStarted =
      !!meetingStartTime && Date.now() >= meetingStartTime.getTime();
    if (status === GuestLobbyStatus.WAITING && meetingHasStarted) {
      await this.admit(meetingId, externalParticipantId);
      return GuestLobbyStatus.ADMITTED;
    }
    return status;
  }

  async listWaiting(meetingId: string): Promise<string[]> {
    return this.cache.listLobby(meetingId);
  }

  /** Host duyệt khách — chỉ gọi sau khi đã kiểm tra ownership-or-admin ở service gọi. */
  async admit(meetingId: string, externalParticipantId: string): Promise<void> {
    await this.cache.removeFromLobby(meetingId, externalParticipantId);
    await this.cache.setLobbyStatus(
      externalParticipantId,
      GuestLobbyStatus.ADMITTED,
    );
  }

  /**
   * Host từ chối khách — thu hồi NGAY phiên hiện tại (nếu có) qua
   * `current_jti`, không chờ TTL tự nhiên hết hạn.
   */
  async reject(
    meetingId: string,
    externalParticipantId: string,
    sessionTtlSeconds: number,
  ): Promise<void> {
    await this.cache.removeFromLobby(meetingId, externalParticipantId);
    await this.cache.setLobbyStatus(
      externalParticipantId,
      GuestLobbyStatus.REJECTED,
    );
    const currentJti = await this.cache.getCurrentJti(externalParticipantId);
    if (currentJti) {
      await this.cache.revokeSession(currentJti, sessionTtlSeconds);
    }
  }

  /**
   * Guard cho GuestContentService — chặn đọc nội dung khi chưa được duyệt.
   *
   * `waiting` → 403 (đang chờ, khách biết lý do). `rejected` hoặc `null`
   * (chưa từng vào hàng chờ — ví dụ Redis bị flush) → 401 `GUEST_SESSION_INVALID`,
   * fail-closed theo NFR-GLA-009 (không chắc chắn thì từ chối).
   */
  assertAdmitted(status: GuestLobbyStatus | null): void {
    if (status === GuestLobbyStatus.WAITING) {
      throw new ForbiddenException({
        success: false,
        message: 'Vui lòng chờ chủ trì duyệt trước khi vào cuộc họp.',
        error: {
          code: GUEST_ACCESS_ERROR_CODES.GUEST_LOBBY_PENDING,
          details: {},
        },
      });
    }
    if (status !== GuestLobbyStatus.ADMITTED) {
      throw new UnauthorizedException({
        success: false,
        message: 'Phiên truy cập không hợp lệ hoặc đã hết hạn.',
        error: {
          code: GUEST_ACCESS_ERROR_CODES.GUEST_SESSION_INVALID,
          details: {},
        },
      });
    }
  }
}
