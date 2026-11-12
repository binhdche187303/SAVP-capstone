/**
 * Cấu trúc một mẫu báo cáo "quy chuẩn" (thể thức NĐ 30/2020/NĐ-CP).
 *
 * Thứ tự cố định theo nghị định, người dùng KHÔNG đổi được:
 *   đầu văn bản (cơ quan | quốc hiệu, số, địa danh ngày) → tên loại + trích yếu → Kính gửi
 *   → [THÂN — các khối kéo đổi chỗ / bật tắt được] → câu kết → khối ký + nơi nhận → phụ lục.
 * Font, cỡ chữ, lề trang do bộ dựng quyết định, không nằm trong mẫu.
 *
 * Chuỗi văn bản hỗ trợ biến: {title} tên báo cáo, {period} "từ ngày … đến ngày …", {unit} tên đơn vị.
 */

export const BODY_BLOCK_KINDS = ['opening', 'scope', 'summary', 'assessment', 'text'] as const;
export type BodyBlockKind = (typeof BODY_BLOCK_KINDS)[number];

export interface BodyBlock {
  id: string;
  kind: BodyBlockKind;
  enabled: boolean;
  /** Tiêu đề mục (I., II. tự đánh theo thứ tự). Bỏ qua với `opening`. */
  title: string;
  /** Đoạn văn của `opening` / `text`; dòng gợi ý của `assessment`. */
  text: string;
}

export const SIGNATURE_MODES = ['required', 'optional', 'hidden'] as const;
export type SignatureMode = (typeof SIGNATURE_MODES)[number];

export interface SignerRef {
  /** Người dùng trong hệ thống; null = nhập tay. */
  userId: string | null;
  fullName: string;
}

export interface SignatureSlot {
  id: string;
  /** Dòng thẩm quyền, vd "TL. HIỆU TRƯỞNG", "KT. TRƯỞNG PHÒNG". Có thể trống. */
  authority: string;
  /** Chức vụ người ký, vd "TRƯỞNG PHÒNG HÀNH CHÍNH", "NGƯỜI LẬP BIỂU". */
  title: string;
  mode: SignatureMode;
  /** Tự điền người bấm xuất (dùng cho "Người lập biểu"). */
  useExporter: boolean;
  defaultSigner: SignerRef | null;
}

export const LOGO_POSITIONS = ['margin', 'above'] as const;
export type LogoPosition = (typeof LOGO_POSITIONS)[number];

export interface ReportTemplateLayout {
  version: 1;
  header: {
    parentAgency: string;
    agency: string;
    /** Đoạn trong `agency` được gạch chân (văn bản thật UEL gạch "ĐẠI HỌC KINH TẾ"). Trống = gạch cả dòng theo NĐ30. */
    agencyUnderline: string;
    agencyShort: string;
    unitName: string;
    unitCode: string;
    place: string;
  };
  title: {
    /** Trích yếu; trống = tên báo cáo trong danh mục. */
    subject: string;
  };
  addressee: { enabled: boolean; text: string };
  body: BodyBlock[];
  closing: { enabled: boolean; text: string };
  signatures: SignatureSlot[];
  recipients: { enabled: boolean; items: string[] };
  appendix: { enabled: boolean };
  logo: { enabled: boolean; mediaFileId: string | null; position: LogoPosition; widthMm: number };
  watermark: { enabled: boolean; mediaFileId: string | null; opacity: number; widthPct: number };
  footer: { provenance: boolean };
}

export const LIMITS = {
  shortText: 200,
  longText: 3000,
  bodyBlocks: 12,
  textBlocks: 6,
  signatures: 3,
  recipients: 10,
  logoMm: [10, 30] as const,
  watermarkOpacity: [0.03, 0.5] as const,
  watermarkWidthPct: [20, 90] as const,
};

