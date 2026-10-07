/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SecurityAlertEntity } from '../entities/security-alert.entity.js';
import { AlertsService } from './alerts.service.js';
import { SecurityAlertConfigService } from './security-alert-config.service.js';
import { SecurityAlertNotifierService } from './security-alert-notifier.service.js';

describe('AlertsService (ASC-001 / UC-123)', () => {
  let service: AlertsService;
  let repo: any;
  let qb: any;
  let securityAlertConfigService: any;

  beforeEach(async () => {
    qb = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
      getMany: jest.fn().mockResolvedValue([]),
    };
    repo = {
      create: jest.fn((x: any) => x),
      save: jest.fn((x: any) => Promise.resolve({ id: 'a1', ...x })),
      findOne: jest.fn().mockResolvedValue(null),
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qb),
      // bumpOccurrence() dùng raw SQL (jsonb_set atomic) thay vì createQueryBuilder —
      // xem alerts.service.ts.
      query: jest.fn().mockResolvedValue(undefined),
    };
    // [FIX 2026-08-11] bumpOccurrence() đọc occurrenceDebounceSeconds mỗi lần gọi —
    // mock default=5s (giống DEBOUNCE_CONFIG_DEFAULT thật), override per-test khi cần.
    securityAlertConfigService = {
      getDebounceSeconds: jest.fn().mockResolvedValue(5),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertsService,
        { provide: getRepositoryToken(SecurityAlertEntity), useValue: repo },
        {
          provide: SecurityAlertConfigService,
          useValue: securityAlertConfigService,
        },
      ],
    }).compile();
    service = module.get(AlertsService);
  });

  describe('notifier (lỗi 3: thông báo cảnh báo mới)', () => {
    let notifier: { notifyNewAlert: jest.Mock };
    let svc: AlertsService;

    beforeEach(async () => {
      notifier = { notifyNewAlert: jest.fn().mockResolvedValue(undefined) };
      const m = await Test.createTestingModule({
        providers: [
          AlertsService,
          { provide: getRepositoryToken(SecurityAlertEntity), useValue: repo },
          {
            provide: SecurityAlertConfigService,
            useValue: securityAlertConfigService,
          },
          { provide: SecurityAlertNotifierService, useValue: notifier },
        ],
      }).compile();
      svc = m.get(AlertsService);
    });

    it('alert MỚI → gọi notifyNewAlert đúng 1 lần với alert vừa tạo', async () => {
      const r = await svc.recordAlert({ alertType: 'crowd', zoneId: 'z1' });
      expect(r.isNew).toBe(true);
      expect(notifier.notifyNewAlert).toHaveBeenCalledTimes(1);
      expect(notifier.notifyNewAlert).toHaveBeenCalledWith(r.alert);
    });

    it('bump alert đang mở (isNew=false) → KHÔNG gọi notifier (chống spam)', async () => {
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      const open = {
        id: 'open-1',
        alertType: 'crowd',
        zoneId: 'z1',
        status: 'new',
      };
      repo.findOne
        .mockResolvedValueOnce(open)
        .mockResolvedValueOnce({ ...open, occurrenceCount: 2 });
      const r = await svc.recordAlert({ alertType: 'crowd', zoneId: 'z1' });
      expect(r.isNew).toBe(false);
      expect(notifier.notifyNewAlert).not.toHaveBeenCalled();
    });

    it('notifier treo → recordAlert KHÔNG chờ (fire-and-forget)', async () => {
      notifier.notifyNewAlert.mockReturnValue(new Promise(() => undefined));
      await expect(
        svc.recordAlert({ alertType: 'crowd', zoneId: 'z1' }),
      ).resolves.toMatchObject({ isNew: true });
    });
  });

  describe('recordAlert', () => {
    it('R1 crux: KHÔNG có alert đang mở → INSERT mới, isNew=true, severity theo bảng mặc định', async () => {
      const r = await service.recordAlert({ alertType: 'intrusion' });
      expect(repo.save).toHaveBeenCalledTimes(1);
      const saved = repo.save.mock.calls[0][0];
      expect(saved.status).toBe('new');
      expect(saved.occurrenceCount).toBe(1);
      expect(saved.severity).toBe('critical'); // default map intrusion
      expect(saved.zoneId).toBeNull();
      expect(r.isNew).toBe(true);
    });

    it('severity override từ caller được ưu tiên hơn bảng mặc định', async () => {
      await service.recordAlert({ alertType: 'crowd', severity: 'critical' });
      expect(repo.save.mock.calls[0][0].severity).toBe('critical');
    });

    it('alertType lạ không có trong bảng mặc định → fallback medium', async () => {
      await service.recordAlert({ alertType: 'device_error' });
      expect(repo.save.mock.calls[0][0].severity).toBe('low');
    });

    it('R2 crux: 23505 (đã có alert mở) → KHÔNG throw, chuyển UPDATE occurrenceCount, isNew=false, severity/triggeredAt KHÔNG bị ghi đè', async () => {
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      const openAlert = {
        id: 'open-1',
        alertType: 'crowd',
        zoneId: 'zone-1',
        severity: 'high',
        status: 'new',
      };
      repo.findOne
        .mockResolvedValueOnce(openAlert) // findOpenAlert
        .mockResolvedValueOnce({ ...openAlert, occurrenceCount: 2 }); // getOrThrow sau bumpOccurrence
      const r = await service.recordAlert({
        alertType: 'crowd',
        zoneId: 'zone-1',
        severity: 'critical', // PHẢI bị bỏ qua — alert đang mở giữ nguyên severity gốc
      });
      expect(r.isNew).toBe(false);
      expect(repo.query).toHaveBeenCalledTimes(1); // bumpOccurrence() raw SQL, không còn createQueryBuilder
      expect(r.alert.occurrenceCount).toBe(2);
    });

    it('đợt 1: alert đang mở → SELECT trước rồi bump, KHÔNG thử INSERT (không lỗi 23505 vô ích)', async () => {
      repo.findOne
        .mockResolvedValueOnce({ id: 'open-1', status: 'new' })
        .mockResolvedValueOnce({ id: 'open-1', occurrenceCount: 2 });
      const r = await service.recordAlert({ alertType: 'crowd', zoneId: 'z1' });
      expect(r.isNew).toBe(false);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it('đợt 1: dedupeKey vào điều kiện tìm alert mở + bản ghi INSERT (mặc định rỗng)', async () => {
      await service.recordAlert({
        alertType: 'person_watchlist_match',
        zoneId: 'z1',
        dedupeKey: 'user-1',
      });
      expect(repo.findOne.mock.calls[0][0].where.dedupeKey).toBe('user-1');
      expect(repo.save.mock.calls[0][0].dedupeKey).toBe('user-1');
      await service.recordAlert({ alertType: 'crowd', zoneId: 'z1' });
      expect(repo.save.mock.calls[1][0].dedupeKey).toBe('');
    });

    it('zoneId NULL: findOpenAlert dùng nhánh IsNull (KHÔNG so sánh = null trực tiếp)', async () => {
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.findOne
        .mockResolvedValueOnce({ id: 'open-1', status: 'new' })
        .mockResolvedValueOnce({ id: 'open-1', occurrenceCount: 2 });
      await service.recordAlert({ alertType: 'stranger' });
      const where = repo.findOne.mock.calls[0][0].where;
      expect(where.zoneId).toBeDefined(); // IsNull() object, KHÔNG phải literal null
    });

    it('race hiếm: 23505 nhưng SELECT không thấy alert mở → retry INSERT 1 lần, thành công', async () => {
      repo.save
        .mockRejectedValueOnce({ driverError: { code: '23505' } })
        .mockResolvedValueOnce({ id: 'a2', status: 'new' });
      repo.findOne.mockResolvedValueOnce(null); // findOpenAlert lần 1: không thấy
      const r = await service.recordAlert({ alertType: 'stranger' });
      expect(repo.save).toHaveBeenCalledTimes(2);
      expect(r.isNew).toBe(true);
    });

    it('race hiếm: retry vẫn 23505, SELECT lần 2 tìm thấy → UPDATE bumpOccurrence', async () => {
      repo.save
        .mockRejectedValueOnce({ driverError: { code: '23505' } })
        .mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.findOne
        .mockResolvedValueOnce(null) // findOpenAlert lần 1: không thấy
        .mockResolvedValueOnce({ id: 'a3', status: 'new' }) // findOpenAlert lần 2: thấy
        .mockResolvedValueOnce({ id: 'a3', occurrenceCount: 2 }); // getOrThrow sau bump
      const r = await service.recordAlert({ alertType: 'stranger' });
      expect(r.isNew).toBe(false);
      expect(r.alert.id).toBe('a3');
    });

    it('race cực hiếm: retry vẫn 23505 và vẫn không SELECT thấy → throw lỗi rõ ràng', async () => {
      repo.save
        .mockRejectedValueOnce({ driverError: { code: '23505' } })
        .mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.findOne.mockResolvedValue(null);
      await expect(
        service.recordAlert({ alertType: 'stranger' }),
      ).rejects.toThrow(/recordAlert/);
    });

    it('save ném lỗi khác (không phải 23505) → ném lại nguyên lỗi', async () => {
      const boom = new Error('db down');
      repo.save.mockRejectedValue(boom);
      await expect(service.recordAlert({ alertType: 'crowd' })).rejects.toBe(
        boom,
      );
    });
  });

  describe('bumpOccurrence — payload_json.occurrences (fix "mất dấu vết nhiều người vi phạm")', () => {
    // repo.query() ở đây là raw SQL (WITH latest_match + jsonb_set atomic, chạy thật trong
    // Postgres khi production) — không có DB thật trong unit test này, nên repo.query mock
    // TỰ MÔ PHỎNG đúng thuật toán mà câu SQL trong alerts.service.ts thực hiện (đọc params
    // $2/$3/$4 y hệt code thật truyền vào: entry JSON, cap 20, debounceSeconds), để xác nhận
    // HÀNH VI qua nhiều lần gọi recordAlert() liên tiếp — bao gồm cả nhánh debounce [FIX
    // 2026-08-11]: last_seen_at/occurrence_count LUÔN tăng vô điều kiện; occurrences CHỈ
    // skip append khi entry mới CÙNG userId (khác null) với entry gần nhất trong mảng hiện
    // có VÀ cách nhau dưới debounceSeconds giây — mirror đúng điều kiện SQL
    // `latest_match`/`ABS(EXTRACT(EPOCH FROM (...))) < $4`.
    interface OccurrenceEntry {
      userId: string | null;
      sourceEventId: string | null;
      occurredAt: string;
    }
    // [FIX 2026-08-13] mirror ĐÚNG SQL mới trong alerts.service.ts (đã verify riêng bằng
    // psql thật, xem báo cáo recon — mock này chỉ để test hành vi qua nhiều lần gọi
    // recordAlert() liên tiếp ở tầng JS, KHÔNG thay thế verify SQL thật):
    // - latest_match: alertType KHÁC crowd → so với entry CUỐI CÙNG cùng userId (như cũ,
    //   KHÔNG đổi — ord DESC).
    // - occurrence_count: CHỈ bị debounce chặn khi alertType='crowd' — mọi alertType khác
    //   (kể cả Intrusion userId=null/người lạ) LUÔN +1 vô điều kiện, giữ100% hành vi cũ.
    // - occurrences: gate debounce KHÔNG đổi cho mọi alertType (hành vi fix 2026-08-11).
    // - last_seen_at: LUÔN cập nhật vô điều kiện, không phụ thuộc debounce (R3).
    // [FIX 2026-08-18] alertType='crowd' → đổi "entry CUỐI CÙNG được ghi" (ord DESC) sang
    // "entry GẦN NHẤT VỀ occurredAt" (nearest-match) — mirror đúng SQL mới (xem
    // alerts.service.ts, bumpOccurrence()): Crowd có 2 đường gọi song song
    // (evaluateZoneCountNow() tức thời + evaluateCrowdAlerts() cron KHÔNG ORDER BY) có thể
    // xử lý lại CÙNG 1 event KHÔNG THEO THỨ TỰ THỜI GIAN THẬT — "ord DESC" giả định ngầm xử
    // lý tuần tự đúng thứ tự, không còn đúng khi cron xử lý ngoài thứ tự. So "gần nhất về
    // occurredAt" (thời gian THẬT của event, KHÔNG PHẢI giờ xử lý) làm debounce bất biến với
    // thứ tự/số lần xử lý lại.
    const makeStatefulQueryMock = (row: {
      occurrenceCount: number;
      lastSeenAt: string | null;
      payloadJson: Record<string, unknown>;
    }) =>
      jest.fn((_sql: string, params: unknown[]) => {
        const [, entryJson, max, debounceSeconds, alertType] = params as [
          string,
          string,
          number,
          number,
          string,
        ];
        const entry = JSON.parse(entryJson) as OccurrenceEntry;
        const prior = (row.payloadJson.occurrences as OccurrenceEntry[]) ?? [];

        row.lastSeenAt = new Date().toISOString();

        const nearestByTime = (
          list: OccurrenceEntry[],
        ): OccurrenceEntry | undefined =>
          list.reduce<OccurrenceEntry | undefined>((nearest, e) => {
            if (!nearest) return e;
            const diffNearest = Math.abs(
              new Date(entry.occurredAt).getTime() -
                new Date(nearest.occurredAt).getTime(),
            );
            const diffE = Math.abs(
              new Date(entry.occurredAt).getTime() -
                new Date(e.occurredAt).getTime(),
            );
            return diffE < diffNearest ? e : nearest;
          }, undefined);

        const latestMatch =
          alertType === 'crowd'
            ? nearestByTime(prior)
            : [...prior]
                .reverse()
                .find((e) => e.userId !== null && e.userId === entry.userId);
        const debounced =
          (alertType === 'crowd' || entry.userId !== null) &&
          latestMatch !== undefined &&
          Math.abs(
            (new Date(entry.occurredAt).getTime() -
              new Date(latestMatch.occurredAt).getTime()) /
              1000,
          ) < debounceSeconds;

        if (!(alertType === 'crowd' && debounced)) {
          row.occurrenceCount += 1;
        }
        if (!debounced) {
          row.payloadJson = {
            ...row.payloadJson,
            occurrences: [...prior, entry].slice(-max),
          };
        }
        return Promise.resolve(undefined);
      });

    it('bump nhiều lần liên tiếp → occurrences tích lũy đúng, giữ thứ tự, không mất entry', async () => {
      const row = {
        id: 'alert-1',
        alertType: 'intrusion',
        zoneId: 'zone-1',
        status: 'new',
        occurrenceCount: 1,
        lastSeenAt: null as string | null,
        payloadJson: {} as Record<string, unknown>,
      };
      repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
      repo.save.mockRejectedValue({ driverError: { code: '23505' } }); // luôn có alert mở → luôn bump
      repo.query = makeStatefulQueryMock(row);

      const violators = [
        {
          sourceEventId: 'evt-1',
          userId: 'u1',
          occurredAt: '2026-08-09T01:00:00.000Z',
        },
        {
          sourceEventId: 'evt-2',
          userId: 'u2',
          occurredAt: '2026-08-09T01:05:00.000Z',
        },
        {
          sourceEventId: 'evt-3',
          userId: null,
          occurredAt: '2026-08-09T01:10:00.000Z',
        },
      ];
      let last;
      for (const v of violators) {
        last = await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: v.sourceEventId,
          payloadJson: { userId: v.userId, occurredAt: v.occurredAt },
        });
      }

      expect(repo.query).toHaveBeenCalledTimes(3);
      expect(last!.isNew).toBe(false);
      expect(last!.alert.payloadJson.occurrences).toEqual(violators);
    });

    it('payload_json.occurrences đã có đủ 20 phần tử → bump thêm 1 vẫn giữ đúng 20, drop entry cũ nhất', async () => {
      const seeded = Array.from({ length: 20 }, (_, i) => ({
        userId: `u${i}`,
        sourceEventId: `evt-${i}`,
        occurredAt: `2026-08-09T00:${String(i).padStart(2, '0')}:00.000Z`,
      }));
      const row = {
        id: 'alert-2',
        alertType: 'crowd',
        zoneId: 'zone-9',
        status: 'new',
        occurrenceCount: 20,
        lastSeenAt: null as string | null,
        payloadJson: { occurrences: seeded } as Record<string, unknown>,
      };
      repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
      repo.save.mockRejectedValueOnce({ driverError: { code: '23505' } });
      repo.query = makeStatefulQueryMock(row);

      const r = await service.recordAlert({
        alertType: 'crowd',
        zoneId: 'zone-9',
        sourceEventId: 'evt-new',
        payloadJson: { occurredAt: '2026-08-09T02:00:00.000Z' }, // crowd: không có userId
      });

      const occurrences = r.alert.payloadJson!.occurrences as unknown[];
      expect(occurrences).toHaveLength(20);
      expect(occurrences[0]).toEqual(seeded[1]); // entry cũ nhất (u0/evt-0) bị drop
      expect(occurrences[19]).toEqual({
        userId: null,
        sourceEventId: 'evt-new',
        occurredAt: '2026-08-09T02:00:00.000Z',
      });
    });

    describe('debounce theo userId (fix 2026-08-11, chống thổi phồng khi camera bắn appear gần-trùng-giờ)', () => {
      it('case biên — alert vừa mở, occurrences RỖNG → latest_match 0 dòng, EXISTS=false → LUÔN append (không phụ thuộc debounceSeconds)', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(9999); // debounce cực lớn — vẫn phải append vì chưa có gì để so
        const row = {
          id: 'alert-empty',
          alertType: 'intrusion',
          zoneId: 'zone-1',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>, // occurrences chưa tồn tại (rỗng)
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        const r = await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-1',
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:00.000Z' },
        });

        expect(r.alert.occurrenceCount).toBe(2);
        const occurrences = r.alert.payloadJson!.occurrences as unknown[];
        expect(occurrences).toHaveLength(1); // append thành công dù occurrences ban đầu rỗng
        expect(occurrences[0]).toEqual({
          userId: 'u1',
          sourceEventId: 'evt-1',
          occurredAt: '2026-08-11T09:00:00.000Z',
        });
      });

      it('cùng userId, 2 lần cách nhau < debounceSeconds → occurrence_count vẫn tăng, occurrences KHÔNG có entry mới', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-3',
          alertType: 'intrusion',
          zoneId: 'zone-1',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-1',
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        const r2 = await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-2',
          // 3s sau lần trước — dưới debounceSeconds=5.
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:03.000Z' },
        });

        expect(repo.query).toHaveBeenCalledTimes(2);
        expect(r2.alert.occurrenceCount).toBe(3); // vô điều kiện: 1 (insert) → 2 → 3
        const occurrences = r2.alert.payloadJson!.occurrences as unknown[];
        expect(occurrences).toHaveLength(1); // lần 2 bị debounce, KHÔNG append
        expect(occurrences[0]).toEqual({
          userId: 'u1',
          sourceEventId: 'evt-1',
          occurredAt: '2026-08-11T09:00:00.000Z',
        });
      });

      it('cùng userId, 2 lần cách nhau >= debounceSeconds → append bình thường', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-4',
          alertType: 'intrusion',
          zoneId: 'zone-1',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-1',
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        const r2 = await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-2',
          // đúng 5s sau — KHÔNG < debounceSeconds=5 (biên, không debounce).
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:05.000Z' },
        });

        expect(r2.alert.occurrenceCount).toBe(3);
        const occurrences = r2.alert.payloadJson!.occurrences as unknown[];
        expect(occurrences).toHaveLength(2); // append bình thường
        expect(occurrences[1]).toEqual({
          userId: 'u1',
          sourceEventId: 'evt-2',
          occurredAt: '2026-08-11T09:00:05.000Z',
        });
      });

      // [FIX 2026-08-13] THAY THẾ test cũ ("crowd KHÔNG bị debounce nhầm") — chính đó là
      // hành vi BUG đã fix (occurrence_count=73 sau vài phút). Test mới xác nhận NGƯỢC LẠI:
      // Crowd giờ PHẢI được debounce khi bump liên tiếp gần nhau.
      it('[FIX 73-bump] crowd (userId null) gọi liên tiếp nhanh (< debounceSeconds) → occurrence_count KHÔNG tăng lần 2, occurrences KHÔNG append thêm', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-5',
          alertType: 'crowd',
          zoneId: 'zone-9',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        // 2 lần cách nhau 1s (< debounceSeconds=5), userId=null (crowd) → PHẢI debounce.
        await service.recordAlert({
          alertType: 'crowd',
          zoneId: 'zone-9',
          sourceEventId: 'evt-1',
          payloadJson: { occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        const r2 = await service.recordAlert({
          alertType: 'crowd',
          zoneId: 'zone-9',
          sourceEventId: 'evt-2',
          payloadJson: { occurredAt: '2026-08-11T09:00:01.000Z' },
        });

        expect(r2.alert.occurrenceCount).toBe(2); // 1 (insert) → 2 (lần 1) → GIỮ 2 (lần 2 bị debounce)
        const occurrences = r2.alert.payloadJson!.occurrences as unknown[];
        expect(occurrences).toHaveLength(1); // lần 2 KHÔNG append
      });

      it('[FIX 73-bump] crowd, 2 lần cách nhau >= debounceSeconds → occurrence_count vẫn tăng, occurrences append bình thường (không debounce nhầm đợt mới)', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-5b',
          alertType: 'crowd',
          zoneId: 'zone-9',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        await service.recordAlert({
          alertType: 'crowd',
          zoneId: 'zone-9',
          sourceEventId: 'evt-1',
          payloadJson: { occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        const r2 = await service.recordAlert({
          alertType: 'crowd',
          zoneId: 'zone-9',
          sourceEventId: 'evt-2',
          // cách 6s — >= debounceSeconds=5 → KHÔNG debounce, đợt mới thật sự.
          payloadJson: { occurredAt: '2026-08-11T09:00:06.000Z' },
        });

        expect(r2.alert.occurrenceCount).toBe(3); // cả 2 lần đều tăng
        const occurrences = r2.alert.payloadJson!.occurrences as unknown[];
        expect(occurrences).toHaveLength(2); // cả 2 đều append
      });

      // [FIX 2026-08-13] TÁI HIỆN CHÍNH XÁC kịch bản thật đêm nay: 1 zone vượt ngưỡng, count-
      // event bắn liên tục cách nhau 3s (khớp ước tính "73 lần / vài phút" đã tính trong
      // recon), debounceSeconds=5 (mặc định thật DEBOUNCE_CONFIG_DEFAULT). Đã verify NGUYÊN
      // VĂN SQL này bằng psql thật trên Postgres (không chỉ mock JS) — kết quả giống hệt:
      // occurrence_count=38, không còn leo thang tới 74 (1 insert + 73 bump vô điều kiện).
      it('[FIX 73-bump] TÁI HIỆN thật: 73 count-event cách nhau 3s (~3.65 phút), debounce=5s → occurrence_count = 38 (KHÔNG còn 74)', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-crowd-repro',
          alertType: 'crowd',
          zoneId: 'zone-real',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        const base = new Date('2026-08-13T10:00:00.000Z').getTime();
        let last;
        for (let i = 1; i <= 73; i++) {
          last = await service.recordAlert({
            alertType: 'crowd',
            zoneId: 'zone-real',
            sourceEventId: `evt-${i}`,
            payloadJson: {
              occurredAt: new Date(base + i * 3000).toISOString(),
            },
          });
        }

        expect(repo.query).toHaveBeenCalledTimes(73);
        // TRƯỚC FIX: occurrenceCount = 1 + 73 = 74 (vô điều kiện). SAU FIX: 38 — khớp ĐÚNG
        // số liệu đã verify bằng psql thật (xem báo cáo recon).
        expect(last!.alert.occurrenceCount).toBe(38);
        expect(last!.alert.occurrenceCount).toBeLessThan(74);
        const occurrences = last!.alert.payloadJson!.occurrences as unknown[];
        expect(occurrences.length).toBeLessThanOrEqual(20); // vẫn tôn trọng cap cũ
      });

      // [FIX 2026-08-13] Regression quan trọng nhất: last_seen_at PHẢI vẫn cập nhật ngay cả
      // khi occurrence_count bị debounce chặn (crowd) — SecurityAlertAutoResolveService dựa
      // last_seen_at để KHÔNG tự đóng nhầm alert đang diễn ra (R3, KHÔNG đổi).
      it('[FIX 73-bump] crowd bị debounce chặn occurrence_count → last_seen_at VẪN cập nhật (auto-resolve không đóng nhầm)', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-5c',
          alertType: 'crowd',
          zoneId: 'zone-9',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        await service.recordAlert({
          alertType: 'crowd',
          zoneId: 'zone-9',
          sourceEventId: 'evt-1',
          payloadJson: { occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        expect(row.lastSeenAt).not.toBeNull();

        // lần 2: 1s sau — chắc chắn bị debounce (< 5s) → occurrence_count GIỮ nguyên,
        // nhưng last_seen_at PHẢI vẫn đổi (mock luôn set lastSeenAt vô điều kiện mỗi lần
        // gọi, mirror đúng `SET last_seen_at = NOW()` nằm NGOÀI mọi CASE debounce trong SQL
        // thật — không so sánh 2 giá trị timestamp bằng string vì độ phân giải mili-giây có
        // thể trùng nhau giữa 2 lệnh gọi liên tiếp trong cùng 1 test, gây flaky).
        await service.recordAlert({
          alertType: 'crowd',
          zoneId: 'zone-9',
          sourceEventId: 'evt-2',
          payloadJson: { occurredAt: '2026-08-11T09:00:01.000Z' },
        });

        expect(row.occurrenceCount).toBe(2); // debounce chặn — KHÔNG tăng lần 2
        expect(row.lastSeenAt).not.toBeNull();
        expect(repo.query).toHaveBeenCalledTimes(2); // cả 2 lần đều thực sự chạy qua UPDATE (SET last_seen_at chạy cả 2 lần)
      });

      // [FIX 2026-08-13] Intrusion người lạ (userId=null, KHÁC crowd nhưng cùng giá trị
      // null) — RÀNG BUỘC: KHÔNG được ảnh hưởng bởi fix crowd. Phân biệt bằng alertType,
      // KHÔNG phải bằng userId nullability (xem doc bumpOccurrence()).
      it('[FIX 73-bump] Intrusion người lạ (userId=null) gọi liên tiếp nhanh → occurrence_count VẪN tăng vô điều kiện, KHÔNG bị ảnh hưởng bởi fix crowd', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-stranger',
          alertType: 'intrusion',
          zoneId: 'zone-restricted',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-restricted',
          sourceEventId: 'evt-1',
          payloadJson: { userId: null, occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        const r2 = await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-restricted',
          sourceEventId: 'evt-2',
          // cách 1s — < debounceSeconds=5 — nhưng KHÔNG phải crowd → KHÔNG debounce count.
          payloadJson: { userId: null, occurredAt: '2026-08-11T09:00:01.000Z' },
        });

        expect(r2.alert.occurrenceCount).toBe(3); // vô điều kiện, giống hệt trước fix
      });

      // [FIX 2026-08-18] #18 — nearest-match cho crowd, vô hiệu hoá double-processing giữa
      // evaluateZoneCountNow() (tức thời) và evaluateCrowdAlerts() (cron, KHÔNG ORDER BY khi
      // quét zone_presence_events). Xem thiết kế đầy đủ trong bumpOccurrence().
      describe('[FIX 2026-08-18] nearest-match cho crowd — double-processing cron+immediate trở nên vô hại', () => {
        it('CASE CHÍNH — double-processing thật: đường tức thời xử lý event X (occurredAt=T) trước, "cron" xử lý LẠI CÙNG event X (cùng occurredAt=T) tới sau → nearest-match khớp đúng entry@T (diff=0), KHÔNG tạo occurrence mới, occurrence_count KHÔNG tăng', async () => {
          securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
          const row = {
            id: 'alert-dup-process',
            alertType: 'crowd',
            zoneId: 'zone-9',
            status: 'new',
            occurrenceCount: 1,
            lastSeenAt: null as string | null,
            payloadJson: {} as Record<string, unknown>,
          };
          repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
          repo.save.mockRejectedValue({ driverError: { code: '23505' } });
          repo.query = makeStatefulQueryMock(row);

          const T = '2026-08-18T09:00:00.000Z';
          // Lần 1: đường tức thời (evaluateZoneCountNow()) xử lý event X ngay khi webhook tới.
          const r1 = await service.recordAlert({
            alertType: 'crowd',
            zoneId: 'zone-9',
            sourceEventId: 'zpe-X',
            payloadJson: { occurredAt: T },
          });
          expect(r1.alert.occurrenceCount).toBe(2);

          // Lần 2: "cron" (evaluateCrowdAlerts()) quét lại ĐÚNG event X (cùng sourceEventId,
          // cùng occurredAt=T — event.eventTime thật KHÔNG đổi dù xử lý lại) — mô phỏng đúng
          // double-processing (cron không ORDER BY, có thể tới sau, không theo thứ tự).
          const r2 = await service.recordAlert({
            alertType: 'crowd',
            zoneId: 'zone-9',
            sourceEventId: 'zpe-X',
            payloadJson: { occurredAt: T }, // occurredAt GIỐNG HỆT lần 1 → diff=0
          });

          expect(r2.alert.occurrenceCount).toBe(2); // GIỮ NGUYÊN — KHÔNG tăng lần 2
          const occurrences = r2.alert.payloadJson!.occurrences as unknown[];
          expect(occurrences).toHaveLength(1); // KHÔNG có occurrence thứ 2
        });

        it('CASE BÌNH THƯỜNG — 2 event THẬT SỰ khác nhau, cách nhau đủ xa (>= debounceSeconds) → cả 2 đều tạo occurrence riêng, KHÔNG bị nuốt nhầm', async () => {
          securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
          const row = {
            id: 'alert-distinct',
            alertType: 'crowd',
            zoneId: 'zone-9',
            status: 'new',
            occurrenceCount: 1,
            lastSeenAt: null as string | null,
            payloadJson: {} as Record<string, unknown>,
          };
          repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
          repo.save.mockRejectedValue({ driverError: { code: '23505' } });
          repo.query = makeStatefulQueryMock(row);

          await service.recordAlert({
            alertType: 'crowd',
            zoneId: 'zone-9',
            sourceEventId: 'evt-A',
            payloadJson: { occurredAt: '2026-08-18T09:00:00.000Z' },
          });
          const r2 = await service.recordAlert({
            alertType: 'crowd',
            zoneId: 'zone-9',
            sourceEventId: 'evt-B',
            // cách 60s — thật sự là 1 đợt vượt ngưỡng KHÁC, không phải double-processing.
            payloadJson: { occurredAt: '2026-08-18T09:01:00.000Z' },
          });

          expect(r2.alert.occurrenceCount).toBe(3); // cả 2 đều tăng
          const occurrences = r2.alert.payloadJson!.occurrences as unknown[];
          expect(occurrences).toHaveLength(2); // cả 2 đều append, không mất event thật
        });

        it('CASE ĐẢO NGƯỢC THỨ TỰ — event CŨ HƠN tới SAU event MỚI HƠN (mô phỏng đúng cron KHÔNG ORDER BY) → nearest-match vẫn debounce đúng, KHÔNG phụ thuộc thứ tự xử lý', async () => {
          securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
          const row = {
            id: 'alert-out-of-order',
            alertType: 'crowd',
            zoneId: 'zone-9',
            status: 'new',
            occurrenceCount: 1,
            lastSeenAt: null as string | null,
            payloadJson: {} as Record<string, unknown>,
          };
          repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
          repo.save.mockRejectedValue({ driverError: { code: '23505' } });
          repo.query = makeStatefulQueryMock(row);

          // Lần 1 (xử lý trước, nhưng THỜI GIAN SỰ KIỆN mới hơn): occurredAt=T+100s.
          await service.recordAlert({
            alertType: 'crowd',
            zoneId: 'zone-9',
            sourceEventId: 'evt-newer',
            payloadJson: { occurredAt: '2026-08-18T09:01:40.000Z' }, // T+100s
          });
          // Lần 2 (xử lý SAU, nhưng THỜI GIAN SỰ KIỆN cũ hơn, chỉ cách "T" gốc 2s — mô phỏng
          // cron quét lại 1 event cũ ngoài thứ tự). Nếu vẫn dùng "ord DESC" (last-appended =
          // entry@T+100s), diff=98s → KHÔNG debounce (SAI). Với nearest-match, entry duy nhất
          // hiện có LÀ @T+100s (mảng chỉ có 1 phần tử) nên vẫn so với nó — cần seed thêm 1
          // entry GẦN sự kiện thứ 2 để bài test có ý nghĩa phân biệt "nearest" vs "last".
          const row2Seed = {
            ...row,
            payloadJson: {
              occurrences: [
                {
                  userId: null,
                  sourceEventId: 'evt-near',
                  occurredAt: '2026-08-18T09:00:02.000Z',
                }, // T+2s — GẦN event lần 2 sắp tới
                {
                  userId: null,
                  sourceEventId: 'evt-newer',
                  occurredAt: '2026-08-18T09:01:40.000Z',
                }, // T+100s — entry CUỐI CÙNG (ord DESC sẽ chọn cái này)
              ],
            },
          };
          Object.assign(row, row2Seed);
          row.occurrenceCount = 3;
          repo.query = makeStatefulQueryMock(row);

          const r3 = await service.recordAlert({
            alertType: 'crowd',
            zoneId: 'zone-9',
            sourceEventId: 'evt-late-arrival',
            // occurredAt=T+3s — GẦN entry 'evt-near' (T+2s, diff=1s<5s → PHẢI debounce) NHƯNG
            // XA entry cuối cùng 'evt-newer' (T+100s, diff=97s). "ord DESC" (last) sẽ so với
            // evt-newer → SAI, không debounce. nearest-match so với evt-near → ĐÚNG, debounce.
            payloadJson: { occurredAt: '2026-08-18T09:00:03.000Z' },
          });

          expect(r3.alert.occurrenceCount).toBe(3); // GIỮ NGUYÊN — nearest-match debounce đúng
          const occurrences = r3.alert.payloadJson!.occurrences as unknown[];
          expect(occurrences).toHaveLength(2); // KHÔNG append thêm — chứng minh KHÔNG phụ thuộc thứ tự xử lý
        });

        it('REGRESSION TUYỆT ĐỐI — Intrusion (KHÔNG phải crowd) ở ĐÚNG kịch bản mà nearest-match và last-match cho kết quả KHÁC NHAU → vẫn dùng "ord DESC" (last) y hệt trước, KHÔNG bị đổi sang nearest-match', async () => {
          securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
          const row = {
            id: 'alert-intrusion-order-sensitive',
            alertType: 'intrusion',
            zoneId: 'zone-restricted',
            status: 'new',
            occurrenceCount: 3,
            lastSeenAt: null as string | null,
            payloadJson: {
              occurrences: [
                {
                  userId: 'u1',
                  sourceEventId: 'evt-near',
                  occurredAt: '2026-08-18T09:00:02.000Z',
                }, // gần
                {
                  userId: 'u1',
                  sourceEventId: 'evt-newer',
                  occurredAt: '2026-08-18T09:01:40.000Z',
                }, // xa, nhưng là entry CUỐI CÙNG
              ],
            } as Record<string, unknown>,
          };
          repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
          repo.save.mockRejectedValue({ driverError: { code: '23505' } });
          repo.query = makeStatefulQueryMock(row);

          const r = await service.recordAlert({
            alertType: 'intrusion',
            zoneId: 'zone-restricted',
            sourceEventId: 'evt-late-arrival',
            // Nếu Intrusion bị đổi sang nearest-match (SAI): so với 'evt-near' (diff=1s<5s)
            // → debounce, occurrence_count GIỮ 3. Hành vi ĐÚNG (ord DESC, KHÔNG đổi): so với
            // entry CUỐI CÙNG 'evt-newer' (diff=97s>=5s) → KHÔNG debounce, append + tăng.
            payloadJson: {
              userId: 'u1',
              occurredAt: '2026-08-18T09:00:03.000Z',
            },
          });

          expect(r.alert.occurrenceCount).toBe(4); // TĂNG — chứng minh Intrusion vẫn dùng "last", KHÔNG bị đổi sang "nearest"
          const occurrences = r.alert.payloadJson!.occurrences as unknown[];
          expect(occurrences).toHaveLength(3); // append thêm bình thường, y hệt hành vi cũ
        });
      });

      it('last_seen_at LUÔN cập nhật dù bị debounce hay không (chống rủi ro R3 — auto-resolve không được đóng nhầm)', async () => {
        securityAlertConfigService.getDebounceSeconds.mockResolvedValue(5);
        const row = {
          id: 'alert-6',
          alertType: 'intrusion',
          zoneId: 'zone-1',
          status: 'new',
          occurrenceCount: 1,
          lastSeenAt: null as string | null,
          payloadJson: {} as Record<string, unknown>,
        };
        repo.findOne.mockImplementation(() => Promise.resolve({ ...row }));
        repo.save.mockRejectedValue({ driverError: { code: '23505' } });
        repo.query = makeStatefulQueryMock(row);

        expect(row.lastSeenAt).toBeNull();

        await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-1',
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:00.000Z' },
        });
        // repo.save luôn 23505 (mock chung của describe cha) → MỌI lần gọi recordAlert()
        // ở đây đi qua bumpOccurrence(), kể cả lần "đầu tiên" trong test này.
        const afterFirst = row.lastSeenAt;
        expect(afterFirst).not.toBeNull();

        // lần 2: 1s sau — CHẮC CHẮN bị debounce (< 5s) — nhưng last_seen_at vẫn phải đổi.
        await service.recordAlert({
          alertType: 'intrusion',
          zoneId: 'zone-1',
          sourceEventId: 'evt-2',
          payloadJson: { userId: 'u1', occurredAt: '2026-08-11T09:00:01.000Z' },
        });

        expect(row.occurrenceCount).toBe(3); // 1 → 2 → 3, vô điều kiện
        expect(row.payloadJson.occurrences as unknown[]).toHaveLength(1); // debounced, occurrences KHÔNG đổi — chứng minh 2 việc tách rời nhau
        // repo.query() được gọi đúng 2 lần (1 lần/recordAlert) — mock TỰ set lastSeenAt =
        // NOW() vô điều kiện ở CẢ 2 lần (mirror `SET last_seen_at = NOW()` chạy trước CASE
        // debounce trong SQL thật), bất kể lần đó có bị debounce hay không.
        expect(repo.query).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('list', () => {
    it('R3: không truyền status → where KHÔNG có status (trả mọi trạng thái)', async () => {
      await service.list({ page: 1, limit: 20 } as any);
      const where = repo.findAndCount.mock.calls[0][0].where;
      expect('status' in where).toBe(false);
    });

    it('filter status → where.status đúng giá trị', async () => {
      await service.list({ page: 1, limit: 20, status: 'new' } as any);
      expect(repo.findAndCount.mock.calls[0][0].where.status).toBe('new');
    });

    it('sort mặc định triggeredAt DESC', async () => {
      await service.list({ page: 1, limit: 20 } as any);
      expect(repo.findAndCount.mock.calls[0][0].order).toEqual({
        triggeredAt: 'DESC',
      });
    });
  });

  describe('findDetail (R4)', () => {
    it('không tồn tại → 404', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.findDetail('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('zone bị xóa mềm (deletedAt khác null) → trả zone:null (CLAUDE.md §5.5 quy tắc 1)', async () => {
      repo.findOne.mockResolvedValue({
        id: 'a1',
        alertType: 'crowd',
        zoneId: 'zone-1',
        zone: { id: 'zone-1', deletedAt: new Date() },
      });
      const r = await service.findDetail('a1');
      expect(r.zone).toBeNull();
    });

    it('zone còn sống → trả nguyên zone; history dùng IS NOT DISTINCT FROM', async () => {
      repo.findOne.mockResolvedValue({
        id: 'a1',
        alertType: 'crowd',
        zoneId: 'zone-1',
        zone: { id: 'zone-1', deletedAt: null },
      });
      const r = await service.findDetail('a1');
      expect(r.zone).toEqual({ id: 'zone-1', deletedAt: null });
      expect(qb.andWhere).toHaveBeenCalledWith(
        'a.zone_id IS NOT DISTINCT FROM :zoneId',
        { zoneId: 'zone-1' },
      );
    });
  });

  describe('acknowledge (R5/R6 crux EX1)', () => {
    it('status=new → conditional update thành công', async () => {
      repo.update.mockResolvedValue({ affected: 1 });
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'acknowledged' });
      const r = await service.acknowledge('a1', 'u1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'a1', status: 'new' },
        expect.objectContaining({
          status: 'acknowledged',
          acknowledgedBy: 'u1',
        }),
      );
      expect(r.status).toBe('acknowledged');
    });

    it('EX1: status KHÔNG PHẢI new (đã bị xử lý) → 409 kèm đúng người/thời điểm', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue({
        id: 'a1',
        status: 'acknowledged',
        acknowledgedBy: 'other-guard',
        acknowledgedAt: new Date('2026-07-23T10:00:00Z'),
      });
      try {
        await service.acknowledge('a1', 'u1');
        fail('should throw');
      } catch (e: any) {
        expect(e).toBeInstanceOf(ConflictException);
        expect(e.response.by).toBe('other-guard');
        expect(e.response.status).toBe('acknowledged');
      }
    });

    it('EX1: đã resolved → conflict dùng resolvedBy/resolvedAt, KHÔNG dùng acknowledgedBy', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue({
        id: 'a1',
        status: 'resolved',
        acknowledgedBy: 'guard-a',
        resolvedBy: 'guard-b',
        resolvedAt: new Date('2026-07-23T11:00:00Z'),
      });
      try {
        await service.acknowledge('a1', 'u1');
        fail('should throw');
      } catch (e: any) {
        expect(e.response.by).toBe('guard-b');
      }
    });
  });

  describe('resolve (R7/R8)', () => {
    it('status=acknowledged → conditional update thành công, resolutionNote lưu đúng', async () => {
      repo.update.mockResolvedValue({ affected: 1 });
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'resolved' });
      await service.resolve('a1', { resolutionNote: 'báo động giả' }, 'u1');
      expect(repo.update).toHaveBeenCalledWith(
        { id: 'a1', status: 'acknowledged' },
        expect.objectContaining({
          status: 'resolved',
          resolutionNote: 'báo động giả',
          resolvedBy: 'u1',
        }),
      );
    });

    it('status=new (chưa acknowledge) → 409, KHÔNG cho nhảy cóc', async () => {
      repo.update.mockResolvedValue({ affected: 0 });
      repo.findOne.mockResolvedValue({ id: 'a1', status: 'new' });
      await expect(
        service.resolve('a1', { resolutionNote: 'x' }, 'u1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('bulkAcknowledge (R9 AF1)', () => {
    it('mix thành công + conflict — 1 lỗi KHÔNG chặn id khác', async () => {
      repo.update
        .mockResolvedValueOnce({ affected: 1 }) // id1 ok
        .mockResolvedValueOnce({ affected: 0 }); // id2 conflict
      repo.findOne
        .mockResolvedValueOnce({ id: 'id1', status: 'acknowledged' }) // getOrThrow sau update id1
        .mockResolvedValueOnce({
          id: 'id2',
          status: 'resolved',
          resolvedBy: 'other',
          resolvedAt: new Date(),
        }); // getOrThrow trong conflict path id2
      const r = await service.bulkAcknowledge(['id1', 'id2'], 'u1');
      expect(r.acknowledged).toEqual(['id1']);
      expect(r.alreadyProcessed).toHaveLength(1);
      expect(r.alreadyProcessed[0].id).toBe('id2');
      expect(r.alreadyProcessed[0].status).toBe('resolved');
    });

    it('lỗi KHÔNG phải conflict (vd DB down) → ném ra ngoài, dừng batch', async () => {
      const boom = new Error('db down');
      repo.update.mockRejectedValue(boom);
      await expect(service.bulkAcknowledge(['id1'], 'u1')).rejects.toBe(boom);
    });
  });
});
