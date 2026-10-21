// 지표 계산: Response[] → Metrics. 스펙 §5.7의 정의 테이블과 중복 계상 규칙을 따른다.
// 판정 기준값은 config.js에서만 읽는다.
//
// 분류 (무효 문항을 뺀 유효 문항 기준, 입력 순서 유지):
//   Go    + 입력 없음            → 누락(omission)
//   Go    + 입력, 기준 미만      → 조급 반응만 (정반응 아님, 평균·편차에서 제외)
//   Go    + 입력, 기준 이상      → 정반응(hit)
//   No-Go + 입력 없음            → 참기 성공(correctRejection)
//   No-Go + 입력                 → 억제 실패(commission). 기준 미만이면 조급 반응에도 1 더한다.
// "기준" = THRESHOLDS.anticipatoryMs. 조급 반응은 그 값 미만, 정반응은 그 값 이상이다.
import { THRESHOLDS } from './config.js';

const isAnticipatory = (r) => r.rtMs !== null && r.rtMs < THRESHOLDS.anticipatoryMs;
const isHit = (r) => r.type === 'go' && r.rtMs !== null && !isAnticipatory(r);
const isOmission = (r) => r.type === 'go' && r.rtMs === null;
const isCommission = (r) => r.type === 'nogo' && r.rtMs !== null;

// 분모가 0이면 0을 돌려준다 (NaN·Infinity가 화면에 나가지 않게).
const ratio = (num, den) => (den === 0 ? 0 : num / den);

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

// 표본표준편차(n−1). 값이 2개 미만이면 정의되지 않으므로 null.
function sampleSd(values) {
  if (values.length < 2) return null;
  const m = mean(values);
  const sumSq = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

function labelConsistency(sd) {
  if (sd === null) return null;
  if (sd <= THRESHOLDS.consistencySdGoodMs) return 'good';
  if (sd <= THRESHOLDS.consistencySdFairMs) return 'fair';
  return 'poor';
}

// Go 누락의 최대 연속 길이. 참기 성공(No-Go 무반응)은 끊지도 잇지도 않는다.
// 정반응·조급 반응 Go와 억제 실패(No-Go 입력)는 "반응이 있었다"는 뜻이므로 연속을 끊는다.
function maxConsecutiveOmissions(valid) {
  let max = 0;
  let run = 0;
  for (const r of valid) {
    if (isOmission(r)) {
      run += 1;
      if (run > max) max = run;
    } else if (!(r.type === 'nogo' && r.rtMs === null)) {
      run = 0;
    }
  }
  return max;
}

function halfMetrics(trials) {
  return {
    commissions: trials.filter(isCommission).length,
    meanRt: mean(trials.filter(isHit).map((r) => r.rtMs)),
  };
}

export function computeMetrics(responses) {
  const valid = responses.filter((r) => !r.invalid);
  const invalidTrials = responses.length - valid.length;

  const hitRts = valid.filter(isHit).map((r) => r.rtMs);
  const rtSd = sampleSd(hitRts);
  const anticipatory = valid.filter(isAnticipatory).length;

  // 유효 문항 순서로 반 나눈다. 홀수면 전반이 한 개 더 갖는다.
  const split = Math.ceil(valid.length / 2);

  return {
    goTrials: valid.filter((r) => r.type === 'go').length,
    noGoTrials: valid.filter((r) => r.type === 'nogo').length,
    hits: hitRts.length,
    omissions: valid.filter(isOmission).length,
    commissions: valid.filter(isCommission).length,
    correctRejections: valid.filter((r) => r.type === 'nogo' && r.rtMs === null).length,
    anticipatory,
    anticipatoryRate: ratio(anticipatory, valid.length),
    meanRt: mean(hitRts),
    rtSd,
    consistency: labelConsistency(rtSd),
    maxConsecutiveOmissions: maxConsecutiveOmissions(valid),
    validTrials: valid.length,
    invalidTrials,
    invalidRate: ratio(invalidTrials, responses.length),
    halves: {
      first: halfMetrics(valid.slice(0, split)),
      second: halfMetrics(valid.slice(split)),
    },
  };
}
