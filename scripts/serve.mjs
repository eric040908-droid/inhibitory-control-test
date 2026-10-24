// 개발용 정적 서버. 의존성 없음 — Node만 있으면 된다.
//
//   npm start            → http://localhost:8080
//   npm start -- 3000    → 포트 바꾸기
//
// 왜 필요한가: 이 앱은 ES 모듈과 서비스 워커를 쓴다. 둘 다 `file://`에서
// 동작하지 않으므로(모듈은 CORS로 막히고 서비스 워커는 보안 컨텍스트를
// 요구한다) 파일을 더블클릭해서는 열 수 없다. localhost는 브라우저가
// 보안 컨텍스트로 취급하므로 오프라인 캐시까지 그대로 시험할 수 있다.
//
// 이 파일은 배포 대상이 아니다. 배포는 index.html부터의 정적 파일을
// HTTPS로 올리는 것이고, 그때는 이 서버가 필요하지 않다.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2]) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';

  // 경로 탈출 방어: 정규화한 뒤 루트 안쪽인지 확인한다.
  const path = normalize(join(ROOT, rel));
  if (!path.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      // 서비스 워커 자신은 캐시하지 않는다 — 안 그러면 새 버전이 안 잡힌다.
      'cache-control': rel === '/sw.js' ? 'no-cache' : 'no-store',
    }).end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
}).listen(PORT, () => {
  console.log(`\n  억제적 통제 검사 — http://localhost:${PORT}\n`);
  console.log('  폰에서 열려면 같은 와이파이에서 이 컴퓨터의 IP로 접속하세요.');
  console.log('  (단, 서비스 워커는 localhost나 HTTPS에서만 동작합니다.)\n');
});
