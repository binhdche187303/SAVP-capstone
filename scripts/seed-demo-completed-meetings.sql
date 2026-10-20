-- SEED 3 CUỘC HỌP ĐÃ KẾT THÚC (lịch BGH, chủ trì Hiệu trưởng, thư ký Ngô Thị Lan) cho demo:
--   MT-20261014-901: biên bản AI đã ký duyệt + ban hành
--   MT-20261016-901: biên bản đã trình, CHỜ Hiệu trưởng ký (demo ký / trả lại)
--   MT-20261019-901: biên bản AI nháp, CHƯA TRÌNH (demo thư ký sửa rồi trình ký)
-- Mỗi cuộc có: chương trình, điểm danh đủ loại (có mặt / trễ / về sớm / vắng / vắng có lý do),
-- báo cáo trước họp, bản ghi chữ (STT) gắn tên người nói. Chạy lại được (xóa theo mã rồi tạo lại).
BEGIN;

DELETE FROM meetings WHERE meeting_code IN ('MT-20261014-901', 'MT-20261016-901', 'MT-20261019-901');

CREATE TEMP TABLE _u ON COMMIT DROP AS
SELECT email, id, full_name FROM users
WHERE email IN ('hieutruong@meetingsys.vn', 'emp.it2@meetingsys.vn', 'manager.hc@meetingsys.vn',
                'phohieutruong.dt@meetingsys.vn', 'phohieutruong.cs@meetingsys.vn', 'emp.hr1@meetingsys.vn',
                'emp.sales1@meetingsys.vn', 'emp.it1@meetingsys.vn', 'emp.facility1@meetingsys.vn')
  AND deleted_at IS NULL;

-- Cuộc họp
CREATE TEMP TABLE _m ON COMMIT DROP AS
SELECT v.no, v.code, v.title, v.descr, v.st::timestamptz AS st, v.et::timestamptz AS et, v.room, v.signoff
FROM (VALUES
  (1, 'MT-20261014-901', 'Họp giao ban Ban Giám hiệu tháng 10/2026',
      'Đánh giá công tác tháng 9, triển khai nhiệm vụ trọng tâm tháng 10.',
      '2026-10-14 08:00+07', '2026-10-14 09:30+07', 'A114', 'approved'),
  (2, 'MT-20261016-901', 'Họp triển khai kế hoạch tuyển sinh năm 2027',
      'Thống nhất chỉ tiêu, phương thức xét tuyển và kế hoạch truyền thông tuyển sinh 2027.',
      '2026-10-16 14:00+07', '2026-10-16 15:30+07', 'HTA', 'pending'),
  (3, 'MT-20261019-901', 'Họp rà soát tiến độ chuyển đổi số năm học 2026–2027',
      'Rà soát tiến độ các dự án chuyển đổi số: hệ thống điểm danh AI, số hóa hồ sơ, văn phòng điện tử.',
      '2026-10-19 09:00+07', '2026-10-19 10:30+07', 'A204BIS', NULL)
) v(no, code, title, descr, st, et, room, signoff);

INSERT INTO meetings (meeting_code, title, description, organizer_id, host_id, secretary_id, room_id,
                      status, start_time, end_time, actual_start_time, actual_end_time, expected_attendee_count,
                      calendar_type, attendee_composition, created_by, attendance_enabled,
                      report_required, report_deadline_minutes, report_note,
                      signoff_required, signoff_user_id, signoff_status, signoff_at)
SELECT m.code, m.title, m.descr,
       (SELECT id FROM _u WHERE email = 'emp.it2@meetingsys.vn'),
       (SELECT id FROM _u WHERE email = 'hieutruong@meetingsys.vn'),
       (SELECT id FROM _u WHERE email = 'emp.it2@meetingsys.vn'),
       (SELECT id FROM rooms WHERE room_code = m.room),
       'completed', m.st, m.et, m.st + interval '2 minutes', m.et - interval '5 minutes', 9,
       'SCHOOL_LEADERSHIP', 'Ban Giám hiệu; Trưởng phòng Hành chính; đại diện các phòng CNTT, Nhân sự, Tuyển sinh, Quản trị tài sản',
       (SELECT id FROM _u WHERE email = 'emp.it2@meetingsys.vn'), true,
       true, 60, 'Các đơn vị nộp báo cáo tóm tắt kết quả công tác trước giờ họp 60 phút.',
       true, (SELECT id FROM _u WHERE email = 'hieutruong@meetingsys.vn'), m.signoff,
       CASE WHEN m.signoff = 'approved' THEN m.et + interval '1 day 2 hours' END
