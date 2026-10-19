import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nhắc trước họp theo từng kênh: `reminder_channels_json` = [{ channel, minutes }]
 * (channel ∈ in_app | email | message | sms, minutes 1..10080). `reminder_sent_json`
 * = { <channel>: <ISO time> } đánh dấu kênh đã gửi, reset khi đổi giờ họp.
 * Thay cho reminder_minutes / reminder_sent_at (một kênh, một mốc).
 */
export class MeetingReminderChannels20261019000009 implements MigrationInterface {
  name = 'MeetingReminderChannels20261019000009';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_channels_json jsonb NOT NULL
        DEFAULT '[{"channel":"in_app","minutes":10}]'::jsonb;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_sent_json jsonb NOT NULL DEFAULT '{}'::jsonb;
      UPDATE meetings SET
        reminder_channels_json = CASE WHEN reminder_minutes > 0
          THEN jsonb_build_array(jsonb_build_object('channel', 'in_app', 'minutes', reminder_minutes))
          ELSE '[]'::jsonb END,
        reminder_sent_json = CASE WHEN reminder_sent_at IS NOT NULL
          THEN jsonb_build_object('in_app', reminder_sent_at) ELSE '{}'::jsonb END;
      ALTER TABLE meetings DROP CONSTRAINT IF EXISTS chk_meetings_reminder_minutes;
      ALTER TABLE meetings DROP COLUMN IF EXISTS reminder_sent_at;
      ALTER TABLE meetings DROP COLUMN IF EXISTS reminder_minutes;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_minutes smallint NOT NULL DEFAULT 10;
      ALTER TABLE meetings ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz NULL;
      UPDATE meetings m SET
        reminder_minutes = COALESCE((SELECT (c->>'minutes')::int FROM jsonb_array_elements(m.reminder_channels_json) c
                                      WHERE c->>'channel' = 'in_app' AND (c->>'minutes')::int IN (5,10,15,30,60) LIMIT 1), 0),
        reminder_sent_at = (m.reminder_sent_json->>'in_app')::timestamptz;
      ALTER TABLE meetings ADD CONSTRAINT chk_meetings_reminder_minutes
        CHECK (reminder_minutes IN (0, 5, 10, 15, 30, 60));
      ALTER TABLE meetings DROP COLUMN IF EXISTS reminder_sent_json;
      ALTER TABLE meetings DROP COLUMN IF EXISTS reminder_channels_json;
    `);
  }
}
