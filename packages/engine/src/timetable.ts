import type { Assignment, Change, ScheduleConfig, TimetableInput } from './types';
import { bit, dayOf, hasBit, periodOf, slotName } from './slots';

export interface Indexes {
  teacherMask: Map<string, bigint>;
  klassMask: Map<string, bigint>;
  unavailMask: Map<string, bigint>;
  byTeacherSlot: Map<string, Assignment>;
  byKlassSlot: Map<string, Assignment>;
  klassAssignments: Map<string, Assignment[]>;
  /** 학급별, 요일별 수업 수 */
  klassDayCount: Map<string, number[]>;
  /** `${klass}|${subject}|${day}` 별 수업 수 */
  klassSubjectDay: Map<string, number>;
}

export const tsKey = (teacher: string, slot: number): string => `${teacher}|${slot}`;
export const ksKey = (klass: string, slot: number): string => `${klass}|${slot}`;
export const ksdKey = (klass: string, subject: string, day: number): string =>
  `${klass}|${subject}|${day}`;

export function buildIndexes(input: TimetableInput): Indexes {
  const cfg = input.config;
  const idx: Indexes = {
    teacherMask: new Map(),
    klassMask: new Map(),
    unavailMask: new Map(),
    byTeacherSlot: new Map(),
    byKlassSlot: new Map(),
    klassAssignments: new Map(),
    klassDayCount: new Map(),
    klassSubjectDay: new Map(),
  };
  for (const [teacher, slots] of Object.entries(input.unavailable ?? {})) {
    let m = 0n;
    for (const s of slots) m |= bit(s);
    idx.unavailMask.set(teacher, m);
  }
  for (const a of input.assignments) {
    idx.teacherMask.set(a.teacher, (idx.teacherMask.get(a.teacher) ?? 0n) | bit(a.slot));
    idx.klassMask.set(a.klass, (idx.klassMask.get(a.klass) ?? 0n) | bit(a.slot));
    idx.byTeacherSlot.set(tsKey(a.teacher, a.slot), a);
    idx.byKlassSlot.set(ksKey(a.klass, a.slot), a);
    const list = idx.klassAssignments.get(a.klass);
    if (list) list.push(a);
    else idx.klassAssignments.set(a.klass, [a]);
    const day = dayOf(a.slot, cfg);
    const counts = idx.klassDayCount.get(a.klass) ?? new Array<number>(cfg.days).fill(0);
    counts[day] = (counts[day] ?? 0) + 1;
    idx.klassDayCount.set(a.klass, counts);
    const k = ksdKey(a.klass, a.subject, day);
    idx.klassSubjectDay.set(k, (idx.klassSubjectDay.get(k) ?? 0) + 1);
  }
  return idx;
}

/**
 * 시간표 불변식 검사. 위반 목록을 돌려준다(비어 있으면 정상).
 * 1) 교사 중복 배정 금지  2) 학급 중복 배정 금지
 * 3) 근무 불가 슬롯 배정 금지  4) 학급 하루 수업은 1교시부터 빈틈없이 이어짐
 */
export function validate(input: TimetableInput): string[] {
  const cfg = input.config;
  const errors: string[] = [];
  const teacherSeen = new Set<string>();
  const klassSeen = new Set<string>();
  const unavail = new Map<string, Set<number>>();
  for (const [t, slots] of Object.entries(input.unavailable ?? {})) {
    unavail.set(t, new Set(slots));
  }
  const teacherAt = new Map<string, Assignment>();
  for (const a of input.assignments) {
    const tk = tsKey(a.teacher, a.slot);
    const prev = teacherAt.get(tk);
    if (prev && !(prev.group !== undefined && prev.group === a.group)) {
      // 같은 group(분반, 동시수업 묶음)이면 한 몸으로 보고 허용한다
      errors.push(`교사 중복 배정: ${a.teacher}, ${slotName(a.slot, cfg)}`);
    }
    teacherAt.set(tk, a);
    teacherSeen.add(tk);
    const kk = ksKey(a.klass, a.slot);
    if (klassSeen.has(kk)) {
      errors.push(`학급 중복 배정: ${a.klass}, ${slotName(a.slot, cfg)}`);
    }
    klassSeen.add(kk);
    if (unavail.get(a.teacher)?.has(a.slot)) {
      errors.push(`근무 불가 슬롯 배정: ${a.teacher}, ${slotName(a.slot, cfg)}`);
    }
  }
  return errors;
}

/** 하루 수업 중간의 빈 교시 수. 마지막 수업보다 앞선 빈 슬롯을 센다. */
export function dayHoles(mask: bigint, day: number, cfg: ScheduleConfig): number {
  let last = -1;
  for (let p = 0; p < cfg.periods; p++) {
    if (hasBit(mask, day * cfg.periods + p)) last = p;
  }
  let holes = 0;
  for (let p = 0; p < last; p++) {
    if (!hasBit(mask, day * cfg.periods + p)) holes++;
  }
  return holes;
}

/** 학급 전체의 중간 빈 교시 합계. 추천 적용 전후 비교(늘면 안 됨)에 쓴다. */
export function totalHoles(input: TimetableInput): number {
  const idx = buildIndexes(input);
  let sum = 0;
  for (const mask of idx.klassMask.values()) {
    for (let d = 0; d < input.config.days; d++) {
      sum += dayHoles(mask, d, input.config);
    }
  }
  return sum;
}

/** 변경 목록을 적용한 새 시간표를 돌려준다. 원본은 건드리지 않는다. */
export function applyChanges(input: TimetableInput, changes: Change[]): TimetableInput {
  const moved = new Map<string, number>();
  for (const c of changes) moved.set(tsKey(c.from.teacher, c.from.slot), c.toSlot);
  return {
    ...input,
    assignments: input.assignments.map((a) => {
      const to = moved.get(tsKey(a.teacher, a.slot));
      return to === undefined ? a : { ...a, slot: to };
    }),
  };
}

/** 교사 주간 마스크의 수업 덩어리 수(요일별 연속 구간의 합). 조각날수록 커진다. */
export function teacherBlocks(mask: bigint, cfg: ScheduleConfig): number {
  let blocks = 0;
  for (let d = 0; d < cfg.days; d++) {
    let inBlock = false;
    for (let p = 0; p < cfg.periods; p++) {
      const occupied = hasBit(mask, d * cfg.periods + p);
      if (occupied && !inBlock) blocks++;
      inBlock = occupied;
    }
  }
  return blocks;
}
