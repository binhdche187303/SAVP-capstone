import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thêm dấu tiếng Việt cho tên quyền (permissions.permission_name) đang lưu không dấu.
 * Tên này hiển thị trực tiếp trên màn Vai trò & Phân quyền.
 * Chỉ cập nhật khi tên hiện tại vẫn đúng bằng bản không dấu cũ (không ghi đè tên đã được sửa tay).
 */
const NAMES: Array<[code: string, oldName: string, newName: string]> = [
  // accounts
  ['account.role.create', 'Tao role moi', 'Tạo vai trò mới'],
  ['account.role.delete', 'Xoa role', 'Xóa vai trò'],
  ['account.role.read', 'Xem role', 'Xem vai trò'],
  ['account.role.update', 'Cap nhat role', 'Cập nhật vai trò'],
  ['account.user.read.detail', 'Xem chi tiet nguoi dung', 'Xem chi tiết người dùng'],
  ['accounts.user.create', 'Tao tai khoan nguoi dung', 'Tạo tài khoản người dùng'],
  ['accounts.user.export', 'Xuat danh sach nguoi dung ra file', 'Xuất danh sách người dùng ra file'],
  ['admin.manage_permissions', 'Quan ly permission he thong', 'Quản lý quyền hệ thống'],
  ['department.deactivate', 'Vo hieu hoa / kich hoat lai phong ban', 'Vô hiệu hóa / kích hoạt lại phòng ban'],
  ['department.update', 'Cap nhat phong ban', 'Cập nhật phòng ban'],
  ['permission.read', 'Xem danh sach permission', 'Xem danh sách quyền'],
  // administration
  ['admin.manage_config', 'Quan tri cau hinh he thong', 'Quản trị cấu hình hệ thống'],
  // alerts
  ['alert_rules.create', 'Tao rule canh bao', 'Tạo quy tắc cảnh báo'],
  ['alert_rules.delete', 'Xoa rule canh bao', 'Xóa quy tắc cảnh báo'],
  ['alert_rules.read', 'Xem rule canh bao', 'Xem quy tắc cảnh báo'],
  ['alert_rules.update', 'Sua rule canh bao', 'Sửa quy tắc cảnh báo'],
  ['person_control_list.create', 'Them nguoi vao danh sach kiem soat', 'Thêm người vào danh sách kiểm soát'],
  ['person_control_list.delete', 'Xoa nguoi khoi danh sach kiem soat', 'Xóa người khỏi danh sách kiểm soát'],
  ['person_control_list.read', 'Xem danh sach kiem soat nguoi', 'Xem danh sách kiểm soát người'],
  ['person_control_list.update', 'Sua ban ghi trong danh sach kiem soat nguoi', 'Sửa bản ghi trong danh sách kiểm soát người'],
  ['security_alert.acknowledge', 'Nhan xu ly canh bao an ninh', 'Nhận xử lý cảnh báo an ninh'],
  ['security_alert.read', 'Xem trung tam canh bao an ninh', 'Xem trung tâm cảnh báo an ninh'],
  ['security_alert.resolve', 'Dong canh bao an ninh', 'Đóng cảnh báo an ninh'],
  ['security_alerts.configure', 'Cau hinh nguong auto-resolve canh bao an ninh', 'Cấu hình ngưỡng tự đóng cảnh báo an ninh'],
  // analytics
  ['analytics.attendance.read', 'Xem thong ke ty le tham du dung gio', 'Xem thống kê tỷ lệ tham dự đúng giờ'],
  ['analytics.audit_activity.read', 'Xem hoat dong audit log theo gio (Dashboard)', 'Xem hoạt động nhật ký hệ thống theo giờ (Dashboard)'],
  ['analytics.meeting.read', 'Xem thong ke cuoc hop', 'Xem thống kê cuộc họp'],
  ['analytics.overview.read', 'Xem dashboard tong quan he thong', 'Xem dashboard tổng quan hệ thống'],
  ['analytics.room.read', 'Xem dashboard su dung phong hop', 'Xem dashboard sử dụng phòng họp'],
  ['analytics.security_alerts.read', 'Xem xu huong canh bao an ninh theo ngay (Dashboard)', 'Xem xu hướng cảnh báo an ninh theo ngày (Dashboard)'],
  // anpr
  ['anpr.vehicle.admin_read', 'Admin xem & tra cuu phuong tien', 'Admin xem & tra cứu phương tiện'],
  ['anpr.vehicle.admin_register', 'Dang ky bien so ho user (admin)', 'Đăng ký biển số hộ người dùng (admin)'],
  ['anpr.vehicle.history_view', 'Xem lich su ra vao bien so (admin)', 'Xem lịch sử ra vào biển số (admin)'],
  ['anpr.vehicle.unknown_view', 'Xem danh sach bien so la (admin)', 'Xem danh sách biển số lạ (admin)'],
  ['vehicle_alert.read', 'Xem canh bao xe khong co quyen', 'Xem cảnh báo xe không có quyền'],
  ['vehicle_control.create', 'Them bien so vao danh sach kiem soat', 'Thêm biển số vào danh sách kiểm soát'],
  ['vehicle_control.delete', 'Xoa bien so khoi danh sach kiem soat', 'Xóa biển số khỏi danh sách kiểm soát'],
  ['vehicle_control.read', 'Xem danh sach kiem soat phuong tien', 'Xem danh sách kiểm soát phương tiện'],
  ['vehicle_control.update', 'Sua bien so trong danh sach kiem soat', 'Sửa biển số trong danh sách kiểm soát'],
  // audit
  ['audit.system.read', 'Xem nhat ky kiem tra he thong', 'Xem nhật ký kiểm tra hệ thống'],
  ['audit.users.read', 'Xem lich su hoat dong cua tai khoan', 'Xem lịch sử hoạt động của tài khoản'],
  // campus_dashboard
  ['campus_dashboard.overview.read', 'Xem dashboard dieu hanh khuon vien', 'Xem dashboard điều hành khuôn viên'],
  ['campus_dashboard.timeline.read', 'Xem timeline khu vuc', 'Xem dòng thời gian khu vực'],
  ['campus_dashboard.traffic.read', 'Xem luu luong va heatmap khu vuc', 'Xem lưu lượng và heatmap khu vực'],
  // classroom
  ['class.attendance.export', 'Xuat bang chuyen can lop hoc', 'Xuất bảng chuyên cần lớp học'],
  ['class.attendance.manage', 'Quan ly diem danh lop hoc', 'Quản lý điểm danh lớp học'],
  ['class.attendance.read.self', 'Xem chuyen can ca nhan', 'Xem chuyên cần cá nhân'],
  ['class.attendance.stats.read', 'Xem thong ke chuyen can lop hoc', 'Xem thống kê chuyên cần lớp học'],
  // equipment
  ['equipment.confirm_fault', 'Xac nhan loi thiet bi la that', 'Xác nhận lỗi thiết bị là thật'],
  ['equipment.resolve_fault', 'Cap nhat thiet bi da sua xong', 'Cập nhật thiết bị đã sửa xong'],
  // gate_access
  ['gate.access.alert.handle', 'Xu ly canh bao ra vao cong', 'Xử lý cảnh báo ra vào cổng'],
  ['gate.access.monitor', 'Truc giam sat cong ra vao', 'Trực giám sát cổng ra vào'],
  ['gate.access.read', 'Xem nhat ky ra vao cong', 'Xem nhật ký ra vào cổng'],
  // guest-access
  ['meeting.guest.admit', 'Duyet khach ngoai cong ty vao phong cho', 'Duyệt khách bên ngoài vào phòng chờ'],
  ['meeting.guest.invite.manage', 'Quan ly loi moi khach ngoai cong ty', 'Quản lý lời mời khách bên ngoài'],
  ['meeting.guest.session.read', 'Xem danh sach khach dang truy cap', 'Xem danh sách khách đang truy cập'],
  // iot
  ['iot.device.configure_ai', 'Cau hinh chuc nang AI cua camera', 'Cấu hình chức năng AI của camera'],
  // ivss
  ['ivss.access_log.read', 'Xem nhat ky ra/vao phong (IVSS access log)', 'Xem nhật ký ra/vào phòng (IVSS)'],
  ['ivss.portrait.manage', 'Quan tri dong bo kho chan dung thuong truc (IVSS portrait)', 'Quản trị đồng bộ kho chân dung thường trực (IVSS)'],
  // live-meeting
  ['attendance.read', 'Xem trang thai diem danh cuoc hop', 'Xem trạng thái điểm danh cuộc họp'],
  ['meeting.note.create', 'Tao ghi chu trong cuoc hop', 'Tạo ghi chú trong cuộc họp'],
  ['meeting.note.read', 'Xem ghi chu trong cuoc hop', 'Xem ghi chú trong cuộc họp'],
  ['meeting.presence.read', 'Xem danh sach nguoi tham du dang co mat', 'Xem danh sách người tham dự đang có mặt'],
  ['meeting.session.end', 'Ket thuc phien hop', 'Kết thúc phiên họp'],
  ['meeting.session.end.any', 'Ket thuc phien hop - tat ca', 'Kết thúc mọi phiên họp'],
  ['meeting.timeline.read', 'Xem timeline cuoc hop', 'Xem dòng thời gian cuộc họp'],
  // meetings
  ['meeting.create', 'Tao cuoc hop moi', 'Tạo cuộc họp mới'],
  ['meeting.read.all', 'Xem danh sach tat ca cuoc hop (admin)', 'Xem danh sách tất cả cuộc họp (admin)'],
  ['meeting.update.own', 'Cap nhat thong tin co ban cuoc hop cua minh', 'Cập nhật thông tin cơ bản cuộc họp của mình'],
  ['schedule.read.self', 'Xem lich ca nhan', 'Xem lịch cá nhân'],
  // minutes
  ['meeting.minutes.ai_draft.create', 'Tao bien ban hop nhap bang AI', 'Tạo biên bản họp nháp bằng AI'],
  ['meeting.minutes.attachment.create', 'Dinh kem tai lieu vao bien ban', 'Đính kèm tài liệu vào biên bản'],
  ['meeting.minutes.attachment.delete', 'Go tai lieu dinh kem khoi bien ban', 'Gỡ tài liệu đính kèm khỏi biên bản'],
  ['meeting.minutes.attachment.read', 'Xem danh sach tai lieu dinh kem cua bien ban', 'Xem danh sách tài liệu đính kèm của biên bản'],
  ['meeting.minutes.create', 'Tao bien ban hop nhap', 'Tạo biên bản họp nháp'],
  ['meeting.minutes.delete', 'Xoa bien ban hop nhap', 'Xóa biên bản họp nháp'],
  ['meeting.minutes.export', 'Xuat bien ban cuoc hop', 'Xuất biên bản cuộc họp'],
  ['meeting.minutes.issue', 'Ban hanh bien ban hop chinh thuc', 'Ban hành biên bản họp chính thức'],
  ['meeting.minutes.link_resources', 'Lien ket recording/transcript voi bien ban', 'Liên kết bản ghi hình/transcript với biên bản'],
  ['meeting.minutes.read', 'Xem danh sach bien ban hop', 'Xem danh sách biên bản họp'],
  ['meeting.minutes.search_by_person', 'Tim kiem bien ban hop theo nhan su', 'Tìm kiếm biên bản họp theo nhân sự'],
  ['meeting.minutes.share.create', 'Chia se bien ban cho nguoi dung cu the', 'Chia sẻ biên bản cho người dùng cụ thể'],
  ['meeting.minutes.share.delete', 'Thu hoi quyen xem bien ban da chia se', 'Thu hồi quyền xem biên bản đã chia sẻ'],
  ['meeting.minutes.share.read', 'Xem danh sach chia se cua bien ban', 'Xem danh sách chia sẻ của biên bản'],
  ['meeting.minutes.update', 'Cap nhat bien ban hop nhap', 'Cập nhật biên bản họp nháp'],
  ['minutes.distribute', 'Phan phoi bien ban hop', 'Phân phối biên bản họp'],
  // notifications
  ['notification.cancellation.send', 'Gui lai thong bao huy hop', 'Gửi lại thông báo hủy họp'],
  ['notification.invite.send', 'Gui thu moi hop', 'Gửi thư mời họp'],
  ['notification.read.self', 'Xem thong bao ca nhan', 'Xem thông báo cá nhân'],
  ['notification.reminder.send', 'Gui nhac lich hop', 'Gửi nhắc lịch họp'],
  ['notification.update.self', 'Danh dau thong bao ca nhan da doc', 'Đánh dấu thông báo cá nhân đã đọc'],
  // recording
  ['recording.upload_track', 'Upload audio track cho meeting', 'Tải lên bản ghi âm cho cuộc họp'],
  // reports
  ['report.gate_access.export', 'Xuat bao cao ra vao khuon vien', 'Xuất báo cáo ra vào khuôn viên'],
  ['report.meeting_activity.export', 'Xuat bao cao hoat dong cuoc hop', 'Xuất báo cáo hoạt động cuộc họp'],
  ['report.room_utilization.export', 'Xuat bao cao su dung phong hop', 'Xuất báo cáo sử dụng phòng họp'],
  ['report.security_alert.export', 'Xuat bao cao su kien an ninh', 'Xuất báo cáo sự kiện an ninh'],
  ['report.vehicle.export', 'Xuat bao cao phuong tien', 'Xuất báo cáo phương tiện'],
  // rooms
  ['room.booking.read', 'Xem danh sach dat phong', 'Xem danh sách đặt phòng'],
  ['room.detail.read', 'Xem chi tiet phong hop (day du)', 'Xem chi tiết phòng họp (đầy đủ)'],
  // scheduling
  ['scheduling.suggest.rooms', 'Goi y phong hop phu hop', 'Gợi ý phòng họp phù hợp'],
  ['scheduling.suggest.times', 'Goi y khung gio hop toi uu', 'Gợi ý khung giờ họp tối ưu'],
  // transcription
  ['transcript.create', 'Tao transcription job', 'Tạo tác vụ chuyển giọng nói thành văn bản'],
  ['transcript.read', 'Xem transcript cuoc hop', 'Xem transcript cuộc họp'],
  ['transcript.speaker_tag', 'Gan ten hang loat cho cum giong noi', 'Gán tên hàng loạt cho cụm giọng nói'],
  ['transcript.update', 'Sua transcript thu cong', 'Sửa transcript thủ công'],
  // zones
  ['zones.gate_log.read', 'Admin xem & tra cuu lich su ra/vao cong', 'Admin xem & tra cứu lịch sử ra/vào cổng'],
  ['zones.zone.assign_device', 'Gan thiet bi vao khu vuc', 'Gán thiết bị vào khu vực'],
  ['zones.zone.create', 'Tao khu vuc', 'Tạo khu vực'],
  ['zones.zone.delete', 'Xoa khu vuc', 'Xóa khu vực'],
  ['zones.zone.read', 'Xem khu vuc', 'Xem khu vực'],
  ['zones.zone.update', 'Cap nhat khu vuc', 'Cập nhật khu vực'],
];

export class AccentPermissionNames20261117000001 implements MigrationInterface {
  name = 'AccentPermissionNames20261117000001';

  async up(q: QueryRunner): Promise<void> {
    for (const [code, oldName, newName] of NAMES) {
      await q.query(
        `UPDATE permissions SET permission_name = $3, updated_at = NOW()
          WHERE permission_code = $1 AND permission_name = $2`,
        [code, oldName, newName],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    for (const [code, oldName, newName] of NAMES) {
      await q.query(
        `UPDATE permissions SET permission_name = $2, updated_at = NOW()
          WHERE permission_code = $1 AND permission_name = $3`,
        [code, oldName, newName],
      );
    }
  }
}
