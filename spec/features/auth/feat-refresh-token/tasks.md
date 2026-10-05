# Tasks — BE-01 POST /api/v1/auth/refresh

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-07-26 | Tạo tasks lần đầu, đối chiếu `PLAN_THUC_THI_P0_CODE_VA_SPEC_2026-07-26.md` (T-3.1 → T-3.17) | Toàn bộ file |

---

| ID | Việc | File | Trạng thái |
| :-- | :-- | :-- | :-- |
| T-3.1 | Tạo `RefreshTokenDto` | `src/modules/auth/dto/refresh-token.dto.ts` | ✅ Xong |
| T-3.2 | Tạo `RefreshTokenResponseDto` | `src/modules/auth/dto/refresh-token-response.dto.ts` | ✅ Xong |
| T-3.3 | Tạo `RefreshTokenService` (logic 5 bước) | `src/modules/auth/services/refresh-token.service.ts` | ✅ Xong |
| T-3.4 | Unit test `RefreshTokenService` (coverage ≥80%) | `src/modules/auth/services/refresh-token.service.spec.ts` | ✅ Xong (100% stmt/func/line, 82% branch) |
| T-3.5 | Thêm `getRefreshTokenSecret()` | `src/modules/auth/services/auth-config.service.ts` | ✅ Xong |
| T-3.6 | Dọn hard-code `process.env.AUTH_REFRESH_TOKEN_SECRET` | `src/modules/auth/services/token.service.ts:29` | ✅ Xong |
| T-3.7 | Thêm `POST refresh` vào controller, không gắn `JwtAuthGuard`, OpenAPI đầy đủ | `src/modules/auth/controllers/auth.controller.ts` | ✅ Xong |
| T-3.8 | Đăng ký `RefreshTokenService` | `src/modules/auth/auth.module.ts` | ✅ Xong |
| T-3.9 | Kiểm tra `MustChangePasswordGuard.ALLOWED_ROUTE_PREFIXES` có nuốt route mới không | `src/common` / `src/modules/auth/guards/must-change-password.guard.ts` | ✅ Đã xác minh — KHÔNG cần sửa (guard short-circuit khi `request.user` rỗng, route refresh không có `JwtAuthGuard` nên không set `request.user`) |
| T-3.10 | Cập nhật test `token.service.spec.ts` theo T-3.6 | `src/modules/auth/services/token.service.spec.ts` | ✅ Xong |
| T-3.11 | Xác nhận `.env.example` có `AUTH_REFRESH_TOKEN_SECRET` + `AUTH_REFRESH_TOKEN_TTL_SECONDS` | `.env.example` | ✅ Đã có sẵn, không cần sửa |
| T-3.12 | Tạo `spec.md` | `spec/features/auth/feat-refresh-token/spec.md` | ✅ Xong |
| T-3.13 | Tạo `plan.md` | `spec/features/auth/feat-refresh-token/plan.md` | ✅ Xong |
| T-3.14 | Tạo `tasks.md` (file này) | `spec/features/auth/feat-refresh-token/tasks.md` | ✅ Xong |
| T-3.15 | Thêm UC `POST /api/v1/auth/refresh` vào `API_CONTRACT_v1.0_with_system_roles.md` | `docs/API_CONTRACT_v1.0_with_system_roles.md` | ⬜ Tiếp theo |
| T-3.16 | Sửa câu sai tại `API_CONTRACT_v1.0_with_system_roles.md:229` (refreshToken vẫn dùng) | `docs/API_CONTRACT_v1.0_with_system_roles.md` | ⬜ Tiếp theo |
| T-3.17 | Đồng bộ `API_CONTRACT_v1.0_with_system_roles.md` nếu có 2 mục trên | `docs/API_CONTRACT_v1.0_with_system_roles.md` | ⬜ Tiếp theo |

**Extra (phát sinh khi code, không có trong plan gốc):**
- Thêm `UsersAuthRepository.findById(userId)` — cần thiết để refresh flow load lại user theo `payload.sub` (bước 3 của logic refresh). Không có sẵn trong repo trước đó (chỉ có `findByNormalizedEmail`).
