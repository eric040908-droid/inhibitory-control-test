import { recommendLevel } from '../js/practice.js';

// 기본값은 "완벽히 통과하고 빠른" 연습 결과. 각 테스트가 한 칸만 바꿔 경계를 본다.
function practiceWith(partial) {
  return { hits: 5, goTrials: 5, correctRejections: 3, noGoTrials: 3, meanRt: 900, attempt: 1, ...partial };
}

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

// ---- 경계 ----
// 아래 테스트는 §5.3 추천 표의 경계를 한 칸씩 고정한다. 경계를 옮기면 여기서 깨져야 한다.
// 경계 숫자(3개, 1개, 1000ms)는 일부러 리터럴로 쓴다 — config 값을 바꾸면 이 테스트가 알려 준다.

describe('3단계 경계', () => {
  test('평균 반응이 정확히 1.0초면 3단계가 아니다 ("1.0초 미만")', () => {
    expect(recommendLevel(practiceWith({ meanRt: 1000 })).level).toBe(2);
  });

  test('평균 반응이 999ms면 3단계다', () => {
    expect(recommendLevel(practiceWith({ meanRt: 999 })).level).toBe(3);
  });

  test('정반응이 하나라도 모자라면 3단계가 아니다', () => {
    expect(recommendLevel(practiceWith({ hits: 4 })).level).toBe(2);
  });

  test('참기가 하나라도 모자라면 3단계가 아니다', () => {
    expect(recommendLevel(practiceWith({ correctRejections: 2 })).level).toBe(2);
  });

  test('"전부"는 숫자 5/3이 아니라 받은 문항 수 기준이다', () => {
    expect(recommendLevel(practiceWith({ hits: 4, goTrials: 4, correctRejections: 2, noGoTrials: 2 })).level).toBe(3);
  });

  test('평균 반응이 null이면(측정 불가) 3단계로 올리지 않는다', () => {
    expect(recommendLevel(practiceWith({ meanRt: null })).level).toBe(2);
  });
});

describe('2단계 경계', () => {
  test('정반응 3개 + 참기 1개가 2단계의 하한이다', () => {
    expect(recommendLevel(practiceWith({ hits: 3, correctRejections: 1, meanRt: 1500 })).level).toBe(2);
  });

  test('정반응이 2개면 참기가 많아도 2단계가 아니다', () => {
    const r = recommendLevel(practiceWith({ hits: 2, correctRejections: 3, meanRt: 1500, attempt: 2 }));
    expect(r.level).toBe(1);
  });

  test('참기가 0개면 정반응이 많아도 2단계가 아니다', () => {
    const r = recommendLevel(practiceWith({ hits: 4, correctRejections: 0, meanRt: 1500, attempt: 2 }));
    expect(r.level).toBe(1);
  });

  test('2단계 추천은 시도 횟수와 상관없다', () => {
    const base = practiceWith({ hits: 3, correctRejections: 1, meanRt: 1500 });
    expect(recommendLevel({ ...base, attempt: 1 })).toEqual({ level: 2, retry: false, abort: false });
    expect(recommendLevel({ ...base, attempt: 2 })).toEqual({ level: 2, retry: false, abort: false });
  });
});

describe('재시도 · 1단계 · 중단 경계', () => {
  const failing = { hits: 2, correctRejections: 1, meanRt: 2000 };

  test('attempt 1에서 못 미치면 재시도, attempt 2에서는 1단계다', () => {
    expect(recommendLevel(practiceWith({ ...failing, attempt: 1 }))).toEqual({ level: null, retry: true, abort: false });
    expect(recommendLevel(practiceWith({ ...failing, attempt: 2 }))).toEqual({ level: 1, retry: false, abort: false });
  });

  test('첫 시도에서는 정반응이 1개여도 중단이 아니라 재시도다 (중단은 재시도 이후)', () => {
    expect(recommendLevel(practiceWith({ hits: 1, correctRejections: 0, meanRt: null, attempt: 1 })))
      .toEqual({ level: null, retry: true, abort: false });
  });

  test('재시도 후 정반응 2개는 중단이 아니라 1단계다', () => {
    const r = recommendLevel(practiceWith({ hits: 2, correctRejections: 0, meanRt: 2000, attempt: 2 }));
    expect(r).toEqual({ level: 1, retry: false, abort: false });
  });

  test('재시도 후 정반응 1개는 중단이다', () => {
    const r = recommendLevel(practiceWith({ hits: 1, correctRejections: 3, meanRt: 2000, attempt: 2 }));
    expect(r).toEqual({ level: null, retry: false, abort: true });
  });

  test('재시도 후 정반응 0개도 중단이다', () => {
    const r = recommendLevel(practiceWith({ hits: 0, correctRejections: 0, meanRt: null, attempt: 2 }));
    expect(r).toEqual({ level: null, retry: false, abort: true });
  });

  test('abort가 true이면 level은 항상 null이다', () => {
    for (const hits of [0, 1]) {
      const r = recommendLevel(practiceWith({ hits, correctRejections: 0, meanRt: null, attempt: 2 }));
      expect(r.abort).toBe(true);
      expect(r.level).toBeNull();
    }
  });

  test('재시도를 요구할 때는 level이 null이고 abort가 아니다', () => {
    const r = recommendLevel(practiceWith({ ...failing, attempt: 1 }));
    expect(r.retry).toBe(true);
    expect(r.level).toBeNull();
    expect(r.abort).toBe(false);
  });
});
