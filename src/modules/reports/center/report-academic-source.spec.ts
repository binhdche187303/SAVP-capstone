import { ReportCenterService } from './report-center.service';
import { StudentAttendanceReportProvider } from './providers/student-attendance.provider';

describe('synchronized academic report data', () => {
  it('loads semester, subject and section choices from UEL and returns cascade identifiers', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const scope = { resolve: jest.fn().mockResolvedValue({ unrestricted: true }) };
    const service = new ReportCenterService({ query } as never, scope as never, {} as never, {} as never, []);
    const result = await service.lookups('admin');
    expect(result.subjects).toEqual([]);
    expect(result.classSections).toEqual([]);
    for (const table of ['semesters', 'subjects', 'class_sections']) {
      const sql = query.mock.calls.find(([sql]) => sql.includes(`FROM ${table}`))?.[0];
      expect(sql).toContain("source = 'uel_api'");
    }
    const sectionSql = query.mock.calls.find(([sql]) => sql.includes('FROM class_sections'))?.[0];
    expect(sectionSql).toContain('"semesterId"');
    expect(sectionSql).toContain('"subjectId"');
  });

  it('excludes sample classes from KPI, charts, rows and exports while retaining manual attendance on real classes', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const provider = new StudentAttendanceReportProvider({ query } as never);
    const result = await provider.build({ from: '2026-11-01', to: '2026-11-14' }, { unrestricted: true } as never, null, new Date('2026-11-14T06:00:00Z'));
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    const factsQueries = query.mock.calls.filter(([sql]) => sql.includes('WITH days AS'));
    expect(factsQueries).toHaveLength(4);
    factsQueries.forEach(([sql]) => {
      expect(sql).toContain("cs.source = 'uel_api'");
      expect(sql).not.toMatch(/r\.source\s*=/);
    });
  });
});
