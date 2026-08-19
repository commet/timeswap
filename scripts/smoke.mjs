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
if (!(await page.locator('[data-ops-command-center]').count())) {
  failures.push('일과 담당 예시가 canonical 변경 관제판을 열지 않음');
}
const expectedOpsMetrics = {
  todayChanges: '0', unresolvedLessons: '0', pendingCases: '1',
  neisTasks: '0', publicationTasks: '0', burdenAlerts: '0',
};
for (const [key, expected] of Object.entries(expectedOpsMetrics)) {
  const actual = (await page.locator(`[data-ops-metric="${key}"] dd`).innerText().catch(() => '')).trim();
  if (actual !== expected) failures.push(`관제판 ${key} 수치가 projectOpsDashboard와 다름: ${actual || '없음'}`);
}
if (!(await page.locator('[data-case-detail]').count())) failures.push('데스크톱 관제판에 선택 사건 상세 레일이 없음');
if (!(await page.locator('.ops-period-timeline button').count())) failures.push('오늘 교시별 변경 타임라인이 없음');
if (!(await page.locator('.ops-source-health').innerText().catch(() => '')).includes('완전 · demo')) failures.push('관제판에 시간표 자료 상태가 없음');
if (!(await page.locator('.ops-period-timeline').innerText()).includes('1명 교사 · 1개 학급')) failures.push('교시 표식에 영향 교사·학급 수가 없음');
if ((await page.locator('body').innerText()).includes('teacher:seo-jun')) failures.push('관제판에 내부 교사 ID가 노출됨');
const initialNavigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length);
await page.locator('.ops-period-timeline button').first().click();
await page.waitForURL(/\?view=ops&school=.*&case=.*&step=case/);
if ((await page.evaluate(() => performance.getEntriesByType('navigation').length)) !== initialNavigationCount) {
  failures.push('타임라인 사건 선택이 전체 페이지를 다시 불러옴');
}
const simpleBaseline = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')));

await page.getByRole('button', { name: '현실 사례 바꾸기' }).click();
const operationalScenarioIds = await page.locator('[data-demo-scenario]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-demo-scenario')));
const expectedScenarioIds = ['full-day-absence', 'elective-block', 'practice-block', 'closure-conflict', 'incomplete-api', 'concurrent-request', 'published-correction'];
if (operationalScenarioIds.join('|') !== expectedScenarioIds.join('|')) {
  failures.push(`현실 사례 선택기가 2~8만 제공하지 않음: ${operationalScenarioIds.join('|')}`);
}
await page.locator('[data-demo-scenario="full-day-absence"]').click();
await page.getByRole('button', { name: '초기화 확인' }).click();
await page.waitForURL(/school=full-day-absence%3Aworkspace/);
if ((await page.locator('body').innerText()).includes('직업계고 동명 반')) failures.push('자료 진단 사례가 운영 선택기에 섞임');
await page.goto(`${BASE}/?view=ops&school=simple-swap%3Aworkspace&case=simple-swap%3Acase%3Arequest`, { waitUntil: 'networkidle' });

await page.getByRole('button', { name: '대안 적용' }).click();
let actionStored = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')));
if (!actionStored.audit.some((event) => event.type === 'case.resolution_changed')) {
  failures.push('대안 적용이 감사 기록을 남기지 않음');
}
await page.getByRole('button', { name: '재계산으로 돌려보내기' }).click();
actionStored = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')));
if (!actionStored.audit.some((event) => event.type === 'case.recomputation_requested') || actionStored.cases[0].resolutionItems.length !== 0) {
  failures.push('재계산 요청이 해결안을 지우고 감사 기록을 남기지 않음');
}
await page.getByPlaceholder('다시 조정해야 하는 이유').fill('수업 충돌을 다시 확인해야 합니다');
await page.getByRole('button', { name: '사유와 함께 반려' }).click();
actionStored = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')));
if (actionStored.cases[0].status !== 'rejected' || !actionStored.audit.some((event) => event.type === 'case.status_changed')) {
  failures.push('반려가 canonical 상태와 감사 기록을 함께 바꾸지 않음');
}

