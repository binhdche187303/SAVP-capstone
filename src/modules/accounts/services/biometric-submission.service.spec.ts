import {
  BadGatewayException,
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
  BiometricSubmissionService,
  UploadedBiometricFile,
} from './biometric-submission.service.js';
import {
  FaceEnrollmentHook,
  FaceImageChecker,
} from './face-enrollment.hook.js';

/**
 * ACCT-BIOMETRIC-SUBMIT-001 — Unit test cho BiometricSubmissionService.
 * [2026-11-23] Tự duyệt: qua kiểm tra → active (thay bộ cũ) + đồng bộ HGVision;
 * trùng định danh người khác → VẪN active, chỉ gắn cờ (metadata.flag + audit) để hậu kiểm.
 */

const jpegBuffer = (size = 1024): Buffer => {
  const buf = Buffer.alloc(size);
  buf[0] = 0xff;
  buf[1] = 0xd8;
  buf[2] = 0xff;
  return buf;
};

const makeFile = (
  over: Partial<UploadedBiometricFile> = {},
): UploadedBiometricFile => ({
  buffer: jpegBuffer(),
  originalname: 'me.jpg',
  mimetype: 'image/jpeg',
  size: 1024,
  ...over,
});

const POSES = ['front', 'left', 'right', 'up', 'down'];
const fiveFiles = () => POSES.map(() => makeFile());

