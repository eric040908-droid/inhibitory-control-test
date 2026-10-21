import { LEVELS, TRIAL_COUNTS, MAX_TRIALS, THRESHOLDS, PRACTICE, TOOL_VERSION } from '../js/config.js';

test('난이도별 제시 시간과 간격이 스펙과 일치한다', () => {
  expect(LEVELS[1]).toMatchObject({ stimulusMs: 4000, interTrialMs: 1500, noGoRatio: 0.20, sameCategoryNoGo: false });
  expect(LEVELS[2]).toMatchObject({ stimulusMs: 2400, interTrialMs: 1200, noGoRatio: 0.25, sameCategoryNoGo: false });
  expect(LEVELS[3]).toMatchObject({ stimulusMs: 1400, interTrialMs: 900,  noGoRatio: 0.33, sameCategoryNoGo: true  });
});

test('문항 수 테이블이 스펙과 일치하고 상한 100을 넘지 않는다', () => {
  expect(TRIAL_COUNTS[1]).toEqual({ short: 18, medium: 50, long: 85 });
  expect(TRIAL_COUNTS[2]).toEqual({ short: 22, medium: 65, long: 100 });
  expect(TRIAL_COUNTS[3]).toEqual({ short: 30, medium: 85, long: 100 });
  for (const row of Object.values(TRIAL_COUNTS))
    for (const n of Object.values(row)) expect(n).toBeLessThanOrEqual(MAX_TRIALS);
});

test('판정 기준값이 스펙과 일치한다', () => {
  expect(THRESHOLDS).toMatchObject({
    anticipatoryMs: 200, anticipatoryRate: 0.20, omissionRate: 0.40,
    consecutiveOmissions: 5, minNoGoTrials: 8, invalidTrialRate: 0.10,
    responseGraceMs: 500, firstGoTrials: 3, noGoGapSpread: 2,
    rewardCellRatio: 0.70, practiceAutoAdvanceMs: 8000,
  });
});

test('연습 블록 설정이 스펙과 일치한다', () => {
  expect(PRACTICE).toMatchObject({ go: 5, noGo: 3, level: 2, maxRetries: 1 });
});

test('도구 버전이 문자열로 있다', () => {
  expect(typeof TOOL_VERSION).toBe('string');
  expect(TOOL_VERSION.length).toBeGreaterThan(0);
});
