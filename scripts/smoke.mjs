import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.SHOT_DIR;
const exe = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const failures = [];

const shot = async (page, name) => {
  if (OUT) await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
};

const activeText = (page) => page.evaluate(() => {
  const active = document.activeElement;
  return active instanceof HTMLElement
    ? { id: active.id, text: active.textContent?.trim() ?? '', placeholder: active.getAttribute('placeholder') ?? '' }
    : { id: '', text: '', placeholder: '' };
});

const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await ctx.newPage();
page.on('pageerror', (error) => failures.push(`페이지 오류: ${error.message}`));

await page.goto(BASE, { waitUntil: 'networkidle' });
await shot(page, 'task-7-landing');
for (const action of ['우리 학교 시간표 열기', '일과 담당자로 시작', '예시 학교 둘러보기']) {
  if ((await page.getByRole('button', { name: action }).count()) !== 1) {
    failures.push(`랜딩 첫 화면에 ${action} 행동이 정확히 하나가 아님`);
  }
}
if (await page.getByPlaceholder(/인증키/).count()) failures.push('랜딩에 API 인증키 입력이 노출됨');
if ((await page.locator('main').innerText()).includes('JSON')) failures.push('랜딩에 파일 형식 설명이 노출됨');
await page.waitForTimeout(50);
if ((await activeText(page)).id !== 'landing-title') failures.push('랜딩 진입 뒤 제목으로 초점이 이동하지 않음');

await page.keyboard.press('Tab');
if (!(await activeText(page)).placeholder.includes('학교명을 검색')) failures.push('첫 Tab이 학교 진입 입력으로 가지 않음');
await page.keyboard.press('Tab');
if (!(await activeText(page)).text.includes('우리 학교 시간표 열기')) failures.push('학교 입력 다음 Tab이 열기 행동으로 가지 않음');
await page.keyboard.press('Tab');
if (!(await activeText(page)).text.includes('일과 담당자로 시작')) failures.push('랜딩 행동을 키보드 순서로 이동하지 못함');
await page.keyboard.press('Tab');
if (!(await activeText(page)).text.includes('예시 학교 둘러보기')) failures.push('예시 학교 행동을 키보드 순서로 이동하지 못함');

await page.route('**/hub/schoolInfo**', async (route) => {
  await route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ schoolInfo: [
      { head: [{ list_total_count: 1 }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] },
      { row: [{
        ATPT_OFCDC_SC_CODE: 'J10', ATPT_OFCDC_SC_NM: '경기도교육청',
        SD_SCHUL_CODE: '7531057', SCHUL_NM: '수지고등학교', SCHUL_KND_SC_NM: '고등학교',
      }] },
    ] }),
  });
});
await page.getByLabel('학교 이름 또는 받은 링크').fill('수지고등학교');
await page.getByRole('button', { name: '우리 학교 시간표 열기' }).click();
await page.waitForURL(/\?view=setup&q=/);
const initialSchoolSearch = page.getByRole('textbox', { name: '학교 이름' });
if ((await initialSchoolSearch.inputValue()) !== '수지고등학교') failures.push('랜딩 학교명이 설정 검색 입력에 이어지지 않음');
const initialSchoolHit = page.getByRole('button', { name: /수지고등학교/ });
await initialSchoolHit.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
if (!(await initialSchoolHit.count())) failures.push('랜딩 학교명으로 학교 검색이 자동 시작되지 않음');
await page.goBack({ waitUntil: 'networkidle' });
await page.waitForTimeout(50);

await page.getByRole('button', { name: '일과 담당자로 시작' }).click();
await page.waitForURL(/\?view=setup$/);
await page.waitForTimeout(50);
if ((await activeText(page)).id !== 'setup-title') failures.push('설정 진입 뒤 설정 제목으로 초점이 이동하지 않음');
const expectedSetupStages = [
  '학교 검색', '세션 인증키', '공식 자료 불러오기', '완전성 확인',
  '교사 연결', '미해결 검토', '초대 링크',
];
const visibleSetupStages = (await page.locator('[data-setup-stage]').allTextContents())
  .map((text) => text.replace(/^\d+/, '').trim());
