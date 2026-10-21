import { TOOL_VERSION } from '../js/config.js';
import { toTrialCsv, toBackupJson, parseBackupJson } from '../js/exportImport.js';
import { setStorage, replaceAll } from '../js/storage.js';

// ---- 헬퍼 -----------------------------------------------------------------
const go = (rtMs, extra = {}) => ({ index: 0, type: 'go', rtMs, extraTaps: 0, invalid: false, ...extra });
const nogo = (rtMs, extra = {}) => ({ index: 0, type: 'nogo', rtMs, extraTaps: 0, invalid: false, ...extra });

function sessionFixture(partial = {}) {
  const trialCount = partial.trialCount ?? 2;
  const responses = partial.responses
    ?? Array.from({ length: trialCount }, (_, i) => ({ ...go(500 + i), index: i }));
  return {
    id: 's1',
    studentAlias: '학생1',
    startedAt: Date.UTC(2026, 9, 21, 1, 2, 3),
    endedAt: Date.UTC(2026, 9, 21, 1, 7, 3),
    complete: true,
    level: 2,
    themeId: 'animals',
    length: 'short',
    trialCount,
    responses,
    practice: { hits: 5, rejections: 3 },
    device: { kind: 'tablet', screenW: 1024, screenH: 768, dpr: 2, browser: 'Chrome', inputKind: 'touch', refreshHzEst: 60 },
    toolVersion: TOOL_VERSION,
    ...partial,
  };
}

// RFC 4180 CSV 파서: 따옴표 안의 쉼표·줄바꿈·"" 이스케이프를 실제로 해석한다. (단순 split(',')은 이스케이프 테스트를 무력화한다)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 2; continue; }
    if (c === '\n' || c === '\r') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += c; i += 1;
  }
  if (inQuotes) throw new Error('unterminated quoted field');
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

const headerOf = (csv) => parseCsv(csv)[0];
const headerLength = (csv) => headerOf(csv).length;
const columnIndex = (csv, name) => headerOf(csv).indexOf(name);
const parseCsvRow = (csv, n = 1) => parseCsv(csv)[n]; // 머리글 다음 첫 데이터 줄이 기본
const cell = (csv, rowNo, name) => parseCsv(csv)[rowNo][columnIndex(csv, name)];

const EXPECTED_HEADER = [
  'student_alias', 'session_id', 'started_at', 'tool_version', 'level', 'theme_id', 'length',
  'trial_index', 'trial_type', 'rt_ms', 'outcome', 'anticipatory', 'extra_taps', 'invalid',
  'device_kind', 'screen_w', 'screen_h', 'refresh_hz_est', 'browser', 'input_kind',
];

// ---- 브리프 테스트 (그대로) ----------------------------------------------------
test('CSV는 문항 한 줄씩이고 머리글에 분석에 필요한 열이 다 있다', () => {
  const csv = toTrialCsv([sessionFixture({ trialCount: 2 })]);
  const [header, ...rows] = csv.trim().split('\n');
  for (const col of ['session_id','student_alias','started_at','tool_version','level','theme_id','length',
                     'trial_index','trial_type','rt_ms','outcome','anticipatory','extra_taps','invalid',
                     'device_kind','screen_w','screen_h','refresh_hz_est','browser','input_kind'])
    expect(header).toContain(col);
  expect(rows).toHaveLength(2);
});

