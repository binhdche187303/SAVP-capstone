import { MeetingMinutesListController } from './minutes-list.controller.js';
import { CreateMinutesExportResponseDto } from '../dto/create-minutes-export-response.dto.js';

describe('MeetingMinutesListController — export route', () => {
  let controller: MeetingMinutesListController;
  let exportService: any;

  const currentUser = { userId: 'host-1' };
  const minutesId = 'minutes-1';

  beforeEach(() => {
    exportService = {
      createExportJob: jest.fn().mockResolvedValue(
        new CreateMinutesExportResponseDto({
          jobId: 'job-1',
          status: 'queued',
          minutesId,
          format: 'pdf',
          estimatedCompletion: null,
        }),
      ),
    };
    controller = new MeetingMinutesListController({} as any, exportService);
  });

  it('POST :id/exports calls createExportJob and wraps 202 response', async () => {
    const res = await controller.createExport(
      minutesId,
      { format: 'pdf' },
      currentUser,
    );
    expect(exportService.createExportJob).toHaveBeenCalledWith(
      minutesId,
      { format: 'pdf' },
      { userId: 'host-1' },
    );
    expect(res).toEqual({
      success: true,
      message: 'Đã tạo yêu cầu xuất biên bản, đang xử lý',
      data: expect.objectContaining({ jobId: 'job-1', status: 'queued' }),
    });
  });

  it('propagates errors from service (e.g. 409)', async () => {
    exportService.createExportJob.mockRejectedValue(
      new Error('MINUTES_NOT_PUBLISHED'),
    );
    await expect(
      controller.createExport(minutesId, { format: 'pdf' }, currentUser),
    ).rejects.toThrow('MINUTES_NOT_PUBLISHED');
  });
});
