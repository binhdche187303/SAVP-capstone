# KPI-001 — Tổng hợp KPI theo giờ (Zone & Phương tiện) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hai API `GET /campus-dashboard/zones/traffic` và `GET /gate-access/admin/vehicle-traffic-stats` đọc từ bảng tổng hợp theo giờ (cộng phần raw ở mép), kết quả bằng đúng query raw, chi phí không tăng theo số event.

**Architecture:** Module mới `kpi-rollup` gồm: hàm thuần (chia cửa sổ đọc, watermark, cửa sổ rollup), 2 rollup service (DELETE + INSERT…SELECT theo cửa sổ giờ, trong 1 transaction có advisory lock), job service (incremental mỗi giờ / reconcile 01:00 / backfill), và `KpiReadWindowService` cho phía đọc. Hai service đọc hiện có được viết lại thành `UNION ALL` giữa aggregate và raw rồi gộp; DTO giữ nguyên.

**Tech Stack:** NestJS 11, TypeORM (raw SQL qua `DataSource`/`QueryRunner`), PostgreSQL 16, `@nestjs/schedule`, Jest + ts-jest, `tsx` cho script.

**Spec:** [spec.md](./spec.md) (đã duyệt 2026-10-05) — executor đọc spec trước.

## Global Constraints

- Migration **ADD-ONLY**: chỉ `CREATE TABLE`/`CREATE INDEX`; `down()` chỉ drop đúng thứ `up()` tạo. Tên file: `src/database/migrations/20261007000001-CreateKpiRollupTables.ts`.
- **KHÔNG** đổi route, permission, DTO request/response của 2 API.
- Mọi SQL **parameterized**; tên cột/biểu thức chỉ lấy từ hằng trong code (SEC-03 hiện có).
- Raw vehicle query: `event_type = 'ivss_vehicle_event'` luôn là điều kiện WHERE **đầu tiên** (DATA-02 hiện có).
- Bucket vehicle theo `Asia/Ho_Chi_Minh`: `to_char(<ts> AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')` / `'YYYY-MM-DD HH24:00'`.
- Env mới (Joi): `SCHEDULER_KPI_ROLLUP_ENABLED` boolean default `false`; `KPI_ROLLUP_READ_ENABLED` boolean default `true`.
- Cron: `kpi-rollup-hourly` = `'0 5 * * * *'`; `kpi-rollup-reconcile` = `'0 0 1 * * *'` với `timeZone: 'Asia/Ho_Chi_Minh'`.
- Hằng: overlap incremental **2 giờ**, reconcile lùi **72 giờ**, chunk backfill **24 giờ**, lock key `hashtext('kpi_rollup')`.
- Import nội bộ dùng hậu tố `.js` (theo code hiện có). Comment tiếng Việt, mật độ như file xung quanh.
- **KHÔNG tự `git commit`** (quy tắc dự án của user). Mỗi task kết thúc bằng checkpoint báo trạng thái; commit chỉ khi user yêu cầu.
- Test DB thật chỉ chạy khi `RUN_DB_TESTS=1` (theo tiền lệ `test/academic`), lệnh: `RUN_DB_TESTS=1 npx jest --config test/jest-e2e.json <path> --runInBand`.

## Review Focus

1. **Watermark chưa có / bảng chưa migrate / đọc watermark lỗi** → API phải trả kết quả raw đúng, không 500. Test: Task 4 Step 1 (`repo throws → toàn raw`).
2. **Event nằm đúng giờ tròn và đúng `to`** (biên `<` vs `<=`) → đếm đúng 1 lần. Test: fixture Task 3 có event ở `05:00` và `09:00`; Task 9 so khớp case `to = 09:00`.
3. **Giờ toàn `occupancy_count = NULL` và đỉnh bằng nhau ở 2 phần agg/raw** → `avg = 0`, `peak_at` = thời điểm muộn hơn. Test: Task 5 Step 1 (merge) + Task 3 Step 6 (zone C).
4. **Một biển số xuất hiện cả ở phần agg lẫn phần raw** → `unique_vehicles` đếm 1 lần. Test: fixture biển `29A-999` + Task 9 case có mép raw.
5. **Job ngừng chạy nhiều ngày (downtime)** → cửa sổ incremental/reconcile vẫn liền mạch với watermark, không ném lỗi "gap". Test: Task 1 Step 7 (downtime cases).

---

## File Structure

| File | Trách nhiệm |
| :--- | :--- |
| `src/modules/kpi-rollup/kpi-rollup.constants.ts` | `RollupName`, hằng số |
| `src/modules/kpi-rollup/utils/kpi-window.types.ts` | `HourWindow`, `Watermark`, `TimeRange`, `ReadWindow` |
| `src/modules/kpi-rollup/utils/hour.util.ts` | `floorHour`, `ceilHour`, `addHours`, `maxDate`, `minDate` |
| `src/modules/kpi-rollup/utils/split-read-window.util.ts` | `splitReadWindow` (phía đọc) |
| `src/modules/kpi-rollup/utils/watermark.util.ts` | `extendWatermark`, `KpiWatermarkGapError` |
| `src/modules/kpi-rollup/utils/rollup-window.util.ts` | `incrementalWindow`, `reconcileWindow`, `planBackfillChunks` |
| `src/modules/kpi-rollup/utils/sql-params.util.ts` | `SqlParams`, `rangeClause` |
| `src/modules/kpi-rollup/utils/rollup-lock.util.ts` | `acquireRollupLock` |
| `src/modules/kpi-rollup/entities/*.entity.ts` (4) | Mapping bảng |
| `src/modules/kpi-rollup/repositories/kpi-watermark.repository.ts` | đọc/ghi watermark |
| `src/modules/kpi-rollup/services/zone-hourly-rollup.service.ts` | rollup zone |
| `src/modules/kpi-rollup/services/vehicle-hourly-rollup.service.ts` | rollup xe + biển |
| `src/modules/kpi-rollup/services/kpi-rollup-job.service.ts` | điều phối transaction/lock/watermark |
| `src/modules/kpi-rollup/services/kpi-read-window.service.ts` | phía đọc: watermark + cờ → `ReadWindow` |
| `src/modules/kpi-rollup/kpi-rollup.module.ts` | wiring |
| `src/database/migrations/20261007000001-CreateKpiRollupTables.ts` | schema |
| `src/modules/campus-dashboard/utils/merge-zone-heatmap.util.ts` | gộp heatmap theo zone |
| Sửa `src/modules/campus-dashboard/services/zone-traffic-heatmap.service.ts` | đọc lai |
| Sửa `src/modules/gate-access/services/vehicle-traffic-stats.service.ts` | đọc lai + TZ VN |
| Sửa `src/modules/scheduler/scheduler.service.ts`, `scheduler.module.ts` | 2 cron |
| Sửa `src/config/env.validation.ts`, `.env.example`, `src/app.module.ts`, `src/database/entities/index.ts`, `campus-dashboard.module.ts`, `gate-access.module.ts` | wiring |
| `scripts/kpi-backfill.ts` | CLI backfill |
| `test/kpi-rollup/fixtures.ts`, `kpi-rollup-db.e2e-spec.ts`, `kpi-rollup-equivalence.e2e-spec.ts` | test DB thật |

---

### Task 1: Hàm thuần — giờ, chia cửa sổ đọc, watermark, cửa sổ rollup, SQL params

**Files:**
- Create: `src/modules/kpi-rollup/kpi-rollup.constants.ts`
- Create: `src/modules/kpi-rollup/utils/kpi-window.types.ts`
- Create: `src/modules/kpi-rollup/utils/hour.util.ts`
- Create: `src/modules/kpi-rollup/utils/split-read-window.util.ts`
- Create: `src/modules/kpi-rollup/utils/watermark.util.ts`
- Create: `src/modules/kpi-rollup/utils/rollup-window.util.ts`
- Create: `src/modules/kpi-rollup/utils/sql-params.util.ts`
- Test: `src/modules/kpi-rollup/utils/kpi-utils.spec.ts`

**Interfaces:**
- Consumes: —
- Produces:
  - `type RollupName = 'zone_hourly' | 'vehicle_hourly'`; `ROLLUP_NAMES`; `INCREMENTAL_OVERLAP_HOURS = 2`; `RECONCILE_LOOKBACK_HOURS = 72`; `BACKFILL_CHUNK_HOURS = 24`; `BUSINESS_TZ = 'Asia/Ho_Chi_Minh'`
  - `interface HourWindow { from: Date; to: Date }` (nửa mở `[from, to)`)
  - `interface Watermark { coveredFrom: Date; coveredUntil: Date }`
  - `interface TimeRange { from: Date; to: Date; toInclusive: boolean }`
  - `interface ReadWindow { agg: HourWindow | null; raw: TimeRange[] }`
  - `floorHour(d: Date): Date`, `ceilHour(d: Date): Date`, `addHours(d: Date, h: number): Date`, `maxDate(a: Date, b: Date): Date`, `minDate(a: Date, b: Date): Date`
  - `splitReadWindow(from: Date, to: Date, wm: Watermark | null, enabled: boolean): ReadWindow`
  - `extendWatermark(current: Watermark | null, from: Date, until: Date): Watermark`; `class KpiWatermarkGapError extends Error`
  - `incrementalWindow(wm: Watermark | null, now: Date): HourWindow | null`
  - `reconcileWindow(wm: Watermark | null, now: Date): HourWindow | null`
  - `planBackfillChunks(from: Date, to: Date): HourWindow[]` (giảm dần theo thời gian)
  - `class SqlParams { values: unknown[]; add(v: unknown): string }`; `rangeClause(column: string, ranges: TimeRange[], p: SqlParams): string`

- [ ] **Step 1: Viết test (sẽ fail) — `src/modules/kpi-rollup/utils/kpi-utils.spec.ts`**

```ts
import {
  addHours,
  ceilHour,
  floorHour,
} from './hour.util.js';
import { splitReadWindow } from './split-read-window.util.js';
import { extendWatermark, KpiWatermarkGapError } from './watermark.util.js';
import {
  incrementalWindow,
  planBackfillChunks,
  reconcileWindow,
} from './rollup-window.util.js';
import { rangeClause, SqlParams } from './sql-params.util.js';
import type { ReadWindow, Watermark } from './kpi-window.types.js';

const T = (iso: string): Date => new Date(iso);

describe('KPI-001 hour.util', () => {
  it('floorHour/ceilHour: giờ tròn giữ nguyên, lẻ phút làm tròn xuống/lên', () => {
    expect(floorHour(T('2026-10-05T08:00:00Z'))).toEqual(T('2026-10-05T08:00:00Z'));
    expect(ceilHour(T('2026-10-05T08:00:00Z'))).toEqual(T('2026-10-05T08:00:00Z'));
    expect(floorHour(T('2026-10-05T08:59:59.999Z'))).toEqual(T('2026-10-05T08:00:00Z'));
    expect(ceilHour(T('2026-10-05T08:00:00.001Z'))).toEqual(T('2026-10-05T09:00:00Z'));
  });

  it('addHours: cộng/trừ đúng', () => {
    expect(addHours(T('2026-10-05T08:00:00Z'), -2)).toEqual(T('2026-10-05T06:00:00Z'));
  });
});

describe('KPI-001 splitReadWindow (T1)', () => {
  const wm: Watermark = {
    coveredFrom: T('2026-10-01T00:00:00Z'),
    coveredUntil: T('2026-10-05T10:00:00Z'),
  };
  const allRaw = (from: Date, to: Date): ReadWindow => ({
    agg: null,
    raw: [{ from, to, toInclusive: true }],
  });

  it('enabled=false → toàn raw', () => {
    const f = T('2026-10-02T08:17:00Z');
    const t = T('2026-10-02T12:43:00Z');
    expect(splitReadWindow(f, t, wm, false)).toEqual(allRaw(f, t));
  });

  it('wm=null → toàn raw', () => {
    const f = T('2026-10-02T08:17:00Z');
    const t = T('2026-10-02T12:43:00Z');
    expect(splitReadWindow(f, t, null, true)).toEqual(allRaw(f, t));
  });

  it('from/to lẻ phút → agg là các giờ tròn bên trong, 2 mép raw', () => {
    const r = splitReadWindow(T('2026-10-02T08:17:00Z'), T('2026-10-02T12:43:00Z'), wm, true);
    expect(r.agg).toEqual({ from: T('2026-10-02T09:00:00Z'), to: T('2026-10-02T12:00:00Z') });
    expect(r.raw).toEqual([
      { from: T('2026-10-02T08:17:00Z'), to: T('2026-10-02T09:00:00Z'), toInclusive: false },
      { from: T('2026-10-02T12:00:00Z'), to: T('2026-10-02T12:43:00Z'), toInclusive: true },
    ]);
  });

  it('from/to nằm trong cùng 1 giờ → toàn raw', () => {
    const f = T('2026-10-02T08:10:00Z');
    const t = T('2026-10-02T08:50:00Z');
    expect(splitReadWindow(f, t, wm, true)).toEqual(allRaw(f, t));
  });

  it('from, to đúng giờ tròn → không có mép đầu, mép cuối là điểm [to, to]', () => {
    const r = splitReadWindow(T('2026-10-02T08:00:00Z'), T('2026-10-02T12:00:00Z'), wm, true);
    expect(r.agg).toEqual({ from: T('2026-10-02T08:00:00Z'), to: T('2026-10-02T12:00:00Z') });
    expect(r.raw).toEqual([
      { from: T('2026-10-02T12:00:00Z'), to: T('2026-10-02T12:00:00Z'), toInclusive: true },
    ]);
  });

  it('to vượt covered_until → phần sau watermark đọc raw', () => {
    const r = splitReadWindow(T('2026-10-05T08:00:00Z'), T('2026-10-05T13:30:00Z'), wm, true);
    expect(r.agg).toEqual({ from: T('2026-10-05T08:00:00Z'), to: T('2026-10-05T10:00:00Z') });
    expect(r.raw).toEqual([
      { from: T('2026-10-05T10:00:00Z'), to: T('2026-10-05T13:30:00Z'), toInclusive: true },
    ]);
  });

  it('from trước covered_from → mép đầu raw kéo tới covered_from', () => {
    const r = splitReadWindow(T('2026-09-30T22:30:00Z'), T('2026-10-01T03:00:00Z'), wm, true);
    expect(r.agg).toEqual({ from: T('2026-10-01T00:00:00Z'), to: T('2026-10-01T03:00:00Z') });
    expect(r.raw[0]).toEqual({
      from: T('2026-09-30T22:30:00Z'),
      to: T('2026-10-01T00:00:00Z'),
      toInclusive: false,
    });
  });

  it('toàn khoảng trước covered_from → toàn raw', () => {
    const f = T('2026-09-20T00:00:00Z');
    const t = T('2026-09-25T00:00:00Z');
    expect(splitReadWindow(f, t, wm, true)).toEqual(allRaw(f, t));
  });

  it('from > to → toàn raw, không ném lỗi', () => {
    const f = T('2026-10-03T00:00:00Z');
    const t = T('2026-10-02T00:00:00Z');
    expect(splitReadWindow(f, t, wm, true)).toEqual(allRaw(f, t));
  });

  it('thuộc tính: mỗi thời điểm trong [from,to] thuộc ĐÚNG 1 phần; giờ tròn agg không lẫn vào raw', () => {
    let s = 7;
    const rnd = (): number => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
    const base = T('2026-09-29T00:00:00Z').getTime();
    const span = 9 * 24 * 3_600_000;
    for (let i = 0; i < 300; i++) {
      const a = base + Math.floor(rnd() * span);
      const b = a + Math.floor(rnd() * 3 * 24 * 3_600_000);
      const r = splitReadWindow(new Date(a), new Date(b), wm, true);
      for (let k = 0; k < 40; k++) {
        const t = a + Math.floor(rnd() * (b - a + 1));
        const inAgg = r.agg ? t >= r.agg.from.getTime() && t < r.agg.to.getTime() : false;
        const inRaw = r.raw.filter(
          (x) => t >= x.from.getTime() && (x.toInclusive ? t <= x.to.getTime() : t < x.to.getTime()),
        ).length;
        expect(Number(inAgg) + inRaw).toBe(1);
      }
      if (r.agg) {
        expect(floorHour(r.agg.from)).toEqual(r.agg.from);
        expect(floorHour(r.agg.to)).toEqual(r.agg.to);
      }
    }
  });
});

describe('KPI-001 extendWatermark (T4)', () => {
  const wm: Watermark = {
    coveredFrom: T('2026-10-01T00:00:00Z'),
    coveredUntil: T('2026-10-02T00:00:00Z'),
  };

  it('chưa có watermark → tạo mới đúng khoảng', () => {
    expect(extendWatermark(null, T('2026-10-01T00:00:00Z'), T('2026-10-01T02:00:00Z'))).toEqual({
      coveredFrom: T('2026-10-01T00:00:00Z'),
      coveredUntil: T('2026-10-01T02:00:00Z'),
    });
  });

  it('khoảng giao nhau → hợp lại', () => {
    expect(extendWatermark(wm, T('2026-10-01T22:00:00Z'), T('2026-10-02T03:00:00Z'))).toEqual({
      coveredFrom: T('2026-10-01T00:00:00Z'),
      coveredUntil: T('2026-10-02T03:00:00Z'),
    });
  });

  it('khoảng chạm biên (until = covered_from) → hợp lại', () => {
    expect(extendWatermark(wm, T('2026-09-30T00:00:00Z'), T('2026-10-01T00:00:00Z'))).toEqual({
      coveredFrom: T('2026-09-30T00:00:00Z'),
      coveredUntil: T('2026-10-02T00:00:00Z'),
    });
  });

  it('khoảng tạo lỗ hổng → KpiWatermarkGapError', () => {
    expect(() => extendWatermark(wm, T('2026-10-03T00:00:00Z'), T('2026-10-04T00:00:00Z'))).toThrow(
      KpiWatermarkGapError,
    );
    expect(() => extendWatermark(wm, T('2026-09-28T00:00:00Z'), T('2026-09-29T00:00:00Z'))).toThrow(
      KpiWatermarkGapError,
    );
  });

  it('from >= until → Error', () => {
    expect(() => extendWatermark(null, T('2026-10-01T00:00:00Z'), T('2026-10-01T00:00:00Z'))).toThrow();
  });
});

describe('KPI-001 rollup windows', () => {
  it('incremental, chưa có watermark → [floorHour(now) − 2h, floorHour(now))', () => {
    expect(incrementalWindow(null, T('2026-10-05T10:37:00Z'))).toEqual({
      from: T('2026-10-05T08:00:00Z'),
      to: T('2026-10-05T10:00:00Z'),
    });
  });

  it('incremental: làm lại 2h cuối + phần mới', () => {
    const wm = { coveredFrom: T('2026-10-01T00:00:00Z'), coveredUntil: T('2026-10-05T10:00:00Z') };
    expect(incrementalWindow(wm, T('2026-10-05T11:05:00Z'))).toEqual({
      from: T('2026-10-05T08:00:00Z'),
      to: T('2026-10-05T11:00:00Z'),
    });
  });

  it('incremental: không lùi trước covered_from', () => {
    const wm = { coveredFrom: T('2026-10-05T10:00:00Z'), coveredUntil: T('2026-10-05T11:00:00Z') };
    expect(incrementalWindow(wm, T('2026-10-05T11:05:00Z'))).toEqual({
      from: T('2026-10-05T10:00:00Z'),
      to: T('2026-10-05T11:00:00Z'),
    });
  });

  it('reconcile, chưa có watermark → 72h gần nhất', () => {
    expect(reconcileWindow(null, T('2026-10-05T01:00:00Z'))).toEqual({
      from: T('2026-10-02T01:00:00Z'),
      to: T('2026-10-05T01:00:00Z'),
    });
  });

  it('downtime 4 ngày (Review Focus #5): cửa sổ vẫn liền mạch với watermark', () => {
    const wm = { coveredFrom: T('2026-09-01T00:00:00Z'), coveredUntil: T('2026-10-01T00:00:00Z') };
    const now = T('2026-10-05T01:20:00Z');
    const inc = incrementalWindow(wm, now)!;
    const rec = reconcileWindow(wm, now)!;
    expect(inc).toEqual({ from: T('2026-09-30T22:00:00Z'), to: T('2026-10-05T01:00:00Z') });
    expect(rec).toEqual({ from: T('2026-10-01T00:00:00Z'), to: T('2026-10-05T01:00:00Z') });
    expect(() => extendWatermark(wm, inc.from, inc.to)).not.toThrow();
    expect(() => extendWatermark(wm, rec.from, rec.to)).not.toThrow();
  });

  it('planBackfillChunks: lùi từng 24h từ to, chunk cuối kẹp ở floorHour(from)', () => {
    expect(planBackfillChunks(T('2026-10-01T05:30:00Z'), T('2026-10-03T00:00:00Z'))).toEqual([
      { from: T('2026-10-02T00:00:00Z'), to: T('2026-10-03T00:00:00Z') },
      { from: T('2026-10-01T05:00:00Z'), to: T('2026-10-02T00:00:00Z') },
    ]);
    expect(planBackfillChunks(T('2026-10-03T00:00:00Z'), T('2026-10-03T00:00:00Z'))).toEqual([]);
  });
});

describe('KPI-001 SqlParams / rangeClause', () => {
  it('đánh số tham số liên tiếp', () => {
    const p = new SqlParams();
    expect(p.add('a')).toBe('$1');
    expect(p.add('b')).toBe('$2');
    expect(p.values).toEqual(['a', 'b']);
  });

  it('1 khoảng → không bọc OR; nhiều khoảng → OR, đúng < / <=', () => {
    const p = new SqlParams();
    p.add('x');
    const sql = rangeClause(
      'event_time',
      [
        { from: T('2026-10-01T00:00:00Z'), to: T('2026-10-01T01:00:00Z'), toInclusive: false },
        { from: T('2026-10-01T05:00:00Z'), to: T('2026-10-01T05:30:00Z'), toInclusive: true },
      ],
      p,
    );
    expect(sql).toBe(
      '((event_time >= $2 AND event_time < $3) OR (event_time >= $4 AND event_time <= $5))',
    );
    expect(p.values).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx jest src/modules/kpi-rollup/utils/kpi-utils.spec.ts`
