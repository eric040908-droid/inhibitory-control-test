# 발달장애학생 억제적 통제 검사 웹앱 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 중·고등 발달장애학생의 억제적 통제를 스마트폰 브라우저에서 재고, 교사·작업치료사가 읽을 수 있는 결과를 기기 안에 쌓는 고/노고 검사 웹앱을 만든다.

**Architecture:** 순수 로직(문항 순서, 지표, 배지, 추천, 저장, 내보내기, 타이밍 엔진)을 DOM과 분리된 ES 모듈로 먼저 만들고 Vitest로 고정한다. 그 위에 화면 모듈을 얹는다. 화면은 `index.html` 하나에서 JS가 전환한다. 서버 로직은 없고 모든 상태는 localStorage에 있다.

**Tech Stack:** 바닐라 JavaScript (ES 모듈), CSS, HTML. 프레임워크 없음, 배포 산출물에 빌드 단계 없음. Vitest + jsdom은 **devDependency 전용**이며 배포되지 않는다. 오프라인은 서비스 워커.

**Spec:** `docs/superpowers/specs/2026-10-21-inhibitory-control-test-design.md`

## Global Constraints

모든 태스크의 요구사항에 아래가 암묵적으로 포함된다. 값은 스펙에서 그대로 옮긴 것이다.

- **학생이 보는 화면에 문장이 없다.** 그림, 아이콘, 소리, 움직임만. 교사 화면에는 글을 쓴다.
- **세로 모드 스마트폰 기준 레이아웃.** 반응 영역은 **화면 하단 절반 전체**. 자극은 상단 절반 가운데. 수집 격자는 그 사이 얇은 띠.
- **오반응에 부정적 피드백을 주지 않는다.** 소리, 색, 흔들림, 보상 누락 중 어느 것으로도.
- **난이도 단계가 다른 회차의 수치를 나란히 보여주지 않는다.** 추이 그래프는 같은 단계·완료 세션만.
- **배포 산출물에 빌드 단계가 없다.** 브라우저가 `index.html`과 `js/*.js`를 그대로 읽는다. `package.json`과 `node_modules`는 테스트 전용이며 배포 대상에서 제외한다.
- **프레임워크·런타임 의존성 없음.** 배포되는 코드는 외부 스크립트를 로드하지 않는다.
- **학생의 반응 입력은 `pointerdown`.** 반응시간을 재는 경로에서는 `click`을 쓰지 않는다 — `click`은 터치에서 지연이 붙는다.
- **교사 화면의 버튼은 `click`을 쓴다.** 교사 화면은 스크롤되므로, `pointerdown`으로 두면 스크롤하려고 손가락을 댄 것이 버튼을 눌러버린다("시작"을 잘못 눌러 검사가 시작되는 것이 실제 위험이다). `click`은 브라우저가 탭과 스크롤 제스처를 구분해 준다. 측정 경로가 아니므로 지연은 문제가 되지 않는다.
- **반응시간 = 입력 이벤트의 `timeStamp` − 자극이 실제로 그려진 시각.** 핸들러 실행 시각을 쓰지 않는다.
- **판정 기준값은 전부 `js/config.js` 한 곳에 있다.** 다른 모듈에 숫자를 하드코딩하지 않는다.
- **문항 수 상한 100.**
- **데이터는 localStorage에만 저장하고 어디로도 전송하지 않는다.**
- **`prefers-reduced-motion`을 존중**하고 수동 토글도 둔다.
- **모든 회차에 `TOOL_VERSION` 문자열을 저장한다.**

## Review Focus

스펙이 요구하지만 각 태스크의 기본 테스트가 지나칠 수 있고, 실제 사용자를 가장 먼저 물 조건들이다. 각 줄의 테스트는 해당 코드를 가진 태스크에 포함되어 있다.

1. **localStorage를 쓸 수 없거나 용량이 꽉 찬 기기** — 검사는 끝까지 진행되고 결과 화면도 보여야 하며, 저장 실패만 교사에게 알린다. (Task 7)
2. **손상되거나 다른 도구 버전으로 만든 가져오기 파일** — 기존에 쌓인 데이터를 절대 파괴하지 않고, 읽을 수 있는 회차만 받아들이며 나머지는 경고로 알린다. (Task 8)
3. **검사 중 화면이 반복해서 가려지는 상황** — 무효 문항이 누적되고, 모든 지표 계산에서 제외되며, 10%를 넘으면 배지에 반영된다. (Task 9, Task 3, Task 4)
4. **참아야 할 문항이 0~1개인 극단 조합** — 0으로 나누지 않고, 억제 지표를 "참고용"으로 표시한다. (Task 3, Task 4)
5. **같은 문항에서 연타하거나 두 손가락으로 동시에 누르는 입력** — 첫 입력만 반응시간이 되고, 나머지는 연타 횟수로만 기록되어 반응시간을 오염시키지 않는다. (Task 9)

---

### Task 1: 프로젝트 골격과 설정 상수

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `js/config.js`
- Test: `tests/config.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `TOOL_VERSION: string`, `LEVELS: Record<1|2|3, LevelParams>`, `TRIAL_COUNTS: Record<1|2|3, Record<'short'|'medium'|'long', number>>`, `MAX_TRIALS: number`, `THRESHOLDS: object`, `PRACTICE: object`. `LevelParams = { stimulusMs, interTrialMs, noGoRatio, sameCategoryNoGo }`.

- [ ] **Step 1: `package.json`과 `.gitignore`을 만든다**

`package.json`: `"type": "module"`, `devDependencies`에 `vitest`와 `jsdom`만, `"scripts": { "test": "vitest run" }`. `dependencies`는 비워 둔다 — 배포 산출물에 런타임 의존성이 없어야 한다.

`.gitignore`: `node_modules/`, `.superpowers/`

- [ ] **Step 2: 실패하는 테스트를 쓴다**

```js
// tests/config.test.js
import { LEVELS, TRIAL_COUNTS, MAX_TRIALS, THRESHOLDS, PRACTICE, TOOL_VERSION } from '../js/config.js';

test('난이도별 제시 시간과 간격이 스펙과 일치한다', () => {
  expect(LEVELS[1]).toMatchObject({ stimulusMs: 4000, interTrialMs: 1500, noGoRatio: 0.20, sameCategoryNoGo: false });
  expect(LEVELS[2]).toMatchObject({ stimulusMs: 2400, interTrialMs: 1200, noGoRatio: 0.25, sameCategoryNoGo: false });
  expect(LEVELS[3]).toMatchObject({ stimulusMs: 1400, interTrialMs: 900,  noGoRatio: 0.33, sameCategoryNoGo: true  });
});

test('문항 수 테이블이 스펙과 일치하고 상한 100을 넘지 않는다', () => {
  expect(TRIAL_COUNTS[1]).toEqual({ short: 18, medium: 50, long: 85 });
  expect(TRIAL_COUNTS[2]).toEqual({ short: 22, medium: 65, long: 100 });
  expect(TRIAL_COUNTS[3]).toEqual({ short: 30, medium: 85, long: 100 });
  for (const row of Object.values(TRIAL_COUNTS))
    for (const n of Object.values(row)) expect(n).toBeLessThanOrEqual(MAX_TRIALS);
});

test('판정 기준값이 스펙과 일치한다', () => {
  expect(THRESHOLDS).toMatchObject({
    anticipatoryMs: 200, anticipatoryRate: 0.20, omissionRate: 0.40,
    consecutiveOmissions: 5, minNoGoTrials: 8, invalidTrialRate: 0.10,
    responseGraceMs: 500, firstGoTrials: 3, noGoGapSpread: 2,
    rewardCellRatio: 0.70, practiceAutoAdvanceMs: 8000,
  });
});

test('연습 블록 설정이 스펙과 일치한다', () => {
  expect(PRACTICE).toMatchObject({ go: 5, noGo: 3, level: 2, maxRetries: 1 });
});

test('도구 버전이 문자열로 있다', () => {
  expect(typeof TOOL_VERSION).toBe('string');
  expect(TOOL_VERSION.length).toBeGreaterThan(0);
});
```

- [ ] **Step 3: 테스트를 돌려 실패를 확인한다**

Run: `npm install && npx vitest run tests/config.test.js`
Expected: FAIL — `js/config.js`를 찾을 수 없다

- [ ] **Step 4: `js/config.js`를 구현한다**

위 테스트가 요구하는 상수를 named export로 둔다. 추가로 반응 일관성 라벨 경계를 `THRESHOLDS`에 넣는다: `consistencySdGoodMs: 120`, `consistencySdFairMs: 220`. 각 상수 위에 스펙의 어느 절에서 온 값인지와 **임시값임**을 한 줄 주석으로 남긴다(§5.8).

`noGoGapSpread`에 대한 설명 주석을 반드시 남긴다: No-Go 사이 Go 개수의 범위는 고정값이 아니라 난이도의 `noGoRatio`에서 유도한다. 평균 간격은 `round(1 / noGoRatio) − 1`이고, 실제 퍼짐은 `min(noGoGapSpread, 평균 − 1)`, 범위는 `[평균 − 퍼짐, 평균 + 퍼짐]`이다. 범위를 평균에 대해 **대칭**으로 유지하는 것이 핵심이다 — 아래쪽만 1에서 자르면 평균 간격이 올라가 요구한 No-Go 비율보다 낮게 나온다. 간격 범위를 모든 난이도에 고정해도 같은 문제가 생긴다.

- [ ] **Step 5: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/config.test.js`
Expected: PASS (5 tests)

