/**
 * 프로토타입이 약속한 다섯 여정을 브라우저에서 끝까지 걷는다.
 *
 * 화면에 무엇이 보였는지만 재면 화면에 남은 메모리 상태로 통과한다. 그래서 상태
 * 경계마다 보이는 값과 저장된 값을 함께 잰다. 게시 판정은 늘 새로 연 페이지가 한다.
 *
 * 각 여정은 스스로 초기화한다. 실행 순서에 기대지 않으며 자기 시나리오의 저장 키만
 * 지운다. 하나가 실패해도 나머지는 그대로 걷는다.
 */

const OPERATOR_WAIT = 90;

const storageKey = (scenario) => `joyul:v2:workspace:${scenario}:workspace`;

/** 시연 자료의 시계는 고정되어 있다. 오늘이 흐르면 화면이 매번 달라진다. */
export const DEMO_TODAY = '2026-08-18';

async function readState(page, scenario) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, storageKey(scenario));
}

/**
 * 시나리오를 처음 상태로 연다. 예시 학교를 깐 뒤 관제판의 사례 교체를 쓰며,
 * 자기 시나리오의 저장 키만 지운다. 다른 여정이 남긴 것은 건드리지 않는다.
 */
async function openScenario(page, BASE, scenario, failures) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate((key) => localStorage.removeItem(key), storageKey(scenario));
  await page.getByRole('button', { name: '예시 학교 둘러보기' }).click();
  await page.waitForURL(/\?view=ops&school=/);
  if (scenario !== 'simple-swap') {
    await page.getByRole('button', { name: '현실 사례 바꾸기' }).click();
    await page.locator(`[data-demo-scenario="${scenario}"]`).click();
    await page.getByRole('button', { name: '초기화 확인' }).click();
    await page.waitForURL(new RegExp(`school=${scenario}`), { timeout: 8_000 })
      .catch(() => failures.push(`${scenario}: 시나리오를 열지 못함`));
  }
  await page.waitForTimeout(OPERATOR_WAIT);
  const state = await readState(page, scenario);
  if (!state) {
    failures.push(`${scenario}: 시나리오 상태가 저장되지 않음`);
    return null;
  }
  if (state.workspace.id !== `${scenario}:workspace`) {
    failures.push(`${scenario}: 예상과 다른 작업 공간 ${state.workspace.id}`);
  }
  if (!state.lessons.some((lesson) => lesson.date === DEMO_TODAY)) {
    failures.push(`${scenario}: 고정된 시계 ${DEMO_TODAY} 의 수업이 없음`);
  }
  return state;
}

const opsUrl = (BASE, scenario, caseId, step) =>
  `${BASE}/?view=ops&school=${encodeURIComponent(`${scenario}:workspace`)}`
  + `&case=${encodeURIComponent(caseId)}&step=${step}`;

/** 필수 행정 과업 세 건을 클립보드 없이 마친다. 클립보드 실패는 따로 잰다. */
async function completeRequiredTasks(page) {
  for (const [kind, name] of [
    ['neis', '직접 입력했음'],
    ['teacher_notice', '이미 안내했음'],
    ['class_publication', '미리보기 확인했음'],
  ]) {
    const control = page.locator(`[data-publication-task="${kind}"]`).getByRole('button', { name });
    if (await control.count()) {
      await control.click();
      await page.waitForTimeout(60);
    }
  }
}