Expected: FAIL — `Cannot find module './hour.util.js'`.

- [ ] **Step 3: Viết code**

`src/modules/kpi-rollup/kpi-rollup.constants.ts`
```ts
/** KPI-001 — tên các rollup (khớp `kpi_rollup_watermarks.rollup_name`). */
export type RollupName = 'zone_hourly' | 'vehicle_hourly';
export const ROLLUP_NAMES: readonly RollupName[] = ['zone_hourly', 'vehicle_hourly'];

/** Incremental làm lại N giờ cuối để bắt event đến trễ vài phút. */
export const INCREMENTAL_OVERLAP_HOURS = 2;
/** Reconcile 01:00 tính lại N giờ gần nhất (event trễ do bridge/queue). */
export const RECONCILE_LOOKBACK_HOURS = 72;
export const BACKFILL_CHUNK_HOURS = 24;
export const BUSINESS_TZ = 'Asia/Ho_Chi_Minh';
```

`src/modules/kpi-rollup/utils/kpi-window.types.ts`
```ts
/** Khoảng giờ tròn nửa mở `[from, to)`. */
export interface HourWindow {
  from: Date;
  to: Date;
}

/** Bất biến: mọi giờ H với coveredFrom ≤ H < coveredUntil đã được rollup. */
export interface Watermark {
  coveredFrom: Date;
  coveredUntil: Date;
}

export interface TimeRange {
  from: Date;
  to: Date;
  /** true ⇒ `<= to` (mép cuối giữ semantics BETWEEN của API cũ). */
  toInclusive: boolean;
}

export interface ReadWindow {
  agg: HourWindow | null;
  raw: TimeRange[];
}
```

`src/modules/kpi-rollup/utils/hour.util.ts`
```ts
export const HOUR_MS = 3_600_000;

/** Làm tròn theo epoch-giờ (UTC). VN lệch +7 nguyên giờ nên giờ UTC = giờ VN. */
export function floorHour(d: Date): Date {
  return new Date(Math.floor(d.getTime() / HOUR_MS) * HOUR_MS);
}

export function ceilHour(d: Date): Date {
  return new Date(Math.ceil(d.getTime() / HOUR_MS) * HOUR_MS);
}

export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * HOUR_MS);
}

export function maxDate(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

export function minDate(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}
```

`src/modules/kpi-rollup/utils/split-read-window.util.ts`
```ts
import { ceilHour, floorHour, maxDate, minDate } from './hour.util.js';
import type { ReadWindow, TimeRange, Watermark } from './kpi-window.types.js';

/**
 * KPI-001 §5.1 — chia `[from, to]` (to inclusive) thành phần đọc aggregate (giờ tròn nằm trọn
 * trong khoảng VÀ đã rollup) và phần đọc raw (mép + phần ngoài watermark). Các phần rời nhau,
 * hợp lại đúng `[from, to]`, và mỗi giờ tròn chỉ thuộc 1 phần.
 */
export function splitReadWindow(
  from: Date,
  to: Date,
  wm: Watermark | null,
  enabled: boolean,
): ReadWindow {
  const allRaw: ReadWindow = { agg: null, raw: [{ from, to, toInclusive: true }] };
  if (!enabled || !wm) return allRaw;

  const aggStart = maxDate(ceilHour(from), wm.coveredFrom);
  const aggEnd = minDate(floorHour(to), wm.coveredUntil);
  if (aggStart.getTime() >= aggEnd.getTime()) return allRaw;

  const raw: TimeRange[] = [];
  if (from.getTime() < aggStart.getTime()) {
    raw.push({ from, to: aggStart, toInclusive: false });
  }
  raw.push({ from: aggEnd, to, toInclusive: true });
  return { agg: { from: aggStart, to: aggEnd }, raw };
}
```

`src/modules/kpi-rollup/utils/watermark.util.ts`
```ts
import { maxDate, minDate } from './hour.util.js';
import type { Watermark } from './kpi-window.types.js';

export class KpiWatermarkGapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KpiWatermarkGapError';
  }
}

/** Mở rộng watermark bằng `[from, until)`; từ chối khoảng làm watermark có lỗ (spec §4.3). */
export function extendWatermark(
  current: Watermark | null,
  from: Date,
  until: Date,
): Watermark {
  if (from.getTime() >= until.getTime()) {
    throw new Error(
      `KPI watermark: khoảng rỗng [${from.toISOString()}, ${until.toISOString()})`,
    );
  }
  if (!current) return { coveredFrom: from, coveredUntil: until };
  if (
    until.getTime() < current.coveredFrom.getTime() ||
    from.getTime() > current.coveredUntil.getTime()
  ) {
    throw new KpiWatermarkGapError(
      `KPI watermark: [${from.toISOString()}, ${until.toISOString()}) không liền với ` +
        `[${current.coveredFrom.toISOString()}, ${current.coveredUntil.toISOString()})`,
    );
  }
  return {
    coveredFrom: minDate(current.coveredFrom, from),
    coveredUntil: maxDate(current.coveredUntil, until),
  };
}
```

`src/modules/kpi-rollup/utils/rollup-window.util.ts`
```ts
import {
  BACKFILL_CHUNK_HOURS,
  INCREMENTAL_OVERLAP_HOURS,
  RECONCILE_LOOKBACK_HOURS,
} from '../kpi-rollup.constants.js';
import { addHours, floorHour, maxDate, minDate } from './hour.util.js';
import type { HourWindow, Watermark } from './kpi-window.types.js';

function nonEmpty(from: Date, to: Date): HourWindow | null {
  return from.getTime() < to.getTime() ? { from, to } : null;
}

/** Cron mỗi giờ: làm lại 2h cuối đã phủ + phần mới tới giờ tròn hiện tại. */
export function incrementalWindow(wm: Watermark | null, now: Date): HourWindow | null {
  const end = floorHour(now);
  const start = wm
    ? maxDate(addHours(wm.coveredUntil, -INCREMENTAL_OVERLAP_HOURS), wm.coveredFrom)
    : addHours(end, -INCREMENTAL_OVERLAP_HOURS);
  return nonEmpty(start, end);
}

/**
 * Cron 01:00: tính lại 72h gần nhất. Nếu job đã ngừng lâu hơn 72h thì bắt đầu từ
 * covered_until để cửa sổ vẫn liền với watermark (Review Focus #5).
 */
export function reconcileWindow(wm: Watermark | null, now: Date): HourWindow | null {
  const end = floorHour(now);
  const lookback = addHours(end, -RECONCILE_LOOKBACK_HOURS);
  const start = wm
    ? maxDate(minDate(lookback, wm.coveredUntil), wm.coveredFrom)
    : lookback;
  return nonEmpty(start, end);
}

/** Backfill: lùi từng chunk 24h từ `to` về `floorHour(from)` để mỗi chunk liền watermark. */
export function planBackfillChunks(from: Date, to: Date): HourWindow[] {
  const start = floorHour(from);
  const chunks: HourWindow[] = [];
  let cursor = to;
  while (cursor.getTime() > start.getTime()) {
    const chunkFrom = maxDate(addHours(cursor, -BACKFILL_CHUNK_HOURS), start);
    chunks.push({ from: chunkFrom, to: cursor });
    cursor = chunkFrom;
  }
  return chunks;
}
```

`src/modules/kpi-rollup/utils/sql-params.util.ts`
```ts
import type { TimeRange } from './kpi-window.types.js';

/** Gom tham số `$n` khi ghép SQL động (SEC-03: giá trị luôn bind, không nội suy). */
export class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** `column` PHẢI là hằng trong code (không lấy từ input). */
export function rangeClause(column: string, ranges: TimeRange[], p: SqlParams): string {
  const parts = ranges.map(
    (r) =>
      `(${column} >= ${p.add(r.from)} AND ${column} ${r.toInclusive ? '<=' : '<'} ${p.add(r.to)})`,
  );
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`;
}
```

- [ ] **Step 4: Chạy test, xác nhận pass**

Run: `npx jest src/modules/kpi-rollup/utils/kpi-utils.spec.ts`
Expected: PASS (toàn bộ describe).

- [ ] **Step 5: Lint file mới**

Run: `npx eslint src/modules/kpi-rollup`
Expected: không lỗi (nếu prettier báo format → `npx prettier --write src/modules/kpi-rollup`).

- [ ] **Step 6: Checkpoint** — báo user: Task 1 xong, test pass. **Không commit.**

---

### Task 2: Migration + entity + module khung

**Files:**
- Create: `src/database/migrations/20261007000001-CreateKpiRollupTables.ts`
- Create: `src/modules/kpi-rollup/entities/kpi-zone-hourly.entity.ts`
- Create: `src/modules/kpi-rollup/entities/kpi-vehicle-hourly.entity.ts`
- Create: `src/modules/kpi-rollup/entities/kpi-vehicle-plate-hourly.entity.ts`
- Create: `src/modules/kpi-rollup/entities/kpi-rollup-watermark.entity.ts`
- Create: `src/modules/kpi-rollup/kpi-rollup.module.ts`
- Modify: `src/app.module.ts` (import + thêm vào `imports`, ngay sau `AcademicModule`)
- Modify: `src/database/entities/index.ts` (thêm nhóm KPI cuối file)

**Interfaces:**
- Consumes: —
- Produces: bảng `kpi_zone_hourly`, `kpi_vehicle_hourly`, `kpi_vehicle_plate_hourly`, `kpi_rollup_watermarks`, index `IDX_iot_device_events_vehicle_time`; `KpiRollupModule` (Task 3/4 thêm providers).

- [ ] **Step 1: Viết migration**

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * KPI-001 (task #10, 2026-10-07) — bảng tổng hợp theo giờ cho zone traffic & vehicle stats.
 *
 * ADD-ONLY: tạo 4 bảng mới + 1 index partial trên iot_device_events (không sửa cột/dữ liệu).
 * Index vehicle_time: trước đây vehicle event không có index theo thời gian (zone_id luôn NULL)
 * ⇒ thống kê xe quét toàn bảng. Production bảng lớn: tạo tay
 *   CREATE INDEX CONCURRENTLY "IDX_iot_device_events_vehicle_time" ON ...
 * TRƯỚC khi chạy migration (IF NOT EXISTS sẽ bỏ qua) để không khoá ghi.
 */
export class CreateKpiRollupTables20261007000001 implements MigrationInterface {
  name = 'CreateKpiRollupTables20261007000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "kpi_zone_hourly" (
        "zone_id" uuid NOT NULL,
        "bucket_hour" timestamptz NOT NULL,
        "event_count" integer NOT NULL,
        "sample_count" integer NOT NULL,
        "occupancy_sum" bigint NOT NULL,
        "occupancy_peak" integer NULL,
        "peak_at" timestamptz NOT NULL,
        "computed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kpi_zone_hourly" PRIMARY KEY ("zone_id", "bucket_hour"),
        CONSTRAINT "FK_kpi_zone_hourly_zone" FOREIGN KEY ("zone_id")
          REFERENCES "zones"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_kpi_zone_hourly_bucket" ON "kpi_zone_hourly" ("bucket_hour")`,
    );

    await queryRunner.query(`
      CREATE TABLE "kpi_vehicle_hourly" (
        "id" bigserial NOT NULL,
        "bucket_hour" timestamptz NOT NULL,
        "zone_id" uuid NULL,
        "vehicle_type" text NULL,
        "direction" text NULL,
        "match_state" text NULL,
        "event_count" integer NOT NULL,
        "computed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kpi_vehicle_hourly" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_kpi_vehicle_hourly_bucket" ON "kpi_vehicle_hourly" ("bucket_hour")`,
    );

    await queryRunner.query(`
      CREATE TABLE "kpi_vehicle_plate_hourly" (
        "id" bigserial NOT NULL,
        "bucket_hour" timestamptz NOT NULL,
        "zone_id" uuid NULL,
        "vehicle_type" text NULL,
        "plate_number" text NOT NULL,
        CONSTRAINT "PK_kpi_vehicle_plate_hourly" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_kpi_vehicle_plate_hourly_bucket" ON "kpi_vehicle_plate_hourly" ("bucket_hour")`,
    );

    await queryRunner.query(`
      CREATE TABLE "kpi_rollup_watermarks" (
        "rollup_name" varchar(50) NOT NULL,
        "covered_from" timestamptz NOT NULL,
        "covered_until" timestamptz NOT NULL,
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kpi_rollup_watermarks" PRIMARY KEY ("rollup_name")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_iot_device_events_vehicle_time"
        ON "iot_device_events" ("event_time") WHERE "event_type" = 'ivss_vehicle_event'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_iot_device_events_vehicle_time"`);
    await queryRunner.query(`DROP TABLE "kpi_rollup_watermarks"`);
    await queryRunner.query(`DROP TABLE "kpi_vehicle_plate_hourly"`);
    await queryRunner.query(`DROP TABLE "kpi_vehicle_hourly"`);
    await queryRunner.query(`DROP TABLE "kpi_zone_hourly"`);
  }
}
```

- [ ] **Step 2: Viết 4 entity** (chỉ mapping; index do migration quản lý)

`kpi-zone-hourly.entity.ts`
```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

