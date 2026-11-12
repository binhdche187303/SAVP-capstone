import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AuditLogsService } from '../../administration/services/audit-logs.service.js';
import { MediaFileEntity, MediaFileType, MediaVisibilityLevel, StorageProvider } from '../../recording/entities/media-file.entity.js';
import { StorageService } from '../../storage/storage.service.js';
import { reportBadRequest, reportNotFound } from '../center/report-center.errors.js';
import { isReportType } from '../center/report-definition.registry.js';
import {
  defaultLayout,
  LayoutError,
  layoutMediaIds,
  normalizeLayout,
  assertSignerDefaults,
  normalizeSigner,
  resolveSignatures,
  type ReportTemplateLayout,
  type ResolvedSignature,
  type SignerChoices,
} from './report-template.layout.js';

export const TEMPLATE_ASSET_ENTITY = 'report_template_asset';
const ASSET_MAX_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NAME = 150;

export interface UploadedAssetFile { buffer: Buffer; mimetype: string; originalname: string; size: number }

interface TemplateRow {
  id: string; name: string; report_type: string | null; is_default: boolean; layout: unknown;
  created_at: Date; updated_at: Date; updated_by_name: string | null;
}

export interface ReportTemplateDto {
  id: string;
  name: string;
  reportType: string | null;
  isDefault: boolean;
  layout: ReportTemplateLayout;
  /** mediaFileId → URL ký tạm để FE hiển thị logo trên canvas. */
  assetUrls: Record<string, string>;
  updatedAt: string;
  updatedByName: string | null;
}

/** Mẫu + ảnh đã nạp, sẵn để bộ dựng file dùng. */
export interface RenderableTemplate {
  layout: ReportTemplateLayout;
  assets: Record<string, Buffer>;
}

/** Lựa chọn lúc xuất bản quy chuẩn (đã kiểm). */
export interface StandardExportOptions {
  templateId: string;
  signers: SignerChoices;
  addressee?: string;
  recipients?: string[];
}

const SELECT = `SELECT t.id, t.name, t.report_type, t.is_default, t.layout, t.created_at, t.updated_at, u.full_name AS updated_by_name
                  FROM report_templates t LEFT JOIN users u ON u.id = t.updated_by`;

const asBad = (e: unknown): never => {
  if (e instanceof LayoutError) throw reportBadRequest(e.message, 'TEMPLATE_INVALID');
  throw e;
};

/** Mẫu báo cáo quy chuẩn: CRUD, ảnh logo/nền, tra người ký, ghép mẫu khi xuất. */
@Injectable()
export class ReportTemplateService {
  private readonly logger = new Logger(ReportTemplateService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: StorageService,
    private readonly config: ConfigService,
    private readonly audit: AuditLogsService,
    @InjectRepository(MediaFileEntity) private readonly mediaFiles: Repository<MediaFileEntity>,
  ) {}

  defaultLayout(): ReportTemplateLayout {
    return defaultLayout();
  }

  /** Mẫu dùng được cho một loại (mẫu riêng của loại + mẫu chung), mặc định đứng đầu. Không truyền loại = tất cả. */
  async list(reportType?: string): Promise<ReportTemplateDto[]> {
    if (reportType && !isReportType(reportType)) throw reportBadRequest('Loại báo cáo không tồn tại');
    const rows: TemplateRow[] = await this.dataSource.query(
      `${SELECT} WHERE t.deleted_at IS NULL AND ($1::varchar IS NULL OR t.report_type IS NULL OR t.report_type = $1)
        ORDER BY (t.report_type IS NOT NULL) DESC, t.is_default DESC, t.name`,
      [reportType ?? null],
    );
    return Promise.all(rows.map((r) => this.toDto(r)));
  }

  async get(id: string): Promise<ReportTemplateDto> {
    return this.toDto(await this.row(id));
  }

