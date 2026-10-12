/**
 * Per-feature branded email builders. Mỗi hàm nhận dữ liệu đã có sẵn tại
 * call site (không query thêm) và trả về HTML hoàn chỉnh (dùng renderEmailLayout).
 */
import {
  escapeHtml,
  formatDateTimeVN,
  renderCallout,
  renderEmailLayout,
  renderInfoTable,
  renderList,
  renderParagraph,
  type InfoRow,
} from './layout.js';

// ── Auth ──────────────────────────────────────────────────────────────────

export function buildOtpEmail(params: {
  otp: string;
  expiresMinutes: number;
}): string {
  const bodyHtml =
    renderParagraph('Kính gửi bạn,') +
    renderParagraph(
      'Bạn (hoặc ai đó dùng email này) đã gửi yêu cầu đặt lại mật khẩu trên hệ thống Smart Meeting Management. Mã OTP xác thực của bạn là:',
    ) +
    `<div style="text-align:center;margin:8px 0 20px;">
      <span style="display:inline-block;font-size:28px;font-weight:700;letter-spacing:6px;color:#1e3a8a;background-color:#eff6ff;padding:14px 28px;border-radius:8px;">${escapeHtml(params.otp)}</span>
    </div>` +
    renderCallout(
      `Mã OTP có hiệu lực trong vòng <strong>${params.expiresMinutes} phút</strong>. Để bảo mật, vui lòng không chia sẻ mã này cho bất kỳ ai.`,
      'warning',
    ) +
    renderParagraph(
      'Nếu bạn không gửi yêu cầu này, vui lòng bỏ qua email này và kiểm tra lại bảo mật tài khoản.',
    );
  return renderEmailLayout({ heading: 'Khôi phục mật khẩu', bodyHtml });
}

// ── Accounts ──────────────────────────────────────────────────────────────

export function buildAccountWelcomeEmail(params: {
  fullName: string;
  email: string;
  tempPassword: string;
}): string {
  const bodyHtml =
    renderParagraph(
      `Kính gửi <strong>${escapeHtml(params.fullName)}</strong>,`,
    ) +
    renderParagraph(
      'Tài khoản Smart Meeting Management của bạn đã được tạo thành công. Dưới đây là thông tin đăng nhập:',
    ) +
    renderInfoTable([
      { label: 'Email đăng nhập', value: escapeHtml(params.email) },
      {
        label: 'Mật khẩu tạm thời',
        value: `<code style="background-color:#f3f4f6;padding:2px 8px;border-radius:4px;">${escapeHtml(params.tempPassword)}</code>`,
      },
    ]) +
    renderCallout(
      'Vì lý do bảo mật, vui lòng đăng nhập và đổi mật khẩu ngay trong lần đăng nhập đầu tiên.',
      'warning',
    );
  return renderEmailLayout({
    heading: 'Tài khoản của bạn đã được tạo',
    bodyHtml,
  });
}

export function buildPartnerAccountWelcomeEmail(params: {
  fullName: string;
  email: string;
  expiresAt: Date | string;
}): string {
  const bodyHtml =
    renderParagraph(
      `Kính gửi <strong>${escapeHtml(params.fullName)}</strong>,`,
    ) +
    renderParagraph(
      'Tài khoản Smart Meeting Management dành cho đối tác đã được tạo thành công.',
    ) +
    renderInfoTable([
      { label: 'Email đăng nhập', value: escapeHtml(params.email) },
      {
        label: 'Hạn sử dụng tài khoản',
        value: escapeHtml(formatDateTimeVN(params.expiresAt)),
      },
    ]) +
    renderCallout(
      'Mật khẩu đăng nhập chính là địa chỉ email này. Vui lòng không chia sẻ thông tin đăng nhập với người khác.',
      'info',
    );
  return renderEmailLayout({
    heading: 'Tài khoản đối tác đã được tạo',
    bodyHtml,
  });
}
// ── Meetings ──────────────────────────────────────────────────────────────