/** KPI-001 — tổng hợp event `count` của zone theo giờ (ghi bởi ZoneHourlyRollupService). */
@Entity('kpi_zone_hourly')
export class KpiZoneHourlyEntity {
  @PrimaryColumn({ name: 'zone_id', type: 'uuid' })
  zoneId: string;

  @PrimaryColumn({ name: 'bucket_hour', type: 'timestamptz' })
  bucketHour: Date;

  @Column({ name: 'event_count', type: 'integer' })
  eventCount: number;

  @Column({ name: 'sample_count', type: 'integer' })
  sampleCount: number;

  @Column({ name: 'occupancy_sum', type: 'bigint' })
  occupancySum: string;

  @Column({ name: 'occupancy_peak', type: 'integer', nullable: true })
  occupancyPeak: number | null;

  @Column({ name: 'peak_at', type: 'timestamptz' })
  peakAt: Date;

  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'now()' })
  computedAt: Date;
}
```

`kpi-vehicle-hourly.entity.ts`
```ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** KPI-001 — đếm vehicle event theo giờ × zone × loại xe × hướng × trạng thái khớp. */
@Entity('kpi_vehicle_hourly')
export class KpiVehicleHourlyEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'bucket_hour', type: 'timestamptz' })
  bucketHour: Date;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @Column({ name: 'vehicle_type', type: 'text', nullable: true })
  vehicleType: string | null;

  @Column({ name: 'direction', type: 'text', nullable: true })
  direction: string | null;

  @Column({ name: 'match_state', type: 'text', nullable: true })
  matchState: string | null;

  @Column({ name: 'event_count', type: 'integer' })
  eventCount: number;

  @Column({ name: 'computed_at', type: 'timestamptz', default: () => 'now()' })
  computedAt: Date;
}
```

`kpi-vehicle-plate-hourly.entity.ts`
```ts
import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** KPI-001 — biển số khác nhau theo giờ (phục vụ COUNT DISTINCT `unique_vehicles`). */
@Entity('kpi_vehicle_plate_hourly')
export class KpiVehiclePlateHourlyEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'bucket_hour', type: 'timestamptz' })
  bucketHour: Date;

  @Column({ name: 'zone_id', type: 'uuid', nullable: true })
  zoneId: string | null;

  @Column({ name: 'vehicle_type', type: 'text', nullable: true })
  vehicleType: string | null;

  @Column({ name: 'plate_number', type: 'text' })
  plateNumber: string;
}
```

`kpi-rollup-watermark.entity.ts`
```ts
import { Column, Entity, PrimaryColumn } from 'typeorm';

/** KPI-001 — khoảng giờ đã rollup đầy đủ `[covered_from, covered_until)` của từng rollup. */
@Entity('kpi_rollup_watermarks')
export class KpiRollupWatermarkEntity {
  @PrimaryColumn({ name: 'rollup_name', type: 'varchar', length: 50 })
  rollupName: string;

  @Column({ name: 'covered_from', type: 'timestamptz' })
  coveredFrom: Date;

  @Column({ name: 'covered_until', type: 'timestamptz' })
  coveredUntil: Date;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'now()' })
  updatedAt: Date;
}
```

- [ ] **Step 3: Module khung + đăng ký**

`src/modules/kpi-rollup/kpi-rollup.module.ts`
```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KpiZoneHourlyEntity } from './entities/kpi-zone-hourly.entity.js';
import { KpiVehicleHourlyEntity } from './entities/kpi-vehicle-hourly.entity.js';
import { KpiVehiclePlateHourlyEntity } from './entities/kpi-vehicle-plate-hourly.entity.js';
import { KpiRollupWatermarkEntity } from './entities/kpi-rollup-watermark.entity.js';

/**
 * KpiRollupModule (KPI-001 / task #10) — bảng tổng hợp theo giờ + job rollup + phía đọc lai.
 * Không import module nghiệp vụ nào (đọc bảng raw qua SQL) ⇒ campus-dashboard, gate-access,
 * scheduler import module này một chiều, không circular.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      KpiZoneHourlyEntity,
      KpiVehicleHourlyEntity,
      KpiVehiclePlateHourlyEntity,
      KpiRollupWatermarkEntity,
    ]),
  ],
  providers: [],
  exports: [],
})
export class KpiRollupModule {}
```

`src/app.module.ts` — thêm import cạnh `AcademicModule` và vào mảng `imports` ngay sau `AcademicModule,`:
```ts
import { KpiRollupModule } from './modules/kpi-rollup/kpi-rollup.module';
// ...
    KpiRollupModule, // KPI-001 (#10): bảng tổng hợp theo giờ + cron rollup + đọc lai
```

`src/database/entities/index.ts` — thêm cuối file:
```ts

// Group: KPI rollup (KPI-001)
export { KpiZoneHourlyEntity } from '../../modules/kpi-rollup/entities/kpi-zone-hourly.entity.js';
export { KpiVehicleHourlyEntity } from '../../modules/kpi-rollup/entities/kpi-vehicle-hourly.entity.js';
export { KpiVehiclePlateHourlyEntity } from '../../modules/kpi-rollup/entities/kpi-vehicle-plate-hourly.entity.js';
export { KpiRollupWatermarkEntity } from '../../modules/kpi-rollup/entities/kpi-rollup-watermark.entity.js';
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: thành công, không lỗi TS.

- [ ] **Step 5: Migration run → revert → run (T10)**

Run: `npm run migration:run && npm run migration:revert && npm run migration:run`
Expected: lần 1 chạy `CreateKpiRollupTables20261007000001`; revert đúng migration này; lần 3 chạy lại thành công.

- [ ] **Step 6: Kiểm tra schema**

Run: `docker exec capstone-postgres psql -U postgres -d capstone_db -c "\dt kpi_*" -c "select indexname from pg_indexes where indexname like 'IDX_kpi%' or indexname = 'IDX_iot_device_events_vehicle_time'"`
Expected: 4 bảng; 4 index (`IDX_kpi_zone_hourly_bucket`, `IDX_kpi_vehicle_hourly_bucket`, `IDX_kpi_vehicle_plate_hourly_bucket`, `IDX_iot_device_events_vehicle_time`).

- [ ] **Step 7: Checkpoint** — báo user. **Không commit.**

---

### Task 3: Rollup services + lock + watermark repository + job service

**Files:**
- Create: `src/modules/kpi-rollup/utils/rollup-lock.util.ts`
- Create: `src/modules/kpi-rollup/repositories/kpi-watermark.repository.ts`
- Create: `src/modules/kpi-rollup/services/zone-hourly-rollup.service.ts`
- Create: `src/modules/kpi-rollup/services/vehicle-hourly-rollup.service.ts`
- Create: `src/modules/kpi-rollup/services/kpi-rollup-job.service.ts`
- Modify: `src/modules/kpi-rollup/kpi-rollup.module.ts` (providers/exports)
- Test: `src/modules/kpi-rollup/services/kpi-rollup-job.service.spec.ts`
- Create: `test/kpi-rollup/fixtures.ts`
- Test: `test/kpi-rollup/kpi-rollup-db.e2e-spec.ts`

**Interfaces:**
- Consumes (Task 1): `Watermark`, `HourWindow`, `extendWatermark`, `incrementalWindow`, `reconcileWindow`, `floorHour`, `RollupName`, `ROLLUP_NAMES`.
- Produces:
  - `acquireRollupLock(qr: QueryRunner, blocking: boolean): Promise<boolean>`
  - `KpiWatermarkRepository.get(name: RollupName, runner?: QueryRunner): Promise<Watermark | null>`; `.save(runner: QueryRunner, name: RollupName, wm: Watermark): Promise<void>`
  - `interface HourlyRollup { rollup(qr: QueryRunner, from: Date, to: Date): Promise<void> }`
  - `ZoneHourlyRollupService implements HourlyRollup`, `VehicleHourlyRollupService implements HourlyRollup`
  - `interface RollupRunResult { skipped: boolean; windows: Partial<Record<RollupName, HourWindow>> }`
  - `KpiRollupJobService.runIncremental(now?: Date): Promise<RollupRunResult>`; `.runReconcile(now?: Date)`; `.runRange(name: RollupName, from: Date, to: Date)`
  - Test fixtures: `BASE`, `HOURS`, `hoursAfter(h)`, `seedKpiFixture(ds)`, `cleanupKpiFixture(ds, f)`, `rollupAll(ds, from, to)`, `interface KpiFixture { zoneIds: string[]; deviceId: string; tag: string }`

- [ ] **Step 1: Viết unit test job service (sẽ fail)** — `src/modules/kpi-rollup/services/kpi-rollup-job.service.spec.ts`

```ts
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import { KpiRollupJobService } from './kpi-rollup-job.service.js';

const T = (iso: string): Date => new Date(iso);

describe('KpiRollupJobService (KPI-001)', () => {
  let qr: any;
  let dataSource: any;
  let watermarkRepo: any;
  let zoneRollup: any;
  let vehicleRollup: any;
  let service: KpiRollupJobService;

  beforeEach(() => {
    qr = {
      connect: jest.fn(async () => undefined),
      startTransaction: jest.fn(async () => undefined),
      commitTransaction: jest.fn(async () => undefined),
      rollbackTransaction: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
      query: jest.fn(async () => [{ ok: true }]),
    };
    dataSource = { createQueryRunner: jest.fn(() => qr) };
    watermarkRepo = { get: jest.fn(async () => null), save: jest.fn(async () => undefined) };
    zoneRollup = { rollup: jest.fn(async () => undefined) };
    vehicleRollup = { rollup: jest.fn(async () => undefined) };
    service = new KpiRollupJobService(dataSource, watermarkRepo, zoneRollup, vehicleRollup);
  });

  it('không lấy được lock → skipped, KHÔNG rollup, rollback', async () => {
    qr.query.mockResolvedValueOnce([{ ok: false }]);
    const r = await service.runIncremental(T('2026-10-05T10:37:00Z'));
    expect(r).toEqual({ skipped: true, windows: {} });
    expect(zoneRollup.rollup).not.toHaveBeenCalled();
    expect(qr.rollbackTransaction).toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalled();
  });

  it('incremental: rollup cả 2 với cùng cửa sổ, lưu watermark, commit', async () => {
    const r = await service.runIncremental(T('2026-10-05T10:37:00Z'));
    const w = { from: T('2026-10-05T08:00:00Z'), to: T('2026-10-05T10:00:00Z') };
    expect(zoneRollup.rollup).toHaveBeenCalledWith(qr, w.from, w.to);
    expect(vehicleRollup.rollup).toHaveBeenCalledWith(qr, w.from, w.to);
    expect(watermarkRepo.save).toHaveBeenCalledWith(qr, 'zone_hourly', {
      coveredFrom: w.from,
      coveredUntil: w.to,
    });
    expect(r).toEqual({ skipped: false, windows: { zone_hourly: w, vehicle_hourly: w } });
    expect(qr.commitTransaction).toHaveBeenCalled();
  });

  it('rollup lỗi → rollback, ném lỗi, KHÔNG lưu watermark', async () => {
    zoneRollup.rollup.mockRejectedValueOnce(new Error('boom'));
    await expect(service.runIncremental(T('2026-10-05T10:37:00Z'))).rejects.toThrow('boom');
    expect(watermarkRepo.save).not.toHaveBeenCalled();
    expect(qr.rollbackTransaction).toHaveBeenCalled();
    expect(qr.commitTransaction).not.toHaveBeenCalled();
    expect(qr.release).toHaveBeenCalled();
  });

  it('runRange: chỉ 1 rollup, lock blocking (pg_advisory_xact_lock)', async () => {
    qr.query.mockResolvedValueOnce([{}]);
    await service.runRange('vehicle_hourly', T('2026-10-01T00:00:00Z'), T('2026-10-02T00:00:00Z'));
    expect(qr.query.mock.calls[0][0]).toContain('pg_advisory_xact_lock');
    expect(vehicleRollup.rollup).toHaveBeenCalledTimes(1);
    expect(zoneRollup.rollup).not.toHaveBeenCalled();
  });

  it('runRange: from/to không phải giờ tròn → Error, không mở transaction', async () => {
    await expect(
      service.runRange('zone_hourly', T('2026-10-01T00:30:00Z'), T('2026-10-02T00:00:00Z')),
    ).rejects.toThrow();
    expect(dataSource.createQueryRunner).not.toHaveBeenCalled();
  });

  it('runRange không liền watermark → KpiWatermarkGapError, rollback', async () => {
    watermarkRepo.get.mockResolvedValueOnce({
      coveredFrom: T('2026-10-05T00:00:00Z'),
      coveredUntil: T('2026-10-06T00:00:00Z'),
    });
    qr.query.mockResolvedValueOnce([{}]);
    await expect(
      service.runRange('zone_hourly', T('2026-10-01T00:00:00Z'), T('2026-10-02T00:00:00Z')),
    ).rejects.toThrow('không liền');
    expect(zoneRollup.rollup).not.toHaveBeenCalled();
    expect(qr.rollbackTransaction).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx jest src/modules/kpi-rollup/services/kpi-rollup-job.service.spec.ts`
Expected: FAIL — `Cannot find module './kpi-rollup-job.service.js'`.

- [ ] **Step 3: Viết lock util + watermark repository**

`src/modules/kpi-rollup/utils/rollup-lock.util.ts`
```ts
import type { QueryRunner } from 'typeorm';

/**
 * Advisory lock theo transaction (tự nhả khi commit/rollback). Không phụ thuộc Redis.
 * blocking=false (cron): instance khác đang chạy ⇒ trả false để bỏ lượt.
 * blocking=true (backfill): chờ tới khi lấy được.
 */
export async function acquireRollupLock(qr: QueryRunner, blocking: boolean): Promise<boolean> {
  if (blocking) {
    await qr.query(`SELECT pg_advisory_xact_lock(hashtext('kpi_rollup'))`);
    return true;
  }
  const rows: Array<{ ok: boolean }> = await qr.query(
    `SELECT pg_try_advisory_xact_lock(hashtext('kpi_rollup')) AS ok`,
  );
  return rows?.[0]?.ok === true;
}
```

`src/modules/kpi-rollup/repositories/kpi-watermark.repository.ts`
```ts
import { Injectable } from '@nestjs/common';
import { DataSource, QueryRunner } from 'typeorm';
import type { RollupName } from '../kpi-rollup.constants.js';
import type { Watermark } from '../utils/kpi-window.types.js';

@Injectable()
export class KpiWatermarkRepository {
  constructor(private readonly dataSource: DataSource) {}

  async get(name: RollupName, runner?: QueryRunner): Promise<Watermark | null> {
    const rows: Array<{ covered_from: Date; covered_until: Date }> = await (
      runner ?? this.dataSource
    ).query(
      `SELECT covered_from, covered_until FROM kpi_rollup_watermarks WHERE rollup_name = $1`,
      [name],
    );
    if (!rows?.length) return null;
    return {
      coveredFrom: new Date(rows[0].covered_from),
      coveredUntil: new Date(rows[0].covered_until),
    };
  }

  async save(runner: QueryRunner, name: RollupName, wm: Watermark): Promise<void> {
    await runner.query(
      `INSERT INTO kpi_rollup_watermarks (rollup_name, covered_from, covered_until, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (rollup_name) DO UPDATE
         SET covered_from = EXCLUDED.covered_from,
             covered_until = EXCLUDED.covered_until,
             updated_at = now()`,
      [name, wm.coveredFrom, wm.coveredUntil],
    );
  }
}
```

- [ ] **Step 4: Viết 2 rollup service**

`src/modules/kpi-rollup/services/zone-hourly-rollup.service.ts`
```ts
import { Injectable } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';

export interface HourlyRollup {
  rollup(qr: QueryRunner, from: Date, to: Date): Promise<void>;
}

/**
 * KPI-001 §4.2 — tổng hợp `zone_presence_events` (event_type='count') theo zone × giờ trong
 * cửa sổ `[from, to)`. DELETE rồi INSERT ⇒ idempotent. `peak_at` theo đúng quy tắc của
 * ZoneTrafficHeatmapService cũ: occupancy cao nhất (NULL xếp cuối), hoà thì event muộn hơn.
 */
