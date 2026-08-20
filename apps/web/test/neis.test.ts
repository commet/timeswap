import { describe, expect, it, vi } from 'vitest';
import {
  fetchAllNeisRows,
  findRecentTeachingWeek,
  loadTimetable,
  timetableEndpointOf,
  timetableEndpointsOf,
  type NeisRequest,
  type NeisSchool,
} from '../lib/neis';

const school: NeisSchool = {
  office: 'B10',
  officeName: '서울특별시교육청',
  code: '7010569',
  name: '보기고등학교',
  kind: '고등학교',
};

const response = (endpoint: string, total: number, rows: unknown[]) =>
  new Response(
    JSON.stringify({ [endpoint]: [{ head: [{ list_total_count: total }] }, { row: rows }] }),
    { status: 200 },
  );

const request = (fetch: typeof globalThis.fetch): NeisRequest => ({
  endpoint: 'hisTimetable',
  params: { ATPT_OFCDC_SC_CODE: school.office, SD_SCHUL_CODE: school.code },
  key: 'in-memory-key',
  fetch,
  now: () => new Date('2026-08-18T01:02:03.000Z'),
});

describe('complete NEIS page loading', () => {
  it('retains all 1,001 raw rows across two pages', async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => ({ id: i }));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response('hisTimetable', 1001, rows.slice(0, 1000)))
      .mockResolvedValueOnce(response('hisTimetable', 1001, rows.slice(1000)));

    await expect(fetchAllNeisRows<{ id: number }>(request(fetch))).resolves.toMatchObject({
      rows,
      total: 1001,
      pageCount: 2,
      complete: true,
      truncated: false,
      fetchedAt: '2026-08-18T01:02:03.000Z',
    });
  });

  it('counts duplicate facts as separate raw response rows', async () => {
    const duplicate = { ALL_TI_YMD: '20260818', PERIO: '1' };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response('hisTimetable', 2, [duplicate, duplicate]));

    const result = await fetchAllNeisRows(request(fetch));
    expect(result.rows).toEqual([duplicate, duplicate]);
    expect(result.complete).toBe(true);
  });

  it('rejects a repeated whole page that stalls progress', async () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response('hisTimetable', 3, rows))
      .mockResolvedValueOnce(response('hisTimetable', 3, rows));

    await expect(fetchAllNeisRows(request(fetch))).rejects.toMatchObject({ code: 'INCOMPLETE_PAGE_SET' });
  });

  it('rejects a raw row count that disagrees with the official total', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response('hisTimetable', 3, [{ id: 1 }, { id: 2 }]))
      .mockResolvedValueOnce(response('hisTimetable', 3, []));

    await expect(fetchAllNeisRows(request(fetch))).rejects.toMatchObject({ code: 'INCOMPLETE_PAGE_SET' });
  });

  /**
   * 얼마나 모자란지를 말하지 않으면 담당자는 다시 시도할지 학교에 물을지 정할 수
   * 없다. 그래서 문구가 받은 수와 공식 총계를 함께 담는지 잠근다.
   */
  it('names how many rows arrived out of the official total', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response('hisTimetable', 6, [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]))
      .mockResolvedValueOnce(response('hisTimetable', 6, []));

    await expect(fetchAllNeisRows(request(fetch))).rejects.toMatchObject({
      code: 'INCOMPLETE_PAGE_SET',
      message: expect.stringContaining('6건 가운데 5건'),
    });
  });
});