export function defaultLayout(): ReportTemplateLayout {
  return {
    version: 1,
    header: {
      parentAgency: 'ĐẠI HỌC QUỐC GIA TP.HCM',
      agency: 'TRƯỜNG ĐẠI HỌC KINH TẾ - LUẬT',
      agencyUnderline: 'ĐẠI HỌC KINH TẾ',
      agencyShort: 'ĐHKTL',
      unitName: 'Phòng Hành chính',
      unitCode: 'HC',
      place: 'Thành phố Hồ Chí Minh',
    },
    title: { subject: '' },
    addressee: { enabled: true, text: 'Ban Giám hiệu Trường Đại học Kinh tế - Luật' },
    body: [
      {
        id: 'opening', kind: 'opening', enabled: true, title: '',
        text: 'Thực hiện chế độ báo cáo định kỳ, {unit} báo cáo {title} {period} trên cơ sở dữ liệu ghi nhận tự động bởi Hệ thống VISMA, cụ thể như sau:',
      },
      { id: 'scope', kind: 'scope', enabled: true, title: 'PHẠM VI VÀ NGUỒN DỮ LIỆU', text: '' },
      { id: 'summary', kind: 'summary', enabled: true, title: 'KẾT QUẢ TỔNG HỢP', text: '' },
      {
        id: 'assessment', kind: 'assessment', enabled: true, title: 'ĐÁNH GIÁ VÀ KIẾN NGHỊ',
        text: '(Đơn vị lập báo cáo bổ sung nội dung đánh giá, kiến nghị trước khi trình ký)',
      },
    ],
    closing: { enabled: true, text: 'Trên đây là báo cáo {title} {period}, {unit} kính báo cáo Ban Giám hiệu xem xét, chỉ đạo./.' },
    signatures: [
      { id: 'maker', authority: '', title: 'NGƯỜI LẬP BIỂU', mode: 'optional', useExporter: true, defaultSigner: null },
      { id: 'head', authority: 'TL. HIỆU TRƯỞNG', title: 'TRƯỞNG PHÒNG HÀNH CHÍNH', mode: 'required', useExporter: false, defaultSigner: null },
    ],
    recipients: { enabled: true, items: ['Ban Giám hiệu (để b/c);', 'Lưu: VT, HC.'] },
    appendix: { enabled: true },
    logo: { enabled: false, mediaFileId: null, position: 'margin', widthMm: 19 },
    watermark: { enabled: false, mediaFileId: null, opacity: 0.08, widthPct: 60 },
    footer: { provenance: true },
  };
}

export class LayoutError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID = /^[a-z0-9_-]{1,40}$/i;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const obj = (v: unknown, where: string): Obj => {
  if (v === undefined) return {};
  if (!isObj(v)) throw new LayoutError(`${where} không hợp lệ`);
  return v;
};
const str = (v: unknown, fallback: string, where: string, max = LIMITS.shortText): string => {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') throw new LayoutError(`${where} phải là chuỗi`);
  const s = v.trim();
  if (s.length > max) throw new LayoutError(`${where} tối đa ${max} ký tự`);
  return s;
};
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const num = (v: unknown, fallback: number, [min, max]: readonly [number, number], where: string): number => {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new LayoutError(`${where} phải trong khoảng ${min}–${max}`);
  return v;
};
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T, where: string): T => {
  if (v === undefined || v === null) return fallback;
  if (!(list as readonly unknown[]).includes(v)) throw new LayoutError(`${where} không hợp lệ`);
  return v as T;
};
const mediaId = (v: unknown, where: string): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !UUID.test(v)) throw new LayoutError(`${where} không hợp lệ`);
  return v;
};

export function normalizeSigner(v: unknown, where: string): SignerRef | null {
  if (v === undefined || v === null) return null;
  const o = obj(v, where);
  const fullName = str(o['fullName'], '', `${where} — họ tên`, 120);
  const userId = o['userId'] === undefined || o['userId'] === null || o['userId'] === '' ? null : String(o['userId']);
  if (userId && !UUID.test(userId)) throw new LayoutError(`${where} — người dùng không hợp lệ`);
  if (!fullName) return null;
  return { userId, fullName };
}

/**
 * Kiểm và chuẩn hóa layout từ client. Trường thiếu lấy theo mặc định; trường sai ném LayoutError (→ 400).
 * Đây là nơi giữ "khuôn NĐ30": chỉ thân văn bản đổi chỗ được, các phần còn lại cố định vị trí.
 */
