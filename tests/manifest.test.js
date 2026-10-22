// 오프라인 동작과 설치 — sw.js, manifest.webmanifest, index.html을 *파일로 읽어서* 검사한다.
// 기본 환경(node)이다. 서비스 워커는 가짜 전역(self, caches, fetch)을 준 vm 안에서 실제로 실행해 본다:
// 설치 때 무엇을 캐시에 넣는지, 활성화 때 무엇을 지우는지, fetch가 캐시를 먼저 보는지.
//
// 이 파일의 핵심 보호막은 listShippedFiles()다. 누가 js/ 아래에 파일을 더하면 캐시 목록에서 빠진 것을 여기서 잡는다.
// 캐시 목록에서 빠진 파일은 *오프라인에서 조용히 깨진다* — 온라인에서는 네트워크가 채워 주기 때문에 눈에 안 띈다.
import { readFileSync, readdirSync, statSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { TOOL_VERSION } from '../js/config.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = rel => readFileSync(join(ROOT, rel), 'utf8');

// 저장소에서 index.html, manifest.webmanifest, css/**/*.css, js/**/*.js 를 재귀로 모아
// 저장소 상대 경로(항상 '/' 구분자)로 돌려준다. tests/, docs/, node_modules/, sw.js 자신은 모으지 않는다.
function listShippedFiles(root = ROOT) {
  const out = [];
  for (const top of ['index.html', 'manifest.webmanifest']) {
    if (existsSync(join(root, top))) out.push(top);
  }
  const walk = (dir, ext) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, ext);
      else if (name.endsWith(ext)) out.push(relative(root, full).split(sep).join('/'));
    }
  };
  walk(join(root, 'css'), '.css');
  walk(join(root, 'js'), '.js');
  return out.sort();
}

// icons/ 아래 파일은 listShippedFiles()의 정의에 없다(브리프의 정의). 매니페스트가 가리키는 파일이므로 따로 모은다.
function listIconFiles(root = ROOT) {
  const dir = join(root, 'icons');
  return existsSync(dir) ? readdirSync(dir).map(n => `icons/${n}`).sort() : [];
}

// ---- 브리프의 테스트 4개 (그대로) -------------------------------------------------------------

test('매니페스트가 세로 모드 설치형 앱으로 선언된다', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  expect(m.display).toBe('standalone');
  expect(m.orientation).toBe('portrait');
  expect(m.start_url).toBeTruthy();
  expect(m.icons.length).toBeGreaterThan(0);
});

test('서비스 워커가 캐시해야 할 파일을 모두 나열한다', () => {
  const sw = read('sw.js');
  for (const f of listShippedFiles()) expect(sw).toContain(f);
});

test('캐시 이름에 도구 버전이 들어가 배포 때 갈린다', () => {
  expect(read('sw.js')).toContain(TOOL_VERSION);
});

