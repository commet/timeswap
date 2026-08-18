/** One row returned by the NEIS timetable endpoints. */
export interface NeisRow {
  SCHUL_NM?: string;
  ATPT_OFCDC_SC_CODE?: string;
  SD_SCHUL_CODE?: string;
  AY?: string;
  SEM?: string;
  DGHT_CRSE_SC_NM?: string;
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
