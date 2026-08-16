'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  recommend,
  slotName,
  type Candidate,
  type RecommendResult,
  type TimetableInput,
} from '@timeswap/engine';
import { Landing } from './Landing';
import { Grid } from './Grid';
import { Panel } from './Panel';
import {
  buildPhrase,
  clearRaw,
  loadRaw,
  parseAndAdapt,
  saveRaw,
  SYNTH_MARK,
  TEACHER_KEY,
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
  const [absentSlot, setAbsentSlot] = useState<number | null>(null);
  const [hovered, setHovered] = useState<Candidate | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const raw = loadRaw();
    if (!raw) return;
    try {
      const l = parseAndAdapt(raw, '업로드');
      setLoaded(l);
      const saved = localStorage.getItem(TEACHER_KEY);
      setTeacher(saved ?? defaultTeacher(l.adapted.input));
    } catch {
      clearRaw();
    }
  }, []);

  const input = loaded?.adapted.input ?? null;

  const teachers = useMemo(() => {
    if (!input) return [] as Array<{ name: string; n: number }>;
    const count = new Map<string, number>();
    for (const a of input.assignments) count.set(a.teacher, (count.get(a.teacher) ?? 0) + 1);
    return [...count.entries()]
      .sort((x, y) => x[0].localeCompare(y[0], 'ko'))
      .map(([name, n]) => ({ name, n }));
  }, [input]);

  const currentTeacher =
    teacher !== null && teachers.some((t) => t.name === teacher)
      ? teacher
      : (teachers[0]?.name ?? null);

  const lessons = useMemo(
    () =>
      input && currentTeacher !== null
        ? input.assignments.filter((a) => a.teacher === currentTeacher)
        : [],
    [input, currentTeacher],
  );

  const result: RecommendResult | null = useMemo(() => {
    if (!input || currentTeacher === null || absentSlot === null) return null;
    try {
      return recommend(input, { teacher: currentTeacher, slot: absentSlot }, { max: 12 });
    } catch {
      return null;
    }
  }, [input, currentTeacher, absentSlot]);

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
        setAbsentSlot(null);
        setHovered(null);
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
  }, [applyRaw, show]);

  const onFile = useCallback(
    (f: File) => {
      const reader = new FileReader();
      reader.onload = () => applyRaw(String(reader.result), '업로드');
      reader.onerror = () => show('파일을 읽지 못했습니다');
      reader.readAsText(f);
    },
    [applyRaw, show],
  );

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

  const onReset = useCallback(() => {
    clearRaw();
    setLoaded(null);
    setTeacher(null);
    setAbsentSlot(null);
    setHovered(null);
  }, []);

  return (
    <div className="shell">
      <header className="topbar">
        <span className="wordmark">
          <span className="tick" aria-hidden />
          바꿈표
          <span className="beta">베타</span>
        </span>
        {loaded && (
          <span className="school-chip">
            {loaded.adapted.schoolName} | {loaded.source}
          </span>
        )}
        <span className="spacer" />
        {loaded && input && currentTeacher !== null && (
          <>
            <label htmlFor="teacher-select" style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 700 }}>
              교사
            </label>
            <select
              id="teacher-select"
              className="select"
              value={currentTeacher}
              onChange={(e) => {
                setTeacher(e.target.value);
                setAbsentSlot(null);
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
            <button className="btn ghost" onClick={onReset}>
              데이터 지우기
            </button>
          </>
        )}
      </header>

      {!loaded || !input || currentTeacher === null ? (
        <Landing onSample={onSample} onFile={onFile} busy={busy} />
      ) : (
        <main className="work">
          <Grid
            cfg={input.config}
            teacher={currentTeacher}
            lessons={lessons}
            absentSlot={absentSlot}
            preview={hovered}
            onSelect={(s) => {
              setAbsentSlot(s);
              setHovered(null);
            }}
          />
          <Panel
            cfg={input.config}
            result={result}
            hovered={hovered}
            onHover={setHovered}
            onCopy={onCopy}
          />
        </main>
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
