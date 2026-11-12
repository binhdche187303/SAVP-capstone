import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { defaultLayout, type ReportTemplateLayout, type ResolvedSignature } from '../../../templates/report-template.layout.js';
import type { ReportModel } from '../../report-model.js';
import { documentModel } from '../../../templates/report-document.model.js';
import { buildStandardContext } from './standard-context.js';
import { decodePng, encodePng, fadePng } from './png-fade.js';
import { renderStandardDocx } from './standard-docx.renderer.js';
import { renderStandardPdf } from './standard-pdf.renderer.js';
import { renderStandardXlsx } from './standard-xlsx.renderer.js';

/**
 * Đặt STD_RENDER_OUT=<thư mục> để ghi ra file mẫu và mở bằng Word / Excel / trình đọc PDF kiểm tra bằng mắt.
 * Ảnh logo thử: STD_RENDER_LOGO=<file png>.
 */
const OUT = process.env['STD_RENDER_OUT'];

// PNG 8×4 px hợp lệ (đỏ) — đủ để kiểm đường đi của ảnh khi không có logo thật.
function tinyPng(w = 8, h = 4): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, Buffer.from([200, 30, 30]))])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TINY_PNG = tinyPng();
const LOGO = process.env['STD_RENDER_LOGO'] ? fs.readFileSync(process.env['STD_RENDER_LOGO']) : TINY_PNG;
const LOGO_ID = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

const meta = { generatedAt: new Date('2026-11-12T03:05:00Z'), generatedByEmail: 'vanthu@uel.edu.vn', generatedByName: 'Nguyễn Thị Văn Thư' };

const model = (n: number): ReportModel => ({
  type: 'gate-access',
  title: 'Ra vào cổng',
  period: { from: '2026-11-02', to: '2026-11-08' },
  filterLines: ['Cổng: Cổng chính', 'Đối tượng: Cán bộ & sinh viên'],
  kpis: [
    { key: 'entries', label: 'Tổng lượt vào', value: 12345, format: 'number' },
    { key: 'exits', label: 'Tổng lượt ra', value: 12001, format: 'number' },
    { key: 'onSite', label: 'Đang trong khuôn viên tại thời điểm trích xuất', value: 344, format: 'number' },
    { key: 'avgStayMinutes', label: 'Thời gian lưu lại trung bình', value: 187, format: 'minutes' },
  ],
  charts: [],
  columns: [
    { key: 'time', label: 'Thời điểm', format: 'datetime' },
    { key: 'fullName', label: 'Họ tên', format: 'text' },
    { key: 'gate', label: 'Cổng', format: 'text' },
    { key: 'direction', label: 'Chiều', format: 'text' },
    { key: 'stay', label: 'Thời gian lưu lại', format: 'duration' },
  ],
  rows: Array.from({ length: n }, (_, i) => ({
    time: new Date(Date.UTC(2026, 10, 2 + (i % 7), 1 + (i % 10), (i * 7) % 60)).toISOString(),
    fullName: ['Nguyễn Thị Hồng Ánh', 'Trần Đức Lộc', 'Lê Hoàng Yến Nhi', 'A <b> & "Tên" lạ'][i % 4],
    gate: i % 3 ? 'Cổng chính' : 'Cổng phụ đường số 6',
    direction: i % 2 ? 'Ra' : 'Vào',
    stay: i % 5 === 0 ? null : 3600 + i * 97,
  })),
  total: n,
  notes: ['Số liệu không gồm khách vãng lai chưa đăng ký.'],
});

const sigs: ResolvedSignature[] = [
  { id: 'maker', authority: '', title: 'NGƯỜI LẬP BIỂU', fullName: 'Nguyễn Thị Văn Thư' },
  { id: 'head', authority: 'TL. HIỆU TRƯỞNG', title: 'TRƯỞNG PHÒNG HÀNH CHÍNH', fullName: 'Trần Văn Trưởng' },
];

function layout(patch: (l: ReportTemplateLayout) => void = () => {}): ReportTemplateLayout {
  const l = defaultLayout();
  patch(l);
  return l;
}
const withImages = layout((l) => {
  l.logo = { enabled: true, mediaFileId: LOGO_ID, position: 'margin', widthMm: 19 };
  l.watermark = { enabled: true, mediaFileId: LOGO_ID, opacity: 0.08, widthPct: 60 };
});
const input = (l: ReportTemplateLayout, s = sigs) => ({ layout: l, assets: { [LOGO_ID]: LOGO }, signatures: s });

