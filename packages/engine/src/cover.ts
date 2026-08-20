import type { TimetableInput } from './types';
import { buildIndexes, closedReason } from './timetable';
import { dayOf, hasBit } from './slots';

/** 교체가 성립하지 않을 때를 위한 보강 후보 1명. */
export interface CoverCandidate {
  teacher: string;
  /** 결강 수업과 같은 과목을 가르치는 교사인지 */
  sameSubject: boolean;
  /** 전문교과 실습을 하나라도 맡고 계신 분인지 */
  proTeacher: boolean;
  /** 주당 담당 시수 */
  weeklyLessons: number;
  /** 그날 이미 맡은 수업 수 */
  dayLessons: number;
  /** 최근에 보강과 교체를 맡은 횟수 */
  recentBurden: number;
  /** 그 자리에 들어가면 생기는 연속 수업 시간 */
  runAfter: number;
  /** 순위를 가르는 값. 클수록 먼저다 */
  score: number;
  /** 사람이 읽을 근거. 화면에 그대로 쓴다 */
  notes: string[];
}

/**
 * 보강 후보를 고르는 가중치.
 *
 * 보강은 교체보다 무거운 부탁이다. 교체는 서로 자리를 바꾸지만 보강은 한 시간을
 * 그냥 더 맡는 일이라 부담이 한쪽으로만 간다. 그래서 교체보다 부담 균형을 세게 본다.
 */
export const COVER_WEIGHTS = {
  /** 같은 과목이면 진도를 이어 갈 수 있다. 학교 규정에서도 우선 순위다 */
  sameSubject: 10,
  /** 그날 수업이 이미 많으면 기준 초과 1시간당 */
  heavyDay: -2,
  /** 그날 수업 수 기준 */
  heavyDayThreshold: 4,
  /** 연속 3시간 이상이 새로 생기면 */
  longRun: -6,
  /** 최근에 맡은 1회당. 교체보다 무겁게 본다 */
  burdenPer: -4,
  burdenCap: 3,
  /** 주당 시수 1시간당. 여력이 있는 분을 앞에 두되 크게 흔들지는 않는다 */
  weeklyPer: -0.3,
  /**
   * 전문교과 실습인데 전문교과를 하나도 맡지 않는 분이면.
   *
   * 특성화고와 마이스터고의 전공 실습은 학과 전용 실습실에서 기계를 다룬다.
   * 그 학과 교사가 아니면 진도를 잇는 것이 아니라 안전을 지키는 것부터 어렵다.
   * 같은 과목 가점(10)보다 크게 잡아, 과목이 다르더라도 전문교과를 맡는 분이
   * 일반교과만 맡는 분보다 앞에 오게 한다.
   *
   * 빼지 않고 뒤로 미는 이유가 있다. 아무도 없을 때가 있고, 그때는 자습 감독이
   * 현실의 답이다. 후보에서 감추면 그 사실을 알 길이 없다.
   */
  proMismatch: -12,
} as const;

/**
 * 그 교시에 비어 있는 교사를 보강 우선순위로 돌려준다.
 *
 * 비어 있는 사람을 그냥 나열하면 화면만 채우고 판단은 그대로 사람 몫으로 남는다.
 * 그래서 교체 추천이 보는 것을 여기서도 본다. 같은 과목인지, 그날이 이미 무거운지,
 * 연속 수업이 길어지는지, 최근에 이미 여러 번 맡았는지다.
 * 그리고 왜 그 순서인지를 문장으로 함께 돌려준다.
 */
