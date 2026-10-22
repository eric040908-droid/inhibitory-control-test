// @vitest-environment jsdom
// 이력 화면. 이 화면은 데이터를 지키는 마지막 방어선이다: 내보내기는 반드시 되어야 하고, 가져오기는 기존 기록을
// 절대 파괴하지 않아야 하며, 읽을 수 없는 저장소에서도 원본 바이트를 꺼낼 수 있어야 한다.
// 맨 앞의 6개는 계획서의 테스트이고(헬퍼는 이 파일에서 정의한다), 그 아래는 경계 확인을 테스트로 남긴 것이다.
//
// 계획서의 테스트에서 바뀐 것은 하나뿐이다: 가져오기는 파일을 FileReader로 읽는 비동기 동작이라
// importJson 헬퍼가 비동기이고 테스트가 `await importJson(...)`으로 기다린다. 단언은 그대로다.
import { TOOL_VERSION } from '../js/config.js';
import { parseBackupJson } from '../js/exportImport.js';
import { setPin, isEnabled, verify } from '../js/pin.js';
import {
  STORAGE_KEY, setStorage, saveSession, listStudents, listSessions, readRaw, storageStatus,
} from '../js/storage.js';
import { createHistoryScreen } from '../js/screens/history.js';

// ---- 하네스 ----------------------------------------------------------------------------
let memory;
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

let nextStart = 1_700_000_000_000;
let nextId = 0;
const resp = (index, type, rtMs) => ({ index, type, rtMs, extraTaps: 0, invalid: false });

function sessionFixture({
  id, studentAlias = '학생A', level = 2, themeId = 'animal', length = 'medium',
  responses, complete = true, startedAt, toolVersion = TOOL_VERSION,
} = {}) {
  const list = responses ?? [resp(0, 'go', 450), resp(1, 'go', 500), resp(2, 'nogo', null), resp(3, 'go', null)];
  const start = startedAt ?? (nextStart += 60_000);
  return {
    id: id ?? `s-${nextId += 1}`,
    studentAlias,
    startedAt: start,
    endedAt: start + 300_000,
    complete,
    level,
    themeId,
    length,
    trialCount: list.length,
    responses: list,
    practice: null,
    device: { kind: 'phone', screenW: 390, screenH: 844, dpr: 3, browser: 'Chrome 152', inputKind: 'touch', refreshHzEst: 60 },
    toolVersion,
  };
}

function seedSessions(list) {
  for (const partial of list) {
    const result = saveSession(sessionFixture(partial));
    if (!result.ok) throw new Error(`seed 실패: ${result.error}`);
  }
}

const allSessions = () => listStudents().flatMap((alias) => listSessions(alias));
const allSessionIds = () => allSessions().map((s) => s.id).sort();

let screen = null;
let root = null;

function mountHistory({ onOpenSession = vi.fn(), onBack = vi.fn(), alias, screenInstance } = {}) {
  root = document.createElement('div');
  document.body.append(root);
  screen = screenInstance ?? createHistoryScreen({});
  screen.mount(root, { onOpenSession, onBack, alias });
  return { root, onOpenSession, onBack };
}

const qs = (sel) => document.querySelector(sel);
const qsa = (sel) => [...document.querySelectorAll(sel)];
const row = (id) => document.querySelector(`[data-session-row="${id}"]`);
const click = (el) => el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };

// 파일 선택을 흉내 낸다. 읽기는 비동기이므로 화면이 결과 안내를 올릴 때까지 기다린다.
async function importJson(text) {
  const input = qs('[data-import-input]');
  const file = new File([text], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(qs('[data-flash]')).not.toBeNull());
}

const backup = (sessions, extra = {}) => JSON.stringify({ schema: 1, toolVersion: TOOL_VERSION, sessions, ...extra });

// ---- 다운로드 관찰 ----------------------------------------------------------------------
// jsdom에는 createObjectURL이 없다. 만든 Blob과 해제된 URL을 기록하고, 앵커 click(실제 다운로드)을 가로챈다.
let blobs;      // createObjectURL에 넘어온 Blob
let revoked;    // revokeObjectURL에 넘어온 URL
let downloads;  // { href, download } — 앵커 click 때의 값
let urlSeq;

function readBytes(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

beforeEach(() => {
  memory = memoryStorage();
  setStorage(memory);
  localStorage.clear();
  blobs = []; revoked = []; downloads = []; urlSeq = 0;
  URL.createObjectURL = vi.fn((blob) => { blobs.push(blob); urlSeq += 1; return `blob:mock/${urlSeq}`; });
  URL.revokeObjectURL = vi.fn((url) => { revoked.push(url); });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    downloads.push({ href: this.href, download: this.download });
  });
  window.scrollTo = vi.fn();
});