test('outcome 열이 네 가지 결과로 적힌다', () => {
  const csv = toTrialCsv([sessionFixture({ responses: [go(500), go(null), nogo(300), nogo(null)] })]);
  const outcomes = csv.trim().split('\n').slice(1).map(r => r.split(',')[columnIndex(csv, 'outcome')]);
  expect(outcomes).toEqual(['hit', 'omission', 'commission', 'correct_rejection']);
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

// ---- 경계: CSV 형식 ------------------------------------------------------------
describe('toTrialCsv 형식', () => {
  test('머리글 열 이름과 순서가 고정이다', () => {
    expect(headerOf(toTrialCsv([sessionFixture()]))).toEqual(EXPECTED_HEADER);
  });

  test('모든 데이터 줄의 열 수가 머리글과 같다', () => {
    const csv = toTrialCsv([sessionFixture({ responses: [go(500), go(null), nogo(300), nogo(null)] })]);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(5);
    for (const r of rows) expect(r).toHaveLength(EXPECTED_HEADER.length);
  });

  test('줄 끝은 RFC 4180대로 CRLF이다', () => {
    const csv = toTrialCsv([sessionFixture({ trialCount: 1 })]);
    expect(csv).toMatch(/^[^\r\n]+\r\n[^\r\n]+\r\n$/);
  });

  test('값이 문항마다 올바른 열에 들어간다', () => {
    const csv = toTrialCsv([sessionFixture({ responses: [go(512, { index: 7, extraTaps: 2 })] })]);
    const row = Object.fromEntries(EXPECTED_HEADER.map((h, i) => [h, parseCsvRow(csv)[i]]));
    expect(row).toEqual({
      student_alias: '학생1', session_id: 's1', started_at: '2026-10-21T01:02:03.000Z', tool_version: TOOL_VERSION,
      level: '2', theme_id: 'animals', length: 'short',
      trial_index: '7', trial_type: 'go', rt_ms: '512', outcome: 'hit', anticipatory: '0', extra_taps: '2', invalid: '0',
      device_kind: 'tablet', screen_w: '1024', screen_h: '768', refresh_hz_est: '60', browser: 'Chrome', input_kind: 'touch',
    });
  });

  test('started_at은 숫자 밀리초가 아니라 ISO 8601 문자열이다', () => {
    const csv = toTrialCsv([sessionFixture({ startedAt: Date.UTC(2026, 0, 2, 3, 4, 5, 6) })]);
    expect(cell(csv, 1, 'started_at')).toBe('2026-01-02T03:04:05.006Z');
  });

  test('표현할 수 없는 startedAt은 던지지 않고 빈 칸이 된다', () => {
    const csv = toTrialCsv([sessionFixture({ startedAt: 1e20 }), sessionFixture({ id: 's2', startedAt: NaN })]);
    expect(cell(csv, 1, 'started_at')).toBe('');
    expect(cell(csv, 3, 'started_at')).toBe('');
  });

  test('anticipatory는 rt가 있고 기준(200ms) 미만일 때만 1이다 (Go·No-Go 모두)', () => {
    const csv = toTrialCsv([sessionFixture({ responses: [go(199), go(200), go(null), nogo(150), nogo(250), nogo(null)] })]);
    const flags = parseCsv(csv).slice(1).map((r) => r[columnIndex(csv, 'anticipatory')]);
    expect(flags).toEqual(['1', '0', '0', '1', '0', '0']);
  });

  test('anticipatory여도 outcome은 응답 유무만으로 정한다 (hit/commission), 해석은 분석 쪽이 한다', () => {
    const csv = toTrialCsv([sessionFixture({ responses: [go(100), nogo(100)] })]);
    const outcomes = parseCsv(csv).slice(1).map((r) => r[columnIndex(csv, 'outcome')]);
    expect(outcomes).toEqual(['hit', 'commission']);
  });

  test('invalid 문항은 invalid=1로 표시되고 행은 그대로 남는다', () => {
    const csv = toTrialCsv([sessionFixture({ responses: [go(500, { invalid: true }), go(500)] })]);
    const flags = parseCsv(csv).slice(1).map((r) => r[columnIndex(csv, 'invalid')]);
    expect(flags).toEqual(['1', '0']);
  });
});

describe('toTrialCsv 빈 값 표현', () => {
  test('rtMs가 null이면 rt_ms는 빈 칸이다 ("null" 문자열이 아니다)', () => {
    const csv = toTrialCsv([sessionFixture({ responses: [go(null), nogo(null)] })]);
    expect(cell(csv, 1, 'rt_ms')).toBe('');
    expect(cell(csv, 2, 'rt_ms')).toBe('');
    expect(csv).not.toContain('null');
  });

  test('refreshHzEst가 null이면 refresh_hz_est는 빈 칸이고 다른 열은 밀리지 않는다', () => {
    const device = { kind: 'phone', screenW: 390, screenH: 844, dpr: 3, browser: 'Safari', inputKind: 'touch', refreshHzEst: null };
    const csv = toTrialCsv([sessionFixture({ device })]);
    expect(cell(csv, 1, 'refresh_hz_est')).toBe('');
    expect(cell(csv, 1, 'browser')).toBe('Safari');
    expect(cell(csv, 1, 'input_kind')).toBe('touch');
    expect(csv).not.toContain('null');
    expect(parseCsvRow(csv)).toHaveLength(headerLength(csv));
  });

  test('device가 통째로 없어도 던지지 않고 기기 열이 빈 칸이다', () => {
    const s = sessionFixture();
    delete s.device;
    const csv = toTrialCsv([s]);
    for (const col of ['device_kind', 'screen_w', 'screen_h', 'refresh_hz_est', 'browser', 'input_kind'])
      expect(cell(csv, 1, col)).toBe('');
    expect(csv).not.toContain('undefined');
  });
});

describe('toTrialCsv 회차 묶음', () => {
  test('responses가 빈 배열인 회차는 줄을 하나도 만들지 않는다 (그 회차만 있으면 머리글만 나온다)', () => {
    const csv = toTrialCsv([sessionFixture({ trialCount: 0, responses: [] })]);
    expect(parseCsv(csv)).toEqual([EXPECTED_HEADER]);
  });

  test('responses가 없는 회차도 던지지 않고 줄이 없다', () => {
    const s = sessionFixture();
    delete s.responses;
    expect(parseCsv(toTrialCsv([s]))).toEqual([EXPECTED_HEADER]);
  });

  test('회차가 0개이면 머리글만 나온다', () => {
    expect(parseCsv(toTrialCsv([]))).toEqual([EXPECTED_HEADER]);
  });

  test('빈 회차가 섞여도 나머지 회차의 줄은 그대로 나온다', () => {
    const csv = toTrialCsv([
      sessionFixture({ id: 'a', responses: [go(500), go(600)] }),
      sessionFixture({ id: 'empty', responses: [] }),
      sessionFixture({ id: 'c', responses: [nogo(null)] }),
    ]);
    const ids = parseCsv(csv).slice(1).map((r) => r[columnIndex(csv, 'session_id')]);
    expect(ids).toEqual(['a', 'a', 'c']);
  });

  test('여러 회차를 내보내도 머리글은 한 번만 나오고 회차 순서가 유지된다', () => {
    const csv = toTrialCsv([
      sessionFixture({ id: 'a', responses: [go(500), go(600)] }),
      sessionFixture({ id: 'b', studentAlias: '학생2', responses: [nogo(null), go(700), go(800)] }),
    ]);
    const rows = parseCsv(csv);
    expect(rows.filter((r) => r[0] === 'student_alias')).toHaveLength(1);
    expect(rows).toHaveLength(1 + 2 + 3);
    expect(rows.slice(1).map((r) => r[columnIndex(csv, 'session_id')])).toEqual(['a', 'a', 'b', 'b', 'b']);
    expect(rows.slice(1).map((r) => r[0])).toEqual(['학생1', '학생1', '학생2', '학생2', '학생2']);
    for (const r of rows) expect(r).toHaveLength(EXPECTED_HEADER.length);
  });
});

describe('toTrialCsv RFC 4180 이스케이프 (파싱해서 열 수와 값을 확인한다)', () => {
  const cases = {
    '쉼표': '학생,1',
    '큰따옴표': '학생"1"',
    '줄바꿈(LF)': '학생\n1',
    '줄바꿈(CRLF)': '학생\r\n1',
    '캐리지리턴만': '학생\r1',
    '쉼표+따옴표+줄바꿈 모두': 'a,"b"\nc',
    '따옴표로 시작하고 끝남': '"학생"',
    '앞뒤 공백': '  학생  ',
    '빈 별칭': '',
  };
  for (const [name, alias] of Object.entries(cases)) {
    test(`별칭에 ${name}: 열 수가 맞고 값이 그대로 복원된다`, () => {
      const csv = toTrialCsv([sessionFixture({ studentAlias: alias, trialCount: 2 })]);
      const rows = parseCsv(csv);
      expect(rows).toHaveLength(3);
      for (const r of rows) expect(r).toHaveLength(EXPECTED_HEADER.length);
      expect(rows[1][0]).toBe(alias);
      expect(rows[2][0]).toBe(alias);
      expect(rows[1][columnIndex(csv, 'session_id')]).toBe('s1');
    });
  }

  test('따옴표는 두 번 겹쳐 적는다', () => {
    const csv = toTrialCsv([sessionFixture({ studentAlias: 'a"b', trialCount: 1 })]);
    expect(csv).toContain('"a""b"');
  });

  test('별칭 외의 문자열 열(theme_id, browser 등)도 같은 규칙으로 감싼다', () => {
    const s = sessionFixture({ themeId: 'x,y', trialCount: 1 });
    s.device = { ...s.device, browser: 'Foo "Bar", 1' };
    const csv = toTrialCsv([s]);
    expect(parseCsvRow(csv)).toHaveLength(headerLength(csv));
    expect(cell(csv, 1, 'theme_id')).toBe('x,y');
    expect(cell(csv, 1, 'browser')).toBe('Foo "Bar", 1');
  });

  test('이스케이프가 필요 없는 값은 따옴표로 감싸지 않는다', () => {
    const csv = toTrialCsv([sessionFixture({ trialCount: 1 })]);
    expect(csv).not.toContain('"');
  });

  test('헬퍼 자체 확인: parseCsv는 단순 split(",")이 놓치는 밀림을 잡는다', () => {
    expect(parseCsv('a,"b,c"\r\nd,e\r\n')).toEqual([['a', 'b,c'], ['d', 'e']]);
    expect(parseCsv('a,"x\r\ny"\r\n')).toEqual([['a', 'x\r\ny']]);
    expect(parseCsv('a,"q""r"\r\n')).toEqual([['a', 'q"r']]);
    expect(() => parseCsv('a,"open')).toThrow();
  });
});

// ---- 경계: JSON 백업 -----------------------------------------------------------
describe('toBackupJson', () => {
  test('schema와 지금의 TOOL_VERSION을 파일에 남긴다', () => {
    const parsed = JSON.parse(toBackupJson([sessionFixture()]));
    expect(parsed.schema).toBe(1);
    expect(parsed.toolVersion).toBe(TOOL_VERSION);
    expect(Array.isArray(parsed.sessions)).toBe(true);
  });

  test('왕복해도 회차가 그대로 복원된다 (rtMs: null, refreshHzEst: null 포함)', () => {
    const device = { kind: 'phone', screenW: 390, screenH: 844, dpr: 3, browser: 'Safari', inputKind: 'touch', refreshHzEst: null };
    const original = sessionFixture({ device, responses: [go(null), nogo(null), go(480), nogo(250)] });
    const { sessions: back, warnings } = parseBackupJson(toBackupJson([original]));
    expect(warnings).toEqual([]);
    expect(back).toEqual([original]);
    expect(back[0].responses[0].rtMs).toBeNull();
    expect(back[0].device.refreshHzEst).toBeNull();
  });

  test('별칭의 쉼표·따옴표·줄바꿈·한글이 JSON 왕복에서 보존된다', () => {
    const original = sessionFixture({ studentAlias: '학생,"1"\n2' });
    expect(parseBackupJson(toBackupJson([original])).sessions[0].studentAlias).toBe('학생,"1"\n2');
  });

  test('회차 0개도 왕복하고 경고가 없다', () => {
    expect(parseBackupJson(toBackupJson([]))).toEqual({ sessions: [], warnings: [] });
  });
});

describe('parseBackupJson 경계', () => {
  const wrap = (sessions, extra = {}) => JSON.stringify({ schema: 1, toolVersion: TOOL_VERSION, sessions, ...extra });

  test('빈 문자열은 세션 0개와 경고', () => {
    const r = parseBackupJson('');
    expect(r.sessions).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  test('문자열이 아닌 입력(undefined, null, 숫자, 객체)도 던지지 않는다', () => {
    for (const input of [undefined, null, 42, {}, []]) {
      const r = parseBackupJson(input);
      expect(r.sessions).toEqual([]);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  test('{} 는 세션 0개와 경고', () => {
    const r = parseBackupJson('{}');
    expect(r.sessions).toEqual([]);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  test('JSON이지만 객체가 아닌 값(null, 숫자, 문자열, 배열)은 세션 0개와 경고', () => {
    for (const text of ['null', '42', '"abc"', 'true', '[]', JSON.stringify([sessionFixture()])]) {
      const r = parseBackupJson(text);
      expect(r.sessions).toEqual([]);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  test('sessions가 배열이 아니면 세션 0개와 경고', () => {
    for (const bad of [{}, 'abc', 7, null, { 0: sessionFixture() }]) {
      const r = parseBackupJson(JSON.stringify({ schema: 1, toolVersion: TOOL_VERSION, sessions: bad }));
      expect(r.sessions).toEqual([]);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  test('sessions가 빈 배열이면 세션 0개이고 경고는 없다', () => {
    expect(parseBackupJson(wrap([]))).toEqual({ sessions: [], warnings: [] });
  });

  test('원소가 null·문자열·숫자·배열이면 그 원소만 건너뛰고 원소마다 경고 하나', () => {
    const r = parseBackupJson(wrap([null, sessionFixture({ id: 'ok' }), 'x', 5, [1]]));
    expect(r.sessions.map((s) => s.id)).toEqual(['ok']);
    expect(r.warnings).toHaveLength(4);
  });

  test('필수 필드가 하나씩 빠진 회차는 각각 건너뛴다', () => {
    for (const field of ['id', 'studentAlias', 'startedAt', 'level', 'responses']) {
      const s = sessionFixture({ id: 'x' });
      delete s[field];
      const r = parseBackupJson(wrap([s, sessionFixture({ id: 'ok' })]));
      expect(r.sessions.map((t) => t.id), `${field} 누락`).toEqual(['ok']);
      expect(r.warnings, `${field} 누락`).toHaveLength(1);
    }
  });

  test('필수 필드의 타입이 틀린 회차는 건너뛴다', () => {
    const bad = [
      sessionFixture({ id: '' }),
      sessionFixture({ id: 5 }),
      sessionFixture({ studentAlias: 5 }),
      sessionFixture({ startedAt: '2026-10-21T01:02:03Z' }),
      sessionFixture({ startedAt: null }),
      sessionFixture({ level: '2' }),
      sessionFixture({ responses: {} }),
    ];
    const r = parseBackupJson(wrap([...bad, sessionFixture({ id: 'ok' })]));
    expect(r.sessions.map((s) => s.id)).toEqual(['ok']);
    expect(r.warnings).toHaveLength(bad.length);
  });

  test('빈 별칭("")은 storage가 받아들이므로 가져오기도 받아들인다', () => {
    const r = parseBackupJson(wrap([sessionFixture({ id: 'a', studentAlias: '' })]));
    expect(r.sessions).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });

  test('responses가 빈 배열인 회차는 받아들인다', () => {
    const r = parseBackupJson(wrap([sessionFixture({ id: 'a', trialCount: 0, responses: [] })]));
    expect(r.sessions).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });

  test('문항(responses 원소)이 깨진 회차는 건너뛴다: 나중에 지표 계산이 죽지 않도록', () => {
    const bad = [
      sessionFixture({ id: 'a', responses: [null] }),
      sessionFixture({ id: 'b', responses: [{ index: 0, type: 'maybe', rtMs: 1, extraTaps: 0, invalid: false }] }),
      sessionFixture({ id: 'c', responses: [{ index: 0, type: 'go', rtMs: '500', extraTaps: 0, invalid: false }] }),
      sessionFixture({ id: 'd', responses: [{ index: 0, type: 'go', extraTaps: 0, invalid: false }] }),
    ];
    const r = parseBackupJson(wrap([...bad, sessionFixture({ id: 'ok' })]));
    expect(r.sessions.map((s) => s.id)).toEqual(['ok']);
    expect(r.warnings).toHaveLength(bad.length);
  });

  test('경고는 몇 번째 회차인지 알려 준다', () => {
    const r = parseBackupJson(wrap([sessionFixture({ id: 'a' }), { id: 'b' }]));
    expect(r.warnings[0]).toContain('2');
  });

  test('다른 도구 버전: 회차는 모두 받아들이고 경고는 버전 하나뿐', () => {
    const r = parseBackupJson(wrap([sessionFixture({ id: 'a' }), sessionFixture({ id: 'b' })], { toolVersion: '9.9.9' }));
    expect(r.sessions).toHaveLength(2);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain('버전');
    expect(r.warnings[0]).toContain('9.9.9');
  });

  test('toolVersion이 없는 파일도 받아들이되 버전 경고를 남긴다', () => {
    const r = parseBackupJson(JSON.stringify({ schema: 1, sessions: [sessionFixture({ id: 'a' })] }));
    expect(r.sessions).toHaveLength(1);
    expect(r.warnings.join(' ')).toContain('버전');
  });

  test('회차 자체의 toolVersion은 건드리지 않는다', () => {
    const r = parseBackupJson(wrap([sessionFixture({ id: 'a', toolVersion: '0.0.1-old' })]));
    expect(r.sessions[0].toolVersion).toBe('0.0.1-old');
  });

  test('모르는 스키마(다른 숫자, 없음)의 파일은 세션 0개와 경고: 잘못 해석해 들이지 않는다', () => {
    const withSchema2 = JSON.stringify({ schema: 2, toolVersion: TOOL_VERSION, sessions: [sessionFixture()] });
    const noSchema = JSON.stringify({ toolVersion: TOOL_VERSION, sessions: [sessionFixture()] });
    for (const text of [withSchema2, noSchema]) {
      const r = parseBackupJson(text);
      expect(r.sessions).toEqual([]);
      expect(r.warnings.length).toBeGreaterThan(0);
    }
  });

  test('받은 회차에 있는 추가 필드는 그대로 둔다', () => {
    const r = parseBackupJson(wrap([sessionFixture({ id: 'a', futureField: { x: 1 } })]));
    expect(r.sessions[0].futureField).toEqual({ x: 1 });
  });
});

// ---- 경계: 저장소와의 관계 --------------------------------------------------------
describe('parseBackupJson과 저장소', () => {
  afterEach(() => setStorage(null));

  test('저장소를 읽지도 쓰지도 지우지도 않는다', () => {
    const spy = { getItem: vi.fn(() => null), setItem: vi.fn(), removeItem: vi.fn() };
    setStorage(spy);
    parseBackupJson(toBackupJson([sessionFixture()]));
    parseBackupJson('{ broken');
    toTrialCsv([sessionFixture()]);
    toBackupJson([sessionFixture()]);
    expect(spy.getItem).not.toHaveBeenCalled();
    expect(spy.setItem).not.toHaveBeenCalled();
    expect(spy.removeItem).not.toHaveBeenCalled();
  });

  test('통과시킨 회차는 모두 storage.replaceAll이 받아들인다 (유효 조건이 일치한다)', () => {
    const map = new Map();
    setStorage({ getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, String(v)); }, removeItem: (k) => { map.delete(k); } });
    const text = JSON.stringify({
      schema: 1, toolVersion: TOOL_VERSION,
      sessions: [
        sessionFixture({ id: 'a' }),
        null,
        { id: 'noStart', studentAlias: 'x', level: 1, responses: [] },
        sessionFixture({ id: 'strStart', startedAt: '123' }),
        sessionFixture({ id: '' }),
        sessionFixture({ id: 'b', studentAlias: '' }),
      ],
    });
    const { sessions } = parseBackupJson(text);
    expect(sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(replaceAll(sessions)).toEqual({ ok: true });
  });
});
