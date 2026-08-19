/**
 * 화면에서 사라진 선택자를 찾는다.
 *
 * 컴포넌트를 지워도 그 스타일은 남는다. 남은 스타일은 다음 사람이 살아 있는 규칙으로
 * 읽고, 고칠 때 근거로 삼는다. 그래서 지운 화면의 선택자는 함께 지워야 한다.
 * 판정은 보수적으로 한다. 문자열로라도 등장하면 살아 있는 것으로 본다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CSS = process.env.CSS_FILE ?? 'apps/web/app/globals.css';
const ROOTS = (process.env.SRC_ROOTS ?? 'apps/web/components,apps/web/app,apps/web/lib').split(',');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (/\.(tsx|ts|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

const css = readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const classes = new Set([...css.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]));
const source = ROOTS.flatMap((root) => walk(root))
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

const dead = [...classes].filter((name) => !source.includes(name)).sort();
console.log(`전체 클래스 ${classes.size}개, 화면에서 찾을 수 없는 것 ${dead.length}개`);
for (const name of dead) console.log(`  .${name}`);
process.exit(0);
