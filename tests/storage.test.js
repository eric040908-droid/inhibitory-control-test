import { TOOL_VERSION } from '../js/config.js';
import { collectDeviceInfo, measureRefreshHz } from '../js/deviceInfo.js';
import {
  STORAGE_KEY, SCHEMA_VERSION, setStorage,
  saveSession, isAvailable, listStudents, listSessions, getSession, trendSessions,
  replaceAll, lastSetup, saveLastSetup, readRaw,
} from '../js/storage.js';

// ---- 저장소 스텁 --------------------------------------------------------
// 실제 localStorage와 같은 getItem/setItem/removeItem 모양의 메모리 구현.
function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

let memory;
function restoreStorage() { setStorage(memory); }

// 학교 기기처럼 localStorage 접근 자체가 막힌 경우: 읽기·쓰기·삭제 모두 던진다.
function stubStorageThatThrows() {
  const fail = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
  setStorage({ getItem: fail, setItem: fail, removeItem: fail });
}

// 읽기는 되지만 쓰기가 용량 초과로 던진다. 이미 저장된 데이터는 memory에 그대로 있다.
function stubStorageThatThrowsQuotaExceeded() {
  setStorage({
    getItem: (k) => memory.getItem(k),
    setItem: () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); },
    removeItem: (k) => memory.removeItem(k),
  });
}

beforeEach(() => {
  memory = createMemoryStorage();
  restoreStorage();
});

// 기본값은 완료된 정상 회차. 각 테스트가 필요한 칸만 덮어쓴다.
function sessionFixture(partial = {}) {
  return {
    id: 'fixture',
    studentAlias: '학생1',
    startedAt: 1000,
    endedAt: 2000,
    complete: true,
    level: 2,
    themeId: 'animal',
    length: 'medium',
    trialCount: 2,
    responses: [
      { index: 0, type: 'go', rtMs: 800, extraTaps: 0, invalid: false },
      { index: 1, type: 'nogo', rtMs: null, extraTaps: 0, invalid: false },
    ],
    practice: { hits: 5, goTrials: 5, correctRejections: 3, noGoTrials: 3, meanRt: 900, attempt: 1, recommendedLevel: 2 },
    device: { kind: 'tablet', screenW: 820, screenH: 1180, dpr: 2, browser: 'Safari 17', inputKind: 'touch', refreshHzEst: 60 },
    toolVersion: TOOL_VERSION,
    ...partial,
  };
}

// ---- 브리프 테스트 ------------------------------------------------------
test('저장한 회차를 학생별로 되읽는다', () => {
  saveSession(sessionFixture({ id: 'a', studentAlias: '학생1' }));
  expect(listStudents()).toEqual(['학생1']);
  expect(listSessions('학생1').map(s => s.id)).toEqual(['a']);
});

test('모든 회차에 도구 버전과 측정 조건이 함께 저장된다', () => {
  saveSession(sessionFixture({ id: 'a' }));
  const s = getSession('a');
  expect(s.toolVersion).toBe(TOOL_VERSION);
  expect(s.device).toMatchObject({ kind: expect.any(String), inputKind: expect.any(String) });
});

test('추이는 같은 단계의 완료 세션만 돌려준다', () => {
  saveSession(sessionFixture({ id: 'a', level: 2, complete: true }));
  saveSession(sessionFixture({ id: 'b', level: 2, complete: false }));
  saveSession(sessionFixture({ id: 'c', level: 3, complete: true }));
  expect(trendSessions('학생1', 2).map(s => s.id)).toEqual(['a']);
});

test('미완료 세션도 저장되고 목록에는 남는다', () => {
  saveSession(sessionFixture({ id: 'b', complete: false }));
  expect(listSessions('학생1').map(s => s.id)).toContain('b');
});

