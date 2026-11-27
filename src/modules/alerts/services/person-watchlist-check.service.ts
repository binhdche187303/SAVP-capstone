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
 * Mirror `VehicleControlAlertService` (UC9): throttle in-memory 300s/(userId, khu vực) →
 * `AlertRulesService.findEffectiveRule('person_watchlist_match', zoneId thiết bị)` → suppressed → skip
 * → `AlertsService.recordAlert()` (severity = `match.priority` TRỰC TIẾP, spec §2.1) →
 * notification. Mỗi người 1 alert mở riêng / khu vực (`dedupeKey = userId`).
 * Caller gọi KHÔNG await (`void`) — callback nhận diện trả lời thiết bị ngay. NotThrow TOÀN BỘ (R7 crux) — lỗi cảnh báo KHÔNG được phá luồng nhận diện
 * chính của `face-access`.
 *
 * ARCH-02: KHÔNG import `FaceAccessModule` — nhận `userId` qua tham số, KHÔNG tự đi hỏi
 * module khác.
 */
/** Nơi nhận diện đối tượng (thiết bị face + phòng gắn thiết bị). */
export interface PersonWatchlistLocation {
  deviceId?: string | null;
  roomId?: string | null;
  /** Camera HGVision (không có FaceGate): kênh + tên camera để biết khu vực và xem lại video. */
  channelId?: number | null;
  cameraName?: string | null;
  /** Thời điểm camera ghi nhận (ISO) — để nút xem lại tua đúng đoạn. */
  eventTime?: string | null;
}

const LIST_LABEL: Record<string, string> = {
  watchlist: 'Theo dõi',
  blocklist: 'Danh sách đen',
};
const PRIORITY_LABEL: Record<string, string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  critical: 'Nghiêm trọng',
};