afterEach(() => {
  screen?.unmount?.();
  screen = null;
  document.body.replaceChildren();
  setStorage(null);
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ============================================================================================
// 계획서의 테스트 (원문 그대로)
// ============================================================================================
describe('계획서 테스트', () => {
  test('미완료 회차를 중단으로 표시한다', () => {
    seedSessions([{ id: 'a', complete: false }]);
    mountHistory();
    expect(row('a').textContent).toMatch(/중단/);
  });

  test('내보내기 버튼이 CSV와 JSON 두 가지를 제공한다', () => {
    mountHistory();
    expect(document.querySelector('[data-export="csv"]')).not.toBeNull();
    expect(document.querySelector('[data-export="json"]')).not.toBeNull();
  });

  test('가져오기는 기존 데이터를 지우지 않고 합친다', async () => {
    // Review Focus 2
    seedSessions([{ id: 'a' }]);
    mountHistory(); await importJson(JSON.stringify({ schema: 1, toolVersion: TOOL_VERSION, sessions: [sessionFixture({ id: 'b' })] }));
    expect(allSessionIds()).toEqual(expect.arrayContaining(['a', 'b']));
  });

  test('가져오기 경고를 교사에게 보여준다', async () => {
    // Review Focus 2
    seedSessions([{ id: 'a' }]);
    mountHistory(); await importJson('{ broken');
    expect(document.body.textContent).toMatch(/불러오지|경고|실패/);
    expect(allSessionIds()).toEqual(['a']);
  });

  test('PIN이 켜져 있으면 잠금 화면을 먼저 거친다', () => {
    setPin('1234'); mountHistory();
    expect(document.querySelector('[data-pin-gate]')).not.toBeNull();
    expect(document.querySelector('[data-session-row]')).toBeNull();
  });

  test('PIN이 꺼져 있으면 바로 목록이 보인다', () => {
    seedSessions([{ id: 'a' }]); mountHistory();
    expect(document.querySelector('[data-pin-gate]')).toBeNull();
    expect(row('a')).not.toBeNull();
  });
});

// ============================================================================================
// 목록
// ============================================================================================
describe('학생 목록과 회차 목록', () => {
  test('학생마다 한 묶음이고 가나다순이며 회차 수를 보여 준다', () => {
    seedSessions([{ id: 'a', studentAlias: '하늘' }, { id: 'b', studentAlias: '가람' }, { id: 'c', studentAlias: '가람' }]);
    mountHistory();
    const groups = qsa('[data-student]');
    expect(groups.map((g) => g.dataset.student)).toEqual(['가람', '하늘']);
    expect(groups[0].querySelector('summary').textContent).toMatch(/2회차/);
    expect(groups[1].querySelector('summary').textContent).toMatch(/1회차/);
  });

  test('회차 줄에 날짜, 난이도 단계, 테마, 길이, 완료 여부를 적는다', () => {
    seedSessions([{ id: 'a', level: 3, themeId: 'vehicle', length: 'long', complete: true }]);
    mountHistory();
    const text = row('a').textContent;
    expect(text).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(text).toContain('3단계');
    expect(text).toContain('탈것');
    expect(text).toContain('길게');
    expect(text).toContain('완료');
    expect(text).not.toContain('중단');
  });

  test('완료 회차에는 중단이라는 글자가 없고, 중단 회차에는 완료라는 글자가 없다', () => {
    seedSessions([{ id: 'a', complete: true }, { id: 'b', complete: false }]);
    mountHistory();
    expect(row('a').textContent).not.toMatch(/중단/);
    expect(row('b').textContent).not.toMatch(/완료/);
    expect(row('b').textContent).toMatch(/중단/);
  });

  test('최근 회차가 먼저 나온다', () => {
    seedSessions([{ id: 'old', startedAt: 1_700_000_000_000 }, { id: 'new', startedAt: 1_700_000_900_000 }]);
    mountHistory();
    expect(qsa('[data-session-row]').map((r) => r.dataset.sessionRow)).toEqual(['new', 'old']);
  });

  test('가져온 옛 회차의 빠진 필드(테마·길이·단계)에 던지지 않고, 알 수 없는 테마 id는 그대로 보인다', () => {
    memory.setItem(STORAGE_KEY, JSON.stringify({
      schemaVersion: 1, lastSetup: null,
      sessions: [{ id: 'x', studentAlias: '옛', startedAt: 1_700_000_000_000, themeId: 'retired-theme' }],
    }));
    expect(() => mountHistory()).not.toThrow();
    expect(row('x').textContent).toContain('retired-theme');
    expect(row('x').textContent).toMatch(/중단/); // complete가 없으면 완료로 보지 않는다
  });

  test('저장된 기록이 없으면 그렇다고 알린다', () => {
    mountHistory();
    expect(qs('[data-empty]')).not.toBeNull();
    expect(qs('[data-empty]').textContent).toMatch(/저장된 기록이 없습니다/);
  });

  test('회차 줄을 click하면 onOpenSession에 그 회차를 넘긴다', () => {
    seedSessions([{ id: 'a' }, { id: 'b' }]);
    const { onOpenSession } = mountHistory();
    click(row('b'));
    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(onOpenSession.mock.calls[0][0]).toMatchObject({ id: 'b', studentAlias: '학생A' });
  });

  test('교사 화면이므로 pointerdown으로는 열리지 않는다 (스크롤하려고 댄 손가락이 눌리지 않게)', () => {
    seedSessions([{ id: 'a' }]);
    const { onOpenSession } = mountHistory();
    row('a').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onOpenSession).not.toHaveBeenCalled();
  });

  test('alias를 넘기면 그 학생의 묶음이 펼쳐진 채로 열린다 (결과에서 돌아왔을 때)', () => {
    seedSessions([{ id: 'a', studentAlias: '가람' }, { id: 'b', studentAlias: '하늘' }]);
    mountHistory({ alias: '하늘' });
    expect(qs('[data-student="하늘"]').open).toBe(true);
    expect(qs('[data-student="가람"]').open).toBe(false);
  });

  test('돌아가기를 click하면 onBack을 부른다', () => {
    const { onBack } = mountHistory();
    click(qs('[data-action="back"]'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================================
// 내보내기
// ============================================================================================
describe('내보내기', () => {
  test('CSV 다운로드의 첫 바이트는 UTF-8 BOM(EF BB BF)이고 한글 별칭이 깨지지 않는다', async () => {
    seedSessions([{ id: 'a', studentAlias: '철수' }]);
    mountHistory();
    click(qs('[data-export="csv"]'));
    expect(blobs).toHaveLength(1);
    const bytes = await readBytes(blobs[0]);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = new TextDecoder('utf-8').decode(bytes.slice(3));
    expect(body.startsWith('student_alias,')).toBe(true);
    expect(body).toContain('철수');
    expect(body).not.toContain('\uFEFF'); // BOM은 한 번만
    expect(downloads[0].download).toMatch(/\.csv$/);
    expect(blobs[0].type).toMatch(/^text\/csv/);
  });

  test('JSON 백업은 BOM이 없고, 파싱하면 저장된 모든 학생의 모든 회차가 그대로 복원된다', async () => {
    seedSessions([{ id: 'a', studentAlias: '철수' }, { id: 'b', studentAlias: '영희', complete: false }]);
    mountHistory();
    click(qs('[data-export="json"]'));
    const bytes = await readBytes(blobs[0]);
    expect(bytes[0]).toBe(0x7b); // '{'
    const parsed = parseBackupJson(new TextDecoder().decode(bytes));
    expect(parsed.warnings).toEqual([]);
    expect(parsed.sessions.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(parsed.sessions.find((s) => s.id === 'b').complete).toBe(false);
    expect(downloads[0].download).toMatch(/\.json$/);
  });

  test('다운로드 파일 이름에 별칭 같은 개인 식별 글자가 들어가지 않는다', () => {
    seedSessions([{ id: 'a', studentAlias: '철수' }]);
    mountHistory();
    click(qs('[data-export="csv"]'));
    click(qs('[data-export="json"]'));
    for (const d of downloads) expect(d.download).not.toContain('철수');
  });

  test('앵커는 만든 objectURL을 가리키고 다운로드 뒤 DOM에 남지 않는다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-export="csv"]'));
    expect(downloads[0].href).toBe('blob:mock/1');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  test('만든 URL은 해제된다 (잠시 뒤)', () => {
    vi.useFakeTimers();
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-export="csv"]'));
    click(qs('[data-export="json"]'));
    expect(urlSeq).toBe(2);
    vi.advanceTimersByTime(60_000);
    expect([...revoked].sort()).toEqual(['blob:mock/1', 'blob:mock/2']);
  });

  test('다운로드 직후에는 해제하지 않는다 (일부 브라우저는 해제가 이르면 다운로드를 취소한다)', () => {
    vi.useFakeTimers();
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-export="csv"]'));
    expect(revoked).toEqual([]);
  });

  // 이전에는 unmount가 아직 해제되지 않은 URL을 곧바로 해제했다. 교사가 "내려받기를 시작했습니다"를 읽고 회차 줄을 누르면
  // (이력 → 결과 화면) 일부 브라우저가 다운로드를 취소하는데, 교사는 받아졌다고 믿는다. 백업 파일은 유일한 보험이다.
  test('unmount는 아직 해제되지 않은 URL을 해제하지 않는다 (내려받기가 끝나기 전에 화면을 떠나도 다운로드가 취소되지 않는다)', () => {
    vi.useFakeTimers();
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-export="json"]'));
    click(qs('[data-export="csv"]'));
    screen.unmount();
    expect(revoked).toEqual([]);
  });

  test('unmount는 해제 타이머를 거둔다 (화면이 없는데 타이머가 남지 않는다)', () => {
    vi.useFakeTimers();
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-export="json"]'));
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    screen.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('회차 줄을 눌러 나가는 실제 순서(내려받기 → 줄 탭 → 화면 교체)에서도 URL은 살아 있다', () => {
    vi.useFakeTimers();
    seedSessions([{ id: 'a' }]);
    const { onOpenSession } = mountHistory({ onOpenSession: vi.fn(() => screen.unmount()) });
    click(qs('[data-export="json"]'));
    click(qs('[data-session-row="a"]'));
    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual([]);
  });

  test('같은 화면을 다시 mount해도 이전 mount의 URL을 해제하지 않는다', () => {
    vi.useFakeTimers();
    seedSessions([{ id: 'a' }]);
    const instance = createHistoryScreen({});
    mountHistory({ screenInstance: instance });
    click(qs('[data-export="json"]'));
    document.body.replaceChildren();
    mountHistory({ screenInstance: instance }); // 결과 화면에서 돌아올 때처럼 같은 인스턴스를 다시 mount
    expect(revoked).toEqual([]);
  });

  test('내려받기를 시작했다고 알리고 파일 이름을 보여 준다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-export="json"]'));
    expect(qs('[data-flash]').textContent).toContain(downloads[0].download);
  });

  test('createObjectURL이 던져도 화면이 죽지 않고 실패를 알린다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    URL.createObjectURL = vi.fn(() => { throw new Error('no blob urls'); });
    expect(() => click(qs('[data-export="csv"]'))).not.toThrow();
    expect(qs('[data-flash]').textContent).toMatch(/내려받지 못했습니다/);
  });

  test('기록이 없으면 내보내기 버튼은 있되 눌 수 없다', () => {
    mountHistory();
    expect(qs('[data-export="csv"]').disabled).toBe(true);
    expect(qs('[data-export="json"]').disabled).toBe(true);
    click(qs('[data-export="csv"]'));
    expect(blobs).toHaveLength(0);
  });

  test('교사가 이 기기의 기록이 브라우저에만 있다는 것과 백업이 필요하다는 것을 읽는다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    expect(qs('[data-section="export"]').textContent).toMatch(/이 기기의 브라우저에만/);
    expect(qs('[data-section="export"]').textContent).toMatch(/백업/);
  });
});

