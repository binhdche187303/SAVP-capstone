# UI mockup Khách đến làm việc + Trung tâm báo cáo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng 11 màn của phân hệ 2.10 và 2.13 trong `SAVP-capstone-FE` bằng dữ liệu giả, đủ để khách hàng bấm trọn luồng ở buổi review ngày 2026-10-09.

**Architecture:** Trang React gọi service; service rẽ nhánh theo cờ `VISITOR_REPORT_MOCK_ENABLED` sang lớp giả trong `src/mocks/visitorReport/` (kho dữ liệu sinh sẵn, lưu thay đổi vào `localStorage`). Logic nghiệp vụ nằm trong hàm thuần có unit test; trang chỉ dựng giao diện. Tên hàm service bám theo hợp đồng API ở spec §6.4 để BE làm theo.

**Tech Stack:** React 18 (CRA 5, JavaScript), react-router-dom 6, Tailwind 3 với token màu trong `tailwind.config.js`, recharts, lucide-react, `xlsx`, Jest của `react-scripts`. Thư viện mới duy nhất: `qrcode.react`.

**Spec:** `SAVP-capstone-BE/spec/features/visitor-reports/feat-visitor-report-ui-mockup/spec.md`

**Thư mục làm việc:** mọi đường dẫn `src/...` bên dưới tính từ `/Users/lamnh/Documents/GitHub/SAVP-capstone-FE`.

**Mức chi tiết của plan này:** task 1–2 (logic thuần) có đủ code và test. Task 3–6 (dữ liệu giả, service) có đủ chữ ký hàm, dạng dữ liệu, quy tắc sinh và test. Task 7–18 (giao diện) có file, props, state, hàm gọi, bố cục và bước kiểm tra tay; JSX viết theo mẫu `src/pages/shared/ZoneTrafficAnalytics.jsx`. Chọn mức này vì hạn 2 ngày.

## Global Constraints

- **Không commit, không push.** Mỗi task kết thúc bằng bước "Điểm dừng": chạy test/build, báo danh sách file đổi. Chỉ commit khi LamNH yêu cầu. Không thêm dòng `Co-Authored-By`.
- Làm trên nhánh `feat/visitor-report-mockup` tách từ `main` của FE. Không đụng `.env.local` (đang có thay đổi riêng của người dùng).
- Không sửa BE. Không sửa màn cũ ngoài việc thêm route và mục menu.
- Trang và component không import trực tiếp từ `src/mocks/`; chỉ đi qua `src/service/visitorService.js` và `src/service/reportCenterService.js`.
- Service trả đúng dạng `{ success: true, data }` hoặc `{ success: false, message }`. Trang kiểm tra `res?.success`.
- Giao diện: khung trang `space-y-6 p-6 max-w-7xl mx-auto`; thẻ `bg-white rounded-2xl border border-platinum-tint shadow-sm`; tiêu đề `text-xl font-bold text-midnight-indigo`; nhãn ô lọc `block text-[10px] font-bold text-slate-blue uppercase`; nút chính `bg-action-blue text-white rounded-xl px-4 py-2 text-sm font-semibold`. Icon `lucide-react` (riêng menu System Admin dùng `react-icons/ri`). Biểu đồ `recharts`. Thông báo dùng `src/utils/toast.js`.
- Mọi chữ hiển thị bằng tiếng Việt. Mọi màn có trạng thái đang tải, rỗng, lỗi.
- Giờ lịch gửi theo múi Asia/Ho_Chi_Minh (UTC+7 cố định).
- Ngưỡng khớp khuôn mặt 0.80. Quyền ra vào mặc định: 30 phút trước giờ hẹn đến 30 phút sau. Khung giờ hẹn tối đa 7 ngày. Kỳ báo cáo tối đa 366 ngày. Người nhận lịch gửi 1–20.
- Mã lượt khách: `VS-YYMMDD-NNNN`. Tên file xuất: `<ma-loai>_<tu>_<den>.<đuôi>`.
- Lệnh test: `CI=true npx react-scripts test --watchAll=false <đường dẫn>`. Lệnh build: `npm run build`.

## Review Focus

Năm tình huống spec ngầm đòi hỏi, dễ làm hỏng buổi demo nhất. Mỗi dòng có test hoặc bước kiểm tra ở task ghi trong ngoặc.

1. **`localStorage` hỏng, đầy hoặc bị chặn** (chế độ ẩn danh): app vẫn chạy bằng dữ liệu sinh sẵn trong bộ nhớ, không trắng màn. (Task 3, test `store`)
2. **Demo diễn ra khác ngày với ngày sinh dữ liệu:** "khách hôm nay" vẫn có đủ trạng thái, dữ liệu người demo đã nhập được giữ lại. (Task 3, test `store`)
3. **Máy không có camera hoặc người dùng từ chối quyền camera** ở màn đăng ký: vẫn tải ảnh từ file lên được. (Task 9 `FaceCapture`; Task 10, kiểm tra tay)
4. **Báo cáo không có dòng nào, hoặc trình duyệt chặn cửa sổ in PDF:** file xuất vẫn hợp lệ với dòng "Không có dữ liệu trong kỳ đã chọn"; bị chặn cửa sổ thì hiện thông báo thay vì im lặng. (Task 6, test `exporters`; Task 7, kiểm tra tay)
5. **Địa chỉ sai:** `/reports/<loại không tồn tại>` hoặc mã lượt khách không có thật hiện trang "không tìm thấy" có nút quay lại, không văng lỗi. (Task 4 và 5, test service; Task 7 và 18, kiểm tra tay)

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/config/featureFlags.js` (sửa) | Thêm cờ `VISITOR_REPORT_MOCK_ENABLED` |
| `src/mocks/visitorReport/visitStateMachine.js` | Chuyển trạng thái lượt khách, gia hạn, quá giờ, đánh giá lượt nhận diện tại cổng |
| `src/mocks/visitorReport/scheduleNextRun.js` | Tính lần chạy kế tiếp, quy đổi kỳ tương đối |
| `src/mocks/visitorReport/prng.js` | Sinh số giả ngẫu nhiên tất định |
| `src/mocks/visitorReport/seed.js` | Sinh toàn bộ dữ liệu ban đầu |
| `src/mocks/visitorReport/store.js` | Đọc/ghi `localStorage`, đặt lại, sinh lại khi sang ngày |
| `src/mocks/visitorReport/visitorApi.js` | Cài đặt giả cho API khách |
| `src/mocks/visitorReport/reportData.js` | Tính KPI, biểu đồ, dòng bảng cho 7 loại báo cáo |
| `src/mocks/visitorReport/reportApi.js` | Cài đặt giả cho API báo cáo, lịch gửi, lần chạy |
| `src/mocks/visitorReport/exporters.js` | Dựng mô hình xuất, ghi Excel/Word, mở bản in PDF |
| `src/service/visitorService.js` | Hợp đồng API khách, rẽ nhánh theo cờ |
| `src/service/reportCenterService.js` | Hợp đồng API báo cáo và lịch gửi, rẽ nhánh theo cờ |
| `src/hooks/useAreaBase.js` | Trả tiền tố khu vực đang đứng (`/business-admin`, …) |
| `src/config/reportDefinitions.js` | Khai báo tiêu đề, bộ lọc, KPI, biểu đồ, cột của 7 loại |
| `src/utils/reportFormat.js` | Hàm định dạng ô dùng chung cho bảng và file xuất |
| `src/pages/shared/reports/{ReportCenter,ReportViewer,ReportSchedules,ReportRuns}.jsx` | Màn S8–S11 |
| `src/components/report/{ReportFilterBar,KpiTiles,ReportChart,ReportTable,ExportMenu,ScheduleFormModal}.jsx` | Khối dùng chung của báo cáo |
| `src/pages/public/{VisitorRegister,VisitorStatus}.jsx` | Màn S1, S2 |
| `src/pages/shared/visitors/{VisitorManagement,VisitorDesk,MyVisitors,VisitorHistory,VisitorStats}.jsx` | Màn S3–S7 |
| `src/components/visitor/{visitLabels.js,VisitStatusBadge,VisitorAvatar,VisitTimeline,AccessGrantCard,VisitQr,FaceCapture,VisitForm,VisitDetailDrawer}.jsx` | Khối dùng chung của khách |
| `src/routers/index.js` (sửa) | Thêm route |
| `src/pages/{bussinessAdmin,systemAdmin,manager,employee}/layout/*Layout.jsx` (sửa) | Thêm mục menu |
| `docs/demo-visitor-report.md` (FE) | Kịch bản demo |

## Wiring Recipe (dùng cho mọi task giao diện)

Mỗi task giao diện tự thêm route và mục menu của màn mình làm, để dừng ở mốc nào menu cũng không có mục chết.

**Route** trong `src/routers/index.js`: import trang ở đầu file, rồi thêm phần tử vào mảng `children` của khu vực tương ứng, ngay trước phần tử `path: 'legal'`:

```jsx
{
    path: 'reports',
    element: <ReportCenter />
},
```

Route công khai thêm ngay sau phần tử `path: '/guest/meeting/:meetingId'`.

**Menu:**

| Layout | Cách thêm |
|---|---|
| `src/pages/bussinessAdmin/layout/BusinessAdminLayout.jsx` | Mục báo cáo thêm vào `children` của nhóm `'Báo cáo'` trong `STATIC_NAVIGATION_ITEMS`. Mục khách thêm vào nhóm mới `{ label: 'Khách', isDropdown: true, icon: UserCheck, children: [...] }` đặt trước nhóm `'Báo cáo'`. Icon import từ `lucide-react`. |
| `src/pages/systemAdmin/layout/SystemAdminLayout.jsx` | Thêm hai nhóm mới sau nhóm `'An ninh'`: `{ label: 'Khách', isDropdown: true, icon: RiUserReceivedLine, children: [...] }` và `{ label: 'Báo cáo', isDropdown: true, icon: RiBarChartBoxLine, children: [...] }`. Icon import từ `react-icons/ri`. |
| `src/pages/manager/layout/ManagerLayout.jsx` | "Trung tâm báo cáo" thêm vào `children` của nhóm `'Báo cáo'`. "Khách của tôi" là mục phẳng sau mục `'Hành trình'`. |
| `src/pages/employee/layout/EmployeeLayout.jsx` | "Khách của tôi" là mục phẳng sau mục `'Hành trình'`. |

**Bảng route và menu**

| Màn | Route (dưới tiền tố khu vực) | Khu vực | Nhãn menu | Icon lucide / ri |
|---|---|---|---|---|
| S8 ReportCenter | `reports` | BA, SA, Manager | Trung tâm báo cáo | `FileBarChart` / `RiFileChartLine` |
| S9 ReportViewer | `reports/:type` | BA, SA, Manager | (không có mục menu) | — |
| S10 ReportSchedules | `report-schedules` | BA, SA | Lịch gửi báo cáo | `CalendarClock` / `RiCalendarScheduleLine` |
| S11 ReportRuns | `report-schedules/runs` | BA, SA | Lịch sử gửi | `History` / `RiMailSendLine` |
| S4 VisitorDesk | `visitors/desk` | BA, SA | Quầy lễ tân | `ConciergeBell` / `RiServiceLine` |
| S3 VisitorManagement | `visitors` | BA, SA | Quản lý khách | `ClipboardList` / `RiContactsBookLine` |
| S6 VisitorHistory | `visitors/history` | BA, SA | Lịch sử khách | `History` / `RiHistoryLine` |
| S7 VisitorStats | `visitors/stats` | BA, SA | Thống kê khách | `BarChart3` / `RiPieChartLine` |
| S5 MyVisitors | `my-visitors` | Manager, Employee | Khách của tôi | `UserCheck` |
| S1 VisitorRegister | `/visitor/register` | công khai | — | — |
| S2 VisitorStatus | `/visitor/status`, `/visitor/status/:code` | công khai | — | — |

Mục menu của S3 (`to: '.../visitors'`) phải có `end: true` để không sáng cùng lúc với `visitors/desk`.

---

# M1 — Nền dữ liệu giả

### Task 1: Cờ mock và máy trạng thái lượt khách

**Files:**
- Modify: `src/config/featureFlags.js` (thêm cuối file)
- Create: `src/mocks/visitorReport/visitStateMachine.js`
- Test: `src/mocks/visitorReport/visitStateMachine.test.js`

**Interfaces:**
- Produces: `VISITOR_REPORT_MOCK_ENABLED: boolean`; `VISIT_STATUS`, `VISIT_ACTION`, `TERMINAL_STATUSES: string[]`, `FACE_MATCH_THRESHOLD = 0.8`, `canTransition(status, action): boolean`, `nextStatus(status, action): string` (ném `Error` nếu không hợp lệ), `availableActions(status): string[]`, `canExtend(visit, newValidTo): boolean`, `isOverstay(visit, now?): boolean`, `shouldExpire(visit, now?): boolean`, `defaultAccessWindow(scheduledFrom, scheduledTo): { validFrom, validTo }` (chuỗi ISO), `evaluateGateAttempt(visit, { at, zoneId, score }): { outcome: 'checked_in'|'manual_review'|'access_denied', reason: string|null }`.
- Dạng `visit` mà các hàm đọc: `{ status, visitor: { hasPhoto }, access: { validFrom, validTo, zoneIds } }`.

- [ ] **Step 1: Tạo nhánh**

Run: `git -C /Users/lamnh/Documents/GitHub/SAVP-capstone-FE checkout -b feat/visitor-report-mockup`
Expected: `Switched to a new branch 'feat/visitor-report-mockup'`

- [ ] **Step 2: Viết test (chưa có code)**

```js
// src/mocks/visitorReport/visitStateMachine.test.js
import {
    TERMINAL_STATUSES, canTransition, nextStatus, availableActions, canExtend,
    isOverstay, shouldExpire, defaultAccessWindow, evaluateGateAttempt,
} from './visitStateMachine';

const visit = (over = {}) => ({
    status: 'approved',
    visitor: { hasPhoto: true },
    access: {
        validFrom: '2026-10-08T01:30:00.000Z',
        validTo: '2026-10-08T04:30:00.000Z',
        zoneIds: ['zone-gate-main', 'zone-a1'],
    },
    ...over,
});
const inWindow = { at: '2026-10-08T02:00:00.000Z', zoneId: 'zone-gate-main', score: 0.93 };

describe('chuyển trạng thái', () => {
    test.each([
        ['pending_approval', 'approve', 'approved'],
        ['pending_approval', 'reject', 'rejected'],
        ['pending_approval', 'cancel', 'cancelled'],
        ['approved', 'check_in', 'checked_in'],
        ['approved', 'revoke', 'revoked'],
        ['approved', 'cancel', 'cancelled'],
        ['approved', 'expire', 'expired'],
        ['checked_in', 'check_out', 'checked_out'],
        ['checked_in', 'revoke', 'revoked'],
    ])('%s + %s → %s', (from, action, to) => {
        expect(canTransition(from, action)).toBe(true);
        expect(nextStatus(from, action)).toBe(to);
    });

    test('trạng thái kết thúc không còn thao tác nào', () => {
        expect(TERMINAL_STATUSES.sort()).toEqual(['cancelled', 'checked_out', 'expired', 'rejected', 'revoked']);
        TERMINAL_STATUSES.forEach((s) => expect(availableActions(s)).toEqual([]));
    });

    test('chuyển không hợp lệ thì ném lỗi tiếng Việt', () => {
        expect(canTransition('pending_approval', 'check_in')).toBe(false);
        expect(() => nextStatus('checked_out', 'approve')).toThrow('Không thể');
    });
});

describe('gia hạn, quá giờ, hết hạn', () => {
    test('gia hạn chỉ khi approved/checked_in và thời điểm mới lớn hơn', () => {
        expect(canExtend(visit(), '2026-10-08T06:00:00.000Z')).toBe(true);
        expect(canExtend(visit({ status: 'checked_in' }), '2026-10-08T06:00:00.000Z')).toBe(true);
        expect(canExtend(visit(), '2026-10-08T04:30:00.000Z')).toBe(false);
        expect(canExtend(visit({ status: 'pending_approval' }), '2026-10-08T06:00:00.000Z')).toBe(false);
    });

    test('quá giờ là cờ của lượt đang checked_in', () => {
        const late = new Date('2026-10-08T05:00:00.000Z');
        expect(isOverstay(visit({ status: 'checked_in' }), late)).toBe(true);
        expect(isOverstay(visit({ status: 'approved' }), late)).toBe(false);
        expect(isOverstay(visit({ status: 'checked_in' }), new Date('2026-10-08T04:00:00.000Z'))).toBe(false);
    });

    test('hết hạn khi approved mà quá hiệu lực', () => {
        expect(shouldExpire(visit(), new Date('2026-10-08T05:00:00.000Z'))).toBe(true);
        expect(shouldExpire(visit({ status: 'checked_in' }), new Date('2026-10-08T05:00:00.000Z'))).toBe(false);
    });

    test('quyền mặc định rộng hơn giờ hẹn 30 phút mỗi đầu', () => {
        expect(defaultAccessWindow('2026-10-08T02:00:00.000Z', '2026-10-08T04:00:00.000Z')).toEqual({
            validFrom: '2026-10-08T01:30:00.000Z',
            validTo: '2026-10-08T04:30:00.000Z',
        });
    });
});

describe('nhận diện tại cổng', () => {
    test('trong khung giờ, đúng khu vực, đủ ngưỡng → tự check-in', () => {
        expect(evaluateGateAttempt(visit(), inWindow)).toEqual({ outcome: 'checked_in', reason: null });
    });
    test('đúng ngưỡng 0.80 vẫn qua', () => {
        expect(evaluateGateAttempt(visit(), { ...inWindow, score: 0.8 }).outcome).toBe('checked_in');
    });
    test('dưới ngưỡng → lễ tân xác minh', () => {
        expect(evaluateGateAttempt(visit(), { ...inWindow, score: 0.79 })).toEqual({ outcome: 'manual_review', reason: 'low_score' });
    });
    test('chưa có ảnh → lễ tân xác minh', () => {
        expect(evaluateGateAttempt(visit({ visitor: { hasPhoto: false } }), inWindow)).toEqual({ outcome: 'manual_review', reason: 'no_photo' });
    });
    test('ngoài khung giờ → chặn', () => {
        expect(evaluateGateAttempt(visit(), { ...inWindow, at: '2026-10-08T06:00:00.000Z' })).toEqual({ outcome: 'access_denied', reason: 'outside_window' });
    });
    test('sai khu vực → chặn', () => {
        expect(evaluateGateAttempt(visit(), { ...inWindow, zoneId: 'zone-b2' })).toEqual({ outcome: 'access_denied', reason: 'zone_not_allowed' });
    });
    test('lượt chưa duyệt → chặn', () => {
        expect(evaluateGateAttempt(visit({ status: 'pending_approval' }), inWindow)).toEqual({ outcome: 'access_denied', reason: 'invalid_status' });
    });
});
```

- [ ] **Step 3: Chạy test, xác nhận đỏ**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/visitStateMachine.test.js`
Expected: FAIL, `Cannot find module './visitStateMachine'`

- [ ] **Step 4: Viết code**

```js
// src/mocks/visitorReport/visitStateMachine.js
// Máy trạng thái lượt khách (spec §4.1). Hàm thuần — BE sẽ cài lại đúng bảng này.

export const VISIT_STATUS = {
    PENDING: 'pending_approval',
    APPROVED: 'approved',
    CHECKED_IN: 'checked_in',
    CHECKED_OUT: 'checked_out',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled',
    REVOKED: 'revoked',
    EXPIRED: 'expired',
};

export const VISIT_ACTION = {
    APPROVE: 'approve',
    REJECT: 'reject',
    CANCEL: 'cancel',
    CHECK_IN: 'check_in',
    CHECK_OUT: 'check_out',
    REVOKE: 'revoke',
    EXPIRE: 'expire',
};

const TRANSITIONS = {
    pending_approval: { approve: 'approved', reject: 'rejected', cancel: 'cancelled' },
    approved: { check_in: 'checked_in', revoke: 'revoked', cancel: 'cancelled', expire: 'expired' },
    checked_in: { check_out: 'checked_out', revoke: 'revoked' },
};

export const TERMINAL_STATUSES = ['checked_out', 'rejected', 'cancelled', 'revoked', 'expired'];

export const FACE_MATCH_THRESHOLD = 0.8;
const ACCESS_BUFFER_MS = 30 * 60 * 1000;

export const canTransition = (status, action) => Boolean(TRANSITIONS[status]?.[action]);

export const nextStatus = (status, action) => {
    const to = TRANSITIONS[status]?.[action];
    if (!to) throw new Error(`Không thể thực hiện "${action}" khi lượt khách đang ở trạng thái "${status}"`);
    return to;
};

export const availableActions = (status) => Object.keys(TRANSITIONS[status] || {});

export const canExtend = (visit, newValidTo) =>
    ['approved', 'checked_in'].includes(visit.status) &&
    new Date(newValidTo).getTime() > new Date(visit.access.validTo).getTime();

export const isOverstay = (visit, now = new Date()) =>
    visit.status === 'checked_in' && now.getTime() > new Date(visit.access.validTo).getTime();

export const shouldExpire = (visit, now = new Date()) =>
    visit.status === 'approved' && now.getTime() > new Date(visit.access.validTo).getTime();

export const defaultAccessWindow = (scheduledFrom, scheduledTo) => ({
    validFrom: new Date(new Date(scheduledFrom).getTime() - ACCESS_BUFFER_MS).toISOString(),
    validTo: new Date(new Date(scheduledTo).getTime() + ACCESS_BUFFER_MS).toISOString(),
});

// BR-V5, BR-V6. Thứ tự kiểm tra: trạng thái → khung giờ → khu vực → ảnh → độ khớp.
export const evaluateGateAttempt = (visit, { at, zoneId, score }) => {
    if (visit.status !== 'approved') return { outcome: 'access_denied', reason: 'invalid_status' };
    const t = new Date(at).getTime();
    if (t < new Date(visit.access.validFrom).getTime() || t > new Date(visit.access.validTo).getTime()) {
        return { outcome: 'access_denied', reason: 'outside_window' };
    }
    if (!visit.access.zoneIds.includes(zoneId)) return { outcome: 'access_denied', reason: 'zone_not_allowed' };
    if (!visit.visitor.hasPhoto) return { outcome: 'manual_review', reason: 'no_photo' };
    if (score < FACE_MATCH_THRESHOLD) return { outcome: 'manual_review', reason: 'low_score' };
    return { outcome: 'checked_in', reason: null };
};
```

Thêm cuối `src/config/featureFlags.js`:

```js

/**
 * Phân hệ Khách đến làm việc (2.10) + Trung tâm báo cáo (2.13): BE chưa có.
 * BẬT (mặc định): `visitorService` và `reportCenterService` đọc dữ liệu giả ở
 * `src/mocks/visitorReport`. Đặt REACT_APP_VISITOR_REPORT_MOCK=false để gọi API thật.
 */
