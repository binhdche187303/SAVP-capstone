# Feature Specification: UI mockup phân hệ Khách đến làm việc (2.10) và Báo cáo & thống kê (2.13)

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-10-07 | Tạo spec lần đầu. Phạm vi: UI + dữ liệu giả trong `SAVP-capstone-FE` cho buổi review với khách hàng; BE làm sau, có ước lượng ở §10. Phương án và 11 màn đã được LamNH duyệt qua AskUserQuestion. | Toàn bộ file |
| 2026-10-08 | Bổ sung sau khi LamNH bấm thử: thu hồi quyền khi khách đang trong khuôn viên, leo thang quá giờ, đóng lượt thủ công, "chưa ghi nhận giờ ra", màn hình cổng (S12), quầy lễ tân thành màn xử lý ngoại lệ, ba lối vào trang đăng ký. LamNH duyệt "làm cả 3" trong chat. | §12 |

---

- **Feature ID**: VIS-RPT-MOCK-001
- **Feature Name**: UI mockup Khách đến làm việc + Trung tâm báo cáo
- **Phân hệ tài liệu khách hàng**: 2.10 (checklist STT 52–57), 2.13 (checklist STT 72–80)
- **Module / Domain**: FE `visitors`, `reports`; BE chưa đụng tới
- **Created Date**: 2026-10-07
- **Status**: Draft, chờ LamNH duyệt
- **Hạn**: demo với khách hàng ngày 2026-10-09
- **Source Documents**:
  - `HẦN MỀM QUẢN LÝ CAMERA AI THÔNG MINH.docx.md` §2.10, §2.13
  - `Checklist_PhanMem_CameraAI_v2.xlsx` STT 52–57, 72–80
  - `docs/CAM_AI_GAP_ANALYSIS_300_CAMERAS.md` dòng #17, #18, #21, #33
  - `src/modules/reports/*` (5 báo cáo đã có: meeting activity, room utilization, gate access, vehicle, security alert)
  - `src/modules/guest-access/*` (khách dự họp online, khác nghiệp vụ, chỉ tham khảo mẫu OTP/email)
  - FE: `src/components/common/ExportReportModal.jsx`, `src/pages/shared/ZoneTrafficAnalytics.jsx` (mẫu giao diện trang phân tích), `tailwind.config.js`, `DESIGN.md`

---

## 0. Các quyết định đã duyệt

| # | Quyết định | Nguồn |
|---|---|---|
| D1 | Dựng mockup ngay trong `SAVP-capstone-FE` bằng trang React thật, dữ liệu đi qua lớp giả bật bằng cờ. Không làm prototype HTML rời, không dùng MSW. | Duyệt 2026-10-07 |
| D2 | Đủ 11 màn, dữ liệu giả sát thực tế, không viết BE trong đợt này. | Duyệt 2026-10-07 |
| D3 | Nút xuất báo cáo tạo ra file thật trên trình duyệt (Excel, Word, PDF). | Duyệt 2026-10-07 |
| D4 | Spec đặt tại repo BE theo quy ước `spec/features/`. Không commit khi chưa được yêu cầu. | Duyệt 2026-10-07 |

Giả định chưa được khách hàng xác nhận, mockup dùng để hỏi lại ở buổi review: xem §11.

## 1. Mục tiêu và tiêu chí thành công

**Mục tiêu:** khách hàng bấm được trọn vẹn hai phân hệ trên sản phẩm thật, đủ để xác nhận nghiệp vụ trước khi đội đầu tư BE.

**Thành công khi:**
1. Cả 15 dòng checklist (STT 52–57, 72–80) đều có màn hình tương ứng chỉ ra được.
2. Luồng khách chạy xuyên màn trong một trình duyệt: đăng ký công khai → chờ duyệt → duyệt → người được gặp nhận thông báo → lễ tân check-in → check-out → xuất hiện ở Lịch sử, Thống kê và Báo cáo khách.
3. Cả 7 báo cáo xem được trên màn hình với bộ lọc, KPI, biểu đồ, bảng; xuất ra được file PDF, Excel, Word mở được.
4. Tạo, sửa, bật/tắt, gửi thử được một lịch gửi báo cáo; lần gửi thử hiện ở Lịch sử gửi.
5. `npm run build` không lỗi; unit test của hai phần logic thuần (§8) chạy xanh.
6. Tắt cờ mock thì các màn cũ của app không thay đổi hành vi.

## 2. Phạm vi

**Trong phạm vi**
- 11 màn ở §5, menu và route cho 4 khu vực vai trò.
- Lớp dữ liệu giả, dữ liệu sinh sẵn 90 ngày, lưu thay đổi vào `localStorage`.
- Service FE viết theo hợp đồng API dự kiến (§6.4), dùng làm đề bài cho BE.
- Xuất file phía trình duyệt cho demo.
- Kịch bản demo bấm tay.

