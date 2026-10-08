import {
  mergeZoneHeatmapParts,
  type ZoneHeatmapPart,
} from './merge-zone-heatmap.util.js';

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
      part({
        occupancySum: 30,
        sampleCount: 3,
        peakOccupancy: 15,
        peakAt: new Date('2026-10-01T01:00:00Z'),
      }),
      part({
        occupancySum: 10,
        sampleCount: 1,
        peakOccupancy: 10,
        peakAt: new Date('2026-10-01T05:00:00Z'),
      }),
    ]);
    expect(r.avgOccupancy).toBe(10);
    expect(r.peakOccupancy).toBe(15);
    expect(r.peakAt).toEqual(new Date('2026-10-01T01:00:00Z'));
  });

  it('hoà đỉnh → peak_at muộn hơn thắng (Review Focus #3)', () => {
    const [r] = mergeZoneHeatmapParts([
      part({
        peakOccupancy: 50,
        peakAt: new Date('2026-10-01T05:00:00Z'),
        sampleCount: 1,
        occupancySum: 50,
      }),
      part({
        peakOccupancy: 50,
        peakAt: new Date('2026-10-02T16:15:00Z'),
        sampleCount: 1,
        occupancySum: 50,
      }),
    ]);
    expect(r.peakAt).toEqual(new Date('2026-10-02T16:15:00Z'));
  });

  it('NULL xếp cuối: phần có peak số thắng phần peak NULL dù muộn hơn', () => {
    const [r] = mergeZoneHeatmapParts([
      part({
        peakOccupancy: 3,
        peakAt: new Date('2026-10-01T00:00:00Z'),
        sampleCount: 1,
        occupancySum: 3,
      }),
      part({
        peakOccupancy: null,
        peakAt: new Date('2026-10-03T00:00:00Z'),
      }),
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
