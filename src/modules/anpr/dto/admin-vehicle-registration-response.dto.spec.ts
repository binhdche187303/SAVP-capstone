import { VehicleRegistrationEntity } from '../entities/vehicle-registration.entity.js';
import { toAdminVehicleRegistrationResponse } from './admin-vehicle-registration-response.dto.js';

const baseEntity = (): VehicleRegistrationEntity =>
  ({
    id: 'veh1',
    userId: 'u1',
    plateRaw: '30A-123.45',
    plateNumber: '30A12345',
    vehicleType: 'car',
    note: null,
    status: 'active',
    createdAt: new Date('2026-07-23T00:00:00Z'),
    updatedAt: new Date('2026-07-23T00:00:00Z'),
    deletedAt: null,
  }) as VehicleRegistrationEntity;

describe('toAdminVehicleRegistrationResponse (UC-101)', () => {
  it('vr.user set → owner {user_id, full_name, email, avatar_url}; KHÔNG field nhạy cảm', () => {
    const entity = baseEntity();
    entity.user = {
      id: 'u1',
      fullName: 'Nguyen Van A',
      email: 'a@example.com',
      avatarUrl: '/uploads/avatars/a.jpg',
      // các field nhạy cảm — PHẢI không xuất hiện trong output
      phoneNumber: '0900000000',
      username: 'nva',
      employeeCode: 'E001',
      passwordHash: 'secret',
    } as VehicleRegistrationEntity['user'];

    const out = toAdminVehicleRegistrationResponse(entity);

    expect(out.owner).toEqual({
      user_id: 'u1',
      full_name: 'Nguyen Van A',
      email: 'a@example.com',
      avatar_url: '/uploads/avatars/a.jpg',
    });
    // 0 field nhạy cảm rò qua khối owner
    const owner = out.owner as Record<string, unknown>;
    expect(owner).not.toHaveProperty('phoneNumber');
    expect(owner).not.toHaveProperty('username');
    expect(owner).not.toHaveProperty('employeeCode');
    expect(owner).not.toHaveProperty('passwordHash');
    expect(owner).not.toHaveProperty('phone');
    expect(owner).not.toHaveProperty('department');
  });

  it('chủ xe chưa có ảnh → avatar_url: null', () => {
    const entity = baseEntity();
    entity.user = {
      id: 'u2',
      fullName: 'B',
      email: 'b@example.com',
    } as VehicleRegistrationEntity['user'];
    expect(toAdminVehicleRegistrationResponse(entity).owner?.avatar_url).toBeNull();
  });

  it('vr.user null → owner: null (không nổ)', () => {
    const entity = baseEntity();
    entity.user = null as unknown as VehicleRegistrationEntity['user'];
    const out = toAdminVehicleRegistrationResponse(entity);
    expect(out.owner).toBeNull();
  });

  it('giữ nguyên mọi field của mapper user (không sót field xe)', () => {
    const out = toAdminVehicleRegistrationResponse(baseEntity());
    expect(out.id).toBe('veh1');
    expect(out.user_id).toBe('u1');
    expect(out.plate_raw).toBe('30A-123.45');
    expect(out.plate_number).toBe('30A12345');
    expect(out.vehicle_type).toBe('car');
    expect(out.status).toBe('active');
  });

  // ── T6b: account_expires_at mapper (VPT-BE-06 / VPT-001) ──

  it('T6b: entity.user.accountExpiresAt = Date → account_expires_at = đúng ISO string', () => {
    const entity = baseEntity();
    const expireDate = new Date('2027-12-31T17:00:00.000Z');
    entity.user = {
      id: 'u1',
      fullName: 'Nguyen Van A',
      email: 'a@example.com',
      accountExpiresAt: expireDate,
    } as VehicleRegistrationEntity['user'];
    const out = toAdminVehicleRegistrationResponse(entity);
    expect(out.account_expires_at).toBe(expireDate.toISOString());
  });

  it('T6b: entity.user.accountExpiresAt = null (nhân viên thường) → account_expires_at === null', () => {
    const entity = baseEntity();
    entity.user = {
      id: 'u1',
      fullName: 'Nguyen Van A',
      email: 'a@example.com',
      accountExpiresAt: null,
    } as VehicleRegistrationEntity['user'];
    const out = toAdminVehicleRegistrationResponse(entity);
    expect(out.account_expires_at).toBeNull();
  });

  it('T6b: entity.user = null → account_expires_at === null (cùng nhánh với owner === null, không nổ)', () => {
    const entity = baseEntity();
    entity.user = null as unknown as VehicleRegistrationEntity['user'];
    const out = toAdminVehicleRegistrationResponse(entity);
    expect(out.owner).toBeNull();
    expect(out.account_expires_at).toBeNull();
  });
});
