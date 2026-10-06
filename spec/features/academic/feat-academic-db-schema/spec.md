# ACD-001 — Học vụ: DB Schema Đào tạo (nền tảng cho Điểm danh phòng học)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-10-05 | Tạo spec ACD-001 (task #22 trong `docs/CAM_AI_GAP_ANALYSIS_300_CAMERAS.md`). Chốt: "Lớp học" = **lớp học phần** (phương án A); thêm bảng **Buổi học** (`class_sessions`); sinh viên liên kết 1-1 `users` (`user_id` NOT NULL); seed **ca học cố định** bằng migration, dữ liệu demo bằng script riêng. | Toàn bộ |

> **SCHEMA-ONLY.** Chỉ tạo bảng + entity + module đăng ký entity + seed ca học + script demo.
> **KHÔNG** controller/service/DTO/permission. **KHÔNG** sửa bảng hiện có (`attendance_records`,
> `meetings`, `users`, `rooms`, ...). **KHÔNG** đụng luồng camera (`face-attendance.service.ts`).
> Điểm danh theo ca học là task #23 (spec riêng), dựa trên schema này.

---

## 1. Bối cảnh & mục tiêu

### 1.1. Yêu cầu nguồn — phân hệ 2.7 "Điểm danh phòng học"
(`HẦN MỀM QUẢN LÝ CAMERA AI THÔNG MINH.docx.md` §2.7)
1. Điểm danh tự động khi vào lớp.
2. Ghi nhận giờ đến và giờ rời lớp.
3. Xác định đi học đúng giờ hoặc đi muộn.
4. Đồng bộ dữ liệu với hệ thống quản lý đào tạo.
5. Hỗ trợ xuất bảng chuyên cần theo môn học và học kỳ.
Đối tượng: **sinh viên và giảng viên**.

### 1.2. Hiện trạng (RECON code thật)
- Không có bảng/entity nào về sinh viên, lớp, môn, học kỳ, ca học (`grep` toàn `src` = 0 kết quả).
- Điểm danh hiện tại chỉ cho họp: `attendance_records.meeting_id` NOT NULL
  ([attendance-record.entity.ts](../../../../src/modules/attendance/entities/attendance-record.entity.ts)).
- Luồng camera: face verify → `device_user_mappings` → `(user, meeting)` → `attendance_records`
  ([face-attendance.service.ts](../../../../src/modules/face-access/services/face-attendance.service.ts)).
