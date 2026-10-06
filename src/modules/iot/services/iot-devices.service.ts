import {
  Injectable,
  Inject,
  Optional,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { DataSource, Not, In, type EntityManager } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { FACE_VERIFY_HOOK } from '../../../common/ports/face-verify-hook.js';
import type { FaceVerifyHook } from '../../../common/ports/face-verify-hook.js';
import { STRANGER_ALERT_HOOK } from '../../../common/ports/stranger-alert-hook.js';
import type { StrangerAlertHook } from '../../../common/ports/stranger-alert-hook.js';
import { DEVICE_OFFLINE_ALERT_HOOK } from '../../../common/ports/device-offline-alert-hook.js';
import type { DeviceOfflineAlertHook } from '../../../common/ports/device-offline-alert-hook.js';
import * as crypto from 'crypto';
import { probeTcp } from '../utils/rtsp-probe.util.js';
import {
  parseVerifyPayload,
  stripSanpPic,
} from '../utils/face-verify-payload.util.js';
import {
  encryptSecret,
  decryptSecret,
} from '../../../common/utils/secret-crypto.util.js';
import { probeRtspRuntime } from '../utils/rtsp-runtime-probe.util.js';
import { redactUrl } from '../../recording/utils/ffmpeg.util.js';
import {
  IoTDeviceEntity,
  IoTDeviceType,
  IoTDeviceStatus,
  IoTDeviceHealthStatus,
} from '../entities/iot-device.entity.js';
import { CreateIotDeviceDto } from '../dto/create-iot-device.dto.js';
import { UpdateIotDeviceDto } from '../dto/update-iot-device.dto.js';
import { ListIotDevicesQueryDto } from '../dto/list-iot-devices-query.dto.js';
import { AssignRoomDto } from '../dto/assign-room.dto.js';
import {
  toIotDeviceResponse,
  IotDeviceResponseDto,
} from '../dto/iot-device-response.dto.js';
import { ConfigureFaceServerDto } from '../dto/configure-face-server.dto.js';
import { RevokeFaceServerTokenDto } from '../dto/revoke-face-server-token.dto.js';
import { ConfigureRtspDto } from '../dto/configure-rtsp.dto.js';
import { ConfigureAiConfigDto } from '../dto/configure-ai-config.dto.js';
import { AI_CONFIGURABLE_DEVICE_TYPES } from '../constants/ai-configurable-device-types.constant.js';
import { IotAuditRepository } from '../repositories/iot-audit.repository.js';
import { maskSensitiveMetadata } from '../../../common/utils/masking.util.js';
import { IotDeviceEventsService } from './iot-device-events.service.js';

export interface HeartbeatInput {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, any> | null;
  query: Record<string, string | undefined>;
  params?: Record<string, string | undefined>;
  clientIp: string | undefined;
}

export interface VerifyEventInput {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, any> | null;
  query: Record<string, string | undefined>;
  params?: Record<string, string | undefined>;
  clientIp: string | undefined;
  files?: any[];
}

export interface StrangerEventInput {
  headers: Record<string, string | string[] | undefined>;
  body: Record<string, any> | null;
  query: Record<string, string | undefined>;
  params?: Record<string, string | undefined>;
  clientIp: string | undefined;
  files?: any[];
}

@Injectable()
export class IotDevicesService {
  private static readonly PROBE_CONCURRENCY = 10;

  constructor(
    private readonly dataSource: DataSource,
    private readonly iotAuditRepository: IotAuditRepository,
    private readonly iotDeviceEventsService: IotDeviceEventsService,
    private readonly configService: ConfigService,
    // FAT-001 (NC-4): hook attendance, optional để verify callback không phụ thuộc.
    @Optional()
    @Inject(FACE_VERIFY_HOOK)
    private readonly faceVerifyHook?: FaceVerifyHook,
    // SAL-001 (#20): hook cảnh báo stranger, optional (không phụ thuộc face-access).
    @Optional()
    @Inject(STRANGER_ALERT_HOOK)
    private readonly strangerAlertHook?: StrangerAlertHook,
    // Hook cảnh báo camera online → offline, optional (không phụ thuộc alerts).
    @Optional()
    @Inject(DEVICE_OFFLINE_ALERT_HOOK)
    private readonly deviceOfflineAlertHook?: DeviceOfflineAlertHook,
  ) {}

  async create(
    userId: string | null,
    dto: CreateIotDeviceDto,
  ): Promise<IoTDeviceEntity> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingCode = await queryRunner.manager.findOne(IoTDeviceEntity, {
        where: { deviceCode: dto.deviceCode },
      });

      if (existingCode) {
        throw new ConflictException({
          code: 'DEVICE_CODE_EXISTS',
          message: 'Device code already exists in the system.',
        });
      }

      if (dto.macAddress) {
        const existingMac = await queryRunner.manager.findOne(IoTDeviceEntity, {
          where: { macAddress: dto.macAddress },
        });

        if (existingMac) {
          throw new ConflictException({
            code: 'MAC_ADDRESS_EXISTS',
            message: 'MAC address already exists in the system.',
          });
        }
      }

      const newDevice = queryRunner.manager.create(IoTDeviceEntity, {
        deviceName: dto.deviceName,
        deviceCode: dto.deviceCode,
        deviceType: dto.deviceType,
        ipAddress: dto.ipAddress || null,
        macAddress: dto.macAddress || null,
        metadataJson: dto.metadataJson || null,
        status: IoTDeviceStatus.OFFLINE,
        healthStatus: IoTDeviceHealthStatus.UNKNOWN,
        lastSeenAt: null,
      });

      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        newDevice,
      );

      let createdByName: string | null = null;
      if (userId) {
        const userRow = (await queryRunner.query(
          'SELECT full_name FROM users WHERE id = $1',
          [userId],
        )) as Array<{ full_name: string }>;
        if (userRow && userRow.length > 0) {
          createdByName = userRow[0].full_name;
        }
      }

      await this.iotAuditRepository.logDeviceCreation(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        metadataJson: savedDevice.metadataJson,
      });

      await queryRunner.commitTransaction();

      // Attach dynamic property so the presenter can use it
      Object.assign(savedDevice, { createdByName });

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async update(
    userId: string | null,
    deviceId: string,
    dto: UpdateIotDeviceDto,
  ): Promise<IoTDeviceEntity> {
    // 1. Load device (404 nếu không có)
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    // 2. Build updates: chỉ nạp field hiện diện trong payload (!== undefined).
    //    Phân biệt "không gửi" (undefined) vs "gửi null" (xóa = set NULL).
    const updates: Partial<
      Pick<
        IoTDeviceEntity,
        'deviceName' | 'ipAddress' | 'macAddress' | 'networkIdentifier'
      >
    > = {};
    if (dto.deviceName !== undefined) updates.deviceName = dto.deviceName;
    if (dto.ipAddress !== undefined) updates.ipAddress = dto.ipAddress;
    if (dto.macAddress !== undefined) updates.macAddress = dto.macAddress;
    if (dto.networkIdentifier !== undefined)
      updates.networkIdentifier = dto.networkIdentifier;

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException({
        code: 'NO_UPDATABLE_FIELDS',
        message: 'No updatable fields were provided.',
      });
    }

    // 3. MAC unique (khi có gửi, khác null và khác giá trị hiện tại) — loại trừ chính nó.
    if (
      updates.macAddress !== undefined &&
      updates.macAddress !== null &&
      updates.macAddress !== device.macAddress
    ) {
      const existingMac = await this.dataSource.manager.findOne(
        IoTDeviceEntity,
        { where: { macAddress: updates.macAddress, id: Not(deviceId) } },
      );

      if (existingMac) {
        throw new ConflictException({
          code: 'MAC_ADDRESS_EXISTS',
          message: 'MAC address already exists in the system.',
        });
      }
    }

    // 4. Idempotent: chỉ giữ field thực sự đổi giá trị.
    const changes: Record<string, { old: unknown; new: unknown }> = {};
    (Object.keys(updates) as (keyof typeof updates)[]).forEach((key) => {
      const newVal = updates[key];
      const oldVal = device[key];
      if (newVal !== oldVal) {
        changes[key] = { old: oldVal ?? null, new: newVal ?? null };
      }
    });

    if (Object.keys(changes).length === 0) {
      // Không có thay đổi thực → 200, không ghi DB, không audit.
      return device;
    }

    // 5. Transaction: cập nhật device + ghi audit (KHÔNG chạm status/health/last_seen).
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      Object.assign(device, updates);

      // [FIX 2026-08-16] IP đổi qua UI Device Management (route PATCH cơ bản này) chỉ
      // cập nhật cột ip_address, KHÔNG đụng metadata_json — trong khi
      // FaceDeviceProviderFactory.create() ưu tiên đọc face_server_config.base_url
      // TRƯỚC ip_address (chỉ fallback khi base_url null/undefined, xem
      // face-device-provider.factory.ts:36-37). Nếu base_url cũ còn đó (IP cũ), mọi
      // lệnh gọi FaceGate sau khi đổi IP sẽ kết nối SAI địa chỉ → timeout.
      // Null hoá base_url để factory tự fallback sang ip_address MỚI — CHỈ khi
      // changes.ipAddress tồn tại (IP THỰC SỰ đổi giá trị, không phải chỉ có mặt
      // trong payload — FE luôn gửi ip_address ở mọi lần submit Edit kể cả khi
      // không đổi IP, nên KHÔNG được dùng dto.ipAddress !== undefined ở đây).
      if (changes.ipAddress) {
        const cfg = device.metadataJson?.['face_server_config'] as
          | Record<string, unknown>
          | undefined;
        if (cfg?.base_url) {
          device.metadataJson = {
            ...device.metadataJson,
            face_server_config: { ...cfg, base_url: null },
          };
        }
      }

      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );

      await this.iotAuditRepository.logDeviceUpdate(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        changes,
      });

      await queryRunner.commitTransaction();

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Đếm số thiết bị đang gán vào một zone.
   *
   * API đọc phục vụ UC-92 của module `zones` (kiểm tra trước khi xoá zone) — `iot` KHÔNG
   * biết gì về nghiệp vụ zone, chỉ trả con số. Module `zones` gọi qua service này thay vì
   * query thẳng bảng `iot_devices` (ARCH-01).
   *
   * Đếm MỌI thiết bị bất kể `status`: thiết bị `disabled`/`offline` vẫn là cấu hình đang trỏ
   * vào zone, xoá zone sẽ để lại tham chiếu treo. `IoTDeviceEntity` không có soft-delete nên
   * không cần lọc `deleted_at`.
   */
  async countByZoneId(zoneId: string): Promise<number> {
    return this.dataSource.manager.count(IoTDeviceEntity, {
      where: { zoneId },
    });
  }

  /**
   * Tìm thiết bị theo danh sách id — API đọc phục vụ UC-94 của module `zones`.
   *
   * Trả về ĐÚNG những gì tìm thấy (không ném lỗi khi thiếu): caller tự so sánh để biết id nào
   * không tồn tại. Trả nguyên entity (có `zoneId`, `deviceType`) để caller tự quyết định — `iot`
   * KHÔNG phán xét gì về zone.
   *
   * `IoTDeviceEntity` không có soft-delete nên không cần lọc `deleted_at`.
   *
   * ⚠ SQL `In()` TỰ KHỬ TRÙNG: truyền `[A, A, B]` chỉ trả 2 bản ghi. Caller PHẢI xác định id
   * thiếu bằng hiệu tập hợp, KHÔNG so sánh số lượng.
   */
  async findAssignableByIds(deviceIds: string[]): Promise<IoTDeviceEntity[]> {
    if (deviceIds.length === 0) return [];
    return this.dataSource.manager.find(IoTDeviceEntity, {
      where: { id: In(deviceIds) },
    });
  }

  /**
   * Liet ke thiet bi dang gan vao mot zone — API doc phuc vu UC-93 (GET /zones/:id) cua
   * module `zones`, cung ranh gioi ARCH-01 nhu `countByZoneId`/`findAssignableByIds`:
   * `zones` khong duoc query thang bang `iot_devices`.
   *
   * Nap kem relation `equipment` (FK co san `iot_devices.equipment_id`) de caller lay duoc
   * ca danh sach equipment gan voi zone ma khong phai tu mo query rieng vao bang
   * `equipments` — day la duong lien ket DUY NHAT giua zone va equipment trong schema hien
   * tai (bang `equipments` KHONG co cot `zone_id`).
   */
  async findByZoneId(zoneId: string): Promise<IoTDeviceEntity[]> {
    return this.dataSource.manager.find(IoTDeviceEntity, {
      where: { zoneId },
      relations: { equipment: true },
    });
  }

  /**
   * Đặt `zone_id` cho một tập thiết bị — API GHI phục vụ UC-94 của module `zones`.
   *
   * 1. API cho module khác: `iot` KHÔNG biết nghiệp vụ zone. `zoneId` được coi là giá trị ĐỤC —
   *    không kiểm zone tồn tại, không kiểm `status`, không kiểm soft-delete. Mọi kiểm tra về
   *    zone là trách nhiệm của CALLER.
   * 2. ⚠ RANH GIỚI TRANSACTION DO CALLER KIỂM SOÁT: khi `manager` được truyền, method chạy
   *    TRONG transaction của caller và TUYỆT ĐỐI KHÔNG tự `createQueryRunner`. Đây là điều kiện
   *    để caller giữ nguyên tử giữa "ghi zone_id" và "ghi audit". KHÁC `assignRoom` — method đó
   *    tự mở transaction riêng.
   * 3. `zoneId: string | null` — một method cho CẢ gán (`zoneId`) lẫn gỡ (`null`).
   */
  async setZoneForDevices(
    deviceIds: string[],
    zoneId: string | null,
    manager?: EntityManager,
  ): Promise<{ affected: number }> {
    if (deviceIds.length === 0) return { affected: 0 };

    const em = manager ?? this.dataSource.manager;
    const result = await em.update(
      IoTDeviceEntity,
      { id: In(deviceIds) },
      { zoneId },
    );

    return { affected: result.affected ?? 0 };
  }

  async findAll(query: ListIotDevicesQueryDto): Promise<{
    items: IotDeviceResponseDto[];
    meta: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const qb = this.dataSource
      .getRepository(IoTDeviceEntity)
      .createQueryBuilder('d');

    if (query.status) {
      qb.andWhere('d.status = :status', { status: query.status });
    }
    if (query.deviceType) {
      qb.andWhere('d.deviceType = :deviceType', {
        deviceType: query.deviceType,
      });
    }
    if (query.roomId) {
      qb.andWhere('d.roomId = :roomId', { roomId: query.roomId });
    }
    if (query.search) {
      // Bound param chống injection (NFR-002). ILIKE = không phân biệt hoa thường.
      qb.andWhere('(d.deviceName ILIKE :s OR d.deviceCode ILIKE :s)', {
        s: `%${query.search}%`,
      });
    }

    qb.orderBy('d.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();

    return {
      items: items.map((d) => toIotDeviceResponse(d)),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Tổng hợp trạng thái thiết bị cho dashboard giám sát (status-summary).
   * online/offline lấy trực tiếp theo status; unknown = phần còn lại
   * (disabled/maintenance/khác). byType đếm theo device_type.
   */
  async getStatusSummary(): Promise<{
    total: number;
    online: number;
    offline: number;
    disabled: number;
    maintenance: number;
    unknown: number;
    byType: Record<string, number>;
  }> {
    const repo = this.dataSource.getRepository(IoTDeviceEntity);

    const statusRows: Array<{ status: IoTDeviceStatus; count: string }> =
      await repo
        .createQueryBuilder('d')
        .select('d.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('d.status')
        .getRawMany();

    const typeRows: Array<{ type: string; count: string }> = await repo
      .createQueryBuilder('d')
      .select('d.deviceType', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('d.deviceType')
      .getRawMany();

    let total = 0;
    let online = 0;
    let offline = 0;
    let disabled = 0;
    let maintenance = 0;
    for (const row of statusRows) {
      const count = Number(row.count) || 0;
      total += count;
      if (row.status === IoTDeviceStatus.ONLINE) {
        online = count;
      } else if (row.status === IoTDeviceStatus.OFFLINE) {
        offline = count;
      } else if (row.status === IoTDeviceStatus.DISABLED) {
        disabled = count;
      } else if (row.status === IoTDeviceStatus.MAINTENANCE) {
        maintenance = count;
      }
    }

    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.type] = Number(row.count) || 0;
    }

    return {
      total,
      online,
      offline,
      disabled,
      maintenance,
      // FE trước đây đọc field `disabled` không tồn tại (luôn 0) vì disabled/maintenance
      // trước bị gộp chung vào unknown, không tách được — giờ tách rõ 2 field trên,
      // unknown chỉ còn là phần dư THẬT sự không khớp status nào (bình thường luôn 0).
      unknown: total - online - offline - disabled - maintenance,
      byType,
    };
  }

  async findOne(deviceId: string): Promise<IotDeviceResponseDto> {
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    return toIotDeviceResponse(device);
  }

  /**
   * IOT-014 — active TCP probe các ip_camera để maintain online↔offline.
   * Chỉ đổi cột status; transition mới ghi audit. Read các camera status ∈ {online, offline}.
   */
  async detectOfflineDevices(actorUserId: string | null): Promise<{
    checked: number;
    online_count: number;
    offline_count: number;
    transitions: Array<{ id: string; from: string; to: string }>;
  }> {
    const timeoutMs = this.configService.get<number>(
      'RTSP_PROBE_TIMEOUT_MS',
      3000,
    );

    const cameras = await this.dataSource.manager.find(IoTDeviceEntity, {
      where: {
        deviceType: IoTDeviceType.IP_CAMERA,
        status: In([IoTDeviceStatus.ONLINE, IoTDeviceStatus.OFFLINE]),
      },
    });

    // Resolve địa chỉ probe; bỏ camera không có địa chỉ hợp lệ.
    const targets: Array<{
      device: IoTDeviceEntity;
      host: string;
      port: number;
    }> = [];
    for (const device of cameras) {
      const addr = this.resolveProbeAddress(device);
      if (addr) targets.push({ device, host: addr.host, port: addr.port });
    }

    // Probe theo batch giới hạn đồng thời.
    const results: Array<{
      device: IoTDeviceEntity;
      oldStatus: IoTDeviceStatus;
      result: 'online' | 'offline';
    }> = [];
    const cap = IotDevicesService.PROBE_CONCURRENCY;
    for (let i = 0; i < targets.length; i += cap) {
      const batch = targets.slice(i, i + cap);
      await Promise.allSettled(
        batch.map((t) =>
          probeTcp(t.host, t.port, timeoutMs).then((result) => {
            results.push({
              device: t.device,
              oldStatus: t.device.status,
              result,
            });
          }),
        ),
      );
    }

    let onlineCount = 0;
    let offlineCount = 0;
    const transitions: Array<{ id: string; from: string; to: string }> = [];

    for (const r of results) {
      if (r.result === 'online') onlineCount++;
      else offlineCount++;

      const newStatus =
        r.result === 'online'
          ? IoTDeviceStatus.ONLINE
          : IoTDeviceStatus.OFFLINE;

      if (newStatus === r.oldStatus) continue; // idempotent: không transition

      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();
      try {
        r.device.status = newStatus;
        await queryRunner.manager.save(IoTDeviceEntity, r.device);
        await this.iotAuditRepository.logDeviceStatusChange(
          queryRunner.manager,
          {
            userId: actorUserId,
            deviceId: r.device.id,
            action: r.result === 'online' ? 'auto_online' : 'auto_offline',
            oldStatus: r.oldStatus,
            newStatus,
          },
        );
        await queryRunner.commitTransaction();
        transitions.push({ id: r.device.id, from: r.oldStatus, to: newStatus });
      } catch {
        // Lỗi 1 transition → rollback chính nó, KHÔNG ảnh hưởng camera khác.
        await queryRunner.rollbackTransaction();
      } finally {
        await queryRunner.release();
      }
    }

    // Cảnh báo camera vừa mất kết nối — SAU khi transition đã commit; lỗi hook KHÔNG
    // ảnh hưởng kết quả probe (đã ghi status/audit xong).
    if (this.deviceOfflineAlertHook) {
      const detectedAt = new Date();
      for (const t of transitions) {
        const goesOffline =
          t.from === (IoTDeviceStatus.ONLINE as string) &&
          t.to === (IoTDeviceStatus.OFFLINE as string);
        const goesOnline =
          t.from === (IoTDeviceStatus.OFFLINE as string) &&
          t.to === (IoTDeviceStatus.ONLINE as string);
        if (!goesOffline && !goesOnline) continue;
        const device = results.find((r) => r.device.id === t.id)?.device;
        if (!device) continue;
        const evt = {
          deviceId: device.id,
          deviceCode: device.deviceCode,
          deviceName: device.deviceName,
          zoneId: device.zoneId ?? null,
          detectedAt,
        };
        try {
          if (goesOffline) {
            await this.deviceOfflineAlertHook.onDeviceOffline(evt);
          } else {
            // Camera có tín hiệu lại → gỡ khỏi alert đang mở / đóng alert nếu hết camera rớt.
            await this.deviceOfflineAlertHook.onDeviceOnline?.(evt);
          }
        } catch (e) {
          this.logger.error(
            `device status alert hook failed (device=${device.deviceCode}): ${
              e instanceof Error ? e.message : 'unknown'
            }`,
          );
        }
      }
    }

    return {
      checked: targets.length,
      online_count: onlineCount,
      offline_count: offlineCount,
      transitions,
    };
  }

  /**
   * Parse host:port để probe: ưu tiên stream_url (rtsp://host:port/path),
   * fallback ip_address:554. Validate port nguyên 1..65535. Không hợp lệ → null (skip).
   */
  private resolveProbeAddress(
    device: IoTDeviceEntity,
  ): { host: string; port: number } | null {
    let host: string | null = null;
    let port = 554;

    if (device.streamUrl) {
      try {
        const u = new URL(device.streamUrl);
        host = u.hostname || null;
        if (u.port) port = Number(u.port);
      } catch {
        const m = /^rtsp:\/\/([^/:]+)(?::(\d+))?/i.exec(device.streamUrl);
        if (m) {
          host = m[1];
          if (m[2]) port = Number(m[2]);
        }
      }
    }

    if (!host && device.ipAddress) {
      host = device.ipAddress;
      port = 554;
    }

    if (!host) return null;
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

    return { host, port };
  }

  async disable(
    userId: string | null,
    deviceId: string,
  ): Promise<IoTDeviceEntity> {
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    // No-op: đã disabled → 200, không transaction/audit.
    if (device.status === IoTDeviceStatus.DISABLED) {
      return device;
    }

    const oldStatus = device.status;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Chỉ đổi status — KHÔNG chạm health/last_seen/room/metadata.
      device.status = IoTDeviceStatus.DISABLED;
      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );

      await this.iotAuditRepository.logDeviceStatusChange(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        action: 'disable',
        oldStatus,
        newStatus: IoTDeviceStatus.DISABLED,
      });

      await queryRunner.commitTransaction();

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async enable(
    userId: string | null,
    deviceId: string,
  ): Promise<IoTDeviceEntity> {
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    // No-op: chỉ kích hoạt lại thiết bị đang disabled. Khác disabled → 200 không đổi.
    if (device.status !== IoTDeviceStatus.DISABLED) {
      return device;
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // disabled → offline (chờ heartbeat cập nhật online). KHÔNG chạm health/last_seen/room.
      device.status = IoTDeviceStatus.OFFLINE;
      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );

      await this.iotAuditRepository.logDeviceStatusChange(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        action: 'enable',
        oldStatus: IoTDeviceStatus.DISABLED,
        newStatus: IoTDeviceStatus.OFFLINE,
      });

      await queryRunner.commitTransaction();

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async assignRoom(
    userId: string | null,
    deviceId: string,
    dto: AssignRoomDto,
  ): Promise<IoTDeviceEntity> {
    // Validate device
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    // [NEEDS CLARIFICATION] assignRoom availability guard.
    // Original code blocked status 'deleted' / health 'inactive'/'disabled' (decommissioned).
    // Tai's enum has no 'deleted'/'inactive'. The general "không khả dụng" convention also
    // lists OFFLINE, but a freshly created device defaults to OFFLINE, so blocking OFFLINE
    // here would make it impossible to assign a room to a new device. We therefore block only
    // DISABLED / MAINTENANCE / health FAULTY and exclude OFFLINE. Confirm if OFFLINE should block.
    if (
      device.status === IoTDeviceStatus.DISABLED ||
      device.status === IoTDeviceStatus.MAINTENANCE ||
      device.healthStatus === IoTDeviceHealthStatus.FAULTY
    ) {
      throw new ConflictException({
        code: 'DEVICE_NOT_ACTIVE',
        message: 'Cannot assign room to an unavailable device.',
      });
    }

    const allowedTypes = [
      IoTDeviceType.FACE_SERVER,
      IoTDeviceType.IP_CAMERA,
      IoTDeviceType.ROOM_CAMERA,
    ];

    if (!allowedTypes.includes(device.deviceType)) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_ASSIGNABLE_TO_ROOM',
        message: 'This device type cannot be assigned to a room.',
      });
    }

    // Idempotent case
    if (device.roomId === dto.roomId) {
      return device;
    }

    if (device.roomId && device.roomId !== dto.roomId) {
      throw new ConflictException({
        code: 'DEVICE_ALREADY_ASSIGNED_TO_ROOM',
        message: 'Device is already assigned to a different room.',
      });
    }

    // Validate room
    const room: Array<{ id: string; is_active: boolean }> =
      await this.dataSource.manager.query(
        'SELECT id, is_active FROM rooms WHERE id = $1',
        [dto.roomId],
      );

    if (!room || room.length === 0) {
      throw new NotFoundException({
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found.',
      });
    }

    if (room[0].is_active === false) {
      throw new ConflictException({
        code: 'ROOM_NOT_ACTIVE',
        message: 'Room is not active.',
      });
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const oldRoomId = device.roomId;

      device.roomId = dto.roomId;
      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );

      await this.iotAuditRepository.logAssignRoom(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        oldRoomId: oldRoomId || null,
        newRoomId: savedDevice.roomId as string,
      });

      await queryRunner.commitTransaction();

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async configureFaceServer(
    userId: string | null,
    deviceId: string,
    dto: ConfigureFaceServerDto,
  ): Promise<{ device: IoTDeviceEntity; oneTimeCallbackToken: string }> {
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    if (device.deviceType !== IoTDeviceType.FACE_SERVER) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_FACE_SERVER',
        message:
          'Only door face terminal devices can be configured as a face server.',
      });
    }

    if (!device.roomId) {
      throw new ConflictException({
        code: 'DEVICE_ROOM_ASSIGNMENT_REQUIRED',
        message:
          'Device must be assigned to a room before configuring face server.',
      });
    }

    // Process DTO and defaults
    const callback_enabled =
      dto.callback_enabled !== undefined ? dto.callback_enabled : true;

    // Generate short token (base64url) to fit hardware URL length limit
    const plainToken = crypto.randomBytes(16).toString('base64url');
    const tokenHash = crypto
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');
    const tokenLast4 = plainToken.slice(-4);
    const configuredAt = new Date().toISOString();

    // [FIX 2026-08-16] Mirror pattern đúng của revokeFaceServerToken/rotateFaceServerToken
    // (dòng ~1043, ~1106): spread face_server_config CŨ trước, đè field callback/token mới
    // SAU — KHÔNG gán object hoàn toàn mới. Trước fix, newFaceConfig là object mới tinh chỉ
    // 9 field callback/token → mất base_url/username/password_encrypted (set qua đường khác,
    // ví dụ PATCH đổi IP ở update()) mỗi lần gọi lại /configure.
    const currentFaceConfig = (device.metadataJson?.['face_server_config'] ??
      {}) as Record<string, unknown>;
    // [FIX 2026-08-16] Token MỚI sinh ra ở /configure KHÔNG được kế thừa
    // revoked_at/revoked_reason từ lần /revoke trước đó — mirror đúng "delete" đã
    // có sẵn ở rotateFaceServerToken() (dòng ~1128-1129). Xoá TRƯỚC khi merge field
    // callback mới, nếu không assertCallbackToken() sẽ từ chối nhầm token mới vừa
    // sinh là "đã revoked" (CALLBACK_TOKEN_REVOKED) dù token này chưa từng bị revoke.
    delete currentFaceConfig.revoked_at;
    delete currentFaceConfig.revoked_reason;
    const newFaceConfig: Record<string, unknown> = {
      ...currentFaceConfig,
      callback_enabled,
      callback_protocol: dto.callback_protocol,
      callback_base_url: dto.callback_base_url,
      heartbeat_path: dto.heartbeat_path,
      verify_path: dto.verify_path,
      stranger_path: dto.stranger_path,
      allowed_source_ip: dto.allowed_source_ip,
      callback_token_hash: tokenHash,
      callback_token_last4: tokenLast4,
      configured_at: configuredAt,
    };
    // Chiều BE→thiết bị (base_url/username/password) — CHỈ ghi đè khi DTO thực sự gửi
    // field đó, mirror đúng pattern preserve-field-không-thuộc-DTO ở trên (FIX
    // 2026-08-16): không gửi → giữ nguyên giá trị cũ (nếu có) từ currentFaceConfig.
    if (dto.base_url !== undefined) newFaceConfig.base_url = dto.base_url;
    if (dto.username !== undefined) newFaceConfig.username = dto.username;
    if (dto.password !== undefined) {
      newFaceConfig.password_encrypted = encryptSecret(dto.password);
    }

    const currentMetadata = device.metadataJson || {};
    const updatedMetadata = {
      ...currentMetadata,
      face_server_config: newFaceConfig,
    };

    device.metadataJson = updatedMetadata;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );

      await this.iotAuditRepository.logConfigureFaceServer(
        queryRunner.manager,
        {
          userId,
          deviceId: savedDevice.id,
          configMetadata: newFaceConfig,
        },
      );

      await queryRunner.commitTransaction();

      return {
        device: savedDevice,
        oneTimeCallbackToken: plainToken,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * TKR-001 (#11) — gom 3 bước verify callback token (dùng chung heartbeat/verify/stranger):
   *  1. chưa config token → 409 CALLBACK_TOKEN_NOT_CONFIGURED
   *  2. token đã thu hồi (revoked_at) → 403 CALLBACK_TOKEN_REVOKED (đặt TRƯỚC compare)
   *  3. sha256 + buffer-length + timingSafeEqual → sai → 401 INVALID_CALLBACK_TOKEN
   * KHÔNG log plaintext/hash.
   */
  private assertCallbackToken(faceConfig: any, incomingToken: string): void {
    if (!faceConfig.callback_token_hash) {
      throw new ConflictException({
        code: 'CALLBACK_TOKEN_NOT_CONFIGURED',
        message: 'Callback token has not been configured for this device.',
      });
    }

    if (faceConfig.revoked_at) {
      throw new ForbiddenException({
        code: 'CALLBACK_TOKEN_REVOKED',
        message: 'Callback token has been revoked for this device.',
      });
    }

    const incomingHash = crypto
      .createHash('sha256')
      .update(incomingToken)
      .digest('hex');

    const storedHash = faceConfig.callback_token_hash;
    const incomingBuf = Buffer.from(incomingHash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');

    if (
      incomingBuf.length !== storedBuf.length ||
      !crypto.timingSafeEqual(incomingBuf, storedBuf)
    ) {
      throw new UnauthorizedException({
        code: 'INVALID_CALLBACK_TOKEN',
        message: 'Invalid callback token.',
      });
    }
  }

  /**
   * TKR-001 (#11) — load device + validate là face_server (dùng chung revoke/rotate).
   * Mirror validation của configureFaceServer (cùng mã lỗi).
   */
  private async loadFaceServerDevice(
    deviceId: string,
  ): Promise<IoTDeviceEntity> {
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }
    if (device.deviceType !== IoTDeviceType.FACE_SERVER) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_FACE_SERVER',
        message:
          'Only door face terminal devices can be configured as a face server.',
      });
    }
    return device;
  }

  /**
   * TKR-001 (#11) T2 — thu hồi callback token: set revoked_at trong face_server_config.
   * - chưa config → 409 FACE_SERVER_NOT_CONFIGURED
   * - idempotent: đã revoked → return device, KHÔNG đổi revoked_at, KHÔNG audit lại
   * - persist: build NEW metadataJson reference (TypeORM detect change) + save trong txn
   * - audit face.token.revoke (KHÔNG token/hash)
   */
  async revokeFaceServerToken(
    userId: string | null,
    deviceId: string,
    dto: RevokeFaceServerTokenDto,
  ): Promise<IoTDeviceEntity> {
    const device = await this.loadFaceServerDevice(deviceId);

    const faceConfig = (device.metadataJson?.face_server_config ?? {}) as any;
    if (!faceConfig.callback_token_hash) {
      throw new ConflictException({
        code: 'FACE_SERVER_NOT_CONFIGURED',
        message:
          'Face server callback token has not been configured for this device.',
      });
    }

    // Idempotent: token đã thu hồi → giữ nguyên revoked_at gốc.
    if (faceConfig.revoked_at) {
      return device;
    }

    const updatedFaceConfig = {
      ...faceConfig,
      revoked_at: new Date().toISOString(),
      ...(dto.reason ? { revoked_reason: dto.reason } : {}),
    };
    // NEW reference để TypeORM phát hiện thay đổi jsonb (mirror configureFaceServer).
    device.metadataJson = {
      ...(device.metadataJson || {}),
      face_server_config: updatedFaceConfig,
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );
      await this.iotAuditRepository.logRevokeFaceServerToken(
        queryRunner.manager,
        {
          userId,
          deviceId: savedDevice.id,
          reason: dto.reason ?? null,
        },
      );
      await queryRunner.commitTransaction();
      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * TKR-001 (#11) T3 — xoay token: sinh token mới + clear revoked_at.
   * - chưa config → 409 FACE_SERVER_NOT_CONFIGURED (tạo mới dùng configureFaceServer)
   * - hash+last4 mới, configured_at mới, clear revoked_at/revoked_reason; giữ field config khác
   * - trả oneTimeCallbackToken (plaintext 1 lần); audit face.token.rotate (KHÔNG token/hash)
   */
  async rotateFaceServerToken(
    userId: string | null,
    deviceId: string,
  ): Promise<{ device: IoTDeviceEntity; oneTimeCallbackToken: string }> {
    const device = await this.loadFaceServerDevice(deviceId);

    const faceConfig = (device.metadataJson?.face_server_config ?? {}) as any;
    if (!faceConfig.callback_token_hash) {
      throw new ConflictException({
        code: 'FACE_SERVER_NOT_CONFIGURED',
        message:
          'Face server callback token has not been configured for this device.',
      });
    }

    // Sinh token mới (tái dùng token-gen của configureFaceServer).
    const plainToken = crypto.randomBytes(16).toString('base64url');
    const tokenHash = crypto
      .createHash('sha256')
      .update(plainToken)
      .digest('hex');
    const tokenLast4 = plainToken.slice(-4);

    const updatedFaceConfig = { ...faceConfig };
    updatedFaceConfig.callback_token_hash = tokenHash;
    updatedFaceConfig.callback_token_last4 = tokenLast4;
    updatedFaceConfig.configured_at = new Date().toISOString();
    // Xoay = token mới còn sống → clear revoked.
    delete updatedFaceConfig.revoked_at;
    delete updatedFaceConfig.revoked_reason;

    device.metadataJson = {
      ...(device.metadataJson || {}),
      face_server_config: updatedFaceConfig,
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();
    try {
      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );
      await this.iotAuditRepository.logRotateFaceServerToken(
        queryRunner.manager,
        {
          userId,
          deviceId: savedDevice.id,
        },
      );
      await queryRunner.commitTransaction();
      return { device: savedDevice, oneTimeCallbackToken: plainToken };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async configureRtsp(
    userId: string | null,
    deviceId: string,
    dto: ConfigureRtspDto,
  ): Promise<IoTDeviceEntity> {
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    if (
      device.deviceType !== IoTDeviceType.IP_CAMERA &&
      device.deviceType !== IoTDeviceType.ROOM_CAMERA
    ) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_RTSP_CAMERA',
        message: 'Only IP room cameras can be configured with RTSP.',
      });
    }

    if (!device.roomId) {
      throw new ConflictException({
        code: 'DEVICE_ROOM_ASSIGNMENT_REQUIRED',
        message: 'Device must be assigned to a room before configuring RTSP.',
      });
    }

    const currentMetadata = device.metadataJson || {};
    const currentRtspConfig = (currentMetadata.rtsp_config as any) || {};

    const rtsp_enabled =
      dto.rtsp_enabled !== undefined ? dto.rtsp_enabled : true;
    const rtsp_port = dto.rtsp_port !== undefined ? dto.rtsp_port : 554;
    const stream_profile = dto.stream_profile || 'main';

    // IOT-015 (SEC-01): mật khẩu RTSP được mã hóa AES-256-GCM (secret-crypto.util)
    // và lưu vào rtsp_password_encrypted. KHÔNG bao giờ lưu plaintext; stream_url
    // KHÔNG kèm user:pass. Nếu không gửi password → carry-over encrypted + flag cũ.
    const passwordProvided =
      dto.rtsp_password !== undefined && dto.rtsp_password !== '';

    const prevCfg = currentRtspConfig as {
      rtsp_password_encrypted?: string;
      rtsp_password_configured?: boolean;
    };
    let rtspPasswordEncrypted: string | undefined;
    let rtsp_password_configured: boolean;
    if (passwordProvided) {
      rtspPasswordEncrypted = encryptSecret(dto.rtsp_password as string);
      rtsp_password_configured = true;
    } else {
      rtspPasswordEncrypted =
        typeof prevCfg.rtsp_password_encrypted === 'string'
          ? prevCfg.rtsp_password_encrypted
          : undefined;
      rtsp_password_configured = prevCfg.rtsp_password_configured === true;
    }

    // RTSP connection string stored in the stream_url column (no user:pass@).
    const streamUrl = `${dto.rtsp_protocol}://${dto.rtsp_host}:${rtsp_port}${dto.rtsp_path}`;
    device.streamUrl = streamUrl;

    const newRtspConfig: Record<string, unknown> = {
      rtsp_enabled,
      rtsp_protocol: dto.rtsp_protocol,
      rtsp_host: dto.rtsp_host,
      rtsp_port,
      rtsp_path: dto.rtsp_path,
      rtsp_username: dto.rtsp_username ?? null,
      stream_profile,
      rtsp_password_configured,
      configured_at: new Date().toISOString(),
    };
    if (rtspPasswordEncrypted) {
      newRtspConfig.rtsp_password_encrypted = rtspPasswordEncrypted;
    }

    const updatedMetadata = {
      ...currentMetadata,
      rtsp_config: newRtspConfig,
    };

    device.metadataJson = updatedMetadata;

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );

      await this.iotAuditRepository.logConfigureRtsp(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        configMetadata: newRtspConfig,
        passwordProvided,
      });

      await queryRunner.commitTransaction();

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * IAC-001 (UC-96) — bật/tắt chức năng AI của camera, ghi `metadata_json.ai_config`.
   *
   * MERGE từng cờ (cờ không gửi giữ nguyên; `absent` ≠ `false`). So sánh GIÁ TRỊ THẬT trước khi
   * ghi (dùng chung UC-91/UC-94): 3 cờ sau merge giống hệt `ai_config` hiện tại ⇒ NO-OP hoàn toàn
   * (KHÔNG save/audit/transaction, KHÔNG đụng configured_at). Body rỗng tự rơi vào no-op.
   *
   * ⚠⚠ CHỈ ghi DB — KHÔNG đẩy xuống thiết bị (BE không có kênh). Config là tuyên bố ý định,
   * KHÔNG dùng để lọc/chặn event. Giữ nguyên các khoá khác của metadata_json (rtsp_config...).
   */
  async configureAiConfig(
    userId: string | null,
    deviceId: string,
    dto: ConfigureAiConfigDto,
  ): Promise<IoTDeviceEntity> {
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    if (
      !(AI_CONFIGURABLE_DEVICE_TYPES as readonly IoTDeviceType[]).includes(
        device.deviceType,
      )
    ) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_AI_CAPABLE',
        message: 'This device type does not support AI configuration.',
      });
    }

    const currentMetadata = device.metadataJson || {};
    const currentAiConfig =
      (currentMetadata.ai_config as Record<string, unknown>) || {};

    // MERGE từng cờ — chỉ khoá gửi (!== undefined) mới ghi đè; CHƯA đụng configured_at.
    const mergedFlags: Record<string, unknown> = { ...currentAiConfig };
    delete mergedFlags.configured_at;
    if (dto.faceRecognition !== undefined) {
      mergedFlags.face_recognition = dto.faceRecognition;
    }
    if (dto.plateRecognition !== undefined) {
      mergedFlags.plate_recognition = dto.plateRecognition;
    }
    if (dto.peopleCounting !== undefined) {
      mergedFlags.people_counting = dto.peopleCounting;
    }

    // SO SÁNH GIÁ TRỊ THẬT (bỏ qua configured_at): giống ⇒ NO-OP, trả device nguyên trạng.
    const currentFlags: Record<string, unknown> = { ...currentAiConfig };
    delete currentFlags.configured_at;
    if (JSON.stringify(mergedFlags) === JSON.stringify(currentFlags)) {
      return device;
    }

    const merged = {
      ...mergedFlags,
      configured_at: new Date().toISOString(),
    };
    // Giữ nguyên rtsp_config/face_server_config/last_availability_check/khoá khác.
    device.metadataJson = { ...currentMetadata, ai_config: merged };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );

      await this.iotAuditRepository.logConfigureAi(queryRunner.manager, {
        userId,
        deviceId: savedDevice.id,
        configMetadata: merged,
      });

      await queryRunner.commitTransaction();

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async checkAvailability(
    userId: string | null,
    deviceId: string,
  ): Promise<IoTDeviceEntity> {
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    if (
      device.deviceType !== IoTDeviceType.FACE_SERVER &&
      device.deviceType !== IoTDeviceType.IP_CAMERA
    ) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_CAMERA',
        message: 'This device type is not supported for availability check.',
      });
    }

    let is_available = false;
    let check_type = '';
    let runtime_verified = false;
    let reason_code: string | null = null;
    let message = 'Camera availability checked successfully';

    if (device.deviceType === IoTDeviceType.FACE_SERVER) {
      check_type = 'heartbeat_status';
      if (device.lastSeenAt) {
        const now = new Date();
        const diffInMinutes =
          (now.getTime() - device.lastSeenAt.getTime()) / 60000;

        if (diffInMinutes <= 5) {
          is_available = true;
          runtime_verified = true;
          reason_code = null;
          device.status = IoTDeviceStatus.ONLINE;
          device.healthStatus = IoTDeviceHealthStatus.HEALTHY;
        } else {
          is_available = false;
          runtime_verified = true;
          reason_code = 'HEARTBEAT_STALE';
          device.status = IoTDeviceStatus.OFFLINE;
          // [NEEDS CLARIFICATION] old value 'unhealthy' has no equivalent in Tai's
          // enum {healthy,warning,faulty,unknown}; mapped stale heartbeat -> FAULTY.
          device.healthStatus = IoTDeviceHealthStatus.FAULTY;
        }
      } else {
        is_available = false;
        runtime_verified = false;
        reason_code = 'HEARTBEAT_NOT_SEEN';
        device.status = IoTDeviceStatus.OFFLINE;
        device.healthStatus = IoTDeviceHealthStatus.UNKNOWN;
      }
    } else if (device.deviceType === IoTDeviceType.IP_CAMERA) {
      // A5 (IOT-005): runtime RTSP probe thuần Nest (ffprobe) thay config-readiness.
      check_type = 'rtsp_runtime_probe';
      runtime_verified = false;

      const rtspConfig = device.metadataJson?.rtsp_config as
        | {
            rtsp_enabled?: boolean;
            rtsp_username?: string;
            rtsp_password_encrypted?: string;
          }
        | undefined;

      // Config-gate (giữ pre-check): các trường hợp này KHÔNG probe, health=warning.
      if (!device.roomId) {
        is_available = false;
        reason_code = 'DEVICE_ROOM_ASSIGNMENT_REQUIRED';
        device.healthStatus = IoTDeviceHealthStatus.WARNING;
      } else if (!device.streamUrl || !rtspConfig) {
        is_available = false;
        reason_code = 'RTSP_CONFIG_MISSING';
        device.healthStatus = IoTDeviceHealthStatus.WARNING;
      } else if (rtspConfig.rtsp_enabled === false) {
        is_available = false;
        reason_code = 'RTSP_DISABLED';
        device.healthStatus = IoTDeviceHealthStatus.WARNING;
      } else {
        // Message cố định theo group (spec §8.4 — KHÔNG nhúng stderr).
        const RTSP_PROBE_MESSAGES: Record<string, string> = {
          alive: 'RTSP stream is reachable and contains a video stream.',
          unreachable:
            'RTSP host is unreachable (connection refused or no route).',
          timeout: 'RTSP probe timed out before the stream responded.',
          auth_fail:
            'RTSP authentication failed. Check the configured username/password.',
          not_a_stream: 'RTSP URL did not return a valid video stream.',
          tool_unavailable: 'Stream probing tool is unavailable on the server.',
          default: 'RTSP probe failed for an unknown reason.',
        };

        // Dựng URL có credential IN-MEMORY (KHÔNG ghi DB/trả response/log thô).
        const username = rtspConfig.rtsp_username;
        const password = rtspConfig.rtsp_password_encrypted
          ? decryptSecret(rtspConfig.rtsp_password_encrypted)
          : '';
        const probeUrl = username
          ? device.streamUrl.replace(
              /^rtsp:\/\//i,
              `rtsp://${encodeURIComponent(username)}:${encodeURIComponent(
                password,
              )}@`,
            )
          : device.streamUrl;

        const timeoutMs = this.configService.get<number>(
          'RTSP_RUNTIME_PROBE_TIMEOUT_MS',
          10000,
        );
        const probe = await probeRtspRuntime(probeUrl, timeoutMs);

        // Map taxonomy §8.2 → entity.
        is_available = probe.isAvailable;
        runtime_verified = probe.runtimeVerified;
        reason_code = probe.reasonCode;
        message = RTSP_PROBE_MESSAGES[probe.group] ?? message;
        device.healthStatus = probe.healthStatus as IoTDeviceHealthStatus;
        if (probe.statusAction === 'set_online') {
          device.status = IoTDeviceStatus.ONLINE;
        } else if (probe.statusAction === 'set_offline') {
          device.status = IoTDeviceStatus.OFFLINE;
        }
        // statusAction='keep' → giữ nguyên device.status.

        if (probe.group === 'tool_unavailable') {
          this.logger.warn(
            `RTSP probe tool unavailable for device ${device.id} (${redactUrl(
              probeUrl,
            )})`,
          );
        }
      }
    }

    const currentMetadata = device.metadataJson || {};

    device.metadataJson = {
      ...currentMetadata,
      last_availability_check: {
        is_available,
        check_type,
        runtime_verified,
        reason_code,
        message,
        checked_at: new Date().toISOString(),
        checked_by: userId,
      },
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const savedDevice = await queryRunner.manager.save(
        IoTDeviceEntity,
        device,
      );

      // No audit log for this UC

      await queryRunner.commitTransaction();

      return savedDevice;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private readonly logger = new Logger(IotDevicesService.name);

  async receiveHeartbeat(input: HeartbeatInput) {
    const { headers, body, query, params, clientIp } = input;

    // 1. Extract device_code: header → body → query device_code → query d → path param deviceCode
    const deviceCode = this.extractValue(
      headers['x-device-code'],
      body?.device_code,
      query?.device_code,
      query?.d,
      params?.deviceCode,
    );
    if (!deviceCode) {
      throw new BadRequestException({
        code: 'DEVICE_CODE_REQUIRED',
        message:
          'device_code is required (header X-Device-Code, body, or query param).',
      });
    }

    // 2. Find device by device_code
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { deviceCode },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    // 3. Check device type
    if (device.deviceType !== IoTDeviceType.FACE_SERVER) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_FACE_SERVER',
        message: 'Only door face terminal devices support heartbeat callback.',
      });
    }

    // 4. Check callback_enabled
    const faceConfig = device.metadataJson?.face_server_config as any;
    if (!faceConfig || faceConfig.callback_enabled !== true) {
      throw new ConflictException({
        code: 'FACE_CALLBACK_NOT_ENABLED',
        message: 'Face server callback is not enabled for this device.',
      });
    }

    // 5. Extract callback_token: header → body → query callback_token → query t → path param callbackToken
    const callbackToken = this.extractValue(
      headers['x-callback-token'],
      body?.callback_token,
      query?.callback_token,
      query?.t,
      params?.callbackToken,
    );
    if (!callbackToken) {
      throw new UnauthorizedException({
        code: 'CALLBACK_TOKEN_REQUIRED',
        message:
          'callback_token is required (header X-Callback-Token, body, or query param).',
      });
    }

    // 6. Verify callback token (TKR-001: gom vào assertCallbackToken — not-configured/revoked/invalid)
    this.assertCallbackToken(faceConfig, callbackToken);

    // 7. Check allowed_source_ip (best-effort)
    const normalizedClientIp = this.assertAllowedSourceIp(
      faceConfig,
      clientIp,
      deviceCode,
    );

    // 8. Process heartbeat
    const now = new Date();
    device.lastSeenAt = now;
    device.status = IoTDeviceStatus.ONLINE;
    device.healthStatus = IoTDeviceHealthStatus.HEALTHY;

    const rawSample = maskSensitiveMetadata(body || {}) || {};

    const currentMetadata = device.metadataJson || {};
    device.metadataJson = {
      ...currentMetadata,
      last_heartbeat: {
        received_at: now.toISOString(),
        source_ip: normalizedClientIp || null,
        payload_timestamp: body?.timestamp || null,
        device_status: body?.status || null,
        raw_payload_sample: rawSample,
      },
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.manager.save(IoTDeviceEntity, device);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    return {
      device_code: device.deviceCode,
      status: device.status,
      health_status: device.healthStatus,
      last_seen_at: device.lastSeenAt,
      received_at: now,
    };
  }

  async receiveVerifyEvent(input: VerifyEventInput) {
    const { headers, body, query, params, clientIp, files } = input;

    // 1. Extract device_code
    const deviceCode = this.extractValue(
      headers['x-device-code'],
      body?.device_code,
      query?.device_code,
      query?.d,
      params?.deviceCode,
    );
    if (!deviceCode) {
      throw new BadRequestException({
        code: 'DEVICE_CODE_REQUIRED',
        message: 'device_code is required.',
      });
    }

    // 2. Find device by device_code
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { deviceCode },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    // 3. Check device type
    if (device.deviceType !== IoTDeviceType.FACE_SERVER) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_FACE_SERVER',
        message: 'Only door face terminal devices support verify callback.',
      });
    }

    // 4. Check callback_enabled
    const faceConfig = device.metadataJson?.face_server_config as any;
    if (!faceConfig || faceConfig.callback_enabled !== true) {
      throw new ConflictException({
        code: 'FACE_CALLBACK_NOT_ENABLED',
        message: 'Face server callback is not enabled for this device.',
      });
    }

    // 5. Extract callback_token
    const callbackToken = this.extractValue(
      headers['x-callback-token'],
      body?.callback_token,
      query?.callback_token,
      query?.t,
      params?.callbackToken,
    );
    if (!callbackToken) {
      throw new UnauthorizedException({
        code: 'CALLBACK_TOKEN_REQUIRED',
        message: 'callback_token is required.',
      });
    }

    // 6. Verify callback token (TKR-001: gom vào assertCallbackToken — not-configured/revoked/invalid)
    this.assertCallbackToken(faceConfig, callbackToken);

    // 7. Check allowed_source_ip (best-effort)
    const normalizedClientIp = this.assertAllowedSourceIp(
      faceConfig,
      clientIp,
      deviceCode,
    );

    // 8. Process payload tolerant ingestion
    // Danh tính verify ở body.info.* (payload thật FaceGate VerifyPush), KHÔNG ở body.person_id.
    const now = new Date();
    const {
      isValid: isValidVerify,
      personId,
      personName,
      directionRaw,
      opendoorWay,
      info,
    } = parseVerifyPayload(body);
    // DCO-001: suy hướng qua cửa ở service (util giữ pure). Giả định 2=out / 1=in
    // — CẦN xác nhận live (quét RA/VÀO + FACE_VERIFY_DEBUG). Thiếu/khác → 'in' (an toàn).
    const directionOutValue = this.configService.get<string>(
      'FACE_DIRECTION_OUT_VALUE',
      '2',
    );
    const direction: 'in' | 'out' =
      String(directionRaw ?? '') === directionOutValue ? 'out' : 'in';
    const extractedFields: any = {
      operator: body?.operator ?? null,
      person_id: personId,
      person_name: personName,
      verify_time: info.CreateTime ?? null,
      verify_status: info.VerifyStatus ?? null,
      similarity: info.Similarity1 ?? null,
      direction,
      direction_raw: directionRaw,
      opendoor_way: opendoorWay,
    };

    let payloadToMask: any = {};
    if (body) {
      // Shallow copy + STRIP base64 ảnh (SanpPic) — TUYỆT ĐỐI không lưu/log base64.
      payloadToMask = stripSanpPic({ ...body });
    } else {
      payloadToMask = {
        _unparseable: true,
        content_type: headers['content-type'] || 'unknown',
        content_length: headers['content-length'] || '0',
      };
    }

    // Add file metadata if files exist (don't log/save buffers)
    if (files && files.length > 0) {
      payloadToMask._files = files.map((f: any) => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      }));
    }

    // Truncate long string fields
    let truncated = false;
    for (const key in payloadToMask) {
      if (
        typeof payloadToMask[key] === 'string' &&
        payloadToMask[key].length > 2000
      ) {
        payloadToMask[key] =
          payloadToMask[key].substring(0, 2000) + '... [TRUNCATED]';
        truncated = true;
      }
    }
    if (truncated) {
      payloadToMask.truncated = true;
    }

    const maskedSample = maskSensitiveMetadata(payloadToMask) || {};

    const newSample = {
      received_at: now.toISOString(),
      source_ip: normalizedClientIp || null,
      extracted_fields: extractedFields,
      raw_payload_sample: maskedSample,
    };

    // 9. Update DB
    device.lastSeenAt = now;
    device.status = IoTDeviceStatus.ONLINE;
    device.healthStatus = IoTDeviceHealthStatus.HEALTHY;

    const currentMetadata = device.metadataJson || {};
    const oldSamples = Array.isArray(
      currentMetadata.recent_verify_event_samples,
    )
      ? currentMetadata.recent_verify_event_samples
      : [];

    device.metadataJson = {
      ...currentMetadata,
      last_verify_event_sample: newSample,
      recent_verify_event_samples: [newSample, ...oldSamples].slice(0, 5),
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await this.iotDeviceEventsService.storeRawEvent(
        {
          device,
          eventType: 'face_verify',
          sourceProtocol: 'http',
          severity: 'info',
          receivedAt: now,
          occurredAt: extractedFields.verify_time
            ? new Date(extractedFields.verify_time)
            : null,
          sourceIp: normalizedClientIp || 'unknown',
          httpMethod: (headers['method'] ||
            headers['x-http-method-override'] ||
            'POST') as string,
          contentType: (headers['content-type'] || 'unknown') as string,
          contentLength: (headers['content-length'] || '0') as string,
          rawPayloadSample: maskedSample,
          fileMetadata: payloadToMask._files || [],
          extractedFields,
          storedByUc: 'IOT-009',
        },
        queryRunner.manager,
      );
      await queryRunner.manager.save(IoTDeviceEntity, device);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // FAT-001 (NC-4): chuyển verify → attendance qua hook. Raw event đã lưu ở trên.
    // Chỉ ghi khi verify hợp lệ (VerifyPush + VerifyStatus===1). CreateTime là giờ
    // local thiết bị (không tz) → KHÔNG tin cho tính trễ; dùng `now`.
    // Lỗi attendance KHÔNG được làm hỏng response 200 của callback.
    if (this.faceVerifyHook && isValidVerify) {
      try {
        await this.faceVerifyHook.onVerify({
          deviceId: device.id,
          roomId: device.roomId,
          personId,
          personName,
          verifyTime: now,
          direction,
          directionRaw,
          opendoorWay,
        });
      } catch (e) {
        this.logger.error(
          `face attendance hook failed (verify still 200): ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    } else if (this.faceVerifyHook) {
      this.logger.warn(
        `verify skip (no record): operator=${body?.operator ?? '∅'} VerifyStatus=${info.VerifyStatus ?? '∅'}`,
      );
    }

    return {
      device_code: device.deviceCode,
      event_type: 'face_verify',
      received_at: now.toISOString(),
    };
  }

  async receiveStrangerEvent(input: StrangerEventInput) {
    const { headers, body, query, params, clientIp, files } = input;

    // 1. Extract device_code
    const deviceCode = this.extractValue(
      headers['x-device-code'],
      body?.device_code,
      query?.device_code,
      query?.d,
      params?.deviceCode,
    );
    if (!deviceCode) {
      throw new BadRequestException({
        code: 'DEVICE_CODE_REQUIRED',
        message: 'device_code is required.',
      });
    }

    // 2. Find device by device_code
    const device = await this.dataSource.manager.findOne(IoTDeviceEntity, {
      where: { deviceCode },
    });
    if (!device) {
      throw new NotFoundException({
        code: 'IOT_DEVICE_NOT_FOUND',
        message: 'IoT Device not found.',
      });
    }

    // 3. Check device type
    if (device.deviceType !== IoTDeviceType.FACE_SERVER) {
      throw new ConflictException({
        code: 'DEVICE_TYPE_NOT_FACE_SERVER',
        message: 'Only door face terminal devices support stranger callback.',
      });
    }

    // 4. Check callback_enabled
    const faceConfig = device.metadataJson?.face_server_config as any;
    if (!faceConfig || faceConfig.callback_enabled !== true) {
      throw new ConflictException({
        code: 'FACE_CALLBACK_NOT_ENABLED',
        message: 'Face server callback is not enabled for this device.',
      });
    }

    // 5. Extract callback_token
    const callbackToken = this.extractValue(
      headers['x-callback-token'],
      body?.callback_token,
      query?.callback_token,
      query?.t,
      params?.callbackToken,
    );
    if (!callbackToken) {
      throw new UnauthorizedException({
        code: 'CALLBACK_TOKEN_REQUIRED',
        message: 'callback_token is required.',
      });
    }

    // 6. Verify callback token (TKR-001: gom vào assertCallbackToken — not-configured/revoked/invalid)
    this.assertCallbackToken(faceConfig, callbackToken);

    // 7. Check allowed_source_ip (best-effort)
    const normalizedClientIp = this.assertAllowedSourceIp(
      faceConfig,
      clientIp,
      deviceCode,
    );

    // 8. Process payload tolerant ingestion
    const now = new Date();
    const extractedFields: any = {
      stranger_id: body?.stranger_id || null,
      event_time: body?.event_time || null,
      capture_time: body?.capture_time || null,
      similarity: body?.similarity || null,
      event_result: 'stranger',
    };

    let payloadToMask: any = {};
    if (body && Object.keys(body).length > 0) {
      // SAL-001 FR-008: STRIP base64 ảnh (SanpPic) tại nguồn — phủ CẢ payload_json
      // LẪN device.metadataJson.recent_stranger_event_samples (cùng newSample).
      payloadToMask = stripSanpPic({ ...body });
    } else {
      payloadToMask = {
        _unparseable: true,
        content_type: headers['content-type'] || 'unknown',
        content_length: headers['content-length'] || '0',
        method: headers['method'] || 'unknown',
      };
    }

    // Add file metadata if files exist (don't log/save buffers)
    if (files && files.length > 0) {
      payloadToMask._files = files.map((f: any) => ({
        fieldname: f.fieldname,
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      }));
    }

    // Truncate long string fields
    let truncated = false;
    for (const key in payloadToMask) {
      if (
        typeof payloadToMask[key] === 'string' &&
        payloadToMask[key].length > 2000
      ) {
        payloadToMask[key] =
          payloadToMask[key].substring(0, 2000) + '... [TRUNCATED]';
        truncated = true;
      }
    }
    if (truncated) {
      payloadToMask.truncated = true;
    }

    const maskedSample = maskSensitiveMetadata(payloadToMask) || {};

    const newSample = {
      received_at: now.toISOString(),
      source_ip: normalizedClientIp || null,
      extracted_fields: extractedFields,
      raw_payload_sample: maskedSample,
    };

    // 9. Update DB
    device.lastSeenAt = now;
    device.status = IoTDeviceStatus.ONLINE;
    device.healthStatus = IoTDeviceHealthStatus.HEALTHY;

    const currentMetadata = device.metadataJson || {};
    const oldSamples = Array.isArray(
      currentMetadata.recent_stranger_event_samples,
    )
      ? currentMetadata.recent_stranger_event_samples
      : [];

    device.metadataJson = {
      ...currentMetadata,
      last_stranger_event_sample: newSample,
      recent_stranger_event_samples: [newSample, ...oldSamples].slice(0, 5),
    };

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await this.iotDeviceEventsService.storeRawEvent(
        {
          device,
          eventType: 'face_stranger',
          sourceProtocol: 'http',
          severity: 'warning',
          receivedAt: now,
          occurredAt:
            extractedFields.event_time || extractedFields.capture_time
              ? new Date(
                  extractedFields.event_time || extractedFields.capture_time,
                )
              : null,
          sourceIp: normalizedClientIp || 'unknown',
          httpMethod: (headers['method'] ||
            headers['x-http-method-override'] ||
            'POST') as string,
          contentType: (headers['content-type'] || 'unknown') as string,
          contentLength: (headers['content-length'] || '0') as string,
          rawPayloadSample: maskedSample,
          fileMetadata: payloadToMask._files || [],
          extractedFields,
          storedByUc: 'IOT-009',
        },
        queryRunner.manager,
      );
      await queryRunner.manager.save(IoTDeviceEntity, device);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    // SAL-001 (#20): cảnh báo stranger qua hook. Raw event đã lưu ở trên (raw có dù
    // alert lỗi). Lỗi cảnh báo KHÔNG được làm hỏng response 200 của callback.
    if (this.strangerAlertHook) {
      try {
        const sf = extractedFields as {
          stranger_id: string | null;
          similarity: string | null;
        };
        await this.strangerAlertHook.onStranger({
          deviceId: device.id,
          deviceCode: device.deviceCode,
          roomId: device.roomId,
          strangerId: sf.stranger_id,
          similarity: sf.similarity != null ? String(sf.similarity) : null,
          capturedAt: now,
        });
      } catch (e) {
        this.logger.error(
          `stranger alert hook failed (stranger still 200): ${
            e instanceof Error ? e.message : 'unknown'
          }`,
        );
      }
    }

    return {
      device_code: device.deviceCode,
      event_type: 'face_stranger',
      received_at: now.toISOString(),
    };
  }

  private extractValue(
    headerVal: string | string[] | undefined,
    bodyVal: any,
    queryVal: string | string[] | undefined,
    shortAliasVal?: string | string[],
    pathParamVal?: string | string[],
  ): string | null {
    // Header first
    if (headerVal) {
      const val = Array.isArray(headerVal) ? headerVal[0] : headerVal;
      const trimmed = String(val).trim();
      if (trimmed) return trimmed;
    }
    // Body second
    if (bodyVal !== undefined && bodyVal !== null) {
      const trimmed = String(bodyVal).trim();
      if (trimmed) return trimmed;
    }
    // Query third
    if (queryVal) {
      const val = Array.isArray(queryVal) ? queryVal[0] : queryVal;
      const trimmed = String(val).trim();
      if (trimmed) return trimmed;
    }
    // Short Alias fourth
    if (shortAliasVal) {
      const val = Array.isArray(shortAliasVal)
        ? shortAliasVal[0]
        : shortAliasVal;
      const trimmed = String(val).trim();
      if (trimmed) return trimmed;
    }
    // Path Param fifth
    if (pathParamVal) {
      const val = Array.isArray(pathParamVal) ? pathParamVal[0] : pathParamVal;
      const trimmed = String(val).trim();
      if (trimmed) return trimmed;
    }
    return null;
  }

  private normalizeIp(ip: string | undefined): string | null {
    if (!ip) return null;
    // Strip ::ffff: prefix for IPv4-mapped IPv6
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
    }
    return ip;
  }

  /**
   * [FIX 2026-08-15] Check allowed_source_ip (best-effort), dùng chung cho cả 3 callback
   * (verify/heartbeat/stranger) — trước đây lặp lại y hệt 3 nơi, dễ sửa sót 1 chỗ.
   *
   * '0.0.0.0' được coi là KHÔNG giới hạn (giống rỗng/null) — đây là quy ước phổ biến trong
   * networking cho "chấp nhận mọi IP", nhưng code cũ so sánh chuỗi trực tiếp
   * (normalizedClientIp !== allowed_source_ip) nên '0.0.0.0' KHÔNG khớp bất kỳ IP thiết bị
   * thật nào → chặn TOÀN BỘ callback thay vì cho qua như ý định người cấu hình. Đã xác nhận
   * đúng nguyên nhân qua incident thật 2026-08-15 (device 'a' bị chặn mọi verify callback
   * nhiều giờ liền, allowed_source_ip='0.0.0.0').
   *
   * Trả về normalizedClientIp để caller dùng tiếp (ghi log/metadata) — tránh gọi
   * normalizeIp() lặp lại lần 2.
   */
  private assertAllowedSourceIp(
    faceConfig: { allowed_source_ip?: string },
    clientIp: string | undefined,
    deviceCode: string,
  ): string | null {
    const normalizedClientIp = this.normalizeIp(clientIp);
    const allowedIp = faceConfig.allowed_source_ip;
    const isUnrestricted = !allowedIp || allowedIp === '0.0.0.0';
    if (!isUnrestricted) {
      if (
        normalizedClientIp &&
        normalizedClientIp !== '127.0.0.1' &&
        normalizedClientIp !== '::1'
      ) {
        if (normalizedClientIp !== allowedIp) {
          throw new ForbiddenException({
            code: 'SOURCE_IP_NOT_ALLOWED',
            message: `Source IP ${normalizedClientIp} is not allowed. Expected: ${allowedIp}.`,
          });
        }
      } else {
        this.logger.warn(
          `Skipping IP check for device ${deviceCode}: client IP not deterministic (${clientIp}).`,
        );
      }
    }
    return normalizedClientIp;
  }
}