export const VISITOR_REPORT_MOCK_ENABLED = process.env.REACT_APP_VISITOR_REPORT_MOCK !== 'false';
```

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/visitStateMachine.test.js`
Expected: PASS, 22 tests

- [ ] **Step 6: Điểm dừng** — báo file đã đổi (`git status -sb`). Không commit.

### Task 2: Tính lần chạy kế tiếp của lịch gửi

**Files:**
- Create: `src/mocks/visitorReport/scheduleNextRun.js`
- Test: `src/mocks/visitorReport/scheduleNextRun.test.js`

**Interfaces:**
- Produces: `computeNextRun(schedule, now?): Date|null` với `schedule = { enabled, frequency: 'daily'|'weekly'|'monthly', time: 'HH:mm', dayOfWeek: 0..6 (0 = Chủ nhật), dayOfMonth: 1..28 | 'last' }`; `resolvePeriod(period, now?): { from, to }` với `period ∈ 'yesterday'|'last_week'|'last_month'`, trả chuỗi `YYYY-MM-DD` theo lịch Việt Nam (tuần tính từ thứ Hai).

- [ ] **Step 1: Viết test**

```js
// src/mocks/visitorReport/scheduleNextRun.test.js
import { computeNextRun, resolvePeriod } from './scheduleNextRun';

// 2026-10-07 là thứ Tư. 03:00Z = 10:00 giờ Việt Nam.
const NOW = new Date('2026-10-07T03:00:00.000Z');
const iso = (d) => d.toISOString();
const base = { enabled: true, time: '08:00' };

describe('computeNextRun', () => {
    test('lịch tắt → null', () => {
        expect(computeNextRun({ ...base, enabled: false, frequency: 'daily' }, NOW)).toBeNull();
    });
    test('hằng ngày, giờ đã qua → ngày mai', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'daily' }, NOW))).toBe('2026-10-08T01:00:00.000Z');
    });
    test('hằng ngày, giờ chưa tới → hôm nay', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'daily', time: '17:00' }, NOW))).toBe('2026-10-07T10:00:00.000Z');
    });
    test('đúng bằng giờ gửi → lần sau', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'daily' }, new Date('2026-10-07T01:00:00.000Z')))).toBe('2026-10-08T01:00:00.000Z');
    });
    test('qua nửa đêm giờ Việt Nam nhưng UTC còn ngày cũ', () => {
        // 18:30Z ngày 07 = 01:30 ngày 08 ở Việt Nam
        expect(iso(computeNextRun({ ...base, frequency: 'daily' }, new Date('2026-10-07T18:30:00.000Z')))).toBe('2026-10-08T01:00:00.000Z');
    });
    test('hằng tuần thứ Hai', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'weekly', dayOfWeek: 1 }, NOW))).toBe('2026-10-12T01:00:00.000Z');
    });
    test('hằng tuần đúng hôm nay, giờ đã qua → tuần sau', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'weekly', dayOfWeek: 3 }, NOW))).toBe('2026-10-14T01:00:00.000Z');
    });
    test('hằng tuần đúng hôm nay, giờ chưa tới → hôm nay', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'weekly', dayOfWeek: 3, time: '17:00' }, NOW))).toBe('2026-10-07T10:00:00.000Z');
    });
    test('hằng tháng ngày 1', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'monthly', dayOfMonth: 1 }, NOW))).toBe('2026-11-01T01:00:00.000Z');
    });
    test('ngày cuối tháng 31 ngày', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'monthly', dayOfMonth: 'last' }, NOW))).toBe('2026-10-31T01:00:00.000Z');
    });
    test('ngày cuối tháng 2 năm không nhuận', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'monthly', dayOfMonth: 'last' }, new Date('2027-02-10T03:00:00.000Z')))).toBe('2027-02-28T01:00:00.000Z');
    });
    test('ngày cuối tháng 30 ngày, đúng giờ gửi → cuối tháng sau', () => {
        expect(iso(computeNextRun({ ...base, frequency: 'monthly', dayOfMonth: 'last' }, new Date('2026-04-30T01:00:00.000Z')))).toBe('2026-05-31T01:00:00.000Z');
    });
    test('tần suất lạ → ném lỗi', () => {
        expect(() => computeNextRun({ ...base, frequency: 'yearly' }, NOW)).toThrow('Tần suất không hợp lệ');
    });
});

describe('resolvePeriod', () => {
    test('hôm qua', () => {
        expect(resolvePeriod('yesterday', NOW)).toEqual({ from: '2026-10-06', to: '2026-10-06' });
    });
    test('tuần trước tính từ thứ Hai đến Chủ nhật', () => {
        expect(resolvePeriod('last_week', NOW)).toEqual({ from: '2026-09-28', to: '2026-10-04' });
    });
    test('tháng trước', () => {
        expect(resolvePeriod('last_month', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    });
    test('tháng trước của tháng 1 lùi về năm trước', () => {
        expect(resolvePeriod('last_month', new Date('2027-01-15T03:00:00.000Z'))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
    });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/scheduleNextRun.test.js`
Expected: FAIL, `Cannot find module './scheduleNextRun'`

- [ ] **Step 3: Viết code**

```js
// src/mocks/visitorReport/scheduleNextRun.js
// Lịch gửi báo cáo (spec §4.2 BR-S2, BR-S4). Giờ theo Asia/Ho_Chi_Minh = UTC+7 cố định,
// tự tính bằng UTC để kết quả không phụ thuộc múi giờ của máy chạy.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// Date mà các getter getUTC* đọc ra đúng giờ treo tường Việt Nam.
const toVn = (date) => new Date(date.getTime() + VN_OFFSET_MS);
// Thời điểm thật ứng với giờ treo tường Việt Nam (ngày/tháng tràn được tự chuẩn hoá).
const fromVn = (y, m, d, hh = 0, mm = 0) => new Date(Date.UTC(y, m, d, hh, mm) - VN_OFFSET_MS);
const lastDayOfMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const pad = (n) => String(n).padStart(2, '0');
const ymd = (vnDate) => `${vnDate.getUTCFullYear()}-${pad(vnDate.getUTCMonth() + 1)}-${pad(vnDate.getUTCDate())}`;

export const computeNextRun = (schedule, now = new Date()) => {
    if (!schedule?.enabled) return null;
    const [hh, mm] = schedule.time.split(':').map(Number);
    const vn = toVn(now);
    const y = vn.getUTCFullYear();
    const m = vn.getUTCMonth();
    const d = vn.getUTCDate();

    if (schedule.frequency === 'daily') {
        const today = fromVn(y, m, d, hh, mm);
        return today > now ? today : fromVn(y, m, d + 1, hh, mm);
    }
    if (schedule.frequency === 'weekly') {
        for (let i = 0; i <= 7; i += 1) {
            const candidate = fromVn(y, m, d + i, hh, mm);
            if (toVn(candidate).getUTCDay() === schedule.dayOfWeek && candidate > now) return candidate;
        }
    }
    if (schedule.frequency === 'monthly') {
        for (let i = 0; i <= 2; i += 1) {
            const first = new Date(Date.UTC(y, m + i, 1));
            const yy = first.getUTCFullYear();
            const mo = first.getUTCMonth();
            const day = schedule.dayOfMonth === 'last' ? lastDayOfMonth(yy, mo) : schedule.dayOfMonth;
            const candidate = fromVn(yy, mo, day, hh, mm);
            if (candidate > now) return candidate;
        }
    }
    throw new Error(`Tần suất không hợp lệ: ${schedule.frequency}`);
};

export const resolvePeriod = (period, now = new Date()) => {
    const vn = toVn(now);
    const y = vn.getUTCFullYear();
    const m = vn.getUTCMonth();
    const d = vn.getUTCDate();
    const at = (yy, mo, dd) => new Date(Date.UTC(yy, mo, dd));

    if (period === 'yesterday') {
        const day = ymd(at(y, m, d - 1));
        return { from: day, to: day };
    }
    if (period === 'last_week') {
        const sinceMonday = (vn.getUTCDay() + 6) % 7;
        return { from: ymd(at(y, m, d - sinceMonday - 7)), to: ymd(at(y, m, d - sinceMonday - 1)) };
    }
    if (period === 'last_month') {
        return { from: ymd(at(y, m - 1, 1)), to: ymd(at(y, m, 0)) };
    }
    throw new Error(`Kỳ dữ liệu không hợp lệ: ${period}`);
};
```

- [ ] **Step 4: Chạy test, xác nhận xanh**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/scheduleNextRun.test.js`
Expected: PASS, 17 tests

- [ ] **Step 5: Điểm dừng** — báo file đã đổi. Không commit.

### Task 3: Dữ liệu sinh sẵn và kho lưu

**Files:**
- Create: `src/mocks/visitorReport/prng.js`, `src/mocks/visitorReport/seed.js`, `src/mocks/visitorReport/store.js`
- Test: `src/mocks/visitorReport/store.test.js`

**Interfaces:**
- Consumes: `defaultAccessWindow` (Task 1), `computeNextRun` (Task 2).
- Produces:
  - `prng.js`: `hashSeed(text): number`, `mulberry32(seed): () => number` (0..1), `pick(rng, array)`, `int(rng, min, max)` (bao gồm hai đầu).
  - `seed.js`: `SEED_VERSION = 1`, `ME_HOST_ID = 'host-me'`, `DEPARTMENTS`, `ZONES`, `PURPOSES`, `buildSeed(now?): State`.
  - `store.js`: `STORAGE_KEY = 'savp.visitorReportMock'`, `loadState(now?): State`, `saveState(state): boolean`, `updateState(mutator, now?): State`, `resetState(now?): State`, `getCurrentActor(): { id, fullName }`.

**Dạng `State`**

```js
{
  version: 1,
  seededOn: '2026-10-7',            // `${năm}-${tháng}-${ngày}` theo giờ máy
  departments: [{ id, name, building }],
  hosts: [{ id, fullName, employeeCode, departmentId, email }],
  zones: [{ id, name, type: 'gate'|'building', hasFaceGate }],
  visits: [Visit],
  notifications: [{ id, hostId, visitId, type, message, createdAt, read, userTouched }],
  schedules: [Schedule],            // dạng ở Task 6
  runs: [Run],                      // dạng ở Task 6
  exports: [{ id, reportType, format, from, to, fileName, createdAt, userTouched }],
}
```

```js
// Visit
{
  id: 'v-20261007-03', code: 'VS-261007-0003',
  channel: 'online'|'host_invite'|'walk_in',
  status,                                   // xem Task 1
  visitor: { fullName, idNumber, phone, email, organization, plateNumber, photo, hasPhoto },
  hostId, departmentId, purpose, companions,
  scheduledFrom, scheduledTo,               // ISO
  access: { validFrom, validTo, zoneIds },
  checkInAt, checkOutAt, faceScore, rejectReason,
  events: [{ at, type, note, zoneId, score, actor }],
  createdAt, userTouched,
}
```

`visitor.photo` là data URL hoặc `null`. Khách sinh sẵn có `photo: null, hasPhoto: true` (giao diện vẽ ảnh đại diện bằng chữ cái đầu).

Loại sự kiện: `registered, approved, rejected, cancelled, revoked, extended, photo_added, face_verified, manual_review, access_denied, check_in, check_out, expired, face_removed, email_sent, host_notified`.

**Quy tắc sinh dữ liệu (`buildSeed`)**

| Tập | Quy tắc |
|---|---|
| `departments` | 12 đơn vị cố định: Phòng Đào tạo (A1), Phòng Công tác sinh viên (A1), Phòng Kế hoạch - Tài chính (A2), Phòng Tổ chức - Hành chính (A2), Phòng Quản lý khoa học (A2), Phòng Hợp tác quốc tế (A1), Khoa Công nghệ thông tin (B1), Khoa Kinh tế (B2), Khoa Ngoại ngữ (B2), Khoa Cơ khí (B2), Trung tâm CNTT (B1), Thư viện (A1). `id` dạng `dep-<viết tắt>`. |
| `zones` | 6 khu: `zone-gate-main` Cổng chính (gate, FaceGate), `zone-gate-east` Cổng phụ phía Đông (gate, chỉ camera), `zone-a1`, `zone-a2`, `zone-b1` (building, FaceGate), `zone-b2` (building, chỉ camera). |
| `hosts` | `host-me` (đơn vị `dep-ttcntt`, tên "Tài khoản đang đăng nhập") cộng 60 cán bộ, 5 người mỗi đơn vị. Tên ghép từ 12 họ, 10 tên đệm, 20 tên phổ biến của Việt Nam bằng `mulberry32(hashSeed('hosts'))`. Mã `CB0001`…, email `<mã>@savp.edu.vn`. |
| `visits` quá khứ | Với mỗi ngày từ 89 ngày trước đến hôm qua, dùng `mulberry32(hashSeed('visits:' + yyyymmdd))`: ngày thường 3–8 lượt, cuối tuần 0–2. Giờ hẹn bắt đầu 08:00–15:30 (bội số 30 phút), dài 1 / 1.5 / 2 / 3 giờ. Kênh: online 55%, host_invite 25%, walk_in 20%. 6% lượt gán cho `host-me`. Trạng thái: 78% `checked_out`, 8% `expired`, 6% `rejected` (chỉ kênh online, kênh khác thành `checked_out`), 4% `cancelled`, 4% `revoked` (thu hồi trước khi khách đến, không có `checkInAt`). `checkInAt` = giờ hẹn −10…+15 phút; `checkOutAt` = giờ kết thúc −20…+25 phút; `faceScore` 0.82–0.99, riêng 8% lượt là 0.60–0.79 kèm sự kiện `manual_review`. |
| `visits` hôm nay | Đúng 14 lượt, thời gian tính từ `now` (làm tròn 30 phút): 3 `pending_approval` (hẹn sau 1–3 giờ; 2 lượt đầu của `host-me`), 4 `approved` (hẹn sau 0.5–4 giờ; 1 lượt kênh `host_invite` có `hasPhoto: false`), 4 `checked_in` (bắt đầu 1 giờ trước, kết thúc 1 giờ sau; riêng 1 lượt quá giờ có `access.validTo` đặt thẳng bằng `now` − 30 phút), 2 `checked_out` (hẹn từ 4 giờ trước đến 2 giờ trước), 1 `rejected`. Mọi `scheduledFrom` của 14 lượt này được kẹp trong ngày hôm nay (00:00–23:00) để chạy demo lúc nào cũng đủ 14 lượt "hôm nay". |
| `visits` tương lai | 3 ngày tới, 2–5 lượt mỗi ngày thường: online thì nửa `pending_approval` nửa `approved`, kênh khác `approved`. |
| `id`, `code` | `id = 'v-' + yyyymmdd + '-' + stt 2 chữ số`; `code = 'VS-' + yymmdd + '-' + stt 4 chữ số`, `stt` đếm trong ngày từ 1. |
| `access` | `defaultAccessWindow(scheduledFrom, scheduledTo)`; `zoneIds = ['zone-gate-main', 'zone-' + tòa của đơn vị tiếp viết thường]`. |
| `events` | Dựng theo trạng thái cuối: `registered` → (`approved` \| `rejected`) → `email_sent` → `face_verified` + `check_in` → `check_out` + `face_removed`; `expired`/`revoked` kèm `face_removed`. |
| `notifications` | Mỗi lượt hôm nay của `host-me` một thông báo (`pending_approval` hoặc `visitor_arrived`). |
| Khách | Tên sinh như cán bộ. Đơn vị công tác chọn từ 12 tên: Công ty CP FPT Software, Viettel Solutions, VNPT Hà Nội, Công ty TNHH Samsung SDS Việt Nam, Ngân hàng BIDV, Sở Giáo dục và Đào tạo Hà Nội, Công ty CP MISA, Đại học Bách khoa Hà Nội, Công ty TNHH Kỹ thuật Hòa Phát, Công ty CP Thiết bị giáo dục Tân Á, Phụ huynh sinh viên, Cá nhân. Số giấy tờ 12 chữ số bắt đầu `0`. Điện thoại `09` + 8 chữ số. 30% có biển số dạng `30A-123.45`. |
| `PURPOSES` | Làm việc với đơn vị, Hợp tác doanh nghiệp, Giảng viên thỉnh giảng, Phụ huynh liên hệ, Nhà thầu - bảo trì, Giao nhận hồ sơ, Phỏng vấn tuyển dụng, Tham quan - khảo sát. |
| `schedules`, `runs`, `exports` | Xem Task 6. |

- [ ] **Step 1: Viết test**

```js
// src/mocks/visitorReport/store.test.js
import { buildSeed, ME_HOST_ID, SEED_VERSION } from './seed';
import { STORAGE_KEY, loadState, saveState, updateState, resetState } from './store';
import { isOverstay } from './visitStateMachine';

