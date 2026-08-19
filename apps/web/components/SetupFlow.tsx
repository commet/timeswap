'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { NeisReport, NeisRow } from '@timeswap/engine';

import { DataHealthPanel } from './DataHealthPanel';
import { NeisLoader } from './NeisLoader';
import { fromFile, mapKey, normalizeName, type TeacherMap } from '../lib/app';
import type { WorkspaceState } from '../lib/domain';
import { formatLocation, type AppLocation } from '../lib/navigation';
import type { CompleteNeisResult, NeisEvent, NeisSchool } from '../lib/neis';
import type { SaveResult } from '../lib/repository';

export interface NeisLoadBundle {
  school: NeisSchool;
  rows: NeisRow[];
  events: NeisEvent[];
  range: { from: string; to: string };
  result: Omit<CompleteNeisResult<NeisRow>, 'rows'>;
  report: NeisReport;
}

export interface NeisSessionValue {
  key: string;
  setKey(next: string): void;
  clear(): void;
}

const NeisSessionContext = createContext<NeisSessionValue>({
  key: '', setKey: () => undefined, clear: () => undefined,
});

export function NeisSessionProvider({ value, children }: { value: NeisSessionValue; children: ReactNode }) {
  return <NeisSessionContext.Provider value={value}>{children}</NeisSessionContext.Provider>;
}

export const SETUP_STAGES = [
  '학교 검색', '세션 인증키', '공식 자료 불러오기', '완전성 확인',
  '교사 연결', '미해결 검토', '초대 링크',
] as const;

type SetupStage = (typeof SETUP_STAGES)[number];

export function canEnterSetupStage(stage: SetupStage, state: {
  hasSchool: boolean;
  hasSessionKey: boolean;
  hasBundle: boolean;
  sourceComplete: boolean;
  invitationsReady: boolean;
}): boolean {
  if (stage === '학교 검색') return true;
  if (stage === '세션 인증키') return state.hasSchool;
  if (stage === '공식 자료 불러오기') return state.hasSchool && state.hasSessionKey;
  if (stage === '완전성 확인') return state.hasBundle;
  if (stage === '교사 연결' || stage === '미해결 검토') {
    return state.hasBundle && state.sourceComplete;
  }
  return state.invitationsReady;
}

const isoDate = (value: string): string =>
  value.length === 8 ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
const classLabel = (grade: string, className: string): string => `${grade}-${className}`;
const pairKey = (classKey: string, subject: string): string => JSON.stringify([classKey, subject]);

