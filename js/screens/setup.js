// 교사 설정 화면 — 앱의 첫 화면이자, 교사가 검사에 개입하는 두 지점 중 하나(다른 하나는 결과 확인).
//
// 운용: 교사가 자기 폰으로 설정하고 "시작"을 누른 뒤 자리를 비운다. 그 뒤부터 끝까지 학생 혼자 한다.
// 그래서 이 화면의 목표는 개입을 줄이는 것이다: 같은 학생을 반복 검사할 때는 "지난 설정으로 바로 시작" 한 번으로 끝나고,
// 시작 전에 알아야 할 것(억제 문항 부족, 같은 기기 안내, 저장 불가)은 모두 시작 버튼 위에 보인다.
//
// 화면 계약: createSetupScreen(deps) → { mount(rootEl, { onStart, onHistory }), unmount() }.
//   deps.audio.setEnabled만 쓴다. audio·engine은 직접 import하지 않고 deps로 받는다(테스트가 호출을 관찰한다).
//   onStart({ alias, themeId, length, levelOverride: 1|2|3|null }) — levelOverride가 null이면 연습 결과로 정한다.
//
// 입력: 이 화면의 버튼은 click이다(스크롤하는 화면이라 pointerdown이면 스크롤하려는 손가락이 버튼을 누른다).
// 학생의 반응 입력만 pointerdown이다. 라디오·체크박스·입력란·선택 상자는 브라우저 기본 동작(change/input)을 그대로 쓴다 —
// 키보드로도 조작되어야 하기 때문이다.
import { LEVELS, PRACTICE, THRESHOLDS, TRIAL_COUNTS } from '../config.js';
import { THEMES } from '../themes.js';
import { isAvailable, lastSetup, listStudents, saveLastSetup } from '../storage.js';
import { measureRefreshHz } from '../deviceInfo.js';
import * as pin from '../pin.js';
import { readPrefs, writePrefs } from '../prefs.js';

// ---- 선택지 ------------------------------------------------------------------------------
// 값은 TRIAL_COUNTS의 키와 같아야 한다(tests가 고정한다). 글자만 여기서 붙인다.
const LENGTH_OPTIONS = [
  { id: 'short', label: '짧게' },
  { id: 'medium', label: '보통' },
  { id: 'long', label: '길게' },
];
const DEFAULT_LENGTH = 'medium';
const LEVEL_IDS = Object.keys(LEVELS).map(Number);

const levelLabel = (level) => (level === null ? '연습으로 결정' : `${level}단계`);

// ---- No-Go 문항 부족 판정 ------------------------------------------------------------------
// 억제 지표는 참아야 할 문항이 적으면 해석할 수 없다. 기대 No-Go 수 = 문항 수 × noGoRatio.
// 실제 순서 생성기는 목표 개수를 정하지 않고 간격으로 뽑으므로 이 값은 "약" 몇 개다(스펙의 표현과 같다).
// 소수 비율의 곱은 이론상 부동소수점 오차가 붙을 수 있어(현재 config 값에서는 정확히 나온다), 기준과 정확히 같은 값이
// 오차 때문에 한쪽으로 틀리게 갈리지 않도록 1e-6 자리에서 다듬는다. 값이 바뀌어도 안전하게 두기 위한 방어다.
// 판정에는 정수 반올림을 쓰지 않는다: 7.5개를 8개로 올려 경고를 끄지 않는다.
export function expectedNoGoCount(level, length) {
  return Math.round(TRIAL_COUNTS[level][length] * LEVELS[level].noGoRatio * 1e6) / 1e6;
}

// 기준(THRESHOLDS.minNoGoTrials)에 못 미치면 { level, count }, 충분하면 null.
// level이 null(연습으로 결정)이면 어느 단계가 될지 모르므로 가장 보수적인 단계, 즉 No-Go가 가장 적은 단계로 본다.
export function noGoShortage(level, length) {
  const candidates = level === null ? LEVEL_IDS : [level];
  let worst = null;
  for (const candidate of candidates) {
    const count = expectedNoGoCount(candidate, length);
    if (worst === null || count < worst.count) worst = { level: candidate, count };
  }
  return worst.count < THRESHOLDS.minNoGoTrials ? worst : null;
}

