// @vitest-environment jsdom
// 교사 설정 화면. 앞의 9개는 계획서의 테스트 그대로이고, 그 아래는 경계 확인을 테스트로 남긴 것이다.

vi.mock('../js/deviceInfo.js', () => ({
  collectDeviceInfo: vi.fn(),
  measureRefreshHz: vi.fn(() => Promise.resolve(60)),
}));

import { LEVELS, TRIAL_COUNTS, THRESHOLDS } from '../js/config.js';
import { THEMES } from '../js/themes.js';
import { measureRefreshHz } from '../js/deviceInfo.js';
import { setStorage, saveLastSetup, lastSetup, saveSession } from '../js/storage.js';
import { createSetupScreen, expectedNoGoCount, noGoShortage } from '../js/screens/setup.js';

// ---- 하네스 ----------------------------------------------------------------------------
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function throwingStorage() {
  const boom = () => { throw new Error('SecurityError'); };
  return { getItem: boom, setItem: boom, removeItem: boom };
}

const makeAudio = () => ({ unlock: vi.fn(), playCorrect: vi.fn(), playStimulus: vi.fn(), setEnabled: vi.fn() });

let screen = null;

function mountSetup({ onStart = vi.fn(), onHistory = vi.fn(), audio = makeAudio(), params } = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  screen = createSetupScreen({ audio, createEngine: vi.fn() });
  screen.mount(root, params ?? { onStart, onHistory });
  return { root, audio, onStart, onHistory };
}

function remountSetup(opts) {
  screen.unmount();
  document.body.replaceChildren();
  return mountSetup(opts);
}

const qs = (sel) => document.querySelector(sel);
const tap = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const change = (el) => el.dispatchEvent(new Event('change', { bubbles: true }));

function pick(name, value) {
  const radio = qs(`input[type="radio"][name="${name}"][value="${value}"]`);
  radio.checked = true;
  change(radio);
}
const selectLength = (id) => pick('length', id);
const selectLevelOverride = (level) => pick('level', level === null ? '' : String(level));
const selectTheme = (id) => pick('theme', id);

function setCheckbox(name, on) {
  const box = qs(`input[type="checkbox"][name="${name}"]`);
  box.checked = on;
  change(box);
}
const toggleSound = (on) => setCheckbox('sound', on);
const toggleReducedMotion = (on) => setCheckbox('reducedMotion', on);
const reducedMotionToggle = () => qs('input[type="checkbox"][name="reducedMotion"]');
const soundToggle = () => qs('input[type="checkbox"][name="sound"]');

const quickStartButton = () => qs('[data-action="quick-start"]');
const clickQuickStart = () => tap(quickStartButton());
const startButton = () => qs('[data-action="start"]');
const historyButton = () => qs('[data-action="history"]');
const shortageNotice = () => qs('[data-notice="no-go-shortage"]');

function typeAlias(text) {
  const input = qs('input[name="alias"]');
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function stubStorageThatThrows() {
  setStorage(throwingStorage());
}

beforeEach(() => {
  setStorage(memoryStorage());
  localStorage.clear();
  document.documentElement.removeAttribute('data-reduced-motion');
  measureRefreshHz.mockClear();
});

afterEach(() => {
  screen?.unmount();
  screen = null;
  document.body.replaceChildren();
  document.documentElement.removeAttribute('data-reduced-motion');
  vi.restoreAllMocks();
  vi.useRealTimers();
  setStorage(null);
});

// ---- 계획서의 테스트 (그대로) --------------------------------------------------------------
test('별칭 사용 안내를 보여준다', () => {
  mountSetup();
  expect(document.body.textContent).toMatch(/별칭/);
});

test('참아야 할 문항이 8개 미만인 조합을 고르면 경고를 띄운다', () => {
  mountSetup();
  selectLength('short'); selectLevelOverride(1);
  expect(document.body.textContent).toMatch(/참고용|부족/);
});

test('참아야 할 문항이 충분한 조합에는 경고가 없다', () => {
  mountSetup();
  selectLength('medium'); selectLevelOverride(2);
  expect(document.body.textContent).not.toMatch(/참고용|부족/);
});

test('같은 기기로 반복 검사해야 추이가 쌓인다는 안내가 있다', () => {
  mountSetup();
  expect(document.body.textContent).toMatch(/같은 기기/);
});

test('지난 설정이 있으면 바로 시작 버튼이 그 값으로 onStart를 부른다', () => {
  saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
  const onStart = vi.fn(); mountSetup({ onStart });
  clickQuickStart();
  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ alias: '학생1', themeId: 'animal', length: 'medium' }));
});

test('지난 설정이 없으면 바로 시작 버튼이 없다', () => {
  mountSetup();
  expect(quickStartButton()).toBeNull();
});

test('소리 켜기·끄기를 교사가 고를 수 있고 선택이 오디오에 전달된다', () => {
  const audio = mountSetup().audio;
  toggleSound(false);
  expect(audio.setEnabled).toHaveBeenCalledWith(false);
});

test('애니메이션 줄이기 수동 토글이 있고 선택이 유지된다', () => {
  mountSetup(); toggleReducedMotion(true); remountSetup();
  expect(reducedMotionToggle().checked).toBe(true);
  expect(document.documentElement.dataset.reducedMotion).toBe('true');
});

test('저장을 쓸 수 없는 기기면 그 사실을 알린다', () => {
  // Review Focus 1
  stubStorageThatThrows(); mountSetup();
  expect(document.body.textContent).toMatch(/저장/);
});

