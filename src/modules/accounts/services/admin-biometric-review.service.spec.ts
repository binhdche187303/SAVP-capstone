import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AdminBiometricReviewService } from './admin-biometric-review.service.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import { StorageService } from '../../storage/storage.service.js';

describe('AdminBiometricReviewService', () => {
  let service: AdminBiometricReviewService;
  let faceProfileRepo: Repository<FaceProfileEntity>;
  let dataSource: DataSource;

  const mockQueryBuilder = {
    innerJoin: jest.fn().mockReturnThis(),
    leftJoin: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    getManyAndCount: jest.fn(),
  };

  const mockRepository = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    findOne: jest.fn(),
    update: jest.fn(),
  };

  const mockDataSource = {
    manager: {
      query: jest.fn().mockResolvedValue([]),
      insert: jest.fn(),
    },
    transaction: jest.fn(),
  };

  const mockStorageService = {
    generateSignedDownloadToken: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminBiometricReviewService,
        {
          provide: getRepositoryToken(FaceProfileEntity),
          useValue: mockRepository,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
        {
          provide: StorageService,
          useValue: mockStorageService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<AdminBiometricReviewService>(
      AdminBiometricReviewService,
    );
    faceProfileRepo = module.get<Repository<FaceProfileEntity>>(
      getRepositoryToken(FaceProfileEntity),
    );
    dataSource = module.get<DataSource>(DataSource);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── Approve: đánh dấu lại kho chân dung thường trực ────────────────────────
  describe('approveBiometricSubmission — kho chân dung thường trực', () => {
    const USER_ID = 'user-1';
    const FP_ID = 'fp-new';

    /** Dựng manager giả cho transaction approve. `qbResults` trả lần lượt theo thứ tự gọi. */
    const wireTx = (over: { oldActive?: unknown[] } = {}) => {
      const qbResults: unknown[][] = [
        // 1) lock face_profile đang duyệt
        [
          {
            id: FP_ID,
            userId: USER_ID,
            status: FaceProfileStatus.PENDING_REVIEW,
            primaryImageFileId: 'media-1',
          },
        ],
        // 2) lock user
        [{ id: USER_ID, accountStatus: 'active', deletedAt: null }],
        // 3) các face_profile ACTIVE cũ
        over.oldActive ?? [],
      ];
      let qbCall = 0;
      const qb = {
        setLock: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn(() => Promise.resolve(qbResults[qbCall++] ?? [])),
      };

      const queries: Array<{ sql: string; params: unknown[] }> = [];
      const manager = {
        createQueryBuilder: jest.fn(() => qb),
        update: jest.fn().mockResolvedValue(undefined),
        insert: jest.fn().mockResolvedValue(undefined),
        query: jest.fn((sql: string, params: unknown[]) => {
          queries.push({ sql, params });
          if (sql.includes('FROM media_files'))
            return Promise.resolve([{ id: 'media-1' }]);
          if (sql.includes('UPDATE device_user_mappings'))
            return Promise.resolve([{ id: 'map-portrait-1' }]);
          return Promise.resolve([]);
        }),
      };

      mockDataSource.transaction.mockImplementation(
        (cb: (m: unknown) => unknown) => cb(manager),
      );
      return { manager, queries };
    };

    const portraitSqlOf = (
      queries: Array<{ sql: string; params: unknown[] }>,
    ) => queries.find((q) => q.sql.includes('UPDATE device_user_mappings'));

    it('hạ mapping kho thường trực về pending để reconcile đẩy lại ảnh mới', async () => {
      const { queries } = wireTx();

      await service.approveBiometricSubmission(FP_ID, 'admin-1');

      const q = portraitSqlOf(queries);
      expect(q).toBeDefined();
      expect(q!.sql).toContain("sync_status = 'pending'");
      expect(q!.params).toEqual([USER_ID, 'portrait']);
    });

    it('lọc ĐÚNG kho thường trực qua metadata_json, KHÔNG phải cột `source`', async () => {
      const { queries } = wireTx();
      await service.approveBiometricSubmission(FP_ID, 'admin-1');

      const q = portraitSqlOf(queries)!;
      // `device_user_mappings` không có cột `source` — phải đọc trong metadata_json.
      expect(q.sql).toContain("metadata_json->>'source' = $2");
      expect(q.sql).not.toMatch(/\bAND\s+source\s*=/);
      // Chỉ động vào mapping còn sống của ĐÚNG user đó.
      expect(q.sql).toContain('user_id = $1');
      expect(q.sql).toContain('deleted_at IS NULL');
    });

    it('KHÔNG soft-delete — nếu xoá mềm thì bước dọn ảnh cũ trên IVSS sẽ mù', async () => {
      const { queries } = wireTx();
      await service.approveBiometricSubmission(FP_ID, 'admin-1');

      const q = portraitSqlOf(queries)!;
      // `enrollPortrait` dọn person cũ bằng điều kiện `deleted_at IS NULL`; soft-delete
      // làm bước đó không thấy mapping ⇒ ảnh cũ ở lại thiết bị + trùng szUID.
      expect(q.sql).not.toMatch(/SET[\s\S]*deleted_at\s*=\s*now\(\)/);
    });

    it('KHÔNG đụng mapping theo cuộc họp (2 luồng đó tự cứu bằng deprovision)', async () => {
      const { queries } = wireTx();
      await service.approveBiometricSubmission(FP_ID, 'admin-1');

      const q = portraitSqlOf(queries)!;
      expect(q.params).not.toContain('ivss');
      // Không có câu nào đụng mapping mà bỏ lọc source.
      const loose = queries.filter(
        (x) =>
          x.sql.includes('device_user_mappings') &&
          !x.sql.includes("metadata_json->>'source'"),
      );
      expect(loose).toEqual([]);
    });

    it('nằm TRONG transaction approve → approve rollback thì reset cũng rollback', async () => {
      const { manager, queries } = wireTx();
      await service.approveBiometricSubmission(FP_ID, 'admin-1');

      // Câu SQL chạy bằng `manager` của transaction, không phải dataSource.manager toàn cục.
      expect(manager.query).toHaveBeenCalled();
      expect(portraitSqlOf(queries)).toBeDefined();
      expect(
        mockDataSource.manager.query.mock.calls.filter(
          (c: unknown[]) =>
            typeof c[0] === 'string' &&
            c[0].includes('UPDATE device_user_mappings'),
        ),
      ).toEqual([]);
    });

    it('ghi số mapping đã đánh dấu vào audit log', async () => {
      const { manager } = wireTx();
      await service.approveBiometricSubmission(FP_ID, 'admin-1');

      const audit = manager.insert.mock.calls[0][1] as {
        newValueJson: { portraitMappingsReset: number };
      };
      expect(audit.newValueJson.portraitMappingsReset).toBe(1);
    });

    it('vẫn revoke ACTIVE cũ và set ACTIVE mới (hành vi cũ không đổi)', async () => {
      const { manager } = wireTx({ oldActive: [{ id: 'fp-old' }] });
      const r = await service.approveBiometricSubmission(FP_ID, 'admin-1');

      expect(manager.update).toHaveBeenCalledWith(
        FaceProfileEntity,
        'fp-old',
        expect.objectContaining({ status: FaceProfileStatus.REVOKED }),
      );
      expect(manager.update).toHaveBeenCalledWith(
        FaceProfileEntity,
        FP_ID,
        expect.objectContaining({ status: FaceProfileStatus.ACTIVE }),
      );
      expect(r.status).toBe(FaceProfileStatus.ACTIVE);
    });
  });

  describe('listBiometricSubmissions', () => {
    it('should query biometric submissions and return correctly formatted data', async () => {
      const mockItems = [
        {
          id: 'fp-1',
          userId: 'user-1',
          status: FaceProfileStatus.PENDING_REVIEW,
          enrolledAt: new Date('2026-06-24T12:00:00Z'),
          primaryImageFileId: 'media-1',
          qualityScore: 95.5,
          user: {
            id: 'user-1',
            fullName: 'Nguyen Van A',
            email: 'a.nguyen@example.com',
            employeeCode: 'EMP001',
            avatarUrl: 'https://cdn.example.com/avatars/user-1.png',
            department: {
              id: 'dept-1',
              departmentName: 'Software Engineering',
            },
          },
        },
      ];

      mockQueryBuilder.getManyAndCount.mockResolvedValue([mockItems, 1]);

      const query = {
        page: 1,
        limit: 10,
        status: 'pending_review',
        sortBy: 'submittedAt',
        sortOrder: 'desc' as const,
      };

      const result = await service.listBiometricSubmissions(query);

      expect(mockRepository.createQueryBuilder).toHaveBeenCalledWith('fp');
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual({
        classSections: [], roleCode: null, roleName: null, consentAt: undefined,
        faceProfileId: 'fp-1',
        userId: 'user-1',
        fullName: 'Nguyen Van A',
        email: 'a.nguyen@example.com',
        employeeCode: 'EMP001',
        avatarUrl: 'https://cdn.example.com/avatars/user-1.png',
        departmentName: 'Software Engineering',
        status: FaceProfileStatus.PENDING_REVIEW,
        submittedAt: mockItems[0].enrolledAt,
        primaryImageFileId: 'media-1',
        qualityScore: 95.5,
      });
      expect(result.meta).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1,
      });
    });

    // [FIX 2026-08-11] avatarUrl — CHỈ nhận diện "đây là ai", KHÔNG liên quan
    // primaryImageFileId (D2 vẫn giữ nguyên tách biệt).
    describe('avatarUrl (nhận diện người, tách biệt primaryImageFileId — D2)', () => {
      const baseItem = (overUser: Record<string, unknown> = {}) => [
        {
          id: 'fp-1',
          userId: 'user-1',
          status: FaceProfileStatus.PENDING_REVIEW,
          enrolledAt: new Date('2026-06-24T12:00:00Z'),
          primaryImageFileId: 'media-1',
          qualityScore: 95.5,
          user: {
            id: 'user-1',
            fullName: 'Nguyen Van A',
            email: 'a.nguyen@example.com',
            employeeCode: 'EMP001',
            avatarUrl: 'https://cdn.example.com/avatars/user-1.png',
            department: {
              id: 'dept-1',
              departmentName: 'Software Engineering',
            },
            ...overUser,
          },
        },
      ];

      it('user có avatarUrl → trả đúng giá trị', async () => {
        mockQueryBuilder.getManyAndCount.mockResolvedValue([baseItem(), 1]);
        const result = await service.listBiometricSubmissions({
          page: 1,
          limit: 10,
        });
        expect(result.data[0].avatarUrl).toBe(
          'https://cdn.example.com/avatars/user-1.png',
        );
      });

      it('user chưa từng có avatarUrl (null) → trả null, không lỗi', async () => {
        mockQueryBuilder.getManyAndCount.mockResolvedValue([
          baseItem({ avatarUrl: null }),
          1,
        ]);
        const result = await service.listBiometricSubmissions({
          page: 1,
          limit: 10,
        });
        expect(result.data[0].avatarUrl).toBeNull();
      });

      it("SELECT thêm 'u.avatarUrl' — u đã JOIN sẵn, KHÔNG JOIN mới", async () => {
        mockQueryBuilder.getManyAndCount.mockResolvedValue([baseItem(), 1]);
        await service.listBiometricSubmissions({ page: 1, limit: 10 });
        expect(mockQueryBuilder.select).toHaveBeenCalledWith(
          expect.arrayContaining(['u.avatarUrl']),
        );
        // Chỉ 1 innerJoin (fp.user→u) + 1 leftJoin (u.department→d) như trước — không JOIN mới.
        expect(mockQueryBuilder.innerJoin).toHaveBeenCalledTimes(1);
      });
    });
  });

  // [FIX 2026-08-11] avatarUrl ở detail — mirror cách lấy ở list(), cùng nguồn dữ liệu
  // (users.avatar_url), KHÔNG đụng logic approve()/reject() (D2).
  describe('getBiometricSubmissionDetail — avatarUrl', () => {
    const FP_ID = 'fp-1';

    const wireFindOne = (userOver: Record<string, unknown> = {}) => {
      mockRepository.findOne.mockResolvedValue({
        id: FP_ID,
        userId: 'user-1',
        status: FaceProfileStatus.PENDING_REVIEW,
        primaryImageFileId: null,
        enrolledAt: new Date('2026-06-24T12:00:00Z'),
        consentAt: new Date('2026-06-24T11:00:00Z'),
        metadataJson: null,
        user: {
          id: 'user-1',
          fullName: 'Nguyen Van A',
          email: 'a.nguyen@example.com',
          avatarUrl: 'https://cdn.example.com/avatars/user-1.png',
          ...userOver,
        },
      });
    };

    it('user có avatarUrl → trả đúng giá trị', async () => {
      wireFindOne();
      const r = await service.getBiometricSubmissionDetail(FP_ID);
      expect(r.avatarUrl).toBe('https://cdn.example.com/avatars/user-1.png');
    });

    it('user chưa từng có avatarUrl (null) → trả null, không lỗi', async () => {
      wireFindOne({ avatarUrl: null });
      const r = await service.getBiometricSubmissionDetail(FP_ID);
      expect(r.avatarUrl).toBeNull();
    });

    it('list và detail cùng nguồn dữ liệu (users.avatar_url) → cùng giá trị cho cùng user', async () => {
      const AVATAR = 'https://cdn.example.com/avatars/user-1.png';
      wireFindOne({ avatarUrl: AVATAR });
      const detail = await service.getBiometricSubmissionDetail(FP_ID);

      mockQueryBuilder.getManyAndCount.mockResolvedValue([
        [
          {
            id: FP_ID,
            userId: 'user-1',
            status: FaceProfileStatus.PENDING_REVIEW,
            enrolledAt: new Date('2026-06-24T12:00:00Z'),
            primaryImageFileId: null,
            qualityScore: null,
            user: {
              id: 'user-1',
              fullName: 'Nguyen Van A',
              email: 'a.nguyen@example.com',
              employeeCode: 'EMP001',
              avatarUrl: AVATAR,
              department: null,
            },
          },
        ],
        1,
      ]);
      const list = await service.listBiometricSubmissions({
        page: 1,
        limit: 10,
      });

      expect(detail.avatarUrl).toBe(AVATAR);
      expect(list.data[0].avatarUrl).toBe(AVATAR);
    });
  });
});