describe('timetable safety', () => {
  it('rejects the documented 2023-08 through 2024 academic-year historical gap', async () => {
    await expect(
      loadTimetable({ school, from: '20240819', to: '20240823', key: 'in-memory-key' }),
    ).rejects.toMatchObject({ code: 'HISTORICAL_GAP', message: expect.stringContaining('일반 API로 이용할 수 없습니다') });
  });

  it('marks a keyless five-row timetable response incomplete', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      response('hisTimetable', 5, Array.from({ length: 5 }, (_, id) => ({ id }))),
    );
    const result = await loadTimetable({ school, from: '20260817', to: '20260821', fetch });
    expect(result).toMatchObject({ rows: expect.any(Array), complete: false, truncated: true });
  });

  it('selects the first complete non-empty week when the current week is empty', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response('hisTimetable', 0, []))
      .mockResolvedValueOnce(response('hisTimetable', 1, [{ ALL_TI_YMD: '20260810' }]));

    const result = await findRecentTeachingWeek({
      school,
      from: '20260817',
      to: '20260821',
      key: 'in-memory-key',
      fetch,
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    });
    expect(result.rows).toHaveLength(1);
    expect(result.range).toEqual({ from: '20260810', to: '20260814' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('reports NO_DATA after five complete empty weeks', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(response('hisTimetable', 0, [])));
    await expect(
      findRecentTeachingWeek({ school, from: '20260817', to: '20260821', key: 'in-memory-key', fetch }),
    ).rejects.toMatchObject({ code: 'NO_DATA' });
  });

  it('maps official rate-limit, authentication, and transport failures to typed codes', async () => {
    const officialFailure = (code: string, message: string) =>
      new Response(JSON.stringify({ RESULT: { CODE: code, MESSAGE: message } }), { status: 200 });
    await expect(
      loadTimetable({ school, from: '20260817', to: '20260821', key: 'in-memory-key', fetch: vi.fn().mockResolvedValue(officialFailure('337', '호출 제한')) }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await expect(
      loadTimetable({ school, from: '20260817', to: '20260821', key: 'in-memory-key', fetch: vi.fn().mockResolvedValue(officialFailure('INFO-300', '인증키가 필요합니다')) }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(
      loadTimetable({ school, from: '20260817', to: '20260821', key: 'in-memory-key', fetch: vi.fn().mockRejectedValue(new TypeError('offline')) }),
    ).rejects.toMatchObject({ code: 'NETWORK' });
  });
});

/**
 * 학교 종류가 스물세 가지인데 이름만 보고 엔드포인트를 하나 고르면 틀린다.
 * 실제로 불러 확인하니 각종학교(중) 38곳, 방송통신중학교 24곳, 평생학교(중) 19곳,
 * 각종학교(초) 8곳, 평생학교(초) 5곳이 이름과 다른 곳에서 자료를 준다.
 * 그대로 두면 94곳의 선생님이 시간표가 있는데도 "없습니다"를 본다.
 */
describe('학교 종류와 시간표 엔드포인트', () => {
  it('초중고 특수는 첫 번째가 바로 맞는다', () => {
    expect(timetableEndpointOf('초등학교')).toBe('elsTimetable');
    expect(timetableEndpointOf('중학교')).toBe('misTimetable');
    expect(timetableEndpointOf('고등학교')).toBe('hisTimetable');
    expect(timetableEndpointOf('특수학교')).toBe('spsTimetable');
  });

  it('이름에 초나 중이 들어간 다른 종류도 알맞은 곳을 먼저 본다', () => {
    expect(timetableEndpointOf('각종학교(중)')).toBe('misTimetable');
    expect(timetableEndpointOf('방송통신중학교')).toBe('misTimetable');
    expect(timetableEndpointOf('평생학교(중)-2년6학기')).toBe('misTimetable');
    expect(timetableEndpointOf('각종학교(초)')).toBe('elsTimetable');
    expect(timetableEndpointOf('평생학교(초)-3년6학기')).toBe('elsTimetable');
    expect(timetableEndpointOf('각종학교(고)')).toBe('hisTimetable');
    expect(timetableEndpointOf('방송통신고등학교')).toBe('hisTimetable');
  });

  it('모르는 종류도 네 곳을 모두 후보로 든다', () => {
    expect(timetableEndpointsOf('공동실습소')).toHaveLength(4);
    expect(timetableEndpointsOf('없는학교종류')[0]).toBe('hisTimetable');
    expect(new Set(timetableEndpointsOf('초등학교')).size).toBe(4);
  });

  it('첫 엔드포인트로 다섯 주가 비면 남은 곳을 한 번씩 더 본다', async () => {
    // 각종학교(중)처럼 이름과 자료가 어긋난 학교다. mis 에 자료가 있다.
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((url) => {
      const has = String(url).includes('misTimetable');
      return Promise.resolve(
        response(has ? 'misTimetable' : 'hisTimetable', has ? 1 : 0, has ? [{ ALL_TI_YMD: '20260817' }] : []),
      );
    });
    const result = await findRecentTeachingWeek({
      school: { ...school, kind: '각종학교(중)' },
      from: '20260817',
      to: '20260821',
      key: 'in-memory-key',
      fetch,
      now: () => new Date('2026-08-18T12:00:00.000Z'),
    });
    expect(result.rows).toHaveLength(1);
    // 다섯 주를 mis 로 다시 도는 것이 아니라 가장 최근 주만 본다
    expect(fetch.mock.calls.filter((c) => String(c[0]).includes('misTimetable'))).toHaveLength(1);
  });

  it('초중고는 대비책 호출을 하지 않는다', async () => {
    // 96%가 여기 해당한다. 값을 더 내면 안 된다.
    // 실제 나이스는 어느 엔드포인트를 불러도 그 이름으로 답한다. 목도 그렇게 둔다.
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((url) => {
      const ep = /hub\/(\w+)\?/.exec(String(url))?.[1] ?? 'hisTimetable';
      return Promise.resolve(response(ep, 0, []));
    });
    await expect(
      findRecentTeachingWeek({
        school,
        from: '20260817',
        to: '20260821',
        key: 'in-memory-key',
        fetch,
        now: () => new Date('2026-08-18T12:00:00.000Z'),
      }),
    ).rejects.toThrow(/최근 5주/);
    // 다섯 주 곱하기 his 하나, 그다음 대비책 셋
    expect(fetch.mock.calls.filter((c) => String(c[0]).includes('hisTimetable'))).toHaveLength(5);
    expect(fetch.mock.calls).toHaveLength(8);
  });
});
