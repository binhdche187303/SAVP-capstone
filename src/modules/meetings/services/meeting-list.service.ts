import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { MeetingEntity } from '../entities/meeting.entity.js';
import {
  MeetingListQueryDto,
  MeetingListSortField,
} from '../dto/meeting-list-query.dto.js';
import { MeetingListItemDto } from '../dto/meeting-list-item.dto.js';
import { TranscriptEntity } from '../../transcription/entities/transcript.entity.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';

export interface MeetingListResult {
  data: MeetingListItemDto[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

// Allowlist tuong minh sortBy (DTO) -> column SQL that su. KHONG bao gio noi
// truc tiep gia tri tu client vao chuoi SQL (CLAUDE.md 14.3).
const SORT_COLUMN_MAP: Record<MeetingListSortField, string> = {
  created_at: 'meeting.created_at',
  start_time: 'meeting.start_time',
  title: 'meeting.title',
  status: 'meeting.status',
};

/**
 * MeetingListService — BE-02 GET /meetings (list, admin).
 *
 * Tach service rieng thay vi nhoi vao meetings.service.ts (da 5000+ dong,
 * §15 CLAUDE.md — module boundary).
 */
@Injectable()
export class MeetingListService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly authzRepo: AuthzReadRepository,
  ) {}

  /**
   * Phạm vi xem: có 'meeting.read.all' → toàn bộ (null); MANAGER → id các phòng ban mình quản lý;
   * còn lại → 403. Trước đây guard chặn cứng 'meeting.read.all' nên màn Chuyên cần phòng ban
   * của MANAGER luôn 403.
   */
  private async resolveDepartmentScope(
    userId: string,
  ): Promise<string[] | null> {
    const { roles, permissions } =
      await this.authzRepo.getEffectiveRolesAndPermissions(userId);
    if (permissions.includes('meeting.read.all')) return null;
    if (roles.includes('MANAGER')) {
      const rows: Array<{ id: string }> = await this.dataSource.query(
        `SELECT id FROM departments WHERE (manager_user_id = $1 OR EXISTS (SELECT 1 FROM users bgh WHERE bgh.id = $1 AND bgh.leadership_title IS NOT NULL)) AND is_active = true`,
        [userId],
      );
      return rows.map((r) => r.id);
    }
    throw new ForbiddenException({
      code: 'PERMISSION_DENIED',
      message: 'Bạn không có quyền xem danh sách cuộc họp.',
    });
  }

  async list(
    query: MeetingListQueryDto,
    userId: string,
  ): Promise<MeetingListResult> {
    if (query.from && query.to && new Date(query.from) > new Date(query.to)) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: '"from" phai truoc hoac bang "to".',
      });
    }

    const qb = this.dataSource
      .getRepository(MeetingEntity)
      .createQueryBuilder('meeting')
      .leftJoin('meeting.organizer', 'organizer')
      .leftJoin('rooms', 'room', 'room.id = meeting.room_id')
      .where('meeting.deleted_at IS NULL');

    const scopeDepartmentIds = await this.resolveDepartmentScope(userId);
    if (scopeDepartmentIds !== null) {
      if (scopeDepartmentIds.length === 0) {
        return {
          data: [],
          meta: {
            page: query.page,
            limit: query.limit,
            total: 0,
            totalPages: 0,
          },
        };
      }
      // Cuộc họp "của phòng ban": người tổ chức hoặc ít nhất một người tham dự thuộc phòng ban quản lý.
      qb.andWhere(
        `(organizer.department_id IN (:...deptIds) OR EXISTS (
           SELECT 1 FROM meeting_participants mp JOIN users pu ON pu.id = mp.user_id
           WHERE mp.meeting_id = meeting.id AND pu.department_id IN (:...deptIds)))`,
        { deptIds: scopeDepartmentIds },
      );
    }

    if (query.status) {
      qb.andWhere('meeting.status = :status', { status: query.status });
    }
    if (query.roomId) {
      qb.andWhere('meeting.room_id = :roomId', { roomId: query.roomId });
    }
    if (query.organizerId) {
      qb.andWhere('meeting.organizer_id = :organizerId', {
        organizerId: query.organizerId,
      });
    }
    if (query.from) {
      qb.andWhere('meeting.start_time >= :from', { from: query.from });
    }
    if (query.to) {
      qb.andWhere('meeting.start_time <= :to', { to: query.to });
    }
    if (query.search) {
      qb.andWhere('meeting.title ILIKE :search', {
        search: `%${query.search}%`,
      });
    }

    const sortColumn = SORT_COLUMN_MAP[query.sortBy];
    qb.orderBy(sortColumn, query.sortOrder.toUpperCase() as 'ASC' | 'DESC');

    const page = query.page;
    const limit = query.limit;
    qb.skip((page - 1) * limit).take(limit);

    qb.select([
      'meeting.id',
      'meeting.meetingCode',
      'meeting.title',
      'meeting.status',
      'meeting.meetingType',
      'meeting.meetingMode',
      'meeting.attendanceEnabled',
      'meeting.startTime',
      'meeting.endTime',
      'meeting.roomId',
      'meeting.organizerId',
      'meeting.createdAt',
    ]);
    qb.addSelect('organizer.fullName', 'organizer_full_name');
    qb.addSelect('room.room_name', 'room_room_name');
    // BE-5: EXISTS subquery thay vi JOIN — 1 meeting co the co nhieu transcript
    // (nhieu recording session/version), JOIN thuong se nhan ban ghi va lam sai total.
    qb.addSelect(
      (subQuery) =>
        subQuery
          .select('1')
          .from(TranscriptEntity, 'ts')
          .where('ts.meeting_id = meeting.id')
          .limit(1),
      'has_transcript',
    );

    const [entities, total] = await Promise.all([
      qb.getRawAndEntities(),
      qb.getCount(),
    ]);

    const data = entities.entities.map((meeting, index) => {
      const raw = entities.raw[index] as {
        organizer_full_name: string | null;
        room_room_name: string | null;
        has_transcript: number | null;
      };
      return new MeetingListItemDto({
        id: meeting.id,
        meetingCode: meeting.meetingCode,
        title: meeting.title,
        status: meeting.status,
        meetingType: meeting.meetingType,
        meetingMode: meeting.meetingMode,
        attendanceEnabled: meeting.attendanceEnabled,
        startTime: meeting.startTime,
        endTime: meeting.endTime,
        roomId: meeting.roomId,
        roomName: raw?.room_room_name ?? null,
        organizerId: meeting.organizerId,
        organizerName: raw?.organizer_full_name ?? null,
        createdAt: meeting.createdAt,
        hasTranscript: raw?.has_transcript != null,
      });
    });

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
