import { describe, expect, it } from 'vitest';

import type { WorkspaceState } from '../lib/domain';
import { createWorkspaceRepository, WORKSPACE_KEY_PREFIX } from '../lib/repository';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const state = (): WorkspaceState => ({
  schemaVersion: 2,
  workspace: {
    id: 'joyul-demo', name: '조율고등학교', activeRevisionId: 'revision-2',
    createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T01:00:00.000Z',
  },
  revisions: [{
    id: 'revision-2', workspaceId: 'joyul-demo', source: 'school_file',
    loadedAt: '2026-08-18T00:00:00.000Z', complete: true, checksum: 'sha256:demo',
  }],
  lessons: [{
    id: 'lesson-1', workspaceId: 'joyul-demo', revisionId: 'revision-2', date: '2026-08-20',
    period: '2', classIdentity: {
      schoolCode: 'joyul-demo', academicYear: '2026', dayCourse: '주간', affiliation: '일반계',
      major: '공통', grade: '2', className: '3',
    }, subject: '수학', room: '2-3', teacher: { state: 'assigned', teacherId: '김수학' },
  }, {
    id: 'lesson-2', workspaceId: 'joyul-demo', revisionId: 'revision-2', date: '2026-08-20',
    period: '4', classIdentity: {
      schoolCode: 'joyul-demo', academicYear: '2026', dayCourse: '주간', affiliation: '일반계',
      major: '공통', grade: '2', className: '3',
    }, subject: '과학', room: '2-3', teacher: { state: 'assigned', teacherId: '이과학' },
  }],
  cases: [{
    id: 'case-1', workspaceId: 'joyul-demo', requesterTeacherId: '김수학',
    fromDate: '2026-08-20', toDate: '2026-08-20', reason: '연수·출장', lessonIds: ['lesson-1', 'lesson-2'],
    resolutionItems: [{
      id: 'resolution-1', lessonId: 'lesson-1', kind: 'swap2', computedAgainstRevisionId: 'revision-2',
      changes: [
        { lessonId: 'lesson-1', toDate: '2026-08-20', toPeriod: '4', teacher: { state: 'assigned', teacherId: '이과학' } },
        { lessonId: 'lesson-2', toDate: '2026-08-20', toPeriod: '2', teacher: { state: 'assigned', teacherId: '김수학' } },
      ],
    }], status: 'admin_in_progress', createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T01:00:00.000Z',
  }],
  adminTasks: [{
    id: 'task-1', workspaceId: 'joyul-demo', caseId: 'case-1', kind: 'neis', required: true,
    status: 'completed', createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T01:00:00.000Z',
    completedAt: '2026-08-18T01:00:00.000Z', completedBy: 'ops-1',
  }],
  publications: [{
    id: 'publication-1', workspaceId: 'joyul-demo', caseId: 'case-1', revisionId: 'revision-2',
    changedLessonIds: ['lesson-1'], publishedAt: '2026-08-18T01:00:00.000Z', publishedBy: 'ops-1',
  }],
  audit: [{
    id: 'audit-1', workspaceId: 'joyul-demo', caseId: 'case-1', actorId: 'ops-1',
    type: 'case.status_changed', at: '2026-08-18T01:00:00.000Z', details: { nextStatus: 'admin_in_progress' },
  }],
});

