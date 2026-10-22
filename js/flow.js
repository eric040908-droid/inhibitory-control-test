// 검사 한 번의 흐름 — 설정 → (연습 → 재시도?) → 본 검사 → 회차 저장.
// 화면들은 서로를 모른다. 이 모듈이 router.go로 화면을 잇고, 화면이 돌려준 결과를 회차(Session)로 묶어 저장한다.
//
// 지난 설정(lastSetup)은 여기서 건드리지 않는다: lastSetup.level은 교사가 직접 정한 값 전용이다. 연습이 추천한 단계를
// 거기 저장하면 다음 "바로 시작"이 연습을 건너뛰게 되는데, 학생 상태는 날마다 다르므로 매번 연습을 거치는 쪽이 의도다.
import { TOOL_VERSION, TRIAL_COUNTS } from './config.js';
import { getTheme } from './themes.js';
import { generateSequence } from './trialSequence.js';
import { saveSession as defaultSaveSession } from './storage.js';
import { collectDeviceInfo as defaultCollectDeviceInfo } from './deviceInfo.js';

function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// router: { go(name, params) }
// goSetup(): 설정 화면으로 돌아간다(연습 중단 안내 뒤).
// onSessionEnd(session, saveResult): 회차가 저장된 뒤(완료든 중단이든). 저장이 실패해도 불린다 — 결과 화면은 보여야 한다.
export function createFlow({
  router,
  goSetup,
  onSessionEnd,
  saveSession = defaultSaveSession,
  collectDeviceInfo = defaultCollectDeviceInfo,
  now = Date.now,
}) {
  function beginTest(ctx, level) {
    const { setup, theme } = ctx;
    const trialCount = TRIAL_COUNTS[level][setup.length];
    const trials = generateSequence(level, trialCount);
    const startedAt = now();

    const end = (responses, complete) => {
      const session = {
        id: newId(),
        studentAlias: setup.alias,
        startedAt,
        endedAt: now(),
        complete,
        level,
        themeId: setup.themeId,
        length: setup.length,
        trialCount,
        responses,
        practice: ctx.practice,
        device: collectDeviceInfo(globalThis),
        toolVersion: TOOL_VERSION,
      };
      const saveResult = saveSession(session);
      onSessionEnd?.(session, saveResult);
    };

    router.go('test', {
      trials,
      level,
      theme,
      onFinish: (responses) => end(responses, true),
      onAbort: (responses) => end(responses, false),
    });
  }

  function beginPractice(ctx, attempt) {
    router.go('practice', {
      theme: ctx.theme,
      attempt,
      onDone: (recommendation, result) => {
        if (recommendation.retry) {
          beginPractice(ctx, attempt + 1);
        } else if (recommendation.abort) {
          goSetup?.();
        } else {
          // 연습 결과는 본 검사 지표에 들어가지 않는다. 추천 근거로 회차 원자료에 함께 남긴다.
          ctx.practice = { ...result, recommendedLevel: recommendation.recommendedLevel, chosenLevel: recommendation.level };
          beginTest(ctx, recommendation.level);
        }
      },
    });
  }

  return {
    // setup: 설정 화면의 onStart가 넘기는 { alias, themeId, length, levelOverride }
    start(setup) {
      const ctx = { setup, theme: getTheme(setup.themeId), practice: null };
      if (setup.levelOverride !== null && setup.levelOverride !== undefined) beginTest(ctx, setup.levelOverride);
      else beginPractice(ctx, 1);
    },
  };
}
