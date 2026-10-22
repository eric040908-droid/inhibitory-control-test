// @vitest-environment jsdom
// 검사 한 번의 흐름: 설정 → (연습 → 재시도?) → 본 검사 → 회차 저장. 화면은 가짜 라우터로 대신한다.
import { TOOL_VERSION, TRIAL_COUNTS, THRESHOLDS } from '../js/config.js';
import { getTheme } from '../js/themes.js';
import { createFlow } from '../js/flow.js';
import { getSession, listSessions, lastSetup, saveLastSetup, setStorage } from '../js/storage.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

beforeEach(() => setStorage(memoryStorage()));
afterEach(() => setStorage(null));

const SETUP = { alias: '학생1', themeId: 'animal', length: 'medium', levelOverride: null };
const practiceResult = { hits: 5, goTrials: 5, correctRejections: 3, noGoTrials: 3, meanRt: 600, attempt: 1 };

function makeFlow(options = {}) {
  const calls = [];
  const router = { go: vi.fn((name, params) => { calls.push({ name, params }); }) };
  const goSetup = vi.fn();
  const onSessionEnd = vi.fn();
  const flow = createFlow({ router, goSetup, onSessionEnd, ...options });
  const last = () => calls.at(-1);
  return { flow, router, goSetup, onSessionEnd, calls, last };
}

describe('연습 → 본 검사', () => {
  test('난이도를 직접 정했으면 연습 없이 바로 본 검사로 간다', () => {
    const { flow, last, calls } = makeFlow();
    flow.start({ ...SETUP, levelOverride: 2 });
    expect(calls).toHaveLength(1);
    expect(last().name).toBe('test');
    expect(last().params.level).toBe(2);
    expect(last().params.theme).toEqual(getTheme('animal'));
    expect(last().params.trials).toHaveLength(TRIAL_COUNTS[2].medium);
  });

  test('난이도를 연습으로 정하면(null) 연습 1회차부터 시작한다', () => {
    const { flow, last } = makeFlow();
    flow.start(SETUP);
    expect(last().name).toBe('practice');
    expect(last().params.attempt).toBe(1);
    expect(last().params.theme).toEqual(getTheme('animal'));
  });

  test('연습이 재시도를 알리면 attempt를 올려 연습을 다시 띄운다', () => {
    const { flow, last, calls } = makeFlow();
    flow.start(SETUP);
    last().params.onDone({ level: null, retry: true, abort: false, recommendedLevel: null }, { ...practiceResult, attempt: 1 });
    expect(last().name).toBe('practice');
    expect(last().params.attempt).toBe(2);
    expect(calls.filter(c => c.name === 'test')).toHaveLength(0);
  });

  test('연습이 중단을 알리면 설정 화면으로 돌아가고 회차는 저장하지 않는다', () => {
    const { flow, last, goSetup, calls, onSessionEnd } = makeFlow();
    flow.start(SETUP);
    last().params.onDone({ level: null, retry: false, abort: true, recommendedLevel: null }, { ...practiceResult, hits: 0, attempt: 2 });
    expect(goSetup).toHaveBeenCalledTimes(1);
    expect(calls.map(c => c.name)).toEqual(['practice']);
    expect(onSessionEnd).not.toHaveBeenCalled();
  });

  test('연습이 정한 단계로 본 검사를 띄운다', () => {
    const { flow, last } = makeFlow();
    flow.start({ ...SETUP, length: 'short' });
    last().params.onDone({ level: 3, retry: false, abort: false, recommendedLevel: 3 }, practiceResult);
    expect(last().name).toBe('test');
    expect(last().params.level).toBe(3);
    expect(last().params.trials).toHaveLength(TRIAL_COUNTS[3].short);
  });

  test('본 검사 문항은 처음 firstGoTrials개가 Go다', () => {
    const { flow, last } = makeFlow();
    flow.start({ ...SETUP, levelOverride: 3 });
    const first = last().params.trials.slice(0, THRESHOLDS.firstGoTrials);
    expect(first.every(t => t.type === 'go')).toBe(true);
  });
});

