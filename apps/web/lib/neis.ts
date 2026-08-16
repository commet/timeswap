import type { NeisRow } from '@timeswap/engine';

/**
 * 나이스 교육정보 개방 포털 클라이언트.
 *
 * 교육부가 공개하는 자료이고 응답 헤더가 모든 출처를 허용하므로 브라우저에서 바로 부른다.
 * 서버를 거치지 않으니 학교 자료가 우리 쪽에 남지 않는다.
 *
 * 인증키가 없으면 호출당 5행에서 끊기고 페이지 넘김도 동작하지 않는다.
 * 키는 포털에서 무료로 발급하며, 이용자가 자기 키를 넣으면 학교 전체를 한 번에 불러온다.
 */

const HUB = 'https://open.neis.go.kr/hub';
export const NEIS_KEY_GUIDE = 'https://open.neis.go.kr/portal/guide/actKeyPage.do';

export interface NeisSchool {
  /** 시도교육청 코드 */
  office: string;
  officeName: string;
  /** 표준학교 코드 */
  code: string;
  name: string;
  /** 초등학교, 중학교, 고등학교, 특수학교 */
  kind: string;
}

export interface NeisCallResult<T> {
  rows: T[];
  total: number;
  /** 키가 없어 5행에서 끊긴 경우 */
  truncated: boolean;
}

interface HeadPart {
  head?: Array<{ list_total_count?: number; RESULT?: { CODE: string; MESSAGE: string } }>;
}

function messageOf(json: unknown): string | null {
  const r = (json as { RESULT?: { CODE?: string; MESSAGE?: string } })?.RESULT;
  if (r?.CODE && r.CODE !== 'INFO-000') return r.MESSAGE ?? r.CODE;
  return null;
}

