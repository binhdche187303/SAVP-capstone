# Data Model — ACD-001 Học vụ: DB Schema Đào tạo

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-10-05 | Tạo data-model: 7 bảng mới, không sửa bảng cũ | Toàn bộ |

## Quy ước chung (mirror `20260721000001-CreateZonesTable.ts`)
- PK: `"id" uuid NOT NULL DEFAULT uuid_generate_v4()`, constraint `PK_<table>_id`.
- `created_at`, `updated_at`: `timestamptz NOT NULL DEFAULT now()`.
- Soft-delete: `deleted_at timestamptz NULL` (bảng danh mục), unique dạng partial `WHERE deleted_at IS NULL`.
- Enum: `varchar` + CHECK `CK_<table>_<col>`; enum TS tương ứng trong entity.
- Đặt tên: `UQ_<table>_<cols>_active` (partial unique), `IDX_<table>_<cols>`, `FK_<table>_<col>`, `CK_<table>_<rule>`.
- FK mặc định `ON DELETE RESTRICT` (cha dùng soft-delete nên không bao giờ xoá cứng); ngoại lệ ghi rõ.

**Thứ tự tạo:** semesters → subjects → study_shifts → students → class_sections → class_enrollments → class_sessions. `down()` theo thứ tự ngược.

---

## 1. `semesters` — Học kỳ
| Cột | Kiểu | Null | Default | Ghi chú |
|---|---|:-:|---|---|
| id | uuid | N | uuid_generate_v4() | PK |
| semester_code | varchar(30) | N | | VD `FA26`. Khoá đồng bộ |
| semester_name | varchar(150) | N | | VD `Fall 2026` |
| academic_year | varchar(20) | Y | | VD `2026-2027` |
| start_date | date | N | | |
| end_date | date | N | | |
| status | varchar(20) | N | `'upcoming'` | `upcoming` \| `ongoing` \| `closed` |
| created_at / updated_at | timestamptz | N | now() | |
| deleted_at | timestamptz | Y | | soft-delete |

- `UQ_semesters_code_active` UNIQUE (semester_code) WHERE deleted_at IS NULL
- `CK_semesters_dates` CHECK (end_date >= start_date)
- `CK_semesters_status` CHECK (status IN (...))
- `IDX_semesters_dates` (start_date, end_date) WHERE deleted_at IS NULL — tìm kỳ hiện hành

## 2. `subjects` — Môn học
| Cột | Kiểu | Null | Default | Ghi chú |
|---|---|:-:|---|---|
| id | uuid | N | | PK |
| subject_code | varchar(30) | N | | VD `PRN211`. Khoá đồng bộ |
| subject_name | varchar(255) | N | | |
| credits | smallint | Y | | ≥ 0 |
| department_id | uuid | Y | | FK `departments(id)` **ON DELETE SET NULL** — khoa/bộ môn phụ trách |
| description | text | Y | | |
| is_active | boolean | N | true | ngừng giảng dạy |
| created_at / updated_at / deleted_at | | | | |

- `UQ_subjects_code_active` UNIQUE (subject_code) WHERE deleted_at IS NULL
- `CK_subjects_credits` CHECK (credits IS NULL OR credits >= 0)
- `IDX_subjects_department` (department_id)

## 3. `study_shifts` — Ca học (khung giờ cố định)
| Cột | Kiểu | Null | Default | Ghi chú |
|---|---|:-:|---|---|
| id | uuid | N | | PK |
| shift_code | varchar(20) | N | | `SLOT1`..`SLOT6` |
| shift_name | varchar(100) | N | | `Ca 1` |
| shift_order | smallint | N | | thứ tự hiển thị |
| start_time | time | N | | giờ địa phương (VN) |
| end_time | time | N | | |
| is_active | boolean | N | true | |
| created_at / updated_at / deleted_at | | | | |

- `UQ_study_shifts_code_active` UNIQUE (shift_code) WHERE deleted_at IS NULL
- `UQ_study_shifts_order_active` UNIQUE (shift_order) WHERE deleted_at IS NULL
- `CK_study_shifts_time` CHECK (end_time > start_time)

## 4. `students` — Sinh viên
| Cột | Kiểu | Null | Default | Ghi chú |
|---|---|:-:|---|---|
| id | uuid | N | | PK |
| user_id | uuid | N | | FK `users(id)` RESTRICT. 1-1 → dùng `face_profiles` có sẵn |
| student_code | varchar(30) | N | | VD `HE180768`. Khoá đồng bộ |
| cohort | varchar(20) | Y | | Khoá, VD `K18` |
| major | varchar(150) | Y | | Ngành |
| administrative_class | varchar(50) | Y | | Lớp sinh hoạt (text, YAGNI) |
| department_id | uuid | Y | | FK `departments(id)` **SET NULL** — khoa quản lý |
| study_status | varchar(20) | N | `'studying'` | `studying` \| `suspended` \| `graduated` \| `dropped_out` |
| created_at / updated_at / deleted_at | | | | |

- `UQ_students_code_active` UNIQUE (student_code) WHERE deleted_at IS NULL
- `UQ_students_user_active` UNIQUE (user_id) WHERE deleted_at IS NULL — tra từ user nhận diện được
- `CK_students_study_status` CHECK (...)
- `IDX_students_department` (department_id)

