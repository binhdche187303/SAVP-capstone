-- Lịch tuần UEL: Ban Giám hiệu, trưởng phòng Hành chính, văn thư các đơn vị.
-- Chạy lại được nhiều lần. Mật khẩu tài khoản mới = mật khẩu của manager.it.
BEGIN;

INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id, position_title,
                   employment_status, account_status, must_change_password, leadership_title)
SELECT v.code, v.username, v.email, (SELECT password_hash FROM users WHERE email = 'manager.it@meetingsys.vn'),
       v.full_name, (SELECT id FROM departments WHERE department_code = v.dept), v.title,
       'active', 'active', false, v.lead
  FROM (VALUES
    ('BGH001', 'hieutruong', 'hieutruong@meetingsys.vn', 'Nguyễn Văn Phúc', NULL, 'Hiệu trưởng', 'HIEU_TRUONG'),
    ('BGH002', 'phohieutruong.dt', 'phohieutruong.dt@meetingsys.vn', 'Lê Thị Minh Châu', NULL, 'Phó Hiệu trưởng phụ trách đào tạo', 'PHO_HIEU_TRUONG'),
    ('BGH003', 'phohieutruong.cs', 'phohieutruong.cs@meetingsys.vn', 'Trần Quang Vinh', NULL, 'Phó Hiệu trưởng phụ trách cơ sở vật chất', 'PHO_HIEU_TRUONG'),
    ('HC001', 'manager.hc', 'manager.hc@meetingsys.vn', 'Trần Thị Thanh Hà', 'QL01', 'Trưởng phòng Hành chính', NULL)
  ) AS v(code, username, email, full_name, dept, title, lead)
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = v.email);

INSERT INTO user_roles (user_id, role_id, assigned_at, is_active)
SELECT u.id, r.id, NOW(), true
  FROM users u JOIN roles r ON r.role_code = 'MANAGER'
 WHERE u.email IN ('hieutruong@meetingsys.vn', 'phohieutruong.dt@meetingsys.vn', 'phohieutruong.cs@meetingsys.vn', 'manager.hc@meetingsys.vn')
   AND NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = u.id AND x.role_id = r.id);

UPDATE users SET is_unit_clerk = true, position_title = 'Văn thư Phòng Hành chính' WHERE email = 'emp.admin1@meetingsys.vn';
UPDATE users SET is_unit_clerk = true, position_title = 'Văn thư Phòng Nhân sự' WHERE email = 'emp.hr1@meetingsys.vn';
UPDATE users SET is_unit_clerk = true, position_title = 'Văn thư Phòng Công nghệ thông tin' WHERE email = 'emp.it2@meetingsys.vn';
UPDATE users SET is_unit_clerk = true, position_title = 'Văn thư Phòng Tuyển sinh & CTSV' WHERE email = 'emp.sales1@meetingsys.vn';

-- Trưởng P.HC phải là manager_user_id của phòng, nếu không báo cáo chuyên cần trả 403
UPDATE departments d SET manager_user_id = u.id
  FROM users u WHERE u.email = 'manager.hc@meetingsys.vn' AND d.id = u.department_id AND d.manager_user_id IS NULL;

COMMIT;

SELECT email, full_name, position_title, is_unit_clerk, leadership_title
  FROM users WHERE is_unit_clerk OR leadership_title IS NOT NULL OR email = 'manager.hc@meetingsys.vn' ORDER BY email;