test('배포 산출물이 외부 스크립트나 스타일을 불러오지 않는다', () => {
  const html = read('index.html');
  expect(html).not.toMatch(/src="https?:/);
  expect(html).not.toMatch(/href="https?:.*\.css/);
});

// ---- listShippedFiles() 자체의 경계 -----------------------------------------------------------
// 보호막이 헛것이 되지 않게: 하위 디렉터리를 놓치지 않고, 제외 대상을 모으지 않는다.

describe('listShippedFiles()', () => {
  let fixture;
  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), 'icp-ship-'));
    const put = (rel, body = 'x') => {
      const full = join(fixture, ...rel.split('/'));
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, body);
    };
    for (const rel of [
      'index.html', 'manifest.webmanifest', 'sw.js',
      'css/app.css', 'css/deep/more/extra.css',
      'js/main.js', 'js/screens/task.js', 'js/screens/deeper/x.js', 'js/notes.md',
      'tests/a.test.js', 'tests/helpers/h.js', 'docs/plan.md', 'docs/x.js',
      'node_modules/pkg/index.js', 'node_modules/pkg/css/p.css',
    ]) put(rel);
  });
  afterAll(() => rmSync(fixture, { recursive: true, force: true }));

  test('하위 디렉터리를 몇 단계 아래까지 재귀로 모은다', () => {
    const got = listShippedFiles(fixture);
    expect(got).toContain('js/screens/task.js');
    expect(got).toContain('js/screens/deeper/x.js');
    expect(got).toContain('css/deep/more/extra.css');
  });

  test('tests/·docs/·node_modules/·sw.js 자신과 js/ 아래의 .js가 아닌 파일은 모으지 않는다', () => {
    expect(listShippedFiles(fixture)).toEqual([
      'css/app.css', 'css/deep/more/extra.css',
      'index.html', 'js/main.js', 'js/screens/deeper/x.js', 'js/screens/task.js',
      'manifest.webmanifest',
    ]);
  });

  test('경로는 저장소 상대이고 항상 슬래시 구분자다 (운영체제와 무관하게 URL로 쓸 수 있다)', () => {
    for (const f of listShippedFiles(fixture)) {
      expect(f).not.toContain('\\');
      expect(f.startsWith('/')).toBe(false);
    }
  });

  test('실제 저장소에서 화면 모듈까지 모은다 (js/screens/ 를 놓치면 보호막이 헛것이다)', () => {
    const got = listShippedFiles();
    for (const f of [
      'index.html', 'manifest.webmanifest', 'css/app.css', 'js/main.js', 'js/config.js',
      'js/screens/setup.js', 'js/screens/practiceScreen.js', 'js/screens/task.js',
      'js/screens/trialRunner.js', 'js/screens/result.js', 'js/screens/history.js',
    ]) expect(got).toContain(f);
  });

  test('실제 저장소에서 제외 대상은 하나도 모으지 않는다', () => {
    for (const f of listShippedFiles()) {
      expect(f).not.toMatch(/^(?:tests|docs|node_modules)\//);
      expect(f).not.toBe('sw.js');
    }
  });

  test('디스크의 js/ 아래 모든 .js 파일 수와 같다 (파일 하나도 빠지지 않는다)', () => {
    const count = dir => readdirSync(join(ROOT, dir), { recursive: true })
      .filter(n => n.endsWith('.js')).length;
    const got = listShippedFiles();
    expect(got.filter(f => f.startsWith('js/'))).toHaveLength(count('js'));
    expect(got.filter(f => f.startsWith('css/'))).toHaveLength(
      readdirSync(join(ROOT, 'css'), { recursive: true }).filter(n => n.endsWith('.css')).length,
    );
  });
});

// ---- 서비스 워커를 실제로 실행해 본다 --------------------------------------------------------

function loadServiceWorker({ cacheKeys = [], cached = new Map(), fetchImpl } = {}) {
  const handlers = {};
  const opened = [];       // caches.open(name) 호출 기록
  const added = [];        // cache.addAll 에 들어간 요청들
  const deleted = [];      // caches.delete(name) 호출 기록
  const fetched = [];      // 네트워크로 나간 요청들
  class Request {
    constructor(url, init = {}) { this.url = url; this.cache = init.cache; this.method = init.method ?? 'GET'; }
  }
  const caches = {
    open: async (name) => { opened.push(name); return { addAll: async (reqs) => { added.push(...reqs); } }; },
    keys: async () => cacheKeys,
    delete: async (name) => { deleted.push(name); return true; },
    match: async (req, opts) => { caches.lastMatchOpts = opts; return cached.get(typeof req === 'string' ? req : req.url); },
  };
  const self = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => { self.skipWaitingCalled = true; },
    clients: { claim: () => { self.claimCalled = true; } },
  };
  const ctx = vm.createContext({
    self, caches, Request, Promise, URL,
    fetch: async (req) => { fetched.push(req); return fetchImpl ? fetchImpl(req) : { fromNetwork: true }; },
  });
  vm.runInContext(read('sw.js'), ctx, { filename: 'sw.js' });

  // 이벤트를 돌려 waitUntil / respondWith에 넘어온 약속을 받아 온다.
  const run = async (type, event = {}) => {
    let waited; let responded; let responseGiven = false;
    const ev = {
      ...event,
      waitUntil: p => { waited = p; },
      respondWith: p => { responseGiven = true; responded = p; },
    };
    if (!handlers[type]) throw new Error(`sw.js가 ${type} 핸들러를 등록하지 않았다`);
    handlers[type](ev);
    await waited;
    return { waited, responded: await responded, responseGiven };
  };
  return { handlers, opened, added, deleted, fetched, run, self, caches };
}

