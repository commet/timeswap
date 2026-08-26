import { describe, expect, it } from 'vitest';
import type { ClassIdentity } from '@timeswap/engine';
import { projectOpsCommandCenter } from '../lib/ops-command-center';
import type { AbsenceCase, Lesson, WorkspaceState } from '../lib/domain';

/**
 * 관제판의 오늘 시간대 막대.
 *
 * 게시된 변경은 원래 기록을 안 바꾸고 위에 얹힌다. 막대를 원래 날짜로 그리면 오늘로
 * 옮겨 온 수업은 안 보이고, 오늘에서 떠난 수업은 그대로 남는다. 일과 담당이 오늘 무슨
 * 일이 있는지 보려고 여는 화면이 그렇다.
 */
const identity: ClassIdentity = {
  schoolCode: '7010536', academicYear: '2026', dayCourse: '주간',
  affiliation: '일반계', major: '공통', grade: '1', className: '1',
};

const lesson = (id: string, date: string, period: string): Lesson => ({
  id, workspaceId: 'school', revisionId: 'rev',
  date, period, classIdentity: identity,
  subject: '수학', room: '1-1', teacher: { state: 'assigned', teacherId: '김수학' },
});

/** 화요일 2교시 수업이 게시로 수요일 3교시가 되었다. 오늘은 수요일이다. */
function movedIntoToday(): WorkspaceState {
  const source = lesson('L1', '2026-08-18', '2');
  const published: AbsenceCase = {
    id: 'case-1', workspaceId: 'school', requesterTeacherId: '김수학',
    fromDate: '2026-08-18', toDate: '2026-08-18', reason: '연수·출장',
    lessonIds: ['L1'],
    resolutionItems: [{
      id: 'r1', lessonId: 'L1', kind: 'move', computedAgainstRevisionId: 'rev',
      changes: [{
        lessonId: 'L1', toDate: '2026-08-19', toPeriod: '3',
        teacher: { state: 'assigned', teacherId: '김수학' },
      }],
    }],
    status: 'published', createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
  };
  const pending: AbsenceCase = {
    ...published, id: 'case-2', status: 'in_review',
    fromDate: '2026-08-19', toDate: '2026-08-19',
    resolutionItems: [],
  };
  return {
    schemaVersion: 2,
    workspace: {
      id: 'school', name: '관제판중학교', activeRevisionId: 'rev',
      createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
    },
    revisions: [{
      id: 'rev', workspaceId: 'school', source: 'neis',
      loadedAt: '2026-08-17T00:00:00.000Z', complete: true, checksum: 'sha256:x',
    }],
    lessons: [source],
    cases: [published, pending],
    adminTasks: [],
    publications: [{
      id: 'pub-1', workspaceId: 'school', caseId: 'case-1', revisionId: 'rev',
      changedLessonIds: ['L1'],
      publishedAt: '2026-08-17T02:00:00.000Z', publishedBy: 'ops',
    }],
    audit: [],
  };
}

describe('관제판 오늘 막대', () => {
  it('게시로 오늘 옮겨 온 수업이 오늘 막대에 뜬다', () => {
    const view = projectOpsCommandCenter(movedIntoToday(), '2026-08-19');
    // 진행 중인 사건(case-2)이 그 수업을 담고 있고, 그 수업은 이제 수요일 3교시다.
    expect(view.timeline.map((item) => item.period)).toContain('3');
  });

  it('오늘에서 떠난 수업은 오늘 막대에 안 뜬다', () => {
    const view = projectOpsCommandCenter(movedIntoToday(), '2026-08-18');
    expect(view.timeline.map((item) => item.period)).not.toContain('2');
  });
});
