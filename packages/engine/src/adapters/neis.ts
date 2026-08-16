import type { ScheduleConfig, TimetableInput, Assignment } from './../types';
import { slotOf } from './../slots';

/**
 * 나이스 교육정보 개방 포털의 시간표 응답을 다룬다.
 * 공식 공개 자료이며 학교가 나이스에 입력한 "그날 실제로 돌아간" 시간표다.
 * 학기 중 수업 교환과 보강이 그대로 반영되어 있어 기준 시간표와 비교하면 변경 이력을 복원할 수 있다.
 *
 * 한계가 하나 있고 그것이 설계를 가른다. 응답에 교사 항목이 없다.
 * 따라서 이 어댑터 단독으로는 교사 중심 교환 탐색을 만들 수 없다.
 * 학급 시간표와 휴업일, 변경 이력까지 만들고, 교사 연결은 호출하는 쪽이 넘긴다.
 *
 * 엔드포인트는 학교급에 따라 elsTimetable(초), misTimetable(중),
 * hisTimetable(고), spsTimetable(특수)로 나뉘지만 응답 항목은 같다.
 */

/** 개방 포털 응답 1행. 쓰지 않는 항목은 생략했다. */
export interface NeisRow {
  SCHUL_NM?: string;
  AY?: string;
  SEM?: string;
  /** 수업 일자. 예: "20260622" */
  ALL_TI_YMD: string;
  GRADE: string;
  CLASS_NM: string;
  /** 교시. 1부터 */
  PERIO: string;
  /** 수업 내용. 과목명이 들어오지만 휴업 사유나 보강 표기도 이 자리에 온다. */
  ITRT_CNTNT: string;
  CLRM_NM?: string;
}

export type NeisKind = '수업' | '보강' | '휴업';

export interface NeisCell {
  /** "20260622" */
  date: string;
  /** 0 = 월요일 */
  day: number;
  /** 0부터 세는 교시 */
  period: number;
  klass: string;
  /** 보강이면 표기를 떼어 낸 실제 과목명 */
  subject: string;
  kind: NeisKind;
}

/** 기준 시간표와 달랐던 칸 1개 */
export interface NeisChange {
  date: string;
  klass: string;
  period: number;
  /** 기준 시간표의 과목 */
  base: string;
  /** 그날 실제 과목 */
  actual: string;
}

/** 같은 날 같은 학급에서 두 교시가 서로 자리를 바꾼 흔적 */
export interface NeisSwap {
  date: string;
  klass: string;
  periodA: number;
  periodB: number;
  subjectA: string;
  subjectB: string;
}

export interface NeisReport {
  schoolName: string;
  config: ScheduleConfig;
  cells: NeisCell[];
  /** 학급 하루 전체가 같은 값으로 채워진 날. 값은 일자 문자열 */
  holidays: string[];
  /** 보강으로 표기된 칸 */
  covers: NeisCell[];
  changes: NeisChange[];
  swaps: NeisSwap[];
  /** `${klass}|${day}|${period}` 별 최빈 과목. 학기 기준 시간표로 본다. */
  base: Map<string, string>;
}

const COVER_MARK = '[보강]';

export const baseKey = (klass: string, day: number, period: number): string =>
  `${klass}|${day}|${period}`;

