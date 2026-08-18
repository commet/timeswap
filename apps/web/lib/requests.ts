import type { Assignment, Candidate, CoverCandidate } from '@timeswap/engine';

export const REQUESTS_KEY = 'joyul:v1:requests';

export type RequestReason = '업무상 부재' | '연수·출장' | '기타';
export type RequestStatus = 'pending' | 'approved' | 'rejected' | 'cancelled' | 'published';
export type ChecklistKey = 'neis' | 'notice' | 'document';

export interface RequestChecklist {
  neis: boolean;
  notice: boolean;
  document: boolean;
}

export interface ChangeRequest {
  id: string;
  createdAt: string;
  date: string;
  teacher: string;
  reason: RequestReason;
  note?: string;
  target: Assignment;
  candidate: Candidate;
  alternatives?: Candidate[];
  kind: 'change' | 'cover';
  cover?: CoverCandidate;
  status: RequestStatus;
  adminNote?: string;
  checklist: RequestChecklist;
}

export interface CreateRequestInput {
  date: string;
  teacher: string;
  reason: RequestReason;
  note?: string;
  target: Assignment;
  candidate: Candidate;
  alternatives?: Candidate[];
}

export interface CreateCoverRequestInput {
  date: string;
  teacher: string;
  reason: RequestReason;
  note?: string;
  target: Assignment;
  cover: CoverCandidate;
}

interface CreateOptions {
  id?: string;
  now?: string;
}

const emptyChecklist = (): RequestChecklist => ({
  neis: false,
  notice: false,
  document: false,
});

export function createRequest(input: CreateRequestInput, options: CreateOptions = {}): ChangeRequest {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error('변경할 날짜를 확인해 주십시오.');
  }
  if (input.teacher.trim() === '') {
    throw new Error('요청자를 확인해 주십시오.');
  }
  if (!input.target || !input.candidate || input.candidate.changes.length === 0) {
    throw new Error('변경할 수업과 후보를 확인해 주십시오.');
  }

  return {
    id: options.id ?? crypto.randomUUID(),
    createdAt: options.now ?? new Date().toISOString(),
    date: input.date,
    teacher: input.teacher.trim(),
    reason: input.reason,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    target: input.target,
    candidate: input.candidate,
    ...(input.alternatives && input.alternatives.length > 1
      ? { alternatives: input.alternatives.slice(0, 12) }
      : {}),
    kind: 'change',
    status: 'pending',
    checklist: emptyChecklist(),
  };
}

export function selectCandidate(request: ChangeRequest, candidate: Candidate): ChangeRequest {
  if (request.status !== 'pending' || request.kind !== 'change') {
    throw new Error('검토 중인 교체 요청만 다른 안으로 바꿀 수 있습니다.');
  }
  const alternatives = request.alternatives ?? [request.candidate];
  const matched = alternatives.find(
    (item) => item.type === candidate.type && item.title === candidate.title,
  );
  if (!matched) throw new Error('이 요청에 포함되지 않은 교체안입니다.');
  return { ...request, candidate: matched };
}

export function createCoverRequest(
  input: CreateCoverRequestInput,
  options: CreateOptions = {},
): ChangeRequest {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error('변경할 날짜를 확인해 주십시오.');
  }
  if (input.teacher.trim() === '' || input.cover.teacher.trim() === '') {
    throw new Error('요청자와 보강 교사를 확인해 주십시오.');
  }
  const candidate: Candidate = {
    type: 'move',
    title: input.cover.teacher + ' 선생님 보강',
    score: input.cover.score,
    unitCount: 1,
    changes: [{ from: input.target, toSlot: input.target.slot }],
    trace: input.cover.notes.map((text) => ({ kind: '조건' as const, text })),
  };
  return {
    id: options.id ?? crypto.randomUUID(),
    createdAt: options.now ?? new Date().toISOString(),
    date: input.date,
    teacher: input.teacher.trim(),
    reason: input.reason,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    target: input.target,
    candidate,
    kind: 'cover',
    cover: input.cover,
    status: 'pending',
    checklist: emptyChecklist(),
  };
}

export function transitionRequest(
  request: ChangeRequest,
  next: RequestStatus,
  adminNote?: string,
): ChangeRequest {
  const fromPending = next === 'approved' || next === 'rejected' || next === 'cancelled';
  if (request.status === 'pending' && fromPending) {
    return {
      ...request,
      status: next,
      ...(adminNote?.trim() ? { adminNote: adminNote.trim() } : {}),
    };
  }

  if (request.status === 'approved' && next === 'published') {
    if (!Object.values(request.checklist).every(Boolean)) {
      throw new Error('행정 마무리 세 단계를 먼저 완료해 주십시오.');
    }
    return { ...request, status: 'published' };
  }

  throw new Error('현재 상태에서는 그렇게 바꿀 수 없습니다.');
}

export function setChecklist(
  request: ChangeRequest,
  key: ChecklistKey,
  checked: boolean,
): ChangeRequest {
  if (request.status !== 'approved') {
    throw new Error('승인된 요청만 행정 마무리를 할 수 있습니다.');
  }
  return {
    ...request,
    checklist: { ...request.checklist, [key]: checked },
  };
}

function isRequest(value: unknown): value is ChangeRequest {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ChangeRequest>;
  return (
    typeof r.id === 'string' &&
    typeof r.createdAt === 'string' &&
    typeof r.date === 'string' &&
    typeof r.teacher === 'string' &&
    typeof r.reason === 'string' &&
    typeof r.status === 'string' &&
    !!r.target &&
    !!r.candidate &&
    !!r.checklist
  );
}

export function encodeRequests(requests: ChangeRequest[]): string {
  return JSON.stringify({ version: 1, requests });
}

export function decodeRequests(raw: string): ChangeRequest[] {
  try {
    const data = JSON.parse(raw) as { version?: number; requests?: unknown[] };
    if (data.version !== 1 || !Array.isArray(data.requests)) return [];
    return data.requests.filter(isRequest);
  } catch {
    return [];
  }
}

export function loadRequests(): ChangeRequest[] {
  try {
    const raw = localStorage.getItem(REQUESTS_KEY);
    return raw ? decodeRequests(raw) : [];
  } catch {
    return [];
  }
}

export function saveRequests(requests: ChangeRequest[]): boolean {
  try {
    localStorage.setItem(REQUESTS_KEY, encodeRequests(requests));
    return true;
  } catch {
    return false;
  }
}

export function requestStatusLabel(status: RequestStatus): string {
  return {
    pending: '검토 중',
    approved: '승인',
    rejected: '반려',
    cancelled: '취소',
    published: '게시 완료',
  }[status];
}
