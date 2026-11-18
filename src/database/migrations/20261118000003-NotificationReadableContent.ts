import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Thông báo — nội dung cho người đọc + mức ưu tiên xe lạ.
 *
 * Từ nay BE ghi "Biển số X được ghi nhận tại <khu vực> (đi vào)." và "Camera Cổng 2 hướng vào …"
 * (không lộ channel/direction/mã thiết bị). Dọn các thông báo cũ cho đồng nhất:
 * - Xe: bỏ "(channel N, direction X)", "Loại: blocklist" → "Danh sách: chặn".
 * - Xe lạ thông thường → priority 'low' (chỉ gom nhóm, không đếm trên chuông).
 * - Camera mất kết nối: bỏ mã thiết bị trong ngoặc sau tên camera.
 */
export class NotificationReadableContent20261118000003 implements MigrationInterface {
  name = 'NotificationReadableContent20261118000003';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE notifications
         SET content = replace(replace(
               regexp_replace(content, ' vừa qua cổng \\(channel [^)]*\\)\\.', ' được ghi nhận tại cổng.'),
               'Loại: blocklist.', 'Danh sách: chặn.'),
               'Loại: watchlist.', 'Danh sách: theo dõi.')
       WHERE notification_type IN ('unknown_vehicle_alert', 'vehicle_unauthorized_alert', 'vehicle_control_list_match')
         AND content ~ '\\(channel '
    `);
    await q.query(`
      UPDATE notifications SET priority = 'low'
       WHERE notification_type = 'unknown_vehicle_alert' AND priority = 'normal'
    `);
    await q.query(`
      UPDATE notifications
         SET content = regexp_replace(content, ' \\([A-Z0-9][A-Z0-9_-]+\\)', '', 'g')
       WHERE notification_type = 'device_offline_alert'
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Nội dung cũ không khôi phục được (chỉ là cách diễn đạt); trả lại mức ưu tiên.
    await q.query(`
      UPDATE notifications SET priority = 'normal'
       WHERE notification_type = 'unknown_vehicle_alert' AND priority = 'low'
    `);
  }
}