export function buildMeetingInviteEmail(params: {
  meetingTitle: string;
  startTime?: Date | string;
  endTime?: Date | string;
  roomName?: string | null;
  message?: string | null;
  agendaItems?: string[];
}): string {
  const rows: InfoRow[] = [
    {
      label: 'Cuộc họp',
      value: `<strong>${escapeHtml(params.meetingTitle)}</strong>`,
    },
  ];
  if (params.startTime && params.endTime) {
    rows.push({
      label: 'Thời gian',
      value: `${escapeHtml(formatDateTimeVN(params.startTime))} &ndash; ${escapeHtml(formatDateTimeVN(params.endTime))}`,
    });
  } else if (params.startTime) {
    rows.push({
      label: 'Bắt đầu',
      value: escapeHtml(formatDateTimeVN(params.startTime)),
    });
  }
  if (params.roomName) {
    rows.push({ label: 'Phòng họp', value: escapeHtml(params.roomName) });
  }

  let bodyHtml =
    renderParagraph('Bạn được mời tham dự cuộc họp sau:') +
    renderInfoTable(rows);
  if (params.agendaItems && params.agendaItems.length > 0) {
    bodyHtml +=
      renderParagraph('<strong>Chương trình họp:</strong>') +
      renderList(params.agendaItems.map((a) => escapeHtml(a)));
  }
  if (params.message) {
    bodyHtml += renderCallout(escapeHtml(params.message), 'info');
  }
  return renderEmailLayout({
    heading: 'Thư mời tham dự cuộc họp',
    bodyHtml,
  });
}

export function buildMeetingReminderEmail(params: {
  meetingTitle: string;
  startTime: Date | string;
  roomName?: string | null;
}): string {
  const rows: InfoRow[] = [
    {
      label: 'Cuộc họp',
      value: `<strong>${escapeHtml(params.meetingTitle)}</strong>`,
    },
    { label: 'Bắt đầu', value: escapeHtml(formatDateTimeVN(params.startTime)) },
  ];
  if (params.roomName) {
    rows.push({ label: 'Phòng họp', value: escapeHtml(params.roomName) });
  }
  const bodyHtml =
    renderParagraph('Đây là email nhắc lịch cho cuộc họp sắp diễn ra:') +
    renderInfoTable(rows) +
    renderParagraph('Vui lòng thu xếp tham dự đúng giờ.');
  return renderEmailLayout({ heading: 'Nhắc lịch họp', bodyHtml });
}

export function buildMeetingTimeUpdatedEmail(params: {
  meetingTitle: string;
  oldStartTime?: Date | string | null;
  oldEndTime?: Date | string | null;
  newStartTime: Date | string;
  newEndTime: Date | string;
  changeReason?: string | null;
}): string {
  const rows: InfoRow[] = [];
  if (params.oldStartTime && params.oldEndTime) {
    rows.push({
      label: 'Thời gian cũ',
      value: `<span style="text-decoration:line-through;color:#9ca3af;">${escapeHtml(formatDateTimeVN(params.oldStartTime))} &ndash; ${escapeHtml(formatDateTimeVN(params.oldEndTime))}</span>`,
    });
  }
  rows.push({
    label: 'Thời gian mới',
    value: `${escapeHtml(formatDateTimeVN(params.newStartTime))} &ndash; ${escapeHtml(formatDateTimeVN(params.newEndTime))}`,
  });
  const bodyHtml =
    renderParagraph(
      `Thời gian của cuộc họp <strong>${escapeHtml(params.meetingTitle)}</strong> đã được cập nhật:`,
    ) +
    renderInfoTable(rows) +
    (params.changeReason
      ? renderCallout(
          `Lý do thay đổi: ${escapeHtml(params.changeReason)}`,
          'info',
        )
      : '');
  return renderEmailLayout({
    heading: 'Cập nhật thời gian cuộc họp',
    bodyHtml,
  });
}

