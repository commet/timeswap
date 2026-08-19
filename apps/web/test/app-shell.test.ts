import { describe, expect, it } from 'vitest';

import * as AppShellModule from '../components/AppShell';
import { createDemoWorkspace } from '../lib/demo';
import type { AppLocation } from '../lib/navigation';
import type { WorkspaceState } from '../lib/domain';

describe('demo entry persistence boundary', () => {
  it.each(['quota', 'unavailable'] as const)('does not navigate into a demo that failed %s persistence', async (reason) => {
    const saveDemoAndNavigate = (AppShellModule as unknown as {
      saveDemoAndNavigate?: (
        demo: WorkspaceState,
        save: (state: WorkspaceState) => { ok: true } | { ok: false; reason: 'quota' | 'unavailable' },
        navigate: (location: AppLocation) => void,
      ) => Promise<{ ok: true } | { ok: false; reason: 'quota' | 'unavailable' }>;
    }).saveDemoAndNavigate;
    const navigations: AppLocation[] = [];

    expect(saveDemoAndNavigate).toBeTypeOf('function');
    if (typeof saveDemoAndNavigate !== 'function') return;

    await expect(saveDemoAndNavigate(createDemoWorkspace(), () => ({ ok: false, reason }), (next) => navigations.push(next)))
      .resolves.toEqual({ ok: false, reason });
    expect(navigations).toEqual([]);
  });

  it('navigates to the demo only after saving it', async () => {
    const saveDemoAndNavigate = (AppShellModule as unknown as {
      saveDemoAndNavigate?: (
        demo: WorkspaceState,
        save: (state: WorkspaceState) => { ok: true } | { ok: false; reason: 'quota' | 'unavailable' },
        navigate: (location: AppLocation) => void,
      ) => Promise<{ ok: true } | { ok: false; reason: 'quota' | 'unavailable' }>;
    }).saveDemoAndNavigate;
    const demo = createDemoWorkspace();
    const navigations: AppLocation[] = [];

    expect(saveDemoAndNavigate).toBeTypeOf('function');
    if (typeof saveDemoAndNavigate !== 'function') return;

    await expect(saveDemoAndNavigate(demo, () => ({ ok: true }), (next) => navigations.push(next)))
      .resolves.toEqual({ ok: true });
    expect(navigations).toEqual([{
      view: 'ops', school: demo.workspace.id, caseId: demo.cases[0]?.id,
    }]);
  });
});
