import { NotFoundException } from '@nestjs/common';
import { BiometricStatusService } from './biometric-status.service.js';

/**
 * ACCT-BIOMETRIC-SUBMIT-001 — Unit test cho BiometricStatusService (US1).
 * Trace: AC-001, AC-003, AC-003b, AC-004, AC-006, AC-016, AC-017.
 */
describe('BiometricStatusService', () => {
  let service: BiometricStatusService;
  let userRepo: { findOne: jest.Mock };
  let faceProfileRepo: { find: jest.Mock };
  let dataSource: { manager: { find: jest.Mock; query: jest.Mock } };

  beforeEach(() => {
    userRepo = { findOne: jest.fn() };
    faceProfileRepo = { find: jest.fn() };
    // default: user không giữ role nào → không exempt sinh trắc học (BA 2026-08-03).
    dataSource = {
      manager: {
        find: jest.fn().mockResolvedValue([]),
        query: jest.fn().mockResolvedValue([]),
      },
    };
    service = new BiometricStatusService(
      userRepo as never,
      faceProfileRepo as never,
      dataSource as never,
    );
  });

  it('user không tồn tại → NotFoundException USER_NOT_FOUND', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(service.getStatus('u1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('không có face profile → not_uploaded, popup=true (AC-001)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([]);

    const result = await service.getStatus('u1');
    expect(result.biometricReviewStatus).toBe('not_uploaded');
    expect(result.shouldShowBiometricPopup).toBe(true);
    expect(result.biometricRequired).toBe(true);
    expect(result.avatarUrl).toBeNull();
  });

  it('approved: status=active, avatarUrl lấy từ users.avatar_url (AC-006)', async () => {
    userRepo.findOne.mockResolvedValue({
      id: 'u1',
      avatarUrl: 'https://res.cloudinary.com/demo/a.jpg',
    });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'active', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.getStatus('u1');
    expect(result.biometricReviewStatus).toBe('approved');
    expect(result.biometricRequired).toBe(false);
    expect(result.avatarUrl).toBe('https://res.cloudinary.com/demo/a.jpg');
  });

  it('active + pending_review → pending_review (AC-003 case trọng yếu)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: 'x' });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'active', lastUpdatedAt: null, enrolledAt: null },
      { status: 'pending_review', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.getStatus('u1');
    expect(result.biometricReviewStatus).toBe('pending_review');
    expect(result.shouldShowBiometricPopup).toBe(false);
  });

  it('rejected thật → message "bị từ chối" (AC-004)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'rejected', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.getStatus('u1');
    expect(result.biometricReviewStatus).toBe('rejected');
    expect(result.message).toContain('bị từ chối');
  });

  it('disabled → rejected, message trung tính không lộ lý do (AC-016)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'disabled', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.getStatus('u1');
    expect(result.biometricReviewStatus).toBe('rejected');
    expect(result.shouldShowBiometricPopup).toBe(true);
    expect(result.message).not.toContain('từ chối');
    expect(result.message).toContain('không còn hợp lệ');
  });

  it('revoked → rejected, message trung tính (AC-017)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'revoked', lastUpdatedAt: null, enrolledAt: null },
    ]);

    const result = await service.getStatus('u1');
    expect(result.biometricReviewStatus).toBe('rejected');
    expect(result.message).not.toContain('từ chối');
  });

  it('BUSINESS_ADMIN chưa upload → biometricRequired=false, popup=false (BA 2026-08-03)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([]);
    dataSource.manager.find.mockResolvedValue([
      { expiredAt: null, role: { roleCode: 'BUSINESS_ADMIN' } },
    ]);

    const result = await service.getStatus('u1');
    expect(result.biometricRequired).toBe(false);
    expect(result.shouldShowBiometricPopup).toBe(false);
  });

  it('SYSTEM_ADMIN → biometricRequired=false dù có ảnh rejected (BA 2026-08-03)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([
      { status: 'rejected', lastUpdatedAt: null, enrolledAt: null },
    ]);
    dataSource.manager.find.mockResolvedValue([
      { expiredAt: null, role: { roleCode: 'SYSTEM_ADMIN' } },
    ]);

    const result = await service.getStatus('u1');
    expect(result.biometricRequired).toBe(false);
    expect(result.shouldShowBiometricPopup).toBe(false);
  });

  it('EMPLOYEE → không bị miễn trừ, giữ nguyên hành vi cũ (BA 2026-08-03)', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', avatarUrl: null });
    faceProfileRepo.find.mockResolvedValue([]);
    dataSource.manager.find.mockResolvedValue([
      { expiredAt: null, role: { roleCode: 'EMPLOYEE' } },
    ]);

    const result = await service.getStatus('u1');
    expect(result.biometricRequired).toBe(true);
    expect(result.shouldShowBiometricPopup).toBe(true);
  });
});

// [2026-11-23] Hồ sơ hiển thị + ảnh từng góc cho màn FaceID.
describe('BiometricStatusService — profile view', () => {
  it('chọn hồ sơ Cần kiểm tra trước, ảnh sắp theo thứ tự góc, có lý do', async () => {
    const userRepo = {
      findOne: jest.fn().mockResolvedValue({ id: 'u1', avatarUrl: null }),
    };
    const t = new Date('2026-11-20T00:00:00Z');
    const faceProfileRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'a', status: 'active', lastUpdatedAt: t, enrolledAt: t },
        {
          id: 'p',
          status: 'pending_review',
          lastUpdatedAt: t,
          enrolledAt: t,
          sampleCount: 2,
          metadataJson: {
            poses: ['front', 'left'],
            flag: { message: 'trùng định danh' },
          },
        },
      ]),
    };
    const query = jest.fn().mockResolvedValue([
      { id: 'm2', file_url: 'u2', file_name: 'left-x' },
      { id: 'm1', file_url: 'u1', file_name: 'front-y' },
    ]);
    const svc = new BiometricStatusService(
      userRepo as never,
      faceProfileRepo as never,
      { manager: { find: jest.fn().mockResolvedValue([]), query } } as never,
    );
    const r = await svc.getStatus('u1');
    expect(r.profile?.faceProfileId).toBe('p');
    expect(r.profile?.reason).toBe('trùng định danh');
    expect(r.profile?.images.map((i) => i.pose)).toEqual(['front', 'left']);
  });

  it('chưa có hồ sơ → profile null', async () => {
    const svc = new BiometricStatusService(
      {
        findOne: jest.fn().mockResolvedValue({ id: 'u1', avatarUrl: null }),
      } as never,
      { find: jest.fn().mockResolvedValue([]) } as never,
      {
        manager: { find: jest.fn().mockResolvedValue([]), query: jest.fn() },
      } as never,
    );
    expect((await svc.getStatus('u1')).profile).toBeNull();
  });
});
