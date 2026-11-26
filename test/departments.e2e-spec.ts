import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { useContainer } from 'class-validator';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module.js';
import { bearerFor } from './support/e2e-auth';

/**
 * E2E POST /api/v1/departments qua AppModule + DB thật (RUN_DB_TESTS=1).
 * Cần dữ liệu demo: bizadmin.hr (BUSINESS_ADMIN, có department.create), emp.hr1 (không có quyền).
 * Mã trạng thái theo spec/features/account/feat-create-department (spec.md, contracts/departments-api.md).
 */
const describeDb = process.env.RUN_DB_TESTS === '1' ? describe : describe.skip;
const CODES = ['E2E_IT', 'E2E_DUP_TEST'];

describeDb('POST /api/v1/departments (e2e)', () => {
  let app: INestApplication;
  let admin: string;
  let noPermission: string;

  const cleanup = () =>
    app.get(DataSource).query(`DELETE FROM departments WHERE department_code = ANY($1)`, [CODES]);

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Như main.ts: validator tùy biến (IsDepartmentCodeUniqueConstraint) cần DI của Nest.
    useContainer(app.select(AppModule), { fallbackOnErrors: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
    await app.init();
    admin = await bearerFor(app, 'bizadmin.hr');
    noPermission = await bearerFor(app, 'emp.hr1');
    await cleanup();
  });

  afterAll(async () => {
    await cleanup();
    await app.close();
  });

  const validPayload = {
    departmentCode: 'E2E_IT',
    departmentName: 'E2E Phòng Công nghệ thông tin',
  };

  describe('[AC-001] Happy path', () => {
    it('should create department and return 201', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', admin)
        .send(validPayload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.departmentCode).toBe('E2E_IT');
      expect(res.body.data.isActive).toBe(true);
      expect(res.body.data.createdAt).toBeDefined();
      expect(res.body.data.updatedAt).toBeDefined();
    });
  });

  describe('[AC-004→005] Validation errors', () => {
    it('should return 400 when departmentCode is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', admin)
        .send({ departmentName: 'Test' })
        .expect(400);
    });

    it('should return 400 when departmentName is missing', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', admin)
        .send({ departmentCode: 'E2E_NONAME' })
        .expect(400);
    });
  });

  describe('[AC-006] Format validation', () => {
    it('should return 422 for departmentCode with spaces', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', admin)
        .send({ departmentCode: 'INVALID CODE', departmentName: 'Test' })
        .expect(422);
    });
  });

  describe('[AC-012→013] Authorization', () => {
    it('should return 401 without token', async () => {
      await request(app.getHttpServer()).post('/api/v1/departments').send(validPayload).expect(401);
    });

    it('should return 403 without permission department.create', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', noPermission)
        .send({ departmentCode: 'E2E_NOPERM', departmentName: 'Không có quyền' })
        .expect(403);
    });
  });

  describe('[AC-014→015] Duplicate handling', () => {
    it('should return 409 for duplicate departmentCode', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', admin)
        .send({ departmentCode: 'E2E_DUP_TEST', departmentName: 'Duplicate Test' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/departments')
        .set('Authorization', admin)
        .send({ departmentCode: 'E2E_DUP_TEST', departmentName: 'Another Name' })
        .expect(409);
    });
  });
});