- Khuôn mặt gắn với tài khoản: `face_profiles.user_id → users`.
- Camera → phòng qua system config `ivss.channel_room_map`; `rooms.room_type` đã có `training_room`.
- Phạm vi: `docs/SAVP_USE_CASE_TONG_HOP_2026-07-29.md` §C.2 từng CẮT "Điểm danh phòng học"; nay
  **mở lại** (gap analysis #22–#24). Cần cập nhật §C.2 (xem §8).

### 1.3. Mục tiêu
Tạo bộ bảng Học vụ đủ để:
- **G1** — Task #23 trả lời được: *"camera phòng P, lúc T, nhận ra user U → U là sinh viên/giảng viên của buổi học nào?"* bằng 1 truy vấn có index.
- **G2** — Báo cáo chuyên cần lọc/gộp được theo **môn học** và **học kỳ**.
- **G3** — Import/đồng bộ từ hệ thống đào tạo bằng **mã tự nhiên duy nhất** (upsert theo mã).
- **G4** — Không phá vỡ bất kỳ chức năng hiện có nào (ADD-ONLY).

### 1.4. Ngoài phạm vi (non-goals)
- Bảng ghi điểm danh lớp học, logic khớp sự kiện camera, ngưỡng đi muộn → **#23**.
- API CRUD/import Excel cho dữ liệu học vụ, permission, role `STUDENT`/`LECTURER` → task sau.
- Đồng bộ SIS/LMS thật (`external_id`, `source`) → **#24**, thêm bằng migration ADD-ONLY khi có API trường.
- Kiểm tra xung đột phòng giữa buổi học và `room_bookings` (họp) → #23/scheduling.
- Lớp hành chính dạng bảng riêng (hiện lưu text `students.administrative_class`).

---

## 2. Đối chiếu 2.7 ↔ schema

| # | Chức năng 2.7 | Đáp ứng bởi | Trong ACD-001? |
|:-:|---|---|:-:|
| 1 | Điểm danh tự động khi vào lớp | `class_sessions(room_id, start_time, end_time)` + `class_enrollments` + `students.user_id` | ✅ nền dữ liệu (logic ở #23) |
| 2 | Giờ đến / giờ rời | Bảng điểm danh lớp học | ⏭ #23 |
| 3 | Đúng giờ / đi muộn | `class_sessions.start_time` (snapshot từ ca học) | ✅ nền dữ liệu |
| 4 | Đồng bộ hệ thống đào tạo | Unique `semester_code`, `subject_code`, `student_code`, `(semester, subject, class_code)` | ✅ khoá upsert |
| 5 | Chuyên cần theo môn & học kỳ | `class_sections(subject_id, semester_id)` | ✅ |
| — | Chuyên cần giảng viên | `class_sections.lecturer_user_id` | ✅ nền dữ liệu |

---

## 3. Quyết định thiết kế (đã chốt với LamNH 2026-10-05)

| ID | Quyết định | Lý do |
|---|---|---|
| D1 | "Lớp học" = **lớp học phần** (môn × học kỳ × mã lớp), bảng `class_sections` | Điểm danh & báo cáo theo môn/học kỳ trực tiếp. Lớp hành chính chỉ là text (YAGNI). |
| D2 | **Thêm** bảng Buổi học `class_sessions` (ngoài 6 bảng ban đầu) | Thiếu nó không biết lớp học ở phòng nào, ngày nào → không điểm danh tự động được. Lưu từng buổi (không lưu lịch lặp tuần) để biểu diễn được nghỉ lễ, học bù, đổi phòng. |
| D3 | `students.user_id` **NOT NULL**, unique, FK `users` | Tái dùng nguyên `face_profiles`/`device_user_mappings`/thông báo — không sửa bảng cũ. Sinh viên phải có tài khoản trước (dùng import tài khoản sẵn có). |
| D4 | Ca học = **khung giờ cố định** (`study_shifts`, kiểu `time`), seed bằng migration | Dữ liệu tham chiếu cần ở mọi môi trường. |
| D5 | `class_sessions.start_time/end_time` là `timestamptz` **snapshot** (ngày + giờ ca, múi `Asia/Ho_Chi_Minh`), do tầng ứng dụng tính khi tạo buổi | #23 khớp sự kiện camera bằng 1 range query có index; đổi giờ ca sau này không làm sai lịch sử. |
| D6 | Danh sách lớp & buổi học dùng **status** (`dropped` / `cancelled`), không `deleted_at` | Giữ lịch sử chuyên cần; tiền lệ ADR-008. Không bao giờ hard-delete (DATA-01). |
| D7 | Danh mục (`semesters`, `subjects`, `study_shifts`, `students`, `class_sections`) dùng soft-delete `deleted_at` + **partial unique `WHERE deleted_at IS NULL`** | DATA-01 / ADR-004; mirror `CreateZonesTable`. |
| D8 | Giá trị enum lưu `varchar` + **CHECK constraint** ở DB, enum TS ở entity | Chặn dữ liệu bẩn khi import trực tiếp SQL/script (khác zones — zones không có CHECK, đã gây phải validate tay). |
| D9 | Module mới `src/modules/academic/` (schema-only), đăng ký trong `app.module` | ADR-002 (entity nằm trong module của nó). Mirror `ZonesModule` schema-only. |
| D10 | Dữ liệu demo (học kỳ, môn, SV, lớp, danh sách lớp, buổi học) bằng **script** `scripts/seed-academic-demo.ts`, KHÔNG migration | Không lẫn dữ liệu giả vào môi trường thật; chạy lại được (idempotent). |

---

## 4. Mô hình dữ liệu

Chi tiết cột/kiểu/ràng buộc/index: [data-model.md](./data-model.md).

```
departments ─┬─< subjects
             └─< students >── users (1-1)  ── face_profiles (có sẵn)
semesters ─────< class_sections >── subjects
users (giảng viên) ─< class_sections >── rooms (phòng mặc định, nullable)
class_sections ─< class_enrollments >── students        (Danh sách lớp)
class_sections ─< class_sessions >── study_shifts, rooms (Buổi học)
```

| Bảng | Tên nghiệp vụ | Vai trò |
|---|---|---|
| `semesters` | Học kỳ | Lọc/gộp báo cáo theo kỳ |
| `subjects` | Môn học | Lọc/gộp báo cáo theo môn |
| `study_shifts` | Ca học | Khung giờ cố định → giờ bắt đầu/kết thúc buổi |
| `students` | Sinh viên | Hồ sơ học vụ của 1 `users` |
| `class_sections` | Lớp học (lớp học phần) | Đơn vị điểm danh; có giảng viên |
| `class_enrollments` | Danh sách lớp | Ai phải có mặt |
| `class_sessions` | Buổi học | Cầu nối camera → phòng → thời điểm → lớp |

### 4.1. Truy vấn mục tiêu cho #23 (chứng minh G1 — không triển khai ở ACD-001)
```sql
-- camera ở phòng $room, sự kiện lúc $t, user $u
SELECT cs.id AS class_session_id, cs.class_section_id
FROM class_sessions cs
JOIN class_enrollments ce ON ce.class_section_id = cs.class_section_id AND ce.status = 'active'
JOIN students s ON s.id = ce.student_id AND s.deleted_at IS NULL
WHERE cs.room_id = $room
  AND cs.status <> 'cancelled'
  AND $t BETWEEN cs.start_time - interval '15 minutes' AND cs.end_time
  AND s.user_id = $u;
```
Dùng index `IDX_class_sessions_room_start` + `UQ_class_enrollments_section_student` + `UQ_students_user_active`.

---

## 5. Requirements (EARS)

**Schema**
- **R1** — THE system SHALL tạo 7 bảng `semesters`, `subjects`, `study_shifts`, `students`, `class_sections`, `class_enrollments`, `class_sessions` bằng migration viết tay, có `down()` đảo ngược đầy đủ.
- **R2** — THE migration SHALL chỉ CREATE/DROP các bảng, index, constraint của 7 bảng trên; KHÔNG ALTER bảng hiện có.
- **R3** — THE system SHALL từ chối mã trùng đang sống: `semester_code`, `subject_code`, `shift_code`, `student_code`, `students.user_id`, và bộ `(semester_id, subject_id, class_code)`; cho phép tái dùng mã sau soft-delete.
- **R4** — THE system SHALL từ chối `semesters.end_date < start_date`, `study_shifts.end_time <= start_time`, `class_sessions.end_time <= start_time`, `subjects.credits < 0`, `class_sections.max_students <= 0`.
- **R5** — THE system SHALL từ chối giá trị `status` ngoài tập cho phép của từng bảng (CHECK).
- **R6** — THE system SHALL từ chối một sinh viên xuất hiện 2 lần trong cùng lớp học phần.
- **R7** — THE system SHALL từ chối 2 buổi học của cùng lớp trùng `(session_date, shift_id)`.
- **R8** — WHILE buổi học chưa `cancelled`, THE system SHALL từ chối 2 buổi học cùng `(room_id, session_date, shift_id)`.
- **R9** — THE system SHALL KHÔNG cho xoá cứng bản ghi cha đang được tham chiếu (FK `RESTRICT`), trừ `department_id`, `default_room_id`, `lecturer_user_id` → `SET NULL`.

**Seed**
- **R10** — THE system SHALL seed 6 ca học cố định qua migration, idempotent (`ON CONFLICT DO NOTHING` / `WHERE NOT EXISTS`):

  | shift_code | Tên | Giờ |
  |---|---|---|
  | SLOT1 | Ca 1 | 07:30–09:50 |
  | SLOT2 | Ca 2 | 10:00–12:20 |
  | SLOT3 | Ca 3 | 12:50–15:10 |
  | SLOT4 | Ca 4 | 15:20–17:40 |
  | SLOT5 | Ca 5 | 18:00–20:20 |
  | SLOT6 | Ca 6 | 20:30–22:50 |

- **R11** — THE demo script SHALL tạo idempotent: 1 học kỳ (`FA26`), 3 môn, 10 sinh viên (kèm `users`), 1 giảng viên, 2 lớp học phần, danh sách lớp, và buổi học cho 2 tuần đầu kỳ; chạy lại không nhân đôi dữ liệu.
- **R12** — THE demo script SHALL tính `class_sessions.start_time/end_time` = `session_date + shift.start_time/end_time` theo múi `Asia/Ho_Chi_Minh`.

**Code**
- **R13** — THE system SHALL có 7 entity TypeORM trong `src/modules/academic/entities/`, map 1-1 với migration (tên cột, kiểu, nullable), đăng ký qua `AcademicModule` (`TypeOrmModule.forFeature` + `exports: [TypeOrmModule]`) và re-export ở `src/database/entities/index.ts`.
- **R14** — `AcademicModule` SHALL không có controller/provider (schema-only).

---

## 6. Constitution check

| Rule | Đánh giá |
|---|---|
| SEC-01 | Không secret. Script demo đọc DB config từ `.env`, mật khẩu demo user hash bằng `bcryptjs` như seed hiện có. |
| SEC-02/03, ARCH-03 | Không có endpoint mới → N/A. Script dùng query parameterized. |
| DATA-01 | Không hard-delete: soft-delete (D7) hoặc status (D6). `down()` của migration là DROP schema — chỉ dùng khi rollback dev. |
| ARCH-01 | Module `academic` chỉ tham chiếu bảng khác qua FK; #23 đọc qua module export. |
| ENG-01 | Không có business logic; kiểm chứng bằng test ràng buộc DB (§7). |
| ENG-02 | Mỗi entity/migration có comment ghi requirement (R*) theo kiểu EARS tag. |

---

## 7. Kiểm chứng (acceptance)

1. `npm run build` pass, `npm run lint` không lỗi mới.
2. Postgres local (docker-compose.dev): `migration:run` → `migration:revert` (×2: seed + schema) → `migration:run` — sạch, không lỗi.
3. Test ràng buộc (jest, chạy với DB local, skip nếu không có DB): mỗi R3–R9 có ít nhất 1 case vi phạm → bắt được mã lỗi Postgres `23505` (unique) / `23514` (check) / `23503` (FK); và 1 case hợp lệ insert được.
4. Test entity-metadata: khởi tạo DataSource với 7 entity → TypeORM build metadata không lỗi; tên cột entity khớp migration.
5. `npm run test` — toàn bộ test hiện có vẫn pass (không regression).
6. `tsx scripts/seed-academic-demo.ts` chạy 2 lần liên tiếp → số bản ghi không đổi ở lần 2; truy vấn §4.1 với dữ liệu demo trả đúng 1 buổi học.

---

## 8. Tài liệu cần cập nhật
- `docs/SAVP_USE_CASE_TONG_HOP_2026-07-29.md` §C.2: bỏ dòng "Điểm danh phòng học" khỏi danh sách cắt, ghi chú mở lại (#22–#24).
- `docs/CAM_AI_GAP_ANALYSIS_300_CAMERAS.md` #22: chuyển trạng thái khi merge.
- `docs/ARCHITECTURE_DECISIONS.md` ADR-004: thêm 5 bảng soft-delete mới vào danh sách áp dụng.

## 9. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Giờ ca thật của trường khác 6 ca đề xuất | Seed idempotent; sửa giờ bằng 1 migration UPDATE, buổi học cũ giữ snapshot (D5). |
| Sinh viên chưa có tài khoản khi import | D3 bắt buộc tạo `users` trước — dùng import tài khoản sẵn có; ghi nhận cho task import học vụ. |
| Phòng vừa có buổi học vừa có họp | Không chặn ở ACD-001 (khác bảng); xử lý ở #23/scheduling. |
| `uuid_generate_v4()` cần extension `uuid-ossp` | Đã dùng ở các migration hiện có → extension đã bật. |
