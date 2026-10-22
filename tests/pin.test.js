// @vitest-environment jsdom
// PIN은 보안 장치가 아니라 우연한 열람을 막는 장치다 (js/pin.js의 주석 참고). 그래서 여기서 고정하는 것은
// "기본 꺼짐", "맞는 값만 통과", "끄기", 그리고 "저장이 막힌 기기에서도 던지지 않는다"이다.
import { isEnabled, setPin, verify, PIN_KEY } from '../js/pin.js';

beforeEach(() => { localStorage.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

// ---- 계획서의 테스트 (원문 그대로) ----------------------------------------------------------
test('PIN은 기본으로 꺼져 있다', () => { expect(isEnabled()).toBe(false); });
test('PIN을 설정하면 켜지고 맞는 값만 통과한다', () => {
  setPin('1234');
  expect(isEnabled()).toBe(true);
  expect(verify('1234')).toBe(true); expect(verify('9999')).toBe(false);
});
test('PIN을 null로 설정하면 꺼진다', () => { setPin('1234'); setPin(null); expect(isEnabled()).toBe(false); });

// ---- 경계 -------------------------------------------------------------------------------
describe('경계', () => {
  test('꺼져 있을 때 verify는 어떤 값도 통과시키지 않는다 (빈 값 포함)', () => {
    expect(verify('')).toBe(false);
    expect(verify('0000')).toBe(false);
    expect(verify(undefined)).toBe(false);
  });

  test('문자열이 아닌 값은 통과하지 않는다 (숫자 1234는 "1234"가 아니다)', () => {
    setPin('1234');
    expect(verify(1234)).toBe(false);
    expect(verify(null)).toBe(false);
    expect(verify(undefined)).toBe(false);
  });

  test('앞뒤 공백이 있거나 자릿수가 다르면 통과하지 않는다', () => {
    setPin('1234');
    expect(verify(' 1234')).toBe(false);
    expect(verify('12345')).toBe(false);
    expect(verify('123')).toBe(false);
    expect(verify('')).toBe(false);
  });

  test('앞자리가 0인 PIN도 문자열 그대로 비교한다', () => {
    setPin('0042');
    expect(isEnabled()).toBe(true);
    expect(verify('0042')).toBe(true);
    expect(verify('42')).toBe(false);
  });

  test('4자리 숫자가 아닌 값으로는 켜지지 않는다 (기존 설정도 그대로)', () => {
    for (const bad of ['123', '12345', 'abcd', '12a4', '', ' 123', 1234, undefined]) {
      setPin(bad);
      expect(isEnabled()).toBe(false);
    }
    setPin('1234');
    setPin('99');
    expect(verify('1234')).toBe(true);
  });

  test('PIN을 바꾸면 이전 값은 더 통과하지 않는다', () => {
    setPin('1234');
    setPin('5678');
    expect(verify('1234')).toBe(false);
    expect(verify('5678')).toBe(true);
  });

  test('끄고 나면 이전 PIN으로도 통과하지 않는다', () => {
    setPin('1234');
    setPin(null);
    expect(verify('1234')).toBe(false);
  });

  test('회차 자료와 다른 키에 저장한다 (회차 자료의 초기화·교체가 PIN을 건드리지 않는다)', () => {
    expect(PIN_KEY).not.toBe('inhibitoryControlTest');
    setPin('1234');
    expect(localStorage.getItem('inhibitoryControlTest')).toBeNull();
    expect(localStorage.getItem(PIN_KEY)).not.toBeNull();
  });

  test('저장된 값이 4자리 숫자가 아니면 꺼진 것으로 본다 (엉뚱한 값으로 화면이 잠기지 않는다)', () => {
    localStorage.setItem(PIN_KEY, 'garbage');
    expect(isEnabled()).toBe(false);
    expect(verify('garbage')).toBe(false);
  });

  describe('저장이 막힌 기기 (시크릿 모드·차단)', () => {
    test('localStorage 접근 자체가 던지면 아무 함수도 던지지 않고 꺼진 것으로 본다', () => {
      vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('insecure', 'SecurityError'); });
      expect(() => isEnabled()).not.toThrow();
      expect(() => setPin('1234')).not.toThrow();
      expect(() => setPin(null)).not.toThrow();
      expect(() => verify('1234')).not.toThrow();
      expect(isEnabled()).toBe(false);
      expect(verify('1234')).toBe(false);
    });

    test('getItem/setItem/removeItem이 던져도 아무 함수도 던지지 않는다', () => {
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
      vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new DOMException('denied', 'SecurityError'); });
      expect(() => setPin('1234')).not.toThrow();
      expect(() => setPin(null)).not.toThrow();
      expect(() => isEnabled()).not.toThrow();
      expect(() => verify('1234')).not.toThrow();
      expect(isEnabled()).toBe(false);
    });

    test('쓰기만 막혔을 때 setPin은 던지지 않고, 켜지지도 않는다', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
      expect(() => setPin('1234')).not.toThrow();
      expect(isEnabled()).toBe(false);
    });
  });
});
