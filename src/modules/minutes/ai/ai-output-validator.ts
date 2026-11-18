/**
 * MKM-AI-01 — validator tay cho output LLM theo schema spec 5.3 (FR-006).
 * Pattern schemas.py của worker STT: không phụ thuộc jsonschema/zod/ajv,
 * chỉ kiểm field/type/enum bắt buộc — đủ để chặn JSON sai trước khi ghi DB.
 * Lỗi trả về dạng message cụ thể để đưa vào repair-prompt (FR-019).
 */

export type AiConfidence = 'high' | 'medium' | 'low';

export interface AiDecision {
  text: string;
  confidence: AiConfidence;
  evidence: string;
}

export interface AiActionItem {
  task: string;
  owner: string;
  deadline: string;
  confidence: AiConfidence;
}

export interface AiMinutesOutput {
  summary: string;
  keyPoints: string[];
  decisions: AiDecision[];
  actionItems: AiActionItem[];
  risks: string[];
  openQuestions: string[];
  uncertainParts: string[];
}

export type AiOutputValidation =
  | { ok: true; data: AiMinutesOutput }
  | { ok: false; error: string };

const TOP_LEVEL_KEYS = [
  'summary',
  'keyPoints',
  'decisions',
  'actionItems',
  'risks',
  'openQuestions',
  'uncertainParts',
] as const;

const STRING_ARRAY_KEYS = [
  'keyPoints',
  'risks',
  'openQuestions',
  'uncertainParts',
] as const;

const CONFIDENCE_VALUES: readonly string[] = ['high', 'medium', 'low'];

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

export function validateAiOutput(raw: string): AiOutputValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Không parse được kết quả AI thành JSON hợp lệ' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, error: 'Output phai la mot JSON object' };
  }

  const obj = parsed as Record<string, unknown>;

  // Reject key ngoài schema (spec 4.5: output không chứa nội dung ngoài schema)
  for (const key of Object.keys(obj)) {
    if (!(TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
      return { ok: false, error: `Key ngoai schema: "${key}"` };
    }
  }

  for (const key of TOP_LEVEL_KEYS) {
    if (!(key in obj)) {
      return { ok: false, error: `Thiếu trường bắt buộc: "${key}"` };
    }
  }

  if (typeof obj.summary !== 'string' || obj.summary.trim() === '') {
    return { ok: false, error: '"summary" phải là chuỗi không rỗng' };
  }

  for (const key of STRING_ARRAY_KEYS) {
    if (!isStringArray(obj[key])) {
      return { ok: false, error: `"${key}" phai la mang string` };
    }
  }

  if (!Array.isArray(obj.decisions)) {
    return { ok: false, error: '"decisions" phai la mang' };
  }
  for (let i = 0; i < obj.decisions.length; i++) {
    const d = obj.decisions[i] as Record<string, unknown>;
    if (typeof d !== 'object' || d === null) {
      return { ok: false, error: `decisions[${i}] phai la object` };
    }
    if (typeof d.text !== 'string' || typeof d.evidence !== 'string') {
      return {
        ok: false,
        error: `decisions[${i}] thieu/sai kieu "text" hoac "evidence"`,
      };
    }
    if (
      typeof d.confidence !== 'string' ||
      !CONFIDENCE_VALUES.includes(d.confidence)
    ) {
      return {
        ok: false,
        error: `decisions[${i}].confidence phai thuoc high|medium|low`,
      };
    }
  }

  if (!Array.isArray(obj.actionItems)) {
    return { ok: false, error: '"actionItems" phai la mang' };
  }
  for (let i = 0; i < obj.actionItems.length; i++) {
    const a = obj.actionItems[i] as Record<string, unknown>;
    if (typeof a !== 'object' || a === null) {
      return { ok: false, error: `actionItems[${i}] phai la object` };
    }
    // FR-021/spec 4.5: actionItems không được thiếu task/owner/deadline
    if (
      typeof a.task !== 'string' ||
      typeof a.owner !== 'string' ||
      typeof a.deadline !== 'string'
    ) {
      return {
        ok: false,
        error: `actionItems[${i}] thieu/sai kieu "task"/"owner"/"deadline"`,
      };
    }
    if (
      typeof a.confidence !== 'string' ||
      !CONFIDENCE_VALUES.includes(a.confidence)
    ) {
      return {
        ok: false,
        error: `actionItems[${i}].confidence phai thuoc high|medium|low`,
      };
    }
  }

  return { ok: true, data: obj as unknown as AiMinutesOutput };
}
