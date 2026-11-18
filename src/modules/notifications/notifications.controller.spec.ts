import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { NotificationsController } from './notifications.controller.js';
import { MeetingNotificationsService } from './services/meeting-notifications.service.js';
import { NotificationsService } from './notifications.service.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  let meetingNotificationsService: jest.Mocked<MeetingNotificationsService>;
  let notificationsService: jest.Mocked<NotificationsService>;

  const mockUser = { userId: 'user-uuid' };

  beforeEach(async () => {
    meetingNotificationsService = {
      sendMeetingInvitation: jest.fn(),
      sendMeetingReminder: jest.fn(),
      resendCancellationNotification: jest.fn(),
      distributeMeetingMinutes: jest.fn(),
    } as any;

    notificationsService = {
      listMyNotifications: jest.fn(),
      listMyNotificationGroups: jest.fn(),
      markNotificationGroupRead: jest.fn(),
      getMyNotificationDetail: jest.fn(),
      markNotificationRead: jest.fn(),
      markAllNotificationsRead: jest.fn(),
    } as any;

    controller = new NotificationsController(
      meetingNotificationsService,
      notificationsService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Meeting Invitation
  describe('sendInvitation', () => {
    it('[T001] should call service and return 202', async () => {
      const result = {
        notificationId: 'n1',
        deliveryStatus: 'queued',
        queuedRecipientCount: 5,
        skippedRecipientCount: 0,
      };
      meetingNotificationsService.sendMeetingInvitation.mockResolvedValue(
        result,
      );

      const response = await controller.sendInvitation(
        'm1',
        { channels: ['email'], includeAgenda: false },
        mockUser,
      );
      expect(response.success).toBe(true);
      expect(
        meetingNotificationsService.sendMeetingInvitation,
      ).toHaveBeenCalledWith(
        'm1',
        { userId: 'user-uuid' },
        { channels: ['email'], includeAgenda: false },
      );
    });
  });

  // Meeting Reminder
  describe('sendReminder', () => {
    it('[T002] should call service and return 202', async () => {
      meetingNotificationsService.sendMeetingReminder.mockResolvedValue({
        notificationId: 'n1',
        deliveryStatus: 'queued',
        scheduledSendAt: null,
      });

      const response = await controller.sendReminder(
        'm1',
        { channels: ['in_app'], reminderType: 'manual' },
        mockUser,
      );
      expect(response.success).toBe(true);
    });
  });

  // Cancellation Notification
  describe('resendCancellation', () => {
    it('[T003] should call service and return 202', async () => {
      meetingNotificationsService.resendCancellationNotification.mockResolvedValue(
        {
          meetingId: 'm1',
          notificationId: 'n1',
          queuedRecipientCount: 5,
        },
      );

      const response = await controller.resendCancellation(
        'm1',
        { channels: ['email'] },
        mockUser,
      );
      expect(response.success).toBe(true);
    });
  });

  // Distribute Minutes
  describe('distributeMinutes', () => {
    it('[T004] should call service and return 202', async () => {
      meetingNotificationsService.distributeMeetingMinutes.mockResolvedValue({
        notificationId: 'n1',
        queuedRecipientCount: 5,
        minutesId: 'min1',
      });

      const response = await controller.distributeMinutes(
        'm1',
        {
          minutesId: 'min1',
          recipientScope: 'participants',
          channels: ['email'],
        },
        mockUser,
      );
      expect(response.success).toBe(true);
    });
  });

  // Inbox List
  describe('listMyNotifications', () => {
    it('[T005] should list notifications with pagination', async () => {
      notificationsService.listMyNotifications.mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      const response = await controller.listMyNotifications(mockUser, {
        page: 1,
        limit: 20,
      });
      expect(notificationsService.listMyNotifications).toHaveBeenCalledWith(
        'user-uuid',
        1,
        20,
        expect.any(Object),
      );
      expect(response.success).toBe(true);
    });

    it('[T007] should default page/limit when query is empty', async () => {
      notificationsService.listMyNotifications.mockResolvedValue({
        data: [],
        meta: { page: 1, limit: 20, total: 0, totalPages: 0 },
      });

      await controller.listMyNotifications(mockUser, {});
      expect(notificationsService.listMyNotifications).toHaveBeenCalledWith(
        'user-uuid',
        1,
        20,
        expect.any(Object),
      );
    });

    it('chuyển bộ lọc (chưa đọc, loại, ngày, từ khóa) xuống service', async () => {
      notificationsService.listMyNotifications.mockResolvedValue({
        data: [],
        meta: {},
      });
      await controller.listMyNotifications(mockUser, {
        isRead: false,
        type: ['unknown_vehicle_alert'],
        from: '2026-10-26',
        to: '2026-10-26',
        search: '10DS',
      });
      expect(notificationsService.listMyNotifications).toHaveBeenCalledWith(
        'user-uuid',
        1,
        20,
        {
          isRead: false,
          types: ['unknown_vehicle_alert'],
          from: '2026-10-26',
          to: '2026-10-26',
          search: '10DS',
        },
      );
    });

    it('GET notifications/groups → gom nhóm theo loại + ngày', async () => {
      notificationsService.listMyNotificationGroups.mockResolvedValue({
        data: [],
        meta: {},
      });
      const r = await controller.listMyNotificationGroups(mockUser, {
        isRead: false,
      });
      expect(
        notificationsService.listMyNotificationGroups,
      ).toHaveBeenCalledWith(
        'user-uuid',
        1,
        20,
        expect.objectContaining({ isRead: false }),
      );
      expect(r.success).toBe(true);
    });

    it('PATCH notifications/read-group → đánh dấu đọc cả nhóm', async () => {
      await controller.markNotificationGroupRead(mockUser, {
        type: 'unknown_vehicle_alert',
        day: '2026-10-26',
      });
      expect(
        notificationsService.markNotificationGroupRead,
      ).toHaveBeenCalledWith(
        'user-uuid',
        'unknown_vehicle_alert',
        '2026-10-26',
      );
    });

    it('[T007b] ListNotificationsQueryDto should reject limit > 100 (validated by ValidationPipe at the HTTP boundary)', async () => {
      const dto = plainToInstance(ListNotificationsQueryDto, { limit: '500' });
      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some((e) => e.property === 'limit')).toBe(true);
    });
  });

  // Inbox Detail
  describe('getNotificationDetail', () => {
    it('[T008] should return notification detail', async () => {
      notificationsService.getMyNotificationDetail.mockResolvedValue({
        id: 'n1',
        notificationType: 'meeting_invite',
        subject: 'Test',
        content: 'Test',
        relatedEntityType: null,
        relatedEntityId: null,
        priority: 'normal',
        createdAt: new Date(),
        isRead: false,
      });

      const response = await controller.getNotificationDetail('n1', mockUser);
      expect(response.success).toBe(true);
      expect(notificationsService.getMyNotificationDetail).toHaveBeenCalledWith(
        'n1',
        'user-uuid',
      );
    });
  });

  // BE-07: Mark read / read-all
  describe('markNotificationRead', () => {
    it('[BE-07] should call service with id + userId from token, return success', async () => {
      notificationsService.markNotificationRead.mockResolvedValue(undefined);

      const response = await controller.markNotificationRead('n1', mockUser);

      expect(notificationsService.markNotificationRead).toHaveBeenCalledWith(
        'n1',
        'user-uuid',
      );
      expect(response.success).toBe(true);
    });
  });

  describe('markAllNotificationsRead', () => {
    it('[BE-07] should call service with userId from token, return success', async () => {
      notificationsService.markAllNotificationsRead.mockResolvedValue(
        undefined,
      );

      const response = await controller.markAllNotificationsRead(mockUser);

      expect(
        notificationsService.markAllNotificationsRead,
      ).toHaveBeenCalledWith('user-uuid');
      expect(response.success).toBe(true);
    });
  });
});
