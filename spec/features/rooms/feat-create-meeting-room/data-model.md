# Data Model: UC-RM-01 Tao thu cong phong hop moi

## Entity: rooms

### Columns & Validation

| Column | Type | Required | Default | Validation |
|---|---|---|---:|---|
| id | uuid | yes | gen_random_uuid() | PK |
| room_code | varchar(80) | yes | - | UNIQUE, Regex: ^[A-Z0-9]+(?:-[A-Z0-9]+)*$, length 3-80, uppercase |
| room_name | varchar(150) | yes | - | Unique among deleted_at IS NULL (case-insensitive, trimmed) |
| site_name | varchar(150) | no | null | - |
| area_name | varchar(150) | no | null | - |
| location_description | text | no | null | - |
| capacity | integer | yes | - | 1..1000 |
| room_type | varchar(50) | no | 'meeting_room' | Enum: meeting_room, training_room, board_room, open_space |
| current_status | varchar(30) | no | 'available' | Enum: available, occupied, reserved, maintenance, inactive |
| has_camera | boolean | no | false | - |
| has_microphone | boolean | no | false | - |
| has_display | boolean | no | false | - |
| allow_recording | boolean | no | false | - |
| layout_json | jsonb | no | null | Reject field (out of scope) |
| is_active | boolean | no | true | - |
| created_by | uuid FK -> users.id | no | null | Tu JWT token |
| updated_by | uuid FK -> users.id | no | null | = created_by khi tao |
| created_at | timestamptz | no | now() | Auto |
| updated_at | timestamptz | no | now() | Auto |
| deleted_at | timestamptz | no | null | Soft delete |

### Proposed Migration
`sql
CREATE UNIQUE INDEX IF NOT EXISTS ux_rooms_room_name_not_deleted
ON rooms (lower(btrim(room_name)))
WHERE deleted_at IS NULL;
`

### Entity: audit_logs

| Column | Usage in feature |
|---|---|
| user_id | Nguoi tao (tu JWT) |
| action_type | 'create' |
| entity_type | 'room' |
| entity_id | Room.id |
| new_value_json | Room data snapshot |
| ip_address | Tu request |
| created_at | now() |

### State Transitions
- Tao: (none) -> currentStatus = 'available', isActive = true
- Feature nay khong xu ly chuyen trang thai
