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
import { NeisLoader } from './NeisLoader';
import type { NeisEvent, NeisSchool } from '../lib/neis';
import {
  applyAll,
  applyTheme,
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
  const [neisKey, setNeisKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [teacher, setTeacher] = useState<string | null>(null);
  const [teacherInput, setTeacherInput] = useState('');
  const [entries, setEntries] = useState<AppliedEntry[]>([]);
  const [view, setView] = useState<'teacher' | 'klass'>('teacher');
  const [klass, setKlass] = useState<string | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [unavail, setUnavail] = useState<Record<string, number[]>>({});
  const [hovered, setHovered] = useState<Candidate | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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
  const input = useMemo(() => {
    if (!base) return null;
    const applied = applyAll(base, entries);
    // 근무 불가와 품앗이 부담은 저장된 상태에서 매번 다시 만든다.
    return { ...applied, unavailable: unavail, recentBurden: deriveBurden(entries) };
  }, [base, entries, unavail]);

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
    return coverCandidates(input, result.target.slot, result.target.subject);
  }, [input, result]);

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
        show('복사하지 못했습니다. 브라우저 권한을 확인하십시오');
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
      saveRaw(toFile(l));
      setEntries([]);
      saveEntries([]);
      setQueue([]);
      setUnavail({});
      saveUnavail({});
      setHovered(null);
      setView('teacher');
      const t = defaultTeacher(l.input);
      setTeacher(t);
      if (t !== null) {
        try {
          localStorage.setItem(TEACHER_KEY, t);
        } catch {
          /* 무시 */
        }
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
    (school: NeisSchool, rows: NeisRow[], events: NeisEvent[], map: TeacherMap) => {
      const l = buildFromNeis(school, rows, events, map);
      if (l.input.assignments.length === 0) {
        show('교사를 한 명도 배정하지 않아 시간표를 만들 수 없습니다');
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
    a.click();
    URL.revokeObjectURL(url);
    show('시간표를 파일로 저장했습니다');
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

  const onCopyNotice = useCallback(() => {
    if (!input || !loaded || entries.length === 0) return;
    void copy(buildNotice(loaded.schoolName, entries, input.config), '변경 공지를 복사했습니다');
  }, [input, loaded, entries, copy]);

  const onCopyNeisList = useCallback(() => {
    if (!input || !loaded || entries.length === 0) return;
    void copy(
      buildNeisList(loaded.schoolName, entries, input.config),
      '나이스 입력용 목록을 복사했습니다',
    );
  }, [input, loaded, entries, copy]);

  const onApply = useCallback(
    (c: Candidate) => {
      if (!input) return;
      const after = applyAll(input, [{ id: 0, type: c.type, title: c.title, changes: c.changes }]);
      if (validate(after).length > 0) {
        show('이 변경은 현재 시간표와 충돌합니다. 다른 방법을 고르십시오');
        return;
      }
      const nextId = (entries[entries.length - 1]?.id ?? 0) + 1;
      const next = [...entries, { id: nextId, type: c.type, title: c.title, changes: c.changes }];
      setEntries(next);
      saveEntries(next);
      setHovered(null);
      setQueue((q) => {
        const rest = q.slice(1);
        show(
          rest.length > 0
            ? `시간표에 반영했습니다. 남은 결강 ${rest.length}건`
            : '시간표에 반영하고 오늘의 변경에 기록했습니다',
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
    show('마지막 변경을 되돌렸습니다');
  }, [entries, show]);

  const onUndoAll = useCallback(() => {
    if (entries.length === 0) return;
    if (!window.confirm('오늘 반영한 변경을 모두 되돌립니까?')) return;
    setEntries([]);
    saveEntries([]);
    setQueue([]);
    setHovered(null);
    show('반영한 변경을 모두 되돌렸습니다');
  }, [entries, show]);

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
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">
          <span className="tick" aria-hidden />
          수업품앗이
          <span className="beta">베타</span>
        </span>
        {loaded && (
          <span className="school-chip">
            {loaded.schoolName} | {loaded.source}
          </span>
        )}
        <span className="spacer" />
        {loaded && input && (
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
                  aria-label="교사 검색 선택"
                  placeholder="교사 이름 검색"
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
        {loaded && input && (
          <>
            <button className="btn ghost" onClick={onSaveFile}>
              파일로 저장
            </button>
            <button className="btn ghost" onClick={onReset}>
              데이터 지우기
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
      ) : !loaded || !input ? (
        <Landing
          onNeis={() => setShowNeis(true)}
          onSample={onSample}
          onFile={onFile}
          busy={busy}
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
            />
          </div>
        </main>
      )}

      {loaded && input && (
        <Sheet schoolName={loaded.schoolName} cfg={input.config} entries={entries} />
      )}

      <footer className="foot">
        <span>시간표는 이 브라우저 안에만 저장됩니다. 서버로 보내지 않습니다.</span>
        <span>추천은 참고용이며, 확정은 학교 결재 절차를 따르십시오.</span>
      </footer>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
    </div>
  );
}
