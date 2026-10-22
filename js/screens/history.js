// 이력 화면 — 저장된 회차를 보고, 내보내고, 가져오고, 비우는 곳. 그리고 데이터를 지키는 마지막 방어선이다.
//
// 결과는 검사한 기기의 브라우저에만 저장되므로 브라우저 기록을 지우면 사라진다. 그래서:
//   - 내보내기(복원용 JSON, 분석용 CSV)가 반드시 있어야 하고,
//   - 가져오기는 기존 기록을 절대 파괴하지 않아야 하며(병합, 같은 id는 기존 것 유지),
//   - 저장된 자료를 읽을 수 없는 상태(깨짐·다른 버전)에서는 이 화면이 유일한 탈출구다.
//     storage.js는 그런 자료를 덮어쓰지 않으려고 새 회차 저장을 거부하고, 읽기 함수들은 빈 결과를 돌려준다.
//     그래서 파싱된 내보내기(toBackupJson)로는 아무것도 나오지 않는다. 원본 바이트(readRaw)를 그대로
//     파일로 내려받게 하는 것이 교사가 보호하려던 자료를 꺼내는 길이다. 비우는 길은 replaceAll([])뿐이다.
//
// 화면 계약: createHistoryScreen(deps) → { mount(rootEl, { onOpenSession, onBack, alias }), unmount() }.
//   onOpenSession(session): 회차 줄을 눌렀을 때. 결과 화면으로 가는 일은 부른 쪽(main.js)이 한다.
//   onBack(): 이 화면을 나갈 때(설정 화면으로). 나가면 PIN 잠금이 다시 걸린다.
//   alias: 그 학생의 묶음을 펼친 채로 연다(결과 화면에서 돌아올 때).
//   deps는 쓰지 않는다. 저장소는 설정·결과 화면처럼 storage.js를 직접 쓴다.
//
// 이 화면은 글을 쓰는 교사 화면이다. 버튼은 click이다(스크롤하는 화면이라 pointerdown이면 스크롤하려는 손가락이 눌린다).
import { THEMES } from '../themes.js';
import { toTrialCsv, toBackupJson, parseBackupJson } from '../exportImport.js';
import {
  listStudents, listSessions, readRaw, replaceAll, storageStatus, validationError,
} from '../storage.js';
import * as pin from '../pin.js';

// 초기화 확인 단어. 이 단어를 입력해야 지워진다 — 실수로 눌러서는 지울 수 없게 하려는 것이다.
const RESET_WORD = '지우기';

// 만든 objectURL을 해제하기까지의 시간. 클릭 직후에 해제하면 일부 브라우저가 다운로드를 취소한다.
const REVOKE_DELAY_MS = 30_000;

const LENGTH_LABEL = { short: '짧게', medium: '보통', long: '길게' };

// ---- DOM 도우미 ----------------------------------------------------------------------------
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

const button = (label, { action, exportKind, secondary = true, danger = false, disabled = false, type = 'button' } = {}) => h('button', {
  type,
  class: `btn btn-block${danger ? ' btn-danger' : secondary ? ' btn-secondary' : ''}`,
  dataset: { ...(action ? { action } : {}), ...(exportKind ? { export: exportKind } : {}) },
  disabled,
  text: label,
});

// ---- 표시용 글자 ---------------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');

function formatDate(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '날짜 없음';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

// 가져온 옛 회차는 모양이 틀릴 수 있으므로 어떤 필드도 믿지 않는다(없는 테마 id, 길이, 단계).
function sessionSummary(session) {
  const level = Number.isFinite(session.level) ? `${session.level}단계` : '단계 모름';
  const theme = THEMES.find((t) => t.id === session.themeId)?.label ?? (typeof session.themeId === 'string' && session.themeId !== '' ? session.themeId : '테마 모름');
  const lengthName = LENGTH_LABEL[session.length] ?? (typeof session.length === 'string' && session.length !== '' ? session.length : '길이 모름');
  const trials = Number.isFinite(session.trialCount) ? ` (${session.trialCount}문항)` : '';
  return { date: formatDate(session.startedAt), meta: `${level} · ${theme} · ${lengthName}${trials}` };
}

const allSessions = () => listStudents().flatMap((alias) => listSessions(alias));

// 파일 읽기: FileReader는 jsdom과 구형 브라우저에서도 된다(File.text()는 아니다).
function readFileText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file, 'utf-8');
  });
}

