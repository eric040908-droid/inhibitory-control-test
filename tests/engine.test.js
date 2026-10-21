import { createEngine } from '../js/engine.js';
import { LEVELS, THRESHOLDS } from '../js/config.js';

// ---- 헬퍼 ------------------------------------------------------------------

// 시간을 수동으로 전진시키는 가짜 시계. 진짜 타이머를 쓰지 않는다.
// advance(ms)는 목표 시각까지 예약된 콜백을 (시각, 예약 순서) 순으로 실행하고,
// 콜백이 실행되는 동안 now()는 그 콜백이 예약된 시각을 돌려준다. 콜백이 새로 예약한 타이머도
// 목표 시각 안이면 같은 advance 안에서 실행된다.
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map();
  const earliest = (limit) => {
    let best = null;
    for (const timer of timers.values()) {
      if (timer.at > limit) continue;
      if (!best || timer.at < best.at || (timer.at === best.at && timer.seq < best.seq)) best = timer;
    }
    return best;
  };
  return {
    now: () => t,
    setTimeout(fn, delay) {
      const id = ++seq;
      timers.set(id, { id, seq: id, at: t + delay, fn });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const target = t + ms;
      for (let timer = earliest(target); timer; timer = earliest(target)) {
        timers.delete(timer.id);
        t = Math.max(t, timer.at);
        timer.fn();
      }
      t = target;
    },
    // 예약된 타이머가 없어질 때까지 다음 타이머로 계속 전진한다.
    runAll(cap = 10000) {
      for (let i = 0; i < cap; i++) {
        const next = earliest(Infinity);
        if (!next) return;
        this.advance(next.at - t);
      }
      throw new Error('runAll: 타이머가 끝나지 않는다');
    },
    pending: () => timers.size,
  };
}

const goTrial = (index) => ({ index, type: 'go' });
const nogoTrial = (index) => ({ index, type: 'nogo' });

function setup({ trials, level }) {
  const clock = fakeClock();
  const hooks = {
    onStimulus: vi.fn(),
    onStimulusEnd: vi.fn(),
    onTrialComplete: vi.fn(),
    onFinish: vi.fn(),
  };
  const engine = createEngine({ trials, levelParams: LEVELS[level], hooks, clock });
  return { engine, clock, hooks };
}

const runToEnd = (clock) => clock.runAll();

const WINDOW_3 = LEVELS[3].stimulusMs + THRESHOLDS.responseGraceMs;

// ---- 헬퍼 자체 검증: fakeClock이 틀리면 아래 모든 타이밍 테스트가 아무것도 검증하지 못한다 ----