const NOW = new Date(2026, 9, 7, 10, 0, 0);
const NEXT_DAY = new Date(2026, 9, 8, 9, 0, 0);
const sameDay = (iso, day) => new Date(iso).toDateString() === day.toDateString();

beforeEach(() => {
    jest.restoreAllMocks();
    resetState(NOW);
    window.localStorage.clear();
});

describe('buildSeed', () => {
    const seed = buildSeed(NOW);

    test('tất định với cùng thời điểm', () => {
        expect(buildSeed(NOW)).toEqual(seed);
    });
    test('đủ quy mô', () => {
        expect(seed.version).toBe(SEED_VERSION);
        expect(seed.departments).toHaveLength(12);
        expect(seed.zones).toHaveLength(6);
        expect(seed.hosts).toHaveLength(61);
        expect(seed.visits.length).toBeGreaterThanOrEqual(350);
        expect(seed.schedules).toHaveLength(6);
        expect(seed.runs).toHaveLength(40);
        expect(seed.runs.filter((r) => r.status === 'failed').length).toBeGreaterThanOrEqual(3);
    });
    test('hôm nay có đủ trạng thái để demo', () => {
        const today = seed.visits.filter((v) => sameDay(v.scheduledFrom, NOW));
        expect(today).toHaveLength(14);
        const statuses = new Set(today.map((v) => v.status));
        ['pending_approval', 'approved', 'checked_in', 'checked_out', 'rejected'].forEach((s) => expect(statuses.has(s)).toBe(true));
        expect(today.some((v) => isOverstay(v, NOW))).toBe(true);
        expect(today.filter((v) => v.status === 'pending_approval' && v.hostId === ME_HOST_ID)).toHaveLength(2);
        expect(today.some((v) => v.status === 'approved' && !v.visitor.hasPhoto)).toBe(true);
    });
    test('mã lượt đúng định dạng và không trùng', () => {
        const codes = seed.visits.map((v) => v.code);
        codes.forEach((c) => expect(c).toMatch(/^VS-\d{6}-\d{4}$/));
        expect(new Set(codes).size).toBe(codes.length);
        expect(new Set(seed.visits.map((v) => v.id)).size).toBe(seed.visits.length);
    });
    test('lượt đã rời có giờ vào trước giờ ra', () => {
        seed.visits.filter((v) => v.status === 'checked_out').forEach((v) => {
            expect(new Date(v.checkInAt).getTime()).toBeLessThan(new Date(v.checkOutAt).getTime());
        });
    });
    test('lịch sử quá khứ không đổi khi sang ngày', () => {
        const pick = (s) => s.visits.find((v) => v.id === 'v-20261001-01');
        expect(pick(buildSeed(NEXT_DAY))).toEqual(pick(seed));
    });
});

describe('store', () => {
    test('lần đầu trả seed và ghi localStorage', () => {
        const state = loadState(NOW);
        expect(state.visits.length).toBeGreaterThanOrEqual(350);
        expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    });
    test('updateState giữ thay đổi qua lần đọc sau', () => {
        updateState((s) => { s.visits[0].purpose = 'Đã sửa'; }, NOW);
        expect(loadState(NOW).visits[0].purpose).toBe('Đã sửa');
    });
    test('JSON hỏng → trả seed, không ném lỗi', () => {
        window.localStorage.setItem(STORAGE_KEY, '{hỏng');
        expect(loadState(NOW).visits.length).toBeGreaterThanOrEqual(350);
    });
    test('sai version → sinh lại', () => {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 0, visits: [] }));
        expect(loadState(NOW).visits.length).toBeGreaterThanOrEqual(350);
    });
    test('localStorage không ghi được → vẫn giữ thay đổi trong bộ nhớ', () => {
        jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
        expect(saveState(buildSeed(NOW))).toBe(false);
        updateState((s) => { s.visits[0].purpose = 'Trong bộ nhớ'; }, NOW);
        expect(loadState(NOW).visits[0].purpose).toBe('Trong bộ nhớ');
    });
    test('sang ngày khác → sinh lại hôm nay, giữ bản ghi người dùng đã chạm', () => {
        updateState((s) => {
            s.visits.unshift({ ...s.visits[0], id: 'u-1', code: 'VS-261007-9001', userTouched: true });
        }, NOW);
        const next = loadState(NEXT_DAY);
        expect(next.visits.some((v) => v.id === 'u-1')).toBe(true);
        expect(next.visits.filter((v) => sameDay(v.scheduledFrom, NEXT_DAY)).length).toBeGreaterThanOrEqual(14);
        expect(new Set(next.visits.map((v) => v.id)).size).toBe(next.visits.length);
    });
    test('resetState xoá thay đổi', () => {
        updateState((s) => { s.visits[0].purpose = 'Đã sửa'; }, NOW);
        expect(resetState(NOW).visits[0].purpose).not.toBe('Đã sửa');
    });
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/store.test.js`
Expected: FAIL, `Cannot find module './seed'`

- [ ] **Step 3: Viết `prng.js`**

```js
// src/mocks/visitorReport/prng.js
// Sinh số giả ngẫu nhiên tất định để dữ liệu demo không đổi giữa các lần tải trang.

export const hashSeed = (text) => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

export const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
};

export const pick = (rng, array) => array[Math.floor(rng() * array.length)];
export const int = (rng, min, max) => min + Math.floor(rng() * (max - min + 1));
```

- [ ] **Step 4: Viết `seed.js`** theo bảng "Quy tắc sinh dữ liệu" ở trên. Xuất đúng các tên ở mục Interfaces. `buildSeed(now)` gán `seededOn` bằng `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`. Phần `schedules`, `runs`, `exports` tạm trả mảng rỗng; Task 6 điền (khi đó các kỳ vọng `schedules`/`runs` trong test "đủ quy mô" mới xanh).

- [ ] **Step 5: Viết `store.js`**

```js
// src/mocks/visitorReport/store.js
import { buildSeed, SEED_VERSION, ME_HOST_ID } from './seed';

export const STORAGE_KEY = 'savp.visitorReportMock';

// Dùng khi localStorage không ghi được (ẩn danh, đầy quota): demo vẫn chạy trong bộ nhớ.
let memory = null;
let persistFailed = false;

const USER_COLLECTIONS = ['visits', 'notifications', 'schedules', 'runs', 'exports'];
const dayKey = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

const readStored = () => {
    if (persistFailed) return memory;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
};

export const saveState = (state) => {
    memory = state;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        persistFailed = false;
        return true;
    } catch {
        persistFailed = true;
        return false;
    }
};

// Sang ngày mới: sinh lại để "hôm nay" có dữ liệu, giữ những gì người demo đã tạo hoặc sửa.
const reseedKeepingUserData = (old, now) => {
    const fresh = buildSeed(now);
    USER_COLLECTIONS.forEach((key) => {
        const mine = (old[key] || []).filter((item) => item.userTouched);
        const mineIds = new Set(mine.map((item) => item.id));
        fresh[key] = [...mine, ...fresh[key].filter((item) => !mineIds.has(item.id))];
    });
    return fresh;
};

export const loadState = (now = new Date()) => {
    const stored = readStored();
    const valid = stored && stored.version === SEED_VERSION && Array.isArray(stored.visits);
    if (valid && stored.seededOn === dayKey(now)) return stored;
    const next = valid ? reseedKeepingUserData(stored, now) : buildSeed(now);
    saveState(next);
    return next;
};

export const updateState = (mutator, now = new Date()) => {
    const state = loadState(now);
    mutator(state);
    saveState(state);
    return state;
};

export const resetState = (now = new Date()) => {
    const fresh = buildSeed(now);
    saveState(fresh);
    return fresh;
};

// Người đang đăng nhập đóng vai cán bộ `host-me` trong dữ liệu giả.
export const getCurrentActor = () => {
    try {
        const user = JSON.parse(window.localStorage.getItem('user') || 'null');
        const fullName = user?.fullName || user?.full_name || user?.name;
        return { id: ME_HOST_ID, fullName: fullName || 'Tài khoản đang đăng nhập' };
    } catch {
        return { id: ME_HOST_ID, fullName: 'Tài khoản đang đăng nhập' };
    }
};
```

- [ ] **Step 6: Chạy test**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/store.test.js`
Expected: mọi test xanh, trừ hai kỳ vọng `schedules`/`runs` trong "đủ quy mô" (xanh sau Task 6).

- [ ] **Step 7: Điểm dừng** — báo file đã đổi. Không commit.

### Task 4: API khách (giả) và `visitorService`

**Files:**
- Create: `src/mocks/visitorReport/visitorApi.js`, `src/service/visitorService.js`
- Test: `src/mocks/visitorReport/visitorApi.test.js`

**Interfaces:**
- Consumes: Task 1 (`nextStatus`, `canExtend`, `isOverstay`, `shouldExpire`, `defaultAccessWindow`, `evaluateGateAttempt`, `availableActions`), Task 3 (`loadState`, `updateState`, `resetState`, `getCurrentActor`, `ME_HOST_ID`, `PURPOSES`).
- Produces (`visitorService.js`, mọi hàm `async`, trả `{ success, data }` hoặc `{ success: false, message }`):

| Hàm | Endpoint thật | `data` |
|---|---|---|
| `getVisitorLookups()` | `GET /visitors/lookups` | `{ departments, zones, purposes }` |
| `searchHosts(q)` | `GET /public/visitor-hosts?q=` | `[{ id, fullName, departmentId, departmentName }]`, tối đa 10 |
| `createPublicRegistration(payload)` | `POST /public/visitor-registrations` | `VisitView` |
| `getPublicRegistration(code)` | `GET /public/visitor-registrations/:code` | `VisitView` (không kèm `idNumber`, `phone`, `email`) |
| `listVisits(params)` | `GET /visitors/visits` | `{ items: VisitView[], total, counts }` |
| `getVisit(id)` | `GET /visitors/visits/:id` | `VisitView` |
| `listVisitsOfVisitor(id)` | `GET /visitors/visits/:id/related` | `VisitView[]` cùng số giấy tờ hoặc số điện thoại |
| `createVisit(payload)` | `POST /visitors/visits` | `VisitView`; `payload.channel` là `walk_in` hoặc `host_invite` |
| `approveVisit(id, { access })` | `POST …/approve` | `VisitView` |
| `rejectVisit(id, { reason })` | `POST …/reject` | `VisitView` |
| `cancelVisit(id)` | `POST …/cancel` | `VisitView` |
| `revokeVisit(id, { reason })` | `POST …/revoke` | `VisitView` |
| `extendVisit(id, { validTo })` | `POST …/extend` | `VisitView` |
| `attachVisitorPhoto(id, { photo })` | `POST …/photo` | `VisitView` |
| `verifyFaceAtGate(id, { zoneId, scenario })` | `POST …/verify-face` | `{ outcome, reason, score, at, visit }` |
| `checkInVisit(id, { note })` | `POST …/check-in` | `VisitView` |
| `checkOutVisit(id)` | `POST …/check-out` | `VisitView` |
| `getDeskToday()` | `GET /visitors/desk/today` | `{ kpis: { expected, arrived, onSite, overstay }, items, alerts }` |
| `getMyVisits()` | `GET /visitors/my-visits` | `{ pending, upcoming, past }` |
| `getMyNotifications()` | `GET /visitors/my-notifications` | `[{ id, visitId, type, message, createdAt, read }]` mới nhất trước |
| `markMyNotificationsRead()` | `POST /visitors/my-notifications/read` | `{ updated }` |
| `getVisitorStats({ from, to, departmentId, groupBy })` | `GET /visitors/stats` | `{ kpis, byPeriod, byDepartment, byPurpose, byHour, topOrganizations }` |
| `resetDemoData()` | chỉ có ở chế độ giả | `{ reset: true }` |

`VisitView` = `Visit` cộng `hostName`, `departmentName`, `zoneNames`, `overstay`, `availableActions`.

`payload` tạo lượt: `{ visitor: { fullName, idNumber, phone, email, organization, plateNumber, photo }, hostId, purpose, companions, scheduledFrom, scheduledTo, consent }`.

`params` của `listVisits`: `{ status, from, to, departmentId, hostId, q, page = 1, limit = 10 }`. `status` nhận một trạng thái hoặc `'closed'` (gộp `rejected`, `cancelled`, `revoked`, `expired`). `from`/`to` là `YYYY-MM-DD`, lọc theo `scheduledFrom`, tính cả hai đầu. `q` so khớp không phân biệt hoa thường và dấu trên tên, số giấy tờ, điện thoại, đơn vị công tác, mã lượt. Sắp xếp `scheduledFrom` giảm dần. `counts = { pending_approval, approved, checked_in, checked_out, closed }` tính theo mọi bộ lọc trừ `status`.

`scenario` của `verifyFaceAtGate`: `'normal'` (thời điểm = hiện tại nếu đang trong khung hiệu lực, ngược lại lấy `scheduledFrom`; độ khớp 0.82–0.99 tất định theo `id`), `'low_score'` (độ khớp 0.71), `'outside_window'` (thời điểm = `validTo` + 2 giờ).

**Hành vi từng thao tác**

| Hàm | Kiểm tra | Đổi dữ liệu | Sự kiện thêm | Thông báo cho người được gặp |
|---|---|---|---|---|
| `createPublicRegistration` | `validateVisitPayload(payload, 'online')` | `pending_approval`, quyền mặc định | `registered`, `email_sent` | `pending_approval` |
| `createVisit` | `validateVisitPayload(payload, channel)` | `approved`, quyền mặc định | `registered`, `approved`, `email_sent` nếu có email | `visitor_registered` nếu `walk_in` |
| `approveVisit` | `nextStatus`; `access.validTo` phải sau `access.validFrom` | `approved`; `access` = giá trị gửi lên hoặc giữ mặc định | `approved`, `email_sent` | — |
| `rejectVisit` | `nextStatus`; `reason` không rỗng | `rejected`, `rejectReason` | `rejected`, `email_sent` | — |
| `cancelVisit` | `nextStatus` | `cancelled` | `cancelled` | — |
| `revokeVisit` | `nextStatus`; `reason` không rỗng | `revoked` | `revoked`, `face_removed` | — |
| `extendVisit` | `canExtend`, sai thì lỗi "Thời điểm gia hạn phải sau hiệu lực hiện tại" | `access.validTo` | `extended` | — |
| `attachVisitorPhoto` | `photo` là data URL ảnh | `visitor.photo`, `hasPhoto: true` | `photo_added` | — |
| `verifyFaceAtGate` | `evaluateGateAttempt` | `checked_in` + `checkInAt` + `faceScore` khi `outcome = 'checked_in'` | `face_verified` + `check_in` + `host_notified`; hoặc `manual_review`; hoặc `access_denied` | `visitor_arrived` khi check-in |
| `checkInVisit` | `nextStatus`; `note` không rỗng | `checked_in`, `checkInAt` | `check_in` (ghi chú), `host_notified` | `visitor_arrived` |
| `checkOutVisit` | `nextStatus` | `checked_out`, `checkOutAt` | `check_out`, `face_removed`, `host_notified` | `visitor_left` |
| mọi hàm đọc | — | lượt `shouldExpire` chuyển `expired`; lượt `isOverstay` chưa báo thì gắn `overstayNotified` | `expired` + `face_removed` | `visitor_overstay` (một lần mỗi lượt) |

Mọi thao tác ghi gắn `userTouched: true` lên lượt. Lượt người dùng tạo có `id = 'u-' + Date.now()` và `code` lấy số thứ tự kế tiếp trong ngày hẹn.

**`validateVisitPayload(payload, channel, now?)`** ném `Error` với đúng thông điệp:

| Điều kiện | Thông điệp |
|---|---|
| thiếu `visitor.fullName` | `Vui lòng nhập họ tên khách` |
| `visitor.phone` không khớp `/^0\d{9}$/` | `Số điện thoại không hợp lệ` |
| kênh `online` mà email rỗng hoặc sai định dạng | `Vui lòng nhập email hợp lệ để nhận kết quả` |
| thiếu `hostId` hoặc không có trong `hosts` | `Vui lòng chọn người cần gặp` |
| thiếu `purpose` | `Vui lòng chọn mục đích` |
| `scheduledFrom` trước `now` quá 5 phút | `Thời gian bắt đầu không được ở quá khứ` |
| `scheduledTo` không sau `scheduledFrom` | `Thời gian kết thúc phải sau thời gian bắt đầu` |
| dài hơn 7 ngày | `Khung giờ hẹn tối đa 7 ngày` |
| kênh `online`/`walk_in` mà thiếu `visitor.photo` | `Vui lòng chụp hoặc tải ảnh khuôn mặt` |
| kênh `online`/`walk_in` mà `consent !== true` | `Cần đồng ý xử lý dữ liệu sinh trắc để tiếp tục` |

- [ ] **Step 1: Viết test**

