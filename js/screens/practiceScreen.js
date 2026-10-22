// 연습 화면 — 본 검사 전에 규칙을 알려 주고, 8문항(Go 5 / No-Go 3)을 돌려 난이도를 추천한다.
//
// 화면 계약: createPracticeScreen(deps) → { mount(rootEl, { theme, attempt, onDone }), unmount() }.
//   deps = { audio, createEngine }.
//   onDone(recommendation, practiceResult)
//     recommendation = { level: 1|2|3|null, retry, abort, recommendedLevel }
//       level은 교사가 최종으로 고른 단계다(고르지 않으면 추천값). recommendedLevel은 recommendLevel이 낸 추천값이다.
//       retry가 true이면 흐름이 attempt + 1로 이 화면을 다시 띄운다(재시도는 PRACTICE.maxRetries번).
//     practiceResult = { hits, goTrials, correctRejections, noGoTrials, meanRt, attempt } — 추천 근거로 원자료에 함께 저장된다.
//       본 검사 지표에는 포함하지 않는다.
//
// 규칙 전달은 글 없이 한다. 먼저 시범을 보여 준다:
//   Go 그림: 그림이 나오고 → 버튼(반응 영역)이 스스로 눌리고(손가락 그림이 짚고 색이 진해진다) → 짧은 소리와 칸이 채워진다.
//   No-Go 그림: 그림이 흔들리고 버튼이 흐려진 채 눌리지 않고 → 그림이 사라지면 같은 소리와 칸이 채워진다.
// 그 뒤 학생이 직접 8문항을 한다. 이 시범의 흔들림은 "하지 마라"를 보여 주는 연출이며 학생의 오반응에는 쓰이지 않는다.
//
// 연습이 끝난 뒤:
//   - 재시도: 학생에게 아무 표시 없이 곧바로 onDone(retry)한다. 학생에게 실패를 알리지 않는다.
//   - 추천 확정: 학생에게는 글 없는 전환 화면(테마 그림 + 남은 시간 막대)이 뜨고 THRESHOLDS.practiceAutoAdvanceMs 뒤 추천 단계로
//     자동 진행한다. 교사가 자리에 없어도 검사가 멈추지 않는다. 난이도 변경(글 + 선택지)은 구석 버튼을 길게 눌러야 열리고,
//     열면 자동 진행이 멈춘다.
//   - 중단: 학생에게는 글 없는 끝 화면. "지금은 검사가 어렵습니다"는 길게 눌러야 열리는 교사용 패널에만 있다.
//   검사 중에는 교사 화면이 따로 없다(기기를 학생이 들고 있다). 학생이 보면 안 되는 것은 길게 누르기 뒤에 둔다.
import { LEVELS, PRACTICE, THRESHOLDS } from '../config.js';
import { noGoGlyphFor, rewardCellCount } from '../themes.js';
import { recommendLevel } from '../practice.js';
import {
  createHoldButton, createStudentView, createTrialRunner, exitFullscreen, lockViewportZoom, requestFullscreen, rewardsCell,
} from './trialRunner.js';

// ---- 시범 연출 시간(ms) — 판정 기준이 아니라 연출이므로 여기 둔다 ------------------------------
export const DEMO = {
  leadMs: 800,          // 화면이 뜬 뒤 첫 그림까지
  goPressAfterMs: 1100, // Go 그림이 나오고 버튼이 스스로 눌릴 때까지
  pressHoldMs: 600,     // 눌린 채 머무는 시간
  nogoHoldMs: 2200,     // No-Go 그림이 흔들리며 머무는 시간
  gapMs: 800,           // 시범 사이
  items: ['go', 'nogo', 'go'],
};

// ---- 연습 문항 ------------------------------------------------------------------------------
// 연습은 정확히 Go PRACTICE.go개 / No-Go PRACTICE.noGo개다(추천 규칙이 그 개수를 전제한다). 본 검사의 순서 생성기는
// 비율로 뽑아 개수가 일정하지 않으므로 쓰지 않는다. 첫 문항은 Go, No-Go끼리는 이웃하지 않게 섞는다(가능할 때).
export function buildPracticeTrials(rng = Math.random) {
  const total = PRACTICE.go + PRACTICE.noGo;
  const rest = [
    ...Array.from({ length: Math.max(0, PRACTICE.go - 1) }, () => 'go'),
    ...Array.from({ length: PRACTICE.noGo }, () => 'nogo'),
  ];
  let types = ['go', ...rest];
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const shuffled = [...rest];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    types = ['go', ...shuffled];
    if (!types.some((type, i) => i > 0 && type === 'nogo' && types[i - 1] === 'nogo')) break;
  }
  return types.slice(0, total).map((type, index) => ({ index, type }));
}

