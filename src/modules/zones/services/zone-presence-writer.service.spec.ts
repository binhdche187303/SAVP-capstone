/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { ZonePresenceWriterService } from './zone-presence-writer.service.js';

describe('ZonePresenceWriterService (ZPW-001 / UC-109)', () => {
  let service: ZonePresenceWriterService;
  let ds: any;
  let qr: any;

  beforeEach(async () => {
    qr = {
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockResolvedValue(undefined),
      release: jest.fn().mockResolvedValue(undefined),
      manager: { query: jest.fn().mockResolvedValue([{ id: 'zpe-1' }]) },
    };
    ds = {
      manager: {
        query: jest.fn().mockResolvedValue([{ zone_type: 'corridor' }]),
      },
      createQueryRunner: jest.fn(() => qr),
      // [RACE FIX 2026-08-22] writeCountEvent() giờ bọc SELECT-dedupe+INSERT trong
      // this.dataSource.transaction(...) — mirror vehicle-resolve.service.spec.ts /
      // ivss-presence-ingestion.service.spec.ts: dùng LẠI ds.manager (cùng jest.fn
      // `.query`) bên trong callback để mọi mock hiện có tiếp tục hoạt động không đổi.
      // KHÔNG ảnh hưởng writeAppearEvent() (vẫn dùng createQueryRunner()/qr riêng).
      transaction: jest.fn((cb: (m: any) => unknown) => cb(ds.manager)),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZonePresenceWriterService,
        { provide: DataSource, useValue: ds },
      ],
    }).compile();
    service = module.get(ZonePresenceWriterService);
  });

  const input = (over: any = {}) => ({
    zoneId: 'z-area',
    userId: 'u1',
    eventTime: new Date('2026-07-26T09:00:00.000Z'),
    deviceId: 'dev1',
    metadata: {
      channelId: 3,
      szUid: 'sz9',
      similarity: 92,
      sourceEventId: 'evt1',
    },
    ...over,
  });

  describe('resolvePresenceZone (QC-5)', () => {
    for (const t of ['corridor', 'lobby', 'parking']) {
      it(`zone type=${t} → valid`, async () => {
        ds.manager.query.mockResolvedValueOnce([{ zone_type: t }]);
        expect(await service.resolvePresenceZone('z')).toEqual({ valid: true });
      });
    }

    it('zone type=gate → zone_wrong_type', async () => {
      ds.manager.query.mockResolvedValueOnce([{ zone_type: 'gate' }]);
      expect(await service.resolvePresenceZone('z')).toEqual({
        valid: false,
        reason: 'zone_wrong_type',
      });
    });

    it('zone type=room → zone_wrong_type', async () => {
      ds.manager.query.mockResolvedValueOnce([{ zone_type: 'room' }]);
      expect(await service.resolvePresenceZone('z')).toEqual({
        valid: false,
        reason: 'zone_wrong_type',
      });
    });

    it('zone không tồn tại / đã xóa mềm → zone_wrong_type (SELECT lọc deleted_at IS NULL)', async () => {
      ds.manager.query.mockResolvedValueOnce([]);
      expect(await service.resolvePresenceZone('z')).toEqual({
        valid: false,
        reason: 'zone_wrong_type',
      });
      expect(String(ds.manager.query.mock.calls[0][0])).toContain(
        'deleted_at IS NULL',
      );
    });
  });

  describe('writeAppearEvent', () => {
    it('zone khu vực hợp lệ → INSERT appear + trả presenceId', async () => {
      const r = await service.writeAppearEvent(input());
      expect(r).toEqual({ presenceId: 'zpe-1' });
      const ins = qr.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('INSERT INTO zone_presence_events'),
      );
      expect(ins).toBeDefined();
      const sql = String(ins[0]);
      expect(sql).toContain("'appear'");
      // occupancy_count NULL literal + KHÔNG cột event_id (nhánh B).
      expect(sql).not.toContain('event_id');
      // event_time (param index 3) = eventTime truyền vào (KHÔNG now()).
      expect(ins[1][3]).toEqual(new Date('2026-07-26T09:00:00.000Z'));
      expect(qr.commitTransaction).toHaveBeenCalledTimes(1);
      expect(qr.release).toHaveBeenCalledTimes(1);
    });

    it('metadata (gồm sourceEventId) ghi vào metadata_json param', async () => {
      await service.writeAppearEvent(input());
      const ins = qr.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes('INSERT INTO zone_presence_events'),
      );
      // metadata_json là param cuối (index 4).
      const meta = JSON.parse(ins[1][4]);
      expect(meta).toEqual({
        channelId: 3,
        szUid: 'sz9',
        similarity: 92,
        sourceEventId: 'evt1',
      });
    });

    it('zone sai type (defense) → ném, KHÔNG INSERT', async () => {
      ds.manager.query.mockResolvedValueOnce([{ zone_type: 'gate' }]);
      await expect(service.writeAppearEvent(input())).rejects.toThrow(
        'zone_wrong_type',
      );
      expect(qr.manager.query).not.toHaveBeenCalled();
    });

    it('INSERT lỗi → rollback + release + ném lại', async () => {
      qr.manager.query.mockRejectedValueOnce(new Error('db boom'));
      await expect(service.writeAppearEvent(input())).rejects.toThrow(
        'db boom',
      );
      expect(qr.rollbackTransaction).toHaveBeenCalledTimes(1);
      expect(qr.release).toHaveBeenCalledTimes(1);
    });
  });

  // [FIX 2026-08-18] Dedupe writeCountEvent() — khóa zoneId+occupancyCount, cửa sổ 8s.
  // [RACE FIX 2026-08-22] SELECT-precheck + INSERT giờ bọc trong dataSource.transaction()
  // + pg_advisory_xact_lock — mirror ĐÚNG kỹ thuật đã dùng ở vehicle-resolve.service.ts /
  // ivss-presence-ingestion.service.ts. writeCountEvent() KHÔNG còn dùng createQueryRunner
  // (khác writeAppearEvent() ở trên — method đó GIỮ NGUYÊN, không đụng), nên test dưới đây
  // theo dõi qua `ds.manager.query` (= `manager` truyền vào callback transaction) thay vì
  // `ds.createQueryRunner`/`qr.*`.
  describe('writeCountEvent (F3, recon B5 — dedupe [FIX 2026-08-18] + race fix [2026-08-22])', () => {
    const countInput = (over: any = {}) => ({
      zoneId: 'z-area',
      occupancyCount: 5,
      eventTime: new Date('2026-07-26T09:00:00.000Z'),
      deviceId: 'dev1',
      metadata: { channelId: 3, source: 'ivss_occupancy' },
      ...over,
    });

    const insertCalls = () =>
      ds.manager.query.mock.calls.filter((c: any[]) =>
        String(c[0]).includes('INSERT INTO zone_presence_events'),
      );

    /** dedupeHit=null → SELECT dedupe trả [] (không trùng). dedupeHit='id' → trả row đó. */
    const wireDs = (dedupeHit: string | null = null) => {
      ds.manager.query.mockImplementation((sql: string) => {
        if (String(sql).includes('pg_advisory_xact_lock'))
          return Promise.resolve([{}]);
        if (String(sql).includes('FROM zones WHERE id'))
          return Promise.resolve([{ id: 'z-area' }]);
        if (String(sql).includes("event_type = 'count'"))
          return Promise.resolve(dedupeHit ? [{ id: dedupeHit }] : []);
        if (String(sql).includes('INSERT INTO zone_presence_events'))
          return Promise.resolve([{ id: 'zpe-1' }]);
        return Promise.resolve([]);
      });
    };

    it('zone hợp lệ, KHÔNG trùng → INSERT count + trả presenceId mới', async () => {
      wireDs(null);
      const r = await service.writeCountEvent(countInput());
      expect(r).toEqual({ presenceId: 'zpe-1' });
      expect(insertCalls().length).toBe(1);
      expect(String(insertCalls()[0][0])).toContain("'count'");
      expect(ds.transaction).toHaveBeenCalledTimes(1);
    });

    it('zone không tồn tại → ném, KHÔNG chạm dedupe-check, KHÔNG mở transaction', async () => {
      ds.manager.query.mockResolvedValueOnce([]); // SELECT zones trả rỗng
      await expect(service.writeCountEvent(countInput())).rejects.toThrow(
        'không tồn tại hoặc đã xóa',
      );
      expect(ds.transaction).not.toHaveBeenCalled();
    });

    it('2 event CÙNG zoneId+occupancyCount trong cửa sổ 8s → CHỈ 1 row được ghi, lần 2 trả presenceId của row đã có', async () => {
      wireDs(null);
      const r1 = await service.writeCountEvent(countInput());
      expect(r1).toEqual({ presenceId: 'zpe-1' });

      wireDs('zpe-1'); // lần 2: giả lập DB đã có row lần 1 vừa ghi → dedupe-check thấy trùng
      const r2 = await service.writeCountEvent(countInput());
      expect(r2).toEqual({ presenceId: 'zpe-1' });

      // Vẫn mở transaction cả 2 lần (bắt buộc để lock+check), nhưng CHỈ INSERT 1 lần.
      expect(ds.transaction).toHaveBeenCalledTimes(2);
      expect(insertCalls().length).toBe(1);
    });

    it('2 event CÙNG zoneId nhưng occupancyCount KHÁC nhau (số người đổi thật) → CẢ 2 đều được ghi, KHÔNG bị dedupe nhầm', async () => {
      wireDs(null); // occupancyCount khác nhau → SELECT dedupe (occupancy_count = $2) sẽ không khớp row cũ trong DB thật; ở mock, mô phỏng bằng cách LUÔN trả [] cho cả 2 lần gọi
      const r1 = await service.writeCountEvent(
        countInput({ occupancyCount: 5 }),
      );
      const r2 = await service.writeCountEvent(
        countInput({ occupancyCount: 8 }),
      );
      expect(r1.presenceId).toBe('zpe-1');
      expect(r2.presenceId).toBe('zpe-1'); // mock INSERT luôn trả cùng 1 id giả
      expect(insertCalls().length).toBe(2);
    });

    it('2 event cách nhau NGOÀI cửa sổ 8s (DB không còn thấy trùng) → CẢ 2 đều được ghi', async () => {
      wireDs(null); // dedupe-check luôn trả [] (mô phỏng đã ngoài cửa sổ thời gian)
      await service.writeCountEvent(countInput());
      await service.writeCountEvent(countInput());
      expect(insertCalls().length).toBe(2);
    });

    it('query dedupe đúng tham số: zoneId, occupancyCount, mốc cửa sổ = eventTime - 8000ms', async () => {
      wireDs(null);
      await service.writeCountEvent(countInput());
      const dedupeCall = ds.manager.query.mock.calls.find((c: any[]) =>
        String(c[0]).includes("event_type = 'count'"),
      );
      expect(dedupeCall).toBeDefined();
      expect(dedupeCall[1]).toEqual([
        'z-area',
        5,
        new Date(new Date('2026-07-26T09:00:00.000Z').getTime() - 8000),
      ]);
    });

    it('deduped (trả presenceId của row trùng) — presenceId hợp lệ (KHÔNG null/undefined), giữ đủ điều kiện để caller gọi evaluateZoneCountNow() bình thường', async () => {
      wireDs('existing-row-id');
      const r = await service.writeCountEvent(countInput());
      expect(r.presenceId).toBe('existing-row-id');
      expect(r.presenceId).toBeTruthy();
    });

    it('regression: metadata (channelId) vẫn ghi đúng vào metadata_json khi KHÔNG trùng — heatmap không mất dữ liệu nguồn', async () => {
      wireDs(null);
      await service.writeCountEvent(countInput());
      const ins = insertCalls()[0];
      const meta = JSON.parse(ins[1][4]);
      expect(meta).toEqual({ channelId: 3, source: 'ivss_occupancy' });
    });

    it('INSERT lỗi → ném lại (hành vi cũ giữ nguyên khi không trùng)', async () => {
      ds.manager.query.mockImplementation((sql: string) => {
        if (String(sql).includes('pg_advisory_xact_lock'))
          return Promise.resolve([{}]);
        if (String(sql).includes('FROM zones WHERE id'))
          return Promise.resolve([{ id: 'z-area' }]);
        if (String(sql).includes("event_type = 'count'"))
          return Promise.resolve([]);
        if (String(sql).includes('INSERT INTO zone_presence_events'))
          return Promise.reject(new Error('db boom'));
        return Promise.resolve([]);
      });
      await expect(service.writeCountEvent(countInput())).rejects.toThrow(
        'db boom',
      );
    });

    // ── [RACE FIX 2026-08-22] pg_advisory_xact_lock chống 2 request đồng thời ──
    // Bằng chứng thật production: 20 cặp event gần-trùng trong cửa sổ 8s (zone+count),
    // đợt test 2026-08-15 — SELECT-precheck rời rạc không chặn được 2 request gần như
    // đồng thời. Mirror ĐÚNG kỹ thuật test đã dùng ở vehicle-resolve.service.spec.ts /
    // ivss-presence-ingestion.service.spec.ts (mutex-chain mô phỏng pg_advisory_xact_lock).
    describe('[RACE FIX 2026-08-22] pg_advisory_xact_lock chống 2 request đồng thời cùng zone+count', () => {
      /**
       * Mutex thủ công mô phỏng pg_advisory_xact_lock: request 2 PHẢI đợi transaction
       * của request 1 chạy XONG HẲN (kể cả INSERT) rồi mới được bắt đầu callback của nó.
       */
      const wireSerializedTransaction = () => {
        let lockChain: Promise<unknown> = Promise.resolve();
        ds.transaction = jest.fn((cb: (m: any) => Promise<unknown>) => {
          const run = lockChain.then(() => cb(ds.manager));
          lockChain = run.catch(() => undefined);
          return run;
        });
      };

      it('#1 — Promise.all 2 event giống hệt nhau (cùng zone+count) → CHỈ 1 INSERT, lần 2 log dedupe-skip', async () => {
        wireSerializedTransaction();
        let dedupeCalls = 0;
        ds.manager.query.mockImplementation((sql: string) => {
          if (String(sql).includes('pg_advisory_xact_lock'))
            return Promise.resolve([{}]);
          if (String(sql).includes('FROM zones WHERE id'))
            return Promise.resolve([{ id: 'z-area' }]);
          if (String(sql).includes("event_type = 'count'")) {
            dedupeCalls++;
            return Promise.resolve(dedupeCalls === 1 ? [] : [{ id: 'zpe-1' }]);
          }
          if (String(sql).includes('INSERT INTO zone_presence_events'))
            return Promise.resolve([{ id: 'zpe-1' }]);
          return Promise.resolve([]);
        });
        const debugSpy = jest.spyOn((service as any).logger, 'debug');

        await Promise.all([
          service.writeCountEvent(countInput()),
          service.writeCountEvent(countInput()),
        ]);

        expect(insertCalls().length).toBe(1);
        const debugged = debugSpy.mock.calls.some((c) =>
          String(c[0]).includes('dedupe: bỏ qua'),
        );
        expect(debugged).toBe(true);
      });

      it('#2 — transaction() gọi ĐÚNG 1 lần/sự kiện, pg_advisory_xact_lock là statement ĐẦU TIÊN trong transaction', async () => {
        wireDs(null);
        await service.writeCountEvent(countInput());

        expect(ds.transaction).toHaveBeenCalledTimes(1);
        const txSqls = ds.manager.query.mock.calls
          .map((c: any[]) => String(c[0]))
          .filter(
            (sql: string) =>
              sql.includes('pg_advisory_xact_lock') ||
              sql.includes("event_type = 'count'") ||
              sql.includes('INSERT INTO zone_presence_events'),
          );
        expect(txSqls[0]).toContain('pg_advisory_xact_lock');
        expect(txSqls[1]).toContain("event_type = 'count'");
        expect(txSqls[2]).toContain('INSERT INTO zone_presence_events');
      });
    });
  });
});
