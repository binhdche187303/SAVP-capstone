import { ReportTemplateController } from './report-template.controller.js';
import { defaultLayout } from './report-template.layout.js';

it('validates the declared template family for ANPR while preserving the document title', async () => {
  const template = { layout: defaultLayout(), signatures: [], assets: {}, exporterName: 'Người xuất' };
  const templates = {
    validateStandardExport: jest.fn().mockResolvedValue({ templateId: 'template-1', signers: {} }),
    loadForRender: jest.fn().mockResolvedValue(template), logDocumentExport: jest.fn(),
  };
  const files = { render: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')) };
  const controller = new ReportTemplateController(templates as never, files as never);
  const response = { setHeader: jest.fn(), send: jest.fn() };
  const user = { userId: 'user-1', email: 'test@example.test' };
  const body = { format: 'pdf', mode: 'standard', reportType: 'vehicle', templateId: 'template-1', document: { title: 'Nhật ký phương tiện ra vào', period: { from: '2026-11-01', to: '2026-11-13' }, tables: [] } };
  await controller.renderDocument(body, user, response as never);
  expect(templates.validateStandardExport).toHaveBeenCalledWith('vehicle', body, user);
  expect(template.layout.title.subject).toBe('Nhật ký phương tiện ra vào');
  expect(response.send).toHaveBeenCalledWith(Buffer.from('%PDF-test'));
  await expect(controller.renderDocument({ ...body, reportType: 'unknown' }, user, response as never)).rejects.toThrow();
});
