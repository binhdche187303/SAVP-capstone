import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, IsNull, Brackets } from 'typeorm';
import {
  EquipmentEntity,
  EquipmentType,
  AssetStatus,
  HealthStatus,
} from '../entities/equipment.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { RoomEntity, RoomStatus } from '../../rooms/entities/room.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
  NotificationPriority,
} from '../../notifications/entities/notification.entity.js';
import { CreateEquipmentDto } from '../dto/create-equipment.dto.js';
import {
  ReportEquipmentFaultDto,
  ReportedAssetAction,
} from '../dto/report-equipment-fault.dto.js';
import { ConfirmEquipmentFaultDto } from '../dto/confirm-equipment-fault.dto.js';
import { ResolveEquipmentFaultDto } from '../dto/resolve-equipment-fault.dto.js';
import { ListEquipmentsQueryDto } from '../dto/list-equipments-query.dto.js';
import { AssignEquipmentDto } from '../dto/assign-equipment.dto.js';
import { EquipmentResponseDto } from '../dto/equipment-response.dto.js';
import { EquipmentFaultConfirmationResponseDto } from '../dto/equipment-fault-confirmation-response.dto.js';
import {
  EquipmentFaultHistoryItemDto,
  EquipmentFaultLocation,
  EquipmentFaultEventType,
} from '../dto/equipment-fault-history-item.dto.js';
import { RoomEquipmentGapItemDto } from '../dto/room-equipment-gap-item.dto.js';

const EQUIPMENTS_PATH = '/api/v1/equipments';

/**
 * Chi 3 loai thiet bi nay co cot dang ky rieng tren RoomEntity
 * (has_camera/has_microphone/has_display). Cac loai khac (speaker,
 * capture_agent, sensor, other) khong co co so de doi chieu nen KHONG bi
 * chan boi validateRoomRegisteredForType — xem BAO_CAO tuong ung ve gap nay.
 */
const ROOM_EQUIPMENT_TYPE_LABELS: Partial<Record<EquipmentType, string>> = {
  [EquipmentType.CAMERA]: 'Camera',
  [EquipmentType.MICROPHONE]: 'Microphone',
  [EquipmentType.DISPLAY]: 'Màn hình/Tivi',
};

/**
 * UC-61 — Đăng ký thiết bị họp mới.
 * Mirror RoomsService.create: check trùng (withDeleted) → tạo trong transaction
 * → audit fail-separate (transaction riêng, không rollback thiết bị).
 */
@Injectable()
export class EquipmentService {
  private readonly logger = new Logger(EquipmentService.name);

