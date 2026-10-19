-- Đơn vị UEL theo danh sách người dùng cung cấp (2026-10-19). Mã: QL = quản lý, DT = đào tạo.
BEGIN;
INSERT INTO departments (department_code, department_name, description) VALUES
  ('QL', 'Đơn vị quản lý', 'Nhóm đơn vị'), ('DT', 'Đơn vị đào tạo', 'Nhóm đơn vị');
INSERT INTO departments (department_code, department_name, parent_department_id)
SELECT v.code, v.name, p.id FROM (VALUES
  ('QL01','Phòng Hành chính'),('QL02','Phòng Nhân sự'),('QL03','Phòng Bảo đảm chất lượng'),
  ('QL04','Phòng Tuyển sinh & Công tác sinh viên'),('QL05','Phòng Đào tạo'),('QL06','Phòng Khoa học và Công nghệ'),
  ('QL07','Phòng Hợp tác phát triển'),('QL08','Phòng Quản trị tài sản'),('QL09','Phòng Tài chính'),
  ('QL10','Phòng Công nghệ thông tin'),('QL11','Phòng Truyền thông'),('QL12','Phòng Pháp chế'),
  ('DT01','Khoa Kinh tế'),('DT02','Khoa Kinh tế đối ngoại'),('DT03','Khoa Tài chính – Ngân hàng'),
  ('DT04','Khoa Kế toán – Kiểm toán'),('DT05','Khoa Hệ thống thông tin'),('DT06','Khoa Quản trị Kinh doanh'),
  ('DT07','Khoa Luật'),('DT08','Khoa Luật Kinh tế'),('DT09','Khoa Toán Kinh tế'),('DT10','Viện Quốc tế UEL')
) v(code, name) JOIN departments p ON p.department_code = left(v.code, 2);
COMMIT;
