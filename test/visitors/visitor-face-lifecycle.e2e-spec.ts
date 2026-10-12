// VIS-BE-001 Task 9 — vòng đời hồ sơ khuôn mặt của khách trên kho thường trực IVSS.
import { AppDataSource } from '../../src/database/data-source';
import { FaceProfileEntity } from '../../src/modules/accounts/entities/face-profile.entity';
import { FaceProfileService } from '../../src/modules/accounts/services/face-profile.service';
import { VisitorFaceLifecycleService } from '../../src/modules/visitors/services/visitor-face-lifecycle.service';
import { cleanupVisitFixture, seedVisitFixture, VisitFixture } from './fixtures';

const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDb('VIS-BE-001 face lifecycle', () => {
  let fx: VisitFixture;
  let faceProfiles: FaceProfileService;
  let lifecycle: VisitorFaceLifecycleService;
  const deleted: string[] = [];

  const visitorOf = async (visitKey: string) => (await AppDataSource.query(
    `SELECT vis.id AS visitor_id, vis.user_id FROM visitor_visits v JOIN visitors vis ON vis.id = v.visitor_id WHERE v.id = $1`, [fx.ids[visitKey]]))[0];
  const profile = async (userId: string, status: string) => {
    const photo = (await AppDataSource.query(`SELECT photo_file_id FROM visitor_visits WHERE visitor_id = (SELECT id FROM visitors WHERE user_id = $1) LIMIT 1`, [userId]))[0]?.photo_file_id;
    await AppDataSource.query(`DELETE FROM face_profiles WHERE user_id = $1`, [userId]);
    await AppDataSource.query(
      `INSERT INTO face_profiles (user_id, profile_code, status, primary_image_file_id, sample_count) VALUES ($1,$2,$3,$4,1)`,
      [userId, `FP-${userId.slice(0, 8)}`, status, photo],
    );
  };
  const statusOf = async (userId: string) => (await AppDataSource.query(`SELECT status FROM face_profiles WHERE user_id = $1 AND deleted_at IS NULL`, [userId]))[0]?.status;

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations({ transaction: 'each' });
    fx = await seedVisitFixture(AppDataSource);
    faceProfiles = Object.create(FaceProfileService.prototype) as FaceProfileService;
    Object.assign(faceProfiles, {
      dataSource: AppDataSource,
      faceProfileRepo: AppDataSource.getRepository(FaceProfileEntity),
      storageService: { deleteFile: async (key: string) => { deleted.push(key); } },
      logger: { warn: () => undefined, log: () => undefined },
    });
    lifecycle = new VisitorFaceLifecycleService(AppDataSource, faceProfiles);
  });
  afterAll(async () => {
    await AppDataSource.query(`DELETE FROM face_profiles WHERE user_id IN (SELECT user_id FROM visitors WHERE full_name LIKE 'fa11ed00%')`);
    await cleanupVisitFixture(AppDataSource);
    await AppDataSource.destroy();
  });

  it('lượt đã duyệt có ảnh → hồ sơ active', async () => {
    const v = await visitorOf('approved');
    await profile(v.user_id, 'pending_review');
    expect(await lifecycle.sync(v.visitor_id)).toBe('active');
    expect(await statusOf(v.user_id)).toBe('active');
  });

  it('khách đang ở trong và khách phải rời vẫn giữ active (camera còn thấy)', async () => {
    for (const key of ['insideOk', 'mustLeave']) {
      const v = await visitorOf(key);
      await profile(v.user_id, 'pending_review');
      expect(await lifecycle.sync(v.visitor_id)).toBe('active');
    }
  });

  it('không còn lượt nào giữ quyền → hồ sơ đang active chuyển revoked', async () => {
    const v = await visitorOf('out');
    await profile(v.user_id, 'active');
    expect(await lifecycle.sync(v.visitor_id)).toBe('revoked');
    expect(await statusOf(v.user_id)).toBe('revoked');
  });

  it('hồ sơ chưa duyệt và không có lượt hợp lệ → none, không đổi', async () => {
    const v = await visitorOf('pending');
    await profile(v.user_id, 'pending_review');
    expect(await lifecycle.sync(v.visitor_id)).toBe('none');
    expect(await statusOf(v.user_id)).toBe('pending_review');
  });

  it('khách có hai lượt, một đã đóng một còn duyệt → vẫn active', async () => {
    const v = await visitorOf('old1'); // khách lặp: hai lượt đã rời
    await profile(v.user_id, 'active');
    expect(await lifecycle.sync(v.visitor_id)).toBe('revoked');
    await AppDataSource.query(`UPDATE visitor_visits SET status = 'approved', check_out_at = NULL WHERE id = $1`, [fx.ids.old2]);
    await profile(v.user_id, 'revoked');
    expect(await lifecycle.sync(v.visitor_id)).toBe('active');
  });

  it('khách chưa có hồ sơ khuôn mặt → none, không ném', async () => {
    const v = await visitorOf('rejected');
    await AppDataSource.query(`DELETE FROM face_profiles WHERE user_id = $1`, [v.user_id]);
    await expect(lifecycle.sync(v.visitor_id)).resolves.toBe('none');
  });

  it('syncVisit đi từ id lượt tới khách; id lạ không ném', async () => {
    const v = await visitorOf('approvedNoPhoto');
    await AppDataSource.query(`DELETE FROM face_profiles WHERE user_id = $1`, [v.user_id]);
    await expect(lifecycle.syncVisit(fx.ids.approvedNoPhoto)).resolves.toBeUndefined();
    await expect(lifecycle.syncVisit('00000000-0000-0000-0000-000000000000')).resolves.toBeUndefined();
  });

  it('setProfileStatus từ chối trạng thái không hợp lệ', async () => {
    await expect(faceProfiles.setProfileStatus('00000000-0000-0000-0000-000000000000', 'pending_review' as never, null)).rejects.toThrow();
  });

  it('deletePortrait: xóa mềm hồ sơ, vô hiệu media, xóa file; lịch sử lượt vẫn còn', async () => {
    const v = await visitorOf('cancelled');
    await profile(v.user_id, 'revoked');
    const media = (await AppDataSource.query(`SELECT photo_file_id FROM visitor_visits WHERE id = $1`, [fx.ids.cancelled]))[0].photo_file_id;
    await AppDataSource.query(`UPDATE media_files SET related_entity_type = 'face_profile', related_entity_id = $2 WHERE id = $1`, [media, v.user_id]);
    expect(await faceProfiles.deletePortrait(v.user_id)).toEqual({ deleted: true });
    expect(await statusOf(v.user_id)).toBeUndefined();
    expect((await AppDataSource.query(`SELECT is_active FROM media_files WHERE id = $1`, [media]))[0].is_active).toBe(false);
    expect(deleted.length).toBeGreaterThan(0);
    expect((await AppDataSource.query(`SELECT 1 FROM visitor_visits WHERE id = $1`, [fx.ids.cancelled])).length).toBe(1);
    expect(await faceProfiles.deletePortrait(v.user_id)).toEqual({ deleted: false });
  });
});
