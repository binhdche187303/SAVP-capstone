import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mẫu báo cáo quy chuẩn dựng sẵn "Mẫu chuẩn VISMA (NĐ 30)" — áp dụng cho mọi loại báo cáo, đặt mặc định,
 * để mọi chỗ tải file (Trung tâm báo cáo, Kiểm soát ra vào cổng, Nhật ký ra/vào phòng…) xuất được bản quy chuẩn ngay.
 *
 * - Bố cục đóng băng tại đây (không import từ src) để migration chạy lại vẫn ra đúng nội dung.
 * - Hai ô ký đều TÙY CHỌN để dùng được ngay (bản lưu trữ không cần trưởng phòng ký); muốn bắt buộc
 *   thì sửa mẫu ở màn "Mẫu báo cáo" và chọn người ký mặc định.
 * - Chỉ thêm khi chưa có mẫu mặc định "mọi loại" (unique index UQ_report_templates_default_scope).
 */
const SEED_ID = 'a15a0000-0000-4000-8000-000000000001';

const LAYOUT = {
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
      text: 'Thực hiện chế độ báo cáo, {unit} báo cáo {title} {period} trên cơ sở dữ liệu ghi nhận tự động bởi Hệ thống VISMA, cụ thể như sau:',
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
    { id: 'head', authority: 'TL. HIỆU TRƯỞNG', title: 'TRƯỞNG PHÒNG HÀNH CHÍNH', mode: 'optional', useExporter: false, defaultSigner: null },
  ],
  recipients: { enabled: true, items: ['Ban Giám hiệu (để b/c);', 'Lưu: VT, HC.'] },
  appendix: { enabled: true },
  logo: { enabled: false, mediaFileId: null, position: 'margin', widthMm: 19 },
  watermark: { enabled: false, mediaFileId: null, opacity: 0.08, widthPct: 60 },
  footer: { provenance: true },
};

export class SeedDefaultReportTemplate20261112000002 implements MigrationInterface {
  name = 'SeedDefaultReportTemplate20261112000002';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `INSERT INTO report_templates (id, name, report_type, is_default, layout)
       SELECT $1::uuid, $2, NULL, true, $3::jsonb
        WHERE NOT EXISTS (SELECT 1 FROM report_templates WHERE id = $1::uuid)
          AND NOT EXISTS (SELECT 1 FROM report_templates WHERE report_type IS NULL AND is_default AND deleted_at IS NULL);`,
      [SEED_ID, 'Mẫu chuẩn VISMA (NĐ 30)', JSON.stringify(LAYOUT)],
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM report_templates WHERE id = $1::uuid AND updated_by IS NULL;`, [SEED_ID]);
  }
}
