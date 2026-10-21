// 연습 결과 → 난이도 추천. 스펙 §5.3의 추천 표를 위에서 아래로 평가한다.
// 연습의 목적은 능력 측정이 아니라 "규칙을 이해했는가"의 확인이다. 기준값은 config.js의 PRACTICE에서만 읽는다.
import { PRACTICE } from './config.js';

// PracticeResult = { hits, goTrials, correctRejections, noGoTrials, meanRt: number|null, attempt }
//   attempt는 1부터 센다. 1이 첫 시도, 2가 재시도다.
// Recommendation = { level: 1|2|3|null, retry, abort }. abort가 true이면 level은 null이다.
export function recommendLevel(result) {
  const { hits, goTrials, correctRejections, noGoTrials, meanRt, attempt } = result;

  // 표 1행: 전부 맞히고(Go 정반응 전부 + 참기 전부) 평균 반응이 빠르면 3단계.
  // meanRt가 null이면 빠르다고 말할 근거가 없으므로 3단계로 올리지 않는다.
  const perfect = hits === goTrials && correctRejections === noGoTrials;
  const fast = meanRt !== null && meanRt < PRACTICE.fastMeanRtMs;
  if (perfect && fast) return { level: 3, retry: false, abort: false };

  // 표 2행: 규칙을 이해한 것으로 볼 최소선.
  if (hits >= PRACTICE.minHitsForLevel2 && correctRejections >= PRACTICE.minRejectionsForLevel2) {
    return { level: 2, retry: false, abort: false };
  }

  // 위에 못 미침: 재시도가 남아 있으면 재시도한다. attempt 1이 첫 시도이므로 maxRetries번까지 재시도할 수 있다.
  if (attempt <= PRACTICE.maxRetries) return { level: null, retry: true, abort: false };

  // 재시도 후에도 못 미침. 정반응이 거의 없으면 검사 중단, 아니면 1단계.
  if (hits <= PRACTICE.abortMaxHits) return { level: null, retry: false, abort: true };
  return { level: 1, retry: false, abort: false };
}
