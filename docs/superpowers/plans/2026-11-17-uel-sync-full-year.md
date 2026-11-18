# Đồng bộ UEL đến hết năm học — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi lượt "đồng bộ toàn bộ" lấy lịch học từ hôm nay đến hết năm học (31/08), thay cho cửa sổ `sessionDaysAhead` (14, tối đa 120).

**Architecture:** Thêm hàm thuần `schoolYearEndOf(s, now)` cạnh `runAllPlanOf` trong `uel-sync-settings.service.ts`; `runAllPlanOf` dùng nó làm `toDate`. Bỏ `sessionDaysAhead` khỏi type/DTO/service/FE. `GET /uel-sync/status` trả thêm `plan: { fromDate, toDate }` để FE hiện "đến DD/MM/YYYY". Không đổi luồng `UelSyncService` (đã lặp từng ngày, cache TKB, không hủy ngày API rỗng).

**Tech Stack:** NestJS + TypeORM + Jest (BE `SAVP-capstone`), React CRA + Testing Library (FE `SAVP-capstone-FE-`).

**Spec:** `SAVP-capstone/docs/superpowers/specs/2026-11-17-uel-sync-full-year-design.md`

## Global Constraints
- Ngày tính theo giờ VN (dùng `vnDate` sẵn có), định dạng `yyyy-MM-dd`.
- Ngày kết thúc: fixed + `namHoc` dạng `YYYY-ZZZZ` ⇒ `ZZZZ-08-31`; ngược lại tháng VN ≥ 9 ⇒ `(năm+1)-08-31`, còn lại ⇒ `năm-08-31`; luôn ≥ hôm nay + 13 ngày.
- Lượt chọn tay theo GV/SV (`POST /uel-sync/run`) không đổi.
- Key `uel_sync.session_days_ahead` để nguyên trong DB, không đọc/ghi nữa; không viết migration.
- KHÔNG commit (người dùng chỉ commit khi tự yêu cầu).

## Review Focus
- Cuối tháng 8 (vd 2027-08-25): toDate phải là 2027-09-07 (≥ +13 ngày), không phải 2027-08-31 → test trong Task 1.
- 31/08 17:00 UTC (= 01/09 giờ VN): phải coi là tháng 9 ⇒ năm sau → test trong Task 1.
- fixed với `namHoc` sai dạng (vd "2026") ⇒ rơi về quy tắc theo tháng → test trong Task 1.
- Body PUT /settings cũ còn gửi `sessionDaysAhead` ⇒ không được 400 (controller dùng `forbidNonWhitelisted`) → test trong Task 1 Step 6.
- FE nhận status cũ không có `plan` ⇒ không crash, ẩn ngày → test trong Task 2.

---

### Task 1: BE — lấy lịch đến hết năm học

**Files:**
- Modify: `SAVP-capstone/src/modules/uel-sync/uel-sync-settings.service.ts` (type `UelSyncSettings`, `KEYS`, hằng `DEFAULT/MAX_SESSION_DAYS_AHEAD`, `runAllPlanOf`, `getSettings`, `updateSettings`)
- Modify: `SAVP-capstone/src/modules/uel-sync/uel-sync-settings.dto.ts` (xóa field `sessionDaysAhead` + import `MAX_SESSION_DAYS_AHEAD`)
- Modify: `SAVP-capstone/src/modules/uel-sync/uel-sync.controller.ts:72-112` (summary run-all; status trả `plan`)
- Modify: `SAVP-capstone/src/modules/uel-sync/uel-sync.scheduler.ts:36` (comment)
- Modify: `SAVP-capstone/.env.example:361` → `SCHEDULER_UEL_SYNC_ENABLED=true` kèm comment "chạy 02:00, lịch đến hết năm học, có thể 1–2 giờ"
- Modify (local, không commit): `SAVP-capstone/.env` thêm `SCHEDULER_UEL_SYNC_ENABLED=true`
- Test: `SAVP-capstone/src/modules/uel-sync/uel-sync-settings.service.spec.ts`

**Interfaces:**
- Produces: `export function schoolYearEndOf(s: Pick<UelSyncSettings,'termMode'|'namHoc'>, now: Date): string` (yyyy-MM-dd)
- Produces: `runAllPlanOf(s, now)` → `{ fromDate: vnDate(now), toDate: schoolYearEndOf(s, now), termMode, terms }`
- Produces: `GET /uel-sync/status` thêm `plan: { fromDate: string; toDate: string }` (từ `runAllPlanOf(settings, new Date())`)
- `UelSyncSettings` không còn `sessionDaysAhead`.

