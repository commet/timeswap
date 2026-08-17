'use client';

import { useCallback, useMemo, useState } from 'react';
import { fromNeis, type NeisReport, type NeisRow } from '@timeswap/engine';
import {
  loadSchedule,
  loadTimetable,
  recentRange,
  searchSchools,
  NEIS_KEY_GUIDE,
  type NeisEvent,
  type NeisSchool,
} from '../lib/neis';
import { gradeOf, mapKey, normalizeName, sameGradeSubject, type TeacherMap } from '../lib/app';

type Stage = '검색' | '배정';


interface Props {
  neisKey: string;
  onKeyChange: (key: string) => void;
  onDone: (
    school: NeisSchool,
    rows: NeisRow[],
    events: NeisEvent[],
    map: TeacherMap,
    range: { from: string; to: string },
  ) => void;
  onCancel: () => void;
}

export function NeisLoader({ neisKey, onKeyChange, onDone, onCancel }: Props) {
  const [stage, setStage] = useState<Stage>('검색');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<NeisSchool[] | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const [school, setSchool] = useState<NeisSchool | null>(null);
  const [rows, setRows] = useState<NeisRow[]>([]);
  const [events, setEvents] = useState<NeisEvent[]>([]);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [report, setReport] = useState<NeisReport | null>(null);
  const [map, setMap] = useState<TeacherMap>({});
  const [filter, setFilter] = useState('');

  const onSearch = useCallback(async () => {
    setError('');
    setBusy('학교를 찾는 중');
    try {
      const found = await searchSchools(query, neisKey || undefined);
      setHits(found);
      if (found.length === 0) setError('그 이름의 학교를 찾지 못했습니다. 정식 이름으로 찾아 주십시오.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '학교 검색에 실패했습니다');
    } finally {
      setBusy('');
    }
  }, [query, neisKey]);

  const onPick = useCallback(
    async (picked: NeisSchool) => {
      setError('');
      setBusy(`${picked.name} 시간표를 받는 중`);
      try {
        const range = recentRange(5);
        const [tt, sch] = await Promise.all([
          loadTimetable({ school: picked, from: range.from, to: range.to, key: neisKey || undefined }),
          loadSchedule({ school: picked, from: range.from, to: range.to, key: neisKey || undefined }).catch(
            () => [] as NeisEvent[],
          ),
        ]);
        if (tt.rows.length === 0) {
          setError('그 기간의 시간표가 아직 공개되지 않았습니다. 학교에 시간표가 올라간 뒤 다시 시도해 주십시오.');
          return;
        }
        /*
         * 잘린 자료로는 다음 단계로 보내지 않는다.
         *
         * 키가 없으면 학교 전체 질의에 5행만 온다. 5주치 학교 하나가 수천 행인데 5행이다.
         * 그것으로 만든 시간표는 거의 다 빈 시간이고, 빈 시간은 "옮겨도 되는 자리"로 읽힌다.
         * 그러면 성립하지 않는 교체를 잔뜩 내놓는다. 경고만 띄우고 통과시키면
         * 사용자는 그 경고를 지나치고 틀린 안을 받는다.
         *
         * 그래서 여기서 멈추고 무엇이 필요한지 숫자로 알린다.
         */
        if (tt.truncated) {
          setError(
            `나이스가 ${tt.total.toLocaleString()}줄 가운데 ${tt.rows.length}줄만 보냈습니다. ` +
              '인증키 없는 요청은 5줄에서 끊기고 쪽 넘김도 되지 않습니다. ' +
              '이 상태로 만든 시간표는 대부분이 빈 시간이 되어, 실제로는 수업이 있는 자리로 ' +
              '옮기라는 안이 나옵니다. 아래에 무료 인증키를 넣고 다시 찾아 주십시오.',
          );
          return;
        }
        const rep = fromNeis(tt.rows);
        setSchool(picked);
        setRows(tt.rows);
        setEvents(sch);
        setRange(range);
        setReport(rep);
        setStage('배정');
      } catch (e) {
        setError(e instanceof Error ? e.message : '시간표를 받지 못했습니다');
      } finally {
        setBusy('');
      }
    },
    [neisKey],
  );

  /**
   * 받은 자료가 어디까지 덮는지.
   *
   * 이것을 보여 주지 않으면 사용자는 받은 것이 온전한지 알 수 없다.
   * 실제로 어떤 학교 자료에서 수요일이 통째로 빠진 채 들어왔고, 그 요일이 빈 시간으로
   * 보여 추천안 488개 가운데 21개가 수요일로 옮기라고 했다. 화면에 아무 표시도 없었다.
   */
  const coverage = useMemo(() => {
    const names = ['월', '화', '수', '목', '금'];
    if (!report) {
      return { klasses: 0, periods: 0, dayNames: '', missingDays: [] as string[] };
    }
    const lessons = report.cells.filter((c) => c.kind === '수업');
    const seen = new Set(lessons.map((c) => c.day));
    return {
      klasses: new Set(lessons.map((c) => c.klass)).size,
      periods: report.config.periods,
      dayNames: names.filter((_, i) => seen.has(i)).join(''),
      missingDays: names.filter((_, i) => i < report.config.days && !seen.has(i)),
    };
  }, [report]);

  /** 교사를 채워야 할 (학급, 과목) 목록 */
  const pairs = useMemo(() => {
    if (!report) return [] as Array<{ klass: string; subject: string }>;
    const set = new Set<string>();
    for (const [key, subjects] of report.base) {
      const klass = key.split('|')[0];
      if (klass) for (const subject of subjects) set.add(mapKey(klass, subject));
    }
    return [...set]
      .map((k) => {
        const [klass, subject] = k.split('|');
        return { klass: klass ?? '', subject: subject ?? '' };
      })
      .sort(
        (a, b) =>
          a.klass.localeCompare(b.klass, 'ko', { numeric: true }) ||
          a.subject.localeCompare(b.subject, 'ko'),
      );
  }, [report]);

  const filled = pairs.filter((p) => map[mapKey(p.klass, p.subject)]).length;
  const knownTeachers = useMemo(
    () => [...new Set(Object.values(map).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko')),
    [map],
  );
  const shown = pairs.filter(
    (p) => !filter || p.klass.includes(filter) || p.subject.includes(filter),
  );

  const byKlass = useMemo(() => {
    const m = new Map<string, typeof shown>();
    for (const p of shown) m.set(p.klass, [...(m.get(p.klass) ?? []), p]);
    return [...m.entries()];
  }, [shown]);

  if (stage === '검색') {
    return (
      <div className="neis">
        <div className="neis-head">
          <h2>나이스에서 시간표 불러오기</h2>
          <button className="btn ghost" onClick={onCancel}>
            닫기
          </button>
        </div>
        <p className="neis-lede">
          나이스 교육정보 개방 포털이 공개하는 학교 시간표를 그대로 받아 옵니다. 학교가 올린 그날
          시간표라 학기 중에 바뀐 내용과 보강도 함께 들어 있습니다.
        </p>

        <label className="neis-field">
          <span>학교 이름</span>
          <div className="neis-row">
            <input
              className="input"
              placeholder="예: 수지고등학교"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onSearch();
              }}
            />
            <button className="btn primary" onClick={() => void onSearch()} disabled={busy !== ''}>
              찾기
            </button>
          </div>
        </label>

        {/*
         * 이 자리를 "선택" 으로 적어 두었던 것이 잘못이었다.
         * 키가 없으면 나이스가 학교 전체 질의에 5행만 준다. 쪽 넘김도 듣지 않는다.
         * 실측에서 어떤 학급의 하루가 6교시인데 5행에서 끊겼다.
         * 학교 하나를 받아 교체를 찾는 일은 키 없이 되지 않는다.
         * 선택이라고 적으면 안 넣고 진행했다가 빈 시간표를 보고 도구를 접는다.
         */}
        <label className="neis-field">
          <span>
            인증키
            {neisKey === '' ? (
              <b className="neis-need">한 번만 넣으면 됩니다</b>
            ) : (
              <b className="neis-ok">저장됨</b>
            )}
          </span>
          <input
            className="input"
            placeholder="나이스에서 받은 인증키를 붙여 넣으십시오"
            value={neisKey}
            onChange={(e) => onKeyChange(e.target.value.trim())}
          />
          <span className="neis-hint">
            나이스는 키 없는 요청에 <b>5줄만</b> 보냅니다. 학교 하나를 받으려면 키가 필요합니다.{' '}
            <a className="neis-link" href={NEIS_KEY_GUIDE} target="_blank" rel="noreferrer">
              무료로 받는 곳
            </a>
            <br />
            발급은 무료이고 넣은 키는 이 브라우저에만 저장하며 나이스에만 보냅니다. 다음에 오시면
            다시 넣지 않아도 됩니다.
          </span>
        </label>

        {busy && <p className="neis-busy">{busy}</p>}
        {error && <p className="neis-error">{error}</p>}

        {hits && hits.length > 0 && (
          <ul className="neis-hits">
            {hits.map((s) => (
              <li key={`${s.office}-${s.code}`}>
                <button onClick={() => void onPick(s)} disabled={busy !== ''}>
                  <span className="hit-name">{s.name}</span>
                  <span className="hit-meta">
                    {s.officeName} | {s.kind}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="neis">
      <div className="neis-head">
        <h2>{school?.name} 교사 배정</h2>
        <button className="btn ghost" onClick={() => setStage('검색')}>
          학교 다시 고르기
        </button>
      </div>
      <p className="neis-lede">
        나이스 공개 자료에는 과목만 있고 담당 교사는 없습니다. 교체 방법을 찾으려면 누가 그 수업에
        들어가는지가 필요합니다. 아시는 것부터 채우십시오. 중간에 멈추어도 채운 만큼은 그대로
        쓸 수 있습니다.
      </p>

      <div className="neis-progress">
        <div className="bar">
          <span style={{ width: `${pairs.length ? (filled / pairs.length) * 100 : 0}%` }} />
        </div>
        <span className="neis-count">
          {pairs.length}개 중 {filled}개 입력
        </span>
      </div>

      {report && (
        <p className="neis-facts">
          최근 5주 시간표를 받았습니다. 학급 {coverage.klasses}개, {coverage.dayNames} 요일,{' '}
          {coverage.periods}교시까지입니다. 휴업일 {report.holidays.length}일과 보강{' '}
          {report.covers.length}건이 들어 있습니다.
          {coverage.missingDays.length > 0 && (
            <>
              {' '}
              <b className="neis-warn">
                {coverage.missingDays.join(', ')} 요일은 자료에 없습니다. 그 요일로 옮기는 안은
                내지 않습니다. 기간을 넓혀 다시 받으시면 채워집니다.
              </b>
            </>
          )}
        </p>
      )}
      {error && <p className="neis-error">{error}</p>}

      <input
        className="input neis-filter"
        placeholder="학급이나 과목으로 좁혀 찾기"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />

      <datalist id="known-teachers">
        {knownTeachers.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div className="neis-map">
        {byKlass.map(([klass, list]) => (
          <section key={klass}>
            <h3>{klass}</h3>
            {list.map((p) => {
              const k = mapKey(p.klass, p.subject);
              const name = map[k] ?? '';
              const spread = name ? sameGradeSubject(pairs, map, p.klass, p.subject) : [];
              return (
                <div key={k} className="map-row">
                  <span className="map-subject">{p.subject}</span>
                  <input
                    className="input"
                    list="known-teachers"
                    placeholder="교사 이름"
                    aria-label={`${p.klass} ${p.subject} 담당 교사`}
                    value={name}
                    onChange={(e) => {
                      const v = normalizeName(e.target.value);
                      setMap((m) => {
                        const next = { ...m };
                        if (v) next[k] = v;
                        else delete next[k];
                        return next;
                      });
                    }}
                  />
                  {spread.length > 0 && (
                    <button
                      className="btn map-spread"
                      title="같은 학년의 같은 과목에 이 이름을 한 번에 채웁니다"
                      onClick={() => {
                        setMap((m) => {
                          const next = { ...m };
                          for (const q of spread) next[mapKey(q.klass, q.subject)] = name;
                          return next;
                        });
                      }}
                    >
                      같은 학년 {spread.length}곳에도
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        ))}
      </div>

      <div className="neis-foot">
        <button
          className="btn primary"
          disabled={filled === 0 || !school || !range}
          onClick={() => school && range && onDone(school, rows, events, map, range)}
        >
          이 시간표로 시작하기
        </button>
        <button className="btn ghost" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}
