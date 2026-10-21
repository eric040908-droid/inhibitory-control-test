// 기본 환경(node) — Web Audio도 window도 없는 환경에서 던지지 않는지를 그대로 확인한다.
import * as audioModule from '../js/audio.js';
import { createAudio } from '../js/audio.js';

// 호출을 기록하는 가짜 AudioContext. 실제 소리는 나지 않는다.
function fakeAudioContextClass({ initialState = 'running' } = {}) {
  const instances = [];
  class FakeAudioContext {
    constructor() {
      this.state = initialState;
      this.currentTime = 10;
      this.destination = { kind: 'destination' };
      this.oscillators = [];
      this.buffers = 0;
      this.resume = vi.fn(() => { this.state = 'running'; return Promise.resolve(); });
      instances.push(this);
    }
    createOscillator() {
      const osc = {
        type: 'sine',
        frequency: { value: 0, setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      this.oscillators.push(osc);
      return osc;
    }
    createGain() {
      return {
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
    }
    createBuffer() { this.buffers += 1; return {}; }
    createBufferSource() { return { buffer: null, connect: vi.fn(), start: vi.fn() }; }
  }
  FakeAudioContext.instances = instances;
  return FakeAudioContext;
}

describe('공개 표면', () => {
  test('모듈 export는 정해진 목록뿐이다 — 오반응용 소리 함수가 없다', () => {
    expect(Object.keys(audioModule).sort()).toEqual(
      ['createAudio', 'playCorrect', 'playStimulus', 'setEnabled', 'unlock'],
    );
  });

  test('createAudio가 돌려주는 객체도 네 함수뿐이다', () => {
    const audio = createAudio({ AudioContext: fakeAudioContextClass() });
    expect(Object.keys(audio).sort()).toEqual(['playCorrect', 'playStimulus', 'setEnabled', 'unlock']);
    for (const fn of Object.values(audio)) expect(typeof fn).toBe('function');
  });

  test('모듈 수준 함수는 모두 함수다', () => {
    for (const name of ['unlock', 'playCorrect', 'playStimulus', 'setEnabled']) {
      expect(typeof audioModule[name]).toBe('function');
    }
  });
});

describe('실기기 정책: 첫 제스처 전에는 소리를 내지 않는다', () => {
  test('unlock() 전에 playCorrect()/playStimulus()를 불러도 던지지 않고 AudioContext도 만들지 않는다', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    expect(() => audio.playCorrect()).not.toThrow();
    expect(() => audio.playStimulus()).not.toThrow();
    expect(Ctx.instances).toHaveLength(0);
  });

  test('unlock()이 AudioContext를 만든다', () => {
    const Ctx = fakeAudioContextClass();
    createAudio({ AudioContext: Ctx }).unlock();
    expect(Ctx.instances).toHaveLength(1);
  });

  test('unlock()을 여러 번 불러도 AudioContext는 하나다', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock(); audio.unlock(); audio.unlock();
    expect(Ctx.instances).toHaveLength(1);
  });

  test('unlock()은 suspended 상태의 컨텍스트를 깨운다', () => {
    const Ctx = fakeAudioContextClass({ initialState: 'suspended' });
    createAudio({ AudioContext: Ctx }).unlock();
    expect(Ctx.instances[0].resume).toHaveBeenCalledTimes(1);
  });

  test('이미 running이면 resume을 부르지 않는다', () => {
    const Ctx = fakeAudioContextClass({ initialState: 'running' });
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock(); audio.unlock();
    expect(Ctx.instances[0].resume).not.toHaveBeenCalled();
  });

  test('중단(전화·탭 전환)으로 running이 아니게 된 뒤 unlock()을 부르면 다시 깨운다', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    Ctx.instances[0].state = 'interrupted';
    audio.unlock();
    expect(Ctx.instances[0].resume).toHaveBeenCalledTimes(1);
  });

  test('resume()이 거부돼도 처리되지 않은 rejection을 만들지 않는다', async () => {
    const Ctx = fakeAudioContextClass({ initialState: 'suspended' });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const audio = createAudio({ AudioContext: Ctx });
      audio.unlock();
      Ctx.instances[0].state = 'suspended';
      Ctx.instances[0].resume.mockImplementation(() => Promise.reject(new Error('blocked')));
      audio.unlock();
      await new Promise((r) => setTimeout(r, 20));
    } finally {
      process.off('unhandledRejection', unhandled);
    }
    expect(unhandled).not.toHaveBeenCalled();
  });

  test('resume()이 동기로 던져도 unlock()은 던지지 않는다', () => {
    const Ctx = fakeAudioContextClass({ initialState: 'suspended' });
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    Ctx.instances[0].state = 'suspended';
    Ctx.instances[0].resume.mockImplementation(() => { throw new Error('sync'); });
    expect(() => audio.unlock()).not.toThrow();
  });

  test('컨텍스트가 아직 running이 아니면 소리를 예약하지 않는다 (깨어난 뒤 한꺼번에 터지지 않게)', () => {
    const Ctx = fakeAudioContextClass({ initialState: 'suspended' });
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    Ctx.instances[0].state = 'suspended'; // resume()이 아직 끝나지 않은 순간
    audio.playCorrect();
    audio.playStimulus();
    expect(Ctx.instances[0].oscillators).toHaveLength(0);
  });
});

