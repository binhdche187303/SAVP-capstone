-- =====================================================================
-- seed-teacher-ui-test.sql  (2026-11-13)
-- Mock data for testing the TEACHER pages (pagination / layout) of
-- teacher@meetingsys.vn  (users.id d15dbb94-5d76-424b-8c6c-51efbe1debdf)
--
-- Every row is labelled so it can be removed safely:
--   subjects          subject_code 'UIT%'  + subject_name '[UI-TEST] %'
--   class_sections    class_code   'UIT-%'
--   students          student_code 'UIT26%'
--   users             username 'uitest.sv%' + email '%@uitest.local'
--   attendance rows   source = 'ui_test'
--
-- Re-runnable: the CLEANUP block runs first.
-- Cleanup only:  bash /tmp/q.sh -f - < scripts/cleanup-teacher-ui-test.sql
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

-- ---------------------------------------------------------------- CLEANUP
CREATE TEMP TABLE _uit_cls ON COMMIT DROP AS
  SELECT id FROM class_sections WHERE class_code LIKE 'UIT-%';
CREATE TEMP TABLE _uit_sv ON COMMIT DROP AS
  SELECT id, user_id FROM students WHERE student_code LIKE 'UIT26%';
DELETE FROM class_attendance_events
 WHERE class_section_id IN (SELECT id FROM _uit_cls) OR student_id IN (SELECT id FROM _uit_sv);
DELETE FROM class_attendance_records
 WHERE class_section_id IN (SELECT id FROM _uit_cls) OR student_id IN (SELECT id FROM _uit_sv);
DELETE FROM class_sessions    WHERE class_section_id IN (SELECT id FROM _uit_cls);
DELETE FROM class_enrollments
 WHERE class_section_id IN (SELECT id FROM _uit_cls) OR student_id IN (SELECT id FROM _uit_sv);
DELETE FROM class_sections    WHERE id IN (SELECT id FROM _uit_cls);
DELETE FROM students          WHERE id IN (SELECT id FROM _uit_sv);
DELETE FROM users WHERE username LIKE 'uitest.sv%' AND email LIKE '%@uitest.local';
DELETE FROM subjects WHERE subject_code LIKE 'UIT%' AND subject_name LIKE '[UI-TEST]%';
DROP TABLE _uit_cls; DROP TABLE _uit_sv;

-- ---------------------------------------------------------------- PARAMS
CREATE TEMP TABLE _p ON COMMIT DROP AS SELECT
  'd15dbb94-5d76-424b-8c6c-51efbe1debdf'::uuid AS teacher_id,
  'a86fecb8-e2fd-4602-aacd-0ddbc3842965'::uuid AS dept_id,
  'f413ecfe-038e-432f-a2eb-09c7c504296c'::uuid AS semester_id,
  DATE '2026-09-07' AS week0,            -- Monday, first teaching week
  DATE '2026-11-13' AS today;

-- ---------------------------------------------------------------- SUBJECTS (30)
INSERT INTO subjects (subject_code, subject_name, credits, department_id, description, source)
SELECT 'UIT' || lpad(i::text, 3, '0'), '[UI-TEST] ' || name, 3, (SELECT dept_id FROM _p),
       'Dữ liệu test giao diện giảng viên - sẽ xóa', 'manual'
FROM (VALUES
 (1,'Phân tích thiết kế hệ thống'),(2,'Cơ sở dữ liệu nâng cao'),(3,'Lập trình Web'),
 (4,'Hệ thống thông tin quản lý'),(5,'Thương mại điện tử'),(6,'Khai phá dữ liệu'),
 (7,'Trí tuệ nhân tạo ứng dụng'),(8,'An toàn thông tin'),(9,'Mạng máy tính'),
 (10,'Quản trị dự án CNTT'),(11,'Phân tích dữ liệu kinh doanh'),(12,'Kho dữ liệu'),
 (13,'Hệ hoạch định nguồn lực doanh nghiệp'),(14,'Lập trình di động'),(15,'Điện toán đám mây'),
 (16,'Học máy'),(17,'Kiểm thử phần mềm'),(18,'Kiến trúc doanh nghiệp'),
 (19,'Chuyển đổi số'),(20,'Trực quan hóa dữ liệu'),(21,'Blockchain căn bản'),
 (22,'Hệ thống hỗ trợ ra quyết định'),(23,'Quản trị quan hệ khách hàng'),(24,'Phát triển ứng dụng doanh nghiệp'),
 (25,'Dữ liệu lớn'),(26,'Tương tác người - máy'),(27,'Thiết kế trải nghiệm người dùng'),
 (28,'Kinh tế số'),(29,'Phân tích chuỗi cung ứng'),(30,'Đề án hệ thống thông tin')
) v(i, name);

