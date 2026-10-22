// @vitest-environment jsdom
// 검사 화면(학생이 보는 화면). 앞의 10개는 계획서의 테스트 그대로이고, 그 아래는 경계 확인을 테스트로 남긴 것이다.
// 엔진은 가짜로 바꾼다: 화면이 엔진을 어떻게 부르는지(input/pause/resume/abort)와, 엔진 훅에 화면이 어떻게 반응하는지를 본다.
// 진짜 엔진·진짜 시계로 이어 붙인 시험은 맨 아래 '진짜 엔진' 묶음에 있다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import './helpers/pointerEvent.js';
import { LEVELS, THRESHOLDS } from '../js/config.js';
import { getTheme, rewardCellCount } from '../js/themes.js';
import { createEngine as realCreateEngine } from '../js/engine.js';
import { createTaskScreen, ABORT_HOLD_MS, COMPLETION_HOLD_MS } from '../js/screens/task.js';
import { gridLayout } from '../js/screens/trialRunner.js';
import { THEMES } from '../js/themes.js';

const read = rel => readFileSync(resolve(process.cwd(), rel), 'utf8'); // vitest는 프로젝트 루트에서 돌린다

// ---- 하네스 ------------------------------------------------------------------------------
const makeAudio = () => ({ unlock: vi.fn(), playCorrect: vi.fn(), playStimulus: vi.fn(), setEnabled: vi.fn() });

function makeEngine() {
  return {
    start: vi.fn(), input: vi.fn(), markStimulusRendered: vi.fn(),
    pause: vi.fn(), resume: vi.fn(), abort: vi.fn(), responses: vi.fn(() => []),
  };
}

const goTrial = index => ({ index, type: 'go' });
const nogoTrial = index => ({ index, type: 'nogo' });
const trialsOf = n => Array.from({ length: n }, (_, i) => goTrial(i));

let screen = null;
let hooks = null;
let engine = null;
let engineArgs = null;
let responseIndex = 0;

function mountTask({ trials = trialsOf(10), level = 2, theme = getTheme('animal'), audio = makeAudio(), createEngine } = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onFinish = vi.fn();
  const onAbort = vi.fn();
  const onCompleted = vi.fn();
  const engineFactory = createEngine ?? vi.fn((args) => {
    engineArgs = args;
    hooks = args.hooks;
    engine = makeEngine();
    return engine;
  });
  responseIndex = 0;
  screen = createTaskScreen({ audio, createEngine: engineFactory });
  screen.mount(root, { trials, level, theme, onFinish, onAbort, onCompleted });
  return { root, engine, hooks, audio, onFinish, onAbort, onCompleted, createEngine: engineFactory, theme, trials };
}

const qs = sel => document.querySelector(sel);
const qsa = sel => [...document.querySelectorAll(sel)];
const filledCells = () => qsa('[data-cell][data-filled="true"]').length;
const totalCells = () => qsa('[data-cell]').length;
const stimulusGlyph = () => qs('[data-stimulus]')?.textContent ?? '';
const responseArea = () => qs('[data-response-area]');

const response = (type, rtMs, extra = {}) => ({ index: responseIndex++, type, rtMs, extraTaps: 0, invalid: false, ...extra });
const go = rtMs => response('go', rtMs);
const nogo = rtMs => response('nogo', rtMs);
const completeTrial = ({ type, rtMs }) => hooks.onTrialComplete(response(type, rtMs));
const finishWith = responses => hooks.onFinish(responses);

