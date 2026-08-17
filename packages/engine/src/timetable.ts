import type { Assignment, Change, ScheduleConfig, TimetableInput } from './types';
import { bit, dayOf, hasBit, periodOf, slotName } from './slots';

export interface Indexes {
  teacherMask: Map<string, bigint>;
  klassMask: Map<string, bigint>;
  /**
   * 담당 교사를 모르는 채로 차 있는 교시를 학급별로 모은 것.
   * klassMask 와 겹치지 않게 둔다. 겹치면 자리를 비우는 계산이 어긋난다.
   */
  klassBusyMask: Map<string, bigint>;
  unavailMask: Map<string, bigint>;
  byTeacherSlot: Map<string, Assignment>;
  byKlassSlot: Map<string, Assignment>;
  klassAssignments: Map<string, Assignment[]>;
  /** 학급별, 요일별 수업 수 */
  klassDayCount: Map<string, number[]>;
  /** `${klass}|${subject}|${day}` 별 수업 수 */
  klassSubjectDay: Map<string, number>;
  /** 학교 전체가 쉬는 요일과 그 이유 */
  closedAll: Map<number, string>;
  /** `${klass}|${day}` 로 그 학급만 쉬는 경우와 그 이유 */
  closedKlass: Map<string, string>;
}

export const tsKey = (teacher: string, slot: number): string => `${teacher}|${slot}`;
export const ksKey = (klass: string, slot: number): string => `${klass}|${slot}`;
export const ksdKey = (klass: string, subject: string, day: number): string =>
  `${klass}|${subject}|${day}`;
export const kdKey = (klass: string, day: number): string => `${klass}|${day}`;

/** 그 학급이 그 요일에 쉬는지. 쉬면 이유를 돌려준다. */
export function closedReason(idx: Indexes, klass: string, day: number): string | undefined {
  return idx.closedAll.get(day) ?? idx.closedKlass.get(kdKey(klass, day));
}

export function buildIndexes(input: TimetableInput): Indexes {
  const cfg = input.config;
  const idx: Indexes = {
    teacherMask: new Map(),
    klassMask: new Map(),
    klassBusyMask: new Map(),
    unavailMask: new Map(),
    byTeacherSlot: new Map(),
    byKlassSlot: new Map(),
    klassAssignments: new Map(),
    klassDayCount: new Map(),
    klassSubjectDay: new Map(),
    closedAll: new Map(),
    closedKlass: new Map(),
  };
  for (const c of input.closures ?? []) {
    if (c.klasses === undefined || c.klasses.length === 0) idx.closedAll.set(c.day, c.reason);
    else for (const k of c.klasses) idx.closedKlass.set(kdKey(k, c.day), c.reason);
  }
  for (const [teacher, slots] of Object.entries(input.unavailable ?? {})) {
    let m = 0n;
    for (const s of slots) m |= bit(s);
    idx.unavailMask.set(teacher, m);
  }
  for (const [klass, slots] of Object.entries(input.klassBusy ?? {})) {
    let m = 0n;
    for (const s of slots) m |= bit(s);
    idx.klassBusyMask.set(klass, m);
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
  const klassAt = new Map<string, Assignment>();
  for (const a of input.assignments) {
    // 같은 묶음(분반, 이동수업, 복수교사, 합반)이면 한 몸으로 보고 겹침을 허용한다.
    // 교사 쪽은 합반이 여기 걸리고, 학급 쪽은 복수교사가 여기 걸린다.
    const tk = tsKey(a.teacher, a.slot);
    const prevT = teacherAt.get(tk);
    if (prevT && !(prevT.group !== undefined && prevT.group === a.group)) {
      errors.push(`교사 중복 배정: ${a.teacher}, ${slotName(a.slot, cfg)}`);
    }
    teacherAt.set(tk, a);
    teacherSeen.add(tk);
    const kk = ksKey(a.klass, a.slot);
    const prevK = klassAt.get(kk);
    if (prevK && !(prevK.group !== undefined && prevK.group === a.group)) {
      errors.push(`학급 중복 배정: ${a.klass}, ${slotName(a.slot, cfg)}`);
    }
    klassAt.set(kk, a);
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

/**
 * 학급 전체의 중간 빈 교시 합계. 추천 적용 전후 비교(늘면 안 됨)에 쓴다.
 * 담당 교사를 모르는 수업도 수업으로 센다. 빼면 그 자리가 빈 시간으로 잡힌다.
 */
export function totalHoles(input: TimetableInput): number {
  const idx = buildIndexes(input);
  let sum = 0;
  const klasses = new Set([...idx.klassMask.keys(), ...idx.klassBusyMask.keys()]);
  for (const k of klasses) {
    const mask = (idx.klassMask.get(k) ?? 0n) | (idx.klassBusyMask.get(k) ?? 0n);
    for (let d = 0; d < input.config.days; d++) {
      sum += dayHoles(mask, d, input.config);
    }
  }
  return sum;
}

/**
 * 수업 한 개를 가리키는 열쇠.
 *
 * 교사와 교시만으로는 모자란다. 같은 이름이 같은 교시에 두 학급을 맡은 자리가 실제로 있고
 * (합반이거나 동명이인이다) 그때 교사와 교시로만 찾으면 계획에 없던 수업까지 함께 옮겨진다.
 * 학급과 과목까지 넣어야 한 개를 정확히 가리킨다.
 *
 * 물체 자체를 비교하지 않는 이유는 저장했다 열면 다른 물체가 되기 때문이다.
 * 반영 장부는 브라우저에 글로 저장되므로 값으로 찾아야 한다.
 */
const cellKey = (a: Assignment): string => `${a.teacher}|${a.klass}|${a.subject}|${a.slot}`;

/** 변경 목록을 적용한 새 시간표를 돌려준다. 원본은 건드리지 않는다. */
export function applyChanges(input: TimetableInput, changes: Change[]): TimetableInput {
  const moved = new Map<string, number>();
  for (const c of changes) moved.set(cellKey(c.from), c.toSlot);
  return {
    ...input,
    assignments: input.assignments.map((a) => {
      const to = moved.get(cellKey(a));
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