async function dump(name: string, buf: Buffer): Promise<void> {
  if (!OUT) return;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), buf);
}

describe('buildStandardContext', () => {
  it('ngày tháng theo NĐ30 (ngày < 10 và tháng 1–2 thêm số 0), số ký hiệu, mục La Mã', () => {
    const c = buildStandardContext(model(1), { ...meta, generatedAt: new Date('2027-02-04T20:00:00Z') }, input(defaultLayout()));
    expect(c.dateLine).toBe('Thành phố Hồ Chí Minh, ngày 05 tháng 02 năm 2027'); // 20:00Z = 03:00 hôm sau giờ VN
    expect(c.docNo).toBe('Số:       /BC-ĐHKTL-HC');
    expect(c.sections.filter((s) => s.heading).map((s) => s.heading)).toEqual(['I. PHẠM VI VÀ NGUỒN DỮ LIỆU', 'II. KẾT QUẢ TỔNG HỢP', 'III. ĐÁNH GIÁ VÀ KIẾN NGHỊ']);
    expect(c.kpis[3]).toMatchObject({ unit: 'phút', text: '187' });
    expect(c.kpis[0]).toMatchObject({ unit: 'lượt', text: '12.345' });
    const nov = buildStandardContext(model(1), meta, input(defaultLayout()));
    expect(nov.dateWords).toBe('ngày 12 tháng 11 năm 2026');
  });

  it('tắt nhóm thì không đánh số nhóm đó', () => {
    const l = layout((x) => { x.body = x.body.map((b) => (b.kind === 'scope' ? { ...b, enabled: false } : b)); });
    const c = buildStandardContext(model(1), meta, input(l));
    expect(c.sections.filter((s) => s.heading).map((s) => s.heading)).toEqual(['I. KẾT QUẢ TỔNG HỢP', 'II. ĐÁNH GIÁ VÀ KIẾN NGHỊ']);
  });
});