- [ ] **Step 6: 커밋**

```bash
git add package.json .gitignore js/config.js tests/config.test.js
git commit -m "feat: add project scaffold and spec constants"
```

---

### Task 2: 문항 순서 생성

**Files:**
- Create: `js/trialSequence.js`
- Test: `tests/trialSequence.test.js`

**Interfaces:**
- Consumes: `LEVELS`, `THRESHOLDS` from `js/config.js`
- Produces: `generateSequence(level: 1|2|3, trialCount: number, rng?: () => number): Trial[]` where `Trial = { index: number, type: 'go' | 'nogo' }`. `rng`의 기본값은 `Math.random`이며, 테스트는 시드 난수를 주입한다. 그리고 `gapRangeFor(level: 1|2|3): { min: number, max: number }`.

**간격 범위는 난이도에서 유도하며, 평균에 대해 대칭이다.** 평균 간격 = `round(1 / LEVELS[level].noGoRatio) − 1`, 퍼짐 = `min(THRESHOLDS.noGoGapSpread, 평균 − 1)`, 범위 = `[평균 − 퍼짐, 평균 + 퍼짐]`. 결과: 1단계 평균 4 → 2~6, 2단계 평균 3 → 1~5, 3단계 평균 2 → 1~3. 아래쪽만 1에서 자르면 평균 간격이 올라가 No-Go 비율이 요구값보다 낮아지므로, 위쪽도 같은 만큼 줄여 대칭을 지킨다. 모든 난이도에 같은 범위를 쓰면 평균 간격이 비율과 어긋난다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/trialSequence.test.js — seededRng(seed)는 이 파일 안의 작은 LCG 헬퍼
test('첫 3문항은 항상 Go다', () => {
  for (const level of [1, 2, 3]) {
    const seq = generateSequence(level, 60, seededRng(level));
    expect(seq.slice(0, 3).every(t => t.type === 'go')).toBe(true);
  }
});

test('No-Go 문항이 연달아 나오지 않는다', () => {
  for (let s = 0; s < 50; s++) {
    const seq = generateSequence(3, 85, seededRng(s));
    for (let i = 1; i < seq.length; i++)
      expect(seq[i].type === 'nogo' && seq[i - 1].type === 'nogo').toBe(false);
  }
});

test('간격 범위는 난이도의 No-Go 비율에서 유도된다', () => {
  expect(gapRangeFor(1)).toEqual({ min: 2, max: 6 });
  expect(gapRangeFor(2)).toEqual({ min: 1, max: 5 });
  expect(gapRangeFor(3)).toEqual({ min: 1, max: 3 });
});

test('No-Go 사이의 Go 개수가 그 난이도의 범위에 들어간다', () => {
  for (const level of [1, 2, 3]) {
    const { min, max } = gapRangeFor(level);
    const gaps = gapsBetweenNoGo(generateSequence(level, 85, seededRng(level * 7))); // 첫 No-Go 이전 구간은 제외
    for (const g of gaps) { expect(g).toBeGreaterThanOrEqual(min); expect(g).toBeLessThanOrEqual(max); }
  }
});

test('3단계에서 Go Go No-Go 고정 반복이 되지 않는다', () => {
  const seq = generateSequence(3, 85, seededRng(11));
  expect(new Set(gapsBetweenNoGo(seq)).size).toBeGreaterThan(1);
});

test('No-Go 비율이 난이도 설정값에 근접한다', () => {
  const cases = [[1, 50, 0.20], [2, 65, 0.25], [3, 85, 0.33]];
  for (const [level, n, ratio] of cases) {
    const seq = generateSequence(level, n, seededRng(level * 13));
    const actual = seq.filter(t => t.type === 'nogo').length / n;
    expect(Math.abs(actual - ratio)).toBeLessThanOrEqual(0.06);
  }
});

test('같은 rng를 주면 같은 순서가 나온다', () => {
  expect(generateSequence(2, 40, seededRng(3))).toEqual(generateSequence(2, 40, seededRng(3)));
});

test('index가 0부터 연속이고 길이가 trialCount와 같다', () => {
  const seq = generateSequence(1, 18, seededRng(1));
  expect(seq).toHaveLength(18);
  expect(seq.map(t => t.index)).toEqual([...Array(18).keys()]);
});

