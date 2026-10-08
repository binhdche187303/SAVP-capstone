import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AlertRuleEntity } from '../entities/alert-rule.entity.js';
import { SecurityAlertEntity } from '../entities/security-alert.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationType,
} from '../../notifications/entities/notification.entity.js';
import { buildSecurityAlertEmail } from '../../mail/templates/builders.js';

/** Event WS cho màn hình Trung tâm Cảnh báo (FE SecurityAlerts.jsx). */
export const SECURITY_ALERT_NEW_EVENT = 'security.alert.new';
/** Cảnh báo ĐANG MỞ có thêm lượt (x lần tăng) — chỉ WS cập nhật màn hình, KHÔNG in-app/email (chống spam). */
export const SECURITY_ALERT_UPDATED_EVENT = 'security.alert.updated';

/** Quyền "người vận hành Trung tâm cảnh báo" — UC-122 §1 câu 2: MANAGER + BA + SA. */
const RECIPIENT_PERMISSION = 'security_alert.read';

/**
 * Các loại đã TỰ gửi in-app ở service gọi (nội dung riêng, có từ trước) — notifier chỉ
 * phát WS + email cho chúng, KHÔNG gửi in-app lần 2.
 */
const SELF_NOTIFYING_TYPES = new Set([
  'person_watchlist_match',
  'vehicle_control_match',
  'unknown_vehicle',
]);

/** Email chỉ gửi khi rule chọn kênh email VÀ severity đạt ngưỡng này trở lên. */
const EMAIL_SEVERITIES = new Set(['high', 'critical']);

/**
 * Loại gửi email CHỈ theo ô tick Email của rule, KHÔNG xét ngưỡng severity — người lạ
 * (medium) trước đây gửi email theo env STRANGER_ALERT_EMAIL_ENABLED, nay theo rule.
 */
const EMAIL_ANY_SEVERITY_TYPES = new Set(['stranger']);

const SEVERITY_LABEL: Record<string, string> = {
  low: 'Thấp',
  medium: 'Trung bình',
  high: 'Cao',
  critical: 'Nghiêm trọng',
};

const PRIORITY_BY_SEVERITY: Record<string, NotificationPriority> = {
  low: NotificationPriority.LOW,
  medium: NotificationPriority.NORMAL,
  high: NotificationPriority.HIGH,
  critical: NotificationPriority.URGENT,
};

/** Thời gian cache danh sách người nhận. */
const RECIPIENT_CACHE_MS = 60_000;

interface Recipient {
  id: string;
  email: string | null;
}

/**
 * SecurityAlertNotifierService — gửi thông báo cho cảnh báo an ninh MỚI.
 *
 * `AlertsService.recordAlert()` gọi khi INSERT alert mới (isNew) — bump do lặp lại KHÔNG
 * gọi (chống spam khi nhiều camera cùng báo). Kênh theo `alert_rules.channels` (không có
 * rule → mặc định in_app). NotThrow: lỗi gửi KHÔNG làm hỏng việc ghi alert.
 */
@Injectable()
export class SecurityAlertNotifierService {
  private readonly logger = new Logger(SecurityAlertNotifierService.name);
  private recipientCache: { value: Recipient[]; expiresAt: number } | null =
    null;

  constructor(
    @InjectRepository(AlertRuleEntity)
    private readonly ruleRepo: Repository<AlertRuleEntity>,
    private readonly notificationsService: NotificationsService,
    private readonly websocketService: WebsocketService,
    private readonly dataSource: DataSource,
  ) {}