test('localStorage를 쓸 수 없으면 저장만 실패하고 예외를 던지지 않는다', () => {
  // Review Focus 1
  stubStorageThatThrows();
  const r = saveSession(sessionFixture({ id: 'a' }));
  expect(r.ok).toBe(false);
  expect(r.error).toBeTruthy();
  expect(isAvailable()).toBe(false);
});

test('용량이 꽉 차면 저장만 실패하고 이미 저장된 회차는 그대로다', () => {
  // Review Focus 1
  saveSession(sessionFixture({ id: 'a' }));
  stubStorageThatThrowsQuotaExceeded();
  expect(saveSession(sessionFixture({ id: 'b' })).ok).toBe(false);
  restoreStorage();
  expect(getSession('a')).not.toBeNull();
});

test('지난 설정을 저장하고 되읽는다', () => {
  saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
  expect(lastSetup()).toMatchObject({ themeId: 'animal', level: 2 });
});

test('저장된 데이터가 없으면 지난 설정은 null이다', () => {
  expect(lastSetup()).toBeNull();
});

test('연습 결과를 추천 근거로 회차에 함께 저장한다', () => {
  saveSession(sessionFixture({ id: 'a', practice: { hits: 4, goTrials: 5, correctRejections: 2, noGoTrials: 3, meanRt: 1200, attempt: 1, recommendedLevel: 2 } }));
  expect(getSession('a').practice).toMatchObject({ recommendedLevel: 2, attempt: 1 });
});

// ---- 경계 테스트: 저장 실패가 검사를 망치지 않는다 ------------------------
test('저장소 접근이 막혀 있어도 모든 읽기 함수가 던지지 않고 빈 결과를 돌려준다', () => {
  stubStorageThatThrows();
  expect(listStudents()).toEqual([]);
  expect(listSessions('학생1')).toEqual([]);
  expect(getSession('a')).toBeNull();
  expect(trendSessions('학생1', 2)).toEqual([]);
  expect(lastSetup()).toBeNull();
  expect(() => saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' })).not.toThrow();
  expect(replaceAll([sessionFixture()]).ok).toBe(false);
});

test('저장소 객체 자체가 없어도(주입 해제 후 전역 localStorage 없음) 던지지 않는다', () => {
  setStorage(null); // node에는 전역 localStorage가 없다
  expect(isAvailable()).toBe(false);
  const r = saveSession(sessionFixture());
  expect(r.ok).toBe(false);
  expect(r.error).toBeTruthy();
  expect(listSessions('학생1')).toEqual([]);
});

test('용량 초과로 실패한 뒤 같은 저장소로 다시 저장하면 성공한다', () => {
  stubStorageThatThrowsQuotaExceeded();
  expect(saveSession(sessionFixture({ id: 'b' })).ok).toBe(false);
  restoreStorage();
  expect(saveSession(sessionFixture({ id: 'b' })).ok).toBe(true);
  expect(getSession('b')).not.toBeNull();
});

test('isAvailable은 정상 저장소에서 true이고 탐침 키를 남기지 않는다', () => {
  expect(isAvailable()).toBe(true);
  expect(memory.getItem(STORAGE_KEY)).toBeNull();
  expect(listStudents()).toEqual([]);
});

// ---- 경계 테스트: 비어 있음 / 깨짐 / 다른 스키마 --------------------------
test('저장소가 비어 있으면 모든 읽기 함수가 빈 결과를 돌려준다', () => {
  expect(listStudents()).toEqual([]);
  expect(listSessions('학생1')).toEqual([]);
  expect(getSession('a')).toBeNull();
  expect(trendSessions('학생1', 2)).toEqual([]);
});

test('저장된 JSON이 깨졌으면 던지지 않고 빈 결과를 돌려준다', () => {
  memory.setItem(STORAGE_KEY, '{not json');
  expect(listStudents()).toEqual([]);
  expect(listSessions('학생1')).toEqual([]);
  expect(getSession('a')).toBeNull();
  expect(trendSessions('학생1', 2)).toEqual([]);
  expect(lastSetup()).toBeNull();
});

test('JSON이지만 모양이 다르면(배열, null, sessions 없음) 빈 결과를 돌려준다', () => {
  for (const raw of ['[]', 'null', '"x"', '{"schemaVersion":1}', '{"schemaVersion":1,"sessions":{}}']) {
    memory.setItem(STORAGE_KEY, raw);
    expect(listSessions('학생1')).toEqual([]);
    expect(lastSetup()).toBeNull();
  }
});

test('스키마 버전이 다르면 던지지 않고 빈 결과를 돌려준다', () => {
  memory.setItem(STORAGE_KEY, JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, sessions: [sessionFixture({ id: 'a' })], lastSetup: null }));
  expect(listSessions('학생1')).toEqual([]);
  expect(getSession('a')).toBeNull();
  expect(lastSetup()).toBeNull();
});

