// 결과 화면 — 이 도구의 산출물이다. 교사·작업치료사가 이 화면을 읽고 지도 방향을 정하고, 연구 자료로도 쓴다.
// 숫자가 틀린 칸에 들어가거나 라벨이 틀리면 처방이 반대로 간다. 특히 "참아야 할 때 누른 것"(억제 실패)과
// "눌러야 할 때 안 누른 것"(누락)은 절대 합쳐 보이지 않는다.
//
// 화면 계약: createResultScreen(deps) → { mount(rootEl, { session, saveResult, onBack }), unmount() }.
//   session: js/flow.js가 만든 회차(Session). saveResult: flow가 들고 온 { ok, error } — 이력에서 연 회차는 없다.
//   deps는 쓰지 않는다: 저장소는 설정 화면(setup.js)처럼 storage.js를 직접 읽는다(읽기 전용이다).
//
// 이 화면은 글을 쓰는 교사 화면이다. 버튼은 click이다(스크롤하는 화면이라 pointerdown이면 스크롤하려는 손가락이 눌린다).
//
// 판정 기준값은 전부 config.js에서 읽는다. 지표는 회차의 원자료(responses)에서 매번 다시 계산한다.
// 가져온 옛 회차는 모양이 틀릴 수 있으므로(responses 없음, 기기 정보 없음, 지금 없는 테마 id) 어떤 필드도 믿지 않는다.
import { THRESHOLDS } from '../config.js';
import { computeMetrics } from '../metrics.js';
import { evaluateBadge } from '../badge.js';
import { interpret } from '../interpretation.js';
import { THEMES } from '../themes.js';
import { listSessions, trendSessions } from '../storage.js';

// ---- DOM 도우미 ----------------------------------------------------------------------------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

const DASH = '—'; // 값을 말할 수 없을 때. "null"·"NaN"이 화면에 나가지 않게 한다.
const UNKNOWN = '알 수 없음';

const pct = (ratio) => `${Math.round(ratio * 100)}%`;
const ms = (value) => `${Math.round(value)}ms`;

// ---- 원자료 정리 ---------------------------------------------------------------------------
// responses가 없거나 일부가 깨진 회차(가져온 옛 자료)도 그릴 수 있게 한다. 모르는 문항은 버리고, rtMs는 숫자 아니면 "반응 없음"으로 본다.
function cleanResponses(session) {
  const list = Array.isArray(session?.responses) ? session.responses : [];
  return list
    .filter((r) => r && typeof r === 'object' && (r.type === 'go' || r.type === 'nogo'))
    .map((r) => ({
      ...r,
      rtMs: typeof r.rtMs === 'number' && Number.isFinite(r.rtMs) ? r.rtMs : null,
      invalid: Boolean(r.invalid),
    }));
}

// ---- 문항 분류 -----------------------------------------------------------------------------
// js/metrics.js의 분류와 같아야 한다(tests/screens.result.test.js가 무작위 문항 열로 개수를 맞춰 본다).
//   Go    + 입력 없음            → omission
//   Go    + 기준 미만 입력       → early (조급 반응만, 정반응 아님)
//   Go    + 기준 이상 입력       → hit
//   No-Go + 입력 없음            → correctRejection (참기 성공)
//   No-Go + 입력                 → commission (기준 미만이어도 억제 실패 막대다. 조급 반응에도 1이 더해지는 것은 타일의 몫이다.)
export function classifyTrial(response) {
  if (response.invalid) return 'invalid';
  const responded = response.rtMs !== null && response.rtMs !== undefined;
  if (response.type === 'go') {
    if (!responded) return 'omission';
    return response.rtMs < THRESHOLDS.anticipatoryMs ? 'early' : 'hit';
  }
  return responded ? 'commission' : 'correctRejection';
}

// 글자 기호(mark)는 색을 못 보아도 종류를 구별하게 하는 두 번째 단서다. 첫째 단서는 막대 모양(CSS), 셋째는 아래의 고/노 글자다.
const KINDS = {
  hit: { label: '정반응', mark: '●', desc: '눌러야 할 때 눌렀습니다' },
  // 기준 시간은 config에서 그때그때 읽는다(모듈이 불릴 때 굳히지 않는다).
  early: { label: '조급 반응', mark: '▲', get desc() { return `눌러야 할 때 ${THRESHOLDS.anticipatoryMs / 1000}초보다 빨리 눌렀습니다(정반응으로 세지 않음)`; } },
  correctRejection: { label: '참기 성공', mark: '○', desc: '참아야 할 때 참았습니다(No-Go 정반응)' },
  commission: { label: '억제 실패', mark: '✕', desc: '참아야 할 때 눌렀습니다' },
  omission: { label: '누락', mark: '▽', desc: '눌러야 할 때 누르지 않았습니다' },
  invalid: { label: '무효', mark: '·', desc: '화면이 가려져 지표에서 뺀 문항입니다' },
};
const KIND_ORDER = ['hit', 'early', 'correctRejection', 'commission', 'omission', 'invalid'];
const TYPE_LABEL = { go: '고', nogo: '노' };

// ---- 배지 ----------------------------------------------------------------------------------
const STATUS = {
  ok: { label: '양호', symbol: '✓', hint: '결과를 해석할 수 있습니다.' },
  reference: { label: '억제 지표 참고용', symbol: 'ⓘ', hint: '다른 지표는 해석할 수 있지만, 억제 지표는 문항이 부족해 참고로만 보세요.' },
  caution: { label: '해석 주의', symbol: '⚠', hint: '아래 이유를 확인한 뒤 수치를 읽으세요.' },
  uninterpretable: { label: '해석 불가', symbol: '✕', hint: '이 결과로 학생의 억제력을 판단하지 마세요.' },
};
const OK_TEXT = '조급 반응·누락·무효 문항이 모두 기준 안에 있고, 참아야 할 그림도 충분합니다.';

