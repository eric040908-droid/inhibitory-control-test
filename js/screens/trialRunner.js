// 학생 화면의 공통 부분 — 검사 화면(task.js)과 연습 화면(practiceScreen.js)이 같은 그림판·같은 엔진 배선을 쓴다.
//
// 화면 구성(세로): 위쪽 절반에 자극 그림, 가운데 얇은 띠에 수집 격자, 아래쪽 절반 전체가 반응 영역.
// 이 화면에는 문장이 없다. 그림·아이콘·소리·움직임뿐이다(숫자 카운터는 괜찮다).
//
// 이 모듈이 지키는 것 (모두 tests/screens.task.test.js가 고정한다):
//   1. 시계는 performance.now() 기준이다. 엔진의 input()은 event.timeStamp를 받는데, 최신 브라우저에서 그 값은
//      performance.now()와 같은 기준이다. Date.now()를 쓰면 기준이 어긋나 모든 문항이 누락으로 기록된다.
//   2. 응답은 엔진의 onFinish(responses)가 준 배열을 그대로 넘긴다. onTrialComplete가 받는 Response는 스냅샷이라
//      정반응의 extraTaps가 항상 0이다 — 그걸 모으면 CSV의 extra_taps가 전부 0이 된다.
//   3. pause()/abort()는 훅을 부르지 않으므로(onStimulusEnd가 안 온다) 화면이 자극을 스스로 치운다.
//   4. markStimulusRendered에는 문항 신원이 없다. 묵은 rAF 콜백이 다음 문항에 떨어지지 않게, 문항이 바뀔 때 보류 중인
//      rAF를 취소하고, 콜백 안에서도 "지금 떠 있는 문항이 예약한 문항인지" 확인한다.
//   5. 오반응에는 아무 일도 일어나지 않는다. 소리도 표시도 없다. 칸이 채워지지 않을 뿐이다.
//   6. 반응 입력은 pointerdown이다(click은 터치에서 지연이 붙는다).
//   7. 움직임은 CSS 애니메이션 클래스로만 만든다 — element.animate()(WAAPI)는 CSS의 애니메이션 끄기가 막지 못한다.
import { THRESHOLDS } from '../config.js';
import { noGoGlyphFor } from '../themes.js';

// ---- 보상 -----------------------------------------------------------------------------------
// 칸이 채워지는 경우는 두 가지뿐이다.
//   Go 정반응: 입력이 있고 조급 반응이 아니다(rtMs >= anticipatoryMs). 조급 반응으로 맞춘 Go는 채우지 않는다 —
//     보상이 "그냥 누르기"를 강화하면 안 된다. (이때도 실패를 알리는 표시는 없다.)
//   참기 성공: No-Go에 입력이 없다. 억제에 보상이 가야 억제가 강화된다.
// 그 밖(Go 누락, 억제 실패, 무효)은 아무 일도 없다. 기준은 metrics.js의 분류와 같다.
export function rewardsCell(response) {
  if (response.invalid) return false;
  if (response.type === 'go') return response.rtMs !== null && response.rtMs >= THRESHOLDS.anticipatoryMs;
  return response.rtMs === null;
}