@Injectable()
export class ZoneHourlyRollupService implements HourlyRollup {
  async rollup(qr: QueryRunner, from: Date, to: Date): Promise<void> {
    await qr.query(
      `DELETE FROM kpi_zone_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
      [from, to],
    );
    await qr.query(
      `WITH src AS (
         SELECT zone_id, event_time, occupancy_count,
                date_trunc('hour', event_time, 'UTC') AS bucket_hour
         FROM zone_presence_events
         WHERE event_type = 'count' AND event_time >= $1 AND event_time < $2
       ), agg AS (
         SELECT bucket_hour, zone_id,
                COUNT(*) AS event_count,
                COUNT(occupancy_count) AS sample_count,
                COALESCE(SUM(occupancy_count), 0) AS occupancy_sum,
                MAX(occupancy_count) AS occupancy_peak
         FROM src GROUP BY bucket_hour, zone_id
       ), peak AS (
         SELECT DISTINCT ON (zone_id, bucket_hour) zone_id, bucket_hour, event_time AS peak_at
         FROM src
         ORDER BY zone_id, bucket_hour, occupancy_count DESC NULLS LAST, event_time DESC
       )
       INSERT INTO kpi_zone_hourly
         (bucket_hour, zone_id, event_count, sample_count, occupancy_sum, occupancy_peak, peak_at)
       SELECT a.bucket_hour, a.zone_id, a.event_count, a.sample_count, a.occupancy_sum,
              a.occupancy_peak, p.peak_at
       FROM agg a JOIN peak p USING (zone_id, bucket_hour)`,
      [from, to],
    );
  }
}
```

`src/modules/kpi-rollup/services/vehicle-hourly-rollup.service.ts`
```ts
import { Injectable } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';
import type { HourlyRollup } from './zone-hourly-rollup.service.js';

/**
 * KPI-001 §4.2 — tổng hợp vehicle event (`iot_device_events`, event_type='ivss_vehicle_event')
 * theo giờ: số đếm theo (zone, loại xe, hướng, trạng thái khớp) + danh sách biển khác nhau.
 * Dùng index partial `IDX_iot_device_events_vehicle_time`.
 */
@Injectable()
export class VehicleHourlyRollupService implements HourlyRollup {
  async rollup(qr: QueryRunner, from: Date, to: Date): Promise<void> {
    await qr.query(
      `DELETE FROM kpi_vehicle_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
      [from, to],
    );
    await qr.query(
      `INSERT INTO kpi_vehicle_hourly
         (bucket_hour, zone_id, vehicle_type, direction, match_state, event_count)
       SELECT date_trunc('hour', event_time, 'UTC'), zone_id,
              payload_json->>'vehicleType', payload_json->>'direction',
              payload_json->>'matchState', COUNT(*)
       FROM iot_device_events
       WHERE event_type = 'ivss_vehicle_event' AND event_time >= $1 AND event_time < $2
       GROUP BY 1, 2, 3, 4, 5`,
      [from, to],
    );
    await qr.query(
      `DELETE FROM kpi_vehicle_plate_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`,
      [from, to],
    );
    await qr.query(
      `INSERT INTO kpi_vehicle_plate_hourly (bucket_hour, zone_id, vehicle_type, plate_number)
       SELECT DISTINCT date_trunc('hour', event_time, 'UTC'), zone_id,
              payload_json->>'vehicleType', payload_json->>'plateNumber'
       FROM iot_device_events
       WHERE event_type = 'ivss_vehicle_event' AND event_time >= $1 AND event_time < $2
         AND payload_json->>'plateNumber' IS NOT NULL`,
      [from, to],
    );
  }
}
```

- [ ] **Step 5: Viết job service + đăng ký module**

`src/modules/kpi-rollup/services/kpi-rollup-job.service.ts`
```ts
import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ROLLUP_NAMES, type RollupName } from '../kpi-rollup.constants.js';
import { KpiWatermarkRepository } from '../repositories/kpi-watermark.repository.js';
import { acquireRollupLock } from '../utils/rollup-lock.util.js';
import { floorHour } from '../utils/hour.util.js';
import { extendWatermark } from '../utils/watermark.util.js';
import { incrementalWindow, reconcileWindow } from '../utils/rollup-window.util.js';
import type { HourWindow, Watermark } from '../utils/kpi-window.types.js';
import { ZoneHourlyRollupService, type HourlyRollup } from './zone-hourly-rollup.service.js';
import { VehicleHourlyRollupService } from './vehicle-hourly-rollup.service.js';

export interface RollupRunResult {
  skipped: boolean;
  windows: Partial<Record<RollupName, HourWindow>>;
}

/**
 * KPI-001 §4.3 — điều phối rollup: 1 transaction + advisory lock; với từng rollup: đọc
 * watermark → tính cửa sổ → kiểm tra liền mạch → rollup → lưu watermark. Lỗi ⇒ rollback
 * toàn bộ, watermark không tiến, lượt sau làm lại.
 */
@Injectable()
export class KpiRollupJobService {
  private readonly logger = new Logger(KpiRollupJobService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly watermarkRepo: KpiWatermarkRepository,
    private readonly zoneRollup: ZoneHourlyRollupService,
    private readonly vehicleRollup: VehicleHourlyRollupService,
  ) {}

  runIncremental(now: Date = new Date()): Promise<RollupRunResult> {
    return this.execute(false, ROLLUP_NAMES, (wm) => incrementalWindow(wm, now));
  }

  runReconcile(now: Date = new Date()): Promise<RollupRunResult> {
    return this.execute(false, ROLLUP_NAMES, (wm) => reconcileWindow(wm, now));
  }

  /** Backfill / chạy tay: cửa sổ phải là giờ tròn và liền watermark hiện có. */
  runRange(name: RollupName, from: Date, to: Date): Promise<RollupRunResult> {
    if (
      floorHour(from).getTime() !== from.getTime() ||
      floorHour(to).getTime() !== to.getTime()
    ) {
      return Promise.reject(new Error('KPI runRange: from/to phải là giờ tròn'));
    }
    return this.execute(true, [name], () => ({ from, to }));
  }

  private rollupFor(name: RollupName): HourlyRollup {
    return name === 'zone_hourly' ? this.zoneRollup : this.vehicleRollup;
  }

  private async execute(
    blocking: boolean,
    names: readonly RollupName[],
    pickWindow: (wm: Watermark | null) => HourWindow | null,
  ): Promise<RollupRunResult> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    await qr.startTransaction();
    try {
      if (!(await acquireRollupLock(qr, blocking))) {
        this.logger.debug('[KPI] rollup đang chạy ở instance khác — bỏ lượt');
        await qr.rollbackTransaction();
        return { skipped: true, windows: {} };
      }
      const windows: Partial<Record<RollupName, HourWindow>> = {};
      for (const name of names) {
        const wm = await this.watermarkRepo.get(name, qr);
        const window = pickWindow(wm);
        if (!window) continue;
        const next = extendWatermark(wm, window.from, window.to);
        await this.rollupFor(name).rollup(qr, window.from, window.to);
        await this.watermarkRepo.save(qr, name, next);
        windows[name] = window;
      }
      await qr.commitTransaction();
      return { skipped: false, windows };
    } catch (err) {
      await qr.rollbackTransaction();
      throw err;
    } finally {
      await qr.release();
    }
  }
}
```

`kpi-rollup.module.ts` — sửa `providers`/`exports`:
```ts
  providers: [
    KpiWatermarkRepository,
    ZoneHourlyRollupService,
    VehicleHourlyRollupService,
    KpiRollupJobService,
  ],
  exports: [KpiRollupJobService, KpiWatermarkRepository],
```
(thêm 4 import tương ứng từ `./repositories/kpi-watermark.repository.js`, `./services/zone-hourly-rollup.service.js`, `./services/vehicle-hourly-rollup.service.js`, `./services/kpi-rollup-job.service.js`).

- [ ] **Step 6: Chạy unit test, xác nhận pass**

Run: `npx jest src/modules/kpi-rollup`
Expected: PASS.

- [ ] **Step 7: Viết fixture DB** — `test/kpi-rollup/fixtures.ts`

```ts
import type { DataSource } from 'typeorm';
import { ZoneHourlyRollupService } from '../../src/modules/kpi-rollup/services/zone-hourly-rollup.service';
import { VehicleHourlyRollupService } from '../../src/modules/kpi-rollup/services/vehicle-hourly-rollup.service';

/** Dữ liệu test nằm ở năm 2001 để không lẫn dữ liệu dev thật. */
export const BASE = new Date('2001-01-01T00:00:00Z');
export const HOURS = 72;
export const hoursAfter = (h: number): Date => new Date(BASE.getTime() + h * 3_600_000);

export interface KpiFixture {
  zoneIds: string[]; // [A, B, C] — C chỉ có event occupancy NULL
  deviceId: string;
  tag: string;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export async function seedKpiFixture(ds: DataSource): Promise<KpiFixture> {
  const tag = `KPITEST-${Date.now()}`;
  const zoneIds: string[] = [];
  for (const suffix of ['A', 'B', 'C']) {
    const rows: Array<{ id: string }> = await ds.query(
      `INSERT INTO zones (zone_code, zone_name, building, floor)
       VALUES ($1, $2, 'Tòa KPI', '1') RETURNING id`,
      [`${tag}-${suffix}`, `KPI Zone ${suffix}`],
    );
    zoneIds.push(rows[0].id);
  }
  const dev: Array<{ id: string }> = await ds.query(
    `INSERT INTO iot_devices (device_code, device_name, device_type)
     VALUES ($1, 'KPI test cam', 'room_camera') RETURNING id`,
    [tag],
  );
  const deviceId = dev[0].id;
  const rnd = lcg(42);

  // Zone events
  const zZone: string[] = [];
  const zTime: Date[] = [];
  const zOcc: Array<number | null> = [];
  const pushZ = (zone: string, t: Date, occ: number | null): void => {
    zZone.push(zone);
    zTime.push(t);
    zOcc.push(occ);
  };
  for (const zone of zoneIds.slice(0, 2)) {
    for (let i = 0; i < 400; i++) {
      pushZ(zone, hoursAfter(rnd() * HOURS), rnd() < 0.1 ? null : Math.floor(rnd() * 30));
    }
  }
  pushZ(zoneIds[0], hoursAfter(5), 50); // đúng giờ tròn 05:00 (Review Focus #2)
  pushZ(zoneIds[0], hoursAfter(9), 7); // đúng 09:00 = `to` của 1 case so khớp
  pushZ(zoneIds[0], hoursAfter(40.25), 50); // hoà đỉnh 50, muộn hơn ⇒ phải thắng (Review Focus #3)
  pushZ(zoneIds[2], hoursAfter(61.1), null); // zone C: giờ toàn NULL
  pushZ(zoneIds[2], hoursAfter(61.2), null);
  pushZ(zoneIds[2], hoursAfter(61.3), null);
  await ds.query(
    `INSERT INTO zone_presence_events (zone_id, device_id, event_type, event_time, occupancy_count, source_type)
     SELECT z, $1, 'count', t, o, 'kpitest'
     FROM unnest($2::uuid[], $3::timestamptz[], $4::int[]) AS u(z, t, o)`,
    [deviceId, zZone, zTime, zOcc],
  );

  // Vehicle events
  const dirs = ['enter', 'leave', 'seen', null];
  const states = ['matched', 'unmatched'];
  const types = ['car', 'motorbike'];
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];
  const vTime: Date[] = [];
  const vPayload: string[] = [];
  const pushV = (t: Date, p: Record<string, unknown>): void => {
    vTime.push(t);
    vPayload.push(JSON.stringify(p));
  };
  for (let i = 0; i < 300; i++) {
    pushV(hoursAfter(rnd() * HOURS), {
      direction: pick(dirs),
      matchState: pick(states),
      vehicleType: pick(types),
      plateNumber: rnd() < 0.1 ? null : `29A-${String(Math.floor(rnd() * 20)).padStart(3, '0')}`,
    });
  }
  // Cùng biển ở phần raw (02:30) và phần agg (20:00) ⇒ unique đếm 1 lần (Review Focus #4)
  pushV(hoursAfter(2.5), { direction: 'enter', matchState: 'matched', vehicleType: 'car', plateNumber: '29A-999' });
  pushV(hoursAfter(20), { direction: 'leave', matchState: 'matched', vehicleType: 'car', plateNumber: '29A-999' });
  pushV(hoursAfter(9), { direction: 'enter', matchState: 'unmatched', vehicleType: 'car', plateNumber: '30F-111' });
  await ds.query(
    `INSERT INTO iot_device_events (device_id, event_type, event_time, payload_json)
     SELECT $1, 'ivss_vehicle_event', t, p
     FROM unnest($2::timestamptz[], $3::jsonb[]) AS u(t, p)`,
    [deviceId, vTime, vPayload],
  );

  return { zoneIds, deviceId, tag };
}

export async function rollupAll(ds: DataSource, from: Date, to: Date): Promise<void> {
  const qr = ds.createQueryRunner();
  await qr.connect();
  await qr.startTransaction();
  try {
    await new ZoneHourlyRollupService().rollup(qr, from, to);
    await new VehicleHourlyRollupService().rollup(qr, from, to);
    await qr.commitTransaction();
  } catch (e) {
    await qr.rollbackTransaction();
    throw e;
  } finally {
    await qr.release();
  }
}

export async function cleanupKpiFixture(ds: DataSource, f: KpiFixture): Promise<void> {
  const lo = hoursAfter(-24);
  const hi = hoursAfter(HOURS + 24);
  await ds.query(`DELETE FROM kpi_zone_hourly WHERE zone_id = ANY($1::uuid[])`, [f.zoneIds]);
  await ds.query(`DELETE FROM kpi_vehicle_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`, [lo, hi]);
  await ds.query(`DELETE FROM kpi_vehicle_plate_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2`, [lo, hi]);
  await ds.query(`DELETE FROM zone_presence_events WHERE device_id = $1`, [f.deviceId]);
  await ds.query(`DELETE FROM iot_device_events WHERE device_id = $1`, [f.deviceId]);
  await ds.query(`DELETE FROM iot_devices WHERE id = $1`, [f.deviceId]);
  await ds.query(`DELETE FROM zones WHERE id = ANY($1::uuid[])`, [f.zoneIds]);
}
```

- [ ] **Step 8: Viết test DB T6/T7 + kiểm tra rollup** — `test/kpi-rollup/kpi-rollup-db.e2e-spec.ts`

```ts
import { AppDataSource } from '../../src/database/data-source';
import { acquireRollupLock } from '../../src/modules/kpi-rollup/utils/rollup-lock.util';
import {
  BASE,
  HOURS,
  cleanupKpiFixture,
  hoursAfter,
  rollupAll,
  seedKpiFixture,
  type KpiFixture,
} from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDb('KPI-001 rollup trên DB thật', () => {
  let f: KpiFixture;
  const end = hoursAfter(HOURS);

  const snapshot = async (): Promise<unknown[]> => [
    await AppDataSource.query(
      `SELECT zone_id, bucket_hour, event_count, sample_count, occupancy_sum, occupancy_peak, peak_at
       FROM kpi_zone_hourly WHERE zone_id = ANY($1::uuid[]) ORDER BY 1, 2`,
      [f.zoneIds],
    ),
    await AppDataSource.query(
      `SELECT bucket_hour, zone_id, vehicle_type, direction, match_state, event_count
       FROM kpi_vehicle_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2
       ORDER BY 1, 2, 3, 4, 5`,
      [BASE, end],
    ),
    await AppDataSource.query(
      `SELECT bucket_hour, zone_id, vehicle_type, plate_number
       FROM kpi_vehicle_plate_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2
       ORDER BY 1, 2, 3, 4`,
      [BASE, end],
    ),
  ];

  beforeAll(async () => {
    await AppDataSource.initialize();
    f = await seedKpiFixture(AppDataSource);
    await rollupAll(AppDataSource, BASE, end);
  });

  afterAll(async () => {
    await cleanupKpiFixture(AppDataSource, f);
    await AppDataSource.destroy();
  });

  it('T6 — rollup cùng cửa sổ 2 lần → bảng tổng hợp y hệt', async () => {
    const first = await snapshot();
    await rollupAll(AppDataSource, BASE, end);
    expect(await snapshot()).toEqual(first);
  });

  it('tổng event_count = số event raw (zone & xe)', async () => {
    const [z] = await AppDataSource.query(
      `SELECT
         (SELECT COALESCE(SUM(event_count),0)::int FROM kpi_zone_hourly WHERE zone_id = ANY($1::uuid[])) AS agg,
         (SELECT COUNT(*)::int FROM zone_presence_events WHERE zone_id = ANY($1::uuid[]) AND event_type = 'count') AS raw`,
      [f.zoneIds],
    );
    expect(z.agg).toBe(z.raw);
    const [v] = await AppDataSource.query(
      `SELECT
         (SELECT COALESCE(SUM(event_count),0)::int FROM kpi_vehicle_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2) AS agg,
         (SELECT COUNT(*)::int FROM iot_device_events WHERE device_id = $3) AS raw`,
      [BASE, end, f.deviceId],
    );
    expect(v.agg).toBe(v.raw);
  });

  it('zone C giờ toàn NULL → sample_count=0, sum=0, peak NULL, peak_at = event muộn nhất (Review Focus #3)', async () => {
    const rows = await AppDataSource.query(
      `SELECT event_count, sample_count, occupancy_sum, occupancy_peak, peak_at
       FROM kpi_zone_hourly WHERE zone_id = $1`,
      [f.zoneIds[2]],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].event_count).toBe(3);
    expect(rows[0].sample_count).toBe(0);
    expect(Number(rows[0].occupancy_sum)).toBe(0);
    expect(rows[0].occupancy_peak).toBeNull();
    expect(new Date(rows[0].peak_at)).toEqual(hoursAfter(61.3));
  });

  it('T7 — lock: transaction thứ 2 không lấy được khi transaction 1 đang giữ', async () => {
    const qr1 = AppDataSource.createQueryRunner();
    const qr2 = AppDataSource.createQueryRunner();
    await qr1.connect();
    await qr2.connect();
    await qr1.startTransaction();
    await qr2.startTransaction();
    try {
      expect(await acquireRollupLock(qr1, false)).toBe(true);
      expect(await acquireRollupLock(qr2, false)).toBe(false);
    } finally {
      await qr1.rollbackTransaction();
      await qr2.rollbackTransaction();
      await qr1.release();
      await qr2.release();
    }
  });
});
```

- [ ] **Step 9: Chạy test DB**

Run: `RUN_DB_TESTS=1 npx jest --config test/jest-e2e.json test/kpi-rollup/kpi-rollup-db.e2e-spec.ts --runInBand`
Expected: 4 test PASS. Nếu `unnest(... $3::jsonb[])` lỗi kiểu, đổi tham số thành `$3::text[]` và `p::jsonb` trong SELECT.

- [ ] **Step 10: Lint + checkpoint**

Run: `npx eslint src/modules/kpi-rollup test/kpi-rollup`
Expected: không lỗi. Báo user. **Không commit.**

---

### Task 4: Phía đọc — `KpiReadWindowService` + biến env

**Files:**
- Create: `src/modules/kpi-rollup/services/kpi-read-window.service.ts`
- Test: `src/modules/kpi-rollup/services/kpi-read-window.service.spec.ts`
- Modify: `src/modules/kpi-rollup/kpi-rollup.module.ts` (thêm provider + export)
- Modify: `src/config/env.validation.ts` (cạnh nhóm `SCHEDULER_*`, sau dòng `SCHEDULER_IVSS_SYNC_ENABLED`)
- Modify: `.env.example` (mục `K. Scheduler`)

**Interfaces:**
- Consumes: `KpiWatermarkRepository.get`, `splitReadWindow`, `RollupName`, `ReadWindow`.
- Produces: `KpiReadWindowService.resolve(name: RollupName, from: Date, to: Date): Promise<ReadWindow>`.

- [ ] **Step 1: Viết test (sẽ fail)**

```ts
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await */
import { KpiReadWindowService } from './kpi-read-window.service.js';