describe('fakeClock', () => {
  test('예약된 콜백을 시각 순서(같은 시각이면 예약 순서)로 실행한다', () => {
    const clock = fakeClock();
    const log = [];
    clock.setTimeout(() => log.push('c@300'), 300);
    clock.setTimeout(() => log.push('a@100'), 100);
    clock.setTimeout(() => log.push('b1@200'), 200);
    clock.setTimeout(() => log.push('b2@200'), 200);
    clock.advance(1000);
    expect(log).toEqual(['a@100', 'b1@200', 'b2@200', 'c@300']);
  });

  test('콜백 안에서 now()는 그 콜백의 예약 시각이고, advance가 끝나면 목표 시각이다', () => {
    const clock = fakeClock();
    const seen = [];
    clock.setTimeout(() => seen.push(clock.now()), 250);
    clock.advance(1000);
    expect(seen).toEqual([250]);
    expect(clock.now()).toBe(1000);
  });

  test('목표 시각 뒤의 콜백은 실행하지 않고, 목표 시각 정각의 콜백은 실행한다', () => {
    const clock = fakeClock();
    const fn = vi.fn();
    clock.setTimeout(fn, 100);
    clock.advance(99);
    expect(fn).not.toHaveBeenCalled();
    clock.advance(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('clearTimeout한 콜백은 실행하지 않는다', () => {
    const clock = fakeClock();
    const fn = vi.fn();
    const id = clock.setTimeout(fn, 100);
    clock.clearTimeout(id);
    clock.advance(1000);
    expect(fn).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
  });

  test('콜백이 새로 예약한 타이머가 목표 시각 안이면 같은 advance 안에서 실행된다', () => {
    const clock = fakeClock();
    const log = [];
    clock.setTimeout(() => {
      log.push(clock.now());
      clock.setTimeout(() => log.push(clock.now()), 50);
    }, 100);
    clock.advance(200);
    expect(log).toEqual([100, 150]);
  });
});

// ---- 브리프 테스트 (그대로) -------------------------------------------------

test('반응이 들어오면 자극을 즉시 끝내고 다음 문항으로 넘어간다', () => {
  const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
  engine.start(); clock.advance(600); engine.input(clock.now());
  expect(hooks.onStimulusEnd).toHaveBeenCalledTimes(1);
  clock.advance(LEVELS[1].interTrialMs);
  expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
});

test('반응시간은 이벤트 시각에서 자극이 그려진 시각을 뺀 값이다', () => {
  const { engine, clock } = setup({ trials: [goTrial(0)], level: 2 });
  engine.start(); engine.markStimulusRendered(clock.now() + 16);
  clock.advance(500); engine.input(clock.now());
  expect(engine.responses()[0].rtMs).toBe(484);
});

test('허용 구간은 제시 시간에 0.5초를 더한 값이고 그 뒤 입력은 무시된다', () => {
  const { engine, clock } = setup({ trials: [goTrial(0)], level: 3 });
  engine.start();
  clock.advance(LEVELS[3].stimulusMs + THRESHOLDS.responseGraceMs + 1);
  engine.input(clock.now());
  expect(engine.responses()[0].rtMs).toBeNull();
});

test('No-Go 문항은 반응이 없으면 제시 시간을 끝까지 쓴다', () => {
  const { engine, clock, hooks } = setup({ trials: [nogoTrial(0), goTrial(1)], level: 2 });
  engine.start(); clock.advance(LEVELS[2].stimulusMs);
  expect(hooks.onStimulusEnd).toHaveBeenCalledTimes(1);
});

test('같은 문항에서 연타하면 첫 입력만 반응시간이 되고 나머지는 연타로 센다', () => {
  // Review Focus 5
  const { engine, clock } = setup({ trials: [goTrial(0)], level: 1 });
  engine.start();
  clock.advance(400); engine.input(clock.now());
  engine.input(clock.now()); engine.input(clock.now());
  const r = engine.responses()[0];
  expect(r.rtMs).toBe(400); expect(r.extraTaps).toBe(2);
});

test('화면이 가려지면 진행 중 문항을 무효로 표시하고 멈춘다', () => {
  // Review Focus 3
  const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
  engine.start(); clock.advance(300); engine.pause();
  expect(engine.responses()[0].invalid).toBe(true);
  clock.advance(60000);
  expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
});

test('복귀하면 다음 문항부터 재개한다', () => {
  // Review Focus 3
  const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
  engine.start(); clock.advance(300); engine.pause(); engine.resume();
  clock.advance(LEVELS[1].interTrialMs);
  expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
  expect(hooks.onStimulus.mock.calls[1][0].index).toBe(1);
});

test('가려짐이 반복되면 무효 문항이 누적된다', () => {
  // Review Focus 3
  const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1), goTrial(2)], level: 1 });
  engine.start();
  for (let i = 0; i < 2; i++) { clock.advance(200); engine.pause(); engine.resume(); clock.advance(LEVELS[1].interTrialMs); }
  expect(engine.responses().filter(r => r.invalid)).toHaveLength(2);
});

test('마지막 문항이 끝나면 onFinish에 모든 반응을 넘긴다', () => {
  const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 3 });
  engine.start();
  runToEnd(clock);
  expect(hooks.onFinish).toHaveBeenCalledTimes(1);
  expect(hooks.onFinish.mock.calls[0][0]).toHaveLength(2);
});

test('중단하면 그 시점까지의 반응만 남고 onFinish가 불리지 않는다', () => {
  const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
  engine.start(); clock.advance(300); engine.abort();
  expect(hooks.onFinish).not.toHaveBeenCalled();
  expect(engine.responses()).toHaveLength(1);
});

// ---- 추가: Response 모양 -----------------------------------------------------

describe('Response 모양', () => {
  test('index, type, rtMs, extraTaps, invalid만 갖는다 (metrics.js가 소비하는 모양)', () => {
    const { engine, clock } = setup({ trials: [nogoTrial(7)], level: 1 });
    engine.start(); clock.advance(250); engine.input(clock.now());
    expect(engine.responses()[0]).toEqual({ index: 7, type: 'nogo', rtMs: 250, extraTaps: 0, invalid: false });
  });

  test('무반응 문항은 rtMs가 null이고 무효가 아니다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start(); clock.runAll();
    expect(engine.responses()[0]).toEqual({ index: 0, type: 'go', rtMs: null, extraTaps: 0, invalid: false });
  });

  test('무효 문항은 rtMs가 null이고 invalid가 true다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start(); clock.advance(100); engine.pause();
    expect(engine.responses()[0]).toEqual({ index: 0, type: 'go', rtMs: null, extraTaps: 0, invalid: true });
  });

  test('responses()는 복사본을 돌려준다 — 밖에서 고쳐도 엔진의 기록은 그대로다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start(); clock.advance(300); engine.input(clock.now());
    const first = engine.responses();
    first[0].rtMs = 1;
    first.push({});
    expect(engine.responses()).toHaveLength(1);
    expect(engine.responses()[0].rtMs).toBe(300);
  });

  test('진행 중인(아직 닫히지 않은) 문항은 responses()에 없다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start(); clock.advance(100);
    expect(engine.responses()).toEqual([]);
  });
});

// ---- 추가: 허용 구간의 정확한 경계 --------------------------------------------
// 허용 구간은 [기준 시각, 기준 시각 + stimulusMs + responseGraceMs] — 끝 경계 포함.

