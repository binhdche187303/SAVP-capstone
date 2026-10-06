import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { PersonControlListEntity } from '../entities/person-control-list.entity.js';
import { AlertRulesService } from './alert-rules.service.js';
import { AlertsService } from './alerts.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
  NotificationPriority,
} from '../../notifications/entities/notification.entity.js';
import type { AlertSeverity } from '../dto/record-alert.input.js';

/**
 * PersonWatchlistCheckService (PWL-001 / UC-125) — điểm vào DUY NHẤT cho `face-access`
 * gọi khi có event nhận diện. CHỈ nhận `userId` (chốt qua AskUserQuestion — spec §1 câu 3).
 *
 * Mirror `VehicleControlAlertService` (UC9): throttle in-memory 300s/userId →
 * `AlertRulesService.findEffectiveRule('person_watchlist_match', zoneId thiết bị)` → suppressed → skip
 * → `AlertsService.recordAlert()` (severity = `match.priority` TRỰC TIẾP, spec §2.1) →
 * notification. NotThrow TOÀN BỘ (R7 crux) — lỗi cảnh báo KHÔNG được phá luồng nhận diện
 * chính của `face-access`.
 *
 * ARCH-02: KHÔNG import `FaceAccessModule` — nhận `userId` qua tham số, KHÔNG tự đi hỏi
 * module khác.
 */
/** Nơi nhận diện đối tượng (thiết bị face + phòng gắn thiết bị). */
export interface PersonWatchlistLocation {
  deviceId: string;
  roomId: string | null;
}

@Injectable()
export class PersonWatchlistCheckService {
  private readonly logger = new Logger(PersonWatchlistCheckService.name);
  private static readonly DEFAULT_THROTTLE_SECONDS = 300;
  private readonly lastAlertAt = new Map<string, number>();

  constructor(
    @InjectRepository(PersonControlListEntity)
    private readonly repo: Repository<PersonControlListEntity>,
    private readonly alertRulesService: AlertRulesService,
    private readonly alertsService: AlertsService,
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async checkPersonWatchlist(
    userId: string,
    location?: PersonWatchlistLocation,
  ): Promise<void> {
    try {
      const match = await this.repo.findOne({
        where: { userId, active: true, deletedAt: IsNull() },
      });
      if (!match) return;

      const throttleMs =
        this.configService.get<number>(
          'PERSON_WATCHLIST_ALERT_THROTTLE_SECONDS',
          PersonWatchlistCheckService.DEFAULT_THROTTLE_SECONDS,
        ) * 1000;
      const now = Date.now();
      const last = this.lastAlertAt.get(userId);
      if (last !== undefined && now - last < throttleMs) {
        return; // trong window → bỏ qua (tránh spam), KHÔNG cập nhật mốc gốc.
      }
      this.lastAlertAt.set(userId, now);

      // Vị trí nhận diện (thiết bị/phòng/khu vực) — để biết đối tượng đang ở đâu.
      // zoneId theo khu vực của thiết bị → mỗi khu vực 1 alert mở riêng (null = toàn hệ thống).
      const { deviceCode, roomName, zoneId } =
        await this.resolveLocation(location);

      const { suppressed, rule } =
        await this.alertRulesService.findEffectiveRule(
          'person_watchlist_match',
          zoneId,
        );
      if (suppressed) return; // AF1: rule tắt tường minh — dừng cả recordAlert lẫn notification.

      const where = roomName
        ? ` tại phòng ${roomName}`
        : deviceCode
          ? ` tại thiết bị ${deviceCode}`
          : '';

      const { alert, isNew } = await this.alertsService.recordAlert({
        alertType: 'person_watchlist_match',
        zoneId,
        severity: match.priority as AlertSeverity,
        ruleId: rule?.id ?? null,
        payloadJson: {
          personControlListEntryId: match.id,
          displayName: match.displayName,
          listType: match.listType,
          reason: match.reason,
          userId,
          deviceId: location?.deviceId ?? null,
          deviceCode,
          roomId: location?.roomId ?? null,
          roomName,
        },
      });

      // Chống spam: bump alert đang mở của CHÍNH người này (cùng khu vực) → không báo lại.
      // Alert mở thuộc người KHÁC (bump giữ payload gốc) → vẫn báo để không bỏ sót.
      if (!isNew && alert.payloadJson?.userId === userId) return;

      const recipients = await this.resolveRecipients();
      if (recipients.length === 0) {
        this.logger.warn(
          `person watchlist match (userId=${userId}) — không resolve được recipient, skip notification.`,
        );
        return;
      }

      await this.notificationsService.createNotification({
        notificationType: NotificationType.PERSON_WATCHLIST_MATCH,
        channel: NotificationChannel.IN_APP,
        subject: 'Cảnh báo: người trong danh sách theo dõi',
        content:
          `${match.displayName} (${match.listType}) vừa được nhận diện${where}.` +
          (match.reason ? ` Lý do: ${match.reason}.` : ''),
        priority:
          match.priority === 'critical' || match.priority === 'high'
            ? NotificationPriority.HIGH
            : NotificationPriority.NORMAL,
        recipientScope: 'user_list',
        recipientUserIds: recipients,
        payloadJson: {
          userId,
          displayName: match.displayName,
          listType: match.listType,
          priority: match.priority,
          deviceCode,
          roomName,
        },
      });
    } catch (e) {
      // NotThrow — lỗi cảnh báo KHÔNG được phá luồng nhận diện chính (R7 crux).
      this.logger.error(
        `checkPersonWatchlist failed (userId=${userId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  private async resolveLocation(location?: PersonWatchlistLocation): Promise<{
    deviceCode: string | null;
    roomName: string | null;
    zoneId: string | null;
  }> {
    if (!location?.deviceId)
      return { deviceCode: null, roomName: null, zoneId: null };
    const rows: Array<{
      device_code: string | null;
      room_name: string | null;
      zone_id: string | null;
    }> = await this.dataSource.manager.query(
      `SELECT d.device_code, r.room_name, d.zone_id
         FROM iot_devices d
         LEFT JOIN rooms r ON r.id = COALESCE($2::uuid, d.room_id)
        WHERE d.id = $1
        LIMIT 1`,
      [location.deviceId, location.roomId ?? null],
    );
    return {
      deviceCode: rows[0]?.device_code ?? null,
      roomName: rows[0]?.room_name ?? null,
      zoneId: rows[0]?.zone_id ?? null,
    };
  }

  /** Recipient = đúng bộ role vận hành Trung tâm cảnh báo (chốt qua AskUserQuestion). */
  private async resolveRecipients(): Promise<string[]> {
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT DISTINCT u.id
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
         JOIN roles r ON r.id = ur.role_id
        WHERE r.role_code IN ('MANAGER','BUSINESS_ADMIN','SYSTEM_ADMIN')
          AND u.deleted_at IS NULL`,
    );
    return rows.map((r) => r.id);
  }
}