// ---- 저장 불가 안내: 위 테스트는 "저장"이라는 글자가 다른 안내에도 있어 그것만으로는 통과해 버린다 -----------
describe('저장 불가 안내', () => {
  test('저장소가 막혀 있으면 전용 안내가 뜨고, 검사는 진행되며 결과 화면은 보인다고 알린다', () => {
    stubStorageThatThrows(); mountSetup();
    const notice = qs('[data-notice="storage-unavailable"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toMatch(/저장할 수 없/);
    expect(notice.textContent).toMatch(/검사는 .*진행/);
    expect(notice.textContent).toMatch(/결과 화면/);
  });

  test('저장소를 쓸 수 있으면 그 안내는 없다', () => {
    mountSetup();
    expect(qs('[data-notice="storage-unavailable"]')).toBeNull();
  });

  test('저장소가 막혀 있어도 화면은 정상으로 그려지고 시작할 수 있다', () => {
    stubStorageThatThrows();
    const { onStart } = mountSetup();
    typeAlias('학생1');
    tap(startButton());
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});

// ---- 같은 기기 안내 -------------------------------------------------------------------------
describe('같은 기기 안내', () => {
  test('결과가 검사한 기기에만 저장된다는 것과, 학생 개인 폰이면 추이가 흩어진다는 것을 알린다', () => {
    mountSetup();
    const notice = qs('[data-notice="same-device"]');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toMatch(/검사한 기기/);
    expect(notice.textContent).toMatch(/같은 기기/);
    expect(notice.textContent).toMatch(/개인 폰/);
    expect(notice.textContent).toMatch(/흩어/);
  });

  test('저장소를 쓸 수 없을 때도 같은 기기 안내는 그대로 있다', () => {
    stubStorageThatThrows(); mountSetup();
    expect(qs('[data-notice="same-device"]')).not.toBeNull();
  });
});

// ---- 별칭 -----------------------------------------------------------------------------------
describe('별칭', () => {
  test('실명 대신 별칭을 쓰라는 안내와 그 이유(공용 기기)를 함께 보인다', () => {
    mountSetup();
    const guide = qs('[data-notice="alias-guide"]');
    expect(guide.textContent).toMatch(/실명/);
    expect(guide.textContent).toMatch(/공용/);
  });

  test('저장된 학생이 없으면(listStudents가 빈 배열) 고르기 목록을 그리지 않는다', () => {
    mountSetup();
    expect(qs('select[name="knownStudents"]')).toBeNull();
    expect(qs('input[name="alias"]')).not.toBeNull();
  });

  test('저장된 학생이 있으면 고르기 목록이 뜨고, 고르면 별칭 칸이 채워진다', () => {
    const base = { level: 2, complete: true, startedAt: 1 };
    saveSession({ ...base, id: 'a', studentAlias: '하늘' });
    saveSession({ ...base, id: 'b', studentAlias: '가람' });
    mountSetup();
    const select = qs('select[name="knownStudents"]');
    const options = [...select.options].map(o => o.value).filter(Boolean);
    expect(options).toEqual(['가람', '하늘']);
    select.value = '하늘';
    change(select);
    expect(qs('input[name="alias"]').value).toBe('하늘');
    expect(select.value).toBe('');
  });

  test('별칭이 비어 있으면 시작하지 않고 이유를 알리며 입력 칸으로 돌아간다', () => {
    const { onStart } = mountSetup();
    tap(startButton());
    expect(onStart).not.toHaveBeenCalled();
    expect(qs('[data-error="alias"]').textContent).toMatch(/별칭/);
    expect(document.activeElement).toBe(qs('input[name="alias"]'));
  });

  test('공백뿐인 별칭도 비어 있는 것으로 본다', () => {
    const { onStart } = mountSetup();
    typeAlias('   ');
    tap(startButton());
    expect(onStart).not.toHaveBeenCalled();
  });

  test('입력 오류 표시는 별칭을 고치면 사라진다', () => {
    mountSetup();
    tap(startButton());
    expect(qs('[data-error="alias"]')).not.toBeNull();
    typeAlias('학생1');
    expect(qs('[data-error="alias"]')).toBeNull();
  });
});

// ---- 시작·결과 보기 ---------------------------------------------------------------------------
describe('시작과 결과 보기', () => {
  test('기본값은 보통 길이, 연습으로 난이도 결정, 첫 번째 테마다', () => {
    mountSetup();
    expect(qs('input[name="length"]:checked').value).toBe('medium');
    expect(qs('input[name="level"]:checked').value).toBe('');
    expect(qs('input[name="theme"]:checked').value).toBe(THEMES[0].id);
  });

  test('onStart에 { alias, themeId, length, levelOverride }만 넘긴다 (별칭은 앞뒤 공백을 뗀다)', () => {
    const { onStart } = mountSetup();
    typeAlias('  학생1 ');
    selectTheme('fruit'); selectLength('long'); selectLevelOverride(3);
    tap(startButton());
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({ alias: '학생1', themeId: 'fruit', length: 'long', levelOverride: 3 });
  });

  test('연습으로 결정이면 levelOverride가 null이다', () => {
    const { onStart } = mountSetup();
    typeAlias('학생1');
    tap(startButton());
    expect(onStart).toHaveBeenCalledWith({ alias: '학생1', themeId: THEMES[0].id, length: 'medium', levelOverride: null });
  });

  test('시작하면 그 설정을 지난 설정으로 저장한다 (다음에 바로 시작 버튼이 쓴다)', () => {
    mountSetup();
    typeAlias('학생1'); selectTheme('shape'); selectLength('short'); selectLevelOverride(2);
    tap(startButton());
    expect(lastSetup()).toEqual({ alias: '학생1', themeId: 'shape', level: 2, length: 'short' });
  });

  test('시작을 연달아 두 번 눌러도 onStart는 한 번이다 (더블탭)', () => {
    const { onStart } = mountSetup();
    typeAlias('학생1');
    tap(startButton()); tap(startButton());
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  test('onStart가 던지면 다시 시작할 수 있다', () => {
    // 리스너 안의 예외는 dispatchEvent 밖으로 나오지 않고 window의 error 이벤트로 보고된다.
    const reported = [];
    const onError = (event) => { event.preventDefault(); reported.push(event.error ?? event.message); };
    window.addEventListener('error', onError);
    try {
      const onStart = vi.fn().mockImplementationOnce(() => { throw new Error('x'); });
      mountSetup({ onStart });
      typeAlias('학생1');
      tap(startButton());
      expect(reported).toHaveLength(1);
      tap(startButton());
      expect(onStart).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener('error', onError);
    }
  });

  test('결과 보기는 onHistory를 부른다', () => {
    const { onHistory } = mountSetup();
    tap(historyButton());
    expect(onHistory).toHaveBeenCalledTimes(1);
  });

  test('콜백 없이 마운트해도 던지지 않고, 눌러도 아무 일이 없다', () => {
    const root = document.createElement('div');
    document.body.append(root);
    screen = createSetupScreen({ audio: makeAudio() });
    screen.mount(root);
    typeAlias('학생1');
    expect(() => { tap(startButton()); tap(historyButton()); }).not.toThrow();
  });
});

// ---- 입력은 click (교사 화면) -------------------------------------------------------------------
// 학생의 반응 입력만 pointerdown이다(반응시간을 재는 경로). 이 화면은 스크롤되므로, 버튼을 pointerdown으로 두면
// 스크롤하려고 손가락을 댄 것이 버튼을 눌러 버린다. click은 브라우저가 탭과 스크롤을 가려 준다.
describe('입력 방식', () => {
  test('시작·바로 시작·결과 보기는 click으로 동작한다', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
    const first = mountSetup();
    tap(quickStartButton());
    expect(first.onStart).toHaveBeenCalledTimes(1);
    tap(historyButton());
    expect(first.onHistory).toHaveBeenCalledTimes(1);
    const second = remountSetup();
    typeAlias('학생2');
    tap(startButton());
    expect(second.onStart).toHaveBeenCalledTimes(1);
  });

  test('pointerdown·pointerup만으로는 아무 버튼도 눌리지 않는다 (스크롤하려고 손가락을 댄 것)', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
    const { onStart, onHistory } = mountSetup();
    typeAlias('학생1');
    for (const button of [startButton(), quickStartButton(), historyButton()]) {
      for (const type of ['pointerdown', 'pointerup', 'mousedown', 'touchstart']) {
        button.dispatchEvent(new Event(type, { bubbles: true }));
      }
    }
    expect(onStart).not.toHaveBeenCalled();
    expect(onHistory).not.toHaveBeenCalled();
  });

  test('버튼은 진짜 <button>이다 (키보드 Enter/Space가 브라우저 기본 동작으로 click이 된다)', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
    mountSetup();
    for (const button of [startButton(), quickStartButton(), historyButton()]) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
    }
  });

  test('화면 코드에 pointerdown을 쓰지 않는다 (교사 화면 버튼의 회귀 방지)', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync('js/screens/setup.js', 'utf8'); // vitest는 프로젝트 루트에서 돈다
    // 주석에 단어가 나와도 상관없다: 리스너를 거는 코드만 본다.
    expect(src).not.toMatch(/addEventListener\(\s*['"](?:pointerdown|pointerup|mousedown|touchstart|keydown)['"]/);
    expect(src).toMatch(/addEventListener\('click'/);
  });
});

// ---- No-Go 경고: 9개 조합 전부 ----------------------------------------------------------------
describe('No-Go 문항 부족 경고', () => {
  const combos = [];
  for (const level of Object.keys(LEVELS).map(Number)) {
    for (const length of Object.keys(TRIAL_COUNTS[level])) {
      combos.push({ level, length, expectWarn: TRIAL_COUNTS[level][length] * LEVELS[level].noGoRatio < THRESHOLDS.minNoGoTrials });
    }
  }

  test('조합은 3단계 × 3길이 = 9개이다', () => {
    expect(combos).toHaveLength(9);
  });

  // config에서 계산한 기대값이 어긋나도(예: 기준 변경) 조용히 통과하지 않도록, 스펙이 말한 두 조합을 따로 못 박는다.
  test('경고가 뜨는 조합은 1단계·짧게와 2단계·짧게 둘뿐이다', () => {
    expect(combos.filter(c => c.expectWarn).map(c => `${c.level}-${c.length}`)).toEqual(['1-short', '2-short']);
  });

  test.each(combos)('$level단계·$length: 경고 $expectWarn', ({ level, length, expectWarn }) => {
    mountSetup();
    selectLength(length); selectLevelOverride(level);
    expect(shortageNotice() !== null).toBe(expectWarn);
    expect(/참고용|부족/.test(document.body.textContent)).toBe(expectWarn);
  });

  test('경고는 문항 수 약 N개와 기준 개수를 config에서 읽어 보여 준다', () => {
    mountSetup();
    selectLength('short'); selectLevelOverride(1);
    const text = shortageNotice().textContent;
    expect(text).toContain(`약 ${Math.round(expectedNoGoCount(1, 'short'))}개`);
    expect(text).toContain(`${THRESHOLDS.minNoGoTrials}개`);
  });

  test('짧은 검사는 억제를 재려는 것이 아니라 적응과 참여 확인용이라고 알린다', () => {
    mountSetup();
    selectLength('short'); selectLevelOverride(2);
    const text = shortageNotice().textContent;
    expect(text).toMatch(/적응/);
    expect(text).toMatch(/참여/);
  });

  test('길이를 바꾸면 경고가 바로 생기고 사라진다', () => {
    mountSetup();
    selectLevelOverride(1);
    expect(shortageNotice()).toBeNull();      // 기본 길이는 보통
    selectLength('short');
    expect(shortageNotice()).not.toBeNull();
    selectLength('medium');
    expect(shortageNotice()).toBeNull();
  });

  test('경고는 한 개만 뜬다 (바꿀 때마다 쌓이지 않는다)', () => {
    mountSetup();
    selectLevelOverride(1);
    selectLength('short'); selectLevelOverride(2); selectLevelOverride(1); selectLength('short');
    expect(document.querySelectorAll('[data-notice="no-go-shortage"]')).toHaveLength(1);
  });

  describe('경계: 기준과 정확히 같으면 경고가 없다', () => {
    const original = TRIAL_COUNTS[1].short;
    afterEach(() => { TRIAL_COUNTS[1].short = original; });

    test('정확히 기준 개수(8개)가 되는 조합에는 경고가 없다', () => {
      TRIAL_COUNTS[1].short = THRESHOLDS.minNoGoTrials / LEVELS[1].noGoRatio; // 40 × 0.2
      expect(expectedNoGoCount(1, 'short')).toBe(THRESHOLDS.minNoGoTrials);
      expect(noGoShortage(1, 'short')).toBeNull();
      mountSetup();
      selectLength('short'); selectLevelOverride(1);
      expect(shortageNotice()).toBeNull();
    });

    test('기준보다 하나 적으면(7개) 경고가 뜬다', () => {
      TRIAL_COUNTS[1].short = (THRESHOLDS.minNoGoTrials - 1) / LEVELS[1].noGoRatio; // 35 × 0.2
      expect(noGoShortage(1, 'short')).not.toBeNull();
    });

    test('올림해 8처럼 보이는 7.5개는 경고한다 (반올림으로 기준을 넘기지 않는다)', () => {
      TRIAL_COUNTS[1].short = 37.5;
      expect(expectedNoGoCount(1, 'short')).toBe(7.5);
      expect(noGoShortage(1, 'short')).not.toBeNull();
    });
  });

  describe('난이도를 연습으로 정하는 경우: 가장 보수적인 단계로 본다', () => {
    test('기본 상태(연습으로 결정)에서 짧게를 고르면 경고가 뜬다', () => {
      mountSetup();
      selectLength('short');
      expect(shortageNotice()).not.toBeNull();
    });

    test('연습으로 결정 + 보통·길게에는 경고가 없다', () => {
      mountSetup();
      selectLength('medium');
      expect(shortageNotice()).toBeNull();
      selectLength('long');
      expect(shortageNotice()).toBeNull();
    });

    test('경고는 어느 단계를 기준으로 본 것인지 밝힌다 (가장 적은 단계)', () => {
      const worst = noGoShortage(null, 'short');
      expect(worst.level).toBe(1);
      mountSetup();
      selectLength('short');
      const text = shortageNotice().textContent;
      expect(text).toMatch(/연습/);
      expect(text).toContain(`${worst.level}단계`);
    });

    test('noGoShortage(null, …)은 단계별 최솟값을 쓴다', () => {
      for (const length of ['short', 'medium', 'long']) {
        const counts = Object.keys(LEVELS).map(l => expectedNoGoCount(Number(l), length));
        const min = Math.min(...counts);
        const result = noGoShortage(null, length);
        if (min < THRESHOLDS.minNoGoTrials) expect(result.count).toBe(min);
        else expect(result).toBeNull();
      }
    });
  });
});

// ---- 지난 설정으로 바로 시작 ---------------------------------------------------------------------
describe('지난 설정으로 바로 시작', () => {
  test('탭 한 번(click 한 번)으로 onStart를 정확히 한 번 부르고, 값은 지난 설정 그대로다', () => {
    saveLastSetup({ alias: '학생1', themeId: 'food', level: 3, length: 'long' });
    const { onStart } = mountSetup();
    clickQuickStart();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({ alias: '학생1', themeId: 'food', length: 'long', levelOverride: 3 });
  });

  test('지난 설정의 난이도가 비어 있으면 levelOverride는 null이다 (연습으로 결정)', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: null, length: 'medium' });
    const { onStart } = mountSetup();
    clickQuickStart();
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ levelOverride: null }));
  });

  test('지난 설정에 없는 난이도(예: 7)는 연습으로 결정으로 본다', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: 7, length: 'medium' });
    const { onStart } = mountSetup();
    clickQuickStart();
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ levelOverride: null }));
  });

  test('버튼 옆에 무엇으로 시작하는지 요약을 보인다', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
    mountSetup();
    const summary = qs('[data-quick-summary]').textContent;
    expect(summary).toContain('학생1');
    expect(summary).toContain(THEMES.find(t => t.id === 'animal').label);
    expect(summary).toContain('보통');
    expect(summary).toContain('2단계');
  });

  test('연속으로 눌러도 한 번만 시작한다', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
    const { onStart } = mountSetup();
    clickQuickStart(); clickQuickStart();
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  test('지난 설정이 억제 문항 부족 조합이면 누르기 전에 그 사실이 보인다', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: 1, length: 'short' });
    mountSetup();
    expect(qs('[data-notice="quick-start-shortage"]').textContent).toMatch(/참고용/);
  });

  test('지난 설정이 충분한 조합이면 그 줄이 없다', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
    mountSetup();
    expect(qs('[data-notice="quick-start-shortage"]')).toBeNull();
  });

  test('지난 설정으로 설정 칸도 미리 채워진다', () => {
    saveLastSetup({ alias: '학생1', themeId: 'weather', level: 3, length: 'short' });
    mountSetup();
    expect(qs('input[name="alias"]').value).toBe('학생1');
    expect(qs('input[name="theme"]:checked').value).toBe('weather');
    expect(qs('input[name="length"]:checked').value).toBe('short');
    expect(qs('input[name="level"]:checked').value).toBe('3');
  });

  describe('지난 설정이 깨져 있을 때 화면이 죽지 않는다', () => {
    test('지금 없는 테마 id면 던지지 않고, 바로 시작 버튼은 없고, 설정 칸은 기본 테마로 둔다', () => {
      saveLastSetup({ alias: '학생1', themeId: 'dinosaur', level: 2, length: 'medium' });
      expect(() => mountSetup()).not.toThrow();
      expect(quickStartButton()).toBeNull();
      expect(qs('input[name="theme"]:checked').value).toBe(THEMES[0].id);
      expect(qs('input[name="alias"]').value).toBe('학생1'); // 멀쩡한 칸은 그대로 살린다
    });

    test.each([
      ['별칭이 없음', { themeId: 'animal', level: 2, length: 'medium' }],
      ['별칭이 문자열이 아님', { alias: 5, themeId: 'animal', level: 2, length: 'medium' }],
      ['별칭이 공백뿐', { alias: '  ', themeId: 'animal', level: 2, length: 'medium' }],
      ['길이가 모르는 값', { alias: '학생1', themeId: 'animal', level: 2, length: 'huge' }],
      ['테마가 없음', { alias: '학생1', level: 2, length: 'medium' }],
    ])('%s: 바로 시작 버튼을 그리지 않고 던지지 않는다', (_name, setup) => {
      saveLastSetup(setup);
      expect(() => mountSetup()).not.toThrow();
      expect(quickStartButton()).toBeNull();
      expect(qs('input[name="length"]:checked').value).toBeTruthy();
    });

    test('지난 설정이 객체가 아니어도 던지지 않는다', () => {
      saveLastSetup('엉망');
      expect(() => mountSetup()).not.toThrow();
      expect(quickStartButton()).toBeNull();
    });
  });
});

