import {
  normalizeNeisRows,
  type ClassIdentity,
  type NeisRow,
} from '@timeswap/engine';

import publicRowsFixture from '../../../packages/engine/test/fixtures/neis-data-quality.json';
import type {
  AbsenceCase,
  AuditEvent,
  BaseScheduleRevision,
  Lesson,
  Publication,
  ResolutionChange,
  ResolutionItem,
  ScheduleClosure,
  WorkspaceState,
} from './domain';

export type DemoScenarioId =
  | 'simple-swap'
  | 'full-day-absence'
  | 'elective-block'
  | 'practice-block'
  | 'closure-conflict'
  | 'incomplete-api'
  | 'concurrent-request'
  | 'published-correction'
  | 'vocational-class-identity'
  | 'duplicate-vs-parallel';

export type DemoScenarioSurface = 'command-center' | 'diagnostics';

export interface DemoScenarioDefinition {
  id: DemoScenarioId;
  title: string;
  surface: DemoScenarioSurface;
  initialView: string;
  expectedOutcome: string;
}

export const DEMO_SCENARIOS = [
  {
    id: 'simple-swap',
    title: '간단한 같은 날 맞교환',
    surface: 'command-center',
    initialView: '일과 담당 · 간단한 맞교환 상세',
    expectedOutcome: '3·4교시 맞교환을 바로 승인할 수 있습니다.',
  },
  {
    id: 'full-day-absence',
    title: '하루 부재',
    surface: 'command-center',
    initialView: '일과 담당 · 하루 부재 해결 현황',
    expectedOutcome: '교체 2건과 보강 1건을 확인하고 미해결 1건을 남깁니다.',
  },
  {
    id: 'elective-block',
    title: '선택과목 블록',
    surface: 'command-center',
    initialView: '일과 담당 · 선택과목 묶음',
    expectedOutcome: '병렬 묶음을 쪼개지 않고 보강으로 해결합니다.',
  },
  {
    id: 'practice-block',
    title: '전문교과 연속 실습',
    surface: 'command-center',
    initialView: '일과 담당 · 연속 실습 블록',
    expectedOutcome: '3교시 연속 블록을 유지하고 실습 경험자 보강을 선택합니다.',
  },
  {
    id: 'closure-conflict',
    title: '휴업일 충돌',
    surface: 'command-center',
    initialView: '일과 담당 · 휴업일 충돌 경고',
    expectedOutcome: '휴업일 이동안을 거부하고 다른 해결안을 요구합니다.',
  },
  {
    id: 'incomplete-api',
    title: '불완전 API',
    surface: 'command-center',
    initialView: '일과 담당 · 공식 자료 완전성 오류',
    expectedOutcome: '6행 중 5행만 받은 상태에서 추천을 중단합니다.',
  },
  {
    id: 'concurrent-request',
    title: '동시 요청 충돌',
    surface: 'command-center',
    initialView: '일과 담당 · 재검증이 필요한 요청',
    expectedOutcome: '먼저 승인된 사건과 충돌하는 오래된 후보를 무효화합니다.',
  },
  {
    id: 'published-correction',
    title: '게시 후 수정',
    surface: 'command-center',
    initialView: '일과 담당 · 게시본 수정 초안',
    expectedOutcome: '기존 게시본을 유지한 채 연결된 수정 사건을 시작합니다.',
  },
  {
    id: 'vocational-class-identity',
    title: '직업계고 동명 반',
    surface: 'diagnostics',
    initialView: '자료 진단 · 전체 학급 식별자',
    expectedOutcome: '학과가 다른 동명 반을 서로 다른 학급으로 보존합니다.',
  },
  {
    id: 'duplicate-vs-parallel',
    title: '병렬 강좌와 중복 행',
    surface: 'diagnostics',
    initialView: '자료 진단 · 중복과 병렬 비교',
    expectedOutcome: '완전 중복은 제거하고 실제 병렬 강좌는 묶음으로 보존합니다.',
  },
] as const satisfies readonly DemoScenarioDefinition[];

