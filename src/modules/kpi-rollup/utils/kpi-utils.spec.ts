import { addHours, ceilHour, floorHour } from './hour.util.js';
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
    expect(floorHour(T('2026-10-05T08:00:00Z'))).toEqual(
      T('2026-10-05T08:00:00Z'),
    );
    expect(ceilHour(T('2026-10-05T08:00:00Z'))).toEqual(
      T('2026-10-05T08:00:00Z'),
    );
    expect(floorHour(T('2026-10-05T08:59:59.999Z'))).toEqual(
      T('2026-10-05T08:00:00Z'),
    );
    expect(ceilHour(T('2026-10-05T08:00:00.001Z'))).toEqual(
      T('2026-10-05T09:00:00Z'),
    );
  });

  it('addHours: cộng/trừ đúng', () => {
    expect(addHours(T('2026-10-05T08:00:00Z'), -2)).toEqual(
      T('2026-10-05T06:00:00Z'),
    );
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
    const r = splitReadWindow(
      T('2026-10-02T08:17:00Z'),
      T('2026-10-02T12:43:00Z'),
      wm,
      true,
    );
    expect(r.agg).toEqual({
      from: T('2026-10-02T09:00:00Z'),
      to: T('2026-10-02T12:00:00Z'),
    });
    expect(r.raw).toEqual([
      {
        from: T('2026-10-02T08:17:00Z'),
        to: T('2026-10-02T09:00:00Z'),
        toInclusive: false,
      },
      {
        from: T('2026-10-02T12:00:00Z'),
        to: T('2026-10-02T12:43:00Z'),
        toInclusive: true,
      },
    ]);
  });

  it('from/to nằm trong cùng 1 giờ → toàn raw', () => {
    const f = T('2026-10-02T08:10:00Z');
    const t = T('2026-10-02T08:50:00Z');
    expect(splitReadWindow(f, t, wm, true)).toEqual(allRaw(f, t));
  });

  it('from, to đúng giờ tròn → không có mép đầu, mép cuối là điểm [to, to]', () => {
    const r = splitReadWindow(
      T('2026-10-02T08:00:00Z'),
      T('2026-10-02T12:00:00Z'),
      wm,
      true,
    );
    expect(r.agg).toEqual({
      from: T('2026-10-02T08:00:00Z'),
      to: T('2026-10-02T12:00:00Z'),
    });
    expect(r.raw).toEqual([
      {
        from: T('2026-10-02T12:00:00Z'),
        to: T('2026-10-02T12:00:00Z'),
        toInclusive: true,
      },
    ]);
  });

  it('to vượt covered_until → phần sau watermark đọc raw', () => {
    const r = splitReadWindow(
      T('2026-10-05T08:00:00Z'),
      T('2026-10-05T13:30:00Z'),
      wm,
      true,
    );
    expect(r.agg).toEqual({
      from: T('2026-10-05T08:00:00Z'),
      to: T('2026-10-05T10:00:00Z'),
    });
    expect(r.raw).toEqual([
      {
        from: T('2026-10-05T10:00:00Z'),
        to: T('2026-10-05T13:30:00Z'),
        toInclusive: true,
      },
    ]);
  });

  it('from trước covered_from → mép đầu raw kéo tới covered_from', () => {
    const r = splitReadWindow(
      T('2026-09-30T22:30:00Z'),
      T('2026-10-01T03:00:00Z'),
      wm,
      true,
    );
    expect(r.agg).toEqual({
      from: T('2026-10-01T00:00:00Z'),
      to: T('2026-10-01T03:00:00Z'),
    });
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
        const inAgg = r.agg
          ? t >= r.agg.from.getTime() && t < r.agg.to.getTime()
          : false;
        const inRaw = r.raw.filter(
          (x) =>
            t >= x.from.getTime() &&
            (x.toInclusive ? t <= x.to.getTime() : t < x.to.getTime()),
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
    expect(
      extendWatermark(
        null,
        T('2026-10-01T00:00:00Z'),
        T('2026-10-01T02:00:00Z'),
      ),
    ).toEqual({
      coveredFrom: T('2026-10-01T00:00:00Z'),
      coveredUntil: T('2026-10-01T02:00:00Z'),
    });
  });

  it('khoảng giao nhau → hợp lại', () => {
    expect(
      extendWatermark(wm, T('2026-10-01T22:00:00Z'), T('2026-10-02T03:00:00Z')),
    ).toEqual({
      coveredFrom: T('2026-10-01T00:00:00Z'),
      coveredUntil: T('2026-10-02T03:00:00Z'),
    });
  });

  it('khoảng chạm biên (until = covered_from) → hợp lại', () => {
    expect(
      extendWatermark(wm, T('2026-09-30T00:00:00Z'), T('2026-10-01T00:00:00Z')),
    ).toEqual({
      coveredFrom: T('2026-09-30T00:00:00Z'),
      coveredUntil: T('2026-10-02T00:00:00Z'),
    });
  });

  it('khoảng tạo lỗ hổng → KpiWatermarkGapError', () => {
    expect(() =>
      extendWatermark(wm, T('2026-10-03T00:00:00Z'), T('2026-10-04T00:00:00Z')),
    ).toThrow(KpiWatermarkGapError);
    expect(() =>
      extendWatermark(wm, T('2026-09-28T00:00:00Z'), T('2026-09-29T00:00:00Z')),
    ).toThrow(KpiWatermarkGapError);
  });

  it('from >= until → Error', () => {
    expect(() =>
      extendWatermark(
        null,
        T('2026-10-01T00:00:00Z'),
        T('2026-10-01T00:00:00Z'),
      ),
    ).toThrow();
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
    const wm = {
      coveredFrom: T('2026-10-01T00:00:00Z'),
      coveredUntil: T('2026-10-05T10:00:00Z'),
    };
    expect(incrementalWindow(wm, T('2026-10-05T11:05:00Z'))).toEqual({
      from: T('2026-10-05T08:00:00Z'),
      to: T('2026-10-05T11:00:00Z'),
    });
  });

  it('incremental: không lùi trước covered_from', () => {
    const wm = {
      coveredFrom: T('2026-10-05T10:00:00Z'),
      coveredUntil: T('2026-10-05T11:00:00Z'),
    };
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
    const wm = {
      coveredFrom: T('2026-09-01T00:00:00Z'),
      coveredUntil: T('2026-10-01T00:00:00Z'),
    };
    const now = T('2026-10-05T01:20:00Z');
    const inc = incrementalWindow(wm, now)!;
    const rec = reconcileWindow(wm, now)!;
    expect(inc).toEqual({
      from: T('2026-09-30T22:00:00Z'),
      to: T('2026-10-05T01:00:00Z'),
    });
    expect(rec).toEqual({
      from: T('2026-10-01T00:00:00Z'),
      to: T('2026-10-05T01:00:00Z'),
    });
    expect(() => extendWatermark(wm, inc.from, inc.to)).not.toThrow();
    expect(() => extendWatermark(wm, rec.from, rec.to)).not.toThrow();
  });

  it('planBackfillChunks: lùi từng 24h từ to, chunk cuối kẹp ở floorHour(from)', () => {
    expect(
      planBackfillChunks(T('2026-10-01T05:30:00Z'), T('2026-10-03T00:00:00Z')),
    ).toEqual([
      { from: T('2026-10-02T00:00:00Z'), to: T('2026-10-03T00:00:00Z') },
      { from: T('2026-10-01T05:00:00Z'), to: T('2026-10-02T00:00:00Z') },
    ]);
    expect(
      planBackfillChunks(T('2026-10-03T00:00:00Z'), T('2026-10-03T00:00:00Z')),
    ).toEqual([]);
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
        {
          from: T('2026-10-01T00:00:00Z'),
          to: T('2026-10-01T01:00:00Z'),
          toInclusive: false,
        },
        {
          from: T('2026-10-01T05:00:00Z'),
          to: T('2026-10-01T05:30:00Z'),
          toInclusive: true,
        },
      ],
      p,
    );
    expect(sql).toBe(
      '((event_time >= $2 AND event_time < $3) OR (event_time >= $4 AND event_time <= $5))',
    );
    expect(p.values).toHaveLength(5);
  });
});