**Ngoài phạm vi**
- Mọi thay đổi ở BE, DB, thiết bị.
- Nhận diện khuôn mặt thật ở cổng, gửi email/SMS thật, app mobile.
- Mã quyền chi tiết (đợt này chặn theo role).
- Sửa các màn hiện có ngoài việc thêm mục menu và route.

## 3. Vai trò và menu

| Khu vực (layout) | Nhóm menu "Khách" | Nhóm menu "Báo cáo" |
|---|---|---|
| Business Admin `/business-admin` | Quầy lễ tân, Quản lý khách, Lịch sử khách, Thống kê khách | Trung tâm báo cáo, Lịch gửi báo cáo, Lịch sử gửi |
| System Admin `/system-admin` | như trên | như trên |
| Manager `/manager` | Khách của tôi | Trung tâm báo cáo (chỉ xem và xuất) |
| Employee `/employee` | Khách của tôi | không |
| Công khai (không đăng nhập) | Đăng ký khách, Tra cứu trạng thái | không |

Mục menu thêm vào mảng menu tĩnh của từng layout. Chặn truy cập bằng `allowedRoles` của route cha đang có. `NAVIGATION_REGISTRY` không dùng trong đợt này vì nó yêu cầu mã quyền từ BE.

## 4. Phân tích nghiệp vụ

### 4.1. Khách đến làm việc

**Đối tượng dữ liệu**
- **Khách (visitor):** họ tên, số giấy tờ (CCCD/hộ chiếu), số điện thoại, email, đơn vị công tác, ảnh khuôn mặt, biển số xe (không bắt buộc).
- **Lượt khách (visit):** mã lượt (`VS-YYMMDD-NNNN`), khách, người được gặp, đơn vị tiếp, mục đích, khung giờ hẹn, số người đi cùng, kênh đăng ký, trạng thái, quyền ra vào, các mốc sự kiện.
- **Quyền ra vào (access grant):** hiệu lực từ, hiệu lực đến, danh sách khu vực/cổng được phép.
- **Sự kiện lượt khách:** thời điểm, loại, cổng/camera, độ khớp khuôn mặt, người thao tác, ghi chú.

**Kênh đăng ký**
| Kênh | Ai nhập | Trạng thái khởi tạo |
|---|---|---|
| `online` | Khách tự điền qua trang công khai | `pending_approval` |
| `host_invite` | Người được gặp đăng ký hộ | `approved` |
| `walk_in` | Lễ tân nhập tại quầy | `approved` |

**Máy trạng thái lượt khách**

```
pending_approval ──approve──▶ approved ──check_in──▶ checked_in ──check_out──▶ checked_out
       │                         │                        │
       ├──reject──▶ rejected     ├──revoke──▶ revoked     └──revoke──▶ revoked
       └──cancel──▶ cancelled    ├──cancel──▶ cancelled
                                 └──(quá hiệu lực, chưa đến)──▶ expired
```

- Trạng thái kết thúc: `checked_out`, `rejected`, `cancelled`, `revoked`, `expired`. Không thao tác tiếp được.
- `overstay` (quá giờ) là cờ suy ra, không phải trạng thái: lượt đang `checked_in` và thời điểm hiện tại vượt "hiệu lực đến".
- `extend` (gia hạn) chỉ đổi "hiệu lực đến", cho phép khi `approved` hoặc `checked_in`, giá trị mới phải lớn hơn giá trị cũ.

