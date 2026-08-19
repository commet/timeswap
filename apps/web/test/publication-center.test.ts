import { describe, expect, it } from 'vitest';

import { projectPublicationCenter } from '../lib/publication-center';
import { publishCase } from '../lib/publication';
import { readyToPublish } from './publication-fixture';

describe('projectPublicationCenter', () => {
  it('reports approval as complete while publication is still pending', () => {
    const view = projectPublicationCenter(readyToPublish({ completeTasks: false }), 'case-1');

    expect(view.approved).toBe(true);
    expect(view.stage).toBe('administration');
    expect(view.canPublish).toBe(false);
    expect(view.blockedReason).toContain('필수 행정 과업');
  });

  it('lists the four prototype tasks with the internal record optional', () => {
    const view = projectPublicationCenter(readyToPublish({ completeTasks: false }), 'case-1');

    expect(view.tasks.map((task) => task.kind)).toEqual([
      'neis', 'teacher_notice', 'class_publication', 'internal_document',
    ]);
    expect(view.tasks.filter((task) => task.required)).toHaveLength(3);
    expect(view.tasks.every((task) => task.completed)).toBe(false);
  });

  it('allows publication only after every required task is complete', () => {
    const view = projectPublicationCenter(readyToPublish(), 'case-1');

    expect(view.stage).toBe('ready');
    expect(view.canPublish).toBe(true);
    expect(view.blockedReason).toBeUndefined();
    expect(view.tasks.find((task) => task.kind === 'internal_document')!.completed).toBe(false);
  });

  it('carries the documents and the class preview for the pending change', () => {
    const view = projectPublicationCenter(readyToPublish(), 'case-1');

    expect(view.neisInputList).toContain('2학년 1반');
    expect(view.teacherNotice).toContain('박보강');
    expect(view.classPreview).toHaveLength(1);
    expect(view.changedLessonCount).toBe(1);
    expect(view.affectedClassLabels).toEqual(['2학년 1반']);
    expect(view.affectedTeacherLabels).toEqual(['박보강']);
  });

  it('switches to the published stage and records the publication', () => {
    const published = publishCase(
      readyToPublish(),
      'case-1',
      'operator-1',
      '2026-08-18T02:00:00.000Z',
    );
    const view = projectPublicationCenter(published, 'case-1');

    expect(view.stage).toBe('published');
    expect(view.canPublish).toBe(false);
    expect(view.blockedReason).toBeUndefined();
    expect(view.publication).toMatchObject({
      caseId: 'case-1',
      publishedAt: '2026-08-18T02:00:00.000Z',
    });
    expect(view.classPreview[0]!.lastPublishedAt).toBe('2026-08-18T02:00:00.000Z');
  });

  it('never exposes an unnamed teacher as a raw invitation id', () => {
    const ready = readyToPublish();
    const anonymous = { ...ready, teacherLabels: { 'teacher-1': 'member:abc' } };
    const view = projectPublicationCenter(anonymous, 'case-1');

    expect(view.requesterLabel).toBe('이름 확인 필요');
    expect(view.neisInputList).not.toContain('teacher-2');
    expect(view.teacherNotice).not.toContain('member:');
  });
});
