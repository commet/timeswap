import type { Candidate, TimetableInput } from './types.js';
import { bit, dayOf, slotName } from './slots.js';
import { ksdKey, teacherBlocks, type Indexes } from './timetable.js';

/** 소프트 점수 가중치. 설정 화면에서 조정할 값의 기본값이다. */
export const WEIGHTS = {
  perChange: -10,
  subjectTwiceADay: -6,
  fragmentation: -4,
  sameDayBonus: 5,
  burdenPerPoint: -1,
  burdenCap: 3,
} as const;

/**
 * 후보에 소프트 점수와 감점, 가점 트레이스를 붙인다.
 * 하드 제약은 이미 탐색 단계에서 걸렀다는 전제이며, 여기서는 순위만 가른다.
 */
export function scoreCandidate(idx: Indexes, input: TimetableInput, cand: Candidate): void {
  const cfg = input.config;
  let score = 0;

  const n = cand.changes.length;
  const changePts = WEIGHTS.perChange * n;
  score += changePts;
  cand.trace.push({
    kind: '감점',
    points: changePts,
    text: `움직이는 수업이 ${n}개입니다`,
  });

  // 같은 과목이 하루 두 번이 되는지 (이동 도착지 기준)
  for (const c of cand.changes) {
    const fromDay = dayOf(c.from.slot, cfg);
    const toDay = dayOf(c.toSlot, cfg);
    const before = idx.klassSubjectDay.get(ksdKey(c.from.klass, c.from.subject, toDay)) ?? 0;
    const effective = fromDay === toDay ? before - 1 : before;
    if (effective >= 1) {
      score += WEIGHTS.subjectTwiceADay;
      cand.trace.push({
        kind: '감점',
        points: WEIGHTS.subjectTwiceADay,
        text: `${c.from.klass}의 ${cfg.dayNames[toDay]}요일에 ${c.from.subject} 수업이 두 번이 됩니다`,
      });
    }
  }

  // 관련 교사들의 수업 흐름 조각남 (연속 덩어리 수 증가)
  const afterMask = new Map<string, bigint>();
  for (const c of cand.changes) {
    const t = c.from.teacher;
    const base = afterMask.get(t) ?? idx.teacherMask.get(t) ?? 0n;
    afterMask.set(t, (base & ~bit(c.from.slot)) | bit(c.toSlot));
  }
  for (const [t, after] of afterMask) {
    const beforeBlocks = teacherBlocks(idx.teacherMask.get(t) ?? 0n, cfg);
    const delta = teacherBlocks(after, cfg) - beforeBlocks;
    if (delta > 0) {
      const pts = WEIGHTS.fragmentation * delta;
      score += pts;
      cand.trace.push({
        kind: '감점',
        points: pts,
        text: `${t} 선생님의 수업 흐름이 조각납니다`,
      });
    }
  }

  // 결강 당일 안에서 해결되는 안 (모든 이동이 같은 요일 안)
  const sameDay = cand.changes.every((c) => dayOf(c.from.slot, cfg) === dayOf(c.toSlot, cfg));
  if (sameDay) {
    score += WEIGHTS.sameDayBonus;
    cand.trace.push({
      kind: '가점',
      points: WEIGHTS.sameDayBonus,
      text: '결강 당일 안에서 해결됩니다',
    });
  }

  // 최근 보강, 교환 부담 균형 (결강 교사 본인은 제외)
  const absent = cand.changes[0]?.from.teacher;
  const counted = new Set<string>();
  for (const c of cand.changes) {
    const t = c.from.teacher;
    if (t === absent || counted.has(t)) continue;
    counted.add(t);
    const burden = Math.min(input.recentBurden?.[t] ?? 0, WEIGHTS.burdenCap);
    if (burden > 0) {
      const pts = WEIGHTS.burdenPerPoint * burden;
      score += pts;
      cand.trace.push({
        kind: '감점',
        points: pts,
        text: `${t} 선생님은 최근 보강과 교환 부담이 ${burden}회 있었습니다`,
      });
    }
  }

  cand.score = score;
}

export const describeSlot = slotName;