**Quy tắc nghiệp vụ**
| Mã | Quy tắc |
|---|---|
| BR-V1 | Bắt buộc: họ tên, số điện thoại, người được gặp, mục đích, khung giờ hẹn. Email bắt buộc với kênh `online` (để nhận kết quả). Ảnh khuôn mặt và ô đồng ý xử lý dữ liệu sinh trắc bắt buộc với `online` và `walk_in`. Với `host_invite`, người mời không có ảnh của khách: lượt mang nhãn "Chưa có ảnh khuôn mặt", lễ tân chụp bổ sung ở ngăn chi tiết khi khách đến; chưa có ảnh thì không xác thực khuôn mặt được, chỉ check-in tay. |
| BR-V2 | Khung giờ hẹn: bắt đầu không ở quá khứ, kết thúc sau bắt đầu, dài tối đa 7 ngày. |
| BR-V3 | Quyền ra vào mặc định: từ 30 phút trước giờ bắt đầu đến 30 phút sau giờ kết thúc. Khu vực mặc định là cổng chính và tòa nhà của đơn vị tiếp. Người duyệt sửa được trước khi duyệt. |
| BR-V4 | Người duyệt lượt `online`: người được gặp, Business Admin hoặc System Admin. Từ chối bắt buộc nhập lý do. |
| BR-V5 | Xác thực khuôn mặt ở cổng: độ khớp từ 0.80 trở lên thì tự check-in. Dưới ngưỡng thì chuyển "cần lễ tân xác minh", lễ tân check-in tay kèm ghi chú. |
| BR-V6 | Nhận diện ngoài khung hiệu lực hoặc ngoài khu vực được phép: không check-in, ghi sự kiện `access_denied`, hiện cảnh báo ở Quầy lễ tân. |
| BR-V7 | Thông báo người được gặp ở các mốc: có đăng ký chờ duyệt, khách đã đến, khách quá giờ, khách đã rời. Kênh: trong ứng dụng và email. |
| BR-V8 | Thông báo khách qua email ở các mốc: đã nhận đăng ký, được duyệt (kèm mã và QR), bị từ chối (kèm lý do). |
| BR-V9 | Hết "hiệu lực đến" mà chưa check-in: lượt chuyển `expired`. Hết hiệu lực hoặc bị thu hồi thì khuôn mặt bị gỡ khỏi thiết bị (BE làm sau; mockup hiện dòng "Đã gỡ khuôn mặt khỏi thiết bị" trong dòng thời gian). |
| BR-V10 | Thống kê theo đơn vị tính theo đơn vị của người được gặp. |

### 4.2. Báo cáo và thống kê

Mỗi báo cáo có cùng khung: bộ lọc → KPI → biểu đồ → bảng → xuất. Bộ lọc kỳ dùng chung: Hôm nay, Tuần này, Tháng này, Tùy chọn (tối đa 366 ngày).

| Mã loại | Báo cáo | Bộ lọc riêng | KPI | Biểu đồ | Cột bảng |
|---|---|---|---|---|---|
| `staff-attendance` | Chuyên cần cán bộ | Đơn vị, cá nhân | Tỷ lệ chuyên cần, lượt đi muộn, lượt về sớm, ngày vắng, giờ hiện diện TB/ngày | Tỷ lệ chuyên cần theo ngày; so sánh theo đơn vị | Mã CB, họ tên, đơn vị, ngày công, đúng giờ, đi muộn, về sớm, vắng, tổng giờ hiện diện, tỷ lệ |
| `student-attendance` | Chuyên cần sinh viên | Học kỳ, môn, lớp học phần, sinh viên | Tỷ lệ chuyên cần, số buổi, lượt vắng, lượt muộn, số SV vắng quá 20% | Tỷ lệ theo tuần; so sánh theo lớp học phần | MSSV, họ tên, lớp HP, môn, số buổi, có mặt, muộn, vắng, tỷ lệ, cảnh báo |
| `gate-access` | Ra vào khuôn viên | Cổng/khu vực, đơn vị, đối tượng (cán bộ, sinh viên, khách, vãng lai) | Lượt vào, lượt ra, đang trong khuôn viên, lưu trú TB | Lượt vào/ra theo giờ; theo cổng | Khu vực, mã, họ tên, đơn vị, biển số, giờ vào, giờ ra, thời lượng |
| `room-utilization` | Sử dụng phòng họp | Tòa nhà, phòng | Số cuộc họp, tỷ lệ sử dụng, tỷ lệ không đến, tổng giờ dùng | Giờ dùng theo ngày; tỷ lệ sử dụng theo phòng | Phòng, tòa nhà, sức chứa, số cuộc họp, giờ đặt, giờ thực dùng, tỷ lệ sử dụng, không đến |
| `vehicle` | Phương tiện | Cổng, loại xe, trạng thái đăng ký | Tổng lượt, ô tô, xe máy, chưa đăng ký, thuộc danh sách kiểm soát | Lưu lượng theo giờ; cơ cấu loại xe | Biển số, loại xe, chủ xe, đơn vị, cổng, giờ vào, giờ ra, thời lượng, trạng thái |
| `visitor` | Khách đến làm việc | Đơn vị tiếp, mục đích, trạng thái | Tổng lượt, khách duy nhất, lưu trú TB, lượt quá giờ, tỷ lệ không đến | Lượt khách theo ngày; theo đơn vị tiếp | Mã lượt, khách, đơn vị công tác, người gặp, đơn vị tiếp, mục đích, giờ vào, giờ ra, thời lượng, trạng thái |
| `security-alert` | Sự kiện an ninh | Loại, mức độ, khu vực, trạng thái | Tổng sự kiện, mức nghiêm trọng, đã xử lý, thời gian xử lý TB | Sự kiện theo ngày; cơ cấu theo loại | Thời gian, loại, mức độ, khu vực, camera, đối tượng, trạng thái, người xử lý, thời gian xử lý |

