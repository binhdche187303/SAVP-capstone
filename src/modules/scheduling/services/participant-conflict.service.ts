import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectEntityManager } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import { CheckParticipantConflictDto } from '../dto/check-participant-conflict.dto.js';
import {
  ParticipantConflictItemDto,
  BusySlotDto,
} from '../dto/participant-conflict-item.dto.js';
import {
  ParticipantConflictResponseDto,
  ExternalParticipantDto,
} from '../dto/participant-conflict-response.dto.js';
import { MeetingStatus } from '../../meetings/entities/meeting.entity.js';

interface BusySlotRaw {
  start_time: string;
  end_time: string;
}

interface ParticipantConflictRaw {
  user_id: string;
}

@Injectable()
export class ParticipantConflictService {
  constructor(
    @InjectEntityManager() private readonly entityManager: EntityManager,
  ) {}

  async checkConflicts(
    dto: CheckParticipantConflictDto,
    requestingUserId?: string,
  ): Promise<ParticipantConflictResponseDto> {
    this.validateTimeRange(dto.startTime, dto.endTime);
    await this.validateUsersExist(dto.participantUserIds);

    const uniqueUserIds = [...new Set(dto.participantUserIds)];

    if (dto.excludeMeetingId) {
      await this.validateExcludeMeetingAccess(
        dto.excludeMeetingId,
        requestingUserId,
      );
    }

    const startTime = new Date(dto.startTime);
    const endTime = new Date(dto.endTime);
    const checkedAt = new Date().toISOString();

    const busyUserIds = await this.findConflictingUserIds(
      uniqueUserIds,
      startTime,
      endTime,
      dto.excludeMeetingId ?? null,
    );
    const busyUserSet = new Set(busyUserIds);

    const participants: ParticipantConflictItemDto[] = [];

    for (const userId of uniqueUserIds) {
      if (busyUserSet.has(userId)) {
        const rawSlots = await this.findBusySlots(
          userId,
          startTime,
          endTime,
          dto.excludeMeetingId ?? null,
        );
        const mergedSlots = this.mergeBusySlots(rawSlots);
        const busySlots = mergedSlots.map((s) => ({
          busyFrom: s.start_time,
          busyTo: s.end_time,
        }));

        participants.push({
          userId,
          status: 'busy' as const,
          busySlots,
          displayWarning: true,
          warningMessage: this.formatWarningMessage(mergedSlots),
        });
      } else {
        participants.push({
          userId,
          status: 'free' as const,
          busySlots: [],
          displayWarning: false,
          warningMessage: null,
        });
      }
    }

    const externalParticipants: ExternalParticipantDto[] = (
      dto.externalParticipantEmails ?? []
    ).map((email) => ({
      email,
      status: 'unknown' as const,
      warningMessage: 'Không rõ lịch trình',
    }));

    const hasConflict = participants.some((p) => p.status === 'busy');
    return { hasConflict, checkedAt, participants, externalParticipants };
  }

  // --- Validation Helpers ---

