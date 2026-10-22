// 서비스 워커 — 한 번 열어 본 뒤에는 인터넷이 끊겨도 앱이 열리고 검사가 끝까지 되게 한다.
// 학교 네트워크를 믿을 수 없으므로, 설치 때 배포 파일 전체를 캐시에 넣고 요청은 캐시를 먼저 본다.
//
// !! 아래 PRECACHE는 배포 파일 전체여야 한다. 빠진 파일은 온라인에서는 네트워크가 채워 줘서 티가 안 나다가
//    오프라인에서만 조용히 깨진다. js/·css/ 아래에 파일을 더하면 여기에도 더한다 —
//    tests/manifest.test.js가 디스크의 배포 파일과 이 목록이 정확히 같은지 본다.
//
// 서비스 워커는 ES 모듈 import를 믿을 수 없는 환경이 있어(일부 브라우저는 모듈 워커를 지원하지 않는다)
// js/config.js의 TOOL_VERSION을 import하지 않고 여기에 같은 값을 적는다. 어긋나면 테스트가 깨진다.
const TOOL_VERSION = '0.1.0';
const CACHE_PREFIX = 'icp-';
const CACHE_NAME = CACHE_PREFIX + TOOL_VERSION;

const PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'js/audio.js',
  'js/badge.js',
  'js/config.js',
  'js/deviceInfo.js',
  'js/engine.js',
  'js/exportImport.js',
  'js/flow.js',
  'js/interpretation.js',
  'js/main.js',
  'js/metrics.js',
  'js/pin.js',
  'js/practice.js',
  'js/prefs.js',
  'js/router.js',
  'js/screens/history.js',
  'js/screens/pinGate.js',
  'js/screens/practiceScreen.js',
  'js/screens/result.js',
  'js/screens/setup.js',
  'js/screens/task.js',
  'js/screens/trialRunner.js',
  'js/storage.js',
  'js/themes.js',
  'js/trialSequence.js',
];

// cache: 'reload' — 브라우저의 HTTP 캐시를 건너뛴다. 새 버전 캐시에 옛 파일이 섞여 들어가면
// 버전 이름은 새것인데 내용은 옛것인 캐시가 생긴다.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })))),
  );
});

// 다른 버전의 캐시를 지운다. 안 지우면 기기에 옛 버전이 쌓인다. 접두사가 다른 캐시(같은 출처의 다른 앱)는 건드리지 않는다.
// skipWaiting()/clients.claim()은 일부러 쓰지 않는다: 새 버전은 열려 있는 탭이 모두 닫힌 뒤에 활성화되므로
// 검사 도중에 캐시가 바뀌거나 지워지지 않는다.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)),
    )),
  );
});

// cache-first. ignoreSearch: QR 코드 등으로 `?from=…`이 붙은 주소로 열어도 캐시된 화면이 뜬다.
// 캐시에 없고 네트워크도 안 되면 요청은 그냥 실패한다 — 가짜 응답을 만들지 않는다.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || fetch(event.request)),
  );
});
