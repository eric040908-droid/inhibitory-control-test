// PIN 잠금 화면 — 이력 화면(history.js)과 검사 직후의 결과 화면(main.js의 goResult)이 같은 잠금을 쓴다.
//
// 두 곳에 따로 만들면 문구·입력란·"PIN을 잊었다면" 안내가 어긋난다. 그래서 그리는 쪽(gateView)과 제출을 맞춰 보는 쪽
// (verifySubmit)을 여기 한 곳에 두고, 호출한 쪽이 자기 상태(틀렸는지, 맞췄는지)를 들고 있게 한다.
//
// !! 이것은 보안 장치가 아니다(js/pin.js의 머리글). 학생이 자기 결과나 다른 학생의 이름을 우연히 보지 않게 하는 문턱이다.
//    잠금 화면은 교사 화면이다 — 글이 있고, 버튼은 click(폼 제출)이다.
import * as pin from '../pin.js';

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

const button = (label, { action, secondary = true, type = 'button' } = {}) => h('button', {
  type,
  class: `btn btn-block${secondary ? ' btn-secondary' : ''}`,
  dataset: { action },
  text: label,
});

// heading/prompt: 어느 화면을 잠갔는지(이력 / 검사 결과). pinError: 방금 틀린 PIN을 넣었는가.
export function gateView({ heading, prompt, pinError = false }) {
  const input = h('input', {
    type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', name: 'pin', id: 'pin-gate-input', class: 'pin-input',
    'aria-label': 'PIN 숫자 4자리', dataset: { pinInput: '' },
  });
  return h(
    'div',
    { dataset: { pinGate: '' } },
    h('h1', { text: heading }),
    h('p', { text: prompt }),
    h(
      'form',
      { dataset: { pinForm: '' }, novalidate: true },
      input,
      pinError ? h('p', { class: 'field-error', role: 'alert', dataset: { pinError: '' } }, h('span', { 'aria-hidden': 'true', text: '⚠ ' }), 'PIN이 맞지 않습니다. 다시 입력해 주세요.') : null,
      button('열기', { action: 'unlock', secondary: false, type: 'submit' }),
    ),
    h(
      'div',
      { class: 'text-muted', dataset: { pinForgot: '' } },
      h('p', { class: 'notice-title', text: 'PIN을 잊었다면' }),
      h('p', { text: '이 앱에서는 기록을 열 수 없습니다. 남은 방법은 브라우저 설정에서 이 사이트의 데이터를 지우는 것입니다.' }),
      h('p', { text: '미리 받아 둔 백업(JSON) 파일이 있다면 데이터를 지운 뒤 이력 화면의 "백업 파일 가져오기"로 복원할 수 있습니다.' }),
      h('p', { text: '백업이 없다면 사이트 데이터를 지우지 마세요. 지우는 순간 저장된 기록이 모두 사라집니다.' }),
    ),
    button('돌아가기', { action: 'back' }),
  );
}

// 폼 제출 이벤트가 잠금 폼의 것이면 입력값이 맞는지 true/false, 잠금 폼이 아니면 null.
export function verifySubmit(form) {
  if (!form?.matches?.('[data-pin-form]')) return null;
  return pin.verify(form.querySelector('[data-pin-input]')?.value ?? '');
}

// 검사 직후의 결과 화면 앞에 서는 잠금 화면(스펙 §5.9: PIN이 켜져 있으면 결과로 자동 전환하지 않고 잠금 화면을 거친다).
//   mount(rootEl, { onUnlock, onBack }): 맞으면 onUnlock(), 돌아가기는 onBack().
// 이 화면에는 회차 정보가 없다 — 잠금이 풀리기 전에는 결과가 DOM에 올라오지 않는다.
export function createPinGateScreen() {
  let controller = null;

  function unmount() {
    controller?.abort();
    controller = null;
  }

  function mount(rootEl, params = {}) {
    unmount();
    controller = new AbortController();
    const { signal } = controller;
    const { onUnlock, onBack } = params ?? {};

    const container = h('main', { class: 'teacher-screen history-screen', dataset: { screen: 'result-lock' } });
    rootEl.append(container);

    let pinError = false;
    const render = () => container.replaceChildren(gateView({
      heading: '검사 결과',
      prompt: '검사를 마쳤습니다. 결과를 보려면 PIN 숫자 4자리를 입력하세요.',
      pinError,
    }));

    container.addEventListener('submit', (event) => {
      event.preventDefault();
      const ok = verifySubmit(event.target);
      if (ok === null) return;
      if (ok) {
        onUnlock?.();
        return;
      }
      pinError = true;
      render();
      container.querySelector('[data-pin-input]')?.focus();
    }, { signal });

    container.addEventListener('click', (event) => {
      const el = event.target && typeof event.target.closest === 'function' ? event.target.closest('button') : null;
      if (el && container.contains(el) && el.dataset.action === 'back') onBack?.();
    }, { signal });

    render();
  }

  return { mount, unmount };
}
