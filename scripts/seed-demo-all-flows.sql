-- SEED DEMO CHO MỌI LUỒNG (A..L) — dữ liệu mẫu 30 ngày, chạy lại được (tự dọn bản cũ theo nhãn demo_seed).
-- Yêu cầu: đã chạy scripts/seed-ktl-layout.sql (zone + camera KTL) và DB có người dùng/phòng/lớp mẫu.
-- Xoá sạch: chạy phần CLEANUP ở đầu file (BEGIN..DELETE..COMMIT) rồi bỏ phần INSERT.
-- Nhãn: payload_json/metadata_json ->> 'demo_seed' = 'all-flows'. Ảnh chụp sự kiện KHÔNG có (không có file ảnh).
BEGIN;

-- ============ CLEANUP ============
DELETE FROM class_attendance_records WHERE source = 'demo_seed';
DELETE FROM class_sessions WHERE note = 'demo_seed';
DELETE FROM security_alerts WHERE payload_json->>'demo_seed' = 'all-flows';
DELETE FROM alert_rules WHERE channels @> '["demo_seed"]'::jsonb;
DELETE FROM person_control_list WHERE reason = 'demo_seed';
DELETE FROM vehicle_control_list WHERE reason = 'demo_seed';
DELETE FROM gate_access_logs WHERE metadata_json->>'demo_seed' = 'all-flows';
DELETE FROM zone_presence_events WHERE metadata_json->>'demo_seed' = 'all-flows';
DELETE FROM iot_device_events WHERE payload_json->>'demo_seed' = 'all-flows';
DELETE FROM visitor_visit_events WHERE note = 'demo_seed' OR visit_id IN (SELECT id FROM visitor_visits WHERE purpose LIKE '[demo]%');
DELETE FROM visitor_visit_zones WHERE visit_id IN (SELECT id FROM visitor_visits WHERE purpose LIKE '[demo]%');
DELETE FROM visitor_visits WHERE purpose LIKE '[demo]%';
DELETE FROM vehicle_registrations WHERE note = 'demo_seed';
DELETE FROM report_schedule_runs WHERE schedule_name LIKE '[demo]%';
DELETE FROM report_schedules WHERE name LIKE '[demo]%';

-- ============ B/D. RA VÀO CỔNG (30 ngày, ngày làm việc) ============
-- Người dùng đi qua cổng: nhân viên, quản lý, giảng viên, sinh viên, bảo vệ.
CREATE TEMP TABLE d_people ON COMMIT DROP AS
SELECT u.id AS user_id, row_number() OVER (ORDER BY u.email) AS rn
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id AND r.role_code IN ('EMPLOYEE','MANAGER','TEACHER','STUDENT','GUARD','BUSINESS_ADMIN')
WHERE u.email NOT LIKE '%@visitor.invalid' AND u.email NOT LIKE '%import@%'
GROUP BY u.id, u.email;

CREATE TEMP TABLE d_gates ON COMMIT DROP AS
SELECT z.id AS zone_id, z.zone_code,
       (SELECT d.id FROM iot_devices d WHERE d.zone_id = z.id ORDER BY d.device_code LIMIT 1) AS device_id,
       row_number() OVER (ORDER BY z.zone_code) AS gn
FROM zones z WHERE z.zone_type = 'gate' AND z.deleted_at IS NULL AND z.zone_code NOT LIKE 'TEST%';

