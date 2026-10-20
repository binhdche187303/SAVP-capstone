-- SEED ĐẦY ĐỦ theo bản vẽ KTL: zone + camera (đúng số lượng đếm trên bản vẽ) + nhóm + VỊ TRÍ/HƯỚNG trên mặt bằng.
-- Thay thế scripts/mock-ktl-cameras.sql (đếm sai số lượng, chưa có vị trí). Chạy lại được (xoá bản cũ trước).
-- Toạ độ layout = hệ 1000 × (1000*h/w) của FE (CameraLayout); angle: độ, 0 = sang phải, theo chiều kim đồng hồ.
-- Vị trí lấy ước lượng từ biểu tượng camera trên PNG -> kéo chỉnh lại ở Sơ đồ lắp đặt camera nếu lệch.
BEGIN;

-- Dọn bản cũ (cả mock cũ lẫn bản seed này).
DELETE FROM camera_groups WHERE group_code LIKE 'KTL-G-%';
DELETE FROM iot_devices WHERE metadata_json->>'mock_ktl' = 'true';
DELETE FROM zones WHERE metadata_json->>'mock_ktl' = 'true';

CREATE TEMP TABLE ktl_plan (zone_code text, zone_name text, zone_type text, building text, floor text, note text) ON COMMIT DROP;
INSERT INTO ktl_plan VALUES
  ('KTL-CONG1',     'Cổng 1',             'gate',     'Campus', 'G', 'Ảnh Cổng 1'),
  ('KTL-CONG2-MOI', 'Cổng 2 mới',         'gate',     'Campus', 'G', 'Ảnh Cổng 2 mới'),
  ('KTL-CONG2-CU',  'Cổng 2 hiện hữu',    'gate',     'Campus', 'G', 'Ảnh Cổng 2.1/2.2'),
  ('KTL-CONG3',     'Cổng 3',             'gate',     'Campus', 'G', 'Ảnh Cổng 3'),
  ('KTL-A2-1',      'Hội trường - Lầu 1', 'lobby',    'KTL.A2', '1', 'Bản vẽ Hội trường - Lầu 1'),
  ('KTL-A1-G',      'A1 - Tầng trệt',     'lobby',    'KTL.A1', 'G', 'Bản vẽ A1 tầng trệt'),
  ('KTL-A1-1',      'A1 - Lầu 1',         'corridor', 'KTL.A1', '1', 'Bản vẽ A1 lầu 1'),
  ('KTL-B1-G',      'B1 - Tầng trệt',     'lobby',    'KTL.B1', 'G', 'Bản vẽ B1 tầng 1');

INSERT INTO zones (zone_code, zone_name, zone_type, building, floor, description, metadata_json)
SELECT zone_code, zone_name, zone_type, building, floor, 'KTL - ' || note, jsonb_build_object('mock_ktl', true) FROM ktl_plan;

-- Camera có vị trí trên mặt bằng: (zone, loại, x, y, angle). x,y = toạ độ ảnh hiển thị 2000px / 2.
CREATE TEMP TABLE ktl_pos (zone_code text, kind text, x int, y int, angle int) ON COMMIT DROP;
INSERT INTO ktl_pos VALUES
  -- A1 tầng trệt: 9 AI + 6 an ninh
  ('KTL-A1-G','ai',177,173,180),('KTL-A1-G','ai',216,159,270),('KTL-A1-G','ai',214,181,0),
  ('KTL-A1-G','ai',504,148,90),('KTL-A1-G','ai',431,189,0),('KTL-A1-G','ai',576,188,180),
  ('KTL-A1-G','ai',794,178,180),('KTL-A1-G','ai',802,159,270),('KTL-A1-G','ai',832,174,0),
  ('KTL-A1-G','sec',212,92,0),('KTL-A1-G','sec',420,188,180),('KTL-A1-G','sec',452,90,90),
  ('KTL-A1-G','sec',555,92,90),('KTL-A1-G','sec',586,188,0),('KTL-A1-G','sec',795,90,270),
  -- A1 lầu 1: 6 AI + 2 an ninh
  ('KTL-A1-1','ai',215,160,180),('KTL-A1-1','ai',444,174,180),('KTL-A1-1','ai',457,179,0),
  ('KTL-A1-1','ai',550,179,180),('KTL-A1-1','ai',565,174,0),('KTL-A1-1','ai',794,161,270),
  ('KTL-A1-1','sec',222,174,180),('KTL-A1-1','sec',785,176,0),
  -- B1 tầng trệt: 2 AI + 3 an ninh
  ('KTL-B1-G','ai',220,246,180),('KTL-B1-G','ai',922,248,180),
  ('KTL-B1-G','sec',470,248,180),('KTL-B1-G','sec',487,248,0),('KTL-B1-G','sec',295,295,0),
  -- Hội trường lầu 1: 2 AI + 2 an ninh
  ('KTL-A2-1','ai',593,285,0),('KTL-A2-1','ai',593,368,0),
  ('KTL-A2-1','sec',681,269,180),('KTL-A2-1','sec',681,379,180);

