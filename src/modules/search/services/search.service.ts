import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, IsNull, Not, Or, Repository } from 'typeorm';
import { VISITOR_DEPARTMENT_ID } from '../../visitors/constants/visit-status.constant.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { ZoneEntity } from '../../zones/entities/zone.entity.js';
import { IoTDeviceEntity } from '../../iot/entities/iot-device.entity.js';
import { VehicleRegistrationEntity } from '../../anpr/entities/vehicle-registration.entity.js';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { MeetingEntity } from '../../meetings/entities/meeting.entity.js';
import { normalizePlate } from '../../anpr/utils/normalize-plate.js';
import { SearchType } from '../constants/search-type.constant.js';
import type {
  SearchResponseDto,
  SearchResultItemDto,
  SearchTypeResultDto,
} from '../dto/search-response.dto.js';

const RESULTS_PER_TYPE = 10;

/**
 * SRCH-01 spec §2.5 — permission-code đọc tương ứng từng loại resource. Hard-code trong
 * service (KHÔNG đọc từ DB/config) — nếu module gốc đổi permission-code, PHẢI sửa map này.
 */
const TYPE_PERMISSION_MAP: Record<SearchType, string> = {
  zone: 'zones.zone.read',
  device: 'iot.device.read',
  vehicle: 'anpr.vehicle.admin_read',
  user: 'accounts.user.list',
  meeting: 'meeting.read.all',
};

/**
 * SearchService (SRCH-01) — tìm kiếm tổng hợp đa nguồn, READ-ONLY (DATA-01).
 *
 * ARCH-02: KHÔNG import `ZonesModule`/`IotModule`/`AnprModule`/`AccountsModule`/
 * `MeetingsModule` — chỉ inject entity trực tiếp qua `@InjectRepository`.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly authzRepo: AuthzReadRepository,
    @InjectRepository(ZoneEntity)
    private readonly zoneRepo: Repository<ZoneEntity>,
    @InjectRepository(IoTDeviceEntity)
    private readonly deviceRepo: Repository<IoTDeviceEntity>,
    @InjectRepository(VehicleRegistrationEntity)
    private readonly vehicleRepo: Repository<VehicleRegistrationEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(MeetingEntity)
    private readonly meetingRepo: Repository<MeetingEntity>,
  ) {}

  /** R4 (crux): type không có permission bị loại HẲN khỏi response, không query, không 403. */
  async search(
    userId: string,
    q: string,
    types: SearchType[],
  ): Promise<SearchResponseDto> {
    const { permissions } =
      await this.authzRepo.getEffectiveRolesAndPermissions(userId);
    const allowedTypes = types.filter((type) =>
      permissions.includes(TYPE_PERMISSION_MAP[type]),
    );

    const results = await Promise.all(
      allowedTypes.map((type) => this.searchByType(type, q)),
    );

    return { query: q, types: results };
  }

  private async searchByType(
    type: SearchType,
    q: string,
  ): Promise<SearchTypeResultDto> {
    switch (type) {
      case 'zone':
        return { type, items: await this.searchZones(q) };
      case 'device':
        return { type, items: await this.searchDevices(q) };
      case 'vehicle':
        return { type, items: await this.searchVehicles(q) };
      case 'user':
        return { type, items: await this.searchUsers(q) };
      case 'meeting':
        return { type, items: await this.searchMeetings(q) };
    }
  }

  private async searchZones(q: string): Promise<SearchResultItemDto[]> {
    const like = `%${q}%`;
    const rows = await this.zoneRepo.find({
      where: [
        { zoneName: ILike(like), deletedAt: IsNull() },
        { zoneCode: ILike(like), deletedAt: IsNull() },
      ],
      take: RESULTS_PER_TYPE,
    });
    return rows.map((zone) => ({
      type: 'zone' as const,
      id: zone.id,
      label: zone.zoneName,
      subtitle: `${zone.zoneCode} · ${zone.zoneType}`,
    }));
  }

  /** R6: IoTDeviceEntity KHÔNG có `deletedAt` — KHÔNG filter cột này. */
  private async searchDevices(q: string): Promise<SearchResultItemDto[]> {
    const like = `%${q}%`;
    const rows = await this.deviceRepo.find({
      where: [{ deviceName: ILike(like) }, { deviceCode: ILike(like) }],
      take: RESULTS_PER_TYPE,
    });
    return rows.map((device) => ({
      type: 'device' as const,
      id: device.id,
      label: device.deviceName,
      subtitle: device.deviceCode,
    }));
  }

  private async searchVehicles(q: string): Promise<SearchResultItemDto[]> {
    const normalized = normalizePlate(q);
    const rows = await this.vehicleRepo.find({
      where: [{ plateNumber: ILike(`%${normalized}%`), deletedAt: IsNull() }],
      take: RESULTS_PER_TYPE,
    });
    return rows.map((vehicle) => ({
      type: 'vehicle' as const,
      id: vehicle.id,
      label: vehicle.plateRaw,
      subtitle: vehicle.vehicleType,
    }));
  }

  private async searchUsers(q: string): Promise<SearchResultItemDto[]> {
    const like = `%${q}%`;
    const notVisitorDept = Or(IsNull(), Not(VISITOR_DEPARTMENT_ID));
    const rows = await this.userRepo.find({
      // Loại tài khoản khách ẩn (VIS-BE-001).
      where: [
        { fullName: ILike(like), deletedAt: IsNull(), departmentId: notVisitorDept },
        { email: ILike(like), deletedAt: IsNull(), departmentId: notVisitorDept },
        { employeeCode: ILike(like), deletedAt: IsNull(), departmentId: notVisitorDept },
      ],
      take: RESULTS_PER_TYPE,
    });
    return rows.map((user) => ({
      type: 'user' as const,
      id: user.id,
      label: user.fullName,
      subtitle: user.email,
    }));
  }

  private async searchMeetings(q: string): Promise<SearchResultItemDto[]> {
    const like = `%${q}%`;
    const rows = await this.meetingRepo.find({
      where: [{ title: ILike(like), deletedAt: IsNull() }],
      take: RESULTS_PER_TYPE,
    });
    return rows.map((meeting) => ({
      type: 'meeting' as const,
      id: meeting.id,
      label: meeting.title,
      subtitle: meeting.meetingCode,
    }));
  }
}
