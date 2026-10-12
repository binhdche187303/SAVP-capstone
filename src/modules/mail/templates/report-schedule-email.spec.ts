import { buildReportScheduleEmail } from './builders.js';

describe('buildReportScheduleEmail', () => {
  const base = { scheduleName: 'Gửi sáng thứ Hai', reportTitle: 'Ra vào khuôn viên', periodLabel: '28/09/2026 → 04/10/2026', fileNames: ['gate-access_2026-09-28_2026-10-04.pdf', 'gate-access_2026-09-28_2026-10-04.xlsx'] };

  it('có tên báo cáo, kỳ, tên từng tệp', () => {
    const html = buildReportScheduleEmail(base);
    for (const t of ['Ra vào khuôn viên', '28/09/2026 → 04/10/2026', 'gate-access_2026-09-28_2026-10-04.pdf', '.xlsx', 'Gửi sáng thứ Hai']) expect(html).toContain(t);
  });

  it('lời nhắn và tên lịch được thoát HTML', () => {
    const html = buildReportScheduleEmail({ ...base, scheduleName: '<script>x</script>', message: '<img src=x onerror=alert(1)> & ok' });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&amp; ok');
  });

  it('không có tệp (vượt trần đính kèm) → báo rõ kèm ghi chú', () => {
    const html = buildReportScheduleEmail({ ...base, fileNames: [], note: 'Tệp vượt 15 MB' });
    expect(html).toContain('không đính kèm được');
    expect(html).toContain('Tệp vượt 15 MB');
  });
});
