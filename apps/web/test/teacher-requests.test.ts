import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { ClassIdentity } from '@timeswap/engine';
import { createAbsenceCase, transitionCase } from '../lib/case-service';
import { projectTeacherCases } from '../lib/projections';
import { TeacherRequestList } from '../components/TeacherRequestList';
import type { Lesson, WorkspaceState } from '../lib/domain';

/**
 * 낸 사람이 자기 요청을 볼 수 있는지.
 *
 * 교사 화면에 자기 요청이 하나도 안 보이고 있었다. 제출하면 "요청을 제출했습니다"가
 * 한 번 뜨고 끝이라 승인됐는지 반려됐는지 알 길이 없었다. 반려 사유는 일과 담당이
 * 반드시 적어야 하는 값인데(안 적으면 반려 자체가 안 된다) 읽는 화면이 없었다.
 * 잘못 낸 요청을 거두는 길도 없어서, 상태 목록에 있는 `cancelled` 로 가는 전이가
 * 아예 안 열려 있었다.
 */
const identity: ClassIdentity = {
  schoolCode: '7010536', academicYear: '2026', dayCourse: '주간',
  affiliation: '일반계', major: '공통', grade: '1', className: '1',
};

const lesson: Lesson = {
  id: 'rev:lesson:1', workspaceId: 'school', revisionId: 'rev',
  date: '2026-08-18', period: '2', classIdentity: identity,
  subject: '수학', room: '1-1', teacher: { state: 'assigned', teacherId: '김수학' },
};

function school(): WorkspaceState {
  return {
    schemaVersion: 2,
    workspace: {
      id: 'school', name: '요청목록중학교', activeRevisionId: 'rev',
      createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
    },
    revisions: [{
      id: 'rev', workspaceId: 'school', source: 'neis',
      loadedAt: '2026-08-18T00:00:00.000Z', complete: true, checksum: 'sha256:x',
    }],
    lessons: [lesson],
    cases: [], adminTasks: [], publications: [], audit: [],
  };
}

function submitted(): WorkspaceState {
  const created = createAbsenceCase(school(), {
    id: 'case-1', auditEventId: 'case-1:create', workspaceId: 'school',
    requesterTeacherId: '김수학', fromDate: '2026-08-18', toDate: '2026-08-18',
    reason: '연수·출장', note: '오전만 비웁니다.', lessonIds: [lesson.id],
    at: '2026-08-17T00:00:00.000Z',
  });
  return transitionCase(created, {
    caseId: 'case-1', to: 'submitted', actorId: '김수학',
    at: '2026-08-17T00:10:00.000Z', auditEventId: 'case-1:submit',
  });
}

describe('교사가 자기 요청을 본다', () => {
  it('낸 요청이 목록에 뜬다', () => {
    const rows = projectTeacherCases(submitted(), '김수학');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      caseId: 'case-1', statusLabel: '제출됨', lessonCount: 1, withdrawable: true,
    });
  });

  it('남의 요청은 안 뜬다', () => {
    expect(projectTeacherCases(submitted(), '이영어')).toHaveLength(0);
  });

  it('반려 사유가 낸 사람에게 보인다', () => {
    let state = transitionCase(submitted(), {
      caseId: 'case-1', to: 'in_review', actorId: 'ops',
      at: '2026-08-17T01:00:00.000Z', auditEventId: 'case-1:review',
    });
    state = transitionCase(state, {
      caseId: 'case-1', to: 'rejected', actorId: 'ops',
      at: '2026-08-17T02:00:00.000Z', auditEventId: 'case-1:reject',
      rejectionNote: '그 시간에 보강할 분이 없습니다. 날짜를 하루 미뤄 주십시오.',
    });
    const rows = projectTeacherCases(state, '김수학');
    expect(rows[0]!.rejectionNote).toContain('보강할 분이 없습니다');
    expect(rows[0]!.withdrawable).toBe(false);

    const html = renderToStaticMarkup(createElement(TeacherRequestList, {
      cases: rows, onWithdraw: () => undefined,
    }));
    expect(html).toContain('반려 사유');
    expect(html).toContain('보강할 분이 없습니다');
    expect(html).toContain('반려됨');
  });

  /*
   * `cancelled` 는 상태 목록과 종결 목록에 있는데 거기로 가는 전이가 없었다. 잘못 낸
   * 요청을 거둘 방법이 아예 없어서, 일과 담당이 남의 실수에 반려 사유를 대신 적어
   * 주는 수밖에 없었다.
   */
  it('제출한 요청을 스스로 거둘 수 있다', () => {
    const state = transitionCase(submitted(), {
      caseId: 'case-1', to: 'cancelled', actorId: '김수학',
      at: '2026-08-17T03:00:00.000Z', auditEventId: 'case-1:cancel',
    });
    expect(state.cases[0]!.status).toBe('cancelled');
    expect(projectTeacherCases(state, '김수학')[0]).toMatchObject({
      statusLabel: '취소됨', withdrawable: false,
    });
  });

  it('검토 중인 요청도 거둘 수 있다', () => {
    const reviewing = transitionCase(submitted(), {
      caseId: 'case-1', to: 'in_review', actorId: 'ops',
      at: '2026-08-17T01:00:00.000Z', auditEventId: 'case-1:review',
    });
    expect(projectTeacherCases(reviewing, '김수학')[0]!.withdrawable).toBe(true);
    expect(transitionCase(reviewing, {
      caseId: 'case-1', to: 'cancelled', actorId: '김수학',
      at: '2026-08-17T03:00:00.000Z', auditEventId: 'case-1:cancel',
    }).cases[0]!.status).toBe('cancelled');
  });

  /*
   * 승인 뒤로는 안 연다. 그때부터 나이스 입력과 통지가 나가 있어서, 되돌리는 것은
   * 취소가 아니라 정정이다.
   */
  it('승인된 뒤에는 스스로 못 거둔다', () => {
    let state = transitionCase(submitted(), {
      caseId: 'case-1', to: 'in_review', actorId: 'ops',
      at: '2026-08-17T01:00:00.000Z', auditEventId: 'case-1:review',
    });
    state = {
      ...state,
      cases: state.cases.map((item) => ({
        ...item,
        resolutionItems: [{
          id: 'r1', lessonId: lesson.id, kind: 'move' as const, computedAgainstRevisionId: 'rev',
          changes: [{
            lessonId: lesson.id, toDate: '2026-08-18', toPeriod: '3', teacher: lesson.teacher,
          }],
        }],
      })),
    };
    state = transitionCase(state, {
      caseId: 'case-1', to: 'resolution_approved', actorId: 'ops',
      at: '2026-08-17T04:00:00.000Z', auditEventId: 'case-1:approve',
    });
    expect(projectTeacherCases(state, '김수학')[0]!.withdrawable).toBe(false);
    expect(() => transitionCase(state, {
      caseId: 'case-1', to: 'cancelled', actorId: '김수학',
      at: '2026-08-17T05:00:00.000Z', auditEventId: 'case-1:cancel',
    })).toThrow('Invalid case transition');
  });
});
