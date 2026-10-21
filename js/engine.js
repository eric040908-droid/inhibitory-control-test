// 문항 타이밍 엔진 — 자극을 언제 요청하고, 입력을 어떻게 기록하고, 반응시간을 어떻게 계산하는지를 정한다.
// 이 파일은 DOM도 document.visibilityState도 전역 타이머도 보지 않는다. 시계는 clock으로, 그리기는 hooks로,
// 화면이 가려지는 일은 호출자가 pause()/resume()으로 알려 준다.
//
// 상태 기계 (한 문항의 흐름):
//
//   idle ──start──▶ stimulus ──제시 시간 끝──▶ grace ──허용 구간 끝──▶ gap ──interTrialMs──▶ (다음 문항 | finished)
//                      │                         │                      ▲
//                      └────────── input ────────┴──(첫 입력 = 반응)─────┘   (자극을 그 자리에서 끝낸다)
//
//   stimulus/grace ──pause──▶ paused (진행 중 문항을 invalid로 닫는다)
//   gap            ──pause──▶ paused (이미 기록된 문항은 건드리지 않는다)
//   paused         ──resume─▶ gap    (다음 문항부터, interTrialMs를 새로 기다린다)
//   idle/stimulus/grace/gap/paused ──abort──▶ aborted (진행 중 문항은 invalid로 남기고 onFinish는 부르지 않는다)
//
// 반응시간 = 입력 이벤트의 시각 − 자극이 실제로 그려진 시각. 핸들러 실행 시각은 쓰지 않는다.
//   그려진 시각의 기준: markStimulusRendered(t)가 불렸으면 max(t, 자극 시작 시각), 아니면 자극 시작 시각.
// 허용 구간 = [기준, 기준 + stimulusMs + responseGraceMs], 끝 경계 포함. 입력이 구간 안인지는 항상 이벤트 시각으로 판정한다.
//   구간이 끝나면 엔진은 그 문항을 closeSlackMs 뒤에 무반응으로 닫는다. 이 여유는 닫는 시점만 늦출 뿐 구간을 넓히지 않는다:
//   여유 안에서도 이벤트 시각이 구간을 넘은 입력은 반응이 아니다(그 입력이 도착하면 그 자리에서 문항을 닫는다).
// 이벤트 시각이 자극 시작 시각보다 이른 입력은 이 문항에 속하지 않는다. 직전 간격에 일어난 탭이 핸들러만 늦게 실행된 것이므로
//   직전 문항에 반응이 있었으면 그 문항의 extraTaps로 세고, 없었으면 버린다. (rtMs 0 반응으로 만들면 아이의 실제 반응이 가려진다.)
//   0으로 막는 것은 자극 시작 시각 ≤ 이벤트 시각 < 그려진 시각 구간(프레임 지연)뿐이다.
//
// extraTaps = 그 문항의 첫 반응(rtMs를 만든 입력) 이후, 다음 문항의 자극이 시작되기 전까지 들어온 탭의 수.
//   첫 반응 자체는 세지 않는다. 반응이 없었던(rtMs가 null인) 문항과 무효 문항은 항상 0이다.
//   반응이 자극을 즉시 끝내므로 연타는 대부분 문항 사이 간격에 떨어진다 — 그 탭은 직전 문항의 값이다.
//   이 값은 연구용 CSV로 나가는 원자료이며 metrics.js는 읽지 않는다.
// 반응이 들어오면 자극 제시 시간이 남아 있어도 즉시 끝낸다 — stimulusMs는 "최대" 제시 시간이다.
//
// 훅 호출 규칙:
//   - 엔진은 상태를 모두 바꿔 놓은 뒤에 훅을 부른다. 훅 안에서 엔진을 다시 불러도 상태가 어긋나지 않는다.
//   - 반응이 들어온 순서: 기록 → onStimulusEnd(자극이 아직 떠 있었다면) → onTrialComplete(보상 애니메이션).
//     보상은 기록이 끝난 뒤에 시작하므로 측정에 끼어들지 않는다.
//   - pause()/abort()는 훅을 부르지 않는다. 부른 쪽(화면)이 이미 정리를 맡고 있다.
//   - onTrialComplete가 받는 Response는 그 시점의 복사본이다. 첫 입력 뒤의 연타(extraTaps)는
//     그 뒤에도 쌓이므로 최종 값은 responses()/onFinish에서 읽는다.
import { THRESHOLDS } from './config.js';

