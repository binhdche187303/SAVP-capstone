// Sinh test/reports/center/fe-report-definitions.snapshot.json từ FE (chỉ khóa, nhãn, định dạng).
// Chạy tay khi FE đổi `src/config/reportDefinitions.js`:  node scripts/export-fe-report-definitions.mjs [đường-dẫn-FE]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const feRoot = resolve(process.argv[2] ?? '../SAVP-capstone-FE');
const source = readFileSync(resolve(feRoot, 'src/config/reportDefinitions.js'), 'utf8')
  .replace(/^import .*lucide-react.*$/m, '')
  .replace(/^\s*icon:\s*\w+,\s*$/gm, '');
const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const snapshot = {};
for (const type of mod.REPORT_TYPES) {
  const d = mod.REPORT_DEFINITIONS[type];
  snapshot[type] = {
    title: d.title,
    description: d.description,
    filters: d.filters.map((f) => ({ key: f.key, label: f.label, ...(f.lookup ? { lookup: f.lookup } : { options: f.options }) })),
    kpis: d.kpis.map((k) => ({ key: k.key, label: k.label, format: k.format })),
    charts: d.charts.map((c) => ({ key: c.key, title: c.title, kind: c.kind, xKey: c.xKey, series: c.series })),
    columns: d.columns.map((c) => ({ key: c.key, label: c.label, format: c.format })),
  };
}
const out = resolve('test/reports/center/fe-report-definitions.snapshot.json');
writeFileSync(out, `${JSON.stringify({ order: mod.REPORT_TYPES, definitions: snapshot }, null, 2)}\n`);
console.log(`Đã ghi ${out} (${mod.REPORT_TYPES.length} loại)`);