test('문항 수가 아주 적어도 규칙을 깨지 않는다', () => {
  const seq = generateSequence(1, 5, seededRng(2));
  expect(seq.slice(0, 3).every(t => t.type === 'go')).toBe(true);
  expect(seq).toHaveLength(5);
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/trialSequence.test.js`
Expected: FAIL — `generateSequence is not a function`

- [ ] **Step 3: `generateSequence(level, trialCount, rng)`를 `js/trialSequence.js`에 구현한다**

접근: 앞 `firstGoTrials`개를 Go로 고정한 뒤, `gapRangeFor(level)`에서 간격을 무작위로 뽑아 Go를 그만큼 놓고 No-Go 하나를 놓는 것을 `trialCount`에 닿을 때까지 반복한다. 마지막에 자리가 모자라면 남은 칸을 Go로 채운다. 목표 No-Go 개수를 미리 정해 배치하지 않는다 — 비율은 간격의 평균에서 저절로 나오고, 고정 윈도를 쓰지 않는다(§5.1).

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/trialSequence.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/trialSequence.js tests/trialSequence.test.js
git commit -m "feat: add trial sequence generator with randomized no-go gaps"
```

---

### Task 3: 지표 계산

**Files:**
- Create: `js/metrics.js`
- Test: `tests/metrics.test.js`

**Interfaces:**
- Consumes: `THRESHOLDS` from `js/config.js`
- Produces: `computeMetrics(responses: Response[]): Metrics`.
  `Response = { index: number, type: 'go'|'nogo', rtMs: number|null, extraTaps: number, invalid: boolean }` — `rtMs`가 `null`이면 허용 구간 안에 입력이 없었다는 뜻.
  `Metrics = { goTrials, noGoTrials, hits, omissions, commissions, correctRejections, anticipatory, anticipatoryRate, meanRt: number|null, rtSd: number|null, consistency: 'good'|'fair'|'poor'|null, maxConsecutiveOmissions, validTrials, invalidTrials, invalidRate, halves: { first: HalfMetrics, second: HalfMetrics } }`.
  `HalfMetrics = { commissions, meanRt: number|null }`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/metrics.test.js
test('정반응은 200ms 이후 Go 반응만 센다', () => {
  const m = computeMetrics([go(300), go(900), go(null)]);
  expect(m.hits).toBe(2); expect(m.omissions).toBe(1);
});

test('Go 문항의 200ms 이내 반응은 정반응이 아니고 조급 반응으로만 센다', () => {
  const m = computeMetrics([go(150), go(600)]);
  expect(m.hits).toBe(1);
  expect(m.anticipatory).toBe(1);
  expect(m.omissions).toBe(0);
});

test('Go 조급 반응은 평균 반응속도와 편차 계산에서 빠진다', () => {
  const m = computeMetrics([go(100), go(500), go(700)]);
  expect(m.meanRt).toBe(600);
});

test('No-Go 문항의 200ms 이내 반응은 억제 실패와 조급 반응 양쪽에 1씩 센다', () => {
  const m = computeMetrics([nogo(120)]);
  expect(m.commissions).toBe(1);
  expect(m.anticipatory).toBe(1);
});

test('참기 성공은 No-Go 무반응이다', () => {
  const m = computeMetrics([nogo(null), nogo(400)]);
  expect(m.correctRejections).toBe(1); expect(m.commissions).toBe(1);
});

test('조급 반응 비율의 분모는 Go와 No-Go를 합친 전체 문항이다', () => {
  const m = computeMetrics([go(100), go(500), nogo(null), nogo(null)]);
  expect(m.anticipatoryRate).toBeCloseTo(0.25);
});

test('무효 문항은 모든 지표에서 제외되고 따로 집계된다', () => {
  const m = computeMetrics([go(500), { ...go(100), invalid: true }, nogo(300)]);
  expect(m.validTrials).toBe(2); expect(m.invalidTrials).toBe(1);
  expect(m.anticipatory).toBe(0); expect(m.hits).toBe(1); expect(m.commissions).toBe(1);
  expect(m.invalidRate).toBeCloseTo(1 / 3);
});

test('Go 누락의 최대 연속 길이를 세고, 참기 성공은 끊지도 잇지도 않는다', () => {
  const m = computeMetrics([go(null), nogo(null), go(null), go(null), go(500)]);
  expect(m.maxConsecutiveOmissions).toBe(3);
});

test('반응 일관성은 편차 경계로 라벨링된다', () => {
  expect(computeMetrics([go(600), go(620), go(590)]).consistency).toBe('good');
  expect(computeMetrics([go(300), go(900), go(1500)]).consistency).toBe('poor');
});

test('전반과 후반을 유효 문항 순서로 반씩 나눈다', () => {
  const m = computeMetrics([nogo(null), go(500), nogo(300), go(900)]);
  expect(m.halves.first.commissions).toBe(0);
  expect(m.halves.second.commissions).toBe(1);
  expect(m.halves.first.meanRt).toBe(500);
});

test('No-Go 문항이 없어도 0으로 나누지 않는다', () => {
  const m = computeMetrics([go(500), go(600)]);
  expect(m.noGoTrials).toBe(0);
  expect(m.commissions).toBe(0);
  expect(Number.isFinite(m.anticipatoryRate)).toBe(true);
});

test('Go 정반응이 하나도 없으면 평균과 편차가 null이다', () => {
  const m = computeMetrics([go(null), nogo(null)]);
  expect(m.meanRt).toBeNull(); expect(m.rtSd).toBeNull(); expect(m.consistency).toBeNull();
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/metrics.test.js`
Expected: FAIL — `computeMetrics is not a function`

- [ ] **Step 3: `computeMetrics(responses)`를 `js/metrics.js`에 구현한다**

§5.7의 정의 테이블과 중복 계상 규칙을 그대로 따른다. 편차는 표본표준편차. 유효 문항이 홀수면 전반이 한 개 더 갖는다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/metrics.test.js`
Expected: PASS (12 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/metrics.js tests/metrics.test.js
git commit -m "feat: add metric computation per spec definitions"
```

---

### Task 4: 검사 집중도 배지 판정

**Files:**
- Create: `js/badge.js`
- Test: `tests/badge.test.js`

**Interfaces:**
- Consumes: `THRESHOLDS` from `js/config.js`, `Metrics` from Task 3
- Produces: `evaluateBadge(metrics: Metrics): Badge` where `Badge = { status: 'uninterpretable' | 'caution' | 'reference' | 'ok', reasons: ReasonCode[] }` and `ReasonCode` is one of `'anticipatory'`, `'omission'`, `'consecutiveOmissions'`, `'tooFewNoGo'`, `'tooManyInvalid'`. `status`는 `uninterpretable > caution > reference > ok` 순으로 가장 심한 것이 이긴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/badge.test.js — metricsWith(partial)는 기본 정상치에 덮어쓰는 헬퍼
test('아무 조건에도 걸리지 않으면 양호다', () => {
  expect(evaluateBadge(metricsWith({}))).toEqual({ status: 'ok', reasons: [] });
});

test('조급 반응이 전체 문항의 20% 이상이면 해석 주의다', () => {
  const b = evaluateBadge(metricsWith({ anticipatoryRate: 0.20 }));
  expect(b.status).toBe('caution'); expect(b.reasons).toContain('anticipatory');
});

test('누락이 Go 문항의 40% 이상이면 해석 불가다', () => {
  const b = evaluateBadge(metricsWith({ goTrials: 10, omissions: 4 }));
  expect(b.status).toBe('uninterpretable'); expect(b.reasons).toContain('omission');
});

test('Go 누락이 5문항 연속이면 해석 주의다', () => {
  expect(evaluateBadge(metricsWith({ maxConsecutiveOmissions: 5 })).reasons).toContain('consecutiveOmissions');
});

test('3단계에서 참기를 모두 성공한 학생은 양호로 나온다', () => {
  // 회귀 테스트: "무반응 5연속"으로 판정하면 참기 성공이 섞여 정상 수행이 주의로 찍힌다
  const b = evaluateBadge(metricsWith({
    goTrials: 57, hits: 57, omissions: 0, maxConsecutiveOmissions: 0,
    noGoTrials: 28, correctRejections: 28, commissions: 0,
  }));
  expect(b.status).toBe('ok');
});

test('No-Go 문항이 8개 미만이면 억제 지표 참고용이다', () => {
  const b = evaluateBadge(metricsWith({ noGoTrials: 7 }));
  expect(b.status).toBe('reference'); expect(b.reasons).toContain('tooFewNoGo');
});

test('No-Go 문항이 0개여도 참고용으로 판정되고 예외가 나지 않는다', () => {
  expect(evaluateBadge(metricsWith({ noGoTrials: 0, commissions: 0 })).reasons).toContain('tooFewNoGo');
});

test('무효 문항이 10% 이상이면 해석 주의다', () => {
  expect(evaluateBadge(metricsWith({ invalidRate: 0.12 })).reasons).toContain('tooManyInvalid');
});

test('여러 조건에 걸리면 가장 심한 상태가 되고 이유는 모두 남는다', () => {
  const b = evaluateBadge(metricsWith({ goTrials: 10, omissions: 5, noGoTrials: 4, anticipatoryRate: 0.5 }));
  expect(b.status).toBe('uninterpretable');
  expect(b.reasons).toEqual(expect.arrayContaining(['omission', 'tooFewNoGo', 'anticipatory']));
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/badge.test.js`
Expected: FAIL — `evaluateBadge is not a function`

- [ ] **Step 3: `evaluateBadge(metrics)`를 `js/badge.js`에 구현한다**

§5.8의 표를 조건 목록으로 두고 전부 평가한 뒤, 걸린 이유들의 심각도 최댓값을 `status`로 삼는다. 문장은 담지 않는다 — 화면 문구는 Task 13이 `ReasonCode`로 찾는다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/badge.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/badge.js tests/badge.test.js
git commit -m "feat: add interpretability badge evaluation"
```

---

### Task 5: 연습 추천과 해석 문장 규칙

**Files:**
- Create: `js/practice.js`
- Create: `js/interpretation.js`
- Test: `tests/practice.test.js`
- Test: `tests/interpretation.test.js`

**Interfaces:**
- Consumes: `PRACTICE`, `THRESHOLDS` from `js/config.js`; `Metrics` from Task 3; `Badge` from Task 4
- Produces:
  `recommendLevel(result: PracticeResult): Recommendation` where `PracticeResult = { hits, goTrials, correctRejections, noGoTrials, meanRt: number|null, attempt: number }` and `Recommendation = { level: 1|2|3|null, retry: boolean, abort: boolean }`. `abort`가 `true`면 `level`은 `null`이다.
  `interpret(metrics: Metrics, badge: Badge): string[]` — 0~2개의 완성된 한국어 문장.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/practice.test.js
test('연습을 완벽히 통과하고 빠르면 3단계를 추천한다', () => {
  expect(recommendLevel({ hits: 5, goTrials: 5, correctRejections: 3, noGoTrials: 3, meanRt: 900, attempt: 1 }))
    .toEqual({ level: 3, retry: false, abort: false });
});

test('정반응 3개 이상에 참기 1개 이상이면 2단계를 추천한다', () => {
  expect(recommendLevel({ hits: 3, goTrials: 5, correctRejections: 1, noGoTrials: 3, meanRt: 1500, attempt: 1 }))
    .toEqual({ level: 2, retry: false, abort: false });
});

test('완벽하지만 느리면 3단계가 아니라 2단계다', () => {
  expect(recommendLevel({ hits: 5, goTrials: 5, correctRejections: 3, noGoTrials: 3, meanRt: 1800, attempt: 1 }).level).toBe(2);
});

test('첫 시도에서 조건에 못 미치면 재시도를 요구한다', () => {
  expect(recommendLevel({ hits: 2, goTrials: 5, correctRejections: 0, noGoTrials: 3, meanRt: 2000, attempt: 1 }))
    .toEqual({ level: null, retry: true, abort: false });
});

test('재시도에서 조건에 못 미치면 1단계를 추천한다', () => {
  expect(recommendLevel({ hits: 2, goTrials: 5, correctRejections: 1, noGoTrials: 3, meanRt: 2000, attempt: 2 }).level).toBe(1);
});

test('재시도에서도 정반응이 1개 이하면 검사 중단을 권한다', () => {
  expect(recommendLevel({ hits: 1, goTrials: 5, correctRejections: 0, noGoTrials: 3, meanRt: null, attempt: 2 }))
    .toEqual({ level: null, retry: false, abort: true });
});
```

```js
// tests/interpretation.test.js
test('억제 실패가 후반에 몰리고 후반이 느려지면 지속 시간을 가리킨다', () => {
  const out = interpret(metricsWith({ halves: { first: { commissions: 1, meanRt: 548 }, second: { commissions: 4, meanRt: 681 } } }), okBadge);
  expect(out.join(' ')).toContain('지속');
});

test('억제 실패는 적고 누락이 많으면 주의력을 가리킨다', () => {
  const out = interpret(metricsWith({ commissions: 0, goTrials: 30, omissions: 9 }), okBadge);
  expect(out.join(' ')).toContain('주의');
});

test('해석 불가 배지면 해석 문장을 내지 않는다', () => {
  expect(interpret(metricsWith({}), { status: 'uninterpretable', reasons: ['omission'] })).toEqual([]);
});

test('문장은 최대 2개다', () => {
  const out = interpret(metricsWith({ commissions: 9, noGoTrials: 10, omissions: 9, goTrials: 30, consistency: 'poor', anticipatoryRate: 0.3 }), okBadge);
  expect(out.length).toBeLessThanOrEqual(2);
});

test('진단처럼 들리는 단어를 쓰지 않는다', () => {
  const banned = ['진단', '장애', '정상', '비정상', '지능'];
  for (const m of [metricsWith({}), metricsWith({ commissions: 9, noGoTrials: 10 })])
    for (const s of interpret(m, okBadge)) for (const w of banned) expect(s).not.toContain(w);
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/practice.test.js tests/interpretation.test.js`
Expected: FAIL — 두 모듈 모두 없다

- [ ] **Step 3: `recommendLevel`과 `interpret`을 구현한다**

`recommendLevel`: §5.3의 추천 표를 위에서 아래로 평가한다. `meanRt` 기준은 1.0초.

`interpret`: 스펙 §5.7의 "초안 규칙" 6줄을 `[조건 함수, 문장]` 쌍의 배열로 두고, 조건이 참인 것 중 **배열 앞쪽 2개까지** 반환한다. 문장은 코드가 아니라 테이블에만 있어야 한다 — 전문가 검토 후 테이블만 교체할 수 있어야 한다(§7).

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/practice.test.js tests/interpretation.test.js`
Expected: PASS (11 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/practice.js js/interpretation.js tests/practice.test.js tests/interpretation.test.js
git commit -m "feat: add practice recommendation and interpretation rules"
```

---

### Task 6: 테마와 수집 격자

**Files:**
- Create: `js/themes.js`
- Test: `tests/themes.test.js`

**Interfaces:**
- Consumes: `THRESHOLDS` from `js/config.js`
- Produces: `THEMES: Theme[]` where `Theme = { id, label, goGlyph, crossNoGoGlyph, sameNoGoGlyph, itemGlyph, completionGlyph }`; `getTheme(id): Theme`; `noGoGlyphFor(theme, level): string`; `rewardCellCount(trialCount): number`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/themes.test.js
test('테마가 6종이고 id가 중복되지 않는다', () => {
  expect(THEMES).toHaveLength(6);
  expect(new Set(THEMES.map(t => t.id)).size).toBe(6);
});

test('모든 테마가 필요한 그림을 다 갖고 있다', () => {
  for (const t of THEMES)
    for (const k of ['goGlyph', 'crossNoGoGlyph', 'sameNoGoGlyph', 'itemGlyph', 'completionGlyph'])
      expect(t[k]).toBeTruthy();
});

test('테마 안에서 Go 그림과 두 No-Go 그림이 모두 서로 다르다', () => {
  for (const t of THEMES)
    expect(new Set([t.goGlyph, t.crossNoGoGlyph, t.sameNoGoGlyph]).size).toBe(3);
});

test('1·2단계는 다른 범주 그림을, 3단계는 같은 범주 그림을 쓴다', () => {
  const t = getTheme('animal');
  expect(noGoGlyphFor(t, 1)).toBe(t.crossNoGoGlyph);
  expect(noGoGlyphFor(t, 2)).toBe(t.crossNoGoGlyph);
  expect(noGoGlyphFor(t, 3)).toBe(t.sameNoGoGlyph);
});

test('격자 칸 수는 전체 문항의 70%를 내림한 값이고 최소 1칸이다', () => {
  expect(rewardCellCount(50)).toBe(35);  // 35.0 — 정수로 떨어짐
  expect(rewardCellCount(18)).toBe(12);  // 12.6 → 내림
  expect(rewardCellCount(65)).toBe(45);  // 45.5 → 내림 (반올림이면 46)
  expect(rewardCellCount(1)).toBe(1);    // 0.7 → 내림 0 → 최소 1로 올림
});

test('격자 칸 수는 전체 문항 수보다 적다', () => {
  for (const n of [18, 22, 30, 50, 65, 85, 100]) expect(rewardCellCount(n)).toBeLessThan(n);
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/themes.test.js`
Expected: FAIL — `js/themes.js`가 없다

- [ ] **Step 3: `js/themes.js`를 구현한다**

테마 6종: `animal`(동물), `vehicle`(탈것), `food`(음식), `fruit`(과일), `shape`(도형), `weather`(날씨). 각 테마의 `sameNoGoGlyph`는 같은 범주 안에서 **한눈에 다른** 대상이어야 한다 — 동물 테마는 강아지/고양이 수준(§5.2). 그림은 이모지로 두고 외부 이미지 파일을 쓰지 않는다.

`rewardCellCount`는 **내림 후 최소 1**이다. 반올림이 아니라 내림인 이유는 70%를 넘지 않는 것이 보장되어 격자가 문항 수보다 커질 수 없고, 단조 증가한다는 것이다. (`85 × 0.7`은 부동소수점에서 `59.4999...`이므로 반올림도 59를 준다 — 이 값은 두 규칙을 구분하지 못한다. 구분되는 값은 65(내림 45 / 반올림 46)와 18(12 / 13)이다.)

**아이템 그림은 그 테마의 자극 그림 셋 중 어느 것과도 같은 범주가 아니어야 한다.** 검사 중 격자에 아이템이 쌓이는 것을 학생이 보면서 자극을 판단하므로, 아이템이 자극과 같은 범주면 시각적 간섭이 된다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/themes.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/themes.js tests/themes.test.js
git commit -m "feat: add theme definitions and reward grid sizing"
```

---

### Task 7: 저장과 측정 조건 기록

**Files:**
- Create: `js/deviceInfo.js`
- Create: `js/storage.js`
- Test: `tests/storage.test.js`

**Interfaces:**
- Consumes: `TOOL_VERSION` from `js/config.js`
- Produces:
  `collectDeviceInfo(win?): DeviceInfo` where `DeviceInfo = { kind: 'phone'|'tablet'|'desktop', screenW, screenH, dpr, browser, inputKind: 'touch'|'mouse', refreshHzEst: number|null }`.
  `Session = { id, studentAlias, startedAt, endedAt, complete, level, themeId, length, trialCount, responses, practice, device, toolVersion }`.
  `saveSession(session): { ok: boolean, error?: string }`; `isAvailable(): boolean`; `listStudents(): string[]`; `listSessions(alias): Session[]`; `getSession(id): Session|null`; `trendSessions(alias, level): Session[]`; `replaceAll(sessions): { ok, error? }`; `lastSetup(): { alias, themeId, level, length } | null`; `saveLastSetup(setup): void`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/storage.test.js — 각 테스트 전에 메모리 localStorage 스텁을 주입한다
test('저장한 회차를 학생별로 되읽는다', () => {
  saveSession(sessionFixture({ id: 'a', studentAlias: '학생1' }));
  expect(listStudents()).toEqual(['학생1']);
  expect(listSessions('학생1').map(s => s.id)).toEqual(['a']);
});

test('모든 회차에 도구 버전과 측정 조건이 함께 저장된다', () => {
  saveSession(sessionFixture({ id: 'a' }));
  const s = getSession('a');
  expect(s.toolVersion).toBe(TOOL_VERSION);
  expect(s.device).toMatchObject({ kind: expect.any(String), inputKind: expect.any(String) });
});

test('추이는 같은 단계의 완료 세션만 돌려준다', () => {
  saveSession(sessionFixture({ id: 'a', level: 2, complete: true }));
  saveSession(sessionFixture({ id: 'b', level: 2, complete: false }));
  saveSession(sessionFixture({ id: 'c', level: 3, complete: true }));
  expect(trendSessions('학생1', 2).map(s => s.id)).toEqual(['a']);
});

test('미완료 세션도 저장되고 목록에는 남는다', () => {
  saveSession(sessionFixture({ id: 'b', complete: false }));
  expect(listSessions('학생1').map(s => s.id)).toContain('b');
});

test('localStorage를 쓸 수 없으면 저장만 실패하고 예외를 던지지 않는다', () => {
  // Review Focus 1
  stubStorageThatThrows();
  const r = saveSession(sessionFixture({ id: 'a' }));
  expect(r.ok).toBe(false);
  expect(r.error).toBeTruthy();
  expect(isAvailable()).toBe(false);
});

test('용량이 꽉 차면 저장만 실패하고 이미 저장된 회차는 그대로다', () => {
  // Review Focus 1
  saveSession(sessionFixture({ id: 'a' }));
  stubStorageThatThrowsQuotaExceeded();
  expect(saveSession(sessionFixture({ id: 'b' })).ok).toBe(false);
  restoreStorage();
  expect(getSession('a')).not.toBeNull();
});

test('지난 설정을 저장하고 되읽는다', () => {
  saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
  expect(lastSetup()).toMatchObject({ themeId: 'animal', level: 2 });
});

test('저장된 데이터가 없으면 지난 설정은 null이다', () => {
  expect(lastSetup()).toBeNull();
});

test('연습 결과를 추천 근거로 회차에 함께 저장한다', () => {
  saveSession(sessionFixture({ id: 'a', practice: { hits: 4, goTrials: 5, correctRejections: 2, noGoTrials: 3, meanRt: 1200, attempt: 1, recommendedLevel: 2 } }));
  expect(getSession('a').practice).toMatchObject({ recommendedLevel: 2, attempt: 1 });
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/storage.test.js`
Expected: FAIL — `js/storage.js`가 없다

- [ ] **Step 3: `collectDeviceInfo`와 저장 함수들을 구현한다**

`storage.js`는 모든 `localStorage` 접근을 try/catch로 감싸고 실패를 `{ ok: false, error }`로 돌려준다 — 절대 던지지 않는다. 데이터는 단일 키에 JSON으로 두고 스키마 버전 번호를 함께 저장한다.

`collectDeviceInfo`의 `refreshHzEst`는 `requestAnimationFrame` 간격을 몇 프레임 재서 추정하고, 잴 수 없으면 `null`.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/storage.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/deviceInfo.js js/storage.js tests/storage.test.js
git commit -m "feat: add session storage with device metadata and failure tolerance"
```

---

### Task 8: 내보내기와 가져오기

**Files:**
- Create: `js/exportImport.js`
- Test: `tests/exportImport.test.js`

**Interfaces:**
- Consumes: `Session` from Task 7, `TOOL_VERSION` from `js/config.js`
- Produces: `toTrialCsv(sessions: Session[]): string`; `toBackupJson(sessions: Session[]): string`; `parseBackupJson(text: string): { sessions: Session[], warnings: string[] }`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/exportImport.test.js
test('CSV는 문항 한 줄씩이고 머리글에 분석에 필요한 열이 다 있다', () => {
  const csv = toTrialCsv([sessionFixture({ trialCount: 2 })]);
  const [header, ...rows] = csv.trim().split('\n');
  for (const col of ['session_id','student_alias','started_at','tool_version','level','theme_id','length',
                     'trial_count','complete','trial_index','trial_type','rt_ms','outcome','anticipatory',
                     'extra_taps','invalid','device_kind','screen_w','screen_h','refresh_hz_est',
                     'browser','input_kind'])
    expect(header).toContain(col);
  expect(rows).toHaveLength(2);
});

test('outcome 열이 metrics.js의 정의를 따른다', () => {
  const csv = toTrialCsv([sessionFixture({ responses: [go(500), go(null), nogo(300), nogo(null)] })]);
  const outcomes = csv.trim().split('\n').slice(1).map(r => r.split(',')[columnIndex(csv, 'outcome')]);
  expect(outcomes).toEqual(['hit', 'omission', 'commission', 'correct_rejection']);
});

test('200ms 미만의 Go 반응은 hit이 아니라 anticipatory다', () => {
  // metrics.js는 이 문항을 정반응으로 세지 않는다. CSV가 hit으로 적으면
  // 논문이 CSV에서 센 정반응 수와 화면이 보여준 수가 달라진다.
  const csv = toTrialCsv([sessionFixture({ responses: [go(100), go(500)] })]);
  const outcomes = csv.trim().split('\n').slice(1).map(r => r.split(',')[columnIndex(csv, 'outcome')]);
  expect(outcomes).toEqual(['anticipatory', 'hit']);
});

test('쉼표나 줄바꿈이 든 별칭을 넣어도 CSV 열이 밀리지 않는다', () => {
  const csv = toTrialCsv([sessionFixture({ studentAlias: '학생,1\n2', trialCount: 1 })]);
  expect(csv.trim().split('\n').slice(1)[0]).toMatch(/^"?[^,]*"/);
  expect(parseCsvRow(csv)).toHaveLength(headerLength(csv));
});

test('JSON 내보내기와 가져오기가 왕복한다', () => {
  const sessions = [sessionFixture({ id: 'a' }), sessionFixture({ id: 'b' })];
  const { sessions: back, warnings } = parseBackupJson(toBackupJson(sessions));
  expect(back.map(s => s.id)).toEqual(['a', 'b']);
  expect(warnings).toEqual([]);
});

test('깨진 JSON을 주면 세션 0개와 경고를 돌려주고 던지지 않는다', () => {
  // Review Focus 2
  const r = parseBackupJson('{ this is not json');
  expect(r.sessions).toEqual([]);
  expect(r.warnings.length).toBeGreaterThan(0);
});

test('읽을 수 없는 회차는 건너뛰고 나머지는 받아들이며 경고를 남긴다', () => {
  // Review Focus 2
  const text = JSON.stringify({ schema: 1, toolVersion: TOOL_VERSION, sessions: [sessionFixture({ id: 'a' }), { id: 'b' }] });
  const r = parseBackupJson(text);
  expect(r.sessions.map(s => s.id)).toEqual(['a']);
  expect(r.warnings.length).toBe(1);
});

test('다른 도구 버전으로 만든 파일은 받아들이되 경고를 남긴다', () => {
  // Review Focus 2
  const text = JSON.stringify({ schema: 1, toolVersion: '0.0.1-old', sessions: [sessionFixture({ id: 'a' })] });
  const r = parseBackupJson(text);
  expect(r.sessions).toHaveLength(1);
  expect(r.warnings.join(' ')).toContain('버전');
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/exportImport.test.js`
Expected: FAIL — `toTrialCsv is not a function`

- [ ] **Step 3: `js/exportImport.js`를 구현한다**

CSV는 쉼표·따옴표·줄바꿈이 든 값을 RFC 4180 방식으로 감싼다. `parseBackupJson`은 절대 던지지 않고, 필수 필드(`id`, `studentAlias`, `level`, `responses`)가 있는 회차만 통과시킨다. **가져오기 함수는 저장소를 건드리지 않는다** — 병합 여부는 호출자(Task 14)가 결정한다.

**`outcome` 열은 `js/metrics.js`의 정의를 따른다.** 값은 `hit`, `omission`, `commission`, `correct_rejection`, `anticipatory` 다섯 가지다. Go 문항의 200ms 미만 반응은 `anticipatory`이고 `hit`이 아니다 — `metrics.js`가 그 문항을 정반응으로 세지 않기 때문이다. No-Go 문항의 200ms 미만 반응은 `commission`이면서 `anticipatory` 열이 1이다(중복 계상이 맞다, §5.7). 이 일치가 깨지면 논문이 CSV에서 센 수와 도구가 화면에 보여준 수가 달라진다.

**유효성 조건은 `js/storage.js`에서 가져온다.** `storage.js`가 `validationError`를 export하고 `exportImport.js`가 그것을 import한다. 두 모듈이 같은 조건을 각자 적으면 조용히 어긋나고, 그러면 `parseBackupJson`이 통과시킨 세션이 `replaceAll`에서 **배열 전체와 함께 거부**된다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/exportImport.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/exportImport.js tests/exportImport.test.js
git commit -m "feat: add trial-level CSV export and tolerant JSON import"
```

---

### Task 9: 타이밍 엔진

**Files:**
- Create: `js/engine.js`
- Test: `tests/engine.test.js`

**Interfaces:**
- Consumes: `LEVELS`, `THRESHOLDS` from `js/config.js`; `Trial` from Task 2
- Produces: `createEngine(opts): Engine`.
  `opts = { trials: Trial[], levelParams: LevelParams, hooks: { onStimulus(trial), onStimulusEnd(trial), onTrialComplete(response), onFinish(responses) }, clock: { now(): number, setTimeout, clearTimeout } }`.
  `Engine = { start(), input(eventTimeStampMs), markStimulusRendered(renderedAtMs), pause(), resume(), abort(), responses(): Response[] }`.
  `Response`는 Task 3의 모양과 같다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/engine.test.js — fakeClock()은 시간을 수동으로 전진시키는 헬퍼
test('반응이 들어오면 자극을 즉시 끝내고 다음 문항으로 넘어간다', () => {
  const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
  engine.start(); clock.advance(600); engine.input(clock.now());
  expect(hooks.onStimulusEnd).toHaveBeenCalledTimes(1);
  clock.advance(LEVELS[1].interTrialMs);
  expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
});

test('반응시간은 이벤트 시각에서 자극이 그려진 시각을 뺀 값이다', () => {
  const { engine, clock } = setup({ trials: [goTrial(0)], level: 2 });
  engine.start(); engine.markStimulusRendered(clock.now() + 16);
  clock.advance(500); engine.input(clock.now());
  expect(engine.responses()[0].rtMs).toBe(484);
});

test('허용 구간은 제시 시간에 0.5초를 더한 값이고 그 뒤 입력은 무시된다', () => {
  const { engine, clock } = setup({ trials: [goTrial(0)], level: 3 });
  engine.start();
  clock.advance(LEVELS[3].stimulusMs + THRESHOLDS.responseGraceMs + 1);
  engine.input(clock.now());
  expect(engine.responses()[0].rtMs).toBeNull();
});

test('No-Go 문항은 반응이 없으면 제시 시간을 끝까지 쓴다', () => {
  const { engine, clock, hooks } = setup({ trials: [nogoTrial(0), goTrial(1)], level: 2 });
  engine.start(); clock.advance(LEVELS[2].stimulusMs);
  expect(hooks.onStimulusEnd).toHaveBeenCalledTimes(1);
});

test('같은 문항에서 연타하면 첫 입력만 반응시간이 되고 나머지는 연타로 센다', () => {
  // Review Focus 5
  const { engine, clock } = setup({ trials: [goTrial(0)], level: 1 });
  engine.start();
  clock.advance(400); engine.input(clock.now());
  engine.input(clock.now()); engine.input(clock.now());
  const r = engine.responses()[0];
  expect(r.rtMs).toBe(400); expect(r.extraTaps).toBe(2);
});

test('화면이 가려지면 진행 중 문항을 무효로 표시하고 멈춘다', () => {
  // Review Focus 3
  const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
  engine.start(); clock.advance(300); engine.pause();
  expect(engine.responses()[0].invalid).toBe(true);
  clock.advance(60000);
  expect(hooks.onStimulus).toHaveBeenCalledTimes(1);
});

test('복귀하면 다음 문항부터 재개한다', () => {
  // Review Focus 3
  const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
  engine.start(); clock.advance(300); engine.pause(); engine.resume();
  clock.advance(LEVELS[1].interTrialMs);
  expect(hooks.onStimulus).toHaveBeenCalledTimes(2);
  expect(hooks.onStimulus.mock.calls[1][0].index).toBe(1);
});

test('가려짐이 반복되면 무효 문항이 누적된다', () => {
  // Review Focus 3
  const { engine, clock } = setup({ trials: [goTrial(0), goTrial(1), goTrial(2)], level: 1 });
  engine.start();
  for (let i = 0; i < 2; i++) { clock.advance(200); engine.pause(); engine.resume(); clock.advance(LEVELS[1].interTrialMs); }
  expect(engine.responses().filter(r => r.invalid)).toHaveLength(2);
});

test('마지막 문항이 끝나면 onFinish에 모든 반응을 넘긴다', () => {
  const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 3 });
  engine.start();
  runToEnd(clock);
  expect(hooks.onFinish).toHaveBeenCalledTimes(1);
  expect(hooks.onFinish.mock.calls[0][0]).toHaveLength(2);
});

test('중단하면 그 시점까지의 반응만 남고 onFinish가 불리지 않는다', () => {
  const { engine, clock, hooks } = setup({ trials: [goTrial(0), goTrial(1)], level: 1 });
  engine.start(); clock.advance(300); engine.abort();
  expect(hooks.onFinish).not.toHaveBeenCalled();
  expect(engine.responses()).toHaveLength(1);
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/engine.test.js`
Expected: FAIL — `createEngine is not a function`

- [ ] **Step 3: `createEngine(opts)`를 `js/engine.js`에 구현한다**

상태 기계: `idle → stimulus → grace → gap → (다음 문항 | finished)`. 자극 시작 시각의 기준은 `markStimulusRendered`가 들어오면 그 값, 없으면 자극 시작 시각. `pause()`는 진행 중 문항을 `invalid: true`로 닫고 모든 타이머를 해제한다. DOM과 `document.visibilityState`를 직접 보지 않는다 — `pause`/`resume`은 호출자(Task 12)가 부른다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/engine.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/engine.js tests/engine.test.js
git commit -m "feat: add trial timing engine with response-terminated stimuli"
```

---

### Task 10: 앱 셸, 화면 전환, 소리

**Files:**
- Create: `index.html`
- Create: `css/app.css`
- Create: `js/router.js`
- Create: `js/audio.js`
- Create: `js/main.js`
- Test: `tests/router.test.js`

**Interfaces:**
- Consumes: 없음
- Produces: `createRouter(rootEl, screens): Router` where `screens` maps a name to `{ mount(rootEl, params): void, unmount?(): void }` and `Router = { go(name, params), current(): string }`. `js/audio.js`: `unlock(): void`, `playCorrect(): void`, `playStimulus(): void`, `setEnabled(on: boolean): void`.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/router.test.js — jsdom 환경
test('go는 해당 화면을 마운트한다', () => {
  const root = document.createElement('div');
  const a = { mount: vi.fn() }, b = { mount: vi.fn() };
  createRouter(root, { a, b }).go('a', { x: 1 });
  expect(a.mount).toHaveBeenCalledWith(root, { x: 1 });
});

test('다음 화면으로 가기 전에 이전 화면을 정리한다', () => {
  const root = document.createElement('div');
  const a = { mount: vi.fn(), unmount: vi.fn() }, b = { mount: vi.fn() };
  const r = createRouter(root, { a, b });
  r.go('a'); r.go('b');
  expect(a.unmount).toHaveBeenCalledTimes(1);
  expect(r.current()).toBe('b');
});

test('없는 화면으로 가면 던지고 현재 화면을 유지한다', () => {
  const r = createRouter(document.createElement('div'), { a: { mount: vi.fn() } });
  r.go('a');
  expect(() => r.go('nope')).toThrow();
  expect(r.current()).toBe('a');
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/router.test.js`
Expected: FAIL — `createRouter is not a function`

- [ ] **Step 3: 셸을 구현한다**

`index.html`: `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">`, 루트 `<div id="app">`, `<script type="module" src="js/main.js">` 하나. 외부 스크립트를 로드하지 않는다.

`css/app.css`: 색·간격을 `:root` 커스텀 속성으로 두고, 세로 모드 스마트폰이 기준. 검사 화면에서 `touch-action: manipulation`, `user-select: none`, `overscroll-behavior: none`. `@media (prefers-reduced-motion: reduce)`에서 애니메이션을 끈다.

`js/audio.js`: Web Audio API로 짧은 톤을 합성한다. 음원 파일 없음. `unlock()`은 첫 `pointerdown`에서 `AudioContext`를 깨운다. 오반응용 소리는 **만들지 않는다**(Global Constraints).

`js/main.js`: 라우터를 만들고 Task 11~14의 화면을 등록해 설정 화면으로 보낸다. 이 태스크에서는 아직 등록할 화면이 없으므로 플레이스홀더 화면 하나를 띄우고, 이후 태스크가 교체한다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/router.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: 브라우저에서 확인한다**

로컬 정적 서버로 `index.html`을 열어 콘솔 오류가 없고 플레이스홀더가 뜨는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add index.html css/app.css js/router.js js/audio.js js/main.js tests/router.test.js
git commit -m "feat: add app shell, screen router, and synthesized audio"
```

---

### Task 11: 교사 설정 화면

**Files:**
- Create: `js/screens/setup.js`
- Modify: `js/main.js`
- Test: `tests/screens.setup.test.js`

**Interfaces:**
- Consumes: `THEMES`, `TRIAL_COUNTS`, `LEVELS`, `THRESHOLDS`, `storage.lastSetup/saveLastSetup/listStudents`
- Produces: `createSetupScreen(deps): { mount(rootEl, { onStart, onHistory }), unmount() }`. `onStart({ alias, themeId, length, levelOverride: 1|2|3|null })`. `deps = { audio, createEngine }`는 `js/main.js`가 조립해 넘긴다 — 화면 모듈은 그 모듈들을 직접 import하지 않고 `deps`로 받으므로, 테스트가 호출을 관찰할 수 있다. 이 **팩토리 형태(`createXxxScreen(deps)`)가 네 화면 모두의 규약**이다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/screens.setup.test.js — jsdom 환경
test('별칭 사용 안내를 보여준다', () => {
  mountSetup();
  expect(document.body.textContent).toMatch(/별칭/);
});

test('참아야 할 문항이 8개 미만인 조합을 고르면 경고를 띄운다', () => {
  mountSetup();
  selectLength('short'); selectLevelOverride(1);
  expect(document.body.textContent).toMatch(/참고용|부족/);
});

test('참아야 할 문항이 충분한 조합에는 경고가 없다', () => {
  mountSetup();
  selectLength('medium'); selectLevelOverride(2);
  expect(document.body.textContent).not.toMatch(/참고용|부족/);
});

test('같은 기기로 반복 검사해야 추이가 쌓인다는 안내가 있다', () => {
  mountSetup();
  expect(document.body.textContent).toMatch(/같은 기기/);
});

test('지난 설정이 있으면 바로 시작 버튼이 그 값으로 onStart를 부른다', () => {
  saveLastSetup({ alias: '학생1', themeId: 'animal', level: 2, length: 'medium' });
  const onStart = vi.fn(); mountSetup({ onStart });
  clickQuickStart();
  expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ alias: '학생1', themeId: 'animal', length: 'medium' }));
});

test('지난 설정이 없으면 바로 시작 버튼이 없다', () => {
  mountSetup();
  expect(quickStartButton()).toBeNull();
});

test('소리 켜기·끄기를 교사가 고를 수 있고 선택이 오디오에 전달된다', () => {
  const audio = mountSetup().audio;
  toggleSound(false);
  expect(audio.setEnabled).toHaveBeenCalledWith(false);
});

test('애니메이션 줄이기 수동 토글이 있고 선택이 유지된다', () => {
  mountSetup(); toggleReducedMotion(true); remountSetup();
  expect(reducedMotionToggle().checked).toBe(true);
  expect(document.documentElement.dataset.reducedMotion).toBe('true');
});

test('저장을 쓸 수 없는 기기면 그 사실을 알린다', () => {
  // Review Focus 1
  stubStorageThatThrows(); mountSetup();
  expect(document.body.textContent).toMatch(/저장/);
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/screens.setup.test.js`
Expected: FAIL — `js/screens/setup.js`가 없다

- [ ] **Step 3: `setupScreen`을 구현하고 `js/main.js`에 등록한다**

학생 별칭 입력(기존 별칭 목록에서 고르기 포함), 테마 선택, 길이 선택, 난이도 수동 지정(기본은 "연습으로 결정"), 소리 토글, 애니메이션 줄이기 토글, 결과 보기 진입, 시작 버튼, 그리고 지난 설정이 있을 때의 "지난 설정으로 바로 시작". 경고 문구는 `TRIAL_COUNTS × LEVELS[].noGoRatio`를 `THRESHOLDS.minNoGoTrials`와 비교해 띄운다. 두 토글은 `localStorage`에 남기고, 애니메이션 토글은 `<html data-reduced-motion>`으로 반영해 `css/app.css`의 규칙이 `prefers-reduced-motion`과 같은 효과를 내게 한다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/screens.setup.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/screens/setup.js js/main.js tests/screens.setup.test.js
git commit -m "feat: add teacher setup screen with no-go shortage warning"
```

---

### Task 12: 검사 화면과 연습 화면

**Files:**
- Create: `js/screens/task.js`
- Create: `js/screens/practiceScreen.js`
- Modify: `js/main.js`
- Test: `tests/screens.task.test.js`

**Interfaces:**
- Consumes: `createEngine`, `generateSequence`, `THEMES`/`noGoGlyphFor`/`rewardCellCount`, `recommendLevel`, `audio`, `LEVELS`, `PRACTICE`, `THRESHOLDS`
- Produces:
  `taskScreen: { mount(rootEl, { trials, level, theme, onFinish, onAbort, deps }), unmount() }` — `onFinish(responses)`, `onAbort(responses)`.
  `practiceScreen: { mount(rootEl, { theme, attempt, onDone, deps }), unmount() }` — `onDone(recommendation, practiceResult)`.
  두 화면 모두 `deps = { createEngine, audio }`를 받는다. 생략하면 실제 모듈을 쓰고, 테스트는 대역을 주입한다 — 엔진 호출(`input`/`pause`/`resume`)과 소리 호출을 관찰할 수 있어야 한다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/screens.task.test.js — jsdom 환경
test('학생 화면에 문장이 없다', () => {
  mountTask();
  expect(document.querySelector('[data-student-view]').textContent.replace(/\s/g, '')).toMatch(/^[\p{Emoji}\p{So}0-9/]*$/u);
});

test('반응 영역이 화면 하단 절반을 차지한다', () => {
  mountTask();
  const el = document.querySelector('[data-response-area]');
  expect(el.dataset.area).toBe('bottom-half');
});

test('pointerdown으로 반응을 받고 click은 쓰지 않는다', () => {
  const { engine } = mountTask();
  document.querySelector('[data-response-area]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(engine.input).toHaveBeenCalledTimes(1);
  document.querySelector('[data-response-area]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(engine.input).toHaveBeenCalledTimes(1);
});

test('정반응과 참기 성공에 격자 칸이 하나씩 채워진다', () => {
  mountTask({ trials: [goTrial(0), nogoTrial(1)] });
  completeTrial({ type: 'go', rtMs: 500 });
  expect(filledCells()).toBe(1);
  completeTrial({ type: 'nogo', rtMs: null });
  expect(filledCells()).toBe(2);
});

test('격자 칸 수는 전체 문항의 70%다', () => {
  mountTask({ trials: trialsOf(50) });
  expect(totalCells()).toBe(35);
});

test('조급 반응으로 맞춘 Go 문항은 칸을 채우지 않는다', () => {
  mountTask();
  completeTrial({ type: 'go', rtMs: 100 });
  expect(filledCells()).toBe(0);
});

test('오반응에 소리나 표시가 나오지 않는다', () => {
  const audio = mountTask().audio;
  completeTrial({ type: 'nogo', rtMs: 300 });
  expect(audio.playCorrect).not.toHaveBeenCalled();
  expect(document.querySelector('[data-error-feedback]')).toBeNull();
});

test('격자가 덜 찼어도 종료 애니메이션이 재생된다', () => {
  mountTask({ trials: trialsOf(4) });
  finishWith([go(null), go(null), go(null), go(null)]);
  expect(document.querySelector('[data-completion]')).not.toBeNull();
});

test('화면이 가려지면 엔진을 멈추고 복귀하면 재개한다', () => {
  // Review Focus 3
  const { engine } = mountTask();
  fireVisibility('hidden'); expect(engine.pause).toHaveBeenCalled();
  fireVisibility('visible'); expect(engine.resume).toHaveBeenCalled();
});

test('중단 조작은 학생이 우연히 누를 수 없는 방식이다', () => {
  const { onAbort } = mountTask();
  const btn = document.querySelector('[data-abort]');
  btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(onAbort).not.toHaveBeenCalled(); // 길게 눌러야 한다
  holdFor(btn, 1500);
  expect(onAbort).toHaveBeenCalled();
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/screens.task.test.js`
Expected: FAIL — `js/screens/task.js`가 없다

- [ ] **Step 3: 두 화면을 구현하고 `js/main.js`에 등록한다**

`taskScreen`: 상단 절반에 자극, 가운데 얇은 띠에 격자, 하단 절반에 반응 영역. `document.visibilitychange`를 듣고 엔진의 `pause`/`resume`을 부른다. 시작 시 전체화면을 **요청하되 거부되어도 그대로 진행한다**(§5.10 — 권장하되 강제하지 않는다). 자극을 그린 직후 `requestAnimationFrame`에서 `markStimulusRendered`를 호출한다. 중단 버튼은 화면 구석에 두고 1초 이상 눌러야 동작한다. 채워지는 애니메이션은 300ms 이내이고 자극 영역을 가리지 않는다.

`practiceScreen`: `PRACTICE` 설정으로 2단계 타이밍의 8문항을 돌린 뒤 `recommendLevel`을 호출한다. 규칙 시범(그림이 나오고 버튼이 스스로 눌리는 연출)을 먼저 보여준다. 글은 쓰지 않는다. 추천 결과 화면은 `THRESHOLDS.practiceAutoAdvanceMs` 뒤 자동 진행하고, 중단 안내는 교사용 문구로 띄운다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/screens.task.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: 브라우저에서 확인한다**

스마트폰 폭(375×812)으로 한 세션을 끝까지 돌려서, 반응 영역이 엄지로 닿는 위치인지와 격자 애니메이션이 자극을 가리지 않는지 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add js/screens/task.js js/screens/practiceScreen.js js/main.js tests/screens.task.test.js
git commit -m "feat: add task and practice screens with wordless student view"
```

---

### Task 13: 결과 화면

**Files:**
- Create: `js/screens/result.js`
- Modify: `js/main.js`
- Test: `tests/screens.result.test.js`

**Interfaces:**
- Consumes: `computeMetrics`, `evaluateBadge`, `interpret`, `storage.trendSessions`, `THRESHOLDS`
- Produces: `resultScreen: { mount(rootEl, { session, onBack }), unmount() }`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/screens.result.test.js — jsdom 환경
test('머리글에 난이도 단계와 테마, 실제 소요 시간, 문항 수, 도구 버전을 적는다', () => {
  mountResult({ session: sessionFixture({ level: 2, themeId: 'animal', trialCount: 65 }) });
  const head = document.querySelector('[data-report-header]').textContent;
  for (const s of ['2단계', '65']) expect(head).toContain(s);
});

test('억제 실패와 누락을 따로 보여준다', () => {
  mountResult({ session: sessionFixture({ responses: [nogo(300), go(null)] }) });
  expect(tileValue('commissions')).toBe('1');
  expect(tileValue('omissions')).toBe('1');
});

test('배지가 상태와 이유 문구를 함께 보여준다', () => {
  mountResult({ session: sessionFixture({ responses: Array(10).fill(go(null)) }) });
  expect(document.querySelector('[data-badge]').dataset.status).toBe('uninterpretable');
  expect(document.querySelector('[data-badge]').textContent.trim().length).toBeGreaterThan(0);
});

test('참아야 할 문항이 부족하면 억제 지표에 참고용 표시가 붙는다', () => {
  // Review Focus 4
  mountResult({ session: sessionFixture({ level: 1, length: 'short', trialCount: 18 }) });
  expect(document.querySelector('[data-tile="commissions"]').dataset.reference).toBe('true');
});

test('억제 실패와 조급 반응의 합이 문항 수를 넘을 수 있다는 설명을 둔다', () => {
  mountResult({ session: sessionFixture({ responses: [nogo(120)] }) });
  expect(document.body.textContent).toMatch(/중복/);
});

test('문항별 흐름 띠가 가로 스크롤되고 문항마다 막대가 하나다', () => {
  mountResult({ session: sessionFixture({ trialCount: 100 }) });
  const strip = document.querySelector('[data-trial-strip]');
  expect(strip.dataset.scroll).toBe('horizontal');
  expect(strip.querySelectorAll('[data-trial-bar]')).toHaveLength(100);
});

test('추이 그래프는 같은 단계의 완료 세션만 그린다', () => {
  seedSessions([{ level: 2, complete: true }, { level: 3, complete: true }, { level: 2, complete: false }]);
  mountResult({ session: sessionFixture({ level: 2, complete: true }) });
  expect(document.querySelectorAll('[data-trend-point]')).toHaveLength(2); // 기존 1개 + 현재 1개
});

test('기기 간 절대 반응시간 비교를 하지 말라는 안내가 있다', () => {
  mountResult({ session: sessionFixture({}) });
  expect(document.body.textContent).toMatch(/같은 기기/);
});

test('해석 불가 배지면 해석 문장을 보여주지 않는다', () => {
  mountResult({ session: sessionFixture({ responses: Array(10).fill(go(null)) }) });
  expect(document.querySelector('[data-interpretation]')).toBeNull();
});

test('저장에 실패한 회차는 그 사실을 알린다', () => {
  // Review Focus 1
  mountResult({ session: sessionFixture({}), saveError: '저장 공간이 부족합니다' });
  expect(document.body.textContent).toMatch(/저장/);
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/screens.result.test.js`
Expected: FAIL — `js/screens/result.js`가 없다

- [ ] **Step 3: `resultScreen`을 구현하고 `js/main.js`에 등록한다**

§5.7의 구성 순서를 따른다: 머리글 → 배지 → 요약 타일 6개 → 문항별 흐름 띠 → 전반/후반 → 추이 → 해석 한 줄. `ReasonCode`를 교사용 문구로 바꾸는 매핑을 이 모듈에 둔다. 좁은 화면 우선 — 타일은 2열로 접히고, 흐름 띠는 가로 스크롤 띠에 전체 축소 요약을 위에 얹는다. 막대는 색과 모양을 함께 써서 색만으로 구분되지 않게 한다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/screens.result.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: 브라우저에서 확인한다**

스마트폰 폭에서 100문항 결과를 열어 가로 스크롤과 타일 접힘을 확인한다.

- [ ] **Step 6: 커밋**

```bash
git add js/screens/result.js js/main.js tests/screens.result.test.js
git commit -m "feat: add result screen with badge, trial strip, and same-level trend"
```

---

### Task 14: 이력 화면, 내보내기·가져오기, PIN

**Files:**
- Create: `js/screens/history.js`
- Create: `js/pin.js`
- Modify: `js/main.js`
- Test: `tests/screens.history.test.js`
- Test: `tests/pin.test.js`

**Interfaces:**
- Consumes: `storage.*`, `toTrialCsv`, `toBackupJson`, `parseBackupJson`
- Produces: `historyScreen: { mount(rootEl, { onOpenSession, onBack }), unmount() }`; `js/pin.js`: `isEnabled(): boolean`, `setPin(pin: string|null): void`, `verify(pin: string): boolean`

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/pin.test.js
test('PIN은 기본으로 꺼져 있다', () => { expect(isEnabled()).toBe(false); });
test('PIN을 설정하면 켜지고 맞는 값만 통과한다', () => {
  setPin('1234');
  expect(isEnabled()).toBe(true);
  expect(verify('1234')).toBe(true); expect(verify('9999')).toBe(false);
});
test('PIN을 null로 설정하면 꺼진다', () => { setPin('1234'); setPin(null); expect(isEnabled()).toBe(false); });
```

```js
// tests/screens.history.test.js — jsdom 환경
test('미완료 회차를 중단으로 표시한다', () => {
  seedSessions([{ id: 'a', complete: false }]);
  mountHistory();
  expect(row('a').textContent).toMatch(/중단/);
});

test('내보내기 버튼이 CSV와 JSON 두 가지를 제공한다', () => {
  mountHistory();
  expect(document.querySelector('[data-export="csv"]')).not.toBeNull();
  expect(document.querySelector('[data-export="json"]')).not.toBeNull();
});

test('가져오기는 기존 데이터를 지우지 않고 합친다', () => {
  // Review Focus 2
  seedSessions([{ id: 'a' }]);
  mountHistory(); importJson(JSON.stringify({ schema: 1, toolVersion: TOOL_VERSION, sessions: [sessionFixture({ id: 'b' })] }));
  expect(allSessionIds()).toEqual(expect.arrayContaining(['a', 'b']));
});

test('가져오기 경고를 교사에게 보여준다', () => {
  // Review Focus 2
  seedSessions([{ id: 'a' }]);
  mountHistory(); importJson('{ broken');
  expect(document.body.textContent).toMatch(/불러오지|경고|실패/);
  expect(allSessionIds()).toEqual(['a']);
});

test('PIN이 켜져 있으면 잠금 화면을 먼저 거친다', () => {
  setPin('1234'); mountHistory();
  expect(document.querySelector('[data-pin-gate]')).not.toBeNull();
  expect(document.querySelector('[data-session-row]')).toBeNull();
});

test('PIN이 꺼져 있으면 바로 목록이 보인다', () => {
  seedSessions([{ id: 'a' }]); mountHistory();
  expect(document.querySelector('[data-pin-gate]')).toBeNull();
  expect(row('a')).not.toBeNull();
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/pin.test.js tests/screens.history.test.js`
Expected: FAIL — 두 모듈 모두 없다

- [ ] **Step 3: `js/pin.js`와 `historyScreen`을 구현하고 `js/main.js`에 등록한다**

학생 목록 → 회차 목록 → 회차 열기. 회차 줄에 날짜, 난이도 단계, 테마, 길이, 완료 여부. 내보내기는 Blob + `URL.createObjectURL`로 다운로드한다. 가져오기는 `parseBackupJson` 결과를 **기존 데이터와 병합**하고(같은 `id`는 기존 것을 유지), 경고를 화면에 띄운다. PIN은 4자리 숫자, localStorage에 저장, 기본 꺼짐.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/pin.test.js tests/screens.history.test.js`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add js/screens/history.js js/pin.js js/main.js tests/pin.test.js tests/screens.history.test.js
git commit -m "feat: add history screen with export, merge import, and optional PIN"
```

---

### Task 15: 오프라인 동작과 설치

**Files:**
- Create: `sw.js`
- Create: `manifest.webmanifest`
- Modify: `index.html`
- Modify: `js/main.js`
- Test: `tests/manifest.test.js`

**Interfaces:**
- Consumes: `TOOL_VERSION` from `js/config.js`
- Produces: 없음 (배포 산출물)

- [ ] **Step 1: 실패하는 테스트를 쓴다**

```js
// tests/manifest.test.js — 파일을 읽어 검사한다
test('매니페스트가 세로 모드 설치형 앱으로 선언된다', () => {
  const m = JSON.parse(readFileSync('manifest.webmanifest', 'utf8'));
  expect(m.display).toBe('standalone');
  expect(m.orientation).toBe('portrait');
  expect(m.start_url).toBeTruthy();
  expect(m.icons.length).toBeGreaterThan(0);
});

test('서비스 워커가 캐시해야 할 파일을 모두 나열한다', () => {
  // listShippedFiles(): 저장소에서 index.html, manifest.webmanifest,
  // css/**/*.css, js/**/*.js 를 재귀로 모아 저장소 상대 경로로 돌려주는 테스트 헬퍼.
  // tests/, docs/, node_modules/, sw.js 자신은 제외한다.
  const sw = readFileSync('sw.js', 'utf8');
  for (const f of listShippedFiles()) expect(sw).toContain(f);
});

test('캐시 이름에 도구 버전이 들어가 배포 때 갈린다', () => {
  expect(readFileSync('sw.js', 'utf8')).toContain(TOOL_VERSION);
});

test('배포 산출물이 외부 스크립트나 스타일을 불러오지 않는다', () => {
  const html = readFileSync('index.html', 'utf8');
  expect(html).not.toMatch(/src="https?:/);
  expect(html).not.toMatch(/href="https?:.*\.css/);
});
```

- [ ] **Step 2: 테스트를 돌려 실패를 확인한다**

Run: `npx vitest run tests/manifest.test.js`
Expected: FAIL — `manifest.webmanifest`가 없다

- [ ] **Step 3: 서비스 워커와 매니페스트를 구현한다**

`sw.js`: install에서 모든 배포 파일을 `caches.open(`icp-${TOOL_VERSION}`)`에 넣고, fetch는 cache-first. activate에서 다른 버전 캐시를 지운다. `js/main.js`에서 등록하되, 등록 실패가 앱을 멈추지 않게 한다. `manifest.webmanifest`를 `index.html`에 연결한다.

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run tests/manifest.test.js`
Expected: PASS (4 tests)

- [ ] **Step 5: 브라우저에서 오프라인 동작을 확인한다**

로컬 정적 서버로 한 번 열고, 개발자도구에서 오프라인으로 전환한 뒤 새로고침해서 검사가 끝까지 되는지와 결과가 저장되는지 확인한다.

- [ ] **Step 6: 전체 테스트를 돌린다**

Run: `npm test`
Expected: PASS — 모든 테스트

- [ ] **Step 7: 커밋**

```bash
git add sw.js manifest.webmanifest index.html js/main.js tests/manifest.test.js
git commit -m "feat: add offline service worker and installable manifest"
```
