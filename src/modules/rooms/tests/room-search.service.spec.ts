import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { BadRequestException } from '@nestjs/common';
import { RoomSearchService } from '../services/room-search.service.js';

describe('RoomSearchService', () => {
  let service: RoomSearchService;
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let queryMock: jest.Mock;
  let findOneMock: jest.Mock;

  const mockRoomRow = {
    id: 'r1',
    room_code: 'R301',
    room_name: 'Phong hop 301',
    site_name: 'Toa A',
    area_name: 'Tang 3',
    location_description: null,
    capacity: 12,
    room_type: 'meeting_room',
    current_status: 'available',
    has_camera: true,
    has_microphone: false,
    has_display: false,
    allow_recording: false,
    faulty_count: '0',
    warning_count: '0',
  };

  beforeEach(async () => {
    queryMock = jest.fn();
    findOneMock = jest.fn().mockResolvedValue(null);
    dataSource = {
      manager: { query: queryMock } as any,
      getRepository: jest.fn().mockReturnValue({ findOne: findOneMock }) as any,
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

  it('should return all active rooms when no filter is provided (AF-1)', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow]) // SELECT
      .mockResolvedValueOnce([{ count: '1' }]); // COUNT

    const result = await service.search({ page: 1, limit: 50 });

    expect(result.rooms).toHaveLength(1);
    expect(result.rooms[0].roomId).toBe('r1');
    expect(result.rooms[0].roomCode).toBe('R301');
    expect(result.meta.total).toBe(1);
    expect(result.meta.appliedFilters).toEqual({});

    // Verify WHERE clause always excludes inactive/soft-deleted rooms
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('r.is_active = true');
    expect(sql).toContain('r.deleted_at IS NULL');
    expect(params).toEqual([null, null, null, null, null, null, null, 50, 0]);
  });

  it('combines exact building/area and capacity filters before counting and paging', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow])
      .mockResolvedValueOnce([{ count: '1' }]);
    await service.search({
      siteName: 'Tòa nhà A',
      areaName: 'Tầng 1',
      capacityMin: 1,
      capacityMax: 10,
      page: 2,
      limit: 10,
    });
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('r.site_name = $7');
    expect(sql).toContain('LIMIT $8 OFFSET $9');
    expect(params).toEqual([
      1,
      10,
      'Tầng 1',
      null,
      null,
      null,
      'Tòa nhà A',
      10,
      10,
    ]);
    expect(queryMock.mock.calls[1][1]).toEqual(params.slice(0, 7));
  });

  // ─── [FIX 2026-08-19] computeStatus: real-time thay vi doc thang r.current_status ───
  it('administrative_status=maintenance thang occupancy → currentStatus=maintenance', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          ...mockRoomRow,
          administrative_status: 'maintenance',
          latest_occupancy_count: 5,
        },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({ page: 1, limit: 50 });
    expect(result.rooms[0].currentStatus).toBe('maintenance');
  });

  it('occupancy > 0 (khong maintenance/inactive) → currentStatus=occupied', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          ...mockRoomRow,
          administrative_status: 'available',
          latest_occupancy_count: 3,
        },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({ page: 1, limit: 50 });
    expect(result.rooms[0].currentStatus).toBe('occupied');
  });

  it('co booking hien tai, occupancy=0 → currentStatus=reserved', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          ...mockRoomRow,
          administrative_status: 'available',
          latest_occupancy_count: 0,
          has_current_booking: true,
          has_live_meeting: false,
        },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({ page: 1, limit: 50 });
    expect(result.rooms[0].currentStatus).toBe('reserved');
  });

  // [FIX 2026-08-22] Cuoc hop da bat dau nhung phong khong co tin hieu camera —
  // truoc day bi hien 'reserved' (= "Duoc dat truoc") du dang hop.
  it('cuoc hop dang dien ra, occupancy=0 → currentStatus=occupied', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          ...mockRoomRow,
          administrative_status: 'available',
          latest_occupancy_count: 0,
          has_current_booking: true,
          has_live_meeting: true,
        },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({ page: 1, limit: 50 });
    expect(result.rooms[0].currentStatus).toBe('occupied');
  });

  it('khong booking, khong occupancy → currentStatus=available', async () => {
    queryMock
      .mockResolvedValueOnce([
        {
          ...mockRoomRow,
          administrative_status: 'available',
          latest_occupancy_count: 0,
          has_current_booking: false,
          has_live_meeting: false,
        },
      ])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({ page: 1, limit: 50 });
    expect(result.rooms[0].currentStatus).toBe('available');
  });

  it('should combine capacityMin + capacityMax + areaName + onlyAvailable with AND', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow])
      .mockResolvedValueOnce([{ count: '1' }]);

    await service.search({
      capacityMin: 8,
      capacityMax: 15,
      areaName: 'Tang 3',
      onlyAvailable: true,
      page: 1,
      limit: 50,
    });

    const [, params] = queryMock.mock.calls[0];
    expect(params).toEqual([8, 15, 'Tang 3', true, null, null, null, 50, 0]);
  });

  // ─── [FIX 2026-08-19] them filter q (ten/ma phong) va status (real-time) ───
  it('should bind q and status params and expose them in appliedFilters', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({
      q: 'Phong hop',
      status: 'occupied',
      page: 1,
      limit: 50,
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(params).toEqual([
      null,
      null,
      null,
      null,
      'Phong hop',
      'occupied',
      null,
      50,
      0,
    ]);
    expect(sql).toContain('ILIKE');
    expect(result.meta.appliedFilters).toEqual({
      q: 'Phong hop',
      status: 'occupied',
    });
  });

  it('should trim q and treat blank q as no filter', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow])
      .mockResolvedValueOnce([{ count: '1' }]);

    await service.search({ q: '   ', page: 1, limit: 50 });

    const [, params] = queryMock.mock.calls[0];
    expect(params[4]).toBeNull();
  });

  it('should return empty rooms array when nothing matches (E1)', async () => {
    queryMock.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: '0' }]);

    const result = await service.search({
      capacityMin: 1000,
      page: 1,
      limit: 50,
    });

    expect(result.rooms).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('should throw BadRequestException when capacityMin > capacityMax', async () => {
    await expect(
      service.search({ capacityMin: 20, capacityMax: 10 } as any),
    ).rejects.toThrow(BadRequestException);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('should not expose internal operational fields in the mapped item', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow])
      .mockResolvedValueOnce([{ count: '1' }]);

    const result = await service.search({ page: 1, limit: 50 });

    expect(result.rooms[0]).not.toHaveProperty('occupancyCount');
    expect(result.rooms[0]).not.toHaveProperty('lastPresenceAt');
    expect(result.rooms[0]).not.toHaveProperty('noShowStatus');
    expect(result.rooms[0]).not.toHaveProperty('currentBooking');
  });

  it('should compute pagination meta correctly', async () => {
    queryMock
      .mockResolvedValueOnce([mockRoomRow])
      .mockResolvedValueOnce([{ count: '105' }]);

    const result = await service.search({ page: 2, limit: 50 });

    expect(result.meta.page).toBe(2);
    expect(result.meta.limit).toBe(50);
    expect(result.meta.total).toBe(105);
    expect(result.meta.totalPages).toBe(3);
    // offset = (page-1)*limit = 50
    const [, params] = queryMock.mock.calls[0];
    expect(params[8]).toBe(50);
  });
});