describe('허용 구간 경계', () => {
  test('stimulusMs + responseGraceMs 정각의 입력은 유효하다 (끝 경계 포함)', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3);
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(WINDOW_3);
  });

  test('1ms 이른 입력도 유효하다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3 - 1);
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(WINDOW_3 - 1);
  });

  test('1ms 늦은 입력은 무시되고 문항은 무반응으로 닫힌다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3 + 1);
    engine.input(clock.now());
    expect(engine.responses()).toEqual([{ index: 0, type: 'go', rtMs: null, extraTaps: 0, invalid: false }]);
  });

  test('이벤트 시각이 구간을 소수점만큼이라도 넘으면(핸들러만 일찍 불렸어도) 반응이 아니다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3);
    engine.input(clock.now() + 0.5);
    clock.advance(10);
    expect(engine.responses()[0].rtMs).toBeNull();
  });

  test('자극이 사라진 뒤(여유 시간) 안의 입력은 그 문항의 반응이다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0)], level: 3 });
    engine.start();
    clock.advance(LEVELS[3].stimulusMs + 100);
    expect(hooks.onStimulusEnd).toHaveBeenCalledTimes(1);
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(LEVELS[3].stimulusMs + 100);
    // 자극은 이미 끝났으므로 입력이 onStimulusEnd를 또 부르지 않는다.
    expect(hooks.onStimulusEnd).toHaveBeenCalledTimes(1);
  });

  test('자극 제시 시간 정각의 입력도 유효하다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 3 });
    engine.start();
    clock.advance(LEVELS[3].stimulusMs);
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(LEVELS[3].stimulusMs);
  });

  test('No-Go 문항에서 여유 시간 안에 누르면 반응시간이 있는 기록이 된다', () => {
    const { engine, clock } = setup({ trials: [nogoTrial(0)], level: 2 });
    engine.start();
    clock.advance(LEVELS[2].stimulusMs + 200);
    engine.input(clock.now());
    expect(engine.responses()[0]).toMatchObject({ type: 'nogo', rtMs: LEVELS[2].stimulusMs + 200, invalid: false });
  });

  test('허용 구간이 끝난 문항의 늦은 입력은 연타로도 세지 않는다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3 + 1);
    engine.input(clock.now());
    engine.input(clock.now());
    expect(engine.responses()[0]).toMatchObject({ rtMs: null, extraTaps: 0 });
  });
});

// ---- 추가: markStimulusRendered 계약 -----------------------------------------

describe('markStimulusRendered', () => {
  test('부르지 않으면 반응시간의 기준은 onStimulus를 요청한 시각(자극 시작 시각)이다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 2 });
    clock.advance(1000);
    engine.start();
    clock.advance(333);
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(333);
  });

  test('기준은 입력이 아니라 자극 시작 시각이다 — 핸들러가 늦게 불려도 이벤트 시각이 우선한다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 2 });
    engine.start();
    clock.advance(500);
    const eventTime = clock.now() - 40; // 실제 터치는 40ms 전, 핸들러는 지금 실행
    engine.input(eventTime);
    expect(engine.responses()[0].rtMs).toBe(460);
  });

  test('자극 시작 이전 시각으로 부르면 자극 시작 시각으로 본다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 2 });
    clock.advance(1000);
    engine.start();
    engine.markStimulusRendered(clock.now() - 50);
    clock.advance(300);
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(300);
  });

  test('두 번 부르면 처음 값만 쓴다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 2 });
    engine.start();
    engine.markStimulusRendered(clock.now() + 16);
    engine.markStimulusRendered(clock.now() + 100);
    clock.advance(500);
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(484);
  });

  test('이벤트 시각이 그려진 시각보다 이르면 반응시간은 0으로 막는다 (음수 금지)', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 2 });
    engine.start();
    engine.markStimulusRendered(clock.now() + 16);
    clock.advance(10);
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(0);
  });

  test('그려진 시각이 자극 시작보다 늦으면 제시 시간과 허용 구간도 그 시각부터 센다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0)], level: 3 });
    engine.start();
    engine.markStimulusRendered(clock.now() + 16);
    clock.advance(LEVELS[3].stimulusMs + 15);
    expect(hooks.onStimulusEnd).not.toHaveBeenCalled();
    clock.advance(1);
    expect(hooks.onStimulusEnd).toHaveBeenCalledTimes(1);
    // 허용 구간 끝 정각(그려진 시각 기준)은 유효, 1ms 뒤는 무효.
    clock.advance(THRESHOLDS.responseGraceMs);
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(WINDOW_3);
  });

  test('자극 시간이 이미 끝난 뒤에 부르면 무시한다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 3 });
    engine.start();
    clock.advance(LEVELS[3].stimulusMs + 100);
    engine.markStimulusRendered(clock.now());
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(LEVELS[3].stimulusMs + 100);
  });

  test('다음 문항에서는 다시 기준이 초기화된다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start();
    engine.markStimulusRendered(clock.now() + 16);
    clock.advance(100); engine.input(clock.now());
    clock.advance(LEVELS[1].interTrialMs);
    // 두 번째 문항은 markStimulusRendered를 부르지 않았다 → 자극 시작 시각 기준.
    clock.advance(200); engine.input(clock.now());
    expect(engine.responses().map(r => r.rtMs)).toEqual([84, 200]);
  });

  test('숫자가 아닌 시각은 거부한다 (NaN이 기록에 섞이지 않게)', () => {
    const { engine } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start();
    expect(() => engine.markStimulusRendered(undefined)).toThrow(TypeError);
    expect(() => engine.markStimulusRendered(NaN)).toThrow(TypeError);
  });
});

