// 본 검사 화면 — 학생이 실제로 보는 화면. 교사는 "시작"을 누르고 자리를 비웠고, 이 화면은 끝까지 학생 혼자다.
//
// 화면 계약: createTaskScreen(deps) → { mount(rootEl, { trials, level, theme, onFinish, onAbort }), unmount() }.
//   deps = { audio, createEngine } — 직접 import하지 않고 받는다(테스트가 엔진 호출과 소리 호출을 관찰한다).
//   onFinish(responses): 마지막 문항이 끝나고 마무리 애니메이션이 지난 뒤. responses는 엔진의 onFinish가 준 배열이다.
//   onAbort(responses): 교사가 중단 버튼을 길게 눌렀을 때. 그때까지의 기록이다(진행 중이던 문항은 무효).
//
// 학생 화면에 문장은 한 줄도 없다. 오반응에는 소리·색·흔들림 어느 것도 없다 — 칸이 채워지지 않을 뿐이다.
// 공통 배선(엔진, rAF 신원, 가려짐, 격자)은 trialRunner.js에 있다.
import { LEVELS } from '../config.js';
import { rewardCellCount } from '../themes.js';
import { createStudentView, createTrialRunner, exitFullscreen, requestFullscreen } from './trialRunner.js';

// 중단 버튼을 이만큼(ms) 눌러야 동작한다. 학생이 우연히 누를 수 없게 하는 것이 목적이라 1초 이상이어야 한다.
export const ABORT_HOLD_MS = 1000;
// 마지막 문항 뒤 마무리 그림을 보여 주는 시간(ms). 격자가 덜 찼어도 항상 보여 준다.
export const COMPLETION_HOLD_MS = 2500;

export function createTaskScreen(deps) {
  let teardown = null;

  return {
    mount(rootEl, params = {}) {
      teardown?.();
      const { trials, level, theme, onFinish, onAbort } = params;
      const levelParams = LEVELS[level];
      if (!levelParams) throw new Error(`알 수 없는 난이도: ${level}`);

      const controller = new AbortController();
      const { signal } = controller;
      let finished = false;
      let holdTimer = null;
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
            onFinish?.(responses);
          }, COMPLETION_HOLD_MS);
        },
      });

      // ---- 중단 버튼 ----
      // 왼쪽 위 구석, 작고 흐리다. 반응 영역(아래 절반 전체)과 겹치지 않고, 가로로 돌려도 반응 영역(오른쪽 절반) 밖이다.
      // 짧게 누르면 아무 일도 없고, ABORT_HOLD_MS 동안 계속 눌러야 동작한다. 누르는 동안 안쪽이 차오른다.
      const abortButton = document.createElement('button');
      abortButton.type = 'button';
      abortButton.className = 'abort-btn';
      abortButton.dataset.abort = '';
      abortButton.setAttribute('aria-label', '검사 중단 (길게 누르기)');
      abortButton.textContent = '⏹';
      abortButton.style.animationDuration = `${ABORT_HOLD_MS}ms`;
      view.el.append(abortButton);

      function cancelHold() {
        if (holdTimer !== null) clearTimeout(holdTimer);
        holdTimer = null;
        delete abortButton.dataset.holding;
      }

      abortButton.addEventListener('pointerdown', () => {
        if (finished) return;
        cancelHold(); // 떼지 않은 채 다시 눌러도 처음부터 센다
        abortButton.dataset.holding = 'true';
        holdTimer = setTimeout(() => {
          holdTimer = null;
          if (finished) return;
          finished = true;
          cancelHold();
          const responses = runner.abort();
          onAbort?.(responses);
        }, ABORT_HOLD_MS);
      }, { signal });
      for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
        abortButton.addEventListener(type, cancelHold, { signal });
      }

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
