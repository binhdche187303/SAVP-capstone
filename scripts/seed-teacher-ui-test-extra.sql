-- [UI-TEST] Seed bổ sung cho teacher@meetingsys.vn: trang "Báo hỏng thiết bị" + "Khách của tôi".
-- Chạy lại được (dọn trước rồi chèn). Xóa bằng scripts/cleanup-teacher-ui-test.sql.
-- Nhãn: meetings 'UIT-MT-%', equipments 'UIT-EQ-%', users 'uitest.k%@uitest.local',
--       visitors full_name '[UI-TEST] %', visits 'UIT-VD-%'.
-- Chạy: bash /tmp/q.sh -v ON_ERROR_STOP=1 -f - < scripts/seed-teacher-ui-test-extra.sql

BEGIN;

-- ===== dọn dữ liệu cũ =====
DELETE FROM visitor_visits WHERE visit_code LIKE 'UIT-VD-%';
DELETE FROM visitors WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'uitest.k%@uitest.local');
DELETE FROM users WHERE email LIKE 'uitest.k%@uitest.local';
DELETE FROM equipments WHERE equipment_code LIKE 'UIT-EQ-%';
DELETE FROM meetings WHERE meeting_code LIKE 'UIT-MT-%';

-- ===== 1) Cuộc họp đã xong ở 8 phòng => FE lấy được phòng từ lịch sử họp =====
WITH t AS (SELECT 'd15dbb94-5d76-424b-8c6c-51efbe1debdf'::uuid AS uid),
rm AS (
  SELECT id, row_number() OVER (ORDER BY room_code) AS n
  FROM rooms
  WHERE deleted_at IS NULL
    AND room_code IN ('A.301','A.305','A.308','A.309','A.310','A.311','A.312','A.401')
)
INSERT INTO meetings (meeting_code, title, organizer_id, host_id, room_id, start_time, end_time, status, description)
SELECT 'UIT-MT-' || lpad(rm.n::text, 2, '0'),
       '[UI-TEST] Họp tổ bộ môn #' || rm.n,
       t.uid, t.uid, rm.id,
       TIMESTAMPTZ '2026-10-01 08:00+07' + (rm.n * 2) * INTERVAL '1 day',
       TIMESTAMPTZ '2026-10-01 09:30+07' + (rm.n * 2) * INTERVAL '1 day',
       'completed',
       '[UI-TEST] dữ liệu giả để test trang báo hỏng thiết bị'
FROM rm, t;

-- ===== 2) Thiết bị: 6 cái/phòng cho 8 phòng mới + 3 phòng giáo viên đã họp =====
WITH t AS (SELECT 'd15dbb94-5d76-424b-8c6c-51efbe1debdf'::uuid AS uid),
target_rooms AS (
  SELECT DISTINCT m.room_id
  FROM meetings m, t
  WHERE m.deleted_at IS NULL AND m.room_id IS NOT NULL
    AND (m.organizer_id = t.uid OR m.host_id = t.uid
         OR EXISTS (SELECT 1 FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.user_id = t.uid))
),
r AS (
  SELECT tr.room_id, rooms.room_code, row_number() OVER (ORDER BY rooms.room_code) AS rn
  FROM target_rooms tr JOIN rooms ON rooms.id = tr.room_id
),
k AS (SELECT generate_series(1, 6) AS k),
x AS (
  SELECT r.room_id, r.room_code, r.rn, k.k,
         (r.rn - 1) * 6 + k.k AS seq,
         (ARRAY['camera','microphone','display','speaker','capture_agent','sensor'])[k.k] AS etype,
         (ARRAY['Camera AI','Micro không dây','Màn hình LED','Loa hội trường','Thiết bị ghi hình','Cảm biến môi trường'])[k.k] AS ename,
         (ARRAY['Hikvision','Shure','Samsung','JBL','Dahua','Xiaomi'])[k.k] AS brand
  FROM r, k
)
INSERT INTO equipments (equipment_code, equipment_name, equipment_type, serial_number, brand, model,
                        purchase_date, asset_status, health_status, current_room_id, assigned_at, installed_at,
                        assignment_note, last_issue_reported_at, last_issue_note)
SELECT 'UIT-EQ-' || lpad(seq::text, 3, '0'),
       '[UI-TEST] ' || ename || ' ' || room_code,
       etype,
       'SN-UIT-' || lpad(seq::text, 5, '0'),
       brand,
       'MDL-' || (100 + seq),
       DATE '2024-01-15' + (seq * 7)::int,
       'assigned',
       CASE WHEN seq % 7 = 0 THEN 'faulty'
            WHEN seq % 5 = 0 THEN 'warning'
            WHEN seq % 11 = 0 THEN 'offline'
            ELSE 'healthy' END,
       room_id,
       TIMESTAMPTZ '2025-01-10 08:00+07' + seq::int * INTERVAL '1 day',
       TIMESTAMPTZ '2025-01-10 10:00+07' + seq::int * INTERVAL '1 day',
       '[UI-TEST]',
       CASE WHEN seq % 7 = 0 OR seq % 5 = 0 THEN TIMESTAMPTZ '2026-11-01 09:00+07' + (seq % 10) * INTERVAL '1 day' END,
       CASE WHEN seq % 7 = 0 THEN '[UI-TEST] Thiết bị không hoạt động, cần kiểm tra'
            WHEN seq % 5 = 0 THEN '[UI-TEST] Hoạt động chập chờn' END