// ---- 추가: input ------------------------------------------------------------

describe('input', () => {
  test('숫자가 아닌 시각은 거부한다', () => {
    const { engine } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start();
    expect(() => engine.input(undefined)).toThrow(TypeError);
    expect(() => engine.input(NaN)).toThrow(TypeError);
    expect(engine.responses()).toEqual([]);
  });

  test('start() 전의 입력은 무시된다', () => {
    const { engine, hooks } = setup({ trials: [goTrial(0)], level: 1 });
    engine.input(10);
    expect(engine.responses()).toEqual([]);
    expect(hooks.onTrialComplete).not.toHaveBeenCalled();
  });

  test('반응 뒤 간격 중의 입력은 다음 문항이 아니라 방금 문항의 연타로 센다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start();
    clock.advance(400); engine.input(clock.now());
    clock.advance(300); engine.input(clock.now());   // 사람은 실제로 이렇게 연타한다
    clock.advance(300); engine.input(clock.now());
    clock.advance(LEVELS[1].interTrialMs - 600);     // 간격이 끝나 다음 문항이 시작된다
    expect(engine.responses()[0]).toMatchObject({ rtMs: 400, extraTaps: 2 });
    clock.advance(250); engine.input(clock.now());
    expect(engine.responses()[1]).toMatchObject({ rtMs: 250, extraTaps: 0 });
  });

  test('같은 시각에 두 손가락이 닿아도 한 번은 반응, 한 번은 연타다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start();
    clock.advance(500);
    const t = clock.now();
    engine.input(t); engine.input(t);
    expect(engine.responses()[0]).toMatchObject({ rtMs: 500, extraTaps: 1 });
  });

  test('No-Go 문항의 연타도 센다', () => {
    const { engine, clock } = setup({ trials: [nogoTrial(0)], level: 1 });
    engine.start();
    clock.advance(700); engine.input(clock.now());
    engine.input(clock.now());
    expect(engine.responses()[0]).toMatchObject({ type: 'nogo', rtMs: 700, extraTaps: 1 });
  });

  test('무반응으로 닫힌 문항 뒤의 입력은 다음 문항에 섞이지 않는다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3 + 1);       // 0번 문항 무반응으로 닫힘, 간격 시작
    engine.input(clock.now());          // 간격 중 입력: 무시
    clock.advance(LEVELS[3].interTrialMs - 1);
    expect(engine.responses()).toHaveLength(1);
    clock.advance(1);                   // 1번 문항 시작
    clock.advance(200); engine.input(clock.now());
    expect(engine.responses()[1]).toMatchObject({ rtMs: 200, extraTaps: 0 });
  });
});

// ---- 추가: 훅 호출 순서와 진행 --------------------------------------------------

describe('훅 순서', () => {
  test('start()는 첫 자극을 즉시 요청한다', () => {
    const { engine, hooks } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start();
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
    expect(hooks.onStimulus.mock.calls[0][0]).toEqual(goTrial(0));
  });

  test('반응: 기록이 먼저 남고, 그 다음 자극이 끝나고, 그 다음에 onTrialComplete(보상) 순서다', () => {
    const log = [];
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    hooks.onStimulusEnd.mockImplementation(() => log.push(['end', engine.responses().length]));
    hooks.onTrialComplete.mockImplementation((r) => log.push(['complete', engine.responses().length, r.rtMs]));
    engine.start(); clock.advance(300); engine.input(clock.now());
    expect(log).toEqual([['end', 1], ['complete', 1, 300]]);
  });

  test('onTrialComplete 시점에 기록과 이 반응의 시각은 이미 확정돼 있다 (보상이 측정에 끼어들지 않는다)', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    hooks.onTrialComplete.mockImplementation(() => {
      // 보상 애니메이션이 오래 걸리고 그 안에서 입력이 들어와도 첫 입력의 시각은 이미 고정이다.
      engine.input(clock.now() + 999);
    });
    engine.start(); clock.advance(300); engine.input(clock.now());
    expect(engine.responses()[0]).toMatchObject({ rtMs: 300, extraTaps: 1 });
  });

  test('무반응 문항: 자극이 끝나고, 허용 구간이 끝나면 onTrialComplete가 불린다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 2 });
    engine.start();
    clock.advance(LEVELS[2].stimulusMs);
    expect(hooks.onStimulusEnd).toHaveBeenCalledTimes(1);
    expect(hooks.onTrialComplete).not.toHaveBeenCalled();
    clock.advance(THRESHOLDS.responseGraceMs + THRESHOLDS.closeSlackMs);
    expect(hooks.onTrialComplete).toHaveBeenCalledTimes(1);
    expect(hooks.onTrialComplete.mock.calls[0][0]).toMatchObject({ index: 0, rtMs: null, invalid: false });
  });

  test('다음 문항은 반응(또는 허용 구간 끝)에서 interTrialMs 뒤에 시작한다 — 1ms 전에는 아니다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 2 });
    engine.start();
    clock.advance(500); engine.input(clock.now());
    clock.advance(LEVELS[2].interTrialMs - 1);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
  });

  test('무반응이면 허용 구간 끝에서 interTrialMs 뒤에 다음 문항이 시작한다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 3 });
    engine.start();
    const closeAt = WINDOW_3 + THRESHOLDS.closeSlackMs; // 닫힘은 구간 끝 + closeSlackMs
    clock.advance(closeAt + LEVELS[3].interTrialMs - 1);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
  });

  test('onTrialComplete에 넘기는 값은 복사본이라 나중의 연타가 바꾸지 않는다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start(); clock.advance(300); engine.input(clock.now()); engine.input(clock.now());
    expect(hooks.onTrialComplete.mock.calls[0][0].extraTaps).toBe(0);
    expect(engine.responses()[0].extraTaps).toBe(1);
  });
});

