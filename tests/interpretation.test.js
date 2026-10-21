import { interpret, INTERPRETATION_RULES } from '../js/interpretation.js';
import { THRESHOLDS, INTERPRETATION } from '../js/config.js';

// 아무 조건에도 걸리지 않는 정상 회차를 기본값으로 두고, partial로 덮어쓴다. (tests/badge.test.js와 같은 기본값)
function metricsWith(partial) {
  return {
    goTrials: 30,
    hits: 27,
    omissions: 3,
    noGoTrials: 10,
    commissions: 3,
    correctRejections: 7,
    anticipatory: 2,
    anticipatoryRate: 0.05,
    meanRt: 612,
    rtSd: 148,
    consistency: 'fair',
    maxConsecutiveOmissions: 2,
    validTrials: 40,
    invalidTrials: 0,
    invalidRate: 0,
    halves: { first: { commissions: 1, meanRt: 548 }, second: { commissions: 2, meanRt: 681 } },
    ...partial,
  };
}
const okBadge = { status: 'ok', reasons: [] };

test('억제 실패가 후반에 몰리고 후반이 느려지면 지속 시간을 가리킨다', () => {
  const out = interpret(metricsWith({ halves: { first: { commissions: 1, meanRt: 548 }, second: { commissions: 4, meanRt: 681 } } }), okBadge);
  expect(out.join(' ')).toContain('지속');
});

test('억제 실패는 적고 누락이 많으면 주의력을 가리킨다', () => {
  const out = interpret(metricsWith({ commissions: 0, goTrials: 30, omissions: 9 }), okBadge);
  expect(out.join(' ')).toContain('주의');
});

test('해석 불가 배지면 해석 문장을 내지 않는다', () => {
  expect(interpret(metricsWith({}), { status: 'uninterpretable', reasons: ['omission'] })).toEqual([]);
});

test('문장은 최대 2개다', () => {
  const out = interpret(metricsWith({ commissions: 9, noGoTrials: 10, omissions: 9, goTrials: 30, consistency: 'poor', anticipatoryRate: 0.3 }), okBadge);
  expect(out.length).toBeLessThanOrEqual(2);
});

test('진단처럼 들리는 단어를 쓰지 않는다', () => {
  const banned = ['진단', '장애', '정상', '비정상', '지능'];
  for (const m of [metricsWith({}), metricsWith({ commissions: 9, noGoTrials: 10 })])
    for (const s of interpret(m, okBadge)) for (const w of banned) expect(s).not.toContain(w);
});

// ---- 추가: 규칙 테이블 ----

// 각 규칙을 단독으로 켜는 입력. 다른 규칙이 같이 켜지지 않도록 기본값에서 한 가지만 바꾼다.
const FIRES = {
  lateShift: { halves: { first: { commissions: 1, meanRt: 548 }, second: { commissions: 4, meanRt: 681 } } },
  attention: { commissions: 0, omissions: 9 },
  evenInhibition: { commissions: 6, halves: { first: { commissions: 3, meanRt: 600 }, second: { commissions: 3, meanRt: 600 } } },
  inconsistent: { consistency: 'poor' },
  anticipatory: { anticipatoryRate: 0.3 },
  tooEasy: { commissions: 0, consistency: 'good', halves: { first: { commissions: 0, meanRt: 600 }, second: { commissions: 0, meanRt: 600 } } },
};
// 스펙 §5.7 초안 규칙 순서. INTERPRETATION_RULES가 이 순서를 따라야 한다.
const ORDER = ['lateShift', 'attention', 'evenInhibition', 'inconsistent', 'anticipatory', 'tooEasy'];