export const DEMO_PROVENANCE_LABEL = '공식 시간표 구조 · 교사와 사건은 예시';

export interface DemoFactSource {
  kind: 'official-neis';
  name: string;
  endpoints: readonly ['hisTimetable', 'misTimetable'];
  retrievedAt: '2026-08-18';
  fixture: 'packages/engine/test/fixtures/neis-data-quality.json';
  credentialIncluded: false;
}

export interface DemoProvenance {
  factSource: DemoFactSource;
  operationSource: 'synthetic-demo';
  label: typeof DEMO_PROVENANCE_LABEL;
  fieldBoundary: {
    officialScheduleFacts: readonly ['date', 'period', 'classIdentity', 'subject', 'room'];
    syntheticOperations: readonly [
      'teacherAssignments',
      'absenceReasons',
      'approvals',
      'burden',
    ];
  };
}

export interface DemoDiagnostics {
  recommendationEnabled?: boolean;
  expectedRows?: number;
  receivedRows?: number;
  atomicParallelGroup?: boolean;
  practiceBlockLessonIds?: string[];
  unsplittablePracticeBlock?: boolean;
  fixtureCredentialRequired?: boolean;
  acceptedRows?: number;
  duplicateCount?: number;
  parallelGroupCount?: number;
}

export interface DemoWorkspaceState extends WorkspaceState {
  demo: {
    scenarioId: DemoScenarioId;
    title: string;
    surface: DemoScenarioSurface;
    initialView: string;
    expectedOutcome: string;
    provenance: DemoProvenance;
    diagnostics: DemoDiagnostics;
  };
}

const DEFAULT_NOW = '2026-08-18T00:00:00.000Z';
const OFFICIAL_REVISION_QUERY = {
  sourceFixture: 'packages/engine/test/fixtures/neis-data-quality.json',
  retrievedAt: '2026-08-18',
  responseCache: 'not-stored',
};

const FACT_SOURCE: DemoFactSource = {
  kind: 'official-neis',
  name: 'NEIS 교육정보 개방 포털 공개 시간표 응답',
  endpoints: ['hisTimetable', 'misTimetable'],
  retrievedAt: '2026-08-18',
  fixture: 'packages/engine/test/fixtures/neis-data-quality.json',
  credentialIncluded: false,
};

const PROVENANCE: DemoProvenance = {
  factSource: FACT_SOURCE,
  operationSource: 'synthetic-demo',
  label: DEMO_PROVENANCE_LABEL,
  fieldBoundary: {
    officialScheduleFacts: ['date', 'period', 'classIdentity', 'subject', 'room'],
    syntheticOperations: [
      'teacherAssignments',
      'absenceReasons',
      'approvals',
      'burden',
    ],
  },
};

function canonicalNow(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new Error('Demo clock must be a canonical ISO timestamp.');
  }
  return value;
}

function timestampAt(now: string, offset: number): string {
  return new Date(new Date(now).valueOf() + offset).toISOString();
}

const identity = (
  major: string,
  grade: string,
  className: string,
  schoolCode = '7010536',
): ClassIdentity => ({
  schoolCode,
  academicYear: '2026',
  dayCourse: '주간',
  affiliation: '공업계',
  major,
  grade,
  className,
});

interface LessonInput {
  id: string;
  date: string;
  period: string;
  classIdentity: ClassIdentity;
  subject: string;
  room: string;
  teacherId?: string;
  parallelGroupId?: string;
}

const lesson = (
  workspaceId: string,
  revisionId: string,
  input: LessonInput,
): Lesson => ({
  id: input.id,
  workspaceId,
  revisionId,
  date: input.date,
  period: input.period,
  classIdentity: input.classIdentity,
  subject: input.subject,
  room: input.room,
  teacher: input.teacherId
    ? { state: 'assigned', teacherId: input.teacherId }
    : { state: 'unassigned' },
  ...(input.parallelGroupId ? { parallelGroupId: input.parallelGroupId } : {}),
});

