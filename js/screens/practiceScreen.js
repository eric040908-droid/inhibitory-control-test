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
//   - 재시도: 학생에게 아무 표시도 없이 곧바로 onDone(retry)한다. 학생에게 실패를 알리지 않는다.
//   - 추천 확정: 교사 화면(글 있음)이 추천 단계를 고른 채 뜨고, THRESHOLDS.practiceAutoAdvanceMs 뒤 자동으로 진행한다.
//     교사가 자리에 없어도 검사가 멈추지 않는다.
//   - 중단: "지금은 검사가 어렵습니다"는 교사 화면에만 뜬다. 학생 화면(data-student-view)에는 없다.
import { LEVELS, PRACTICE, THRESHOLDS } from '../config.js';
import { noGoGlyphFor, rewardCellCount } from '../themes.js';
import { recommendLevel } from '../practice.js';
import {
  createStudentView, createTrialRunner, exitFullscreen, requestFullscreen, rewardsCell,
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

      // ---- 교사 화면: 추천 ----
      function showRecommendation(recommended, result) {
        let chosen = recommended;
        const seconds = Math.round(THRESHOLDS.practiceAutoAdvanceMs / 1000);

        const panel = node('main', 'teacher-screen practice-result');
        panel.dataset.teacherView = '';
        panel.dataset.screen = 'practice-result';
        panel.append(node('h1', null, '연습을 마쳤습니다'));
        panel.append(node('p', 'text-muted', `${seconds}초 뒤 선택된 난이도로 검사가 자동으로 시작됩니다. 바꾸려면 다른 단계를 고르세요.`));

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

        const countdown = node('div', 'countdown');
        countdown.dataset.countdown = '';
        countdown.style.animationDuration = `${THRESHOLDS.practiceAutoAdvanceMs}ms`;
        panel.append(countdown);

        const begin = node('button', 'btn btn-block', '바로 시작');
        begin.type = 'button';
        begin.dataset.action = 'begin';
        begin.addEventListener('click', proceed, { signal });
        panel.append(begin);

        function proceed() {
          finish({ level: chosen, retry: false, abort: false, recommendedLevel: recommended }, result);
        }

        rootEl.replaceChildren(panel);
        autoTimer = setTimeout(proceed, THRESHOLDS.practiceAutoAdvanceMs);
      }

      // ---- 교사 화면: 중단 안내 ----
      // 학생 화면이 아니라 이 교사 화면에만 뜬다. 자동으로 넘어가지 않는다: 넘어갈 단계가 없다.
      function showAbortNotice(result) {
        exitFullscreen();
        const panel = node('main', 'teacher-screen practice-result');
        panel.dataset.teacherView = '';
        panel.dataset.screen = 'practice-abort';
        const notice = node('section', 'notice');
        notice.dataset.teacherNotice = 'practice-abort';
        notice.append(
          node('p', 'notice-title', '지금은 검사가 어렵습니다'),
          node('p', null, '연습에서 규칙을 익히는 데 어려움이 있었습니다. 오늘은 검사를 쉬고, 나중에 다시 시도해 주세요. 이 안내는 교사에게만 보입니다.'),
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

      rootEl.append(view.el);
      requestFullscreen(); // 권장일 뿐이다. 거부되어도 그대로 진행한다
      playDemo();

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
        // 전체화면은 닫지 않는다: 이어지는 본 검사가 같은 전체화면을 쓴다(사용자 제스처 없이는 다시 못 연다).
      };
    },

    unmount() {
      teardown?.();
    },
  };
}
