import {
  Injectable,
  Logger,
  BadGatewayException,
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  ForbiddenException,
} from '@nestjs/common';
import {
  DataSource,
  EntityManager,
  ILike,
  IsNull,
  In,
  Not,
  MoreThan,
  Brackets,
} from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

import {
  UserEntity,
  EmploymentStatus,
  AccountStatus,
} from '../entities/user.entity.js';
import {
  buildAccountWelcomeEmail,
  buildPartnerAccountWelcomeEmail,
} from '../../mail/templates/builders.js';
import { DepartmentEntity } from '../entities/department.entity.js';
import { RoleEntity } from '../entities/role.entity.js';
import { UserRoleEntity } from '../entities/user-role.entity.js';
import { MEETING_INELIGIBLE_ROLE_CODES } from '../../../common/utils/meeting-ineligible-roles.util.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { BIOMETRIC_EXEMPT_ROLE_CODES } from '../../../common/utils/biometric-exempt-roles.util.js';
import {
  resolveBiometricReviewStatus,
  FaceProfileStatusRow,
} from '../../../common/utils/biometric-status-resolver.util.js';
import {
  PARTNER_DEPARTMENT_ID,
  isPartnerAccount,
  resolvePartnerDepartmentId,
} from '../../../common/utils/partner-account.util.js';
import { VISITOR_DEPARTMENT_ID } from '../../visitors/constants/visit-status.constant.js';

// UC-10 — READ-only cross-module entities (chỉ dùng để kiểm ràng buộc tham chiếu
// và soft-delete quan hệ trong transaction xóa; KHÔNG gọi/sửa service module khác).
import {
  MeetingEntity,
  MeetingStatus,
} from '../../meetings/entities/meeting.entity.js';
import { MeetingParticipantEntity } from '../../meetings/entities/meeting-participant.entity.js';
import {
  RoomBookingEntity,
  RoomBookingStatus,
} from '../../rooms/entities/room-booking.entity.js';
import { DeviceUserMappingEntity } from '../../iot/entities/device-user-mapping.entity.js';
import { RedisService } from '../../redis/redis.service.js';
import { AuthConfigService } from '../../auth/services/auth-config.service.js';
import { AuthzReadRepository } from '../../auth/repositories/authz-read.repository.js';
import { CloudinaryService } from '../../storage/cloudinary.service.js';
import {
  detectImageMimeType,
  AllowedImageMime,
} from '../utils/image-magic-bytes.util.js';
import { generateFaceProfileCode } from '../utils/face-profile-code.util.js';
import {
  MediaFileEntity,
  MediaFileType,
} from '../../recording/entities/media-file.entity.js';

import { NotificationsService } from '../../notifications/notifications.service.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';

import { PasswordGeneratorService } from './password-generator.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { UpdateUserDto } from '../dto/update-user.dto.js';
import {
  UserResponseDto,
  UserRoleResponseDto,
} from '../dto/user-response.dto.js';
import {
  UserDetailResponseDto,
  DepartmentInfoDto,
  DirectManagerInfoDto,
  RoleInfoDto,
} from '../dto/user-detail-response.dto.js';
import { UserPublicProfileResponseDto } from '../dto/user-public-profile-response.dto.js';
import { ListUsersQueryDto } from '../dto/list-users-query.dto.js';
import { UserListItemDto } from '../dto/user-list-item.dto.js';
import { ManageUsersQueryDto } from '../dto/manage-users-query.dto.js';
import { ManageUserItemDto } from '../dto/manage-user-item.dto.js';

export interface UserClientContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

/**
 * Dữ liệu tài khoản ĐÃ resolve (departmentId/roleIds/managerId là id thật),
 * dùng cho core persist chung giữa tạo đơn lẻ và import Excel.
 */
export interface ResolvedAccountData {
  fullName: string;
  email: string;
  departmentId: string;
  roleIds: string[];
  employeeCode: string | null;
  phoneNumber: string | null;
  positionTitle: string | null;
  directManagerId: string | null;
  partner?: PartnerProvisionData;
}

export interface PartnerProvisionData {
  accountExpiresAt: Date;
  mediaFileId: string;
  faceProfileId: string;
  detectedMime: AllowedImageMime;
  storageKey: string;
  fileUrl: string;
  fileName: string;
  uploadedBy: string;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  private readonly MAX_DEPARTMENT_SCOPE_DEPTH = 5;

  constructor(
    private readonly dataSource: DataSource,
    private readonly passwordGeneratorService: PasswordGeneratorService,
    private readonly notificationsService: NotificationsService,
    private readonly redisService: RedisService,
    private readonly authConfigService: AuthConfigService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly authzReadRepository: AuthzReadRepository,
  ) {}

  /**
   * VIS-BE-001: tài khoản khách ẩn — không đăng nhập được (password_hash không phải bcrypt hợp lệ,
   * email `.invalid` không nhận được thư), thuộc đơn vị VISITOR, không có role. Chỉ tồn tại để
   * khách đi qua đường nhận diện (device_user_mappings, gate_access_logs… đều khóa theo user_id).
   * Chạy trong manager của người gọi để cùng transaction với bảng `visitors`.
   */
  async createVisitorShadowUser(
    manager: EntityManager,
    input: { visitorId: string; fullName: string },
  ): Promise<{ userId: string }> {
    const short = input.visitorId.replace(/-/g, '').slice(0, 12);
    const rows: Array<{ id: string }> = await manager.query(
      `INSERT INTO users (employee_code, username, email, password_hash, full_name, department_id, account_status, employment_status)
       VALUES ($1, $2, $3, '!', $4, $5, 'active', 'active') RETURNING id`,
      [`VIS-${short}`, `visitor_${short}`, `${input.visitorId}@visitor.invalid`, input.fullName, VISITOR_DEPARTMENT_ID],
    );
    return { userId: rows[0].id };
  }

