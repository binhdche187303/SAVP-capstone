import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DataSource, IsNull } from 'typeorm';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { randomUUID } from 'crypto';

import {
  UsersService,
  UserClientContext,
  ResolvedAccountData,
} from './users.service.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { buildPartnerAccountWelcomeEmail } from '../../mail/templates/builders.js';
import { formatDateTimeVN } from '../../mail/templates/layout.js';
import {
  NotificationType,
  NotificationChannel,
} from '../../notifications/entities/notification.entity.js';
import { DepartmentEntity } from '../entities/department.entity.js';
import { RoleEntity } from '../entities/role.entity.js';
import {
  AuditLogEntity,
  AuditLogSeverity,
} from '../../administration/entities/audit-log.entity.js';
import { CloudinaryService } from '../../storage/cloudinary.service.js';
import { detectImageMimeType } from '../utils/image-magic-bytes.util.js';
import {
  PARTNER_DEPARTMENT_CODE,
  resolvePartnerDepartmentId,
} from '../../../common/utils/partner-account.util.js';
import { VehicleRegistrationService } from '../../anpr/services/vehicle-registration.service.js';
import { normalizePlate } from '../../anpr/utils/normalize-plate.js';

import {
  MAX_PARTNER_IMPORT_ROWS,
  MAX_IMPORT_FILE_BYTES,
  MAX_BIOMETRIC_PHOTO_BYTES,
  MAX_PHOTOS_ZIP_BYTES,
  MAX_PHOTOS_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  IMPORT_PARTNER_HEADERS,
  ImportPartnerAccountMode,
  ImportPartnerAccountRowReason,
  ImportPartnerAccountRequestError,
} from '../constants/import-partner-accounts.constants.js';
import { ImportAccountVehiclePlateStatus } from '../constants/import-accounts.constants.js';
import {
  ImportPartnerAccountReportDto,
  ImportPartnerAccountRowResult,
} from '../dto/import-partner-accounts-response.dto.js';
import { ImportPartnerAccountsDto } from '../dto/import-partner-accounts.dto.js';

export interface UploadedAccountPhoto {
  buffer: Buffer;
  originalname: string;
  mimetype?: string;
  size: number;
}

interface ParsedPartnerRow {
  row: number;
  fullName: string;
  email: string;
  accountExpiresAtRaw: string;
  phoneNumber: string;
  licensePlate: string;
}

interface PartnerRowState {
  parsed: ParsedPartnerRow;
  result: ImportPartnerAccountRowResult;
  resolvedExpiresAt?: Date;
  isError: boolean;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Injectable()
export class PartnerAccountImportService {
  private readonly logger = new Logger(PartnerAccountImportService.name);

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