describe('규칙 테이블', () => {
  test('조건 함수와 문장 문자열의 쌍 6개이고, 스펙 §5.7 순서를 따른다', () => {
    expect(INTERPRETATION_RULES).toHaveLength(6);
    for (const [cond, sentence] of INTERPRETATION_RULES) {
      expect(typeof cond).toBe('function');
      expect(typeof sentence).toBe('string');
      expect(sentence.length).toBeGreaterThan(0);
    }
  });

  test('테이블의 모든 문장이 금지어를 담지 않는다 (발화 여부와 무관하게)', () => {
    const banned = ['진단', '장애', '정상', '비정상', '지능'];
    for (const [, sentence] of INTERPRETATION_RULES)
      for (const w of banned) expect(sentence).not.toContain(w);
  });

  test('기본 회차는 어느 규칙도 켜지 않아 빈 배열이다', () => {
    expect(interpret(metricsWith({}), okBadge)).toEqual([]);
  });

  test.each(ORDER.map((name, i) => [name, i]))('%s 입력은 해당 규칙 하나만 켠다', (name, i) => {
    const m = metricsWith(FIRES[name]);
    const fired = INTERPRETATION_RULES.map(([cond]) => cond(m));
    expect(fired).toEqual(ORDER.map((_, j) => j === i));
    expect(interpret(m, okBadge)).toEqual([INTERPRETATION_RULES[i][1]]);
  });

  test('각 규칙의 방향을 담은 핵심어가 문장에 들어 있다', () => {
    const sentenceOf = (name) => interpret(metricsWith(FIRES[name]), okBadge).join(' ');
    expect(sentenceOf('lateShift')).toContain('지속');
    expect(sentenceOf('attention')).toContain('주의력');
    expect(sentenceOf('evenInhibition')).toContain('억제');
    expect(sentenceOf('inconsistent')).toContain('끊');
    expect(sentenceOf('anticipatory')).toContain('규칙');
    expect(sentenceOf('tooEasy')).toContain('단계');
  });
});

describe('최대 2문장', () => {
  test('조건이 3개 참이면 테이블 앞쪽 2개만, 테이블 순서대로 나온다', () => {
    const m = metricsWith({ ...FIRES.evenInhibition, ...FIRES.inconsistent, ...FIRES.anticipatory });
    const fired = INTERPRETATION_RULES.filter(([cond]) => cond(m));
    expect(fired).toHaveLength(3);
    expect(interpret(m, okBadge)).toEqual([INTERPRETATION_RULES[2][1], INTERPRETATION_RULES[3][1]]);
  });

  test('조건이 정확히 2개 참이면 2문장이다', () => {
    const m = metricsWith({ ...FIRES.inconsistent, ...FIRES.anticipatory });
    expect(interpret(m, okBadge)).toEqual([INTERPRETATION_RULES[3][1], INTERPRETATION_RULES[4][1]]);
  });

  test('조건이 1개 참이면 1문장이다', () => {
    expect(interpret(metricsWith(FIRES.anticipatory), okBadge)).toHaveLength(1);
  });

  test('조건이 하나도 참이 아니면 빈 배열이다', () => {
    expect(interpret(metricsWith({}), okBadge)).toEqual([]);
  });
});

describe('배지', () => {
  test.each(['caution', 'reference', 'ok'])('%s 배지는 해석 문장을 낸다', (status) => {
    expect(interpret(metricsWith(FIRES.anticipatory), { status, reasons: [] })).toHaveLength(1);
  });

  test('해석 불가 배지는 조건이 참이어도 빈 배열이다', () => {
    expect(interpret(metricsWith(FIRES.anticipatory), { status: 'uninterpretable', reasons: [] })).toEqual([]);
  });
});

