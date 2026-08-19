/**
 * globals.css 를 책임별 다섯 파일로 나눈다.
 *
 * 규칙마다 붙은 주석은 그 규칙의 근거다. 함께 옮기지 않으면 근거가 남의 규칙에 붙는다.
 * 그래서 주석은 뒤따르는 규칙에 매달아 통째로 옮긴다.
 * 나눈 뒤 실제 렌더링이 같은지는 scripts/css-fingerprint.mjs 가 잰다.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SOURCE = 'apps/web/app/globals.css';
const STYLES = 'apps/web/styles';

const text = readFileSync(SOURCE, 'utf8');

/**
 * 최상위 덩어리로 자른다. 규칙 하나와 그 앞에 붙은 주석이 한 덩어리다.
 * 주석을 떼어 놓으면 근거가 남의 규칙 위에 얹히므로 함께 옮긴다.
 */
function chunks(input) {
  const out = [];
  let index = 0;
  while (index < input.length) {
    const brace = input.indexOf('{', index);
    if (brace === -1) break;
    let depth = 1;
    let cursor = brace + 1;
    while (cursor < input.length && depth > 0) {
      if (input[cursor] === '{') depth += 1;
      if (input[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    const head = input.slice(index, brace);
    const selector = head.split('\n').at(-1).trim() || head.trim();
    out.push({ selector, text: input.slice(index, cursor).trim() });
    index = cursor;
  }
  return out;
}

const RESET = /^(html|body|button|select|input|:focus-visible|::selection|\*)/;
const TIMETABLE = /(^|[.\s>])(tt-|cell|grid-scroll|grid-wrap|grid-legend|card|offday|teacher-grid|teacher-projection|teacher-today|teacher-focus|period-rail|now-next|schedule-|public-class|day-closed|lock-mark|badge-absent|head-skip)/;
// `.btn`, `.select`, `.input` 은 어느 화면의 것도 아닌 기본 조작이라 껍데기에 남긴다.
// 업무 흐름으로 옮기면 껍데기보다 늦게 읽혀 크기 규칙이 뒤집힌다.
const WORKFLOW = /(^|[.\s>])(ops-|resolution-|publication|change-pulse|absence-|composer|coordination|atomic|source-unavailable|request-|status-|section-heading|case-|admin-|demo-|neis|setup-|mapping-|health-|review-|invitation-|load-official|data-health|unresolved|panel|cand|peers|chg-|cover|pick|chip|seg|side|work|sheet|map-row|hit-|toast|warn-bar|crash|foot|method-|context-note|empty-cursor|small-empty|select\.combo|theme-btn)/;
const KEYFRAME_BUCKET = { rise: 'workflow', 'resolution-slot': 'workflow', 'pulse-arrive': 'workflow' };

function classify(selector) {
  if (/^@media\s*\(\s*prefers-color-scheme/.test(selector)) return 'tokens';
  if (/^@media/.test(selector)) return 'responsive';
  if (/^@keyframes/.test(selector)) {
    return KEYFRAME_BUCKET[selector.replace('@keyframes', '').trim()] ?? 'workflow';
  }
  if (/^:root/.test(selector)) return 'tokens';
  if (RESET.test(selector) && !/[.#]/.test(selector)) return 'reset';
  if (TIMETABLE.test(selector)) return 'timetable';
  if (WORKFLOW.test(selector)) return 'workflow';
  return 'shell';
}

const buckets = { tokens: [], reset: [], shell: [], timetable: [], workflow: [], responsive: [] };
for (const chunk of chunks(text)) buckets[classify(chunk.selector)].push(chunk.text);

const HEADERS = {
  tokens: '/* 디자인 토큰. 밝음과 어둠의 값만 둔다. 여기서 정한 이름 밖의 색을 쓰지 않는다. */',
  shell: '/* 앱 껍데기. 진입, 머리말, 역할 이동, 학교 설정처럼 화면을 감싸는 것들이다. */',
  timetable: '/* 시간표. 격자, 수업 칸, 교시 레일, 학급 공개 시간표가 여기 있다. */',
  workflow: '/* 업무 흐름. 요청, 해결안 비교, 관제판, 행정 마감과 게시가 여기 있다. */',
  responsive: '/* 화면 폭과 사용자 설정에 따른 규칙. 1440, 820, 759, 700, 640, 620, 560, 320 을 본다.\n   기본 규칙 뒤에 모아 두어 무엇이 무엇을 덮는지 한자리에서 읽힌다. */',
};

mkdirSync(STYLES, { recursive: true });
for (const name of ['tokens', 'shell', 'timetable', 'workflow', 'responsive']) {
  const body = buckets[name].join('\n').replace(/\n{3,}/g, '\n\n').trim();
  writeFileSync(`${STYLES}/${name}.css`, `${HEADERS[name]}\n\n${body}\n`, 'utf8');
  console.log(`${name}.css ${body.split('\n').length}줄`);
}

const globals = [
  '/* 조율 화면 스타일의 입구.',
  ' *',
  ' * 규칙은 책임별로 나눠 두고 여기서는 읽는 순서만 정한다.',
  ' * 토큰이 먼저 오고, 껍데기와 시간표와 업무 흐름이 이어지고, 화면 폭 규칙이 마지막이다.',
  ' * 마지막에 두어야 좁은 화면 규칙이 무엇을 덮는지 한 방향으로만 읽힌다.',
  ' */',
  "@import '../styles/tokens.css';",
  "@import '../styles/shell.css';",
  "@import '../styles/timetable.css';",
  "@import '../styles/workflow.css';",
  "@import '../styles/responsive.css';",
  '',
  '/* 되돌리기. 요소 기본값만 손대며 클래스 규칙과 다투지 않는다. */',
  buckets.reset.join('\n').replace(/\n{3,}/g, '\n\n').trim(),
  '',
].join('\n');
writeFileSync(SOURCE, globals, 'utf8');
console.log(`globals.css ${globals.split('\n').length}줄`);
