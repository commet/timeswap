import type { Assignment, ScheduleConfig, TimetableInput } from './types';
import { bit, dayOf, hasBit } from './slots';
import { closedReason, dayHoles, type Indexes } from './timetable';

/**
 * 교환 탐색의 단위.
 *
 * 수업 한 개를 단위로 삼으면 분반과 이동수업을 다룰 수 없다.
 * 2학년 수학이 세 반을 섞어 세 교사가 동시에 들어가는 수업이라면
 * 그 셋은 한 몸이라 따로 움직일 수 없기 때문이다.
 * 그래서 같은 교시에 같은 묶음 표시를 단 수업을 묶어 하나의 단위로 본다.
 *
 * 이 정의 하나로 현장의 세 가지 형태가 모두 담긴다.
 * 여러 교사와 여러 학급이 얽힌 이동수업, 한 학급에 두 교사가 들어가는 복수교사 수업,
 * 한 교사가 두 학급을 함께 맡는 합반 수업이다.
 */
export interface Unit {
  /** 같은 교시, 같은 묶음을 가리키는 열쇠 */
  key: string;
  slot: number;
  assignments: Assignment[];
  /** 중복 없는 교사 목록. 합반이면 한 교사가 여러 학급을 맡아도 한 번만 센다. */
  teachers: string[];
  /** 중복 없는 학급 목록 */
  klasses: string[];
  /** 묶음 수업인지. 수업 한 개짜리 단위는 false */
  grouped: boolean;
}

export const unitKey = (a: Assignment): string =>
  a.group ? `g:${a.group}|${a.slot}` : `s:${a.teacher}|${a.klass}|${a.slot}`;

/** 시간표 전체를 단위로 쪼갠다. */
export function buildUnits(input: TimetableInput): Map<string, Unit> {
  const units = new Map<string, Unit>();
  for (const a of input.assignments) {
    const key = unitKey(a);
    const u = units.get(key);
    if (u) {
      u.assignments.push(a);
      if (!u.teachers.includes(a.teacher)) u.teachers.push(a.teacher);
      if (!u.klasses.includes(a.klass)) u.klasses.push(a.klass);
      u.grouped = true;
    } else {
      units.set(key, {
        key,
        slot: a.slot,
        assignments: [a],
        teachers: [a.teacher],
        klasses: [a.klass],
        grouped: false,
      });
    }
  }
  // 묶음 표시는 있는데 실제로는 수업이 하나뿐인 경우도 묶음으로 둔다.
  // 나중에 같은 묶음의 다른 수업이 들어올 수 있고, 사용자에게도 묶음으로 보이기 때문이다.
  for (const u of units.values()) {
    if (u.assignments[0]?.group) u.grouped = true;
  }
  return units;
}

/** 단위를 사람이 읽을 이름으로. 조사는 붙이지 않는다. */
export function unitLabel(u: Unit): string {
  if (!u.grouped) return `${u.teachers[0]} 선생님`;
  const subjects = [...new Set(u.assignments.map((a) => a.subject))];
  if (subjects.length === 1) {
    return u.klasses.length === 1
      ? `${subjects[0]} 복수교사 수업`
      : `${subjects[0]} 이동수업 (${u.klasses.length}개 학급)`;
  }
  // 한 학급이 여러 강좌로 갈리는 편성.
  // 한동안 예술 계열에만 있는 줄 알았으나 전국 217곳을 재어 보니 아니었다.
  // 특성화고와 마이스터고는 칸의 15.8%, 일반고와 자율고도 109곳 가운데 56곳에 있다.
  if (u.klasses.length === 1) return `${u.klasses[0]} 분반 수업 (강좌 ${subjects.length}개)`;
  return `${u.klasses.length}개 학급이 강좌 ${subjects.length}개로 나뉘는 수업`;
}

/** 앞말의 받침에 따라 와 또는 과를 고른다. 괄호로 끝나면 마지막 한글을 본다. */
export function gwa(word: string): string {
  for (let i = word.length - 1; i >= 0; i--) {
    const c = word.charCodeAt(i);
    if (c >= 0xac00 && c <= 0xd7a3) return (c - 0xac00) % 28 === 0 ? '와' : '과';
  }
  return '와';
}