describe('sw.js — install', () => {
  test('캐시 이름은 icp- + js/config.js의 TOOL_VERSION 이다 (복제한 값이 어긋나지 않는다)', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    expect(sw.opened).toEqual([`icp-${TOOL_VERSION}`]);
  });

  test('캐시 목록이 배포 파일 전체 + 시작 주소(./) + icons/ 전체와 정확히 같다 (빠지거나 남는 것이 없다)', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    const urls = sw.added.map(r => r.url);
    expect(urls.slice().sort()).toEqual([...listShippedFiles(), ...listIconFiles(), './'].sort());
  });

  test('중복 항목이 없다', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    const urls = sw.added.map(r => r.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  test('sw.js 자신과 tests/·docs/·node_modules/ 는 캐시 목록에 없다', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    for (const { url } of sw.added) {
      expect(url).not.toBe('sw.js');
      expect(url).not.toMatch(/(?:^|\/)(?:tests|docs|node_modules)\//);
    }
  });

  test('모든 항목이 상대 주소다 (외부 주소를 캐시하지 않는다)', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    for (const { url } of sw.added) expect(url).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i);
  });

  test('HTTP 캐시를 건너뛰고 서버에서 새로 받는다 (새 버전 캐시에 옛 파일이 섞이지 않는다)', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    for (const r of sw.added) expect(r.cache).toBe('reload');
  });

  test('skipWaiting을 부르지 않는다 (검사 도중에 옛 버전 캐시가 지워지지 않는다)', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    expect(sw.self.skipWaitingCalled).toBeUndefined();
    const code = read('sw.js').replace(/\/\/.*$/gm, ''); // 주석의 설명은 허용, 호출만 금지
    expect(code).not.toMatch(/skipWaiting\s*\(|clients\.claim\s*\(/);
  });
});

describe('sw.js — activate', () => {
  test('다른 버전의 icp- 캐시를 지운다', async () => {
    const sw = loadServiceWorker({ cacheKeys: ['icp-0.0.9', `icp-${TOOL_VERSION}`, 'icp-9.9.9'] });
    await sw.run('activate');
    expect(sw.deleted.sort()).toEqual(['icp-0.0.9', 'icp-9.9.9']);
  });

  test('현재 버전 캐시는 지우지 않는다', async () => {
    const sw = loadServiceWorker({ cacheKeys: [`icp-${TOOL_VERSION}`] });
    await sw.run('activate');
    expect(sw.deleted).toEqual([]);
  });

  test('icp- 로 시작하지 않는 캐시(같은 출처의 다른 앱)는 건드리지 않는다', async () => {
    const sw = loadServiceWorker({ cacheKeys: ['other-app-v1', 'icp-0.0.1', 'xicp-0.0.1'] });
    await sw.run('activate');
    expect(sw.deleted).toEqual(['icp-0.0.1']);
  });
});

