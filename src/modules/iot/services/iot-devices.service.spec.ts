/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument, @typescript-eslint/require-await */
import { Test, TestingModule } from '@nestjs/testing';
import { IotDevicesService } from './iot-devices.service.js';
import { DataSource, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { IotAuditRepository } from '../repositories/iot-audit.repository.js';
import { IotDeviceEventsService } from './iot-device-events.service.js';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  IoTDeviceType,
  IoTDeviceEntity,
} from '../entities/iot-device.entity.js';
import { probeTcp } from '../utils/rtsp-probe.util.js';
import { probeRtspRuntime } from '../utils/rtsp-runtime-probe.util.js';
import * as nodeCrypto from 'crypto';
import { FaceDeviceProviderFactory } from '../../face-access/face-device-provider.factory.js';
import { FaceGateClient } from '../../face-access/clients/facegate.client.js';
import { DEVICE_OFFLINE_ALERT_HOOK } from '../../../common/ports/device-offline-alert-hook.js';

jest.mock('../utils/rtsp-probe.util.js', () => ({
  probeTcp: jest.fn(),
}));
const probeTcpMock = probeTcp as jest.MockedFunction<typeof probeTcp>;

// A5: mock util runtime RTSP probe (không cần camera/ffprobe thật).
jest.mock('../utils/rtsp-runtime-probe.util.js', () => ({
  probeRtspRuntime: jest.fn(),
}));
const probeRtspRuntimeMock = probeRtspRuntime as jest.MockedFunction<
  typeof probeRtspRuntime
>;