interface ResolutionInput {
  id: string;
  lessonId: string;
  kind: ResolutionItem['kind'];
  changes: ResolutionChange[];
  manualAction?: string;
}

interface CaseInput {
  id: string;
  requesterTeacherId: string;
  fromDate: string;
  toDate: string;
  reason: AbsenceCase['reason'];
  note?: string;
  lessonIds: string[];
  resolutionItems: ResolutionInput[];
  status: AbsenceCase['status'];
  supersedesCaseId?: string;
}

interface StateInput {
  lessons: LessonInput[];
  cases?: CaseInput[];
  complete?: boolean;
  closures?: ScheduleClosure[];
  revisionQuery?: Record<string, string>;
  publications?: Array<Omit<Publication, 'workspaceId' | 'revisionId' | 'publishedAt'>>;
  diagnostics?: DemoDiagnostics;
}

function buildState(
  scenarioId: DemoScenarioId,
  now: string,
  input: StateInput,
): DemoWorkspaceState {
  const scenario = DEMO_SCENARIOS.find((item) => item.id === scenarioId)!;
  const workspaceId = `${scenarioId}:workspace`;
  const revisionId = `${scenarioId}:revision:official`;
  const cases: AbsenceCase[] = (input.cases ?? []).map((item, index) => ({
    id: item.id,
    workspaceId,
    requesterTeacherId: item.requesterTeacherId,
    fromDate: item.fromDate,
    toDate: item.toDate,
    reason: item.reason,
    ...(item.note ? { note: item.note } : {}),
    lessonIds: [...item.lessonIds],
    resolutionItems: item.resolutionItems.map((resolution) => ({
      id: resolution.id,
      lessonId: resolution.lessonId,
      kind: resolution.kind,
      computedAgainstRevisionId: revisionId,
      changes: resolution.changes.map((change) => ({ ...change })),
      ...(resolution.manualAction ? { manualAction: resolution.manualAction } : {}),
    })),
    status: item.status,
    createdAt: timestampAt(now, 10 + index * 10),
    updatedAt: timestampAt(now, 11 + index * 10),
    ...(item.supersedesCaseId ? { supersedesCaseId: item.supersedesCaseId } : {}),
  }));
  const audit = cases.map<AuditEvent>((absenceCase, index) => {
    const details: AuditEvent['details'] = absenceCase.supersedesCaseId
      ? { supersedesCaseId: absenceCase.supersedesCaseId }
      : { lessonCount: absenceCase.lessonIds.length };
    return {
      id: `${scenarioId}:audit:case:${index + 1}`,
      workspaceId,
      caseId: absenceCase.id,
      actorId: absenceCase.requesterTeacherId,
      type: absenceCase.supersedesCaseId ? 'case.correction_created' : 'case.created',
      at: absenceCase.updatedAt,
      details,
    };
  });
  const publications: Publication[] = (input.publications ?? []).map((publication, index) => ({
    ...publication,
    workspaceId,
    revisionId,
    publishedAt: timestampAt(now, 14 + index),
  }));
  const revision: BaseScheduleRevision = {
    id: revisionId,
    workspaceId,
    source: 'neis',
    query: { ...OFFICIAL_REVISION_QUERY, ...input.revisionQuery },
    loadedAt: timestampAt(now, 1),
    complete: input.complete ?? true,
    checksum: `${scenarioId}:official-structure:2026-08-18`,
    ...(input.closures ? { closures: input.closures } : {}),
  };

  return {
    schemaVersion: 2,
    workspace: {
      id: workspaceId,
      name: '조율 예시학교',
      activeRevisionId: revisionId,
      createdAt: timestampAt(now, 0),
      updatedAt: timestampAt(now, 99),
    },
    revisions: [revision],
    lessons: input.lessons.map((item) => lesson(workspaceId, revisionId, item)),
    cases,
    adminTasks: [],
    publications,
    audit,
    demo: {
      scenarioId,
      title: scenario.title,
      surface: scenario.surface,
      initialView: scenario.initialView,
      expectedOutcome: scenario.expectedOutcome,
      provenance: PROVENANCE,
      diagnostics: { ...input.diagnostics },
    },
  };
}

