import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { UserEntity } from '../../accounts/entities/user.entity.js';
import { FaceProfileEntity } from '../../accounts/entities/face-profile.entity.js';
import { MediaFileEntity } from '../../recording/entities/media-file.entity.js';

/**
 * PersonControlListEntity (SAVP Security Alert Center scope — UC-125 Danh sách kiểm
 * soát người / Watchlist).
 *
 * Schema-only: KHÔNG logic nghiệp vụ (CRUD, đối chiếu khi nhận diện = UC-125 sau).
 * Mirror `VehicleControlListEntity` (xe) nhưng cho NGƯỜI — độc lập danh sách nhân sự
 * đang hoạt động (SRS UC-125 BR1: người đã nghỉ việc vẫn nằm trong watchlist được).
 *
 * - `user_id`/`face_profile_id` đều nullable: người ngoài chỉ có ảnh (không có tài
 *   khoản/hồ sơ khuôn mặt trong hệ thống) vẫn quản lý được qua `display_name` +
 *   `photo_media_file_id`.
 * - `list_type` (thêm theo review Hải §1.3): đối xứng `vehicle_control_list.list_type`
 *   — 'watchlist' (theo dõi) mặc định; để ngỏ 'blocklist' nếu sau này cần phân biệt
 *   cấm hẳn.
 * - `priority`: mức ưu tiên cảnh báo RIÊNG từng hồ sơ (UC-125 BR2), độc lập cảnh báo
 *   "người lạ" thông thường.
 * - `photo_media_file_id`: ẢNH CHỈ LƯU ĐỂ ĐỐI CHIẾU THỦ CÔNG (quyết định Hải §2.3) —
 *   KHÔNG enroll lên thiết bị nhận diện đợt này. Lý do: cron `cleanupEnded` (face-access)
 *   xóa mọi khuôn mặt không gắn cuộc họp nào; watchlist là thường trực, không gắn
 *   meeting nào, nên sẽ bị cron xóa ngay lần chạy kế tiếp nếu enroll bằng cơ chế hiện
 *   tại. Auto-match qua thiết bị = UC riêng sau (cần vòng đời enroll riêng).
 * - Dedup TÁCH 2 partial unique theo `user_id`/`face_profile_id` (mirror bẫy NULL !=
 *   NULL của `alert_rules`/`security_alerts`) — người chỉ có `display_name` (không có
 *   cả hai FK) không dedup được, chấp nhận trùng.
 * - Soft-delete (`deleted_at`) mirror pattern `vehicle_control_list`.
 */
@Entity('person_control_list')
export class PersonControlListEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'face_profile_id', type: 'uuid', nullable: true })
  faceProfileId: string | null;

  @Column({ name: 'display_name', type: 'varchar', length: 255 })
  displayName: string;

  @Column({ name: 'photo_media_file_id', type: 'uuid', nullable: true })
  photoMediaFileId: string | null;

  @Column({
    name: 'list_type',
    type: 'varchar',
    length: 20,
    default: 'watchlist',
  })
  listType: string;

  @Column({ name: 'reason', type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @Column({ name: 'priority', type: 'varchar', length: 20, default: 'medium' })
  priority: string;

  @Column({ name: 'active', type: 'boolean', default: true })
  active: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'user_id' })
  user: UserEntity | null;

  @ManyToOne(() => FaceProfileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'face_profile_id' })
  faceProfile: FaceProfileEntity | null;

  @ManyToOne(() => MediaFileEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'photo_media_file_id' })
  photoMediaFile: MediaFileEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  createdByUser: UserEntity | null;
}