describe('회차 저장', () => {
  function startAndFinish(options, setup = SETUP, recommendation = { level: 2, retry: false, abort: false, recommendedLevel: 2 }) {
    const harness = makeFlow(options);
    harness.flow.start(setup);
    if (setup.levelOverride === null) harness.last().params.onDone(recommendation, practiceResult);
    return harness;
  }

  test('완료하면 회차를 저장하고 onSessionEnd에 회차와 저장 결과를 넘긴다', () => {
    const saveSession = vi.fn(() => ({ ok: true }));
    const { last, onSessionEnd } = startAndFinish({ saveSession, collectDeviceInfo: () => ({ kind: 'phone' }) });
    const responses = [{ index: 0, type: 'go', rtMs: 500, extraTaps: 2, invalid: false }];
    last().params.onFinish(responses);

    // 저장은 onFinish 즉시 — 마무리 애니메이션(onCompleted)을 기다리지 않는다. 화면 이동은 그 뒤다.
    expect(saveSession).toHaveBeenCalledTimes(1);
    expect(onSessionEnd).not.toHaveBeenCalled();
    last().params.onCompleted();
    const session = saveSession.mock.calls[0][0];
    expect(session).toMatchObject({
      studentAlias: '학생1', themeId: 'animal', length: 'medium', level: 2, complete: true,
      trialCount: TRIAL_COUNTS[2].medium, toolVersion: TOOL_VERSION, device: { kind: 'phone' },
    });
    expect(session.responses).toBe(responses); // 엔진이 준 최종 배열 그대로
    expect(typeof session.id).toBe('string');
    expect(session.id).not.toBe('');
    expect(session.endedAt).toBeGreaterThanOrEqual(session.startedAt);
    expect(onSessionEnd).toHaveBeenCalledWith(session, { ok: true });
  });

  test('연습 결과는 회차에 추천 근거로 함께 저장된다 (추천값과 교사가 고른 값 모두)', () => {
    const saveSession = vi.fn(() => ({ ok: true }));
    const { last } = startAndFinish(
      { saveSession, collectDeviceInfo: () => ({}) },
      SETUP,
      { level: 1, retry: false, abort: false, recommendedLevel: 3 },
    );
    last().params.onFinish([]);
    expect(saveSession.mock.calls[0][0].practice).toEqual({ ...practiceResult, recommendedLevel: 3, chosenLevel: 1 });
    expect(saveSession.mock.calls[0][0].level).toBe(1);
  });

  test('난이도를 직접 정해 연습을 건너뛰면 practice는 null이다', () => {
    const saveSession = vi.fn(() => ({ ok: true }));
    const { last } = startAndFinish({ saveSession, collectDeviceInfo: () => ({}) }, { ...SETUP, levelOverride: 1 });
    last().params.onFinish([]);
    expect(saveSession.mock.calls[0][0].practice).toBeNull();
    expect(saveSession.mock.calls[0][0].level).toBe(1);
  });

  test('저장은 애니메이션이 끝나지 않아도 되어 있다: onCompleted가 영영 안 와도 회차는 저장소에 있다', () => {
    const { last, onSessionEnd } = startAndFinish({}, { ...SETUP, levelOverride: 2 });
    last().params.onFinish([{ index: 0, type: 'go', rtMs: 400, extraTaps: 0, invalid: false }]);
    const stored = listSessions('학생1');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ complete: true, studentAlias: '학생1' });
    expect(onSessionEnd).not.toHaveBeenCalled();
  });

  test('onCompleted가 두 번 와도 화면 이동은 한 번만이고, 완료 전에 오면 무시한다', () => {
    const { last, onSessionEnd } = startAndFinish({ saveSession: vi.fn(() => ({ ok: true })), collectDeviceInfo: () => ({}) }, { ...SETUP, levelOverride: 2 });
    last().params.onCompleted(); // onFinish 전: 저장된 회차가 없다
    expect(onSessionEnd).not.toHaveBeenCalled();
    last().params.onFinish([]);
    last().params.onCompleted();
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
  });

  test('중단하면 미완료 회차로 저장한다 (참여도 자체가 정보다)', () => {
    const saveSession = vi.fn(() => ({ ok: true }));
    const { last, onSessionEnd } = startAndFinish({ saveSession, collectDeviceInfo: () => ({}) });
    const partial = [{ index: 0, type: 'go', rtMs: null, extraTaps: 0, invalid: true }];
    last().params.onAbort(partial);
    const session = saveSession.mock.calls[0][0];
    expect(session.complete).toBe(false);
    expect(session.responses).toBe(partial);
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
  });

  test('저장이 실패해도 onSessionEnd는 불린다 (결과 화면은 보여야 한다)', () => {
    const saveSession = vi.fn(() => ({ ok: false, error: 'QuotaExceededError' }));
    const { last, onSessionEnd } = startAndFinish({ saveSession, collectDeviceInfo: () => ({}) });
    last().params.onFinish([]);
    last().params.onCompleted();
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(onSessionEnd.mock.calls[0][1]).toEqual({ ok: false, error: 'QuotaExceededError' });
  });

  test('실제 저장소에 들어가고 다시 읽힌다', () => {
    const { last, onSessionEnd } = startAndFinish({}, { ...SETUP, levelOverride: 2 });
    last().params.onFinish([{ index: 0, type: 'go', rtMs: 400, extraTaps: 1, invalid: false }]);
    last().params.onCompleted();
    const session = onSessionEnd.mock.calls[0][0];
    expect(onSessionEnd.mock.calls[0][1]).toEqual({ ok: true });
    expect(getSession(session.id)).toMatchObject({ studentAlias: '학생1', level: 2, complete: true });
    expect(getSession(session.id).responses[0].extraTaps).toBe(1);
  });
});

describe('지난 설정(lastSetup)', () => {
  test('연습이 추천한 단계를 lastSetup에 저장하지 않는다 (lastSetup.level은 교사의 수동 지정값 전용)', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: null, length: 'medium' });
    const { flow, last } = makeFlow();
    flow.start(SETUP);
    last().params.onDone({ level: 3, retry: false, abort: false, recommendedLevel: 3 }, practiceResult);
    last().params.onFinish([]);
    expect(lastSetup().level).toBeNull();
  });

  test('수동으로 정한 단계도 흐름이 바꾸지 않는다', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
    const { flow, last } = makeFlow();
    flow.start({ ...SETUP, levelOverride: 2 });
    last().params.onFinish([]);
    expect(lastSetup()).toEqual({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
  });
});
