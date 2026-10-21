import { THEMES, getTheme, noGoGlyphFor, rewardCellCount } from '../js/themes.js';

test('테마가 6종이고 id가 중복되지 않는다', () => {
  expect(THEMES).toHaveLength(6);
  expect(new Set(THEMES.map(t => t.id)).size).toBe(6);
});

test('모든 테마가 필요한 그림을 다 갖고 있다', () => {
  for (const t of THEMES)
    for (const k of ['goGlyph', 'crossNoGoGlyph', 'sameNoGoGlyph', 'itemGlyph', 'completionGlyph'])
      expect(t[k]).toBeTruthy();
});

test('테마 안에서 Go 그림과 두 No-Go 그림이 모두 서로 다르다', () => {
  for (const t of THEMES)
    expect(new Set([t.goGlyph, t.crossNoGoGlyph, t.sameNoGoGlyph]).size).toBe(3);
});

test('1·2단계는 다른 범주 그림을, 3단계는 같은 범주 그림을 쓴다', () => {
  const t = getTheme('animal');
  expect(noGoGlyphFor(t, 1)).toBe(t.crossNoGoGlyph);
  expect(noGoGlyphFor(t, 2)).toBe(t.crossNoGoGlyph);
  expect(noGoGlyphFor(t, 3)).toBe(t.sameNoGoGlyph);
});

test('격자 칸 수는 전체 문항의 70%를 내림한 값이고 최소 1칸이다', () => {
  expect(rewardCellCount(50)).toBe(35);  // 35.0 — 정수로 떨어짐
  expect(rewardCellCount(18)).toBe(12);  // 12.6 → 내림
  expect(rewardCellCount(65)).toBe(45);  // 45.5 → 내림 (반올림이면 46)
  expect(rewardCellCount(1)).toBe(1);    // 0.7 → 내림 0 → 최소 1로 올림
});

test('격자 칸 수는 전체 문항 수보다 적다', () => {
  for (const n of [18, 22, 30, 50, 65, 85, 100]) expect(rewardCellCount(n)).toBeLessThan(n);
});

// 경계 고정: 85 × 0.7 = 59.4999...(부동소수점)이라 반올림이면 60이 된다. 내림 규칙이면 59.
test('85문항은 59칸이다 (부동소수점 .5 경계에서 흔들리지 않는다)', () => {
  expect(rewardCellCount(85)).toBe(59);
});

// 0문항은 TRIAL_COUNTS(최소 18)로는 도달할 수 없다. 최소 1칸 규칙이 그대로 적용된 현재 동작을 고정한다.
// 0문항에 1칸이 나오는 것은 "칸 수 < 문항 수" 성질과 어긋나지만 실제 검사에서는 발생하지 않는다.
test('0문항이면 현재 규칙대로 최소 1칸이 나온다 (도달 불가 경계)', () => {
  expect(rewardCellCount(0)).toBe(1);
});
