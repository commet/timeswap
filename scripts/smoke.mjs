import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.SHOT_DIR ?? '.';
const errors = [];

// 이 저장소를 여는 곳마다 브라우저 위치가 다르다.
// 지정한 경로가 있으면 쓰고, 없으면 playwright 가 받아 둔 것을 쓴다.
const exe = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
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

// 1b. 나이스 불러오기: 브라우저에서 공식 개방 API 가 실제로 붙는지 확인
await page.getByRole('button', { name: '학교 이름으로 찾기' }).click();
await page.waitForSelector('.neis', { timeout: 10000 });
await page.getByPlaceholder('예: 수지고등학교').fill('수지고등학교');
await page.getByRole('button', { name: '찾기' }).click();
await page.waitForSelector('.neis-hits li, .neis-error', { timeout: 30000 });
const hitCount = await page.locator('.neis-hits li').count();
const neisMsg = (await page.locator('.neis-error').textContent().catch(() => '')) ?? '';
// 이 컨테이너는 브라우저의 바깥 통신이 막혀 있어 검색이 실패할 수 있다.
// 화면이 오류를 제대로 알려 주는지까지가 여기서 볼 수 있는 범위다.
if (hitCount > 0) console.log('나이스 학교 검색 결과:', hitCount, '건');
else if (neisMsg) console.log('나이스 검색 불가(환경 제약), 안내 문구 출력됨:', neisMsg.slice(0, 40));
else errors.push('나이스 검색이 실패했는데 안내도 없음');
await page.screenshot({ path: `${OUT}/shot-12-neis.png` });
await page.getByRole('button', { name: '닫기' }).click();
await page.waitForTimeout(300);

// 2. 샘플 로드 후 본인 성함 고르기
await page.getByRole('button', { name: '예시로 살펴보기' }).click();
await page.waitForSelector('.pick-list', { timeout: 15000 });
const pickCount = await page.locator('.pick-list li').count();
console.log('성함 고르기 후보:', pickCount);
if (pickCount === 0) errors.push('성함 고르기 목록이 비어 있음');
await page.screenshot({ path: `${OUT}/shot-13-pick.png` });
// 검색으로 좁혀지는지도 함께 본다
await page.getByPlaceholder('성함으로 찾기').fill('사회');
await page.waitForTimeout(200);
const narrowed = await page.locator('.pick-list li').count();
console.log('검색 후 후보:', narrowed);
if (narrowed === 0 || narrowed >= pickCount) errors.push('성함 검색이 좁혀지지 않음');
const myName = (await page.locator('.pick-list .pick-name').first().textContent())?.trim() ?? '';
await page.locator('.pick-list button').first().click();
await page.waitForSelector('.tt-grid', { timeout: 15000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/shot-2-grid.png` });
const school = await page.locator('.school-chip').textContent();
console.log('학교 칩:', school?.trim(), '| 고른 교사:', myName);
const openedFor = await page.locator('.grid-wrap h2').textContent();
if (!openedFor?.includes(myName)) errors.push('고른 교사의 시간표가 열리지 않음');

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
  await page.locator('.cand').first().getByRole('button', { name: '이 방법으로 반영' }).click();
  await page.waitForTimeout(400);
  const applied = await page.locator('.chg-list li').count();
  const absentLeft = await page.locator('.cell.absent').count();
  console.log('반영 후 장부 건수:', applied, '| 남은 결강 표시:', absentLeft);
  await page.screenshot({ path: `${OUT}/shot-7-applied.png` });
  if (applied !== 1 || absentLeft !== 0) errors.push('반영 흐름 실패');
  const printBtn = await page.getByRole('button', { name: '교체 계획서 인쇄' }).count();
  console.log('계획서 인쇄 버튼:', printBtn);

  // 5b-1. 결재 문서에 들어갈 사유. 인쇄 서식이 값을 그대로 받는지까지 본다.
  const reasonBox = page.locator('.chg-reason .input');
  await reasonBox.fill('학년 협의회 출장');
  await page.waitForTimeout(200);
  const sheetReason = await page.locator('.sheet-head td').nth(3).textContent();
  const sheetTeacher = await page.locator('.sheet-head td').nth(2).textContent();
  const signNames = await page.locator('.sheet-sign-name').count();
  console.log('계획서 신청 교사:', sheetTeacher?.trim(), '| 사유:', sheetReason?.trim(), '| 협조 확인란:', signNames);
  if (sheetReason?.trim() !== '학년 협의회 출장') errors.push('계획서 사유 반영 실패');
  if (signNames < 1) errors.push('협조 교사 확인란 없음');

  // 5b-2. 변경 공지 복사와 협조 기록
  await page.getByRole('button', { name: '변경 공지 복사' }).click();
  await page.waitForTimeout(300);
  const notice = await page.evaluate(() => navigator.clipboard.readText());
  console.log('--- 변경 공지 ---');
  console.log(notice);
  console.log('-----------------');
  if (!notice.includes('[수업 변경 안내]')) errors.push('변경 공지 문구 실패');
  const helpers = await page.locator('.chg-helpers').textContent();
  console.log('협조 기록:', helpers?.trim());
  if (!helpers?.includes('협조해 주신 분')) errors.push('협조 기록 표시 실패');

  // 5b-3. 나이스 입력 목록
  await page.getByRole('button', { name: '나이스 입력 목록' }).click();
  await page.waitForTimeout(300);
  const neisList = await page.evaluate(() => navigator.clipboard.readText());
  console.log('--- 나이스 입력 목록 ---');
  console.log(neisList.split('\n').slice(0, 6).join('\n'));
  console.log('--------------------------');
  if (!neisList.includes('나이스 입력용')) errors.push('나이스 목록 출력 실패');

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
  await page.getByRole('button', { name: '나중에' }).click();
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

// 8b. 파일로 저장: CSP 아래에서도 내려받기가 되는지
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
  page.getByRole('button', { name: '파일로 저장' }).click(),
]);
// 저장 이름이 "download" 로 나오는 판이 있다. 이건 앱 문제가 아니라 판 문제다.
// 컨테이너 로케일이 POSIX 면 크로미움이 한글 파일 이름을 만들지 못하고 통째로 버린다.
// 사용자 컴퓨터는 UTF-8 이라 그대로 저장된다. 여기서는 내려받기가 됐는지까지만 본다.
const dlName = download ? download.suggestedFilename() : '';
console.log('파일로 저장:', dlName || '실패', dlName === 'download' ? '(로케일 제약)' : '');
if (!download) errors.push('시간표 파일 저장 실패');

// 9. 모바일 랜딩
const mob = await ctx.newPage();
await mob.setViewportSize({ width: 390, height: 844 });
await mob.goto(BASE, { waitUntil: 'networkidle' });
await mob.waitForTimeout(400);
await mob.screenshot({ path: `${OUT}/shot-6-mobile.png` });

// 보안 헤더를 씌우고 돌리면 막힌 자원이 여기에 남는다. CSP 를 손보기 전에 이걸 본다.
console.log('리소스 경고:', warnings.length);
for (const w of [...new Set(warnings)].slice(0, 8)) console.log('  ·', w.slice(0, 150));
const blocked = warnings.filter((w) => /Content Security Policy|CSP/i.test(w));
if (blocked.length > 0) errors.push(`CSP 가 자원 ${blocked.length}건을 막았습니다`);
console.log('페이지 오류:', errors.length === 0 ? '없음' : errors);
await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
