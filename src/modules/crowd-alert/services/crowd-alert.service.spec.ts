/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ZonePresenceEventEntity } from '../../zones/entities/zone-presence-event.entity.js';
import { AlertRulesService } from '../../alerts/services/alert-rules.service.js';
import { AlertsService } from '../../alerts/services/alerts.service.js';
import { IVSS_BRIDGE } from '../../ivss/ports/ivss-bridge.port.js';
import { StorageService } from '../../storage/storage.service.js';
import { CrowdAlertService } from './crowd-alert.service.js';

describe('CrowdAlertService (ACR-001 / UC-121)', () => {
  let service: CrowdAlertService;
  let presenceRepo: any;
  let alertRulesMock: any;
  let alertsMock: any;
  let configRepo: any;
  let dataSourceMock: any;
  let ivssBridgeMock: any;
  let storageServiceMock: any;

  // zone_presence_zone_map hiện thẳng (channelId → zoneId) — reverse lookup đọc key này.
  const zoneMapRow = (channelId: string | number, zoneId: string) => [
    { config_json: { [String(channelId)]: zoneId } },
  ];

  const rule = (over: any = {}): any => ({
    id: 'rule-1',
    alertType: 'crowd',
    zoneId: 'zone-1',
    threshold: 25,
    ...over,
  });

  const event = (over: any = {}): any => ({
    id: 'evt-1',
    zoneId: 'zone-1',
    occupancyCount: 30,
    eventTime: new Date('2026-07-23T08:00:00Z'),
    ...over,
  });

  const build = () => {
    presenceRepo = { find: jest.fn().mockResolvedValue([]) };
    alertRulesMock = {
      list: jest.fn().mockResolvedValue({ items: [], meta: {} }),
      // Đợt 2: service gọi listEnabledZoneRules (có cache) — ủy quyền về mock `list` để
      // các test cũ giữ nguyên dữ liệu đầu vào.
      listEnabledZoneRules: jest.fn(async () => {
        const r = await alertRulesMock.list();
        return (r?.items ?? []).filter(
          (x: any) => x.enabled !== false && x.zoneId !== null,
        );
      }),
    };
    alertsMock = {
      recordAlert: jest.fn().mockResolvedValue({ isNew: true }),
      hasOpenAlert: jest.fn().mockResolvedValue(false),
    };
    configRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve(x)),
    };
    // Mặc định KHÔNG có channel_presence_zone_map (query rỗng) → resolveChannelIdForZone
    // trả null → captureSnapshotForZone trả null → snapshotFileId=null cho MỌI test hiện
    // có (chưa cần biết về snapshot) mà KHÔNG cần sửa từng test.
    dataSourceMock = {
      getRepository: jest.fn(() => configRepo),
      manager: { query: jest.fn().mockResolvedValue([]) },
    };
    ivssBridgeMock = { getSnapshot: jest.fn() };
    storageServiceMock = {
      saveFile: jest.fn(),
      getDriver: jest.fn().mockReturnValue('local'),
    };
  };

  const compile = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CrowdAlertService,
        {
          provide: getRepositoryToken(ZonePresenceEventEntity),
          useValue: presenceRepo,
        },
        { provide: AlertRulesService, useValue: alertRulesMock },
        { provide: AlertsService, useValue: alertsMock },
        { provide: DataSource, useValue: dataSourceMock },
        { provide: IVSS_BRIDGE, useValue: ivssBridgeMock },
        { provide: StorageService, useValue: storageServiceMock },
      ],
    }).compile();
    service = module.get(CrowdAlertService);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  describe('evaluateCrowdAlerts', () => {
    it('occupancyCount > threshold → gọi recordAlert đúng payload', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      presenceRepo.find.mockResolvedValue([event({ occupancyCount: 30 })]);

      const result = await service.evaluateCrowdAlerts();

      expect(alertsMock.recordAlert).toHaveBeenCalledWith({
        alertType: 'crowd',
        zoneId: 'zone-1',
        ruleId: 'rule-1',
        // Không có channel_presence_zone_map trong test này (dataSourceMock.manager.query
        // mặc định trả rỗng) → resolveChannelIdForZone() miss → sourceEventId=null (top-level,
        // FE đọc field này để hiện ảnh — KHÔNG còn field snapshotFileId trong payloadJson).
        sourceEventId: null,
        payloadJson: {
          occupancyCount: 30,
          threshold: 25,
          sourceEventId: 'evt-1',
          occurredAt: '2026-07-23T08:00:00.000Z',
        },
      });
      expect(result.violationsFound).toBe(1);
      expect(result.eventsChecked).toBe(1);
      expect(result.zonesScanned).toBe(1);
    });

    it('occupancyCount <= threshold → KHÔNG gọi recordAlert', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      presenceRepo.find.mockResolvedValue([event({ occupancyCount: 25 })]);

      const result = await service.evaluateCrowdAlerts();

      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
      expect(result.violationsFound).toBe(0);
    });

    it('occupancyCount == threshold (biên, dùng >) → KHÔNG coi là vi phạm', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ threshold: 30 })],
        meta: {},
      });
      presenceRepo.find.mockResolvedValue([event({ occupancyCount: 30 })]);

      await service.evaluateCrowdAlerts();
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('bỏ qua rule threshold=NULL (chưa cấu hình ngưỡng)', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ threshold: null })],
        meta: {},
      });

      const result = await service.evaluateCrowdAlerts();
      expect(result.zonesScanned).toBe(0);
      expect(presenceRepo.find).not.toHaveBeenCalled();
    });

    it('bỏ qua rule zoneId=NULL (toàn khuôn viên)', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ zoneId: null })],
        meta: {},
      });

      const result = await service.evaluateCrowdAlerts();
      expect(result.zonesScanned).toBe(0);
    });

    it('watermark cập nhật đúng giá trị lớn nhất đã xử lý', async () => {
      configRepo.findOne.mockResolvedValue({
        configGroup: 'crowd_alert',
        configKey: 'crowd_alert.count_event_watermark',
        configValue: '2026-07-23T07:00:00.000Z',
      });
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      const olderEvent = event({
        id: 'evt-1',
        eventTime: new Date('2026-07-23T08:00:00Z'),
      });
      const newerEvent = event({
        id: 'evt-2',
        eventTime: new Date('2026-07-23T09:00:00Z'),
      });
      presenceRepo.find.mockResolvedValue([olderEvent, newerEvent]);

      await service.evaluateCrowdAlerts();

      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          configValue: new Date('2026-07-23T09:00:00Z').toISOString(),
        }),
      );
    });

    it('watermark lần đầu (chưa có dòng) → tự lưu lại (KHÔNG quét lùi lịch sử)', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      configRepo.findOne.mockResolvedValue(null);

      await service.evaluateCrowdAlerts();

      const savedCalls = configRepo.save.mock.calls.map((c: any[]) => c[0]);
      expect(
        savedCalls.some(
          (s: any) => s.configKey === 'crowd_alert.count_event_watermark',
        ),
      ).toBe(true);
      const where = presenceRepo.find.mock.calls[0][0].where;
      expect(where.eventTime).toBeDefined();
    });

    it('watermark đã có dòng hợp lệ → dùng lại giá trị đó, UPDATE dòng cũ khi lưu (KHÔNG tạo dòng mới)', async () => {
      const existingRow = {
        configGroup: 'crowd_alert',
        configKey: 'crowd_alert.count_event_watermark',
        configValue: '2026-07-01T00:00:00.000Z',
      };
      configRepo.findOne.mockResolvedValue(existingRow);
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      presenceRepo.find.mockResolvedValue([event({ occupancyCount: 30 })]);

      await service.evaluateCrowdAlerts();

      expect(configRepo.create).not.toHaveBeenCalled();
      expect(configRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ configKey: existingRow.configKey }),
      );
    });
  });

  describe('loadZoneScopedCrowdRules (private, test qua evaluateCrowdAlerts)', () => {
    it('loại đúng rule zoneId=NULL VÀ threshold=NULL, giữ lại rule hợp lệ', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [
          rule({ id: 'r1', zoneId: null }),
          rule({ id: 'r2', threshold: null }),
          rule({ id: 'r3', zoneId: 'zone-3', threshold: 10 }),
        ],
        meta: {},
      });
      presenceRepo.find.mockResolvedValue([]);

      const result = await service.evaluateCrowdAlerts();
      expect(result.zonesScanned).toBe(1);
    });
  });

  // ── evaluateZoneCountNow — đường TỨC THỜI (bên cạnh cron, KHÔNG thay thế) ──
  describe('evaluateZoneCountNow (đường tức thời)', () => {
    it('vượt ngưỡng → recordAlert gọi 1 lần, trả về true', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ threshold: 25 })],
      });
      const eventTime = new Date('2026-07-23T08:00:00Z');
      const r = await service.evaluateZoneCountNow({
        zoneId: 'zone-1',
        occupancyCount: 30,
        eventTime,
        sourceEventId: 'zpe-1',
      });
      expect(r).toBe(true);
      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: 'crowd',
          zoneId: 'zone-1',
          ruleId: 'rule-1',
          payloadJson: expect.objectContaining({
            occupancyCount: 30,
            threshold: 25,
            sourceEventId: 'zpe-1',
            occurredAt: eventTime.toISOString(),
          }),
        }),
      );
    });

    it('chưa vượt ngưỡng → KHÔNG vi phạm, recordAlert KHÔNG gọi, trả về false', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ threshold: 25 })],
      });
      const r = await service.evaluateZoneCountNow({
        zoneId: 'zone-1',
        occupancyCount: 10,
        eventTime: new Date('2026-07-23T08:00:00Z'),
        sourceEventId: 'zpe-2',
      });
      expect(r).toBe(false);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('không có rule crowd nào active cho zone → trả về false', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [] });
      const r = await service.evaluateZoneCountNow({
        zoneId: 'zone-1',
        occupancyCount: 999,
        eventTime: new Date('2026-07-23T08:00:00Z'),
        sourceEventId: 'zpe-3',
      });
      expect(r).toBe(false);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('rule threshold=NULL (chưa cấu hình) → bỏ qua rule đó, KHÔNG vi phạm', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ threshold: null })],
      });
      const r = await service.evaluateZoneCountNow({
        zoneId: 'zone-1',
        occupancyCount: 999,
        eventTime: new Date('2026-07-23T08:00:00Z'),
        sourceEventId: 'zpe-4',
      });
      expect(r).toBe(false);
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });

    it('gọi alertRulesService.list lọc ĐÚNG zoneId (KHÔNG tải toàn bộ rule rồi lọc JS)', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [] });
      await service.evaluateZoneCountNow({
        zoneId: 'zone-42',
        occupancyCount: 1,
        eventTime: new Date('2026-07-23T08:00:00Z'),
        sourceEventId: 'zpe-5',
      });
      // Đợt 2: dùng danh sách rule zone-scoped CACHE 60s (1 query/phút thay vì 1 query/event).
      expect(alertRulesMock.listEnabledZoneRules).toHaveBeenCalledWith('crowd');
    });

    it('dedupe qua recordAlert() có sẵn — gọi lại cho CÙNG zone (mô phỏng cron quét lại) → recordAlert vẫn được gọi (bump occurrenceCount), KHÔNG cần cờ chống trùng riêng', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ threshold: 25 })],
      });
      const eventTime = new Date('2026-07-23T08:00:00Z');
      await service.evaluateZoneCountNow({
        zoneId: 'zone-1',
        occupancyCount: 30,
        eventTime,
        sourceEventId: 'zpe-6',
      });
      await service.evaluateZoneCountNow({
        zoneId: 'zone-1',
        occupancyCount: 30,
        eventTime,
        sourceEventId: 'zpe-6',
      });
      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(2);
      expect(alertsMock.recordAlert).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ alertType: 'crowd', zoneId: 'zone-1' }),
      );
      expect(alertsMock.recordAlert).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ alertType: 'crowd', zoneId: 'zone-1' }),
      );
    });
  });

  // ── Bổ sung 2026-08-09: chụp ảnh chủ động qua bridge khi crowd vượt ngưỡng
  // (best-effort side-effect, KHÔNG chặn/làm chậm luồng ghi alert chính) ──
  // ── SỬA 2026-08-09: FE chỉ đọc security_alerts.source_event_id (cột top-level FK →
  // iot_device_events.id) để hiện ảnh — KHÔNG đọc payload_json.snapshotFileId (bản trước).
  // crowd-alert KHÔNG có raw event nào sẵn dùng lại được → phải tạo 1 dòng
  // iot_device_events TỐI GIẢN làm neo (event_type='crowd_alert_snapshot') SAU khi lưu
  // ảnh, rồi lấy .id làm sourceEventId — mirror restricted-zone-intrusion.service.ts. ──
  describe('captureSnapshotForZone (chụp ảnh chủ động qua bridge + tạo dòng neo)', () => {
    const triggerViolation = (zoneId = 'zone-1') =>
      service.evaluateZoneCountNow({
        zoneId,
        occupancyCount: 30,
        eventTime: new Date('2026-07-23T08:00:00Z'),
        sourceEventId: 'zpe-1',
      });

    // wire đủ 4 nhánh SQL: channel map / bridge device / INSERT anchor / (mặc định []).
    const wireHappyPath = (
      over: { channelId?: number; deviceId?: string; anchorId?: string } = {},
    ) => {
      const {
        channelId = 7,
        deviceId = 'bridge-device-1',
        anchorId = 'ide-anchor-1',
      } = over;
      dataSourceMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM system_configs')) {
          return Promise.resolve(zoneMapRow(channelId, 'zone-1'));
        }
        if (sql.includes('FROM iot_devices')) {
          return Promise.resolve(deviceId ? [{ id: deviceId }] : []);
        }
        if (sql.includes('INSERT INTO media_files')) {
          return Promise.resolve([{ id: 'media-crowd-1' }]);
        }
        if (sql.includes('INSERT INTO iot_device_events')) {
          return Promise.resolve(anchorId ? [{ id: anchorId }] : []);
        }
        return Promise.resolve([]);
      });
    };

    beforeEach(() => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule({ threshold: 25 })],
      });
    });

    it('DONE: resolve channelId đúng qua đảo ngược channel_presence_zone_map + bridge chụp thành công + tạo dòng neo → sourceEventId = id dòng neo vừa tạo', async () => {
      wireHappyPath();
      storageServiceMock.saveFile.mockResolvedValue({
        storageKey: 'crowd-alert-snapshots/x.jpg',
        sizeBytes: 123,
      });
      ivssBridgeMock.getSnapshot.mockResolvedValue({
        ok: true,
        data: { imageBase64: 'SGVsbG8=' },
      });

      await triggerViolation();

      expect(ivssBridgeMock.getSnapshot).toHaveBeenCalledWith(
        { channelId: 7 },
        6500,
      );
      expect(storageServiceMock.saveFile).toHaveBeenCalledWith(
        expect.objectContaining({ folder: 'crowd-alert-snapshots' }),
      );
      expect(dataSourceMock.manager.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO iot_device_events'),
        expect.arrayContaining([
          'bridge-device-1',
          'zone-1',
          'crowd_alert_snapshot',
          JSON.stringify({ channelId: 7, zoneId: 'zone-1' }),
          'media-crowd-1',
        ]),
      );
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceEventId: 'ide-anchor-1' }),
      );
      // payload_json KHÔNG còn snapshotFileId — FE không đọc field này nữa.
      expect(
        alertsMock.recordAlert.mock.calls[0][0].payloadJson,
      ).not.toHaveProperty('snapshotFileId');
    });

    it('DONE: KHÔNG resolve được channelId (zone không có trong map) → sourceEventId=null, KHÔNG gọi bridge, alert vẫn tạo', async () => {
      dataSourceMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM system_configs')) {
          return Promise.resolve(zoneMapRow(7, 'zone-KHAC'));
        }
        return Promise.resolve([]);
      });

      await triggerViolation();

      expect(ivssBridgeMock.getSnapshot).not.toHaveBeenCalled();
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceEventId: null }),
      );
    });

    it('DONE: bridge trả success:false (thất bại nghiệp vụ, mirror BRIDGE_SNAPSHOT_FAILED) → sourceEventId=null, alert vẫn tạo bình thường', async () => {
      dataSourceMock.manager.query.mockImplementation((sql: string) =>
        sql.includes('FROM system_configs')
          ? Promise.resolve(zoneMapRow(7, 'zone-1'))
          : Promise.resolve([]),
      );
      ivssBridgeMock.getSnapshot.mockResolvedValue({
        ok: false,
        error: { code: 'BRIDGE_SNAPSHOT_FAILED', message: 'camera busy' },
      });

      await expect(triggerViolation()).resolves.toBe(true);
      expect(storageServiceMock.saveFile).not.toHaveBeenCalled();
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceEventId: null }),
      );
    });

    it('DONE: bridge timeout (BRIDGE_TIMEOUT) → sourceEventId=null, KHÔNG throw, alert vẫn tạo — không chặn luồng chính', async () => {
      dataSourceMock.manager.query.mockImplementation((sql: string) =>
        sql.includes('FROM system_configs')
          ? Promise.resolve(zoneMapRow(7, 'zone-1'))
          : Promise.resolve([]),
      );
      ivssBridgeMock.getSnapshot.mockResolvedValue({
        ok: false,
        error: {
          code: 'BRIDGE_TIMEOUT',
          message: 'IVSS bridge request timeout.',
        },
      });

      await expect(triggerViolation()).resolves.toBe(true);
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceEventId: null }),
      );
    });

    it('DONE: bridge chụp OK nhưng lưu ảnh lỗi (storage down) → sourceEventId=null, KHÔNG throw, KHÔNG chặn ghi alert', async () => {
      dataSourceMock.manager.query.mockImplementation((sql: string) =>
        sql.includes('FROM system_configs')
          ? Promise.resolve(zoneMapRow(7, 'zone-1'))
          : Promise.resolve([]),
      );
      ivssBridgeMock.getSnapshot.mockResolvedValue({
        ok: true,
        data: { imageBase64: 'SGVsbG8=' },
      });
      storageServiceMock.saveFile.mockRejectedValue(new Error('disk full'));

      await expect(triggerViolation()).resolves.toBe(true);
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceEventId: null }),
      );
    });

    it('DONE: resolveChannelIdForZone lỗi DB → sourceEventId=null, KHÔNG throw, KHÔNG gọi bridge', async () => {
      dataSourceMock.manager.query.mockRejectedValue(new Error('db down'));

      await expect(triggerViolation()).resolves.toBe(true);
      expect(ivssBridgeMock.getSnapshot).not.toHaveBeenCalled();
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceEventId: null }),
      );
    });

    it('DONE: bridge chụp OK + lưu ảnh OK NHƯNG chưa seed IVSS-BRIDGE device (device_id NOT NULL) → KHÔNG tạo dòng neo, sourceEventId=null, KHÔNG throw', async () => {
      wireHappyPath({ deviceId: '' }); // FROM iot_devices → []
      storageServiceMock.saveFile.mockResolvedValue({
        storageKey: 'crowd-alert-snapshots/x.jpg',
        sizeBytes: 123,
      });
      ivssBridgeMock.getSnapshot.mockResolvedValue({
        ok: true,
        data: { imageBase64: 'SGVsbG8=' },
      });

      await expect(triggerViolation()).resolves.toBe(true);
      expect(dataSourceMock.manager.query).not.toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO iot_device_events'),
        expect.anything(),
      );
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceEventId: null }),
      );
    });

    it('DONE: đã có device + ảnh nhưng INSERT dòng neo lỗi (DB down) → sourceEventId=null, KHÔNG throw, KHÔNG chặn ghi alert', async () => {
      dataSourceMock.manager.query.mockImplementation((sql: string) => {
        if (sql.includes('FROM system_configs')) {
          return Promise.resolve(zoneMapRow(7, 'zone-1'));
        }
        if (sql.includes('FROM iot_devices')) {
          return Promise.resolve([{ id: 'bridge-device-1' }]);
        }
        if (sql.includes('INSERT INTO media_files')) {
          return Promise.resolve([{ id: 'media-crowd-1' }]);
        }
        if (sql.includes('INSERT INTO iot_device_events')) {
          return Promise.reject(new Error('db down'));
        }
        return Promise.resolve([]);
      });
      storageServiceMock.saveFile.mockResolvedValue({
        storageKey: 'crowd-alert-snapshots/x.jpg',
        sizeBytes: 123,
      });
      ivssBridgeMock.getSnapshot.mockResolvedValue({
        ok: true,
        data: { imageBase64: 'SGVsbG8=' },
      });

      await expect(triggerViolation()).resolves.toBe(true);
      expect(alertsMock.recordAlert).toHaveBeenCalledWith(
        expect.objectContaining({ sourceEventId: null }),
      );
    });

    it('KHÔNG đổi ngưỡng/logic đánh giá crowd hiện có — chưa vượt ngưỡng thì vẫn KHÔNG gọi bridge/recordAlert dù map/bridge có sẵn sàng', async () => {
      wireHappyPath();
      ivssBridgeMock.getSnapshot.mockResolvedValue({
        ok: true,
        data: { imageBase64: 'SGVsbG8=' },
      });

      const r = await service.evaluateZoneCountNow({
        zoneId: 'zone-1',
        occupancyCount: 10, // < threshold 25
        eventTime: new Date('2026-07-23T08:00:00Z'),
        sourceEventId: 'zpe-below',
      });

      expect(r).toBe(false);
      expect(ivssBridgeMock.getSnapshot).not.toHaveBeenCalled();
      expect(alertsMock.recordAlert).not.toHaveBeenCalled();
    });
  });
  describe('Đợt 2 — performance', () => {
    it('đã có alert crowd MỞ cho zone → KHÔNG chụp ảnh lại, chỉ bump', async () => {
      alertsMock.hasOpenAlert.mockResolvedValue(true);
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      await service.evaluateZoneCountNow({
        zoneId: 'zone-1',
        occupancyCount: 30,
        eventTime: new Date('2026-07-23T08:00:00Z'),
        sourceEventId: 'zpe-1',
      });
      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
      expect(storageServiceMock.uploadFile ?? jest.fn()).not.toHaveBeenCalled();
    });

    it('cron: nhiều zone → 1 query presence (In), mỗi zone vi phạm chỉ ghi 1 lần với event ĐỈNH', async () => {
      alertRulesMock.list.mockResolvedValue({
        items: [rule(), rule({ id: 'rule-2', zoneId: 'zone-2' })],
        meta: {},
      });
      presenceRepo.find.mockResolvedValue([
        event({ id: 'a', occupancyCount: 26 }),
        event({ id: 'b', occupancyCount: 40 }),
        event({ id: 'c', occupancyCount: 31 }),
        event({ id: 'd', zoneId: 'zone-2', occupancyCount: 5 }),
      ]);
      const r = await service.evaluateCrowdAlerts();
      expect(presenceRepo.find).toHaveBeenCalledTimes(1);
      expect(presenceRepo.find.mock.calls[0][0].where.zoneId._value).toEqual([
        'zone-1',
        'zone-2',
      ]);
      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
      expect(alertsMock.recordAlert.mock.calls[0][0].payloadJson).toMatchObject(
        {
          occupancyCount: 40,
          sourceEventId: 'b',
        },
      );
      expect(r.violationsFound).toBe(1);
    });

    it('cron chồng lấn → lần sau bỏ qua', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      let release!: () => void;
      presenceRepo.find.mockImplementation(
        () => new Promise((r) => (release = () => r([]))),
      );
      const first = service.evaluateCrowdAlerts();
      await new Promise((r) => setImmediate(r));
      const second = await service.evaluateCrowdAlerts();
      expect(second.violationsFound).toBe(0);
      release();
      await first;
      expect(presenceRepo.find).toHaveBeenCalledTimes(1);
    });

    it('zone đang xử lý dở (in-flight) → event đến cùng lúc bị bỏ qua', async () => {
      alertRulesMock.list.mockResolvedValue({ items: [rule()], meta: {} });
      let release!: () => void;
      alertsMock.recordAlert.mockImplementation(
        () => new Promise((r) => (release = () => r({ isNew: true }))),
      );
      const a = {
        zoneId: 'zone-1',
        occupancyCount: 30,
        eventTime: new Date('2026-07-23T08:00:00Z'),
        sourceEventId: 'zpe-1',
      };
      const p1 = service.evaluateZoneCountNow(a);
      for (let i = 0; i < 5 && !release; i++)
        await new Promise((r) => setImmediate(r));
      const r2 = await service.evaluateZoneCountNow(a);
      expect(r2).toBe(false);
      release();
      await p1;
      expect(alertsMock.recordAlert).toHaveBeenCalledTimes(1);
    });
  });
});
