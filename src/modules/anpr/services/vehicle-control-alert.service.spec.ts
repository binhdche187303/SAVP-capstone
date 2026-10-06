/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { VehicleControlAlertService } from './vehicle-control-alert.service.js';

describe('VehicleControlAlertService (VCC-001 / UC9)', () => {
  let service: VehicleControlAlertService;
  let controlListMock: any;
  let notifMock: any;
  let dsMock: any;
  let alertRulesMock: any;
  let alertsMock: any;
  let cfg: Record<string, unknown>;

  const adminRows = [{ id: 'admin1' }, { id: 'admin2' }];
  const blocklistMatch = {
    id: 'cl1',
    plateNumber: '30A12345',
    listType: 'blocklist',
    reason: 'stolen',
  };
  const watchlistMatch = {
    id: 'cl2',
    plateNumber: '30A12345',
    listType: 'watchlist',
    reason: null,
  };

  const build = () => {
    controlListMock = { checkControlList: jest.fn().mockResolvedValue(null) };
    notifMock = { createNotification: jest.fn().mockResolvedValue({}) };
    dsMock = {
      manager: { query: jest.fn().mockResolvedValue(adminRows) },
    };
    alertRulesMock = {
      findEffectiveRule: jest
        .fn()
        .mockResolvedValue({ rule: null, suppressed: false }),
    };
    alertsMock = { recordAlert: jest.fn().mockResolvedValue({ isNew: true }) };
    const cfgMock = { get: (k: string, d?: unknown) => cfg[k] ?? d };
    service = new VehicleControlAlertService(
      controlListMock,
      notifMock,
      cfgMock as any,
      dsMock,
      alertRulesMock,
      alertsMock,
    );
  };

  beforeEach(() => {
    cfg = {};
    build();
  });

  const ctx = { channelId: 5, direction: 'enter' };

  it('không match → KHÔNG gọi createNotification', async () => {
    await service.evaluate('30A12345', ctx);
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  it('blocklist match → createNotification 1 lần, priority HIGH, đúng notificationType + recipient', async () => {
    controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
    await service.evaluate('30A12345', ctx);
    expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    const dto = notifMock.createNotification.mock.calls[0][0];
    expect(dto.notificationType).toBe('vehicle_control_list_match');
    expect(dto.priority).toBe('high');
    expect(dto.channel).toBe('in_app');
    expect(dto.recipientUserIds).toEqual(['admin1', 'admin2']);
    // Tiếng Việt thật, không phải chuỗi escape literal "ả" (lộ ra ở WS realtime)
    expect(dto.subject).toBe('Cảnh báo: xe trong danh sách chặn');
    expect(dto.content).toContain('Biển số 30A12345 vừa qua cổng');
    expect(dto.content).toContain('Lý do: stolen.');
    expect(`${dto.subject}${dto.content}`).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    expect(dto.payloadJson).toMatchObject({
      plateNumber: '30A12345',
      listType: 'blocklist',
      reason: 'stolen',
      channelId: 5,
      direction: 'enter',
      controlListEntryId: 'cl1',
    });
  });

  it('watchlist match → priority NORMAL, subject/content khác blocklist', async () => {
    controlListMock.checkControlList.mockResolvedValue(watchlistMatch);
    await service.evaluate('30A12345', ctx);
    const dto = notifMock.createNotification.mock.calls[0][0];
    expect(dto.priority).toBe('normal');
    expect(dto.subject).not.toBe('Cảnh báo: xe trong danh sách chặn');
    expect(dto.payloadJson.listType).toBe('watchlist');
  });

  describe('throttle theo plate', () => {
    it('2 lần liên tiếp cùng plate trong window → chỉ 1 createNotification', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      await service.evaluate('30A12345', ctx);
      await service.evaluate('30A12345', ctx);
      expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    });

    it('plate khác → KHÔNG bị throttle chéo', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      await service.evaluate('30A12345', ctx);
      controlListMock.checkControlList.mockResolvedValue({
        ...blocklistMatch,
        id: 'cl3',
        plateNumber: '51F99999',
      });
      await service.evaluate('51F99999', ctx);
      expect(notifMock.createNotification).toHaveBeenCalledTimes(2);
    });

    it('qua khỏi throttle window → gọi lại createNotification', async () => {
      cfg = { VEHICLE_CONTROL_ALERT_THROTTLE_SECONDS: 1 }; // 1s cho test nhanh
      build();
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      const nowSpy = jest.spyOn(Date, 'now');
      nowSpy.mockReturnValue(1_000_000);
      await service.evaluate('30A12345', ctx);
      nowSpy.mockReturnValue(1_000_000 + 1500); // >1s sau
      await service.evaluate('30A12345', ctx);
      expect(notifMock.createNotification).toHaveBeenCalledTimes(2);
      nowSpy.mockRestore();
    });
  });

  it('recipient rỗng → KHÔNG gọi createNotification, KHÔNG throw', async () => {
    controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
    dsMock.manager.query.mockResolvedValue([]);
    await expect(service.evaluate('30A12345', ctx)).resolves.toBeUndefined();
    expect(notifMock.createNotification).not.toHaveBeenCalled();
  });

  describe('NotThrow', () => {
    it('checkControlList reject → evaluate KHÔNG throw', async () => {
      controlListMock.checkControlList.mockRejectedValue(new Error('db boom'));
      await expect(service.evaluate('30A12345', ctx)).resolves.toBeUndefined();
    });

    it('createNotification reject → evaluate KHÔNG throw', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      notifMock.createNotification.mockRejectedValue(new Error('queue down'));
      await expect(service.evaluate('30A12345', ctx)).resolves.toBeUndefined();
    });

    it('resolveRecipients (dataSource.query) reject → evaluate KHÔNG throw', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      dsMock.manager.query.mockRejectedValue(new Error('conn refused'));
      await expect(service.evaluate('30A12345', ctx)).resolves.toBeUndefined();
    });
  });

  describe('ASM-001 (Bước 3 / 3d) — recordAlert wiring', () => {
    it('suppressed=true → KHÔNG gọi recordAlert lẫn createNotification (AF1)', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      alertRulesMock.findEffectiveRule.mockResolvedValue({
        rule: null,
        suppressed: true,
      });
      await service.evaluate('30A12345', ctx);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
      expect(notifMock.createNotification).not.toHaveBeenCalled();
    });

    it('không suppressed → recordAlert gọi TRƯỚC createNotification, severity đúng theo listType', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      const callOrder: string[] = [];
      alertsMock.recordAlert.mockImplementation(() => {
        callOrder.push('recordAlert');
        return Promise.resolve({ isNew: true });
      });
      notifMock.createNotification.mockImplementation(() => {
        callOrder.push('createNotification');
        return Promise.resolve({});
      });
      await service.evaluate('30A12345', ctx);
      expect(callOrder).toEqual(['recordAlert', 'createNotification']);
      const input = alertsMock.recordAlert.mock.calls[0][0];
      expect(input.alertType).toBe('vehicle_control_match');
      expect(input.zoneId).toBeNull();
      expect(input.severity).toBe('high'); // blocklist
      expect(input.payloadJson).toMatchObject({ plateNumber: '30A12345' });
    });

    it('watchlist match → severity medium', async () => {
      controlListMock.checkControlList.mockResolvedValue(watchlistMatch);
      await service.evaluate('30A12345', ctx);
      expect(alertsMock.recordAlert.mock.calls[0][0].severity).toBe('medium');
    });

    it('recordAlert lỗi → NotThrow riêng, createNotification VẪN được gọi', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      alertsMock.recordAlert.mockRejectedValue(new Error('db down'));
      await expect(service.evaluate('30A12345', ctx)).resolves.toBeUndefined();
      expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    });

    it('ruleId truyền từ findEffectiveRule khi có rule', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      alertRulesMock.findEffectiveRule.mockResolvedValue({
        rule: { id: 'rule-1' },
        suppressed: false,
      });
      await service.evaluate('30A12345', ctx);
      expect(alertsMock.recordAlert.mock.calls[0][0].ruleId).toBe('rule-1');
    });
  });

  // === UC-108: New scenarios ===

  describe('UC-108 unknown_vehicle and vehicle_unauthorized', () => {
    const noRegRows = []; // empty = no registration exists
    const pendingRows = [{ status: 'pending' }];
    const rejectedRows = [{ status: 'rejected' }];
    const activeRows = [{ status: 'active' }];

    // Reset mock to simulate no controlList match
    function resetMock() {
      controlListMock.checkControlList.mockResolvedValue(null);
      dsMock.manager.query.mockReset();
    }

    it('AC-003: unknown vehicle (no registration) -> unknown_vehicle alert', async () => {
      resetMock();
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve(noRegRows);
        return Promise.resolve(adminRows);
      });
      await service.evaluate('UNKNOWN01', ctx);
      const input = alertsMock.recordAlert.mock.calls[0]?.[0];
      expect(input.alertType).toBe('unknown_vehicle');
      expect(input.severity).toBe('medium');
    });

    it('AC-004: pending registration -> vehicle_unauthorized alert', async () => {
      resetMock();
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve(pendingRows);
        return Promise.resolve(adminRows);
      });
      await service.evaluate('PENDING01', ctx);
      const input = alertsMock.recordAlert.mock.calls[0]?.[0];
      expect(input.alertType).toBe('vehicle_unauthorized');
      expect(input.severity).toBe('low');
    });

    it('rejected registration -> vehicle_unauthorized alert', async () => {
      resetMock();
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve(rejectedRows);
        return Promise.resolve(adminRows);
      });
      await service.evaluate('REJECTED01', ctx);
      const input = alertsMock.recordAlert.mock.calls[0]?.[0];
      expect(input.alertType).toBe('vehicle_unauthorized');
      expect(input.severity).toBe('low');
    });

    it('active registration (no controlList) -> no alert', async () => {
      resetMock();
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve(activeRows);
        return Promise.resolve(adminRows);
      });
      await service.evaluate('ACTIVE01', ctx);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
      expect(notifMock.createNotification).not.toHaveBeenCalled();
    });
  });

  describe('Priority chain (B>C>A>D)', () => {
    it('blocklist + active registration -> blocklist wins', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve([{ status: 'active' }]);
        return Promise.resolve(adminRows);
      });
      await service.evaluate('PRIORITY01', ctx);
      const input = alertsMock.recordAlert.mock.calls[0]?.[0];
      expect(input).toBeDefined();
      expect(input.alertType).toBe('vehicle_control_match');
      expect(input.severity).toBe('high');
    });

    it('watchlist + pending registration -> watchlist wins', async () => {
      controlListMock.checkControlList.mockResolvedValue(watchlistMatch);
      dsMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve([{ status: 'pending' }]);
        return Promise.resolve(adminRows);
      });
      await service.evaluate('PRIORITY02', ctx);
      const input = alertsMock.recordAlert.mock.calls[0]?.[0];
      expect(input.alertType).toBe('vehicle_control_match');
      expect(input.severity).toBe('medium');
    });
  });

  describe('Zone_id resolution (F6, recon R1: qua channel_presence_zone_map, KHÔNG phải iot_devices.channel_id)', () => {
    const ZONE_UUID = '11111111-1111-1111-1111-111111111111';

    it('channel có map trong channel_presence_zone_map -> zoneId included in recordAlert', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      dsMock.manager.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM system_configs'))
          return Promise.resolve([{ config_json: { '3': ZONE_UUID } }]);
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve([]);
        return Promise.resolve(adminRows);
      });
      await service.evaluate('ZONE01', { channelId: 3, direction: 'enter' });
      const input = alertsMock.recordAlert.mock.calls[0]?.[0];
      expect(input.zoneId).toBe(ZONE_UUID);
    });

    it('channel KHÔNG map -> zoneId=null, KHÔNG chặn alert (bất biến F6)', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      dsMock.manager.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM system_configs'))
          return Promise.resolve([{ config_json: {} }]);
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve([]);
        return Promise.resolve(adminRows);
      });
      await service.evaluate('ZONE02', ctx);
      const input = alertsMock.recordAlert.mock.calls[0]?.[0];
      expect(input.zoneId).toBeNull();
      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
      expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    });

    it('đọc system_configs lỗi -> zoneId=null, KHÔNG throw, alert vẫn bắn', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      dsMock.manager.query.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM system_configs'))
          return Promise.reject(new Error('conn refused'));
        if (sql.includes('FROM vehicle_registrations'))
          return Promise.resolve([]);
        return Promise.resolve(adminRows);
      });
      await expect(service.evaluate('ZONE03', ctx)).resolves.toBeUndefined();
      const input = alertsMock.recordAlert.mock.calls[0]?.[0];
      expect(input.zoneId).toBeNull();
      expect(notifMock.createNotification).toHaveBeenCalledTimes(1);
    });
  });

  describe('eventId parameter', () => {
    it('eventId passed -> sourceEventId set in recordAlert', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      await service.evaluate('EVID01', ctx, 'evt-123');
      const input = alertsMock.recordAlert.mock.calls[0]?.[0];
      expect(input.sourceEventId).toBe('evt-123');
    });

    it('eventId undefined -> sourceEventId null', async () => {
      controlListMock.checkControlList.mockResolvedValue(blocklistMatch);
      await service.evaluate('EVID02', ctx);
      const input = alertsMock.recordAlert.mock.calls[0]?.[0];
      expect(input.sourceEventId).toBeNull();
    });
  });
});
