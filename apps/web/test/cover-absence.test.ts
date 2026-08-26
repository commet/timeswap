import { describe, expect, it } from 'vitest';
import type { ClassIdentity } from '@timeswap/engine';
import { createAbsenceCase, lessonsAffectedByAbsence, transitionCase } from '../lib/case-service';
import { effectiveLessons, publishedChanges, validateCasePlan } from '../lib/projections';
import type { AbsenceCase, Lesson, WorkspaceState } from '../lib/domain';

const identity: ClassIdentity = {
  schoolCode: '7010536', academicYear: '2026', dayCourse: '주간',
  affiliation: '일반계', major: '공통', grade: '1', className: '1',
};

const lesson = (id: string, period: string, teacherId: string): Lesson => ({
  id, workspaceId: 'school', revisionId: 'rev',
  date: '2026-08-19', period, classIdentity: identity,
  subject: `과목${period}`, room: '1-1', teacher: { state: 'assigned', teacherId },
});

/** 이영어의 3교시를 김수학이 보강하기로 하고 게시까지 끝났다. */
function afterCoverPublished(): WorkspaceState {
  const lessons = [lesson('L1', '1', '김수학'), lesson('L3', '3', '이영어')];
  const covered: AbsenceCase = {
    id: 'case-lee', workspaceId: 'school', requesterTeacherId: '이영어',
    fromDate: '2026-08-19', toDate: '2026-08-19', reason: '연수·출장',
    lessonIds: ['L3'],
    resolutionItems: [{
      id: 'r-cover', lessonId: 'L3', kind: 'cover', computedAgainstRevisionId: 'rev',
      changes: [{
        lessonId: 'L3', toDate: '2026-08-19', toPeriod: '3',
        teacher: { state: 'assigned', teacherId: '김수학' },
      }],
    }],
    status: 'published', createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
  };
  return {
    schemaVersion: 2,
    workspace: {
      id: 'school', name: '보강중학교', activeRevisionId: 'rev',
      createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
    },
    revisions: [{
      id: 'rev', workspaceId: 'school', source: 'neis',
      loadedAt: '2026-08-18T00:00:00.000Z', complete: true, checksum: 'sha256:x',
    }],
    lessons,
    cases: [covered],
    adminTasks: [],
    publications: [{
      id: 'pub-1', workspaceId: 'school', caseId: 'case-lee', revisionId: 'rev',
      changedLessonIds: ['L3'],
      publishedAt: '2026-08-18T02:00:00.000Z', publishedBy: 'ops',
    }],
    audit: [],
  };
}

describe('보강을 맡은 사람이 그날 결강을 내면', () => {
  it('게시된 보강이 실제로 붙어 있다', () => {
    const state = afterCoverPublished();
    const moved = publishedChanges(state).get('L3');
    expect(moved?.change.teacher).toEqual({ state: 'assigned', teacherId: '김수학' });
  });

  it('보강 맡은 수업이 그 사람의 영향 수업에 들어온다', () => {
    const state = afterCoverPublished();
    // 화면이 부르는 그대로다. 게시된 변경을 얹은 표를 넘긴다.
    const affected = lessonsAffectedByAbsence(
      effectiveLessons(state), '김수학', '2026-08-19', '2026-08-19');
    expect(affected.map((item) => item.id).sort()).toEqual(['L1', 'L3']);

    // 원래 담당에게는 더 이상 안 뜬다. 이미 남에게 넘어간 수업이다.
    expect(lessonsAffectedByAbsence(
      effectiveLessons(state), '이영어', '2026-08-19', '2026-08-19')).toHaveLength(0);
  });

  /*
   * 한 번 게시된 수업을 다시 옮길 수 있는가.
   *
   * 흔한 일이다. 월요일에 낸 변경이 게시된 뒤, 수요일에 다른 사람이 결강을 내면서 그
   * 수업을 또 옮겨야 할 수 있다. 게시는 이미 일어난 일이지 앞으로 잡아 둔 자리가
   * 아니다. 그런데 검증이 게시된 사건도 "자리를 잡은 사건"으로 세고 있다.
   */
  it('게시된 수업을 다른 사건이 다시 옮길 수 있다', () => {
    let state = afterCoverPublished();
    state = createAbsenceCase(state, {
      id: 'case-kim', auditEventId: 'kim:create', workspaceId: 'school',
      requesterTeacherId: '김수학', fromDate: '2026-08-19', toDate: '2026-08-19',
      reason: '연수·출장', lessonIds: ['L3'], at: '2026-08-18T03:00:00.000Z',
    });
    for (const to of ['submitted', 'in_review'] as const) {
      state = transitionCase(state, {
        caseId: 'case-kim', to, actorId: 'ops',
        at: '2026-08-18T03:00:00.000Z', auditEventId: `kim:${to}`,
      });
    }
    state = {
      ...state,
      cases: state.cases.map((item) => item.id === 'case-kim' ? {
        ...item,
        resolutionItems: [{
          id: 'kim:cover', lessonId: 'L3', kind: 'cover' as const, computedAgainstRevisionId: 'rev',
          changes: [{
            lessonId: 'L3', toDate: '2026-08-19', toPeriod: '3',
            teacher: { state: 'assigned' as const, teacherId: '박과학' },
          }],
        }],
      } : item),
    };
    const validation = validateCasePlan(state, 'case-kim');
    expect(validation.conflicts.map((item) => item.message)).not.toContain(
      '해당 수업은 다른 사건의 승인된 해결안에 이미 포함되었습니다.',
    );
    expect(validation.valid).toBe(true);
  });
});