export function coverCandidates(
  input: TimetableInput,
  slot: number,
  subject: string,
  max = 8,
  /** 결강 당사자. 자기 자신은 후보에서 뺀다 */
  absent?: string,
  /**
   * 그 수업을 듣는 학급. 그 학급만 쉬는 날인지 보는 데 쓴다.
   *
   * 안 넣으면 학교 전체 휴업일만 본다. 그래서 1학년이 수학여행으로 빠진 날에도
   * 1학년 보강 후보가 나왔다. 교체 쪽은 이미 학급 단위 휴업을 보고 있었는데
   * 보강 쪽만 안 보고 있어서 두 경로가 서로 다른 말을 했다.
   */
  klass?: string,
): CoverCandidate[] {
  const cfg = input.config;
  const idx = buildIndexes(input);
  const day = dayOf(slot, cfg);
  const period = slot - day * cfg.periods;

  // 쉬는 날이면 보강을 세울 자리가 아니다. 학교 전체든 그 학급만이든 같다.
  if (klass !== undefined) {
    if (closedReason(idx, klass, day) !== undefined) return [];
  } else if (idx.closedAll.has(day)) {
    return [];
  }

  const subjectsOf = new Map<string, Set<string>>();
  const countOf = new Map<string, number>();
  const proTeachers = new Set<string>();
  // 이 과목이 전문교과인지. 표시는 과목마다 일정해서 시간표 어디를 봐도 같다.
  // 실측 37곳에서 같은 과목이 표시가 붙은 채와 안 붙은 채로 함께 나온 적은 없었다.
  let proSubject = false;
  for (const a of input.assignments) {
    let s = subjectsOf.get(a.teacher);
    if (!s) {
      s = new Set();
      subjectsOf.set(a.teacher, s);
    }
    s.add(a.subject);
    countOf.set(a.teacher, (countOf.get(a.teacher) ?? 0) + 1);
    if (a.pro) {
      proTeachers.add(a.teacher);
      if (a.subject === subject) proSubject = true;
    }
  }

  const out: CoverCandidate[] = [];
  for (const [teacher, mask] of idx.teacherMask) {
    if (teacher === absent) continue;
    if (hasBit(mask, slot)) continue;
    if (hasBit(idx.unavailMask.get(teacher) ?? 0n, slot)) continue;

    const sameSubject = subjectsOf.get(teacher)?.has(subject) ?? false;
    const proTeacher = proTeachers.has(teacher);
    const weekly = countOf.get(teacher) ?? 0;
    const burden = Math.min(input.recentBurden?.[teacher] ?? 0, COVER_WEIGHTS.burdenCap);

    let dayLessons = 0;
    for (let p = 0; p < cfg.periods; p++) {
      if (hasBit(mask, day * cfg.periods + p)) dayLessons++;
    }

    // 앞뒤로 이어 붙는 수업을 세어 이 자리에 들어갔을 때의 연속 시간을 구한다.
    let run = 1;
    for (let p = period - 1; p >= 0 && hasBit(mask, day * cfg.periods + p); p--) run++;
    for (let p = period + 1; p < cfg.periods && hasBit(mask, day * cfg.periods + p); p++) run++;

    const notes: string[] = [];
    let score = 0;

    if (sameSubject) {
      score += COVER_WEIGHTS.sameSubject;
      notes.push(`${subject} 과목을 맡고 계셔서 진도를 이어 갈 수 있습니다`);
    }
    if (proSubject && !proTeacher) {
      score += COVER_WEIGHTS.proMismatch;
      notes.push('전문교과 실습이라 실습을 맡지 않으시는 분께는 부탁드리기 어렵습니다');
    } else if (proSubject && proTeacher && !sameSubject) {
      notes.push('전문교과 실습을 맡고 계셔서 실습실 수업을 아십니다');
    }
    if (dayLessons > COVER_WEIGHTS.heavyDayThreshold) {
      score += COVER_WEIGHTS.heavyDay * (dayLessons - COVER_WEIGHTS.heavyDayThreshold);
      notes.push(`${cfg.dayNames[day]}요일에 이미 ${dayLessons}시간을 맡고 계십니다`);
    }
    if (run >= 3) {
      score += COVER_WEIGHTS.longRun;
      notes.push(`이 시간에 들어가시면 ${run}시간을 내리 수업하게 됩니다`);
    }
    if (burden > 0) {
      score += COVER_WEIGHTS.burdenPer * burden;
      notes.push(`최근에 보강과 교체를 ${burden}번 맡으셨습니다`);
    }
    score += COVER_WEIGHTS.weeklyPer * weekly;
    if (notes.length === 0) {
      notes.push(`이 시간이 비어 있고 ${cfg.dayNames[day]}요일 수업도 ${dayLessons}시간입니다`);
    }

    out.push({
      teacher,
      sameSubject,
      proTeacher,
      weeklyLessons: weekly,
      dayLessons,
      recentBurden: burden,
      runAfter: run,
      score,
      notes,
    });
  }

  out.sort((a, b) => b.score - a.score || a.teacher.localeCompare(b.teacher, 'ko'));
  return out.slice(0, max);
}