  constructor(
    @InjectRepository(EquipmentEntity)
    private readonly equipmentRepo: Repository<EquipmentEntity>,
    private readonly dataSource: DataSource,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Kiểm serial_number đã tồn tại (kể cả soft-deleted). Chỉ gọi khi serial có giá trị.
   */
  private async checkDuplicateSerial(serial: string): Promise<void> {
    const existing = await this.equipmentRepo.findOne({
      where: { serialNumber: serial },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException({
        success: false,
        message: 'Serial number da ton tai',
        error: {
          code: 'EQUIPMENT_SERIAL_ALREADY_EXISTS',
          details: { serialNumber: serial },
        },
        timestamp: new Date().toISOString(),
        path: EQUIPMENTS_PATH,
      });
    }
  }

  /**
   * Kiểm equipment_code đã tồn tại (kể cả soft-deleted).
   */
  private async checkDuplicateCode(code: string): Promise<void> {
    const existing = await this.equipmentRepo.findOne({
      where: { equipmentCode: code },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException({
        success: false,
        message: 'Ma thiet bi da ton tai',
        error: {
          code: 'EQUIPMENT_CODE_ALREADY_EXISTS',
          details: { equipmentCode: code },
        },
        timestamp: new Date().toISOString(),
        path: EQUIPMENTS_PATH,
      });
    }
  }

  /**
   * Danh sach nhan Tieng Viet cac loai thiet bi phong da duoc dang ky
   * (has_camera/has_microphone/has_display = true), dung de hien thi chi tiet
   * trong thong bao loi ROOM_EQUIPMENT_TYPE_MISMATCH.
   */
  private getRoomRegisteredTypeLabels(room: RoomEntity): string[] {
    const labels: string[] = [];
    if (room.hasCamera) labels.push(ROOM_EQUIPMENT_TYPE_LABELS[EquipmentType.CAMERA]!);
    if (room.hasMicrophone)
      labels.push(ROOM_EQUIPMENT_TYPE_LABELS[EquipmentType.MICROPHONE]!);
    if (room.hasDisplay) labels.push(ROOM_EQUIPMENT_TYPE_LABELS[EquipmentType.DISPLAY]!);
    return labels;
  }

  /**
   * Chan gan thiet bi vao phong neu phong CHUA duoc dang ky co loai thiet bi
   * do (vd: gan mic vao phong chi dang ky camera + TV). Chi ap dung cho 3 loai
   * co cot dang ky rieng (camera/microphone/display) — cac loai khac (speaker,
   * capture_agent, sensor, other) khong co co so doi chieu nen bo qua kiem tra.
   */
  private assertRoomRegisteredForEquipmentType(
    room: RoomEntity,
    equipmentType: EquipmentType,
    path: string,
  ): void {
    const flagByType: Partial<Record<EquipmentType, boolean>> = {
      [EquipmentType.CAMERA]: room.hasCamera,
      [EquipmentType.MICROPHONE]: room.hasMicrophone,
      [EquipmentType.DISPLAY]: room.hasDisplay,
    };
    const requiredFlag = flagByType[equipmentType];
    if (requiredFlag === undefined || requiredFlag === true) {
      return;
    }

    const registeredLabels = this.getRoomRegisteredTypeLabels(room);
    const registeredText =
      registeredLabels.length > 0
        ? registeredLabels.join(', ')
        : 'chưa đăng ký loại thiết bị nào';

    throw new ConflictException({
      success: false,
      message: `Phòng ${room.roomName} chỉ mới được đăng ký có các thiết bị: ${registeredText}. Bạn có thể đăng ký lại thiết bị ở trang Quản lý phòng họp.`,
      error: {
        code: 'ROOM_EQUIPMENT_TYPE_MISMATCH',
        details: {
          roomId: room.id,
          roomName: room.roomName,
          equipmentType,
          registeredTypes: registeredLabels,
        },
      },
      timestamp: new Date().toISOString(),
      path,
    });
  }

  /**
   * Đăng ký thiết bị mới vào kho.
   */
  async create(
    dto: CreateEquipmentDto,
    userId: string,
    ipAddress?: string,
  ): Promise<EquipmentResponseDto> {
    // 1. Normalize
    const equipmentCode = dto.equipmentCode.toUpperCase().trim();
    const equipmentName = dto.equipmentName.trim();
    const serialNumber =
      dto.serialNumber && dto.serialNumber.trim() !== ''
        ? dto.serialNumber.trim()
        : null;

    // 2. purchaseDate không được là tương lai
    if (dto.purchaseDate) {
      const purchase = new Date(dto.purchaseDate);
      const now = new Date();
      if (purchase.getTime() > now.getTime()) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'purchaseDate khong duoc o tuong lai',
          error: {
            code: 'INVALID_PURCHASE_DATE',
            details: { purchaseDate: dto.purchaseDate },
          },
          timestamp: new Date().toISOString(),
          path: EQUIPMENTS_PATH,
        });
      }
    }

    // 3. Uniqueness — serial (chỉ khi có giá trị)
    if (serialNumber) {
      await this.checkDuplicateSerial(serialNumber);
    }
    // 4. Uniqueness — equipment_code
    await this.checkDuplicateCode(equipmentCode);

    // 4b. Gán phòng ngay lúc tạo (tùy chọn) — validate TRƯỚC transaction tạo
    // thiết bị, để không tạo ra thiết bị nếu phòng không hợp lệ / không khớp
    // loại thiết bị đã đăng ký (cùng rule với assignToRoom, UC-65).
    let assignedRoom: RoomEntity | null = null;
    if (dto.roomId) {
      assignedRoom = await this.dataSource
        .getRepository(RoomEntity)
        .findOne({ where: { id: dto.roomId, deletedAt: IsNull() } });
      if (!assignedRoom) {
        throw new NotFoundException({
          success: false,
          message: 'Khong tim thay phong hop',
          error: { code: 'ROOM_NOT_FOUND', details: { roomId: dto.roomId } },
          timestamp: new Date().toISOString(),
          path: EQUIPMENTS_PATH,
        });
      }
      if (
        !(
          assignedRoom.isActive === true &&
          assignedRoom.currentStatus !== RoomStatus.INACTIVE
        )
      ) {
        throw new ConflictException({
          success: false,
          message: 'Phong khong o trang thai nhan duoc thiet bi',
          error: {
            code: 'ROOM_NOT_ASSIGNABLE',
            details: {
              roomId: dto.roomId,
              isActive: assignedRoom.isActive,
              currentStatus: assignedRoom.currentStatus,
            },
          },
          timestamp: new Date().toISOString(),
          path: EQUIPMENTS_PATH,
        });
      }
      this.assertRoomRegisteredForEquipmentType(
        assignedRoom,
        dto.equipmentType,
        EQUIPMENTS_PATH,
      );
    }

    // 5. Tạo thiết bị trong transaction
    const saved = await this.dataSource.transaction(async (em) => {
      const equipment = em.create(EquipmentEntity, {
        equipmentCode,
        equipmentName,
        equipmentType: dto.equipmentType,
        serialNumber,
        brand: dto.brand ?? null,
        model: dto.model ?? null,
        purchaseDate: dto.purchaseDate ?? null,
        specificationJson: dto.specification ?? null,
        // server set cứng — không nhận từ input
        assetStatus: assignedRoom ? AssetStatus.ASSIGNED : AssetStatus.AVAILABLE,
        healthStatus: dto.healthStatus ?? HealthStatus.UNKNOWN,
        currentRoomId: assignedRoom ? assignedRoom.id : null,
        assignedBy: assignedRoom ? userId : null,
        assignedAt: assignedRoom ? new Date() : null,
        installedAt: assignedRoom ? new Date() : null,
        assignmentNote: assignedRoom ? (dto.assignmentNote ?? null) : null,
        iotDeviceId: null,
        lastMaintenanceAt: null,
        lastIssueReportedAt: null,
        lastIssueNote: null,
      });
      return em.save(EquipmentEntity, equipment);
    });

    // 6. Ghi audit log NGOÀI transaction — fail-separate (audit fail KHÔNG rollback thiết bị)
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'create',
          entityType: 'equipment',
          entityId: saved.id,
          newValueJson: {
            equipmentCode: saved.equipmentCode,
            equipmentName: saved.equipmentName,
            equipmentType: saved.equipmentType,
            serialNumber: saved.serialNumber,
            assetStatus: saved.assetStatus,
            healthStatus: saved.healthStatus,
            currentRoomId: saved.currentRoomId,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for equipment ${saved.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    // 7. Map response
    return new EquipmentResponseDto({
      id: saved.id,
      equipmentCode: saved.equipmentCode,
      equipmentName: saved.equipmentName,
      equipmentType: saved.equipmentType,
      serialNumber: saved.serialNumber,
      brand: saved.brand,
      model: saved.model,
      purchaseDate: saved.purchaseDate,
      assetStatus: saved.assetStatus,
      healthStatus: saved.healthStatus,
      currentRoomId: saved.currentRoomId,
      createdAt: saved.createdAt,
    });
  }

  /**
   * Resolve gia tri 'assetStatus' tu dropdown "Hanh dong" (UC-62) sang AssetStatus
   * that cua entity. 'active' khong ton tai trong DB — quay lai ASSIGNED neu thiet
   * bi dang gan phong, nguoc lai AVAILABLE.
   */
  private resolveAssetAction(
    action: ReportedAssetAction,
    currentRoomId: string | null,
  ): AssetStatus {
    switch (action) {
      case 'active':
        return currentRoomId ? AssetStatus.ASSIGNED : AssetStatus.AVAILABLE;
      case 'retired':
        return AssetStatus.RETIRED;
      case 'maintenance':
      default:
        return AssetStatus.MAINTENANCE;
    }
  }

  /**
   * UC-62 — Báo lỗi / chuyển bảo trì thiết bị.
   * Set healthStatus (warning/faulty/offline) va/hoac assetStatus.
   * assetStatus nhan 'active' | 'maintenance' | 'retired' tu FE, duoc resolve
   * sang AssetStatus that: 'active' -> ASSIGNED (con currentRoomId) hoac AVAILABLE,
   * 'maintenance' -> MAINTENANCE, 'retired' -> RETIRED.
   * Mirror create: transaction cập nhật + audit fail-separate.
   * KHÔNG set lastMaintenanceAt; KHÔNG đụng currentRoomId (gỡ khỏi phòng là UC-65).
   */
  async reportFault(
    equipmentId: string,
    dto: ReportEquipmentFaultDto,
    userId: string,
    ipAddress?: string,
  ): Promise<EquipmentResponseDto> {
    // Phase A — validate
    // A.1: phải có ít nhất một trong (healthStatus, assetStatus) — kiểm TRƯỚC load
    if (!dto.healthStatus && !dto.assetStatus) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Phai cung cap it nhat healthStatus hoac assetStatus',
        error: { code: 'FAULT_NO_CHANGE', details: {} },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault`,
      });
    }

    // A.2: load equipment (findOne tự loại soft-deleted nhờ @DeleteDateColumn)
    const equipment = await this.equipmentRepo.findOne({
      where: { id: equipmentId },
    });
    if (!equipment) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay thiet bi',
        error: {
          code: 'EQUIPMENT_NOT_FOUND',
          details: { equipmentId },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault`,
      });
    }

