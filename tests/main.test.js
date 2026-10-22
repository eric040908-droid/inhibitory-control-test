// @vitest-environment jsdom
// main.js를 실제로 부팅해 본다 (tests/shell.test.js는 파일 내용만 읽는다).
// 소리는 가짜로 바꿔 unlock 호출을 관찰한다 — 화면 테스트가 쓸 방식과 같다.

vi.mock('../js/audio.js', () => ({
  unlock: vi.fn(),
  playCorrect: vi.fn(),
  playStimulus: vi.fn(),
  setEnabled: vi.fn(),
}));

// main.js는 import 때 document에 리스너를 건다. 같은 jsdom 문서를 쓰는 다음 테스트로 새지 않게 걷는다.
// 결과 화면이 맨 위로 스크롤한다. jsdom은 scrollTo를 구현하지 않아 부르면 콘솔에 오류를 찍는다.
beforeEach(() => { window.scrollTo = vi.fn(); });

const attached = [];
const realAdd = document.addEventListener.bind(document);
afterEach(() => {
  for (const args of attached.splice(0)) document.removeEventListener(...args);
});

async function boot({ withRoot = true } = {}) {
  vi.resetModules();
  document.addEventListener = (...args) => { attached.push(args); realAdd(...args); };
  document.body.innerHTML = withRoot ? '<div id="app"></div>' : '';
  const audioModule = await import('../js/audio.js');
  audioModule.unlock.mockClear();
  const engineModule = await import('../js/engine.js');
  const main = await import('../js/main.js');
  return { main, audioModule, engineModule };
}

const pointerdown = target => target.dispatchEvent(new Event('pointerdown', { bubbles: true }));

test('#app에 설정 화면을 올린다', async () => {
  const { main } = await boot();
  expect(main.router.current()).toBe('setup');
  const app = document.getElementById('app');
  expect(app.querySelector('[data-screen="setup"]')).not.toBeNull();
  expect(app.querySelector('[data-action="start"]')).not.toBeNull();
  expect(app.querySelector('[data-placeholder]')).toBeNull();
});

test('설정 화면은 deps.audio로 소리 선택을 전달한다 (부팅 때 저장된 선택에 맞춘다)', async () => {
  const { audioModule } = await boot();
  expect(audioModule.setEnabled).toHaveBeenCalledWith(true);
});

