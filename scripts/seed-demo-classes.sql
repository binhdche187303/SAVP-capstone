-- SEED LỚP HỌC MẪU: ca học, học kỳ, môn, sinh viên, lớp học phần, ghi danh. Chạy lại được (NOT EXISTS / ON CONFLICT).
-- Chạy TRƯỚC scripts/seed-demo-all-flows.sql (phần F cần lớp + ghi danh + 3 ca học có id cố định bên dưới).
-- Giảng viên: teacher@meetingsys.vn. Sinh viên mới dùng chung mật khẩu với anh.pham@smartracking.edu.vn.
BEGIN;

-- Ca học (id trùng với seed-demo-all-flows.sql)
INSERT INTO study_shifts (id, shift_code, shift_name, shift_order, start_time, end_time)
SELECT v.id::uuid, v.code, v.name, v.ord, v.st::time, v.et::time
FROM (VALUES ('87d2ccd3-217e-4f37-9b4c-8a174691afc1','CA1','Ca 1 (sáng)',1,'07:00','09:30'),
             ('afce9e62-d1a2-4d18-8b75-dc4b861aeb25','CA2','Ca 2 (sáng)',2,'09:45','12:15'),
             ('5ca98cf9-509c-40e1-8f93-a6c49f49985e','CA3','Ca 3 (chiều)',3,'13:00','15:30')) v(id,code,name,ord,st,et)
WHERE NOT EXISTS (SELECT 1 FROM study_shifts s WHERE (s.id = v.id::uuid OR s.shift_code = v.code) AND s.deleted_at IS NULL);

-- Học kỳ
INSERT INTO semesters (semester_code, semester_name, academic_year, start_date, end_date, status)
SELECT 'HK1-2627', 'Học kỳ 1 năm học 2026–2027', '2026-2027', DATE '2026-08-24', DATE '2026-12-27', 'ongoing'
WHERE NOT EXISTS (SELECT 1 FROM semesters WHERE semester_code = 'HK1-2627' AND deleted_at IS NULL);

-- Môn học (Khoa Hệ thống thông tin)
INSERT INTO subjects (subject_code, subject_name, credits, department_id)
SELECT v.code, v.name, v.cr, (SELECT id FROM departments WHERE department_name = 'Khoa Hệ thống thông tin' LIMIT 1)
FROM (VALUES ('IS201','Cơ sở dữ liệu',3),
             ('IS305','Phân tích và thiết kế hệ thống thông tin',3),
             ('IS312','Hệ thống thông tin quản lý',3),
             ('IS420','Thương mại điện tử',3)) v(code,name,cr)
WHERE NOT EXISTS (SELECT 1 FROM subjects s WHERE s.subject_code = v.code AND s.deleted_at IS NULL);

-- Thêm 16 sinh viên (tài khoản + role STUDENT)
INSERT INTO users (username, email, password_hash, full_name, phone_number, account_status)
SELECT split_part(v.e, '@', 1), v.e, (SELECT password_hash FROM users WHERE email = 'anh.pham@smartracking.edu.vn'), v.n, v.p, 'active'
FROM (VALUES ('quynh.bui@smartracking.edu.vn','Bùi Ngọc Quỳnh','0903110001'),
             ('tuan.hoang@smartracking.edu.vn','Hoàng Minh Tuấn','0903110002'),
             ('linh.dang@smartracking.edu.vn','Đặng Thùy Linh','0903110003'),
             ('phuc.vu@smartracking.edu.vn','Vũ Hồng Phúc','0903110004'),
             ('trang.phan@smartracking.edu.vn','Phan Thu Trang','0903110005'),
             ('duc.truong@smartracking.edu.vn','Trương Anh Đức','0903110006'),
             ('ha.ly@smartracking.edu.vn','Lý Thanh Hà','0903110007'),
             ('bao.ngo@smartracking.edu.vn','Ngô Quốc Bảo','0903110008'),
             ('vy.huynh@smartracking.edu.vn','Huỳnh Tường Vy','0903110009'),
             ('long.dinh@smartracking.edu.vn','Đinh Hoàng Long','0903110010'),
             ('nhi.cao@smartracking.edu.vn','Cao Yến Nhi','0903110011'),
             ('kiet.lam@smartracking.edu.vn','Lâm Tuấn Kiệt','0903110012'),
             ('han.mai@smartracking.edu.vn','Mai Gia Hân','0903110013'),
             ('son.ta@smartracking.edu.vn','Tạ Thanh Sơn','0903110014'),
             ('my.luu@smartracking.edu.vn','Lưu Diễm My','0903110015'),
             ('quan.trinh@smartracking.edu.vn','Trịnh Minh Quân','0903110016')) v(e,n,p)
