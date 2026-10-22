// @vitest-environment jsdom
// 연습 화면. 시범(글 없음) → 8문항 → 추천/재시도/중단. 엔진은 가짜로 바꿔 훅을 손으로 돌린다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import './helpers/pointerEvent.js';
import { LEVELS, PRACTICE, THRESHOLDS } from '../js/config.js';
import { getTheme, rewardCellCount } from '../js/themes.js';
import { HOLD_MS } from '../js/screens/trialRunner.js';
import { createPracticeScreen, buildPracticeTrials, summarizePractice, DEMO } from '../js/screens/practiceScreen.js';

const read = rel => readFileSync(resolve(process.cwd(), rel), 'utf8');

// ---- 하네스 ------------------------------------------------------------------------------
const makeAudio = () => ({ unlock: vi.fn(), playCorrect: vi.fn(), playStimulus: vi.fn(), setEnabled: vi.fn() });
const makeEngine = () => ({
  start: vi.fn(), input: vi.fn(), markStimulusRendered: vi.fn(),
  pause: vi.fn(), resume: vi.fn(), abort: vi.fn(), responses: vi.fn(() => []),
});

let screen = null;
let engine = null;
let hooks = null;
let engineArgs = null;

function mountPractice({ attempt, theme = getTheme('animal'), audio = makeAudio() } = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onDone = vi.fn();
  const createEngine = vi.fn((args) => {
    engineArgs = args;
    hooks = args.hooks;
    engine = makeEngine();
    return engine;
  });
  screen = createPracticeScreen({ audio, createEngine });
  screen.mount(root, { theme, attempt, onDone });
  return { root, audio, onDone, createEngine, theme };
}

const qs = sel => document.querySelector(sel);
const qsa = sel => [...document.querySelectorAll(sel)];
const filledCells = () => qsa('[data-cell][data-filled="true"]').length;
const totalCells = () => qsa('[data-cell]').length;
const stimulusGlyph = () => qs('[data-stimulus]')?.textContent ?? '';
const responseArea = () => qs('[data-response-area]');
const studentText = () => (qs('[data-student-view]')?.textContent ?? '').replace(/\s/g, '');
const EMOJI_ONLY = /^[\p{Emoji}\p{So}0-9/]*$/u;
const pointerEvent = type => new PointerEvent(type, { bubbles: true });
const click = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

// 시범이 끝나는 시각(ms): 시범 항목마다 (그림이 뜨고 → 버튼/참기 → 간격)
const demoDuration = () => DEMO.leadMs + DEMO.items.reduce(
  (sum, type) => sum + (type === 'go' ? DEMO.goPressAfterMs + DEMO.pressHoldMs : DEMO.nogoHoldMs) + DEMO.gapMs,
  0,
);

const run = (type, rtMs, extra = {}) => ({ index: 0, type, rtMs, extraTaps: 0, invalid: false, ...extra });
const goHit = (rt = 500) => run('go', rt);
const goMiss = () => run('go', null);
const nogoOk = () => run('nogo', null);
const nogoBad = () => run('nogo', 300);

// 8문항 응답: Go 5 / No-Go 3. hits개를 맞히고(나머지 누락), rejections개를 참는다(나머지 억제 실패).
function responsesFor({ hits, rejections, rt = 500 }) {
  return [
    ...Array.from({ length: PRACTICE.go }, (_, i) => (i < hits ? goHit(rt) : goMiss())),
    ...Array.from({ length: PRACTICE.noGo }, (_, i) => (i < rejections ? nogoOk() : nogoBad())),
  ].map((r, index) => ({ ...r, index }));
}

// 시범을 지나 8문항을 돌릴 수 있는 상태로 만든다.
function skipDemo() {
  vi.advanceTimersByTime(demoDuration());
}

function finishPractice(responses) {
  skipDemo();
  hooks.onFinish(responses);
}

