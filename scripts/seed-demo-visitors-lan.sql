-- Khách mẫu cho trang "Khách của tôi" của văn thư Ngô Thị Lan (emp.it2@meetingsys.vn).
-- Chạy lại được: xoá các lượt mã VD-xxxxxx-09xx và thông báo gắn cờ seed rồi tạo lại theo ngày hiện tại.
BEGIN;

DELETE FROM notifications WHERE payload_json->>'seed' = 'visitors_lan';
DELETE FROM visitor_visit_events WHERE visit_id IN (SELECT id FROM visitor_visits WHERE visit_code LIKE 'VD-______-09__');
DELETE FROM visitor_visit_zones WHERE visit_id IN (SELECT id FROM visitor_visits WHERE visit_code LIKE 'VD-______-09__');
DELETE FROM visitor_visits WHERE visit_code LIKE 'VD-______-09__';

-- Tài khoản ẩn cho khách (email @visitor.invalid, không đăng nhập được).
INSERT INTO users (username, email, password_hash, full_name, phone_number, account_status)
SELECT v.u, v.e, '!disabled-visitor', v.n, v.p, 'active'
FROM (VALUES ('khach.leminhkhoa',     'le.minh.khoa@visitor.invalid',      'Lê Minh Khoa',      '0903418265'),
             ('khach.phamthuhang',    'pham.thu.hang@visitor.invalid',     'Phạm Thu Hằng',     '0938552107'),
             ('khach.dangquocbao',    'dang.quoc.bao@visitor.invalid',     'Đặng Quốc Bảo',     '0919736480'),
             ('khach.vothingochan',   'vo.thi.ngoc.han@visitor.invalid',   'Võ Thị Ngọc Hân',   '0976204519'),
             ('khach.nguyenhoanglong','nguyen.hoang.long@visitor.invalid', 'Nguyễn Hoàng Long', '0908663172'),
             ('khach.trinhminhtuan',  'trinh.minh.tuan@visitor.invalid',   'Trịnh Minh Tuấn',   '0945127836'),
             ('khach.buithanhtam',    'bui.thanh.tam@visitor.invalid',     'Bùi Thanh Tâm',     '0987340651')) v(u,e,n,p)
WHERE NOT EXISTS (SELECT 1 FROM users x WHERE lower(x.email) = v.e AND x.deleted_at IS NULL);

INSERT INTO visitors (user_id, full_name, id_number, phone_number, email, organization)
SELECT u.id, u.full_name, v.cccd, u.phone_number, v.mail, v.org
FROM (VALUES ('le.minh.khoa@visitor.invalid',      '079092013584', 'khoa.le@saigondigital.vn',     'Công ty TNHH Giải pháp Số Sài Gòn'),
             ('pham.thu.hang@visitor.invalid',     '001189027461', 'hangpt12@viettel.com.vn',      'Viettel Solutions TP.HCM'),
             ('dang.quoc.bao@visitor.invalid',     '075085006239', 'bao.dq@minhphat-edu.vn',       'Công ty CP Thiết bị Giáo dục Minh Phát'),
             ('vo.thi.ngoc.han@visitor.invalid',   '052190004817', 'vtnhan@hcmut.edu.vn',          'Trường ĐH Bách khoa – ĐHQG-HCM'),
             ('nguyen.hoang.long@visitor.invalid', '079088019552', 'long.nh@cmctelecom.vn',        'CMC Telecom'),
             ('trinh.minh.tuan@visitor.invalid',   '036087002196', 'tuan.tm@aasc.com.vn',          'Công ty TNHH Hãng Kiểm toán AASC'),
             ('bui.thanh.tam@visitor.invalid',     '080179003348', NULL,                           'Phụ huynh sinh viên')) v(e, cccd, mail, org)
JOIN users u ON lower(u.email) = v.e AND u.deleted_at IS NULL
WHERE NOT EXISTS (SELECT 1 FROM visitors x WHERE x.user_id = u.id);

-- d = số ngày lệch so với hôm nay, h/m = giờ hẹn (giờ VN), dur = thời lượng hẹn (phút).
INSERT INTO visitor_visits (visit_code, visitor_id, channel, status, host_user_id, department_id, purpose, companions, plate_number,
                            scheduled_from, scheduled_to, valid_from, valid_to, check_in_at, check_out_at, face_score,
                            reject_reason, last_seen_at, last_seen_zone_id, consent_at, approved_by, approved_at, created_by, created_at)
