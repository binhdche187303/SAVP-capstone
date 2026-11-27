# Mock camera để demo (chưa có API camera thật)

Script giả lập camera, gửi sự kiện **kèm ảnh** vào đúng các webhook thật của backend:

- `POST /internal/ivss/events`: khuôn mặt
- `POST /internal/ivss/occupancy-events`: đếm người
- `POST /internal/ivss/vehicle-events`: biển số

Backend xử lý như với camera thật: lưu ảnh, tạo cảnh báo và đẩy realtime lên FE. **Không sửa code server.** Muốn dừng mock thì chỉ cần không chạy script nữa.

## Chuẩn bị (1 lần)

1. Bật DB và backend (`npm run start:dev`). Trong `.env` phải có `IVSS_BRIDGE_TOKEN`.
2. Chuẩn bị ảnh (jpg/png, mỗi ảnh nên < 1MB). Các ảnh này **không bị commit** lên repo.
   - `images/faces/`: ảnh khuôn mặt (vd ảnh AI từ thispersondoesnotexist.com)
   - `images/plates/`, `images/crowd/`: tự sinh bằng lệnh dưới (cần Edge/Chrome). Ảnh xe được vẽ **đúng biển số** của cảnh báo. Ảnh đám đông ghép từ ảnh mặt nên phải có `faces/` trước.
     ```bash
     npm run demo:images
     ```

   Thư mục trống thì sự kiện vẫn được gửi, chỉ là không có ảnh.
3. (Để cảnh báo đám đông có ảnh) Đặt `IVSS_BRIDGE_BASE_URL=http://localhost:8099` trong `.env`, khởi động lại BE, rồi mở một terminal riêng chạy bridge giả:
   ```bash
   npm run demo:camera -- bridge
   ```
   Khi vượt ngưỡng, BE tự gọi bridge để chụp ảnh và bridge trả về một ảnh ngẫu nhiên trong `images/crowd/`.
4. Tạo dữ liệu nền demo:
   ```bash
   npm run demo:camera -- setup 5      # 5 = số người dùng được gán mã nhận diện demo
   ```
   Lệnh `setup` tạo thiết bị `IVSS-BRIDGE` (nếu chưa có), 4 zone `DEMO-*`, gán channel 901–904, luật xâm nhập/đám đông, 2 biển số kiểm soát và mã `DEMO-UID-n` cho người dùng. Chạy lại nhiều lần không bị trùng.

## Chạy demo

```bash
npm run demo:camera -- all              # lần lượt mọi kịch bản
npm run demo:camera -- loop 8           # sự kiện ngẫu nhiên ~8s/lần, Ctrl+C để dừng
npm run demo:camera -- intrusion        # chạy riêng 1 kịch bản
npm run demo:camera                     # xem danh sách lệnh
```

| Kịch bản | Channel / Zone | Kết quả mong đợi |
|---|---|---|
| `person` | 901 Hành lang | Bắt gặp người quen + ảnh |
| `stranger` | 901 Hành lang | Sự kiện người không nhận diện + ảnh |
| `intrusion` / `intrusion-known` | 902 Khu cấm | Cảnh báo xâm nhập |
| `crowd` | 903 Sảnh | Đếm 3 → 6 → 12 người, vượt ngưỡng 5 → cảnh báo đám đông |
| `vehicle-unknown` | 904 Cổng | Cảnh báo biển số không xác định + ảnh |
| `vehicle-blocked` | 904 Cổng | Cảnh báo xe bị chặn `51A99999` (mức cao) |
| `vehicle-watch` | 904 Cổng | Cảnh báo xe theo dõi `30K88888` (mức trung bình) |

Cảnh báo cùng loại đang mở sẽ **không tạo bản ghi mới** (chống trùng). Muốn thấy cảnh báo mới thì xử lý/đóng cảnh báo cũ trên web trước.

## Dọn sau demo

```bash
npm run demo:camera -- cleanup
```

Lệnh này xoá cảnh báo, sự kiện, zone, luật, biển số và mã nhận diện demo, đồng thời gỡ channel 901–904 khỏi cấu hình. Channel và zone thật không bị đụng tới.

## Demo trên server

Đặt biến môi trường trước khi chạy:
```bash
DEMO_API_URL=https://<server>/api/v1 IVSS_BRIDGE_TOKEN=<token server> npm run demo:camera -- all
```

`setup` và `cleanup` ghi thẳng vào DB theo các biến `DB_*` trong `.env`, nên phải trỏ đúng DB của server.

## Giới hạn

- **Watchlist người** và **người lạ của máy chấm công khuôn mặt (FaceGate)** đi qua luồng khác (`/device-callbacks/face/*`, cần token của thiết bị), nên script chưa giả lập. Luồng FaceGate cũng không lưu ảnh.
- Cảnh báo `unknown_vehicle` không gắn ảnh vào chính cảnh báo (hành vi sẵn có của server), nhưng trang xe không xác định vẫn hiện ảnh lấy từ sự kiện.
- Trên server thật **không** đặt `IVSS_BRIDGE_BASE_URL` trỏ tới bridge giả. Khi có camera thật thì trỏ về bridge thật.
- Sau này khi có API camera thật: nếu camera không dùng IVSS thì chỉ cần một adapter đổi dữ liệu camera sang đúng định dạng các webhook trên. Phần xử lý cảnh báo giữ nguyên.
