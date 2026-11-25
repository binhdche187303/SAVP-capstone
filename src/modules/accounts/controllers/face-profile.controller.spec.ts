/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument */
import { BadRequestException } from '@nestjs/common';
import { FaceProfileController } from './face-profile.controller.js';

/** [2026-11-23] Admin đăng ký hộ → đi qua BiometricSubmissionService.submitScan (tự duyệt). */
describe('FaceProfileController (FPE-001)', () => {
  let controller: FaceProfileController;
  let serviceMock: any;

  beforeEach(() => {
    serviceMock = { submitScan: jest.fn() };
    controller = new FaceProfileController(serviceMock);
  });

  const file = (fieldname = 'file') => ({
    fieldname,
    buffer: Buffer.from('x'),
    originalname: 'a.jpg',
    mimetype: 'image/jpeg',
    size: 10,
  });

  it('enroll → submitScan (admin, bỏ consent) + envelope {success,message,data}', async () => {
    serviceMock.submitScan.mockResolvedValue({
      faceProfileId: 'fp-1',
      biometricReviewStatus: 'approved',
      submittedAt: 'now',
    });
    const f = file();
    const r = await controller.enroll(
      'u1',
      [f, file('other')],
      {},
      {
        user: { sub: 'admin' },
      },
    );
    expect(serviceMock.submitScan).toHaveBeenCalledWith(
      'u1',
      [f],
      ['front'],
      true,
      expect.objectContaining({
        actorId: 'admin',
        skipConsent: true,
        minImages: 1,
        source: 'admin_upload',
      }),
    );
    expect(r.success).toBe(true);
    expect(r.message).toBe('Face portrait enrolled');
    expect(r.data).toMatchObject({ faceProfileId: 'fp-1', status: 'active' });
  });

  it('nhiều góc qua field `files` + poses', async () => {
    serviceMock.submitScan.mockResolvedValue({
      faceProfileId: 'fp-2',
      biometricReviewStatus: 'pending_review',
    });
    const r = await controller.enroll(
      'u1',
      [file('files'), file('files')],
      { poses: 'front,left' },
      { user: { userId: 'admin' } },
    );
    expect(serviceMock.submitScan.mock.calls[0][2]).toEqual(['front', 'left']);
    expect(r.data.status).toBe('pending_review');
  });

  it('service ném 400 → propagate', async () => {
    serviceMock.submitScan.mockRejectedValue(new BadRequestException());
    await expect(
      controller.enroll('u1', undefined, {}, { user: {} }),
    ).rejects.toThrow(BadRequestException);
  });
});
