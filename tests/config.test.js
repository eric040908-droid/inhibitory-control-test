import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
    consistencySdGoodMs: 120, consistencySdFairMs: 220,
  });
});

// 출처 표시를 지킨다. "(스펙 §5.8 임시값)"은 §5.8이 이름 붙인 여섯 개 기준에만 붙는다. 복사해 붙여 다른 값에도 달려 있던 것을
// 바로잡았다: 이 주석은 파일럿에서 무엇이 바뀔 수 있는지를 알려 주므로 틀리면 안 된다.
describe('config.js 주석의 출처 표시', () => {
  const source = readFileSync(resolve(process.cwd(), 'js/config.js'), 'utf8');
  const SIX = ['anticipatoryMs', 'anticipatoryRate', 'omissionRate', 'consecutiveOmissions', 'minNoGoTrials', 'invalidTrialRate'];

  // 키 위의 주석 덩어리(연속한 // 줄)를 키별로 모은다.
  function commentsByKey() {
    const lines = source.split(/\r?\n/);
    const result = {};
    let block = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) { block.push(trimmed); continue; }
      const key = /^(?:export const )?(\w+)\s*[:=]/.exec(trimmed)?.[1];
      if (key) result[key] = block.join('\n');
      block = [];
    }
    return result;
  }
  const tagged = (text) => /스펙 §5.8 임시값/.test(text ?? '');

  test('§5.8의 여섯 기준에는 "스펙 §5.8 임시값"이 붙어 있다', () => {
    const comments = commentsByKey();
    for (const key of SIX) expect(tagged(comments[key]), key).toBe(true);
  });

  test('그 밖의 값에는 붙어 있지 않다 (TOOL_VERSION, LEVELS, TRIAL_COUNTS, MAX_TRIALS 포함)', () => {
    const comments = commentsByKey();
    const others = Object.keys(comments).filter((key) => !SIX.includes(key));
    expect(others).toEqual(expect.arrayContaining(['TOOL_VERSION', 'LEVELS', 'TRIAL_COUNTS', 'MAX_TRIALS', 'responseGraceMs', 'consistencySdGoodMs']));
    for (const key of others) expect(tagged(comments[key]), key).toBe(false);
  });

  test('조급 반응 비율의 분모는 Go 반응이 아니라 전체 유효 문항이라고 적혀 있다 (코드와 스펙 §5.7이 그렇다)', () => {
    const text = commentsByKey().anticipatoryRate;
    expect(text).toMatch(/전체 유효 문항/);
    expect(text).not.toMatch(/Go 반응 중/);
  });

  test('연속 기준은 Go 누락만 센다고 적혀 있다 (참기 성공은 끊지도 잇지도 않는다)', () => {
    const text = commentsByKey().consecutiveOmissions;
    expect(text).toMatch(/Go 누락/);
    expect(text).not.toMatch(/연속 무반응이/);
  });
});

test('연습 블록 설정이 스펙과 일치한다', () => {
  expect(PRACTICE).toMatchObject({ go: 5, noGo: 3, level: 2, maxRetries: 1 });
});

test('도구 버전이 문자열로 있다', () => {
  expect(typeof TOOL_VERSION).toBe('string');
  expect(TOOL_VERSION.length).toBeGreaterThan(0);
});
