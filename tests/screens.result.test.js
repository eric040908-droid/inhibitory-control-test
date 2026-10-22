// @vitest-environment jsdom
// 결과 화면. 맨 앞의 10개는 계획서의 테스트 그대로이고(헬퍼만 이 파일에서 정의한다), 그 아래는 경계 확인을 테스트로 남긴 것이다.
// 이 화면은 교사가 읽는 글이므로 문구도 테스트로 고정한다 — 숫자가 틀린 칸에 들어가면 지도 방향이 반대로 간다.

import { readFileSync } from 'node:fs';
import { LEVELS, THRESHOLDS, TOOL_VERSION, TRIAL_COUNTS } from '../js/config.js';
import { computeMetrics } from '../js/metrics.js';
import { evaluateBadge } from '../js/badge.js';
import { interpret } from '../js/interpretation.js';
import { setStorage, saveSession, listSessions } from '../js/storage.js';
import { createResultScreen, describeReason, classifyTrial, classifySaveError } from '../js/screens/result.js';

// ---- 하네스 ----------------------------------------------------------------------------
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

let nextIndex = 0;
let nextStart = 1_700_000_000_000;
let nextId = 0;
const make = (type, rtMs) => ({ index: nextIndex++, type, rtMs, extraTaps: 0, invalid: false });
const go = (rtMs) => make('go', rtMs);
const nogo = (rtMs) => make('nogo', rtMs);
const invalid = (type = 'go') => ({ ...make(type, null), invalid: true });

// 설정에 맞는 결정적 문항 열: 앞 firstGoTrials개는 Go, 그 뒤로 1/noGoRatio 간격마다 No-Go.
// Go는 정반응, No-Go는 대체로 참기 성공이고 다섯 번에 한 번 억제 실패다.
function defaultResponses(level, trialCount) {
  const period = Math.round(1 / LEVELS[level].noGoRatio);
  const list = [];
  let nogoSeen = 0;
  for (let i = 0; i < trialCount; i += 1) {
    const isNoGo = i >= THRESHOLDS.firstGoTrials && (i - THRESHOLDS.firstGoTrials) % period === period - 1;
    if (isNoGo) {
      nogoSeen += 1;
      list.push(nogo(nogoSeen % 5 === 0 ? 600 : null));
    } else {
      list.push(go(450 + ((i * 37) % 250)));
    }
  }
  return list;
}

function sessionFixture({
  id, studentAlias = '학생A', level = 2, themeId = 'animal', length = 'medium',
  trialCount, responses, complete = true, startedAt, endedAt, device, toolVersion = TOOL_VERSION, practice = null,
} = {}) {
  const count = trialCount ?? responses?.length ?? TRIAL_COUNTS[level][length];
  const start = startedAt ?? (nextStart += 60_000);
  return {
    id: id ?? `s-${nextId += 1}`,
    studentAlias,
    startedAt: start,
    endedAt: endedAt ?? start + 5 * 60_000 + 12_000,
    complete,
    level,
    themeId,
    length,
    trialCount: count,
    responses: responses ?? defaultResponses(level, count),
    practice,
    device: device === undefined
      ? { kind: 'phone', screenW: 390, screenH: 844, dpr: 3, browser: 'Chrome 152', inputKind: 'touch', refreshHzEst: 60 }
      : device,
    toolVersion,
  };
}

function seedSessions(list) {
  for (const partial of list) saveSession(sessionFixture(partial));
}

let screen = null;
let root = null;

function mountResult({ session, saveError, saveResult, onBack = vi.fn() } = {}) {
  root = document.createElement('div');
  document.body.append(root);
  screen = createResultScreen({});
  const result = saveResult ?? (saveError ? { ok: false, error: saveError } : undefined);
  screen.mount(root, { session, saveResult: result, onBack });
  return { root, onBack };
}

const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => [...document.querySelectorAll(sel)];
const text = (sel) => qs(sel)?.textContent ?? '';
const tile = (name) => qs(`[data-tile="${name}"]`);
const tileValue = (name) => tile(name).querySelector('[data-tile-value]').textContent.trim();
const tileNote = (name) => tile(name).querySelector('[data-tile-note]').textContent;
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

beforeEach(() => {
  nextIndex = 0;
  setStorage(memoryStorage());
  window.scrollTo = vi.fn(); // jsdom은 scrollTo를 구현하지 않아 부르면 콘솔에 오류를 찍는다
});

afterEach(() => {
  screen?.unmount?.();
  screen = null;
  document.body.replaceChildren();
  setStorage(null);
});

// ============================================================================================
// 계획서의 테스트 (원문 그대로)
// ============================================================================================
describe('계획서 테스트', () => {
  test('머리글에 난이도 단계와 테마, 실제 소요 시간, 문항 수, 도구 버전을 적는다', () => {
    mountResult({ session: sessionFixture({ level: 2, themeId: 'animal', trialCount: 65 }) });
    const head = document.querySelector('[data-report-header]').textContent;
    for (const s of ['2단계', '65']) expect(head).toContain(s);
  });

  test('억제 실패와 누락을 따로 보여준다', () => {
    mountResult({ session: sessionFixture({ responses: [nogo(300), go(null)] }) });
    expect(tileValue('commissions')).toBe('1');
    expect(tileValue('omissions')).toBe('1');
  });

  test('배지가 상태와 이유 문구를 함께 보여준다', () => {
    mountResult({ session: sessionFixture({ responses: Array(10).fill(go(null)) }) });
    expect(document.querySelector('[data-badge]').dataset.status).toBe('uninterpretable');
    expect(document.querySelector('[data-badge]').textContent.trim().length).toBeGreaterThan(0);
  });

  test('참아야 할 문항이 부족하면 억제 지표에 참고용 표시가 붙는다', () => {
    // Review Focus 4
    mountResult({ session: sessionFixture({ level: 1, length: 'short', trialCount: 18 }) });
    expect(document.querySelector('[data-tile="commissions"]').dataset.reference).toBe('true');
  });

  test('억제 실패와 조급 반응의 합이 문항 수를 넘을 수 있다는 설명을 둔다', () => {
    mountResult({ session: sessionFixture({ responses: [nogo(120)] }) });
    expect(document.body.textContent).toMatch(/중복/);
  });

  test('문항별 흐름 띠가 가로 스크롤되고 문항마다 막대가 하나다', () => {
    mountResult({ session: sessionFixture({ trialCount: 100 }) });
    const strip = document.querySelector('[data-trial-strip]');
    expect(strip.dataset.scroll).toBe('horizontal');
    expect(strip.querySelectorAll('[data-trial-bar]')).toHaveLength(100);
  });

  test('추이 그래프는 같은 단계의 완료 세션만 그린다', () => {
    seedSessions([{ level: 2, complete: true }, { level: 3, complete: true }, { level: 2, complete: false }]);
    mountResult({ session: sessionFixture({ level: 2, complete: true }) });
    expect(document.querySelectorAll('[data-trend-point]')).toHaveLength(2); // 기존 1개 + 현재 1개
  });

  test('기기 간 절대 반응시간 비교를 하지 말라는 안내가 있다', () => {
    mountResult({ session: sessionFixture({}) });
    expect(document.body.textContent).toMatch(/같은 기기/);
  });

  test('해석 불가 배지면 해석 문장을 보여주지 않는다', () => {
    mountResult({ session: sessionFixture({ responses: Array(10).fill(go(null)) }) });
    expect(document.querySelector('[data-interpretation]')).toBeNull();
  });

  test('저장에 실패한 회차는 그 사실을 알린다', () => {
    // Review Focus 1
    mountResult({ session: sessionFixture({}), saveError: '저장 공간이 부족합니다' });
    expect(document.body.textContent).toMatch(/저장/);
  });
});

// ============================================================================================
// 넘어온 요구 1: 설정 화면이 약속한 "결과의 억제 지표는 참고용으로만 표시됩니다"
// ============================================================================================
describe('No-Go 부족 → 참고용 표시 (설정 화면의 약속)', () => {
  const withNoGo = (n) => [...Array(10).fill(0).map(() => go(500)), ...Array(n).fill(0).map(() => nogo(null))];

  test('경계: No-Go가 minNoGoTrials 미만이면 참고용이고, 정확히 그 값이면 아니다', () => {
    const below = THRESHOLDS.minNoGoTrials - 1;
    mountResult({ session: sessionFixture({ responses: withNoGo(below) }) });
    expect(tile('commissions').dataset.reference).toBe('true');
    screen.unmount(); document.body.replaceChildren();

    mountResult({ session: sessionFixture({ responses: withNoGo(THRESHOLDS.minNoGoTrials) }) });
    expect(tile('commissions').dataset.reference).not.toBe('true');
  });

  test('참고용 표시는 글자로도 보인다 (색·속성만이 아니다)', () => {
    mountResult({ session: sessionFixture({ responses: withNoGo(3) }) });
    expect(tile('commissions').textContent).toMatch(/참고용/);
  });

  test('참고용은 억제 실패 타일에만 붙고, 정반응·누락·평균·일관성·조급 타일에는 붙지 않는다', () => {
    mountResult({ session: sessionFixture({ responses: withNoGo(3) }) });
    for (const name of ['hits', 'omissions', 'meanRt', 'consistency', 'anticipatory']) {
      expect(tile(name).dataset.reference).toBeUndefined();
      expect(tile(name).textContent).not.toMatch(/참고용/);
    }
  });

  test('전반/후반의 억제 실패 횟수에도 참고용이 붙는다 (반쪽은 No-Go가 더 적다)', () => {
    mountResult({ session: sessionFixture({ responses: withNoGo(3) }) });
    expect(qs('[data-halves]').dataset.reference).toBe('true');
    expect(text('[data-halves]')).toMatch(/참고용/);
  });

  test('1단계·짧게(18문항)와 2단계·짧게(22문항) 기본 조합은 모두 참고용이다 (스펙 §5.6)', () => {
    for (const [level, length] of [[1, 'short'], [2, 'short']]) {
      mountResult({ session: sessionFixture({ level, length }) });
      expect(tile('commissions').dataset.reference).toBe('true');
      screen.unmount(); document.body.replaceChildren();
    }
  });

  test('충분한 No-Go(2단계·길게 100문항)는 참고용이 아니다', () => {
    mountResult({ session: sessionFixture({ level: 2, length: 'long' }) });
    expect(tile('commissions').dataset.reference).toBeUndefined();
  });

  test('기준값은 config에서 읽는다: 기준을 낮추면 같은 회차가 참고용에서 풀린다', () => {
    const saved = THRESHOLDS.minNoGoTrials;
    try {
      THRESHOLDS.minNoGoTrials = 2;
      mountResult({ session: sessionFixture({ responses: withNoGo(3) }) });
      expect(tile('commissions').dataset.reference).toBeUndefined();
    } finally {
      THRESHOLDS.minNoGoTrials = saved;
    }
  });
});

