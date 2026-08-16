import type { Candidate, TimetableInput } from './types';
import { bit, dayOf, hasBit, periodOf, slotName } from './slots';
import { ksdKey, teacherBlocks, type Indexes } from './timetable';

/**
 * 소프트 점수 가중치.
 *
 * 하드 제약은 되느냐 안 되느냐를 가르고, 여기 값들은 되는 것 가운데 무엇이 나은지를 가른다.
 * 항목은 현장에서 시간표 품질을 판정할 때 실제로 보는 것들을 옮겨 왔다.
 * 같은 요일에 과목이 몰리는지, 요일별 수업량이 한쪽으로 쏠리는지, 연강이 길어지는지,
 * 점심을 사이에 두고 이어 붙는지, 오전과 오후가 한쪽으로 기우는지가 그것이다.
 */
export const WEIGHTS = {
  /** 자리를 옮기는 묶음 1개당. 적게 건드릴수록 좋다 */
  perChange: -10,
  /** 같은 학급에 같은 과목이 하루 두 번 */
  subjectTwiceADay: -6,
  /** 교사의 연속 수업 덩어리가 쪼개질 때 1개당 */
  fragmentation: -4,
  /** 결강 당일 안에서 해결되는 안 */
  sameDayBonus: 5,
  /** 최근에 도와준 교사 1회당 */
  burdenPerPoint: -1,
  burdenCap: 3,
  /** 묶음이 딸려 움직일 때 함께 끌려가는 교사 1명당 */
  groupDragPerTeacher: -3,

  /** 교사가 하루에 서로 다른 과목을 3개 넘게 맡게 될 때, 초과 1개당 */
  manySubjectsADay: -4,
  /** 하루 수업이 이미 많은 요일로 더 밀어 넣을 때, 기준 초과 1시간당 */
  heavyDay: -3,
  /** 그날 수업 수 기준. 이보다 많아지면 무거운 날로 본다 */
  heavyDayThreshold: 5,
  /** 연속 3시간 이상이 새로 생길 때 1건당 */
  longRun: -5,
  /** 점심을 사이에 두고 앞뒤가 이어 붙을 때 */
  acrossLunch: -2,
  /** 오전과 오후의 균형이 더 나빠질 때 1단계당 */
  dayImbalance: -2,
  /** 같은 교사가 같은 학급을 하루에 두 번 만나게 될 때 */
  sameKlassTwiceADay: -4,
  /** 학급의 그날 마지막 교시 뒤로 수업이 더 붙어 하교가 늦어질 때 1교시당 */
  laterDismissal: -2,
  /**
   * 이어 붙은 같은 과목 덩어리에서 한 교시를 떼어 낼 때, 남는 교시 1개당.
   *
   * 실습과 실기는 여러 교시를 이어 붙여 편성한다. 앞 시간에 준비하고 뒤 시간에 만든다.
   * 그 가운데 한 교시만 다른 날로 보내는 안은 표 위에서만 성립한다.
   *
   * 학교 14곳을 재어 값을 정했다. 학급 하루 안에서 같은 과목이 이어진 길이를 셌다.
   *
   * | 무리 | 학교 | 덩어리 안 수업 칸 | 길이 3 이상 |
   * |---|---|---|---|
   * | 일반고 | 10곳 | 3.5% | 0개 |
   * | 마이스터고와 예술고 | 4곳 | 23~58% | 164개 |
   *
   * 일반고에서는 길이 3 이상이 하나도 없었다. 거기서 보이는 길이 2는 이어 하려고
   * 붙인 것이 아니라 편성하다 붙은 것일 때가 많다. 그래서 길이로 무게를 가른다.
   * 길이 2를 쪼개면 -8 로 묶음 하나를 더 옮기는 값(-10)과 비슷하고,
   * 길이 3은 -16, 길이 4는 -24 로 다른 어떤 항목보다 무겁다.
   *
   * 막지 않고 깎는 이유가 있다. 정말 아무 방법이 없을 때는 쪼개서라도 메우는 것이
   * 결손보다 낫고, 그 판단은 선생님 몫이다. 대신 근거 문장에 그대로 적어 보인다.
   */
  blockSplit: -8,
} as const;

/** 마스크에서 그 요일의 수업 수 */
function dayLoad(mask: bigint, day: number, cfg: { periods: number }): number {
  let n = 0;
  for (let p = 0; p < cfg.periods; p++) if (hasBit(mask, day * cfg.periods + p)) n++;
  return n;
}