const assigned = (lessonId: string, toDate: string, toPeriod: string, teacherId: string): ResolutionChange => ({
  lessonId,
  toDate,
  toPeriod,
  teacher: { state: 'assigned', teacherId },
});

function simpleSwap(now: string): DemoWorkspaceState {
  const absent = 'simple-swap:lesson:math-3';
  const counterpart = 'simple-swap:lesson:science-4';
  return buildState('simple-swap', now, {
    lessons: [
      {
        id: absent,
        date: '2026-08-18',
        period: '3',
        classIdentity: identity('기계과', '2', '1'),
        subject: '기계일반',
        room: '기계실습실',
        teacherId: 'teacher:seo-jun',
      },
      {
        id: counterpart,
        date: '2026-08-18',
        period: '4',
        classIdentity: identity('기계과', '2', '1'),
        subject: '건축일반',
        room: '기계실습실',
        teacherId: 'teacher:han-sol',
      },
    ],
    cases: [{
      id: 'simple-swap:case:request',
      requesterTeacherId: 'teacher:seo-jun',
      fromDate: '2026-08-18',
      toDate: '2026-08-18',
      reason: '연수·출장',
      lessonIds: [absent],
      resolutionItems: [{
        id: 'simple-swap:resolution:swap',
        lessonId: absent,
        kind: 'swap2',
        changes: [
          assigned(absent, '2026-08-18', '4', 'teacher:seo-jun'),
          assigned(counterpart, '2026-08-18', '3', 'teacher:han-sol'),
        ],
      }],
      status: 'in_review',
    }],
    diagnostics: { recommendationEnabled: true },
  });
}

function fullDayAbsence(now: string): DemoWorkspaceState {
  const affected = [1, 2, 3, 4].map((period) =>
    `full-day-absence:lesson:absent-${period}`);
  const counterparts = [5, 6].map((period) =>
    `full-day-absence:lesson:counterpart-${period}`);
  return buildState('full-day-absence', now, {
    lessons: [
      ...affected.map((id, index) => ({
        id,
        date: '2026-08-18',
        period: String(index + 1),
        classIdentity: identity('기계과', '2', String(index + 1)),
        subject: ['기계일반', '기계제도', '전기이론', '전기설비'][index]!,
        room: `실습실-${index + 1}`,
        teacherId: 'teacher:seo-jun',
      })),
      ...counterparts.map((id, index) => ({
        id,
        date: '2026-08-18',
        period: String(index + 5),
        classIdentity: identity('기계과', '2', String(index + 1)),
        subject: index === 0 ? '통합과학' : '통합사회',
        room: `교실-${index + 1}`,
        teacherId: `teacher:counterpart-${index + 1}`,
      })),
    ],
    cases: [{
      id: 'full-day-absence:case:request',
      requesterTeacherId: 'teacher:seo-jun',
      fromDate: '2026-08-18',
      toDate: '2026-08-18',
      reason: '업무상 부재',
      lessonIds: affected,
      resolutionItems: [
        {
          id: 'full-day-absence:resolution:swap-1',
          lessonId: affected[0]!,
          kind: 'swap2',
          changes: [
            assigned(affected[0]!, '2026-08-18', '5', 'teacher:seo-jun'),
            assigned(counterparts[0]!, '2026-08-18', '1', 'teacher:counterpart-1'),
          ],
        },
        {
          id: 'full-day-absence:resolution:swap-2',
          lessonId: affected[1]!,
          kind: 'swap2',
          changes: [
            assigned(affected[1]!, '2026-08-18', '6', 'teacher:seo-jun'),
            assigned(counterparts[1]!, '2026-08-18', '2', 'teacher:counterpart-2'),
          ],
        },
        {
          id: 'full-day-absence:resolution:cover',
          lessonId: affected[2]!,
          kind: 'cover',
          changes: [assigned(affected[2]!, '2026-08-18', '3', 'teacher:cover-practice')],
        },
        {
          id: 'full-day-absence:resolution:unresolved',
          lessonId: affected[3]!,
          kind: 'unresolved',
          changes: [],
        },
      ],
      status: 'in_review',
    }],
    diagnostics: { recommendationEnabled: true },
  });
}

