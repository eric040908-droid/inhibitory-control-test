// 테마: 학생이 좋아하는 그림으로 과제를 감싼다. 과제 구조와 측정 방식은 테마와 무관하게 같다.
// 그림은 모두 이모지다. 외부 이미지 파일을 쓰지 않는다.
import { LEVELS, THRESHOLDS } from './config.js';

// goGlyph: 눌러야 할 그림. crossNoGoGlyph: 1·2단계에서 참을 그림(Go와 다른 범주).
// sameNoGoGlyph: 3단계에서 참을 그림(같은 범주, 한눈에 다른 대상).
// itemGlyph: 모으는 아이템. completionGlyph: 격자가 다 찼을 때의 완성 그림.
export const THEMES = [
  { id: 'animal',  label: '동물',
    goGlyph: '🐶', crossNoGoGlyph: '🚗', sameNoGoGlyph: '🐱', itemGlyph: '🦴', completionGlyph: '🎉' },
  { id: 'vehicle', label: '탈것',
    goGlyph: '🚗', crossNoGoGlyph: '🍎', sameNoGoGlyph: '🚀', itemGlyph: '⛽', completionGlyph: '🏁' },
  { id: 'food',    label: '음식',
    goGlyph: '🍕', crossNoGoGlyph: '🐶', sameNoGoGlyph: '🍔', itemGlyph: '🍪', completionGlyph: '🎂' },
  { id: 'fruit',   label: '과일',
    goGlyph: '🍎', crossNoGoGlyph: '🚗', sameNoGoGlyph: '🍌', itemGlyph: '🍓', completionGlyph: '🧺' },
  { id: 'shape',   label: '도형',
    goGlyph: '🔴', crossNoGoGlyph: '🍎', sameNoGoGlyph: '🟦', itemGlyph: '💎', completionGlyph: '⭐' },
  { id: 'weather', label: '날씨',
    goGlyph: '🌞', crossNoGoGlyph: '🐶', sameNoGoGlyph: '⛄', itemGlyph: '🌟', completionGlyph: '🌈' },
];

export function getTheme(id) {
  const theme = THEMES.find(t => t.id === id);
  if (!theme) throw new Error(`알 수 없는 테마: ${id}`);
  return theme;
}

// 난이도가 same-category No-Go를 쓰는지는 config의 플래그가 단일 출처다.
export function noGoGlyphFor(theme, level) {
  return LEVELS[level].sameCategoryNoGo ? theme.sameNoGoGlyph : theme.crossNoGoGlyph;
}

// 격자 칸 수 = 전체 문항 수 × rewardCellRatio, 내림, 최소 1칸.
export function rewardCellCount(trialCount) {
  return Math.max(1, Math.floor(trialCount * THRESHOLDS.rewardCellRatio));
}
