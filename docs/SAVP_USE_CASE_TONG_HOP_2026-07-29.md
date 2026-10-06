# DANH MỤC USE CASE TỔNG HỢP — SAVP
## Smart AI Vision Platform (tiền thân: SMRMPTS) · Nhóm SEP490_G61

| | |
|---|---|
| **Mã dự án** | SAVP · SEP490_G61 |
| **Tài liệu** | Use Case List tổng hợp (nguồn hợp nhất) |
| **Phiên bản** | 4.0 |
| **Ngày lập** | 29/07/2026 |
| **Hợp nhất từ** | Use Case List SMRMPTS v3.0 + Kế hoạch mở rộng SAVP (18/07/2026) + đối chiếu source code |
| **Tổng số UC** | **120** |

---

## 0. Tài liệu này là gì — và KHÔNG là gì

**Là:** một chỗ duy nhất liệt kê đủ 120 use case của dự án, hợp nhất nội dung của hai nguồn
gốc, cộng thêm cột đối chiếu sang code thật.

**KHÔNG là:** quyết định thay cho nhóm. Ở những chỗ hai nguồn mâu thuẫn nhau, tài liệu này
**ghi rõ cả hai bên và bằng chứng**, không tự chọn bên nào. Xem Phần G.

**Số hiệu UC chạy từ UC-01 đến UC-123**, khuyết ba số đã cắt khỏi phạm vi (§C.2). Đây là hệ
số hiệu chuẩn duy nhất; mọi tài liệu và code sau này bám theo dải này.

**Hai việc phải chốt trước khi baseline SRS** (phát hiện khi hợp nhất, chi tiết ở Phần G):

1. **Bảng thống kê của tài liệu 89 UC tự mâu thuẫn với chính bảng liệt kê của nó**
   (ghi Core 67 / Extended 20, đếm thật ra 70 / 17).
2. **Kế hoạch mở rộng lệch 2 con số tóm tắt** ("~20 UC bổ sung" và "13 UC phần camera").

---

## 1. Tác nhân (Actors)

| Tác nhân | Mô tả |
|---|---|
| **Employee (Internal User)** | Nhân viên nội bộ: tạo cuộc họp, tham gia họp, tự cập nhật hồ sơ và đăng ký khuôn mặt. |
| **Meeting Host** | Nhân viên đóng vai chủ trì một cuộc họp cụ thể; điều khiển phiên họp, quản lý thành viên, biên bản. |
| **Manager / Approver** | Người quản lý: phê duyệt/từ chối yêu cầu đặt phòng, xem dashboard và báo cáo. |
| **Business Admin** | Quản trị nghiệp vụ: quản lý tài khoản, phòng ban, phòng họp, thiết bị-tài sản, duyệt ảnh khuôn mặt. |
| **System Admin** | Quản trị hệ thống: quản lý thiết bị IoT/camera, cấu hình hệ thống, chính sách, nhật ký kiểm toán. |
| **System** | Tác nhân tự động (scheduler, worker, webhook handler): xử lý sự kiện thiết bị, điểm danh, no-show, thông báo, đồng bộ khuôn mặt. |
| *Face Server / Face Terminal* | Thiết bị hỗ trợ (nguồn sự kiện điểm danh cửa). **Không phải actor phần mềm.** |
| *IP Camera / IVSS* | Thiết bị hỗ trợ (nguồn sự kiện occupancy, hiện diện theo danh tính, biển số). **Không phải actor phần mềm.** |

**Ranh giới phần cứng/phần mềm (giữ nguyên từ bản gốc):** nhận diện khuôn mặt, chống giả mạo,
đếm người, khớp danh tính trên IVSS **không** được mô hình hóa thành use case phần mềm. Hệ thống
chỉ tích hợp, nhận sự kiện và xử lý kết quả do thiết bị trả về. Số UC là năng lực phần cứng: **0**.

---

## 2. Quy ước & chú giải

**Nguyên tắc phân rã use case (mức user-goal):**
1. Thực thể nghiệp vụ top-level → tách Create / Update / Delete / Đổi-trạng-thái thành các UC riêng.
2. Thao tác đọc của một thực thể (danh sách + chi tiết + tìm kiếm + lọc) → gộp thành một UC "Xem & tra cứu".
3. Thực thể con thuộc một thực thể cha (agenda, thành viên trong cuộc họp) → một UC "Quản lý".
4. Pipeline / tiến trình hệ thống nhiều bước kỹ thuật → một UC.

**Mức độ (Complexity):** `S` Simple (1–2 transaction) · `M` Medium (3–7 transaction) · `C` Complex (>7 transaction).

**Ưu tiên (Priority):** `Core` (phạm vi lõi/MVP) · `Extended` (mở rộng, giai đoạn sau) · `Pending` (chờ phần cứng IVSS).

**Thứ tự triển khai (chỉ áp cho Phần B):** `P1` nền → `P4` nếu kịp.

**Cột "Code":** module trong `capstone-be` có code thật phục vụ UC đó. `—` = chưa có code.
Cột này là **đối chiếu ở mức module**, không phải chứng minh UC đã hoàn thành.

---

# PHẦN A — NỀN TẢNG PHÒNG HỌP THÔNG MINH · 89 use case

> Nội dung từ `SMRMPTS_UseCaseList_Master.md` v3.0, bổ sung cột **Code**.
> Dòng đánh dấu **＋** là use case phát sinh trong quá trình triển khai, không có trong bản gốc.
> Hai use case chuỗi họp định kỳ đã được cắt khỏi phạm vi — xem §C.2.

## FT-01 — Xác thực & Phân quyền

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-01 | Đăng nhập | Mọi user | Người dùng xác thực bằng email và mật khẩu; hệ thống cấp JWT access token kèm refresh token và thiết lập phiên theo vai trò. | S | Core | `auth` |
| UC-02 | Đăng xuất | User | Người dùng kết thúc phiên làm việc; hệ thống thu hồi refresh token để vô hiệu hóa phiên hiện tại. | S | Core | `auth` |
| UC-03 | Quên & đặt lại mật khẩu (OTP) | User | Người dùng quên mật khẩu yêu cầu mã OTP gửi qua email, nhập OTP hợp lệ và đặt lại mật khẩu mới. | M | Core | `auth`, `mail` |
| UC-04 | Đổi mật khẩu | User | Người dùng đang đăng nhập đổi mật khẩu sau khi xác thực mật khẩu hiện tại. | S | Core | `auth` |

