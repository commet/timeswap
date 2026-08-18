'use client';

import { createContext, useContext, type ComponentType, type ReactNode } from 'react';

import type { WorkspaceState } from '../lib/domain';
import type { AppLocation } from '../lib/navigation';

export interface RoleViewAdapterProps {
  state: WorkspaceState;
  location: Exclude<AppLocation, { view: 'landing' | 'setup' }>;
  navigate(next: AppLocation): void;
}

const MissingRoleView = ({ location }: RoleViewAdapterProps) => (
  <main className="role-placeholder">
    <h2>{location.view === 'teacher' ? '교사 화면' : location.view === 'ops' ? '일과 담당 화면' : '학급 공개 화면'}</h2>
    <p>이 역할 화면은 다음 작업에서 새 상태 모델에 맞춰 교체됩니다.</p>
  </main>
);

const RoleViewContext = createContext<ComponentType<RoleViewAdapterProps>>(MissingRoleView);

export function RoleViewAdapterProvider({
  adapter,
  children,
}: {
  adapter: ComponentType<RoleViewAdapterProps>;
  children: ReactNode;
}) {
  return <RoleViewContext.Provider value={adapter}>{children}</RoleViewContext.Provider>;
}

export const useRoleViewAdapter = () => useContext(RoleViewContext);

function firstTeacher(state: WorkspaceState): string | null {
  for (const lesson of state.lessons) {
    if (lesson.teacher.state === 'assigned') return lesson.teacher.teacherId;
  }
  return null;
}

export function RoleNavigation({
  state,
  location,
  navigate,
}: {
  state: WorkspaceState;
  location: Exclude<AppLocation, { view: 'landing' | 'setup' }>;
  navigate(next: AppLocation): void;
}) {
  const teacher = location.view === 'teacher' ? location.teacher : firstTeacher(state);
  const identity = location.view === 'class'
    ? { grade: location.grade, className: location.className }
    : state.lessons[0]?.classIdentity;

  return (
    <nav className="role-navigation" aria-label="체험 역할">
      <span className="role-label">체험 역할</span>
      <button
        className={location.view === 'teacher' ? 'current' : ''}
        aria-current={location.view === 'teacher' ? 'page' : undefined}
        disabled={!teacher}
        onClick={() => teacher && navigate({ view: 'teacher', school: state.workspace.id, teacher })}
      >교사</button>
      <button
        className={location.view === 'ops' ? 'current' : ''}
        aria-current={location.view === 'ops' ? 'page' : undefined}
        onClick={() => navigate({ view: 'ops', school: state.workspace.id })}
      >일과 담당</button>
      <button
        className={location.view === 'class' ? 'current' : ''}
        aria-current={location.view === 'class' ? 'page' : undefined}
        disabled={!identity}
        onClick={() => identity && navigate({
          view: 'class', school: state.workspace.id,
          grade: identity.grade, className: identity.className,
        })}
      >학급 공개</button>
      <small>화면 체험용이며 로그인이나 권한 인증이 아닙니다.</small>
    </nav>
  );
}