// ReasonCode → 교사가 읽는 문장. 숫자는 이번 회차의 값과 config의 기준이다(하드코딩하지 않는다).
// 각 문장은 "무엇이 기준을 넘었나 → 그래서 수치를 어떻게 읽나 → 교사가 무엇을 하나" 순서다.
export function describeReason(code, metrics) {
  const total = metrics.validTrials + metrics.invalidTrials;
  switch (code) {
    case 'anticipatory':
      return `조급 반응이 전체 ${metrics.validTrials}문항 중 ${metrics.anticipatory}개(${pct(metrics.anticipatoryRate)})로, 기준(${pct(THRESHOLDS.anticipatoryRate)} 이상)을 넘었습니다. 그림을 보고 판단하기 전에 누른 반응이 많아 수치를 그대로 믿기 어렵습니다. 규칙을 이해했는지 연습으로 다시 확인한 뒤 재검사해 보세요.`;
    case 'omission':
      return `눌러야 할 그림 ${metrics.goTrials}개 중 ${metrics.omissions}개를 놓쳤습니다(기준 ${pct(THRESHOLDS.omissionRate)} 이상). 과제에 참여하지 않은 것으로 보여 이 결과로 억제력을 판단하면 안 됩니다. 학생의 컨디션과 주변 환경을 살피고 다른 날 다시 해 보세요.`;
    case 'consecutiveOmissions':
      return `눌러야 할 그림을 연달아 ${metrics.maxConsecutiveOmissions}번 놓친 구간이 있습니다(기준 ${THRESHOLDS.consecutiveOmissions}번 이상). 중간에 집중이 끊겼을 수 있습니다. 아래 문항별 흐름에서 ▽ 표시가 이어진 곳을 확인하고, 그때 무슨 일이 있었는지 살펴보세요.`;
    case 'tooFewNoGo':
      return `참아야 할 그림이 ${metrics.noGoTrials}개뿐이라 억제 지표를 해석하는 데 필요한 ${THRESHOLDS.minNoGoTrials}개에 못 미칩니다. 억제 실패 횟수는 참고로만 보세요. 짧은 검사는 억제를 재기보다 과제에 적응하고 참여하는지 확인하는 용도입니다. 억제력을 보려면 더 긴 검사를 하세요.`;
    case 'tooManyInvalid':
      return `화면이 가려져 무효가 된 문항이 전체 ${total}문항 중 ${metrics.invalidTrials}개(${pct(metrics.invalidRate)})로, 기준(${pct(THRESHOLDS.invalidTrialRate)} 이상)을 넘었습니다. 검사가 자주 끊긴 것입니다. 알림과 다른 앱을 끄고, 학생이 화면을 가리지 않게 한 뒤 다시 해 보세요.`;
    default:
      return `알 수 없는 이유(${code})로 해석에 주의가 필요합니다. 이 화면보다 새로운 도구 버전에서 만든 회차일 수 있습니다.`;
  }
}

function badgeSection(metrics, badge) {
  const status = STATUS[badge.status] ?? STATUS.caution;
  const box = h(
    'section',
    { class: 'badge', dataset: { badge: '', status: badge.status } },
    h('p', { class: 'badge-title' }, h('span', { 'aria-hidden': 'true', dataset: { badgeSymbol: '' }, text: `${status.symbol} ` }), status.label),
    h('p', { class: 'badge-hint', text: status.hint }),
  );
  if (badge.reasons.length === 0) {
    box.append(h('p', { text: OK_TEXT }));
  } else {
    box.append(h('ul', { class: 'badge-reasons' }, ...badge.reasons.map((code) => h('li', { dataset: { reason: code }, text: describeReason(code, metrics) }))));
  }
  return box;
}

// ---- 요약 타일 -----------------------------------------------------------------------------
const CONSISTENCY_LABEL = { good: '일정함', fair: '보통', poor: '들쭉날쭉' };

function consistencyNote(metrics) {
  if (metrics.consistency === null || metrics.rtSd === null) {
    if (metrics.hits === 0) return '정반응이 없어 계산할 수 없습니다';
    if (metrics.hits === 1) return '정반응이 1개뿐이라 편차를 계산할 수 없습니다';
    return '계산할 수 없습니다';
  }
  return `반응시간 편차 ${ms(metrics.rtSd)}`;
}

// reference: 참고용 표시(점선 테두리). unreliable: 배지가 "해석 불가"라서 붙은 표시(더 강한 단서).
// referenceNotes: 타일 아래 글자. 색·테두리만으로 알리지 않는다.
function tile({ key, label, hint, value, note, primary = false, reference = false, unreliable = false, referenceNotes = [] }) {
  return h(
    'div',
    {
      class: `tile${primary ? ' tile-primary' : ''}`,
      dataset: {
        tile: key,
        ...(primary ? { primary: 'true' } : {}),
        ...(reference ? { reference: 'true' } : {}),
        ...(unreliable ? { unreliable: 'true' } : {}),
      },
    },
    h('p', { class: 'tile-label', dataset: { tileLabel: '' }, text: label }),
    h('p', { class: 'tile-hint', text: hint }),
    h('p', { class: 'tile-value', dataset: { tileValue: '' }, text: value }),
    h('p', { class: 'tile-note text-muted', dataset: { tileNote: '' }, text: note }),
    ...referenceNotes.map((text) => h('p', { class: 'tile-reference', dataset: { referenceNote: '' }, text })),
  );
}