// 응답 → 추천 규칙이 읽는 연습 결과. 정반응·참기 성공의 정의는 격자 보상과 같다(조급 반응 Go는 정반응이 아니다).
// 무효 문항(연습 중 화면이 가려짐)은 맞힌 것으로 세지 않는다.
export function summarizePractice(responses, attempt) {
  const hits = responses.filter((r) => r.type === 'go' && rewardsCell(r));
  const correctRejections = responses.filter((r) => r.type === 'nogo' && rewardsCell(r));
  const meanRt = hits.length === 0 ? null : hits.reduce((sum, r) => sum + r.rtMs, 0) / hits.length;
  return {
    hits: hits.length,
    goTrials: PRACTICE.go,
    correctRejections: correctRejections.length,
    noGoTrials: PRACTICE.noGo,
    meanRt,
    attempt,
  };
}

// ---- 교사 화면 ------------------------------------------------------------------------------
function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function createPracticeScreen(deps) {
  let teardown = null;

  return {
    mount(rootEl, params = {}) {
      teardown?.();
      const { theme, attempt = 1, onDone } = params;

      const controller = new AbortController();
      const { signal } = controller;
      const timers = new Set();
      let runner = null;
      let autoTimer = null;
      let done = false;

      const later = (ms, fn) => {
        const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
        timers.add(id);
      };

      const levelParams = LEVELS[PRACTICE.level];
      const total = PRACTICE.go + PRACTICE.noGo;
      const cellCount = rewardCellCount(total);
      const view = createStudentView({ itemGlyph: theme.itemGlyph, cellCount });
      const { audio } = deps;

      // ---- 시범 ----
      const hand = node('div', 'demo-hand', '👆');
      hand.dataset.demoHand = '';
      view.responseEl.append(hand);

      function showDemoStimulus(glyph) {
        view.showStimulus(glyph);
        audio.playStimulus();
      }
      function reward() {
        audio.playCorrect();
        view.fillNextCell();
      }

      // ---- 시범 중 화면이 가려질 때 ----
      // 시범은 setTimeout 사슬이다. 화면이 가려져도(알림, 전화, 탭 전환) 그대로 흘러가거나, 백그라운드에서 타이머가 늦춰져 일그러진 채
      // 재생된다. 시범은 글을 못 읽는 학생에게 규칙을 전하는 유일한 수단이라 학생이 놓치면 이어지는 연습이 규칙을 모르는 채 돌아가고,
      // 추천은 1단계가 되거나 중단되어 잘못된 측정이 된다. 본 검사(trialRunner.js)가 가려짐에 멈추는 것과 같게 여기서도 멈춘다.
      // 가려지면 시범을 멈추고 화면을 처음 상태로 되돌린 뒤, 돌아오면 처음부터 다시 보여 준다 — 중간부터 이으면 한 장면만 보게 된다.
      let demoPhase = true;     // 시범이 끝나 연습이 시작되면 false. 그 뒤의 가려짐은 trialRunner가 맡는다
      let demoPaused = false;

      function resetDemoStage() {
        for (const id of timers) clearTimeout(id);
        timers.clear();
        view.hideStimulus();
        delete view.responseEl.dataset.demo;
        view.resetGrid(cellCount); // 시범에서 채운 칸도 처음부터 다시 채워진다
      }

      document.addEventListener('visibilitychange', () => {
        if (!demoPhase || done) return;
        if (document.visibilityState === 'hidden') {
          if (demoPaused) return;
          demoPaused = true;
          resetDemoStage();
        } else {
          if (!demoPaused) return;
          demoPaused = false;
          playDemo();
        }
      }, { signal });

      function playDemo() {
        let t = DEMO.leadMs;
        for (const type of DEMO.items) {
          if (type === 'go') {
            later(t, () => showDemoStimulus(theme.goGlyph));
            t += DEMO.goPressAfterMs;
            later(t, () => { // 버튼이 스스로 눌리고, 그림이 사라지고, 소리와 칸
              view.responseEl.dataset.demo = 'press';
              view.hideStimulus();
              reward();
            });
            t += DEMO.pressHoldMs;
            later(t, () => { delete view.responseEl.dataset.demo; });
          } else {
            later(t, () => { // 그림이 흔들리고 버튼이 흐려진다. 버튼은 눌리지 않는다.
              showDemoStimulus(noGoGlyphFor(theme, PRACTICE.level));
              view.stimulusEl.classList.add('is-demo-sway');
              view.responseEl.dataset.demo = 'dim';
            });
            t += DEMO.nogoHoldMs;
            later(t, () => {
              view.hideStimulus();
              delete view.responseEl.dataset.demo;
              reward();
            });
          }
          t += DEMO.gapMs;
        }
        later(t, startPractice);
      }

      // ---- 연습 8문항 ----
      function startPractice() {
        if (done) return;
        demoPhase = false;
        hand.remove();
        view.resetGrid(cellCount); // 시범에서 채운 칸을 비우고 학생 차례로
        runner = createTrialRunner({
          view,
          audio,
          createEngine: deps.createEngine,
          theme,
          level: PRACTICE.level,
          trials: buildPracticeTrials(),
          levelParams,
          startDelayMs: levelParams.interTrialMs,
          onFinish: finishPractice,
        });
        runner.start();
      }

      function finishPractice(responses) {
        studentPhase = false;
        runner?.destroy();
        runner = null;
        const result = summarizePractice(responses, attempt);
        const recommendation = recommendLevel(result);
        if (recommendation.retry) {
          finish({ level: null, retry: true, abort: false, recommendedLevel: null }, result);
        } else if (recommendation.abort) {
          showAbortNotice(result);
        } else {
          showRecommendation(recommendation.level, result);
        }
      }

      function finish(recommendation, result) {
        if (done) return;
        done = true;
        if (autoTimer !== null) clearTimeout(autoTimer);
        autoTimer = null;
        onDone?.(recommendation, result);
      }

      // ---- 연습 뒤: 학생이 보는 화면과 교사 제스처 ----
      // 검사가 시작된 뒤에는 "교사 화면"이 따로 없다. 기기는 학생이 들고 있고 교사는 자리에 없다. 그래서 연습이 끝난 뒤에도
      // 학생에게는 글 없는 화면만 보이고, 글이 있는 교사용 패널(난이도 선택, 중단 안내)은 구석 버튼을 길게 눌러야만 열린다.
      // 길게 누르기는 학생이 우연히 발동할 수 없다(짧은 탭으로는 열리지 않는다).

      // 글 없는 학생 화면: 테마 그림 하나(와 선택적으로 남은 시간 막대) + 구석의 교사 제스처 버튼.
      function showStudentWait({ glyph, countdown, onTeacher }) {
        const wait = node('div', 'wait-screen');
        wait.dataset.studentView = '';
        wait.dataset.screen = 'practice-wait';
        wait.addEventListener('contextmenu', (event) => event.preventDefault());
        const picture = node('div', 'wait-glyph', glyph);
        wait.append(picture);
        if (countdown) {
          const bar = node('div', 'countdown');
          bar.dataset.countdown = '';
          bar.style.animationDuration = `${THRESHOLDS.practiceAutoAdvanceMs}ms`;
          wait.append(bar);
        }
        const open = createHoldButton({
          icon: '⚙', label: '교사용 안내 열기 (길게 누르기)', dataAttr: 'teacherOpen', signal, onHold: onTeacher,
        });
        wait.append(open.el);
        rootEl.replaceChildren(wait);
      }

      // 추천이 정해졌다: 학생에게는 글 없는 전환 화면. THRESHOLDS.practiceAutoAdvanceMs 뒤 추천 단계로 자동 진행한다
      // (교사가 자리에 없어도 검사가 멈추지 않는다). 난이도를 바꾸려면 교사가 길게 눌러 패널을 연다.
      // 패널을 열면 자동 진행을 멈춘다: 교사가 읽는 중에 화면이 넘어가면 쓸모가 없다. 패널의 "바로 시작"으로 진행한다.
      function showRecommendation(recommended, result) {
        showStudentWait({ glyph: theme.itemGlyph, countdown: true, onTeacher: openLevelPanel });
        autoTimer = setTimeout(() => proceed(recommended), THRESHOLDS.practiceAutoAdvanceMs);

        function proceed(level) {
          finish({ level, retry: false, abort: false, recommendedLevel: recommended }, result);
        }

        function openLevelPanel() {
          if (done) return;
          unlockZoom();
          if (autoTimer !== null) clearTimeout(autoTimer);
          autoTimer = null;
          let chosen = recommended;
          const panel = node('main', 'teacher-screen practice-result');
          panel.dataset.teacherView = '';
          panel.dataset.screen = 'practice-result';
          panel.append(node('h1', null, '난이도 선택'));
          panel.append(node('p', 'text-muted', '선택한 단계로 검사를 시작합니다. 추천 단계가 골라져 있습니다.'));
          const group = node('fieldset', 'setup-section');
          group.append(node('legend', null, '난이도'));
          const grid = node('div', 'choice-grid');
          for (const id of Object.keys(LEVELS).map(Number)) {
            const label = node('label', 'choice');
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = 'level';
            input.value = String(id);
            input.checked = id === recommended;
            label.append(input, node('span', 'choice-text', id === recommended ? `${id}단계 (추천)` : `${id}단계`));
            grid.append(label);
          }
          group.append(grid);
          group.addEventListener('change', (event) => { chosen = Number(event.target.value); }, { signal });
          panel.append(group);
          const begin = node('button', 'btn btn-block', '바로 시작');
          begin.type = 'button';
          begin.dataset.action = 'begin';
          begin.addEventListener('click', () => proceed(chosen), { signal });
          panel.append(begin);
          rootEl.replaceChildren(panel);
        }
      }

      // 중단(재시도 후에도 정반응 1개 이하): 학생에게는 실패를 암시하지 않는 글 없는 끝 화면(마무리 그림)만 보인다.
      // "지금은 검사가 어렵습니다"는 교사가 길게 눌러야 열린다. 자동으로 넘어가지 않는다: 넘어갈 단계가 없다.
      function showAbortNotice(result) {
        showStudentWait({ glyph: theme.completionGlyph, countdown: false, onTeacher: openNotice });

        function openNotice() {
          if (done) return;
          unlockZoom();
          exitFullscreen();
          const panel = node('main', 'teacher-screen practice-result');
          panel.dataset.teacherView = '';
          panel.dataset.screen = 'practice-abort';
          const notice = node('section', 'notice');
          notice.dataset.teacherNotice = 'practice-abort';
          notice.append(
            node('p', 'notice-title', '지금은 검사가 어렵습니다'),
            node('p', null, '연습에서 규칙을 익히는 데 어려움이 있었습니다. 오늘은 검사를 쉬고, 나중에 다시 시도해 주세요.'),
          );
          const back = node('button', 'btn btn-block', '처음으로');
          back.type = 'button';
          back.dataset.action = 'back';
          back.addEventListener('click', () => {
            finish({ level: null, retry: false, abort: true, recommendedLevel: null }, result);
          }, { signal });
          panel.append(notice, back);
          rootEl.replaceChildren(panel);
        }
      }

      // ---- 시범·연습 중 교사의 중단 ----
      // 시범과 8문항은 약 40초이고, 기기를 학생이 들고 있는 동안 교사가 멈출 수단이 없었다(대기 화면에만 길게 누르기 버튼이 있었다).
      // 본 검사(task.js)와 같은 구석 버튼을 같은 길게 누르기(1초)로 둔다. 짧게 누르면 아무 일도 없고, 글은 없다.
      // 중단하면 연습 중단과 같은 신호(abort)로 설정 화면에 돌아간다 — 회차는 저장하지 않는다(본 검사가 시작되지 않았다).
      // 연습이 끝나 대기 화면으로 바뀌면 이 버튼은 화면과 함께 사라지고, 대기 화면의 교사 제스처 버튼이 그 자리를 맡는다.
      let studentPhase = true;
      const stop = createHoldButton({
        icon: '⏹',
        label: '연습 중단 (길게 누르기)',
        dataAttr: 'abort',
        signal,
        disabled: () => done || !studentPhase,
        onHold() {
          // 시범 연출 타이머를 거두지 않으면 중단한 뒤에도 시범이 이어져 8문항이 시작된다.
          for (const id of timers) clearTimeout(id);
          timers.clear();
          const responses = runner ? runner.abort() : []; // 시범 중이면 엔진이 아직 없다
          runner?.destroy();
          runner = null;
          studentPhase = false;
          exitFullscreen();
          finish({ level: null, retry: false, abort: true, recommendedLevel: null }, summarizePractice(responses, attempt));
        },
      });
      view.el.append(stop.el);

      rootEl.append(view.el);
      requestFullscreen(); // 권장일 뿐이다. 거부되어도 그대로 진행한다
      const unlockZoom = lockViewportZoom(); // 학생 구간 동안만 잠근다. 교사용 패널이 열리면 풀어 준다(글이 있는 교사 화면이므로 확대할 수 있어야 한다)
      if (document.visibilityState === 'hidden') demoPaused = true; // 가려진 채로 열렸으면 돌아온 뒤에 시작한다
      else playDemo();

      teardown = () => {
        teardown = null;
        done = true;
        controller.abort();
        for (const id of timers) clearTimeout(id);
        timers.clear();
        if (autoTimer !== null) clearTimeout(autoTimer);
        autoTimer = null;
        runner?.destroy();
        runner = null;
        unlockZoom();
        // 전체화면은 닫지 않는다: 이어지는 본 검사가 같은 전체화면을 쓴다(사용자 제스처 없이는 다시 못 연다).
      };
    },

    unmount() {
      teardown?.();
    },
  };
}