INSERT INTO iot_devices (device_code, device_name, device_type, zone_id, status, health_status, last_seen_at, metadata_json)
SELECT format('%s-%s%s', p.zone_code, CASE c.kind WHEN 'ai' THEN 'AI' ELSE 'AN' END, lpad(c.n::text, 2, '0')),
       format('%s · %s %s', p.zone_name, CASE c.kind WHEN 'ai' THEN 'Camera AI' ELSE 'Camera an ninh' END, c.n),
       'ip_camera', z.id, 'online', 'healthy', now(),
       jsonb_build_object('mock_ktl', true, 'camera_kind', c.kind, 'source', 'ktl-drawing',
                          'layout', jsonb_build_object('floor_key', p.building || ' - Tầng ' || p.floor,
                                                       'x', c.x, 'y', c.y, 'angle', c.angle))
         || CASE WHEN c.kind = 'sec' THEN '{"provider":"IVSS"}'::jsonb ELSE '{}'::jsonb END
FROM (SELECT *, row_number() OVER (PARTITION BY zone_code, kind ORDER BY ctid) n FROM ktl_pos) c
JOIN ktl_plan p ON p.zone_code = c.zone_code
JOIN zones z ON z.zone_code = p.zone_code AND z.deleted_at IS NULL;

-- Camera cổng (chưa có mặt bằng ảnh, không đặt vị trí): (zone, số AI, số an ninh)
INSERT INTO iot_devices (device_code, device_name, device_type, zone_id, status, health_status, last_seen_at, metadata_json)
SELECT format('%s-%s%s', p.zone_code, k.tag, lpad(g::text, 2, '0')),
       format('%s · %s %s', p.zone_name, k.label, g),
       'ip_camera', z.id, 'online', 'healthy', now(),
       jsonb_build_object('mock_ktl', true, 'camera_kind', k.kind, 'source', 'ktl-drawing')
         || CASE WHEN k.kind = 'sec' THEN '{"provider":"IVSS"}'::jsonb ELSE '{}'::jsonb END
FROM (VALUES ('KTL-CONG1',0,3),('KTL-CONG2-MOI',0,4),('KTL-CONG2-CU',0,3),('KTL-CONG3',2,2)) v(zc, n_ai, n_sec)
JOIN ktl_plan p ON p.zone_code = v.zc
JOIN zones z ON z.zone_code = p.zone_code AND z.deleted_at IS NULL
CROSS JOIN LATERAL (VALUES ('ai','AI','Camera AI',v.n_ai),('sec','AN','Camera an ninh',v.n_sec)) k(kind, tag, label, n)
CROSS JOIN LATERAL generate_series(1, k.n) g;

-- 2 camera offline để demo trạng thái.
UPDATE iot_devices SET status = 'offline', health_status = 'unknown', last_seen_at = now() - interval '3 hours'
WHERE device_code IN ('KTL-A1-1-AN02', 'KTL-CONG2-CU-AN03');

-- Nhóm: theo khu vực + theo loại + cổng.
INSERT INTO camera_groups (group_code, group_name, description)
SELECT 'KTL-G-' || substr(zone_code, 5), 'Khu ' || zone_name, 'Theo bản vẽ KTL' FROM ktl_plan
UNION ALL SELECT 'KTL-G-AI',  'Toàn bộ camera AI',      'Theo bản vẽ KTL'
UNION ALL SELECT 'KTL-G-SEC', 'Toàn bộ camera an ninh', 'Theo bản vẽ KTL'
UNION ALL SELECT 'KTL-G-GATES', 'Camera các cổng',      'Theo bản vẽ KTL';

INSERT INTO camera_group_members (group_id, device_id)
SELECT g.id, d.id FROM iot_devices d JOIN zones z ON z.id = d.zone_id
JOIN camera_groups g ON g.group_code = 'KTL-G-' || substr(z.zone_code, 5)
WHERE d.metadata_json->>'mock_ktl' = 'true'
UNION ALL
SELECT g.id, d.id FROM iot_devices d
JOIN camera_groups g ON g.group_code = CASE d.metadata_json->>'camera_kind' WHEN 'ai' THEN 'KTL-G-AI' ELSE 'KTL-G-SEC' END
WHERE d.metadata_json->>'mock_ktl' = 'true'
UNION ALL
SELECT g.id, d.id FROM iot_devices d JOIN zones z ON z.id = d.zone_id AND z.zone_type = 'gate'
JOIN camera_groups g ON g.group_code = 'KTL-G-GATES'
WHERE d.metadata_json->>'mock_ktl' = 'true';

COMMIT;
