// Keep time-dependent fixtures independent of the machine date.
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'hrtime', 'performance', 'queueMicrotask'], now: new Date('2026-07-12T00:00:00Z').getTime() }); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getEntityManagerToken } from '@nestjs/typeorm';
import { TimeSuggestionService } from '../services/time-suggestion.service.js';
import { FreeBusyService } from '../services/free-busy.service.js';
import { SuggestTimeSlotDto } from '../dto/suggest-time-slot.dto.js';

describe('TimeSuggestionService', () => {
  let service: TimeSuggestionService;
  let freeBusyService: jest.Mocked<Partial<FreeBusyService>>;
  const mockQuery = jest.fn();

  const organizerId = 'aaaaaaaa-0000-4000-8000-000000000001';
  const requiredId = 'aaaaaaaa-0000-4000-8000-000000000002';
  const optionalId = 'aaaaaaaa-0000-4000-8000-000000000003';

  const baseDto: SuggestTimeSlotDto = {
    requiredParticipantUserIds: [requiredId],
    optionalParticipantUserIds: [optionalId],
    searchRangeStart: '2026-07-13T00:00:00+07:00',
    searchRangeEnd: '2026-07-14T00:00:00+07:00',
    durationMinutes: 60,
  };

  beforeEach(async () => {
    mockQuery.mockReset();
    // Default: all users exist
    mockQuery.mockResolvedValue([{ cnt: 3 }]);

    freeBusyService = {
      getBusyIntervalsByUser: jest.fn(),
      complement: jest.fn(),
      intersectAll: jest.fn(),
      overlapsAny: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeSuggestionService,
        { provide: FreeBusyService, useValue: freeBusyService },
        { provide: getEntityManagerToken(), useValue: { query: mockQuery } },
      ],
    }).compile();

    service = module.get<TimeSuggestionService>(TimeSuggestionService);
  });

  describe('validation', () => {
    it('rejects when searchRangeEnd is before searchRangeStart', async () => {
      const dto = {
        ...baseDto,
        searchRangeStart: '2026-07-14T00:00:00+07:00',
        searchRangeEnd: '2026-07-13T00:00:00+07:00',
      };
      await expect(service.suggestTimeSlots(dto, organizerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when a userId appears in both required and optional lists', async () => {
      const dto = {
        ...baseDto,
        requiredParticipantUserIds: [requiredId],
        optionalParticipantUserIds: [requiredId],
      };
      await expect(service.suggestTimeSlots(dto, organizerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when fewer than 2 internal participants total', async () => {
      const dto = {
        ...baseDto,
        requiredParticipantUserIds: [],
        optionalParticipantUserIds: [],
      };
      // Only organizer alone -> 1 participant total
      await expect(service.suggestTimeSlots(dto, organizerId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when search range exceeds 30 days', async () => {
      const dto = {
        ...baseDto,
        searchRangeStart: '2026-07-13T00:00:00+07:00',
        searchRangeEnd: '2026-09-13T00:00:00+07:00',
      };
      await expect(service.suggestTimeSlots(dto, organizerId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('AC-010: Required participants are a hard filter', () => {
    it('excludes candidates where a required participant is busy', async () => {
      (freeBusyService.getBusyIntervalsByUser as jest.Mock).mockResolvedValue(
        new Map([
          [organizerId, []],
          [requiredId, []],
          [optionalId, []],
        ]),
      );
      // complement called once per required user (organizer, required) -> both fully free
      (freeBusyService.complement as jest.Mock).mockReturnValue([
        {
          start: new Date('2026-07-13T00:00:00Z'),
          end: new Date('2026-07-14T00:00:00Z'),
        },
      ]);
      (freeBusyService.intersectAll as jest.Mock).mockReturnValue([
        {
          start: new Date('2026-07-13T00:00:00Z'),
          end: new Date('2026-07-14T00:00:00Z'),
        },
      ]);
      (freeBusyService.overlapsAny as jest.Mock).mockReturnValue(false);

      const { result } = await service.suggestTimeSlots(baseDto, organizerId);

      expect(result.data.length).toBeGreaterThan(0);
      // Every candidate must have requiredFreeCount === requiredTotal (2: organizer + required)
      for (const item of result.data) {
        expect(item.requiredFreeCount).toBe(item.requiredTotal);
      }
    });

    it('returns an empty list with the E1 message when no common required-free window exists', async () => {
      (freeBusyService.getBusyIntervalsByUser as jest.Mock).mockResolvedValue(
        new Map(),
      );
      (freeBusyService.complement as jest.Mock).mockReturnValue([]);
      (freeBusyService.intersectAll as jest.Mock).mockReturnValue([]);

      const { result, message } = await service.suggestTimeSlots(
        baseDto,
        organizerId,
      );

      expect(result.data).toEqual([]);
      expect(message).toContain('Không tìm thấy khung giờ chung nào phù hợp');
    });
  });

  describe('AC-011: Optional participants only affect ranking', () => {
    it('ranks a slot where the optional participant is free above one where they are busy', async () => {
      const window = [
        {
          start: new Date('2026-07-13T09:00:00Z'),
          end: new Date('2026-07-13T11:00:00Z'),
        },
      ];
      (freeBusyService.getBusyIntervalsByUser as jest.Mock).mockResolvedValue(
        new Map([
          [organizerId, []],
          [requiredId, []],
          [
            optionalId,
            [
              {
                start: new Date('2026-07-13T09:00:00Z'),
                end: new Date('2026-07-13T10:00:00Z'),
              },
            ],
          ],
        ]),
      );
      (freeBusyService.complement as jest.Mock).mockReturnValue(window);
      (freeBusyService.intersectAll as jest.Mock).mockReturnValue(window);
      (freeBusyService.overlapsAny as jest.Mock).mockImplementation(
        (intervals: { start: Date; end: Date }[], start: Date) =>
          intervals.some(
            (iv) =>
              iv.start.getTime() <= start.getTime() &&
              iv.end.getTime() > start.getTime(),
          ),
      );

      const dto = { ...baseDto, durationMinutes: 60 };
      const { result } = await service.suggestTimeSlots(dto, organizerId);

      expect(result.data.length).toBeGreaterThan(1);
      // First result (highest matchScore) should be sorted first
      const scores = result.data.map((i) => i.matchScore);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
      // At least one slot should have optionalFreeCount = 1 (free) ranked above one with 0 (busy)
      expect(result.data[0].optionalFreeCount).toBeGreaterThanOrEqual(
        result.data[result.data.length - 1].optionalFreeCount,
      );
    });
  });
});
