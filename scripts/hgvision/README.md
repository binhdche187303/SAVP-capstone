# HGVision scripts

## 📝 CHANGELOG & REVISION HISTORY
| Ngày cập nhật | Tóm tắt thay đổi | Các dòng thay đổi |
| :--- | :--- | :--- |
| 2026-11-20 | Thêm mục "Đối soát tự động SAVP ↔ HGVision" và "Test đối soát trên máy trường": job 15 phút + nút "Đối soát ngay", tự khôi phục biển bị xoá bên HGVision, báo "Lệch với hệ thống nhận diện" khi HGVision bị sửa tay, xoá biển thừa do SAVP tạo, ngưỡng an toàn khi mất quá nhiều biển. Thêm `HGVISION_RECONCILE_INTERVAL_MS` vào mẫu `.env`. | Mẫu `.env` máy trường; 2 mục mới trước "Dữ liệu test phải xoá" |
| 2026-11-19 | Thêm mục "Xe đăng ký → HGVision (Bình thường)" và "Test xe đăng ký trên máy trường": quy tắc đẩy xe đăng ký (chủ xe theo tài khoản, danh sách đen do admin đặt luôn thắng), nút đồng bộ hàng loạt + ↻, 2 API mới, migration `20261119000001`. Thêm biển test `99A99997` vào bảng dữ liệu phải xoá và `cleanup-plate-test.sql`. | 2 mục mới trước "Dữ liệu test phải xoá"; bảng dữ liệu test; dòng unit test cuối file; `cleanup-plate-test.sql` |
| 2026-11-19 | Test máy trường: lỗi 403 `insufficient_scope` (thiếu `plates:write`, cấp quyền + restart BE) và 400 (`is_blacklist` phải là số 0/1 — đã sửa code). Thêm biển test thứ 2 `99A99998` vào bảng dữ liệu phải xoá + script dọn. | Bảng "Dữ liệu test phải xoá"; `cleanup-plate-test.sql` |
| 2026-11-19 | Đổi biển test `TEST01` → `99A-999.99` (`99A99999`): `TEST01` bị SAVP từ chối vì sai định dạng biển số. | Mục "Đẩy biển số SAVP → HGVision" bước 5–7, bảng dữ liệu test; `cleanup-plate-test.sql` |
| 2026-11-19 | Thêm mục "Đẩy biển số SAVP → HGVision": quy tắc đồng bộ, các bước test 1 biển `TEST01` trên máy trường, danh sách dữ liệu test phải xoá + script `cleanup-plate-test.sql`. | Mục mới cuối file, file `cleanup-plate-test.sql` |
| 2026-11-18 | Sửa giả định #1: `live_hls_path` là tên luồng MediaMTX, video lấy từ `HGVISION_HLS_BASE_URL` (:8888). Thêm biến này vào mẫu `.env` máy trường. | Mục "Cấu hình BE trên máy trường", "Giả định" #1 |
| 2026-11-18 | Xóa mock HGVision (`server.mjs`, `prepare-media.mjs`, npm `hgvision:mock*`) sau khi test xong API camera cho FE. Chuyển thư mục `scripts/hgvision-mock/` → `scripts/hgvision/`, chỉ giữ `capture-real.mjs`. Thêm mục cấu hình máy trường. Mock vẫn lấy lại được từ commit `f0830a2`. | Toàn bộ file |
| 2026-11-18 | Thêm script `capture-real.mjs` (lấy JSON thật, chỉ đọc) và mục "Lấy JSON thật trên máy trường" | Mục mới cuối file |
| 2026-11-18 | Tạo mock HGVision (giả lập OpenAPI 1.0.0) để dev SAVP khi không truy cập được máy HGVision thật ở trường | Toàn bộ file |

## Cấu hình BE trên máy trường

`.env` (không commit, mỗi máy giữ riêng):

```
CAMERA_PROVIDER=hgvision          # bật poller lịch sử (cần scope history:read)
HGVISION_ENABLED=true
HGVISION_BASE_URL=http://localhost:8113
HGVISION_HLS_BASE_URL=http://localhost:8888   # MediaMTX — nguồn video live (không cần token)
HGVISION_CLIENT_ID=<tạo ở trang "Tích hợp API" của HGVision>
HGVISION_CLIENT_SECRET=<như trên>
HGVISION_WRITE_ENABLED=false      # chỉ bật khi đã thử ghi định danh trên máy thật
HGVISION_RECONCILE_INTERVAL_MS=900000   # đối soát biển số mỗi 15 phút; 0 = tắt (nút "Đối soát ngay" vẫn dùng được)
```

Client HGVision cần tối thiểu scope `cameras:read` (trang camera bảo vệ). Thêm `dashboard:read` để xem tài nguyên máy chủ, và `history:read` cho poller sự kiện.

