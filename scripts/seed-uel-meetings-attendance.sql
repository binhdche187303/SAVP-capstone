-- Dữ liệu cuộc họp theo Lịch tuần UEL (tuần 12–23/10/2026): có cả cuộc họp BẬT và TẮT điểm danh.
-- Chạy lại được: xoá các cuộc họp mã "MT-UEL-%" trước khi chèn.
BEGIN;

DELETE FROM attendance_records WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code LIKE 'MT-UEL-%');
DELETE FROM meeting_participants WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code LIKE 'MT-UEL-%');
DELETE FROM room_bookings WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code LIKE 'MT-UEL-%');
DELETE FROM meeting_requests WHERE meeting_id IN (SELECT id FROM meetings WHERE meeting_code LIKE 'MT-UEL-%');
DELETE FROM meetings WHERE meeting_code LIKE 'MT-UEL-%';

CREATE TEMP TABLE plan (code text, title text, descr text, organizer text, room text,
                        st timestamptz, en timestamptz, status text, att boolean, members text[])
  ON COMMIT DROP;
INSERT INTO plan VALUES
 ('MT-UEL-001', 'Họp tổ số hóa văn bằng chứng chỉ',
  'Rà soát tiến độ số hóa văn bằng, chứng chỉ giai đoạn 2; thống nhất quy trình cập nhật Quyết định 2 về số hóa.',
  'manager.it@meetingsys.vn', 'A114', '2026-10-12 08:00+07', '2026-10-12 11:00+07', 'completed', true,
  ARRAY['emp.it1@meetingsys.vn','emp.it2@meetingsys.vn','bizadmin.it@meetingsys.vn','emp.admin1@meetingsys.vn','teacher@meetingsys.vn']),
 ('MT-UEL-002', 'Hội nghị tổng kết hoạt động truyền thông, tư vấn tuyển sinh năm 2026 và phương hướng năm 2027',
  'Báo cáo kết quả tuyển sinh 2026, đánh giá hiệu quả các kênh truyền thông, đề xuất kế hoạch 2027.',
  'manager.sales@meetingsys.vn', 'HTA', '2026-10-12 08:00+07', '2026-10-12 11:00+07', 'completed', true,
  ARRAY['emp.sales1@meetingsys.vn','emp.sales2@meetingsys.vn','manager.hr@meetingsys.vn','manager.it@meetingsys.vn','emp.hr1@meetingsys.vn','teacher@meetingsys.vn']),
 ('MT-UEL-003', 'Rà soát hồ sơ đảng viên chuẩn bị thực hiện số hóa dữ liệu',
  'Thành viên Tổ chuyển đổi số và cấp ủy viên được phân công rà soát hồ sơ trước khi số hóa.',
  'manager.hr@meetingsys.vn', 'A204BIS', '2026-10-13 08:00+07', '2026-10-13 11:30+07', 'completed', false,
  ARRAY['emp.hr1@meetingsys.vn','emp.hr2@meetingsys.vn','bizadmin.hr@meetingsys.vn']),
 ('MT-UEL-004', 'Phương án sử dụng mượn trả đồ cho thư viện A3',
  'Lãnh đạo P.CNTT, Lãnh đạo Thư viện và nhà thầu trao đổi phương án tủ mượn trả tự động tại tòa A3.',
  'manager.it@meetingsys.vn', 'A107', '2026-10-13 09:00+07', '2026-10-13 10:30+07', 'completed', false,
  ARRAY['emp.it1@meetingsys.vn','emp.facility1@meetingsys.vn']),
 ('MT-UEL-005', 'Họp Phòng Nhân sự – Thảo luận KPI năm 2027',
  'Thống nhất bộ chỉ số KPI 2027 cho viên chức, người lao động khối hành chính.',
  'manager.hr@meetingsys.vn', 'A103', '2026-10-15 08:30+07', '2026-10-15 10:30+07', 'completed', true,
  ARRAY['emp.hr1@meetingsys.vn','emp.hr2@meetingsys.vn','bizadmin.hr@meetingsys.vn','emp.admin1@meetingsys.vn']),
 ('MT-UEL-006', 'Giao ban Phòng Công nghệ thông tin tuần 43',
  'Báo cáo công việc tuần 42, phân công nhiệm vụ tuần 43.',
  'manager.it@meetingsys.vn', 'A102', '2026-10-19 14:00+07', '2026-10-19 15:30+07', 'scheduled', true,
  ARRAY['emp.it1@meetingsys.vn','emp.it2@meetingsys.vn','bizadmin.it@meetingsys.vn']),
 ('MT-UEL-007', 'Triển khai camera AI điểm danh tại các phòng họp tòa A1',
  'Đơn vị thi công trình bày phương án lắp đặt; P.CNTT và P.Quản trị tài sản thống nhất lịch triển khai.',
  'manager.it@meetingsys.vn', 'A114', '2026-10-21 09:00+07', '2026-10-21 11:00+07', 'scheduled', true,
  ARRAY['emp.it1@meetingsys.vn','emp.it2@meetingsys.vn','emp.facility1@meetingsys.vn','emp.admin1@meetingsys.vn','bizadmin.it@meetingsys.vn']),
 ('MT-UEL-008', 'Trao đổi kế hoạch tuyển sinh thạc sĩ đợt 2 năm 2026',
  'Họp trực tuyến qua Google Meet với các khoa có ngành đào tạo thạc sĩ.',
  'manager.sales@meetingsys.vn', 'ONLINE', '2026-10-22 14:00+07', '2026-10-22 15:30+07', 'scheduled', false,
  ARRAY['emp.sales1@meetingsys.vn','emp.sales2@meetingsys.vn','teacher@meetingsys.vn']),
 ('MT-UEL-009', 'Thẩm định nội dung số hóa hồ sơ sinh viên khóa 26',
  'Đề xuất của chuyên viên P.CNTT, chờ Lãnh đạo phòng duyệt.',
  'emp.it1@meetingsys.vn', 'A102', '2026-10-23 08:00+07', '2026-10-23 10:00+07', 'pending_approval', true,
  ARRAY['emp.it2@meetingsys.vn','manager.it@meetingsys.vn']);

