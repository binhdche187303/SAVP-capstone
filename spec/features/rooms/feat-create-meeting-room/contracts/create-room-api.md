# API Contract: Create Room

**UC-ID**: UC-RM-01 / UC-56
**Method**: POST
**Endpoint**: /api/v1/rooms
**Permission**: room.create
**Async**: No

## Request Body

| Field | Type | Required | Default | Description |
|---|---|---|---:|---|
| roomCode | string | yes | - | Ma phong, uppercase, length 3-80, regex ^[A-Z0-9]+(?:-[A-Z0-9]+)*$ |
| roomName | string | yes | - | Ten phong hien thi |
| siteName | string | no | - | Toa nha/co so |
| areaName | string | no | - | Tang/khu vuc |
| locationDescription | string | no | - | Mo ta vi tri |
| capacity | integer | yes | - | Suc chua (1-1000) |
| roomType | string | no | meeting_room | Enum: meeting_room, training_room, board_room, open_space |
| hasCamera | boolean | no | false | Co camera tich hop |
| hasMicrophone | boolean | no | false | Co microphone tich hop |
| hasDisplay | boolean | no | false | Co man hinh tich hop |
| allowRecording | boolean | no | false | Cho phep ghi am/ghi hinh |

> Rejected fields: layoutJson -> 422 UNSUPPORTED_FIELD

## Response 201 Created

`json
{
  "success": true,
  "message": "Room created successfully",
  "data": {
    "id": "uuid",
    "roomCode": "R301",
    "roomName": "Phong hop 301",
    "capacity": 12,
    "currentStatus": "available",
    "isActive": true,
    "createdAt": "2026-06-16T10:00:00+07:00"
  }
}
`

## Error Codes

| HTTP | Code | Condition |
|---|---:|---|
| 400 | ROOM_CODE_REQUIRED | roomCode missing |
| 400 | ROOM_NAME_REQUIRED | roomName missing |
| 400 | ROOM_CAPACITY_INVALID | capacity missing |
| 422 | ROOM_CODE_INVALID_FORMAT | roomCode sai format/length |
| 422 | ROOM_CAPACITY_INVALID | capacity sai range hoac khong phai integer |
| 422 | INVALID_ROOM_TYPE | roomType khong thuoc enum |
| 422 | UNSUPPORTED_FIELD | Request body co field ngoai contract |
| 401 | - | Chua xac thuc |
| 403 | PERMISSION_DENIED | Khong co room.create |
| 409 | ROOM_CODE_ALREADY_EXISTS | roomCode da ton tai |
| 409 | ROOM_NAME_ALREADY_EXISTS | roomName da ton tai (unique) |
| 500 | INTERNAL_ERROR | Loi server |