// ---- 전체화면 -------------------------------------------------------------------------------
// 권장하되 강제하지 않는다: 거부되거나(사용자 제스처 밖) 지원하지 않아도 그대로 진행한다.
export function requestFullscreen(doc = document) {
  try {
    if (doc.fullscreenElement || doc.webkitFullscreenElement) return;
    const root = doc.documentElement;
    const request = root.requestFullscreen ?? root.webkitRequestFullscreen;
    const pending = request?.call(root);
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch {
    // 전체화면은 부가 기능이다. 던져도 검사는 진행한다.
  }
}

export function exitFullscreen(doc = document) {
  try {
    if (!doc.fullscreenElement && !doc.webkitFullscreenElement) return;
    const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
    const pending = exit?.call(doc);
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch {
    // 위와 같다.
  }
}

// ---- 격자 배치 ------------------------------------------------------------------------------
// 띠는 높이가 4rem쯤이고 폭은 폰 폭이다. 칸이 최대 70개(100문항의 70%)라 한 줄에는 못 담는다.
// 칸 한 변이 가장 크게 나오는 줄 수(1~4)를 고른다. 폭·높이는 세로 폰(375px)의 대략값이다 — 실제 칸 크기는 CSS가 맞춘다.
const GRID_NOMINAL = { width: 343, height: 64, maxRows: 4 };

export function gridLayout(count) {
  let best = { rows: 1, cols: Math.max(1, count) };
  let bestSide = -1;
  for (let rows = 1; rows <= GRID_NOMINAL.maxRows; rows += 1) {
    const cols = Math.max(1, Math.ceil(count / rows));
    const side = Math.min(GRID_NOMINAL.height / rows, GRID_NOMINAL.width / cols);
    if (side > bestSide) {
      bestSide = side;
      best = { rows, cols };
    }
  }
  return best;
}

// ---- 그림판 ---------------------------------------------------------------------------------
function el(tag, className, attrs = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

// cellCount칸짜리 격자가 있는 학생 화면 DOM을 만든다. 엔진도 타이머도 모른다.
export function createStudentView({ itemGlyph, cellCount }) {
  const root = el('div', 'test-screen', { 'data-student-view': '' });
  const stimulusArea = el('div', 'test-stimulus');
  const stimulus = el('span', 'stimulus-glyph', { 'data-stimulus': '' });
  stimulus.hidden = true;
  stimulusArea.append(stimulus);
  const strip = el('div', 'test-strip', { 'data-grid': '' });
  const response = el('div', 'test-response', { 'data-response-area': '', 'data-area': 'bottom-half' });
  root.append(stimulusArea, strip, response);

  // 길게 눌러 뜨는 시스템 메뉴·선택을 막는다. 이 화면에서 손가락은 반응 영역 위에 오래 머물 수 있다.
  root.addEventListener('contextmenu', (event) => event.preventDefault());

  let filled = 0;
  let cells = [];

  function resetGrid(count) {
    const { rows, cols } = gridLayout(count);
    strip.style.setProperty('--grid-rows', String(rows));
    strip.style.setProperty('--grid-cols', String(cols));
    cells = Array.from({ length: count }, () => {
      const cell = el('span', 'grid-cell', { 'data-cell': '', 'data-filled': 'false' });
      return cell;
    });
    strip.replaceChildren(...cells);
    filled = 0;
  }
  resetGrid(cellCount);

  return {
    el: root,
    stimulusArea,
    stimulusEl: stimulus,
    responseEl: response,
    gridEl: strip,

    showStimulus(glyph) {
      stimulus.textContent = glyph;
      stimulus.hidden = false;
    },
    hideStimulus() {
      stimulus.hidden = true;
      stimulus.textContent = '';
      stimulus.classList.remove('is-demo-sway');
    },

    // 다음 빈 칸 하나를 채운다. 격자가 이미 찼으면 아무것도 하지 않는다(넘치지 않는다). 채웠으면 true.
    fillNextCell() {
      if (filled >= cells.length) return false;
      const cell = cells[filled];
      filled += 1;
      cell.textContent = itemGlyph;
      cell.dataset.filled = 'true';
      cell.classList.add('is-new'); // 짧은 CSS 애니메이션(300ms 이내). 칸 안에서만 움직여 자극을 가리지 않는다.
      return true;
    },
    filledCount: () => filled,
    totalCells: () => cells.length,
    resetGrid,

    // 세션이 끝난 뒤의 마무리 그림. 격자가 덜 찼어도 같다 — 보상이 안 나오는 것 자체가 실패 신호가 되기 때문이다.
    showCompletion(glyph) {
      const node = el('div', 'test-completion', { 'data-completion': '' });
      node.textContent = glyph;
      root.append(node);
      return node;
    },
  };
}

// ---- 엔진 배선 ------------------------------------------------------------------------------
// 엔진에 넘기는 시계. performance.now() 기준이다(위 1번). 메서드는 자기 완결형 클로저로 감싼다:
// setTimeout을 그대로 꽂으면 호출 때의 this가 달라져 "Illegal invocation"이 난다.
// 전역 setTimeout은 호출 시점에 찾는다 — 모듈이 불릴 때 붙잡아 두면 테스트의 가짜 타이머가 안 먹는다.
export function makeClock() {
  return {
    now: () => performance.now(),
    setTimeout: (...args) => globalThis.setTimeout(...args),
    clearTimeout: (...args) => globalThis.clearTimeout(...args),
  };
}

export function glyphForTrial(theme, level, trial) {
  return trial.type === 'go' ? theme.goGlyph : noGoGlyphFor(theme, level);
}

// view 위에서 trials를 돌리는 엔진을 만든다.
//   onFinish(responses): 엔진의 onFinish가 준 배열 그대로(위 2번).
//   startDelayMs: start()를 부른 뒤 첫 자극까지의 빈 화면 시간. 학생이 화면을 보게 한다.
export function createTrialRunner({ view, audio, createEngine, theme, level, trials, levelParams, startDelayMs, onFinish }) {
  const controller = new AbortController();
  const { signal } = controller;

  let current = null;     // 지금 화면에 떠 있는 문항
  let rafId = null;       // 보류 중인 rAF
  let rafGeneration = 0;  // 문항이 바뀔 때마다 올린다. 묵은 콜백을 알아보는 표
  let leadTimer = null;
  let started = false;
  let leadPending = false; // 화면이 가려져서 첫 시작을 미뤄 둔 상태
  let paused = false;
  let ended = false;

  function cancelPendingRender() {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    rafGeneration += 1;
  }

  function hideStimulus() {
    cancelPendingRender();
    current = null;
    view.hideStimulus();
  }

  function armLead() {
    leadTimer = globalThis.setTimeout(() => {
      leadTimer = null;
      leadPending = false;
      started = true;
      engine.start();
    }, startDelayMs);
  }

  const hooks = {
    onStimulus(trial) {
      cancelPendingRender();
      current = trial;
      view.showStimulus(glyphForTrial(theme, level, trial));
      // 이중 rAF. 단일 rAF의 콜백은 페인트 전에 돌고 그 타임스탬프는 프레임 시작 시각이라(보통 자극을 요청한 시각보다도 이르다)
      // 엔진의 max(ts, startedAt)에 걸려 렌더 마크가 아무 효과도 못 낸다. 둘째 rAF의 콜백은 첫 프레임이 그려진 뒤에 도므로,
      // 거기서 performance.now()를 읽은 값이 "자극이 실제로 그려진 시각"에 가장 가깝다(콜백의 타임스탬프 인자는 쓰지 않는다).
      //
      // 요구 4: 핸들이 둘이 되므로 문항이 바뀔 때(cancelPendingRender) 보류 중인 쪽을 취소하고, 두 콜백 모두 안에서
      // "예약한 표시가 아직 그대로인지" 확인한다. 묵은 콜백은 rafId를 건드리지 않는다(지금 문항의 핸들을 지우면 안 된다).
      const generation = rafGeneration;
      const stale = () => current !== trial || generation !== rafGeneration;
      rafId = requestAnimationFrame(() => {
        if (stale()) return;
        rafId = requestAnimationFrame(() => {
          if (stale()) return;
          rafId = null;
          engine.markStimulusRendered(clock.now());
        });
      });
      audio.playStimulus();
    },
    onStimulusEnd() {
      hideStimulus();
    },
    onTrialComplete(response) {
      // 보상은 정반응과 참기 성공에만. 소리는 칸과 함께 난다(참기 성공도 정반응과 같은 소리). 오반응에는 아무것도 없다.
      if (!rewardsCell(response)) return;
      view.fillNextCell();
      audio.playCorrect();
    },
    onFinish(responses) {
      ended = true;
      hideStimulus();
      onFinish(responses);
    },
  };

  const clock = makeClock();
  const engine = createEngine({ trials, levelParams, hooks, clock });

  // 반응 입력: pointerdown. 시각은 핸들러가 실행된 때가 아니라 이벤트가 일어난 때(event.timeStamp)다.
  view.responseEl.addEventListener('pointerdown', (event) => {
    engine.input(event.timeStamp);
  }, { signal });

  // 화면이 가려지면(탭 전환, 전화, 화면 꺼짐) 즉시 멈추고, 돌아오면 다음 문항부터 재개한다.
  document.addEventListener('visibilitychange', () => {
    if (ended) return;
    if (document.visibilityState === 'hidden') {
      if (paused) return;
      paused = true;
      hideStimulus(); // pause()는 훅을 부르지 않는다
      // 첫 자극을 기다리는 중이면 가려진 동안 시작하지 않고, 돌아오면 처음부터 다시 기다린다.
      if (leadTimer !== null) {
        globalThis.clearTimeout(leadTimer);
        leadTimer = null;
        leadPending = true;
      }
      engine.pause(); // 엔진이 아직 시작 전이면 아무 일도 없다
    } else {
      if (!paused) return;
      paused = false;
      if (leadPending) armLead();
      engine.resume(); // 멈춰 있지 않았다면 엔진이 무시한다
    }
  }, { signal });

  return {
    start() {
      if (started || leadTimer !== null || ended) return;
      if (paused) {
        leadPending = true; // 가려진 채로 시작이 불리면 돌아온 뒤에 시작한다
        return;
      }
      armLead();
    },

    // 중단: 진행 중이던 문항은 엔진이 무효로 남긴다. 자극은 화면이 치운다. 지금까지의 기록을 돌려준다.
    abort() {
      if (leadTimer !== null) globalThis.clearTimeout(leadTimer);
      leadTimer = null;
      leadPending = false;
      ended = true;
      engine.abort();
      hideStimulus();
      return engine.responses();
    },

    // 화면을 떠날 때: 엔진·타이머·리스너·rAF를 모두 거둔다.
    destroy() {
      controller.abort();
      if (leadTimer !== null) globalThis.clearTimeout(leadTimer);
      leadTimer = null;
      leadPending = false;
      ended = true;
      engine.abort();
      hideStimulus();
    },
  };
}