// ---- 추가: 마지막 문항 / 빈 세션 -------------------------------------------------

describe('끝내기', () => {
  test('마지막 문항의 허용 구간이 끝나기 전에는 onFinish가 불리지 않는다', () => {
    const { engine, clock, hooks } = setup({ trials: [nogoTrial(0)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3);
    expect(hooks.onFinish).not.toHaveBeenCalled();
    // 마지막 문항의 정각 입력이 아직 기록된다.
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(WINDOW_3);
  });

  test('마지막 문항이 무반응이면 허용 구간이 닫히고 간격이 지난 뒤에 onFinish가 불린다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3 + THRESHOLDS.closeSlackMs);
    expect(hooks.onFinish).not.toHaveBeenCalled();
    clock.advance(LEVELS[3].interTrialMs - 1);
    expect(hooks.onFinish).not.toHaveBeenCalled();
    clock.advance(1);
    expect(hooks.onFinish).toHaveBeenCalledTimes(1);
  });

  test('마지막 문항에 반응하면 즉시가 아니라 간격 뒤에 끝난다 — 마지막 연타도 기록된다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start();
    clock.advance(400); engine.input(clock.now());
    expect(hooks.onFinish).not.toHaveBeenCalled();
    clock.advance(200); engine.input(clock.now());
    clock.advance(LEVELS[1].interTrialMs);
    expect(hooks.onFinish).toHaveBeenCalledTimes(1);
    expect(hooks.onFinish.mock.calls[0][0]).toEqual([{ index: 0, type: 'go', rtMs: 400, extraTaps: 1, invalid: false }]);
  });

  test('onFinish 뒤에는 타이머가 남지 않고, 입력·pause·resume·abort는 아무 일도 하지 않는다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start(); clock.runAll();
    expect(clock.pending()).toBe(0);
    const before = engine.responses();
    engine.input(clock.now()); engine.pause(); engine.resume(); engine.abort();
    clock.advance(100000);
    expect(engine.responses()).toEqual(before);
    expect(hooks.onFinish).toHaveBeenCalledTimes(1);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
  });

  test('문항이 0개면 start()에서 바로 빈 배열로 끝난다', () => {
    const { engine, clock, hooks } = setup({ trials: [], level: 1 });
    engine.start();
    expect(hooks.onStimulus).not.toHaveBeenCalled();
    expect(hooks.onFinish).toHaveBeenCalledTimes(1);
    expect(hooks.onFinish).toHaveBeenCalledWith([]);
    expect(engine.responses()).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  test('start()를 두 번 불러도 첫 자극은 한 번만 요청된다', () => {
    const { engine, hooks } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start(); engine.start();
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
  });

  test('세션은 시간이 아니라 문항 수로 끝난다 — 빠른 학생은 일찍, 느린 학생은 늦게 끝난다', () => {
    const trials = [goTrial(0), goTrial(1), goTrial(2)];
    const fast = setup({ trials, level: 1 });
    fast.engine.start();
    for (let i = 0; i < 3; i++) { fast.clock.advance(100); fast.engine.input(fast.clock.now()); fast.clock.advance(LEVELS[1].interTrialMs); }
    const slow = setup({ trials, level: 1 });
    slow.engine.start(); slow.clock.runAll();
    expect(fast.hooks.onFinish).toHaveBeenCalledTimes(1);
    expect(slow.hooks.onFinish).toHaveBeenCalledTimes(1);
    expect(fast.clock.now()).toBeLessThan(slow.clock.now());
    expect(fast.hooks.onFinish.mock.calls[0][0]).toHaveLength(3);
    expect(slow.hooks.onFinish.mock.calls[0][0]).toHaveLength(3);
  });
});

// ---- 추가: pause / resume / abort 경계 --------------------------------------------

describe('pause / resume / abort 경계', () => {
  test('문항 사이 간격 중에 pause하면 이미 기록된 문항은 그대로 유효하고, 다음 문항은 재개 전에는 시작하지 않는다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start();
    clock.advance(400); engine.input(clock.now());
    clock.advance(100); engine.pause();
    expect(engine.responses()).toEqual([{ index: 0, type: 'go', rtMs: 400, extraTaps: 0, invalid: false }]);
    clock.advance(60000);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
    expect(clock.pending()).toBe(0);
  });

  test('간격 중 pause 뒤 resume하면 interTrialMs를 새로 기다린 뒤 다음 문항이 시작한다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start();
    clock.advance(400); engine.input(clock.now());
    clock.advance(100); engine.pause();
    clock.advance(5000); engine.resume();
    clock.advance(LEVELS[1].interTrialMs - 1);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
    expect(hooks.onStimulus.mock.calls[1][0].index).toBe(1);
  });

  test('pause 중과 재개 후 간격 안의 입력은 가려지기 전 문항의 연타로 세지 않는다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start();
    clock.advance(400); engine.input(clock.now());
    engine.pause();
    engine.input(clock.now());
    engine.resume();
    engine.input(clock.now());
    expect(engine.responses()[0].extraTaps).toBe(0);
  });

  test('자극이 이미 끝나고 여유 시간 중에 pause해도 그 문항은 무효가 된다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 2 });
    engine.start();
    clock.advance(LEVELS[2].stimulusMs + 100);
    engine.pause();
    expect(engine.responses()).toEqual([{ index: 0, type: 'go', rtMs: null, extraTaps: 0, invalid: true }]);
  });

  test('pause 중의 입력은 무시된다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start(); clock.advance(200); engine.pause();
    engine.input(clock.now());
    expect(engine.responses()).toHaveLength(1);
    expect(engine.responses()[0]).toMatchObject({ rtMs: null, invalid: true, extraTaps: 0 });
  });

  test('이미 pause 상태에서 pause를 또 불러도 무효 문항이 늘지 않는다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start(); clock.advance(200);
    engine.pause(); engine.pause();
    expect(engine.responses()).toHaveLength(1);
  });

  test('pause 없이 resume을 부르면 아무 일도 하지 않는다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start(); clock.advance(200);
    engine.resume();
    // 진행 중이던 0번 문항이 평소처럼 이어진다 (여분의 타이머가 생기지 않는다).
    clock.advance(300); engine.input(clock.now());
    expect(engine.responses()[0]).toMatchObject({ rtMs: 500, invalid: false });
    clock.advance(LEVELS[1].interTrialMs);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
  });

  test('resume을 두 번 불러도 다음 문항은 한 번만 시작한다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1), goTrial(2)], level: 1 });
    engine.start(); clock.advance(200); engine.pause();
    engine.resume(); engine.resume();
    clock.advance(LEVELS[1].interTrialMs);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
  });

  test('start() 전의 pause/resume은 아무 일도 하지 않고, 그 뒤 start()는 정상 동작한다', () => {
    const { engine, hooks } = setup({ trials: [goTrial(0)], level: 1 });
    engine.pause(); engine.resume();
    expect(hooks.onStimulus).not.toHaveBeenCalled();
    engine.start();
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
  });

  test('pause는 훅을 부르지 않는다 (호출자가 이미 화면을 정리한다)', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start(); clock.advance(200);
    hooks.onStimulusEnd.mockClear(); hooks.onTrialComplete.mockClear();
    engine.pause();
    expect(hooks.onStimulusEnd).not.toHaveBeenCalled();
    expect(hooks.onTrialComplete).not.toHaveBeenCalled();
    expect(hooks.onFinish).not.toHaveBeenCalled();
  });

  test('마지막 문항 진행 중에 pause하고 resume하면 간격 뒤 onFinish가 불리고 무효 문항이 포함된다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0)], level: 1 });
    engine.start(); clock.advance(200); engine.pause(); engine.resume();
    clock.advance(LEVELS[1].interTrialMs);
    expect(hooks.onFinish).toHaveBeenCalledTimes(1);
    expect(hooks.onFinish.mock.calls[0][0]).toEqual([{ index: 0, type: 'go', rtMs: null, extraTaps: 0, invalid: true }]);
  });

  test('재개한 문항은 기준 시각이 새로 잡힌다 (가려지기 전 시각이 섞이지 않는다)', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start();
    engine.markStimulusRendered(clock.now() + 16);
    clock.advance(200); engine.pause();
    clock.advance(10000); engine.resume();
    clock.advance(LEVELS[1].interTrialMs);     // 1번 문항 시작
    clock.advance(350); engine.input(clock.now());
    expect(engine.responses()[1].rtMs).toBe(350);
  });

  test('abort 뒤의 입력·pause·resume·start는 아무 일도 하지 않는다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start(); clock.advance(300); engine.abort();
    const after = engine.responses();
    engine.input(clock.now()); engine.pause(); engine.resume(); engine.start();
    clock.advance(100000);
    expect(engine.responses()).toEqual(after);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
    expect(hooks.onFinish).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
  });

  test('abort는 진행 중이던 문항을 무효로 남기고 타이머를 모두 해제한다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start(); clock.advance(300); engine.abort();
    expect(engine.responses()).toEqual([{ index: 0, type: 'go', rtMs: null, extraTaps: 0, invalid: true }]);
    expect(clock.pending()).toBe(0);
  });

  test('간격 중에 abort하면 이미 기록된 문항만 남는다 (유효 그대로)', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start(); clock.advance(300); engine.input(clock.now());
    engine.abort();
    clock.advance(100000);
    expect(engine.responses()).toEqual([{ index: 0, type: 'go', rtMs: 300, extraTaps: 0, invalid: false }]);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
  });

  test('pause 중에 abort하면 pause가 남긴 무효 문항만 남는다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start(); clock.advance(300); engine.pause();
    engine.abort();
    expect(engine.responses()).toHaveLength(1);
    expect(engine.responses()[0].invalid).toBe(true);
  });

  test('start() 전에 abort하면 기록 없이 끝나고 이후 start()는 무시된다', () => {
    const { engine, hooks } = setup({ trials: [goTrial(0)], level: 1 });
    engine.abort(); engine.start();
    expect(hooks.onStimulus).not.toHaveBeenCalled();
    expect(engine.responses()).toEqual([]);
  });
});

