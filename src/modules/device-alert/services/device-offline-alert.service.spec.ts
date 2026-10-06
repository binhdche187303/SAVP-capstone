/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { DeviceOfflineAlertService } from './device-offline-alert.service.js';

describe('DeviceOfflineAlertService', () => {
  let service: DeviceOfflineAlertService;
  let alertRulesMock: { findEffectiveRule: jest.Mock };
  let alertsMock: { recordAlert: jest.Mock };

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
    service = new DeviceOfflineAlertService(
      alertRulesMock as any,
      alertsMock as any,
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
      },
    });
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
});
