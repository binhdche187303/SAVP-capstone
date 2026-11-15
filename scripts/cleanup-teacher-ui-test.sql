-- =====================================================================
-- cleanup-teacher-ui-test.sql  (2026-11-13)
-- Removes ALL mock data created by scripts/seed-teacher-ui-test.sql
-- and scripts/seed-teacher-ui-test-extra.sql (equipments + visitors).
-- Run:  bash /tmp/q.sh -v ON_ERROR_STOP=1 -f - < scripts/cleanup-teacher-ui-test.sql
-- Take a pg_dump first.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;
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
-- extra seed: khách + thiết bị + cuộc họp
DELETE FROM visitor_visits WHERE visit_code LIKE 'UIT-VD-%';
DELETE FROM visitors WHERE user_id IN (SELECT id FROM users WHERE email LIKE 'uitest.k%@uitest.local');
DELETE FROM users WHERE email LIKE 'uitest.k%@uitest.local';
DELETE FROM equipments WHERE equipment_code LIKE 'UIT-EQ-%';
DELETE FROM meetings WHERE meeting_code LIKE 'UIT-MT-%';
DROP TABLE _uit_cls; DROP TABLE _uit_sv;
COMMIT;
