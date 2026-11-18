import { Test, TestingModule } from '@nestjs/testing';
import { RoomBookingsController } from '../controllers/room-bookings.controller.js';
import { RoomBookingsService } from '../services/room-bookings.service.js';

describe('RoomBookingsController', () => {
  let controller: RoomBookingsController;
  let service: jest.Mocked<RoomBookingsService>;

  const mockUserId = '550e8400-e29b-41d4-a716-446655440000';

  const mockRoomBookingQuery = {
    page: 1,
    limit: 20,
    sortBy: 'reserved_start_time',
    sortOrder: 'desc',
  };

  const mockResult = {
    items: [
      {
        id: '660e8400-e29b-41d4-a716-446655440001',
        bookingCode: 'BK-2026-001',
        bookingType: 'scheduled',
        status: 'approved',
        roomId: '770e8400-e29b-41d4-a716-446655440002',
        meetingId: '880e8400-e29b-41d4-a716-446655440003',
        bookedBy: mockUserId,
        reservedStartTime: new Date('2026-07-25T09:00:00.000Z'),
        reservedEndTime: new Date('2026-07-25T10:00:00.000Z'),
        approvedBy: null,
        approvedAt: null,
        cancellationReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        room: {
          id: '770e8400-e29b-41d4-a716-446655440002',
          roomName: 'Phong 101',
        },
        meeting: {
          id: '880e8400-e29b-41d4-a716-446655440003',
          title: 'Sprint Planning',
        },
        bookedByUser: {
          id: mockUserId,
          fullName: 'Nguyen Van A',
          email: 'nva@company.com',
        },
        approvedByUser: null,
      },
    ],
    page: 1,
    limit: 20,
    total: 1,
  };

  beforeEach(async () => {
    service = {
      findRoomBookings: jest.fn().mockResolvedValue(mockResult),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RoomBookingsController],
      providers: [{ provide: RoomBookingsService, useValue: service }],
    })
      .overrideGuard(
        require('../../auth/guards/jwt-auth.guard.js').JwtAuthGuard,
      )
      .useValue({ canActivate: () => true })
      .overrideGuard(
        require('../../auth/guards/permissions.guard.js').PermissionsGuard,
      )
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<RoomBookingsController>(RoomBookingsController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should return paginated bookings on success', async () => {
      const result = await controller.findAll(mockRoomBookingQuery, {
        userId: mockUserId,
      });

      expect(service.findRoomBookings).toHaveBeenCalledWith(
        mockRoomBookingQuery,
        { userId: mockUserId },
      );
      expect(result.success).toBe(true);
      expect(result.message).toBe('Danh sách đặt phòng');
      expect(result.data).toHaveLength(1);
      expect(result.meta.page).toBe(1);
      expect(result.meta.limit).toBe(20);
      expect(result.meta.total).toBe(1);
      expect(result.meta.totalPages).toBe(1);
    });

    it('should return empty list when no bookings', async () => {
      service.findRoomBookings.mockResolvedValue({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
      });

      const result = await controller.findAll(mockRoomBookingQuery, {
        userId: mockUserId,
      });

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });

    it('should pass query params to service', async () => {
      const query = {
        page: 2,
        limit: 10,
        roomId: '770e8400-e29b-41d4-a716-446655440002',
        status: 'active',
        bookingType: 'ad_hoc',
        sortBy: 'created_at',
        sortOrder: 'asc',
      };

      await controller.findAll(query, { userId: mockUserId });

      expect(service.findRoomBookings).toHaveBeenCalledWith(query, {
        userId: mockUserId,
      });
    });

    it('should propagate service errors', async () => {
      service.findRoomBookings.mockRejectedValue(new Error('DB error'));

      await expect(
        controller.findAll(
          mockRoomBookingQuery as any,
          { userId: mockUserId } as any,
        ),
      ).rejects.toThrow('DB error');
    });
  });
});
