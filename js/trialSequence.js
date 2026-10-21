// 검사 문항 순서 생성.
// 고/노고 과제가 억제를 재려면 누르는 습관이 생긴 상태에서 "예측 불가능하게" 참기를 요구해야 한다.
// 그래서 No-Go 사이의 Go 개수(간격)를 무작위로 뽑고, 고정 윈도나 고정 반복을 쓰지 않는다.
import { LEVELS, THRESHOLDS } from './config.js';

// 난이도의 No-Go 비율에서 간격 범위를 유도한다.
//   평균 간격 = round(1 / noGoRatio) − 1, 범위 = 평균 ± spread
// 간격은 최소 1(No-Go가 연달아 나오지 않음)이므로, 평균이 작아 아래쪽이 1에서 잘리면 위쪽도 같은 폭만큼
// 줄여 범위를 평균 기준 대칭으로 유지한다. 한쪽만 자르면 평균 간격이 올라가 No-Go 비율이 낮아진다
// (3단계: 1~4면 평균 2.5라 약 28.6%, 1~3이면 평균 2라 약 33%).
// 범위를 난이도마다 맞춰야 평균 간격이 비율과 일치해 요구한 No-Go 비율이 나온다.
export function gapRangeFor(level) {
  const meanGap = Math.round(1 / LEVELS[level].noGoRatio) - 1;
  const spread = Math.min(THRESHOLDS.noGoGapSpread, meanGap - 1);
  return { min: meanGap - spread, max: meanGap + spread };
}

// 앞 firstGoTrials개는 Go로 고정한 뒤, [무작위 간격만큼 Go + No-Go 1개]를 trialCount에 닿을 때까지 반복한다.
// 마지막에 자리가 모자라면 남은 칸은 Go로 채운다. 목표 No-Go 개수는 정하지 않는다.
export function generateSequence(level, trialCount, rng = Math.random) {
  const { min, max } = gapRangeFor(level);
  const types = [];
  const push = (type) => { if (types.length < trialCount) types.push(type); };

  for (let i = 0; i < THRESHOLDS.firstGoTrials; i++) push('go');
  while (types.length < trialCount) {
    const gap = min + Math.floor(rng() * (max - min + 1));
    for (let i = 0; i < gap; i++) push('go');
    push('nogo');
  }
  return types.map((type, index) => ({ index, type }));
}