function fireVisibility(state) {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

const pointerEvent = type => new PointerEvent(type, { bubbles: true });
function holdFor(el, ms) {
  el.dispatchEvent(pointerEvent('pointerdown'));
  vi.advanceTimersByTime(ms);
  el.dispatchEvent(pointerEvent('pointerup'));
}

// requestAnimationFrame은 손으로 돌린다: 어느 문항의 콜백이 언제 떨어지는지를 우리가 정한다.
let rafQueue = [];
let rafHonorsCancel = true;
function stubRaf() {
  rafQueue = [];
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => { id += 1; rafQueue.push({ id, cb }); return id; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((cancelId) => {
    if (rafHonorsCancel) rafQueue = rafQueue.filter(q => q.id !== cancelId);
  }));
}
// 한 프레임: 지금 큐에 있는 콜백을 모두 돌린다. 콜백 안에서 새로 예약한 것은 다음 프레임에 돈다(이중 rAF의 안쪽).
// 콜백이 받는 타임스탬프는 일부러 performance.now()와 다른 값(기본 1234)으로 준다 — 화면이 그 인자를 쓰지 않는다는 것을 가르기 위해서다.
function flushRaf(timestamp = 1234) {
  const batch = rafQueue;
  rafQueue = [];
  for (const { cb } of batch) cb(timestamp);
}
// 자극이 그려질 때까지: 첫 프레임(페인트 전) + 둘째 프레임(첫 프레임이 그려진 뒤)
const flushFrames = (n = 2, timestamp) => { for (let i = 0; i < n; i += 1) flushRaf(timestamp); };

beforeEach(() => {
  vi.useFakeTimers();
  rafHonorsCancel = true;
  stubRaf();
});

afterEach(() => {
  screen?.unmount?.();
  screen = null;
  hooks = null;
  engine = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

// ---- 계획서의 테스트 10개 (그대로) -------------------------------------------------------------
describe('계획서의 테스트', () => {
  test('학생 화면에 문장이 없다', () => {
    mountTask();
    expect(document.querySelector('[data-student-view]').textContent.replace(/\s/g, '')).toMatch(/^[\p{Emoji}\p{So}0-9/]*$/u);
  });

  test('반응 영역이 화면 하단 절반을 차지한다', () => {
    mountTask();
    const el = document.querySelector('[data-response-area]');
    expect(el.dataset.area).toBe('bottom-half');
  });

  test('pointerdown으로 반응을 받고 click은 쓰지 않는다', () => {
    const { engine } = mountTask();
    document.querySelector('[data-response-area]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(engine.input).toHaveBeenCalledTimes(1);
    document.querySelector('[data-response-area]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(engine.input).toHaveBeenCalledTimes(1);
  });

  test('정반응과 참기 성공에 격자 칸이 하나씩 채워진다', () => {
    // 문항 3개 → 격자 2칸(floor(3 × 0.70) = 2). 문항 2개는 1칸뿐이라
    // 두 칸을 채우는 것을 확인할 수 없다.
    mountTask({ trials: [goTrial(0), nogoTrial(1), goTrial(2)] });
    completeTrial({ type: 'go', rtMs: 500 });
    expect(filledCells()).toBe(1);
    completeTrial({ type: 'nogo', rtMs: null });
    expect(filledCells()).toBe(2);
  });

  test('격자 칸 수는 전체 문항의 70%다', () => {
    mountTask({ trials: trialsOf(50) });
    expect(totalCells()).toBe(35);
  });

  test('조급 반응으로 맞춘 Go 문항은 칸을 채우지 않는다', () => {
    mountTask();
    completeTrial({ type: 'go', rtMs: 100 });
    expect(filledCells()).toBe(0);
  });

  test('오반응에 소리나 표시가 나오지 않는다', () => {
    const audio = mountTask().audio;
    completeTrial({ type: 'nogo', rtMs: 300 });
    expect(audio.playCorrect).not.toHaveBeenCalled();
    expect(document.querySelector('[data-error-feedback]')).toBeNull();
  });

  test('격자가 덜 찼어도 종료 애니메이션이 재생된다', () => {
    mountTask({ trials: trialsOf(4) });
    finishWith([go(null), go(null), go(null), go(null)]);
    expect(document.querySelector('[data-completion]')).not.toBeNull();
  });

  test('화면이 가려지면 엔진을 멈추고 복귀하면 재개한다', () => {
    // Review Focus 3
    const { engine } = mountTask();
    fireVisibility('hidden'); expect(engine.pause).toHaveBeenCalled();
    fireVisibility('visible'); expect(engine.resume).toHaveBeenCalled();
  });

  test('중단 조작은 학생이 우연히 누를 수 없는 방식이다', () => {
    const { onAbort } = mountTask();
    const btn = document.querySelector('[data-abort]');
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(onAbort).not.toHaveBeenCalled(); // 길게 눌러야 한다
    holdFor(btn, 1500);
    expect(onAbort).toHaveBeenCalled();
  });
});

// ======================================================================================
// 경계 확인 — 앞선 태스크들에서 일회성으로 확인하고 지나간 것들을 테스트로 남긴다.
// ======================================================================================

describe('칸 수 최소값', () => {
  test('2문항이면 칸은 1칸이다 (최소 1칸)', () => {
    mountTask({ trials: [goTrial(0), nogoTrial(1)] });
    expect(totalCells()).toBe(1);
  });
});

describe('격자 칸이 채워지는 조건', () => {
  const cases = [
    ['Go 정반응', 'go', 500, true],
    ['Go 정반응 (조급 반응 기준과 정확히 같은 값)', 'go', THRESHOLDS.anticipatoryMs, true],
    ['참기 성공 (No-Go에 입력 없음)', 'nogo', null, true],
    ['조급 반응으로 맞춘 Go (기준 바로 아래)', 'go', THRESHOLDS.anticipatoryMs - 1, false],
    ['조급 반응으로 맞춘 Go (0ms)', 'go', 0, false],
    ['Go 누락 (입력 없음)', 'go', null, false],
    ['억제 실패 (No-Go에 입력)', 'nogo', 300, false],
    ['억제 실패 (No-Go에 조급 입력)', 'nogo', 50, false],
  ];

  test.each(cases)('%s → 채움: %s', (_name, type, rtMs, fills) => {
    const { audio } = mountTask();
    completeTrial({ type, rtMs });
    expect(filledCells()).toBe(fills ? 1 : 0);
    // 소리도 칸과 같은 조건에서만 난다. 채우지 않는 경우에는 아무 소리도 나지 않는다.
    expect(audio.playCorrect).toHaveBeenCalledTimes(fills ? 1 : 0);
  });

  test('무효 문항은 칸을 채우지 않는다', () => {
    mountTask();
    hooks.onTrialComplete(response('go', null, { invalid: true }));
    expect(filledCells()).toBe(0);
  });

  test('참기 성공은 정반응과 같은 소리를 쓴다 (소리로 둘이 구분되지 않는다)', () => {
    const { audio } = mountTask();
    completeTrial({ type: 'go', rtMs: 500 });
    completeTrial({ type: 'nogo', rtMs: null });
    expect(audio.playCorrect).toHaveBeenCalledTimes(2);
    expect(audio.playCorrect.mock.calls[0]).toEqual(audio.playCorrect.mock.calls[1]);
  });

  test('칸 수는 어떤 문항 수에서도 rewardCellCount와 같다', () => {
    for (const n of [1, 2, 18, 22, 65, 100]) {
      mountTask({ trials: trialsOf(n) });
      expect(totalCells()).toBe(rewardCellCount(n));
      screen.unmount();
      document.body.replaceChildren();
    }
  });

  test('오반응을 아무리 해도 칸·소리·표시가 하나도 생기지 않는다', () => {
    const { audio } = mountTask({ trials: trialsOf(20) });
    for (let i = 0; i < 20; i += 1) {
      completeTrial({ type: 'nogo', rtMs: 300 + i });
      completeTrial({ type: 'go', rtMs: null });
    }
    expect(filledCells()).toBe(0);
    expect(audio.playCorrect).not.toHaveBeenCalled();
    expect(qs('[data-error-feedback]')).toBeNull();
    expect(qs('[data-completion]')).toBeNull();
  });
});

describe('격자가 가득 찬 뒤', () => {
  test('찬 뒤의 정반응은 칸이 넘치지 않는다', () => {
    mountTask({ trials: trialsOf(4) }); // 4 × 0.7 = 2.8 → 2칸
    expect(totalCells()).toBe(2);
    for (let i = 0; i < 4; i += 1) completeTrial({ type: 'go', rtMs: 500 });
    expect(totalCells()).toBe(2);
    expect(filledCells()).toBe(2);
  });

  test('찬 뒤의 정반응에도 소리는 난다 (맞힌 것이므로)', () => {
    const { audio } = mountTask({ trials: trialsOf(4) });
    for (let i = 0; i < 4; i += 1) completeTrial({ type: 'go', rtMs: 500 });
    expect(audio.playCorrect).toHaveBeenCalledTimes(4);
  });
});

describe('마무리 애니메이션', () => {
  test('칸을 하나도 못 채운 채 끝나도 나온다', () => {
    mountTask({ trials: trialsOf(4) });
    finishWith([go(null), go(null), go(null), go(null)]);
    expect(filledCells()).toBe(0);
    expect(qs('[data-completion]')).not.toBeNull();
  });

  test('오반응만 한 세션도 나온다', () => {
    mountTask({ trials: [goTrial(0), nogoTrial(1), nogoTrial(2)] });
    finishWith([go(null), nogo(300), nogo(400)]);
    expect(qs('[data-completion]')).not.toBeNull();
  });

  test('마무리 그림은 그 테마의 completionGlyph다', () => {
    mountTask({ trials: trialsOf(4), theme: getTheme('weather') });
    finishWith([go(500), go(500), go(500), go(500)]);
    expect(qs('[data-completion]').textContent).toBe(getTheme('weather').completionGlyph);
  });

  test('격자가 마지막 문항 전에 꽉 차도 완성 애니메이션은 나오지 않는다', () => {
    mountTask({ trials: trialsOf(4) }); // 2칸: 두 번째 정반응에서 꽉 찬다
    completeTrial({ type: 'go', rtMs: 500 });
    completeTrial({ type: 'go', rtMs: 500 });
    expect(filledCells()).toBe(totalCells());
    expect(qs('[data-completion]')).toBeNull();
    completeTrial({ type: 'go', rtMs: 500 });
    expect(qs('[data-completion]')).toBeNull();
    vi.advanceTimersByTime(60000);
    expect(qs('[data-completion]')).toBeNull();
  });

  // food(🎂)와 weather(🌈)의 마무리 그림은 그 테마의 자극과 같은 범주라서, 검사 중에 나오면 자극과 혼동된다.
  test.each(THEMES.map(t => [t.id]))('%s: 격자가 꽉 차도 검사 중에는 마무리 그림이 화면 어디에도 없다', (id) => {
    const theme = getTheme(id);
    mountTask({ trials: trialsOf(4), theme });
    hooks.onStimulus(goTrial(0));
    completeTrial({ type: 'go', rtMs: 500 });
    completeTrial({ type: 'go', rtMs: 500 }); // 격자 가득
    expect(filledCells()).toBe(totalCells());
    expect(qs('[data-student-view]').textContent).not.toContain(theme.completionGlyph);
    expect(qs('[data-completion]')).toBeNull();
  });

  // 저장(교사를 위한 자료)은 마무리 애니메이션(학생을 위한 마무리)을 기다리지 않는다.
  // 애니메이션 중에 학생이 탭을 닫아도 회차가 남아야 한다.
  test('엔진이 끝나는 즉시 onFinish가 엔진이 준 배열 그대로 한 번 불린다 (애니메이션 타이머와 무관)', () => {
    const { onFinish, onCompleted } = mountTask({ trials: trialsOf(3) });
    const final = [go(500), go(null), go(500)];
    finishWith(final);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onFinish.mock.calls[0][0]).toBe(final);
    expect(qs('[data-completion]')).not.toBeNull(); // 애니메이션은 아직 재생 중
    expect(onCompleted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(COMPLETION_HOLD_MS * 4);
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  test('마무리 시간이 지난 뒤에야 onCompleted가 한 번 불린다 (화면 이동용)', () => {
    const { onCompleted } = mountTask({ trials: trialsOf(3) });
    finishWith([go(500), go(null), go(500)]);
    vi.advanceTimersByTime(COMPLETION_HOLD_MS - 1);
    expect(onCompleted).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  test('애니메이션 중에 떠나도(탭을 닫아도) onFinish는 이미 불렸고 onCompleted만 불리지 않는다', () => {
    const { onFinish, onCompleted } = mountTask({ trials: trialsOf(2) });
    finishWith([go(500), go(500)]);
    screen.unmount();
    vi.advanceTimersByTime(60000);
    expect(onFinish).toHaveBeenCalledTimes(1);
    expect(onCompleted).not.toHaveBeenCalled();
  });

  test('onFinish(저장)가 던져도 마무리 애니메이션과 화면 이동은 막히지 않는다', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const onCompleted = vi.fn();
    screen = createTaskScreen({ audio: makeAudio(), createEngine: vi.fn((args) => { hooks = args.hooks; return makeEngine(); }) });
    screen.mount(root, {
      trials: trialsOf(2), level: 2, theme: getTheme('animal'),
      onFinish: () => { throw new Error('저장 실패'); }, onAbort: vi.fn(), onCompleted,
    });
    expect(() => finishWith([go(500), go(500)])).toThrow('저장 실패');
    expect(qs('[data-completion]')).not.toBeNull();
    vi.advanceTimersByTime(COMPLETION_HOLD_MS);
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  test('onTrialComplete가 준 스냅샷을 모으지 않는다: onFinish에는 엔진의 최종 배열이 간다', () => {
    const { onFinish } = mountTask({ trials: trialsOf(2) });
    completeTrial({ type: 'go', rtMs: 500 }); // 스냅샷: extraTaps 0
    const final = [{ index: 0, type: 'go', rtMs: 500, extraTaps: 3, invalid: false }, go(null)];
    finishWith(final);
    expect(onFinish.mock.calls[0][0][0].extraTaps).toBe(3);
  });

  test('끝난 뒤에는 중단 버튼이 사라지고, 가려짐에도 엔진을 건드리지 않는다', () => {
    const { engine } = mountTask({ trials: trialsOf(2) });
    finishWith([go(500), go(500)]);
    expect(qs('[data-abort]').hidden).toBe(true);
    fireVisibility('hidden');
    fireVisibility('visible');
    expect(engine.pause).not.toHaveBeenCalled();
    expect(engine.resume).not.toHaveBeenCalled();
  });

  test('마무리 중에 중단 버튼을 눌러도 onAbort가 불리지 않는다', () => {
    const { onAbort } = mountTask({ trials: trialsOf(2) });
    finishWith([go(500), go(500)]);
    holdFor(qs('[data-abort]'), ABORT_HOLD_MS + 500);
    expect(onAbort).not.toHaveBeenCalled();
  });
});

describe('자극 그림', () => {
  test('Go는 테마의 Go 그림, No-Go는 단계에 맞는 No-Go 그림을 보여 준다', () => {
    const theme = getTheme('animal');
    mountTask({ level: 2, theme });
    hooks.onStimulus(goTrial(0));
    expect(stimulusGlyph()).toBe(theme.goGlyph);
    hooks.onStimulus(nogoTrial(1));
    expect(stimulusGlyph()).toBe(theme.crossNoGoGlyph);
  });

  test('3단계의 No-Go는 같은 범주 그림이다', () => {
    const theme = getTheme('animal');
    mountTask({ level: 3, theme });
    hooks.onStimulus(nogoTrial(1));
    expect(stimulusGlyph()).toBe(theme.sameNoGoGlyph);
  });

  test('자극이 끝나면 그림이 사라진다', () => {
    mountTask();
    const t = goTrial(0);
    hooks.onStimulus(t);
    hooks.onStimulusEnd(t);
    expect(stimulusGlyph()).toBe('');
  });

  // 스펙 §7 "소리에 대한 결정": 본 검사의 문항마다 자극 제시음을 넣지 않는다. 자극과 동시에 울리는 소리는 반응을 빠르게 만들고,
  // No-Go 문항에서는 "무언가 일어났다"는 추가 신호가 되어 조급 반응과 억제 실패를 둘 다 늘린다.
  test('자극이 나올 때 소리가 나지 않는다 (Go도 No-Go도, 어느 단계에서도)', () => {
    for (const level of [1, 2, 3]) {
      const { audio } = mountTask({ level });
      hooks.onStimulus(goTrial(0));
      hooks.onStimulus(nogoTrial(1));
      expect(audio.playStimulus, `level ${level}`).not.toHaveBeenCalled();
      expect(audio.playCorrect).not.toHaveBeenCalled(); // 소리는 반응 뒤 보상음뿐이다
      screen.unmount();
    }
  });

  test('보상음(playCorrect)은 그대로 난다: 정반응과 참기 성공에서, 반응 뒤에', () => {
    const { audio } = mountTask();
    hooks.onStimulus(goTrial(0));
    expect(audio.playCorrect).not.toHaveBeenCalled(); // 문항이 뜬 순간에는 아무 소리도 없다
    hooks.onTrialComplete({ index: 0, type: 'go', rtMs: 500, extraTaps: 0, invalid: false });
    hooks.onStimulus(nogoTrial(1));
    hooks.onTrialComplete({ index: 1, type: 'nogo', rtMs: null, extraTaps: 0, invalid: false });
    expect(audio.playCorrect).toHaveBeenCalledTimes(2);
    expect(audio.playStimulus).not.toHaveBeenCalled();
  });
});

describe('엔진에 넘기는 것', () => {
  test('trials, 난이도 파라미터, 네 훅을 넘긴다', () => {
    const trials = trialsOf(5);
    const { createEngine } = mountTask({ trials, level: 3 });
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(engineArgs.trials).toBe(trials);
    expect(engineArgs.levelParams).toEqual(LEVELS[3]);
    for (const name of ['onStimulus', 'onStimulusEnd', 'onTrialComplete', 'onFinish']) {
      expect(typeof engineArgs.hooks[name]).toBe('function');
    }
  });

  test('시계는 performance.now() 기준이고, 메서드를 떼어 써도 동작한다', () => {
    mountTask();
    const { clock } = engineArgs;
    expect(Math.abs(clock.now() - performance.now())).toBeLessThan(5);
    // Date.now() 기준이면 epoch ms(수천억)가 나와 event.timeStamp와 어긋나 모든 문항이 누락이 된다.
    expect(clock.now()).toBeLessThan(Date.now() / 2);
    const { setTimeout: set, clearTimeout: clear } = clock; // this가 없어도 "Illegal invocation"이 나지 않는다
    const fn = vi.fn();
    const id = set(fn, 10);
    vi.advanceTimersByTime(10);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(() => clear(id)).not.toThrow();
  });

  test('알 수 없는 난이도면 던진다', () => {
    expect(() => mountTask({ level: 9 })).toThrow();
  });

  test('시작하면 한 간격(interTrialMs) 빈 화면을 둔 뒤 엔진을 시작한다', () => {
    const { engine } = mountTask({ level: 2 });
    expect(engine.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LEVELS[2].interTrialMs - 1);
    expect(engine.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(engine.start).toHaveBeenCalledTimes(1);
  });
});

describe('반응 입력', () => {
  test('engine.input에는 이벤트가 일어난 시각(event.timeStamp)을 넘긴다', () => {
    const { engine } = mountTask();
    const ev = new PointerEvent('pointerdown', { bubbles: true });
    Object.defineProperty(ev, 'timeStamp', { value: 4321.5 });
    responseArea().dispatchEvent(ev);
    expect(engine.input).toHaveBeenCalledWith(4321.5);
  });

  test('click·mousedown·touchstart·pointerup으로는 반응을 받지 않는다', () => {
    const { engine } = mountTask();
    for (const type of ['click', 'mousedown', 'touchstart', 'pointerup', 'mouseup', 'touchend']) {
      responseArea().dispatchEvent(new Event(type, { bubbles: true }));
    }
    expect(engine.input).not.toHaveBeenCalled();
  });

  test('반응 영역 밖(자극·격자·중단 버튼)을 눌러도 반응이 아니다', () => {
    const { engine } = mountTask();
    for (const sel of ['[data-stimulus]', '[data-grid]', '[data-abort]']) {
      qs(sel).dispatchEvent(pointerEvent('pointerdown'));
    }
    expect(engine.input).not.toHaveBeenCalled();
  });

  test('영역 순서: 자극, 격자, 반응. 중단 버튼은 반응 영역 안에 없다', () => {
    mountTask();
    const order = [qs('[data-stimulus]'), qs('[data-grid]'), responseArea()];
    expect(order[0].compareDocumentPosition(order[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(order[1].compareDocumentPosition(order[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(responseArea().contains(qs('[data-abort]'))).toBe(false);
    expect(qs('[data-grid]').querySelectorAll('[data-cell]').length).toBeGreaterThan(0);
  });

  test('학생 화면 코드는 click 이벤트를 쓰지 않고 element.animate()(WAAPI)도 쓰지 않는다', () => {
    const stripComments = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const file of ['js/screens/trialRunner.js', 'js/screens/task.js']) {
      const code = stripComments(read(file));
      expect(code, file).not.toMatch(/['"]click['"]/);
      expect(code, file).not.toMatch(/\.animate\(/);
    }
    // 연습 화면의 교사 패널 버튼은 click이지만(스크롤하는 교사 화면), WAAPI는 여기도 쓰지 않는다.
    expect(stripComments(read('js/screens/practiceScreen.js'))).not.toMatch(/\.animate\(/);
  });
});

describe('화면이 가려질 때 (visibilitychange)', () => {
  test('가려지면 떠 있던 자극을 화면이 스스로 치운다 (pause는 훅을 부르지 않는다)', () => {
    const { engine } = mountTask();
    hooks.onStimulus(goTrial(0));
    expect(stimulusGlyph()).not.toBe('');
    fireVisibility('hidden');
    expect(stimulusGlyph()).toBe('');
    expect(engine.pause).toHaveBeenCalledTimes(1);
  });

  test('여러 번 반복되어도 짝이 맞는다: 가림·복귀 3회 = pause 3, resume 3', () => {
    const { engine } = mountTask();
    for (let i = 0; i < 3; i += 1) {
      fireVisibility('hidden');
      fireVisibility('visible');
    }
    expect(engine.pause).toHaveBeenCalledTimes(3);
    expect(engine.resume).toHaveBeenCalledTimes(3);
  });

  test('가림이 연달아 와도 pause는 한 번, 복귀가 연달아 와도 resume은 한 번이다', () => {
    const { engine } = mountTask();
    fireVisibility('hidden');
    fireVisibility('hidden');
    fireVisibility('visible');
    fireVisibility('visible');
    expect(engine.pause).toHaveBeenCalledTimes(1);
    expect(engine.resume).toHaveBeenCalledTimes(1);
  });

  test('가려진 적 없이 visible이 와도 resume하지 않는다', () => {
    const { engine } = mountTask();
    fireVisibility('visible');
    expect(engine.resume).not.toHaveBeenCalled();
  });

  test('첫 자극을 기다리는 중에 가려지면 가려진 동안 시작하지 않고, 돌아오면 처음부터 다시 기다린다', () => {
    const { engine } = mountTask({ level: 2 });
    vi.advanceTimersByTime(LEVELS[2].interTrialMs - 100);
    fireVisibility('hidden');
    vi.advanceTimersByTime(60000);
    expect(engine.start).not.toHaveBeenCalled();
    fireVisibility('visible');
    vi.advanceTimersByTime(LEVELS[2].interTrialMs - 1);
    expect(engine.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  test('가려졌다 돌아온 뒤에도 입력과 보상이 그대로 동작한다', () => {
    const { engine } = mountTask();
    fireVisibility('hidden');
    fireVisibility('visible');
    responseArea().dispatchEvent(pointerEvent('pointerdown'));
    completeTrial({ type: 'go', rtMs: 500 });
    expect(engine.input).toHaveBeenCalledTimes(1);
    expect(filledCells()).toBe(1);
  });
});

describe('markStimulusRendered와 rAF 신원 (이중 rAF)', () => {
  // 단일 rAF의 콜백은 페인트 전에 돈다(타임스탬프는 프레임 시작 시각). 반응시간의 기준은 "자극이 실제로 그려진 시각"이므로
  // 이중 rAF를 쓴다: 둘째 콜백은 첫 프레임이 그려진 뒤에 돌고, 거기서 performance.now()를 읽어 알린다.
  test('이중 rAF: 첫 프레임에서는 알리지 않고, 둘째 프레임에서 performance.now()로 한 번 알린다', () => {
    const { engine } = mountTask();
    const now = vi.spyOn(performance, 'now').mockReturnValue(5000);
    hooks.onStimulus(goTrial(0));
    flushRaf(2222);
    expect(engine.markStimulusRendered).not.toHaveBeenCalled(); // 첫 프레임은 아직 페인트 전
    now.mockReturnValue(5017);
    flushRaf(3333);
    expect(engine.markStimulusRendered).toHaveBeenCalledTimes(1);
    expect(engine.markStimulusRendered).toHaveBeenCalledWith(5017); // rAF 인자(2222/3333)가 아니라 콜백 안의 now
    now.mockRestore();
  });

  test('그 뒤 프레임이 더 와도 다시 알리지 않는다', () => {
    const { engine } = mountTask();
    hooks.onStimulus(goTrial(0));
    flushFrames(6);
    expect(engine.markStimulusRendered).toHaveBeenCalledTimes(1);
  });

  test('문항이 바뀌면 안쪽·바깥쪽 보류 rAF를 모두 취소한다', () => {
    const { engine } = mountTask();
    hooks.onStimulus(goTrial(0));
    flushRaf(); // 바깥 실행 → 안쪽이 예약됨
    const innerId = cancelAnimationFrame.mock.calls.length; // 호출 수만 기억
    hooks.onStimulus(goTrial(1));
    expect(cancelAnimationFrame.mock.calls.length).toBe(innerId + 1); // 안쪽 핸들을 취소했다
    flushFrames(2);
    expect(engine.markStimulusRendered).toHaveBeenCalledTimes(1); // 문항 1의 것 하나뿐
  });

  test('바깥 콜백이 돌기 전에 문항이 바뀌면 바깥 핸들을 취소한다', () => {
    const { engine } = mountTask();
    hooks.onStimulus(goTrial(0));
    hooks.onStimulus(goTrial(1));
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1); // 둘째 표시가 첫 표시의 보류 핸들 하나를 취소한다
    flushFrames(2);
    expect(engine.markStimulusRendered).toHaveBeenCalledTimes(1);
  });

  test('취소가 먹지 않아도(이미 큐에 있는 콜백) 묵은 바깥 콜백은 안쪽을 예약하지 않는다', () => {
    rafHonorsCancel = false;
    const { engine } = mountTask();
    hooks.onStimulus(goTrial(0));
    hooks.onStimulus(goTrial(1));
    flushFrames(3);
    expect(engine.markStimulusRendered).toHaveBeenCalledTimes(1);
  });

  test('취소가 먹지 않아도 묵은 안쪽 콜백은 알리지 않는다', () => {
    rafHonorsCancel = false;
    const { engine } = mountTask();
    hooks.onStimulus(goTrial(0));
    flushRaf(); // 문항 0의 안쪽이 큐에 있다
    hooks.onStimulus(goTrial(1)); // 취소가 안 먹는다
    flushFrames(3);
    expect(engine.markStimulusRendered).toHaveBeenCalledTimes(1); // 문항 1의 것뿐
  });

  // 묵은 콜백이 지금 문항의 핸들(rafId)을 덮어쓰거나 지우면, 나중에 그 핸들을 취소하지 못해 묵은 콜백이 살아남는다.
  // 콜백이 도는 순서는 브라우저가 정하므로, 지금 문항의 콜백이 먼저 돌고 묵은 콜백이 뒤에 도는 순서를 만든다.
  function flushReversed() {
    const batch = rafQueue;
    rafQueue = [];
    for (const { cb } of [...batch].reverse()) cb(1234);
  }

  test('뒤늦게 도는 묵은 바깥 콜백은 지금 문항의 핸들을 덮어쓰지 않고 안쪽을 예약하지도 않는다', () => {
    rafHonorsCancel = false;
    mountTask();
    hooks.onStimulus(goTrial(0));
    hooks.onStimulus(goTrial(1));
    flushReversed(); // 문항 1의 바깥이 먼저, 묵은 문항 0의 바깥이 나중에
    expect(rafQueue).toHaveLength(1); // 문항 1의 안쪽 하나뿐
    const liveId = rafQueue[0].id;
    cancelAnimationFrame.mockClear();
    hooks.onStimulusEnd(goTrial(1));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(liveId);
  });

  test('뒤늦게 도는 묵은 안쪽 콜백은 지금 문항의 핸들을 지우지 않는다', () => {
    rafHonorsCancel = false;
    mountTask();
    hooks.onStimulus(goTrial(0));
    flushRaf(); // 문항 0의 안쪽이 큐에 있다
    hooks.onStimulus(goTrial(1)); // 취소가 안 먹는다
    flushReversed(); // 문항 1의 바깥이 먼저, 묵은 문항 0의 안쪽이 나중에
    expect(rafQueue).toHaveLength(1);
    const liveId = rafQueue[0].id;
    cancelAnimationFrame.mockClear();
    hooks.onStimulusEnd(goTrial(1));
    expect(cancelAnimationFrame).toHaveBeenCalledWith(liveId);
  });

  test('자극이 끝난 뒤(바깥만 돈 상태·돌기 전 모두)에는 알리지 않는다', () => {
    for (const honors of [true, false]) {
      rafHonorsCancel = honors;
      const { engine } = mountTask();
      const t = goTrial(0);
      hooks.onStimulus(t);
      flushRaf();
      hooks.onStimulusEnd(t);
      flushFrames(3);
      expect(engine.markStimulusRendered).not.toHaveBeenCalled();
      screen.unmount();
      document.body.replaceChildren();
    }
  });

  test('같은 문항 객체가 다시 나와도 앞선 표시의 콜백은 알리지 않는다', () => {
    rafHonorsCancel = false;
    const { engine } = mountTask();
    const t = goTrial(0);
    hooks.onStimulus(t);
    hooks.onStimulus(t);
    flushFrames(3);
    expect(engine.markStimulusRendered).toHaveBeenCalledTimes(1);
  });

  test('가려졌다 돌아온 뒤에는 묵은 콜백이 알리지 않는다 (두 프레임 사이에 가려져도)', () => {
    rafHonorsCancel = false;
    const { engine } = mountTask();
    hooks.onStimulus(goTrial(0));
    flushRaf(); // 바깥만 실행
    fireVisibility('hidden');
    fireVisibility('visible');
    flushFrames(3);
    expect(engine.markStimulusRendered).not.toHaveBeenCalled();
  });

  test('두 프레임 사이에 떠나면(unmount) 알리지 않고 핸들을 취소한다', () => {
    rafHonorsCancel = false;
    const { engine } = mountTask();
    hooks.onStimulus(goTrial(0));
    flushRaf();
    screen.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    flushFrames(3);
    expect(engine.markStimulusRendered).not.toHaveBeenCalled();
  });
});

describe('중단 버튼', () => {
  test('1초 넘게 길게 눌러야 하고 그 전에는 아니다 (999ms 아니오, 1000ms 예)', () => {
    expect(ABORT_HOLD_MS).toBeGreaterThanOrEqual(1000);
    const first = mountTask();
    const btn = qs('[data-abort]');
    btn.dispatchEvent(pointerEvent('pointerdown'));
    vi.advanceTimersByTime(ABORT_HOLD_MS - 1);
    expect(first.onAbort).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(first.onAbort).toHaveBeenCalledTimes(1);
  });

  test('짧게 누르고 떼면 아무 일도 없다 (이후 시간이 지나도)', () => {
    const { onAbort, engine } = mountTask();
    holdFor(qs('[data-abort]'), 300);
    vi.advanceTimersByTime(10000);
    expect(onAbort).not.toHaveBeenCalled();
    expect(engine.abort).not.toHaveBeenCalled();
  });

  test.each(['pointerup', 'pointercancel', 'pointerleave'])('%s로 손가락이 떨어지면 누름이 취소된다', (type) => {
    const { onAbort } = mountTask();
    const btn = qs('[data-abort]');
    btn.dispatchEvent(pointerEvent('pointerdown'));
    vi.advanceTimersByTime(ABORT_HOLD_MS - 100);
    btn.dispatchEvent(pointerEvent(type));
    vi.advanceTimersByTime(10000);
    expect(onAbort).not.toHaveBeenCalled();
  });

  test('누르는 동안은 눌림 표시가 있고, 떼면 없어진다', () => {
    mountTask();
    const btn = qs('[data-abort]');
    btn.dispatchEvent(pointerEvent('pointerdown'));
    expect(btn.dataset.holding).toBe('true');
    btn.dispatchEvent(pointerEvent('pointerup'));
    expect(btn.dataset.holding).toBeUndefined();
  });

  test('떼지 않고 다시 눌러도 처음부터 세고, onAbort는 한 번만 불린다', () => {
    const { onAbort } = mountTask();
    const btn = qs('[data-abort]');
    btn.dispatchEvent(pointerEvent('pointerdown'));
    vi.advanceTimersByTime(800);
    btn.dispatchEvent(pointerEvent('pointerdown')); // 다시 눌림: 0부터
    vi.advanceTimersByTime(ABORT_HOLD_MS - 1);
    expect(onAbort).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onAbort).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(onAbort).toHaveBeenCalledTimes(1);
  });

  test('click만으로는 동작하지 않는다', () => {
    const { onAbort } = mountTask();
    qs('[data-abort]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    vi.advanceTimersByTime(10000);
    expect(onAbort).not.toHaveBeenCalled();
  });

  test('반응 영역을 오래 누르고 있어도 중단되지 않는다', () => {
    const { onAbort, engine } = mountTask();
    responseArea().dispatchEvent(pointerEvent('pointerdown'));
    vi.advanceTimersByTime(10000);
    responseArea().dispatchEvent(pointerEvent('pointerup'));
    expect(onAbort).not.toHaveBeenCalled();
    expect(engine.abort).not.toHaveBeenCalled();
  });

  test('반응 영역 탭이 중단 버튼 누름을 시작하지 않는다', () => {
    mountTask();
    responseArea().dispatchEvent(pointerEvent('pointerdown'));
    expect(qs('[data-abort]').dataset.holding).toBeUndefined();
  });

  test('중단 버튼 누름은 반응으로 세지 않는다', () => {
    const { engine } = mountTask();
    holdFor(qs('[data-abort]'), 500);
    expect(engine.input).not.toHaveBeenCalled();
  });

  test('중단하면 엔진을 멈추고, 자극을 치우고, 그때까지의 기록을 넘긴다', () => {
    const { engine, onAbort } = mountTask();
    const partial = [go(500)];
    engine.responses.mockReturnValue(partial);
    hooks.onStimulus(goTrial(1));
    holdFor(qs('[data-abort]'), ABORT_HOLD_MS);
    expect(engine.abort).toHaveBeenCalledTimes(1);
    expect(stimulusGlyph()).toBe('');
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort.mock.calls[0][0]).toBe(partial);
  });

  test('중단하면 마무리 애니메이션이 나오지 않고 onFinish·onCompleted도 불리지 않는다', () => {
    const { onFinish, onCompleted } = mountTask();
    holdFor(qs('[data-abort]'), ABORT_HOLD_MS);
    vi.advanceTimersByTime(60000);
    expect(qs('[data-completion]')).toBeNull();
    expect(onFinish).not.toHaveBeenCalled();
    expect(onCompleted).not.toHaveBeenCalled();
  });

  test('중단 뒤 대기 중이던 시작은 일어나지 않는다', () => {
    const { engine } = mountTask();
    holdFor(qs('[data-abort]'), ABORT_HOLD_MS);
    vi.advanceTimersByTime(60000);
    expect(engine.start).not.toHaveBeenCalled();
  });

  test('버튼은 글 없이 아이콘이고, 이름은 보조기기용 속성에만 있다', () => {
    mountTask();
    const btn = qs('[data-abort]');
    expect(btn.textContent.trim()).toMatch(/^[\p{Emoji}\p{So}]+$/u);
    expect(btn.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('전체화면', () => {
  afterEach(() => {
    delete document.documentElement.requestFullscreen;
    delete document.exitFullscreen;
    delete document.fullscreenElement;
  });

  test('시작할 때 전체화면을 요청한다', () => {
    document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());
    mountTask();
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  });

  test('거부되어도(promise reject) 그대로 진행한다', async () => {
    document.documentElement.requestFullscreen = vi.fn(() => Promise.reject(new Error('denied')));
    const { engine } = mountTask();
    await Promise.resolve();
    vi.advanceTimersByTime(LEVELS[2].interTrialMs);
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  test('요청이 동기로 던져도 그대로 진행한다', () => {
    document.documentElement.requestFullscreen = vi.fn(() => { throw new Error('not allowed'); });
    let mounted;
    expect(() => { mounted = mountTask(); }).not.toThrow();
    vi.advanceTimersByTime(LEVELS[2].interTrialMs);
    expect(mounted.engine.start).toHaveBeenCalledTimes(1);
  });

  test('전체화면 API가 없는 브라우저(iPhone Safari 등)에서도 진행한다', () => {
    expect(document.documentElement.requestFullscreen).toBeUndefined();
    const { engine } = mountTask();
    vi.advanceTimersByTime(LEVELS[2].interTrialMs);
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  test('화면을 떠날 때 전체화면이면 닫는다', () => {
    document.exitFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    mountTask();
    screen.unmount();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe('unmount가 모든 것을 거둔다', () => {
  test('엔진을 중단하고, 남은 타이머가 없다', () => {
    const { engine } = mountTask();
    screen.unmount();
    expect(engine.abort).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('대기 중이던 시작이 일어나지 않는다', () => {
    const { engine } = mountTask();
    screen.unmount();
    vi.advanceTimersByTime(60000);
    expect(engine.start).not.toHaveBeenCalled();
  });

  test('누르는 중이던 중단은 일어나지 않는다', () => {
    const { onAbort } = mountTask();
    qs('[data-abort]').dispatchEvent(pointerEvent('pointerdown'));
    screen.unmount();
    vi.advanceTimersByTime(60000);
    expect(onAbort).not.toHaveBeenCalled();
  });

  test('마무리 애니메이션 중에 떠나면 onCompleted가 불리지 않고 타이머가 남지 않는다', () => {
    const { onCompleted } = mountTask({ trials: trialsOf(2) });
    finishWith([go(500), go(500)]);
    screen.unmount();
    vi.advanceTimersByTime(60000);
    expect(onCompleted).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('반응 리스너와 visibilitychange 리스너를 거둔다', () => {
    const { engine } = mountTask();
    const area = responseArea();
    screen.unmount();
    area.dispatchEvent(pointerEvent('pointerdown'));
    fireVisibility('hidden');
    fireVisibility('visible');
    expect(engine.input).not.toHaveBeenCalled();
    expect(engine.pause).not.toHaveBeenCalled();
    expect(engine.resume).not.toHaveBeenCalled();
  });

  test('보류 중인 rAF를 취소하고, 취소가 안 먹어도 알리지 않는다', () => {
    rafHonorsCancel = false;
    const { engine } = mountTask();
    hooks.onStimulus(goTrial(0));
    screen.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    flushFrames(2);
    expect(engine.markStimulusRendered).not.toHaveBeenCalled();
  });

  test('두 번 불러도 안전하다', () => {
    mountTask();
    screen.unmount();
    expect(() => screen.unmount()).not.toThrow();
  });

  test('다시 mount하면 이전 마운트를 거둔다 (엔진 두 개가 동시에 돌지 않는다)', () => {
    const first = mountTask();
    const firstEngine = first.engine;
    const root2 = document.createElement('div');
    document.body.append(root2);
    screen.mount(root2, { trials: trialsOf(3), level: 2, theme: getTheme('animal'), onFinish: vi.fn(), onAbort: vi.fn() });
    expect(firstEngine.abort).toHaveBeenCalled();
    fireVisibility('hidden');
    expect(firstEngine.pause).not.toHaveBeenCalled();
  });
});

describe('채워지는 연출 (CSS)', () => {
  const css = read('css/app.css');
  const ruleBody = (selector) => {
    const start = css.indexOf(selector);
    return start === -1 ? null : css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start));
  };

  test('300ms 이내이고 칸 안에서만 움직인다', () => {
    const body = ruleBody('.grid-cell.is-new {');
    expect(body).not.toBeNull();
    const ms = Number(body.match(/animation:\s*cell-fill\s+(\d+)ms/)[1]);
    expect(ms).toBeLessThanOrEqual(300);
    expect(ruleBody('.grid-cell {')).toMatch(/overflow:\s*hidden/);
    expect(ruleBody('.test-strip {')).toMatch(/overflow:\s*hidden/);
    expect(body).not.toMatch(/position:\s*(?:absolute|fixed)/);
  });

  // !important로 애니메이션 길이를 0.01ms로 줄이면 인라인 animation-duration도 덮인다. 그러면 길게 누르는 순간 채움 막대가 즉시 가득 차
  // "완료된 것처럼" 보이고, 카운트다운 막대는 시작하자마자 끝난 것처럼 보인다. 그때는 채움 막대를 아예 그리지 않는다.
  test('애니메이션 줄이기(OS·수동 둘 다)에서는 길게 누르기·카운트다운의 채움 막대를 그리지 않는다', () => {
    const flat = css.replace(/\s+/g, ' ');
    expect(flat).toContain('@media (prefers-reduced-motion: reduce) { .abort-btn[data-holding]::after, .countdown::after { display: none; } }');
    expect(flat).toContain('html[data-reduced-motion="true"] .abort-btn[data-holding]::after, html[data-reduced-motion="true"] .countdown::after { display: none; }');
    // 막대 없이도 누르는 중임이 보이게 테두리를 굵게 한다
    expect(ruleBody('.abort-btn[data-holding] {')).toMatch(/border-width/);
  });

  test('끝난 뒤 중단 버튼이 정말 사라진다: display 규칙이 hidden 속성을 이기지 않는다', () => {
    expect(ruleBody('.abort-btn[hidden] {')).toMatch(/display:\s*none/);
  });

  test('채운 칸은 그림이 있고 빈 칸은 동그라미다 — 색이 아니라 모양으로 구분된다', () => {
    mountTask({ trials: trialsOf(10) });
    completeTrial({ type: 'go', rtMs: 500 });
    const cells = qsa('[data-cell]');
    expect(cells[0].textContent).toBe(getTheme('animal').itemGlyph);
    expect(cells[1].textContent).toBe('');
    expect(css).toMatch(/\.grid-cell\[data-filled="true"\]::before\s*\{\s*display:\s*none/);
  });

  test('격자 배치: 어떤 칸 수도 줄×칸에 다 들어가고 줄은 4 이하다', () => {
    for (let n = 1; n <= 70; n += 1) {
      const { rows, cols } = gridLayout(n);
      expect(rows * cols).toBeGreaterThanOrEqual(n);
      expect(rows).toBeGreaterThanOrEqual(1);
      expect(rows).toBeLessThanOrEqual(4);
    }
    expect(gridLayout(35).rows).toBeGreaterThan(1);
  });
});

// ======================================================================================
// 진짜 엔진 + 가짜 타이머 시계로 이어 붙인 시험 — 시계 기준과 응답 배열의 출처를 직접 확인한다.
// ======================================================================================

describe('진짜 엔진', () => {
  beforeEach(() => {
    vi.useRealTimers();
    // performance.now도 함께 가짜로 돌려야 한다: 엔진의 시계(performance.now)와 입력 시각(event.timeStamp)이 같은 축에 있어야 한다.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
  });

  function tapAtNow() {
    const ev = new PointerEvent('pointerdown', { bubbles: true });
    Object.defineProperty(ev, 'timeStamp', { value: performance.now() });
    responseArea().dispatchEvent(ev);
  }

  function runRealSession() {
    const audio = makeAudio();
    const root = document.createElement('div');
    document.body.append(root);
    const onFinish = vi.fn();
    screen = createTaskScreen({ audio, createEngine: realCreateEngine });
    screen.mount(root, {
      trials: [goTrial(0), goTrial(1), nogoTrial(2)], level: 2, theme: getTheme('animal'), onFinish, onAbort: vi.fn(),
    });
    return { audio, onFinish };
  }

  test('event.timeStamp(performance.now 기준)로 반응이 기록된다 — 모든 문항이 누락이 되지 않는다', () => {
    const { audio, onFinish } = runRealSession();
    vi.advanceTimersByTime(LEVELS[2].interTrialMs); // 첫 자극 시작
    expect(stimulusGlyph()).toBe(getTheme('animal').goGlyph);
    flushRaf(); // 첫 프레임(페인트 전)
    vi.advanceTimersByTime(16); // 한 프레임 뒤
    flushRaf(); // 둘째 프레임: 이 시각(startedAt + 16)이 렌더 마크가 된다
    vi.advanceTimersByTime(500);
    tapAtNow(); // 그려진 뒤 500ms (자극 요청 뒤로는 516ms)
    expect(stimulusGlyph()).toBe(''); // 반응하면 자극이 바로 사라진다
    expect(filledCells()).toBe(1);
    expect(audio.playCorrect).toHaveBeenCalledTimes(1);

    // 연타: 첫 반응 뒤 다음 문항 전까지의 탭은 그 문항의 extraTaps다.
    vi.advanceTimersByTime(100); tapAtNow();
    vi.advanceTimersByTime(100); tapAtNow();

    vi.advanceTimersByTime(60000); // 나머지 문항(무반응)을 지나 끝까지 — 마무리 시간은 기다리지 않아도 onFinish가 이미 불렸다

    expect(onFinish).toHaveBeenCalledTimes(1);
    const responses = onFinish.mock.calls[0][0];
    expect(responses).toHaveLength(3);
    // 렌더 마크가 효과를 낸다: 자극을 요청한 시각(startedAt)부터 재면 516이다. 그려진 시각부터 재므로 500.
    expect(responses[0].rtMs).toBeCloseTo(500, 0);
    expect(responses[0].extraTaps).toBe(2); // onTrialComplete의 스냅샷은 0이었다 — 최종 배열을 넘겼다는 증거
    expect(responses[1]).toMatchObject({ type: 'go', rtMs: null });
    expect(responses[2]).toMatchObject({ type: 'nogo', rtMs: null });
    expect(filledCells()).toBe(2); // 정반응 + 참기 성공. Go 누락은 채우지 않는다
  });

  test('아무것도 누르지 않고 끝나도 마무리 그림이 나온다 (칸은 참기 성공 하나뿐)', () => {
    runRealSession();
    vi.advanceTimersByTime(120000);
    expect(qs('[data-completion]')).not.toBeNull();
    expect(filledCells()).toBe(1); // 참기 성공 한 칸뿐 (Go 둘은 누락)
    expect(totalCells()).toBe(2);
  });

  test('중단하면 진행 중이던 문항은 무효로 남고 자극이 사라진다', () => {
    const root = document.createElement('div');
    document.body.append(root);
    const onAbort = vi.fn();
    screen = createTaskScreen({ audio: makeAudio(), createEngine: realCreateEngine });
    screen.mount(root, { trials: trialsOf(5), level: 2, theme: getTheme('animal'), onFinish: vi.fn(), onAbort });
    vi.advanceTimersByTime(LEVELS[2].interTrialMs); // 첫 문항 자극 중
    expect(stimulusGlyph()).not.toBe('');
    holdFor(qs('[data-abort]'), ABORT_HOLD_MS);
    expect(stimulusGlyph()).toBe('');
    expect(onAbort).toHaveBeenCalledTimes(1);
    expect(onAbort.mock.calls[0][0]).toEqual([{ index: 0, type: 'go', rtMs: null, extraTaps: 0, invalid: true }]);
  });

  test('화면이 가려졌다 돌아오면 진행 중이던 문항은 무효가 되고 다음 문항부터 다시 간다', () => {
    const { onFinish } = runRealSession();
    vi.advanceTimersByTime(LEVELS[2].interTrialMs); // 첫 문항 자극 중
    fireVisibility('hidden');
    expect(stimulusGlyph()).toBe('');
    vi.advanceTimersByTime(30000); // 가려진 동안 아무 일도 없다
    expect(onFinish).not.toHaveBeenCalled();
    fireVisibility('visible');
    vi.advanceTimersByTime(120000);
    const responses = onFinish.mock.calls[0][0];
    expect(responses[0]).toMatchObject({ index: 0, invalid: true, rtMs: null });
    expect(responses).toHaveLength(3);
  });
});