/**
 * 그 학급 그날에서 slot 을 품고 이어진 같은 과목 덩어리의 길이.
 *
 * 분반이라 한 칸에 과목이 둘인 자리도 있다. 같은 과목이 이어졌는지만 보므로
 * 한쪽만 세면 되고, 실제로 나뉜 짝은 한 묶음이라 함께 움직인다.
 */
function subjectRun(
  idx: Indexes,
  cfg: { periods: number },
  klass: string,
  subject: string,
  slot: number,
): number {
  const day = Math.floor(slot / cfg.periods);
  const here = new Set<number>();
  for (const a of idx.klassAssignments.get(klass) ?? []) {
    if (a.subject === subject && Math.floor(a.slot / cfg.periods) === day) here.add(a.slot);
  }
  if (!here.has(slot)) return 0;
  let run = 1;
  for (let s = slot - 1; s >= day * cfg.periods && here.has(s); s--) run++;
  for (let s = slot + 1; s < (day + 1) * cfg.periods && here.has(s); s++) run++;
  return run;
}

/**
 * 옮기고 나서도 덩어리가 통째로 남는지.
 *
 * 통째로 남는 경우는 하나뿐이다. 같은 날 안에서 덩어리 끝에 다시 붙어, 길이도 줄지 않고
 * 사이가 끊기지도 않을 때다. 1, 2, 3교시 실습에서 1교시를 4교시로 옮기면 2, 3, 4교시가 된다.
 * 다른 날로 나가면 그날 덩어리가 짧아지므로 통째가 아니다.
 */
function stillWhole(
  idx: Indexes,
  cfg: { periods: number },
  klass: string,
  subject: string,
  from: number,
  to: number,
): boolean {
  const day = Math.floor(from / cfg.periods);
  if (Math.floor(to / cfg.periods) !== day) return false;
  const after = new Set<number>();
  for (const a of idx.klassAssignments.get(klass) ?? []) {
    if (a.subject === subject && Math.floor(a.slot / cfg.periods) === day && a.slot !== from) {
      after.add(a.slot);
    }
  }
  after.add(to);
  const slots = [...after].sort((x, y) => x - y);
  return slots[slots.length - 1]! - slots[0]! === slots.length - 1;
}

/** 그 요일에서 가장 긴 연속 수업 시간 */
function longestRun(mask: bigint, day: number, cfg: { periods: number }): number {
  let best = 0;
  let run = 0;
  for (let p = 0; p < cfg.periods; p++) {
    if (hasBit(mask, day * cfg.periods + p)) {
      run += 1;
      if (run > best) best = run;
    } else run = 0;
  }
  return best;
}

/** 점심 앞 교시와 뒤 교시가 모두 수업인지 */
function spansLunch(mask: bigint, day: number, cfg: { periods: number; lunchAfterPeriod?: number }): boolean {
  const after = cfg.lunchAfterPeriod ?? Math.floor(cfg.periods / 2);
  if (after <= 0 || after >= cfg.periods) return false;
  const before = day * cfg.periods + (after - 1);
  const next = day * cfg.periods + after;
  return hasBit(mask, before) && hasBit(mask, next);
}

/** 요일별 수업 수의 쏠림. 가장 많은 날과 가장 적은 날의 차이로 본다 */
function spread(mask: bigint, cfg: { periods: number; days: number }): number {
  let max = 0;
  let min = Number.MAX_SAFE_INTEGER;
  for (let d = 0; d < cfg.days; d++) {
    const n = dayLoad(mask, d, cfg);
    if (n > max) max = n;
    if (n < min) min = n;
  }
  return max - min;
}

/** 학급의 그날 마지막 교시 */
function lastPeriod(mask: bigint, day: number, cfg: { periods: number }): number {
  let last = -1;
  for (let p = 0; p < cfg.periods; p++) if (hasBit(mask, day * cfg.periods + p)) last = p;
  return last;
}

/**
 * 후보에 소프트 점수와 근거를 붙인다.
 * 하드 제약은 탐색 단계에서 이미 걸렀으므로 여기서는 순위만 가른다.
 */
