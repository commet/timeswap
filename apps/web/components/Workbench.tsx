'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  coverCandidates,
  dayOf,
  recommend,
  gradeShapes,
  groupCandidate,
  slotName,
  validate,
  type Candidate,
  type CoverCandidate,
  type NeisRow,
  type RecommendResult,
  type TimetableInput,
} from '@timeswap/engine';
import { Landing } from './Landing';
import { Grid } from './Grid';
import { Panel } from './Panel';
import { Changes } from './Changes';
import { Sheet } from './Sheet';
import { TeacherPick } from './TeacherPick';
import { NeisLoader } from './NeisLoader';
import { TeacherHome, type ScheduleFocus } from './TeacherHome';
import { RequestStatusList } from './RequestStatusList';
import { OpsInbox } from './OpsInbox';
import type { NeisEvent, NeisSchool } from '../lib/neis';
import { BRAND } from '../lib/brand';
import {
  createRequest,
  createCoverRequest,
  loadRequests,
  saveRequests,
  selectCandidate,
  setChecklist,
  transitionRequest,
  type ChangeRequest,
  type ChecklistKey,
  type RequestReason,
} from '../lib/requests';
import {
  applyAll,
  applyTheme,
  blankDaysOf,
  buildClosures,
  buildCoverPhrase,
  calendarCoversThisWeek,
  buildFromNeis,
  buildNeisList,
  buildNotice,
  buildPhrase,
  clearRaw,
  deriveBurden,
  fromFile,
  loadEntries,
  loadNeisKey,
  loadOffDays,
  loadRaw,
  loadTheme,
  loadUnavail,
  sampleSchool,
  saveEntries,
  saveNeisKey,
  saveOffDays,
  saveRaw,
  saveUnavail,
  weekMondayOf,
  REASON_KEY,
  TEACHER_KEY,
  THEME_LABEL,
  THEME_ORDER,
  toFile,
  type AppliedEntry,
  type Loaded,
  type TeacherMap,
  type ThemeMode,
} from '../lib/app';

function localYmd(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return [year, month, day].join('-');
}

function requestEntry(request: ChangeRequest, id: number, cfg: TimetableInput['config']): AppliedEntry {
  if (request.kind === 'cover' && request.cover) {
    return {
      id,
      type: '보강',
      title: request.cover.teacher + ' 선생님 보강 (' + slotName(request.target.slot, cfg) + ' ' + request.target.klass + ' ' + request.target.subject + ')',
      changes: [],
      cover: {
        teacher: request.cover.teacher,
        slot: request.target.slot,
        klass: request.target.klass,
        subject: request.target.subject,
        absent: request.teacher,
      },
    };
  }
  return {
    id,
    type: request.candidate.type,
    title: request.candidate.title,
    changes: request.candidate.changes,
  };
}

