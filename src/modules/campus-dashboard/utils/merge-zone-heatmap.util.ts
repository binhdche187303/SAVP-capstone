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
  if (a.peakOccupancy !== b.peakOccupancy)
    return (b.peakOccupancy ?? 0) > (a.peakOccupancy ?? 0);
  return (
    (b.peakAt?.getTime() ?? -Infinity) > (a.peakAt?.getTime() ?? -Infinity)
  );
}

/**
 * KPI-001 §5.2 — gộp các phần heatmap theo zone, cho kết quả bằng query raw cũ
 * (AVG/MAX + subquery peak_at) trên toàn khoảng.
 */
export function mergeZoneHeatmapParts(
  parts: ZoneHeatmapPart[],
): ZoneHeatmapAggregate[] {
  const acc = new Map<
    string,
    { sum: number; samples: number; events: number; best: ZoneHeatmapPart }
  >();
  for (const p of parts) {
    const cur = acc.get(p.zoneId);
    if (!cur) {
      acc.set(p.zoneId, {
        sum: p.occupancySum,
        samples: p.sampleCount,
        events: p.eventCount,
        best: p,
      });
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
