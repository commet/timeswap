'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  coverCandidates,
  dayOf,
  recommend,
  gradeShapes,
  noSwapReason,
  groupCandidate,
  slotName,
  validate,
  type Candidate,
  type CoverCandidate,
  type RecommendResult,
  type TimetableInput,
} from '@timeswap/engine';
import { AppShell } from './AppShell';
import { Grid } from './Grid';
import { Panel } from './Panel';
import { Changes } from './Changes';
import { Sheet } from './Sheet';
import { TeacherPick } from './TeacherPick';
import { TeacherHome } from './TeacherHome';
import { ResolutionMatrix } from './ResolutionMatrix';
import { OpsCommandCenter } from './OpsCommandCenter';
import { CaseDetail } from './CaseDetail';
import { PublicationCenter } from './PublicationCenter';
import { PublicClassTimetable } from './PublicClassTimetable';
import {
  projectTeacherDiagnostic,
  type AbsenceComposerSubmission,
  type CandidateHandoff,
} from './AbsenceComposer';
import { RequestStatusList } from './RequestStatusList';
import { BRAND } from '../lib/brand';
import type { WorkspaceState } from '../lib/domain';
import { effectiveLessons } from '../lib/projections';
import {
  CASE_STATUS_LABEL,
  findDuplicateAbsenceCase,
  findOverlappingAbsenceCases,
  persistSubmittedAbsenceCase,
  transitionCase,
} from '../lib/case-service';
import {
  resolutionPreviewForHandoff,
  resolutionProgressForCase,
  resolutionRowsForLesson,
  resolutionDetailForRow,
  resolutionConstraintForLesson,
  selectResolutionForCase,
} from '../lib/resolution';
import {
  canResetDemoWorkspace,
  projectOpsCommandCenter,
} from '../lib/ops-command-center';
import {
  parseLocation,
  pushLocation,
  subscribeToPopState,
  type AppLocation,
} from '../lib/navigation';
import { createWorkspaceRepository, type SaveResult, type WorkspaceRepository } from '../lib/repository';
import {
  RoleViewAdapterProvider,
  type RoleViewAdapterProps,
} from './RoleNavigation';
import { NeisSessionProvider } from './SetupFlow';
import {
  createRequest,
  createCoverRequest,
  selectCandidate,
  setChecklist,
  transitionRequest,
  type ChangeRequest,
  type ChecklistKey,
  type RequestReason,
} from '../lib/request-workflow';
import {
  applyAll,
  applyTheme,
  blankDaysOf,
  buildClosures,
  buildCoverPhrase,
  calendarCoversThisWeek,
  buildNeisList,
  buildNotice,
  buildPhrase,
  deriveBurden,
  loadOffDays,
  loadUnavail,
  saveOffDays,
  saveUnavail,
  loadTheme,
  weekMondayOf,
  REASON_KEY,
  TEACHER_KEY,
  THEME_LABEL,
  THEME_ORDER,
  toFile,
  type AppliedEntry,
  type Loaded,
  type ThemeMode,
} from '../lib/app';
import { localDate } from '../lib/today';
import { createNeisSession } from '../lib/neis-session';
import { loadDemoScenario, type DemoScenarioId } from '../lib/demo';

function workspaceToLoaded(state: WorkspaceState): Loaded {
  const periods = Math.max(7, ...state.lessons.map((lesson) => Number(lesson.period) || 1));
  const config: TimetableInput['config'] = {
    days: 5,
    periods,
    dayNames: ['월', '화', '수', '목', '금'],
  };
  const busy = new Map<string, Set<number>>();
  const assignments = state.lessons.flatMap((lesson) => {
    const day = new Date(`${lesson.date}T00:00:00.000Z`).getUTCDay() - 1;
    const period = Number(lesson.period) - 1;
    if (day < 0 || day >= 5 || period < 0 || period >= periods) return [];
    const slot = day * periods + period;
    const klass = `${lesson.classIdentity.grade}-${lesson.classIdentity.className}`;
    if (lesson.teacher.state === 'unassigned') {
      const slots = busy.get(klass) ?? new Set<number>();
      slots.add(slot);
      busy.set(klass, slots);
      return [];
    }
    return [{
      teacher: lesson.teacher.teacherId,
      klass,
      subject: lesson.subject,
      slot,
      ...(lesson.parallelGroupId ? { group: lesson.parallelGroupId } : {}),
    }];
  });
  return {
    schoolName: state.workspace.name,
    source: state.revisions[0]?.source === 'demo'
      ? '샘플' : state.revisions[0]?.source === 'neis' ? '나이스' : '파일',
    input: {
      config,
      assignments,
      ...(busy.size ? {
        klassBusy: Object.fromEntries([...busy].map(([klass, slots]) => [klass, [...slots]])),
      } : {}),
    },
  };
}

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

