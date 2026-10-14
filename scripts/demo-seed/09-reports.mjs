// Phase 09 — lịch gửi báo cáo + lịch sử lần chạy (report_schedules / report_schedule_runs).
// Lần chạy chỉ là lịch sử hiển thị: không gắn file (output_file_ids rỗng).
import { did, insert, vnTime, addMin } from './lib.mjs';

const pgArr = (a) => `{${a.join(',')}}`;
const dateVn = (d) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// [tên, loại, period, frequency, giờ gửi, dow, dom, formats, owner, người nhận (username), email ngoài, enabled]
const SCHEDULES = [
  ['Chấm công nhân viên hằng ngày', 'staff-attendance', 'yesterday', 'daily', [7, 30], null, null, ['xlsx'], 'vinh.tq', ['ha.ntt', 'anh.ltp'], null, true],
  ['Tổng hợp ra vào cổng hằng tuần', 'gate-access', 'last_week', 'weekly', [8, 0], 1, null, ['pdf', 'xlsx'], 'vinh.tq', ['hieu.dv', 'dung.tv'], null, true],
  ['Báo cáo khách ra vào hằng tuần', 'visitor', 'last_week', 'weekly', [8, 15], 1, null, ['pdf'], 'ha.ntt', ['anh.ltp'], 'bangiamdoc@savp.edu.vn', true],
  ['Cảnh báo an ninh hằng tháng', 'security-alert', 'last_month', 'monthly', [9, 0], null, 1, ['pdf', 'docx'], 'vinh.tq', ['hieu.dv'], null, false],
];

export async function seedReports(ctx) {
  const { c, now } = ctx;
  const u = Object.fromEntries((await c.query(
    `SELECT username, id, full_name FROM public.users WHERE id::text LIKE 'de0de0de-%'`,
  )).rows.map((r) => [r.username, r]));

  const schedules = [];
  const runs = [];
  let nr = 0;
  SCHEDULES.forEach(([name, type, period, frequency, [h, m], dow, dom, formats, owner, to, extEmail, enabled], i) => {
    const id = did('report_schedules', i + 1);
    const recipients = to.map((un) => ({ type: 'user', value: u[un].id, label: u[un].full_name }));
    if (extEmail) recipients.push({ type: 'email', value: extEmail, label: extEmail });

    // Các mốc đã chạy (cũ → mới) theo tần suất
    const step = frequency === 'daily' ? 1 : frequency === 'weekly' ? 7 : 30;
    const count = frequency === 'daily' ? 7 : frequency === 'weekly' ? 4 : 2;
    const slots = Array.from({ length: count }, (_, k) => vnTime(-(count - k) * step + (frequency === 'daily' ? 1 : 0), h, m, now))
      .filter((d) => d < now);
    slots.forEach((slot, k) => {
      const pTo = new Date(slot.getTime() - 86400000);
      const pFrom = new Date(pTo.getTime() - (step - 1) * 86400000);
      const failed = type === 'gate-access' && k === 1;
      const run = {
        id: did('report_schedule_runs', ++nr), schedule_id: id, schedule_name: name, report_type: type,
        trigger: 'scheduled', status: failed ? 'failed' : 'success', scheduled_for: slot,
        period_from: dateVn(pFrom), period_to: dateVn(pTo), formats: pgArr(formats), recipient_count: recipients.length,
        error_message: failed ? 'Máy chủ email tạm thời không phản hồi (SMTP timeout)' : null,
        retried_by_run_id: null, started_at: slot, finished_at: addMin(slot, 1), created_at: slot,
      };
      runs.push(run);
      if (failed) {
        const retry = { ...run, id: did('report_schedule_runs', ++nr), trigger: 'manual', status: 'success', scheduled_for: null,
          error_message: null, started_at: addMin(slot, 45), finished_at: addMin(slot, 46), created_at: addMin(slot, 45) };
        run.retried_by_run_id = retry.id;
        runs.push(retry);
      }
    });
    const last = slots.at(-1) ?? null;
    let next = vnTime(0, h, m, now);
    const vnDay = (d) => new Date(d.getTime() + 7 * 3600000);
    while (next <= now || (dow != null && vnDay(next).getUTCDay() !== dow) || (dom != null && vnDay(next).getUTCDate() !== dom)) {
      next = new Date(next.getTime() + 86400000);
    }
    schedules.push({
      id, name, report_type: type, filters_json: {}, period, frequency,
      send_time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
      day_of_week: dow, day_of_month: dom, last_day_of_month: false, formats: pgArr(formats),
      recipients_json: recipients, subject: `[SmarTracking] ${name}`,
      message: 'Báo cáo tự động từ hệ thống SmarTracking.', enabled,
      next_run_at: enabled ? next : null, last_run_at: last, owner_user_id: u[owner].id,
      created_at: vnTime(-40, 10, i * 5, now), updated_at: vnTime(-3, 10, 0, now),
    });
  });

  const n = {};
  n.report_schedules = await insert(c, 'report_schedules', schedules);
  n.report_schedule_runs = await insert(c, 'report_schedule_runs', runs);
  return n;
}