if (visibleSetupStages.join('|') !== expectedSetupStages.join('|')) {
  failures.push(`최초 설정 단계 순서가 다름: ${visibleSetupStages.join(' → ') || '단계 없음'}`);
}
const invitationStep = page.getByRole('button', { name: /초대 링크/ });
if (!(await invitationStep.isDisabled())) failures.push('자료와 교사가 미해결인데 초대 링크 단계가 열림');
let setupFocus = await activeText(page);
for (let index = 0; index < 5 && !setupFocus.placeholder.includes('수지고등학교'); index += 1) {
  await page.keyboard.press('Tab');
  setupFocus = await activeText(page);
}
if (!setupFocus.placeholder.includes('수지고등학교')) failures.push('설정 학교 입력에 키보드로 도달하지 못함');
await shot(page, 'task-7-setup-locked');

await page.goBack({ waitUntil: 'networkidle' });
await page.waitForTimeout(50);
if ((await activeText(page)).id !== 'landing-title') failures.push('설정에서 뒤로 간 뒤 랜딩 제목으로 초점이 이동하지 않음');

await page.getByRole('button', { name: '예시 학교 둘러보기' }).click();
await page.waitForURL(/\?view=ops&school=/);
await page.waitForTimeout(80);
await shot(page, 'task-7-demo-ops');
if (!(await page.getByRole('navigation', { name: '체험 역할' }).count())) failures.push('체험 역할 내비게이션이 없음');
for (const role of ['교사', '일과 담당', '학급 공개']) {
  if (!(await page.getByRole('button', { name: role, exact: true }).count())) failures.push(`체험 역할 ${role} 보기가 없음`);
}
if (!(await page.locator('.role-navigation').innerText()).includes('로그인이나 권한 인증이 아닙니다')) {
  failures.push('체험 역할을 인증으로 오해하지 않게 하는 설명이 없음');
}
const provenance = '공개 시간표 관측 구조 기반 · 일정·교사·사건은 예시';
if (!(await page.locator('body').innerText()).includes(provenance)) failures.push('예시 자료 출처 문구가 정확하지 않음');
if ((await activeText(page)).id !== 'role-page-title') failures.push('역할 화면 진입 뒤 학교 제목으로 초점이 이동하지 않음');
const stored = await page.evaluate(() => [...Array(localStorage.length)].map((_, index) => localStorage.key(index))
  .filter((key) => key?.startsWith('joyul:v2:workspace:'))
  .map((key) => JSON.parse(localStorage.getItem(key))))
if (!stored.some((state) => state.schemaVersion === 2 && state.workspace?.name === '조율 예시학교')) {
  failures.push('예시 학교가 schema-v2 WorkspaceRepository 경계에 저장되지 않음');
}
if (stored.some((state) => JSON.stringify(state).includes('secret-key'))) failures.push('저장 상태에 인증키가 섞임');

await page.goBack({ waitUntil: 'networkidle' });
await page.waitForTimeout(50);
if ((await activeText(page)).id !== 'landing-title') failures.push('역할 화면에서 뒤로 간 뒤 학교 진입 제목으로 초점이 이동하지 않음');

await page.goto(`${BASE}/?view=teacher&school=simple-swap%3Aworkspace&teacher=teacher%3Aseo-jun`, { waitUntil: 'networkidle' });
await shot(page, 'task-8-teacher-desktop');
if (!(await page.locator('[data-teacher-home]').count())) failures.push('교사 링크가 canonical 교사 시간표를 열지 않음');
if ((await page.getByRole('tab', { name: '오늘', exact: true }).getAttribute('aria-selected')) !== 'true') {
  failures.push('교사 시간표가 오늘 탭으로 시작하지 않음');
}
for (const selector of ['[data-now-next]', '[data-today-change-count]']) {
  if (!(await page.locator(selector).count())) failures.push(`교사 첫 화면에 ${selector} 정보가 없음`);
}
if (!(await page.locator('[data-now-next]').first().innerText()).includes('오늘 첫 수업')) {
  failures.push('교사 첫 수업 카드가 근거 없는 현재 시각 표현을 사용함');
}
if (!(await page.getByRole('button', { name: '변경 요청', exact: true }).count())) failures.push('교사 첫 화면에 변경 요청 행동이 없음');
if ((await page.locator('body').innerText()).includes('teacher:seo-jun')) failures.push('교사 화면에 내부 교사 ID가 이름처럼 노출됨');

