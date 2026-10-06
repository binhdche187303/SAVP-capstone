# KPI-001 — Tổng hợp KPI theo giờ cho Zone & Phương tiện (Task #10)

## CHANGELOG & REVISION HISTORY
| Ngày | Tóm tắt | Vị trí |
| :--- | :--- | :--- |
| 2026-10-05 | Tạo spec KPI-001 (task #10 trong `docs/CAM_AI_GAP_ANALYSIS_300_CAMERAS.md`, người làm: LamNH — tiếp quản từ BinhDC). Chốt hướng A: bảng tổng hợp **theo giờ** + rollup mỗi giờ + đối soát 01:00 + **đọc lai** (aggregate ∪ raw). Giai đoạn 1 chỉ Zone + Phương tiện. Sửa bucket thống kê xe sang giờ VN. | Toàn bộ |
| 2026-10-05 | Đã implement theo plan.md; T1–T9 pass (unit + DB parity); migration run/revert/run đã kiểm chứng; lint toàn repo và 31 suite unit không liên quan fail trên baseline HEAD sạch (đã tồn tại từ trước, không do KPI-001). | — |
| 2026-10-05 | Sửa sau review cuối: I1 zone rollup thêm `zone_id = ANY(ARRAY(SELECT id FROM zones))` để dùng index theo zone; I2 `execute()` luôn `release()` kể cả khi `connect`/`startTransaction` lỗi; m1 bucket raw của zone series dùng `date_trunc(..., 'UTC')`; m2 advisory lock dạng 2 khoá (classid `KPI_ROLLUP_LOCK_CLASSID`); m5 test so khớp assert không rỗng + `afterAll` bền vững. | §4.2, §4.3, §6 |

> **Phạm vi giai đoạn 1:** `GET /campus-dashboard/zones/traffic` (UC-120) và
> `GET /gate-access/admin/vehicle-traffic-stats` (UC-114). **KHÔNG** đổi DTO request/response.
> **KHÔNG** sửa bảng hiện có (chỉ thêm 1 index partial lên `iot_device_events`).
> Mảng họp (`analytics/*`), security alert daily, campus overview N+1 → giai đoạn 2 / task khác (§9).

---

## 1. Bối cảnh & mục tiêu

### 1.1. Yêu cầu nguồn
- `HẦN MỀM QUẢN LÝ CAMERA AI THÔNG MINH.docx.md` §2.12 Dashboard: *"Theo dõi lưu lượng ra vào"*,
  *"Theo dõi phương tiện"*, *"Thống kê theo … tòa nhà và khu vực"*, *"Biểu đồ phân tích theo ngày, tuần, tháng và năm"*.
  §2.6: *"Phân tích lưu lượng người"*, *"Bản đồ nhiệt"*. §2.4: *"Thống kê lưu lượng phương tiện theo thời gian"*.
- `KeHoachTrienKhai_SCMPTS_Fix.xlsx` #10 "Cronjob tổng hợp KPI ban đêm".
- Gap analysis §5.6: ở ~150 event/s cao điểm, `zone_presence_events` + `iot_device_events` đạt hàng triệu dòng/ngày;
  dashboard phải đọc bảng tổng hợp, không quét raw.

### 1.2. Hiện trạng (RECON code + DB dev ngày 2026-10-05)
| Hạng mục | Thực tế |
| :--- | :--- |
| Bảng/MV tổng hợp, cron KPI | **Không có** (18 cron trong `scheduler.service.ts`, không job nào tổng hợp) |
| Zone traffic ([zone-traffic-heatmap.service.ts](../../../../src/modules/campus-dashboard/services/zone-traffic-heatmap.service.ts)) | 2 query raw trên `zone_presence_events WHERE event_type='count'`, series `date_trunc('hour')` + heatmap có **subquery tương quan** `peak_at`. Max range 31 ngày. Index `IDX_zpe_count (zone_id, event_time DESC) WHERE event_type='count'` |
| Vehicle stats ([vehicle-traffic-stats.service.ts](../../../../src/modules/gate-access/services/vehicle-traffic-stats.service.ts)) | 2 query raw trên `iot_device_events WHERE event_type='ivss_vehicle_event'`, đọc `payload_json->>…`. Range **không giới hạn** |
| Index thời gian cho vehicle event | **KHÔNG có** — chỉ có `PK` và `(zone_id, event_time DESC)`; `zone_id` luôn NULL với vehicle event ⇒ **quét toàn bảng** |
| Timezone | DB session = `UTC`. Vehicle bucket dùng `to_char(event_time, …)` không đổi TZ ⇒ **bucket ngày/giờ theo UTC** (xe vào 06:00 VN bị tính ngày hôm trước) |
| `unique_vehicles` | `COUNT(DISTINCT plateNumber)` — không cộng dồn được |

### 1.3. Mục tiêu
- **G1** — Kết quả 2 API **bằng đúng** kết quả query raw trên cùng dữ liệu (trừ thay đổi TZ có chủ đích ở §6.3).
- **G2** — Chi phí đọc **không tăng theo số event raw**: phần raw mỗi request ≤ ~2 giờ + 2 mép lẻ.
- **G3** — Rollup **idempotent**: chạy lại / chạy trùng không làm sai số.
- **G4** — Có đường lùi: tắt đọc aggregate bằng env, hành vi quay về 100% raw.

### 1.4. Ngoài mục tiêu
Không thêm cache Redis cho 2 API này; không đổi permission; không thêm API mới; không partition bảng raw (§5.6 gap analysis, task riêng).

---

## 2. Quyết định thiết kế (đã duyệt 2026-10-05)

| # | Quyết định | Lý do |
| :-: | :--- | :--- |
| D1 | **Bảng thường** + `DELETE`-cửa-sổ rồi `INSERT … SELECT` trong 1 transaction; **không** Materialized View | MV refresh tính lại toàn lịch sử (chậm dần), không làm được cửa sổ lẻ/hôm nay. Delete+insert idempotent, không vướng unique trên cột nullable |
| D2 | Grain **giờ** (`bucket_hour timestamptz`) | Phục vụ được cả series theo giờ lẫn ngày; offset VN là +7 nguyên giờ nên bucket UTC-giờ = bucket VN-giờ |
| D3 | Rollup **mỗi giờ** (phút 05) + **đối soát 01:00** (giờ VN) tính lại 3 ngày | Tên task "ban đêm" nhưng chỉ chạy đêm thì raw phải quét tới 24h; chạy mỗi giờ thì raw ≤ ~2h. Đối soát bắt event đến muộn (bridge/queue trễ) |
| D4 | **Đọc lai**: giờ tròn đã phủ → aggregate; mép + phần sau watermark → raw; gộp trong service | Đúng tuyệt đối, không phụ thuộc lịch chạy job |
| D5 | Chỉ lưu **tổng & đếm** (sum/count/max), không lưu trung bình/tỉ lệ | Gộp giờ → ngày/tháng vẫn đúng |
| D6 | `COUNT DISTINCT` biển số qua bảng riêng `kpi_vehicle_plate_hourly` | Distinct không cộng được; bảng này ~ số biển khác nhau/giờ, nhỏ hơn nhiều raw |
| D7 | Khoá chống chạy trùng bằng `pg_try_advisory_xact_lock` | Không phụ thuộc Redis; nhiều instance chỉ 1 bản chạy, bản kia bỏ lượt |
| D8 | Watermark có **cả `covered_from` và `covered_until`** | Tránh đọc aggregate cho giờ chưa từng được rollup (trước lần deploy / chưa backfill) |
| D9 | Bucket thống kê xe chuyển sang **`Asia/Ho_Chi_Minh`** | Sửa lỗi đang có; đằng nào cũng viết lại query, giữ UTC thì aggregate lưu sẵn dữ liệu sai |

---

## 3. Mô hình dữ liệu

Migration mới **`20261007000001-CreateKpiRollupTables.ts`** (ADD-ONLY, `down()` drop đúng những gì `up()` tạo).

### 3.1. `kpi_zone_hourly`
| Cột | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `bucket_hour` | `timestamptz NOT NULL` | `date_trunc('hour', event_time)` |
| `zone_id` | `uuid NOT NULL` | FK `zones(id)` ON DELETE CASCADE |
| `event_count` | `integer NOT NULL` | `COUNT(*)` event `count` trong giờ (zone có mặt trong heatmap khi > 0) |
| `sample_count` | `integer NOT NULL` | `COUNT(occupancy_count)` (bỏ NULL, giống `AVG`) |
| `occupancy_sum` | `bigint NOT NULL` | `COALESCE(SUM(occupancy_count),0)` |
| `occupancy_peak` | `integer NULL` | `MAX(occupancy_count)` |
| `peak_at` | `timestamptz NOT NULL` | event thắng theo `ORDER BY occupancy_count DESC NULLS LAST, event_time DESC` (đúng quy tắc subquery hiện tại) |
| `computed_at` | `timestamptz NOT NULL DEFAULT now()` | |

PK `(zone_id, bucket_hour)`. Index phụ `(bucket_hour)` cho DELETE cửa sổ.

### 3.2. `kpi_vehicle_hourly`
| Cột | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `id` | `bigserial PK` | (chiều nullable ⇒ không dùng PK tự nhiên, D1) |
| `bucket_hour` | `timestamptz NOT NULL` | |
| `zone_id` | `uuid NULL` | `iot_device_events.zone_id` (hiện luôn NULL — giữ để filter đúng schema) |
| `vehicle_type` | `text NULL` | `payload_json->>'vehicleType'` (text: payload không giới hạn độ dài — tránh rollup lỗi) |
| `direction` | `text NULL` | `payload_json->>'direction'` (`enter/leave/seen/…`) |
| `match_state` | `text NULL` | `payload_json->>'matchState'` |
| `event_count` | `integer NOT NULL` | |
| `computed_at` | `timestamptz NOT NULL DEFAULT now()` | |

Index `(bucket_hour)`. Không FK `zone_id` (nguồn raw cũng không bắt buộc).

### 3.3. `kpi_vehicle_plate_hourly`
| Cột | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `id` | `bigserial PK` | |
| `bucket_hour` | `timestamptz NOT NULL` | |
| `zone_id` | `uuid NULL` | |
| `vehicle_type` | `text NULL` | |
| `plate_number` | `text NOT NULL` | chỉ biển khác NULL (giống `COUNT DISTINCT` bỏ NULL) |

Index `(bucket_hour)`. Một dòng / (giờ, zone, loại xe, biển).

### 3.4. `kpi_rollup_watermarks`
| Cột | Kiểu | Ghi chú |
| :--- | :--- | :--- |
| `rollup_name` | `varchar(50) PK` | `'zone_hourly'`, `'vehicle_hourly'` |
| `covered_from` | `timestamptz NOT NULL` | giờ đầu tiên đã rollup (inclusive) |
| `covered_until` | `timestamptz NOT NULL` | giờ kết thúc đã rollup (exclusive) |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

**Bất biến:** mọi giờ `H` với `covered_from ≤ H < covered_until` đều đã được rollup đầy đủ.

### 3.5. Index bổ sung trên bảng có sẵn
`CREATE INDEX IF NOT EXISTS "IDX_iot_device_events_vehicle_time" ON "iot_device_events" ("event_time") WHERE "event_type" = 'ivss_vehicle_event'`
— dùng cho cả rollup lẫn phần raw của API. Tạo **không** `CONCURRENTLY` (migration chạy trong transaction; bảng dev/demo nhỏ). Ghi chú rủi ro ở §8.

---

## 4. Ghi — Rollup

### 4.1. Module `src/modules/kpi-rollup/`
| Unit | Trách nhiệm | Phụ thuộc |
| :--- | :--- | :--- |
| `entities/*.entity.ts` (4) | Mapping 4 bảng §3 | — |
| `repositories/kpi-watermark.repository.ts` | `get(name)`, `extend(name, from, until)` (gộp khoảng liên tục) | `DataSource` |
| `services/zone-hourly-rollup.service.ts` | `rollup(qr, fromHour, toHour)` — DELETE + INSERT cửa sổ `[fromHour, toHour)` | QueryRunner |
| `services/vehicle-hourly-rollup.service.ts` | Như trên cho 2 bảng xe | QueryRunner |
| `services/kpi-rollup-job.service.ts` | `runIncremental(now)`, `runReconcile(now)`, `runRange(from, to)` — mở transaction, lấy lock, gọi 2 rollup, cập nhật watermark | 3 unit trên |
| `utils/split-read-window.util.ts` | Hàm thuần §5.1 | — |
| `utils/hour.util.ts` | `floorHour`, `ceilHour` (UTC) | — |
| `kpi-rollup.module.ts` | export `KpiRollupJobService`, `KpiWatermarkRepository` | |

### 4.2. SQL rollup (khung)
Zone:
```sql
DELETE FROM kpi_zone_hourly WHERE bucket_hour >= $1 AND bucket_hour < $2;
INSERT INTO kpi_zone_hourly (bucket_hour, zone_id, event_count, sample_count, occupancy_sum, occupancy_peak, peak_at)
WITH src AS (
  SELECT zone_id, event_time, occupancy_count,
         date_trunc('hour', event_time, 'UTC') AS bucket_hour
  FROM zone_presence_events
  WHERE event_type = 'count' AND event_time >= $1 AND event_time < $2
), agg AS (
  SELECT bucket_hour, zone_id,
         COUNT(*) AS event_count, COUNT(occupancy_count) AS sample_count,
         COALESCE(SUM(occupancy_count),0) AS occupancy_sum, MAX(occupancy_count) AS occupancy_peak
  FROM src GROUP BY bucket_hour, zone_id
), peak AS (
  SELECT DISTINCT ON (zone_id, bucket_hour) zone_id, bucket_hour, event_time AS peak_at
  FROM src
  ORDER BY zone_id, bucket_hour, occupancy_count DESC NULLS LAST, event_time DESC
)
SELECT a.bucket_hour, a.zone_id, a.event_count, a.sample_count, a.occupancy_sum, a.occupancy_peak, p.peak_at
FROM agg a JOIN peak p USING (zone_id, bucket_hour);
```
Yêu cầu bắt buộc: **đúng quy tắc chọn đỉnh** như subquery hiện tại, và lọc thời gian theo cửa sổ để dùng được index.

Vehicle: `GROUP BY bucket_hour, zone_id, payload_json->>'vehicleType', ->>'direction', ->>'matchState'` → `kpi_vehicle_hourly`;
`SELECT DISTINCT bucket_hour, zone_id, vehicleType, plateNumber … WHERE plateNumber IS NOT NULL` → `kpi_vehicle_plate_hourly`.

### 4.3. Lịch & cửa sổ
| Job | Lịch | Cửa sổ | Watermark |
| :--- | :--- | :--- | :--- |
| `kpi-rollup-hourly` | `0 5 * * * *` | `[max(covered_until − 2h, covered_from), floorHour(now))`; chưa có watermark ⇒ `[floorHour(now) − 2h, floorHour(now))` | `covered_until = floorHour(now)`; tạo mới thì `covered_from = start` |
| `kpi-rollup-reconcile` | `0 0 1 * * *`, `timeZone: 'Asia/Ho_Chi_Minh'` | `[max(min(floorHour(now) − 72h, covered_until), covered_from), floorHour(now))` (vẫn liền watermark kể cả khi job ngừng > 72h) | như trên |
| Backfill CLI | thủ công | `[from, to)` — mặc định `from` = `min(event_time)` raw, `to` = `covered_from`; chạy từng ngày, mỗi ngày 1 transaction | khi xong khoảng liên tục với `covered_from` ⇒ `covered_from = from` |

- `runRange` (backfill/chạy tay) từ chối `to` > `floorHour(now)` (guard bổ sung khi implement) — tránh đánh dấu watermark phủ giờ chưa kết thúc.
- Hai bảng (`zone_hourly`, `vehicle_hourly`) có watermark riêng nhưng chạy chung 1 job.
- Cờ env: `SCHEDULER_KPI_ROLLUP_ENABLED` (Joi boolean, default `false` — theo pattern các job khác) và chặn bởi `SCHEDULER_ENABLED`.
- Lock: trong transaction, `SELECT pg_try_advisory_xact_lock(hashtext('kpi_rollup'))`; `false` ⇒ log debug, rollback, bỏ lượt. Backfill dùng bản blocking `pg_advisory_xact_lock`.
- Lỗi: log error, rollback toàn bộ (watermark không tiến) — lượt sau tự làm lại cửa sổ.
- Watermark chỉ được **tiến/mở rộng liên tục**: `extend()` từ chối khoảng tạo lỗ hổng (khoảng mới phải giao/chạm `[covered_from, covered_until)`).

### 4.4. Backfill CLI
`scripts/kpi-backfill.ts` (chạy bằng `tsx`, theo kiểu `scripts/seed-academic-demo.ts`): tham số `--from`, `--to` (ISO, tuỳ chọn), in tiến độ từng ngày; idempotent (chạy lại an toàn).

---

## 5. Đọc — Hybrid

### 5.1. `splitReadWindow(from, to, wm)` (hàm thuần)
Input: `from`, `to` (inclusive, như API hiện tại), `wm = {coveredFrom, coveredUntil} | null`, `enabled: boolean`.
- `aggStart = max(ceilHour(from), wm.coveredFrom)`, `aggEnd = min(floorHour(to), wm.coveredUntil)`.
- Nếu `!enabled || wm == null || aggStart >= aggEnd` ⇒ `{ agg: null, raw: [[from, to]] }`.
- Ngược lại ⇒ `agg = [aggStart, aggEnd)`; `raw` = `[from, aggStart)` (nếu `from < aggStart`) và `[aggEnd, to]` **inclusive** (nếu `aggEnd <= to`).

Bảo đảm: các phần **rời nhau**, hợp lại đúng `[from, to]`, và mỗi giờ tròn nằm trọn trong đúng một phần ⇒ bucket theo giờ không bị chia đôi giữa agg và raw.

> Lưu ý: nếu watermark có lỗ ở giữa (không thể theo §4.3), `aggStart/aggEnd` vẫn chỉ lấy 1 khoảng liên tục nên vẫn đúng.

### 5.2. Zone traffic (`ZoneTrafficHeatmapService`)
- **Series** (theo zone × giờ): agg `SELECT zone_id, bucket_hour, occupancy_sum, sample_count, occupancy_peak` ∪ raw (giữ nguyên query cũ nhưng trả `SUM/COUNT/MAX` thay vì `AVG`). Mỗi (zone, giờ) chỉ đến từ 1 nguồn (§5.1) ⇒ `avg = sum / sample_count` (NULL nếu `sample_count = 0`).
- **Heatmap** (theo zone): gộp các phần — `avg = Σsum / Σsample_count`, `peak = max`, `peak_at` = phần tử thắng theo `peak DESC NULLS LAST, peak_at DESC`; zone xuất hiện khi `Σevent_count > 0`.
- Raw phần mép dùng `event_time >= a AND event_time < b` hoặc `<= to` cho mép cuối (giữ semantics `BETWEEN`).
- Response giữ nguyên field, kiểu, thứ tự (`series` sắp `hour_bucket ASC`).

### 5.3. Vehicle stats (`VehicleTrafficStatsService`)
- **Summary**: `total/matched/unmatched/enter/leave/seen` = tổng `event_count` có filter `direction`/`match_state` từ agg ∪ raw.
- **`unique_vehicles`**: `SELECT COUNT(DISTINCT plate) FROM (agg plates ∪ raw plates)` — union trên giá trị biển, không cộng số.
- **Series**: bucket theo **giờ VN** (D9):
  - `hour` ⇒ `to_char(ts AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD HH24:00')`
  - `day` ⇒ `to_char(ts AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')`
  - `ts` = `bucket_hour` (agg) hoặc `event_time` (raw). Cộng `event_count` theo (bucket, direction) rồi pivot như cũ.
- Filter `zone_id`, `vehicle_type` áp dụng như nhau cho agg (cột) và raw (`payload_json`).

### 5.4. Cờ đọc
`KPI_ROLLUP_READ_ENABLED` (Joi boolean, default `true`). `false` ⇒ `splitReadWindow` trả toàn raw (D4/G4).

---

## 6. Thay đổi hành vi & tương thích

### 6.1. API
Không đổi route, permission, DTO request/response.

### 6.2. Zone traffic
Không đổi kết quả (G1).

### 6.3. Vehicle stats — thay đổi có chủ đích
Chuỗi `bucket` chuyển từ giờ UTC sang giờ VN (+7h). Tổng `summary` **không đổi** (lọc theo `from/to` tuyệt đối). Thay đổi múi giờ `bucket` xe cũng lan tới báo cáo PDF/XLSX phương tiện qua `VehicleReportDataService` (bọc `VehicleTrafficStatsService.getStats`).

### 6.4. Phát hiện ngoài phạm vi (ghi nhận, không sửa trong task này)
FE `systemAdmin/dashBoard.jsx:561` và `bussinessAdmin/dashBoard.jsx:416` đọc `data.buckets[].period/total_enter/total_leave`,
trong khi BE trả `{ summary, series: [{ bucket, enter, leave, seen }] }` ⇒ biểu đồ lưu lượng xe trên dashboard **luôn rỗng**.
Cần task FE riêng (đề xuất ghi vào gap analysis).

---

## 7. Kiểm thử & tiêu chí nghiệm thu

| ID | Loại | Nội dung | Pass khi |
| :-: | :--- | :--- | :--- |
| T1 | Unit | `splitReadWindow`: from/to lẻ phút, cùng 1 giờ, to = giờ tròn, to trước `covered_from`, from sau `covered_until`, `enabled=false`, `wm=null` | Các phần rời nhau, hợp lại đúng `[from,to]` |
| T2 | Unit | `floorHour/ceilHour` tại giờ tròn và lẻ | |
| T3 | Unit | Gộp heatmap/series/summary (hàm merge thuần) — tie `peak_at`, `sample_count=0` | |
| T4 | Unit | Watermark `extend()` từ chối khoảng tạo lỗ | |
| T5 | DB (`RUN_DB_TESTS=1`) | Seed event ngẫu nhiên (nhiều zone, NULL occupancy, tie peak, biển trùng, NULL biển) → rollup → so **hybrid vs raw-only** trên nhiều cặp from/to | Bằng nhau (số thực sai số ≤ 1e-9) |
| T6 | DB | Rollup cùng cửa sổ 2 lần | Bảng aggregate y hệt |
| T7 | DB | 2 transaction gọi job song song | Một bản chạy, một bản bỏ lượt |
| T8 | DB | Event đến muộn trong 72h → reconcile | Hybrid lại khớp raw |
| T9 | Unit | Service hiện có: spec cũ của `zone-traffic-heatmap.service.spec.ts`, `vehicle-traffic-stats` vẫn pass (cập nhật mock tối thiểu) | |
| T10 | Build | `npm run build`, `npm run lint`, migration `run` → `revert` → `run` trên DB dev | Không lỗi |

**Nghiệm thu:** T1–T10 pass; G1–G4 thoả; `EXPLAIN` phần raw của vehicle stats dùng `IDX_iot_device_events_vehicle_time` (không Seq Scan).

---

## 8. Rủi ro
| Rủi ro | Giảm thiểu |
| :--- | :--- |
| Tạo index trên `iot_device_events` lớn ở production sẽ khoá ghi | Hiện DB nhỏ; ghi chú trong migration: production lớn thì tạo tay `CONCURRENTLY` trước khi chạy migration (`IF NOT EXISTS` bỏ qua) |
| Event đến muộn > 72h | Chạy lại backfill khoảng đó (idempotent) |
| Cron chạy theo TZ server | Reconcile khai `timeZone: 'Asia/Ho_Chi_Minh'`; hourly không phụ thuộc TZ |
| `bucket` xe đổi giá trị (§6.3) | Ghi changelog; FE hiện không đọc được field này nên không vỡ thêm |
| Sai lệch giữa query raw cũ và rollup | T5 so khớp tự động là cổng chặn |

---

## 9. Giai đoạn sau (không làm trong KPI-001)
- `kpi_meeting_daily` cho `analytics/*` (cần chốt cách gán phòng ban: snapshot lúc rollup vs hiện tại).
- `kpi_security_alert_daily` (volume thấp, ưu tiên thấp).
- Campus overview N+1 (task hiệu năng riêng).
- Retention raw (#32) — aggregate giữ lịch sử khi raw bị xoá.

## 10. Tài liệu cần cập nhật khi hoàn thành
- `docs/CAM_AI_GAP_ANALYSIS_300_CAMERAS.md` #10: trạng thái + người làm + ghi chú §6.4.
- `.env.example`: `SCHEDULER_KPI_ROLLUP_ENABLED`, `KPI_ROLLUP_READ_ENABLED`.