describe('IotDevicesService', () => {
  let service: IotDevicesService;
  let dataSourceMock: any;
  let auditRepoMock: any;
  let queryRunnerMock: any; // Keep as any for deep mocking
  let deviceOfflineHookMock: {
    onDevicesOffline: jest.Mock;
    onDevicesOnline: jest.Mock;
  };

  beforeEach(async () => {
    deviceOfflineHookMock = {
      onDevicesOffline: jest.fn(),
      onDevicesOnline: jest.fn(),
    };
    queryRunnerMock = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        findOne: jest.fn(),
        create: jest.fn((entity, dto) => dto),
        save: jest.fn((entity, obj) => ({ ...obj, id: 'test-id' })),
      },
      query: jest.fn(),
    };

    dataSourceMock = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunnerMock) as any,
      getRepository: jest.fn(),
      manager: {
        findOne: jest.fn(),
        find: jest.fn(),
        query: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      } as any,
    };

    probeTcpMock.mockReset();

    auditRepoMock = {
      logDeviceCreation: jest.fn(),
      logAssignRoom: jest.fn(),
      logDeviceUpdate: jest.fn(),
      logDeviceStatusChange: jest.fn(),
      logConfigureRtsp: jest.fn(),
      logConfigureAi: jest.fn(),
      logRevokeFaceServerToken: jest.fn(),
      logRotateFaceServerToken: jest.fn(),
      logConfigureFaceServer: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IotDevicesService,
        { provide: DataSource, useValue: dataSourceMock as DataSource },
        {
          provide: IotAuditRepository,
          useValue: auditRepoMock as IotAuditRepository,
        },
        {
          provide: IotDeviceEventsService,
          useValue: { storeRawEvent: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: { get: jest.fn((_k: string, def?: unknown) => def) },
        },
        { provide: DEVICE_OFFLINE_ALERT_HOOK, useValue: deviceOfflineHookMock },
      ],
    }).compile();

    service = module.get<IotDevicesService>(IotDevicesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create a device successfully (happy path)', async () => {
    queryRunnerMock.manager.findOne.mockResolvedValue(null);

    const dto = {
      deviceName: 'Test Camera',
      deviceCode: 'CAM-001',
      deviceType: IoTDeviceType.ROOM_CAMERA,
    };

    const result = await service.create('user-id', dto);

    expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
    expect(queryRunnerMock.manager.save).toHaveBeenCalled();
    expect(auditRepoMock.logDeviceCreation).toHaveBeenCalledWith(
      queryRunnerMock.manager,
      {
        userId: 'user-id',
        deviceId: 'test-id',
        metadataJson: null,
      },
    );
    expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    expect(result.id).toBe('test-id');
    expect(result.status).toBe('offline');
  });

  it('should throw ConflictException if deviceCode exists', async () => {
    queryRunnerMock.manager.findOne.mockImplementation(
      async (entity, options) => {
        if (options.where.deviceCode === 'CAM-001') return { id: 'existing' };
        return null;
      },
    );

    const dto = {
      deviceName: 'Test Camera',
      deviceCode: 'CAM-001',
      deviceType: IoTDeviceType.ROOM_CAMERA,
    };

    await expect(service.create('user-id', dto)).rejects.toThrow(
      ConflictException,
    );
    await expect(service.create('user-id', dto)).rejects.toThrow(
      'Device code already exists in the system.',
    );
    expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
  });

  it('should throw ConflictException if macAddress exists', async () => {
    queryRunnerMock.manager.findOne.mockImplementation(
      async (entity, options) => {
        if (options.where.macAddress === 'AA:BB:CC') return { id: 'existing' };
        return null;
      },
    );

    const dto = {
      deviceName: 'Test Camera',
      deviceCode: 'CAM-002',
      deviceType: IoTDeviceType.ROOM_CAMERA,
      macAddress: 'AA:BB:CC',
    };

    await expect(service.create('user-id', dto)).rejects.toThrow(
      ConflictException,
    );
    expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
  });

  describe('assignRoom', () => {
    it('should throw NotFoundException if device not found', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if device type is invalid', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IoTDeviceType.MICROPHONE,
      });
      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException if device is already assigned to a DIFFERENT room', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: 'room-2',
      });
      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should return 200 OK (return early) if device is assigned to the SAME room', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: 'room-1',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      const result = await service.assignRoom('user-id', 'dev-1', {
        roomId: 'room-1',
      });
      expect(result).toEqual(device);
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled(); // No DB update
    });

    it('should throw NotFoundException if room is not found', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: null,
      });
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([]);

      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if room is not active', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: null,
      });
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([
        { is_active: false },
      ]);

      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should successfully assign room, log audit and commit transaction', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([
        { is_active: true },
      ]);

      queryRunnerMock.manager.save.mockResolvedValue({
        ...device,
        roomId: 'room-1',
      });

      const result = await service.assignRoom('user-id', 'dev-1', {
        roomId: 'room-1',
      });

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logAssignRoom).toHaveBeenCalled();
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
      expect(result.roomId).toBe('room-1');
    });

    it('should rollback transaction if audit log fails', async () => {
      const device = {
        id: 'dev-1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        roomId: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      (dataSourceMock.manager.query as jest.Mock).mockResolvedValue([
        { is_active: true },
      ]);

      queryRunnerMock.manager.save.mockResolvedValue({
        ...device,
        roomId: 'room-1',
      });

      (auditRepoMock.logAssignRoom as jest.Mock).mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(
        service.assignRoom('user-id', 'dev-1', { roomId: 'room-1' }),
      ).rejects.toThrow('DB Error');

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('T1 happy: updates fields, saves and logs audit', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Old Cam',
        ipAddress: '192.168.1.1',
        macAddress: null,
        networkIdentifier: null,
        status: 'online',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.update('user-id', 'dev-1', {
        deviceName: 'New Cam',
        ipAddress: '192.168.1.2',
      });

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logDeviceUpdate).toHaveBeenCalledTimes(1);
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
      expect(result.deviceName).toBe('New Cam');
      expect(result.ipAddress).toBe('192.168.1.2');
    });

    it('T2 idempotent: same values => no transaction, no audit', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Same Cam',
        ipAddress: '192.168.1.1',
        macAddress: null,
        networkIdentifier: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      const result = await service.update('user-id', 'dev-1', {
        deviceName: 'Same Cam',
      });

      expect(result).toEqual(device);
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).not.toHaveBeenCalled();
      expect(auditRepoMock.logDeviceUpdate).not.toHaveBeenCalled();
    });

    it('T3 mac conflict: existing mac on another device => ConflictException', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Cam',
        macAddress: 'AA:AA:AA:AA:AA:AA',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockImplementation(
        async (_entity: unknown, options: any) => {
          if (options.where.macAddress !== undefined) return { id: 'other' };
          return device;
        },
      );

      await expect(
        service.update('user-id', 'dev-1', {
          macAddress: 'BB:BB:BB:BB:BB:BB',
        }),
      ).rejects.toThrow(ConflictException);
      await expect(
        service.update('user-id', 'dev-1', {
          macAddress: 'BB:BB:BB:BB:BB:BB',
        }),
      ).rejects.toThrow('MAC address already exists in the system.');
    });

    it('T4 not found: device missing => NotFoundException', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(
        service.update('user-id', 'dev-1', { deviceName: 'X' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('T5 empty body: no allowlist field => BadRequestException NO_UPDATABLE_FIELDS', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'dev-1',
        deviceName: 'Cam',
      });
      await expect(service.update('user-id', 'dev-1', {})).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.update('user-id', 'dev-1', {})).rejects.toThrow(
        'No updatable fields were provided.',
      );
    });

    it('T6 set null: clears a connection field (ip_address -> null)', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Cam',
        ipAddress: '192.168.1.1',
        macAddress: null,
        networkIdentifier: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.update('user-id', 'dev-1', {
        ipAddress: null,
      });

      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logDeviceUpdate).toHaveBeenCalledTimes(1);
      expect(result.ipAddress).toBeNull();
    });

    it('T7 does not touch status/health/last_seen', async () => {
      const lastSeen = new Date('2026-06-15T00:00:00Z');
      const device = {
        id: 'dev-1',
        deviceName: 'Old',
        ipAddress: null,
        macAddress: null,
        networkIdentifier: null,
        status: 'online',
        healthStatus: 'healthy',
        lastSeenAt: lastSeen,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.update('user-id', 'dev-1', {
        deviceName: 'New',
      });

      expect(result.status).toBe('online');
      expect(result.healthStatus).toBe('healthy');
      expect(result.lastSeenAt).toBe(lastSeen);
    });

    it('T8 rollback: audit failure rolls back transaction', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Old',
        ipAddress: null,
        macAddress: null,
        networkIdentifier: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );
      (auditRepoMock.logDeviceUpdate as jest.Mock).mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(
        service.update('user-id', 'dev-1', { deviceName: 'New' }),
      ).rejects.toThrow('DB Error');

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });

    // ── [FIX 2026-08-16] Đồng bộ face_server_config.base_url khi IP đổi qua PATCH cơ bản ──
    it('T9 IP đổi thật + có base_url cũ → base_url null hoá (field khác trong cfg giữ nguyên)', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Face A',
        ipAddress: '192.168.1.12',
        macAddress: null,
        networkIdentifier: null,
        metadataJson: {
          face_server_config: {
            base_url: 'http://192.168.1.12',
            username: 'admin',
          },
        },
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.update('user-id', 'dev-1', {
        ipAddress: '192.168.2.10',
      });

      expect(result.ipAddress).toBe('192.168.2.10');
      expect(
        (result.metadataJson as any).face_server_config.base_url,
      ).toBeNull();
      expect((result.metadataJson as any).face_server_config.username).toBe(
        'admin',
      );
    });

    it('T10 QUAN TRỌNG NHẤT: chỉ đổi device_name, ip_address gửi kèm y hệt giá trị cũ (đúng hành vi FE thật) → base_url GIỮ NGUYÊN', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Old Name',
        ipAddress: '192.168.1.12',
        macAddress: null,
        networkIdentifier: null,
        metadataJson: {
          face_server_config: { base_url: 'http://192.168.1.12' },
        },
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      // Mô phỏng ĐÚNG DeviceManagement.jsx:234-237 — form luôn gửi kèm
      // ip_address dù user chỉ sửa device_name trên modal Edit.
      const result = await service.update('user-id', 'dev-1', {
        deviceName: 'New Name',
        ipAddress: '192.168.1.12',
      });

      expect(result.deviceName).toBe('New Name');
      expect((result.metadataJson as any).face_server_config.base_url).toBe(
        'http://192.168.1.12',
      );
    });

    it('T11 Device chưa từng cấu hình face server (metadataJson null) + đổi IP → không lỗi, không tạo cấu trúc thừa', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Face Rỗng',
        ipAddress: null,
        macAddress: null,
        networkIdentifier: null,
        metadataJson: null,
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.update('user-id', 'dev-1', {
        ipAddress: '192.168.3.1',
      });

      expect(result.ipAddress).toBe('192.168.3.1');
      expect(result.metadataJson).toBeNull();
    });

    it('T12 Tích hợp thật: sau base_url=null, FaceDeviceProviderFactory.create() tự fallback đúng sang ip_address MỚI', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Face A',
        ipAddress: '192.168.1.12',
        macAddress: null,
        networkIdentifier: null,
        metadataJson: {
          face_server_config: { base_url: 'http://192.168.1.12' },
        },
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.update('user-id', 'dev-1', {
        ipAddress: '192.168.2.10',
      });

      const factory = new FaceDeviceProviderFactory({
        get: (_k: string, d?: unknown) => d,
      } as any);
      const provider = factory.create({
        ipAddress: result.ipAddress,
        metadataJson: result.metadataJson,
      });

      expect(provider).toBeInstanceOf(FaceGateClient);
      expect((provider as any).deps.baseUrl).toBe('http://192.168.2.10');
    });

    it('T13 Regression: đổi mac_address/network_identifier (KHÔNG đụng ip_address) → base_url không bị đụng tới', async () => {
      const device = {
        id: 'dev-1',
        deviceName: 'Old',
        ipAddress: '192.168.1.12',
        macAddress: 'AA:AA:AA:AA:AA:AA',
        networkIdentifier: 'net-old',
        metadataJson: {
          face_server_config: { base_url: 'http://192.168.1.12' },
        },
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockImplementation(
        async (_entity: unknown, options: any) => {
          if (options.where?.macAddress !== undefined) return null; // không trùng
          return device;
        },
      );
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.update('user-id', 'dev-1', {
        macAddress: 'BB:BB:BB:BB:BB:BB',
        networkIdentifier: 'net-new',
      });

      expect(result.macAddress).toBe('BB:BB:BB:BB:BB:BB');
      expect(result.networkIdentifier).toBe('net-new');
      expect((result.metadataJson as any).face_server_config.base_url).toBe(
        'http://192.168.1.12',
      );
    });
  });

  describe('disable', () => {
    it('T1 happy: online -> disabled, saves and logs status change', async () => {
      const device = {
        id: 'dev-1',
        status: 'online',
        healthStatus: 'healthy',
        lastSeenAt: new Date('2026-06-15T00:00:00Z'),
        roomId: 'room-1',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.disable('user-id', 'dev-1');

      expect(queryRunnerMock.startTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logDeviceStatusChange).toHaveBeenCalledTimes(1);
      expect(auditRepoMock.logDeviceStatusChange).toHaveBeenCalledWith(
        queryRunnerMock.manager,
        expect.objectContaining({
          action: 'disable',
          oldStatus: 'online',
          newStatus: 'disabled',
        }),
      );
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
      expect(result.status).toBe('disabled');
    });

    it('T2 idempotent: already disabled -> no-op, no transaction/audit', async () => {
      const device = { id: 'dev-1', status: 'disabled' };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      const result = await service.disable('user-id', 'dev-1');

      expect(result).toEqual(device);
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
      expect(queryRunnerMock.manager.save).not.toHaveBeenCalled();
      expect(auditRepoMock.logDeviceStatusChange).not.toHaveBeenCalled();
    });

    it('T3 not found: device missing -> NotFoundException', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.disable('user-id', 'dev-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('T4 does not touch health/last_seen/room', async () => {
      const lastSeen = new Date('2026-06-15T00:00:00Z');
      const device = {
        id: 'dev-1',
        status: 'online',
        healthStatus: 'healthy',
        lastSeenAt: lastSeen,
        roomId: 'room-1',
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.disable('user-id', 'dev-1');

      expect(result.status).toBe('disabled');
      expect(result.healthStatus).toBe('healthy');
      expect(result.lastSeenAt).toBe(lastSeen);
      expect(result.roomId).toBe('room-1');
    });

    it('T5 rollback: audit failure rolls back transaction', async () => {
      const device = { id: 'dev-1', status: 'online' };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );
      (auditRepoMock.logDeviceStatusChange as jest.Mock).mockRejectedValue(
        new Error('DB Error'),
      );

      await expect(service.disable('user-id', 'dev-1')).rejects.toThrow(
        'DB Error',
      );
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('enable', () => {
    it('T6 happy: disabled -> offline, saves and logs status change', async () => {
      const device = { id: 'dev-1', status: 'disabled' };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_entity: unknown, obj: any) => ({ ...obj }),
      );

      const result = await service.enable('user-id', 'dev-1');

      expect(queryRunnerMock.manager.save).toHaveBeenCalled();
      expect(auditRepoMock.logDeviceStatusChange).toHaveBeenCalledWith(
        queryRunnerMock.manager,
        expect.objectContaining({
          action: 'enable',
          oldStatus: 'disabled',
          newStatus: 'offline',
        }),
      );
      expect(result.status).toBe('offline');
    });

    it('T7 no-op when not disabled: online stays online, no audit', async () => {
      const device = { id: 'dev-1', status: 'online' };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);

      const result = await service.enable('user-id', 'dev-1');

      expect(result).toEqual(device);
      expect(result.status).toBe('online');
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
      expect(auditRepoMock.logDeviceStatusChange).not.toHaveBeenCalled();
    });

    it('T8 not found: device missing -> NotFoundException', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.enable('user-id', 'dev-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAll', () => {
    let qbMock: any;

    beforeEach(() => {
      qbMock = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn(),
      };
      (dataSourceMock.getRepository as jest.Mock).mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(qbMock),
      });
    });

    it('default: no filter, sort createdAt DESC, skip 0 take 20, meta correct', async () => {
      qbMock.getManyAndCount.mockResolvedValue([
        [{ id: 'd1', status: 'online' }],
        42,
      ]);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(qbMock.andWhere).not.toHaveBeenCalled();
      expect(qbMock.orderBy).toHaveBeenCalledWith('d.createdAt', 'DESC');
      expect(qbMock.skip).toHaveBeenCalledWith(0);
      expect(qbMock.take).toHaveBeenCalledWith(20);
      expect(result.meta).toEqual({
        page: 1,
        limit: 20,
        total: 42,
        totalPages: 3,
      });
      expect(result.items).toHaveLength(1);
    });

    it('status filter: andWhere status', async () => {
      qbMock.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({ page: 1, limit: 20, status: 'disabled' } as any);
      expect(qbMock.andWhere).toHaveBeenCalledWith('d.status = :status', {
        status: 'disabled',
      });
    });

    it('search: bound ILIKE on deviceName/deviceCode', async () => {
      qbMock.getManyAndCount.mockResolvedValue([[], 0]);
      await service.findAll({ page: 1, limit: 20, search: 'ipcam' });
      expect(qbMock.andWhere).toHaveBeenCalledWith(
        '(d.deviceName ILIKE :s OR d.deviceCode ILIKE :s)',
        { s: '%ipcam%' },
      );
    });

    it('page 2: skip (2-1)*20 = 20', async () => {
      qbMock.getManyAndCount.mockResolvedValue([[], 42]);
      await service.findAll({ page: 2, limit: 20 });
      expect(qbMock.skip).toHaveBeenCalledWith(20);
    });

    it('empty: total 0 -> totalPages 0', async () => {
      qbMock.getManyAndCount.mockResolvedValue([[], 0]);
      const result = await service.findAll({ page: 1, limit: 20 });
      expect(result.items).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(result.meta.totalPages).toBe(0);
    });
  });

  describe('configureRtsp (IOT-015 credential encrypt)', () => {
    const OLD_KEY = process.env.RTSP_CRED_KEY;
    beforeAll(() => {
      process.env.RTSP_CRED_KEY = 'test_rtsp_cred_key_0123456789_abcdefghij';
    });
    afterAll(() => {
      process.env.RTSP_CRED_KEY = OLD_KEY;
    });

    const rtspDto = (over: any = {}) => ({
      rtsp_protocol: 'rtsp',
      rtsp_host: '10.0.0.5',
      rtsp_port: 554,
      rtsp_path: '/live',
      ...over,
    });

    it('rtsp_password → lưu rtsp_password_encrypted (KHÔNG plaintext) + configured=true', async () => {
      const device: any = {
        id: 'dev-1',
        deviceType: IoTDeviceType.IP_CAMERA,
        roomId: 'room-1',
        metadataJson: {},
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_e: unknown, obj: any) => obj,
      );

      await service.configureRtsp(
        'user-1',
        'dev-1',
        rtspDto({ rtsp_password: 'super-secret' }),
      );

      const cfg = device.metadataJson.rtsp_config;
      expect(cfg.rtsp_password_configured).toBe(true);
      expect(typeof cfg.rtsp_password_encrypted).toBe('string');
      // KHÔNG lưu plaintext
      expect(JSON.stringify(device.metadataJson)).not.toContain('super-secret');
      expect(cfg.rtsp_password_encrypted).not.toContain('super-secret');
    });

    it('không gửi rtsp_password → carry-over encrypted + flag cũ', async () => {
      const device: any = {
        id: 'dev-1',
        deviceType: IoTDeviceType.IP_CAMERA,
        roomId: 'room-1',
        metadataJson: {
          rtsp_config: {
            rtsp_password_encrypted: 'OLD_BLOB_BASE64',
            rtsp_password_configured: true,
          },
        },
      };
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        async (_e: unknown, obj: any) => obj,
      );

      await service.configureRtsp('user-1', 'dev-1', rtspDto());

      const cfg = device.metadataJson.rtsp_config;
      expect(cfg.rtsp_password_encrypted).toBe('OLD_BLOB_BASE64');
      expect(cfg.rtsp_password_configured).toBe(true);
    });
  });

  describe('findOne', () => {
    it('happy: returns mapped response', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue({
        id: 'd1',
        deviceName: 'Cam',
        deviceCode: 'C1',
        status: 'online',
      });
      const result = await service.findOne('d1');
      expect(result.id).toBe('d1');
      expect(result.device_name).toBe('Cam');
    });

    it('404: not found -> NotFoundException', async () => {
      (dataSourceMock.manager.findOne as jest.Mock).mockResolvedValue(null);
      await expect(service.findOne('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('detectOfflineDevices', () => {
    const cam = (over: any) => ({
      id: 'c1',
      deviceCode: 'CAM-1',
      deviceName: 'Cam 1',
      deviceType: IoTDeviceType.IP_CAMERA,
      status: 'online',
      streamUrl: 'rtsp://10.0.0.1:554/live',
      ipAddress: null,
      zoneId: null,
      ...over,
    });

    /** bulkSetStatus: trả lại đúng các id được UPDATE (mô phỏng RETURNING id). */
    const echoUpdatedIds = () =>
      queryRunnerMock.manager.query.mockImplementation(
        (_sql: string, params: any[]) =>
          Promise.resolve([
            params[1].map((id: string) => ({ id })),
            params[1].length,
          ]),
      );

    /** Chạy N lượt quét liên tiếp (mô phỏng cron mỗi phút). */
    const runTimes = async (n: number) => {
      let r:
        | Awaited<ReturnType<typeof service.detectOfflineDevices>>
        | undefined;
      for (let i = 0; i < n; i++) r = await service.detectOfflineDevices(null);
      return r!;
    };

    beforeEach(() => {
      queryRunnerMock.manager.query = jest.fn();
      auditRepoMock.logDeviceStatusChanges = jest.fn();
      echoUpdatedIds();
    });

    describe('chống báo nhầm (ngưỡng 3 lần lỗi liên tiếp)', () => {
      it('lỗi lần 1, 2 → CHƯA offline (pending), lần 3 → offline', async () => {
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
          cam({ id: 'c1', status: 'online' }),
        ]);
        probeTcpMock.mockResolvedValue('offline');

        const r1 = await service.detectOfflineDevices(null);
        expect(r1.transitions).toEqual([]);
        expect(r1.pending_offline).toBe(1);
        const r2 = await service.detectOfflineDevices(null);
        expect(r2.transitions).toEqual([]);
        expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
        expect(deviceOfflineHookMock.onDevicesOffline).not.toHaveBeenCalled();

        const r3 = await service.detectOfflineDevices('actor-1');
        expect(r3.transitions).toEqual([
          { id: 'c1', from: 'online', to: 'offline' },
        ]);
        expect(auditRepoMock.logDeviceStatusChanges).toHaveBeenCalledWith(
          queryRunnerMock.manager,
          [
            expect.objectContaining({
              deviceId: 'c1',
              action: 'auto_offline',
              oldStatus: 'online',
              newStatus: 'offline',
              userId: 'actor-1',
            }),
          ],
        );
      });

      it('mạng chập chờn: lỗi → OK → lỗi → lỗi → KHÔNG offline (bộ đếm reset khi OK)', async () => {
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
          cam({ id: 'c1', status: 'online' }),
        ]);
        probeTcpMock
          .mockResolvedValueOnce('offline')
          .mockResolvedValueOnce('online')
          .mockResolvedValueOnce('offline')
          .mockResolvedValueOnce('offline');

        const r = await runTimes(4);

        expect(r.transitions).toEqual([]);
        expect(deviceOfflineHookMock.onDevicesOffline).not.toHaveBeenCalled();
        expect(deviceOfflineHookMock.onDevicesOnline).not.toHaveBeenCalled();
      });

      it('offline → online: chuyển NGAY ở lần probe OK đầu tiên', async () => {
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
          cam({ id: 'c1', status: 'offline' }),
        ]);
        probeTcpMock.mockResolvedValue('online');

        const r = await service.detectOfflineDevices(null);

        expect(r.online_count).toBe(1);
        expect(r.transitions).toEqual([
          { id: 'c1', from: 'offline', to: 'online' },
        ]);
        expect(auditRepoMock.logDeviceStatusChanges).toHaveBeenCalledWith(
          queryRunnerMock.manager,
          [expect.objectContaining({ action: 'auto_online', userId: null })],
        );
      });
    });

    it('idempotent: same status -> no transaction/audit/transition', async () => {
      (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
        cam({ id: 'c1', status: 'online' }),
      ]);
      probeTcpMock.mockResolvedValue('online');

      const r = await service.detectOfflineDevices(null);

      expect(r.checked).toBe(1);
      expect(r.online_count).toBe(1);
      expect(r.transitions).toEqual([]);
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
      expect(auditRepoMock.logDeviceStatusChanges).not.toHaveBeenCalled();
    });

    it('skip no-address camera (not counted in checked)', async () => {
      (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
        cam({ id: 'c1', status: 'online', streamUrl: null, ipAddress: null }),
      ]);

      const r = await service.detectOfflineDevices(null);

      expect(r.checked).toBe(0);
      expect(probeTcpMock).not.toHaveBeenCalled();
    });

    it('fallback ip_address:554 when no stream_url', async () => {
      (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
        cam({
          id: 'c1',
          status: 'online',
          streamUrl: null,
          ipAddress: '10.0.0.9',
        }),
      ]);
      probeTcpMock.mockResolvedValue('online');

      const r = await service.detectOfflineDevices(null);

      expect(r.checked).toBe(1);
      expect(probeTcpMock).toHaveBeenCalledWith('10.0.0.9', 554, 3000);
    });

    describe('ghi trạng thái theo lô', () => {
      it('100 camera rớt → 1 transaction, 1 UPDATE offline, 1 INSERT audit', async () => {
        const cams = Array.from({ length: 100 }, (_, i) =>
          cam({ id: `c${i}`, deviceCode: `CAM-${i}`, status: 'online' }),
        );
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue(cams);
        probeTcpMock.mockResolvedValue('offline');

        const r = await runTimes(3);

        expect(r.transitions).toHaveLength(100);
        expect(queryRunnerMock.startTransaction).toHaveBeenCalledTimes(1);
        expect(queryRunnerMock.commitTransaction).toHaveBeenCalledTimes(1);
        expect(queryRunnerMock.manager.query).toHaveBeenCalledTimes(1);
        const [sql, params] = queryRunnerMock.manager.query.mock.calls[0];
        expect(sql).toContain('UPDATE iot_devices');
        expect(params[0]).toBe('offline');
        expect(params[1]).toHaveLength(100);
        expect(params[2]).toBe('online');
        expect(auditRepoMock.logDeviceStatusChanges).toHaveBeenCalledTimes(1);
        expect(
          auditRepoMock.logDeviceStatusChanges.mock.calls[0][1],
        ).toHaveLength(100);
        expect(queryRunnerMock.manager.save).not.toHaveBeenCalled();
      });

      it('chỉ camera thật sự được UPDATE (RETURNING) mới thành transition', async () => {
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
          cam({ id: 'c1', status: 'offline' }),
          cam({ id: 'c2', status: 'offline' }),
        ]);
        probeTcpMock.mockResolvedValue('online');
        // c2 đã bị đổi status bởi luồng khác → UPDATE ... WHERE status='offline' không khớp.
        queryRunnerMock.manager.query.mockResolvedValue([[{ id: 'c1' }], 1]);

        const r = await service.detectOfflineDevices(null);

        expect(r.transitions).toEqual([
          { id: 'c1', from: 'offline', to: 'online' },
        ]);
      });

      it('DB lỗi → rollback cả lô, không transition, không gọi hook, không throw', async () => {
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
          cam({ id: 'c1', status: 'offline' }),
          cam({ id: 'c2', status: 'offline' }),
        ]);
        probeTcpMock.mockResolvedValue('online');
        queryRunnerMock.manager.query.mockRejectedValue(new Error('DB fail'));

        const r = await service.detectOfflineDevices(null);

        expect(r.checked).toBe(2);
        expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalledTimes(1);
        expect(queryRunnerMock.release).toHaveBeenCalledTimes(1);
        expect(r.transitions).toEqual([]);
        expect(deviceOfflineHookMock.onDevicesOnline).not.toHaveBeenCalled();
      });
    });

    describe('song song + chống chạy chồng', () => {
      it('mặc định probe 50 camera song song', async () => {
        const cams = Array.from({ length: 120 }, (_, i) =>
          cam({ id: `c${i}`, status: 'online' }),
        );
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue(cams);
        let inFlight = 0;
        let maxInFlight = 0;
        probeTcpMock.mockImplementation(async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((res) => setImmediate(res));
          inFlight--;
          return 'online';
        });

        const r = await service.detectOfflineDevices(null);

        expect(r.checked).toBe(120);
        expect(maxInFlight).toBe(50);
      });

      it('lượt trước chưa xong → lượt sau skipped, không probe lại', async () => {
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
          cam({ id: 'c1', status: 'online' }),
        ]);
        let release!: () => void;
        probeTcpMock.mockImplementation(
          () =>
            new Promise((res) => {
              release = () => res('online');
            }),
        );

        const first = service.detectOfflineDevices(null);
        await new Promise((res) => setImmediate(res));
        const second = await service.detectOfflineDevices(null);
        expect(second.skipped).toBe(true);
        expect(probeTcpMock).toHaveBeenCalledTimes(1);

        release();
        const r1 = await first;
        expect(r1.skipped).toBeUndefined();

        // Khóa được nhả → lượt kế tiếp chạy bình thường.
        probeTcpMock.mockResolvedValue('online');
        const third = await service.detectOfflineDevices(null);
        expect(third.skipped).toBeUndefined();
      });

      it('lượt lỗi (find throw) vẫn nhả khóa', async () => {
        (dataSourceMock.manager.find as jest.Mock)
          .mockRejectedValueOnce(new Error('db'))
          .mockResolvedValue([]);
        await expect(service.detectOfflineDevices(null)).rejects.toThrow('db');
        const r = await service.detectOfflineDevices(null);
        expect(r.skipped).toBeUndefined();
      });
    });

    describe('device offline alert hook (theo lô)', () => {
      it('online->offline (đủ ngưỡng) → gọi onDevicesOffline 1 lần với device + zoneId', async () => {
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
          cam({
            id: 'c1',
            deviceCode: 'CAM-1',
            deviceName: 'Cam 1',
            zoneId: 'z1',
          }),
          cam({
            id: 'c2',
            deviceCode: 'CAM-2',
            deviceName: 'Cam 2',
            zoneId: 'z1',
          }),
        ]);
        probeTcpMock.mockResolvedValue('offline');

        await runTimes(3);

        expect(deviceOfflineHookMock.onDevicesOffline).toHaveBeenCalledTimes(1);
        expect(deviceOfflineHookMock.onDevicesOffline).toHaveBeenCalledWith([
          expect.objectContaining({
            deviceId: 'c1',
            deviceCode: 'CAM-1',
            deviceName: 'Cam 1',
            zoneId: 'z1',
          }),
          expect.objectContaining({ deviceId: 'c2', zoneId: 'z1' }),
        ]);
      });

      it('offline->online → gọi onDevicesOnline, KHÔNG gọi onDevicesOffline', async () => {
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
          cam({ id: 'c1', status: 'offline' }),
        ]);
        probeTcpMock.mockResolvedValue('online');

        await service.detectOfflineDevices(null);

        expect(deviceOfflineHookMock.onDevicesOffline).not.toHaveBeenCalled();
        expect(deviceOfflineHookMock.onDevicesOnline).toHaveBeenCalledWith([
          expect.objectContaining({ deviceId: 'c1' }),
        ]);
      });

      it('đã offline, vẫn offline (không transition) → KHÔNG gọi hook', async () => {
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
          cam({ id: 'c1', status: 'offline' }),
        ]);
        probeTcpMock.mockResolvedValue('offline');

        await runTimes(3);

        expect(deviceOfflineHookMock.onDevicesOffline).not.toHaveBeenCalled();
      });

      it('hook offline throw → KHÔNG throw, hook online vẫn chạy, transition vẫn trả về', async () => {
        // c1 (10.0.0.1) rớt, c2 (10.0.0.2) có lại.
        probeTcpMock.mockImplementation(async (host: string) =>
          host === '10.0.0.1' ? 'offline' : 'online',
        );
        (dataSourceMock.manager.find as jest.Mock).mockResolvedValue([
          cam({ id: 'c1', status: 'online' }),
          cam({
            id: 'c2',
            status: 'offline',
            streamUrl: 'rtsp://10.0.0.2:554/x',
          }),
        ]);
        deviceOfflineHookMock.onDevicesOffline.mockRejectedValue(
          new Error('alert down'),
        );

        const r = await runTimes(3);

        expect(deviceOfflineHookMock.onDevicesOnline).toHaveBeenCalled();
        expect(r.transitions).toContainEqual({
          id: 'c1',
          from: 'online',
          to: 'offline',
        });
      });
    });
  });

  describe('receiveStrangerEvent — FR-008 strip SanpPic (SAL-001)', () => {
    it('body có SanpPic → payload_json (storeRawEvent) + recent_stranger_event_samples đều stripped', async () => {
      const token = 'tok';
      const hash = nodeCrypto.createHash('sha256').update(token).digest('hex');
      const device: any = {
        id: 'dev1',
        deviceCode: 'FACE-1',
        deviceType: IoTDeviceType.FACE_SERVER,
        roomId: 'room1',
        metadataJson: {
          face_server_config: {
            callback_enabled: true,
            callback_token_hash: hash,
          },
        },
      };
      dataSourceMock.manager.findOne.mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        (_e: unknown, obj: any) => obj,
      );

      await service.receiveStrangerEvent({
        headers: { 'x-callback-token': token },
        body: {
          stranger_id: 's1',
          SanpPic: 'data:image/jpeg;base64,/9j/4AAQSkZJRgVERYLONGBASE64DATA==',
        },
        query: {},
        params: { deviceCode: 'FACE-1' },
        clientIp: '127.0.0.1',
        files: [],
      });

      // (a) storeRawEvent.rawPayloadSample đã strip (→ payload_json)
      const eventsSvc: any = (service as any).iotDeviceEventsService;
      const callArg = eventsSvc.storeRawEvent.mock.calls[0][0];
      expect(callArg.rawPayloadSample.SanpPic).toBe('[stripped]');
      expect(JSON.stringify(callArg.rawPayloadSample)).not.toContain('base64');

      // (b) device.metadataJson.recent_stranger_event_samples cũng strip
      const samples = device.metadataJson.recent_stranger_event_samples;
      expect(samples[0].raw_payload_sample.SanpPic).toBe('[stripped]');
      expect(JSON.stringify(samples)).not.toContain('base64');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TKR-001 (#11) — revoke / rotate callback token + assertCallbackToken gate
  // ─────────────────────────────────────────────────────────────────────────
  describe('TKR-001 — assertCallbackToken gate (qua receiveVerify/StrangerEvent)', () => {
    const TOKEN = 'plain-token';
    const HASH = nodeCrypto.createHash('sha256').update(TOKEN).digest('hex');

    const faceDevice = (fsc: any): any => ({
      id: 'dev1',
      deviceCode: 'FACE-1',
      deviceType: IoTDeviceType.FACE_SERVER,
      roomId: 'room1',
      metadataJson: { face_server_config: fsc },
    });
    const callbackInput = (token: string | undefined) => ({
      headers: token ? { 'x-callback-token': token } : {},
      body: { stranger_id: 's1' },
      query: {},
      params: { deviceCode: 'FACE-1' },
      clientIp: '127.0.0.1',
      files: [],
    });

    it('chưa config token (không callback_token_hash) → 409 CALLBACK_TOKEN_NOT_CONFIGURED', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({ callback_enabled: true }),
      );
      await expect(
        service.receiveStrangerEvent(callbackInput(TOKEN)),
      ).rejects.toThrow(ConflictException);
    });

    it('token đúng + chưa revoke → PASS (tới storeRawEvent, không throw)', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({ callback_enabled: true, callback_token_hash: HASH }),
      );
      queryRunnerMock.manager.save.mockImplementation(
        (_e: unknown, obj: any) => obj,
      );
      await expect(
        service.receiveStrangerEvent(callbackInput(TOKEN)),
      ).resolves.toBeDefined();
    });

    it('token SAI → 401 INVALID_CALLBACK_TOKEN', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({ callback_enabled: true, callback_token_hash: HASH }),
      );
      await expect(
        service.receiveStrangerEvent(callbackInput('wrong-token')),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('đã revoke (revoked_at set) + token ĐÚNG → 403 CALLBACK_TOKEN_REVOKED (stranger)', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({
          callback_enabled: true,
          callback_token_hash: HASH,
          revoked_at: '2026-06-19T00:00:00.000Z',
        }),
      );
      await expect(
        service.receiveStrangerEvent(callbackInput(TOKEN)),
      ).rejects.toThrow(ForbiddenException);
    });

    it('đã revoke + token ĐÚNG → 403 (verify) — gate dùng chung cho cả 2 handler', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({
          callback_enabled: true,
          callback_token_hash: HASH,
          revoked_at: '2026-06-19T00:00:00.000Z',
        }),
      );
      await expect(
        service.receiveVerifyEvent(callbackInput(TOKEN)),
      ).rejects.toThrow(ForbiddenException);
    });

    // [FIX 2026-08-15] Incident thật: device 'a' bị chặn TOÀN BỘ verify callback nhiều giờ
    // liền vì allowed_source_ip='0.0.0.0' — code cũ so sánh chuỗi trực tiếp, '0.0.0.0'
    // không khớp bất kỳ IP thiết bị thật nào → luôn 403 SOURCE_IP_NOT_ALLOWED trước khi kịp
    // ghi iot_device_events. assertAllowedSourceIp() giờ coi '0.0.0.0' như KHÔNG giới hạn.
    describe('assertAllowedSourceIp — 0.0.0.0 phải coi là KHÔNG giới hạn (dùng chung 3 handler)', () => {
      const REAL_DEVICE_IP = '192.168.1.6'; // IP thiết bị thật, KHÔNG phải loopback.

      it('allowed_source_ip=0.0.0.0 + IP thiết bị thật (verify) → KHÔNG bị chặn (regression đúng incident hôm nay)', async () => {
        dataSourceMock.manager.findOne.mockResolvedValue(
          faceDevice({
            callback_enabled: true,
            callback_token_hash: HASH,
            allowed_source_ip: '0.0.0.0',
          }),
        );
        queryRunnerMock.manager.save.mockImplementation(
          (_e: unknown, obj: any) => obj,
        );
        await expect(
          service.receiveVerifyEvent({
            ...callbackInput(TOKEN),
            body: {
              operator: 'VerifyPush',
              info: { PersonID: 95, VerifyStatus: 1 },
            },
            clientIp: REAL_DEVICE_IP,
          }),
        ).resolves.toBeDefined();
      });

      it('allowed_source_ip=0.0.0.0 + IP thiết bị thật (stranger) → KHÔNG bị chặn', async () => {
        dataSourceMock.manager.findOne.mockResolvedValue(
          faceDevice({
            callback_enabled: true,
            callback_token_hash: HASH,
            allowed_source_ip: '0.0.0.0',
          }),
        );
        queryRunnerMock.manager.save.mockImplementation(
          (_e: unknown, obj: any) => obj,
        );
        await expect(
          service.receiveStrangerEvent({
            ...callbackInput(TOKEN),
            clientIp: REAL_DEVICE_IP,
          }),
        ).resolves.toBeDefined();
      });

      it('allowed_source_ip=0.0.0.0 (heartbeat) → KHÔNG bị chặn', async () => {
        dataSourceMock.manager.findOne.mockResolvedValue(
          faceDevice({
            callback_enabled: true,
            callback_token_hash: HASH,
            allowed_source_ip: '0.0.0.0',
          }),
        );
        queryRunnerMock.manager.save.mockImplementation(
          (_e: unknown, obj: any) => obj,
        );
        await expect(
          service.receiveHeartbeat({
            headers: { 'x-callback-token': TOKEN },
            body: { status: 'ok' },
            query: {},
            params: { deviceCode: 'FACE-1' },
            clientIp: REAL_DEVICE_IP,
          }),
        ).resolves.toBeDefined();
      });

      it('allowed_source_ip=1 IP CỤ THỂ khác + IP thiết bị không khớp → VẪN 403 (regression — chặn IP thật vẫn hoạt động, KHÔNG bị fix làm mất tác dụng)', async () => {
        dataSourceMock.manager.findOne.mockResolvedValue(
          faceDevice({
            callback_enabled: true,
            callback_token_hash: HASH,
            allowed_source_ip: '10.0.0.99',
          }),
        );
        await expect(
          service.receiveVerifyEvent({
            ...callbackInput(TOKEN),
            body: {
              operator: 'VerifyPush',
              info: { PersonID: 95, VerifyStatus: 1 },
            },
            clientIp: REAL_DEVICE_IP,
          }),
        ).rejects.toThrow(ForbiddenException);
      });

      it('allowed_source_ip=1 IP CỤ THỂ + IP thiết bị KHỚP đúng → PASS (regression)', async () => {
        dataSourceMock.manager.findOne.mockResolvedValue(
          faceDevice({
            callback_enabled: true,
            callback_token_hash: HASH,
            allowed_source_ip: REAL_DEVICE_IP,
          }),
        );
        queryRunnerMock.manager.save.mockImplementation(
          (_e: unknown, obj: any) => obj,
        );
        await expect(
          service.receiveVerifyEvent({
            ...callbackInput(TOKEN),
            body: {
              operator: 'VerifyPush',
              info: { PersonID: 95, VerifyStatus: 1 },
            },
            clientIp: REAL_DEVICE_IP,
          }),
        ).resolves.toBeDefined();
      });

      it('allowed_source_ip rỗng/không set + IP bất kỳ → PASS (regression, hành vi "không giới hạn" cũ giữ nguyên)', async () => {
        dataSourceMock.manager.findOne.mockResolvedValue(
          faceDevice({ callback_enabled: true, callback_token_hash: HASH }),
        );
        queryRunnerMock.manager.save.mockImplementation(
          (_e: unknown, obj: any) => obj,
        );
        await expect(
          service.receiveVerifyEvent({
            ...callbackInput(TOKEN),
            body: {
              operator: 'VerifyPush',
              info: { PersonID: 95, VerifyStatus: 1 },
            },
            clientIp: REAL_DEVICE_IP,
          }),
        ).resolves.toBeDefined();
      });
    });
  });

  describe('TKR-001 — configureFaceServer (route mới POST /face-server/configure)', () => {
    const validDto = {
      callback_protocol: 'https' as const,
      allowed_source_ip: '10.0.0.5',
      heartbeat_path: '/heartbeat',
      verify_path: '/verify',
      stranger_path: '/stranger',
    };
    const faceDeviceWithRoom = (over: any = {}) => ({
      id: 'dev1',
      deviceType: IoTDeviceType.FACE_SERVER,
      roomId: 'room1',
      metadataJson: {},
      ...over,
    });

    it('device chưa cấu hình, đã gán room → 200, tạo face_server_config mới, trả oneTimeCallbackToken khớp hash', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(faceDeviceWithRoom());

      const { device, oneTimeCallbackToken } =
        await service.configureFaceServer('admin1', 'dev1', validDto);

      const fsc = device.metadataJson!.face_server_config as any;
      const expectHash = nodeCrypto
        .createHash('sha256')
        .update(oneTimeCallbackToken)
        .digest('hex');
      expect(fsc.callback_token_hash).toBe(expectHash);
      expect(fsc.callback_protocol).toBe('https');
      expect(fsc.allowed_source_ip).toBe('10.0.0.5');
      expect(fsc.heartbeat_path).toBe('/heartbeat');
      expect(fsc.callback_enabled).toBe(true); // default khi DTO không truyền
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
      expect(auditRepoMock.logConfigureFaceServer).toHaveBeenCalledTimes(1);
      // SEC: audit KHÔNG chứa token/hash
      const auditArg = auditRepoMock.logConfigureFaceServer.mock.calls[0][1];
      expect(JSON.stringify(auditArg)).not.toContain(oneTimeCallbackToken);
    });

    it('device CHƯA gán room → 409 DEVICE_ROOM_ASSIGNMENT_REQUIRED', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDeviceWithRoom({ roomId: null }),
      );
      await expect(
        service.configureFaceServer('admin1', 'dev1', validDto),
      ).rejects.toMatchObject({
        response: { code: 'DEVICE_ROOM_ASSIGNMENT_REQUIRED' },
      });
    });

    it('device deviceType KHÁC face_server → 409 DEVICE_TYPE_NOT_FACE_SERVER', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDeviceWithRoom({ deviceType: IoTDeviceType.ROOM_CAMERA }),
      );
      await expect(
        service.configureFaceServer('admin1', 'dev1', validDto),
      ).rejects.toMatchObject({
        response: { code: 'DEVICE_TYPE_NOT_FACE_SERVER' },
      });
    });

    it('device KHÔNG tồn tại → 404 IOT_DEVICE_NOT_FOUND', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(null);
      await expect(
        service.configureFaceServer('admin1', 'dev1', validDto),
      ).rejects.toThrow(NotFoundException);
    });

    it('gọi CONFIGURE 2 lần liên tiếp (upsert) → lần 2 vẫn 200, face_server_config bị THAY hoàn toàn, hash lần 2 ≠ hash lần 1', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(faceDeviceWithRoom());
      const first = await service.configureFaceServer(
        'admin1',
        'dev1',
        validDto,
      );
      const fscFirst = first.device.metadataJson!.face_server_config as any;

      // Lần 2: device trong DB giờ đã có config từ lần 1 (fresh read).
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDeviceWithRoom({
          metadataJson: { face_server_config: fscFirst },
        }),
      );
      const second = await service.configureFaceServer('admin1', 'dev1', {
        ...validDto,
        allowed_source_ip: '10.0.0.9', // đổi 1 field để chứng minh ghi đè
      });
      const fscSecond = second.device.metadataJson!.face_server_config as any;

      expect(second.oneTimeCallbackToken).not.toBe(first.oneTimeCallbackToken);
      expect(fscSecond.callback_token_hash).not.toBe(
        fscFirst.callback_token_hash,
      );
      expect(fscSecond.allowed_source_ip).toBe('10.0.0.9');
      expect(auditRepoMock.logConfigureFaceServer).toHaveBeenCalledTimes(2);
    });

    it('save lỗi → rollbackTransaction + release (rethrow)', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(faceDeviceWithRoom());
      queryRunnerMock.manager.save.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.configureFaceServer('admin1', 'dev1', validDto),
      ).rejects.toThrow('db down');
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.release).toHaveBeenCalled();
    });

    it('[FIX 2026-08-16] TÁI HIỆN bug: face_server_config đã có base_url/username/password_encrypted (set qua đường khác) → configure lại (đổi callback) → 3 field đó VẪN CÒN NGUYÊN, field callback vẫn được cập nhật giá trị mới', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDeviceWithRoom({
          metadataJson: {
            face_server_config: {
              base_url: 'http://192.168.1.12',
              username: 'admin',
              password_encrypted: 'enc:xyz',
              callback_token_hash: 'old-hash',
              allowed_source_ip: '10.0.0.1',
            },
          },
        }),
      );

      const { device } = await service.configureFaceServer('admin1', 'dev1', {
        ...validDto,
        allowed_source_ip: '10.0.0.9',
      });
      const fsc = device.metadataJson!.face_server_config as any;

      // Field KHÔNG thuộc ConfigureFaceServerDto — trước fix bị xoá trắng.
      expect(fsc.base_url).toBe('http://192.168.1.12');
      expect(fsc.username).toBe('admin');
      expect(fsc.password_encrypted).toBe('enc:xyz');
      // Field callback vẫn cập nhật đúng giá trị mới, KHÔNG bị "kẹt" giá trị cũ.
      expect(fsc.allowed_source_ip).toBe('10.0.0.9');
      expect(fsc.callback_token_hash).not.toBe('old-hash');
    });

    it('[FIX 2026-08-16] TÁI HIỆN edge case: config cũ có revoked_at (đã /revoke trước đó) → configure lại → revoked_at/revoked_reason KHÔNG còn trong config mới, token mới KHÔNG bị từ chối "revoked"', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDeviceWithRoom({
          deviceCode: 'FACE-X',
          metadataJson: {
            face_server_config: {
              callback_enabled: true,
              callback_token_hash: 'old-revoked-hash',
              revoked_at: '2026-08-10T00:00:00.000Z',
              revoked_reason: 'token leaked',
            },
          },
        }),
      );

      const { device, oneTimeCallbackToken } =
        await service.configureFaceServer('admin1', 'dev1', validDto);
      const fsc = device.metadataJson!.face_server_config as any;

      expect(fsc.revoked_at).toBeUndefined();
      expect(fsc.revoked_reason).toBeUndefined();

      // Token MỚI vừa sinh phải được assertCallbackToken() CHẤP NHẬN (qua
      // receiveStrangerEvent thật, không giả lập assertCallbackToken riêng) — mock
      // findOne tiếp theo trả về ĐÚNG device vừa lưu (mô phỏng callback kế tiếp đọc
      // lại DB), clientIp loopback để không dính gate allowed_source_ip.
      dataSourceMock.manager.findOne.mockResolvedValue(device);
      queryRunnerMock.manager.save.mockImplementation(
        (_e: unknown, obj: any) => obj,
      );
      await expect(
        service.receiveStrangerEvent({
          headers: { 'x-callback-token': oneTimeCallbackToken },
          body: { stranger_id: 's1' },
          query: {},
          params: { deviceCode: 'FACE-X' },
          clientIp: '127.0.0.1',
          files: [],
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('TKR-001 — revokeFaceServerToken (T2)', () => {
    const HASH = nodeCrypto.createHash('sha256').update('x').digest('hex');
    const faceDevice = (fsc: any): any => ({
      id: 'dev1',
      deviceType: IoTDeviceType.FACE_SERVER,
      metadataJson: { face_server_config: fsc },
    });

    it('device đã config → set revoked_at + audit; reason lưu vào revoked_reason', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({ callback_enabled: true, callback_token_hash: HASH }),
      );
      const saved = await service.revokeFaceServerToken('admin1', 'dev1', {
        reason: 'token leaked',
      });
      const fsc = saved.metadataJson!.face_server_config as any;
      expect(fsc.revoked_at).toBeDefined();
      expect(fsc.revoked_reason).toBe('token leaked');
      expect(auditRepoMock.logRevokeFaceServerToken).toHaveBeenCalledTimes(1);
      const auditArg = auditRepoMock.logRevokeFaceServerToken.mock.calls[0][1];
      expect(auditArg).toMatchObject({
        deviceId: 'test-id',
        reason: 'token leaked',
      });
      // SEC: audit KHÔNG chứa token/hash
      expect(JSON.stringify(auditArg)).not.toContain(HASH);
    });

    it('idempotent: đã revoked → return 200, KHÔNG đổi revoked_at, KHÔNG save/audit', async () => {
      const original = '2026-06-01T00:00:00.000Z';
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({
          callback_enabled: true,
          callback_token_hash: HASH,
          revoked_at: original,
        }),
      );
      const out = await service.revokeFaceServerToken('admin1', 'dev1', {});
      const fsc = out.metadataJson!.face_server_config as any;
      expect(fsc.revoked_at).toBe(original);
      expect(queryRunnerMock.startTransaction).not.toHaveBeenCalled();
      expect(auditRepoMock.logRevokeFaceServerToken).not.toHaveBeenCalled();
    });

    it('chưa config (không callback_token_hash) → 409 FACE_SERVER_NOT_CONFIGURED', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({ callback_enabled: true }),
      );
      await expect(
        service.revokeFaceServerToken('admin1', 'dev1', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('device không phải face_server → ConflictException', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue({
        id: 'dev1',
        deviceType: IoTDeviceType.ROOM_CAMERA,
        metadataJson: {},
      });
      await expect(
        service.revokeFaceServerToken('admin1', 'dev1', {}),
      ).rejects.toThrow(ConflictException);
    });

    it('device không tồn tại → NotFoundException', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(null);
      await expect(
        service.revokeFaceServerToken('admin1', 'dev1', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('save lỗi → rollbackTransaction + release (rethrow)', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({ callback_enabled: true, callback_token_hash: HASH }),
      );
      queryRunnerMock.manager.save.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.revokeFaceServerToken('admin1', 'dev1', {}),
      ).rejects.toThrow('db down');
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.release).toHaveBeenCalled();
    });
  });

  describe('TKR-001 — rotateFaceServerToken (T3)', () => {
    const OLD_HASH = nodeCrypto
      .createHash('sha256')
      .update('old-token')
      .digest('hex');
    const faceDevice = (fsc: any): any => ({
      id: 'dev1',
      deviceType: IoTDeviceType.FACE_SERVER,
      metadataJson: { face_server_config: fsc },
    });

    it('token mới (hash/last4 khác cũ) + clear revoked + trả oneTimeCallbackToken + audit', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({
          callback_enabled: true,
          callback_token_hash: OLD_HASH,
          callback_token_last4: 'oldd',
          revoked_at: '2026-06-01T00:00:00.000Z',
          revoked_reason: 'leak',
        }),
      );
      const { device, oneTimeCallbackToken } =
        await service.rotateFaceServerToken('admin1', 'dev1');
      const fsc = device.metadataJson!.face_server_config as any;
      // hash mới khớp token trả về
      const expectHash = nodeCrypto
        .createHash('sha256')
        .update(oneTimeCallbackToken)
        .digest('hex');
      expect(fsc.callback_token_hash).toBe(expectHash);
      expect(fsc.callback_token_hash).not.toBe(OLD_HASH);
      // revoked cleared
      expect(fsc.revoked_at).toBeUndefined();
      expect(fsc.revoked_reason).toBeUndefined();
      // giữ field config khác
      expect(fsc.callback_enabled).toBe(true);
      expect(auditRepoMock.logRotateFaceServerToken).toHaveBeenCalledTimes(1);
      // SEC: audit KHÔNG chứa token/hash mới
      const auditArg = auditRepoMock.logRotateFaceServerToken.mock.calls[0][1];
      expect(JSON.stringify(auditArg)).not.toContain(oneTimeCallbackToken);
      expect(JSON.stringify(auditArg)).not.toContain(expectHash);
    });

    it('chưa config → 409 FACE_SERVER_NOT_CONFIGURED', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({ callback_enabled: true }),
      );
      await expect(
        service.rotateFaceServerToken('admin1', 'dev1'),
      ).rejects.toThrow(ConflictException);
    });

    it('save lỗi → rollbackTransaction + release (rethrow)', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceDevice({ callback_enabled: true, callback_token_hash: OLD_HASH }),
      );
      queryRunnerMock.manager.save.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.rotateFaceServerToken('admin1', 'dev1'),
      ).rejects.toThrow('db down');
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.release).toHaveBeenCalled();
    });
  });

  describe('TKR-001 — end-to-end: rotate → token cũ chết, token mới sống', () => {
    it('sau rotate: token CŨ → 401, token MỚI → PASS', async () => {
      const oldToken = 'old-token';
      const oldHash = nodeCrypto
        .createHash('sha256')
        .update(oldToken)
        .digest('hex');
      dataSourceMock.manager.findOne.mockResolvedValue({
        id: 'dev1',
        deviceCode: 'FACE-1',
        deviceType: IoTDeviceType.FACE_SERVER,
        roomId: 'room1',
        metadataJson: {
          face_server_config: {
            callback_enabled: true,
            callback_token_hash: oldHash,
          },
        },
      });
      const { device, oneTimeCallbackToken: newToken } =
        await service.rotateFaceServerToken('admin1', 'dev1');

      const rotatedConfig = device.metadataJson!.face_server_config as any;
      const deviceAfter = (): any => ({
        id: 'dev1',
        deviceCode: 'FACE-1',
        deviceType: IoTDeviceType.FACE_SERVER,
        roomId: 'room1',
        metadataJson: { face_server_config: { ...rotatedConfig } },
      });
      const input = (token: string) => ({
        headers: { 'x-callback-token': token },
        body: { stranger_id: 's1' },
        query: {},
        params: { deviceCode: 'FACE-1' },
        clientIp: '127.0.0.1',
        files: [],
      });

      // token CŨ → 401
      dataSourceMock.manager.findOne.mockResolvedValue(deviceAfter());
      await expect(
        service.receiveStrangerEvent(input(oldToken)),
      ).rejects.toThrow(UnauthorizedException);

      // token MỚI → PASS
      dataSourceMock.manager.findOne.mockResolvedValue(deviceAfter());
      queryRunnerMock.manager.save.mockImplementation(
        (_e: unknown, obj: any) => obj,
      );
      await expect(
        service.receiveStrangerEvent(input(newToken)),
      ).resolves.toBeDefined();
    });
  });

  // ===== A5 (IOT-005): checkAvailability nhánh ip_camera (runtime probe) =====
  describe('checkAvailability (A5)', () => {
    const probeResult = (over: any = {}) => ({
      group: 'alive',
      reasonCode: null,
      isAvailable: true,
      runtimeVerified: true,
      healthStatus: 'healthy',
      statusAction: 'set_online',
      ...over,
    });

    const camera = (over: any = {}) => ({
      id: 'cam-1',
      deviceType: IoTDeviceType.IP_CAMERA,
      roomId: 'room-1',
      streamUrl: 'rtsp://10.0.0.5:554/stream1',
      status: 'offline',
      healthStatus: 'unknown',
      lastSeenAt: null,
      metadataJson: {
        vendor: 'dahua',
        rtsp_config: { rtsp_enabled: true, rtsp_username: 'admin' },
      },
      ...over,
    });

    const lac = (result: any) => result.metadataJson.last_availability_check;

    beforeEach(() => probeRtspRuntimeMock.mockReset());

    it('AC-1: device không tồn tại → 404', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(null);
      await expect(
        service.checkAvailability('u1', 'missing'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('AC-2: device_type không phải camera → 409', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue({
        id: 'd',
        deviceType: 'gateway',
      });
      await expect(service.checkAvailability('u1', 'd')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    // ── Config-gate: KHÔNG probe ──
    it('AC-6: thiếu room → DEVICE_ROOM_ASSIGNMENT_REQUIRED, không probe', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        camera({ roomId: null }),
      );
      const r = await service.checkAvailability('u1', 'cam-1');
      expect(lac(r).reason_code).toBe('DEVICE_ROOM_ASSIGNMENT_REQUIRED');
      expect(lac(r).runtime_verified).toBe(false);
      expect(probeRtspRuntimeMock).not.toHaveBeenCalled();
    });

    it('AC-7: thiếu rtsp_config → RTSP_CONFIG_MISSING, không probe', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        camera({ metadataJson: { vendor: 'dahua' } }),
      );
      const r = await service.checkAvailability('u1', 'cam-1');
      expect(lac(r).reason_code).toBe('RTSP_CONFIG_MISSING');
      expect(probeRtspRuntimeMock).not.toHaveBeenCalled();
    });

    it('AC-8: rtsp disabled → RTSP_DISABLED, không probe', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        camera({
          metadataJson: {
            vendor: 'dahua',
            rtsp_config: { rtsp_enabled: false, rtsp_username: 'admin' },
          },
        }),
      );
      const r = await service.checkAvailability('u1', 'cam-1');
      expect(lac(r).reason_code).toBe('RTSP_DISABLED');
      expect(probeRtspRuntimeMock).not.toHaveBeenCalled();
    });

    // ── Probe taxonomy → entity mapping ──
    it('AC-9: Alive → is_available, status online, check_type rtsp_runtime_probe', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(camera());
      probeRtspRuntimeMock.mockResolvedValue(probeResult());
      const r = await service.checkAvailability('u1', 'cam-1');
      expect(probeRtspRuntimeMock).toHaveBeenCalled();
      expect(lac(r).is_available).toBe(true);
      expect(lac(r).check_type).toBe('rtsp_runtime_probe');
      expect(lac(r).runtime_verified).toBe(true);
      expect(r.status).toBe('online');
      expect(r.healthStatus).toBe('healthy');
    });

    it('AC-10/11: Unreachable/Timeout → status offline, health faulty', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(camera());
      probeRtspRuntimeMock.mockResolvedValue(
        probeResult({
          group: 'unreachable',
          reasonCode: 'RTSP_UNREACHABLE',
          isAvailable: false,
          healthStatus: 'faulty',
          statusAction: 'set_offline',
        }),
      );
      const r = await service.checkAvailability('u1', 'cam-1');
      expect(r.status).toBe('offline');
      expect(r.healthStatus).toBe('faulty');
      expect(lac(r).reason_code).toBe('RTSP_UNREACHABLE');
    });

    it('AC-12/13: Auth-fail/Not-a-stream → giữ status, health warning', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        camera({ status: 'offline' }),
      );
      probeRtspRuntimeMock.mockResolvedValue(
        probeResult({
          group: 'auth_fail',
          reasonCode: 'RTSP_AUTH_FAILED',
          isAvailable: false,
          healthStatus: 'warning',
          statusAction: 'keep',
        }),
      );
      const r = await service.checkAvailability('u1', 'cam-1');
      expect(r.status).toBe('offline'); // keep — không đổi
      expect(r.healthStatus).toBe('warning');
      expect(lac(r).reason_code).toBe('RTSP_AUTH_FAILED');
    });

    it('AC-15: persist merge — block metadata cũ (vendor/rtsp_config) còn nguyên', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(camera());
      probeRtspRuntimeMock.mockResolvedValue(probeResult());
      const r = await service.checkAvailability('u1', 'cam-1');
      expect(r.metadataJson.vendor).toBe('dahua');
      expect(r.metadataJson.rtsp_config).toBeDefined();
      expect(r.metadataJson.last_availability_check).toBeDefined();
    });

    it('AC-14: message cố định, KHÔNG chứa URL/credential/stderr', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(camera());
      probeRtspRuntimeMock.mockResolvedValue(
        probeResult({
          group: 'auth_fail',
          reasonCode: 'RTSP_AUTH_FAILED',
          isAvailable: false,
          healthStatus: 'warning',
          statusAction: 'keep',
        }),
      );
      const r = await service.checkAvailability('u1', 'cam-1');
      const serialized = JSON.stringify(lac(r));
      expect(serialized).not.toContain('rtsp://');
      expect(serialized).not.toContain('10.0.0.5');
      expect(lac(r).message).toBe(
        'RTSP authentication failed. Check the configured username/password.',
      );
    });

    // ── Không hồi quy face_server (AC-3,4,5) ──
    const faceServer = (over: any = {}) => ({
      id: 'fs-1',
      deviceType: IoTDeviceType.FACE_SERVER,
      status: 'offline',
      healthStatus: 'unknown',
      lastSeenAt: null,
      metadataJson: {},
      ...over,
    });

    it('AC-3: face online (heartbeat ≤5p) → status online, healthy — KHÔNG probe', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceServer({ lastSeenAt: new Date() }),
      );
      const r = await service.checkAvailability('u1', 'fs-1');
      expect(r.status).toBe('online');
      expect(r.healthStatus).toBe('healthy');
      expect(lac(r).check_type).toBe('heartbeat_status');
      expect(probeRtspRuntimeMock).not.toHaveBeenCalled();
    });

    it('AC-4: face offline (heartbeat >5p) → offline, faulty, HEARTBEAT_STALE', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        faceServer({ lastSeenAt: new Date(Date.now() - 10 * 60 * 1000) }),
      );
      const r = await service.checkAvailability('u1', 'fs-1');
      expect(r.status).toBe('offline');
      expect(r.healthStatus).toBe('faulty');
      expect(lac(r).reason_code).toBe('HEARTBEAT_STALE');
    });

    it('AC-5: face chưa từng on → HEARTBEAT_NOT_SEEN', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(faceServer());
      const r = await service.checkAvailability('u1', 'fs-1');
      expect(lac(r).reason_code).toBe('HEARTBEAT_NOT_SEEN');
    });
  });

  describe('getStatusSummary', () => {
    const makeQb = (rows: any[]) => ({
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(rows),
    });

    it('tổng hợp total/online/offline/unknown + byType', async () => {
      const statusQb = makeQb([
        { status: 'online', count: '3' },
        { status: 'offline', count: '2' },
        { status: 'disabled', count: '1' },
      ]);
      const typeQb = makeQb([
        { type: 'ip_camera', count: '4' },
        { type: 'face_server', count: '2' },
      ]);
      (dataSourceMock.getRepository as jest.Mock).mockReturnValue({
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(statusQb)
          .mockReturnValueOnce(typeQb),
      });

      const r = await service.getStatusSummary();
      expect(r).toEqual({
        total: 6,
        online: 3,
        offline: 2,
        disabled: 1,
        maintenance: 0,
        unknown: 0, // disabled giờ tách riêng, không còn lẫn vào unknown
        byType: { ip_camera: 4, face_server: 2 },
      });
    });

    it('DB rỗng → tất cả 0, byType {}', async () => {
      (dataSourceMock.getRepository as jest.Mock).mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue(makeQb([])),
      });
      const r = await service.getStatusSummary();
      expect(r).toEqual({
        total: 0,
        online: 0,
        offline: 0,
        disabled: 0,
        maintenance: 0,
        unknown: 0,
        byType: {},
      });
    });
  });

  // ── ZND-001 / UC-92: API đọc cho module `zones` ──
  describe('countByZoneId (ZND-001 / UC-92)', () => {
    it('đếm theo zone_id, không lọc status/deletedAt', async () => {
      (dataSourceMock.manager.count as jest.Mock).mockResolvedValue(3);

      const result = await service.countByZoneId('z1');

      expect(result).toBe(3);
      expect(dataSourceMock.manager.count).toHaveBeenCalledWith(
        IoTDeviceEntity,
        { where: { zoneId: 'z1' } },
      );
    });

    it('zone không có thiết bị → 0', async () => {
      (dataSourceMock.manager.count as jest.Mock).mockResolvedValue(0);

      await expect(service.countByZoneId('z-empty')).resolves.toBe(0);
    });
  });

  // ── ZNA-001 / UC-94: API đọc + GHI cho module `zones` ──
  describe('findAssignableByIds / setZoneForDevices (ZNA-001 / UC-94)', () => {
    // Case 28
    it('findAssignableByIds → manager.find(IoTDeviceEntity, { where: { id: In(ids) } })', async () => {
      const devices = [{ id: 'd1' }, { id: 'd2' }];
      (dataSourceMock.manager.find as jest.Mock).mockResolvedValue(devices);

      const r = await service.findAssignableByIds(['d1', 'd2']);

      expect(r).toBe(devices);
      expect(dataSourceMock.manager.find).toHaveBeenCalledWith(
        IoTDeviceEntity,
        { where: { id: In(['d1', 'd2']) } },
      );
    });

    // Case 29 — CÓ manager: chạy trong transaction của caller, KHÔNG tự mở tx
    it('setZoneForDevices CÓ manager → dùng manager.update, KHÔNG createQueryRunner', async () => {
      const managerMock = {
        update: jest.fn().mockResolvedValue({ affected: 2 }),
      };

      const r = await service.setZoneForDevices(
        ['d1', 'd2'],
        'z1',
        managerMock as any,
      );

      expect(r).toEqual({ affected: 2 });
      expect(managerMock.update).toHaveBeenCalledWith(
        IoTDeviceEntity,
        { id: In(['d1', 'd2']) },
        { zoneId: 'z1' },
      );
      // Bằng chứng ranh giới transaction do caller kiểm soát:
      expect(dataSourceMock.createQueryRunner).not.toHaveBeenCalled();
      expect(dataSourceMock.manager.update).not.toHaveBeenCalled();
    });

    // Case 30 — KHÔNG manager: chạy standalone
    it('setZoneForDevices KHÔNG manager → dùng dataSource.manager.update', async () => {
      (dataSourceMock.manager.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      const r = await service.setZoneForDevices(['d1'], 'z1');

      expect(r).toEqual({ affected: 1 });
      expect(dataSourceMock.manager.update).toHaveBeenCalledWith(
        IoTDeviceEntity,
        { id: In(['d1']) },
        { zoneId: 'z1' },
      );
      expect(dataSourceMock.createQueryRunner).not.toHaveBeenCalled();
    });

    // Case 31 — nhánh gỡ
    it('setZoneForDevices(ids, null, m) → update với { zoneId: null }', async () => {
      const managerMock = {
        update: jest.fn().mockResolvedValue({ affected: 1 }),
      };

      await service.setZoneForDevices(['d1'], null, managerMock as any);

      expect(managerMock.update).toHaveBeenCalledWith(
        IoTDeviceEntity,
        { id: In(['d1']) },
        { zoneId: null },
      );
    });
  });

  // ── IAC-001 (UC-96): configureAiConfig ──
  describe('configureAiConfig (IAC-001 / UC-96)', () => {
    const dev = (metadataJson: any = null, type = IoTDeviceType.IP_CAMERA) =>
      ({ id: 'dev-1', deviceType: type, metadataJson }) as any;

    it('MERGE giữ cờ kia: gửi people_counting, face/plate cũ giữ nguyên', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        dev({ ai_config: { face_recognition: true, plate_recognition: true } }),
      );
      await service.configureAiConfig('u1', 'dev-1', { peopleCounting: false });

      const saved = queryRunnerMock.manager.save.mock.calls[0][1];
      expect(saved.metadataJson.ai_config).toMatchObject({
        face_recognition: true,
        plate_recognition: true,
        people_counting: false,
      });
      expect(saved.metadataJson.ai_config.configured_at).toBeDefined();
      expect(auditRepoMock.logConfigureAi).toHaveBeenCalledTimes(1);
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    });

    it('absent ≠ false: gửi 1 cờ khi chưa có ai_config → 2 cờ kia VẮNG MẶT (không auto-false)', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(dev(null));
      await service.configureAiConfig('u1', 'dev-1', { faceRecognition: true });

      const saved = queryRunnerMock.manager.save.mock.calls[0][1];
      expect(saved.metadataJson.ai_config.face_recognition).toBe(true);
      expect('plate_recognition' in saved.metadataJson.ai_config).toBe(false);
      expect('people_counting' in saved.metadataJson.ai_config).toBe(false);
    });

    it('KHÔNG đụng khoá khác của metadata_json (rtsp_config/face_server_config nguyên vẹn)', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        dev({ rtsp_config: { x: 1 }, face_server_config: { y: 2 } }),
      );
      await service.configureAiConfig('u1', 'dev-1', { faceRecognition: true });

      const saved = queryRunnerMock.manager.save.mock.calls[0][1];
      expect(saved.metadataJson.rtsp_config).toEqual({ x: 1 });
      expect(saved.metadataJson.face_server_config).toEqual({ y: 2 });
      expect(saved.metadataJson.ai_config.face_recognition).toBe(true);
    });

    it('⭐ no-op body rỗng {}: KHÔNG save/audit/createQueryRunner, configured_at KHÔNG đổi', async () => {
      const device = dev({
        ai_config: { face_recognition: true, configured_at: 'OLD' },
      });
      dataSourceMock.manager.findOne.mockResolvedValue(device);
      const r = await service.configureAiConfig('u1', 'dev-1', {});

      expect(queryRunnerMock.manager.save).not.toHaveBeenCalled();
      expect(auditRepoMock.logConfigureAi).not.toHaveBeenCalled();
      expect(dataSourceMock.createQueryRunner).not.toHaveBeenCalled();
      expect(r.metadataJson.ai_config.configured_at).toBe('OLD');
    });

    it('⭐ no-op cờ trùng giá trị hiện tại: KHÔNG save/audit/transaction', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        dev({ ai_config: { face_recognition: true, configured_at: 'OLD' } }),
      );
      await service.configureAiConfig('u1', 'dev-1', { faceRecognition: true });

      expect(queryRunnerMock.manager.save).not.toHaveBeenCalled();
      expect(auditRepoMock.logConfigureAi).not.toHaveBeenCalled();
      expect(dataSourceMock.createQueryRunner).not.toHaveBeenCalled();
    });

    it('đổi thật → transaction: save + logConfigureAi + commit, configured_at mới', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        dev({ ai_config: { face_recognition: true, configured_at: 'OLD' } }),
      );
      await service.configureAiConfig('u1', 'dev-1', {
        faceRecognition: false,
      });

      const saved = queryRunnerMock.manager.save.mock.calls[0][1];
      expect(saved.metadataJson.ai_config.face_recognition).toBe(false);
      expect(saved.metadataJson.ai_config.configured_at).not.toBe('OLD');
      expect(auditRepoMock.logConfigureAi).toHaveBeenCalledTimes(1);
      expect(queryRunnerMock.commitTransaction).toHaveBeenCalled();
    });

    it('device type ngoài allowlist (MICROPHONE) → 409, KHÔNG save', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        dev(null, IoTDeviceType.MICROPHONE),
      );
      await expect(
        service.configureAiConfig('u1', 'dev-1', { faceRecognition: true }),
      ).rejects.toMatchObject({
        response: { code: 'DEVICE_TYPE_NOT_AI_CAPABLE' },
      });
      expect(queryRunnerMock.manager.save).not.toHaveBeenCalled();
    });

    it('device không tồn tại → 404', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(null);
      await expect(
        service.configureAiConfig('u1', 'dev-1', { faceRecognition: true }),
      ).rejects.toMatchObject({ response: { code: 'IOT_DEVICE_NOT_FOUND' } });
    });

    it('finally release(): save ném → rollback + release', async () => {
      dataSourceMock.manager.findOne.mockResolvedValue(
        dev({ ai_config: { face_recognition: true } }),
      );
      queryRunnerMock.manager.save.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.configureAiConfig('u1', 'dev-1', { faceRecognition: false }),
      ).rejects.toThrow('db down');
      expect(queryRunnerMock.rollbackTransaction).toHaveBeenCalled();
      expect(queryRunnerMock.release).toHaveBeenCalled();
    });

    it('allowlist: OCCUPANCY_SENSOR và FACE_SERVER đều qua type-check (không 409)', async () => {
      for (const t of [
        IoTDeviceType.OCCUPANCY_SENSOR,
        IoTDeviceType.FACE_SERVER,
      ]) {
        dataSourceMock.manager.findOne.mockResolvedValue(dev(null, t));
        await expect(
          service.configureAiConfig('u1', 'dev-1', { peopleCounting: true }),
        ).resolves.toBeDefined();
      }
    });
  });
});