// ---- 추가: 값은 config에서 읽는다 ------------------------------------------------

describe('config 값 사용', () => {
  test('levelParams를 바꾸면 제시 시간과 간격이 따라 바뀐다 (숫자를 하드코딩하지 않는다)', () => {
    const clock = fakeClock();
    const hooks = { onStimulus: vi.fn(), onStimulusEnd: vi.fn(), onTrialComplete: vi.fn(), onFinish: vi.fn() };
    const engine = createEngine({
      trials: [nogoTrial(0), goTrial(1)],
      levelParams: { stimulusMs: 1000, interTrialMs: 200 },
      hooks, clock,
    });
    engine.start();
    clock.advance(999); expect(hooks.onStimulusEnd).not.toHaveBeenCalled();
    clock.advance(1);   expect(hooks.onStimulusEnd).toHaveBeenCalledTimes(1);
    clock.advance(THRESHOLDS.responseGraceMs + THRESHOLDS.closeSlackMs + 199);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
  });
});

// ---- 추가: 자극 시작 이전 시각의 입력은 이 문항의 반응이 아니다 -------------------------
// 직전 간격에 일어난 탭이 다음 자극이 시작된 뒤에 핸들러로 도착할 수 있다(보상 애니메이션이 메인 스레드를 쓰는 동안).
// 그 탭이 다음 문항의 rtMs 0 반응이 되면 아이의 실제 반응이 가려진다.

