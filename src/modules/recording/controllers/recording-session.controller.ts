import {
  Body,
  Controller,
  Get,
  Post,
  HttpCode,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  UsePipes,
  ValidationPipe,
  Param,
  ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { RecordingSessionService } from '../services/recording-session.service.js';
import { StartVideoDto } from '../dto/start-video.dto.js';
import { CreateAudioSessionDto } from '../dto/create-audio-session.dto.js';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator.js';

const AUDIO_UPLOAD_MAX_BYTES =
  Number(process.env.STORAGE_MAX_FILE_SIZE) || 100 * 1024 * 1024;
const VIDEO_UPLOAD_MAX_BYTES =
  Number(process.env.RECORDING_VIDEO_UPLOAD_MAX_BYTES) || 500 * 1024 * 1024;

@Controller()
export class RecordingSessionController {
  constructor(
    private readonly recordingSessionService: RecordingSessionService,
  ) {}

  // REC-002 (UC-111): bắt đầu ghi hình video từ IP camera.
  @Post('live-meetings/:meetingId/recording/start-video')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.video.start')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async startVideo(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: StartVideoDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingSessionService.startVideo(
      meetingId,
      dto,
      userId,
    );
    return {
      success: true,
      message: 'Video recording started',
      data,
    };
  }

  // REC-003 (UC-116): dừng ghi hình video. v1 đồng bộ → 200.
  @Post('live-meetings/:meetingId/recording/:sessionId/stop-video')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.video.stop')
  async stopVideo(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingSessionService.stopVideo(
      meetingId,
      sessionId,
      userId,
    );
    return {
      success: true,
      message: data.captured
        ? 'Video recording stopped'
        : 'Đã dừng nhưng không ghi được video',
      data,
    };
  }

  // UC-114: tạm dừng ghi hình (segment). Tái dùng permission recording.video.stop.
  @Post('live-meetings/:meetingId/recording/:sessionId/pause-video')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.video.stop')
  async pauseVideo(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingSessionService.pauseVideo(
      meetingId,
      sessionId,
      userId,
    );
    return {
      success: true,
      message: 'Video recording paused',
      data,
    };
  }

  // UC-115: tiếp tục ghi hình (segment mới). Tái dùng permission recording.video.stop.
  @Post('live-meetings/:meetingId/recording/:sessionId/resume-video')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.video.stop')
  async resumeVideo(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingSessionService.resumeVideo(
      meetingId,
      sessionId,
      userId,
    );
    return {
      success: true,
      message: 'Video recording resumed',
      data,
    };
  }

  // Ad-hoc (ngoài REC-002/003/004 gốc): upload audio đã ghi sẵn (.wav/.mp3/.m4a/...)
  // để feed pipeline transcription (TRANS-OFFLINE-001) khi không có camera/capture
  // agent thật. Dùng guard thật (không Mock như các route REC khác) vì endpoint này
  // tạo dữ liệu được transcription.create đọc lại — cùng permission transcript.create.
  @Post('meetings/:meetingId/recording-sessions/audio-upload')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.create')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AUDIO_UPLOAD_MAX_BYTES } }),
  )
  async uploadAudio(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @UploadedFile() file: any,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingSessionService.uploadAudioForTranscription(
      meetingId,
      file,
      userId,
    );
    return {
      success: true,
      message:
        'Audio uploaded — dùng recordingSessionId để tạo transcription job',
      data,
    };
  }

  // Local/mock webcam flow: upload a browser-recorded video blob and persist it
  // as a normal recording session + media file so it can be replayed after the meeting.
  @Post('meetings/:meetingId/recording-sessions/video-upload')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.video.start')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: VIDEO_UPLOAD_MAX_BYTES } }),
  )
  async uploadVideo(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @UploadedFile() file: any,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingSessionService.uploadVideoFromBrowser(
      meetingId,
      file,
      userId,
    );
    return {
      success: true,
      message: 'Video recording uploaded',
      data,
    };
  }

  // Gap fix — PLAN-transcription-completion Phase 1: tạo audio session "rỗng"
  // làm điểm neo (sessionId) để N participant lần lượt upload audio-tracks vào
  // cùng 1 session (channel_zone mode). Cùng permission/authz với audio-upload
  // (transcript.create, Host/Organizer hoặc Admin) vì cùng thuộc luồng transcription.
  @Post('meetings/:meetingId/recording-sessions')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.create')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async createAudioSession(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Body() dto: CreateAudioSessionDto,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id || null;
    const data = await this.recordingSessionService.createAudioSession(
      meetingId,
      userId,
      dto,
    );
    return {
      success: true,
      message:
        'Audio session created — dùng recordingSessionId để participant upload audio-tracks',
      data,
    };
  }

  // Gap fix (Nhóm A) — participant tự tìm recordingSessionId để upload track,
  // không cần Host relay tay. Permission transcript.read (đã seed đủ 4 role,
  // gồm EMPLOYEE) — recording.files.read/recording.video.status hiện KHÔNG có
  // cho EMPLOYEE trong DB thật nên không dùng được ở đây.
  @Get('meetings/:meetingId/recording-sessions')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('transcript.read')
  async listRecordingSessions(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id;
    const data = await this.recordingSessionService.listRecordingSessions(
      meetingId,
      userId,
    );
    return {
      success: true,
      message: 'Danh sách recording session của meeting',
      data,
    };
  }

  // Phase 1 — PLAN-transcription-completion: participant upload audio track riêng.
  @Post('meetings/:meetingId/recording-sessions/:sessionId/audio-tracks')
  @HttpCode(201)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.upload_track')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: AUDIO_UPLOAD_MAX_BYTES } }),
  )
  async uploadAudioTrack(
    @Req() req: any,
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @UploadedFile() file: any,
  ) {
    const userId = req.user?.userId || req.user?.sub || req.user?.id;
    if (!userId) {
      return {
        success: false,
        message: 'Unauthorized — missing userId in token.',
      };
    }
    const data = await this.recordingSessionService.uploadAudioTrack(
      meetingId,
      sessionId,
      file,
      userId,
    );
    return {
      success: true,
      message: 'Audio track uploaded successfully.',
      data,
    };
  }

  // REC-004 (Phần A): đọc trạng thái phiên ghi (read-only).
  @Get('live-meetings/:meetingId/recording/:sessionId/status')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions('recording.video.status')
  async getStatus(
    @Param('meetingId', ParseUUIDPipe) meetingId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    const data = await this.recordingSessionService.getStatus(
      meetingId,
      sessionId,
    );
    return {
      success: true,
      message: 'Recording status retrieved',
      data,
    };
  }
}
