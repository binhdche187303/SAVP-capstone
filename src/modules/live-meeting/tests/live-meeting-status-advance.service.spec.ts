/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { ConflictException } from '@nestjs/common';
import { LiveMeetingService } from '../services/live-meeting.service.js';
import { MeetingStatus } from '../../meetings/entities/meeting.entity.js';
import { MEETING_END_ERRORS } from '../constants/meeting-end-error.constant.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../../rooms/entities/room-booking.entity.js';

/**
 * F-A (MST-001) — cron lật meetings.status theo thời gian.
 *
 * File RIÊNG, KHÔNG nhét vào live-meeting.service.spec.ts: file đó đang có lỗi
 * cấu trúc sẵn (describe lồng trong it) + nhiều test phụ thuộc wall-clock đang
 * đỏ từ trước — thêm vào đó sẽ không phân biệt được lỗi mới/cũ.
 */
describe('LiveMeetingService — advance meeting statuses (F-A / MST-001)', () => {
  let service: LiveMeetingService;
  let dsMock: any;
  let recordingServiceMock: {
    stopAllActiveForMeeting: jest.Mock;
  };

  const build = () => {
    dsMock = {
      query: jest.fn(),
      getRepository: jest.fn(),
      transaction: jest.fn(),
      manager: { query: jest.fn() },
    };
    recordingServiceMock = {
      stopAllActiveForMeeting: jest
        .fn()
        .mockResolvedValue({ scanned: 0, stopped: 0, failed: 0 }),
    };
    return new LiveMeetingService(
      dsMock,
      { emitToRoom: jest.fn() } as any,
      { addJob: jest.fn(), getQueue: jest.fn() } as any,
      { create: jest.fn(), markCompleted: jest.fn() } as any,
      { get: jest.fn((_k: string, d?: unknown) => d) } as any,
      { revokeAllForMeeting: jest.fn().mockResolvedValue(0) } as any,
      recordingServiceMock as any,
    );
  };

  beforeEach(() => {
    service = build();
  });

  describe('autoStartDueMeetings()', () => {
    // [FIX 2026-08-13, Fix B] autoStartDueMeetings() giờ chạy trong
    // dataSource.transaction() (để đồng bộ room_bookings approved→active
    // CÙNG transaction với UPDATE meetings) — mock dsMock.transaction thay
    // vì gọi thẳng dsMock.query, mirror pattern "R9" bên dưới.
    let emMock: { query: jest.Mock; update: jest.Mock };

    beforeEach(() => {
      emMock = {
        query: jest.fn(),
        update: jest.fn().mockResolvedValue({ affected: 0 }),
      };
      dsMock.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(emMock),
      );
    });

    it('UPDATE đúng: scheduled → in_progress, chỉ họp đã tới giờ, bỏ soft-delete', async () => {
      emMock.query.mockResolvedValue([[{ id: 'm1' }, { id: 'm2' }], 2]);
      const r = await service.autoStartDueMeetings();

      expect(r.started).toBe(2);
      const [sql, params] = emMock.query.mock.calls[0];
      expect(sql).toContain('UPDATE meetings');
      expect(sql).toContain('start_time <= now()');
      expect(sql).toContain('deleted_at IS NULL');
      expect(sql).toContain('RETURNING id');
      expect(params).toEqual([
        MeetingStatus.IN_PROGRESS,
        MeetingStatus.SCHEDULED,
      ]);
    });

    it('actual_start_time = start_time theo LỊCH (không phải now()), COALESCE giữ mốc đã có', async () => {
      emMock.query.mockResolvedValue([[], 0]);
      await service.autoStartDueMeetings();

      const [sql] = emMock.query.mock.calls[0];
      expect(sql).toContain(
        'actual_start_time = COALESCE(actual_start_time, start_time)',
      );
      // Chặn hồi quy: KHÔNG được gán now() — cron chạy mỗi phút sẽ lệch, và
      // server tắt/bật lại thì lệch rất xa giờ lịch.
      expect(sql).not.toMatch(/actual_start_time\s*=\s*now\(\)/);
    });

    it('CHỈ đụng status=scheduled → cancelled/draft/pending_approval/completed nguyên vẹn', async () => {
      emMock.query.mockResolvedValue([[], 0]);
      await service.autoStartDueMeetings();

      const [sql, params] = emMock.query.mock.calls[0];
      expect(sql).toContain('WHERE status = $2');
      expect(params[1]).toBe(MeetingStatus.SCHEDULED);
      for (const untouched of [
        MeetingStatus.CANCELLED,
        MeetingStatus.DRAFT,
        MeetingStatus.PENDING_APPROVAL,
        MeetingStatus.COMPLETED,
      ]) {
        expect(sql).not.toContain(untouched);
      }
    });

    it('không có họp nào tới giờ → started=0, KHÔNG lỗi (idempotent)', async () => {
      emMock.query.mockResolvedValue([[], 0]);
      await expect(service.autoStartDueMeetings()).resolves.toEqual({
        started: 0,
      });
    });

    it('driver trả dạng lạ (không phải mảng) → started=0, KHÔNG crash', async () => {
      emMock.query.mockResolvedValue(undefined);
      await expect(service.autoStartDueMeetings()).resolves.toEqual({
        started: 0,
      });
    });

    // ────────────────────────────────────────
    //  [FIX 2026-08-13, Fix B] đóng gốc rễ tận nơi: đồng bộ room_bookings
    //  NGAY khi cron tự-start, không chỉ dựa vào Fix A "tự phục hồi" lúc
    //  kết thúc.
    // ────────────────────────────────────────
    it('[Fix B] có họp tự-start → đồng bộ room_bookings approved→active TRONG CÙNG transaction', async () => {
      emMock.query.mockResolvedValue([[{ id: 'm1' }, { id: 'm2' }], 2]);
      const r = await service.autoStartDueMeetings();

      expect(r.started).toBe(2);
      expect(dsMock.transaction).toHaveBeenCalledTimes(1);
      expect(emMock.update).toHaveBeenCalledTimes(1);
      const [entity, where, set] = emMock.update.mock.calls[0];
      expect(entity).toBe(RoomBookingEntity);
      expect(where.status).toBe(RoomBookingStatus.APPROVED);
      expect(where.meetingId.value).toEqual(['m1', 'm2']);
      expect(set).toEqual({ status: RoomBookingStatus.ACTIVE });
    });

    it('[Fix B] không có họp nào tự-start → KHÔNG gọi update room_bookings (tránh UPDATE rỗng vô nghĩa)', async () => {
      emMock.query.mockResolvedValue([[], 0]);
      await service.autoStartDueMeetings();

      expect(emMock.update).not.toHaveBeenCalled();
    });
  });

  describe('advanceMeetingStatuses()', () => {
    it('chạy start TRƯỚC complete (họp scheduled quá giờ phải qua in_progress mới endMeeting được)', async () => {
      const order: string[] = [];
      jest
        .spyOn(service, 'autoStartDueMeetings')
        .mockImplementation(async () => {
          order.push('start');
          return { started: 1 };
        });
      jest
        .spyOn(service, 'autoCompleteOverdueMeetings')
        .mockImplementation(async () => {
          order.push('complete');
          return { scanned: 1, completed: 1, skipped: 0, failed: 0 };
        });

      const r = await service.advanceMeetingStatuses();

      expect(order).toEqual(['start', 'complete']);
      expect(r).toEqual({
        started: 1,
        scanned: 1,
        completed: 1,
        skipped: 0,
        failed: 0,
      });
    });
  });

  describe('autoCompleteOverdueMeetings()', () => {
    it('quét scheduled + in_progress quá end_time, gọi endMeeting với organizer làm actor', async () => {
      dsMock.query.mockResolvedValue([
        { id: 'm1', organizer_id: 'org-1' },
        { id: 'm2', organizer_id: 'org-2' },
      ]);
      const endSpy = jest
        .spyOn(service, 'endMeeting')
        .mockResolvedValue({} as any);

      const r = await service.autoCompleteOverdueMeetings();

      const [sql] = dsMock.query.mock.calls[0];
      expect(sql).toContain("status IN ('scheduled', 'in_progress')");
      expect(sql).toContain('end_time < now()');
      expect(endSpy).toHaveBeenCalledTimes(2);
      expect(endSpy.mock.calls[0][1]).toEqual({ userId: 'org-1' });
      expect(r).toEqual({
        scanned: 2,
        completed: 2,
        skipped: 0,
        failed: 0,
      });
    });

    it('MEETING_NOT_STARTED → tính skipped, KHÔNG phải failed', async () => {
      dsMock.query.mockResolvedValue([{ id: 'm1', organizer_id: 'org-1' }]);
      jest.spyOn(service, 'endMeeting').mockRejectedValue(
        new ConflictException({
          success: false,
          message: 'x',
          error: { code: MEETING_END_ERRORS.MEETING_NOT_STARTED, details: {} },
        }),
      );

      const r = await service.autoCompleteOverdueMeetings();
      expect(r).toEqual({
        scanned: 1,
        completed: 0,
        skipped: 1,
        failed: 0,
      });
    });

    it('1 meeting lỗi → đếm failed, các meeting khác VẪN được xử lý tiếp', async () => {
      dsMock.query.mockResolvedValue([
        { id: 'bad', organizer_id: 'o1' },
        { id: 'good', organizer_id: 'o2' },
      ]);
      jest
        .spyOn(service, 'endMeeting')
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({} as any);

      const r = await service.autoCompleteOverdueMeetings();
      expect(r).toEqual({
        scanned: 2,
        completed: 1,
        skipped: 0,
        failed: 1,
      });
    });
  });

  // [FIX 2026-08-12, R9 — Lớp 1] endMeeting() KHÔNG bị spy/mock ở đây (khác các test trên) —
  // để chứng minh đường CRON (autoCompleteOverdueMeetings → endMeeting) cũng chạy qua ĐÚNG
  // logic auto-stop recording mới thêm, không phải chỉ đường thủ công (đã test riêng ở
  // live-meeting.service.spec.ts). Mirror mockTransactionalEm/mockQueryBuilder của
  // live-meeting.service.spec.ts (không import chung — file này cố tình tách biệt).
  describe('autoCompleteOverdueMeetings() → endMeeting() THẬT (R9, không mock endMeeting)', () => {
    it('cron chạy hết endMeeting() thật → vẫn gọi stopAllActiveForMeeting(meetingId, null) — chứng minh 2 đường dùng chung 1 hàm', async () => {
      const meeting = {
        id: 'm1',
        organizerId: 'org-1',
        hostId: 'host-1',
        roomId: 'room-1',
        status: MeetingStatus.IN_PROGRESS,
        startTime: new Date(Date.now() - 60 * 60 * 1000),
        endTime: new Date(Date.now() - 1000),
        actualStartTime: new Date(Date.now() - 60 * 60 * 1000),
        actualEndTime: null,
        deletedAt: null,
      };
      const queryBuilder = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(meeting),
      };
      const em = {
        createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
        update: jest.fn().mockResolvedValue({ affected: 1 }),
        // [FIX 2026-08-13, Fix A] executeEndMeetingInTransaction() giờ
        // SELECT booking (approved|active) trước khi release.
        findOne: jest.fn().mockResolvedValue({
          id: 'booking-1',
          status: RoomBookingStatus.ACTIVE,
        }),
        create: jest.fn((_e: unknown, obj: any) => obj),
        save: jest.fn().mockResolvedValue({}),
      };
      dsMock.query.mockResolvedValue([{ id: 'm1', organizer_id: 'org-1' }]);
      dsMock.getRepository.mockReturnValue({
        findOne: jest.fn().mockResolvedValue(meeting),
      });
      dsMock.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(em),
      );

      const r = await service.autoCompleteOverdueMeetings();

      expect(r).toEqual({ scanned: 1, completed: 1, skipped: 0, failed: 0 });
      expect(recordingServiceMock.stopAllActiveForMeeting).toHaveBeenCalledWith(
        'm1',
        null,
        'meeting_ended',
      );
    });
  });
});