Quy tắc mockup dùng cho chuyên cần cán bộ (giả định, xem §11): giờ làm 08:00–17:00 từ thứ Hai đến thứ Sáu, ân hạn 15 phút, lấy lượt vào đầu tiên và lượt ra cuối cùng trong ngày.

Báo cáo `visitor` trong mock đọc cùng kho dữ liệu với phân hệ Khách, nên số liệu khớp với màn Thống kê khách.

**Lịch gửi báo cáo tự động**
| Mã | Quy tắc |
|---|---|
| BR-S1 | Một lịch gồm: tên, loại báo cáo, bộ lọc, kỳ dữ liệu tương đối (hôm qua, tuần trước, tháng trước), tần suất, giờ gửi, định dạng (chọn một hoặc nhiều trong PDF, Excel, Word), người nhận, tiêu đề và lời nhắn email, trạng thái bật/tắt. |
| BR-S2 | Tần suất: hằng ngày; hằng tuần (chọn thứ); hằng tháng (chọn ngày 1–28 hoặc "ngày cuối tháng"). Giờ theo múi Asia/Ho_Chi_Minh. |
| BR-S3 | Người nhận: người dùng nội bộ hoặc email ngoài, tối thiểu 1, tối đa 20. Email ngoài phải đúng định dạng. |
| BR-S4 | Lần chạy kế tiếp là thời điểm sớm nhất lớn hơn hiện tại thỏa tần suất và giờ gửi. Lịch đang tắt không có lần chạy kế tiếp. |
| BR-S5 | "Gửi thử ngay" tạo một lần chạy loại `manual`, không đổi lần chạy kế tiếp. |
| BR-S6 | Mỗi lần chạy ghi: lịch, thời điểm, loại (`scheduled`/`manual`), trạng thái (`success`/`failed`), kỳ dữ liệu, định dạng, số người nhận, file, lý do lỗi nếu có. Lần chạy lỗi có nút "Gửi lại". |

## 5. Màn hình

Giao diện theo mẫu `ZoneTrafficAnalytics.jsx`: khung `space-y-6 p-6 max-w-7xl mx-auto`, thẻ `bg-white rounded-2xl border border-platinum-tint shadow-sm`, màu theo token trong `tailwind.config.js`, icon `lucide-react`, biểu đồ `recharts`. Mọi màn có trạng thái đang tải, rỗng, lỗi.

### Phân hệ 2.10

| # | Màn | Route | Nội dung chính | Checklist |
|---|---|---|---|---|
| S1 | Đăng ký khách trực tuyến | `/visitor/register` | 4 bước: (1) thông tin khách; (2) chuyến thăm: tìm người được gặp, mục đích, khung giờ, số người đi cùng, biển số; (3) chụp ảnh khuôn mặt bằng webcam hoặc tải ảnh, ô đồng ý xử lý dữ liệu sinh trắc; (4) xem lại và gửi. Kết quả: mã lượt, QR, nút mở trang tra cứu. | 52, 53 |
| S2 | Tra cứu trạng thái | `/visitor/status`, `/visitor/status/:code` | Nhập mã lượt. Hiện dòng thời gian trạng thái, khung giờ và khu vực được cấp, lý do nếu bị từ chối, QR. | 52, 54 |
| S3 | Quản lý khách | `visitors` | Tab theo trạng thái kèm số đếm, tìm kiếm, lọc theo đơn vị tiếp và ngày. Bảng lượt khách. Ngăn chi tiết: thông tin, ảnh, độ khớp khuôn mặt, thẻ quyền ra vào, dòng thời gian. Thao tác: duyệt (sửa quyền ra vào trước khi duyệt), từ chối, gia hạn, thu hồi, chụp bổ sung ảnh khuôn mặt, check-in tay, check-out tay. | 53, 54, 55 |
| S4 | Quầy lễ tân | `visitors/desk` | KPI hôm nay: dự kiến, đã đến, đang trong khuôn viên, quá giờ. Danh sách khách hôm nay theo giờ hẹn. Form đăng ký nhanh khách vãng lai. Khung "Xác thực tại cổng": chọn một khách đã duyệt, bấm mô phỏng nhận diện, hiện ảnh đăng ký cạnh ảnh chụp, độ khớp, kết quả theo BR-V5 và BR-V6. | 53, 54, 55 |
| S5 | Khách của tôi | `my-visitors` | Danh sách khách xin gặp mình cần duyệt, khách sắp đến, khách đã tiếp. Form mời khách. Bảng thông báo theo BR-V7. | 52, 55 |
| S6 | Lịch sử khách đến | `visitors/history` | Tra theo tên khách, số giấy tờ, đơn vị công tác, người gặp, đơn vị tiếp, khoảng thời gian. Chi tiết từng lượt với các mốc camera ghi nhận. Xem toàn bộ lượt của một khách. Xuất Excel. | 56 |
| S7 | Thống kê khách | `visitors/stats` | Bộ lọc kỳ và đơn vị. KPI. Biểu đồ: lượt khách theo ngày/tuần/tháng, theo đơn vị tiếp, theo mục đích, phân bố giờ đến, top đơn vị công tác của khách. Nút mở báo cáo `visitor` để xuất. | 57 |

