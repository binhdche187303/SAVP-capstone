import 'reflect-metadata';
import { Test, type TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { EquipmentController } from '../controllers/equipment.controller.js';
import { EquipmentService } from '../services/equipment.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';
import { ConfirmEquipmentFaultDto } from '../dto/confirm-equipment-fault.dto.js';

describe('EquipmentController.confirmFault (EQUIP-FAULT-LIFECYCLE-001)', () => {
  let controller: EquipmentController;
  const mockService = { confirmFault: jest.fn() };

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

  it('[C1] Success — gọi service.confirmFault(equipmentId, dto, userId, ip) & trả {success, message, data}', async () => {
    const data = {
      equipmentId,
      healthStatus: 'faulty',
      confirmedBy: 'user-1',
      confirmedAt: new Date(),
    };
    mockService.confirmFault.mockResolvedValue(data);

    const dto = { confirmationNote: 'Note xác nhận' };
    const user = { userId: 'user-1' };

    const result = await controller.confirmFault(
      equipmentId,
      dto,
      user,
      '10.0.0.1',
    );

    expect(mockService.confirmFault).toHaveBeenCalledWith(
      equipmentId,
      dto,
      'user-1',
      '10.0.0.1',
    );
    expect(result).toEqual({
      success: true,
      message: 'Xác nhận lỗi thiết bị thành công',
      data,
    });
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { confirmFault } = EquipmentController.prototype;

  it('[C2] Handler áp PermissionsGuard; class áp JwtAuthGuard', () => {
    const handlerGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      confirmFault,
    ) as unknown[];
    expect(handlerGuards).toEqual([PermissionsGuard]);

    const classGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      EquipmentController,
    ) as unknown[];
    expect(classGuards).toEqual([JwtAuthGuard]);
  });

  it('[C3] Yêu cầu permission equipment.confirm_fault', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      confirmFault,
    ) as string[];
    expect(permissions).toEqual(['equipment.confirm_fault']);
  });

  it('[C4] DTO confirmationNote quá dài (>2000 ký tự) → reject', async () => {
    const invalidDto = plainToInstance(ConfirmEquipmentFaultDto, {
      confirmationNote: 'a'.repeat(2001),
    });
    const errors = await validate(invalidDto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'confirmationNote')).toBe(true);
  });
});