describe('null 지표', () => {
  test('정반응이 1개라 meanRt는 있고 consistency가 null이어도 예외 없이 동작한다', () => {
    const m = metricsWith({ hits: 1, meanRt: 640, rtSd: null, consistency: null });
    expect(() => interpret(m, okBadge)).not.toThrow();
    expect(interpret(m, okBadge)).toEqual([]);
  });

  test('consistency가 null이면 일관성 규칙도, "안정적" 규칙도 켜지지 않는다', () => {
    const m = metricsWith({ ...FIRES.tooEasy, consistency: null });
    expect(interpret(m, okBadge)).toEqual([]);
  });

  test('정반응이 없어 meanRt와 consistency가 모두 null이어도 예외가 없다', () => {
    const m = metricsWith({
      hits: 0, meanRt: null, rtSd: null, consistency: null,
      halves: { first: { commissions: 1, meanRt: null }, second: { commissions: 4, meanRt: null } },
    });
    expect(() => interpret(m, okBadge)).not.toThrow();
  });

  test('전·후반 meanRt가 null이면 "후반이 느려짐"을 판단할 수 없어 지속 시간 문장을 내지 않는다', () => {
    const m = metricsWith({ halves: { first: { commissions: 1, meanRt: null }, second: { commissions: 4, meanRt: 681 } } });
    expect(INTERPRETATION_RULES[0][0](m)).toBe(false);
  });

  test('No-Go 문항이 0개여도 0으로 나누지 않고 억제 관련 문장을 내지 않는다', () => {
    const m = metricsWith({ noGoTrials: 0, commissions: 0, correctRejections: 0 });
    expect(() => interpret(m, okBadge)).not.toThrow();
    expect(interpret(m, okBadge)).toEqual([]);
  });

  test('Go 문항이 0개여도 0으로 나누지 않는다', () => {
    const m = metricsWith({ goTrials: 0, hits: 0, omissions: 0, meanRt: null, rtSd: null, consistency: null });
    expect(() => interpret(m, okBadge)).not.toThrow();
  });
});

// ---- 추가: 경계 (값은 config에서 읽는다 — 코드의 경계를 옮기면 이 테스트가 깨진다) ----
const T = INTERPRETATION;
const rule = (name) => INTERPRETATION_RULES[ORDER.indexOf(name)][0];

describe('후반 몰림 경계', () => {
  const halves = (firstC, secondC, firstRt, secondRt) => ({
    halves: { first: { commissions: firstC, meanRt: firstRt }, second: { commissions: secondC, meanRt: secondRt } },
  });

  test('후반 억제 실패가 전반보다 기준 횟수만큼 많으면 켜진다', () => {
    expect(rule('lateShift')(metricsWith(halves(1, 1 + T.lateShiftMinCommissions, 500, 700)))).toBe(true);
  });

  test('기준보다 1개 적으면 꺼진다', () => {
    expect(rule('lateShift')(metricsWith(halves(1, 1 + T.lateShiftMinCommissions - 1, 500, 700)))).toBe(false);
  });

  test('후반 반응이 기준 배율만큼 느려지면 켜진다', () => {
    expect(rule('lateShift')(metricsWith(halves(1, 4, 1000, 1000 * T.lateSlowdownRatio)))).toBe(true);
  });

  test('후반 반응 배율이 기준에 못 미치면 꺼진다', () => {
    expect(rule('lateShift')(metricsWith(halves(1, 4, 1000, 1000 * T.lateSlowdownRatio - 1)))).toBe(false);
  });

  test('후반이 느려지지 않으면(억제 실패만 몰림) 지속 시간 문장이 아니다', () => {
    expect(rule('lateShift')(metricsWith(halves(1, 4, 700, 600)))).toBe(false);
  });
});

describe('주의력 경계 (누락 많음 + 억제 실패 적음)', () => {
  // goTrials 100 → 누락 개수가 곧 비율(%)이라 경계를 정확히 짚을 수 있다.
  const at = (omissions, commissions) => metricsWith({ goTrials: 100, omissions, noGoTrials: 10, commissions });
  const omissionsAtRate = (rate) => Math.round(rate * 100);

  test('누락 비율이 기준이면 켜진다', () => {
    expect(rule('attention')(at(omissionsAtRate(T.manyOmissionRate), 0))).toBe(true);
  });

  test('누락 비율이 기준보다 1%p 낮으면 꺼진다', () => {
    expect(rule('attention')(at(omissionsAtRate(T.manyOmissionRate) - 1, 0))).toBe(false);
  });

  test('누락 기준은 해석 불가 기준(THRESHOLDS.omissionRate)보다 낮다 — 그 아래 구간에서 말해야 한다', () => {
    expect(T.manyOmissionRate).toBeLessThan(THRESHOLDS.omissionRate);
  });

  test('억제 실패 비율이 "적음" 기준이면 켜진다', () => {
    const commissions = Math.round(T.fewCommissionRate * 10);
    expect(rule('attention')(at(omissionsAtRate(T.manyOmissionRate), commissions))).toBe(true);
  });

  test('억제 실패가 1개 더 많으면 꺼진다', () => {
    const commissions = Math.round(T.fewCommissionRate * 10) + 1;
    expect(rule('attention')(at(omissionsAtRate(T.manyOmissionRate), commissions))).toBe(false);
  });
});