FROM x;

-- ===== 3) Khách: 40 user + visitor =====
INSERT INTO users (username, email, full_name)
SELECT 'uitest.k' || lpad(g::text, 3, '0'),
       'uitest.k' || lpad(g::text, 3, '0') || '@uitest.local',
       '[UI-TEST] Khách ' || lpad(g::text, 3, '0')
FROM generate_series(1, 40) g;

INSERT INTO visitors (user_id, full_name, phone_number, id_number, email, organization)
SELECT u.id,
       '[UI-TEST] ' || (ARRAY['Nguyễn Văn','Trần Thị','Lê Minh','Phạm Thu','Hoàng Đức','Võ Ngọc','Đặng Quốc','Bùi Thanh'])[1 + (g % 8)]
         || ' ' || (ARRAY['An','Bình','Chi','Dũng','Hà','Khoa','Lan','Minh','Nam','Phương'])[1 + (g % 10)] || ' ' || lpad(g::text, 3, '0'),
       '09' || lpad((10000000 + g * 7919)::text, 8, '0'),
       '0790' || lpad((20000000 + g)::text, 8, '0'),
       'uitest.k' || lpad(g::text, 3, '0') || '@uitest.local',
       (ARRAY['Công ty ABC','ĐH Bách Khoa','Sở GD&ĐT','Ngân hàng XYZ','Phụ huynh SV'])[1 + (g % 5)]
FROM generate_series(1, 40) g
JOIN users u ON u.email = 'uitest.k' || lpad(g::text, 3, '0') || '@uitest.local';

-- ===== 4) Lượt khách: 75 lượt, host = giáo viên =====
-- 1..25  pending_approval (tương lai)   -> tab "Chờ duyệt"
-- 26..50 approved/checked_in/must_leave -> tab "Sắp tới"
-- 51..75 checked_out/rejected/cancelled/expired/revoked/exit_unrecorded (quá khứ) -> tab "Đã qua"
WITH v AS (
  SELECT id, row_number() OVER (ORDER BY full_name) AS vn FROM visitors WHERE full_name LIKE '[UI-TEST] %'
),
s AS (
  SELECT g,
         CASE
           WHEN g <= 25 THEN 'pending_approval'
           WHEN g <= 50 THEN (ARRAY['approved','approved','approved','checked_in','must_leave'])[1 + (g % 5)]
           ELSE (ARRAY['checked_out','checked_out','rejected','cancelled','expired','revoked','exit_unrecorded'])[1 + (g % 7)]
         END AS st,
         CASE
           WHEN g <= 25 THEN TIMESTAMPTZ '2026-11-16 08:00+07' + (g - 1) * INTERVAL '1 day' + (g % 4) * INTERVAL '2 hours'
           WHEN g <= 50 AND (g % 5) IN (3, 4) THEN TIMESTAMPTZ '2026-11-13 08:00+07' + (g % 3) * INTERVAL '1 hour'
           WHEN g <= 50 THEN TIMESTAMPTZ '2026-11-14 08:00+07' + (g - 26) * INTERVAL '1 day' + (g % 4) * INTERVAL '2 hours'
           ELSE TIMESTAMPTZ '2026-11-12 08:00+07' - (g - 51) * INTERVAL '2 days' + (g % 4) * INTERVAL '2 hours'
         END AS sf
  FROM generate_series(1, 75) g
)
INSERT INTO visitor_visits (visit_code, visitor_id, channel, status, host_user_id, purpose, companions,
                            scheduled_from, scheduled_to, valid_from, valid_to)
SELECT 'UIT-VD-' || lpad(s.g::text, 4, '0'),
       v.id,
       (ARRAY['online','host_invite','walk_in'])[1 + (s.g % 3)],
       s.st,
       'd15dbb94-5d76-424b-8c6c-51efbe1debdf'::uuid,
       '[UI-TEST] ' || (ARRAY['Trao đổi đề tài nghiên cứu','Phụ huynh gặp giảng viên','Đối tác doanh nghiệp','Phỏng vấn tuyển dụng','Ký biên bản hợp tác','Bảo vệ khóa luận'])[1 + (s.g % 6)],
       (s.g % 4)::smallint,
       s.sf, s.sf + INTERVAL '2 hours',
       s.sf - INTERVAL '30 minutes', s.sf + INTERVAL '3 hours'
FROM s JOIN v ON v.vn = 1 + ((s.g - 1) % 40);

COMMIT;

-- ===== kiểm tra nhanh =====
SELECT 'meetings' AS what, count(*) FROM meetings WHERE meeting_code LIKE 'UIT-MT-%'
UNION ALL SELECT 'equipments', count(*) FROM equipments WHERE equipment_code LIKE 'UIT-EQ-%'
UNION ALL SELECT 'visitors', count(*) FROM visitors WHERE full_name LIKE '[UI-TEST] %'
UNION ALL SELECT 'visits', count(*) FROM visitor_visits WHERE visit_code LIKE 'UIT-VD-%';
