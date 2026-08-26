import type { fromNeis } from '../../src/adapters/neis';
import type { Assignment, TimetableInput } from '../../src/types';

/**
 * 실제 자료 검사 여럿이 함께 쓰는 조각.
 *
 * 검사 파일에서 곧바로 가져다 쓰면 그 파일의 검사까지 함께 돌아 시간이 두 배로 든다.
 * 그래서 검사가 아닌 파일로 뺀다.
 */
export const pairKey = (klass: string, subject: string): string => JSON.stringify([klass, subject]);
const SPECIAL = ['영어', '체육', '음악', '미술', '과학', '실과', '정보', '보건', '창의적'];

/**
 * 시간표가 지켜야 할 것 전부.
 *
 * `validate` 는 셋만 본다. 교사 중복, 학급 중복, 근무 불가다. 휴업일과 교시 제한,
 * 담당 미상 자리 겹침, 묶음 무결성, 슬롯 범위는 안 본다. 그래서 추천안을 적용한 뒤
 * `validate` 만 돌려서는 "깨지지 않았다"고 말할 수 없다. 여기서 전부 확인한다.
 *
 * 다만 "위반이 하나도 없어야 한다"로 쓰면 안 된다. 시작부터 어긋나 있는 것이
 * 정상이기 때문이다. 휴업일이 정해져도 나이스 기준 시간표에는 그날 수업이 그대로
 * 있고, 연수로 못 오는 그 시간에 원래 수업이 있어서 결강이 생긴다. 그것을 푸는 것이
 * 이 도구의 일이다. 그래서 **위반이 새로 늘지 않는다**를 본다.
 */
export function violations(input: TimetableInput): string[] {
  const cfg = input.config;
  const size = cfg.days * cfg.periods;
  const out: string[] = [];
  const push = (m: string): void => {
    out.push(m);
  };

  const closedAll = new Map<number, string>();
  const closedKlass = new Map<string, string>();
  for (const c of input.closures ?? []) {
    if (!c.klasses || c.klasses.length === 0) closedAll.set(c.day, c.reason);
    else for (const k of c.klasses) closedKlass.set(`${k}|${c.day}`, c.reason);
  }
  const unavail = new Map(
    Object.entries(input.unavailable ?? {}).map(([t, s]) => [t, new Set(s)] as const),
  );
  const busy = new Map(
    Object.entries(input.klassBusy ?? {}).map(([k, s]) => [k, new Set(s)] as const),
  );

  const atTeacher = new Map<string, Assignment>();
  const atKlass = new Map<string, Assignment>();
  const groupSlots = new Map<string, Set<number>>();

  for (const a of input.assignments) {
    // I1 슬롯이 격자 안에 있다
    if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot >= size) {
      push(`격자 밖 슬롯: ${a.teacher} ${a.klass} ${a.slot}`);
      continue;
    }
    const day = Math.floor(a.slot / cfg.periods);
    const period = a.slot % cfg.periods;

    // I2 교사 중복 (같은 묶음이면 한 몸)
    const tk = `${a.teacher}|${a.slot}`;
    const pt = atTeacher.get(tk);
    if (pt && !(pt.group !== undefined && pt.group === a.group)) {
      push(`교사 중복: ${a.teacher} 슬롯 ${a.slot}`);
    }
    atTeacher.set(tk, a);

    // I3 학급 중복 (같은 묶음이면 한 몸)
    const kk = `${a.klass}|${a.slot}`;
    const pk = atKlass.get(kk);
    if (pk && !(pk.group !== undefined && pk.group === a.group)) {
      push(`학급 중복: ${a.klass} 슬롯 ${a.slot}`);
    }
    atKlass.set(kk, a);

    // I4 근무 불가 시간
    if (unavail.get(a.teacher)?.has(a.slot)) push(`근무 불가: ${a.teacher} 슬롯 ${a.slot}`);

    // I5 쉬는 날
    const why = closedAll.get(day) ?? closedKlass.get(`${a.klass}|${day}`);
    if (why !== undefined) push(`쉬는 날 배정: ${a.klass} ${day}요일 (${why})`);

    // I6 그 요일에 없는 교시
    const schoolLimit = cfg.periodsPerDay?.[day];
    if (schoolLimit !== undefined && period >= schoolLimit) {
      push(`학교 교시 초과: ${a.klass} ${day}요일 ${period + 1}교시 (${schoolLimit}까지)`);
    }
    const klassLimit = input.klassPeriodsPerDay?.[a.klass]?.[day];
    if (klassLimit !== undefined && period >= klassLimit) {
      push(`학급 교시 초과: ${a.klass} ${day}요일 ${period + 1}교시 (${klassLimit}까지)`);
    }

    // I7 담당 미상으로 차 있는 자리와 겹침
    if (busy.get(a.klass)?.has(a.slot)) push(`담당 미상 자리와 겹침: ${a.klass} 슬롯 ${a.slot}`);

    // I8 묶음은 한 슬롯에 모여 있다
    if (a.group !== undefined) {
      (groupSlots.get(a.group) ?? groupSlots.set(a.group, new Set()).get(a.group)!).add(a.slot);
    }
  }

  for (const [g, slots] of groupSlots) {
    if (slots.size > 1) push(`묶음이 갈라짐: ${g} -> ${[...slots].join(', ')}`);
  }
  return out;
}