export function buildMeetingRoomUpdatedEmail(params: {
  meetingTitle: string;
  oldRoomName?: string | null;
  newRoomName: string;
  changeReason?: string | null;
}): string {
  const bodyHtml =
    renderParagraph(
      `Phòng họp của cuộc họp <strong>${escapeHtml(params.meetingTitle)}</strong> đã được thay đổi:`,
    ) +
    renderInfoTable([
      {
        label: 'Phòng cũ',
        value: params.oldRoomName
          ? `<span style="text-decoration:line-through;color:#9ca3af;">${escapeHtml(params.oldRoomName)}</span>`
          : '<span style="color:#9ca3af;">(chưa có)</span>',
      },
      { label: 'Phòng mới', value: escapeHtml(params.newRoomName) },
    ]) +
    (params.changeReason
      ? renderCallout(
          `Lý do thay đổi: ${escapeHtml(params.changeReason)}`,
          'info',
        )
      : '');
  return renderEmailLayout({ heading: 'Cập nhật phòng họp', bodyHtml });
}

export function buildMeetingCancelledEmail(params: {
  meetingTitle: string;
  reason?: string | null;
}): string {
  const bodyHtml =
    renderParagraph(
      `Cuộc họp <strong>${escapeHtml(params.meetingTitle)}</strong> đã bị <strong style="color:#991b1b;">hủy</strong>.`,
    ) +
    (params.reason
      ? renderCallout(`Lý do: ${escapeHtml(params.reason)}`, 'danger')
      : '') +
    renderParagraph('Vui lòng cập nhật lại lịch làm việc của bạn.');
  return renderEmailLayout({ heading: 'Cuộc họp đã bị hủy', bodyHtml });
}

export function buildParticipantRemovedEmail(params: {
  meetingTitle: string;
  reason?: string | null;
}): string {
  const bodyHtml =
    renderParagraph(
      `Bạn đã bị gỡ khỏi danh sách tham dự cuộc họp <strong>${escapeHtml(params.meetingTitle)}</strong>.`,
    ) +
    (params.reason
      ? renderCallout(`Lý do: ${escapeHtml(params.reason)}`, 'info')
      : '') +
    renderParagraph(
      'Nếu bạn cho rằng đây là nhầm lẫn, vui lòng liên hệ người tổ chức cuộc họp.',
    );
  return renderEmailLayout({ heading: 'Bạn đã bị gỡ khỏi cuộc họp', bodyHtml });
}

export function buildMinutesPublishedEmail(params: {
  meetingTitle: string;
  minutesTitle: string;
  message?: string | null;
}): string {
  const bodyHtml =
    renderParagraph(
      `Biên bản cuộc họp <strong>${escapeHtml(params.meetingTitle)}</strong> đã được ban hành chính thức.`,
    ) +
    renderInfoTable([
      { label: 'Tiêu đề biên bản', value: escapeHtml(params.minutesTitle) },
    ]) +
    (params.message ? renderCallout(escapeHtml(params.message), 'info') : '') +
    renderParagraph('Vui lòng đăng nhập hệ thống để xem chi tiết biên bản.');
  return renderEmailLayout({
    heading: 'Biên bản họp đã được ban hành',
    bodyHtml,
  });
}

/**
 * Bản email gửi khách ngoài công ty (meeting_external_participants) — khác
 * buildMinutesPublishedEmail ở chỗ KHÔNG mời "đăng nhập hệ thống" (khách không
 * có tài khoản/không còn magic link hợp lệ sau khi họp kết thúc), thay vào đó
 * báo rõ file PDF đã đính kèm trong email này.
 */
export function buildMinutesPublishedGuestEmail(params: {
  meetingTitle: string;
  minutesTitle: string;
  message?: string | null;
}): string {
  const bodyHtml =
    renderParagraph(
      `Biên bản cuộc họp <strong>${escapeHtml(params.meetingTitle)}</strong> đã được ban hành chính thức.`,
    ) +
    renderInfoTable([
      { label: 'Tiêu đề biên bản', value: escapeHtml(params.minutesTitle) },
    ]) +
    (params.message ? renderCallout(escapeHtml(params.message), 'info') : '') +
    renderParagraph('Bản PDF của biên bản được đính kèm trong email này.');
  return renderEmailLayout({
    heading: 'Biên bản họp đã được ban hành',
    bodyHtml,
  });
}

