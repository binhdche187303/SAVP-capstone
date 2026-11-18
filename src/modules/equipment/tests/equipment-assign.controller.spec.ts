import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { EquipmentController } from '../controllers/equipment.controller.js';
import { EquipmentService } from '../services/equipment.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

describe('EquipmentController.assignToRoom (UC-65)', () => {
  let controller: EquipmentController;
  const mockService = { assignToRoom: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EquipmentController],
      providers: [{ provide: EquipmentService, useValue: mockService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get<EquipmentController>(EquipmentController);
  });

  afterEach(() => jest.clearAllMocks());

  const equipmentId = '550e8400-e29b-41d4-a716-446655440000';

  it('[C1] Success — goi service dung (equipmentId,dto,userId,ip) & tra {success,message,data}', async () => {
    const data = { id: equipmentId, currentRoomId: 'room-1' };
    mockService.assignToRoom.mockResolvedValue(data);

    const dto = { roomId: 'room-1' } as never;
    const user = { userId: 'user-1' };

    const result = await controller.assignToRoom(
      equipmentId,
      dto,
      user,
      '10.0.0.1',
    );

    expect(mockService.assignToRoom).toHaveBeenCalledWith(
      equipmentId,
      dto,
      'user-1',
      '10.0.0.1',
    );
    expect(result).toEqual({
      success: true,
      message: 'Phân bổ thiết bị vào phòng thành công',
      data,
    });
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { assignToRoom } = EquipmentController.prototype;

  it('[C2] Handler ap PermissionsGuard; class ap JwtAuthGuard', () => {
    const handlerGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      assignToRoom,
    ) as unknown[];
    expect(handlerGuards).toEqual([PermissionsGuard]);

    const classGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      EquipmentController,
    ) as unknown[];
    expect(classGuards).toEqual([JwtAuthGuard]);
  });

  it('[C3] Yeu cau permission equipment.assign', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      assignToRoom,
    ) as string[];
    expect(permissions).toEqual(['equipment.assign']);
  });

  it('[C4] Thieu userId → throw (check JwtAuthGuard)', async () => {
    await expect(
      controller.assignToRoom(
        equipmentId,
        { roomId: 'r' },
        undefined,
        '10.0.0.1',
      ),
    ).rejects.toThrow('userId is required');
  });
});