describe('sw.js — fetch (cache-first)', () => {
  const get = url => ({ request: { url, method: 'GET' } });

  test('캐시에 있으면 네트워크로 나가지 않고 캐시를 돌려준다', async () => {
    const hit = { fromCache: true };
    const sw = loadServiceWorker({ cached: new Map([['https://school.example/js/main.js', hit]]) });
    const { responded, responseGiven } = await sw.run('fetch', get('https://school.example/js/main.js'));
    expect(responseGiven).toBe(true);
    expect(responded).toBe(hit);
    expect(sw.fetched).toEqual([]);
  });

  test('캐시에 없으면 네트워크로 간다', async () => {
    const net = { fromNetwork: 'yes' };
    const sw = loadServiceWorker({ fetchImpl: () => net });
    const { responded } = await sw.run('fetch', get('https://school.example/unknown.txt'));
    expect(responded).toBe(net);
    expect(sw.fetched).toHaveLength(1);
  });

  test('쿼리스트링이 붙은 주소(?utm=…)도 캐시에서 찾는다', async () => {
    const sw = loadServiceWorker();
    await sw.run('fetch', get('https://school.example/?from=qr'));
    expect(sw.caches.lastMatchOpts).toEqual({ ignoreSearch: true });
  });

  test('GET이 아닌 요청은 가로채지 않는다', async () => {
    const sw = loadServiceWorker();
    const { responseGiven } = await sw.run('fetch', { request: { url: 'https://school.example/x', method: 'POST' } });
    expect(responseGiven).toBe(false);
  });

  test('캐시에 없고 네트워크도 안 되면 요청이 실패로 끝난다 (가짜 응답을 만들지 않는다)', async () => {
    const sw = loadServiceWorker({ fetchImpl: () => { throw new TypeError('Failed to fetch'); } });
    await expect(sw.run('fetch', get('https://school.example/nope'))).rejects.toThrow('Failed to fetch');
  });
});

// ---- 매니페스트와 아이콘 -----------------------------------------------------------------------

function pngSize(rel) {
  const b = readFileSync(join(ROOT, rel));
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!b.subarray(0, 8).equals(sig)) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