// ---- 두 토글: 지속성 -------------------------------------------------------------------------
describe('소리 토글', () => {
  test('기본은 켜짐이고, 마운트할 때 그 상태를 오디오에 맞춰 준다', () => {
    const { audio } = mountSetup();
    expect(soundToggle().checked).toBe(true);
    expect(audio.setEnabled).toHaveBeenLastCalledWith(true);
  });

  test('끄고 다시 마운트하면 꺼진 채로 복원되고 오디오에도 전달된다', () => {
    mountSetup(); toggleSound(false);
    const { audio } = remountSetup();
    expect(soundToggle().checked).toBe(false);
    expect(audio.setEnabled).toHaveBeenLastCalledWith(false);
  });

  test('다시 켜면 켜짐으로 유지된다', () => {
    mountSetup(); toggleSound(false); toggleSound(true);
    const { audio } = remountSetup();
    expect(soundToggle().checked).toBe(true);
    expect(audio.setEnabled).toHaveBeenLastCalledWith(true);
  });
});

describe('애니메이션 줄이기 토글', () => {
  test('기본은 꺼짐이고 html에 표시가 없다', () => {
    mountSetup();
    expect(reducedMotionToggle().checked).toBe(false);
    expect(document.documentElement.hasAttribute('data-reduced-motion')).toBe(false);
  });

  test('켜면 즉시 html[data-reduced-motion="true"]가 된다', () => {
    mountSetup(); toggleReducedMotion(true);
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');
  });

  test('끄면 표시를 지운다 ("false"를 남기지 않는다)', () => {
    mountSetup(); toggleReducedMotion(true); toggleReducedMotion(false);
    expect(document.documentElement.hasAttribute('data-reduced-motion')).toBe(false);
  });

  test('저장된 값이 켜짐이면 html 표시가 없던 상태에서도 마운트가 되살린다', () => {
    mountSetup(); toggleReducedMotion(true);
    screen.unmount();
    document.body.replaceChildren();
    document.documentElement.removeAttribute('data-reduced-motion');
    mountSetup();
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');
  });

  test('화면을 떠나(unmount) 도 표시는 남는다 (검사 화면까지 이어져야 한다)', () => {
    mountSetup(); toggleReducedMotion(true);
    screen.unmount();
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');
  });
});