  async notifyUpdatedAlert(alert: SecurityAlertEntity): Promise<void> {
    try {
      const [recipients, zoneName] = await Promise.all([
        this.resolveRecipients(),
        this.resolveZoneName(alert.zoneId),
      ]);
      const payload = {
        alertId: alert.id,
        alertType: alert.alertType,
        severity: alert.severity,
        zoneId: alert.zoneId,
        zoneName,
        occurrenceCount: alert.occurrenceCount,
        lastSeenAt: alert.lastSeenAt,
      };
      for (const r of recipients) {
        this.websocketService.emitToUser(
          r.id,
          SECURITY_ALERT_UPDATED_EVENT,
          payload,
        );
      }
    } catch (e) {
      this.logger.error(
        `notifyUpdatedAlert ${alert.id} failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  async notifyNewAlert(alert: SecurityAlertEntity): Promise<void> {
    try {
      const [channels, recipients, zoneName] = await Promise.all([
        this.resolveChannels(alert.ruleId),
        this.resolveRecipients(),
        this.resolveZoneName(alert.zoneId),
      ]);
      if (recipients.length === 0) {
        this.logger.warn(
          `security alert ${alert.id}: không có người nhận (${RECIPIENT_PERMISSION})`,
        );
        return;
      }

      const { title, content } = this.buildText(alert, zoneName);
      const payload = {
        alertId: alert.id,
        alertType: alert.alertType,
        severity: alert.severity,
        zoneId: alert.zoneId,
        zoneName,
        title,
        triggeredAt: alert.triggeredAt,
      };

      for (const r of recipients) {
        this.websocketService.emitToUser(
          r.id,
          SECURITY_ALERT_NEW_EVENT,
          payload,
        );
      }

      if (
        channels.includes('in_app') &&
        !SELF_NOTIFYING_TYPES.has(alert.alertType)
      ) {
        await this.safe('in_app', alert.id, () =>
          this.notificationsService.createNotification({
            notificationType: this.notificationTypeOf(alert.alertType),
            channel: NotificationChannel.IN_APP,
            subject: title,
            content,
            priority: PRIORITY_BY_SEVERITY[alert.severity],
            relatedEntityType: 'security_alert',
            relatedEntityId: alert.id,
            recipientScope: 'user_list',
            recipientUserIds: recipients.map((r) => r.id),
            payloadJson: payload,
          }),
        );
      }

      const emails = recipients
        .map((r) => r.email)
        .filter((e): e is string => !!e);
      if (
        channels.includes('email') &&
        (EMAIL_SEVERITIES.has(alert.severity) ||
          EMAIL_ANY_SEVERITY_TYPES.has(alert.alertType)) &&
        emails.length > 0
      ) {
        await this.safe('email', alert.id, () =>
          this.notificationsService.enqueueEmailNotification({
            notificationType: this.notificationTypeOf(alert.alertType),
            channel: NotificationChannel.EMAIL,
            subject: title,
            content,
            emailHtml: buildSecurityAlertEmail({
              title,
              content,
              severityLabel: SEVERITY_LABEL[alert.severity] ?? alert.severity,
              zoneName,
              triggeredAt: alert.triggeredAt,
            }),
            priority: PRIORITY_BY_SEVERITY[alert.severity],
            relatedEntityType: 'security_alert',
            relatedEntityId: alert.id,
            toEmails: emails,
            payloadJson: payload,
          }),
        );
      }
    } catch (e) {
      this.logger.error(
        `notifyNewAlert failed (alert=${alert.id}): ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  /**
   * Thông báo in-app (+ WS) cho thay đổi trạng thái camera trên alert `device_error` ĐÃ MỞ
   * (6.2 camera có tín hiệu lại / 6.3 thêm camera khác cùng khu vực rớt). Bump không qua
   * `notifyNewAlert` nên cần đường riêng. NotThrow.
   */
  async notifyDeviceStatus(
    alert: SecurityAlertEntity,
    title: string,
    content: string,
  ): Promise<void> {
    try {
      const recipients = await this.resolveRecipients();
      if (recipients.length === 0) return;
      const payload = {
        alertId: alert.id,
        alertType: alert.alertType,
        severity: alert.severity,
        zoneId: alert.zoneId,
        title,
        triggeredAt: alert.triggeredAt,
      };
      for (const r of recipients) {
        this.websocketService.emitToUser(
          r.id,
          SECURITY_ALERT_NEW_EVENT,
          payload,
        );
      }
      await this.notificationsService.createNotification({
        notificationType: NotificationType.DEVICE_OFFLINE_ALERT,
        channel: NotificationChannel.IN_APP,
        subject: title,
        content,
        priority: PRIORITY_BY_SEVERITY[alert.severity],
        relatedEntityType: 'security_alert',
        relatedEntityId: alert.id,
        recipientScope: 'user_list',
        recipientUserIds: recipients.map((r) => r.id),
        payloadJson: payload,
      });
    } catch (e) {
      this.logger.error(
        `notifyDeviceStatus failed (alert=${alert.id}): ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  private async safe(
    channel: string,
    alertId: string,
    fn: () => Promise<unknown>,
  ): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.logger.error(
        `security alert ${alertId}: gửi ${channel} lỗi: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  private notificationTypeOf(alertType: string): NotificationType {
    if (alertType === 'device_error')
      return NotificationType.DEVICE_OFFLINE_ALERT;
    if (alertType === 'stranger') return NotificationType.UNKNOWN_FACE_ALERT;
    return NotificationType.SECURITY_ALERT;
  }

  /** Kênh của rule đã kích hoạt alert; không có rule (fail-open UC-122) → in_app. */
  private async resolveChannels(ruleId: string | null): Promise<string[]> {
    if (!ruleId) return ['in_app'];
    const rule = await this.ruleRepo.findOne({
      where: { id: ruleId },
      withDeleted: true,
    });
    const channels = rule?.channels;
    return Array.isArray(channels) && channels.length > 0
      ? channels
      : ['in_app'];
  }

  /**
   * Người nhận ít thay đổi → cache RECIPIENT_CACHE_MS (tránh JOIN 4 bảng mỗi thông báo khi
   * nhiều cảnh báo dồn dập, VD nhiều khu vực rớt camera cùng lúc).
   */
  private async resolveRecipients(): Promise<Recipient[]> {
    const now = Date.now();
    if (this.recipientCache && this.recipientCache.expiresAt > now) {
      return this.recipientCache.value;
    }
    const value = await this.queryRecipients();
    this.recipientCache = { value, expiresAt: now + RECIPIENT_CACHE_MS };
    return value;
  }

  private async queryRecipients(): Promise<Recipient[]> {
    return this.dataSource.manager.query(
      `SELECT DISTINCT u.id, u.email
         FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
         JOIN role_permissions rp ON rp.role_id = ur.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE p.permission_code = $1
          AND u.deleted_at IS NULL`,
      [RECIPIENT_PERMISSION],
    );
  }

  private async resolveZoneName(zoneId: string | null): Promise<string | null> {
    if (!zoneId) return null;
    const rows: Array<{ zone_name: string }> =
      await this.dataSource.manager.query(
        `SELECT zone_name FROM zones WHERE id = $1`,
        [zoneId],
      );
    return rows[0]?.zone_name ?? null;
  }

  private buildText(
    alert: SecurityAlertEntity,
    zoneName: string | null,
  ): { title: string; content: string } {
    const p = alert.payloadJson ?? {};
    const where = zoneName ? ` – ${zoneName}` : '';
    switch (alert.alertType) {
      case 'crowd': {
        const count = p.occupancyCount as number | undefined;
        const threshold = p.threshold as number | undefined;
        const ratio =
          count != null && threshold != null
            ? ` (${count}/${threshold} người)`
            : '';
        return {
          title: `Cảnh báo tụ tập đông người${where}${ratio}`,
          content: `Số người tại ${zoneName ?? 'khu vực'} vượt ngưỡng cho phép${ratio}.`,
        };
      }
      case 'intrusion': {
        const fullName = p.fullName as string | null | undefined;
        return {
          title: `Cảnh báo xâm nhập khu vực hạn chế${where}`,
          content: `${fullName ? fullName : 'Người không được phép'} vào ${zoneName ?? 'khu vực hạn chế'} ngoài quyền/khung giờ cho phép.`,
        };
      }
      case 'device_error': {
        const list = Array.isArray(p.offlineDevices)
          ? (p.offlineDevices as Array<{
              deviceName?: string;
              deviceCode?: string;
            }>)
          : [];
        if (list.length > 1) {
          const shown = list
            .slice(0, 5)
            .map((d) => `${d.deviceName ?? 'Camera'} (${d.deviceCode ?? '?'})`)
            .join(', ');
          const rest =
            list.length > 5 ? ` và ${list.length - 5} camera khác` : '';
          return {
            title: `Cảnh báo: ${list.length} camera mất kết nối${where}`,
            content: `${list.length} camera không còn phản hồi: ${shown}${rest}.`,
          };
        }
        const name = (p.deviceName as string | undefined) ?? 'Camera';
        const code = p.deviceCode as string | undefined;
        return {
          title: 'Cảnh báo: camera mất kết nối',
          content: `Camera ${name}${code ? ` (${code})` : ''} không còn phản hồi.`,
        };
      }
      case 'stranger': {
        const device =
          (p.deviceCode as string | undefined) ??
          (p.deviceId as string | undefined) ??
          'không rõ';
        const roomName = p.roomName as string | null | undefined;
        return {
          title: 'Cảnh báo khuôn mặt lạ',
          content: `Phát hiện khuôn mặt lạ tại thiết bị ${device}${roomName ? ` (phòng ${roomName})` : ''}.`,
        };
      }
      default:
        return {
          title: `Cảnh báo an ninh${where}`,
          content: `Có cảnh báo an ninh mới (${alert.alertType}) mức ${SEVERITY_LABEL[alert.severity] ?? alert.severity}.`,
        };
    }
  }
}
