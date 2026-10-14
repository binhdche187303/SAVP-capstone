import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  FileInterceptor,
  FileFieldsInterceptor,
} from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiForbiddenResponse,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

import { UsersService } from '../services/users.service.js';
import { AccountImportService } from '../services/account-import.service.js';
import { PartnerAccountImportService } from '../services/partner-account-import.service.js';
import { CreateUserDto } from '../dto/create-user.dto.js';
import { ImportAccountsDto } from '../dto/import-accounts.dto.js';
import { ImportAccountReportDto } from '../dto/import-accounts-response.dto.js';
import { ImportPartnerAccountsDto } from '../dto/import-partner-accounts.dto.js';
import { ImportPartnerAccountReportDto } from '../dto/import-partner-accounts-response.dto.js';
import {
  XLSX_MIME,
  MAX_IMPORT_ROWS,
  ImportAccountMode,
} from '../constants/import-accounts.constants.js';
import {
  MAX_PARTNER_IMPORT_ROWS,
  ImportPartnerAccountMode,
} from '../constants/import-partner-accounts.constants.js';
import type { UploadedAccountPhoto } from '../services/account-import.service.js';
import { UpdateUserDto } from '../dto/update-user.dto.js';
import { UpdateUserStatusDto } from '../dto/update-user-status.dto.js';
import { LockUserDto } from '../dto/lock-user.dto.js';
import { UpdateUserRolesDto } from '../dto/update-user-roles.dto.js';
import {
  UserResponseDto,
  UserRoleResponseDto,
} from '../dto/user-response.dto.js';
import { UserDetailResponseDto } from '../dto/user-detail-response.dto.js';
import { UserPublicProfileResponseDto } from '../dto/user-public-profile-response.dto.js';
import { ListUsersQueryDto } from '../dto/list-users-query.dto.js';
import { UserListItemDto } from '../dto/user-list-item.dto.js';
import { ManageUsersQueryDto } from '../dto/manage-users-query.dto.js';
import { ManageUserItemDto } from '../dto/manage-user-item.dto.js';
import { ExportUsersQueryDto } from '../dto/export-users-query.dto.js';
import { UserExportService } from '../../reports/services/user-export.service.js';

