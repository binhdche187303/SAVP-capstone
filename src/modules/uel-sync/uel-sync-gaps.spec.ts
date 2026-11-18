import type { DataSource } from 'typeorm';
import * as ExcelJS from 'exceljs';
import {
  cohortGroupOf,
  gapsWorkbook,
  loadGaps,
  sectionGapReasonOf,
  summarizeGaps,
} from './uel-sync-gaps';

describe('uel-sync-gaps', () => {
  it('cohortGroupOf: lớp chính quy → Kxx, liên kết / SĐH / hệ khác → nhóm khác', () => {
    expect(cohortGroupOf('K22406')).toBe('K22');
    expect(cohortGroupOf('B20501DTH')).toBe('K20');
    expect(cohortGroupOf('K6404BH-HCM')).toBe('Khác');
    expect(cohortGroupOf('BCU IB04')).toBe('Khác');
    expect(cohortGroupOf(null)).toBe('Khác');
  });

  it('sectionGapReasonOf: lý do lớp HP chưa có GV', () => {
    const staff = new Map([
      ['lê thanh hòa', ['u1']],
      ['nguyễn văn a', ['u2', 'u3']],
    ]);
    expect(sectionGapReasonOf(null, staff)).toBe('not_assigned');
    expect(sectionGapReasonOf('  ', staff)).toBe('not_assigned');
    expect(sectionGapReasonOf('ThS. Nguyễn Văn A', staff)).toBe('ambiguous');
    expect(sectionGapReasonOf('GS.Thomas Mastrullo', staff)).toBe(
      'not_in_staff',
    );
    expect(sectionGapReasonOf('TS. Lê Thanh Hòa', staff)).toBe('pending');
  });

  const fakeDb = () =>
    ({
      query: jest.fn((sql: string) => {
        if (sql.includes('GROUP BY s.administrative_class'))
          return Promise.resolve([
            { cls: 'K22406', total: 50, no_email: 0 },
            { cls: 'K22407', total: 40, no_email: 1 },
            { cls: 'BCU IB04', total: 38, no_email: 38 },
          ]);
        if (sql.includes('count(*)::int AS total FROM users'))
          return Promise.resolve([{ total: 100 }]);
        if (sql.includes('AS lecturer_name'))
          return Promise.resolve([{ lecturer_name: 'Lê Thanh Hòa', id: 'u1' }]);
        if (sql.includes('s.student_code AS code'))
          return Promise.resolve([
            { code: 'K224070001', name: 'A', cls: 'K22407', dept: 'Khoa X' },
            { code: 'BCU0402', name: 'B', cls: 'BCU IB04', dept: null },
          ]);
        if (sql.includes('u.employee_code AS code'))
          return Promise.resolve([
            { code: '18.001', name: 'C', dept: 'Phòng Y' },
          ]);
        if (sql.includes('count(*)::int AS total FROM class_sections'))
          return Promise.resolve([{ total: 10 }]);
        if (sql.includes('FROM class_sections cs'))
          return Promise.resolve([
            {
              term: '2026-2027_HK01',
              code: 'L1',
              subject_code: 'S1',
              subject_name: 'Môn 1',
              uel_lecturer: null,
            },
            {
              term: '2026-2027_HK01',
              code: 'L2',
              subject_code: 'S2',
              subject_name: 'Môn 2',
              uel_lecturer: 'GS.Thomas Mastrullo',
            },
          ]);
        return Promise.resolve([]);
      }),
    }) as unknown as DataSource;

  it('summarizeGaps: đếm theo khóa, cán bộ, lý do lớp HP', async () => {
    const s = summarizeGaps(await loadGaps(fakeDb()));
    expect(s.students).toEqual({
      total: 128,
      noEmail: 39,
      groups: [
        { label: 'K22', total: 90, noEmail: 1 },
        { label: 'Khác', total: 38, noEmail: 38 },
      ],
    });
    expect(s.staff).toEqual({ total: 100, noEmail: 1 });
    expect(s.sections).toEqual({
      total: 10,
      noLecturer: 2,
      reasons: { not_assigned: 1, ambiguous: 0, not_in_staff: 1, pending: 0 },
    });
  });

  it('gapsWorkbook: 4 sheet, đúng số dòng, có cột trống để bổ sung', async () => {
    const buf = await gapsWorkbook(await loadGaps(fakeDb()), new Date());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Tổng hợp',
      'SV chưa có email',
      'Cán bộ chưa có email',
      'Lớp HP chưa có GV',
    ]);
    const sv = wb.getWorksheet('SV chưa có email')!;
    expect(sv.rowCount).toBe(3);
    expect(sv.getRow(1).values).toContain('Email (bổ sung)');
    const sec = wb.getWorksheet('Lớp HP chưa có GV')!;
    expect(sec.getRow(3).values).toContain(
      'GV không có trong danh sách nhân sự UEL',
    );
  });
});
