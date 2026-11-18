import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UelSyncSettingsDto } from './uel-sync-settings.dto';

describe('UelSyncSettingsDto', () => {
  it('body cũ còn gửi sessionDaysAhead không bị 400 (bỏ qua)', async () => {
    const errors = await validate(
      plainToInstance(UelSyncSettingsDto, {
        sessionDaysAhead: 14,
        time: '02:00',
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors).toHaveLength(0);
  });

  it('sessionDaysAhead không còn bị giới hạn 1..120 (vd 500 vẫn hợp lệ vì bị bỏ qua)', async () => {
    const errors = await validate(
      plainToInstance(UelSyncSettingsDto, { sessionDaysAhead: 500 }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(errors).toHaveLength(0);
  });
});
