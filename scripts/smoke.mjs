import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.SHOT_DIR ?? '.';
const errors = [];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await browser.newContext({
  viewport: { width: 1360, height: 860 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
const warnings = [];
page.on('console', (m) => {
  // 리소스 로드 실패(폰트 CDN 차단 등)는 환경 요인이라 경고로만 남긴다.
  if (m.type() === 'error') warnings.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

// 1. 랜딩
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/shot-1-landing.png` });
console.log('제목:', await page.title());

// 2. 샘플 로드
await page.getByRole('button', { name: '샘플 학교로 체험' }).click();
await page.waitForSelector('.tt-grid', { timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/shot-2-grid.png` });
const school = await page.locator('.school-chip').textContent();
console.log('학교 칩:', school?.trim());

// 3. 결강 지정: 수업이 있는 셀 중 세 번째를 클릭
const cells = page.locator('button.cell.lesson');
console.log('수업 셀 수:', await cells.count());
await cells.nth(2).click();
await page.waitForTimeout(400);
const candCount = await page.locator('.cand').count();
console.log('추천 후보 수:', candCount);
await page.screenshot({ path: `${OUT}/shot-3-candidates.png` });

// 4. 첫 후보에 호버해서 diff 미리보기
if (candCount > 0) {
  await page.locator('.cand').first().hover();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/shot-4-preview.png` });
  const arriving = await page.locator('.cell.arriving').count();
  const incoming = await page.locator('.cell.incoming').count();
  console.log('미리보기 표시: 옮겨 갈 자리', arriving, '| 들어올 수업', incoming);

  // 5. 요청 문구 복사
  await page.locator('.cand').first().getByRole('button', { name: '요청 문구 복사' }).click();
  await page.waitForSelector('.toast', { timeout: 5000 });
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  console.log('--- 복사된 문구 ---');
  console.log(clip);
  console.log('-------------------');

  // 5b. 시간표에 반영: 첫 후보 적용 → 장부 1건 → 결강 표시 해제
  await page.locator('.cand').first().getByRole('button', { name: '이 방법으로 바꾸기' }).click();
  await page.waitForTimeout(400);
  const applied = await page.locator('.chg-list li').count();
  const absentLeft = await page.locator('.cell.absent').count();
  console.log('반영 후 장부 건수:', applied, '| 남은 결강 표시:', absentLeft);
  await page.screenshot({ path: `${OUT}/shot-7-applied.png` });
  if (applied !== 1 || absentLeft !== 0) errors.push('반영 흐름 실패');
  const printBtn = await page.getByRole('button', { name: '수업 교체 계획서 인쇄' }).count();
  console.log('계획서 인쇄 버튼:', printBtn);

  // 5c. 학급 뷰 전환
  await page.getByRole('tab', { name: '학급' }).click();
  await page.waitForTimeout(300);
  const klassCells = await page.locator('.cell.lesson').count();
  console.log('학급 뷰 수업 셀:', klassCells);
  await page.screenshot({ path: `${OUT}/shot-8-klass.png` });
  await page.getByRole('tab', { name: '교사' }).click();
  await page.waitForTimeout(200);

  // 5d. 되돌리기
  await page.getByRole('button', { name: '되돌리기' }).click();
  await page.waitForTimeout(300);
  const afterUndo = await page.locator('.chg-list li').count();
  console.log('되돌리기 후 장부 건수:', afterUndo);

  // 5e. 결강 대기열: 수업 두 개를 걸면 대기 1건 표시
  await page.locator('button.cell.lesson').nth(1).click();
  await page.locator('button.cell.lesson').nth(3).click();
  await page.waitForTimeout(300);
  const queuedBadge = await page.locator('.badge-absent.queued').count();
  const subText = await page.locator('.panel .card-head .sub').textContent();
  console.log('대기열 배지:', queuedBadge, '| 패널 부제:', subText?.trim());
  if (queuedBadge !== 1 || !subText?.includes('대기')) errors.push('대기열 표시 실패');
  await page.getByRole('button', { name: '뒤로 미루기' }).click();
  await page.waitForTimeout(200);
  await page.locator('button.cell.lesson.absent').first().click();
  await page.locator('button.cell.lesson.absent').first().click();
  await page.waitForTimeout(200);

  // 5f. 요일 전체 결강
  await page.locator('button.tt-head.day-btn').first().click();
  await page.waitForTimeout(300);
  const dayQueued = await page.locator('.cell.absent').count();
  console.log('요일 전체 결강 수:', dayQueued);
  await page.locator('button.tt-head.day-btn').first().click();
  await page.waitForTimeout(200);
}

// 6b. 모바일 작업 화면
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/shot-9-mobile-work.png` });
await page.setViewportSize({ width: 1360, height: 860 });

// 6. 교사 전환
const select = page.locator('#teacher-select');
const options = await select.locator('option').allTextContents();
console.log('교사 수:', options.length);
await select.selectOption({ index: 5 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/shot-5-teacher-switch.png` });

// 7. 새로고침 후 복원 확인
await page.reload({ waitUntil: 'networkidle' });
const restored = (await page.locator('.tt-grid').count()) > 0;
console.log('새로고침 후 복원:', restored ? '성공' : '실패');

// 8. 모바일 뷰
const mob = await ctx.newPage();
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(BASE, { waitUntil: 'networkidle' });
await mob.waitForTimeout(400);
await mob.screenshot({ path: `${OUT}/shot-6-mobile.png` });

console.log('리소스 경고:', warnings.length); console.log('페이지 오류:', errors.length === 0 ? '없음' : errors);
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
