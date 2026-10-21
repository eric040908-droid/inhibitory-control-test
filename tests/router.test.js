// @vitest-environment jsdom
import { createRouter } from '../js/router.js';

// ---- 브리프의 테스트 (그대로) ------------------------------------------------

test('go는 해당 화면을 마운트한다', () => {
  const root = document.createElement('div');
  const a = { mount: vi.fn() }, b = { mount: vi.fn() };
  createRouter(root, { a, b }).go('a', { x: 1 });
  expect(a.mount).toHaveBeenCalledWith(root, { x: 1 });
});

test('다음 화면으로 가기 전에 이전 화면을 정리한다', () => {
  const root = document.createElement('div');
  const a = { mount: vi.fn(), unmount: vi.fn() }, b = { mount: vi.fn() };
  const r = createRouter(root, { a, b });
  r.go('a'); r.go('b');
  expect(a.unmount).toHaveBeenCalledTimes(1);
  expect(r.current()).toBe('b');
});

test('없는 화면으로 가면 던지고 현재 화면을 유지한다', () => {
  const r = createRouter(document.createElement('div'), { a: { mount: vi.fn() } });
  r.go('a');
  expect(() => r.go('nope')).toThrow();
  expect(r.current()).toBe('a');
});

// ---- 경계 --------------------------------------------------------------------

