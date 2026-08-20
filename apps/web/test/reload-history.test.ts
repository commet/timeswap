import { describe, expect, it } from 'vitest';
import { fromNeis, normalizeNeisRows, type NeisRow } from '@timeswap/engine';
import { createWorkspaceFromNeis, type NeisLoadBundle } from '../components/SetupFlow';
import { createAbsenceCase, transitionCase } from '../lib/case-service';
import { validateCasePlan } from '../lib/projections';
import { targetWeekInput } from '../lib/resolution';
import { mapKey } from '../lib/app';
import type { WorkspaceState } from '../lib/domain';

/**
 * 다음 주 시간표를 다시 불러와도 지난 기록이 남는지.
 *
 * 학교는 주마다 나이스를 다시 불러온다. 그때 작업 공간을 통째로 새로 만들면서
 * 사건과 게시 기록, 감사 기록을 전부 빈 배열로 두고 있었다. 한 주를 쓰고 다음 주
 * 시간표를 받는 순간 지난주에 누가 무엇을 결재했는지가 사라진다.
 *
 * 결재가 있는 도구에서 감사 기록이 사라지는 것은 기능 하나가 없는 것과 다르다.
 * 지난주에 그 변경을 누가 승인했는지 물으면 답할 수 없게 된다.
 *
 * 지난 기록은 남기되 이번 주 계산에는 끼어들지 않아야 한다. 사건과 게시는 개정판
 * 번호를 달고 있고, 이번 주 계산은 활성 개정판만 본다.
 */
const row = (date: string, period: string, subject: string): NeisRow => ({
  ALL_TI_YMD: date, GRADE: '1', CLASS_NM: '1', PERIO: period, ITRT_CNTNT: subject,
  SD_SCHUL_CODE: '7010536', AY: '2026', DGHT_CRSE_SC_NM: '주간',
  ORD_SC_NM: '', DDDEP_NM: '', CLRM_NM: '',
} as unknown as NeisRow);

const SUBJECTS = ['국어', '수학', '영어', '과학'];
const rowsOn = (date: string): NeisRow[] =>
  SUBJECTS.map((subject, index) => row(date, String(index + 1), subject));

function build(date: string, from: string, to: string, previous?: WorkspaceState): WorkspaceState {
  const rows = rowsOn(date);
  const bundle = {
    school: { code: '7010536', name: '예시중학교', office: 'J10', kind: '중학교' },
    rows,
    events: [],
    range: { from, to },
    result: { complete: true, checksum: `sha256:${from}`, total: rows.length, pageCount: 1, fetchedAt: `2026-08-18T00:00:00.000Z` },
    report: fromNeis(rows),
  } as unknown as NeisLoadBundle;
  const map = Object.fromEntries(
    normalizeNeisRows(rows).accepted.map((accepted) => [mapKey(accepted.classKey, accepted.subject), '김교사']),
  );
  return createWorkspaceFromNeis(bundle, map, `${from.slice(0, 4)}-08-18T00:00:00.000Z`, previous);
}

const week1 = (): WorkspaceState => build('20260817', '20260817', '20260821');
const week2 = (previous?: WorkspaceState): WorkspaceState =>
  build('20260824', '20260824', '20260828', previous);

/** 지난주 사건을 하나 만들어 둔다. */
function withCase(state: WorkspaceState): WorkspaceState {
  const lesson = state.lessons[0]!;
  const teacherId = lesson.teacher.state === 'assigned' ? lesson.teacher.teacherId : '';
  let next = createAbsenceCase(state, {
    id: 'case-1', auditEventId: 'audit-1', workspaceId: state.workspace.id,
    requesterTeacherId: teacherId, fromDate: lesson.date, toDate: lesson.date,
    reason: '업무상 부재', lessonIds: [lesson.id], at: '2026-08-17T01:00:00.000Z',
  });
  next = transitionCase(next, {
    caseId: 'case-1', to: 'submitted', actorId: teacherId,
    at: '2026-08-17T01:00:00.000Z', auditEventId: 'audit-2',
  });
  return next;
}

describe('다음 주 시간표를 다시 불러올 때', () => {
  it('지난주 사건과 감사 기록이 남는다', () => {
    const first = withCase(week1());
    expect(first.cases).toHaveLength(1);
    expect(first.audit.length).toBeGreaterThan(0);

    const second = week2(first);
    expect(second.cases.map((item) => item.id)).toContain('case-1');
    expect(second.audit.length).toBeGreaterThanOrEqual(first.audit.length);
  });

  it('지난주 개정판도 남는다', () => {
    const second = week2(withCase(week1()));
    expect(second.revisions.length).toBeGreaterThanOrEqual(2);
    const active = second.revisions.find((item) => item.id === second.workspace.activeRevisionId);
    expect(active?.query?.from).toBe('20260824');
  });

  it('지난주 수업이 이번 주 계산에 끼어들지 않는다', () => {
    const second = week2(withCase(week1()));
    const active = second.lessons.filter((lesson) =>
      lesson.revisionId === second.workspace.activeRevisionId);
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((lesson) => lesson.date === '2026-08-24')).toBe(true);
  });

  it('처음 설정할 때는 예전처럼 빈 상태로 시작한다', () => {
    const first = week1();
    expect(first.cases).toEqual([]);
    expect(first.audit).toEqual([]);
    expect(first.revisions).toHaveLength(1);
  });
});

