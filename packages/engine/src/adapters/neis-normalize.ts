/** One row returned by the NEIS timetable endpoints. */
export interface NeisRow {
  SCHUL_NM?: string;
  ATPT_OFCDC_SC_CODE?: string;
  SD_SCHUL_CODE?: string;
  AY?: string;
  SEM?: string;
  DGHT_CRSE_SC_NM?: string;
  /**
   * 학교 과정. 특수학교 시간표에만 오고 초등학교, 중학교, 고등학교 가운데 하나다.
   *
   * 특수학교 한 곳이 초등부와 중학부, 고등부를 함께 운영한다. 학년은 과정마다 1부터
   * 다시 센다. 이 값을 학급 열쇠에 안 넣으면 초등부 1학년 1반과 중학부 1학년 1반,
   * 고등부 1학년 1반이 한 학급으로 합쳐진다.
   *
   * 실제 특수학교 32곳을 재어 보니 31곳에서 (학년, 반)이 여러 과정에 걸쳤고,
   * 한 칸에 서로 다른 과목이 겹치는 자리가 6,028곳이었다. 합쳐진 학급은 학급 13개에
   * 배정 626개가 되는데, 한 주가 5일 곱하기 7교시로 35칸이라 있을 수 없는 시간표다.
   * 그런데도 엔진은 그 겹침을 분반으로 읽어 유효하다고 통과시켰다.
   */
  SCHUL_CRSE_SC_NM?: string;
  ORD_SC_NM?: string;
  DDDEP_NM?: string;
  /** 수업 일자. 예: "20260622" */
  ALL_TI_YMD?: string;
  GRADE?: string;
  CLASS_NM?: string;
  /** 교시. 1부터 */
  PERIO?: string;
  /** 수업 내용. 과목명이 들어오지만 휴업 사유나 보강 표기도 이 자리에 온다. */
  ITRT_CNTNT?: string;
  CLRM_NM?: string;
  LOAD_DTM?: string;
}

export interface ClassIdentity {
  schoolCode: string;
  academicYear: string;
  /**
   * 학교 과정. 특수학교의 초등부, 중학부, 고등부를 가른다. 다른 학교급에서는 빈 값이다.
   *
   * 선택 항목으로 둔다. 이 값이 생기기 전에 저장한 자료에는 없는데, 없는 것과 빈 값이
   * 같은 학급 열쇠를 내야 예전에 저장한 시간표가 그대로 열린다.
   */
  schoolCourse?: string;
  dayCourse: string;
  affiliation: string;
  major: string;
  grade: string;
  className: string;
}

export interface NormalizedNeisRow {
  id: string;
  /** The complete source fact, retained verbatim for audit and reprocessing. */
  row: NeisRow;
  classIdentity: ClassIdentity;
  classKey: string;
  factKey: string;
  date: string;
  period: string;
  rawSubject: string;
  subject: string;
  room: string;
}

export interface ParallelLessonGroup {
  classKey: string;
  date: string;
  period: string;
  rowIds: string[];
}

export interface NeisNormalizationReport {
  accepted: NormalizedNeisRow[];
  quarantined: Array<{ row: NeisRow; missing: string[] }>;
  duplicateCount: number;
  parallelGroups: ParallelLessonGroup[];
}

const normalize = (value: string | undefined): string => value?.trim().replace(/\s+/g, ' ') ?? '';

const COVER_MARK = '[보강]';
const PRO_MARK = '*';

const stripMarks = (raw: string): string => {
  let subject = raw;
  if (subject.startsWith(COVER_MARK)) subject = subject.slice(COVER_MARK.length).trim();
  if (subject.startsWith(PRO_MARK)) subject = subject.slice(PRO_MARK.length).trim();
  return subject;
};

/** A structured key so separator characters inside official field values cannot collide. */
export function classIdentityKey(identity: ClassIdentity): string {
  return JSON.stringify([
    identity.schoolCode,
    identity.academicYear,
    identity.schoolCourse ?? '',
    identity.dayCourse,
    identity.affiliation,
    identity.major,
    identity.grade,
    identity.className,
  ]);
}

const factKey = (row: NormalizedNeisRow): string =>
  JSON.stringify([
    row.classIdentity.schoolCode,
    row.classIdentity.academicYear,
    row.date,
    row.classIdentity.schoolCourse ?? '',
    row.classIdentity.dayCourse,
    row.classIdentity.affiliation,
    row.classIdentity.major,
    row.classIdentity.grade,
    row.classIdentity.className,
    row.period,
    row.subject,
    row.room,
  ]);

export function normalizeNeisRows(rows: NeisRow[]): NeisNormalizationReport {
  const accepted: NormalizedNeisRow[] = [];
  const quarantined: Array<{ row: NeisRow; missing: string[] }> = [];
  const seenFacts = new Set<string>();
  let duplicateCount = 0;

  rows.forEach((row, index) => {
    const date = normalize(row.ALL_TI_YMD);
    const grade = normalize(row.GRADE);
    const className = normalize(row.CLASS_NM);
    const period = normalize(row.PERIO);
    const rawSubject = normalize(row.ITRT_CNTNT);
    const missing = [
      ['ALL_TI_YMD', date],
      ['GRADE', grade],
      ['CLASS_NM', className],
      ['PERIO', period],
      ['ITRT_CNTNT', rawSubject],
    ].filter(([, value]) => !value).map(([field]) => field!);
    if (missing.length > 0) {
      quarantined.push({ row, missing });
      return;
    }

    const classIdentity: ClassIdentity = {
      schoolCode: normalize(row.SD_SCHUL_CODE),
      academicYear: normalize(row.AY),
      schoolCourse: normalize(row.SCHUL_CRSE_SC_NM),
      dayCourse: normalize(row.DGHT_CRSE_SC_NM),
      affiliation: normalize(row.ORD_SC_NM),
      major: normalize(row.DDDEP_NM),
      grade,
      className,
    };
    const normalized: NormalizedNeisRow = {
      id: `neis-${index}`,
      row,
      classIdentity,
      classKey: classIdentityKey(classIdentity),
      factKey: '',
      date,
      period,
      rawSubject,
      subject: stripMarks(rawSubject),
      room: normalize(row.CLRM_NM),
    };
    normalized.factKey = factKey(normalized);
    if (seenFacts.has(normalized.factKey)) {
      duplicateCount += 1;
      return;
    }
    seenFacts.add(normalized.factKey);
    accepted.push(normalized);
  });

  const bySlot = new Map<string, NormalizedNeisRow[]>();
  for (const acceptedRow of accepted) {
    const slotKey = JSON.stringify([acceptedRow.classKey, acceptedRow.date, acceptedRow.period]);
    bySlot.set(slotKey, [...(bySlot.get(slotKey) ?? []), acceptedRow]);
  }
  const parallelGroups = [...bySlot.values()]
    .filter((group) => new Set(group.map((acceptedRow) => acceptedRow.subject)).size > 1)
    .map((group) => ({
      classKey: group[0]!.classKey,
      date: group[0]!.date,
      period: group[0]!.period,
      rowIds: group.map((acceptedRow) => acceptedRow.id),
    }));

  return { accepted, quarantined, duplicateCount, parallelGroups };
}