## FT-02 — Quản lý Tài khoản

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-05 | Tạo tài khoản | Business Admin | Tạo tài khoản nhân viên đơn lẻ hoặc nhập hàng loạt từ file Excel, gán vai trò và phòng ban ban đầu. | M | Core | `accounts` |
| UC-06 | Cập nhật thông tin tài khoản | Business Admin | Chỉnh sửa thông tin hồ sơ của một tài khoản (họ tên, phòng ban, thông tin liên hệ). | S | Core | `accounts` |
| UC-07 | Phân quyền & vai trò | Business/System Admin | Gán hoặc thay đổi vai trò và quyền (RBAC) của tài khoản; mọi thay đổi được ghi nhật ký kiểm toán. | M | Core | `accounts`, `administration` |
| UC-08 | Đổi trạng thái tài khoản | Business/System Admin | Khóa, mở khóa, kích hoạt hoặc vô hiệu hóa tài khoản để kiểm soát quyền truy cập. | S | Core | `accounts` |
| UC-09 | Xóa tài khoản | Business/System Admin | Xóa (mềm hoặc cứng) một tài khoản không còn sử dụng theo quy tắc nghiệp vụ. | S | Core | `accounts` |
| UC-10 | Xem & tra cứu tài khoản | Business/System Admin | Xem danh sách, tìm kiếm, lọc theo phòng ban/vai trò/trạng thái, xem chi tiết và lịch sử hoạt động. | M | Core | `accounts` |
| UC-11 | Tạo phòng ban | Business Admin | Khởi tạo một phòng ban mới với mã định danh duy nhất. | S | Core | `accounts` |
| UC-12 | Cập nhật phòng ban | Business Admin | Cập nhật thông tin phòng ban và gán người quản lý phụ trách. | S | Core | `accounts` |
| UC-13 | Xem danh sách phòng ban | Business Admin | Xem và tra cứu danh sách phòng ban trong tổ chức. | S | Core | `accounts` |
| UC-14 | Cập nhật hồ sơ cá nhân | Employee | Nhân viên tự cập nhật thông tin cá nhân của chính mình. | S | Core | `accounts` |
| UC-15 | Đăng ký & liên kết khuôn mặt | Employee | Nhân viên tải lên ảnh khuôn mặt (bắt buộc ở lần đăng nhập đầu) để hệ thống liên kết với hồ sơ phục vụ điểm danh; ảnh chỉ duyệt trước khi cấp phát. | M | Core | `face-access` |
| UC-16 | Duyệt ảnh khuôn mặt đăng ký | Business Admin | Xem hàng đợi ảnh nhân viên gửi lên, duyệt hoặc từ chối trước khi ảnh được cấp phát lên thiết bị. | M | Core | `face-access` |

## FT-03 — Quản lý Cuộc họp

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-17 | Tạo cuộc họp | Employee / Host | Tạo cuộc họp một lần với phòng, thời gian, thành viên và cấu hình ghi hình; hỗ trợ đặt phòng đột xuất khi phòng còn trống ngay. | M | Core | `meetings` |
| UC-18 | Cập nhật / dời lịch cuộc họp | Host | Thay đổi thời gian hoặc phòng của cuộc họp; hệ thống kiểm tra lại xung đột trước khi xác nhận. | M | Core | `meetings` |
| UC-19 | Hủy cuộc họp | Host | Hủy cuộc họp, giải phóng phòng đã giữ và thông báo cho thành viên. | S | Core | `meetings` |
| UC-22 | Quản lý thành viên cuộc họp | Host | Thêm thành viên thủ công hoặc nhập từ Excel, và gỡ thành viên khỏi cuộc họp. | M | Core | `meetings` |
| UC-23 | Quản lý chương trình họp (Agenda) | Host | Tạo, xem, chỉnh sửa, xóa và sắp xếp thứ tự các mục trong chương trình họp. | M | Core | `meetings` |
| UC-24 | Xem lịch trình cá nhân | Employee | Xem và lọc lịch họp cá nhân theo ngày/tuần/tháng. | S | Core | `meetings` |

## FT-04 — Quản lý Phòng họp

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-25 | Tạo phòng họp | Business Admin | Tạo phòng họp mới với mã duy nhất, sức chứa, vị trí và trạng thái. | S | Core | `rooms` |
| UC-26 | Cập nhật phòng họp | Business Admin | Cập nhật thông tin, sức chứa hoặc trạng thái quản trị của phòng họp. | S | Core | `rooms` |
| UC-27 | Xóa phòng họp | Business Admin | Xóa mềm phòng họp kèm cảnh báo nếu phòng còn cuộc họp trong tương lai. | S | Core | `rooms` |
| UC-28 | Xem & tra cứu phòng họp | Employee / Admin | Xem danh sách, chi tiết và lọc phòng theo sức chứa/tầng/trạng thái. | M | Core | `rooms` |

## FT-05 — Quản lý Thiết bị (Tài sản)

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-29 | Đăng ký thiết bị | Business Admin | Ghi nhận một thiết bị vật lý (màn hình, máy chiếu, camera, cảm biến) như một tài sản của tổ chức. | S | Extended | `equipment` |
| UC-30 | Cập nhật trạng thái thiết bị | Business Admin | Cập nhật tình trạng hoạt động/bảo trì/lỗi của thiết bị. | S | Extended | `equipment` |
| UC-31 | Phân bổ thiết bị vào phòng | Business Admin | Gán một thiết bị-tài sản cho một phòng họp cụ thể. | S | Extended | `equipment` |
| UC-32 | Xóa thiết bị | Business Admin | Xóa mềm một thiết bị khỏi danh mục tài sản. | S | Extended | `equipment` |
| UC-33 | Xem & kiểm tra khả dụng thiết bị | Business Admin | Xem danh mục thiết bị, tìm kiếm và kiểm tra tình trạng khả dụng theo phòng. | M | Extended | `equipment` |

## FT-06 — Quản lý Lập lịch (Tư vấn)

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-34 | Đề xuất phòng & khung giờ tối ưu | Employee | Gợi ý phòng phù hợp (sức chứa, thiết bị) và khung giờ tối ưu dựa trên lịch trống của người tham gia và giờ làm việc hợp lệ. | M | Core | `scheduling` |
| UC-35 | Phát hiện xung đột lập lịch | System | Phát hiện xung đột về phòng và về lịch của người tham gia, cảnh báo và cho phép người dùng điều chỉnh. | M | Core | `scheduling` |

## FT-07 — Sử dụng Phòng & Xử lý No-show

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-36 | Giám sát trạng thái phòng realtime | Manager / Admin | Theo dõi trạng thái sử dụng của các phòng theo thời gian thực, tìm kiếm và xem chi tiết cùng lịch sử sử dụng. | M | Core | `rooms` |
| UC-37 | Xử lý no-show & tự giải phóng phòng | System / Admin | Phát hiện phòng đã đặt nhưng không có người sau ngưỡng thời gian, mở case no-show, gửi cảnh báo và tự động giải phóng phòng. | M | Core | `rooms`, `scheduler` |
| UC-38 | Giải phóng phòng thủ công | Business Admin | Người quản trị chủ động giải phóng một phòng đang bị giữ. | S | Core | `rooms` |
| UC-39 | Phát hiện phòng trống sớm | System | Phát hiện phòng đã kết thúc sử dụng sớm hơn lịch để giải phóng tài nguyên. | S | Core | `rooms`, `scheduler` |
| UC-40 | Cấu hình ngưỡng no-show & trống sớm | System Admin | Cấu hình các ngưỡng thời gian cho phát hiện no-show và phát hiện phòng trống sớm. | S | Core | `administration` |