describe('소리', () => {
  test('unlock() 뒤 playCorrect()는 소리를 낸다: 두 음, 각각 시작과 정지가 예약된다', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    audio.playCorrect();
    const oscs = Ctx.instances[0].oscillators;
    expect(oscs).toHaveLength(2);
    for (const o of oscs) {
      expect(o.start).toHaveBeenCalledTimes(1);
      expect(o.stop).toHaveBeenCalledTimes(1);
      expect(o.frequency.value).toBeGreaterThan(0);
    }
  });

  test('정반응 소리는 오르는 두 음이다 (내려가는 소리는 실패처럼 들린다)', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    audio.playCorrect();
    const [first, second] = Ctx.instances[0].oscillators;
    expect(second.frequency.value).toBeGreaterThan(first.frequency.value);
  });

  test('정반응 소리는 짧다: 모든 음이 0.5초 안에 끝난다', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    audio.playCorrect();
    const ctx = Ctx.instances[0];
    for (const o of ctx.oscillators) {
      expect(o.stop.mock.calls[0][0] - ctx.currentTime).toBeLessThan(0.5);
    }
  });

  test('playStimulus()는 한 음이고 정반응 소리보다 짧다', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    audio.playStimulus();
    const ctx = Ctx.instances[0];
    expect(ctx.oscillators).toHaveLength(1);
    const stimulusEnd = ctx.oscillators[0].stop.mock.calls[0][0];

    audio.playCorrect();
    const correctEnd = Math.max(...ctx.oscillators.slice(1).map((o) => o.stop.mock.calls[0][0]));
    expect(stimulusEnd).toBeLessThan(correctEnd);
  });

  test('소리는 컨텍스트의 현재 시각 이후로 예약된다', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    audio.playCorrect();
    const ctx = Ctx.instances[0];
    for (const o of ctx.oscillators) {
      expect(o.start.mock.calls[0][0]).toBeGreaterThanOrEqual(ctx.currentTime);
    }
  });
});

