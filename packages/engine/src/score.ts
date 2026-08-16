import type { Candidate, TimetableInput } from './types';
import { bit, dayOf, slotName } from './slots';
import { ksdKey, teacherBlocks, type Indexes } from './timetable';

/** 소프트 점수 가중치. 설정 화면에서 조정할 값의 기본값이다. */
export const WEIGHTS = {
  perChange: -10,
  subjectTwiceADay: -6,
  fragmentation: -4,
  sameDayBonus: 5,
  burdenPerPoint: -1,
  burdenCap: 3,
  /** 묶음이 딸려 움직일 때 결강 당사자 말고 함께 끌려가는 교사 1명당 */
  groupDragPerTeacher: -3,
} as const;

/**
 * 후보에 소프트 점수와 감점, 가점 트레이스를 붙인다.
 * 하드 제약은 이미 탐색 단계에서 걸렀다는 전제이며, 여기서는 순위만 가른다.
 */
export function scoreCandidate(idx: Indexes, input: TimetableInput, cand: Candidate): void {
  const cfg = input.config;
  let score = 0;

  // 사람이 내리는 결정의 수는 옮기는 묶음의 수다.
  // 이동수업은 수업 여러 개가 한 몸으로 움직이므로 수업 개수로 세면 과하게 깎인다.
  const units = cand.unitCount ?? cand.changes.length;
  const changePts = WEIGHTS.perChange * units;
  score += changePts;
  cand.trace.push({
    kind: '감점',
    points: changePts,
    text:
      cand.changes.length === units
        ? `움직이는 수업이 ${units}개입니다`
        : `자리를 옮기는 묶음이 ${units}개입니다 (수업 ${cand.changes.length}개)`,
  });

  // 묶음에 딸려 함께 움직이는 교사가 있으면 그만큼 남에게 부담이 간다.
  const absentTeacher = cand.changes[0]?.from.teacher;
  const dragged = new Set<string>();
  for (const c of cand.changes) {
    if (c.from.group && c.from.teacher !== absentTeacher) dragged.add(c.from.teacher);
  }
  if (dragged.size > 0) {
    const pts = WEIGHTS.groupDragPerTeacher * dragged.size;
    score += pts;
    cand.trace.push({
      kind: '감점',
      points: pts,
      text: `묶음이라 ${[...dragged].join(', ')} 선생님 수업도 함께 움직입니다`,
    });
  }

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
        text: `${c.from.klass} ${cfg.dayNames[toDay]}요일에 ${c.from.subject} 수업이 두 번 들어갑니다`,
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
        text: `${t} 선생님의 연속 수업이 끊어집니다`,
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
      text: '같은 날 안에서 해결됩니다',
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
        text: `${t} 선생님은 최근에 보강과 교환을 ${burden}번 맡았습니다`,
      });
    }
  }

  cand.score = score;
}

export const describeSlot = slotName;
