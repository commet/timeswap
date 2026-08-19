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
if (!(await page.locator('[data-candidate-handoff]').count())) failures.push('후보 비교 handoff 상태가 노출되지 않음');
await page.getByRole('button', { name: '변경 요청 제출' }).click();
await page.waitForTimeout(100);
await page.getByRole('heading', { name: '요청을 제출했습니다' }).waitFor({ state: 'visible', timeout: 1_000 }).catch(() => undefined);
if ((await activeText(page)).id !== 'case-status-heading') failures.push('요청 제출 뒤 사례 상태 제목으로 초점이 이동하지 않음');
if (await page.locator('.affected-lessons input').count()) failures.push('요청 제출 뒤 일시적인 부재 선택 표시가 남음');
const teacherStored = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')));
if (!teacherStored.cases.some((item) => item.status === 'submitted')) failures.push('교사 요청이 canonical WorkspaceRepository에 제출되지 않음');
await page.getByRole('button', { name: '시간표로 돌아가기' }).click();
await page.locator('.period-rail-lesson').first().click();
await page.getByRole('button', { name: '변경 요청 제출' }).click();
if (!(await page.locator('[role="alert"]').filter({ hasText: '기존 요청을 확인' }).count())) {
  failures.push('중복 교사 요청에 실행 가능한 안내가 없음');
}
await page.getByRole('button', { name: '닫기' }).click();
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
