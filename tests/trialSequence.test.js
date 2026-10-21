import { generateSequence, gapRangeFor } from '../js/trialSequence.js';

// 결정적인 작은 LCG. [0, 1) 범위의 수를 돌려주는 함수를 반환한다.
function seededRng(seed) {
  let state = (seed * 2654435761 + 12345) >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// 연속한 No-Go 사이의 Go 개수. 첫 No-Go 이전 구간은 간격 규칙의 대상이 아니므로 제외한다.
function gapsBetweenNoGo(seq) {
  const gaps = [];
  let run = null;
  for (const t of seq) {
    if (t.type === 'nogo') {
      if (run !== null) gaps.push(run);
      run = 0;
    } else if (run !== null) {
      run += 1;
    }
  }
  return gaps;
}

test('첫 3문항은 항상 Go다', () => {
  for (const level of [1, 2, 3]) {
    const seq = generateSequence(level, 60, seededRng(level));
    expect(seq.slice(0, 3).every(t => t.type === 'go')).toBe(true);
  }
});

test('No-Go 문항이 연달아 나오지 않는다', () => {
  for (let s = 0; s < 50; s++) {
    const seq = generateSequence(3, 85, seededRng(s));
    for (let i = 1; i < seq.length; i++)
      expect(seq[i].type === 'nogo' && seq[i - 1].type === 'nogo').toBe(false);
  }
});

test('간격 범위는 난이도의 No-Go 비율에서 유도된다', () => {
  expect(gapRangeFor(1)).toEqual({ min: 2, max: 6 });
  expect(gapRangeFor(2)).toEqual({ min: 1, max: 5 });
  expect(gapRangeFor(3)).toEqual({ min: 1, max: 3 });
});

test('No-Go 사이의 Go 개수가 그 난이도의 범위에 들어간다', () => {
  for (const level of [1, 2, 3]) {
    const { min, max } = gapRangeFor(level);
    const gaps = gapsBetweenNoGo(generateSequence(level, 85, seededRng(level * 7))); // 첫 No-Go 이전 구간은 제외
    for (const g of gaps) { expect(g).toBeGreaterThanOrEqual(min); expect(g).toBeLessThanOrEqual(max); }
  }
});

test('3단계에서 Go Go No-Go 고정 반복이 되지 않는다', () => {
  const seq = generateSequence(3, 85, seededRng(11));
  expect(new Set(gapsBetweenNoGo(seq)).size).toBeGreaterThan(1);
});

test('No-Go 비율이 난이도 설정값에 근접한다', () => {
  const cases = [[1, 50, 0.20], [2, 65, 0.25], [3, 85, 0.33]];
  for (const [level, n, ratio] of cases) {
    const seq = generateSequence(level, n, seededRng(level * 13));
    const actual = seq.filter(t => t.type === 'nogo').length / n;
    expect(Math.abs(actual - ratio)).toBeLessThanOrEqual(0.06);
  }
});

test('같은 rng를 주면 같은 순서가 나온다', () => {
  expect(generateSequence(2, 40, seededRng(3))).toEqual(generateSequence(2, 40, seededRng(3)));
});

test('index가 0부터 연속이고 길이가 trialCount와 같다', () => {
  const seq = generateSequence(1, 18, seededRng(1));
  expect(seq).toHaveLength(18);
  expect(seq.map(t => t.index)).toEqual([...Array(18).keys()]);
});

test('문항 수가 아주 적어도 규칙을 깨지 않는다', () => {
  const seq = generateSequence(1, 5, seededRng(2));
  expect(seq.slice(0, 3).every(t => t.type === 'go')).toBe(true);
  expect(seq).toHaveLength(5);
});