describe('RoomSearchService.getAvailableRooms', () => {
  let service: RoomSearchService;
  let dataSource: jest.Mocked<Partial<DataSource>>;
  let queryMock: jest.Mock;
  let findOneMock: jest.Mock;

  const mockAvailableRow = {
    id: 'r1',
    room_code: 'A101',
    room_name: 'Phong hop A101',
    site_name: 'Toa nha A',
    area_name: 'Tang 1',
    capacity: 8,
    current_status: 'available',
    has_camera: true,
    has_microphone: true,
    has_display: true,
  };

  beforeEach(async () => {
    queryMock = jest.fn();
    findOneMock = jest.fn().mockResolvedValue(null); // -> default buffer 15p
    dataSource = {
      manager: { query: queryMock } as any,
      getRepository: jest.fn().mockReturnValue({ findOne: findOneMock }) as any,
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

  it('tra ve danh sach phong trong, map dung field contract FE (hasScreen tu has_display)', async () => {
    queryMock.mockResolvedValueOnce([mockAvailableRow]);

    const result = await service.getAvailableRooms({
      startTime: '2026-08-15T09:00:00.000Z',
      endTime: '2026-08-15T10:30:00.000Z',
      minCapacity: 5,
    });

    expect(result).toEqual([
      {
        id: 'r1',
        roomName: 'Phong hop A101',
        roomCode: 'A101',
        capacity: 8,
        status: 'available',
        siteName: 'Toa nha A',
        areaName: 'Tang 1',
        hasCamera: true,
        hasMicrophone: true,
        hasScreen: true,
      },
    ]);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain("rb.status IN ('approved', 'active')");
    expect(params[0]).toBe(5);
  });

  it('cong buffer mac dinh 15 phut vao khung gio khi truy van overlap', async () => {
    queryMock.mockResolvedValueOnce([]);

    await service.getAvailableRooms({
      startTime: '2026-08-15T09:00:00.000Z',
      endTime: '2026-08-15T10:00:00.000Z',
    });

    const [, params] = queryMock.mock.calls[0];
    const bufferedStart = params[1] as Date;
    const bufferedEnd = params[2] as Date;
    expect(bufferedStart.toISOString()).toBe('2026-08-15T08:45:00.000Z');
    expect(bufferedEnd.toISOString()).toBe('2026-08-15T10:15:00.000Z');
  });

  it('throw BadRequestException khi endTime <= startTime', async () => {
    await expect(
      service.getAvailableRooms({
        startTime: '2026-08-15T10:00:00.000Z',
        endTime: '2026-08-15T09:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('throw BadRequestException khi startTime/endTime khong dung dinh dang', async () => {
    await expect(
      service.getAvailableRooms({
        startTime: 'not-a-date',
        endTime: '2026-08-15T09:00:00.000Z',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(queryMock).not.toHaveBeenCalled();
  });
});