export function normalizeLayout(raw: unknown): ReportTemplateLayout {
  const d = defaultLayout();
  const r = obj(raw, 'Mẫu');

  const h = obj(r['header'], 'Đầu văn bản');
  const header = {
    parentAgency: str(h['parentAgency'], d.header.parentAgency, 'Cơ quan chủ quản'),
    agency: str(h['agency'], d.header.agency, 'Tên cơ quan'),
    agencyUnderline: str(h['agencyUnderline'], d.header.agencyUnderline, 'Phần gạch chân'),
    agencyShort: str(h['agencyShort'], d.header.agencyShort, 'Viết tắt cơ quan', 20),
    unitName: str(h['unitName'], d.header.unitName, 'Tên đơn vị'),
    unitCode: str(h['unitCode'], d.header.unitCode, 'Mã đơn vị', 20),
    place: str(h['place'], d.header.place, 'Địa danh', 80),
  };
  if (!header.agency) throw new LayoutError('Vui lòng nhập tên cơ quan');
  if (header.agencyUnderline && !header.agency.includes(header.agencyUnderline)) {
    throw new LayoutError('Phần gạch chân phải nằm trong tên cơ quan');
  }
  if (!header.place) throw new LayoutError('Vui lòng nhập địa danh');

  const t = obj(r['title'], 'Trích yếu');
  const a = obj(r['addressee'], 'Kính gửi');
  const c = obj(r['closing'], 'Câu kết');

  const bodyRaw = r['body'] === undefined ? d.body : r['body'];
  if (!Array.isArray(bodyRaw)) throw new LayoutError('Thân văn bản không hợp lệ');
  if (bodyRaw.length > LIMITS.bodyBlocks) throw new LayoutError(`Tối đa ${LIMITS.bodyBlocks} khối nội dung`);
  const seen = new Set<string>();
  const body: BodyBlock[] = bodyRaw.map((b, i) => {
    const o = obj(b, `Khối ${i + 1}`);
    const kind = oneOf(o['kind'], BODY_BLOCK_KINDS, 'text', `Loại khối ${i + 1}`);
    const id = String(o['id'] ?? '');
    if (!ID.test(id) || seen.has(id)) throw new LayoutError(`Mã khối ${i + 1} không hợp lệ hoặc bị trùng`);
    seen.add(id);
    const def = d.body.find((x) => x.kind === kind);
    return {
      id, kind,
      enabled: bool(o['enabled'], true),
      title: str(o['title'], def?.title ?? '', `Tiêu đề khối ${i + 1}`),
      text: str(o['text'], def?.text ?? '', `Nội dung khối ${i + 1}`, LIMITS.longText),
    };
  });
  for (const k of ['opening', 'scope', 'summary', 'assessment'] as const) {
    if (body.filter((b) => b.kind === k).length > 1) throw new LayoutError('Mỗi khối dựng sẵn chỉ xuất hiện một lần');
  }
  if (body.filter((b) => b.kind === 'text').length > LIMITS.textBlocks) throw new LayoutError(`Tối đa ${LIMITS.textBlocks} đoạn tự soạn`);
  // NĐ30: phần mở đầu (căn cứ, mục đích) đứng đầu thân văn bản.
  const openIdx = body.findIndex((b) => b.kind === 'opening');
  if (openIdx > 0) throw new LayoutError('Đoạn mở đầu phải đứng đầu thân văn bản');
  if (body.some((b) => b.kind !== 'opening' && b.enabled && !b.title)) throw new LayoutError('Mục nội dung cần có tiêu đề');

  const sigRaw = r['signatures'] === undefined ? d.signatures : r['signatures'];
  if (!Array.isArray(sigRaw)) throw new LayoutError('Khối ký không hợp lệ');
  if (sigRaw.length > LIMITS.signatures) throw new LayoutError(`Tối đa ${LIMITS.signatures} ô ký`);
  const sigIds = new Set<string>();
  const signatures: SignatureSlot[] = sigRaw.map((s, i) => {
    const o = obj(s, `Ô ký ${i + 1}`);
    const id = String(o['id'] ?? '');
    if (!ID.test(id) || sigIds.has(id)) throw new LayoutError(`Mã ô ký ${i + 1} không hợp lệ hoặc bị trùng`);
    sigIds.add(id);
    const slot: SignatureSlot = {
      id,
      authority: str(o['authority'], '', `Thẩm quyền ô ký ${i + 1}`, 80),
      title: str(o['title'], '', `Chức vụ ô ký ${i + 1}`, 120),
      mode: oneOf(o['mode'], SIGNATURE_MODES, 'optional', `Chế độ ô ký ${i + 1}`),
      useExporter: bool(o['useExporter'], false),
      defaultSigner: normalizeSigner(o['defaultSigner'], `Người ký mặc định ô ${i + 1}`),
    };
    if (!slot.title) throw new LayoutError(`Ô ký ${i + 1} cần có chức vụ`);
    if (slot.useExporter) slot.defaultSigner = null;
    return slot;
  });

  const rc = obj(r['recipients'], 'Nơi nhận');
  const itemsRaw = rc['items'] === undefined ? d.recipients.items : rc['items'];
  if (!Array.isArray(itemsRaw)) throw new LayoutError('Nơi nhận không hợp lệ');
  if (itemsRaw.length > LIMITS.recipients) throw new LayoutError(`Tối đa ${LIMITS.recipients} nơi nhận`);
  const items = itemsRaw.map((x, i) => str(x, '', `Nơi nhận ${i + 1}`, 150)).filter(Boolean);

  const lg = obj(r['logo'], 'Logo');
  const logo = {
    enabled: bool(lg['enabled'], d.logo.enabled),
    mediaFileId: mediaId(lg['mediaFileId'], 'Ảnh logo'),
    position: oneOf(lg['position'], LOGO_POSITIONS, d.logo.position, 'Vị trí logo'),
    widthMm: num(lg['widthMm'], d.logo.widthMm, LIMITS.logoMm, 'Cỡ logo (mm)'),
  };
  const wm = obj(r['watermark'], 'Logo nền');
  const watermark = {
    enabled: bool(wm['enabled'], d.watermark.enabled),
    mediaFileId: mediaId(wm['mediaFileId'], 'Ảnh logo nền'),
    opacity: num(wm['opacity'], d.watermark.opacity, LIMITS.watermarkOpacity, 'Độ mờ logo nền'),
    widthPct: num(wm['widthPct'], d.watermark.widthPct, LIMITS.watermarkWidthPct, 'Cỡ logo nền (%)'),
  };
  if (logo.enabled && !logo.mediaFileId) throw new LayoutError('Bật logo thì cần tải ảnh logo');
  if (watermark.enabled && !watermark.mediaFileId) throw new LayoutError('Bật logo nền thì cần tải ảnh');

  return {
    version: 1,
    header,
    title: { subject: str(t['subject'], d.title.subject, 'Trích yếu') },
    addressee: { enabled: bool(a['enabled'], d.addressee.enabled), text: str(a['text'], d.addressee.text, 'Kính gửi') },
    body,
    closing: { enabled: bool(c['enabled'], d.closing.enabled), text: str(c['text'], d.closing.text, 'Câu kết', LIMITS.longText) },
    signatures,
    recipients: { enabled: bool(rc['enabled'], d.recipients.enabled), items },
    appendix: { enabled: bool(obj(r['appendix'], 'Phụ lục')['enabled'], d.appendix.enabled) },
    logo,
    watermark,
    footer: { provenance: bool(obj(r['footer'], 'Chân trang')['provenance'], d.footer.provenance) },
  };
}