export function scoreCandidate(idx: Indexes, input: TimetableInput, cand: Candidate): void {
  const cfg = input.config;
  let score = 0;
  const note = (kind: '감점' | '가점' | '조건', points: number, text: string): void => {
    score += points;
    cand.trace.push({ kind, points, text });
  };

  // 사람이 내리는 결정의 수는 옮기는 묶음의 수다.
  // 이동수업은 수업 여러 개가 한 몸으로 움직이므로 수업 개수로 세면 과하게 깎인다.
  const units = cand.unitCount ?? cand.changes.length;
  note(
    '감점',
    WEIGHTS.perChange * units,
    cand.changes.length === units
      ? `움직이는 수업이 ${units}개입니다`
      : `자리를 옮기는 묶음이 ${units}개입니다 (수업 ${cand.changes.length}개)`,
  );

  const absent = cand.changes[0]?.from.teacher;

  // 묶음에 딸려 함께 움직이는 교사
  const dragged = new Set<string>();
  for (const c of cand.changes) {
    if (c.from.group && c.from.teacher !== absent) dragged.add(c.from.teacher);
  }
  if (dragged.size > 0) {
    note(
      '감점',
      WEIGHTS.groupDragPerTeacher * dragged.size,
      `묶음이라 ${[...dragged].join(', ')} 선생님 수업도 함께 움직입니다`,
    );
  }

  // ── 학급 쪽에서 보는 것 ─────────────────────────────
  for (const c of cand.changes) {
    const fromDay = dayOf(c.from.slot, cfg);
    const toDay = dayOf(c.toSlot, cfg);

    // 같은 과목이 하루 두 번
    const before = idx.klassSubjectDay.get(ksdKey(c.from.klass, c.from.subject, toDay)) ?? 0;
    if ((fromDay === toDay ? before - 1 : before) >= 1) {
      note(
        '감점',
        WEIGHTS.subjectTwiceADay,
        `${c.from.klass} ${cfg.dayNames[toDay]}요일에 ${c.from.subject} 수업이 두 번 들어갑니다`,
      );
    }

    // 이어 붙은 같은 과목 덩어리에서 한 교시만 떼어 내는지.
    // 같은 날 안에서 덩어리 끝에 다시 붙는 이동은 덩어리째 밀리는 것이라 그대로 둔다.
    const run = subjectRun(idx, cfg, c.from.klass, c.from.subject, c.from.slot);
    if (run >= 2 && !stillWhole(idx, cfg, c.from.klass, c.from.subject, c.from.slot, c.toSlot)) {
      const what = c.from.pro ? '전문교과 실습' : c.from.subject;
      note(
        '감점',
        WEIGHTS.blockSplit * (run - 1),
        `${c.from.klass} ${what}은 ${run}교시가 이어진 수업인데 그 가운데 한 교시만 떨어져 나갑니다`,
      );
    }

    // 같은 교사가 같은 학급을 하루에 두 번 (과목이 달라도 편성에서 기피한다)
    if (fromDay !== toDay) {
      const meets = (idx.klassAssignments.get(c.from.klass) ?? []).some(
        (a) =>
          a.teacher === c.from.teacher &&
          a.slot !== c.from.slot &&
          dayOf(a.slot, cfg) === toDay,
      );
      if (meets) {
        note(
          '감점',
          WEIGHTS.sameKlassTwiceADay,
          `${c.from.teacher} 선생님이 ${cfg.dayNames[toDay]}요일에 ${c.from.klass}에 두 번 들어갑니다`,
        );
      }
    }
  }

  // 학급의 하교가 늦어지는지. 그날 마지막 교시보다 뒤로 붙으면 학생이 더 남는다.
  const klassAfter = new Map<string, bigint>();
  for (const c of cand.changes) {
    const base = klassAfter.get(c.from.klass) ?? idx.klassMask.get(c.from.klass) ?? 0n;
    klassAfter.set(c.from.klass, (base & ~bit(c.from.slot)) | bit(c.toSlot));
  }
  for (const [k, after] of klassAfter) {
    const beforeMask = idx.klassMask.get(k) ?? 0n;
    for (let d = 0; d < cfg.days; d++) {
      const gap = lastPeriod(after, d, cfg) - lastPeriod(beforeMask, d, cfg);
      if (gap > 0) {
        note(
          '감점',
          WEIGHTS.laterDismissal * gap,
          `${k} ${cfg.dayNames[d]}요일 수업이 ${gap}교시 늦게 끝납니다`,
        );
      }
    }
  }

  // ── 교사 쪽에서 보는 것 ─────────────────────────────
  const afterMask = new Map<string, bigint>();
  for (const c of cand.changes) {
    const base = afterMask.get(c.from.teacher) ?? idx.teacherMask.get(c.from.teacher) ?? 0n;
    afterMask.set(c.from.teacher, (base & ~bit(c.from.slot)) | bit(c.toSlot));
  }

  for (const [t, after] of afterMask) {
    const beforeMask = idx.teacherMask.get(t) ?? 0n;

    // 연속 수업이 끊어져 공강이 조각남
    const delta = teacherBlocks(after, cfg) - teacherBlocks(beforeMask, cfg);
    if (delta > 0) {
      note('감점', WEIGHTS.fragmentation * delta, `${t} 선생님의 연속 수업이 끊어집니다`);
    }

    // 요일별 수업량 쏠림
    const spreadDelta = spread(after, cfg) - spread(beforeMask, cfg);
    if (spreadDelta > 0) {
      note(
        '감점',
        WEIGHTS.dayImbalance * spreadDelta,
        `${t} 선생님의 요일별 수업량이 한쪽으로 더 쏠립니다`,
      );
    }

    // 도착 요일만 따로 본다
    const days = new Set<number>();
    for (const c of cand.changes) {
      if (c.from.teacher !== t) continue;
      days.add(dayOf(c.toSlot, cfg));
    }
    for (const d of days) {
      // 이미 수업이 많은 날로 더 밀어 넣기
      const loadBefore = dayLoad(beforeMask, d, cfg);
      const loadAfter = dayLoad(after, d, cfg);
      if (loadAfter > loadBefore && loadAfter > WEIGHTS.heavyDayThreshold) {
        const over = loadAfter - Math.max(loadBefore, WEIGHTS.heavyDayThreshold);
        note(
          '감점',
          WEIGHTS.heavyDay * over,
          `${t} 선생님의 ${cfg.dayNames[d]}요일 수업이 ${loadAfter}시간이 됩니다`,
        );
      }

      // 연속 3시간 이상이 새로 생김
      const runBefore = longestRun(beforeMask, d, cfg);
      const runAfter = longestRun(after, d, cfg);
      if (runAfter >= 3 && runAfter > runBefore) {
        note(
          '감점',
          WEIGHTS.longRun,
          `${t} 선생님이 ${cfg.dayNames[d]}요일에 ${runAfter}시간 내리 수업합니다`,
        );
      }

      // 점심을 사이에 두고 앞뒤가 붙음
      if (spansLunch(after, d, cfg) && !spansLunch(beforeMask, d, cfg)) {
        note('감점', WEIGHTS.acrossLunch, `${t} 선생님이 점심 앞뒤로 이어서 수업합니다`);
      }
    }

    // 하루에 서로 다른 과목을 너무 많이 맡게 되는지
    for (const d of days) {
      const subjects = new Set<string>();
      for (const a of input.assignments) {
        if (a.teacher !== t) continue;
        const moved = cand.changes.find((c) => c.from === a);
        const slot = moved ? moved.toSlot : a.slot;
        if (dayOf(slot, cfg) === d) subjects.add(a.subject);
      }
      if (subjects.size > 3) {
        note(
          '감점',
          WEIGHTS.manySubjectsADay * (subjects.size - 3),
          `${t} 선생님이 ${cfg.dayNames[d]}요일에 과목 ${subjects.size}개를 맡게 됩니다`,
        );
      }
    }
  }

  // 결강 당일 안에서 해결되는 안이면 부탁할 사람도 적고 이야기가 단순하다
  if (cand.changes.every((c) => dayOf(c.from.slot, cfg) === dayOf(c.toSlot, cfg))) {
    note('가점', WEIGHTS.sameDayBonus, '같은 날 안에서 해결됩니다');
  }

  // 최근에 자리를 내어 준 교사에게 또 부탁하지 않도록
  const counted = new Set<string>();
  for (const c of cand.changes) {
    const t = c.from.teacher;
    if (t === absent || counted.has(t)) continue;
    counted.add(t);
    const burden = Math.min(input.recentBurden?.[t] ?? 0, WEIGHTS.burdenCap);
    if (burden > 0) {
      note(
        '감점',
        WEIGHTS.burdenPerPoint * burden,
        `${t} 선생님은 최근에 보강과 교환을 ${burden}번 맡았습니다`,
      );
    }
  }

  cand.score = score;
}

export const describeSlot = slotName;
export { periodOf };
