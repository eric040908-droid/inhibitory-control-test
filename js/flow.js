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
import { readPrefs as defaultReadPrefs } from './prefs.js';

function newId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// router: { go(name, params) }
// goSetup(): 설정 화면으로 돌아간다(연습 중단 안내 뒤).
// onSessionEnd(session, saveResult): 회차가 저장된 뒤 화면을 옮길 때(완료는 마무리 애니메이션 뒤, 중단은 곧바로). 저장이 실패해도 불린다 — 결과 화면은 보여야 한다.
export function createFlow({
  router,
  goSetup,
  onSessionEnd,
  saveSession = defaultSaveSession,
  collectDeviceInfo = defaultCollectDeviceInfo,
  readPrefs = defaultReadPrefs,
  now = Date.now,
}) {
  function beginTest(ctx, level) {
    const { setup, theme } = ctx;
    const trialCount = TRIAL_COUNTS[level][setup.length];
    const trials = generateSequence(level, trialCount);
    const startedAt = now();
    // 소리·애니메이션 줄이기는 device(기기·브라우저가 정하는 조건)와 달리 교사가 탭 한 번으로 바꾸는 설정이라 따로 `settings`에 둔다.
    // 검사를 시작하는 순간의 값을 잡는다: 검사 중에는 바꿀 화면이 없으므로 저장 시점과 같지만, 시작 시점이 "학생이 겪은 조건"이다.
    const prefs = readPrefs();
    const settings = { sound: prefs.sound === true, reducedMotion: prefs.reducedMotion === true };

    // 저장은 검사가 끝나는 즉시 한다(마무리 애니메이션을 기다리지 않는다 — 학생이 그 사이 탭을 닫아도 회차가 남는다).
    // 화면 이동(onSessionEnd)은 완료 때는 애니메이션이 끝난 뒤, 중단 때는 곧바로다.
    const save = (responses, complete) => {
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
        settings,
        toolVersion: TOOL_VERSION,
      };
      // 저장이 던져도(storage.js는 안 던지지만 주입된 saveSession이 던질 수 있다) 검사 흐름은 이어진다: 학생이 마무리 화면에
      // 갇히지 않게 하고, 실패는 saveResult로 남겨 결과 화면이 교사에게 알린다.
      let saveResult;
      try {
        saveResult = saveSession(session);
      } catch (error) {
        saveResult = { ok: false, error: String(error?.message ?? error) };
      }
      return { session, saveResult };
    };

    let finished = null;
    router.go('test', {
      trials,
      level,
      theme,
      onFinish: (responses) => { finished = save(responses, true); },
      onCompleted: () => {
        if (finished) onSessionEnd?.(finished.session, finished.saveResult);
      },
      onAbort: (responses) => {
        const { session, saveResult } = save(responses, false);
        onSessionEnd?.(session, saveResult);
      },
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