- [ ] **Step 1: Viết test thất bại** — trong spec: bỏ `sessionDaysAhead` khỏi `SETTINGS`; thay test "+N−1 ngày" bằng:

```ts
describe('schoolYearEndOf', () => {
  const at = (iso: string) => new Date(iso);
  it('tháng ≥ 9 ⇒ 31/08 năm sau', () =>
    expect(schoolYearEndOf(SETTINGS, at('2026-11-08T18:30:00Z'))).toBe('2027-08-31'));
  it('tháng < 9 ⇒ 31/08 năm nay', () =>
    expect(schoolYearEndOf(SETTINGS, at('2027-03-10T03:00:00Z'))).toBe('2027-08-31'));
  it('01/09 giờ VN (31/08 17:00 UTC) ⇒ năm sau', () =>
    expect(schoolYearEndOf(SETTINGS, at('2027-08-31T17:00:00Z'))).toBe('2028-08-31'));
  it('cuối tháng 8 vẫn ≥ hôm nay + 13 ngày', () =>
    expect(schoolYearEndOf(SETTINGS, at('2027-08-25T03:00:00Z'))).toBe('2027-09-07'));
  it('fixed + namHoc ⇒ 31/08 năm sau của namHoc', () =>
    expect(schoolYearEndOf({ termMode: 'fixed', namHoc: '2026-2027' }, at('2026-11-08T18:30:00Z'))).toBe('2027-08-31'));
  it('fixed + namHoc sai dạng ⇒ theo tháng', () =>
    expect(schoolYearEndOf({ termMode: 'fixed', namHoc: '2026' }, at('2026-11-08T18:30:00Z'))).toBe('2027-08-31'));
});
// runAllPlanOf(SETTINGS, 2026-11-08T18:30Z) toEqual { fromDate: '2026-11-09', toDate: '2027-08-31', termMode: 'auto', terms: [] }
```

Thêm test `getSettings` (nếu spec đã có mock `db.query`): kết quả không có key `sessionDaysAhead`; `updateSettings` không ghi `uel_sync.session_days_ahead`.

- [ ] **Step 2: Chạy test, xác nhận FAIL**
Run: `cd SAVP-capstone && npx jest src/modules/uel-sync/uel-sync-settings.service.spec.ts`
Expected: FAIL — `schoolYearEndOf is not a function` / toDate khác.

- [ ] **Step 3: Cài `schoolYearEndOf`, sửa `runAllPlanOf`, bỏ `sessionDaysAhead`** ở các file trong danh sách. `schoolYearEndOf`: lấy `today = vnDate(now)`; năm kết thúc = `ZZZZ` khi `termMode==='fixed'` và `namHoc` khớp `/^(\d{4})-(\d{4})$/`, ngược lại `tháng(today) >= 9 ? năm+1 : năm`; trả `max(\`${end}-08-31\`, vnDate(now, 13))` (so chuỗi yyyy-MM-dd). Cập nhật JSDoc `runAllPlanOf` + summary controller: "Lịch học từ hôm nay đến hết năm học (31/08)". Controller `status()` thêm `plan: (({fromDate,toDate}) => ({fromDate,toDate}))(runAllPlanOf(settings, new Date()))`.

- [ ] **Step 4: Chạy test, xác nhận PASS**
Run: `cd SAVP-capstone && npx jest src/modules/uel-sync`
Expected: tất cả PASS.

- [ ] **Step 5: Typecheck + lint**
Run: `cd SAVP-capstone && npx tsc --noEmit -p tsconfig.json && npx eslint src/modules/uel-sync`
Expected: không lỗi (không còn tham chiếu `sessionDaysAhead`/`MAX_SESSION_DAYS_AHEAD`: `grep -rn "sessionDaysAhead\|SESSION_DAYS_AHEAD" src` chỉ còn migration).

