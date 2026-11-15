import { ReportCenterService } from './report-center.service.js';
import { REPORT_DEFINITIONS } from './report-definition.registry.js';

describe('filters forwarded by operational export dialogs', () => {
  const service = new ReportCenterService({} as never, {} as never, { getMaxRangeDays: async () => 366 } as never, {} as never, []);
  it('accepts the exact security event type used by the security screen', async () => {
    const filters = await service.validateFilters(REPORT_DEFINITIONS['security-alert'], { from: '2026-11-01', to: '2026-11-13', alertType: 'visitor_must_leave', status: 'resolved' });
    expect(filters.alertType).toBe('visitor_must_leave');
    expect(filters.status).toBe('resolved');
  });
  it('continues to reject unrecognized event types and unrelated filters', async () => {
    await expect(service.validateFilters(REPORT_DEFINITIONS['security-alert'], { from: '2026-11-01', to: '2026-11-13', alertType: 'invalid' })).rejects.toThrow();
    await expect(service.validateFilters(REPORT_DEFINITIONS.vehicle, { from: '2026-11-01', to: '2026-11-13', cameraId: 'unsupported' })).rejects.toThrow();
  });
});