await page.evaluate((baseline) => localStorage.setItem('joyul:v2:workspace:simple-swap:workspace', JSON.stringify(baseline)), simpleBaseline);
await page.reload({ waitUntil: 'networkidle' });
const saveFailureAuditCount = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')).audit.length);
await page.evaluate(() => {
  const original = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    if (String(key).startsWith('joyul:v2:workspace:')) throw new DOMException('full', 'QuotaExceededError');
    return original.call(this, key, value);
  };
});
await page.getByRole('button', { name: '대안 적용' }).click();
const saveFailureText = await page.locator('.ops-action-message').innerText().catch(() => '');
const saveFailureState = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')));
if (!saveFailureText.includes('변경하지 않았습니다') || saveFailureState.audit.length !== saveFailureAuditCount) {
  failures.push('저장 실패 뒤 관제판이 성공을 알리거나 상태를 앞당김');
}

await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: '해결안 승인' }).click();
actionStored = await page.evaluate(() => JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace')));
if (actionStored.cases[0].status !== 'admin_in_progress') failures.push('유효한 사건을 승인하지 못함');
if (actionStored.adminTasks.length !== 4) failures.push('승인과 함께 행정 과업이 생기지 않음');
await page.evaluate((baseline) => {
  const state = { ...baseline, revisions: [{ ...baseline.revisions[0], source: 'neis' }] };
  localStorage.setItem('joyul:v2:workspace:simple-swap:workspace', JSON.stringify(state));
}, simpleBaseline);
await page.reload({ waitUntil: 'networkidle' });
if (!(await page.locator('.demo-scenario-picker.locked').count())) failures.push('실제 또는 나이스 작업공간의 예시 초기화를 막지 않음');
await page.evaluate((baseline) => localStorage.setItem('joyul:v2:workspace:simple-swap:workspace', JSON.stringify(baseline)), simpleBaseline);
await page.goto(`${BASE}/?view=ops&school=simple-swap%3Aworkspace&case=simple-swap%3Acase%3Arequest`, { waitUntil: 'networkidle' });
await page.waitForTimeout(50);
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
const mobileOpsFirst = await mobile.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  document: document.documentElement.scrollWidth,
  step: document.querySelector('[data-ops-command-center]')?.getAttribute('data-ops-step'),
  listVisible: Boolean(document.querySelector('.ops-priority-region')),
  detailVisible: Boolean(document.querySelector('.ops-case-region')),
}));
if (mobileOpsFirst.document > mobileOpsFirst.viewport + 1) failures.push('390px 관제판 사건 목록이 가로로 밀림');
if (mobileOpsFirst.step !== 'list' || !mobileOpsFirst.listVisible) failures.push('390px 관제판이 URL 사건 목록 단계로 시작하지 않음');
await shot(mobile, 'task-10-ops-mobile-list');
await mobile.locator('.ops-priority-region button').first().click();
await mobile.waitForURL(/&step=case/);
if (!(await mobile.locator('.ops-case-detail').count()) || !(await mobile.getByRole('button', { name: '← 사건 목록으로' }).count())) {
  failures.push('390px 사건 상세 단계에 보이는 뒤로 가기 행동이 없음');
}
const mobileCaseMetrics = await mobile.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  document: document.documentElement.scrollWidth,
  smallControls: [...document.querySelectorAll('.ops-case-detail button, .ops-case-detail select')]
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0 && box.height < 44).length,
}));
if (mobileCaseMetrics.document > mobileCaseMetrics.viewport + 1) failures.push('390px 관제판 사건 상세가 가로로 밀림');
if (mobileCaseMetrics.smallControls) failures.push(`390px 관제판 사건 상세에 44px 미만 조작 요소 ${mobileCaseMetrics.smallControls}개`);
await mobile.getByRole('button', { name: '← 사건 목록으로' }).first().click();
await mobile.waitForURL(/\?view=ops&school=[^&]+$/);
await mobile.evaluate(() => {
  const key = 'joyul:v2:workspace:simple-swap:workspace';
  const state = JSON.parse(localStorage.getItem(key));
  state.cases[0].status = 'resolution_approved';
  localStorage.setItem(key, JSON.stringify(state));
});
await mobile.goto(`${BASE}/?view=ops&school=simple-swap%3Aworkspace&case=simple-swap%3Acase%3Arequest&step=case`, { waitUntil: 'networkidle' });
await mobile.getByRole('button', { name: '행정 마감 현황' }).click();
await mobile.waitForURL(/&step=admin/);
if (!(await mobile.locator('#ops-admin-title').count())) failures.push('390px 행정 마감 단계가 URL로 열리지 않음');
await mobile.setViewportSize({ width: 320, height: 740 });
await mobile.waitForTimeout(80);
await shot(mobile, 'task-10-ops-mobile-admin');
const narrowOps = await mobile.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  document: document.documentElement.scrollWidth,
  backHeight: document.querySelector('.ops-administration-step .ops-mobile-back')?.getBoundingClientRect().height ?? 0,
}));
if (narrowOps.document > narrowOps.viewport + 1) failures.push('320px 관제판 행정 단계가 가로로 밀림');
if (narrowOps.backHeight < 44) failures.push('320px 관제판 뒤로 가기 행동이 44px 미만');
await mobile.setViewportSize({ width: 390, height: 844 });
await mobile.evaluate(() => {
  const key = 'joyul:v2:workspace:simple-swap:workspace';
  const state = JSON.parse(localStorage.getItem(key));
  state.cases[0].status = 'in_review';
  localStorage.setItem(key, JSON.stringify(state));
});
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


