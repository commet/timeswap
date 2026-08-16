import type { TimetableInput } from './types';
import { buildIndexes } from './timetable';
import { hasBit } from './slots';

/** 교환이 성립하지 않을 때를 위한 보강 후보 1명. */
export interface CoverCandidate {
  teacher: string;
  /** 결강 수업과 같은 과목을 가르치는 교사인지 */
  sameSubject: boolean;
  /** 주당 담당 시수. 적을수록 보강 부담 여력이 있다고 본다. */
  weeklyLessons: number;
}

/**
 * 해당 교시에 비어 있는 교사 목록을 보강 우선순위로 돌려준다.
 * 규정 관행(지평선고 등)을 따라 같은 과목 교사, 주당 시수가 적은 교사 순.
 */
export function coverCandidates(
  input: TimetableInput,
  slot: number,
  subject: string,
  max = 8,
): CoverCandidate[] {
  const idx = buildIndexes(input);
  const subjectsOf = new Map<string, Set<string>>();
  const countOf = new Map<string, number>();
  for (const a of input.assignments) {
    let s = subjectsOf.get(a.teacher);
    if (!s) {
      s = new Set();
      subjectsOf.set(a.teacher, s);
    }
    s.add(a.subject);
    countOf.set(a.teacher, (countOf.get(a.teacher) ?? 0) + 1);
  }
  const out: CoverCandidate[] = [];
  for (const [teacher, mask] of idx.teacherMask) {
    if (hasBit(mask, slot)) continue;
    if (hasBit(idx.unavailMask.get(teacher) ?? 0n, slot)) continue;
    out.push({
      teacher,
      sameSubject: subjectsOf.get(teacher)?.has(subject) ?? false,
      weeklyLessons: countOf.get(teacher) ?? 0,
    });
  }
  out.sort(
    (a, b) =>
      Number(b.sameSubject) - Number(a.sameSubject) ||
      a.weeklyLessons - b.weeklyLessons ||
      a.teacher.localeCompare(b.teacher, 'ko'),
  );
  return out.slice(0, max);
}