let rafQueue = [];
beforeEach(() => {
  vi.useFakeTimers();
  rafQueue = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((cb) => { rafQueue.push(cb); return rafQueue.length; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

afterEach(() => {
  screen?.unmount?.();
  screen = engine = hooks = engineArgs = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete document.documentElement.requestFullscreen;
  delete document.exitFullscreen;
  delete document.fullscreenElement;
});

// ---- 시범 ----------------------------------------------------------------------------------
describe('규칙 시범 (글 없음)', () => {
  test('시범이 끝날 때까지 엔진을 만들지 않고, 학생 화면에는 문장이 없다', () => {
    const { createEngine } = mountPractice();
    for (let t = 0; t < demoDuration(); t += 100) {
      expect(studentText(), `t=${t}`).toMatch(EMOJI_ONLY);
      vi.advanceTimersByTime(100);
    }
    expect(createEngine).toHaveBeenCalledTimes(1); // 시범이 끝난 바로 그때 만든다
    expect(studentText()).toMatch(EMOJI_ONLY);
  });

  test('처음에는 아무 그림도 없고 격자는 비어 있다', () => {
    mountPractice();
    expect(stimulusGlyph()).toBe('');
    expect(filledCells()).toBe(0);
    expect(totalCells()).toBe(rewardCellCount(PRACTICE.go + PRACTICE.noGo));
  });

  test('Go 시범: 그림이 나오고 → 버튼이 스스로 눌리고 → 소리와 함께 칸이 채워진다', () => {
    const theme = getTheme('animal');
    const { audio } = mountPractice({ theme });
    vi.advanceTimersByTime(DEMO.leadMs);
    expect(stimulusGlyph()).toBe(theme.goGlyph);
    expect(audio.playStimulus).toHaveBeenCalledTimes(1);
    expect(responseArea().dataset.demo).toBeUndefined(); // 아직 안 눌렸다
    expect(audio.playCorrect).not.toHaveBeenCalled();

    vi.advanceTimersByTime(DEMO.goPressAfterMs);
    expect(responseArea().dataset.demo).toBe('press'); // 버튼이 스스로 눌린다
    expect(qs('[data-demo-hand]')).not.toBeNull();     // 짚는 손가락 그림
    expect(stimulusGlyph()).toBe('');                  // 그림이 사라진다
    expect(audio.playCorrect).toHaveBeenCalledTimes(1);
    expect(filledCells()).toBe(1);

    vi.advanceTimersByTime(DEMO.pressHoldMs);
    expect(responseArea().dataset.demo).toBeUndefined();
  });

  test('No-Go 시범: 그림이 흔들리고 버튼이 흐려진 채 눌리지 않고, 그림이 사라지면 같은 소리와 칸', () => {
    const theme = getTheme('animal');
    const { audio } = mountPractice({ theme });
    // 첫 Go 시범을 지나 No-Go 시범의 시작으로
    vi.advanceTimersByTime(DEMO.leadMs + DEMO.goPressAfterMs + DEMO.pressHoldMs + DEMO.gapMs);
    expect(DEMO.items[1]).toBe('nogo');
    expect(stimulusGlyph()).toBe(theme.crossNoGoGlyph);
    expect(qs('[data-stimulus]').classList.contains('is-demo-sway')).toBe(true); // 흔들림은 CSS 클래스
    expect(responseArea().dataset.demo).toBe('dim');                              // 버튼이 흐려진다
    expect(responseArea().dataset.demo).not.toBe('press');                        // 눌리지 않는다
    const correctBefore = audio.playCorrect.mock.calls.length;

    vi.advanceTimersByTime(DEMO.nogoHoldMs);
    expect(stimulusGlyph()).toBe('');
    expect(qs('[data-stimulus]').classList.contains('is-demo-sway')).toBe(false);
    expect(responseArea().dataset.demo).toBeUndefined();
    expect(audio.playCorrect).toHaveBeenCalledTimes(correctBefore + 1);
    expect(filledCells()).toBe(2); // Go 한 칸 + 참기 한 칸
  });

  test('시범이 끝나면 격자를 비우고, 손가락 그림을 치우고, 8문항을 시작한다', () => {
    const { createEngine } = mountPractice();
    vi.advanceTimersByTime(demoDuration() - 1);
    expect(createEngine).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(createEngine).toHaveBeenCalledTimes(1);
    expect(filledCells()).toBe(0);
    expect(totalCells()).toBe(rewardCellCount(PRACTICE.go + PRACTICE.noGo));
    expect(qs('[data-demo-hand]')).toBeNull();
    expect(stimulusGlyph()).toBe('');
  });

  test('시범 중에 학생이 눌러도 아무 일도 없다 (엔진이 아직 없다)', () => {
    const { createEngine } = mountPractice();
    expect(() => responseArea().dispatchEvent(pointerEvent('pointerdown'))).not.toThrow();
    expect(createEngine).not.toHaveBeenCalled();
    expect(filledCells()).toBe(0);
  });

  test('시범에서 소리는 정답 소리 하나뿐이다 (오반응 소리가 없다)', () => {
    const { audio } = mountPractice();
    skipDemo();
    expect(Object.keys(audio).sort()).toEqual(['playCorrect', 'playStimulus', 'setEnabled', 'unlock']);
    expect(audio.playCorrect).toHaveBeenCalledTimes(DEMO.items.length);
  });
});

// ---- 연습 문항 -----------------------------------------------------------------------------
describe('연습 8문항', () => {
  test('2단계 타이밍으로 Go 5 / No-Go 3을 돌린다', () => {
    mountPractice();
    skipDemo();
    expect(engineArgs.levelParams).toEqual(LEVELS[PRACTICE.level]);
    expect(PRACTICE.level).toBe(2);
    expect(engineArgs.trials).toHaveLength(PRACTICE.go + PRACTICE.noGo);
    expect(engineArgs.trials.filter(t => t.type === 'go')).toHaveLength(PRACTICE.go);
    expect(engineArgs.trials.filter(t => t.type === 'nogo')).toHaveLength(PRACTICE.noGo);
  });

  test('시범이 끝나고 한 간격 뒤 엔진을 시작한다', () => {
    mountPractice();
    skipDemo();
    expect(engine.start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LEVELS[PRACTICE.level].interTrialMs);
    expect(engine.start).toHaveBeenCalledTimes(1);
  });

  test('문항 순서: 어떤 무작위 값에서도 개수가 맞고, 첫 문항은 Go이고, No-Go가 붙어 나오지 않는다', () => {
    let seed = 12345;
    const rng = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    for (let i = 0; i < 300; i += 1) {
      const trials = buildPracticeTrials(rng);
      expect(trials.map(t => t.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(trials.filter(t => t.type === 'go')).toHaveLength(PRACTICE.go);
      expect(trials.filter(t => t.type === 'nogo')).toHaveLength(PRACTICE.noGo);
      expect(trials[0].type).toBe('go');
      for (let k = 1; k < trials.length; k += 1) {
        expect(trials[k].type === 'nogo' && trials[k - 1].type === 'nogo').toBe(false);
      }
    }
  });

  test('rng가 극단값(항상 0, 항상 거의 1)이어도 개수가 맞는다', () => {
    for (const rng of [() => 0, () => 0.999999]) {
      const trials = buildPracticeTrials(rng);
      expect(trials).toHaveLength(8);
      expect(trials.filter(t => t.type === 'nogo')).toHaveLength(PRACTICE.noGo);
    }
  });

  test('연습 중에도 학생 화면에는 문장이 없고, 보상 규칙은 본 검사와 같다', () => {
    const { audio } = mountPractice();
    skipDemo();
    hooks.onStimulus({ index: 0, type: 'go' });
    expect(studentText()).toMatch(EMOJI_ONLY);
    hooks.onTrialComplete(goHit(500));
    expect(filledCells()).toBe(1);
    hooks.onTrialComplete(goHit(100));   // 조급 반응
    hooks.onTrialComplete(nogoBad());    // 억제 실패
    hooks.onTrialComplete(goMiss());     // 누락
    expect(filledCells()).toBe(1);
    expect(audio.playCorrect).toHaveBeenCalledTimes(DEMO.items.length + 1);
    expect(studentText()).toMatch(EMOJI_ONLY);
  });

  test('시계는 performance.now() 기준이다', () => {
    mountPractice();
    skipDemo();
    expect(Math.abs(engineArgs.clock.now() - performance.now())).toBeLessThan(5);
  });
});

// ---- 연습 결과 요약 ----------------------------------------------------------------------------
describe('summarizePractice', () => {
  test('정반응·참기 성공·평균 반응을 센다', () => {
    const result = summarizePractice(responsesFor({ hits: 4, rejections: 2, rt: 600 }), 1);
    expect(result).toEqual({ hits: 4, goTrials: 5, correctRejections: 2, noGoTrials: 3, meanRt: 600, attempt: 1 });
  });

  test('조급 반응 Go는 정반응이 아니고 평균에서도 빠진다', () => {
    const result = summarizePractice([goHit(100), goHit(400), goHit(600)], 1);
    expect(result.hits).toBe(2);
    expect(result.meanRt).toBe(500);
  });

  test('정반응이 없으면 평균은 null이다', () => {
    expect(summarizePractice([goMiss(), nogoOk()], 1).meanRt).toBeNull();
  });

  test('억제 실패와 무효 문항은 맞힌 것으로 세지 않는다', () => {
    const result = summarizePractice([nogoBad(), run('nogo', null, { invalid: true }), run('go', 500, { invalid: true })], 2);
    expect(result).toMatchObject({ hits: 0, correctRejections: 0, attempt: 2 });
  });
});

// ---- 연습이 끝난 뒤 --------------------------------------------------------------------------------
// 검사가 시작된 뒤에는 "교사 화면"이 따로 없다: 기기는 학생이 들고 있고 교사는 자리에 없다. 학생에게는 글 없는 화면만 보이고,
// 글이 있는 패널(난이도 선택, 중단 안내)은 구석 버튼을 길게 눌러야만 열린다.
const teacherButton = () => qs('[data-teacher-open]');
const holdTeacher = (ms = HOLD_MS) => {
  teacherButton().dispatchEvent(pointerEvent('pointerdown'));
  vi.advanceTimersByTime(ms);
  teacherButton()?.dispatchEvent(pointerEvent('pointerup'));
};
// 학생이 보는 상태: 문장이 없고, 글이 있는 패널·선택지·안내가 DOM에 없다.
function expectWordlessStudentState() {
  expect(qs('[data-student-view]')).not.toBeNull();
  expect(studentText()).toMatch(EMOJI_ONLY);
  expect(qs('[data-teacher-view]')).toBeNull();
  expect(qs('[data-teacher-notice]')).toBeNull();
  expect(qs('input[name="level"]')).toBeNull();
  expect(qs('[data-action="begin"]')).toBeNull();
  expect(qs('[data-action="back"]')).toBeNull();
  expect(qs('button:not([data-teacher-open])')).toBeNull(); // 눌러 볼 수 있는 것은 교사 제스처 버튼 하나뿐
  expect(document.body.textContent.replace(/\s/g, '')).toMatch(EMOJI_ONLY); // 화면 전체에 글이 없다
}

describe('추천 확정 → 학생에게는 글 없는 전환 화면, 자동 진행', () => {
  test('학생이 보는 상태에 문장이 없고 난이도 선택지도 없다 (추천 단계와 무관하게)', () => {
    mountPractice();
    finishPractice(responsesFor({ hits: 5, rejections: 3, rt: 500 }));
    expectWordlessStudentState();
    expect(qs('[data-countdown]')).not.toBeNull(); // 남은 시간 막대
    expect(qs('.wait-glyph').textContent).toBe(getTheme('animal').itemGlyph);
  });

  test('THRESHOLDS.practiceAutoAdvanceMs 뒤 추천 단계로 자동 진행한다 (교사가 자리에 없어도 멈추지 않는다)', () => {
    const { onDone } = mountPractice();
    finishPractice(responsesFor({ hits: 4, rejections: 2 }));
    vi.advanceTimersByTime(THRESHOLDS.practiceAutoAdvanceMs - 1);
    expect(onDone).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    const [recommendation, result] = onDone.mock.calls[0];
    expect(recommendation).toEqual({ level: 2, retry: false, abort: false, recommendedLevel: 2 });
    expect(result).toMatchObject({ hits: 4, correctRejections: 2, attempt: 1 });
    vi.advanceTimersByTime(60000);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('3단계 추천도 자동으로 그 단계로 진행한다', () => {
    const { onDone } = mountPractice();
    finishPractice(responsesFor({ hits: 5, rejections: 3, rt: 500 }));
    vi.advanceTimersByTime(THRESHOLDS.practiceAutoAdvanceMs);
    expect(onDone.mock.calls[0][0]).toEqual({ level: 3, retry: false, abort: false, recommendedLevel: 3 });
  });

  test('자동 진행 시간은 config에서 온다 (막대 길이도 같다)', () => {
    expect(THRESHOLDS.practiceAutoAdvanceMs).toBe(8000);
    mountPractice();
    finishPractice(responsesFor({ hits: 4, rejections: 2 }));
    expect(qs('[data-countdown]').style.animationDuration).toBe(`${THRESHOLDS.practiceAutoAdvanceMs}ms`);
  });

  test('화면을 아무리 두드려도(짧은 탭) 난이도가 바뀌거나 패널이 열리지 않는다', () => {
    const { onDone } = mountPractice();
    finishPractice(responsesFor({ hits: 4, rejections: 2 }));
    for (const target of [qs('.wait-glyph'), qs('[data-countdown]'), qs('[data-student-view]')]) {
      target.dispatchEvent(pointerEvent('pointerdown'));
      target.dispatchEvent(pointerEvent('pointerup'));
      click(target);
    }
    holdTeacher(300); // 교사 제스처 버튼도 짧게는 안 열린다
    click(teacherButton());
    expectWordlessStudentState();
    vi.advanceTimersByTime(THRESHOLDS.practiceAutoAdvanceMs);
    expect(onDone.mock.calls[0][0].level).toBe(2); // 추천 단계 그대로
  });

  test('교사 제스처: 999ms는 열리지 않고 1000ms에 열린다', () => {
    mountPractice();
    finishPractice(responsesFor({ hits: 4, rejections: 2 }));
    teacherButton().dispatchEvent(pointerEvent('pointerdown'));
    vi.advanceTimersByTime(HOLD_MS - 1);
    expect(qs('[data-teacher-view]')).toBeNull();
    vi.advanceTimersByTime(1);
    expect(qs('[data-teacher-view]')).not.toBeNull();
    expect(qs('[data-student-view]')).toBeNull();
  });

  test('길게 누르면 추천 단계가 골라진 난이도 패널이 열리고, 자동 진행은 멈춘다', () => {
    const { onDone } = mountPractice();
    finishPractice(responsesFor({ hits: 5, rejections: 3, rt: 500 }));
    vi.advanceTimersByTime(THRESHOLDS.practiceAutoAdvanceMs / 2);
    holdTeacher();
    expect(qs('input[name="level"]:checked').value).toBe('3');
    vi.advanceTimersByTime(60000); // 교사가 읽는 중에 넘어가지 않는다
    expect(onDone).not.toHaveBeenCalled();
    click(qs('[data-action="begin"]'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toEqual({ level: 3, retry: false, abort: false, recommendedLevel: 3 });
  });

  test('교사가 다른 단계를 고르면 그 단계로 진행하고, 추천값도 함께 남긴다', () => {
    const { onDone } = mountPractice();
    finishPractice(responsesFor({ hits: 5, rejections: 3, rt: 500 })); // 추천 3
    holdTeacher();
    const one = qs('input[name="level"][value="1"]');
    one.checked = true;
    one.dispatchEvent(new Event('change', { bubbles: true }));
    click(qs('[data-action="begin"]'));
    expect(onDone.mock.calls[0][0]).toEqual({ level: 1, retry: false, abort: false, recommendedLevel: 3 });
    click(qs('[data-action="begin"]'));
    expect(onDone).toHaveBeenCalledTimes(1); // 이중 진행 방지
  });

  test('패널의 글에 점수·성공/실패 표시가 없다', () => {
    mountPractice();
    finishPractice(responsesFor({ hits: 3, rejections: 1 }));
    holdTeacher();
    const text = qs('[data-teacher-view]').textContent;
    expect(text).not.toMatch(/실패|틀|못/);
    expect(text).not.toContain('3/5');
  });

  test('누르는 중에 화면을 떠나면 패널이 열리지 않고 타이머가 남지 않는다', () => {
    mountPractice();
    finishPractice(responsesFor({ hits: 4, rejections: 2 }));
    teacherButton().dispatchEvent(pointerEvent('pointerdown'));
    screen.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60000);
    expect(qs('[data-teacher-view]')).toBeNull();
  });
});

describe('재시도', () => {
  test('1회차에 못 미치면 학생에게 아무 표시 없이 곧바로 재시도를 알린다', () => {
    const { onDone } = mountPractice({ attempt: 1 });
    finishPractice(responsesFor({ hits: 1, rejections: 0 }));
    expect(onDone).toHaveBeenCalledTimes(1);
    const [recommendation, result] = onDone.mock.calls[0];
    expect(recommendation).toMatchObject({ retry: true, abort: false, level: null });
    expect(result).toMatchObject({ hits: 1, correctRejections: 0, attempt: 1 });
    expect(qs('[data-teacher-view]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/어렵|실패|다시/);
  });

  test('attempt를 생략하면 1회차로 본다', () => {
    const { onDone } = mountPractice();
    finishPractice(responsesFor({ hits: 0, rejections: 0 }));
    expect(onDone.mock.calls[0][1].attempt).toBe(1);
    expect(onDone.mock.calls[0][0].retry).toBe(true);
  });

  test('재시도(2회차)는 다시 시범부터 시작하고, 이번에도 못 미치면 재시도가 아니다', () => {
    const { onDone } = mountPractice({ attempt: PRACTICE.maxRetries + 1 });
    vi.advanceTimersByTime(DEMO.leadMs);
    expect(stimulusGlyph()).not.toBe(''); // 시범이 다시 돈다
    finishPractice(responsesFor({ hits: 2, rejections: 0 }));
    // 재시도 후에도 못 미침, 정반응 2개(>1) → 1단계
    holdTeacher();
    expect(qs('input[name="level"]:checked').value).toBe('1');
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('중단 상황: 학생에게는 글 없는 끝 화면, 안내는 길게 눌러야', () => {
  const failTwice = () => responsesFor({ hits: PRACTICE.abortMaxHits, rejections: 0 });
  const mountAborted = () => {
    const m = mountPractice({ attempt: PRACTICE.maxRetries + 1 });
    finishPractice(failTwice());
    return m;
  };

  test('학생이 보는 상태에 문장이 없고, 실패를 암시하는 것이 없다 (마무리 그림만)', () => {
    mountAborted();
    expectWordlessStudentState();
    expect(qs('.wait-glyph').textContent).toBe(getTheme('animal').completionGlyph);
    expect(qs('[data-countdown]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/어렵|실패|못/);
  });

  test('연습이 도는 내내 학생 화면 어디에도 그 안내가 없다', () => {
    mountPractice({ attempt: PRACTICE.maxRetries + 1 });
    skipDemo();
    hooks.onStimulus({ index: 0, type: 'go' });
    hooks.onTrialComplete(goMiss());
    hooks.onTrialComplete(nogoBad());
    expect(qs('[data-student-view]').textContent).not.toContain('어렵');
    expect(qs('[data-student-view]').textContent).not.toContain('검사');
    expect(studentText()).toMatch(EMOJI_ONLY);
  });

  test('짧은 탭·click으로는 안내가 열리지 않는다', () => {
    mountAborted();
    holdTeacher(HOLD_MS - 1);
    click(teacherButton());
    click(qs('.wait-glyph'));
    expectWordlessStudentState();
  });

  test('길게 누르면 교사용 안내가 열린다: 교사 패널 안에만 있고 학생 화면은 없어진다', () => {
    mountAborted();
    holdTeacher();
    const notice = qs('[data-teacher-notice="practice-abort"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain('지금은 검사가 어렵습니다');
    expect(notice.closest('[data-teacher-view]')).not.toBeNull();
    expect(notice.closest('[data-student-view]')).toBeNull();
    expect(qs('[data-student-view]')).toBeNull();
  });

  test('자동으로 넘어가지 않고, 안내를 연 뒤 "처음으로"를 눌러야 abort로 알린다', () => {
    const { onDone } = mountAborted();
    vi.advanceTimersByTime(60000);
    expect(onDone).not.toHaveBeenCalled();
    holdTeacher();
    vi.advanceTimersByTime(60000);
    expect(onDone).not.toHaveBeenCalled();
    click(qs('[data-action="back"]'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone.mock.calls[0][0]).toEqual({ level: null, retry: false, abort: true, recommendedLevel: null });
    expect(onDone.mock.calls[0][1]).toMatchObject({ hits: PRACTICE.abortMaxHits, attempt: PRACTICE.maxRetries + 1 });
  });

  test('정반응이 1개 이하여도 1회차에는 중단이 아니라 재시도다', () => {
    const { onDone } = mountPractice({ attempt: 1 });
    finishPractice(failTwice());
    expect(onDone.mock.calls[0][0]).toMatchObject({ retry: true, abort: false });
    expect(qs('[data-teacher-notice="practice-abort"]')).toBeNull();
    expect(qs('[data-teacher-open]')).toBeNull();
  });

  test('안내를 열 때 전체화면을 닫는다 (열기 전에는 닫지 않는다)', () => {
    document.exitFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    mountAborted();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
    holdTeacher();
    expect(document.exitFullscreen).toHaveBeenCalled();
  });
});

// ---- 전체화면, 정리 ---------------------------------------------------------------------------
describe('전체화면과 정리', () => {
  test('전체화면을 요청하되 거부되어도 그대로 진행한다', async () => {
    document.documentElement.requestFullscreen = vi.fn(() => Promise.reject(new Error('denied')));
    const { createEngine } = mountPractice();
    await Promise.resolve();
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    skipDemo();
    expect(createEngine).toHaveBeenCalledTimes(1);
  });

  test('unmount해도 전체화면은 닫지 않는다 (이어지는 본 검사가 같은 전체화면을 쓴다)', () => {
    document.exitFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    mountPractice();
    screen.unmount();
    expect(document.exitFullscreen).not.toHaveBeenCalled();
  });

  test('시범 중에 떠나면 타이머가 모두 사라지고 엔진은 만들어지지 않는다', () => {
    const { createEngine, onDone } = mountPractice();
    vi.advanceTimersByTime(DEMO.leadMs + 100);
    screen.unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60000);
    expect(createEngine).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  test('연습 문항 중에 떠나면 엔진을 중단하고 타이머·리스너를 거둔다', () => {
    mountPractice();
    skipDemo();
    const area = responseArea();
    screen.unmount();
    expect(engine.abort).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    area.dispatchEvent(pointerEvent('pointerdown'));
    expect(engine.input).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60000);
    expect(engine.start).not.toHaveBeenCalled();
  });

  test('자동 진행을 기다리다 떠나면 onDone이 불리지 않는다', () => {
    const { onDone } = mountPractice();
    finishPractice(responsesFor({ hits: 4, rejections: 2 }));
    screen.unmount();
    vi.advanceTimersByTime(60000);
    expect(onDone).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('연습 중 화면이 가려지면 엔진을 멈추고 돌아오면 재개한다', () => {
    mountPractice();
    skipDemo();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(engine.pause).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(engine.resume).toHaveBeenCalledTimes(1);
  });
});

describe('연습 화면 코드', () => {
  test('WAAPI(element.animate)를 쓰지 않는다: 움직임은 CSS 클래스로만 만든다', () => {
    const code = read('js/screens/practiceScreen.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\.animate\(/);
  });

  test('시범의 흔들림 CSS는 시범 클래스에만 있고, 오반응 키워드가 CSS에 없다', () => {
    const css = read('css/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/\.is-demo-sway\s*\{/);
    expect(css).not.toMatch(/shake|wobble|wrong|incorrect|fail/i);
  });
});
