/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import {
  SECURITY_ALERT_NEW_EVENT,
  SecurityAlertNotifierService,
} from './security-alert-notifier.service.js';
import {
  NotificationChannel,
  NotificationPriority,
  NotificationType,
} from '../../notifications/entities/notification.entity.js';

describe('SecurityAlertNotifierService', () => {
  let service: SecurityAlertNotifierService;
  let ruleRepo: { findOne: jest.Mock };
  let notif: {
    createNotification: jest.Mock;
    enqueueEmailNotification: jest.Mock;
  };
  let ws: { emitToUser: jest.Mock };
  let query: jest.Mock;

  const recipients = [
    { id: 'sa1', email: 'sa@x.vn' },
    { id: 'mgr1', email: null },
  ];

  const crowdAlert = (over: Record<string, unknown> = {}): any => ({
    id: 'a1',
    alertType: 'crowd',
    severity: 'high',
    zoneId: 'z1',
    ruleId: 'r1',
    triggeredAt: new Date('2026-10-06T10:00:00Z'),
    payloadJson: { occupancyCount: 10, threshold: 3 },
    ...over,
  });

  beforeEach(() => {
    ruleRepo = {
      findOne: jest.fn().mockResolvedValue({ channels: ['in_app', 'email'] }),
    };
    notif = {
      createNotification: jest.fn().mockResolvedValue({}),
      enqueueEmailNotification: jest.fn().mockResolvedValue({}),
    };
    ws = { emitToUser: jest.fn() };
    query = jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('FROM zones') ? [{ zone_name: 'Bãi đỗ xe' }] : recipients,
      ),
    );
    service = new SecurityAlertNotifierService(
      ruleRepo as any,
      notif as any,
      ws as any,
      { manager: { query } } as any,
    );
  });

  it('crowd mới, rule in_app+email, high → WS mọi người nhận + in_app + email', async () => {
    await service.notifyNewAlert(crowdAlert());

    expect(ws.emitToUser).toHaveBeenCalledTimes(2);
    expect(ws.emitToUser).toHaveBeenCalledWith(
      'sa1',
      SECURITY_ALERT_NEW_EVENT,
      expect.objectContaining({ alertId: 'a1', severity: 'high' }),
    );

    expect(notif.createNotification).toHaveBeenCalledTimes(1);
    const dto = notif.createNotification.mock.calls[0][0];
    expect(dto.notificationType).toBe(NotificationType.SECURITY_ALERT);
    expect(dto.channel).toBe(NotificationChannel.IN_APP);
    expect(dto.priority).toBe(NotificationPriority.HIGH);
    expect(dto.subject).toBe(
      'Cảnh báo tụ tập đông người – Bãi đỗ xe (10/3 người)',
    );
    expect(dto.recipientUserIds).toEqual(['sa1', 'mgr1']);
    expect(dto.relatedEntityId).toBe('a1');

    expect(notif.enqueueEmailNotification).toHaveBeenCalledTimes(1);
    const mail = notif.enqueueEmailNotification.mock.calls[0][0];
    expect(mail.toEmails).toEqual(['sa@x.vn']); // bỏ user không có email
    expect(mail.emailHtml).toContain('Bãi đỗ xe');
  });

  it('người nhận lấy theo quyền security_alert.read', async () => {
    await service.notifyNewAlert(crowdAlert());
    const call = query.mock.calls.find((c) => String(c[0]).includes('users'));
    expect(call[0]).toContain('permission_code = $1');
    expect(call[1]).toEqual(['security_alert.read']);
  });

  it('rule chỉ in_app → KHÔNG email', async () => {
    ruleRepo.findOne.mockResolvedValue({ channels: ['in_app'] });
    await service.notifyNewAlert(crowdAlert());
    expect(notif.createNotification).toHaveBeenCalled();
    expect(notif.enqueueEmailNotification).not.toHaveBeenCalled();
  });

  it('rule chỉ email → email, KHÔNG in_app, vẫn WS', async () => {
    ruleRepo.findOne.mockResolvedValue({ channels: ['email'] });
    await service.notifyNewAlert(crowdAlert());
    expect(notif.createNotification).not.toHaveBeenCalled();
    expect(notif.enqueueEmailNotification).toHaveBeenCalled();
    expect(ws.emitToUser).toHaveBeenCalled();
  });

  it('email nhưng severity medium → KHÔNG email (ngưỡng high)', async () => {
    await service.notifyNewAlert(crowdAlert({ severity: 'medium' }));
    expect(notif.enqueueEmailNotification).not.toHaveBeenCalled();
    expect(notif.createNotification).toHaveBeenCalled();
  });

  it('không có rule → mặc định in_app', async () => {
    await service.notifyNewAlert(crowdAlert({ ruleId: null }));
    expect(ruleRepo.findOne).not.toHaveBeenCalled();
    expect(notif.createNotification).toHaveBeenCalled();
    expect(notif.enqueueEmailNotification).not.toHaveBeenCalled();
  });

  it('intrusion critical → URGENT, tiêu đề xâm nhập kèm tên', async () => {
    await service.notifyNewAlert(
      crowdAlert({
        alertType: 'intrusion',
        severity: 'critical',
        payloadJson: { fullName: 'Nguyễn Văn A' },
      }),
    );
    const dto = notif.createNotification.mock.calls[0][0];
    expect(dto.priority).toBe(NotificationPriority.URGENT);
    expect(dto.subject).toBe('Cảnh báo xâm nhập khu vực hạn chế – Bãi đỗ xe');
    expect(dto.content).toContain('Nguyễn Văn A');
  });

  it('device_error → loại DEVICE_OFFLINE_ALERT, nội dung camera', async () => {
    await service.notifyNewAlert(
      crowdAlert({
        alertType: 'device_error',
        severity: 'low',
        payloadJson: { deviceName: 'Cam cổng', deviceCode: 'CAM-1' },
      }),
    );
    const dto = notif.createNotification.mock.calls[0][0];
    expect(dto.notificationType).toBe(NotificationType.DEVICE_OFFLINE_ALERT);
    expect(dto.subject).toBe('Cảnh báo: camera mất kết nối');
    expect(dto.content).toBe('Camera Cam cổng (CAM-1) không còn phản hồi.');
  });

  const strangerAlert = (over: Record<string, unknown> = {}): any =>
    crowdAlert({
      alertType: 'stranger',
      severity: 'medium',
      zoneId: null,
      payloadJson: {
        deviceId: 'dev1',
        deviceCode: 'FACE-1',
        roomName: 'Phòng A',
      },
      ...over,
    });

  it('stranger → in_app UNKNOWN_FACE_ALERT cho người có quyền (gồm MANAGER), nội dung thiết bị + phòng', async () => {
    ruleRepo.findOne.mockResolvedValue({ channels: ['in_app'] });
    await service.notifyNewAlert(strangerAlert());
    expect(notif.createNotification).toHaveBeenCalledTimes(1);
    const dto = notif.createNotification.mock.calls[0][0];
    expect(dto.notificationType).toBe(NotificationType.UNKNOWN_FACE_ALERT);
    expect(dto.recipientUserIds).toEqual(['sa1', 'mgr1']);
    expect(dto.subject).toBe('Cảnh báo khuôn mặt lạ');
    expect(dto.content).toBe(
      'Phát hiện khuôn mặt lạ tại thiết bị FACE-1 (phòng Phòng A).',
    );
  });

  it('stranger (medium) + rule tick email → GỬI email (theo rule, không xét ngưỡng high)', async () => {
    await service.notifyNewAlert(strangerAlert());
    expect(notif.enqueueEmailNotification).toHaveBeenCalledTimes(1);
    expect(notif.enqueueEmailNotification.mock.calls[0][0].toEmails).toEqual([
      'sa@x.vn',
    ]);
  });

  it('stranger + rule KHÔNG tick email → KHÔNG email', async () => {
    ruleRepo.findOne.mockResolvedValue({ channels: ['in_app'] });
    await service.notifyNewAlert(strangerAlert());
    expect(notif.enqueueEmailNotification).not.toHaveBeenCalled();
  });

  it.each(['person_watchlist_match', 'unknown_vehicle'])(
    '%s đã tự gửi in_app → notifier KHÔNG gửi in_app lần 2, vẫn WS',
    async (alertType) => {
      await service.notifyNewAlert(crowdAlert({ alertType }));
      expect(notif.createNotification).not.toHaveBeenCalled();
      expect(ws.emitToUser).toHaveBeenCalled();
    },
  );

  it('không có người nhận → không gửi gì', async () => {
    query.mockResolvedValue([]);
    await service.notifyNewAlert(crowdAlert());
    expect(ws.emitToUser).not.toHaveBeenCalled();
    expect(notif.createNotification).not.toHaveBeenCalled();
  });

  it('in_app lỗi → vẫn gửi email, KHÔNG throw', async () => {
    notif.createNotification.mockRejectedValue(new Error('db'));
    await expect(service.notifyNewAlert(crowdAlert())).resolves.toBeUndefined();
    expect(notif.enqueueEmailNotification).toHaveBeenCalled();
  });

  it('query người nhận lỗi → KHÔNG throw', async () => {
    query.mockRejectedValue(new Error('db down'));
    await expect(service.notifyNewAlert(crowdAlert())).resolves.toBeUndefined();
  });
});