describe('WorkspaceRepository', () => {
  it('round-trips every schema-v2 workspace collection', () => {
    const storage = new MemoryStorage();
    const repository = createWorkspaceRepository(storage);

    expect(repository.save(state())).toEqual({ ok: true });
    expect(repository.load('joyul-demo')).toEqual(state());
    expect(repository.load('joyul-demo')?.cases[0]).toMatchObject({
      lessonIds: ['lesson-1', 'lesson-2'],
      resolutionItems: [{ changes: [{ lessonId: 'lesson-1' }, { lessonId: 'lesson-2' }] },],
    });
    expect(storage.getItem(`${WORKSPACE_KEY_PREFIX}joyul-demo`)).toContain('"schemaVersion":2');
  });

  it('migrates valid v1 requests and reports skipped malformed entries', () => {
    const storage = new MemoryStorage();
    storage.setItem('joyul:v1:requests', JSON.stringify({
      version: 1,
      requests: [{
        id: 'request-1', createdAt: '2026-08-18T00:00:00.000Z', date: '2026-08-20',
        teacher: '김수학', reason: '연수·출장', note: '오전 연수', kind: 'change', status: 'pending',
        target: { teacher: '김수학', klass: '2-3', subject: '수학', slot: 9 },
        candidate: {
          type: 'swap2', title: '이과학 선생님과 맞바꾸기', score: -10, unitCount: 2,
          changes: [{
            from: { teacher: '김수학', klass: '2-3', subject: '수학', slot: 9 }, toSlot: 18,
          }], trace: [],
        }, checklist: { neis: false, notice: false, document: false },
      }, { id: 'broken' }, {
        id: 'bad-date', createdAt: 'not-a-timestamp', date: '2026-18-40', teacher: '김수학',
        reason: '연수·출장', kind: 'change', status: 'pending',
        target: { teacher: '김수학', klass: '2-3', subject: '수학', slot: 9 },
        candidate: { type: 'move', changes: [{ from: { teacher: '김수학', klass: '2-3', subject: '수학', slot: 9 }, toSlot: 18 }] },
        checklist: { neis: false, notice: false, document: false },
      }, {
        id: 'bad-note', createdAt: '2026-08-18T00:00:00.000Z', date: '2026-08-20', teacher: '김수학',
        reason: '연수·출장', note: 7, kind: 'change', status: 'pending',
        target: { teacher: '김수학', klass: '2-3', subject: '수학', slot: 9 },
        candidate: { type: 'move', changes: [{ from: { teacher: '김수학', klass: '2-3', subject: '수학', slot: 9 }, toSlot: 18 }] },
        checklist: { neis: false, notice: false, document: false },
      }, {
        id: 'bad-kind', createdAt: '2026-08-18T00:00:00.000Z', date: '2026-08-20', teacher: '김수학',
        reason: '연수·출장', kind: 'invalid', status: 'pending',
        target: { teacher: '김수학', klass: '2-3', subject: '수학', slot: 9 },
        candidate: { type: 'move', changes: [{ from: { teacher: '김수학', klass: '2-3', subject: '수학', slot: 9 }, toSlot: 18 }] },
        checklist: { neis: false, notice: false, document: false },
      }],
    }));

    const migrated = createWorkspaceRepository(storage).load('joyul-demo');

    expect(migrated?.cases).toHaveLength(1);
    expect(migrated?.cases[0]).toMatchObject({ id: 'request-1', lessonIds: ['legacy-v1-request-1-lesson-1'] });
    expect(migrated?.cases[0]?.resolutionItems).toHaveLength(1);
    expect(migrated?.audit).toContainEqual(expect.objectContaining({
      type: 'migration.v1', details: { skippedEntries: 4 },
    }));
    expect(storage.getItem(`${WORKSPACE_KEY_PREFIX}joyul-demo`)).toContain('"schemaVersion":2');
    expect(migrated?.cases.flatMap((item) => [item.id, ...item.resolutionItems.map((resolution) => resolution.id)])
      .every((id) => id.length > 0)).toBe(true);
  });

  it('returns a typed failure while retaining a serializable export when storage is unavailable', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => { throw new DOMException('blocked', 'SecurityError'); };
    const repository = createWorkspaceRepository(storage);

    expect(repository.save(state())).toEqual({ ok: false, reason: 'unavailable' });
    expect(JSON.parse(repository.export(state()))).toEqual(state());
  });

  it('returns a quota failure without overwriting the last persisted canonical workspace', () => {
    const storage = new MemoryStorage();
    const repository = createWorkspaceRepository(storage);
    const persisted = state();
    expect(repository.save(persisted)).toEqual({ ok: true });
    storage.setItem = () => { throw new DOMException('full', 'QuotaExceededError'); };
    const next = { ...persisted, cases: [{ ...persisted.cases[0]!, id: 'case-unsaved' }] };

    expect(repository.save(next)).toEqual({ ok: false, reason: 'quota' });
    expect(repository.load(persisted.workspace.id)).toEqual(persisted);
  });
});