// ---- 화면 ------------------------------------------------------------------------------------
export function createHistoryScreen() {
  // PIN을 맞춘 상태. 화면 인스턴스에 묶어 둔다: 회차를 열어 결과 화면에 갔다 돌아올 때(같은 인스턴스를 다시 mount)
  // 다시 묻지 않기 위해서다. 이력 화면을 나갈 때(onBack) 다시 잠근다. 새로고침하면 당연히 잠긴다.
  let unlocked = false;

  let controller = null;
  const pendingUrls = new Map(); // objectURL → 해제 타이머

  function release(url) {
    const timer = pendingUrls.get(url);
    if (timer === undefined) return;
    clearTimeout(timer);
    pendingUrls.delete(url);
    try { URL.revokeObjectURL(url); } catch { /* 해제하지 못해도 화면은 그대로다 */ }
  }

  function unmount() {
    controller?.abort();
    controller = null;
    for (const url of [...pendingUrls.keys()]) release(url);
  }

  function mount(rootEl, params = {}) {
    unmount();
    controller = new AbortController();
    const { signal } = controller;
    const { onOpenSession, onBack, alias: initialAlias } = params ?? {};

    const container = h('main', { class: 'teacher-screen history-screen', dataset: { screen: 'history' } });
    rootEl.append(container);

    // 화면 상태. 입력란의 글자는 여기 두지 않는다(입력 중에 다시 그리지 않는다).
    let openAliases = new Set(typeof initialAlias === 'string' ? [initialAlias] : []);
    let flash = null;        // { kind: 'ok'|'warn'|'error', title, paragraphs, warningsTitle, warnings, detail }
    let resetOpen = false;
    let pinError = false;    // 잠금 화면: 틀린 PIN
    let pinSetError = false; // PIN 설정: 4자리가 아님

    function setFlash(next) {
      flash = next;
      render();
      try { globalThis.scrollTo?.(0, 0); } catch { /* 맨 위로 못 올려도 안내는 그대로 있다 */ }
    }

    // ---- 다운로드 ----
    // 성공이면 파일 이름, 실패면 null. 던지지 않는다.
    function download(filename, parts, mime) {
      let url = null;
      try {
        const blob = new Blob(parts, { type: mime });
        url = URL.createObjectURL(blob);
        const a = h('a', { href: url, download: filename });
        container.append(a); // 일부 브라우저는 문서에 붙어 있어야 click이 다운로드가 된다
        a.click();
        a.remove();
        pendingUrls.set(url, setTimeout(() => release(url), REVOKE_DELAY_MS));
        return filename;
      } catch {
        if (url) {
          pendingUrls.set(url, 0);
          release(url);
        }
        return null;
      }
    }

    function doExport(kind) {
      const name = `inhibitory-control-${{ csv: 'trials', json: 'backup', raw: 'raw-storage' }[kind]}-${stamp()}`;
      let saved;
      let note;
      if (kind === 'raw') {
        const raw = readRaw();
        if (raw === null) {
          setFlash({ kind: 'error', title: '저장된 원본을 읽지 못했습니다', paragraphs: ['브라우저가 저장소 접근을 막고 있을 수 있습니다. 이 브라우저의 사이트 데이터는 지우지 말고, 다른 창이나 다른 브라우저에서 다시 시도해 보세요.'] });
          return;
        }
        // 원본은 한 바이트도 고치지 않는다: 파싱하지 않고, BOM도 붙이지 않는다.
        saved = download(`${name}.txt`, [raw], 'text/plain;charset=utf-8');
        note = '저장된 원본 그대로입니다. 읽을 수 없는 상태라 이 도구에서 다시 가져올 수는 없지만, 파일로 남겨 두면 나중에 복구를 시도할 수 있습니다.';
      } else {
        // 그 사이 저장소가 읽을 수 없게 됐다면 빈 파일을 백업이라고 내주지 않는다.
        if (storageStatus().status === 'unreadable') { render(); return; }
        const sessions = allSessions();
        if (sessions.length === 0) return;
        if (kind === 'csv') {
          // UTF-8 BOM이 없으면 엑셀이 한글 별칭을 깨뜨린다. 문자열 생성(toTrialCsv)과 다운로드는 다른 책임이라 BOM은 여기서 붙인다.
          saved = download(`${name}.csv`, ['\uFEFF', toTrialCsv(sessions)], 'text/csv;charset=utf-8');
          note = '문항 한 줄씩의 원자료입니다. 엑셀에서 바로 열 수 있고, 학생은 별칭으로만 구분됩니다.';
        } else {
          saved = download(`${name}.json`, [toBackupJson(sessions)], 'application/json');
          note = '이 파일이 기록을 지켜 주는 사본입니다. 기기 밖의 안전한 곳에도 보관해 두세요. 이 화면의 "백업 파일 가져오기"로 되돌릴 수 있습니다.';
        }
      }
      if (saved === null) {
        setFlash({ kind: 'error', title: '파일을 내려받지 못했습니다', paragraphs: ['이 브라우저가 파일 만들기를 막고 있을 수 있습니다. 다른 브라우저로 다시 시도해 주세요. 저장된 기록은 바뀌지 않았습니다.'] });
        return;
      }
      setFlash({ kind: 'ok', title: `${saved} 내려받기를 시작했습니다`, paragraphs: ['브라우저의 다운로드 목록에서 파일이 받아졌는지 확인하세요.', note] });
    }

    // ---- 가져오기 ----
    // 병합 규칙: 기존 회차는 모두 그대로 두고, 파일의 회차 중 id가 새로운 것만 더한다.
    //   - 같은 id가 기존에 있으면 기존 것을 유지한다(파일의 것은 버린다).
    //   - 파일 안에서 id가 겹치면 먼저 나온 것만 쓴다.
    // 읽을 수 없는 저장소에는 가져오지 않는다: 병합은 "기존 기록"을 읽어서 하는데 읽을 수 없으면 빈 것으로 보이고,
    // 그 위에 쓰면 읽을 수 없는 자료를 덮어써 버린다.
    function applyImport(text) {
      if (storageStatus().status === 'unreadable') {
        setFlash({
          kind: 'error',
          title: '파일을 가져오지 않았습니다',
          paragraphs: [
            '저장된 기록을 읽을 수 없는 상태입니다. 지금 가져오면 읽을 수 없는 기록을 덮어쓰게 되어 가져오지 않았습니다.',
            '먼저 저장된 원본을 내려받아 두세요.',
          ],
        });
        return;
      }

      const parsed = parseBackupJson(text);
      const warnings = [...parsed.warnings];
      if (parsed.sessions.length === 0) {
        setFlash({
          kind: 'warn',
          title: '파일에서 회차를 불러오지 못했습니다',
          paragraphs: ['저장된 기록은 바뀌지 않았습니다.'],
          warningsTitle: `경고 ${warnings.length || 1}건`,
          warnings: warnings.length > 0 ? warnings : ['파일에 회차가 없습니다'],
        });
        return;
      }

      const existing = allSessions();
      const existingIds = new Set(existing.map((s) => s.id));
      const seen = new Set(existingIds);
      const added = [];
      let existingDup = 0;
      let fileDup = 0;
      parsed.sessions.forEach((s, i) => {
        // parseBackupJson이 이미 같은 조건으로 걸렀지만, replaceAll은 하나라도 틀리면 전체를 거부하므로 한 번 더 맞춘다.
        const problem = validationError(s);
        if (problem) { warnings.push(`${i + 1}번째 회차를 건너뜁니다: ${problem}`); return; }
        if (seen.has(s.id)) {
          if (existingIds.has(s.id)) existingDup += 1; else fileDup += 1;
          return;
        }
        seen.add(s.id);
        added.push(s);
      });

      const paragraphs = [];
      if (existingDup > 0) paragraphs.push(`이미 저장된 회차와 같은 번호(id)의 회차 ${existingDup}개는 기존 것을 그대로 두고 건너뛰었습니다.`);
      if (fileDup > 0) paragraphs.push(`파일 안에서 같은 번호(id)가 겹친 회차 ${fileDup}개는 먼저 나온 것만 가져왔습니다.`);

      if (added.length > 0) {
        const result = replaceAll([...existing, ...added]);
        if (!result.ok) {
          setFlash({
            kind: 'error',
            title: '가져오지 못했습니다',
            paragraphs: [
              '기기에 저장하지 못했습니다. 기존 기록은 그대로입니다.',
              /quota/i.test(String(result.error)) ? '저장 공간이 부족할 수 있습니다. 먼저 복원용 JSON 백업을 받아 두고 저장 공간을 정리한 뒤 다시 시도하세요.' : '다시 시도해도 안 되면 문의할 때 아래 오류 원문을 알려 주세요.',
            ],
            detail: String(result.error),
          });
          return;
        }
      }

      setFlash({
        kind: warnings.length > 0 ? 'warn' : 'ok',
        title: added.length > 0 ? `${added.length}회차를 가져왔습니다` : '새로 가져온 회차가 없습니다',
        paragraphs: [
          added.length > 0 ? '이미 저장된 기록은 그대로 두고, 파일의 새 회차만 더했습니다.' : '저장된 기록은 바뀌지 않았습니다.',
          ...paragraphs,
        ],
        warningsTitle: warnings.length > 0 ? `경고 ${warnings.length}건` : null,
        warnings,
      });
    }

    async function importFile(file) {
      let text;
      try {
        text = await readFileText(file);
      } catch {
        if (!signal.aborted) {
          setFlash({ kind: 'error', title: '파일에서 회차를 불러오지 못했습니다', paragraphs: ['파일을 읽지 못했습니다. 저장된 기록은 바뀌지 않았습니다.'] });
        }
        return;
      }
      if (signal.aborted) return; // 읽는 동안 화면을 떠났다
      applyImport(text);
    }

    // ---- 초기화 ----
    function doReset() {
      const input = container.querySelector('[data-reset-input]');
      // 버튼의 disabled는 개발자 도구로 풀 수 있다. 여기서 단어를 다시 확인한다.
      if (!input || input.value.trim() !== RESET_WORD) return;
      const result = replaceAll([]);
      resetOpen = false;
      if (result.ok) {
        setFlash({ kind: 'ok', title: '모든 기록을 지웠습니다', paragraphs: ['이 기기에는 저장된 회차가 없습니다. 이제 새로 검사한 회차부터 다시 쌓입니다.'] });
      } else {
        setFlash({ kind: 'error', title: '기록을 지우지 못했습니다', paragraphs: ['저장소가 쓰기를 막고 있습니다. 기록은 바뀌지 않았습니다.'], detail: String(result.error) });
      }
    }

    // ---- PIN ----
    function savePin(value) {
      if (!/^\d{4}$/.test(value)) {
        pinSetError = true;
        render();
        container.querySelector('[data-pin-set-input]')?.focus();
        return;
      }
      pinSetError = false;
      const wasEnabled = pin.isEnabled();
      pin.setPin(value);
      // setPin은 저장이 막혀도 던지지 않고 조용히 꺼진 채로 남는다. 켜졌다고 거짓말하지 않으려고 다시 확인한다.
      if (pin.verify(value)) {
        unlocked = true; // PIN을 방금 정한 교사가 곧바로 잠금 화면에 막히지 않게
        setFlash({
          kind: 'ok',
          title: wasEnabled ? 'PIN을 바꿨습니다' : 'PIN 잠금을 켰습니다',
          paragraphs: ['이 화면에서 나가면 다음부터 PIN을 묻습니다. PIN을 잊으면 이 앱에서는 기록을 열 수 없습니다. 백업(JSON)을 받아 두지 않았다면 브라우저의 사이트 데이터를 지우지 마세요. 지우면 기록도 함께 사라집니다.'],
        });
      } else {
        setFlash({
          kind: 'error',
          title: 'PIN을 저장할 수 없습니다',
          paragraphs: ['이 기기의 브라우저가 저장을 막고 있습니다(사생활 보호 모드이거나 사이트 데이터 저장이 꺼져 있을 수 있습니다). PIN 잠금은 켜지지 않았습니다.'],
        });
      }
    }

    function turnPinOff() {
      pin.setPin(null);
      if (!pin.isEnabled()) setFlash({ kind: 'ok', title: 'PIN 잠금을 껐습니다', paragraphs: ['이제 이력 화면이 바로 열립니다.'] });
      else setFlash({ kind: 'error', title: 'PIN 잠금을 끄지 못했습니다', paragraphs: ['브라우저가 저장소 쓰기를 막고 있습니다.'] });
    }

    // ---- 그리기 ----
    function flashBox() {
      if (!flash) return null;
      const bad = flash.kind !== 'ok';
      return h(
        'div',
        { class: 'notice', role: bad ? 'alert' : 'status', dataset: { flash: flash.kind } },
        h('p', { class: 'notice-title' }, h('span', { 'aria-hidden': 'true', text: bad ? '⚠ ' : 'ℹ ' }), flash.title),
        ...(flash.paragraphs ?? []).map((text) => h('p', { text })),
        flash.warnings && flash.warnings.length > 0
          ? h('div', {}, h('p', { class: 'notice-title', text: flash.warningsTitle ?? '경고' }), h('ul', { class: 'warning-list' }, ...flash.warnings.map((w) => h('li', { text: w }))))
          : null,
        flash.detail ? h('details', { class: 'notice-details' }, h('summary', { text: '오류 원문 보기 (문의할 때 필요합니다)' }), h('p', { text: flash.detail })) : null,
      );
    }

    const backButton = () => button('돌아가기', { action: 'back' });

    function gateView() {
      const input = h('input', {
        type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', name: 'pin', id: 'pin-gate-input', class: 'pin-input',
        'aria-label': 'PIN 숫자 4자리', dataset: { pinInput: '' },
      });
      return h(
        'div',
        { dataset: { pinGate: '' } },
        h('h1', { text: '이력' }),
        h('p', { text: '이력을 보려면 PIN 숫자 4자리를 입력하세요.' }),
        h(
          'form',
          { dataset: { pinForm: '' }, novalidate: true },
          input,
          pinError ? h('p', { class: 'field-error', role: 'alert', dataset: { pinError: '' } }, h('span', { 'aria-hidden': 'true', text: '⚠ ' }), 'PIN이 맞지 않습니다. 다시 입력해 주세요.') : null,
          button('열기', { action: 'unlock', secondary: false, type: 'submit' }),
        ),
        h(
          'div',
          { class: 'text-muted', dataset: { pinForgot: '' } },
          h('p', { class: 'notice-title', text: 'PIN을 잊었다면' }),
          h('p', { text: '이 앱에서는 기록을 열 수 없습니다. 남은 방법은 브라우저 설정에서 이 사이트의 데이터를 지우는 것입니다.' }),
          h('p', { text: '미리 받아 둔 백업(JSON) 파일이 있다면 데이터를 지운 뒤 이력 화면의 "백업 파일 가져오기"로 복원할 수 있습니다.' }),
          h('p', { text: '백업이 없다면 사이트 데이터를 지우지 마세요. 지우는 순간 저장된 기록이 모두 사라집니다.' }),
        ),
        backButton(),
      );
    }

    function studentsSection(sessions) {
      if (sessions.length === 0) {
        return h('p', { dataset: { empty: '' }, text: '저장된 기록이 없습니다. 검사를 마치면 여기에 쌓입니다.' });
      }
      const groups = listStudents().map((name) => {
        const mine = listSessions(name).slice().reverse(); // 최근 회차가 먼저
        const label = name === '' ? '(별칭 없음)' : name;
        return h(
          'details',
          { class: 'student-group', dataset: { student: name }, open: openAliases.has(name) },
          h('summary', { text: `${label} · ${mine.length}회차` }),
          h('ul', { class: 'session-list' }, ...mine.map((s) => {
            const { date, meta } = sessionSummary(s);
            const done = s.complete === true;
            return h(
              'li',
              {},
              h(
                'button',
                { type: 'button', class: 'session-row', dataset: { sessionRow: s.id } },
                h('span', { class: 'session-date', text: date }),
                h('span', { class: 'session-meta', text: meta }),
                h('span', { class: 'session-state', dataset: { state: done ? 'complete' : 'aborted' } }, h('span', { 'aria-hidden': 'true', text: done ? '✓ ' : '⚠ ' }), done ? '완료' : '중단'),
              ),
            );
          })),
        );
      });
      return h('div', { class: 'student-list' }, ...groups);
    }

    function exportSection(count) {
      return h(
        'section',
        { class: 'history-section', dataset: { section: 'export' } },
        h('h2', { text: '내보내기' }),
        h('p', { text: '결과는 이 기기의 브라우저에만 저장됩니다. 브라우저 기록이나 사이트 데이터를 지우면 사라지므로, 정기적으로 복원용 JSON 백업을 받아 두세요.' }),
        button('복원용 JSON 백업 내려받기', { exportKind: 'json', secondary: false, disabled: count === 0 }),
        h('p', { class: 'text-muted', text: '모든 학생의 모든 회차를 담습니다. 다른 기기로 옮기거나 기록을 되돌릴 때 씁니다.' }),
        button('분석용 CSV 내려받기', { exportKind: 'csv', disabled: count === 0 }),
        h('p', { class: 'text-muted', text: '문항 한 줄씩의 원자료입니다. 엑셀에서 바로 열 수 있습니다.' }),
      );
    }

    function importSection() {
      return h(
        'section',
        { class: 'history-section', dataset: { section: 'import' } },
        h('h2', { text: '가져오기' }),
        h('p', { text: '복원용 JSON 백업 파일의 회차를 지금 기록에 더합니다. 이미 있는 회차는 그대로 두고, 기존 기록을 지우지 않습니다.' }),
        button('백업 파일 가져오기', { action: 'import' }),
        h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true', dataset: { importInput: '' } }),
      );
    }

    function unreadableNotice(raw) {
      const status = storageStatus();
      return h(
        'div',
        { class: 'notice', dataset: { notice: 'unreadable' } },
        h('p', { class: 'notice-title' }, h('span', { 'aria-hidden': 'true', text: '⚠ ' }), '저장된 기록을 읽을 수 없습니다'),
        h('p', { text: '이 기기에 저장된 기록이 깨졌거나 이 도구가 모르는 형식이어서 읽을 수 없습니다. 기존 기록을 덮어쓰지 않으려고 새 회차 저장도 막혀 있습니다.' }),
        h('p', { text: '브라우저의 사이트 데이터나 저장 공간을 지우지 마세요. 복구할 수 있을 수 있습니다. 먼저 아래 버튼으로 저장된 원본을 파일로 내려받아 두세요.' }),
        raw === '' ? h('p', { text: '저장된 내용이 비어 있습니다. 내려받아도 빈 파일입니다.' }) : null,
        button('저장된 원본 내려받기', { exportKind: 'raw', secondary: false }),
        h('p', { class: 'text-muted', text: '원본을 받아 둔 뒤에, 맨 아래 "모든 기록 지우기"로 비우면 새 검사를 다시 저장할 수 있습니다.' }),
        h('details', { class: 'notice-details' }, h('summary', { text: '오류 원문 보기 (문의할 때 필요합니다)' }), h('p', { text: status.error ?? '' })),
      );
    }

    function inaccessibleNotice() {
      return h(
        'div',
        { class: 'notice', dataset: { notice: 'inaccessible' } },
        h('p', { class: 'notice-title' }, h('span', { 'aria-hidden': 'true', text: '⚠ ' }), '이 기기에서는 기록 저장소를 쓸 수 없습니다'),
        h('p', { text: '브라우저가 저장소 접근을 막고 있습니다. 사생활 보호(시크릿) 모드이거나 사이트 데이터 저장이 꺼져 있을 수 있습니다.' }),
        h('p', { text: '일반 창으로 열어 다시 확인하세요. 이 상태에서는 내려받을 기록도, 새로 저장되는 기록도 없습니다.' }),
      );
    }

    // PIN을 켜기 전에 읽게 하는 경고와, 그 자리에서 바로 받을 수 있는 백업 버튼. 권하기만 하고 버튼이 다른 데 있으면 아무도 안 받는다.
    // 읽을 수 없는 저장소에서는 JSON 백업이 없으므로(빈 파일을 백업으로 오해하지 않게) 원본 내려받기를 준다.
    function pinWarning(unreadable, count) {
      return h(
        'div',
        { class: 'notice', dataset: { pinWarning: '' } },
        h('p', { class: 'notice-title' }, h('span', { 'aria-hidden': 'true', text: '⚠ ' }), 'PIN을 켜기 전에 읽어 주세요'),
        h('p', { text: 'PIN을 잊으면 이 앱에서는 기록을 열 수 없습니다.' }),
        h('p', { text: '그때 남은 방법은 브라우저 설정에서 이 사이트의 데이터를 지우는 것이고, 그러면 기록도 함께 사라집니다.' }),
        h('p', { text: '그래서 PIN을 켜기 전에 백업(JSON)을 먼저 내려받아 두기를 권합니다.' }),
        unreadable
          ? button('저장된 원본 내려받기', { exportKind: 'raw' })
          : button('복원용 JSON 백업 내려받기', { exportKind: 'json', disabled: count === 0 }),
        !unreadable && count === 0 ? h('p', { class: 'text-muted', text: '저장된 기록이 아직 없어 받을 백업이 없습니다.' }) : null,
      );
    }

    function pinSection(unreadable, count) {
      const enabled = pin.isEnabled();
      return h(
        'section',
        { class: 'history-section', dataset: { pinSettings: '' } },
        h('h2', { text: 'PIN 잠금' }),
        h('p', { text: enabled ? 'PIN 잠금이 켜져 있습니다. 이력 화면을 열 때 PIN을 먼저 묻습니다.' : 'PIN 잠금이 꺼져 있습니다. 켜면 이력 화면을 열 때 PIN을 먼저 묻습니다.' }),
        h('p', { class: 'text-muted', text: '학교 공용 기기에서 학생이 다른 학생의 이름과 결과를 우연히 보지 않게 하는 용도입니다. 보안 장치가 아닙니다.' }),
        pinWarning(unreadable, count),
        h(
          'form',
          { dataset: { pinSetForm: '' }, novalidate: true },
          h('label', { for: 'pin-set-input', class: 'field-label', text: enabled ? '새 PIN (숫자 4자리)' : 'PIN (숫자 4자리)' }),
          h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', id: 'pin-set-input', class: 'pin-input', dataset: { pinSetInput: '' } }),
          pinSetError ? h('p', { class: 'field-error', role: 'alert', dataset: { pinSetError: '' } }, h('span', { 'aria-hidden': 'true', text: '⚠ ' }), '숫자 4자리를 입력해 주세요.') : null,
          button(enabled ? 'PIN 바꾸기' : 'PIN 켜기', { action: 'pin-save', secondary: false, type: 'submit' }),
        ),
        enabled ? button('PIN 끄기', { action: 'pin-off' }) : null,
      );
    }

    function resetSection(count, unreadable) {
      const body = [h('h2', { text: '모든 기록 지우기' })];
      if (!resetOpen) {
        body.push(
          h('p', { text: '이 기기에 저장된 모든 회차를 지웁니다. 되돌릴 수 없습니다.' }),
          button('모든 기록 지우기', { action: 'reset' }),
        );
      } else {
        body.push(h(
          'div',
          { class: 'notice', role: 'alertdialog', 'aria-labelledby': 'reset-title', dataset: { resetPanel: '' } },
          h('p', { class: 'notice-title', id: 'reset-title' }, h('span', { 'aria-hidden': 'true', text: '⚠ ' }), '정말 모든 기록을 지울까요?'),
          h('p', { text: unreadable
            ? '이 기기에 저장된, 지금은 읽을 수 없는 기록이 모두 사라지고 되돌릴 수 없습니다. 위의 "저장된 원본 내려받기"로 파일을 받아 두지 않았다면 이 기록을 되찾을 방법이 없습니다.'
            : `이 기기에 저장된 ${count}회차 기록이 모두 사라지고 되돌릴 수 없습니다.` }),
          unreadable ? null : h('p', { text: '먼저 위의 "복원용 JSON 백업 내려받기"로 백업 파일을 받아 두었는지 확인하세요.' }),
          h('label', { for: 'reset-input', class: 'field-label', text: `계속하려면 아래 칸에 '${RESET_WORD}'라고 입력하세요.` }),
          h('input', { type: 'text', id: 'reset-input', autocomplete: 'off', dataset: { resetInput: '' } }),
          button('모든 기록 지우기 확인', { action: 'reset-confirm', danger: true, disabled: true }),
          button('취소', { action: 'reset-cancel' }),
        ));
      }
      return h('section', { class: 'history-section', dataset: { section: 'reset' } }, ...body);
    }

    function mainView() {
      const status = storageStatus();
      const unreadable = status.status === 'unreadable';
      const raw = unreadable ? readRaw() : null; // 비교는 === null. 빈 문자열("")도 내려받을 원본이다.
      const inaccessible = unreadable && raw === null;

      const parts = [h('h1', { text: '이력' }), backButton(), flashBox()];

      if (inaccessible) {
        parts.push(inaccessibleNotice());
        return parts;
      }
      if (unreadable) {
        parts.push(unreadableNotice(raw), resetSection(0, true), pinSection(true, 0));
        return parts;
      }

      const sessions = allSessions();
      parts.push(
        h('section', { class: 'history-section', dataset: { section: 'students' } }, h('h2', { text: '학생과 회차' }), studentsSection(sessions)),
        exportSection(sessions.length),
        importSection(),
        pinSection(false, sessions.length),
      );
      if (sessions.length > 0) parts.push(resetSection(sessions.length, false));
      parts.push(backButton());
      return parts;
    }

    function render() {
      // 다시 그리기 전에 펼쳐 둔 학생을 기억한다(가져오기·안내 뒤에도 보던 자리에 머문다).
      if (container.querySelector('[data-student]')) {
        openAliases = new Set([...container.querySelectorAll('details[data-student][open]')].map((d) => d.dataset.student));
      }
      const locked = pin.isEnabled() && !unlocked;
      container.replaceChildren(...(locked ? [gateView()] : mainView()).filter(Boolean));
    }

    // ---- 입력 ----
    // 리스너는 모두 container 하나에 위임하고 한 AbortController에 묶는다. 화면이 다시 그려져도 새로 걸 것이 없다.
    container.addEventListener('click', (event) => {
      const target = event.target;
      const el = target && typeof target.closest === 'function' ? target.closest('button') : null;
      if (!el || !container.contains(el) || el.disabled) return;

      if (el.dataset.sessionRow !== undefined) {
        const session = allSessions().find((s) => s.id === el.dataset.sessionRow);
        if (session) onOpenSession?.(session);
        else render(); // 그 사이 사라진 회차
        return;
      }
      if (el.dataset.export) { doExport(el.dataset.export); return; }

      switch (el.dataset.action) {
        case 'back':
          unlocked = false; // 이력 화면을 나가면 다시 잠근다
          onBack?.();
          break;
        case 'import':
          container.querySelector('[data-import-input]')?.click();
          break;
        case 'reset':
          resetOpen = true;
          render();
          container.querySelector('[data-reset-input]')?.focus();
          break;
        case 'reset-cancel':
          resetOpen = false;
          render();
          break;
        case 'reset-confirm':
          doReset();
          break;
        case 'pin-off':
          turnPinOff();
          break;
        default:
          break; // unlock, pin-save는 폼 제출(submit)이 처리한다 — Enter로도 되도록
      }
    }, { signal });

    container.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.target;
      if (form?.matches?.('[data-pin-form]')) {
        const value = form.querySelector('[data-pin-input]')?.value ?? '';
        if (pin.verify(value)) {
          unlocked = true;
          pinError = false;
          render();
        } else {
          pinError = true;
          render();
          container.querySelector('[data-pin-input]')?.focus();
        }
      } else if (form?.matches?.('[data-pin-set-form]')) {
        savePin(form.querySelector('[data-pin-set-input]')?.value ?? '');
      }
    }, { signal });

    // 확인 단어를 입력하는 동안에는 다시 그리지 않는다(포커스와 키보드를 잃지 않게). 버튼 상태만 바꾼다.
    container.addEventListener('input', (event) => {
      if (!event.target?.matches?.('[data-reset-input]')) return;
      const confirm = container.querySelector('[data-action="reset-confirm"]');
      if (confirm) confirm.disabled = event.target.value.trim() !== RESET_WORD;
    }, { signal });

    container.addEventListener('change', (event) => {
      const input = event.target;
      if (!input?.matches?.('[data-import-input]')) return;
      const file = input.files?.[0];
      if (!file) return;
      const done = importFile(file);
      // 같은 파일을 다시 고를 수 있도록 비운다. 파일 객체는 이미 잡았다.
      try { input.value = ''; } catch { /* 일부 환경은 막는다 */ }
      done.catch(() => {});
    }, { signal });

    render();
  }

  return { mount, unmount };
}