// ============================================================================================
// 가져오기
// ============================================================================================
describe('가져오기', () => {
  test('깨진 JSON을 넣어도 기존 기록은 한 글자도 바뀌지 않는다', async () => {
    seedSessions([{ id: 'a' }]);
    const before = readRaw();
    mountHistory(); await importJson('{ broken');
    expect(readRaw()).toBe(before);
  });

  test('원소가 null인 항목은 건너뛰고 경고하며, 나머지 유효한 회차는 들인다', async () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    await importJson(backup([null, sessionFixture({ id: 'b' })]));
    expect(allSessionIds()).toEqual(['a', 'b']);
    expect(qs('[data-flash]').textContent).toMatch(/1번째 회차를 건너뜁니다/);
  });

  test('필수 필드가 빠진 회차는 건너뛰고 경고한다', async () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    const noAlias = sessionFixture({ id: 'c' }); delete noAlias.studentAlias;
    const noId = sessionFixture({ id: 'd' }); delete noId.id;
    const badStart = { ...sessionFixture({ id: 'e' }), startedAt: '2026-01-01' };
    await importJson(backup([noAlias, noId, badStart, sessionFixture({ id: 'b' })]));
    expect(allSessionIds()).toEqual(['a', 'b']);
    expect(qs('[data-flash]').textContent).toMatch(/1번째 회차를 건너뜁니다/);
    expect(qs('[data-flash]').textContent).toMatch(/3번째 회차를 건너뜁니다/);
  });

  test('다른 toolVersion 파일은 들이되 경고한다', async () => {
    mountHistory();
    await importJson(backup([sessionFixture({ id: 'b', toolVersion: '9.9.9' })], { toolVersion: '9.9.9' }));
    expect(allSessionIds()).toEqual(['b']);
    expect(qs('[data-flash]').textContent).toMatch(/다른 도구 버전/);
    expect(qs('[data-flash]').textContent).toContain('9.9.9');
  });

  test('모르는 schema 파일은 하나도 들이지 않고 기존 기록을 지키며 알린다', async () => {
    seedSessions([{ id: 'a' }]);
    const before = readRaw();
    mountHistory();
    await importJson(JSON.stringify({ schema: 2, toolVersion: TOOL_VERSION, sessions: [sessionFixture({ id: 'b' })] }));
    expect(readRaw()).toBe(before);
    expect(qs('[data-flash]').textContent).toMatch(/불러오지 못했습니다/);
  });

  test('회차가 빈 배열인 파일은 기존 기록을 지우지 않는다 (빈 파일이 "전부 교체"가 되면 안 된다)', async () => {
    seedSessions([{ id: 'a' }, { id: 'z', studentAlias: '다른학생' }]);
    mountHistory(); await importJson(backup([]));
    expect(allSessionIds()).toEqual(['a', 'z']);
    expect(qs('[data-flash]').textContent).toMatch(/불러오지 못했습니다/);
  });

  test('파일 안에서 id가 겹치면 먼저 나온 것만 들이고 알린다', async () => {
    mountHistory();
    await importJson(backup([
      sessionFixture({ id: 'b', level: 1 }),
      sessionFixture({ id: 'b', level: 3 }),
      sessionFixture({ id: 'c' }),
    ]));
    expect(allSessionIds()).toEqual(['b', 'c']);
    expect(allSessions().find((s) => s.id === 'b').level).toBe(1);
    expect(qs('[data-flash]').textContent).toMatch(/파일 안에서 같은 번호/);
  });

  test('기존 회차와 id가 같으면 기존 것을 유지하고, 건너뛴 수를 알린다', async () => {
    seedSessions([{ id: 'a', studentAlias: '원래학생', level: 1 }]);
    mountHistory();
    await importJson(backup([
      sessionFixture({ id: 'a', studentAlias: '바뀐학생', level: 3 }),
      sessionFixture({ id: 'b' }),
    ]));
    const kept = allSessions().find((s) => s.id === 'a');
    expect(kept.studentAlias).toBe('원래학생');
    expect(kept.level).toBe(1);
    expect(allSessionIds()).toEqual(['a', 'b']);
    expect(listStudents()).not.toContain('바뀐학생');
    expect(qs('[data-flash]').textContent).toMatch(/이미 저장된 회차와 같은 번호/);
    expect(qs('[data-flash]').textContent).toMatch(/1회차를 가져왔습니다/);
  });

  test('전부 이미 있는 회차면 새로 가져온 것이 없다고 알리고 저장소를 다시 쓰지 않는다', async () => {
    seedSessions([{ id: 'a' }]);
    const stored = allSessions()[0];
    const before = readRaw();
    const setItem = vi.spyOn(memory, 'setItem');
    mountHistory(); await importJson(backup([stored]));
    expect(readRaw()).toBe(before);
    expect(setItem).not.toHaveBeenCalled();
    expect(qs('[data-flash]').textContent).toMatch(/새로 가져온 회차가 없습니다/);
  });

  test('합친 결과가 replaceAll의 유효성을 통과해 실제로 저장된다 (하나라도 틀리면 전체가 거부되므로)', async () => {
    seedSessions([{ id: 'a' }, { id: 'b', studentAlias: '둘째' }]);
    mountHistory();
    const odd = { ...sessionFixture({ id: 'p' }), studentAlias: '' }; // 빈 별칭도 문자열이다
    await importJson(backup([odd, null, { id: 'q' }, sessionFixture({ id: 'r', studentAlias: '셋째' })]));
    expect(allSessionIds()).toEqual(['a', 'b', 'p', 'r']);
    expect(qs('[data-flash]').textContent).not.toMatch(/저장하지 못했습니다/);
  });

  test('가져온 뒤 목록이 새 회차를 보여 주고, 펼쳐 둔 학생은 펼쳐진 채로 남는다', async () => {
    seedSessions([{ id: 'a', studentAlias: '가람' }]);
    mountHistory({ alias: '가람' });
    await importJson(backup([sessionFixture({ id: 'b', studentAlias: '하늘' })]));
    expect(row('b')).not.toBeNull();
    expect(qs('[data-student="가람"]').open).toBe(true);
  });

  test('저장이 실패하면(용량 초과) 기존 기록은 그대로이고 저장하지 못했다고 알린다', async () => {
    seedSessions([{ id: 'a' }]);
    const before = readRaw();
    mountHistory();
    memory.setItem = () => { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); };
    await importJson(backup([sessionFixture({ id: 'b' })]));
    expect(readRaw()).toBe(before);
    expect(qs('[data-flash]').textContent).toMatch(/저장하지 못했습니다/);
    expect(qs('[data-flash]').textContent).toMatch(/기존 기록은 그대로/);
  });

  test('화면을 연 뒤 저장소가 읽을 수 없게 되었다면 가져오기가 그것을 덮어쓰지 않는다', async () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    memory.setItem(STORAGE_KEY, '{ broken after mount');
    await importJson(backup([sessionFixture({ id: 'b' })]));
    expect(readRaw()).toBe('{ broken after mount');
    expect(qs('[data-flash]').textContent).toMatch(/읽을 수 없/);
  });

  test('파일을 고르지 않고 닫아도(files가 비어도) 아무 일도 없다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    const input = qs('[data-import-input]');
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    expect(() => input.dispatchEvent(new Event('change', { bubbles: true }))).not.toThrow();
    expect(qs('[data-flash]')).toBeNull();
  });

  test('같은 파일을 다시 고를 수 있도록 입력값을 비운다', async () => {
    mountHistory();
    await importJson(backup([sessionFixture({ id: 'b' })]));
    expect(qs('[data-import-input]').value).toBe('');
  });

  test('가져오기 버튼은 click으로 숨은 파일 입력을 연다', () => {
    mountHistory();
    const input = qs('[data-import-input]');
    const open = vi.spyOn(input, 'click').mockImplementation(() => {});
    click(qs('[data-action="import"]'));
    expect(open).toHaveBeenCalledTimes(1);
  });

  test('파일을 읽는 도중 화면을 떠나면 그 뒤에 저장하지 않는다', async () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    const input = qs('[data-import-input]');
    Object.defineProperty(input, 'files', { value: [new File([backup([sessionFixture({ id: 'b' })])], 'b.json')], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
    screen.unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(allSessionIds()).toEqual(['a']);
  });
});