describe('BiometricSubmissionService', () => {
  let service: BiometricSubmissionService;
  let userRepo: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock; manager: { find: jest.Mock } };
  let cloudinary: {
    uploadImage: jest.Mock;
    deleteImage: jest.Mock;
    resolveMediaStorageProvider: jest.Mock;
  };
  let configService: { get: jest.Mock };
  let hook: FaceEnrollmentHook;
  let notifySpy: jest.SpyInstance;
  let existing: Array<Record<string, unknown>>;
  let inserts: Array<Record<string, unknown> | Record<string, unknown>[]>;
  let updates: Array<{ id: string; patch: Record<string, unknown> }>;
  let queries: string[];
  let uploadSeq: number;

  const insertedProfile = () =>
    inserts.find((p) => !Array.isArray(p) && 'profileCode' in p) as Record<
      string,
      unknown
    >;
  const insertedAudit = () =>
    inserts.find((p) => !Array.isArray(p) && 'actionType' in p) as Record<
      string,
      unknown
    >;
  const insertedMedia = () =>
    inserts.find((p) => Array.isArray(p)) as Record<string, unknown>[];

  const useChecker = (c: Partial<FaceImageChecker>) =>
    hook.registerChecker({
      inspect: jest.fn().mockResolvedValue({ faceCount: 1, matches: [] }),
      faceIdentOf: jest.fn().mockResolvedValue('SV001'),
      ...c,
    });

  beforeEach(() => {
    existing = [];
    inserts = [];
    updates = [];
    queries = [];
    uploadSeq = 0;
    userRepo = { findOne: jest.fn() };
    cloudinary = {
      uploadImage: jest.fn(() =>
        Promise.resolve({
          publicId: `biometrics/x${++uploadSeq}`,
          secureUrl: `https://res.cloudinary.com/demo/biometrics/x${uploadSeq}.jpg`,
        }),
      ),
      deleteImage: jest.fn().mockResolvedValue(undefined),
      resolveMediaStorageProvider: jest.fn().mockReturnValue('cloud_provider'),
    };
    configService = { get: jest.fn((_k: string, def?: unknown) => def) };
    dataSource = {
      transaction: jest.fn(async (cb: (m: unknown) => Promise<void>) => {
        const qb = {
          setLock: () => qb,
          where: () => qb,
          andWhere: () => qb,
          getMany: () => Promise.resolve(existing),
        };
        const manager = {
          createQueryBuilder: () => qb,
          update: (_e: unknown, id: string, patch: Record<string, unknown>) => {
            updates.push({ id, patch });
            return Promise.resolve({});
          },
          query: (sql: string) => {
            queries.push(sql);
            return Promise.resolve([]);
          },
          getRepository: () => ({
            insert: (payload: Record<string, unknown>) => {
              inserts.push(payload);
              return Promise.resolve({});
            },
          }),
        };
        return cb(manager);
      }),
      // default: user không giữ role nào → không exempt sinh trắc học.
      manager: { find: jest.fn().mockResolvedValue([]) },
    };
    hook = new FaceEnrollmentHook();
    notifySpy = jest.spyOn(hook, 'notifyChanged');

    service = new BiometricSubmissionService(
      userRepo as never,
      {} as never,
      dataSource as never,
      cloudinary as never,
      configService as never,
      hook,
    );

    userRepo.findOne.mockResolvedValue({ id: 'u1', accountStatus: 'active' });
  });

  // ── Chặn sớm ──

  it('BUSINESS_ADMIN → 403 BIOMETRIC_NOT_APPLICABLE_FOR_ROLE, không upload', async () => {
    dataSource.manager.find.mockResolvedValue([
      { expiredAt: null, role: { roleCode: 'BUSINESS_ADMIN' } },
    ]);
    await expect(service.submit('u1', makeFile(), true)).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_NOT_APPLICABLE_FOR_ROLE' },
    });
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('SYSTEM_ADMIN → 403 BIOMETRIC_NOT_APPLICABLE_FOR_ROLE', async () => {
    dataSource.manager.find.mockResolvedValue([
      { expiredAt: null, role: { roleCode: 'SYSTEM_ADMIN' } },
    ]);
    await expect(service.submit('u1', makeFile(), true)).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_NOT_APPLICABLE_FOR_ROLE' },
    });
  });

  it('thiếu file → BIOMETRIC_FILE_REQUIRED', async () => {
    await expect(service.submit('u1', undefined, true)).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_FILE_REQUIRED' },
    });
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('tự quét thiếu góc (< 5 ảnh) → BIOMETRIC_SCAN_INCOMPLETE', async () => {
    await expect(
      service.submitScan('u1', [makeFile(), makeFile()], POSES, true),
    ).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_SCAN_INCOMPLETE' },
    });
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('magic bytes sai (PDF) → BIOMETRIC_FILE_TYPE_INVALID', async () => {
    const pdf = makeFile({ buffer: Buffer.from('%PDF-1.7', 'ascii') });
    await expect(service.submit('u1', pdf, true)).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_FILE_TYPE_INVALID' },
    });
  });

  it('file quá lớn → BIOMETRIC_FILE_TOO_LARGE', async () => {
    configService.get.mockReturnValue(5 * 1024 * 1024);
    const big = makeFile({ size: 8 * 1024 * 1024 });
    await expect(service.submit('u1', big, true)).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_FILE_TOO_LARGE' },
    });
  });

  it('consent false → BIOMETRIC_CONSENT_REQUIRED, không upload', async () => {
    await expect(service.submit('u1', makeFile(), false)).rejects.toMatchObject(
      { response: { code: 'BIOMETRIC_CONSENT_REQUIRED' } },
    );
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('admin đăng ký hộ (skipConsent) → không cần consent', async () => {
    const r = await service.submitScan('u1', [makeFile()], ['front'], false, {
      minImages: 1,
      skipConsent: true,
      actorId: 'admin-1',
      source: 'admin_upload',
    });
    expect(r.biometricReviewStatus).toBe('approved');
    expect(insertedProfile().enrolledBy).toBe('admin-1');
    expect(insertedAudit().userId).toBe('admin-1');
  });

  it('account không active → ACCOUNT_NOT_ACTIVE', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u1', accountStatus: 'locked' });
    await expect(service.submit('u1', makeFile(), true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('user không tồn tại → USER_NOT_FOUND', async () => {
    userRepo.findOne.mockResolvedValue(null);
    await expect(service.submit('u1', makeFile(), true)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  // ── Tự duyệt ──

  it('quét 5 góc, không có checker → active, serverCheck=skipped, đồng bộ HGVision', async () => {
    const r = await service.submitScan('u1', fiveFiles(), POSES, 'true');

    expect(r.biometricReviewStatus).toBe('approved');
    expect(r.sampleCount).toBe(5);
    expect(r.serverCheck).toBe('skipped');
    expect(cloudinary.uploadImage).toHaveBeenCalledTimes(5);
    const profile = insertedProfile();
    expect(profile.status).toBe('active');
    expect(profile.sampleCount).toBe(5);
    expect((profile.metadataJson as { poses: string[] }).poses).toEqual(POSES);
    expect(insertedMedia()).toHaveLength(5);
    expect(insertedMedia()[0].id).toBe(profile.primaryImageFileId);
    expect(insertedAudit().actionType).toBe('biometric.auto_approve');
    expect(notifySpy).toHaveBeenCalledWith('u1');
  });

  it('đã có bộ active → bộ cũ revoked, mapping kho chân dung hạ về pending', async () => {
    existing = [{ id: 'old', status: 'active', metadataJson: null }];
    await service.submitScan('u1', fiveFiles(), POSES, true);

    expect(updates).toEqual([
      expect.objectContaining({
        id: 'old',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        patch: expect.objectContaining({ status: 'revoked' }),
      }),
    ]);
    expect(queries.some((q) => q.includes('device_user_mappings'))).toBe(true);
    expect(insertedAudit().oldValueJson).toEqual({
      revokedFaceProfileId: 'old',
    });
  });

  it('đang có bộ "Cần kiểm tra" → bộ đó bị thay (rejected + supersededBy)', async () => {
    existing = [{ id: 'flagged', status: 'pending_review', metadataJson: {} }];
    const r = await service.submitScan('u1', fiveFiles(), POSES, true);

    const u = updates.find((x) => x.id === 'flagged');
    expect(u?.patch.status).toBe('rejected');
    expect(
      (u?.patch.metadataJson as { supersededBy: string }).supersededBy,
    ).toBe(r.faceProfileId);
  });

  // ── Lớp 2: đúng 1 khuôn mặt ──

  it('ảnh không có mặt → 422 BIOMETRIC_NO_FACE, KHÔNG upload', async () => {
    useChecker({
      inspect: jest
        .fn()
        .mockResolvedValueOnce({ faceCount: 1, matches: [] })
        .mockResolvedValueOnce({ faceCount: 0, matches: [] }),
    });
    await expect(
      service.submitScan('u1', fiveFiles(), POSES, true),
    ).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_NO_FACE', details: { pose: 'left' } },
    });
    expect(cloudinary.uploadImage).not.toHaveBeenCalled();
  });

  it('ảnh có 2 mặt → 422 BIOMETRIC_MULTIPLE_FACES', async () => {
    useChecker({
      inspect: jest.fn().mockResolvedValue({ faceCount: 2, matches: [] }),
    });
    await expect(
      service.submitScan('u1', fiveFiles(), POSES, true),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  // ── Lớp 3: trùng định danh ──

  it('khớp định danh NGƯỜI KHÁC ≥ ngưỡng → vẫn tự duyệt active, gắn cờ, thay bộ cũ, đồng bộ', async () => {
    existing = [{ id: 'old', status: 'active', metadataJson: null }];
    useChecker({
      inspect: jest.fn().mockResolvedValue({
        faceCount: 1,
        matches: [{ faceIdent: 'SV999', score: 0.91 }],
      }),
    });
    const r = await service.submitScan('u1', fiveFiles(), POSES, true);

    expect(r.biometricReviewStatus).toBe('approved');
    expect(insertedProfile().status).toBe('active');
    expect(
      (insertedProfile().metadataJson as { flag: { reason: string } }).flag
        .reason,
    ).toBe('duplicate_identity');
    expect(insertedAudit().actionType).toBe('biometric.auto_approve');
    expect(
      (insertedAudit().newValueJson as { flagged?: boolean }).flagged,
    ).toBe(true);
    expect(updates.find((x) => x.id === 'old')?.patch.status).toBe('revoked');
    expect(notifySpy).toHaveBeenCalledWith('u1');
  });

  it('điểm thang 0..100 (85) vẫn được quy đổi → gắn cờ', async () => {
    useChecker({
      inspect: jest.fn().mockResolvedValue({
        faceCount: 1,
        matches: [{ faceIdent: 'SV999', score: 85 }],
      }),
    });
    await service.submitScan('u1', fiveFiles(), POSES, true);
    expect(insertedProfile().status).toBe('active');
    expect(
      (insertedProfile().metadataJson as { flag?: unknown }).flag,
    ).toBeDefined();
  });

  it('khớp CHÍNH MÌNH (đăng ký lại) → vẫn active', async () => {
    useChecker({
      inspect: jest.fn().mockResolvedValue({
        faceCount: 1,
        matches: [{ faceIdent: 'SV001', score: 0.99 }],
      }),
    });
    const r = await service.submitScan('u1', fiveFiles(), POSES, true);
    expect(r.biometricReviewStatus).toBe('approved');
    expect(r.serverCheck).toBe('passed');
  });

  it('khớp dưới ngưỡng → active', async () => {
    useChecker({
      inspect: jest.fn().mockResolvedValue({
        faceCount: 1,
        matches: [{ faceIdent: 'SV999', score: 0.3 }],
      }),
    });
    const r = await service.submitScan('u1', fiveFiles(), POSES, true);
    expect(r.biometricReviewStatus).toBe('approved');
  });

  it('kho định danh lỗi → không chặn người dùng, active + serverCheck=skipped', async () => {
    useChecker({ inspect: jest.fn().mockRejectedValue(new Error('timeout')) });
    const r = await service.submitScan('u1', fiveFiles(), POSES, true);
    expect(r.biometricReviewStatus).toBe('approved');
    expect(r.serverCheck).toBe('skipped');
  });

  // ── Lỗi lưu trữ ──

  it('Cloudinary lỗi giữa chừng → dọn ảnh đã up, BIOMETRIC_STORAGE_FAILED, không mở transaction', async () => {
    cloudinary.uploadImage
      .mockResolvedValueOnce({ publicId: 'biometrics/a', secureUrl: 'u' })
      .mockRejectedValueOnce(new Error('cloudinary down'));
    await expect(
      service.submitScan('u1', fiveFiles(), POSES, true),
    ).rejects.toBeInstanceOf(BadGatewayException);
    expect(cloudinary.deleteImage).toHaveBeenCalledWith('biometrics/a');
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('transaction lỗi → dọn TẤT CẢ ảnh + BIOMETRIC_UPLOAD_FAILED', async () => {
    dataSource.transaction.mockRejectedValue(new Error('db write failed'));
    await expect(
      service.submitScan('u1', fiveFiles(), POSES, true),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(cloudinary.deleteImage).toHaveBeenCalledTimes(5);
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it('unique violation (2 lần nộp song song) → BIOMETRIC_SUBMIT_IN_PROGRESS', async () => {
    const err = new QueryFailedError('q', [], {
      code: '23505',
      constraint: 'ux_face_profiles_user_pending',
    } as never);
    dataSource.transaction.mockRejectedValue(err);
    await expect(service.submit('u1', makeFile(), true)).rejects.toMatchObject({
      response: { code: 'BIOMETRIC_SUBMIT_IN_PROGRESS' },
    });
  });
});