  async createUser(
    dto: CreateUserDto,
    creatorId: string,
    clientContext: UserClientContext,
    avatarFile?: {
      buffer?: Buffer;
      size?: number;
      originalname?: string;
    } | null,
  ): Promise<UserResponseDto> {
    const email = dto.email.trim().toLowerCase();
    const employeeCode = dto.employeeCode ? dto.employeeCode.trim() : null;
    const isPartner = dto.accountType === 'partner';
    const departmentId = isPartner
      ? await resolvePartnerDepartmentId(this.dataSource)
      : dto.departmentId;

    if (!departmentId) {
      throw new BadRequestException({
        success: false,
        message: 'Phòng ban không được để trống',
        error: { code: 'DEPARTMENT_REQUIRED', details: {} },
      });
    }

    let partnerUpload: PartnerProvisionData | null = null;
    if (isPartner) {
      const detectedMime = this.validatePartnerProvisionPayload(
        dto,
        avatarFile,
      );
      let upload: { publicId: string; secureUrl: string };
      try {
        upload = await this.cloudinaryService.uploadImage(avatarFile?.buffer!);
      } catch (error) {
        this.logger.error(
          `Cloudinary upload failed for partner account ${email}: ${(error as Error).message}`,
        );
        throw new BadGatewayException({
          success: false,
          message: 'Không thể lưu ảnh lên kho lưu trữ. Vui lòng thử lại.',
          error: { code: 'PARTNER_AVATAR_STORAGE_FAILED', details: {} },
        });
      }
      partnerUpload = {
        accountExpiresAt: new Date(dto.accountExpiresAt!),
        mediaFileId: randomUUID(),
        faceProfileId: randomUUID(),
        detectedMime,
        storageKey: upload.publicId,
        fileUrl: upload.secureUrl,
        fileName: upload.publicId.split('/').pop() ?? upload.publicId,
        uploadedBy: creatorId,
      };
    }

    let createdUser: UserEntity;
    let roles: RoleEntity[] = [];
    let tempPassword = '';

    try {
      await this.dataSource.transaction(async (em) => {
        const existingEmail = await em.findOne(UserEntity, {
          where: { email, deletedAt: IsNull() },
        });
        if (existingEmail) {
          throw new ConflictException({
            success: false,
            message:
              'Địa chỉ email này đã được sử dụng cho một tài khoản khác.',
            error: { code: 'ACCOUNT_EMAIL_ALREADY_EXISTS', details: { email } },
          });
        }

        const existingUsername = await em.findOne(UserEntity, {
          where: { username: email, deletedAt: IsNull() },
        });
        if (existingUsername) {
          throw new ConflictException({
            success: false,
            message: 'Tên người dùng này đã tồn tại trong hệ thống.',
            error: {
              code: 'ACCOUNT_USERNAME_ALREADY_EXISTS',
              details: { username: email },
            },
          });
        }

        const department = await em.findOne(DepartmentEntity, {
          where: { id: departmentId, deletedAt: IsNull() },
        });
        if (!department) {
          throw new NotFoundException({
            success: false,
            message: 'Phòng ban được chỉ định không tồn tại.',
            error: {
              code: 'DEPARTMENT_NOT_FOUND',
              details: { departmentId },
            },
          });
        }
        if (!department.isActive) {
          throw new UnprocessableEntityException({
            success: false,
            message: 'Phòng ban được chỉ định không hoạt động hoặc đã bị xóa.',
            error: {
              code: 'DEPARTMENT_INACTIVE_OR_DELETED',
              details: { departmentId },
            },
          });
        }

        roles = [];
        if (isPartner) {
          // Đối tác luôn ép role EMPLOYEE — không đọc dto.roleIds (form tạo
          // đối tác không có ô chọn role, xem PTA-001). Resolve theo
          // role_code vì role không có UUID cố định như PARTNER_DEPARTMENT_ID.
          const employeeRole = await em.findOne(RoleEntity, {
            where: { roleCode: 'EMPLOYEE', isActive: true },
          });
          if (!employeeRole) {
            throw new NotFoundException({
              success: false,
              message: 'Vai trò EMPLOYEE không khả dụng trong hệ thống.',
              error: {
                code: 'ROLE_NOT_FOUND',
                details: { roleCode: 'EMPLOYEE' },
              },
            });
          }
          roles.push(employeeRole);
        } else {
          for (const roleId of dto.roleIds!) {
            const role = await em.findOne(RoleEntity, {
              where: { id: roleId },
            });
            if (!role) {
              throw new NotFoundException({
                success: false,
                message: 'Một hoặc nhiều vai trò được chỉ định không tồn tại.',
                error: { code: 'ROLE_NOT_FOUND', details: { roleId } },
              });
            }
            if (!role.isActive) {
              throw new UnprocessableEntityException({
                success: false,
                message:
                  'Một hoặc nhiều vai trò được chọn đang không hoạt động.',
                error: { code: 'ROLE_INACTIVE', details: { roleId } },
              });
            }
            roles.push(role);
          }
        }

        if (employeeCode) {
          const existingCode = await em.findOne(UserEntity, {
            where: { employeeCode, deletedAt: IsNull() },
          });
          if (existingCode) {
            throw new ConflictException({
              success: false,
              message: 'Mã nhân viên này đã được đăng ký bởi tài khoản khác.',
              error: {
                code: 'ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS',
                details: { employeeCode },
              },
            });
          }
        }

        if (dto.directManagerId) {
          const manager = await em.findOne(UserEntity, {
            where: { id: dto.directManagerId, deletedAt: IsNull() },
          });
          if (!manager) {
            throw new NotFoundException({
              success: false,
              message: 'Người quản lý trực tiếp không tồn tại trong hệ thống.',
              error: {
                code: 'MANAGER_NOT_FOUND',
                details: { directManagerId: dto.directManagerId },
              },
            });
          }
          if (
            manager.accountStatus !== AccountStatus.ACTIVE ||
            manager.employmentStatus === EmploymentStatus.RESIGNED
          ) {
            throw new UnprocessableEntityException({
              success: false,
              message:
                'Người quản lý trực tiếp đang bị khóa hoặc đã nghỉ việc.',
              error: {
                code: 'MANAGER_INACTIVE_OR_UNAVAILABLE',
                details: { directManagerId: dto.directManagerId },
              },
            });
          }
        }

        const persisted = await this.persistAccount(
          em,
          {
            fullName: dto.fullName.trim(),
            email,
            departmentId,
            roleIds: roles.map((role) => role.id),
            employeeCode,
            phoneNumber: dto.phoneNumber ? dto.phoneNumber.trim() : null,
            positionTitle: dto.positionTitle ? dto.positionTitle.trim() : null,
            directManagerId: dto.directManagerId || null,
            partner: partnerUpload ?? undefined,
          },
          creatorId,
          clientContext,
        );
        createdUser = persisted.user;
        tempPassword = persisted.tempPassword;
      });
    } catch (error) {
      if (partnerUpload) {
        await this.cleanupCloudinary(partnerUpload.storageKey);
      }
      throw error;
    }

    const expiresAtText = partnerUpload
      ? partnerUpload.accountExpiresAt.toISOString()
      : '';
    const notificationSubject = isPartner
      ? 'Thông tin tài khoản đối tác Smart Meeting'
      : 'Thông tin tài khoản Smart Meeting mới của bạn';
    const content = isPartner
      ? [
          'Kính gửi ' + createdUser!.fullName + ',',
          '',
          'Tài khoản Smart Meeting dành cho đối tác của bạn đã được tạo thành công.',
          '',
          'Thông tin đăng nhập:',
          '- Email: ' + email,
          '- Mật khẩu: chính là địa chỉ email trên',
          '- Hạn sử dụng: ' + expiresAtText,
          '',
          'Trân trọng,',
          'Hệ thống Smart Meeting Management',
        ].join('\n')
      : [
          'Kính gửi ' + createdUser!.fullName + ',',
          '',
          'Tài khoản Smart Meeting của bạn đã được tạo thành công.',
          '',
          'Thông tin đăng nhập:',
          '- Email: ' + email,
          '- Mật khẩu tạm thời: ' + tempPassword,
          '',
          'Vui lòng đăng nhập và đổi mật khẩu ngay sau lần đầu tiên.',
          '',
          'Trân trọng,',
          'Hệ thống Smart Meeting Management',
        ].join('\n');

    try {
      await this.notificationsService.enqueueEmailNotification({
        notificationType: NotificationType.ACCOUNT_WELCOME,
        channel: NotificationChannel.EMAIL,
        subject: notificationSubject,
        content,
        emailHtml: isPartner
          ? buildPartnerAccountWelcomeEmail({
              fullName: createdUser!.fullName,
              email,
              expiresAt: partnerUpload!.accountExpiresAt,
            })
          : buildAccountWelcomeEmail({
              fullName: createdUser!.fullName,
              email,
              tempPassword,
            }),
        toEmails: [email],
        relatedEntityType: 'users',
        relatedEntityId: createdUser!.id,
        recipientScope: 'user_list',
        createdBy: creatorId,
        payloadJson: {
          fullName: createdUser!.fullName,
          username: email,
          mustChangePassword: isPartner ? false : true,
          accountType: isPartner ? 'partner' : 'employee',
        },
      });
    } catch (enqueueError) {
      this.logger.error(
        `Failed to enqueue welcome email for user ${createdUser!.id}: ${(enqueueError as Error).message}`,
      );
      try {
        await this.dataSource.manager.save(AuditLogEntity, {
          userId: creatorId,
          actionType: 'NOTIFICATION_ENQUEUE_FAILED',
          entityType: 'users',
          entityId: createdUser!.id,
          severity: AuditLogSeverity.WARNING,
          ipAddress: clientContext.ipAddress || null,
          userAgent: clientContext.userAgent || null,
          requestId: clientContext.requestId || null,
          metadataJson: {
            error: 'Failed to enqueue welcome credential email',
            details: (enqueueError as Error).message,
          },
        } as any);
      } catch (auditError) {
        this.logger.error(
          `Failed to write audit log for notification failure of user ${createdUser!.id}: ${(auditError as Error).message}`,
        );
      }
    }

    const rolesDto: UserRoleResponseDto[] = roles.map((role) => ({
      id: role.id,
      roleCode: role.roleCode,
      roleName: role.roleName,
    }));

    return {
      id: createdUser!.id,
      employeeCode: createdUser!.employeeCode,
      email: createdUser!.email,
      fullName: createdUser!.fullName,
      departmentId: createdUser!.departmentId,
      accountStatus: createdUser!.accountStatus,
      mustChangePassword: createdUser!.mustChangePassword,
      accountExpiresAt: createdUser!.accountExpiresAt,
      roles: rolesDto,
      createdAt: createdUser!.createdAt,
    };
  }