// 배지가 "해석 불가"이면 억제 실패를 포함한 모든 숫자에 단서를 붙인다. 사람은 배지보다 큰 숫자를 먼저 본다.
const UNRELIABLE_NOTE = '해석 불가 판정 — 이 숫자로 학생을 판단하지 마세요.';

function tiles(metrics, badge) {
  const noGoShort = badge.reasons.includes('tooFewNoGo'); // 설정 화면이 약속한 "억제 지표는 참고용" — 기준은 badge.js 한 곳에서 온다
  const unreliable = badge.status === 'uninterpretable';
  const general = unreliable ? { reference: true, unreliable: true, referenceNotes: [UNRELIABLE_NOTE] } : {};
  const goEarly = Math.max(0, metrics.goTrials - metrics.hits - metrics.omissions);
  const anticipatorySeconds = THRESHOLDS.anticipatoryMs / 1000;

  const hitsNote = metrics.goTrials === 0
    ? '눌러야 할 그림이 없었습니다'
    : `눌러야 할 그림 ${metrics.goTrials}개 중${goEarly > 0 ? ` (그 외 ${goEarly}개는 너무 빨리 눌러 조급 반응으로 셌습니다)` : ''}`;

  return h(
    'div',
    { class: 'tiles' },
    tile({
      key: 'commissions',
      label: '억제 실패',
      hint: '참아야 할 때 누름 · 억제력의 핵심 지표',
      value: metrics.noGoTrials === 0 ? DASH : String(metrics.commissions),
      note: metrics.noGoTrials === 0 ? '참아야 할 그림이 없었습니다' : `참아야 할 그림 ${metrics.noGoTrials}개 중`,
      primary: true,
      reference: noGoShort || unreliable,
      unreliable,
      referenceNotes: [
        ...(unreliable ? [UNRELIABLE_NOTE] : []),
        ...(noGoShort ? [`참고용 — 참아야 할 그림이 ${metrics.noGoTrials}개뿐이라(${THRESHOLDS.minNoGoTrials}개 이상 필요) 억제 지표로 해석하기엔 부족합니다.`] : []),
      ],
    }),
    tile({
      key: 'hits',
      ...general,
      label: '정반응',
      hint: '눌러야 할 때 누름',
      value: metrics.goTrials === 0 ? DASH : String(metrics.hits),
      note: hitsNote,
    }),
    tile({
      key: 'omissions',
      ...general,
      label: '누락',
      hint: '눌러야 할 때 안 누름 · 억제가 아니라 주의력 문제',
      value: metrics.goTrials === 0 ? DASH : String(metrics.omissions),
      note: metrics.goTrials === 0 ? '눌러야 할 그림이 없었습니다' : `눌러야 할 그림 ${metrics.goTrials}개 중`,
    }),
    tile({
      key: 'meanRt',
      ...general,
      label: '평균 반응속도',
      hint: '정반응만 계산',
      value: metrics.meanRt === null ? DASH : ms(metrics.meanRt),
      note: metrics.meanRt === null ? '정반응이 없어 계산할 수 없습니다' : `정반응 ${metrics.hits}개의 평균`,
    }),
    tile({
      key: 'consistency',
      ...general,
      label: '반응 일관성',
      hint: '정반응 반응시간이 들쭉날쭉한 정도',
      value: CONSISTENCY_LABEL[metrics.consistency] ?? DASH,
      note: consistencyNote(metrics),
    }),
    tile({
      key: 'anticipatory',
      ...general,
      label: '조급 반응',
      hint: `${anticipatorySeconds}초보다 빨리 누름 · 보고 누른 반응이 아님`,
      value: metrics.validTrials === 0 ? DASH : String(metrics.anticipatory),
      note: metrics.validTrials === 0 ? '유효한 문항이 없습니다' : `전체 ${metrics.validTrials}문항 중`,
    }),
  );
}

function overlapNote() {
  return h('p', {
    class: 'overlap-note text-muted',
    dataset: { overlapNote: '' },
    text: `참아야 할 그림을 ${THRESHOLDS.anticipatoryMs / 1000}초보다 빨리 누르면 '억제 실패'와 '조급 반응' 양쪽에 각각 1로 셉니다. 서로 다른 기준이라 중복 계상이 맞고, 그래서 두 칸의 합이 문항 수를 넘을 수 있습니다.`,
  });
}

// ---- 문항별 흐름 ---------------------------------------------------------------------------
function trialLabel(response, index, kind) {
  const base = `${index + 1}번째 ${response.type === 'go' ? '눌러야 할' : '참아야 할'} 그림, ${KINDS[kind].label}`;
  return response.rtMs !== null && kind !== 'invalid' ? `${base}, ${ms(response.rtMs)}` : base;
}

function trialColumn(response, index, maxRt) {
  const kind = classifyTrial(response);
  const showsHeight = response.rtMs !== null && (kind === 'hit' || kind === 'early' || kind === 'commission');
  const fill = showsHeight
    ? h('span', { class: 'bar-fill', dataset: { barFill: '' }, style: `height: ${((response.rtMs / maxRt) * 100).toFixed(1)}%` })
    : h('span', { class: 'bar-fill', dataset: { barFill: '', empty: 'true' } });
  const number = (index + 1) % 10 === 0 ? h('span', { text: String(index + 1) }) : null;
  const label = trialLabel(response, index, kind);
  return h(
    'span',
    { class: 'trial-bar', role: 'img', 'aria-label': label, title: label, dataset: { trialBar: '', kind, type: response.type } },
    h('span', { class: 'trial-mark', 'aria-hidden': 'true', dataset: { mark: '' }, text: KINDS[kind].mark }),
    h('span', { class: 'trial-plot', 'aria-hidden': 'true' }, fill),
    h('span', { class: 'trial-type', 'aria-hidden': 'true', dataset: { typeLabel: '' }, text: TYPE_LABEL[response.type] }),
    h('span', { class: 'trial-no', 'aria-hidden': 'true' }, number),
  );
}