async function approveAndPublish(page, BASE, scenario, caseId, failures, label) {
  await page.goto(opsUrl(BASE, scenario, caseId, 'case'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(OPERATOR_WAIT);
  const approve = page.getByRole('button', { name: '해결안 승인' });
  if (!(await approve.count())) {
    failures.push(`${label}: 승인 행동이 없음`);
    return null;
  }
  if (await approve.isDisabled()) {
    failures.push(`${label}: 유효한 계획인데 승인이 잠겨 있음`);
    return null;
  }
  await approve.click();
  await page.waitForURL(/step=admin/, { timeout: 6_000 })
    .catch(() => failures.push(`${label}: 승인 뒤 행정 마감으로 넘어가지 않음`));
  await page.waitForTimeout(OPERATOR_WAIT);

  const publish = page.locator('[data-publish-action]');
  if (!(await publish.isDisabled())) {
    failures.push(`${label}: 필수 과업이 남았는데 게시가 열려 있음`);
  }
  await completeRequiredTasks(page);
  await page.waitForTimeout(OPERATOR_WAIT);
  if (await publish.isDisabled()) {
    failures.push(`${label}: 필수 과업을 마쳤는데 게시가 잠겨 있음`);
    return null;
  }
  await publish.click();
  await page.waitForTimeout(150);
  return readState(page, scenario);
}

/** 게시된 사실은 새 페이지에서 확인한다. 열려 있던 화면의 상태를 믿지 않는다. */
async function assertPublicClass(ctx, BASE, scenario, grade, className, failures, label, expect) {
  const page = await ctx.newPage();
  page.on('pageerror', (error) => failures.push(`${label} 학급 화면 오류: ${error.message}`));
  await page.goto(
    `${BASE}/?view=class&school=${encodeURIComponent(`${scenario}:workspace`)}&grade=${grade}&class=${className}`,
    { waitUntil: 'networkidle' },
  );
  await page.waitForTimeout(120);
  const seen = await page.evaluate(() => ({
    rendered: Boolean(document.querySelector('[data-public-class]')),
    changed: document.querySelectorAll('.public-class-lessons > li.changed').length,
    text: document.body.innerText,
  }));
  if (!seen.rendered) failures.push(`${label}: 학급 공개 시간표가 그려지지 않음`);
  if (seen.changed !== expect.changed) {
    failures.push(`${label}: 학급 시간표 변경이 ${expect.changed}건이어야 하는데 ${seen.changed}건`);
  }
  for (const secret of ['연수·출장', '업무상 부재', 'teacher:', '보강 부담']) {
    if (seen.text.includes(secret)) failures.push(`${label}: 학급 시간표에 내부 정보 노출 "${secret}"`);
  }
  await page.close();
  return seen;
}

/** 여정 1 — 한 수업 요청부터 게시까지, 교사가 시작하고 담당자가 닫는다. */
async function journeyOne(ctx, BASE, failures, shot) {
  const label = '여정1 단일 수업';
  const scenario = 'simple-swap';
  const page = await ctx.newPage();
  page.on('pageerror', (error) => failures.push(`${label} 페이지 오류: ${error.message}`));
  const initial = await openScenario(page, BASE, scenario, failures);
  if (!initial) { await page.close(); return; }

  // 교사가 직접 요청하는 길을 걷기 위해 사건을 비운다.
  await page.evaluate((key) => {
    const state = JSON.parse(localStorage.getItem(key));
    state.cases = [];
    state.audit = [];
    state.publications = [];
    state.adminTasks = [];
    localStorage.setItem(key, JSON.stringify(state));
  }, storageKey(scenario));

  await page.goto(`${BASE}/?view=teacher&school=${encodeURIComponent(`${scenario}:workspace`)}&teacher=teacher%3Aseo-jun`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(OPERATOR_WAIT);
  await page.locator('.period-rail-lesson').first().click();
  await page.getByRole('button', { name: '후보 계산으로 전달' }).click();
  await page.waitForTimeout(OPERATOR_WAIT);
  if ((await page.locator('[data-resolution-matrix]').count()) !== 1) {
    failures.push(`${label}: 해결안 비교 표가 열리지 않음`);
    await page.close();
    return;
  }
  const beforeSubmit = await readState(page, scenario);
  if (beforeSubmit.cases.length) failures.push(`${label}: 비교만으로 사건이 저장됨`);
  await page.getByRole('button', { name: '이 해결안 선택', exact: true }).click();
  await page.waitForTimeout(120);
  const submitted = await readState(page, scenario);
  const requested = submitted.cases.find((item) => item.status === 'submitted');
  if (!requested) { failures.push(`${label}: 제출된 사건이 없음`); await page.close(); return; }

  await page.goto(opsUrl(BASE, scenario, requested.id, 'case'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(OPERATOR_WAIT);
  await page.getByRole('button', { name: '검토 시작' }).click();
  await page.waitForTimeout(OPERATOR_WAIT);
  await page.getByRole('button', { name: '대안 적용' }).click();
  await page.waitForTimeout(OPERATOR_WAIT);
  await shot(page, 'journey-1-ops');

  const published = await approveAndPublish(page, BASE, scenario, requested.id, failures, label);
  if (published) {
    if (published.publications.length !== 1) failures.push(`${label}: 게시본이 한 건이 아님`);
    if (published.cases.find((item) => item.id === requested.id)?.status !== 'published') {
      failures.push(`${label}: 사건이 published 로 끝나지 않음`);
    }
    await shot(page, 'journey-1-published');
  }
  const expectedChanges = published?.publications[0]?.changedLessonIds.length ?? 0;
  if (expectedChanges === 0) failures.push(`${label}: 게시본에 변경된 수업이 없음`);
  await assertPublicClass(ctx, BASE, scenario, '2', '1', failures, label, { changed: expectedChanges });
  await page.close();
}

/** 여정 2 — 하루 부재. 미해결 하나를 남긴 채로는 승인되지 않아야 한다. */
async function journeyTwo(ctx, BASE, failures, shot) {
  const label = '여정2 하루 부재';
  const scenario = 'full-day-absence';
  const page = await ctx.newPage();
  page.on('pageerror', (error) => failures.push(`${label} 페이지 오류: ${error.message}`));
  const initial = await openScenario(page, BASE, scenario, failures);
  if (!initial) { await page.close(); return; }
  const caseId = initial.cases[0].id;
  const kinds = initial.cases[0].resolutionItems.map((item) => item.kind);
  if (kinds.filter((kind) => kind === 'swap2').length !== 2) failures.push(`${label}: 교체 2건 준비 상태가 아님`);
  if (!kinds.includes('cover')) failures.push(`${label}: 보강 1건 준비 상태가 아님`);
  if (!kinds.includes('unresolved')) failures.push(`${label}: 미해결 1건 준비 상태가 아님`);

  await page.goto(opsUrl(BASE, scenario, caseId, 'case'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(OPERATOR_WAIT);
  const approve = page.getByRole('button', { name: '해결안 승인' });
  if (!(await approve.isDisabled())) failures.push(`${label}: 미해결이 남았는데 승인이 열려 있음`);
  const blockedReason = await page.locator('.ops-plan-validation').innerText();
  if (blockedReason.includes('승인할 수 있습니다')) failures.push(`${label}: 미해결 상태를 승인 가능으로 알림`);
  await shot(page, 'journey-2-blocked');

  // 마지막 미해결 수업에 대안을 적용한다. 화면의 마지막 대안 적용이 그 자리다.
  const applyButtons = page.getByRole('button', { name: '대안 적용' });
  const count = await applyButtons.count();
  if (count === 0) { failures.push(`${label}: 대안 적용 행동이 없음`); await page.close(); return; }
  await applyButtons.nth(count - 1).click();
  await page.waitForTimeout(OPERATOR_WAIT);
  const resolved = await readState(page, scenario);
  if (resolved.cases[0].resolutionItems.some((item) => item.kind === 'unresolved')) {
    failures.push(`${label}: 마지막 미해결이 해소되지 않음`);
  }

  const published = await approveAndPublish(page, BASE, scenario, caseId, failures, label);
  if (published) {
    const publication = published.publications[0];
    if (!publication) failures.push(`${label}: 게시본이 없음`);
    else if (publication.changedLessonIds.length < 4) {
      failures.push(`${label}: 하루치 변경이 게시본에 모이지 않음 (${publication.changedLessonIds.length}건)`);
    }
    await shot(page, 'journey-2-published');
  }
  await page.close();
}

/** 여정 3 — 병렬 묶음. 쪼개는 교체가 없으니 보강으로 닫힌다. */
async function journeyThree(ctx, BASE, failures, shot) {
  const label = '여정3 선택과목 블록';
  const scenario = 'elective-block';
  const page = await ctx.newPage();
  page.on('pageerror', (error) => failures.push(`${label} 페이지 오류: ${error.message}`));
  const initial = await openScenario(page, BASE, scenario, failures);
  if (!initial) { await page.close(); return; }
  const caseId = initial.cases[0].id;

  await page.goto(opsUrl(BASE, scenario, caseId, 'case'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(OPERATOR_WAIT);
  const methods = await page.locator('.ops-resolution-controls select option').allInnerTexts();
  if (methods.some((text) => text.includes('맞교환') || text.includes('연쇄'))) {
    failures.push(`${label}: 병렬 묶음을 쪼개는 교체안이 후보로 나옴`);
  }
  await shot(page, 'journey-3-candidates');

  const chosen = await readState(page, scenario);
  const selected = chosen.cases[0].resolutionItems[0];
  if (selected?.kind !== 'cover') failures.push(`${label}: 보강이 선택된 상태가 아님`);
  // 보강은 묶음 세 수업을 함께 옮겨야 한다. 하나만 건드리면 묶음이 깨진다.
  if ((selected?.changes.length ?? 0) !== 3) {
    failures.push(`${label}: 보강이 묶음 전체를 담지 않음 (${selected?.changes.length ?? 0}개)`);
  }
  const published = await approveAndPublish(page, BASE, scenario, caseId, failures, label);
  if (published && published.publications.length !== 1) failures.push(`${label}: 보강 게시본이 남지 않음`);
  await page.close();
}

/** 여정 4 — 동시 사건. 먼저 승인된 것과 충돌하는 오래된 후보는 막혀야 한다. */
async function journeyFour(ctx, BASE, failures, shot) {
  const label = '여정4 동시 사건';
  const scenario = 'concurrent-request';
  const page = await ctx.newPage();
  page.on('pageerror', (error) => failures.push(`${label} 페이지 오류: ${error.message}`));
  const initial = await openScenario(page, BASE, scenario, failures);
  if (!initial) { await page.close(); return; }
  const stale = initial.cases.find((item) => item.status === 'in_review');
  if (!stale) { failures.push(`${label}: 재검증 대상 사건이 없음`); await page.close(); return; }

  await page.goto(opsUrl(BASE, scenario, stale.id, 'case'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(OPERATOR_WAIT);
  const approve = page.getByRole('button', { name: '해결안 승인' });
  if (!(await approve.isDisabled())) failures.push(`${label}: 충돌하는 오래된 후보인데 승인이 열려 있음`);
  const validation = await page.locator('.ops-plan-validation').innerText();
  if (validation.includes('승인할 수 있습니다')) failures.push(`${label}: 충돌 상태를 승인 가능으로 알림`);
  await shot(page, 'journey-4-blocked');

  await page.getByRole('button', { name: '재계산으로 돌려보내기' }).click();
  await page.waitForTimeout(OPERATOR_WAIT);
  const recomputed = await readState(page, scenario);
  const recomputedCase = recomputed.cases.find((item) => item.id === stale.id);
  if (recomputedCase.resolutionItems.length !== 0) failures.push(`${label}: 재계산이 오래된 후보를 지우지 않음`);
  if (!recomputed.audit.some((item) => item.type === 'case.recomputation_requested')) {
    failures.push(`${label}: 재계산 요청이 감사 기록에 남지 않음`);
  }

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(OPERATOR_WAIT);
  const applyAgain = page.getByRole('button', { name: '대안 적용' });
  if (await applyAgain.count()) {
    await applyAgain.first().click();
    await page.waitForTimeout(OPERATOR_WAIT);
    const revalidated = await readState(page, scenario);
    const fresh = revalidated.cases.find((item) => item.id === stale.id);
    if (fresh.resolutionItems[0]?.computedAgainstRevisionId !== revalidated.workspace.activeRevisionId) {
      failures.push(`${label}: 새 후보가 활성 버전 기준이 아님`);
    }
  } else {
    // 다른 사건이 이미 그 수업을 가져갔으면 옮길 자리가 없는 것이 맞다.
    // 그때 화면은 이유와 다음 행동을 말해야 하며, 반려 길이 열려 있어야 한다.
    const explanation = await page.locator('.ops-no-candidate').innerText().catch(() => '');
    if (!explanation.includes('반려')) {
      failures.push(`${label}: 후보가 없는 이유와 다음 행동을 말하지 않음 (${explanation || '설명 없음'})`);
    }
    if (!(await page.getByRole('button', { name: '사유와 함께 반려' }).count())) {
      failures.push(`${label}: 막다른 길에서 반려 행동이 없음`);
    }
    await shot(page, 'journey-4-dead-end');
  }
  await page.close();
}

/** 여정 5 — 게시 후 정정. 원본은 지우지 않고 대체 게시로 갈아 끼운다. */
async function journeyFive(ctx, BASE, failures, shot) {
  const label = '여정5 정정 게시';
  const scenario = 'published-correction';
  const page = await ctx.newPage();
  page.on('pageerror', (error) => failures.push(`${label} 페이지 오류: ${error.message}`));
  const initial = await openScenario(page, BASE, scenario, failures);
  if (!initial) { await page.close(); return; }
  const original = initial.cases.find((item) => item.status === 'published');
  const correction = initial.cases.find((item) => item.supersedesCaseId);
  if (!original || !correction) {
    failures.push(`${label}: 게시본과 정정 초안이 준비되지 않음`);
    await page.close();
    return;
  }
  const before = await assertPublicClass(ctx, BASE, scenario, '2', '1', failures, `${label} 정정 전`, { changed: 1 });

  await page.goto(opsUrl(BASE, scenario, correction.id, 'case'), { waitUntil: 'networkidle' });
  await page.waitForTimeout(OPERATOR_WAIT);
  const start = page.locator('[data-start-correction-review]');
  if (!(await start.count())) {
    failures.push(`${label}: 정정 초안을 검토로 올릴 길이 없음`);
    await page.close();
    return;
  }
  await start.click();
  await page.waitForTimeout(OPERATOR_WAIT);
  const apply = page.getByRole('button', { name: '대안 적용' });
  if (!(await apply.count())) {
    failures.push(`${label}: 정정 사건에 새 후보가 없음`);
    await page.close();
    return;
  }
  await apply.first().click();
  await page.waitForTimeout(OPERATOR_WAIT);
  await shot(page, 'journey-5-correction');

  const published = await approveAndPublish(page, BASE, scenario, correction.id, failures, label);
  if (published) {
    const originalCase = published.cases.find((item) => item.id === original.id);
    const correctionCase = published.cases.find((item) => item.id === correction.id);
    if (originalCase?.status !== 'superseded') failures.push(`${label}: 원본이 superseded 로 바뀌지 않음`);
    if (correctionCase?.status !== 'published') failures.push(`${label}: 정정 사건이 게시되지 않음`);
    if (published.publications.length !== 2) failures.push(`${label}: 게시본이 둘로 남지 않음`);
    const replacement = published.publications.find((item) => item.caseId === correction.id);
    if (!replacement?.supersedesPublicationId) failures.push(`${label}: 대체 게시본이 이전 게시본을 가리키지 않음`);
    if (!published.audit.some((item) => item.type === 'case.superseded')) {
      failures.push(`${label}: 대체 사실이 감사 기록에 남지 않음`);
    }
    await shot(page, 'journey-5-published');
  }
  const after = await assertPublicClass(ctx, BASE, scenario, '2', '1', failures, `${label} 정정 후`, { changed: 1 });
  if (before.text === after.text) failures.push(`${label}: 정정 뒤에도 학급 시간표가 그대로임`);
  await page.close();
}

const JOURNEYS = [journeyOne, journeyTwo, journeyThree, journeyFour, journeyFive];

/**
 * 여정 1 은 1440, 390, 320 세 폭에서, 나머지는 데스크톱과 390px 에서 걷는다.
 * 폭마다 새 맥락을 쓰므로 앞 여정의 저장 상태가 다음 폭으로 새지 않는다.
 */
export async function runJourneys(browser, BASE, failures, shot) {
  for (const viewport of [
    { width: 1440, height: 960 },
    { width: 390, height: 844 },
    { width: 320, height: 740 },
  ]) {
    const ctx = await browser.newContext({ viewport });
    const journeys = viewport.width === 320 ? JOURNEYS.slice(0, 1) : JOURNEYS;
    for (const journey of journeys) {
      const before = failures.length;
      try {
        await journey(ctx, BASE, failures, viewport.width === 1440 ? shot : async () => undefined);
      } catch (error) {
        failures.push(`${viewport.width}px 여정 중단: ${error.message.split('\n')[0]}`);
      }
      // 폭을 알아볼 수 있게 이 여정에서 새로 생긴 실패에만 폭을 적는다.
      for (let index = before; index < failures.length; index += 1) {
        if (!failures[index].startsWith(`${viewport.width}px`)) {
          failures[index] = `${viewport.width}px ${failures[index]}`;
        }
      }
    }
    await ctx.close();
  }
}