## FT-08 — Trong Cuộc họp (In-Meeting)

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-41 | Bắt đầu phiên họp | Host | Chủ trì bắt đầu phiên họp; hệ thống ghi lại thời điểm bắt đầu thực tế. | S | Core | `live-meeting` |
| UC-42 | Kết thúc phiên họp | Host | Chủ trì kết thúc phiên họp; hệ thống ghi lại thời điểm kết thúc thực tế và tính thời lượng. | S | Core | `live-meeting` |
| UC-43 | Yêu cầu & phê duyệt gia hạn phiên | Host / System | Chủ trì yêu cầu gia hạn thời gian họp; hệ thống phê duyệt/từ chối và cập nhật giờ kết thúc dự kiến. | M | Core | `live-meeting` |
| UC-44 | Xem hiện diện & điểm danh trực tiếp | Employee / Admin | Xem danh sách người đang có mặt và trạng thái điểm danh theo thời gian thực trong phiên họp. | S | Core | `live-meeting`, `presence` |
| UC-45 | Ghi chú trong cuộc họp | Host / Participant | Thêm ghi chú có mốc thời gian trong phiên họp và xem/tìm lại các ghi chú theo quyền hiển thị. | M | Core | `live-meeting` |

## FT-09 — Quản lý Thiết bị IoT *(phần camera)*

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-46 | Đăng ký thiết bị IoT/camera | System Admin | Đăng ký một thiết bị camera/IoT vào hệ thống như một điểm phát sự kiện (endpoint) kỹ thuật. | S | Core | `iot` |
| UC-47 | Gán thiết bị vào phòng | System Admin | Gán thiết bị đã đăng ký cho một phòng cụ thể để định tuyến sự kiện theo phòng. | S | Core | `iot` |
| UC-48 | Cấu hình kết nối thiết bị | System Admin | Cấu hình kết nối Face Server và luồng RTSP của IP camera, sinh và quản lý one-time callback token. | M | Core | `iot` |
| UC-49 | Cập nhật thiết bị IoT | System Admin | Cập nhật thông tin cấu hình của thiết bị IoT đã đăng ký. | S | Core | `iot` |
| UC-50 | Vô hiệu hóa / gỡ thiết bị IoT | System Admin | Tạm ngừng hoặc gỡ một thiết bị khỏi hệ thống, ngừng nhận sự kiện từ thiết bị đó. | S | Core | `iot` |
| UC-51 | Xem & tra cứu thiết bị IoT | System Admin | Xem danh sách, chi tiết và tra cứu các thiết bị IoT cùng trạng thái kết nối. | M | Core | `iot` |
| UC-52 | Giám sát tình trạng thiết bị | System | Nhận heartbeat để cập nhật trạng thái online, phát hiện thiết bị offline khi mất heartbeat, và chủ động kiểm tra khả dụng (RTSP probe). | M | Core | `iot`, `scheduler` |
| UC-53 | Xử lý pipeline sự kiện thiết bị | System | Tiếp nhận sự kiện từ thiết bị (verify, stranger, occupancy), lưu sự kiện thô, chuẩn hóa payload và định tuyến tới các module xử lý. | M | Core | `iot` |
| UC-54 | Ánh xạ danh tính person↔user | Admin / System | Liên kết bản ghi person trên thiết bị với tài khoản người dùng, và xử lý trường hợp person không khớp mapping. | S | Core | `face-access`, `ivss` |
| UC-55 | Cấp phát khuôn mặt lên thiết bị theo cuộc họp | System | Đẩy/đồng bộ khuôn mặt của người tham gia lên Face Terminal trước cuộc họp để phục vụ điểm danh. | M | Core | `face-access` |
| UC-56 | Thu hồi khuôn mặt sau họp | System | Thu hồi khuôn mặt đã cấp phát khỏi thiết bị sau khi cuộc họp kết thúc. | S | Core | `face-access` |
| UC-57 | Scheduler đồng bộ & đối soát khuôn mặt | System | Tác vụ định kỳ đồng bộ và đối soát dữ liệu khuôn mặt giữa hệ thống và thiết bị để đảm bảo nhất quán. | M | Core | `scheduler`, `ivss` |
| **UC-123** ＋ | Duy trì kho khuôn mặt thường trực trên IVSS | System | Đồng bộ một kho khuôn mặt **thường trực** trên thiết bị IVSS, tách biệt với luồng cấp phát theo cuộc họp (UC-55/56): thêm, gỡ và đối soát định kỳ để kho luôn khớp với danh sách nhân sự đang hoạt động. | M | Extended | `ivss` |

## FT-10 — Điểm danh & Hiện diện *(phần camera)*

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-58 | Ghi nhận điểm danh tại cửa | System | Từ verify event của Face Terminal, tạo bản ghi check-in, suy ra check-out theo quy tắc và sinh bản ghi điểm danh; hệ thống không tự nhận diện khuôn mặt. | M | Core | `attendance` |
| UC-59 | Tạo điểm danh thủ công | Host / Admin | Tạo bản ghi điểm danh thủ công cho trường hợp thiết bị không ghi nhận được. | S | Core | `attendance` |
| UC-60 | Hiệu chỉnh / hủy hiệu lực điểm danh | Host / Admin | Cập nhật trạng thái, chỉnh sửa (lưu vết before/after) hoặc hủy hiệu lực một bản ghi điểm danh. | M | Core | `attendance` |
| UC-61 | Xem điểm danh & timeline hiện diện | Host / Admin | Xem danh sách và chi tiết điểm danh, lịch sử vào/ra và tổng thời gian hiện diện của người tham gia trong cuộc họp. | M | Core | `attendance`, `presence` |
| UC-62 | Ghi nhận occupancy phòng qua camera | System | Nhận sự kiện đếm người từ IP camera, cập nhật trạng thái hiện diện của phòng theo thời gian thực và ghi nhận mức sử dụng. | M | Core | `iot`, `presence` |
| UC-63 | Nhận diện & tạo sự kiện hiện diện theo danh tính (IVSS) | System | Tích hợp IVSS, nhận sự kiện nhận diện theo danh tính và tạo sự kiện vào/rời phòng, cập nhật hiện diện realtime theo từng người. | M | Pending | `ivss` |
| UC-64 | Tính & báo cáo hiện diện từng người (IVSS) | System | Tính tổng thời gian hiện diện thực tế của từng người và xuất báo cáo/thống kê hiện diện theo từng cuộc họp. | M | Pending | `ivss` |
| **UC-121** ＋ | Xem nhật ký ra/vào theo phòng | Manager / Admin | Xem toàn bộ lượt vào/ra của **một phòng trong một ngày** theo nhận diện khuôn mặt, kèm tên người và mốc thời gian. Khác UC-61 ở chỗ tra cứu theo PHÒNG, không gắn với một cuộc họp cụ thể. | M | Core | `ivss` |

