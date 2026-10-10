import * as fs from 'fs';
import * as path from 'path';
import { REPORT_DEFINITIONS, REPORT_TYPE_ORDER, isReportType } from './report-definition.registry.js';

const snapshot = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'test/reports/center/fe-report-definitions.snapshot.json'), 'utf8'));

describe('ReportDefinitionRegistry ↔ FE reportDefinitions.js', () => {
  it('đủ 7 loại, đúng thứ tự của FE', () => {
    expect(REPORT_TYPE_ORDER).toEqual(snapshot.order);
  });

  describe.each(snapshot.order as string[])('%s', (type) => {
    const fe = snapshot.definitions[type];
    const be = REPORT_DEFINITIONS[type as keyof typeof REPORT_DEFINITIONS];

    it('bộ lọc: khóa, nhãn, nguồn lookup/options trùng', () => {
      expect(be.filters).toEqual(fe.filters);
    });
    it('KPI: khóa, nhãn, định dạng trùng', () => {
      expect(be.kpis).toEqual(fe.kpis);
    });
    it('biểu đồ: khóa, loại, xKey, chuỗi trùng', () => {
      expect(be.charts).toEqual(fe.charts);
    });
    it('cột: khóa, nhãn, định dạng trùng', () => {
      expect(be.columns).toEqual(fe.columns);
    });
    it('tiêu đề và mô tả trùng', () => {
      expect({ title: be.title, description: be.description }).toEqual({ title: fe.title, description: fe.description });
    });
  });

  it('student-attendance chưa khả dụng và có lý do; 6 loại còn lại khả dụng', () => {
    expect(REPORT_DEFINITIONS['student-attendance'].available).toBe(false);
    expect(REPORT_DEFINITIONS['student-attendance'].unavailableReason).toBeTruthy();
    const others = REPORT_TYPE_ORDER.filter((t) => t !== 'student-attendance');
    expect(others.every((t) => REPORT_DEFINITIONS[t].available)).toBe(true);
    expect(others).toHaveLength(6);
  });

  it('vehicle và security-alert không có chiều đơn vị', () => {
    expect(REPORT_DEFINITIONS.vehicle.hasDepartmentScope).toBe(false);
    expect(REPORT_DEFINITIONS['security-alert'].hasDepartmentScope).toBe(false);
    expect(REPORT_DEFINITIONS['staff-attendance'].hasDepartmentScope).toBe(true);
  });

  it('lựa chọn alertType có ba loại cảnh báo khách', () => {
    const values = REPORT_DEFINITIONS['security-alert'].filters.find((f) => f.key === 'alertType')?.options?.map((o) => o.value);
    expect(values).toEqual(expect.arrayContaining(['visitor_overstay', 'visitor_must_leave', 'visitor_zone_violation']));
  });

  it('isReportType từ chối loại lạ và khóa của Object.prototype', () => {
    expect(isReportType('vehicle')).toBe(true);
    expect(isReportType('nope')).toBe(false);
    expect(isReportType('constructor')).toBe(false);
  });
});
