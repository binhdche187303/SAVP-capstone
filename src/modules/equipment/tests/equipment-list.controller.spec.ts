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
import { ListEquipmentsQueryDto } from '../dto/list-equipments-query.dto.js';

describe('EquipmentController.listEquipments (UC-64)', () => {
  let controller: EquipmentController;
  const mockService = { listEquipments: jest.fn() };

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

  it('[C1] Success — goi service dung & meta.totalPages = ceil(total/limit)', async () => {
    const data = [{ id: 'eq-1' }];
    mockService.listEquipments.mockResolvedValue({ data, total: 12 });

    const query = { page: 2, limit: 5 } as ListEquipmentsQueryDto;
    const result = await controller.listEquipments(query);

    expect(mockService.listEquipments).toHaveBeenCalledWith(query);
    expect(result).toEqual({
      success: true,
      message: 'Danh sách thiết bị',
      data,
      meta: { page: 2, limit: 5, total: 12, totalPages: 3 },
    });
  });

  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { listEquipments } = EquipmentController.prototype;

  it('[C2] Handler ap PermissionsGuard; class ap JwtAuthGuard', () => {
    const handlerGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      listEquipments,
    ) as unknown[];
    expect(handlerGuards).toEqual([PermissionsGuard]);

    const classGuards = Reflect.getMetadata(
      GUARDS_METADATA,
      EquipmentController,
    ) as unknown[];
    expect(classGuards).toEqual([JwtAuthGuard]);
  });

  it('[C3] Yeu cau permission equipment.read', () => {
    const permissions = Reflect.getMetadata(
      PERMISSIONS_KEY,
      listEquipments,
    ) as string[];
    expect(permissions).toEqual(['equipment.read']);
  });

  it('[C4] DTO chan sortBy la (@IsIn) + limit>100 (@Max) — validate(), khong assert HTTP', async () => {
    const badSort = plainToInstance(ListEquipmentsQueryDto, {
      sortBy: 'e.id; DROP TABLE',
    });
    const errSort = await validate(badSort);
    expect(errSort.some((e) => e.property === 'sortBy')).toBe(true);

    const badLimit = plainToInstance(ListEquipmentsQueryDto, { limit: 200 });
    const errLimit = await validate(badLimit);
    expect(errLimit.some((e) => e.property === 'limit')).toBe(true);
  });
});
