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
