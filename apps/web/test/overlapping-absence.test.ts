import { describe, expect, it } from 'vitest';
import type { ClassIdentity } from '@timeswap/engine';
import {
  createAbsenceCase,
  findDuplicateAbsenceCase,
  findOverlappingAbsenceCases,
  transitionCase,
} from '../lib/case-service';
import type { Lesson, WorkspaceState } from '../lib/domain';

/**
 * 날짜가 겹치는 두 요청.
 *
 * 출장이 늘어나면 이렇게 된다. 월요일에서 수요일까지로 냈다가, 목요일까지로 늘어나
 * 다시 낸다. 중복 검사는 기간과 수업이 **똑같을 때만** 잡으므로 이 둘은 그냥 통과한다.
 * 화요일과 수요일 수업이 살아 있는 요청 둘에 동시에 들어간다.
 *
 * 한 수업이 두 요청에 동시에 들어가는 것은 언제나 틀렸다. 그런데 지금은 일과 담당이
 * 둘 다 풀어 본 뒤 승인 관문에서야 막힌다. 낸 사람은 아무 말도 못 듣고, 일과 담당은
 * 같은 수업을 두 번 푼다.
 */
const identity: ClassIdentity = {
  schoolCode: '7010536', academicYear: '2026', dayCourse: '주간',
  affiliation: '일반계', major: '공통', grade: '1', className: '1',
};

const lesson = (date: string): Lesson => ({
  id: `rev:lesson:${date}`, workspaceId: 'school', revisionId: 'rev',
  date, period: '2', classIdentity: identity,
  subject: '수학', room: '1-1', teacher: { state: 'assigned', teacherId: '김수학' },
});

const DATES = ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'];

function school(): WorkspaceState {
  return {
    schemaVersion: 2,
    workspace: {
      id: 'school', name: '겹침중학교', activeRevisionId: 'rev',
      createdAt: '2026-08-17T00:00:00.000Z', updatedAt: '2026-08-17T00:00:00.000Z',
    },
    revisions: [{
      id: 'rev', workspaceId: 'school', source: 'neis',
      loadedAt: '2026-08-17T00:00:00.000Z', complete: true, checksum: 'sha256:x',
    }],
    lessons: DATES.map(lesson),
    cases: [], adminTasks: [], publications: [], audit: [],
  };
}

/** 월~수로 낸 요청. 제출까지 올린다. */
function monToWed(): WorkspaceState {
  const created = createAbsenceCase(school(), {
    id: 'case-a', auditEventId: 'case-a:create', workspaceId: 'school',
    requesterTeacherId: '김수학', fromDate: '2026-08-17', toDate: '2026-08-19',
    reason: '연수·출장', lessonIds: DATES.slice(0, 3).map((date) => `rev:lesson:${date}`),
    at: '2026-08-16T00:00:00.000Z',
  });
  return transitionCase(created, {
    caseId: 'case-a', to: 'submitted', actorId: '김수학',
    at: '2026-08-16T00:10:00.000Z', auditEventId: 'case-a:submit',
  });
}

/** 화~목으로 다시 내려는 것. 화요일과 수요일이 겹친다. */
const tueToThu = {
  requesterTeacherId: '김수학',
  fromDate: '2026-08-18',
  toDate: '2026-08-20',
  lessonIds: DATES.slice(1).map((date) => `rev:lesson:${date}`),
};

describe('날짜가 겹치는 요청', () => {
  it('기간이 다르면 중복 검사가 못 잡는다', () => {
    // 지금 있는 검사의 한계다. 이것이 깨지면 아래 검사의 전제가 사라진 것이다.
    expect(findDuplicateAbsenceCase(monToWed(), tueToThu)).toBeUndefined();
  });

  it('같은 수업을 물고 있는 살아 있는 요청을 찾는다', () => {
    const found = findOverlappingAbsenceCases(monToWed(), tueToThu);
    expect(found).toHaveLength(1);
    expect(found[0]!.absenceCase.id).toBe('case-a');
    expect(found[0]!.lessonIds).toEqual(['rev:lesson:2026-08-18', 'rev:lesson:2026-08-19']);
  });

  it('겹치는 수업이 없으면 안 잡는다', () => {
    expect(findOverlappingAbsenceCases(monToWed(), {
      ...tueToThu, lessonIds: ['rev:lesson:2026-08-20'],
    })).toHaveLength(0);
  });

  it('거둔 요청은 길을 막지 않는다', () => {
    const cancelled = transitionCase(monToWed(), {
      caseId: 'case-a', to: 'cancelled', actorId: '김수학',
      at: '2026-08-16T01:00:00.000Z', auditEventId: 'case-a:cancel',
    });
    expect(findOverlappingAbsenceCases(cancelled, tueToThu)).toHaveLength(0);
  });

  it('다른 교사의 요청은 안 본다', () => {
    expect(findOverlappingAbsenceCases(monToWed(), {
      ...tueToThu, requesterTeacherId: '이영어',
    })).toHaveLength(0);
  });
});