// ── Rooms ─────────────────────────────────────────────────────────────────

export function buildRoomRemovedEmail(params: {
  meetingTitle: string;
  suggestedRooms: { roomName: string; roomCode: string; capacity: number }[];
  isPendingApproval?: boolean;
}): string {
  const bodyHtml =
    renderParagraph(
      `Phòng họp trước đây của cuộc họp <strong>${escapeHtml(params.meetingTitle)}</strong> đã bị quản trị viên gỡ bỏ khỏi hệ thống.`,
    ) +
    renderCallout(
      'Vui lòng chọn lại địa điểm mới cho cuộc họp để tránh gián đoạn.',
      'warning',
    ) +
    (params.isPendingApproval
      ? renderCallout(
          'Cuộc họp này đang chờ phê duyệt và sẽ KHÔNG thể được duyệt cho đến khi người tổ chức chọn lại phòng và gửi lại yêu cầu.',
          'warning',
        )
      : '') +
    (params.suggestedRooms.length > 0
      ? renderParagraph('<strong>Gợi ý phòng thay thế phù hợp:</strong>') +
        renderList(
          params.suggestedRooms.map(
            (r) =>
              `${escapeHtml(r.roomName)} (${escapeHtml(r.roomCode)}) &mdash; sức chứa ${r.capacity} người`,
          ),
        )
      : renderParagraph(
          'Hiện chưa tìm được phòng thay thế phù hợp trong cùng khung giờ.',
        ));
  return renderEmailLayout({
    heading: 'Phòng họp đã bị gỡ bỏ',
    bodyHtml,
  });
}

export function buildEarlyVacancyAlertEmail(params: {
  roomId: string;
  emptyMinutes: number;
}): string {
  const bodyHtml =
    renderParagraph(
      'Hệ thống phát hiện phòng họp đang trống trong khi cuộc họp vẫn được ghi nhận là đang diễn ra:',
    ) +
    renderInfoTable([
      { label: 'Mã phòng', value: escapeHtml(params.roomId) },
      { label: 'Thời gian trống', value: `${params.emptyMinutes} phút` },
    ]) +
    renderParagraph('Vui lòng kiểm tra lại tình trạng cuộc họp.');
  return renderEmailLayout({ heading: 'Cảnh báo phòng trống sớm', bodyHtml });
}

export function buildNoShowAlertEmail(params: {
  kind: 'warning' | 'released';
  roomName: string;
  /**
   * [Việc B, Hướng 2] Link xác nhận "Tôi vẫn đến" — CHỈ truyền khi case còn
   * non-terminal tại thời điểm soạn email (kind='warning'). Với kind='released'
   * phòng đã bị thu hồi, dismiss lúc này vô nghĩa nên KHÔNG chèn nút dù có truyền vào.
   */
  confirmLink?: string;
}): string {
  const isWarning = params.kind === 'warning';
  const bodyHtml =
    renderParagraph(
      isWarning
        ? 'Phòng họp vẫn chưa ghi nhận có người tham dự sau giờ bắt đầu (cảnh báo no-show):'
        : 'Phòng họp đã được tự động giải phóng do không có người tham dự (no-show):',
    ) +
    renderInfoTable([{ label: 'Phòng', value: escapeHtml(params.roomName) }]) +
    (isWarning
      ? renderCallout(
          'Nếu cuộc họp vẫn diễn ra, vui lòng check-in ngay để tránh phòng bị tự động giải phóng.',
          'warning',
        )
      : renderCallout(
          'Phòng đã được mở lại cho người khác đặt sử dụng.',
          'danger',
        )) +
    (isWarning && params.confirmLink
      ? renderGuestLinkButton(params.confirmLink, 'Tôi vẫn đến — giữ phòng')
      : '');
  return renderEmailLayout({
    heading: isWarning ? 'Cảnh báo no-show' : 'Phòng đã được giải phóng',
    bodyHtml,
  });
}

// ── Attendance ────────────────────────────────────────────────────────────