/**
 * Khi LƯU mẫu: ô ký bắt buộc phải có sẵn người ký mặc định (hoặc là ô "người xuất") — lúc xuất người dùng
 * không phải chọn, chỉ đổi người nếu cần. Bản xem thử không kiểm điều này để xem được mẫu đang soạn dở.
 */
export function assertSignerDefaults(l: ReportTemplateLayout): void {
  for (const s of l.signatures) {
    if (s.mode === 'required' && !s.useExporter && !s.defaultSigner?.fullName.trim()) {
      throw new LayoutError(`Ô ký bắt buộc "${s.title}" cần có người ký mặc định`);
    }
  }
}

/** Các ảnh mà layout tham chiếu — để kiểm quyền / nạp buffer khi dựng file. */
export function layoutMediaIds(l: ReportTemplateLayout): string[] {
  return [l.logo.enabled ? l.logo.mediaFileId : null, l.watermark.enabled ? l.watermark.mediaFileId : null].filter((x): x is string => !!x);
}

/** Lựa chọn người ký lúc xuất: slotId → người ký; `null` = bỏ ô (chỉ với ô tùy chọn). Thiếu khóa = dùng mặc định. */
export type SignerChoices = Record<string, SignerRef | null>;

export interface ResolvedSignature {
  id: string;
  authority: string;
  title: string;
  fullName: string;
}

/**
 * Ghép mẫu + lựa chọn lúc xuất thành danh sách ô ký sẽ in.
 * Ô bắt buộc luôn in và phải có tên (mặc định, người xuất, hoặc người được chọn); ô ẩn không in.
 */
export function resolveSignatures(
  slots: SignatureSlot[],
  choices: SignerChoices | undefined,
  exporter: { fullName: string },
): ResolvedSignature[] {
  const out: ResolvedSignature[] = [];
  for (const s of slots) {
    if (s.mode === 'hidden') continue;
    const has = choices !== undefined && Object.prototype.hasOwnProperty.call(choices, s.id);
    const picked = has ? choices![s.id] : undefined;
    if (picked === null) {
      if (s.mode === 'required') throw new LayoutError(`Ô ký "${s.title}" là bắt buộc, không bỏ được`);
      continue;
    }
    const name = picked?.fullName?.trim() || (s.useExporter ? exporter.fullName : s.defaultSigner?.fullName ?? '');
    if (s.mode === 'required' && !name) throw new LayoutError(`Vui lòng chọn người ký cho ô "${s.title}"`);
    out.push({ id: s.id, authority: s.authority, title: s.title, fullName: name });
  }
  return out;
}

/** Thay biến {title} {period} {unit} trong chuỗi của mẫu. */
export function fillText(text: string, vars: { title: string; period: string; unit: string }): string {
  return text.replace(/\{(title|period|unit)\}/g, (_, k: 'title' | 'period' | 'unit') => vars[k]);
}
