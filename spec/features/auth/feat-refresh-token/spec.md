# BE-01 — POST /api/v1/auth/refresh (Refresh Access Token)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo spec lần đầu cho BE-01 (endpoint refresh token còn thiếu, đã phát hiện qua khảo sát `KE_HOACH_TAI_THUC_THI_PLAN_BE_2026-07-26.md` và `PLAN_THUC_THI_P0_CODE_VA_SPEC_2026-07-26.md`). Chốt phương án PA-1 (stateless + rotation). | Toàn bộ file |

---

## 1. Bối cảnh

`login.service.ts` đã phát hành cả `accessToken` và `refreshToken` (cùng một `jti`), FE (`FE_SmarTracking/src/utils/request.js:97-111`) đã dựng sẵn cơ chế gọi refresh khi access token hết hạn, và `CLAUDE.md` §22.1 đã liệt kê `POST /api/v1/auth/refresh` — nhưng `auth.controller.ts` **chưa có route này**. Đây là endpoint chặn nhiều màn FE nhất trong đợt P0.

**Mâu thuẫn tài liệu đã xử lý:** `docs/API_CONTRACT_v1.0_with_system_roles.md:229` (mục UC-02 Logout) từng ghi "không còn `sessionId`/`refreshToken` theo v3.2 Compact" — câu này chỉ đúng với việc bỏ bảng `user_sessions`, KHÔNG có nghĩa là refreshToken bị loại bỏ khỏi luồng auth. Đã sửa lại câu này trong `API_CONTRACT_v1.0_with_system_roles.md` (xem T-3.16) để không còn mâu thuẫn với chính code và CLAUDE.md.

## 2. Quyết định kiến trúc — PA-1 (stateless + rotation)

Chọn PA-1 thay vì PA-2 (bảng session riêng) vì:
- Tận dụng đúng cơ chế Redis JWT blacklist đã có (`jwt-auth.guard.ts:42`, `logout.service.ts`), không thêm hạ tầng/bảng mới.
- Login phát access + refresh **cùng một `jti`** (`login.service.ts` — biến `jti` dùng chung cho cả hai lệnh `generateAccessToken`/`generateRefreshToken`). Do đó blacklist `jti` cũ ở bước rotation khai tử luôn access token cũ — đúng ý đồ rotation, không cần logic phụ.
- Đúng nguyên tắc DB v3.2 Compact: không dùng bảng `user_sessions` (§9.1 CLAUDE.md).

## 3. Functional Requirements (EARS)

```text
FR-001: THE system SHALL cung cấp endpoint POST /api/v1/auth/refresh, không yêu cầu JwtAuthGuard (access token có thể đã hết hạn).

FR-002: WHEN refreshToken hợp lệ (đúng chữ ký, còn hạn, jti chưa bị blacklist, user tồn tại và account_status = 'active'), THE system SHALL phát hành một cặp access token + refresh token mới với jti mới, đồng thời blacklist jti cũ (Redis, TTL = thời gian còn lại của refresh token cũ).

FR-003: IF refreshToken sai chữ ký, hết hạn, hoặc malformed, THEN THE system SHALL trả 401 với code REFRESH_TOKEN_INVALID — không phân biệt lý do cụ thể ra response (SEC-02).

FR-004: IF jti của refreshToken đã có trong Redis blacklist, THEN THE system SHALL trả 401 với code REFRESH_TOKEN_REVOKED (chống replay sau rotation/logout).

FR-005: IF user không tồn tại hoặc account_status khác 'active' (locked/inactive), THEN THE system SHALL trả 401 với code REFRESH_TOKEN_INVALID (không tiết lộ lý do cụ thể để không lộ thông tin tài khoản).

FR-006: IF Redis không phản hồi được khi ghi blacklist jti cũ, THEN THE system SHALL fail-closed — trả 401 thay vì phát token mới (ưu tiên an toàn hơn khả dụng).
```

## 4. Acceptance Criteria

- AC-001: Given refresh token hợp lệ, When gọi `POST /auth/refresh`, Then nhận 200 với `{accessToken, refreshToken, expiresIn}` — cả hai token đều mới, jti khác jti cũ.
- AC-002: Given refresh token đã dùng rotation một lần, When gọi lại `POST /auth/refresh` với refresh token **cũ** đó, Then nhận 401 `REFRESH_TOKEN_REVOKED`.
- AC-003: Given access token cũ (cùng jti với refresh token cũ) được dùng sau khi rotation xảy ra, When gọi bất kỳ endpoint có `JwtAuthGuard`, Then nhận 401 (jti đã bị blacklist bởi bước rotation).
- AC-004: Given refresh token hết hạn hoặc bị sửa (sai chữ ký), When gọi `POST /auth/refresh`, Then nhận 401 `REFRESH_TOKEN_INVALID`.
- AC-005: Given user bị khóa (`account_status = 'locked'`) sau khi refresh token được phát hành, When user đó gọi `POST /auth/refresh`, Then nhận 401 `REFRESH_TOKEN_INVALID`.

## 5. Public endpoint — lý do (SEC-02)

Endpoint không gắn `JwtAuthGuard` vì access token đã hết hạn là chính lý do client gọi endpoint này. Xác thực thay thế bằng chữ ký riêng của refresh token (secret khác access token — `AUTH_REFRESH_TOKEN_SECRET`) + đối chiếu Redis blacklist. Repo không có decorator `@Public()`; cách làm public chuẩn của repo là không gắn `@UseGuards(JwtAuthGuard)` (xem `login`, `password-reset/*`).

`MustChangePasswordGuard` (APP_GUARD toàn cục) không ảnh hưởng route này: guard short-circuit `return true` ngay khi `request['user']` không tồn tại (route không có JwtAuthGuard nên không có `request.user`) — đã xác minh bằng code đọc trực tiếp `must-change-password.guard.ts:41-44`, không cần sửa `ALLOWED_ROUTE_PREFIXES`.

## 6. Residual đã chấp nhận

- Redis chết → refresh fail-closed (401). Chấp nhận gián đoạn refresh tạm thời thay vì mở đường replay token khi không kiểm tra được blacklist.
- Refresh dùng chung `jti` với access token phát hành cùng lượt login/refresh trước đó — hệ quả phụ (khai tử access token cũ khi blacklist refresh cũ) là **có chủ đích**, không phải bug.
