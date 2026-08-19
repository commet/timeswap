import type { ScheduleConfig, TimetableInput, Assignment } from './../types';
import { slotOf } from './../slots';
import {
  normalizeNeisRows,
  type NeisNormalizationReport,
  type NeisRow,
} from './neis-normalize';

export type { NeisRow } from './neis-normalize';

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

export type NeisKind = '수업' | '보강' | '휴업';

export interface NeisCell {
  /** "20260622" */
  date: string;
  /** 0 = 월요일 */
  day: number;
  /** 0부터 세는 교시 */
  period: number;
  /** Canonical, collision-safe class identity used by the engine. */
  klass: string;
  /** Human-readable grade/class label for presentation. */
  classLabel: string;
  /** 보강과 전문교과 표기를 떼어 낸 실제 과목명 */
  subject: string;
  kind: NeisKind;
  /** 과목명 앞에 별표가 붙어 있었는지. 전문교과 실습이다. */
  pro: boolean;
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
  /** Accepted, quarantined, duplicate, and parallel NEIS data-quality diagnostics. */
  normalization: NeisNormalizationReport;
  config: ScheduleConfig;
  cells: NeisCell[];
  /** 학급 하루 전체가 같은 값으로 채워진 날. 값은 일자 문자열 */
  holidays: string[];
  /** 보강으로 표기된 칸 */
  covers: NeisCell[];
  changes: NeisChange[];
  swaps: NeisSwap[];
  /**
   * `${klass}|${day}|${period}` 별 기준 과목. 학기 기준 시간표로 본다.
   *
   * 값이 배열인 이유는 한 칸에 과목이 둘 이상 오는 학교가 있기 때문이다.
   * 예술 계열에서 전공 실기를 나누어 편성하면 같은 학급 같은 교시에 두 과목이 함께 온다.
   * 실측에서 국립전통예술고 15%, 울산예술고 5% 였고 나머지 학교는 0% 였다.
   * 많이 나온 하나만 남기면 그 학교 시간표가 절반만 담긴다.
   */
  base: Map<string, string[]>;
  /** base 의 열쇠 가운데 전문교과 실습인 자리 */
  proKeys: Set<string>;
  /** 수업 칸 가운데 전문교과 표시가 붙은 비율. 0 이면 일반고로 봐도 된다. */
  proRate: number;
}

const COVER_MARK = '[보강]';

/**
 * 전문교과 실습 표시.
 *
 * 나이스 자료의 실제 형태는 `* 도면해독(선반가공)` 이고, 보강까지 겹치면
 * `[보강]* 실내건축설계 기획` 처럼 보강 표시가 앞에 온다. 그래서 떼는 순서가 정해져 있다.
 *
 * 이 표시를 과목명에 그대로 두면 두 가지가 어긋난다.
 * 화면에 별표가 그대로 나오고, 교사 배정표가 과목명을 열쇠로 쓰므로
 * 같은 과목이 표시 유무로 갈릴 수 있다. 떼어서 따로 들고 다닌다.
 */
const PRO_MARK = '*';