function electiveBlock(now: string): DemoWorkspaceState {
  const groupId = 'elective-block:parallel:grade-2';
  const ids = ['data', 'robotics', 'design'].map((name) =>
    `elective-block:lesson:${name}`);
  return buildState('elective-block', now, {
    lessons: ids.map((id, index) => ({
      id,
      date: '2026-08-18',
      period: '5',
      classIdentity: identity('전기과', '2', '1', '7240454'),
      subject: ['데이터과학', '로봇공학', '제품디자인'][index]!,
      room: `선택실-${index + 1}`,
      teacherId: index === 0 ? 'teacher:seo-jun' : `teacher:elective-${index + 1}`,
      parallelGroupId: groupId,
    })),
    cases: [{
      id: 'elective-block:case:request',
      requesterTeacherId: 'teacher:seo-jun',
      fromDate: '2026-08-18',
      toDate: '2026-08-18',
      reason: '연수·출장',
      lessonIds: [ids[0]!],
      resolutionItems: [{
        id: 'elective-block:resolution:cover',
        lessonId: ids[0]!,
        kind: 'cover',
        changes: [assigned(ids[0]!, '2026-08-18', '5', 'teacher:cover-elective')],
      }],
      status: 'in_review',
    }],
    diagnostics: {
      recommendationEnabled: true,
      atomicParallelGroup: true,
    },
  });
}

function practiceBlock(now: string): DemoWorkspaceState {
  const ids = [2, 3, 4].map((period) => `practice-block:lesson:practice-${period}`);
  return buildState('practice-block', now, {
    lessons: ids.map((id, index) => ({
      id,
      date: '2026-08-18',
      period: String(index + 2),
      classIdentity: identity('기계과', '3', '2', '7240454'),
      subject: '휠·타이어·얼라인먼트 정비',
      room: '자동차실습실',
      teacherId: 'teacher:seo-jun',
    })),
    cases: [{
      id: 'practice-block:case:request',
      requesterTeacherId: 'teacher:seo-jun',
      fromDate: '2026-08-18',
      toDate: '2026-08-18',
      reason: '연수·출장',
      lessonIds: ids,
      resolutionItems: ids.map((id, index) => ({
        id: `practice-block:resolution:cover-${index + 1}`,
        lessonId: id,
        kind: 'cover',
        changes: [assigned(id, '2026-08-18', String(index + 2), 'teacher:cover-practice')],
      })),
      status: 'in_review',
    }],
    diagnostics: {
      recommendationEnabled: true,
      practiceBlockLessonIds: ids,
      unsplittablePracticeBlock: true,
    },
  });
}

function closureConflict(now: string): DemoWorkspaceState {
  const id = 'closure-conflict:lesson:practice';
  return buildState('closure-conflict', now, {
    lessons: [{
      id,
      date: '2026-08-18',
      period: '3',
      classIdentity: identity('건축과', '2', '1'),
      subject: '건축일반',
      room: '건축실습실',
      teacherId: 'teacher:seo-jun',
    }],
    closures: [{ date: '2026-08-19', reason: '학교 재량휴업일' }],
    cases: [{
      id: 'closure-conflict:case:request',
      requesterTeacherId: 'teacher:seo-jun',
      fromDate: '2026-08-18',
      toDate: '2026-08-18',
      reason: '학교 행사',
      lessonIds: [id],
      resolutionItems: [{
        id: 'closure-conflict:resolution:closed-day-move',
        lessonId: id,
        kind: 'move',
        changes: [assigned(id, '2026-08-19', '3', 'teacher:seo-jun')],
      }],
      status: 'in_review',
    }],
    diagnostics: { recommendationEnabled: true },
  });
}

