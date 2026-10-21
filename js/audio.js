// 소리 — Web Audio API로 짧은 톤을 합성한다. 음원 파일은 쓰지 않는다 (오프라인·저작권·용량).
//
// 공개 표면은 네 함수뿐이다: unlock, playCorrect, playStimulus, setEnabled.
//   오반응용 소리는 만들지 않는다. 틀렸을 때 나는 소리는 아이에게 "틀렸다"는 신호가 되고, 이 검사는
//   오반응에 어떤 부정적 피드백도 주지 않는다. 그래서 그런 함수 자체가 이 모듈에 없다
//   (tests/audio.test.js가 export 목록을 고정한다). 참기 성공은 정반응과 같은 소리를 쓴다.
//
// 브라우저 정책: AudioContext는 사용자 제스처 안에서 만들거나 깨워야 소리가 난다.
//   - unlock()은 첫 pointerdown에서 불러 컨텍스트를 만들고 깨운다. 전화·탭 전환으로 컨텍스트가
//     멈추면(suspended/interrupted) 다음 pointerdown의 unlock()이 다시 깨우므로, 호출 쪽은
//     unlock을 한 번만 부르지 말고 pointerdown마다 불러도 된다 (이미 running이면 아무것도 안 한다).
//   - unlock() 전, 또는 컨텍스트가 running이 아닐 때의 play*는 조용히 아무것도 하지 않는다.
//     멈춰 있는 컨텍스트에 소리를 예약하면 깨어난 순간 한꺼번에 터지기 때문이다.
//   - 소리는 부가 기능이다. Web Audio가 없거나 도중에 던져도 play*/unlock은 절대 던지지 않는다 —
//     소리 때문에 검사가 멈추면 안 된다.
//
// AudioContext는 주입할 수 있다 (테스트·화면 deps). 생략하면 unlock() 시점에
// globalThis.AudioContext ?? globalThis.webkitAudioContext를 읽는다. null을 명시하면 소리 없음.

// 한 음 = { freq(Hz), at(시작 오프셋, 초), dur(길이, 초), type(파형) }.
// 정반응: 오르는 두 음(E5 → A5), 합쳐 약 0.3초. 내려가는 음은 실패처럼 들리므로 쓰지 않는다.
const CORRECT_TONES = [
  { freq: 659.25, at: 0, dur: 0.12, type: 'sine' },
  { freq: 880, at: 0.11, dur: 0.2, type: 'sine' },
];
// 자극 제시: 한 음(C5), 0.08초. 정반응보다 짧고 부드러워 헷갈리지 않는다.
const STIMULUS_TONES = [{ freq: 523.25, at: 0, dur: 0.08, type: 'triangle' }];

const PEAK_GAIN = 0.25;   // 스피커 볼륨을 모르는 아이 앞이므로 크지 않게
const ATTACK_S = 0.01;    // 딸깍 소리(클릭 노이즈) 방지
const STOP_PAD_S = 0.02;

export function createAudio({ AudioContext: Injected } = {}) {
  let ctx = null;
  let enabled = true;

  function resolveConstructor() {
    if (Injected !== undefined) return Injected; // null 포함: 명시한 대로
    return globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;
  }

  function unlock() {
    try {
      if (!ctx) {
        const Ctor = resolveConstructor();
        if (!Ctor) return;
        ctx = new Ctor();
        // iOS Safari 구버전은 제스처 안에서 실제로 무언가를 재생해야 풀린다: 무음 1샘플.
        const silent = ctx.createBufferSource();
        silent.buffer = ctx.createBuffer(1, 1, 22050);
        silent.connect(ctx.destination);
        silent.start(0);
      }
      if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
        const pending = ctx.resume();
        if (pending && typeof pending.catch === 'function') pending.catch(() => {});
      }
    } catch {
      // 생성자가 막혔으면 ctx는 null로 남고 다음 제스처에서 다시 시도한다.
    }
  }

  function play(tones) {
    if (!enabled || !ctx || ctx.state !== 'running') return;
    try {
      const t0 = ctx.currentTime;
      for (const { freq, at, dur, type } of tones) {
        const start = t0 + at;
        const end = start + dur;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.linearRampToValueAtTime(PEAK_GAIN, start + ATTACK_S);
        gain.gain.exponentialRampToValueAtTime(0.0001, end);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(end + STOP_PAD_S);
      }
    } catch {
      // 소리 실패가 검사를 멈추지 않는다.
    }
  }

  return {
    unlock,
    playCorrect: () => play(CORRECT_TONES),
    playStimulus: () => play(STIMULUS_TONES),
    setEnabled: (on) => { enabled = Boolean(on); },
  };
}

// 앱이 쓰는 기본 인스턴스. 화면은 이것을 직접 import하지 않고 main.js가 deps로 넘겨 준다.
const shared = createAudio();
export const unlock = shared.unlock;
export const playCorrect = shared.playCorrect;
export const playStimulus = shared.playStimulus;
export const setEnabled = shared.setEnabled;