export function buildLateCheckinAlertEmail(params: {
  fullName: string;
  meetingTitle: string;
  roomName?: string | null;
  startTime: Date | string;
  lateMinutes: number;
}): string {
  const rows: InfoRow[] = [
    {
      label: 'Cuộc họp',
      value: `<strong>${escapeHtml(params.meetingTitle)}</strong>`,
    },
    {
      label: 'Giờ bắt đầu',
      value: escapeHtml(formatDateTimeVN(params.startTime)),
    },
    { label: 'Đã trễ', value: `${params.lateMinutes} phút` },
  ];
  if (params.roomName) {
    rows.splice(1, 0, { label: 'Phòng', value: escapeHtml(params.roomName) });
  }
  const bodyHtml =
    renderParagraph(
      `Xin chào <strong>${escapeHtml(params.fullName)}</strong>,`,
    ) +
    renderParagraph('Bạn chưa check-in cho cuộc họp sau:') +
    renderInfoTable(rows) +
    renderCallout(
      'Vui lòng check-in ngay tại phòng họp để đảm bảo được ghi nhận tham dự.',
      'warning',
    );
  return renderEmailLayout({
    heading: 'Nhắc nhở: Bạn chưa check-in',
    bodyHtml,
  });
}

export function buildLateCheckinHostSummaryEmail(params: {
  meetingTitle: string;
  alertedNames: string[];
}): string {
  const bodyHtml =
    renderParagraph('Xin chào,') +
    renderParagraph(
      `Cuộc họp <strong>${escapeHtml(params.meetingTitle)}</strong> đã bắt đầu nhưng có <strong>${params.alertedNames.length}</strong> người tham dự chưa check-in:`,
    ) +
    renderList(params.alertedNames.map((n) => escapeHtml(n))) +
    renderParagraph('Vui lòng kiểm tra và nhắc nhở người tham dự.');
  return renderEmailLayout({
    heading: 'Tổng hợp người chưa check-in',
    bodyHtml,
  });
}

// ── Security / Face access ───────────────────────────────────────────────

export function buildStrangerAlertEmail(params: {
  deviceCode: string;
  roomName?: string | null;
}): string {
  const rows: InfoRow[] = [
    { label: 'Thiết bị', value: escapeHtml(params.deviceCode) },
  ];
  if (params.roomName) {
    rows.push({ label: 'Khu vực / Phòng', value: escapeHtml(params.roomName) });
  }
  const bodyHtml =
    renderCallout(
      'Hệ thống phát hiện một khuôn mặt lạ (chưa đăng ký) tại thiết bị điểm danh.',
      'danger',
    ) +
    renderInfoTable(rows) +
    renderParagraph('Vui lòng kiểm tra camera/lịch sử truy cập để xác minh.');
  return renderEmailLayout({ heading: 'Cảnh báo khuôn mặt lạ', bodyHtml });
}

export function buildSecurityAlertEmail(params: {
  title: string;
  content: string;
  severityLabel: string;
  zoneName?: string | null;
  triggeredAt: Date | string;
}): string {
  const rows: InfoRow[] = [
    { label: 'Mức độ', value: escapeHtml(params.severityLabel) },
    { label: 'Thời điểm', value: escapeHtml(formatDateTimeVN(params.triggeredAt)) },
  ];
  if (params.zoneName) {
    rows.push({ label: 'Khu vực', value: escapeHtml(params.zoneName) });
  }
  const bodyHtml =
    renderCallout(escapeHtml(params.content), 'danger') +
    renderInfoTable(rows) +
    renderParagraph(
      'Vui lòng mở Trung tâm Cảnh báo An ninh để xác nhận và xử lý cảnh báo.',
    );
  return renderEmailLayout({ heading: params.title, bodyHtml });
}

// ── Guest Access (feat-external-guest-live-meeting-access, GLA-001) ───────
//
// LƯU Ý QUAN TRỌNG: 2 hàm dưới đây được gửi qua GuestEmailService.sendMail()
// TRỰC TIẾP (mirror AuthEmailService), KHÔNG qua NotificationsService —
// mail chứa link/OTP là bí mật, không được persist `content` vĩnh viễn vào
// bảng `notifications`. Xem plan.md mục 2.2/7.1/7.3.