describe('자극 시작 이전 이벤트 시각의 입력', () => {
  test('직전 문항에 반응이 있었으면 그 문항의 연타로 세고, 이 문항은 소비하지 않는다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start();
    clock.advance(400); engine.input(clock.now());
    clock.advance(LEVELS[1].interTrialMs - 100);
    const tapAt = clock.now();               // 간격 안에서 일어난 탭
    clock.advance(100);                       // 1번 문항 시작
    expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
    engine.input(tapAt);                      // 핸들러는 이제야 실행된다
    expect(engine.responses()).toHaveLength(1);
    expect(engine.responses()[0]).toMatchObject({ index: 0, rtMs: 400, extraTaps: 1 });
    // 1번 문항은 아직 열려 있고, 아이의 실제 반응이 정상으로 기록된다.
    clock.advance(250); engine.input(clock.now());
    expect(engine.responses()[1]).toMatchObject({ index: 1, rtMs: 250, extraTaps: 0 });
  });

  test('직전 문항에 반응이 없었으면 버린다 — 이 문항을 소비하지도, 연타로 세지도 않는다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3 + THRESHOLDS.closeSlackMs);   // 0번 문항 무반응으로 닫힘
    clock.advance(LEVELS[3].interTrialMs - 100);
    const tapAt = clock.now();
    clock.advance(100);                                   // 1번 문항 시작
    engine.input(tapAt);
    expect(engine.responses()).toEqual([{ index: 0, type: 'go', rtMs: null, extraTaps: 0, invalid: false }]);
    clock.advance(300); engine.input(clock.now());
    expect(engine.responses()[1]).toMatchObject({ rtMs: 300, extraTaps: 0 });
  });

  test('이미 이 문항에 반응한 뒤(간격 중)에 도착해도 이 문항이 아니라 직전 문항의 연타다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
    engine.start();
    clock.advance(400); engine.input(clock.now());
    clock.advance(LEVELS[1].interTrialMs - 100);
    const tapAt = clock.now();
    clock.advance(100);
    clock.advance(250); engine.input(clock.now());       // 1번 문항 반응
    engine.input(tapAt);                                   // 늦게 도착한 옛 탭
    expect(engine.responses()[0]).toMatchObject({ index: 0, extraTaps: 1 });
    expect(engine.responses()[1]).toMatchObject({ index: 1, rtMs: 250, extraTaps: 0 });
  });

  test('이벤트 시각이 자극 시작 시각과 같으면 이 문항의 입력이다 (경계 포함)', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 1 });
    clock.advance(777);
    engine.start();
    engine.input(clock.now());
    expect(engine.responses()[0]).toMatchObject({ rtMs: 0, extraTaps: 0 });
  });

  test('시작 1ms 전의 이벤트 시각은 이 문항의 입력이 아니다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 1 });
    clock.advance(777);
    engine.start();
    engine.input(clock.now() - 1);
    expect(engine.responses()).toEqual([]);
    clock.advance(200); engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(200);
  });

  test('가려졌다 돌아온 뒤에는 가려지기 전 간격의 탭을 어디에도 세지 않는다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1), goTrial(2)], level: 1 });
    engine.start();
    clock.advance(400); engine.input(clock.now());
    const tapAt = clock.now() + 10;
    clock.advance(20); engine.pause(); engine.resume();
    clock.advance(LEVELS[1].interTrialMs);                // 1번 문항 시작
    engine.input(tapAt);
    expect(engine.responses()[0].extraTaps).toBe(0);
    expect(engine.responses()).toHaveLength(1);
  });

  test('그려진 시각 이전이어도 시작 시각 이후면 0으로 막힌 반응이다 (프레임 지연 구간만 남는 클램프)', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 2 });
    engine.start();
    engine.markStimulusRendered(clock.now() + 16);
    clock.advance(1);
    engine.input(clock.now());
    expect(engine.responses()[0].rtMs).toBe(0);
  });
});