Kiểm tra nhanh sau khi cấu hình: đăng nhập tài khoản quản trị hệ thống rồi gọi `GET /api/v1/hgvision/status`. Kết quả đúng là `configured: true, reachable: true` kèm danh sách scope.

## Lấy JSON thật trên máy trường (qua AnyDesk)

Script `capture-real.mjs` **chỉ đọc**: gọi khoảng 30 API GET và không ghi gì xuống HGVision. Mỗi mảng chỉ giữ 5 phần tử. `username`/`password` camera được thay bằng `***`.

```bash
# Trên máy trường, trong thư mục capstone-be (.env đã có client thật)
npm run hgvision:capture                          # → scripts/hgvision/.capture/real/
npm run hgvision:capture -- --compare real <nhãn> # so cấu trúc field giữa 2 lần lấy
```

Thư mục `.capture/` đã nằm trong gitignore và **không được commit**, vì có thể chứa tên hoặc mã người thật.

## Giả định cần kiểm lại trên server thật

1. ~~`live_hls_path` là đường dẫn tương đối trên `:8113`~~ — **đã kiểm 2026-11-18: SAI.** Máy thật trả *tên luồng MediaMTX* (vd `afcd30ac-…`, `…_sub`). `:8113/<tên>/index.m3u8` trả trang đăng nhập (307) còn `:8888/<tên>/index.m3u8` trả `#EXTM3U`, nên BE đọc từ `HGVISION_HLS_BASE_URL`. Nếu giá trị có dấu `/` thì BE vẫn coi là path trên `HGVISION_BASE_URL` như cũ. Nếu HGVision trả nội dung không phải HLS, BE trả 502 `HGVISION_LIVE_NOT_HLS`.
2. Mức `level` trong `cameras/health`: FE hiển thị `good` / `weak` / `offline`; mức khác sẽ hiện theo trạng thái online/offline.
3. Sự kiện vạch đếm: `direction` 1 = vào, −1 = ra (OpenAPI không ghi rõ).
4. POST faces với `face_ident` đã tồn tại: server thật có thể gộp ảnh vào định danh cũ thay vì trả 400.
5. `GET /api/cameras` trả cả `username`/`password` camera, nên BE đã lọc bỏ trước khi gửi xuống FE.

## Đẩy biển số SAVP → HGVision

Trang "Danh sách biển số giám sát" (`/anpr/admin/control-list`) tự đẩy sang HGVision khi `CAMERA_PROVIDER=hgvision`:

- Thêm / sửa / bật-tắt / xoá trên SAVP → thêm / sửa / xoá biển bên HGVision.
- `blocklist` → `is_blacklist: true`; `watchlist` → chỉ tạo biển. Biển có cả hai → danh sách đen.
- Biển bị tắt hết hoặc xoá hết trên SAVP → xoá bên HGVision, **chỉ khi biển do SAVP tạo**.
- Biển có sẵn trên HGVision mà SAVP chưa từng tạo → không ghi đè, không xoá, báo "Đồng bộ HGVision lỗi".
- `HGVISION_WRITE_ENABLED=false` → không gọi HGVision, dòng hiện "Chưa đồng bộ HGVision". Bật cờ rồi bấm nút đồng bộ lại (biểu tượng ↻) để đẩy.
- HGVision lỗi → SAVP vẫn lưu biển, trạng thái "Đồng bộ HGVision lỗi" (rê chuột xem lỗi).

Cần scope `plates:write` cho client trên trang "Tích hợp API" của HGVision. Đổi scope xong khởi động lại BE (token cũ được giữ khoảng 1 giờ).

### Test 1 biển trên máy trường

1. Tích `plates:write` cho client hiện tại trên HGVision.
2. `git pull` nhánh `feature/hgvision-plate-write` (BE + FE), `npm run migration:run` ở BE.
3. Đặt `HGVISION_WRITE_ENABLED=true` trong `.env`, khởi động lại BE.
4. `GET /api/v1/hgvision/status` → thấy `plates:write` trong danh sách scope.
5. Trên SAVP thêm biển `99A-999.99` (SAVP lưu chuẩn hoá `99A99999`, biển giả, không trùng xe thật), loại "Danh sách đen", lý do "TEST đồng bộ". Dòng phải hiện "Đã đồng bộ HGVision".
6. Mở trang biển số của HGVision → có `99A99999`, đánh dấu danh sách đen.
7. Trên SAVP xoá `99A99999` → HGVision không còn `99A99999`.
8. Đặt lại `HGVISION_WRITE_ENABLED=false`, khởi động lại BE.

### Xe đăng ký → HGVision (Bình thường)

