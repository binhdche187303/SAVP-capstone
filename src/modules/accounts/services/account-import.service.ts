import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { DataSource, In, IsNull } from 'typeorm';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { randomUUID } from 'crypto';

import {
  UsersService,
  UserClientContext,
  ResolvedAccountData,
} from './users.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { buildAccountWelcomeEmail } from '../../mail/templates/builders.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import {
  UserEntity,
  AccountStatus,
  EmploymentStatus,
} from '../entities/user.entity.js';
import { DepartmentEntity } from '../entities/department.entity.js';
import { RoleEntity } from '../entities/role.entity.js';
import {
  FaceProfileEntity,
  FaceProfileStatus,
} from '../entities/face-profile.entity.js';
import {
  MediaFileEntity,
  MediaFileType,
} from '../../recording/entities/media-file.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { CloudinaryService } from '../../storage/cloudinary.service.js';
import { detectImageMimeType } from '../utils/image-magic-bytes.util.js';
import { generateFaceProfileCode } from '../utils/face-profile-code.util.js';
import { isBiometricExemptRole } from '../../../common/utils/biometric-exempt-roles.util.js';
import { VehicleRegistrationService } from '../../anpr/services/vehicle-registration.service.js';
import { normalizePlate } from '../../anpr/utils/normalize-plate.js';

import {
  MAX_IMPORT_ROWS,
  MAX_IMPORT_FILE_BYTES,
  MAX_BIOMETRIC_PHOTO_BYTES,
  MAX_PHOTOS_ZIP_BYTES,
  MAX_PHOTOS_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  XLSX_MIME,
  ROLE_CODES_SEPARATOR,
  IMPORT_ACCOUNTS_HEADERS,
  ImportAccountMode,
  ImportAccountRowStatus,
  ImportAccountRowReason,
  ImportAccountRequestError,
  ImportAccountBiometricStatus,
  ImportAccountVehiclePlateStatus,
} from '../constants/import-accounts.constants.js';
import {
  ImportAccountReportDto,
  ImportAccountRowResult,
} from '../dto/import-accounts-response.dto.js';

/** Ảnh sinh trắc học kèm import — khớp theo tên file gốc = employee_code. */
export interface UploadedAccountPhoto {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size: number;
}

interface ParsedAccountRow {
  row: number;
  fullName: string;
  email: string;
  departmentCode: string;
  roleCodes: string;
  employeeCode: string;
  phoneNumber: string;
  positionTitle: string;
  directManagerEmail: string;
  licensePlate: string;
}