function incompleteApi(now: string): DemoWorkspaceState {
  return buildState('incomplete-api', now, {
    complete: false,
    revisionQuery: {
      endpoint: 'hisTimetable',
      receivedRows: '5',
      expectedRows: '6',
    },
    lessons: [1, 2, 3, 4, 5].map((period) => ({
      id: `incomplete-api:lesson:${period}`,
      date: '2026-08-18',
      period: String(period),
      classIdentity: identity('기계과', '1', '1'),
      subject: `공식 응답 수업 ${period}`,
      room: '1-1 교실',
    })),
    diagnostics: {
      recommendationEnabled: false,
      receivedRows: 5,
      expectedRows: 6,
    },
  });
}

function concurrentRequest(now: string): DemoWorkspaceState {
  const shared = 'concurrent-request:lesson:shared';
  return buildState('concurrent-request', now, {
    lessons: [{
      id: shared,
      date: '2026-08-18',
      period: '1',
      classIdentity: identity('기계과', '2', '1'),
      subject: '기계일반',
      room: '기계실습실',
      teacherId: 'teacher:seo-jun',
    }],
    cases: [
      {
        id: 'concurrent-request:case:approved',
        requesterTeacherId: 'teacher:seo-jun',
        fromDate: '2026-08-18',
        toDate: '2026-08-18',
        reason: '업무상 부재',
        lessonIds: [shared],
        resolutionItems: [{
          id: 'concurrent-request:resolution:approved',
          lessonId: shared,
          kind: 'move',
          changes: [assigned(shared, '2026-08-18', '2', 'teacher:seo-jun')],
        }],
        status: 'resolution_approved',
      },
      {
        id: 'concurrent-request:case:stale',
        requesterTeacherId: 'teacher:seo-jun',
        fromDate: '2026-08-18',
        toDate: '2026-08-18',
        reason: '연수·출장',
        lessonIds: [shared],
        resolutionItems: [{
          id: 'concurrent-request:resolution:stale',
          lessonId: shared,
          kind: 'move',
          changes: [assigned(shared, '2026-08-18', '3', 'teacher:seo-jun')],
        }],
        status: 'in_review',
      },
    ],
    diagnostics: { recommendationEnabled: true },
  });
}

function publishedCorrection(now: string): DemoWorkspaceState {
  const lessonId = 'published-correction:lesson:published';
  const publishedCaseId = 'published-correction:case:published';
  const state = buildState('published-correction', now, {
    lessons: [{
      id: lessonId,
      date: '2026-08-18',
      period: '3',
      classIdentity: identity('기계과', '2', '1'),
      subject: '기계일반',
      room: '기계실습실',
      teacherId: 'teacher:seo-jun',
    }],
    cases: [
      {
        id: publishedCaseId,
        requesterTeacherId: 'teacher:seo-jun',
        fromDate: '2026-08-18',
        toDate: '2026-08-18',
        reason: '연수·출장',
        lessonIds: [lessonId],
        resolutionItems: [{
          id: 'published-correction:resolution:original',
          lessonId,
          kind: 'move',
          changes: [assigned(lessonId, '2026-08-18', '4', 'teacher:seo-jun')],
        }],
        status: 'published',
      },
      {
        id: 'published-correction:case:correction',
        requesterTeacherId: 'teacher:seo-jun',
        fromDate: '2026-08-18',
        toDate: '2026-08-18',
        reason: '연수·출장',
        note: '협조 교사 사정 변경',
        lessonIds: [lessonId],
        resolutionItems: [],
        status: 'draft',
        supersedesCaseId: publishedCaseId,
      },
    ],
    publications: [{
      id: 'published-correction:publication:original',
      caseId: publishedCaseId,
      changedLessonIds: [lessonId],
      publishedBy: 'operator:demo',
    }],
    diagnostics: { recommendationEnabled: true },
  });
  const original = state.cases[0]!;
  const correction = state.cases[1]!;
  const publication = state.publications[0]!;
  return {
    ...state,
    cases: [
      { ...original, createdAt: timestampAt(now, 10), updatedAt: timestampAt(now, 12) },
      { ...correction, createdAt: timestampAt(now, 16), updatedAt: timestampAt(now, 16) },
    ],
    publications: [{ ...publication, publishedAt: timestampAt(now, 14) }],
    audit: [
      { ...state.audit[0]!, at: timestampAt(now, 12) },
      { ...state.audit[1]!, at: timestampAt(now, 16) },
    ],
  };
}