await page.evaluate(() => {
  const key = 'joyul:v2:workspace:simple-swap:workspace';
  const state = JSON.parse(localStorage.getItem(key));
  state.cases = [];
  state.audit = [];
  state.publications = [];
  localStorage.setItem(key, JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.period-rail-lesson').first().click();
if ((await page.locator('.affected-lessons input:checked').count()) !== 1) failures.push('수업 선택이 부재 날짜와 영향 수업을 미리 채우지 않음');
await page.getByRole('button', { name: '후보 계산으로 전달' }).click();
const matrix = page.locator('[data-resolution-matrix]');
if ((await matrix.count()) !== 1) {
  failures.push('후보 계산 뒤 하나의 해결안 비교 표가 열리지 않음');
  await page.getByRole('button', { name: '변경 요청 제출' }).click();
  await page.waitForTimeout(100);
  await page.getByRole('heading', { name: '요청을 제출했습니다' }).waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined);
  if ((await activeText(page)).id !== 'case-status-heading') failures.push('요청 제출 뒤 사례 상태 제목으로 초점이 이동하지 않음');
  if (await page.locator('.affected-lessons input').count()) failures.push('요청 제출 뒤 일시적인 부재 선택 표시가 남음');
  await page.getByRole('button', { name: '시간표로 돌아가기' }).click();
} else {
  if ((await page.getByRole('button', { name: '이 해결안 선택', exact: true }).count()) !== 1) {
    failures.push('해결안 선택 행동이 정확히 하나가 아님');
  }
  if (await page.getByRole('button', { name: '변경 요청 제출', exact: true }).count()) {
    failures.push('비교 중에 이전 요청 제출 행동이 함께 보임');
  }
  const radios = matrix.locator('input[type="radio"]');
  if ((await radios.count()) < 1) failures.push('해결안 비교 표가 라디오 선택을 제공하지 않음');
  if ((await radios.count()) > 1) {
    await radios.first().focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');
    if ((await radios.nth(1).isChecked()) !== true) failures.push('아래 화살표와 Space로 해결안을 선택하지 못함');
  }
  await page.getByRole('tab', { name: '주간', exact: true }).click();
  if (!(await page.locator('[data-resolution-from="true"]').count())) {
    failures.push('선택한 해결안의 원래 시간표 칸이 강조되지 않음');
  }
  if (!(await page.locator('[data-resolution-to="true"]').count())) {
    failures.push('선택한 해결안의 변경 시간표 칸이 강조되지 않음');
  }
  const beforeSelection = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')));
  if (beforeSelection.cases.length) failures.push('행 선택만으로 canonical 사례가 저장됨');
  await page.getByRole('button', { name: '이 해결안 선택', exact: true }).click();
  await page.waitForTimeout(100);
  const teacherStored = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')));
  if (!teacherStored.cases.some((item) => item.status === 'submitted' && item.resolutionItems.length === 1)) {
    failures.push('선택한 해결안이 canonical WorkspaceRepository에 한 번에 제출되지 않음');
  }
}
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.period-rail-lesson').first().click();
await page.getByRole('button', { name: '후보 계산으로 전달' }).click();
await page.getByRole('button', { name: '이 해결안 선택', exact: true }).click();
await page.waitForTimeout(100);
const duplicateStored = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')));
if (duplicateStored.cases.filter((item) => item.status === 'submitted').length !== 1) {
  failures.push('반복 매트릭스 확정이 두 번째 submitted 사례를 만들었음');
}
const duplicateMessage = page.locator('.resolution-validation');
if (!(await duplicateMessage.count()) || !(await duplicateMessage.innerText()).includes('기존 요청을 확인')) {
  failures.push('반복 매트릭스 확정에 기존 사례를 안내하는 실행 가능한 메시지가 없음');
}
await page.evaluate(() => {
  const key = 'joyul:v2:workspace:simple-swap:workspace';
  const state = JSON.parse(localStorage.getItem(key));
  state.revisions[0].complete = false;
  state.revisions[0].query = { receivedRows: '1', expectedRows: '2' };
  delete state.teacherLabels['teacher:han-sol'];
  localStorage.setItem(key, JSON.stringify(state));
});
await page.reload({ waitUntil: 'networkidle' });
await page.locator('.period-rail-lesson').first().click();
if (!(await page.getByRole('button', { name: '후보 계산으로 전달' }).isDisabled())) {
  failures.push('불완전 자료에서 후보 계산 handoff가 비활성화되지 않음');
}
const unavailableCopy = await page.locator('.source-unavailable').innerText();
if (!unavailableCopy.includes('공식 시간표 1/2건') || !unavailableCopy.includes('교사 연결 1/2명')) {
  failures.push('불완전 자료의 known/expected 진단 수치가 정확하지 않음');
}
if (!(await page.getByRole('button', { name: '진단 보고서 내보내기' }).count())) {
  failures.push('불완전 자료에서 진단 보고서 export 행동이 없음');
}

const caseCtx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const casePage = await caseCtx.newPage();
casePage.on('pageerror', (error) => failures.push(`사건 비교 페이지 오류: ${error.message}`));
await casePage.goto(BASE, { waitUntil: 'networkidle' });
await casePage.getByRole('button', { name: '예시 학교 둘러보기' }).click();
await casePage.evaluate(() => {
  const key = 'joyul:v2:workspace:simple-swap:workspace';
  const state = JSON.parse(localStorage.getItem(key));
  const target = state.lessons[0];
  const identity = target.classIdentity;
  state.cases = [];
  state.audit = [];
  state.publications = [];
  state.atomicLessonGroups = [];
  state.lessons = [
    { ...state.lessons[0], id: 'multi-lesson-1', period: '1', subject: '기계일반' },
    { ...state.lessons[0], id: 'multi-lesson-2', period: '2', subject: '기계제도', classIdentity: { ...identity, className: '2' } },
    { ...state.lessons[0], id: 'multi-lesson-3', period: '3', subject: '전기이론', classIdentity: { ...identity, className: '3' } },
    { ...state.lessons[0], id: 'multi-cover-availability', period: '7', subject: '기계일반', classIdentity: { ...identity, grade: '1', className: '1' }, teacher: { state: 'assigned', teacherId: 'member:multi-cover' } },
  ];
  state.teacherLabels = { ...state.teacherLabels, 'member:multi-cover': '윤보강' };
  localStorage.setItem(key, JSON.stringify(state));
});
await casePage.goto(`${BASE}/?view=teacher&school=simple-swap%3Aworkspace&teacher=teacher%3Aseo-jun`, { waitUntil: 'networkidle' });
await casePage.getByRole('button', { name: '변경 요청', exact: true }).click();
await casePage.getByLabel('하루 전체').check();
await casePage.getByRole('button', { name: '후보 계산으로 전달' }).click();
const multiProgress = casePage.locator('.resolution-progress');
if ((await multiProgress.count()) !== 1 || (await multiProgress.locator('li').count()) !== 3) {
  failures.push('여러 수업 사건에 해결 현황 레일이 없음');
}
if (!(await multiProgress.getByText('미해결', { exact: true }).count())) {
  failures.push('여러 수업 사건에서 아직 해결하지 않은 수업이 표시되지 않음');
}
if (!(await casePage.locator('.resolution-validation').innerText()).includes('선택된 해결안이 없어')) {
  failures.push('여러 수업 선택 뒤 전체 계획 검증 결과가 즉시 보이지 않음');
}
await casePage.evaluate(() => {
  const key = 'joyul:v2:workspace:simple-swap:workspace';
  const state = JSON.parse(localStorage.getItem(key));
  const target = state.lessons[0];
  const identity = target.classIdentity;
  state.cases = [];
  state.audit = [];
  state.publications = [];
  state.atomicLessonGroups = [];
  state.lessons = [
    { ...target, id: 'elective-target', period: '5', subject: '데이터과학', parallelGroupId: 'elective-group' },
    { ...target, id: 'elective-peer-1', period: '5', subject: '로봇공학', classIdentity: { ...identity, className: '2' }, teacher: { state: 'assigned', teacherId: 'member:elective-1' }, parallelGroupId: 'elective-group' },
    { ...target, id: 'elective-peer-2', period: '5', subject: '제품디자인', classIdentity: { ...identity, className: '3' }, teacher: { state: 'assigned', teacherId: 'member:elective-2' }, parallelGroupId: 'elective-group' },
    { ...target, id: 'elective-cover-availability', period: '6', subject: '데이터과학', classIdentity: { ...identity, grade: '1', className: '1' }, teacher: { state: 'assigned', teacherId: 'member:elective-cover' } },
  ];
  for (const period of ['1', '2', '3', '4', '6', '7']) {
    state.lessons.push({
      ...target, id: `elective-known-busy-${period}`, period, subject: '교사 배정 수업',
      classIdentity: { ...identity, grade: '1', className: '9' },
    });
  }
  state.revisions[0] = {
    ...state.revisions[0],
    closures: [
      { date: '2026-08-17', reason: '휴업일' },
      { date: '2026-08-19', reason: '휴업일' },
      { date: '2026-08-20', reason: '휴업일' },
      { date: '2026-08-21', reason: '휴업일' },
    ],
  };
  state.teacherLabels = {
    ...state.teacherLabels,
    'member:elective-1': '선택과목 담당 1',
    'member:elective-2': '선택과목 담당 2',
    'member:elective-cover': '선택과목 보강 교사',
  };
  localStorage.setItem(key, JSON.stringify(state));
});
await casePage.goto(`${BASE}/?view=teacher&school=simple-swap%3Aworkspace&teacher=teacher%3Aseo-jun`, { waitUntil: 'networkidle' });
await casePage.getByRole('button', { name: '변경 요청', exact: true }).click();
await casePage.locator('.period-rail-lesson').filter({ hasText: '데이터과학' }).click();
await casePage.getByRole('button', { name: '후보 계산으로 전달' }).click();
if (!(await casePage.locator('.resolution-atomic-note').innerText()).includes('선택과목 묶음 3개 수업')) {
  failures.push('교환 불가 선택과목 묶음의 전체 보강 제약이 설명되지 않음');
}
if ((await casePage.locator('.resolution-table tbody tr').count()) !== 1
  || !(await casePage.locator('.resolution-table').innerText()).includes('보강')) {
  failures.push('교환 불가 선택과목 묶음에 하나의 보강 행이 표시되지 않음');
}
if (!(await casePage.locator('.resolution-detail').innerText()).includes('3개 수업 단위를 함께')) {
  failures.push('선택과목 보강 미리보기가 묶음 전체를 표시하지 않음');
}
await caseCtx.close();

const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mobile = await mobileCtx.newPage();
mobile.on('pageerror', (error) => failures.push(`모바일 페이지 오류: ${error.message}`));
await mobile.goto(BASE, { waitUntil: 'networkidle' });
await shot(mobile, 'task-7-mobile-landing');
const mobileMetrics = await mobile.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  document: document.documentElement.scrollWidth,
  small: [...document.querySelectorAll('button, input, a')]
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0 && box.height < 44).length,
}));
if (mobileMetrics.document > mobileMetrics.viewport + 1) failures.push('390px 랜딩이 가로로 밀림');
if (mobileMetrics.small > 0) failures.push(`390px 랜딩에 높이 44px 미만 조작 요소 ${mobileMetrics.small}개`);
await mobile.setViewportSize({ width: 320, height: 740 });
await mobile.waitForTimeout(80);
const narrowMetrics = await mobile.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  document: document.documentElement.scrollWidth,
}));
if (narrowMetrics.document > narrowMetrics.viewport + 1) failures.push('320px 랜딩이 가로로 밀림');

