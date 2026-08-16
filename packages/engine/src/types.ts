/** 주간 시간표의 좌표계. 슬롯 = day * periods + period. */
export interface ScheduleConfig {
  days: number;
  periods: number;
  dayNames: string[];
}

/** 수업 1개. group 은 분반, 동시수업 묶음 식별자(있으면 v0 엔진은 이동 후보에서 제외). */
export interface Assignment {
  teacher: string;
  klass: string;
  subject: string;
  slot: number;
  group?: string;
}

export interface TimetableInput {
  config: ScheduleConfig;
  assignments: Assignment[];
  /** 교사별 근무 불가 슬롯(연수, 출장 고정 시간 등) */
  unavailable?: Record<string, number[]>;
  /** 교사별 최근 보강, 교환 부담 횟수. 추천 시 부담 균형 감점에 쓴다. */
  recentBurden?: Record<string, number>;
}

export type CandidateType = 'move' | 'swap2' | 'cycle3';

/** 수업 1개의 이동: from 의 수업을 toSlot 으로 옮긴다. */
export interface Change {
  from: Assignment;
  toSlot: number;
}

export interface TraceEntry {
  kind: '조건' | '감점' | '가점';
  text: string;
  points?: number;
}

export interface Candidate {
  type: CandidateType;
  title: string;
  changes: Change[];
  score: number;
  trace: TraceEntry[];
}
