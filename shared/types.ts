// ─── Policy ──────────────────────────────────────────────────────────────────

export type IssueCategory =
  | "stop-word"         // запрещённое слово/оборот
  | "style"             // стилистическая ошибка
  | "abbreviation"      // неверное сокращение
  | "tone"              // нарушение тональности
  | "structure"         // структурная проблема (заголовок, абзац)
  | "typography"        // типографика (кавычки, тире, пробелы)
  | "factual"           // фактическая неточность по правилам
  | "custom";           // пользовательское правило из политики

export interface PolicyRule {
  id: string;
  category: IssueCategory;
  name: string;
  description: string;          // развёрнутое описание правила
  severity: "error" | "warning" | "info";
  examples?: { bad: string; good: string }[];
  source?: string;              // номер пункта / раздел документа политики
}

export interface PolicyDocument {
  id: string;
  name: string;
  uploadedAt: string;           // ISO timestamp
  rawText: string;              // полный текст документа политики
  rules: PolicyRule[];          // извлечённые/сгенерированные правила
  aiParsed: boolean;
}

// ─── Findings ────────────────────────────────────────────────────────────────

export interface PolicyViolation {
  id: string;
  ruleId: string;
  category: IssueCategory;
  severity: "error" | "warning" | "info";
  start: number;                // byte offset в проверяемом тексте
  end: number;
  matchedText: string;          // оригинальный фрагмент
  suggestion?: string;          // предлагаемая замена
  explanation?: string;         // AI-объяснение конкретного нарушения
  confidence: number;           // 0..1
  source: "heuristic" | "ai";
}

export interface CheckResult {
  violations: PolicyViolation[];
  summary?: string;
  detectedLanguage?: "ru" | "en" | "mixed";
  checkedAt: string;
  model?: string;
}

// ─── API shapes ──────────────────────────────────────────────────────────────

export interface ParsePolicyRequest {
  rawText: string;
  name: string;
}

export interface ParsePolicyResponse {
  rules: PolicyRule[];
  summary?: string;
  error?: string;
  _label?: string;
}

export interface CheckDocumentRequest {
  documentText: string;
  policyId: string;
  language?: "ru" | "en" | "auto";
}

export interface CheckDocumentResponse extends CheckResult {
  error?: string;
  _label?: string;
}