FROM _m m;

-- Chương trình làm việc
INSERT INTO meeting_agendas (meeting_id, agenda_order, title, owner_id, planned_duration_minutes, actual_duration_minutes, status, created_by)
SELECT mt.id, a.ord, a.title, (SELECT id FROM _u WHERE email = a.owner), a.dur, a.dur + a.ord - 2, 'done',
       (SELECT id FROM _u WHERE email = 'emp.it2@meetingsys.vn')
FROM (VALUES
  (1, 1, 'Báo cáo kết quả công tác tháng 9', 'manager.hc@meetingsys.vn', 25),
  (1, 2, 'Tình hình đào tạo và học vụ đầu học kỳ', 'phohieutruong.dt@meetingsys.vn', 25),
  (1, 3, 'Kết luận, giao nhiệm vụ tháng 10', 'hieutruong@meetingsys.vn', 20),
  (2, 1, 'Đánh giá kết quả tuyển sinh 2026', 'emp.sales1@meetingsys.vn', 25),
  (2, 2, 'Dự kiến chỉ tiêu và phương thức xét tuyển 2027', 'phohieutruong.dt@meetingsys.vn', 30),
  (2, 3, 'Kế hoạch truyền thông tuyển sinh', 'emp.sales1@meetingsys.vn', 20),
  (3, 1, 'Tiến độ hệ thống điểm danh camera AI', 'emp.it1@meetingsys.vn', 25),
  (3, 2, 'Số hóa hồ sơ nhân sự', 'emp.hr1@meetingsys.vn', 25),
  (3, 3, 'Kết luận và phân công', 'hieutruong@meetingsys.vn', 20)
) a(no, ord, title, owner, dur)
JOIN _m m ON m.no = a.no JOIN meetings mt ON mt.meeting_code = m.code;

-- Thành phần + điểm danh. st: present | late | absent; late = số phút trễ; early = về sớm; excuse = lý do (đã duyệt / chờ duyệt)
CREATE TEMP TABLE _a ON COMMIT DROP AS
SELECT * FROM (VALUES
  (1, 'hieutruong@meetingsys.vn',       'host',     'present', 0,  false, NULL, NULL),
  (1, 'emp.it2@meetingsys.vn',          'attendee', 'present', 0,  false, NULL, NULL),
  (1, 'phohieutruong.dt@meetingsys.vn', 'attendee', 'present', 0,  false, NULL, NULL),
  (1, 'phohieutruong.cs@meetingsys.vn', 'attendee', 'late',    12, false, NULL, NULL),
  (1, 'manager.hc@meetingsys.vn',       'attendee', 'present', 0,  false, NULL, NULL),
  (1, 'emp.hr1@meetingsys.vn',          'attendee', 'absent',  0,  false, 'Đi công tác tại Bộ Giáo dục và Đào tạo theo quyết định của Trường.', 'approved'),
  (1, 'emp.sales1@meetingsys.vn',       'attendee', 'present', 0,  false, NULL, NULL),
  (1, 'emp.it1@meetingsys.vn',          'attendee', 'present', 0,  true,  NULL, NULL),
  (1, 'emp.facility1@meetingsys.vn',    'attendee', 'absent',  0,  false, NULL, NULL),
  (2, 'hieutruong@meetingsys.vn',       'host',     'present', 0,  false, NULL, NULL),
  (2, 'emp.it2@meetingsys.vn',          'attendee', 'present', 0,  false, NULL, NULL),
  (2, 'phohieutruong.dt@meetingsys.vn', 'attendee', 'late',    7,  false, NULL, NULL),
  (2, 'phohieutruong.cs@meetingsys.vn', 'attendee', 'present', 0,  false, NULL, NULL),
  (2, 'manager.hc@meetingsys.vn',       'attendee', 'present', 0,  false, NULL, NULL),
  (2, 'emp.hr1@meetingsys.vn',          'attendee', 'present', 0,  false, NULL, NULL),
  (2, 'emp.sales1@meetingsys.vn',       'attendee', 'present', 0,  false, NULL, NULL),
  (2, 'emp.it1@meetingsys.vn',          'attendee', 'absent',  0,  false, 'Trực sự cố hệ thống mạng khu B trong thời gian họp.', 'pending'),
  (2, 'emp.facility1@meetingsys.vn',    'attendee', 'late',    20, false, NULL, NULL),
  (3, 'hieutruong@meetingsys.vn',       'host',     'present', 0,  false, NULL, NULL),
  (3, 'emp.it2@meetingsys.vn',          'attendee', 'present', 0,  false, NULL, NULL),
  (3, 'phohieutruong.dt@meetingsys.vn', 'attendee', 'absent',  0,  false, 'Chủ trì Hội đồng chấm luận văn thạc sĩ cùng thời điểm.', 'approved'),
  (3, 'phohieutruong.cs@meetingsys.vn', 'attendee', 'present', 0,  false, NULL, NULL),
  (3, 'manager.hc@meetingsys.vn',       'attendee', 'late',    5,  false, NULL, NULL),
  (3, 'emp.hr1@meetingsys.vn',          'attendee', 'present', 0,  false, NULL, NULL),
  (3, 'emp.sales1@meetingsys.vn',       'attendee', 'present', 0,  true,  NULL, NULL),
  (3, 'emp.it1@meetingsys.vn',          'attendee', 'present', 0,  false, NULL, NULL),
  (3, 'emp.facility1@meetingsys.vn',    'attendee', 'absent',  0,  false, NULL, NULL)
) v(no, email, prole, st, late, early, excuse, excuse_st);