// ============================================================================================
// 읽을 수 없는 저장소 — 이 화면이 유일한 탈출구다
// ============================================================================================
describe('읽을 수 없는 저장소', () => {
  const GARBLED = '{ "schemaVersion": 1, "sessions": [ {"id": "a", "studentAlias": "철수" ';

  test('storageStatus가 읽을 수 있는 상태와 없는 상태를 가른다', () => {
    expect(storageStatus().status).toBe('empty');
    seedSessions([{ id: 'a' }]);
    expect(storageStatus().status).toBe('ok');
    memory.setItem(STORAGE_KEY, GARBLED);
    expect(storageStatus().status).toBe('unreadable');
    expect(typeof storageStatus().error).toBe('string');
  });

  test('읽을 수 없다는 사실을 알리고, 지우지 말라고 하고, 원본 내려받기를 권한다', () => {
    memory.setItem(STORAGE_KEY, GARBLED);
    mountHistory();
    const box = qs('[data-notice="unreadable"]');
    expect(box).not.toBeNull();
    expect(box.textContent).toMatch(/읽을 수 없습니다/);
    expect(box.textContent).toMatch(/지우지 마세요/);
    expect(box.textContent).toMatch(/원본/);
    expect(qs('[data-export="raw"]')).not.toBeNull();
  });

  test('원본 내려받기는 저장된 바이트를 그대로 준다 (파싱도 BOM도 없이)', async () => {
    memory.setItem(STORAGE_KEY, GARBLED);
    mountHistory();
    click(qs('[data-export="raw"]'));
    expect(blobs).toHaveLength(1);
    const bytes = await readBytes(blobs[0]);
    expect(new TextDecoder().decode(bytes)).toBe(GARBLED);
    expect(bytes[0]).toBe(GARBLED.charCodeAt(0));
    expect(downloads).toHaveLength(1);
    expect(downloads[0].download).not.toBe('');
  });

  test('읽을 수 없는 상태에서는 파싱된 내보내기와 가져오기를 내놓지 않는다 (빈 파일을 백업이라고 믿게 하지 않으려고)', () => {
    memory.setItem(STORAGE_KEY, GARBLED);
    mountHistory();
    expect(qs('[data-export="csv"]')).toBeNull();
    expect(qs('[data-export="json"]')).toBeNull();
    expect(qs('[data-import-input]')).toBeNull();
    expect(qs('[data-action="import"]')).toBeNull();
  });

  test('손상된 레코드가 하나 섞인 저장소도 같은 길로 꺼낼 수 있다', async () => {
    const corrupt = JSON.stringify({ schemaVersion: 1, sessions: [{ id: 'ok', studentAlias: 'x', startedAt: 1 }, { id: '' }], lastSetup: null });
    memory.setItem(STORAGE_KEY, corrupt);
    mountHistory();
    expect(qs('[data-notice="unreadable"]')).not.toBeNull();
    click(qs('[data-export="raw"]'));
    expect(new TextDecoder().decode(await readBytes(blobs[0]))).toBe(corrupt);
  });

  test('저장된 값이 빈 문자열("")이어도 읽을 수 없음으로 알리고 원본 내려받기를 준다 (truthiness로 검사하면 놓친다)', () => {
    memory.setItem(STORAGE_KEY, '');
    expect(readRaw()).toBe('');
    mountHistory();
    expect(qs('[data-notice="unreadable"]')).not.toBeNull();
    expect(qs('[data-export="raw"]')).not.toBeNull();
    click(qs('[data-export="raw"]'));
    expect(blobs).toHaveLength(1);
    expect(blobs[0].size).toBe(0);
    expect(qs('[data-notice="unreadable"]').textContent).toMatch(/비어 있/);
  });

  test('오류 원문은 접어서 보여 준다 (문의할 때 필요하므로)', () => {
    memory.setItem(STORAGE_KEY, GARBLED);
    mountHistory();
    expect(qs('[data-notice="unreadable"] details').textContent).toContain(storageStatus().error);
  });

  test('저장소에 아예 접근할 수 없으면 원본 내려받기는 내놓지 않고(줄 것이 없다) 그 사실을 알린다', () => {
    const fail = () => { throw new DOMException('The operation is insecure.', 'SecurityError'); };
    setStorage({ getItem: fail, setItem: fail, removeItem: fail });
    expect(() => mountHistory()).not.toThrow();
    expect(qs('[data-notice="inaccessible"]')).not.toBeNull();
    expect(qs('[data-export="raw"]')).toBeNull();
    expect(qs('[data-action="reset"]')).toBeNull();
  });

  test('초기화(replaceAll([]))가 읽을 수 없는 데이터를 비우고 나면 다시 정상 화면이 되고 새 회차를 저장할 수 있다', () => {
    memory.setItem(STORAGE_KEY, GARBLED);
    mountHistory();
    click(qs('[data-action="reset"]'));
    type(qs('[data-reset-input]'), '지우기');
    click(qs('[data-action="reset-confirm"]'));
    expect(storageStatus().status).toBe('ok');
    expect(allSessionIds()).toEqual([]);
    expect(qs('[data-notice="unreadable"]')).toBeNull();
    expect(saveSession(sessionFixture({ id: 'new' })).ok).toBe(true);
  });

  test('읽을 수 없는 상태의 초기화 확인 글에는 원본을 먼저 받으라는 경고가 있다', () => {
    memory.setItem(STORAGE_KEY, GARBLED);
    mountHistory();
    click(qs('[data-action="reset"]'));
    expect(qs('[data-reset-panel]').textContent).toMatch(/원본/);
    expect(qs('[data-reset-panel]').textContent).toMatch(/되돌릴 수 없습니다/);
  });

  test('PIN이 켜져 있으면 원본 내려받기도 잠금 뒤에 있다', () => {
    memory.setItem(STORAGE_KEY, GARBLED);
    setPin('1234');
    mountHistory();
    expect(qs('[data-export="raw"]')).toBeNull();
    expect(qs('[data-notice="unreadable"]')).toBeNull();
  });
});

