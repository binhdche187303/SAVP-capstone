import { REPORT_TYPE_ORDER } from '../center/report-definition.registry.js';
import { assertSignerDefaults, normalizeLayout } from './report-template.layout.js';
import { buildUelReportTemplates } from './uel-report-templates.js';

it('provides one valid, distinct editable template per supported type, with a top-left school logo', () => {
  const id = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  const templates = buildUelReportTemplates(id);
  expect(templates.map(t => t.reportType)).toEqual(REPORT_TYPE_ORDER);
  expect(new Set(templates.map(t => t.layout.title.subject)).size).toBe(7);
  for (const template of templates) {
    expect(normalizeLayout(template.layout)).toEqual(template.layout);
    expect(() => assertSignerDefaults(template.layout)).not.toThrow();
    expect(template.layout.logo).toMatchObject({ enabled: true, position: 'top-left', mediaFileId: id });
    expect(template.layout.signatures.every(s => !s.authority && !s.defaultSigner)).toBe(true);
  }
});
