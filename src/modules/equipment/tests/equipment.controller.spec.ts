import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { EquipmentController } from '../controllers/equipment.controller.js';
import { EquipmentService } from '../services/equipment.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { EquipmentType } from '../entities/equipment.entity.js';

describe('EquipmentController.create (UC-61)', () => {
  let controller: EquipmentController;
  const mockService = { create: jest.fn() };

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

  it('[C1] Success — goi service dung (dto,userId,ip) & tra {success,message,data}', async () => {
    const data = { id: 'eq-1', equipmentCode: 'EQP-001' };
    mockService.create.mockResolvedValue(data);

    const dto = {
      equipmentName: 'May chieu',
      equipmentType: EquipmentType.DISPLAY,
      equipmentCode: 'EQP-001',
    } as never;
    const user = { userId: 'user-1' };

    const result = await controller.create(dto, user, '10.0.0.1');

    expect(mockService.create).toHaveBeenCalledWith(dto, 'user-1', '10.0.0.1');
    expect(result).toEqual({
      success: true,
      message: 'Đăng ký thiết bị thành công',
      data,
    });
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { create } = EquipmentController.prototype;

  it('[C2] Handler ap PermissionsGuard; class ap JwtAuthGuard', () => {
    const handlerGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      create,
    ) as unknown[];
    expect(handlerGuards).toEqual([PermissionsGuard]);

    const classGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      EquipmentController,
    ) as unknown[];
    expect(classGuards).toEqual([JwtAuthGuard]);
  });

  it('[C3] Yeu cau permission equipment.create', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      create,
    ) as string[];
    expect(permissions).toEqual(['equipment.create']);
  });

  it('[C4] Thieu userId → throw (check JwtAuthGuard)', async () => {
    await expect(
      controller.create({} as never, undefined, '10.0.0.1'),
    ).rejects.toThrow('userId is required');
  });
});
