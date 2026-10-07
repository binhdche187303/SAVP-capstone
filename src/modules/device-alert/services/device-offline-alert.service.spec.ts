/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
import {
  DeviceOfflineAlertService,
  formatCameraList,
} from './device-offline-alert.service.js';

describe('DeviceOfflineAlertService', () => {
  let service: DeviceOfflineAlertService;
  let alertRulesMock: { findEffectiveRule: jest.Mock };
  let alertsMock: { recordAlert: jest.Mock };
  let notifierMock: { notifyDeviceStatus: jest.Mock };
  let dsMock: { manager: { query: jest.Mock } };

  const detectedAt = new Date('2026-10-06T10:00:00Z');
  const cam = (i: number, zoneId: string | null = 'z1') => ({
    deviceId: `d${i}`,
    deviceCode: `CAM-${i}`,
    deviceName: `Cam ${i}`,
    zoneId,
    detectedAt,
  });
  const ref = (i: number) => ({
    deviceId: `d${i}`,
    deviceCode: `CAM-${i}`,
    deviceName: `Cam ${i}`,
  });

  beforeEach(() => {
    alertRulesMock = {
      findEffectiveRule: jest
        .fn()
        .mockResolvedValue({ rule: null, suppressed: false }),
    };
    alertsMock = {
      recordAlert: jest.fn().mockResolvedValue({
        alert: { id: 'a1', severity: 'low' },
        isNew: true,
      }),
    };
    notifierMock = {
      notifyDeviceStatus: jest.fn().mockResolvedValue(undefined),
    };
    dsMock = { manager: { query: jest.fn().mockResolvedValue([[], 0]) } };
    service = new DeviceOfflineAlertService(
      alertRulesMock as any,
      alertsMock as any,
      notifierMock as any,
      dsMock as any,
    );
  });

  describe('onDevicesOffline', () => {
    it('1 camera → recordAlert device_error theo zone, payload thiết bị', async () => {
      await service.onDevicesOffline([cam(1)]);

      expect(alertRulesMock.findEffectiveRule).toHaveBeenCalledWith(
        'device_error',
        'z1',
      );
      expect(alertsMock.recordAlert).toHaveBeenCalledWith({
        alertType: 'device_error',
        zoneId: 'z1',
        ruleId: null,
        triggeredAt: detectedAt,
        payloadJson: {
          reason: 'offline',
          ...ref(1),
          offlineDevices: [ref(1)],
        },
      });
      // alert mới → notifier chuẩn lo, KHÔNG gửi thêm / KHÔNG append.
      expect(dsMock.manager.query).not.toHaveBeenCalled();
      expect(notifierMock.notifyDeviceStatus).not.toHaveBeenCalled();
    });

    it('100 camera cùng khu vực → 1 lần recordAlert với đủ 100 camera, 0 thông báo phụ', async () => {
      const evts = Array.from({ length: 100 }, (_, i) => cam(i + 1));

      await service.onDevicesOffline(evts);

      expect(alertRulesMock.findEffectiveRule).toHaveBeenCalledTimes(1);
      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
      const payload = alertsMock.recordAlert.mock.calls[0][0].payloadJson;
      expect(payload.offlineDevices).toHaveLength(100);
      expect(notifierMock.notifyDeviceStatus).not.toHaveBeenCalled();
    });

    it('nhiều khu vực → mỗi khu vực 1 lần recordAlert', async () => {
      await service.onDevicesOffline([
        cam(1, 'z1'),
        cam(2, 'z1'),
        cam(3, 'z2'),
        cam(4, null),
      ]);

      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(3);
      const zones = alertsMock.recordAlert.mock.calls.map((c) => c[0].zoneId);
      expect(zones).toEqual(['z1', 'z2', null]);
    });

    it('rule có id → truyền ruleId vào recordAlert', async () => {
      alertRulesMock.findEffectiveRule.mockResolvedValue({
        rule: { id: 'r1' },
        suppressed: false,
      });
      await service.onDevicesOffline([cam(1)]);
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({ ruleId: 'r1' }),
      );
    });

    it('rule tắt → KHÔNG recordAlert', async () => {
      alertRulesMock.findEffectiveRule.mockResolvedValue({
        rule: null,
        suppressed: true,
      });
      await service.onDevicesOffline([cam(1), cam(2)]);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('rule check lỗi → fail-open vẫn recordAlert', async () => {
      alertRulesMock.findEffectiveRule.mockRejectedValue(new Error('db'));
      await service.onDevicesOffline([cam(1)]);
      expect(alertsMock.recordAlert).toHaveBeenCalled();
    });

    it('recordAlert lỗi → KHÔNG throw, khu vực khác vẫn xử lý', async () => {
      alertsMock.recordAlert
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({ alert: { id: 'a2' }, isNew: true });
      await expect(
        service.onDevicesOffline([cam(1, 'z1'), cam(2, 'z2')]),
      ).resolves.toBeUndefined();
      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(2);
    });

    describe('alert đang mở (bump)', () => {
      beforeEach(() => {
        alertsMock.recordAlert.mockResolvedValue({
          alert: { id: 'a1', severity: 'low', zoneId: 'z1' },
          isNew: false,
        });
      });

      it('append cả lô bằng 1 UPDATE + gửi đúng 1 thông báo liệt kê số camera', async () => {
        dsMock.manager.query.mockResolvedValue([
          [{ total: 5, added: [ref(2), ref(3), ref(4)] }],
          1,
        ]);

        await service.onDevicesOffline([cam(2), cam(3), cam(4)]);

        expect(dsMock.manager.query).toHaveBeenCalledTimes(1);
        const [sql, params] = dsMock.manager.query.mock.calls[0];
        expect(sql).toContain('UPDATE security_alerts');
        expect(params[0]).toBe('a1');
        expect(JSON.parse(params[1])).toHaveLength(3);
        expect(notifierMock.notifyDeviceStatus).toHaveBeenCalledTimes(1);
        const [, title, content] =
          notifierMock.notifyDeviceStatus.mock.calls[0];
        expect(title).toBe('Cảnh báo: thêm 3 camera mất kết nối');
        expect(content).toContain(
          'Cam 2 (CAM-2), Cam 3 (CAM-3), Cam 4 (CAM-4)',
        );
        expect(content).toContain('5 camera đang mất kết nối');
      });

      it('mọi camera đã có trong danh sách (UPDATE 0 dòng) → KHÔNG báo lại', async () => {
        dsMock.manager.query.mockResolvedValue([[], 0]);
        await service.onDevicesOffline([cam(1)]);
        expect(notifierMock.notifyDeviceStatus).not.toHaveBeenCalled();
      });
    });
  });

  describe('onDevicesOnline', () => {
    const row = (over: Record<string, unknown>) => ({
      id: 'a1',
      alert_type: 'device_error',
      severity: 'low',
      zone_id: 'z1',
      triggered_at: detectedAt,
      recovered_ids: ['d1'],
      remaining: 0,
      ...over,
    });

    it('rỗng → không query', async () => {
      await service.onDevicesOnline([]);
      expect(dsMock.manager.query).not.toHaveBeenCalled();
    });

    it('camera cuối có lại → gỡ + đóng alert + 1 thông báo "đã tự động đóng"', async () => {
      dsMock.manager.query
        .mockResolvedValueOnce([row({})])
        .mockResolvedValueOnce([[{ id: 'a1' }], 1]);

      await service.onDevicesOnline([cam(1)]);

      expect(dsMock.manager.query).toHaveBeenCalledTimes(2);
      expect(dsMock.manager.query.mock.calls[0][1]).toEqual([['d1']]);
      expect(dsMock.manager.query.mock.calls[1][0]).toContain(
        "status = 'resolved'",
      );
      expect(dsMock.manager.query.mock.calls[1][1]).toEqual([['a1']]);
      expect(notifierMock.notifyDeviceStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1' }),
        'Camera đã có tín hiệu lại',
        'Camera Cam 1 (CAM-1) đã có tín hiệu lại. Cảnh báo đã tự động đóng.',
      );
    });

    it('100 camera có lại cùng lúc ở 1 khu vực → 2 query, 1 thông báo', async () => {
      const evts = Array.from({ length: 100 }, (_, i) => cam(i + 1));
      dsMock.manager.query
        .mockResolvedValueOnce([
          row({ recovered_ids: evts.map((e) => e.deviceId) }),
        ])
        .mockResolvedValueOnce([[{ id: 'a1' }], 1]);

      await service.onDevicesOnline(evts);

      expect(dsMock.manager.query).toHaveBeenCalledTimes(2);
      expect(notifierMock.notifyDeviceStatus).toHaveBeenCalledTimes(1);
      const [, title, content] = notifierMock.notifyDeviceStatus.mock.calls[0];
      expect(title).toBe('100 camera đã có tín hiệu lại');
      expect(content).toContain('và 95 camera khác');
      expect(content).toContain('Cảnh báo đã tự động đóng.');
    });

    it('còn camera rớt → KHÔNG đóng, báo số còn lại', async () => {
      dsMock.manager.query.mockResolvedValueOnce([row({ remaining: 2 })]);

      await service.onDevicesOnline([cam(1)]);

      expect(dsMock.manager.query).toHaveBeenCalledTimes(1); // không UPDATE resolve
      expect(notifierMock.notifyDeviceStatus).toHaveBeenCalledWith(
        expect.anything(),
        'Camera đã có tín hiệu lại',
        'Camera Cam 1 (CAM-1) đã có tín hiệu lại. Còn 2 camera đang mất kết nối trong khu vực.',
      );
    });

    it('nhiều alert (2 khu vực) → mỗi alert 1 thông báo', async () => {
      dsMock.manager.query
        .mockResolvedValueOnce([
          row({ id: 'a1', recovered_ids: ['d1'] }),
          row({ id: 'a2', zone_id: 'z2', recovered_ids: ['d2'], remaining: 1 }),
        ])
        .mockResolvedValueOnce([[{ id: 'a1' }], 1]);

      await service.onDevicesOnline([cam(1, 'z1'), cam(2, 'z2')]);

      expect(dsMock.manager.query.mock.calls[1][1]).toEqual([['a1']]);
      expect(notifierMock.notifyDeviceStatus).toHaveBeenCalledTimes(2);
    });

    it('không có alert đang mở chứa camera → không thông báo', async () => {
      dsMock.manager.query.mockResolvedValueOnce([]);
      await service.onDevicesOnline([cam(1)]);
      expect(notifierMock.notifyDeviceStatus).not.toHaveBeenCalled();
    });

    it('query lỗi → KHÔNG throw', async () => {
      dsMock.manager.query.mockRejectedValue(new Error('db down'));
      await expect(service.onDevicesOnline([cam(1)])).resolves.toBeUndefined();
    });
  });

  describe('formatCameraList', () => {
    it('≤5 camera → liệt kê đủ', () => {
      expect(formatCameraList([ref(1), ref(2)])).toBe(
        'Cam 1 (CAM-1), Cam 2 (CAM-2)',
      );
    });
    it('>5 camera → 5 tên + "và N camera khác"', () => {
      const refs = Array.from({ length: 8 }, (_, i) => ref(i + 1));
      expect(formatCameraList(refs)).toBe(
        'Cam 1 (CAM-1), Cam 2 (CAM-2), Cam 3 (CAM-3), Cam 4 (CAM-4), Cam 5 (CAM-5) và 3 camera khác',
      );
    });
  });
});