Xe đăng ký trên SAVP cũng được đẩy sang HGVision ngay khi lưu (khi `CAMERA_PROVIDER=hgvision`), dạng **Bình thường** (`is_blacklist: 0`). Áp dụng cho 3 nơi:

- "Phương tiện cá nhân": mọi vai trò tự đăng ký xe.
- "Đăng ký xe nhân viên": business admin đăng ký hộ.
- Trang "Đăng ký phương tiện" của system admin.

Cách ghi:

- Chủ xe (`ident`) lấy theo tài khoản: `Họ tên - Mã nhân viên`. Không có mã thì chỉ ghi họ tên.
- Mô tả (`lp_infor`): `SAVP - Xe đăng ký (Ô tô)` hoặc `SAVP - Xe đăng ký (Xe máy)`.
- Danh sách đen chỉ do admin đặt ở "Danh sách biển số giám sát" và luôn thắng. Xe đã đăng ký mà bị đưa vào danh sách đen thì thành `is_blacklist: 1`, vẫn giữ tên chủ xe. Gỡ khỏi danh sách đen thì xe về lại Bình thường, biển không bị xoá.
- Tạm dừng hoặc xoá xe, và biển không còn trong danh sách giám sát → xoá biển bên HGVision (chỉ khi biển do SAVP tạo).
- Sửa xe hoặc bật lại → ghi lại bên HGVision. Nếu biển đã bị xoá bên đó thì tạo mới.
- HGVision lỗi hoặc cờ ghi đang tắt không chặn việc lưu xe. Trạng thái đồng bộ hiện dưới cột "Trạng thái" ở trang "Đăng ký phương tiện" và "Phương tiện cá nhân".

Trang "Đăng ký phương tiện" (system admin, quyền `anpr.vehicle.admin_register`) có 2 nút:

- **Đồng bộ HGVision** (đầu trang): đẩy các xe chưa đồng bộ hoặc bị lỗi, tối đa 300 xe mỗi lần. Nếu còn xe, thông báo sẽ ghi "bấm lại để đẩy tiếp". Dùng nút này để đẩy các xe đã đăng ký trước khi có tính năng.
- **↻** trên dòng bị lỗi hoặc chưa ghi: đẩy lại 1 xe.

API: `POST /api/v1/anpr/admin/vehicle-registrations/hgvision-sync` (hàng loạt) và `POST /api/v1/anpr/admin/vehicle-registrations/:id/hgvision-sync` (1 xe). Migration `20261119000001` thêm 3 cột `hgvision_sync_status`, `hgvision_synced_at`, `hgvision_sync_error` vào `vehicle_registrations`.

> Lưu ý: nút **Đồng bộ HGVision** đẩy mọi xe đang hoạt động trong DB của máy đó. Nếu DB máy trường còn xe demo (ghi chú `demo_seed`) thì xoá hoặc tạm dừng chúng trước khi bấm, nếu không HGVision sẽ nhận cả biển demo. Xem trước danh sách sẽ đẩy: `SELECT plate_number, note FROM vehicle_registrations WHERE deleted_at IS NULL AND status = 'active';`

### Test xe đăng ký trên máy trường

1. `git pull` nhánh `main` (BE + FE), chạy `npm run migration:run` ở BE, rồi khởi động lại BE.
2. `.env` có `HGVISION_WRITE_ENABLED=true` và client đã có scope `plates:write`.
3. Đăng nhập một tài khoản thường → "Phương tiện cá nhân" → "Đăng ký xe mới": biển `99A-999.97` (SAVP lưu `99A99997`, biển giả), loại "Xe máy". Dòng phải hiện "Đã đồng bộ HGVision".
4. Mở trang biển số của HGVision → có `99A99997`, loại Bình thường, chủ xe là họ tên và mã của tài khoản đó.
5. (Tuỳ chọn) Admin thêm `99A-999.97` vào "Danh sách biển số giám sát", loại "Danh sách đen" → HGVision đổi sang danh sách đen. Xoá dòng đó → HGVision về lại Bình thường.
6. Xoá xe `99A99997` trên "Phương tiện cá nhân" → HGVision không còn biển này.
7. Dọn dữ liệu test theo bảng bên dưới.

### Đối soát tự động SAVP ↔ HGVision

SAVP là nguồn gốc. BE tự so danh sách biển số với HGVision mỗi `HGVISION_RECONCILE_INTERVAL_MS` (mặc định 15 phút, lần đầu 1 phút sau khi BE khởi động; chỉ chạy khi `CAMERA_PROVIDER=hgvision`). Admin có thể bấm **Đối soát ngay** ở trang "Đăng ký phương tiện" (`POST /api/v1/anpr/admin/vehicle-registrations/hgvision-reconcile`, quyền `anpr.vehicle.admin_register`). Mỗi lúc chỉ chạy 1 lần đối soát.