// Task 11 — 승인 뒤 행정 마감을 거쳐야만 학급·교사 시간표로 전파되는지 본다.
// 게시 전후를 같은 학급 URL 을 새 페이지로 열어 확인한다. 화면에 남은 메모리 상태로
// 통과하는 일이 없도록 게시 판정은 항상 새로 연 페이지가 한다.
const classUrl = `${BASE}/?view=class&school=simple-swap%3Aworkspace&grade=2&class=1`;
await page.setViewportSize({ width: 1440, height: 960 });
await page.evaluate((baseline) => localStorage.setItem('joyul:v2:workspace:simple-swap:workspace', JSON.stringify(baseline)), simpleBaseline);
await page.goto(`${BASE}/?view=ops&school=simple-swap%3Aworkspace&case=simple-swap%3Acase%3Arequest`, { waitUntil: 'networkidle' });
await page.waitForTimeout(60);
await page.getByRole('button', { name: '대안 적용' }).click();
await page.waitForTimeout(60);
await page.getByRole('button', { name: '해결안 승인' }).click();
await page.waitForURL(/step=admin/, { timeout: 5_000 }).catch(() => failures.push('승인 후 행정 마감 화면으로 넘어가지 않음'));
await page.waitForTimeout(100);

const publicationCenter = page.locator('[data-publication-center]');
if ((await publicationCenter.count()) !== 1) {
  failures.push('데스크톱에서 게시 센터가 열리지 않음');
} else {
  await shot(page, 'task-11-publication-desktop');
  const approvedStage = await page.locator('[data-publication-stage]').first().innerText();
  if (!approvedStage.includes('승인 완료')) failures.push('승인 완료와 게시 대기를 구분해 보여 주지 않음');
  const taskKinds = await page.locator('[data-publication-task]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-publication-task')));
  for (const kind of ['neis', 'teacher_notice', 'class_publication', 'internal_document']) {
    if (!taskKinds.includes(kind)) failures.push(`행정 과업 ${kind} 이 생성되지 않음`);
  }
  if (await page.locator('[data-publish-action]').isEnabled()) {
    failures.push('필수 과업이 남았는데 게시 행동이 열려 있음');
  }
}

