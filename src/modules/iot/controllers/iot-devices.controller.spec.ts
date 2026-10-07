/* eslint-disable @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-member-access */
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { IotDevicesController } from './iot-devices.controller.js';
import { IotDevicesService } from '../services/iot-devices.service.js';
import { DeviceConnectionHistoryService } from '../services/device-connection-history.service.js';
import { CameraSettingsService } from '../services/camera-settings.service.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { PERMISSIONS_KEY } from '../../auth/decorators/require-permissions.decorator.js';

describe('IotDevicesController — check-availability (A5)', () => {
  let controller: IotDevicesController;
  let service: {
    checkAvailability: jest.Mock;
    configureAiConfig: jest.Mock;
    configureFaceServer: jest.Mock;
  };
  let reflector: Reflector;

  const deviceEntity = (over: any = {}): any => ({
    id: 'cam-1',
    deviceName: 'Cam 1',
    deviceCode: 'CAM-01',
    deviceType: 'ip_camera',
    roomId: 'room-1',
    ipAddress: null,
    macAddress: null,
    status: 'online',
    healthStatus: 'healthy',
    lastSeenAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    metadataJson: {
      vendor: 'dahua',
      rtsp_config: { rtsp_password_encrypted: 'enc-secret' },
      last_availability_check: {
        is_available: true,
        check_type: 'rtsp_runtime_probe',
        runtime_verified: true,
        reason_code: null,
        message: 'ok',
        checked_at: '2026-06-30T10:00:00.000Z',
        checked_by: 'actor-1',
      },
    },
    ...over,
  });

  beforeEach(async () => {
    service = {
      checkAvailability: jest.fn(),
      configureAiConfig: jest.fn(),
      configureFaceServer: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IotDevicesController],
      providers: [
        { provide: IotDevicesService, useValue: service },
        { provide: DeviceConnectionHistoryService, useValue: {} },
        { provide: CameraSettingsService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(IotDevicesController);
    reflector = new Reflector();
  });

  it('gọi service.checkAvailability(userId, id) + envelope + availability không có checked_by', async () => {
    service.checkAvailability.mockResolvedValue(deviceEntity());

    const res: any = await controller.checkAvailability('cam-1', {
      userId: 'actor-1',
    });

    expect(service.checkAvailability).toHaveBeenCalledWith('actor-1', 'cam-1');
    expect(res.success).toBe(true);
    expect(res.message).toBe('Camera availability checked successfully');
    // availability object có dữ liệu probe nhưng KHÔNG có checked_by (AC-14)
    expect(res.data.availability).toBeDefined();
    expect(res.data.availability.is_available).toBe(true);
    expect(res.data.availability).not.toHaveProperty('checked_by');
    // checked_by cũng bị xóa khỏi metadata_json passthrough
    expect(res.data.metadata_json.last_availability_check).not.toHaveProperty(
      'checked_by',
    );
  });

  it('AC-14: response mask secret — rtsp_password_encrypted không lộ plaintext', async () => {
    service.checkAvailability.mockResolvedValue(deviceEntity());
    const res: any = await controller.checkAvailability('cam-1', {
      userId: 'actor-1',
    });
    expect(res.data.metadata_json.rtsp_config.rtsp_password_encrypted).toBe(
      '***',
    );
    expect(JSON.stringify(res.data)).not.toContain('enc-secret');
  });

  it('AC-10: metadata @RequirePermissions = iot.device.check_availability', () => {
    const perms = reflector.get<string[]>(
      PERMISSIONS_KEY,
      controller.checkAvailability,
    );
    expect(perms).toEqual(['iot.device.check_availability']);
  });

  // ── IAC-001 (UC-96): PATCH :id/ai-config ──
  it('UC-96: gọi service.configureAiConfig(userId, id, dto) + envelope', async () => {
    service.configureAiConfig.mockResolvedValue(deviceEntity());
    const res: any = await controller.configureAiConfig(
      { userId: 'actor-1' },
      'cam-1',
      { faceRecognition: true },
    );
    expect(service.configureAiConfig).toHaveBeenCalledWith('actor-1', 'cam-1', {
      faceRecognition: true,
    });
    expect(res.success).toBe(true);
    expect(res.message).toBe('AI configuration updated successfully');
    expect(res.data).toBeDefined();
  });

  it('UC-96: metadata @RequirePermissions = iot.device.configure_ai', () => {
    const perms = reflector.get<string[]>(
      PERMISSIONS_KEY,
      controller.configureAiConfig,
    );
    expect(perms).toEqual(['iot.device.configure_ai']);
  });

  // ── TKR-001: POST :id/face-server/configure ──
  describe('configureFaceServer', () => {
    const configuredDevice = (): any => ({
      ...deviceEntity(),
      deviceType: 'face_server',
      metadataJson: {
        face_server_config: {
          callback_enabled: true,
          callback_protocol: 'https',
          allowed_source_ip: '10.0.0.5',
          heartbeat_path: '/heartbeat',
          verify_path: '/verify',
          stranger_path: '/stranger',
          callback_token_hash: 'abc123def456realhashvaluethatmustneverleak',
          callback_token_last4: 'z9y8',
          configured_at: '2026-08-12T00:00:00.000Z',
        },
      },
    });
    const dto = {
      callback_protocol: 'https' as const,
      allowed_source_ip: '10.0.0.5',
      heartbeat_path: '/heartbeat',
      verify_path: '/verify',
      stranger_path: '/stranger',
    };

    it('gọi service.configureFaceServer(userId, id, dto) + envelope { device, oneTimeCallbackToken }', async () => {
      service.configureFaceServer.mockResolvedValue({
        device: configuredDevice(),
        oneTimeCallbackToken: 'plaintext-token-shown-once',
      });

      const res: any = await controller.configureFaceServer(
        { user: { userId: 'actor-1' } },
        'face-1',
        dto,
      );

      expect(service.configureFaceServer).toHaveBeenCalledWith(
        'actor-1',
        'face-1',
        dto,
      );
      expect(res.success).toBe(true);
      expect(res.message).toBe('Face server configured successfully');
      expect(res.data.one_time_callback_token).toBe(
        'plaintext-token-shown-once',
      );
      expect(res.data.device).toBeDefined();
    });

    it('response device.metadata_json KHÔNG lộ callback_token_hash (mask "***", token thật CHỈ ở one_time_callback_token)', async () => {
      service.configureFaceServer.mockResolvedValue({
        device: configuredDevice(),
        oneTimeCallbackToken: 'plaintext-token-shown-once',
      });

      const res: any = await controller.configureFaceServer(
        { user: { userId: 'actor-1' } },
        'face-1',
        dto,
      );

      expect(
        res.data.device.metadata_json.face_server_config.callback_token_hash,
      ).toBe('***');
      expect(
        res.data.device.metadata_json.face_server_config.callback_token_last4,
      ).toBe('***');
      expect(JSON.stringify(res.data.device)).not.toContain(
        'abc123def456realhashvaluethatmustneverleak',
      );
    });

    it('metadata @RequirePermissions = iot_devices:configure_face_server', () => {
      const perms = reflector.get<string[]>(
        PERMISSIONS_KEY,
        controller.configureFaceServer,
      );
      expect(perms).toEqual(['iot_devices:configure_face_server']);
    });
  });
});
