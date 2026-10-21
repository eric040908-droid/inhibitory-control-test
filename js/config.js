// 모든 판정 기준값과 난이도 파라미터의 단일 출처.
// 다른 모듈은 숫자를 하드코딩하지 말고 여기서 import 한다.
// 아래 값은 모두 스펙 §5.8 기준의 "임시값"이며, 현장 검증 후 이 파일에서만 조정한다.

// 도구 버전 — 결과 기록·내보내기 파일에 함께 남긴다. (스펙 §5.8 임시값)
export const TOOL_VERSION = '0.1.0';

// 난이도별 자극 제시 시간(ms)·자극 간 간격(ms)·No-Go 비율·같은 범주 No-Go 여부. (스펙 §5.8 임시값)
export const LEVELS = {
  1: { stimulusMs: 4000, interTrialMs: 1500, noGoRatio: 0.20, sameCategoryNoGo: false },
  2: { stimulusMs: 2400, interTrialMs: 1200, noGoRatio: 0.25, sameCategoryNoGo: false },
  3: { stimulusMs: 1400, interTrialMs: 900,  noGoRatio: 0.33, sameCategoryNoGo: true  },
};

// 난이도 × 검사 길이(short/medium/long)별 문항 수. (스펙 §5.8 임시값)
export const TRIAL_COUNTS = {
  1: { short: 18, medium: 50, long: 85 },
  2: { short: 22, medium: 65, long: 100 },
  3: { short: 30, medium: 85, long: 100 },
};

// 한 검사의 문항 수 상한. TRIAL_COUNTS의 모든 값은 이 값 이하여야 한다. (스펙 §5.8 임시값)
export const MAX_TRIALS = 100;

export const THRESHOLDS = {
  // 이 시간(ms) 미만의 반응은 자극을 보고 한 반응이 아닌 예측 반응으로 본다. (스펙 §5.8 임시값)
  anticipatoryMs: 200,
  // Go 반응 중 예측 반응 비율이 이 값 이상이면 판정에 반영한다. (스펙 §5.8 임시값)
  anticipatoryRate: 0.20,
  // Go 시행 중 무반응(누락) 비율이 이 값 이상이면 판정에 반영한다. (스펙 §5.8 임시값)
  omissionRate: 0.40,
  // 연속 무반응이 이 횟수 이상이면 주의 이탈로 본다. (스펙 §5.8 임시값)
  consecutiveOmissions: 5,
  // 억제 지표를 해석하려면 필요한 최소 No-Go 시행 수. (스펙 §5.8 임시값)
  minNoGoTrials: 8,
  // 무효 시행 비율이 이 값 이상이면 검사 전체를 신뢰하지 않는다. (스펙 §5.8 임시값)
  invalidTrialRate: 0.10,
  // 자극 사라진 뒤에도 이 시간(ms) 동안의 반응은 해당 시행의 반응으로 인정한다. (스펙 §5.8 임시값)
  responseGraceMs: 500,
  // 반응 없이 허용 구간이 끝난 문항을 엔진이 닫는 시점을 구간 끝보다 이만큼(ms) 늦춘다.
  // 구간 안에 일어난 탭인데 스마트폰 메인 스레드가 막혀 핸들러가 닫는 타이머보다 늦게 실행되는 경우를 살리기 위한 것이다.
  // 입력이 유효한지는 이 값과 무관하게 이벤트 시각으로만 판정하므로 허용 구간이 넓어지지 않는다 — 놓친 문항의 종료만 늦어진다.
  // (스펙 §5.8 임시값)
  closeSlackMs: 50,
  // 검사 시작 직후 No-Go 없이 연속 제시하는 Go 시행 수. (스펙 §5.8 임시값)
  firstGoTrials: 3,
  // No-Go 사이에 들어가는 Go 개수의 범위는 고정값이 아니라 난이도의 noGoRatio에서 유도한다.
  //   평균 간격 = round(1 / noGoRatio) − 1
  //   퍼짐 = min(noGoGapSpread, 평균 − 1)
  //   실제 범위 = [평균 − 퍼짐, 평균 + 퍼짐]
  // 범위를 평균에 대해 대칭으로 유지하는 것이 핵심이다. 아래쪽만 1에서 자르면(max(1, 평균 − spread)) 평균 간격이
  // 올라가 요구한 No-Go 비율보다 낮게 나온다. (3단계: 1~4는 평균 2.5라 약 28.6%, 1~3은 평균 2라 약 33%)
  // 간격 범위를 모든 난이도에 고정해도(예: 1~4) 평균 간격이 2.5, 즉 No-Go 밀도가 약 28.6%로 굳어져
  // 1단계(20%)·2단계(25%)가 요구하는 No-Go 비율을 수학적으로 만들 수 없다. (스펙 §5.8 임시값)
  noGoGapSpread: 2,
  // 보상 칸(별) 수를 전체 문항 수의 이 비율로 잡는다. (스펙 §5.8 임시값)
  rewardCellRatio: 0.70,
  // 연습 블록에서 반응이 없을 때 자동으로 다음 시행으로 넘어가는 시간(ms). (스펙 §5.8 임시값)
  practiceAutoAdvanceMs: 8000,
  // 반응 일관성 라벨 경계: 반응시간 표준편차(ms)가 good 이하면 "일정함". (스펙 §5.8 임시값)
  consistencySdGoodMs: 120,
  // 반응 일관성 라벨 경계: 표준편차(ms)가 fair 이하면 "보통", 초과하면 "들쭉날쭉". (스펙 §5.8 임시값)
  consistencySdFairMs: 220,
};