-- ---------------------------------------------------------------- CLASSES (30)
-- slot k = (i-1)%18 -> weekday 2..7 x shift CA1..CA3 (18 distinct slots)
-- classes  1-12 : weeks 0-7  (first half, already finished -> status closed)
-- classes 13-18 : weeks 0-15 (full semester)
-- classes 19-30 : weeks 8-15 (second half, same slots as 1-12, no overlap)
CREATE TEMP TABLE _cls ON COMMIT DROP AS
SELECT i,
       2 + ((i - 1) % 18) % 6                                    AS wd,      -- Thứ 2..7
       ((i - 1) % 18) / 6                                        AS shift_ix, -- 0..2
       CASE WHEN i <= 12 THEN 0 WHEN i <= 18 THEN 0 ELSE 8 END   AS wk_from,
       CASE WHEN i <= 12 THEN 7 ELSE 15 END                      AS wk_to,
       CASE WHEN i = 13 THEN 160                                  -- big class -> pagination
            ELSE 25 + (i * 7) % 41 END                           AS n_students,
       r.id AS room_id, r.room_name
FROM generate_series(1, 30) i
JOIN LATERAL (
  SELECT id, room_name FROM rooms WHERE deleted_at IS NULL
  ORDER BY room_name OFFSET (i * 3) % 60 LIMIT 1
) r ON true;

CREATE TEMP TABLE _shift ON COMMIT DROP AS
SELECT * FROM (VALUES
 (0, '87d2ccd3-217e-4f37-9b4c-8a174691afc1'::uuid, 'Ca 1', TIME '07:00', TIME '09:30', 1),
 (1, 'afce9e62-d1a2-4d18-8b75-dc4b861aeb25'::uuid, 'Ca 2', TIME '09:45', TIME '12:15', 4),
 (2, '5ca98cf9-509c-40e1-8f93-a6c49f49985e'::uuid, 'Ca 3', TIME '13:00', TIME '15:30', 7)
) s(ix, shift_id, label, t_start, t_end, period_start);

INSERT INTO class_sections (class_code, semester_id, subject_id, lecturer_user_id, default_room_id,
                            max_students, status, note, source)
SELECT 'UIT-' || lpad(c.i::text, 3, '0') || '_01',
       (SELECT semester_id FROM _p),
       sj.id,
       (SELECT teacher_id FROM _p),
       c.room_id,
       GREATEST(c.n_students + 10, 60),
       CASE WHEN c.i <= 12 THEN 'closed' ELSE 'open' END,
       'Thứ ' || c.wd || ' (' || s.label || ') | ' || c.room_name,
       'manual'
FROM _cls c
JOIN _shift s ON s.ix = c.shift_ix
JOIN subjects sj ON sj.subject_code = 'UIT' || lpad(c.i::text, 3, '0') AND sj.deleted_at IS NULL;

-- ---------------------------------------------------------------- STUDENTS (320)
CREATE TEMP TABLE _sv ON COMMIT DROP AS
SELECT n,
       (ARRAY['Nguyễn','Trần','Lê','Phạm','Hoàng','Huỳnh','Phan','Vũ','Võ','Đặng','Bùi','Đỗ','Hồ','Ngô','Dương','Lý'])[1 + (n * 7) % 16]
       || ' ' ||
       (ARRAY['Văn','Thị','Minh','Thanh','Ngọc','Hoài','Gia','Quốc','Thu','Đức','Bảo','Khánh','Phương','Anh'])[1 + (n * 11) % 14]
       || ' ' ||
       (ARRAY['An','Bình','Châu','Dũng','Giang','Hà','Hải','Hạnh','Hiếu','Hòa','Hùng','Huy','Khoa','Lan','Linh','Long',
              'Mai','My','Nam','Nga','Nhi','Phúc','Quân','Quỳnh','Sơn','Tâm','Thảo','Trang','Trí','Tú','Vy','Yến'])[1 + (n * 13) % 32]
         AS full_name
FROM generate_series(1, 320) n;

INSERT INTO users (username, email, full_name, source)
SELECT 'uitest.sv' || lpad(n::text, 3, '0'), 'uitest.sv' || lpad(n::text, 3, '0') || '@uitest.local', full_name, 'manual'
FROM _sv;

INSERT INTO students (user_id, student_code, cohort, major, administrative_class, department_id, study_status, source)
SELECT u.id, 'UIT26' || lpad(v.n::text, 3, '0'), 'K50',
       (ARRAY['Hệ thống thông tin quản lý','Thương mại điện tử','Kinh doanh số','Khoa học dữ liệu'])[1 + v.n % 4],
       'UIT-K50' || chr(65 + v.n % 6),
       (SELECT dept_id FROM _p),
       CASE WHEN v.n % 53 = 0 THEN 'suspended' ELSE 'studying' END,
       'manual'
