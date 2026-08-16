import {
  applyChanges,
  fromNeis,
  genSchool,
  neisToTimetable,
  slotName,
  type Candidate,
  type Change,
  type NeisReport,
  type DayClosure,
  type NeisRow,
  type TeacherConflict,
  type ScheduleConfig,
  type TimetableInput,
} from '@timeswap/engine';
import { BRAND } from './brand';
import type { NeisEvent, NeisSchool } from './neis';

export const STORAGE_KEY = 'timeswap:v0:data';
export const TEACHER_KEY = 'timeswap:v0:teacher';
export const CHANGES_KEY = 'timeswap:v0:changes';
export const UNAVAIL_KEY = 'timeswap:v0:unavail';
export const THEME_KEY = 'timeswap:v0:theme';
export const REASON_KEY = 'timeswap:v0:reason';
export const OFFDAY_KEY = 'timeswap:v0:offdays';
export const NEIS_KEY_STORE = 'timeswap:v0:neiskey';

export type ThemeMode = 'auto' | 'light' | 'dark';

export const THEME_ORDER: ThemeMode[] = ['auto', 'light', 'dark'];
export const THEME_LABEL: Record<ThemeMode, string> = {
  auto: '자동',
  light: '밝음',
  dark: '어둠',
};

/** html 루트에 테마 속성을 적용한다. 자동이면 속성을 없애 OS 설정을 따른다. */
export function applyTheme(mode: ThemeMode): void {
  const el = document.documentElement;
  if (mode === 'auto') delete el.dataset.theme;
  else el.dataset.theme = mode;
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* 무시 */
  }
}

