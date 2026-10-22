import { computeMetrics } from '../js/metrics.js';
import { THRESHOLDS } from '../js/config.js';

// Response 모양을 만드는 헬퍼. index는 테스트마다 0부터 다시 센다.
// rtMs가 null이면 허용 구간 안에 입력이 없었다는 뜻이다.
let nextIndex = 0;
beforeEach(() => { nextIndex = 0; });
const make = (type, rtMs) => ({ index: nextIndex++, type, rtMs, extraTaps: 0, invalid: false });
const go = (rtMs) => make('go', rtMs);
const nogo = (rtMs) => make('nogo', rtMs);

test('정반응은 200ms 이후 Go 반응만 센다', () => {
  const m = computeMetrics([go(300), go(900), go(null)]);
  expect(m.hits).toBe(2); expect(m.omissions).toBe(1);
});

test('Go 문항의 200ms 이내 반응은 정반응이 아니고 조급 반응으로만 센다', () => {
  const m = computeMetrics([go(150), go(600)]);
  expect(m.hits).toBe(1);
  expect(m.anticipatory).toBe(1);
  expect(m.omissions).toBe(0);
});

test('Go 조급 반응은 평균 반응속도와 편차 계산에서 빠진다', () => {
  const m = computeMetrics([go(100), go(500), go(700)]);
  expect(m.meanRt).toBe(600);
});

test('No-Go 문항의 200ms 이내 반응은 억제 실패와 조급 반응 양쪽에 1씩 센다', () => {
  const m = computeMetrics([nogo(120)]);
  expect(m.commissions).toBe(1);
  expect(m.anticipatory).toBe(1);
});

test('참기 성공은 No-Go 무반응이다', () => {
  const m = computeMetrics([nogo(null), nogo(400)]);
  expect(m.correctRejections).toBe(1); expect(m.commissions).toBe(1);
});

test('조급 반응 비율의 분모는 Go와 No-Go를 합친 전체 문항이다', () => {
  const m = computeMetrics([go(100), go(500), nogo(null), nogo(null)]);
  expect(m.anticipatoryRate).toBeCloseTo(0.25);
});

test('무효 문항은 모든 지표에서 제외되고 따로 집계된다', () => {
  const m = computeMetrics([go(500), { ...go(100), invalid: true }, nogo(300)]);
  expect(m.validTrials).toBe(2); expect(m.invalidTrials).toBe(1);
  expect(m.anticipatory).toBe(0); expect(m.hits).toBe(1); expect(m.commissions).toBe(1);
  expect(m.invalidRate).toBeCloseTo(1 / 3);
});

test('Go 누락의 최대 연속 길이를 세고, 참기 성공은 끊지도 잇지도 않는다', () => {
  const m = computeMetrics([go(null), nogo(null), go(null), go(null), go(500)]);
  expect(m.maxConsecutiveOmissions).toBe(3);
});

test('반응 일관성은 편차 경계로 라벨링된다', () => {
  expect(computeMetrics([go(600), go(620), go(590)]).consistency).toBe('good');
  expect(computeMetrics([go(300), go(900), go(1500)]).consistency).toBe('poor');
});

// 반응 일관성 라벨은 결과 화면의 해석 문장을 좌우한다: 'good'이면 "단계를 올리는 것을 검토", 'poor'이면 "주의가 계속 끊기고 있을 수 있다".
// 다른 기준은 양쪽 경계를 모두 고정하는데 이것만 빠져 있어, 비교가 뒤집혀도 초록이었다.
// 정반응 RT 세 개 [m−k, m, m+k]의 표본표준편차는 정확히 k이므로(합제곱 2k² ÷ (3−1) = k²) 경계에 정확히 놓을 수 있다.
describe('반응 일관성 경계 (표본표준편차, ms): 120 이하 일정함 / 220 이하 보통 / 초과 들쭉날쭉', () => {
  const withSd = (k) => computeMetrics([go(600 - k), go(600), go(600 + k)]);

  test('테스트가 만드는 편차가 정확히 k이다 (경계 테스트의 전제)', () => {
    expect(withSd(120).rtSd).toBe(120);
    expect(withSd(220).rtSd).toBe(220);
  });

  test('경계 근처의 값: 120 이하는 good, 120을 넘으면 fair', () => {
    expect(withSd(119.99).consistency).toBe('good');
    expect(withSd(120).consistency).toBe('good');   // 정확히 120은 일정함 (<=)
    expect(withSd(120.01).consistency).toBe('fair');
  });

  test('경계 근처의 값: 220 이하는 fair, 220을 넘으면 poor', () => {
    expect(withSd(219.99).consistency).toBe('fair');
    expect(withSd(220).consistency).toBe('fair');   // 정확히 220은 보통 (<=)
    expect(withSd(220.01).consistency).toBe('poor');
  });

  test('fair 구간의 한가운데도 fair이다 (이 분기에는 테스트가 없었다)', () => {
    expect(withSd(170).consistency).toBe('fair');
    expect(computeMetrics([go(400), go(600), go(800)]).consistency).toBe('fair'); // 표본표준편차 200
  });

  test('편차가 0이어도(모두 같은 값) good이다', () => {
    expect(computeMetrics([go(500), go(500), go(500)]).consistency).toBe('good');
  });

  test('경계값은 설정 상수에서 읽는다: 상수 두 개의 값이 라벨 경계다', () => {
    expect(THRESHOLDS.consistencySdGoodMs).toBe(120);
    expect(THRESHOLDS.consistencySdFairMs).toBe(220);
    expect(withSd(THRESHOLDS.consistencySdGoodMs).consistency).toBe('good');
    expect(withSd(THRESHOLDS.consistencySdFairMs).consistency).toBe('fair');
  });
});

test('전반과 후반을 유효 문항 순서로 반씩 나눈다', () => {
  const m = computeMetrics([nogo(null), go(500), nogo(300), go(900)]);
  expect(m.halves.first.commissions).toBe(0);
  expect(m.halves.second.commissions).toBe(1);
  expect(m.halves.first.meanRt).toBe(500);
});

test('No-Go 문항이 없어도 0으로 나누지 않는다', () => {
  const m = computeMetrics([go(500), go(600)]);
  expect(m.noGoTrials).toBe(0);
  expect(m.commissions).toBe(0);
  expect(Number.isFinite(m.anticipatoryRate)).toBe(true);
});

test('Go 정반응이 하나도 없으면 평균과 편차가 null이다', () => {
  const m = computeMetrics([go(null), nogo(null)]);
  expect(m.meanRt).toBeNull(); expect(m.rtSd).toBeNull(); expect(m.consistency).toBeNull();
});

test('정확히 200ms는 정반응이고 199ms는 조급 반응이다', () => {
  const edge = computeMetrics([go(200)]);
  expect(edge.hits).toBe(1);
  expect(edge.anticipatory).toBe(0);
  expect(edge.meanRt).toBe(200);

  const early = computeMetrics([go(199)]);
  expect(early.hits).toBe(0);
  expect(early.anticipatory).toBe(1);
  expect(early.meanRt).toBeNull();
});

test('억제 실패(No-Go 반응)는 Go 누락의 연속을 끊는다', () => {
  const m = computeMetrics([go(null), go(null), nogo(300), go(null), go(null)]);
  expect(m.maxConsecutiveOmissions).toBe(2);
});
