import type { Assignment, Candidate, TimetableInput, TraceEntry } from './types';
import { bit, dayOf, hasBit, slotName, slotOf } from './slots';
import { buildIndexes, dayHoles, tsKey } from './timetable';
import { scoreCandidate } from './score';

export interface RecommendOptions {
  /** 돌려줄 최대 후보 수. 기본 20. */
  max?: number;
  /** 3자 순환 탐색 포함 여부. 기본 true. */
  includeCycle3?: boolean;
}

export interface RecommendResult {
  target: Assignment;
  candidates: Candidate[];
  /** 후보를 만들 수 없었던 구조적 이유(분반 묶음 등). 비어 있으면 정상 탐색. */
  notes: string[];
}

/**
 * 결강 수업 1개에 대해 성립 가능한 교환안을 전수 탐색한다.
 * 하드 제약(중복 배정, 근무 불가, 학급 빈틈, 분반 보존)을 통과한 후보만 만들고,
 * 소프트 점수로 정렬해 근거 트레이스와 함께 돌려준다.
 */
export function recommend(
  input: TimetableInput,
  target: { teacher: string; slot: number },
  opts: RecommendOptions = {},
): RecommendResult {
  const cfg = input.config;
  const idx = buildIndexes(input);
  const a = idx.byTeacherSlot.get(tsKey(target.teacher, target.slot));
  if (!a) {
    throw new Error(
      `${target.teacher} 선생님의 ${slotName(target.slot, cfg)} 수업을 찾을 수 없습니다`,
    );
  }
  const notes: string[] = [];
  if (a.group) {
    notes.push(
      `${slotName(a.slot, cfg)} 수업은 분반, 동시수업 묶음(${a.group})이라 v0 엔진이 자동 추천을 하지 않습니다`,
    );
    return { target: a, candidates: [], notes };
  }

  const freeAt = (teacher: string, slot: number, ignoreSlot: number): boolean => {
    const mask = (idx.teacherMask.get(teacher) ?? 0n) & ~bit(ignoreSlot);
    if (hasBit(mask, slot)) return false;
    return !hasBit(idx.unavailMask.get(teacher) ?? 0n, slot);
  };

  const passFree = (teacher: string, slot: number): TraceEntry => ({
    kind: '조건',
    text: `${teacher} 선생님이 ${slotName(slot, cfg)}에 비어 있습니다`,
  });

  const candidates: Candidate[] = [];
  const klassLessons = (idx.klassAssignments.get(a.klass) ?? []).filter(
    (b) => b.slot !== a.slot,
  );

  // 1) 빈 교시로 이동: 학급 하루 수업의 중간 빈틈을 늘리지 않는 경우만.
  //    (기존 빈틈을 메우는 이동은 허용, 그날 마지막 교시가 사라지는 축소도 허용)
  const km = idx.klassMask.get(a.klass) ?? 0n;
  const sDay = dayOf(a.slot, cfg);
  for (let d = 0; d < cfg.days; d++) {
    for (let p = 0; p < cfg.periods; p++) {
      const e = slotOf(d, p, cfg);
      if (e === a.slot || hasBit(km, e)) continue;
      if (!freeAt(a.teacher, e, a.slot)) continue;
      const newMask = (km & ~bit(a.slot)) | bit(e);
      if (dayHoles(newMask, sDay, cfg) > dayHoles(km, sDay, cfg)) continue;
      if (d !== sDay && dayHoles(newMask, d, cfg) > dayHoles(km, d, cfg)) continue;
      const fills = dayHoles(km, d, cfg) > dayHoles(newMask, d, cfg);
      candidates.push({
        type: 'move',
        title: `${slotName(e, cfg)}로 이동`,
        changes: [{ from: a, toSlot: e }],
        score: 0,
        trace: [
          passFree(a.teacher, e),
          {
            kind: '조건',
            text: fills
              ? '학급의 기존 빈 교시를 메우는 이동입니다'
              : '학급 하루 수업에 빈틈이 생기지 않습니다',
          },
        ],
      });
    }
  }

  // 2) 2자 맞교환: 같은 학급의 다른 교사 수업과 자리를 바꾼다.
  for (const b of klassLessons) {
    if (b.teacher === a.teacher || b.group) continue;
    if (!freeAt(b.teacher, a.slot, b.slot)) continue;
    if (!freeAt(a.teacher, b.slot, a.slot)) continue;
    candidates.push({
      type: 'swap2',
      title: `${b.teacher} 선생님과 맞교환 (${slotName(a.slot, cfg)} ↔ ${slotName(b.slot, cfg)})`,
      changes: [
        { from: a, toSlot: b.slot },
        { from: b, toSlot: a.slot },
      ],
      score: 0,
      trace: [passFree(b.teacher, a.slot), passFree(a.teacher, b.slot)],
    });
  }

  // 3) 3자 순환: a 가 b 자리로, b 가 c 자리로, c 가 a 자리로 돈다. 순서쌍이 방향을 만든다.
  if (opts.includeCycle3 !== false) {
    for (const b of klassLessons) {
      if (b.teacher === a.teacher || b.group) continue;
      for (const c of klassLessons) {
        if (c === b || c.group) continue;
        if (c.teacher === a.teacher || c.teacher === b.teacher) continue;
        if (!freeAt(a.teacher, b.slot, a.slot)) break; // a 조건은 b 에만 의존한다
        if (!freeAt(b.teacher, c.slot, b.slot)) continue;
        if (!freeAt(c.teacher, a.slot, c.slot)) continue;
        candidates.push({
          type: 'cycle3',
          title: `${a.teacher}, ${b.teacher}, ${c.teacher} 선생님의 자리 순환`,
          changes: [
            { from: a, toSlot: b.slot },
            { from: b, toSlot: c.slot },
            { from: c, toSlot: a.slot },
          ],
          score: 0,
          trace: [
            passFree(a.teacher, b.slot),
            passFree(b.teacher, c.slot),
            passFree(c.teacher, a.slot),
          ],
        });
      }
    }
  }

  for (const cand of candidates) scoreCandidate(idx, input, cand);
  candidates.sort(
    (x, y) =>
      y.score - x.score ||
      x.changes.length - y.changes.length ||
      x.title.localeCompare(y.title, 'ko'),
  );
  if (candidates.length === 0) {
    notes.push('성립하는 교환안이 없습니다. 보강 배정이 필요합니다');
  }
  return { target: a, candidates: candidates.slice(0, opts.max ?? 20), notes };
}
