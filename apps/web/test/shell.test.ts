import { describe, expect, it } from 'vitest';
import { fromNeis, type NeisRow } from '@timeswap/engine';

import { createDemoWorkspace } from '../lib/demo';
import * as SetupFlowModule from '../components/SetupFlow';
import {
  canOpenInvitations,
  canEnterSetupStage,
  completeSetupReview,
  createInvitationLinks,
  createWorkspaceFromNeis,
  type NeisLoadBundle,
} from '../components/SetupFlow';
import { createNeisSession } from '../lib/neis-session';

const rows: NeisRow[] = [{
  SCHUL_NM: '보기고등학교',
  SD_SCHUL_CODE: '7010569',
  AY: '2026',
  DGHT_CRSE_SC_NM: '주간',
  ORD_SC_NM: '일반계',
  DDDEP_NM: '공통',
  ALL_TI_YMD: '20260810',
  GRADE: '2',
  CLASS_NM: '1',
  PERIO: '3',
  ITRT_CNTNT: '기계일반',
  CLRM_NM: '기계실습실',
}];

const bundle: NeisLoadBundle = {
  school: {
    office: 'B10', officeName: '서울특별시교육청', code: '7010569',
    name: '보기고등학교', kind: '고등학교',
  },
  rows,
  events: [],
  range: { from: '20260810', to: '20260814' },
  result: {
    total: 1, pageCount: 1, complete: true, truncated: false,
    fetchedAt: '2026-08-18T01:02:03.000Z',
  },
  report: fromNeis(rows),
};

