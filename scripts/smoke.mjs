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
page.on('dialog', (d) => d.accept());

// 1. 랜딩
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.screenshot({ path: `${OUT}/shot-1-landing.png` });
console.log('제목:', await page.title());
console.log('사용 3단계:', await page.locator('.steps li').count(), '| 일러스트:', await page.locator('.hero-art').count());

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

  // 5b-2. 변경 공지 복사와 품앗이 기록
  await page.getByRole('button', { name: '변경 공지 복사' }).click();
  await page.waitForTimeout(300);
  const notice = await page.evaluate(() => navigator.clipboard.readText());
  console.log('--- 변경 공지 ---');
  console.log(notice);
  console.log('-----------------');
  if (!notice.includes('[수업 변경 안내]')) errors.push('변경 공지 문구 실패');
  const helpers = await page.locator('.chg-helpers').textContent();
  console.log('품앗이 기록:', helpers?.trim());
  if (!helpers?.includes('품앗이')) errors.push('품앗이 기록 표시 실패');

  // 5c. 학급 뷰 전환
  await page.getByRole('tab', { name: '학급' }).click();
  await page.waitForTimeout(300);
  const klassCells = await page.locator('.cell.lesson').count();
  console.log('학급 뷰 수업 셀:', klassCells);
  await page.screenshot({ path: `${OUT}/shot-8-klass.png` });
  await page.getByRole('tab', { name: '교사' }).click();
  await page.waitForTimeout(200);

  // 5d. 되돌리기
  await page.getByRole('button', { name: '되돌리기', exact: true }).click();
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

// 6. 교사 검색 전환
const names = await page.locator('#teacher-options option').evaluateAll((os) => os.map((o) => o.value));
console.log('교사 수:', names.length);
const target = names[5] ?? names[0];
const combo = page.locator('#teacher-input');
await combo.click();
await combo.fill(target);
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const gridHead = await page.locator('.grid-wrap h2').textContent();
console.log('전환 후 격자 제목:', gridHead?.trim());
if (!gridHead?.includes(target)) errors.push('교사 검색 전환 실패');
await page.screenshot({ path: `${OUT}/shot-5-teacher-switch.png` });

// 6b. 근무 불가 잠금
await page.locator('button.cell.empty').first().click();
await page.waitForTimeout(250);
const lockedCount = await page.locator('.cell.locked').count();
console.log('잠금 표시 수:', lockedCount);
if (lockedCount !== 1) errors.push('근무 불가 잠금 실패');
await page.screenshot({ path: `${OUT}/shot-10-locked.png` });

// 6c. 테마 전환: 자동 → 밝음 → 어둠 → 자동
const themeBtn = page.getByRole('button', { name: /^테마/ });
await themeBtn.click();
await page.waitForTimeout(150);
const t1 = await page.evaluate(() => document.documentElement.dataset.theme);
await themeBtn.click();
await page.waitForTimeout(150);
const t2 = await page.evaluate(() => document.documentElement.dataset.theme);
await page.screenshot({ path: `${OUT}/shot-11-dark.png` });
await themeBtn.click();
await page.waitForTimeout(150);
const t3 = await page.evaluate(() => document.documentElement.dataset.theme);
console.log('테마 순환:', t1, '→', t2, '→', t3 ?? '자동');
if (t1 !== 'light' || t2 !== 'dark' || t3 !== undefined) errors.push('테마 전환 실패');

// 7. 새로고침 후 복원 확인 (교사, 잠금 유지)
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
const restored = (await page.locator('.tt-grid').count()) > 0;
const lockedAfter = await page.locator('.cell.locked').count();
console.log('새로고침 후 복원:', restored ? '성공' : '실패', '| 잠금 유지:', lockedAfter);
if (lockedAfter !== 1) errors.push('잠금 복원 실패');
await page.locator('.cell.locked').first().click();
await page.waitForTimeout(200);

// 8. 모바일 작업 화면: 결강 선택 시 추천 패널로 이동
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
await page.locator('button.cell.lesson').nth(2).click();
await page.waitForTimeout(1000);
const sideBox = await page.locator('.side').boundingBox();
console.log('모바일 패널 위치 y:', sideBox ? Math.round(sideBox.y) : '없음');
if (!sideBox || sideBox.y > 500) errors.push('모바일 패널 자동 이동 실패');
await page.screenshot({ path: `${OUT}/shot-9-mobile-work.png` });
await page.setViewportSize({ width: 1360, height: 860 });
await page.waitForTimeout(300);

// 9. 모바일 랜딩
const mob = await ctx.newPage();
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(BASE, { waitUntil: 'networkidle' });
await mob.waitForTimeout(400);
await mob.screenshot({ path: `${OUT}/shot-6-mobile.png` });

console.log('리소스 경고:', warnings.length); console.log('페이지 오류:', errors.length === 0 ? '없음' : errors);
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