test('깨진 데이터 위에는 저장하지 않는다 - 덮어쓰면 복구할 수 있는 자료가 사라진다', () => {
  memory.setItem(STORAGE_KEY, '{not json');
  const r = saveSession(sessionFixture({ id: 'a' }));
  expect(r.ok).toBe(false);
  expect(r.error).toBeTruthy();
  expect(memory.getItem(STORAGE_KEY)).toBe('{not json');
});

test('다른 스키마 버전의 데이터 위에는 저장하지 않고 원본을 그대로 둔다', () => {
  const foreign = JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, sessions: [{ id: 'future' }] });
  memory.setItem(STORAGE_KEY, foreign);
  expect(saveSession(sessionFixture({ id: 'a' })).ok).toBe(false);
  saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
  expect(memory.getItem(STORAGE_KEY)).toBe(foreign);
});

test('replaceAll은 깨진 데이터를 명시적으로 새 목록으로 교체할 수 있다', () => {
  memory.setItem(STORAGE_KEY, '{not json');
  expect(replaceAll([sessionFixture({ id: 'a' })]).ok).toBe(true);
  expect(listSessions('학생1').map(s => s.id)).toEqual(['a']);
});

test('replaceAll은 배열이 아니면 거부하고 기존 자료를 건드리지 않는다', () => {
  saveSession(sessionFixture({ id: 'a' }));
  expect(replaceAll('nope').ok).toBe(false);
  expect(replaceAll(null).ok).toBe(false);
  expect(getSession('a')).not.toBeNull();
});

test('replaceAll은 회차 목록을 통째로 바꾸고 지난 설정은 유지한다', () => {
  saveSession(sessionFixture({ id: 'a' }));
  saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
  expect(replaceAll([sessionFixture({ id: 'x', toolVersion: '0.0.9' })]).ok).toBe(true);
  expect(listSessions('학생1').map(s => s.id)).toEqual(['x']);
  expect(getSession('x').toolVersion).toBe('0.0.9'); // 가져온 회차의 원래 버전을 덮어쓰지 않는다
  expect(lastSetup()).toMatchObject({ themeId: 'animal' });
});

// ---- 경계 테스트: 저장 모양 -----------------------------------------------
test('단일 키에 스키마 버전과 함께 JSON으로 저장한다', () => {
  saveSession(sessionFixture({ id: 'a' }));
  const raw = JSON.parse(memory.getItem(STORAGE_KEY));
  expect(raw.schemaVersion).toBe(SCHEMA_VERSION);
  expect(raw.sessions.map(s => s.id)).toEqual(['a']);
});

test('저장할 때 toolVersion은 현재 TOOL_VERSION으로 찍힌다', () => {
  saveSession(sessionFixture({ id: 'a', toolVersion: undefined }));
  expect(getSession('a').toolVersion).toBe(TOOL_VERSION);
  saveSession(sessionFixture({ id: 'b', toolVersion: 'stale' }));
  expect(getSession('b').toolVersion).toBe(TOOL_VERSION);
});

