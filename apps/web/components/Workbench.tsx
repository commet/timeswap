'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  coverCandidates,
  dayOf,
  recommend,
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
import type { NeisEvent, NeisSchool } from '../lib/neis';
import { BRAND } from '../lib/brand';
import {
  applyAll,
  applyTheme,
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
  loadRaw,
  loadTheme,
  loadUnavail,
  sampleSchool,
  saveEntries,
  saveNeisKey,
  saveRaw,
  saveUnavail,
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
    setTheme(loadTheme());
    const wd = new Date().getDay(); // 일 0, 월 1
    setTodayIdx(wd >= 1 && wd <= 5 ? wd - 1 : null);
  }, []);

  const base = loaded?.input ?? null;

  /**
   * 이번 주 휴업일. 나이스 학사일정에서 온다.
   * 시간표는 되풀이되는 한 주지만 학사일정은 날짜라 이번 주에 걸리는 것만 요일로 옮긴다.
   */
  const closures = useMemo(() => {
    const cal = loaded?.calendar;
    if (!cal || cal.events.length === 0 || !base) return [];
    if (!calendarCoversThisWeek(cal)) return [];
    const ks = [...new Set(base.assignments.map((a) => a.klass))];
    return buildClosures(cal.events, ks);
  }, [loaded, base]);

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

  const cover: CoverCandidate[] | null = useMemo(() => {
    if (!input || !result || result.candidates.length > 0) return null;
    return coverCandidates(input, result.target.slot, result.target.subject, 8, currentTeacher ?? undefined);
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
      setQueue([]);
      setUnavail({});
      saveUnavail({});
      setHovered(null);
      setView('teacher');
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

  const onReset = useCallback(() => {
    clearRaw();
    setLoaded(null);
    setTeacher(null);
    setEntries([]);
    setKlass(null);
    setView('teacher');
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
        <span className="spacer" />
        {loaded && input && !atHome && !needsPick && (
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
      ) : (
        <main className="work">
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
          />
          <div className="side" ref={sideRef}>
            <Panel
              cfg={input.config}
              result={result}
              queueLen={queue.length}
              cover={cover}
              hovered={hovered}
              onHover={setHovered}
              onCopy={onCopy}
              onCopyCover={onCopyCover}
              onApply={onApply}
              onSkip={onSkip}
            />
            <Changes
              cfg={input.config}
              entries={entries}
              helpers={helpers}
              onUndoLast={onUndoLast}
              onUndoAll={onUndoAll}
              onCopyNotice={onCopyNotice}
              onCopyNeisList={onCopyNeisList}
              onPrint={onPrint}
              reason={reason}
              onReason={onReason}
            />
          </div>
        </main>
      )}

      {loaded && input && (
        <Sheet
          schoolName={loaded.schoolName}
          cfg={input.config}
          entries={entries}
          teacher={currentTeacher ?? ''}
          reason={reason}
        />
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