INSERT INTO meeting_participants (meeting_id, user_id, participant_role, invitation_status, response_at,
                                  attendance_status, joined_at, left_at, invited_by,
                                  excuse_reason, excuse_status, excuse_submitted_at, excuse_reviewed_by, excuse_reviewed_at)
SELECT mt.id, u.id, a.prole, 'accepted', m.st - interval '3 days',
       a.st,
       CASE WHEN a.st <> 'absent' THEN mt.actual_start_time + make_interval(mins => a.late) - interval '3 minutes' END,
       CASE WHEN a.st <> 'absent' THEN CASE WHEN a.early THEN m.et - interval '35 minutes' ELSE mt.actual_end_time END END,
       mt.organizer_id,
       a.excuse, a.excuse_st,
       CASE WHEN a.excuse IS NOT NULL THEN m.st - interval '1 day' END,
       CASE WHEN a.excuse_st = 'approved' THEN mt.host_id END,
       CASE WHEN a.excuse_st = 'approved' THEN m.st - interval '20 hours' END
FROM _a a JOIN _m m ON m.no = a.no JOIN meetings mt ON mt.meeting_code = m.code JOIN _u u ON u.email = a.email;

INSERT INTO attendance_records (meeting_id, participant_id, user_id, check_in_method, attendance_source,
                                check_in_time, check_out_time, first_detected_at, last_detected_at,
                                is_present, is_late, left_early, late_minutes, presence_duration_minutes,
                                confidence_score, attendance_status, verified_by, verified_at, note)
SELECT mp.meeting_id, mp.id, mp.user_id,
       CASE WHEN a.st = 'absent' THEN 'system' WHEN a.email = 'emp.facility1@meetingsys.vn' THEN 'manual' ELSE 'door_camera' END,
       CASE WHEN a.st <> 'absent' AND a.email = 'emp.facility1@meetingsys.vn' THEN 'manual' ELSE 'camera' END,
       mp.joined_at, mp.left_at, mp.joined_at, mp.left_at,
       a.st <> 'absent', a.st = 'late', a.early, NULLIF(a.late, 0),
       CASE WHEN a.st <> 'absent' THEN (EXTRACT(EPOCH FROM mp.left_at - mp.joined_at) / 60)::int END,
       CASE WHEN a.st = 'absent' OR a.email = 'emp.facility1@meetingsys.vn' THEN NULL ELSE 93.5 + (length(a.email) % 6) END,
       a.st, mt.secretary_id, mt.actual_end_time,
       CASE WHEN a.email = 'emp.facility1@meetingsys.vn' AND a.st <> 'absent' THEN 'Thư ký điểm danh thủ công (camera không nhận diện được do đeo khẩu trang).'
            WHEN a.early THEN 'Xin phép về sớm để xử lý công việc đột xuất.' END
FROM _a a JOIN _m m ON m.no = a.no JOIN meetings mt ON mt.meeting_code = m.code
JOIN _u u ON u.email = a.email JOIN meeting_participants mp ON mp.meeting_id = mt.id AND mp.user_id = u.id;

-- Báo cáo trước họp: đa số nộp đúng hạn, 1 người nộp trễ, 1–2 người chưa nộp
INSERT INTO meeting_report_submissions (meeting_id, user_id, submitted_at, reminded_at)
SELECT mt.id, u.id,
       CASE WHEN a.email IN ('emp.facility1@meetingsys.vn') THEN NULL
            WHEN a.email = 'emp.sales1@meetingsys.vn' AND a.no = 1 THEN m.st - interval '40 minutes'
            ELSE m.st - interval '1 day' + make_interval(mins => length(a.email) * 7) END,
       CASE WHEN a.email IN ('emp.facility1@meetingsys.vn', 'emp.sales1@meetingsys.vn') THEN m.st - interval '2 hours' END