describe('setEnabled', () => {
  test('setEnabled(false) 뒤에는 소리가 나지 않는다', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    audio.setEnabled(false);
    audio.playCorrect();
    audio.playStimulus();
    expect(Ctx.instances[0].oscillators).toHaveLength(0);
  });

  test('setEnabled(true)로 다시 켜면 소리가 난다', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    audio.setEnabled(false);
    audio.setEnabled(true);
    audio.playStimulus();
    expect(Ctx.instances[0].oscillators).toHaveLength(1);
  });

  test('꺼 둔 상태에서도 unlock()은 동작한다 (켠 순간 바로 소리가 나도록)', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.setEnabled(false);
    audio.unlock();
    expect(Ctx.instances).toHaveLength(1);
    audio.setEnabled(true);
    audio.playCorrect();
    expect(Ctx.instances[0].oscillators).toHaveLength(2);
  });

  test('unlock() 전에 setEnabled(false)를 해 둬도 던지지 않는다', () => {
    const audio = createAudio({ AudioContext: fakeAudioContextClass() });
    expect(() => audio.setEnabled(false)).not.toThrow();
  });

  test('truthy/falsy 값을 불리언으로 취급한다', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    audio.setEnabled(0);
    audio.playStimulus();
    expect(Ctx.instances[0].oscillators).toHaveLength(0);
    audio.setEnabled(1);
    audio.playStimulus();
    expect(Ctx.instances[0].oscillators).toHaveLength(1);
  });

  test('인스턴스끼리 상태를 공유하지 않는다', () => {
    const Ctx = fakeAudioContextClass();
    const a = createAudio({ AudioContext: Ctx });
    const b = createAudio({ AudioContext: Ctx });
    a.unlock(); b.unlock();
    a.setEnabled(false);
    b.playStimulus();
    expect(Ctx.instances[1].oscillators).toHaveLength(1);
  });
});

describe('AudioContext가 없거나 깨진 환경', () => {
  test('이 테스트 환경(node)에는 실제 AudioContext가 없다', () => {
    expect(globalThis.AudioContext).toBeUndefined();
    expect(globalThis.webkitAudioContext).toBeUndefined();
  });

  test('주입 없이 만든 인스턴스와 모듈 수준 함수는 AudioContext가 없어도 전부 던지지 않는다', () => {
    const audio = createAudio();
    for (const target of [audio, audioModule]) {
      expect(() => target.unlock()).not.toThrow();
      expect(() => target.playCorrect()).not.toThrow();
      expect(() => target.playStimulus()).not.toThrow();
      expect(() => target.setEnabled(false)).not.toThrow();
      expect(() => target.setEnabled(true)).not.toThrow();
    }
  });

  test('AudioContext: null을 명시해도 전부 던지지 않는다', () => {
    const audio = createAudio({ AudioContext: null });
    expect(() => { audio.unlock(); audio.playCorrect(); audio.playStimulus(); }).not.toThrow();
  });

  test('생성자가 던져도(자동재생 차단 등) unlock()은 던지지 않고, 다음 제스처에서 다시 시도한다', () => {
    let attempts = 0;
    const Ctx = fakeAudioContextClass();
    class FlakyContext extends Ctx {
      constructor() {
        attempts += 1;
        if (attempts === 1) throw new Error('not allowed');
        super();
      }
    }
    const audio = createAudio({ AudioContext: FlakyContext });
    expect(() => audio.unlock()).not.toThrow();
    expect(() => audio.playCorrect()).not.toThrow();
    audio.unlock();
    expect(attempts).toBe(2);
    audio.playCorrect();
    expect(Ctx.instances[0].oscillators).toHaveLength(2);
  });

  test('소리를 만드는 도중 Web Audio가 던져도 playCorrect()/playStimulus()는 던지지 않는다 (검사를 멈추지 않는다)', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio({ AudioContext: Ctx });
    audio.unlock();
    Ctx.instances[0].createOscillator = () => { throw new Error('InvalidStateError'); };
    expect(() => audio.playCorrect()).not.toThrow();
    expect(() => audio.playStimulus()).not.toThrow();
  });

  test('globalThis.AudioContext는 unlock() 시점에 읽는다 (import 뒤에 정의돼도 동작)', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio();
    globalThis.AudioContext = Ctx;
    try {
      audio.unlock();
      expect(Ctx.instances).toHaveLength(1);
    } finally {
      delete globalThis.AudioContext;
    }
  });

  test('AudioContext가 없으면 webkitAudioContext로 대체한다 (구형 Safari)', () => {
    const Ctx = fakeAudioContextClass();
    const audio = createAudio();
    globalThis.webkitAudioContext = Ctx;
    try {
      audio.unlock();
      expect(Ctx.instances).toHaveLength(1);
    } finally {
      delete globalThis.webkitAudioContext;
    }
  });
});