describe('renderStandardDocx', () => {
  const xmlOf = async (buf: Buffer, file = 'word/document.xml') => (await JSZip.loadAsync(buf)).file(file)!.async('string');

  it('đủ thể thức, đúng thứ tự nhóm, ký tự đặc biệt được thoát, có phụ lục ngang', async () => {
    const buf = await renderStandardDocx(model(30), meta, input(defaultLayout()));
    await dump('quy-chuan.docx', buf);
    const x = await xmlOf(buf);
    const order = ['CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM', 'BÁO CÁO', 'Kính gửi', 'Thực hiện chế độ báo cáo định kỳ', 'I. PHẠM VI', 'II. KẾT QUẢ', 'III. ĐÁNH GIÁ', 'Trên đây là báo cáo', 'NGƯỜI LẬP BIỂU', 'TL. HIỆU TRƯỞNG', 'Trần Văn Trưởng', 'Nơi nhận:', 'PHỤ LỤC'];
    const at = order.map((s) => x.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(x).toContain('A &lt;b&gt; &amp; &quot;Tên&quot; lạ');
    expect(x).toContain('w:orient="landscape"');
    expect(x).toContain('Tổng cộng: 30 bản ghi');
  });

  it('logo nền được làm mờ (alphaModFix trong header), logo nằm ở thân văn bản', async () => {
    const buf = await renderStandardDocx(model(5), meta, input(withImages));
    await dump('quy-chuan-logo.docx', buf);
    const zip = await JSZip.loadAsync(buf);
    const headers = await Promise.all(Object.keys(zip.files).filter((n) => /^word\/header\d*\.xml$/.test(n)).map((n) => zip.file(n)!.async('string')));
    expect(headers.some((h) => h.includes('<a:alphaModFix amt="8000"/>'))).toBe(true);
    expect(headers.join('')).toContain('behindDoc="1"');
    expect(await xmlOf(buf)).not.toContain('alphaModFix');
  });

  it('đổi thứ tự nhóm + tắt phụ lục + một người ký', async () => {
    const l = layout((x) => {
      const [o, scope, summary, a] = x.body;
      x.body = [o, summary, a, scope];
      x.appendix.enabled = false;
    });
    const x = await xmlOf(await renderStandardDocx(model(3), meta, input(l, [sigs[1]])));
    expect(x.indexOf('I. KẾT QUẢ')).toBeLessThan(x.indexOf('III. PHẠM VI'));
    expect(x).not.toContain('PHỤ LỤC');
    expect(x).not.toContain('NGƯỜI LẬP BIỂU');
  });
});

describe('renderStandardXlsx', () => {
  it('2 sheet "Báo cáo" + "Phụ lục"; KPI là số; thời lượng là phân số ngày', async () => {
    const buf = await renderStandardXlsx(model(30), meta, input(defaultLayout()));
    await dump('quy-chuan.xlsx', buf);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Báo cáo', 'Phụ lục']);
    const s = wb.getWorksheet('Báo cáo')!;
    const values: unknown[] = [];
    s.eachRow((r) => r.eachCell((c) => values.push(c.value)));
    expect(values).toContain(12345);
    expect(values).toContain('TL. HIỆU TRƯỞNG');
    const d = wb.getWorksheet('Phụ lục')!;
    expect(d.getCell('A7').value).toBe(1);
    // ExcelJS đọc lại ô [h]:mm thành Date (gốc 30/12/1899) — giá trị lưu vẫn là phân số ngày.
    const stay = d.getCell('F8').value as Date;
    expect((stay.getTime() - Date.UTC(1899, 11, 30)) / 1000).toBeCloseTo(3720, 3);
    expect(d.getCell('F8').numFmt).toBe('[h]:mm');
  });

  it('logo nền là ảnh đầu trang (VML, &G) có độ mờ, Excel vẫn mở lại được', async () => {
    const buf = await renderStandardXlsx(model(5), meta, input(withImages));
    await dump('quy-chuan-logo.xlsx', buf);
    const zip = await JSZip.loadAsync(buf);
    const sheet = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    expect(sheet).toMatch(/<legacyDrawingHF r:id="rIdStWatermark"\/>/);
    expect(sheet).toContain('&amp;G');
    const vml = await zip.file('xl/drawings/vmlDrawingSTWM1.vml')!.async('string');
    expect(vml).not.toContain('gain='); // PNG đã được pha sẵn → không dùng gain/blacklevel
    const media = decodePng(await zip.file('xl/media/st-watermark.png')!.async('nodebuffer'))!;
    const src = decodePng(LOGO)!;
    expect(media.width).toBe(src.width);
    // Điểm đậm nhất của ảnh gốc sau khi pha 8% phải gần trắng: 255 − 0,08 × (255 − c).
    const darkest = (img: typeof src) => { let m = 765; for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3] > 200) m = Math.min(m, img.data[i] + img.data[i + 1] + img.data[i + 2]); return m; };
    expect(darkest(media)).toBeCloseTo(765 - 0.08 * (765 - darkest(src)), -1);
    expect(await zip.file('[Content_Types].xml')!.async('string')).toContain('Extension="vml"');
    const wb = new ExcelJS.Workbook();
    await expect(wb.xlsx.load(buf as never)).resolves.toBeDefined();
  });
});