  async create(body: Record<string, unknown>, userId: string): Promise<ReportTemplateDto> {
    const input = this.input(body, true);
    const layout = this.layoutOf(body['layout'] ?? defaultLayout(), true);
    await this.assertAssets(layout);
    const id = await this.dataSource.transaction(async (m) => {
      if (input.isDefault) await m.query(`UPDATE report_templates SET is_default = false WHERE deleted_at IS NULL AND COALESCE(report_type, '*') = COALESCE($1::varchar, '*')`, [input.reportType]);
      const rows: Array<{ id: string }> = await m.query(
        `INSERT INTO report_templates (name, report_type, is_default, layout, created_by, updated_by) VALUES ($1, $2, $3, $4::jsonb, $5, $5) RETURNING id`,
        [input.name, input.reportType, input.isDefault, JSON.stringify(layout), userId],
      );
      return rows[0].id;
    });
    this.log(userId, 'report_template_create', id, { name: input.name, reportType: input.reportType });
    return this.get(id);
  }

  async update(id: string, body: Record<string, unknown>, userId: string): Promise<ReportTemplateDto> {
    const current = await this.row(id);
    const input = this.input(body, false);
    const name = input.name ?? current.name;
    const reportType = body['reportType'] === undefined ? current.report_type : input.reportType;
    const isDefault = body['isDefault'] === undefined ? current.is_default : input.isDefault;
    const layout = this.layoutOf(body['layout'] === undefined ? current.layout : body['layout'], true);
    await this.assertAssets(layout);
    await this.dataSource.transaction(async (m) => {
      if (isDefault) await m.query(`UPDATE report_templates SET is_default = false WHERE deleted_at IS NULL AND id <> $2 AND COALESCE(report_type, '*') = COALESCE($1::varchar, '*')`, [reportType, id]);
      await m.query(
        `UPDATE report_templates SET name = $2, report_type = $3, is_default = $4, layout = $5::jsonb, updated_by = $6, updated_at = now() WHERE id = $1`,
        [id, name, reportType, isDefault, JSON.stringify(layout), userId],
      );
    });
    this.log(userId, 'report_template_update', id, { name, reportType, isDefault });
    return this.get(id);
  }

  async duplicate(id: string, userId: string): Promise<ReportTemplateDto> {
    const r = await this.row(id);
    return this.create({ name: `${r.name} (bản sao)`.slice(0, MAX_NAME), reportType: r.report_type, isDefault: false, layout: r.layout }, userId);
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.row(id);
    await this.dataSource.query(`UPDATE report_templates SET deleted_at = now(), is_default = false, updated_by = $2 WHERE id = $1`, [id, userId]);
    this.log(userId, 'report_template_delete', id, {});
  }

  /** Tải ảnh logo / logo nền. Chỉ PNG/JPEG ≤ 2 MB, kiểm cả chữ ký file (không tin mimetype của client). */
  async uploadAsset(file: UploadedAssetFile | undefined, userId: string): Promise<{ mediaFileId: string; url: string; mimeType: string }> {
    if (!file?.buffer?.length) throw reportBadRequest('Vui lòng chọn ảnh', 'ASSET_REQUIRED');
    if (file.buffer.length > ASSET_MAX_BYTES) throw reportBadRequest('Ảnh tối đa 2 MB', 'ASSET_TOO_LARGE');
    const kind = sniffImage(file.buffer);
    if (!kind) throw reportBadRequest('Chỉ nhận ảnh PNG hoặc JPEG', 'ASSET_TYPE');
    const mimeType = kind === 'png' ? 'image/png' : 'image/jpeg';
    const fileName = `logo.${kind === 'png' ? 'png' : 'jpg'}`;
    const saved = await this.storage.saveFile({ buffer: file.buffer, originalName: fileName, folder: 'report-templates' });
    const media = await this.mediaFiles.save(this.mediaFiles.create({
      fileName: (file.originalname || fileName).slice(0, 200),
      fileType: MediaFileType.IMAGE,
      mimeType,
      storageProvider: this.storage.getDriver() === 's3' ? StorageProvider.S3 : StorageProvider.LOCAL,
      storageKey: saved.storageKey,
      fileSizeBytes: saved.sizeBytes.toString(),
      relatedEntityType: TEMPLATE_ASSET_ENTITY,
      relatedEntityId: userId,
      visibilityLevel: MediaVisibilityLevel.INTERNAL,
      isActive: true,
    }));
    return { mediaFileId: media.id, url: this.assetUrl(media.id), mimeType };
  }