/** 앞에 붙은 표시를 떼고 과목명과 표시 여부를 함께 돌려준다. */
export function stripMarks(raw: string): { subject: string; cover: boolean; pro: boolean } {
  let t = raw.trim();
  const cover = t.startsWith(COVER_MARK);
  if (cover) t = t.slice(COVER_MARK.length).trim();
  const pro = t.startsWith(PRO_MARK);
  if (pro) t = t.slice(PRO_MARK.length).trim();
  return { subject: t, cover, pro };
}

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
  const normalization = normalizeNeisRows(rows);
  const parsed = normalization.accepted.map((row) => ({
      date: row.date,
      day: dayOfYmd(row.date),
      period: Number(row.period) - 1,
      klass: row.classKey,
      classLabel: `${row.classIdentity.grade}-${row.classIdentity.className}`,
      grade: row.classIdentity.grade,
      raw: row.rawSubject,
    }));

  /*
   * 휴업일을 가른다. 사유 문구 목록에 기대지 않는 판별이다.
   *
   * 하루의 관측 칸이 모두 같은 값이면 휴업일로 보았다. 실제 특성화고 자료에서 이 규칙이
   * 크게 어긋났다. 전공 실습을 하루 종일 편성하는 학급이 흔해서, 학교 한 곳에서
   * 41개 학급일이 휴업으로 잡혔다. 관측 칸의 18%가 수업이 아닌 것으로 버려졌다.
   *
   * 가르는 것은 몇 학급에 걸쳐 있는가다. 그 자료에서 하루가 한 값이던 41건은
   * 모두 한 학급짜리였다. 휴업일과 학년 행사는 학년이나 학교 전체를 덮는다.
   *
   * 그래서 셋을 본다.
   * 1. 그 학급 그날의 관측 칸이 모두 같은 값이고 둘 이상이다
   * 2. 그 값에 전문교과 표시가 붙어 있지 않다. 붙어 있으면 실습이다
   * 3. 그날 관측된 그 학년의 학급이 모두 같은 값이다
   *
   * 3번을 비율이 아니라 "관측된 학급 전부"로 두는 이유가 있다. 한 학급만 받아 온
   * 자료도 다뤄야 하기 때문이다. 그때는 1/1 이라 통과한다. 학교 전체를 받아 오면
   * 한 학급짜리 실습은 걸러진다. 자료가 두꺼울수록 정확해지고 얇아도 쓸 수 있다.
   */
  const gradeByKlass = new Map(parsed.map((row) => [row.klass, row.grade]));
  const gradeOfKlass = (klass: string): string => gradeByKlass.get(klass) ?? klass;
  const perDay = new Map<string, { vals: Set<string>; n: number; pro: boolean }>();
  for (const p of parsed) {
    const k = `${p.klass}|${p.date}`;
    const cur = perDay.get(k) ?? { vals: new Set<string>(), n: 0, pro: false };
    const { subject, pro } = stripMarks(p.raw);
    cur.vals.add(subject);
    cur.n += 1;
    cur.pro ||= pro;
    perDay.set(k, cur);
  }
  // (날짜, 학년)마다 관측된 학급과, 그 가운데 하루가 한 값이던 학급을 값별로 모은다
  const seenInGrade = new Map<string, Set<string>>();
  const uniformInGrade = new Map<string, Set<string>>();
  for (const [k, info] of perDay) {
    const [klass, date] = k.split('|');
    if (klass === undefined || date === undefined) continue;
    const gk = `${date}|${gradeOfKlass(klass)}`;
    (seenInGrade.get(gk) ?? seenInGrade.set(gk, new Set()).get(gk)!).add(klass);
    if (info.n >= 2 && info.vals.size === 1 && !info.pro) {
      const vk = `${gk}|${[...info.vals][0]}`;
      (uniformInGrade.get(vk) ?? uniformInGrade.set(vk, new Set()).get(vk)!).add(klass);
    }
  }
  const holidaySet = new Set<string>();
  for (const [k, info] of perDay) {
    const [klass, date] = k.split('|');
    if (klass === undefined || date === undefined) continue;
    if (info.n < 2 || info.vals.size !== 1 || info.pro) continue;
    const gk = `${date}|${gradeOfKlass(klass)}`;
    const whole = seenInGrade.get(gk)?.size ?? 0;
    const same = uniformInGrade.get(`${gk}|${[...info.vals][0]}`)?.size ?? 0;
    if (whole > 0 && same === whole) holidaySet.add(k);
  }

  const cells: NeisCell[] = parsed.map((p) => {
    const isHoliday = holidaySet.has(`${p.klass}|${p.date}`);
    const { subject, cover, pro } = stripMarks(p.raw);
    return {
      date: p.date,
      day: p.day,
      period: p.period,
      klass: p.klass,
      classLabel: p.classLabel,
      subject,
      kind: isHoliday ? '휴업' : cover ? '보강' : '수업',
      pro,
    };
  });

  // 기준 시간표: 휴업과 보강을 뺀 칸의 과목별 관측 횟수
  const tally = new Map<string, Map<string, number>>();
  const proKeys = new Set<string>();
  for (const c of cells) {
    if (c.kind !== '수업') continue;
    const k = baseKey(c.klass, c.day, c.period);
    const m = tally.get(k) ?? new Map<string, number>();
    m.set(c.subject, (m.get(c.subject) ?? 0) + 1);
    tally.set(k, m);
    if (c.pro) proKeys.add(k);
  }

  /**
   * 한 칸에 남길 과목을 고른다.
   *
   * 대개 한 과목이다. 둘 이상이면 둘 중 하나다. 학기 중에 시간표가 바뀌었거나,
   * 원래 그 칸에 두 강좌가 나란히 도는 분반이다.
   * 가르는 기준은 되풀이다. 바뀐 것이면 새 과목이 옛 과목을 밀어내 한쪽만 이어지고,
   * 분반이면 관측한 날마다 둘이 나란히 나온다.
   * 그래서 최빈의 절반 넘게 관측된 과목만 함께 남긴다. 한 번 스친 것은 변경으로 본다.
   */
  const base = new Map<string, string[]>();
  for (const [k, m] of tally) {
    const top = Math.max(...m.values());
    const keep = [...m.entries()]
      .filter(([, n]) => n * 2 > top)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
      .map(([subj]) => subj);
    base.set(k, keep);
  }

  const changes: NeisChange[] = [];
  for (const c of cells) {
    if (c.kind !== '수업') continue;
    const b = base.get(baseKey(c.klass, c.day, c.period));
    if (b !== undefined && b.length > 0 && !b.includes(c.subject)) {
      changes.push({
        date: c.date,
        klass: c.klass,
        period: c.period,
        base: b[0]!,
        actual: c.subject,
      });
    }
  }

  // 같은 날 같은 학급에서 두 칸이 서로의 기준 과목을 맞바꿔 가지고 있으면 맞교환이다.
  // 기준 과목이 둘인 칸(분반)은 여기서 뺀다. 어느 쪽과 맞바꿨는지 자료로 가릴 수 없고,
  // 잘못 짚은 교환 이력 한 줄이 그 학교의 이력 전체를 못 믿게 만든다.
  const swaps: NeisSwap[] = [];
  const byDay = new Map<string, NeisChange[]>();
  for (const ch of changes) {
    if ((base.get(baseKey(ch.klass, dayOfYmd(ch.date), ch.period))?.length ?? 0) > 1) continue;
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

  // 요일별 교시 수. 여러 주, 모든 학급을 훑어 그 요일에 실제로 쓰인 마지막 교시를 잡는다.
  // 학급 수십 개를 몇 주에 걸쳐 본 결과라 "아무도 안 쓴 교시"는 그 요일에 없는 교시로 봐도 된다.
  // 학급 한둘짜리 자료였다면 그저 비어 있는 칸과 가릴 수 없지만, 학교 전체 자료라 가릴 수 있다.
  const lastPeriodOfDay = new Array<number>(5).fill(0);
  for (const c of cells) {
    if (c.kind !== '수업') continue;
    if (c.day < 0 || c.day >= 5) continue;
    if (c.period + 1 > (lastPeriodOfDay[c.day] ?? 0)) lastPeriodOfDay[c.day] = c.period + 1;
  }
  const config: ScheduleConfig = {
    days: 5,
    periods: Math.max(maxPeriod, 1),
    dayNames: ['월', '화', '수', '목', '금'],
    // 요일마다 다를 때만 넣는다. 다 같으면 굳이 실어 보낼 값이 아니다.
    ...(new Set(lastPeriodOfDay).size > 1 && lastPeriodOfDay.every((n) => n > 0)
      ? { periodsPerDay: lastPeriodOfDay }
      : {}),
  };

  const lesson = cells.filter((c) => c.kind === '수업');
  return {
    schoolName: normalization.accepted[0]?.row.SCHUL_NM?.trim() ?? rows[0]?.SCHUL_NM?.trim() ?? '이름 없는 학교',
    normalization,
    config,
    cells,
    holidays: [...new Set([...holidaySet].map((k) => k.split('|')[1] ?? ''))].filter(Boolean).sort(),
    covers: cells.filter((c) => c.kind === '보강'),
    changes,
    swaps,
    base,
    proKeys,
    proRate: lesson.length === 0 ? 0 : lesson.filter((c) => c.pro).length / lesson.length,
  };
}

