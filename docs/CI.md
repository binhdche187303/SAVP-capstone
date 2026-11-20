# CI GitHub Actions — Backend

| Ngày | Thay đổi |
|---|---|
| 2026-11-20 | Bật CI: build + lint file .ts đổi + unit test (bỏ qua 12 suite đang fail sẵn). Chưa có CD. |

## Chạy khi nào
- Mọi pull request, và mỗi lần push lên `main` hoặc `feature/**`.
- Push mới trên cùng nhánh sẽ huỷ lần chạy cũ (concurrency).
- Xem kết quả: tab **Actions** trên GitHub. PR sẽ có dấu ✅ hoặc ❌.

## Các bước (`.github/workflows/ci.yml`)
1. `npm ci` + `npm ci --prefix workers/ai-transcription`.
2. `npm run build` (nest build + build ai-worker).
3. **Lint**: chỉ lint file .ts thay đổi so với commit gốc (base của PR / commit trước khi push).
   - File **mới** phải sạch lint, nếu không CI đỏ.
   - File **sửa** chỉ báo lỗi, không chặn (code cũ còn ~11k lỗi lint).
   - Không dùng `--fix` trên CI. Sửa ở máy: `npx eslint <file> --fix`.
4. **Unit test**: `jest --ci --maxWorkers=2 --testTimeout=20000`, bỏ qua các suite liệt kê trong
   `.github/ci-known-failing-tests.txt`.

## Danh sách test đang fail sẵn
- `.github/ci-known-failing-tests.txt`: 12 suite fail trên main từ trước khi bật CI.
- Sửa xong suite nào thì **xoá dòng đó** để CI kiểm lại nó.
- Không thêm suite mới vào danh sách để "cho xanh". Test mới fail thì phải sửa.

## Chạy lại ở máy giống CI
```bash
npm run build
IGNORE=$(grep -vE '^\s*(#|$)' .github/ci-known-failing-tests.txt | sed 's#^#src/#' | paste -sd'|' -)
npx jest --ci --maxWorkers=2 --testTimeout=20000 --testPathIgnorePatterns "/node_modules/|$IGNORE"
```

## Làm sau
- CD (tự deploy lên máy chủ trường) và `deploy.sh`.
- Branch protection: GitHub → Settings → Branches → rule cho `main` → bật "Require status checks to pass" (chọn job `backend`).