## 5. `class_sections` — Lớp học (lớp học phần)
| Cột | Kiểu | Null | Default | Ghi chú |
|---|---|:-:|---|---|
| id | uuid | N | | PK |
| class_code | varchar(50) | N | | VD `SE1801` |
| semester_id | uuid | N | | FK `semesters(id)` RESTRICT |
| subject_id | uuid | N | | FK `subjects(id)` RESTRICT |
| lecturer_user_id | uuid | Y | | FK `users(id)` **SET NULL** — giảng viên chính |
| default_room_id | uuid | Y | | FK `rooms(id)` **SET NULL** — gợi ý khi tạo buổi học |
| max_students | integer | Y | | > 0 |
| status | varchar(20) | N | `'planned'` | `planned` \| `open` \| `closed` \| `cancelled` |
| note | text | Y | | |
| created_at / updated_at / deleted_at | | | | |

- `UQ_class_sections_sem_subj_code_active` UNIQUE (semester_id, subject_id, class_code) WHERE deleted_at IS NULL — khoá đồng bộ
- `CK_class_sections_max_students` CHECK (max_students IS NULL OR max_students > 0)
- `CK_class_sections_status` CHECK (...)
- `IDX_class_sections_subject_semester` (subject_id, semester_id) — báo cáo theo môn/kỳ (G2)
- `IDX_class_sections_lecturer` (lecturer_user_id) — chuyên cần giảng viên

## 6. `class_enrollments` — Danh sách lớp
| Cột | Kiểu | Null | Default | Ghi chú |
|---|---|:-:|---|---|
| id | uuid | N | | PK |
| class_section_id | uuid | N | | FK `class_sections(id)` RESTRICT |
| student_id | uuid | N | | FK `students(id)` RESTRICT |
| enrolled_at | timestamptz | N | now() | |
| status | varchar(20) | N | `'active'` | `active` \| `dropped` (không xoá — D6) |
| note | text | Y | | |
| created_at / updated_at | | | | (không `deleted_at`) |

- `UQ_class_enrollments_section_student` UNIQUE (class_section_id, student_id) — R6
- `CK_class_enrollments_status` CHECK (...)
- `IDX_class_enrollments_student` (student_id) — lịch học/chuyên cần của 1 SV

## 7. `class_sessions` — Buổi học
| Cột | Kiểu | Null | Default | Ghi chú |
|---|---|:-:|---|---|
| id | uuid | N | | PK |
| class_section_id | uuid | N | | FK `class_sections(id)` RESTRICT |
| session_no | smallint | Y | | Buổi thứ n (hiển thị) |
| session_date | date | N | | |
| shift_id | uuid | N | | FK `study_shifts(id)` RESTRICT |
| room_id | uuid | N | | FK `rooms(id)` RESTRICT — bắt buộc để camera map được |
| start_time | timestamptz | N | | snapshot `session_date + shift.start_time` (VN) — D5 |
| end_time | timestamptz | N | | snapshot |
| status | varchar(20) | N | `'scheduled'` | `scheduled` \| `ongoing` \| `completed` \| `cancelled` (không xoá — D6) |
| note | text | Y | | lý do huỷ/học bù |
| created_at / updated_at | | | | |

- `UQ_class_sessions_section_date_shift` UNIQUE (class_section_id, session_date, shift_id) — R7
- `UQ_class_sessions_room_date_shift_active` UNIQUE (room_id, session_date, shift_id) WHERE status <> 'cancelled' — R8
- `CK_class_sessions_time` CHECK (end_time > start_time)
- `CK_class_sessions_status` CHECK (...)
- `IDX_class_sessions_room_start` (room_id, start_time) — khớp sự kiện camera (#23, G1)
- `IDX_class_sessions_section_date` (class_section_id, session_date) — chuyên cần theo lớp

---

## Entity mapping (`src/modules/academic/entities/`)
| File | Class | Enum TS |
|---|---|---|
| semester.entity.ts | `SemesterEntity` | `SemesterStatus` |
| subject.entity.ts | `SubjectEntity` | — |
| study-shift.entity.ts | `StudyShiftEntity` | — |
| student.entity.ts | `StudentEntity` | `StudentStudyStatus` |
| class-section.entity.ts | `ClassSectionEntity` | `ClassSectionStatus` |
| class-enrollment.entity.ts | `ClassEnrollmentEntity` | `ClassEnrollmentStatus` |
| class-session.entity.ts | `ClassSessionEntity` | `ClassSessionStatus` |

- camelCase property ↔ snake_case `name:` (như các entity hiện có), `@DeleteDateColumn` cho bảng soft-delete.
- `@ManyToOne` + `@JoinColumn` cho mọi FK; **không** khai `@OneToMany` ngược ở `UserEntity`/`RoomEntity`/`DepartmentEntity` (không sửa entity cũ — R2).
- `time` map sang `string` (`'07:30:00'`); `date` map sang `string` (`'2026-09-07'`) — tránh lệch múi giờ khi TypeORM chuyển sang `Date`.

## Bảng hiện có bị ảnh hưởng
Không có. Chỉ thêm FK **từ** bảng mới **tới** `users`, `departments`, `rooms`.