  private validatePartnerProvisionPayload(
    dto: CreateUserDto,
    file?: { buffer?: Buffer; size?: number; originalname?: string } | null,
  ): AllowedImageMime {
    if (!dto.accountExpiresAt) {
      throw new BadRequestException({
        success: false,
        message: 'Tài khoản đối tác bắt buộc có accountExpiresAt',
        error: { code: 'ACCOUNT_EXPIRES_AT_REQUIRED', details: {} },
      });
    }
    const expiresAt = new Date(dto.accountExpiresAt);
    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      throw new BadRequestException({
        success: false,
        message: 'accountExpiresAt phải là thời điểm tương lai',
        error: { code: 'ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE', details: {} },
      });
    }
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException({
        success: false,
        message: 'Tài khoản đối tác bắt buộc đính kèm ảnh sinh trắc học',
        error: { code: 'AVATAR_FILE_REQUIRED', details: {} },
      });
    }
    if (file.size && file.size > 5 * 1024 * 1024) {
      throw new BadRequestException({
        success: false,
        message: 'Ảnh vượt quá giới hạn 5MB',
        error: { code: 'AVATAR_FILE_TOO_LARGE', details: {} },
      });
    }
    const detectedMime = detectImageMimeType(file.buffer);
    if (!detectedMime) {
      throw new BadRequestException({
        success: false,
        message: 'Ảnh phải có định dạng JPEG, PNG hoặc WEBP',
        error: { code: 'AVATAR_FILE_TYPE_INVALID', details: {} },
      });
    }
    return detectedMime;
  }

  private async cleanupCloudinary(publicId: string): Promise<void> {
    try {
      await this.cloudinaryService.deleteImage(publicId);
    } catch (error) {
      this.logger.warn(
        `Failed to clean up orphan Cloudinary object ${publicId}: ${(error as Error).message}`,
      );
    }
  }
  /**
   * Core persist tài khoản (sinh mật khẩu + hash + insert user + user_roles + audit).
   * KHÔNG gửi email. Dùng chung cho tạo đơn lẻ và import Excel.
   * Phải được gọi bên trong một transaction (nhận `em`). Dữ liệu đầu vào đã resolve id.
   */
  async persistAccount(
    em: EntityManager,
    data: ResolvedAccountData,
    creatorId: string,
    clientContext: UserClientContext,
  ): Promise<{ user: UserEntity; tempPassword: string }> {
    // Sinh mật khẩu tạm + hash (BR1)
    const tempPassword = data.partner
      ? data.email
      : this.passwordGeneratorService.generateTemporaryPassword(12);
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(tempPassword, salt);

    const user = em.create(UserEntity, {
      fullName: data.fullName,
      email: data.email,
      username: data.email, // BR4: định danh đăng nhập là email
      passwordHash,
      departmentId: data.departmentId,
      employeeCode: data.employeeCode,
      phoneNumber: data.phoneNumber,
      positionTitle: data.positionTitle,
      directManagerId: data.directManagerId,
      employmentStatus: EmploymentStatus.ACTIVE,
      accountStatus: AccountStatus.ACTIVE,
      accountExpiresAt: data.partner?.accountExpiresAt ?? null,
      mustChangePassword: !data.partner, // BR3; partner=false
    });
    const createdUser = await em.save(UserEntity, user);

    for (const roleId of data.roleIds) {
      const userRole = em.create(UserRoleEntity, {
        userId: createdUser.id,
        roleId,
        assignedBy: creatorId,
        isActive: true,
      });
      await em.save(UserRoleEntity, userRole);
    }

    if (data.partner) {
      const now = new Date();
      await em.getRepository(MediaFileEntity).insert({
        id: data.partner.mediaFileId,
        fileName: data.partner.fileName,
        fileType: MediaFileType.IMAGE,
        mimeType: data.partner.detectedMime,
        storageProvider: this.cloudinaryService.resolveMediaStorageProvider(),
        storageKey: data.partner.storageKey,
        fileUrl: data.partner.fileUrl,
        relatedEntityType: 'face_profile',
        relatedEntityId: data.partner.faceProfileId,
        uploadedBy: data.partner.uploadedBy,
        isActive: true,
      });

      await em.getRepository(FaceProfileEntity).insert({
        id: data.partner.faceProfileId,
        userId: createdUser.id,
        profileCode: generateFaceProfileCode(),
        status: FaceProfileStatus.PENDING_REVIEW,
        primaryImageFileId: data.partner.mediaFileId,
        consentAt: null,
        enrolledBy: data.partner.uploadedBy,
        enrolledAt: now,
        lastUpdatedAt: now,
        sampleCount: 1,
        metadataJson: {
          importedBy: 'admin',
          importSource: 'partner-account-provisioning',
        },
      });
    }
    try {
      const auditLog = em.create(AuditLogEntity, {
        userId: creatorId,
        actionType: data.partner ? 'account.partner.create' : 'ACCOUNT_CREATE',
        entityType: 'users',
        entityId: createdUser.id,
        severity: AuditLogSeverity.INFO,
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        requestId: clientContext.requestId || null,
        newValueJson: {
          id: createdUser.id,
          email: createdUser.email,
          username: createdUser.username,
          fullName: createdUser.fullName,
          departmentId: createdUser.departmentId,
          employeeCode: createdUser.employeeCode,
          phoneNumber: createdUser.phoneNumber,
          roleIds: data.roleIds,
        },
      });
      await em.save(AuditLogEntity, auditLog);
    } catch (auditError) {
      this.logger.error(
        `Failed to save audit log for user creation of ${createdUser.id}: ${(auditError as Error).message}`,
        (auditError as Error).stack,
      );
    }

    return { user: createdUser, tempPassword };
  }

  /**
   * UC-08 — Cập nhật (replace) tập vai trò của một tài khoản đã tồn tại.
   *
   * Ràng buộc chốt:
   * - Chỉ SYSTEM_ADMIN được gọi (enforce ở controller qua PermissionsGuard) → service
   *   KHÔNG kiểm department scope / role-elevation.
   * - Replace-set: `desiredRoleIds` là tập mong muốn đầy đủ.
   * - Soft-remove role bị bỏ (is_active=false + expired_at=now()); role thêm dùng
   *   reactivate-if-exists (update row cũ nếu tồn tại do UNIQUE (user_id, role_id),
   *   INSERT nếu chưa có) → KHÔNG hard-delete, KHÔNG insert trùng.
   * - Audit ghi ATOMIC trong cùng transaction (không ghi sau commit).
   */
  async updateUserRoles(
    targetUserId: string,
    desiredRoleIds: string[],
    actorId: string,
    clientContext: UserClientContext,
  ): Promise<{ userId: string; roles: UserRoleResponseDto[] }> {
    const ACTION_TYPE = 'ACCOUNT_ROLE_UPDATE';
    const desired = [...new Set(desiredRoleIds)];
    const em = this.dataSource.manager;

    // ── Phase A — Validate (ngoài transaction, fail sớm) ──

    // A.2 Target user tồn tại & chưa soft-delete
    const targetUser = await em.findOne(UserEntity, {
      where: { id: targetUserId, deletedAt: IsNull() },
    });
    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    // A.3 BR-08 — tài khoản phải đang active
    if (targetUser.accountStatus !== AccountStatus.ACTIVE) {
      throw new UnprocessableEntityException({
        success: false,
        message:
          'Tài khoản đang bị khóa hoặc không hoạt động nên không thể cập nhật vai trò.',
        error: {
          code: 'ACCOUNT_INACTIVE',
          details: { accountStatus: targetUser.accountStatus },
        },
      });
    }

    // A.4 Validate từng role trong tập mong muốn (mirror createUser)
    for (const roleId of desired) {
      const role = await em.findOne(RoleEntity, { where: { id: roleId } });
      if (!role) {
        throw new NotFoundException({
          success: false,
          message: 'Một hoặc nhiều vai trò được chỉ định không tồn tại.',
          error: { code: 'ROLE_NOT_FOUND', details: { roleId } },
        });
      }
      if (!role.isActive) {
        throw new UnprocessableEntityException({
          success: false,
          message:
            'Một hoặc nhiều vai trò được chọn đang ở trạng thái không hoạt động.',
          error: { code: 'ROLE_INACTIVE', details: { roleId } },
        });
      }
    }

    // A.5 Tập role active hiện tại + A.6 diff
    const currentActive = await em.find(UserRoleEntity, {
      where: { userId: targetUserId, isActive: true },
    });
    const currentRoleIds = currentActive.map((ur) => ur.roleId);
    const currentSet = new Set(currentRoleIds);
    const desiredSet = new Set(desired);
    const toAdd = desired.filter((id) => !currentSet.has(id));
    const toRemove = currentRoleIds.filter((id) => !desiredSet.has(id));

    // A.6b (BA 2026-08-03): xác định demote khỏi role miễn trừ sinh trắc học
    // (BUSINESS_ADMIN/SYSTEM_ADMIN) — dùng để quyết định có bắt upload lại không.
    const involvedRoleIds = [...new Set([...currentRoleIds, ...desired])];
    const involvedRoles = await em.find(RoleEntity, {
      where: { id: In(involvedRoleIds) },
    });
    const roleCodeById = new Map(involvedRoles.map((r) => [r.id, r.roleCode]));
    const wasExempt = currentRoleIds.some((id) =>
      BIOMETRIC_EXEMPT_ROLE_CODES.includes(roleCodeById.get(id) ?? ''),
    );
    const willBeExempt = desired.some((id) =>
      BIOMETRIC_EXEMPT_ROLE_CODES.includes(roleCodeById.get(id) ?? ''),
    );
    const isBiometricDemotion = wasExempt && !willBeExempt;

    // A.7 BR-04 — self-lockout: không tự gỡ vai trò hệ thống của chính mình
    if (actorId === targetUserId && toRemove.length > 0) {
      const removingRoles = await em.find(RoleEntity, {
        where: { id: In(toRemove) },
      });
      const systemRole = removingRoles.find((r) => r.isSystemRole);
      if (systemRole) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Bạn không thể tự gỡ vai trò hệ thống của chính mình.',
          error: {
            code: 'CANNOT_MODIFY_OWN_ADMIN_ROLE',
            details: { roleId: systemRole.id },
          },
        });
      }
    }

    // A.8 No-op idempotent — không thay đổi thì trả về tập hiện tại, không ghi DB/audit
    if (toAdd.length === 0 && toRemove.length === 0) {
      const roles = await this.getActiveRolesResponse(em, targetUserId);
      return { userId: targetUserId, roles };
    }

    // ── Phase B — Transaction (atomic: user_roles + audit) ──
    await this.dataSource.transaction(async (tem) => {
      // B.1 Soft-remove role bị bỏ
      if (toRemove.length > 0) {
        const removeRows = await tem.find(UserRoleEntity, {
          where: { userId: targetUserId, roleId: In(toRemove), isActive: true },
        });
        for (const row of removeRows) {
          row.isActive = false;
          row.expiredAt = new Date();
          await tem.save(UserRoleEntity, row);
        }
      }

      // B.2 Add role — reactivate-if-exists (tránh vi phạm UNIQUE (user_id, role_id))
      for (const roleId of toAdd) {
        const existing = await tem.findOne(UserRoleEntity, {
          where: { userId: targetUserId, roleId },
        });
        if (existing) {
          existing.isActive = true;
          existing.expiredAt = null;
          existing.assignedBy = actorId;
          existing.assignedAt = new Date();
          await tem.save(UserRoleEntity, existing);
        } else {
          const newRow = tem.create(UserRoleEntity, {
            userId: targetUserId,
            roleId,
            assignedBy: actorId,
            isActive: true,
          });
          await tem.save(UserRoleEntity, newRow);
        }
      }

      // B.2b (BA 2026-08-03): demote khỏi BUSINESS_ADMIN/SYSTEM_ADMIN → thu hồi
      // face_profile ACTIVE hiện có, bắt buộc user nộp lại ảnh (không giữ ảnh cũ).
      if (isBiometricDemotion) {
        const activeFaceProfiles = await tem.find(FaceProfileEntity, {
          where: { userId: targetUserId, status: FaceProfileStatus.ACTIVE },
        });
        for (const profile of activeFaceProfiles) {
          profile.status = FaceProfileStatus.REVOKED;
          profile.lastUpdatedAt = new Date();
          await tem.save(FaceProfileEntity, profile);
        }
        if (activeFaceProfiles.length > 0) {
          const revokeAudit = tem.create(AuditLogEntity, {
            userId: actorId,
            actionType: 'biometric.auto_revoked_on_role_downgrade',
            entityType: 'face_profiles',
            entityId: targetUserId,
            severity: AuditLogSeverity.WARNING,
            oldValueJson: {
              faceProfileIds: activeFaceProfiles.map((p) => p.id),
              status: FaceProfileStatus.ACTIVE,
            },
            newValueJson: { status: FaceProfileStatus.REVOKED },
            ipAddress: clientContext.ipAddress || null,
            userAgent: clientContext.userAgent || null,
            requestId: clientContext.requestId || null,
          });
          await tem.save(AuditLogEntity, revokeAudit);
        }
      }

      // B.3 Audit ATOMIC trong transaction (chỉ log roleIds, không log secret/token)
      const auditLog = tem.create(AuditLogEntity, {
        userId: actorId,
        actionType: ACTION_TYPE,
        entityType: 'users',
        entityId: targetUserId,
        severity: AuditLogSeverity.WARNING,
        oldValueJson: { roleIds: currentRoleIds },
        newValueJson: { roleIds: desired },
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        requestId: clientContext.requestId || null,
      });
      await tem.save(AuditLogEntity, auditLog);
    });

    // Sau commit — trả về tập role active mới
    const roles = await this.getActiveRolesResponse(
      this.dataSource.manager,
      targetUserId,
    );
    return { userId: targetUserId, roles };
  }

  /**
   * Đọc tập vai trò active của user và map sang UserRoleResponseDto (tái dùng DTO có sẵn).
   */
  private async getActiveRolesResponse(
    em: import('typeorm').EntityManager,
    userId: string,
  ): Promise<UserRoleResponseDto[]> {
    const rows = await em.find(UserRoleEntity, {
      where: { userId, isActive: true },
      relations: { role: true },
    });
    return rows.map((ur) => ({
      id: ur.role.id,
      roleCode: ur.role.roleCode,
      roleName: ur.role.roleName,
    }));
  }

  /**
   * UC-10 — Xóa (SOFT-DELETE) một tài khoản người dùng.
   *
   * Ràng buộc chốt:
   * - SOFT-DELETE (set users.deleted_at), KHÔNG hard-delete (DATA-01).
   * - Actor chỉ SYSTEM_ADMIN (enforce ở controller qua PermissionsGuard).
   * - Chặn xóa nếu còn ràng buộc active (5 loại) → 409 USER_HAS_DEPENDENCIES.
   * - Không tự xóa mình; không xóa SYSTEM_ADMIN cuối cùng; không xóa user đã soft-delete.
   * - Transaction atomic: softDelete users + vô hiệu user_roles + softDelete face_profiles
   *   + softDelete device_user_mappings + audit ACCOUNT_DELETE (WARNING).
   * - Post-commit: thu hồi token qua Redis auth:user:{id}:invalid_after.
   *
   * Chỉ ĐỌC entity cross-module (meetings/rooms/departments/iot) qua EntityManager —
   * KHÔNG gọi/sửa service của các module đó.
   */
  async deleteUser(
    targetUserId: string,
    actorId: string,
    clientContext: UserClientContext,
  ): Promise<void> {
    const ACTION_TYPE = 'ACCOUNT_DELETE';
    const em = this.dataSource.manager;
    const now = new Date();

    // ── Phase A — Validate (READ, ngoài transaction) ──

    // A.1 Load target (chưa soft-delete)
    const targetUser = await em.findOne(UserEntity, {
      where: { id: targetUserId, deletedAt: IsNull() },
    });
    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    // A.2 BR-01 — không tự xóa chính mình
    if (targetUserId === actorId) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Bạn không thể xóa tài khoản của chính mình.',
        error: { code: 'CANNOT_DELETE_SELF', details: {} },
      });
    }

    // Đọc roles active của target TRƯỚC khi vô hiệu (cho audit snapshot + kiểm last-admin)
    const targetActiveRoles = await em.find(UserRoleEntity, {
      where: { userId: targetUserId, isActive: true },
      relations: { role: true },
    });
    const roleIds = targetActiveRoles.map((ur) => ur.roleId);
    const targetIsSystemAdmin = targetActiveRoles.some(
      (ur) => ur.role?.roleCode === 'SYSTEM_ADMIN' && ur.role?.isActive,
    );

    // A.3 BR-02 — không xóa SYSTEM_ADMIN active cuối cùng
    if (targetIsSystemAdmin) {
      const otherAdminCount = await em
        .createQueryBuilder(UserRoleEntity, 'ur')
        .innerJoin('ur.role', 'r')
        .innerJoin('ur.user', 'u')
        .where('r.roleCode = :code', { code: 'SYSTEM_ADMIN' })
        .andWhere('r.isActive = true')
        .andWhere('ur.isActive = true')
        .andWhere('(ur.expiredAt IS NULL OR ur.expiredAt > :now)', { now })
        .andWhere('u.deletedAt IS NULL')
        .andWhere('u.accountStatus = :active', {
          active: AccountStatus.ACTIVE,
        })
        .andWhere('u.id != :targetUserId', { targetUserId })
        .getCount();

      if (otherAdminCount === 0) {
        throw new UnprocessableEntityException({
          success: false,
          message:
            'Không thể xóa quản trị viên hệ thống cuối cùng còn hoạt động.',
          error: { code: 'LAST_SYSTEM_ADMIN', details: {} },
        });
      }
    }

    // A.4 Ràng buộc tham chiếu (5 loại) — CHỈ READ; gom tất cả loại vi phạm rồi mới ném
    const dependencies: string[] = [];

    const upcomingMeetingStatuses = [
      MeetingStatus.SCHEDULED,
      MeetingStatus.IN_PROGRESS,
    ];

    // (a) organizer/host của meeting sắp tới/đang diễn ra
    const hostCount = await em.count(MeetingEntity, {
      where: [
        {
          organizerId: targetUserId,
          status: In(upcomingMeetingStatuses),
          endTime: MoreThan(now),
        },
        {
          hostId: targetUserId,
          status: In(upcomingMeetingStatuses),
          endTime: MoreThan(now),
        },
      ],
    });
    if (hostCount > 0) dependencies.push('upcoming_meeting_host');

    // (b) participant của meeting sắp tới/đang diễn ra
    const participantCount = await em
      .createQueryBuilder(MeetingParticipantEntity, 'mp')
      .innerJoin('mp.meeting', 'm')
      .where('mp.userId = :targetUserId', { targetUserId })
      .andWhere('m.status IN (:...statuses)', {
        statuses: upcomingMeetingStatuses,
      })
      .andWhere('m.endTime > :now', { now })
      .getCount();
    if (participantCount > 0) dependencies.push('upcoming_meeting_participant');

    // (c) booked_by của room_booking còn hiệu lực
    const bookingCount = await em.count(RoomBookingEntity, {
      where: {
        bookedBy: targetUserId,
        status: In([
          RoomBookingStatus.PENDING,
          RoomBookingStatus.APPROVED,
          RoomBookingStatus.ACTIVE,
        ]),
        reservedEndTime: MoreThan(now),
      },
    });
    if (bookingCount > 0) dependencies.push('active_booking');

    // (d) là direct_manager của user khác đang active
    const manageeCount = await em.count(UserEntity, {
      where: {
        directManagerId: targetUserId,
        deletedAt: IsNull(),
        accountStatus: AccountStatus.ACTIVE,
      },
    });
    if (manageeCount > 0) dependencies.push('manages_users');

    // (e) là trưởng phòng ban đang active
    const departmentCount = await em.count(DepartmentEntity, {
      where: {
        managerUserId: targetUserId,
        deletedAt: IsNull(),
        isActive: true,
      },
    });
    if (departmentCount > 0) dependencies.push('manages_department');

    if (dependencies.length > 0) {
      throw new ConflictException({
        success: false,
        message:
          'Không thể xóa tài khoản vì còn dữ liệu/ràng buộc liên quan đang hoạt động.',
        error: { code: 'USER_HAS_DEPENDENCIES', details: { dependencies } },
      });
    }

    // ── Phase B — Transaction (atomic) ──
    await this.dataSource.transaction(async (tem) => {
      // B.1 Soft-delete users
      await tem.softDelete(UserEntity, targetUserId);

      // B.2 Vô hiệu user_roles active
      await tem.update(
        UserRoleEntity,
        { userId: targetUserId, isActive: true },
        { isActive: false, expiredAt: now },
      );

      // B.3 Soft-delete face_profiles
      await tem.softDelete(FaceProfileEntity, { userId: targetUserId });

      // B.4 Soft-delete device_user_mappings
      await tem.softDelete(DeviceUserMappingEntity, { userId: targetUserId });

      // B.5 Audit atomic (ACCOUNT_DELETE, WARNING) — không log secret
      const auditLog = tem.create(AuditLogEntity, {
        userId: actorId,
        actionType: ACTION_TYPE,
        entityType: 'users',
        entityId: targetUserId,
        severity: AuditLogSeverity.WARNING,
        oldValueJson: {
          id: targetUser.id,
          email: targetUser.email,
          fullName: targetUser.fullName,
          employeeCode: targetUser.employeeCode,
          departmentId: targetUser.departmentId,
          roleIds,
        },
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        requestId: clientContext.requestId || null,
      });
      await tem.save(AuditLogEntity, auditLog);
    });

    // ── Phase C — Post-commit: thu hồi token (Redis) ──
    // Redis fail KHÔNG throw, KHÔNG rollback (user đã soft-delete).
    try {
      const ttlSeconds = this.authConfigService.getRefreshTokenTtlSeconds();
      await this.redisService.setWithTtl(
        `auth:user:${targetUserId}:invalid_after`,
        String(now.getTime()),
        ttlSeconds,
      );
    } catch (error) {
      this.logger.error(
        `Failed to revoke tokens for deleted user ${targetUserId}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * UC-12 — Khóa tài khoản người dùng (account_status = LOCKED) + thu hồi mọi session.
   *
   * Ràng buộc chốt:
   * - Set account_status=LOCKED, locked_until=null (vô thời hạn tới khi admin mở).
   * - KHÔNG chạm user_roles/hồ sơ/soft-delete → giữ nguyên dữ liệu lịch sử.
   * - Actor SYSTEM_ADMIN (không scope) + BUSINESS_ADMIN (department scope, chỉ target).
   * - Không tự khóa mình; không khóa SYSTEM_ADMIN active cuối cùng; no-op nếu đã LOCKED.
   * - reason (tùy chọn) ghi vào audit_logs.metadataJson (không thêm cột users).
   * - Post-commit: thu hồi token qua Redis invalid_after.
   */
  async lockUser(
    targetUserId: string,
    reason: string | undefined,
    actorId: string,
    clientContext: UserClientContext,
  ): Promise<{ id: string; accountStatus: string }> {
    const ACTION_TYPE = 'ACCOUNT_LOCK';
    const em = this.dataSource.manager;
    const now = new Date();

    // ── Phase A — Validate (READ) ──

    // A.1 Load target (chưa soft-delete)
    const targetUser = await em.findOne(UserEntity, {
      where: { id: targetUserId, deletedAt: IsNull() },
    });
    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    // A.2 Department scope của target (chỉ target)
    const actorRoles = await em.find(UserRoleEntity, {
      where: { userId: actorId, isActive: true },
      relations: { role: true },
    });
    const isSystemAdmin = actorRoles.some(
      (ur) => ur.role?.isSystemRole === true,
    );
    if (!isSystemAdmin) {
      const scope = await this.resolveDepartmentScope(actorId);
      if (targetUser.departmentId && !scope.has(targetUser.departmentId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền khóa tài khoản của nhân sự này.',
          error: { code: 'FORBIDDEN', details: {} },
        });
      }
    }

    // A.3 BR-01 — không tự khóa chính mình
    if (targetUserId === actorId) {
      throw new UnprocessableEntityException({
        success: false,
        message: 'Bạn không thể khóa tài khoản của chính mình.',
        error: { code: 'CANNOT_LOCK_SELF', details: {} },
      });
    }

    // A.4 BR-03 no-op — đã LOCKED (BR-04: INACTIVE vẫn khóa được, không chặn)
    if (targetUser.accountStatus === AccountStatus.LOCKED) {
      return { id: targetUserId, accountStatus: AccountStatus.LOCKED };
    }

    // A.5 BR-02 — không khóa SYSTEM_ADMIN active cuối cùng
    const targetActiveRoles = await em.find(UserRoleEntity, {
      where: { userId: targetUserId, isActive: true },
      relations: { role: true },
    });
    const targetIsSystemAdmin = targetActiveRoles.some(
      (ur) => ur.role?.roleCode === 'SYSTEM_ADMIN' && ur.role?.isActive,
    );
    if (targetIsSystemAdmin) {
      const otherAdminCount = await em
        .createQueryBuilder(UserRoleEntity, 'ur')
        .innerJoin('ur.role', 'r')
        .innerJoin('ur.user', 'u')
        .where('r.roleCode = :code', { code: 'SYSTEM_ADMIN' })
        .andWhere('r.isActive = true')
        .andWhere('ur.isActive = true')
        .andWhere('(ur.expiredAt IS NULL OR ur.expiredAt > :now)', { now })
        .andWhere('u.deletedAt IS NULL')
        .andWhere('u.accountStatus = :active', {
          active: AccountStatus.ACTIVE,
        })
        .andWhere('u.id != :targetUserId', { targetUserId })
        .getCount();

      if (otherAdminCount === 0) {
        throw new UnprocessableEntityException({
          success: false,
          message:
            'Không thể khóa quản trị viên hệ thống cuối cùng còn hoạt động.',
          error: { code: 'LAST_SYSTEM_ADMIN', details: {} },
        });
      }
    }

    // ── Phase B — Transaction (atomic: account_status + audit) ──
    await this.dataSource.transaction(async (tem) => {
      await tem.update(UserEntity, targetUserId, {
        accountStatus: AccountStatus.LOCKED,
        lockedUntil: null,
      });

      const auditLog = tem.create(AuditLogEntity, {
        userId: actorId,
        actionType: ACTION_TYPE,
        entityType: 'users',
        entityId: targetUserId,
        severity: AuditLogSeverity.WARNING,
        oldValueJson: { accountStatus: targetUser.accountStatus },
        newValueJson: { accountStatus: AccountStatus.LOCKED },
        metadataJson: reason ? { reason } : null,
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        requestId: clientContext.requestId || null,
      });
      await tem.save(AuditLogEntity, auditLog);
    });

    // ── Phase C — Post-commit: thu hồi mọi session ──
    // Redis fail KHÔNG throw, KHÔNG rollback (tài khoản đã LOCKED).
    try {
      const ttlSeconds = this.authConfigService.getRefreshTokenTtlSeconds();
      await this.redisService.setWithTtl(
        `auth:user:${targetUserId}:invalid_after`,
        String(now.getTime()),
        ttlSeconds,
      );
    } catch (error) {
      this.logger.error(
        `Failed to revoke tokens for locked user ${targetUserId}: ${(error as Error).message}`,
      );
    }

    return { id: targetUserId, accountStatus: AccountStatus.LOCKED };
  }

  /**
   * UC-12 — Mở khóa tài khoản người dùng (LOCKED -> ACTIVE).
   *
   * Ràng buộc chốt:
   * - Chỉ mở khi đang LOCKED (ngược lại 409 NOT_LOCKED).
   * - Đưa về ACTIVE + reset failed_login_count=0, locked_until=null.
   *   (Không khôi phục trạng thái INACTIVE trước đó vì hệ thống không lưu.)
   * - KHÔNG thao tác token (không có session hợp lệ khi đang khóa).
   * - Actor SYSTEM_ADMIN (không scope) + BUSINESS_ADMIN (department scope, chỉ target).
   */
  async unlockUser(
    targetUserId: string,
    actorId: string,
    clientContext: UserClientContext,
  ): Promise<{ id: string; accountStatus: string }> {
    const ACTION_TYPE = 'ACCOUNT_UNLOCK';
    const em = this.dataSource.manager;

    // ── Phase A — Validate (READ) ──

    // A.1 Load target (chưa soft-delete)
    const targetUser = await em.findOne(UserEntity, {
      where: { id: targetUserId, deletedAt: IsNull() },
    });
    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    // A.2 Department scope của target (chỉ target)
    const actorRoles = await em.find(UserRoleEntity, {
      where: { userId: actorId, isActive: true },
      relations: { role: true },
    });
    const isSystemAdmin = actorRoles.some(
      (ur) => ur.role?.isSystemRole === true,
    );
    if (!isSystemAdmin) {
      const scope = await this.resolveDepartmentScope(actorId);
      if (targetUser.departmentId && !scope.has(targetUser.departmentId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền mở khóa tài khoản của nhân sự này.',
          error: { code: 'FORBIDDEN', details: {} },
        });
      }
    }

    // A.3 BR-03 — chỉ mở khi đang LOCKED
    if (targetUser.accountStatus !== AccountStatus.LOCKED) {
      throw new ConflictException({
        success: false,
        message: 'Tài khoản không ở trạng thái bị khóa.',
        error: {
          code: 'NOT_LOCKED',
          details: { currentStatus: targetUser.accountStatus },
        },
      });
    }

    // ── Phase B — Transaction (atomic: account_status + reset + audit) ──
    await this.dataSource.transaction(async (tem) => {
      await tem.update(UserEntity, targetUserId, {
        accountStatus: AccountStatus.ACTIVE,
        failedLoginCount: 0,
        lockedUntil: null,
      });

      const auditLog = tem.create(AuditLogEntity, {
        userId: actorId,
        actionType: ACTION_TYPE,
        entityType: 'users',
        entityId: targetUserId,
        severity: AuditLogSeverity.INFO,
        oldValueJson: { accountStatus: AccountStatus.LOCKED },
        newValueJson: { accountStatus: AccountStatus.ACTIVE },
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        requestId: clientContext.requestId || null,
      });
      await tem.save(AuditLogEntity, auditLog);
    });

    // KHÔNG Phase C — không thao tác token khi mở khóa.

    return { id: targetUserId, accountStatus: AccountStatus.ACTIVE };
  }

  /**
   * UC-11 — Cập nhật trạng thái tài khoản (ACTIVE ↔ INACTIVE).
   *
   * Ràng buộc chốt:
   * - Chỉ đổi giữa ACTIVE/INACTIVE (không set LOCKED/PENDING_RESET — UC-12/auth).
   * - Actor SYSTEM_ADMIN (không scope) + BUSINESS_ADMIN (department scope, chỉ target).
   * - Không tự vô hiệu hóa mình; không vô hiệu SYSTEM_ADMIN active cuối cùng.
   * - No-op nếu status mới == hiện tại.
   * - Transaction atomic: UPDATE account_status + audit ACCOUNT_STATUS_UPDATE.
   * - Post-commit CHỈ khi -> INACTIVE: thu hồi token qua Redis invalid_after.
   *
   * KHÔNG chạm user_roles/hồ sơ/soft-delete; KHÔNG sửa login (đã chặn inactive sẵn).
   */
  async updateUserStatus(
    targetUserId: string,
    status: 'active' | 'inactive',
    actorId: string,
    clientContext: UserClientContext,
  ): Promise<{ id: string; accountStatus: string }> {
    const ACTION_TYPE = 'ACCOUNT_STATUS_UPDATE';
    const em = this.dataSource.manager;
    const now = new Date();
    const nextStatus =
      status === 'active' ? AccountStatus.ACTIVE : AccountStatus.INACTIVE;

    // ── Phase A — Validate (READ, ngoài transaction) ──

    // A.1 Load target (chưa soft-delete)
    const targetUser = await em.findOne(UserEntity, {
      where: { id: targetUserId, deletedAt: IsNull() },
    });
    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    // A.2 Xác định System Admin & department scope của target (chỉ target)
    const actorRoles = await em.find(UserRoleEntity, {
      where: { userId: actorId, isActive: true },
      relations: { role: true },
    });
    const isSystemAdmin = actorRoles.some(
      (ur) => ur.role?.isSystemRole === true,
    );
    if (!isSystemAdmin) {
      const scope = await this.resolveDepartmentScope(actorId);
      if (targetUser.departmentId && !scope.has(targetUser.departmentId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền cập nhật trạng thái của nhân sự này.',
          error: { code: 'FORBIDDEN', details: {} },
        });
      }
    }

    // A.3 BR-04 — không đổi status khi đang LOCKED/PENDING_RESET (địa hạt UC-12/auth)
    if (
      targetUser.accountStatus === AccountStatus.LOCKED ||
      targetUser.accountStatus === AccountStatus.PENDING_RESET
    ) {
      throw new ConflictException({
        success: false,
        message:
          'Không thể cập nhật trạng thái của tài khoản đang bị khóa hoặc đang chờ đặt lại mật khẩu.',
        error: {
          code: 'INVALID_STATUS_TRANSITION',
          details: { currentStatus: targetUser.accountStatus },
        },
      });
    }

    // A.4 BR-03 no-op — status mới trùng hiện tại: không WRITE/không audit
    if (nextStatus === targetUser.accountStatus) {
      return { id: targetUserId, accountStatus: targetUser.accountStatus };
    }

    // A.5 Khi chuyển sang INACTIVE
    if (nextStatus === AccountStatus.INACTIVE) {
      // BR-02 — không tự vô hiệu hóa chính mình
      if (targetUserId === actorId) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Bạn không thể vô hiệu hóa tài khoản của chính mình.',
          error: { code: 'CANNOT_DEACTIVATE_SELF', details: {} },
        });
      }

      // BR-05 — không vô hiệu hóa SYSTEM_ADMIN active cuối cùng
      const targetActiveRoles = await em.find(UserRoleEntity, {
        where: { userId: targetUserId, isActive: true },
        relations: { role: true },
      });
      const targetIsSystemAdmin = targetActiveRoles.some(
        (ur) => ur.role?.roleCode === 'SYSTEM_ADMIN' && ur.role?.isActive,
      );
      if (targetIsSystemAdmin) {
        const otherAdminCount = await em
          .createQueryBuilder(UserRoleEntity, 'ur')
          .innerJoin('ur.role', 'r')
          .innerJoin('ur.user', 'u')
          .where('r.roleCode = :code', { code: 'SYSTEM_ADMIN' })
          .andWhere('r.isActive = true')
          .andWhere('ur.isActive = true')
          .andWhere('(ur.expiredAt IS NULL OR ur.expiredAt > :now)', { now })
          .andWhere('u.deletedAt IS NULL')
          .andWhere('u.accountStatus = :active', {
            active: AccountStatus.ACTIVE,
          })
          .andWhere('u.id != :targetUserId', { targetUserId })
          .getCount();

        if (otherAdminCount === 0) {
          throw new UnprocessableEntityException({
            success: false,
            message:
              'Không thể vô hiệu hóa quản trị viên hệ thống cuối cùng còn hoạt động.',
            error: { code: 'LAST_SYSTEM_ADMIN', details: {} },
          });
        }
      }
    }

    // ── Phase B — Transaction (atomic: account_status + audit) ──
    await this.dataSource.transaction(async (tem) => {
      await tem.update(UserEntity, targetUserId, { accountStatus: nextStatus });

      const auditLog = tem.create(AuditLogEntity, {
        userId: actorId,
        actionType: ACTION_TYPE,
        entityType: 'users',
        entityId: targetUserId,
        severity:
          nextStatus === AccountStatus.INACTIVE
            ? AuditLogSeverity.WARNING
            : AuditLogSeverity.INFO,
        oldValueJson: { accountStatus: targetUser.accountStatus },
        newValueJson: { accountStatus: nextStatus },
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        requestId: clientContext.requestId || null,
      });
      await tem.save(AuditLogEntity, auditLog);
    });

    // ── Phase C — Post-commit: thu hồi token CHỈ khi chuyển sang INACTIVE ──
    // Redis fail KHÔNG throw, KHÔNG rollback (status đã đổi).
    if (nextStatus === AccountStatus.INACTIVE) {
      try {
        const ttlSeconds = this.authConfigService.getRefreshTokenTtlSeconds();
        await this.redisService.setWithTtl(
          `auth:user:${targetUserId}:invalid_after`,
          String(now.getTime()),
          ttlSeconds,
        );
      } catch (error) {
        this.logger.error(
          `Failed to revoke tokens for deactivated user ${targetUserId}: ${(error as Error).message}`,
        );
      }
    }

    return { id: targetUserId, accountStatus: nextStatus };
  }

  /**
   * UC-09 — Cập nhật (partial) thông tin hồ sơ của một tài khoản đã tồn tại.
   *
   * Ràng buộc chốt:
   * - Chỉ 5 trường: fullName, employeeCode, phoneNumber, positionTitle, departmentId.
   *   Email/username/role/account_status/password/avatar KHÔNG thuộc UC-09.
   * - Actor: SYSTEM_ADMIN (không scope) + BUSINESS_ADMIN (giới hạn department scope,
   *   kiểm cả target user lẫn department mới).
   * - Diff-based: chỉ trường khác giá trị cũ mới được ghi; diff rỗng -> no-op (không audit).
   * - Audit ghi ATOMIC trong transaction (chỉ log các trường đã đổi).
   * - Response tái dùng UserDetailResponseDto, lắp bằng re-query inline (khớp getUserDetail).
   */
  async updateUser(
    targetUserId: string,
    dto: UpdateUserDto,
    actorId: string,
    clientContext: UserClientContext,
  ): Promise<UserDetailResponseDto> {
    let ACTION_TYPE = 'ACCOUNT_UPDATE';
    const em = this.dataSource.manager;

    // ── Phase A — Validate (ngoài transaction) ──

    // A.1 Empty update -> 400
    const hasAnyField =
      dto.fullName !== undefined ||
      dto.employeeCode !== undefined ||
      dto.phoneNumber !== undefined ||
      dto.positionTitle !== undefined ||
      dto.departmentId !== undefined ||
      dto.accountExpiresAt !== undefined;
    if (!hasAnyField) {
      throw new BadRequestException({
        success: false,
        message: 'Không có thông tin nào để cập nhật.',
        error: { code: 'EMPTY_UPDATE', details: {} },
      });
    }

    // A.2 Load target (chưa soft-delete)
    const targetUser = await em.findOne(UserEntity, {
      where: { id: targetUserId, deletedAt: IsNull() },
    });
    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    // PTA-001: accountExpiresAt chi admin co account.partner.manage moi duoc chinh,
    // và chỉ áp dụng cho tài khoản thuộc department "Đối tác".
    if (dto.accountExpiresAt !== undefined) {
      const { permissions } =
        await this.authzReadRepository.getEffectiveRolesAndPermissions(actorId);
      if (!permissions.includes('account.partner.manage')) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền quản lý tài khoản đối tác.',
          error: { code: 'FORBIDDEN', details: {} },
        });
      }
      if (!isPartnerAccount(targetUser.departmentId)) {
        throw new ForbiddenException({
          success: false,
          message: 'accountExpiresAt chỉ áp dụng cho tài khoản đối tác.',
          error: { code: 'ACCOUNT_EXPIRY_PARTNER_ONLY', details: {} },
        });
      }
    }
    // A.3 Xác định System Admin & department scope của target
    const actorRoles = await em.find(UserRoleEntity, {
      where: { userId: actorId, isActive: true },
      relations: { role: true },
    });
    const isSystemAdmin = actorRoles.some(
      (ur) => ur.role?.isSystemRole === true,
    );

    let scope: Set<string> | null = null;
    if (!isSystemAdmin) {
      scope = await this.resolveDepartmentScope(actorId);
      if (targetUser.departmentId && !scope.has(targetUser.departmentId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền cập nhật hồ sơ của nhân sự này.',
          error: { code: 'FORBIDDEN', details: {} },
        });
      }
    }

    // A.5 Tính diff (chỉ trường có mặt & khác giá trị cũ; string -> trim, nullable -> '' thành null)
    const changed: Partial<
      Pick<
        UserEntity,
        | 'fullName'
        | 'employeeCode'
        | 'phoneNumber'
        | 'positionTitle'
        | 'departmentId'
        | 'accountExpiresAt'
      >
    > = {};
    const oldValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};

    if (dto.fullName !== undefined) {
      const next = dto.fullName.trim();
      if (next !== targetUser.fullName) {
        changed.fullName = next;
        oldValues.fullName = targetUser.fullName;
        newValues.fullName = next;
      }
    }
    if (dto.employeeCode !== undefined) {
      const next = dto.employeeCode.trim() || null;
      if (next !== targetUser.employeeCode) {
        changed.employeeCode = next;
        oldValues.employeeCode = targetUser.employeeCode;
        newValues.employeeCode = next;
      }
    }
    if (dto.phoneNumber !== undefined) {
      const next = dto.phoneNumber.trim() || null;
      if (next !== targetUser.phoneNumber) {
        changed.phoneNumber = next;
        oldValues.phoneNumber = targetUser.phoneNumber;
        newValues.phoneNumber = next;
      }
    }
    if (dto.positionTitle !== undefined) {
      const next = dto.positionTitle.trim() || null;
      if (next !== targetUser.positionTitle) {
        changed.positionTitle = next;
        oldValues.positionTitle = targetUser.positionTitle;
        newValues.positionTitle = next;
      }
    }
    // departmentId: chỉ hỗ trợ đổi sang department khác (không hỗ trợ clear = null trong UC-09)
    if (typeof dto.departmentId === 'string') {
      if (dto.departmentId !== targetUser.departmentId) {
        changed.departmentId = dto.departmentId;
        oldValues.departmentId = targetUser.departmentId;
        newValues.departmentId = dto.departmentId;
      }
    }

    // PTA-001: gia hạn / khoá sớm tài khoản đối tác.
    if (dto.accountExpiresAt !== undefined) {
      const next = new Date(dto.accountExpiresAt);
      if (Number.isNaN(next.getTime())) {
        throw new BadRequestException({
          success: false,
          message: 'accountExpiresAt không hợp lệ',
          error: { code: 'INVALID_ACCOUNT_EXPIRES_AT', details: {} },
        });
      }
      const current = targetUser.accountExpiresAt
        ? targetUser.accountExpiresAt.getTime()
        : null;
      if (current !== next.getTime()) {
        changed.accountExpiresAt = next;
        oldValues.accountExpiresAt = targetUser.accountExpiresAt
          ? targetUser.accountExpiresAt.toISOString()
          : null;
        newValues.accountExpiresAt = next.toISOString();
        // "Khoá sớm" = hạn mới đã ở quá khứ/hiện tại, HOẶC hạn mới sớm hơn hạn cũ
        // (dù vẫn còn ở tương lai) — so với giá trị CŨ, không chỉ so với now().
        const isAlreadyExpired = next.getTime() <= Date.now();
        const isEarlierThanBefore =
          current !== null && next.getTime() < current;
        ACTION_TYPE =
          isAlreadyExpired || isEarlierThanBefore
            ? 'account.partner.lock_early'
            : 'account.partner.extend';
      }
    }
    // A.4 Validate các trường đã đổi
    // employee_code UNIQUE loại self
    if (changed.employeeCode) {
      const dup = await em.findOne(UserEntity, {
        where: {
          employeeCode: changed.employeeCode,
          deletedAt: IsNull(),
          id: Not(targetUserId),
        },
      });
      if (dup) {
        throw new ConflictException({
          success: false,
          message: 'Mã nhân viên này đã được đăng ký bởi tài khoản khác.',
          error: {
            code: 'ACCOUNT_EMPLOYEE_CODE_ALREADY_EXISTS',
            details: { employeeCode: changed.employeeCode },
          },
        });
      }
    }
    // department tồn tại + active + trong scope
    if (changed.departmentId) {
      const department = await em.findOne(DepartmentEntity, {
        where: { id: changed.departmentId, deletedAt: IsNull() },
      });
      if (!department) {
        throw new NotFoundException({
          success: false,
          message: 'Phòng ban được chỉ định không tồn tại.',
          error: {
            code: 'DEPARTMENT_NOT_FOUND',
            details: { departmentId: changed.departmentId },
          },
        });
      }
      if (!department.isActive) {
        throw new UnprocessableEntityException({
          success: false,
          message: 'Phòng ban được chỉ định không hoạt động hoặc đã bị xóa.',
          error: {
            code: 'DEPARTMENT_INACTIVE_OR_DELETED',
            details: { departmentId: changed.departmentId },
          },
        });
      }
      if (!isSystemAdmin && scope && !scope.has(changed.departmentId)) {
        throw new ForbiddenException({
          success: false,
          message:
            'Bạn không có quyền chuyển nhân sự sang phòng ban ngoài phạm vi quản lý.',
          error: { code: 'FORBIDDEN', details: {} },
        });
      }
    }

    // A.6 No-op — không có thay đổi thực chất: không WRITE/không audit
    // (map trả về ở cuối cho cả 2 nhánh)

    // ── Phase B — Transaction (atomic: users + audit) ──
    if (Object.keys(changed).length > 0) {
      await this.dataSource.transaction(async (tem) => {
        await tem.update(UserEntity, targetUserId, changed);

        const auditLog = tem.create(AuditLogEntity, {
          userId: actorId,
          actionType: ACTION_TYPE,
          entityType: 'users',
          entityId: targetUserId,
          severity: AuditLogSeverity.INFO,
          oldValueJson: oldValues,
          newValueJson: newValues,
          ipAddress: clientContext.ipAddress || null,
          userAgent: clientContext.userAgent || null,
          requestId: clientContext.requestId || null,
        });
        await tem.save(AuditLogEntity, auditLog);
      });
    }

    // ── Re-query INLINE map -> UserDetailResponseDto (khớp shape getUserDetail) ──
    const rm = this.dataSource.manager;

    const fresh = await rm.findOne(UserEntity, {
      where: { id: targetUserId, deletedAt: IsNull() },
      relations: { department: true },
    });
    if (!fresh) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    const freshRoles = await rm.find(UserRoleEntity, {
      where: { userId: targetUserId, isActive: true },
      relations: { role: true },
    });
    const rolesDto: RoleInfoDto[] = freshRoles.map((ur) => ({
      id: ur.role.id,
      roleCode: ur.role.roleCode,
      roleName: ur.role.roleName,
    }));

    let directManagerDto: DirectManagerInfoDto | null = null;
    if (fresh.directManagerId) {
      const manager = await rm.findOne(UserEntity, {
        where: { id: fresh.directManagerId },
        select: { id: true, fullName: true },
      });
      if (manager) {
        directManagerDto = { id: manager.id, fullName: manager.fullName };
      }
    }

    const faceProfileRows = await rm.find(FaceProfileEntity, {
      where: { userId: targetUserId },
    });
    const biometricResolution = resolveBiometricReviewStatus(
      faceProfileRows.map(
        (p): FaceProfileStatusRow => ({
          status: p.status,
          lastUpdatedAt: p.lastUpdatedAt,
          enrolledAt: p.enrolledAt,
        }),
      ),
    );

    let departmentDto: DepartmentInfoDto | null = null;
    if (fresh.department) {
      departmentDto = {
        id: fresh.department.id,
        departmentName: fresh.department.departmentName,
      };
    }

    return {
      id: fresh.id,
      employeeCode: fresh.employeeCode,
      email: fresh.email,
      fullName: fresh.fullName,
      phoneNumber: fresh.phoneNumber,
      avatarUrl: fresh.avatarUrl,
      positionTitle: fresh.positionTitle,
      department: departmentDto,
      directManager: directManagerDto,
      accountStatus: fresh.accountStatus,
      employmentStatus: fresh.employmentStatus,
      mustChangePassword: fresh.mustChangePassword,
      lastLoginAt: fresh.lastLoginAt ? fresh.lastLoginAt.toISOString() : null,
      roles: rolesDto,
      hasFaceProfile: faceProfileRows.length > 0,
      biometricReviewStatus: biometricResolution.biometricReviewStatus,
      accountExpiresAt: fresh.accountExpiresAt
        ? fresh.accountExpiresAt.toISOString()
        : null,
      createdAt: fresh.createdAt.toISOString(),
    };
  }

  async getUserDetail(
    targetUserId: string,
    authenticatedUserId: string,
    clientContext?: UserClientContext,
  ): Promise<UserDetailResponseDto> {
    const em = this.dataSource.manager;

    // 1. Fetch target user with department relation
    const targetUser = await em.findOne(UserEntity, {
      where: { id: targetUserId, deletedAt: IsNull() },
      relations: { department: true },
    });

    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    // 2. Determine authenticated user's role
    const authUserRoles = await em.find(UserRoleEntity, {
      where: { userId: authenticatedUserId, isActive: true },
      relations: { role: true },
    });

    const isSystemAdmin = authUserRoles.some(
      (ur) => ur.role?.isSystemRole === true,
    );

    // 3. Department scope check (only for Business Admin, skip self-view)
    if (!isSystemAdmin && targetUserId !== authenticatedUserId) {
      const scope = await this.resolveDepartmentScope(authenticatedUserId);

      if (targetUser.departmentId && !scope.has(targetUser.departmentId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền xem hồ sơ của nhân sự này.',
          error: { code: 'FORBIDDEN', details: {} },
        });
      }
    }

    // 4. Fetch active roles of target user
    const targetUserRoles = await em.find(UserRoleEntity, {
      where: { userId: targetUserId, isActive: true },
      relations: { role: true },
    });

    const rolesDto: RoleInfoDto[] = targetUserRoles.map((ur) => ({
      id: ur.role.id,
      roleCode: ur.role.roleCode,
      roleName: ur.role.roleName,
    }));

    // 5. Fetch direct manager info
    let directManagerDto: DirectManagerInfoDto | null = null;
    if (targetUser.directManagerId) {
      const manager = await em.findOne(UserEntity, {
        where: { id: targetUser.directManagerId },
        select: { id: true, fullName: true },
      });
      if (manager) {
        directManagerDto = {
          id: manager.id,
          fullName: manager.fullName,
        };
      }
    }

    // 6. Fetch face profile rows + resolve biometric review status (BR-004)
    const faceProfileRows = await em.find(FaceProfileEntity, {
      where: { userId: targetUserId },
    });
    const biometricResolution = resolveBiometricReviewStatus(
      faceProfileRows.map(
        (p): FaceProfileStatusRow => ({
          status: p.status,
          lastUpdatedAt: p.lastUpdatedAt,
          enrolledAt: p.enrolledAt,
        }),
      ),
    );

    // 7. Assemble department info
    let departmentDto: DepartmentInfoDto | null = null;
    if (targetUser.department) {
      departmentDto = {
        id: targetUser.department.id,
        departmentName: targetUser.department.departmentName,
      };
    }

    // 8. Assemble response DTO
    const response: UserDetailResponseDto = {
      id: targetUser.id,
      employeeCode: targetUser.employeeCode,
      email: targetUser.email,
      fullName: targetUser.fullName,
      phoneNumber: targetUser.phoneNumber,
      avatarUrl: targetUser.avatarUrl,
      positionTitle: targetUser.positionTitle,
      department: departmentDto,
      directManager: directManagerDto,
      accountStatus: targetUser.accountStatus,
      employmentStatus: targetUser.employmentStatus,
      mustChangePassword: targetUser.mustChangePassword,
      lastLoginAt: targetUser.lastLoginAt
        ? targetUser.lastLoginAt.toISOString()
        : null,
      roles: rolesDto,
      hasFaceProfile: faceProfileRows.length > 0,
      biometricReviewStatus: biometricResolution.biometricReviewStatus,
      accountExpiresAt: targetUser.accountExpiresAt
        ? targetUser.accountExpiresAt.toISOString()
        : null,
      createdAt: targetUser.createdAt.toISOString(),
    };

    // 9. Write audit log (non-blocking)
    try {
      const auditLog = em.create(AuditLogEntity, {
        userId: authenticatedUserId,
        actionType: 'view_detail',
        entityType: 'users',
        entityId: targetUserId,
        severity: AuditLogSeverity.INFO,
        ipAddress: clientContext?.ipAddress || null,
        userAgent: clientContext?.userAgent || null,
        requestId: clientContext?.requestId || null,
        newValueJson: {
          actorId: authenticatedUserId,
          targetId: targetUserId,
          timestamp: new Date().toISOString(),
        },
      });
      await em.save(AuditLogEntity, auditLog);
    } catch (auditError) {
      this.logger.error(
        `Failed to save audit log for view_detail of ${targetUserId}: ${(auditError as Error).message}`,
        (auditError as Error).stack,
      );
    }

    return response;
  }

  async getPublicProfile(
    targetUserId: string,
  ): Promise<UserPublicProfileResponseDto> {
    const em = this.dataSource.manager;

    const targetUser = await em.findOne(UserEntity, {
      where: { id: targetUserId, deletedAt: IsNull() },
      relations: { department: true },
    });

    if (!targetUser) {
      throw new NotFoundException({
        success: false,
        message: 'Không tìm thấy tài khoản.',
        error: { code: 'USER_NOT_FOUND', details: {} },
      });
    }

    return {
      id: targetUser.id,
      fullName: targetUser.fullName,
      email: targetUser.email,
      employeeCode: targetUser.employeeCode,
      department: targetUser.department
        ? {
            id: targetUser.department.id,
            departmentName: targetUser.department.departmentName,
          }
        : null,
      avatarUrl: targetUser.avatarUrl,
    };
  }

  async listUsers(
    query: ListUsersQueryDto,
  ): Promise<{ data: UserListItemDto[]; total: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const search = query.search?.trim();

    // UC-13: search khớp fullName / email / employee_code (OR), luôn giữ
    // ACTIVE + deletedAt IS NULL (không lộ tài khoản INACTIVE/đã xóa).
    const qb = this.dataSource
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .where('u.deletedAt IS NULL')
      .andWhere('u.accountStatus = :status', { status: AccountStatus.ACTIVE })
      // Tài khoản khách ẩn (VIS-BE-001) không phải nhân sự: không hiện trong danh sách/autocomplete.
      .andWhere('(u.departmentId IS NULL OR u.departmentId <> :visitorDept)', { visitorDept: VISITOR_DEPARTMENT_ID });

    if (search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('u.fullName ILIKE :s', { s: `%${search}%` })
            .orWhere('u.email ILIKE :s', { s: `%${search}%` })
            .orWhere('u.employeeCode ILIKE :s', { s: `%${search}%` });
        }),
      );
    }

    // [2026-08-21] Chặn BA/SA khỏi autocomplete mời họp — chỉ áp dụng khi caller
    // khai báo rõ ngữ cảnh chọn participant cuộc họp (meetingEligibleOnly=true),
    // không đổi hành vi mặc định vì endpoint còn dùng chung cho nhiều autocomplete
    // khác. Xem common/utils/meeting-ineligible-roles.util.ts.
    if (query.meetingEligibleOnly) {
      qb.andWhere(
        `NOT EXISTS (
          SELECT 1 FROM user_roles ur
          INNER JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = u.id
            AND ur.is_active = true
            AND (ur.expired_at IS NULL OR ur.expired_at > NOW())
            AND r.role_code IN (:...ineligibleRoles)
        )`,
        { ineligibleRoles: MEETING_INELIGIBLE_ROLE_CODES },
      );
    }

    qb.select([
      'u.id',
      'u.fullName',
      'u.email',
      'u.employeeCode',
      'u.avatarUrl',
    ])
      .orderBy('u.fullName', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [entities, total] = await qb.getManyAndCount();

    // [FIX 2026-08-17] Batch hasFaceProfile (1 query cho cả trang — tránh N+1),
    // mirror ĐÚNG pattern "Batch roles" ở listUsersForManagement bên dưới. Chỉ
    // status=ACTIVE (ảnh đã duyệt, dùng được để enroll — khác hasFaceProfile ở
    // UserDetailResponseDto, xem comment trong UserListItemDto).
    const userIds = entities.map((u) => u.id);
    const activeFaceProfileUserIds = new Set<string>();
    if (userIds.length > 0) {
      const activeProfiles = await this.dataSource
        .getRepository(FaceProfileEntity)
        .createQueryBuilder('fp')
        .select('fp.userId', 'userId')
        .where('fp.userId IN (:...userIds)', { userIds })
        .andWhere('fp.status = :status', { status: FaceProfileStatus.ACTIVE })
        .getRawMany<{ userId: string }>();
      for (const row of activeProfiles) {
        activeFaceProfileUserIds.add(row.userId);
      }
    }

    const data: UserListItemDto[] = entities.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      employeeCode: u.employeeCode,
      avatarUrl: u.avatarUrl,
      hasFaceProfile: activeFaceProfileUserIds.has(u.id),
    }));

    return { data, total };
  }

  /**
   * UC-14 — Lọc danh sách tài khoản (endpoint quản trị GET /users/manage).
   *
   * ENDPOINT TÁCH RIÊNG với listUsers (autocomplete) — KHÔNG đụng listUsers.
   * - Filter optional AND: departmentId, roleId (subquery), accountStatus, search (ILIKE).
   * - Mặc định chỉ deleted_at IS NULL (mọi trạng thái); accountStatus chỉ lọc khi truyền.
   * - Business Admin giới hạn department scope; System Admin không scope.
   * - Sort qua SORT_MAP allowlist (chống inject). roles[] lấy bằng batch query (tránh N+1).
   */
  async listUsersForManagement(
    query: ManageUsersQueryDto,
    actorId: string,
  ): Promise<{ data: ManageUserItemDto[]; total: number }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const search = query.search?.trim();
    const now = new Date();

    // ── A. Department scope ──
    const actorRoles = await this.dataSource.manager.find(UserRoleEntity, {
      where: { userId: actorId, isActive: true },
      relations: { role: true },
    });
    const isSystemAdmin = actorRoles.some(
      (ur) => ur.role?.isSystemRole === true,
    );

    let scopeIds: string[] | null = null;
    if (!isSystemAdmin) {
      const scope = await this.resolveDepartmentScope(actorId);
      if (query.departmentId && !scope.has(query.departmentId)) {
        throw new ForbiddenException({
          success: false,
          message: 'Bạn không có quyền xem tài khoản ngoài phạm vi quản lý.',
          error: { code: 'FORBIDDEN', details: {} },
        });
      }
      if (scope.size === 0) {
        return { data: [], total: 0 };
      }
      scopeIds = [...scope];
    }

    // ── B. Query builder (base + filters + sort + pagination) ──
    const qb = this.dataSource
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .where('u.deletedAt IS NULL')
      // Tài khoản khách ẩn (VIS-BE-001) không phải nhân sự.
      .andWhere('(u.departmentId IS NULL OR u.departmentId <> :visitorDept)', { visitorDept: VISITOR_DEPARTMENT_ID });

    if (scopeIds) {
      qb.andWhere('u.departmentId IN (:...scopeIds)', { scopeIds });
    }
    if (query.departmentId) {
      qb.andWhere('u.departmentId = :departmentId', {
        departmentId: query.departmentId,
      });
    }
    if (query.accountStatus === 'expired') {
      // 'expired' là filter ảo: tài khoản đối tác accountStatus vẫn 'active' trong
      // DB nhưng accountExpiresAt đã qua (login đã bị chặn — xem LoginService).
      qb.andWhere('u.accountStatus = :activeStatus', {
        activeStatus: 'active',
      })
        .andWhere('u.accountExpiresAt IS NOT NULL')
        .andWhere('u.accountExpiresAt <= :now', { now });
    } else if (query.accountStatus) {
      qb.andWhere('u.accountStatus = :accountStatus', {
        accountStatus: query.accountStatus,
      });
    }
    if (query.roleId) {
      // Subquery (KHÔNG innerJoin) để không nhân dòng làm sai total/pagination.
      qb.andWhere(
        'u.id IN (SELECT ur.user_id FROM user_roles ur WHERE ur.role_id = :roleId AND ur.is_active = true AND (ur.expired_at IS NULL OR ur.expired_at > :now))',
        { roleId: query.roleId, now },
      );
    }
    if (search) {
      qb.andWhere(
        new Brackets((w) => {
          w.where('u.fullName ILIKE :s', { s: `%${search}%` })
            .orWhere('u.email ILIKE :s', { s: `%${search}%` })
            .orWhere('u.employeeCode ILIKE :s', { s: `%${search}%` });
        }),
      );
    }

    // Sort qua allowlist SORT_MAP (KHÔNG đưa input trực tiếp vào orderBy).
    const SORT_MAP: Record<string, string> = {
      fullName: 'u.fullName',
      email: 'u.email',
      employeeCode: 'u.employeeCode',
      accountStatus: 'u.accountStatus',
      createdAt: 'u.createdAt',
    };
    const sortColumn = SORT_MAP[query.sortBy ?? 'fullName'] ?? 'u.fullName';
    const sortDirection = (query.sortOrder ?? 'asc').toUpperCase() as
      | 'ASC'
      | 'DESC';

    qb.select([
      'u.id',
      'u.fullName',
      'u.email',
      'u.employeeCode',
      'u.accountStatus',
      'u.departmentId',
      'u.avatarUrl',
      'u.phoneNumber',
      'u.accountExpiresAt',
    ])
      .orderBy(sortColumn, sortDirection)
      .skip((page - 1) * limit)
      .take(limit);

    const [users, total] = await qb.getManyAndCount();

    // ── C. Batch roles (1 query cho cả trang — tránh N+1) ──
    const userIds = users.map((u) => u.id);
    const rolesMap = new Map<string, string[]>();
    if (userIds.length > 0) {
      const userRoles = await this.dataSource
        .getRepository(UserRoleEntity)
        .createQueryBuilder('ur')
        .innerJoinAndSelect('ur.role', 'r')
        .where('ur.userId IN (:...userIds)', { userIds })
        .andWhere('ur.isActive = true')
        .andWhere('(ur.expiredAt IS NULL OR ur.expiredAt > :now)', { now })
        .getMany();

      for (const ur of userRoles) {
        const list = rolesMap.get(ur.userId) ?? [];
        list.push(ur.role.roleCode);
        rolesMap.set(ur.userId, list);
      }
    }

    // ── D. Map output ──
    const data: ManageUserItemDto[] = users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      employeeCode: u.employeeCode,
      accountStatus: u.accountStatus,
      departmentId: u.departmentId,
      roles: rolesMap.get(u.id) ?? [],
      avatarUrl: u.avatarUrl,
      phoneNumber: u.phoneNumber,
      accountExpiresAt: u.accountExpiresAt
        ? u.accountExpiresAt.toISOString()
        : null,
    }));

    return { data, total };
  }

  private async resolveDepartmentScope(
    adminUserId: string,
  ): Promise<Set<string>> {
    const em = this.dataSource.manager;

    const admin = await em.findOne(UserEntity, {
      where: { id: adminUserId, deletedAt: IsNull() },
      select: { departmentId: true },
    });

    if (!admin || !admin.departmentId) {
      return new Set<string>();
    }

    const scope = new Set<string>();
    await this.collectDepartmentScope(em, admin.departmentId, scope, 0);

    return scope;
  }

  private async collectDepartmentScope(
    em: import('typeorm').EntityManager,
    deptId: string,
    scope: Set<string>,
    depth: number,
  ): Promise<void> {
    if (depth >= this.MAX_DEPARTMENT_SCOPE_DEPTH) {
      return;
    }

    scope.add(deptId);

    const children = await em.find(DepartmentEntity, {
      where: {
        parentDepartmentId: deptId,
        isActive: true,
      },
      select: { id: true },
    });

    for (const child of children) {
      await this.collectDepartmentScope(em, child.id, scope, depth + 1);
    }
  }
}