@Injectable()
export class PersonWatchlistCheckService {
  private readonly logger = new Logger(PersonWatchlistCheckService.name);
  private static readonly DEFAULT_THROTTLE_SECONDS = 300;
  /** Trần số mục throttle — vượt thì dọn mục hết hạn (chống rò bộ nhớ). */
  private static readonly MAX_THROTTLE_ENTRIES = 5_000;
  private static readonly RECIPIENT_CACHE_MS = 60_000;
  /** Key `${userId}:${zoneId ?? 'global'}` → mốc báo gần nhất. */
  private readonly lastAlertAt = new Map<string, number>();
  private recipientCache: { value: string[]; expiresAt: number } | null = null;

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
      await this.alertFor(match, location);
    } catch (e) {
      // NotThrow — lỗi cảnh báo KHÔNG được phá luồng nhận diện chính (R7 crux).
      this.logger.error(
        `checkPersonWatchlist failed (userId=${userId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  /**
   * Người ngoài (không tài khoản) đã đẩy lên HGVision với định danh `WL-<entryId>` —
   * camera nhận ra → cảnh báo theo chính hồ sơ giám sát. NotThrow.
   */
  async checkPersonControlEntry(
    entryId: string,
    location?: PersonWatchlistLocation,
  ): Promise<void> {
    try {
      const match = await this.repo.findOne({
        where: { id: entryId, active: true, deletedAt: IsNull() },
      });
      if (!match) return;
      await this.alertFor(match, location);
    } catch (e) {
      this.logger.error(
        `checkPersonControlEntry failed (entry=${entryId}): ${
          e instanceof Error ? e.message : 'unknown'
        }`,
      );
    }
  }

  private async alertFor(
    match: PersonControlListEntity,
    location?: PersonWatchlistLocation,
  ): Promise<void> {
    const subjectId = match.userId ?? match.id;
    {
      // Vị trí nhận diện (thiết bị/phòng/khu vực) — để biết đối tượng đang ở đâu.
      // zoneId theo khu vực của thiết bị (null = toàn hệ thống).
      const { deviceCode, roomName, zoneId } =
        await this.resolveLocation(location);

      // Chống spam theo NGƯỜI + KHU VỰC: sang khu vực khác vẫn được báo ngay.
      const throttleMs =
        this.configService.get<number>(
          'PERSON_WATCHLIST_ALERT_THROTTLE_SECONDS',
          PersonWatchlistCheckService.DEFAULT_THROTTLE_SECONDS,
        ) * 1000;
      const now = Date.now();
      const key = `${subjectId}:${zoneId ?? 'global'}`;
      const last = this.lastAlertAt.get(key);
      if (last !== undefined && now - last < throttleMs) {
        this.logger.log(
          `[WATCHLIST] ${match.displayName} @ ${zoneId ?? 'toàn hệ thống'}: trong ${throttleMs / 1000}s chống spam → bỏ qua`,
        );
        return; // trong window → bỏ qua (tránh spam), KHÔNG cập nhật mốc gốc.
      }
      this.pruneThrottle(now, throttleMs);
      this.lastAlertAt.set(key, now);

      const { suppressed, rule } =
        await this.alertRulesService.findEffectiveRule(
          'person_watchlist_match',
          zoneId,
        );
      if (suppressed) return; // AF1: rule tắt tường minh — dừng cả recordAlert lẫn notification.

      const where = roomName
        ? ` tại phòng ${roomName}`
        : location?.cameraName
          ? ` tại camera ${location.cameraName}`
          : deviceCode
            ? ` tại thiết bị ${deviceCode}`
            : '';

      const { isNew } = await this.alertsService.recordAlert({
        alertType: 'person_watchlist_match',
        zoneId,
        dedupeKey: subjectId,
        severity: match.priority as AlertSeverity,
        ruleId: rule?.id ?? null,
        payloadJson: {
          personControlListEntryId: match.id,
          displayName: match.displayName,
          listType: match.listType,
          reason: match.reason,
          userId: match.userId,
          deviceId: location?.deviceId ?? null,
          deviceCode,
          roomId: location?.roomId ?? null,
          roomName,
          channelId: location?.channelId ?? null,
          cameraName: location?.cameraName ?? null,
          eventTime: location?.eventTime ?? null,
        },
      });

      // Alert riêng theo người + khu vực → cộng dồn = chính người này đã được báo.
      if (!isNew) {
        this.logger.log(
          `[WATCHLIST] ${match.displayName} @ ${zoneId ?? 'toàn hệ thống'}: cộng dồn vào cảnh báo đang mở → không báo lại`,
        );
        return;
      }
      this.logger.log(
        `[WATCHLIST] ${match.displayName} (${match.listType}) @ ${zoneId ?? 'toàn hệ thống'}: tạo cảnh báo mới → gửi thông báo`,
      );

      const recipients = await this.resolveRecipients();
      if (recipients.length === 0) {
        this.logger.warn(
          `person watchlist match (${subjectId}) — không resolve được recipient, skip notification.`,
        );
        return;
      }

      const isBlock = match.listType === 'blocklist';
      const listLabel = LIST_LABEL[match.listType] ?? match.listType;
      const priorityLabel = PRIORITY_LABEL[match.priority] ?? match.priority;
      await this.notificationsService.createNotification({
        notificationType: NotificationType.PERSON_WATCHLIST_MATCH,
        channel: NotificationChannel.IN_APP,
        subject: isBlock
          ? 'Phát hiện người trong DANH SÁCH ĐEN'
          : 'Phát hiện người trong danh sách theo dõi',
        content:
          `${match.displayName} (${listLabel}, mức ${priorityLabel}) vừa được nhận diện${where}.` +
          (match.reason ? ` Lý do: ${match.reason}.` : ''),
        // Danh sách đen luôn ưu tiên cao, bất kể mức độ hồ sơ.
        priority:
          isBlock || match.priority === 'critical' || match.priority === 'high'
            ? NotificationPriority.HIGH
            : NotificationPriority.NORMAL,
        recipientScope: 'user_list',
        recipientUserIds: recipients,
        payloadJson: {
          userId: match.userId,
          personControlListEntryId: match.id,
          cameraName: location?.cameraName ?? null,
          displayName: match.displayName,
          listType: match.listType,
          priority: match.priority,
          deviceCode,
          roomName,
        },
      });
    }
  }

  private async resolveLocation(location?: PersonWatchlistLocation): Promise<{
    deviceCode: string | null;
    roomName: string | null;
    zoneId: string | null;
  }> {
    if (!location?.deviceId) {
      const zoneId =
        location?.channelId != null
          ? await this.zoneOfChannel(location.channelId)
          : null;
      return { deviceCode: null, roomName: null, zoneId };
    }
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

  /** Khu vực của camera theo `ivss.channel_presence_zone_map` {channelId: zoneId}. */
  private async zoneOfChannel(channelId: number): Promise<string | null> {
    try {
      const rows: Array<{ config_json: Record<string, unknown> | null }> =
        await this.dataSource.manager.query(
          `SELECT config_json FROM system_configs
            WHERE config_key = 'ivss.channel_presence_zone_map' AND is_active = true LIMIT 1`,
        );
      const v = rows[0]?.config_json?.[String(channelId)];
      return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
    } catch {
      return null;
    }
  }

  private pruneThrottle(now: number, throttleMs: number): void {
    if (
      this.lastAlertAt.size < PersonWatchlistCheckService.MAX_THROTTLE_ENTRIES
    )
      return;
    for (const [k, t] of this.lastAlertAt) {
      if (now - t >= throttleMs) this.lastAlertAt.delete(k);
    }
  }

  /**
   * Recipient = đúng bộ role vận hành Trung tâm cảnh báo (chốt qua AskUserQuestion).
   * Ít thay đổi → cache RECIPIENT_CACHE_MS (rỗng không cache).
   */
  private async resolveRecipients(): Promise<string[]> {
    const now = Date.now();
    if (this.recipientCache && this.recipientCache.expiresAt > now) {
      return this.recipientCache.value;
    }
    const value = await this.queryRecipients();
    if (value.length > 0) {
      this.recipientCache = {
        value,
        expiresAt: now + PersonWatchlistCheckService.RECIPIENT_CACHE_MS,
      };
    }
    return value;
  }

  private async queryRecipients(): Promise<string[]> {
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
