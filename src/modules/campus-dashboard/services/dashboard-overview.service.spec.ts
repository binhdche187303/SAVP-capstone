/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { DashboardOverviewService } from './dashboard-overview.service.js';
import {
  IoTDeviceType,
  IoTDeviceStatus,
} from '../../iot/entities/iot-device.entity.js';

describe('DashboardOverviewService (CDB-001 / UC-126)', () => {
  let service: DashboardOverviewService;
  let repoMock: any;

  const zone = (over: any = {}): any => ({
    id: 'zone-1',
    zoneCode: 'Z1',
    zoneName: 'Sảnh A',
    zoneType: 'lobby',
    building: 'Tòa A',
    floor: '1',
    ...over,
  });

  const build = () => {
    repoMock = {
      loadZoneHierarchy: jest.fn().mockResolvedValue([]),
      loadStalenessMinutes: jest.fn().mockResolvedValue(15),
      loadDevicesByZone: jest.fn().mockResolvedValue([]),
      loadLatestCountEvent: jest.fn().mockResolvedValue(null),
      countGateLogsToday: jest.fn().mockResolvedValue(0),
    };
  };

  const compile = async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DashboardOverviewService,
        { provide: CampusDashboardRepository, useValue: repoMock },
      ],
    }).compile();
    service = module.get(DashboardOverviewService);
  };

  beforeEach(async () => {
    build();
    await compile();
  });

  it('không có zone nào → trả buildings rỗng', async () => {
    const result = await service.getOverview({});
    expect(result.buildings).toEqual([]);
  });

  it('group đúng Building→Floor→Zone, zone chưa đặt toạ độ → coordinates null', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone()]);
    repoMock.loadDevicesByZone.mockResolvedValue([
      {
        id: 'd1',
        zoneId: 'zone-1',
        deviceType: IoTDeviceType.FACE_SERVER,
        status: IoTDeviceStatus.ONLINE,
      },
    ]);
    repoMock.countGateLogsToday
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(2);

    const result = await service.getOverview({});

    expect(result.buildings).toHaveLength(1);
    expect(result.buildings[0].building).toBe('Tòa A');
    expect(result.buildings[0].floors).toHaveLength(1);
    expect(result.buildings[0].floors[0].floor).toBe('1');
    const zoneOverview = result.buildings[0].floors[0].zones[0];
    expect(zoneOverview.zoneId).toBe('zone-1');
    expect(zoneOverview.coordinates).toBeNull();
    expect(zoneOverview.occupancy.status).toBe('ok');
    expect(zoneOverview.gateTraffic).toEqual({
      entriesToday: 3,
      exitsToday: 2,
    });
    expect(zoneOverview.cameraStatus.overall).toBe('online');
  });

  it('zone có latitude/longitude → coordinates {lat, lng} (kể cả khi driver trả chuỗi)', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([
      zone({ latitude: '21.028500', longitude: '105.854200' }),
    ]);

    const result = await service.getOverview({});

    expect(result.buildings[0].floors[0].zones[0].coordinates).toEqual({
      lat: 21.0285,
      lng: 105.8542,
    });
  });

  it('filter building/floor được truyền đúng xuống repository', async () => {
    await service.getOverview({ building: 'Tòa A', floor: '2' });
    expect(repoMock.loadZoneHierarchy).toHaveBeenCalledWith({
      building: 'Tòa A',
      floor: '2',
    });
  });

  it('2 zone khác building → nhóm thành 2 building riêng', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([
      zone({ id: 'z1', building: 'Tòa A' }),
      zone({ id: 'z2', building: 'Tòa B' }),
    ]);

    const result = await service.getOverview({});
    expect(result.buildings).toHaveLength(2);
  });
});
