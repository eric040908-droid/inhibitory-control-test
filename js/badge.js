// 검사 집중도 배지: Metrics → Badge. 스펙 §5.8의 조건 표를 조건 목록으로 둔다.
// 판정 기준값은 config.js의 THRESHOLDS에서만 읽는다.
// 문장은 담지 않는다. 화면 문구는 Task 13이 ReasonCode를 보고 정한다.
import { THRESHOLDS } from './config.js';

// 심각도 순위. 숫자가 클수록 심하다. status는 걸린 조건 중 가장 심한 것이다.
const SEVERITY = { ok: 0, reference: 1, caution: 2, uninterpretable: 3 };

// Go 문항 대비 누락 비율. Go 문항이 없으면 0으로 본다 (0으로 나누지 않는다).
const omissionRate = (m) => (m.goTrials === 0 ? 0 : m.omissions / m.goTrials);

// 판정 조건 목록. 모든 조건을 평가하고, 걸린 조건의 이유를 모두 남긴다.
// 누락 판정은 maxConsecutiveOmissions(Go 누락만 센 값)를 쓴다. 참기 성공을 이탈로 세지 않기 위해서다.
const CONDITIONS = [
  {
    code: 'anticipatory',
    status: 'caution',
    trips: (m) => m.anticipatoryRate >= THRESHOLDS.anticipatoryRate,
  },
  {
    code: 'omission',
    status: 'uninterpretable',
    trips: (m) => omissionRate(m) >= THRESHOLDS.omissionRate,
  },
  {
    code: 'consecutiveOmissions',
    status: 'caution',
    trips: (m) => m.maxConsecutiveOmissions >= THRESHOLDS.consecutiveOmissions,
  },
  {
    code: 'tooFewNoGo',
    status: 'reference',
    trips: (m) => m.noGoTrials < THRESHOLDS.minNoGoTrials,
  },
  {
    code: 'tooManyInvalid',
    status: 'caution',
    trips: (m) => m.invalidRate >= THRESHOLDS.invalidTrialRate,
  },
];

export function evaluateBadge(metrics) {
  const tripped = CONDITIONS.filter((c) => c.trips(metrics));
  const reasons = tripped.map((c) => c.code);
  const status = tripped.reduce(
    (worst, c) => (SEVERITY[c.status] > SEVERITY[worst] ? c.status : worst),
    'ok',
  );
  return { status, reasons };
}
