import { Injectable } from '@nestjs/common';
import {
  LlmProviderPort,
  NonRetryableAiJobError,
} from './llm-provider.port.js';
import { MockLlmProvider } from './mock-llm.provider.js';
import { OllamaLlmProvider } from './ollama-llm.provider.js';

/**
 * MKM-AI-01 — resolve LlmProviderPort theo config_json.provider lúc chạy job
 * (đổi provider qua system_configs, không sửa code — NFR-012).
 * mock -> MockLlmProvider (dev/test); self_hosted_llm -> OllamaLlmProvider (T016).
 */
@Injectable()
export class LlmProviderFactory {
  constructor(
    private readonly mockProvider: MockLlmProvider,
    private readonly ollamaProvider: OllamaLlmProvider,
  ) {}

  resolve(provider: string): LlmProviderPort {
    if (provider === 'mock') {
      return this.mockProvider;
    }
    if (provider === 'self_hosted_llm') {
      return this.ollamaProvider;
    }
    // Provider lạ trong config là lỗi cấu hình — fail ngay không retry.
    throw new NonRetryableAiJobError(
      'AI_SUMMARY_DISABLED',
      `Nhà cung cấp "${provider}" chưa được hỗ trợ`,
    );
  }
}