describe('주마다 이어 붙여도 저장 한도를 넘지 않는다', () => {
  it('오래된 주의 수업은 들고 다니지 않는다', () => {
    // 사건과 감사 기록은 작아서 다 남긴다. 수업은 커서 한 주치만 남긴다.
    let state = week1();
    const ids: string[] = [state.workspace.activeRevisionId];
    for (const date of ['20260824', '20260831', '20260907', '20260914']) {
      state = build(date, date, date, state);
      ids.push(state.workspace.activeRevisionId);
    }
    expect(state.revisions.length).toBe(5);
    const withLessons = new Set(state.lessons.map((lesson) => lesson.revisionId));
    // 이번 주와 바로 앞 주만 수업을 들고 있다.
    expect([...withLessons].sort()).toEqual([ids.at(-2)!, ids.at(-1)!].sort());
  });

  it('가장 큰 학교로 스무 주를 이어도 1MB 안쪽이다', () => {
    let state = week1();
    for (let week = 0; week < 20; week += 1) {
      const date = `2026${String(9 + Math.floor(week / 28)).padStart(2, '0')}${String((week % 28) + 1).padStart(2, '0')}`;
      state = build(date, date, date, state);
    }
    const bytes = new TextEncoder().encode(JSON.stringify(state)).length;
    expect(bytes).toBeLessThan(1024 * 1024);
  });
});

/**
 * 다시 불러온 뒤 진행 중이던 사건은 어떻게 되는가.
 *
 * 처음에는 "지난주 계산이니 막혀야 한다"고 적어 두었다. 그것이 틀렸다. 사건은 그
 * 사건의 주에 속하고, 그 안이 가리키는 수업 번호도 그 주 것이다. 지난주 사건을 지난주
 * 격자 위에서 승인하는 것은 이번 주에 지난주 계산을 얹는 일이 아니다.
 *
 * 그때 이 검사들이 통과한 이유는 따로 있었다. 여기 사건에는 고른 안이 아예 없어서,
 * 어긋남이 아니라 "안이 없음"으로 막혔다. 맞는 결과를 틀린 이유로 잠그고 있던 셈이다.
 * 무엇 때문에 막히는지 짚어 다시 적는다.
 *
 * 주가 넘어가도 사건이 살아 있어야 한다는 쪽은 `week-rollover.test.ts` 에 있다.
 */
describe('다시 불러온 뒤 진행 중이던 사건', () => {
  it('사건과 상태가 그대로 남는다', () => {
    const first = withCase(week1());
    const inReview = transitionCase(first, {
      caseId: 'case-1', to: 'in_review', actorId: 'ops',
      at: '2026-08-17T02:00:00.000Z', auditEventId: 'audit-3',
    });
    const second = week2(inReview);
    expect(second.cases.find((item) => item.id === 'case-1')?.status).toBe('in_review');
    // 그 사건이 딛고 선 수업도 남아 있다. 없으면 다시 풀 길이 없다.
    expect(second.lessons.some((lesson) => lesson.id === second.cases[0]!.lessonIds[0])).toBe(true);
  });

  it('고른 안이 없으면 어느 주 사건이든 승인이 막힌다', () => {
    const first = withCase(week1());
    const inReview = transitionCase(first, {
      caseId: 'case-1', to: 'in_review', actorId: 'ops',
      at: '2026-08-17T02:00:00.000Z', auditEventId: 'audit-3',
    });
    const second = week2(inReview);

    const validation = validateCasePlan(second, 'case-1');
    expect(validation.valid).toBe(false);
    // 막는 이유가 어긋남이 아니라 "점유 상태 미확정"인 것을 짚는다.
    expect(validation.staleRevision).toBe(false);
    expect(validation.conflicts.map((item) => item.kind)).toContain('unknown-occupancy');

    expect(() => transitionCase(second, {
      caseId: 'case-1', to: 'resolution_approved', actorId: 'ops',
      at: '2026-08-25T01:00:00.000Z', auditEventId: 'audit-4',
    })).toThrow('unresolved conflicts');
  });

  it('지난주에 게시한 변경이 이번 주 시간표에 얹히지 않는다', () => {
    const first = withCase(week1());
    const second = week2(first);
    // 이번 주 수업은 전부 새 개정판 것이고 지난주 게시는 그 번호를 안 가리킨다.
    const active = second.lessons.filter((lesson) =>
      lesson.revisionId === second.workspace.activeRevisionId);
    const { input } = targetWeekInput(second, active[0]!.date);
    expect(input.assignments.length).toBe(active.filter((lesson) =>
      lesson.teacher.state === 'assigned').length);
  });
});
