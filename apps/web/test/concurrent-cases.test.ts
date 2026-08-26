import { describe, expect, it } from 'vitest';
import { classIdentityKey, type ClassIdentity } from '@timeswap/engine';
import { createAbsenceCase, transitionCase } from '../lib/case-service';
import { validateCasePlan } from '../lib/projections';
import type { Lesson, WorkspaceState } from '../lib/domain';

/**
 * 승인은 났는데 아직 게시 전인 사건이 잡아 둔 자리.
 *
 * 행정 마감이 하루쯤 걸린다. 그 사이에 다음 사건을 푸는 일이 흔하다. 그때 앞 사건이
 * 가기로 정해 둔 자리를 비어 있다고 보면, 일과 담당이 그 자리를 고르고 승인에서 막힌다.
 *
 * 실제 학교 자료로는 이것을 못 잰다. 빈 자리가 넉넉해서 두 사건이 같은 자리를 다투는
 * 일이 안 생긴다. 실제로 25곳으로 돌려 보니 열네 쌍이 모두 그냥 통과했고, 예약 규칙을
 * 빼도 결과가 같았다. 아무것도 못 가리는 검사였다.
 *
 * 그래서 다투는 자리를 손으로 지정한다. 1학년 1반은 1, 2교시만 있고 3교시가 비어 있다.
 * 1학년 2반이 3교시를 쓰고 있어서 그 교시는 그날 있는 교시다.
 *
 * | 학급 | 1교시 | 2교시 | 3교시 |
 * |---|---|---|---|
 * | 1-1 | 김하나 | 이두리 | (빔) |
 * | 1-2 | 박세찬 | 최네오 | 정다섯 |
 *
 * 김하나와 이두리가 각각 부재를 내고 둘 다 1-1 의 3교시로 가려 한다.
 *
 * 이 이동은 엔진이 스스로 내지는 않는다. 학급 시간표에 빈 시간이 생기기 때문이고
 * (`units.ts` 의 "빈 시간이 생깁니다") 그것이 맞다. 여기서 보려는 것은 엔진이 아니라
 * **사건 사이의 자리 예약**이라 손으로 지정해 관문만 본다.
 */
const identity = (className: string): ClassIdentity => ({
  schoolCode: '7010536', academicYear: '2026', dayCourse: '주간',
  affiliation: '일반계', major: '공통', grade: '1', className,
});

const lesson = (id: string, className: string, period: string, teacherId: string): Lesson => ({
  id, workspaceId: 'school', revisionId: 'rev',
  date: '2026-08-18', period, classIdentity: identity(className),
  subject: `과목${period}`, room: `${className}실`,
  teacher: { state: 'assigned', teacherId },
});

function school(): WorkspaceState {
  return {
    schemaVersion: 2,
    workspace: {
      id: 'school', name: '자리다툼중학교', activeRevisionId: 'rev',
      createdAt: '2026-08-18T00:00:00.000Z', updatedAt: '2026-08-18T00:00:00.000Z',
    },
    revisions: [{
      id: 'rev', workspaceId: 'school', source: 'neis',
      loadedAt: '2026-08-18T00:00:00.000Z', complete: true, checksum: 'sha256:x',
    }],
    lessons: [
      lesson('a1', '1', '1', '김하나'),
      lesson('a2', '1', '2', '이두리'),
      lesson('b1', '2', '1', '박세찬'),
      lesson('b2', '2', '2', '최네오'),
      lesson('b3', '2', '3', '정다섯'),
    ],
    cases: [], adminTasks: [], publications: [], audit: [],
  };
}