test('문항 단위 원자료가 손실 없이 되읽힌다', () => {
  const responses = [
    { index: 0, type: 'go', rtMs: 812.5, extraTaps: 1, invalid: false },
    { index: 1, type: 'nogo', rtMs: null, extraTaps: 0, invalid: true },
  ];
  saveSession(sessionFixture({ id: 'a', responses }));
  expect(getSession('a').responses).toEqual(responses);
});

test('같은 id를 다시 저장하면 중복 없이 교체한다', () => {
  saveSession(sessionFixture({ id: 'a', complete: false }));
  saveSession(sessionFixture({ id: 'a', complete: true }));
  expect(listSessions('학생1')).toHaveLength(1);
  expect(getSession('a').complete).toBe(true);
});

test('없는 id는 null이다', () => {
  saveSession(sessionFixture({ id: 'a' }));
  expect(getSession('zzz')).toBeNull();
});

// ---- 경계 테스트: 학생 분리, 정렬 -----------------------------------------
test('trendSessions와 listSessions는 다른 학생의 회차를 섞지 않는다', () => {
  saveSession(sessionFixture({ id: 'a', studentAlias: '학생1', level: 2 }));
  saveSession(sessionFixture({ id: 'b', studentAlias: '학생2', level: 2 }));
  expect(trendSessions('학생1', 2).map(s => s.id)).toEqual(['a']);
  expect(trendSessions('학생2', 2).map(s => s.id)).toEqual(['b']);
  expect(listSessions('학생1').map(s => s.id)).toEqual(['a']);
  expect(trendSessions('학생3', 2)).toEqual([]);
});

test('listStudents는 별칭을 중복 없이 가나다순으로 돌려준다', () => {
  saveSession(sessionFixture({ id: 'a', studentAlias: '하늘' }));
  saveSession(sessionFixture({ id: 'b', studentAlias: '가람' }));
  saveSession(sessionFixture({ id: 'c', studentAlias: '하늘' }));
  expect(listStudents()).toEqual(['가람', '하늘']);
});

test('listSessions와 trendSessions는 시작 시각 오름차순(오래된 회차가 먼저)이다', () => {
  saveSession(sessionFixture({ id: 'late', startedAt: 3000 }));
  saveSession(sessionFixture({ id: 'early', startedAt: 1000 }));
  saveSession(sessionFixture({ id: 'mid', startedAt: 2000 }));
  expect(listSessions('학생1').map(s => s.id)).toEqual(['early', 'mid', 'late']);
  expect(trendSessions('학생1', 2).map(s => s.id)).toEqual(['early', 'mid', 'late']);
});

test('시작 시각이 같으면 저장한 순서를 지킨다', () => {
  saveSession(sessionFixture({ id: 'first', startedAt: 1000 }));
  saveSession(sessionFixture({ id: 'second', startedAt: 1000 }));
  expect(listSessions('학생1').map(s => s.id)).toEqual(['first', 'second']);
});

test('추이는 난이도 단계가 다른 회차를 섞지 않는다', () => {
  saveSession(sessionFixture({ id: 'l1', level: 1 }));
  saveSession(sessionFixture({ id: 'l2', level: 2 }));
  saveSession(sessionFixture({ id: 'l3', level: 3 }));
  expect(trendSessions('학생1', 1).map(s => s.id)).toEqual(['l1']);
  expect(trendSessions('학생1', 3).map(s => s.id)).toEqual(['l3']);
});

test('saveLastSetup은 회차 목록을 건드리지 않고, 회차 저장은 지난 설정을 지우지 않는다', () => {
  saveSession(sessionFixture({ id: 'a' }));
  saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
  expect(getSession('a')).not.toBeNull();
  saveSession(sessionFixture({ id: 'b' }));
  expect(lastSetup()).toMatchObject({ alias: '학생1', length: 'medium' });
});