@ApiTags('Accounts')
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly accountImportService: AccountImportService,
    private readonly partnerAccountImportService: PartnerAccountImportService,
    private readonly userExportService: UserExportService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.create')
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('avatarFile'))
  @ApiConsumes('multipart/form-data')
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  @ApiOperation({
    summary: 'Tạo tài khoản nhân viên thủ công',
    description:
      'Cho phép Manager/Admin tạo tài khoản cho nhân viên mới, gán vai trò và xếp hàng gửi email thông tin đăng nhập.',
  })
  @ApiBody({ type: CreateUserDto })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Tài khoản nhân viên được tạo thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission accounts.user.create).',
  })
  async createUser(
    @Body() createUserDto: CreateUserDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
    @UploadedFile() avatarFile?: UploadedAccountPhoto,
  ): Promise<{ success: boolean; message: string; data: UserResponseDto }> {
    const user = request['user'] as { userId: string } | undefined;
    const creatorId = user?.userId || 'system';

    const result = await this.usersService.createUser(
      createUserDto,
      creatorId,
      {
        ipAddress,
        userAgent,
        requestId,
      },
      avatarFile,
    );

    return {
      success: true,
      message:
        'Nhân viên đã được tạo thành công và thông tin đăng nhập đã được gửi tới email.',
      data: result,
    };
  }

  @Get('import/template')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.import')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tải tệp Excel mẫu để import tài khoản nhân viên',
    description:
      'Trả về file .xlsx chứa header chuẩn (full_name, email, department_code, role_codes, employee_code, phone_number, position_title, direct_manager_email, license_plate), dòng ví dụ và sheet hướng dẫn.',
  })
  async downloadImportTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.accountImportService.generateTemplate();
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="employee-accounts-template.xlsx"',
    );
    res.send(buffer);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.import')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'file', maxCount: 1 },
      { name: 'photos', maxCount: MAX_IMPORT_ROWS },
      { name: 'photosZip', maxCount: 1 },
    ]),
  )
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Tạo tài khoản nhân viên bằng import Excel',
    description:
      'Tải lên file .xlsx danh sách nhân viên (có thêm cột `license_plate` tùy chọn — biển số xe). commit=false trả preview kiểm tra (không ghi DB); commit=true tạo tài khoản cho các dòng hợp lệ (bỏ dòng lỗi), sinh mật khẩu tạm và gửi email credentials cho từng người. ' +
      'Có thể gửi kèm ảnh sinh trắc học qua field `photos` (nhiều file rời) và/hoặc `photosZip` (1 file .zip gộp nhiều ảnh) — mỗi ảnh/entry đặt tên file gốc = employee_code (vd EMP001.jpg) để hệ thống tự khớp; ảnh khớp được sẽ vào hàng chờ duyệt (pending_review) giống luồng tự nộp. Bắt buộc `biometricConsentConfirmed=true` nếu có gửi kèm ảnh (photos hoặc photosZip) và commit=true. ' +
      'Nếu dòng có điền `license_plate`, hệ thống sẽ tự đăng ký hộ biển số cho tài khoản vừa tạo (best-effort — biển sai định dạng hoặc trùng KHÔNG làm fail dòng, xem `vehiclePlateStatus` trong kết quả).',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        commit: { type: 'boolean' },
        photos: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        photosZip: { type: 'string', format: 'binary' },
        biometricConsentConfirmed: { type: 'boolean' },
      },
      required: ['file'],
    },
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission accounts.user.import).',
  })
  async importAccounts(
    @UploadedFiles()
    files:
      | {
          file?: Array<{
            buffer: Buffer;
            mimetype?: string;
            size?: number;
            originalname?: string;
          }>;
          photos?: UploadedAccountPhoto[];
          photosZip?: Array<{
            buffer: Buffer;
            mimetype?: string;
            size?: number;
            originalname?: string;
          }>;
        }
      | undefined,
    @Body() dto: ImportAccountsDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: ImportAccountReportDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.accountImportService.importAccounts(
      files?.file?.[0],
      {
        commit: dto.commit,
        biometricConsentConfirmed: dto.biometricConsentConfirmed,
      },
      { userId: actorId },
      { ipAddress, userAgent, requestId },
      files?.photos ?? [],
      files?.photosZip?.[0],
    );

    return {
      success: true,
      message:
        result.mode === ImportAccountMode.COMMIT
          ? 'Tạo tài khoản hoàn tất'
          : 'Kiểm tra hoàn tất',
      data: result,
    };
  }

  @Get('import-partners/template')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('account.partner.import')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tải tệp Excel mẫu để import tài khoản đối tác',
    description:
      'Trả về file .xlsx chứa header chuẩn (full_name, email, account_expires_at, phone_number, license_plate), dòng ví dụ và sheet hướng dẫn.',
  })
  async downloadPartnerImportTemplate(@Res() res: Response): Promise<void> {
    const buffer = await this.partnerAccountImportService.generateTemplate();
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="partner-accounts-template.xlsx"',
    );
    res.send(buffer);
  }

  @Post('import-partners')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('account.partner.import')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'file', maxCount: 1 },
      { name: 'photos', maxCount: MAX_PARTNER_IMPORT_ROWS },
      { name: 'photosZip', maxCount: 1 },
    ]),
  )
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  )
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Import Excel tạo tài khoản đối tác/khách hàng tạm thời',
    description:
      'Tải lên file .xlsx danh sách đối tác kèm ảnh sinh trắc học bắt buộc. commit=false trả preview kiểm tra; commit=true tạo tài khoản cho các dòng hợp lệ, mật khẩu = email, gửi email chào mừng.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        commit: { type: 'boolean' },
        photos: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        photosZip: { type: 'string', format: 'binary' },
        defaultExpiresInDays: { type: 'number' },
      },
      required: ['file'],
    },
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission account.partner.import).',
  })
  async importPartnerAccounts(
    @UploadedFiles()
    files:
      | {
          file?: Array<{
            buffer: Buffer;
            mimetype?: string;
            size?: number;
            originalname?: string;
          }>;
          photos?: UploadedAccountPhoto[];
          photosZip?: Array<{
            buffer: Buffer;
            mimetype?: string;
            size?: number;
            originalname?: string;
          }>;
        }
      | undefined,
    @Body() dto: ImportPartnerAccountsDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: ImportPartnerAccountReportDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const excelFile = files?.file?.[0] ?? { buffer: Buffer.alloc(0) };

    const result = await this.partnerAccountImportService.importPartnerAccounts(
      excelFile,
      files?.photos ?? [],
      files?.photosZip?.[0],
      dto,
      { id: actorId },
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message:
        result.mode === ImportPartnerAccountMode.COMMIT
          ? 'Tạo tài khoản hoàn tất'
          : 'Kiểm tra hoàn tất',
      data: result,
    };
  }

  @Put(':userId/roles')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.update_roles')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cập nhật vai trò tài khoản (replace-set)',
    description:
      'Cho phép System Admin thay thế toàn bộ tập vai trò của một tài khoản. Nhận full desired roleIds[]; hệ thống tự soft-remove vai trò bị bỏ và gán vai trò được thêm theo RBAC.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần cập nhật vai trò',
    type: String,
  })
  @ApiBody({ type: UpdateUserRolesDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vai trò tài khoản được cập nhật thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.update_roles).',
  })
  async updateUserRoles(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/roles',
        }),
      }),
    )
    userId: string,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    dto: UpdateUserRolesDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: { userId: string; roles: UserRoleResponseDto[] };
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.usersService.updateUserRoles(
      userId,
      dto.roleIds,
      actorId,
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message: 'Cập nhật vai trò tài khoản thành công',
      data: result,
    };
  }

  // ⚠️ Route order: khai báo ':userId/status' TRƯỚC ':userId' (UC-09) để route
  // cụ thể hơn không bị pattern ':userId' nuốt.
  @Patch(':userId/status')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.update_status')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cập nhật trạng thái tài khoản (ACTIVE/INACTIVE)',
    description:
      'Cho phép System Admin (toàn hệ thống) và Business Admin (giới hạn department scope) chuyển trạng thái tài khoản giữa active và inactive. Tài khoản inactive bị chặn đăng nhập; khi vô hiệu hóa, token đang hoạt động bị thu hồi ngay. Không dùng để khóa (locked) hay đổi trạng thái đặt lại mật khẩu.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần đổi trạng thái',
    type: String,
  })
  @ApiBody({ type: UpdateUserStatusDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Trạng thái tài khoản được cập nhật thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.update_status) hoặc ngoài phạm vi department.',
  })
  async updateUserStatus(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/status',
        }),
      }),
    )
    userId: string,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    dto: UpdateUserStatusDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: { id: string; accountStatus: string };
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.usersService.updateUserStatus(
      userId,
      dto.status,
      actorId,
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message: 'Cập nhật trạng thái tài khoản thành công',
      data: result,
    };
  }

  // ⚠️ Route order: khai báo ':userId/lock' và ':userId/unlock' TRƯỚC ':userId'
  // (UC-09) để route cụ thể hơn không bị pattern ':userId' nuốt.
  @Patch(':userId/lock')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.lock')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Khóa tài khoản người dùng',
    description:
      'Cho phép System Admin (toàn hệ thống) và Business Admin (giới hạn department scope) khóa một tài khoản (kỷ luật/bảo mật). Tài khoản chuyển LOCKED, mọi session bị thu hồi ngay, dữ liệu lịch sử (vai trò, hồ sơ) giữ nguyên. Lý do khóa (tùy chọn) được ghi vào nhật ký kiểm toán.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần khóa',
    type: String,
  })
  @ApiBody({ type: LockUserDto, required: false })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tài khoản đã được khóa thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.lock) hoặc ngoài phạm vi department.',
  })
  async lockUser(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/lock',
        }),
      }),
    )
    userId: string,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    dto: LockUserDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: { id: string; accountStatus: string };
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.usersService.lockUser(
      userId,
      dto.reason,
      actorId,
      { ipAddress, userAgent, requestId },
    );

    return {
      success: true,
      message: 'Đã khóa tài khoản thành công',
      data: result,
    };
  }

  @Patch(':userId/unlock')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.unlock')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Mở khóa tài khoản người dùng',
    description:
      'Cho phép System Admin và Business Admin (giới hạn department scope) mở khóa một tài khoản đang bị khóa, đưa về trạng thái active và đặt lại bộ đếm đăng nhập thất bại.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần mở khóa',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Tài khoản đã được mở khóa thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.unlock) hoặc ngoài phạm vi department.',
  })
  async unlockUser(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/unlock',
        }),
      }),
    )
    userId: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: { id: string; accountStatus: string };
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.usersService.unlockUser(userId, actorId, {
      ipAddress,
      userAgent,
      requestId,
    });

    return {
      success: true,
      message: 'Đã mở khóa tài khoản thành công',
      data: result,
    };
  }

  @Patch(':userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cập nhật thông tin tài khoản nhân sự',
    description:
      'Cho phép người dùng cập nhật hồ sơ của chính mình với các trường an toàn (họ tên, số điện thoại). System Admin và Business Admin có quyền accounts.user.update vẫn có thể cập nhật thông tin hồ sơ nhân sự theo phạm vi được phân quyền. Không đổi email/vai trò/trạng thái tài khoản qua endpoint này.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần cập nhật thông tin',
    type: String,
  })
  @ApiBody({ type: UpdateUserDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Thông tin tài khoản được cập nhật thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn, không phải hồ sơ của chính mình, hoặc ngoài phạm vi department.',
  })
  async updateUser(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId',
        }),
      }),
    )
    userId: string,
    @Body(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    )
    dto: UpdateUserDto,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UserDetailResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const result = await this.usersService.updateUser(userId, dto, actorId, {
      ipAddress,
      userAgent,
      requestId,
    });

    return {
      success: true,
      message: 'Cập nhật thông tin tài khoản thành công',
      data: result,
    };
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.delete')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xóa tài khoản người dùng (soft-delete)',
    description:
      'Cho phép System Admin xóa (soft-delete) một tài khoản chưa phát sinh dữ liệu ràng buộc. Thu hồi token và vô hiệu hóa vai trò của tài khoản. Chặn xóa nếu còn ràng buộc active (đang tổ chức/tham dự cuộc họp sắp tới, có booking hiệu lực, là quản lý trực tiếp/trưởng phòng ban).',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần xóa',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Đã xóa tài khoản thành công.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission accounts.user.delete).',
  })
  async deleteUser(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId',
        }),
      }),
    )
    userId: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{ success: boolean; message: string }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    await this.usersService.deleteUser(userId, actorId, {
      ipAddress,
      userAgent,
      requestId,
    });

    return {
      success: true,
      message: 'Đã xóa tài khoản thành công',
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.list')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tìm kiếm/danh sách rút gọn người dùng nội bộ',
    description:
      'Trả về danh sách rút gọn (id, fullName, email) của người dùng đang active, dùng cho autocomplete (ví dụ chọn người tham dự cuộc họp). Hỗ trợ tìm theo tên/email và pagination.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách người dùng (rút gọn).',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission accounts.user.list).',
  })
  async listUsers(@Query() query: ListUsersQueryDto): Promise<{
    success: boolean;
    message: string;
    data: UserListItemDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const { data, total } = await this.usersService.listUsers(query);

    return {
      success: true,
      message: 'Lấy danh sách người dùng thành công',
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Get('student-classes')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Danh sách lớp hành chính dùng khi quản lý sinh viên',
  })
  async listStudentAdministrativeClasses(@Req() request: Request) {
    const user = request['user'] as { userId: string } | undefined;
    const data = await this.usersService.listStudentAdministrativeClasses(
      user?.userId || 'system',
    );
    return {
      success: true,
      message: 'Lấy danh sách lớp hành chính thành công',
      data,
    };
  }

  // ⚠️ Route order: khai báo path tĩnh 'manage' TRƯỚC ':userId' để không bị
  // pattern ':userId' nuốt "manage".
  @Get('manage')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.manage')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lọc danh sách tài khoản (quản trị)',
    description:
      'Cho phép System Admin (toàn hệ thống) và Business Admin (giới hạn department scope) lọc danh sách tài khoản theo phòng ban / vai trò / trạng thái, kết hợp tìm kiếm theo tên/email/mã NV, có sắp xếp và phân trang. Endpoint quản trị (khác endpoint autocomplete GET /users).',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Danh sách tài khoản (đã lọc, sắp xếp, phân trang).',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description:
      'Không đủ quyền hạn (thiếu permission accounts.user.manage) hoặc ngoài phạm vi department.',
  })
  async listUsersForManagement(
    @Query() query: ManageUsersQueryDto,
    @Req() request: Request,
  ): Promise<{
    success: boolean;
    message: string;
    data: ManageUserItemDto[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const actorId = user?.userId || 'system';

    const page = query.page || 1;
    const limit = query.limit || 20;

    const { data, total } = await this.usersService.listUsersForManagement(
      query,
      actorId,
    );

    return {
      success: true,
      message: 'Lấy danh sách tài khoản thành công',
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // [BE-04, Đợt P1] Route order: khai báo path tĩnh 'export' TRƯỚC ':userId' —
  // nếu không, 'export' sẽ bị pattern ':userId' nuốt (đúng lỗi plan gốc mô tả),
  // Nest sẽ thử parse "export" như 1 UUID và trả 400 thay vì chạy route này.
  @Get('export')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('accounts.user.export')
  @ApiBearerAuth()
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary: 'Xuất danh sách người dùng ra file Excel',
    description:
      'Render đồng bộ và trả thẳng file XLSX theo filter (search/departmentId/roleId/locked). [Quyết định 2026-07-27 của Hải] Đổi từ background job (202 {jobId} + poll) sang trả file trực tiếp — xem UserExportService docblock.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'File XLSX danh sách người dùng (trả trực tiếp trong body).',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn (thiếu permission accounts.user.export).',
  })
  async exportUsers(
    @Query() query: ExportUsersQueryDto,
    @Req() request: Request,
    @Res() res: Response,
  ): Promise<void> {
    const user = request['user'] as
      | { userId: string; email: string }
      | undefined;

    const { buffer, fileName } = await this.userExportService.exportUsersXlsx(
      { userId: user?.userId ?? 'system', email: user?.email ?? '' },
      query,
    );

    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(buffer);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem hồ sơ cá nhân của tài khoản đang đăng nhập',
    description:
      'Cho phép người dùng tự xem hồ sơ của chính mình. Endpoint này chỉ yêu cầu JWT, không yêu cầu quyền admin xem chi tiết tài khoản người khác.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Hồ sơ cá nhân của tài khoản đang đăng nhập.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  async getMyProfile(
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UserDetailResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const authenticatedUserId = user?.userId;

    if (!authenticatedUserId) {
      throw new Error('Authenticated user id is missing from request context');
    }

    const result = await this.usersService.getUserDetail(
      authenticatedUserId,
      authenticatedUserId,
      {
        ipAddress,
        userAgent,
        requestId,
      },
    );

    return {
      success: true,
      message: 'My profile retrieved successfully',
      data: result,
    };
  }

  @Get(':userId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('account.user.read.detail')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem chi tiết hồ sơ tài khoản',
    description:
      'Cho phép System Admin hoặc Business Admin xem chi tiết hồ sơ của một tài khoản nhân sự. Business Admin bị giới hạn department scope.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần xem chi tiết',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Chi tiết hồ sơ tài khoản.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  @ApiForbiddenResponse({
    description: 'Không đủ quyền hạn hoặc ngoài phạm vi department.',
  })
  async getUserDetail(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId',
        }),
      }),
    )
    userId: string,
    @Req() request: Request,
    @Ip() ipAddress: string,
    @Headers('user-agent') userAgent?: string,
    @Headers('x-request-id') requestId?: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UserDetailResponseDto;
  }> {
    const user = request['user'] as { userId: string } | undefined;
    const authenticatedUserId = user?.userId || 'system';

    const result = await this.usersService.getUserDetail(
      userId,
      authenticatedUserId,
      {
        ipAddress,
        userAgent,
        requestId,
      },
    );

    return {
      success: true,
      message: 'User detail retrieved successfully',
      data: result,
    };
  }

  @Get(':userId/public-profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xem hồ sơ công khai tài khoản',
    description:
      'Cho phép bất kỳ user đã đăng nhập xem hồ sơ công khai rút gọn (id, fullName, email, employeeCode, department, avatarUrl) của một tài khoản khác. Không yêu cầu permission/role quản trị.',
  })
  @ApiParam({
    name: 'userId',
    description: 'UUID của tài khoản cần xem hồ sơ công khai',
    type: String,
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Hồ sơ công khai của tài khoản.',
  })
  @ApiUnauthorizedResponse({
    description: 'Không có quyền truy cập (thiếu hoặc sai JWT).',
  })
  async getPublicProfile(
    @Param(
      'userId',
      new ParseUUIDPipe({
        errorHttpStatusCode: HttpStatus.BAD_REQUEST,
        exceptionFactory: () => ({
          success: false,
          message: 'Validation failed (uuid is expected)',
          error: { code: 'INVALID_USER_ID', details: {} },
          timestamp: new Date().toISOString(),
          path: '/api/v1/users/:userId/public-profile',
        }),
      }),
    )
    userId: string,
  ): Promise<{
    success: boolean;
    message: string;
    data: UserPublicProfileResponseDto;
  }> {
    const result = await this.usersService.getPublicProfile(userId);

    return {
      success: true,
      message: 'Lấy hồ sơ công khai thành công',
      data: result,
    };
  }
}
