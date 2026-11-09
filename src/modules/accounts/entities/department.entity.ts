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
  Index,
} from 'typeorm';

@Entity('departments')
@Index('ux_departments_code', ['departmentCode'], {
  unique: true,
  where: 'deleted_at IS NULL',
})
export class DepartmentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'department_code', type: 'varchar', length: 50 })
  departmentCode: string;

  @Column({ name: 'department_name', type: 'varchar', length: 150 })
  departmentName: string;

  @Column({ name: 'parent_department_id', type: 'uuid', nullable: true })
  parentDepartmentId: string | null;

  @Column({ name: 'manager_user_id', type: 'uuid', nullable: true })
  managerUserId: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  /** Nguồn dữ liệu: 'manual' (nhập tay) | 'uel_api' (đồng bộ API Đào tạo UEL). */
  @Column({ type: 'varchar', length: 20, default: 'manual' })
  source: 'manual' | 'uel_api';

  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt: Date | null;

  // Relations
  @ManyToOne(() => DepartmentEntity, (dept) => dept.children, {
    nullable: true,
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'parent_department_id' })
  parentDepartment: DepartmentEntity | null;

  @OneToMany(() => DepartmentEntity, (dept) => dept.parentDepartment)
  children: DepartmentEntity[];
}