// ============================================================================================
// 넘어온 요구 2: meanRt는 있는데 consistency가 null (정반응이 1개뿐)
// ============================================================================================
describe('정반응이 1개뿐인 회차 (meanRt는 있고 consistency는 null)', () => {
  test('전제: metrics가 실제로 그 조합을 만든다', () => {
    const m = computeMetrics([go(500), nogo(null)]);
    expect(m.meanRt).toBe(500);
    expect(m.consistency).toBeNull();
    expect(m.rtSd).toBeNull();
  });

  test('평균 반응속도는 값을 보이고, 일관성 타일은 "null"이나 NaN 없이 이유를 말한다', () => {
    mountResult({ session: sessionFixture({ responses: [go(500), nogo(null)] }) });
    expect(tileValue('meanRt')).toBe('500ms');
    expect(tileValue('consistency')).toBe('—');
    expect(tileNote('consistency')).toMatch(/정반응이 1개뿐/);
    const body = document.body.textContent;
    expect(body).not.toMatch(/null|undefined|NaN|Infinity/);
  });

  test('정반응이 2개 이상이면 일관성 라벨과 편차(ms)를 보인다', () => {
    mountResult({ session: sessionFixture({ responses: [go(600), go(620), go(590), nogo(null)] }) });
    expect(tileValue('consistency')).toBe('일정함');
    expect(tileNote('consistency')).toMatch(/\d+ms/);
  });

  test('일관성 라벨 세 가지가 모두 한국어 글자로 나온다', () => {
    const cases = [
      [[go(600), go(620), go(590)], '일정함'],
      [[go(500), go(800), go(500), go(800)], '보통'],
      [[go(300), go(900), go(1500)], '들쭉날쭉'],
    ];
    for (const [responses, label] of cases) {
      mountResult({ session: sessionFixture({ responses }) });
      expect(tileValue('consistency')).toBe(label);
      screen.unmount(); document.body.replaceChildren();
    }
  });

  test('정반응이 0개면 평균과 일관성이 모두 "—"이고 이유가 적힌다', () => {
    mountResult({ session: sessionFixture({ responses: [go(null), go(null), nogo(null)] }) });
    expect(tileValue('meanRt')).toBe('—');
    expect(tileValue('consistency')).toBe('—');
    expect(tileNote('meanRt')).toMatch(/정반응이 없어/);
    expect(tileNote('consistency')).toMatch(/정반응이 없어/);
  });
});

// ============================================================================================
// 넘어온 요구 3: interpret()가 빈 배열인 평범한 회차
// ============================================================================================
describe('해석 문장이 하나도 없는 회차', () => {
  // 억제 실패 3/10, 일관성 '보통', 누락·조급 없음 — 어느 규칙도 트립하지 않는다.
  // 30문항: Go 20(정반응, 500ms와 800ms를 번갈아) + No-Go 10(억제 실패 3 = 앞 절반 2, 뒤 절반 1). 'go go nogo'를 열 번 반복한다.
  function ordinaryResponses() {
    const commissionAt = new Set([1, 4, 8]); // No-Go의 0부터 센 순번
    const list = [];
    let goSeen = 0;
    let nogoSeen = 0;
    for (let i = 0; i < 30; i += 1) {
      if (i % 3 === 2) {
        list.push(nogo(commissionAt.has(nogoSeen) ? 600 : null));
        nogoSeen += 1;
      } else {
        list.push(go(goSeen % 2 === 0 ? 500 : 800));
        goSeen += 1;
      }
    }
    return list;
  }

  test('전제: 이 회차는 실제로 interpret() === [] 이고 해석 불가도 아니다', () => {
    const m = computeMetrics(ordinaryResponses());
    const badge = evaluateBadge(m);
    expect(badge.status).not.toBe('uninterpretable');
    expect(interpret(m, badge)).toEqual([]);
    expect([m.noGoTrials, m.commissions]).toEqual([10, 3]);
    expect(m.consistency).toBe('fair');
  });

  test('빈 영역을 남기지 않고, "해석할 특징이 없다"는 사실을 문장으로 말한다', () => {
    mountResult({ session: sessionFixture({ responses: ordinaryResponses() }) });
    const box = qs('[data-interpretation]');
    expect(box).not.toBeNull();
    expect(box.dataset.empty).toBe('true');
    expect(box.textContent).toMatch(/특징이 없/);
    expect(box.textContent.trim().length).toBeGreaterThan(20);
    expect(box.querySelectorAll('li, p').length).toBeGreaterThan(0);
  });

  test('"문제가 없다"는 뜻이 아니라고 덧붙인다 (진단이 아님)', () => {
    mountResult({ session: sessionFixture({ responses: ordinaryResponses() }) });
    expect(text('[data-interpretation]')).toMatch(/문제가 없다는 뜻이 아닙/);
  });

  test('문장이 있는 회차는 interpret()의 문장을 그대로 보이고 빈 상태 표시는 없다', () => {
    const responses = [go(300), go(900), go(1500), go(400), nogo(null), nogo(null), nogo(null), nogo(null), nogo(null), nogo(null), nogo(null), nogo(null)];
    const m = computeMetrics(responses);
    const expected = interpret(m, evaluateBadge(m));
    expect(expected.length).toBeGreaterThan(0);
    mountResult({ session: sessionFixture({ responses }) });
    const box = qs('[data-interpretation]');
    expect(box.dataset.empty).toBeUndefined();
    for (const sentence of expected) expect(box.textContent).toContain(sentence);
  });

  test('해석 문장 옆에 "진단이 아니라 수치를 말로 바꾼 것"이라는 안내가 있다', () => {
    const responses = [go(300), go(900), go(1500), go(400), ...Array(8).fill(0).map(() => nogo(null))];
    mountResult({ session: sessionFixture({ responses }) });
    expect(text('[data-interpretation]')).toMatch(/진단이 아니/);
  });

  test('No-Go가 부족한 회차의 해석에는 억제 문장을 참고로만 읽으라는 말이 붙는다', () => {
    mountResult({ session: sessionFixture({ responses: ordinaryResponses().slice(0, 12) }) });
    const m = computeMetrics(ordinaryResponses().slice(0, 12));
    expect(evaluateBadge(m).reasons).toContain('tooFewNoGo');
    expect(text('[data-interpretation]')).toMatch(/참고로만/);
  });
});

// ============================================================================================
// 넘어온 요구 4: refreshHzEst === null 은 "측정 안 함"과 "측정 실패"를 모두 뜻한다
// ============================================================================================
describe('측정 조건 표시', () => {
  const deviceWith = (extra) => ({ kind: 'phone', screenW: 390, screenH: 844, dpr: 3, browser: 'Chrome 152', inputKind: 'touch', refreshHzEst: 60, ...extra });

  test('주사율이 null이면 "알 수 없음"이라 적고, 측정 안 했거나 실패했다는 둘을 구분하지 못함을 밝힌다', () => {
    mountResult({ session: sessionFixture({ device: deviceWith({ refreshHzEst: null }) }) });
    const hz = text('[data-device-hz]');
    expect(hz).toMatch(/알 수 없음/);
    expect(hz).toMatch(/측정하지 않았|실패/);
    expect(hz).not.toMatch(/null/);
    expect(qs('[data-device-hz]').dataset.known).toBe('false');
  });

  test('주사율이 있으면 Hz로 적는다', () => {
    mountResult({ session: sessionFixture({ device: deviceWith({ refreshHzEst: 120 }) }) });
    expect(text('[data-device-hz]')).toContain('120Hz');
    expect(qs('[data-device-hz]').dataset.known).toBe('true');
  });

  test('기기·브라우저·입력 수단·화면 크기·도구 버전이 보인다', () => {
    mountResult({ session: sessionFixture({ toolVersion: '9.9.9' }) });
    const box = text('[data-conditions]');
    for (const s of ['스마트폰', 'Chrome 152', '터치', '390', '844', '9.9.9']) expect(box).toContain(s);
  });

  test('기기 정보가 통째로 없어도(가져온 옛 회차) 던지지 않고 "알 수 없음"으로 채운다', () => {
    expect(() => mountResult({ session: sessionFixture({ device: null }) })).not.toThrow();
    expect(text('[data-conditions]')).toMatch(/알 수 없음/);
    expect(document.body.textContent).not.toMatch(/undefined|null|NaN/);
  });

  test('주의 문구: 같은 학생이 같은 기기에서 반복 측정한 회차 간 비교만 보장한다', () => {
    mountResult({ session: sessionFixture({}) });
    const box = text('[data-conditions]');
    expect(box).toMatch(/기기마다 터치 지연이 달라/);
    expect(box).toMatch(/같은 학생이 같은 기기에서 반복 측정한 회차 간 비교/);
  });

  test('주의 문구: CSV를 분석할 때는 invalid=0인 행만 센다', () => {
    mountResult({ session: sessionFixture({}) });
    expect(text('[data-conditions]')).toMatch(/invalid=0/);
  });

  // 엔진은 진행 중이던 문항을 화면이 가려질 때(pause)와 검사를 중단할 때(abort) 무효로 닫는다. 글이 가려짐만 탓하면, 중단한 회차를 본
  // 교사가 알림을 끄라는 말을 듣는다.
  describe('무효 문항의 원인을 가려짐만으로 말하지 않는다', () => {
    const NOTIFICATION_ADVICE = /알림과 다른 앱을 끄고/;

    test('범례: 가려짐과 중단을 함께 말한다', () => {
      mountResult({ session: sessionFixture({ responses: [go(500), invalid()] }) });
      const legend = text('[data-trial-legend]');
      expect(legend).toMatch(/가려졌거나 검사를 중단/);
    });

    test('tooManyInvalid 안내: 중단도 원인으로 말하고, 중단한 회차라면 앞부분만 본 것으로 읽으라 하며, 알림 조언은 중단하지 않은 경우로 한정한다', () => {
      const m = computeMetrics([go(500), invalid(), invalid(), go(500)]);
      const s = describeReason('tooManyInvalid', m);
      expect(s).toMatch(/중단/);
      expect(s).toMatch(/화면이 가려지거나/);
      expect(s).toMatch(/중단한 회차라면/);
      expect(s).toMatch(/중단한 적이 없는데/);
      expect(s).toMatch(NOTIFICATION_ADVICE);
    });

    test('중단한 회차가 짧아서 무효 비율이 기준을 넘은 경우, 배지 이유가 중단을 말한다 (알림 얘기만 하지 않는다)', () => {
      // 중단 직전 진행 중이던 한 문항이 무효로 남아 4문항 중 1개(25%)가 된 회차
      const responses = [go(500), go(520), nogo(null), invalid()];
      mountResult({ session: sessionFixture({ complete: false, responses, trialCount: 30 }) });
      const reason = qs('[data-reason="tooManyInvalid"]');
      expect(reason).not.toBeNull();
      expect(reason.textContent).toMatch(/중단/);
      expect(qs('[data-notice="aborted"]')).not.toBeNull();
    });

    test('모든 문항이 무효인 회차의 해석 안내도 중단을 말한다', () => {
      mountResult({ session: sessionFixture({ complete: false, responses: [invalid(), invalid()], trialCount: 30 }) });
      expect(text('[data-interpretation]')).toMatch(/검사를 중단/);
    });

    test('측정 조건 구역의 CSV 안내도 중단으로 빠진 문항을 말한다', () => {
      mountResult({ session: sessionFixture({ responses: [go(500), invalid(), invalid()] }) });
      expect(text('[data-conditions]')).toMatch(/가려지거나 검사를 중단해 무효가 된 문항/);
    });
  });

  test('이번 회차의 무효 문항 수를 적는다', () => {
    mountResult({ session: sessionFixture({ responses: [go(500), invalid(), invalid(), nogo(null)] }) });
    expect(text('[data-conditions]')).toMatch(/무효 문항은 2개/);
  });
});

