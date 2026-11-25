import { Module } from '@nestjs/common';
import { FaceEnrollmentHook } from './services/face-enrollment.hook.js';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DepartmentEntity } from './entities/department.entity.js';
import { UserEntity } from './entities/user.entity.js';
import { RoleEntity } from './entities/role.entity.js';
import { PermissionEntity } from './entities/permission.entity.js';
import { UserRoleEntity } from './entities/user-role.entity.js';
import { RolePermissionEntity } from './entities/role-permission.entity.js';
import { FaceProfileEntity } from './entities/face-profile.entity.js';
import { UsersController } from './controllers/users.controller.js';
import { DepartmentsController } from './controllers/departments.controller.js';
import { FaceProfileController } from './controllers/face-profile.controller.js';
import { BiometricSubmissionController } from './controllers/biometric-submission.controller.js';
import { AdminBiometricReviewController } from './controllers/admin-biometric-review.controller.js';
import { AvatarPhotoController } from './controllers/avatar-photo.controller.js';
import { UsersService } from './services/users.service.js';
import { AccountImportService } from './services/account-import.service.js';
import { PartnerAccountImportService } from './services/partner-account-import.service.js';
import { FaceProfileService } from './services/face-profile.service.js';
import { PermissionsController } from './controllers/permissions.controller.js';
import { RolePermissionsController } from './controllers/role-permissions.controller.js';
import { RolesController } from './controllers/roles.controller.js';
import { BiometricStatusService } from './services/biometric-status.service.js';
import { BiometricSubmissionService } from './services/biometric-submission.service.js';
import { AdminBiometricReviewService } from './services/admin-biometric-review.service.js';
import { AvatarPhotoService } from './services/avatar-photo.service.js';
import { DepartmentsService } from './services/departments.service.js';
import { PasswordGeneratorService } from './services/password-generator.service.js';
import { IsDepartmentCodeUniqueConstraint } from './validators/is-department-code-unique.validator.js';
import { IsDepartmentNameUniqueConstraint } from './validators/is-department-name-unique.validator.js';
import { NoEmojiOrControlConstraint } from './validators/no-emoji-or-control.validator.js';
import { PermissionsService } from './services/permissions.service.js';
import { RolePermissionsService } from './services/role-permissions.service.js';
import { RolesService } from './services/roles.service.js';
import { AdministrationModule } from '../administration/administration.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
// BE-04 (Dot P1): ReportsModule export UserExportService cho UsersController
// (GET /users/export). Da xac minh KHONG vong lap: ReportsModule khong import
// AccountsModule (chi TypeOrmModule.forFeature truc tiep UserEntity/UserRoleEntity),
// nen AccountsModule -> ReportsModule la an toan (T-5.1,
// PLAN_THUC_THI_P1_CODE_VA_SPEC_2026-07-27.md).
import { ReportsModule } from '../reports/reports.module.js';
// VPT-IMPORT-001: import AnprModule để lấy VehicleRegistrationService (cột
// license_plate tùy chọn trong import Excel). Chiều accounts -> anpr an toàn:
// AnprModule chỉ import AuthModule/NotificationsModule/AlertsModule/ZonesModule,
// không module nào trong chuỗi đó import ngược AccountsModule.
import { AnprModule } from '../anpr/anpr.module.js';

/**
 * AccountsModule quÃ¡ÂºÂ£n lÃƒÂ½ tÃ¡ÂºÂ¥t cÃ¡ÂºÂ£ entities thuÃ¡Â»â„¢c domain Identity & Access:
 * - DepartmentEntity (departments)
 * - UserEntity (users)
 * - RoleEntity (roles)
 * - PermissionEntity (permissions)
 * - UserRoleEntity (user_roles)
 * - RolePermissionEntity (role_permissions)
 * - FaceProfileEntity (face_profiles)
 *
 * CÃƒÂ¡c module khÃƒÂ¡c cÃ¡ÂºÂ§n dÃƒÂ¹ng entities nÃƒ y phÃ¡ÂºÂ£i import AccountsModule.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      DepartmentEntity,
      UserEntity,
      RoleEntity,
      PermissionEntity,
      UserRoleEntity,
      RolePermissionEntity,
      FaceProfileEntity,
    ]),
    AdministrationModule,
    AuthModule,
    NotificationsModule,
    ReportsModule,
    AnprModule,
  ],
  controllers: [
    UsersController,
    DepartmentsController,
    PermissionsController,
    RolePermissionsController,
    RolesController,
    FaceProfileController,
    BiometricSubmissionController,
    AdminBiometricReviewController,
    AvatarPhotoController,
  ],
  providers: [
    FaceEnrollmentHook,
    UsersService,
    AccountImportService,
    PartnerAccountImportService,
    FaceProfileService,
    BiometricStatusService,
    BiometricSubmissionService,
    AdminBiometricReviewService,
    AvatarPhotoService,
    PermissionsService,
    RolePermissionsService,
    RolesService,
    PasswordGeneratorService,
    DepartmentsService,
    IsDepartmentCodeUniqueConstraint,
    IsDepartmentNameUniqueConstraint,
    NoEmojiOrControlConstraint,
  ],
  exports: [
    TypeOrmModule,
    UsersService,
    FaceProfileService,
    PasswordGeneratorService,
    DepartmentsService,
    FaceEnrollmentHook,
  ],
})
export class AccountsModule {}
