import { evaluateBadge } from '../js/badge.js';

// 아무 조건에도 걸리지 않는 정상 회차를 기본값으로 두고, partial로 덮어쓴다.
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

test('아무 조건에도 걸리지 않으면 양호다', () => {
  expect(evaluateBadge(metricsWith({}))).toEqual({ status: 'ok', reasons: [] });
});

test('조급 반응이 전체 문항의 20% 이상이면 해석 주의다', () => {
  const b = evaluateBadge(metricsWith({ anticipatoryRate: 0.20 }));
  expect(b.status).toBe('caution'); expect(b.reasons).toContain('anticipatory');
});

test('누락이 Go 문항의 40% 이상이면 해석 불가다', () => {
  const b = evaluateBadge(metricsWith({ goTrials: 10, omissions: 4 }));
  expect(b.status).toBe('uninterpretable'); expect(b.reasons).toContain('omission');
});

test('Go 누락이 5문항 연속이면 해석 주의다', () => {
  expect(evaluateBadge(metricsWith({ maxConsecutiveOmissions: 5 })).reasons).toContain('consecutiveOmissions');
});

test('3단계에서 참기를 모두 성공한 학생은 양호로 나온다', () => {
  // 회귀 테스트: "무반응 5연속"으로 판정하면 참기 성공이 섞여 정상 수행이 주의로 찍힌다
  const b = evaluateBadge(metricsWith({
    goTrials: 57, hits: 57, omissions: 0, maxConsecutiveOmissions: 0,
    noGoTrials: 28, correctRejections: 28, commissions: 0,
  }));
  expect(b).toEqual({ status: 'ok', reasons: [] });
});

test('No-Go 문항이 8개 미만이면 억제 지표 참고용이다', () => {
  const b = evaluateBadge(metricsWith({ noGoTrials: 7 }));
  expect(b.status).toBe('reference'); expect(b.reasons).toContain('tooFewNoGo');
});

test('No-Go 문항이 0개여도 참고용으로 판정되고 예외가 나지 않는다', () => {
  expect(evaluateBadge(metricsWith({ noGoTrials: 0, commissions: 0 })).reasons).toContain('tooFewNoGo');
});

test('무효 문항이 10% 이상이면 해석 주의다', () => {
  expect(evaluateBadge(metricsWith({ invalidRate: 0.12 })).reasons).toContain('tooManyInvalid');
});

test('여러 조건에 걸리면 가장 심한 상태가 되고 이유는 모두 남는다', () => {
  const b = evaluateBadge(metricsWith({ goTrials: 10, omissions: 5, noGoTrials: 4, anticipatoryRate: 0.5 }));
  expect(b.status).toBe('uninterpretable');
  expect(b.reasons).toEqual(expect.arrayContaining(['omission', 'tooFewNoGo', 'anticipatory']));
});

// 경계값: 각 기준의 "걸리지 않는 쪽" 값을 고정한다. 비교 연산자(>=, <)가 바뀌면 여기서 깨진다.
test('No-Go 문항이 정확히 8개면 참고용이 아니다 (최소치 충족)', () => {
  expect(evaluateBadge(metricsWith({ noGoTrials: 8 }))).toEqual({ status: 'ok', reasons: [] });
});

test('누락이 Go 문항의 39%면 해석 불가가 아니다 (기준 바로 아래)', () => {
  expect(evaluateBadge(metricsWith({ goTrials: 100, omissions: 39 }))).toEqual({ status: 'ok', reasons: [] });
});

test('조급 반응이 전체 문항의 19%면 해석 주의가 아니다 (기준 바로 아래)', () => {
  expect(evaluateBadge(metricsWith({ anticipatoryRate: 0.19 }))).toEqual({ status: 'ok', reasons: [] });
});

test('무효 문항이 정확히 10%면 해석 주의다 (기준 이상)', () => {
  expect(evaluateBadge(metricsWith({ invalidRate: 0.10 })).status).toBe('caution');
});

test('Go 누락 연속이 4문항이면 해석 주의가 아니다 (기준 바로 아래)', () => {
  expect(evaluateBadge(metricsWith({ maxConsecutiveOmissions: 4 }))).toEqual({ status: 'ok', reasons: [] });
});

// 가드 계약: Go 문항이 0개면 누락 비율을 0으로 본다. 실제 회차에서는 누락 ≤ Go 문항이라
// omissions > 0이면서 goTrials = 0인 입력은 일어나지 않는다. 이 입력은 실회차 재현이 아니라,
// 가드가 없으면 3/0 = Infinity가 되어 uninterpretable로 뒤집히는 것을 잡기 위한 것이다.
test('Go 문항이 0개면 누락 비율을 0으로 본다 (가드 계약, 실회차에서는 불가능한 입력)', () => {
  expect(evaluateBadge(metricsWith({ goTrials: 0, omissions: 3 }))).toEqual({ status: 'ok', reasons: [] });
});
