-- Xoá trắng dữ liệu, GIỮ: users, user_roles, roles, permissions, role_permissions, system_configs,
-- typeorm_migrations và camera mock KTL (zones/iot_devices/camera_groups mã "KTL-").
BEGIN;

-- 1) Bảng giữ một phần / bị bảng giữ tham chiếu ⇒ DELETE (TRUNCATE sẽ lỗi FK hoặc CASCADE sang users).
UPDATE users SET department_id = NULL;
CREATE TEMP TABLE keep_tbl(t text) ON COMMIT DROP;
INSERT INTO keep_tbl VALUES ('users'),('user_roles'),('roles'),('permissions'),('role_permissions'),
  ('system_configs'),('typeorm_migrations'),('zones'),('iot_devices'),('camera_groups'),('camera_group_members');

-- 2) TRUNCATE mọi bảng còn lại không bị bảng giữ tham chiếu.
DO $$
DECLARE lst text;
BEGIN
  SELECT string_agg(format('%I', c.relname), ', ') INTO lst
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind = 'r'
    AND c.relname NOT IN (SELECT t FROM keep_tbl)
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint f JOIN pg_class k ON k.oid = f.conrelid
      WHERE f.contype = 'f' AND f.confrelid = c.oid AND k.relname IN (SELECT t FROM keep_tbl));
  RAISE NOTICE 'TRUNCATE: %', lst;
  EXECUTE 'TRUNCATE ' || lst;
END $$;

-- 3) Phần giữ một phần.
DELETE FROM camera_group_members m USING camera_groups g
  WHERE g.id = m.group_id AND g.group_code NOT LIKE 'KTL-%';
DELETE FROM camera_group_members m USING iot_devices d
  WHERE d.id = m.device_id AND COALESCE(d.metadata_json->>'mock_ktl', '') <> 'true';
DELETE FROM camera_groups WHERE group_code NOT LIKE 'KTL-%';
DELETE FROM iot_devices WHERE COALESCE(metadata_json->>'mock_ktl', '') <> 'true';
DELETE FROM zones WHERE COALESCE(metadata_json->>'mock_ktl', '') <> 'true';

-- 4) Bảng còn lại bị bảng giữ tham chiếu (vd. departments, rooms, equipments) ⇒ DELETE (FK SET NULL).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname NOT IN (SELECT t FROM keep_tbl)
      AND EXISTS (SELECT 1 FROM pg_constraint f JOIN pg_class k ON k.oid = f.conrelid
                  WHERE f.contype = 'f' AND f.confrelid = c.oid AND k.relname IN (SELECT t FROM keep_tbl))
  LOOP
    RAISE NOTICE 'DELETE: %', r.relname;
    EXECUTE format('DELETE FROM %I', r.relname);
  END LOOP;
END $$;

COMMIT;