const T = (iso: string): Date => new Date(iso);

describe('KpiReadWindowService (KPI-001 §5.4)', () => {
  const from = T('2026-10-02T08:17:00Z');
  const to = T('2026-10-02T12:43:00Z');
  const wm = { coveredFrom: T('2026-10-01T00:00:00Z'), coveredUntil: T('2026-10-05T00:00:00Z') };
  const cfg = (enabled?: boolean): any => ({
    get: (_k: string, d: unknown) => (enabled === undefined ? d : enabled),
  });

  it('mặc định bật: có watermark → có phần agg', async () => {
    const repo = { get: jest.fn(async () => wm) };
    const s = new KpiReadWindowService(repo as any, cfg());
    const r = await s.resolve('zone_hourly', from, to);
    expect(r.agg).toEqual({ from: T('2026-10-02T09:00:00Z'), to: T('2026-10-02T12:00:00Z') });
    expect(repo.get).toHaveBeenCalledWith('zone_hourly');
  });

  it('KPI_ROLLUP_READ_ENABLED=false → toàn raw, KHÔNG đọc watermark', async () => {
    const repo = { get: jest.fn(async () => wm) };
    const s = new KpiReadWindowService(repo as any, cfg(false));
    const r = await s.resolve('zone_hourly', from, to);
    expect(r).toEqual({ agg: null, raw: [{ from, to, toInclusive: true }] });
    expect(repo.get).not.toHaveBeenCalled();
  });

  it('đọc watermark lỗi (bảng chưa migrate) → toàn raw, KHÔNG ném (Review Focus #1)', async () => {
    const repo = { get: jest.fn(async () => { throw new Error('relation "kpi_rollup_watermarks" does not exist'); }) };
    const s = new KpiReadWindowService(repo as any, cfg());
    await expect(s.resolve('vehicle_hourly', from, to)).resolves.toEqual({
      agg: null,
      raw: [{ from, to, toInclusive: true }],
    });
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận fail**

Run: `npx jest src/modules/kpi-rollup/services/kpi-read-window.service.spec.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết service**

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RollupName } from '../kpi-rollup.constants.js';
import { KpiWatermarkRepository } from '../repositories/kpi-watermark.repository.js';
import { splitReadWindow } from '../utils/split-read-window.util.js';
import type { ReadWindow, Watermark } from '../utils/kpi-window.types.js';

/**
 * KPI-001 §5 — phía đọc: watermark + cờ `KPI_ROLLUP_READ_ENABLED` → ReadWindow.
 * Mọi lỗi đọc watermark ⇒ đọc 100% raw (đúng nhưng chậm), không làm hỏng API.
 */
@Injectable()
export class KpiReadWindowService {
  private readonly logger = new Logger(KpiReadWindowService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly watermarkRepo: KpiWatermarkRepository,
    configService: ConfigService,
  ) {
    this.enabled = configService.get<boolean>('KPI_ROLLUP_READ_ENABLED', true);
  }

  async resolve(name: RollupName, from: Date, to: Date): Promise<ReadWindow> {
    if (!this.enabled) return splitReadWindow(from, to, null, false);
    let wm: Watermark | null = null;
    try {
      wm = await this.watermarkRepo.get(name);
    } catch (err) {
      this.logger.warn(
        `[KPI] đọc watermark ${name} lỗi, dùng raw: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
    return splitReadWindow(from, to, wm, true);
  }
}
```

Module: thêm `KpiReadWindowService` vào `providers` và `exports` (`exports: [KpiRollupJobService, KpiWatermarkRepository, KpiReadWindowService]`). `ConfigModule` đã `isGlobal: true` ở `app.module.ts` nên không cần import.

- [ ] **Step 4: Env**

`src/config/env.validation.ts` — sau dòng `SCHEDULER_IVSS_SYNC_ENABLED: Joi.boolean().default(false),`:
```ts
  // KPI-001 (#10): cron rollup KPI theo giờ + đối soát 01:00 (gated default OFF).
  SCHEDULER_KPI_ROLLUP_ENABLED: Joi.boolean().default(false),
  // KPI-001: đọc bảng tổng hợp ở API zone traffic / vehicle stats. false ⇒ quay về 100% raw.
  KPI_ROLLUP_READ_ENABLED: Joi.boolean().default(true),
```

`.env.example` — cuối mục `# ─── K. Scheduler`:
```
# KPI-001: rollup KPI theo giờ (phút 05) + đối soát 01:00 giờ VN
SCHEDULER_KPI_ROLLUP_ENABLED=false
# KPI-001: API dashboard đọc bảng tổng hợp (false = chỉ đọc raw, dùng để rollback nhanh)
KPI_ROLLUP_READ_ENABLED=true
```

- [ ] **Step 5: Chạy test + build**

Run: `npx jest src/modules/kpi-rollup && npm run build`
Expected: PASS; build OK.

- [ ] **Step 6: Checkpoint** — báo user. **Không commit.**

---

### Task 5: Zone traffic đọc lai

**Files:**
- Create: `src/modules/campus-dashboard/utils/merge-zone-heatmap.util.ts`
- Test: `src/modules/campus-dashboard/utils/merge-zone-heatmap.util.spec.ts`
- Modify: `src/modules/campus-dashboard/services/zone-traffic-heatmap.service.ts` (viết lại `getTraffic`, `querySeries`, `queryHeatmapAggregate`; giữ `validateRange`)
- Modify: `src/modules/campus-dashboard/services/zone-traffic-heatmap.service.spec.ts` (thay toàn bộ)
- Modify: `src/modules/campus-dashboard/campus-dashboard.module.ts` (`imports` thêm `KpiRollupModule`)

**Interfaces:**
- Consumes: `KpiReadWindowService.resolve('zone_hourly', from, to)`, `SqlParams`, `rangeClause`, `ReadWindow`.
- Produces: `interface ZoneHeatmapPart { zoneId: string; eventCount: number; occupancySum: number; sampleCount: number; peakOccupancy: number | null; peakAt: Date | null }`; `interface ZoneHeatmapAggregate { zoneId: string; avgOccupancy: number | null; peakOccupancy: number | null; peakAt: Date | null }`; `mergeZoneHeatmapParts(parts: ZoneHeatmapPart[]): ZoneHeatmapAggregate[]` (sắp theo `zoneId`). Response API không đổi.

- [ ] **Step 1: Test merge (sẽ fail)** — `merge-zone-heatmap.util.spec.ts`

```ts
import { mergeZoneHeatmapParts, type ZoneHeatmapPart } from './merge-zone-heatmap.util.js';

const part = (over: Partial<ZoneHeatmapPart>): ZoneHeatmapPart => ({
  zoneId: 'z1',
  eventCount: 1,
  occupancySum: 0,
  sampleCount: 0,
  peakOccupancy: null,
  peakAt: null,
  ...over,
});

describe('mergeZoneHeatmapParts (KPI-001 §5.2)', () => {
  it('avg = Σsum / Σsample; peak = max', () => {
    const [r] = mergeZoneHeatmapParts([
      part({ occupancySum: 30, sampleCount: 3, peakOccupancy: 15, peakAt: new Date('2026-10-01T01:00:00Z') }),
      part({ occupancySum: 10, sampleCount: 1, peakOccupancy: 10, peakAt: new Date('2026-10-01T05:00:00Z') }),
    ]);
    expect(r.avgOccupancy).toBe(10);
    expect(r.peakOccupancy).toBe(15);
    expect(r.peakAt).toEqual(new Date('2026-10-01T01:00:00Z'));
  });

  it('hoà đỉnh → peak_at muộn hơn thắng (Review Focus #3)', () => {
    const [r] = mergeZoneHeatmapParts([
      part({ peakOccupancy: 50, peakAt: new Date('2026-10-01T05:00:00Z'), sampleCount: 1, occupancySum: 50 }),
      part({ peakOccupancy: 50, peakAt: new Date('2026-10-02T16:15:00Z'), sampleCount: 1, occupancySum: 50 }),
    ]);
    expect(r.peakAt).toEqual(new Date('2026-10-02T16:15:00Z'));
  });

  it('NULL xếp cuối: phần có peak số thắng phần peak NULL dù muộn hơn', () => {
    const [r] = mergeZoneHeatmapParts([
      part({ peakOccupancy: 3, peakAt: new Date('2026-10-01T00:00:00Z'), sampleCount: 1, occupancySum: 3 }),
      part({ peakOccupancy: null, peakAt: new Date('2026-10-03T00:00:00Z') }),
    ]);
    expect(r.peakOccupancy).toBe(3);
    expect(r.peakAt).toEqual(new Date('2026-10-01T00:00:00Z'));
  });

  it('toàn NULL → avg null, peak null, peak_at = muộn nhất', () => {
    const [r] = mergeZoneHeatmapParts([
      part({ peakAt: new Date('2026-10-01T00:00:00Z') }),
      part({ peakAt: new Date('2026-10-01T03:00:00Z') }),
    ]);
    expect(r.avgOccupancy).toBeNull();
    expect(r.peakOccupancy).toBeNull();
    expect(r.peakAt).toEqual(new Date('2026-10-01T03:00:00Z'));
  });

  it('nhiều zone → tách riêng, sắp theo zoneId; zone eventCount=0 bị bỏ', () => {
    const r = mergeZoneHeatmapParts([
      part({ zoneId: 'z2' }),
      part({ zoneId: 'z1' }),
      part({ zoneId: 'z3', eventCount: 0 }),
    ]);
    expect(r.map((x) => x.zoneId)).toEqual(['z1', 'z2']);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận fail**

Run: `npx jest src/modules/campus-dashboard/utils/merge-zone-heatmap.util.spec.ts`
Expected: FAIL — module không tồn tại.

- [ ] **Step 3: Viết merge util**

```ts
/** Một phần (aggregate hoặc raw) của heatmap 1 zone — chỉ chứa số cộng dồn được. */
export interface ZoneHeatmapPart {
  zoneId: string;
  eventCount: number;
  occupancySum: number;
  sampleCount: number;
  peakOccupancy: number | null;
  peakAt: Date | null;
}

export interface ZoneHeatmapAggregate {
  zoneId: string;
  avgOccupancy: number | null;
  peakOccupancy: number | null;
  peakAt: Date | null;
}

/** true nếu b "thắng" a theo quy tắc: occupancy DESC NULLS LAST, rồi peak_at DESC. */
function beats(a: ZoneHeatmapPart, b: ZoneHeatmapPart): boolean {
  if (a.peakOccupancy === null && b.peakOccupancy !== null) return true;
  if (a.peakOccupancy !== null && b.peakOccupancy === null) return false;
  if (a.peakOccupancy !== b.peakOccupancy) return (b.peakOccupancy ?? 0) > (a.peakOccupancy ?? 0);
  return (b.peakAt?.getTime() ?? -Infinity) > (a.peakAt?.getTime() ?? -Infinity);
}

/**
 * KPI-001 §5.2 — gộp các phần heatmap theo zone, cho kết quả bằng query raw cũ
 * (AVG/MAX + subquery peak_at) trên toàn khoảng.
 */
export function mergeZoneHeatmapParts(parts: ZoneHeatmapPart[]): ZoneHeatmapAggregate[] {
  const acc = new Map<string, { sum: number; samples: number; events: number; best: ZoneHeatmapPart }>();
  for (const p of parts) {
    const cur = acc.get(p.zoneId);
    if (!cur) {
      acc.set(p.zoneId, { sum: p.occupancySum, samples: p.sampleCount, events: p.eventCount, best: p });
      continue;
    }
    cur.sum += p.occupancySum;
    cur.samples += p.sampleCount;
    cur.events += p.eventCount;
    if (beats(cur.best, p)) cur.best = p;
  }
  return [...acc.entries()]
    .filter(([, v]) => v.events > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([zoneId, v]) => ({
      zoneId,
      avgOccupancy: v.samples > 0 ? v.sum / v.samples : null,
      peakOccupancy: v.best.peakOccupancy,
      peakAt: v.best.peakAt,
    }));
}
```

Run: `npx jest src/modules/campus-dashboard/utils/merge-zone-heatmap.util.spec.ts` → PASS.

- [ ] **Step 4: Thay test service (sẽ fail)** — ghi đè `zone-traffic-heatmap.service.spec.ts`

```ts
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { KpiReadWindowService } from '../../kpi-rollup/services/kpi-read-window.service.js';
import { ZoneTrafficHeatmapService } from './zone-traffic-heatmap.service.js';

describe('ZoneTrafficHeatmapService (ZTH-001 / UC-120 + KPI-001)', () => {
  let service: ZoneTrafficHeatmapService;
  let repoMock: any;
  let dataSourceMock: any;
  let readWindowMock: any;

  const zone = (over: any = {}): any => ({
    id: 'zone-1',
    zoneName: 'Sảnh A',
    building: 'Tòa A',
    floor: '1',
    ...over,
  });

  const from = new Date('2026-07-01T00:00:00Z');
  const to = new Date('2026-07-02T00:00:00Z');
  const allRaw = { agg: null, raw: [{ from, to, toInclusive: true }] };

  beforeEach(async () => {
    repoMock = { loadZoneHierarchy: jest.fn().mockResolvedValue([]) };
    dataSourceMock = { query: jest.fn().mockResolvedValue([]) };
    readWindowMock = { resolve: jest.fn().mockResolvedValue(allRaw) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ZoneTrafficHeatmapService,
        { provide: CampusDashboardRepository, useValue: repoMock },
        { provide: DataSource, useValue: dataSourceMock },
        { provide: KpiReadWindowService, useValue: readWindowMock },
      ],
    }).compile();
    service = module.get(ZoneTrafficHeatmapService);
  });

  it('range >31 ngày → 400 INVALID_TRAFFIC_RANGE', async () => {
    await expect(service.getTraffic(from, new Date('2026-09-30T00:00:00Z'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it('không zone nào khớp filter → {series: [], heatmap: []}, KHÔNG query', async () => {
    expect(await service.getTraffic(from, to, 'Tòa X')).toEqual({ series: [], heatmap: [] });
    expect(dataSourceMock.query).not.toHaveBeenCalled();
  });

  it('toàn raw → 2 query (series, heatmap raw), KHÔNG đụng kpi_zone_hourly', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone()]);
    await service.getTraffic(from, to);
    expect(readWindowMock.resolve).toHaveBeenCalledWith('zone_hourly', from, to);
    expect(dataSourceMock.query).toHaveBeenCalledTimes(2);
    for (const [sql] of dataSourceMock.query.mock.calls) {
      expect(sql).not.toContain('kpi_zone_hourly');
    }
  });

  it('có phần agg → series UNION ALL kpi_zone_hourly + query heatmap agg riêng', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone()]);
    readWindowMock.resolve.mockResolvedValue({
      agg: { from: new Date('2026-07-01T01:00:00Z'), to: new Date('2026-07-01T23:00:00Z') },
      raw: [
        { from, to: new Date('2026-07-01T01:00:00Z'), toInclusive: false },
        { from: new Date('2026-07-01T23:00:00Z'), to, toInclusive: true },
      ],
    });
    await service.getTraffic(from, to);
    const sqls = dataSourceMock.query.mock.calls.map((c: any[]) => c[0] as string);
    expect(sqls[0]).toContain('UNION ALL');
    expect(sqls[0]).toContain('kpi_zone_hourly');
    expect(sqls.filter((s: string) => s.includes('kpi_zone_hourly'))).toHaveLength(2);
    expect(dataSourceMock.query).toHaveBeenCalledTimes(3);
  });

  it('relativeDensity: zone peak cao nhất = 1.0, zone thấp hơn đúng tỉ lệ', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone({ id: 'z1' }), zone({ id: 'z2' })]);
    dataSourceMock.query
      .mockResolvedValueOnce([]) // series
      .mockResolvedValueOnce([
        { zone_id: 'z1', event_count: '2', occupancy_sum: '20', sample_count: '2', peak_occupancy: 20, peak_at: null },
        { zone_id: 'z2', event_count: '2', occupancy_sum: '10', sample_count: '2', peak_occupancy: 10, peak_at: null },
      ]);
    const result = await service.getTraffic(from, to);
    const z1 = result.heatmap.find((h) => h.zoneId === 'z1')!;
    const z2 = result.heatmap.find((h) => h.zoneId === 'z2')!;
    expect(z1.relativeDensity).toBe(1);
    expect(z2.relativeDensity).toBe(0.5);
    expect(z1.avgOccupancy).toBe(10);
    expect(z1.coordinates).toBeNull();
  });

  it('tất cả peak=0 → relativeDensity=0 (không NaN)', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone({ id: 'z1' })]);
    dataSourceMock.query.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { zone_id: 'z1', event_count: '1', occupancy_sum: '0', sample_count: '1', peak_occupancy: 0, peak_at: null },
    ]);
    const result = await service.getTraffic(from, to);
    expect(result.heatmap[0].relativeDensity).toBe(0);
  });

  it('series: avg = sum/sample; sample=0 → avg 0, peak NULL → 0', async () => {
    repoMock.loadZoneHierarchy.mockResolvedValue([zone({ id: 'z1' })]);
    dataSourceMock.query
      .mockResolvedValueOnce([
        { zone_id: 'z1', hour_bucket: '2026-07-01T08:00:00.000Z', occupancy_sum: '25', sample_count: '2', peak_occupancy: 20 },
        { zone_id: 'z1', hour_bucket: '2026-07-01T09:00:00.000Z', occupancy_sum: '0', sample_count: '0', peak_occupancy: null },
      ])
      .mockResolvedValueOnce([]);
    const result = await service.getTraffic(from, to);
    expect(result.series).toEqual([
      { zoneId: 'z1', hourBucket: '2026-07-01T08:00:00.000Z', avgOccupancy: 12.5, peakOccupancy: 20 },
      { zoneId: 'z1', hourBucket: '2026-07-01T09:00:00.000Z', avgOccupancy: 0, peakOccupancy: 0 },
    ]);
  });
});
```

Run: `npx jest src/modules/campus-dashboard/services/zone-traffic-heatmap.service.spec.ts`
Expected: FAIL (provider `KpiReadWindowService` chưa được inject / SQL cũ).

- [ ] **Step 5: Viết lại service** — `zone-traffic-heatmap.service.ts` (giữ header comment, cập nhật dòng mô tả "READ-ONLY, đọc lai aggregate + raw (KPI-001)")

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CampusDashboardRepository } from '../repositories/campus-dashboard.repository.js';
import { KpiReadWindowService } from '../../kpi-rollup/services/kpi-read-window.service.js';
import { rangeClause, SqlParams } from '../../kpi-rollup/utils/sql-params.util.js';
import type { ReadWindow } from '../../kpi-rollup/utils/kpi-window.types.js';
import {
  mergeZoneHeatmapParts,
  type ZoneHeatmapPart,
} from '../utils/merge-zone-heatmap.util.js';
import type {
  TrafficResponseDto,
  TrafficSeriesPointDto,
  ZoneHeatmapDto,
} from '../dto/zone-traffic-response.dto.js';

const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000; // 31 ngày (mirror ZonePresenceTimelineService)

interface SeriesRow {
  zone_id: string;
  hour_bucket: string | Date;
  occupancy_sum: string | number;
  sample_count: string | number;
  peak_occupancy: string | number | null;
}

interface HeatmapPartRow {
  zone_id: string;
  event_count: string | number;
  occupancy_sum: string | number | null;
  sample_count: string | number;
  peak_occupancy: string | number | null;
  peak_at: string | Date | null;
}

/**
 * ZoneTrafficHeatmapService (ZTH-001 / UC-120) — lưu lượng theo giờ (series) + mật độ tương
 * đối theo zone (heatmap). 100% READ-ONLY. KPI-001: giờ tròn đã rollup đọc `kpi_zone_hourly`,
 * mép + phần chưa rollup đọc raw `zone_presence_events` (IDX_zpe_count), rồi gộp.
 */
@Injectable()
export class ZoneTrafficHeatmapService {
  constructor(
    private readonly repo: CampusDashboardRepository,
    private readonly dataSource: DataSource,
    private readonly kpiReadWindow: KpiReadWindowService,
  ) {}

  async getTraffic(
    from: Date,
    to: Date,
    building?: string,
    floor?: string,
  ): Promise<TrafficResponseDto> {
    this.validateRange(from, to);

    const zones = await this.repo.loadZoneHierarchy({ building, floor });
    const zoneIds = zones.map((z) => z.id);
    if (zoneIds.length === 0) {
      return { series: [], heatmap: [] };
    }

    const window = await this.kpiReadWindow.resolve('zone_hourly', from, to);
    const [seriesRows, heatmapRows] = await Promise.all([
      this.querySeries(zoneIds, window),
      this.queryHeatmapParts(zoneIds, window),
    ]);

    const zoneById = new Map(zones.map((z) => [z.id, z]));
    const series: TrafficSeriesPointDto[] = seriesRows.map((row) => {
      const samples = Number(row.sample_count);
      return {
        zoneId: row.zone_id,
        hourBucket: new Date(row.hour_bucket).toISOString(),
        avgOccupancy: samples > 0 ? Number(row.occupancy_sum) / samples : 0,
        peakOccupancy: Number(row.peak_occupancy),
      };
    });

    const merged = mergeZoneHeatmapParts(heatmapRows.map((r) => this.toPart(r)));
    const maxPeak = Math.max(0, ...merged.map((r) => r.peakOccupancy ?? 0));

    const heatmap: ZoneHeatmapDto[] = merged.map((row) => {
      const zone = zoneById.get(row.zoneId);
      const peakOccupancy = row.peakOccupancy ?? 0;
      return {
        zoneId: row.zoneId,
        zoneName: zone?.zoneName ?? '',
        building: zone?.building ?? null,
        floor: zone?.floor ?? null,
        avgOccupancy: row.avgOccupancy ?? 0,
        peakOccupancy,
        peakAt: row.peakAt ? row.peakAt.toISOString() : null,
        relativeDensity: maxPeak === 0 ? 0 : peakOccupancy / maxPeak,
        coordinates: null, // BLOCKED — kế thừa UC-126 §2.1
      };
    });

    return { series, heatmap };
  }

  private toPart(r: HeatmapPartRow): ZoneHeatmapPart {
    return {
      zoneId: r.zone_id,
      eventCount: Number(r.event_count),
      occupancySum: Number(r.occupancy_sum ?? 0),
      sampleCount: Number(r.sample_count),
      peakOccupancy: r.peak_occupancy === null ? null : Number(r.peak_occupancy),
      peakAt: r.peak_at ? new Date(r.peak_at) : null,
    };
  }

  /** Mỗi (zone, giờ) đến từ đúng 1 nguồn (§5.1) ⇒ chỉ cần nối, không gộp. */
  private async querySeries(zoneIds: string[], window: ReadWindow): Promise<SeriesRow[]> {
    const p = new SqlParams();
    const zones = p.add(zoneIds);
    const parts: string[] = [];
    if (window.agg) {
      parts.push(`
        SELECT zone_id, bucket_hour AS hour_bucket, occupancy_sum, sample_count,
               occupancy_peak AS peak_occupancy
        FROM kpi_zone_hourly
        WHERE zone_id = ANY(${zones}::uuid[])
          AND bucket_hour >= ${p.add(window.agg.from)} AND bucket_hour < ${p.add(window.agg.to)}`);
    }
    parts.push(`
        SELECT zone_id, date_trunc('hour', event_time) AS hour_bucket,
               COALESCE(SUM(occupancy_count), 0) AS occupancy_sum,
               COUNT(occupancy_count) AS sample_count,
               MAX(occupancy_count) AS peak_occupancy
        FROM zone_presence_events
        WHERE zone_id = ANY(${zones}::uuid[])
          AND event_type = 'count'
          AND ${rangeClause('event_time', window.raw, p)}
        GROUP BY zone_id, hour_bucket`);
    const sql = `
      SELECT zone_id, hour_bucket, occupancy_sum, sample_count, peak_occupancy
      FROM (${parts.join('\n UNION ALL \n')}) t
      ORDER BY hour_bucket ASC, zone_id ASC`;
    return this.dataSource.query(sql, p.values);
  }

  /** Mỗi phần trả 1 dòng/zone: tổng cộng dồn + event thắng đỉnh của phần đó. */
  private async queryHeatmapParts(
    zoneIds: string[],
    window: ReadWindow,
  ): Promise<HeatmapPartRow[]> {
    const queries: Array<Promise<HeatmapPartRow[]>> = [];
    if (window.agg) {
      queries.push(
        this.dataSource.query(
          `SELECT DISTINCT ON (zone_id) zone_id,
                  SUM(event_count) OVER w AS event_count,
                  SUM(occupancy_sum) OVER w AS occupancy_sum,
                  SUM(sample_count) OVER w AS sample_count,
                  occupancy_peak AS peak_occupancy,
                  peak_at
           FROM kpi_zone_hourly
           WHERE zone_id = ANY($1::uuid[]) AND bucket_hour >= $2 AND bucket_hour < $3
           WINDOW w AS (PARTITION BY zone_id)
           ORDER BY zone_id, occupancy_peak DESC NULLS LAST, peak_at DESC`,
          [zoneIds, window.agg.from, window.agg.to],
        ),
      );
    }
    const p = new SqlParams();
    const zones = p.add(zoneIds);
    queries.push(
      this.dataSource.query(
        `SELECT DISTINCT ON (zone_id) zone_id,
                COUNT(*) OVER w AS event_count,
                SUM(occupancy_count) OVER w AS occupancy_sum,
                COUNT(occupancy_count) OVER w AS sample_count,
                occupancy_count AS peak_occupancy,
                event_time AS peak_at
         FROM zone_presence_events
         WHERE zone_id = ANY(${zones}::uuid[])
           AND event_type = 'count'
           AND ${rangeClause('event_time', window.raw, p)}
         WINDOW w AS (PARTITION BY zone_id)
         ORDER BY zone_id, occupancy_count DESC NULLS LAST, event_time DESC`,
        p.values,
      ),
    );
    return (await Promise.all(queries)).flat();
  }

  private validateRange(from: Date, to: Date): void {
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException({
        code: 'INVALID_TRAFFIC_RANGE',
        message: 'Khoảng thời gian tối đa 31 ngày',
      });
    }
  }
}
```

