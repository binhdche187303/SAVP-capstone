# Đề xuất: nối 3 trang camera của SAVP với HGVision

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-11-18 | Tạo file: phân tích video HGVision và OpenAPI 1.0.0, đề xuất nối camera-groups / camera-recording / zones (chỉ đọc), SAVP tự tính cảnh báo đông người từ vạch đếm | Toàn bộ file |

*Ngày 18/11/2026. Nguồn: video `Document/Server cam.mp4` (giao diện HGVision bản mới) và `docs/hgvision/openapi-1.0.0.json` (77 endpoint).*

## 1. Nguyên tắc đã chốt

- **HGVision quản lý camera.** Thêm/sửa camera, ROI, vạch đếm, bật/tắt AI, ghi hình và giới hạn lưu trữ đều làm trên giao diện HGVision (`:8113`).
- **SAVP chỉ đọc dữ liệu.** SAVP không ghi gì xuống HGVision. Dữ liệu đọc về được dùng cho nghiệp vụ: chuyên cần, cảnh báo, báo cáo, phân quyền theo khu vực.
- **Cảnh báo đông người do SAVP tự tính.** Lý do là HGVision không có API đặt quy tắc này.
- Cả 3 trang (`camera-groups`, `camera-recording`, `zones`) đều được nối với HGVision ở dạng **chỉ đọc**.

## 2. Những gì HGVision có và không có

| Nhu cầu | Có API? | Endpoint |
|---|---|---|
| Danh sách và trạng thái camera (Online, FPS, nhóm, AI) | Có | `GET /api/cameras/statuses` (bản rút gọn, dùng để polling) |
| Sức khoẻ, nhật ký kết nối của 1 camera | Có | `GET /api/cameras/{name}/health`, `/logs` |
| Nhóm camera | Có | `GET /api/groups` (gồm tên, mô tả, toạ độ, số camera) |
| Tài nguyên máy chủ (CPU, RAM, ổ đĩa, GPU) | Có | `GET /api/dashboard/resources` |
| Khoảng thời gian có ghi hình, các đoạn đã ghi | Có | `GET /api/playback/recordings`, `GET /api/recording/segments` |
| Phát lại, tải MP4, xuất clip | Có | `/api/playback/video`, `/download`, `/export` |
| Đếm người vào/ra theo vạch | Có | `GET /api/counting-lines`, `/{id}/counts`, `/{id}/timeseries` |
| Lịch sử phát hiện kèm ảnh, thống kê | Có | `/api/history`, `/api/history/statistics`, `/api/media/images/*` |
| **Giới hạn lưu trữ** (ngưỡng 80%, số ngày giữ, độ dài mỗi đoạn) | **Không** | Chỉ chỉnh được trên giao diện HGVision. SAVP chỉ đọc được dung lượng ổ qua `dashboard/resources` |
| **Quy tắc cảnh báo đông người** | **Không** | `/api/notifications` chỉ dành cho danh sách đen và định danh |
| Bật/tắt ghi hình, AI; vẽ ROI; tạo vạch đếm | Có (ghi) | Không dùng, vì SAVP chỉ đọc |

> Video là bản HGVision mới hơn 1.0.0. Các mục 2.4, 2.6, 2.7, 2.8 bị cuộn qua nên chưa đọc được. **Cần xin nhà cung cấp file `openapi.json` mới** (nút "Tải openapi.json" ở trang Tài liệu API) để xác nhận lại hai dòng "Không" ở trên.

## 3. Đề xuất cho từng trang

### 3.1 `camera-groups`: hiển thị nhóm của HGVision

**Hiện tại:** SAVP có bảng nhóm riêng (`camera-groups` module) và người dùng tự gom thiết bị. Nhóm này không gắn với HGVision và không chi phối gì, nên trang không có ý nghĩa.

**Đề xuất:**
- Nguồn dữ liệu là `GET /api/groups` và `GET /api/cameras/statuses` (trường `camera_group`).
- Trang hiển thị các nhóm, và trong mỗi nhóm là danh sách camera kèm trạng thái Online/Mất tín hiệu, FPS, AI bật/tắt.
- Thêm cột **"Khu vực SAVP"** cho biết camera đang gắn với zone nào. Đây là thông tin duy nhất SAVP thêm vào.
- Bỏ các nút tạo/sửa/xoá nhóm. Thay bằng nút "Mở HGVision" dẫn sang trang quản lý camera bên đó.
- Module `camera-groups` phía BE chuyển thành proxy chỉ đọc có cache khoảng 30 giây. Bảng nhóm cũ chỉ ngừng dùng, chưa xoá.

### 3.2 `camera-recording`: trạng thái ghi hình thật

**Hiện tại:** dữ liệu **hoàn toàn giả** (`mocks/cameraMock`), có cả modal "lịch ghi hình" mà HGVision không hỗ trợ.

**Đề xuất:**
- **Thẻ lưu trữ:** lấy dung lượng ổ đã dùng/tổng và % từ `dashboard/resources.disk`. Hiển thị thêm ghi chú: "Giới hạn lưu trữ (80%, 10 ngày) chỉnh trên HGVision".
- **Bảng camera:** với mỗi camera, gọi `playback/recordings` cho 24 giờ gần nhất. Hiển thị thanh thời gian các khoảng có ghi hình (component thanh 24h đã có sẵn trong trang) và % thời gian bị trống.
- **Cảnh báo mất ghi hình:** camera bật ghi nhưng có khoảng trống trên N phút sẽ được đánh dấu đỏ. Có thể đẩy sang `device-alert`.
- **Xem lại:** bấm vào một khoảng trên thanh thời gian sẽ mở trình phát. Trình phát dùng `playback/playlist` (HLS) hoặc `playback/video`.
- Bỏ `RecordingScheduleModal`.