SELECT 'VD-' || to_char(b.t0 AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYMMDD') || '-09' || lpad(s.n::text, 2, '0'),
       vis.id, s.ch, s.st, lan.id, lan.department_id, s.purpose, s.comp, s.plate,
       b.t0, b.t0 + s.dur * interval '1 minute', b.t0 - interval '30 minutes', b.t0 + (s.dur + 30) * interval '1 minute',
       CASE WHEN s.st IN ('checked_in','checked_out') THEN b.t0 + s.in_off * interval '1 minute' END,
       CASE WHEN s.st = 'checked_out' THEN b.t0 + s.out_off * interval '1 minute' END,
       CASE WHEN s.st IN ('checked_in','checked_out') THEN s.score END,
       CASE WHEN s.st = 'rejected' THEN 'Nội dung thuộc Phòng Công tác sinh viên, đề nghị phụ huynh liên hệ trực tiếp phòng này' END,
       CASE WHEN s.st = 'checked_in' THEN now() - interval '6 minutes' END,
       CASE WHEN s.st = 'checked_in' THEN (SELECT id FROM zones WHERE zone_code = 'KTL-A1-G') END,
       CASE WHEN s.ch = 'online' THEN b.t0 - interval '1 day' END,
       CASE WHEN s.st IN ('approved','checked_in','checked_out') THEN lan.id END,
       CASE WHEN s.st IN ('approved','checked_in','checked_out') THEN b.t0 - interval '20 hours' END,
       CASE WHEN s.ch = 'host_invite' THEN lan.id END,
       b.t0 - interval '1 day'
FROM (VALUES
  (1, 'le.minh.khoa@visitor.invalid',      'online',      'pending_approval',  0, 15, 30,  60, 'Hợp tác doanh nghiệp',   1, NULL,       NULL::int, NULL::int, NULL::numeric),
  (2, 'pham.thu.hang@visitor.invalid',     'online',      'pending_approval',  1,  9,  0,  90, 'Làm việc với đơn vị',    0, NULL,       NULL, NULL, NULL),
  (3, 'dang.quoc.bao@visitor.invalid',     'host_invite', 'approved',          0, 15,  0,  60, 'Nhà thầu - bảo trì',     1, '51H24680', NULL, NULL, NULL),
  (4, 'vo.thi.ngoc.han@visitor.invalid',   'online',      'checked_in',        0, 13, 30, 120, 'Giảng viên thỉnh giảng', 0, NULL,       2,  NULL, 0.93),
  (5, 'nguyen.hoang.long@visitor.invalid', 'host_invite', 'checked_out',      -1,  9,  0,  90, 'Giao nhận hồ sơ',        0, '51F77821', -4, 81,  0.91),
  (6, 'trinh.minh.tuan@visitor.invalid',   'online',      'checked_out',      -4, 14,  0,  90, 'Làm việc với đơn vị',    1, NULL,       5,  108, 0.88),
  (7, 'bui.thanh.tam@visitor.invalid',     'online',      'rejected',         -5, 10,  0,  60, 'Phụ huynh liên hệ',      0, NULL,       NULL, NULL, NULL)
) s(n, email, ch, st, d, h, m, dur, purpose, comp, plate, in_off, out_off, score)
JOIN users vu ON lower(vu.email) = s.email AND vu.deleted_at IS NULL
JOIN visitors vis ON vis.user_id = vu.id
CROSS JOIN (SELECT id, department_id FROM users WHERE email = 'emp.it2@meetingsys.vn') lan
CROSS JOIN LATERAL (SELECT (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + s.d * interval '1 day'
                            + s.h * interval '1 hour' + s.m * interval '1 minute') AT TIME ZONE 'Asia/Ho_Chi_Minh' AS t0) b;

INSERT INTO visitor_visit_zones (visit_id, zone_id)
SELECT vv.id, z.id FROM visitor_visits vv
JOIN zones z ON z.zone_code IN ('KTL-CONG1','KTL-A1-G')
WHERE vv.visit_code LIKE 'VD-______-09__' ON CONFLICT DO NOTHING;

INSERT INTO visitor_visit_events (visit_id, event_type, event_time, zone_id, score, note)
SELECT vv.id, ev.et, ev.t, (SELECT id FROM zones WHERE zone_code = 'KTL-CONG1'), ev.sc, ev.nt
FROM visitor_visits vv
CROSS JOIN LATERAL (VALUES ('registered', vv.created_at, NULL::numeric, NULL::text),
                           ('approved', vv.approved_at, NULL, NULL),
                           ('rejected', CASE WHEN vv.status = 'rejected' THEN vv.created_at + interval '2 hours' END, NULL, vv.reject_reason),
                           ('check_in', vv.check_in_at, vv.face_score, NULL),
                           ('check_out', vv.check_out_at, vv.face_score, NULL)) ev(et, t, sc, nt)
WHERE vv.visit_code LIKE 'VD-______-09__' AND ev.t IS NOT NULL;

-- Thông báo trong ứng dụng cho cô Lan (cùng nội dung VisitorNotifier sinh ra).
INSERT INTO notifications (notification_type, channel, subject, content, related_entity_type, related_entity_id,
                           recipient_scope, recipient_user_ids_json, delivery_status, sent_at, created_at, payload_json)
SELECT n.kind, 'in_app', 'Khách đến làm việc', n.msg, 'visitor_visit', vv.id,
       'user_list', jsonb_build_array(vv.host_user_id), 'sent', n.at, n.at,
       jsonb_build_object('visitId', vv.id, 'code', vv.visit_code, 'kind', n.kind, 'seed', 'visitors_lan')
FROM visitor_visits vv
JOIN visitors v ON v.id = vv.visitor_id
CROSS JOIN LATERAL (VALUES
  ('visitor_pending_approval', v.full_name || ' (' || v.organization || ') xin gặp bạn, đang chờ duyệt',
     CASE WHEN vv.status = 'pending_approval' THEN LEAST(vv.created_at + interval '20 hours', now() - interval '25 minutes') END),
  ('visitor_arrived', v.full_name || ' đã đến khuôn viên', vv.check_in_at),
  ('visitor_left', v.full_name || ' đã rời khuôn viên', vv.check_out_at)
) n(kind, msg, at)
WHERE vv.visit_code LIKE 'VD-______-09__' AND n.at IS NOT NULL;

COMMIT;
