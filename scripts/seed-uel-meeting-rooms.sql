-- Phòng họp UEL theo "Mo ta ve Lich tuan UEL tren VPDT.docx" (cập nhật 18/10/2026).
-- Sức chứa lấy cận trên; tầng suy từ số phòng; has_camera tạm = true (trừ phòng online) — cần xác nhận.
INSERT INTO rooms (room_code, room_name, site_name, area_name, location_description, capacity, room_type,
                   has_camera, has_microphone, has_display)
VALUES
  ('A114',    'Phòng A.114',      'KTL.A1', 'Tầng 1', 'Sức chứa 70 - 100',                  100, 'meeting_room', true,  true,  true),
  ('A102',    'Phòng A.102',      'KTL.A1', 'Tầng 1', 'Sức chứa 15 - 20',                    20, 'meeting_room', true,  true,  true),
  ('A103',    'Phòng A.103',      'KTL.A1', 'Tầng 1', 'Sức chứa 10 - 15',                    15, 'meeting_room', true,  true,  true),
  ('A107',    'Phòng A.107',      'KTL.A1', 'Tầng 1', 'Sức chứa 30 - 40',                    40, 'meeting_room', true,  true,  true),
  ('A204BIS', 'Phòng A.204bis',   'KTL.A1', 'Tầng 2', 'Sức chứa 15 - 20',                    20, 'meeting_room', true,  true,  true),
  ('HTA',     'Hội trường A',     'KTL.A2', 'Tầng G', 'Hội trường 500 chỗ',                 500, 'open_space',   true,  true,  true),
  ('ONLINE',  'Phòng họp Online', 'Online', NULL,     'Google Meet: 100, Zoom: 300',        300, 'meeting_room', false, false, false);
