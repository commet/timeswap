import { describe, expect, it } from 'vitest';

import { createDemoWorkspace, loadDemoScenario } from '../lib/demo';
import type { WorkspaceState } from '../lib/domain';
import {
  canResetDemoWorkspace,
  operationalDemoScenarios,
  projectOpsCommandCenter,
} from '../lib/ops-command-center';
import { projectOpsDashboard } from '../lib/projections';

describe('projectOpsCommandCenter', () => {
  it('uses the canonical dashboard projection for every displayed metric', () => {
    const state = loadDemoScenario('full-day-absence');
    const view = projectOpsCommandCenter(state, '2026-08-18');

    expect(view.dashboard).toEqual(projectOpsDashboard(state, '2026-08-18'));
    expect(view.cases[0]).toMatchObject({
      caseId: 'full-day-absence:case:request',
      priority: 'same-day-unresolved',
      priorityReason: '오늘 해결되지 않은 수업이 있습니다.',
      affectedLessonCount: 4,
      solvedLessonCount: 3,
    });
  });

  it('places an invalid plan ahead of ordinary review work and exposes its period marker', () => {
    const state = loadDemoScenario('concurrent-request');
    const view = projectOpsCommandCenter(state, '2026-08-18');

    expect(view.cases.map((item) => [item.caseId, item.priority])).toEqual([
      ['concurrent-request:case:stale', 'stale-or-invalid'],
      ['concurrent-request:case:approved', 'administrative-delay'],
    ]);
    expect(view.timeline).toContainEqual(expect.objectContaining({
      period: '1', caseId: 'concurrent-request:case:stale',
      affectedTeacherCount: 1, affectedClassCount: 1,
    }));
  });
});

describe('operational demo reset guard', () => {
  it('offers only operational scenarios 2 through 8 and refuses to reset a live workspace', () => {
    expect(operationalDemoScenarios().map((scenario) => scenario.id)).toEqual([
      'full-day-absence',
      'elective-block',
      'practice-block',
      'closure-conflict',
      'incomplete-api',
      'concurrent-request',
      'published-correction',
    ]);
    expect(canResetDemoWorkspace(createDemoWorkspace())).toBe(true);

    const live: WorkspaceState = {
      ...createDemoWorkspace(),
      revisions: [{ ...createDemoWorkspace().revisions[0]!, source: 'neis' }],
    };
    expect(canResetDemoWorkspace(live)).toBe(false);
  });
});