### 3.3 `zones`: giữ làm lõi, thêm phần ánh xạ camera và vạch đếm

**Hiện tại:** dữ liệu thật và đang được dùng cho cảnh báo đông người, khu vực cấm, chuyên cần theo phòng. Trang chưa rõ ý nghĩa vì hai lý do:
- Ánh xạ camera → zone nằm ẩn trong `system_configs` (`hgvision.camera_channel_map`, `channel_zone_map`...) và không có màn hình chỉnh.
- Không thấy ngưỡng và trạng thái hiện tại của từng zone.

**Đề xuất:** mỗi zone có thêm tab **"Camera & đếm người"** gồm:
1. **Camera thuộc zone:** chọn từ danh sách camera HGVision (theo `camera_name`). Phần này thay cho việc sửa JSON trong `system_configs`.
2. **Vạch đếm:** chọn các vạch có sẵn trên HGVision (`GET /api/counting-lines?camera_name=`) cho từng camera ở cửa ra vào của zone. Với mỗi vạch, ghi rõ chiều "vào" của HGVision là vào zone hay ra khỏi zone.
3. **Ngưỡng đông người:** dùng ngay quy tắc `crowd-alert` đang có, chỉ cần đưa lên màn hình.
4. **Số người hiện tại** của zone, cập nhật từng phút (xem mục 4).

## 4. Cảnh báo đông người do SAVP tự tính

Hiện `crowd-alert` đọc `ivss_occupancy_event` do IVSS đẩy lên. Với HGVision, nguồn dữ liệu đổi thành vạch đếm:

```
Mỗi phút (cron đã có sẵn):
  với mỗi zone có vạch đếm:
    vào = Σ in_count  (của các vạch có chiều "vào zone")  +  Σ out_count (của các vạch có chiều ngược)
    ra  = Σ out_count (của các vạch có chiều "vào zone")  +  Σ in_count  (của các vạch có chiều ngược)
    số người hiện tại = max(0, vào − ra)       // tính từ mốc reset
    → ghi một dòng occupancy event (cùng định dạng với IVSS)
    → crowd-alert so với ngưỡng như hiện nay (giữ logic > ngưỡng, chống trùng)
```

Mỗi vạch được đọc bằng `GET /api/counting-lines/{id}/counts?from=<mốc reset>&to=<bây giờ>`. Mốc reset là đầu ngày hoặc giờ mở cửa.

**Giới hạn cần chấp nhận:**
- Chỉ chính xác khi **mọi lối vào/ra** của zone đều có camera và vạch đếm. Phòng có 2 cửa mà chỉ 1 cửa có camera sẽ cho số sai.
- Sai số tích luỹ: đếm hụt khi đông hoặc ngược sáng làm số người hiện tại trôi dần. Vì vậy cần **reset hằng ngày** và chặn số âm.
- Vạch đếm do người vận hành tự vẽ trên HGVision. Theo video, trang "Thống kê đếm" hiện **chưa có vạch nào**.

**Cách dự phòng** cho zone chỉ có 1 camera nhìn bao quát (ví dụ sảnh): đếm số người phát hiện trong khung hình qua `history/statistics` theo từng phút. Cách này chỉ ước lượng được, nên dùng làm phương án thứ hai.

## 5. Tính năng nên bổ sung so với video

Xếp theo mức độ đáng làm, tất cả đều chỉ đọc:

1. **Cảnh báo camera mất tín hiệu.** Lấy `cameras/statuses` mỗi phút; camera chuyển Offline thì tạo cảnh báo trong `device-alert`. Trong video, "Cong 2 huong vao" đang mất tín hiệu nhưng không có thông báo nào.
2. **Thẻ sức khoẻ máy chủ AI** trên dashboard admin, dùng `dashboard/resources`. Ổ đĩa đầy sẽ làm ngừng ghi hình.
3. **Xem clip tại thời điểm xảy ra sự kiện.** Từ một cảnh báo (đông người, khu vực cấm, danh sách đen), mở video ±30 giây qua `playback/video` hoặc `playback/export`.
4. **Thư viện ảnh sự kiện** (giống trang "Lịch sử phát hiện" của HGVision), lọc theo zone của SAVP thay vì theo camera.

## 6. Việc cần chuẩn bị trước khi code

- [ ] Có **IP hoặc domain thật** của máy chủ HGVision mà BE SAVP truy cập được qua mạng. Video đang xem qua AnyDesk ở `localhost:8113`.
- [ ] Tạo client API trên HGVision (trang Tích hợp API) với các quyền: `cameras:read`, `counting:read`, `dashboard:read`, `playback:read`, `history:read`.
- [ ] Lấy file `openapi.json` bản mới.
- [ ] Vẽ vạch đếm trên HGVision cho các cửa của những zone cần cảnh báo đông người.

## 7. Thứ tự làm đề xuất

1. BE: thêm vào `hgvision.client` các hàm đọc statuses, groups, resources, counting-lines, playback, có cache ngắn.
2. `zones`: tab Camera & đếm người, cùng bảng ánh xạ zone ↔ camera ↔ vạch (thay cho JSON trong `system_configs`).
3. `crowd-alert`: thêm nguồn dữ liệu occupancy từ vạch đếm.
4. `camera-recording`: thay dữ liệu giả bằng dữ liệu thật.
5. `camera-groups`: đổi sang chỉ đọc từ HGVision.
6. Cảnh báo camera mất tín hiệu và thẻ sức khoẻ máy chủ.

Làm trên nhánh `feature/hgvision-camera-pages`.
