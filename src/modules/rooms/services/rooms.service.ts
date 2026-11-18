import {
  Injectable,
  Logger,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository, EntityManager } from 'typeorm';
import { RoomEntity, RoomStatus } from '../entities/room.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { CreateRoomDto } from '../dto/create-room.dto.js';
import { CreateRoomResponseDto } from '../dto/create-room-response.dto.js';
import { UpdateRoomDto } from '../dto/update-room.dto.js';
import { UpdateRoomResponseDto } from '../dto/update-room-response.dto.js';
import { UpdateRoomAdministrativeStatusDto } from '../dto/update-room-administrative-status.dto.js';
import { UpdateRoomAdministrativeStatusResponseDto } from '../dto/update-room-administrative-status-response.dto.js';
import { DeletionImpactResponseDto } from '../dto/deletion-impact-response.dto.js';
import { DeleteRoomResponseDto } from '../dto/delete-room-response.dto.js';
import { WebsocketService } from '../../websocket/websocket.service.js';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../entities/room-booking.entity.js';
import {
  MeetingEventEntity,
  MeetingEventType,
  MeetingEventSourceType,
} from '../../meetings/entities/meeting-event.entity.js';
import { RoomEventEntity } from '../entities/room-event.entity.js';
import {
  EquipmentEntity,
  EquipmentType,
  AssetStatus as EquipmentAssetStatus,
} from '../../equipment/entities/equipment.entity.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
  NotificationPriority,
} from '../../notifications/entities/notification.entity.js';
import { BackgroundJobsService } from '../../administration/services/background-jobs.service.js';
import { BackgroundJobType } from '../../administration/entities/background-job.entity.js';
import { RoomDeleteNotificationProcessor } from './room-delete-notification.processor.js';
import { RoomStatusService } from './room-status.service.js';
import {
  RoomDetailResponseDto,
  RoomDetailBookingRefDto,
  RoomDetailUserRefDto,
  RoomDetailOccupancyStatusDto,
} from '../dto/room-detail-response.dto.js';

const ACTIVE_ROOM_BOOKING_STATUSES = [
  RoomBookingStatus.PENDING,
  RoomBookingStatus.APPROVED,
  RoomBookingStatus.ACTIVE,
];

@Injectable()
export class RoomsService {
  private readonly logger = new Logger(RoomsService.name);

