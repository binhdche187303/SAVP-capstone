/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { DeviceOfflineAlertService } from './device-offline-alert.service.js';

describe('DeviceOfflineAlertService', () => {
  let service: DeviceOfflineAlertService;
  let alertRulesMock: { findEffectiveRule: jest.Mock };
  let alertsMock: { recordAlert: jest.Mock };
  let notifierMock: { notifyDeviceStatus: jest.Mock };
  let dsMock: { manager: { query: jest.Mock } };

  const evt = {
    deviceId: 'd1',
    deviceCode: 'CAM-1',
    deviceName: 'Cam cổng',
    zoneId: 'z1',
    detectedAt: new Date('2026-10-06T10:00:00Z'),
  };

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

  it('recordAlert device_error theo zone, payload thiết bị', async () => {
    await service.onDeviceOffline(evt);

    expect(alertRulesMock.findEffectiveRule).toHaveBeenCalledWith(
      'device_error',
      'z1',
    );
    expect(alertsMock.recordAlert).toHaveBeenCalledWith({
      alertType: 'device_error',
      zoneId: 'z1',
      ruleId: null,
      triggeredAt: evt.detectedAt,
      payloadJson: {
        reason: 'offline',
        deviceId: 'd1',
        deviceCode: 'CAM-1',
        deviceName: 'Cam cổng',
        offlineDevices: [
          { deviceId: 'd1', deviceCode: 'CAM-1', deviceName: 'Cam cổng' },
        ],
      },
    });
    // alert mới → notifier chuẩn lo, KHÔNG gửi thêm / KHÔNG append.
    expect(dsMock.manager.query).not.toHaveBeenCalled();
    expect(notifierMock.notifyDeviceStatus).not.toHaveBeenCalled();
  });

  it('rule có id → truyền ruleId vào recordAlert', async () => {
    alertRulesMock.findEffectiveRule.mockResolvedValue({
      rule: { id: 'r1' },
      suppressed: false,
    });
    await service.onDeviceOffline(evt);
    expect(alertsMock.recordAlert).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'r1' }),
    );
  });

  it('suppressed=true → KHÔNG recordAlert', async () => {
    alertRulesMock.findEffectiveRule.mockResolvedValue({
      rule: { id: 'r1' },
      suppressed: true,
    });
    await service.onDeviceOffline(evt);
    expect(alertsMock.recordAlert).not.toHaveBeenCalled();
  });

  it('findEffectiveRule lỗi → vẫn recordAlert (ruleId null)', async () => {
    alertRulesMock.findEffectiveRule.mockRejectedValue(new Error('db'));
    await service.onDeviceOffline(evt);
    expect(alertsMock.recordAlert).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: null }),
    );
  });

  it('recordAlert lỗi → KHÔNG throw', async () => {
    alertsMock.recordAlert.mockRejectedValue(new Error('db down'));
    await expect(service.onDeviceOffline(evt)).resolves.toBeUndefined();
  });

  it('zone null → recordAlert zoneId null', async () => {
    await service.onDeviceOffline({ ...evt, zoneId: null });
    expect(alertsMock.recordAlert).toHaveBeenCalledWith(
      expect.objectContaining({ zoneId: null }),
    );
  });

  describe('6.3 nhiều camera cùng khu vực', () => {
    beforeEach(() => {
      alertsMock.recordAlert.mockResolvedValue({
        alert: { id: 'a1', severity: 'low' },
        isNew: false,
      });
    });

    it('bump + camera mới → append offlineDevices và báo "N camera"', async () => {
      dsMock.manager.query.mockResolvedValue([[{ n: 2 }], 1]);
      await service.onDeviceOffline(evt);
      const [sql, params] = dsMock.manager.query.mock.calls[0];
      expect(sql).toContain("'{offlineDevices}'");
      expect(params[0]).toBe('a1');
      expect(JSON.parse(params[2])).toEqual([{ deviceId: 'd1' }]);
      expect(notifierMock.notifyDeviceStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1' }),
        expect.any(String),
        expect.stringContaining('2 camera'),
      );
    });

    it('camera đã có trong danh sách → KHÔNG báo lại', async () => {
      dsMock.manager.query.mockResolvedValue([[], 0]);
      await service.onDeviceOffline(evt);
      expect(notifierMock.notifyDeviceStatus).not.toHaveBeenCalled();
    });
  });

  describe('6.2 camera có tín hiệu lại', () => {
    const row = {
      id: 'a1',
      alert_type: 'device_error',
      severity: 'low',
      zone_id: 'z1',
      triggered_at: new Date(),
    };

    it('hết camera offline → resolve + báo đã đóng', async () => {
      dsMock.manager.query
        .mockResolvedValueOnce([[{ ...row, remaining: 0 }], 1])
        .mockResolvedValueOnce([[{ id: 'a1' }], 1]);
      await service.onDeviceOnline(evt);
      // placeholder SQL khớp số tham số ($1 deviceId, $2 jsonb) — lỗi thật đã gặp khi E2E.
      const [sql0, params0] = dsMock.manager.query.mock.calls[0];
      expect(params0).toEqual(['d1', JSON.stringify([{ deviceId: 'd1' }])]);
      expect(sql0).not.toMatch(/\$3/);
      expect(dsMock.manager.query.mock.calls[1][0]).toContain(
        "status = 'resolved'",
      );
      expect(notifierMock.notifyDeviceStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'a1', zoneId: 'z1' }),
        'Camera đã có tín hiệu lại',
        expect.stringContaining('tự động đóng'),
      );
    });

    it('còn camera offline → KHÔNG resolve, báo số còn lại', async () => {
      dsMock.manager.query.mockResolvedValueOnce([
        [{ ...row, remaining: 1 }],
        1,
      ]);
      await service.onDeviceOnline(evt);
      expect(dsMock.manager.query).toHaveBeenCalledTimes(1);
      expect(notifierMock.notifyDeviceStatus).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        expect.stringContaining('Còn 1 camera'),
      );
    });

    it('không có alert chứa camera → không báo', async () => {
      await service.onDeviceOnline(evt);
      expect(notifierMock.notifyDeviceStatus).not.toHaveBeenCalled();
    });

    it('query lỗi → KHÔNG throw', async () => {
      dsMock.manager.query.mockRejectedValue(new Error('db'));
      await expect(service.onDeviceOnline(evt)).resolves.toBeUndefined();
    });
  });
});