// 게시 전에는 학급 시간표에 원래 시간표만 있어야 한다.
const publicPage = await ctx.newPage();
publicPage.on('pageerror', (error) => failures.push(`학급 시간표 오류: ${error.message}`));
await publicPage.goto(classUrl, { waitUntil: 'networkidle' });
await publicPage.waitForTimeout(80);
const beforePublic = await publicPage.evaluate(() => ({
  rendered: Boolean(document.querySelector('[data-public-class]')),
  changed: document.querySelectorAll('.public-class-lessons > li.changed').length,
  text: document.body.innerText,
}));
if (!beforePublic.rendered) failures.push('학급 공개 시간표가 그려지지 않음');
if (beforePublic.changed !== 0) failures.push('게시 전인데 학급 시간표에 변경이 이미 보임');
for (const secret of ['연수·출장', 'teacher:seo-jun']) {
  if (beforePublic.text.includes(secret)) failures.push(`학급 공개 시간표에 내부 정보 노출: ${secret}`);
}

// 클립보드가 막힌 자리는 완료로 넘어가지 않고 직접 복사할 문구를 남겨야 한다.
await page.evaluate(() => {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: () => Promise.reject(new Error('denied')) },
  });
});
await page.locator('[data-publication-task="neis"]').getByRole('button', { name: '복사하고 완료' }).click();
await page.waitForTimeout(100);
const deniedClipboard = await page.evaluate(() => ({
  fallback: Boolean(document.querySelector('[data-publication-task="neis"] .publication-fallback textarea')),
  done: document.querySelector('[data-publication-task="neis"]')?.classList.contains('done') ?? false,
}));
if (!deniedClipboard.fallback) failures.push('클립보드가 막혔는데 직접 복사할 문구를 주지 않음');
if (deniedClipboard.done) failures.push('클립보드가 막혔는데 나이스 입력을 완료로 표시함');

for (const [kind, name] of [
  ['neis', '직접 입력했음'],
  ['teacher_notice', '이미 안내했음'],
  ['class_publication', '미리보기 확인했음'],
]) {
  await page.locator(`[data-publication-task="${kind}"]`).getByRole('button', { name }).click();
  await page.waitForTimeout(80);
}
const readyStage = await page.locator('[data-publication-stage]').first().innerText();
if (!readyStage.includes('게시 대기')) failures.push('필수 과업을 마쳤는데 게시 대기로 넘어가지 않음');
const internalDone = await page.evaluate(() =>
  document.querySelector('[data-publication-task="internal_document"]')?.classList.contains('done') ?? false);
if (internalDone) failures.push('출력하지 않은 내부 기록이 완료로 표시됨');
if (!(await page.locator('[data-publish-action]').isEnabled())) {
  failures.push('필수 과업을 마쳤는데 게시 행동이 잠겨 있음');
}

await page.locator('[data-publish-action]').click();
await page.waitForTimeout(150);
const published = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace'));
  return {
    status: state.cases.find((item) => item.id === 'simple-swap:case:request')?.status,
    publications: state.publications.length,
    changed: state.publications[0]?.changedLessonIds ?? [],
    pulse: Boolean(document.querySelector('[data-change-pulse]')),
  };
});
if (published.status !== 'published') failures.push('게시 후 사건 상태가 published 가 아님');
if (published.publications !== 1) failures.push('게시본이 한 건 기록되지 않음');
if (published.changed.length !== 2) failures.push('맞교환 두 수업이 게시본에 함께 담기지 않음');
if (!published.pulse) failures.push('게시 전파 표시가 나타나지 않음');
await shot(page, 'task-11-published-desktop');

