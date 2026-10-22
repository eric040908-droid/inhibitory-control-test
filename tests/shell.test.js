// 앱 셸 — index.html, css/app.css, js/main.js를 *파일로 읽어서* 검사한다.
// 브라우저 없이 배포 산출물의 계약(오프라인·모바일·접근성 CSS·시간 기준 경고)을 고정한다.
// Task 15가 배포 산출물을 같은 방식으로 검사한다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = rel => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const html = read('index.html');
const css = read('css/app.css');
const main = read('js/main.js');

// "<header> { ... }" 의 중괄호 짝을 맞춰 안쪽 본문을 돌려준다. 못 찾으면 null.
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

describe('index.html', () => {
  test('viewport meta가 확대를 막는다', () => {
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    );
  });

  test('한국어 문서이고 UTF-8이다', () => {
    expect(html).toMatch(/<html[^>]*\blang="ko"/);
    expect(html).toMatch(/<meta\s+charset="utf-8"/i);
  });

  test('루트 #app이 있다', () => {
    expect(html).toMatch(/<div\s+id="app"/);
  });

  test('외부 리소스를 불러오지 않는다 (src/href가 http(s)나 프로토콜 상대 주소가 아니다)', () => {
    expect(html).not.toMatch(/src="http/);
    expect(html).not.toMatch(/href="http/);
    // 위 두 줄이 못 잡는 변형: 작은따옴표, 따옴표 없음, 프로토콜 상대(//cdn...), 공백
    expect(html).not.toMatch(/\b(?:src|href)\s*=\s*['"]?\s*(?:https?:)?\/\//i);
    expect(html).not.toMatch(/@import/);
  });

  test('<script>가 정확히 하나이고 type="module"로 js/main.js를 가리킨다', () => {
    const scripts = html.match(/<script\b[^>]*>/gi) ?? [];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatch(/type="module"/);
    expect(scripts[0]).toMatch(/src="js\/main\.js"/);
  });

  test('스타일시트는 css/app.css 하나뿐이고 인라인 <style>이 없다', () => {
    const links = html.match(/<link\b[^>]*rel="stylesheet"[^>]*>/gi) ?? [];
    expect(links).toHaveLength(1);
    expect(links[0]).toMatch(/href="css\/app\.css"/);
    expect(html).not.toMatch(/<style\b/i);
  });
});

describe('css/app.css', () => {
  test(':root에 커스텀 속성을 정의한다', () => {
    const root = blockOf(css, ':root');
    expect(root).not.toBeNull();
    expect(root).toMatch(/--[\w-]+\s*:/);
  });

  test('외부 리소스를 불러오지 않는다 (url(http…), @import, 웹폰트)', () => {
    expect(css).not.toMatch(/@import/);
    expect(css).not.toMatch(/@font-face/);
    expect(css).not.toMatch(/url\(\s*['"]?\s*(?:https?:)?\/\//i);
  });

  test(':root에 정의한 토큰은 모두 어딘가에서 쓰인다 (쓰이지 않는 토큰을 쌓지 않는다)', () => {
    const root = blockOf(css, ':root');
    const names = [...root.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]);
    expect(names.length).toBeGreaterThan(0);
    // 접두사 일치 금지: var(--color-text-muted)가 --color-text를 "쓰인다"로 만들면 안 된다.
    const unused = names.filter(n => !new RegExp(`var\\(\\s*${n}\\s*[,)]`).test(css));
    expect(unused).toEqual([]);
  });

  test('var()가 가리키는 토큰은 모두 :root에 정의돼 있다', () => {
    const root = blockOf(css, ':root');
    const defined = new Set([...root.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
    const used = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => m[1]);
    expect(used.filter(n => !defined.has(n))).toEqual([]);
  });

  test('prefers-reduced-motion 쪽에서 애니메이션과 전환을 끈다', () => {
    const block = blockOf(css, '@media (prefers-reduced-motion: reduce)');
    expect(block).not.toBeNull();
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  test('data-reduced-motion="true" 쪽에서도 애니메이션과 전환을 끈다 (수동 토글용)', () => {
    const block = blockOf(css, 'html[data-reduced-motion="true"] *');
    expect(block).not.toBeNull();
    expect(block).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms\s*!important/);
  });

  test('애니메이션 끄기는 animationend가 계속 뜨도록 길이만 0에 가깝게 줄인다 (animation: none 금지)', () => {
    // 화면 코드가 animationend로 다음 단계를 이어 가면, none은 그 이벤트를 없애 흐름을 멈춘다.
    const reduced = blockOf(css, '@media (prefers-reduced-motion: reduce)');
    const manual = blockOf(css, 'html[data-reduced-motion="true"] *');
    for (const block of [reduced, manual]) {
      expect(block).not.toMatch(/animation:\s*none/);
      expect(block).not.toMatch(/animation-name:\s*none/);
    }
  });

  test('검사 화면은 스크롤·확대·선택을 막는다', () => {
    const screen = blockOf(css, '.test-screen {');
    expect(screen).not.toBeNull();
    expect(screen).toMatch(/touch-action:\s*(?:none|manipulation)/);
    expect(screen).toMatch(/user-select:\s*none/);
    expect(screen).toMatch(/overscroll-behavior:\s*none/);
  });

  test('문서 전체도 더블탭 확대와 당겨서 새로고침을 막는다', () => {
    const base = blockOf(css, 'html, body {');
    expect(base).not.toBeNull();
    expect(base).toMatch(/touch-action:\s*manipulation/);
    expect(base).toMatch(/overscroll-behavior:\s*none/);
  });

  test('반응 영역이 화면 하단 절반이다 (세로 기준: 자극+띠 / 반응 = 1fr … 50%)', () => {
    const screen = blockOf(css, '.test-screen {');
    expect(screen).toMatch(/grid-template-areas:\s*"stimulus"\s*"strip"\s*"response"/);
    expect(screen).toMatch(/grid-template-rows:\s*1fr\s+var\(--strip-height\)\s+50%\s*;/);
  });

  test('dvh를 모르는 브라우저에서도 반응 영역 행이 유효하다 (grid-template-rows에 dvh를 쓰지 않는다)', () => {
    // 모르는 단위가 하나라도 있으면 브라우저는 선언 전체를 버리고, rows가 auto가 되어 반응 영역이 사라진다.
    const screen = blockOf(css, '.test-screen {');
    const rows = screen.match(/grid-template-rows:([^;]*);/)[1];
    expect(rows).not.toMatch(/dvh|svh|lvh/);
    expect(rows.trim().split(/\s+/).at(-1)).toBe('50%');
    // 그 백분율이 풀리려면 컨테이너 높이가 확정돼 있어야 한다.
    expect(screen).toMatch(/height:\s*100vh/);
  });

  test('dvh 선언은 모두 같은 속성의 비-dvh 폴백이 먼저 온다 (모르는 브라우저는 dvh 선언만 버린다)', () => {
    const rulesOnly = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const offenders = [];
    for (const [, body] of rulesOnly.matchAll(/\{([^{}]*)\}/g)) {
      const seen = new Set(); // 지금까지 나온 "dvh 없는" 선언의 속성
      for (const decl of body.split(';')) {
        const m = decl.match(/^\s*([\w-]+)\s*:([\s\S]*)$/);
        if (!m) continue;
        const [, prop, value] = m;
        if (/\d(?:dvh|svh|lvh)\b/.test(value)) {
          if (!seen.has(prop)) offenders.push(`${prop}: ${value.trim()}`);
        } else {
          seen.add(prop);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('가로 모드에서는 반응 영역이 오른쪽 절반을 차지한다', () => {
    const landscape = blockOf(css, '@media (orientation: landscape)');
    expect(landscape).not.toBeNull();
    expect(landscape).toMatch(/grid-template-columns:\s*1fr\s+1fr/);
    expect(landscape).toMatch(/"stimulus\s+response"/);
    expect(landscape).toMatch(/"strip\s+response"/);
  });

  test('세 영역(자극·격자 띠·반응) 클래스가 있다', () => {
    for (const cls of ['.test-stimulus', '.test-strip', '.test-response']) {
      expect(css).toContain(cls);
    }
  });

  test('오반응 피드백용 흔들기·경고색 규칙을 두지 않는다', () => {
    const rulesOnly = css.replace(/\/\*[\s\S]*?\*\//g, ''); // 주석에 단어가 나와도 상관없다
    // 막는 것은 오반응 피드백이다. 교사 화면의 정당한 입력 오류 표시(.field-error 등)는 막지 않는다.
    expect(rulesOnly).not.toMatch(/shake|wobble|wrong|incorrect|fail/i);
  });
});

describe('js/main.js', () => {
  test('createRouter로 #app에 라우터를 만든다', () => {
    expect(main).toMatch(/import\s*\{[^}]*\bcreateRouter\b[^}]*\}\s*from\s*'\.\/router\.js'/);
    expect(main).toMatch(/createRouter\(/);
    expect(main).toMatch(/getElementById\('app'\)|querySelector\('#app'\)/);
  });

  test('audio.unlock을 pointerdown 제스처에 연결한다', () => {
    expect(main).toMatch(/document\.addEventListener\(\s*'pointerdown'/);
    expect(main).toMatch(/audio\.unlock\(\)/);
  });

  test('터치에서는 pointerup이 활성화 이벤트이므로 pointerup에도 unlock을 건다', () => {
    expect(main).toMatch(/document\.addEventListener\(\s*'pointerup'/);
  });

  test('입력은 pointerdown이고 click은 쓰지 않는다', () => {
    expect(main).not.toMatch(/['"]click['"]/);
  });

  test('unlock을 매번 부를지 한 번만 부를지 선택을 주석으로 남겼다', () => {
    expect(main).toMatch(/매번/);
  });

  test('performance.now() 시간 기준 경고 주석이 있다 (Task 12를 위한 것)', () => {
    expect(main).toMatch(/performance\.now\(\)/);
    expect(main).toMatch(/Date\.now\(\)/);
    expect(main).toMatch(/event\.timeStamp/);
    expect(main).toMatch(/누락/);
  });

  test('오반응용 소리 함수를 deps에 노출하지 않는다', () => {
    expect(main).not.toMatch(/playWrong|playError|playIncorrect|playFail/i);
  });

  test('플레이스홀더임이 코드에 분명히 적혀 있다', () => {
    expect(main).toMatch(/플레이스홀더/);
    expect(main).toMatch(/Task 11/);
  });
});
