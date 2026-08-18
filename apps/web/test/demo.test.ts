import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { validateCasePlan } from '../lib/projections';
import {
  DEMO_PROVENANCE_LABEL,
  DEMO_SCENARIOS,
  createDemoWorkspace,
  loadDemoScenario,
  type DemoScenarioId,
} from '../lib/demo';

const scenarioIds: DemoScenarioId[] = [
  'simple-swap',
  'full-day-absence',
  'elective-block',
  'practice-block',
  'closure-conflict',
  'incomplete-api',
  'concurrent-request',
  'published-correction',
  'vocational-class-identity',
  'duplicate-vs-parallel',
];

const timestampValues = (state: ReturnType<typeof loadDemoScenario>): string[] => [
  state.workspace.createdAt,
  state.workspace.updatedAt,
  ...state.revisions.map((revision) => revision.loadedAt),
  ...state.cases.flatMap((absenceCase) => [absenceCase.createdAt, absenceCase.updatedAt]),
  ...state.adminTasks.flatMap((task) => [
    task.createdAt,
    task.updatedAt,
    ...(task.completedAt ? [task.completedAt] : []),
  ]),
  ...state.publications.map((publication) => publication.publishedAt),
  ...state.audit.map((event) => event.at),
];

const entityIds = (state: ReturnType<typeof loadDemoScenario>): string[] => [
  state.workspace.id,
  ...state.revisions.map((revision) => revision.id),
  ...state.lessons.map((lesson) => lesson.id),
  ...state.cases.map((absenceCase) => absenceCase.id),
  ...state.cases.flatMap((absenceCase) => absenceCase.resolutionItems.map((item) => item.id)),
  ...state.adminTasks.map((task) => task.id),
  ...state.publications.map((publication) => publication.id),
  ...state.audit.map((event) => event.id),
];

describe('demo scenario inventory', () => {
  it('keeps all operational scenarios in the command center and diagnostics out of it', () => {
    expect(DEMO_SCENARIOS.map((scenario) => scenario.id)).toEqual(scenarioIds);
    expect(DEMO_SCENARIOS.slice(0, 8).every((scenario) =>
      scenario.surface === 'command-center')).toBe(true);
    expect(DEMO_SCENARIOS.slice(8).every((scenario) =>
      scenario.surface === 'diagnostics')).toBe(true);
    expect(DEMO_SCENARIOS.every((scenario) =>
      scenario.initialView.trim() !== '' && scenario.expectedOutcome.trim() !== '')).toBe(true);
  });

  it('opens the deterministic simple swap by default with stable nonblank ids and timestamps', () => {
    const first = createDemoWorkspace('2026-08-18T00:00:00.000Z');
    const second = createDemoWorkspace('2026-08-18T00:00:00.000Z');

    expect(first).toEqual(second);
    expect(first.demo.scenarioId).toBe('simple-swap');
    expect(first.demo.initialView).toBe('일과 담당 · 간단한 맞교환 상세');
    expect(entityIds(first).every((id) => id.trim() !== '')).toBe(true);
    expect(new Set(entityIds(first)).size).toBe(entityIds(first).length);
    expect(timestampValues(first).every((value) =>
      value !== '' && new Date(value).toISOString() === value)).toBe(true);
    expect(first.workspace.createdAt <= first.workspace.updatedAt).toBe(true);
    expect(first.cases.every((absenceCase) =>
      absenceCase.createdAt <= absenceCase.updatedAt)).toBe(true);
  });
});

describe('demo source boundary', () => {
  it.each(scenarioIds)('separates official facts from synthetic operations in %s', (id) => {
    const state = loadDemoScenario(id, '2026-08-18T00:00:00.000Z');

    expect(state.demo.provenance.factSource.kind).toBe('official-neis');
    expect(state.demo.provenance.factSource.retrievedAt).toBe('2026-08-18');
    expect(state.demo.provenance.factSource.credentialIncluded).toBe(false);
    expect(state.demo.provenance.operationSource).toBe('synthetic-demo');
    expect(state.demo.provenance.label).toBe(DEMO_PROVENANCE_LABEL);
    expect(DEMO_PROVENANCE_LABEL).toBe('공식 시간표 구조 · 교사와 사건은 예시');
  });
});