  /** Người dùng đang hoạt động để chọn làm người ký (không gồm sinh viên). */
  async signers(q: string | undefined): Promise<Array<{ id: string; fullName: string; positionTitle: string | null; departmentName: string | null }>> {
    const term = String(q ?? '').trim().slice(0, 100);
    return this.dataSource.query(
      `SELECT u.id, u.full_name AS "fullName", u.position_title AS "positionTitle", d.department_name AS "departmentName"
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.deleted_at IS NULL AND u.account_status = 'active'
          AND NOT EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND ur.is_active = true AND r.role_code = 'STUDENT')
          AND ($1 = '' OR u.full_name ILIKE '%' || $1 || '%' OR u.employee_code ILIKE '%' || $1 || '%' OR u.position_title ILIKE '%' || $1 || '%')
        ORDER BY (u.leadership_title IS NOT NULL) DESC, u.full_name LIMIT 30`,
      [term],
    );
  }

  /**
   * Kiểm phần "quy chuẩn" của body xuất file. Trả null nếu là bản thường.
   * Ném 400 nếu mẫu không tồn tại / không áp dụng cho loại / thiếu người ký bắt buộc.
   */
  async validateStandardExport(type: string, body: Record<string, unknown>, exporter: { userId: string }): Promise<StandardExportOptions | null> {
    const mode = body['mode'] ?? 'normal';
    if (mode === 'normal') return null;
    if (mode !== 'standard') throw reportBadRequest('Kiểu bản xuất không hợp lệ');
    const templateId = String(body['templateId'] ?? '');
    if (!UUID.test(templateId)) throw reportBadRequest('Vui lòng chọn mẫu báo cáo', 'TEMPLATE_REQUIRED');
    const row = await this.row(templateId);
    if (row.report_type && row.report_type !== type) throw reportBadRequest('Mẫu này không dùng cho loại báo cáo đã chọn', 'TEMPLATE_MISMATCH');
    const layout = this.layoutOf(row.layout);

    const rawSigners = body['signers'] ?? {};
    if (typeof rawSigners !== 'object' || rawSigners === null || Array.isArray(rawSigners)) throw reportBadRequest('Người ký không hợp lệ');
    const signers: SignerChoices = {};
    const slotIds = new Set(layout.signatures.map((s) => s.id));
    for (const [slotId, v] of Object.entries(rawSigners as Record<string, unknown>)) {
      if (!slotIds.has(slotId)) continue;
      if (v === null) { signers[slotId] = null; continue; }
      try {
        const ref = normalizeSigner(v, 'Người ký');
        if (ref) signers[slotId] = await this.trustedSigner(ref);
      } catch (e) { asBad(e); }
    }
    const exporterName = await this.userName(exporter.userId);
    try { resolveSignatures(layout.signatures, signers, { fullName: exporterName }); } catch (e) { asBad(e); }

    const out: StandardExportOptions = { templateId, signers };
    if (body['addressee'] !== undefined) {
      if (typeof body['addressee'] !== 'string' || body['addressee'].length > 200) throw reportBadRequest('Kính gửi tối đa 200 ký tự');
      out.addressee = body['addressee'].trim();
    }
    if (body['recipients'] !== undefined) {
      const rc = body['recipients'];
      if (!Array.isArray(rc) || rc.length > 10 || rc.some((x) => typeof x !== 'string' || x.length > 150)) throw reportBadRequest('Nơi nhận tối đa 10 dòng, mỗi dòng 150 ký tự');
      out.recipients = (rc as string[]).map((x) => x.trim()).filter(Boolean);
    }
    return out;
  }