async function callOnce<T>(
  endpoint: string,
  params: Record<string, string>,
  key: string | undefined,
  pIndex: number,
  pSize: number,
): Promise<NeisCallResult<T>> {
  const q = new URLSearchParams({
    ...params,
    Type: 'json',
    pIndex: String(pIndex),
    pSize: String(pSize),
  });
  if (key) q.set('KEY', key);
  const res = await fetch(`${HUB}/${endpoint}?${q.toString()}`);
  if (!res.ok) throw new Error(`나이스 응답 오류 ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;

  const top = messageOf(json);
  if (top) {
    // 자료 없음은 오류가 아니라 빈 결과로 다룬다
    if (top.includes('데이터가 없') || top.includes('해당하는 데이터')) {
      return { rows: [], total: 0, truncated: false };
    }
    throw new Error(top);
  }
  const body = json[endpoint] as [HeadPart, { row: T[] }] | undefined;
  if (!body) return { rows: [], total: 0, truncated: false };
  const total = body[0]?.head?.[0]?.list_total_count ?? 0;
  const rows = body[1]?.row ?? [];
  return { rows, total, truncated: !key && total > rows.length };
}

/**
 * 전체를 다 받을 때까지 페이지를 넘긴다.
 * 키가 없으면 첫 장에서 멈추고 잘렸다고 알린다.
 */
async function callAll<T>(
  endpoint: string,
  params: Record<string, string>,
  key?: string,
  maxPages = 40,
): Promise<NeisCallResult<T>> {
  const pSize = key ? 1000 : 100;
  const first = await callOnce<T>(endpoint, params, key, 1, pSize);
  if (!key || first.rows.length >= first.total) return first;

  const out = [...first.rows];
  for (let page = 2; page <= maxPages && out.length < first.total; page++) {
    const next = await callOnce<T>(endpoint, params, key, page, pSize);
    if (next.rows.length === 0) break;
    out.push(...next.rows);
  }
  return { rows: out, total: first.total, truncated: out.length < first.total };
}

interface SchoolInfoRow {
  ATPT_OFCDC_SC_CODE: string;
  ATPT_OFCDC_SC_NM: string;
  SD_SCHUL_CODE: string;
  SCHUL_NM: string;
  SCHUL_KND_SC_NM: string;
}

/** 학교 이름으로 찾는다. 같은 이름의 학교가 여럿이면 모두 돌려준다. */
export async function searchSchools(name: string, key?: string): Promise<NeisSchool[]> {
  const q = name.trim();
  if (q.length < 2) return [];
  const { rows } = await callAll<SchoolInfoRow>('schoolInfo', { SCHUL_NM: q }, key, 3);
  return rows.map((r) => ({
    office: r.ATPT_OFCDC_SC_CODE,
    officeName: r.ATPT_OFCDC_SC_NM,
    code: r.SD_SCHUL_CODE,
    name: r.SCHUL_NM,
    kind: r.SCHUL_KND_SC_NM,
  }));
}

/** 학교급에 맞는 시간표 엔드포인트를 고른다. 응답 항목은 네 가지가 같다. */
export function timetableEndpointOf(kind: string): string {
  if (kind.startsWith('초등')) return 'elsTimetable';
  if (kind.startsWith('중학')) return 'misTimetable';
  if (kind.startsWith('특수')) return 'spsTimetable';
  return 'hisTimetable';
}

export interface TimetableQuery {
  school: NeisSchool;
  /** "20260316" */
  from: string;
  /** "20260417" */
  to: string;
  key?: string;
  /** 특정 학년만. 비우면 전 학년 */
  grade?: string;
}

/** 지정 기간의 시간표를 받는다. 학기 중 변경이 반영된 그날 실제 시간표다. */
export async function loadTimetable(q: TimetableQuery): Promise<NeisCallResult<NeisRow>> {
  const params: Record<string, string> = {
    ATPT_OFCDC_SC_CODE: q.school.office,
    SD_SCHUL_CODE: q.school.code,
    TI_FROM_YMD: q.from,
    TI_TO_YMD: q.to,
  };
  if (q.grade) params.GRADE = q.grade;
  return callAll<NeisRow>(timetableEndpointOf(q.school.kind), params, q.key);
}

export interface NeisEvent {
  /** "20260504" */
  date: string;
  name: string;
  /** 공휴일, 휴업일, 해당없음 */
  kind: string;
  /** 학년별 해당 여부. 1학년이 0번 */
  grades: boolean[];
  /** 수업이 없는 날인지 */
  isHoliday: boolean;
}

interface ScheduleRow {
  AA_YMD: string;
  EVENT_NM: string;
  SBTR_DD_SC_NM?: string;
  ONE_GRADE_EVENT_YN?: string;
  TW_GRADE_EVENT_YN?: string;
  THREE_GRADE_EVENT_YN?: string;
  FR_GRADE_EVENT_YN?: string;
  FIV_GRADE_EVENT_YN?: string;
  SIX_GRADE_EVENT_YN?: string;
}

/**
 * 학사일정을 받는다. 휴업일과 학년 행사를 함께 준다.
 * 휴업일은 교환 후보에서 빼야 하고, 학년 행사는 결강이 무더기로 생기는 날이라 미리 알면 좋다.
 */
export async function loadSchedule(q: {
  school: NeisSchool;
  from: string;
  to: string;
  key?: string;
}): Promise<NeisEvent[]> {
  const { rows } = await callAll<ScheduleRow>(
    'SchoolSchedule',
    {
      ATPT_OFCDC_SC_CODE: q.school.office,
      SD_SCHUL_CODE: q.school.code,
      AA_FROM_YMD: q.from,
      AA_TO_YMD: q.to,
    },
    q.key,
  );
  return rows.map((r) => {
    const kind = r.SBTR_DD_SC_NM ?? '해당없음';
    return {
      date: r.AA_YMD,
      name: r.EVENT_NM,
      kind,
      grades: [
        r.ONE_GRADE_EVENT_YN,
        r.TW_GRADE_EVENT_YN,
        r.THREE_GRADE_EVENT_YN,
        r.FR_GRADE_EVENT_YN,
        r.FIV_GRADE_EVENT_YN,
        r.SIX_GRADE_EVENT_YN,
      ].map((v) => v === 'Y'),
      isHoliday: kind === '휴업일' || kind === '공휴일',
    };
  });
}

/** 오늘을 기준으로 최근 몇 주를 불러올지 정한다. 기준 시간표를 잡으려면 3주 이상이 좋다. */
export function recentRange(weeks = 5, today = new Date()): { from: string; to: string } {
  const fmt = (d: Date): string =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const to = new Date(today);
  to.setDate(to.getDate() + 7); // 다음 주까지 함께 본다
  const from = new Date(today);
  from.setDate(from.getDate() - weeks * 7);
  return { from: fmt(from), to: fmt(to) };
}