  constructor(
    @InjectRepository(RoomEntity)
    private readonly roomRepo: Repository<RoomEntity>,
    private readonly dataSource: DataSource,
    private readonly websocketService: WebsocketService,
    private readonly backgroundJobsService: BackgroundJobsService,
    private readonly roomDeleteNotificationProcessor: RoomDeleteNotificationProcessor,
    private readonly roomStatusService: RoomStatusService,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * Helper Lay danh sach ID nguoi dung co role BUSINESS_ADMIN.
   * Mirror EquipmentService.resolveBusinessAdminIds().
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
   * Kiem tra roomCode da ton tai trong DB (ke ca soft delete).
   */
  private async checkDuplicateRoomCode(code: string): Promise<void> {
    const existing = await this.roomRepo.findOne({
      where: { roomCode: code },
      withDeleted: true,
    });
    if (existing) {
      throw new ConflictException({
        success: false,
        message: 'Mã phòng đã tồn tại',
        error: {
          code: 'ROOM_CODE_ALREADY_EXISTS',
          details: { roomCode: code },
        },
        timestamp: new Date().toISOString(),
        path: '/api/v1/rooms',
      });
    }
  }

  /**
   * Kiem tra roomName da ton tai trong so phong chua bi soft delete (case-insensitive, trim).
   * excludeRoomId: loai tru chinh ban ghi dang sua (dung cho update()), khong truyen khi tao moi.
   */
  private async checkDuplicateRoomName(
    name: string,
    excludeRoomId?: string,
  ): Promise<void> {
    const trimmed = name.trim();
    const qb = this.roomRepo
      .createQueryBuilder('room')
      .where('LOWER(TRIM(room.roomName)) = LOWER(:name)', { name: trimmed })
      .andWhere('room.deletedAt IS NULL');
    if (excludeRoomId) {
      qb.andWhere('room.id != :excludeRoomId', { excludeRoomId });
    }
    const existing = await qb.getOne();
    if (existing) {
      throw new ConflictException({
        success: false,
        message:
          'Tên phòng họp này đã tồn tại. Vui lòng chọn một tên gọi khác.',
        error: {
          code: 'ROOM_NAME_ALREADY_EXISTS',
          details: { roomName: name },
        },
        timestamp: new Date().toISOString(),
        path: '/api/v1/rooms',
      });
    }
  }

  /**
   * Tao phong hop moi.
   * Transaction: tao room trong transaction, audit log ben ngoai
   * de dam bao FR-019: audit log fail khong rollback room.
   */
  async create(
    dto: CreateRoomDto,
    userId: string,
    ipAddress?: string,
  ): Promise<CreateRoomResponseDto> {
    // Normalize input
    const roomCode = dto.roomCode.toUpperCase().trim();
    const roomName = dto.roomName.trim();

    // Check duplicates
    await this.checkDuplicateRoomCode(roomCode);
    await this.checkDuplicateRoomName(roomName);

    // Tao room trong transaction
    const saved = await this.dataSource.transaction(async (em) => {
      const room = em.create(RoomEntity, {
        roomCode,
        roomName,
        siteName: dto.siteName ?? null,
        areaName: dto.areaName ?? null,
        locationDescription: dto.locationDescription ?? null,
        capacity: dto.capacity,
        roomType: dto.roomType ?? undefined,
        hasCamera: dto.hasCamera ?? false,
        hasMicrophone: dto.hasMicrophone ?? false,
        hasDisplay: dto.hasDisplay ?? false,
        allowRecording: dto.allowRecording ?? false,
        currentStatus: RoomStatus.AVAILABLE,
        isActive: true,
        createdBy: userId,
        updatedBy: userId,
      });
      return em.save(RoomEntity, room);
    });

    // Ghi audit log BEN NGOAI transaction — fail-separate
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'create',
          entityType: 'room',
          entityId: saved.id,
          newValueJson: {
            roomCode: saved.roomCode,
            roomName: saved.roomName,
            capacity: saved.capacity,
            roomType: saved.roomType,
            currentStatus: saved.currentStatus,
            isActive: saved.isActive,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      // FR-019: audit log fail KHONG rollback room creation
      this.logger.error(
        `Failed to write audit log for room ${saved.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    return new CreateRoomResponseDto({
      id: saved.id,
      roomCode: saved.roomCode,
      roomName: saved.roomName,
      capacity: saved.capacity,
      currentStatus: saved.currentStatus,
      isActive: saved.isActive,
      createdAt: saved.createdAt,
    });
  }

  /**
   * Cap nhat thong tin phong hop (UC-ROOM-02).
   * roomCode/currentStatus/isActive bat bien qua endpoint nay.
   */
  async update(
    roomId: string,
    dto: UpdateRoomDto,
    userId: string,
    ipAddress?: string,
  ): Promise<UpdateRoomResponseDto> {
    const room = await this.roomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException({
        success: false,
        message: 'Phòng họp không tồn tại',
        error: { code: 'ROOM_NOT_FOUND', details: { roomId } },
        timestamp: new Date().toISOString(),
        path: `/api/v1/rooms/${roomId}`,
      });
    }

    const roomName =
      dto.roomName !== undefined ? dto.roomName.trim() : room.roomName;
    const areaName =
      dto.areaName !== undefined ? dto.areaName.trim() : room.areaName;

    // BR1: ten phong phai duy nhat, loai tru chinh ban ghi dang sua
    // Chi kiem tra khi client thuc su doi roomName (partial update - BUG-007)
    if (dto.roomName !== undefined) {
      await this.checkDuplicateRoomName(roomName, roomId);
    }

    const oldValueJson = {
      roomName: room.roomName,
      siteName: room.siteName,
      areaName: room.areaName,
      locationDescription: room.locationDescription,
      capacity: room.capacity,
      roomType: room.roomType,
      hasCamera: room.hasCamera,
      hasMicrophone: room.hasMicrophone,
      hasDisplay: room.hasDisplay,
      allowRecording: room.allowRecording,
    };

    const { saved, autoUnassignedEquipments } =
      await this.dataSource.transaction(async (em) => {
        room.roomName = roomName;
        room.areaName = areaName;
        if (dto.capacity !== undefined) room.capacity = dto.capacity;
        if (dto.siteName !== undefined) room.siteName = dto.siteName;
        if (dto.locationDescription !== undefined)
          room.locationDescription = dto.locationDescription;
        if (dto.roomType !== undefined) room.roomType = dto.roomType;
        if (dto.hasCamera !== undefined) room.hasCamera = dto.hasCamera;
        if (dto.hasMicrophone !== undefined)
          room.hasMicrophone = dto.hasMicrophone;
        if (dto.hasDisplay !== undefined) room.hasDisplay = dto.hasDisplay;
        if (dto.allowRecording !== undefined)
          room.allowRecording = dto.allowRecording;
        room.updatedBy = userId;
        // roomCode/currentStatus/isActive/createdBy/createdAt: khong dong den
        const savedRoom = await em.save(RoomEntity, room);

        // BAO_CAO 2026-08-23: khi co/mic/man hinh cua phong vua bi TAT
        // (true -> false), thiet bi loai do dang gan phong nay phai duoc
        // TU DONG GO — tranh trang thai vo ly "phong khong con mic nhung
        // mic B van dang gan phong". Doi xung logic go thiet bi o deleteRoom
        // (UC-63): mutation + audit log cung nam trong transaction chinh.
        const removedTypes: EquipmentType[] = [];
        if (oldValueJson.hasCamera && savedRoom.hasCamera === false) {
          removedTypes.push(EquipmentType.CAMERA);
        }
        if (oldValueJson.hasMicrophone && savedRoom.hasMicrophone === false) {
          removedTypes.push(EquipmentType.MICROPHONE);
        }
        if (oldValueJson.hasDisplay && savedRoom.hasDisplay === false) {
          removedTypes.push(EquipmentType.DISPLAY);
        }

        const autoUnassignedEquipments: Array<{
          id: string;
          equipmentCode: string;
          equipmentName: string;
          equipmentType: EquipmentType;
        }> = [];

        if (removedTypes.length > 0) {
          const affected = await em
            .createQueryBuilder(EquipmentEntity, 'equipment')
            .where('equipment.currentRoomId = :roomId', { roomId })
            .andWhere('equipment.equipmentType IN (:...types)', {
              types: removedTypes,
            })
            .andWhere('equipment.deletedAt IS NULL')
            .getMany();

          for (const eq of affected) {
            const oldEquipmentValue = {
              currentRoomId: eq.currentRoomId,
              assetStatus: eq.assetStatus,
            };
            eq.currentRoomId = null;
            eq.assignedBy = null;
            eq.assignedAt = null;
            eq.installedAt = null;
            eq.assignmentNote = null;
            if (eq.assetStatus === EquipmentAssetStatus.ASSIGNED) {
              eq.assetStatus = EquipmentAssetStatus.AVAILABLE;
            }
            await em.save(EquipmentEntity, eq);

            const equipmentAuditLog = em.create(AuditLogEntity, {
              userId,
              actionType: 'update',
              entityType: 'equipment',
              entityId: eq.id,
              oldValueJson: oldEquipmentValue,
              newValueJson: {
                currentRoomId: null,
                assetStatus: eq.assetStatus,
                reason: 'room_config_updated',
                roomId,
              },
              ipAddress: ipAddress ?? null,
              severity: AuditLogSeverity.INFO,
            });
            await em.save(AuditLogEntity, equipmentAuditLog);

            autoUnassignedEquipments.push({
              id: eq.id,
              equipmentCode: eq.equipmentCode,
              equipmentName: eq.equipmentName,
              equipmentType: eq.equipmentType,
            });
          }
        }

        return { saved: savedRoom, autoUnassignedEquipments };
      });

    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'update',
          entityType: 'room',
          entityId: saved.id,
          oldValueJson,
          newValueJson: {
            roomName: saved.roomName,
            siteName: saved.siteName,
            areaName: saved.areaName,
            locationDescription: saved.locationDescription,
            capacity: saved.capacity,
            roomType: saved.roomType,
            hasCamera: saved.hasCamera,
            hasMicrophone: saved.hasMicrophone,
            hasDisplay: saved.hasDisplay,
            allowRecording: saved.allowRecording,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      // Audit log fail KHONG rollback update (dong nhat pattern create())
      this.logger.error(
        `Failed to write audit log for room update ${saved.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    // BAO_CAO 2026-08-23 — bao BUSINESS_ADMIN khi co thiet bi bi TU DONG GO do
    // doi cau hinh phong (fail-separate, KHONG rollback nghiep vu update()).
    if (autoUnassignedEquipments.length > 0) {
      try {
        const adminIds = await this.resolveBusinessAdminIds();
        const equipmentListText = autoUnassignedEquipments
          .map((eq) => `${eq.equipmentName} (${eq.equipmentCode})`)
          .join(', ');
        await this.notificationsService.createNotification({
          notificationType: NotificationType.EQUIPMENT_AUTO_UNASSIGNED,
          channel: NotificationChannel.IN_APP,
          subject: 'Thiết bị đã được tự động gỡ khỏi phòng',
          content: `Phòng ${saved.roomName} vừa cập nhật cấu hình (tắt loại thiết bị không còn sử dụng), hệ thống đã tự động gỡ ${autoUnassignedEquipments.length} thiết bị đang gán tại phòng này: ${equipmentListText}. Vui lòng kiểm tra tại Equipment Manager.`,
          relatedEntityType: 'room',
          relatedEntityId: saved.id,
          recipientScope: 'user_list',
          recipientUserIds: adminIds,
          priority: NotificationPriority.HIGH,
          createdBy: userId,
          payloadJson: {
            roomId: saved.id,
            roomName: saved.roomName,
            autoUnassignedEquipments,
          },
        });
      } catch (err) {
        this.logger.error(
          `Failed to notify BUSINESS_ADMIN for equipment auto-unassigned by room ${saved.id}: ${
            err instanceof Error ? err.message : 'Unknown'
          }`,
        );
      }
    }

    this.websocketService.broadcast('room.updated', {
      roomId: saved.id,
      roomName: saved.roomName,
      siteName: saved.siteName,
      areaName: saved.areaName,
      locationDescription: saved.locationDescription,
      capacity: saved.capacity,
      roomType: saved.roomType,
      hasCamera: saved.hasCamera,
      hasMicrophone: saved.hasMicrophone,
      hasDisplay: saved.hasDisplay,
      allowRecording: saved.allowRecording,
      updatedAt: saved.updatedAt,
    });

    return new UpdateRoomResponseDto({
      id: saved.id,
      roomCode: saved.roomCode,
      roomName: saved.roomName,
      siteName: saved.siteName,
      areaName: saved.areaName,
      locationDescription: saved.locationDescription,
      capacity: saved.capacity,
      roomType: saved.roomType,
      currentStatus: saved.currentStatus,
      hasCamera: saved.hasCamera,
      hasMicrophone: saved.hasMicrophone,
      hasDisplay: saved.hasDisplay,
      allowRecording: saved.allowRecording,
      isActive: saved.isActive,
      updatedAt: saved.updatedAt,
    });
  }

  /**
   * Dat/go trang thai CHU DONG cua phong (maintenance/inactive/available),
   * tach bach hoan toan khoi `currentStatus` (cot do OccupancyPersistenceService
   * ghi tu presence camera — khong dung chung de tranh xung dot ghi). Gia tri
   * nay uu tien cao nhat khi RoomSearchService/RoomStatusService tinh trang
   * thai hien thi real-time (xem migration 20260819000004).
   */
  async updateAdministrativeStatus(
    roomId: string,
    dto: UpdateRoomAdministrativeStatusDto,
    userId: string,
    ipAddress?: string,
  ): Promise<UpdateRoomAdministrativeStatusResponseDto> {
    const room = await this.roomRepo.findOne({
      where: { id: roomId, deletedAt: IsNull() },
    });
    if (!room) {
      throw new NotFoundException({
        success: false,
        message: 'Phòng họp không tồn tại',
        error: { code: 'ROOM_NOT_FOUND', details: { roomId } },
        timestamp: new Date().toISOString(),
        path: `/api/v1/rooms/${roomId}/administrative-status`,
      });
    }

    const oldStatus = room.administrativeStatus;

    const saved = await this.dataSource.transaction(async (em) => {
      room.administrativeStatus = dto.status as RoomStatus;
      room.updatedBy = userId;
      return em.save(RoomEntity, room);
    });

    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'update',
          entityType: 'room',
          entityId: saved.id,
          oldValueJson: { administrativeStatus: oldStatus },
          newValueJson: {
            administrativeStatus: saved.administrativeStatus,
            reason: dto.reason ?? null,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      // Audit log fail KHONG rollback update (dong nhat pattern update()).
      this.logger.error(
        `Failed to write audit log for room administrative-status update ${saved.id}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    this.websocketService.broadcast('room.status.updated', {
      roomId: saved.id,
      administrativeStatus: saved.administrativeStatus,
      updatedAt: saved.updatedAt,
    });

    return new UpdateRoomAdministrativeStatusResponseDto({
      roomId: saved.id,
      administrativeStatus: saved.administrativeStatus,
      updatedAt: saved.updatedAt,
    });
  }

  /**
   * Cuoc hop TUONG LAI DA DUYET (status=SCHEDULED) tai phong nay (2026-08-16,
   * dao nguoc BR2 cu). Cac cuoc hop nay CHAN xoa phong hoan toan — admin phai
   * tu doi phong/huy truoc khi xoa duoc (khong con null-hoa roomId ngam nua).
   */
  private async findFutureScheduledMeetings(
    roomId: string,
    manager?: EntityManager,
  ): Promise<MeetingEntity[]> {
    const em = manager ?? this.dataSource.manager;
    return em
      .createQueryBuilder(MeetingEntity, 'meeting')
      .where('meeting.roomId = :roomId', { roomId })
      .andWhere('meeting.startTime > :now', { now: new Date() })
      .andWhere('meeting.status = :scheduled', {
        scheduled: MeetingStatus.SCHEDULED,
      })
      .getMany();
  }

  /**
   * Cuoc hop TUONG LAI CHUA DUYET (DRAFT/PENDING_APPROVAL) tai phong nay.
   * Cac cuoc hop nay KHONG chan xoa phong — van null hoa roomId + gui thong
   * bao cho host/manager (BR2 cu chi con ap dung cho nhom nay).
   */
  private async findFuturePendingMeetings(
    roomId: string,
    manager?: EntityManager,
  ): Promise<MeetingEntity[]> {
    const em = manager ?? this.dataSource.manager;
    return em
      .createQueryBuilder(MeetingEntity, 'meeting')
      .where('meeting.roomId = :roomId', { roomId })
      .andWhere('meeting.startTime > :now', { now: new Date() })
      .andWhere('meeting.status IN (:...statuses)', {
        statuses: [MeetingStatus.DRAFT, MeetingStatus.PENDING_APPROVAL],
      })
      .getMany();
  }

  /**
   * EX1: chan xoa neu phong dang co cuoc hop "dang dien ra" tai thoi diem hien tai.
   * Chan theo CA 2 tin hieu: status=in_progress HOAC (status=scheduled va now
   * nam trong [startTime,endTime]) — khong bo sot cuoc hop dang trong gio nhung
   * chua ai bam Start tren live-meeting.
   */
  private async hasBlockingInProgressMeeting(
    roomId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const em = manager ?? this.dataSource.manager;
    const now = new Date();
    const count = await em
      .createQueryBuilder(MeetingEntity, 'meeting')
      .where('meeting.roomId = :roomId', { roomId })
      .andWhere(
        '(meeting.status = :inProgress OR (meeting.status = :scheduled AND meeting.startTime <= :now AND meeting.endTime >= :now))',
        {
          inProgress: MeetingStatus.IN_PROGRESS,
          scheduled: MeetingStatus.SCHEDULED,
          now,
        },
      )
      .getCount();
    return count > 0;
  }

  /**
   * Xem truoc tac dong cua viec xoa phong (UC-ROOM-03, preview — read-only).
   */
  async getDeletionImpact(roomId: string): Promise<DeletionImpactResponseDto> {
    const room = await this.roomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException({
        success: false,
        message: 'Phòng họp không tồn tại',
        error: { code: 'ROOM_NOT_FOUND', details: { roomId } },
      });
    }

    const [
      scheduledMeetings,
      pendingMeetings,
      blockedByInProgressMeeting,
      assignedEquipmentCount,
    ] = await Promise.all([
      this.findFutureScheduledMeetings(roomId),
      this.findFuturePendingMeetings(roomId),
      this.hasBlockingInProgressMeeting(roomId),
      this.countAssignedEquipment(roomId),
    ]);

    return new DeletionImpactResponseDto({
      roomId: room.id,
      roomName: room.roomName,
      canDelete: scheduledMeetings.length === 0 && !blockedByInProgressMeeting,
      blockedByInProgressMeeting,
      blockingMeetings: scheduledMeetings.map((m) => ({
        id: m.id,
        title: m.title,
        startTime: m.startTime,
        endTime: m.endTime,
      })),
      pendingMeetingCount: pendingMeetings.length,
      assignedEquipmentCount,
    });
  }

  /**
   * So thiet bi (equipments, chua soft-delete) dang gan phong nay — khong
   * chan xoa phong (khac EX1/EX2), chi de hien thi preview. Khi xoa that,
   * cac thiet bi nay se duoc TU DONG GO trong deleteRoom() (xem countAssignedEquipment
   * duoc goi lai ben trong transaction de lay danh sach).
   */
  private async countAssignedEquipment(
    roomId: string,
    manager?: EntityManager,
  ): Promise<number> {
    const em = manager ?? this.dataSource.manager;
    return em
      .createQueryBuilder(EquipmentEntity, 'equipment')
      .where('equipment.currentRoomId = :roomId', { roomId })
      .andWhere('equipment.deletedAt IS NULL')
      .getCount();
  }

  /**
   * Xoa phong hop (soft-delete, UC-ROOM-03 — sua 2026-08-16). Khong dung du
   * lieu qua khu (BR1). CHAN HOAN TOAN neu con cuoc hop TUONG LAI DA DUYET
   * (status=SCHEDULED) tai phong nay — admin phai tu doi phong/huy cac cuoc
   * hop do truoc (qua UC-MM-03), khong con am tham null-hoa roomId cua meeting
   * da duyet nua (dao nguoc BR2 cu, thay bang EX2 moi). Cuoc hop DRAFT/
   * PENDING_APPROVAL van duoc phep "mat phong" nhu cu (null hoa + thong bao
   * host/manager), vi chua ai chinh thuc dua vao lich.
   */
  async deleteRoom(
    roomId: string,
    userId: string,
    ipAddress?: string,
  ): Promise<DeleteRoomResponseDto> {
    const room = await this.roomRepo.findOne({ where: { id: roomId } });
    if (!room) {
      throw new NotFoundException({
        success: false,
        message: 'Phòng họp không tồn tại',
        error: { code: 'ROOM_NOT_FOUND', details: { roomId } },
      });
    }

    // EX1: tinh lai tai dung thoi diem xoa, KHONG tin ket qua preview cu.
    const blocked = await this.hasBlockingInProgressMeeting(roomId);
    if (blocked) {
      throw new ConflictException({
        success: false,
        message:
          'Phòng họp đang được sử dụng ở thời điểm hiện tại. Vui lòng chờ cuộc họp kết thúc trước khi thực hiện thao tác xóa.',
        error: { code: 'ROOM_IN_USE', details: { roomId } },
      });
    }

    // EX2 (moi, 2026-08-16): tinh lai tai dung thoi diem xoa, KHONG tin ket
    // qua preview cu — chan hoan toan neu con cuoc hop tuong lai DA DUYET.
    const scheduledMeetings = await this.findFutureScheduledMeetings(roomId);
    if (scheduledMeetings.length > 0) {
      throw new ConflictException({
        success: false,
        message: `Phòng họp đang được đặt cho ${scheduledMeetings.length} cuộc họp đã duyệt trong tương lai. Vui lòng đổi phòng hoặc hủy các cuộc họp này trước khi xóa.`,
        error: {
          code: 'ROOM_HAS_SCHEDULED_MEETINGS',
          details: {
            roomId,
            meetings: scheduledMeetings.map((m) => ({
              id: m.id,
              title: m.title,
              startTime: m.startTime,
              endTime: m.endTime,
            })),
          },
        },
      });
    }

    const { meetingIds: affectedMeetingIds, affectedEquipmentCount } =
      await this.dataSource.transaction(async (em) => {
      const affectedMeetings = await this.findFuturePendingMeetings(roomId, em);

      // (a) soft-delete rooms
      await em.softRemove(RoomEntity, room);

      const meetingIds: string[] = [];
      for (const meeting of affectedMeetings) {
        // (b) release cac room_bookings tuong lai lien quan (chi status con hop le)
        const bookings = await em
          .createQueryBuilder(RoomBookingEntity, 'booking')
          .where('booking.meetingId = :meetingId', { meetingId: meeting.id })
          .andWhere('booking.roomId = :roomId', { roomId })
          .andWhere('booking.status IN (:...statuses)', {
            statuses: ACTIVE_ROOM_BOOKING_STATUSES,
          })
          .getMany();
        for (const booking of bookings) {
          booking.status = RoomBookingStatus.RELEASED;
          await em.save(RoomBookingEntity, booking);
        }

        // (c) null hoa roomId cua meeting — KHONG doi status (BR2)
        meeting.roomId = null;
        await em.save(MeetingEntity, meeting);

        // (d) ghi MeetingEventEntity cho tung meeting
        const meetingEvent = em.create(MeetingEventEntity, {
          meetingId: meeting.id,
          eventType: MeetingEventType.ROOM_CHANGED,
          actorUserId: userId,
          sourceType: MeetingEventSourceType.SYSTEM,
          description:
            'Phòng họp đã bị xóa khỏi hệ thống, cần chọn lại địa điểm.',
          oldValueJson: { roomId },
          newValueJson: { roomId: null },
        });
        await em.save(MeetingEventEntity, meetingEvent);

        meetingIds.push(meeting.id);
      }

      // (e) ghi 1 RoomEventEntity cho phong
      const roomEvent = em.create(RoomEventEntity, {
        roomId,
        meetingId: null,
        bookingId: null,
        eventType: 'room_deleted',
        sourceType: 'admin',
      });
      await em.save(RoomEventEntity, roomEvent);

      // (f) TU DONG GO cac thiet bi dang gan phong nay (khong chan xoa phong
      // — BA khong phai tu go tung thiet bi truoc; quyet dinh chot voi PM
      // 2026-08-23, doi xung voi logic go tham chieu phong o deleteEquipment
      // UC-63). Thiet bi ve trang thai AVAILABLE neu dang ASSIGNED; giu
      // nguyen assetStatus neu dang MAINTENANCE/RETIRED/LOST (khong lien quan
      // phong bi xoa).
      const assignedEquipments = await em
        .createQueryBuilder(EquipmentEntity, 'equipment')
        .where('equipment.currentRoomId = :roomId', { roomId })
        .andWhere('equipment.deletedAt IS NULL')
        .getMany();
      for (const eq of assignedEquipments) {
        const oldValue = {
          currentRoomId: eq.currentRoomId,
          assetStatus: eq.assetStatus,
        };
        eq.currentRoomId = null;
        eq.assignedBy = null;
        eq.assignedAt = null;
        eq.installedAt = null;
        eq.assignmentNote = null;
        if (eq.assetStatus === EquipmentAssetStatus.ASSIGNED) {
          eq.assetStatus = EquipmentAssetStatus.AVAILABLE;
        }
        await em.save(EquipmentEntity, eq);

        const equipmentAuditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'update',
          entityType: 'equipment',
          entityId: eq.id,
          oldValueJson: oldValue,
          newValueJson: {
            currentRoomId: null,
            assetStatus: eq.assetStatus,
            reason: 'room_deleted',
            deletedRoomId: roomId,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, equipmentAuditLog);
      }

      return { meetingIds, affectedEquipmentCount: assignedEquipments.length };
    });

    // (g) audit log cho room — ngoai transaction, fail khong rollback
    try {
      await this.dataSource.transaction(async (em) => {
        const auditLog = em.create(AuditLogEntity, {
          userId,
          actionType: 'delete',
          entityType: 'room',
          entityId: roomId,
          newValueJson: {
            deletedAt: new Date(),
            affectedMeetingIds,
            affectedEquipmentCount,
          },
          ipAddress: ipAddress ?? null,
          severity: AuditLogSeverity.INFO,
        });
        await em.save(AuditLogEntity, auditLog);
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit log for room delete ${roomId}: ${err instanceof Error ? err.message : 'Unknown'}`,
      );
    }

    const deletedAt = new Date();

    // WebSocket broadcast — ngay sau audit, KHONG cho background job (§0.9)
    this.websocketService.broadcast('room.deleted', { roomId, deletedAt });

    // Enqueue background job de xu ly bat dong bo (goi y phong + gui email)
    let notificationJobId: string | null = null;
    if (affectedMeetingIds.length > 0) {
      const job = await this.backgroundJobsService.createQueuedJob({
        jobType: BackgroundJobType.ROOM_DELETE_NOTIFY,
        relatedEntityType: 'room',
        relatedEntityId: roomId,
        requestedBy: userId,
        inputJson: { affectedMeetingIds },
      });
      notificationJobId = job.id;
      // Fire-and-forget: KHONG await — khong duoc block response DELETE (NFR-002/OOS-005).
      this.roomDeleteNotificationProcessor
        .process(job.id, affectedMeetingIds)
        .catch((err) => {
          this.logger.error(
            `[RoomDeleteNotify] Unhandled error processing job ${job.id}: ${
              err instanceof Error ? err.message : 'Unknown error'
            }`,
          );
        });
    }

    return new DeleteRoomResponseDto({
      roomId,
      deletedAt,
      affectedMeetingCount: affectedMeetingIds.length,
      affectedEquipmentCount,
      notificationJobId,
    });
  }

  // ---------------------------------------------------------------------------
  // ROOM-VIEW-DETAIL-001: Xem chi tiet 1 phong hop (admin only)
  // ---------------------------------------------------------------------------

  /**
   * Tra ve chi tiet day du 1 phong hop: info tinh + occupancyStatus (tai su dung
   * RoomStatusService, KHONG viet lai SQL) + toi da 5 booking sap toi.
   *
   * BR-2: phong soft-deleted (deletedAt IS NOT NULL) → 404 ROOM_NOT_FOUND.
   * BR-1: goi lai RoomStatusService.getRoomStatus() noi bo — KHONG viet lai LATERAL SQL.
   * BR-3 [FIX 2026-08-19]: administrativeStatus = room.administrativeStatus
   * (cot rieng, admin dat qua PATCH .../administrative-status) — KHONG con
   * dung room.currentStatus (cot bi OccupancyPersistenceService flip 1 chieu
   * sang 'occupied', khong bao gio tu reset ve 'available').
   * BR-4: upcomingBookings: status IN ('approved','active'), reserved_start_time > now(), LIMIT 5, ASC.
   * BR-6: createdBy/updatedBy null-safe.
   * SEC-03: upcomingBookings dung parameterized query ($1).
   */
  async getRoomDetail(roomId: string): Promise<RoomDetailResponseDto> {
    // --- Buoc 1: Info tinh (TypeORM findOne, load relation createdByUser/updatedByUser) ---
    const room = await this.roomRepo.findOne({
      where: { id: roomId, deletedAt: IsNull() },
      relations: { createdByUser: true, updatedByUser: true },
    });
    if (!room) {
      // BR-2: nem NGAY, KHONG goi RoomStatusService neu da biet room khong ton tai
      throw new NotFoundException({
        code: 'ROOM_NOT_FOUND',
        message: 'Room not found.',
      });
    }

    // --- Buoc 2: Realtime — TAI SU DUNG nguyen ham (BR-1), khong viet lai SQL ---
    const occupancyStatus = await this.roomStatusService.getRoomStatus(roomId);

    // --- Buoc 3: upcomingBookings — parameterized raw SQL (SEC-03, BR-4) ---
    const upcomingRows = await this.dataSource.manager.query(
      `SELECT b.id AS booking_id, b.meeting_id, m.title,
              u.full_name AS host_name, b.reserved_start_time, b.reserved_end_time
       FROM room_bookings b
       JOIN meetings m ON m.id = b.meeting_id
       LEFT JOIN users u ON u.id = COALESCE(m.host_id, m.organizer_id)
       WHERE b.room_id = $1
         AND b.reserved_start_time > now()
         AND b.status IN ('approved','active')
       ORDER BY b.reserved_start_time ASC
       LIMIT 5`,
      [roomId],
    );

    return this.toRoomDetailDto(room, occupancyStatus, upcomingRows);
  }

  /**
   * Map room entity + occupancyStatus + upcomingRows → RoomDetailResponseDto.
   * Private — chi dung boi getRoomDetail().
   */
  private toRoomDetailDto(
    room: RoomEntity & {
      createdByUser?: { id: string; fullName: string } | null;
      updatedByUser?: { id: string; fullName: string } | null;
    },
    occupancyStatus: Awaited<ReturnType<RoomStatusService['getRoomStatus']>>,
    upcomingRows: Array<{
      booking_id: string;
      meeting_id: string;
      title: string | null;
      host_name: string | null;
      reserved_start_time: Date | string;
      reserved_end_time: Date | string;
    }>,
  ): RoomDetailResponseDto {
    // BR-6: null-safe createdBy/updatedBy
    const createdBy: RoomDetailUserRefDto | null = room.createdByUser
      ? { userId: room.createdByUser.id, fullName: room.createdByUser.fullName }
      : null;
    const updatedBy: RoomDetailUserRefDto | null = room.updatedByUser
      ? { userId: room.updatedByUser.id, fullName: room.updatedByUser.fullName }
      : null;

    // occupancyStatus: chi lay 4 field can thiet (spec §4.1, BR-5)
    const occupancyStatusDto: RoomDetailOccupancyStatusDto = {
      currentBooking: occupancyStatus.currentBooking
        ? {
            bookingId: occupancyStatus.currentBooking.bookingId,
            meetingId: occupancyStatus.currentBooking.meetingId,
            title: occupancyStatus.currentBooking.title,
            hostName: occupancyStatus.currentBooking.hostName,
            reservedStartTime: occupancyStatus.currentBooking.reservedStartTime,
            reservedEndTime: occupancyStatus.currentBooking.reservedEndTime,
          }
        : null,
      occupancyCount: occupancyStatus.occupancyCount,
      lastPresenceAt: occupancyStatus.lastPresenceAt,
      noShowStatus: occupancyStatus.noShowStatus, // BR-5: chi string rut gon
    };

    // BR-4: upcomingBookings map
    const upcomingBookings: RoomDetailBookingRefDto[] = upcomingRows.map(
      (r) => ({
        bookingId: r.booking_id,
        meetingId: r.meeting_id,
        title: r.title,
        hostName: r.host_name,
        reservedStartTime: r.reserved_start_time,
        reservedEndTime: r.reserved_end_time,
      }),
    );

    return {
      roomId: room.id,
      roomCode: room.roomCode,
      roomName: room.roomName,
      siteName: room.siteName ?? null,
      areaName: room.areaName ?? null,
      locationDescription: room.locationDescription ?? null,
      capacity: room.capacity,
      roomType: room.roomType,
      administrativeStatus: room.administrativeStatus, // BR-3: KHONG doi ten trung occupancyStatus
      hasCamera: room.hasCamera,
      hasMicrophone: room.hasMicrophone,
      hasDisplay: room.hasDisplay,
      allowRecording: room.allowRecording,
      layoutJson: room.layoutJson ?? null,
      isActive: room.isActive,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      createdBy,
      updatedBy,
      occupancyStatus: occupancyStatusDto,
      upcomingBookings,
    };
  }
}