function shortageLead(level, worst) {
  // 약 N개는 반올림하되, 기준 미만이라는 문장과 어긋나지 않게 기준 − 1을 넘기지 않는다(7.5개를 "약 8개 … 8개에 부족"으로 쓰지 않는다).
  const n = Math.min(Math.round(worst.count), THRESHOLDS.minNoGoTrials - 1);
  const need = THRESHOLDS.minNoGoTrials;
  if (level === null) {
    return `난이도를 연습으로 정하면 ${worst.level}단계가 될 수 있고, 그 경우 참아야 하는 그림이 약 ${n}개로 필요한 ${need}개에 부족합니다. 억제 지표는 참고용으로만 표시될 수 있습니다.`;
  }
  return `이 조합은 참아야 하는 그림이 약 ${n}개로, 억제 지표를 해석하는 데 필요한 ${need}개에 부족합니다. 결과의 억제 지표는 참고용으로만 표시됩니다.`;
}

// ---- 소리·애니메이션 선택 ------------------------------------------------------------------
// 보관(localStorage의 별도 키)은 js/prefs.js가 맡는다 — flow.js가 같은 값을 회차에 남기기 때문이다.
// 켜짐이면 html[data-reduced-motion="true"], 꺼짐이면 속성 자체를 지운다(css는 ="true"만 본다).
// unmount에서 되돌리지 않는다 — 이 선택은 검사 화면까지 이어져야 한다.
function applyReducedMotion(on) {
  const root = globalThis.document.documentElement;
  if (on) root.setAttribute('data-reduced-motion', 'true');
  else root.removeAttribute('data-reduced-motion');
}

// ---- 지난 설정 읽기 ------------------------------------------------------------------------
// 저장된 값은 믿지 않는다. getTheme은 모르는 id에 던지므로 THEMES에서 직접 찾는다.
// 틀린 항목은 null이 되고, 바로 시작은 별칭·테마·길이가 모두 멀쩡할 때만 낸다
// (없는 테마를 다른 테마로 몰래 바꿔 시작하면 측정 조건이 달라진다).
function readSaved() {
  const raw = lastSetup();
  if (!raw || typeof raw !== 'object') return null;
  return {
    alias: typeof raw.alias === 'string' ? raw.alias.trim() : '',
    themeId: THEMES.some((t) => t.id === raw.themeId) ? raw.themeId : null,
    length: LENGTH_OPTIONS.some((o) => o.id === raw.length) ? raw.length : null,
    level: Number.isInteger(raw.level) && LEVELS[raw.level] ? raw.level : null,
  };
}

// ---- DOM 도우미 ----------------------------------------------------------------------------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'checked' || key === 'value') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children);
  return el;
}

// 눈에 띄는 안내 상자. 제목 앞의 기호가 색 없이도 "주의"임을 알린다.
function notice(kind, title, paragraphs, { symbol = '⚠' } = {}) {
  return h(
    'div',
    { class: 'notice', dataset: { notice: kind } },
    h('p', { class: 'notice-title' }, h('span', { 'aria-hidden': 'true', text: `${symbol} ` }), title),
    ...paragraphs.map((text) => h('p', { text })),
  );
}

// 라디오·체크박스 한 칸. 칸 전체가 label이라 어디를 눌러도 선택되고, 선택 표시는 기본 라디오 점·체크 표시가 맡는다.
function choice(type, name, value, checked, ...content) {
  return h(
    'label',
    { class: 'choice' },
    h('input', { type, name, value, checked }),
    h('span', { class: 'choice-text' }, ...content),
  );
}

function fieldset(legend, ...children) {
  return h('fieldset', { class: 'setup-section' }, h('legend', { text: legend }), ...children);
}