    const sheet = workbook.addWorksheet('Partners');
    sheet.columns = IMPORT_PARTNER_HEADERS.map((header) => ({
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
      full_name: 'Nguyen Van Khach',
      email: 'khach1@doitac-x.com',
      account_expires_at: '',
      phone_number: '0900000001',
      license_plate: '30A12345',
    });
    sheet.addRow({
      full_name: 'Tran Thi Khach',
      email: 'khach2@doitac-x.com',
      account_expires_at: '',
      phone_number: '',
      license_plate: '',
    });
    sheet.addRow({
      full_name: 'Le Van VIP',
      email: 'khach3@doitac-x.com',
      account_expires_at: new Date(Date.now() + 7 * 86400 * 1000).toISOString(),
      phone_number: '0900000003',
      license_plate: '',
    });

    const guideSheet = workbook.addWorksheet('Huong dan');
    guideSheet.columns = [
      { header: 'Cot', key: 'col', width: 22 },
      { header: 'Bắt buộc', key: 'req', width: 14 },
      { header: 'Mota', key: 'desc', width: 65 },
    ];
    const guideHeader = guideSheet.getRow(1);
    guideHeader.font = { bold: true };

    guideSheet.addRow({
      col: 'full_name',
      req: 'Bắt buộc',
      desc: 'Ho va ten doi tac / khach hang.',
    });
    guideSheet.addRow({
      col: 'email',
      req: 'Bắt buộc',
      desc: 'Địa chỉ email (được dùng làm tên đăng nhập và mật khẩu khởi tạo ban đầu).',
    });
    guideSheet.addRow({
      col: 'account_expires_at',
      req: 'Tuy chon',
      desc: 'Ngày hết hạn tài khoản (ISO date, vd: 2026-08-20T17:00:00Z). Nếu để trống, tài khoản sẽ dùng defaultExpiresInDays gửi từ request.',
    });
    guideSheet.addRow({
      col: 'phone_number',
      req: 'Tuy chon',
      desc: 'So dien thoại lien he.',
    });
    guideSheet.addRow({
      col: 'license_plate',
      req: 'Tuy chon',
      desc: 'Biển số xe đăng ký cho đối tác (vd: 30A12345). Không chặn tạo tài khoản nếu biển số sai hoặc trùng.',
    });
    guideSheet.addRow({
      col: '[ANH SINH TRAC HOC]',
      req: 'BẮT BUỘC',
      desc: 'Moi doi tac BAT BUOC co 1 anh khuon mat dinh kem. Dat ten file anh bang EMAIL cua doi tac (vd: khach1@doitac-x.com.jpg) va gop vao file .zip.',
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(buffer);
  }

  // ════════════════════════════════════════════════════════════════
  //  Main import logic
  // ════════════════════════════════════════════════════════════════

  async importPartnerAccounts(
    file: {
      buffer: Buffer;
      size?: number;
      mimetype?: string;
      originalname?: string;
    },
    photos: UploadedAccountPhoto[] = [],
    photosZipFile?: { buffer: Buffer; size?: number; originalname?: string },
    options: ImportPartnerAccountsDto = {},
    actor: { id: string } = { id: 'system' },
    clientContext?: UserClientContext,
  ): Promise<ImportPartnerAccountReportDto> {
    // Step 0: Request validation
    if (!file || !file.buffer) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp Excel không được để trống.',
        error: { code: ImportPartnerAccountRequestError.INVALID_FILE_FORMAT },
      });
    }

    const fileSize = file.size ?? file.buffer.length;
    if (fileSize > MAX_IMPORT_FILE_BYTES) {
      throw new BadRequestException({
        success: false,
        message: `Dung lượng tệp Excel vượt quá giới hạn cho phép (${MAX_IMPORT_FILE_BYTES / (1024 * 1024)}MB).`,
        error: {
          code: ImportPartnerAccountRequestError.FILE_TOO_LARGE,
          details: { maxBytes: MAX_IMPORT_FILE_BYTES, actualBytes: fileSize },
        },
      });
    }

    if (
      options.defaultExpiresInDays !== undefined &&
      (!Number.isInteger(options.defaultExpiresInDays) ||
        options.defaultExpiresInDays < 1)
    ) {
      throw new BadRequestException({
        success: false,
        message: 'defaultExpiresInDays phải là số nguyên lớn hơn hoặc bằng 1.',
        error: {
          code: ImportPartnerAccountRequestError.INVALID_DEFAULT_EXPIRES_IN_DAYS,
        },
      });
    }

    let allPhotos: UploadedAccountPhoto[] = Array.isArray(photos)
      ? [...photos]
      : [];
    if (photosZipFile) {
      const extractedZipPhotos = await this.extractPhotosFromZip(photosZipFile);
      allPhotos = allPhotos.concat(extractedZipPhotos);
    }
    const photoMap = this.buildPhotoMap(allPhotos);

    // Step 1: Parse Excel workbook
    const parsedRows = await this.parseWorkbook(file.buffer);

    // Step 2 & 3: Validate & Batch resolve
    const rowStates = await this.resolveAndValidateRows(
      parsedRows,
      photoMap,
      options,
    );