// 전체를 한 화면 폭에 줄여 보는 요약: 위 줄은 눌러야 하는 그림(고), 아래 줄은 참아야 하는 그림(노)이고, 틀린 문항은 칸이 높다.
// 색이 아니라 줄(위치)과 높이(모양)가 먼저 알려 준다.
function overviewStrip(responses, kinds) {
  const counts = KIND_ORDER.map((k) => `${KINDS[k].label} ${kinds.filter((x) => x === k).length}`).join(', ');
  const strip = h('div', {
    class: 'overview',
    role: 'img',
    'aria-label': `전체 ${responses.length}문항 요약: ${counts}`,
    dataset: { trialOverview: '' },
  });
  strip.style.gridTemplateColumns = `repeat(${Math.max(responses.length, 1)}, minmax(0, 1fr))`;
  responses.forEach((r, i) => {
    const cell = h('i', { class: 'overview-cell', 'aria-hidden': 'true', dataset: { overviewCell: '', kind: kinds[i], type: r.type } });
    cell.style.gridColumn = String(i + 1);
    strip.append(cell);
  });
  return strip;
}

function legend() {
  return h(
    'ul',
    { class: 'legend', dataset: { trialLegend: '' } },
    ...KIND_ORDER.map((kind) =>
      h(
        'li',
        {},
        h('span', { class: 'legend-mark', 'aria-hidden': 'true', text: KINDS[kind].mark }),
        h('span', { class: 'legend-swatch', 'aria-hidden': 'true', dataset: { kind } }),
        h('span', {}, h('strong', { text: KINDS[kind].label }), ` — ${KINDS[kind].desc}`),
      ),
    ),
  );
}

function flowSection(responses) {
  const kinds = responses.map(classifyTrial);
  const rts = responses.filter((r, i) => r.rtMs !== null && ['hit', 'early', 'commission'].includes(kinds[i])).map((r) => r.rtMs);
  const maxRt = Math.max(...rts, 1);

  const strip = h('div', { class: 'trial-strip', tabindex: '0', role: 'group', 'aria-label': '문항별 흐름(옆으로 밀어서 봅니다)', dataset: { trialStrip: '', scroll: 'horizontal' } });
  const inner = h('div', { class: 'trial-strip-inner' }, ...responses.map((r, i) => trialColumn(r, i, maxRt)));
  strip.append(inner);

  return h(
    'section',
    { class: 'result-section', dataset: { flow: '' } },
    h('h2', { text: '문항별 흐름' }),
    h('p', { text: '문항을 순서대로 늘어놓았습니다. 막대가 높을수록 반응이 느렸습니다. 언제부터 무너졌는지 보세요.' }),
    h('p', { class: 'text-muted flow-caption', text: '전체 보기: 위 줄은 눌러야 하는 그림(고), 아래 줄은 참아야 하는 그림(노)입니다. 칸이 높으면 억제 실패나 누락입니다.' }),
    overviewStrip(responses, kinds),
    h('p', { class: 'text-muted flow-caption', text: '자세히 보기: 옆으로 밀어서 봅니다.' }),
    strip,
    h('p', {
      class: 'text-muted',
      dataset: { trialStripScale: '' },
      text: rts.length === 0 ? '반응시간이 기록된 문항이 없습니다.' : `막대 높이 = 반응시간 (가장 높은 막대 ${ms(maxRt)})`,
    }),
    legend(),
  );
}

// ---- 전반 vs 후반 --------------------------------------------------------------------------
function halfCard(key, title, half) {
  return h(
    'div',
    { class: 'half', dataset: { half: key } },
    h('h3', { text: title }),
    h('p', {}, '억제 실패 ', h('strong', { dataset: { halfCommissions: '' }, text: String(half.commissions) }), '회'),
    h('p', {}, '평균 반응속도 ', h('strong', { dataset: { halfMeanrt: '' }, text: half.meanRt === null ? DASH : ms(half.meanRt) })),
  );
}

function halvesSection(metrics, badge) {
  const noGoShort = badge.reasons.includes('tooFewNoGo');
  const unreliable = badge.status === 'uninterpretable';
  return h(
    'section',
    { class: 'result-section', dataset: { halves: '', ...(noGoShort || unreliable ? { reference: 'true' } : {}) } },
    h('h2', { text: '전반과 후반' }),
    h('p', { text: '얼마나 버티는지 봅니다. 유효 문항을 앞 절반과 뒤 절반으로 나눴고, 문항 수가 홀수면 앞쪽이 하나 더 많습니다. 뒤로 갈수록 억제 실패가 늘거나 반응이 느려지면 회기를 짧게 끊어 반복해 보세요.' }),
    h('div', { class: 'halves' }, halfCard('first', '앞 절반', metrics.halves.first), halfCard('second', '뒤 절반', metrics.halves.second)),
    unreliable ? h('p', { class: 'text-muted', text: UNRELIABLE_NOTE }) : null,
    noGoShort ? h('p', { class: 'text-muted', text: '참고용 — 참아야 할 그림이 적어 앞뒤로 나누면 억제 실패 횟수는 더 믿기 어렵습니다.' }) : null,
  );
}

// ---- 회차별 추이 ---------------------------------------------------------------------------
const pad2 = (n) => String(n).padStart(2, '0');

