// 앱 진입점 — 라우터를 만들고, 화면들이 받을 deps를 조립하고, 첫 화면으로 보낸다.
// 맨 아래에서 오프라인용 서비스 워커(sw.js)도 등록한다.
import { createRouter } from './router.js';
import { unlock, playCorrect, playStimulus, setEnabled } from './audio.js';
import { createEngine } from './engine.js';
import { createSetupScreen } from './screens/setup.js';
import { createPracticeScreen } from './screens/practiceScreen.js';
import { createTaskScreen } from './screens/task.js';
import { createResultScreen } from './screens/result.js';
import { createHistoryScreen } from './screens/history.js';
import { createFlow } from './flow.js';

// ---- deps 조립 지점 -----------------------------------------------------------------------
// 화면 모듈은 audio와 createEngine을 직접 import하지 않고 deps로 받는다. 화면 테스트가
// 소리 호출과 엔진 생성을 가짜로 바꿔 관찰할 수 있어야 하기 때문이다.
//
// 화면은 `createXxxScreen(deps)`를 export하고 `{ mount, unmount? }`를 돌려준다. 아래 screens에
// 그 결과를 등록한다. 화면이 새 의존성(저장소, 시계 …)을 필요로 하면 deps에 키를 더하고 이 주석을 고친다.
//
// 오반응용 소리는 audio에도 deps에도 없다. 오반응에는 소리·색·흔들림 어느 것으로도 부정적 피드백을 주지 않는다.
//
// !! 검사·연습 화면(js/screens/trialRunner.js)은 createEngine에 넘기는 clock을 performance.now() 기준으로 만든다.
//    clock = { now: () => performance.now(), setTimeout, clearTimeout }
//    js/engine.js의 input()은 event.timeStamp를 받고, 최신 브라우저의 event.timeStamp는
//    performance.now()와 같은 기준(문서 시작 이후 경과 ms)이다. clock.now()에 Date.now()를 쓰면
//    두 값의 기준이 달라 모든 입력이 허용 구간 밖으로 판정되고, 모든 문항이 누락으로 기록된다.
//    (엔진은 일부러 크게 실패하도록 만들어져 있다.) clock은 여기서 미리 만들지 않는다 —
//    화면이 엔진을 만들 때 조립한다.
const audio = { unlock, playCorrect, playStimulus, setEnabled };
export const deps = { audio, createEngine };

// ---- 부팅 --------------------------------------------------------------------------------
const rootEl = document.getElementById('app');
if (!rootEl) throw new Error('index.html에 #app이 없습니다');

export const router = createRouter(rootEl, {
  setup: createSetupScreen(deps),
  practice: createPracticeScreen(deps),
  test: createTaskScreen(deps),
  result: createResultScreen(deps),
  history: createHistoryScreen(deps),
});

// 화면 이동은 flow가 맡는다(설정 → 연습 → 본 검사 → 회차 저장). 화면들은 서로를 모른다.
function goSetup() {
  router.go('setup', { onStart: flow.start, onHistory: () => goHistory() });
}

// 이력 화면 → 회차 열기(결과 화면) → 같은 학생의 묶음이 펼쳐진 이력 화면으로 돌아온다.
// PIN을 맞춘 상태는 history 화면 인스턴스가 기억하므로 결과를 보고 돌아와도 다시 묻지 않는다.
function goHistory(alias) {
  router.go('history', {
    alias,
    onBack: goSetup,
    onOpenSession: (session) => router.go('result', { session, onBack: () => goHistory(session.studentAlias) }),
  });
}

// 검사가 끝나면(완료는 마무리 애니메이션 뒤, 중단은 곧바로) 결과 화면으로 간다. 저장이 실패했어도 간다 —
// saveResult({ ok, error })를 넘겨 결과 화면이 "이 회차는 저장되지 않았습니다"를 교사에게 알린다.
function goResult(session, saveResult) {
  router.go('result', { session, saveResult, onBack: goSetup });
}

const flow = createFlow({
  router,
  goSetup,
  onSessionEnd: goResult,
});

// 소리는 사용자 제스처 안에서만 풀린다(브라우저 정책). 한 번만 걸고 떼는 대신 매번 부르기로 했다:
// unlock()은 이미 running이면 아무것도 안 하므로 비용이 없고, 전화·탭 전환으로 컨텍스트가 멈춘 뒤
// 다음 탭에서 다시 깨워 준다. capture로 걸어 화면이 stopPropagation을 해도 놓치지 않는다.
//
// pointerup에도 건다: 터치에서 pointerdown은 브라우저가 "사용자 활성화"로 치는 이벤트가 아니다
// (Chrome·iOS Safari 모두 터치의 활성화는 pointerup/touchend). 마우스와 달리 터치는 pointerdown만으로는
// AudioContext가 안 풀릴 수 있어서, 주 기기인 스마트폰에서는 pointerup 경로가 실제로 소리를 푼다.
// 이것은 오디오 해제 경로일 뿐이다 — 반응 입력은 계속 pointerdown이다(검사 화면이 받는다).
const unlockAudio = () => audio.unlock();
document.addEventListener('pointerdown', unlockAudio, { capture: true });
document.addEventListener('pointerup', unlockAudio, { capture: true });

// ---- 오프라인 ----------------------------------------------------------------------------
// 한 번 열어 본 뒤에는 인터넷이 끊겨도 열리게 서비스 워커를 등록한다(sw.js가 배포 파일 전체를 캐시한다).
// 등록은 덤이다: file://로 열었거나, HTTPS가 아니거나, 브라우저가 서비스 워커를 막았으면 실패하고,
// 그때도 검사는 되어야 한다. 그래서 동기 예외와 거절된 약속을 모두 삼키고 앱 부팅은 건드리지 않는다.
// 호출은 goSetup() 뒤에 한다 — 등록이 어떻게 되든 첫 화면은 이미 올라가 있다.
export function registerServiceWorker(nav = globalThis.navigator) {
  try {
    if (!nav || !('serviceWorker' in nav)) return;
    Promise.resolve(nav.serviceWorker.register('sw.js')).catch(() => {});
  } catch {
    // 등록할 수 없는 환경 — 오프라인 열기만 포기하고 앱은 그대로 쓴다.
  }
}

goSetup();
registerServiceWorker();
