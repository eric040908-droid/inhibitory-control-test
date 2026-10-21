// 결과 화면 맨 아래 "해석 한 줄": Metrics + Badge → 0~2개의 문장.
// 진단이 아니라 수치를 말로 바꾼 것이다. 교사·작업치료사가 읽고 지도 방향을 정한다.
//
// 문장과 발화 조건은 아래 INTERPRETATION_RULES 한 곳에만 있다. 전문가 검토 후에는 이 테이블의 값만 교체한다.
// 판정 기준값은 config.js(THRESHOLDS, INTERPRETATION)에서만 읽는다.
import { THRESHOLDS, INTERPRETATION as T } from './config.js';

const MAX_SENTENCES = 2;

// 분모가 0이면 비율을 말할 수 없으므로 null. null은 아래 조건에서 항상 "해당 없음"으로 취급한다.
const rate = (count, total) => (total === 0 ? null : count / total);
const commissionRate = (m) => rate(m.commissions, m.noGoTrials);
const omissionRate = (m) => rate(m.omissions, m.goTrials);

const isFew = (r) => r !== null && r <= T.fewCommissionRate;
const isMany = (r) => r !== null && r >= T.manyCommissionRate;
const manyOmissions = (m) => { const r = omissionRate(m); return r !== null && r >= T.manyOmissionRate; };
const manyAnticipatory = (m) => m.anticipatoryRate >= THRESHOLDS.anticipatoryRate;

// 후반 억제 실패가 전반보다 기준 횟수 이상 많다.
const failuresLateShifted = ({ halves }) =>
  halves.second.commissions - halves.first.commissions >= T.lateShiftMinCommissions;
// 후반 평균 반응이 전반보다 기준 배율 이상 느리다. 어느 한쪽이 null이면(정반응 없음) 판단하지 않는다.
const slowedLater = ({ halves }) =>
  halves.first.meanRt !== null && halves.second.meanRt !== null &&
  halves.second.meanRt >= halves.first.meanRt * T.lateSlowdownRatio;

// [조건(metrics) → boolean, 문장] 쌍. 스펙 §5.7 초안 규칙 순서이며, 참인 것 중 앞쪽 2개만 쓰인다.
// 조건은 서로 독립적으로 읽을 수 있게 각자 필요한 전제(분모 0, null 지표)를 스스로 확인한다.
export const INTERPRETATION_RULES = [
  [
    // 억제 실패가 후반에 몰리고 후반 반응속도가 느려짐 → 억제보다 지속 시간
    (m) => failuresLateShifted(m) && slowedLater(m),
    '참아야 할 때 누른 횟수가 후반에 늘었고 반응도 느려졌습니다. 억제 자체보다 과제를 이어 가는 지속 시간의 영향일 수 있어, 회기를 짧게 끊어 여러 번 나누어 해 보세요.',
  ],
  [
    // 억제 실패는 적고 누락이 많음 → 억제보다 주의력
    (m) => isFew(commissionRate(m)) && manyOmissions(m),
    '참아야 할 때 누른 횟수는 적었지만 눌러야 할 때 놓친 횟수가 많았습니다. 억제보다 주의력 쪽을 먼저 살펴보세요.',
  ],
  [
    // 억제 실패가 전·후반에 고르게 많음 → 억제 자체의 어려움
    (m) => isMany(commissionRate(m)) &&
      m.halves.first.commissions > 0 && m.halves.second.commissions > 0 &&
      !failuresLateShifted(m),
    '참아야 할 때 누른 횟수가 전반과 후반 모두 많았습니다. 시간이 지나서 흐트러진 것이 아니라 억제 자체가 어려운 것으로 보여, 멈추기 연습을 더 해 보세요.',
  ],
  [
    // 반응 일관성 편차가 큼 → 주의가 계속 끊김
    (m) => m.consistency === 'poor',
    '반응 속도의 편차가 컸습니다. 과제 중 주의가 계속 끊기고 있을 수 있어, 시작 전에 시선을 모으고 주변 자극을 줄여 보세요.',
  ],
  [
    // 조급 반응이 많음 → 자극을 보기 전에 누르는 패턴, 과제 이해 재확인
    (m) => manyAnticipatory(m),
    '그림을 보고 판단하기 전에 먼저 누른 반응이 많았습니다. 규칙을 이해했는지 연습으로 다시 확인해 보세요.',
  ],
  [
    // 전 구간 안정적이고 억제 실패 적음 → 현재 단계가 쉬울 수 있음
    (m) => m.consistency === 'good' && isFew(commissionRate(m)) &&
      !manyOmissions(m) && !manyAnticipatory(m) && !slowedLater(m) && !failuresLateShifted(m),
    '처음부터 끝까지 반응이 안정적이었고 참아야 할 때 누른 횟수도 적었습니다. 현재 단계가 쉬울 수 있어, 다음 회차에 단계를 올리는 것을 검토해 보세요.',
  ],
];

export function interpret(metrics, badge) {
  if (badge.status === 'uninterpretable') return [];
  return INTERPRETATION_RULES
    .filter(([applies]) => applies(metrics))
    .slice(0, MAX_SENTENCES)
    .map(([, sentence]) => sentence);
}
