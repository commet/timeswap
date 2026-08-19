/**
 * 배포와 같은 응답 헤더를 씌워 정적 결과물을 띄운다.
 *
 * 보안 헤더, 특히 CSP 는 설정만 보고는 앱이 도는지 알 수 없다.
 * 그래서 vercel.json 에 적은 헤더를 그대로 읽어 씌우고 그 위에서 전 과정 점검을 돌린다.
 * 설정과 검사가 같은 원본을 보므로 한쪽만 바뀌어 어긋나는 일이 없다.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.env.SERVE_ROOT ?? 'apps/web/out';
const CONFIG = process.env.SERVE_CONFIG ?? 'vercel.json';
const PORT = Number(process.env.PORT ?? 3100);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const config = JSON.parse(await readFile(CONFIG, 'utf8'));

/** vercel.json 의 source 를 아주 단순하게 해석한다. 우리가 쓰는 두 가지 모양만 다룬다. */
function headersFor(pathname) {
  const out = {};
  for (const rule of config.headers ?? []) {
    const src = rule.source ?? '';
    const prefix = src.replace('/(.*)', '');
    const matches = prefix === '' ? true : pathname.startsWith(prefix);
    if (!matches) continue;
    for (const h of rule.headers ?? []) out[h.key] = h.value;
  }
  return out;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  // URL 경로는 항상 / 로 시작한다. Windows 에서 그 값을 그대로 join 하면
  // 정적 출력 루트를 버리고 드라이브의 절대 경로로 해석해 / 가 404가 된다.
  const relative = pathname.replace(/^[/\\]+/, '');
  const safe = normalize(relative).replace(/^(\.\.[/\\])+/, '');
  let file = relative === '' ? join(ROOT, 'index.html') : join(ROOT, safe);
  if (relative !== '' && safe.endsWith('/')) file = join(file, 'index.html');
  if (!existsSync(file)) {
    if (existsSync(`${file}.html`)) file = `${file}.html`;
    else if (existsSync(join(file, 'index.html'))) file = join(file, 'index.html');
    else file = join(ROOT, '404.html');
  }
  const head = headersFor(pathname);
  try {
    const body = await readFile(file);
    res.writeHead(existsSync(file) ? 200 : 404, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      ...head,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...head });
    res.end('없는 문서입니다');
  }
});

server.listen(PORT, () => {
  console.log(`배포와 같은 헤더로 ${ROOT} 를 http://localhost:${PORT} 에 띄웠습니다`);
  console.log('적용 헤더:', Object.keys(headersFor('/')).join(', '));
});