describe('경계', () => {
  test('아직 어디도 가지 않았으면 current()는 null이다', () => {
    const r = createRouter(document.createElement('div'), { a: { mount: vi.fn() } });
    expect(r.current()).toBeNull();
  });

  test('params를 생략하면 빈 객체를 받는다', () => {
    const root = document.createElement('div');
    const a = { mount: vi.fn() };
    createRouter(root, { a }).go('a');
    expect(a.mount).toHaveBeenCalledWith(root, {});
  });

  test('같은 화면으로 두 번 가면 정리한 뒤 새 params로 다시 마운트한다', () => {
    const root = document.createElement('div');
    const calls = [];
    const a = {
      mount: vi.fn((el, params) => calls.push(['mount', params.n])),
      unmount: vi.fn(() => calls.push(['unmount'])),
    };
    const r = createRouter(root, { a });
    r.go('a', { n: 1 });
    r.go('a', { n: 2 });
    expect(calls).toEqual([['mount', 1], ['unmount'], ['mount', 2]]);
    expect(r.current()).toBe('a');
  });

  test('unmount가 없는 화면에서도 전환된다', () => {
    const root = document.createElement('div');
    const a = { mount: vi.fn() };
    const b = { mount: vi.fn() };
    const r = createRouter(root, { a, b });
    r.go('a');
    expect(() => r.go('b')).not.toThrow();
    expect(r.current()).toBe('b');
    expect(b.mount).toHaveBeenCalledTimes(1);
  });

  test('다음 화면은 이전 화면이 남긴 DOM이 치워진 빈 루트를 받는다', () => {
    const root = document.createElement('div');
    const a = { mount: (el) => { el.append(document.createElement('p')); } };
    let childCountSeenByB = -1;
    const b = { mount: (el) => { childCountSeenByB = el.childNodes.length; } };
    const r = createRouter(root, { a, b });
    r.go('a');
    expect(root.childNodes.length).toBe(1);
    r.go('b');
    expect(childCountSeenByB).toBe(0);
  });

  test('이전 화면의 unmount는 DOM이 치워지기 전에 불린다', () => {
    const root = document.createElement('div');
    let childCountAtUnmount = -1;
    const a = {
      mount: (el) => { el.append(document.createElement('p')); },
      unmount: () => { childCountAtUnmount = root.childNodes.length; },
    };
    const r = createRouter(root, { a, b: { mount: vi.fn() } });
    r.go('a'); r.go('b');
    expect(childCountAtUnmount).toBe(1);
  });

  test('없는 화면으로 가려다 던져도 현재 화면은 정리되지도 다시 마운트되지도 않는다', () => {
    const root = document.createElement('div');
    const a = { mount: vi.fn((el) => el.append(document.createElement('p'))), unmount: vi.fn() };
    const r = createRouter(root, { a });
    r.go('a');
    expect(() => r.go('nope')).toThrow(/nope/);
    expect(a.unmount).not.toHaveBeenCalled();
    expect(a.mount).toHaveBeenCalledTimes(1);
    expect(root.childNodes.length).toBe(1);
  });

  test('Object.prototype의 이름(toString 등)은 화면이 아니다', () => {
    const r = createRouter(document.createElement('div'), { a: { mount: vi.fn() } });
    r.go('a');
    expect(() => r.go('toString')).toThrow();
    expect(() => r.go('constructor')).toThrow();
    expect(r.current()).toBe('a');
  });

  test('mount가 던지면 에러를 그대로 올리고, 라우터는 아무 화면도 마운트하지 않은 상태가 된다', () => {
    const root = document.createElement('div');
    const boom = new Error('mount failed');
    const a = { mount: vi.fn((el) => el.append(document.createElement('p'))), unmount: vi.fn() };
    const bad = { mount: vi.fn((el) => { el.append(document.createElement('span')); throw boom; }) };
    const r = createRouter(root, { a, bad });
    r.go('a');
    expect(() => r.go('bad')).toThrow(boom);
    expect(a.unmount).toHaveBeenCalledTimes(1);   // 이전 화면은 이미 정리됐다
    expect(r.current()).toBeNull();                // 실패한 화면을 현재 화면이라 하지 않는다
    expect(root.childNodes.length).toBe(0);        // 반쯤 그려진 DOM도 남기지 않는다
  });

  test('mount가 실패한 뒤에도 다른 화면으로 갈 수 있다 (실패한 화면의 unmount는 부르지 않는다)', () => {
    const root = document.createElement('div');
    const bad = { mount: vi.fn(() => { throw new Error('x'); }), unmount: vi.fn() };
    const ok = { mount: vi.fn() };
    const r = createRouter(root, { bad, ok });
    expect(() => r.go('bad')).toThrow();
    r.go('ok');
    expect(r.current()).toBe('ok');
    expect(bad.unmount).not.toHaveBeenCalled();
    expect(ok.mount).toHaveBeenCalledTimes(1);
  });

  test('unmount가 던지면 에러를 올리고, 다음 화면은 마운트하지 않으며, 상태는 비어 있다', () => {
    const root = document.createElement('div');
    const boom = new Error('unmount failed');
    const a = { mount: vi.fn((el) => el.append(document.createElement('p'))), unmount: vi.fn(() => { throw boom; }) };
    const b = { mount: vi.fn() };
    const r = createRouter(root, { a, b });
    r.go('a');
    expect(() => r.go('b')).toThrow(boom);
    expect(b.mount).not.toHaveBeenCalled();
    expect(r.current()).toBeNull();
    expect(root.childNodes.length).toBe(0);
    r.go('b');                                     // 그 뒤에도 라우터는 쓸 수 있다
    expect(r.current()).toBe('b');
  });

  test('mount 안에서 go로 리다이렉트하면 마지막 화면이 현재 화면이다', () => {
    const root = document.createElement('div');
    let r;
    const a = { mount: vi.fn(() => r.go('b')) , unmount: vi.fn() };
    const b = { mount: vi.fn() };
    r = createRouter(root, { a, b });
    r.go('a');
    expect(r.current()).toBe('b');
    expect(b.mount).toHaveBeenCalledTimes(1);
  });

  test('mount 안에서 리다이렉트한 뒤 그 mount가 던져도 리다이렉트된 화면을 지우지 않는다', () => {
    const root = document.createElement('div');
    let r;
    const a = { mount: () => { r.go('b'); throw new Error('late'); } };
    const b = { mount: vi.fn((el) => el.append(document.createElement('p'))) };
    r = createRouter(root, { a, b });
    expect(() => r.go('a')).toThrow('late');
    expect(r.current()).toBe('b');
    expect(root.childNodes.length).toBe(1);
  });

  test('screens를 나중에 바꿔도 라우터는 만들 때의 화면표를 쓴다', () => {
    const screens = { a: { mount: vi.fn() } };
    const r = createRouter(document.createElement('div'), screens);
    screens.b = { mount: vi.fn() };
    expect(() => r.go('b')).toThrow();
  });
});