> Lưu ý: `peak_occupancy` trong dòng DISTINCT ON là occupancy của dòng thắng = MAX của phần đó (vì sắp `DESC NULLS LAST`), nên không cần `MAX() OVER`.

`campus-dashboard.module.ts` — thêm `import { KpiRollupModule } from '../kpi-rollup/kpi-rollup.module.js';` và `KpiRollupModule,` vào `imports` (sau `AuthModule,`).

- [ ] **Step 6: Chạy test**

Run: `npx jest src/modules/campus-dashboard`
Expected: PASS toàn bộ (gồm spec controller hiện có).

- [ ] **Step 7: Lint + checkpoint**

Run: `npx eslint src/modules/campus-dashboard`. Báo user. **Không commit.**

---

### Task 6: Vehicle stats đọc lai + bucket giờ VN

**Files:**
- Modify: `src/modules/gate-access/services/vehicle-traffic-stats.service.ts` (viết lại `getStats` và các helper; giữ `toSummaryDto`, `pivotSeries`)
- Modify: `src/modules/gate-access/services/vehicle-traffic-stats.service.spec.ts` (thay toàn bộ)
- Modify: `src/modules/gate-access/gate-access.module.ts` (`imports` thêm `KpiRollupModule`)

**Interfaces:**
- Consumes: `KpiReadWindowService.resolve('vehicle_hourly', from, to)`, `SqlParams`, `rangeClause`, `BUSINESS_TZ`, `ReadWindow`.
- Produces: `VehicleTrafficStatsService(dataSource: DataSource, kpiReadWindow: KpiReadWindowService)`; `getStats` trả đúng `VehicleTrafficStatsResponseDto` như cũ. Thứ tự gọi `manager.query`: summary → unique → series.

- [ ] **Step 1: Thay test (sẽ fail)** — ghi đè `vehicle-traffic-stats.service.spec.ts`

```ts
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
import { BadRequestException } from '@nestjs/common';
import { VehicleTrafficStatsService } from './vehicle-traffic-stats.service.js';

describe('VehicleTrafficStatsService (VTS-001 / UC-114 + KPI-001)', () => {
  let service: VehicleTrafficStatsService;
  let query: jest.Mock;
  let readWindow: any;
  const from = '2026-07-01T00:00:00Z';
  const to = '2026-07-31T23:59:59Z';
  const allRaw = {
    agg: null,
    raw: [{ from: new Date(from), to: new Date(to), toInclusive: true }],
  };
  const withAgg = {
    agg: { from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-07-31T23:00:00Z') },
    raw: [{ from: new Date('2026-07-31T23:00:00Z'), to: new Date(to), toInclusive: true }],
  };

  beforeEach(() => {
    query = jest.fn().mockResolvedValue([]);
    readWindow = { resolve: jest.fn().mockResolvedValue(allRaw) };
    service = new VehicleTrafficStatsService({ manager: { query } } as any, readWindow);
  });

  it('from > to → 400 INVALID_DATE_RANGE, KHÔNG query', async () => {
    await expect(
      service.getStats({ from: '2026-07-31T00:00:00Z', to: '2026-07-01T00:00:00Z' } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(query).not.toHaveBeenCalled();
  });

  it('resolve với vehicle_hourly + Date(from/to); 3 query summary → unique → series', async () => {
    await service.getStats({ from, to });
    expect(readWindow.resolve).toHaveBeenCalledWith('vehicle_hourly', new Date(from), new Date(to));
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls[1][0]).toContain('COUNT(DISTINCT plate)');
  });

  it('phần raw: event_type là điều kiện WHERE đầu tiên trong mọi query', async () => {
    await service.getStats({ from, to });
    for (const [sql] of query.mock.calls) {
      expect(sql).toMatch(/FROM iot_device_events\s+WHERE event_type = 'ivss_vehicle_event' AND/);
    }
  });

  it('toàn raw → KHÔNG đụng bảng kpi_*', async () => {
    await service.getStats({ from, to });
    for (const [sql] of query.mock.calls) expect(sql).not.toContain('kpi_vehicle');
  });

  it('có agg → summary/series đọc kpi_vehicle_hourly, unique đọc kpi_vehicle_plate_hourly', async () => {
    readWindow.resolve.mockResolvedValue(withAgg);
    await service.getStats({ from, to });
    expect(query.mock.calls[0][0]).toContain('kpi_vehicle_hourly');
    expect(query.mock.calls[1][0]).toContain('kpi_vehicle_plate_hourly');
    expect(query.mock.calls[2][0]).toContain('kpi_vehicle_hourly');
  });

  it('filter zoneId/vehicleType áp cho cả agg (cột) và raw (payload), giá trị bind tham số', async () => {
    readWindow.resolve.mockResolvedValue(withAgg);
    await service.getStats({ from, to, zoneId: 'z1', vehicleType: 'car' });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/vehicle_type = \$\d+/);
    expect(sql).toMatch(/payload_json->>'vehicleType' = \$\d+/);
    expect(sql).not.toContain("'car'");
    expect(params).toEqual(expect.arrayContaining(['z1', 'car']));
  });

  it('không filter → không có điều kiện zone_id/vehicleType', async () => {
    await service.getStats({ from, to });
    const sql = query.mock.calls[0][0] as string;
    expect(sql).not.toContain('zone_id =');
    expect(sql).not.toContain("payload_json->>'vehicleType' =");
  });

  it('bucket theo giờ VN (KPI-001 D9): hour / day', async () => {
    await service.getStats({ from, to, groupBy: 'hour' } as any);
    expect(query.mock.calls[2][0]).toContain(
      "to_char(event_time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:00')",
    );
    query.mockClear();
    await service.getStats({ from, to });
    expect(query.mock.calls[2][0]).toContain(
      "to_char(event_time AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')",
    );
  });

  it('không dữ liệu → summary toàn 0, series rỗng', async () => {
    const r = await service.getStats({ from, to });
    expect(r.summary).toEqual({
      total_events: 0,
      total_matched: 0,
      total_unmatched: 0,
      total_enter: 0,
      total_leave: 0,
      total_seen: 0,
      unique_vehicles: 0,
    });
    expect(r.series).toEqual([]);
  });

  it('map summary + unique + pivot series', async () => {
    query
      .mockResolvedValueOnce([
        { total: 100, matched: 80, unmatched: 20, enter_count: 45, leave_count: 40, seen_count: 15 },
      ])
      .mockResolvedValueOnce([{ unique_vehicles: 30 }])
      .mockResolvedValueOnce([
        { bucket: '2026-07-01', direction: 'enter', cnt: 5 },
        { bucket: '2026-07-02', direction: 'leave', cnt: 3 },
        { bucket: '2026-07-02', direction: 'seen', cnt: 1 },
      ]);
    const r = await service.getStats({ from, to });
    expect(r.summary).toEqual({
      total_events: 100,
      total_matched: 80,
      total_unmatched: 20,
      total_enter: 45,
      total_leave: 40,
      total_seen: 15,
      unique_vehicles: 30,
    });
    expect(r.series).toEqual([
      { bucket: '2026-07-01', enter: 5, leave: 0, seen: 0 },
      { bucket: '2026-07-02', enter: 0, leave: 3, seen: 1 },
    ]);
  });
});
```

Run: `npx jest src/modules/gate-access/services/vehicle-traffic-stats.service.spec.ts`
Expected: FAIL.

- [ ] **Step 2: Viết lại service** (giữ header comment, bổ sung dòng "KPI-001: đọc lai `kpi_vehicle_hourly`/`kpi_vehicle_plate_hourly` + raw; bucket theo giờ VN")