interface AccountRowState {
  parsed: ParsedAccountRow;
  result: ImportAccountRowResult;
  resolved?: ResolvedAccountData;
  isError: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class AccountImportService {
  private readonly logger = new Logger(AccountImportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly usersService: UsersService,
    private readonly notificationsService: NotificationsService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly vehicleRegistrationService: VehicleRegistrationService,
  ) {}

  // ════════════════════════════════════════════════════════════════
  //  Template generation
  // ════════════════════════════════════════════════════════════════

  async generateTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SmartTracking System';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Accounts');
    sheet.columns = IMPORT_ACCOUNTS_HEADERS.map((header) => ({
      header,
      key: header,
      width: 26,
    }));
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDCE6F1' },
      };
      cell.border = { bottom: { style: 'thin' } };
    });

    sheet.addRow({
      full_name: 'Nguyen Van A',
      email: 'a@company.com',
      department_code: 'ENG',
      role_codes: 'EMPLOYEE',
      employee_code: 'EMP001',
      phone_number: '0900000001',
      position_title: 'Developer',
      direct_manager_email: 'lead@company.com',
      license_plate: '30A12345',
    });
    sheet.addRow({
      full_name: 'Tran Thi B',
      email: 'b@company.com',
      department_code: 'HR',
      role_codes: 'EMPLOYEE;MANAGER',
      employee_code: 'EMP002',
      phone_number: '',
      position_title: 'HR Lead',
      direct_manager_email: '',
      license_plate: '',
    });

    const guide = workbook.addWorksheet('Huong dan');
    guide.columns = [{ width: 26 }, { width: 72 }];
    const guideRows: [string, string][] = [
      ['Cột', 'Mô tả'],
      ['full_name', 'Bắt buộc: Họ tên'],
      ['email', 'Bắt buộc: Email đăng nhập (định danh tài khoản)'],
      ['department_code', 'Bắt buộc: Mã phòng ban (đang active)'],
      [
        'role_codes',
        `Bắt buộc: Mã vai trò, nhiều giá trị phân tách "${ROLE_CODES_SEPARATOR}"`,
      ],
      ['employee_code', 'Tùy chọn: Mã nhân viên (duy nhất nếu có)'],
      ['phone_number', 'Tùy chọn'],
      ['position_title', 'Tùy chọn: Chức danh'],
      ['direct_manager_email', 'Tùy chọn: Email người quản lý trực tiếp'],
      [
        'license_plate',
        'Tùy chọn: Biển số xe (6-10 ký tự chữ-số, vd 30A12345). Không bắt buộc, không làm lỗi dòng nếu sai.',
      ],
    ];
    guideRows.forEach((r, idx) => {
      const row = guide.addRow(r);
      if (idx === 0) row.font = { bold: true };
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ════════════════════════════════════════════════════════════════
  //  Import orchestration
  // ════════════════════════════════════════════════════════════════

  async importAccounts(
    file:
      | {
          buffer: Buffer;
          mimetype?: string;
          size?: number;
          originalname?: string;
        }
      | undefined,
    options: { commit?: boolean; biometricConsentConfirmed?: boolean },
    actor: { userId: string },
    clientContext: UserClientContext,
    photos: UploadedAccountPhoto[] = [],
    photosZipFile?: {
      buffer: Buffer;
      size?: number;
      originalname?: string;
    },
  ): Promise<ImportAccountReportDto> {
    // ── Step 0: File validation ──
    this.validateFile(file);

    // ── Step 0a: Ảnh sinh trắc học kèm theo — có thể gửi rời (`photos[]`) và/hoặc
    // gộp trong 1 file .zip (`photosZip`, mỗi entry khớp tên y hệt `photos[]`).
    const allPhotos = photosZipFile
      ? photos.concat(await this.extractPhotosFromZip(photosZipFile))
      : photos;

    // ── Step 0b: Sinh trắc học kèm theo (tùy chọn) — bắt buộc xác nhận consent
    // khi commit thật, KHÔNG chặn ở preview vì preview chưa đụng gì tới ảnh.
    if (
      allPhotos.length > 0 &&
      options.commit === true &&
      options.biometricConsentConfirmed !== true
    ) {
      throw new BadRequestException({
        success: false,
        message:
          'Vui lòng xác nhận đã có sự đồng ý của nhân viên trước khi đính kèm ảnh sinh trắc học.',
        error: {
          code: ImportAccountRequestError.BIOMETRIC_CONSENT_REQUIRED,
          details: {},
        },
      });
    }
    const photoMap = this.buildPhotoMap(allPhotos);

    // ── Step 1: Parse ──
    const rows = await this.parseWorkbook(file!.buffer);

    // ── Step 2: Static per-row validation ──
    const states: AccountRowState[] = rows.map((parsed) =>
      this.staticValidate(parsed),
    );

    // ── Step 2b: Phân quyền 2 tầng — chỉ SYSTEM_ADMIN được tạo tài khoản kèm role quản trị ──
    await this.assertNoAdminRoleGrant(states, actor.userId);

    // ── Step 3: Duplicate-in-file (email) ──
    this.detectDuplicateInFile(states);

    // ── Step 4: Batch resolve (department, role, duplicate-in-DB, manager) ──
    await this.resolveRows(states);

    // ── Step 5: Preview gate ──
    if (options.commit !== true) {
      for (const s of states) {
        if (s.isError) continue;
        if (allPhotos.length > 0) {
          s.result.biometricStatus = this.previewBiometricStatus(s, photoMap);
        }
        const platePreview = this.previewVehiclePlateStatus(s);
        if (platePreview) {
          s.result.vehiclePlateStatus = platePreview;
        }
      }
      return new ImportAccountReportDto({
        mode: ImportAccountMode.PREVIEW,
        totalRows: states.length,
        validCount: states.filter((s) => !s.isError).length,
        invalidCount: states.filter((s) => s.isError).length,
        results: states.map((s) => s.result),
      });
    }

    // ── Step 6: Commit (per-row transaction) ──
    const created: Array<{
      email: string;
      fullName: string;
      tempPassword: string;
    }> = [];

    for (const state of states) {
      if (state.isError || !state.resolved) {
        state.result.status = ImportAccountRowStatus.FAILED;
        continue;
      }
      try {
        const persisted = await this.dataSource.transaction((em) =>
          this.usersService.persistAccount(
            em,
            state.resolved!,
            actor.userId,
            clientContext,
          ),
        );
        state.result.status = ImportAccountRowStatus.SUCCESS;
        state.result.userId = persisted.user.id;
        state.result.reason = undefined;
        created.push({
          email: state.resolved.email,
          fullName: state.resolved.fullName,
          tempPassword: persisted.tempPassword,
        });

        // Đính ảnh sinh trắc học (nếu có gửi kèm) — KHÔNG được để lỗi ở đây
        // làm rớt xuống catch bên dưới và ghi đè trạng thái SUCCESS của tài
        // khoản vừa tạo thành công (attachBiometricPhoto tự bắt hết lỗi).
        if (allPhotos.length > 0) {
          state.result.biometricStatus = await this.resolveBiometricForRow(
            state,
            persisted.user.id,
            photoMap,
            actor.userId,
          );
        }

        // Đăng ký hộ biển số xe (nếu dòng có điền `license_plate`) — best-effort
        // giống ảnh sinh trắc học: KHÔNG bao giờ làm fail tài khoản vừa tạo.
        if (state.parsed.licensePlate) {
          state.result.vehiclePlateStatus =
            await this.resolveVehiclePlateForRow(state, persisted.user.id);
        }
      } catch (error: unknown) {
        state.result.status = ImportAccountRowStatus.FAILED;
        state.result.reason = this.extractErrorCode(error);
        this.logger.error(
          `[AccountImport] Row ${state.result.row} failed: ${(error as Error).message}`,
        );
      }
    }

    // ── Step 7: Email credentials (best-effort, per-user) ──
    for (const acc of created) {
      await this.enqueueCredentialEmail(acc, actor.userId);
    }

    // ── Step 8: Audit tổng + return ──
    const successCount = states.filter(
      (s) => s.result.status === ImportAccountRowStatus.SUCCESS,
    ).length;
    const failedCount = states.filter(
      (s) => s.result.status === ImportAccountRowStatus.FAILED,
    ).length;

    await this.writeImportAudit(actor.userId, clientContext, {
      totalRows: states.length,
      successCount,
      failedCount,
    });

    return new ImportAccountReportDto({
      mode: ImportAccountMode.COMMIT,
      totalRows: states.length,
      successCount,
      failedCount,
      results: states.map((s) => s.result),
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  Helpers
  // ════════════════════════════════════════════════════════════════

  private validateFile(
    file:
      | {
          buffer: Buffer;
          mimetype?: string;
          size?: number;
          originalname?: string;
        }
      | undefined,
  ): void {
    if (!file || !file.buffer) {
      throw new BadRequestException({
        success: false,
        message:
          'Tệp không đúng định dạng hoặc vượt quá dung lượng cho phép. Vui lòng thử lại.',
        error: {
          code: ImportAccountRequestError.INVALID_FILE_FORMAT,
          details: {},
        },
      });
    }
    const isXlsxMime = file.mimetype === XLSX_MIME;
    const isXlsxName = (file.originalname ?? '')
      .toLowerCase()
      .endsWith('.xlsx');
    if (!isXlsxMime && !isXlsxName) {
      throw new BadRequestException({
        success: false,
        message:
          'Tệp không đúng định dạng hoặc vượt quá dung lượng cho phép. Vui lòng thử lại.',
        error: {
          code: ImportAccountRequestError.INVALID_FILE_FORMAT,
          details: {},
        },
      });
    }
    if ((file.size ?? file.buffer.length) > MAX_IMPORT_FILE_BYTES) {
      throw new BadRequestException({
        success: false,
        message:
          'Tệp không đúng định dạng hoặc vượt quá dung lượng cho phép. Vui lòng thử lại.',
        error: {
          code: ImportAccountRequestError.FILE_TOO_LARGE,
          details: { maxBytes: MAX_IMPORT_FILE_BYTES },
        },
      });
    }
  }

  private async parseWorkbook(buffer: Buffer): Promise<ParsedAccountRow[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException({
        success: false,
        message: 'Không đọc được tệp Excel',
        error: {
          code: ImportAccountRequestError.INVALID_FILE_FORMAT,
          details: {},
        },
      });
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp Excel không có sheet dữ liệu',
        error: {
          code: ImportAccountRequestError.INVALID_TEMPLATE,
          details: {},
        },
      });
    }

    const headerRow = sheet.getRow(1);
    const actualHeaders = IMPORT_ACCOUNTS_HEADERS.map((_, idx) =>
      this.cellString(headerRow.getCell(idx + 1)).toLowerCase(),
    );
    const headerMatches = IMPORT_ACCOUNTS_HEADERS.every(
      (expected, idx) => actualHeaders[idx] === expected,
    );
    if (!headerMatches) {
      throw new BadRequestException({
        success: false,
        message: 'Sai cấu trúc header. Vui lòng tải lại tệp mẫu.',
        error: {
          code: ImportAccountRequestError.INVALID_TEMPLATE,
          details: { expectedHeaders: IMPORT_ACCOUNTS_HEADERS },
        },
      });
    }

    const rows: ParsedAccountRow[] = [];
    const lastRow = sheet.rowCount;
    for (let r = 2; r <= lastRow; r++) {
      const excelRow = sheet.getRow(r);
      const fullName = this.cellString(excelRow.getCell(1));
      const email = this.cellString(excelRow.getCell(2)).toLowerCase();
      const departmentCode = this.cellString(excelRow.getCell(3));
      const roleCodes = this.cellString(excelRow.getCell(4));
      const employeeCode = this.cellString(excelRow.getCell(5));
      const phoneNumber = this.cellString(excelRow.getCell(6));
      const positionTitle = this.cellString(excelRow.getCell(7));
      const directManagerEmail = this.cellString(
        excelRow.getCell(8),
      ).toLowerCase();
      const licensePlate = this.cellString(excelRow.getCell(9));

      if (
        !fullName &&
        !email &&
        !departmentCode &&
        !roleCodes &&
        !employeeCode &&
        !phoneNumber &&
        !positionTitle &&
        !directManagerEmail &&
        !licensePlate
      ) {
        continue;
      }

      rows.push({
        row: r,
        fullName,
        email,
        departmentCode,
        roleCodes,
        employeeCode,
        phoneNumber,
        positionTitle,
        directManagerEmail,
        licensePlate,
      });
    }

    if (rows.length === 0) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp không có dữ liệu',
        error: {
          code: ImportAccountRequestError.INVALID_TEMPLATE,
          details: {},
        },
      });
    }
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException({
        success: false,
        message: `Tệp vượt quá số dòng tối đa (${MAX_IMPORT_ROWS})`,
        error: {
          code: ImportAccountRequestError.IMPORT_ROW_LIMIT_EXCEEDED,
          details: { maxRows: MAX_IMPORT_ROWS, actual: rows.length },
        },
      });
    }

    return rows;
  }

  private staticValidate(parsed: ParsedAccountRow): AccountRowState {
    const result: ImportAccountRowResult = {
      row: parsed.row,
      email: parsed.email,
      status: ImportAccountRowStatus.VALID,
    };
    const state: AccountRowState = { parsed, result, isError: false };

    if (
      !parsed.fullName ||
      !parsed.email ||
      !parsed.departmentCode ||
      !parsed.roleCodes
    ) {
      return this.markError(
        state,
        ImportAccountRowReason.MISSING_REQUIRED_FIELD,
      );
    }
    if (!EMAIL_REGEX.test(parsed.email)) {
      return this.markError(state, ImportAccountRowReason.INVALID_EMAIL);
    }
    return state;
  }

  private detectDuplicateInFile(states: AccountRowState[]): void {
    const seen = new Set<string>();
    for (const s of states) {
      if (s.isError) continue;
      if (seen.has(s.parsed.email)) {
        this.markError(s, ImportAccountRowReason.DUPLICATE_IN_FILE);
      } else {
        seen.add(s.parsed.email);
      }
    }
  }

  private async resolveRows(states: AccountRowState[]): Promise<void> {
    const active = states.filter((s) => !s.isError);
    if (active.length === 0) return;

    // ── Resolve departments by code ──
    const deptCodes = [...new Set(active.map((s) => s.parsed.departmentCode))];
    const departments = await this.dataSource
      .getRepository(DepartmentEntity)
      .find({ where: { departmentCode: In(deptCodes), isActive: true } });
    const deptByCode = new Map(
      departments.map((d) => [d.departmentCode, d.id]),
    );

    // ── Resolve roles by code ──
    const allRoleCodes = [
      ...new Set(
        active.flatMap((s) => this.splitRoleCodes(s.parsed.roleCodes)),
      ),
    ];
    const roles = allRoleCodes.length
      ? await this.dataSource
          .getRepository(RoleEntity)
          .find({ where: { roleCode: In(allRoleCodes), isActive: true } })
      : [];
    const roleByCode = new Map(roles.map((r) => [r.roleCode, r.id]));

    // ── Duplicate-in-DB: email + employee_code ──
    const emails = active.map((s) => s.parsed.email);
    const existingEmailUsers = await this.dataSource
      .getRepository(UserEntity)
      .find({ where: { email: In(emails), deletedAt: IsNull() } });
    const existingEmails = new Set(
      existingEmailUsers.map((u) => u.email.toLowerCase()),
    );

    const empCodes = active
      .map((s) => s.parsed.employeeCode)
      .filter((c) => !!c);
    const existingCodeUsers = empCodes.length
      ? await this.dataSource
          .getRepository(UserEntity)
          .find({ where: { employeeCode: In(empCodes), deletedAt: IsNull() } })
      : [];
    const existingCodes = new Set(
      existingCodeUsers
        .map((u) => u.employeeCode)
        .filter((c): c is string => !!c),
    );

    // ── Resolve manager emails ──
    const managerEmails = [
      ...new Set(
        active.map((s) => s.parsed.directManagerEmail).filter((e) => !!e),
      ),
    ];
    const managers = managerEmails.length
      ? await this.dataSource.getRepository(UserEntity).find({
          where: { email: In(managerEmails), deletedAt: IsNull() },
        })
      : [];
    const managerByEmail = new Map(
      managers
        .filter(
          (m) =>
            m.accountStatus === AccountStatus.ACTIVE &&
            m.employmentStatus !== EmploymentStatus.RESIGNED,
        )
        .map((m) => [m.email.toLowerCase(), m.id]),
    );

    for (const s of active) {
      // Email already exists
      if (existingEmails.has(s.parsed.email)) {
        this.markError(s, ImportAccountRowReason.EMAIL_ALREADY_EXISTS);
        continue;
      }
      // Employee code already exists
      if (s.parsed.employeeCode && existingCodes.has(s.parsed.employeeCode)) {
        this.markError(s, ImportAccountRowReason.EMPLOYEE_CODE_ALREADY_EXISTS);
        continue;
      }
      // Department
      const departmentId = deptByCode.get(s.parsed.departmentCode);
      if (!departmentId) {
        this.markError(s, ImportAccountRowReason.DEPARTMENT_NOT_FOUND);
        continue;
      }
      // Roles
      const roleCodesList = this.splitRoleCodes(s.parsed.roleCodes);
      const roleIds: string[] = [];
      let roleError = false;
      for (const code of roleCodesList) {
        const roleId = roleByCode.get(code);
        if (!roleId) {
          roleError = true;
          break;
        }
        if (!roleIds.includes(roleId)) roleIds.push(roleId);
      }
      if (roleError || roleIds.length === 0) {
        this.markError(s, ImportAccountRowReason.ROLE_NOT_FOUND);
        continue;
      }
      // Manager (optional)
      let directManagerId: string | null = null;
      if (s.parsed.directManagerEmail) {
        const managerId = managerByEmail.get(s.parsed.directManagerEmail);
        if (!managerId) {
          this.markError(s, ImportAccountRowReason.MANAGER_NOT_FOUND);
          continue;
        }
        directManagerId = managerId;
      }

      s.resolved = {
        fullName: s.parsed.fullName,
        email: s.parsed.email,
        departmentId,
        roleIds,
        employeeCode: s.parsed.employeeCode || null,
        phoneNumber: s.parsed.phoneNumber || null,
        positionTitle: s.parsed.positionTitle || null,
        directManagerId,
      };
    }
  }

  private async enqueueCredentialEmail(
    acc: { email: string; fullName: string; tempPassword: string },
    creatorId: string,
  ): Promise<void> {
    const content = [
      'Kính gửi ' + acc.fullName + ',',
      '',
      'Tài khoản Smart Meeting của bạn đã được tạo thành công.',
      '',
      'Thông tin đăng nhập:',
      '- Email: ' + acc.email,
      '- Mật khẩu tạm thời: ' + acc.tempPassword,
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
        subject: 'Thông tin tài khoản Smart Meeting mới của bạn',
        content,
        emailHtml: buildAccountWelcomeEmail({
          fullName: acc.fullName,
          email: acc.email,
          tempPassword: acc.tempPassword,
        }),
        toEmails: [acc.email],
        relatedEntityType: 'users',
        recipientScope: 'user_list',
        createdBy: creatorId,
        payloadJson: {
          fullName: acc.fullName,
          username: acc.email,
          mustChangePassword: true,
          source: 'excel_import',
        },
      });
    } catch (err: unknown) {
      this.logger.error(
        `[AccountImport] Failed to enqueue credential email to ${acc.email}: ${(err as Error).message}`,
      );
    }
  }

  private async writeImportAudit(
    actorId: string,
    clientContext: UserClientContext,
    summary: { totalRows: number; successCount: number; failedCount: number },
  ): Promise<void> {
    try {
      await this.dataSource.manager.save(AuditLogEntity, {
        userId: actorId,
        actionType: 'ACCOUNT_IMPORT',
        entityType: 'users',
        severity: AuditLogSeverity.INFO,
        ipAddress: clientContext.ipAddress || null,
        userAgent: clientContext.userAgent || null,
        requestId: clientContext.requestId || null,
        newValueJson: summary,
      });
    } catch (err: unknown) {
      this.logger.error(
        `[AccountImport] Failed to write import audit: ${(err as Error).message}`,
      );
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Sinh trắc học kèm import (tùy chọn) — khớp ảnh theo employee_code
  // ════════════════════════════════════════════════════════════════

  /**
   * Gộp .zip ảnh sinh trắc học thành `UploadedAccountPhoto[]` — mỗi entry xử lý
   * y hệt 1 file trong `photos[]` (khớp theo basename ở `buildPhotoMap`).
   * Chặn zip bomb bằng tổng dung lượng ĐÃ giải nén (KHÔNG chỉ dựa vào kích thước
   * file .zip nén ban đầu). Bỏ qua thư mục con, file ẩn, và rác `__MACOSX/`.
   */
  private async extractPhotosFromZip(photosZipFile: {
    buffer: Buffer;
    size?: number;
    originalname?: string;
  }): Promise<UploadedAccountPhoto[]> {
    const size = photosZipFile.size ?? photosZipFile.buffer.length;
    if (size > MAX_PHOTOS_ZIP_BYTES) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp .zip ảnh sinh trắc học vượt quá dung lượng cho phép.',
        error: {
          code: ImportAccountRequestError.INVALID_PHOTOS_ZIP,
          details: { maxBytes: MAX_PHOTOS_ZIP_BYTES },
        },
      });
    }

    let zip: JSZip;
    try {
      zip = await JSZip.loadAsync(photosZipFile.buffer);
    } catch {
      throw new BadRequestException({
        success: false,
        message: 'Không đọc được tệp .zip ảnh sinh trắc học.',
        error: {
          code: ImportAccountRequestError.INVALID_PHOTOS_ZIP,
          details: {},
        },
      });
    }

    const entries = Object.values(zip.files).filter((f) => !f.dir);
    if (entries.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException({
        success: false,
        message: `Tệp .zip vượt quá số ảnh tối đa (${MAX_IMPORT_ROWS}).`,
        error: {
          code: ImportAccountRequestError.INVALID_PHOTOS_ZIP,
          details: { maxEntries: MAX_IMPORT_ROWS },
        },
      });
    }

    const photos: UploadedAccountPhoto[] = [];
    let totalUncompressed = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('__MACOSX/')) continue;
      const baseName = entry.name.split(/[\\/]/).pop() ?? '';
      if (!baseName || baseName.startsWith('.')) continue;

      const buffer = await entry.async('nodebuffer');
      totalUncompressed += buffer.length;
      if (totalUncompressed > MAX_PHOTOS_ZIP_TOTAL_UNCOMPRESSED_BYTES) {
        throw new BadRequestException({
          success: false,
          message:
            'Tổng dung lượng ảnh trong tệp .zip vượt quá giới hạn cho phép.',
          error: {
            code: ImportAccountRequestError.INVALID_PHOTOS_ZIP,
            details: { maxBytes: MAX_PHOTOS_ZIP_TOTAL_UNCOMPRESSED_BYTES },
          },
        });
      }

      photos.push({ buffer, originalname: baseName, size: buffer.length });
    }
    return photos;
  }

  /** Key = tên file gốc, bỏ đuôi mở rộng, lowercase, trim. */
  private buildPhotoMap(
    photos: UploadedAccountPhoto[],
  ): Map<string, UploadedAccountPhoto> {
    const map = new Map<string, UploadedAccountPhoto>();
    for (const photo of photos) {
      const base = (photo.originalname ?? '')
        .replace(/\.[^./\\]+$/, '')
        .trim()
        .toLowerCase();
      if (base) map.set(base, photo);
    }
    return map;
  }

  private matchPhotoForRow(
    state: AccountRowState,
    photoMap: Map<string, UploadedAccountPhoto>,
  ): UploadedAccountPhoto | null {
    const code = state.parsed.employeeCode?.trim().toLowerCase();
    if (!code) return null;
    return photoMap.get(code) ?? null;
  }

  /** Preview mode: chỉ báo trước sẽ khớp/không khớp, KHÔNG upload gì cả. */
  private previewBiometricStatus(
    state: AccountRowState,
    photoMap: Map<string, UploadedAccountPhoto>,
  ): ImportAccountBiometricStatus {
    const photo = this.matchPhotoForRow(state, photoMap);
    if (!photo) return ImportAccountBiometricStatus.NOT_PROVIDED;
    const roleCodes = this.splitRoleCodes(state.parsed.roleCodes);
    return isBiometricExemptRole(roleCodes)
      ? ImportAccountBiometricStatus.ROLE_EXEMPT
      : ImportAccountBiometricStatus.PENDING_COMMIT;
  }

  /** Commit mode: khớp ảnh rồi thực sự upload + tạo face_profiles nếu phù hợp. */
  private async resolveBiometricForRow(
    state: AccountRowState,
    userId: string,
    photoMap: Map<string, UploadedAccountPhoto>,
    actorId: string,
  ): Promise<ImportAccountBiometricStatus> {
    const photo = this.matchPhotoForRow(state, photoMap);
    if (!photo) return ImportAccountBiometricStatus.NOT_PROVIDED;

    const roleCodes = this.splitRoleCodes(state.parsed.roleCodes);
    if (isBiometricExemptRole(roleCodes)) {
      return ImportAccountBiometricStatus.ROLE_EXEMPT;
    }

    return this.attachBiometricPhoto(userId, photo, actorId);
  }

  /**
   * Upload ảnh + tạo media_files/face_profiles(status=pending_review), mirror
   * transaction pattern của `BiometricSubmissionService.submit` nhưng khởi tạo
   * bởi admin lúc import (enrolledBy=actorId, không phải chính user).
   *
   * KHÔNG bao giờ throw — mọi lỗi được bắt và trả về status code tương ứng,
   * vì tài khoản đã tạo thành công rồi và không được phép bị đổi thành FAILED
   * chỉ vì bước đính ảnh (phụ, không bắt buộc) gặp sự cố.
   */
  private async attachBiometricPhoto(
    userId: string,
    photo: UploadedAccountPhoto,
    actorId: string,
  ): Promise<ImportAccountBiometricStatus> {
    if (photo.size > MAX_BIOMETRIC_PHOTO_BYTES) {
      return ImportAccountBiometricStatus.FILE_TOO_LARGE;
    }

    const detectedMime = detectImageMimeType(photo.buffer);
    if (!detectedMime) {
      return ImportAccountBiometricStatus.INVALID_IMAGE;
    }

    let upload: { publicId: string; secureUrl: string };
    try {
      upload = await this.cloudinaryService.uploadImage(photo.buffer);
    } catch (error) {
      this.logger.error(
        `[AccountImport] Cloudinary upload failed for user ${userId}: ${(error as Error).message}`,
      );
      return ImportAccountBiometricStatus.UPLOAD_FAILED;
    }

    const now = new Date();
    const faceProfileId = randomUUID();
    const mediaFileId = randomUUID();

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(MediaFileEntity).insert({
          id: mediaFileId,
          fileName: upload.publicId.split('/').pop() ?? upload.publicId,
          fileType: MediaFileType.IMAGE,
          mimeType: detectedMime,
          storageProvider: this.cloudinaryService.resolveMediaStorageProvider(),
          storageKey: upload.publicId,
          fileUrl: upload.secureUrl,
          relatedEntityType: 'face_profile',
          relatedEntityId: faceProfileId,
          uploadedBy: actorId,
          isActive: true,
        });

        await manager.getRepository(FaceProfileEntity).insert({
          id: faceProfileId,
          userId,
          profileCode: generateFaceProfileCode(),
          status: FaceProfileStatus.PENDING_REVIEW,
          primaryImageFileId: mediaFileId,
          consentAt: now,
          enrolledBy: actorId,
          enrolledAt: now,
          lastUpdatedAt: now,
          sampleCount: 1,
          metadataJson: { source: 'excel_import' },
        });

        await manager.getRepository(AuditLogEntity).insert({
          userId,
          actionType: 'biometric.import_upload',
          entityType: 'face_profile',
          entityId: faceProfileId,
          newValueJson: {
            status: 'pending_review',
            mediaFileId,
            source: 'excel_import',
            enrolledBy: actorId,
          },
        });
      });
    } catch (error) {
      await this.cleanupCloudinary(upload.publicId);
      this.logger.error(
        `[AccountImport] Biometric attach DB transaction failed for user ${userId}: ${(error as Error).message}`,
      );
      return ImportAccountBiometricStatus.UPLOAD_FAILED;
    }

    return ImportAccountBiometricStatus.ATTACHED;
  }

  /** Best-effort xóa Cloudinary object orphan; KHÔNG ném lỗi ra ngoài. */
  private async cleanupCloudinary(publicId: string): Promise<void> {
    try {
      await this.cloudinaryService.deleteImage(publicId);
      this.logger.log(
        `[AccountImport] Cleaned up orphan Cloudinary object: ${publicId}`,
      );
    } catch (cleanupError) {
      this.logger.warn(
        `[AccountImport] Failed to clean up orphan Cloudinary object ${publicId}: ${(cleanupError as Error).message}`,
      );
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  Biển số xe kèm import (tùy chọn) — cột `license_plate`
  // ════════════════════════════════════════════════════════════════

  // Mirror validation của VehicleRegistrationService.isValidPlate (pure, KHÔNG
  // đụng DB) — chỉ dùng để báo trước ở preview, nguồn xác thực THẬT vẫn là
  // VehicleRegistrationService.register() lúc commit.
  private static readonly PLATE_FORMAT_RE = /^[0-9A-Z]+$/;
  private static readonly PLATE_MIN = 6;
  private static readonly PLATE_MAX = 10;

  private isPreviewValidPlate(raw: string): boolean {
    const plate = normalizePlate(raw);
    if (
      !AccountImportService.PLATE_FORMAT_RE.test(plate) ||
      plate.length < AccountImportService.PLATE_MIN ||
      plate.length > AccountImportService.PLATE_MAX
    ) {
      return false;
    }
    return /[A-Z]/.test(plate) && /[0-9]/.test(plate);
  }

  /** Preview mode: chỉ báo trước định dạng hợp lệ hay không, KHÔNG đụng DB. */
  private previewVehiclePlateStatus(
    state: AccountRowState,
  ): ImportAccountVehiclePlateStatus | undefined {
    const raw = state.parsed.licensePlate?.trim();
    if (!raw) return undefined;
    return this.isPreviewValidPlate(raw)
      ? ImportAccountVehiclePlateStatus.PENDING_COMMIT
      : ImportAccountVehiclePlateStatus.INVALID_PLATE;
  }

  /**
   * Commit mode: đăng ký hộ biển số qua VehicleRegistrationService.register()
   * (cùng logic normalize/validate/conflict với API admin thật). Best-effort —
   * KHÔNG bao giờ throw ra ngoài, tài khoản đã tạo thành công không được phép
   * bị đổi thành FAILED chỉ vì bước phụ này gặp lỗi.
   */
  private async resolveVehiclePlateForRow(
    state: AccountRowState,
    userId: string,
  ): Promise<ImportAccountVehiclePlateStatus> {
    const raw = state.parsed.licensePlate.trim();
    try {
      await this.vehicleRegistrationService.register(userId, {
        plateRaw: raw,
      });
      return ImportAccountVehiclePlateStatus.ATTACHED;
    } catch (error: unknown) {
      const code = this.extractVehicleErrorCode(error);
      if (code === 'PLATE_ALREADY_REGISTERED') {
        return ImportAccountVehiclePlateStatus.DUPLICATE_PLATE;
      }
      if (code === 'INVALID_PLATE') {
        return ImportAccountVehiclePlateStatus.INVALID_PLATE;
      }
      this.logger.error(
        `[AccountImport] Vehicle plate attach failed for user ${userId}: ${(error as Error).message}`,
      );
      return ImportAccountVehiclePlateStatus.ATTACH_FAILED;
    }
  }

  /** VehicleRegistrationService ném `{code, message}` trực tiếp trong response — khác format `{error:{code}}` của account import (xem extractErrorCode). */
  private extractVehicleErrorCode(error: unknown): string | undefined {
    return (error as { response?: { code?: string } })?.response?.code;
  }

  // ── Small utilities ──

  private async assertNoAdminRoleGrant(
    states: AccountRowState[],
    actorId: string,
  ): Promise<void> {
    const adminCodes = ['SYSTEM_ADMIN', 'BUSINESS_ADMIN'];
    const requested = states.some((s) =>
      this.splitRoleCodes(s.parsed.roleCodes ?? '').some((c) =>
        adminCodes.includes(c.toUpperCase()),
      ),
    );
    if (!requested) return;
    const rows: unknown[] = await this.dataSource.query(
      `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = $1 AND ur.is_active AND r.is_active
          AND r.role_code = 'SYSTEM_ADMIN' LIMIT 1`,
      [actorId],
    );
    if (rows.length > 0) return;
    throw new ForbiddenException({
      success: false,
      message: 'Chỉ Quản trị hệ thống được tạo tài khoản kèm vai trò quản trị.',
      error: { code: 'ADMIN_ROLE_GRANT_FORBIDDEN', details: {} },
    });
  }

  private splitRoleCodes(raw: string): string[] {
    return raw
      .split(ROLE_CODES_SEPARATOR)
      .map((c) => c.trim())
      .filter((c) => !!c);
  }

  private markError(
    state: AccountRowState,
    reason: ImportAccountRowReason,
  ): AccountRowState {
    state.isError = true;
    state.result.status = ImportAccountRowStatus.INVALID;
    state.result.reason = reason;
    return state;
  }

  private cellString(cell: ExcelJS.Cell | undefined): string {
    if (!cell) return '';
    // ExcelJS Cell.text trả về biểu diễn văn bản đã format (kể cả hyperlink/rich text).
    const text = cell.text;
    return (typeof text === 'string' ? text : '')
      .replace(/^mailto:/i, '')
      .trim();
  }

  private extractErrorCode(error: unknown): string {
    const resp = (error as { response?: { error?: { code?: string } } })
      ?.response;
    return resp?.error?.code ?? 'IMPORT_ROW_FAILED';
  }
}