FROM _sv v
JOIN users u ON u.username = 'uitest.sv' || lpad(v.n::text, 3, '0') AND u.deleted_at IS NULL;

-- ---------------------------------------------------------------- ENROLLMENTS
-- class i takes a contiguous window of students starting at (i*37)%320
INSERT INTO class_enrollments (class_section_id, student_id, status, note, source)
SELECT cs.id, st.id,
       CASE WHEN k % 29 = 28 THEN 'dropped' ELSE 'active' END,
       '[UI-TEST]', 'manual'
FROM _cls c
JOIN class_sections cs ON cs.class_code = 'UIT-' || lpad(c.i::text, 3, '0') || '_01' AND cs.deleted_at IS NULL
CROSS JOIN LATERAL generate_series(0, c.n_students - 1) k
JOIN students st ON st.student_code = 'UIT26' || lpad((1 + (c.i * 37 + k) % 320)::text, 3, '0')
                AND st.deleted_at IS NULL;

-- ---------------------------------------------------------------- SESSIONS
INSERT INTO class_sessions (class_section_id, session_no, session_date, shift_id, room_id,
                            start_time, end_time, status, note, period_start, period_count, source)
SELECT cs.id,
       (w - c.wk_from + 1)::smallint,
       d,
       s.shift_id,
       NULL,                                                    -- avoid room/shift unique clash
       (d + s.t_start) AT TIME ZONE 'Asia/Ho_Chi_Minh',
       (d + s.t_end)   AT TIME ZONE 'Asia/Ho_Chi_Minh',
       CASE WHEN d < (SELECT today FROM _p) THEN 'completed'
            WHEN (c.i + w) % 23 = 0 THEN 'cancelled'
            ELSE 'scheduled' END,
       '[UI-TEST]',
       s.period_start, 3, 'manual'
FROM _cls c
JOIN _shift s ON s.ix = c.shift_ix
JOIN class_sections cs ON cs.class_code = 'UIT-' || lpad(c.i::text, 3, '0') || '_01' AND cs.deleted_at IS NULL
CROSS JOIN LATERAL generate_series(c.wk_from, c.wk_to) w
CROSS JOIN LATERAL (SELECT (SELECT week0 FROM _p) + (w * 7 + c.wd - 2) AS d) dd;

-- ---------------------------------------------------------------- ATTENDANCE RECORDS
-- one row per completed session x active student.
-- r in 0..99 : <70 on_time, <82 late, <87 left, else absent
-- "weak" students (student n % 17 = 0) : ~45% absent -> warning lists
WITH base AS (
  SELECT se.class_section_id, ce.student_id, se.session_date, se.start_time, se.end_time,
         abs(hashtext(ce.student_id::text || se.session_date::text)) % 100 AS r,
         abs(hashtext(se.session_date::text || ce.student_id::text)) % 100 AS r2,
         (substr(st.student_code, 6)::int % 17 = 0) AS weak
  FROM class_sessions se
  JOIN class_sections cs ON cs.id = se.class_section_id AND cs.class_code LIKE 'UIT-%'
  JOIN class_enrollments ce ON ce.class_section_id = se.class_section_id AND ce.status = 'active'
  JOIN students st ON st.id = ce.student_id AND st.student_code LIKE 'UIT26%'
  WHERE se.status = 'completed'
), st AS (
  SELECT *,
         CASE WHEN weak AND r < 45 THEN 'absent'
              WHEN r < 70 THEN 'on_time'
              WHEN r < 82 THEN 'late'
              WHEN r < 87 THEN 'left'
              ELSE 'absent' END AS status
  FROM base
)
INSERT INTO class_attendance_records (class_section_id, student_id, attendance_date, check_in_at, check_out_at,
                                      status, confidence, source, manual_reason)
SELECT class_section_id, student_id, session_date,
       CASE status
         WHEN 'absent'  THEN NULL
         WHEN 'late'    THEN start_time + make_interval(mins => 10 + r2 % 25)
         ELSE                start_time + make_interval(mins => (r2 % 15) - 10) END,
       CASE status
         WHEN 'absent'  THEN NULL
         WHEN 'left'    THEN start_time + make_interval(mins => 40 + r2 % 50)
         ELSE                end_time   - make_interval(mins => r2 % 6) END,
       status,
       CASE WHEN status = 'absent' THEN NULL ELSE 80 + r2 % 20 END,
       'ui_test',
       CASE WHEN status = 'absent' AND r2 % 9 = 0 THEN '[UI-TEST] Có đơn xin phép' END
FROM st;

COMMIT;