/** "20260622" 를 요일 번호로. 0 = 월요일. 표준시 영향을 받지 않도록 UTC 로 센다. */
export function dayOfYmd(ymd: string): number {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * 응답 행을 훑어 학급 시간표, 휴업일, 보강, 변경, 맞교환을 한 번에 만든다.
 * 기준 시간표는 수업으로 인정된 칸의 (학급, 요일, 교시)별 최빈 과목으로 잡는다.
 * 관측 주가 적으면 기준이 흔들리므로 최소 3주 이상의 자료를 넣는 것을 권한다.
 */
export function fromNeis(rows: NeisRow[]): NeisReport {
  const parsed = rows
    .filter((r) => r && r.ALL_TI_YMD && r.PERIO && r.ITRT_CNTNT)
    .map((r) => ({
      date: r.ALL_TI_YMD,
      day: dayOfYmd(r.ALL_TI_YMD),
      period: Number(r.PERIO) - 1,
      klass: `${r.GRADE}-${r.CLASS_NM}`,
      raw: r.ITRT_CNTNT.trim(),
    }));

  // 하루의 모든 관측 칸이 같은 값이면 휴업일로 본다. 사유 문구 목록에 기대지 않는 판별이다.
  const perDay = new Map<string, Set<string>>();
  for (const p of parsed) {
    const k = `${p.klass}|${p.date}`;
    const s = perDay.get(k) ?? new Set<string>();
    s.add(p.raw);
    perDay.set(k, s);
  }
  const holidaySet = new Set<string>();
  for (const [k, vals] of perDay) {
    const [, date] = k.split('|');
    const count = parsed.filter((p) => `${p.klass}|${p.date}` === k).length;
    if (count >= 2 && vals.size === 1 && date !== undefined) holidaySet.add(k);
  }

  const cells: NeisCell[] = parsed.map((p) => {
    const isHoliday = holidaySet.has(`${p.klass}|${p.date}`);
    const isCover = p.raw.startsWith(COVER_MARK);
    return {
      date: p.date,
      day: p.day,
      period: p.period,
      klass: p.klass,
      subject: isCover ? p.raw.slice(COVER_MARK.length).trim() : p.raw,
      kind: isHoliday ? '휴업' : isCover ? '보강' : '수업',
    };
  });

  // 기준 시간표: 휴업과 보강을 뺀 칸의 최빈 과목
  const tally = new Map<string, Map<string, number>>();
  for (const c of cells) {
    if (c.kind !== '수업') continue;
    const k = baseKey(c.klass, c.day, c.period);
    const m = tally.get(k) ?? new Map<string, number>();
    m.set(c.subject, (m.get(c.subject) ?? 0) + 1);
    tally.set(k, m);
  }
  const base = new Map<string, string>();
  for (const [k, m] of tally) {
    let best = '';
    let bestN = -1;
    for (const [subj, n] of m) {
      if (n > bestN || (n === bestN && subj.localeCompare(best, 'ko') < 0)) {
        best = subj;
        bestN = n;
      }
    }
    base.set(k, best);
  }

  const changes: NeisChange[] = [];
  for (const c of cells) {
    if (c.kind !== '수업') continue;
    const b = base.get(baseKey(c.klass, c.day, c.period));
    if (b !== undefined && b !== c.subject) {
      changes.push({ date: c.date, klass: c.klass, period: c.period, base: b, actual: c.subject });
    }
  }

  // 같은 날 같은 학급에서 두 칸이 서로의 기준 과목을 맞바꿔 가지고 있으면 맞교환이다.
  const swaps: NeisSwap[] = [];
  const byDay = new Map<string, NeisChange[]>();
  for (const ch of changes) {
    const k = `${ch.klass}|${ch.date}`;
    byDay.set(k, [...(byDay.get(k) ?? []), ch]);
  }
  for (const list of byDay.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.actual === b.base && b.actual === a.base) {
          swaps.push({
            date: a.date,
            klass: a.klass,
            periodA: a.period,
            periodB: b.period,
            subjectA: a.base,
            subjectB: b.base,
          });
        }
      }
    }
  }

  const maxPeriod = cells.reduce((m, c) => Math.max(m, c.period + 1), 0);
  const config: ScheduleConfig = {
    days: 5,
    periods: Math.max(maxPeriod, 1),
    dayNames: ['월', '화', '수', '목', '금'],
  };

  return {
    schoolName: rows[0]?.SCHUL_NM ?? '이름 없는 학교',
    config,
    cells,
    holidays: [...new Set([...holidaySet].map((k) => k.split('|')[1] ?? ''))].filter(Boolean).sort(),
    covers: cells.filter((c) => c.kind === '보강'),
    changes,
    swaps,
    base,
  };
}

/**
 * 기준 시간표를 엔진 입력으로 바꾼다.
 * 개방 자료에 교사가 없으므로 (학급, 과목) 을 교사로 옮기는 표는 부르는 쪽이 준다.
 * 표에 없는 과목은 건너뛴다. 부분만 채워도 그만큼은 탐색에 쓸 수 있다.
 */
