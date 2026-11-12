import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { ReportCenterEnabledGuard } from '../center/report-center-enabled.guard.js';
import { reportBadRequest } from '../center/report-center.errors.js';
import { isReportType } from '../center/report-definition.registry.js';
import { REPORT_FORMATS, REPORT_MIME, ReportFileService, type ReportFormat } from '../center/report-file.service.js';
import { documentModel } from './report-document.model.js';
import { sampleReportModel } from './report-template.sample.js';
import { ReportTemplateService, type UploadedAssetFile } from './report-template.service.js';

type CurrentUserPayload = { userId: string; email: string };

const READ = 'report.center.export';
const MANAGE = 'report.template.manage';
const ok = <T>(data: T, message = 'OK') => ({ success: true, message, data, meta: {} });

/**
 * Mẫu báo cáo quy chuẩn (NĐ 30/2020).
 * Đọc mẫu + tra người ký: ai được xuất báo cáo cũng cần (để chọn mẫu, đổi người ký lúc xuất).
 * Tạo / sửa / xóa / tải ảnh / xem thử: `report.template.manage`.
 */
@Controller('report-templates')
@UseGuards(ReportCenterEnabledGuard, JwtAuthGuard, PermissionsGuard)
export class ReportTemplateController {
  constructor(
    private readonly templates: ReportTemplateService,
    private readonly files: ReportFileService,
  ) {}

  @Get()
  @RequirePermissions(READ)
  async list(@Query('reportType') reportType?: string) {
    return ok(await this.templates.list(reportType || undefined));
  }

  /** Bố cục mặc định theo NĐ 30 — điểm xuất phát khi tạo mẫu mới. */
  @Get('defaults')
  @RequirePermissions(READ)
  defaults() {
    return ok({ layout: this.templates.defaultLayout() });
  }

  @Get('signers')
  @RequirePermissions(READ)
  async signers(@Query('q') q?: string) {
    return ok(await this.templates.signers(q));
  }

  @Get(':id')
  @RequirePermissions(READ)
  async get(@Param('id') id: string) {
    return ok(await this.templates.get(id));
  }

  @Post()
  @RequirePermissions(MANAGE)
  async create(@Body() body: Record<string, unknown>, @CurrentUser() user: CurrentUserPayload) {
    return ok(await this.templates.create(body ?? {}, user.userId), 'Đã tạo mẫu báo cáo');
  }

  // KHÔNG đặt limits.fileSize ở Multer: để service trả đúng mã ASSET_TOO_LARGE kèm thông báo tiếng Việt.
  @Post('assets')
  @RequirePermissions(MANAGE)
  @UseInterceptors(FileInterceptor('file'))
  async uploadAsset(@UploadedFile() file: UploadedAssetFile | undefined, @CurrentUser() user: CurrentUserPayload) {
    return ok(await this.templates.uploadAsset(file, user.userId), 'Đã tải ảnh');
  }

  /**
   * Xem thử một bố cục CHƯA lưu với số liệu minh họa. Trả thẳng file (không qua hàng đợi) vì dữ liệu mẫu chỉ vài dòng.
   * Body: `{ layout, format: 'pdf' | 'docx' | 'xlsx', reportType }`.
   */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(MANAGE)
  async preview(@Body() body: Record<string, unknown>, @CurrentUser() user: CurrentUserPayload, @Res() res: Response): Promise<void> {
    const format = String(body?.['format'] ?? 'pdf');
    if (!(REPORT_FORMATS as string[]).includes(format)) throw reportBadRequest('Định dạng xem thử không hợp lệ');
    const reportType = String(body?.['reportType'] ?? 'gate-access');
    if (!isReportType(reportType)) throw reportBadRequest('Loại báo cáo không tồn tại');

    const template = await this.templates.previewTemplate(body?.['layout'], user);
    const now = new Date();
    const today = new Date(now.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
    const buffer = await this.files.render(
      sampleReportModel(reportType, today),
      format as ReportFormat,
      { generatedAt: now, generatedByEmail: user.email, generatedByName: template.exporterName },
      template,
    );
    res.setHeader('Content-Type', REPORT_MIME[format as ReportFormat]);
    res.setHeader('Content-Disposition', `inline; filename="xem-thu-mau-bao-cao.${format}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }

  /**
   * Bản quy chuẩn cho các trang tự tổng hợp dữ liệu (Nhật ký ra/vào phòng, Truy vết camera, Hành trình, Lưu lượng…).
   * Trang gửi nội dung đã lọc + tổng hợp; BE trình bày theo mẫu chung (mẫu áp dụng cho "Tất cả báo cáo").
   * Body: `{ format, mode: 'standard', templateId, signers, addressee?, recipients?, document }` — xem report-document.model.ts.
   * Trả thẳng file (giới hạn 20.000 dòng nên không cần hàng đợi).
   */
  @Post('render-document')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(READ)
  async renderDocument(@Body() body: Record<string, unknown>, @CurrentUser() user: CurrentUserPayload, @Res() res: Response): Promise<void> {
    const format = String(body?.['format'] ?? '');
    if (!(REPORT_FORMATS as string[]).includes(format)) throw reportBadRequest('Định dạng xuất không hợp lệ');
    if ((body?.['mode'] ?? 'normal') !== 'standard') throw reportBadRequest('Chỉ dùng cho bản quy chuẩn');
    const model = documentModel(body?.['document']);
    const opts = await this.templates.validateStandardExport('document', body ?? {}, user);
    if (!opts) throw reportBadRequest('Chỉ dùng cho bản quy chuẩn');
    const template = await this.templates.loadForRender(opts, user);
    const buffer = await this.files.render(
      model,
      format as ReportFormat,
      { generatedAt: new Date(), generatedByEmail: user.email, generatedByName: template.exporterName },
      template,
    );
    this.templates.logDocumentExport(user.userId, opts.templateId, {
      title: model.title, format, period: model.period, rows: model.total, tables: model.tables?.length ?? 0,
    });
    res.setHeader('Content-Type', REPORT_MIME[format as ReportFormat]);
    res.setHeader('Content-Disposition', `attachment; filename="bao-cao-quy-chuan_${model.period.from}_${model.period.to}.${format}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  }

  @Patch(':id')
  @RequirePermissions(MANAGE)
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: CurrentUserPayload) {
    return ok(await this.templates.update(id, body ?? {}, user.userId), 'Đã lưu mẫu báo cáo');
  }

  @Post(':id/duplicate')
  @RequirePermissions(MANAGE)
  async duplicate(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    return ok(await this.templates.duplicate(id, user.userId), 'Đã nhân bản mẫu báo cáo');
  }

  @Delete(':id')
  @RequirePermissions(MANAGE)
  async remove(@Param('id') id: string, @CurrentUser() user: CurrentUserPayload) {
    await this.templates.remove(id, user.userId);
    return ok(null, 'Đã xóa mẫu báo cáo');
  }
}