Route nội bộ nằm dưới tiền tố của từng khu vực ở §3 (ví dụ `/business-admin/visitors/desk`).

### Phân hệ 2.13

| # | Màn | Route | Nội dung chính | Checklist |
|---|---|---|---|---|
| S8 | Trung tâm báo cáo | `reports` | 7 thẻ báo cáo: tên, mô tả, số lịch gửi đang bật, nút Xem. Danh sách file xuất gần đây kèm nút tải lại. | 72–78 |
| S9 | Xem báo cáo | `reports/:type` | Một trang dùng chung, dựng từ khai báo của từng loại ở §4.2: thanh lọc, KPI, 2 biểu đồ, bảng xem trước có phân trang và sắp xếp, menu Xuất (PDF, Excel, Word), nút "Đặt lịch gửi" mở form S10 điền sẵn loại và bộ lọc (ẩn với Manager vì Manager không có màn lịch gửi). | 72–79 |
| S10 | Lịch gửi báo cáo | `report-schedules` | Bảng lịch: tên, báo cáo, tần suất, định dạng, số người nhận, lần chạy gần nhất, lần chạy kế tiếp, công tắc bật/tắt. Form tạo/sửa theo BR-S1 đến BR-S3, có xem trước email. Thao tác: gửi thử, nhân bản, xóa. | 80 |
| S11 | Lịch sử gửi | `report-schedules/runs` | Bảng lần chạy theo BR-S6, lọc theo lịch, trạng thái, thời gian. Tải file, gửi lại lần lỗi. | 80 |

## 6. Kiến trúc lớp dữ liệu giả

### 6.1. Cờ bật/tắt
`src/config/featureFlags.js` thêm `VISITOR_REPORT_MOCK_ENABLED`, đọc từ `REACT_APP_VISITOR_REPORT_MOCK`, mặc định bật. Đặt `false` thì service gọi API thật qua `utils/request`.

### 6.2. Bố cục file (FE)

```
src/mocks/visitorReport/
  seed.js               sinh dữ liệu 90 ngày, tất định theo hạt giống cố định, neo vào ngày hiện tại
  store.js              đọc/ghi localStorage (khóa có số phiên bản), reset về seed
  visitStateMachine.js  bảng chuyển trạng thái §4.1, hàm thuần
  scheduleNextRun.js    tính lần chạy kế tiếp theo BR-S4, hàm thuần
  reportData.js         tính KPI, chuỗi biểu đồ, dòng bảng cho 7 loại từ store
  exporters.js          xuất Excel/Word/PDF trên trình duyệt
src/service/
  visitorService.js       hợp đồng API khách
  reportCenterService.js  hợp đồng API báo cáo và lịch gửi
src/pages/public/         VisitorRegister.jsx, VisitorStatus.jsx
src/pages/shared/visitors/  VisitorManagement, VisitorDesk, MyVisitors, VisitorHistory, VisitorStats
src/pages/shared/reports/   ReportCenter, ReportViewer, ReportSchedules, ReportRuns
src/config/reportDefinitions.js   khai báo bộ lọc, KPI, biểu đồ, cột của 7 loại
src/utils/reportFormat.js         định dạng ô dùng chung cho bảng và file xuất
src/components/visitor/   VisitStatusBadge, VisitDetailDrawer, VisitTimeline, AccessGrantCard, FaceCapture, VisitQr, VisitForm
src/components/report/    ReportFilterBar, KpiTiles, ReportChart, ReportTable, ExportMenu, ScheduleFormModal
```

`reportDefinitions.js` là khai báo UI (bộ lọc, KPI, cột của 7 loại), không phải dữ liệu giả, giữ nguyên khi có BE. Đặt ở `src/config/` để lớp giả và service dùng được mà không import ngược từ thư mục trang.

### 6.3. Luồng dữ liệu
Trang → service → nếu cờ bật: hàm trong `mocks/visitorReport` (trễ giả 200–500 ms) → trả về đúng dạng `{ success, data }` mà `utils/request` trả. Trang không import trực tiếp từ `mocks/`.

Thông báo cho người được gặp (BR-V7) hiện bằng toast và bảng thông báo trong màn S5. Không ghi vào chuông thông báo chung của app vì chuông đó đọc từ BE. Email trong mockup không gửi thật: dòng thời gian của lượt ghi "Đã gửi email tới …".