function validDate(ms_) {
  if (typeof ms_ !== 'number' || !Number.isFinite(ms_)) return null;
  const d = new Date(ms_);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(ms_) {
  const d = validDate(ms_);
  return d ? `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : UNKNOWN;
}

function formatShortDate(ms_) {
  const d = validDate(ms_);
  return d ? `${d.getMonth() + 1}/${d.getDate()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : UNKNOWN;
}

// ---- 기기 동일성 ---------------------------------------------------------------------------
// 같은 기기로 볼 기준: 기기 종류 + 화면 크기(짧은 변×긴 변) + 브라우저 이름. 반응시간의 터치 지연을 가르는 것은 기기와 브라우저이고,
// 그 셋이 같으면 같은 조건에서 잰 것으로 본다.
//   - 브라우저는 이름만 본다: Chrome 151 → 152 같은 자동 업데이트로 "다른 기기"라고 경고하면 경고를 믿지 않게 된다.
//   - 화면 크기는 짧은 변×긴 변으로 맞춘다: 폰을 돌리면 screen.width/height가 바뀌는 브라우저가 있다.
//   - 주사율·화면 배율은 쓰지 않는다: 주사율은 측정 실패(null)가 흔해 같은 기기를 다른 기기로 갈라놓는다.
// 기기 정보가 하나도 없는 회차(가져온 옛 자료)끼리는 같은 묶음(?|?|?)이다. 알려진 기기와 섞이면 같은 기기임을 확인할 수 없으므로 경고한다.
function deviceInfo(session) {
  const d = session && session.device && typeof session.device === 'object' ? session.device : {};
  const kind = typeof d.kind === 'string' && d.kind !== '' ? d.kind : null;
  const w = Number.isFinite(d.screenW) && d.screenW > 0 ? d.screenW : null;
  const hgt = Number.isFinite(d.screenH) && d.screenH > 0 ? d.screenH : null;
  const browserRaw = typeof d.browser === 'string' ? d.browser.trim() : '';
  const browser = browserRaw === '' || browserRaw === 'unknown' ? null : browserRaw.replace(/\s*\d[\d.]*$/, '');
  const size = w !== null && hgt !== null ? { short: Math.min(w, hgt), long: Math.max(w, hgt) } : null;
  return { kind, size, browser };
}

function deviceSignature(session) {
  const { kind, size, browser } = deviceInfo(session);
  return [kind ?? '?', size ? `${size.short}x${size.long}` : '?', browser ?? '?'].join('|');
}

function deviceDescription(session) {
  const { kind, size, browser } = deviceInfo(session);
  if (kind === null && size === null && browser === null) return '기기 정보 없음';
  return [DEVICE_KIND[kind] ?? '종류 미상', size ? `${size.short}×${size.long}` : null, browser].filter(Boolean).join(' ');
}

function trendPoint(session, isCurrent, differentDevice = false) {
  const metrics = computeMetrics(cleanResponses(session));
  const badge = evaluateBadge(metrics);
  const status = STATUS[badge.status] ?? STATUS.caution;
  const hasRate = metrics.noGoTrials > 0;
  const rate = hasRate ? metrics.correctRejections / metrics.noGoTrials : null;
  const tags = [];
  if (badge.status !== 'ok') tags.push(status.label);
  if (differentDevice) tags.push('다른 기기');
  const li = h(
    'li',
    { class: 'trend-point', dataset: { trendPoint: '', ...(isCurrent ? { current: 'true' } : {}) } },
    h('span', { class: 'trend-when', text: formatShortDate(session.startedAt) }),
    h(
      'span',
      { class: 'trend-track' },
      hasRate ? h('span', { class: 'trend-bar', dataset: { trendBar: '' }, style: `width: ${Math.round(rate * 100)}%` }) : null,
    ),
    h('span', {
      class: 'trend-rate',
      dataset: { trendRate: '' },
      text: hasRate ? `${metrics.correctRejections}/${metrics.noGoTrials} (${pct(rate)})` : '참아야 할 그림이 없어 계산할 수 없습니다',
    }),
    tags.length ? h('span', { class: 'trend-tag', text: tags.join(' · ') }) : null,
    isCurrent ? h('span', { class: 'trend-now', text: '◀ 이번 회차' }) : null,
  );
  return li;
}

function trendSection(session) {
  // 완료·같은 단계는 storage.trendSessions가 맡는다. 지금 회차는 저장에 실패했을 수도 있으니 따로 합치고, id로 겹침을 없앤다.
  const byId = new Map(trendSessions(session.studentAlias, session.level).map((s) => [s.id, s]));
  if (session.complete) byId.set(session.id, session);
  const points = [...byId.values()].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));

  const levelText = Number.isFinite(session.level) ? `${session.level}단계` : UNKNOWN;
  const notes = [];
  if (!session.complete) notes.push('이번 회차는 중단되어 추이에 넣지 않았습니다.');
  if (points.length === 0) notes.push('이 단계에서 완료한 회차가 아직 없습니다.');
  else if (points.length === 1 && session.complete) notes.push('이 단계의 완료 회차가 이번 하나뿐이라 추이를 그릴 수 없습니다. 같은 학생이 같은 단계로 검사를 반복하면 쌓입니다.');

  // 두 종류 이상의 기기가 섞였으면 알린다. 회차를 걸러내지 않는다(교사가 "회차가 왜 사라졌지" 하지 않게).
  const signatures = points.map(deviceSignature);
  const distinct = [...new Set(signatures)];
  const mixed = distinct.length >= 2;
  const mixedWarning = mixed
    ? h(
        'div',
        { class: 'notice', dataset: { trendDeviceWarning: '' } },
        h('p', { class: 'notice-title' }, h('span', { 'aria-hidden': 'true', text: '⚠ ' }), '서로 다른 기기에서 잰 회차가 섞여 있습니다'),
        h('p', { text: `이 추이에는 ${distinct.length}종류의 기기에서 잰 회차가 함께 있습니다. 기기마다 터치 지연이 달라, 이 회차들 사이에서 반응시간(평균 반응속도, 반응 일관성)을 비교하지 마세요. 아래 억제 성공률은 기기 지연의 영향이 작아 추이로 볼 수 있지만, ${THRESHOLDS.anticipatoryMs / 1000}초 근처의 조급 반응 판정은 영향을 받을 수 있으니 기기가 다른 회차끼리는 참고로만 보세요.` }),
        h('ul', {}, ...distinct.map((sig) => h('li', { text: deviceDescription(points[signatures.indexOf(sig)]) }))),
      )
    : null;
  const currentSignature = deviceSignature(session);

  return h(
    'section',
    { class: 'result-section', dataset: { trend: '' } },
    h('h2', { text: `회차별 추이 (${levelText})` }),
    h('p', { text: `억제 성공률 = 참아야 할 때 참은 비율(참기 성공 ÷ 참아야 할 그림 수)입니다. 이 학생의 ${levelText} 완료 회차만 그렸습니다. 다른 단계와 중단한 회차는 넣지 않았습니다. 추이는 같은 기기에서 반복 검사했을 때만 쌓입니다.` }),
    ...notes.map((n) => h('p', { class: 'text-muted', dataset: { trendNote: '' }, text: n })),
    mixedWarning,
    points.length ? h('ol', { class: 'trend' }, ...points.map((s, i) => trendPoint(s, s.id === session.id, mixed && signatures[i] !== currentSignature))) : null,
  );
}