describe('school setup boundary', () => {
  it('persists the exact selected teaching week and official load diagnostics', () => {
    const state = createWorkspaceFromNeis(
      bundle,
      { '2-1|기계일반': 'teacher:seo-jun' },
      '2026-08-18T02:00:00.000Z',
    );

    expect(state.revisions[0]).toMatchObject({
      source: 'neis',
      complete: true,
      loadedAt: '2026-08-18T01:02:03.000Z',
      query: {
        from: '20260810', to: '20260814', academicYear: '2026',
        rawRows: '1', receivedRows: '1', expectedRows: '1', pageCount: '1', acceptedRows: '1', quarantinedRows: '0',
        duplicateRows: '0', parallelGroups: '0',
      },
    });
    expect(state.lessons).toEqual([
      expect.objectContaining({
        date: '2026-08-10', period: '3', subject: '기계일반',
        teacher: {
          state: 'assigned',
          teacherId: expect.stringMatching(/^member:[0-9a-f]{16}$/),
        },
      }),
    ]);
    const assignedTeacher = state.lessons[0]!.teacher;
    if (assignedTeacher.state !== 'assigned') throw new Error('teacher must be assigned');
    expect(state.teacherLabels).toEqual({ [assignedTeacher.teacherId]: 'teacher:seo-jun' });
  });

  it('persists the received NEIS rows separately from the official expected count', () => {
    const partialRows = Array.from({ length: 5 }, () => rows[0]!);
    const partial = createWorkspaceFromNeis({
      ...bundle,
      rows: partialRows,
      result: { ...bundle.result, total: 6, complete: false, truncated: true },
    }, {});

    expect(partial.revisions[0]).toMatchObject({
      complete: false,
      query: { receivedRows: '5', expectedRows: '6' },
    });
  });

  it('keeps invitations locked until the official page set and every teacher are resolved', () => {
    expect(canOpenInvitations({ sourceComplete: false, unresolvedTeacherCount: 0 })).toBe(false);
    expect(canOpenInvitations({ sourceComplete: true, unresolvedTeacherCount: 1 })).toBe(false);
    expect(canOpenInvitations({ sourceComplete: true, unresolvedTeacherCount: 0 })).toBe(true);
  });

  it('keeps mapping and review behind the completeness checkpoint', () => {
    expect(canEnterSetupStage('교사 연결', {
      hasSchool: true, hasSessionKey: true, hasBundle: true,
      sourceComplete: false, invitationsReady: false,
    })).toBe(false);
    expect(canEnterSetupStage('미해결 검토', {
      hasSchool: true, hasSessionKey: true, hasBundle: true,
      sourceComplete: true, invitationsReady: false,
    })).toBe(true);
    expect(canEnterSetupStage('초대 링크', {
      hasSchool: true, hasSessionKey: true, hasBundle: true,
      sourceComplete: true, invitationsReady: false,
    })).toBe(false);
  });

  it('clears the session key and returns a completed workspace only after setup persistence succeeds', async () => {
    const session = createNeisSession();
    session.setKey('secret-key');
    const complete = (SetupFlowModule as unknown as {
      completeSetupReview: (
        input: NeisLoadBundle,
        teacherMap: Record<string, string>,
        credential: { clear(): void },
        save: (state: ReturnType<typeof createWorkspaceFromNeis>) => { ok: true } | { ok: false; reason: 'quota' | 'unavailable' },
      ) => Promise<{ ok: true; state: ReturnType<typeof createWorkspaceFromNeis> } | { ok: false; reason: 'quota' | 'unavailable' }>;
    }).completeSetupReview;

    const result = await complete(bundle, { '2-1|기계일반': '김서준' }, session, () => ({ ok: true }));

    expect(session.getKey()).toBe('');
    expect(result).toEqual({
      ok: true,
      state: expect.objectContaining({ workspace: expect.objectContaining({ name: '보기고등학교' }) }),
    });
  });

  it.each(['quota', 'unavailable'] as const)('keeps setup credentials and review state usable after a %s persistence failure', async (reason) => {
    const session = createNeisSession();
    session.setKey('secret-key');
    const complete = (SetupFlowModule as unknown as {
      completeSetupReview: (
        input: NeisLoadBundle,
        teacherMap: Record<string, string>,
        credential: { clear(): void },
        save: (state: ReturnType<typeof createWorkspaceFromNeis>) => { ok: true } | { ok: false; reason: 'quota' | 'unavailable' },
      ) => Promise<{ ok: true; state: ReturnType<typeof createWorkspaceFromNeis> } | { ok: false; reason: 'quota' | 'unavailable' }>;
    }).completeSetupReview;

    const result = await complete(bundle, { '2-1|기계일반': '김서준' }, session, () => ({ ok: false, reason }));

    expect(result).toEqual({ ok: false, reason });
    expect(session.getKey()).toBe('secret-key');
  });

  it.each(['quota', 'unavailable'] as const)('gives an actionable %s setup recovery message without asking for a new key', (reason) => {
    const messageForSetupPersistenceFailure = (SetupFlowModule as unknown as {
      messageForSetupPersistenceFailure?: (reason: 'quota' | 'unavailable') => string;
    }).messageForSetupPersistenceFailure;

    expect(messageForSetupPersistenceFailure).toBeTypeOf('function');
    if (typeof messageForSetupPersistenceFailure !== 'function') return;
    expect(messageForSetupPersistenceFailure(reason)).toContain('다시');
    expect(messageForSetupPersistenceFailure(reason)).toContain('인증키');
  });

  it('uses a deterministic opaque member id in teacher invitation URLs', () => {
    const teacherName = '김서준';
    const first = createWorkspaceFromNeis(bundle, { '2-1|기계일반': teacherName });
    const second = createWorkspaceFromNeis(bundle, { '2-1|기계일반': teacherName });
    const firstTeacher = first.lessons[0]!.teacher;
    const secondTeacher = second.lessons[0]!.teacher;
    if (firstTeacher.state !== 'assigned' || secondTeacher.state !== 'assigned') throw new Error('teacher must be assigned');

    expect(firstTeacher.teacherId).toMatch(/^member:[0-9a-f]{16}$/);
    expect(firstTeacher.teacherId).toBe(secondTeacher.teacherId);
    expect(firstTeacher.teacherId).not.toContain(teacherName);

    const link = createInvitationLinks(
      first,
      'https://joyul.example',
      { [firstTeacher.teacherId]: teacherName },
    ).teachers[0]!;
    expect(new URL(link.href).searchParams.get('teacher')).toBe(firstTeacher.teacherId);
    expect(new URL(link.href).searchParams.get('teacher')).not.toContain(teacherName);
    expect(link.label).toBe(teacherName);
  });

  it('generates allowlisted static teacher and class identities only', () => {
    const state = createDemoWorkspace();
    state.cases[0]!.note = '내부 메모 secret-key';

    const links = createInvitationLinks(state, 'https://joyul.example');

    expect(links.teachers[0]?.href).toMatch(
      /^https:\/\/joyul\.example\/\?view=teacher&school=[^&]+&teacher=[^&]+$/,
    );
    expect(links.classes[0]?.href).toMatch(
      /^https:\/\/joyul\.example\/\?view=class&school=[^&]+&grade=[^&]+&class=[^&]+$/,
    );
    expect(JSON.stringify(links)).not.toContain('내부 메모');
    expect(JSON.stringify(links)).not.toContain('secret-key');
    expect(JSON.stringify(links)).not.toContain('payload');
  });
});