/**
 * 기준 시간표를 엔진 입력으로 바꾼다.
 * 개방 자료에 교사가 없으므로 (학급, 과목) 을 교사로 옮기는 표는 부르는 쪽이 준다.
 *
 * 표에 없는 과목은 배정으로 만들지 않는다. 다만 **그 자리가 비어 있다고 하지도 않는다.**
 * 학교 하나에 (학급, 과목) 짝이 수백 개라 처음부터 다 채우고 시작하는 사람은 없고,
 * 덜 채운 칸을 배정에서 빼면 그 자리가 빈 시간으로 보여 학급이 실제로는 수업 중인 교시로
 * 다른 수업을 밀어 넣는 안이 나온다. 실측에서 표를 60%만 채웠을 때
 * 추천안 459개에 그런 이동이 282건 들어 있었다.
 * 그래서 담당을 모르는 자리는 klassBusy 로 넘겨 "차 있다"는 사실만 지킨다.
 */
export function neisToTimetable(
  report: NeisReport,
  teacherOf: (klass: string, subject: string) => string | undefined,
): TimetableInput & { conflicts: TeacherConflict[] } {
  const assignments: Assignment[] = [];
  const busy = new Map<string, Set<number>>();
  for (const [key, subjects] of report.base) {
    const [klass, dayStr, periodStr] = key.split('|');
    if (klass === undefined || dayStr === undefined || periodStr === undefined) continue;
    if (subjects.length === 0) continue;
    const slot = slotOf(Number(dayStr), Number(periodStr), report.config);
    const pro = report.proKeys.has(key);
    const teachers = subjects.map((s) => teacherOf(klass, s));

    // 한 칸은 통째로 채워졌을 때만 다룬다. 나뉜 수업의 한쪽만 알고 옮기면
    // 남은 학생들이 갈 데가 없다. 하나라도 비면 그 칸은 차 있다는 사실만 남긴다.
    if (teachers.some((t) => !t)) {
      (busy.get(klass) ?? busy.set(klass, new Set()).get(klass)!).add(slot);
      continue;
    }
    subjects.forEach((subject, i) => {
      assignments.push({
        teacher: teachers[i]!,
        klass,
        subject,
        slot,
        ...(pro ? { pro: true } : {}),
      });
    });
  }
  assignments.sort((a, b) => a.slot - b.slot || a.klass.localeCompare(b.klass, 'ko'));

  const klassBusy: Record<string, number[]> = {};
  for (const [klass, slots] of busy) {
    klassBusy[klass] = [...slots].sort((x, y) => x - y);
  }

  /*
   * 같은 교시의 수업들을 물리적으로 한 몸인 것끼리 묶는다.
   *
   * 한 몸이 되는 길이 둘이다.
   * 하나, 같은 학급 같은 교시에 과목이 둘이면 그 학급이 나뉘어 듣는 것이다.
   * 둘, 한 사람이 같은 교시에 두 학급을 맡고 있으면 실제로는 한 자리에 모인 것이다.
   *     합반이거나 이동수업이다. 몸이 하나뿐이라 그럴 수밖에 없다.
   *
   * 둘을 따로 처리하면 안 된다. 실제 특성화고 자료에서 두 길이 한 자리에서 만났다.
   * 3-6 이 건축설계와 실내건축설계로 나뉘는데, 그 건축설계를 맡는 분이 같은 교시에
   * 3-5 도 맡고 있었다. 셋이 한 덩어리인데 따로 묶으면 두 조각으로 갈리고,
   * 그러면 학급 중복과 교사 중복 검사에 걸려 시간표 자체가 성립하지 않는다.
   * 그래서 이어지는 것을 끝까지 따라가 한 덩어리로 묶는다.
   *
   * 다만 과목까지 같을 때만 교사로 잇는다. 같은 이름이 같은 교시에 서로 다른 과목을
   * 맡고 있다면 그건 합반이 아니라 동명이인이거나 배정이 잘못된 것이다.
   * 묶어 버리면 두 사람의 수업이 한 몸으로 움직이는 엉뚱한 안이 나온다.
   * 그런 자리는 묶지 않고 conflicts 로 넘겨 알린다.
   */
  const parent = assignments.map((_, i) => i);
  const find = (i: number): number => {
    let r = i;
    while (parent[r] !== r) r = parent[r]!;
    for (let c = i; parent[c] !== r; ) {
      const next = parent[c]!;
      parent[c] = r;
      c = next;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  const firstOfCell = new Map<string, number>();
  const firstOfLesson = new Map<string, number>();
  const bySlotTeacher = new Map<string, number[]>();
  assignments.forEach((a, i) => {
    const cell = `${a.klass}|${a.slot}`;
    const seenCell = firstOfCell.get(cell);
    if (seenCell === undefined) firstOfCell.set(cell, i);
    else union(seenCell, i);

    const lesson = `${a.teacher}|${a.subject}|${a.slot}`;
    const seenLesson = firstOfLesson.get(lesson);
    if (seenLesson === undefined) firstOfLesson.set(lesson, i);
    else union(seenLesson, i);

    const ts = `${a.teacher}|${a.slot}`;
    const list = bySlotTeacher.get(ts);
    if (list) list.push(i);
    else bySlotTeacher.set(ts, [i]);
  });

  const members = new Map<number, number[]>();
  assignments.forEach((_, i) => {
    const r = find(i);
    const list = members.get(r);
    if (list) list.push(i);
    else members.set(r, [i]);
  });
  for (const [r, list] of members) {
    if (list.length < 2) continue;
    const a = assignments[r]!;
    for (const i of list) assignments[i]!.group = `동시:${a.klass}|${a.slot}`;
  }

  // 한 사람이 같은 교시에 두 곳에 있는데 그 둘이 한 덩어리로 이어지지 않으면 동명이인이다.
  const conflicts: TeacherConflict[] = [];
  for (const list of bySlotTeacher.values()) {
    if (list.length < 2) continue;
    const roots = new Set(list.map((i) => find(i)));
    if (roots.size < 2) continue;
    const rows = list.map((i) => assignments[i]!);
    conflicts.push({
      teacher: rows[0]!.teacher,
      slot: rows[0]!.slot,
      subjects: [...new Set(rows.map((x) => x.subject))].sort((x, y) => x.localeCompare(y, 'ko')),
      klasses: rows.map((x) => x.klass).sort((x, y) => x.localeCompare(y, 'ko', { numeric: true })),
    });
  }

  // 학년은 학급 표시(`2-7`)에서 읽어 명시로 넘긴다.
  // 학급 키는 학교 코드로 시작하는 구조화된 값이라 거기서 캐내면 학교 코드를 학년으로 읽는다.
  const klassGrade: Record<string, number> = {};
  for (const c of report.cells) {
    if (klassGrade[c.klass] !== undefined) continue;
    const g = Number(c.classLabel.split('-')[0]);
    if (Number.isFinite(g) && g >= 1 && g <= 12) klassGrade[c.klass] = g;
  }

  return {
    config: report.config,
    assignments,
    conflicts,
    ...(Object.keys(klassGrade).length > 0 ? { klassGrade } : {}),
    ...(Object.keys(klassBusy).length > 0 ? { klassBusy } : {}),
  };
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
 * 학년의 편성 모양. 교체 상대를 찾기 어려운 학년인지 가르는 데 쓴다.
 *
 * 인증키를 받아 전국 고등학교 217곳의 한 주를 통째로 재어 다시 만들었다.
 * 앞서 24곳으로 정한 값을 그대로 두었다면 안내 절반이 틀린 채로 나갔다.
 *
 * 가르는 값은 공통도(sharedRate)다. 과목마다 그 과목을 듣는 학급이 학년의 몇 할인지
 * 구해 평균한다. 모든 학급이 같은 과목을 들으면 1.0 이고, 학급마다 다른 강좌를
 * 들으면 0 에 가까워진다.
 *
 * | 무리 | 1학년 중앙 | 2학년 중앙 | 3학년 중앙 |
 * |---|---|---|---|
 * | 일반고와 자율고 (106곳) | 0.91 | 0.50 | 0.39 |
 * | 특목고 (28곳) | 0.75 | 0.56 | 0.57 |
 *
 * 자리마다 "이동수업입니까"를 묻던 규칙은 판별력이 없었다. 학년과 무관하게 비슷한
 * 수가 나와 공통과목만 있는 1학년에서도 같은 빈도로 떴다. 그래서 묻는 단위를
 * 자리에서 학년으로 옮겼다.
 */
export interface GradeShape {
  /** 학년. 학급 이름 맨 앞 숫자 */
  grade: number;
  klasses: number;
  subjects: number;
  /**
   * 학급 수로 나눈 과목 종수.
   *
   * 화면에 "학급 N개에 과목 M종"으로 보여 주는 데만 쓴다. 판정에는 쓰지 않는다.
   * 분모가 학급 수라 학년이 작을수록 값이 커진다. 전국 표본에서 학급 1~2개 학년의
   * 중앙값이 10.00, 11개 이상 학년이 1.91 이었다. 같은 교육과정을 돌려도 다섯 배가
   * 벌어진다. 이 값으로 가르면 작은 학교를 통째로 선택과목 구간으로 읽는다.
   */
  ratio: number;
  /**
   * 공통도. 과목마다 (그 과목을 듣는 학급 수 / 학년 학급 수)를 구해 평균한 값이다.
   *
   * 학급 수로 먼저 나눈 뒤 평균하므로 학년 규모에 덜 끌려다닌다. 같은 전국 표본에서
   * 학급 1~2개 학년 1.00, 11개 이상 학년 0.46 으로 벌어짐이 5.2배에서 2.2배로 줄었다.
   * 남은 벌어짐은 치우침이 아니다. 학급이 하나뿐인 학년에는 함께 움직일 다른 학급이
   * 정말로 없다.
   */
  sharedRate: number;
  /** 그 가운데 전문교과 실습 과목 종수 */
  proSubjects: number;
  /**
   * 그 학년 수업 가운데 담당 교사를 아직 모르는 몫.
   *
   * 이 값이 크면 공통도를 믿을 수 없다. 덜 채운 자리가 "그 학급은 그 과목을 안 듣는다"로
   * 읽혀 공통도를 끌어내리기 때문이다.
   */
  unknownRate: number;
  /**
   * 교체 상대를 찾기 어려운 학년으로 볼 만한지.
   *
   * 자료가 얇거나 표를 덜 채웠으면 참으로 두지 않는다. 모르는 것을 근거로 삼지 않는다.
   */
  elective: boolean;
  /**
   * 과목이 많은 까닭. 화면에 다른 문장이 나간다.
   *
   * 공통도만 보고 모두 "선택과목"이라 하면 특성화고에서 틀린다.
   * 전국 217곳 실측에서 전문계 3학년의 85%가 기준 아래로 내려가는데, 그 학교의
   * 교체 상대가 적은 까닭은 고교학점제 선택과목이 아니라 학과별 전공 편성이다.
   * 학급은 학과 안에서 그대로 함께 다닌다.
   * 이유를 틀리게 말하면 그 뒤의 안내까지 못 믿게 된다.
   */
  kind: '보통' | '선택과목' | '전공실습';
}

/**
 * 공통도가 이 값보다 낮으면 교체 상대를 찾기 어려운 학년으로 본다.
 *
 * 앞서 두 번 틀렸다. 학교 셋만 보고 "과목 종수 / 학급 수"를 1.5로 잡았고,
 * 24곳으로 넓히니 1학년 중앙값이 바로 1.5여서 2.2로 옮겼다.
 * 인증키를 받아 전국 217곳을 통째로 재니 2.2도 틀린 값이었다.
 *
 * | 기준 (옛 지표) | 일반고 1학년 오탐 | 특목고 1학년 오탐 |
 * |---|---|---|
 * | 2.2 (24곳에서 4%로 봤던 값) | **17%** | **50%** |
 *
 * 기준값을 옮겨도 낫지 않았다. 4.0 까지 올려도 오탐이 9%와 25%로 남는데 3학년 미탐이
 * 64%로 갔다. 값이 아니라 지표가 문제였다. 분모가 학급 수여서 작은 학년이 무조건
 * 높게 나왔기 때문이다.
 *
 * 그래서 공통도로 바꿨다. 같은 표본에서 이렇게 갈린다.
 *
 * | 기준 | 일반고 1학년 오탐 | 일반고 3학년 미탐 | 특목고 1학년 오탐 | 특목고 3학년 미탐 |
 * |---|---|---|---|---|
 * | 0.60 | 3% | 9% | 18% | 36% |
 * | **0.65** | **3%** | **7%** | **25%** | **25%** |
 * | 0.70 | 4% | 5% | 29% | 14% |
 *
 * 0.65 를 골랐다. 표본을 절반으로 갈라 스무 번 다시 고르게 하니 0.59 에서 0.70 사이,
 * 중앙 0.67 이 나왔다. 0.65 는 그 안에 넉넉히 든다.
 *
 * 특목고 오탐 25% 는 그대로 두었다. 과학고와 외국어고 1학년에는 실제로 계열별 강좌가
 * 열려 오탐이라 센 것 가운데 오탐이 아닌 것이 섞여 있다. 자료로 가릴 수 없어
 * 숫자를 그대로 적어 둔다. 없는 정확도를 적어 두면 다음 사람이 속는다.
 *
 * 잘못 알리는 쪽이 놓치는 쪽보다 나쁘다는 원칙은 그대로다. 공통과목만 도는 1학년에서
 * "선택과목이라 교체가 어렵다"고 하면 그 말이 틀렸고, 한 번 틀린 안내는 다음 안내까지
 * 못 믿게 만든다.
 */
export const SHARED_SUBJECT_MIN = 0.65;

/**
 * 학년의 수업 가운데 담당을 모르는 몫이 이 값을 넘으면 판정을 내지 않는다.
 *
 * 교사 표는 사람이 채운다. 학교 하나에 (학급, 과목) 짝이 수백 개라 처음부터 다 채우고
 * 시작하는 사람은 없다. 그런데 덜 채우면 공통도가 실제보다 낮게 나온다. 한 과목을
 * 학급 넷이 다 듣는데 둘만 채워 두면 그 과목은 0.5 로 계산되기 때문이다.
 *
 * 전국 217곳 자료로 표를 무작위로 덜 채워 가며 재었다. 판정이 뒤집힌 몫이다.
 *
 * | 채운 비율 | 뒤집힘 | 그중 오탐 |
 * |---|---|---|
 * | 100% | 0.0% | 0.0% |
 * | 90% | 5.4% | 5.4% |
 * | 80% | 10.6% | 10.6% |
 * | 70% | 22.1% | 21.9% |
 * | 60% | 32.6% | 32.4% |
 *
 * **뒤집힘이 거의 전부 오탐이다.** 덜 채운 학교가 "선택과목이라 교체가 어렵다"는
 * 틀린 안내를 받는다. 표를 덜 채웠다는 이유만으로 나가는 안내다.
 *
 * 그래서 담당을 모르는 몫으로 억제한다. 억제 기준별로 남는 오탐이다.
 *
 * | 억제 기준 | 억제된 몫 | 남은 오탐 | 제대로 뜬 안내 |
 * |---|---|---|---|
 * | 없음 | 0.0% | 14.6% | 56.5% |
 * | 0.35 | 24.8% | 6.2% | 42.2% |
 * | **0.25** | **37.3%** | **3.2%** | **35.2%** |
 * | 0.15 | 55.8% | 1.3% | 24.7% |
 *
 * 0.25 를 골랐다. 지표 자체의 오탐이 3% 라서다. 지키려는 것보다 헐거운 보호 장치는
 * 약한 고리가 된다. 더 조이면 제대로 뜰 안내까지 절반이 사라진다.
 */
export const MAX_UNKNOWN_SHARE = 0.25;

/**
 * 학교 전체 과목 가운데 이 몫 넘게 전문교과이면 전공 편성으로 과목이 많은 학교로 본다.
 *
 * 학교 25곳을 재어 정했다. 학년별이 아니라 학교 전체로 재는 이유가 여기 있다.
 *
 * | 학년 | 표본 | 최소 | 중앙 | 최대 |
 * |---|---|---|---|---|
 * | 특성화고 1학년 | 13 | 0.00 | **0.00** | 0.20 |
 * | 특성화고 2학년 | 13 | 0.20 | 0.47 | 0.78 |
 * | 특성화고 3학년 | 12 | 0.46 | 0.73 | 0.86 |
 *
 * 특성화고라도 1학년에는 전문교과가 거의 없다. 학년만 보면 그 학년을 일반고로 읽는다.
 * 학교 단위로 재면 두 무리가 겹치지 않고 갈린다.
 *
 * | 무리 | 학교 | 최소 | 중앙 | 최대 |
 * |---|---|---|---|---|
 * | 과학고, 외국어고, 예술고, 체육고 | 9 | 0.00 | 0.00 | 0.00 |
 * | 특성화고와 마이스터고 | 16 | 0.31 | 0.54 | 0.67 |
 *
 * **여기까지가 25곳에서 본 것이고, 그때 붙인 근거는 틀렸다.**
 * 당시에는 "0.00 과 0.31 사이에 놓인 학교가 하나도 없으니 값이 흔들려도 결과가
 * 안 바뀐다"고 적었다. 전국 217곳에서는 그 구간에 13곳이 들어앉는다.
 *
 * 값은 그대로 두었다. 근거를 다시 대야 해서 다시 쟀을 뿐이다.
 * 나이스의 `HS_GNRL_BUSNS_SC_NM`(일반계 또는 전문계)을 정답으로 놓고 훑었다.
 * 계열명으로 가르면 안 된다. 특성화고로 등록된 대안학교가 전문교과를 하나도 안 쓴다.
 *
 * | 기준 | 전문계 미탐 | 일반계 오탐 | 오분류 합 |
 * |---|---|---|---|
 * | 0.05 | 2.5% | 2.9% | 6 |
 * | **0.15** | **3.8%** | **2.2%** | **6** |
 * | 0.20 | 7.6% | 1.4% | 8 |
 * | 0.30 | 13.9% | 0.7% | 12 |
 *
 * 217곳에 오분류 6곳으로 최저다. 다만 경계가 비어 있어서가 아니라 오분류가 가장
 * 적어서 고른 값이다. 표본이 늘면 다시 재야 한다.
 */
export const PRO_SHARE = 0.15;

/**
 * 학급의 학년을 읽는다. 명시로 받은 것이 먼저다.
 *
 * 학급 키에서 정규식으로 캐내는 길만 두었다가 실제 자료에서 통째로 틀렸다.
 * 나이스 학급 키는 학교 코드로 시작하는 JSON 이라 첫 숫자가 학년이 아니다.
 */
function gradeOf(klass: string, map: Record<string, number> | undefined): number | undefined {
  const named = map?.[klass];
  if (named !== undefined && Number.isFinite(named) && named >= 1 && named <= 12) return named;
  if (map !== undefined) return undefined;
  const m = /\d+/.exec(klass);
  if (!m) return undefined;
  const g = Number(m[0]);
  return Number.isFinite(g) && g >= 1 && g <= 12 ? g : undefined;
}

export function gradeShapes(input: TimetableInput): GradeShape[] {
  const klasses = new Map<number, Set<string>>();
  const subjects = new Map<number, Set<string>>();
  const proSubjects = new Map<number, Set<string>>();
  /** 학년 안에서 과목마다 그 과목을 듣는 학급을 모은다. 공통도의 재료다. */
  const takers = new Map<number, Map<string, Set<string>>>();
  for (const a of input.assignments) {
    const g = gradeOf(a.klass, input.klassGrade);
    if (g === undefined) continue;
    (klasses.get(g) ?? klasses.set(g, new Set()).get(g)!).add(a.klass);
    (subjects.get(g) ?? subjects.set(g, new Set()).get(g)!).add(a.subject);
    if (a.pro) (proSubjects.get(g) ?? proSubjects.set(g, new Set()).get(g)!).add(a.subject);
    const perGrade = takers.get(g) ?? takers.set(g, new Map()).get(g)!;
    (perGrade.get(a.subject) ?? perGrade.set(a.subject, new Set()).get(a.subject)!).add(a.klass);
  }
  // 학교 전체의 전문교과 몫. 학년마다 센 것을 더해 나눈다.
  let allSubjects = 0;
  let allPro = 0;
  for (const [g, ss] of subjects) {
    allSubjects += ss.size;
    allPro += proSubjects.get(g)?.size ?? 0;
  }
  const vocational = allSubjects > 0 && allPro / allSubjects >= PRO_SHARE;

  // 학년마다 아는 자리와 모르는 자리를 센다. 단위를 (학급, 슬롯)으로 맞춘다.
  // 한 칸에 강좌가 둘인 분반이 있어 배정 수를 그대로 세면 klassBusy 와 단위가 어긋난다.
  const knownCells = new Map<number, Set<string>>();
  const unknownCells = new Map<number, number>();
  for (const a of input.assignments) {
    const g = gradeOf(a.klass, input.klassGrade);
    if (g === undefined) continue;
    (knownCells.get(g) ?? knownCells.set(g, new Set()).get(g)!).add(`${a.klass}|${a.slot}`);
  }
  for (const [klass, slots] of Object.entries(input.klassBusy ?? {})) {
    const g = gradeOf(klass, input.klassGrade);
    if (g === undefined) continue;
    unknownCells.set(g, (unknownCells.get(g) ?? 0) + slots.length);
  }

  const out: GradeShape[] = [];
  for (const [g, ks] of klasses) {
    const ss = subjects.get(g)?.size ?? 0;
    const ps = proSubjects.get(g)?.size ?? 0;
    const ratio = ks.size === 0 ? 0 : ss / ks.size;
    // 공통도. 과목마다 (그 과목을 듣는 학급 / 학년 학급)을 구해 평균한다.
    const perSubject = takers.get(g);
    let sharedRate = 1;
    if (perSubject !== undefined && perSubject.size > 0 && ks.size > 0) {
      let sum = 0;
      for (const who of perSubject.values()) sum += who.size / ks.size;
      sharedRate = sum / perSubject.size;
    }
    // 과목이 하나뿐인 학년은 표본이 아니라 자료가 얇은 것이다. 단정하지 않는다.
    const enough = ss >= 3;
    const known = knownCells.get(g)?.size ?? 0;
    const unknown = unknownCells.get(g) ?? 0;
    const unknownRate = known + unknown === 0 ? 0 : unknown / (known + unknown);
    const trustworthy = unknownRate <= MAX_UNKNOWN_SHARE;
    const elective = enough && trustworthy && sharedRate < SHARED_SUBJECT_MIN;
    out.push({
      grade: g,
      klasses: ks.size,
      subjects: ss,
      ratio,
      sharedRate,
      unknownRate,
      proSubjects: ps,
      elective,
      kind: !elective ? '보통' : vocational ? '전공실습' : '선택과목',
    });
  }
  return out.sort((a, b) => a.grade - b.grade);
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