// ---- deviceInfo ---------------------------------------------------------
function fakeWin(over = {}) {
  return {
    screen: { width: 390, height: 844 },
    devicePixelRatio: 3,
    navigator: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
    },
    matchMedia: (q) => ({ matches: q === '(pointer: coarse)' }),
    ...over,
  };
}

test('collectDeviceInfo: 스마트폰 - 작은 화면과 터치', () => {
  expect(collectDeviceInfo(fakeWin())).toEqual({
    kind: 'phone', screenW: 390, screenH: 844, dpr: 3, browser: 'Safari 17', inputKind: 'touch', refreshHzEst: null,
  });
});

test('collectDeviceInfo: 태블릿 - 터치이면서 짧은 변이 큼', () => {
  const info = collectDeviceInfo(fakeWin({ screen: { width: 820, height: 1180 }, devicePixelRatio: 2 }));
  expect(info).toMatchObject({ kind: 'tablet', inputKind: 'touch', screenW: 820, screenH: 1180, dpr: 2 });
});

test('collectDeviceInfo: 데스크톱 - 마우스', () => {
  const info = collectDeviceInfo(fakeWin({
    screen: { width: 1920, height: 1080 }, devicePixelRatio: 1,
    navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36', maxTouchPoints: 0 },
    matchMedia: () => ({ matches: false }),
  }));
  expect(info).toMatchObject({ kind: 'desktop', inputKind: 'mouse', browser: 'Chrome 120' });
});

