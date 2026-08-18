'use client';

import { useCallback, useState } from 'react';
import { fromNeis } from '@timeswap/engine';

import type { NeisLoadBundle } from './SetupFlow';
import {
  findRecentTeachingWeek,
  loadSchedule,
  recentRange,
  searchSchools,
  NEIS_KEY_GUIDE,
  type NeisSchool,
} from '../lib/neis';

interface Props {
  mode: 'school' | 'key' | 'load';
  neisKey: string;
  school: NeisSchool | null;
  onKeyChange(key: string): void;
  onSchoolChange(school: NeisSchool): void;
  onLoaded(bundle: NeisLoadBundle): void;
  onContinue?(): void;
}

export function NeisLoader({
  mode,
  neisKey,
  school,
  onKeyChange,
  onSchoolChange,
  onLoaded,
  onContinue,
}: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<NeisSchool[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const search = useCallback(async () => {
    setError('');
    setBusy('학교를 찾는 중입니다');
    try {
      const found = await searchSchools(query, neisKey || undefined);
      setHits(found);
      if (found.length === 0) setError('그 이름의 학교를 찾지 못했습니다. 정식 학교명으로 다시 찾아보십시오.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '학교를 찾지 못했습니다. 잠시 뒤 다시 시도하십시오.');
    } finally {
      setBusy('');
    }
  }, [neisKey, query]);

  const load = useCallback(async () => {
    if (!school || !neisKey) return;
    setError('');
    setBusy(`${school.name}의 최근 수업 주를 확인하고 있습니다`);
    try {
      const searchWindow = recentRange(5);
      const timetable = await findRecentTeachingWeek({
        school,
        from: searchWindow.from,
        to: searchWindow.to,
        key: neisKey,
      });
      const schedule = await loadSchedule({
        school,
        from: timetable.range.from,
        to: timetable.range.to,
        key: neisKey,
      }).catch(() => null);
      const { rows, range, ...result } = timetable;
      onLoaded({
        school,
        rows,
        events: schedule?.rows ?? [],
        range,
        result,
        report: fromNeis(rows),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '공식 시간표를 불러오지 못했습니다.');
    } finally {
      setBusy('');
    }
  }, [neisKey, onLoaded, school]);

  if (mode === 'school') return (
    <section className="neis setup-source" aria-labelledby="school-search-title">
      <span className="eyebrow">1단계</span>
      <h2 id="school-search-title">학교 검색</h2>
      <p className="neis-lede">학교명을 검색해 공식 학교 코드와 학교급을 확인합니다.</p>
      <label className="neis-field">
        <span>학교 이름</span>
        <div className="neis-row">
          <input
            className="input"
            autoComplete="organization"
            placeholder="예: 수지고등학교"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') void search(); }}
          />
          <button className="btn primary" disabled={!query.trim() || Boolean(busy)} onClick={() => void search()}>학교 찾기</button>
        </div>
      </label>
      {busy && <p className="neis-busy" role="status">{busy}</p>}
      {error && <p className="neis-error" role="alert">{error}</p>}
      {hits.length > 0 && (
        <ul className="neis-hits">
          {hits.map((hit) => (
            <li key={`${hit.office}-${hit.code}`}>
              <button onClick={() => onSchoolChange(hit)}>
                <span className="hit-name">{hit.name}</span>
                <span className="hit-meta">{hit.officeName} · {hit.kind}{hit.preview ? ' · 검색 미리보기' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  if (mode === 'key') return (
    <section className="neis setup-source" aria-labelledby="session-key-title">
      <span className="eyebrow">2단계 · {school?.name}</span>
      <h2 id="session-key-title">이번 설정에만 쓸 인증키</h2>
      <p className="neis-lede">키는 이 탭의 메모리에만 두고, 설정을 마치거나 나가면 바로 지웁니다.</p>
      <label className="neis-field">
        <span>나이스 교육정보 개방 포털 인증키</span>
        <input
          className="input"
          type="password"
          autoComplete="off"
          placeholder="인증키를 붙여 넣으십시오"
          value={neisKey}
          onChange={(event) => onKeyChange(event.target.value.trim())}
        />
        <small className="neis-hint">
          키가 없으면 공식 API가 일부 행만 보내므로 설정을 완료할 수 없습니다.{' '}
          <a className="neis-link" href={NEIS_KEY_GUIDE} target="_blank" rel="noreferrer">공식 포털에서 인증키 받기</a>
        </small>
      </label>
      <div className="setup-actions">
        <button className="btn primary" disabled={!neisKey} onClick={onContinue}>공식 자료 불러오기로 계속</button>
      </div>
    </section>
  );

  return (
    <section className="neis setup-source" aria-labelledby="official-load-title">
      <span className="eyebrow">3단계</span>
      <h2 id="official-load-title">{school?.name} 공식 자료 불러오기</h2>
      <p className="neis-lede">
        최근 5주를 하나로 합치지 않습니다. 그 안에서 수업이 있는 가장 최근의 월요일–금요일 한 주를 골라 그대로 저장합니다.
      </p>
      <button className="btn primary load-official" disabled={!school || !neisKey || Boolean(busy)} onClick={() => void load()}>
        {busy || '최근 수업 주 불러오기'}
      </button>
      {busy && <p className="neis-busy" role="status">공식 페이지 전체를 확인하는 중입니다.</p>}
      {error && <p className="neis-error" role="alert">{error}</p>}
    </section>
  );
}