function renderGuestLinkButton(link: string, label: string): string {
  return `<div style="text-align:center;margin:8px 0 20px;">
    <a href="${escapeHtml(link)}" style="display:inline-block;background-color:#1e3a8a;color:#ffffff;font-size:14px;font-weight:600;padding:12px 28px;border-radius:6px;text-decoration:none;">${escapeHtml(label)}</a>
  </div>`;
}

export function buildGuestInviteEmail(params: {
  meetingTitle: string;
  startTime: Date | string;
  endTime: Date | string;
  hostName: string;
  link: string;
}): string {
  const bodyHtml =
    renderParagraph('Kính gửi Quý khách,') +
    renderParagraph(
      `Quý khách được mời tham dự cuộc họp sau tại Smart Meeting Management:`,
    ) +
    renderInfoTable([
      {
        label: 'Cuộc họp',
        value: `<strong>${escapeHtml(params.meetingTitle)}</strong>`,
      },
      {
        label: 'Thời gian',
        value: `${escapeHtml(formatDateTimeVN(params.startTime))} &ndash; ${escapeHtml(formatDateTimeVN(params.endTime))}`,
      },
      { label: 'Chủ trì', value: escapeHtml(params.hostName) },
    ]) +
    renderParagraph('Bấm vào nút dưới đây để chuẩn bị tham gia:') +
    renderGuestLinkButton(params.link, 'Xem thông tin cuộc họp') +
    renderCallout(
      'Đây chỉ là liên kết dẫn tới trang xác thực — Quý khách sẽ cần xác nhận qua mã OTP gửi tới email này trước khi được vào cuộc họp. Vui lòng không chia sẻ liên kết này cho người khác.',
      'info',
    );
  return renderEmailLayout({ heading: 'Thư mời tham dự cuộc họp', bodyHtml });
}

export function buildGuestOtpEmail(params: {
  otp: string;
  meetingTitle: string;
  expiresMinutes: number;
}): string {
  const bodyHtml =
    renderParagraph('Kính gửi Quý khách,') +
    renderParagraph(
      `Quý khách vừa yêu cầu mã xác nhận để tham dự cuộc họp <strong>${escapeHtml(params.meetingTitle)}</strong>. Mã OTP xác thực của Quý khách là:`,
    ) +
    `<div style="text-align:center;margin:8px 0 20px;">
      <span style="display:inline-block;font-size:28px;font-weight:700;letter-spacing:6px;color:#1e3a8a;background-color:#eff6ff;padding:14px 28px;border-radius:8px;">${escapeHtml(params.otp)}</span>
    </div>` +
    renderCallout(
      `Mã OTP có hiệu lực trong vòng <strong>${params.expiresMinutes} phút</strong>. Để bảo mật, vui lòng không chia sẻ mã này cho bất kỳ ai, kể cả người trong tổ chức của Quý khách.`,
      'warning',
    ) +
    renderParagraph(
      'Nếu Quý khách không yêu cầu mã này, vui lòng bỏ qua email này.',
    );
  return renderEmailLayout({
    heading: 'Mã xác nhận tham dự cuộc họp',
    bodyHtml,
  });
}

// ── Khách đến làm việc (VIS-BE-001, 2.10) ──────────────────────────────────
// Email chỉ chứa mã lượt và đường dẫn tra cứu; KHÔNG chứa số giấy tờ/điện thoại của khách.

export function buildVisitorRegistrationReceivedEmail(params: {
  visitorName: string;
  code: string;
  hostName: string;
  scheduledFrom: Date | string;
  scheduledTo: Date | string;
  statusUrl: string;
}): string {
  const bodyHtml =
    renderParagraph(`Kính gửi ${escapeHtml(params.visitorName)},`) +
    renderParagraph('Đăng ký đến làm việc của bạn đã được ghi nhận và đang chờ người được gặp xác nhận.') +
    renderInfoTable([
      { label: 'Mã lượt khách', value: `<strong>${escapeHtml(params.code)}</strong>` },
      { label: 'Người được gặp', value: escapeHtml(params.hostName) },
      { label: 'Thời gian', value: `${escapeHtml(formatDateTimeVN(params.scheduledFrom))} &ndash; ${escapeHtml(formatDateTimeVN(params.scheduledTo))}` },
    ]) +
    renderParagraph(`Tra cứu kết quả tại: <a href="${escapeHtml(params.statusUrl)}">${escapeHtml(params.statusUrl)}</a>`);
  return renderEmailLayout({ heading: 'Đã nhận đăng ký khách', bodyHtml });
}