/** 단위 하나를 어느 교시로 옮긴다는 계획 */
export interface Move {
  unit: Unit;
  toSlot: number;
}

export interface Verdict {
  ok: boolean;
  /** 막힌 이유. 화면에 그대로 보여 줄 수 있는 문장 */
  reason?: string;
}

/**
 * 옮김 계획이 하드 제약을 모두 통과하는지 본다.
 *
 * 살피는 것은 여섯 가지다.
 * 교사가 같은 교시에 두 곳에 있게 되는지, 학급이 같은 교시에 두 수업을 받게 되는지,
 * 근무할 수 없는 시간에 배정되는지, 학급 하루 수업 중간에 빈 교시가 새로 생기는지,
 * 학사일정에 쉬는 날로 잡힌 요일로 가는지, 그리고 옮길 자리가 제자리는 아닌지다.
 *
 * 묶음은 통째로 움직이므로 묶음이 깨질 걱정은 애초에 없다.
 */
export function checkMoves(
  idx: Indexes,
  cfg: ScheduleConfig,
  moves: Move[],
): Verdict {
  if (moves.length === 0) return { ok: false, reason: '옮길 수업이 없습니다' };
  for (const m of moves) {
    if (m.toSlot === m.unit.slot) return { ok: false, reason: '제자리로는 옮길 수 없습니다' };
  }
  // 같은 단위를 두 번 옮기는 계획은 만들지 않는다
  const seen = new Set<string>();
  for (const m of moves) {
    if (seen.has(m.unit.key)) return { ok: false, reason: '같은 수업을 두 번 옮길 수 없습니다' };
    seen.add(m.unit.key);
  }

  // 교사별로 비우는 자리와 새로 앉는 자리를 모은다.
  const vacate = new Map<string, bigint>();
  const arrive = new Map<string, bigint>();
  const arriveCount = new Map<string, number>();
  const kVacate = new Map<string, bigint>();
  const kArrive = new Map<string, bigint>();
  const kArriveCount = new Map<string, number>();

  for (const m of moves) {
    for (const t of m.unit.teachers) {
      vacate.set(t, (vacate.get(t) ?? 0n) | bit(m.unit.slot));
      arrive.set(t, (arrive.get(t) ?? 0n) | bit(m.toSlot));
      arriveCount.set(t, (arriveCount.get(t) ?? 0) + 1);
    }
    for (const k of m.unit.klasses) {
      kVacate.set(k, (kVacate.get(k) ?? 0n) | bit(m.unit.slot));
      kArrive.set(k, (kArrive.get(k) ?? 0n) | bit(m.toSlot));
      kArriveCount.set(k, (kArriveCount.get(k) ?? 0) + 1);
    }
  }

  // 한 교사가 서로 다른 두 묶음에 들어 있는데 둘이 같은 교시로 가면 몸이 둘이어야 한다.
  for (const [t, n] of arriveCount) {
    if (popcount(arrive.get(t) ?? 0n) !== n) {
      return { ok: false, reason: `${t} 선생님이 같은 교시에 두 수업을 맡게 됩니다` };
    }
  }
  for (const [k, n] of kArriveCount) {
    if (popcount(kArrive.get(k) ?? 0n) !== n) {
      return { ok: false, reason: `${k} 학급이 같은 교시에 두 수업을 받게 됩니다` };
    }
  }

  for (const [t, arr] of arrive) {
    const stay = (idx.teacherMask.get(t) ?? 0n) & ~(vacate.get(t) ?? 0n);
    if ((stay & arr) !== 0n) {
      return { ok: false, reason: `${t} 선생님이 그 시간에 이미 수업이 있습니다` };
    }
    if (((idx.unavailMask.get(t) ?? 0n) & arr) !== 0n) {
      return { ok: false, reason: `${t} 선생님이 그 시간에는 근무할 수 없습니다` };
    }
  }
  for (const [k, arr] of kArrive) {
    const stay = (idx.klassMask.get(k) ?? 0n) & ~(kVacate.get(k) ?? 0n);
    if ((stay & arr) !== 0n) {
      return { ok: false, reason: `${k} 학급이 그 시간에 이미 수업이 있습니다` };
    }
    // 담당 교사를 아직 안 채운 수업이 있는 자리도 차 있는 자리다.
    // 비우는 계산에서 빼지 않는다. 모르는 수업을 우리가 옮길 수는 없기 때문이다.
    if (((idx.klassBusyMask.get(k) ?? 0n) & arr) !== 0n) {
      return {
        ok: false,
        reason: `${k} 학급이 그 시간에 수업이 있습니다 (담당 교사를 아직 안 채운 자리)`,
      };
    }
  }

  // 요일마다 교시 수가 다른 학교가 많다. 수요일 단축수업, 금요일 6교시 없음이 그렇다.
  // 격자는 네모라 없는 시간도 빈 칸으로 보인다. 학교가 알려 준 경우에만 막는다.
  // 짐작하지 않는 이유는 작은 학교에서 그저 비어 있는 칸과 가릴 수 없기 때문이다.
  const perDay = cfg.periodsPerDay;
  if (perDay) {
    for (const m of moves) {
      const d = dayOf(m.toSlot, cfg);
      const p = m.toSlot - d * cfg.periods;
      const limit = perDay[d];
      if (limit !== undefined && p >= limit) {
        return { ok: false, reason: `${cfg.dayNames[d]}요일은 ${limit}교시까지입니다` };
      }
    }
  }

  // 학사일정에 쉬는 날로 잡힌 요일에는 수업을 넣지 않는다.
  // 휴업일 목요일로 옮기라는 추천이 한 번 나오면 나머지 추천까지 못 믿게 된다.
  for (const m of moves) {
    const toDay = dayOf(m.toSlot, cfg);
    for (const k of m.unit.klasses) {
      const why = closedReason(idx, k, toDay);
      if (why !== undefined) {
        return { ok: false, reason: `${cfg.dayNames[toDay]}요일은 ${why}이라 수업이 없습니다` };
      }
    }
  }

  // 학급 하루 수업의 중간 빈틈이 늘면 안 된다. 그날 마지막 교시가 사라지는 축소는 허용한다.
  // 담당 교사를 모르는 수업도 수업으로 세어야 그 자리가 빈 시간으로 잡히지 않는다.
  for (const [k, arr] of kArrive) {
    const busy = idx.klassBusyMask.get(k) ?? 0n;
    const before = (idx.klassMask.get(k) ?? 0n) | busy;
    const after = ((before & ~(kVacate.get(k) ?? 0n)) | arr) | busy;
    const days = new Set<number>();
    for (const m of moves) {
      if (!m.unit.klasses.includes(k)) continue;
      days.add(dayOf(m.unit.slot, cfg));
      days.add(dayOf(m.toSlot, cfg));
    }
    for (const d of days) {
      if (dayHoles(after, d, cfg) > dayHoles(before, d, cfg)) {
        return { ok: false, reason: `${k} 학급 시간표에 빈 시간이 생깁니다` };
      }
    }
  }
  return { ok: true };
}

/** 옮긴 뒤 학급의 빈 교시가 오히려 줄어드는지. 안내 문구에 쓴다. */
export function fillsHole(idx: Indexes, cfg: ScheduleConfig, moves: Move[]): boolean {
  for (const m of moves) {
    for (const k of m.unit.klasses) {
      const before = idx.klassMask.get(k) ?? 0n;
      const after = (before & ~bit(m.unit.slot)) | bit(m.toSlot);
      const d = dayOf(m.toSlot, cfg);
      if (dayHoles(after, d, cfg) < dayHoles(before, d, cfg)) return true;
    }
  }
  return false;
}

function popcount(mask: bigint): number {
  let n = 0;
  let m = mask;
  while (m > 0n) {
    if (m & 1n) n++;
    m >>= 1n;
  }
  return n;
}

/** 교사가 그 교시에 비어 있는지. 자기 단위가 비우는 자리는 빼고 본다. */
export function teacherFree(idx: Indexes, teacher: string, slot: number, ignore: bigint): boolean {
  const mask = (idx.teacherMask.get(teacher) ?? 0n) & ~ignore;
  if (hasBit(mask, slot)) return false;
  return !hasBit(idx.unavailMask.get(teacher) ?? 0n, slot);
}