- [ ] **Step 6: Body cũ không bị 400** — `uel-sync.controller.ts:45` bật `forbidNonWhitelisted: true`, nên giữ trong `UelSyncSettingsDto` field `@ApiHideProperty() @IsOptional() sessionDaysAhead?: unknown` (comment "bỏ qua — tương thích FE cũ"); controller `updateSettings` xóa key này trước khi gọi service. Thêm test DTO: `validate(plainToInstance(UelSyncSettingsDto, { sessionDaysAhead: 14 }), { whitelist: true, forbidNonWhitelisted: true })` ⇒ 0 lỗi.

### Task 2: FE — bỏ ô số ngày, hiện "đến hết năm học"

**Files:**
- Modify: `SAVP-capstone-FE-/src/pages/systemAdmin/UelSync.jsx` (`DEFAULT_SETTINGS`, `formOf`, `payloadOf`, `blocker` trong `SettingsCard`, khối "Lấy lịch học trước" ~dòng 570-578, thẻ "Đồng bộ ngay" ~dòng 757)
- Modify: `SAVP-capstone-FE-/src/mocks/uelSyncMock.js` (bỏ `sessionDaysAhead`; status trả `plan`; `startMockRun` dùng `plan.toDate`)
- Modify: `SAVP-capstone-FE-/src/service/uelSyncService.js:47` (JSDoc)
- Test: `SAVP-capstone-FE-/src/pages/systemAdmin/uelSync.smoke.test.jsx`

**Interfaces:**
- Consumes: `status.plan?: { fromDate: 'yyyy-MM-dd', toDate: 'yyyy-MM-dd' }` từ Task 1.

- [ ] **Step 1: Viết test thất bại** — trong smoke test: bỏ `sessionDaysAhead` khỏi status mock và khỏi `toHaveBeenCalledWith` của test lưu cài đặt; thêm `plan: { fromDate: '2026-11-17', toDate: '2027-08-31' }` vào status mock và test mới:

```jsx
test('thẻ Đồng bộ ngay hiện lịch đến hết năm học, không còn ô số ngày', async () => {
    render(<UelSync />);
    expect(await screen.findByText(/đến 31\/08\/2027/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Lấy lịch học trước/)).not.toBeInTheDocument();
});
test('status cũ không có plan vẫn render', async () => {
    svc.getUelSyncStatus.mockResolvedValue({ ...STATUS, plan: undefined });
    render(<UelSync />);
    expect(await screen.findByText(/đến hết năm học/)).toBeInTheDocument();
});
```
(`STATUS` = tên biến status mock đang có trong file; dùng đúng tên ở đó.)

- [ ] **Step 2: Chạy test, xác nhận FAIL**
Run: `cd SAVP-capstone-FE- && npx react-scripts test --watchAll=false src/pages/systemAdmin/uelSync.smoke.test.jsx`
Expected: FAIL ở 2 test mới và test lưu cài đặt.

- [ ] **Step 3: Sửa `UelSync.jsx`** — xóa mọi `sessionDaysAhead`; xóa khối input "Lấy lịch học trước"; đổi legend "Phạm vi (dùng cho cả nút bấm)" giữ phần Học kỳ. Thẻ "Đồng bộ ngay" thay "lịch học N ngày tới." bằng: `lịch học từ hôm nay đến hết năm học` + (nếu có `status.plan?.toDate`) ` (đến DD/MM/YYYY)`; thêm dòng `text-xs text-steel-gray`: "Lấy cả năm nên một lượt có thể mất 1–2 giờ." Sửa mock + JSDoc service tương ứng.

- [ ] **Step 4: Chạy test, xác nhận PASS**
Run: `cd SAVP-capstone-FE- && npx react-scripts test --watchAll=false src/pages/systemAdmin`
Expected: tất cả PASS; `grep -rn sessionDaysAhead src` không còn kết quả.

### Task 3: Kiểm tra thực tế (sau khi người dùng đồng ý chạy)
- [ ] Restart backend; `GET /api/v1/uel-sync/status` có `plan.toDate = "2027-08-31"`, `schedule.serverAllowed = true`.
- [ ] Bật tự động 02:00 hằng ngày trên trang; `schedule.nextRunAt` là 02:00 VN hôm sau.
- [ ] (Tùy người dùng) bấm "Đồng bộ toàn bộ" một lần; sau khi xong: `SELECT max(session_date) FROM class_sessions WHERE source='uel_api'` ≈ ngày học cuối của UEL (~2027-07-09) và có học kỳ HK02 trong `semesters`.
