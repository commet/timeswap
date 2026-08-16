'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  coverCandidates,
  dayOf,
  recommend,
  slotName,
  validate,
  type Candidate,
  type CoverCandidate,
  type RecommendResult,
  type TimetableInput,
} from '@timeswap/engine';
import { Landing } from './Landing';
import { Grid } from './Grid';
import { Panel } from './Panel';
import { Changes } from './Changes';
import { Sheet } from './Sheet';
import {
  applyAll,
  buildPhrase,
  clearRaw,
  loadEntries,
  loadRaw,
  parseAndAdapt,
  saveEntries,
  saveRaw,
  SYNTH_MARK,
  TEACHER_KEY,
  type AppliedEntry,
  type Loaded,
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
  const [busy, setBusy] = useState(false);
  const [teacher, setTeacher] = useState<string | null>(null);
  const [entries, setEntries] = useState<AppliedEntry[]>([]);
  const [view, setView] = useState<'teacher' | 'klass'>('teacher');
  const [klass, setKlass] = useState<string | null>(null);
  const [queue, setQueue] = useState<number[]>([]);
  const [hovered, setHovered] = useState<Candidate | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [todayIdx, setTodayIdx] = useState<number | null>(null);

  useEffect(() => {
    const raw = loadRaw();
    if (raw) {
      try {
        const l = parseAndAdapt(raw, '업로드');
        setLoaded(l);
        setEntries(loadEntries());
        const saved = localStorage.getItem(TEACHER_KEY);
        setTeacher(saved ?? defaultTeacher(l.adapted.input));
      } catch {
        clearRaw();
      }
    }
    const wd = new Date().getDay(); // 일 0, 월 1
    setTodayIdx(wd >= 1 && wd <= 5 ? wd - 1 : null);
  }, []);

  const base = loaded?.adapted.input ?? null;
  const input = useMemo(() => (base ? applyAll(base, entries) : null), [base, entries]);

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
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  const applyRaw = useCallback(
    (raw: string, source: Loaded['source']) => {
      try {
        const l = parseAndAdapt(raw, source);
        setLoaded(l);
        saveRaw(raw);
        setEntries([]);
        saveEntries([]);
        setQueue([]);
        setHovered(null);
        setView('teacher');
        const t = defaultTeacher(l.adapted.input);
        setTeacher(t);
        if (t !== null) {
          try {
            localStorage.setItem(TEACHER_KEY, t);
          } catch {
            /* 무시 */
          }
        }
        show(`${l.adapted.schoolName} 시간표를 불러왔습니다`);
      } catch (e) {
        show(e instanceof Error ? e.message : '불러오기에 실패했습니다');
      }
    },
    [show],
  );

  const onSample = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetch('/sample.json');
      if (!r.ok) throw new Error('no sample file');
      applyRaw(await r.text(), '샘플');
    } catch {
      // 샘플 파일이 없는 배포 환경에서는 합성 시범 학교로 대신한다
      applyRaw(SYNTH_MARK, '샘플');
    } finally {
      setBusy(false);
    }
  }, [applyRaw]);

  const onFile = useCallback(
    (f: File) => {
      const reader = new FileReader();
      reader.onload = () => applyRaw(String(reader.result), '업로드');
      reader.onerror = () => show('파일을 읽지 못했습니다');
      reader.readAsText(f);
    },
    [applyRaw, show],
  );

  const onToggleSlot = useCallback((s: number) => {
    setHovered(null);
    setQueue((q) => (q.includes(s) ? q.filter((x) => x !== s) : [...q, s]));
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

  const onSkip = useCallback(() => {
    setHovered(null);
    setQueue((q) => (q.length > 1 ? [...q.slice(1), q[0]!] : []));
  }, []);

  const onCopy = useCallback(
    async (c: Candidate) => {
      if (!input) return;
      const text = buildPhrase(c, input.config, slotName);
      try {
        await navigator.clipboard.writeText(text);
        show('요청 문구를 복사했습니다');
      } catch {
        show('복사하지 못했습니다. 브라우저 권한을 확인하십시오');
      }
    },
    [input, show],
  );

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
            {loaded.adapted.schoolName} | {loaded.source}
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
              <select
                id="teacher-select"
                className="select"
                aria-label="교사 선택"
                value={currentTeacher}
                onChange={(e) => {
                  setTeacher(e.target.value);
                  setQueue([]);
                  setHovered(null);
                  try {
                    localStorage.setItem(TEACHER_KEY, e.target.value);
                  } catch {
                    /* 무시 */
                  }
                }}
              >
                {teachers.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({t.n})
                  </option>
                ))}
              </select>
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
            <button className="btn ghost" onClick={onReset}>
              데이터 지우기
            </button>
          </>
        )}
      </header>

      {!loaded || !input ? (
        <Landing onSample={onSample} onFile={onFile} busy={busy} />
      ) : (
        <main className="work">
          <Grid
            cfg={input.config}
            mode={view}
            owner={(view === 'teacher' ? currentTeacher : currentKlass) ?? ''}
            lessons={lessons}
            absentSlots={queue}
            todayIdx={todayIdx}
            preview={hovered}
            onToggleSlot={onToggleSlot}
            onToggleDay={onToggleDay}
          />
          <div className="side">
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
              onUndoLast={onUndoLast}
              onPrint={onPrint}
            />
          </div>
        </main>
      )}

      {loaded && input && (
        <Sheet schoolName={loaded.adapted.schoolName} cfg={input.config} entries={entries} />
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
