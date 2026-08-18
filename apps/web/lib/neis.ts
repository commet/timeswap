import type { NeisRow } from '@timeswap/engine';

const HUB = 'https://open.neis.go.kr/hub';
export const NEIS_KEY_GUIDE = 'https://open.neis.go.kr/portal/guide/actKeyPage.do';

export type NeisFailureCode = 'NO_DATA' | 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'HISTORICAL_GAP' | 'INCOMPLETE_PAGE_SET' | 'NETWORK';

export class NeisFailure extends Error {
  constructor(readonly code: NeisFailureCode, message: string) {
    super(message);
    this.name = 'NeisFailure';
  }
}

export type NeisEndpoint =
  | 'schoolInfo' | 'classInfo' | 'SchoolSchedule' | 'schulAflcoinfo' | 'schoolMajorinfo' | 'tiClrminfo'
  | 'elsTimetable' | 'misTimetable' | 'spsTimetable' | 'hisTimetable';

export interface NeisRequest {
  endpoint: NeisEndpoint;
  params: Record<string, string>;
  /** Memory-only credential. It is never persisted or returned to the UI. */
  key?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

export interface NeisSchool {
  office: string;
  officeName: string;
  code: string;
  name: string;
  kind: string;
  /** A keyless school search is intentionally shown as a limited preview. */
  preview?: boolean;
}

export interface NeisCallResult<T> { rows: T[]; total: number; truncated: boolean; }
export interface CompleteNeisResult<T> extends NeisCallResult<T> { fetchedAt: string; pageCount: number; complete: boolean; }
export interface TeachingWeekResult extends CompleteNeisResult<NeisRow> {
  range: { from: string; to: string };
}

interface HeadPart { head?: Array<{ list_total_count?: number; RESULT?: { CODE?: string; MESSAGE?: string } }>; }
interface NeisResultPart { CODE?: string; MESSAGE?: string; }

function failureFrom(result: NeisResultPart): NeisFailure | null {
  const official = result.CODE ?? '';
  const message = result.MESSAGE ?? official;
  if (!official || official === 'INFO-000') return null;
  if (official === '337' || official.endsWith('-337') || message.includes('호출 제한') || message.includes('초과')) return new NeisFailure('RATE_LIMITED', message || '나이스 호출 한도를 초과했습니다.');
  if (message.includes('인증키') || message.includes('인증') || official.includes('KEY')) return new NeisFailure('AUTH_REQUIRED', message || '나이스 인증키가 필요합니다.');
  if (message.includes('데이터가 없') || message.includes('해당하는 데이터')) return null;
  return new NeisFailure('NETWORK', message || '나이스 요청에 실패했습니다.');
}

function resultAt(json: Record<string, unknown>, endpoint: NeisEndpoint): NeisResultPart | undefined {
  const top = json.RESULT as NeisResultPart | undefined;
  if (top) return top;
  const body = json[endpoint] as [HeadPart] | undefined;
  return body?.[0]?.head?.[0]?.RESULT;
}

function queryOf(params: Record<string, string>, pIndex: number): string {
  return new URLSearchParams({ ...params, Type: 'json', pIndex: String(pIndex), pSize: '1000' }).toString();
}

async function page<T>(request: NeisRequest, pIndex: number): Promise<{ rows: T[]; total: number }> {
  const credential = request.key ? `&KEY=${request.key}` : '';
  let response: Response;
  try {
    response = await (request.fetch ?? globalThis.fetch)(`${HUB}/${request.endpoint}?${queryOf(request.params, pIndex)}${credential}`);
  } catch {
    throw new NeisFailure('NETWORK', '나이스에 연결하지 못했습니다. 네트워크를 확인해 주십시오.');
  }
  if (!response.ok) throw new NeisFailure('NETWORK', `나이스 응답 오류 ${response.status}`);
  let json: Record<string, unknown>;
  try { json = (await response.json()) as Record<string, unknown>; }
  catch { throw new NeisFailure('NETWORK', '나이스 응답을 읽지 못했습니다.'); }
  const failure = failureFrom(resultAt(json, request.endpoint) ?? {});
  if (failure) throw failure;
  const body = json[request.endpoint] as [HeadPart, { row?: T[] }] | undefined;
  return { total: body?.[0]?.head?.[0]?.list_total_count ?? 0, rows: body?.[1]?.row ?? [] };
}

function samePage(a: unknown[], b: unknown[]): boolean {
  return a.length > 0 && a.length === b.length && JSON.stringify(a) === JSON.stringify(b);
}

/** Fetch every official page; raw facts (including duplicates) remain untouched here. */
export async function fetchAllNeisRows<T>(request: NeisRequest): Promise<CompleteNeisResult<T>> {
  const fetchedAt = (request.now ?? (() => new Date()))().toISOString();
  const first = await page<T>(request, 1);
  if (!request.key) return { ...first, fetchedAt, pageCount: 1, complete: first.total === 0, truncated: first.total > 0 };
  const rows = [...first.rows];
  let pageCount = 1;
  let previous = first.rows;
  while (rows.length < first.total) {
    const next = await page<T>(request, pageCount + 1);
    pageCount += 1;
    if (next.total !== first.total || next.rows.length === 0 || samePage(previous, next.rows)) {
      throw new NeisFailure('INCOMPLETE_PAGE_SET', '나이스 페이지 묶음이 온전하지 않습니다. 부분 시간표는 사용하지 않습니다.');
    }
    rows.push(...next.rows);
    previous = next.rows;
  }
  if (rows.length !== first.total) throw new NeisFailure('INCOMPLETE_PAGE_SET', '나이스가 알린 행 수와 받은 행 수가 다릅니다. 부분 시간표는 사용하지 않습니다.');
  return { rows, total: first.total, truncated: false, fetchedAt, pageCount, complete: true };
}

interface SchoolInfoRow { ATPT_OFCDC_SC_CODE: string; ATPT_OFCDC_SC_NM: string; SD_SCHUL_CODE: string; SCHUL_NM: string; SCHUL_KND_SC_NM: string; }

export async function searchSchools(name: string, key?: string, fetch?: typeof globalThis.fetch): Promise<NeisSchool[]> {
  const q = name.trim();
  if (q.length < 2) return [];
  const result = await fetchAllNeisRows<SchoolInfoRow>({ endpoint: 'schoolInfo', params: { SCHUL_NM: q }, key, fetch });
  return result.rows.map((r) => ({ office: r.ATPT_OFCDC_SC_CODE, officeName: r.ATPT_OFCDC_SC_NM, code: r.SD_SCHUL_CODE, name: r.SCHUL_NM, kind: r.SCHUL_KND_SC_NM, preview: !result.complete }));
}

export function timetableEndpointOf(kind: string): Extract<NeisEndpoint, `${string}Timetable`> {
  if (kind.startsWith('초등')) return 'elsTimetable';
  if (kind.startsWith('중학')) return 'misTimetable';
  if (kind.startsWith('특수')) return 'spsTimetable';
  return 'hisTimetable';
}

export interface TimetableQuery { school: NeisSchool; from: string; to: string; key?: string; grade?: string; fetch?: typeof globalThis.fetch; now?: () => Date; }
const GAP_START = '20230801';
const GAP_END = '20250228';

function timetableRequest(q: TimetableQuery, from = q.from, to = q.to): NeisRequest {
  if (from <= GAP_END && to >= GAP_START) throw new NeisFailure('HISTORICAL_GAP', '2023년 8월부터 2024학년도까지의 시간표는 일반 API로 이용할 수 없습니다. 수업이 없는 주로 해석하지 마십시오.');
  const params: Record<string, string> = { ATPT_OFCDC_SC_CODE: q.school.office, SD_SCHUL_CODE: q.school.code, TI_FROM_YMD: from, TI_TO_YMD: to };
  if (q.grade) params.GRADE = q.grade;
  return { endpoint: timetableEndpointOf(q.school.kind), params, key: q.key, fetch: q.fetch, now: q.now };
}

export async function loadTimetable(q: TimetableQuery): Promise<CompleteNeisResult<NeisRow>> {
  return fetchAllNeisRows<NeisRow>(timetableRequest(q));
}

function ymd(d: Date): string { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }

/** Find the most recent complete week containing rows, never an empty timetable. */
export async function findRecentTeachingWeek(query: TimetableQuery): Promise<TeachingWeekResult> {
  const current = new Date(query.now?.() ?? new Date());
  current.setHours(0, 0, 0, 0);
  current.setDate(current.getDate() - ((current.getDay() + 6) % 7));
  for (let weeksBack = 0; weeksBack < 5; weeksBack += 1) {
    const monday = new Date(current); monday.setDate(monday.getDate() - weeksBack * 7);
    const friday = new Date(monday); friday.setDate(friday.getDate() + 4);
    const result = await fetchAllNeisRows<NeisRow>(timetableRequest(query, ymd(monday), ymd(friday)));
    if (!result.complete || result.rows.length > 0) {
      return { ...result, range: { from: ymd(monday), to: ymd(friday) } };
    }
  }
  throw new NeisFailure('NO_DATA', '최근 5주에 공개된 시간표가 없습니다. 빈 시간표로 시작하지 마십시오.');
}

export interface NeisEvent { date: string; name: string; kind: string; grades: boolean[]; isHoliday: boolean; }
interface ScheduleRow { AA_YMD: string; EVENT_NM: string; SBTR_DD_SC_NM?: string; ONE_GRADE_EVENT_YN?: string; TW_GRADE_EVENT_YN?: string; THREE_GRADE_EVENT_YN?: string; FR_GRADE_EVENT_YN?: string; FIV_GRADE_EVENT_YN?: string; SIX_GRADE_EVENT_YN?: string; }

export async function loadSchedule(q: { school: NeisSchool; from: string; to: string; key?: string; fetch?: typeof globalThis.fetch; now?: () => Date }): Promise<CompleteNeisResult<NeisEvent>> {
  const result = await fetchAllNeisRows<ScheduleRow>({ endpoint: 'SchoolSchedule', params: { ATPT_OFCDC_SC_CODE: q.school.office, SD_SCHUL_CODE: q.school.code, AA_FROM_YMD: q.from, AA_TO_YMD: q.to }, key: q.key, fetch: q.fetch, now: q.now });
  return { ...result, rows: result.rows.map((r) => {
    const kind = r.SBTR_DD_SC_NM ?? '해당없음';
    return { date: r.AA_YMD, name: r.EVENT_NM, kind, grades: [r.ONE_GRADE_EVENT_YN, r.TW_GRADE_EVENT_YN, r.THREE_GRADE_EVENT_YN, r.FR_GRADE_EVENT_YN, r.FIV_GRADE_EVENT_YN, r.SIX_GRADE_EVENT_YN].map((v) => v === 'Y'), isHoliday: kind === '휴업일' || kind === '공휴일' };
  }) };
}

export function recentRange(weeks = 5, today = new Date()): { from: string; to: string } {
  const to = new Date(today); to.setDate(to.getDate() + 7);
  const from = new Date(today); from.setDate(from.getDate() - weeks * 7);
  return { from: ymd(from), to: ymd(to) };
}