## FT-11 — Quản lý Ghi hình *(phần camera)*

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-65 | Cấu hình ghi hình | Host / Admin | Tạo, xem và cập nhật cấu hình ghi âm/ghi hình cho một cuộc họp (nguồn camera, kênh, quyền). | S | Core | `recording` |
| UC-66 | Điều khiển ghi hình (IP camera) | Host / System | Bắt đầu, tạm dừng, tiếp tục và dừng ghi hình từ IP camera; theo dõi trạng thái phiên, khôi phục sau sự cố và ghi nhận lỗi ghi hình/kết nối. | M | Core | `recording` |
| UC-67 | Ghi âm theo từng người (Room Capture Agent) | Host / System | Ghi âm đa kênh theo từng vị trí (channel/seat), chia đoạn audio phục vụ chuyển văn bản và lưu theo từng người tham gia. | M | Extended | `recording` |
| UC-68 | Xem & phát lại file media | Employee / Admin | Xem danh sách, chi tiết và phát lại file ghi âm/ghi hình qua đường dẫn có ký (signed URL). | M | Core | `recording`, `storage` — ⚠ nợ scope (thiếu route face-server) |
| UC-69 | Xóa / ẩn file ghi hình | Business Admin | Xóa mềm hoặc ẩn một file ghi hình theo chính sách. | S | Core | `recording` |

## FT-12 — Chuyển đổi Cuộc họp thành Văn bản

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-70 | Sinh transcript (STT) | System | Chuyển các đoạn audio đã ghi thành văn bản bằng dịch vụ Speech-to-Text, gắn mỗi đoạn với người nói tương ứng. | M | Extended | `transcription`, worker `ai-transcription` |
| UC-71 | Xem transcript theo speaker/timeline | Employee | Xem bản ghi văn bản theo dòng thời gian và theo người nói. | S | Extended | `transcription` |
| UC-72 | Chỉnh sửa transcript | Employee | Chỉnh sửa nội dung transcript và lưu lịch sử phiên bản chỉnh sửa. | S | Extended | `transcription` |

## FT-13 — Biên bản & Tri thức

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-73 | Tạo biên bản nháp | Host / Admin | Tạo biên bản họp ở trạng thái nháp, liên kết với một cuộc họp. | S | Extended | `minutes` |
| UC-74 | Cập nhật biên bản | Host / Admin | Chỉnh sửa nội dung, quyết định và mục hành động trong biên bản. | S | Extended | `minutes` |
| UC-75 | Xóa biên bản nháp | Host / Admin | Xóa mềm một biên bản đang ở trạng thái nháp. | S | Extended | `minutes` |
| UC-76 | Ban hành & phân phối biên bản | Host / Admin | Đính kèm file, liên kết recording/transcript, ban hành biên bản chính thức và tự động phân phối tới người liên quan. | M | Extended | `minutes`, `documents` |
| UC-77 | Xuất biên bản (PDF/Word) | Employee / Admin | Xuất biên bản họp ra định dạng PDF hoặc Word. | S | Extended | `minutes`, `reports` |
| UC-78 | Xem & tra cứu biên bản | Employee / Admin | Xem danh sách, chi tiết và tìm kiếm biên bản theo thời gian hoặc nhân sự. | M | Extended | `minutes` |

## FT-14 — Quản lý Thông báo

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-79 | Gửi thông báo vòng đời cuộc họp | System | Gửi thư mời, nhắc lịch và thông báo hủy cho người tham gia qua email. | M | Core | `notifications`, `mail`, `queue` |
| UC-80 | Gửi cảnh báo vận hành | System | Gửi cảnh báo cho các sự kiện vận hành: no-show, khuôn mặt lạ, người chưa check-in, lỗi thiết bị và lỗi ghi hình. | M | Core | `notifications` |
| UC-81 | Giám sát & thử lại thông báo thất bại | System Admin | Giám sát hàng đợi thông báo lỗi (dead-letter) và thử gửi lại để đảm bảo độ tin cậy. | S | Core | `queue`, `administration` |

## FT-15 — Phân tích & Quản trị

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-82 | Xem dashboard tổng quan & KPI | Manager / Admin | Xem các chỉ số tổng quan: số cuộc họp, tỷ lệ điểm danh, tỷ lệ no-show, thời lượng và tỷ lệ hủy. | M | Extended | `analytics` |
| UC-83 | Xem dashboard phòng & điểm danh | Manager / Admin | Xem chỉ số sử dụng phòng và điểm danh, so sánh và drill-down theo phòng/phòng ban. | M | Extended | `analytics`, `utilization` |
| UC-84 | Xem nhật ký kiểm tra (Audit log) | System Admin | Xem nhật ký kiểm toán các thao tác nhạy cảm của hệ thống. | S | Core | `administration` |
| UC-85 | Cấu hình chính sách hệ thống | System Admin | Cấu hình chính sách ghi hình và quyền riêng tư của hệ thống. | S | Core | `administration` |
| UC-86 | Xuất báo cáo tổng hợp | Manager / Admin | Xuất báo cáo tổng hợp hoạt động ra định dạng PDF/Excel. | S | Core | `reports` |

## FT-16 — Quản lý Đặt Phòng

| ID | Use Case | Tác nhân | Mô tả | Mức | Ưu tiên | Code |
|---|---|---|---|---|---|---|
| UC-87 | Gửi yêu cầu đặt phòng | Employee / Manager | Gửi yêu cầu đặt phòng họp; hệ thống kiểm tra xung đột phòng và người tham gia trước khi ghi nhận. | S | Core | `rooms` (room-bookings), `approvals` |
| UC-88 | Phê duyệt yêu cầu đặt phòng | Manager | Phê duyệt một yêu cầu đặt phòng để cho phép tạo cuộc họp. | S | Core | `rooms`, `approvals` |
| UC-89 | Từ chối yêu cầu đặt phòng | Manager | Từ chối một yêu cầu đặt phòng kèm lý do. | S | Core | `rooms`, `approvals` |

---

# PHẦN B — MỞ RỘNG GIÁM SÁT KHUÔN VIÊN · 31 use case

> Nội dung từ `SAVP_KE_HOACH_MO_RONG.pdf` §3, bổ sung cột **Code**.
> Dòng đánh dấu **＋** là use case phát sinh trong quá trình triển khai.
> Use case lịch ghi hình theo camera đã được cắt khỏi phạm vi — xem §C.2.

## FT-17 — Khu vực & sơ đồ camera · **ƯU TIÊN 1 (nền)**

> **Phải làm trước mọi phân hệ mới.** Đã kiểm chứng: `iot_devices` ban đầu chỉ có `room_id`,
> không có `zone_id` — hệ thống chỉ hiểu "phòng", chưa hiểu "cổng/hành lang/sảnh/bãi xe".
> Làm 2.5/2.6 trước Zone thì phải sửa lại toàn bộ.

