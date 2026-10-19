-- MOCK DEMO: camera theo "Bản vẽ vị trí Camera - KTL - Final" (đếm thủ công, chưa có IP/kênh thật).
-- Mọi bản ghi gắn nhãn: zone_code/device_code/group_code bắt đầu "KTL-", metadata_json.mock_ktl = true.
-- Xoá: chạy phần ROLLBACK ở cuối file.
BEGIN;

CREATE TEMP TABLE ktl_plan (zone_code text, zone_name text, zone_type text, building text, floor text,
                            n_ai int, n_sec int, note text) ON COMMIT DROP;
INSERT INTO ktl_plan VALUES
  ('KTL-CONG1',     'Cổng 1',             'gate',     'Campus', 'G', 0, 3, 'Ảnh Cổng 1: 03 camera IP'),
  ('KTL-CONG2-MOI', 'Cổng 2 mới',         'gate',     'Campus', 'G', 0, 4, 'Ảnh Cổng 2 mới: 04 camera IP'),
  ('KTL-CONG2-CU',  'Cổng 2 hiện hữu',    'gate',     'Campus', 'G', 0, 3, 'Ảnh Cổng 2.1: 03 camera IP (ảnh 2.2 có thêm khung — cần xác nhận)'),
  ('KTL-CONG3',     'Cổng 3',             'gate',     'Campus', 'G', 2, 2, 'Ảnh Cổng 3: 02 camera AI mới + 02 hiện hữu'),
  ('KTL-A2-G',      'Hội trường - Sảnh',  'lobby',    'KTL.A2', 'G', 2, 2, 'PDF Hội trường'),
  ('KTL-A1-G',      'A1 - Tầng trệt',     'lobby',    'KTL.A1', 'G', 8, 4, 'PDF A1 tầng G + 1 (chia tầng ước lượng)'),
  ('KTL-A1-1',      'A1 - Lầu 1',         'corridor', 'KTL.A1', '1', 7, 4, 'PDF A1 tầng G + 1 (chia tầng ước lượng)'),
  ('KTL-B1-G',      'B1 - Tầng trệt',     'lobby',    'KTL.B1', 'G', 2, 3, 'PDF B1 tầng G');

INSERT INTO zones (zone_code, zone_name, zone_type, building, floor, description, metadata_json)
SELECT zone_code, zone_name, zone_type, building, floor, 'MOCK theo bản vẽ KTL - ' || note,
       jsonb_build_object('mock_ktl', true)
FROM ktl_plan;

-- Camera: AI = ip_camera thường; an ninh = provider IVSS (UI xếp loại "an ninh").
INSERT INTO iot_devices (device_code, device_name, device_type, zone_id, status, health_status, last_seen_at, metadata_json)
SELECT format('%s-%s%s', p.zone_code, k.tag, lpad(g::text, 2, '0')),
       format('%s · %s %s', p.zone_name, k.label, g),
       'ip_camera', z.id, 'online', 'healthy', now(),
       jsonb_build_object('mock_ktl', true, 'camera_kind', k.kind, 'source', 'mock-ktl-drawing')
         || CASE WHEN k.kind = 'sec' THEN '{"provider":"IVSS"}'::jsonb ELSE '{}'::jsonb END
FROM ktl_plan p
JOIN zones z ON z.zone_code = p.zone_code AND z.deleted_at IS NULL
CROSS JOIN LATERAL (VALUES ('ai', 'AI', 'Camera AI', p.n_ai), ('sec', 'AN', 'Camera an ninh', p.n_sec)) k(kind, tag, label, n)
CROSS JOIN LATERAL generate_series(1, k.n) g;

-- 2 camera offline cho demo trạng thái.
UPDATE iot_devices SET status = 'offline', health_status = 'unknown', last_seen_at = now() - interval '3 hours'
WHERE device_code IN ('KTL-A1-1-AN04', 'KTL-CONG2-CU-AN03');

-- Nhóm: theo khu vực + theo loại.
INSERT INTO camera_groups (group_code, group_name, description)
SELECT 'KTL-G-' || substr(zone_code, 5), 'Khu ' || zone_name, 'MOCK theo bản vẽ KTL' FROM ktl_plan
UNION ALL SELECT 'KTL-G-AI',  'Toàn bộ camera AI',      'MOCK theo bản vẽ KTL'
UNION ALL SELECT 'KTL-G-SEC', 'Toàn bộ camera an ninh', 'MOCK theo bản vẽ KTL'
UNION ALL SELECT 'KTL-G-GATES', 'Camera các cổng',      'MOCK theo bản vẽ KTL';

INSERT INTO camera_group_members (group_id, device_id)
SELECT g.id, d.id FROM iot_devices d
JOIN zones z ON z.id = d.zone_id
JOIN camera_groups g ON g.group_code = 'KTL-G-' || substr(z.zone_code, 5)
WHERE d.metadata_json->>'mock_ktl' = 'true'
UNION ALL
SELECT g.id, d.id FROM iot_devices d
JOIN camera_groups g ON g.group_code = CASE d.metadata_json->>'camera_kind' WHEN 'ai' THEN 'KTL-G-AI' ELSE 'KTL-G-SEC' END
WHERE d.metadata_json->>'mock_ktl' = 'true'
UNION ALL
SELECT g.id, d.id FROM iot_devices d
JOIN zones z ON z.id = d.zone_id AND z.zone_type = 'gate'
JOIN camera_groups g ON g.group_code = 'KTL-G-GATES'
WHERE d.metadata_json->>'mock_ktl' = 'true';

COMMIT;

-- ROLLBACK (xoá toàn bộ mock):
-- DELETE FROM camera_groups WHERE group_code LIKE 'KTL-G-%';
-- DELETE FROM iot_devices WHERE metadata_json->>'mock_ktl' = 'true';
-- DELETE FROM zones WHERE metadata_json->>'mock_ktl' = 'true';