// ---- 해석 한 줄 ----------------------------------------------------------------------------
const EMPTY_INTERPRETATION =
  '이번 회차에서는 따로 짚을 특징이 없었습니다. 억제 실패와 누락, 전반·후반의 변화, 반응 일관성, 조급 반응이 모두 이 도구가 문장으로 알려 주는 기준에 걸리지 않았다는 뜻입니다. 문제가 없다는 뜻이 아닙니다. 위의 수치와 문항별 흐름을 함께 보세요.';

function interpretationSection(metrics, badge) {
  if (badge.status === 'uninterpretable') return null; // 배지가 이미 "해석하지 말라"고 했다. 그 아래에 해석을 얹지 않는다.
  if (metrics.validTrials === 0) {
    // 아무것도 측정되지 않았는데 "특징이 없었다"고 하면 깨끗한 결과로 읽힌다. 배지가 말하는 것과도 어긋난다.
    return h(
      'section',
      { class: 'result-section', dataset: { interpretation: '', unmeasured: 'true' } },
      h('h2', { text: '해석 한 줄' }),
      h('p', { text: '측정된 문항이 없어 해석할 수 없습니다. 문항이 하나도 기록되지 않았거나, 모두 화면이 가려져 무효가 되었습니다.' }),
    );
  }
  const sentences = interpret(metrics, badge);
  const box = h('section', { class: 'result-section', dataset: { interpretation: '', ...(sentences.length === 0 ? { empty: 'true' } : {}) } }, h('h2', { text: '해석 한 줄' }));
  if (sentences.length > 0) box.append(h('ul', { class: 'interpretation' }, ...sentences.map((s) => h('li', { text: s }))));
  else box.append(h('p', { text: EMPTY_INTERPRETATION }));
  if (badge.reasons.includes('tooFewNoGo')) {
    box.append(h('p', { class: 'text-muted', dataset: { referenceNote: '' }, text: `참아야 할 그림이 ${metrics.noGoTrials}개뿐이라 억제와 관련된 내용은 참고로만 읽으세요.` }));
  }
  box.append(h('p', { class: 'text-muted', text: '이 문장은 진단이 아니라 수치를 말로 바꾼 것입니다. 작업치료 전문가의 검토를 거치기 전의 초안이므로, 지도 방향을 정할 때 다른 관찰과 함께 보세요.' }));
  return box;
}

// ---- 머리글 --------------------------------------------------------------------------------
function formatDuration(session) {
  const span = session.endedAt - session.startedAt;
  if (typeof session.startedAt !== 'number' || typeof session.endedAt !== 'number' || !Number.isFinite(span) || span < 0) return UNKNOWN;
  const total = Math.round(span / 1000);
  const minutes = Math.floor(total / 60);
  return minutes > 0 ? `${minutes}분 ${total % 60}초` : `${total}초`;
}

function themeText(id) {
  const theme = THEMES.find((t) => t.id === id);
  if (theme) return `${theme.goGlyph} ${theme.label}`;
  // getTheme은 모르는 id에 던진다. 옛 회차나 가져온 회차의 낡은 id가 화면을 죽이지 않게 THEMES에서 직접 찾는다.
  if (typeof id !== 'string' || id === '') return UNKNOWN;
  return `${id} (현재 목록에 없는 테마)`;
}

function sessionNumber(session) {
  const earlier = listSessions(session.studentAlias).filter((s) => s.id !== session.id && s.startedAt < session.startedAt);
  return earlier.length + 1;
}

function row(label, value) {
  return h('div', { class: 'kv' }, h('dt', { text: label }), h('dd', { text: value }));
}