  /** Worker gọi: nạp mẫu + ảnh, áp các lựa chọn lúc xuất, giải người ký. */
  async loadForRender(opts: StandardExportOptions, exporter: { userId: string | null; email: string }): Promise<RenderableTemplate & { signatures: ResolvedSignature[]; exporterName: string }> {
    const row = await this.row(opts.templateId);
    const layout = this.layoutOf(row.layout);
    if (opts.addressee !== undefined) layout.addressee = { enabled: opts.addressee.length > 0, text: opts.addressee };
    if (opts.recipients !== undefined) layout.recipients = { enabled: opts.recipients.length > 0, items: opts.recipients };
    const exporterName = exporter.userId ? await this.userName(exporter.userId) : '';
    const signatures = resolveSignatures(layout.signatures, opts.signers, { fullName: exporterName || exporter.email });
    return { layout, assets: await this.loadAssets(layout), signatures, exporterName };
  }

  /** Dựng xem thử từ layout chưa lưu (màn hình cấu hình). */
  async previewTemplate(rawLayout: unknown, exporter: { userId: string; email: string }): Promise<RenderableTemplate & { signatures: ResolvedSignature[]; exporterName: string }> {
    const layout = this.layoutOf(rawLayout);
    await this.assertAssets(layout);
    const exporterName = (await this.userName(exporter.userId)) || exporter.email;
    // Xem thử: ô bắt buộc chưa có người ký vẫn in (dòng chấm) để thấy bố cục.
    const signatures = layout.signatures
      .filter((s) => s.mode !== 'hidden')
      .map((s) => ({ id: s.id, authority: s.authority, title: s.title, fullName: s.useExporter ? exporterName : s.defaultSigner?.fullName ?? '' }));
    return { layout, assets: await this.loadAssets(layout), signatures, exporterName };
  }

  // ───────────────────────── nội bộ ─────────────────────────

  private async row(id: string): Promise<TemplateRow> {
    const rows: TemplateRow[] = UUID.test(id) ? await this.dataSource.query(`${SELECT} WHERE t.id = $1 AND t.deleted_at IS NULL`, [id]) : [];
    if (!rows[0]) throw reportNotFound('Không tìm thấy mẫu báo cáo', 'TEMPLATE_NOT_FOUND');
    return rows[0];
  }

  /** `forSave`: thêm kiểm người ký mặc định cho ô bắt buộc (xem assertSignerDefaults). */
  private layoutOf(raw: unknown, forSave = false): ReportTemplateLayout {
    try {
      const l = normalizeLayout(raw);
      if (forSave) assertSignerDefaults(l);
      return l;
    } catch (e) { return asBad(e); }
  }

  private input(body: Record<string, unknown>, creating: boolean): { name: string | undefined; reportType: string | null; isDefault: boolean } {
    const rawName = body['name'];
    let name: string | undefined;
    if (rawName !== undefined || creating) {
      name = String(rawName ?? '').trim();
      if (!name) throw reportBadRequest('Vui lòng nhập tên mẫu');
      if (name.length > MAX_NAME) throw reportBadRequest(`Tên mẫu tối đa ${MAX_NAME} ký tự`);
    }
    const rt = body['reportType'];
    if (rt !== undefined && rt !== null && rt !== '' && (typeof rt !== 'string' || !isReportType(rt))) throw reportBadRequest('Loại báo cáo không tồn tại');
    const isDefault = body['isDefault'];
    if (isDefault !== undefined && typeof isDefault !== 'boolean') throw reportBadRequest('Cờ mặc định không hợp lệ');
    return { name, reportType: typeof rt === 'string' && rt ? rt : null, isDefault: isDefault === true };
  }

