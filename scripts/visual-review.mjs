/**
 * 눈으로 볼 것을 눈으로 보게 만든다.
 *
 * 자동 검사는 잘린 글자, 겹쳐 쓴 카드, 죽은 여백, 잘못 잠긴 단추를 잡지 못한다.
 * 사람이 보려면 매번 같은 화면이 같은 상태로 나와야 하므로, 예시 자료의 시계를
 * 고정하고 여섯 화면을 세 폭으로 늘 같은 순서로 찍는다.
 *
 * 사용법: BASE_URL=http://localhost:3100 SHOT_DIR=... node scripts/visual-review.mjs
 */
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.SHOT_DIR ?? 'tmp-shots/visual-review';
const SCHOOL = 'simple-swap%3Aworkspace';
const CASE = 'simple-swap%3Acase%3Arequest';

const VIEWPORTS = [
  { id: '1440', width: 1440, height: 960 },
  { id: '390', width: 390, height: 844 },
  { id: '320', width: 320, height: 740 },
];

/** 여섯 핵심 화면. 프로토타입이 약속한 여정을 한 장씩 대표한다. */
const SCREENS = [
  { id: '1-landing', path: '/' },
  { id: '2-setup', path: '/?view=setup' },
  { id: '3-teacher', path: `/?view=teacher&school=${SCHOOL}&teacher=teacher%3Aseo-jun` },
  { id: '4-ops', path: `/?view=ops&school=${SCHOOL}&case=${CASE}&step=case` },
  { id: '5-publication', path: `/?view=ops&school=${SCHOOL}&case=${CASE}&step=admin` },
  { id: '6-class', path: `/?view=class&school=${SCHOOL}&grade=2&class=1` },
];

mkdirSync(OUT, { recursive: true });
const exe = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const notes = [];

for (const viewport of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
  });
  const page = await ctx.newPage();
  page.on('pageerror', (error) => notes.push(`${viewport.id} 페이지 오류: ${error.message}`));

  // 예시 학교를 심어 두어야 역할 화면이 빈 껍데기로 찍히지 않는다.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '예시 학교 둘러보기' }).click();
  await page.waitForURL(/\?view=ops&school=/);

  // 행정 마감 화면은 승인까지 진행해야 실제 과업이 보인다.
  await page.goto(`${BASE}/?view=ops&school=${SCHOOL}&case=${CASE}&step=case`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(80);
  await page.getByRole('button', { name: '대안 적용' }).click().catch(() => undefined);
  await page.waitForTimeout(60);
  await page.getByRole('button', { name: '해결안 승인' }).click().catch(() => undefined);
  await page.waitForTimeout(100);

  for (const screen of SCREENS) {
    await page.goto(`${BASE}${screen.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(120);
    await page.screenshot({
      path: `${OUT}/${screen.id}-${viewport.id}.png`,
      fullPage: true,
    });
    const metrics = await page.evaluate(() => {
      const viewportWidth = document.documentElement.clientWidth;
      const clipped = [];
      for (const node of document.querySelectorAll('h1, h2, h3, b, .btn, dd, .status-pill')) {
        if (!(node instanceof HTMLElement)) continue;
        const style = getComputedStyle(node);
        // 화면에서 숨긴 제목은 1px 상자가 정상이다. 잘림으로 세지 않는다.
        const hidden = style.display === 'none' || style.visibility === 'hidden'
          || node.classList.contains('visually-hidden');
        // 글자가 상자보다 크면 잘린다. overflow 가 감추도록 되어 있을 때만 실제로 잘린다.
        if (!hidden && node.scrollWidth > node.clientWidth + 1 && style.overflowX === 'hidden') {
          clipped.push(`${node.tagName.toLowerCase()}.${node.className}`);
        }
      }
      const small = [...document.querySelectorAll('button, a[href], input, select, textarea')]
        .filter((node) => {
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && (box.height < 44 || box.width < 44);
        })
        .map((node) => `${node.tagName.toLowerCase()}.${node.className}`);
      const disabled = [...document.querySelectorAll('button[disabled]')]
        .map((node) => node.textContent?.trim() ?? '');
      return {
        viewport: viewportWidth,
        document: document.documentElement.scrollWidth,
        clipped: [...new Set(clipped)],
        small: [...new Set(small)],
        disabled,
      };
    });
    if (metrics.document > metrics.viewport + 1) {
      notes.push(`${screen.id}@${viewport.id}: 문서가 화면보다 ${metrics.document - metrics.viewport}px 넓음`);
    }
    for (const item of metrics.clipped) notes.push(`${screen.id}@${viewport.id}: 글자 잘림 ${item}`);
    for (const item of metrics.small) notes.push(`${screen.id}@${viewport.id}: 조작 44px 미만 ${item}`);
    for (const item of metrics.disabled) {
      notes.push(`${screen.id}@${viewport.id}: 잠긴 단추 "${item}" (이유가 함께 보이는지 눈으로 확인)`);
    }
  }
  await ctx.close();
}

await browser.close();
console.log(`${SCREENS.length * VIEWPORTS.length}장을 ${OUT} 에 담았습니다.`);
if (notes.length === 0) console.log('자동으로 잡히는 흠은 없습니다. 화면은 눈으로 확인하십시오.');
for (const note of notes) console.log(`  ${note}`);