test('collectDeviceInfo: 브라우저 구분 - Edge, Firefox, Samsung, iOS Chrome', () => {
  const browserOf = (userAgent) => collectDeviceInfo(fakeWin({ navigator: { userAgent, maxTouchPoints: 0 } })).browser;
  expect(browserOf('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/119.0.0.0')).toBe('Edge 119');
  expect(browserOf('Mozilla/5.0 (Windows NT 10.0; rv:121.0) Gecko/20100101 Firefox/121.0')).toBe('Firefox 121');
  expect(browserOf('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/117.0.0.0 Mobile Safari/537.36 SamsungBrowser/23.0')).toBe('Samsung Internet 23');
  expect(browserOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1')).toBe('Chrome 120');
  expect(browserOf('???')).toBe('unknown');
});

test('collectDeviceInfo: 아무 정보가 없는 환경에서도 던지지 않고 쓸 수 있는 값을 돌려준다', () => {
  const info = collectDeviceInfo({});
  expect(info).toMatchObject({ kind: 'desktop', inputKind: 'mouse', browser: 'unknown', refreshHzEst: null });
  expect(() => collectDeviceInfo()).not.toThrow(); // node의 globalThis
});

test('collectDeviceInfo: matchMedia가 없어도 maxTouchPoints로 터치를 판단한다', () => {
  const info = collectDeviceInfo(fakeWin({ matchMedia: undefined }));
  expect(info.inputKind).toBe('touch');
});

// 프레임 간격이 intervalMs인 가짜 requestAnimationFrame.
function fakeRaf(intervalMs) {
  let t = 0;
  return (cb) => { t += intervalMs; queueMicrotask(() => cb(t)); return 1; };
}

test('measureRefreshHz: 프레임 간격에서 주사율을 추정하고 collectDeviceInfo가 그 값을 쓴다', async () => {
  const win = fakeWin({ requestAnimationFrame: fakeRaf(1000 / 60) });
  expect(await measureRefreshHz(win)).toBe(60);
  expect(collectDeviceInfo(win).refreshHzEst).toBe(60);
  const win120 = fakeWin({ requestAnimationFrame: fakeRaf(1000 / 120) });
  expect(await measureRefreshHz(win120)).toBe(120);
});

test('measureRefreshHz: 이따금 튀는 프레임이 있어도 중앙값으로 추정한다', async () => {
  let t = 0; let n = 0;
  const raf = (cb) => { n += 1; t += n === 5 ? 120 : 1000 / 60; queueMicrotask(() => cb(t)); return 1; };
  expect(await measureRefreshHz(fakeWin({ requestAnimationFrame: raf }))).toBe(60);
});

test('measureRefreshHz: requestAnimationFrame이 없으면 null이다', async () => {
  const win = fakeWin();
  expect(await measureRefreshHz(win)).toBeNull();
  expect(collectDeviceInfo(win).refreshHzEst).toBeNull();
});

test('measureRefreshHz: 프레임이 오지 않으면(백그라운드 탭) 기다리다 null로 끝난다', async () => {
  vi.useFakeTimers();
  try {
    const win = fakeWin({ requestAnimationFrame: () => 1 }); // 콜백을 영영 부르지 않는다
    const p = measureRefreshHz(win);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBeNull();
    expect(collectDeviceInfo(win).refreshHzEst).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test('주사율 추정 결과는 측정한 window에만 붙는다', async () => {
  const measured = fakeWin({ requestAnimationFrame: fakeRaf(1000 / 60) });
  await measureRefreshHz(measured);
  expect(collectDeviceInfo(fakeWin()).refreshHzEst).toBeNull();
});

// ---- 리뷰 후 추가: 잘못된 레코드, 접근 자체가 던지는 경로, 주사율 -----------------
test('localStorage 접근 자체가 던지는 환경(시크릿 모드)에서도 던지지 않는다', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() { throw new DOMException('Access is denied for this document.', 'SecurityError'); },
  });
  try {
    setStorage(null); // 주입 없이 실제 전역 경로를 탄다
    expect(isAvailable()).toBe(false);
    const r = saveSession(sessionFixture());
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
    expect(listSessions('학생1')).toEqual([]);
    expect(lastSetup()).toBeNull();
  } finally {
    delete globalThis.localStorage;
  }
});

test('저장된 sessions에 null 원소가 있어도 읽기 함수가 던지지 않고, 그 위에는 저장하지 않는다', () => {
  const raw = JSON.stringify({ schemaVersion: SCHEMA_VERSION, sessions: [null, sessionFixture({ id: 'a' })], lastSetup: null });
  memory.setItem(STORAGE_KEY, raw);
  expect(() => listStudents()).not.toThrow();
  expect(listStudents()).toEqual([]);
  expect(listSessions('학생1')).toEqual([]);
  expect(getSession('a')).toBeNull();
  expect(trendSessions('학생1', 2)).toEqual([]);
  expect(saveSession(sessionFixture({ id: 'b' })).ok).toBe(false);
  expect(memory.getItem(STORAGE_KEY)).toBe(raw);
});

test('저장된 세션의 studentAlias가 문자열이 아니면 던지지 않는다', () => {
  for (const alias of [null, 7, undefined]) {
    memory.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      sessions: [sessionFixture({ id: 'a' }), sessionFixture({ id: 'b', studentAlias: alias })],
    }));
    expect(() => listStudents()).not.toThrow();
    expect(listStudents()).toEqual([]);
    expect(listSessions('학생1')).toEqual([]);
  }
});

test('저장된 세션의 startedAt이 숫자가 아니면 읽을 수 없는 자료로 본다', () => {
  memory.setItem(STORAGE_KEY, JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    sessions: [sessionFixture({ id: 'a', startedAt: '2026-10-21T09:00:00Z' })],
  }));
  expect(trendSessions('학생1', 2)).toEqual([]);
});

test('replaceAll은 잘못된 레코드가 하나라도 있으면 통째로 거부하고 기존 자료를 건드리지 않는다', () => {
  saveSession(sessionFixture({ id: 'a' }));
  const before = memory.getItem(STORAGE_KEY);
  for (const bad of [null, 'x', 7, [], {}, { id: 'z' }, { id: 'z', studentAlias: '학생1' }, { id: 'z', studentAlias: 3, startedAt: 1 }, { studentAlias: '학생1', startedAt: 1 }]) {
    const r = replaceAll([sessionFixture({ id: 'ok' }), bad]);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  }
  expect(memory.getItem(STORAGE_KEY)).toBe(before);
  expect(() => listStudents()).not.toThrow();
});

