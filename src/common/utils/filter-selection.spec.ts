import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { filterValues } from './filter-selection.js';
import { QuerySecurityAlertsDto } from '../../modules/alerts/dto/query-security-alerts.dto.js';
import { QueryAlertRulesDto } from '../../modules/alerts/dto/query-alert-rules.dto.js';
import { QueryPersonControlListDto } from '../../modules/alerts/dto/query-person-control-list.dto.js';
import { ListVehicleHistoryQueryDto } from '../../modules/anpr/dto/list-vehicle-history-query.dto.js';
import { ListIotDevicesQueryDto } from '../../modules/iot/dto/list-iot-devices-query.dto.js';
import { ManageUsersQueryDto } from '../../modules/accounts/dto/manage-users-query.dto.js';
import { QueryOnTimeRateDto } from '../../modules/analytics/dto/query-on-time-rate.dto.js';
import { QueryZoneTrafficDto as QueryRoomTrafficDto } from '../../modules/campus-dashboard/dto/query-zone-traffic.dto.js';

const ids = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
];
const cases: Array<[string, new () => object, Record<string, unknown>]> = [
  [
    'alerts',
    QuerySecurityAlertsDto,
    {
      alert_type: ['stranger', 'crowd'],
      severity: ['high', 'medium'],
      status: ['new', 'resolved'],
      zone_id: ids,
    },
  ],
  [
    'rules',
    QueryAlertRulesDto,
    {
      alert_type: ['stranger', 'crowd'],
      enabled: ['true', 'false'],
      zone_id: ids,
    },
  ],
  [
    'people',
    QueryPersonControlListDto,
    { list_type: ['watchlist', 'blocklist'], active: ['true', 'false'] },
  ],
  [
    'vehicles',
    ListVehicleHistoryQueryDto,
    {
      matchState: ['matched', 'unmatched'],
      cameraName: ['Camera A', 'Camera B'],
      zoneId: ids,
      vehicleType: ['car', 'motorbike'],
    },
  ],
  [
    'devices',
    ListIotDevicesQueryDto,
    { status: ['online', 'offline'], room_id: ids },
  ],
  [
    'users',
    ManageUsersQueryDto,
    {
      accountType: ['staff', 'student'],
      accountStatus: ['active', 'expired'],
      roleId: ids,
      departmentId: ids,
    },
  ],
  ['on-time', QueryOnTimeRateDto, { departmentId: ids }],
  [
    'traffic',
    QueryRoomTrafficDto,
    {
      building: ['A', 'B'],
      floor: ['1', '2'],
      groupId: ids,
      from: '2026-11-01',
      to: '2026-11-17',
    },
  ],
];
test.each(cases)('%s validates each selected value', async (_, DTO, query) => {
  expect(await validate(plainToInstance(DTO, query))).toEqual([]);
});
test('rejects one invalid item in an otherwise valid selection', async () => {
  const errors = await validate(
    plainToInstance(QuerySecurityAlertsDto, {
      severity: ['high', 'invalid'],
      zone_id: ids,
    }),
  );
  expect(errors.some((error) => error.property === 'severity')).toBe(true);
});
test('boolean selections preserve false and reject arbitrary text', async () => {
  const query = plainToInstance(QueryAlertRulesDto, {
    enabled: ['true', 'false'],
  });
  expect(query.enabled).toEqual([true, false]);
  expect(
    await validate(
      plainToInstance(QueryAlertRulesDto, { enabled: ['true', 'invalid'] }),
    ),
  ).not.toEqual([]);
});
test('normalizes scalars and avoids duplicate SQL parameters', () => {
  expect(filterValues('high')).toEqual(['high']);
  expect(filterValues(['high', 'high', 'low'])).toEqual(['high', 'low']);
});
