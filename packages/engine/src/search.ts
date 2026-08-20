import type { Assignment, Candidate, Change, TimetableInput, TraceEntry } from './types';
import { dayOf, slotName, slotOf } from './slots';
import { buildIndexes, tsKey } from './timetable';
import { scoreCandidate } from './score';
import {
  buildUnits,
  checkMoves,
  fillsHole,
  gwa,
  unitKey,
  unitLabel,
  type Move,
  type Unit,
} from './units';

export interface RecommendOptions {
  /** 돌려줄 최대 후보 수. 기본 20. */
  max?: number;
  /** 3자 순환 탐색 포함 여부. 기본 true. */
  includeCycle3?: boolean;
  /** 연쇄 탐색에 쓸 상대 단위 수 상한. 큰 학교에서 시간을 지킨다. 기본 60. */
  cycleFanout?: number;
}

export interface RecommendResult {
  target: Assignment;
  candidates: Candidate[];
  /** 탐색 과정에서 알려야 할 사정. 비어 있으면 특별한 일이 없었다. */
  notes: string[];
}

/**
 * 결강 수업 1건에 대해 성립 가능한 교환안을 전수 탐색한다.
 *
 * 탐색 단위는 수업 한 개가 아니라 함께 움직여야 하는 묶음이다.
 * 분반과 이동수업, 복수교사, 합반이 모두 묶음으로 들어오며 통째로만 자리를 옮긴다.
 * 하드 제약을 통과한 안만 만들고 소프트 점수로 정렬해 근거와 함께 돌려준다.
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

  const units = buildUnits(input);
  const U = units.get(unitKey(a));
  if (!U) throw new Error('시간표를 단위로 나누지 못했습니다');

  const notes: string[] = [];
  if (U.grouped) {
    notes.push(
      `이 수업은 학급 ${U.klasses.length}개와 교사 ${U.teachers.length}명이 함께 하는 묶음이라, 통째로만 자리를 옮길 수 있습니다`,
    );
  }

  const candidates: Candidate[] = [];
  const add = (
    type: Candidate['type'],
    title: string,
    moves: Move[],
    trace: TraceEntry[],
  ): void => {
    const changes: Change[] = [];
    for (const m of moves) {
      for (const from of m.unit.assignments) changes.push({ from, toSlot: m.toSlot });
    }
    candidates.push({ type, title, changes, unitCount: moves.length, score: 0, trace });
  };

  /** 옮김 하나를 설명하는 문장. 묶음이면 몇 명 몇 학급이 함께 비는지 밝힌다. */
  const moveTrace = (m: Move): TraceEntry => {
    const where = slotName(m.toSlot, cfg);
    if (!m.unit.grouped) {
      return { kind: '조건', text: `${m.unit.teachers[0]} 선생님이 ${where}에 비어 있습니다` };
    }
    return {
      kind: '조건',
      text: `묶음의 교사 ${m.unit.teachers.length}명과 학급 ${m.unit.klasses.length}개가 모두 ${where}에 비어 있습니다`,
    };
  };

  // 1) 빈 교시로 옮기기
  for (let d = 0; d < cfg.days; d++) {
    for (let p = 0; p < cfg.periods; p++) {
      const e = slotOf(d, p, cfg);
      if (e === U.slot) continue;
      const moves: Move[] = [{ unit: U, toSlot: e }];
      if (!checkMoves(idx, cfg, moves).ok) continue;
      const fills = fillsHole(idx, cfg, moves);
      add(
        'move',
        U.grouped ? `묶음 통째로 ${slotName(e, cfg)}로 옮기기` : `${slotName(e, cfg)}로 옮기기`,
        moves,
        [
          moveTrace(moves[0]!),
          {
            kind: '조건',
            text: fills
              ? '학급의 비어 있던 교시를 채우는 이동입니다'
              : '학급 시간표에 빈 시간이 생기지 않습니다',
          },
        ],
      );
    }
  }

  // 상대 단위 후보: 대상 묶음의 학급 가운데 하나라도 걸치는 다른 단위.
  // 학급이 전혀 겹치지 않는 단위와 바꾸면 대상 학급의 빈자리가 그대로 남는다.
  const poolMap = new Map<string, Unit>();
  for (const k of U.klasses) {
    for (const b of idx.klassAssignments.get(k) ?? []) {
      const key = unitKey(b);
      if (key === U.key) continue;
      const v = units.get(key);
      if (!v || v.slot === U.slot) continue;
      // 결강 당사자가 낀 묶음과 바꾸면 그 교사는 여전히 그 시간에 묶여 있다
      if (v.teachers.includes(a.teacher)) continue;
      poolMap.set(key, v);
    }
  }
  const pool = [...poolMap.values()].sort((x, y) => x.slot - y.slot);

  // 2) 맞바꾸기: 대상 묶음과 상대 묶음이 자리를 통째로 맞바꾼다.
  for (const V of pool) {
    const moves: Move[] = [
      { unit: U, toSlot: V.slot },
      { unit: V, toSlot: U.slot },
    ];
    if (!checkMoves(idx, cfg, moves).ok) continue;
    const label = unitLabel(V);
    add(
      'swap2',
      `${label}${gwa(label)} 맞바꾸기 (${slotName(U.slot, cfg)} ↔ ${slotName(V.slot, cfg)})`,
      moves,
      [moveTrace(moves[1]!), moveTrace(moves[0]!)],
    );
  }

  // 3) 연쇄 교환: 대상이 상대 자리로, 상대가 제3자 자리로, 제3자가 대상 자리로 돈다.
  if (opts.includeCycle3 !== false) {
    const fanout = opts.cycleFanout ?? 60;
    const ring = pool.slice(0, fanout);
    if (pool.length > ring.length) {
      notes.push(
        `연쇄 교환은 가까운 후보 ${ring.length}개까지만 살폈습니다. 맞바꾸기는 전부 살폈습니다`,
      );
    }
    for (const V of ring) {
      for (const W of ring) {
        if (W === V || W.slot === V.slot) continue;
        // 한 교사가 두 묶음에 걸치면 연쇄가 꼬인다
        if (W.teachers.some((t) => V.teachers.includes(t))) continue;
        const moves: Move[] = [
          { unit: U, toSlot: V.slot },
          { unit: V, toSlot: W.slot },
          { unit: W, toSlot: U.slot },
        ];
        if (!checkMoves(idx, cfg, moves).ok) continue;
        const lv = unitLabel(V);
        const lw = unitLabel(W);
        const title =
          !V.grouped && !W.grouped
            ? `${V.teachers[0]}, ${W.teachers[0]} 선생님을 거치는 연쇄 교환`
            : `${lv}, ${lw}를 거치는 연쇄 교환`;
        add('cycle3', title, moves, [moveTrace(moves[0]!), moveTrace(moves[1]!), moveTrace(moves[2]!)]);
      }
    }
  }

  for (const cand of candidates) scoreCandidate(idx, input, cand);
  candidates.sort(
    (x, y) =>
      y.score - x.score ||
      (x.unitCount ?? x.changes.length) - (y.unitCount ?? y.changes.length) ||
      x.changes.length - y.changes.length ||
      x.title.localeCompare(y.title, 'ko'),
  );
  if (candidates.length === 0) {
    notes.push('바꿀 방법을 찾지 못했습니다. 보강으로 처리해야 할 수 있습니다');
  }
  return { target: a, candidates: candidates.slice(0, opts.max ?? 20), notes };
}

