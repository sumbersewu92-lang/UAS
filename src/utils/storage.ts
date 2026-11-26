import type { OptionKey } from '../types';

const DEVICE_KEY = 'ujianku_device_id';
const DRAFT_PREFIX = 'ujianku_draft_';

export interface PendingViolation {
  violationType: string;
  detail: string;
  createdAt: string;
}

export interface ExamDraft {
  sessionId: string;
  examId: string;
  nis: string;
  answers: Record<string, OptionKey>;
  pendingSync: Record<string, OptionKey>;
  pendingViolations: PendingViolation[];
  updatedAt: string;
}

export function getOrCreateDeviceId(): string {
  try {
    let existing = localStorage.getItem(DEVICE_KEY);
    if (!existing) {
      const rand =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      existing = `dev-${rand}`;
      localStorage.setItem(DEVICE_KEY, existing);
    }
    return existing;
  } catch {
    return `dev-mem-${Date.now()}`;
  }
}

function getDraftKey(examId: string, nis: string): string {
  return `${DRAFT_PREFIX}${examId}_${nis.trim().toUpperCase()}`;
}

export function loadExamDraft(examId: string, nis: string): ExamDraft | null {
  try {
    const raw = localStorage.getItem(getDraftKey(examId, nis));
    if (!raw) return null;
    return JSON.parse(raw) as ExamDraft;
  } catch {
    return null;
  }
}

export function saveExamDraft(draft: ExamDraft): void {
  try {
    localStorage.setItem(getDraftKey(draft.examId, draft.nis), JSON.stringify(draft));
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export function clearExamDraft(examId: string, nis: string): void {
  try {
    localStorage.removeItem(getDraftKey(examId, nis));
  } catch {
    // Ignore
  }
}
