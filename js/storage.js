// 회차 저장. 결과는 이 기기의 localStorage에만 남기고 어디로도 보내지 않는다.
//
// 가장 중요한 규칙: 저장소가 막혀 있거나 가득 차도 검사는 끝까지 진행되고 결과 화면은 보여야 한다.
// 그래서 이 모듈의 모든 localStorage 접근은 try/catch로 감싸고, 던지는 대신 { ok: false, error }(쓰기)나
// 빈 결과(읽기)를 돌려준다. 저장이 실패했다는 사실을 교사에게 알리는 것은 호출한 화면의 몫이다.
//
// 저장 모양: 단일 키 하나에 JSON { schemaVersion, sessions: Session[], lastSetup }.
// 회차마다 지표가 아니라 문항 단위 원자료(responses)를 둔다 — 지표 정의가 바뀌어도 과거 회차를 다시 계산할 수 있게 하려는 것이다.
import { TOOL_VERSION } from './config.js';

export const STORAGE_KEY = 'inhibitoryControlTest';
export const SCHEMA_VERSION = 1;

// ---- 저장소 주입 ---------------------------------------------------------
// 기본은 실제 localStorage(처음 쓸 때 읽는다). 테스트는 setStorage로 getItem/setItem/removeItem을 가진 객체를 넣고,
// setStorage(null)로 기본 동작으로 되돌린다.
let injected = null;

export function setStorage(storage) {
  injected = storage;
}

// localStorage는 접근하는 것만으로 던질 수 있다(사생활 보호 모드, 차단된 쿠키). 없거나 막혔으면 null.
function currentStorage() {
  if (injected) return injected;
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function describeError(e) {
  const name = e && e.name ? e.name : '';
  const message = e && e.message ? e.message : '';
  return [name, message].filter(Boolean).join(': ') || 'storage error';
}

// 회차로 받아들일 수 있는 최소 모양. 읽기 함수들이 id·studentAlias·startedAt에 기대므로(찾기, 학생 목록, 정렬)
// 이 셋이 틀린 레코드가 하나라도 섞이면 화면 전체가 죽거나 추이 순서가 조용히 틀어진다.
// 특히 startedAt이 문자열 등이면 정렬 비교가 NaN이 되어 추이가 삽입 순서로 떨어진다 — 오류 없이 그래프가 오독된다.
function validationError(session) {
  if (session === null || typeof session !== 'object' || Array.isArray(session)) return 'session must be an object';
  if (typeof session.id !== 'string' || session.id === '') return 'session.id must be a non-empty string';
  if (typeof session.studentAlias !== 'string') return 'session.studentAlias must be a string';
  if (typeof session.startedAt !== 'number' || !Number.isFinite(session.startedAt)) return 'session.startedAt must be a finite number';
  return null;
}

// ---- 읽기/쓰기 기초 --------------------------------------------------------
// readState는 던지지 않고 상태를 돌려준다.
//   { status: 'ok', data }       읽었고 모양이 맞다
//   { status: 'empty' }          아직 아무것도 저장된 적 없다
//   { status: 'unreadable', error }  깨진 JSON, 모르는 모양, 다른 스키마 버전, 저장소 접근 불가
function readState() {
  const storage = currentStorage();
  if (!storage) return { status: 'unreadable', error: 'localStorage unavailable' };

  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (e) {
    return { status: 'unreadable', error: describeError(e) };
  }
  if (raw === null || raw === undefined) return { status: 'empty' };

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { status: 'unreadable', error: 'stored data is not valid JSON' };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.sessions)) {
    return { status: 'unreadable', error: 'stored data has an unknown shape' };
  }
  // 원소를 걸러내 읽지 않고, 하나라도 틀리면 전체를 읽을 수 없음으로 본다: 걸러 읽은 상태에서 저장하면
  // 걸러진 레코드가 조용히 지워지는데, 손상된 자료는 복구할 수 있을 수 있다. (깨진 JSON과 같은 정책)
  const badAt = data.sessions.findIndex((s) => validationError(s) !== null);
  if (badAt >= 0) {
    return { status: 'unreadable', error: `stored sessions[${badAt}] is invalid: ${validationError(data.sessions[badAt])}` };
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    return { status: 'unreadable', error: `stored data has schema version ${data.schemaVersion}, expected ${SCHEMA_VERSION}` };
  }
  return { status: 'ok', data };
}

// 읽을 수 있을 때만 내용을, 아니면 빈 상태를 돌려준다. 읽기 함수들이 쓴다.
function readData() {
  const state = readState();
  return state.status === 'ok' ? state.data : { schemaVersion: SCHEMA_VERSION, sessions: [], lastSetup: null };
}