```js
// src/mocks/visitorReport/visitorApi.test.js
import * as svc from '../../service/visitorService';
import { resetState } from './store';
import { ME_HOST_ID } from './seed';

const HOUR = 3600000;
const PHOTO = 'data:image/jpeg;base64,AAAA';
const payload = (over = {}) => ({
    visitor: { fullName: 'Trần Thị Demo', idNumber: '001099000111', phone: '0912345678', email: 'demo@example.com', organization: 'Công ty CP MISA', plateNumber: '', photo: PHOTO },
    hostId: ME_HOST_ID,
    purpose: 'Làm việc với đơn vị',
    companions: 0,
    scheduledFrom: new Date(Date.now() + HOUR).toISOString(),
    scheduledTo: new Date(Date.now() + 3 * HOUR).toISOString(),
    consent: true,
    ...over,
});
const ok = async (promise) => {
    const res = await promise;
    expect(res.success).toBe(true);
    return res.data;
};

beforeEach(() => {
    resetState();
});

test('luồng trọn vẹn: đăng ký → duyệt → nhận diện → rời', async () => {
    const created = await ok(svc.createPublicRegistration(payload()));
    expect(created.status).toBe('pending_approval');
    expect(created.code).toMatch(/^VS-\d{6}-\d{4}$/);
    expect(created.availableActions).toEqual(expect.arrayContaining(['approve', 'reject']));

    const pendingList = await ok(svc.listVisits({ status: 'pending_approval', q: 'tran thi demo' }));
    expect(pendingList.items.map((v) => v.id)).toContain(created.id);

    const approved = await ok(svc.approveVisit(created.id, {}));
    expect(approved.status).toBe('approved');
    expect(approved.access.zoneIds).toContain('zone-gate-main');

    const gate = await ok(svc.verifyFaceAtGate(created.id, { zoneId: 'zone-gate-main', scenario: 'normal' }));
    expect(gate.outcome).toBe('checked_in');
    expect(gate.score).toBeGreaterThanOrEqual(0.8);
    expect(gate.visit.status).toBe('checked_in');

    const left = await ok(svc.checkOutVisit(created.id));
    expect(left.status).toBe('checked_out');
    expect(left.events.map((e) => e.type)).toEqual(expect.arrayContaining(['registered', 'approved', 'face_verified', 'check_in', 'check_out', 'face_removed']));

    const notes = await ok(svc.getMyNotifications());
    const types = notes.filter((n) => n.visitId === created.id).map((n) => n.type);
    expect(types).toEqual(expect.arrayContaining(['pending_approval', 'visitor_arrived', 'visitor_left']));
});

test('ngoài khung giờ và sai khu vực bị chặn, lượt vẫn approved', async () => {
    const v = await ok(svc.createVisit({ ...payload(), channel: 'walk_in' }));
    const late = await ok(svc.verifyFaceAtGate(v.id, { zoneId: 'zone-gate-main', scenario: 'outside_window' }));
    expect(late).toMatchObject({ outcome: 'access_denied', reason: 'outside_window' });
    const wrong = await ok(svc.verifyFaceAtGate(v.id, { zoneId: 'zone-b2', scenario: 'normal' }));
    expect(wrong).toMatchObject({ outcome: 'access_denied', reason: 'zone_not_allowed' });
    expect((await ok(svc.getVisit(v.id))).status).toBe('approved');
});

test('độ khớp thấp → lễ tân check-in tay kèm ghi chú', async () => {
    const v = await ok(svc.createVisit({ ...payload(), channel: 'walk_in' }));
    const low = await ok(svc.verifyFaceAtGate(v.id, { zoneId: 'zone-gate-main', scenario: 'low_score' }));
    expect(low).toMatchObject({ outcome: 'manual_review', reason: 'low_score' });
    expect((await svc.checkInVisit(v.id, { note: '' })).success).toBe(false);
    expect((await ok(svc.checkInVisit(v.id, { note: 'Đã đối chiếu CCCD' }))).status).toBe('checked_in');
});

test('khách được mời hộ chưa có ảnh: không tự check-in được cho tới khi bổ sung ảnh', async () => {
    const v = await ok(svc.createVisit({ ...payload({ visitor: { ...payload().visitor, photo: null } }), channel: 'host_invite', consent: false }));
    expect(v.visitor.hasPhoto).toBe(false);
    expect((await ok(svc.verifyFaceAtGate(v.id, { zoneId: 'zone-gate-main', scenario: 'normal' }))).reason).toBe('no_photo');
    await ok(svc.attachVisitorPhoto(v.id, { photo: PHOTO }));
    expect((await ok(svc.verifyFaceAtGate(v.id, { zoneId: 'zone-gate-main', scenario: 'normal' }))).outcome).toBe('checked_in');
});

test('từ chối cần lý do; thao tác trên lượt đã đóng bị từ chối', async () => {
    const v = await ok(svc.createPublicRegistration(payload()));
    expect((await svc.rejectVisit(v.id, { reason: ' ' })).success).toBe(false);
    expect((await ok(svc.rejectVisit(v.id, { reason: 'Trùng lịch' }))).rejectReason).toBe('Trùng lịch');
    const again = await svc.approveVisit(v.id, {});
    expect(again.success).toBe(false);
    expect(again.message).toContain('Không thể');
});

test('gia hạn phải sau hiệu lực hiện tại', async () => {
    const v = await ok(svc.createVisit({ ...payload(), channel: 'walk_in' }));
    expect((await svc.extendVisit(v.id, { validTo: v.access.validFrom })).success).toBe(false);
    const later = new Date(new Date(v.access.validTo).getTime() + HOUR).toISOString();
    expect((await ok(svc.extendVisit(v.id, { validTo: later }))).access.validTo).toBe(later);
});

test.each([
    [{ visitor: { ...payload().visitor, fullName: '' } }, 'Vui lòng nhập họ tên khách'],
    [{ visitor: { ...payload().visitor, phone: '12345' } }, 'Số điện thoại không hợp lệ'],
    [{ visitor: { ...payload().visitor, email: 'sai' } }, 'Vui lòng nhập email hợp lệ để nhận kết quả'],
    [{ hostId: 'khong-co' }, 'Vui lòng chọn người cần gặp'],
    [{ scheduledFrom: new Date(Date.now() - 2 * HOUR).toISOString() }, 'Thời gian bắt đầu không được ở quá khứ'],
    [{ scheduledTo: new Date(Date.now() + HOUR).toISOString() }, 'Thời gian kết thúc phải sau thời gian bắt đầu'],
    [{ scheduledTo: new Date(Date.now() + 9 * 24 * HOUR).toISOString() }, 'Khung giờ hẹn tối đa 7 ngày'],
    [{ visitor: { ...payload().visitor, photo: null } }, 'Vui lòng chụp hoặc tải ảnh khuôn mặt'],
    [{ consent: false }, 'Cần đồng ý xử lý dữ liệu sinh trắc để tiếp tục'],
])('đăng ký công khai sai dữ liệu %#', async (over, message) => {
    const res = await svc.createPublicRegistration(payload(over));
    expect(res).toEqual({ success: false, message });
});

test('tra cứu công khai: ẩn dữ liệu cá nhân, mã sai trả lỗi', async () => {
    const v = await ok(svc.createPublicRegistration(payload()));
    const pub = await ok(svc.getPublicRegistration(v.code));
    expect(pub.code).toBe(v.code);
    expect(pub.visitor.idNumber).toBeUndefined();
    expect(pub.visitor.phone).toBeUndefined();
    expect(await svc.getPublicRegistration('VS-000000-0000')).toEqual({ success: false, message: 'Không tìm thấy lượt đăng ký với mã này' });
});

test('quầy lễ tân và thống kê đọc cùng kho dữ liệu', async () => {
    const desk = await ok(svc.getDeskToday());
    expect(desk.kpis.expected).toBeGreaterThanOrEqual(14);
    expect(desk.kpis.overstay).toBeGreaterThanOrEqual(1);
    const mine = await ok(svc.getMyVisits());
    expect(mine.pending.length).toBeGreaterThanOrEqual(2);
    const today = new Date();
    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const stats = await ok(svc.getVisitorStats({ from: ymd(new Date(today.getTime() - 29 * 24 * HOUR)), to: ymd(today), groupBy: 'day' }));
    expect(stats.kpis.totalVisits).toBeGreaterThan(50);
    expect(stats.byDepartment.reduce((sum, d) => sum + d.count, 0)).toBe(stats.kpis.totalVisits);
});

test('phân trang và đếm theo tab', async () => {
    const page1 = await ok(svc.listVisits({ page: 1, limit: 10 }));
    expect(page1.items).toHaveLength(10);
    expect(page1.total).toBeGreaterThanOrEqual(350);
    const { counts } = page1;
    expect(counts.pending_approval + counts.approved + counts.checked_in + counts.checked_out + counts.closed).toBe(page1.total);
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/visitorApi.test.js`
Expected: FAIL, `Cannot find module '../../service/visitorService'`

- [ ] **Step 3: Viết `visitorApi.js`.** Mỗi hàm ở bảng Interfaces là một hàm đồng bộ cùng tên, nhận cùng tham số, trả thẳng `data` hoặc ném `Error`. Cài đúng bảng "Hành vi từng thao tác" và `validateVisitPayload`. Xuất thêm `selectVisitsInRange(state, { from, to, departmentId })` (các lượt có ngày của `scheduledFrom` nằm trong kỳ, tính cả hai đầu) để Task 5 dùng cho báo cáo khách. Gọi "lượt đã đến" là lượt trong tập đó có `checkInAt`. Định nghĩa thống kê:
  - `totalVisits` = số lượt đã đến; `uniqueVisitors` đếm lượt đã đến theo `idNumber || phone`.
  - `avgStayMinutes` = trung bình `checkOutAt − checkInAt` của lượt `checked_out`, làm tròn.
  - `overstayCount` = lượt có `checkOutAt` sau `access.validTo`, hoặc đang `isOverstay`.
  - `noShowRate` = `expired / (expired + totalVisits)` trên tập `selectVisitsInRange`, phần trăm làm tròn 1 chữ số; mẫu số 0 thì trả 0.
  - Các phân bố dưới đây đều đếm trên lượt đã đến. `byPeriod: [{ bucket, count }]` theo `groupBy` (`day` → `DD/MM`, `week` → `Tuần DD/MM` của thứ Hai, `month` → `MM/YYYY`); `byDepartment: [{ departmentId, name, count }]` giảm dần; `byPurpose: [{ purpose, count }]`; `byHour: [{ hour, count }]` từ 7 đến 18; `topOrganizations: [{ organization, count }]` 8 dòng đầu.

- [ ] **Step 4: Viết `visitorService.js`**

```js
// src/service/visitorService.js
// Hợp đồng API phân hệ Khách đến làm việc (2.10) — spec §6.4.
// Cờ mock bật: đọc dữ liệu giả. Cờ tắt: gọi BE thật qua utils/request.
import { get, post, buildQuery } from '../utils/request';
import { VISITOR_REPORT_MOCK_ENABLED } from '../config/featureFlags';
import * as mock from '../mocks/visitorReport/visitorApi';

const delay = () =>
    new Promise((resolve) => setTimeout(resolve, process.env.NODE_ENV === 'test' ? 0 : 200 + Math.random() * 300));

const call = async (mockFn, realFn) => {
    if (!VISITOR_REPORT_MOCK_ENABLED) return realFn();
    await delay();
    try {
        return { success: true, data: mockFn() };
    } catch (error) {
        return { success: false, message: error.message };
    }
};

const qs = (params) => {
    const query = buildQuery(params || {});
    return query ? `?${query}` : '';
};

export const getVisitorLookups = () => call(() => mock.getVisitorLookups(), () => get('/visitors/lookups'));
export const searchHosts = (q) => call(() => mock.searchHosts(q), () => get(`/public/visitor-hosts${qs({ q })}`));
export const createPublicRegistration = (payload) => call(() => mock.createPublicRegistration(payload), () => post('/public/visitor-registrations', payload));
export const getPublicRegistration = (code) => call(() => mock.getPublicRegistration(code), () => get(`/public/visitor-registrations/${encodeURIComponent(code)}`));
export const listVisits = (params) => call(() => mock.listVisits(params), () => get(`/visitors/visits${qs(params)}`));
export const getVisit = (id) => call(() => mock.getVisit(id), () => get(`/visitors/visits/${id}`));
export const listVisitsOfVisitor = (id) => call(() => mock.listVisitsOfVisitor(id), () => get(`/visitors/visits/${id}/related`));
export const createVisit = (payload) => call(() => mock.createVisit(payload), () => post('/visitors/visits', payload));
export const approveVisit = (id, body) => call(() => mock.approveVisit(id, body), () => post(`/visitors/visits/${id}/approve`, body));
export const rejectVisit = (id, body) => call(() => mock.rejectVisit(id, body), () => post(`/visitors/visits/${id}/reject`, body));
export const cancelVisit = (id) => call(() => mock.cancelVisit(id), () => post(`/visitors/visits/${id}/cancel`));
export const revokeVisit = (id, body) => call(() => mock.revokeVisit(id, body), () => post(`/visitors/visits/${id}/revoke`, body));
export const extendVisit = (id, body) => call(() => mock.extendVisit(id, body), () => post(`/visitors/visits/${id}/extend`, body));
export const attachVisitorPhoto = (id, body) => call(() => mock.attachVisitorPhoto(id, body), () => post(`/visitors/visits/${id}/photo`, body));
export const verifyFaceAtGate = (id, body) => call(() => mock.verifyFaceAtGate(id, body), () => post(`/visitors/visits/${id}/verify-face`, body));
export const checkInVisit = (id, body) => call(() => mock.checkInVisit(id, body), () => post(`/visitors/visits/${id}/check-in`, body));
export const checkOutVisit = (id) => call(() => mock.checkOutVisit(id), () => post(`/visitors/visits/${id}/check-out`));
export const getDeskToday = () => call(() => mock.getDeskToday(), () => get('/visitors/desk/today'));
export const getMyVisits = () => call(() => mock.getMyVisits(), () => get('/visitors/my-visits'));
export const getMyNotifications = () => call(() => mock.getMyNotifications(), () => get('/visitors/my-notifications'));
export const markMyNotificationsRead = () => call(() => mock.markMyNotificationsRead(), () => post('/visitors/my-notifications/read'));
export const getVisitorStats = (params) => call(() => mock.getVisitorStats(params), () => get(`/visitors/stats${qs(params)}`));
export const resetDemoData = () => call(() => mock.resetDemoData(), () => Promise.resolve({ success: false, message: 'Chỉ dùng ở chế độ dữ liệu giả' }));
```

Trước khi dùng `buildQuery`, đọc `src/utils/request.js:65` để xác nhận nó trả chuỗi truy vấn không kèm dấu `?`; nếu có kèm thì bỏ dấu `?` trong `qs`.

