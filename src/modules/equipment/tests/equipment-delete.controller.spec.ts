import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { EquipmentController } from '../controllers/equipment.controller.js';
import { EquipmentService } from '../services/equipment.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

describe('EquipmentController.deleteEquipment (UC-63)', () => {
  let controller: EquipmentController;
  const mockService = { deleteEquipment: jest.fn() };

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

  it('[C1] Success — goi service dung (equipmentId,userId,ip) & tra {success,message} (KHONG data)', async () => {
    mockService.deleteEquipment.mockResolvedValue(undefined);
    const user = { userId: 'user-1' };

    const result = await controller.deleteEquipment(
      equipmentId,
      user,
      '10.0.0.1',
    );

    expect(mockService.deleteEquipment).toHaveBeenCalledWith(
      equipmentId,
      'user-1',
      '10.0.0.1',
    );
    expect(result).toEqual({
      success: true,
      message: 'Xóa thiết bị thành công',
    });
    expect(result).not.toHaveProperty('data');
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { deleteEquipment } = EquipmentController.prototype;

  it('[C2] Handler ap PermissionsGuard; class ap JwtAuthGuard', () => {
    const handlerGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      deleteEquipment,
    ) as unknown[];
    expect(handlerGuards).toEqual([PermissionsGuard]);

    const classGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      EquipmentController,
    ) as unknown[];
    expect(classGuards).toEqual([JwtAuthGuard]);
  });

  it('[C3] Yeu cau permission equipment.delete', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      deleteEquipment,
    ) as string[];
    expect(permissions).toEqual(['equipment.delete']);
  });

  it('[C4] Thieu userId → throw (check JwtAuthGuard)', async () => {
    await expect(
      controller.deleteEquipment(equipmentId, undefined, '10.0.0.1'),
    ).rejects.toThrow('userId is required');
  });
});