| ID | Use Case | Mô tả | Loại | Ưu tiên | Ai | Code |
|---|---|---|---|---|---|---|
| UC-90 | Tạo khu vực | Tạo zone: mã, loại (phòng/cổng/hành lang/sảnh/bãi xe), toà nhà, tầng | Core | P1 | Hải | `zones` (ZNC-001) |
| UC-91 | Cập nhật khu vực | Sửa thông tin/loại/trạng thái zone | Core | P1 | Hải | `zones` (ZNU-001) |
| UC-92 | Xóa khu vực | Xóa mềm, cảnh báo nếu còn thiết bị/sự kiện | Core | P1 | Hải | `zones` (ZND-001) |
| UC-93 | Xem & tra cứu khu vực | List/chi tiết/lọc theo loại/toà/tầng | Core | P1 | Hải | `zones` |
| UC-94 | Gán camera vào khu vực | Gán device↔zone để định tuyến sự kiện theo khu vực | Core | P1 | Hải | `zones` (ZNA-001) |
| UC-95 | Sơ đồ lắp đặt camera | Đặt vị trí camera trên mặt bằng toà/tầng, xem trực quan. **BE lưu toạ độ, FE vẽ.** | Extended | P3 | Hải + Nam | `zones` (toạ độ) + FE |

## FT-18 — Cấu hình AI camera · **ƯU TIÊN 3**

| ID | Use Case | Mô tả | Loại | Ưu tiên | Ai | Code |
|---|---|---|---|---|---|---|
| UC-96 | Cấu hình chức năng AI camera | Bật/tắt face/biển số/đếm người theo từng camera **trong giới hạn thiết bị**. Chỉ lưu & áp dụng config. | Core | P3 | Hải | `iot` |

## FT-19 — Phương tiện & biển số · **ƯU TIÊN 2** (rẻ nhất, phần cứng đã nghiệm thu)

> **Vì sao ưu tiên 2:** module `anpr` đã có 11 route chạy + ANPR đã nghiệm thu phần cứng.
> Phần lớn nhóm này là **viết UC cho code đã có** + bổ sung control-list. Rủi ro thấp nhất toàn dự án.

| ID | Use Case | Mô tả | Loại | Ưu tiên | Ai | Code |
|---|---|---|---|---|---|---|
| UC-98 | Đăng ký phương tiện | NV đăng ký biển số cá nhân, chờ duyệt. **Code có sẵn.** | Core | P2 | Hải | `anpr` |
| UC-99 | Duyệt đăng ký phương tiện | Duyệt/từ chối hàng đợi. **Code có sẵn.** | Core | P2 | Hải | `anpr` |
| UC-100 | Cập nhật & hủy đăng ký | Sửa/hủy phương tiện. **Code có sẵn.** | Core | P2 | Hải | `anpr` |
| UC-101 | Xem & tra cứu phương tiện | List/lọc theo biển/chủ/loại/trạng thái. **Code có sẵn.** | Core | P2 | Hải | `anpr` (VPL-002) |
| UC-102 | Ghi nhận sự kiện biển số | Nhận event, lưu ảnh, chuẩn hoá, đối chiếu đăng ký. **Webhook có sẵn.** | Core | P2 | Hải | `anpr` (webhook) |
| UC-103 | Danh sách kiểm soát phương tiện | Thêm/gỡ/tra biển số cấm/theo dõi. **Xây mới.** | Core | P2 | Hải | `anpr` (vehicle-control-list) |
| UC-104 | Thống kê lưu lượng phương tiện | Thống kê ra/vào theo thời gian/cổng/loại xe | Extended | P3 | Hải | `gate-access` (VTS-001) |

## FT-20 — Điểm danh cổng (chỉ biển số) · **ƯU TIÊN 2**

| ID | Use Case | Mô tả | Loại | Ưu tiên | Ai | Code |
|---|---|---|---|---|---|---|
| UC-105 | Ghi nhận ra/vào khuôn viên | Từ event biển số tại zone=cổng → xác định chiều ra/vào, sinh bản ghi | Core | P2 | Hải | `anpr` → `zones` (writer) |
| UC-106 | Tính thời gian trong khuôn viên | Ghép cặp vào–ra, tính tổng thời gian/ngày, xử lý thiếu cặp | Core | P2 | Hải | `gate-access` (GAP-001) |
| UC-107 | Xem & tra cứu lịch sử ra vào cổng | Xem lịch sử ra vào bản thân/nhân sự, lọc thời gian/cổng/phòng ban | Core | P3 | Hải | `gate-access` (GAH-001) |

## FT-21 — Hiện diện khu vực công cộng · **ƯU TIÊN 3**

> **Điều kiện tồn tại:** nhóm phải trả lời được "camera hành lang giải bài toán gì" (vùng mù giữa
> cổng và phòng / đối soát tailgating / mật độ an toàn / truy vết nhanh). IVSS **đã xác nhận đếm
> được người** nên rào cản kỹ thuật đã gỡ. Nếu không chốt được lý do nghiệp vụ → **cắt cả FT-21**.

| ID | Use Case | Mô tả | Loại | Ưu tiên | Ai | Code |
|---|---|---|---|---|---|---|
| UC-108 | Cảnh báo xe không có quyền | Phát hiện xe chưa đăng ký/trong control-list tại cổng → cảnh báo | Core | P2 | Hải | `anpr` (VCC-001) |
| UC-109 | Ghi nhận hiện diện theo khu vực | Từ event nhận diện tại hành lang/sảnh → sinh sự kiện xuất hiện + cập nhật realtime | Core | P3 | Hải | `ivss` → `zones` (writer) |
| UC-110 | Timeline & thời gian lưu lại theo khu vực | Dòng thời gian + tổng thời gian một người ở từng zone | Core | P3 | Hải | `campus-dashboard` (ZPT-001) |
| UC-111 | Phân tích lưu lượng + heatmap khu vực | **Gộp UC-111+UC-112 cũ:** thống kê lưu lượng theo zone/khung giờ + heatmap **mức khu vực (đơn giản)**, không phải điểm ảnh | Extended | P3 | Hải + Nam | `campus-dashboard` (ZTH-001) |
| UC-112 | Cảnh báo tụ tập đông người | Số người tại zone vượt ngưỡng → cảnh báo. **IVSS đếm người đã xác nhận.** | Core | P3 | Hải | `crowd-alert` |
| **UC-122** ＋ | Hành trình khuôn viên của một người | Dựng **một dòng thời gian duy nhất** cho một người trong một ngày, ghép 3 kiểu nguồn: xe qua cổng, có mặt phòng họp (gộp thành phiên), hiện diện khu vực. Khác UC-110 ở chỗ lấy theo NGƯỜI, không theo zone. | Core | P3 | Hải | `gate-access` |

## FT-22 — Trung tâm cảnh báo an ninh · **ƯU TIÊN 3**