function defaultTeacher(input: TimetableInput): string | null {
  const count = new Map<string, number>();
  for (const a of input.assignments) {
    if (a.group) continue;
    count.set(a.teacher, (count.get(a.teacher) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [t, n] of count) {
    if (n > bestN) {
      best = t;
      bestN = n;
    }
  }
  return best;
}

export function Workbench() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [showNeis, setShowNeis] = useState(false);
  /** 로고를 누르면 시작 화면으로 돌아온다. 불러온 시간표는 지우지 않는다. */
  const [atHome, setAtHome] = useState(false);
  const [neisKey, setNeisKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [teacher, setTeacher] = useState<string | null>(null);
  const [teacherInput, setTeacherInput] = useState('');
  /** 아직 본인 성함을 고르지 않았다. 처음 불러온 직후에만 참이다. */
  const [needsPick, setNeedsPick] = useState(false);
  /** 결재 문서에 들어갈 결강 사유 */
  const [reason, setReason] = useState('출장');
  const [entries, setEntries] = useState<AppliedEntry[]>([]);
  const [view, setView] = useState<'teacher' | 'klass'>('teacher');
  const [klass, setKlass] = useState<string | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [unavail, setUnavail] = useState<Record<string, number[]>>({});
  /** 손으로 지정한 수업 없는 요일. 학사일정에 안 잡히는 정기고사와 학교 행사를 위한 것이다 */
  const [offDays, setOffDays] = useState<number[]>([]);
  const [hovered, setHovered] = useState<Candidate | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  /**
   * 이 브라우저에 저장하지 못한 상태.
   * 사생활 보호 모드나 저장 공간 부족에서 생긴다. 새로고침 한 번에 오늘 작업이
   * 통째로 사라지는 상황이라 조용히 넘길 수 없다.
   */
  const [noSave, setNoSave] = useState(false);
  const [todayIdx, setTodayIdx] = useState<number | null>(null);
  const [theme, setTheme] = useState<ThemeMode>('auto');
  const [workspaceMode, setWorkspaceMode] = useState<'teacher' | 'ops'>('teacher');
  const [scheduleFocus, setScheduleFocus] = useState<ScheduleFocus>('week');
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [printRequest, setPrintRequest] = useState<ChangeRequest | null>(null);
  const sideRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const raw = loadRaw();
    if (raw) {
      try {
        const l = fromFile(raw);
        setLoaded(l);
        setEntries(loadEntries());
        setUnavail(loadUnavail());
        const saved = localStorage.getItem(TEACHER_KEY);
        setTeacher(saved ?? defaultTeacher(l.input));
        if (saved === null) setNeedsPick(true);
        setReason(localStorage.getItem(REASON_KEY) ?? '출장');
      } catch {
        clearRaw();
      }
    }
    setNeisKey(loadNeisKey());
    setOffDays(loadOffDays());
    setTheme(loadTheme());
    setRequests(loadRequests());
    const wd = new Date().getDay(); // 일 0, 월 1
    setTodayIdx(wd >= 1 && wd <= 5 ? wd - 1 : null);
    if (window.innerWidth < 700) setScheduleFocus('today');
  }, []);

  const base = loaded?.input ?? null;

  /** 받은 자료에 수업이 하나도 없는 요일. 그 요일로는 옮기지 않는다 */
  const blankDays = useMemo(() => (base ? blankDaysOf(base) : []), [base]);

  /**
   * 이번 주 휴업일. 나이스 학사일정에서 온다.
   * 시간표는 되풀이되는 한 주지만 학사일정은 날짜라 이번 주에 걸리는 것만 요일로 옮긴다.
   */
  const closures = useMemo(() => {
    const own = offDays.map((day) => ({ day, reason: '수업 없는 날로 지정됨' }));
    // 자료가 없는 요일이 가장 앞에 온다. 사유가 가려지면 왜 빠졌는지 알 수 없다.
    const blank = blankDays.map((day) => ({ day, reason: '자료를 받지 못한 요일' }));
    const cal = loaded?.calendar;
    if (!cal || cal.events.length === 0 || !base || !calendarCoversThisWeek(cal)) {
      return [...blank, ...own];
    }
    const ks = [...new Set(base.assignments.map((a) => a.klass))];
    // 손으로 지정한 것이 학사일정보다 뒤에 온다. 앞의 것이 이기므로 학사일정 사유가 남는다.
    return [...blank, ...buildClosures(cal.events, ks), ...own];
  }, [loaded, base, offDays, blankDays]);

  /** 학사일정을 받아 두긴 했는데 그 기간이 이번 주를 지나쳤다. 다시 받아야 한다. */
  const staleCalendar =
    loaded?.calendar !== undefined && !calendarCoversThisWeek(loaded.calendar);

  const input = useMemo(() => {
    if (!base) return null;
    const applied = applyAll(base, entries);
    // 근무 불가와 협조 부담은 저장된 상태에서 매번 다시 만든다.
    return {
      ...applied,
      unavailable: unavail,
      recentBurden: deriveBurden(entries),
      ...(closures.length > 0 ? { closures } : {}),
    };
  }, [base, entries, unavail, closures]);

  const teachers = useMemo(() => {
    if (!input) return [] as Array<{ name: string; n: number }>;
    const count = new Map<string, number>();
    for (const a of input.assignments) count.set(a.teacher, (count.get(a.teacher) ?? 0) + 1);
    return [...count.entries()]
      .sort((x, y) => x[0].localeCompare(y[0], 'ko'))
      .map(([name, n]) => ({ name, n }));
  }, [input]);

  const klasses = useMemo(() => {
    if (!input) return [] as string[];
    return [...new Set(input.assignments.map((a) => a.klass))].sort((x, y) =>
      x.localeCompare(y, 'ko', { numeric: true }),
    );
  }, [input]);

  const currentTeacher =
    teacher !== null && teachers.some((t) => t.name === teacher)
      ? teacher
      : (teachers[0]?.name ?? null);
  const currentKlass = klass !== null && klasses.includes(klass) ? klass : (klasses[0] ?? null);

  useEffect(() => {
    setTeacherInput(currentTeacher ?? '');
  }, [currentTeacher]);

  const helpers = useMemo(() => {
    const burden = deriveBurden(entries);
    return Object.entries(burden)
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0], 'ko'))
      .slice(0, 4)
      .map(([name, n]) => ({ name, n }));
  }, [entries]);

  const lessons = useMemo(() => {
    if (!input) return [];
    if (view === 'teacher') {
      return currentTeacher !== null
        ? input.assignments.filter((a) => a.teacher === currentTeacher)
        : [];
    }
    return currentKlass !== null ? input.assignments.filter((a) => a.klass === currentKlass) : [];
  }, [input, view, currentTeacher, currentKlass]);

  const activeSlot = queue[0] ?? null;

  const result: RecommendResult | null = useMemo(() => {
    if (!input || view !== 'teacher' || currentTeacher === null || activeSlot === null) return null;
    try {
      return recommend(input, { teacher: currentTeacher, slot: activeSlot }, { max: 12 });
    } catch {
      return null;
    }
  }, [input, view, currentTeacher, activeSlot]);

  const requestDate = useMemo(() => {
    if (!result || !input) return localYmd(weekMondayOf());
    const date = weekMondayOf();
    date.setDate(date.getDate() + dayOf(result.target.slot, input.config));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) date.setDate(date.getDate() + 7);
    return localYmd(date);
  }, [result, input]);

  /**
   * 보강 후보를 언제 함께 보여 줄지.
   *
   * 이동수업은 학급 전원과 교사 전원이 같은 시간에 비어야 옮길 수 있어 교체가
   * 거의 성립하지 않는다. 합성 학교로 재어 보니 묶음 수업은 열에 여덟이 교체안 0이고,
   * 학년 전체가 걸리는 큰 묶음은 사실상 0% 였다.
   * 그런 자리에서 안 하나를 겨우 내밀고 끝내면 선생님은 막다른 길에 선다.
   * 그래서 묶음이면 교체안이 적을 때도 보강 후보를 함께 놓는다.
   */
  const cover: CoverCandidate[] | null = useMemo(() => {
    if (!input || !result) return null;
    const target = input.assignments.find(
      (a) => a.slot === result.target.slot && a.klass === result.target.klass,
    );
    const scarce = target?.group ? result.candidates.length < 3 : result.candidates.length === 0;
    if (!scarce) return null;
    return coverCandidates(
      input,
      result.target.slot,
      result.target.subject,
      8,
      currentTeacher ?? undefined,
    );
  }, [input, result, currentTeacher]);

  const show = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const copy = useCallback(
    async (text: string, done: string) => {
      try {
        await navigator.clipboard.writeText(text);
        show(done);
      } catch {
        show('복사하지 못했습니다. 브라우저의 클립보드 권한을 확인하십시오');
      }
    },
    [show],
  );

  /**
   * 같은 교시에 같은 과목을 듣는 다른 학급.
   * 나이스 자료에는 이동수업 표시가 없어 도구가 가릴 수 없다. 알리고 선생님이 정하신다.
   */
  /**
   * 담당 교사를 아직 안 채운 자리 수.
   *
   * 이 값이 0 이 아니면 찾을 수 있는 교체가 그만큼 줄어든다. 다만 틀린 안이 나오지는 않는다.
   * 그 자리는 수업이 있는 것으로 보고 비켜 가기 때문이다. 그 사실을 알려 드려야
   * 왜 안이 적게 나오는지 납득하고 더 채울지 정하실 수 있다.
   */
  const unfilled = useMemo(
    () => Object.values(input?.klassBusy ?? {}).reduce((n, s) => n + s.length, 0),
    [input],
  );

  /**
   * 과목이 유난히 많아 교체 상대를 찾기 어려운 학년인지. 실제 학교 24곳을 재어 만든 기준이다.
   * 공통과목만 도는 1학년은 학급 수 대비 과목 종수의 중앙값이 1.5, 3학년은 2.7이다.
   *
   * 까닭까지 함께 받는다. 같은 비율이라도 일반고에서는 선택과목이고
   * 특성화고에서는 학과별 전공 편성이다. 문장이 갈려야 맞는 말이 된다.
   */
  const electiveGrade = useMemo(() => {
    if (!input || !result) return null;
    const m = /\d+/.exec(result.target.klass);
    if (!m) return null;
    const g = Number(m[0]);
    return gradeShapes(input).find((x) => x.grade === g && x.elective) ?? null;
  }, [input, result]);

  const peers = useMemo(() => {
    if (!input || !result) return [];
    const target = input.assignments.find(
      (a) => a.slot === result.target.slot && a.klass === result.target.klass,
    );
    if (!target || target.group) return [];
    return groupCandidate(
      input,
      result.target.slot,
      result.target.subject,
      result.target.klass,
    );
  }, [input, result]);

  /**
   * 대상 수업과 같은 교시 같은 과목을 한 묶음으로 표시한다.
   * 표시는 저장 파일에도 남아 다음에 열 때까지 이어진다.
   */
  const onGroup = useCallback(() => {
    if (!loaded || !input || !result) return;
    const { slot, subject } = result.target;
    const id = `이동:${subject}:${slot}`;
    // 교시로 찾되 지금 화면(반영이 얹힌 시간표)에서 찾는다.
    // 저장하는 곳은 원본이고, 이미 반영한 변경 때문에 두 곳의 교시가 다를 수 있다.
    // 그래서 화면에서 고른 수업을 교사, 학급, 과목으로 원본에서 다시 찾는다.
    const picked = new Set(
      input.assignments
        .filter((a) => a.slot === slot && a.subject === subject && a.group === undefined)
        .map((a) => `${a.teacher}|${a.klass}|${a.subject}`),
    );
    if (picked.size === 0) return;
    const next: Loaded = {
      ...loaded,
      input: {
        ...loaded.input,
        assignments: loaded.input.assignments.map((a) =>
          picked.has(`${a.teacher}|${a.klass}|${a.subject}`) && a.group === undefined
            ? { ...a, group: id }
            : a,
        ),
      },
    };
    setLoaded(next);
    if (!saveRaw(toFile(next))) setNoSave(true);
    setHovered(null);
    const n = next.input.assignments.filter((a) => a.group === id).length;
    show(`${subject} 수업 ${n}개를 한 묶음으로 표시했습니다. 이제 함께 움직입니다`);
  }, [loaded, input, result, show]);

  /** 손으로 묶어 둔 자리인지. "동시:" 로 시작하는 자동 묶음은 물리적으로 필요해 풀 수 없다. */
  const grouped = useMemo(() => {
    if (!input || !result) return false;
    const target = input.assignments.find(
      (a) => a.slot === result.target.slot && a.klass === result.target.klass,
    );
    return target?.group?.startsWith('이동:') === true;
  }, [input, result]);

  const onUngroup = useCallback(() => {
    if (!loaded || !input || !result) return;
    // 묶음 이름은 화면에서 읽는다. 원본과 교시가 다를 수 있기 때문이다.
    const shown = input.assignments.find(
      (a) => a.slot === result.target.slot && a.klass === result.target.klass,
    );
    const id = shown?.group;
    if (id === undefined || !id.startsWith('이동:')) return;
    const next: Loaded = {
      ...loaded,
      input: {
        ...loaded.input,
        assignments: loaded.input.assignments.map((a) => {
          if (a.group !== id) return a;
          const { group, ...rest } = a;
          void group;
          return rest;
        }),
      },
    };
    setLoaded(next);
    if (!saveRaw(toFile(next))) setNoSave(true);
    setHovered(null);
    show('묶음을 해제했습니다. 이제 따로 움직입니다');
  }, [loaded, input, result, show]);

  const cycleTheme = useCallback(() => {
    setTheme((cur) => {
      const next = THEME_ORDER[(THEME_ORDER.indexOf(cur) + 1) % THEME_ORDER.length] ?? 'auto';
      applyTheme(next);
      return next;
    });
  }, []);

  const commitTeacher = useCallback((name: string) => {
    setTeacher(name);
    setNeedsPick(false);
    setQueue([]);
    setHovered(null);
    try {
      localStorage.setItem(TEACHER_KEY, name);
    } catch {
      /* 무시 */
    }
  }, []);

  /** 새 시간표를 받으면 화면과 저장소를 함께 초기화한다. */
  const install = useCallback(
    (l: Loaded) => {
      setLoaded(l);
      const stored = saveRaw(toFile(l));
      setNoSave(!stored);
      setEntries([]);
      saveEntries([]);
      setRequests([]);
      saveRequests([]);
      setQueue([]);
      setUnavail({});
      saveUnavail({});
      setHovered(null);
      setView('teacher');
      setWorkspaceMode('teacher');
      setAtHome(false);
      // 학교가 바뀌면 이전에 고른 성함은 뜻이 없다. 처음부터 다시 묻는다.
      setTeacher(defaultTeacher(l.input));
      setNeedsPick(true);
      try {
        localStorage.removeItem(TEACHER_KEY);
      } catch {
        /* 무시 */
      }
      show(`${l.schoolName} 시간표를 불러왔습니다`);
    },
    [show],
  );

  const onSample = useCallback(() => {
    setBusy(true);
    try {
      install(sampleSchool());
    } finally {
      setBusy(false);
    }
  }, [install]);

  const onFile = useCallback(
    (f: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          install(fromFile(String(reader.result)));
        } catch (e) {
          show(e instanceof Error ? e.message : '불러오기에 실패했습니다');
        }
      };
      reader.onerror = () => show('파일을 읽지 못했습니다');
      reader.readAsText(f);
    },
    [install, show],
  );

  const onNeisDone = useCallback(
    (
      school: NeisSchool,
      rows: NeisRow[],
      events: NeisEvent[],
      map: TeacherMap,
      range: { from: string; to: string },
    ) => {
      const l = buildFromNeis(school, rows, events, map, range);
      if (l.input.assignments.length === 0) {
        show('담당 교사를 한 명 이상 입력해야 시간표를 만들 수 있습니다');
        return;
      }
      setShowNeis(false);
      install(l);
    },
    [install, show],
  );

  const onSaveFile = useCallback(() => {
    if (!loaded) return;
    const blob = new Blob([toFile(loaded)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${loaded.schoolName} 시간표.json`;
    // 문서에 붙이지 않으면 일부 브라우저가 파일 이름을 버리고 download 로 저장한다.
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 내려받기가 시작되기 전에 주소를 거두면 이름을 잃는다. 한 박자 뒤에 거둔다.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    show('시간표 파일을 저장했습니다');
  }, [loaded, show]);

  const onToggleSlot = useCallback((s: number) => {
    setHovered(null);
    setQueue((q) => {
      const has = q.includes(s);
      if (!has && typeof window !== 'undefined' && window.innerWidth < 900) {
        // 좁은 화면에서는 추천 패널이 격자 아래에 있어 눈에 안 띈다. 골랐으면 데려간다.
        window.setTimeout(() => {
          sideRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          sideRef.current?.focus({ preventScroll: true });
        }, 80);
      }
      return has ? q.filter((x) => x !== s) : [...q, s];
    });
  }, []);

  const onToggleDay = useCallback(
    (d: number) => {
      if (!input || currentTeacher === null) return;
      setHovered(null);
      const daySlots = input.assignments
        .filter((a) => a.teacher === currentTeacher && dayOf(a.slot, input.config) === d)
        .map((a) => a.slot)
        .sort((x, y) => x - y);
      setQueue((q) => {
        const allIn = daySlots.every((s) => q.includes(s));
        if (allIn) return q.filter((s) => !daySlots.includes(s));
        const add = daySlots.filter((s) => !q.includes(s));
        return [...q, ...add];
      });
    },
    [input, currentTeacher],
  );

  const onToggleLock = useCallback(
    (s: number) => {
      if (currentTeacher === null) return;
      setHovered(null);
      setUnavail((u) => {
        const cur = new Set(u[currentTeacher] ?? []);
        if (cur.has(s)) cur.delete(s);
        else cur.add(s);
        const next: Record<string, number[]> = { ...u };
        if (cur.size === 0) delete next[currentTeacher];
        else next[currentTeacher] = [...cur].sort((x, y) => x - y);
        saveUnavail(next);
        return next;
      });
    },
    [currentTeacher],
  );

  const onToggleOffDay = useCallback((d: number) => {
    setHovered(null);
    setOffDays((cur) => {
      const next = cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b);
      saveOffDays(next);
      return next;
    });
  }, []);

  /**
   * 그 교사가 학교에 오지 않는 요일을 통째로 잠근다.
   *
   * 시간강사는 정해진 요일에만 오고, 육아시간이나 연구년도 근무 요일이 갈린다.
   * 빈 칸을 하나씩 눌러 잠글 수는 있지만 하루 일곱 교시면 스물한 번을 눌러야 한다.
   * 요일 하나로 끝내는 편이 실제로 쓰인다.
   */
  const onToggleMyOffDay = useCallback(
    (d: number) => {
      if (!input || currentTeacher === null) return;
      setHovered(null);
      const cfg = input.config;
      // 이미 수업이 있는 칸은 잠그지 않는다. 잠그면 그 교사가 자기 수업 시간에
      // 근무할 수 없다는 모순이 되어 불변식 검사가 모든 반영을 되돌린다.
      const busy = new Set(
        input.assignments.filter((a) => a.teacher === currentTeacher).map((a) => a.slot),
      );
      const daySlots = Array.from({ length: cfg.periods }, (_, p) => d * cfg.periods + p).filter(
        (sl) => !busy.has(sl),
      );
      if (daySlots.length === 0) return;
      setUnavail((u) => {
        const cur = new Set(u[currentTeacher] ?? []);
        const allLocked = daySlots.every((s) => cur.has(s));
        for (const s of daySlots) {
          if (allLocked) cur.delete(s);
          else cur.add(s);
        }
        const next: Record<string, number[]> = { ...u };
        if (cur.size === 0) delete next[currentTeacher];
        else next[currentTeacher] = [...cur].sort((x, y) => x - y);
        saveUnavail(next);
        return next;
      });
    },
    [input, currentTeacher],
  );

  /** 그 교사가 빈 시간을 통째로 잠가 둔 요일 */
  const myOffDays = useMemo(() => {
    if (!input || currentTeacher === null) return [];
    const cfg = input.config;
    const locked = new Set(unavail[currentTeacher] ?? []);
    const busy = new Set(
      input.assignments.filter((a) => a.teacher === currentTeacher).map((a) => a.slot),
    );
    const out: number[] = [];
    for (let d = 0; d < cfg.days; d++) {
      let free = 0;
      let all = true;
      for (let p = 0; p < cfg.periods; p++) {
        const sl = d * cfg.periods + p;
        if (busy.has(sl)) continue;
        free++;
        if (!locked.has(sl)) all = false;
      }
      if (free > 0 && all) out.push(d);
    }
    return out;
  }, [input, currentTeacher, unavail]);

  const onSkip = useCallback(() => {
    setHovered(null);
    setQueue((q) => (q.length > 1 ? [...q.slice(1), q[0]!] : []));
  }, []);

  const onCopy = useCallback(
    (c: Candidate) => {
      if (!input) return;
      void copy(buildPhrase(c, input.config, slotName), '요청 문구를 복사했습니다');
    },
    [input, copy],
  );

  const onCopyCover = useCallback(
    (name: string) => {
      if (!input || !result) return;
      void copy(
        buildCoverPhrase(
          name,
          result.target.slot,
          result.target.klass,
          result.target.subject,
          input.config,
          slotName,
        ),
        '보강 요청 문구를 복사했습니다',
      );
    },
    [input, result, copy],
  );

  /**
   * 보강을 시간표에 반영한다.
   *
   * 자리를 옮기는 것이 아니라 담당 교사만 바뀐다. 고교학점제로 선택과목이 강좌 단위로
   * 열리면서 교체 자체가 성립하지 않는 자리가 늘었고, 그런 자리에서 실제로 벌어지는
   * 일이 이것이다. 결재와 나이스 입력이 따르는 정식 변경이라 장부에 남겨야 한다.
   */
  const onApplyCover = useCallback(
    (name: string) => {
      if (!input || !result || currentTeacher === null) return;
      const { slot, klass, subject } = result.target;
      const nextId = (entries[entries.length - 1]?.id ?? 0) + 1;
      const next: AppliedEntry[] = [
        ...entries,
        {
          id: nextId,
          type: '보강',
          title: `${name} 선생님 보강 (${slotName(slot, input.config)} ${klass} ${subject})`,
          changes: [],
          cover: { teacher: name, slot, klass, subject, absent: currentTeacher },
        },
      ];
      setEntries(next);
      if (!saveEntries(next)) setNoSave(true);
      setHovered(null);
      setQueue((q) => {
        const rest = q.slice(1);
        show(
          rest.length > 0
            ? `${name} 선생님 보강으로 반영했습니다. 남은 결강 ${rest.length}건`
            : `${name} 선생님 보강으로 반영했습니다`,
        );
        return rest;
      });
    },
    [input, result, currentTeacher, entries, show],
  );

  const onCopyNotice = useCallback(() => {
    if (!input || !loaded || entries.length === 0) return;
    void copy(buildNotice(loaded.schoolName, entries, input.config), '변경 공지를 복사했습니다');
  }, [input, loaded, entries, copy]);

  const onCopyNeisList = useCallback(() => {
    if (!input || !loaded || entries.length === 0) return;
    void copy(
      buildNeisList(loaded.schoolName, entries, input.config),
      '나이스 입력 목록을 복사했습니다',
    );
  }, [input, loaded, entries, copy]);

  const onApply = useCallback(
    (c: Candidate) => {
      if (!input) return;
      const after = applyAll(input, [{ id: 0, type: c.type, title: c.title, changes: c.changes }]);
      if (validate(after).length > 0) {
        show('이 방법은 지금 시간표와 맞지 않습니다. 다른 방법을 선택하십시오');
        return;
      }
      const nextId = (entries[entries.length - 1]?.id ?? 0) + 1;
      const next = [...entries, { id: nextId, type: c.type, title: c.title, changes: c.changes }];
      setEntries(next);
      if (!saveEntries(next)) setNoSave(true);
      setHovered(null);
      setQueue((q) => {
        const rest = q.slice(1);
        show(
          rest.length > 0
            ? `시간표에 반영했습니다. 남은 결강 ${rest.length}건`
            : '시간표에 반영했습니다',
        );
        if (rest.length === 0 && typeof window !== 'undefined' && window.innerWidth < 900) {
          window.setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
        }
        return rest;
      });
    },
    [input, entries, show],
  );

  const onRequest = useCallback(
    (candidate: Candidate, date: string, requestReason: RequestReason, note: string, alternatives: Candidate[]) => {
      if (!result || !input || currentTeacher === null) return;
      const picked = new Date(date + 'T12:00:00');
      const expectedDay = dayOf(result.target.slot, input.config) + 1;
      if (Number.isNaN(picked.getTime()) || picked.getDay() !== expectedDay) {
        show((input.config.dayNames[expectedDay - 1] ?? '해당') + '요일 날짜를 골라 주세요');
        return;
      }
      if (localYmd(picked) < localYmd(new Date())) {
        show('오늘 이후 날짜를 골라 주세요');
        return;
      }
      const duplicate = requests.some(
        (request) =>
          request.status === 'pending' &&
          request.teacher === currentTeacher &&
          request.date === date &&
          request.target.slot === result.target.slot,
      );
      if (duplicate) {
        show('같은 수업의 검토 중인 요청이 이미 있습니다');
        return;
      }
      try {
        const request = createRequest({
          date,
          teacher: currentTeacher,
          reason: requestReason,
          note,
          target: result.target,
          candidate,
          alternatives,
        });
        const next = [request, ...requests];
        setRequests(next);
        if (!saveRequests(next)) setNoSave(true);
        setHovered(null);
        setQueue((current) => current.slice(1));
        show('일과 담당자에게 변경 요청을 보냈습니다');
        window.setTimeout(() => document.getElementById('my-requests-title')?.focus(), 80);
      } catch (error) {
        show(error instanceof Error ? error.message : '요청을 저장하지 못했습니다');
      }
    },
    [result, input, currentTeacher, requests, show],
  );

  const onCoverRequest = useCallback(
    (candidate: CoverCandidate, date: string, requestReason: RequestReason, note: string) => {
      if (!result || !input || currentTeacher === null) return;
      const picked = new Date(date + 'T12:00:00');
      const expectedDay = dayOf(result.target.slot, input.config) + 1;
      if (Number.isNaN(picked.getTime()) || picked.getDay() !== expectedDay) {
        show((input.config.dayNames[expectedDay - 1] ?? '해당') + '요일 날짜를 골라 주세요');
        return;
      }
      if (localYmd(picked) < localYmd(new Date())) {
        show('오늘 이후 날짜를 골라 주세요');
        return;
      }
      const duplicate = requests.some(
        (request) =>
          request.status === 'pending' && request.teacher === currentTeacher &&
          request.date === date && request.target.slot === result.target.slot,
      );
      if (duplicate) {
        show('같은 수업의 검토 중인 요청이 이미 있습니다');
        return;
      }
      try {
        const request = createCoverRequest({
          date, teacher: currentTeacher, reason: requestReason, note,
          target: result.target, cover: candidate,
        });
        const next = [request, ...requests];
        setRequests(next);
        if (!saveRequests(next)) setNoSave(true);
        setQueue((current) => current.slice(1));
        show(candidate.teacher + ' 선생님 보강 요청을 보냈습니다');
        window.setTimeout(() => document.getElementById('my-requests-title')?.focus(), 80);
      } catch (error) {
        show(error instanceof Error ? error.message : '요청을 저장하지 못했습니다');
      }
    },
    [result, input, currentTeacher, requests, show],
  );

  const onCancelRequest = useCallback(
    (id: string) => {
      try {
        const next = requests.map((request) =>
          request.id === id ? transitionRequest(request, 'cancelled') : request,
        );
        setRequests(next);
        if (!saveRequests(next)) setNoSave(true);
        show('요청을 취소했습니다');
      } catch (error) {
        show(error instanceof Error ? error.message : '요청을 취소하지 못했습니다');
      }
    },
    [requests, show],
  );

  const onSelectRequestCandidate = useCallback(
    (id: string, candidate: Candidate) => {
      try {
        const next = requests.map((request) =>
          request.id === id ? selectCandidate(request, candidate) : request,
        );
        setRequests(next);
        if (!saveRequests(next)) setNoSave(true);
        show('승인할 교체안을 바꿨습니다');
      } catch (error) {
        show(error instanceof Error ? error.message : '교체안을 바꾸지 못했습니다');
      }
    },
    [requests, show],
  );

  const onApproveRequest = useCallback(
    (id: string) => {
      if (!input) return;
      const request = requests.find((item) => item.id === id);
      if (!request) return;
      if (request.kind !== 'cover') {
        const after = applyAll(input, [
          { id: 0, type: request.candidate.type, title: request.candidate.title, changes: request.candidate.changes },
        ]);
        if (validate(after).length > 0) {
          show('그 사이 시간표가 달라져 이 안을 승인할 수 없습니다. 새 요청이 필요합니다');
          return;
        }
      }
      try {
        const nextId = (entries[entries.length - 1]?.id ?? 0) + 1;
        const nextEntry = requestEntry(request, nextId, input.config);
        const nextEntries = [...entries, nextEntry];
        const nextRequests = requests.map((item) =>
          item.id === id ? transitionRequest(item, 'approved') : item,
        );
        setEntries(nextEntries);
        if (!saveEntries(nextEntries)) setNoSave(true);
        setRequests(nextRequests);
        if (!saveRequests(nextRequests)) setNoSave(true);
        show('승인했습니다. 이제 행정 마무리 세 단계를 확인해 주세요');
        window.setTimeout(() => document.getElementById('admin-checklist-title')?.focus(), 80);
      } catch (error) {
        show(error instanceof Error ? error.message : '승인하지 못했습니다');
      }
    },
    [input, requests, entries, show],
  );

  const onRejectRequest = useCallback(
    (id: string, note: string) => {
      try {
        const next = requests.map((request) =>
          request.id === id ? transitionRequest(request, 'rejected', note) : request,
        );
        setRequests(next);
        if (!saveRequests(next)) setNoSave(true);
        show('조정할 이유와 함께 반려했습니다');
      } catch (error) {
        show(error instanceof Error ? error.message : '반려하지 못했습니다');
      }
    },
    [requests, show],
  );

  const onRequestChecklist = useCallback(
    (id: string, key: ChecklistKey, checked: boolean) => {
      try {
        const next = requests.map((request) =>
          request.id === id ? setChecklist(request, key, checked) : request,
        );
        setRequests(next);
        if (!saveRequests(next)) setNoSave(true);
      } catch (error) {
        show(error instanceof Error ? error.message : '완료 상태를 저장하지 못했습니다');
      }
    },
    [requests, show],
  );

  const onPublishRequest = useCallback(
    (id: string) => {
      try {
        const next = requests.map((request) =>
          request.id === id ? transitionRequest(request, 'published') : request,
        );
        setRequests(next);
        if (!saveRequests(next)) setNoSave(true);
        show('변경 시간표를 게시 완료로 표시했습니다');
        window.setTimeout(() => document.getElementById('ops-detail-title')?.focus(), 80);
      } catch (error) {
        show(error instanceof Error ? error.message : '게시 완료로 바꾸지 못했습니다');
      }
    },
    [requests, show],
  );

  const onUndoLast = useCallback(() => {
    if (entries.length === 0) return;
    const next = entries.slice(0, -1);
    setEntries(next);
    saveEntries(next);
    setQueue([]);
    setHovered(null);
    show('직전 변경을 되돌렸습니다');
  }, [entries, show]);

  const onUndoAll = useCallback(() => {
    if (entries.length === 0) return;
    if (!window.confirm('반영한 변경을 모두 되돌리시겠습니까?')) return;
    setEntries([]);
    setRequests([]);
    saveRequests([]);
    saveEntries([]);
    setQueue([]);
    setHovered(null);
    show('변경을 모두 되돌렸습니다');
  }, [entries, show]);

  const onReason = useCallback((v: string) => {
    setReason(v);
    try {
      localStorage.setItem(REASON_KEY, v);
    } catch {
      /* 무시 */
    }
  }, []);

  const onPrint = useCallback(() => {
    window.print();
  }, []);

  const onCopyRequestNotice = useCallback(
    (id: string) => {
      if (!input || !loaded) return;
      const request = requests.find((item) => item.id === id);
      if (!request) return;
      void copy(buildNotice(loaded.schoolName, [requestEntry(request, 1, input.config)], input.config), '이 요청의 변경 공지를 복사했습니다');
    },
    [input, loaded, requests, copy],
  );

  const onCopyRequestNeisList = useCallback(
    (id: string) => {
      if (!input || !loaded) return;
      const request = requests.find((item) => item.id === id);
      if (!request) return;
      void copy(buildNeisList(loaded.schoolName, [requestEntry(request, 1, input.config)], input.config), '이 요청의 나이스 입력 목록을 복사했습니다');
    },
    [input, loaded, requests, copy],
  );

  const onPrintRequest = useCallback(
    (id: string) => {
      const request = requests.find((item) => item.id === id);
      if (!request) return;
      setPrintRequest(request);
      window.setTimeout(() => window.print(), 80);
    },
    [requests],
  );

  const onReset = useCallback(() => {
    clearRaw();
    setLoaded(null);
    setTeacher(null);
    setEntries([]);
    setKlass(null);
    setView('teacher');
    setWorkspaceMode('teacher');
    setQueue([]);
    setUnavail({});
    setHovered(null);
    setNeedsPick(false);
    try {
      localStorage.removeItem(TEACHER_KEY);
    } catch {
      /* 무시 */
    }
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <button
          className="wordmark"
          onClick={() => {
            setAtHome(true);
            setShowNeis(false);
            setHovered(null);
            window.scrollTo({ top: 0 });
          }}
          title="처음 화면으로"
        >
          <span className="tick" aria-hidden />
          {BRAND}
          <span className="beta">베타</span>
        </button>
        {loaded && !atHome && !needsPick && (
          <span className="school-chip">
            {loaded.schoolName} | {loaded.source}
          </span>
        )}
        {loaded && input && !atHome && !needsPick && (
          <nav className="workspace-switch" aria-label="작업 공간">
            <button
              className={workspaceMode === 'teacher' ? 'on' : ''}
              aria-current={workspaceMode === 'teacher' ? 'page' : undefined}
              onClick={() => setWorkspaceMode('teacher')}
            >
              내 시간표
            </button>
            <button
              className={workspaceMode === 'ops' ? 'on' : ''}
              aria-current={workspaceMode === 'ops' ? 'page' : undefined}
              onClick={() => setWorkspaceMode('ops')}
            >
              일과 요청함
              {requests.some((request) => request.status === 'pending') && (
                <span>{requests.filter((request) => request.status === 'pending').length}</span>
              )}
            </button>
          </nav>
        )}
        <span className="spacer" />
        {loaded && input && !atHome && !needsPick && workspaceMode === 'teacher' && (
          <>
            <div className="seg" role="tablist" aria-label="보기 전환">
              <button
                role="tab"
                aria-selected={view === 'teacher'}
                className={view === 'teacher' ? 'on' : ''}
                onClick={() => {
                  setView('teacher');
                  setHovered(null);
                }}
              >
                교사
              </button>
              <button
                role="tab"
                aria-selected={view === 'klass'}
                className={view === 'klass' ? 'on' : ''}
                onClick={() => {
                  setView('klass');
                  setHovered(null);
                }}
              >
                학급
              </button>
            </div>
            {view === 'teacher' && currentTeacher !== null && (
              <>
                <input
                  id="teacher-input"
                  className="select combo"
                  list="teacher-options"
                  aria-label="선생님 성함 선택"
                  placeholder="선생님 성함"
                  value={teacherInput}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const v = e.target.value;
                    setTeacherInput(v);
                    if (teachers.some((t) => t.name === v)) commitTeacher(v);
                  }}
                  onBlur={() => setTeacherInput(currentTeacher ?? '')}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const m = teachers.find((t) => t.name === teacherInput.trim());
                      if (m) commitTeacher(m.name);
                      e.currentTarget.blur();
                    }
                  }}
                />
                <datalist id="teacher-options">
                  {teachers.map((t) => (
                    <option key={t.name} value={t.name}>
                      {`주 ${t.n}시간`}
                    </option>
                  ))}
                </datalist>
              </>
            )}
            {view === 'klass' && currentKlass !== null && (
              <select
                id="klass-select"
                className="select"
                aria-label="학급 선택"
                value={currentKlass}
                onChange={(e) => setKlass(e.target.value)}
              >
                {klasses.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
        <button className="btn ghost theme-btn" title="화면 테마 전환" onClick={cycleTheme}>
          테마 {THEME_LABEL[theme]}
        </button>
        {loaded && input && !atHome && !needsPick && (
          <>
            <button className="btn ghost" onClick={onSaveFile}>
              파일로 저장
            </button>
            <button className="btn ghost" onClick={onReset} title="이 기기에 저장된 시간표를 지웁니다">
              자료 지우기
            </button>
          </>
        )}
      </header>

      {showNeis ? (
        <main className="work single">
          <section className="card">
            <NeisLoader
              neisKey={neisKey}
              onKeyChange={(k) => {
                setNeisKey(k);
                saveNeisKey(k);
              }}
              onDone={onNeisDone}
              onCancel={() => setShowNeis(false)}
            />
          </section>
        </main>
      ) : !loaded || !input || atHome ? (
        <Landing
          onNeis={() => setShowNeis(true)}
          onSample={onSample}
          onFile={onFile}
          onResume={() => setAtHome(false)}
          hasSaved={loaded !== null && input !== null}
          savedName={loaded?.schoolName ?? ''}
          busy={busy}
        />
      ) : needsPick ? (
        <TeacherPick
          schoolName={loaded.schoolName}
          teachers={teachers}
          onPick={commitTeacher}
        />
      ) : workspaceMode === 'ops' ? (
        <OpsInbox
          requests={requests}
          cfg={input.config}
          onApprove={onApproveRequest}
          onReject={onRejectRequest}
          onChecklist={onRequestChecklist}
          onPublish={onPublishRequest}
          onCopyNeisList={onCopyRequestNeisList}
          onCopyNotice={onCopyRequestNotice}
          onPrint={onPrintRequest}
          onSelectCandidate={onSelectRequestCandidate}
        />
      ) : (
        <main className={'teacher-work focus-' + scheduleFocus + (activeSlot !== null ? ' has-selection' : '')}>
          {view === 'teacher' && currentTeacher !== null && (
            <TeacherHome
              schoolName={loaded.schoolName}
              teacher={currentTeacher}
              cfg={input.config}
              lessons={lessons}
              todayIdx={todayIdx}
              requests={requests}
              focus={scheduleFocus}
              onFocus={setScheduleFocus}
            />
          )}
          {(scheduleFocus === 'week' || view === 'klass') && (
            <div className="work">
              <Grid
                cfg={input.config}
                mode={view}
                owner={(view === 'teacher' ? currentTeacher : currentKlass) ?? ''}
                lessons={lessons}
                absentSlots={queue}
                lockedSlots={currentTeacher !== null ? (unavail[currentTeacher] ?? []) : []}
                todayIdx={todayIdx}
                closures={closures}
                preview={hovered}
                onToggleSlot={onToggleSlot}
                onToggleDay={onToggleDay}
                onToggleLock={onToggleLock}
                offDays={offDays}
                onToggleOffDay={onToggleOffDay}
                myOffDays={myOffDays}
                onToggleMyOffDay={onToggleMyOffDay}
                busySlots={
                  view === 'klass' && currentKlass !== null
                    ? (input.klassBusy?.[currentKlass] ?? [])
                    : []
                }
              />
              <div className="side" ref={sideRef} tabIndex={-1}>
                <Panel
                  cfg={input.config}
                  result={result}
                  queueLen={queue.length}
                  cover={cover}
                  hovered={hovered}
                  peers={peers}
                  electiveGrade={electiveGrade}
                  grouped={grouped}
                  defaultDate={requestDate}
                  owner={currentTeacher ?? ''}
                  onGroup={onGroup}
                  onUngroup={onUngroup}
                  onHover={setHovered}
                  onCopy={onCopy}
                  onCopyCover={onCopyCover}
                  onApplyCover={onApplyCover}
                  onApply={onApply}
                  onRequest={onRequest}
                  onCoverRequest={onCoverRequest}
                  onSkip={onSkip}
                  onClear={() => {
                    setQueue([]);
                    setHovered(null);
                  }}
                />
              </div>
            </div>
          )}
          {view === 'teacher' && currentTeacher !== null && (
            <RequestStatusList
              requests={requests.filter((request) => request.teacher === currentTeacher)}
              cfg={input.config}
              onCancel={onCancelRequest}
            />
          )}
        </main>
      )}

      {loaded && input && (
        <Sheet
          schoolName={loaded.schoolName}
          cfg={input.config}
          entries={printRequest ? [requestEntry(printRequest, 1, input.config)] : entries}
          teacher={printRequest?.teacher ?? currentTeacher ?? ''}
          reason={printRequest ? printRequest.reason + (printRequest.note ? ' · ' + printRequest.note : '') : reason}
        />
      )}

      {loaded?.conflicts && loaded.conflicts.length > 0 && !atHome && !needsPick && input && (
        <div className="warn-bar" role="alert">
          <b>같은 이름이 같은 교시에 두 과목을 맡고 있습니다.</b>{' '}
          {loaded.conflicts
            .slice(0, 3)
            .map(
              (c) =>
                `${c.teacher} 선생님 ${slotName(c.slot, input.config)} (${c.subjects.join(', ')})`,
            )
            .join(', ')}
          {loaded.conflicts.length > 3 ? ` 외 ${loaded.conflicts.length - 3}건` : ''}. 동명이인이라면
          교사 배정에서 이름을 구분해 다시 불러오십시오. 그대로 두면 그 자리의 추천이 어긋납니다.
        </div>
      )}

      {/*
       * 자료가 없는 요일은 격자 머리글에도 표시되지만 그것만으로는 눈에 안 든다.
       * 파일로 받아 여신 분은 그 파일이 어떤 기간으로 만들어졌는지 모른다.
       * 요일 하나가 통째로 빠졌다는 것은 위쪽에서 한 번 알려야 한다.
       */}
      {blankDays.length > 0 && input && !atHome && !needsPick && (
        <div className="warn-bar soft" role="status">
          <b>
            {/* 요일 이름이 한 글자라 "수 요일" 이 되지 않게 붙여 쓴다 */}
            {blankDays.map((d) => `${input.config.dayNames[d] ?? d + 1}요일`).join(', ')}은 받은
            자료에 없습니다.
          </b>{' '}
          그 요일로 옮기는 안은 내지 않습니다. 학교가 그날 수업을 한다면 나이스에서 기간을 넓혀
          다시 불러오십시오.
        </div>
      )}

      {unfilled > 0 && !atHome && !needsPick && (
        <div className="warn-bar soft" role="status">
          담당 교사를 아직 안 채운 수업이 <b>{unfilled}자리</b> 있습니다. 그 자리는 수업이 있는
          것으로 보고 비켜 가므로 잘못된 안이 나오지는 않습니다. 다만 그만큼 찾을 수 있는 교체가
          줄어듭니다. 교사 배정을 더 채우시면 더 많은 방법이 나옵니다.
        </div>
      )}

      {staleCalendar && !atHome && !needsPick && (
        <div className="warn-bar soft" role="status">
          받아 둔 학사일정이 이번 주를 지나쳤습니다. 휴업일을 걸러 내려면 나이스에서 시간표를 다시
          불러오십시오.
        </div>
      )}

      {noSave && (
        <div className="warn-bar" role="alert">
          <b>이 브라우저에 저장하지 못했습니다.</b> 새로고침하면 지금까지 하신 작업이 사라집니다.
          위쪽 파일로 저장을 눌러 파일로 남겨 두십시오. 사생활 보호 모드이거나 저장 공간이 가득
          찼을 때 생깁니다.
        </div>
      )}

      <footer className="foot">
        <span>불러온 시간표는 이 기기에만 저장합니다.</span>
        <span>최종 확정은 학교의 결재 절차를 따릅니다.</span>
      </footer>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
