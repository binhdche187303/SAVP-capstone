/**
 * Create missing UEL templates through the normal authenticated API.
 * Run from the backend: REPORT_TEMPLATE_ADMIN_TOKEN=... npx tsx scripts/provision-uel-report-templates.ts
 * Existing templates are retained. Existing defaults are never replaced.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildUelReportTemplates } from '../src/modules/reports/templates/uel-report-templates.js';

type Template = { id: string; name: string; reportTypes: string[]; layout: { logo: { mediaFileId: string | null } } };

async function main() {
  const token = process.env.REPORT_TEMPLATE_ADMIN_TOKEN;
  if (!token) throw new Error('Cần REPORT_TEMPLATE_ADMIN_TOKEN của tài khoản được quản lý mẫu báo cáo.');
  const base = (process.env.REPORT_TEMPLATE_API_BASE || 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
  const request = async (path: string, body?: unknown) => {
    const multipart = body instanceof FormData;
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined && !multipart ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(`${path}: ${result.message || response.status}`);
    return result.data;
  };
  const current: Template[] = await request('/report-templates');
  const names = new Set(buildUelReportTemplates('00000000-0000-4000-8000-000000000001').map(t => t.name));
  let mediaFileId = process.env.UEL_REPORT_LOGO_MEDIA_ID || current.find(t => names.has(t.name) && t.layout.logo.mediaFileId)?.layout.logo.mediaFileId;
  if (!mediaFileId) {
    const logoPath = process.env.UEL_REPORT_LOGO_PATH || resolve('../SAVP-capstone-FE-/src/assets/images/logo.png');
    const bytes = await readFile(logoPath);
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), 'logo-uel.png');
    mediaFileId = (await request('/report-templates/assets', form)).mediaFileId;
  }
  const results: Array<{ id: string; name: string; reportType: string; status: string }> = [];
  for (const definition of buildUelReportTemplates(mediaFileId!)) {
    // Mỗi loại báo cáo chỉ có một mẫu riêng — loại đã có mẫu thì giữ nguyên, không tạo thêm.
    const existing = current.find(t => t.reportTypes.includes(definition.reportType));
    if (existing) {
      results.push({ id: existing.id, name: existing.name, reportType: definition.reportType, status: 'existing' });
      continue;
    }
    const created: Template = await request('/report-templates', { name: definition.name, reportTypes: [definition.reportType], layout: definition.layout });
    current.push(created);
    results.push({ id: created.id, name: created.name, reportType: definition.reportType, status: 'created' });
  }
  console.log(JSON.stringify(results, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
