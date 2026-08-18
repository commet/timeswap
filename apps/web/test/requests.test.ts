import { describe, expect, it } from 'vitest';
import type { Assignment, Candidate, CoverCandidate } from '@timeswap/engine';
import {
  createCoverRequest,
  createRequest,
  decodeRequests,
  selectCandidate,
  setChecklist,
  transitionRequest,
} from '../lib/requests';

const target: Assignment = {
  teacher: '김수학',
  klass: '2-3',
  subject: '수학',
  slot: 9,
};

const candidate: Candidate = {
  type: 'swap2',
  title: '이과학 선생님과 맞바꾸기',
  score: -15,
  unitCount: 2,
  changes: [
    { from: target, toSlot: 18 },
    {
      from: { teacher: '이과학', klass: '1-2', subject: '과학', slot: 18 },
      toSlot: 9,
    },
  ],
  trace: [{ kind: '조건', text: '두 선생님이 옮길 시간에 비어 있습니다' }],
};

const cover: CoverCandidate = {
  teacher: '박국어', sameSubject: false, proTeacher: false, weeklyLessons: 16,
  dayLessons: 2, recentBurden: 0, runAfter: 2, score: 4, notes: ['그날 수업이 2시간입니다'],
};

describe('변경 요청', () => {
  it('날짜와 선택한 수업, 후보를 한 요청에 보존한다', () => {
    const request = createRequest(
      {
        date: '2026-08-20',
        teacher: '김수학',
        reason: '연수·출장',
        note: '오전 연수',
        target,
        candidate,
      },
      { id: 'req-1', now: '2026-08-18T03:00:00.000Z' },
    );

    expect(request).toMatchObject({
      id: 'req-1',
      createdAt: '2026-08-18T03:00:00.000Z',
      date: '2026-08-20',
      teacher: '김수학',
      reason: '연수·출장',
      note: '오전 연수',
      status: 'pending',
      target,
      candidate,
      checklist: { neis: false, notice: false, document: false },
      kind: 'change',
    });
  });

  it('교체가 안 되는 수업은 보강 후보를 별도 요청으로 보존한다', () => {
    const request = createCoverRequest(
      { date: '2026-08-20', teacher: '김수학', reason: '업무상 부재', target, cover },
      { id: 'cover-1', now: '2026-08-18T03:00:00.000Z' },
    );
    expect(request.kind).toBe('cover');
    expect(request.cover).toEqual(cover);
    expect(request.candidate.title).toContain('박국어');
  });

  it('빈 날짜나 수업이 없는 요청은 만들지 않는다', () => {
    expect(() =>
      createRequest({
        date: '',
        teacher: '김수학',
        reason: '업무상 부재',
        target,
        candidate,
      }),
    ).toThrow('날짜');

    expect(() =>
      createRequest({
        date: '2026-08-20',
        teacher: '',
        reason: '업무상 부재',
        target,
        candidate,
      }),
    ).toThrow('요청자');
  });

  it('검토 중 요청만 승인, 반려, 취소할 수 있다', () => {
    const pending = createRequest({
      date: '2026-08-20',
      teacher: '김수학',
      reason: '업무상 부재',
      target,
      candidate,
    });
    const approved = transitionRequest(pending, 'approved');

    expect(approved.status).toBe('approved');
    expect(() => transitionRequest(approved, 'rejected')).toThrow('상태');
    expect(transitionRequest(pending, 'cancelled').status).toBe('cancelled');
  });

  it('담당자는 검토 중인 요청을 함께 저장된 다른 안으로 바꿀 수 있다', () => {
    const alternative = { ...candidate, title: '다른 교체안', score: -20 };
    const pending = createRequest({
      date: '2026-08-20', teacher: '김수학', reason: '업무상 부재', target,
      candidate, alternatives: [candidate, alternative],
    });
    expect(selectCandidate(pending, alternative).candidate.title).toBe('다른 교체안');
    expect(() => selectCandidate(transitionRequest(pending, 'approved'), alternative)).toThrow('검토');
  });

  it('행정 세 단계를 마친 승인 요청만 게시할 수 있다', () => {
    const pending = createRequest({
      date: '2026-08-20',
      teacher: '김수학',
      reason: '기타',
      target,
      candidate,
    });
    const approved = transitionRequest(pending, 'approved');

    expect(() => transitionRequest(approved, 'published')).toThrow('행정');

    const ready = setChecklist(
      setChecklist(setChecklist(approved, 'neis', true), 'notice', true),
      'document',
      true,
    );
    expect(transitionRequest(ready, 'published').status).toBe('published');
  });

  it('손상되거나 판이 다른 저장값은 빈 목록으로 복구한다', () => {
    expect(decodeRequests('not json')).toEqual([]);
    expect(decodeRequests(JSON.stringify({ version: 99, requests: [] }))).toEqual([]);
  });
});