function memberIdFor(workspaceId: string, teacherReference: string): string {
  let hash = 0xcbf29ce484222325n;
  const source = `${workspaceId}\u0000${normalizeName(teacherReference)}`;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= BigInt(source.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `member:${hash.toString(16).padStart(16, '0')}`;
}

export function createWorkspaceFromNeis(
  bundle: NeisLoadBundle,
  teacherMap: TeacherMap,
  now = new Date().toISOString(),
): WorkspaceState {
  const workspaceId = bundle.school.code;
  const revisionId = `${workspaceId}:revision:${bundle.range.from}-${bundle.range.to}`;
  const normalization = bundle.report.normalization;
  const groupByRow = new Map(normalization.parallelGroups.flatMap((group, index) =>
    group.rowIds.map((rowId) => [rowId, `${revisionId}:parallel:${index + 1}`] as const)));
  const teacherLabels: Record<string, string> = {};
  const lessons = normalization.accepted.map((row) => {
    const label = classLabel(row.classIdentity.grade, row.classIdentity.className);
    const teacherReference = teacherMap[mapKey(row.classKey, row.subject)]
      ?? teacherMap[mapKey(label, row.subject)];
    const teacherId = teacherReference
      ? memberIdFor(workspaceId, teacherReference)
      : null;
    if (teacherId && teacherReference) teacherLabels[teacherId] = teacherReference;
    return {
      id: `${revisionId}:lesson:${row.id}`,
      workspaceId,
      revisionId,
      date: isoDate(row.date),
      period: row.period,
      classIdentity: { ...row.classIdentity },
      subject: row.subject,
      room: row.room,
      teacher: teacherId
        ? { state: 'assigned' as const, teacherId }
        : { state: 'unassigned' as const },
      ...(groupByRow.has(row.id) ? { parallelGroupId: groupByRow.get(row.id)! } : {}),
    };
  });
  const knownClasses = [...new Map(lessons.map((lesson) => [
    JSON.stringify(lesson.classIdentity), lesson.classIdentity,
  ])).values()];
  const closures = bundle.events.filter((event) => event.isHoliday).map((event) => {
    const selectedGrades = event.grades.flatMap((on, index) => on ? [String(index + 1)] : []);
    const partial = selectedGrades.length > 0 && selectedGrades.length < event.grades.length;
    return {
      date: isoDate(event.date),
      reason: event.name || event.kind,
      ...(partial ? {
        classIdentities: knownClasses.filter((identity) => selectedGrades.includes(identity.grade)),
      } : {}),
    };
  });
  const academicYear = normalization.accepted[0]?.classIdentity.academicYear ?? '';
  const complete = bundle.result.complete && normalization.quarantined.length === 0;

  return {
    schemaVersion: 2,
    workspace: {
      id: workspaceId, name: bundle.school.name, activeRevisionId: revisionId,
      createdAt: now, updatedAt: now,
    },
    revisions: [{
      id: revisionId,
      workspaceId,
      source: 'neis',
      query: {
        from: bundle.range.from, to: bundle.range.to, academicYear,
        rawRows: String(bundle.result.total),
        receivedRows: String(bundle.rows.length), expectedRows: String(bundle.result.total),
        pageCount: String(bundle.result.pageCount),
        acceptedRows: String(normalization.accepted.length),
        quarantinedRows: String(normalization.quarantined.length),
        duplicateRows: String(normalization.duplicateCount),
        parallelGroups: String(normalization.parallelGroups.length),
      },
      loadedAt: bundle.result.fetchedAt,
      complete,
      checksum: `neis:${workspaceId}:${bundle.range.from}-${bundle.range.to}:${bundle.result.total}`,
      ...(closures.length ? { closures } : {}),
    }],
    lessons,
    teacherLabels,
    cases: [], adminTasks: [], publications: [], audit: [],
  };
}

export function completeSetupReview(
  bundle: NeisLoadBundle,
  teacherMap: TeacherMap,
  credential: Pick<NeisSessionValue, 'clear'>,
): WorkspaceState {
  const next = createWorkspaceFromNeis(bundle, teacherMap);
  credential.clear();
  return next;
}

export function canOpenInvitations(input: {
  sourceComplete: boolean;
  unresolvedTeacherCount: number;
  duplicateNameCount?: number;
}): boolean {
  return input.sourceComplete
    && input.unresolvedTeacherCount === 0
    && (input.duplicateNameCount ?? 0) === 0;
}

export interface InvitationLink { id: string; label: string; href: string; }

export function createInvitationLinks(
  state: WorkspaceState,
  origin: string,
  teacherLabels: Readonly<Record<string, string>> = state.teacherLabels ?? {},
): { teachers: InvitationLink[]; classes: InvitationLink[] } {
  const teachers = [...new Set(state.lessons.flatMap((lesson) =>
    lesson.teacher.state === 'assigned' ? [lesson.teacher.teacherId] : []))]
    .sort((left, right) => left.localeCompare(right, 'ko'))
    .map((teacherId) => ({
      id: teacherId,
      label: teacherLabels[teacherId] ?? teacherId,
      href: new URL(formatLocation({
        view: 'teacher', school: state.workspace.id, teacher: teacherId,
      }), origin).toString(),
    }));
  const classes = [...new Map(state.lessons.map((lesson) => {
    const identity = lesson.classIdentity;
    const id = JSON.stringify([identity.grade, identity.className]);
    return [id, { grade: identity.grade, className: identity.className }] as const;
  })).entries()]
    .sort((left, right) => left[0].localeCompare(right[0], 'ko', { numeric: true }))
    .map(([id, identity]) => ({
      id,
      label: `${identity.grade}학년 ${identity.className}반`,
      href: new URL(formatLocation({
        view: 'class', school: state.workspace.id,
        grade: identity.grade, className: identity.className,
      }), origin).toString(),
    }));
  return { teachers, classes };
}

interface MappingPair {
  key: string; classKey: string; classLabel: string; grade: string; subject: string;
}

function mappingPairs(bundle: NeisLoadBundle | null): MappingPair[] {
  if (!bundle) return [];
  const found = new Map<string, MappingPair>();
  for (const row of bundle.report.normalization.accepted) {
    const key = pairKey(row.classKey, row.subject);
    if (!found.has(key)) found.set(key, {
      key,
      classKey: row.classKey,
      classLabel: classLabel(row.classIdentity.grade, row.classIdentity.className),
      grade: row.classIdentity.grade,
      subject: row.subject,
    });
  }
  return [...found.values()].sort((left, right) =>
    left.classLabel.localeCompare(right.classLabel, 'ko', { numeric: true })
      || left.subject.localeCompare(right.subject, 'ko'));
}

function duplicateNameConflicts(bundle: NeisLoadBundle | null, map: TeacherMap): string[] {
  if (!bundle) return [];
  const occupied = new Map<string, Set<string>>();
  for (const row of bundle.report.normalization.accepted) {
    const label = classLabel(row.classIdentity.grade, row.classIdentity.className);
    const teacher = map[mapKey(row.classKey, row.subject)] ?? map[mapKey(label, row.subject)];
    if (!teacher) continue;
    const key = `${teacher}\u0000${row.date}\u0000${row.period}`;
    const facts = occupied.get(key) ?? new Set<string>();
    facts.add(`${label} ${row.subject}`);
    occupied.set(key, facts);
  }
  return [...occupied.entries()]
    .filter(([, facts]) => facts.size > 1)
    .map(([key, facts]) => `${key.split('\u0000')[0]}: ${[...facts].join(', ')}`);
}

function firstAssignedTeacher(state: WorkspaceState): string | null {
  for (const lesson of state.lessons) {
    if (lesson.teacher.state === 'assigned') return lesson.teacher.teacherId;
  }
  return null;
}

export function SetupFlow({ initialSchoolQuery = '', saveState, navigate }: {
  initialSchoolQuery?: string;
  saveState(next: WorkspaceState): SaveResult;
  navigate(next: AppLocation): void;
}) {
  const session = useContext(NeisSessionContext);
  const [stage, setStage] = useState<SetupStage>('학교 검색');
  const [school, setSchool] = useState<NeisSchool | null>(null);
  const [bundle, setBundle] = useState<NeisLoadBundle | null>(null);
  const [teacherMap, setTeacherMap] = useState<TeacherMap>({});
  const [completedState, setCompletedState] = useState<WorkspaceState | null>(null);
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const pairs = useMemo(() => mappingPairs(bundle), [bundle]);
  const unresolved = pairs.filter((pair) => !(
    teacherMap[mapKey(pair.classKey, pair.subject)]
      ?? teacherMap[mapKey(pair.classLabel, pair.subject)]
  ));
  const duplicateNames = useMemo(() => duplicateNameConflicts(bundle, teacherMap), [bundle, teacherMap]);
  const sourceComplete = Boolean(bundle?.result.complete)
    && (bundle?.report.normalization.quarantined.length ?? 1) === 0;
  const invitationsReady = canOpenInvitations({
    sourceComplete,
    unresolvedTeacherCount: unresolved.length,
    duplicateNameCount: duplicateNames.length,
  });
  const invitationLinks = useMemo(() => completedState && typeof window !== 'undefined'
    ? createInvitationLinks(
      completedState,
      window.location.origin,
      Object.fromEntries(Object.values(teacherMap)
        .map((name) => [memberIdFor(completedState.workspace.id, name), name])),
    )
    : null, [completedState, teacherMap]);

  const leave = useCallback(() => {
    session.clear();
    navigate({ view: 'landing' });
  }, [navigate, session]);

  const importMapping = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result);
        let next: TeacherMap = {};
        try {
          const loaded = fromFile(text);
          next = Object.fromEntries(loaded.input.assignments.map((assignment) => [
            mapKey(assignment.klass, assignment.subject), normalizeName(assignment.teacher),
          ]));
        } catch {
          const value: unknown = JSON.parse(text);
          if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
          next = Object.fromEntries(Object.entries(value)
            .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
            .map(([key, name]) => [key, normalizeName(name)]));
        }
        setTeacherMap((current) => ({ ...current, ...next }));
        setMessage(`${Object.keys(next).length}개 교사 연결을 가져왔습니다.`);
      } catch {
        setMessage('교사 연결 JSON을 읽지 못했습니다. 학교에서 내보낸 파일인지 확인하십시오.');
      }
    };
    reader.readAsText(file);
  }, []);

  const completeReview = useCallback(() => {
    if (!bundle || !invitationsReady) return;
    const next = completeSetupReview(bundle, teacherMap, session);
    saveState(next);
    setCompletedState(next);
    setStage('초대 링크');
  }, [bundle, invitationsReady, saveState, session, teacherMap]);

  const stageEnabled = (candidate: SetupStage): boolean => {
    return canEnterSetupStage(candidate, {
      hasSchool: school !== null,
      hasSessionKey: session.key !== '',
      hasBundle: bundle !== null,
      sourceComplete,
      invitationsReady,
    });
  };

  return (
    <main className="setup-page" aria-labelledby="setup-title">
      <header className="setup-header">
        <div>
          <span className="eyebrow">학교에서 한 번만</span>
          <h1 id="setup-title" tabIndex={-1}>일과 담당자 최초 설정</h1>
          <p>공식 시간표를 확인하고 교사를 연결한 뒤, 안전한 참여 링크를 만듭니다.</p>
        </div>
        <button className="btn ghost" onClick={leave}>설정 나가기</button>
      </header>

      <nav className="setup-rail" aria-label="최초 설정 단계">
        {SETUP_STAGES.map((item, index) => (
          <button
            key={item}
            data-setup-stage={item}
            className={stage === item ? 'current' : ''}
            disabled={!stageEnabled(item)}
            aria-current={stage === item ? 'step' : undefined}
            onClick={() => setStage(item)}
          ><span>{index + 1}</span>{item}</button>
        ))}
      </nav>

      <section className="setup-body">
        {stage === '학교 검색' && (
          <NeisLoader mode="school" neisKey={session.key} school={school}
            initialSchoolQuery={initialSchoolQuery}
            onKeyChange={session.setKey}
            onSchoolChange={(next) => { setSchool(next); setStage('세션 인증키'); }}
            onLoaded={() => undefined} />
        )}
        {stage === '세션 인증키' && school && (
          <NeisLoader mode="key" neisKey={session.key} school={school}
            onKeyChange={session.setKey} onSchoolChange={setSchool}
            onLoaded={() => undefined} onContinue={() => setStage('공식 자료 불러오기')} />
        )}
        {stage === '공식 자료 불러오기' && school && (
          <NeisLoader mode="load" neisKey={session.key} school={school}
            onKeyChange={session.setKey} onSchoolChange={setSchool}
            onLoaded={(next) => { setBundle(next); setStage('완전성 확인'); }} />
        )}
        {stage === '완전성 확인' && bundle && (
          <>
            <DataHealthPanel bundle={bundle} />
            <div className="setup-actions">
              <button className="btn primary" disabled={!sourceComplete} onClick={() => setStage('교사 연결')}>교사 연결로 계속</button>
              {!sourceComplete && <button className="btn ghost" onClick={() => setStage('공식 자료 불러오기')}>다시 불러오기</button>}
            </div>
          </>
        )}
        {stage === '교사 연결' && bundle && (
          <section aria-labelledby="teacher-map-title">
            <header className="mapping-head">
              <div>
                <span className="eyebrow">학교 소유 자료</span>
                <h2 id="teacher-map-title">교사와 수업 연결</h2>
                <p>{pairs.length}개 학급·과목 묶음 중 {pairs.length - unresolved.length}개를 연결했습니다.</p>
              </div>
              <button className="btn ghost" onClick={() => fileRef.current?.click()}>교사 연결 JSON 가져오기</button>
              <input ref={fileRef} hidden type="file" accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) importMapping(file);
                  event.target.value = '';
                }} />
            </header>
            {message && <p className="setup-message" role="status">{message}</p>}
            <div className="mapping-list">
              {pairs.map((pair) => {
                const key = mapKey(pair.classKey, pair.subject);
                const value = teacherMap[key] ?? teacherMap[mapKey(pair.classLabel, pair.subject)] ?? '';
                const spread = value ? pairs.filter((candidate) =>
                  candidate.grade === pair.grade && candidate.subject === pair.subject
                    && candidate.key !== pair.key
                    && !teacherMap[mapKey(candidate.classKey, candidate.subject)]) : [];
                return (
                  <div className="mapping-row" key={pair.key}>
                    <span><b>{pair.classLabel}</b><small>{pair.subject}</small></span>
                    <input className="input" aria-label={`${pair.classLabel} ${pair.subject} 담당 교사`}
                      placeholder="교사 이름 또는 교내 ID" value={value}
                      onChange={(event) => {
                        const name = normalizeName(event.target.value);
                        setTeacherMap((current) => {
                          const next = { ...current };
                          if (name) next[key] = name; else delete next[key];
                          return next;
                        });
                      }} />
                    <button className="btn ghost" disabled={!value || spread.length === 0}
                      onClick={() => setTeacherMap((current) => ({
                        ...current,
                        ...Object.fromEntries(spread.map((candidate) => [mapKey(candidate.classKey, candidate.subject), value])),
                      }))}>
                      같은 학년·과목 {spread.length}곳에도
                    </button>
                  </div>
                );
              })}
            </div>
            <div className="setup-actions"><button className="btn primary" onClick={() => setStage('미해결 검토')}>미해결 항목 검토</button></div>
          </section>
        )}
        {stage === '미해결 검토' && bundle && (
          <section className="unresolved-review" aria-labelledby="unresolved-title">
            <span className="eyebrow">마지막 안전 점검</span>
            <h2 id="unresolved-title">미해결 항목 검토</h2>
            <div className="review-counts">
              <div><b>{unresolved.length}</b><span>담당 교사 미연결</span></div>
              <div><b>{duplicateNames.length}</b><span>동명이인 의심</span></div>
              <div><b>{bundle.report.normalization.parallelGroups.length}</b><span>분반·묶음 의심</span></div>
            </div>
            {unresolved.length > 0 && <p className="setup-alert" role="alert">
              {unresolved.slice(0, 4).map((item) => `${item.classLabel} ${item.subject}`).join(', ')}
              {unresolved.length > 4 ? ` 외 ${unresolved.length - 4}개` : ''}의 담당 교사를 연결하십시오.
            </p>}
            {duplicateNames.length > 0 && <ul className="review-list">{duplicateNames.map((item) => <li key={item}>{item}</li>)}</ul>}
            {bundle.report.normalization.parallelGroups.length > 0 && <p className="setup-note">
              같은 학급·교시에 과목이 둘 이상인 {bundle.report.normalization.parallelGroups.length}개 묶음은 분반으로 보존됩니다.
            </p>}
            <div className="setup-actions">
              <button className="btn ghost" onClick={() => setStage('교사 연결')}>교사 연결 수정</button>
              <button className="btn primary" disabled={!invitationsReady} onClick={completeReview}>초대 링크 만들기</button>
            </div>
          </section>
        )}
        {stage === '초대 링크' && completedState && invitationLinks && (
          <section className="invitation-panel" aria-labelledby="invitation-title">
            <span className="eyebrow">민감 정보 제외 완료</span>
            <h2 id="invitation-title">초대 링크</h2>
            <p>링크에는 학교와 합성 교사 ID 또는 학년·반만 들어갑니다. 인증키와 내부 메모는 포함하지 않습니다.</p>
            <div className="invitation-columns">
              <div><h3>교사 링크</h3>{invitationLinks.teachers.map((link) => <a key={link.id} href={link.href}>{link.label}</a>)}</div>
              <div><h3>학급 공개 링크</h3>{invitationLinks.classes.map((link) => <a key={link.id} href={link.href}>{link.label}</a>)}</div>
            </div>
            <div className="setup-actions"><button className="btn primary" onClick={() => {
              session.clear();
              const teacher = firstAssignedTeacher(completedState);
              navigate(teacher
                ? { view: 'teacher', school: completedState.workspace.id, teacher }
                : { view: 'ops', school: completedState.workspace.id });
            }}>설정 마치기</button></div>
          </section>
        )}
      </section>
    </main>
  );
}
