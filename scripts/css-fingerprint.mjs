/**
 * 스타일 파일을 나누기 전과 뒤의 실제 렌더링을 비교한다.
 *
 * CSS 는 순서가 의미를 바꾼다. 규칙을 다른 파일로 옮기면 읽기는 좋아지지만 같은
 * 특정도끼리의 승부가 뒤집힐 수 있고, 그 뒤집힘은 눈으로 훑어서는 잡히지 않는다.
 * 그래서 화면마다 모든 요소의 계산된 값을 받아 적고, 나눈 뒤 같은 값이 나오는지 잰다.
 *
 * 사용법:
 *   BASE_URL=... OUT=before.json node scripts/css-fingerprint.mjs
 *   (분할 후) BASE_URL=... OUT=after.json node scripts/css-fingerprint.mjs
 *   node scripts/css-fingerprint.mjs --diff before.json after.json
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3100';
const OUT = process.env.OUT ?? 'css-fingerprint.json';
const SCHOOL = 'simple-swap%3Aworkspace';

const WIDTHS = [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
  { width: 320, height: 740 },
];

const SCREENS = [
  { id: 'landing', path: '/' },
  { id: 'setup', path: '/?view=setup' },
  { id: 'teacher', path: `/?view=teacher&school=${SCHOOL}&teacher=teacher%3Aseo-jun` },
  { id: 'ops', path: `/?view=ops&school=${SCHOOL}` },
  { id: 'ops-case', path: `/?view=ops&school=${SCHOOL}&case=simple-swap%3Acase%3Arequest&step=case` },
  { id: 'ops-admin', path: `/?view=ops&school=${SCHOOL}&case=simple-swap%3Acase%3Arequest&step=admin` },
  { id: 'class', path: `/?view=class&school=${SCHOOL}&grade=2&class=1` },
];

const PROPERTIES = [
  'display', 'position', 'color', 'background-color', 'font-size', 'font-weight',
  'line-height', 'padding', 'margin', 'border-width', 'border-color', 'border-radius',
  'flex-direction', 'grid-template-columns', 'gap', 'text-align', 'overflow',
  'min-height', 'width', 'height', 'opacity', 'visibility',
];

if (process.argv[2] === '--diff') {
  const [, , , leftPath, rightPath] = process.argv;
  const left = JSON.parse(readFileSync(leftPath, 'utf8'));
  const right = JSON.parse(readFileSync(rightPath, 'utf8'));
  const differences = [];
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (JSON.stringify(left[key]) !== JSON.stringify(right[key])) {
      differences.push({ key, before: left[key], after: right[key] });
    }
  }
  console.log(`비교 대상 ${keys.size}개, 달라진 것 ${differences.length}개`);
  for (const item of differences.slice(0, 40)) {
    console.log(`  ${item.key}`);
    console.log(`    이전 ${JSON.stringify(item.before)}`);
    console.log(`    이후 ${JSON.stringify(item.after)}`);
  }
  process.exit(differences.length ? 1 : 0);
}

const exe = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const fingerprint = {};

for (const viewport of WIDTHS) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  // 예시 학교를 먼저 깔아야 역할 화면이 실제 내용으로 그려진다.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '예시 학교 둘러보기' }).click();
  await page.waitForURL(/\?view=ops&school=/);

  for (const screen of SCREENS) {
    await page.goto(`${BASE}${screen.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(120);
    const measured = await page.evaluate((properties) => {
      const rows = {};
      const seen = new Map();
      for (const node of document.querySelectorAll('*')) {
        if (!(node instanceof HTMLElement)) continue;
        const identity = `${node.tagName.toLowerCase()}.${node.className || 'none'}`;
        const index = (seen.get(identity) ?? 0);
        seen.set(identity, index + 1);
        const style = getComputedStyle(node);
        rows[`${identity}#${index}`] = properties.map((name) => style.getPropertyValue(name)).join('|');
      }
      return rows;
    }, PROPERTIES);
    for (const [key, value] of Object.entries(measured)) {
      fingerprint[`${viewport.width}/${screen.id}/${key}`] = value;
    }
  }
  await ctx.close();
}

await browser.close();
writeFileSync(OUT, JSON.stringify(fingerprint, null, 0), 'utf8');
console.log(`${Object.keys(fingerprint).length}개 요소의 계산된 값을 ${OUT} 에 적었습니다.`);
