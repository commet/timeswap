import { describe, expect, it, vi } from 'vitest';
import {
  fetchAllNeisRows,
  findRecentTeachingWeek,
  loadTimetable,
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
