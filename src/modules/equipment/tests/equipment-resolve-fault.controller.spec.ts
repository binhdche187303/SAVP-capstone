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
import { ResolveEquipmentFaultDto } from '../dto/resolve-equipment-fault.dto.js';
import { HealthStatus } from '../entities/equipment.entity.js';

describe('EquipmentController.resolveFault (EQUIP-FAULT-LIFECYCLE-001)', () => {
  let controller: EquipmentController;
  const mockService = { resolveFault: jest.fn() };

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

  it('[C1] Success — gọi service.resolveFault(equipmentId, dto, userId, ip) & trả {success, message, data}', async () => {
    const data = { id: equipmentId, healthStatus: HealthStatus.HEALTHY };
    mockService.resolveFault.mockResolvedValue(data);

    const dto = {
      healthStatus: HealthStatus.HEALTHY,
      resolutionNote: 'Đã bảo trì xong',
    };
    const user = { userId: 'user-2' };

    const result = await controller.resolveFault(
      equipmentId,
      dto,
      user,
      '10.0.0.1',
    );

    expect(mockService.resolveFault).toHaveBeenCalledWith(
      equipmentId,
      dto,
      'user-2',
      '10.0.0.1',
    );
    expect(result).toEqual({
      success: true,
      message: 'Cập nhật thiết bị đã sửa xong thành công',
      data,
    });
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { resolveFault } = EquipmentController.prototype;

  it('[C2] Handler áp PermissionsGuard; class áp JwtAuthGuard', () => {
    const handlerGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      resolveFault,
    ) as unknown[];
    expect(handlerGuards).toEqual([PermissionsGuard]);

    const classGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      EquipmentController,
    ) as unknown[];
    expect(classGuards).toEqual([JwtAuthGuard]);
  });

  it('[C3] Yêu cầu permission equipment.resolve_fault', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      resolveFault,
    ) as string[];
    expect(permissions).toEqual(['equipment.resolve_fault']);
  });

  it('[C4] DTO healthStatus=faulty / offline → reject (chỉ nhận healthy/warning)', async () => {
    const faultyDto = plainToInstance(ResolveEquipmentFaultDto, {
      healthStatus: 'faulty',
      resolutionNote: 'Note',
    });
    const errFaulty = await validate(faultyDto);
    expect(errFaulty.some((e) => e.property === 'healthStatus')).toBe(true);

    const offlineDto = plainToInstance(ResolveEquipmentFaultDto, {
      healthStatus: 'offline',
      resolutionNote: 'Note',
    });
    const errOffline = await validate(offlineDto);
    expect(errOffline.some((e) => e.property === 'healthStatus')).toBe(true);
  });

  it('[C5] DTO resolutionNote rỗng → reject', async () => {
    const noNoteDto = plainToInstance(ResolveEquipmentFaultDto, {
      healthStatus: 'healthy',
      resolutionNote: '',
    });
    const errs = await validate(noNoteDto);
    expect(errs.some((e) => e.property === 'resolutionNote')).toBe(true);
  });
});