FROM _a a JOIN _m m ON m.no = a.no JOIN meetings mt ON mt.meeting_code = m.code JOIN _u u ON u.email = a.email
WHERE a.prole <> 'host' AND a.email <> 'emp.it2@meetingsys.vn' AND NOT (a.st = 'absent' AND a.excuse IS NOT NULL);

-- Bản ghi chữ (STT): mỗi đoạn gắn người nói
CREATE TEMP TABLE _s ON COMMIT DROP AS
SELECT * FROM (VALUES
  (1, 1, 'hieutruong@meetingsys.vn', 'Xin chào các đồng chí. Hôm nay chúng ta họp giao ban tháng 10, đề nghị đồng chí Thanh Hà báo cáo kết quả công tác tháng 9.'),
  (1, 2, 'manager.hc@meetingsys.vn', 'Trong tháng 9, Phòng Hành chính đã tiếp nhận 312 văn bản đến, ban hành 145 văn bản đi, tổ chức 28 cuộc họp cấp trường. Tỷ lệ văn bản xử lý đúng hạn đạt 96 phần trăm.'),
  (1, 3, 'manager.hc@meetingsys.vn', 'Tồn tại là còn 12 văn bản xử lý trễ hạn, chủ yếu ở khâu lấy ý kiến các đơn vị.'),
  (1, 4, 'phohieutruong.dt@meetingsys.vn', 'Về đào tạo, học kỳ 1 đã khai giảng đúng kế hoạch với 412 lớp học phần. Tỷ lệ sinh viên đi học đầy đủ tuần đầu đạt 91 phần trăm theo dữ liệu điểm danh camera.'),
  (1, 5, 'phohieutruong.cs@meetingsys.vn', 'Tôi xin bổ sung, khu B còn 3 phòng học chưa lắp xong camera điểm danh, dự kiến hoàn thành trước ngày 25 tháng 10.'),
  (1, 6, 'emp.sales1@meetingsys.vn', 'Phòng Tuyển sinh đã hoàn tất nhập học cho 3.850 tân sinh viên, đạt 102 phần trăm chỉ tiêu.'),
  (1, 7, 'hieutruong@meetingsys.vn', 'Tôi kết luận: Phòng Hành chính rà soát 12 văn bản trễ hạn, báo cáo trước ngày 20 tháng 10. Phòng Quản trị tài sản hoàn thành lắp camera khu B trước ngày 25 tháng 10.'),
  (2, 1, 'hieutruong@meetingsys.vn', 'Hôm nay chúng ta bàn kế hoạch tuyển sinh năm 2027. Mời Phòng Tuyển sinh báo cáo kết quả năm 2026.'),
  (2, 2, 'emp.sales1@meetingsys.vn', 'Năm 2026 Trường tuyển được 3.850 sinh viên trên chỉ tiêu 3.780. Phương thức xét điểm thi tốt nghiệp chiếm 48 phần trăm, xét học bạ 22 phần trăm, đánh giá năng lực 30 phần trăm.'),
  (2, 3, 'phohieutruong.dt@meetingsys.vn', 'Đề xuất năm 2027 giữ tổng chỉ tiêu 3.900, tăng chỉ tiêu ngành Khoa học dữ liệu và Hệ thống thông tin quản lý thêm 60 sinh viên mỗi ngành.'),
  (2, 4, 'manager.hc@meetingsys.vn', 'Phòng Hành chính đề nghị chốt lịch các buổi tư vấn tuyển sinh sớm để bố trí hội trường và xe đưa đón.'),
  (2, 5, 'emp.facility1@meetingsys.vn', 'Xin lỗi tôi đến muộn. Phòng Quản trị tài sản đã sẵn sàng Hội trường A cho các buổi tư vấn từ tháng 3.'),
  (2, 6, 'hieutruong@meetingsys.vn', 'Thống nhất tổng chỉ tiêu 3.900. Phòng Tuyển sinh hoàn thiện đề án tuyển sinh, trình Ban Giám hiệu trước ngày 15 tháng 11.'),
  (3, 1, 'hieutruong@meetingsys.vn', 'Chúng ta rà soát tiến độ chuyển đổi số. Mời Phòng Công nghệ thông tin báo cáo hệ thống điểm danh camera AI.'),
  (3, 2, 'emp.it1@meetingsys.vn', 'Hệ thống đã triển khai tại 7 phòng họp và 4 lớp học thí điểm. Độ chính xác nhận diện khuôn mặt đạt 97 phần trăm, còn 6 cán bộ chưa đăng ký khuôn mặt.'),
  (3, 3, 'emp.hr1@meetingsys.vn', 'Phòng Nhân sự đã số hóa 640 trên 820 hồ sơ cán bộ, đạt 78 phần trăm. Dự kiến hoàn thành trong tháng 11.'),
  (3, 4, 'manager.hc@meetingsys.vn', 'Đề nghị Phòng Công nghệ thông tin hỗ trợ kết nối hệ thống văn phòng điện tử với lịch họp để giảm nhập liệu.'),
  (3, 5, 'phohieutruong.cs@meetingsys.vn', 'Tôi đề nghị bổ sung kinh phí mua thêm 12 camera cho khu C trong kế hoạch năm 2027.'),
  (3, 6, 'hieutruong@meetingsys.vn', 'Kết luận: hoàn thành đăng ký khuôn mặt cho toàn bộ cán bộ trước ngày 31 tháng 10. Phòng Công nghệ thông tin lập đề án kết nối văn phòng điện tử, báo cáo trong tháng 11.')
) v(no, ord, email, txt);