| Tình huống | SAVP xử lý | Trạng thái hiện trên web |
| :--- | :--- | :--- |
| Biển SAVP đã đẩy bị xoá bên HGVision | Đẩy lại (cờ ghi bật) | "Đã đồng bộ HGVision", ghi chú "đã khôi phục lúc …" |
| Như trên nhưng cờ ghi tắt | Chỉ đánh dấu | "Bị xoá bên hệ thống nhận diện" |
| Biển bị sửa tay bên HGVision (đổi danh sách đen, chủ xe, ghi chú) | **Không ghi đè**, chỉ báo | "Lệch với hệ thống nhận diện" — bấm ↻ để ghi đè bằng dữ liệu SAVP |
| Xe đã xoá / tạm dừng trên SAVP mà HGVision còn biển (do SAVP tạo, ghi chú bắt đầu bằng `SAVP`) | Xoá biển thừa | — |
| Biển người khác tạo tay trên HGVision | Không đụng tới | — |
| Mất quá nhiều biển (> 20, hoặc ≥ 5 và > 50% số biển SAVP đã đẩy) | Không tự khôi phục (đề phòng HGVision bị reset), báo admin | "Bị xoá bên hệ thống nhận diện" — bấm "Đồng bộ HGVision" để đẩy lại hàng loạt |

Mỗi lần có khôi phục / xoá thừa / lệch mới, BE ghi audit log (`HGVISION_PLATE_RESTORED`, `HGVISION_PLATE_REMOVED_EXTRA`, `HGVISION_PLATE_MISMATCH`) và gửi 1 thông báo gộp cho tài khoản quản trị hệ thống. Biển lệch đã báo rồi thì lần sau không báo lại. Không cần migration.

### Test đối soát trên máy trường

1. `git pull` `main` (BE + FE), khởi động lại BE. `.env` có `HGVISION_WRITE_ENABLED=true`.
2. Đăng ký xe test `99A-999.97` như mục "Test xe đăng ký" → "Đã đồng bộ HGVision".
3. **Bị xoá:** xoá tay biển `99A99997` trên trang biển số HGVision → vào "Đăng ký phương tiện" bấm **Đối soát ngay** (hoặc chờ 15 phút) → toast "khôi phục 1 biển bị xoá", HGVision có lại biển.
4. **Lệch:** sửa tay biển đó trên HGVision sang danh sách đen → **Đối soát ngay** → dòng hiện "Lệch với hệ thống nhận diện", HGVision vẫn giữ danh sách đen. Bấm ↻ trên dòng → HGVision về Bình thường, dòng "Đã đồng bộ HGVision".
5. **Thừa:** tạm dừng/xoá xe `99A99997` khi cờ đang **tắt** (BE không xoá được bên HGVision), bật lại cờ, khởi động lại BE, bấm **Đối soát ngay** → HGVision không còn biển. (Bỏ qua nếu ngại đổi cờ.)
6. Dọn dữ liệu test theo bảng bên dưới (biển `99A99997`).

### Dữ liệu test phải xoá sau khi test

| Ở đâu | Dữ liệu | Cách xoá |
| :--- | :--- | :--- |
| HGVision (máy trường) | Biển `99A99999` và `99A99998` (biển thứ 2 thêm lúc test máy trường 2026-11-19) | Bước 7 của "Test 1 biển" (xoá trên SAVP khi cờ còn bật). Nếu sót: xoá tay trên trang biển số HGVision. |
| HGVision (máy trường) | Biển `99A99997` (test xe đăng ký) | Bước 6 của "Test xe đăng ký" (xoá xe trên SAVP khi cờ còn bật). Nếu sót: xoá tay trên trang biển số HGVision. |
| DB SAVP (máy trường) | Dòng `vehicle_control_list` biển `99A99999`, `99A99998`, `99A99997` và dòng `vehicle_registrations` biển `99A99997` (đều đã xoá mềm) | `scripts/hgvision/cleanup-plate-test.sql`: chạy SELECT xem trước, rồi bỏ comment 2 dòng DELETE |
| `.env` máy trường | `HGVISION_WRITE_ENABLED=true` | Giữ `true` nếu muốn xe đăng ký đẩy sang HGVision khi chạy thật. Chưa dùng thật thì đặt lại `false` rồi khởi động lại BE. |

Unit test (`hgvision-plate-sync.service.spec.ts`, `hgvision-plate-reconcile.service.spec.ts`, `vehicle-control-list.service.spec.ts`, `vehicle-registration.service.spec.ts`) chỉ dùng mock trong bộ nhớ, không tạo dữ liệu thật.