// ============================================================================================
// 초기화
// ============================================================================================
describe('초기화', () => {
  test('처음 누르면 확인 패널만 열리고 아무것도 지워지지 않는다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    expect(qs('[data-reset-panel]')).toBeNull();
    click(qs('[data-action="reset"]'));
    expect(qs('[data-reset-panel]')).not.toBeNull();
    expect(allSessionIds()).toEqual(['a']);
  });

  test('확인 글에 지울 회차 수와 되돌릴 수 없다는 말, 백업을 먼저 받으라는 말이 있다', () => {
    seedSessions([{ id: 'a' }, { id: 'b' }]);
    mountHistory();
    click(qs('[data-action="reset"]'));
    const text = qs('[data-reset-panel]').textContent;
    expect(text).toContain('2회차');
    expect(text).toMatch(/되돌릴 수 없습니다/);
    expect(text).toMatch(/백업/);
    expect(text).toContain("'지우기'");
  });

  test('확인 단어를 입력하기 전에는 확인 버튼이 꺼져 있고, 눌러도 지워지지 않는다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-action="reset"]'));
    const confirm = qs('[data-action="reset-confirm"]');
    expect(confirm.disabled).toBe(true);
    click(confirm);
    expect(allSessionIds()).toEqual(['a']);
  });

  test('disabled를 풀어서 눌러도 확인 단어가 맞지 않으면 지워지지 않는다 (절차를 건너뛸 수 없다)', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-action="reset"]'));
    const confirm = qs('[data-action="reset-confirm"]');
    confirm.disabled = false;
    click(confirm);
    expect(allSessionIds()).toEqual(['a']);
    type(qs('[data-reset-input]'), '지우');
    confirm.disabled = false;
    click(confirm);
    expect(allSessionIds()).toEqual(['a']);
  });

  test('단어가 틀리면 확인 버튼이 꺼진 채이고, 맞으면 켜진다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-action="reset"]'));
    type(qs('[data-reset-input]'), '아니오');
    expect(qs('[data-action="reset-confirm"]').disabled).toBe(true);
    type(qs('[data-reset-input]'), '지우기');
    expect(qs('[data-action="reset-confirm"]').disabled).toBe(false);
  });

  test('단어를 입력하는 동안 입력란이 다시 그려지지 않는다 (입력 중 포커스를 잃지 않는다)', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-action="reset"]'));
    const input = qs('[data-reset-input]');
    type(input, '지');
    expect(qs('[data-reset-input]')).toBe(input);
  });

  test('올바른 단어 뒤 확인을 누르면 모든 기록이 지워지고 안내가 뜬다', () => {
    seedSessions([{ id: 'a' }, { id: 'b', studentAlias: '다른학생' }]);
    mountHistory();
    click(qs('[data-action="reset"]'));
    type(qs('[data-reset-input]'), '지우기');
    click(qs('[data-action="reset-confirm"]'));
    expect(allSessionIds()).toEqual([]);
    expect(qs('[data-session-row]')).toBeNull();
    expect(qs('[data-flash]').textContent).toMatch(/모든 기록을 지웠습니다/);
    expect(qs('[data-reset-panel]')).toBeNull();
  });

  test('앞뒤 공백은 봐 준다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-action="reset"]'));
    type(qs('[data-reset-input]'), ' 지우기 ');
    click(qs('[data-action="reset-confirm"]'));
    expect(allSessionIds()).toEqual([]);
  });

  test('취소하면 패널이 닫히고 기록은 그대로이며, 다시 열면 입력이 비어 있다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    click(qs('[data-action="reset"]'));
    type(qs('[data-reset-input]'), '지우기');
    click(qs('[data-action="reset-cancel"]'));
    expect(qs('[data-reset-panel]')).toBeNull();
    expect(allSessionIds()).toEqual(['a']);
    click(qs('[data-action="reset"]'));
    expect(qs('[data-reset-input]').value).toBe('');
  });

  test('지우기에 실패하면 지웠다고 하지 않고 실패를 알린다', () => {
    seedSessions([{ id: 'a' }]);
    mountHistory();
    memory.setItem = () => { throw new DOMException('denied', 'SecurityError'); };
    click(qs('[data-action="reset"]'));
    type(qs('[data-reset-input]'), '지우기');
    click(qs('[data-action="reset-confirm"]'));
    expect(qs('[data-flash]').textContent).toMatch(/지우지 못했습니다/);
    expect(qs('[data-flash]').textContent).not.toMatch(/지웠습니다/);
    expect(allSessionIds()).toEqual(['a']);
  });

  test('초기화는 PIN 설정을 건드리지 않는다', () => {
    seedSessions([{ id: 'a' }]);
    setPin('1234');
    mountHistory();
    type(qs('[data-pin-input]'), '1234');
    click(qs('[data-action="unlock"]'));
    click(qs('[data-action="reset"]'));
    type(qs('[data-reset-input]'), '지우기');
    click(qs('[data-action="reset-confirm"]'));
    expect(allSessionIds()).toEqual([]);
    expect(isEnabled()).toBe(true);
  });

  test('기록이 하나도 없으면 초기화 버튼을 내놓지 않는다', () => {
    mountHistory();
    expect(qs('[data-action="reset"]')).toBeNull();
  });
});

