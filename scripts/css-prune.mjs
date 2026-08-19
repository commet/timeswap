/**
 * 화면에서 사라진 선택자만 골라 지운다.
 *
 * 판정은 보수적이다. 쉼표로 묶인 선택자 목록에서 클래스가 하나라도 살아 있으면 그
 * 선택자는 남긴다. 모든 클래스가 죽은 선택자만 빼고, 그래서 남는 선택자가 없어진
 * 규칙만 통째로 지운다. 요소 선택자와 아이디 선택자는 건드리지 않는다.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS = process.env.CSS_FILE ?? 'apps/web/app/globals.css';
const ROOTS = (process.env.SRC_ROOTS ?? 'apps/web/components,apps/web/app,apps/web/lib').split(',');
const APPLY = process.env.APPLY === '1';

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(tsx|ts|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

const original = readFileSync(CSS, 'utf8');
const source = ROOTS.flatMap((root) => walk(root))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');
const isDead = (name) => !source.includes(name);

/** 최상위와 @media 안쪽을 같은 방식으로 훑는다. */
function pruneBlock(text) {
  const out = [];
  let index = 0;
  let pending = '';
  while (index < text.length) {
    const brace = text.indexOf('{', index);
    if (brace === -1) { out.push(pending + text.slice(index)); break; }
    const head = text.slice(index, brace);
    let depth = 1;
    let cursor = brace + 1;
    while (cursor < text.length && depth > 0) {
      if (text[cursor] === '{') depth += 1;
      if (text[cursor] === '}') depth -= 1;
      cursor += 1;
    }
    const body = text.slice(brace + 1, cursor - 1);
    const selector = head.trim();
    const lead = head.slice(0, head.length - head.trimStart().length);

    if (selector.startsWith('@media') || selector.startsWith('@supports')) {
      const inner = pruneBlock(body);
      if (inner.trim()) out.push(`${pending}${lead}${selector} {${inner}}`);
      pending = '';
    } else if (selector.startsWith('@')) {
      out.push(`${pending}${lead}${selector} {${body}}`);
      pending = '';
    } else {
      const kept = selector.split(',')
        .map((part) => part.trim())
        .filter((part) => {
          const classes = [...part.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]);
          return classes.length === 0 || !classes.every(isDead);
        });
      if (kept.length === 0) {
        // 규칙과 함께 그 규칙에만 붙은 주석도 사라져야 한다.
        pending = '';
      } else {
        out.push(`${pending}${lead}${kept.join(', ')} {${body}}`);
        pending = '';
      }
    }
    index = cursor;
    const nextBrace = text.indexOf('{', index);
    const between = nextBrace === -1 ? text.slice(index) : text.slice(index, nextBrace);
    const commentAt = between.lastIndexOf('/*');
    if (commentAt !== -1 && nextBrace !== -1) {
      out.push(between.slice(0, commentAt));
      pending = between.slice(commentAt);
      index += between.length;
    }
  }
  return out.join('');
}

const pruned = pruneBlock(original).replace(/\n{3,}/g, '\n\n');
const removedLines = original.split('\n').length - pruned.split('\n').length;
console.log(`${CSS}: ${original.length} → ${pruned.length}바이트, ${removedLines}줄 줄어듦`);
if (APPLY) {
  writeFileSync(CSS, pruned, 'utf8');
  console.log('적용했습니다.');
} else {
  console.log('APPLY=1 을 주면 파일에 적용합니다.');
}
