// 이력 화면의 PIN 잠금.
//
// !! 이것은 보안 장치가 아니다. 학교 공용 기기를 여러 학생이 돌아가며 쓸 때, 검사받으러 온 학생이
//    다른 학생들의 이름과 과거 결과를 "우연히" 보지 않게 하는 문턱일 뿐이다.
//    - PIN은 평문으로 localStorage에 있다. 개발자 도구를 열 줄 아는 사람은 읽는다.
//    - 4자리 숫자라 시도 횟수 제한 없이도 금방 뚫린다. 일부러 제한을 두지 않았다 (과설계하지 않는다).
//    - 잠금은 이력 화면만 가린다. 저장된 자료 자체를 암호화하지 않는다.
//    진짜 접근 통제가 필요하면 기기를 교사가 관리하거나 기기 잠금을 써야 한다.
//
// 기본은 꺼짐이다. 단독으로 쓰는 기기에서 매번 PIN을 묻는 것은 "교사 개입 최소화" 원칙에 어긋난다.
//
// 이 모듈은 storage.js를 거치지 않고 localStorage를 직접 쓰므로 storage.js의 "던지지 않는다" 보장이
// 적용되지 않는다. 시크릿 모드·저장 차단 기기에서 접근 자체가 던질 수 있어 모든 접근을 try/catch로 감싼다.
// 저장이 막혀 있으면 PIN은 켜지지 않는다(isEnabled()는 false로 남는다) — 호출한 화면이 setPin 뒤에
// isEnabled()로 확인해 교사에게 알린다.
//
// 키는 회차 자료(inhibitoryControlTest)와 따로 쓴다: 초기화·가져오기가 PIN을 지우거나 바꾸지 않게,
// 그리고 PIN이 백업 파일에 섞여 나가지 않게.
export const PIN_KEY = 'inhibitoryControlTest.pin';

const PIN_PATTERN = /^\d{4}$/;

function read() {
  try {
    const value = globalThis.localStorage.getItem(PIN_KEY);
    return typeof value === 'string' && PIN_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function isEnabled() {
  return read() !== null;
}

// pin이 4자리 숫자 문자열이면 켜고(이미 켜져 있으면 바꾸고), null이면 끈다. 그 밖의 값은 아무것도 바꾸지 않는다.
export function setPin(pin) {
  try {
    if (pin === null) globalThis.localStorage.removeItem(PIN_KEY);
    else if (typeof pin === 'string' && PIN_PATTERN.test(pin)) globalThis.localStorage.setItem(PIN_KEY, pin);
  } catch {
    // 저장이 막힌 기기: 켜지지 않을 뿐이다.
  }
}

// 꺼져 있으면 어떤 값도 통과하지 않는다. 호출한 쪽은 isEnabled()가 true일 때만 묻는다.
export function verify(pin) {
  const stored = read();
  return stored !== null && typeof pin === 'string' && pin === stored;
}