Dữ liệu sinh sẵn: khoảng 12 đơn vị, 60 cán bộ, 300 sinh viên, 6 cổng/khu vực, 450 lượt khách trong 90 ngày có đủ mọi trạng thái (gồm khách hôm nay ở các trạng thái khác nhau), 6 lịch gửi, 40 lần chạy trong đó có vài lần lỗi. Thay đổi của người demo ghi đè lên lớp sinh sẵn và giữ qua lần tải lại trang. Nút "Đặt lại dữ liệu demo" đặt ở Quầy lễ tân và Trung tâm báo cáo.

### 6.4. Hợp đồng API dự kiến (đề bài cho BE)

Tiền tố `/api/v1`. Service FE đặt tên hàm theo các endpoint này.

| Nhóm | Endpoint |
|---|---|
| Khách, công khai | `POST /public/visitor-registrations` · `GET /public/visitor-registrations/:code` · `GET /public/visitor-hosts?q=` |
| Lượt khách | `GET /visitors/visits` (lọc `status, from, to, departmentId, hostId, q, page, limit`) · `GET /visitors/visits/:id` · `POST /visitors/visits` |
| Thao tác lượt | `POST /visitors/visits/:id/approve` · `/reject` · `/revoke` · `/extend` · `/check-in` · `/check-out` · `/verify-face` |
| Lễ tân, người gặp | `GET /visitors/desk/today` · `GET /visitors/my-visits` · `GET /visitors/my-notifications` |
| Thống kê khách | `GET /visitors/stats?from&to&departmentId&groupBy` |
| Báo cáo | `GET /reports/catalog` · `GET /reports/:type/preview` · `POST /reports/:type/exports` · `GET /reports/exports/recent` |
| Lịch gửi | `GET/POST /report-schedules` · `PATCH/DELETE /report-schedules/:id` · `POST /report-schedules/:id/run-now` · `GET /report-schedule-runs` · `POST /report-schedule-runs/:id/retry` |

`GET /reports/:type/preview` trả `{ kpis[], charts[], rows[], total }`. Đây là API mới; BE hiện chỉ có luồng tạo job xuất file cho 4 loại.

## 7. Xuất file trong mockup

| Định dạng | Cách làm | Ghi chú |
|---|---|---|
| Excel | Thư viện `xlsx` đã có: một sheet tổng hợp (tiêu đề, kỳ, bộ lọc, KPI), một sheet dữ liệu. | File `.xlsx` thật |
| Word | Dựng HTML có bảng, tải về dưới dạng `.doc`. | Mở được bằng Word; BE thật sẽ dùng thư viện `docx` để ra `.docx` |
| PDF | Mở bản in của báo cáo, người dùng chọn "Lưu thành PDF". | BE thật sẽ dùng `pdfkit` như các báo cáo hiện có |

Tên file: `<ma-loai>_<tu>_<den>.<đuôi>`. Mỗi lần xuất ghi một dòng vào "file xuất gần đây" ở S8.

Thư viện mới duy nhất: `qrcode.react` để vẽ QR mã lượt ở S1 và S2.

## 8. Kiểm thử

| Loại | Nội dung |
|---|---|
| Unit (Jest của `react-scripts`) | `visitStateMachine`: mọi chuyển trạng thái hợp lệ, từ chối chuyển từ trạng thái kết thúc, quy tắc gia hạn, cờ quá giờ. `scheduleNextRun`: hằng ngày, hằng tuần, hằng tháng, ngày cuối tháng của tháng 28/30/31 ngày, lịch tắt, thời điểm đúng bằng giờ gửi. |
| Build | `npm run build` không lỗi, không cảnh báo mới từ file thêm vào. |
| Bấm tay | Kịch bản demo ở §9 chạy trọn trên Chrome với một tài khoản mỗi role. |
| Hồi quy | Tắt cờ: mở các màn cũ có menu bị sửa, xác nhận không lỗi. |

Hai hàm thuần được test vì BE sẽ phải làm lại đúng logic đó.

## 9. Thứ tự bàn giao

Xếp sao cho dừng ở mốc nào cũng có bản demo được.

| Mốc | Nội dung | Phủ checklist |
|---|---|---|
| M1 | Nền: cờ, seed, store, hai hàm thuần + test, service, route, menu | — |
| M2 | S8, S9 (7 loại), xuất file | 72–79 |
| M3 | S1, S3, S4 | 52–55 |
| M4 | S10, S11 | 80 |
| M5 | S5, S6, S7, S2 | 55–57 |
| M6 | Hoàn thiện trạng thái rỗng/lỗi, kịch bản demo, kiểm tra hồi quy | — |

Ngày 1: M1–M3. Ngày 2: M4–M6.