describe('토글 저장 실패', () => {
  test('localStorage가 던져도 마운트와 토글이 던지지 않는다', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    let audio;
    expect(() => { audio = mountSetup().audio; }).not.toThrow();
    expect(() => { toggleSound(false); toggleReducedMotion(true); }).not.toThrow();
    // 저장은 안 돼도 이번 화면에서는 효과가 난다
    expect(audio.setEnabled).toHaveBeenCalledWith(false);
    expect(document.documentElement.getAttribute('data-reduced-motion')).toBe('true');
  });

  test('저장 장치가 아예 없는 환경(localStorage 접근이 던짐)도 견딘다', () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('denied'); });
    expect(() => { mountSetup(); toggleSound(false); toggleReducedMotion(true); }).not.toThrow();
    spy.mockRestore();
  });

  test('저장된 값이 깨져 있으면 기본값으로 연다', () => {
    localStorage.setItem('inhibitoryControlTest.prefs', '{깨진 json');
    expect(() => mountSetup()).not.toThrow();
    expect(soundToggle().checked).toBe(true);
    expect(reducedMotionToggle().checked).toBe(false);
  });

  test('저장된 값의 모양이 틀리면 그 항목만 기본값으로 둔다', () => {
    localStorage.setItem('inhibitoryControlTest.prefs', JSON.stringify({ sound: 'no', reducedMotion: true }));
    mountSetup();
    expect(soundToggle().checked).toBe(true);
    expect(reducedMotionToggle().checked).toBe(true);
  });
});

