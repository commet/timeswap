import { describe, expect, it } from 'vitest';

import {
  completeAdminTask,
  createCorrectionCase,
  createPrototypeAdminTasks,
  replaceCaseResolution,
  transitionCase,
} from '../lib/case-service';
import type { WorkspaceState } from '../lib/domain';
import {
  buildClassPublicationPreview,
  buildNeisInputList,
  buildTeacherNotice,
  publishCase,
} from '../lib/publication';
import { coverResolution, readyToPublish } from './publication-fixture';

describe('publishCase', () => {
  it('records the revision, case, changed lessons, timestamp, and actor', () => {
    const state = publishCase(
      readyToPublish(),
      'case-1',
      'operator-1',
      '2026-08-18T02:00:00.000Z',
    );

    expect(state.publications).toHaveLength(1);
    expect(state.publications[0]).toMatchObject({
      workspaceId: 'workspace-1',
      caseId: 'case-1',
      revisionId: 'revision-1',
      changedLessonIds: ['lesson-1'],
      publishedAt: '2026-08-18T02:00:00.000Z',
      publishedBy: 'operator-1',
    });
    expect(state.cases[0]!.status).toBe('published');
  });

  it('rejects a case that has not finished its required administrative tasks', () => {
    expect(() => publishCase(
      readyToPublish({ completeTasks: false }),
      'case-1',
      'operator-1',
      '2026-08-18T02:00:00.000Z',
    )).toThrow();
  });

  it('rejects a case whose plan leaves a lesson unresolved', () => {
    const ready = readyToPublish();
    const withUnresolved: WorkspaceState = {
      ...ready,
      cases: ready.cases.map((item) => ({
        ...item,
        resolutionItems: [{
          id: 'resolution-unresolved',
          lessonId: 'lesson-1',
          kind: 'unresolved' as const,
          computedAgainstRevisionId: 'revision-1',
          changes: [],
        }],
      })),
    };

    expect(() => publishCase(withUnresolved, 'case-1', 'operator-1', '2026-08-18T02:00:00.000Z'))
      .toThrow();
  });

  it('rejects a plan computed against a superseded revision', () => {
    const ready = readyToPublish();
    const stale: WorkspaceState = {
      ...ready,
      workspace: { ...ready.workspace, activeRevisionId: 'revision-2' },
      revisions: [...ready.revisions, {
        id: 'revision-2',
        workspaceId: 'workspace-1',
        source: 'neis',
        loadedAt: '2026-08-18T01:30:00.000Z',
        complete: true,
        checksum: 'checksum-2',
      }],
      lessons: ready.lessons.map((lesson) => ({ ...lesson, revisionId: 'revision-2' })),
    };

    expect(() => publishCase(stale, 'case-1', 'operator-1', '2026-08-18T02:00:00.000Z'))
      .toThrow();
  });

  it('rejects publishing the same case twice', () => {
    const published = publishCase(
      readyToPublish(),
      'case-1',
      'operator-1',
      '2026-08-18T02:00:00.000Z',
    );

    expect(() => publishCase(published, 'case-1', 'operator-1', '2026-08-18T03:00:00.000Z'))
      .toThrow();
  });

  it('supersedes the prior publication when a correction publishes', () => {
    const published = publishCase(
      readyToPublish(),
      'case-1',
      'operator-1',
      '2026-08-18T02:00:00.000Z',
    );
    const correction = createCorrectionCase(published, {
      sourceCaseId: 'case-1', id: 'case-2', actorId: 'operator-1',
      at: '2026-08-18T03:00:00.000Z', auditEventId: 'audit-correction',
    });
    const submitted = transitionCase(correction, {
      caseId: 'case-2', to: 'submitted', actorId: 'teacher-1',
      at: '2026-08-18T03:01:00.000Z', auditEventId: 'audit-c-submitted',
    });
    const inReview = transitionCase(submitted, {
      caseId: 'case-2', to: 'in_review', actorId: 'operator-1',
      at: '2026-08-18T03:02:00.000Z', auditEventId: 'audit-c-review',
    });
    const resolved = replaceCaseResolution(inReview, {
      caseId: 'case-2',
      resolution: { ...coverResolution(), id: 'resolution-correction', changes: [{
        lessonId: 'lesson-1', toDate: '2026-08-24', toPeriod: '1',
        teacher: { state: 'assigned', teacherId: 'teacher-3' },
      }] },
      actorId: 'operator-1', at: '2026-08-18T03:03:00.000Z',
      auditEventId: 'audit-c-resolution',
    });
    const approved = transitionCase(resolved, {
      caseId: 'case-2', to: 'resolution_approved', actorId: 'operator-1',
      at: '2026-08-18T03:04:00.000Z', auditEventId: 'audit-c-approved',
    });
    const withTasks = createPrototypeAdminTasks(approved, {
      caseId: 'case-2', actorId: 'operator-1', at: '2026-08-18T03:05:00.000Z',
      auditEventId: 'audit-c-admin', taskAuditEventId: 'audit-c-tasks',
      taskIds: {
        neis: 'task-c-neis',
        teacher_notice: 'task-c-notice',
        class_publication: 'task-c-class',
        internal_document: 'task-c-internal',
      },
    });
    const ready = ['task-c-neis', 'task-c-notice', 'task-c-class'].reduce(
      (state, taskId, index) => completeAdminTask(state, {
        taskId, actorId: 'operator-1',
        at: `2026-08-18T03:1${index}:00.000Z`,
        auditEventId: `audit-c-task-${taskId}`,
      }), withTasks);

    const state = publishCase(ready, 'case-2', 'operator-1', '2026-08-18T04:00:00.000Z');

    expect(state.cases.find((item) => item.id === 'case-1')!.status).toBe('superseded');
    expect(state.cases.find((item) => item.id === 'case-2')!.status).toBe('published');
    expect(state.publications).toHaveLength(2);
    expect(state.publications[1]).toMatchObject({
      caseId: 'case-2',
      supersedesPublicationId: state.publications[0]!.id,
    });
  });

  it('leaves the given state untouched', () => {
    const ready = readyToPublish();
    const snapshot = JSON.stringify(ready);
    publishCase(ready, 'case-1', 'operator-1', '2026-08-18T02:00:00.000Z');

    expect(JSON.stringify(ready)).toBe(snapshot);
  });
});

