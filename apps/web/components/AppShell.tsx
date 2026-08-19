'use client';

import { useEffect } from 'react';

import { Landing } from './Landing';
import { RoleNavigation, useRoleViewAdapter } from './RoleNavigation';
import { SetupFlow } from './SetupFlow';
import { BRAND } from '../lib/brand';
import { createDemoWorkspace, DEMO_PROVENANCE_LABEL } from '../lib/demo';
import type { WorkspaceState } from '../lib/domain';
import { parseLocation, type AppLocation } from '../lib/navigation';

export type AppShellProps = {
  state: WorkspaceState | null;
  location: AppLocation;
  saveState(next: WorkspaceState): void;
  navigate(next: AppLocation): void;
};

function firstTeacher(state: WorkspaceState): string | null {
  for (const lesson of state.lessons) {
    if (lesson.teacher.state === 'assigned') return lesson.teacher.teacherId;
  }
  return null;
}

export function AppShell({ state, location, saveState, navigate }: AppShellProps): React.ReactNode {
  const RoleView = useRoleViewAdapter();

  useEffect(() => {
    const id = location.view === 'landing'
      ? 'landing-title'
      : location.view === 'setup' ? 'setup-title' : 'role-page-title';
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }, [location]);

  if (location.view === 'landing') return (
    <Landing
      state={state}
      onOpen={(input) => {
        const trimmed = input.trim();
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('/?')) {
          const received = parseLocation(trimmed);
          if (received.view !== 'landing') {
            navigate(received);
            return;
          }
        }
        if (state && (trimmed === state.workspace.name || trimmed === state.workspace.id)) {
          const teacher = firstTeacher(state);
          navigate(teacher
            ? { view: 'teacher', school: state.workspace.id, teacher }
            : { view: 'ops', school: state.workspace.id });
          return;
        }
        navigate({ view: 'setup', ...(trimmed ? { schoolQuery: trimmed } : {}) });
      }}
      onSetup={() => navigate({ view: 'setup' })}
      onDemo={() => {
        const demo = createDemoWorkspace();
        saveState(demo);
        navigate({
          view: 'ops', school: demo.workspace.id,
          ...(demo.cases[0] ? { caseId: demo.cases[0].id } : {}),
        });
      }}
    />
  );

  if (location.view === 'setup') return (
    <SetupFlow
      initialSchoolQuery={location.schoolQuery ?? ''}
      saveState={saveState}
      navigate={navigate}
    />
  );

  if (!state || state.workspace.id !== location.school) return (
    <main className="missing-workspace" aria-labelledby="role-page-title">
      <span className="eyebrow">학교 자료 없음</span>
      <h1 id="role-page-title" tabIndex={-1}>이 기기에서 학교를 열 수 없습니다</h1>
      <p>받은 링크의 학교를 아직 설정하지 않았습니다. 학교 진입 화면에서 다시 시작하십시오.</p>
      <button className="btn primary" onClick={() => navigate({ view: 'landing' })}>학교 진입으로 돌아가기</button>
    </main>
  );

  return (
    <div className="app-shell">
      <header className="shell-header">
        <button className="shell-wordmark" onClick={() => navigate({ view: 'landing' })} aria-label="학교 진입으로 돌아가기">
          <span aria-hidden>↙</span>{BRAND}
        </button>
        <div className="shell-school">
          <span>현재 학교</span>
          <h1 id="role-page-title" tabIndex={-1}>{state.workspace.name}</h1>
        </div>
        <RoleNavigation state={state} location={location} navigate={navigate} />
      </header>
      {state.revisions[0]?.source === 'demo' && (
        <p className="demo-provenance">예시 운영 자료 · {DEMO_PROVENANCE_LABEL}</p>
      )}
      <RoleView state={state} location={location} saveState={saveState} navigate={navigate} />
    </div>
  );
}