INSERT INTO meetings (meeting_code, title, description, organizer_id, host_id, room_id, meeting_mode,
                      status, start_time, end_time, actual_start_time, actual_end_time, attendance_enabled,
                      expected_attendee_count, created_by)
SELECT p.code, p.title, p.descr, o.id, o.id, r.id,
       CASE WHEN p.room = 'ONLINE' THEN 'online' ELSE 'offline' END,
       p.status, p.st, p.en,
       CASE WHEN p.status = 'completed' THEN p.st END,
       CASE WHEN p.status = 'completed' THEN p.en END,
       p.att, cardinality(p.members) + 1, o.id
FROM plan p JOIN users o ON o.email = p.organizer JOIN rooms r ON r.room_code = p.room;

-- Chủ trì + thành viên.
INSERT INTO meeting_participants (meeting_id, user_id, participant_role, invitation_status, is_required, attendance_required)
SELECT m.id, m.organizer_id, 'host', 'accepted', true, m.attendance_enabled
FROM meetings m WHERE m.meeting_code LIKE 'MT-UEL-%';
INSERT INTO meeting_participants (meeting_id, user_id, participant_role, invitation_status, is_required, attendance_required)
SELECT m.id, u.id, 'attendee', CASE WHEN m.status = 'pending_approval' THEN 'pending' ELSE 'accepted' END, true, m.attendance_enabled
FROM plan p JOIN meetings m ON m.meeting_code = p.code CROSS JOIN LATERAL unnest(p.members) e JOIN users u ON u.email = e;

-- Giữ phòng.
INSERT INTO room_bookings (booking_code, meeting_id, room_id, reserved_start_time, reserved_end_time, status, booked_by, approved_by, approved_at)
SELECT 'BK-UEL-' || substr(m.meeting_code, 8), m.id, m.room_id, m.start_time, m.end_time,
       CASE m.status WHEN 'completed' THEN 'completed' WHEN 'pending_approval' THEN 'pending' ELSE 'approved' END,
       m.organizer_id,
       CASE WHEN m.status <> 'pending_approval' THEN m.organizer_id END,
       CASE WHEN m.status <> 'pending_approval' THEN m.start_time - interval '3 days' END
FROM meetings m WHERE m.meeting_code LIKE 'MT-UEL-%';

-- Yêu cầu đặt lịch (luồng duyệt).
INSERT INTO meeting_requests (request_code, meeting_id, request_type, requested_by, requested_at, target_room_id,
       requested_start_time, requested_end_time, approval_mode, approval_status, conflict_check_status,
       decision_by, decision_at, applied_at, request_payload_json)
SELECT 'RQ-UEL-' || substr(m.meeting_code, 8), m.id, 'create_meeting', m.organizer_id, m.start_time - interval '4 days',
       m.room_id, m.start_time, m.end_time,
       CASE WHEN m.status = 'pending_approval' THEN 'manual' ELSE 'auto' END,
       CASE WHEN m.status = 'pending_approval' THEN 'pending' ELSE 'approved' END, 'clear',
       CASE WHEN m.status <> 'pending_approval' THEN m.organizer_id END,
       CASE WHEN m.status <> 'pending_approval' THEN m.start_time - interval '4 days' END,
       CASE WHEN m.status <> 'pending_approval' THEN m.start_time - interval '4 days' END,
       jsonb_build_object('title', m.title, 'roomId', m.room_id, 'startTime', m.start_time, 'endTime', m.end_time,
                          'attendanceEnabled', m.attendance_enabled)
FROM meetings m WHERE m.meeting_code LIKE 'MT-UEL-%';

