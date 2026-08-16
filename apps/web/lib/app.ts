import {
  applyChanges,
  fromNeis,
  genSchool,
  neisToTimetable,
  slotName,
  type Candidate,
  type Change,
  type NeisReport,
  type NeisRow,
  type ScheduleConfig,
  type TimetableInput,
} from '@timeswap/engine';
import type { NeisEvent, NeisSchool } from './neis';

export const STORAGE_KEY = 'timeswap:v0:data';
export const TEACHER_KEY = 'timeswap:v0:teacher';
export const CHANGES_KEY = 'timeswap:v0:changes';
export const UNAVAIL_KEY = 'timeswap:v0:unavail';
export const THEME_KEY = 'timeswap:v0:theme';
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
export interface AppliedEntry {
  id: number;
  type: Candidate['type'];
  title: string;
  changes: Change[];
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

export function saveEntries(entries: AppliedEntry[]): void {
  try {
    localStorage.setItem(CHANGES_KEY, JSON.stringify(entries));
  } catch {
    /* 무시 */
  }
}

/** 원본 시간표에 장부의 변경을 순서대로 적용한 현재 시간표를 만든다. */
export function applyAll(base: TimetableInput, entries: AppliedEntry[]): TimetableInput {
  let cur = base;
  for (const e of entries) cur = applyChanges(cur, e.changes);
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
 * 반영 장부에서 교사별 품앗이 횟수를 센다. 결강 당사자는 빼고,
 * 자리를 내어 준 상대 교사만 센다. 추천 점수의 부담 균형 감점에 쓴다.
 */
export function deriveBurden(entries: AppliedEntry[]): Record<string, number> {
  const burden: Record<string, number> = {};
  for (const e of entries) {
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
  lines.push('위와 같이 시간표가 바뀌었습니다. 수업 전에 확인해 주시기 바랍니다.');
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

export interface Loaded {
  schoolName: string;
  input: TimetableInput;
  source: SourceKind;
  /** 나이스에서 불러온 경우의 부가 정보 */
  neis?: {
    school: NeisSchool;
    report: NeisReport;
    events: NeisEvent[];
  };
}

/** 우리 저장 형식. 다른 도구에 매이지 않도록 필요한 것만 담는다. */
export interface PumasiFile {
  format: 'pumasi.timetable';
  version: 1;
  school: string;
  config: ScheduleConfig;
  lessons: Array<{ teacher: string; klass: string; subject: string; slot: number; group?: string }>;
}

export function toFile(loaded: Loaded): string {
  const doc: PumasiFile = {
    format: 'pumasi.timetable',
    version: 1,
    school: loaded.schoolName,
    config: loaded.input.config,
    lessons: loaded.input.assignments.map((a) => ({
      teacher: a.teacher,
      klass: a.klass,
      subject: a.subject,
      slot: a.slot,
      ...(a.group ? { group: a.group } : {}),
    })),
  };
  return JSON.stringify(doc, null, 1);
}

export function fromFile(raw: string): Loaded {
  const doc = JSON.parse(raw) as PumasiFile;
  if (!doc || doc.format !== 'pumasi.timetable' || !Array.isArray(doc.lessons)) {
    throw new Error('수업품앗이 시간표 파일이 아닙니다. 내려받은 파일을 그대로 올려 주십시오.');
  }
  return {
    schoolName: doc.school || '이름 없는 학교',
    source: '파일',
    input: { config: doc.config, assignments: doc.lessons },
  };
}

export function sampleSchool(): Loaded {
  return {
    schoolName: '수업품앗이 시범 학교',
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
): Loaded {
  const report = fromNeis(rows);
  const input = neisToTimetable(report, (klass, subject) => map[mapKey(klass, subject)]);
  return {
    schoolName: school.name,
    source: '나이스',
    input,
    neis: { school, report, events },
  };
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

export function saveRaw(raw: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    // 저장 실패(용량 초과 등)는 치명적이지 않다. 세션 안에서는 계속 쓸 수 있다.
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
