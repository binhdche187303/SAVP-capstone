/**
 * fmtTz (FGC-001 / E1) — format 1 Date (UTC instant) sang giờ theo tz THIẾT BỊ.
 * Trả về 'YYYY-MM-DD HH:mm:ss' + tách date/time (cho uvalidDate.../uvalidTime... sub-fields).
 * KHÔNG dùng UTC/tz-server ngầm — luôn theo `tz` (FACEGATE_TZ).
 */
export interface FaceGateTimeParts {
  dateTime: string; // 'YYYY-MM-DD HH:mm:ss'
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:mm:ss'
}

export function fmtTz(date: Date, tz: string): FaceGateTimeParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23', // KHÔNG dùng hour12:false — một số ICU trả '24' lúc nửa đêm
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const datePart = `${map['year']}-${map['month']}-${map['day']}`;
  const timePart = `${map['hour']}:${map['minute']}:${map['second']}`;

  return {
    dateTime: `${datePart} ${timePart}`,
    date: datePart,
    time: timePart,
  };
}
