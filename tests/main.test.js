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
