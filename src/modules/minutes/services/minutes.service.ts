import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  InternalServerErrorException,
  UnprocessableEntityException,
  Logger,
} from '@nestjs/common';
import { DataSource, EntityManager, IsNull, In, Brackets, Repository } from 'typeorm';
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import {
  MeetingParticipantEntity,
  ParticipantRole,
} from '../../meetings/entities/meeting-participant.entity.js';
import { RoomEntity } from '../../rooms/entities/room.entity.js';
import {
  MeetingMinutesEntity,
  MeetingMinutesStatus,
  MeetingMinutesVisibilityLevel,
  MeetingMinutesSource,
  MeetingMinutesContentFormat,
} from '../entities/meeting-minutes.entity.js';
import { MeetingMinutesShareEntity } from '../entities/meeting-minutes-share.entity.js';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { CreateDraftMinutesDto } from '../dto/create-draft-minutes.dto.js';
import { UpdateDraftMinutesDto } from '../dto/update-draft-minutes.dto.js';
import {
  DraftMinutesResponseDto,
  MinutesAttendeeSnapshot,
} from '../dto/draft-minutes-response.dto.js';
import { MinutesQueryDto } from '../dto/minutes-query.dto.js';
import { MinutesListItemDto } from '../dto/minutes-list-item.dto.js';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { AuditLogEntity } from '../../administration/entities/audit-log.entity.js';
import { MinutesAttachmentResponseDto } from '../dto/minutes-attachment-response.dto.js';
import {
  MINUTES_ATTACHMENT_MAX_BYTES_DEFAULT,
  MINUTES_ATTACHMENT_MAX_COUNT_DEFAULT,
  MINUTES_ATTACHMENT_ALLOWED_MIME_TYPES,
} from '../constants/minutes-attachment.constants.js';
import {
  MinutesDetailResponseDto,
  MinutesGeneralInfoDto,
  MinutesMainContentDto,
  MinutesAiSummaryDto,
  MinutesRelatedResourcesDto,
  MinutesAttachmentSummaryDto,
  MinutesPermissionsDto,
  MinutesAttendeeDto,
  MinutesShareDto,
  MinutesUserRefDto,
  RoomDetailDto,
  TranscriptSummaryDto,
  RecordingSummaryDto,
} from '../dto/minutes-detail-response.dto.js';
import {
  UserEntity,
  AccountStatus,
} from '../../accounts/entities/user.entity.js';
import { TranscriptEntity } from '../../transcription/entities/transcript.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import {
  MediaFileEntity,
  MediaFileType,
  StorageProvider,
} from '../../recording/entities/media-file.entity.js';
import { MinutesMeetingSummaryDto } from '../dto/minutes-meeting-summary.dto.js';
import { RoomSummaryDto } from '../../meetings/dto/room-summary.dto.js';
import { UserSummaryDto } from '../../meetings/dto/user-summary.dto.js';
import { UpdateDraftMinutesResponseDto } from '../dto/update-draft-minutes-response.dto.js';
import { SearchMinutesByPersonQueryDto } from '../dto/search-minutes-by-person-query.dto.js';
import { IssueMinutesResponseDto } from '../dto/issue-minutes-response.dto.js';
import { LinkMinutesResourcesDto } from '../dto/link-minutes-resources.dto.js';
import { LinkMinutesResourcesResponseDto } from '../dto/link-minutes-resources-response.dto.js';
import { PersonSummaryDto } from '../dto/person-summary.dto.js';
import {
  NotificationEntity,
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { CreateMinutesShareDto } from '../dto/create-minutes-share.dto.js';
import {
  MinutesShareResponseDto,
  UnshareMinutesResponseDto,
} from '../dto/minutes-share-response.dto.js';
import {
  MinutesShareListItemDto,
  MinutesShareListResponseDto,
} from '../dto/minutes-share-list-response.dto.js';
import {
  DepartmentSummaryDto,
  UserProfileSummaryDto,
} from '../dto/user-profile-summary.dto.js';
import { ToggleLiveShareMinutesDto } from '../dto/toggle-live-share-minutes.dto.js';
import { WebsocketService } from '../../websocket/websocket.service.js';

const DEFAULT_MINUTES_CONTENT =
  '1. Thành phần tham dự\n2. Nội dung cuộc họp\n3. Kết luận\n4. Đầu việc (Action items)';

const MEETING_STATUSES_ALLOWED_FOR_MINUTES = [
  MeetingStatus.IN_PROGRESS,
  MeetingStatus.COMPLETED,
];

export interface MinutesAuthUser {
  userId: string;
}

interface CreateDraftTransactionResult {
  saved: MeetingMinutesEntity;
  meeting: MeetingEntity;
  attendeesSnapshotJson: MinutesAttendeeSnapshot[];
}

interface ToggleLiveShareTransactionResult {
  minutes: MeetingMinutesEntity;
  changed: boolean;
}

const LIST_MAX_LIMIT = 20; // BR2 (UC-MKM-02): tá»‘i Ä‘a 20 báº£n ghi/trang

const LIST_SORT_FIELD_MAP: Record<string, string> = {
  actual_start_time: 'meeting.actualStartTime',
  created_at: 'minutes.createdAt',
};

export interface MinutesListResult {
  items: MinutesListItemDto[];
  total: number;
  page: number;
  limit: number;
}

@Injectable()
export class MinutesService {
  private readonly logger = new Logger(MinutesService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly auditLogsService: AuditLogsService,
    private readonly authzRepo: AuthzReadRepository,
    private readonly storageService: StorageService,
    private readonly configService: ConfigService,
    @InjectRepository(MediaFileEntity)
    private readonly mediaFileRepo: Repository<MediaFileEntity>,
    /**
     * MKM-LIVE-01: optional de khong phai sua lai toan bo call-site
     * `new MinutesService(...)` (6 tham so) hien co trong cac file test —
     * emit WS von da la best-effort (spec muc 6.5), nen thieu service nay
     * (vd trong unit test) chi log canh bao, khong throw.
     */
    private readonly websocketService?: WebsocketService,
  ) {}

  async createDraft(
    meetingId: string,
    dto: CreateDraftMinutesDto,
    authUser: MinutesAuthUser,
  ): Promise<DraftMinutesResponseDto> {
    const result = await this.dataSource.transaction(
      async (manager): Promise<CreateDraftTransactionResult> => {
        // Step 1: Load + lock meeting (trÃ¡nh race condition táº¡o trÃ¹ng minutes)
        const meeting = await manager
          .getRepository(MeetingEntity)
          .createQueryBuilder('meeting')
          .setLock('pessimistic_write')
          .where('meeting.id = :meetingId', { meetingId })
          .getOne();

        if (!meeting || meeting.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Cuá»™c há»p khÃ´ng tá»“n táº¡i hoáº·c Ä‘Ã£ bá»‹ xÃ³a',
            error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
          });
        }

        // Step 2: Meeting pháº£i cÃ³ Host Ä‘Æ°á»£c gÃ¡n
        if (!meeting.hostId) {
          throw new ConflictException({
            success: false,
            message:
              'Cuá»™c há»p chÆ°a Ä‘Æ°á»£c gÃ¡n Host, khÃ´ng thá»ƒ táº¡o biÃªn báº£n há»p',
            error: {
              code: 'MEETING_HOST_NOT_ASSIGNED',
              details: { meetingId },
            },
          });
        }

        // Step 3: Chá»‰ Host cá»§a cuá»™c há»p má»›i Ä‘Æ°á»£c táº¡o (BR1)
        // Lịch UEL mục 13: thư ký cũng được soạn biên bản (chủ trì ký duyệt/ban hành).
        if (meeting.hostId !== authUser.userId && meeting.secretaryId !== authUser.userId) {
          throw new ForbiddenException({
            success: false,
            message:
              'Chá»‰ Host cá»§a cuá»™c há»p má»›i Ä‘Æ°á»£c táº¡o biÃªn báº£n há»p',
            error: { code: 'NOT_MEETING_HOST', details: { meetingId } },
          });
        }

        // Step 4: Meeting status guard â€” cho phÃ©p táº¡o khi Ä‘ang diá»…n ra hoáº·c Ä‘Ã£ káº¿t thÃºc
        if (meeting.status === MeetingStatus.CANCELLED) {
          throw new ConflictException({
            success: false,
            message:
              'Cuá»™c há»p Ä‘Ã£ bá»‹ há»§y, khÃ´ng thá»ƒ táº¡o biÃªn báº£n há»p',
            error: { code: 'MEETING_CANCELLED', details: { meetingId } },
          });
        }

        if (!MEETING_STATUSES_ALLOWED_FOR_MINUTES.includes(meeting.status)) {
          throw new ConflictException({
            success: false,
            message: 'Cuộc họp chưa bắt đầu, chưa thể tạo biên bản họp',
            error: {
              code: 'MEETING_NOT_STARTED',
              details: { meetingId, currentStatus: meeting.status },
            },
          });
        }

        // Step 5: Chống tạo trùng — tối đa 1 minutes manual active per meeting (MKM-MANUAL-01)
        const existing = await manager
          .getRepository(MeetingMinutesEntity)
          .findOne({
            where: {
              meetingId,
              source: MeetingMinutesSource.MANUAL,
              deletedAt: IsNull(),
            },
          });

        if (existing) {
          throw new ConflictException({
            success: false,
            message: 'Cuộc họp này đã có biên bản thủ công',
            error: {
              code: 'MINUTES_ALREADY_EXISTS',
              details: {
                meetingId,
                existingMinutesId: existing.id,
                source: 'manual',
              },
            },
          });
        }

        // Step 6: Snapshot danh sách tham dự tại thời điểm tạo (BR2 — khóa cứng)
        const participants = await manager
          .getRepository(MeetingParticipantEntity)
          .find({ where: { meetingId } });

        const attendeesSnapshotJson: MinutesAttendeeSnapshot[] =
          participants.map((p) => ({
            userId: p.userId,
            participantRole: p.participantRole,
            attendanceStatus: p.attendanceStatus,
            joinedAt: p.joinedAt,
            leftAt: p.leftAt,
          }));

        // Step 7: Tạo bản ghi draft
        const title = dto.title?.trim() || `Biên bản họp: ${meeting.title}`;

        const minutes = manager.getRepository(MeetingMinutesEntity).create({
          meetingId,
          title,
          status: MeetingMinutesStatus.DRAFT,
          visibilityLevel: MeetingMinutesVisibilityLevel.PRIVATE,
          minutesContent: DEFAULT_MINUTES_CONTENT,
          attendeesSnapshotJson: attendeesSnapshotJson as unknown as Record<
            string,
            unknown
          >,
          preparedBy: authUser.userId,
          source: MeetingMinutesSource.MANUAL,
          contentFormat:
            dto.contentFormat ?? MeetingMinutesContentFormat.TEMPLATE,
        });

        let saved: MeetingMinutesEntity;
        try {
          saved = await manager
            .getRepository(MeetingMinutesEntity)
            .save(minutes);
        } catch (e: unknown) {
          // Lớp bảo vệ thứ 2 cho race condition (plan.md mục 9.1) — lock
          // pessimistic_write ở Step 1 đã serialize hầu hết trường hợp,
          // nhưng vẫn bắt lỗi ux_meeting_minutes_meeting_source_active nếu
          // có đường ghi nào khác vượt qua application check.
          if (this.isUniqueViolation(e)) {
            throw new ConflictException({
              success: false,
              message: 'Cuộc họp này đã có biên bản thủ công',
              error: {
                code: 'MINUTES_ALREADY_EXISTS',
                details: { meetingId, source: 'manual' },
              },
            });
          }
          throw e;
        }

        return { saved, meeting, attendeesSnapshotJson };
      },
    );

    // Audit log ngoài transaction — AuditLogsService tự fail-safe, không chặn business flow
    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_minutes_draft_created',
      entityType: 'meeting_minutes',
      entityId: result.saved.id,
      metadataJson: {
        meetingId,
        meetingStatus: result.meeting.status,
        source: 'manual',
      },
    });

    return new DraftMinutesResponseDto({
      id: result.saved.id,
      meetingId: result.saved.meetingId,
      title: result.saved.title,
      status: result.saved.status,
      visibilityLevel: result.saved.visibilityLevel,
      versionNo: result.saved.versionNo,
      contentFormat: result.saved.contentFormat,
      minutesContent: result.saved.minutesContent,
      preparedBy: result.saved.preparedBy as string,
      createdAt: result.saved.createdAt,
      meetingSnapshot: {
        meetingTitle: result.meeting.title,
        actualStartTime: result.meeting.actualStartTime,
        actualEndTime: result.meeting.actualEndTime,
        roomId: result.meeting.roomId,
        meetingStatus: result.meeting.status,
        attendees: result.attendeesSnapshotJson,
      },
    });
  }

  /**
   * Batch-load room + issuedBy/preparedBy profile (jobTitle/department/avatarUrl)
   * và map các entity MeetingMinutes (đã leftJoin meeting.host + meeting.organizer)
   * thành MinutesListItemDto. Dùng chung cho findMinutesList + searchMinutesByPerson
   * (BE_REQUIREMENT_meeting_minutes_list_fields.md — tránh N+1 bằng batch-select).
   */
  private async buildMinutesListItems(
    items: MeetingMinutesEntity[],
  ): Promise<MinutesListItemDto[]> {
    const roomIds = Array.from(
      new Set(
        items
          .map((m) => m.meeting?.roomId)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const rooms = roomIds.length
      ? await this.dataSource
          .getRepository(RoomEntity)
          .find({ where: { id: In(roomIds) } })
      : [];
    const roomById = new Map(rooms.map((r) => [r.id, r]));

    const profileUserIds = Array.from(
      new Set(
        items
          .flatMap((m) => [m.preparedBy, m.issuedBy])
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const profileUsers = profileUserIds.length
      ? await this.dataSource.getRepository(UserEntity).find({
          where: { id: In(profileUserIds) },
          relations: { department: true },
        })
      : [];
    const profileUserById = new Map(profileUsers.map((u) => [u.id, u]));

    const toProfileDto = (
      userId: string | null,
    ): UserProfileSummaryDto | null => {
      if (!userId) return null;
      const u = profileUserById.get(userId);
      if (!u) return null;
      return new UserProfileSummaryDto({
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        jobTitle: u.positionTitle,
        department: u.department
          ? new DepartmentSummaryDto(
              u.department.id,
              u.department.departmentName,
            )
          : null,
        avatarUrl: u.avatarUrl,
      });
    };

    return items.map((minutes) => {
      const meeting = minutes.meeting;
      const roomEntity = meeting?.roomId
        ? roomById.get(meeting.roomId)
        : undefined;
      const room = roomEntity
        ? new RoomSummaryDto(roomEntity.id, roomEntity.roomName)
        : null;
      const hostEntity = meeting?.host ?? null;
      const host = hostEntity
        ? new UserSummaryDto(
            hostEntity.id,
            hostEntity.fullName,
            hostEntity.email,
            hostEntity.avatarUrl ?? null,
          )
        : null;
      const organizerEntity = meeting?.organizer ?? null;
      const organizer = organizerEntity
        ? new UserSummaryDto(
            organizerEntity.id,
            organizerEntity.fullName,
            organizerEntity.email,
            organizerEntity.avatarUrl ?? null,
          )
        : null;

      return new MinutesListItemDto({
        id: minutes.id,
        title: minutes.title,
        status: minutes.status,
        versionNo: minutes.versionNo,
        source: minutes.source,
        createdAt: minutes.createdAt,
        updatedAt: minutes.updatedAt,
        issuedAt: minutes.issuedAt,
        meeting: new MinutesMeetingSummaryDto({
          id: meeting.id,
          title: meeting.title,
          status: meeting.status,
          startTime: meeting.actualStartTime ?? meeting.startTime,
          endTime: meeting.actualEndTime ?? meeting.endTime,
          actualStartTime: meeting.actualStartTime,
          actualEndTime: meeting.actualEndTime,
          meetingMode: meeting.meetingMode,
          room,
          organizer,
        }),
        host,
        issuedBy: toProfileDto(minutes.issuedBy),
        preparedBy: toProfileDto(minutes.preparedBy),
        isAiGenerated: minutes.aiSummaryJson != null,
      });
    });
  }

  async findMinutesList(
    queryDto: MinutesQueryDto,
    authUser: MinutesAuthUser,
  ): Promise<MinutesListResult> {
    try {
      const page = Math.max(1, queryDto.page ?? 1);
      const limit = Math.min(
        LIST_MAX_LIMIT,
        Math.max(1, queryDto.limit ?? LIST_MAX_LIMIT),
      );
      const skip = (page - 1) * limit;

      const qb = this.dataSource
        .getRepository(MeetingMinutesEntity)
        .createQueryBuilder('minutes')
        .leftJoin('minutes.meeting', 'meeting')
        .leftJoin('meeting.host', 'host')
        .leftJoin('meeting.organizer', 'organizer')
        .select([
          'minutes.id',
          'minutes.title',
          'minutes.status',
          'minutes.versionNo',
          'minutes.source',
          'minutes.createdAt',
          'minutes.updatedAt',
          'minutes.issuedAt',
          'minutes.preparedBy',
          'minutes.issuedBy',
          'minutes.aiSummaryJson',
          'meeting.id',
          'meeting.title',
          'meeting.status',
          'meeting.startTime',
          'meeting.endTime',
          'meeting.actualStartTime',
          'meeting.actualEndTime',
          'meeting.meetingMode',
          'meeting.hostId',
          'meeting.roomId',
          'meeting.organizerId',
          'host.id',
          'host.fullName',
          'host.email',
          'host.avatarUrl',
          'organizer.id',
          'organizer.fullName',
          'organizer.email',
          'organizer.avatarUrl',
        ])
        .where('minutes.deletedAt IS NULL');

      // Scope theo role (BR phÃ¢n quyá»n UC-MKM-02)
      const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
        authUser.userId,
      );
      const isAdmin = roles.some(
        (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
      );

      if (!isAdmin) {
        qb.andWhere(
          new Brackets((sub) => {
            sub
              .where(
                'minutes.status = :draftStatus AND (minutes.preparedBy = :userId OR meeting.hostId = :userId OR meeting.secretaryId = :userId)',
                {
                  draftStatus: MeetingMinutesStatus.DRAFT,
                  userId: authUser.userId,
                },
              )
              .orWhere(
                `minutes.status IN (:...visibleStatuses) AND (
                  meeting.hostId = :userId
                  OR EXISTS (
                    SELECT 1 FROM meeting_participants mp
                    WHERE mp.meeting_id = meeting.id AND mp.user_id = :userId
                  )
                )`,
                {
                  visibleStatuses: [
                    MeetingMinutesStatus.PUBLISHED,
                    MeetingMinutesStatus.ARCHIVED,
                  ],
                  userId: authUser.userId,
                },
              )
              // MKM-LIVE-01: đồng bộ đúng điều kiện đã thêm ở canAccessMinutes()
              // và compareMinutes() — participant thấy được bản nháp đang live.
              .orWhere(
                `minutes.status = :draftStatus AND minutes.isLiveShared = true AND EXISTS (
                  SELECT 1 FROM meeting_participants mp
                  WHERE mp.meeting_id = meeting.id AND mp.user_id = :userId
                )`,
                {
                  draftStatus: MeetingMinutesStatus.DRAFT,
                  userId: authUser.userId,
                },
              );
          }),
        );
      }

      // status filter (client) â€” AND thÃªm vÃ o scope, khÃ´ng thay tháº¿
      if (queryDto.status && queryDto.status !== 'all') {
        qb.andWhere('minutes.status = :clientStatus', {
          clientStatus: queryDto.status,
        });
      }

      // roomId filter
      if (queryDto.roomId) {
        qb.andWhere('meeting.roomId = :roomId', { roomId: queryDto.roomId });
      }

      // meetingId filter (tra cứu biên bản của 1 cuộc họp cụ thể)
      if (queryDto.meetingId) {
        qb.andWhere('meeting.id = :meetingId', {
          meetingId: queryDto.meetingId,
        });
      }

      // Date range filter — lọc theo actualStartTime, fallback về startTime dự
      // kiến khi meeting chưa diễn ra (khớp field `meeting.startTime` FE hiển thị).
      // Áp dụng from/to độc lập, không bắt buộc phải có cả hai.
      if (queryDto.from) {
        qb.andWhere(
          'COALESCE(meeting.actualStartTime, meeting.startTime) >= :from',
          { from: new Date(queryDto.from) },
        );
      }
      if (queryDto.to) {
        qb.andWhere(
          'COALESCE(meeting.actualStartTime, meeting.startTime) <= :to',
          { to: new Date(queryDto.to) },
        );
      }

      // q search: minutes.title OR meeting.title OR host.fullName
      if (queryDto.q) {
        qb.andWhere(
          '(minutes.title ILIKE :q OR meeting.title ILIKE :q OR host.fullName ILIKE :q)',
          { q: `%${queryDto.q}%` },
        );
      }

      // Sort
      const sortField =
        LIST_SORT_FIELD_MAP[queryDto.sortBy ?? ''] ??
        LIST_SORT_FIELD_MAP.actual_start_time;
      const sortOrder = queryDto.sortOrder === 'asc' ? 'ASC' : 'DESC';
      qb.orderBy(sortField, sortOrder);

      // Pagination
      qb.skip(skip).take(limit);

      const [items, total] = await qb.getManyAndCount();

      const listItems = await this.buildMinutesListItems(items);

      return { items: listItems, total, page, limit };
    } catch (error) {
      this.logger.error(
        `findMinutesList failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new InternalServerErrorException({
        success: false,
        message: 'Lá»—i há»‡ thá»‘ng',
        error: { code: 'INTERNAL_ERROR' },
      });
    }
  }

  /**
   * MKM-MANUAL-01 T006: Resolve the "official" minutes for a meeting.
   * Priority: manual > ai. Returns null if no active minutes exist.
   * Used by renderers/export and any place that needs a single representative minutes.
   */
  async resolveOfficialMinutes(
    meetingId: string,
  ): Promise<MeetingMinutesEntity | null> {
    const minutesRepo = this.dataSource.getRepository(MeetingMinutesEntity);
    const manual = await minutesRepo.findOne({
      where: {
        meetingId,
        source: MeetingMinutesSource.MANUAL,
        deletedAt: IsNull(),
      },
    });
    if (manual) return manual;
    return minutesRepo.findOne({
      where: {
        meetingId,
        source: MeetingMinutesSource.AI,
        deletedAt: IsNull(),
      },
    });
  }

  /**
   * MKM-MANUAL-01 T007: Compare manual vs AI minutes for a meeting.
   * Returns both (or null for missing) using the same MinutesListItemDto shape
   * as findMinutesList for FE consistency.
   */
  async compareMinutes(
    meetingId: string,
    authUser: MinutesAuthUser,
  ): Promise<{
    manual: MinutesListItemDto | null;
    ai: MinutesListItemDto | null;
  }> {
    // Validate meeting exists
    const meeting = await this.dataSource.getRepository(MeetingEntity).findOne({
      where: { id: meetingId },
    });
    if (!meeting || meeting.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Cuộc họp không tồn tại hoặc đã bị xóa',
        error: { code: 'MEETING_NOT_FOUND', details: { meetingId } },
      });
    }

    // Load both minutes with meeting join (same shape as findMinutesList)
    const qb = this.dataSource
      .getRepository(MeetingMinutesEntity)
      .createQueryBuilder('minutes')
      .leftJoinAndSelect('minutes.meeting', 'meeting')
      .leftJoinAndSelect('meeting.host', 'host')
      .leftJoinAndSelect('meeting.organizer', 'organizer')
      .where('minutes.meetingId = :meetingId', { meetingId })
      .andWhere('minutes.deletedAt IS NULL');

    // Apply same visibility scope as findMinutesList
    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    if (!isAdmin) {
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where(
              'minutes.status = :draftStatus AND (minutes.preparedBy = :userId OR meeting.hostId = :userId OR meeting.secretaryId = :userId)',
              {
                draftStatus: MeetingMinutesStatus.DRAFT,
                userId: authUser.userId,
              },
            )
            .orWhere(
              `minutes.status IN (:...visibleStatuses) AND (
                meeting.hostId = :userId
                OR EXISTS (
                  SELECT 1 FROM meeting_participants mp
                  WHERE mp.meeting_id = meeting.id AND mp.user_id = :userId
                )
              )`,
              {
                visibleStatuses: [
                  MeetingMinutesStatus.PUBLISHED,
                  MeetingMinutesStatus.ARCHIVED,
                ],
                userId: authUser.userId,
              },
            )
            // MKM-LIVE-01: participant thấy được bản nháp đang bật chia sẻ
            // trực tiếp — mirror đúng điều kiện đã thêm ở canAccessMinutes()
            // (dòng ~1196-1204), để so sánh song song cũng nhận diện được
            // bản đang live thay vì chỉ có preparedBy mới thấy.
            .orWhere(
              `minutes.status = :draftStatus AND minutes.isLiveShared = true AND EXISTS (
                SELECT 1 FROM meeting_participants mp
                WHERE mp.meeting_id = meeting.id AND mp.user_id = :userId
              )`,
              {
                draftStatus: MeetingMinutesStatus.DRAFT,
                userId: authUser.userId,
              },
            );
        }),
      );
    }

    const items = await qb.getMany();
    const listItems = await this.buildMinutesListItems(items);

    // Map by source
    let manual: MinutesListItemDto | null = null;
    let ai: MinutesListItemDto | null = null;
    for (let i = 0; i < items.length; i++) {
      const entity = items[i];
      const dto = listItems[i];
      if (entity.source === MeetingMinutesSource.MANUAL) {
        manual = dto;
      } else if (entity.source === MeetingMinutesSource.AI) {
        ai = dto;
      }
    }

    return { manual, ai };
  }

  /* ================================================
     Attachments (US1/US2/US3)
     ================================================ */

  private async loadMinutesForOwnerCheck(
    minutesId: string,
    authUserId: string,
  ): Promise<MeetingMinutesEntity> {
    const minutes = await this.dataSource
      .getRepository(MeetingMinutesEntity)
      .findOne({ where: { id: minutesId } });

    if (!minutes || minutes.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Bien ban hop khong ton tai hoac da bi xoa',
        error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
      });
    }

    if (minutes.preparedBy !== authUserId) {
      throw new ForbiddenException({
        success: false,
        message: 'Ban khong phai la nguoi soan thao bien ban hop nay',
        error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
      });
    }

    return minutes;
  }

  /**
   * Kiem tra quyen ĐỌC bien ban (UC-139/UC-140): rong hon
   * loadMinutesForOwnerCheck (upload/delete chi Host/preparer) — Host,
   * Participant (khi da published/archived) hoac Admin deu duoc xem danh
   * sach/chi tiet file dinh kem, dung voi actor trong dac ta UC-MKM.
   * Dung chung logic voi findMinutesDetail (canAccessMinutes).
   */
  private async loadMinutesForReadCheck(
    minutesId: string,
    authUserId: string,
  ): Promise<MeetingMinutesEntity> {
    const minutes = await this.dataSource
      .getRepository(MeetingMinutesEntity)
      .createQueryBuilder('minutes')
      .leftJoinAndSelect('minutes.meeting', 'meeting')
      .where('minutes.id = :minutesId', { minutesId })
      .andWhere('minutes.deletedAt IS NULL')
      .getOne();

    if (!minutes) {
      throw new NotFoundException({
        success: false,
        message: 'Bien ban hop khong ton tai hoac da bi xoa',
        error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
      });
    }

    const { roles } =
      await this.authzRepo.getEffectiveRolesAndPermissions(authUserId);
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    if (!isAdmin) {
      const participantCount = await this.dataSource
        .getRepository(MeetingParticipantEntity)
        .count({
          where: { meetingId: minutes.meetingId, userId: authUserId },
        });
      const isParticipant = participantCount > 0;

      if (
        !(await this.canAccessMinutes(
          minutes,
          minutes.meeting,
          authUserId,
          false,
          isParticipant,
        ))
      ) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong co quyen xem bien ban hop nay',
          error: { code: 'MEETING_MINUTES_ACCESS_DENIED', details: {} },
        });
      }
    }

    return minutes;
  }

  async addAttachment(
    minutesId: string,
    file: any,
    authUser: MinutesAuthUser,
  ): Promise<MinutesAttachmentResponseDto> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        success: false,
        message: 'Vui long dinh kem file',
        error: { code: 'ATTACHMENT_FILE_REQUIRED', details: {} },
      });
    }

    const maxBytes = this.configService.get<number>(
      'MINUTES_ATTACHMENT_MAX_BYTES',
      MINUTES_ATTACHMENT_MAX_BYTES_DEFAULT,
    );

    if (file.size > maxBytes) {
      throw new BadRequestException({
        success: false,
        message: 'File vuot qua gioi han ' + maxBytes + ' bytes',
        error: { code: 'ATTACHMENT_FILE_TOO_LARGE', details: { maxBytes } },
      });
    }

    const allowedMimeTypes: string[] =
      this.configService.get<string[]>(
        'MINUTES_ATTACHMENT_ALLOWED_MIME_TYPES',
        MINUTES_ATTACHMENT_ALLOWED_MIME_TYPES,
      ) ?? MINUTES_ATTACHMENT_ALLOWED_MIME_TYPES;

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException({
        success: false,
        message: 'Dinh dang file khong duoc ho tro',
        error: {
          code: 'ATTACHMENT_FILE_TYPE_INVALID',
          details: { allowedMimeTypes },
        },
      });
    }

    const ext = this.getExtension(file.originalname).toLowerCase();
    const mimeToExtensions: Record<string, string[]> = {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        ['.docx'],
      'application/vnd.ms-powerpoint': ['.ppt'],
      'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        ['.pptx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
        '.xlsx',
      ],
      'image/png': ['.png'],
      'image/jpeg': ['.jpg', '.jpeg'],
    };

    const allowedExtensions = mimeToExtensions[file.mimetype];
    if (!allowedExtensions || !allowedExtensions.includes(ext)) {
      throw new BadRequestException({
        success: false,
        message: 'Duoi file khong khop voi MIME type',
        error: {
          code: 'ATTACHMENT_FILE_TYPE_INVALID',
          details: { expectedExtensions: allowedExtensions },
        },
      });
    }

    const mediaFileId = randomUUID();
    let storageResult;
    try {
      storageResult = await this.storageService.saveFile({
        buffer: file.buffer,
        originalName: file.originalname,
        folder: 'minutes-attachments',
        storageKey:
          'minutes-attachments/' +
          mediaFileId +
          this.getExtension(file.originalname),
      });
    } catch (error) {
      this.logger.error(
        'Storage save failed for attachment on minutes ' + minutesId,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadGatewayException({
        success: false,
        message: 'Khong the luu file len kho luu tru',
        error: { code: 'ATTACHMENT_STORAGE_FAILED', details: {} },
      });
    }

    const now = new Date();
    const maxCount = this.configService.get<number>(
      'MINUTES_ATTACHMENT_MAX_COUNT',
      MINUTES_ATTACHMENT_MAX_COUNT_DEFAULT,
    );

    try {
      await this.dataSource.transaction(async (manager) => {
        const minutes = await manager
          .getRepository(MeetingMinutesEntity)
          .createQueryBuilder('minutes')
          .setLock('pessimistic_write')
          .where('minutes.id = :minutesId', { minutesId })
          .getOne();

        if (!minutes || minutes.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Bien ban hop khong ton tai hoac da bi xoa',
            error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
          });
        }

        if (minutes.preparedBy !== authUser.userId) {
          throw new ForbiddenException({
            success: false,
            message: 'Ban khong phai la nguoi soan thao bien ban hop nay',
            error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
          });
        }

        if (minutes.status !== MeetingMinutesStatus.DRAFT) {
          throw new ConflictException({
            success: false,
            message: 'Chi co the dinh kem file khi bien ban o trang thai nhap',
            error: {
              code: 'MINUTES_NOT_DRAFT',
              details: { minutesId, currentStatus: minutes.status },
            },
          });
        }

        const currentCount = await manager
          .getRepository(MediaFileEntity)
          .count({
            where: {
              relatedEntityType: 'meeting_minutes',
              relatedEntityId: minutesId,
              deletedAt: IsNull(),
            },
          });

        if (currentCount >= maxCount) {
          throw new ConflictException({
            success: false,
            message: 'Da dat so luong file dinh kem toi da',
            error: {
              code: 'ATTACHMENT_LIMIT_EXCEEDED',
              details: { maxCount, currentCount },
            },
          });
        }

        await manager.getRepository(MediaFileEntity).insert({
          id: mediaFileId,
          meetingId: minutes.meetingId,
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: minutesId,
          uploadedBy: authUser.userId,
          fileName: file.originalname,
          fileType: MediaFileType.MINUTES_ATTACHMENT,
          mimeType: file.mimetype,
          storageProvider: StorageProvider.LOCAL,
          storageKey: storageResult.storageKey,
          fileUrl: storageResult.publicUrl,
          fileSizeBytes: String(storageResult.sizeBytes),
          isActive: true,
          uploadedAt: now,
        });

        await manager.getRepository(AuditLogEntity).insert({
          userId: authUser.userId,
          actionType: 'meeting_minutes_attachment_uploaded',
          entityType: 'meeting_minutes',
          entityId: minutesId,
          newValueJson: {
            mediaFileId,
            fileName: file.originalname,
            fileSizeBytes: storageResult.sizeBytes,
          },
        });
      });
    } catch (error) {
      await this.storageService
        .deleteFile(storageResult.storageKey)
        .catch((ce) => {
          this.logger.warn(
            'Failed to clean up orphan storage file: ' +
              storageResult.storageKey,
            ce instanceof Error ? ce.stack : undefined,
          );
        });
      throw error;
    }

    return new MinutesAttachmentResponseDto({
      id: mediaFileId,
      fileName: file.originalname,
      fileType: MediaFileType.MINUTES_ATTACHMENT,
      mimeType: file.mimetype,
      fileSizeBytes: String(storageResult.sizeBytes),
      fileUrl: storageResult.publicUrl,
      uploadedBy: authUser.userId,
      uploadedAt: now,
    });
  }

  async listAttachments(
    minutesId: string,
    authUser: MinutesAuthUser,
  ): Promise<{
    items: MinutesAttachmentResponseDto[];
    total: number;
    maxCount: number;
  }> {
    await this.loadMinutesForReadCheck(minutesId, authUser.userId);

    const [files, total] = await this.mediaFileRepo.findAndCount({
      where: {
        relatedEntityType: 'meeting_minutes',
        relatedEntityId: minutesId,
        deletedAt: IsNull(),
      },
      order: { uploadedAt: 'DESC' },
    });

    const maxCount = this.configService.get<number>(
      'MINUTES_ATTACHMENT_MAX_COUNT',
      MINUTES_ATTACHMENT_MAX_COUNT_DEFAULT,
    );

    const items = files.map(
      (f) =>
        new MinutesAttachmentResponseDto({
          id: f.id,
          fileName: f.fileName,
          fileType: f.fileType,
          mimeType: f.mimeType,
          fileSizeBytes: f.fileSizeBytes,
          fileUrl: f.fileUrl,
          uploadedBy: f.uploadedBy,
          uploadedAt: f.uploadedAt,
        }),
    );

    return { items, total, maxCount };
  }

  async removeAttachment(
    minutesId: string,
    fileId: string,
    authUser: MinutesAuthUser,
  ): Promise<{ fileId: string; deletedAt: Date }> {
    const result = await this.dataSource.transaction(async (manager) => {
      const minutes = await manager
        .getRepository(MeetingMinutesEntity)
        .createQueryBuilder('minutes')
        .setLock('pessimistic_write')
        .where('minutes.id = :minutesId', { minutesId })
        .getOne();

      if (!minutes || minutes.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Bien ban hop khong ton tai hoac da bi xoa',
          error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
        });
      }

      if (minutes.preparedBy !== authUser.userId) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong phai la nguoi soan thao bien ban hop nay',
          error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
        });
      }

      if (minutes.status !== MeetingMinutesStatus.DRAFT) {
        throw new ConflictException({
          success: false,
          message: 'Chi co the go file khi bien ban o trang thai nhap',
          error: {
            code: 'MINUTES_NOT_DRAFT',
            details: { minutesId, currentStatus: minutes.status },
          },
        });
      }

      const mediaFile = await manager.getRepository(MediaFileEntity).findOne({
        where: {
          id: fileId,
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: minutesId,
          deletedAt: IsNull(),
        },
      });

      if (!mediaFile) {
        throw new NotFoundException({
          success: false,
          message: 'File dinh kem khong ton tai hoac da bi xoa',
          error: { code: 'ATTACHMENT_NOT_FOUND', details: { fileId } },
        });
      }

      const deletedAt = new Date();
      await manager
        .getRepository(MediaFileEntity)
        .update({ id: fileId }, { deletedAt });

      await manager.getRepository(AuditLogEntity).insert({
        userId: authUser.userId,
        actionType: 'meeting_minutes_attachment_deleted',
        entityType: 'meeting_minutes',
        entityId: minutesId,
        oldValueJson: { fileId, storageKey: mediaFile.storageKey },
      });

      return { fileId, deletedAt, storageKey: mediaFile.storageKey };
    });

    await this.storageService.deleteFile(result.storageKey).catch((error) => {
      this.logger.warn(
        'Failed to delete physical file from storage: ' + result.storageKey,
        error instanceof Error ? error.stack : undefined,
      );
    });

    return { fileId: result.fileId, deletedAt: result.deletedAt };
  }

  private getExtension(fileName: string): string {
    const dot = fileName.lastIndexOf('.');
    return dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
  }

  /* ================================================
     View Detail (UC-MKM-03)
     ================================================ */

  /**
   * Quyết định user có xem được biên bản không (choke-point dùng chung cho
   * findMinutesDetail + loadMinutesForReadCheck). Async vì có thêm nhánh kiểm
   * tra bảng meeting_minutes_shares (feat-share-meeting-minutes, FR-009).
   *
   * CẢNH BÁO: mọi call-site PHẢI `await` — quên `await` khiến `!Promise` luôn
   * false, vô hiệu hóa toàn bộ guard. Xem feat-share-meeting-minutes/research.md #5.
   */
  private async canAccessMinutes(
    minutes: MeetingMinutesEntity,
    meeting: MeetingEntity,
    userId: string,
    isAdmin: boolean,
    isParticipant: boolean,
  ): Promise<boolean> {
    if (isAdmin) return true;
    if (minutes.status === MeetingMinutesStatus.DRAFT) {
      // MKM-LIVE-01 (FR-008/FR-009): participant cung doc duoc khi Host
      // dang bat che do chia se truc tiep. Dieu kien AND chat
      // (isLiveShared && isParticipant) — KHONG doi khi isLiveShared=false,
      // giu nguyen hanh vi cu (AC-006, chong regression bao mat).
      return (
        minutes.preparedBy === userId ||
        meeting.hostId === userId ||
        meeting.secretaryId === userId ||
        Boolean(minutes.isLiveShared && isParticipant)
      );
    }
    if (
      minutes.status === MeetingMinutesStatus.PUBLISHED ||
      minutes.status === MeetingMinutesStatus.ARCHIVED
    ) {
      const isHost = meeting.hostId === userId;
      if (isHost || isParticipant) return true;
      // Nhánh share (FR-009/FR-011): áp dụng cho cả published và archived.
      const shareCount = await this.dataSource
        .getRepository(MeetingMinutesShareEntity)
        .count({ where: { minutesId: minutes.id, userId } });
      return shareCount > 0;
    }
    return false;
  }

  async findMinutesDetail(
    id: string,
    authUser: MinutesAuthUser,
  ): Promise<MinutesDetailResponseDto> {
    const minutes = await this.dataSource
      .getRepository(MeetingMinutesEntity)
      .createQueryBuilder('minutes')
      .leftJoinAndSelect('minutes.meeting', 'meeting')
      .where('minutes.id = :id', { id })
      .andWhere('minutes.deletedAt IS NULL')
      .getOne();

    if (!minutes) {
      throw new NotFoundException({
        success: false,
        message: 'Bien ban hop khong ton tai hoac da bi xoa',
        error: { code: 'MEETING_MINUTES_NOT_FOUND', details: { id } },
      });
    }

    const meeting = minutes.meeting;
    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    if (!isAdmin) {
      const participantCount = await this.dataSource
        .getRepository(MeetingParticipantEntity)
        .count({
          where: { meetingId: minutes.meetingId, userId: authUser.userId },
        });
      const isParticipant = participantCount > 0;

      if (
        !(await this.canAccessMinutes(
          minutes,
          meeting,
          authUser.userId,
          false,
          isParticipant,
        ))
      ) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong co quyen xem bien ban hop nay',
          error: { code: 'MEETING_MINUTES_ACCESS_DENIED', details: {} },
        });
      }
    }

    let room: RoomDetailDto | null = null;
    if (meeting.roomId) {
      const roomEntity = await this.dataSource
        .getRepository(RoomEntity)
        .findOne({ where: { id: meeting.roomId } });
      if (roomEntity) {
        room = new RoomDetailDto({
          id: roomEntity.id,
          roomName: roomEntity.roomName,
          siteName: roomEntity.siteName,
          areaName: roomEntity.areaName,
          locationDescription: roomEntity.locationDescription,
        });
      }
    }

    const attendeeSnapshots = minutes.attendeesSnapshotJson ?? [];
    const attendeeUserIds = (attendeeSnapshots as any).map((a) => a.userId);
    const extraUserIds = [
      meeting.hostId,
      meeting.organizerId,
      minutes.preparedBy,
      minutes.issuedBy,
      minutes.approvedBy,
    ].filter(Boolean);
    const allUserIds = Array.from(
      new Set([...attendeeUserIds, ...extraUserIds]),
    );

    let usersById = new Map<string, MinutesUserRefDto>();
    if (allUserIds.length > 0) {
      const userEntities = await this.dataSource
        .getRepository(UserEntity)
        .find({
          where: { id: In(allUserIds) },
          relations: { department: true },
        });
      usersById = new Map(
        userEntities.map((u) => [
          u.id,
          {
            id: u.id,
            fullName: u.fullName ?? '',
            email: u.email ?? '',
            jobTitle: u.positionTitle,
            department: u.department
              ? new DepartmentSummaryDto(
                  u.department.id,
                  u.department.departmentName,
                )
              : null,
            avatarUrl: u.avatarUrl,
          },
        ]),
      );
    }

    let transcript: TranscriptSummaryDto | null = null;
    if (minutes.linkedTranscriptId) {
      const t = await this.dataSource.getRepository(TranscriptEntity).findOne({
        where: { id: minutes.linkedTranscriptId },
        select: { id: true, status: true, versionNo: true, languageCode: true },
      });
      if (t)
        transcript = new TranscriptSummaryDto({
          id: t.id,
          status: t.status,
          versionNo: t.versionNo,
          languageCode: t.languageCode,
        });
    }

    let recording: RecordingSummaryDto | null = null;
    if (minutes.linkedRecordingFileId) {
      const rec = await this.dataSource.getRepository(MediaFileEntity).findOne({
        where: { id: minutes.linkedRecordingFileId, deletedAt: IsNull() },
        select: {
          id: true,
          fileName: true,
          durationSeconds: true,
          mimeType: true,
        },
      });
      if (rec)
        recording = new RecordingSummaryDto({
          id: rec.id,
          fileName: rec.fileName,
          durationSeconds: rec.durationSeconds,
          mimeType: rec.mimeType,
        });
    }

    const attachmentEntities = await this.dataSource
      .getRepository(MediaFileEntity)
      .find({
        where: {
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: id,
          deletedAt: IsNull(),
        },
        order: { uploadedAt: 'DESC' },
      });
    const attachments = attachmentEntities.map(
      (f) =>
        new MinutesAttachmentSummaryDto({
          id: f.id,
          fileName: f.fileName,
          fileType: f.fileType,
          mimeType: f.mimeType,
          fileUrl: f.fileUrl,
          fileSizeBytes: f.fileSizeBytes,
          uploadedBy: f.uploadedBy,
          uploadedAt: f.uploadedAt,
        }),
    );

    const shareRows = await this.dataSource
      .getRepository(MeetingMinutesShareEntity)
      .createQueryBuilder('share')
      .leftJoin('share.user', 'sharedUser')
      .where('share.minutesId = :id', { id })
      .select([
        'share.userId',
        'share.grantedAt',
        'sharedUser.fullName',
        'sharedUser.avatarUrl',
      ])
      .orderBy('share.grantedAt', 'DESC')
      .getRawMany();
    const shares = shareRows.map(
      (row) =>
        new MinutesShareDto({
          userId: row.share_user_id,
          fullName: row.sharedUser_full_name ?? '',
          avatarUrl: row.sharedUser_avatar_url ?? null,
          sharedAt: row.share_granted_at,
        }),
    );

    const attendees = ((minutes.attendeesSnapshotJson ?? []) as any).map(
      (a) =>
        new MinutesAttendeeDto({
          userId: a.userId,
          fullName: usersById.get(a.userId)?.fullName ?? '',
          email: usersById.get(a.userId)?.email ?? '',
          jobTitle: usersById.get(a.userId)?.jobTitle ?? null,
          department: usersById.get(a.userId)?.department ?? null,
          avatarUrl: usersById.get(a.userId)?.avatarUrl ?? null,
          participantRole: a.participantRole,
          attendanceStatus: a.attendanceStatus,
          joinedAt: a.joinedAt,
          leftAt: a.leftAt,
        }),
    );

    const hostUser = meeting.hostId
      ? (usersById.get(meeting.hostId) ?? null)
      : null;
    const organizerUser = meeting.organizerId
      ? (usersById.get(meeting.organizerId) ?? null)
      : null;
    const preparedByUser = minutes.preparedBy
      ? (usersById.get(minutes.preparedBy) ?? null)
      : null;
    const issuedByUser = minutes.issuedBy
      ? (usersById.get(minutes.issuedBy) ?? null)
      : null;
    const approvedByUser = minutes.approvedBy
      ? (usersById.get(minutes.approvedBy) ?? null)
      : null;
    const noteTakerSnapshot = (
      (minutes.attendeesSnapshotJson ?? []) as any[]
    ).find((a) => a.participantRole === ParticipantRole.NOTE_TAKER);
    const noteTakerUser = noteTakerSnapshot
      ? (usersById.get(noteTakerSnapshot.userId) ?? null)
      : null;

    const isDraft = minutes.status === MeetingMinutesStatus.DRAFT;
    const isMeetingHost = meeting.hostId === authUser.userId;
    // Đang chờ ký / đã ký duyệt: khoá sửa & xoá, chỉ còn ban hành
    const [signoff] = await this.dataSource.query(
      `SELECT signoff_required, signoff_status, signoff_minutes_id, signoff_at FROM meetings WHERE id = $1`,
      [meeting.id],
    );
    const isSignoffMinutes = signoff?.signoff_minutes_id === minutes.id;
    const signoffLocked =
      isSignoffMinutes &&
      ['pending', 'approved'].includes(signoff?.signoff_status);
    const isComposer =
      isAdmin ||
      isMeetingHost ||
      minutes.preparedBy === authUser.userId ||
      meeting.secretaryId === authUser.userId;
    const canEdit =
      isDraft &&
      !signoffLocked &&
      (isAdmin ||
        isMeetingHost ||
        minutes.preparedBy === authUser.userId ||
        meeting.secretaryId === authUser.userId);
    // Cuộc họp yêu cầu trình ký: chỉ ban hành được bản đã ký duyệt (khớp assertCanIssue).
    const signoffRequired = !!signoff?.signoff_required;
    const canIssue =
      isDraft &&
      (isAdmin || isMeetingHost) &&
      (!signoffRequired ||
        (isSignoffMinutes && signoff?.signoff_status === 'approved'));
    const meetingEnded = meeting.status === MeetingStatus.COMPLETED;
    // Trình ký: bản nháp, họp đã kết thúc, chưa có bản nào đang chờ ký / đã ký.
    const canSubmitSignoff =
      isDraft &&
      isComposer &&
      signoffRequired &&
      meetingEnded &&
      !['pending', 'approved'].includes(signoff?.signoff_status) &&
      // Bị trả lại: phải sửa theo góp ý rồi mới trình lại (khớp submitSignoff).
      !(
        signoff?.signoff_status === 'returned' &&
        signoff.signoff_at &&
        new Date(minutes.updatedAt) <= new Date(signoff.signoff_at)
      );

    // aiSummaryJson khác NULL = biên bản có nguồn gốc AI. Expose 4 khối insight
    // + meta (read-only) cho FE; đồng thời set cờ isAiGenerated để FE phân biệt
    // nháp AI vs nháp tay và hiển thị banner "cần review".
    const aiJson = minutes.aiSummaryJson ?? null;
    const isAiGenerated = aiJson !== null;
    let aiSummary: MinutesAiSummaryDto | null = null;
    if (aiJson !== null) {
      const ai = aiJson;
      aiSummary = new MinutesAiSummaryDto({
        keyPoints: (ai.keyPoints as string[]) ?? [],
        risks: (ai.risks as string[]) ?? [],
        openQuestions: (ai.openQuestions as string[]) ?? [],
        uncertainParts: (ai.uncertainParts as string[]) ?? [],
        meta: (ai.meta as Record<string, unknown>) ?? null,
      });
    }

    return new MinutesDetailResponseDto({
      id: minutes.id,
      meetingId: minutes.meetingId,
      title: minutes.title,
      status: minutes.status,
      versionNo: minutes.versionNo,
      isLiveShared: minutes.isLiveShared,
      contentFormat: minutes.contentFormat,
      generalInfo: new MinutesGeneralInfoDto({
        meetingTitle: meeting.title,
        meetingStatus: meeting.status,
        actualStartTime: meeting.actualStartTime,
        actualEndTime: meeting.actualEndTime,
        meetingMode: meeting.meetingMode,
        room,
        organizer: organizerUser ?? null,
        host: hostUser ?? null,
        noteTaker: noteTakerUser ?? null,
        attendees,
      }),
      mainContent: new MinutesMainContentDto({
        minutesContent: minutes.minutesContent,
        decisions: minutes.decisionsJson as any,
        actionItems: minutes.actionItemsJson as any,
      }),
      aiSummary,
      isAiGenerated,
      relatedResources: new MinutesRelatedResourcesDto({
        transcript,
        recording,
      }),
      attachments,
      shares,
      preparedBy: preparedByUser ?? null,
      issuedBy: issuedByUser ?? null,
      issuedAt: minutes.issuedAt,
      approvedBy: approvedByUser ?? null,
      approvedAt: minutes.approvedAt,
      createdAt: minutes.createdAt,
      updatedAt: minutes.updatedAt,
      permissions: new MinutesPermissionsDto(canEdit, canIssue, {
        canDelete: isDraft && !signoffLocked && isComposer,
        // Chia sẻ trực tiếp chỉ dùng khi đang họp; họp xong thì soạn → trình ký.
        canLiveShare: isDraft && isComposer && !meetingEnded,
        signoffLocked,
        canSubmitSignoff,
      }),
    });
  }

  async updateDraft(
    minutesId: string,
    dto: UpdateDraftMinutesDto,
    authUser: MinutesAuthUser,
  ): Promise<UpdateDraftMinutesResponseDto> {
    const updatableFields = [
      'title',
      'minutesContent',
      'decisionsJson',
      'actionItemsJson',
      'aiSummary',
    ];
    if (!updatableFields.some((f) => dto[f] !== undefined)) {
      throw new BadRequestException({
        success: false,
        message: 'Khong co truong nao duoc cap nhat',
        error: { code: 'NO_UPDATE_FIELD', details: {} },
      });
    }
    return this.dataSource
      .transaction(async (manager) => {
        const minutes = await manager
          .getRepository(MeetingMinutesEntity)
          .createQueryBuilder('minutes')
          .setLock('pessimistic_write')
          .where('minutes.id = :minutesId', { minutesId })
          .getOne();
        if (!minutes || minutes.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Bien ban hop khong ton tai hoac da bi xoa',
            error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
          });
        }
        const meeting = await manager
          .getRepository(MeetingEntity)
          .findOne({ where: { id: minutes.meetingId } });
        const isOwner =
          minutes.preparedBy === authUser.userId ||
          meeting?.hostId === authUser.userId ||
          meeting?.secretaryId === authUser.userId;
        if (!isOwner) {
          throw new ForbiddenException({
            success: false,
            message: 'Ban khong phai la nguoi soan thao hoac host',
            error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
          });
        }
        await this.assertNotSignoffLocked(manager, minutes.meetingId, minutesId);
        if (minutes.status !== MeetingMinutesStatus.DRAFT) {
          throw new ConflictException({
            success: false,
            message: 'Chi co the cap nhat bien ban o trang thai nhap',
            error: {
              code: 'MINUTES_NOT_DRAFT',
              details: { minutesId, currentStatus: minutes.status },
            },
          });
        }
        if (dto.versionNo !== minutes.versionNo) {
          throw new ConflictException({
            success: false,
            message: 'Phien ban khong khop, vui long tai lai du lieu',
            error: {
              code: 'MINUTES_VERSION_CONFLICT',
              details: {
                currentVersionNo: minutes.versionNo,
                currentData: {
                  title: minutes.title,
                  minutesContent: minutes.minutesContent,
                  decisionsJson: minutes.decisionsJson,
                  actionItemsJson: minutes.actionItemsJson,
                  updatedAt: minutes.updatedAt,
                },
              },
            },
          });
        }
        if (dto.title !== undefined) minutes.title = dto.title;
        if (dto.minutesContent !== undefined)
          minutes.minutesContent = dto.minutesContent;
        if (dto.decisionsJson !== undefined)
          minutes.decisionsJson = dto.decisionsJson as any;
        if (dto.actionItemsJson !== undefined) {
          minutes.actionItemsJson = dto.actionItemsJson.map((item) => ({
            ...item,
            id: item.id ?? randomUUID(),
          })) as any;
        }
        // aiSummary: merge 4 mảng insight, GIỮ NGUYÊN meta (provenance) —
        // người dùng không được ghi đè provider/model/generatedAt.
        if (dto.aiSummary !== undefined) {
          const existingAi = minutes.aiSummaryJson ?? {};
          const merged: Record<string, unknown> = { ...existingAi };
          for (const key of [
            'keyPoints',
            'risks',
            'openQuestions',
            'uncertainParts',
          ] as const) {
            if (dto.aiSummary[key] !== undefined) {
              merged[key] = dto.aiSummary[key];
            }
          }
          minutes.aiSummaryJson = merged;
        }
        if (meeting?.status === MeetingStatus.COMPLETED) {
          const participants = await manager
            .getRepository(MeetingParticipantEntity)
            .find({ where: { meetingId: minutes.meetingId } });
          minutes.attendeesSnapshotJson = participants.map((p) => ({
            userId: p.userId,
            participantRole: p.participantRole,
            attendanceStatus: p.attendanceStatus,
            joinedAt: p.joinedAt,
            leftAt: p.leftAt,
          })) as any;
        }
        const oldVersionNo = minutes.versionNo;
        minutes.versionNo += 1;
        // Sửa biên bản đang chờ ký / đã ký ⇒ phải trình ký lại.
        await manager.query(
          `UPDATE meetings SET signoff_status = NULL, signoff_at = NULL
            WHERE signoff_minutes_id = $1 AND signoff_status IN ('pending', 'approved')`,
          [minutesId],
        );
        const saved = await manager
          .getRepository(MeetingMinutesEntity)
          .save(minutes);
        return {
          saved,
          oldVersionNo,
          updatedFields: Object.keys(dto).filter(
            (k) => k !== 'versionNo' && dto[k] !== undefined,
          ),
        };
      })
      .then(async (result) => {
        await this.auditLogsService.logEntityChange({
          userId: authUser.userId,
          actionType: 'meeting_minutes_updated',
          entityType: 'meeting_minutes',
          entityId: minutesId,
          oldValueJson: { versionNo: result.oldVersionNo },
          newValueJson: {
            versionNo: result.saved.versionNo,
            updatedFields: result.updatedFields,
          },
        });
        // MKM-LIVE-01 (FR-006/FR-007): chi phat tin hieu "co ban moi" khi
        // dang live-share; im lang neu khong — khong doi hanh vi cu.
        if (result.saved.isLiveShared) {
          this.emitMeetingRoomEvent(
            result.saved.meetingId,
            'minutes.draft.updated',
            {
              minutesId: result.saved.id,
              versionNo: result.saved.versionNo,
              updatedAt: result.saved.updatedAt,
            },
          );
        }
        return new UpdateDraftMinutesResponseDto({
          id: result.saved.id,
          meetingId: result.saved.meetingId,
          title: result.saved.title,
          status: result.saved.status,
          versionNo: result.saved.versionNo,
          minutesContent: result.saved.minutesContent,
          decisionsJson: result.saved.decisionsJson,
          actionItemsJson: result.saved.actionItemsJson,
          aiSummaryJson: result.saved.aiSummaryJson,
          attendeesSnapshotJson: result.saved.attendeesSnapshotJson,
          preparedBy: result.saved.preparedBy,
          updatedAt: result.saved.updatedAt,
        });
      });
  }

  /* ================================================
     Live-Share Draft Minutes (MKM-LIVE-01)
     ================================================ */

  /**
   * Host tu bat/tat che do chia se truc tiep ban nhap. Chi preparedBy cua
   * chinh ban ghi do moi duoc goi — KHONG co nhanh bypass cho Admin (khac
   * cac endpoint khac cua module, day la quyet dinh dieu khien ca nhan cua
   * nguoi dang soan, khong phai quan tri he thong — xem plan.md muc 6.2).
   */
  async toggleLiveShare(
    minutesId: string,
    dto: ToggleLiveShareMinutesDto,
    authUser: MinutesAuthUser,
  ): Promise<MeetingMinutesEntity> {
    const result = await this.dataSource.transaction(
      async (manager): Promise<ToggleLiveShareTransactionResult> => {
        const minutes = await manager
          .getRepository(MeetingMinutesEntity)
          .createQueryBuilder('minutes')
          .setLock('pessimistic_write')
          .where('minutes.id = :minutesId', { minutesId })
          .getOne();

        if (!minutes || minutes.deletedAt) {
          throw new NotFoundException({
            success: false,
            message: 'Bien ban hop khong ton tai hoac da bi xoa',
            error: {
              code: 'MEETING_MINUTES_NOT_FOUND',
              details: { minutesId },
            },
          });
        }

        const liveMeeting = await manager
          .getRepository(MeetingEntity)
          .findOne({ where: { id: minutes.meetingId } });
        if (
          minutes.preparedBy !== authUser.userId &&
          liveMeeting?.hostId !== authUser.userId &&
          liveMeeting?.secretaryId !== authUser.userId
        ) {
          throw new ForbiddenException({
            success: false,
            message: 'Chỉ chủ trì hoặc thư ký mới được chia sẻ trực tiếp biên bản',
            error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
          });
        }

        if (minutes.status !== MeetingMinutesStatus.DRAFT) {
          throw new ConflictException({
            success: false,
            message:
              'Chi co the bat/tat chia se truc tiep khi bien ban o trang thai nhap',
            error: {
              code: 'MINUTES_NOT_DRAFT',
              details: { minutesId, currentStatus: minutes.status },
            },
          });
        }

        // FR-010: chi kiem tra meeting.status khi BAT — tat luon duoc phep
        // bat ke trang thai meeting, de Host khong bi ket.
        if (dto.enabled) {
          const meeting = await manager
            .getRepository(MeetingEntity)
            .findOne({ where: { id: minutes.meetingId } });
          if (meeting?.status !== MeetingStatus.IN_PROGRESS) {
            throw new ConflictException({
              success: false,
              message:
                'Cuoc hop khong o trang thai dang dien ra, khong the bat chia se truc tiep',
              error: {
                code: 'MEETING_NOT_IN_PROGRESS',
                details: {
                  meetingId: minutes.meetingId,
                  meetingStatus: meeting?.status,
                },
              },
            });
          }
        }

        // AC-010: idempotent — gia tri khong doi thi khong update/emit.
        if (minutes.isLiveShared === dto.enabled) {
          return { minutes, changed: false };
        }

        minutes.isLiveShared = dto.enabled;
        const saved = await manager
          .getRepository(MeetingMinutesEntity)
          .save(minutes);
        return { minutes: saved, changed: true };
      },
    );

    if (result.changed) {
      // Best-effort, ngoai transaction — khong chan luong toggle neu loi.
      await this.auditLogsService.logAction({
        userId: authUser.userId,
        actionType: 'meeting_minutes_live_share_toggled',
        entityType: 'meeting_minutes',
        entityId: result.minutes.id,
        metadataJson: {
          minutesId: result.minutes.id,
          enabled: result.minutes.isLiveShared,
        },
      });
      this.emitLiveShareEvent(result.minutes, result.minutes.isLiveShared);
    }

    return result.minutes;
  }

  /**
   * Phat event bat/tat live-share (FR-004/FR-005). Best-effort — xem
   * emitMeetingRoomEvent.
   */
  private emitLiveShareEvent(
    minutes: MeetingMinutesEntity,
    enabled: boolean,
  ): void {
    if (enabled) {
      this.emitMeetingRoomEvent(
        minutes.meetingId,
        'minutes.draft.live_started',
        { minutesId: minutes.id, versionNo: minutes.versionNo },
      );
    } else {
      this.emitMeetingRoomEvent(
        minutes.meetingId,
        'minutes.draft.live_stopped',
        { minutesId: minutes.id },
      );
    }
  }

  /**
   * Helper dung chung emit vao room `meeting:${meetingId}` qua
   * WebsocketService. Best-effort tuyet doi (spec muc 6.5): loi hoac server
   * chua san sang KHONG duoc lam vo hieu business flow da COMMIT.
   */
  private emitMeetingRoomEvent(
    meetingId: string,
    event: string,
    payload: unknown,
  ): void {
    try {
      this.websocketService?.emitToRoom(`meeting:${meetingId}`, event, payload);
    } catch (e) {
      this.logger.warn(
        `Failed to emit WS event "${event}" to meeting ${meetingId}`,
        e instanceof Error ? e.message : undefined,
      );
    }
  }

  /**
   * UC-141: Lien ket/huy lien ket 1 file recording (media_files, audio/video)
   * va/hoac 1 transcript voi bien ban dang draft. Chi Host (preparedBy hoac
   * meeting.hostId) — KHONG co nhanh bypass cho Business Admin/System Admin
   * (khac voi issueMinutes/deleteDraft), theo dung quyet dinh Q&A 2026-07-17
   * (xem feat-link-minutes-resources/spec.md muc 1.5).
   */
  async linkResources(
    minutesId: string,
    dto: LinkMinutesResourcesDto,
    authUser: MinutesAuthUser,
  ): Promise<LinkMinutesResourcesResponseDto> {
    if (dto.recordingFileId === undefined && dto.transcriptId === undefined) {
      throw new BadRequestException({
        success: false,
        message: 'Khong co truong nao duoc lien ket',
        error: { code: 'NO_LINK_FIELD', details: {} },
      });
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const minutes = await manager
        .getRepository(MeetingMinutesEntity)
        .createQueryBuilder('minutes')
        .setLock('pessimistic_write')
        .where('minutes.id = :minutesId', { minutesId })
        .getOne();
      if (!minutes || minutes.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Bien ban hop khong ton tai hoac da bi xoa',
          error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
        });
      }

      const meeting = await manager
        .getRepository(MeetingEntity)
        .findOne({ where: { id: minutes.meetingId } });
      const isOwner =
        minutes.preparedBy === authUser.userId ||
        meeting?.hostId === authUser.userId ||
        meeting?.secretaryId === authUser.userId;
      if (!isOwner) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong phai la nguoi soan thao hoac host',
          error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
        });
      }

      if (minutes.status !== MeetingMinutesStatus.DRAFT) {
        throw new ConflictException({
          success: false,
          message:
            'Chi co the lien ket tai nguyen khi bien ban o trang thai nhap',
          error: {
            code: 'MINUTES_NOT_DRAFT',
            details: { minutesId, currentStatus: minutes.status },
          },
        });
      }

      if (meeting?.status !== MeetingStatus.COMPLETED) {
        throw new ConflictException({
          success: false,
          message: 'Cuoc hop chua ket thuc, chua the lien ket tai nguyen',
          error: {
            code: 'MEETING_NOT_COMPLETED',
            details: {
              meetingId: minutes.meetingId,
              currentStatus: meeting?.status,
            },
          },
        });
      }

      if (dto.recordingFileId !== undefined && dto.recordingFileId !== null) {
        const file = await manager.getRepository(MediaFileEntity).findOne({
          where: { id: dto.recordingFileId, deletedAt: IsNull() },
        });
        if (!file) {
          throw new NotFoundException({
            success: false,
            message: 'File recording khong ton tai hoac da bi xoa',
            error: {
              code: 'RECORDING_FILE_NOT_FOUND',
              details: { recordingFileId: dto.recordingFileId },
            },
          });
        }
        if (
          file.fileType !== MediaFileType.AUDIO &&
          file.fileType !== MediaFileType.VIDEO
        ) {
          throw new BadRequestException({
            success: false,
            message: 'File duoc chon khong phai file recording (audio/video)',
            error: {
              code: 'INVALID_RECORDING_FILE_TYPE',
              details: {
                recordingFileId: dto.recordingFileId,
                fileType: file.fileType,
              },
            },
          });
        }
        if (file.meetingId !== minutes.meetingId) {
          throw new ConflictException({
            success: false,
            message: 'File recording khong thuoc cuoc hop cua bien ban nay',
            error: {
              code: 'RESOURCE_NOT_SAME_MEETING',
              details: { recordingFileId: dto.recordingFileId },
            },
          });
        }
      }

      if (dto.transcriptId !== undefined && dto.transcriptId !== null) {
        const transcript = await manager
          .getRepository(TranscriptEntity)
          .findOne({
            where: { id: dto.transcriptId },
          });
        if (!transcript) {
          throw new NotFoundException({
            success: false,
            message: 'Transcript khong ton tai',
            error: {
              code: 'TRANSCRIPT_NOT_FOUND',
              details: { transcriptId: dto.transcriptId },
            },
          });
        }
        if (transcript.meetingId !== minutes.meetingId) {
          throw new ConflictException({
            success: false,
            message: 'Transcript khong thuoc cuoc hop cua bien ban nay',
            error: {
              code: 'RESOURCE_NOT_SAME_MEETING',
              details: { transcriptId: dto.transcriptId },
            },
          });
        }
      }

      const oldValue = {
        linkedRecordingFileId: minutes.linkedRecordingFileId,
        linkedTranscriptId: minutes.linkedTranscriptId,
      };

      if (dto.recordingFileId !== undefined) {
        minutes.linkedRecordingFileId = dto.recordingFileId;
      }
      if (dto.transcriptId !== undefined) {
        minutes.linkedTranscriptId = dto.transcriptId;
      }

      const saved = await manager
        .getRepository(MeetingMinutesEntity)
        .save(minutes);
      return { saved, oldValue };
    });

    await this.auditLogsService.logEntityChange({
      userId: authUser.userId,
      actionType: 'meeting_minutes_resources_linked',
      entityType: 'meeting_minutes',
      entityId: minutesId,
      oldValueJson: result.oldValue,
      newValueJson: {
        linkedRecordingFileId: result.saved.linkedRecordingFileId,
        linkedTranscriptId: result.saved.linkedTranscriptId,
      },
    });

    return new LinkMinutesResourcesResponseDto({
      id: result.saved.id,
      linkedRecordingFileId: result.saved.linkedRecordingFileId,
      linkedTranscriptId: result.saved.linkedTranscriptId,
      updatedAt: result.saved.updatedAt,
    });
  }

  /** Biên bản đang chờ ký / đã ký duyệt thì không được sửa, xoá. */
  private async assertNotSignoffLocked(
    manager: EntityManager,
    meetingId: string,
    minutesId: string,
  ): Promise<void> {
    const rows = await manager.query(
      `SELECT signoff_status FROM meetings WHERE id = $1 AND signoff_minutes_id = $2`,
      [meetingId, minutesId],
    );
    const st = rows[0]?.signoff_status;
    if (st === 'pending' || st === 'approved') {
      throw new ConflictException({
        success: false,
        message:
          st === 'pending'
            ? 'Biên bản đang chờ ký duyệt, không thể sửa hoặc xoá'
            : 'Biên bản đã được ký duyệt, chỉ còn ban hành',
        error: { code: 'MINUTES_SIGNOFF_LOCKED', details: { minutesId } },
      });
    }
  }

  async deleteDraft(
    minutesId: string,
    authUser: MinutesAuthUser,
  ): Promise<{
    deleted: boolean;
    minutesId: string;
    deletedAt: Date;
    cascadedAttachmentCount: number;
  }> {
    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    const result = await this.dataSource.transaction(async (manager) => {
      const minutes = await manager
        .getRepository(MeetingMinutesEntity)
        .createQueryBuilder('minutes')
        .setLock('pessimistic_write')
        .where('minutes.id = :minutesId', { minutesId })
        .getOne();
      if (!minutes || minutes.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Bien ban hop khong ton tai hoac da bi xoa',
          error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
        });
      }
      if (!isAdmin) {
        const meeting = await manager
          .getRepository(MeetingEntity)
          .findOne({ where: { id: minutes.meetingId } });
        const isOwner =
          minutes.preparedBy === authUser.userId ||
          meeting?.hostId === authUser.userId ||
          meeting?.secretaryId === authUser.userId;
        if (!isOwner) {
          throw new ForbiddenException({
            success: false,
            message: 'Ban khong co quyen xoa bien ban nay',
            error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
          });
        }
      }
      await this.assertNotSignoffLocked(manager, minutes.meetingId, minutesId);
      if (minutes.status !== MeetingMinutesStatus.DRAFT) {
        throw new ConflictException({
          success: false,
          message: 'Chi co the xoa bien ban o trang thai nhap',
          error: {
            code: 'MINUTES_NOT_DRAFT',
            details: { minutesId, currentStatus: minutes.status },
          },
        });
      }
      const deletedAt = new Date();
      await manager
        .getRepository(MeetingMinutesEntity)
        .update(
          { id: minutesId },
          { status: MeetingMinutesStatus.DELETED, deletedAt },
        );
      const attachResult = await manager.getRepository(MediaFileEntity).update(
        {
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: minutesId,
          deletedAt: IsNull(),
        },
        { deletedAt },
      );
      const cascadedCount = attachResult.affected ?? 0;
      await manager.getRepository(AuditLogEntity).insert({
        userId: authUser.userId,
        actionType: 'meeting_minutes_deleted',
        entityType: 'meeting_minutes',
        entityId: minutesId,
        oldValueJson: {
          title: minutes.title,
          versionNo: minutes.versionNo,
          meetingId: minutes.meetingId,
          preparedBy: minutes.preparedBy ?? undefined,
        },
        metadataJson: {
          deletedByRole: isAdmin ? 'admin' : 'owner',
          cascadedAttachmentCount: cascadedCount,
        },
      });
      return {
        deleted: true,
        minutesId,
        deletedAt,
        cascadedAttachmentCount: cascadedCount,
      };
    });

    if (isAdmin) {
      const minutes = await this.dataSource
        .getRepository(MeetingMinutesEntity)
        .findOne({ where: { id: minutesId } });
      if (
        minutes &&
        minutes.preparedBy &&
        minutes.preparedBy !== authUser.userId
      ) {
        try {
          await this.dataSource.getRepository(NotificationEntity).insert({
            notificationType: NotificationType.MINUTES_DELETED_BY_ADMIN,
            channel: NotificationChannel.IN_APP,
            subject: 'Biên bản họp đã bị xóa bởi Admin',
            content: 'Biên bản họp của bạn đã bị xóa bởi Admin.',
            relatedEntityType: 'meeting_minutes',
            relatedEntityId: minutesId,
            recipientScope: 'user_list',
            recipientUserIdsJson: [minutes.preparedBy],
            createdBy: authUser.userId,
          });
        } catch (e) {
          this.logger.warn(
            'Failed to send notification for delete',
            e instanceof Error ? e.message : undefined,
          );
        }
      }
    }

    return result;
  }

  /**
   * Issue (publish) a meeting minutes draft to official status (UC-MKM-09).
   * Transitions status from draft to published, sets issuedBy/issuedAt,
   * writes audit log, and notifies meeting participants (best-effort).
   */
  async issueMinutes(
    minutesId: string,
    authUser: MinutesAuthUser,
  ): Promise<IssueMinutesResponseDto> {
    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    const result = await this.dataSource.transaction(async (manager) => {
      // Step 1: Lock row + validate existence
      const minutes = await manager
        .getRepository(MeetingMinutesEntity)
        .createQueryBuilder('minutes')
        .setLock('pessimistic_write')
        .where('minutes.id = :minutesId', { minutesId })
        .getOne();

      if (!minutes || minutes.deletedAt) {
        throw new NotFoundException({
          success: false,
          message: 'Bien ban hop khong ton tai hoac da bi xoa',
          error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
        });
      }

      // Step 2: Load meeting (read-only, need hostId + status)
      const meeting = await manager
        .getRepository(MeetingEntity)
        .findOne({ where: { id: minutes.meetingId } });

      // Step 3: Ownership-or-admin check
      if (!isAdmin) {
        // Ban hành: chỉ chủ trì (thư ký soạn xong thì trình ký cho chủ trì).
        const isOwner = meeting?.hostId === authUser.userId;
        if (!isOwner) {
          throw new ForbiddenException({
            success: false,
            message: 'Chỉ chủ trì cuộc họp mới được ban hành biên bản',
            error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
          });
        }
      }

      // Step 4: Status must be draft
      if (minutes.status !== MeetingMinutesStatus.DRAFT) {
        throw new ConflictException({
          success: false,
          message: 'Chi co the ban hanh bien ban o trang thai nhap',
          error: {
            code: 'MINUTES_NOT_DRAFT',
            details: { minutesId, currentStatus: minutes.status },
          },
        });
      }

      // Step 5: Meeting must be completed
      if (meeting?.status !== MeetingStatus.COMPLETED) {
        throw new ConflictException({
          success: false,
          message: 'Cuoc hop chua ket thuc, khong the ban hanh bien ban',
          error: {
            code: 'MEETING_NOT_COMPLETED',
            details: {
              meetingId: minutes.meetingId,
              meetingStatus: meeting?.status,
            },
          },
        });
      }

      // Lịch UEL mục 13: cuộc họp yêu cầu trình ký ⇒ chỉ ban hành bản đã được ký duyệt.
      const [signoff] = await manager.query(
        `SELECT signoff_required, signoff_status, signoff_minutes_id, signoff_user_id FROM meetings WHERE id = $1`,
        [minutes.meetingId],
      );
      // Người ký duyệt tự ban hành ⇒ coi như ký duyệt luôn (không cần tự trình rồi tự duyệt).
      if (
        signoff?.signoff_required &&
        signoff.signoff_user_id === authUser.userId &&
        !(signoff.signoff_status === 'approved' && signoff.signoff_minutes_id === minutesId)
      ) {
        await manager.query(
          `UPDATE meetings SET signoff_status = 'approved', signoff_minutes_id = $2, signoff_at = NOW(), signoff_note = NULL
            WHERE id = $1`,
          [minutes.meetingId, minutesId],
        );
        await manager.query(
          `INSERT INTO meeting_signoff_logs (meeting_id, minutes_id, action, actor_id, note)
           VALUES ($1, $2, 'approved', $3, 'Ký duyệt khi ban hành')`,
          [minutes.meetingId, minutesId, authUser.userId],
        );
        await manager.query(
          `UPDATE meeting_minutes SET approved_by = $2, approved_at = NOW() WHERE id = $1`,
          [minutesId, authUser.userId],
        );
        signoff.signoff_status = 'approved';
        signoff.signoff_minutes_id = minutesId;
      }
      if (
        signoff?.signoff_required &&
        !(signoff.signoff_status === 'approved' && signoff.signoff_minutes_id === minutesId)
      ) {
        throw new ConflictException({
          success: false,
          message: 'Biên bản cần được người ký duyệt trước khi ban hành',
          error: {
            code: 'MINUTES_SIGNOFF_REQUIRED',
            details: { signoffStatus: signoff.signoff_status },
          },
        });
      }

      // Step 6: Publish
      const issuedAt = new Date();
      // MKM-LIVE-01 (FR-014/AC-009): live-share khong bao gio ap dung cho
      // ban da published — tu dong tat cung luc voi issue.
      const wasLiveShared = minutes.isLiveShared;
      minutes.status = MeetingMinutesStatus.PUBLISHED;
      minutes.issuedBy = authUser.userId;
      minutes.issuedAt = issuedAt;
      if (wasLiveShared) {
        minutes.isLiveShared = false;
      }
      const saved = await manager
        .getRepository(MeetingMinutesEntity)
        .save(minutes);

      return { saved, meeting, wasLiveShared };
    });

    // Step 6.5: MKM-LIVE-01 — bao cho client dang xem live biet ban da
    // ban hanh, khong con live-share nua (best-effort).
    if (result.wasLiveShared) {
      this.emitMeetingRoomEvent(
        result.saved.meetingId,
        'minutes.draft.live_stopped',
        { minutesId: result.saved.id },
      );
    }

    // Step 7: Audit log (outside transaction, best-effort)
    await this.auditLogsService.logEntityChange({
      userId: authUser.userId,
      actionType: 'meeting_minutes_issued',
      entityType: 'meeting_minutes',
      entityId: minutesId,
      oldValueJson: { status: MeetingMinutesStatus.DRAFT },
      newValueJson: {
        status: MeetingMinutesStatus.PUBLISHED,
        issuedBy: authUser.userId,
        issuedAt: result.saved.issuedAt,
      },
    });

    // Step 8: Query participants for notification (outside transaction)
    let notifiedParticipantCount = 0;
    try {
      const participants = await this.dataSource
        .getRepository(MeetingParticipantEntity)
        .find({ where: { meetingId: result.saved.meetingId } });

      const recipientUserIds = participants
        .map((p) => p.userId)
        .filter((uid) => uid !== authUser.userId);

      if (recipientUserIds.length > 0) {
        await this.dataSource.getRepository(NotificationEntity).insert({
          notificationType: NotificationType.MINUTES_DISTRIBUTION,
          channel: NotificationChannel.IN_APP,
          subject: 'Biên bản họp đã được ban hành chính thức',
          content: `Biên bản họp "${result.saved.title}" đã được ban hành chính thức.`,
          relatedEntityType: 'meeting_minutes',
          relatedEntityId: minutesId,
          recipientScope: 'user_list',
          recipientUserIdsJson: recipientUserIds,
          createdBy: authUser.userId,
        });
        notifiedParticipantCount = recipientUserIds.length;
      }
    } catch (e) {
      this.logger.warn(
        'Failed to send minutes_distribution notification',
        e instanceof Error ? e.message : undefined,
      );
    }

    return new IssueMinutesResponseDto({
      id: result.saved.id,
      meetingId: result.saved.meetingId,
      title: result.saved.title,
      status: result.saved.status,
      versionNo: result.saved.versionNo,
      issuedBy: result.saved.issuedBy!,
      issuedAt: result.saved.issuedAt!,
      updatedAt: result.saved.updatedAt,
      notifiedParticipantCount,
    });
  }

  /* ================================================
     Share Minutes (feat-share-meeting-minutes)
     ================================================ */

  /**
   * Load biên bản + meeting và enforce ownership-or-admin cho các thao tác quản
   * lý share (grant/revoke/list). Trả về minutes + meeting để caller dùng tiếp.
   * KHÔNG kiểm tra status ở đây — mỗi caller tự quyết (grant/revoke cần published,
   * list không cần).
   */
  private async loadMinutesForShareManagement(
    minutesId: string,
    authUserId: string,
  ): Promise<{ minutes: MeetingMinutesEntity; meeting: MeetingEntity | null }> {
    const minutes = await this.dataSource
      .getRepository(MeetingMinutesEntity)
      .findOne({ where: { id: minutesId } });
    if (!minutes || minutes.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Bien ban hop khong ton tai hoac da bi xoa',
        error: { code: 'MINUTES_NOT_FOUND', details: { minutesId } },
      });
    }

    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOne({ where: { id: minutes.meetingId } });

    const { roles } =
      await this.authzRepo.getEffectiveRolesAndPermissions(authUserId);
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );
    if (!isAdmin) {
      const isOwner =
        minutes.preparedBy === authUserId || meeting?.hostId === authUserId;
      if (!isOwner) {
        throw new ForbiddenException({
          success: false,
          message: 'Ban khong co quyen quan ly chia se bien ban nay',
          error: { code: 'NOT_MINUTES_OWNER', details: { minutesId } },
        });
      }
    }

    return { minutes, meeting };
  }

  /**
   * Grant quyền xem 1 biên bản published cho 1 user nội bộ active bất kỳ.
   * FR-001, FR-005, FR-006, FR-025.
   */
  async shareMinutes(
    minutesId: string,
    dto: CreateMinutesShareDto,
    authUser: MinutesAuthUser,
  ): Promise<MinutesShareResponseDto> {
    const { minutes } = await this.loadMinutesForShareManagement(
      minutesId,
      authUser.userId,
    );

    // Chỉ share được khi published (FR-010)
    if (minutes.status !== MeetingMinutesStatus.PUBLISHED) {
      throw new ConflictException({
        success: false,
        message: 'Chi co the chia se bien ban da duoc ban hanh (published)',
        error: {
          code: 'MINUTES_NOT_PUBLISHED',
          details: { minutesId, currentStatus: minutes.status },
        },
      });
    }

    // Validate target user (FR-016, FR-017)
    const targetUser = await this.dataSource
      .getRepository(UserEntity)
      .findOne({ where: { id: dto.userId } });
    if (!targetUser || targetUser.deletedAt) {
      throw new NotFoundException({
        success: false,
        message: 'Nguoi dung duoc chia se khong ton tai',
        error: { code: 'USER_NOT_FOUND', details: { userId: dto.userId } },
      });
    }
    if (targetUser.accountStatus !== AccountStatus.ACTIVE) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Nguoi dung duoc chia se khong o trang thai hoat dong',
        error: {
          code: 'USER_INACTIVE',
          details: {
            userId: dto.userId,
            accountStatus: targetUser.accountStatus,
          },
        },
      });
    }

    // Insert — dựa vào UNIQUE constraint để chống race (FR-024, mục 9.2)
    const shareRepo = this.dataSource.getRepository(MeetingMinutesShareEntity);
    let saved: MeetingMinutesShareEntity;
    try {
      saved = await shareRepo.save(
        shareRepo.create({
          minutesId,
          userId: dto.userId,
          grantedBy: authUser.userId,
        }),
      );
    } catch (e: unknown) {
      if (this.isUniqueViolation(e)) {
        throw new ConflictException({
          success: false,
          message: 'Bien ban da duoc chia se cho nguoi dung nay',
          error: {
            code: 'ALREADY_SHARED',
            details: { minutesId, userId: dto.userId },
          },
        });
      }
      throw e;
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_minutes_shared',
      entityType: 'meeting_minutes',
      entityId: minutesId,
      metadataJson: { targetUserId: dto.userId, grantedBy: authUser.userId },
    });

    return new MinutesShareResponseDto({
      id: saved.id,
      minutesId,
      userId: dto.userId,
      userFullName: targetUser.fullName,
      grantedBy: authUser.userId,
      grantedAt: saved.grantedAt,
    });
  }

  /**
   * Thu hồi (hard-delete) 1 lượt share. FR-003, FR-007, FR-008, FR-019.
   */
  async unshareMinutes(
    minutesId: string,
    targetUserId: string,
    authUser: MinutesAuthUser,
  ): Promise<UnshareMinutesResponseDto> {
    const { minutes } = await this.loadMinutesForShareManagement(
      minutesId,
      authUser.userId,
    );

    if (minutes.status !== MeetingMinutesStatus.PUBLISHED) {
      throw new ConflictException({
        success: false,
        message: 'Chi co the thu hoi chia se khi bien ban dang published',
        error: {
          code: 'MINUTES_NOT_PUBLISHED',
          details: { minutesId, currentStatus: minutes.status },
        },
      });
    }

    const result = await this.dataSource
      .getRepository(MeetingMinutesShareEntity)
      .delete({ minutesId, userId: targetUserId });

    if (!result.affected) {
      throw new NotFoundException({
        success: false,
        message: 'Khong tim thay ban ghi chia se cho nguoi dung nay',
        error: {
          code: 'SHARE_NOT_FOUND',
          details: { minutesId, userId: targetUserId },
        },
      });
    }

    await this.auditLogsService.logAction({
      userId: authUser.userId,
      actionType: 'meeting_minutes_unshared',
      entityType: 'meeting_minutes',
      entityId: minutesId,
      metadataJson: { targetUserId, revokedBy: authUser.userId },
    });

    return new UnshareMinutesResponseDto({
      minutesId,
      userId: targetUserId,
      revoked: true,
    });
  }

  /**
   * Danh sách user đang được share (kèm tên/email). FR-004.
   * KHÔNG chặn theo status (list được cả khi archived — mục 7.3 plan).
   */
  async listMinutesShares(
    minutesId: string,
    authUser: MinutesAuthUser,
  ): Promise<MinutesShareListResponseDto> {
    await this.loadMinutesForShareManagement(minutesId, authUser.userId);

    const rows = await this.dataSource
      .getRepository(MeetingMinutesShareEntity)
      .createQueryBuilder('share')
      .leftJoin('share.user', 'targetUser')
      .leftJoin('share.grantedByUser', 'granter')
      .where('share.minutesId = :minutesId', { minutesId })
      .select([
        'share.id',
        'share.userId',
        'share.grantedBy',
        'share.grantedAt',
        'targetUser.fullName',
        'targetUser.email',
        'granter.fullName',
      ])
      .orderBy('share.grantedAt', 'DESC')
      .getRawAndEntities();

    const shares = rows.entities.map((share, idx) => {
      const raw = rows.raw[idx] as Record<string, unknown>;
      return new MinutesShareListItemDto({
        id: share.id,
        userId: share.userId,
        userFullName: (raw['targetUser_full_name'] as string) ?? '',
        userEmail: (raw['targetUser_email'] as string) ?? '',
        grantedBy: share.grantedBy,
        grantedByName: (raw['granter_full_name'] as string) ?? '',
        grantedAt: share.grantedAt,
      });
    });

    return new MinutesShareListResponseDto({ minutesId, shares });
  }

  /** Postgres unique_violation = SQLSTATE 23505. */
  private isUniqueViolation(e: unknown): boolean {
    return (
      typeof e === 'object' &&
      e !== null &&
      'code' in e &&
      (e as { code?: string }).code === '23505'
    );
  }

  async searchMinutesByPerson(
    dto: SearchMinutesByPersonQueryDto,
    authUser: MinutesAuthUser,
  ): Promise<{
    items: MinutesListItemDto[];
    total: number;
    page: number;
    limit: number;
    person: PersonSummaryDto;
  }> {
    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(20, Math.max(1, dto.limit ?? 20));
    const skip = (page - 1) * limit;

    const targetUser = await this.dataSource.getRepository(UserEntity).findOne({
      where: { id: dto.userId, deletedAt: IsNull() },
    });
    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Nhan su khong ton tai hoac da bi xoa',
        error: { code: 'USER_NOT_FOUND', details: { userId: dto.userId } },
      });
    }

    const { roles } = await this.authzRepo.getEffectiveRolesAndPermissions(
      authUser.userId,
    );
    const isAdmin = roles.some(
      (r) => r === 'SYSTEM_ADMIN' || r === 'BUSINESS_ADMIN',
    );

    let managedDepartmentIds: string[] = [];
    if (!isAdmin) {
      const depts = (await this.dataSource
        .getRepository('DepartmentEntity')
        .find({
          where: { managerUserId: authUser.userId, deletedAt: null },
        })) as Array<{ id: string }>;
      managedDepartmentIds = depts.map((d) => d.id);
      if (managedDepartmentIds.length === 0) {
        return {
          items: [],
          total: 0,
          page,
          limit,
          person: new PersonSummaryDto({
            id: targetUser.id,
            fullName: targetUser.fullName ?? '',
            email: targetUser.email ?? '',
          }),
        };
      }
    }

    const qb = this.dataSource
      .getRepository(MeetingMinutesEntity)
      .createQueryBuilder('minutes')
      .leftJoin('minutes.meeting', 'meeting')
      .leftJoin('meeting.host', 'host')
      .leftJoin('meeting.organizer', 'organizer')
      .select([
        'minutes.id',
        'minutes.title',
        'minutes.status',
        'minutes.versionNo',
        'minutes.source',
        'minutes.createdAt',
        'minutes.updatedAt',
        'minutes.issuedAt',
        'minutes.preparedBy',
        'minutes.issuedBy',
        'minutes.aiSummaryJson',
        'meeting.id',
        'meeting.title',
        'meeting.status',
        'meeting.startTime',
        'meeting.endTime',
        'meeting.actualStartTime',
        'meeting.actualEndTime',
        'meeting.meetingMode',
        'meeting.hostId',
        'meeting.roomId',
        'meeting.organizerId',
        'host.id',
        'host.fullName',
        'host.email',
        'host.avatarUrl',
        'organizer.id',
        'organizer.fullName',
        'organizer.email',
        'organizer.avatarUrl',
      ])
      .where('minutes.deletedAt IS NULL')
      .andWhere(
        new Brackets((sub) => {
          sub
            .where('minutes.preparedBy = :targetUserId', {
              targetUserId: dto.userId,
            })
            .orWhere(
              'EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = meeting.id AND mp.user_id = :targetUserId2)',
              { targetUserId2: dto.userId },
            );
        }),
      );

    if (isAdmin) {
      qb.andWhere("minutes.status IN ('draft', 'published', 'archived')");
    } else {
      qb.andWhere("minutes.status IN ('published', 'archived')");
      qb.andWhere(
        new Brackets((sub) => {
          sub
            .where('host.departmentId IN (:...deptIds)', {
              deptIds: managedDepartmentIds,
            })
            .orWhere(
              'meeting.hostId IS NULL AND organizer.departmentId IN (:...deptIds)',
              { deptIds: managedDepartmentIds },
            );
        }),
      );
    }

    qb.orderBy('meeting.actualStartTime', 'DESC').skip(skip).take(limit);
    const [items, total] = await qb.getManyAndCount();

    const listItems = await this.buildMinutesListItems(items);

    return {
      items: listItems,
      total,
      page,
      limit,
      person: new PersonSummaryDto({
        id: targetUser.id,
        fullName: targetUser.fullName ?? '',
        email: targetUser.email ?? '',
      }),
    };
  }
}