**Kịch bản demo:** (1) khách tự đăng ký ở S1; (2) Business Admin thấy lượt ở Chờ duyệt, chỉnh khung giờ, duyệt; (3) nhân viên mở Khách của tôi thấy thông báo; (4) lễ tân mô phỏng nhận diện tại cổng, khách check-in; (5) thử một khách đến ngoài khung giờ để thấy bị chặn; (6) check-out, xem Lịch sử và Thống kê; (7) mở Trung tâm báo cáo, xem báo cáo khách, xuất 3 định dạng; (8) lướt 6 báo cáo còn lại; (9) tạo lịch gửi hằng tuần, gửi thử, xem Lịch sử gửi.

## 10. Ước lượng BE (làm sau buổi review)

Tính cho 1 dev đã quen codebase. BE sẽ có spec riêng cho từng phân hệ.

| Hạng mục | Ngày công | Ghi chú |
|---|---|---|
| 2.10 Schema, đăng ký 3 kênh, OTP email | 3 | Tái dùng mẫu OTP/email của `guest-access` |
| 2.10 Duyệt, máy trạng thái, mã/QR | 1.5 | |
| 2.10 Khuôn mặt khách: đẩy theo khung giờ, tự gỡ khi hết hạn | 3 | Rủi ro R1 |
| 2.10 Ghép sự kiện nhận diện thành check-in/out, chặn ngoài giờ | 2 | Dựa trên luồng ingest sự kiện IVSS hiện có |
| 2.10 Thông báo, lịch sử, thống kê | 2.5 | Tái dùng `notifications`, `mail` |
| 2.10 Test và tích hợp | 2 | |
| 2.13 API xem trước cho 7 loại | 2 | |
| 2.13 Báo cáo chuyên cần cán bộ, sinh viên, khách (dữ liệu + PDF + Excel) | 6.5 | Rủi ro R2, R3 |
| 2.13 Xuất Word cho 7 loại | 3.5 | `docx` đã cài, có sẵn mẫu ở renderer biên bản họp |
| 2.13 Lịch gửi, email đính kèm, lịch sử, thử lại | 3.5 | Tái dùng queue `report-export`, `@nestjs/schedule`, `nodemailer` |
| 2.13 Test | 2 | |
| **Tổng** | **31.5** | 2.10: 14 · 2.13: 17.5 |

**Rủi ro**
| Mã | Rủi ro | Hướng xử lý |
|---|---|---|
| R1 | Bảng ánh xạ người–thiết bị khóa theo `user_id`, khách không phải user. | Tạo tài khoản tạm có `account_expires_at` như tài khoản partner, để dùng lại nguyên luồng đẩy và đối soát khuôn mặt. Cần thử trên thiết bị thật. |
| R2 | Chuyên cần sinh viên phụ thuộc dữ liệu điểm danh theo buổi của 2.7 (NinhHC đang làm). | Làm sau cùng; nếu 2.7 chậm thì BE báo cáo này chậm theo. |
| R3 | Chuyên cần cán bộ chưa có quy tắc chính thức (giờ làm, ân hạn, nguồn dữ liệu). | Chốt với khách hàng ở buổi review theo §11. |
| R4 | Cổng chỉ có camera thì không chặn vật lý được. | Ghi rõ với khách: nơi có FaceGate thì đóng/mở thật, nơi chỉ có camera thì nhận diện và cảnh báo. |

## 11. Điểm cần khách hàng xác nhận tại buổi review

1. Ai được duyệt khách: người được gặp, lễ tân, bảo vệ, hay nhiều cấp?
2. Khách có bắt buộc khai số CCCD không? Ảnh khuôn mặt khách lưu bao lâu sau khi rời?
3. Cổng nào có thiết bị đóng/mở (FaceGate, barrier), cổng nào chỉ có camera?
4. Quy tắc chuyên cần cán bộ: giờ làm, ân hạn, ca kíp, lấy dữ liệu từ cổng hay từ camera tòa nhà?
5. Ngưỡng cảnh báo chuyên cần sinh viên (mockup dùng vắng quá 20%).
6. Kênh thông báo ngoài email và trong ứng dụng: có cần SMS, Zalo không?
7. Báo cáo có phải theo biểu mẫu sẵn có của trường (quốc hiệu, chữ ký, số hiệu) không?
8. Lịch gửi báo cáo: ai được tạo, có giới hạn người nhận ngoài trường không?

## 12. Bổ sung 2026-10-08 (ghi đè các mục tương ứng ở §4.1 và §5)

### 12.1. Trạng thái và quy tắc mới của lượt khách

Hai trạng thái thêm vào máy trạng thái:

```
checked_in ──revoke──▶ must_leave ──check_out──▶ checked_out
checked_in / must_leave ──(sang ngày mới mà chưa có giờ ra)──▶ exit_unrecorded
checked_in / must_leave / exit_unrecorded ──close_manual──▶ checked_out
```

