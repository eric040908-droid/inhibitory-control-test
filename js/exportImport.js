// 내보내기와 가져오기. 두 가지 산출물을 만든다.
//   1) 분석용 CSV — 문항 한 줄씩의 원자료. R·Python·엑셀로 바로 읽을 수 있어야 하므로 열 순서와 이름을 고정한다.
//   2) 백업용 JSON — 회차를 통째로 담는다. 결과는 이 기기의 브라우저에만 있으므로, 기록을 지우면 사라진다. 파일이 유일한 보험이다.
//
// 이 모듈은 저장소를 건드리지 않는다. parseBackupJson은 파싱·검증만 하고, 기존 자료와 병합할지는 호출한 쪽이 정한다.
// (기존 자료를 파괴하지 않는 일은 호출자의 몫이고, 여기서는 "쓸 수 있는 회차만, 이유를 밝히며" 돌려주는 데까지만 한다.)
import { TOOL_VERSION, THRESHOLDS } from './config.js';
import { validationError } from './storage.js';

export const BACKUP_SCHEMA = 1;

// ---- CSV -------------------------------------------------------------------
// 열 순서는 분석 스크립트가 의존하므로 바꾸지 않는다. 학생 식별은 별칭(student_alias)뿐이다.
const CSV_COLUMNS = [
  'student_alias', 'session_id', 'started_at', 'tool_version', 'level', 'theme_id', 'length', 'trial_count', 'complete',
  'trial_index', 'trial_type', 'rt_ms', 'outcome', 'anticipatory', 'extra_taps', 'invalid',
  'device_kind', 'screen_w', 'screen_h', 'refresh_hz_est', 'browser', 'input_kind',
];

// RFC 4180은 줄 끝을 CRLF로 정한다. 값 안의 줄바꿈은 따옴표로 감싸 그대로 둔다.
const CSV_EOL = '\r\n';

// 값 없음(null/undefined)은 빈 칸이다. "null"이라는 글자를 쓰면 R·pandas가 문자열로 읽어 숫자 열이 깨진다.
function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  // 쉼표·큰따옴표·줄바꿈(CR 또는 LF)이 있으면 큰따옴표로 감싸고, 안의 큰따옴표는 두 번 적는다.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// started_at은 저장된 숫자 밀리초 대신 ISO 8601(UTC) 문자열. 표현할 수 없는 값은 던지지 않고 빈 칸.
function isoOrEmpty(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function isAnticipatory(response) {
  return typeof response.rtMs === 'number' && response.rtMs < THRESHOLDS.anticipatoryMs;
}

// outcome은 js/metrics.js의 분류와 같다. 어긋나면 논문이 CSV에서 센 수와 화면에 보인 수가 달라진다.
//   Go    + 무반응                → omission
//   Go    + 200ms 미만 반응       → anticipatory (정반응이 아니다)
//   Go    + 200ms 이상 반응       → hit
//   No-Go + 무반응                → correct_rejection
//   No-Go + 반응(200ms 미만 포함) → commission. 200ms 미만이면 anticipatory 열도 1이다(중복 계상이 맞다, 스펙 §5.7).
function outcomeOf(response) {
  const responded = response.rtMs !== null && response.rtMs !== undefined;
  if (response.type === 'go') {
    if (!responded) return 'omission';
    return isAnticipatory(response) ? 'anticipatory' : 'hit';
  }
  return responded ? 'commission' : 'correct_rejection';
}

// 문항 한 줄씩. 머리글은 회차가 몇 개든 한 번만 나온다. responses가 비었거나 없는 회차는 줄이 없다.
export function toTrialCsv(sessions) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const session of sessions) {
    const device = session.device ?? {};
    const responses = Array.isArray(session.responses) ? session.responses : [];
    for (const r of responses) {
      const row = [
        session.studentAlias, session.id, isoOrEmpty(session.startedAt), session.toolVersion,
        session.level, session.themeId, session.length, session.trialCount, session.complete ? 1 : 0,
        r.index, r.type, r.rtMs, outcomeOf(r), isAnticipatory(r) ? 1 : 0, r.extraTaps, r.invalid ? 1 : 0,
        device.kind, device.screenW, device.screenH, device.refreshHzEst, device.browser, device.inputKind,
      ];
      lines.push(row.map(csvCell).join(','));
    }
  }
  return lines.join(CSV_EOL) + CSV_EOL;
}

