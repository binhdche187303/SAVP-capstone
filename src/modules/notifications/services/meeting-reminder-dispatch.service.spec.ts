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
  let participantRepo: any;
  let externalParticipantRepo: any;
  let userRepo: any;
  let notificationRepo: any;
  let systemConfigRepo: any;
  let notificationsService: any;

  beforeEach(() => {
    meetingRepo = { find: jest.fn().mockResolvedValue([]) };
    participantRepo = { find: jest.fn().mockResolvedValue([]) };
    externalParticipantRepo = { find: jest.fn().mockResolvedValue([]) };
    userRepo = { find: jest.fn().mockResolvedValue([]) };
    notificationRepo = { find: jest.fn().mockResolvedValue([]) };
    systemConfigRepo = { findOne: jest.fn().mockResolvedValue(null) };
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
    const dataSource = { getRepository: jest.fn(() => systemConfigRepo) };

    service = new MeetingReminderDispatchService(
      meetingRepo,
      participantRepo,
      externalParticipantRepo,
      userRepo,
      notificationRepo,
      dataSource as any,
      notificationsService,
    );
  });

  describe('sendAutoRemindersBatch', () => {
    it('nhắc qua in-app + email cho cuộc họp sắp bắt đầu trong cửa sổ nhắc, đủ người nhận, không trùng', async () => {
      const m = meeting();
      meetingRepo.find.mockResolvedValue([m]);
      participantRepo.find.mockResolvedValue([
        {
          meetingId: 'm-1',
          userId: 'u-1',
          invitationStatus: InvitationStatus.ACCEPTED,
        },
        {
          meetingId: 'm-1',
          userId: 'host',
          invitationStatus: InvitationStatus.PENDING,
        },
      ]);
      externalParticipantRepo.find.mockResolvedValue([
        {
          meetingId: 'm-1',
          email: 'guest@example.com',
          invitationStatus: InvitationStatus.PENDING,
        },
      ]);
      userRepo.find.mockResolvedValue([
        { id: 'u-1', email: 'u1@example.com' },
        { id: 'host', email: 'host@example.com' },
        { id: 'organizer', email: 'org@example.com' },
      ]);

      const r = await service.sendAutoRemindersBatch(NOW);

      expect(r).toEqual({ scanned: 1, reminded: 1, failed: 0 });
      const inApp = notificationsService.createNotification.mock.calls[0][0];
      expect(inApp.notificationType).toBe(NotificationType.REMINDER);
      expect(inApp.channel).toBe(NotificationChannel.IN_APP);
      expect(inApp.relatedEntityId).toBe('m-1');
      expect([...inApp.recipientUserIds].sort()).toEqual([
        'host',
        'organizer',
        'u-1',
      ]);
      expect(inApp.payloadJson).toMatchObject({
        reminderType: 'auto',
        startTime: m.startTime.toISOString(),
      });
      const email =
        notificationsService.enqueueEmailNotification.mock.calls[0][0];
      expect([...email.toEmails].sort()).toEqual([
        'guest@example.com',
        'host@example.com',
        'org@example.com',
        'u1@example.com',
      ]);
      expect(email.payloadJson).toMatchObject({ reminderType: 'auto' });
    });

    it('mặc định cửa sổ nhắc 10 phút khi chưa cấu hình meeting_reminder_minutes', async () => {
      await service.sendAutoRemindersBatch(NOW);
      const where = meetingRepo.find.mock.calls[0][0].where;
      expect(where.status).toBe(MeetingStatus.SCHEDULED);
      const [from, to] = where.startTime.value;
      expect(from).toEqual(NOW);
      expect(to.getTime() - NOW.getTime()).toBe(10 * MIN);
    });

    it('đọc số phút nhắc từ system_configs meeting_reminder_minutes', async () => {
      systemConfigRepo.findOne.mockResolvedValue({ configValue: '30' });
      await service.sendAutoRemindersBatch(NOW);
      const [, to] = meetingRepo.find.mock.calls[0][0].where.startTime.value;
      expect(to.getTime() - NOW.getTime()).toBe(30 * MIN);
    });

    it('cấu hình không hợp lệ → quay về mặc định 10 phút', async () => {
      systemConfigRepo.findOne.mockResolvedValue({ configValue: 'abc' });
      await service.sendAutoRemindersBatch(NOW);
      const [, to] = meetingRepo.find.mock.calls[0][0].where.startTime.value;
      expect(to.getTime() - NOW.getTime()).toBe(10 * MIN);
    });

    it('KHÔNG nhắc lại cuộc họp đã có nhắc tự động cho đúng giờ bắt đầu hiện tại', async () => {
      const m = meeting();
      meetingRepo.find.mockResolvedValue([m]);
      notificationRepo.find.mockResolvedValue([
        {
          relatedEntityId: 'm-1',
          payloadJson: {
            reminderType: 'auto',
            startTime: m.startTime.toISOString(),
          },
        },
      ]);

      const r = await service.sendAutoRemindersBatch(NOW);

      expect(r.reminded).toBe(0);
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
      expect(
        notificationsService.enqueueEmailNotification,
      ).not.toHaveBeenCalled();
    });

    it('nhắc lại khi giờ họp đã đổi so với lần nhắc tự động trước', async () => {
      meetingRepo.find.mockResolvedValue([meeting()]);
      notificationRepo.find.mockResolvedValue([
        {
          relatedEntityId: 'm-1',
          payloadJson: {
            reminderType: 'auto',
            startTime: '2026-10-19T01:00:00.000Z',
          },
        },
      ]);

      const r = await service.sendAutoRemindersBatch(NOW);

      expect(r.reminded).toBe(1);
    });

    it('bỏ qua cuộc họp được tạo khi đã nằm trong cửa sổ nhắc (thư mời vừa gửi)', async () => {
      meetingRepo.find.mockResolvedValue([
        meeting({ createdAt: new Date(NOW.getTime() - 1 * MIN) }),
      ]);

      const r = await service.sendAutoRemindersBatch(NOW);

      expect(r).toEqual({ scanned: 1, reminded: 0, failed: 0 });
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('không nhắc người tham dự đã từ chối (nội bộ và khách ngoài)', async () => {
      meetingRepo.find.mockResolvedValue([meeting({ hostId: null })]);
      participantRepo.find.mockResolvedValue([
        {
          meetingId: 'm-1',
          userId: 'u-declined',
          invitationStatus: InvitationStatus.DECLINED,
        },
      ]);
      externalParticipantRepo.find.mockResolvedValue([
        {
          meetingId: 'm-1',
          email: 'no@example.com',
          invitationStatus: InvitationStatus.DECLINED,
        },
      ]);
      userRepo.find.mockResolvedValue([
        { id: 'organizer', email: 'org@example.com' },
      ]);

      await service.sendAutoRemindersBatch(NOW);

      const inApp = notificationsService.createNotification.mock.calls[0][0];
      expect(inApp.recipientUserIds).toEqual(['organizer']);
      const email =
        notificationsService.enqueueEmailNotification.mock.calls[0][0];
      expect(email.toEmails).toEqual(['org@example.com']);
    });

    it('lỗi ở 1 cuộc họp → đếm failed, vẫn xử lý cuộc họp khác', async () => {
      meetingRepo.find.mockResolvedValue([
        meeting({ id: 'm-bad' }),
        meeting({ id: 'm-ok' }),
      ]);
      notificationsService.createNotification
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({ id: 'n-ok' });

      const r = await service.sendAutoRemindersBatch(NOW);

      expect(r).toEqual({ scanned: 2, reminded: 1, failed: 1 });
    });
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