// ============================================================================================
// 넘어온 요구 5: 저장 실패 알림
// ============================================================================================
describe('저장 실패 알림', () => {
  test('실패한 회차는 눈에 띄는 안내 상자에 사유와 함께 나오고, 화면 맨 위(머리글보다 앞)에 있다', () => {
    mountResult({ session: sessionFixture({}), saveError: 'QuotaExceededError: full' });
    const box = qs('[data-notice="save-failed"]');
    expect(box).not.toBeNull();
    expect(box.textContent).toMatch(/저장되지 않았/);
    expect(box.textContent).toContain('QuotaExceededError: full');
    expect(box.compareDocumentPosition(qs('[data-report-header]')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('안내는 "이 화면을 닫으면 찾을 수 없다"와 지금 할 수 있는 일을 말한다', () => {
    mountResult({ session: sessionFixture({}), saveError: 'x' });
    const t = text('[data-notice="save-failed"]');
    expect(t).toMatch(/기기에 남지 않/);
    expect(t).toMatch(/캡처|화면을 찍/);
  });

  test('저장에 성공했거나 저장 결과를 모르는 경우(이력에서 연 회차)에는 안내가 없다', () => {
    mountResult({ session: sessionFixture({}), saveResult: { ok: true } });
    expect(qs('[data-notice="save-failed"]')).toBeNull();
    screen.unmount(); document.body.replaceChildren();
    mountResult({ session: sessionFixture({}) });
    expect(qs('[data-notice="save-failed"]')).toBeNull();
  });

  test('오류 사유가 비어 있어도 안내는 나온다', () => {
    mountResult({ session: sessionFixture({}), saveResult: { ok: false } });
    expect(qs('[data-notice="save-failed"]')).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });
});

// ============================================================================================
// 넘어온 요구 6: 낡은 테마 id
// ============================================================================================
describe('지금 없는 테마 id', () => {
  test('던지지 않고 머리글에 id와 "목록에 없음"을 적는다', () => {
    expect(() => mountResult({ session: sessionFixture({ themeId: 'retired-theme' }) })).not.toThrow();
    const head = text('[data-report-header]');
    expect(head).toContain('retired-theme');
    expect(head).toMatch(/목록에 없는 테마/);
  });

  test('알려진 테마는 이름을 적는다', () => {
    mountResult({ session: sessionFixture({ themeId: 'vehicle' }) });
    expect(text('[data-report-header]')).toContain('탈것');
  });

  test('테마 id가 아예 없어도 던지지 않는다', () => {
    const session = sessionFixture({});
    delete session.themeId;
    expect(() => mountResult({ session })).not.toThrow();
    expect(document.body.textContent).not.toMatch(/undefined/);
  });
});

// ============================================================================================
// 배지: 이유 코드 5개 → 교사용 한국어 문구
// ============================================================================================
describe('배지 이유 문구', () => {
  const REASONS = ['anticipatory', 'omission', 'consecutiveOmissions', 'tooFewNoGo', 'tooManyInvalid'];
  const hasHangul = (s) => /[가-힣]/.test(s);

  test('모든 이유 코드가 한국어 문장으로 바뀌고, 코드 이름이 화면에 새지 않는다', () => {
    const m = computeMetrics([go(100), go(null), nogo(null)]);
    for (const code of REASONS) {
      const sentence = describeReason(code, m);
      expect(hasHangul(sentence)).toBe(true);
      expect(sentence).not.toContain(code);
      expect(sentence.length).toBeGreaterThan(20);
    }
  });

  test('모르는 이유 코드도 던지지 않고 읽을 수 있는 문구를 낸다', () => {
    const m = computeMetrics([go(500)]);
    const sentence = describeReason('somethingNew', m);
    expect(hasHangul(sentence)).toBe(true);
    expect(sentence).toContain('somethingNew');
  });

  test('기준값을 config에서 가져와 문구에 넣는다 (하드코딩하지 않는다)', () => {
    const m = computeMetrics([go(null), go(500)]);
    const saved = THRESHOLDS.omissionRate;
    try {
      THRESHOLDS.omissionRate = 0.35;
      expect(describeReason('omission', m)).toContain('35%');
    } finally {
      THRESHOLDS.omissionRate = saved;
    }
    expect(describeReason('omission', m)).toContain(`${Math.round(THRESHOLDS.omissionRate * 100)}%`);
    expect(describeReason('consecutiveOmissions', m)).toContain(String(THRESHOLDS.consecutiveOmissions));
    expect(describeReason('tooFewNoGo', m)).toContain(String(THRESHOLDS.minNoGoTrials));
    expect(describeReason('anticipatory', m)).toContain(`${Math.round(THRESHOLDS.anticipatoryRate * 100)}%`);
    expect(describeReason('tooManyInvalid', m)).toContain(`${Math.round(THRESHOLDS.invalidTrialRate * 100)}%`);
  });

  test('문구가 실제 수치를 말한다 (누락 3/10, 조급 반응 비율 등)', () => {
    const m = computeMetrics([go(null), go(null), go(null), ...Array(7).fill(0).map(() => go(500))]);
    expect(describeReason('omission', m)).toMatch(/10개 중 3개/);
    const n = computeMetrics([nogo(null), nogo(null), nogo(null), go(500)]);
    expect(describeReason('tooFewNoGo', n)).toMatch(/3개/);
  });

  test.each([
    ['anticipatory', [go(100), go(120), go(500), go(500)]],
    ['omission', [go(null), go(null), go(500), nogo(null)]],
    ['consecutiveOmissions', [go(500), go(500), go(500), go(500), go(500), go(500), go(null), go(null), go(null), go(null), go(null), go(500), go(500), go(500), go(500), go(500), go(500), go(500)]],
    ['tooFewNoGo', [go(500), go(500), nogo(null)]],
    ['tooManyInvalid', [go(500), invalid(), invalid(), go(500), go(500), go(500)]],
  ])('%s: 그 조건이 걸린 회차의 배지에 이유 항목이 한국어로 나온다', (code, responses) => {
    mountResult({ session: sessionFixture({ responses }) });
    const item = qs(`[data-badge] [data-reason="${code}"]`);
    expect(item).not.toBeNull();
    expect(hasHangul(item.textContent)).toBe(true);
    expect(item.textContent).not.toContain(code);
  });

  test('이유가 여럿이면 모두 나온다', () => {
    mountResult({ session: sessionFixture({ responses: [go(100), go(null), go(null), nogo(null)] }) });
    const codes = qsa('[data-badge] [data-reason]').map((el) => el.dataset.reason);
    expect(codes).toEqual(expect.arrayContaining(['anticipatory', 'omission', 'tooFewNoGo']));
  });

  test('상태마다 이름이 다르고 "양호"일 때는 이유 목록 대신 기준 안이라는 문장이 나온다', () => {
    mountResult({ session: sessionFixture({ level: 2, length: 'long' }) });
    const badge = qs('[data-badge]');
    expect(badge.dataset.status).toBe('ok');
    expect(badge.textContent).toMatch(/양호/);
    expect(badge.querySelectorAll('[data-reason]')).toHaveLength(0);
    expect(badge.textContent).toMatch(/기준 안/);
  });

  test('상태 이름: 해석 불가 / 해석 주의 / 억제 지표 참고용', () => {
    const cases = [
      [Array(10).fill(0).map(() => go(null)), '해석 불가'],
      [[go(100), go(120), go(130), go(500), ...Array(8).fill(0).map(() => nogo(null))], '해석 주의'],
      [[...Array(10).fill(0).map(() => go(500)), nogo(null)], '억제 지표 참고용'],
    ];
    for (const [responses, label] of cases) {
      mountResult({ session: sessionFixture({ responses }) });
      expect(text('[data-badge]')).toContain(label);
      screen.unmount(); document.body.replaceChildren();
    }
  });

  test('배지는 글자 기호도 함께 쓴다 (색만으로 구분하지 않는다)', () => {
    mountResult({ session: sessionFixture({ level: 2, length: 'long' }) });
    expect(qs('[data-badge] [data-badge-symbol]').textContent.trim().length).toBeGreaterThan(0);
  });
});

// ============================================================================================
// 요약 타일
// ============================================================================================
describe('요약 타일 6개', () => {
  test('라벨과 순서: 억제 실패 → 정반응 → 누락 → 평균 반응속도 → 반응 일관성 → 조급 반응', () => {
    mountResult({ session: sessionFixture({}) });
    const order = qsa('[data-tile]').map((el) => [el.dataset.tile, el.querySelector('[data-tile-label]').textContent.trim()]);
    expect(order).toEqual([
      ['commissions', '억제 실패'],
      ['hits', '정반응'],
      ['omissions', '누락'],
      ['meanRt', '평균 반응속도'],
      ['consistency', '반응 일관성'],
      ['anticipatory', '조급 반응'],
    ]);
  });

  test('억제 실패는 "참아야 할 때 누름", 누락은 "눌러야 할 때 안 누름"이라고 풀어 쓰고 주의력 문제임을 밝힌다', () => {
    mountResult({ session: sessionFixture({}) });
    expect(text('[data-tile="commissions"]')).toContain('참아야 할 때 누름');
    expect(text('[data-tile="omissions"]')).toContain('눌러야 할 때 안 누름');
    expect(text('[data-tile="omissions"]')).toMatch(/주의력/);
    expect(text('[data-tile="commissions"]')).not.toMatch(/주의력/);
  });

  test('각 타일이 Metrics의 정확한 필드를 읽는다 (칸이 뒤바뀌면 처방이 반대가 된다)', () => {
    // 억제 실패 2, 참기 성공 1, 정반응 3, 누락 2, 조급 Go 1 — 서로 다른 값으로 만들어 뒤바뀜을 잡는다.
    const responses = [
      nogo(400), nogo(500), nogo(null),
      go(500), go(700), go(900), go(null), go(null), go(150),
    ];
    const m = computeMetrics(responses);
    mountResult({ session: sessionFixture({ responses }) });
    expect(tileValue('commissions')).toBe(String(m.commissions));
    expect(tileValue('hits')).toBe(String(m.hits));
    expect(tileValue('omissions')).toBe(String(m.omissions));
    expect(tileValue('anticipatory')).toBe(String(m.anticipatory));
    expect(tileValue('meanRt')).toBe(`${Math.round(m.meanRt)}ms`);
    expect([m.commissions, m.hits, m.omissions, m.anticipatory]).toEqual([2, 3, 2, 1]);
  });

  test('분모를 함께 적는다: 억제 실패는 참아야 할 그림 수, 정반응·누락은 눌러야 할 그림 수, 조급은 전체 문항', () => {
    mountResult({ session: sessionFixture({ responses: [nogo(400), nogo(null), nogo(null), go(500), go(null)] }) });
    expect(tileNote('commissions')).toMatch(/참아야 할 그림 3개 중/);
    expect(tileNote('hits')).toMatch(/눌러야 할 그림 2개 중/);
    expect(tileNote('omissions')).toMatch(/눌러야 할 그림 2개 중/);
    expect(tileNote('anticipatory')).toMatch(/전체 5문항 중/);
  });

  test('Go 문항의 조급 반응은 정반응도 누락도 아니라는 점을 정반응 타일이 알려준다', () => {
    mountResult({ session: sessionFixture({ responses: [go(100), go(500), go(null)] }) });
    expect(tileNote('hits')).toMatch(/1개는 .*조급/);
  });

  test('조급 반응 타일은 기준 시간을 THRESHOLDS에서 가져와 말한다', () => {
    mountResult({ session: sessionFixture({}) });
    expect(text('[data-tile="anticipatory"]')).toContain(`${THRESHOLDS.anticipatoryMs / 1000}초`);
  });

  test('억제 실패 타일이 가장 눈에 띄게 둔다 (primary 표시)', () => {
    mountResult({ session: sessionFixture({}) });
    expect(tile('commissions').dataset.primary).toBe('true');
    expect(qsa('[data-tile][data-primary="true"]')).toHaveLength(1);
  });

  test('중복 계상 설명이 항상 있고, 합이 문항 수를 넘을 수 있음을 말한다', () => {
    mountResult({ session: sessionFixture({}) });
    const note = text('[data-overlap-note]');
    expect(note).toMatch(/중복/);
    expect(note).toMatch(/억제 실패/);
    expect(note).toMatch(/조급 반응/);
    expect(note).toMatch(/넘을 수/);
  });

  describe('빈 회차', () => {
    const mustNotLeak = () => expect(document.body.textContent).not.toMatch(/null|undefined|NaN|Infinity/);

    test('문항 0개: 던지지 않고 모든 타일이 "—"', () => {
      expect(() => mountResult({ session: sessionFixture({ responses: [], trialCount: 0 }) })).not.toThrow();
      for (const name of ['commissions', 'hits', 'omissions', 'meanRt', 'consistency', 'anticipatory']) {
        expect(tileValue(name)).toBe('—');
      }
      expect(qsa('[data-trial-bar]')).toHaveLength(0);
      mustNotLeak();
    });

    test('전원 무효: 타일은 "—"이고 무효 문항 수가 보이고 배지는 주의 이상', () => {
      mountResult({ session: sessionFixture({ responses: [invalid(), invalid('nogo'), invalid()] }) });
      expect(tileValue('commissions')).toBe('—');
      expect(tileValue('anticipatory')).toBe('—');
      expect(qs('[data-badge]').dataset.status).not.toBe('ok');
      expect(qsa('[data-trial-bar][data-kind="invalid"]')).toHaveLength(3);
      expect(text('[data-conditions]')).toMatch(/무효 문항은 3개/);
      mustNotLeak();
    });

    test('No-Go가 0개: 억제 실패는 0이 아니라 "—"이고 참아야 할 그림이 없었다고 말한다', () => {
      mountResult({ session: sessionFixture({ responses: [go(500), go(600), go(null)] }) });
      expect(tileValue('commissions')).toBe('—');
      expect(tileNote('commissions')).toMatch(/참아야 할 그림이 없었/);
      expect(tile('commissions').dataset.reference).toBe('true');
      mustNotLeak();
    });

    test('Go가 0개: 정반응·누락이 "—"이고 눌러야 할 그림이 없었다고 말한다', () => {
      mountResult({ session: sessionFixture({ responses: [nogo(null), nogo(400)] }) });
      expect(tileValue('hits')).toBe('—');
      expect(tileValue('omissions')).toBe('—');
      expect(tileNote('omissions')).toMatch(/눌러야 할 그림이 없었/);
      expect(tileValue('commissions')).toBe('1');
      mustNotLeak();
    });

    test('Go 정반응 0개(전부 누락): 평균·일관성 "—", 누락은 숫자', () => {
      mountResult({ session: sessionFixture({ responses: [go(null), go(null), nogo(null)] }) });
      expect(tileValue('omissions')).toBe('2');
      expect(tileValue('hits')).toBe('0');
      expect(tileValue('meanRt')).toBe('—');
      mustNotLeak();
    });

    test('빈 회차의 전반/후반, 추이, 해석도 던지지 않는다', () => {
      mountResult({ session: sessionFixture({ responses: [] }) });
      expect(qs('[data-halves]')).not.toBeNull();
      expect(qs('[data-trend]')).not.toBeNull();
      mustNotLeak();
    });
  });

  test('responses가 배열이 아니거나 문항 일부가 깨져 있어도(가져온 옛 회차) 던지지 않는다', () => {
    const broken = sessionFixture({});
    broken.responses = [null, { type: 'go' }, { type: 'x', rtMs: 3 }, go('abc'), go(500)];
    expect(() => mountResult({ session: broken })).not.toThrow();
    screen.unmount(); document.body.replaceChildren();
    const noResponses = sessionFixture({});
    delete noResponses.responses;
    expect(() => mountResult({ session: noResponses })).not.toThrow();
    expect(document.body.textContent).not.toMatch(/NaN|undefined/);
  });
});

// ============================================================================================
// 문항별 흐름 띠
// ============================================================================================
describe('문항별 흐름 띠', () => {
  test('100문항이면 막대 100개, 전체 축소 요약의 칸도 100개', () => {
    mountResult({ session: sessionFixture({ trialCount: 100 }) });
    expect(qsa('[data-trial-bar]')).toHaveLength(100);
    expect(qsa('[data-trial-overview] [data-overview-cell]')).toHaveLength(100);
  });

  test('축소 요약은 스크롤 띠 위에 있고, 요약 칸은 막대로 세지 않는다', () => {
    mountResult({ session: sessionFixture({ trialCount: 100 }) });
    const overview = qs('[data-trial-overview]');
    const strip = qs('[data-trial-strip]');
    expect(overview.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(overview.contains(strip)).toBe(false);
    expect(strip.querySelectorAll('[data-overview-cell]')).toHaveLength(0);
  });

  test('막대 종류 6가지: 정반응 / 조급 / 참기 성공 / 억제 실패 / 누락 / 무효', () => {
    const responses = [go(500), go(120), nogo(null), nogo(400), go(null), invalid()];
    mountResult({ session: sessionFixture({ responses }) });
    expect(qsa('[data-trial-bar]').map((el) => el.dataset.kind)).toEqual([
      'hit', 'early', 'correctRejection', 'commission', 'omission', 'invalid',
    ]);
  });

  test('색만으로 구분하지 않는다: 종류마다 다른 글자 기호와 고/노 표시가 막대 안에 있다', () => {
    const responses = [go(500), go(120), nogo(null), nogo(400), go(null), invalid()];
    mountResult({ session: sessionFixture({ responses }) });
    const marks = qsa('[data-trial-bar]').map((el) => el.querySelector('[data-mark]').textContent.trim());
    expect(marks.every((m) => m.length > 0)).toBe(true);
    expect(new Set(marks).size).toBe(6);
    const types = qsa('[data-trial-bar]').map((el) => el.querySelector('[data-type-label]').textContent.trim());
    expect(types).toEqual(['고', '고', '노', '노', '고', '고']);
  });

  test('막대 높이는 반응시간에 비례하고, 반응이 없는 문항에는 높이 막대가 없다', () => {
    mountResult({ session: sessionFixture({ responses: [go(1000), go(500), go(null), nogo(null)] }) });
    const bars = qsa('[data-trial-bar]');
    const h = (el) => parseFloat(el.querySelector('[data-bar-fill]').style.height);
    expect(h(bars[0])).toBeCloseTo(100);
    expect(h(bars[1])).toBeCloseTo(50);
    expect(bars[2].querySelector('[data-bar-fill]').dataset.empty).toBe('true');
    expect(bars[3].querySelector('[data-bar-fill]').dataset.empty).toBe('true');
  });

  test('범례: 여섯 종류를 글자로 설명하고, 가장 높은 막대가 몇 ms인지 적는다', () => {
    mountResult({ session: sessionFixture({ responses: [go(1000), go(500)] }) });
    const legend = text('[data-trial-legend]');
    for (const s of ['정반응', '조급', '참기 성공', '억제 실패', '누락', '무효']) expect(legend).toContain(s);
    expect(text('[data-trial-strip-scale]')).toContain('1000ms');
  });

  test('막대마다 읽을 수 있는 설명(번째, 종류, 반응시간)이 붙는다', () => {
    mountResult({ session: sessionFixture({ responses: [go(500), nogo(null)] }) });
    const [first, second] = qsa('[data-trial-bar]');
    expect(first.getAttribute('aria-label')).toMatch(/1번째.*정반응.*500ms/);
    expect(second.getAttribute('aria-label')).toMatch(/2번째.*참기 성공/);
  });

  test('분류는 metrics.js와 같다: 무작위 문항 열에서 종류별 개수가 Metrics와 일치한다', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let round = 0; round < 25; round += 1) {
      const responses = [];
      for (let i = 0; i < 40; i += 1) {
        const type = rand() < 0.3 ? 'nogo' : 'go';
        const r = rand();
        let rtMs;
        if (r < 0.2) rtMs = null;
        else if (r < 0.35) rtMs = Math.floor(rand() * THRESHOLDS.anticipatoryMs); // 조급
        else if (r < 0.4) rtMs = THRESHOLDS.anticipatoryMs; // 경계값: 정확히 기준은 정반응
        else rtMs = THRESHOLDS.anticipatoryMs + Math.floor(rand() * 800);
        const bad = rand() < 0.1;
        responses.push({ index: i, type, rtMs: bad ? null : rtMs, extraTaps: 0, invalid: bad });
      }
      const m = computeMetrics(responses);
      const kinds = responses.map(classifyTrial);
      const count = (k) => kinds.filter((x) => x === k).length;
      expect(count('hit')).toBe(m.hits);
      expect(count('omission')).toBe(m.omissions);
      expect(count('commission')).toBe(m.commissions);
      expect(count('correctRejection')).toBe(m.correctRejections);
      expect(count('invalid')).toBe(m.invalidTrials);
      // 조급 반응 = Go 조급('early') + 조급인 억제 실패
      const earlyNoGo = responses.filter((r) => !r.invalid && r.type === 'nogo' && r.rtMs !== null && r.rtMs < THRESHOLDS.anticipatoryMs).length;
      expect(count('early') + earlyNoGo).toBe(m.anticipatory);
    }
  });

  test('경계: 정확히 200ms인 Go 반응은 정반응이고 199ms는 조급이다', () => {
    expect(classifyTrial(go(THRESHOLDS.anticipatoryMs))).toBe('hit');
    expect(classifyTrial(go(THRESHOLDS.anticipatoryMs - 1))).toBe('early');
  });

  test('No-Go의 조급 반응은 억제 실패 막대로 그린다 (조급 막대가 아니다)', () => {
    expect(classifyTrial(nogo(120))).toBe('commission');
  });
});

// ============================================================================================
// 머리글
// ============================================================================================
describe('머리글', () => {
  test('학생·회차·날짜·테마·단계·소요 시간·문항 수·도구 버전이 모두 보인다', () => {
    const startedAt = new Date(2026, 9, 21, 14, 5).getTime();
    mountResult({
      session: sessionFixture({ studentAlias: '하늘이', themeId: 'animal', level: 3, startedAt, endedAt: startedAt + (7 * 60 + 5) * 1000, trialCount: 85, toolVersion: '0.1.0' }),
    });
    const head = text('[data-report-header]');
    for (const s of ['하늘이', '2026-10-21 14:05', '동물', '3단계', '7분 5초', '85문항', '0.1.0']) expect(head).toContain(s);
  });

  test('회차 번호는 그 학생의 시작 시각 순서다 (저장 여부와 무관하게 센다)', () => {
    seedSessions([{ studentAlias: '하늘이' }, { studentAlias: '하늘이', complete: false }, { studentAlias: '다른학생' }]);
    mountResult({ session: sessionFixture({ studentAlias: '하늘이' }) });
    expect(text('[data-report-header]')).toMatch(/3회차/);
  });

  test('이미 저장된 회차를 열어도 회차 번호가 밀리지 않는다', () => {
    seedSessions([{ studentAlias: '하늘이' }]);
    const second = sessionFixture({ studentAlias: '하늘이' });
    saveSession(second);
    mountResult({ session: second });
    expect(text('[data-report-header]')).toMatch(/2회차/);
  });

  test('소요 시간: 1분 미만은 초만, 끝 시각이 없으면 "알 수 없음"', () => {
    const t = Date.now();
    mountResult({ session: sessionFixture({ startedAt: t, endedAt: t + 42_000 }) });
    expect(text('[data-report-header]')).toContain('42초');
    screen.unmount(); document.body.replaceChildren();
    const s = sessionFixture({ startedAt: t });
    delete s.endedAt;
    mountResult({ session: s });
    expect(text('[data-report-header]')).toMatch(/소요 시간.*알 수 없음/);
  });

  test('난이도 단계가 다른 회차와 수치를 비교하지 말라는 한 줄이 머리글에 있다', () => {
    mountResult({ session: sessionFixture({}) });
    expect(text('[data-report-header]')).toMatch(/단계가 다른 회차/);
  });

  test('중단된 회차는 머리글과 안내 상자에 "중단"으로 보이고 진행한 문항 수를 적는다', () => {
    mountResult({ session: sessionFixture({ complete: false, trialCount: 65, responses: defaultResponses(2, 20) }) });
    expect(text('[data-report-header]')).toMatch(/중단/);
    const box = text('[data-notice="aborted"]');
    expect(box).toMatch(/20문항/);
    expect(box).toMatch(/65문항/);
    expect(box).toMatch(/추이에 포함되지 않/);
  });

  test('완료된 회차에는 중단 안내가 없다', () => {
    mountResult({ session: sessionFixture({}) });
    expect(qs('[data-notice="aborted"]')).toBeNull();
    expect(text('[data-report-header]')).not.toMatch(/중단/);
  });
});

// ============================================================================================
// 전반 vs 후반
// ============================================================================================
describe('전반 vs 후반', () => {
  test('앞 절반과 뒤 절반의 억제 실패 횟수와 평균 반응속도를 나란히 보인다', () => {
    const responses = [go(400), nogo(500), go(600), nogo(null), go(800), nogo(500), nogo(500), go(1000)];
    const m = computeMetrics(responses);
    mountResult({ session: sessionFixture({ responses }) });
    expect(qs('[data-half="first"] [data-half-commissions]').textContent.trim()).toBe(String(m.halves.first.commissions));
    expect(qs('[data-half="second"] [data-half-commissions]').textContent.trim()).toBe(String(m.halves.second.commissions));
    expect(qs('[data-half="first"] [data-half-meanrt]').textContent.trim()).toBe(`${Math.round(m.halves.first.meanRt)}ms`);
    expect(qs('[data-half="second"] [data-half-meanrt]').textContent.trim()).toBe(`${Math.round(m.halves.second.meanRt)}ms`);
    expect([m.halves.first.commissions, m.halves.second.commissions]).toEqual([1, 2]);
  });

  test('한쪽 절반에 정반응이 없으면 그 평균은 "—"', () => {
    mountResult({ session: sessionFixture({ responses: [go(500), go(600), nogo(null), nogo(500)] }) });
    expect(qs('[data-half="second"] [data-half-meanrt]').textContent.trim()).toBe('—');
  });

  test('유효 문항 기준 절반이라는 설명이 있다', () => {
    mountResult({ session: sessionFixture({}) });
    expect(text('[data-halves]')).toMatch(/유효 문항/);
  });
});

// ============================================================================================
// 회차별 추이
// ============================================================================================
describe('회차별 추이', () => {
  test('같은 학생의 같은 단계 완료 회차만 그린다: 다른 학생·다른 단계·중단 회차는 빠진다', () => {
    seedSessions([
      { level: 2, complete: true },
      { level: 2, complete: true, studentAlias: '다른학생' },
      { level: 3, complete: true },
      { level: 2, complete: false },
    ]);
    mountResult({ session: sessionFixture({ level: 2 }) });
    expect(qsa('[data-trend-point]')).toHaveLength(2);
  });

  test('이 학생·이 단계의 완료 회차가 지금 회차 하나뿐이면 점 하나와 "추이를 그릴 수 없다"는 안내', () => {
    seedSessions([{ level: 3, complete: true }, { level: 2, complete: false }]);
    mountResult({ session: sessionFixture({ level: 2 }) });
    expect(qsa('[data-trend-point]')).toHaveLength(1);
    expect(qs('[data-trend-point]').dataset.current).toBe('true');
    expect(text('[data-trend]')).toMatch(/하나뿐/);
  });

  test('저장소가 비어 있어도(저장 실패) 지금 회차 하나로 던지지 않는다', () => {
    mountResult({ session: sessionFixture({}), saveError: 'full' });
    expect(qsa('[data-trend-point]')).toHaveLength(1);
  });

  test('지금 회차가 이미 저장돼 있어도 두 번 그리지 않는다', () => {
    seedSessions([{ level: 2 }]);
    const current = sessionFixture({ level: 2 });
    saveSession(current);
    mountResult({ session: current });
    expect(qsa('[data-trend-point]')).toHaveLength(2);
    expect(qsa('[data-trend-point][data-current="true"]')).toHaveLength(1);
  });

  test('중단된 지금 회차는 추이에 넣지 않는다 (저장돼 있어도)', () => {
    seedSessions([{ level: 2 }]);
    const aborted = sessionFixture({ level: 2, complete: false });
    saveSession(aborted);
    mountResult({ session: aborted });
    expect(qsa('[data-trend-point]')).toHaveLength(1);
    expect(qs('[data-trend-point][data-current="true"]')).toBeNull();
    expect(text('[data-trend]')).toMatch(/중단/);
  });

  test('이 단계의 완료 회차가 하나도 없고 지금 회차도 중단이면 점이 없고 이유를 적는다', () => {
    mountResult({ session: sessionFixture({ level: 2, complete: false }) });
    expect(qsa('[data-trend-point]')).toHaveLength(0);
    expect(text('[data-trend]')).toMatch(/완료한 회차가 아직 없/);
  });

  test('오래된 순으로 놓고, 지금 회차에 표시를 한다', () => {
    seedSessions([{ level: 2, startedAt: 1_000_000 }, { level: 2, startedAt: 3_000_000 }]);
    const current = sessionFixture({ level: 2, startedAt: 2_000_000 });
    mountResult({ session: current });
    const points = qsa('[data-trend-point]');
    expect(points.map((p) => p.dataset.current === 'true')).toEqual([false, true, false]);
    expect(points[1].textContent).toMatch(/이번 회차/);
  });

  test('점마다 억제 성공률을 분수와 퍼센트로 적는다 (참아야 할 때 참은 비율)', () => {
    // 참기 성공 3 / No-Go 4 = 75%
    const responses = [go(500), nogo(null), nogo(null), nogo(null), nogo(500)];
    mountResult({ session: sessionFixture({ level: 2, responses }) });
    const p = qs('[data-trend-point]');
    expect(p.querySelector('[data-trend-rate]').textContent).toMatch(/3\/4/);
    expect(p.querySelector('[data-trend-rate]').textContent).toMatch(/75%/);
    expect(p.querySelector('[data-trend-bar]').style.width).toBe('75%');
  });

  // 아무것도 누르지 않은 학생은 억제 실패가 0이라 억제 성공률이 100%다. 그 막대가 추이의 가장 긴 막대가 되면 "아무것도 안 하면 만점"이
  // 개선으로 읽힌다. 타일에는 "이 숫자로 학생을 판단하지 마세요"가 붙는 회차이므로 추이도 같은 말을 해야 한다.
  describe('해석 불가 회차는 추이에서 막대를 그리지 않는다', () => {
    const idle = () => Array.from({ length: 30 }, (_, i) => (i % 3 === 2 ? nogo(null) : go(null))); // 아무것도 안 누름: 누락 100%, 억제 성공률 100%
    const good = () => [go(500), go(520), nogo(null), nogo(null), nogo(null), nogo(500)]; // 억제 성공률 75%, 하지만 No-Go 4개뿐이라 참고용

    test('아무것도 누르지 않은 회차: 칸(행)과 해석 불가 표시는 남고 막대는 없다', () => {
      mountResult({ session: sessionFixture({ level: 2, responses: idle() }) });
      const p = qs('[data-trend-point]');
      expect(evaluateBadge(computeMetrics(idle())).status).toBe('uninterpretable');
      expect(p.querySelector('[data-trend-bar]')).toBeNull();
      expect(p.querySelector('.trend-track')).not.toBeNull(); // 자리는 남는다
      expect(p.dataset.unreliable).toBe('true');
      expect(p.dataset.reference).toBe('true');
      expect(p.querySelector('.trend-track').dataset.unreliable).toBe('true'); // CSS가 빗금을 친다
      expect(p.textContent).toMatch(/해석 불가/);
      expect(p.textContent).toMatch(/이 숫자로 학생을 판단하지 마세요/);
    });

    test('그 회차가 이전 회차여도 마찬가지다 (오른쪽 끝이 아니라 어디에 있든)', () => {
      seedSessions([{ level: 2, responses: idle() }]);
      mountResult({ session: sessionFixture({ level: 2, responses: good() }) });
      const [old, now] = qsa('[data-trend-point]');
      expect(old.querySelector('[data-trend-bar]')).toBeNull();
      expect(now.querySelector('[data-trend-bar]')).not.toBeNull();
      expect(old.dataset.unreliable).toBe('true');
      expect(now.dataset.unreliable).toBeUndefined();
    });

    test('정상(ok) 회차는 그대로 막대를 그린다', () => {
      const responses = Array.from({ length: 24 }, (_, i) => (i % 3 === 2 ? nogo(i % 6 === 5 ? 500 : null) : go(500)));
      expect(evaluateBadge(computeMetrics(responses)).status).toBe('ok');
      mountResult({ session: sessionFixture({ level: 2, responses }) });
      const p = qs('[data-trend-point]');
      expect(p.querySelector('[data-trend-bar]')).not.toBeNull();
      expect(p.querySelector('[data-trend-bar]').style.width).toBe('50%');
      expect(p.dataset.unreliable).toBeUndefined();
      expect(p.querySelector('.trend-track').dataset.unreliable).toBeUndefined();
    });

    test('참고용(reference)·주의(caution) 회차의 막대는 그대로다 — 이 변경은 해석 불가에만 걸린다', () => {
      const few = [go(500), go(520), nogo(null), nogo(null), nogo(null), nogo(500)]; // No-Go 4개뿐 → 참고용
      expect(evaluateBadge(computeMetrics(few)).status).toBe('reference');
      mountResult({ session: sessionFixture({ level: 2, responses: few }) });
      expect(qs('[data-trend-point] [data-trend-bar]')).not.toBeNull();
    });

    test('css: 해석 불가 회차의 빈 칸은 빗금으로 구별된다 (색만으로 알리지 않고, 막대처럼 보이지 않게)', () => {
      const css = readFileSync('css/app.css', 'utf8');
      const rule = /\.trend-track\[data-unreliable="true"\]\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
      expect(rule).toMatch(/repeating-linear-gradient/);
      expect(rule).toMatch(/border-style:\s*dashed/);
    });

    test('막대가 없어도 억제 성공률 숫자는 남는다 (자료를 숨기지 않고, 값처럼 보이게 그리지 않을 뿐이다)', () => {
      mountResult({ session: sessionFixture({ level: 2, responses: idle() }) });
      expect(qs('[data-trend-rate]').textContent).toMatch(/10\/10/);
    });
  });

  test('No-Go가 없던 회차의 점은 비율 대신 "계산 불가"로 적는다', () => {
    mountResult({ session: sessionFixture({ level: 2, responses: [go(500), go(600)] }) });
    const p = qs('[data-trend-point]');
    expect(p.textContent).toMatch(/참아야 할 그림이 없/);
    expect(p.textContent).not.toMatch(/NaN|null/);
  });

  test('참고용 회차(No-Go 부족)의 점에는 참고용 표시가 붙고 해석 불가 회차에는 그 배지 이름이 붙는다', () => {
    seedSessions([{ level: 2, responses: Array(10).fill(0).map(() => go(null)) }]);
    mountResult({ session: sessionFixture({ level: 2, responses: [go(500), nogo(null), nogo(500)] }) });
    const [old, now] = qsa('[data-trend-point]');
    expect(old.textContent).toMatch(/해석 불가/);
    expect(now.textContent).toMatch(/참고용/);
  });

  test('제목이 단계를 밝히고 다른 단계·중단은 넣지 않았다고 말한다', () => {
    mountResult({ session: sessionFixture({ level: 3 }) });
    const t = text('[data-trend]');
    expect(t).toContain('3단계');
    expect(t).toMatch(/다른 단계/);
    expect(t).toMatch(/중단/);
    expect(t).toMatch(/같은 기기/);
  });

  test('낡은 테마 id가 든 이전 회차가 있어도 추이는 던지지 않는다', () => {
    seedSessions([{ level: 2, themeId: 'retired-theme' }]);
    expect(() => mountResult({ session: sessionFixture({ level: 2 }) })).not.toThrow();
    expect(qsa('[data-trend-point]')).toHaveLength(2);
  });

  test('저장소에 접근할 수 없어도(던지는 저장소) 화면은 뜬다', () => {
    const boom = () => { throw new Error('SecurityError'); };
    setStorage({ getItem: boom, setItem: boom, removeItem: boom });
    expect(() => mountResult({ session: sessionFixture({}) })).not.toThrow();
    expect(qsa('[data-trend-point]')).toHaveLength(1);
  });
});

// ============================================================================================
// 추이의 기기 혼재 경고: 이 화면은 "다른 기기의 반응시간 절대값은 비교할 수 없다"고 적는다.
// 가져오기로 다른 기기의 회차가 같은 추이에 섞이면 그 말과 그래프가 어긋나므로, 섞였다는 사실을 알린다(회차를 걸러내지 않는다).
// 기기 동일성 = 기기 종류 + 화면 크기(짧은 변×긴 변) + 브라우저 이름(버전 제외).
// ============================================================================================
describe('추이의 기기 혼재 경고', () => {
  const phone = { kind: 'phone', screenW: 390, screenH: 844, dpr: 3, browser: 'Chrome 152', inputKind: 'touch', refreshHzEst: 60 };
  const warning = () => qs('[data-trend-device-warning]');

  test('같은 기기 회차만 있으면 경고가 없다', () => {
    seedSessions([{ level: 2, device: { ...phone } }, { level: 2, device: { ...phone } }]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(qsa('[data-trend-point]')).toHaveLength(3);
    expect(warning()).toBeNull();
    expect(qsa('[data-trend-point]').some((p) => /다른 기기/.test(p.textContent))).toBe(false);
  });

  test('회차가 하나뿐이면 경고가 없다', () => {
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(qsa('[data-trend-point]')).toHaveLength(1);
    expect(warning()).toBeNull();
  });

  test('다른 기기 종류가 섞이면 경고가 나오고, 회차는 하나도 사라지지 않는다', () => {
    seedSessions([{ level: 2, device: { ...phone, kind: 'tablet', screenW: 820, screenH: 1180 } }, { level: 2, device: { ...phone } }]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(qsa('[data-trend-point]')).toHaveLength(3);
    expect(warning()).not.toBeNull();
  });

  test('기기 종류만 달라도(크기·브라우저는 같고) 다른 기기로 본다', () => {
    seedSessions([{ level: 2, device: { ...phone, kind: 'tablet' } }]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(warning()).not.toBeNull();
  });

  test('화면 크기만 달라도, 브라우저 이름만 달라도 다른 기기로 본다', () => {
    seedSessions([{ level: 2, device: { ...phone, screenW: 360, screenH: 800 } }]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(warning()).not.toBeNull();
    screen.unmount(); document.body.replaceChildren(); setStorage(memoryStorage());

    seedSessions([{ level: 2, device: { ...phone, browser: 'Safari 17' } }]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(warning()).not.toBeNull();
  });

  test('브라우저 버전만 다르거나(자동 업데이트) 화면을 돌려 가로·세로가 바뀐 것은 같은 기기다', () => {
    seedSessions([
      { level: 2, device: { ...phone, browser: 'Chrome 151' } },
      { level: 2, device: { ...phone, screenW: 844, screenH: 390 } },
    ]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(qsa('[data-trend-point]')).toHaveLength(3);
    expect(warning()).toBeNull();
  });

  test('주사율·화면 배율만 다른 것은 기기 구분에 쓰지 않는다 (측정 실패로 null이 섞여도 경고하지 않는다)', () => {
    seedSessions([{ level: 2, device: { ...phone, refreshHzEst: null, dpr: 2 } }]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(warning()).toBeNull();
  });

  test('기기 정보가 없는 옛 회차와 기기 정보가 있는 회차가 섞이면 경고한다 (같은 기기인지 확인할 수 없다)', () => {
    seedSessions([{ level: 2, device: null }]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(warning()).not.toBeNull();
  });

  test('기기 정보가 모두 없는 회차끼리는 서로 다르다고 말할 근거가 없어 경고하지 않는다', () => {
    seedSessions([{ level: 2, device: null }]);
    mountResult({ session: sessionFixture({ level: 2, device: null }) });
    expect(warning()).toBeNull();
  });

  test('경고 문구: 섞였다는 사실, 반응시간 비교 불가, 억제 성공률은 영향이 작다는 구분', () => {
    seedSessions([{ level: 2, device: { ...phone, kind: 'tablet', screenW: 820, screenH: 1180 } }]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    const t = warning().textContent;
    expect(t).toMatch(/서로 다른 기기/);
    expect(t).toMatch(/반응시간.*비교하지 마세요/);
    expect(t).toMatch(/억제 성공률.*영향이 작/);
    expect(t).toMatch(/2종류/);
    expect(t).toContain('스마트폰');
    expect(t).toContain('태블릿');
    expect(t).not.toMatch(/undefined|null|NaN/);
  });

  test('이번 회차와 다른 기기에서 잰 점에는 "다른 기기" 표시가 붙는다', () => {
    seedSessions([{ level: 2, device: { ...phone, kind: 'tablet', screenW: 820, screenH: 1180 } }, { level: 2, device: { ...phone } }]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    const tagged = qsa('[data-trend-point]').map((p) => /다른 기기/.test(p.textContent));
    expect(tagged).toEqual([true, false, false]);
  });

  test('경고는 추이 영역 안에 있다', () => {
    seedSessions([{ level: 2, device: { ...phone, browser: 'Firefox 130' } }]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(qs('[data-trend]').contains(warning())).toBe(true);
  });

  test('다른 단계·중단 회차의 기기는 보지 않는다 (추이에 그리지 않는 회차는 경고 근거가 아니다)', () => {
    seedSessions([
      { level: 3, device: { ...phone, kind: 'tablet', screenW: 820, screenH: 1180 } },
      { level: 2, complete: false, device: { ...phone, kind: 'desktop', screenW: 1920, screenH: 1080 } },
      { level: 2, device: { ...phone } },
    ]);
    mountResult({ session: sessionFixture({ level: 2, device: { ...phone } }) });
    expect(qsa('[data-trend-point]')).toHaveLength(2);
    expect(warning()).toBeNull();
  });
});

// ============================================================================================
// 리뷰 반영 1: 저장 실패 안내는 오류 종류에 따라 다르다. "저장 공간을 정리하라"는 용량 초과일 때만 말한다.
// 읽을 수 없는 기존 자료(깨진 JSON, 손상, 다른 버전)는 복구할 수 있을 수 있어서, 그때 정리를 시키면 몇 달치 회차가 사라진다.
// ============================================================================================
describe('저장 실패 안내: 오류 종류별 문구', () => {
  const notice = () => qs('[data-notice="save-failed"]');
  const failWith = (error) => mountResult({ session: sessionFixture({}), saveResult: { ok: false, error } });
  const CLEANUP = /정리|비우|지우세요|삭제하세요/;

  test('분류: 실제 storage.js가 내는 오류 문자열을 종류별로 가른다', () => {
    expect(classifySaveError('QuotaExceededError: The quota has been exceeded.')).toBe('quota');
    expect(classifySaveError('NS_ERROR_DOM_QUOTA_REACHED: x')).toBe('quota');
    expect(classifySaveError('stored data is not valid JSON')).toBe('unreadable');
    expect(classifySaveError('stored data has an unknown shape')).toBe('unreadable');
    expect(classifySaveError('stored sessions[2] is invalid: session.id must be a non-empty string')).toBe('unreadable');
    expect(classifySaveError('stored data has schema version 2, expected 1')).toBe('unreadable');
    expect(classifySaveError('localStorage unavailable')).toBe('unavailable');
    expect(classifySaveError('SecurityError: The operation is insecure.')).toBe('unavailable');
    expect(classifySaveError('session.id must be a non-empty string')).toBe('other');
    expect(classifySaveError('뭔가 이상함')).toBe('other');
    expect(classifySaveError(undefined)).toBe('other');
    expect(classifySaveError('')).toBe('other');
  });

  test('용량 초과일 때만 "백업 후 저장 공간을 정리하라"고 안내한다', () => {
    failWith('QuotaExceededError: The quota has been exceeded.');
    expect(notice().textContent).toMatch(/저장 공간이 부족/);
    expect(notice().textContent).toMatch(/저장 공간을 정리/);
    expect(notice().textContent).toMatch(/백업/);
  });

  test.each([
    'stored data is not valid JSON',
    'stored data has an unknown shape',
    'stored sessions[0] is invalid: session.id must be a non-empty string',
    'stored data has schema version 2, expected 1',
  ])('읽을 수 없는 기존 자료(%s)에는 정리를 안내하지 않고, 지우지 말고 파일로 내려받으라고만 한다', (error) => {
    failWith(error);
    const t = notice().textContent;
    expect(t).not.toMatch(/저장 공간을 정리/);
    expect(t).not.toMatch(/저장 공간이 부족/);
    // "정리하세요"류의 지시가 하나도 없다. (경고문의 "지우지 마세요"는 지시가 아니라 금지다.)
    expect(t.replace(/지우지 마세요|비우지 마세요|삭제하지 마세요/g, '')).not.toMatch(CLEANUP);
    expect(t).toMatch(/지우지 마세요/);
    expect(t).toMatch(/파일로 내려받/);
    expect(t).toMatch(/읽을 수 없/);
  });

  test('저장소를 쓸 수 없는 경우(차단·사생활 보호 모드)에도 정리를 시키지 않는다', () => {
    failWith('localStorage unavailable');
    const t = notice().textContent;
    expect(t).toMatch(/저장을 막/);
    expect(t.replace(/지우지 마세요/g, '')).not.toMatch(CLEANUP);
  });

  test('원인을 알 수 없으면 원인을 단정하지 않고 "저장하지 못했습니다"까지만 쓴다', () => {
    for (const error of ['session.id must be a non-empty string', '저장 공간이 부족합니다', undefined, 'x']) {
      failWith(error);
      const t = notice().textContent;
      expect(t).toMatch(/저장하지 못했습니다/);
      expect(t).not.toMatch(/저장 공간이 부족해|저장을 막|읽을 수 없/);
      expect(t.replace(/지우지 마세요/g, '')).not.toMatch(CLEANUP);
      screen.unmount(); document.body.replaceChildren();
    }
  });

  test('어느 종류든 "이 회차가 기기에 남지 않았고, 화면을 캡처하라"는 말은 있다', () => {
    for (const error of ['QuotaExceededError: x', 'stored data is not valid JSON', 'localStorage unavailable', 'x']) {
      failWith(error);
      expect(notice().textContent).toMatch(/기기에 남지 않/);
      expect(notice().textContent).toMatch(/캡처/);
      screen.unmount(); document.body.replaceChildren();
    }
  });

  test('오류 원문(영어)은 접어 두고, 교사가 읽는 본문에는 오류 종류를 한국어로 쓴다', () => {
    failWith('QuotaExceededError: The quota has been exceeded.');
    const details = notice().querySelector('details');
    expect(details).not.toBeNull();
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('QuotaExceededError: The quota has been exceeded.');
    const body = [...notice().children].filter((el) => el.tagName !== 'DETAILS').map((el) => el.textContent).join(' ');
    expect(body).not.toContain('QuotaExceededError');
    expect(body).not.toMatch(/stored data/);
  });

  test('오류 원문이 없으면 접힌 상자도 없다', () => {
    failWith(undefined);
    expect(notice().querySelector('details')).toBeNull();
  });

  test('통합: 실제 저장소가 용량 초과로 실패하면 정리 안내가 나온다', () => {
    const real = memoryStorage();
    setStorage({
      getItem: real.getItem,
      removeItem: real.removeItem,
      setItem: () => { throw new DOMException('full', 'QuotaExceededError'); },
    });
    const session = sessionFixture({});
    const result = saveSession(session);
    expect(result.ok).toBe(false);
    mountResult({ session, saveResult: result });
    expect(notice().textContent).toMatch(/저장 공간을 정리/);
  });

  test('통합: 실제 저장소에 깨진 자료가 있어 저장이 거부되면 정리 안내가 나오지 않는다', () => {
    const real = memoryStorage();
    real.setItem('inhibitoryControlTest', '{ broken');
    setStorage(real);
    const session = sessionFixture({});
    const result = saveSession(session);
    expect(result.ok).toBe(false);
    expect(real.getItem('inhibitoryControlTest')).toBe('{ broken'); // 덮어쓰지 않았다
    mountResult({ session, saveResult: result });
    expect(notice().textContent).not.toMatch(/저장 공간을 정리/);
    expect(notice().textContent).toMatch(/파일로 내려받/);
  });
});

// ============================================================================================
// 리뷰 반영 2: 측정된 것이 없으면 "특징이 없었다"고 말하지 않는다(깨끗한 결과처럼 읽힌다).
// ============================================================================================
describe('측정된 문항이 없는 회차의 해석 구역', () => {
  test('문항 0개: "측정된 문항이 없어 해석할 수 없습니다"라고 말하고, "특징이 없었다"고 말하지 않는다', () => {
    mountResult({ session: sessionFixture({ responses: [], trialCount: 0 }) });
    const box = qs('[data-interpretation]');
    expect(box).not.toBeNull();
    expect(box.dataset.unmeasured).toBe('true');
    expect(box.dataset.empty).toBeUndefined();
    expect(box.textContent).toMatch(/측정된 문항이 없어 해석할 수 없습니다/);
    expect(box.textContent).not.toMatch(/특징이 없|기준에 걸리지 않/);
  });

  test('전원 무효: 같은 문구, 그리고 배지가 말하는 것과 어긋나지 않는다', () => {
    mountResult({ session: sessionFixture({ responses: [invalid(), invalid('nogo'), invalid()] }) });
    const box = qs('[data-interpretation]');
    expect(box.dataset.unmeasured).toBe('true');
    expect(box.textContent).toMatch(/측정된 문항이 없어 해석할 수 없습니다/);
    expect(box.textContent).not.toMatch(/특징이 없|기준에 걸리지 않/);
    expect(qs('[data-badge]').dataset.status).not.toBe('ok');
  });

  test('유효 문항이 있으면 이 문구가 아니다 (평범한 회차는 그대로 "특징이 없었습니다")', () => {
    mountResult({ session: sessionFixture({ responses: [go(500), go(800), nogo(null), nogo(null), nogo(null), nogo(null), nogo(null), nogo(null), nogo(null), nogo(null)] }) });
    const box = qs('[data-interpretation]');
    expect(box.dataset.unmeasured).toBeUndefined();
    expect(box.textContent).not.toMatch(/측정된 문항이 없/);
  });
});

// ============================================================================================
// 리뷰 반영 3: 배지가 "해석 불가"이면 가장 큰 숫자(억제 실패)에도 단서가 있어야 한다. 사람은 배지보다 큰 숫자를 먼저 본다.
// ============================================================================================
describe('해석 불가 회차의 타일 표시', () => {
  const allTiles = ['commissions', 'hits', 'omissions', 'meanRt', 'consistency', 'anticipatory'];
  // 누락이 Go의 40% 이상 → 해석 불가. 억제 실패 수치는 멀쩡해 보인다(0/10).
  const uninterpretable = () => [...Array(6).fill(0).map(() => go(null)), ...Array(4).fill(0).map(() => go(500)), ...Array(10).fill(0).map(() => nogo(null))];

  test('전제: 이 회차의 배지는 해석 불가이고 No-Go는 충분하다', () => {
    const m = computeMetrics(uninterpretable());
    expect(evaluateBadge(m).status).toBe('uninterpretable');
    expect(m.noGoTrials).toBeGreaterThanOrEqual(THRESHOLDS.minNoGoTrials);
  });

  test('요약 타일 6개 전부에 참고용 표시(data-reference)와 "해석 불가" 글자가 붙는다', () => {
    mountResult({ session: sessionFixture({ responses: uninterpretable() }) });
    for (const name of allTiles) {
      expect(tile(name).dataset.reference).toBe('true');
      expect(tile(name).dataset.unreliable).toBe('true');
      expect(tile(name).textContent).toMatch(/해석 불가 판정/);
    }
  });

  test('억제 실패 숫자 바로 옆에 단서가 있다 (큰 숫자 다음 줄)', () => {
    mountResult({ session: sessionFixture({ responses: uninterpretable() }) });
    expect(tile('commissions').querySelector('[data-reference-note]').textContent).toMatch(/이 숫자로 학생을 판단하지 마세요/);
  });

  test('No-Go 부족까지 겹치면 두 이유가 모두 적힌다', () => {
    mountResult({ session: sessionFixture({ responses: [go(null), go(null), go(500), nogo(null)] }) });
    const t = tile('commissions').textContent;
    expect(t).toMatch(/해석 불가 판정/);
    expect(t).toMatch(/참아야 할 그림이 1개뿐/);
  });

  test('전반/후반 억제 실패 횟수에도 같은 단서가 붙는다', () => {
    mountResult({ session: sessionFixture({ responses: uninterpretable() }) });
    expect(qs('[data-halves]').dataset.reference).toBe('true');
    expect(text('[data-halves]')).toMatch(/해석 불가 판정/);
  });

  test('해석 불가가 아니면 타일에 unreliable 표시가 없다 (양호·주의·참고용 회차)', () => {
    mountResult({ session: sessionFixture({ level: 2, length: 'long' }) });
    for (const name of allTiles) {
      expect(tile(name).dataset.unreliable).toBeUndefined();
      expect(tile(name).dataset.reference).toBeUndefined();
    }
  });
});

// ============================================================================================
// 화면 계약
// ============================================================================================
describe('화면 계약', () => {
  test('교사 화면 클래스와 data-screen을 단다', () => {
    mountResult({ session: sessionFixture({}) });
    const el = qs('[data-screen="result"]');
    expect(el).not.toBeNull();
    expect(el.classList.contains('teacher-screen')).toBe(true);
  });

  test('§5.7의 순서: 머리글 → 배지 → 타일 → 흐름 띠 → 전반/후반 → 추이 → 해석 → 측정 조건', () => {
    mountResult({ session: sessionFixture({ level: 2, length: 'long' }) });
    const order = ['[data-report-header]', '[data-badge]', '[data-tile="commissions"]', '[data-trial-overview]', '[data-trial-strip]', '[data-halves]', '[data-trend]', '[data-interpretation]', '[data-conditions]'];
    const els = order.map((s) => qs(s));
    expect(els.every(Boolean)).toBe(true);
    for (let i = 1; i < els.length; i += 1) {
      expect(els[i - 1].compareDocumentPosition(els[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  test('돌아가기 버튼은 click으로 onBack을 부른다 (pointerdown이 아니다: 스크롤하는 화면이다)', () => {
    const { onBack } = mountResult({ session: sessionFixture({}) });
    const buttons = qsa('[data-action="back"]');
    expect(buttons.length).toBeGreaterThan(0);
    buttons[0].dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onBack).not.toHaveBeenCalled();
    click(buttons[buttons.length - 1]);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('onBack이 없어도 눌렀을 때 던지지 않는다', () => {
    mountResult({ session: sessionFixture({}), onBack: undefined });
    expect(() => click(qs('[data-action="back"]'))).not.toThrow();
  });

  test('unmount가 리스너를 정리한다: 그 뒤에 눌러도 onBack이 불리지 않는다', () => {
    const { onBack } = mountResult({ session: sessionFixture({}) });
    const button = qs('[data-action="back"]');
    screen.unmount();
    click(button);
    expect(onBack).not.toHaveBeenCalled();
  });

  test('unmount는 두 번 불러도 안전하고, 같은 루트에 다시 mount할 수 있다', () => {
    const { onBack } = mountResult({ session: sessionFixture({}) });
    screen.unmount();
    expect(() => screen.unmount()).not.toThrow();
    const onBack2 = vi.fn();
    root.replaceChildren();
    screen.mount(root, { session: sessionFixture({}), onBack: onBack2 });
    click(qs('[data-action="back"]'));
    expect(onBack2).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
  });

  test('addEventListener로 건 것만큼 removeEventListener로 걷는다', () => {
    const el = document.createElement('div');
    document.body.append(el);
    const added = []; const removed = [];
    const add = el.addEventListener.bind(el);
    const remove = el.removeEventListener.bind(el);
    el.addEventListener = (...a) => { added.push(a[0]); add(...a); };
    el.removeEventListener = (...a) => { removed.push(a[0]); remove(...a); };
    screen = createResultScreen({});
    screen.mount(el, { session: sessionFixture({}), onBack: vi.fn() });
    expect(added.length).toBeGreaterThan(0);
    screen.unmount();
    expect(removed.sort()).toEqual(added.sort());
  });

  test('session이 없으면(이력에서 못 찾은 회차) 안내와 돌아가기만 보이고 던지지 않는다', () => {
    const onBack = vi.fn();
    root = document.createElement('div');
    document.body.append(root);
    screen = createResultScreen({});
    expect(() => screen.mount(root, { session: null, onBack })).not.toThrow();
    expect(root.textContent).toMatch(/회차를 찾을 수 없/);
    click(qs('[data-action="back"]'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('외부 리소스를 만들지 않는다 (img·script·link·iframe 없음)', () => {
    mountResult({ session: sessionFixture({ trialCount: 100 }) });
    expect(qsa('img, script, link, iframe, object, embed')).toHaveLength(0);
  });

  test('지난 화면에서 스크롤이 남아 있어도 맨 위에서 시작한다', () => {
    mountResult({ session: sessionFixture({}) });
    expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
  });

  test('저장소의 회차를 바꾸지 않는다 (읽기 전용 화면)', () => {
    seedSessions([{ level: 2 }]);
    const before = JSON.stringify(listSessions('학생A'));
    mountResult({ session: sessionFixture({ level: 2 }) });
    expect(JSON.stringify(listSessions('학생A'))).toBe(before);
  });
});
