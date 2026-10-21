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

test('격자 칸 수는 전체 문항의 70%이고 최소 1칸이다', () => {
  expect(rewardCellCount(50)).toBe(35);
  expect(rewardCellCount(18)).toBe(13);
  expect(rewardCellCount(1)).toBeGreaterThanOrEqual(1);
});

test('격자 칸 수는 전체 문항 수보다 적다', () => {
  for (const n of [18, 22, 30, 50, 65, 85, 100]) expect(rewardCellCount(n)).toBeLessThan(n);
});