const publicRows = publicRowsFixture.rows as NeisRow[];

function fixtureLessonInput(
  scenarioId: DemoScenarioId,
  normalized: ReturnType<typeof normalizeNeisRows>['accepted'][number],
  parallelGroupId?: string,
): LessonInput {
  return {
    id: `${scenarioId}:lesson:${normalized.id}`,
    date: `${normalized.date.slice(0, 4)}-${normalized.date.slice(4, 6)}-${normalized.date.slice(6, 8)}`,
    period: normalized.period,
    classIdentity: normalized.classIdentity,
    subject: normalized.subject,
    room: normalized.room,
    ...(parallelGroupId ? { parallelGroupId } : {}),
  };
}

function vocationalClassIdentity(now: string): DemoWorkspaceState {
  const report = normalizeNeisRows(publicRows.slice(0, 4));
  return buildState('vocational-class-identity', now, {
    lessons: report.accepted.map((row) => fixtureLessonInput(
      'vocational-class-identity',
      row,
    )),
    diagnostics: {
      recommendationEnabled: false,
      fixtureCredentialRequired: false,
      acceptedRows: report.accepted.length,
      duplicateCount: report.duplicateCount,
      parallelGroupCount: report.parallelGroups.length,
    },
  });
}

function duplicateVsParallel(now: string): DemoWorkspaceState {
  const report = normalizeNeisRows(publicRows);
  const rowToGroup = new Map(report.parallelGroups.flatMap((group, index) =>
    group.rowIds.map((rowId) => [rowId, `duplicate-vs-parallel:parallel:${index + 1}`] as const)));
  return buildState('duplicate-vs-parallel', now, {
    lessons: report.accepted.map((row) => fixtureLessonInput(
      'duplicate-vs-parallel',
      row,
      rowToGroup.get(row.id),
    )),
    diagnostics: {
      recommendationEnabled: false,
      fixtureCredentialRequired: false,
      acceptedRows: report.accepted.length,
      duplicateCount: report.duplicateCount,
      parallelGroupCount: report.parallelGroups.length,
    },
  });
}

export function createDemoWorkspace(now = DEFAULT_NOW): DemoWorkspaceState {
  return loadDemoScenario('simple-swap', now);
}

export function loadDemoScenario(
  id: DemoScenarioId,
  now = DEFAULT_NOW,
): DemoWorkspaceState {
  const clock = canonicalNow(now);
  switch (id) {
    case 'simple-swap': return simpleSwap(clock);
    case 'full-day-absence': return fullDayAbsence(clock);
    case 'elective-block': return electiveBlock(clock);
    case 'practice-block': return practiceBlock(clock);
    case 'closure-conflict': return closureConflict(clock);
    case 'incomplete-api': return incompleteApi(clock);
    case 'concurrent-request': return concurrentRequest(clock);
    case 'published-correction': return publishedCorrection(clock);
    case 'vocational-class-identity': return vocationalClassIdentity(clock);
    case 'duplicate-vs-parallel': return duplicateVsParallel(clock);
  }
}