/** 수업이 사라지거나 늘어나지 않았는지. 슬롯만 달라져야 한다. */
export function lessonBag(input: TimetableInput): Map<string, number> {
  const bag = new Map<string, number>();
  for (const a of input.assignments) {
    const k = JSON.stringify([a.teacher, a.klass, a.subject]);
    bag.set(k, (bag.get(k) ?? 0) + 1);
  }
  return bag;
}

export const sameBag = (a: Map<string, number>, b: Map<string, number>): boolean => {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
};


export function teacherTable(report: ReturnType<typeof fromNeis>, kind: string): Map<string, string> {
  const table = new Map<string, string>();
  const want = new Map<string, { klass: string; grade: string; subject: string; slots: Set<number> }>();
  for (const c of report.cells) {
    if (c.kind !== '수업') continue;
    const k = pairKey(c.klass, c.subject);
    const cur =
      want.get(k) ??
      want.set(k, { klass: c.klass, grade: c.grade, subject: c.subject, slots: new Set() }).get(k)!;
    cur.slots.add(c.day * report.config.periods + c.period);
  }
  const used = new Map<string, Array<Set<number>>>();
  for (const [k, { klass, grade, subject, slots }] of [...want].sort((a, b) =>
    a[0].localeCompare(b[0]),
  )) {
    if (kind === '초등학교' && !SPECIAL.some((s) => subject.includes(s))) {
      table.set(k, `담임|${klass}`);
      continue;
    }
    const owner = `${grade}|${subject}`;
    const pool = used.get(owner) ?? used.set(owner, []).get(owner)!;
    let i = pool.findIndex((t) => [...slots].every((s) => !t.has(s)));
    if (i < 0) {
      pool.push(new Set());
      i = pool.length - 1;
    }
    for (const s of slots) pool[i]!.add(s);
    table.set(k, `${owner}/${i}`);
  }
  return table;
}


/** 추천안이 말한 대로 옮긴다. 말한 것과 실제가 다르면 그것도 결함이다. */
export function apply(input: TimetableInput, changes: ReadonlyArray<{ from: Assignment; toSlot: number }>): {
  next: TimetableInput;
  unmatched: number;
} {
  let unmatched = 0;
  const used = new Set<number>();
  const next = input.assignments.map((a) => a);
  for (const ch of changes) {
    const i = next.findIndex(
      (a, idx) =>
        !used.has(idx) &&
        a.teacher === ch.from.teacher &&
        a.klass === ch.from.klass &&
        a.slot === ch.from.slot &&
        a.subject === ch.from.subject,
    );
    if (i < 0) {
      unmatched += 1;
      continue;
    }
    used.add(i);
    next[i] = { ...next[i]!, slot: ch.toSlot };
  }
  return { next: { ...input, assignments: next }, unmatched };
}