const State = Object.freeze({
  IDLE: 'idle',
  STIMULUS: 'stimulus',
  GRACE: 'grace',
  GAP: 'gap',
  PAUSED: 'paused',
  FINISHED: 'finished',
  ABORTED: 'aborted',
});

function assertTime(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name}: 유한한 숫자(ms)가 필요하다 (받은 값: ${String(value)})`);
  }
}

const noop = () => {};

/**
 * @param {object} opts
 * @param {{index:number, type:'go'|'nogo'}[]} opts.trials
 * @param {{stimulusMs:number, interTrialMs:number}} opts.levelParams  LEVELS[level]
 * @param {{onStimulus?:Function, onStimulusEnd?:Function, onTrialComplete?:Function, onFinish?:Function}} opts.hooks
 * @param {{now():number, setTimeout(fn:Function, ms:number):any, clearTimeout(id:any):void}} opts.clock
 *   입력 시각(input의 인자)과 같은 시간축이어야 한다. 메서드는 자기 완결형 클로저로 감쌀 것
 *   (performance.now나 window.setTimeout을 그대로 꽂으면 this가 달라져 "Illegal invocation"이 난다).
 */
export function createEngine({ trials, levelParams, hooks = {}, clock }) {
  const { stimulusMs, interTrialMs } = levelParams;
  const windowMs = stimulusMs + THRESHOLDS.responseGraceMs;
  const closeSlackMs = THRESHOLDS.closeSlackMs;
  const onStimulus = hooks.onStimulus ?? noop;
  const onStimulusEnd = hooks.onStimulusEnd ?? noop;
  const onTrialComplete = hooks.onTrialComplete ?? noop;
  const onFinish = hooks.onFinish ?? noop;

  let state = State.IDLE;
  let nextIndex = 0;          // trials에서 다음에 보여 줄 위치
  const records = [];         // 닫힌 문항의 Response (엔진 내부의 원본)

  // 진행 중인 문항 (stimulus/grace 동안만 의미가 있다)
  let trial = null;
  let startedAt = 0;          // onStimulus를 요청한 시각
  let renderedAt = null;      // markStimulusRendered로 받은 시각 (없으면 null)

  // 첫 입력이 기록된 뒤 gap 동안 들어오는 연타를 올려 줄 Response (반응이 없었던 문항이면 null)
  let tapTarget = null;
  // 직전 문항의 tapTarget. 직전 간격에 일어난 탭이 다음 자극이 시작된 뒤에 핸들러로 도착했을 때 올려 줄 곳.
  let previousTapTarget = null;

  let stimulusTimer = null;
  let closeTimer = null;
  let gapTimer = null;

  const snapshot = (record) => ({ ...record });
  const snapshotAll = () => records.map(snapshot);
  const baseTime = () => renderedAt ?? startedAt;

  function clearTimers() {
    for (const id of [stimulusTimer, closeTimer, gapTimer]) {
      if (id !== null) clock.clearTimeout(id);
    }
    stimulusTimer = closeTimer = gapTimer = null;
  }

  // 현재 기준 시각에서 제시 종료·허용 구간 종료 타이머를 (다시) 건다.
  function armTrialTimers() {
    if (stimulusTimer !== null) clock.clearTimeout(stimulusTimer);
    if (closeTimer !== null) clock.clearTimeout(closeTimer);
    const base = baseTime();
    const now = clock.now();
    stimulusTimer = state === State.STIMULUS
      ? clock.setTimeout(() => { stimulusTimer = null; endStimulus(); }, Math.max(0, base + stimulusMs - now))
      : null;
    closeTimer = clock.setTimeout(() => { closeTimer = null; closeWindow(); },
      Math.max(0, base + windowMs + closeSlackMs - now));
  }

  function startTrial(next) {
    trial = next;
    startedAt = clock.now();
    renderedAt = null;
    previousTapTarget = tapTarget;
    tapTarget = null;
    state = State.STIMULUS;
    armTrialTimers();
    onStimulus(next);
  }

  function endStimulus() {
    if (state !== State.STIMULUS) return;
    state = State.GRACE;
    onStimulusEnd(trial);
  }

  // 반응 없이 허용 구간이 끝났다. (닫는 타이머가 만료됐거나, 구간을 넘은 이벤트 시각의 입력이 도착했다.)
  function closeWindow() {
    clearTimers();
    if (state === State.STIMULUS) endStimulus();
    if (state !== State.GRACE) return;
    const record = { index: trial.index, type: trial.type, rtMs: null, extraTaps: 0, invalid: false };
    records.push(record);
    trial = null;
    enterGap();
    onTrialComplete(snapshot(record));
  }

  function enterGap() {
    clearTimers();
    state = State.GAP;
    gapTimer = clock.setTimeout(endGap, interTrialMs);
  }

  // 다음 문항을 시작하고, 남은 문항이 없으면 끝낸다. start()와 gap 타이머가 함께 쓴다.
  function startNextOrFinish() {
    if (nextIndex < trials.length) {
      startTrial(trials[nextIndex++]);
    } else {
      finish();
    }
  }

  function endGap() {
    gapTimer = null;
    if (state !== State.GAP) return;
    startNextOrFinish();
  }

  function finish() {
    clearTimers();
    state = State.FINISHED;
    tapTarget = previousTapTarget = null;
    onFinish(snapshotAll());
  }

  // 진행 중이던 문항을 무효로 닫는다. pause()/abort()가 쓴다.
  function invalidateCurrentTrial() {
    records.push({ index: trial.index, type: trial.type, rtMs: null, extraTaps: 0, invalid: true });
    trial = null;
  }

  function isTrialRunning() {
    return state === State.STIMULUS || state === State.GRACE;
  }

  return {
    start() {
      if (state !== State.IDLE) return;
      startNextOrFinish();
    },

    // eventTimeStampMs: 입력 이벤트가 발생한 시각(event.timeStamp). 핸들러가 실행된 시각이 아니다.
    input(eventTimeStampMs) {
      assertTime(eventTimeStampMs, 'input');
      if (isTrialRunning()) {
        // 직전 간격에 일어난 탭이 늦게 도착했다. 이 문항의 반응이 아니다.
        if (eventTimeStampMs < startedAt) {
          if (previousTapTarget !== null) previousTapTarget.extraTaps += 1;
          return;
        }
        const sinceRendered = eventTimeStampMs - baseTime();
        // 이벤트 시각이 구간을 넘었다 — 반응이 아니고, 구간이 이미 끝났다는 증거이므로 문항을 무반응으로 닫는다.
        if (sinceRendered > windowMs) {
          closeWindow();
          return;
        }
        // 시작 시각 ≤ 이벤트 < 그려진 시각(프레임 지연)은 음수가 되지 않게 0으로 막는다.
        const rtMs = Math.max(0, sinceRendered);
        const wasStimulusShowing = state === State.STIMULUS;
        const record = { index: trial.index, type: trial.type, rtMs, extraTaps: 0, invalid: false };
        records.push(record);
        tapTarget = record;
        const finished = trial;
        trial = null;
        enterGap();
        if (wasStimulusShowing) onStimulusEnd(finished);
        onTrialComplete(snapshot(record));
      } else if (state === State.GAP) {
        // 마지막으로 시작한 자극보다 이른 이벤트 시각의 탭은 그 앞 간격에 속한다.
        const target = eventTimeStampMs < startedAt ? previousTapTarget : tapTarget;
        if (target !== null) target.extraTaps += 1;
      }
    },

    // 자극이 화면에 실제로 그려진 시각(예: requestAnimationFrame 콜백의 타임스탬프).
    // 문항당 첫 호출만 받는다. 자극 시작 시각보다 이르면 시작 시각으로 본다.
    // 자극이 이미 끝난 뒤(또는 진행 중인 문항이 없을 때)의 호출은 무시한다.
    markStimulusRendered(renderedAtMs) {
      assertTime(renderedAtMs, 'markStimulusRendered');
      if (state !== State.STIMULUS || renderedAt !== null) return;
      renderedAt = Math.max(renderedAtMs, startedAt);
      armTrialTimers();
    },

    pause() {
      if (isTrialRunning()) {
        clearTimers();
        invalidateCurrentTrial();
      } else if (state === State.GAP) {
        clearTimers();
      } else {
        return;
      }
      tapTarget = previousTapTarget = null;
      state = State.PAUSED;
    },

    resume() {
      if (state !== State.PAUSED) return;
      enterGap();
    },

    abort() {
      if (state === State.FINISHED || state === State.ABORTED) return;
      clearTimers();
      if (isTrialRunning()) invalidateCurrentTrial();
      tapTarget = previousTapTarget = null;
      state = State.ABORTED;
    },

    responses() {
      return snapshotAll();
    },
  };
}