```ts
import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type {
  VehicleTrafficStatsQueryDto,
  TrafficStatsGroupBy,
} from '../dto/vehicle-traffic-stats-query.dto.js';
import { VehicleTrafficStatsResponseDto } from '../dto/vehicle-traffic-stats-response.dto.js';
import { VehicleTrafficStatsSummaryDto } from '../dto/vehicle-traffic-stats-summary.dto.js';
import { VehicleTrafficStatsBucketDto } from '../dto/vehicle-traffic-stats-bucket.dto.js';
import { KpiReadWindowService } from '../../kpi-rollup/services/kpi-read-window.service.js';
import { BUSINESS_TZ } from '../../kpi-rollup/kpi-rollup.constants.js';
import { rangeClause, SqlParams } from '../../kpi-rollup/utils/sql-params.util.js';
import type { ReadWindow } from '../../kpi-rollup/utils/kpi-window.types.js';

const VEHICLE_EVENT_TYPE = 'ivss_vehicle_event';

interface SummaryRow {
  total: number;
  matched: number;
  unmatched: number;
  enter_count: number;
  leave_count: number;
  seen_count: number;
  unique_vehicles?: number;
}

interface SeriesRow {
  bucket: string;
  direction: string | null;
  cnt: number;
}

/** Biểu thức cột theo nguồn — hằng trong code (SEC-03). */
interface SourceCols {
  zone: string;
  vehicleType: string;
  direction: string;
  matchState: string;
  plate: string;
  ts: string;
}
const AGG_COLS: SourceCols = {
  zone: 'zone_id',
  vehicleType: 'vehicle_type',
  direction: 'direction',
  matchState: 'match_state',
  plate: 'plate_number',
  ts: 'bucket_hour',
};
const RAW_COLS: SourceCols = {
  zone: 'zone_id',
  vehicleType: "payload_json->>'vehicleType'",
  direction: "payload_json->>'direction'",
  matchState: "payload_json->>'matchState'",
  plate: "payload_json->>'plateNumber'",
  ts: 'event_time',
};

/**
 * VehicleTrafficStatsService (VTS-001 / UC-114) — thống kê lưu lượng phương tiện.
 *
 * Nguồn: `iot_device_events WHERE event_type='ivss_vehicle_event'` — ĐÚNG PRE-2 SRS trích
 * dẫn "UC-ANPR-05" (sự kiện biển số thô), KHÔNG PHẢI `gate_access_logs`.
 * KPI-001: giờ tròn đã rollup đọc `kpi_vehicle_hourly` / `kpi_vehicle_plate_hourly`, mép +
 * phần chưa rollup đọc raw; bucket series theo giờ VN (trước đây theo UTC của session DB).
 *
 * DATA-02 (crux): phần raw luôn có `event_type = 'ivss_vehicle_event'` là điều kiện WHERE đầu tiên.
 * Vocabulary `direction` payload THẬT: `enter/leave/seen` (KHÔNG PHẢI `in/out`).
 */
@Injectable()
export class VehicleTrafficStatsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly kpiReadWindow: KpiReadWindowService,
  ) {}

  async getStats(
    query: VehicleTrafficStatsQueryDto,
  ): Promise<VehicleTrafficStatsResponseDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException({
        code: 'INVALID_DATE_RANGE',
        message: 'Khoảng thời gian không hợp lệ',
      });
    }

    const window = await this.kpiReadWindow.resolve('vehicle_hourly', from, to);
    const groupBy: TrafficStatsGroupBy = query.groupBy ?? 'day';

    const summaryRows: SummaryRow[] = await this.runUnion(query, window, (cols, w) =>
      `SELECT ${cols.direction} AS direction, ${cols.matchState} AS match_state, ${
        cols === AGG_COLS ? 'event_count' : 'COUNT(*)'
      } AS cnt ${w}${cols === RAW_COLS ? ' GROUP BY 1, 2' : ''}`,
      (u) => `SELECT
         COALESCE(SUM(cnt), 0)::int AS total,
         COALESCE(SUM(cnt) FILTER (WHERE match_state = 'matched'), 0)::int AS matched,
         COALESCE(SUM(cnt) FILTER (WHERE match_state = 'unmatched'), 0)::int AS unmatched,
         COALESCE(SUM(cnt) FILTER (WHERE direction = 'enter'), 0)::int AS enter_count,
         COALESCE(SUM(cnt) FILTER (WHERE direction = 'leave'), 0)::int AS leave_count,
         COALESCE(SUM(cnt) FILTER (WHERE direction = 'seen'), 0)::int AS seen_count
       FROM (${u}) t`,
      'kpi_vehicle_hourly',
    );

    const uniqueRows: Array<{ unique_vehicles: number }> = await this.runUnion(
      query,
      window,
      (cols, w) => `SELECT ${cols.plate} AS plate ${w}`,
      (u) => `SELECT COUNT(DISTINCT plate)::int AS unique_vehicles FROM (${u}) t`,
      'kpi_vehicle_plate_hourly',
    );

    const seriesRows: SeriesRow[] = await this.runUnion(
      query,
      window,
      (cols, w) =>
        `SELECT ${this.bucketExpr(groupBy, cols.ts)} AS bucket, ${cols.direction} AS direction, ${
          cols === AGG_COLS ? 'event_count' : 'COUNT(*)'
        } AS cnt ${w}${cols === RAW_COLS ? ' GROUP BY 1, 2' : ''}`,
      (u) => `SELECT bucket, direction, SUM(cnt)::int AS cnt FROM (${u}) t
              GROUP BY bucket, direction ORDER BY bucket ASC`,
      'kpi_vehicle_hourly',
    );

    return {
      summary: this.toSummaryDto(summaryRows[0], uniqueRows[0]?.unique_vehicles),
      series: this.pivotSeries(seriesRows),
    };
  }

  /**
   * Ghép `UNION ALL` giữa phần aggregate (nếu có) và phần raw. `select(cols, fromWhere)` dựng
   * SELECT của 1 nguồn; `wrap(union)` dựng query ngoài.
   */
  private runUnion<T>(
    query: VehicleTrafficStatsQueryDto,
    window: ReadWindow,
    select: (cols: SourceCols, fromWhere: string) => string,
    wrap: (union: string) => string,
    aggTable: 'kpi_vehicle_hourly' | 'kpi_vehicle_plate_hourly',
  ): Promise<T[]> {
    const p = new SqlParams();
    const parts: string[] = [];
    if (window.agg) {
      const where =
        `FROM ${aggTable} WHERE bucket_hour >= ${p.add(window.agg.from)}` +
        ` AND bucket_hour < ${p.add(window.agg.to)}` +
        this.filterSql(query, p, AGG_COLS);
      parts.push(select(AGG_COLS, where));
    }
    const rawWhere =
      `FROM iot_device_events WHERE event_type = '${VEHICLE_EVENT_TYPE}'` +
      ` AND ${rangeClause('event_time', window.raw, p)}` +
      this.filterSql(query, p, RAW_COLS);
    parts.push(select(RAW_COLS, rawWhere));
    return this.dataSource.manager.query(wrap(parts.join('\n UNION ALL \n')), p.values);
  }

  /** Filter động, bind tham số nối tiếp (SEC-03). */
  private filterSql(query: VehicleTrafficStatsQueryDto, p: SqlParams, cols: SourceCols): string {
    let sql = '';
    if (query.zoneId) sql += ` AND ${cols.zone} = ${p.add(query.zoneId)}`;
    if (query.vehicleType) sql += ` AND ${cols.vehicleType} = ${p.add(query.vehicleType)}`;
    return sql;
  }

  /** CHỈ 2 nhánh cố định — KHÔNG nội suy giá trị query param vào biểu thức SQL (SEC-03). */
  private bucketExpr(groupBy: TrafficStatsGroupBy, tsColumn: string): string {
    const fmt = groupBy === 'hour' ? 'YYYY-MM-DD HH24:00' : 'YYYY-MM-DD';
    return `to_char(${tsColumn} AT TIME ZONE '${BUSINESS_TZ}', '${fmt}')`;
  }

  private toSummaryDto(row?: SummaryRow, uniqueVehicles?: number): VehicleTrafficStatsSummaryDto {
    return {
      total_events: row?.total ?? 0,
      total_matched: row?.matched ?? 0,
      total_unmatched: row?.unmatched ?? 0,
      total_enter: row?.enter_count ?? 0,
      total_leave: row?.leave_count ?? 0,
      total_seen: row?.seen_count ?? 0,
      unique_vehicles: uniqueVehicles ?? 0,
    };
  }

  // pivotSeries(): GIỮ NGUYÊN như hiện tại.
}
```

> `pivotSeries` giữ nguyên code hiện có (không sửa). Xoá `buildWhere` cũ (thay bằng `runUnion` + `filterSql`).

`gate-access.module.ts` — `imports: [TypeOrmModule.forFeature([GateAccessLogEntity]), AuthModule, KpiRollupModule]` + import `../kpi-rollup/kpi-rollup.module.js`.

- [ ] **Step 3: Chạy test gate-access + reports (consumer `VehicleReportDataService`)**

Run: `npx jest src/modules/gate-access src/modules/reports`
Expected: PASS. Nếu spec của `vehicle-report-data.service` khởi tạo `new VehicleTrafficStatsService(...)` trực tiếp → bổ sung tham số thứ 2 `{ resolve: jest.fn().mockResolvedValue({ agg: null, raw: [...] }) }`; nếu spec đó mock cả service thì không cần sửa.

- [ ] **Step 4: Build + lint + checkpoint**

Run: `npm run build && npx eslint src/modules/gate-access`
Báo user. **Không commit.**

---

### Task 7: Gắn 2 cron vào scheduler

**Files:**
- Modify: `src/modules/scheduler/scheduler.service.ts` (import, field cờ, inject, 2 method, dòng log khởi tạo)
- Modify: `src/modules/scheduler/scheduler.module.ts` (`imports` thêm `KpiRollupModule`)
- Modify: `src/modules/scheduler/scheduler.service.spec.ts`

**Interfaces:**
- Consumes: `KpiRollupJobService.runIncremental()`, `.runReconcile()`, `RollupRunResult`.
- Produces: `SchedulerService.kpiRollupHourly(): Promise<void>`, `SchedulerService.kpiRollupReconcile(): Promise<void>`.

- [ ] **Step 1: Thêm test (sẽ fail)** — trong `scheduler.service.spec.ts`:
  - thêm `import { KpiRollupJobService } from '../kpi-rollup/services/kpi-rollup-job.service.js';`
  - khai báo `let kpiRollupMock: any;`
  - trong `build()` trước `Test.createTestingModule`:
    ```ts
    kpiRollupMock = {
      runIncremental: jest.fn(async () => ({ skipped: false, windows: {} })),
      runReconcile: jest.fn(async () => ({ skipped: false, windows: {} })),
    };
    ```
  - thêm provider `{ provide: KpiRollupJobService, useValue: kpiRollupMock },`
  - thêm các test cuối `describe`:

```ts
  // ── KPI-001 kpi-rollup cron ──
  it('kpiRollupHourly gate OFF (default) → KHÔNG gọi runIncremental', async () => {
    cfg = { SCHEDULER_ENABLED: true };
    const s = await build();
    await s.kpiRollupHourly();
    expect(kpiRollupMock.runIncremental).not.toHaveBeenCalled();
  });

  it('kpiRollupHourly ON → gọi runIncremental 1 lần', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_KPI_ROLLUP_ENABLED: true };
    const s = await build();
    await s.kpiRollupHourly();
    expect(kpiRollupMock.runIncremental).toHaveBeenCalledTimes(1);
  });

  it('kpiRollupHourly: throw → KHÔNG ném ra cron (ARCH-02)', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_KPI_ROLLUP_ENABLED: true };
    const s = await build();
    kpiRollupMock.runIncremental.mockRejectedValueOnce(new Error('boom'));
    await expect(s.kpiRollupHourly()).resolves.toBeUndefined();
  });

  it('kpiRollupReconcile ON → gọi runReconcile; SCHEDULER_ENABLED=false → không gọi', async () => {
    cfg = { SCHEDULER_ENABLED: true, SCHEDULER_KPI_ROLLUP_ENABLED: true };
    let s = await build();
    await s.kpiRollupReconcile();
    expect(kpiRollupMock.runReconcile).toHaveBeenCalledTimes(1);
    cfg = { SCHEDULER_ENABLED: false, SCHEDULER_KPI_ROLLUP_ENABLED: true };
    s = await build();
    await s.kpiRollupReconcile();
    expect(kpiRollupMock.runReconcile).not.toHaveBeenCalled();
  });

  it('kpi cron: lịch phút 05 mỗi giờ + 01:00 theo giờ VN', () => {
    const src = readFileSync(join(__dirname, 'scheduler.service.ts'), 'utf8');
    expect(src).toContain(`@Cron('0 5 * * * *', { name: 'kpi-rollup-hourly' })`);
    expect(src).toMatch(
      /@Cron\('0 0 1 \* \* \*', \{\s*name: 'kpi-rollup-reconcile',\s*timeZone: 'Asia\/Ho_Chi_Minh',?\s*\}\)/,
    );
  });
```

Run: `npx jest src/modules/scheduler`
Expected: FAIL (`kpiRollupHourly is not a function` / provider lạ).

- [ ] **Step 2: Sửa scheduler**