INSERT INTO transcripts (meeting_id, version_no, language_code, raw_text, cleaned_text,
                         speaker_segments_json, detected_speakers_json, security_status, confidence_score, status,
                         edited_by, edited_at, created_at)
SELECT mt.id, 1, 'vi',
       string_agg(s.txt, ' ' ORDER BY s.ord),
       string_agg(u.full_name || ': ' || s.txt, E'\n' ORDER BY s.ord),
       jsonb_build_object('languageCode', 'vi', 'manualReviewRequired', false, 'manualReviewSegmentCount', 0, 'warnings', '[]'::jsonb,
         'segments', jsonb_agg(jsonb_build_object(
           'segmentId', 'seg-' || m.no || '-' || s.ord,
           'startMs', (s.ord - 1) * 95000 + 4000, 'endMs', (s.ord - 1) * 95000 + 4000 + 25000 + length(s.txt) * 180,
           'text', s.txt, 'speakerLabel', 'Speaker_' || s.email, 'speakerSource', 'pyannote',
           'userId', u.id, 'displayName', u.full_name, 'channelId', NULL, 'roomZoneLabel', NULL,
           'sttConfidence', 0.94, 'diarizationConfidence', 0.9, 'separationConfidence', NULL, 'finalConfidence', 0.92,
           'overlap', false, 'lowConfidence', false, 'manualReviewRequired', false, 'notes', '[]'::jsonb) ORDER BY s.ord)),
       jsonb_build_object('speakers', (SELECT jsonb_agg(DISTINCT jsonb_build_object(
           'speakerLabel', 'Speaker_' || s2.email, 'mappedUserId', u2.id, 'displayName', u2.full_name,
           'mappingSource', 'manual', 'confidence', 0.95))
         FROM _s s2 JOIN _u u2 ON u2.email = s2.email WHERE s2.no = m.no)),
       'safe', 92.40, CASE WHEN m.no = 3 THEN 'draft' ELSE 'reviewed' END,
       mt.secretary_id, mt.actual_end_time + interval '3 hours', mt.actual_end_time + interval '20 minutes'
FROM _s s JOIN _m m ON m.no = s.no JOIN meetings mt ON mt.meeting_code = m.code JOIN _u u ON u.email = s.email
GROUP BY mt.id, m.no, mt.secretary_id, mt.actual_end_time;

-- Biên bản AI
INSERT INTO meeting_minutes (meeting_id, title, version_no, status, visibility_level, source, content_format,
                             minutes_content, decisions_json, action_items_json, ai_summary_json, attendees_snapshot_json,
                             linked_transcript_id, prepared_by, issued_by, issued_at, approved_by, approved_at, created_at, updated_at)
