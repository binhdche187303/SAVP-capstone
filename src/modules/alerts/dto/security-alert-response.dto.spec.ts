import { SecurityAlertEntity } from '../entities/security-alert.entity.js';
import { toSecurityAlertResponse } from './security-alert-response.dto.js';

describe('Security alert actor names', () => {
  it('returns account names without exposing the related user objects', () => {
    const entity = {
      acknowledgedBy: 'receiver-id',
      resolvedBy: 'resolver-id',
      acknowledgedByUser: { fullName: 'Nguyễn Văn A', passwordHash: 'private' },
      resolvedByUser: { fullName: 'Trần Văn B', passwordHash: 'private' },
    } as unknown as SecurityAlertEntity;
    const response = toSecurityAlertResponse(entity);
    expect(response).toMatchObject({
      acknowledged_by: 'receiver-id',
      acknowledged_by_name: 'Nguyễn Văn A',
      resolved_by: 'resolver-id',
      resolved_by_name: 'Trần Văn B',
    });
    expect(response).not.toHaveProperty('acknowledgedByUser');
    expect(response).not.toHaveProperty('resolvedByUser');
    expect(JSON.stringify(response)).not.toContain('private');
  });

  it('returns null names when the related account is unavailable', () => {
    const response = toSecurityAlertResponse({
      acknowledgedBy: 'missing-account',
      acknowledgedByUser: null,
      resolvedByUser: null,
    } as SecurityAlertEntity);
    expect(response.acknowledged_by_name).toBeNull();
    expect(response.resolved_by_name).toBeNull();
  });
});