// 게시 뒤에는 같은 학급 URL 을 다시 연 페이지가 변경과 게시 시각을 보여야 한다.
await publicPage.reload({ waitUntil: 'networkidle' });
await publicPage.waitForTimeout(100);
const afterPublic = await publicPage.evaluate(() => ({
  changed: document.querySelectorAll('.public-class-lessons > li.changed').length,
  badges: document.querySelectorAll('.public-class-badge').length,
  text: document.body.innerText,
}));
if (afterPublic.changed === 0) failures.push('게시 후에도 학급 시간표에 변경이 보이지 않음');
if (afterPublic.badges === 0) failures.push('게시 후 학급 시간표에 변경 표시가 없음');
if (!/마지막 게시/.test(afterPublic.text)) failures.push('학급 시간표에 게시 시각이 없음');
for (const secret of ['연수·출장', 'teacher:seo-jun']) {
  if (afterPublic.text.includes(secret)) failures.push(`게시 후 학급 시간표에 내부 정보 노출: ${secret}`);
}
await shot(publicPage, 'task-11-public-class');

// 같은 사실이 교사 시간표에도 도착해야 한다.
await publicPage.goto(`${BASE}/?view=teacher&school=simple-swap%3Aworkspace&teacher=teacher%3Aseo-jun`, { waitUntil: 'networkidle' });
await publicPage.waitForTimeout(100);
const teacherAfter = await publicPage.evaluate(() => document.body.innerText);
if (!teacherAfter.includes('4교시')) failures.push('교사 시간표가 게시된 교시를 보여 주지 않음');

// 잘못 나간 게시는 지우지 않고 대체 사건으로 다시 결정한다.
await page.locator('[data-correction-action]').click();
await page.waitForTimeout(150);
const correction = await page.evaluate(() => {
  const state = JSON.parse(localStorage.getItem('joyul:v2:workspace:simple-swap:workspace'));
  const source = state.cases.find((item) => item.id === 'simple-swap:case:request');
  const created = state.cases.find((item) => item.supersedesCaseId === 'simple-swap:case:request');
  return {
    sourceStatus: source?.status,
    createdStatus: created?.status,
    createdId: created?.id ?? '',
    correctionAudit: state.audit.some((item) => item.type === 'case.correction_created'),
    url: location.search,
  };
});
if (!correction.createdId) failures.push('정정 사건이 만들어지지 않음');
if (correction.createdStatus !== 'draft') failures.push('정정 사건이 초안으로 시작하지 않음');
if (correction.sourceStatus !== 'published') failures.push('정정 시작만으로 원본 게시가 내려감');
if (!correction.correctionAudit) failures.push('정정 사건 생성이 감사 기록에 남지 않음');
if (!correction.url.includes(encodeURIComponent(correction.createdId))) {
  failures.push('정정 사건을 만든 뒤 그 사건으로 이동하지 않음');
}

// 320px 에서도 행정 마감 화면이 가로로 밀리지 않아야 한다.
const narrowAdmin = await ctx.newPage();
await narrowAdmin.setViewportSize({ width: 320, height: 740 });
await narrowAdmin.goto(`${BASE}/?view=ops&school=simple-swap%3Aworkspace&case=simple-swap%3Acase%3Arequest&step=admin`, { waitUntil: 'networkidle' });
await narrowAdmin.waitForTimeout(100);
const narrowAdminMetrics = await narrowAdmin.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  document: document.documentElement.scrollWidth,
  small: [...document.querySelectorAll('.publication-center .btn')]
    .filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && (box.height < 44 || box.width < 44);
    }).length,
}));
if (narrowAdminMetrics.document > narrowAdminMetrics.viewport + 1) failures.push('320px 행정 마감 화면이 가로로 밀림');
if (narrowAdminMetrics.small > 0) failures.push(`320px 행정 마감 조작 ${narrowAdminMetrics.small}개가 44px 미만`);
await shot(narrowAdmin, 'task-11-publication-320');
await narrowAdmin.close();
await publicPage.close();

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
