/**
 * 배포 설정이 서로 어긋나지 않았는지 본다.
 *
 * 이 검사를 만든 이유. 웹 앱을 정적으로 내보내면 결과가 apps/web/out 에 쌓이는데,
 * Vercel 은 아무 설정이 없으면 public 을 본다. 그래서 빌드는 성공하는데 배포만 실패했다.
 * 사람이 기억으로 막을 일이 아니라서 관문으로 옮긴다.
 *
 * 무엇을 보는가.
 *  1. 웹 앱이 여전히 정적 내보내기인가.
 *  2. vercel.json 두 벌이 각자 자리에 맞는 출력 경로를 가리키는가.
 *  3. 두 벌의 응답 헤더가 완전히 같은가. 어느 쪽으로 배포해도 보안 헤더가 같아야 한다.
 *  4. 보안 헤더에 빠진 항목이 없는가.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const problems = [];
const ok = (msg) => console.log(`  확인 ${msg}`);

// 1. 정적 내보내기
const nextConfig = read('apps/web/next.config.ts');
if (!/output:\s*'export'/.test(nextConfig)) {
  problems.push(
    "apps/web/next.config.ts 에 output: 'export' 가 없습니다. " +
      '정적 내보내기를 끄려면 vercel.json 의 outputDirectory 도 함께 고쳐야 합니다.',
  );
} else ok("정적 내보내기(output: 'export')");

// 2. 출력 경로. 저장소 뿌리에서 배포하면 apps/web/out, 앱 폴더를 뿌리로 잡으면 out 이다.
const rootVercel = json('vercel.json');
const appVercel = json('apps/web/vercel.json');
const expect = [
  ['vercel.json', rootVercel, 'apps/web/out'],
  ['apps/web/vercel.json', appVercel, 'out'],
];
for (const [name, cfg, want] of expect) {
  if (cfg.outputDirectory !== want) {
    problems.push(`${name} 의 outputDirectory 가 "${cfg.outputDirectory}" 입니다. "${want}" 여야 합니다.`);
  } else ok(`${name} 출력 경로 ${want}`);
}

// 3. 두 벌의 헤더가 같은가
const norm = (h) => JSON.stringify(h);
if (norm(rootVercel.headers) !== norm(appVercel.headers)) {
  problems.push(
    'vercel.json 두 벌의 headers 가 다릅니다. ' +
      '프로젝트 뿌리 설정이 무엇이든 같은 보안 헤더가 나가야 합니다.',
  );
} else ok('두 설정의 응답 헤더 일치');

// 4. 보안 헤더 항목
const all = rootVercel.headers.find((h) => h.source === '/(.*)');
if (!all) {
  problems.push('vercel.json 에 모든 경로에 붙는 헤더 묶음이 없습니다.');
} else {
  const got = new Map(all.headers.map((h) => [h.key, h.value]));
  for (const key of [
    'X-Content-Type-Options',
    'X-Frame-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Content-Security-Policy',
  ]) {
    if (!got.has(key)) problems.push(`보안 헤더 ${key} 가 빠졌습니다.`);
  }
  const csp = got.get('Content-Security-Policy') ?? '';
  // 나이스 공개 자료를 브라우저가 직접 부른다. 이 출처가 빠지면 불러오기가 통째로 막힌다.
  for (const need of [
    "default-src 'self'",
    'connect-src',
    'open.neis.go.kr',
    "frame-ancestors 'none'",
    "object-src 'none'",
  ]) {
    if (!csp.includes(need)) problems.push(`CSP 에 ${need} 가 없습니다.`);
  }
  if (problems.length === 0) ok('보안 헤더 5종과 CSP 허용 출처');
}

if (problems.length > 0) {
  console.error('\n배포 설정이 어긋났습니다.');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('배포 설정 이상 없음');
