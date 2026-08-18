import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.SHOT_DIR ?? '.';
const exe = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const failures = [];

async function startSample(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '예시로 1분 체험' }).click();
  await page.waitForSelector('.pick-list');
  await page.locator('.pick-list button').first().click();
  await page.waitForSelector('.teacher-overview');
}

async function selectWorkableLesson(page) {
  const lessons = page.locator('button.cell.lesson');
  for (let index = 0; index < Math.min(await lessons.count(), 16); index += 1) {
    await lessons.nth(index).click();
    await page.waitForTimeout(140);
    if (await page.getByRole('button', { name: '이 안으로 요청' }).count()) return true;
    const clear = page.getByRole('button', { name: '다른 수업' });
    if (await clear.count()) await clear.click();
    else await lessons.nth(index).click();
  }
  return false;
}

const ctx = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
page.on('pageerror', (error) => failures.push('페이지 오류: ' + error.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/shot-1-landing.png`, fullPage: true });
if ((await page.locator('.entry-path').count()) !== 2) failures.push('랜딩 시작 경로가 두 개가 아님');

await startSample(page);
await page.screenshot({ path: `${OUT}/shot-2-teacher-home.png`, fullPage: true });
await page.getByRole('button', { name: '변경 요청' }).click();
await page.waitForSelector('.tt-grid');
if (!(await selectWorkableLesson(page))) failures.push('요청할 수 있는 예시 수업을 찾지 못함');
await page.waitForSelector('.candidate-compare');
await page.screenshot({ path: `${OUT}/shot-3-compare.png`, fullPage: true });

const primaryActions = await page.getByRole('button', { name: '이 안으로 요청' }).count();
if (primaryActions !== 1) failures.push('비교 화면의 주요 요청 행동이 ' + primaryActions + '개임');
await page.getByRole('button', { name: '이 안으로 요청' }).click();
await page.waitForSelector('.request-status-list .status-pill.pending');
await page.waitForTimeout(100);
if ((await page.evaluate(() => document.activeElement?.id)) !== 'my-requests-title') failures.push('요청 뒤 상태 제목으로 초점이 이동하지 않음');
if ((await page.locator('.cell.absent').count()) !== 0) failures.push('요청 후 선택한 결강 표시가 남음');

await page.getByRole('button', { name: /일과 요청함/ }).click();
await page.waitForSelector('.ops-work');
await page.screenshot({ path: `${OUT}/shot-4-ops-inbox.png`, fullPage: true });
const alternativeSelect = page.getByLabel('승인할 교체안');
if (await alternativeSelect.count()) {
  const options = await alternativeSelect.locator('option').count();
  if (options > 1) {
    await alternativeSelect.selectOption('1');
    await page.waitForTimeout(100);
    if ((await alternativeSelect.inputValue()) !== '1') failures.push('담당자가 승인할 다른 교체안을 선택하지 못함');
  }
} else failures.push('담당자에게 함께 계산된 다른 교체안이 보이지 않음');
await page.getByRole('button', { name: '이 안으로 승인' }).click();
await page.waitForSelector('.admin-checklist');
await page.waitForTimeout(100);
if ((await page.evaluate(() => document.activeElement?.id)) !== 'admin-checklist-title') failures.push('승인 뒤 행정 마무리로 초점이 이동하지 않음');
await page.getByRole('button', { name: '입력 목록 복사' }).click();
await page.waitForTimeout(120);
const neisText = await page.evaluate(() => navigator.clipboard.readText());
if (!neisText.includes('나이스 입력용')) failures.push('선택한 요청의 나이스 입력 목록 복사 실패');
await page.getByRole('button', { name: '공지 복사' }).click();
await page.waitForTimeout(120);
const noticeText = await page.evaluate(() => navigator.clipboard.readText());
if (!noticeText.includes('수업 변경 안내')) failures.push('선택한 요청의 공지 복사 실패');
if ((await page.getByRole('button', { name: '계획서 인쇄' }).count()) !== 1) failures.push('선택한 요청의 계획서 인쇄 행동 없음');
const checks = page.locator('.admin-checklist input[type="checkbox"]');
for (let index = 0; index < 3; index += 1) await checks.nth(index).check();
const publish = page.getByRole('button', { name: '변경 시간표 게시' });
if (await publish.isDisabled()) failures.push('행정 체크 완료 뒤 게시 버튼이 비활성임');
await publish.click();
await page.waitForSelector('.ops-detail .status-pill.published');
await page.waitForTimeout(100);
if ((await page.evaluate(() => document.activeElement?.id)) !== 'ops-detail-title') failures.push('게시 뒤 요청 제목으로 초점이 이동하지 않음');
await page.screenshot({ path: `${OUT}/shot-5-published.png`, fullPage: true });

await page.getByRole('button', { name: '내 시간표' }).click();
await page.waitForSelector('.latest-request.status-published');
const latest = await page.locator('.latest-request').textContent();
if (!latest?.includes('게시 완료')) failures.push('교사 화면에 게시 완료 상태가 안 보임');

const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mobile = await mobileCtx.newPage();
mobile.on('pageerror', (error) => failures.push('모바일 페이지 오류: ' + error.message));
await startSample(mobile);
await mobile.screenshot({ path: `${OUT}/shot-6-mobile-home.png`, fullPage: true });
if ((await mobile.getByRole('tab', { name: '오늘' }).getAttribute('aria-selected')) !== 'true') {
  failures.push('모바일 첫 화면이 오늘 시간표가 아님');
}
await mobile.getByRole('button', { name: '변경 요청' }).click();
await mobile.waitForSelector('.tt-grid');
if (!(await selectWorkableLesson(mobile))) failures.push('모바일에서 요청할 수업을 찾지 못함');
await mobile.waitForSelector('.candidate-compare');
await mobile.screenshot({ path: `${OUT}/shot-7-mobile-compare.png`, fullPage: true });
const mobileMetrics = await mobile.evaluate(() => {
  const root = document.documentElement;
  const small = [...document.querySelectorAll('button, input:not([type="checkbox"]), select')]
    .map((element) => element.getBoundingClientRect())
    .filter((box) => box.width > 0 && box.height > 0 && box.height < 44).length;
  return { viewport: root.clientWidth, document: root.scrollWidth, small };
});
if (mobileMetrics.document > mobileMetrics.viewport + 1) failures.push('모바일 문서가 가로로 밀림');
if (mobileMetrics.small > 0) failures.push('모바일에서 높이 44px 미만 조작 요소 ' + mobileMetrics.small + '개');
await mobile.setViewportSize({ width: 320, height: 740 });
await mobile.waitForTimeout(100);
const narrowMetrics = await mobile.evaluate(() => ({
  viewport: document.documentElement.clientWidth,
  document: document.documentElement.scrollWidth,
}));
if (narrowMetrics.document > narrowMetrics.viewport + 1) failures.push('320px 또는 200% 확대 상당 폭에서 가로로 밀림');

const coverCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
const coverPage = await coverCtx.newPage();
await coverPage.goto(BASE, { waitUntil: 'networkidle' });
await coverPage.getByRole('button', { name: '예시로 1분 체험' }).click();
await coverPage.waitForSelector('.pick-list');
const groupTeacher = await coverPage.evaluate(() => {
  const raw = localStorage.getItem('timeswap:v0:data');
  const lesson = raw ? JSON.parse(raw).lessons.find((item) => item.group) : null;
  return lesson?.teacher ?? null;
});
if (!groupTeacher) failures.push('보강 흐름을 검증할 묶음 수업이 없음');
else {
  await coverPage.getByPlaceholder('성함으로 찾기').fill(groupTeacher);
  await coverPage.locator('.pick-list button').first().click();
  await coverPage.waitForSelector('.teacher-overview');
  await coverPage.getByRole('button', { name: '변경 요청' }).click();
  const groupLesson = coverPage.locator('button.cell.lesson[title*="이동수업"]').first();
  if (!(await groupLesson.count())) failures.push('보강 흐름의 묶음 수업 칸이 안 보임');
  else {
    await groupLesson.click();
    await coverPage.waitForSelector('.candidate-compare');
    const coverTab = coverPage.getByRole('tab', { name: /보강/ });
    if (await coverTab.count()) await coverTab.click();
    const coverRequest = coverPage.getByRole('button', { name: '이 분으로 보강 요청' });
    if (!(await coverRequest.count())) failures.push('보강 후보를 요청하는 단일 행동이 없음');
    else {
      await coverRequest.click();
      await coverPage.waitForSelector('.request-status-list .status-pill.pending');
      await coverPage.getByRole('button', { name: /일과 요청함/ }).click();
      await coverPage.getByRole('button', { name: '이 안으로 승인' }).click();
      await coverPage.waitForSelector('.admin-checklist');
      const coverFacts = await coverPage.locator('.ops-cover-facts').textContent();
      if (!coverFacts?.includes('최근 협조')) failures.push('담당자 화면에 보강 부담 정보가 없음');
    }
  }
}

console.log('데스크톱 요청→승인→게시:', latest?.includes('게시 완료') ? '통과' : '실패');
console.log('보강 요청→승인:', failures.some((item) => item.includes('보강')) ? '실패' : '통과');
console.log('모바일 폭:', mobileMetrics.viewport, '문서 폭:', mobileMetrics.document, '작은 조작:', mobileMetrics.small);
console.log('좁은 폭:', narrowMetrics.viewport, '문서 폭:', narrowMetrics.document);
console.log('검증 결과:', failures.length ? failures : '모두 통과');
await mobileCtx.close();
await coverCtx.close();
await ctx.close();
await browser.close();
process.exit(failures.length ? 1 : 0);