export function neisToTimetable(
  report: NeisReport,
  teacherOf: (klass: string, subject: string) => string | undefined,
): TimetableInput & { conflicts: TeacherConflict[] } {
  const assignments: Assignment[] = [];
  for (const [key, subject] of report.base) {
    const [klass, dayStr, periodStr] = key.split('|');
    if (klass === undefined || dayStr === undefined || periodStr === undefined) continue;
    const teacher = teacherOf(klass, subject);
    if (!teacher) continue;
    assignments.push({
      teacher,
      klass,
      subject,
      slot: slotOf(Number(dayStr), Number(periodStr), report.config),
    });
  }
  assignments.sort((a, b) => a.slot - b.slot || a.klass.localeCompare(b.klass, 'ko'));

  // 한 사람이 같은 교시에 두 학급에 들어갈 수는 없다.
  // 그런 배정이 나왔다면 그 수업들은 실제로 한 몸이다. 합반이거나 이동수업이다.
  // 짐작이 아니라 물리적으로 그럴 수밖에 없는 경우라 여기서 묶어 준다.
  // 묶지 않으면 한 학급만 떼어 옮기는, 현실에서 불가능한 안이 추천에 오른다.
  // 다만 과목까지 같을 때만 묶는다. 같은 이름이 같은 교시에 서로 다른 과목을 맡고 있다면
  // 그건 합반이 아니라 동명이인이거나 배정이 잘못된 것이다. 묶어 버리면 두 사람의 수업이
  // 한 몸으로 움직이는 엉뚱한 안이 나온다. 그런 자리는 묶지 않고 conflicts 로 넘겨 알린다.
  const bySlotTeacher = new Map<string, Assignment[]>();
  for (const a of assignments) {
    const k = `${a.teacher}|${a.slot}`;
    const list = bySlotTeacher.get(k);
    if (list) list.push(a);
    else bySlotTeacher.set(k, [a]);
  }
  const conflicts: TeacherConflict[] = [];
  for (const [k, list] of bySlotTeacher) {
    if (list.length < 2) continue;
    const subjects = [...new Set(list.map((a) => a.subject))];
    if (subjects.length === 1) {
      for (const a of list) a.group = `동시:${k}`;
    } else {
      conflicts.push({
        teacher: list[0]!.teacher,
        slot: list[0]!.slot,
        subjects: subjects.sort((x, y) => x.localeCompare(y, 'ko')),
        klasses: list.map((a) => a.klass).sort((x, y) => x.localeCompare(y, 'ko', { numeric: true })),
      });
    }
  }

  return { config: report.config, assignments, conflicts };
}

/**
 * 한 이름이 같은 교시에 서로 다른 과목을 맡고 있는 자리.
 *
 * 대개 동명이인이다. 학교에 김영희 선생님이 두 분이면 교사 배정에서 같은 이름으로 들어오고,
 * 도구는 한 사람이 같은 시간에 두 곳에 있는 시간표로 읽는다.
 * 이름 말고는 사람을 가릴 열쇠가 없어 도구가 풀 수 없다. 알리고 구분을 부탁한다.
 */
export interface TeacherConflict {
  teacher: string;
  slot: number;
  subjects: string[];
  klasses: string[];
}

/**
 * 이동수업으로 의심되는 자리를 찾는다. 아니면 빈 배열이다.
 *
 * 나이스 공개 자료에는 이동수업 표시가 없다. 그렇다고 "같은 교시에 같은 과목"만 보고
 * 알리면 하루에도 수십 번 뜬다. 1학년 여섯 반이 1교시에 다 같이 국어를 듣는 일은
 * 이동수업이 아니라 그냥 흔한 편성이다. 그렇게 자주 뜨는 알림은 곧 무시당한다.
 *
 * 그래서 한 가지를 더 본다. **짝이 늘 같은가**이다.
 * 이동수업이면 같은 학급 무리가 그 과목 시간마다 통째로 함께 움직인다.
 * 우연히 겹친 것이면 다른 교시에서는 짝이 달라진다.
 * 그 과목이 걸린 모든 교시에서 학급 구성이 똑같을 때만 알린다.
 *
 * 이래도 단정은 아니다. 그래서 묶지 않고 여쭙기만 한다. 아는 사람은 선생님이다.
 */
export function groupCandidate(
  input: TimetableInput,
  slot: number,
  subject: string,
  klass: string,
): Assignment[] {
  const here = input.assignments.filter((a) => a.slot === slot && a.subject === subject);
  if (here.length < 2 || here.some((a) => a.group !== undefined)) return [];
  const mine = new Set(here.map((a) => a.klass));
  if (!mine.has(klass)) return [];

  // 이 학급들이 이 과목을 듣는 모든 교시를 모은다.
  const slots = new Set(
    input.assignments.filter((a) => a.subject === subject && mine.has(a.klass)).map((a) => a.slot),
  );
  for (const s of slots) {
    const there = input.assignments.filter((a) => a.slot === s && a.subject === subject);
    const set = new Set(there.map((a) => a.klass));
    // 한 교시라도 학급 구성이 다르면 늘 붙어 다니는 무리가 아니다.
    if (set.size !== mine.size) return [];
    for (const k of mine) if (!set.has(k)) return [];
  }
  return here.filter((a) => a.klass !== klass);
}
