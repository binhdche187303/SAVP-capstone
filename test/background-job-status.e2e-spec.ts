import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { bearerFor, userIdOf } from './support/e2e-auth';

/**
 * E2E GET /api/v1/background-jobs/:id (T007 — poll trạng thái job), chạy qua AppModule + DB thật.
 * Cần DB đã migrate + seed demo (sysadmin, emp.hr1, teacher.demo) và Redis: RUN_DB_TESTS=1.
 * Owner = emp.hr1 (người tạo job), người lạ = teacher.demo, admin = sysadmin.
 */
const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;

describeDb('GET /api/v1/background-jobs/:id (e2e)', () => {
  let app: INestApplication;
  let jobId: string;
  let owner: string;
  let stranger: string;
  let admin: string;
  const A_RANDOM_UUID = '11111111-1111-1111-1111-111111111111';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();

    owner = await bearerFor(app, 'emp.hr1');
    stranger = await bearerFor(app, 'teacher.demo');
    admin = await bearerFor(app, 'sysadmin');
    const ownerId = await userIdOf(app, 'emp.hr1');
    jobId = (
      await app.get(DataSource).query(
        `INSERT INTO background_jobs (job_type, requested_by, status, priority, retry_count, input_json)
         VALUES ('e2e_poll_test', $1, 'queued', 0, 0, '{"secret":"x"}') RETURNING id`,
        [ownerId],
      )
    )[0].id;
  });

  afterAll(async () => {
    if (jobId) await app.get(DataSource).query(`DELETE FROM background_jobs WHERE id = $1`, [jobId]);
    await app.close();
  });

  describe('Authorization', () => {
    it('401 khi không có token', async () => {
      await request(app.getHttpServer()).get(`/api/v1/background-jobs/${jobId}`).expect(401);
    });

    it('403 khi user không phải owner và không phải admin', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/background-jobs/${jobId}`)
        .set('Authorization', stranger)
        .expect(403);
    });

    it('200 khi admin xem job của người khác', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/background-jobs/${jobId}`)
        .set('Authorization', admin)
        .expect(200);
    });
  });

  describe('Happy path / errors', () => {
    it('400 khi id không phải UUID hợp lệ (ParseUUIDPipe)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/background-jobs/not-a-uuid')
        .set('Authorization', owner)
        .expect(400);
    });

    it('404 khi job không tồn tại', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/background-jobs/${A_RANDOM_UUID}`)
        .set('Authorization', owner)
        .expect(404);
    });

    it('200 + status field khi owner poll job của mình', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/background-jobs/${jobId}`)
        .set('Authorization', owner)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.jobId).toBe(jobId);
      expect(res.body.data.status).toBe('queued');
      // Không leak field nội bộ
      expect(res.body.data.requestedBy).toBeUndefined();
      expect(res.body.data.inputJson).toBeUndefined();
    });
  });
});