  validateTimeRange(startTimeStr, endTimeStr) {
    const startTime = new Date(startTimeStr);
    const endTime = new Date(endTimeStr);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'startTime hoặc endTime không đúng định dạng',
        error: { code: 'VALIDATION_ERROR', details: {} },
        timestamp: new Date().toISOString(),
      });
    }

    if (endTime <= startTime) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Thời gian kết thúc phải sau thời gian bắt đầu',
        error: { code: 'VALIDATION_ERROR', details: {} },
        timestamp: new Date().toISOString(),
      });
    }
  }

  async validateUsersExist(userIds) {
    if (userIds.length === 0) return;

    const uniqueIds = [...new Set(userIds)];

    if (uniqueIds.length !== userIds.length) {
      throw new BadRequestException({
        statusCode: 400,
        message: 'Danh sách người tham dự chứa giá trị trùng lặp',
        error: { code: 'VALIDATION_ERROR', details: {} },
        timestamp: new Date().toISOString(),
      });
    }

    const result = await this.entityManager.query(
      `SELECT COUNT(*)::int AS cnt FROM users WHERE id = ANY($1) AND deleted_at IS NULL`,
      [uniqueIds],
    );

    const foundCount = result[0]?.cnt ?? 0;
    if (foundCount !== uniqueIds.length) {
      throw new BadRequestException({
        statusCode: 400,
        message:
          'Một hoặc nhiều participantUserId không tồn tại hoặc đã bị xóa',
        error: { code: 'VALIDATION_ERROR', details: {} },
        timestamp: new Date().toISOString(),
      });
    }
  }

  async validateExcludeMeetingAccess(meetingId, requestingUserId) {
    const meeting = await this.entityManager.query(
      `SELECT id, organizer_id FROM meetings WHERE id = $1 AND deleted_at IS NULL`,
      [meetingId],
    );

    if (!meeting || meeting.length === 0) {
      throw new NotFoundException({
        statusCode: 404,
        message: 'Không tìm thấy cuộc họp với excludeMeetingId',
        error: { code: 'RESOURCE_NOT_FOUND', details: {} },
        timestamp: new Date().toISOString(),
      });
    }

    if (requestingUserId) {
      const meetingRecord = meeting[0];
      const isOrganizer = meetingRecord.organizer_id === requestingUserId;

      let isParticipant = false;
      if (!isOrganizer) {
        const participantCheck = await this.entityManager.query(
          `SELECT 1 FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2 LIMIT 1`,
          [meetingId, requestingUserId],
        );
        isParticipant = participantCheck.length > 0;
      }

      if (!isOrganizer && !isParticipant) {
        throw new ForbiddenException({
          statusCode: 403,
          message: 'Bạn không có quyền truy cập cuộc họp này',
          error: { code: 'PERMISSION_DENIED', details: {} },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  async findConflictingUserIds(userIds, startTime, endTime, excludeMeetingId) {
    if (userIds.length === 0) return [];

    const result = await this.entityManager.query(
      `SELECT DISTINCT mp.user_id
        FROM meeting_participants mp
        JOIN meetings m ON m.id = mp.meeting_id
        WHERE mp.user_id = ANY($1::uuid[])
          AND m.deleted_at IS NULL
          AND m.status NOT IN ($2, $3)
          AND m.start_time < $4
          AND m.end_time > $5
          AND ($6::uuid IS NULL OR m.id != $6)`,
      [userIds, 'cancelled', 'completed', endTime, startTime, excludeMeetingId],
    );

    return result.map((r) => r.user_id);
  }

  async findBusySlots(userId, startTime, endTime, excludeMeetingId) {
    const result = await this.entityManager.query(
      `SELECT m.start_time, m.end_time
        FROM meeting_participants mp
        JOIN meetings m ON m.id = mp.meeting_id
        WHERE mp.user_id = $1
          AND m.deleted_at IS NULL
          AND m.status NOT IN ($2, $3)
          AND m.start_time < $4
          AND m.end_time > $5
          AND ($6::uuid IS NULL OR m.id != $6)
        ORDER BY m.start_time ASC`,
      [userId, 'cancelled', 'completed', endTime, startTime, excludeMeetingId],
    );

    return result;
  }

  mergeBusySlots(slots) {
    if (slots.length <= 1) return slots;

    const merged: BusySlotRaw[] = [];
    let current = { ...slots[0] };

    for (let i = 1; i < slots.length; i++) {
      const next = slots[i];
      const currentEnd = new Date(current.end_time).getTime();
      const nextStart = new Date(next.start_time).getTime();

      if (currentEnd >= nextStart) {
        const nextEnd = new Date(next.end_time).getTime();
        if (nextEnd > currentEnd) {
          current.end_time = next.end_time;
        }
      } else {
        merged.push(current);
        current = { ...next };
      }
    }

    merged.push(current);
    return merged;
  }

  formatWarningMessage(slots) {
    if (!slots || slots.length === 0) return null;

    const formatTime = (iso) => {
      const d = new Date(iso);
      return d.toLocaleTimeString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    };

    if (slots.length === 1) {
      return `Bận từ ${formatTime(slots[0].start_time)} - ${formatTime(slots[0].end_time)}`;
    }

    return slots
      .map((s) => `${formatTime(s.start_time)} - ${formatTime(s.end_time)}`)
      .join(', ');
  }
}