function writeData(data) {
  const storage = currentStorage();
  if (!storage) return { ok: false, error: 'localStorage unavailable' };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: describeError(e) };
  }
}

// 읽고 → 고치고 → 쓴다. 이미 저장된 내용이 읽을 수 없는 상태이면 덮어쓰지 않고 실패로 돌려준다:
// 깨졌거나 다른 버전의 자료는 복구·이전이 가능할 수 있는데, 새 회차 하나를 위해 그것을 지우면 안 된다.
function update(mutate) {
  const state = readState();
  if (state.status === 'unreadable') return { ok: false, error: state.error };
  const data = state.status === 'ok' ? state.data : { schemaVersion: SCHEMA_VERSION, sessions: [], lastSetup: null };
  mutate(data);
  return writeData(data);
}

// ---- 공개 함수 -------------------------------------------------------------
// 저장소를 실제로 쓸 수 있는지 확인한다(쓰고 지워 본다). 탐침 키는 남기지 않는다.
export function isAvailable() {
  const storage = currentStorage();
  if (!storage) return false;
  const probe = `${STORAGE_KEY}.probe`;
  try {
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

// 같은 id가 이미 있으면 교체한다(검사 도중 저장 후 완료 저장처럼 같은 회차를 두 번 저장할 수 있다).
// toolVersion은 항상 지금의 TOOL_VERSION으로 찍는다 — 호출한 쪽이 빠뜨려도 모든 회차에 남도록.
export function saveSession(session) {
  const invalid = validationError(session);
  if (invalid) return { ok: false, error: invalid };
  return update((data) => {
    const stamped = { ...session, toolVersion: TOOL_VERSION };
    const at = data.sessions.findIndex((s) => s.id === stamped.id);
    if (at >= 0) data.sessions[at] = stamped;
    else data.sessions.push(stamped);
  });
}

// 시작 시각 오름차순(오래된 회차가 먼저). 같으면 저장한 순서를 지킨다(Array.prototype.sort는 안정 정렬).
function byStartedAt(a, b) {
  return a.startedAt - b.startedAt;
}

// 가나다순 학생 별칭, 중복 없음.
export function listStudents() {
  const aliases = new Set(readData().sessions.map((s) => s.studentAlias));
  return [...aliases].sort((a, b) => a.localeCompare(b, 'ko'));
}

// 그 학생의 모든 회차(미완료 포함), 오래된 순.
export function listSessions(alias) {
  return readData().sessions.filter((s) => s.studentAlias === alias).sort(byStartedAt);
}

export function getSession(id) {
  return readData().sessions.find((s) => s.id === id) ?? null;
}

// 추이 그래프용: 그 학생의 같은 난이도 단계의 완료 회차만, 오래된 순.
// 중도 포기 회차를 넣으면 그래프가 아래로 꺾여 "나빠졌다"로 오독되고,
// 난이도가 다른 회차를 나란히 놓으면 쉬운 단계로 내려간 것과 좋아진 것이 구별되지 않는다.
export function trendSessions(alias, level) {
  return listSessions(alias).filter((s) => s.complete && s.level === level);
}

// 회차 목록을 통째로 바꾼다(가져오기·복원용). 지난 설정은 읽을 수 있으면 유지한다.
// 깨진 자료를 명시적으로 교체하는 경로이므로 읽을 수 없는 상태여도 쓴다. 가져온 회차의 toolVersion은 그대로 둔다.
export function replaceAll(sessions) {
  if (!Array.isArray(sessions)) return { ok: false, error: 'sessions must be an array' };
  // 가져오기 경로는 신뢰할 수 없는 JSON을 넘긴다. 일부만 걸러 넣으면 조용히 줄어드니, 하나라도 틀리면 통째로 거부한다.
  const badAt = sessions.findIndex((s) => validationError(s) !== null);
  if (badAt >= 0) return { ok: false, error: `sessions[${badAt}] is invalid: ${validationError(sessions[badAt])}` };
  const state = readState();
  const previous = state.status === 'ok' ? state.data.lastSetup ?? null : null;
  return writeData({ schemaVersion: SCHEMA_VERSION, sessions, lastSetup: previous });
}

// 다음 검사 설정 화면을 채울 지난 설정. 없거나 읽을 수 없으면 null.
export function lastSetup() {
  const setup = readData().lastSetup;
  return setup && typeof setup === 'object' ? setup : null;
}

// 실패해도 조용히 넘어간다: 편의 기능이라 이것 때문에 검사 흐름을 막을 이유가 없다.
export function saveLastSetup(setup) {
  update((data) => { data.lastSetup = setup; });
}