| ID | Use Case | Mô tả | Loại | Ưu tiên | Ai | Code |
|---|---|---|---|---|---|---|
| UC-113 | Cấu hình quy tắc cảnh báo | Cấu hình ngưỡng & kênh (người lạ, xe lạ, tụ tập, xâm nhập, thiết bị lỗi) | Core | P3 | Tài | `alerts` (ARL-001) |
| UC-114 | Xem & xử lý cảnh báo an ninh | Trung tâm gom cảnh báo realtime, lọc, xác nhận, ghi kết quả xử lý | Core | P3 | Tài | `alerts` (ASC-001) |
| UC-115 | Cảnh báo xâm nhập khu vực hạn chế | Người ở zone hạn chế ngoài giờ/không quyền → cảnh báo | Extended | P4 | Hải | `restricted-zone` |
| UC-116 | Danh sách kiểm soát người | Thêm/gỡ/tra cá nhân trong watchlist để cảnh báo khi nhận diện | Extended | P4 | Tài | `alerts` (PWL-001) |

## FT-23 — Dashboard & báo cáo khuôn viên · **ƯU TIÊN 4**

| ID | Use Case | Mô tả | Loại | Ưu tiên | Ai | Code |
|---|---|---|---|---|---|---|
| UC-117 | Dashboard điều hành khuôn viên | Realtime: số người hiện diện, lưu lượng ra vào, phương tiện, tình trạng camera theo zone/toà. **GIS = FE.** | Extended | P4 | Nam + Tài | `campus-dashboard` (CDB-001) |
| UC-118 | Xuất báo cáo ra vào khuôn viên | PDF/Excel. **Renderer có sẵn.** | Extended | P4 | Tài | `reports` |
| UC-119 | Xuất báo cáo phương tiện | PDF/Excel. **Renderer có sẵn.** | Extended | P4 | Tài | `reports` |
| UC-120 | Xuất báo cáo sự kiện an ninh | PDF/Excel. **Renderer có sẵn.** | Extended | P4 | Tài | `reports` |

---

# PHẦN C — QUYẾT ĐỊNH PHẠM VI

## C.1 — Đã GỘP (giảm số UC)

- **UC-111 + UC-112 cũ → UC-111**: "phân tích lưu lượng" và "heatmap khu vực" cùng một nguồn dữ
  liệu (sự kiện hiện diện theo zone) → gộp làm một, heatmap chỉ ở mức khu vực. *Tiết kiệm 1 UC.*
- **Thống kê đếm người** gộp vào UC-112 (cảnh báo tụ tập) thay vì tách UC riêng.

## C.2 — Đã CẮT / BỎ khỏi phạm vi

| Bỏ | Lý do |
|---|---|
| Heatmap điểm ảnh (pixel) | Phụ thuộc camera Dahua tự sinh — không kiểm soát được, chưa xác minh thiết bị hỗ trợ. **Làm heatmap mức khu vực thay thế.** |
| Lịch gửi báo cáo tự động | Lao động chân tay (thêm cron + template), 0 giá trị kỹ thuật để bảo vệ. Xuất thủ công là đủ. |
| Báo cáo định dạng Word | Thêm renderer thứ 3 cho mỗi báo cáo. PDF + Excel đã đủ chứng minh năng lực. |
| ~~Điểm danh phòng học~~ | **Mở lại 2026-10-05** — triển khai theo gap analysis #22–#24. Nền schema: ACD-001 (`spec/features/academic/feat-academic-db-schema/`). |
| Tích hợp eOffice / HRM / SIS | Không có hệ thống thật để tích hợp → chỉ mock được, không bảo vệ được. |
| Quản lý khách/guest | Workflow mới hoàn toàn, không tái dùng được nền có sẵn. |
| SMS | Cần cổng SMS trả phí. Email + in-app đủ chứng minh cơ chế cảnh báo đa kênh. |
| **Chuỗi họp định kỳ** *(nguyên UC-20, UC-21)* | Chỉ phục vụ lịch lặp lại — không tạo giá trị kỹ thuật mới so với tạo họp đơn lẻ. Người dùng vẫn đặt được từng buổi. |
| **Lịch ghi hình theo camera** *(nguyên UC-97)* | Ghi hình đã gắn vào vòng đời cuộc họp; lịch ghi độc lập là tính năng phụ, không phục vụ mục tiêu giám sát của hệ thống. |

> **Về số hiệu:** UC-20, UC-21 và UC-97 đã cắt khỏi phạm vi. Số hiệu của các use case còn lại
> **giữ nguyên, không đánh số lại**, để mọi tài liệu và mã nguồn đang tham chiếu vẫn đúng. Vì vậy
> danh mục có khoảng trống tại ba số này — đó là chủ ý, không phải thiếu sót.

## C.3 — GHI RÕ "TÙY NĂNG LỰC THIẾT BỊ" — không cam kết bằng phần mềm

Các mục sau **khách viết như tính năng phần mềm nhưng thực chất là năng lực thiết bị**. SRS phải
ghi rõ "tùy năng lực thiết bị", không cam kết làm bằng phần mềm — nếu không, hội đồng hỏi "chống
giả mạo đâu?" sẽ không trả lời được.

- **Anti-spoofing** (cảnh báo giả mạo/dùng ảnh) — năng lực camera/IVSS.
- **Nhận diện khẩu trang / thiếu sáng** — khách đã tự ghi "(nếu camera hỗ trợ)", giữ nguyên vế đó.
- **Nhận diện nhiều người đồng thời** — năng lực thiết bị, không phải chức năng phần mềm.

## C.4 — Thứ tự triển khai

| Giai đoạn | Làm gì | Vì sao thứ tự này | UC |
|---|---|---|---|
| **P1 · Nền** | Mô hình Khu vực (Zone) | Mọi phân hệ mới phụ thuộc. Làm sau = đập đi làm lại. | UC-90→94 |
| **P2 · Nền sẵn có** | Phương tiện + điểm danh cổng | Code ANPR sẵn + phần cứng đã nghiệm thu. Ăn điểm nhanh, rủi ro thấp nhất. | UC-98→103, 105, 106, 108 |
| **P3 · Vừa** | Hiện diện khu vực + trung tâm cảnh báo + cấu hình AI + tra cứu | Cần Zone (P1) xong. IVSS đếm người đã sẵn nên UC-112 làm được. | UC-96, 104, 107, 109→114, 95 |
| **P4 · Nếu kịp** | Dashboard khuôn viên + 3 báo cáo + xâm nhập + watchlist | Renderer sẵn → báo cáo rẻ. Dashboard/GIS là FE. Cắt được không đau. | UC-115→120 |

## C.5 — Phân công