    const isCommitMode = options.commit === true;

    if (!isCommitMode) {
      // Step 4: Preview Gate
      const results: ImportPartnerAccountRowResult[] = rowStates.map(
        (state) => {
          if (state.isError) {
            return {
              row: state.parsed.row,
              email: state.parsed.email,
              status: 'invalid',
              reason: state.result.reason,
            };
          }
          return {
            row: state.parsed.row,
            email: state.parsed.email,
            status: 'valid',
            accountExpiresAt: state.resolvedExpiresAt?.toISOString(),
            vehiclePlateStatus: state.parsed.licensePlate
              ? normalizePlate(state.parsed.licensePlate)
                ? ImportAccountVehiclePlateStatus.PENDING_COMMIT
                : ImportAccountVehiclePlateStatus.INVALID_PLATE
              : undefined,
          };
        },
      );

      const validCount = results.filter((r) => r.status === 'valid').length;
      const invalidCount = results.filter((r) => r.status === 'invalid').length;

      return {
        mode: ImportPartnerAccountMode.PREVIEW,
        totalRows: parsedRows.length,
        validCount,
        invalidCount,
        results,
      };
    }

    // Step 5: Commit Mode
    const commitResults: ImportPartnerAccountRowResult[] = [];
    const successfulUsersForEmail: Array<{
      userId: string;
      email: string;
      fullName: string;
      expiresAt: Date;
    }> = [];

    // Query Role EMPLOYEE ID for account creation
    const roleRepo = this.dataSource.getRepository(RoleEntity);
    const employeeRole = await roleRepo.findOne({
      where: { roleCode: 'EMPLOYEE', isActive: true },
    });
    if (!employeeRole) {
      throw new BadRequestException({
        success: false,
        message: 'Role EMPLOYEE không khả dụng trong hệ thống.',
        error: { code: 'EMPLOYEE_ROLE_NOT_FOUND' },
      });
    }

    const deptRepo = this.dataSource.getRepository(DepartmentEntity);
    const partnerDept = await deptRepo.findOne({
      where: {
        departmentCode: PARTNER_DEPARTMENT_CODE,
        isActive: true,
        deletedAt: IsNull(),
      },
    });
    if (!partnerDept) {
      throw new BadRequestException({
        success: false,
        message:
          'Phòng ban Đối tác (department_code=PARTNER) không tồn tại hoặc đã bị khóa.',
        error: { code: 'PARTNER_DEPARTMENT_NOT_FOUND' },
      });
    }

