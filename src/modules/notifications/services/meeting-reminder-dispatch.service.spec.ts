/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { MeetingReminderDispatchService } from './meeting-reminder-dispatch.service.js';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationType,
} from '../entities/notification.entity.js';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { InvitationStatus } from '../../meetings/entities/meeting-participant.entity.js';

const NOW = new Date('2026-10-20T02:00:00.000Z');
const MIN = 60_000;

function meeting(overrides: Partial<MeetingEntity> = {}): MeetingEntity {
  const m = new MeetingEntity();
  m.id = 'm-1';
  m.title = 'Họp giao ban';
  m.status = MeetingStatus.SCHEDULED;
  m.organizerId = 'organizer';
  m.hostId = 'host';
  m.startTime = new Date(NOW.getTime() + 8 * MIN);
  m.endTime = new Date(NOW.getTime() + 68 * MIN);
  m.createdAt = new Date(NOW.getTime() - 24 * 60 * MIN);
  Object.assign(m, overrides);
  return m;
}

describe('MeetingReminderDispatchService', () => {
  let service: MeetingReminderDispatchService;
  let meetingRepo: any;
  let externalParticipantRepo: any;
  let userRepo: any;
  let notificationRepo: any;
  let notificationsService: any;

  beforeEach(() => {
    meetingRepo = { find: jest.fn().mockResolvedValue([]) };
    externalParticipantRepo = { find: jest.fn().mockResolvedValue([]) };
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    notificationRepo = { find: jest.fn().mockResolvedValue([]) };
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n-in-app' }),
      enqueueEmailNotification: jest
        .fn()
        .mockResolvedValue({ notification: { id: 'n-email' } }),
      deliverScheduledInApp: jest.fn().mockResolvedValue(true),
      claimDraft: jest.fn().mockResolvedValue(true),
      enqueueEmailForExistingNotification: jest
        .fn()
        .mockResolvedValue(undefined),
      markCancelled: jest.fn().mockResolvedValue(undefined),
    };
    service = new MeetingReminderDispatchService(
      meetingRepo,
      externalParticipantRepo,
      userRepo,
      notificationRepo,
      notificationsService,
    );
  });

  describe('dispatchDueScheduledReminders', () => {
    const scheduledRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'n-sch',
      notificationType: NotificationType.REMINDER,
      channel: NotificationChannel.IN_APP,
      relatedEntityType: 'meeting',
      relatedEntityId: 'm-1',
      recipientUserIdsJson: ['u-1'],
      deliveryStatus: NotificationDeliveryStatus.DRAFT,
      scheduledSendAt: new Date(NOW.getTime() - MIN),
      payloadJson: { reminderType: 'scheduled' },
      ...overrides,
    });

    it('chỉ lấy nhắc lịch hẹn giờ ở trạng thái draft đã tới hạn', async () => {
      await service.dispatchDueScheduledReminders(NOW);
      const where = notificationRepo.find.mock.calls[0][0].where;
      expect(where.notificationType).toBe(NotificationType.REMINDER);
      expect(where.deliveryStatus).toBe(NotificationDeliveryStatus.DRAFT);
      expect(where.scheduledSendAt.value).toEqual(NOW);
    });

    it('in-app tới hạn → phát thông báo (deliverScheduledInApp)', async () => {
      notificationRepo.find.mockResolvedValue([scheduledRow()]);
      meetingRepo.find.mockResolvedValue([meeting()]);

      const r = await service.dispatchDueScheduledReminders(NOW);

      expect(notificationsService.deliverScheduledInApp).toHaveBeenCalledWith(
        'n-sch',
      );
      expect(r).toEqual({ due: 1, sent: 1, cancelled: 0, failed: 0 });
    });

    it('email tới hạn → giữ chỗ bản ghi rồi gửi tới email người nhận + khách ngoài', async () => {
      notificationRepo.find.mockResolvedValue([
        scheduledRow({ id: 'n-mail', channel: NotificationChannel.EMAIL }),
      ]);
      meetingRepo.find.mockResolvedValue([meeting()]);
      userRepo.find.mockResolvedValue([{ id: 'u-1', email: 'u1@example.com' }]);
      externalParticipantRepo.find.mockResolvedValue([
        {
          meetingId: 'm-1',
          email: 'guest@example.com',
          invitationStatus: InvitationStatus.PENDING,
        },
      ]);

      const r = await service.dispatchDueScheduledReminders(NOW);

      expect(notificationsService.claimDraft).toHaveBeenCalledWith('n-mail');
      const [row, emails] =
        notificationsService.enqueueEmailForExistingNotification.mock.calls[0];
      expect(row.id).toBe('n-mail');
      expect([...emails].sort()).toEqual([
        'guest@example.com',
        'u1@example.com',
      ]);
      expect(r.sent).toBe(1);
    });

    it('email đã bị tick khác giữ chỗ → bỏ qua, không gửi trùng', async () => {
      notificationRepo.find.mockResolvedValue([
        scheduledRow({ channel: NotificationChannel.EMAIL }),
      ]);
      meetingRepo.find.mockResolvedValue([meeting()]);
      notificationsService.claimDraft.mockResolvedValue(false);

      const r = await service.dispatchDueScheduledReminders(NOW);

      expect(
        notificationsService.enqueueEmailForExistingNotification,
      ).not.toHaveBeenCalled();
      expect(r.sent).toBe(0);
    });

    it('cuộc họp đã huỷ hoặc đã bắt đầu → huỷ nhắc lịch, không gửi', async () => {
      notificationRepo.find.mockResolvedValue([
        scheduledRow({ id: 'n-1', relatedEntityId: 'm-cancelled' }),
        scheduledRow({ id: 'n-2', relatedEntityId: 'm-started' }),
      ]);
      meetingRepo.find.mockResolvedValue([
        meeting({ id: 'm-cancelled', status: MeetingStatus.CANCELLED }),
        meeting({ id: 'm-started', startTime: new Date(NOW.getTime() - MIN) }),
      ]);

      const r = await service.dispatchDueScheduledReminders(NOW);

      expect(notificationsService.markCancelled).toHaveBeenCalledTimes(2);
      expect(notificationsService.deliverScheduledInApp).not.toHaveBeenCalled();
      expect(r).toEqual({ due: 2, sent: 0, cancelled: 2, failed: 0 });
    });

    it('bỏ qua bản ghi nhắc không phải loại hẹn giờ', async () => {
      notificationRepo.find.mockResolvedValue([
        scheduledRow({ payloadJson: { reminderType: 'manual' } }),
      ]);

      const r = await service.dispatchDueScheduledReminders(NOW);

      expect(r.due).toBe(0);
      expect(notificationsService.deliverScheduledInApp).not.toHaveBeenCalled();
    });
  });
});