export function loadTheme(): ThemeMode {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

/** 시간표에 반영한 교환 1건. 변경 장부와 교체 계획서의 원천이다. */
/**
 * 장부에 남는 한 건.
 *
 * 교체만 담다가 보강을 함께 담게 넓혔다. 고교학점제로 선택과목이 강좌 단위로
 * 열리면서 수업을 다른 교시로 옮기는 일 자체가 성립하지 않는 자리가 늘었다.
 * 그런 자리에서 실제로 벌어지는 일은 담당 교사를 바꾸는 것이고,
 * 그것도 결재와 나이스 입력이 따르는 정식 변경이다. 장부가 그것을 담아야 한다.
 */
export interface AppliedEntry {
  id: number;
  type: Candidate['type'] | '보강';
  title: string;
  /** 교체면 옮기는 계획, 보강이면 비어 있다 */
  changes: Change[];
  /** 보강일 때만. 누가 어느 자리를 대신 맡는지 */
  cover?: {
    teacher: string;
    slot: number;
    klass: string;
    subject: string;
    /** 결강 당사자 */
    absent: string;
  };
}

export function loadEntries(): AppliedEntry[] {
  try {
    const raw = localStorage.getItem(CHANGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AppliedEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 반영한 변경을 이 브라우저에 둔다. 실패하면 알려야 하므로 성공 여부를 돌려준다. */
export function saveEntries(entries: AppliedEntry[]): boolean {
  try {
    localStorage.setItem(CHANGES_KEY, JSON.stringify(entries));
    return true;
  } catch {
    return false;
  }
}

/** 원본 시간표에 장부의 변경을 순서대로 적용한 현재 시간표를 만든다. */
/**
 * 장부를 시간표에 얹는다.
 *
 * 보강은 자리를 옮기지 않고 담당 교사만 바뀐다. 그래서 그 수업의 교사 이름을 갈아 끼운다.
 * 이렇게 해야 다음 탐색이 보강 교사를 그 시간에 수업 중인 사람으로 보고,
 * 같은 사람에게 두 번 겹쳐 부탁하는 안을 내지 않는다.
 */
export function applyAll(base: TimetableInput, entries: AppliedEntry[]): TimetableInput {
  let cur = base;
  for (const e of entries) {
    if (e.cover) {
      const { slot, klass, absent, teacher } = e.cover;
      cur = {
        ...cur,
        assignments: cur.assignments.map((a) =>
          a.slot === slot && a.klass === klass && a.teacher === absent
            ? { ...a, teacher }
            : a,
        ),
      };
      continue;
    }
    cur = applyChanges(cur, e.changes);
  }
  return cur;
}

/** 교사별 근무 불가 슬롯 저장, 불러오기. */
export function loadUnavail(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(UNAVAIL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number[]>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveUnavail(u: Record<string, number[]>): void {
  try {
    localStorage.setItem(UNAVAIL_KEY, JSON.stringify(u));
  } catch {
    /* 무시 */
  }
}

export function loadNeisKey(): string {
  try {
    return localStorage.getItem(NEIS_KEY_STORE) ?? '';
  } catch {
    return '';
  }
}

export function saveNeisKey(key: string): void {
  try {
    if (key) localStorage.setItem(NEIS_KEY_STORE, key);
    else localStorage.removeItem(NEIS_KEY_STORE);
  } catch {
    /* 무시 */
  }
}

/**
 * 지금 다루는 주의 월요일을 찾는다.
 * 주말에 열면 다음 주를 본다. 토요일 오후에 여는 사람은 다음 주 결강을 준비하는 것이다.
 */
export function weekMondayOf(today = new Date()): Date {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const wd = d.getDay(); // 일 0, 월 1
  if (wd === 0) d.setDate(d.getDate() + 1);
  else if (wd === 6) d.setDate(d.getDate() + 2);
  else d.setDate(d.getDate() - (wd - 1));
  return d;
}

/**
 * 학급 이름에서 학년을 뽑는다.
 *
 * 나이스에서 오면 "1-1" 꼴이지만 학교가 내보낸 파일은 제각각이다.
 * "1학년 1반", "1-01", "3학년11반" 이 다 나온다. 맨 앞 숫자를 학년으로 본다.
 * 못 읽으면 null 이다. 짐작해서 엉뚱한 학년에 휴업일을 거는 것보다 안 거는 편이 낫다.
 */
export function gradeOf(klass: string): number | null {
  const m = /\d+/.exec(klass);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : null;
}

/**
 * 사람이 친 이름을 다듬는다.
 *
 * "김영희", "김영희 ", "김 영희" 가 각각 다른 교사로 잡히면 시간표가 조각난다.
 * 앞뒤 공백을 떼고 가운데 공백을 하나로 줄인다. 이름 안의 띄어쓰기는 없앤다.
 * 한글 이름에서 "김 영희"와 "김영희"는 같은 사람이다.
 */
export function normalizeName(raw: string): string {
  const t = raw.trim().replace(/\s+/g, ' ');
  // 한글로만 이루어진 이름이면 띄어쓰기를 없앤다. 영문 이름은 띄어쓰기가 뜻을 가지므로 둔다.
  return /^[가-힣\s]+$/.test(t) ? t.replace(/\s/g, '') : t;
}

const ymd = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/**
 * 학사일정을 지금 다루는 주의 요일 단위로 바꾼다.
 *
 * 시간표는 한 주가 되풀이되는 표인데 학사일정은 날짜로 온다.
 * 그래서 이번 주에 걸리는 것만 골라 요일로 옮긴다.
 *
 * 쉬는 날로 보는 것은 휴업일과 공휴일뿐이다. 학년 행사는 수업을 하는 날이 대부분이라
 * 여기서 막으면 멀쩡한 교체안까지 사라진다. 행사는 화면에 알리기만 한다.
 */
export function buildClosures(
  events: NeisEvent[],
  klasses: string[],
  monday: Date = weekMondayOf(),
  days = 5,
): DayClosure[] {
  const dateOfDay = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = new Date(monday);
    d.setDate(d.getDate() + i);
    dateOfDay.set(ymd(d), i);
  }
  const found = new Map<number, { reason: string; grades: Set<number> | null }>();
  for (const e of events) {
    if (!e.isHoliday) continue;
    const day = dateOfDay.get(e.date);
    if (day === undefined) continue;
    // 학년별 표시가 전부 켜져 있거나 전부 꺼져 있으면 학교 전체로 본다.
    const on = e.grades.filter(Boolean).length;
    const partial = on > 0 && on < e.grades.length;
    const prev = found.get(day);
    const grades = partial ? new Set(e.grades.flatMap((v, i) => (v ? [i + 1] : []))) : null;
    if (!prev) found.set(day, { reason: e.name || e.kind, grades });
    else if (prev.grades !== null && grades === null) found.set(day, { reason: e.name || e.kind, grades: null });
  }
  const out: DayClosure[] = [];
  for (const [day, { reason, grades }] of found) {
    if (grades === null) out.push({ day, reason });
    else {
      const hit = klasses.filter((k) => {
        const g = gradeOf(k);
        return g !== null && grades.has(g);
      });
      if (hit.length > 0) out.push({ day, reason, klasses: hit });
    }
  }
  return out.sort((a, b) => a.day - b.day);
}

/**
 * 반영 장부에서 교사별 협조 횟수를 센다. 결강 당사자는 빼고,
 * 자리를 내어 준 상대 교사만 센다. 추천 점수의 부담 균형 감점에 쓴다.
 */
export function deriveBurden(entries: AppliedEntry[]): Record<string, number> {
  const burden: Record<string, number> = {};
  for (const e of entries) {
    if (e.cover) {
      // 보강은 한 시간을 그냥 더 맡는 일이라 교체보다 무거운 부탁이다. 두 번으로 센다.
      burden[e.cover.teacher] = (burden[e.cover.teacher] ?? 0) + 2;
      continue;
    }
    const absent = e.changes[0]?.from.teacher;
    const seen = new Set<string>();
    for (const c of e.changes) {
      const t = c.from.teacher;
      if (t === absent || seen.has(t)) continue;
      seen.add(t);
      burden[t] = (burden[t] ?? 0) + 1;
    }
  }
  return burden;
}

/** 교무실 단체 대화방에 붙일 변경 공지 문구를 만든다. */
export function buildNotice(
  schoolName: string,
  entries: AppliedEntry[],
  cfg: ScheduleConfig,
): string {
  const d = new Date();
  const lines: string[] = [`[수업 변경 안내] ${schoolName} | ${d.getMonth() + 1}월 ${d.getDate()}일`];
  entries.forEach((e, i) => {
    lines.push(`${i + 1}. ${e.title}`);
    for (const c of e.changes) {
      lines.push(
        `   ${c.from.klass} ${c.from.subject}(${c.from.teacher}): ${slotName(c.from.slot, cfg)}에서 ${slotName(c.toSlot, cfg)}로`,
      );
    }
  });
  lines.push('위와 같이 변경되었으니 수업 전 확인 바랍니다.');
  return lines.join('\n');
}

/**
 * 나이스에 입력할 변경 목록을 만든다.
 * 일과 담당이 나이스 기초시간표에 손으로 옮겨 적는 자리라 한 줄에 하나씩 또박또박 적는다.
 */
export function buildNeisList(
  schoolName: string,
  entries: AppliedEntry[],
  cfg: ScheduleConfig,
): string {
  const d = new Date();
  const lines = [
    `나이스 입력용 수업 변경 목록`,
    `${schoolName} | 작성 ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    '',
    '순번\t학급\t과목\t교사\t변경 전\t변경 후',
  ];
  let n = 0;
  for (const e of entries) {
    if (e.cover) {
      n += 1;
      lines.push(
        [
          n,
          e.cover.klass,
          e.cover.subject,
          `${e.cover.absent} → ${e.cover.teacher}`,
          slotName(e.cover.slot, cfg),
          '보강(교사 변경)',
        ].join('\t'),
      );
      continue;
    }
    for (const c of e.changes) {
      n += 1;
      lines.push(
        [
          n,
          c.from.klass,
          c.from.subject,
          c.from.teacher,
          slotName(c.from.slot, cfg),
          slotName(c.toSlot, cfg),
        ].join('\t'),
      );
    }
  }
  return lines.join('\n');
}

/** 샘플 학교 표식. 파일 없이 바로 체험할 때 쓴다. */
export const SYNTH_MARK = 'pumasi:sample:v1';

export type SourceKind = '샘플' | '나이스' | '파일';

/** 받아 둔 학사일정과 그 기간. 저장 파일에도 남겨 새로고침해도 살아남는다. */
export interface Calendar {
  /** "20260713" */
  from: string;
  to: string;
  events: NeisEvent[];
}

export interface Loaded {
  schoolName: string;
  input: TimetableInput;
  source: SourceKind;
  /**
   * 학사일정. 휴업일을 탐색에서 빼는 데 쓴다.
   * neis 안에 두지 않고 따로 두는 이유는 저장 파일에서 되살려야 하기 때문이다.
   */
  calendar?: Calendar;
  /** 한 이름이 같은 교시에 다른 과목을 맡은 자리. 대개 동명이인이다 */
  conflicts?: TeacherConflict[];
  /** 나이스에서 불러온 경우의 부가 정보 */
  neis?: {
    school: NeisSchool;
    report: NeisReport;
    events: NeisEvent[];
  };
}

/**
 * 우리 저장 형식. 다른 도구에 매이지 않도록 필요한 것만 담는다.
 *
 * 판 2에서 학사일정을 넣었다. 넣기 전에는 새로고침 한 번에 휴업일이 사라져
 * 쉬는 날로 옮기라는 추천이 조용히 되살아났다. 판 1 파일도 그대로 열린다.
 */
export interface PumasiFile {
  format: 'pumasi.timetable';
  version: 1 | 2;
  school: string;
  config: ScheduleConfig;
  lessons: Array<{ teacher: string; klass: string; subject: string; slot: number; group?: string }>;
  calendar?: Calendar;
}

export function toFile(loaded: Loaded): string {
  const doc: PumasiFile = {
    format: 'pumasi.timetable',
    version: 2,
    school: loaded.schoolName,
    config: loaded.input.config,
    lessons: loaded.input.assignments.map((a) => ({
      teacher: a.teacher,
      klass: a.klass,
      subject: a.subject,
      slot: a.slot,
      ...(a.group ? { group: a.group } : {}),
    })),
    ...(loaded.calendar ? { calendar: loaded.calendar } : {}),
  };
  return JSON.stringify(doc, null, 1);
}

export function fromFile(raw: string): Loaded {
  let doc: PumasiFile;
  try {
    doc = JSON.parse(raw) as PumasiFile;
  } catch {
    throw new Error('파일이 깨졌거나 시간표 파일이 아닙니다. 저장한 파일을 그대로 열어 주십시오.');
  }
  if (!doc || doc.format !== 'pumasi.timetable' || !Array.isArray(doc.lessons)) {
    throw new Error(`${BRAND}에서 저장한 파일이 아닙니다. 저장한 파일을 그대로 열어 주십시오.`);
  }
  const cfg = doc.config;
  if (
    !cfg ||
    !Number.isInteger(cfg.days) ||
    !Number.isInteger(cfg.periods) ||
    cfg.days < 1 ||
    cfg.periods < 1 ||
    !Array.isArray(cfg.dayNames) ||
    cfg.dayNames.length < cfg.days
  ) {
    throw new Error('파일의 시간표 틀이 올바르지 않습니다. 다시 내보내 주십시오.');
  }
  // 칸 밖으로 나간 수업이 있으면 격자를 그릴 때 조용히 사라진다. 여기서 막는다.
  const size = cfg.days * cfg.periods;
  const bad = doc.lessons.filter(
    (l) =>
      !l ||
      typeof l.teacher !== 'string' ||
      typeof l.klass !== 'string' ||
      typeof l.subject !== 'string' ||
      !Number.isInteger(l.slot) ||
      l.slot < 0 ||
      l.slot >= size,
  );
  if (bad.length > 0) {
    throw new Error(
      `수업 ${bad.length}개가 시간표 칸을 벗어났거나 항목이 비어 있습니다. 파일을 다시 내보내 주십시오.`,
    );
  }
  return {
    schoolName: doc.school || '이름 없는 학교',
    source: '파일',
    input: {
      config: cfg,
      // 파일마다 이름 표기가 흔들린다. 여기서 한 번 다듬어야 같은 사람이 한 사람으로 잡힌다.
      assignments: doc.lessons.map((l) => ({ ...l, teacher: normalizeName(l.teacher) })),
    },
    ...(doc.calendar ? { calendar: doc.calendar } : {}),
  };
}

/**
 * 받아 둔 학사일정이 지금 다루는 주를 덮는지 본다.
 *
 * 나이스에서 5주치를 받아 두는데, 몇 주 뒤에 다시 열면 그 기간이 이번 주를 지나쳐 있다.
 * 그러면 휴업일이 없어서 안 걸리는 것인지 자료가 낡아서 안 걸리는 것인지 구분이 안 된다.
 * 화면에서 다시 불러오라고 말해 주려고 이 판정을 둔다.
 */
export function calendarCoversThisWeek(cal: Calendar | undefined, monday = weekMondayOf()): boolean {
  if (!cal) return false;
  const friday = new Date(monday);
  friday.setDate(friday.getDate() + 4);
  return cal.from <= ymd(monday) && ymd(friday) <= cal.to;
}

export function sampleSchool(): Loaded {
  return {
    schoolName: `${BRAND} 예시 학교`,
    source: '샘플',
    input: genSchool({ classes: 12, seed: 42 }),
  };
}

/** `${klass}|${subject}` 를 교사 이름으로 옮기는 표 */
export type TeacherMap = Record<string, string>;

export const mapKey = (klass: string, subject: string): string => `${klass}|${subject}`;

/**
 * 나이스 응답과 교사 표를 합쳐 작업할 시간표를 만든다.
 * 개방 자료에는 교사가 없으므로 표가 비면 수업도 비고, 채운 만큼만 탐색에 쓴다.
 */
export function buildFromNeis(
  school: NeisSchool,
  rows: NeisRow[],
  events: NeisEvent[],
  map: TeacherMap,
  range?: { from: string; to: string },
): Loaded {
  const report = fromNeis(rows);
  const { conflicts, ...input } = neisToTimetable(
    report,
    (klass, subject) => map[mapKey(klass, subject)],
  );
  return {
    schoolName: school.name,
    source: '나이스',
    input,
    ...(conflicts.length > 0 ? { conflicts } : {}),
    ...(range ? { calendar: { from: range.from, to: range.to, events } } : {}),
    neis: { school, report, events },
  };
}

/**
 * 같은 학년에서 같은 과목인데 아직 안 채운 자리.
 *
 * 한 학교의 (학급, 과목) 짝은 수백 개다. 손으로 다 채우게 두면 아무도 끝까지 못 간다.
 * 그런데 실제로는 한 교사가 같은 학년 여러 반의 같은 과목을 맡는 경우가 대부분이다.
 * 한 곳을 채우면 나머지를 한 번에 채울 수 있게 한다.
 */
export function sameGradeSubject(
  pairs: Array<{ klass: string; subject: string }>,
  map: TeacherMap,
  klass: string,
  subject: string,
): Array<{ klass: string; subject: string }> {
  const g = gradeOf(klass);
  if (g === null) return [];
  return pairs.filter(
    (p) =>
      p.subject === subject &&
      p.klass !== klass &&
      gradeOf(p.klass) === g &&
      !map[mapKey(p.klass, p.subject)],
  );
}

/** 교사 표에서 아직 안 채운 (학급, 과목) 목록을 뽑는다. */
export function missingTeachers(report: NeisReport, map: TeacherMap): Array<[string, string]> {
  const pairs = new Set<string>();
  for (const [key, subject] of report.base) {
    const klass = key.split('|')[0];
    if (klass) pairs.add(mapKey(klass, subject));
  }
  return [...pairs]
    .filter((k) => !map[k])
    .map((k) => k.split('|') as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0], 'ko', { numeric: true }) || a[1].localeCompare(b[1], 'ko'));
}

/**
 * 시간표를 이 브라우저에 둔다. 성공 여부를 돌려준다.
 *
 * 조용히 삼키면 안 되는 실패다. 화면은 "이 기기에 저장합니다"라고 말하는데
 * 실제로는 저장되지 않았다면, 선생님은 새로고침 한 번에 오늘 작업을 통째로 잃는다.
 * 그 사실을 그때 알게 하지 않고 미리 알린다.
 */
/**
 * 손으로 지정한 수업 없는 요일.
 *
 * 나이스 학사일정에 안 잡히는 날이 있다. 정기고사 기간, 학교 행사, 갑자기 정해진 재량휴업이다.
 * 도구가 알 길이 없으므로 선생님이 눌러 알려 주신다. 학사일정에서 온 것과 함께 걸린다.
 */
export function loadOffDays(): number[] {
  try {
    const raw = localStorage.getItem(OFFDAY_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
  } catch {
    return [];
  }
}

export function saveOffDays(days: number[]): void {
  try {
    localStorage.setItem(OFFDAY_KEY, JSON.stringify(days));
  } catch {
    /* 저장 못 해도 이 화면에서는 그대로 쓴다 */
  }
}

export function saveRaw(raw: string): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, raw);
    return true;
  } catch {
    return false;
  }
}

export function loadRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearRaw(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(TEACHER_KEY);
    localStorage.removeItem(CHANGES_KEY);
    localStorage.removeItem(UNAVAIL_KEY);
  } catch {
    /* 무시 */
  }
}

/* 과목 이름이 hue 를 정한다. 채도와 명도는 테마 토큰이 정한다. */
const HUES = [152, 200, 222, 250, 280, 310, 335, 15, 35, 60, 95, 175];

export function subjectHue(subject: string): number {
  let h = 0;
  for (let i = 0; i < subject.length; i++) h = (h * 31 + subject.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length] ?? 152;
}

/** 보강을 부탁드리는 문구. 교체가 없을 때 쓴다. */
export function buildCoverPhrase(
  teacher: string,
  slot: number,
  klass: string,
  subject: string,
  cfg: ScheduleConfig,
  name: (s: number, c: ScheduleConfig) => string,
): string {
  return [
    `${teacher} 선생님, 안녕하십니까.`,
    `${name(slot, cfg)} ${klass} ${subject} 수업에 부득이한 사정이 생겼습니다.`,
    `자리를 맞바꿀 수업을 찾지 못해 보강을 여쭙습니다.`,
    `선생님께서는 그 시간에 수업이 없으신 것으로 확인하였습니다.`,
    `가능하시면 제가 보강 계획을 올리겠습니다. 감사합니다.`,
  ].join('\n');
}

/** 상대 교사에게 보낼 합쇼체 요청 문구를 만든다. */
export function buildPhrase(
  cand: Candidate,
  cfg: ScheduleConfig,
  name: (s: number, c: ScheduleConfig) => string,
): string {
  const mine = cand.changes[0];
  if (!mine) return '';
  const from = name(mine.from.slot, cfg);
  if (cand.type === 'swap2') {
    const theirs = cand.changes[1];
    if (!theirs) return '';
    const to = name(theirs.from.slot, cfg);
    return [
      `${theirs.from.teacher} 선생님, 안녕하십니까.`,
      `${from} ${mine.from.klass} ${mine.from.subject} 수업에 부득이한 사정이 생겨 연락드립니다.`,
      `선생님의 ${to} ${theirs.from.klass} ${theirs.from.subject} 수업과 맞바꿔 주실 수 있으신지 여쭙습니다.`,
      `가능하시면 제가 시간 변경원을 올리겠습니다. 감사합니다.`,
    ].join('\n');
  }
  if (cand.type === 'cycle3') {
    const names = cand.changes
      .map((c) => `${c.from.teacher} 선생님`)
      .slice(1)
      .join(', ');
    const lines = cand.changes
      .map((c) => `${name(c.from.slot, cfg)} ${c.from.subject}(${c.from.teacher}) → ${name(c.toSlot, cfg)}`)
      .join('\n');
    return [
      `${names}, 안녕하십니까.`,
      `${from} ${mine.from.klass} 수업에 부득이한 사정이 생겨, 세 수업을 한 자리씩 옮기는 방안을 여쭙습니다.`,
      lines,
      `동의해 주시면 제가 시간 변경원을 올리겠습니다. 감사합니다.`,
    ].join('\n');
  }
  const to = name(mine.toSlot, cfg);
  return [
    `일과 담당 선생님, 안녕하십니까.`,
    `${from} ${mine.from.klass} ${mine.from.subject} 수업에 부득이한 사정이 생겨,`,
    `해당 수업을 ${to}(${mine.from.klass}의 빈 교시)로 옮기고자 합니다.`,
    `학급 하루 수업에 중간 빈틈은 생기지 않습니다. 검토 부탁드립니다. 감사합니다.`,
  ].join('\n');
}