    // A.3: thiết bị retired/lost không cho báo lỗi
    if (
      equipment.assetStatus === AssetStatus.RETIRED ||
      equipment.assetStatus === AssetStatus.LOST
    ) {
      throw new ConflictException({
        success: false,
        message: 'Thiet bi da thanh ly / mat, khong the bao loi',
        error: {
          code: 'EQUIPMENT_NOT_REPORTABLE',
          details: { assetStatus: equipment.assetStatus },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault`,
      });
    }

    // A.4: snapshot trạng thái cũ cho audit
    const oldValue = {
      healthStatus: equipment.healthStatus,
      assetStatus: equipment.assetStatus,
    };

    // A.5: snapshot vị trí (phòng + site) lúc báo hỏng — lưu vào audit để lịch sử
    // vẫn biết hỏng ở đâu kể cả khi thiết bị bị chuyển phòng sau đó.
    // Best-effort: tra vị trí lỗi thì vẫn cho báo hỏng, chỉ thiếu vị trí.
    let room: Pick<
      RoomEntity,
      'id' | 'roomName' | 'siteName' | 'areaName'
    > | null = null;
    if (equipment.currentRoomId) {
      try {
        room = await this.dataSource.getRepository(RoomEntity).findOne({
          where: { id: equipment.currentRoomId },
          select: {
            id: true,
            roomName: true,
            siteName: true,
            areaName: true,
          },
        });
      } catch (err) {
        this.logger.warn(
          `Failed to load room for equipment fault ${equipment.id}: ${
            err instanceof Error ? err.message : 'Unknown'
          }`,
        );
      }
    }
    const location = room
      ? {
          roomId: room.id,
          roomName: room.roomName,
          siteName: room.siteName,
          areaName: room.areaName,
        }
      : null;

    // Phase B — cập nhật trong transaction
    const saved = await this.dataSource.transaction(async (em) => {
      if (dto.healthStatus) {
        equipment.healthStatus = dto.healthStatus;
      }
      if (dto.assetStatus) {
        equipment.assetStatus = this.resolveAssetAction(
          dto.assetStatus,
          equipment.currentRoomId,
        );
      }
      equipment.lastIssueReportedAt = new Date();
      equipment.lastIssueNote = dto.issueNote;
      // KHÔNG set lastMaintenanceAt; KHÔNG đụng currentRoomId / assigned_*
      return em.save(EquipmentEntity, equipment);
    });

    // Phase C — audit fail-separate (transaction riêng, không rollback thiết bị)
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'update',
          entityType: 'equipment',
          entityId: saved.id,
          oldValueJson: oldValue,
          newValueJson: {
            healthStatus: saved.healthStatus,
            assetStatus: saved.assetStatus,
            lastIssueReportedAt: saved.lastIssueReportedAt,
            lastIssueNote: saved.lastIssueNote,
            location,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.WARNING,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for equipment fault ${saved.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    // Phase D — notify BUSINESS_ADMIN (fail-separate, KHÔNG rollback nghiệp vụ)
    try {
      const adminIds = await this.resolveBusinessAdminIds();
      await this.notificationsService.createNotification({
        notificationType: NotificationType.EQUIPMENT_FAULT_REPORTED,
        channel: NotificationChannel.IN_APP,
        subject: 'Thiết bị hỏng cần xử lý',
        content: `Thiết bị ${saved.equipmentName} (${saved.equipmentCode})${
          room ? ' tại phòng ' + room.roomName : ''
        }${room?.siteName ? ' - ' + room.siteName : ''} vừa được báo lỗi: ${
          dto.issueNote
        }`,
        relatedEntityType: 'equipment',
        relatedEntityId: saved.id,
        recipientScope: 'user_list',
        recipientUserIds: adminIds,
        priority: NotificationPriority.HIGH,
        createdBy: userId,
        payloadJson: {
          healthStatus: saved.healthStatus,
          assetStatus: saved.assetStatus,
          roomId: saved.currentRoomId,
          roomName: room?.roomName ?? null,
          siteName: room?.siteName ?? null,
          issueNote: dto.issueNote,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify BUSINESS_ADMIN for equipment fault ${saved.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    // Map response — tái dùng EquipmentResponseDto (UC-61)
    return new EquipmentResponseDto({
      id: saved.id,
      equipmentCode: saved.equipmentCode,
      equipmentName: saved.equipmentName,
      equipmentType: saved.equipmentType,
      serialNumber: saved.serialNumber,
      brand: saved.brand,
      model: saved.model,
      purchaseDate: saved.purchaseDate,
      assetStatus: saved.assetStatus,
      healthStatus: saved.healthStatus,
      currentRoomId: saved.currentRoomId,
      createdAt: saved.createdAt,
    });
  }

  /**
   * Helper Lấy danh sách ID của người dùng có role BUSINESS_ADMIN.
   * Direct SQL query mirror stranger-alert.service.ts / vehicle-control-alert.service.ts.
   */
  private async resolveBusinessAdminIds(): Promise<string[]> {
    if (!this.dataSource.manager?.query) {
      return [];
    }
    const rows: Array<{ id: string }> = await this.dataSource.manager.query(
      `SELECT DISTINCT u.id FROM users u
         JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active = true
         JOIN roles r ON r.id = ur.role_id
        WHERE r.role_code = 'BUSINESS_ADMIN' AND u.deleted_at IS NULL`,
    );
    return rows.map((r) => r.id);
  }

  /**
   * Helper tìm userId của người báo lỗi gần nhất từ audit_logs cho 1 thiết bị.
   * Query (entityType='equipment', actionType='update', severity='WARNING') ORDER BY createdAt DESC LIMIT 1.
   */
  private async findLastFaultReportAuditLog(
    equipmentId: string,
  ): Promise<{ userId: string } | null> {
    const rows = await this.dataSource.getRepository(AuditLogEntity).find({
      where: {
        entityType: 'equipment',
        entityId: equipmentId,
        actionType: 'update',
        severity: AuditLogSeverity.WARNING,
      },
      order: { createdAt: 'DESC' },
      take: 1,
    });
    const userId = rows[0]?.userId;
    return userId ? { userId } : null;
  }

  /**
   * EQUIP-FAULT-LIFECYCLE-001 — Xác nhận lỗi thiết bị là thật (sysadmin confirm).
   * Phase A: load equipment (404 neu khong tim thay) → healthy check (409).
   * Phase B: ghi 1 dong audit_logs (actionType='confirm', severity=INFO) — KHÔNG đụng entity equipments.
   * Phase C: notify reporter neu tim duoc qua audit_logs (fail-separate).
   */
  async confirmFault(
    equipmentId: string,
    dto: ConfirmEquipmentFaultDto,
    userId: string,
    ipAddress?: string,
  ): Promise<EquipmentFaultConfirmationResponseDto> {
    // Phase A — validate
    const equipment = await this.equipmentRepo.findOne({
      where: { id: equipmentId },
    });
    if (!equipment) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay thiet bi',
        error: {
          code: 'EQUIPMENT_NOT_FOUND',
          details: { equipmentId },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault-confirmation`,
      });
    }

    if (
      equipment.healthStatus === HealthStatus.HEALTHY ||
      equipment.healthStatus === HealthStatus.UNKNOWN
    ) {
      throw new ConflictException({
        success: false,
        message:
          'Thiet bi dang o trang thai binh thuong, khong co loi active de xac nhan',
        error: {
          code: 'EQUIPMENT_NO_ACTIVE_FAULT',
          details: { healthStatus: equipment.healthStatus },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault-confirmation`,
      });
    }

    // Phase B — ghi audit log (KHÔNG update equipments, KHÔNG transaction entity)
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'confirm',
          entityType: 'equipment',
          entityId: equipment.id,
          newValueJson: {
            confirmationNote: dto.confirmationNote ?? null,
            healthStatusAtConfirmation: equipment.healthStatus,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for equipment fault confirmation ${equipment.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    // Phase C — notify reporter (fail-separate)
    try {
      const reporter = await this.findLastFaultReportAuditLog(equipment.id);
      if (reporter && reporter.userId !== userId) {
        await this.notificationsService.createNotification({
          notificationType: NotificationType.EQUIPMENT_FAULT_CONFIRMED,
          channel: NotificationChannel.IN_APP,
          subject: 'Báo cáo lỗi thiết bị đã được xác nhận',
          content: `Báo cáo lỗi cho thiết bị ${equipment.equipmentName} (${
            equipment.equipmentCode
          }) đã được quản trị viên xác nhận.${
            dto.confirmationNote ? ' Ghi chú: ' + dto.confirmationNote : ''
          }`,
          relatedEntityType: 'equipment',
          relatedEntityId: equipment.id,
          recipientScope: 'user_list',
          recipientUserIds: [reporter.userId],
          priority: NotificationPriority.NORMAL,
          createdBy: userId,
          payloadJson: {
            healthStatus: equipment.healthStatus,
            confirmationNote: dto.confirmationNote ?? null,
          },
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to notify reporter for equipment fault confirmation ${equipment.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    return new EquipmentFaultConfirmationResponseDto({
      equipmentId: equipment.id,
      healthStatus: equipment.healthStatus,
      confirmedBy: userId,
      confirmedAt: new Date(),
    });
  }

  /**
   * EQUIP-FAULT-LIFECYCLE-001 — Cập nhật thiết bị sau khi sửa xong (sysadmin recovery).
   * Phase A: load equipment → healthy/unknown check (409) → snapshot oldValue.
   * Phase B: transaction cập nhật: healthStatus = dto.healthStatus, assetStatus qua resolveAssetAction (nếu có dto.assetStatus),
   *          lastMaintenanceAt = now(), giữ nguyên lastIssueReportedAt / lastIssueNote.
   * Phase C: audit fail-separate (actionType='update', severity=INFO).
   * Phase D: notify reporter (fail-separate).
   */
  async resolveFault(
    equipmentId: string,
    dto: ResolveEquipmentFaultDto,
    userId: string,
    ipAddress?: string,
  ): Promise<EquipmentResponseDto> {
    // Phase A — validate
    const equipment = await this.equipmentRepo.findOne({
      where: { id: equipmentId },
    });
    if (!equipment) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay thiet bi',
        error: {
          code: 'EQUIPMENT_NOT_FOUND',
          details: { equipmentId },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault-resolution`,
      });
    }

    if (
      equipment.healthStatus === HealthStatus.HEALTHY ||
      equipment.healthStatus === HealthStatus.UNKNOWN
    ) {
      throw new ConflictException({
        success: false,
        message:
          'Thiet bi dang o trang thai binh thuong, khong co loi active de khac phuc',
        error: {
          code: 'EQUIPMENT_NO_ACTIVE_FAULT',
          details: { healthStatus: equipment.healthStatus },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault-resolution`,
      });
    }

    const oldValue = {
      healthStatus: equipment.healthStatus,
      assetStatus: equipment.assetStatus,
      lastMaintenanceAt: equipment.lastMaintenanceAt,
    };

    // Phase B — transaction cập nhật
    const saved = await this.dataSource.transaction(async (em) => {
      equipment.healthStatus = dto.healthStatus;
      if (dto.assetStatus) {
        equipment.assetStatus = this.resolveAssetAction(
          dto.assetStatus,
          equipment.currentRoomId,
        );
      }
      equipment.lastMaintenanceAt = new Date();
      // KHÔNG đổi lastIssueReportedAt / lastIssueNote (giữ lịch sử)
      return em.save(EquipmentEntity, equipment);
    });

    // Phase C — audit log fail-separate (severity: INFO, khác WARNING của report)
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'update',
          entityType: 'equipment',
          entityId: saved.id,
          oldValueJson: oldValue,
          newValueJson: {
            healthStatus: saved.healthStatus,
            assetStatus: saved.assetStatus,
            lastMaintenanceAt: saved.lastMaintenanceAt,
            resolutionNote: dto.resolutionNote,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for equipment fault resolution ${saved.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    // Phase D — notify reporter (fail-separate)
    try {
      const reporter = await this.findLastFaultReportAuditLog(saved.id);
      if (reporter && reporter.userId !== userId) {
        await this.notificationsService.createNotification({
          notificationType: NotificationType.EQUIPMENT_FAULT_RESOLVED,
          channel: NotificationChannel.IN_APP,
          subject: 'Báo cáo lỗi thiết bị đã được xử lý xong',
          content: `Báo cáo lỗi cho thiết bị ${saved.equipmentName} (${
            saved.equipmentCode
          }) đã được xử lý xong. Trạng thái hiện tại: ${
            saved.healthStatus
          }. Ghi chú xử lý: ${dto.resolutionNote}`,
          relatedEntityType: 'equipment',
          relatedEntityId: saved.id,
          recipientScope: 'user_list',
          recipientUserIds: [reporter.userId],
          priority: NotificationPriority.NORMAL,
          createdBy: userId,
          payloadJson: {
            healthStatus: saved.healthStatus,
            assetStatus: saved.assetStatus,
            resolutionNote: dto.resolutionNote,
          },
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to notify reporter for equipment fault resolution ${saved.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    return new EquipmentResponseDto({
      id: saved.id,
      equipmentCode: saved.equipmentCode,
      equipmentName: saved.equipmentName,
      equipmentType: saved.equipmentType,
      serialNumber: saved.serialNumber,
      brand: saved.brand,
      model: saved.model,
      purchaseDate: saved.purchaseDate,
      assetStatus: saved.assetStatus,
      healthStatus: saved.healthStatus,
      currentRoomId: saved.currentRoomId,
      createdAt: saved.createdAt,
    });
  }

  /**
   * Lich su bao hong / xac nhan / khac phuc cua 1 thiet bi (GET /equipments/:id/fault-history).
   * Khong co bang rieng — suy ra tu audit_logs (entityType='equipment', entityId=equipmentId),
   * phan loai lai thanh 3 loai su kien qua actionType/severity/newValueJson vi bang audit_logs
   * dung chung cho ca create/assign/report/confirm/resolve/delete:
   *  - reported : actionType='update' + severity=WARNING (ghi trong reportFault)
   *  - confirmed: actionType='confirm'                    (ghi trong confirmFault)
   *  - resolved : actionType='update' + severity=INFO + co key 'resolutionNote'
   *               (phan biet voi assignment cung actionType='update'+INFO nhung khong co key nay)
   */
  async getFaultHistory(
    equipmentId: string,
  ): Promise<EquipmentFaultHistoryItemDto[]> {
    const equipment = await this.equipmentRepo.findOne({
      where: { id: equipmentId },
    });
    if (!equipment) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay thiet bi',
        error: { code: 'EQUIPMENT_NOT_FOUND', details: { equipmentId } },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/fault-history`,
      });
    }

    const rows = await this.dataSource.getRepository(AuditLogEntity).find({
      where: { entityType: 'equipment', entityId: equipmentId },
      relations: { user: true },
      order: { createdAt: 'DESC' },
      take: 50,
    });

    const events: EquipmentFaultHistoryItemDto[] = [];
    for (const row of rows) {
      const nv = (row.newValueJson ?? {}) as Record<string, unknown>;
      let eventType: EquipmentFaultEventType | null = null;
      let note: string | null = null;
      let location: EquipmentFaultLocation | null = null;

      if (row.actionType === 'confirm') {
        eventType = 'confirmed';
        note = (nv.confirmationNote as string | undefined) ?? null;
      } else if (
        row.actionType === 'update' &&
        row.severity === AuditLogSeverity.WARNING
      ) {
        eventType = 'reported';
        note = (nv.lastIssueNote as string | undefined) ?? null;
        location = (nv.location as EquipmentFaultLocation | undefined) ?? null;
      } else if (
        row.actionType === 'update' &&
        row.severity === AuditLogSeverity.INFO &&
        'resolutionNote' in nv
      ) {
        eventType = 'resolved';
        note = (nv.resolutionNote as string | undefined) ?? null;
      }

      if (!eventType) continue;

      events.push(
        new EquipmentFaultHistoryItemDto({
          id: row.id,
          eventType,
          actorId: row.userId,
          actorName: row.user?.fullName ?? null,
          note,
          healthStatus:
            (nv.healthStatus as string | undefined) ??
            (nv.healthStatusAtConfirmation as string | undefined) ??
            null,
          assetStatus: (nv.assetStatus as string | undefined) ?? null,
          location,
          createdAt: row.createdAt,
        }),
      );
    }

    return events;
  }

  /**
   * UC-63 — Xóa mềm thiết bị + gỡ tham chiếu phòng.
   * Soft-delete (DATA-01), CẤM hard-delete. Gỡ tham chiếu phòng + set retired + softDelete
   * + audit ATOMIC trong CÙNG transaction (khác UC-61/62 fail-separate — CHỦ ĐÍCH):
   * audit fail → rollback toàn bộ, đảm bảo mọi lần xóa đều có vết audit.
   */
  async deleteEquipment(
    equipmentId: string,
    userId: string,
    ipAddress?: string,
  ): Promise<void> {
    // Phase A — validate (READ, ngoài transaction)
    // A.1: load thiết bị chưa soft-delete (đã xóa cũng 404 — idempotent)
    const equipment = await this.equipmentRepo.findOne({
      where: { id: equipmentId, deletedAt: IsNull() },
    });
    if (!equipment) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay thiet bi',
        error: {
          code: 'EQUIPMENT_NOT_FOUND',
          details: { equipmentId },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}`,
      });
    }

    // A.2: KHÔNG chặn theo assetStatus (cho xóa thiết bị đang assigned + gỡ tham chiếu)

    // A.3: snapshot trạng thái trước xóa cho audit
    const oldValue = {
      equipmentCode: equipment.equipmentCode,
      equipmentName: equipment.equipmentName,
      equipmentType: equipment.equipmentType,
      serialNumber: equipment.serialNumber,
      assetStatus: equipment.assetStatus,
      healthStatus: equipment.healthStatus,
      currentRoomId: equipment.currentRoomId,
    };

    // Phase B — transaction ATOMIC: gỡ ref + softDelete + audit cùng 1 transaction.
    // Audit fail → rollback (KHÔNG try/catch nuốt lỗi — khác UC-61/62).
    await this.dataSource.transaction(async (tem) => {
      // B.1: gỡ tham chiếu phòng + chuyển retired — UPDATE field TRƯỚC softDelete
      await tem.update(EquipmentEntity, equipmentId, {
        currentRoomId: null,
        assignedBy: null,
        assignedAt: null,
        installedAt: null,
        assignmentNote: null,
        assetStatus: AssetStatus.RETIRED,
      });

      // B.2: soft-delete (set deleted_at) — DATA-01, KHÔNG hard-delete
      await tem.softDelete(EquipmentEntity, equipmentId);

      // B.3: audit ATOMIC trong cùng transaction
      const auditLog = tem.create(AuditLogEntity, {
        userId,
        actionType: 'delete',
        entityType: 'equipment',
        entityId: equipmentId,
        oldValueJson: oldValue,
        ipAddress: ipAddress ?? null,
        severity: AuditLogSeverity.WARNING,
      });
      await tem.save(AuditLogEntity, auditLog);
    });
  }

  /**
   * UC-64 — Tìm kiếm / lọc kho thiết bị (read-only, có phân trang).
   * Mirror listUsersForManagement: query builder + filter AND + Brackets search
   * + SORT_MAP allowlist (chống inject field) + getManyAndCount.
   * KHÔNG department scope (thiết bị là tài sản toàn tổ chức). KHÔNG transaction/audit.
   */
  async listEquipments(
    query: ListEquipmentsQueryDto,
  ): Promise<{ data: EquipmentResponseDto[]; total: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const search = query.search?.trim();

    const qb = this.equipmentRepo
      .createQueryBuilder('e')
      .where('e.deletedAt IS NULL');

    // Filter optional, kết hợp AND — bind param
    if (query.equipmentType) {
      qb.andWhere('e.equipmentType = :equipmentType', {
        equipmentType: query.equipmentType,
      });
    }
    if (query.assetStatus) {
      qb.andWhere('e.assetStatus = :assetStatus', {
        assetStatus: query.assetStatus,
      });
    }
    if (query.healthStatus) {
      qb.andWhere('e.healthStatus = :healthStatus', {
        healthStatus: query.healthStatus,
      });
    }
    if (query.currentRoomId) {
      qb.andWhere('e.currentRoomId = :currentRoomId', {
        currentRoomId: query.currentRoomId,
      });
    }

    // Search ILIKE — Brackets nhóm OR để không phá AND với filter khác
    if (search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('e.equipmentCode ILIKE :s', { s: `%${search}%` })
            .orWhere('e.equipmentName ILIKE :s', { s: `%${search}%` })
            .orWhere('e.serialNumber ILIKE :s', { s: `%${search}%` });
        }),
      );
    }

    // Sort qua allowlist SORT_MAP — KHÔNG đưa sortBy input trực tiếp vào orderBy
    const SORT_MAP: Record<string, string> = {
      equipmentCode: 'e.equipmentCode',
      equipmentName: 'e.equipmentName',
      equipmentType: 'e.equipmentType',
      assetStatus: 'e.assetStatus',
      healthStatus: 'e.healthStatus',
      createdAt: 'e.createdAt',
    };
    const sortColumn = SORT_MAP[query.sortBy ?? 'createdAt'] ?? 'e.createdAt';
    const sortDirection = (query.sortOrder ?? 'desc').toUpperCase() as
      | 'ASC'
      | 'DESC';

    qb.orderBy(sortColumn, sortDirection)
      .skip((page - 1) * limit)
      .take(limit);

    const [rows, total] = await qb.getManyAndCount();

    const data = rows.map(
      (e) =>
        new EquipmentResponseDto({
          id: e.id,
          equipmentCode: e.equipmentCode,
          equipmentName: e.equipmentName,
          equipmentType: e.equipmentType,
          serialNumber: e.serialNumber,
          brand: e.brand,
          model: e.model,
          purchaseDate: e.purchaseDate,
          assetStatus: e.assetStatus,
          healthStatus: e.healthStatus,
          currentRoomId: e.currentRoomId,
          createdAt: e.createdAt,
        }),
    );

    return { data, total };
  }

  /**
   * UC-65 — Phân bổ thiết bị vào phòng họp.
   * Mirror reportFault: Phase A validate → Phase B transaction update → Phase C audit fail-separate.
   * Cross-module: đọc RoomEntity qua dataSource.getRepository (CHỈ ĐỌC, KHÔNG đổi constructor).
   * Thứ tự validate cố định: equipment 404 → equipment 409 → room 404 → room 409.
   */
  async assignToRoom(
    equipmentId: string,
    dto: AssignEquipmentDto,
    userId: string,
    ipAddress?: string,
  ): Promise<EquipmentResponseDto> {
    // Phase A — validate (READ, ngoài transaction)
    // A.1: load equipment (chưa soft-delete)
    const equipment = await this.equipmentRepo.findOne({
      where: { id: equipmentId, deletedAt: IsNull() },
    });
    if (!equipment) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay thiet bi',
        error: {
          code: 'EQUIPMENT_NOT_FOUND',
          details: { equipmentId },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/assignment`,
      });
    }