await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.getByRole('button', { name: '예시 학교 둘러보기' }).click();
await mobile.waitForURL(/\?view=ops&school=/);
await mobile.goto(`${BASE}/?view=teacher&school=simple-swap%3Aworkspace&teacher=teacher%3Aseo-jun`, { waitUntil: 'networkidle' });
await shot(mobile, 'task-8-teacher-mobile');
const teacherFirstViewport = await mobile.evaluate(() => {
  const selectors = ['[data-now-next]', '[data-today-change-count]', '[data-teacher-home] .teacher-request-button'];
  return Object.fromEntries(selectors.map((selector) => {
    const node = document.querySelector(selector);
    const box = node?.getBoundingClientRect();
    return [selector, box ? { top: box.top, bottom: box.bottom } : null];
  }));
});
for (const [selector, box] of Object.entries(teacherFirstViewport)) {
  if (!box || box.top < 0 || box.bottom > 844) failures.push(`390px 첫 화면에 ${selector}가 보이지 않음`);
}
if ((await mobile.getByRole('tab', { name: '오늘', exact: true }).getAttribute('aria-selected')) !== 'true') {
  failures.push('390px 교사 시간표가 오늘 탭으로 시작하지 않음');
}
if (await mobile.locator('[data-teacher-week]').count()) failures.push('390px 첫 화면에서 주간 시간표가 오늘 흐름보다 먼저 노출됨');
const teacherMobileMetrics = await mobile.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  document: document.documentElement.scrollWidth,
}));
if (teacherMobileMetrics.document > teacherMobileMetrics.viewport + 1) failures.push('390px 교사 시간표가 가로로 밀림');
await mobile.locator('.period-rail-lesson').first().click();
const composerSmallControls = await mobile.evaluate(() => [
  ...document.querySelectorAll('.teacher-focus-tabs button, .affected-lessons > label, .absence-reason > label:not(.coordination-note), .whole-day'),
].filter((element) => {
  const box = element.getBoundingClientRect();
  return box.width > 0 && box.height > 0 && box.height < 44;
}).map((element) => element.className || element.tagName));
if (composerSmallControls.length) {
  failures.push(`390px 교사 요청 조작 요소가 44px 미만: ${composerSmallControls.join(', ')}`);
}
await mobile.getByRole('button', { name: '후보 계산으로 전달' }).click();
const mobileMatrix = mobile.locator('[data-resolution-matrix]');
if ((await mobileMatrix.count()) !== 1) {
  failures.push('390px에서 후보 비교 표가 열리지 않음');
} else {
  const matrixMetrics = await mobile.evaluate(() => {
    const table = document.querySelector('.resolution-table');
    const action = document.querySelector('.resolution-action');
    const lastDetail = document.querySelector('.resolution-detail-list > div:last-child');
    const primary = document.querySelector('.resolution-action .btn');
    lastDetail?.scrollIntoView({ block: 'end' });
    return {
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      table: table ? { width: table.clientWidth, scroll: table.scrollWidth } : null,
      labeledPairs: [...document.querySelectorAll('.resolution-table td')]
        .every((cell) => cell.hasAttribute('data-label')),
      visiblePairLabels: getComputedStyle(document.querySelector('.resolution-table td'), '::before').content,
      primaryHeight: primary?.getBoundingClientRect().height ?? 0,
      actionTop: action?.getBoundingClientRect().top ?? 0,
      lastDetailBottom: lastDetail?.getBoundingClientRect().bottom ?? 0,
    };
  });
  if (matrixMetrics.document > matrixMetrics.viewport + 1) failures.push('390px 해결안 비교가 가로로 밀림');
  if (matrixMetrics.table && matrixMetrics.table.scroll > matrixMetrics.table.width + 1) failures.push('390px 해결안 비교 표가 가로로 스크롤됨');
  if (!matrixMetrics.labeledPairs) failures.push('390px 해결안 비교가 항목 이름을 붙인 행 쌍이 아님');
  if (matrixMetrics.visiblePairLabels === 'none' || matrixMetrics.visiblePairLabels === 'normal') failures.push('390px 해결안 비교의 항목 이름이 화면에 보이지 않음');
  if (matrixMetrics.primaryHeight < 44) failures.push('390px 해결안 선택 행동이 44px 미만');
  if (matrixMetrics.lastDetailBottom > matrixMetrics.actionTop) failures.push('390px 고정 해결안 행동이 마지막 상세 행을 가림');
  await mobile.setViewportSize({ width: 320, height: 740 });
  await mobile.waitForTimeout(80);
  const narrowMatrix = await mobile.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    table: document.querySelector('.resolution-table'),
    labeledPairs: [...document.querySelectorAll('.resolution-table td')]
      .every((cell) => cell.hasAttribute('data-label')),
    visiblePairLabels: getComputedStyle(document.querySelector('.resolution-table td'), '::before').content,
    primaryHeight: document.querySelector('.resolution-action .btn')?.getBoundingClientRect().height ?? 0,
  }));
  if (narrowMatrix.document > narrowMatrix.viewport + 1) failures.push('320px 해결안 비교가 가로로 밀림');
  if (!narrowMatrix.labeledPairs) failures.push('320px 해결안 비교가 항목 이름을 붙인 행 쌍이 아님');
  if (narrowMatrix.visiblePairLabels === 'none' || narrowMatrix.visiblePairLabels === 'normal') failures.push('320px 해결안 비교의 항목 이름이 화면에 보이지 않음');
  if (narrowMatrix.primaryHeight < 44) failures.push('320px 해결안 선택 행동이 44px 미만');
}

console.log('랜딩 행동·민감 입력 분리:', failures.some((item) => item.includes('랜딩')) ? '실패' : '통과');
console.log('최초 설정 순서·게이트:', failures.some((item) => item.includes('설정') || item.includes('초대')) ? '실패' : '통과');
console.log('체험 역할·출처:', failures.some((item) => item.includes('역할') || item.includes('출처')) ? '실패' : '통과');
console.log('모바일 폭:', mobileMetrics.viewport, '문서 폭:', mobileMetrics.document, '작은 조작:', mobileMetrics.small);
console.log('교사 오늘·변경 요청:', failures.some((item) => item.includes('교사') || item.includes('변경 요청')) ? '실패' : '통과');
console.log('검증 결과:', failures.length ? failures : '모두 통과');

await mobileCtx.close();
await ctx.close();
await browser.close();
process.exit(failures.length ? 1 : 0);