describe('operational demo scenarios', () => {
  it('starts with a same-day third/fourth-period swap', () => {
    const state = loadDemoScenario('simple-swap');
    const item = state.cases[0]?.resolutionItems[0];

    expect(state.cases).toHaveLength(1);
    expect(item?.kind).toBe('swap2');
    expect(item?.changes.map((change) => change.toPeriod)).toEqual(['4', '3']);
    expect(new Set(item?.changes.map((change) => change.toDate))).toEqual(
      new Set(['2026-08-18']),
    );
  });

  it('models four full-day lessons as two swaps, one cover, and one unresolved item', () => {
    const state = loadDemoScenario('full-day-absence');
    const absenceCase = state.cases[0]!;

    expect(absenceCase.lessonIds).toHaveLength(4);
    expect(absenceCase.resolutionItems.map((item) => item.kind)).toEqual([
      'swap2',
      'swap2',
      'cover',
      'unresolved',
    ]);
  });

  it('keeps the elective parallel group atomic and resolves it by cover', () => {
    const state = loadDemoScenario('elective-block');
    const grouped = state.lessons.filter((lesson) => lesson.parallelGroupId);

    expect(grouped).toHaveLength(3);
    expect(new Set(grouped.map((lesson) => lesson.parallelGroupId))).toEqual(
      new Set(['elective-block:parallel:grade-2']),
    );
    expect(state.cases[0]?.resolutionItems.every((item) => item.kind === 'cover')).toBe(true);
    expect(state.demo.diagnostics.atomicParallelGroup).toBe(true);
  });

  it('keeps the three-period professional-practice run unsplittable', () => {
    const state = loadDemoScenario('practice-block');
    const practiceIds = state.demo.diagnostics.practiceBlockLessonIds;

    expect(practiceIds).toHaveLength(3);
    expect(state.lessons.filter((lesson) => practiceIds?.includes(lesson.id))
      .map((lesson) => lesson.period)).toEqual(['2', '3', '4']);
    expect(state.demo.diagnostics.unsplittablePracticeBlock).toBe(true);
    expect(state.cases[0]?.resolutionItems.every((item) => item.kind === 'cover')).toBe(true);
  });

  it('rejects a move onto an official closure', () => {
    const state = loadDemoScenario('closure-conflict');
    const result = validateCasePlan(state, state.cases[0]!.id);

    expect(result.valid).toBe(false);
    expect(result.conflicts.map((conflict) => conflict.kind)).toContain('closure');
  });

  it('blocks recommendations when only five of six official rows arrived', () => {
    const state = loadDemoScenario('incomplete-api');

    expect(state.revisions[0]?.complete).toBe(false);
    expect(state.demo.diagnostics.receivedRows).toBe(5);
    expect(state.demo.diagnostics.expectedRows).toBe(6);
    expect(state.demo.diagnostics.recommendationEnabled).toBe(false);
  });

  it('invalidates the second request after the first request is approved', () => {
    const state = loadDemoScenario('concurrent-request');
    const staleCase = state.cases.find((absenceCase) =>
      absenceCase.id === 'concurrent-request:case:stale')!;
    const result = validateCasePlan(state, staleCase.id);

    expect(state.cases.find((absenceCase) =>
      absenceCase.id === 'concurrent-request:case:approved')?.status).toBe(
      'resolution_approved',
    );
    expect(result.valid).toBe(false);
    expect(result.conflicts.some((conflict) =>
      conflict.kind === 'class' || conflict.kind === 'unknown-occupancy')).toBe(true);
  });

  it('starts a linked correction draft without hiding the old publication', () => {
    const state = loadDemoScenario('published-correction');
    const correction = state.cases.find((absenceCase) =>
      absenceCase.id === 'published-correction:case:correction');

    expect(correction?.status).toBe('draft');
    expect(correction?.supersedesCaseId).toBe('published-correction:case:published');
    expect(state.publications).toEqual([
      expect.objectContaining({
        id: 'published-correction:publication:original',
        caseId: 'published-correction:case:published',
      }),
    ]);
  });
});

describe('public-row data regressions', () => {
  it('preserves full vocational identities for same grade/class labels', () => {
    const state = loadDemoScenario('vocational-class-identity');
    const simpleKeys = state.lessons.map((lesson) =>
      `${lesson.classIdentity.schoolCode}|${lesson.classIdentity.grade}|${lesson.classIdentity.className}`);
    const fullKeys = state.lessons.map((lesson) => JSON.stringify(lesson.classIdentity));

    expect(new Set(simpleKeys).size).toBe(2);
    expect(new Set(fullKeys).size).toBe(4);
    expect(state.demo.diagnostics.fixtureCredentialRequired).toBe(false);
  });

  it('removes one exact duplicate and retains one real parallel pair', () => {
    const state = loadDemoScenario('duplicate-vs-parallel');

    expect(state.demo.diagnostics.duplicateCount).toBe(1);
    expect(state.demo.diagnostics.parallelGroupCount).toBe(1);
    expect(state.demo.diagnostics.acceptedRows).toBe(6);
    expect(state.lessons.filter((lesson) => lesson.parallelGroupId)).toHaveLength(2);
  });
});

describe('measured corpus provenance', () => {
  it('retains exact aggregate measurements without inventing school-level rows', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const manifest = JSON.parse(readFileSync(join(
      here,
      '../../../docs/research/neis-corpus-summary-2026-08-18.json',
    ), 'utf8'));

    expect(manifest.totals).toEqual({
      rawRows: 12145,
      invalidRows: 250,
      exactDuplicates: 393,
      validUniqueRows: 11502,
      professionalRows: 1631,
      professionalBlocks: 464,
      parallelCells: 288,
    });
    expect(manifest.sampleCategories).toEqual([
      { category: 'general-autonomous-high-school', schoolCount: 4 },
      { category: 'vocational-meister-high-school', schoolCount: 4 },
      { category: 'middle-school', schoolCount: 4 },
    ]);
    expect(manifest.schoolLevelRefresh).toEqual(expect.objectContaining({
      status: 'unavailable',
      requiresCredentialedCorpusRefresh: true,
    }));
    expect(manifest.schools).toBeUndefined();
    expect(manifest.security).toEqual({
      apiCredentialStored: false,
      fullResponseCacheStored: false,
    });
    expect(manifest.namedObservations.map((item: { schoolName: string }) =>
      item.schoolName)).toEqual(['서울공업고등학교', '대구공업고등학교', '대전중학교']);
  });
});