// ---- 화면 ------------------------------------------------------------------------------------
export function createSetupScreen(deps) {
  let controller = null;

  return {
    mount(rootEl, params = {}) {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      const { onStart, onHistory } = params ?? {};

      // 버튼 누르기: click. 교사 화면은 스크롤되므로 pointerdown이면 스크롤하려고 손가락을 댄 것이 버튼을 누른다.
      // click은 브라우저가 탭과 스크롤을 가려 주고, <button>의 Enter/Space도 click이 되어 키보드로도 눌린다.
      // (학생의 반응 입력만 pointerdown이다 — 반응시간을 재는 경로이고, 이 화면은 측정 경로가 아니다.)
      const press = (el, fn) => {
        el.addEventListener('click', () => fn(), { signal });
      };

      // ---- 시작 상태 ----
      const saved = readSaved();
      const prefs = readPrefs();
      // PIN 잠금 중에는 이 화면이 다른 학생의 이름을 보여 주지 않는다(스펙 §5.9 공용 PC 대응). 이 화면은 앱의 첫 화면이고 잠기지 않으며,
      // 검사받으러 온 학생이 맨 처음 보는 화면이다. 가리는 것은 CSS가 아니라 DOM에 올리지 않는 것이다 — 학생은 확대하고,
      // 글자를 선택하고, 화면 낭독기를 켤 수 있다. 가리는 곳: 학생 목록(<select>), 바로 시작의 학생 이름, 별칭 입력란의 미리 채운 값.
      const locked = pin.isEnabled();
      const state = {
        themeId: saved?.themeId ?? THEMES[0].id,
        length: saved?.length ?? DEFAULT_LENGTH,
        level: saved?.level ?? null,
      };

      // 소리와 애니메이션은 화면이 뜨는 순간 저장된 선택대로 맞춘다. 오디오 모듈은 화면이 바뀌어도 상태를 유지한다.
      deps.audio.setEnabled(prefs.sound);
      applyReducedMotion(prefs.reducedMotion);

      // 연구 사용: 화면 주사율 추정은 비동기 측정이다. 교사가 설정하는 동안 끝나도록 여기서 발사만 하고
      // 결과를 기다리지 않는다. 값은 deviceInfo가 기억하고 검사 시작 때 collectDeviceInfo가 읽는다. 실패하면 null일 뿐이다.
      try {
        Promise.resolve(measureRefreshHz(window)).catch(() => {});
      } catch {
        // 측정이 동기로 던져도 설정 화면은 뜬다.
      }

      // ---- 구성 요소 ----
      const children = [];
      children.push(
        h('h1', { text: '억제 통제 검사' }),
        h('p', { class: 'text-muted', text: '설정을 마치고 시작을 누르면, 그 뒤로는 학생이 혼자 진행합니다.' }),
      );

      if (!isAvailable()) {
        children.push(notice('storage-unavailable', '이 기기에서는 결과를 저장할 수 없습니다', [
          '검사는 그대로 진행되고 결과 화면도 볼 수 있지만, 결과가 기기에 남지 않아 나중에 다시 볼 수 없고 회차별 추이도 쌓이지 않습니다. 사생활 보호 모드이거나 저장이 막혀 있을 수 있습니다.',
          '소리와 애니메이션 선택도 다음에 유지되지 않습니다.',
        ]));
      }

      // 지난 설정으로 바로 시작 — 교사가 누르는 것은 이 버튼 하나뿐이다.
      let started = false;
      const begin = (setup) => {
        if (started) return; // 더블탭이 검사를 두 번 시작하지 않게
        started = true;
        try {
          onStart?.(setup);
        } catch (error) {
          started = false;
          throw error;
        }
      };

      if (saved && saved.alias && saved.themeId && saved.length) {
        const theme = THEMES.find((t) => t.id === saved.themeId);
        const lengthLabel = LENGTH_OPTIONS.find((o) => o.id === saved.length).label;
        const quick = h('button', { type: 'button', class: 'btn btn-block', dataset: { action: 'quick-start' }, text: '지난 설정으로 바로 시작' });
        press(quick, () => begin({ alias: saved.alias, themeId: saved.themeId, length: saved.length, levelOverride: saved.level }));
        const worst = noGoShortage(saved.level, saved.length);
        children.push(h(
          'section',
          { class: 'quick-start' },
          h('p', {
            dataset: { quickSummary: '' },
            text: locked
              ? `지난 검사와 같은 설정: ${theme.label} · ${lengthLabel} · 난이도 ${levelLabel(saved.level)}`
              : `지난 검사와 같은 설정: ${saved.alias} · ${theme.label} · ${lengthLabel} · 난이도 ${levelLabel(saved.level)}`,
          }),
          // 이름이 보이던 때는 그 이름이 "이 버튼이 누구로 기록하는가"를 확인하는 유일한 수단이었다. 가린 뒤에는 말로 알려야 한다:
          // 학생을 돌려 쓰는 교사가 모르고 누르면 다른 학생의 자료가 지난 학생의 이름으로 조용히 기록된다(분석 때 찾을 수 없다).
          locked && h('p', {
            class: 'notice-title',
            dataset: { quickAttribution: '' },
            text: '⚠ 이 버튼은 지난번에 검사한 학생의 이름으로 기록합니다(PIN 잠금 중이라 이름은 가립니다). 다른 학생이면 누르지 말고 아래에서 별칭을 새로 입력하세요.',
          }),
          worst && h('p', { dataset: { notice: 'quick-start-shortage' }, text: `⚠ ${shortageLead(saved.level, worst)}` }),
          quick,
          h('p', { class: 'text-muted', text: '다른 설정으로 검사하려면 아래에서 고르세요.' }),
        ));
      }

      // 별칭
      const aliasInput = h('input', {
        type: 'text', name: 'alias', id: 'alias', value: locked ? '' : saved?.alias ?? '',
        autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-describedby': 'alias-guide',
      });
      const aliasError = h('div', { 'aria-live': 'polite' });
      aliasInput.addEventListener('input', () => aliasError.replaceChildren(), { signal });

      const aliasChildren = [
        h('label', { for: 'alias', class: 'field-label', text: '학생 별칭' }),
        aliasInput,
        aliasError,
      ];
      const students = locked ? [] : listStudents();
      if (locked) {
        aliasChildren.push(h('p', { class: 'text-muted', dataset: { lockedStudents: '' }, text: 'PIN 잠금 중에는 이전에 검사한 학생 목록을 보여 주지 않습니다. 별칭을 직접 입력하세요.' }));
      }
      if (students.length > 0) {
        const known = h(
          'select',
          { name: 'knownStudents', 'aria-label': '이전에 검사한 학생에서 고르기' },
          h('option', { value: '', text: '이전에 검사한 학생에서 고르기' }),
          ...students.map((alias) => h('option', { value: alias, text: alias })),
        );
        known.addEventListener('change', () => {
          if (known.value === '') return;
          aliasInput.value = known.value;
          aliasError.replaceChildren();
          known.value = ''; // 목록은 고르는 도구일 뿐이다. 고른 뒤 별칭을 고쳐도 목록이 거짓 값을 가리키지 않게 되돌린다.
        }, { signal });
        aliasChildren.push(known);
      }
      const aliasGuide = notice('alias-guide', '실명 대신 별칭을 써 주세요', [
        '별칭 예: 학생1, 별이. 학교 공용 기기는 여러 학생이 돌아가며 쓰므로, 실명을 남기지 않는 쪽이 안전합니다.',
      ], { symbol: 'ℹ' });
      aliasGuide.id = 'alias-guide';
      children.push(h('section', { class: 'setup-section' }, ...aliasChildren, aliasGuide));

      // 테마
      const themeGroup = fieldset(
        '테마',
        h('div', { class: 'choice-grid' }, ...THEMES.map((theme) => choice(
          'radio', 'theme', theme.id, theme.id === state.themeId,
          h('span', { 'aria-hidden': 'true', class: 'choice-glyph', text: theme.goGlyph }), ` ${theme.label}`,
        ))),
      );
      themeGroup.addEventListener('change', (event) => { state.themeId = event.target.value; }, { signal });
      children.push(themeGroup);

      // 길이, 난이도, 경고
      const warningBox = h('div', { 'aria-live': 'polite' });
      const renderWarning = () => {
        warningBox.replaceChildren();
        const worst = noGoShortage(state.level, state.length);
        if (!worst) return;
        warningBox.append(notice('no-go-shortage', '참아야 할 문항이 부족합니다', [
          shortageLead(state.level, worst),
          '짧은 검사는 억제를 재려는 것이 아니라, 학생이 과제에 적응하고 참여하는지 확인하기 위한 것입니다. 억제 지표까지 보려면 검사 길이를 늘리세요.',
        ]));
      };

      const lengthGroup = fieldset(
        '검사 길이',
        h('div', { class: 'choice-grid choice-grid-3' }, ...LENGTH_OPTIONS.map((o) => choice('radio', 'length', o.id, o.id === state.length, o.label))),
      );
      lengthGroup.addEventListener('change', (event) => { state.length = event.target.value; renderWarning(); }, { signal });

      // 난이도 칸은 2열이다(연습으로 결정, 1단계 / 2단계, 3단계). "1단계"는 3열에 넣으면 칸이 좁아 음절 중간에서 쪼개진다.
      const levelGroup = fieldset(
        '난이도',
        h('p', {
          class: 'text-muted',
          dataset: { hint: 'level' },
          text: `기본은 연습으로 결정입니다. 연습 ${PRACTICE.go + PRACTICE.noGo}문항의 결과로 단계를 추천합니다. 직접 정하려면 단계를 고르세요. ${LEVEL_IDS[0]}단계가 가장 쉽고 ${LEVEL_IDS.at(-1)}단계가 가장 어렵습니다.`,
        }),
        h('div', { class: 'choice-grid' },
          choice('radio', 'level', '', state.level === null, '연습으로 결정 (권장)'),
          ...LEVEL_IDS.map((level) => choice('radio', 'level', String(level), state.level === level, levelLabel(level)))),
      );
      levelGroup.addEventListener('change', (event) => {
        state.level = event.target.value === '' ? null : Number(event.target.value);
        renderWarning();
      }, { signal });
      renderWarning();
      children.push(lengthGroup, levelGroup, warningBox);

      // 소리·애니메이션 — 켜고 끄는 즉시 반영하고 저장한다.
      const soundBox = choice('checkbox', 'sound', 'on', prefs.sound, '소리 켜기');
      const motionBox = choice('checkbox', 'reducedMotion', 'on', prefs.reducedMotion, '애니메이션 줄이기');
      soundBox.querySelector('input').addEventListener('change', (event) => {
        prefs.sound = event.target.checked;
        deps.audio.setEnabled(prefs.sound);
        writePrefs(prefs);
      }, { signal });
      motionBox.querySelector('input').addEventListener('change', (event) => {
        prefs.reducedMotion = event.target.checked;
        applyReducedMotion(prefs.reducedMotion);
        writePrefs(prefs);
      }, { signal });
      children.push(fieldset(
        '소리와 화면',
        soundBox,
        h('p', { class: 'text-muted', text: '규칙을 보여 주는 연습 시범과, 맞게 했을 때 짧은 소리가 납니다. 검사 중 그림이 나오는 순간에는 소리가 나지 않습니다.' }),
        motionBox,
        h('p', { class: 'text-muted', text: '화면의 움직임을 거의 없앱니다. 기기에서 이미 움직임 줄이기를 켜 두었다면 이 선택과 관계없이 줄어듭니다.' }),
      ));

      // 같은 기기 안내 — 시작 버튼 위에 둔다. 교사가 시작을 누르고 자리를 비우기 전에 읽는 마지막 글이다.
      children.push(notice('same-device', '같은 기기로 검사해 주세요', [
        '결과는 검사한 기기의 브라우저에만 저장됩니다. 회차별 추이는 같은 기기에서 반복 검사했을 때만 쌓입니다.',
        '교사 한 분의 폰으로 여러 학생을 검사하면 문제없습니다. 학생 개인 폰으로 검사하면 기기마다 기록이 따로 남아 추이가 흩어집니다.',
      ], { symbol: 'ℹ' }));

      // 시작, 기록·이력 보기. 이 버튼의 이름은 결과 화면의 저장 실패 안내("이력 화면에서 기록을 내보내…")와 이력 화면의 제목("이력")이
      // 가리키는 곳과 맞아야 한다 — 데이터가 위험한 순간에 교사가 이름으로 이 버튼을 찾는다. 셋 중 하나를 바꾸면 나머지도 바꾼다(tests가 맞춰 본다).
      const start = h('button', { type: 'button', class: 'btn btn-block', dataset: { action: 'start' }, text: '시작' });
      press(start, () => {
        const alias = aliasInput.value.trim();
        if (alias === '') {
          aliasError.replaceChildren(h('p', { class: 'field-error', dataset: { error: 'alias' }, text: '⚠ 별칭을 입력해 주세요.' }));
          aliasInput.focus();
          return;
        }
        const setup = { alias, themeId: state.themeId, length: state.length, levelOverride: state.level };
        // 다음에 "바로 시작"이 쓸 값. 저장이 실패해도 검사는 진행된다(saveLastSetup은 던지지 않는다).
        saveLastSetup({ alias, themeId: state.themeId, level: state.level, length: state.length });
        begin(setup);
      });
      const history = h('button', { type: 'button', class: 'btn btn-secondary btn-block', dataset: { action: 'history' }, text: '기록·이력 보기' });
      press(history, () => { onHistory?.(); });
      children.push(h('div', { class: 'setup-actions' }, start, history));

      rootEl.append(h('main', { class: 'teacher-screen setup-screen', dataset: { screen: 'setup' } }, ...children));
    },

    // 리스너는 모두 한 AbortController에 묶여 있다. 이 화면은 타이머를 걸지 않는다.
    unmount() {
      controller?.abort();
      controller = null;
    },
  };
}
