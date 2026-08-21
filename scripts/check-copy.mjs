#!/usr/bin/env node
/**
 * 화면 문구가 저장소의 한국어 규칙을 지키는지 본다.
 *
 * 규칙은 CLAUDE.md 에 적혀 있고, 거기에 "규칙을 사람이 매번 눈으로 지키지 않는다.
 * 검사를 걸어 둔다"고도 적혀 있다. 그런데 이 저장소에는 검사가 없었다. 규칙만 옮겨
 * 오고 검사는 안 옮겨 온 것이다. 그 사이에 해요체 열 자리와 낱말 나열 중간점 일곱
 * 자리가 화면에 들어왔다.
 *
 * 주석은 안 본다. 설계 근거를 적는 자리이고 사용자에게 안 보인다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOTS = ['apps/web/components', 'apps/web/lib', 'apps/web/app'];

/**
 * 바꾸지 않는 것. 저장 값이거나 학교가 실제로 쓰는 이름이다.
 *
 * `연수·출장` 은 사건에 저장되는 값이라 바꾸면 읽는 쪽까지 함께 고쳐야 한다.
 * 나머지는 나이스가 주는 과목명 그대로다.
 */
const KEPT = ['연수·출장', '자율·자치활동', '휠·타이어·얼라인먼트'];

const HAEYO = /(?:주세요|하세요|보세요|고르세요|누르세요|드릴게요|할게요|할까요|일까요|되나요|인가요|어요[.!?"'`\s<)]|해요[.!?"'`\s<)])/;
/*
 * 낱말을 중간점으로 잇는 자리.
 *
 * 앞서는 /[가-힣][·][가-힣]/ 였다. 중간점 양옆에 한글이 바로 붙어 있어야만 잡는 규칙이라
 * "필수 · 대기" 처럼 띄어 쓴 것은 다 지나갔다. 검사를 걸어 두고도 화면에는 서른 자리가
 * 남아 있었다. 띄어쓰기와 숫자, 영문까지 함께 본다.
 */
const MIDDOT = /[가-힣A-Za-z0-9)\]}]\s*·\s*[가-힣A-Za-z0-9($[{]/;

/*
 * 이어 붙여 만드는 중간점.
 *
 * `' · 결재 중'` 처럼 따옴표 바로 뒤에서 시작하는 조각이 있다. 앞말은 다른 식에 있어서
 * 한 줄만 보면 낱말 사이인지 알 수 없지만, 화면에서는 결국 두 낱말을 잇는다. 조각의
 * 처음이나 끝에 홀로 선 중간점은 잇는 자리로 본다.
 */
const MIDDOT_JOIN = /(?:['"`]\s*·\s)|(?:\s·\s*['"`])/;
const EMDASH = /—|&mdash;/;

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** 주석 줄을 지운다. 블록 주석 안인지도 따라간다. */
function copyLines(text) {
  const out = [];
  let inBlock = false;
  for (const [index, raw] of text.split('\n').entries()) {
    let line = raw;
    if (inBlock) {
      const close = line.indexOf('*/');
      if (close < 0) continue;
      line = line.slice(close + 2);
      inBlock = false;
    }
    const open = line.indexOf('/*');
    if (open >= 0) {
      const close = line.indexOf('*/', open + 2);
      if (close < 0) { line = line.slice(0, open); inBlock = true; }
      else line = line.slice(0, open) + line.slice(close + 2);
    }
    const slash = line.indexOf('//');
    if (slash >= 0) line = line.slice(0, slash);
    /*
     * 한글이 든 줄만 보면 놓치는 자리가 있다.
     *
     * `{slotName(slot, cfg)} · {candidate.title}` 은 이 줄에 한글이 한 자도 없다.
     * 값이 다른 곳에서 오기 때문이다. 그래도 화면에서는 두 한글 낱말을 중간점으로 잇는다.
     * 중간점과 em 대시는 그 자체가 화면에 찍히는 글자라, 한글이 없어도 본다.
     */
    if (/[가-힣]/.test(line) || /[·—]/.test(line)) out.push([index + 1, line, raw.trim()]);
  }
  return out;
}

const problems = [];
for (const root of ROOTS) {
  for (const path of files(root)) {
    for (const [line, code, raw] of copyLines(readFileSync(path, 'utf8'))) {
      let text = code;
      for (const kept of KEPT) text = text.split(kept).join('');
      const where = `${relative(process.cwd(), path)}:${line}`;
      if (EMDASH.test(text)) problems.push([where, 'em 대시', raw]);
      if (MIDDOT.test(text) || MIDDOT_JOIN.test(text)) problems.push([where, '낱말 나열 중간점', raw]);
      if (HAEYO.test(text)) problems.push([where, '해요체', raw]);
    }
  }
}

if (problems.length > 0) {
  console.error(`화면 문구 규칙 위반 ${problems.length}건`);
  for (const [where, kind, raw] of problems) {
    console.error(`  ${kind}  ${where}\n    ${raw.slice(0, 110)}`);
  }
  console.error('\n규칙은 CLAUDE.md 를 보십시오.');
  process.exit(1);
}
console.log(`  확인 화면 문구 규칙 (em 대시, 낱말 나열 중간점, 해요체)`);
