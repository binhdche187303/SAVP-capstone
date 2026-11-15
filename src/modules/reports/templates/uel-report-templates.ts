import { REPORT_DEFINITIONS, REPORT_TYPE_ORDER } from '../center/report-definition.registry.js';
import type { ReportType } from '../center/report-model.js';
import { defaultLayout, type ReportTemplateLayout } from './report-template.layout.js';

const CONTENT: Record<ReportType, { subject: string; scope: string; assessment: string }> = {
  'staff-attendance': {
    subject: 'Tình hình chuyên cần và thời gian hiện diện của cán bộ',
    scope: 'Đối chiếu ngày công, lượt đi muộn, về sớm, vắng và thời gian hiện diện theo cán bộ, đơn vị trong kỳ. Các trường hợp thiếu lượt ghi nhận cần được đơn vị xác minh trước khi kết luận.',
    assessment: 'Đơn vị bổ sung nguyên nhân biến động chuyên cần, các trường hợp cần đối soát và kiến nghị xử lý sau khi kiểm tra dữ liệu gốc.',
  },
  'student-attendance': {
    subject: 'Tình hình chuyên cần sinh viên theo lớp học phần',
    scope: 'Tổng hợp số buổi học, lượt có mặt, đi muộn, vắng và tỷ lệ chuyên cần theo sinh viên, môn học, lớp học phần và học kỳ. Cảnh báo chuyên cần cần được đối chiếu với lịch học và xác nhận của giảng viên.',
    assessment: 'Đơn vị bổ sung nhận xét về các lớp có biến động chuyên cần, sinh viên cần hỗ trợ và các trường hợp cần giảng viên xác minh.',
  },
  'gate-access': {
    subject: 'Tình hình ra vào và hiện diện trong khuôn viên',
    scope: 'Đối chiếu lượt vào, lượt ra, cổng ghi nhận, đối tượng và thời gian lưu lại theo bộ lọc đã chọn. Trường hợp thiếu lượt ra hoặc vào cần được kiểm tra trước khi xác nhận thời gian hiện diện.',
    assessment: 'Đơn vị bổ sung đánh giá lưu lượng theo cổng, trường hợp thiếu lượt ghi nhận và kiến nghị về vận hành kiểm soát ra vào.',
  },
  'room-utilization': {
    subject: 'Tình hình khai thác và sử dụng phòng họp',
    scope: 'Đối chiếu lịch đặt phòng, thời gian sử dụng, tỷ lệ khai thác, hủy và không sử dụng theo phòng và đơn vị trong kỳ. Dữ liệu ghi nhận tự động cần được so sánh với lịch đặt khi có sai lệch.',
    assessment: 'Đơn vị bổ sung nhận xét về mức sử dụng, phòng ít được khai thác, lịch đặt không sử dụng và kiến nghị điều phối phòng.',
  },
  vehicle: {
    subject: 'Tình hình phương tiện ra vào khuôn viên',
    scope: 'Đối chiếu lượt phương tiện, biển số, loại xe, hướng di chuyển và cổng ghi nhận theo kỳ báo cáo. Các biển số chưa nhận diện hoặc chưa khớp hồ sơ phải được kiểm tra trên dữ liệu gốc.',
    assessment: 'Đơn vị bổ sung nhận xét về lưu lượng phương tiện, sai lệch nhận diện biển số và kiến nghị vận hành bãi xe, camera hoặc cổng.',
  },
  visitor: {
    subject: 'Tình hình đăng ký và tiếp đón khách đến làm việc',
    scope: 'Đối chiếu đăng ký khách, người được gặp, đơn vị tiếp đón, thời gian và trạng thái lượt khách. Dữ liệu tổng hợp theo khoảng ngày và các tiêu chí đang áp dụng khi xuất.',
    assessment: 'Đơn vị bổ sung nhận xét về công tác tiếp đón, lượt khách cần xác minh, trường hợp quá thời gian và kiến nghị phối hợp xử lý.',
  },
  'security-alert': {
    subject: 'Tình hình cảnh báo và xử lý sự kiện an ninh',
    scope: 'Đối chiếu số lượng, loại, mức độ, khu vực và trạng thái xử lý cảnh báo trong kỳ. Cảnh báo tự động là thông tin cần xác minh, không thay thế kết luận của người có trách nhiệm.',
    assessment: 'Đơn vị bổ sung đánh giá cảnh báo chưa xử lý, sự kiện đã xác minh, nguyên nhân lặp lại và kiến nghị biện pháp khắc phục.',
  },
};

/** Build editable UEL templates; no invented statistics, identities or signing authority. */
export function buildUelReportTemplates(mediaFileId: string): Array<{ name: string; reportType: ReportType; layout: ReportTemplateLayout }> {
  return REPORT_TYPE_ORDER.map(reportType => {
    const content = CONTENT[reportType];
    const layout = defaultLayout();
    layout.header.unitName = 'Đơn vị lập báo cáo';
    layout.header.unitCode = 'VISMA';
    layout.title.subject = content.subject;
    layout.body.find(block => block.kind === 'opening')!.text = 'Thực hiện chế độ báo cáo định kỳ, {unit} tổng hợp {title} {period} trên cơ sở dữ liệu ghi nhận từ Hệ thống VISMA, cụ thể như sau:';
    layout.logo = { enabled: true, mediaFileId, position: 'top-left', widthMm: 20 };
    layout.body.splice(2, 0, {
      id: 'business-scope', kind: 'text', enabled: true,
      title: 'NỘI DUNG VÀ NGUYÊN TẮC ĐỐI SOÁT', text: content.scope,
    });
    layout.body.find(block => block.kind === 'assessment')!.text = content.assessment;
    layout.signatures = [
      { id: 'maker', authority: '', title: 'NGƯỜI LẬP BIỂU', mode: 'optional', useExporter: true, defaultSigner: null },
      { id: 'head', authority: '', title: 'NGƯỜI DUYỆT', mode: 'optional', useExporter: false, defaultSigner: null },
    ];
    layout.recipients.items = ['Ban Giám hiệu (để báo cáo);', 'Đơn vị liên quan (để phối hợp);', 'Lưu: Đơn vị lập báo cáo.'];
    return { name: `Mẫu UEL - ${REPORT_DEFINITIONS[reportType].title}`, reportType, layout };
  });
}