// ---- JSON 백업 -------------------------------------------------------------
export function toBackupJson(sessions) {
  return JSON.stringify({ schema: BACKUP_SCHEMA, toolVersion: TOOL_VERSION, sessions }, null, 2);
}

// 회차로 받아들이는 조건. 핵심 세 조건(id가 비어 있지 않은 문자열, studentAlias가 문자열, startedAt이 유한한 숫자)은
// js/storage.js의 validationError를 그대로 쓴다 — 둘이 어긋나면 replaceAll이 배열 전체를 거부한다.
// 아래 level·responses 조건은 가져오기 고유의 요구이고, storage.js보다 엄격하다.
function isTrial(r) {
  return r !== null && typeof r === 'object' && !Array.isArray(r)
    && (r.type === 'go' || r.type === 'nogo')
    && (r.rtMs === null || (typeof r.rtMs === 'number' && Number.isFinite(r.rtMs)));
}

// 쓸 수 없는 이유를 돌려주고, 쓸 수 있으면 null.
function sessionProblem(s) {
  const shared = validationError(s);
  if (shared) return shared;
  if (typeof s.level !== 'number' || !Number.isFinite(s.level)) return 'level이 없거나 숫자가 아닙니다';
  if (!Array.isArray(s.responses)) return 'responses가 없거나 배열이 아닙니다';
  const badAt = s.responses.findIndex((r) => !isTrial(r));
  if (badAt >= 0) return `responses[${badAt}]를 읽을 수 없습니다 (type은 go/nogo, rtMs는 숫자 또는 null이어야 합니다)`;
  return null;
}

// 절대 던지지 않는다. 읽을 수 없으면 { sessions: [], warnings: [이유] }.
export function parseBackupJson(text) {
  try {
    if (typeof text !== 'string') return { sessions: [], warnings: ['파일 내용을 글자로 읽을 수 없습니다'] };

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { sessions: [], warnings: ['JSON 형식이 아니어서 읽을 수 없습니다'] };
    }
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return { sessions: [], warnings: ['이 도구의 백업 파일 형식이 아닙니다'] };
    }
    // 모르는 스키마는 구조를 잘못 해석할 수 있으니 하나도 들이지 않는다. 파일은 그대로 남으므로 잃는 것은 없다.
    if (data.schema !== BACKUP_SCHEMA) {
      return { sessions: [], warnings: [`지원하지 않는 백업 형식입니다 (schema: ${JSON.stringify(data.schema) ?? '없음'}, 지원: ${BACKUP_SCHEMA})`] };
    }
    if (!Array.isArray(data.sessions)) {
      return { sessions: [], warnings: ['백업 파일에 sessions 목록이 없습니다'] };
    }

    const warnings = [];
    if (data.toolVersion !== TOOL_VERSION) {
      warnings.push(`다른 도구 버전으로 만든 파일입니다 (파일: ${data.toolVersion ?? '알 수 없음'}, 지금: ${TOOL_VERSION})`);
    }

    const sessions = [];
    data.sessions.forEach((s, i) => {
      const problem = sessionProblem(s);
      if (problem) warnings.push(`${i + 1}번째 회차를 건너뜁니다: ${problem}`);
      else sessions.push(s);
    });
    return { sessions, warnings };
  } catch (e) {
    // 위에서 걸러지지 않은 예상 밖의 입력이 있어도 호출자에게 예외를 넘기지 않는다.
    return { sessions: [], warnings: [`백업 파일을 읽는 중 오류가 났습니다: ${e && e.message ? e.message : e}`] };
  }
}
