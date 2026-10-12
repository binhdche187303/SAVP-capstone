import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { NotificationChannel, NotificationType } from '../../notifications/entities/notification.entity.js';
import {
  buildVisitorApprovedEmail,
  buildVisitorRegistrationReceivedEmail,
  buildVisitorRejectedEmail,
} from '../../mail/templates/builders.js';
import { VisitorConfigService } from '../config/visitor-config.service.js';
import type { VisitView } from '../presenters/visit-view.presenter.js';

export type HostNotificationType =
  | 'visitor_pending_approval' | 'visitor_registered' | 'visitor_arrived'
  | 'visitor_left' | 'visitor_overstay' | 'visitor_must_leave';

const TYPE_MAP: Record<HostNotificationType, NotificationType> = {
  visitor_pending_approval: NotificationType.VISITOR_PENDING_APPROVAL,
  visitor_registered: NotificationType.VISITOR_REGISTERED,
  visitor_arrived: NotificationType.VISITOR_ARRIVED,
  visitor_left: NotificationType.VISITOR_LEFT,
  visitor_overstay: NotificationType.VISITOR_OVERSTAY,
  visitor_must_leave: NotificationType.VISITOR_MUST_LEAVE,
};

/**
 * VisitorNotifier — mọi thông báo của phân hệ Khách. KHÔNG BAO GIỜ ném lỗi: thông báo hỏng
 * không được làm hỏng thao tác nghiệp vụ (BR-V7, BR-V8).
 */
@Injectable()
export class VisitorNotifier {
  private readonly logger = new Logger(VisitorNotifier.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly config: VisitorConfigService,
    private readonly appConfig: ConfigService,
    private readonly dataSource: DataSource,
    private readonly alerts: AlertsService,
  ) {}

  /** Thông báo trong ứng dụng (+ email nếu bật) cho người được gặp. Nội dung không chứa giấy tờ/điện thoại khách. */
  async notifyHost(visit: Pick<VisitView, 'id' | 'code' | 'hostId' | 'visitor'>, type: HostNotificationType, message: string): Promise<boolean> {
    try {
      await this.notifications.createNotification({
        notificationType: TYPE_MAP[type],
        channel: NotificationChannel.IN_APP,
        subject: 'Khách đến làm việc',
        content: message,
        relatedEntityType: 'visitor_visit',
        relatedEntityId: visit.id,
        recipientScope: 'user_list',
        recipientUserIds: [visit.hostId],
        payloadJson: { visitId: visit.id, code: visit.code, kind: type },
      });
      if ((await this.config.get()).notifyHostEmail) await this.emailHost(visit, type, message);
      return true;
    } catch (e) {
      this.logger.warn(`notifyHost ${type} thất bại: ${e instanceof Error ? e.message : 'unknown'}`);
      return false;
    }
  }

  /** Cảnh báo an ninh (Trung tâm cảnh báo). dedupeKey = id lượt: một lượt chỉ có một cảnh báo mở mỗi loại. */
  async alertSecurity(
    visit: Pick<VisitView, 'id' | 'code' | 'visitor'>,
    alertType: 'visitor_overstay' | 'visitor_must_leave' | 'visitor_zone_violation',
    zoneId: string | null,
    detail: string,
  ): Promise<boolean> {
    try {
      await this.alerts.recordAlert({
        alertType,
        zoneId,
        dedupeKey: visit.id,
        payloadJson: { visitId: visit.id, code: visit.code, visitorName: visit.visitor.fullName, detail },
      });
      return true;
    } catch (e) {
      this.logger.warn(`alertSecurity ${alertType} thất bại: ${e instanceof Error ? e.message : 'unknown'}`);
      return false;
    }
  }

  private async emailHost(visit: Pick<VisitView, 'id' | 'hostId'>, type: HostNotificationType, message: string): Promise<void> {
    const rows: Array<{ email: string }> = await this.dataSource.query(`SELECT email FROM users WHERE id = $1 AND deleted_at IS NULL`, [visit.hostId]);
    const to = rows[0]?.email;
    if (!to || to.endsWith('.invalid')) return;
    await this.notifications.enqueueEmailNotification({
      notificationType: TYPE_MAP[type],
      channel: NotificationChannel.EMAIL,
      subject: '[SAVP] Khách đến làm việc',
      content: message,
      toEmails: [to],
      relatedEntityType: 'visitor_visit',
      relatedEntityId: visit.id,
    });
  }

  /** Email cho khách; khách không có email → bỏ qua. Trả true nếu đã xếp hàng gửi. */
  async emailVisitor(visit: VisitView, kind: 'received' | 'approved' | 'rejected'): Promise<boolean> {
    const to = visit.visitor.email;
    if (!to) return false;
    try {
      const statusUrl = `${this.appConfig.get<string>('APP_URL', 'http://localhost:3000')}/visitor/status/${visit.code}`;
      const built = {
        received: {
          subject: `[SAVP] Đã nhận đăng ký khách ${visit.code}`,
          html: buildVisitorRegistrationReceivedEmail({ visitorName: visit.visitor.fullName, code: visit.code, hostName: visit.hostName, scheduledFrom: visit.scheduledFrom, scheduledTo: visit.scheduledTo, statusUrl }),
        },
        approved: {
          subject: `[SAVP] Đăng ký khách ${visit.code} đã được duyệt`,
          html: buildVisitorApprovedEmail({ visitorName: visit.visitor.fullName, code: visit.code, hostName: visit.hostName, validFrom: visit.access.validFrom, validTo: visit.access.validTo, zoneNames: visit.zoneNames, statusUrl }),
        },
        rejected: {
          subject: `[SAVP] Đăng ký khách ${visit.code} không được duyệt`,
          html: buildVisitorRejectedEmail({ visitorName: visit.visitor.fullName, code: visit.code, reason: visit.rejectReason ?? 'Không nêu lý do' }),
        },
      }[kind];
      await this.notifications.enqueueEmailNotification({
        notificationType: NotificationType.VISITOR_EMAIL,
        channel: NotificationChannel.EMAIL,
        subject: built.subject,
        content: built.subject,
        toEmails: [to],
        emailHtml: built.html,
        relatedEntityType: 'visitor_visit',
        relatedEntityId: visit.id,
      });
      return true;
    } catch (e) {
      this.logger.warn(`emailVisitor ${kind} thất bại: ${e instanceof Error ? e.message : 'unknown'}`);
      return false;
    }
  }
}
