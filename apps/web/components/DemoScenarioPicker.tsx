'use client';

import { useState } from 'react';

import type { DemoScenarioId } from '../lib/demo';
import type { WorkspaceState } from '../lib/domain';
import {
  canResetDemoWorkspace,
  operationalDemoScenarios,
} from '../lib/ops-command-center';
import type { SaveResult } from '../lib/repository';

export function DemoScenarioPicker({
  state,
  onOpenScenario,
}: {
  state: WorkspaceState;
  onOpenScenario(id: DemoScenarioId): SaveResult;
}) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<DemoScenarioId | null>(null);
  const [message, setMessage] = useState('');
  const resettable = canResetDemoWorkspace(state);
  const pending = operationalDemoScenarios().find((scenario) => scenario.id === pendingId);

  if (!resettable) return (
    <section className="demo-scenario-picker locked" aria-label="현실 사례 바꾸기">
      <b>현실 사례 바꾸기</b>
      <p>실제 또는 나이스 작업공간은 예시 사례로 초기화할 수 없습니다.</p>
    </section>
  );

  return (
    <section className="demo-scenario-picker" aria-label="현실 사례 바꾸기">
      <button className="btn ghost" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        현실 사례 바꾸기
      </button>
      {open && !pending && (
        <div className="demo-scenario-options" role="list">
          {operationalDemoScenarios().map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              data-demo-scenario={scenario.id}
              onClick={() => setPendingId(scenario.id)}
            >
              <b>{scenario.title}</b>
              <span>{scenario.expectedOutcome}</span>
            </button>
          ))}
        </div>
      )}
      {pending && (
        <div className="demo-reset-confirm" role="alert">
          <b>{pending.title} 사례로 예시 작업공간을 다시 시작할까요?</b>
          <p>현재 예시에서 만든 변경과 감사 기록은 이 브라우저의 기존 예시 작업공간에 남습니다.</p>
          <div>
            <button className="btn" onClick={() => setPendingId(null)}>취소</button>
            <button
              className="btn primary"
              onClick={() => {
                const result = onOpenScenario(pending.id);
                if (result.ok) {
                  setPendingId(null);
                  setOpen(false);
                  setMessage('예시 사례를 바꿨습니다.');
                } else {
                  setMessage('예시 사례를 저장하지 못했습니다. 현재 사례를 그대로 유지합니다.');
                }
              }}
            >
              초기화 확인
            </button>
          </div>
        </div>
      )}
      {message && <p className="demo-scenario-message" role="status">{message}</p>}
    </section>
  );
}