  /** Ảnh trong layout phải là ảnh đã tải qua API này (không cho trỏ tới file bất kỳ trong media_files). */
  private async assertAssets(layout: ReportTemplateLayout): Promise<void> {
    const ids = layoutMediaIds(layout);
    if (!ids.length) return;
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM media_files WHERE id = ANY($1::uuid[]) AND related_entity_type = $2 AND is_active = true`,
      [ids, TEMPLATE_ASSET_ENTITY],
    );
    if (rows.length !== new Set(ids).size) throw reportBadRequest('Ảnh logo không tồn tại, vui lòng tải lại', 'ASSET_NOT_FOUND');
  }

  private async loadAssets(layout: ReportTemplateLayout): Promise<Record<string, Buffer>> {
    const ids = layoutMediaIds(layout);
    if (!ids.length) return {};
    const rows: Array<{ id: string; storage_key: string }> = await this.dataSource.query(
      `SELECT id, storage_key FROM media_files WHERE id = ANY($1::uuid[]) AND related_entity_type = $2 AND is_active = true`,
      [ids, TEMPLATE_ASSET_ENTITY],
    );
    const out: Record<string, Buffer> = {};
    for (const r of rows) {
      try { out[r.id] = await this.storage.downloadFile(r.storage_key); } catch (e) {
        // Mất ảnh không làm hỏng cả báo cáo — bộ dựng bỏ qua logo thiếu.
        this.logger.warn(`Không đọc được ảnh mẫu ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    return out;
  }

  private assetUrl(mediaFileId: string): string {
    const ttl = this.config.get<number>('MEDIA_DOWNLOAD_TOKEN_TTL_SECONDS', 600);
    const base = this.config.get<string>('API_PUBLIC_BASE_URL', 'http://localhost:3000').replace(/\/$/, '');
    const { token } = this.storage.generateSignedDownloadToken(mediaFileId, ttl);
    return `${base}/api/v1/media-files/${mediaFileId}/secure-download?token=${token}`;
  }

  private async toDto(r: TemplateRow): Promise<ReportTemplateDto> {
    // Mẫu cũ trong DB có thể thiếu trường mới → chuẩn hóa lại; nếu hỏng hẳn thì trả mặc định thay vì 500.
    let layout: ReportTemplateLayout;
    try { layout = normalizeLayout(r.layout); } catch { layout = defaultLayout(); }
    const assetUrls: Record<string, string> = {};
    for (const id of [layout.logo.mediaFileId, layout.watermark.mediaFileId]) {
      if (id && !assetUrls[id]) {
        try { assetUrls[id] = this.assetUrl(id); } catch { /* thiếu secret → FE tự ẩn ảnh */ }
      }
    }
    return {
      id: r.id, name: r.name, reportType: r.report_type, isDefault: r.is_default, layout, assetUrls,
      updatedAt: new Date(r.updated_at).toISOString(), updatedByName: r.updated_by_name,
    };
  }

  /** Người ký chọn từ danh sách: lấy họ tên theo DB, không tin tên client gửi. */
  private async trustedSigner(ref: { userId: string | null; fullName: string }): Promise<{ userId: string | null; fullName: string }> {
    if (!ref.userId) return ref;
    const name = await this.userName(ref.userId);
    if (!name) throw new LayoutError('Người ký không tồn tại hoặc đã ngừng hoạt động');
    return { userId: ref.userId, fullName: name };
  }

  private async userName(userId: string): Promise<string> {
    if (!UUID.test(userId)) return '';
    const rows: Array<{ full_name: string }> = await this.dataSource.query(
      `SELECT full_name FROM users WHERE id = $1 AND deleted_at IS NULL AND account_status = 'active'`,
      [userId],
    );
    return rows[0]?.full_name ?? '';
  }

  /** Nhật ký cho bản quy chuẩn dựng từ dữ liệu trang khác (không có background job để truy lại). */
  logDocumentExport(userId: string, templateId: string, metadata: Record<string, unknown>): void {
    this.log(userId, 'report_document_export', templateId, metadata);
  }

  private log(userId: string, actionType: string, entityId: string, metadataJson: Record<string, unknown>): void {
    this.audit
      .logAction({ userId, actionType, entityType: 'report_templates', entityId, metadataJson })
      .catch((e) => this.logger.warn(`Audit mẫu báo cáo lỗi: ${e instanceof Error ? e.message : String(e)}`));
  }
}

export function sniffImage(b: Buffer): 'png' | 'jpeg' | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  return null;
}