describe('억제 자체의 어려움 경계 (전·후반 고르게 많음)', () => {
  const even = (commissions, firstC, secondC) => metricsWith({
    noGoTrials: 10, commissions,
    halves: { first: { commissions: firstC, meanRt: 600 }, second: { commissions: secondC, meanRt: 600 } },
  });
  const manyCount = Math.round(T.manyCommissionRate * 10);

  test('억제 실패 비율이 "많음" 기준이면 켜진다', () => {
    expect(rule('evenInhibition')(even(manyCount, manyCount / 2, manyCount / 2))).toBe(true);
  });

  test('기준보다 1개 적으면 꺼진다', () => {
    expect(rule('evenInhibition')(even(manyCount - 1, 2, 1))).toBe(false);
  });

  test('한쪽 절반에 억제 실패가 하나도 없으면 "고르게"가 아니다', () => {
    expect(rule('evenInhibition')(even(manyCount, manyCount, 0))).toBe(false);
  });

  test('전반에 억제 실패가 없으면 차이가 작아도 "고르게"가 아니다', () => {
    expect(rule('evenInhibition')(even(manyCount, 0, 1))).toBe(false);
  });

  test('후반에 크게 몰렸으면 "고르게"가 아니다 (지속 시간 쪽 규칙의 영역)', () => {
    expect(rule('evenInhibition')(even(manyCount + 1, 1, 1 + T.lateShiftMinCommissions))).toBe(false);
  });
});

describe('조급 반응 경계', () => {
  test('조급 반응 비율이 THRESHOLDS.anticipatoryRate이면 켜진다', () => {
    expect(rule('anticipatory')(metricsWith({ anticipatoryRate: THRESHOLDS.anticipatoryRate }))).toBe(true);
  });

  test('그보다 조금이라도 낮으면 꺼진다', () => {
    expect(rule('anticipatory')(metricsWith({ anticipatoryRate: THRESHOLDS.anticipatoryRate - 0.01 }))).toBe(false);
  });
});

describe('일관성 경계', () => {
  test("'poor'만 켜지고 'fair' 'good'은 꺼진다", () => {
    expect(rule('inconsistent')(metricsWith({ consistency: 'poor' }))).toBe(true);
    expect(rule('inconsistent')(metricsWith({ consistency: 'fair' }))).toBe(false);
    expect(rule('inconsistent')(metricsWith({ consistency: 'good' }))).toBe(false);
  });
});

describe('"현재 단계가 쉬울 수 있음" 경계', () => {
  const easy = (partial) => metricsWith({ ...FIRES.tooEasy, ...partial });

  test('안정적이고 억제 실패가 없으면 켜진다', () => {
    expect(rule('tooEasy')(easy({}))).toBe(true);
  });

  test("일관성이 'fair'이면 꺼진다", () => {
    expect(rule('tooEasy')(easy({ consistency: 'fair' }))).toBe(false);
  });

  test('억제 실패가 "적음" 기준을 넘으면 꺼진다', () => {
    const over = Math.round(T.fewCommissionRate * 10) + 1;
    expect(rule('tooEasy')(easy({ commissions: over }))).toBe(false);
  });

  test('누락이 "많음" 기준이면 꺼진다', () => {
    expect(rule('tooEasy')(easy({ goTrials: 100, omissions: Math.round(T.manyOmissionRate * 100) }))).toBe(false);
  });

  test('조급 반응이 많으면 꺼진다', () => {
    expect(rule('tooEasy')(easy({ anticipatoryRate: THRESHOLDS.anticipatoryRate }))).toBe(false);
  });

  test('후반이 눈에 띄게 느려졌으면 꺼진다 ("전 구간 안정적"이 아니다)', () => {
    const halves = { first: { commissions: 0, meanRt: 1000 }, second: { commissions: 0, meanRt: 1000 * T.lateSlowdownRatio } };
    expect(rule('tooEasy')(easy({ halves }))).toBe(false);
  });
});