// ---- 추가: closeSlackMs — 닫는 시점만 늦추고 허용 구간은 넓히지 않는다 ------------------------

describe('closeSlackMs', () => {
  const SLACK = THRESHOLDS.closeSlackMs;

  test('config에 있고 허용 구간보다 한참 짧다', () => {
    expect(SLACK).toBeGreaterThan(1);
    expect(SLACK).toBeLessThan(LEVELS[3].interTrialMs);
  });

  test('무반응 문항은 구간 끝 + closeSlackMs에 닫힌다 — 1ms 전에는 닫히지 않는다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3 + SLACK - 1);
    expect(hooks.onTrialComplete).not.toHaveBeenCalled();
    expect(engine.responses()).toEqual([]);
    clock.advance(1);
    expect(hooks.onTrialComplete).toHaveBeenCalledTimes(1);
    expect(engine.responses()).toHaveLength(1);
  });

  test('슬랙 값은 엔진을 만들 때 config에서 읽는다', () => {
    const original = THRESHOLDS.closeSlackMs;
    THRESHOLDS.closeSlackMs = 200;
    try {
      const { engine, clock, hooks } = setup({ trials: [goTrial(0)], level: 3 });
      engine.start();
      clock.advance(WINDOW_3 + 199);
      expect(hooks.onTrialComplete).not.toHaveBeenCalled();
      clock.advance(1);
      expect(hooks.onTrialComplete).toHaveBeenCalledTimes(1);
    } finally {
      THRESHOLDS.closeSlackMs = original;
    }
  });

  test.each([1, 10, SLACK - 1])('슬랙 안쪽(구간 끝 +%ims)의 이벤트 시각은 여전히 무효다', (offset) => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3 + offset);
    expect(hooks.onTrialComplete).not.toHaveBeenCalled();   // 아직 열려 있다
    engine.input(clock.now());                               // 이벤트 시각이 구간을 넘었다
    expect(engine.responses()).toEqual([{ index: 0, type: 'go', rtMs: null, extraTaps: 0, invalid: false }]);
    expect(hooks.onTrialComplete).toHaveBeenCalledTimes(1);
    expect(hooks.onTrialComplete.mock.calls[0][0]).toMatchObject({ rtMs: null });
  });

  test('구간을 넘은 입력이 문항을 닫을 때 남는 타이머는 간격 타이머 하나뿐이다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3 + 10);
    engine.input(clock.now());
    expect(clock.pending()).toBe(1);
    clock.advance(LEVELS[3].interTrialMs);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
    expect(hooks.onTrialComplete).toHaveBeenCalledTimes(1);   // 닫는 타이머가 문항을 두 번 닫지 않는다
  });

  test('이벤트 시각이 구간 안이면 핸들러가 닫는 타이머 직전(슬랙 안)에 늦게 실행돼도 유효한 반응이다', () => {
    const { engine, clock } = setup({ trials: [goTrial(0)], level: 3 });
    engine.start();
    clock.advance(WINDOW_3 + SLACK - 1);                     // 핸들러가 구간 끝 뒤에 실행된다
    engine.input(WINDOW_3 - 5);                               // 하지만 탭은 구간 안에서 일어났다
    expect(engine.responses()).toEqual([{ index: 0, type: 'go', rtMs: WINDOW_3 - 5, extraTaps: 0, invalid: false }]);
  });

  test('슬랙은 제시·간격 타이밍에 영향이 없다 — 반응한 문항은 반응 시각에서 interTrialMs 뒤에 다음 문항이 시작한다', () => {
    const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 3 });
    engine.start();
    clock.advance(300); engine.input(clock.now());
    clock.advance(LEVELS[3].interTrialMs - 1);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
    clock.advance(1);
    expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
  });
});
