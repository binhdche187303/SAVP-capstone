/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/unbound-method */
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service.js';
import { NotificationReadStateService } from './services/notification-read-state.service.js';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationType,
} from './entities/notification.entity.js';

describe('NotificationsService — inbox + BE-07 mark-read', () => {
  let service: NotificationsService;
  let repo: any;
  let readStateService: jest.Mocked<NotificationReadStateService>;
  let queryBuilder: any;
  let dataSourceMock: any;

  beforeEach(() => {
    queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn(),
    };

    repo = {
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
      findOne: jest.fn(),
    };

    readStateService = {
      getReadState: jest.fn(),
      computeIsRead: jest.fn(),
      isRead: jest.fn(),
      markRead: jest.fn(),
      markAllRead: jest.fn(),
    } as unknown as jest.Mocked<NotificationReadStateService>;

    dataSourceMock = { manager: { query: jest.fn().mockResolvedValue([]) } };

    service = new NotificationsService(
      repo,
      {} as any, // queueService (không dùng trong các test này)
      {} as any, // backgroundJobsService
      { get: jest.fn() } as any, // configService
      readStateService,
      dataSourceMock,
      { emitToUser: jest.fn() } as any, // websocketService
    );
  });

  describe('listMyNotifications', () => {
    it('gọi getReadState 1 LẦN cho cả trang, map isRead cho từng item qua computeIsRead', async () => {
      const items = [
        {
          id: 'n1',
          notificationType: 't',
          subject: null,
          content: 'c1',
          relatedEntityType: null,
          relatedEntityId: null,
          priority: 'normal',
          createdAt: new Date('2026-07-01'),
        },
        {
          id: 'n2',
          notificationType: 't',
          subject: null,
          content: 'c2',
          relatedEntityType: null,
          relatedEntityId: null,
          priority: 'normal',
          createdAt: new Date('2026-07-02'),
        },
      ];
      queryBuilder.getManyAndCount.mockResolvedValue([items, 2]);
      const state = { readIds: new Set(['n1']), readAllAt: null };
      readStateService.getReadState.mockResolvedValue(state);
      readStateService.computeIsRead.mockImplementation(
        (_s, id) => id === 'n1',
      );

      const result = await service.listMyNotifications('u1', 1, 20);

      expect(readStateService.getReadState).toHaveBeenCalledTimes(1);
      expect(readStateService.getReadState).toHaveBeenCalledWith('u1');
      expect(result.data[0].isRead).toBe(true);
      expect(result.data[1].isRead).toBe(false);
      // Không phải no_show_alert → không đụng DataSource, noShowLiveStatus null.
      expect(dataSourceMock.manager.query).not.toHaveBeenCalled();
      expect(result.data[0].noShowLiveStatus).toBeNull();
    });

    // ══ [Fix 2026-08-21, Bug 1/2] noShowLiveStatus — trạng thái SỐNG, không phải
    // payloadJson.kind tĩnh lúc tạo. Tái hiện đúng kịch bản: bấm "Tôi vẫn đến"
    // (case → snoozed trong DB) rồi RELOAD trang (gọi lại listMyNotifications) —
    // trước fix, payloadJson.kind vẫn 'warning' nên nút hiện lại; sau fix,
    // noShowLiveStatus phải phản ánh đúng 'snoozed' để FE ẩn nút.
    it("no_show_alert: payloadJson.kind vẫn 'warning' (snapshot cũ) NHƯNG case đã snoozed trong DB → noShowLiveStatus='snoozed' (tái hiện đúng kịch bản bấm→reload)", async () => {
      const items = [
        {
          id: 'n1',
          notificationType: 'no_show_alert',
          subject: 'Cảnh báo no-show',
          content: 'c1',
          relatedEntityType: 'no_show_case',
          relatedEntityId: 'case-1',
          priority: 'normal',
          createdAt: new Date('2026-08-21'),
          payloadJson: { kind: 'warning', noShowCaseId: 'case-1' },
        },
      ];
      queryBuilder.getManyAndCount.mockResolvedValue([items, 1]);
      readStateService.getReadState.mockResolvedValue({
        readIds: new Set(),
        readAllAt: null,
      });
      readStateService.computeIsRead.mockReturnValue(false);
      dataSourceMock.manager.query.mockResolvedValue([
        {
          id: 'case-1',
          detection_status: 'snoozed',
          snooze_until: '2026-08-21T11:00:00Z',
        },
      ]);

      const result = await service.listMyNotifications('u1', 1, 20);

      expect(dataSourceMock.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('FROM no_show_cases'),
        [['case-1']],
      );
      expect(result.data[0].payloadJson).toEqual({
        kind: 'warning',
        noShowCaseId: 'case-1',
      }); // payloadJson KHÔNG bị sửa — vẫn là bản ghi lịch sử gốc.
      expect(result.data[0].noShowLiveStatus).toBe('snoozed');
      expect(result.data[0].noShowSnoozeUntil).toBe('2026-08-21T11:00:00Z');
    });

    it('no_show_alert nhưng case đã bị xoá/không tìm thấy → noShowLiveStatus null (fail-safe, không throw)', async () => {
      const items = [
        {
          id: 'n1',
          notificationType: 'no_show_alert',
          subject: null,
          content: 'c1',
          relatedEntityType: null,
          relatedEntityId: null,
          priority: 'normal',
          createdAt: new Date('2026-08-21'),
          payloadJson: { kind: 'warning', noShowCaseId: 'case-deleted' },
        },
      ];
      queryBuilder.getManyAndCount.mockResolvedValue([items, 1]);
      readStateService.getReadState.mockResolvedValue({
        readIds: new Set(),
        readAllAt: null,
      });
      readStateService.computeIsRead.mockReturnValue(false);
      dataSourceMock.manager.query.mockResolvedValue([]); // 0 row

      const result = await service.listMyNotifications('u1', 1, 20);
      expect(result.data[0].noShowLiveStatus).toBeNull();
      expect(result.data[0].noShowSnoozeUntil).toBeNull();
    });

    it('nhiều no_show_alert item → 1 query duy nhất, batch theo caseId (không N+1)', async () => {
      const items = [
        {
          id: 'n1',
          notificationType: 'no_show_alert',
          subject: null,
          content: 'c1',
          relatedEntityType: null,
          relatedEntityId: null,
          priority: 'normal',
          createdAt: new Date('2026-08-21'),
          payloadJson: { kind: 'warning', noShowCaseId: 'case-1' },
        },
        {
          id: 'n2',
          notificationType: 'no_show_alert',
          subject: null,
          content: 'c2',
          relatedEntityType: null,
          relatedEntityId: null,
          priority: 'normal',
          createdAt: new Date('2026-08-21'),
          payloadJson: { kind: 'released', noShowCaseId: 'case-2' },
        },
      ];
      queryBuilder.getManyAndCount.mockResolvedValue([items, 2]);
      readStateService.getReadState.mockResolvedValue({
        readIds: new Set(),
        readAllAt: null,
      });
      readStateService.computeIsRead.mockReturnValue(false);
      dataSourceMock.manager.query.mockResolvedValue([
        { id: 'case-1', detection_status: 'snoozed', snooze_until: null },
        { id: 'case-2', detection_status: 'released', snooze_until: null },
      ]);

      const result = await service.listMyNotifications('u1', 1, 20);

      expect(dataSourceMock.manager.query).toHaveBeenCalledTimes(1);
      expect(result.data[0].noShowLiveStatus).toBe('snoozed');
      expect(result.data[1].noShowLiveStatus).toBe('released');
    });
  });

  describe('getMyNotificationDetail', () => {
    it('404 nếu không tồn tại', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.getMyNotificationDetail('n1', 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('403 nếu user không phải recipient', async () => {
      repo.findOne.mockResolvedValue({
        id: 'n1',
        recipientUserIdsJson: ['other-user'],
        createdAt: new Date(),
      });
      await expect(service.getMyNotificationDetail('n1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('trả isRead từ readStateService.isRead khi là recipient', async () => {
      const createdAt = new Date('2026-07-10');
      repo.findOne.mockResolvedValue({
        id: 'n1',
        notificationType: 't',
        subject: null,
        content: 'c',
        relatedEntityType: null,
        relatedEntityId: null,
        priority: 'normal',
        recipientUserIdsJson: ['u1'],
        createdAt,
      });
      readStateService.isRead.mockResolvedValue(true);

      const result = await service.getMyNotificationDetail('n1', 'u1');

      expect(readStateService.isRead).toHaveBeenCalledWith(
        'u1',
        'n1',
        createdAt,
      );
      expect(result.isRead).toBe(true);
    });
  });

  describe('markNotificationRead', () => {
    it('kiểm tra recipient (qua getMyNotificationDetail) trước khi ghi Redis', async () => {
      repo.findOne.mockResolvedValue({
        id: 'n1',
        recipientUserIdsJson: ['u1'],
        createdAt: new Date(),
      });
      readStateService.isRead.mockResolvedValue(false);

      await service.markNotificationRead('n1', 'u1');

      expect(readStateService.markRead).toHaveBeenCalledWith('u1', 'n1');
    });

    it('không phải recipient → 403, KHÔNG gọi markRead', async () => {
      repo.findOne.mockResolvedValue({
        id: 'n1',
        recipientUserIdsJson: ['other-user'],
        createdAt: new Date(),
      });

      await expect(service.markNotificationRead('n1', 'u1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(readStateService.markRead).not.toHaveBeenCalled();
    });
  });

  describe('markAllNotificationsRead', () => {
    it('gọi readStateService.markAllRead với userId', async () => {
      await service.markAllNotificationsRead('u1');
      expect(readStateService.markAllRead).toHaveBeenCalledWith('u1');
    });
  });

  describe('listMyNotifications — ẩn thông báo hẹn giờ chưa tới hạn', () => {
    it('lọc scheduled_send_at: chỉ lấy thông báo không hẹn giờ hoặc đã tới giờ', async () => {
      queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);
      readStateService.getReadState.mockResolvedValue({} as any);

      await service.listMyNotifications('u1', 1, 20);

      const clauses = queryBuilder.andWhere.mock.calls.map((c: any[]) =>
        String(c[0]),
      );
      expect(
        clauses.some(
          (c: string) =>
            c.includes('scheduled_send_at IS NULL') &&
            c.includes('scheduled_send_at <= now()'),
        ),
      ).toBe(true);
    });
  });
});

describe('NotificationsService — nhắc lịch hẹn giờ', () => {
  let service: NotificationsService;
  let repo: any;
  let queueService: any;
  let backgroundJobsService: any;
  let websocketService: any;

  beforeEach(() => {
    repo = {
      create: jest.fn((v) => v),
      save: jest.fn((v) =>
        Promise.resolve({ id: 'n-1', createdAt: new Date(), ...v }),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn(),
    };
    queueService = { addJob: jest.fn().mockResolvedValue('bull-1') };
    backgroundJobsService = {
      createQueuedJob: jest.fn().mockResolvedValue({ id: 'bg-1' }),
      markFailed: jest.fn(),
    };
    websocketService = { emitToUser: jest.fn() };
    service = new NotificationsService(
      repo,
      queueService,
      backgroundJobsService,
      { get: jest.fn((_k: string, d?: unknown) => d) } as any,
      {} as any,
      {} as any,
      websocketService,
    );
  });

  it('createNotification hẹn giờ trong tương lai → KHÔNG đẩy realtime ngay', async () => {
    await service.createNotification({
      notificationType: NotificationType.REMINDER,
      channel: NotificationChannel.IN_APP,
      content: 'c',
      recipientUserIds: ['u1'],
      scheduledSendAt: new Date(Date.now() + 60_000),
    });
    expect(websocketService.emitToUser).not.toHaveBeenCalled();
  });

  it('createNotification không hẹn giờ → đẩy realtime như cũ', async () => {
    await service.createNotification({
      notificationType: NotificationType.REMINDER,
      channel: NotificationChannel.IN_APP,
      content: 'c',
      recipientUserIds: ['u1'],
    });
    expect(websocketService.emitToUser).toHaveBeenCalledWith(
      'u1',
      'notification.created',
      expect.anything(),
    );
  });

  it('deliverScheduledInApp: giữ chỗ draft → sent (làm mới created_at) rồi đẩy realtime', async () => {
    repo.findOne.mockResolvedValue({
      id: 'n-1',
      channel: NotificationChannel.IN_APP,
      recipientUserIdsJson: ['u1'],
      createdAt: new Date(),
    });

    const ok = await service.deliverScheduledInApp('n-1');

    expect(ok).toBe(true);
    const [where, patch] = repo.update.mock.calls[0];
    expect(where).toEqual({
      id: 'n-1',
      deliveryStatus: NotificationDeliveryStatus.DRAFT,
    });
    expect(patch.deliveryStatus).toBe(NotificationDeliveryStatus.SENT);
    expect(patch.sentAt).toBeInstanceOf(Date);
    expect(patch.createdAt).toBeInstanceOf(Date);
    expect(websocketService.emitToUser).toHaveBeenCalledWith(
      'u1',
      'notification.created',
      expect.anything(),
    );
  });

  it('deliverScheduledInApp: đã bị tick khác xử lý (affected=0) → false, không đẩy', async () => {
    repo.update.mockResolvedValue({ affected: 0 });

    const ok = await service.deliverScheduledInApp('n-1');

    expect(ok).toBe(false);
    expect(websocketService.emitToUser).not.toHaveBeenCalled();
  });

  it('claimDraft: chỉ chuyển draft → queued một lần', async () => {
    repo.update
      .mockResolvedValueOnce({ affected: 1 })
      .mockResolvedValueOnce({ affected: 0 });

    expect(await service.claimDraft('n-1')).toBe(true);
    expect(await service.claimDraft('n-1')).toBe(false);
    expect(repo.update.mock.calls[0]).toEqual([
      { id: 'n-1', deliveryStatus: NotificationDeliveryStatus.DRAFT },
      { deliveryStatus: NotificationDeliveryStatus.QUEUED },
    ]);
  });

  it('enqueueEmailForExistingNotification: dùng lại bản ghi có sẵn, không tạo thông báo mới', async () => {
    const row: any = {
      id: 'n-mail',
      subject: 'Nhắc lịch họp: X',
      content: 'c',
      payloadJson: { reminderType: 'scheduled' },
      createdBy: null,
    };

    await service.enqueueEmailForExistingNotification(
      row,
      ['a@example.com'],
      '<p>html</p>',
    );

    expect(repo.save).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('n-mail', {
      recipientEmailsJson: ['a@example.com'],
    });
    const job = queueService.addJob.mock.calls[0][2];
    expect(job).toMatchObject({
      notificationId: 'n-mail',
      backgroundJobId: 'bg-1',
      toEmails: ['a@example.com'],
      emailHtml: '<p>html</p>',
    });
  });

  it('markCancelled: chuyển trạng thái cancelled kèm lý do', async () => {
    await service.markCancelled('n-1', 'Cuộc họp đã huỷ');
    expect(repo.update).toHaveBeenCalledWith('n-1', {
      deliveryStatus: NotificationDeliveryStatus.CANCELLED,
      failureReason: 'Cuộc họp đã huỷ',
    });
  });
});