    for (const state of rowStates) {
      if (state.isError) {
        commitResults.push({
          row: state.parsed.row,
          email: state.parsed.email,
          status: 'failed',
          reason: state.result.reason,
        });
        continue;
      }

      const photo = photoMap.get(state.parsed.email.toLowerCase().trim());
      if (!photo) {
        commitResults.push({
          row: state.parsed.row,
          email: state.parsed.email,
          status: 'failed',
          reason: ImportPartnerAccountRowReason.PARTNER_PHOTO_REQUIRED,
        });
        continue;
      }

      // Check magic bytes & size
      const detectedMime = detectImageMimeType(photo.buffer);
      if (!detectedMime) {
        commitResults.push({
          row: state.parsed.row,
          email: state.parsed.email,
          status: 'failed',
          reason: ImportPartnerAccountRowReason.PARTNER_PHOTO_INVALID_IMAGE,
        });
        continue;
      }

      if (photo.buffer.length > MAX_BIOMETRIC_PHOTO_BYTES) {
        commitResults.push({
          row: state.parsed.row,
          email: state.parsed.email,
          status: 'failed',
          reason: ImportPartnerAccountRowReason.PARTNER_PHOTO_TOO_LARGE,
        });
        continue;
      }

      let uploadedCloudinaryPublicId: string | undefined;

      try {
        // Upload photo to Cloudinary
        const uploadResult = await this.cloudinaryService.uploadImage(
          photo.buffer,
          'face-profiles',
        );
        uploadedCloudinaryPublicId = uploadResult.publicId;

        const mediaFileId = randomUUID();
        const faceProfileId = randomUUID();

        const resolvedData: ResolvedAccountData = {
          fullName: state.parsed.fullName,
          email: state.parsed.email,
          employeeCode: null,
          departmentId: partnerDept.id,
          roleIds: [employeeRole.id],
          phoneNumber: state.parsed.phoneNumber || null,
          positionTitle: null,
          directManagerId: null,
          partner: {
            accountExpiresAt: state.resolvedExpiresAt!,
            mediaFileId,
            faceProfileId,
            detectedMime,
            storageKey: uploadResult.publicId,
            fileUrl: uploadResult.secureUrl,
            fileName: photo.originalname || `${state.parsed.email}.jpg`,
            uploadedBy: actor.id,
          },
        };

        // Per-row transaction calling persistAccount()
        const createdAccount = await this.dataSource.transaction(async (em) => {
          return await this.usersService.persistAccount(
            em,
            resolvedData,
            actor.id,
            clientContext as UserClientContext,
          );
        });

        const createdUser = createdAccount.user;

        // Best-effort vehicle registration
        let vehiclePlateStatus: string | undefined;
        if (state.parsed.licensePlate) {
          try {
            await this.vehicleRegistrationService.register(createdUser.id, {
              plateRaw: state.parsed.licensePlate,
            });
            vehiclePlateStatus = ImportAccountVehiclePlateStatus.ATTACHED;
          } catch (err: unknown) {
            // Đọc code từ response của HttpException (mirror
            // extractVehicleErrorCode của AccountImportService) — KHÔNG
            // string-match message tiếng Việt (dễ vỡ nếu wording đổi).
            const code = (err as { response?: { code?: string } })?.response
              ?.code;
            if (code === 'INVALID_PLATE') {
              vehiclePlateStatus =
                ImportAccountVehiclePlateStatus.INVALID_PLATE;
            } else if (code === 'PLATE_ALREADY_REGISTERED') {
              vehiclePlateStatus =
                ImportAccountVehiclePlateStatus.DUPLICATE_PLATE;
            } else {
              const error = err as Error;
              this.logger.warn(
                `Vehicle plate attach failed for user ${createdUser.id}: ${error.message}`,
              );
              vehiclePlateStatus =
                ImportAccountVehiclePlateStatus.ATTACH_FAILED;
            }
          }
        }

        commitResults.push({
          row: state.parsed.row,
          email: state.parsed.email,
          status: 'success',
          userId: createdUser.id,
          accountExpiresAt: state.resolvedExpiresAt!.toISOString(),
          vehiclePlateStatus,
        });

        successfulUsersForEmail.push({
          userId: createdUser.id,
          email: state.parsed.email,
          fullName: state.parsed.fullName,
          expiresAt: state.resolvedExpiresAt!,
        });
      } catch (err: unknown) {
        const error = err as Error;
        this.logger.error(
          `Commit error for row ${state.parsed.row} (${state.parsed.email}): ${error.message}`,
          error.stack,
        );

        if (uploadedCloudinaryPublicId) {
          try {
            await this.cloudinaryService.deleteImage(
              uploadedCloudinaryPublicId,
            );
          } catch (cleanupErr: unknown) {
            const cleanupError = cleanupErr as Error;
            this.logger.warn(
              `Cloudinary orphan cleanup failed: ${cleanupError.message}`,
            );
          }
        }

        commitResults.push({
          row: state.parsed.row,
          email: state.parsed.email,
          status: 'failed',
          reason: error.message || 'RUNTIME_ERROR',
        });
      }
    }

    const successCount = commitResults.filter(
      (r) => r.status === 'success',
    ).length;
    const failedCount = commitResults.filter(
      (r) => r.status === 'failed',
    ).length;

