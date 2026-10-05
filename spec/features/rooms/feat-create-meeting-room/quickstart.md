# Quickstart: UC-RM-01 Tao thu cong phong hop moi

## Test Scenarios

### Happy Path
1. Tao phong hop thanh cong voi day du truong bat buoc roomCode, roomName, capacity
2. Tao phong hop voi truong optional (siteName, areaName, hasCamera, v.v.)
3. Tao phong hop voi capacity = 1 (edge)
4. Tao phong hop voi capacity = 1000 (edge)
5. Tao phong hop khi co phong khac cung ten nhung da soft-delete

### Validation Errors (HTTP 400)
6. Thieu roomCode
7. Thieu roomName
8. Thieu capacity

### Validation Errors (HTTP 422)
9. roomCode sai format (chu thuong, space, ky tu dac biet)
10. roomCode qua ngan (<3)
11. roomCode qua dai (>80)
12. capacity = 0 hoac am
13. capacity > 1000
14. capacity khong phai so nguyen (so thap phan, chuoi)
15. roomType khong thuoc enum
16. Request body chua unsupported field (layoutJson)

### Authorization Errors
17. Chua dang nhap (401)
18. Dang nhap nhung khong co permission room.create (403)

### Business Rule Errors (HTTP 409)
19. roomCode da ton tai
20. roomName da ton tai (case-insensitive, trimmed)
21. Race condition: 2 request dong thoi cung roomName -> 1 thanh cong, 1 409

### Audit
22. Tao phong thanh cong -> audit log duoc ghi

## Verification Notes
- Kiem tra roomCode duoc uppercase tu dong
- Kiem tra currentStatus = 'available' sau khi tao
- Kiem tra isActive = true
- Kiem tra created_at, updated_at la thoi diem hien tai
- Kiem tra created_by = user ID tu JWT
- Kiem tra updated_by = created_by
- Kiem tra response field names theo API contract
- Khong cho phep tao phong voi layoutJson (reject)
