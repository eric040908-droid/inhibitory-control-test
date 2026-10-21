// 화면 전환기 — 한 번에 화면 하나만 rootEl에 올려 둔다.
//
// 화면 계약: { mount(rootEl, params): void, unmount?(): void }
//   - mount가 받는 rootEl은 항상 비어 있다. 이전 화면이 남긴 DOM은 라우터가 치운다.
//   - unmount는 이전 화면의 DOM이 치워지기 *전에* 불린다. 타이머·리스너·엔진 정리는 여기서 한다.
//
// go(name, params)의 순서: 화면표 확인 → 이전 화면 unmount → rootEl 비우기 → 새 화면 mount.
//   - 없는 화면이면 아무것도 건드리지 않고 던진다 (현재 화면 유지).
//   - 같은 화면으로 다시 가면 unmount 뒤 새 params로 다시 mount한다.
//   - unmount나 mount가 던지면 에러를 그대로 올리고, 라우터는 "마운트된 화면 없음"(current() === null)이
//     되며 rootEl은 비워 둔다. 실패한 mount의 unmount는 부르지 않는다 — 어디까지 그려졌는지 모르는
//     화면의 unmount에 정리를 맡기면 거기서 또 던질 수 있다.
//   - mount 안에서 go()로 다른 화면으로 보내는 것(리다이렉트)은 허용한다. 그 뒤 바깥 mount가
//     던져도 리다이렉트된 화면은 건드리지 않는다.
export function createRouter(rootEl, screens) {
  const table = new Map(Object.entries(screens));
  let currentName = null;
  let active = null; // 지금 마운트된(또는 마운트 중인) 화면 객체

  function clear() {
    rootEl.replaceChildren();
    currentName = null;
    active = null;
  }

  function go(name, params = {}) {
    if (!table.has(name)) throw new Error(`알 수 없는 화면: ${name}`);
    const next = table.get(name);

    const previous = active;
    if (previous) {
      try {
        previous.unmount?.();
      } catch (err) {
        clear();
        throw err;
      }
    }
    rootEl.replaceChildren();

    currentName = name;
    active = next;
    try {
      next.mount(rootEl, params);
    } catch (err) {
      if (active === next) clear(); // 리다이렉트로 이미 다른 화면이 올라와 있으면 그대로 둔다
      throw err;
    }
  }

  return { go, current: () => currentName };
}