test('설정 화면의 시작(click)을 누르면 지난 설정이 저장되고, 이어 갈 화면을 잇기 전에도 던지지 않는다', async () => {
  await boot();
  const input = document.querySelector('input[name="alias"]');
  input.value = '학생1';
  const errors = [];
  const onError = (e) => { e.preventDefault(); errors.push(e.error); };
  window.addEventListener('error', onError);
  document.querySelector('[data-action="start"]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  window.removeEventListener('error', onError);
  expect(errors).toEqual([]);
  expect(JSON.parse(localStorage.getItem('inhibitoryControlTest')).lastSetup).toMatchObject({ alias: '학생1' });
});

test('#app이 없으면 이유를 말하며 던진다', async () => {
  await expect(boot({ withRoot: false })).rejects.toThrow('#app');
});

test('부팅만으로는 소리를 풀지 않는다 (제스처 안에서만 풀린다)', async () => {
  const { audioModule } = await boot();
  expect(audioModule.unlock).not.toHaveBeenCalled();
});

test('pointerdown마다 audio.unlock을 부른다', async () => {
  const { audioModule } = await boot();
  pointerdown(document.getElementById('app'));
  pointerdown(document.getElementById('app'));
  expect(audioModule.unlock).toHaveBeenCalledTimes(2);
});

const pointerup = target => target.dispatchEvent(new Event('pointerup', { bubbles: true }));

test('pointerup만 와도 unlock을 부른다 (터치의 활성화 이벤트는 pointerup)', async () => {
  const { audioModule } = await boot();
  pointerup(document.getElementById('app'));
  expect(audioModule.unlock).toHaveBeenCalledTimes(1);
});

test('화면이 pointerup 전파를 막아도 unlock은 불린다 (capture)', async () => {
  const { audioModule } = await boot();
  const zone = document.createElement('div');
  zone.addEventListener('pointerup', e => e.stopPropagation());
  document.getElementById('app').append(zone);
  pointerup(zone);
  expect(audioModule.unlock).toHaveBeenCalledTimes(1);
});

test('화면이 pointerdown 전파를 막아도 unlock은 불린다 (capture)', async () => {
  const { audioModule } = await boot();
  const zone = document.createElement('div');
  zone.addEventListener('pointerdown', e => e.stopPropagation());
  document.getElementById('app').append(zone);
  pointerdown(zone);
  expect(audioModule.unlock).toHaveBeenCalledTimes(1);
});

test('click으로는 unlock하지 않는다 (입력은 pointerdown)', async () => {
  const { audioModule } = await boot();
  document.getElementById('app').dispatchEvent(new Event('click', { bubbles: true }));
  expect(audioModule.unlock).not.toHaveBeenCalled();
});

test('deps.audio는 audio 모듈의 네 함수이고 오반응용 함수는 없다', async () => {
  const { main, audioModule } = await boot();
  expect(Object.keys(main.deps.audio).sort()).toEqual(['playCorrect', 'playStimulus', 'setEnabled', 'unlock']);
  expect(main.deps.audio.playCorrect).toBe(audioModule.playCorrect);
});

test('deps.createEngine은 engine 모듈의 createEngine이다', async () => {
  const { main, engineModule } = await boot();
  expect(main.deps.createEngine).toBe(engineModule.createEngine);
});

// ---- 설정 → 연습/검사 → 회차 저장 (js/flow.js를 main이 실제로 잇는다) ------------------------------------
describe('설정 화면에서 이어지는 흐름', () => {
  const click = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const choose = (name, value) => {
    const radio = document.querySelector(`input[type="radio"][name="${name}"][value="${value}"]`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
  };
  function startFromSetup({ level, length = 'short' }) {
    const input = document.querySelector('input[name="alias"]');
    input.value = '흐름확인';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    choose('length', length);
    choose('level', level === null ? '' : String(level));
    click(document.querySelector('[data-action="start"]'));
  }
  const storedSessions = () => JSON.parse(localStorage.getItem('inhibitoryControlTest')).sessions;

  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

  test('연습으로 정하면 연습 화면(학생 화면)이 뜬다', async () => {
    const { main } = await boot();
    startFromSetup({ level: null });
    expect(main.router.current()).toBe('practice');
    expect(document.querySelector('[data-student-view]')).not.toBeNull();
    main.router.go('setup'); // 연습 화면의 타이머를 거둔다
  });

  test('난이도를 직접 정하면 연습 없이 본 검사 화면이 뜬다', async () => {
    const { main } = await boot();
    startFromSetup({ level: 2 });
    expect(main.router.current()).toBe('test');
    expect(document.querySelector('[data-abort]')).not.toBeNull();
    main.router.go('setup');
  });

  test('연습으로 정한 단계는 지난 설정에 저장되지 않는다', async () => {
    await boot();
    startFromSetup({ level: null });
    expect(JSON.parse(localStorage.getItem('inhibitoryControlTest')).lastSetup.level).toBeNull();
  });

  test('실제 엔진·실제 시계로 끝까지 돌리면 완료 회차가 저장되고 결과 화면이 뜬다', async () => {
    const { main } = await boot();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    startFromSetup({ level: 1 });
    expect(main.router.current()).toBe('test');
    vi.advanceTimersByTime(10 * 60 * 1000); // 아무것도 누르지 않고 끝까지 (전부 누락)
    expect(main.router.current()).toBe('result');
    expect(document.querySelector('[data-screen="result"]')).not.toBeNull();
    expect(document.querySelector('[data-notice="save-failed"]')).toBeNull();
    const sessions = storedSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ studentAlias: '흐름확인', level: 1, length: 'short', complete: true, practice: null });
    expect(sessions[0].responses).toHaveLength(sessions[0].trialCount);
    expect(sessions[0].responses.every(r => r.invalid === false)).toBe(true);
    // 결과 화면의 돌아가기(click)는 설정 화면으로 보낸다.
    click(document.querySelector('[data-action="back"]'));
    expect(main.router.current()).toBe('setup');
  });

  test('중단 버튼을 길게 누르면 미완료 회차가 저장되고 "중단" 결과 화면이 뜬다', async () => {
    const { main } = await boot();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    startFromSetup({ level: 1 });
    vi.advanceTimersByTime(2000);
    const btn = document.querySelector('[data-abort]');
    btn.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    vi.advanceTimersByTime(1000);
    expect(main.router.current()).toBe('result');
    expect(document.querySelector('[data-notice="aborted"]')).not.toBeNull();
    const sessions = storedSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].complete).toBe(false);
  });

  test('저장이 실패해도 결과 화면이 뜨고, 교사에게 저장되지 않았다고 알린다', async () => {
    const { main } = await boot();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance', 'Date'] });
    // 회차를 쓰는 저장만 막는다(지난 설정 저장은 회차가 비어 있어 통과한다).
    const realSetItem = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (String(value).includes('"complete"')) throw new DOMException('full', 'QuotaExceededError');
      return realSetItem.call(this, key, value);
    });
    try {
      startFromSetup({ level: 1 });
      vi.advanceTimersByTime(10 * 60 * 1000);
      expect(main.router.current()).toBe('result');
      const notice = document.querySelector('[data-notice="save-failed"]');
      expect(notice).not.toBeNull();
      expect(notice.textContent).toContain('QuotaExceededError');
      expect(storedSessions()).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('설정 화면 → 이력 화면 → 결과 화면', () => {
  const click = el => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const seed = () => localStorage.setItem('inhibitoryControlTest', JSON.stringify({
    schemaVersion: 1,
    lastSetup: null,
    sessions: [{
      id: 'a', studentAlias: '가람', startedAt: 1_700_000_000_000, endedAt: 1_700_000_300_000, complete: true, level: 1,
      themeId: 'animal', length: 'short', trialCount: 2, practice: null, device: null, toolVersion: '0.1.0',
      responses: [{ index: 0, type: 'go', rtMs: 500, extraTaps: 0, invalid: false }, { index: 1, type: 'go', rtMs: 520, extraTaps: 0, invalid: false }],
    }],
  }));

  beforeEach(() => { localStorage.clear(); seed(); });
  afterEach(() => { localStorage.clear(); });

  test('결과 보기(click)를 누르면 이력 화면이 뜨고, 돌아가기는 설정 화면으로 보낸다', async () => {
    const { main } = await boot();
    click(document.querySelector('[data-action="history"]'));
    expect(main.router.current()).toBe('history');
    expect(document.querySelector('[data-screen="history"]')).not.toBeNull();
    click(document.querySelector('[data-action="back"]'));
    expect(main.router.current()).toBe('setup');
  });

  test('회차를 열면 결과 화면이 뜨고, 돌아가면 그 학생의 묶음이 펼쳐진 이력 화면으로 온다', async () => {
    const { main } = await boot();
    click(document.querySelector('[data-action="history"]'));
    click(document.querySelector('[data-session-row="a"]'));
    expect(main.router.current()).toBe('result');
    expect(document.querySelector('[data-screen="result"]')).not.toBeNull();
    click(document.querySelector('[data-action="back"]'));
    expect(main.router.current()).toBe('history');
    expect(document.querySelector('[data-student="가람"]').open).toBe(true);
  });

  test('PIN을 켜 두면 결과를 보고 돌아와도 다시 묻지 않지만, 이력 화면을 나갔다 오면 다시 묻는다', async () => {
    localStorage.setItem('inhibitoryControlTest.pin', '1234');
    const { main } = await boot();
    click(document.querySelector('[data-action="history"]'));
    expect(document.querySelector('[data-pin-gate]')).not.toBeNull();
    const input = document.querySelector('[data-pin-input]');
    input.value = '1234';
    click(document.querySelector('[data-action="unlock"]'));
    click(document.querySelector('[data-session-row="a"]'));
    click(document.querySelector('[data-action="back"]'));
    expect(main.router.current()).toBe('history');
    expect(document.querySelector('[data-pin-gate]')).toBeNull();
    click(document.querySelector('[data-action="back"]')); // 이력을 나가 설정으로
    expect(main.router.current()).toBe('setup');
    click(document.querySelector('[data-action="history"]'));
    expect(document.querySelector('[data-pin-gate]')).not.toBeNull();
  });
});

// ---- 서비스 워커 등록 (Task 15) -----------------------------------------------------------------
// 등록은 오프라인에서 열기 위한 덤이다. file://로 열었거나, HTTPS가 아니거나, 브라우저가 막았으면 실패하는데,
// 그때도 검사는 되어야 한다. jsdom에는 navigator.serviceWorker가 없으므로 필요한 테스트가 심는다.

describe('서비스 워커 등록', () => {
  const setServiceWorker = (value) => Object.defineProperty(navigator, 'serviceWorker', { value, configurable: true });
  afterEach(() => { delete navigator.serviceWorker; });

  test('부팅하면 sw.js를 등록한다 (페이지 기준 상대 주소)', async () => {
    const register = vi.fn(() => Promise.resolve({}));
    setServiceWorker({ register });
    await boot();
    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith('sw.js');
  });

  test('첫 화면이 올라간 뒤에 등록한다 (등록이 부팅을 앞지르지 않는다)', async () => {
    let screenAtRegister = 'not called';
    const register = vi.fn(() => {
      screenAtRegister = document.querySelector('[data-screen="setup"]') ? 'setup' : 'none';
      return Promise.resolve({});
    });
    setServiceWorker({ register });
    await boot();
    expect(screenAtRegister).toBe('setup');
  });

  test('서비스 워커를 지원하지 않는 환경(file://, 비-HTTPS)에서도 부팅한다', async () => {
    expect('serviceWorker' in navigator).toBe(false);
    const { main } = await boot();
    expect(main.router.current()).toBe('setup');
  });

  test('등록이 거절돼도 부팅하고, 처리되지 않은 거절을 남기지 않는다', async () => {
    const rejections = [];
    const onRejection = (reason) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      const register = vi.fn(() => Promise.reject(new DOMException('The operation is insecure.', 'SecurityError')));
      setServiceWorker({ register });
      const { main } = await boot();
      expect(register).toHaveBeenCalled();
      expect(main.router.current()).toBe('setup');
      await new Promise(resolve => setTimeout(resolve, 20)); // 거절이 처리되지 않았다면 unhandledRejection이 뜰 시간을 준다
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  test('register()가 동기로 던져도 부팅한다', async () => {
    setServiceWorker({ register: () => { throw new TypeError('Failed to register a ServiceWorker'); } });
    const { main } = await boot();
    expect(main.router.current()).toBe('setup');
    expect(document.querySelector('[data-screen="setup"]')).not.toBeNull();
  });

  test('register가 약속이 아닌 값을 돌려줘도 부팅한다', async () => {
    setServiceWorker({ register: () => undefined });
    const { main } = await boot();
    expect(main.router.current()).toBe('setup');
  });

  test('navigator.serviceWorker가 undefined로 정의돼 있어도(일부 비보안 환경) 부팅한다', async () => {
    setServiceWorker(undefined);
    const { main } = await boot();
    expect(main.router.current()).toBe('setup');
  });
});