function headerSection(session, responses) {
  const levelText = Number.isFinite(session.level) ? `${session.level}단계` : UNKNOWN;
  const planned = Number.isFinite(session.trialCount) ? session.trialCount : responses.length;
  const trialsText = session.complete ? `${planned}문항` : `${responses.length}문항 진행 (계획 ${planned}문항)`;
  return h(
    'header',
    { class: 'result-header', dataset: { reportHeader: '' } },
    h('h1', { text: '검사 결과' }),
    h(
      'dl',
      { class: 'kv-list' },
      row('학생', typeof session.studentAlias === 'string' && session.studentAlias !== '' ? session.studentAlias : '이름 없음'),
      row('회차', `${sessionNumber(session)}회차${session.complete ? '' : ' (중단)'}`),
      row('날짜', formatDate(session.startedAt)),
      row('테마', themeText(session.themeId)),
      row('난이도 단계', levelText),
      row('소요 시간', formatDuration(session)),
      row('문항 수', trialsText),
      row('도구 버전', typeof session.toolVersion === 'string' && session.toolVersion !== '' ? session.toolVersion : UNKNOWN),
    ),
    h('p', { class: 'text-muted', text: '난이도 단계가 다른 회차의 수치는 비교하지 마세요. 좋아진 것인지 쉬운 단계로 내려간 것인지 구별되지 않습니다.' }),
  );
}

// ---- 안내 상자 -----------------------------------------------------------------------------
function noticeBox(kind, title, paragraphs, extra = null) {
  return h(
    'div',
    { class: 'notice', dataset: { notice: kind } },
    h('p', { class: 'notice-title' }, h('span', { 'aria-hidden': 'true', text: '⚠ ' }), title),
    ...paragraphs.map((text) => h('p', { text })),
    extra,
  );
}

// storage.js가 { ok: false, error }로 돌려주는 오류 문자열을 종류로 가른다. 종류에 따라 교사에게 시킬 일이 정반대다:
//   quota       용량 초과 → 백업 후 저장 공간을 정리하면 된다.
//   unreadable  이미 저장된 자료를 읽을 수 없음(깨진 JSON, 손상, 다른 버전) → 복구할 수 있을 수 있다. 정리(삭제)를 시키면 몇 달치 회차가 사라진다.
//   unavailable 저장소 접근 불가(차단·사생활 보호 모드)
//   other       그 밖, 또는 알 수 없음 → 원인을 단정하지 않는다. 틀린 원인은 없는 원인보다 나쁘다.
// unreadable을 가장 먼저 가른다("stored ..."로 시작). 그 문장들에 다른 종류의 낱말이 섞여도 정리를 시키지 않는 쪽으로 틀어지게 하려는 것이다.
export function classifySaveError(error) {
  if (typeof error !== 'string' || error === '') return 'other';
  if (/^stored /.test(error)) return 'unreadable';
  if (/quota/i.test(error)) return 'quota';
  if (/unavailable|SecurityError/i.test(error)) return 'unavailable';
  return 'other';
}

const SAVE_FAILED_TEXT = {
  quota: [
    '저장 공간이 부족해 이 기기에 저장하지 못했습니다.',
    '이력 화면에서 기록을 내보내 백업한 뒤 브라우저의 이 사이트 저장 공간을 정리하세요. 이 회차는 다시 저장할 수 없고, 필요하면 다시 검사해야 합니다.',
  ],
  unreadable: [
    '이 기기에 이미 저장된 기록을 읽을 수 없는 상태라 이 회차를 저장하지 못했습니다. 기존 기록을 덮어쓰지 않으려고 저장을 거부한 것입니다.',
    '기존 기록은 복구할 수 있을 수 있으니 브라우저의 사이트 데이터나 저장 공간을 지우지 마세요. 먼저 이력 화면에서 저장된 기록을 파일로 내려받으세요. 이 회차는 다시 저장할 수 없습니다.',
  ],
  unavailable: [
    '브라우저가 저장을 막고 있어 이 기기에 저장하지 못했습니다. 사생활 보호(시크릿) 모드이거나 사이트 데이터 저장이 꺼져 있을 수 있습니다.',
    '이 상태에서는 검사 결과가 기기에 남지 않습니다. 일반 창으로 열어 다시 검사하세요.',
  ],
  other: [
    '이 회차를 저장하지 못했습니다.',
    '이 회차는 다시 저장할 수 없고, 필요하면 다시 검사해야 합니다.',
  ],
};

function saveFailedNotice(saveResult) {
  const kind = classifySaveError(saveResult.error);
  const [cause, advice] = SAVE_FAILED_TEXT[kind];
  const raw = typeof saveResult.error === 'string' && saveResult.error !== '' ? saveResult.error : null;
  // 오류 원문은 영어이거나 기술 용어라 본문에 두지 않고, 문의할 때 쓰도록 접어 둔다.
  const details = raw
    ? h('details', { class: 'notice-details' }, h('summary', { text: '오류 원문 보기 (문의할 때 필요합니다)' }), h('p', { text: raw }))
    : null;
  return noticeBox('save-failed', '이 회차는 저장되지 않았습니다', [
    cause,
    '지금은 이 결과를 볼 수 있지만, 이 화면을 닫으면 이 회차는 기기에 남지 않아 나중에 이력에서 찾을 수 없습니다. 닫기 전에 화면을 캡처해 두세요.',
    advice,
  ], details);
}

function abortedNotice(session, responses) {
  const planned = Number.isFinite(session.trialCount) ? session.trialCount : responses.length;
  return noticeBox('aborted', '중단된 회차입니다', [
    `검사를 끝까지 하지 않았습니다. 계획한 ${planned}문항 중 ${responses.length}문항까지만 기록되어, 아래 수치는 앞부분만 본 것입니다. 이 회차는 회차별 추이에 포함되지 않습니다.`,
    '어디서 멈췄는지 문항별 흐름에서 확인해 보세요. 중간에 그만둔 것 자체도 참여도에 대한 정보입니다.',
  ]);
}

// ---- 측정 조건과 주의 ----------------------------------------------------------------------
const DEVICE_KIND = { phone: '스마트폰', tablet: '태블릿', desktop: '컴퓨터' };
const INPUT_KIND = { touch: '터치', mouse: '마우스' };

