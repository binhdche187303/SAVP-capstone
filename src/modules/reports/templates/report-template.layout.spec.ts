import {
  assertSignerDefaults, defaultLayout, fillText, LayoutError, layoutMediaIds, normalizeLayout, resolveSignatures,
  type ReportTemplateLayout,
} from './report-template.layout.js';

const clone = (): ReportTemplateLayout => JSON.parse(JSON.stringify(defaultLayout())) as ReportTemplateLayout;
const MEDIA = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

describe('normalizeLayout', () => {
  it('mẫu mặc định hợp lệ và giữ nguyên sau khi chuẩn hóa', () => {
    expect(normalizeLayout(defaultLayout())).toEqual(defaultLayout());
  });

  it('thiếu trường thì lấy mặc định', () => {
    const l = normalizeLayout({ header: { agency: 'TRƯỜNG ABC', agencyUnderline: '' } });
    expect(l.header.agency).toBe('TRƯỜNG ABC');
    expect(l.body.map((b) => b.kind)).toEqual(defaultLayout().body.map((b) => b.kind));
    expect(l.signatures).toHaveLength(defaultLayout().signatures.length);
  });

  it('đổi chỗ nhóm nội dung được, nhưng "mở đầu" phải đứng đầu', () => {
    const l = clone();
    const [opening, scope, summary, assessment] = l.body;
    expect(normalizeLayout({ ...l, body: [opening, summary, scope, assessment] }).body.map((b) => b.kind)).toEqual(['opening', 'summary', 'scope', 'assessment']);
    expect(() => normalizeLayout({ ...l, body: [scope, opening, summary] })).toThrow(LayoutError);
  });

  it('mỗi nhóm có sẵn chỉ một lần, tối đa 6 khối văn bản tự do', () => {
    const l = clone();
    expect(() => normalizeLayout({ ...l, body: [...l.body, { ...l.body[1], id: 'scope2' }] })).toThrow(/một lần|trùng/i);
    const texts = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, kind: 'text', enabled: true, title: 'Mục', text: 'x' }));
    expect(() => normalizeLayout({ ...l, body: [...l.body, ...texts] })).toThrow(LayoutError);
  });

  it('chữ gạch chân phải nằm trong tên cơ quan', () => {
    const l = clone();
    expect(() => normalizeLayout({ ...l, header: { ...l.header, agencyUnderline: 'KHÔNG CÓ' } })).toThrow(LayoutError);
  });

  it('bật logo / logo nền thì phải có ảnh; tối đa 3 ô ký', () => {
    const l = clone();
    expect(() => normalizeLayout({ ...l, logo: { ...l.logo, enabled: true, mediaFileId: null } })).toThrow(/logo/i);
    expect(layoutMediaIds(normalizeLayout({ ...l, watermark: { ...l.watermark, enabled: true, mediaFileId: MEDIA } }))).toEqual([MEDIA]);
    const s = l.signatures[0];
    expect(() => normalizeLayout({ ...l, signatures: [1, 2, 3, 4].map((i) => ({ ...s, id: `s${i}` })) })).toThrow(LayoutError);
  });

  it('độ mờ ngoài khoảng cho phép bị từ chối', () => {
    const l = clone();
    expect(() => normalizeLayout({ ...l, watermark: { ...l.watermark, opacity: 0.9 } })).toThrow(LayoutError);
  });
});

describe('assertSignerDefaults', () => {
  it('ô bắt buộc chưa có người ký mặc định thì không lưu được', () => {
    const l = clone();
    expect(() => assertSignerDefaults(l)).toThrow(/người ký mặc định/);
    l.signatures = l.signatures.map((s) => (s.mode === 'required' ? { ...s, defaultSigner: { userId: null, fullName: 'Nguyễn Văn A' } } : s));
    expect(() => assertSignerDefaults(l)).not.toThrow();
  });
});

describe('resolveSignatures', () => {
  const slots = (): ReportTemplateLayout['signatures'] => [
    { id: 'maker', authority: '', title: 'NGƯỜI LẬP BIỂU', mode: 'optional', useExporter: true, defaultSigner: null },
    { id: 'head', authority: 'TL. HIỆU TRƯỞNG', title: 'TRƯỞNG PHÒNG', mode: 'required', useExporter: false, defaultSigner: { userId: null, fullName: 'Trần Thị B' } },
    { id: 'hidden', authority: '', title: 'ẨN', mode: 'hidden', useExporter: false, defaultSigner: null },
  ];
  const me = { fullName: 'Lê Văn Xuất' };

  it('không chọn gì: dùng mặc định của mẫu, ô "người xuất" lấy tên người xuất, ô ẩn bỏ qua', () => {
    expect(resolveSignatures(slots(), undefined, me)).toEqual([
      { id: 'maker', authority: '', title: 'NGƯỜI LẬP BIỂU', fullName: 'Lê Văn Xuất' },
      { id: 'head', authority: 'TL. HIỆU TRƯỞNG', title: 'TRƯỞNG PHÒNG', fullName: 'Trần Thị B' },
    ]);
  });

  it('đổi người ký được; bỏ ô tùy chọn được; ô bắt buộc không bỏ được', () => {
    const r = resolveSignatures(slots(), { head: { userId: null, fullName: 'Phạm C' }, maker: null }, me);
    expect(r.map((x) => [x.id, x.fullName])).toEqual([['head', 'Phạm C']]);
    expect(() => resolveSignatures(slots(), { head: null }, me)).toThrow(/bắt buộc/);
  });

  it('ô bắt buộc không có tên nào thì báo cần chọn người ký', () => {
    const s = slots();
    s[1].defaultSigner = null;
    expect(() => resolveSignatures(s, undefined, me)).toThrow(/chọn người ký/);
  });
});

describe('fillText', () => {
  it('thay {title} {period} {unit}, giữ nguyên chữ khác', () => {
    expect(fillText('Báo cáo {title} {period} của {unit} {x}', { title: 'ra vào cổng', period: 'từ ngày 01/11/2026', unit: 'Phòng HC' }))
      .toBe('Báo cáo ra vào cổng từ ngày 01/11/2026 của Phòng HC {x}');
  });
});