// ---- 화면 주사율 측정 ---------------------------------------------------------------------------
describe('화면 주사율 측정 (연구 자료용)', () => {
  test('마운트할 때 measureRefreshHz(window)를 한 번 부른다', () => {
    mountSetup();
    expect(measureRefreshHz).toHaveBeenCalledTimes(1);
    expect(measureRefreshHz).toHaveBeenCalledWith(window);
  });

  test('결과를 기다리지 않는다 (끝나지 않는 Promise여도 화면이 바로 뜬다)', () => {
    measureRefreshHz.mockReturnValueOnce(new Promise(() => {}));
    mountSetup();
    expect(startButton()).not.toBeNull();
  });

  test('측정이 거부되어도 화면은 멀쩡하고 처리되지 않은 거부가 생기지 않는다', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    measureRefreshHz.mockReturnValueOnce(Promise.reject(new Error('no raf')));
    mountSetup();
    await new Promise(r => setTimeout(r, 0));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(startButton()).not.toBeNull();
  });

  test('측정 함수가 동기로 던져도 화면은 뜬다', () => {
    measureRefreshHz.mockImplementationOnce(() => { throw new Error('sync'); });
    expect(() => mountSetup()).not.toThrow();
    expect(startButton()).not.toBeNull();
  });
});

// ---- unmount ------------------------------------------------------------------------------------
describe('unmount가 정리한다', () => {
  test('unmount 뒤에는 시작·바로 시작·결과 보기 입력에 반응하지 않는다', () => {
    saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
    const { onStart, onHistory } = mountSetup();
    typeAlias('학생1');
    const start = startButton(); const quick = quickStartButton(); const history = historyButton();
    screen.unmount();
    tap(start); tap(quick); tap(history);
    expect(onStart).not.toHaveBeenCalled();
    expect(onHistory).not.toHaveBeenCalled();
  });

  test('unmount 뒤에는 토글과 선택 변경이 오디오·html·저장에 아무 영향도 주지 않는다', () => {
    const { audio } = mountSetup();
    const sound = soundToggle(); const motion = reducedMotionToggle();
    screen.unmount();
    audio.setEnabled.mockClear();
    sound.checked = false; change(sound);
    motion.checked = true; change(motion);
    expect(audio.setEnabled).not.toHaveBeenCalled();
    expect(document.documentElement.hasAttribute('data-reduced-motion')).toBe(false);
    expect(localStorage.getItem('inhibitoryControlTest.prefs')).toBeNull();
  });

  test('이 화면은 타이머를 걸지 않는다 (마운트 직후와 입력 뒤에도 대기 중인 타이머가 0개)', () => {
    // jsdom의 localStorage·focus가 내부에서 타이머를 쓰므로, 저장은 메모리 대역으로 바꾸고 별칭을 채워 focus를 피한다.
    const memory = new Map();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation((k) => (memory.has(k) ? memory.get(k) : null));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { memory.set(k, String(v)); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation((k) => { memory.delete(k); });
    vi.useFakeTimers();
    mountSetup();
    typeAlias('학생1');
    selectLength('short'); selectLevelOverride(1); toggleSound(false); toggleReducedMotion(true);
    tap(startButton());
    expect(vi.getTimerCount()).toBe(0);
  });

  test('unmount를 두 번 불러도, 마운트하지 않고 불러도 던지지 않는다', () => {
    mountSetup();
    expect(() => { screen.unmount(); screen.unmount(); }).not.toThrow();
    expect(() => createSetupScreen({ audio: makeAudio() }).unmount()).not.toThrow();
  });

  test('다시 마운트하면 이전 마운트의 리스너가 겹쳐 쌓이지 않는다', () => {
    const first = mountSetup();
    typeAlias('학생1');
    const oldStart = startButton();
    const second = remountSetup();
    typeAlias('학생1');
    tap(oldStart);
    tap(startButton());
    expect(first.onStart).not.toHaveBeenCalled();
    expect(second.onStart).toHaveBeenCalledTimes(1);
  });
});

// ---- 선택지 ------------------------------------------------------------------------------------
describe('선택지', () => {
  test('테마는 THEMES의 6종 전부이고 이름과 그림을 함께 보인다', () => {
    mountSetup();
    const radios = [...document.querySelectorAll('input[name="theme"]')];
    expect(radios.map(r => r.value)).toEqual(THEMES.map(t => t.id));
    expect(THEMES).toHaveLength(6);
    for (const theme of THEMES) {
      const label = qs(`input[name="theme"][value="${theme.id}"]`).closest('label');
      expect(label.textContent).toContain(theme.label);
      expect(label.textContent).toContain(theme.goGlyph);
    }
  });

  test('길이는 짧게·보통·길게이고 값은 TRIAL_COUNTS의 키와 같다', () => {
    mountSetup();
    const radios = [...document.querySelectorAll('input[name="length"]')];
    expect(radios.map(r => r.value).sort()).toEqual(Object.keys(TRIAL_COUNTS[1]).sort());
    expect(radios.map(r => r.closest('label').textContent.trim())).toEqual(['짧게', '보통', '길게']);
  });

  test('난이도는 "연습으로 결정"과 LEVELS의 단계들이고, 연습으로 결정이 먼저 있다', () => {
    mountSetup();
    const radios = [...document.querySelectorAll('input[name="level"]')];
    expect(radios.map(r => r.value)).toEqual(['', ...Object.keys(LEVELS)]);
    expect(radios[0].closest('label').textContent).toMatch(/연습으로 결정/);
  });

  test('연습 문항 수는 config에서 읽어 안내한다', async () => {
    const { PRACTICE } = await import('../js/config.js');
    mountSetup();
    expect(qs('[data-hint="level"]').textContent).toContain(`${PRACTICE.go + PRACTICE.noGo}문항`);
  });

  test('모든 선택지는 글자 라벨을 가진다 (색으로만 구분하지 않는다)', () => {
    mountSetup();
    for (const input of document.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
      expect(input.closest('label').textContent.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---- 좁은 화면에서 라벨이 쪼개지지 않는 구조 ----------------------------------------------------
// jsdom은 실제 줄바꿈을 재지 못한다. 375px·360px에서 라벨이 한 줄인지는 브라우저로 실측했고(보고서에 값을 적었다),
// 여기서는 그 결과를 지키는 구조적 조건을 고정한다.
describe('좁은 화면(360~375px)에서 라벨이 음절 중간에서 쪼개지지 않는 구조', () => {
  const read = async (path) => (await import('node:fs')).readFileSync(path, 'utf8');
  const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

  test('난이도는 3열 격자가 아니다 ("1단계"가 3열 칸에서 "1단/계"로 쪼개졌다)', () => {
    mountSetup();
    const grid = qs('input[name="level"]').closest('.choice-grid');
    expect(grid.classList.contains('choice-grid-3')).toBe(false);
  });

  test('3열 격자에는 세 글자 이하 라벨만 둔다 (검사 길이: 짧게·보통·길게)', () => {
    mountSetup();
    const grids = [...document.querySelectorAll('.choice-grid-3')];
    expect(grids.length).toBeGreaterThan(0);
    for (const grid of grids) {
      for (const label of grid.querySelectorAll('label.choice')) {
        expect(label.textContent.trim().length).toBeLessThanOrEqual(3);
      }
    }
    expect(grids.some((g) => g.querySelector('input[name="length"]'))).toBe(true);
  });

  test('css: overflow-wrap: anywhere와 break-all을 쓰지 않는다 (한국어 라벨을 음절 중간에서 끊는다)', async () => {
    const css = stripComments(await read('css/app.css'));
    expect(css).not.toMatch(/overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/word-break:\s*break-all/);
    expect(css).not.toMatch(/line-break:\s*anywhere/);
  });

  test('css: 교사 화면은 word-break: keep-all이다', async () => {
    const css = stripComments(await read('css/app.css'));
    const rule = css.match(/\.teacher-screen\s*\{([^}]*)\}/)[1];
    expect(rule).toMatch(/word-break:\s*keep-all/);
  });

  test('css: 3열 칸은 좌우 패딩을 한 단계(--space-1)로 줄이고 라벨을 한 줄(nowrap)로 둔다', async () => {
    const css = stripComments(await read('css/app.css'));
    const choice = css.match(/\.choice-grid-3\s+\.choice\s*\{([^}]*)\}/)[1];
    expect(choice).toMatch(/padding-left:\s*var\(--space-1\)/);
    expect(choice).toMatch(/padding-right:\s*var\(--space-1\)/);
    expect(choice).toMatch(/gap:\s*calc\(var\(--space-1\)\s*\/\s*2\)/);
    const text = css.match(/\.choice-grid-3\s+\.choice-text\s*\{([^}]*)\}/)[1];
    expect(text).toMatch(/white-space:\s*nowrap/);
  });

  test('css: 3열 규칙은 기본 .choice 규칙보다 뒤에 있다 (패딩 덮어쓰기가 실제로 적용되도록)', async () => {
    const css = stripComments(await read('css/app.css'));
    expect(css.indexOf('.choice-grid-3 .choice {')).toBeGreaterThan(css.indexOf('.choice {'));
  });

  test('css: 3열은 정확히 세 칸이다', async () => {
    const css = stripComments(await read('css/app.css'));
    expect(css.match(/\.choice-grid-3\s*\{([^}]*)\}/)[1]).toMatch(/repeat\(3,/);
  });
});

// ---- 경고 문장이 스스로 모순되지 않는다 -------------------------------------------------------------
describe('경고 문장의 개수 표기', () => {
  const original = TRIAL_COUNTS[1].short;
  afterEach(() => { TRIAL_COUNTS[1].short = original; });

  test('7.5개처럼 반올림하면 기준(8개)이 되는 값은 "약 7개"로 쓴다 ("약 8개 … 8개에 부족" 금지)', () => {
    TRIAL_COUNTS[1].short = 37.5; // 7.5
    mountSetup();
    selectLength('short'); selectLevelOverride(1);
    const text = shortageNotice().textContent;
    expect(text).toContain(`약 ${THRESHOLDS.minNoGoTrials - 1}개`);
    expect(text).not.toContain(`약 ${THRESHOLDS.minNoGoTrials}개`);
  });

  test('실제 조합은 그대로 반올림한다 (3.6→4, 5.5→6)', () => {
    mountSetup();
    selectLength('short'); selectLevelOverride(1);
    expect(shortageNotice().textContent).toContain('약 4개');
    selectLevelOverride(2);
    expect(shortageNotice().textContent).toContain('약 6개');
  });
});

// ---- PIN 잠금 중 설정 화면 (스펙 §5.9 공용 PC 대응) -------------------------------------------------------
// 설정 화면은 앱의 첫 화면이라 잠기지 않는다. 검사받으러 온 학생이 맨 처음 보는 곳에서 다른 학생의 이름이 보이면
// 이력 화면의 PIN 잠금은 의미가 없다. 가리는 것은 CSS가 아니라 DOM에 올리지 않는 것이다
// (학생은 확대하고, 글자를 고르고, 화면 낭독기를 켤 수 있다).
describe('PIN 잠금 중에는 다른 학생의 별칭을 DOM에 올리지 않는다', () => {
  const PIN_KEY = 'inhibitoryControlTest.pin';
  const base = { level: 2, complete: true, startedAt: 1 };
  const NAMES = ['하늘', '가람', '지난학생'];

  function seed() {
    saveSession({ ...base, id: 'a', studentAlias: '하늘' });
    saveSession({ ...base, id: 'b', studentAlias: '가람' });
    saveSession({ ...base, id: 'c', studentAlias: '지난학생' });
    saveLastSetup({ alias: '지난학생', themeId: 'animal', level: 2, length: 'medium' });
  }
  const everythingTheStudentCouldSee = () => document.body.innerHTML + '\n' + document.body.textContent + '\n' + [...document.querySelectorAll('input')].map((i) => i.value).join('\n');

  afterEach(() => { localStorage.removeItem(PIN_KEY); });

  test('PIN이 켜져 있으면 학생 고르기 목록(select)이 DOM에 없고, 어떤 별칭도 화면에 나오지 않는다', () => {
    seed();
    localStorage.setItem(PIN_KEY, '1234');
    mountSetup();
    expect(qs('select')).toBeNull();
    expect(qs('select[name="knownStudents"]')).toBeNull();
    expect(qs('option')).toBeNull();
    const seen = everythingTheStudentCouldSee();
    for (const name of NAMES) expect(seen, name).not.toContain(name);
  });

  test('PIN이 켜져 있으면 바로 시작의 요약에 지난 학생의 이름이 없고, 별칭 입력란은 비어 있다', () => {
    seed();
    localStorage.setItem(PIN_KEY, '1234');
    mountSetup();
    const summary = qs('[data-quick-summary]').textContent;
    expect(summary).not.toContain('지난학생');
    expect(summary).toContain(THEMES.find((t) => t.id === 'animal').label);
    expect(summary).toContain('보통');
    expect(summary).toContain('2단계');
    expect(qs('input[name="alias"]').value).toBe('');
    expect(qs('input[name="alias"]').getAttribute('value')).toBeNull();
  });

  test('PIN이 켜져 있어도 바로 시작은 지난 설정 그대로 동작한다 (교사 개입 최소화)', () => {
    seed();
    localStorage.setItem(PIN_KEY, '1234');
    const { onStart } = mountSetup();
    clickQuickStart();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledWith({ alias: '지난학생', themeId: 'animal', length: 'medium', levelOverride: 2 });
  });

  test('PIN이 켜져 있어도 별칭을 직접 입력해 시작할 수 있고, 목록이 없는 이유를 교사에게 알린다', () => {
    seed();
    localStorage.setItem(PIN_KEY, '1234');
    const { onStart } = mountSetup();
    typeAlias('새학생');
    tap(startButton());
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ alias: '새학생' }));
    expect(qs('[data-locked-students]').textContent).toMatch(/PIN/);
  });

  test('PIN이 꺼져 있으면 지금까지와 같다: 목록, 요약의 이름, 미리 채운 별칭, 안내 없음', () => {
    seed();
    mountSetup();
    expect([...qs('select[name="knownStudents"]').options].map((o) => o.value).filter(Boolean)).toEqual(['가람', '지난학생', '하늘']);
    expect(qs('[data-quick-summary]').textContent).toContain('지난학생');
    expect(qs('input[name="alias"]').value).toBe('지난학생');
    expect(qs('[data-locked-students]')).toBeNull();
  });

  test('PIN을 켠 직후 다시 열면(재마운트) 바로 가려진다 — 부팅 때 한 번이 아니라 화면을 올릴 때마다 묻는다', () => {
    seed();
    mountSetup();
    expect(qs('select')).not.toBeNull();
    localStorage.setItem(PIN_KEY, '1234');
    remountSetup();
    expect(qs('select')).toBeNull();
  });
});
