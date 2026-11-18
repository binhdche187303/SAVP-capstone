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
import { ReportEquipmentFaultDto } from '../dto/report-equipment-fault.dto.js';

describe('EquipmentController.reportFault (UC-62)', () => {
  let controller: EquipmentController;
  const mockService = { reportFault: jest.fn() };

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
    const data = { id: equipmentId, healthStatus: 'faulty' };
    mockService.reportFault.mockResolvedValue(data);

    const dto = { healthStatus: 'faulty', issueNote: 'loi' } as never;
    const user = { userId: 'user-1' };

    const result = await controller.reportFault(
      equipmentId,
      dto,
      user,
      '10.0.0.1',
    );

    expect(mockService.reportFault).toHaveBeenCalledWith(
      equipmentId,
      dto,
      'user-1',
      '10.0.0.1',
    );
    expect(result).toEqual({
      success: true,
      message: 'Cập nhật trạng thái lỗi thiết bị thành công',
      data,
    });
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { reportFault } = EquipmentController.prototype;

  it('[C2] Handler ap PermissionsGuard; class ap JwtAuthGuard', () => {
    const handlerGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      reportFault,
    ) as unknown[];
    expect(handlerGuards).toEqual([PermissionsGuard]);

    const classGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      EquipmentController,
    ) as unknown[];
    expect(classGuards).toEqual([JwtAuthGuard]);
  });

  it('[C3] Yeu cau permission equipment.report_fault', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      reportFault,
    ) as string[];
    expect(permissions).toEqual(['equipment.report_fault']);
  });

  it('[C4] DTO chan recovery: healthStatus=healthy / assetStatus=available → @IsIn reject', async () => {
    const healthy = plainToInstance(ReportEquipmentFaultDto, {
      healthStatus: 'healthy',
      issueNote: 'x',
    });
    const errHealthy = await validate(healthy);
    expect(errHealthy.length).toBeGreaterThan(0);
    expect(errHealthy.some((e) => e.property === 'healthStatus')).toBe(true);

    const available = plainToInstance(ReportEquipmentFaultDto, {
      assetStatus: 'available',
      issueNote: 'x',
    });
    const errAvailable = await validate(available);
    expect(errAvailable.length).toBeGreaterThan(0);
    expect(errAvailable.some((e) => e.property === 'assetStatus')).toBe(true);
  });

  it('[C4b] DTO: assetStatus=active / retired → hop le (khong reject)', async () => {
    const active = plainToInstance(ReportEquipmentFaultDto, {
      assetStatus: 'active',
      issueNote: 'x',
    });
    const errActive = await validate(active);
    expect(errActive.some((e) => e.property === 'assetStatus')).toBe(false);

    const retired = plainToInstance(ReportEquipmentFaultDto, {
      assetStatus: 'retired',
      issueNote: 'x',
    });
    const errRetired = await validate(retired);
    expect(errRetired.some((e) => e.property === 'assetStatus')).toBe(false);
  });

  it('[C5] DTO: issueNote rong → reject', async () => {
    const noNote = plainToInstance(ReportEquipmentFaultDto, {
      healthStatus: 'faulty',
    });
    const errs = await validate(noNote);
    expect(errs.some((e) => e.property === 'issueNote')).toBe(true);
  });
});