`scheduler.service.ts`:
- import: `import { KpiRollupJobService, type RollupRunResult } from '../kpi-rollup/services/kpi-rollup-job.service.js';`
- field cạnh các cờ khác: `private readonly kpiRollupEnabled: boolean;`
- constructor: thêm tham số cuối `private readonly kpiRollupJobService: KpiRollupJobService,`
- trong constructor, sau khối `recordingMaxDurationEnabled`:
```ts
    // KPI-001 (#10): rollup KPI theo giờ + đối soát 01:00 (default OFF).
    this.kpiRollupEnabled = this.configService.get<boolean>(
      'SCHEDULER_KPI_ROLLUP_ENABLED',
      false,
    );
```
- dòng log khởi tạo: nối thêm ` | kpi-rollup=${this.kpiRollupEnabled}` vào cuối template.
- thêm 2 method trước `checkCheckinAlerts`:
```ts
  /**
   * KPI-001 (task #10) — rollup bảng tổng hợp zone/xe theo giờ (phút 05 mỗi giờ).
   * Gate SCHEDULER_ENABLED && SCHEDULER_KPI_ROLLUP_ENABLED. Advisory lock trong job ⇒ nhiều
   * instance chỉ 1 bản chạy. KHÔNG ném ra cron (ARCH-02).
   */
  @Cron('0 5 * * * *', { name: 'kpi-rollup-hourly' })
  async kpiRollupHourly(): Promise<void> {
    if (!this.schedulerEnabled || !this.kpiRollupEnabled) return;
    try {
      const r = await this.kpiRollupJobService.runIncremental();
      this.logger.log(`[Scheduler] kpi-rollup-hourly: ${this.describeKpiRun(r)}`);
    } catch (e) {
      this.logger.error(
        `[Scheduler] kpi-rollup-hourly failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  /** KPI-001 — đối soát 72h gần nhất lúc 01:00 giờ VN (bắt event đến muộn). */
  @Cron('0 0 1 * * *', {
    name: 'kpi-rollup-reconcile',
    timeZone: 'Asia/Ho_Chi_Minh',
  })
  async kpiRollupReconcile(): Promise<void> {
    if (!this.schedulerEnabled || !this.kpiRollupEnabled) return;
    try {
      const r = await this.kpiRollupJobService.runReconcile();
      this.logger.log(`[Scheduler] kpi-rollup-reconcile: ${this.describeKpiRun(r)}`);
    } catch (e) {
      this.logger.error(
        `[Scheduler] kpi-rollup-reconcile failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }

  private describeKpiRun(r: RollupRunResult): string {
    if (r.skipped) return 'skipped (đang chạy ở instance khác)';
    const parts = Object.entries(r.windows).map(
      ([name, w]) => `${name}=[${w.from.toISOString()}, ${w.to.toISOString()})`,
    );
    return parts.length ? parts.join(' ') : 'không có cửa sổ mới';
  }
```

`scheduler.module.ts`: import `KpiRollupModule` từ `../kpi-rollup/kpi-rollup.module.js`, thêm vào `imports` kèm comment:
```ts
    // KPI-001: cron kpi-rollup inject KpiRollupJobService. Cạnh scheduler → kpi-rollup MỘT
    // CHIỀU (kpi-rollup không import module nghiệp vụ nào) ⇒ không circular.
    KpiRollupModule,
```

- [ ] **Step 3: Chạy test + build**

Run: `npx jest src/modules/scheduler && npm run build`
Expected: PASS; build OK. (Nếu prettier đổi xuống dòng decorator khiến regex Step 1 không khớp, giữ đúng format như Step 2 và chạy lại.)

- [ ] **Step 4: Checkpoint** — báo user. **Không commit.**

---

### Task 8: Script backfill

**Files:**
- Create: `scripts/kpi-backfill.ts`

**Interfaces:**
- Consumes: `KpiRollupJobService` (khởi tạo tay), `KpiWatermarkRepository`, `ZoneHourlyRollupService`, `VehicleHourlyRollupService`, `planBackfillChunks`, `floorHour`, `ROLLUP_NAMES`, `RollupName`.
- Produces: lệnh `npx tsx scripts/kpi-backfill.ts [--from=ISO] [--to=ISO] [--only=zone_hourly|vehicle_hourly]`.

- [ ] **Step 1: Viết script**

```ts
import { AppDataSource } from '../src/database/data-source.js';
import { ROLLUP_NAMES, type RollupName } from '../src/modules/kpi-rollup/kpi-rollup.constants.js';
import { KpiWatermarkRepository } from '../src/modules/kpi-rollup/repositories/kpi-watermark.repository.js';
import { ZoneHourlyRollupService } from '../src/modules/kpi-rollup/services/zone-hourly-rollup.service.js';
import { VehicleHourlyRollupService } from '../src/modules/kpi-rollup/services/vehicle-hourly-rollup.service.js';
import { KpiRollupJobService } from '../src/modules/kpi-rollup/services/kpi-rollup-job.service.js';
import { floorHour } from '../src/modules/kpi-rollup/utils/hour.util.js';
import { planBackfillChunks } from '../src/modules/kpi-rollup/utils/rollup-window.util.js';

/**
 * KPI-001 — nạp lịch sử cho bảng tổng hợp. Lùi từng ngày từ `--to` (mặc định covered_from
 * hiện tại, hoặc giờ tròn hiện tại nếu chưa có watermark) về `--from` (mặc định event raw
 * sớm nhất). Mỗi ngày 1 transaction, idempotent — chạy lại an toàn.
 * Thực thi: npx tsx scripts/kpi-backfill.ts [--from=ISO] [--to=ISO] [--only=zone_hourly|vehicle_hourly]
 */
const SOURCE_MIN_SQL: Record<RollupName, string> = {
  zone_hourly: `SELECT MIN(event_time) AS t FROM zone_presence_events WHERE event_type = 'count'`,
  vehicle_hourly: `SELECT MIN(event_time) AS t FROM iot_device_events WHERE event_type = 'ivss_vehicle_event'`,
};

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
}

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const watermarkRepo = new KpiWatermarkRepository(AppDataSource);
  const job = new KpiRollupJobService(
    AppDataSource,
    watermarkRepo,
    new ZoneHourlyRollupService(),
    new VehicleHourlyRollupService(),
  );
  const only = arg('only') as RollupName | undefined;
  const names = only ? [only] : ROLLUP_NAMES;
  try {
    for (const name of names) {
      const wm = await watermarkRepo.get(name);
      const to = arg('to') ? floorHour(new Date(arg('to')!)) : (wm?.coveredFrom ?? floorHour(new Date()));
      const [row] = (await AppDataSource.query(SOURCE_MIN_SQL[name])) as Array<{ t: Date | null }>;
      const fromArg = arg('from');
      const from = fromArg ? new Date(fromArg) : row?.t ? new Date(row.t) : null;
      if (!from || from.getTime() >= to.getTime()) {
        console.log(`• ${name}: không có gì để backfill`);
        continue;
      }
      const chunks = planBackfillChunks(from, to);
      console.log(`• ${name}: ${chunks.length} ngày [${floorHour(from).toISOString()} → ${to.toISOString()})`);
      for (const [i, c] of chunks.entries()) {
        await job.runRange(name, c.from, c.to);
        console.log(`  ${i + 1}/${chunks.length} ✓ [${c.from.toISOString()}, ${c.to.toISOString()})`);
      }
    }
    console.log('✅ Backfill KPI xong.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Chạy thử trên DB dev**

Run: `npx tsx scripts/kpi-backfill.ts`
Expected: DB dev chưa có event ⇒ in `• zone_hourly: không có gì để backfill` và `• vehicle_hourly: ...`, rồi `✅ Backfill KPI xong.` (không lỗi).

Run: `npx tsx scripts/kpi-backfill.ts --only=zone_hourly --from=2026-10-01T00:00:00Z --to=2026-10-03T00:00:00Z && docker exec capstone-postgres psql -U postgres -d capstone_db -c "select * from kpi_rollup_watermarks"`
Expected: 2 chunk ✓; watermark `zone_hourly` = `[2026-10-01 00:00+00, 2026-10-03 00:00+00)`. Chạy lại lệnh → vẫn ✓ (idempotent).

- [ ] **Step 3: Dọn watermark thử** (để hourly job sau này bắt đầu sạch)

Run: `docker exec capstone-postgres psql -U postgres -d capstone_db -c "delete from kpi_rollup_watermarks"`

- [ ] **Step 4: Lint + checkpoint**

Run: `npx eslint scripts/kpi-backfill.ts`. Báo user. **Không commit.**

---

### Task 9: Test so khớp hybrid vs raw (T5/T8) + EXPLAIN + cập nhật tài liệu

**Files:**
- Test: `test/kpi-rollup/kpi-rollup-equivalence.e2e-spec.ts`
- Modify: `docs/CAM_AI_GAP_ANALYSIS_300_CAMERAS.md` (changelog + dòng #10 + ghi chú lỗi FE)
- Modify: `spec/features/analytics/feat-kpi-rollup/spec.md` (changelog: trạng thái đã implement)

**Interfaces:**
- Consumes: fixtures Task 3; `ZoneTrafficHeatmapService(repo, dataSource, readWindow)`; `VehicleTrafficStatsService(dataSource, readWindow)`; `splitReadWindow`.
- Produces: —

- [ ] **Step 1: Viết test so khớp**

```ts
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { AppDataSource } from '../../src/database/data-source';
import { ZoneTrafficHeatmapService } from '../../src/modules/campus-dashboard/services/zone-traffic-heatmap.service';
import { VehicleTrafficStatsService } from '../../src/modules/gate-access/services/vehicle-traffic-stats.service';
import { splitReadWindow } from '../../src/modules/kpi-rollup/utils/split-read-window.util';
import {
  BASE,
  HOURS,
  cleanupKpiFixture,
  hoursAfter,
  rollupAll,
  seedKpiFixture,
  type KpiFixture,
} from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

const WM = { coveredFrom: BASE, coveredUntil: hoursAfter(HOURS) };
const hybridWindow: any = { resolve: async (_n: string, f: Date, t: Date) => splitReadWindow(f, t, WM, true) };
const rawWindow: any = { resolve: async (_n: string, f: Date, t: Date) => splitReadWindow(f, t, null, false) };

/** Các cặp [from, to] (giờ, tính từ BASE): lẻ phút, giờ tròn, trong 1 giờ, vượt watermark, điểm. */
const CASES: Array<[number, number]> = [
  [0.2833, 50.7167], // 00:17 → 50:43
  [3, 9], // giờ tròn, to = 09:00 có event đúng biên (Review Focus #2)
  [2.1667, 2.8333], // trong cùng 1 giờ
  [-1, 73], // vượt cả 2 đầu watermark
  [10, 10], // điểm
  [2.25, 21], // biển 29A-999 ở mép raw (02:30) + phần agg (20:00) (Review Focus #4)
];

/** Query raw NGUYÊN BẢN trước KPI-001 (copy từ zone-traffic-heatmap.service.ts cũ). */
async function legacyHeatmap(zoneIds: string[], from: Date, to: Date): Promise<any[]> {
  return AppDataSource.query(
    `SELECT zone_id, AVG(occupancy_count) AS avg_occupancy, MAX(occupancy_count) AS peak_occupancy,
       (SELECT event_time FROM zone_presence_events e2
         WHERE e2.zone_id = e1.zone_id AND e2.event_type = 'count' AND e2.event_time BETWEEN $2 AND $3
         ORDER BY e2.occupancy_count DESC NULLS LAST, e2.event_time DESC LIMIT 1) AS peak_at
     FROM zone_presence_events e1
     WHERE zone_id = ANY($1::uuid[]) AND event_type = 'count' AND event_time BETWEEN $2 AND $3
     GROUP BY zone_id ORDER BY zone_id`,
    [zoneIds, from, to],
  );
}

/** Summary NGUYÊN BẢN trước KPI-001 (copy từ vehicle-traffic-stats.service.ts cũ). */
async function legacyVehicleSummary(from: Date, to: Date, vehicleType?: string): Promise<any> {
  const params: unknown[] = [from, to];
  let where = `event_type = 'ivss_vehicle_event' AND event_time >= $1 AND event_time <= $2`;
  if (vehicleType) {
    params.push(vehicleType);
    where += ` AND payload_json->>'vehicleType' = $3`;
  }
  const [r] = await AppDataSource.query(
    `SELECT COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE payload_json->>'matchState' = 'matched')::int AS matched,
       COUNT(*) FILTER (WHERE payload_json->>'matchState' = 'unmatched')::int AS unmatched,
       COUNT(*) FILTER (WHERE payload_json->>'direction' = 'enter')::int AS enter_count,
       COUNT(*) FILTER (WHERE payload_json->>'direction' = 'leave')::int AS leave_count,
       COUNT(*) FILTER (WHERE payload_json->>'direction' = 'seen')::int AS seen_count,
       COUNT(DISTINCT payload_json->>'plateNumber')::int AS unique_vehicles
     FROM iot_device_events WHERE ${where}`,
    params,
  );
  return {
    total_events: r.total,
    total_matched: r.matched,
    total_unmatched: r.unmatched,
    total_enter: r.enter_count,
    total_leave: r.leave_count,
    total_seen: r.seen_count,
    unique_vehicles: r.unique_vehicles,
  };
}

describeDb('KPI-001 so khớp đọc lai vs raw (T5, T8)', () => {
  let f: KpiFixture;
  let zones: any[];
  const zoneSvc = (w: any): ZoneTrafficHeatmapService =>
    new ZoneTrafficHeatmapService({ loadZoneHierarchy: async () => zones } as any, AppDataSource, w);
  const vehSvc = (w: any): VehicleTrafficStatsService => new VehicleTrafficStatsService(AppDataSource, w);

  const expectSameTraffic = (a: any, b: any): void => {
    expect(b.series.map((s: any) => [s.zoneId, s.hourBucket, s.peakOccupancy])).toEqual(
      a.series.map((s: any) => [s.zoneId, s.hourBucket, s.peakOccupancy]),
    );
    a.series.forEach((s: any, i: number) => expect(b.series[i].avgOccupancy).toBeCloseTo(s.avgOccupancy, 9));
    const sortH = (h: any[]): any[] => [...h].sort((x, y) => (x.zoneId < y.zoneId ? -1 : 1));
    const ha = sortH(a.heatmap);
    const hb = sortH(b.heatmap);
    expect(hb.map((h: any) => [h.zoneId, h.peakOccupancy, h.peakAt, h.relativeDensity])).toEqual(
      ha.map((h: any) => [h.zoneId, h.peakOccupancy, h.peakAt, h.relativeDensity]),
    );
    ha.forEach((h: any, i: number) => expect(hb[i].avgOccupancy).toBeCloseTo(h.avgOccupancy, 9));
  };

  beforeAll(async () => {
    await AppDataSource.initialize();
    f = await seedKpiFixture(AppDataSource);
    zones = f.zoneIds.map((id, i) => ({ id, zoneName: `KPI Zone ${'ABC'[i]}`, building: 'Tòa KPI', floor: '1' }));
    await rollupAll(AppDataSource, BASE, hoursAfter(HOURS));
  });

  afterAll(async () => {
    await cleanupKpiFixture(AppDataSource, f);
    await AppDataSource.destroy();
  });

  it.each(CASES)('zone traffic [%s h, %s h]: hybrid = raw = query cũ', async (a, b) => {
    const from = hoursAfter(a);
    const to = hoursAfter(b);
    const hybrid = await zoneSvc(hybridWindow).getTraffic(from, to);
    const raw = await zoneSvc(rawWindow).getTraffic(from, to);
    expectSameTraffic(raw, hybrid);

    const legacy = await legacyHeatmap(f.zoneIds, from, to);
    expect(raw.heatmap.map((h: any) => h.zoneId).sort()).toEqual(legacy.map((l: any) => l.zone_id));
    for (const l of legacy) {
      const h = raw.heatmap.find((x: any) => x.zoneId === l.zone_id)!;
      expect(h.avgOccupancy).toBeCloseTo(Number(l.avg_occupancy) || 0, 9);
      expect(h.peakOccupancy).toBe(Number(l.peak_occupancy) || 0);
      expect(h.peakAt).toBe(l.peak_at ? new Date(l.peak_at).toISOString() : null);
    }
  });

  it.each(CASES)('vehicle stats [%s h, %s h]: hybrid = raw; summary = query cũ', async (a, b) => {
    const from = hoursAfter(a).toISOString();
    const to = hoursAfter(b).toISOString();
    for (const vehicleType of [undefined, 'car']) {
      for (const groupBy of ['hour', 'day'] as const) {
        const q = { from, to, vehicleType, groupBy };
        const hybrid = await vehSvc(hybridWindow).getStats(q);
        const raw = await vehSvc(rawWindow).getStats(q);
        expect(hybrid).toEqual(raw);
      }
      const raw = await vehSvc(rawWindow).getStats({ from, to, vehicleType });
      expect(raw.summary).toEqual(await legacyVehicleSummary(new Date(from), new Date(to), vehicleType));
    }
  });

  it('bucket xe theo giờ VN: event trong giờ 00:xx UTC ngày 01/01 → bucket "2001-01-01 07:00"', async () => {
    const r = await vehSvc(rawWindow).getStats({
      from: hoursAfter(0).toISOString(),
      to: hoursAfter(0.99).toISOString(), // không chạm 01:00 UTC (= 08:00 VN)
      groupBy: 'hour',
    });
    for (const s of r.series) expect(s.bucket).toBe('2001-01-01 07:00');
  });

  it('T8 — event đến muộn: lệch trước khi rollup lại, khớp sau khi rollup lại', async () => {
    await AppDataSource.query(
      `INSERT INTO zone_presence_events (zone_id, device_id, event_type, event_time, occupancy_count, source_type)
       VALUES ($1, $2, 'count', $3, 99, 'kpitest')`,
      [f.zoneIds[1], f.deviceId, hoursAfter(30.25)],
    );
    const from = hoursAfter(24);
    const to = hoursAfter(48);
    const before = await zoneSvc(hybridWindow).getTraffic(from, to);
    const raw = await zoneSvc(rawWindow).getTraffic(from, to);
    expect(before.heatmap.find((h: any) => h.zoneId === f.zoneIds[1])!.peakOccupancy).not.toBe(99);
    expect(raw.heatmap.find((h: any) => h.zoneId === f.zoneIds[1])!.peakOccupancy).toBe(99);

    await rollupAll(AppDataSource, hoursAfter(24), hoursAfter(48));
    expectSameTraffic(raw, await zoneSvc(hybridWindow).getTraffic(from, to));
  });
});
```

- [ ] **Step 2: Chạy toàn bộ test DB**

Run: `RUN_DB_TESTS=1 npx jest --config test/jest-e2e.json test/kpi-rollup --runInBand`
Expected: PASS toàn bộ. Nếu case nào lệch → **dừng**, không chỉnh test cho khớp; tìm lỗi ở rollup/merge (đây là cổng chặn G1).

- [ ] **Step 3: EXPLAIN — phần raw xe dùng index**

Run:
```bash
docker exec capstone-postgres psql -U postgres -d capstone_db -c "SET enable_seqscan = off; EXPLAIN SELECT COUNT(*) FROM iot_device_events WHERE event_type = 'ivss_vehicle_event' AND event_time >= now() - interval '2 hours' AND event_time <= now();"
```
Expected: plan có `IDX_iot_device_events_vehicle_time` (Index/Bitmap Index Scan).

- [ ] **Step 4: Toàn bộ unit test + build + lint các file đã đụng (T9/T10)**

Run: `npx jest && npm run build && npx eslint src/modules/kpi-rollup src/modules/campus-dashboard src/modules/gate-access src/modules/scheduler test/kpi-rollup scripts/kpi-backfill.ts`
Expected: tất cả PASS / không lỗi. Ghi lại nếu có test cũ ngoài phạm vi vốn đã fail trước thay đổi (kiểm tra bằng `git stash` không được dùng — chỉ báo cáo user).

- [ ] **Step 5: Cập nhật tài liệu**

`docs/CAM_AI_GAP_ANALYSIS_300_CAMERAS.md`:
- Thêm dòng changelog:
```
| 2026-10-07 | #10 KPI-001 hoàn thành giai đoạn 1 (LamNH tiếp quản): bảng tổng hợp theo giờ zone/xe, cron hourly + reconcile 01:00, đọc lai, bucket xe theo giờ VN. Ghi nhận lỗi FE dashboard đọc sai field vehicle stats. | Bảng 3.1 #10, mục 5.8 |
```
- Dòng #10 bảng 3.1: trạng thái `✅ (GĐ1)`; cột hiện trạng: `KPI-001 (LamNH): kpi_zone_hourly, kpi_vehicle_hourly, kpi_vehicle_plate_hourly + watermark; cron kpi-rollup-hourly / kpi-rollup-reconcile; zone traffic & vehicle stats đọc lai. Spec: spec/features/analytics/feat-kpi-rollup/.`; cột còn thiếu: `GĐ2: kpi_meeting_daily cho analytics/*, security alert daily.`
- Mục 5.8 FE thêm gạch đầu dòng: `systemAdmin/dashBoard.jsx:561` & `bussinessAdmin/dashBoard.jsx:416` đọc `data.buckets[].period/total_enter` trong khi BE trả `series[].bucket/enter/leave` ⇒ biểu đồ lưu lượng xe luôn rỗng.

`spec.md` — thêm dòng changelog `| <ngày> | Đã implement theo plan.md; T1–T10 pass. | — |`.

- [ ] **Step 6: Checkpoint cuối** — báo user tổng kết (test, build, thay đổi hành vi bucket xe, env cần bật `SCHEDULER_KPI_ROLLUP_ENABLED=true` + chạy backfill khi deploy). **Không commit** — chờ user yêu cầu.