// ============================================================================================
// PIN
// ============================================================================================
describe('PIN 잠금', () => {
  test('잠겨 있으면 학생 별칭·회차·내보내기·가져오기·초기화가 DOM에 아예 없다 (CSS로 숨기면 읽힌다)', () => {
    seedSessions([{ id: 'a', studentAlias: '비밀이름' }]);
    setPin('1234');
    mountHistory();
    expect(document.body.textContent).not.toContain('비밀이름');
    expect(qs('[data-session-row]')).toBeNull();
    expect(qs('[data-student]')).toBeNull();
    expect(qs('[data-export]')).toBeNull();
    expect(qs('[data-import-input]')).toBeNull();
    expect(qs('[data-action="reset"]')).toBeNull();
    expect(qs('[data-pin-settings]')).toBeNull();
  });

  test('잠금 화면에는 기록 수 같은 단서도 없다', () => {
    seedSessions([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    setPin('1234');
    mountHistory();
    expect(qs('[data-pin-gate]').textContent).not.toMatch(/\d+회차/);
  });

  test('틀린 PIN은 열지 못하고 알리며 입력을 비운다', () => {
    seedSessions([{ id: 'a' }]);
    setPin('1234');
    mountHistory();
    type(qs('[data-pin-input]'), '9999');
    click(qs('[data-action="unlock"]'));
    expect(qs('[data-pin-gate]')).not.toBeNull();
    expect(qs('[data-pin-error]').textContent).toMatch(/PIN이 맞지 않습니다/);
    expect(qs('[data-pin-input]').value).toBe('');
    expect(qs('[data-session-row]')).toBeNull();
  });

  test('맞는 PIN을 click하면 목록이 열리고 잠금 화면은 사라진다', () => {
    seedSessions([{ id: 'a' }]);
    setPin('1234');
    mountHistory();
    type(qs('[data-pin-input]'), '1234');
    click(qs('[data-action="unlock"]'));
    expect(qs('[data-pin-gate]')).toBeNull();
    expect(row('a')).not.toBeNull();
  });

  test('입력란에서 Enter(폼 제출)로도 열린다', () => {
    seedSessions([{ id: 'a' }]);
    setPin('1234');
    mountHistory();
    type(qs('[data-pin-input]'), '1234');
    qs('[data-pin-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(row('a')).not.toBeNull();
  });

  test('빈 값은 열지 못한다', () => {
    seedSessions([{ id: 'a' }]);
    setPin('1234');
    mountHistory();
    click(qs('[data-action="unlock"]'));
    expect(qs('[data-pin-gate]')).not.toBeNull();
  });

  test('잠금 화면에서도 돌아가기가 된다', () => {
    setPin('1234');
    const { onBack } = mountHistory();
    click(qs('[data-action="back"]'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('잠금 화면 안내가 PIN을 잊었을 때의 두 경우(백업이 있을 때, 없을 때)를 모두 말한다', () => {
    setPin('1234');
    mountHistory();
    const text = qs('[data-pin-forgot]').textContent;
    expect(text).toMatch(/이 앱에서는 기록을 열 수 없습니다/);
    expect(text).toMatch(/사이트의 데이터를 지우는 것/);
    // 백업이 있는 경우: 지운 뒤 가져오기로 복원
    expect(text).toMatch(/백업\(JSON\) 파일이 있다면/);
    expect(text).toMatch(/백업 파일 가져오기/);
    // 백업이 없는 경우: 지우면 사라진다
    expect(text).toMatch(/백업이 없다면 사이트 데이터를 지우지 마세요/);
    expect(text).toMatch(/모두 사라집니다/);
  });

  test('잠금 화면 안내는 잠금 뒤의 내용(회차 수 등)을 드러내지 않는다', () => {
    seedSessions([{ id: 'a' }]);
    setPin('1234');
    mountHistory();
    expect(qs('[data-pin-forgot]').textContent).not.toMatch(/\d+회차/);
    expect(qs('[data-pin-gate] [data-export]')).toBeNull();
  });

  test('결과 화면에 다녀와 다시 마운트해도 같은 화면 인스턴스는 열린 채이고, 돌아가기로 나가면 다시 잠긴다', () => {
    seedSessions([{ id: 'a' }]);
    setPin('1234');
    const instance = createHistoryScreen({});
    mountHistory({ screenInstance: instance });
    type(qs('[data-pin-input]'), '1234');
    click(qs('[data-action="unlock"]'));
    instance.unmount();
    document.body.replaceChildren();

    const second = mountHistory({ screenInstance: instance }); // 결과를 보고 돌아온 경우
    expect(qs('[data-pin-gate]')).toBeNull();
    expect(row('a')).not.toBeNull();

    click(qs('[data-action="back"]')); // 설정 화면으로 나감
    expect(second.onBack).toHaveBeenCalledTimes(1);
    instance.unmount();
    document.body.replaceChildren();
    mountHistory({ screenInstance: instance });
    expect(qs('[data-pin-gate]')).not.toBeNull();
  });

  test('새 화면 인스턴스는 항상 잠긴 채 시작한다', () => {
    setPin('1234');
    mountHistory();
    expect(qs('[data-pin-gate]')).not.toBeNull();
  });

  describe('PIN 켜기·끄기', () => {
    test('꺼져 있을 때 4자리를 저장하면 켜지고 안내가 뜬다', () => {
      mountHistory();
      type(qs('[data-pin-set-input]'), '4321');
      click(qs('[data-action="pin-save"]'));
      expect(isEnabled()).toBe(true);
      expect(verify('4321')).toBe(true);
      expect(qs('[data-flash]').textContent).toMatch(/PIN 잠금을 켰습니다/);
    });

    test('4자리 숫자가 아니면 저장하지 않고 알린다', () => {
      mountHistory();
      for (const bad of ['123', '12345', 'abcd', '']) {
        type(qs('[data-pin-set-input]'), bad);
        click(qs('[data-action="pin-save"]'));
        expect(isEnabled()).toBe(false);
        expect(qs('[data-pin-set-error]').textContent).toMatch(/숫자 4자리/);
      }
    });

    test('켜져 있으면 끄기가 있고, 누르면 꺼진다', () => {
      setPin('1234');
      mountHistory();
      type(qs('[data-pin-input]'), '1234');
      click(qs('[data-action="unlock"]'));
      click(qs('[data-action="pin-off"]'));
      expect(isEnabled()).toBe(false);
      expect(qs('[data-flash]').textContent).toMatch(/PIN 잠금을 껐습니다/);
      expect(qs('[data-action="pin-off"]')).toBeNull();
    });

    test('꺼져 있을 때는 끄기 버튼이 없다', () => {
      mountHistory();
      expect(qs('[data-action="pin-off"]')).toBeNull();
    });

    test('저장이 막힌 기기에서는 켜지지 않았다고 알린다 (켜졌다고 거짓말하지 않는다)', () => {
      mountHistory();
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
      type(qs('[data-pin-set-input]'), '4321');
      expect(() => click(qs('[data-action="pin-save"]'))).not.toThrow();
      expect(isEnabled()).toBe(false);
      expect(qs('[data-flash]').textContent).toMatch(/PIN을 저장할 수 없습니다/);
      expect(qs('[data-flash]').textContent).not.toMatch(/켰습니다/);
    });

    test('PIN 안내가 보안 장치가 아니라는 것을 밝힌다', () => {
      mountHistory();
      expect(qs('[data-pin-settings]').textContent).toMatch(/보안 장치가 아닙니다/);
    });

    test('PIN을 켜기 전에(켜는 화면에) 잊었을 때의 경고 세 가지가 이미 보인다', () => {
      seedSessions([{ id: 'a' }]);
      mountHistory();
      expect(isEnabled()).toBe(false);
      const text = qs('[data-pin-settings] [data-pin-warning]').textContent;
      expect(text).toMatch(/PIN을 잊으면 이 앱에서는 기록을 열 수 없습니다/);
      expect(text).toMatch(/브라우저 설정에서 이 사이트의 데이터를 지우는 것/);
      expect(text).toMatch(/기록도 함께 사라집니다/);
      expect(text).toMatch(/PIN을 켜기 전에 백업\(JSON\)을 먼저 내려받아 두기를 권합니다/);
    });

    test('경고는 PIN이 켜져 있어 바꿀 때도 보인다', () => {
      setPin('1234');
      mountHistory();
      type(qs('[data-pin-input]'), '1234');
      click(qs('[data-action="unlock"]'));
      expect(qs('[data-pin-warning]')).not.toBeNull();
    });

    test('PIN 켜기 화면에서 바로 JSON 백업을 내려받을 수 있다 (모든 회차가 담긴 복원용 파일)', async () => {
      seedSessions([{ id: 'a' }, { id: 'b', studentAlias: '둘째' }]);
      mountHistory();
      const backupButton = qs('[data-pin-warning] [data-export="json"]');
      expect(backupButton).not.toBeNull();
      expect(backupButton.disabled).toBe(false);
      click(backupButton);
      expect(blobs).toHaveLength(1);
      const parsed = parseBackupJson(new TextDecoder().decode(await readBytes(blobs[0])));
      expect(parsed.sessions.map((s) => s.id).sort()).toEqual(['a', 'b']);
      expect(downloads[0].download).toMatch(/backup.*.json$/);
    });

    test('받을 기록이 없으면 그 버튼은 눌 수 없고 이유를 말한다', () => {
      mountHistory();
      expect(qs('[data-pin-warning] [data-export="json"]').disabled).toBe(true);
      expect(qs('[data-pin-warning]').textContent).toMatch(/받을 백업이 없습니다/);
    });

    test('읽을 수 없는 저장소에서는 그 자리의 버튼이 원본 내려받기이고, JSON 백업 버튼은 없다', async () => {
      memory.setItem(STORAGE_KEY, '{ broken');
      mountHistory();
      expect(qs('[data-pin-warning] [data-export="json"]')).toBeNull();
      click(qs('[data-pin-warning] [data-export="raw"]'));
      expect(new TextDecoder().decode(await readBytes(blobs[0]))).toBe('{ broken');
    });

    test('켠 뒤 안내도 잊으면 기록을 열 수 없다는 것과 백업 없이 지우지 말라는 것을 말한다', () => {
      mountHistory();
      type(qs('[data-pin-set-input]'), '4321');
      click(qs('[data-action="pin-save"]'));
      const text = qs('[data-flash]').textContent;
      expect(text).toMatch(/PIN을 잊으면 이 앱에서는 기록을 열 수 없습니다/);
      expect(text).toMatch(/백업\(JSON\)을 받아 두지 않았다면/);
    });
  });
});

// ============================================================================================
// 정리
// ============================================================================================
describe('unmount', () => {
  test('unmount 뒤에는 남은 DOM을 눌러도 아무것도 부르지 않는다 (리스너가 걷힌다)', () => {
    seedSessions([{ id: 'a' }]);
    const { onOpenSession, onBack } = mountHistory();
    const rowEl = row('a');
    const backEl = qs('[data-action="back"]');
    const csv = qs('[data-export="csv"]');
    screen.unmount();
    click(rowEl); click(backEl); click(csv);
    expect(onOpenSession).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
    expect(blobs).toHaveLength(0);
  });

  test('unmount는 두 번 불러도, 마운트 전에 불러도 던지지 않는다', () => {
    const fresh = createHistoryScreen({});
    expect(() => fresh.unmount()).not.toThrow();
    mountHistory();
    expect(() => { screen.unmount(); screen.unmount(); }).not.toThrow();
  });

  test('다시 마운트하면 이전 마운트의 리스너가 남지 않는다', () => {
    seedSessions([{ id: 'a' }]);
    const first = mountHistory();
    const oldRow = row('a');
    const second = mountHistory({ screenInstance: screen }); // 라우터와 달리 이 하네스는 이전 DOM을 치우지 않는다
    click(oldRow);
    expect(first.onOpenSession).not.toHaveBeenCalled();
    expect(second.onOpenSession).not.toHaveBeenCalled();
    click(qsa('[data-session-row="a"]')[1]);
    expect(second.onOpenSession).toHaveBeenCalledTimes(1);
  });
});

// ============================================================================================
// 저장소를 읽는 횟수 (성능)
// 저장소의 읽기 함수는 부를 때마다 getItem + JSON.parse + 전체 검증을 새로 한다. 학생별로 listSessions를 부르면 학생이 N명일 때
// 한 번 그릴 때 2N + 3번 파싱했고, 다시 그릴 때마다(안내, PIN, 초기화 열기/취소) 되풀이했다. 이 화면은 백업을 받는 곳이라
// 탭마다 느리면 쓰이지 않는다. 그리는 동안은 한 번만 읽는다 — 학생이 몇 명이든 같은 횟수여야 한다.
// ============================================================================================
describe('저장소를 읽는 횟수는 학생 수와 무관하다', () => {
  const seedStudents = (n, perStudent = 3) => {
    const list = [];
    for (let s = 0; s < n; s += 1) for (let k = 0; k < perStudent; k += 1) list.push({ studentAlias: `학생${String(s).padStart(2, '0')}`, level: 1 + (k % 3) });
    seedSessions(list);
  };
  const countParses = (fn) => {
    const spy = vi.spyOn(JSON, 'parse');
    try { fn(); return spy.mock.calls.length; } finally { spy.mockRestore(); }
  };

  test('처음 그릴 때 한 번만 파싱한다 (학생 2명이든 20명이든)', () => {
    seedStudents(2);
    expect(countParses(() => mountHistory())).toBe(1);
    screen.unmount(); document.body.replaceChildren();
    memory = memoryStorage(); setStorage(memory);
    seedStudents(20);
    expect(countParses(() => mountHistory())).toBe(1);
    expect(qsa('[data-student]')).toHaveLength(20);
  });

  test('다시 그릴 때마다(초기화 열기, 취소) 한 번만 파싱한다', () => {
    seedStudents(20);
    mountHistory();
    expect(countParses(() => click(qs('[data-action="reset"]')))).toBe(1);
    expect(qs('[data-reset-panel]')).not.toBeNull();
    expect(countParses(() => click(qs('[data-action="reset-cancel"]')))).toBe(1);
  });

  test('PIN을 켜고 끌 때(안내를 띄우며 다시 그린다)도 한 번만 파싱한다', () => {
    seedStudents(20);
    mountHistory();
    const input = qs('[data-pin-set-input]');
    input.value = '1234';
    expect(countParses(() => qs('[data-pin-set-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))).toBe(1);
    expect(isEnabled()).toBe(true);
    expect(countParses(() => click(qs('[data-action="pin-off"]')))).toBe(1);
  });

  test('회차 줄을 탭하면 한 번만 파싱한다', () => {
    seedStudents(20);
    const { onOpenSession } = mountHistory();
    const first = qs('[data-session-row]');
    expect(countParses(() => click(first))).toBe(1);
    expect(onOpenSession).toHaveBeenCalledTimes(1);
    expect(onOpenSession.mock.calls[0][0].id).toBe(first.dataset.sessionRow);
  });

  test('내보내기(JSON, CSV)도 저장소를 한 번만 읽는다', () => {
    seedStudents(20);
    mountHistory();
    expect(countParses(() => click(qs('[data-export="json"]')))).toBeLessThanOrEqual(2); // 읽기 1 + 안내를 다시 그리며 1
    expect(countParses(() => click(qs('[data-export="csv"]')))).toBeLessThanOrEqual(2);
    expect(downloads).toHaveLength(2);
  });

  test('읽을 수 없는 저장소를 그릴 때도 한 번만 시도한다', () => {
    memory.setItem(STORAGE_KEY, '{깨진');
    expect(countParses(() => mountHistory())).toBe(1);
    expect(qs('[data-notice="unreadable"]')).not.toBeNull();
  });

  test('한 번만 읽어도 화면의 내용은 같다: 학생 가나다순, 학생 안에서는 최근 회차가 먼저', () => {
    seedSessions([
      { id: 'b1', studentAlias: '하늘', startedAt: 1000 },
      { id: 'a1', studentAlias: '가람', startedAt: 2000 },
      { id: 'a2', studentAlias: '가람', startedAt: 3000 },
      { id: 'b2', studentAlias: '하늘', startedAt: 4000 },
    ]);
    mountHistory();
    expect(qsa('[data-student]').map((d) => d.dataset.student)).toEqual(['가람', '하늘']);
    expect(qsa('[data-student="가람"] [data-session-row]').map((r) => r.dataset.sessionRow)).toEqual(['a2', 'a1']);
    expect(qsa('[data-student="하늘"] [data-session-row]').map((r) => r.dataset.sessionRow)).toEqual(['b2', 'b1']);
  });
});
