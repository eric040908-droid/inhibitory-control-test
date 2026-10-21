// 측정 조건 기록. 이 검사는 연구 자료로도 쓰이고, 스마트폰은 기기마다 터치 지연이 다르다.
// 그래서 회차마다 기기·브라우저·입력 수단·화면 주사율 추정을 함께 남겨, 같은 학생의 같은 기기 회차끼리만 비교할 수 있게 한다.
// 브라우저 전역에 직접 기대지 않고 win을 주입받는다(생략하면 실제 전역). 어떤 값이든 못 읽으면 던지지 않고 기본값으로 둔다.

// 터치 기기에서 화면 짧은 변이 이 값(CSS px) 미만이면 스마트폰, 이상이면 태블릿으로 본다.
const PHONE_MAX_SHORT_SIDE = 600;

// 주사율 추정에 쓰는 프레임 간격 수와, 프레임이 안 올 때(백그라운드 탭 등) 포기하는 시간(ms).
const HZ_SAMPLE_DELTAS = 12;
const HZ_TIMEOUT_MS = 1000;

// 측정한 window별 주사율 추정값. 다른 window의 값이 섞이지 않게 WeakMap으로 둔다.
const hzByWindow = new WeakMap();

function safe(read, fallback) {
  try {
    const v = read();
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function detectInputKind(win) {
  const coarse = safe(() => win.matchMedia('(pointer: coarse)').matches, null);
  if (coarse !== null) return coarse ? 'touch' : 'mouse';
  // matchMedia가 없는 환경: 터치 접점이 있으면 터치로 본다.
  return safe(() => win.navigator.maxTouchPoints, 0) > 0 ? 'touch' : 'mouse';
}

// 사용자 에이전트 문자열에서 브라우저 이름과 주 버전만 뽑는다. 검사 조건 구분이 목적이라 이 정도면 충분하다.
// 순서가 중요하다: Edge·Opera·Samsung·iOS Chrome의 UA에는 Chrome/Safari가 함께 들어 있다.
const BROWSER_PATTERNS = [
  ['Edge', /Edg(?:e|A|iOS)?\/(\d+)/],
  ['Opera', /OPR\/(\d+)/],
  ['Samsung Internet', /SamsungBrowser\/(\d+)/],
  ['Chrome', /(?:Chrome|CriOS)\/(\d+)/],
  ['Firefox', /(?:Firefox|FxiOS)\/(\d+)/],
  ['Safari', /Version\/(\d+)[\s\S]*Safari\//],
];

function detectBrowser(userAgent) {
  for (const [name, pattern] of BROWSER_PATTERNS) {
    const m = pattern.exec(userAgent);
    if (m) return `${name} ${m[1]}`;
  }
  return 'unknown';
}

export function collectDeviceInfo(win = globalThis) {
  const screenW = safe(() => win.screen.width, 0);
  const screenH = safe(() => win.screen.height, 0);
  const inputKind = detectInputKind(win);

  let kind = 'desktop';
  if (inputKind === 'touch') kind = Math.min(screenW, screenH) < PHONE_MAX_SHORT_SIDE ? 'phone' : 'tablet';

  return {
    kind,
    screenW,
    screenH,
    dpr: safe(() => win.devicePixelRatio, 1),
    browser: detectBrowser(safe(() => win.navigator.userAgent, '')),
    inputKind,
    refreshHzEst: hzByWindow.get(win) ?? null,
  };
}

// requestAnimationFrame 간격을 몇 프레임 재서 화면 주사율(Hz)을 추정한다. 프레임 간격은 측정에 시간이 걸리므로 비동기다.
// 검사 시작 전에 한 번 불러 두면 이후 collectDeviceInfo가 그 값을 읽는다. 잴 수 없으면 null이다.
// 간격의 중앙값을 쓰는 이유: 가끔 튀는 프레임 하나가 추정을 흔들지 않게 하려는 것이다.
export function measureRefreshHz(win = globalThis) {
  return new Promise((resolve) => {
    const raf = safe(() => win.requestAnimationFrame, null);
    if (typeof raf !== 'function') {
      resolve(null);
      return;
    }

    let finished = false;
    const finish = (hz) => {
      if (finished) return;
      finished = true;
      // 실패(null)가 이미 측정된 좋은 값을 덮어쓰지 않게 하고, WeakMap 키가 될 수 없는 win(null 등)은 캐시하지 않는다.
      if (hz !== null && win !== null && typeof win === 'object') hzByWindow.set(win, hz);
      resolve(hz);
    };
    const timer = setTimeout(() => finish(null), HZ_TIMEOUT_MS);

    const deltas = [];
    let previous = null;
    const onFrame = (now) => {
      if (finished) return;
      if (previous !== null) deltas.push(now - previous);
      previous = now;
      if (deltas.length < HZ_SAMPLE_DELTAS) {
        try { raf.call(win, onFrame); } catch { clearTimeout(timer); finish(null); }
        return;
      }
      clearTimeout(timer);
      const sorted = [...deltas].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      finish(median > 0 ? Math.round(1000 / median) : null);
    };

    try { raf.call(win, onFrame); } catch { clearTimeout(timer); finish(null); }
  });
}