/** 하루의 어느 요일인지. 외부에서 쓰기 좋게 다시 내보낸다. */
export { dayOf };

/**
 * 교체 상대가 그 학급 수업 가운데 이 몫 넘게 한 사람에게 몰려 있으면 담임형으로 본다.
 *
 * 전국 초등학교 57곳, 중학교 65곳, 특수학교 32곳을 실제 자료로 재어 정했다.
 *
 * | 학교급 | 빈 결과 | 빈 결과일 때 담당 몫 중앙 | 답이 있을 때 담당 몫 중앙 |
 * |---|---|---|---|
 * | 초등학교 | 34.8% | **1.00** | 0.50 |
 * | 중학교 | 0.0% | 0.00 | 0.09 |
 * | 특수학교 | 0.0% | 0.00 | 0.10 |
 *
 * 0.6 에서 빈 결과의 92%가 걸리고, 답이 있던 것은 4%만 걸린다. 값을 0.3 까지 내려도
 * 빈 결과 설명력은 92% 그대로인데 답이 있던 것이 17%로 늘어 애먼 안내가 붙는다.
 */
export const HOMEROOM_SHARE = 0.6;

/**
 * 교체안이 하나도 없을 때 그 까닭.
 *
 * 초등학교 담임 선생님은 결강의 62%에서 교체 후보가 없다. 그 학급 수업을 거의 다
 * 맡고 계셔서 바꿔 줄 상대가 자기 자신이기 때문이다. 구조가 그런 것이지 조건이
 * 까다로워서가 아니다. 그런데 화면은 "근무 불가 시간과 묶음 수업을 확인해 주세요"라고
 * 안내하고 있었다. 그 둘은 원인이 아니다. 엉뚱한 데를 보게 만든다.
 */
export type NoSwapReason = 'homeroom' | 'group' | 'unknown';

export function noSwapReason(
  input: TimetableInput,
  target: { teacher: string; slot: number },
): NoSwapReason {
  const mine = input.assignments.find(
    (a) => a.teacher === target.teacher && a.slot === target.slot,
  );
  if (!mine) return 'unknown';
  if (mine.group) return 'group';
  let inKlass = 0;
  let byMe = 0;
  for (const a of input.assignments) {
    if (a.klass !== mine.klass) continue;
    inKlass += 1;
    if (a.teacher === target.teacher) byMe += 1;
  }
  if (inKlass > 0 && byMe / inKlass >= HOMEROOM_SHARE) return 'homeroom';
  return 'unknown';
}