// 연습 블록: Go/No-Go 시행 수, 사용 난이도, 재시도 허용 횟수. (스펙 §5.8 임시값)
export const PRACTICE = {
  go: 5,
  noGo: 3,
  level: 2,
  maxRetries: 1,
  // 3단계 추천: 연습을 모두 맞히고 평균 반응이 이 값(ms) 미만일 때. (스펙 §5.3 임시값)
  fastMeanRtMs: 1000,
  // 2단계 추천의 하한: 정반응이 이 개수 이상. (스펙 §5.3 임시값)
  minHitsForLevel2: 3,
  // 2단계 추천의 하한: 참기 성공이 이 개수 이상. (스펙 §5.3 임시값)
  minRejectionsForLevel2: 1,
  // 재시도 후에도 정반응이 이 개수 이하면 검사 중단을 안내한다. (스펙 §5.3 임시값)
  abortMaxHits: 1,
};

// 결과 화면 "해석 한 줄"(js/interpretation.js)의 발화 기준. 전문가 검토 전의 임시값이다.
// 해석 불가·주의 판정 기준은 위 THRESHOLDS에 있고, 여기는 그보다 약한 "방향 힌트" 기준이다.
export const INTERPRETATION = {
  // 후반 억제 실패가 전반보다 이 횟수 이상 많으면 "후반에 몰림". 차이가 이보다 작으면 "고르게"로 본다. (임시값)
  lateShiftMinCommissions: 2,
  // 후반 평균 반응이 전반의 이 배율 이상이면 "후반이 느려짐". (임시값)
  lateSlowdownRatio: 1.1,
  // Go 문항 중 누락 비율이 이 값 이상이면 "누락이 많음". THRESHOLDS.omissionRate(해석 불가)보다 낮아야 한다. (임시값)
  manyOmissionRate: 0.25,
  // No-Go 문항 중 억제 실패 비율이 이 값 이하면 "억제 실패 적음". (임시값)
  fewCommissionRate: 0.2,
  // No-Go 문항 중 억제 실패 비율이 이 값 이상이면 "억제 실패 많음". (임시값)
  manyCommissionRate: 0.4,
};