WHERE NOT EXISTS (SELECT 1 FROM users x WHERE lower(x.email) = v.e AND x.deleted_at IS NULL);

INSERT INTO user_roles (user_id, role_id, assigned_at, is_active)
SELECT u.id, r.id, NOW(), true
FROM users u JOIN roles r ON r.role_code = 'STUDENT'
WHERE u.email LIKE '%@smartracking.edu.vn' AND u.phone_number LIKE '090311%' AND u.deleted_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND x.role_id = r.id);

-- Hồ sơ sinh viên cho mọi tài khoản role STUDENT
INSERT INTO students (user_id, student_code, cohort, major, administrative_class, department_id)
SELECT s.id, 'K24' || lpad(s.rn::text, 4, '0'), 'K24', 'Hệ thống thông tin quản lý',
       CASE WHEN s.rn % 2 = 0 THEN 'K24406A' ELSE 'K24406B' END,
       (SELECT id FROM departments WHERE department_name = 'Khoa Hệ thống thông tin' LIMIT 1)
FROM (SELECT u.id, row_number() OVER (ORDER BY u.created_at, u.email) + 1000 AS rn
      FROM users u JOIN user_roles ur ON ur.user_id = u.id AND ur.is_active
      JOIN roles r ON r.id = ur.role_id AND r.role_code = 'STUDENT'
      WHERE u.deleted_at IS NULL) s
WHERE NOT EXISTS (SELECT 1 FROM students x WHERE x.user_id = s.id AND x.deleted_at IS NULL);

-- Lớp học phần (giảng viên teacher, mỗi lớp 1 phòng riêng)
INSERT INTO class_sections (class_code, semester_id, subject_id, lecturer_user_id, default_room_id, max_students, status)
SELECT v.cls, (SELECT id FROM semesters WHERE semester_code = 'HK1-2627' AND deleted_at IS NULL),
       sj.id, (SELECT id FROM users WHERE email = 'teacher@meetingsys.vn'),
       (SELECT id FROM rooms WHERE room_code = v.room), 40, 'open'
FROM (VALUES ('IS201_01','IS201','A102'), ('IS305_01','IS305','A103'),
             ('IS312_01','IS312','A107'), ('IS420_01','IS420','A114')) v(cls,subj,room)
JOIN subjects sj ON sj.subject_code = v.subj AND sj.deleted_at IS NULL
WHERE NOT EXISTS (SELECT 1 FROM class_sections c WHERE c.class_code = v.cls AND c.subject_id = sj.id AND c.deleted_at IS NULL);

-- Ghi danh: anh.pham học cả 4 lớp; sinh viên khác mỗi người 2–3 lớp (~15 SV/lớp)
INSERT INTO class_enrollments (class_section_id, student_id, status)
SELECT c.id, st.id, 'active'
FROM (SELECT cs.id, row_number() OVER (ORDER BY cs.class_code) AS cn
      FROM class_sections cs JOIN semesters se ON se.id = cs.semester_id AND se.semester_code = 'HK1-2627'
      WHERE cs.deleted_at IS NULL) c
JOIN (SELECT s.id, u.email, row_number() OVER (ORDER BY s.student_code) AS sn
      FROM students s JOIN users u ON u.id = s.user_id WHERE s.deleted_at IS NULL) st
  ON st.email = 'anh.pham@smartracking.edu.vn' OR (st.sn + c.cn) % 3 <> 0
ON CONFLICT (class_section_id, student_id) DO NOTHING;

COMMIT;