export function buildVisitorApprovedEmail(params: {
  visitorName: string;
  code: string;
  hostName: string;
  validFrom: Date | string;
  validTo: Date | string;
  zoneNames: string[];
  statusUrl: string;
}): string {
  const bodyHtml =
    renderParagraph(`Kính gửi ${escapeHtml(params.visitorName)},`) +
    renderParagraph('Đăng ký của bạn đã được chấp thuận. Khi đến cổng, vui lòng nhìn vào camera để xác thực khuôn mặt.') +
    renderInfoTable([
      { label: 'Mã lượt khách', value: `<strong>${escapeHtml(params.code)}</strong>` },
      { label: 'Người được gặp', value: escapeHtml(params.hostName) },
      { label: 'Được vào từ', value: escapeHtml(formatDateTimeVN(params.validFrom)) },
      { label: 'Đến', value: escapeHtml(formatDateTimeVN(params.validTo)) },
      { label: 'Khu vực', value: escapeHtml(params.zoneNames.join(', ') || 'Cổng chính') },
    ]) +
    renderParagraph(`Xem chi tiết và mã QR: <a href="${escapeHtml(params.statusUrl)}">${escapeHtml(params.statusUrl)}</a>`);
  return renderEmailLayout({ heading: 'Đăng ký khách đã được duyệt', bodyHtml });
}

export function buildVisitorRejectedEmail(params: {
  visitorName: string;
  code: string;
  reason: string;
}): string {
  const bodyHtml =
    renderParagraph(`Kính gửi ${escapeHtml(params.visitorName)},`) +
    renderParagraph(`Rất tiếc, đăng ký <strong>${escapeHtml(params.code)}</strong> của bạn không được chấp thuận.`) +
    renderCallout(`Lý do: ${escapeHtml(params.reason)}`, 'danger') +
    renderParagraph('Bạn có thể đăng ký lại với thời gian khác hoặc liên hệ người được gặp để biết thêm chi tiết.');
  return renderEmailLayout({ heading: 'Đăng ký khách không được duyệt', bodyHtml });
}

/** RPT-CENTER-BE-001: email gửi báo cáo định kỳ — tên báo cáo, kỳ, lời nhắn và danh sách tệp đính kèm. */
export function buildReportScheduleEmail(params: {
  scheduleName: string;
  reportTitle: string;
  periodLabel: string;
  message?: string | null;
  fileNames: string[];
  appUrl?: string | null;
  note?: string | null;
}): string {
  const bodyHtml =
    renderParagraph(`Báo cáo <strong>${escapeHtml(params.reportTitle)}</strong> của lịch gửi “${escapeHtml(params.scheduleName)}” đã sẵn sàng.`) +
    renderInfoTable([
      { label: 'Báo cáo', value: escapeHtml(params.reportTitle) },
      { label: 'Kỳ dữ liệu', value: escapeHtml(params.periodLabel) },
    ]) +
    (params.message ? renderCallout(escapeHtml(params.message), 'info') : '') +
    (params.fileNames.length
      ? renderParagraph('Các tệp đính kèm:') + renderList(params.fileNames.map((n) => escapeHtml(n)))
      : renderParagraph('Tệp báo cáo không đính kèm được vào email này.')) +
    (params.note ? renderCallout(escapeHtml(params.note), 'warning') : '') +
    (params.appUrl ? renderParagraph(`Bạn cũng có thể xem trên hệ thống: ${escapeHtml(params.appUrl)}`) : '');
  return renderEmailLayout({ heading: 'Báo cáo định kỳ', bodyHtml });
}
