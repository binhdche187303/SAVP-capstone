import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RoomSearchService } from '../services/room-search.service.js';

describe('RoomSearchService - Equipment Fault Badges (ROOM-SEARCH-FAULT-BADGE-001)', () => {
  let service: RoomSearchService;
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let queryMock: jest.Mock;

  const mockRoomRowBase = {
    id: 'room-1',
    room_code: 'R101',
    room_name: 'Room 101',
    site_name: 'Site A',
    area_name: 'Area 1',
    location_description: 'Floor 1',
    capacity: 10,
    room_type: 'meeting_room',
    current_status: 'available',
    has_camera: true,
    has_microphone: true,
    has_display: true,
    allow_recording: true,
  };

  beforeEach(async () => {
    queryMock = jest.fn();
    dataSource = {
      manager: { query: queryMock } as unknown as DataSource['manager'],
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomSearchService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<RoomSearchService>(RoomSearchService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('B1: should set hasFaultyEquipment=true and faultyEquipmentCount as number when faulty_count="2"', async () => {
    queryMock
      .mockResolvedValueOnce([
        { ...mockRoomRowBase, faulty_count: '2', warning_count: '0' },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({ page: 1, limit: 50 });

    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].hasFaultyEquipment).toBe(true);
    expect(result.rooms[0].faultyEquipmentCount).toBe(2);
    expect(typeof result.rooms[0].faultyEquipmentCount).toBe('number');
    expect(result.rooms[0].hasEquipmentWarning).toBe(false);
  });

  it('B2: should set all badge fields to false/0 when no faulty or warning equipment exists', async () => {
    queryMock
      .mockResolvedValueOnce([
        { ...mockRoomRowBase, faulty_count: '0', warning_count: '0' },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({ page: 1, limit: 50 });

    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].hasFaultyEquipment).toBe(false);
    expect(result.rooms[0].faultyEquipmentCount).toBe(0);
    expect(result.rooms[0].hasEquipmentWarning).toBe(false);
  });

  it('B3: should set hasEquipmentWarning=true and hasFaultyEquipment=false when warning_count="1"', async () => {
    queryMock
      .mockResolvedValueOnce([
        { ...mockRoomRowBase, faulty_count: '0', warning_count: '1' },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({ page: 1, limit: 50 });

    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].hasEquipmentWarning).toBe(true);
    expect(result.rooms[0].hasFaultyEquipment).toBe(false);
    expect(result.rooms[0].faultyEquipmentCount).toBe(0);
  });

  it('B4: should include LEFT JOIN LATERAL and e.deleted_at IS NULL in the generated SQL query', async () => {
    queryMock
      .mockResolvedValueOnce([
        { ...mockRoomRowBase, faulty_count: '0', warning_count: '0' },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    await service.search({ page: 1, limit: 50 });

    const [sqlQuery] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(sqlQuery).toContain('LEFT JOIN LATERAL');
    expect(sqlQuery).toContain('e.deleted_at IS NULL');
    expect(sqlQuery).toContain("health_status IN ('faulty','offline')");
    expect(sqlQuery).toContain("health_status = 'warning'");
  });

  it('B5: should maintain existing filters and pass correct whereParams to query', async () => {
    queryMock
      .mockResolvedValueOnce([
        { ...mockRoomRowBase, faulty_count: '0', warning_count: '0' },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    await service.search({
      capacityMin: 10,
      capacityMax: 20,
      areaName: 'Area 1',
      onlyAvailable: true,
      page: 1,
      limit: 10,
    });

    const [sqlQuery, params] = queryMock.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([10, 20, 'Area 1', true, null, null, null, null, 10, 0]);
    expect(sqlQuery).toContain('r.capacity >= $1');
    expect(sqlQuery).toContain('r.capacity <= $2');
    expect(sqlQuery).toContain('r.area_name = $3');
    // [FIX 2026-08-19] onlyAvailable nay tinh theo trang thai real-time
    // (CASE administrative_status/occupancy/booking), khong con doc thang
    // r.current_status. Xem room-search.service.ts (COMPUTED_STATUS_SQL).
    expect(sqlQuery).toContain(
      "WHEN r.administrative_status IN ('maintenance', 'inactive')",
    );
    expect(sqlQuery).toContain("= 'available'");
  });
});
