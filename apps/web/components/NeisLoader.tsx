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
import { mapKey, type TeacherMap } from '../lib/app';

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
        const rep = fromNeis(tt.rows);
        setSchool(picked);
        setRows(tt.rows);
        setEvents(sch);
        setRange(range);
        setReport(rep);
        setStage('배정');
        if (tt.truncated) {
          setError(
            '인증키가 없어 일부만 받았습니다. 학교 전체를 받으려면 무료 인증키를 입력하십시오.',
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '시간표를 받지 못했습니다');
      } finally {
        setBusy('');
      }
    },
    [neisKey],
  );

  /** 교사를 채워야 할 (학급, 과목) 목록 */
  const pairs = useMemo(() => {
    if (!report) return [] as Array<{ klass: string; subject: string }>;
    const set = new Set<string>();
    for (const [key, subject] of report.base) {
      const klass = key.split('|')[0];
      if (klass) set.add(mapKey(klass, subject));
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

        <label className="neis-field">
          <span>
            인증키 (선택)
            <a className="neis-link" href={NEIS_KEY_GUIDE} target="_blank" rel="noreferrer">
              무료 발급 안내
            </a>
          </span>
          <input
            className="input"
            placeholder="없어도 일부는 볼 수 있습니다. 학교 전체를 받으려면 입력하십시오"
            value={neisKey}
            onChange={(e) => onKeyChange(e.target.value.trim())}
          />
          <span className="neis-hint">
            나이스 공개 자료는 무료입니다. 인증키는 요금이 아니라 이용량을 구분하기 위한 것이며,
            발급도 무료입니다. 입력한 키는 이 브라우저에만 저장하고 나이스에만 보냅니다.
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
          최근 5주 시간표를 받았습니다. 휴업일 {report.holidays.length}일과 보강{' '}
          {report.covers.length}건이 들어 있습니다.
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
              return (
                <label key={k} className="map-row">
                  <span className="map-subject">{p.subject}</span>
                  <input
                    className="input"
                    list="known-teachers"
                    placeholder="교사 이름"
                    value={map[k] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMap((m) => {
                        const next = { ...m };
                        if (v.trim()) next[k] = v.trim();
                        else delete next[k];
                        return next;
                      });
                    }}
                  />
                </label>
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