| Người | UC |
|---|---|
| **Hải** *(phần camera)* | Zone UC-90→94 · Phương tiện UC-98→103 · Điểm danh cổng UC-105,106,107 · Cảnh báo xe UC-108 · Hiện diện khu vực UC-109,110,112 · Config AI UC-96 · *(Extended)* UC-95, 97, 104, 115 |
| **Tài** *(ngoài camera)* | Trung tâm cảnh báo UC-113,114,116 · Báo cáo UC-118,119,120 · Dashboard UC-117 (BE view) |
| **Nam** *(FE)* | Sơ đồ camera UC-95 (FE canvas) · Heatmap render UC-111 · Dashboard GIS UC-117 |
| **Nợ scope cũ** | *Hải:* UC-68 (route face-server), nợ báo lỗi ghi hình · *Không phải Hải:* UC-20/21 chuỗi họp định kỳ, nợ nhắc lịch, nợ visibility |

## C.6 — Việc chặn chưa gỡ (ưu tiên cao hơn viết thêm UC)

1. **Nghiệm thu phần cứng pause/resume ghi hình** — chưa test trên camera thật. Đây là bằng chứng
   bảo mật cốt lõi (đoạn pause phải biến mất khỏi file). Nếu vỡ → phải sửa code.
2. **Mạng cloud↔camera (Tailscale)** — EC2 không gọi được vào camera LAN nếu chưa dựng. Mọi UC
   realtime là lý thuyết cho tới khi có.
3. **Chốt "camera hành lang giải bài toán gì"** — quyết định FT-21 sống/chết. Cần hỏi khách 5 câu
   về **vấn đề** (không phải tính năng) trước khi viết SRS §2.

> **Lưu ý về "có SDD là code nhanh":** đúng cho phần CRUD, **sai cho phần tích hợp thiết bị** — mà
> tích hợp thiết bị chính là toàn bộ giá trị của SAVP. Bằng chứng từ scope cũ: nhiều UC có SDD đầy
> đủ, tên hàm đúng chuẩn, nhưng thân hàm là TODO rỗng hoặc thiếu route nối.

---

# PHẦN D — NHÓM USE CASE MEDIUM (đo khối lượng)

## D.1 — 29 nhóm cho phần nền (UC-01 → UC-89 + bổ sung)

| # | Nhóm Medium Use Case | Gồm UC | Module |
|---|---|---|---|
| M-01 | Xác thực & quản lý mật khẩu | UC-01→04 | FT-01 |
| M-02 | Quản lý vòng đời tài khoản | UC-05,06,08,09 | FT-02 |
| M-03 | Phân quyền & tra cứu tài khoản | UC-07,10 | FT-02 |
| M-04 | Quản lý phòng ban | UC-11,12,13 | FT-02 |
| M-05 | Hồ sơ cá nhân & đăng ký khuôn mặt | UC-14,15,16 | FT-02 |
| M-06 | Quản lý cuộc họp | UC-17,18,19,24 | FT-03 |
| M-08 | Quản lý thành viên & chương trình họp | UC-22,23 | FT-03 |
| M-09 | Quản lý phòng họp | UC-25,26,27,28 | FT-04 |
| M-10 | Quản lý thiết bị-tài sản | UC-29,30,31,32,33 | FT-05 |
| M-11 | Hỗ trợ lập lịch & phát hiện xung đột | UC-34,35 | FT-06 |
| M-12 | Giám sát phòng & xử lý no-show | UC-36,37,38,39,40 | FT-07 |
| M-13 | Điều khiển phiên họp | UC-41,42,43 | FT-08 |
| M-14 | Theo dõi & ghi chú trong họp | UC-44,45 | FT-08 |
| M-15 | Đăng ký & cấu hình thiết bị IoT | UC-46,47,48,49,50,51 | FT-09 |
| M-16 | Giám sát thiết bị & pipeline sự kiện | UC-52,53 | FT-09 |
| M-17 | Đồng bộ & cấp phát khuôn mặt | UC-54,55,56,57,123 | FT-09 |
| M-18 | Điểm danh tại cửa & hiệu chỉnh | UC-58,59,60 | FT-10 |
| M-19 | Xem điểm danh & timeline hiện diện | UC-61,121 | FT-10 |
| M-20 | Occupancy & hiện diện theo danh tính | UC-62,63,64 | FT-10 |
| M-21 | Cấu hình & điều khiển ghi hình | UC-65,66 | FT-11 |
| M-22 | Ghi âm theo người & quản lý media | UC-67,68,69 | FT-11 |
| M-23 | Chuyển văn bản (Transcript) | UC-70,71,72 | FT-12 |
| M-24 | Soạn & quản lý biên bản | UC-73,74,75,78 | FT-13 |
| M-25 | Ban hành & xuất biên bản | UC-76,77 | FT-13 |
| M-26 | Thông báo & cảnh báo | UC-79,80,81 | FT-14 |
| M-27 | Dashboard phân tích | UC-82,83 | FT-15 |
| M-28 | Nhật ký, chính sách & báo cáo | UC-84,85,86 | FT-15 |
| M-29 | Yêu cầu đặt phòng | UC-87 | FT-16 |
| M-30 | Phê duyệt đặt phòng | UC-88,89 | FT-16 |

## D.2 — 9 nhóm cho phần mở rộng SAVP

> ⚠ **Đây là đề xuất khi hợp nhất, không có trong tài liệu gốc.** Kế hoạch mở rộng chỉ liệt kê UC,
> chưa gom nhóm medium. Nhóm cần duyệt lại trước khi dùng để đo khối lượng.

| # | Nhóm Medium Use Case | Gồm UC | Module |
|---|---|---|---|
| M-31 | Quản lý khu vực (Zone) | UC-90,91,92,93 | FT-17 |
| M-32 | Gán camera & sơ đồ lắp đặt | UC-94,95 | FT-17 |
| M-33 | Cấu hình AI camera | UC-96 | FT-18 |
| M-34 | Vòng đời đăng ký phương tiện | UC-98,99,100,101 | FT-19 |
| M-35 | Sự kiện biển số & kiểm soát phương tiện | UC-102,103,104,108 | FT-19/21 |
| M-36 | Điểm danh cổng | UC-105,106,107 | FT-20 |
| M-37 | Hiện diện & phân tích khu vực | UC-109,110,111,112,122 | FT-21 |
| M-38 | Trung tâm cảnh báo an ninh | UC-113,114,115,116 | FT-22 |
| M-39 | Dashboard & báo cáo khuôn viên | UC-117,118,119,120 | FT-23 |

**→ 38 nhóm medium** (29 + 9), phủ đủ 120 use case.

---

# PHẦN E — THỐNG KÊ TỔNG HỢP

| Chỉ số | Phần nền | Mở rộng SAVP | Phát sinh | **Tổng** |
|---|---|---|---|---|
| Số use case (mức user-goal) | 87 | 30 | 3 | **120** |
| Ưu tiên: **Core** | 68 | 21 | 2 | **91** |
| Ưu tiên: **Extended** | 17 | 9 | 1 | **27** |
| Ưu tiên: **Pending** (chờ phần cứng) | 2 | 0 | 0 | **2** |
| Mức độ: Simple / Medium | 48 / 39 | *(không phân mức)* | 0 / 3 | 48 / 42 |
| Nhóm medium use case | 29 | 9 | *(đã gộp vào nhóm sẵn có)* | **38** |
| UC thuộc phần camera | 24 | 22 | 3 | **49** |
| UC là năng lực phần cứng | 0 | 0 | 0 | **0** |