-- Điểm danh: CHỈ cuộc họp đã kết thúc và BẬT điểm danh. Cuộc họp tắt điểm danh không có bản ghi.
-- Kịch bản: (email, phút lệch so với giờ bắt đầu, phương thức) — NULL = vắng.
CREATE TEMP TABLE att_plan (code text, email text, offset_min int, method text) ON COMMIT DROP;
INSERT INTO att_plan VALUES
 ('MT-UEL-001','manager.it@meetingsys.vn',-6,'door_camera'),
 ('MT-UEL-001','emp.it1@meetingsys.vn',-3,'door_camera'),
 ('MT-UEL-001','emp.it2@meetingsys.vn',12,'door_camera'),
 ('MT-UEL-001','bizadmin.it@meetingsys.vn',2,'door_camera'),
 ('MT-UEL-001','emp.admin1@meetingsys.vn',NULL,NULL),
 ('MT-UEL-001','teacher@meetingsys.vn',4,'manual'),
 ('MT-UEL-002','manager.sales@meetingsys.vn',-15,'door_camera'),
 ('MT-UEL-002','emp.sales1@meetingsys.vn',-8,'door_camera'),
 ('MT-UEL-002','emp.sales2@meetingsys.vn',-5,'door_camera'),
 ('MT-UEL-002','manager.hr@meetingsys.vn',1,'door_camera'),
 ('MT-UEL-002','manager.it@meetingsys.vn',18,'door_camera'),
 ('MT-UEL-002','emp.hr1@meetingsys.vn',NULL,NULL),
 ('MT-UEL-002','teacher@meetingsys.vn',-2,'door_camera'),
 ('MT-UEL-005','manager.hr@meetingsys.vn',-10,'door_camera'),
 ('MT-UEL-005','emp.hr1@meetingsys.vn',-4,'door_camera'),
 ('MT-UEL-005','emp.hr2@meetingsys.vn',7,'manual'),
 ('MT-UEL-005','bizadmin.hr@meetingsys.vn',0,'door_camera'),
 ('MT-UEL-005','emp.admin1@meetingsys.vn',-1,'door_camera');

INSERT INTO attendance_records (meeting_id, participant_id, user_id, check_in_method, attendance_source,
       check_in_time, check_out_time, is_present, is_late, late_minutes, attendance_status, note)
SELECT m.id, mp.id, u.id,
       COALESCE(a.method, 'system'),
       CASE WHEN a.method = 'manual' THEN 'manual' ELSE 'camera' END,
       m.start_time + make_interval(mins => a.offset_min),
       CASE WHEN a.offset_min IS NOT NULL THEN m.end_time - interval '2 minutes' END,
       a.offset_min IS NOT NULL,
       COALESCE(a.offset_min > 5, false),
       CASE WHEN a.offset_min > 5 THEN a.offset_min ELSE 0 END,
       CASE WHEN a.offset_min IS NULL THEN 'absent' WHEN a.offset_min > 5 THEN 'late' ELSE 'present' END,
       CASE WHEN a.method = 'manual' THEN 'Thư ký điểm danh thủ công' END
FROM att_plan a JOIN meetings m ON m.meeting_code = a.code
JOIN users u ON u.email = a.email
JOIN meeting_participants mp ON mp.meeting_id = m.id AND mp.user_id = u.id;

-- Về sớm (camera ghi nhận giờ ra trước giờ kết thúc > 15 phút) và vắng có lý do được duyệt.
-- Điểm trừ do trigger fn_attendance_penalty tự tính theo attendance_violation_rules.
UPDATE attendance_records ar SET check_out_time = m.end_time - interval '40 minutes', left_early = true,
       note = 'Camera cửa A.114 ghi nhận ra lúc ' || to_char((m.end_time - interval '40 minutes') AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI')
FROM meetings m, users u
WHERE ar.meeting_id = m.id AND ar.user_id = u.id AND m.meeting_code = 'MT-UEL-001' AND u.email = 'emp.it1@meetingsys.vn';
UPDATE attendance_records ar SET check_out_time = m.end_time - interval '25 minutes', left_early = true,
       note = 'Xin về sớm để dự họp Hội đồng tuyển dụng, chưa gửi lý do'
FROM meetings m, users u
WHERE ar.meeting_id = m.id AND ar.user_id = u.id AND m.meeting_code = 'MT-UEL-005' AND u.email = 'emp.hr2@meetingsys.vn';
UPDATE attendance_records ar SET violation_rule_code = 'EXCUSED',
       note = 'Đi công tác Sở GD&ĐT theo Quyết định 1452/QĐ-ĐHKT-LUẬT, chủ trì đã duyệt lý do'
FROM meetings m, users u
WHERE ar.meeting_id = m.id AND ar.user_id = u.id AND m.meeting_code = 'MT-UEL-002' AND u.email = 'emp.hr1@meetingsys.vn';

UPDATE meeting_participants mp SET attendance_status = ar.attendance_status
FROM attendance_records ar WHERE ar.participant_id = mp.id
  AND mp.meeting_id IN (SELECT id FROM meetings WHERE meeting_code LIKE 'MT-UEL-%');

COMMIT;
