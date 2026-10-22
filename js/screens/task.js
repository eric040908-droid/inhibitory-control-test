// 본 검사 화면 — 학생이 실제로 보는 화면. 교사는 "시작"을 누르고 자리를 비웠고, 이 화면은 끝까지 학생 혼자다.
//
// 화면 계약: createTaskScreen(deps) → { mount(rootEl, { trials, level, theme, onFinish, onAbort }), unmount() }.
//   deps = { audio, createEngine } — 직접 import하지 않고 받는다(테스트가 엔진 호출과 소리 호출을 관찰한다).
//   onFinish(responses): 엔진이 끝나는 즉시(마무리 애니메이션을 시작하는 때). responses는 엔진의 onFinish가 준 배열이다.
//     저장은 여기서 한다 — 애니메이션은 학생을 위한 마무리이고 저장은 교사를 위한 자료라, 둘을 묶지 않는다.
//   onCompleted(): 마무리 애니메이션이 끝난 뒤(COMPLETION_HOLD_MS). 화면 이동은 여기서 한다. 중단(onAbort)에는 불리지 않는다.
//   onAbort(responses): 교사가 중단 버튼을 길게 눌렀을 때. 그때까지의 기록이다(진행 중이던 문항은 무효).
//
// 학생 화면에 문장은 한 줄도 없다. 오반응에는 소리·색·흔들림 어느 것도 없다 — 칸이 채워지지 않을 뿐이다.
// 공통 배선(엔진, rAF 신원, 가려짐, 격자)은 trialRunner.js에 있다.
import { LEVELS } from '../config.js';
import { rewardCellCount } from '../themes.js';
import { HOLD_MS, createHoldButton, createStudentView, createTrialRunner, exitFullscreen, requestFullscreen } from './trialRunner.js';

// 중단 버튼을 이만큼(ms) 눌러야 동작한다. 학생이 우연히 누를 수 없게 하는 것이 목적이라 1초 이상이어야 한다.
export const ABORT_HOLD_MS = HOLD_MS;
// 마지막 문항 뒤 마무리 그림을 보여 주는 시간(ms). 격자가 덜 찼어도 항상 보여 준다.
export const COMPLETION_HOLD_MS = 2500;

export function createTaskScreen(deps) {
  let teardown = null;

  return {
    mount(rootEl, params = {}) {
      teardown?.();
      const { trials, level, theme, onFinish, onAbort, onCompleted } = params;
      const levelParams = LEVELS[level];
      if (!levelParams) throw new Error(`알 수 없는 난이도: ${level}`);

      const controller = new AbortController();
      const { signal } = controller;
      let finished = false;
      let completionTimer = null;

      const view = createStudentView({ itemGlyph: theme.itemGlyph, cellCount: rewardCellCount(trials.length) });

      const runner = createTrialRunner({
        view,
        audio: deps.audio,
        createEngine: deps.createEngine,
        theme,
        level,
        trials,
        levelParams,
        startDelayMs: levelParams.interTrialMs, // 시작 직후 한 간격만큼 빈 화면 — 학생이 화면을 볼 시간
        onFinish(responses) {
          finished = true;
          cancelHold();
          abortButton.hidden = true;
          view.showCompletion(theme.completionGlyph);
          completionTimer = setTimeout(() => {
            completionTimer = null;
            onCompleted?.();
          }, COMPLETION_HOLD_MS);
          // 저장은 마무리 애니메이션을 기다리지 않는다: 학생이 끝나자마자 탭을 닫아도 회차가 남아야 한다.
          // 애니메이션을 먼저 시작해 두므로, 저장 쪽이 던져도 마무리와 화면 이동은 막히지 않는다.
          onFinish?.(responses);
        },
      });

      // ---- 중단 버튼 ----
      // 교사만 할 수 있는 길게 누르기(trialRunner.js의 createHoldButton) 뒤에 둔다. 짧게 누르면 아무 일도 없다.
      const abort = createHoldButton({
        icon: '⏹',
        label: '검사 중단 (길게 누르기)',
        dataAttr: 'abort',
        signal,
        disabled: () => finished,
        onHold() {
          finished = true;
          const responses = runner.abort();
          onAbort?.(responses);
        },
      });
      const abortButton = abort.el;
      const cancelHold = abort.cancel;
      view.el.append(abortButton);

      rootEl.append(view.el);

      // 전체화면은 권장일 뿐이다. 거부되어도 그대로 진행한다.
      requestFullscreen();
      runner.start();

      teardown = () => {
        teardown = null;
        finished = true;
        controller.abort();
        cancelHold();
        if (completionTimer !== null) clearTimeout(completionTimer);
        completionTimer = null;
        runner.destroy();
        exitFullscreen();
      };
    },

    // 라우터가 DOM을 치우기 전에 부른다. 엔진·타이머·리스너·rAF를 모두 거둔다.
    unmount() {
      teardown?.();
    },
  };
}