/**
 * 지금은 화면에 뜨지 않는다.
 *
 * `RoleWorkbench` 는 teacher, ops, class 세 갈래를 모두 제 컴포넌트로 보내고,
 * `AppShell` 은 landing 과 setup 을 제가 직접 처리해 `RoleView` 를 아예 부르지 않는다.
 * `RoleViewAdapterProps['location']` 이 그 둘을 빼 놓은 타입이라, 세 갈래를 처리한
 * 다음 자리에서 타입이 never 로 좁혀진다. 아래 마지막 return 은 그래서 못 닿는다.
 *
 * 그런데 이 안에는 화면에서 쓰는 길에 아직 없는 것이 들어 있다. 근무 불가 지정,
 * 수업 없는 요일 지정, 자료가 빠진 요일 경고가 그것이다. 지워 버리면 그 참고가
 * 사라지므로 남겨 둔다.
 *
 * 고칠 것이 생기면 여기 말고 `lib/resolution.ts` 와 canonical 컴포넌트를 고쳐야 한다.
 * 여기를 고치면 화면은 그대로다. 실제로 한 번 그렇게 헛고쳤다.
 */
function LegacyWorkbench({ state: workspaceState, location, navigate }: RoleViewAdapterProps) {
  const seed = useMemo(() => workspaceToLoaded(workspaceState), [workspaceState]);
  const workspaceKey = workspaceState.workspace.id;
  const [loaded, setLoaded] = useState<Loaded | null>(seed);
  /** 로고를 누르면 시작 화면으로 돌아온다. 불러온 시간표는 지우지 않는다. */
  const [atHome, setAtHome] = useState(false);
  const [teacher, setTeacher] = useState<string | null>(
    location.view === 'teacher' ? location.teacher : defaultTeacher(seed.input),
  );
  const [teacherInput, setTeacherInput] = useState('');
  /** 아직 본인 성함을 고르지 않았다. 처음 불러온 직후에만 참이다. */
  const [needsPick, setNeedsPick] = useState(false);
  /** 결재 문서에 들어갈 결강 사유 */
  const [reason, setReason] = useState('출장');
  const [entries, setEntries] = useState<AppliedEntry[]>([]);
  const [view, setView] = useState<'teacher' | 'klass'>(location.view === 'class' ? 'klass' : 'teacher');
  const [klass, setKlass] = useState<string | null>(
    location.view === 'class' ? `${location.grade}-${location.className}` : null,
  );
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
  const [workspaceMode, setWorkspaceMode] = useState<'teacher' | 'ops'>(location.view === 'ops' ? 'ops' : 'teacher');
  const [scheduleFocus, setScheduleFocus] = useState<'today' | 'week'>('week');
  const [requests, setRequests] = useState<ChangeRequest[]>([]);
  const [printRequest, setPrintRequest] = useState<ChangeRequest | null>(null);
  const sideRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = workspaceToLoaded(workspaceState);
    setLoaded(next);
    setTeacher(location.view === 'teacher' ? location.teacher : defaultTeacher(next.input));
    setView(location.view === 'class' ? 'klass' : 'teacher');
    setKlass(location.view === 'class' ? `${location.grade}-${location.className}` : null);
    setWorkspaceMode(location.view === 'ops' ? 'ops' : 'teacher');
    setAtHome(false);
    setNeedsPick(false);
    setEntries([]);
    setUnavail(loadUnavail(workspaceState.workspace.id));
    setReason(localStorage.getItem(REASON_KEY) ?? '출장');
    setOffDays(loadOffDays(workspaceState.workspace.id));
    setTheme(loadTheme());
    const wd = new Date().getDay(); // 일 0, 월 1
    setTodayIdx(wd >= 1 && wd <= 5 ? wd - 1 : null);
    if (window.innerWidth < 700) setScheduleFocus('today');
  }, [location, workspaceState]);

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
      // 그 학급만 쉬는 날이면 보강도 세울 자리가 아니다
      result.target.klass,
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
   * 교체 상대를 찾기 어려운 학년인지. 전국 217곳을 재어 만든 기준이다.
   * 과목마다 그 과목을 듣는 학급이 학년의 몇 할인지 평균한 값(공통도)으로 가른다.
   *
   * 까닭까지 함께 받는다. 같은 값이라도 일반고에서는 선택과목이고
   * 특성화고에서는 학과별 전공 편성이다. 문장이 갈려야 맞는 말이 된다.
   *
   * 학년은 input.klassGrade 에서 읽는다. 학급 키에서 숫자를 캐면 안 된다.
   * 나이스 학급 키는 `["7010084","2026",...]` 처럼 학교 코드로 시작해서 첫 숫자가
   * 학년이 아니다. 여기가 그렇게 되어 있어서 엔진을 고친 뒤에도 화면에는
   * 이 안내가 뜨지 않았다.
   */
  const electiveGrade = useMemo(() => {
    if (!input || !result) return null;
    const g = input.klassGrade?.[result.target.klass] ?? Number(/^\d+/.exec(result.target.klass)?.[0]);
    if (!Number.isFinite(g)) return null;
    return gradeShapes(input).find((x) => x.grade === g && x.elective) ?? null;
  }, [input, result]);

  /**
   * 교체안이 하나도 없을 때 그 까닭.
   *
   * 초등학교 담임 선생님은 결강의 62%에서 교체 후보가 없다. 그 학급 수업을 거의 다
   * 맡고 계셔서 바꿔 줄 상대가 자기 자신이다. 그런데 화면은 근무 불가 시간과 묶음
   * 수업을 확인하라고 안내하고 있었다. 그 둘은 원인이 아니다.
   */
  const noSwap = useMemo(() => {
    if (!input || !result || result.candidates.length > 0) return null;
    return noSwapReason(input, { teacher: result.target.teacher, slot: result.target.slot });
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
      const cur = new Set(unavail[currentTeacher] ?? []);
      if (cur.has(s)) cur.delete(s);
      else cur.add(s);
      const next: Record<string, number[]> = { ...unavail };
      if (cur.size === 0) delete next[currentTeacher];
      else next[currentTeacher] = [...cur].sort((x, y) => x - y);
      setUnavail(next);
      saveUnavail(workspaceKey, next);
    },
    [currentTeacher, unavail, workspaceKey],
  );

  const onToggleOffDay = useCallback(
    (d: number) => {
      setHovered(null);
      const next = offDays.includes(d)
        ? offDays.filter((x) => x !== d)
        : [...offDays, d].sort((a, b) => a - b);
      setOffDays(next);
      saveOffDays(workspaceKey, next);
    },
    [offDays, workspaceKey],
  );

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
      const cur = new Set(unavail[currentTeacher] ?? []);
      const allLocked = daySlots.every((s) => cur.has(s));
      for (const s of daySlots) {
        if (allLocked) cur.delete(s);
        else cur.add(s);
      }
      const next: Record<string, number[]> = { ...unavail };
      if (cur.size === 0) delete next[currentTeacher];
      else next[currentTeacher] = [...cur].sort((x, y) => x - y);
      setUnavail(next);
      saveUnavail(workspaceKey, next);
    },
    [input, currentTeacher, unavail, workspaceKey],
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
        show((input.config.dayNames[expectedDay - 1] ?? '해당') + '요일 날짜를 고르십시오');
        return;
      }
      if (localYmd(picked) < localYmd(new Date())) {
        show('오늘 이후 날짜를 고르십시오');
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
        show((input.config.dayNames[expectedDay - 1] ?? '해당') + '요일 날짜를 고르십시오');
        return;
      }
      if (localYmd(picked) < localYmd(new Date())) {
        show('오늘 이후 날짜를 고르십시오');
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
        setRequests(nextRequests);
        show('승인했습니다. 행정 마무리 세 단계를 확인하십시오');
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
    setQueue([]);
    setHovered(null);
    show('직전 변경을 되돌렸습니다');
  }, [entries, show]);

  const onUndoAll = useCallback(() => {
    if (entries.length === 0) return;
    if (!window.confirm('반영한 변경을 모두 되돌리시겠습니까?')) return;
    setEntries([]);
    setRequests([]);
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
    navigate({ view: 'landing' });
  }, [navigate]);

  return (
    <div className="shell">
      <header className="topbar">
        <button
          className="wordmark"
          onClick={() => {
            setHovered(null);
            navigate({ view: 'landing' });
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

      {!loaded || !input ? (
        <main id="main-content" tabIndex={-1} className="missing-workspace"><p>학교 시간표를 읽지 못했습니다.</p></main>
      ) : needsPick ? (
        <TeacherPick
          schoolName={loaded.schoolName}
          teachers={teachers}
          onPick={commitTeacher}
        />
      ) : workspaceMode === 'ops' ? (
        <main className="missing-workspace">
          <h2>변경 관제판으로 이동합니다</h2>
          <p>이전 요청함은 더 이상 운영 상태를 직접 수정하지 않습니다.</p>
        </main>
      ) : (
        <main id="main-content" tabIndex={-1} className={'teacher-work focus-' + scheduleFocus + (activeSlot !== null ? ' has-selection' : '')}>
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
                  noSwap={noSwap}
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

function workspaceIdOf(location: AppLocation): string | null {
  return location.view === 'teacher' || location.view === 'ops' || location.view === 'class'
    ? location.school
    : null;
}

function downloadDiagnostic(state: WorkspaceState): void {
  const generatedAt = new Date().toISOString();
  const blob = new Blob([JSON.stringify({
    generatedAt,
    ...projectTeacherDiagnostic(state),
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.workspace.name}-변경요청-진단.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function caseIdPart(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

type TeacherRoleViewAdapterProps = Omit<RoleViewAdapterProps, 'location'> & {
  location: Extract<AppLocation, { view: 'teacher' }>;
};

type OpsRoleViewAdapterProps = Omit<RoleViewAdapterProps, 'location'> & {
  location: Extract<AppLocation, { view: 'ops' }>;
};

function CanonicalTeacherWorkbench({ state, location, saveState }: TeacherRoleViewAdapterProps) {
  const teacherId = location.teacher;
  const [handoff, setHandoff] = useState<CandidateHandoff | null>(null);
  const [selectedResolutionId, setSelectedResolutionId] = useState<string | null>(null);
  const [resolutionMessage, setResolutionMessage] = useState('');
  const preview = useMemo(() => handoff
    ? resolutionPreviewForHandoff(state, teacherId, handoff)
    : null, [handoff, state, teacherId]);
  const previewLessonId = handoff?.lessonIds[0] ?? null;
  const rows = useMemo(() => preview && previewLessonId
    ? resolutionRowsForLesson(preview.state, preview.caseId, previewLessonId)
    : [], [preview, previewLessonId]);
  const selectedRow = rows.find((row) => row.id === selectedResolutionId) ?? rows[0] ?? null;
  const constraintMessage = useMemo(() => previewLessonId
    ? resolutionConstraintForLesson(state, previewLessonId, rows)
    : undefined, [previewLessonId, rows, state]);
  const selectedPreview = useMemo(() => preview && selectedRow
    ? selectResolutionForCase(preview.state, preview.caseId, selectedRow)
    : null, [preview, selectedRow]);
  const timetablePreview = useMemo(() => selectedRow
    ? resolutionDetailForRow(state, selectedRow)
    : undefined, [selectedRow, state]);

  useEffect(() => {
    setSelectedResolutionId(rows[0]?.id ?? null);
    setResolutionMessage('');
  }, [handoff, rows]);

  function submit(input: AbsenceComposerSubmission): { caseId?: string; error?: string } {
    const duplicate = findDuplicateAbsenceCase(state, {
      requesterTeacherId: teacherId,
      fromDate: input.fromDate,
      toDate: input.toDate,
      lessonIds: input.lessonIds,
    });
    if (duplicate) {
      return { error: `같은 기간과 수업으로 ${CASE_STATUS_LABEL[duplicate.status]} 상태의 요청이 이미 있습니다. 기존 요청을 확인하거나 날짜 또는 수업 선택을 바꾸십시오.` };
    }
    const overlapping = findOverlappingAbsenceCases(state, {
      requesterTeacherId: teacherId, lessonIds: input.lessonIds,
    });
    if (overlapping.length > 0) {
      const dates = [...new Set(overlapping.flatMap((item) => item.lessonIds)
        .map((lessonId) => effectiveLessons(state).find((lesson) => lesson.id === lessonId)?.date)
        .filter((date): date is string => Boolean(date)))].sort();
      return {
        error: `${dates.join(', ')} 수업은 이미 낸 요청에 들어 있습니다. 그 요청을 취소하거나 겹치지 않는 날짜를 고르십시오.`,
      };
    }
    const part = caseIdPart();
    const at = new Date().toISOString();
    const caseId = `case:${part}`;
    try {
      return persistSubmittedAbsenceCase(state, {
        id: caseId,
        auditEventId: `audit:${part}:created`,
        submissionAuditEventId: `audit:${part}:submitted`,
        workspaceId: state.workspace.id,
        requesterTeacherId: teacherId,
        ...input,
        at,
      }, saveState);
    } catch (error) {
      return { error: error instanceof Error ? error.message : '요청을 저장하지 못했습니다.' };
    }
  }

  /** 낸 사람이 자기 요청을 거둔다. 승인 전까지만 열려 있다. */
  function withdraw(caseId: string): { error?: string } {
    const part = caseIdPart();
    try {
      const next = transitionCase(state, {
        caseId, to: 'cancelled', actorId: teacherId,
        at: new Date().toISOString(), auditEventId: `audit:${part}:cancelled`,
      });
      const result = saveState(next);
      if (result.ok) return {};
      return {
        error: result.reason === 'quota'
          ? '저장 공간이 부족해 취소하지 않았습니다. 공간을 확보한 뒤 다시 시도하십시오.'
          : '이 브라우저에 저장할 수 없어 취소하지 않았습니다. 저장 설정을 확인한 뒤 다시 시도하십시오.',
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : '요청을 취소하지 못했습니다.' };
    }
  }

  function confirmResolution() {
    if (!handoff || !preview || !selectedRow || !selectedPreview) return;
    const selectedCase = selectedPreview.state.cases.find((item) => item.id === preview.caseId);
    if (!selectedCase) return;
    const duplicate = findDuplicateAbsenceCase(state, {
      requesterTeacherId: teacherId,
      fromDate: handoff.fromDate,
      toDate: handoff.toDate,
      lessonIds: selectedCase.lessonIds,
    });
    if (duplicate) {
      setResolutionMessage('같은 기간과 수업으로 이미 제출된 요청이 있습니다. 기존 요청을 확인하거나 날짜 또는 수업 선택을 바꾸십시오.');
      return;
    }
    const part = caseIdPart();
    const at = new Date().toISOString();
    try {
      const result = persistSubmittedAbsenceCase(state, {
        id: `case:${part}`,
        auditEventId: `audit:${part}:created`,
        submissionAuditEventId: `audit:${part}:submitted`,
        workspaceId: state.workspace.id,
        requesterTeacherId: teacherId,
        fromDate: handoff.fromDate,
        toDate: handoff.toDate,
        reason: handoff.reason,
        ...(handoff.note ? { note: handoff.note } : {}),
        lessonIds: selectedCase.lessonIds,
        resolutionItems: selectedCase.resolutionItems,
        at,
      }, saveState);
      if ('error' in result) {
        setResolutionMessage(result.error);
        return;
      }
      setHandoff(null);
    } catch (error) {
      setResolutionMessage(error instanceof Error ? error.message : '해결안을 저장하지 못했습니다.');
    }
  }

  const validationMessage = selectedPreview
    ? selectedPreview.validation.valid
      ? '사건 전체 충돌 검사를 통과했습니다.'
      : selectedPreview.validation.conflicts[0]?.message ?? '사건 전체 충돌 검사가 필요합니다.'
    : resolutionMessage;

  return (
    <>
      <TeacherHome
        state={state}
        teacherId={teacherId}
        onSubmit={submit}
        onExportDiagnostic={() => downloadDiagnostic(state)}
        onCandidateHandoff={setHandoff}
        onWithdraw={withdraw}
        resolutionPreview={timetablePreview}
      />
      {handoff && preview && (
        <ResolutionMatrix
          state={selectedPreview?.state ?? preview.state}
          rows={rows}
          selectedId={selectedRow?.id ?? null}
          onSelect={setSelectedResolutionId}
          onConfirm={confirmResolution}
          progress={resolutionProgressForCase(selectedPreview?.state ?? preview.state, preview.caseId)}
          validationMessage={resolutionMessage || validationMessage}
          atomicMessage={handoff.atomicWarnings[0] ?? constraintMessage}
        />
      )}
    </>
  );
}

/** The demo corpus is fixed in time so its screens stay reproducible. */
/**
 * 일과 담당 화면과 학급 공개 화면이 오늘로 삼는 날.
 *
 * `toISOString()` 을 쓰고 있었다. 그것은 UTC 날짜라 한국에서는 자정부터 아침 9시까지
 * 어제가 나온다. 그 시간에 열면 관제판의 오늘 건수가 어제 것이 되고, 학급 공개
 * 시간표도 어제 것이 떴다. 교사 화면은 지역 날짜를 쓰고 있어서 두 화면이 아침마다
 * 서로 다른 날을 오늘이라고 불렀다.
 */
export function todayOf(state: WorkspaceState, now = new Date()): string {
  const activeRevision = state.revisions.find((item) => item.id === state.workspace.activeRevisionId);
  return activeRevision?.source === 'demo' ? '2026-08-18' : localDate(now);
}

function CanonicalOpsWorkbench({ state, location, saveState, navigate }: OpsRoleViewAdapterProps) {
  const today = todayOf(state);
  const dashboard = useMemo(() => projectOpsCommandCenter(state, today), [state, today]);
  // 게시된 사건은 관제 목록에서 빠지지만 방금 마감한 화면은 그대로 남아야 한다.
  // 그래서 선택은 관제 목록이 아니라 실제 사건 존재 여부로 판정한다.
  const selectedCaseId = state.cases.some((item) => item.id === location.caseId)
    ? location.caseId
    : dashboard.cases[0]?.caseId;

  const selectCase = (caseId: string) => navigate({
    view: 'ops', school: state.workspace.id, caseId, step: 'case',
  });
  const backToList = () => navigate({ view: 'ops', school: state.workspace.id });
  const openAdministrativeStep = () => selectedCaseId && navigate({
    view: 'ops', school: state.workspace.id, caseId: selectedCaseId, step: 'admin',
  });
  const returnToCase = () => selectedCaseId && navigate({
    view: 'ops', school: state.workspace.id, caseId: selectedCaseId, step: 'case',
  });
  const openScenario = (id: DemoScenarioId): SaveResult => {
    if (!canResetDemoWorkspace(state)) return { ok: false, reason: 'unavailable' };
    const next = loadDemoScenario(id);
    const saved = saveState(next);
    if (saved.ok) {
      navigate({
        view: 'ops', school: next.workspace.id,
        ...(next.cases[0] ? { caseId: next.cases[0].id, step: 'case' as const } : {}),
      });
    }
    return saved;
  };

  return (
    <OpsCommandCenter
      dashboard={dashboard.dashboard}
      cases={dashboard.cases}
      timeline={dashboard.timeline}
      selectedCaseId={selectedCaseId}
      onSelectCase={selectCase}
      onOpenScenario={openScenario}
      scenarioState={state}
      onBackToList={backToList}
      onReturnToCase={returnToCase}
      step={location.step}
      administration={selectedCaseId ? (
        <PublicationCenter
          state={state}
          caseId={selectedCaseId}
          onChange={saveState}
          onBackToCase={returnToCase}
          onBackToList={backToList}
          onExportDiagnostic={() => downloadDiagnostic(state)}
          onOpenClassTimetable={(grade, className) => navigate({
            view: 'class', school: state.workspace.id, grade, className,
          })}
          onOpenCase={(nextCaseId) => navigate({
            view: 'ops', school: state.workspace.id, caseId: nextCaseId, step: 'case',
          })}
        />
      ) : null}
      detail={selectedCaseId ? (
        <CaseDetail
          state={state}
          caseId={selectedCaseId}
          today={today}
          onChange={saveState}
          onBack={backToList}
          onOpenAdministrativeStep={openAdministrativeStep}
        />
      ) : <section className="ops-case-detail empty"><h2>선택할 사건이 없습니다</h2><p>사건 목록에서 확인할 변경을 선택하십시오.</p></section>}
    />
  );
}

function RoleWorkbench(props: RoleViewAdapterProps) {
  if (props.location.view === 'teacher') return (
    <CanonicalTeacherWorkbench
      state={props.state}
      location={props.location}
      saveState={props.saveState}
      navigate={props.navigate}
    />
  );
  if (props.location.view === 'ops') return (
    <CanonicalOpsWorkbench
      state={props.state}
      location={props.location}
      saveState={props.saveState}
      navigate={props.navigate}
    />
  );
  if (props.location.view === 'class') return (
    <PublicClassTimetable
      state={props.state}
      grade={props.location.grade}
      className={props.location.className}
      course={props.location.course}
      today={todayOf(props.state)}
    />
  );
  /*
   * 못 닿는다는 것을 타입으로 잠근다. 위 세 갈래가 location 을 다 써 버려 여기서는
   * never 다. 갈래를 하나라도 빼거나 AppLocation 에 새 역할을 더하면서 여기를 안
   * 고치면 이 줄이 타입 검사에서 깨진다. 주석만 두면 조용히 거짓말이 된다.
   */
  const noRoleLeft: never = props.location;
  void noRoleLeft;
  return <LegacyWorkbench {...props} />;
}

export function Workbench() {
  const repositoryRef = useRef<WorkspaceRepository | null>(null);
  const workspaceRef = useRef<WorkspaceState | null>(null);
  const locationRef = useRef<AppLocation>({ view: 'landing' });
  const neisSession = useMemo(createNeisSession, []);
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [location, setLocation] = useState<AppLocation>({ view: 'landing' });
  const [neisKey, setNeisKey] = useState('');
  const [saveError, setSaveError] = useState('');

  const updateLocation = useCallback((next: AppLocation) => {
    if (locationRef.current.view === 'setup' && next.view !== 'setup') {
      neisSession.clear();
      setNeisKey('');
    }
    locationRef.current = next;
    setLocation(next);
    const workspaceId = workspaceIdOf(next);
    if (!workspaceId) return;
    if (workspaceRef.current?.workspace.id === workspaceId) return;
    const loaded = repositoryRef.current?.load(workspaceId) ?? null;
    workspaceRef.current = loaded;
    setState(loaded);
  }, [neisSession]);

  useEffect(() => {
    repositoryRef.current = createWorkspaceRepository(window.localStorage);
    const initial = parseLocation(window.location);
    updateLocation(initial);
    return subscribeToPopState(updateLocation);
  }, [updateLocation]);

  const saveState = useCallback((next: WorkspaceState): SaveResult => {
    const result = repositoryRef.current?.save(next) ?? { ok: false, reason: 'unavailable' as const };
    if (!result.ok) {
      setSaveError(result.reason === 'quota'
        ? '브라우저 저장 공간이 부족합니다. 요청을 저장하지 않았습니다. 진단 보고서를 내보내고 저장 공간을 확보한 뒤 다시 시도하십시오.'
        : '이 브라우저에 학교 자료를 저장할 수 없습니다. 요청을 저장하지 않았습니다. 진단 보고서를 내보낸 뒤 브라우저 저장 설정을 확인하십시오.');
      return result;
    }
    workspaceRef.current = next;
    setState(next);
    setSaveError('');
    return result;
  }, []);

  const navigate = useCallback((next: AppLocation) => {
    pushLocation(next);
    updateLocation(next);
  }, [updateLocation]);

  const sessionValue = useMemo(() => ({
    key: neisKey,
    setKey(next: string) {
      neisSession.setKey(next);
      setNeisKey(neisSession.getKey());
    },
    clear() {
      neisSession.clear();
      setNeisKey('');
    },
  }), [neisKey, neisSession]);

  return (
    <NeisSessionProvider value={sessionValue}>
      <RoleViewAdapterProvider adapter={RoleWorkbench}>
        {saveError && <div className="warn-bar" role="alert">{saveError}</div>}
        <AppShell state={state} location={location} saveState={saveState} navigate={navigate} />
      </RoleViewAdapterProvider>
    </NeisSessionProvider>
  );
}