    // Step 6: Dispatch welcome emails best-effort
    for (const item of successfulUsersForEmail) {
      try {
        const welcomeEmailHtml = buildPartnerAccountWelcomeEmail({
          fullName: item.fullName,
          email: item.email,
          expiresAt: item.expiresAt,
        });

        await this.notificationsService.enqueueEmailNotification({
          recipientUserIds: [item.userId],
          toEmails: [item.email],
          channel: NotificationChannel.EMAIL,
          subject:
            'Tài khoản đối tác Smart Meeting Management đã được khởi tạo',
          emailHtml: welcomeEmailHtml,
          content: `Kính gửi ${item.fullName},\nTài khoản đối tác của bạn (${item.email}) đã được khởi tạo thành công. Mật khẩu chính là địa chỉ email này. Hạn sử dụng: ${formatDateTimeVN(item.expiresAt)}`,
          notificationType: NotificationType.ACCOUNT_WELCOME,
          payloadJson: { partnerAccountImport: true },
        });
      } catch (emailErr: unknown) {
        const error = emailErr as Error;
        this.logger.warn(
          `Failed to enqueue welcome email for ${item.email}: ${error.message}`,
        );
      }
    }

    // Step 7: Audit log summary
    try {
      await this.dataSource.manager.save(AuditLogEntity, {
        userId: actor.id,
        actionType: 'PARTNER_ACCOUNT_IMPORT',
        entityType: 'users',
        severity: AuditLogSeverity.INFO,
        ipAddress: clientContext?.ipAddress || null,
        userAgent: clientContext?.userAgent || null,
        requestId: clientContext?.requestId || null,
        newValueJson: {
          totalRows: parsedRows.length,
          successCount,
          failedCount,
        },
      });
    } catch (auditErr: unknown) {
      const error = auditErr as Error;
      this.logger.warn(
        `Failed to record PARTNER_ACCOUNT_IMPORT audit log: ${error.message}`,
      );
    }

    return {
      mode: ImportPartnerAccountMode.COMMIT,
      totalRows: parsedRows.length,
      successCount,
      failedCount,
      results: commitResults,
    };
  }

  // ════════════════════════════════════════════════════════════════
  //  Parsing & Resolution Helpers
  // ════════════════════════════════════════════════════════════════

