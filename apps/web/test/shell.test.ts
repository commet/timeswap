import { describe, expect, it } from 'vitest';
import { fromNeis, type NeisRow } from '@timeswap/engine';

import { createDemoWorkspace } from '../lib/demo';
import {
  canOpenInvitations,
  canEnterSetupStage,
  createInvitationLinks,
  createWorkspaceFromNeis,
  type NeisLoadBundle,
} from '../components/SetupFlow';

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
        rawRows: '1', pageCount: '1', acceptedRows: '1', quarantinedRows: '0',
        duplicateRows: '0', parallelGroups: '0',
      },
    });
    expect(state.lessons).toEqual([
      expect.objectContaining({
        date: '2026-08-10', period: '3', subject: '기계일반',
        teacher: { state: 'assigned', teacherId: 'teacher:seo-jun' },
      }),
    ]);
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
