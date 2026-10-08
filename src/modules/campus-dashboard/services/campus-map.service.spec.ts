/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { CampusMapService } from './campus-map.service.js';
import {
  IoTDeviceType,
  IoTDeviceStatus,
} from '../../iot/entities/iot-device.entity.js';

describe('CampusMapService (Bản đồ GIS camera + sự kiện)', () => {
  let service: CampusMapService;
  let repoMock: any;
  let dataSourceMock: any;

  const zone = (over: any = {}): any => ({
    id: 'z1',
    zoneCode: 'Z1',
    zoneName: 'Sảnh A',
    zoneType: 'lobby',
    building: 'Tòa A',
    floor: '1',
    status: 'active',
    latitude: 21.0285,
    longitude: 105.8542,
    ...over,
  });

  const device = (over: any = {}): any => ({
    id: 'd1',
    deviceCode: 'CAM_1',
    deviceName: 'Cam 1',
    deviceType: IoTDeviceType.IP_CAMERA,
    status: IoTDeviceStatus.ONLINE,
    zoneId: 'z1',
    lastSeenAt: null,
    ...over,
  });

  beforeEach(async () => {
    repoMock = {
      loadZoneHierarchy: jest.fn().mockResolvedValue([]),
      loadStalenessMinutes: jest.fn().mockResolvedValue(15),
      loadDevicesByZone: jest.fn().mockResolvedValue([]),
      loadLatestCountEvent: jest.fn().mockResolvedValue(null),
    };
    dataSourceMock = { query: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampusMapService,
        { provide: CampusDashboardRepository, useValue: repoMock },
        { provide: DataSource, useValue: dataSourceMock },
      ],
    }).compile();
    service = module.get(CampusMapService);
  });

  it('không có zone → zones rỗng, mặc định cửa sổ 24 giờ, KHÔNG query danh sách alert theo zone', async () => {
    const result = await service.getMap({});

    expect(result.zones).toEqual([]);
    expect(result.hours).toBe(24);
    expect(
      new Date(result.generatedAt).getTime() - new Date(result.since).getTime(),
    ).toBe(24 * 3600 * 1000);
    // Chỉ query aggregate (để đếm cảnh báo không định vị), không query latest.
    expect(dataSourceMock.query).toHaveBeenCalledTimes(1);
  });

  it('ghép camera + toạ độ + cảnh báo theo zone, zone chưa đặt toạ độ → coordinates null', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([
      zone(),
      zone({ id: 'z2', zoneCode: 'Z2', latitude: null, longitude: null }),
    ]);
    repoMock.loadDevicesByZone.mockResolvedValue([
      device({
        id: 'd2',
        deviceCode: 'CAM_2',
        status: IoTDeviceStatus.OFFLINE,
      }),
      device({ lastSeenAt: new Date('2026-10-06T01:00:00Z') }),
      device({ id: 'd3', deviceCode: 'CAM_3', zoneId: 'z2' }),
    ]);
    dataSourceMock.query
      .mockResolvedValueOnce([
        { zone_id: 'z1', total: 3, open: 2, top_open_rank: 4 },
        { zone_id: null, total: 1, open: 1, top_open_rank: 2 },
      ])
      .mockResolvedValueOnce([
        {
          id: 'a1',
          zone_id: 'z1',
          alert_type: 'intrusion',
          severity: 'critical',
          status: 'new',
          triggered_at: '2026-10-06T02:00:00Z',
          last_seen_at: null,
          occurrence_count: 1,
        },
      ]);

    const result = await service.getMap({ hours: 6 });

    expect(result.hours).toBe(6);
    const [z1, z2] = result.zones;
    expect(z1.coordinates).toEqual({ lat: 21.0285, lng: 105.8542 });
    expect(z2.coordinates).toBeNull();

    // Camera sort theo mã, trạng thái tổng hợp: có ít nhất 1 online → 'online'.
    expect(z1.cameras.map((c) => c.deviceCode)).toEqual(['CAM_1', 'CAM_2']);
    expect(z1.cameras[0].lastSeenAt).toBe('2026-10-06T01:00:00.000Z');
    expect(z1.cameraStatus).toMatchObject({ online: 1, offline: 1 });

    expect(z1.alerts).toEqual({
      total: 3,
      open: 2,
      topOpenSeverity: 'critical',
      latest: [
        {
          alertId: 'a1',
          alertType: 'intrusion',
          severity: 'critical',
          status: 'new',
          triggeredAt: '2026-10-06T02:00:00.000Z',
          lastSeenAt: null,
          occurrenceCount: 1,
        },
      ],
    });
    expect(z2.alerts).toEqual({
      total: 0,
      open: 0,
      topOpenSeverity: null,
      latest: [],
    });

    expect(result.summary).toEqual({
      totalZones: 2,
      zonesWithCoordinates: 1,
      totalCameras: 3,
      camerasOnline: 2,
      alertsInWindow: 3,
      openAlertsInWindow: 2,
      unlocatedAlertsInWindow: 1,
    });
  });

  it('truyền building xuống repository và zoneIds + since xuống query latest', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone()]);

    await service.getMap({ building: 'Tòa A', hours: 1 });

    expect(repoMock.loadZoneHierarchy).toHaveBeenCalledWith({
      building: 'Tòa A',
    });
    const [, params] = dataSourceMock.query.mock.calls[1];
    expect(params[0]).toEqual(['z1']);
    expect(params[1]).toBeInstanceOf(Date);
  });
});
