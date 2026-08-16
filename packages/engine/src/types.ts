/** 주간 시간표의 좌표계. 슬롯 = day * periods + period. */
export interface ScheduleConfig {
  days: number;
  periods: number;
  dayNames: string[];
  /**
   * 점심시간이 몇 교시 뒤에 오는지. 4 이면 4교시와 5교시 사이가 점심이다.
   * 점심을 사이에 두고 수업이 이어 붙는 것을 가려내는 데 쓴다. 없으면 가운데로 본다.
   */
  lunchAfterPeriod?: number;
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
  /**
   * 자리를 옮기는 묶음의 수. 분반과 이동수업은 여러 수업이 한 몸으로 움직이므로
   * changes 의 길이와 다르다. 사람이 내리는 결정의 수는 이쪽이다.
   */
  unitCount?: number;
  score: number;
  trace: TraceEntry[];
}