- [ ] **Step 5: Chạy test, xác nhận xanh**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/visitorApi.test.js`
Expected: PASS, 18 tests

- [ ] **Step 6: Điểm dừng** — báo file đã đổi. Không commit.

### Task 5: Khai báo báo cáo, dữ liệu báo cáo, `reportCenterService` (phần xem trước)

**Files:**
- Create: `src/config/reportDefinitions.js`, `src/utils/reportFormat.js`, `src/mocks/visitorReport/reportData.js`, `src/mocks/visitorReport/reportApi.js`, `src/service/reportCenterService.js`
- Test: `src/mocks/visitorReport/reportApi.test.js`

Khai báo đặt ở `src/config/` (không phải `src/pages/shared/reports/` như spec §6.2) để lớp giả và service dùng được mà không import ngược từ thư mục trang.

**Interfaces:**
- Consumes: Task 3 (`loadState`, `mulberry32`, `hashSeed`, `pick`, `int`), Task 4 (`selectVisitsInRange`).
- Produces:
  - `reportFormat.js`: `formatCell(value, format): string`. Định dạng: `text` (rỗng → `—`), `number` (`1.234`), `percent` (`92,5%`), `hours` (`7,5 giờ`), `minutes` (`35 phút`), `duration` (giây → `2g 15p`), `datetime` (ISO → `07/10/2026 08:15`, rỗng → `—`).
  - `reportDefinitions.js`: `REPORT_TYPES: string[]` (7 mã theo thứ tự bảng dưới), `REPORT_DEFINITIONS`, `getReportDefinition(type): Definition|null`.
  - `Definition = { type, title, description, icon, filters: [{ key, label, lookup? , options? }], kpis: [{ key, label, format }], charts: [{ key, title, kind: 'line'|'bar'|'pie', xKey, series: [{ key, label }] }], columns: [{ key, label, format }] }`.
  - `reportData.js`: `validateRange(from, to)` (ném lỗi), `buildReport(type, filters, state, now?): { kpis: [{ key, value }], charts: [{ key, data }], rows: object[] }`, `getLookups(state)`.
  - `reportCenterService.js`: `getReportCatalog()` → `[{ type, title, description, activeSchedules, lastExportAt }]`; `getReportLookups()` → `{ departments, staff, semesters, subjects, classSections, zones, gates, buildings, rooms, purposes }`, mỗi phần tử `{ id, name }`; `getReportPreview(type, params)` → `{ kpis, charts, rows, total }` với `params = { from, to, q, page = 1, limit = 20, sortKey, sortDir: 'asc'|'desc', ...bộ lọc riêng }`.

**Bảng khai báo 7 loại** (khóa viết đúng như dưới; `lookup:` trỏ tới khóa của `getReportLookups`)

| `type` / tiêu đề / icon | `filters` | `kpis` (khóa: nhãn, định dạng) | `charts` (khóa: tiêu đề, loại, `xKey`, chuỗi) | `columns` (khóa: nhãn, định dạng) |
|---|---|---|---|---|
| `staff-attendance` · Chuyên cần cán bộ · `Briefcase` | `departmentId`: Đơn vị (lookup departments); `staffId`: Cán bộ (lookup staff) | `attendanceRate`: Tỷ lệ chuyên cần, percent; `lateCount`: Lượt đi muộn; `earlyLeaveCount`: Lượt về sớm; `absentDays`: Ngày vắng; `avgHoursPerDay`: Giờ hiện diện TB/ngày, hours | `daily`: Tỷ lệ chuyên cần theo ngày, line, `date`, `rate` "Tỷ lệ (%)"; `byDepartment`: So sánh theo đơn vị, bar, `name`, `rate` | `employeeCode`: Mã CB; `fullName`: Họ tên; `departmentName`: Đơn vị; `workDays`: Ngày công, number; `onTime`: Đúng giờ, number; `late`: Đi muộn, number; `earlyLeave`: Về sớm, number; `absent`: Vắng, number; `totalHours`: Tổng giờ hiện diện, hours; `rate`: Tỷ lệ, percent |
| `student-attendance` · Chuyên cần sinh viên · `GraduationCap` | `semesterId`: Học kỳ (semesters); `subjectId`: Môn học (subjects); `classSectionId`: Lớp học phần (classSections) | `attendanceRate`: percent; `sessionCount`: Số buổi; `absentCount`: Lượt vắng; `lateCount`: Lượt muộn; `atRiskStudents`: SV vắng quá 20% | `weekly`: Tỷ lệ chuyên cần theo tuần, line, `week`, `rate`; `bySection`: So sánh theo lớp học phần, bar, `name`, `rate` | `studentCode`: MSSV; `fullName`; `classSectionName`: Lớp học phần; `subjectName`: Môn; `sessions`: Số buổi, number; `present`: Có mặt, number; `late`: Muộn, number; `absent`: Vắng, number; `rate`: Tỷ lệ, percent; `warning`: Cảnh báo |
| `gate-access` · Ra vào khuôn viên · `DoorOpen` | `zoneId`: Cổng (gates); `departmentId`: Đơn vị (departments); `subjectType`: Đối tượng (options `staff` Cán bộ, `student` Sinh viên, `visitor` Khách, `unknown` Vãng lai) | `entries`: Lượt vào; `exits`: Lượt ra; `onSite`: Đang trong khuôn viên; `avgStayMinutes`: Lưu trú TB, minutes | `hourly`: Lượt vào/ra theo giờ, bar, `hour`, `entries` "Lượt vào" + `exits` "Lượt ra"; `byZone`: Theo cổng, bar, `name`, `entries` | `zoneName`: Khu vực; `code`: Mã; `fullName`; `departmentName`; `plateNumber`: Biển số; `checkInTime`: Giờ vào, datetime; `checkOutTime`: Giờ ra, datetime; `durationSeconds`: Thời lượng, duration |
| `room-utilization` · Sử dụng phòng họp · `Building2` | `building`: Tòa nhà (buildings); `roomId`: Phòng (rooms) | `meetingCount`: Số cuộc họp; `utilizationRate`: Tỷ lệ sử dụng, percent; `noShowRate`: Tỷ lệ không đến, percent; `usedHours`: Tổng giờ dùng, hours | `daily`: Giờ sử dụng theo ngày, line, `date`, `usedHours` "Giờ sử dụng"; `byRoom`: Tỷ lệ sử dụng theo phòng, bar, `name`, `utilizationRate` | `roomName`: Phòng; `building`: Tòa nhà; `capacity`: Sức chứa, number; `meetingCount`, number; `bookedHours`: Giờ đặt, hours; `usedHours`: Giờ thực dùng, hours; `utilizationRate`, percent; `noShowCount`: Không đến, number |
| `vehicle` · Phương tiện · `Car` | `zoneId`: Cổng (gates); `vehicleType`: Loại xe (options `car` Ô tô, `motorbike` Xe máy); `registrationStatus`: Trạng thái (options `registered` Đã đăng ký, `unregistered` Chưa đăng ký, `watchlist` Danh sách kiểm soát) | `total`: Tổng lượt; `cars`: Ô tô; `motorbikes`: Xe máy; `unregistered`: Chưa đăng ký; `watchlist`: Thuộc danh sách kiểm soát | `hourly`: Lưu lượng theo giờ, bar, `hour`, `count` "Lượt xe"; `byType`: Cơ cấu loại xe, pie, `name`, `count` | `plateNumber`: Biển số; `vehicleTypeLabel`: Loại xe; `ownerName`: Chủ xe; `departmentName`: Đơn vị; `zoneName`: Cổng; `checkInTime`, datetime; `checkOutTime`, datetime; `durationSeconds`, duration; `statusLabel`: Trạng thái |
| `visitor` · Khách đến làm việc · `UserCheck` | `departmentId`: Đơn vị tiếp (departments); `purpose`: Mục đích (purposes); `status`: Trạng thái (options `checked_in` Đang trong khuôn viên, `checked_out` Đã rời, `expired` Không đến) | `totalVisits`: Tổng lượt; `uniqueVisitors`: Khách duy nhất; `avgStayMinutes`: Lưu trú TB, minutes; `overstayCount`: Lượt quá giờ; `noShowRate`: Tỷ lệ không đến, percent | `daily`: Lượt khách theo ngày, line, `date`, `count` "Lượt khách"; `byDepartment`: Theo đơn vị tiếp, bar, `name`, `count` | `code`: Mã lượt; `visitorName`: Khách; `organization`: Đơn vị công tác; `hostName`: Người gặp; `departmentName`: Đơn vị tiếp; `purpose`: Mục đích; `checkInTime`, datetime; `checkOutTime`, datetime; `durationSeconds`, duration; `statusLabel` |
| `security-alert` · Sự kiện an ninh · `ShieldAlert` | `alertType`: Loại (options `stranger` Người lạ, `watchlist_person` Người thuộc danh sách kiểm soát, `vehicle` Phương tiện bất thường, `intrusion` Xâm nhập khu vực cấm, `crowd` Tụ tập đông người, `camera_offline` Camera mất tín hiệu); `severity`: Mức độ (options `low` Thấp, `medium` Trung bình, `high` Cao, `critical` Nghiêm trọng); `zoneId`: Khu vực (zones); `status`: Trạng thái (options `open` Chưa xử lý, `acknowledged` Đã tiếp nhận, `resolved` Đã xử lý) | `total`: Tổng sự kiện; `critical`: Mức nghiêm trọng; `resolved`: Đã xử lý; `avgResolveMinutes`: Thời gian xử lý TB, minutes | `daily`: Sự kiện theo ngày, bar, `date`, `count` "Sự kiện"; `byType`: Cơ cấu theo loại, pie, `name`, `count` | `occurredAt`: Thời gian, datetime; `typeLabel`: Loại; `severityLabel`: Mức độ; `zoneName`: Khu vực; `cameraName`: Camera; `subject`: Đối tượng; `statusLabel`; `handlerName`: Người xử lý; `resolveMinutes`: Thời gian xử lý, minutes |

`description` mỗi loại là một câu mô tả bằng tiếng Việt (ví dụ "Ngày công, đi muộn, về sớm và giờ hiện diện của cán bộ theo đơn vị").

**Kiến trúc `reportData.js`:** mỗi loại có `{ facts(state, from, to, now), summarize(facts, context) }`. `buildReport` gọi `validateRange` → `facts` → lọc chung (với mỗi khóa trong `filters` khác `from`, `to`, `q`, `page`, `limit`, `sortKey`, `sortDir` và có giá trị: giữ fact có `fact[khóa] === giá trị`) → `summarize` trả `{ kpis, charts, rows }`. `reportApi.getReportPreview` sau đó lọc `q` (không phân biệt hoa thường và dấu, trên mọi cột định dạng `text`), sắp xếp, cắt trang. Fact chỉ sinh cho ngày trong khoảng [hôm nay − 400 ngày, hôm nay]; ngoài khoảng đó trả rỗng và mọi KPI bằng 0.

**Quy tắc sinh fact** (mỗi ngày dùng `mulberry32(hashSeed('<loại>:' + yyyymmdd + ':' + khóa thực thể))`)

| Loại | Một fact là | Quy tắc |
|---|---|---|
| `staff-attendance` | cán bộ × ngày thường (60 cán bộ của `state.hosts`, bỏ `host-me`) | 3% vắng. Còn lại: giờ vào 07:40–08:35, muộn nếu sau 08:15; giờ ra 16:30–18:00, về sớm nếu trước 17:00; giờ hiện diện = hiệu hai mốc. Dòng bảng gộp theo cán bộ; `rate` = ngày đúng giờ / ngày công. |
| `student-attendance` | sinh viên × buổi học | 2 học kỳ: `HK1 2026-2027` (từ 2026-09-07) và `HK hè 2026` (2026-06-01 đến 2026-08-15). 6 môn, 8 lớp học phần, mỗi lớp 35–40 sinh viên trong 300 sinh viên (MSSV `HE18` + 4 chữ số), 2 buổi/tuần vào hai thứ cố định. Mỗi buổi: 88% có mặt, 5% muộn, 7% vắng; 5% sinh viên thuộc nhóm hay vắng (30% vắng). `warning` = "Vắng quá 20%" khi `absent / sessions > 0.2`. |
| `gate-access` | phiên ra vào | Ngày thường 60–90 phiên, cuối tuần 8–15. Đối tượng: cán bộ 45%, sinh viên 40%, khách 5%, vãng lai 10%. Cổng chính 70%, cổng phụ 30%. Giờ vào 06:30–17:00, lưu trú 30–540 phút. Vãng lai không có tên và đơn vị, 60% có biển số. `onSite` = phiên của hôm nay có giờ ra sau thời điểm hiện tại. |
| `room-utilization` | cuộc họp | 10 phòng chia cho 4 tòa, sức chứa 8–40. Ngày thường mỗi phòng 0–4 cuộc họp dài 1–2 giờ; 9% không đến (giờ dùng 0), còn lại dùng 70–100% giờ đặt. `utilizationRate` = giờ dùng / (số ngày thường trong kỳ × 9 giờ). |
| `vehicle` | lượt xe | Ngày thường 35–60, cuối tuần 5–10. Xe máy 70%, ô tô 30%. Đã đăng ký 85%, chưa đăng ký 12%, danh sách kiểm soát 3%. Xe chưa đăng ký không có chủ xe. |
| `visitor` | lượt khách của `selectVisitsInRange(state, { from, to })` có `checkInAt` hoặc có trạng thái `expired` | KPI lấy đúng công thức thống kê ở Task 4. Bộ lọc `status` so với trạng thái hiện tại của lượt. Danh sách tra cứu `purposes` có `id` bằng chính chuỗi mục đích. `statusLabel` theo trạng thái; lượt quá giờ thêm " (quá giờ)". |
| `security-alert` | sự kiện | 2–8 sự kiện mỗi ngày. Mức độ: thấp 40%, trung bình 35%, cao 20%, nghiêm trọng 5%. Sự kiện cũ hơn 2 ngày: 90% đã xử lý; mới hơn: chia đều ba trạng thái. Thời gian xử lý 5–180 phút, chỉ có khi đã xử lý. Camera `CAM-<mã khu>-<01..04>`. |

- [ ] **Step 1: Viết test**

```js
// src/mocks/visitorReport/reportApi.test.js
import { REPORT_TYPES, REPORT_DEFINITIONS, getReportDefinition } from '../../config/reportDefinitions';
import { formatCell } from '../../utils/reportFormat';
import * as svc from '../../service/reportCenterService';
import * as visitorSvc from '../../service/visitorService';
import { resetState } from './store';

const DAY = 86400000;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const RANGE = { from: ymd(new Date(Date.now() - 29 * DAY)), to: ymd(new Date()) };
const ok = async (promise) => {
    const res = await promise;
    expect(res.success).toBe(true);
    return res.data;
};

beforeEach(() => resetState());

test('có đúng 7 loại báo cáo, đủ khai báo', () => {
    expect(REPORT_TYPES).toEqual(['staff-attendance', 'student-attendance', 'gate-access', 'room-utilization', 'vehicle', 'visitor', 'security-alert']);
    REPORT_TYPES.forEach((type) => {
        const def = getReportDefinition(type);
        expect(def.title).toBeTruthy();
        expect(def.columns.length).toBeGreaterThanOrEqual(8);
        expect(def.charts).toHaveLength(2);
    });
    expect(getReportDefinition('khong-co')).toBeNull();
});

test.each(REPORT_TYPES)('xem trước %s khớp khai báo', async (type) => {
    const def = REPORT_DEFINITIONS[type];
    const data = await ok(svc.getReportPreview(type, { ...RANGE, page: 1, limit: 20 }));
    expect(data.kpis.map((k) => k.key)).toEqual(def.kpis.map((k) => k.key));
    expect(data.charts.map((c) => c.key)).toEqual(def.charts.map((c) => c.key));
    data.charts.forEach((c) => expect(c.data.length).toBeGreaterThan(0));
    expect(data.rows.length).toBeGreaterThan(0);
    expect(data.rows.length).toBeLessThanOrEqual(20);
    expect(data.total).toBeGreaterThanOrEqual(data.rows.length);
    def.columns.forEach((col) => expect(data.rows[0]).toHaveProperty(col.key));
    expect(await ok(svc.getReportPreview(type, { ...RANGE, page: 1, limit: 20 }))).toEqual(data);
});

test('lọc theo đơn vị, sắp xếp, tìm kiếm', async () => {
    const byDept = await ok(svc.getReportPreview('staff-attendance', { ...RANGE, departmentId: 'dep-cntt', limit: 50 }));
    expect(byDept.total).toBe(5);
    byDept.rows.forEach((r) => expect(r.departmentName).toBe('Khoa Công nghệ thông tin'));

    const sorted = await ok(svc.getReportPreview('staff-attendance', { ...RANGE, sortKey: 'rate', sortDir: 'asc', limit: 50 }));
    const rates = sorted.rows.map((r) => r.rate);
    expect(rates).toEqual([...rates].sort((a, b) => a - b));

    const first = (await ok(svc.getReportPreview('staff-attendance', { ...RANGE }))).rows[0];
    const found = await ok(svc.getReportPreview('staff-attendance', { ...RANGE, q: first.employeeCode.toLowerCase() }));
    expect(found.rows.map((r) => r.employeeCode)).toEqual([first.employeeCode]);
});

test('báo cáo khách khớp màn thống kê khách', async () => {
    const report = await ok(svc.getReportPreview('visitor', { ...RANGE }));
    const stats = await ok(visitorSvc.getVisitorStats({ ...RANGE, groupBy: 'day' }));
    const kpi = (key) => report.kpis.find((k) => k.key === key).value;
    expect(kpi('totalVisits')).toBe(stats.kpis.totalVisits);
    expect(kpi('uniqueVisitors')).toBe(stats.kpis.uniqueVisitors);
});

test.each(REPORT_TYPES)('kỳ không có dữ liệu: %s trả rỗng, KPI bằng 0', async (type) => {
    const data = await ok(svc.getReportPreview(type, { from: '2020-01-01', to: '2020-01-07' }));
    expect(data.rows).toEqual([]);
    expect(data.total).toBe(0);
    data.kpis.forEach((k) => expect(k.value).toBe(0));
});