function conditionsSection(session, metrics) {
  const device = session.device && typeof session.device === 'object' ? session.device : {};
  const hasSize = Number.isFinite(device.screenW) && Number.isFinite(device.screenH) && device.screenW > 0 && device.screenH > 0;
  const sizeText = hasSize
    ? `${device.screenW}×${device.screenH}${Number.isFinite(device.dpr) ? ` (화면 배율 ${device.dpr})` : ''}`
    : UNKNOWN;
  const hzKnown = Number.isFinite(device.refreshHzEst) && device.refreshHzEst > 0;
  // refreshHzEst가 null이면 "측정을 하지 않았다"와 "측정했지만 실패했다"를 구별할 수 없다. 그 사실을 그대로 적는다.
  const hzText = hzKnown ? `${device.refreshHzEst}Hz` : `${UNKNOWN} (측정하지 않았거나 측정에 실패했습니다. 어느 쪽인지는 기록에 남지 않습니다)`;
  const browser = typeof device.browser === 'string' && device.browser !== '' && device.browser !== 'unknown' ? device.browser : UNKNOWN;

  const hzRow = h('div', { class: 'kv', dataset: { deviceHz: '', known: hzKnown ? 'true' : 'false' } }, h('dt', { text: '화면 주사율(추정)' }), h('dd', { text: hzText }));

  return h(
    'section',
    { class: 'result-section', dataset: { conditions: '' } },
    h('h2', { text: '측정 조건과 주의' }),
    h(
      'dl',
      { class: 'kv-list' },
      row('기기', DEVICE_KIND[device.kind] ?? UNKNOWN),
      row('화면 크기', sizeText),
      row('브라우저', browser),
      row('입력 수단', INPUT_KIND[device.inputKind] ?? UNKNOWN),
      hzRow,
      row('도구 버전', typeof session.toolVersion === 'string' && session.toolVersion !== '' ? session.toolVersion : UNKNOWN),
    ),
    h(
      'ul',
      { class: 'cautions' },
      h('li', { text: '스마트폰은 기기마다 터치 지연이 달라, 다른 기기에서 잰 반응시간의 절대값을 직접 비교할 수 없습니다. 이 도구가 보장하는 것은 같은 학생이 같은 기기에서 반복 측정한 회차 간 비교입니다.' }),
      h('li', { text: '난이도 단계가 다른 회차의 수치는 비교하지 마세요. 좋아진 것인지 쉬운 단계로 내려간 것인지 구별되지 않습니다.' }),
      h('li', { text: `CSV로 내보내 분석할 때는 invalid=0인 행만 세어야 이 화면의 수치와 일치합니다. 화면이 가려져 무효가 된 문항도 CSV에는 남지만, 이 화면의 모든 수치에서는 빠집니다. 이번 회차의 무효 문항은 ${metrics.invalidTrials}개입니다.` }),
      h('li', { text: `반응 일관성은 정반응 반응시간의 표준편차로 정합니다. ${THRESHOLDS.consistencySdGoodMs}ms 이하면 '일정함', ${THRESHOLDS.consistencySdFairMs}ms 이하면 '보통', 그보다 크면 '들쭉날쭉'입니다.` }),
    ),
  );
}

// ---- 화면 ----------------------------------------------------------------------------------
function backButton() {
  return h('button', { type: 'button', class: 'btn btn-secondary btn-block', dataset: { action: 'back' }, text: '돌아가기' });
}

export function createResultScreen() {
  let mounted = null; // { rootEl, onClick }

  function unmount() {
    if (!mounted) return;
    mounted.rootEl.removeEventListener('click', mounted.onClick);
    mounted = null;
  }

  function mount(rootEl, params = {}) {
    unmount();
    const { session, saveResult, onBack } = params ?? {};

    // 위임 리스너 하나. 돌아가기 버튼이 위아래에 있어도 정리할 것은 이것뿐이다.
    const onClick = (event) => {
      const target = event.target;
      const button = target && typeof target.closest === 'function' ? target.closest('[data-action="back"]') : null;
      if (button && rootEl.contains(button)) onBack?.();
    };
    rootEl.addEventListener('click', onClick);
    mounted = { rootEl, onClick };

    const screen = h('div', { class: 'teacher-screen result-screen', dataset: { screen: 'result' } });
    rootEl.append(screen);
    try { globalThis.scrollTo?.(0, 0); } catch { /* 스크롤을 못 올려도 화면은 그대로 쓸 수 있다 */ }

    if (!session || typeof session !== 'object') {
      screen.append(
        h('h1', { text: '검사 결과' }),
        h('p', { text: '이 회차를 찾을 수 없습니다. 지워졌거나 불러오지 못한 회차입니다.' }),
        backButton(),
      );
      return;
    }

    const responses = cleanResponses(session);
    const metrics = computeMetrics(responses);
    const badge = evaluateBadge(metrics);

    // null(해당 없는 구역)은 거른다. DOM의 append에 null을 주면 "null"이라는 글자가 들어간다.
    screen.append(...[
      h('div', { class: 'result-top' }, backButton()),
      saveResult && saveResult.ok === false ? saveFailedNotice(saveResult) : null,
      session.complete ? null : abortedNotice(session, responses),
      headerSection(session, responses),
      badgeSection(metrics, badge),
      h('section', { class: 'result-section', dataset: { summary: '' } }, h('h2', { text: '요약' }), tiles(metrics, badge), overlapNote()),
      flowSection(responses),
      halvesSection(metrics, badge),
      trendSection(session),
      interpretationSection(metrics, badge),
      conditionsSection(session, metrics),
      backButton(),
    ].filter(Boolean));
  }

  return { mount, unmount };
}
