import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

interface HgVisionTokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
}

interface HgVisionFaceMatch {
  face_ident?: string;
  face_infor?: string;
  score?: number;
  face_image_path?: string;
}

interface HgVisionFaceSearchResponse {
  total_faces?: number;
  faces?: Array<{
    face_index?: number;
    face_image?: string;
    matches?: HgVisionFaceMatch[];
  }>;
  results?: Array<{
    face_index?: number;
    matches?: HgVisionFaceMatch[];
  }>;
}

export interface HgVisionRecognizedFace {
  faceIdent: string;
  faceInfo?: string;
  score: number;
  faceImagePath?: string;
  raw: HgVisionFaceSearchResponse;
}

interface HgVisionPlateReadResponse {
  results?: Array<{
    filename?: string;
    plates?: Array<{
      plate?: string;
      score?: number;
      det_score?: number;
      type?: string;
      crop_image?: string;
    }>;
  }>;
}

export interface HgVisionRecognizedPlate {
  plate: string;
  score: number;
  detectionScore?: number;
  type?: string;
  cropImage?: string;
  raw: HgVisionPlateReadResponse;
}

@Injectable()
export class HgVisionService {
  private readonly logger = new Logger(HgVisionService.name);
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(private readonly configService: ConfigService) {}

  isConfigured() {
    return Boolean(
      this.baseUrl && this.clientId && this.clientSecret && this.enabled,
    );
  }

  isMockFallbackEnabled() {
    const value = this.configService.get<boolean | string>(
      'HGVISION_MOCK_FALLBACK_ENABLED',
      false,
    );
    return value === true || String(value).toLowerCase() === 'true';
  }

  async searchFaceFromDataUrl(
    snapshotImageBase64: string | undefined,
    topK = 5,
  ): Promise<HgVisionRecognizedFace | null> {
    if (!snapshotImageBase64 || !this.isConfigured()) return null;
    const image = this.parseDataUrl(snapshotImageBase64);
    if (!image) return null;

    const token = await this.getAccessToken();
    const form = new FormData();
    form.append('top_k', String(topK));
    form.append(
      'file',
      new Blob([image.buffer], { type: image.contentType }),
      'class-attendance.jpg',
    );

    const response = await fetch(
      `${this.baseUrl}/api/identification/faces/search`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      this.logger.warn(
        `HGVision face search failed: ${response.status} ${message.slice(0, 160)}`,
      );
      return null;
    }

    const data = (await response.json()) as HgVisionFaceSearchResponse;
    const match = this.bestMatch(data);
    if (!match?.face_ident) return null;
    return {
      faceIdent: match.face_ident,
      faceInfo: match.face_infor,
      score: Number(match.score ?? 0),
      faceImagePath: match.face_image_path,
      raw: data,
    };
  }

  async readLicensePlateFromDataUrl(
    snapshotImageBase64: string | undefined,
  ): Promise<HgVisionRecognizedPlate | null> {
    if (!snapshotImageBase64 || !this.isConfigured()) return null;
    const image = this.parseDataUrl(snapshotImageBase64);
    if (!image) return null;

    const token = await this.getAccessToken();
    const form = new FormData();
    form.append(
      'file',
      new Blob([image.buffer], { type: image.contentType }),
      'gate-access.jpg',
    );

    const response = await fetch(
      `${this.baseUrl}/api/identification/license-plates/read-from-image`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      },
    );

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      this.logger.warn(
        `HGVision plate read failed: ${response.status} ${message.slice(0, 160)}`,
      );
      return null;
    }

    const data = (await response.json()) as HgVisionPlateReadResponse;
    const plate = this.bestPlate(data);
    if (!plate?.plate) return null;
    return {
      plate: plate.plate,
      score: Number(plate.score ?? 0),
      detectionScore: plate.det_score,
      type: plate.type,
      cropImage: plate.crop_image,
      raw: data,
    };
  }

  private async getAccessToken() {
    const now = Date.now();
    if (this.accessToken && now < this.tokenExpiresAt) {
      return this.accessToken;
    }

    const response = await fetch(`${this.baseUrl}/api/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: this.scope || undefined,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      const message = await response.text().catch(() => '');
      throw new Error(`HGVision token failed: ${response.status} ${message}`);
    }

    const data = (await response.json()) as HgVisionTokenResponse;
    if (!data.access_token) {
      throw new Error('HGVision token response has no access_token');
    }

    const expiresIn = Number(data.expires_in ?? 3600);
    this.accessToken = data.access_token;
    this.tokenExpiresAt = now + Math.max(30, expiresIn - 60) * 1000;
    return this.accessToken;
  }

  private bestMatch(data: HgVisionFaceSearchResponse) {
    const matches = [
      ...(data.faces ?? []).flatMap((face) => face.matches ?? []),
      ...(data.results ?? []).flatMap((result) => result.matches ?? []),
    ];
    return matches
      .filter((match) => match.face_ident)
      .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))[0];
  }

  private bestPlate(data: HgVisionPlateReadResponse) {
    const plates = (data.results ?? []).flatMap(
      (result) => result.plates ?? [],
    );
    return plates
      .filter((plate) => plate.plate)
      .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))[0];
  }

  private parseDataUrl(value: string) {
    const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) return null;
    return {
      contentType: match[1],
      buffer: Buffer.from(match[2], 'base64'),
    };
  }

  private get baseUrl() {
    return this.configService
      .get<string>('HGVISION_BASE_URL', '')
      .replace(/\/+$/, '');
  }

  private get enabled() {
    const value = this.configService.get<boolean | string>(
      'HGVISION_ENABLED',
      false,
    );
    return value === true || String(value).toLowerCase() === 'true';
  }

  private get clientId() {
    return this.configService.get<string>('HGVISION_CLIENT_ID', '');
  }

  private get clientSecret() {
    return this.configService.get<string>('HGVISION_CLIENT_SECRET', '');
  }

  private get scope() {
    return this.configService.get<string>(
      'HGVISION_SCOPE',
      'faces:read cameras:read',
    );
  }

  private get timeoutMs() {
    return Number(this.configService.get<number>('HGVISION_TIMEOUT_MS', 8000));
  }
}