test('saveSession은 객체가 아니거나 id·studentAlias가 없는 값을 거부하고 아무것도 저장하지 않는다', () => {
  for (const bad of [null, undefined, 'x', 7, [], {}, { id: 'a' }, { id: 'a', studentAlias: '학생1' }, { studentAlias: '학생1', startedAt: 1 }, { id: '', studentAlias: '학생1', startedAt: 1 }]) {
    const r = saveSession(bad);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  }
  expect(memory.getItem(STORAGE_KEY)).toBeNull();
  expect(listStudents()).toEqual([]);
});

test('saveSession은 startedAt이 유한한 숫자가 아니면 거부한다 - 추이 순서가 조용히 틀어지지 않게', () => {
  for (const startedAt of ['2026-10-21T09:00:00Z', undefined, null, NaN, Infinity]) {
    expect(saveSession(sessionFixture({ id: 'a', startedAt })).ok).toBe(false);
  }
  expect(getSession('a')).toBeNull();
});

test('measureRefreshHz: win이 객체가 아니어도 reject하지 않고 null로 끝난다', async () => {
  await expect(measureRefreshHz(null)).resolves.toBeNull();
  await expect(measureRefreshHz(42)).resolves.toBeNull();
  expect(collectDeviceInfo(null).refreshHzEst).toBeNull();
});

test('measureRefreshHz: 나중의 측정 실패가 이미 측정된 값을 덮어쓰지 않는다', async () => {
  const win = fakeWin({ requestAnimationFrame: fakeRaf(1000 / 60) });
  expect(await measureRefreshHz(win)).toBe(60);
  vi.useFakeTimers();
  try {
    win.requestAnimationFrame = () => 1; // 이제 프레임이 오지 않는다
    const p = measureRefreshHz(win);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p).toBeNull();
  } finally {
    vi.useRealTimers();
  }
  expect(collectDeviceInfo(win).refreshHzEst).toBe(60);
  delete win.requestAnimationFrame;
  expect(await measureRefreshHz(win)).toBeNull();
  expect(collectDeviceInfo(win).refreshHzEst).toBe(60);
});

// ---- readRaw: 읽을 수 없는 자료를 덮어쓰기 전에 원본을 꺼내는 통로 ---------------
test('readRaw: 정상 데이터가 있으면 저장된 문자열을 그대로 돌려준다(파싱 결과가 아니다)', () => {
  saveSession(sessionFixture({ id: 'a' }));
  const raw = readRaw();
  expect(typeof raw).toBe('string');
  expect(raw).toBe(memory.getItem(STORAGE_KEY));
  expect(JSON.parse(raw).sessions.map(s => s.id)).toEqual(['a']);
});

test('readRaw: 파싱할 수 없는 손상 데이터도 그 문자열 그대로 돌려준다', () => {
  memory.setItem(STORAGE_KEY, '{not json');
  expect(readRaw()).toBe('{not json');
  const withBadRecord = JSON.stringify({ schemaVersion: SCHEMA_VERSION, sessions: [null] });
  memory.setItem(STORAGE_KEY, withBadRecord);
  expect(readRaw()).toBe(withBadRecord);
});

test('readRaw: 저장소가 비어 있으면 null이다', () => {
  expect(readRaw()).toBeNull();
});

test('readRaw: 접근이 던지는 저장소나 저장소가 없는 환경에서도 던지지 않고 null이다', () => {
  stubStorageThatThrows();
  expect(() => readRaw()).not.toThrow();
  expect(readRaw()).toBeNull();
  setStorage(null);
  expect(readRaw()).toBeNull();
});