    // A.2: thiết bị phải available hoặc assigned mới gán được
    if (
      equipment.assetStatus !== AssetStatus.AVAILABLE &&
      equipment.assetStatus !== AssetStatus.ASSIGNED
    ) {
      throw new ConflictException({
        success: false,
        message:
          'Thiet bi khong o trang thai co the gan (retired/lost/maintenance)',
        error: {
          code: 'EQUIPMENT_NOT_ASSIGNABLE',
          details: { assetStatus: equipment.assetStatus },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/assignment`,
      });
    }

    // A.3: load room qua getRepository (cross-module, CHỈ ĐỌC — KHÔNG đổi constructor)
    const room = await this.dataSource
      .getRepository(RoomEntity)
      .findOne({ where: { id: dto.roomId, deletedAt: IsNull() } });
    if (!room) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay phong hop',
        error: {
          code: 'ROOM_NOT_FOUND',
          details: { roomId: dto.roomId },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/assignment`,
      });
    }

    // A.4: phòng phải active và không inactive mới nhận được thiết bị
    if (
      !(room.isActive === true && room.currentStatus !== RoomStatus.INACTIVE)
    ) {
      throw new ConflictException({
        success: false,
        message: 'Phong khong o trang thai nhan duoc thiet bi',
        error: {
          code: 'ROOM_NOT_ASSIGNABLE',
          details: {
            roomId: dto.roomId,
            isActive: room.isActive,
            currentStatus: room.currentStatus,
          },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/assignment`,
      });
    }

    // A.5: phòng phải đã đăng ký đúng loại thiết bị này (vd: không cho gán
    // mic vào phòng chỉ đăng ký camera + TV) — chặn ngay, báo chi tiết loại
    // thiết bị phòng đã đăng ký.
    this.assertRoomRegisteredForEquipmentType(
      room,
      equipment.equipmentType as EquipmentType,
      `${EQUIPMENTS_PATH}/${equipmentId}/assignment`,
    );

    // A.6: snapshot trạng thái cũ cho audit
    const oldValue = {
      currentRoomId: equipment.currentRoomId,
      assetStatus: equipment.assetStatus,
    };

    // Phase B — cập nhật trong transaction (re-assign / gán lại đều đi qua nhánh này)
    const saved = await this.dataSource.transaction(async (em) => {
      equipment.currentRoomId = dto.roomId;
      equipment.assetStatus = AssetStatus.ASSIGNED;
      equipment.assignedBy = userId;
      equipment.assignedAt = new Date();
      equipment.installedAt = dto.installedAt
        ? new Date(dto.installedAt)
        : new Date();
      equipment.assignmentNote = dto.assignmentNote ?? null;
      return em.save(EquipmentEntity, equipment);
    });

    // Phase C — audit fail-separate (transaction riêng, không rollback gán)
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'update',
          entityType: 'equipment',
          entityId: saved.id,
          oldValueJson: oldValue,
          newValueJson: {
            currentRoomId: saved.currentRoomId,
            assetStatus: saved.assetStatus,
            assignedBy: saved.assignedBy,
            assignedAt: saved.assignedAt,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for equipment assignment ${saved.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    // Map response — tái dùng EquipmentResponseDto (UC-61)
    return new EquipmentResponseDto({
      id: saved.id,
      equipmentCode: saved.equipmentCode,
      equipmentName: saved.equipmentName,
      equipmentType: saved.equipmentType,
      serialNumber: saved.serialNumber,
      brand: saved.brand,
      model: saved.model,
      purchaseDate: saved.purchaseDate,
      assetStatus: saved.assetStatus,
      healthStatus: saved.healthStatus,
      currentRoomId: saved.currentRoomId,
      createdAt: saved.createdAt,
    });
  }

  /**
   * Gỡ thiết bị khỏi phòng hiện tại — ngược lại của assignToRoom (UC-65).
   * Mirror assignToRoom: Phase A validate → Phase B transaction update →
   * Phase C audit fail-separate. Thiết bị đang MAINTENANCE/RETIRED/LOST vẫn
   * được gỡ khỏi phòng (chỉ clear tham chiếu phòng), KHÔNG tự đổi những
   * assetStatus đó — chỉ đưa ASSIGNED -> AVAILABLE.
   */
  async unassignFromRoom(
    equipmentId: string,
    userId: string,
    ipAddress?: string,
  ): Promise<EquipmentResponseDto> {
    // Phase A — validate
    const equipment = await this.equipmentRepo.findOne({
      where: { id: equipmentId, deletedAt: IsNull() },
    });
    if (!equipment) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay thiet bi',
        error: {
          code: 'EQUIPMENT_NOT_FOUND',
          details: { equipmentId },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/assignment`,
      });
    }

    if (!equipment.currentRoomId) {
      throw new ConflictException({
        success: false,
        message: 'Thiet bi hien khong duoc gan vao phong nao',
        error: {
          code: 'EQUIPMENT_NOT_ASSIGNED',
          details: { equipmentId },
        },
        timestamp: new Date().toISOString(),
        path: `${EQUIPMENTS_PATH}/${equipmentId}/assignment`,
      });
    }

    const oldValue = {
      currentRoomId: equipment.currentRoomId,
      assetStatus: equipment.assetStatus,
    };

    // Phase B — cập nhật trong transaction
    const saved = await this.dataSource.transaction(async (em) => {
      equipment.currentRoomId = null;
      equipment.assignedBy = null;
      equipment.assignedAt = null;
      equipment.installedAt = null;
      equipment.assignmentNote = null;
      if (equipment.assetStatus === AssetStatus.ASSIGNED) {
        equipment.assetStatus = AssetStatus.AVAILABLE;
      }
      return em.save(EquipmentEntity, equipment);
    });

    // Phase C — audit fail-separate (transaction riêng, không rollback gỡ)
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'update',
          entityType: 'equipment',
          entityId: saved.id,
          oldValueJson: oldValue,
          newValueJson: {
            currentRoomId: saved.currentRoomId,
            assetStatus: saved.assetStatus,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for equipment unassignment ${saved.id}: ${
          err instanceof Error ? err.message : 'Unknown'
        }`,
      );
    }

    return new EquipmentResponseDto({
      id: saved.id,
      equipmentCode: saved.equipmentCode,
      equipmentName: saved.equipmentName,
      equipmentType: saved.equipmentType,
      serialNumber: saved.serialNumber,
      brand: saved.brand,
      model: saved.model,
      purchaseDate: saved.purchaseDate,
      assetStatus: saved.assetStatus,
      healthStatus: saved.healthStatus,
      currentRoomId: saved.currentRoomId,
      createdAt: saved.createdAt,
    });
  }

  /**
   * Danh sách phòng đã đăng ký có thiết bị (has_camera/has_microphone/
   * has_display) nhưng chưa có Equipment thực tế (currentRoomId) tương ứng
   * loại đó — dùng cho banner nhắc nhở Business Admin gán thiết bị còn thiếu.
   * Thiết bị RETIRED/LOST không tính là "đã có" (coi như không còn ở phòng đó
   * trên thực tế dù currentRoomId có thể còn sót do luồng report-fault).
   */
  async getRoomsMissingEquipment(): Promise<{
    data: RoomEquipmentGapItemDto[];
    totalRoomsMissing: number;
  }> {
    const rows: Array<{
      id: string;
      room_code: string;
      room_name: string;
      has_camera: boolean;
      has_microphone: boolean;
      has_display: boolean;
      camera_count: string;
      microphone_count: string;
      display_count: string;
    }> = await this.dataSource.manager.query(
      `SELECT r.id, r.room_code, r.room_name,
              r.has_camera, r.has_microphone, r.has_display,
              COUNT(*) FILTER (WHERE e.equipment_type = 'camera') AS camera_count,
              COUNT(*) FILTER (WHERE e.equipment_type = 'microphone') AS microphone_count,
              COUNT(*) FILTER (WHERE e.equipment_type = 'display') AS display_count
         FROM rooms r
         LEFT JOIN equipments e
           ON e.current_room_id = r.id
          AND e.deleted_at IS NULL
          AND e.asset_status NOT IN ('retired', 'lost')
        WHERE r.is_active = true
          AND r.deleted_at IS NULL
          AND (r.has_camera OR r.has_microphone OR r.has_display)
        GROUP BY r.id, r.room_code, r.room_name, r.has_camera, r.has_microphone, r.has_display
        ORDER BY r.room_code ASC`,
    );

    const data: RoomEquipmentGapItemDto[] = [];
    for (const row of rows) {
      const missingTypes: EquipmentType[] = [];
      if (row.has_camera && Number(row.camera_count) === 0) {
        missingTypes.push(EquipmentType.CAMERA);
      }
      if (row.has_microphone && Number(row.microphone_count) === 0) {
        missingTypes.push(EquipmentType.MICROPHONE);
      }
      if (row.has_display && Number(row.display_count) === 0) {
        missingTypes.push(EquipmentType.DISPLAY);
      }
      if (missingTypes.length === 0) continue;

      data.push(
        new RoomEquipmentGapItemDto({
          roomId: row.id,
          roomCode: row.room_code,
          roomName: row.room_name,
          missingTypes,
          missingTypeLabels: missingTypes.map(
            (t) => ROOM_EQUIPMENT_TYPE_LABELS[t] ?? t,
          ),
        }),
      );
    }

    return { data, totalRoomsMissing: data.length };
  }
}
