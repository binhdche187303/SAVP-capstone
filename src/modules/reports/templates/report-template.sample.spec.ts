import { REPORT_TYPE_ORDER } from '../center/report-definition.registry.js';
import { renderStandardDocx } from '../center/renderers/standard/standard-docx.renderer.js';
import { renderStandardPdf } from '../center/renderers/standard/standard-pdf.renderer.js';
import { renderStandardXlsx } from '../center/renderers/standard/standard-xlsx.renderer.js';
import { defaultLayout } from './report-template.layout.js';
import { sampleReportModel } from './report-template.sample.js';

describe('sampleReportModel', () => {
  const meta = { generatedAt: new Date('2026-11-12T03:05:00.000Z'), generatedByEmail: 'vanthu@uel.edu.vn', generatedByName: 'Nguyễn Thị Văn Thư' };
  const layout = defaultLayout();
  const input = {
    layout,
    assets: {},
    signatures: layout.signatures.filter((s) => s.mode !== 'hidden').map((s) => ({ id: s.id, authority: s.authority, title: s.title, fullName: '' })),
  };

  it('kỳ mẫu là 7 ngày kết thúc hôm nay, đủ cột và chỉ tiêu theo định nghĩa', () => {
    const m = sampleReportModel('gate-access', '2026-11-12', 5);
    expect(m.period).toEqual({ from: '2026-11-06', to: '2026-11-12' });
    expect(m.rows).toHaveLength(5);
    expect(Object.keys(m.rows[0])).toEqual(m.columns.map((c) => c.key));
    expect(m.kpis.every((k) => typeof k.value === 'number')).toBe(true);
  });

  it.each(REPORT_TYPE_ORDER)('xem thử %s dựng được cả Word / Excel / PDF (ô ký để trống)', async (type) => {
    const m = sampleReportModel(type, '2026-11-12');
    const [docx, xlsx, pdf] = await Promise.all([renderStandardDocx(m, meta, input), renderStandardXlsx(m, meta, input), renderStandardPdf(m, meta, input)]);
    expect(docx.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(xlsx.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