CREATE TEMP TABLE d_in ON COMMIT DROP AS
SELECT gen_random_uuid() AS in_id, gen_random_uuid() AS out_id, p.user_id, g.zone_id AS in_zone, g.device_id AS in_dev,
       g2.zone_id AS out_zone, g2.device_id AS out_dev,
       ((day + interval '7 hours' + (random() * interval '95 minutes')) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS t_in,
       ((day + interval '16 hours 30 minutes' + (random() * interval '120 minutes')) AT TIME ZONE 'Asia/Ho_Chi_Minh') AS t_out
FROM generate_series((current_date - 29)::timestamp, current_date::timestamp, interval '1 day') day
CROSS JOIN d_people p
JOIN d_gates g  ON g.gn  = 1 + ((p.rn + extract(day FROM day)::int) % (SELECT count(*) FROM d_gates))
JOIN d_gates g2 ON g2.gn = 1 + ((p.rn + extract(day FROM day)::int + 1) % (SELECT count(*) FROM d_gates))
WHERE extract(isodow FROM day) < 6
  AND random() < 0.92                       -- ~8% vắng
  AND (day + interval '7 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh' < now();

INSERT INTO gate_access_logs (id, zone_id, device_id, user_id, direction, access_time, paired_log_id, duration_seconds, metadata_json)
SELECT in_id, in_zone, in_dev, user_id, 'enter', t_in, out_id, extract(epoch FROM (t_out - t_in))::int,
       '{"demo_seed":"all-flows","method":"face"}'::jsonb
FROM d_in WHERE t_out < now()
UNION ALL
SELECT out_id, out_zone, out_dev, user_id, 'leave', t_out, in_id, extract(epoch FROM (t_out - t_in))::int,
       '{"demo_seed":"all-flows","method":"face"}'::jsonb
FROM d_in WHERE t_out < now()
UNION ALL  -- hôm nay: đã vào, chưa ra
SELECT in_id, in_zone, in_dev, user_id, 'enter', t_in, NULL, NULL, '{"demo_seed":"all-flows","method":"face"}'::jsonb
FROM d_in WHERE t_out >= now();

-- Ngày làm việc: một số lần nhận diện thành công / người lạ bị từ chối (event cổng, không ảnh)
-- DB chưa có bridge IVSS-BRIDGE-PORTRAIT ⇒ dùng thiết bị của cổng.
INSERT INTO iot_device_events (device_id, zone_id, event_type, event_time, source_protocol, severity, payload_json, processed_status, created_at)
SELECT g.device_id, g.zone_id, 'face_verify', l.access_time, 'http', 'info',
       jsonb_build_object('demo_seed','all-flows','extracted_fields',
         jsonb_build_object('operator', l.user_id::text, 'verify_time', l.access_time,
                            'similarity', (82 + floor(random()*17))::text, 'event_result', 'verified')),
       'processed', l.access_time
FROM gate_access_logs l
JOIN d_gates g ON g.zone_id = l.zone_id AND g.device_id IS NOT NULL
WHERE l.metadata_json->>'demo_seed' = 'all-flows' AND l.direction = 'enter' AND random() < 0.4;

-- ============ B. NGƯỜI LẠ (không ảnh) ============
-- DB chưa có bridge IVSS-BRIDGE-PORTRAIT ⇒ dùng thiết bị của cổng.
INSERT INTO iot_device_events (device_id, zone_id, event_type, event_time, source_protocol, severity, payload_json, processed_status, created_at)
SELECT g.device_id, g.zone_id, 'face_stranger', t, 'http', 'warning',
       jsonb_build_object('demo_seed','all-flows','extracted_fields',
         jsonb_build_object('stranger_id', 'DEMO-STR-' || lpad(p::text,2,'0'),
                            'similarity', (31 + floor(random()*18))::text, 'event_result', 'stranger')),
       'processed', t
FROM generate_series(1, 6) p
CROSS JOIN LATERAL generate_series(1, 7 - p) h
JOIN d_gates g ON g.gn = 1 + ((p + h) % (SELECT count(*) FROM d_gates))
CROSS JOIN LATERAL (SELECT now() - ((h * 19 + p * 7 + 2) * interval '1 hour') AS t) x
WHERE g.device_id IS NOT NULL;

-- ============ C. BIỂN SỐ (xe đăng ký + xe lạ) ============
INSERT INTO vehicle_registrations (user_id, plate_number, plate_raw, vehicle_type, note, status)
SELECT p.user_id, v.plate, v.raw, v.vt, 'demo_seed', 'active'
FROM (VALUES (3,'51F12345','51F-123.45','car'),(4,'59X198765','59X1-987.65','motorbike'),
             (5,'30E67890','30E-678.90','car'),(6,'29B112233','29B1-122.33','motorbike'),
             (7,'51G55577','51G-555.77','car'),(8,'59C233344','59C2-333.44','motorbike')) v(rn, plate, raw, vt)
JOIN d_people p ON p.rn = v.rn
WHERE NOT EXISTS (SELECT 1 FROM vehicle_registrations x WHERE x.plate_number = v.plate AND x.deleted_at IS NULL);

INSERT INTO vehicle_control_list (plate_number, plate_raw, list_type, vehicle_type, reason, active)
VALUES ('51A99999','51A-999.99','watchlist','car','demo_seed',true),
       ('30H00001','30H-000.01','blocklist','car','demo_seed',true),
       ('29X777777','29X7-777.77','watchlist','motorbike','demo_seed',true);

CREATE TEMP TABLE d_plates ON COMMIT DROP AS
SELECT vr.plate_number, vr.plate_raw, vr.vehicle_type, vr.user_id, vr.id AS reg_id, 'matched' AS state
FROM vehicle_registrations vr WHERE vr.deleted_at IS NULL AND vr.status = 'active'
UNION ALL SELECT '51A99999','51A-999.99','car',NULL,NULL,'control'
UNION ALL SELECT '30H00001','30H-000.01','car',NULL,NULL,'control'
UNION ALL SELECT '29X777777','29X7-777.77','motorbike',NULL,NULL,'control'
UNION ALL SELECT 'U'||g::text||'K'||(1000+g*37)::text, 'U'||g::text||'K-'||(1000+g*37)::text,
                 CASE WHEN g % 2 = 0 THEN 'car' ELSE 'motorbike' END, NULL, NULL, 'unmatched'
          FROM generate_series(10, 24) g;

CREATE TEMP TABLE d_veh ON COMMIT DROP AS
SELECT pl.*, ((row_number() OVER ()) % 7 = 0)::int AS spare, gn.zone_id, gn.device_id,
       ((day + interval '6 hours 30 minutes' + random() * interval '13 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh') AS t
FROM d_plates pl
CROSS JOIN generate_series((current_date - 29)::timestamp, current_date::timestamp, interval '1 day') day
JOIN d_gates gn ON gn.gn = 1
WHERE random() < CASE pl.state WHEN 'matched' THEN 0.8 WHEN 'control' THEN 0.12 ELSE 0.18 END;

-- DB chưa có bridge IVSS-BRIDGE-PORTRAIT ⇒ dùng thiết bị của cổng.
INSERT INTO iot_device_events (device_id, zone_id, event_type, event_time, source_protocol, severity, payload_json, processed_status, created_at)
SELECT COALESCE((SELECT id FROM iot_devices WHERE device_code = 'IVSS-BRIDGE-PORTRAIT'), v.device_id), v.zone_id, 'ivss_vehicle_event', ev.t, 'ivss',
       CASE v.state WHEN 'matched' THEN 'info' ELSE 'warning' END,
       jsonb_build_object('demo_seed','all-flows','plateNumber', v.plate_number, 'plateRaw', v.plate_raw,
         'vehicleType', upper(v.vehicle_type), 'plateColor', 'white', 'vehicleColor', 'unknown',
         'matchState', CASE v.state WHEN 'unmatched' THEN 'unmatched' ELSE 'matched' END,
         'userId', v.user_id, 'direction', ev.dir, 'gateDirection', ev.dir, 'eventActionRaw', ev.dir,
         'channelId', CASE ev.dir WHEN 'enter' THEN 9101 ELSE 9102 END,
         'utc', ev.t, 'receivedAt', ev.t, 'source', 'demo_seed'),
       'processed', ev.t
FROM d_veh v
CROSS JOIN LATERAL (VALUES ('enter', v.t), ('leave', v.t + interval '8 hours' + random() * interval '90 minutes')) ev(dir, t)
WHERE ev.t < now();

INSERT INTO gate_access_logs (zone_id, device_id, user_id, vehicle_registration_id, plate_number, direction, access_time, metadata_json)
SELECT v.zone_id, v.device_id, v.user_id, v.reg_id, v.plate_number, ev.dir, ev.t,
       jsonb_build_object('demo_seed','all-flows','source','anpr')
FROM d_veh v
CROSS JOIN LATERAL (VALUES ('enter', v.t), ('leave', v.t + interval '8 hours' + random() * interval '90 minutes')) ev(dir, t)
WHERE v.state = 'matched' AND ev.t < now();

-- ============ E. HIỆN DIỆN KHU VỰC (đếm người theo giờ, 14 ngày) ============
INSERT INTO zone_presence_events (zone_id, device_id, event_type, occupancy_count, confidence_score, event_time, source_type, metadata_json)
SELECT z.id,
       (SELECT d.id FROM iot_devices d WHERE d.zone_id = z.id ORDER BY d.device_code LIMIT 1),
       'count',
       greatest(0, round(
         CASE z.zone_type WHEN 'gate' THEN 6 WHEN 'lobby' THEN 14 WHEN 'corridor' THEN 9 ELSE 5 END
         * (0.3 + 1.2 * exp(-power((extract(hour FROM t AT TIME ZONE 'Asia/Ho_Chi_Minh') - 12.5) / 3.2, 2)))        -- đỉnh quanh trưa
         * (0.75 + random() * 0.5)))::int,
       0.9, t, 'ai_camera', '{"demo_seed":"all-flows"}'::jsonb
FROM zones z
CROSS JOIN generate_series(date_trunc('hour', now()) - interval '14 days', date_trunc('hour', now()), interval '30 minutes') t
WHERE z.deleted_at IS NULL AND z.zone_code LIKE 'KTL-%'
  AND extract(hour FROM t AT TIME ZONE 'Asia/Ho_Chi_Minh') BETWEEN 6 AND 21 AND extract(isodow FROM t) < 7;

-- Có người xuất hiện/rời khu vực (gắn người dùng) — cho trang hiện diện
INSERT INTO zone_presence_events (zone_id, device_id, user_id, event_type, occupancy_count, confidence_score, event_time, source_type, metadata_json)
SELECT z.id, (SELECT d.id FROM iot_devices d WHERE d.zone_id = z.id ORDER BY d.device_code LIMIT 1),
       p.user_id, ev.et, 1, 0.9 + random() * 0.09, ev.t, 'ai_camera', '{"demo_seed":"all-flows"}'::jsonb
FROM d_people p
JOIN zones z ON z.zone_code = (ARRAY['KTL-A1-G','KTL-A1-1','KTL-B1-G','KTL-A2-1'])[1 + (p.rn % 4)]
CROSS JOIN LATERAL (VALUES ('appear', now() - ((p.rn % 5 + 1) * interval '20 minutes')),
                           ('disappear', now() - ((p.rn % 5) * interval '10 minutes'))) ev(et, t)
WHERE p.rn % 3 <> 0;

-- ============ I. CẢNH BÁO AN NINH (đủ loại, đủ trạng thái) ============
INSERT INTO alert_rules (alert_type, zone_id, threshold, channels, enabled)
SELECT 'crowd', z.id, 25, '["in_app","email","demo_seed"]'::jsonb, true
FROM zones z WHERE z.zone_code IN ('KTL-A2-1','KTL-A1-G','KTL-CONG1')
  AND NOT EXISTS (SELECT 1 FROM alert_rules r WHERE r.alert_type = 'crowd' AND r.zone_id = z.id AND r.deleted_at IS NULL);

INSERT INTO security_alerts (alert_type, severity, zone_id, dedupe_key, status, triggered_at, last_seen_at,
                             occurrence_count, payload_json, acknowledged_by, acknowledged_at, resolved_by, resolved_at,
                             resolution_note)
SELECT s.atype, s.sev, z.id, 'demo-' || s.atype || '-' || s.n,
       s.st, now() - (s.ago * interval '1 hour'), now() - (s.ago * interval '1 hour') + interval '12 minutes',
       1 + (s.n % 4),
       jsonb_build_object('demo_seed','all-flows','message', s.msg, 'occurredAt', now() - (s.ago * interval '1 hour'),
                          'userId', NULL),
       CASE WHEN s.st IN ('acknowledged','resolved') THEN (SELECT id FROM users WHERE email='guard@meetingsys.vn') END,
       CASE WHEN s.st IN ('acknowledged','resolved') THEN now() - (s.ago * interval '1 hour') + interval '5 minutes' END,
       CASE WHEN s.st = 'resolved' THEN (SELECT id FROM users WHERE email='guard@meetingsys.vn') END,
       CASE WHEN s.st = 'resolved' THEN now() - (s.ago * interval '1 hour') + interval '25 minutes' END,
       CASE WHEN s.st = 'resolved' THEN 'Đã kiểm tra tại chỗ, xử lý xong' END
FROM (SELECT v.*, row_number() OVER () AS n FROM (VALUES
  ('stranger','medium','new',1,'KTL-CONG1','Người lạ xuất hiện tại Cổng 1'),
  ('stranger','medium','new',3,'KTL-CONG3','Người lạ xuất hiện tại Cổng 3'),
  ('stranger','medium','acknowledged',9,'KTL-CONG2-MOI','Người lạ lặp lại 3 lần'),
  ('stranger','medium','resolved',30,'KTL-CONG1','Người lạ — đã xác minh là khách'),
  ('stranger','medium','resolved',55,'KTL-A1-G','Người lạ tại sảnh A1'),
  ('unknown_vehicle','medium','new',2,'KTL-CONG1','Xe chưa đăng ký U12K1444 vào cổng'),
  ('unknown_vehicle','medium','acknowledged',11,'KTL-CONG2-CU','Xe chưa đăng ký U18K1666 vào cổng'),
  ('unknown_vehicle','medium','resolved',40,'KTL-CONG3','Xe chưa đăng ký đã được đăng ký bổ sung'),
  ('vehicle_unauthorized','high','new',4,'KTL-CONG1','Xe không được phép vào khu vực'),
  ('vehicle_control_match','medium','new',5,'KTL-CONG2-MOI','Xe 51A-999.99 trong danh sách theo dõi'),
  ('vehicle_control_match','high','acknowledged',20,'KTL-CONG1','Xe 30H-000.01 trong danh sách cấm'),
  ('vehicle_control_match','medium','resolved',70,'KTL-CONG3','Xe 29X7-777.77 trong danh sách theo dõi'),
  ('crowd','high','new',1,'KTL-A2-1','Hội trường vượt ngưỡng 25 người'),
  ('crowd','high','acknowledged',8,'KTL-A1-G','Sảnh A1 vượt ngưỡng đông người'),
  ('crowd','high','resolved',26,'KTL-CONG1','Cổng 1 đông người giờ tan học'),
  ('crowd','high','resolved',50,'KTL-A2-1','Hội trường đông người sau sự kiện'),
  ('intrusion','critical','new',2,'KTL-B1-G','Có người vào khu vực hạn chế ngoài giờ'),
  ('intrusion','critical','acknowledged',14,'KTL-A1-1','Xâm nhập hành lang lầu 1 ngoài giờ'),
  ('intrusion','critical','resolved',60,'KTL-B1-G','Xâm nhập khu B1 — xác minh là nhân viên bảo trì'),
  ('device_error','low','new',1,'KTL-CONG2-CU','Camera Cổng 2 hiện hữu mất kết nối'),
  ('device_error','low','new',6,'KTL-A1-1','Camera A1 lầu 1 mất kết nối'),
  ('device_error','low','resolved',35,'KTL-CONG1','Camera Cổng 1 đã kết nối lại'),
  ('person_watchlist_match','medium','new',3,'KTL-CONG3','Phát hiện người trong danh sách theo dõi'),
  ('person_watchlist_match','medium','acknowledged',15,'KTL-CONG1','Người trong danh sách theo dõi xuất hiện'),
  ('visitor_overstay','medium','new',2,'KTL-CONG1','Khách quá giờ hẹn'),
  ('visitor_must_leave','high','acknowledged',6,'KTL-A1-G','Khách quá giờ, yêu cầu ra khỏi khuôn viên')
) v(atype, sev, st, ago, zcode, msg)) s
JOIN zones z ON z.zone_code = s.zcode AND z.deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO person_control_list (display_name, list_type, reason, priority, active)
VALUES ('Đối tượng theo dõi A (mẫu)','watchlist','demo_seed','medium',true),
       ('Đối tượng theo dõi B (mẫu)','watchlist','demo_seed','high',true),
       ('Đối tượng cấm vào C (mẫu)','blocklist','demo_seed','high',true);

-- ============ F. LỚP HỌC: buổi học + điểm danh ============
CREATE TEMP TABLE d_sess ON COMMIT DROP AS
SELECT gen_random_uuid() AS sid, cs.id AS section_id, COALESCE(cs.default_room_id, (SELECT id FROM rooms ORDER BY room_code LIMIT 1 OFFSET (cs.rn % 3))) AS room_id,
       (ARRAY['87d2ccd3-217e-4f37-9b4c-8a174691afc1','afce9e62-d1a2-4d18-8b75-dc4b861aeb25','5ca98cf9-509c-40e1-8f93-a6c49f49985e'])[1 + (s.rn % 3)]::uuid AS shift_id,
       s.no, (current_date - ((8 - s.no) * 7 + (s.rn % 3))::int)::date AS d, cs.rn
FROM (SELECT cs.*, row_number() OVER (ORDER BY class_code) rn FROM class_sections cs WHERE deleted_at IS NULL) cs
CROSS JOIN LATERAL (SELECT g AS no, cs.rn FROM generate_series(1, 8) g) s;

INSERT INTO class_sessions (id, class_section_id, session_no, session_date, shift_id, room_id, start_time, end_time, status, note)
SELECT d.sid, d.section_id, d.no, d.d, d.shift_id, d.room_id,
       (d.d + sh.start_time)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh',
       (d.d + sh.end_time)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh',
       CASE WHEN d.d < current_date THEN 'completed' ELSE 'scheduled' END, 'demo_seed'
FROM d_sess d JOIN study_shifts sh ON sh.id = d.shift_id
WHERE d.d IS NOT NULL AND d.room_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO class_attendance_records (class_section_id, student_id, attendance_date, check_in_at, check_out_at, status, confidence, source)
SELECT d.section_id, e.student_id, d.d,
       CASE WHEN x.st = 'absent' THEN NULL ELSE ((d.d + sh.start_time)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') + x.late END,
       CASE WHEN x.st IN ('absent') THEN NULL ELSE ((d.d + sh.end_time)::timestamp AT TIME ZONE 'Asia/Ho_Chi_Minh') END,
       x.st, CASE WHEN x.st = 'absent' THEN NULL ELSE 85 + floor(random()*14)::int END, 'demo_seed'
FROM d_sess d
JOIN study_shifts sh ON sh.id = d.shift_id
JOIN class_enrollments e ON e.class_section_id = d.section_id
CROSS JOIN LATERAL (
  SELECT r.v, CASE WHEN r.v < 0.72 THEN 'on_time' WHEN r.v < 0.88 THEN 'late' WHEN r.v < 0.93 THEN 'left' ELSE 'absent' END AS st,
         CASE WHEN r.v >= 0.72 AND r.v < 0.88 THEN interval '17 minutes' ELSE interval '-3 minutes' END AS late
  FROM (SELECT random() + 0 * length(e.student_id::text || d.sid::text) AS v) r) x  -- tham chiếu dòng để random() tính lại cho từng bản ghi
WHERE d.d < current_date
ON CONFLICT (class_section_id, student_id, attendance_date) DO NOTHING;

-- ============ H. KHÁCH: nhiều lượt, đủ trạng thái (dùng 2 khách sẵn có) ============
-- DB trống khách ⇒ tạo 2 khách mẫu (email @visitor.invalid, không tính vào ra vào cổng nhân sự).
INSERT INTO users (username, email, password_hash, full_name, phone_number, account_status)
SELECT v.u, v.e, '!disabled-visitor', v.n, v.p, 'active'
FROM (VALUES ('khach.nguyenvanhung','nguyen.van.hung@visitor.invalid','Nguyễn Văn Hùng','0912345678'),
             ('khach.tranthimai','tran.thi.mai@visitor.invalid','Trần Thị Mai','0987654321')) v(u,e,n,p)
WHERE NOT EXISTS (SELECT 1 FROM users x WHERE lower(x.email)=v.e AND x.deleted_at IS NULL);
INSERT INTO visitors (user_id, full_name, id_number, phone_number, email, organization)
SELECT u.id, u.full_name, CASE u.phone_number WHEN '0912345678' THEN '079088001234' ELSE '001190005678' END,
       u.phone_number, u.email, CASE u.phone_number WHEN '0912345678' THEN 'Công ty CP FPT Software' ELSE 'Ngân hàng Vietcombank CN Thủ Đức' END
FROM users u WHERE u.email IN ('nguyen.van.hung@visitor.invalid','tran.thi.mai@visitor.invalid')
  AND NOT EXISTS (SELECT 1 FROM visitors x WHERE x.user_id=u.id);
INSERT INTO visitor_visits (visit_code, visitor_id, channel, status, host_user_id, department_id, purpose, companions, plate_number,
                            scheduled_from, scheduled_to, valid_from, valid_to, check_in_at, check_out_at, face_score,
                            reject_reason, revoked_at, manual_exit, not_found, overstay_notified_at, last_seen_at, last_seen_zone_id,
                            consent_at, approved_by, approved_at, created_by)
SELECT 'VD-' || to_char(now() - (v.d * interval '1 day'), 'YYMMDD') || '-' || lpad(v.n::text, 4, '0'),
       (SELECT id FROM visitors ORDER BY created_at LIMIT 1 OFFSET (v.n % 2)),
       CASE WHEN v.n % 3 = 0 THEN 'walk_in' ELSE 'online' END, v.st,
       (SELECT id FROM users WHERE email = (ARRAY['manager.it@meetingsys.vn','manager.hr@meetingsys.vn','manager.sales@meetingsys.vn'])[1 + v.n % 3]),
       (SELECT id FROM departments ORDER BY department_code LIMIT 1 OFFSET (v.n % 8)),
       '[demo] ' || (ARRAY['Làm việc với đơn vị','Phỏng vấn ứng viên','Giao nhận thiết bị','Họp đối tác','Tham quan khuôn viên','Bảo trì thiết bị'])[1 + v.n % 6],
       v.n % 3, CASE WHEN v.n % 4 = 0 THEN '51K' || (10000 + v.n)::text END,
       b.t0, b.t0 + interval '2 hours', b.t0 - interval '30 minutes', b.t0 + interval '3 hours',
       CASE WHEN v.st IN ('checked_in','checked_out','must_leave') THEN b.t0 + interval '3 minutes' END,
       CASE WHEN v.st = 'checked_out' THEN b.t0 + interval '110 minutes' END,
       CASE WHEN v.st IN ('checked_in','checked_out','must_leave') THEN 0.84 + (v.n % 10) / 100.0 END,
       CASE WHEN v.st = 'rejected' THEN 'Không có lịch làm việc với đơn vị' END,
       CASE WHEN v.st = 'revoked' THEN b.t0 + interval '20 minutes' END,
       v.st = 'checked_out' AND v.n % 5 = 0, false,
       CASE WHEN v.st = 'must_leave' THEN b.t0 + interval '150 minutes' END,
       CASE WHEN v.st IN ('checked_in','must_leave') THEN now() - interval '10 minutes' END,
       CASE WHEN v.st IN ('checked_in','must_leave') THEN (SELECT id FROM zones WHERE zone_code = 'KTL-A1-G') END,
       b.t0 - interval '1 day',
       CASE WHEN v.st NOT IN ('pending_approval','rejected') THEN (SELECT id FROM users WHERE email='manager.it@meetingsys.vn') END,
       CASE WHEN v.st NOT IN ('pending_approval','rejected') THEN b.t0 - interval '12 hours' END,
       (SELECT id FROM users WHERE email='guard@meetingsys.vn')
FROM (SELECT g AS n,
        (ARRAY['checked_out','checked_out','checked_out','approved','pending_approval','rejected','revoked','expired','checked_in','must_leave'])[1 + g % 10] AS st,
        CASE WHEN g % 10 IN (4,8,9,0) THEN 0 ELSE g % 20 END AS d  -- trạng thái đang diễn ra thì rơi vào hôm nay
      FROM generate_series(1, 40) g) v
CROSS JOIN LATERAL (SELECT CASE WHEN v.d = 0 THEN date_trunc('hour', now()) - interval '1 hour'
                                ELSE (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') - (v.d * interval '1 day') + interval '9 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh' END AS t0) b
WHERE v.st <> 'must_leave' OR true
ON CONFLICT DO NOTHING;

INSERT INTO visitor_visit_zones (visit_id, zone_id)
SELECT vv.id, z.id FROM visitor_visits vv
JOIN zones z ON z.zone_code IN ('KTL-CONG1','KTL-A1-G')
WHERE vv.purpose LIKE '[demo]%' ON CONFLICT DO NOTHING;

INSERT INTO visitor_visit_events (visit_id, event_type, event_time, zone_id, note)
SELECT vv.id, ev.et, ev.t, (SELECT id FROM zones WHERE zone_code = 'KTL-CONG1'), 'demo_seed'
FROM visitor_visits vv
CROSS JOIN LATERAL (VALUES ('registered', vv.created_at - interval '1 day'),
                           ('approved', vv.approved_at),
                           ('check_in', vv.check_in_at),
                           ('check_out', vv.check_out_at)) ev(et, t)
WHERE vv.purpose LIKE '[demo]%' AND ev.t IS NOT NULL;

-- ============ K. BÁO CÁO: lịch gửi + lịch sử chạy ============
INSERT INTO report_schedules (name, report_type, filters_json, period, frequency, send_time, day_of_week, formats, recipients_json,
                              subject, message, enabled, next_run_at, last_run_at, owner_user_id)
SELECT s.name, s.rtype, '{}'::jsonb, s.period, s.freq, s.tm::time, s.dow, ARRAY['pdf','xlsx'],
       '[{"type":"email","label":"Ban điều hành","value":"banhanh@example.com"}]'::jsonb,
       s.name, 'Báo cáo tự động theo lịch (dữ liệu mẫu)', s.en, now() + interval '8 hours', now() - interval '16 hours',
       (SELECT id FROM users WHERE email='sysadmin@meetingsys.vn')
FROM (VALUES ('[demo] Chuyên cần cán bộ hằng ngày','staff-attendance','yesterday','daily','07:30',NULL::int,true),
             ('[demo] Ra vào khuôn viên hằng tuần','gate-access','last_week','weekly','08:00',1,true),
             ('[demo] Phương tiện hằng tuần','vehicle','last_week','weekly','08:30',1,true),
             ('[demo] Sự kiện an ninh hằng tháng','security-alert','last_month','monthly','09:00',NULL::int,true),
             ('[demo] Khách đến làm việc hằng ngày','visitor','yesterday','daily','07:45',NULL::int,false)) s(name, rtype, period, freq, tm, dow, en);

INSERT INTO report_schedule_runs (schedule_id, schedule_name, report_type, trigger, status, scheduled_for, period_from, period_to, formats,
                                  recipient_count, started_at, finished_at, error_message)
SELECT rs.id, rs.name, rs.report_type, CASE WHEN g % 5 = 0 THEN 'manual' ELSE 'scheduled' END,
       CASE WHEN g = 4 THEN 'failed' ELSE 'success' END,
       now() - (g * interval '1 day'), current_date - g - 1, current_date - g, rs.formats, 2,
       now() - (g * interval '1 day'), now() - (g * interval '1 day') + interval '40 seconds',
       CASE WHEN g = 4 THEN 'Không gửi được email (SMTP chưa cấu hình)' END
FROM report_schedules rs CROSS JOIN generate_series(1, 6) g
WHERE rs.name LIKE '[demo]%';

-- Toạ độ GPS các khu vực (bản đồ khuôn viên)
UPDATE zones z SET latitude = c.lat, longitude = c.lng FROM (VALUES
 ('GATE_MAIN',10.870380,106.777800),('GATE_SIDE',10.869700,106.778600),('KTL-CONG1',10.870450,106.777750),
 ('KTL-CONG2-MOI',10.869900,106.778900),('KTL-CONG2-CU',10.869800,106.778700),('KTL-CONG3',10.869200,106.778100),
 ('KTL-A1-G',10.870100,106.777950),('KTL-A1-1',10.870120,106.777970),('KTL-A2-1',10.870500,106.778300),('KTL-B1-G',10.869600,106.777500)
) c(code, lat, lng) WHERE z.zone_code = c.code;

COMMIT;