describe('manifest.webmanifest', () => {
  const m = JSON.parse(read('manifest.webmanifest'));

  test('이름, 시작 주소, 범위가 상대 주소이고 저장소 안을 가리킨다', () => {
    expect(m.name).toBeTruthy();
    expect(m.short_name).toBeTruthy();
    expect(m.start_url).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i);
    expect(m.start_url.startsWith('/')).toBe(false);
    if (m.scope !== undefined) expect(m.scope.startsWith('/')).toBe(false);
  });

  test('시작 주소가 서비스 워커 캐시 목록에 있다 (설치한 앱이 오프라인에서도 열린다)', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    const urls = sw.added.map(r => r.url);
    const target = m.start_url.split(/[?#]/)[0];
    expect(urls).toContain(target);
  });

  test('아이콘이 하나 이상이고, 참조하는 파일이 모두 실제로 존재한다 (없는 파일을 가리키면 설치가 깨진다)', () => {
    expect(m.icons.length).toBeGreaterThan(0);
    for (const icon of m.icons) {
      expect(existsSync(join(ROOT, icon.src)), `${icon.src} 없음`).toBe(true);
    }
  });

  test('아이콘 파일이 선언한 크기와 형식의 PNG다', () => {
    for (const icon of m.icons) {
      expect(icon.type).toBe('image/png');
      const [w, h] = icon.sizes.split('x').map(Number);
      expect(pngSize(icon.src)).toEqual({ w, h });
    }
  });

  test('설치 가능 조건: 192px와 512px 아이콘이 모두 있다', () => {
    const sizes = m.icons.map(i => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  test('아이콘이 모두 서비스 워커 캐시 목록에 있다', async () => {
    const sw = loadServiceWorker();
    await sw.run('install');
    const urls = sw.added.map(r => r.url);
    for (const icon of m.icons) expect(urls).toContain(icon.src);
  });

  test('아이콘 주소가 외부가 아니다', () => {
    for (const icon of m.icons) expect(icon.src).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i);
  });
});

// ---- index.html -------------------------------------------------------------------------------

describe('index.html — 설치', () => {
  const html = read('index.html');

  test('매니페스트를 연결한다', () => {
    expect(html).toMatch(/<link\b[^>]*rel="manifest"[^>]*href="manifest\.webmanifest"[^>]*>/);
  });

  test('iOS 홈 화면용 아이콘을 연결하고 그 파일이 존재하며 캐시 목록에 있다', async () => {
    const m = html.match(/<link\b[^>]*rel="apple-touch-icon"[^>]*href="([^"]+)"[^>]*>/);
    expect(m).not.toBeNull();
    expect(existsSync(join(ROOT, m[1]))).toBe(true);
    const sw = loadServiceWorker();
    await sw.run('install');
    expect(sw.added.map(r => r.url)).toContain(m[1]);
  });

  test('매니페스트와 아이콘을 더한 뒤에도 외부 리소스를 불러오지 않는다 (모든 href/src가 상대 주소)', () => {
    const refs = [...html.matchAll(/\b(?:src|href)\s*=\s*["']?([^"'\s>]+)/gi)].map(x => x[1]);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(r).not.toMatch(/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i);
    expect(html).not.toMatch(/@import/);
  });

  test('<script>는 여전히 하나이고, 서비스 워커 등록은 인라인이 아니라 js/main.js 안에 있다', () => {
    expect(html.match(/<script\b[^>]*>/gi) ?? []).toHaveLength(1);
    expect(html).not.toMatch(/serviceWorker/);
    expect(read('js/main.js')).toMatch(/serviceWorker/);
  });
});

// ---- 세이프 에어리어 ---------------------------------------------------------------------------
// 설치(standalone)하면 브라우저 주소창이 사라지고, iPhone의 노치와 홈 인디케이터가 화면을 먹을 수 있다.
// 이 앱은 *화면 하단 절반 전체가 학생의 반응 영역*이라 하단이 먹히면 반응 영역이 줄어 측정에 영향이 간다.
//
// 결정: viewport-fit=cover를 쓰지 않는다. cover가 없으면(auto) 브라우저가 레이아웃을 노치·홈 인디케이터 안쪽에 맞춰 주므로
// 반응 영역이 시스템 영역에 닿지 않는다. 그래도 학생 화면은 env(safe-area-inset-*)로 위·아래를 직접 비워 둔다 —
// auto에서는 0이라 아무 일도 없지만, 나중에 cover로 바꾸거나 inset을 알려 주는 브라우저에서도 반응 영역이 그 안으로 안 들어간다.

function blockOf(source, header) {
  const start = source.indexOf(header);
  if (start === -1) return null;
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return null;
}

describe('세이프 에어리어', () => {
  const html = read('index.html');
  const css = read('css/app.css');

  test('viewport-fit=cover를 쓰지 않는다 (결정을 바꾸려면 이 테스트와 근거를 함께 고친다)', () => {
    expect(html).toContain('<meta name="viewport"');
    expect(html).not.toMatch(/viewport-fit/);
  });

  test('검사 화면과 대기 화면(학생이 보는 전체 화면)이 위·아래 안전 영역을 비워 둔다', () => {
    for (const header of ['.test-screen {', '.wait-screen {']) {
      const block = blockOf(css, header);
      expect(block, header).not.toBeNull();
      expect(block, header).toMatch(/padding:[^;]*env\(\s*safe-area-inset-top/);
      expect(block, header).toMatch(/padding:[^;]*env\(\s*safe-area-inset-bottom/);
    }
  });

  test('반응 영역 행은 여전히 50%다 (안전 영역을 비워도 "남은 높이의 정확히 절반"이다)', () => {
    expect(blockOf(css, '.test-screen {')).toMatch(/grid-template-rows:\s*1fr\s+var\(--strip-height\)\s+50%\s*;/);
  });

  test('교사 화면도 위·아래 안전 영역 안쪽에서 시작한다 (제목·시작 버튼이 노치·홈 인디케이터에 안 가린다)', () => {
    const block = blockOf(css, '.teacher-screen {');
    expect(block).toMatch(/padding:[^;]*env\(\s*safe-area-inset-top/);
    expect(block).toMatch(/padding:[^;]*env\(\s*safe-area-inset-bottom/);
  });

  test('중단 버튼(구석)도 위쪽 안전 영역 아래에 놓인다', () => {
    expect(blockOf(css, '.abort-btn {')).toMatch(/top:[^;]*env\(\s*safe-area-inset-top/);
  });
});