**Đối soát cân bằng:** 87 + 30 + 3 = **120** · Core 68+21+2 = 91 · Extended 17+9+1 = 27 ·
Pending 2 · 91 + 27 + 2 = **120** ✓

> **Vì sao "phần nền" là 87 chứ không phải 89:** đã cắt UC-20, UC-21 (chuỗi họp định kỳ).
> **Vì sao "mở rộng" là 30 chứ không phải 31:** đã cắt UC-97 (lịch ghi hình theo camera).
> Chi tiết lý do ở §C.2. Ba use case phát sinh (UC-121 → UC-123) bù lại đúng ba chỗ cắt,
> nên tổng vẫn là 120.

---

# PHẦN F — ĐỐI CHIẾU SANG SOURCE CODE

## F.1 — Module `capstone-be` theo nhóm chức năng

| FT | Nhóm | Module code |
|---|---|---|
| FT-01 | Xác thực & phân quyền | `auth` |
| FT-02 | Tài khoản & phòng ban | `accounts`, `face-access` |
| FT-03 | Cuộc họp | `meetings` |
| FT-04 | Phòng họp | `rooms` |
| FT-05 | Thiết bị-tài sản | `equipment` |
| FT-06 | Lập lịch | `scheduling` |
| FT-07 | No-show & trạng thái phòng | `rooms`, `scheduler`, `utilization` |
| FT-08 | Trong cuộc họp | `live-meeting`, `presence` |
| FT-09 | Thiết bị IoT | `iot`, `ivss`, `face-access` |
| FT-10 | Điểm danh & hiện diện | `attendance`, `presence`, `ivss` |
| FT-11 | Ghi hình | `recording`, `storage` |
| FT-12 | Transcript | `transcription` + worker `ai-transcription` |
| FT-13 | Biên bản | `minutes`, `documents` |
| FT-14 | Thông báo | `notifications`, `mail`, `queue` |
| FT-15 | Phân tích & quản trị | `analytics`, `administration`, `reports` |
| FT-16 | Đặt phòng | `rooms` (room-bookings), `approvals` |
| **FT-17** | **Khu vực & sơ đồ** | **`zones`** |
| **FT-18** | **Cấu hình AI** | **`iot`** |
| **FT-19** | **Phương tiện & biển số** | **`anpr`** |
| **FT-20** | **Điểm danh cổng** | **`gate-access`** |
| **FT-21** | **Hiện diện khu vực** | **`campus-dashboard`, `crowd-alert`, `zones`** |
| **FT-22** | **Cảnh báo an ninh** | **`alerts`, `restricted-zone`** |
| **FT-23** | **Dashboard & báo cáo khuôn viên** | **`campus-dashboard`, `reports`** |

## F.2 — Ba use case phát sinh từ triển khai (đã đưa vào danh mục)

Ba chức năng dưới đây được xây trong quá trình triển khai, không có trong hai tài liệu nguồn.
Nay đã được đánh số và đưa vào Phần A / Phần B, đánh dấu **＋**.

| UC | Chức năng | Vị trí trong code | Thuộc nhóm |
|---|---|---|---|
| **UC-121** | Xem nhật ký ra/vào theo phòng | `ivss/controllers/ivss-room-access.controller.ts` | FT-10 |
| **UC-122** | Hành trình khuôn viên của một người | `gate-access/controllers/user-journey.controller.ts` | FT-21 |
| **UC-123** | Duy trì kho khuôn mặt thường trực trên IVSS | `ivss/services/ivss-portrait-sync.service.ts` | FT-09 |

---

# PHẦN G — ⚠ MÂU THUẪN CẦN CHỐT (không tự quyết trong tài liệu này)

## G.1 — Bản 89 gốc tự mâu thuẫn ở bảng thống kê

`SMRMPTS_UseCaseList_Master.md` §6 ghi **Core 67 / Extended 20 / Pending 2**. Đếm lại trực tiếp
từ chính các bảng §4 của tài liệu đó:

- **Extended = 17**: UC-29,30,31,32,33 (5) + UC-67 (1) + UC-70,71,72 (3) + UC-73→78 (6) + UC-82,83 (2)
- **Pending = 2**: UC-63, UC-64
- **Core = 89 − 17 − 2 = 70**

Mức độ S/M thì khớp (49/40). Tài liệu này dùng số **đếm lại (70/17/2)**; nếu nhóm muốn giữ
67/20/2 thì phải chỉ ra 3 UC nào bị đổi từ Core sang Extended.

## G.2 — Kế hoạch mở rộng tự mâu thuẫn ở 2 con số

| Nơi ghi | Con số | Đếm lại từ bảng §3 |
|---|---|---|
| Ô tóm tắt trang 1 | "**~20** UC bổ sung (sau cắt/gộp)" | **31** UC tổng · **21** UC Core → "~20" khớp nếu chỉ đếm Core |
| Ô tóm tắt trang 1 + §6 | "**13** UC phần camera (Hải)" | **19** UC Core của Hải (+4 Extended = 23) |

Con số 13 chưa giải thích được bằng bảng phân công. **Cần Hải xác nhận** đâu là phạm vi thật.

---

## H — Ghi chú truy vết

- **Ranh giới phần cứng/phần mềm:** các UC liên quan camera (FT-09, FT-10, FT-11, FT-17→FT-21) chỉ
  gọi API, nhận sự kiện, lưu và hiển thị dữ liệu. Nhận diện khuôn mặt, chống giả mạo, đếm người và
  khớp danh tính IVSS thuộc về thiết bị, **không nằm trong phạm vi phần mềm**.
- **Hạng mục cần chốt nội bộ trước khi baseline SRS:**
  1. Cuộc họp định kỳ (UC-20, UC-21) và tạm dừng/tiếp tục ghi hình (UC-66) — **đã có trong mã
     nguồn**: nên giữ trong phạm vi và đồng bộ lại nếu tài liệu cũ đánh dấu loại bỏ.
  2. Bổ sung chức năng gửi yêu cầu đặt phòng (UC-87) ở tầng API; đảm bảo phê duyệt/từ chối
     (UC-88, UC-89) thuộc module Quản lý Đặt Phòng, không thuộc Lập lịch.
  3. 3 endpoint đã code nhưng chưa có UC — §F.2.
- **Ánh xạ hai phần:** dùng Phần A+B cho đặc tả và thiết kế; dùng Phần D để đo và trình bày khối lượng.

---

*SAVP Use Case List v4.0 · Nhóm SEP490_G61 · Hợp nhất 29/07/2026 · Số hiệu chuẩn: UC-01 → UC-120 ·
Cột "Code" và Phần F căn cứ trên đọc trực tiếp source code `capstone-be`.*