test('tham số sai trả thông điệp rõ ràng', async () => {
    expect(await svc.getReportPreview('khong-co', RANGE)).toEqual({ success: false, message: 'Loại báo cáo không tồn tại' });
    expect(await svc.getReportPreview('vehicle', { from: '2026-10-07', to: '2026-10-01' })).toEqual({ success: false, message: 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc' });
    expect(await svc.getReportPreview('vehicle', { from: '2025-01-01', to: '2026-10-01' })).toEqual({ success: false, message: 'Kỳ báo cáo tối đa 366 ngày' });
    expect(await svc.getReportPreview('vehicle', { from: '', to: '2026-10-01' })).toEqual({ success: false, message: 'Vui lòng chọn kỳ báo cáo' });
});

test('danh mục và danh sách tra cứu', async () => {
    const catalog = await ok(svc.getReportCatalog());
    expect(catalog.map((c) => c.type)).toEqual(REPORT_TYPES);
    const lookups = await ok(svc.getReportLookups());
    expect(lookups.departments).toHaveLength(12);
    expect(lookups.staff).toHaveLength(60);
    expect(lookups.gates).toHaveLength(2);
    expect(lookups.rooms).toHaveLength(10);
    expect(lookups.classSections).toHaveLength(8);
});

test('định dạng ô', () => {
    expect(formatCell(1234, 'number')).toBe('1.234');
    expect(formatCell(92.5, 'percent')).toBe('92,5%');
    expect(formatCell(7.5, 'hours')).toBe('7,5 giờ');
    expect(formatCell(35, 'minutes')).toBe('35 phút');
    expect(formatCell(8100, 'duration')).toBe('2g 15p');
    expect(formatCell(null, 'duration')).toBe('—');
    expect(formatCell('', 'text')).toBe('—');
    expect(formatCell(null, 'datetime')).toBe('—');
});
```

- [ ] **Step 2: Chạy test, xác nhận đỏ**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/reportApi.test.js`
Expected: FAIL, `Cannot find module '../../config/reportDefinitions'`

- [ ] **Step 3: Viết `reportFormat.js`** — dùng `toLocaleString('vi-VN')` cho `number`; `percent`/`hours` làm tròn 1 chữ số, dấu thập phân là dấu phẩy; `datetime` tự ghép `DD/MM/YYYY HH:mm` theo giờ máy (không dùng `toLocaleString` để kết quả ổn định giữa trình duyệt).
- [ ] **Step 4: Viết `reportDefinitions.js`** đúng bảng khai báo.
- [ ] **Step 5: Viết `reportData.js`** đúng kiến trúc và bảng quy tắc sinh fact. `validateRange` ném theo thứ tự: thiếu `from`/`to` → "Vui lòng chọn kỳ báo cáo"; `from > to` → "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc"; dài hơn 366 ngày → "Kỳ báo cáo tối đa 366 ngày".
- [ ] **Step 6: Viết `reportApi.js`** (`getReportCatalog`, `getReportLookups`, `getReportPreview`; loại lạ ném "Loại báo cáo không tồn tại") và `reportCenterService.js` theo đúng mẫu `call(mockFn, realFn)` của `visitorService.js` (chép hàm `delay`, `call`, `qs` sang; endpoint thật: `GET /reports/catalog`, `GET /reports/lookups`, `GET /reports/:type/preview`).

- [ ] **Step 7: Chạy test, xác nhận xanh**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/reportApi.test.js`
Expected: PASS, 20 tests

- [ ] **Step 8: Điểm dừng** — báo file đã đổi. Không commit.

### Task 6: Lịch gửi, lần chạy, xuất file

**Files:**
- Create: `src/mocks/visitorReport/exporters.js`
- Modify: `src/mocks/visitorReport/seed.js` (điền `schedules`, `runs`, `exports`), `src/mocks/visitorReport/reportApi.js`, `src/service/reportCenterService.js`
- Test: `src/mocks/visitorReport/scheduleApi.test.js`, `src/mocks/visitorReport/exporters.test.js`

**Interfaces:**
- Consumes: Task 2 (`computeNextRun`, `resolvePeriod`), Task 5 (`buildReport`, `getReportDefinition`, `formatCell`, `getLookups`).
- Produces (`reportCenterService.js`):

| Hàm | Endpoint thật | `data` |
|---|---|---|
| `listSchedules()` | `GET /report-schedules` | `ScheduleView[]` mới nhất trước |
| `createSchedule(payload)` | `POST /report-schedules` | `ScheduleView` |
| `updateSchedule(id, payload)` | `PATCH /report-schedules/:id` | `ScheduleView` |
| `toggleSchedule(id, enabled)` | `PATCH /report-schedules/:id` | `ScheduleView` |
| `duplicateSchedule(id)` | `POST /report-schedules/:id/duplicate` | `ScheduleView` tên thêm " (bản sao)", `enabled: false` |
| `deleteSchedule(id)` | `DELETE /report-schedules/:id` | `{ deleted: true }` |
| `runScheduleNow(id)` | `POST /report-schedules/:id/run-now` | `Run` loại `manual` |
| `listScheduleRuns(params)` | `GET /report-schedule-runs` | `{ items: Run[], total }`; `params = { scheduleId, status, from, to, page = 1, limit = 10 }` |
| `retryScheduleRun(id)` | `POST /report-schedule-runs/:id/retry` | `Run` mới loại `manual`; lần cũ được gắn `retriedByRunId` |
| `downloadRunFile(runId, format)` | `GET /report-schedule-runs/:id/files/:format` | `{ fileName }` và tải file |
| `exportReport(type, params)` | `POST /reports/:type/exports` | `{ fileName, format }` và tải file; `params = { format, from, to, ...bộ lọc }` |
| `getRecentExports()` | `GET /reports/exports/recent` | 10 dòng mới nhất `{ id, reportType, reportTitle, format, from, to, fileName, createdAt }` |

```js
// Schedule
{ id, name, reportType, filters, period: 'yesterday'|'last_week'|'last_month',
  frequency: 'daily'|'weekly'|'monthly', time: 'HH:mm', dayOfWeek, dayOfMonth,
  formats: ['pdf'|'xlsx'|'docx'], recipients: [{ type: 'user'|'email', value, label }],
  subject, message, enabled, lastRunAt, createdAt, userTouched }
// ScheduleView = Schedule + { reportTitle, nextRunAt }   (nextRunAt: ISO hoặc null)
// Run
{ id, scheduleId, scheduleName, reportType, reportTitle, trigger: 'scheduled'|'manual',
  status: 'success'|'failed', from, to, formats, recipientCount, error, ranAt, retriedByRunId, userTouched }
```

  - `exporters.js`: `EMPTY_TEXT = 'Không có dữ liệu trong kỳ đã chọn'`, `buildFileName(type, from, to, format)`, `buildExportModel({ definition, filters, lookups, report, now })`, `buildWorkbook(model)`, `buildReportHtml(model)`, `runExport(format, model, fileName): boolean`.
  - `reportApi.js` thêm `prepareExport(type, params, now?): { model, fileName, record }` (hàm thuần trừ việc ghi `exports`); service gọi `runExport` sau đó.

**`validateSchedule(payload)`** ném theo thứ tự:

| Điều kiện | Thông điệp |
|---|---|
| `name` rỗng | `Vui lòng nhập tên lịch gửi` |
| `reportType` không thuộc `REPORT_TYPES` | `Loại báo cáo không tồn tại` |
| `period` lạ | `Kỳ dữ liệu không hợp lệ` |
| `frequency` lạ | `Tần suất không hợp lệ` |
| `time` không khớp `/^([01]\d|2[0-3]):[0-5]\d$/` | `Giờ gửi không hợp lệ` |
| `weekly` mà `dayOfWeek` không thuộc 0–6 | `Vui lòng chọn thứ trong tuần` |
| `monthly` mà `dayOfMonth` không thuộc 1–28 hoặc `'last'` | `Ngày trong tháng phải từ 1 đến 28 hoặc ngày cuối tháng` |
| `formats` rỗng hoặc có giá trị lạ | `Vui lòng chọn ít nhất một định dạng` |
| không có người nhận | `Cần ít nhất 1 người nhận` |
| hơn 20 người nhận | `Tối đa 20 người nhận` |
| người nhận loại `email` sai định dạng | `Email không hợp lệ: <giá trị>` |

**Dữ liệu sinh sẵn**

| # | `name` | `reportType` | Tần suất | `period` | `formats` | Bật |
|---|---|---|---|---|---|---|
| 1 | Chuyên cần cán bộ hằng tuần | `staff-attendance` | weekly, thứ Hai 07:30 | `last_week` | pdf, xlsx | có |
| 2 | Chuyên cần sinh viên hằng tuần | `student-attendance` | weekly, thứ Hai 08:00 | `last_week` | xlsx | có |
| 3 | Ra vào khuôn viên hằng ngày | `gate-access` | daily 07:00 | `yesterday` | pdf | có |
| 4 | Sự kiện an ninh hằng ngày | `security-alert` | daily 06:30 | `yesterday` | pdf, docx | có |
| 5 | Khách đến làm việc hằng tháng | `visitor` | monthly, ngày 1 08:00 | `last_month` | pdf, xlsx, docx | có |
| 6 | Sử dụng phòng họp cuối tháng | `room-utilization` | monthly, ngày cuối 17:00 | `last_month` | xlsx | không |

Mỗi lịch có 2–4 người nhận: vài cán bộ trong `hosts` (loại `user`) và email `bangiamhieu@savp.edu.vn` (loại `email`). `id` dạng `sch-1`…`sch-6`.

`runs`: duyệt lùi từng ngày từ hôm qua; với mỗi lịch đang bật mà ngày đó khớp tần suất thì thêm một lần chạy `scheduled` vào đúng giờ gửi; dừng khi đủ 40. Lần chạy thứ 5, 14, 28 (đếm từ mới nhất) có `status: 'failed'` với `error` lần lượt: "Máy chủ thư từ chối người nhận ngoài hệ thống (550)", "Quá thời gian tạo file báo cáo", "Hộp thư người nhận đã đầy". `from`/`to` tính bằng `resolvePeriod(period, thời điểm chạy)`. `exports`: 5 dòng trong 5 ngày gần nhất, đủ ba định dạng.

- [ ] **Step 1: Viết test lịch gửi**

```js
// src/mocks/visitorReport/scheduleApi.test.js
import * as svc from '../../service/reportCenterService';
import { resetState } from './store';

const ok = async (promise) => {
    const res = await promise;
    expect(res.success).toBe(true);
    return res.data;
};
const payload = (over = {}) => ({
    name: 'Báo cáo khách hằng tuần',
    reportType: 'visitor',
    filters: { departmentId: 'dep-cntt' },
    period: 'last_week',
    frequency: 'weekly',
    time: '08:00',
    dayOfWeek: 1,
    dayOfMonth: null,
    formats: ['pdf', 'xlsx'],
    recipients: [{ type: 'email', value: 'truongphong@savp.edu.vn', label: 'truongphong@savp.edu.vn' }],
    subject: 'Báo cáo khách tuần trước',
    message: 'Kính gửi anh/chị báo cáo định kỳ.',
    enabled: true,
    ...over,
});

beforeEach(() => resetState());

test('dữ liệu sinh sẵn: 6 lịch, 40 lần chạy có lần lỗi', async () => {
    const schedules = await ok(svc.listSchedules());
    expect(schedules).toHaveLength(6);
    expect(schedules.filter((s) => s.enabled).every((s) => s.nextRunAt)).toBe(true);
    expect(schedules.find((s) => !s.enabled).nextRunAt).toBeNull();
    const runs = await ok(svc.listScheduleRuns({ limit: 100 }));
    expect(runs.total).toBe(40);
    const failed = await ok(svc.listScheduleRuns({ status: 'failed', limit: 100 }));
    expect(failed.total).toBe(3);
    failed.items.forEach((r) => expect(r.error).toBeTruthy());
});

test('tạo, sửa, bật/tắt, nhân bản, xóa', async () => {
    const created = await ok(svc.createSchedule(payload()));
    expect(created.reportTitle).toBe('Khách đến làm việc');
    expect(new Date(created.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    const edited = await ok(svc.updateSchedule(created.id, payload({ frequency: 'daily', dayOfWeek: null, time: '06:00' })));
    expect(edited.frequency).toBe('daily');

    expect((await ok(svc.toggleSchedule(created.id, false))).nextRunAt).toBeNull();

    const copy = await ok(svc.duplicateSchedule(created.id));
    expect(copy.name).toBe('Báo cáo khách hằng tuần (bản sao)');
    expect(copy.enabled).toBe(false);

    await ok(svc.deleteSchedule(created.id));
    expect((await ok(svc.listSchedules())).some((s) => s.id === created.id)).toBe(false);
    expect((await svc.deleteSchedule('khong-co')).success).toBe(false);
});

test('gửi thử tạo lần chạy manual, không đổi lần chạy kế tiếp', async () => {
    const created = await ok(svc.createSchedule(payload()));
    const run = await ok(svc.runScheduleNow(created.id));
    expect(run).toMatchObject({ scheduleId: created.id, trigger: 'manual', status: 'success', recipientCount: 1, formats: ['pdf', 'xlsx'] });
    expect(run.from <= run.to).toBe(true);
    const after = (await ok(svc.listSchedules())).find((s) => s.id === created.id);
    expect(after.nextRunAt).toBe(created.nextRunAt);
    expect((await ok(svc.listScheduleRuns({ scheduleId: created.id }))).total).toBe(1);
});

test('gửi lại lần lỗi', async () => {
    const failed = (await ok(svc.listScheduleRuns({ status: 'failed' }))).items[0];
    const retry = await ok(svc.retryScheduleRun(failed.id));
    expect(retry).toMatchObject({ trigger: 'manual', status: 'success', scheduleId: failed.scheduleId, from: failed.from, to: failed.to });
    const again = (await ok(svc.listScheduleRuns({ status: 'failed', limit: 100 }))).items.find((r) => r.id === failed.id);
    expect(again.retriedByRunId).toBe(retry.id);
});

test.each([
    [{ name: ' ' }, 'Vui lòng nhập tên lịch gửi'],
    [{ reportType: 'khong-co' }, 'Loại báo cáo không tồn tại'],
    [{ period: 'last_year' }, 'Kỳ dữ liệu không hợp lệ'],
    [{ frequency: 'yearly' }, 'Tần suất không hợp lệ'],
    [{ time: '25:00' }, 'Giờ gửi không hợp lệ'],
    [{ dayOfWeek: 9 }, 'Vui lòng chọn thứ trong tuần'],
    [{ frequency: 'monthly', dayOfMonth: 31 }, 'Ngày trong tháng phải từ 1 đến 28 hoặc ngày cuối tháng'],
    [{ formats: [] }, 'Vui lòng chọn ít nhất một định dạng'],
    [{ recipients: [] }, 'Cần ít nhất 1 người nhận'],
    [{ recipients: Array.from({ length: 21 }, (_, i) => ({ type: 'email', value: `a${i}@savp.edu.vn`, label: '' })) }, 'Tối đa 20 người nhận'],
    [{ recipients: [{ type: 'email', value: 'sai-email', label: '' }] }, 'Email không hợp lệ: sai-email'],
])('lịch sai dữ liệu %#', async (over, message) => {
    expect(await svc.createSchedule(payload(over))).toEqual({ success: false, message });
});
```

- [ ] **Step 2: Viết test xuất file**

```js
// src/mocks/visitorReport/exporters.test.js
import { EMPTY_TEXT, buildFileName, buildExportModel, buildWorkbook, buildReportHtml, runExport } from './exporters';
import { getReportDefinition } from '../../config/reportDefinitions';

const definition = getReportDefinition('visitor');
const lookups = { departments: [{ id: 'dep-cntt', name: 'Khoa Công nghệ thông tin' }], purposes: [] };
const report = (rows) => ({
    kpis: definition.kpis.map((k) => ({ key: k.key, value: 3 })),
    charts: [],
    rows,
});
const row = {
    code: 'VS-261007-0001', visitorName: '<script>alert(1)</script>', organization: 'Công ty A & B', hostName: 'Nguyễn Văn An',
    departmentName: 'Khoa Công nghệ thông tin', purpose: 'Làm việc với đơn vị',
    checkInTime: '2026-10-07T02:00:00.000Z', checkOutTime: null, durationSeconds: 8100, statusLabel: 'Đã rời',
};
const model = (rows) => buildExportModel({
    definition, lookups, report: report(rows),
    filters: { from: '2026-10-01', to: '2026-10-07', departmentId: 'dep-cntt', status: 'checked_out' },
    now: new Date(2026, 9, 7, 10, 30),
});

test('tên file theo quy ước', () => {
    expect(buildFileName('visitor', '2026-10-01', '2026-10-07', 'xlsx')).toBe('visitor_2026-10-01_2026-10-07.xlsx');
    expect(buildFileName('visitor', '2026-10-01', '2026-10-07', 'docx')).toBe('visitor_2026-10-01_2026-10-07.doc');
    expect(buildFileName('visitor', '2026-10-01', '2026-10-07', 'pdf')).toBe('visitor_2026-10-01_2026-10-07.pdf');
});

test('mô hình xuất: tiêu đề, kỳ, bộ lọc có nhãn, ô đã định dạng', () => {
    const m = model([row]);
    expect(m.title).toBe('Báo cáo Khách đến làm việc');
    expect(m.period).toBe('Kỳ báo cáo: 01/10/2026 – 07/10/2026');
    expect(m.filterLines).toEqual(['Đơn vị tiếp: Khoa Công nghệ thông tin', 'Trạng thái: Đã rời']);
    expect(m.headers).toEqual(definition.columns.map((c) => c.label));
    expect(m.rows[0][0]).toBe('VS-261007-0001');
    expect(m.rows[0][8]).toBe('2g 15p');
    expect(m.rows[0][7]).toBe('—');
    expect(m.kpis[0]).toEqual({ label: 'Tổng lượt', value: '3' });
    expect(m.empty).toBe(false);
});

test('Excel có 2 sheet; không có dữ liệu thì ghi dòng thông báo', () => {
    const wb = buildWorkbook(model([]));
    expect(wb.SheetNames).toEqual(['Tổng hợp', 'Dữ liệu']);
    expect(wb.Sheets['Dữ liệu'].A2.v).toBe(EMPTY_TEXT);
    expect(buildWorkbook(model([row])).Sheets['Dữ liệu'].A2.v).toBe('VS-261007-0001');
});

test('HTML cho Word/PDF thoát ký tự đặc biệt và có dòng rỗng', () => {
    const html = buildReportHtml(model([row]));
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('Công ty A &amp; B');
    expect(buildReportHtml(model([]))).toContain(EMPTY_TEXT);
});

test('PDF: trình duyệt chặn cửa sổ bật lên thì trả false', () => {
    const open = jest.spyOn(window, 'open').mockReturnValue(null);
    expect(runExport('pdf', model([row]), 'x.pdf')).toBe(false);
    open.mockRestore();
});
```

- [ ] **Step 3: Chạy hai file test, xác nhận đỏ**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks/visitorReport/scheduleApi.test.js src/mocks/visitorReport/exporters.test.js`
Expected: FAIL (thiếu `listSchedules`, thiếu `./exporters`)

- [ ] **Step 4: Viết `exporters.js`**

```js
// src/mocks/visitorReport/exporters.js
// Xuất file phía trình duyệt, chỉ phục vụ demo (spec §7). BE thật sẽ thay bằng job xuất file.
import * as XLSX from 'xlsx';
import { formatCell } from '../../utils/reportFormat';

export const EMPTY_TEXT = 'Không có dữ liệu trong kỳ đã chọn';
const EXTENSION = { pdf: 'pdf', xlsx: 'xlsx', docx: 'doc' };

const pad = (n) => String(n).padStart(2, '0');
const dmy = (ymd) => ymd.split('-').reverse().join('/');
const stamp = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const escapeHtml = (value) =>
    String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const buildFileName = (type, from, to, format) => `${type}_${from}_${to}.${EXTENSION[format]}`;

const filterLabel = (filter, value, lookups) => {
    if (filter.options) return filter.options.find((o) => o.value === value)?.label || value;
    return (lookups[filter.lookup] || []).find((o) => o.id === value)?.name || value;
};

export const buildExportModel = ({ definition, filters, lookups, report, now = new Date() }) => ({
    title: `Báo cáo ${definition.title}`,
    period: `Kỳ báo cáo: ${dmy(filters.from)} – ${dmy(filters.to)}`,
    generatedAt: stamp(now),
    filterLines: definition.filters
        .filter((f) => filters[f.key])
        .map((f) => `${f.label}: ${filterLabel(f, filters[f.key], lookups)}`),
    kpis: definition.kpis.map((k) => ({
        label: k.label,
        value: formatCell(report.kpis.find((item) => item.key === k.key)?.value, k.format),
    })),
    headers: definition.columns.map((c) => c.label),
    rows: report.rows.map((r) => definition.columns.map((c) => formatCell(r[c.key], c.format))),
    empty: report.rows.length === 0,
});

export const buildWorkbook = (model) => {
    const summary = [
        [model.title],
        [model.period],
        [`Thời điểm xuất: ${model.generatedAt}`],
        ...model.filterLines.map((line) => [line]),
        [],
        ['Chỉ số', 'Giá trị'],
        ...model.kpis.map((k) => [k.label, k.value]),
    ];
    const data = [model.headers, ...(model.empty ? [[EMPTY_TEXT]] : model.rows)];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), 'Tổng hợp');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(data), 'Dữ liệu');
    return workbook;
};

export const buildReportHtml = (model) => {
    const body = model.empty
        ? `<tr><td colspan="${model.headers.length}" style="text-align:center">${EMPTY_TEXT}</td></tr>`
        : model.rows.map((r) => `<tr>${r.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('');
    return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>${escapeHtml(model.title)}</title>
<style>
body{font-family:'Times New Roman',serif;font-size:12pt;color:#0A0A0A;margin:24px}
h1{font-size:16pt;text-align:center;margin:0 0 4px}
p{margin:2px 0}.meta{text-align:center}
table{border-collapse:collapse;width:100%;margin-top:12px}
th,td{border:1px solid #476788;padding:4px 6px;font-size:10pt;text-align:left}
th{background:#E7EDF6}
.kpi td:first-child{width:40%}
@page{size:A4 landscape;margin:12mm}
</style></head><body>
<h1>${escapeHtml(model.title.toUpperCase())}</h1>
<p class="meta">${escapeHtml(model.period)}</p>
<p class="meta">Thời điểm xuất: ${escapeHtml(model.generatedAt)}</p>
${model.filterLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
<table class="kpi"><tbody>${model.kpis.map((k) => `<tr><td>${escapeHtml(k.label)}</td><td>${escapeHtml(k.value)}</td></tr>`).join('')}</tbody></table>
<table><thead><tr>${model.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
</body></html>`;
};

const downloadBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
};

// Trả false khi không xuất được (PDF bị chặn cửa sổ bật lên) để service báo cho người dùng.
export const runExport = (format, model, fileName) => {
    if (format === 'xlsx') {
        XLSX.writeFile(buildWorkbook(model), fileName);
        return true;
    }
    const html = buildReportHtml(model);
    if (format === 'docx') {
        downloadBlob(new Blob(['﻿', html], { type: 'application/msword' }), fileName);
        return true;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) return false;
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    printWindow.onload = () => printWindow.print();
    setTimeout(() => printWindow.print(), 400);
    return true;
};
```

Sau khi viết, kiểm tra trên Chrome rằng hộp thoại in chỉ mở một lần; nếu mở hai lần thì bỏ dòng `setTimeout`.

- [ ] **Step 5: Điền `schedules`, `runs`, `exports` vào `seed.js`** theo bảng "Dữ liệu sinh sẵn".

- [ ] **Step 6: Bổ sung `reportApi.js` và `reportCenterService.js`** các hàm ở bảng Interfaces. Trong service, `exportReport` và `downloadRunFile` gọi `prepareExport` rồi `runExport`; `runExport` trả `false` thì trả `{ success: false, message: 'Trình duyệt đã chặn cửa sổ in. Hãy cho phép cửa sổ bật lên rồi thử lại.' }`. `prepareExport` dựng báo cáo với toàn bộ dòng (không phân trang) và ghi một dòng vào `exports` (`userTouched: true`).

- [ ] **Step 7: Chạy toàn bộ test lớp giả**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks`
Expected: PASS toàn bộ 7 file test (gồm cả hai kỳ vọng `schedules`/`runs` của Task 3)

- [ ] **Step 8: Điểm dừng M1** — báo file đã đổi và kết quả test. Không commit.

---

# M2 — Trung tâm báo cáo

### Task 7: Khối dùng chung của báo cáo và màn Xem báo cáo (S9)

**Files:**
- Create: `src/hooks/useAreaBase.js`, `src/components/report/{ReportFilterBar,KpiTiles,ReportChart,ReportTable,ExportMenu}.jsx`, `src/pages/shared/reports/ReportViewer.jsx`
- Modify: `src/routers/index.js` (route `reports/:type` cho BA, SA, Manager theo Wiring Recipe)

**Interfaces:**
- Consumes: `getReportDefinition`, `formatCell`, `getReportLookups`, `getReportPreview`, `exportReport`, `Pagination` (`src/components/common/Pagination.jsx`, props `currentPage, totalPages, onPageChange`), `toast`.
- Produces:

```js
// src/hooks/useAreaBase.js
import { useLocation } from 'react-router-dom';

// '/business-admin/reports/visitor' → '/business-admin'
const useAreaBase = () => `/${useLocation().pathname.split('/')[1]}`;
export default useAreaBase;
```

| Component | Props | Hành vi |
|---|---|---|
| `ReportFilterBar` | `{ definition, lookups, value, onChange, onApply, loading }`; `value = { preset: 'today'\|'week'\|'month'\|'custom', from, to, q, ...khóa bộ lọc }` | Bốn nút kỳ (Hôm nay, Tuần này, Tháng này, Tùy chọn). Chọn kỳ có sẵn thì tự điền `from`/`to` (tuần tính từ thứ Hai, tháng từ ngày 1, đến hôm nay) và khóa hai ô ngày. Mỗi phần tử `definition.filters` là một `<select>` có lựa chọn đầu "Tất cả". Ô tìm kiếm `q`. Nút "Xem báo cáo" gọi `onApply`. Xuất kèm `defaultFilterValue()` trả `{ preset: 'month', from, to, q: '' }`. |
| `KpiTiles` | `{ items: [{ key, label, value }] }` (`value` đã định dạng) | Lưới `grid grid-cols-2 lg:grid-cols-5 gap-4`. |
| `ReportChart` | `{ config, data }` (`config` là phần tử `definition.charts`) | `line` → `LineChart`, `bar` → `BarChart`, `pie` → `PieChart` có chú giải; cao 280 px trong `ResponsiveContainer`; `data` rỗng hiện "Chưa có dữ liệu trong kỳ đã chọn". Màu lấy từ `['#006BFF', '#22c55e', '#f59e0b', '#ef4444', '#8247f5', '#06b6d4']`. |
| `ReportTable` | `{ columns, rows, total, page, limit, sortKey, sortDir, onSort, onPageChange, loading }` | Bấm tiêu đề cột đổi chiều sắp xếp. Ô hiển thị qua `formatCell`. Cột số căn phải. Rỗng hiện một dòng "Không có dữ liệu trong kỳ đã chọn". Chân bảng: "Hiển thị a–b / tổng" và `Pagination`. |
| `ExportMenu` | `{ onExport, disabled, busyFormat }` | Nút "Xuất báo cáo" mở danh sách PDF, Excel, Word; gọi `onExport('pdf'\|'xlsx'\|'docx')`; đang xuất thì hiện vòng xoay ở dòng tương ứng. |

**`ReportViewer`:**
- `type = useParams().type`; `definition = getReportDefinition(type)`. Không có thì hiện khối "Không tìm thấy báo cáo" với nút về `${base}/reports`.
- State: `lookups`, `draft` (đang chỉnh), `applied` (đã bấm xem), `page`, `sort`, `data`, `loading`, `error`, `busyFormat`.
- Nạp `lookups` một lần. Nạp `getReportPreview(type, { ...applied, page, limit: 20, sortKey, sortDir })` mỗi khi `applied`, `page`, `sort` đổi; `success: false` thì hiện khối lỗi đỏ với `message`.
- Đổi `type` trên URL thì đặt lại `draft`, `applied`, `page`.
- Xuất: `exportReport(type, { format, ...applied })`; thành công `toast.success('Đã xuất ' + fileName)`, thất bại `toast.error(message)`.
- Bố cục từ trên xuống: tiêu đề + mô tả + `ExportMenu`; `ReportFilterBar`; `KpiTiles`; hai `ReportChart` cạnh nhau (`grid lg:grid-cols-2 gap-6`); `ReportTable`.

- [ ] **Step 1:** Viết `useAreaBase.js` và 5 component theo bảng trên.
- [ ] **Step 2:** Viết `ReportViewer.jsx`.
- [ ] **Step 3:** Thêm route `reports/:type` vào ba khu vực BA, SA, Manager.
- [ ] **Step 4: Kiểm tra lint**

Run: `npx eslint --ext .js,.jsx src/hooks/useAreaBase.js src/components/report src/pages/shared/reports --max-warnings 0`
Expected: không có lỗi hay cảnh báo

- [ ] **Step 5: Kiểm tra tay** (`npm start`, đăng nhập Business Admin)
  - Mở lần lượt `/business-admin/reports/<type>` với 7 mã: mỗi trang có KPI, 2 biểu đồ, bảng 20 dòng.
  - Đổi kỳ sang "Hôm nay" rồi "Tùy chọn" 01/01/2020–07/01/2020: KPI về 0, biểu đồ và bảng hiện trạng thái rỗng.
  - Chọn kỳ tùy chọn dài hơn 366 ngày: hiện lỗi "Kỳ báo cáo tối đa 366 ngày".
  - Xuất Excel, Word, PDF báo cáo `visitor`: mở được cả ba; file Excel có 2 sheet; xuất khi bảng rỗng vẫn ra file có dòng "Không có dữ liệu trong kỳ đã chọn".
  - Bật chặn cửa sổ bật lên rồi xuất PDF: hiện thông báo lỗi.
  - Mở `/business-admin/reports/khong-co`: hiện "Không tìm thấy báo cáo".
- [ ] **Step 6: Điểm dừng** — báo file đã đổi. Không commit.

### Task 8: Trung tâm báo cáo (S8)

**Files:**
- Create: `src/pages/shared/reports/ReportCenter.jsx`
- Modify: `src/routers/index.js`, ba layout BA, SA, Manager (route `reports` và mục menu "Trung tâm báo cáo")

**Interfaces:**
- Consumes: `getReportCatalog`, `getRecentExports`, `getReportDefinition`, `resetDemoData` (từ `visitorService`), `useAreaBase`, `VISITOR_REPORT_MOCK_ENABLED`.

**Hành vi:**
- Lưới 7 thẻ (`grid md:grid-cols-2 xl:grid-cols-3 gap-4`): icon và tiêu đề từ khai báo, mô tả, dòng "n lịch gửi đang bật", nút "Xem báo cáo" điều hướng `${base}/reports/${type}`.
- Bảng "File xuất gần đây": báo cáo, kỳ, định dạng, thời điểm, nút "Xuất lại" gọi `exportReport(reportType, { format, from, to })`. Rỗng thì hiện "Chưa có file nào được xuất".
- Khi `VISITOR_REPORT_MOCK_ENABLED`: dải thông báo "Đang dùng dữ liệu minh họa" kèm nút "Đặt lại dữ liệu demo" (xác nhận bằng `ConfirmDialog` có sẵn ở `src/components/common/ConfirmDialog.jsx`; đọc props của nó trước khi dùng), xong thì nạp lại trang.

- [ ] **Step 1:** Viết `ReportCenter.jsx`.
- [ ] **Step 2:** Thêm route và mục menu theo Wiring Recipe (BA, SA, Manager).
- [ ] **Step 3: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/pages/shared/reports src/pages/bussinessAdmin/layout src/pages/systemAdmin/layout src/pages/manager/layout src/routers --max-warnings 0`; chỉ chấp nhận cảnh báo đã có từ trước ở file cũ.
- [ ] **Step 4: Kiểm tra tay:** menu "Báo cáo → Trung tâm báo cáo" có ở cả ba vai trò; bấm từng thẻ mở đúng báo cáo; xuất một file rồi quay lại thấy dòng mới ở "File xuất gần đây"; "Đặt lại dữ liệu demo" xóa dòng đó.
- [ ] **Step 5: Build** — `npm run build`. Expected: `Compiled successfully` (hoặc chỉ có cảnh báo đã tồn tại trước đó).
- [ ] **Step 6: Điểm dừng M2** — phủ checklist 72–79. Không commit.

---

# M3 — Khách: đăng ký, quản lý, lễ tân

### Task 9: Khối dùng chung của khách

**Files:**
- Modify: `package.json` (`npm install qrcode.react`)
- Create: `src/components/visitor/visitLabels.js`, `src/components/visitor/{VisitStatusBadge,VisitorAvatar,VisitTimeline,AccessGrantCard,VisitQr,FaceCapture,VisitForm}.jsx`

**Interfaces:**
- Consumes: `searchHosts`, `getVisitorLookups`.
- Produces:

`visitLabels.js`:

| Tên | Nội dung |
|---|---|
| `VISIT_STATUS_META` | `pending_approval`: "Chờ duyệt", `text-amber-700 bg-amber-50`; `approved`: "Đã duyệt", `text-action-blue bg-blue-50`; `checked_in`: "Đang trong khuôn viên", `text-green-700 bg-green-50`; `checked_out`: "Đã rời", `text-slate-blue bg-pale-gray`; `rejected`: "Từ chối", `text-red-700 bg-red-50`; `cancelled`: "Đã hủy", `text-slate-blue bg-pale-gray`; `revoked`: "Đã thu hồi", `text-red-700 bg-red-50`; `expired`: "Hết hạn", `text-slate-blue bg-pale-gray` |
| `VISIT_CHANNEL_LABELS` | `online`: "Tự đăng ký trực tuyến"; `host_invite`: "Cán bộ mời"; `walk_in`: "Lễ tân nhập" |
| `VISIT_EVENT_LABELS` | `registered`: "Đã gửi đăng ký"; `approved`: "Đã duyệt"; `rejected`: "Bị từ chối"; `cancelled`: "Đã hủy"; `revoked`: "Thu hồi quyền ra vào"; `extended`: "Gia hạn quyền ra vào"; `photo_added`: "Bổ sung ảnh khuôn mặt"; `face_verified`: "Xác thực khuôn mặt thành công"; `manual_review`: "Cần lễ tân xác minh"; `access_denied`: "Từ chối ra vào"; `check_in`: "Vào khuôn viên"; `check_out`: "Rời khuôn viên"; `expired`: "Hết hiệu lực, khách không đến"; `face_removed`: "Đã gỡ khuôn mặt khỏi thiết bị"; `email_sent`: "Đã gửi email"; `host_notified`: "Đã thông báo người được gặp" |
| `GATE_REASON_LABELS` | `outside_window`: "Ngoài khung giờ được cấp"; `zone_not_allowed`: "Khu vực không được phép"; `invalid_status`: "Lượt khách chưa được duyệt hoặc đã đóng"; `low_score`: "Độ khớp khuôn mặt dưới ngưỡng 80%"; `no_photo`: "Chưa có ảnh khuôn mặt" |
| `fmtDateTime(iso)`, `fmtTimeRange(from, to)` | `07/10 08:30`; `07/10 08:30 – 10:30` (khác ngày thì ghi đủ hai đầu) |

| Component | Props | Hành vi |
|---|---|---|
| `VisitStatusBadge` | `{ status, overstay }` | Nhãn theo `VISIT_STATUS_META`; `overstay` thêm nhãn đỏ "Quá giờ". |
| `VisitorAvatar` | `{ visitor, size = 48 }` | Có `photo` thì hiện ảnh tròn; không thì vòng tròn màu (suy từ tên) với chữ cái đầu của tên. `hasPhoto === false` thêm viền đứt và chú thích "Chưa có ảnh". |
| `VisitTimeline` | `{ events }` | Danh sách dọc mới nhất ở trên: nhãn sự kiện, thời điểm, ghi chú, độ khớp (%) nếu có. |
| `AccessGrantCard` | `{ access, zones, editable, onChange }` | Hiện "Hiệu lực từ … đến …" và danh sách khu vực, ghi rõ khu nào "đóng/mở bằng FaceGate" và khu nào "chỉ nhận diện, cảnh báo". `editable`: hai ô `datetime-local` và ô chọn nhiều khu vực; `onChange(access)`. |
| `VisitQr` | `{ code, size = 160 }` | `QRCodeSVG` của `qrcode.react`, giá trị `${window.location.origin}/visitor/status/${code}`; mã lượt in bên dưới. |
| `FaceCapture` | `{ value, onChange }` (`value` là data URL hoặc `null`) | Nút "Bật camera" gọi `getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })` (mẫu: `src/pages/employee/FaceRegistration.jsx:77`). "Chụp" vẽ khung hình lên canvas 320×240 rồi `toDataURL('image/jpeg', 0.7)`. Luôn có nút "Tải ảnh lên" (`accept="image/*"`, thu nhỏ còn rộng tối đa 320 px qua canvas). Lỗi camera hiện "Không truy cập được camera. Bạn có thể tải ảnh lên thay thế." Có ảnh thì hiện ảnh và nút "Chụp lại". Tắt mọi track khi gỡ component. |
| `VisitForm` | `{ mode: 'walk_in'\|'host_invite', lookups, onSubmit, submitting, error }` | Trường: họ tên, số giấy tờ, điện thoại, email, đơn vị công tác, biển số, người cần gặp (ô gõ tìm gọi `searchHosts`, trễ 300 ms; ẩn khi `host_invite`, `hostId` cố định `'host-me'`), mục đích, bắt đầu, kết thúc (`datetime-local`), số người đi cùng. `walk_in` thêm `FaceCapture` và ô đồng ý. `onSubmit(payload)` đúng dạng `payload` của Task 4, kèm `channel: mode`. `error` hiện trên nút gửi. |

- [ ] **Step 1: Cài thư viện** — `npm install qrcode.react`. Expected: `package.json` thêm đúng một dòng dependency.
- [ ] **Step 2:** Viết `visitLabels.js` và 7 component.
- [ ] **Step 3: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/components/visitor --max-warnings 0`.
- [ ] **Step 4: Điểm dừng** — component được kiểm tra tay ở Task 10–12. Không commit.

### Task 10: Đăng ký khách trực tuyến (S1)

**Files:**
- Create: `src/pages/public/VisitorRegister.jsx`
- Modify: `src/routers/index.js` (route công khai `/visitor/register`)

**Interfaces:**
- Consumes: `getVisitorLookups`, `searchHosts`, `createPublicRegistration`, `FaceCapture`, `VisitQr`, `fmtTimeRange`.

**Hành vi:**
- Trang không nằm trong layout nào: nền `bg-cloud-mist`, thẻ giữa `max-w-2xl`, logo `src/assets/images/logo.png`, tiêu đề "Đăng ký khách đến làm việc".
- Thanh 4 bước: Thông tin khách → Chuyến thăm → Ảnh khuôn mặt → Xác nhận. "Tiếp tục" kiểm tra trường của bước hiện tại (cùng thông điệp với `validateVisitPayload`), "Quay lại" giữ dữ liệu.
- Bước 2: ô gõ tìm người cần gặp, kết quả hiện "Họ tên — Đơn vị"; mặc định bắt đầu = giờ tròn kế tiếp, kết thúc = bắt đầu + 2 giờ.
- Bước 3: `FaceCapture`, ô đồng ý "Tôi đồng ý cho nhà trường xử lý ảnh khuôn mặt để xác thực ra vào trong thời gian chuyến thăm".
- Bước 4: tóm tắt, nút "Gửi đăng ký". `success: false` hiện `message` ngay trên nút.
- Thành công: mã lượt, `VisitQr`, trạng thái "Chờ duyệt", dòng "Kết quả sẽ được gửi tới <email>", nút "Tra cứu trạng thái" (`/visitor/status/<code>`) và "Đăng ký lượt khác".

- [ ] **Step 1:** Viết `VisitorRegister.jsx`.
- [ ] **Step 2:** Thêm route công khai.
- [ ] **Step 3: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/pages/public/VisitorRegister.jsx --max-warnings 0`.
- [ ] **Step 4: Kiểm tra tay** (cửa sổ chưa đăng nhập):
  - Mở `/visitor/register` không bị chuyển về trang đăng nhập.
  - Bỏ trống họ tên, nhập điện thoại sai, chọn giờ kết thúc trước giờ bắt đầu: mỗi lỗi hiện đúng thông điệp.
  - Từ chối quyền camera: hiện thông báo, tải ảnh lên vẫn được, đi tiếp được.
  - Gửi thành công: có mã `VS-…` và QR.
- [ ] **Step 5: Điểm dừng** — Không commit.

### Task 11: Ngăn chi tiết lượt khách và màn Quản lý khách (S3)

**Files:**
- Create: `src/components/visitor/VisitDetailDrawer.jsx`, `src/pages/shared/visitors/VisitorManagement.jsx`
- Modify: `src/routers/index.js`, layout BA và SA (route `visitors`, mục menu "Quản lý khách" có `end: true`)

**Interfaces:**
- Consumes: `listVisits`, `getVisit`, `getVisitorLookups`, `approveVisit`, `rejectVisit`, `cancelVisit`, `revokeVisit`, `extendVisit`, `attachVisitorPhoto`, `checkInVisit`, `checkOutVisit`; các component Task 9; `Pagination`; `toast`.
- Produces: `VisitDetailDrawer` props `{ visitId, zones, onClose, onChanged }`.

**`VisitDetailDrawer`:**
- Ngăn trượt bên phải rộng `max-w-xl`, nạp `getVisit(visitId)`.
- Khối: đầu ngăn (`VisitorAvatar`, tên, mã, `VisitStatusBadge`); thông tin khách; chuyến thăm (người gặp, đơn vị tiếp, mục đích, giờ hẹn, kênh, số người đi cùng); xác thực khuôn mặt (độ khớp % hoặc "Chưa xác thực"; lý do từ chối nếu có); `AccessGrantCard`; `VisitTimeline`.
- Nút theo `availableActions`: `approve` → "Duyệt" (mở `AccessGrantCard` ở chế độ sửa, xác nhận gọi `approveVisit(id, { access })`); `reject` → "Từ chối" (ô lý do bắt buộc); `cancel` → "Hủy lượt"; `revoke` → "Thu hồi quyền" (ô lý do bắt buộc); `check_in` → "Check-in tay" (ô ghi chú bắt buộc); `check_out` → "Check-out". Thêm "Gia hạn" khi trạng thái `approved` hoặc `checked_in` (ô `datetime-local`), "Chụp bổ sung ảnh" khi `hasPhoto === false` (`FaceCapture`).
- Mỗi thao tác: thành công thì `toast.success`, nạp lại ngăn, gọi `onChanged()`; thất bại thì `toast.error(message)` và giữ ngăn mở.

**`VisitorManagement`:**
- Tab: Chờ duyệt (`pending_approval`), Đã duyệt (`approved`), Đang trong khuôn viên (`checked_in`), Hoàn tất (`checked_out`), Từ chối / Hết hạn (`closed`); số đếm lấy từ `counts`.
- Lọc: ô tìm kiếm (trễ 300 ms), đơn vị tiếp, từ ngày, đến ngày. Đổi tab hoặc bộ lọc thì về trang 1.
- Bảng: khách (`VisitorAvatar` + tên + đơn vị công tác), mã lượt, người gặp / đơn vị tiếp, giờ hẹn, kênh, trạng thái. Bấm dòng mở ngăn chi tiết. Tab Chờ duyệt có nút nhanh "Duyệt" trên dòng (duyệt với quyền mặc định).

- [ ] **Step 1:** Viết `VisitDetailDrawer.jsx`.
- [ ] **Step 2:** Viết `VisitorManagement.jsx`.
- [ ] **Step 3:** Thêm route và menu (BA, SA).
- [ ] **Step 4: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/components/visitor src/pages/shared/visitors --max-warnings 0`.
- [ ] **Step 5: Kiểm tra tay:** lượt vừa đăng ký ở Task 10 nằm ở tab Chờ duyệt; sửa khung giờ rồi duyệt → sang tab Đã duyệt, dòng thời gian có "Đã duyệt" và "Đã gửi email"; từ chối không lý do bị chặn; gia hạn lùi giờ bị chặn với thông điệp đúng; tìm kiếm không dấu ("tran thi") ra kết quả.
- [ ] **Step 6: Điểm dừng** — Không commit.

### Task 12: Quầy lễ tân (S4)

**Files:**
- Create: `src/pages/shared/visitors/VisitorDesk.jsx`
- Modify: `src/routers/index.js`, layout BA và SA (route `visitors/desk`, mục menu "Quầy lễ tân" đứng đầu nhóm "Khách")

**Interfaces:**
- Consumes: `getDeskToday`, `getVisitorLookups`, `createVisit`, `verifyFaceAtGate`, `resetDemoData`, `VisitForm`, `VisitDetailDrawer`, `VisitorAvatar`, `VisitStatusBadge`, `GATE_REASON_LABELS`.

**Hành vi:**
- Bốn ô KPI: Dự kiến hôm nay, Đã đến, Đang trong khuôn viên, Quá giờ (đỏ khi lớn hơn 0).
- Cột trái (2/3): danh sách khách hôm nay theo giờ hẹn; mỗi dòng có ảnh đại diện, tên, người gặp, giờ hẹn, trạng thái, nút "Xác thực tại cổng" (chỉ khi `approved`) và "Chi tiết".
- Cột phải (1/3):
  - Khối "Xác thực tại cổng": khách đang chọn; ô chọn cổng (mọi `zones`); ba nút tình huống "Khách đến đúng hẹn" (`normal`), "Độ khớp thấp" (`low_score`), "Đến ngoài khung giờ" (`outside_window`). Bấm thì hiện hiệu ứng quét 1 giây, sau đó: ảnh đăng ký cạnh ô "Ảnh camera", độ khớp %, thẻ kết quả xanh "Cho phép vào — đã check-in", vàng "Cần lễ tân xác minh: <lý do>" (kèm nút "Check-in tay" mở ngăn chi tiết), hoặc đỏ "Từ chối: <lý do>".
  - Khối "Cảnh báo hôm nay": các sự kiện `access_denied` và `manual_review` trong `alerts`.
- Nút "Đăng ký khách vãng lai" mở hộp thoại chứa `VisitForm mode="walk_in"`; thành công thì đóng, nạp lại, chọn sẵn khách đó ở khối xác thực.
- Tự nạp lại mỗi 30 giây và sau mỗi thao tác. Nút "Đặt lại dữ liệu demo" khi cờ mock bật.

- [ ] **Step 1:** Viết `VisitorDesk.jsx`.
- [ ] **Step 2:** Thêm route và menu (BA, SA).
- [ ] **Step 3: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/pages/shared/visitors --max-warnings 0`.
- [ ] **Step 4: Kiểm tra tay:** KPI khớp số dòng; "Khách đến đúng hẹn" → check-in, KPI "Đã đến" tăng 1; "Đến ngoài khung giờ" → đỏ, lượt vẫn Đã duyệt, cảnh báo xuất hiện; chọn cổng "Tòa B2" cho khách của đơn vị ở A1 → "Khu vực không được phép"; khách "Chưa có ảnh" → vàng, chụp bổ sung ảnh ở ngăn chi tiết rồi xác thực lại → xanh; đăng ký vãng lai trọn luồng.
- [ ] **Step 5: Build** — `npm run build`. Expected: `Compiled successfully`.
- [ ] **Step 6: Điểm dừng M3** — phủ checklist 52–55. Hết ngày 1. Không commit.

---

# M4 — Lịch gửi báo cáo

### Task 13: Form lịch gửi và màn Lịch gửi báo cáo (S10)

**Files:**
- Create: `src/components/report/ScheduleFormModal.jsx`, `src/pages/shared/reports/ReportSchedules.jsx`
- Modify: `src/pages/shared/reports/ReportViewer.jsx` (thêm nút "Đặt lịch gửi"), `src/routers/index.js`, layout BA và SA (route `report-schedules`, mục menu "Lịch gửi báo cáo")

**Interfaces:**
- Consumes: `listSchedules`, `createSchedule`, `updateSchedule`, `toggleSchedule`, `duplicateSchedule`, `deleteSchedule`, `runScheduleNow`, `getReportLookups`, `REPORT_TYPES`, `getReportDefinition`, `ConfirmDialog`, `useAreaBase`.
- Produces: `ScheduleFormModal` props `{ isOpen, initial, lookups, onClose, onSaved }`; `initial` là `ScheduleView` (sửa) hoặc `{ reportType, filters }` (tạo mới điền sẵn) hoặc `null`.

**`ScheduleFormModal`** (4 phần trong một hộp thoại cuộn dọc):
1. **Báo cáo:** tên lịch; loại báo cáo; các ô lọc riêng dựng từ `definition.filters` (đổi loại thì xóa bộ lọc cũ); kỳ dữ liệu (Hôm qua, Tuần trước, Tháng trước).
2. **Tần suất:** Hằng ngày / Hằng tuần (chọn thứ, giá trị 1–6 rồi 0 cho Chủ nhật) / Hằng tháng (chọn ngày 1–28 hoặc "Ngày cuối tháng"); giờ gửi (`type="time"`); dòng chú thích "Giờ Việt Nam (UTC+7)".
3. **Định dạng và người nhận:** ba ô chọn PDF, Excel, Word; người nhận: chọn cán bộ từ `lookups.staff` hoặc gõ email rồi Enter, hiện dạng thẻ có nút xóa, đếm "n/20".
4. **Email:** tiêu đề, lời nhắn; khối xem trước email (tiêu đề, lời nhắn, danh sách file đính kèm theo `buildFileName` với kỳ mẫu).
- Lưu: `createSchedule` hoặc `updateSchedule`; `success: false` hiện `message` trong hộp thoại; thành công gọi `onSaved(schedule)`.

**`ReportSchedules`:**
- Bảng: tên, báo cáo, tần suất (chữ: "Hằng tuần, thứ Hai 07:30"), định dạng (nhãn), số người nhận, lần chạy gần nhất, lần chạy kế tiếp ("—" khi tắt), công tắc bật/tắt.
- Thao tác mỗi dòng: Sửa, Gửi thử (`runScheduleNow`, xong `toast.success('Đã gửi thử tới n người nhận')` kèm liên kết "Xem lịch sử gửi" tới `${base}/report-schedules/runs`), Nhân bản, Xóa (xác nhận).
- Nút "Tạo lịch gửi". Mở trang với `?new=1&type=<type>` thì tự mở form điền sẵn loại.
- Rỗng: "Chưa có lịch gửi nào" kèm nút tạo.

**Sửa `ReportViewer`:** khi `base !== '/manager'`, thêm nút "Đặt lịch gửi" cạnh `ExportMenu`, mở `ScheduleFormModal` với `initial = { reportType: type, filters: <bộ lọc riêng đang áp dụng, không kèm from/to/q/preset> }`; lưu xong `toast.success` kèm liên kết tới `${base}/report-schedules`.

- [ ] **Step 1:** Viết `ScheduleFormModal.jsx`.
- [ ] **Step 2:** Viết `ReportSchedules.jsx`; sửa `ReportViewer.jsx`.
- [ ] **Step 3:** Thêm route và menu (BA, SA).
- [ ] **Step 4: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/components/report src/pages/shared/reports --max-warnings 0`.
- [ ] **Step 5: Kiểm tra tay:** có 6 lịch sẵn, lịch tắt hiện "—"; tạo lịch hằng tuần thứ Hai 08:00 → lần chạy kế tiếp là thứ Hai tới 08:00; tắt rồi bật lại; thiếu người nhận, email sai, không chọn định dạng đều bị chặn đúng thông điệp; gửi thử; từ báo cáo `visitor` bấm "Đặt lịch gửi" thấy form điền sẵn; đăng nhập Manager không thấy nút đó.
- [ ] **Step 6: Điểm dừng** — Không commit.

### Task 14: Lịch sử gửi (S11)

**Files:**
- Create: `src/pages/shared/reports/ReportRuns.jsx`
- Modify: `src/routers/index.js`, layout BA và SA (route `report-schedules/runs`, mục menu "Lịch sử gửi"; mục "Lịch gửi báo cáo" thêm `end: true`)

**Interfaces:**
- Consumes: `listScheduleRuns`, `listSchedules`, `retryScheduleRun`, `downloadRunFile`, `Pagination`.

**Hành vi:**
- Lọc: lịch gửi, trạng thái (Tất cả, Thành công, Thất bại), từ ngày, đến ngày.
- Bảng: thời điểm chạy, lịch gửi, báo cáo, kỳ dữ liệu, loại (Theo lịch / Gửi thử), định dạng, người nhận, trạng thái (xanh / đỏ kèm `error`). Lần lỗi đã gửi lại hiện thêm "Đã gửi lại".
- Thao tác: mỗi định dạng một nút tải (`downloadRunFile`), chỉ cho lần thành công; "Gửi lại" cho lần lỗi chưa gửi lại.
- Mở với `?scheduleId=<id>` thì lọc sẵn theo lịch đó.

- [ ] **Step 1:** Viết `ReportRuns.jsx`.
- [ ] **Step 2:** Thêm route và menu (BA, SA).
- [ ] **Step 3: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/pages/shared/reports --max-warnings 0`.
- [ ] **Step 4: Kiểm tra tay:** 40 dòng trên 4 trang; lọc "Thất bại" ra 3 dòng có lý do; "Gửi lại" tạo dòng mới thành công và dòng cũ hiện "Đã gửi lại"; lần gửi thử ở Task 13 có trong danh sách; tải file Excel của một lần chạy mở được; hai mục menu "Lịch gửi báo cáo" và "Lịch sử gửi" không sáng cùng lúc.
- [ ] **Step 5: Build** — `npm run build`. Expected: `Compiled successfully`.
- [ ] **Step 6: Điểm dừng M4** — phủ checklist 80. Không commit.

---

# M5 — Khách: người được gặp, lịch sử, thống kê, tra cứu

### Task 15: Khách của tôi (S5)

**Files:**
- Create: `src/pages/shared/visitors/MyVisitors.jsx`
- Modify: `src/routers/index.js`, `ManagerLayout.jsx`, `EmployeeLayout.jsx` (route `my-visitors`, mục menu "Khách của tôi")

**Interfaces:**
- Consumes: `getMyVisits`, `getMyNotifications`, `markMyNotificationsRead`, `approveVisit`, `rejectVisit`, `createVisit`, `getVisitorLookups`, `VisitForm`, `VisitDetailDrawer`, `VisitStatusBadge`, `VisitorAvatar`.

**Hành vi:**
- Cột chính: ba khối "Cần bạn duyệt" (`pending`; mỗi thẻ có Duyệt, Từ chối kèm lý do), "Sắp đến / đang tiếp" (`upcoming`), "Đã tiếp" (`past`, 10 dòng đầu, nút "Xem thêm").
- Cột phụ: bảng thông báo (chấm xanh cho chưa đọc, nút "Đánh dấu đã đọc").
- Nút "Mời khách" mở hộp thoại `VisitForm mode="host_invite"`; thành công hiện mã lượt và ghi chú "Khách chưa có ảnh khuôn mặt, lễ tân sẽ chụp khi khách đến".
- Tự nạp lại mỗi 20 giây. Khi số thông báo chưa đọc tăng so với lần nạp trước, `toast.info` nội dung thông báo mới nhất (đây là cách người được gặp "nhận thông báo khách đã đến" trong mockup).

- [ ] **Step 1:** Viết `MyVisitors.jsx`.
- [ ] **Step 2:** Thêm route và menu (Manager, Employee).
- [ ] **Step 3: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/pages/shared/visitors src/pages/manager/layout src/pages/employee/layout --max-warnings 0`; chỉ chấp nhận cảnh báo đã có từ trước.
- [ ] **Step 4: Kiểm tra tay** (hai tab cùng trình duyệt: Employee và Business Admin): có ít nhất 2 lượt cần duyệt; duyệt một lượt → sang "Sắp đến"; bên Business Admin check-in lượt đó ở Quầy lễ tân → trong 20 giây tab Employee hiện toast "khách đã đến"; mời khách → lượt hiện ở Quản lý khách với nhãn "Chưa có ảnh".
- [ ] **Step 5: Điểm dừng** — Không commit.

### Task 16: Lịch sử khách đến (S6)

**Files:**
- Create: `src/pages/shared/visitors/VisitorHistory.jsx`
- Modify: `src/routers/index.js`, layout BA và SA (route `visitors/history`, mục menu "Lịch sử khách")

**Interfaces:**
- Consumes: `listVisits`, `listVisitsOfVisitor`, `getVisitorLookups`, `VisitDetailDrawer`, `Pagination`, `fmtDateTime`; xuất Excel dùng `exportReport('visitor', { format: 'xlsx', from, to, departmentId })` của `reportCenterService`.

**Hành vi:**
- Lọc: ô tìm kiếm (tên, số giấy tờ, điện thoại, đơn vị công tác, mã lượt), đơn vị tiếp, từ ngày, đến ngày (mặc định 30 ngày gần nhất).
- Bảng: thời điểm vào, thời điểm ra, thời lượng lưu trú, khách, đơn vị công tác, người gặp, đơn vị tiếp, mục đích, trạng thái, độ khớp khuôn mặt. Lấy mọi trạng thái, sắp theo giờ hẹn giảm dần.
- Bấm dòng mở `VisitDetailDrawer`. Bấm tên khách mở khối "Các lượt của khách này" (`listVisitsOfVisitor`): số lượt, lần gần nhất, danh sách lượt.
- Nút "Xuất Excel" theo bộ lọc hiện tại.

- [ ] **Step 1:** Viết `VisitorHistory.jsx`.
- [ ] **Step 2:** Thêm route và menu (BA, SA).
- [ ] **Step 3: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/pages/shared/visitors --max-warnings 0`.
- [ ] **Step 4: Kiểm tra tay:** tìm theo số điện thoại của một khách ra đúng các lượt của người đó; lượt vừa check-out ở demo có trong danh sách với dòng thời gian đầy đủ; đổi khoảng ngày thay đổi tổng số; xuất Excel mở được.
- [ ] **Step 5: Điểm dừng** — Không commit.

### Task 17: Thống kê khách (S7)

**Files:**
- Create: `src/pages/shared/visitors/VisitorStats.jsx`
- Modify: `src/routers/index.js`, layout BA và SA (route `visitors/stats`, mục menu "Thống kê khách")

**Interfaces:**
- Consumes: `getVisitorStats`, `getVisitorLookups`, `KpiTiles`, `ReportChart`, `formatCell`, `useAreaBase`.

**Hành vi:**
- Lọc: kỳ (Tuần này, Tháng này, 90 ngày, Tùy chọn), đơn vị tiếp, nhóm theo (Ngày, Tuần, Tháng).
- `KpiTiles`: Tổng lượt, Khách duy nhất, Lưu trú TB (phút), Lượt quá giờ, Tỷ lệ không đến (%).
- Năm biểu đồ dùng `ReportChart` với cấu hình khai báo ngay trong trang: lượt khách theo kỳ (line, `bucket`, `count`), theo đơn vị tiếp (bar, `name`, `count`), theo mục đích (pie, `purpose`, `count`), phân bố giờ đến (bar, `hour`, `count`), top đơn vị công tác (bar, `organization`, `count`).
- Nút "Mở báo cáo để xuất" điều hướng `${base}/reports/visitor`.

- [ ] **Step 1:** Viết `VisitorStats.jsx`.
- [ ] **Step 2:** Thêm route và menu (BA, SA).
- [ ] **Step 3: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/pages/shared/visitors --max-warnings 0`.
- [ ] **Step 4: Kiểm tra tay:** với cùng kỳ "Tháng này", ô "Tổng lượt" bằng KPI "Tổng lượt" của báo cáo `visitor`; lọc một đơn vị thì biểu đồ đơn vị còn một cột; kỳ không có dữ liệu hiện trạng thái rỗng ở cả năm biểu đồ.
- [ ] **Step 5: Điểm dừng** — Không commit.

### Task 18: Tra cứu trạng thái đăng ký (S2)

**Files:**
- Create: `src/pages/public/VisitorStatus.jsx`
- Modify: `src/routers/index.js` (route công khai `/visitor/status` và `/visitor/status/:code`)

**Interfaces:**
- Consumes: `getPublicRegistration`, `VisitStatusBadge`, `VisitQr`, `AccessGrantCard`, `VISIT_STATUS_META`, `fmtTimeRange`.

**Hành vi:**
- Cùng khung trang công khai với S1. Ô nhập mã lượt và nút "Tra cứu"; có `:code` trên URL thì tra ngay.
- Kết quả: tên khách, người gặp, đơn vị tiếp, giờ hẹn, `VisitStatusBadge`; thanh 4 mốc Đã gửi → Đã duyệt → Đã vào → Đã rời (mốc đã qua tô xanh; `rejected`, `cancelled`, `revoked`, `expired` hiện thẻ đỏ thay cho các mốc còn lại, kèm `rejectReason` nếu có); `AccessGrantCard` chỉ đọc khi đã duyệt; `VisitQr`; hướng dẫn "Khi đến cổng, nhìn vào camera để xác thực khuôn mặt. Nếu không qua được, liên hệ quầy lễ tân và đọc mã lượt."
- Mã không tồn tại: "Không tìm thấy lượt đăng ký với mã này" và nút "Đăng ký mới" (`/visitor/register`).

- [ ] **Step 1:** Viết `VisitorStatus.jsx`.
- [ ] **Step 2:** Thêm hai route công khai.
- [ ] **Step 3: Kiểm tra lint** — `npx eslint --ext .js,.jsx src/pages/public --max-warnings 0`.
- [ ] **Step 4: Kiểm tra tay** (cửa sổ chưa đăng nhập): mở liên kết từ màn thành công của S1; duyệt lượt ở tab quản trị rồi tải lại → mốc "Đã duyệt" và khung giờ hiện ra; từ chối một lượt khác → thẻ đỏ kèm lý do; mã sai → trang không tìm thấy; trang không lộ số giấy tờ, điện thoại, email.
- [ ] **Step 5: Build** — `npm run build`. Expected: `Compiled successfully`.
- [ ] **Step 6: Điểm dừng M5** — phủ checklist 55–57. Không commit.

---

# M6 — Hoàn thiện

### Task 19: Rà soát, kịch bản demo, hồi quy

**Files:**
- Create: `docs/demo-visitor-report.md` (trong `SAVP-capstone-FE`)
- Modify: các file của Task 7–18 nếu rà soát phát hiện thiếu trạng thái

- [ ] **Step 1: Rà trạng thái của 11 màn.** Với mỗi màn, xác nhận có: vòng xoay khi đang tải, khối rỗng có chữ, khối lỗi đỏ khi service trả `success: false`, bố cục không vỡ ở chiều rộng 1280 px và 1440 px. Sửa chỗ thiếu.

- [ ] **Step 2: Viết `docs/demo-visitor-report.md`** gồm: (a) chuẩn bị: BE chạy, một tài khoản cho mỗi vai trò Business Admin, Manager, Employee, bấm "Đặt lại dữ liệu demo" trước buổi, cho phép cửa sổ bật lên và camera; (b) 9 bước kịch bản ở spec §9, mỗi bước ghi màn hình, thao tác, điều khách hàng sẽ thấy, dòng checklist tương ứng; (c) bảng 15 dòng checklist (STT 52–57, 72–80) ánh xạ sang màn; (d) 8 câu hỏi ở spec §11 để hỏi khách hàng; (e) ghi chú: dữ liệu là minh họa, lưu theo trình duyệt, email không gửi thật; (f) khi nối BE thật: đặt `REACT_APP_VISITOR_REPORT_MOCK=false`, thêm `/visitor` vào danh sách đường dẫn công khai trong `src/utils/request.js`, thay nhánh `realFn` của `exportReport` bằng luồng job như `ExportReportModal.jsx`.

- [ ] **Step 3: Chạy trọn kịch bản demo** theo file vừa viết, trên Chrome, từ trạng thái vừa đặt lại dữ liệu. Ghi lại bước nào lệch so với mô tả và sửa.

- [ ] **Step 4: Hồi quy khi tắt cờ**

Run: `REACT_APP_VISITOR_REPORT_MOCK=false npm start`
Kiểm tra: đăng nhập từng vai trò; các màn cũ có layout bị sửa (bảng điều khiển của System Admin, Tổng quan của Business Admin, Trang chủ của Manager và Employee, Hiệu suất phòng họp, Cảnh báo an ninh) mở bình thường; mở một màn mới thì hiện khối lỗi, không trắng trang.

- [ ] **Step 5: Test và build cuối**

Run: `CI=true npx react-scripts test --watchAll=false src/mocks && npm run build`
Expected: 7 file test xanh; `Compiled successfully`.

- [ ] **Step 6: Điểm dừng cuối** — báo `git status -sb`, số test, kết quả build, và bảng 15 dòng checklist đã phủ. Hỏi LamNH có commit không.