SELECT mt.id, 'Biên bản họp: ' || mt.title, CASE WHEN m.no = 3 THEN 1 ELSE 2 END,
       CASE WHEN m.no = 1 THEN 'published' ELSE 'draft' END,
       CASE WHEN m.no = 1 THEN 'participants' ELSE 'private' END,
       'ai', 'template', b.content, b.decisions::jsonb, b.actions::jsonb,
       jsonb_build_object('keyPoints', b.keypoints::jsonb, 'risks', b.risks::jsonb, 'openQuestions', '[]'::jsonb, 'uncertainParts', '[]'::jsonb,
         'meta', jsonb_build_object('provider', 'gemini', 'modelName', 'gemini-2.5-flash', 'promptVersion', 'v1',
                                    'generatedAt', to_char(mt.actual_end_time + interval '40 minutes', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
       (SELECT jsonb_agg(jsonb_build_object('userId', mp.user_id, 'participantRole', mp.participant_role,
                'attendanceStatus', mp.attendance_status, 'joinedAt', mp.joined_at, 'leftAt', mp.left_at))
          FROM meeting_participants mp WHERE mp.meeting_id = mt.id),
       (SELECT id FROM transcripts t WHERE t.meeting_id = mt.id LIMIT 1), mt.secretary_id,
       CASE WHEN m.no = 1 THEN mt.host_id END, CASE WHEN m.no = 1 THEN mt.end_time + interval '1 day 2 hours' END,
       CASE WHEN m.no = 1 THEN mt.host_id END, CASE WHEN m.no = 1 THEN mt.end_time + interval '1 day 2 hours' END,
       mt.actual_end_time + interval '40 minutes', mt.actual_end_time + interval '5 hours'
FROM _m m JOIN meetings mt ON mt.meeting_code = m.code
JOIN (VALUES
  (1, '<p><strong>1. Thành phần tham dự:</strong> Hiệu trưởng Nguyễn Văn Phúc (chủ trì), các Phó Hiệu trưởng, Trưởng phòng Hành chính và đại diện các phòng CNTT, Nhân sự, Tuyển sinh, Quản trị tài sản. Vắng: Hoang Thi Mai (có lý do), Dinh Van Hung.</p><p><strong>2. Nội dung:</strong> Phòng Hành chính báo cáo tháng 9 tiếp nhận 312 văn bản đến, ban hành 145 văn bản đi, tổ chức 28 cuộc họp cấp trường; tỷ lệ xử lý đúng hạn 96%, còn 12 văn bản trễ hạn. Học kỳ 1 khai giảng đúng kế hoạch với 412 lớp học phần, tỷ lệ đi học đầy đủ tuần đầu 91%. Tuyển sinh 2026 đạt 3.850 sinh viên (102% chỉ tiêu). Khu B còn 3 phòng chưa lắp camera điểm danh.</p><p><strong>3. Kết luận:</strong> Giao Phòng Hành chính rà soát văn bản trễ hạn; Phòng Quản trị tài sản hoàn thành lắp camera khu B.</p>',
      '[{"text":"Phòng Hành chính rà soát 12 văn bản xử lý trễ hạn và báo cáo nguyên nhân","confidence":"high","evidence":"Phòng Hành chính rà soát 12 văn bản trễ hạn, báo cáo trước ngày 20 tháng 10"},{"text":"Hoàn thành lắp camera điểm danh 3 phòng học khu B","confidence":"high","evidence":"Phòng Quản trị tài sản hoàn thành lắp camera khu B trước ngày 25 tháng 10"}]',
      '[{"task":"Rà soát, báo cáo 12 văn bản trễ hạn","owner":"Trần Thị Thanh Hà","deadline":"20/10/2026","confidence":"high"},{"task":"Lắp camera điểm danh 3 phòng khu B","owner":"Phòng Quản trị tài sản","deadline":"25/10/2026","confidence":"high"}]',
      '["Tỷ lệ xử lý văn bản đúng hạn tháng 9 đạt 96%","Học kỳ 1 khai giảng đúng kế hoạch, 412 lớp học phần","Tuyển sinh 2026 đạt 102% chỉ tiêu"]',
      '["12 văn bản trễ hạn ở khâu lấy ý kiến đơn vị"]'),
  (2, '<p><strong>1. Thành phần tham dự:</strong> Hiệu trưởng Nguyễn Văn Phúc (chủ trì), các Phó Hiệu trưởng, Trưởng phòng Hành chính, đại diện các phòng. Đến muộn: Lê Thị Minh Châu (7 phút), Dinh Van Hung (20 phút). Vắng: Bui Van Long (lý do chờ duyệt).</p><p><strong>2. Nội dung:</strong> Năm 2026 tuyển 3.850 sinh viên trên chỉ tiêu 3.780; cơ cấu phương thức: điểm thi tốt nghiệp 48%, học bạ 22%, đánh giá năng lực 30%. Đề xuất năm 2027 tổng chỉ tiêu 3.900, tăng 60 chỉ tiêu mỗi ngành Khoa học dữ liệu và Hệ thống thông tin quản lý. Hội trường A sẵn sàng cho tư vấn tuyển sinh từ tháng 3.</p><p><strong>3. Kết luận:</strong> Thống nhất tổng chỉ tiêu 3.900; Phòng Tuyển sinh hoàn thiện đề án tuyển sinh 2027.</p>',
      '[{"text":"Thống nhất tổng chỉ tiêu tuyển sinh năm 2027 là 3.900","confidence":"high","evidence":"Thống nhất tổng chỉ tiêu 3.900"}]',
      '[{"task":"Hoàn thiện đề án tuyển sinh 2027 trình Ban Giám hiệu","owner":"Phòng Tuyển sinh & Công tác sinh viên","deadline":"15/11/2026","confidence":"high"},{"task":"Chốt lịch tư vấn tuyển sinh, bố trí hội trường và xe","owner":"Trần Thị Thanh Hà","deadline":"30/11/2026","confidence":"medium"}]',
      '["Tuyển sinh 2026 vượt chỉ tiêu 70 sinh viên","Đề xuất tăng chỉ tiêu ngành Khoa học dữ liệu và HTTTQL"]',
      '[]'),
  (3, '<p><strong>1. Thành phần tham dự:</strong> Hiệu trưởng Nguyễn Văn Phúc (chủ trì), Phó Hiệu trưởng Trần Quang Vinh, Trưởng phòng Hành chính và đại diện các phòng. Vắng: Lê Thị Minh Châu (có lý do), Dinh Van Hung.</p><p><strong>2. Nội dung:</strong> Hệ thống điểm danh camera AI đã triển khai tại 7 phòng họp và 4 lớp học thí điểm, độ chính xác 97%, còn 6 cán bộ chưa đăng ký khuôn mặt. Số hóa hồ sơ nhân sự đạt 640/820 hồ sơ (78%). Đề xuất kết nối văn phòng điện tử với lịch họp và bổ sung 12 camera khu C vào kế hoạch 2027.</p><p><strong>3. Kết luận:</strong> Hoàn thành đăng ký khuôn mặt toàn bộ cán bộ; Phòng CNTT lập đề án kết nối văn phòng điện tử.</p>',
      '[{"text":"Toàn bộ cán bộ hoàn thành đăng ký khuôn mặt","confidence":"high","evidence":"hoàn thành đăng ký khuôn mặt cho toàn bộ cán bộ trước ngày 31 tháng 10"},{"text":"Lập đề án kết nối văn phòng điện tử với lịch họp","confidence":"medium","evidence":"Phòng Công nghệ thông tin lập đề án kết nối văn phòng điện tử, báo cáo trong tháng 11"}]',
      '[{"task":"Hoàn thành đăng ký khuôn mặt cho 6 cán bộ còn lại","owner":"Bui Van Long","deadline":"31/10/2026","confidence":"high"},{"task":"Hoàn thành số hóa hồ sơ nhân sự","owner":"Hoang Thi Mai","deadline":"30/11/2026","confidence":"medium"},{"task":"Đề án kết nối văn phòng điện tử với lịch họp","owner":"Phòng Công nghệ thông tin","deadline":"30/11/2026","confidence":"medium"}]',
      '["Điểm danh AI đạt độ chính xác 97% tại 11 phòng thí điểm","Số hóa hồ sơ nhân sự đạt 78%"]',
      '["Kinh phí 12 camera khu C chưa có trong kế hoạch"]')
) b(no, content, decisions, actions, keypoints, risks) ON b.no = m.no;

UPDATE meetings mt SET signoff_minutes_id = mm.id
FROM meeting_minutes mm
WHERE mm.meeting_id = mt.id AND mt.meeting_code IN ('MT-20261014-901', 'MT-20261016-901');

INSERT INTO meeting_signoff_logs (meeting_id, minutes_id, action, actor_id, note, created_at)
SELECT mt.id, mt.signoff_minutes_id, l.action, CASE WHEN l.action = 'submitted' THEN mt.secretary_id ELSE mt.host_id END, l.note,
       mt.end_time + l.after::interval
FROM meetings mt
JOIN (VALUES ('MT-20261014-901', 'submitted', NULL, '1 day'),
             ('MT-20261014-901', 'approved', 'Đồng ý nội dung biên bản.', '1 day 2 hours'),
             ('MT-20261016-901', 'submitted', NULL, '20 hours')) l(code, action, note, after)
  ON l.code = mt.meeting_code;

-- Job STT đã hoàn tất cho từng cuộc họp (TranscriptViewer chỉ tải transcript khi có job transcription completed)
DELETE FROM background_jobs WHERE job_type = 'transcription' AND related_entity_type = 'meeting'
  AND related_entity_id IN (SELECT id FROM meetings WHERE meeting_code IN ('MT-20261014-901','MT-20261016-901','MT-20261019-901'));
WITH j AS (
  INSERT INTO background_jobs (job_type, related_entity_type, related_entity_id, requested_by, queue_name, status,
                               started_at, completed_at, input_json, output_json)
  SELECT 'transcription', 'meeting', m.id, m.created_by, 'transcription', 'completed',
         m.actual_end_time + interval '2 minutes', m.actual_end_time + interval '9 minutes',
         jsonb_build_object('meetingId', m.id), jsonb_build_object('transcriptId', t.id)
  FROM meetings m JOIN transcripts t ON t.meeting_id = m.id
  WHERE m.meeting_code IN ('MT-20261014-901','MT-20261016-901','MT-20261019-901')
  RETURNING id, related_entity_id
)
UPDATE transcripts t SET background_job_id = j.id FROM j WHERE t.meeting_id = j.related_entity_id;

-- Sự kiện camera vào/ra (tab "Thời lượng tham dự" dựng phiên có mặt từ ivss_face_event enter/leave đã khớp)
DELETE FROM iot_device_events WHERE event_type = 'ivss_face_event'
  AND meeting_id IN (SELECT id FROM meetings WHERE meeting_code IN ('MT-20261014-901','MT-20261016-901','MT-20261019-901'));
WITH a AS (
  SELECT ar.meeting_id, ar.user_id, m.room_id, ar.check_in_time AS tin, ar.check_out_time AS tout,
         COALESCE((SELECT d.id FROM iot_devices d WHERE d.room_id = m.room_id LIMIT 1),
                  (SELECT d.id FROM iot_devices d WHERE d.device_type = 'ip_camera' ORDER BY d.room_id NULLS LAST LIMIT 1)) AS device_id,
         row_number() OVER (PARTITION BY ar.meeting_id ORDER BY ar.check_in_time, ar.user_id) AS rn
  FROM attendance_records ar JOIN meetings m ON m.id = ar.meeting_id
  WHERE m.meeting_code IN ('MT-20261014-901','MT-20261016-901','MT-20261019-901') AND ar.check_in_time IS NOT NULL
), ev AS (
  SELECT a.*, 'enter' AS dir, a.tin AS t FROM a
  UNION ALL SELECT a.*, 'leave', a.tout FROM a WHERE a.tout IS NOT NULL
  -- người thứ 3 mỗi cuộc họp ra ngoài nghe điện thoại ~8 phút giữa buổi
  UNION ALL SELECT a.*, 'leave', a.tin + interval '38 minutes' FROM a WHERE a.rn = 3
  UNION ALL SELECT a.*, 'enter', a.tin + interval '46 minutes' FROM a WHERE a.rn = 3
)
INSERT INTO iot_device_events (device_id, room_id, meeting_id, event_type, event_time, source_protocol, payload_json, processed_status)
SELECT ev.device_id, ev.room_id, ev.meeting_id, 'ivss_face_event', ev.t, 'http',
       jsonb_build_object('direction', ev.dir, 'userId', ev.user_id, 'matchState', 'matched',
                          'similarity', round((0.86 + random() * 0.12)::numeric, 3)),
       'processed'
FROM ev;

-- Gắn lại file báo cáo .docx (uploads/meeting-reports, tên Bao_cao_<đơn vị>_<yyyymmdd>.docx) vào cuộc họp vừa tạo lại
UPDATE media_files mf SET meeting_id = m.id, related_entity_id = m.id
FROM meetings m
WHERE mf.related_entity_type = 'meeting_report' AND mf.file_name LIKE 'Bao\_cao\_%'
  AND m.meeting_code = 'MT-' || substring(mf.file_name from '(\d{8})\.docx$') || '-901' AND m.deleted_at IS NULL;
UPDATE meeting_report_submissions s SET media_file_id = mf.id
FROM media_files mf, meetings m
WHERE m.id = s.meeting_id AND m.meeting_code IN ('MT-20261014-901','MT-20261016-901','MT-20261019-901')
  AND s.submitted_at IS NOT NULL AND mf.meeting_id = s.meeting_id AND mf.uploaded_by = s.user_id
  AND mf.related_entity_type = 'meeting_report' AND mf.file_name LIKE 'Bao\_cao\_%';

COMMIT;
