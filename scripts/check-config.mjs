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
 *  5. 추적되는 파일에 인증키, 인증키 저장 흔적, 경쟁 서비스 출처가 들어갔는가.
 *
 * 5번을 여기 둔 이유. 인증키는 화면에서 세션 메모리에만 두기로 했는데, 그 약속은
 * 코드를 고치는 순간 조용히 깨진다. 사람이 매번 눈으로 볼 수 없으므로 배포 전
 * 가장 빠른 관문에서 막는다.
 */
import { execFileSync } from 'node:child_process';
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

// 5. 자료 경계. git 이 추적하는 파일만 본다. 로컬 실험 파일까지 막을 이유는 없다.
const SOURCE_ONLY = /\.(ts|tsx|mjs|js)$/;
const BOUNDARY_RULES = [
  {
    id: '나이스 인증키 값',
    // KEY= 뒤에 실제 값이 붙은 자리. 템플릿 문자열 보간은 값이 아니다.
    // 문서에 적힌 진짜 키도 유출이므로 여기서는 파일 종류를 가리지 않는다.
    pattern: /KEY=(?!\$\{)[A-Za-z0-9]{8,}/,
  },
  {
    id: '인증키를 브라우저 저장소에 두던 흔적',
    pattern: /NEIS_KEY_STORE|loadNeisKey|saveNeisKey/,
    // 문서는 이 이름들을 "지울 것"으로 적는다. 그 문장까지 막으면 규칙을 설명할 수 없다.
    only: SOURCE_ONLY,
  },
  {
    id: '경쟁 서비스 출처',
    pattern: /comcigan|indischool/i,
    only: SOURCE_ONLY,
  },
];
const SELF = 'scripts/check-config.mjs';
let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((name) => name && name !== SELF)
    .filter((name) => /\.(ts|tsx|mjs|js|json|md|css|ya?ml)$/.test(name));
} catch {
  problems.push('git 추적 목록을 읽지 못해 자료 경계를 검사하지 못했습니다.');
}
let boundaryHits = 0;
for (const name of tracked) {
  let body = '';
  try {
    body = readFileSync(join(root, name), 'utf8');
  } catch {
    continue;
  }
  for (const rule of BOUNDARY_RULES) {
    if (rule.only && !rule.only.test(name)) continue;
    if (rule.pattern.test(body)) {
      boundaryHits += 1;
      problems.push(`${name} 에 ${rule.id} 이(가) 있습니다.`);
    }
  }
}

// 공개 학급 화면은 내부 사건 필드를 아예 받지 않아야 한다. 지금은 학급 식별자와
// 활성 시간표만 읽는다. 이 경계가 무너지면 화면 검사보다 여기서 먼저 걸린다.
const PUBLIC_SCREEN = 'apps/web/components/PublicClassTimetable.tsx';
if (tracked.includes(PUBLIC_SCREEN)) {
  const body = readFileSync(join(root, PUBLIC_SCREEN), 'utf8');
  for (const field of ['rejectionNote', 'requesterTeacherId', 'adminTasks', 'state.audit', 'reason']) {
    if (body.includes(field)) {
      boundaryHits += 1;
      problems.push(`${PUBLIC_SCREEN} 이 내부 사건 필드 ${field} 을(를) 읽습니다.`);
    }
  }
}
if (boundaryHits === 0) ok(`추적 파일 ${tracked.length}개의 자료 경계`);

if (problems.length > 0) {
  console.error('\n배포 설정이 어긋났습니다.');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('배포 설정 이상 없음');