  private async parseWorkbook(buffer: Buffer): Promise<ParsedPartnerRow[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException({
        success: false,
        message: 'Tệp Excel không đúng định dạng hoặc bị hỏng.',
        error: { code: ImportPartnerAccountRequestError.INVALID_FILE_FORMAT },
      });
    }

    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 1) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp Excel rỗng hoặc không đúng cấu trúc.',
        error: { code: ImportPartnerAccountRequestError.INVALID_TEMPLATE },
      });
    }

    // Validate headers
    const headerRow = sheet.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      if (colNumber <= IMPORT_PARTNER_HEADERS.length) {
        const cellVal = cell.value;
        const val =
          typeof cellVal === 'string' ||
          typeof cellVal === 'number' ||
          typeof cellVal === 'boolean'
            ? String(cellVal).trim()
            : '';
        headers.push(val);
      }
    });

    for (let i = 0; i < IMPORT_PARTNER_HEADERS.length; i++) {
      if (headers[i] !== IMPORT_PARTNER_HEADERS[i]) {
        throw new BadRequestException({
          success: false,
          message: `Cấu trúc tệp Excel không khớp mẫu. Cột thứ ${i + 1} phải là "${IMPORT_PARTNER_HEADERS[i]}", nhận được "${headers[i] ?? ''}".`,
          error: { code: ImportPartnerAccountRequestError.INVALID_TEMPLATE },
        });
      }
    }

    const rows: ParsedPartnerRow[] = [];

    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return; // Skip header

      const getCellString = (colIndex: number): string => {
        const val = row.getCell(colIndex).value;
        if (val === null || val === undefined) return '';
        if (val instanceof Date) return val.toISOString();
        if (typeof val === 'object') {
          const cellObj = val as unknown as Record<string, unknown>;
          if (typeof cellObj.text === 'string') {
            return cellObj.text.trim();
          }
          if (
            cellObj.result !== undefined &&
            cellObj.result !== null &&
            (typeof cellObj.result === 'string' ||
              typeof cellObj.result === 'number' ||
              typeof cellObj.result === 'boolean')
          ) {
            return String(cellObj.result).trim();
          }
        }
        if (typeof val === 'string') return val.trim();
        if (typeof val === 'number' || typeof val === 'boolean')
          return String(val).trim();
        return '';
      };

      const fullName = getCellString(1);
      const email = getCellString(2).toLowerCase();
      const accountExpiresAtRaw = getCellString(3);
      const phoneNumber = getCellString(4);
      const licensePlate = getCellString(5);

      // Check if line is completely empty
      if (
        !fullName &&
        !email &&
        !accountExpiresAtRaw &&
        !phoneNumber &&
        !licensePlate
      ) {
        return;
      }

      rows.push({
        row: rowNumber,
        fullName,
        email,
        accountExpiresAtRaw,
        phoneNumber,
        licensePlate,
      });
    });

    if (rows.length === 0) {
      throw new BadRequestException({
        success: false,
        message: 'Tệp Excel không chứa dòng dữ liệu nào.',
        error: { code: ImportPartnerAccountRequestError.INVALID_TEMPLATE },
      });
    }

    if (rows.length > MAX_PARTNER_IMPORT_ROWS) {
      throw new BadRequestException({
        success: false,
        message: `Số lượng dòng dữ liệu (${rows.length}) vượt quá giới hạn tối đa cho phép (${MAX_PARTNER_IMPORT_ROWS}).`,
        error: {
          code: ImportPartnerAccountRequestError.IMPORT_ROW_LIMIT_EXCEEDED,
          details: {
            maxRows: MAX_PARTNER_IMPORT_ROWS,
            actualRows: rows.length,
          },
        },
      });
    }

    return rows;
  }

  private async resolveAndValidateRows(
    rows: ParsedPartnerRow[],
    photoMap: Map<string, UploadedAccountPhoto>,
    options: ImportPartnerAccountsDto,
  ): Promise<PartnerRowState[]> {
    const states: PartnerRowState[] = [];
    const seenEmailsInFile = new Set<string>();
    const emailsToQuery = new Set<string>();

    const now = new Date();

    // 1. Static validation per row
    for (const parsed of rows) {
      const result: ImportPartnerAccountRowResult = {
        row: parsed.row,
        email: parsed.email,
        status: 'valid',
      };
      let isError = false;
      let resolvedExpiresAt: Date | undefined;

      // Check required fields
      if (!parsed.fullName || !parsed.email) {
        result.status = 'invalid';
        result.reason = ImportPartnerAccountRowReason.MISSING_REQUIRED_FIELD;
        isError = true;
      } else if (!EMAIL_REGEX.test(parsed.email)) {
        result.status = 'invalid';
        result.reason = ImportPartnerAccountRowReason.INVALID_EMAIL;
        isError = true;
      } else if (seenEmailsInFile.has(parsed.email)) {
        result.status = 'invalid';
        result.reason = ImportPartnerAccountRowReason.DUPLICATE_IN_FILE;
        isError = true;
      } else {
        seenEmailsInFile.add(parsed.email);
        emailsToQuery.add(parsed.email);
      }

      // Resolve account_expires_at if no error so far
      if (!isError) {
        if (parsed.accountExpiresAtRaw) {
          const parsedDate = new Date(parsed.accountExpiresAtRaw);
          if (isNaN(parsedDate.getTime())) {
            result.status = 'invalid';
            result.reason =
              ImportPartnerAccountRowReason.INVALID_ACCOUNT_EXPIRES_AT;
            isError = true;
          } else if (parsedDate <= now) {
            result.status = 'invalid';
            result.reason =
              ImportPartnerAccountRowReason.ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE;
            isError = true;
          } else {
            resolvedExpiresAt = parsedDate;
          }
        } else if (
          options.defaultExpiresInDays &&
          options.defaultExpiresInDays >= 1
        ) {
          const defaultDate = new Date(
            now.getTime() + options.defaultExpiresInDays * 86400 * 1000,
          );
          if (defaultDate <= now) {
            result.status = 'invalid';
            result.reason =
              ImportPartnerAccountRowReason.ACCOUNT_EXPIRES_AT_MUST_BE_FUTURE;
            isError = true;
          } else {
            resolvedExpiresAt = defaultDate;
          }
        } else {
          result.status = 'invalid';
          result.reason =
            ImportPartnerAccountRowReason.MISSING_ACCOUNT_EXPIRES_AT;
          isError = true;
        }
      }

      // Check mandatory matching biometric photo
      if (!isError) {
        const photo = photoMap.get(parsed.email.toLowerCase().trim());
        if (!photo) {
          result.status = 'invalid';
          result.reason = ImportPartnerAccountRowReason.PARTNER_PHOTO_REQUIRED;
          isError = true;
        }
      }

      states.push({
        parsed,
        result,
        resolvedExpiresAt,
        isError,
      });
    }

    // 2. Batch DB Query

    // Check existing users by email
    if (emailsToQuery.size > 0) {
      const existingUserRows: Array<{ email: string }> =
        await this.dataSource.query(
          `SELECT LOWER(email) as email FROM users WHERE LOWER(email) = ANY($1) AND deleted_at IS NULL;`,
          [Array.from(emailsToQuery)],
        );
      const existingEmailsSet = new Set(existingUserRows.map((r) => r.email));

      for (const state of states) {
        if (
          !state.isError &&
          existingEmailsSet.has(state.parsed.email.toLowerCase())
        ) {
          state.result.status = 'invalid';
          state.result.reason =
            ImportPartnerAccountRowReason.EMAIL_ALREADY_EXISTS;
          state.isError = true;
        }
      }
    }

    return states;
  }

  // ════════════════════════════════════════════════════════════════
  //  Zip Extraction Helper
  // ════════════════════════════════════════════════════════════════

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
          code: ImportPartnerAccountRequestError.INVALID_PHOTOS_ZIP,
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
          code: ImportPartnerAccountRequestError.INVALID_PHOTOS_ZIP,
          details: {},
        },
      });
    }

    const entries = Object.values(zip.files).filter((f) => !f.dir);
    if (entries.length > MAX_PARTNER_IMPORT_ROWS) {
      throw new BadRequestException({
        success: false,
        message: `Tệp .zip vượt quá số ảnh tối đa (${MAX_PARTNER_IMPORT_ROWS}).`,
        error: {
          code: ImportPartnerAccountRequestError.INVALID_PHOTOS_ZIP,
          details: { maxEntries: MAX_PARTNER_IMPORT_ROWS },
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
            code: ImportPartnerAccountRequestError.INVALID_PHOTOS_ZIP,
            details: { maxBytes: MAX_PHOTOS_ZIP_TOTAL_UNCOMPRESSED_BYTES },
          },
        });
      }

      photos.push({ buffer, originalname: baseName, size: buffer.length });
    }
    return photos;
  }

  private buildPhotoMap(
    photos: UploadedAccountPhoto[],
  ): Map<string, UploadedAccountPhoto> {
    const map = new Map<string, UploadedAccountPhoto>();
    for (const photo of photos) {
      const base = (photo.originalname ?? '')
        .replace(/\.[^./\\]+$/, '')
        .trim()
        .toLowerCase();
      if (base) {
        map.set(base, photo);
      }
    }
    return map;
  }
}