/** 사건을 만들어 검토까지 올리고 3교시로 가는 안을 담는다. */
function openWithMove(
  state: WorkspaceState,
  caseId: string,
  teacherId: string,
  lessonId: string,
): WorkspaceState {
  let next = createAbsenceCase(state, {
    id: caseId, auditEventId: `${caseId}:create`, workspaceId: 'school',
    requesterTeacherId: teacherId, fromDate: '2026-08-18', toDate: '2026-08-18',
    reason: '업무상 부재', lessonIds: [lessonId], at: '2026-08-18T00:00:00.000Z',
  });
  next = transitionCase(next, {
    caseId, to: 'submitted', actorId: teacherId,
    at: '2026-08-18T00:00:00.000Z', auditEventId: `${caseId}:submit`,
  });
  next = transitionCase(next, {
    caseId, to: 'in_review', actorId: 'ops',
    at: '2026-08-18T00:00:00.000Z', auditEventId: `${caseId}:review`,
  });
  return {
    ...next,
    cases: next.cases.map((item) => item.id === caseId ? {
      ...item,
      resolutionItems: [{
        id: `${caseId}:move`, lessonId, kind: 'move' as const, computedAgainstRevisionId: 'rev',
        changes: [{
          lessonId, toDate: '2026-08-18', toPeriod: '3',
          teacher: { state: 'assigned' as const, teacherId },
        }],
      }],
    } : item),
  };
}

describe('승인만 나고 게시 전인 사건이 잡은 자리', () => {
  it('아무도 안 잡았으면 그 자리로 갈 수 있다', () => {
    // 이것이 깨지면 아래 검사가 자리 다툼이 아니라 다른 이유로 막히는 것을 재게 된다.
    const state = openWithMove(school(), 'case-b', '이두리', 'a2');
    expect(validateCasePlan(state, 'case-b').valid).toBe(true);
  });

  it('먼저 승인된 사건이 잡은 자리는 막는다', () => {
    let state = openWithMove(school(), 'case-a', '김하나', 'a1');
    state = openWithMove(state, 'case-b', '이두리', 'a2');
    expect(validateCasePlan(state, 'case-a').valid).toBe(true);

    state = transitionCase(state, {
      caseId: 'case-a', to: 'resolution_approved', actorId: 'ops',
      at: '2026-08-18T01:00:00.000Z', auditEventId: 'case-a:approve',
    });

    // 3교시는 김하나의 수업이 들어가기로 정해진 자리다.
    const validation = validateCasePlan(state, 'case-b');
    expect(validation.valid).toBe(false);
    expect(validation.conflicts.map((item) => item.kind)).toContain('class');
  });

  it('막힌 자리는 승인 자체가 안 된다', () => {
    // 화면의 승인 단추는 검사 결과로 잠긴다. 그 잠금이 풀려도 서비스가 다시 막아야 한다.
    let state = openWithMove(school(), 'case-a', '김하나', 'a1');
    state = openWithMove(state, 'case-b', '이두리', 'a2');
    state = transitionCase(state, {
      caseId: 'case-a', to: 'resolution_approved', actorId: 'ops',
      at: '2026-08-18T01:00:00.000Z', auditEventId: 'case-a:approve',
    });
    expect(() => transitionCase(state, {
      caseId: 'case-b', to: 'resolution_approved', actorId: 'ops',
      at: '2026-08-18T02:00:00.000Z', auditEventId: 'case-b:approve',
    })).toThrow('unresolved conflicts');
  });

  it('반려된 사건은 자리를 안 잡는다', () => {
    // 없던 일이 된 부재가 자리를 계속 물고 있으면 아무도 그 자리를 못 쓴다.
    let state = openWithMove(school(), 'case-a', '김하나', 'a1');
    state = openWithMove(state, 'case-b', '이두리', 'a2');
    state = transitionCase(state, {
      caseId: 'case-a', to: 'rejected', actorId: 'ops',
      at: '2026-08-18T01:00:00.000Z', auditEventId: 'case-a:reject',
      rejectionNote: '부재 사유가 확인되지 않았습니다.',
    });
    expect(validateCasePlan(state, 'case-b').valid).toBe(true);
  });

  it('학급 식별자를 통째로 본다', () => {
    // 학년과 반만 보면 다른 과정의 같은 반이 같은 학급으로 잡힌다.
    expect(new Set(school().lessons.map((item) => classIdentityKey(item.classIdentity))).size).toBe(2);
  });
});