describe('renderStandardPdf', () => {
  it('ra PDF nhiều trang (thân dọc + phụ lục ngang)', async () => {
    const buf = await renderStandardPdf(model(60), meta, input(withImages));
    await dump('quy-chuan.pdf', buf);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const s = buf.toString('latin1');
    expect((s.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(s).toMatch(/\/MediaBox \[0 0 841\.89 595\.28\]/); // trang ngang
  });

  it('không có dữ liệu: không có phụ lục, vẫn có khối ký', async () => {
    const buf = await renderStandardPdf(model(0), meta, input(defaultLayout()));
    await dump('quy-chuan-rong.pdf', buf);
    expect((buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(buf.toString('latin1')).not.toMatch(/\/MediaBox \[0 0 841/);
  });
});

describe('văn bản tự dựng (render-document)', () => {
  const doc = () => documentModel({
    title: 'Nhật ký ra/vào phòng',
    period: { from: '2026-11-01', to: '2026-11-12' },
    filterLines: ['Phòng: A.101'],
    dataSource: 'Hệ thống VISMA (camera nhận diện tại cửa phòng)',
    kpis: [{ label: 'Tổng lượt', value: 1234, unit: 'lượt' }, { label: 'Phòng đông nhất', value: 'A.101 (12 lượt)' }],
    notes: ['Chỉ tính lượt có nhận diện.'],
    tables: [
      { title: 'Nhật ký chi tiết', columns: [{ key: 'time', label: 'Thời điểm', format: 'datetime' }, { key: 'name', label: 'Họ tên' }], rows: [{ time: '2026-11-02T01:00:00Z', name: 'Nguyễn A' }, { time: '2026-11-02T02:00:00Z', name: 'Trần B' }] },
      { title: 'Tổng hợp theo phòng', columns: [{ key: 'room', label: 'Phòng' }, { key: 'count', label: 'Số lượt', format: 'number' }], rows: [{ room: 'A.101', count: '12' }] },
      { title: 'Bảng trống', columns: [{ key: 'x', label: 'X' }], rows: [] },
    ],
  });

  it('chuẩn hóa: chỉ tiêu chữ → display, số dạng chuỗi → number, dataSource riêng', () => {
    const m = doc();
    expect(m.type).toBe('document');
    expect(m.kpis[1]).toMatchObject({ value: null, format: 'text', display: 'A.101 (12 lượt)' });
    expect(m.tables![1].rows[0]).toEqual({ room: 'A.101', count: 12 });
    const ctx = buildStandardContext(m, meta, input(defaultLayout()));
    expect(ctx.dataSource).toBe('Hệ thống VISMA (camera nhận diện tại cửa phòng)');
    expect(ctx.kpis.map((k) => [k.unit, k.text])).toEqual([['lượt', '1.234'], ['', 'A.101 (12 lượt)']]);
    expect(ctx.appendixLead).toBe('Chi tiết số liệu được thể hiện tại Phụ lục kèm theo Báo cáo này.');
    expect(ctx.isEmpty).toBe(false);
  });

  it('từ chối dữ liệu sai / quá lớn', () => {
    expect(() => documentModel({ title: 'X', period: { from: '2026-11-12', to: '2026-11-01' } })).toThrow();
    expect(() => documentModel({ title: 'X', period: { from: '2026-11-01', to: '2026-11-02' }, tables: [{ title: 'T', columns: [{ key: 'a b', label: 'A' }], rows: [] }] })).toThrow();
    expect(() => documentModel({ title: 'X', period: { from: '2026-11-01', to: '2026-11-02' }, tables: [{ title: 'T', columns: [{ key: 'n', label: 'N', format: 'number' }], rows: [{ n: 'abc' }] }] })).toThrow();
    const rows = Array.from({ length: 20_001 }, () => ({ a: '1' }));
    expect(() => documentModel({ title: 'X', period: { from: '2026-11-01', to: '2026-11-02' }, tables: [{ title: 'T', columns: [{ key: 'a', label: 'A' }], rows }] })).toThrow();
  });

  it('Word: mỗi bảng có tiêu đề riêng trong phụ lục, bỏ bảng trống', async () => {
    const buf = await renderStandardDocx(doc(), meta, input(defaultLayout()));
    await dump('van-ban.docx', buf);
    const x = await (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');
    expect(x.indexOf('1. Nhật ký chi tiết')).toBeLessThan(x.indexOf('2. Tổng hợp theo phòng'));
    expect(x).not.toContain('Bảng trống');
    expect(x).toContain('A.101 (12 lượt)');
    expect(x).toContain('Hệ thống VISMA');
  });

  it('Excel: "Phụ lục 1", "Phụ lục 2"; chỉ tiêu chữ ghi nguyên chữ', async () => {
    const buf = await renderStandardXlsx(doc(), meta, input(withImages));
    await dump('van-ban.xlsx', buf);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Báo cáo', 'Phụ lục 1', 'Phụ lục 2']);
    const values: unknown[] = [];
    wb.getWorksheet('Báo cáo')!.eachRow((r) => r.eachCell((c) => values.push(c.value)));
    expect(values).toContain('A.101 (12 lượt)');
    expect(values).toContain(1234);
    expect(wb.getWorksheet('Phụ lục 2')!.getCell('C7').value).toBe(12);
    const zip = await JSZip.loadAsync(buf);
    expect(zip.file('xl/drawings/vmlDrawingSTWM3.vml')).toBeTruthy();
  });

  it('PDF: văn bản chỉ có chỉ tiêu (không bảng) không in "không có dữ liệu", không có phụ lục', async () => {
    const m = documentModel({ title: 'Lưu lượng', period: { from: '2026-11-01', to: '2026-11-02' }, kpis: [{ label: 'Tổng', value: 5 }] });
    const ctx = buildStandardContext(m, meta, input(defaultLayout()));
    expect(ctx.isEmpty).toBe(false);
    expect(ctx.appendixLead).toBeNull();
    const buf = await renderStandardPdf(m, meta, input(defaultLayout()));
    await dump('van-ban.pdf', buf);
    expect(buf.toString('latin1')).not.toMatch(/\/MediaBox \[0 0 841/);
  });
});

describe('png-fade', () => {
  it('giải mã PNG RGB 8-bit, mã hóa lại không đổi điểm ảnh', () => {
    const img = decodePng(TINY_PNG)!;
    expect([img.width, img.height]).toEqual([8, 4]);
    expect([...img.data.subarray(0, 4)]).toEqual([200, 30, 30, 255]);
    expect(decodePng(encodePng(img))!.data.equals(img.data)).toBe(true);
  });

  it('pha với nền trắng theo độ mờ, giữ alpha', () => {
    const img = decodePng(fadePng(TINY_PNG, 0.2)!)!;
    expect([...img.data.subarray(0, 4)]).toEqual([244, 210, 210, 255]); // 255 − 0,2 × (255 − c)
  });

  it('PNG bảng màu 2-bit + tRNS, xám + alpha, bộ lọc Paeth/Sub/Up/Average', () => {
    // Bảng màu 4 màu, 2 bit/điểm, 4×2; dòng 1 lọc Sub, dòng 2 lọc Up.
    const idx = [[0, 1, 2, 3], [3, 2, 1, 0]];
    const pack = (r: number[]) => (r[0] << 6) | (r[1] << 4) | (r[2] << 2) | r[3];
    const raw = Buffer.from([1, pack(idx[0]), 2, pack(idx[1]) - pack(idx[0]) & 0xff]);
    const png = rawPng(4, 2, 2, 3, raw, { PLTE: Buffer.from([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]), tRNS: Buffer.from([0, 128]) });
    const img = decodePng(png)!;
    const px = (i: number) => [...img.data.subarray(i * 4, i * 4 + 4)];
    expect([px(0), px(1), px(2), px(3)]).toEqual([[0, 0, 0, 0], [255, 0, 0, 128], [0, 255, 0, 255], [0, 0, 255, 255]]);
    expect(px(4)).toEqual([0, 0, 255, 255]);

    // Xám + alpha 8-bit, 2×2, dòng 2 lọc Average, dòng 1 lọc Paeth.
    const ga = Buffer.from([4, 10, 20, 30, 40, 3, 5, 10, 0, 0]);
    const g = decodePng(rawPng(2, 2, 8, 4, ga))!;
    // Paeth dòng đầu = Sub; Average dòng 2: (trái + trên) >> 1.
    expect([...g.data.subarray(0, 8)]).toEqual([10, 10, 10, 20, 40, 40, 40, 60]);
    expect([...g.data.subarray(8, 16)]).toEqual([10, 10, 10, 20, 25, 25, 25, 40]);
  });

  it('không phải PNG / PNG xen kẽ → null', () => {
    expect(decodePng(Buffer.from('not a png at all, definitely not a png file'))).toBeNull();
    expect(decodePng(rawPng(1, 1, 8, 2, Buffer.from([0, 1, 2, 3]), {}, 1))).toBeNull();
  });
});

function rawPng(w: number, h: number, depth: number, type: number, raw: Buffer, extra: Record<string, Buffer> = {}, interlace = 0): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (kind: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(kind, 'latin1'), data]);
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = type; ihdr[12] = interlace;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    ...Object.entries(extra).map(([k, v]) => chunk(k, v)), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}
