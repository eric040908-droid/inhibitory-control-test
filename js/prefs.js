// 교사가 고르는 소리·애니메이션 설정의 보관.
//
// 회차 자료(storage.js)와 키를 따로 쓴다: 선택 저장이 회차 자료의 상태에 걸려 막히거나, 거꾸로 회차 자료를 건드리지 않게.
// 저장소가 막혀 있어도 던지지 않는다 — 이번 화면에서만 효과가 나고 다음에 유지되지 않을 뿐이다.
//
// 설정 화면이 읽고 쓰고, flow.js가 검사를 시작할 때 읽어 회차에 `settings`로 함께 남긴다(스펙 §5.9의 측정 조건 —
// 교사가 탭 한 번으로 바꿀 수 있는 조건이라 같은 학생·같은 기기의 회차 간 비교를 흔들 수 있다).
export const PREFS_KEY = 'inhibitoryControlTest.prefs';
export const DEFAULT_PREFS = { sound: true, reducedMotion: false };

export function readPrefs() {
  try {
    const parsed = JSON.parse(globalThis.localStorage.getItem(PREFS_KEY));
    const prefs = { ...DEFAULT_PREFS };
    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.sound === 'boolean') prefs.sound = parsed.sound;
      if (typeof parsed.reducedMotion === 'boolean') prefs.reducedMotion = parsed.reducedMotion;
    }
    return prefs;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(prefs) {
  try {
    globalThis.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 저장 못 해도 이번 화면의 선택은 이미 반영됐다.
  }
}