- `must_leave` ("Phải rời khuôn viên"): khách bị thu hồi quyền khi đang ở trong. Vẫn được đếm là đang trong khuôn viên. Thu hồi lượt `approved` (khách chưa đến) vẫn ra `revoked` như cũ.
- `exit_unrecorded` ("Chưa ghi nhận giờ ra"): không phải trạng thái kết thúc; chờ người rà và đóng thủ công.
- Lượt từng bị thu hồi mang `revokedAt`; sau khi khách rời, trạng thái là `checked_out` kèm nhãn phụ "Bị thu hồi quyền".

| Mã | Quy tắc |
|---|---|
| BR-V11 | Thu hồi khi khách đang ở trong: lượt sang `must_leave`, báo ngay người được gặp và bảo vệ. Chiều ra không bao giờ bị chặn: cổng ghi nhận khách ra và lượt sang `checked_out`. |
| BR-V12 | Khách `must_leave` bị camera chiều vào hoặc khu vực khác nhận diện: từ chối với lý do "Quyền ra vào đã bị thu hồi", ghi cảnh báo. |
| BR-V13 | Quá giờ leo thang hai mức: mức 1 ngay khi quá "hiệu lực đến" (báo người được gặp, đã có ở BR-V7); mức 2 sau 30 phút (báo bảo vệ, ghi sự kiện). Gia hạn đưa lượt về mức 0. |
| BR-V14 | Đóng lượt thủ công, bắt buộc chọn lý do. "Khách đã rời, camera không ghi nhận": nhập giờ ra ước tính (sau giờ vào, không ở tương lai), lượt sang `checked_out` với nhãn "giờ ra nhập tay". "Không tìm thấy khách": bắt buộc ghi chú, báo bảo vệ, lượt sang hoặc giữ `exit_unrecorded`. |
| BR-V15 | Sang ngày mới sau ngày hết hiệu lực (với `must_leave`: sau ngày bị thu hồi) mà chưa có giờ ra: lượt tự chuyển `exit_unrecorded`. Cùng quy ước với phiên "Chưa hoàn tất" của ra vào cổng. |
| BR-V16 | Mỗi lượt đã vào có "lần cuối camera thấy" (khu vực, thời điểm) để hỗ trợ tìm khách. |

Mốc 30 phút của BR-V13 và người nhận cảnh báo là giả định, cần khách hàng xác nhận (bổ sung vào §11).

### 12.2. Màn hình

| # | Màn | Route | Nội dung | Checklist |
|---|---|---|---|---|
| S12 | Màn hình cổng (mô phỏng) | `/visitor/gate` (không đăng nhập, đóng vai thiết bị tại cổng) | Webcam trực tiếp; chọn cổng/khu vực; chiều Vào hoặc Ra; nhập hoặc nhận mã lượt qua `?code=`; bấm quét thì chụp khung hình, hiện ảnh đăng ký cạnh ảnh camera, độ khớp, kết quả cho vào / cần lễ tân / từ chối / đã ghi nhận ra. Có mục "Tùy chọn mô phỏng" để chọn tình huống. Ghi rõ phần so khớp là mô phỏng. Góc màn có QR đăng ký cho khách chưa đăng ký. | 53, 54 |
| S4 (sửa) | Quầy lễ tân | `visitors/desk` | Bỏ khối mô phỏng camera. Đường thông thường không cần người trực. Thêm hàng "Cần xử lý": phải rời khuôn viên, quá giờ (kèm mức leo thang và lần cuối camera thấy), chưa ghi nhận giờ ra (7 ngày gần nhất), cần xác minh thủ công, chưa có ảnh. Thêm thẻ "Mã QR đăng ký" in được và nút mở Màn hình cổng. | 53, 54, 55 |

Ngăn chi tiết lượt khách thêm: "Lần cuối camera thấy", nút "Đóng lượt thủ công" (BR-V14), nút "Xác nhận khách đã rời" khi `must_leave`.

### 12.3. Lối vào trang đăng ký

| Tình huống | Lối vào |
|---|---|
| Khách được hẹn trước | Màn Khách của tôi có nút "Sao chép link đăng ký"; link `/visitor/register?host=<id>` chọn sẵn người cần gặp. |
| Khách tự tìm đến | Trang đăng nhập có dòng "Khách đến làm việc? Đăng ký tại đây". |
| Khách đến cổng chưa đăng ký | Mã QR ở Quầy lễ tân (in được) và ở góc Màn hình cổng. |

### 12.4. API bổ sung

`POST /visitors/visits/:id/close-manual` · `POST /gate/visitor-scan` (`{ code, zoneId, direction, scenario }`) · `GET /public/visitor-hosts/:id`. `GET /visitors/desk/today` trả thêm `attention[]`. `VisitView` thêm `lastSeen`, `overstayLevel`, `revokedAt`, `manualExit`.