describe('administrative documents', () => {
  it('builds a NEIS input list from resolution facts', () => {
    const state = readyToPublish();
    const text = buildNeisInputList(state, 'case-1');

    expect(text).toContain('2026-08-24');
    expect(text).toContain('1교시');
    expect(text).toContain('2학년 1반');
    expect(text).toContain('정보 통신');
    expect(text).toContain('박보강');
  });

  it('builds a teacher notice naming the covering teacher and the period', () => {
    const state = readyToPublish();
    const text = buildTeacherNotice(state, 'case-1');

    expect(text).toContain('박보강');
    expect(text).toContain('1교시');
    expect(text).toContain('2026-08-24');
  });

  it('never leaks the absence reason or the internal note into public documents', () => {
    const state = readyToPublish();

    expect(buildNeisInputList(state, 'case-1')).not.toContain('업무상 부재');
    expect(JSON.stringify(buildClassPublicationPreview(state, 'case-1')))
      .not.toContain('업무상 부재');
  });

  it('previews the class timetable as it will look after publication', () => {
    const state = readyToPublish();
    const preview = buildClassPublicationPreview(state, 'case-1');

    expect(preview).toHaveLength(1);
    const changed = preview[0]!.lessons.find((lesson) => lesson.lessonId === 'lesson-1');
    expect(changed).toMatchObject({ changed: true, period: '1' });
    expect(preview[0]!.lessons.filter((lesson) => lesson.changed)).toHaveLength(1);
  });

  it('does not persist the preview into the given state', () => {
    const state = readyToPublish();
    const snapshot = JSON.stringify(state);
    buildClassPublicationPreview(state, 'case-1');

    expect(JSON.stringify(state)).toBe(snapshot);
    expect(state.publications).toHaveLength(0);
  });
});
