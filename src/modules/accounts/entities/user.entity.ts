import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  OneToMany,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
} from 'typeorm';
import { DepartmentEntity } from './department.entity.js';

export enum EmploymentStatus {
  ACTIVE = 'active',
  PROBATION = 'probation',
  RESIGNED = 'resigned',
  TRANSFERRED = 'transferred',
}

export enum AccountStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  LOCKED = 'locked',
  PENDING_RESET = 'pending_reset',
}

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'employee_code',
    type: 'varchar',
    length: 50,
    nullable: true,
  })
  employeeCode: string | null;

  @Column({ type: 'varchar', length: 100 })
  username: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  @Column({
    name: 'password_hash',
    type: 'varchar',
    length: 255,
    select: false,
  })
  passwordHash: string;

  @Column({ name: 'full_name', type: 'varchar', length: 255 })
  fullName: string;

  @Column({ name: 'phone_number', type: 'varchar', length: 30, nullable: true })
  phoneNumber: string | null;

  @Column({ name: 'avatar_url', type: 'text', nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'department_id', type: 'uuid', nullable: true })
  departmentId: string | null;

  @Column({ name: 'direct_manager_id', type: 'uuid', nullable: true })
  directManagerId: string | null;

  @Column({
    name: 'position_title',
    type: 'varchar',
    length: 150,
    nullable: true,
  })
  positionTitle: string | null;

  /** Lịch tuần UEL: văn thư của đơn vị (department_id). */
  @Column({ name: 'is_unit_clerk', type: 'boolean', default: false })
  isUnitClerk: boolean;

  /** Lịch tuần UEL: chức danh Ban Giám hiệu (HIEU_TRUONG | PHO_HIEU_TRUONG | BI_THU | PHO_BI_THU). */
  @Column({ name: 'leadership_title', type: 'varchar', length: 30, nullable: true })
  leadershipTitle: string | null;

  @Column({
    name: 'employment_status',
    type: 'varchar',
    length: 30,
    default: EmploymentStatus.ACTIVE,
  })
  employmentStatus: EmploymentStatus;

  @Column({
    name: 'account_status',
    type: 'varchar',
    length: 30,
    default: AccountStatus.ACTIVE,
  })
  accountStatus: AccountStatus;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;

  @Column({ name: 'password_updated_at', type: 'timestamptz', nullable: true })
  passwordUpdatedAt: Date | null;

  @Column({ name: 'failed_login_count', type: 'integer', default: 0 })
  failedLoginCount: number;

  @Column({ name: 'last_login_at', type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ name: 'account_expires_at', type: 'timestamptz', nullable: true })
  accountExpiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => DepartmentEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'department_id' })
  department: DepartmentEntity | null;

  @ManyToOne(() => UserEntity, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'direct_manager_id' })
  directManager: UserEntity | null;

  @OneToMany(() => UserEntity, (user) => user.directManager)
  subordinates: UserEntity[];
}
