/**
 * security-alert-report-data.service.spec.ts
 *
 * Unit tests cho SecurityAlertReportDataService (UC-129 T316-T318).
 * ⚠️ CRITICAL: zone soft-deleted → 'Toàn khuôn viên', KHÔNG lộ tên zone cũ.
 * zoneId=null → 'Toàn khuôn viên'.
 * status='new' → acknowledgedByName/resolvedByName đều null.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SecurityAlertReportDataService } from '../services/security-alert-report-data.service.js';
import { SecurityAlertEntity } from '../../alerts/entities/security-alert.entity.js';

describe('SecurityAlertReportDataService', () => {
  let service: SecurityAlertReportDataService;

  const mockQb = {
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };

  const mockRepo = {
    createQueryBuilder: jest.fn().mockReturnValue(mockQb),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockQb.leftJoinAndSelect.mockReturnThis();
    mockQb.where.mockReturnThis();
    mockQb.andWhere.mockReturnThis();
    mockQb.orderBy.mockReturnThis();
    mockQb.getMany.mockResolvedValue([]);
    mockRepo.createQueryBuilder.mockReturnValue(mockQb);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecurityAlertReportDataService,
        {
          provide: getRepositoryToken(SecurityAlertEntity),
          useValue: mockRepo,
        },
      ],
    }).compile();

    service = module.get<SecurityAlertReportDataService>(
      SecurityAlertReportDataService,
    );
  });

  describe('listAllForExport', () => {
    const baseParams = {
      from: '2026-07-01',
      to: '2026-07-31',
      filters: { alertType: null, zoneId: null, status: null },
    };

    it('joins zone + acknowledgedByUser + resolvedByUser, no pagination', async () => {
      await service.listAllForExport(baseParams);

      expect(mockQb.leftJoinAndSelect).toHaveBeenCalledWith('sa.zone', 'zone');
      expect(mockQb.leftJoinAndSelect).toHaveBeenCalledWith(
        'sa.acknowledgedByUser',
        'ack',
      );
      expect(mockQb.leftJoinAndSelect).toHaveBeenCalledWith(
        'sa.resolvedByUser',
        'res',
      );
      expect(mockQb.where).toHaveBeenCalledWith(
        'sa.triggeredAt BETWEEN :from AND :to',
        { from: baseParams.from, to: baseParams.to },
      );
    });

    it('applies filters only when provided', async () => {
      await service.listAllForExport({
        ...baseParams,
        filters: { alertType: 'intrusion', zoneId: 'zone-1', status: 'new' },
      });

      expect(mockQb.andWhere).toHaveBeenCalledWith(
        'sa.alertType IN (:...alertType)',
        {
          alertType: ['intrusion'],
        },
      );
      expect(mockQb.andWhere).toHaveBeenCalledWith('sa.zoneId IN (:...zoneId)', {
        zoneId: ['zone-1'],
      });
      expect(mockQb.andWhere).toHaveBeenCalledWith('sa.status IN (:...status)', {
        status: ['new'],
      });
    });

    it('does not call andWhere when no filters provided', async () => {
      await service.listAllForExport(baseParams);
      expect(mockQb.andWhere).not.toHaveBeenCalled();
    });
  });

  describe('mapToExportRow — §0.4 spec, ⚠️ CRITICAL soft-delete handling', () => {
    it('zoneId=null → "Toàn khuôn viên"', () => {
      const alert = makeAlert({ zone: null });
      const row = service.mapToExportRow(alert);
      expect(row.zoneName).toBe('Toàn khuôn viên');
    });

    it('zone soft-deleted → "Toàn khuôn viên", NOT the deleted zone name', () => {
      const alert = makeAlert({
        zone: { zoneName: 'Cổng chính (đã xóa)', deletedAt: new Date() } as any,
      });
      const row = service.mapToExportRow(alert);
      expect(row.zoneName).toBe('Toàn khuôn viên');
      expect(row.zoneName).not.toContain('Cổng chính');
    });

    it('zone alive → shows real zone name', () => {
      const alert = makeAlert({
        zone: { zoneName: 'Cổng chính', deletedAt: null } as any,
      });
      const row = service.mapToExportRow(alert);
      expect(row.zoneName).toBe('Cổng chính');
    });

    it('status=new → acknowledgedByName/resolvedByName both null', () => {
      const alert = makeAlert({
        status: 'new',
        acknowledgedByUser: null,
        resolvedByUser: null,
      });
      const row = service.mapToExportRow(alert);
      expect(row.acknowledgedByName).toBeNull();
      expect(row.resolvedByName).toBeNull();
    });

    it('status=resolved → has resolvedByName + resolutionNote', () => {
      const alert = makeAlert({
        status: 'resolved',
        resolvedByUser: { fullName: 'Nguyễn Văn B' } as any,
        resolutionNote: 'Đã xử lý xong',
      });
      const row = service.mapToExportRow(alert);
      expect(row.resolvedByName).toBe('Nguyễn Văn B');
      expect(row.resolutionNote).toBe('Đã xử lý xong');
    });
  });

  describe('getStatusCounts — §5.6 CL-1 (COUNT thuần)', () => {
    it('counts each status correctly', () => {
      const alerts = [
        makeAlert({ status: 'new' }),
        makeAlert({ status: 'new' }),
        makeAlert({ status: 'acknowledged' }),
        makeAlert({ status: 'resolved' }),
      ];
      const counts = service.getStatusCounts(alerts);
      expect(counts).toEqual({ new: 2, acknowledged: 1, resolved: 1 });
    });

    it('returns all zeros for empty array', () => {
      expect(service.getStatusCounts([])).toEqual({
        new: 0,
        acknowledged: 0,
        resolved: 0,
      });
    });
  });
});

function makeAlert(
  overrides: Partial<SecurityAlertEntity> = {},
): SecurityAlertEntity {
  return {
    id: 'alert-1',
    alertType: 'intrusion',
    severity: 'critical',
    zoneId: null,
    status: 'new',
    triggeredAt: new Date('2026-07-10T08:00:00Z'),
    lastSeenAt: null,
    occurrenceCount: 1,
    sourceEventId: null,
    ruleId: null,
    payloadJson: null,
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    zone: null,
    sourceEvent: null,
    rule: null,
    acknowledgedByUser: null,
    resolvedByUser: null,
    ...overrides,
  };
}
