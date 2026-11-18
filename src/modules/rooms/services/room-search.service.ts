import { filterValues } from '../../../common/utils/filter-selection.js';
import { Injectable, BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { SearchRoomsQueryDto } from '../dto/search-rooms-query.dto.js';
import { RoomSearchItemDto } from '../dto/room-search-item.dto.js';
import { AvailableRoomsQueryDto } from '../dto/available-rooms-query.dto.js';
import { AvailableRoomItemDto } from '../dto/available-room-item.dto.js';
import { RoomStatus } from '../entities/room.entity.js';
import { SystemConfigEntity } from '../../administration/entities/system-config.entity.js';

interface RoomSearchRow {
  id: string;
  room_code: string;
  room_name: string;
  site_name: string | null;
  area_name: string | null;
  location_description: string | null;
  capacity: number;
  room_type: string;
  current_status: string;
  administrative_status: string;
  latest_occupancy_count: number | null;
  has_current_booking: boolean;
  has_live_meeting: boolean;
  has_camera: boolean;
  has_microphone: boolean;
  has_display: boolean;
  allow_recording: boolean;
  faulty_count: string | number;
  warning_count: string | number;
}

/**
 * [FIX 2026-08-20] Tin hieu occupancy chi duoc coi la "con hieu luc" trong
 * OCCUPANCY_SIGNAL_TTL_MINUTES phut ke tu event_time. Truoc day subquery lay
 * ban ghi occupancy_count moi nhat MOI TUNG CO, khong gioi han thoi gian —
 * chi can 1 lan camera/test gui occupancy_count > 0 roi im lang mai (khong
 * co event tiep theo dua ve 0), phong bi "dinh" trang thai occupied vinh
 * vien du thuc te khong con ai trong phong (xac nhan tren RDS: co phong hien
 * occupancy_count > 0 tu event cach day hon 700 gio). Gioi han thoi gian nay
 * khien tin hieu cu tu dong het han → COALESCE(...,0) > 0 = false → roi ve
 * logic booking (reserved/available) thay vi ket dinh occupied.
 */
const OCCUPANCY_SIGNAL_TTL_MINUTES = 15;

/** Correlated scalar subquery dung chung cho SELECT + WHERE (khong can LATERAL join). */
const LATEST_OCCUPANCY_SUBQUERY = `(
  SELECT re.occupancy_count FROM room_events re
  WHERE re.room_id = r.id AND re.occupancy_count IS NOT NULL
    AND re.event_time >= now() - interval '${OCCUPANCY_SIGNAL_TTL_MINUTES} minutes'
  ORDER BY re.event_time DESC LIMIT 1
)`;
const HAS_CURRENT_BOOKING_SUBQUERY = `EXISTS (
  SELECT 1 FROM room_bookings rb
  WHERE rb.room_id = r.id
    AND rb.status IN ('approved', 'active')
    AND rb.reserved_start_time <= now() AND rb.reserved_end_time >= now()
)`;
/**
 * [FIX 2026-08-22] Cuoc hop cua booking dang chay da THUC SU bat dau
 * (live-meeting.service flip meeting -> in_progress va booking approved ->
 * active cung luc). Truoc day trang thai 'occupied' chi dua vao tin hieu
 * camera (room_events.occupancy_count); phong dang hop nhung khong co camera
 * gui event bi hien 'reserved' (= "Duoc dat truoc") du da vao hop.
 */
const HAS_LIVE_MEETING_SUBQUERY = `EXISTS (
  SELECT 1 FROM room_bookings rb
  JOIN meetings mt ON mt.id = rb.meeting_id
  WHERE rb.room_id = r.id
    AND rb.status IN ('approved', 'active')
    AND rb.reserved_start_time <= now() AND rb.reserved_end_time >= now()
    AND mt.status = 'in_progress'
)`;
/** Cung logic uu tien voi computeStatus() (JS) — dung de filter theo `status` trong WHERE. */
const COMPUTED_STATUS_SQL = `(CASE
  WHEN r.administrative_status IN ('maintenance', 'inactive') THEN r.administrative_status
  WHEN COALESCE(${LATEST_OCCUPANCY_SUBQUERY}, 0) > 0 THEN 'occupied'
  WHEN ${HAS_LIVE_MEETING_SUBQUERY} THEN 'occupied'
  WHEN ${HAS_CURRENT_BOOKING_SUBQUERY} THEN 'reserved'
  ELSE 'available'
END)`;

interface AvailableRoomRow {
  id: string;
  room_code: string;
  room_name: string;
  site_name: string | null;
  area_name: string | null;
  capacity: number;
  current_status: RoomStatus;
  has_camera: boolean;
  has_microphone: boolean;
  has_display: boolean;
}

export interface RoomSearchResult {
  rooms: RoomSearchItemDto[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    appliedFilters: Record<string, unknown>;
  };
}

/**
 * RoomSearchService (UC-ROOM-04) — read-only, mo cho moi user da dang nhap.
 *
 * Khong tai dung response cua RoomStatusService (RMS-001) — co tinh cat bo cac field
 * van hanh noi bo (occupancyCount/lastPresenceAt/noShowStatus/currentBooking), chi
 * tra du lieu catalog phu hop browse chung (SEC: du lieu nhay cam theo CLAUDE.md §20.2).
 */
@Injectable()
export class RoomSearchService {
  constructor(private readonly dataSource: DataSource) {}

  async filterOptions(): Promise<
    Array<{
      siteName: string | null;
      areaName: string | null;
    }>
  > {
    return this.dataSource.manager.query(
      `SELECT DISTINCT site_name AS "siteName", area_name AS "areaName"
       FROM rooms WHERE is_active = true AND deleted_at IS NULL
       ORDER BY site_name, area_name`,
    );
  }

  async search(query: SearchRoomsQueryDto): Promise<RoomSearchResult> {
    const capacityMin = query.capacityMin ?? null;
    const capacityMax = query.capacityMax ?? null;
    const areaName = query.areaName ?? null;
    const onlyAvailable = query.onlyAvailable ?? null;
    const q = query.q?.trim() || null;
    const status = query.status ? filterValues(query.status) : null;
    const siteName = query.siteName ?? null;
    const locations = query.locations?.map(raw => {
      let value: { siteName?: unknown; areaName?: unknown };
      try { value = JSON.parse(raw); } catch { throw new BadRequestException('Vị trí lọc không hợp lệ'); }
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['siteName', 'areaName'].includes(key)) || Object.values(value).some(item => typeof item !== 'string')) throw new BadRequestException('Vị trí lọc không hợp lệ');
      return value;
    });
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    if (
      capacityMin !== null &&
      capacityMax !== null &&
      capacityMin > capacityMax
    ) {
      throw new BadRequestException({
        success: false,
        message: 'Sức chứa tối thiểu không được lớn hơn sức chứa tối đa',
        error: {
          code: 'VALIDATION_ERROR',
          details: { capacityMin, capacityMax },
        },
      });
    }

    // [FIX 2026-08-19] onlyAvailable/status nay tinh theo trang thai REAL-TIME
    // (giong computeStatus()), khong con tin thang r.current_status (cot bi
    // OccupancyPersistenceService flip 1 chieu sang 'occupied', khong bao gio
    // tu reset). Dung chung cac scalar subquery voi SELECT list ben duoi.
    // q: tim theo roomName/roomCode (ILIKE, param hoa an toan qua $5).
    const whereClause = `
      WHERE r.is_active = true
        AND r.deleted_at IS NULL
        AND ($1::int IS NULL OR r.capacity >= $1)
        AND ($2::int IS NULL OR r.capacity <= $2)
        AND ($3::text IS NULL OR r.area_name = $3)
        AND ($4::boolean IS NULL OR $4 = false OR ${COMPUTED_STATUS_SQL} = 'available')
        AND ($5::text IS NULL OR r.room_name ILIKE '%' || $5 || '%' OR r.room_code ILIKE '%' || $5 || '%')
        AND ($6::text[] IS NULL OR ${COMPUTED_STATUS_SQL} = ANY($6::text[]))
        AND ($7::text IS NULL OR r.site_name = $7)
        AND ($8::jsonb IS NULL OR EXISTS (
          SELECT 1 FROM jsonb_array_elements($8::jsonb) selected_location
          WHERE (NOT selected_location ? 'siteName' OR r.site_name = selected_location->>'siteName')
            AND (NOT selected_location ? 'areaName' OR r.area_name = selected_location->>'areaName')
        ))
    `;
    const whereParams = [
      capacityMin,
      capacityMax,
      areaName,
      onlyAvailable,
      q,
      status,
      siteName,
      locations?.length ? JSON.stringify(locations) : null,
    ];

    const offset = (page - 1) * limit;
    const rows: RoomSearchRow[] = await this.dataSource.manager.query(
      `SELECT r.id, r.room_code, r.room_name, r.site_name, r.area_name,
              r.location_description, r.capacity, r.room_type, r.current_status,
              r.administrative_status,
              ${LATEST_OCCUPANCY_SUBQUERY} AS latest_occupancy_count,
              ${HAS_CURRENT_BOOKING_SUBQUERY} AS has_current_booking,
              ${HAS_LIVE_MEETING_SUBQUERY} AS has_live_meeting,
              r.has_camera, r.has_microphone, r.has_display, r.allow_recording,
              COALESCE(eq.faulty_count, 0) AS faulty_count,
              COALESCE(eq.warning_count, 0) AS warning_count
       FROM rooms r
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*) FILTER (WHERE health_status IN ('faulty','offline')) AS faulty_count,
           COUNT(*) FILTER (WHERE health_status = 'warning') AS warning_count
         FROM equipments e
         WHERE e.current_room_id = r.id AND e.deleted_at IS NULL
       ) eq ON true
       ${whereClause}
       ORDER BY r.room_code ASC
       LIMIT $9 OFFSET $10`,
      [...whereParams, limit, offset],
    );

    const countRows: { count: string }[] = await this.dataSource.manager.query(
      `SELECT COUNT(*) AS count FROM rooms r ${whereClause}`,
      whereParams,
    );
    const total = parseInt(countRows[0]?.count ?? '0', 10);

    const appliedFilters: Record<string, unknown> = {};
    if (capacityMin !== null) appliedFilters.capacityMin = capacityMin;
    if (capacityMax !== null) appliedFilters.capacityMax = capacityMax;
    if (areaName !== null) appliedFilters.areaName = areaName;
    if (siteName !== null) appliedFilters.siteName = siteName;
    if (onlyAvailable !== null) appliedFilters.onlyAvailable = onlyAvailable;
    if (q !== null) appliedFilters.q = q;
    if (status !== null) appliedFilters.status = query.status;
    if (locations?.length) appliedFilters.locations = locations;

    return {
      rooms: rows.map((row) => this.toItem(row)),
      meta: {
        page,
        limit,
        total,
        totalPages: limit > 0 ? Math.ceil(total / limit) : 0,
        appliedFilters,
      },
    };
  }

  /**
   * GET /rooms/available (yeu cau FE, xem
   * Docs/Nam_Sent/backend_api_requirements_available_rooms.md). Loai tru
   * phong dang co booking overlap khung gio yeu cau.
   *
   * Deviation so voi SQL de xuat trong tai lieu FE (da xac thuc voi code hien
   * tai truoc khi sua, xem BAO_CAO_BE tuong ung):
   * - Chi status approved/active moi tinh la "bung", KHONG loai tru theo
   *   kieu "khac cancelled/released" (tuc la KHONG coi pending la bung) —
   *   dung dung quy tac da chot o MeetingsService.getRoomAvailability va
   *   SchedulingService.getRoomSuggestions (Nhom A, 2026-08-08), la quy tac
   *   THAT SU duoc dung khi xac nhan dat phong o POST /meetings.
   * - Co cong them buffer tu system_configs.room_booking_buffer_minutes,
   *   giong POST /meetings, de tranh tinh trang phong hien "trong" o day
   *   nhung van bi tu choi do dinh buffer khi bam xac nhan dat phong.
   * - Bang du lieu that la `room_bookings` (reserved_start_time /
   *   reserved_end_time), khong phai `meetings`/`bookings` chung chung.
   */
  async getAvailableRooms(
    query: AvailableRoomsQueryDto,
  ): Promise<AvailableRoomItemDto[]> {
    const startTime = new Date(query.startTime);
    const endTime = new Date(query.endTime);

    if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
      throw new BadRequestException({
        success: false,
        message: 'startTime hoặc endTime không đúng định dạng',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }
    if (endTime <= startTime) {
      throw new BadRequestException({
        success: false,
        message: 'Thời gian kết thúc phải sau thời gian bắt đầu',
        error: { code: 'VALIDATION_ERROR', details: {} },
      });
    }

    const minCapacity = query.minCapacity ?? null;
    const bufferMs = await this.getRoomBookingBufferMs();
    const bufferedStart = new Date(startTime.getTime() - bufferMs);
    const bufferedEnd = new Date(endTime.getTime() + bufferMs);

    const rows: AvailableRoomRow[] = await this.dataSource.manager.query(
      `SELECT r.id, r.room_code, r.room_name, r.site_name, r.area_name,
              r.capacity, r.current_status, r.has_camera, r.has_microphone,
              r.has_display
       FROM rooms r
       WHERE r.is_active = true
         AND r.deleted_at IS NULL
         AND ($1::int IS NULL OR r.capacity >= $1)
         AND NOT EXISTS (
           SELECT 1 FROM room_bookings rb
           WHERE rb.room_id = r.id
             AND rb.status IN ('approved', 'active')
             AND rb.reserved_start_time < $3
             AND rb.reserved_end_time > $2
         )
       ORDER BY r.room_code ASC`,
      [minCapacity, bufferedStart, bufferedEnd],
    );

    return rows.map((row) => ({
      id: row.id,
      roomName: row.room_name,
      roomCode: row.room_code,
      capacity: row.capacity,
      status: row.current_status,
      siteName: row.site_name,
      areaName: row.area_name,
      hasCamera: row.has_camera,
      hasMicrophone: row.has_microphone,
      hasScreen: row.has_display,
    }));
  }

  /**
   * Doc `system_configs.room_booking_buffer_minutes` (mac dinh 15 phut neu
   * thieu config/gia tri khong hop le). ORDER BY updated_at DESC vi
   * config_key khong co unique constraint tren RDS that. Sao chep tu
   * SchedulingService/MeetingsService (khong tach shared helper — quy uoc da
   * co san trong repo o 2 noi khac).
   */
  private async getRoomBookingBufferMs(): Promise<number> {
    const DEFAULT_MINUTES = 15;
    try {
      const config = await this.dataSource
        .getRepository(SystemConfigEntity)
        .findOne({
          where: { configKey: 'room_booking_buffer_minutes' },
          order: { updatedAt: 'DESC' },
        });
      if (!config) return DEFAULT_MINUTES * 60_000;
      const parsed = parseInt(config.configValue ?? '', 10);
      if (isNaN(parsed) || parsed < 0) {
        return DEFAULT_MINUTES * 60_000;
      }
      return parsed * 60_000;
    } catch {
      return DEFAULT_MINUTES * 60_000;
    }
  }

  /**
   * [FIX 2026-08-19] Tinh trang thai HIEN THI real-time thay vi doc thang
   * `r.current_status` — cot do OccupancyPersistenceService flip mot chieu
   * sang 'occupied' va KHONG BAO GIO tu reset ve 'available', nen doc truc
   * tiep se "dung yen" nhu du lieu tinh/mock. Uu tien giong RoomStatusService:
   * 1. administrative_status (admin dat qua PATCH .../administrative-status)
   *    neu la 'maintenance'/'inactive' — luon thang.
   * 2. 'occupied' neu tin hieu occupancy CON HIEU LUC (trong
   *    OCCUPANCY_SIGNAL_TTL_MINUTES phut gan nhat, xem LATEST_OCCUPANCY_SUBQUERY) > 0.
   * 3. [FIX 2026-08-22] 'occupied' neu cuoc hop cua booking dang chay da bat dau
   *    (meetings.status = 'in_progress', xem HAS_LIVE_MEETING_SUBQUERY).
   * 4. 'reserved' neu co booking approved/active dang trong khung gio hien tai
   *    nhung cuoc hop chua bat dau.
   * 5. 'available' con lai.
   */
  private computeStatus(row: RoomSearchRow): RoomStatus {
    if (
      row.administrative_status === RoomStatus.MAINTENANCE ||
      row.administrative_status === RoomStatus.INACTIVE
    ) {
      return row.administrative_status as RoomStatus;
    }
    if ((row.latest_occupancy_count ?? 0) > 0) return RoomStatus.OCCUPIED;
    if (row.has_live_meeting) return RoomStatus.OCCUPIED;
    if (row.has_current_booking) return RoomStatus.RESERVED;
    return RoomStatus.AVAILABLE;
  }

  private toItem(row: RoomSearchRow): RoomSearchItemDto {
    const faultyCount = Number(row.faulty_count);
    const warningCount = Number(row.warning_count);
    return {
      roomId: row.id,
      roomCode: row.room_code,
      roomName: row.room_name,
      siteName: row.site_name,
      areaName: row.area_name,
      locationDescription: row.location_description,
      capacity: row.capacity,
      roomType: row.room_type as RoomSearchItemDto['roomType'],
      currentStatus: this.computeStatus(row),
      hasCamera: row.has_camera,
      hasMicrophone: row.has_microphone,
      hasDisplay: row.has_display,
      allowRecording: row.allow_recording,
      hasFaultyEquipment: faultyCount > 0,
      faultyEquipmentCount: faultyCount,
      hasEquipmentWarning: warningCount > 0,
    };
  }
}
