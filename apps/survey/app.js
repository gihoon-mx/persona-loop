// Persona Loop — Survey 모듈
// 뷰 라우팅 (쿼리 파라미터, 뒤로가기 유지):
//   ?p=<pid>                     서베이 목록 (admin)
//   ?p=<pid>&view=new            새 서베이 만들기 (admin)
//   ?p=<pid>&view=import         CSV 임포트 위저드 (admin)
//   ?p=<pid>&view=link           now-here-survey 연동 (admin, 읽기 전용)
//     &src=<surveyId>&sess=<sessionId>  ↳ 특정 회차로 바로 진입 (재동기화용)
//   ?p=<pid>&s=<sid>             상세/결과 — 문항별 집계 (admin, 기본)
//   ?p=<pid>&s=<sid>&by=respondent          상세/결과 — 응답자별 목록 (admin)
//     &r=<라벨 또는 #n>                     ↳ 응답자 1명의 전체 답변 (페르소나의 입력)
//   ?p=<pid>&s=<sid>&mode=respond  응답자용 공개 폼 (미니멀 · 유일한 비공개 게이트 예외)
import * as core from '../../packages/core/core.js';
import {
  SURVEY_SOURCE, sourceState, initSurveySource, connectSource, disconnectSource,
  listSourceSurveys, listSourceSessions, getSourceStructure,
  listSourceParticipants, listSourceResponses, convertSession,
} from '../../packages/core/survey-source.js';
// 응답자 프로필 로직은 화면 없이도 검증할 수 있도록 코어에 둔다 (tools/verify-personas.mjs가 같은 함수를 쓴다).
import {
  natCompare, toDateOrNull,
  buildRespondents, findRespondent, buildAnswerProfile,
} from '../../packages/core/respondent-profile.js';

const { esc, qsParam, state } = core;
const app = document.getElementById('app');

const projectId = qsParam('p');
const surveyId = qsParam('s');
const view = qsParam('view');
const mode = qsParam('mode');
// 상세 뷰의 보기 전환. null = 문항별 집계(기본), 'respondent' = 응답자별.
// 쿼리 파라미터로 두어 뒤로가기·링크 공유로 상태가 유지된다.
const byView = qsParam('by');
// 응답자별 보기에서 펼쳐 볼 사람 — 익명 라벨('P7') 또는 라벨이 없는 응답의 순번('#3').
const respondentKey = qsParam('r');

const TYPE_LABELS = { single: '객관식(단일)', multi: '객관식(복수)', likert: '리커트', open: '주관식', number: '숫자' };
const STATUS_LABELS = { draft: '초안', open: '진행 중', closed: '마감', imported: '임포트됨' };
const DIMENSIONS = [
  ['', '(지정 안 함)'], ['demographics', '인구통계'], ['context', '맥락'], ['goals', '목표'],
  ['painPoints', '페인포인트'], ['behavior', '행동'], ['techSavvy', '기술 친숙도'],
  ['attitude', '태도'], ['other', '기타'],
];

core.initCore();

const fail = (e) => {
  app.innerHTML = `<p class="empty">불러오는 중 오류가 발생했습니다: ${core.esc(e.message)}</p>`;
};
if (mode === 'respond' && projectId && surveyId) {
  // 공유용 미니멀 화면 — 상단바·게이트 없이 서베이 제목만 (비로그인 응답자용)
  Promise.resolve(renderRespond(projectId, surveyId)).catch(fail);
} else {
  core.renderTopbar('../../');
  Promise.resolve(routeAdminView()).catch(fail);
}

/** 응답 모드를 제외한 모든 뷰는 admin 게이트 뒤에 있다. */
async function routeAdminView() {
  if (!(await core.requireAdmin(app))) return;
  if (!projectId) {
    app.innerHTML = `<p class="empty">프로젝트를 먼저 선택하세요. <a href="../../">← 프로젝트 목록으로</a></p>`;
  } else if (surveyId) {
    await renderDetail(projectId, surveyId);
  } else if (view === 'link') {
    await renderLinkView(projectId);
  } else if (view === 'import') {
    renderImportWizard(projectId);
  } else if (view === 'new') {
    renderNewSurvey(projectId);
  } else {
    await renderList(projectId);
  }
}

// ---------- 공통 헬퍼 ----------
function today() { return new Date().toISOString().slice(0, 10); }

function statusBadge(status) {
  const cls = status === 'open' ? 'ok' : status === 'imported' ? 'accent' : '';
  return `<span class="badge ${cls}">${esc(STATUS_LABELS[status] || status || '')}</span>`;
}

function typeSelectHtml(name, current) {
  return `<select data-${name}>${Object.entries(TYPE_LABELS).map(([v, l]) =>
    `<option value="${v}"${v === current ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function dimSelectHtml(name, current) {
  // 목록에 없는 값(예전 스키마·수기 편집)이 들어와도 조용히 '(지정 안 함)'으로 떨어지지 않게 보존한다.
  const cur = String(current ?? '');
  const extra = (cur && !DIMENSIONS.some(([v]) => v === cur))
    ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '';
  return `<select data-${name}>${extra}${DIMENSIONS.map(([v, l]) =>
    `<option value="${v}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

function crumbHtml(pid, extra = '') {
  return `<div class="crumb"><a href="../../?p=${esc(pid)}">← 프로젝트 홈</a>${extra}</div>`;
}

function downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- 뷰 1: 서베이 목록 ----------
async function renderList(pid) {
  let surveys = [];
  try { surveys = await core.listSurveys(pid); }
  catch (e) { app.innerHTML = `${crumbHtml(pid)}<p class="empty">서베이를 불러오지 못했습니다: ${esc(e.message)}</p>`; return; }

  // 공개 폼으로 들어온 응답은 서베이 문서의 responseCount를 올리지 못한다(익명은 서베이 문서에 쓸 수 없음).
  // 따라서 실제 개수는 서버 집계로 읽는다.
  const counts = await Promise.all(surveys.map((sv) => core.countResponses(pid, sv.id).catch(() => null)));

  app.innerHTML = `
    ${crumbHtml(pid)}
    <div class="section-head" style="margin-top:0">
      <h2>서베이</h2>
      <span style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="?p=${esc(pid)}&view=link">now-here-survey 연동</a>
        <a class="btn" href="?p=${esc(pid)}&view=import">CSV 임포트</a>
        <a class="btn primary" href="?p=${esc(pid)}&view=new">+ 새 서베이</a>
      </span>
    </div>
    <div class="grid cols2">
      ${surveys.length ? surveys.map((sv, i) => `
        <a class="card" href="?p=${esc(pid)}&s=${esc(sv.id)}">
          <h3>${esc(sv.title)} ${statusBadge(sv.status)}${
            sv.source === 'now-here-survey' ? ' <span class="badge accent">연동</span>' : ''}</h3>
          <p>${esc(sv.description || '')}</p>
          <p class="small muted">문항 ${(sv.questions || []).length}개 · 응답 ${counts[i] ?? sv.responseCount ?? 0}건</p>
        </a>`).join('')
        : `<div class="card"><p class="empty" style="padding:24px 0">아직 서베이가 없습니다. 새 서베이를 만들거나 CSV를 임포트해보세요.</p></div>`}
    </div>`;
  core.renderModeBanner(app);
}

// ---------- 뷰 1b: 새 서베이 만들기 (admin) ----------
function renderNewSurvey(pid) {
  const meta = { id: '', title: '', description: '' };
  const blankQ = () => ({ text: '', type: 'single', options: '', scale: 5, dimension: '' });
  let qs = [blankQ()];

  const syncFromDom = () => {
    meta.id = app.querySelector('[data-sv-id]')?.value ?? meta.id;
    meta.title = app.querySelector('[data-sv-title]')?.value ?? meta.title;
    meta.description = app.querySelector('[data-sv-desc]')?.value ?? meta.description;
    app.querySelectorAll('[data-q-idx]').forEach((el) => {
      const i = Number(el.dataset.qIdx);
      if (!qs[i]) return;
      qs[i].text = el.querySelector('[data-text]').value;
      qs[i].type = el.querySelector('[data-type]').value;
      qs[i].options = el.querySelector('[data-options]').value;
      qs[i].scale = el.querySelector('[data-scale]').value;
      qs[i].dimension = el.querySelector('[data-dim]').value;
    });
  };

  const draw = () => {
    app.innerHTML = `
      ${crumbHtml(pid, ` · <a href="?p=${esc(pid)}">서베이 목록</a>`)}
      <div class="section-head" style="margin-top:0"><h2>새 서베이</h2></div>
      <div class="card">
        <label>ID (소문자·숫자·하이픈, 변경 불가)</label>
        <input type="text" data-sv-id value="${esc(meta.id)}" pattern="[a-z0-9-]+" placeholder="sv-usage-2026">
        <label>제목</label>
        <input type="text" data-sv-title value="${esc(meta.title)}" placeholder="서비스 사용 행태 조사">
        <label>설명</label>
        <textarea data-sv-desc placeholder="무엇을 알아보려는 서베이인지">${esc(meta.description)}</textarea>
      </div>
      <div class="section-head"><h2>문항</h2><button class="btn" data-add-q>+ 문항 추가</button></div>
      ${qs.map((q, i) => `
        <div class="editor-q" data-q-idx="${i}">
          <div class="head"><b class="small muted">문항 q${i + 1}</b>
            <button class="btn" data-del-q="${i}" ${qs.length <= 1 ? 'disabled' : ''}>삭제</button></div>
          <label>질문 텍스트</label>
          <input type="text" data-text value="${esc(q.text)}" placeholder="예: 연령대를 알려주세요.">
          <div class="editor-grid">
            <div><label>유형</label>${typeSelectHtml('type', q.type)}</div>
            <div><label>페르소나 차원</label>${dimSelectHtml('dim', q.dimension)}</div>
            <div><label>선택지 (콤마 구분 — single/multi)</label>
              <input type="text" data-options value="${esc(q.options)}" placeholder="20대, 30대, 40대"></div>
            <div><label>척도 (likert)</label>
              <select data-scale><option value="5"${String(q.scale) === '5' ? ' selected' : ''}>1~5</option><option value="7"${String(q.scale) === '7' ? ' selected' : ''}>1~7</option></select></div>
          </div>
        </div>`).join('')}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <a class="btn" href="?p=${esc(pid)}">취소</a>
        <button class="btn primary" data-save>초안으로 저장</button>
      </div>`;

    app.querySelector('[data-add-q]').addEventListener('click', () => { syncFromDom(); qs.push(blankQ()); draw(); });
    app.querySelectorAll('[data-del-q]').forEach((b) => b.addEventListener('click', () => {
      syncFromDom(); qs.splice(Number(b.dataset.delQ), 1); draw();
    }));
    app.querySelector('[data-save]').addEventListener('click', async (ev) => {
      syncFromDom();
      const id = meta.id.trim(), title = meta.title.trim();
      if (!/^[a-z0-9-]{2,40}$/.test(id)) { alert('ID는 소문자·숫자·하이픈 2~40자여야 합니다.'); return; }
      if (!title) { alert('제목을 입력하세요.'); return; }
      const questions = [];
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i];
        if (!q.text.trim()) { alert(`문항 q${i + 1}의 질문 텍스트를 입력하세요.`); return; }
        const question = { id: `q${i + 1}`, type: q.type, text: q.text.trim() };
        if (q.type === 'single' || q.type === 'multi') {
          question.options = q.options.split(',').map((s) => s.trim()).filter(Boolean);
          if (question.options.length < 2) { alert(`문항 q${i + 1}: 선택지를 2개 이상 입력하세요 (콤마 구분).`); return; }
        }
        if (q.type === 'likert') question.scale = Number(q.scale) || 5;
        if (q.dimension) question.personaDimension = q.dimension;
        questions.push(question);
      }
      ev.target.disabled = true;
      try {
        await core.createSurvey(pid, {
          id, projectId: pid, title, description: meta.description.trim(),
          status: 'draft', source: 'native', auth: 'anonymous',
          responseCount: 0, createdAt: today(), questions,
        });
        location.href = `?p=${encodeURIComponent(pid)}&s=${encodeURIComponent(id)}`;
      } catch (e) { alert(e.message); ev.target.disabled = false; }
    });
  };
  draw();
}

// ---------- CSV 파서 (문자 단위 상태머신 — 따옴표 필드, 필드 내 콤마/개행, CRLF, BOM) ----------
function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1); // BOM 제거
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // 이스케이프된 따옴표
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); field = ''; rows.push(row); row = [];
    } else if (c === '\r') {
      if (text[i + 1] !== '\n') { row.push(field); field = ''; rows.push(row); row = []; } // 단독 CR
      // CRLF의 CR은 무시 (다음 LF가 행을 닫음)
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== '')); // 완전 빈 행 제거
}

// ---------- 문항 type 자동 추론 ----------
function inferColumn(values) {
  // values: 해당 열의 비어있지 않은 응답 문자열들
  if (!values.length) return { type: 'open' };
  const nums = values.map((v) => Number(v));
  const allNum = nums.every((n) => Number.isFinite(n));
  if (allNum && nums.every((n) => Number.isInteger(n) && n >= 1 && n <= 7)) {
    return { type: 'likert', scale: Math.max(...nums) <= 5 ? 5 : 7 };
  }
  const uniq = [...new Set(values)];
  if (uniq.length <= 8) return { type: 'single' };
  const commaRate = values.filter((v) => v.includes(', ')).length / values.length;
  if (uniq.length <= 12 && commaRate >= 0.2) return { type: 'multi' };
  if (allNum) return { type: 'number' };
  return { type: 'open' };
}

function isTimestampHeader(h) {
  const t = h.trim().toLowerCase();
  return t === '타임스탬프' || t === 'timestamp';
}

// ---------- 뷰 2: CSV 임포트 위저드 ----------
function renderImportWizard(pid) {
  const crumb = crumbHtml(pid, ` · <a href="?p=${esc(pid)}">서베이 목록</a>`);

  // 위저드 상태
  const wz = { headers: [], dataRows: [], cols: [], tsIndex: -1 };

  const stepsHtml = (n) => `<div class="steps">
    ${['1 파일 선택', '2 매핑 확인', '3 실행'].map((s, i) =>
      `<span class="${i + 1 === n ? 'on' : ''}">${esc(s)}</span>`).join('')}
  </div>`;

  const headHtml = (n) => `${crumb}
    <div class="section-head" style="margin-top:0"><h2>CSV 임포트</h2></div>
    ${stepsHtml(n)}`;

  // --- 1단계: 파일 선택 ---
  const drawStep1 = () => {
    app.innerHTML = `${headHtml(1)}
      <div class="card">
        <p class="small muted" style="margin-bottom:10px">Google Forms 등에서 내려받은 응답 CSV를 선택하세요.
        첫 행은 헤더(문항 텍스트)여야 하며, '타임스탬프'/'Timestamp' 열은 제출 시각으로 자동 매핑됩니다.</p>
        <input type="file" accept=".csv,text/csv" data-file>
        <p class="small muted" data-file-err style="color:var(--danger);margin-top:8px"></p>
      </div>`;
    app.querySelector('[data-file]').addEventListener('change', (ev) => {
      const file = ev.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onerror = () => { app.querySelector('[data-file-err]').textContent = '파일을 읽지 못했습니다.'; };
      reader.onload = () => {
        const err = app.querySelector('[data-file-err]');
        let rows;
        try { rows = parseCsv(String(reader.result)); }
        catch { err.textContent = 'CSV 파싱에 실패했습니다.'; return; }
        if (rows.length < 2) { err.textContent = '헤더 행과 응답 행이 최소 1개씩 필요합니다.'; return; }
        wz.headers = rows[0].map((h) => h.trim());
        wz.dataRows = rows.slice(1);
        wz.tsIndex = wz.headers.findIndex(isTimestampHeader);
        wz.cols = wz.headers.map((header, idx) => {
          if (idx === wz.tsIndex) return null;
          const values = wz.dataRows.map((r) => (r[idx] ?? '').trim()).filter((v) => v !== '');
          const inferred = inferColumn(values);
          return {
            idx, header, include: true,
            type: inferred.type, scale: inferred.scale || 5,
            dimension: '', samples: values.slice(0, 2),
          };
        }).filter(Boolean);
        drawStep2();
      };
      reader.readAsText(file);
    });
  };

  // --- 2단계: 매핑 확인 ---
  const syncStep2 = () => {
    app.querySelectorAll('[data-col-idx]').forEach((tr) => {
      const col = wz.cols[Number(tr.dataset.colIdx)];
      col.include = tr.querySelector('[data-include]').checked;
      col.type = tr.querySelector('[data-type]').value;
      col.dimension = tr.querySelector('[data-dim]').value;
    });
  };

  const drawStep2 = () => {
    app.innerHTML = `${headHtml(2)}
      <p class="small muted" style="margin-bottom:12px">
        응답 ${wz.dataRows.length}건 · 열 ${wz.headers.length}개
        ${wz.tsIndex >= 0 ? ` · '${esc(wz.headers[wz.tsIndex])}' 열은 제출 시각(submittedAt)으로 자동 매핑됨` : ' · 타임스탬프 열 없음'}
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>포함</th><th>문항 텍스트 (헤더)</th><th>유형</th><th>페르소나 차원</th><th>응답 예시</th></tr></thead>
          <tbody>
            ${wz.cols.map((col, i) => `
              <tr data-col-idx="${i}">
                <td><input type="checkbox" data-include ${col.include ? 'checked' : ''} style="width:auto"></td>
                <td>${esc(col.header)}</td>
                <td>${typeSelectHtml('type', col.type)}</td>
                <td>${dimSelectHtml('dim', col.dimension)}</td>
                <td class="small muted">${col.samples.length ? col.samples.map((s) => esc(s)).join('<br>') : '(응답 없음)'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
        <button class="btn" data-back>← 파일 다시 선택</button>
        <button class="btn primary" data-next>다음 →</button>
      </div>`;
    app.querySelector('[data-back]').addEventListener('click', drawStep1);
    app.querySelector('[data-next]').addEventListener('click', () => {
      syncStep2();
      if (!wz.cols.some((c) => c.include)) { alert('포함할 문항을 1개 이상 선택하세요.'); return; }
      drawStep3();
    });
  };

  // --- 3단계: 실행 ---
  const drawStep3 = () => {
    const included = wz.cols.filter((c) => c.include);
    app.innerHTML = `${headHtml(3)}
      <div class="card">
        <p class="small muted">문항 ${included.length}개 · 응답 ${wz.dataRows.length}건을 임포트합니다.</p>
        <label>서베이 ID (소문자·숫자·하이픈)</label>
        <input type="text" data-sv-id pattern="[a-z0-9-]+" placeholder="sv-forms-2026">
        <label>제목</label>
        <input type="text" data-sv-title placeholder="사용자 조사 (Google Forms 임포트)">
        <label>설명 (선택)</label>
        <textarea data-sv-desc></textarea>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
          <button class="btn" data-back>← 매핑으로</button>
          <button class="btn primary" data-run>임포트 실행</button>
        </div>
        <ul class="progress-log" data-log></ul>
      </div>`;
    app.querySelector('[data-back]').addEventListener('click', drawStep2);
    app.querySelector('[data-run]').addEventListener('click', async (ev) => {
      const id = app.querySelector('[data-sv-id]').value.trim();
      const title = app.querySelector('[data-sv-title]').value.trim();
      const description = app.querySelector('[data-sv-desc]').value.trim();
      if (!/^[a-z0-9-]{2,40}$/.test(id)) { alert('ID는 소문자·숫자·하이픈 2~40자여야 합니다.'); return; }
      if (!title) { alert('제목을 입력하세요.'); return; }

      // 서베이 정의 구성 (survey.schema.json 준수)
      const questions = included.map((col, i) => {
        const values = wz.dataRows.map((r) => (r[col.idx] ?? '').trim()).filter((v) => v !== '');
        const q = { id: `q${i + 1}`, type: col.type, text: col.header };
        if (col.type === 'single') q.options = [...new Set(values)];
        if (col.type === 'multi') q.options = [...new Set(values.flatMap((v) => v.split(', ').map((s) => s.trim())))].filter(Boolean);
        if (col.type === 'likert') q.scale = col.scale;
        if (col.dimension) q.personaDimension = col.dimension;
        return q;
      });

      // 응답 행 구성
      const respRows = wz.dataRows.map((r) => {
        const answers = {};
        included.forEach((col, i) => {
          const raw = (r[col.idx] ?? '').trim();
          if (raw === '') return;
          const qid = `q${i + 1}`;
          if (col.type === 'likert' || col.type === 'number') {
            const n = Number(raw);
            answers[qid] = Number.isFinite(n) ? n : raw;
          } else if (col.type === 'multi') {
            answers[qid] = raw.split(', ').map((s) => s.trim()).filter(Boolean);
          } else {
            answers[qid] = raw;
          }
        });
        let submittedAt = null;
        if (wz.tsIndex >= 0) {
          const ts = (r[wz.tsIndex] ?? '').trim();
          if (ts) {
            const d = new Date(ts);
            submittedAt = Number.isNaN(d.getTime()) ? ts : d.toISOString();
          }
        }
        return { answers, submittedAt };
      });

      const log = app.querySelector('[data-log]');
      const say = (msg) => { const li = document.createElement('li'); li.textContent = msg; log.appendChild(li); };
      ev.target.disabled = true;
      try {
        say('서베이 정의 저장 중…');
        // responseCount는 넣지 않는다 — importResponses가 increment로 갱신 (이중 카운트 방지)
        await core.createSurvey(pid, {
          id, projectId: pid, title, description,
          status: 'imported', source: 'csv-import', auth: 'anonymous',
          createdAt: today(), questions,
        });
        say(`응답 ${respRows.length}건 저장 중… (잠시 걸릴 수 있습니다)`);
        await core.importResponses(pid, id, respRows);
        say(`완료 — 문항 ${questions.length}개, 응답 ${respRows.length}건 임포트됨.`);
        const li = document.createElement('li');
        li.innerHTML = `<a href="?p=${esc(pid)}&s=${esc(id)}">→ 결과 보러 가기</a>`;
        log.appendChild(li);
      } catch (e) {
        say(`실패: ${e.message}`);
        ev.target.disabled = false;
      }
    });
  };

  drawStep1();
}

// ---------- 집계 ----------
function computeAggregates(survey, responses) {
  const byQuestion = {};
  for (const q of survey.questions || []) {
    const vals = responses
      .map((r) => r.answers?.[q.id])
      .filter((v) => v !== undefined && v !== null && v !== '');
    if (q.type === 'single') {
      const counts = {};
      vals.forEach((v) => { const k = String(v); counts[k] = (counts[k] || 0) + 1; });
      byQuestion[q.id] = { type: 'single', counts };
    } else if (q.type === 'multi') {
      const counts = {};
      vals.forEach((v) => {
        const arr = Array.isArray(v) ? v : String(v).split(', ');
        arr.map((s) => String(s).trim()).filter(Boolean)
          .forEach((k) => { counts[k] = (counts[k] || 0) + 1; });
      });
      byQuestion[q.id] = { type: 'multi', counts };
    } else if (q.type === 'likert') {
      const counts = {};
      let sum = 0, n = 0;
      vals.forEach((v) => {
        const num = Number(v);
        const k = String(v);
        counts[k] = (counts[k] || 0) + 1;
        if (Number.isFinite(num)) { sum += num; n++; }
      });
      byQuestion[q.id] = { type: 'likert', counts, mean: n ? Math.round((sum / n) * 10) / 10 : null };
    } else if (q.type === 'number') {
      const nums = vals.map(Number).filter(Number.isFinite);
      byQuestion[q.id] = nums.length
        ? { type: 'number', count: nums.length, mean: Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 10) / 10, min: Math.min(...nums), max: Math.max(...nums) }
        : { type: 'number', count: 0 };
    } else { // open (및 기타)
      byQuestion[q.id] = { type: 'open', answers: vals.map(String) };
    }
  }
  return { computedAt: today(), responseCount: responses.length, byQuestion };
}

// ---------- 결과 렌더 ----------
function barRowsHtml(entries, denom) {
  // entries: [label, count][]
  return entries.map(([label, count]) => {
    const pct = denom ? Math.round((count / denom) * 100) : 0;
    return `<div class="bar-row">
      <span>${esc(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
      <span class="bar-n">${pct}% · ${count}</span>
    </div>`;
  }).join('');
}

function questionResultHtml(q, a, responseCount) {
  if (!a) return `<p class="small muted">집계 없음</p>`;
  if (q.type === 'single' || q.type === 'multi') {
    const counts = a.counts || {};
    const labels = (q.options && q.options.length)
      ? [...q.options, ...Object.keys(counts).filter((k) => !q.options.includes(k))]
      : Object.keys(counts);
    const entries = labels.map((l) => [l, counts[l] || 0]);
    const denom = q.type === 'single'
      ? entries.reduce((s, [, c]) => s + c, 0)
      : (responseCount || entries.reduce((s, [, c]) => s + c, 0));
    return barRowsHtml(entries, denom)
      + (q.type === 'multi' ? `<p class="small muted" style="margin-top:6px">복수 응답 — 응답자 대비 비율</p>` : '');
  }
  if (q.type === 'likert') {
    const scale = q.scale || 5;
    const counts = a.counts || {};
    const entries = Array.from({ length: scale }, (_, i) => [String(i + 1), counts[String(i + 1)] || 0]);
    const denom = entries.reduce((s, [, c]) => s + c, 0);
    return barRowsHtml(entries, denom)
      + (a.mean != null ? `<p class="small" style="margin-top:6px">평균 <b>${esc(a.mean)}</b> / ${scale}</p>` : '');
  }
  if (q.type === 'number') {
    if (!a.count && a.mean == null) return `<p class="small muted">응답 없음</p>`;
    return `<div class="num-summary">
      ${a.mean != null ? `<span>평균 <b>${esc(a.mean)}</b></span>` : ''}
      ${a.min != null ? `<span>최소 <b>${esc(a.min)}</b></span>` : ''}
      ${a.max != null ? `<span>최대 <b>${esc(a.max)}</b></span>` : ''}
      ${a.count != null ? `<span class="muted">n=${esc(a.count)}</span>` : ''}
    </div>`;
  }
  // open
  const answers = a.answers || [];
  if (!answers.length) return `<p class="small muted">응답 없음</p>`;
  return `<ul class="answers-list" style="list-style:none;padding:0;margin:0">
    ${answers.slice(0, 20).map((t) => `<li><span class="who">익명 응답</span>${esc(t)}</li>`).join('')}
  </ul>
  ${answers.length > 20 ? `<p class="small muted" style="margin-top:6px">외 ${answers.length - 20}건</p>` : ''}`;
}

// ---------- 응답자별 보기 ----------
// 페르소나는 문항별 집계('35명 중 71%')가 아니라 **한 사람이 문항 전체에 어떻게 답했는가**에서 나온다.
// Firestore 응답 문서 1건 = 응답자 1명이므로, 그 문서를 문항 순서대로 펼쳐 사람 단위로 읽는다.
// 이 화면이 페르소나 생성의 입력이자, 사람이 눈으로 "창작이 아님"을 확인하는 창이다.
// 개인정보: respondent(uid)·실명은 어디에도 쓰지 않는다. 익명 라벨만 표시한다.

const MAX_RESPONDENT_CARDS = 200;   // 응답이 많아도 목록이 무너지지 않게

const RESPONDENT_SORTS = [
  // 의견을 많이 남긴 사람이 페르소나 재료로 가치가 크므로 정렬로 끌어올릴 수 있게 한다.
  ['ratio', '응답률 높은 순'],
  ['comments', '의견 많은 순'],
  ['label', '라벨순'],
];

function fmtDateTime(v) {
  const d = toDateOrNull(v);
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function profileFileSlug(r) {
  return slugifyId(r.label) || `r${r.index}`;
}

function answerBlockHtml(q, value) {
  if (value === null || value === undefined) return `<p class="ans none">무응답</p>`;
  if (Array.isArray(value)) {
    return `<p class="ans">${value.map((v) => `<span class="pill">${esc(v)}</span>`).join('')}</p>`;
  }
  if (q.type === 'likert') {
    return `<p class="ans"><b>${esc(value)}</b> <span class="small muted">/ ${esc(q.scale || 5)}</span></p>`;
  }
  if (q.type === 'open') {
    return `<blockquote class="free-text">${esc(value)}</blockquote>`;
  }
  return `<p class="ans">${esc(value)}</p>`;
}

function respondentHref(pid, sid, key) {
  return `?p=${encodeURIComponent(pid)}&s=${encodeURIComponent(sid)}`
    + `&by=respondent&r=${encodeURIComponent(key)}`;
}

function pctText(r) { return `${Math.round(r.ratio * 100)}%`; }

/** 목록: 응답자 = 문서 1건. 카드에 그 사람의 목소리(가장 긴 자유 의견)를 바로 노출한다. */
function respondentListHtml(pid, sid, respondents, sortKey) {
  if (!respondents.length) {
    return `<p class="empty">아직 응답이 없습니다.<br>
      <span class="small">응답이 쌓이면 여기에서 한 사람씩 전체 답변을 볼 수 있습니다.</span></p>`;
  }
  const cmp = {
    ratio: (a, b) => b.ratio - a.ratio || b.commentCount - a.commentCount || natCompare(a.label, b.label),
    comments: (a, b) => b.commentCount - a.commentCount || b.ratio - a.ratio || natCompare(a.label, b.label),
    label: (a, b) => natCompare(a.label, b.label),
  }[sortKey] || null;
  const sorted = cmp ? [...respondents].sort(cmp) : respondents;
  const shown = sorted.slice(0, MAX_RESPONDENT_CARDS);
  const withComments = respondents.filter((r) => r.commentCount > 0).length;

  return `
    <div class="card">
      <div class="link-bar">
        <span class="small">응답자 <b>${respondents.length}</b>명 · 자유 의견을 남긴 사람 <b>${withComments}</b>명</span>
        <span style="flex:1"></span>
        <span class="small muted">정렬</span>
        <select data-resp-sort style="width:auto">
          ${RESPONDENT_SORTS.map(([v, l]) =>
            `<option value="${v}"${v === sortKey ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
        <button class="btn" data-export-all
          title="모든 응답자의 응답 프로필을 answerProfile 형태 JSON 한 파일로 내려받습니다">전체 프로필 JSON</button>
      </div>
      <p class="small muted" style="margin-top:10px">
        카드를 누르면 그 사람이 문항 전체에 어떻게 답했는지 순서대로 볼 수 있습니다.
        페르소나는 이 <b>개인의 응답 프로필</b>에서 나오며, 문항별 집계는 그 사람이 다수인지 소수인지를 알려주는 보조 정보입니다.
        내려받는 JSON은 로컬 분석용이며 repo에 커밋하지 마세요.
      </p>
    </div>
    ${sorted.length > shown.length ? `<p class="small muted" style="margin:12px 0 -2px">
      응답자 ${sorted.length}명 중 ${shown.length}명만 표시합니다. 정렬을 바꿔 다른 응답자를 확인하거나,
      <b>전체 프로필 JSON</b>으로 ${sorted.length}명 전부를 내려받으세요.</p>` : ''}
    <div class="grid cols2" style="margin-top:14px">
      ${shown.map((r) => `
        <a class="card resp-card" href="${esc(respondentHref(pid, sid, r.key))}">
          <h3>${esc(r.label)}
            <span class="badge">응답률 ${esc(pctText(r))}</span>
            ${r.commentCount ? `<span class="badge accent">의견 ${r.commentCount}</span>` : ''}
          </h3>
          <p class="small muted">${r.answered}/${r.total} 문항${
            fmtDateTime(r.doc.submittedAt) ? ` · ${esc(fmtDateTime(r.doc.submittedAt))}` : ''}</p>
          <div class="bar-track" style="margin-top:8px"><div class="bar-fill" style="width:${Math.round(r.ratio * 100)}%"></div></div>
          ${r.preview
            ? `<p class="resp-preview">“${esc(r.preview)}”</p>`
            : `<p class="small muted" style="margin-top:8px">자유 의견 없음</p>`}
        </a>`).join('')}
    </div>`;
}

/** 상세: 그 사람의 문항 전체 답변을 순서대로. 무응답도 빠뜨리지 않는다. */
function respondentDetailHtml(pid, sid, r, prev, next) {
  const listHref = `?p=${encodeURIComponent(pid)}&s=${encodeURIComponent(sid)}&by=respondent`;
  return `
    <div class="section-head" style="margin-top:18px">
      <h2>${esc(r.label)} <span class="badge">응답자 프로필</span></h2>
      <span style="display:flex;gap:8px;flex-wrap:wrap">
        ${prev ? `<a class="btn" href="${esc(respondentHref(pid, sid, prev.key))}">← ${esc(prev.label)}</a>` : ''}
        ${next ? `<a class="btn" href="${esc(respondentHref(pid, sid, next.key))}">${esc(next.label)} →</a>` : ''}
      </span>
    </div>
    <div class="card">
      <div class="num-summary">
        <span>응답률 <b>${esc(pctText(r))}</b> <span class="small muted">(${r.answered}/${r.total})</span></span>
        <span>자유 의견 <b>${r.commentCount}</b>건</span>
        ${fmtDateTime(r.doc.submittedAt) ? `<span class="muted">제출 ${esc(fmtDateTime(r.doc.submittedAt))}</span>` : ''}
      </div>
      <div class="bar-track" style="margin-top:10px"><div class="bar-fill" style="width:${Math.round(r.ratio * 100)}%"></div></div>
      <div class="link-bar" style="margin-top:14px">
        <a class="btn" href="${esc(listHref)}">← 응답자 목록</a>
        <span style="flex:1"></span>
        <button class="btn primary" data-export-one
          title="이 응답자의 답변을 answerProfile 형태 JSON으로 내려받습니다">응답 프로필 JSON</button>
      </div>
      <p class="small muted" style="margin-top:10px">
        아래는 이 사람이 실제로 낸 답변 전체입니다. 익명 라벨만 쓰며 이름·계정은 저장하지도, 표시하지도 않습니다.
      </p>
    </div>
    ${r.rows.map((row, i) => `
      <div class="qcard" style="margin-top:12px">
        <div class="qtext">${i + 1}. ${esc(row.question.text || '')}
          <span class="badge">${esc(TYPE_LABELS[row.question.type] || row.question.type)}</span>
          ${row.question.personaDimension
            ? `<span class="badge accent">${esc(row.question.personaDimension)}</span>` : ''}
        </div>
        ${answerBlockHtml(row.question, row.answer)}
        ${row.comment ? `<blockquote class="free-text">${esc(row.comment)}<span class="who">자유 의견</span></blockquote>` : ''}
      </div>`).join('')}
    ${r.orphanKeys.length ? `<p class="small muted" style="margin-top:12px">
      현재 문항 정의에 없는 응답 키 ${r.orphanKeys.length}개(${esc(r.orphanKeys.slice(0, 5).join(', '))}${
        r.orphanKeys.length > 5 ? ' 외' : ''})가 이 응답에 남아 있습니다 — 문항이 바뀐 뒤 다시 동기화하지 않은 경우입니다.</p>` : ''}
    <div class="banner info" style="margin-top:20px">
      <b>이 응답자로 페르소나 만들기</b> —
      페르소나 생성(<b>M05 persona-builder</b>)은 아직 구현되지 않았습니다.
      지금은 위의 <b>응답 프로필 JSON</b>을 내려받아 로컬에서 에이전트에 입력하세요
      (persona.schema.json의 <code>answerProfile</code> 형태입니다).
      생성된 페르소나는 <a href="../persona/?p=${esc(encodeURIComponent(pid))}">페르소나 화면</a>에서 볼 수 있습니다.
    </div>`;
}

/** 응답자별 보기 렌더 + 이벤트 바인딩. headHtml은 상세 뷰와 공유하는 머리말. */
function renderRespondentView({ pid, sid, survey, respondents, loadErr, headHtml }) {
  const picked = findRespondent(respondents, respondentKey);
  const sortKey = renderRespondentView.sortKey || 'ratio';

  if (respondentKey && !picked) {
    app.innerHTML = `${headHtml}
      <p class="empty">응답자 '${esc(respondentKey)}'를 찾을 수 없습니다.<br>
        <a href="?p=${esc(pid)}&s=${esc(sid)}&by=respondent">← 응답자 목록</a></p>`;
    core.renderModeBanner(app);
    return;
  }

  let prev = null, next = null;
  if (picked) {
    prev = respondents[picked.index - 2] || null;
    next = respondents[picked.index] || null;
  }

  app.innerHTML = `${headHtml}
    ${loadErr ? `<div class="banner">응답을 불러오지 못했습니다: ${esc(loadErr)}</div>` : ''}
    ${picked
      ? respondentDetailHtml(pid, sid, picked, prev, next)
      : respondentListHtml(pid, sid, respondents, sortKey)}`;
  core.renderModeBanner(app);

  app.querySelector('[data-resp-sort]')?.addEventListener('change', (ev) => {
    renderRespondentView.sortKey = ev.target.value;   // 정렬은 화면 상태 — URL은 건드리지 않는다
    renderRespondentView({ pid, sid, survey, respondents, loadErr, headHtml });
  });

  app.querySelector('[data-export-one]')?.addEventListener('click', () => {
    downloadJson(buildAnswerProfile(sid, picked), `${sid}-${profileFileSlug(picked)}-profile.json`);
  });

  app.querySelector('[data-export-all]')?.addEventListener('click', () => {
    downloadJson({
      surveyId: sid,
      surveyTitle: survey.title || '',
      exportedAt: new Date().toISOString(),
      questionCount: (survey.questions || []).length,
      respondentCount: respondents.length,
      profiles: respondents.map((r) => buildAnswerProfile(sid, r)),
    }, `${sid}-profiles.json`);
  });
}

// ---------- 뷰 3: 상세/결과 ----------
async function renderDetail(pid, sid) {
  const survey = await core.getSurvey(pid, sid);
  if (!survey) {
    app.innerHTML = `${crumbHtml(pid, ` · <a href="?p=${esc(pid)}">서베이 목록</a>`)}
      <p class="empty">서베이 '${esc(sid)}'를 찾을 수 없습니다.</p>`;
    core.renderModeBanner(app);
    return;
  }
  document.title = `${survey.title} — Persona Loop`;

  // 문항별 페르소나 차원 편집 — 연동·CSV·직접 생성 모든 서베이에 공통으로 보인다.
  // 미리보기(연동 위저드)에서 지정한 값도, 나중에 마음이 바뀐 값도 여기서 고친다.
  const dimCardHtml = (questions) => `
    <div class="section-head"><h2>페르소나 차원 태깅</h2></div>
    <p class="small muted" style="margin:-6px 0 12px">
      각 문항이 페르소나의 어떤 면을 밝히는지 지정해 두면, 페르소나 생성이 그 근거를 문항에 연결합니다.
      여기서 바꿔도 응답 데이터와 원본 설문은 변경되지 않습니다.
    </p>
    ${questions.length ? `
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="width:44px">#</th><th>문항</th>
            <th style="width:110px">유형</th>
            <th class="dim-col" style="width:150px">페르소나 차원</th>
          </tr></thead>
          <tbody>
            ${questions.map((q, i) => `
              <tr>
                <td class="small muted">${i + 1}</td>
                <td>${esc(q.text)}</td>
                <td><span class="badge">${esc(TYPE_LABELS[q.type] || q.type)}</span></td>
                <td class="dim-col">${dimSelectHtml('dim', q.personaDimension || '')
                  .replace('<select ', `<select data-qid="${esc(q.id)}" `)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div style="display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-top:14px;flex-wrap:wrap">
        <span class="small muted" data-dim-msg></span>
        <button class="btn primary" data-save-dims>차원 저장</button>
      </div>` : `<p class="empty">문항이 없습니다.</p>`}`;

  const draw = async () => {
    if (byView === 'respondent') app.innerHTML = `<p class="empty">응답을 불러오는 중…</p>`;

    // 응답 원본은 두 보기가 함께 쓴다 — 문항별은 집계로, 응답자별은 사람 단위로 읽는다.
    let responses = [], loadErr = '';
    try { responses = await core.listResponses(pid, sid); }
    catch (e) { loadErr = e.message; }

    // 데이터 소스: (a) Firestore 원본 응답 실시간 집계 → (b) 서베이 문서에 저장된 aggregates → (c) 없음
    let agg = null, aggSource = null;
    if (responses.length) { agg = computeAggregates(survey, responses); aggSource = 'live'; }
    if (!agg && survey.aggregates) { agg = survey.aggregates; aggSource = 'stored'; }

    const questions = survey.questions || [];
    const respondUrl = `${location.origin}${location.pathname}?p=${encodeURIComponent(pid)}&s=${encodeURIComponent(sid)}&mode=respond`;

    // now-here-survey에서 연동된 서베이는 출처 회차와 마지막 동기화 시각을 밝힌다.
    const ext = survey.externalRef || null;
    // fromSource: 원본 설문에서 가져온 사본 — 여기서 응답을 받지 않는다(공개 폼·상태 변경 금지).
    // isLinked: 그중 회차 정보까지 있어 '다시 동기화'가 가능한 경우.
    const fromSource = survey.source === 'now-here-survey';
    const isLinked = fromSource && !!ext;
    const sourceAdminUrl = core.safeUrl(SURVEY_SOURCE.adminUrl);
    const resyncHref = isLinked
      ? `?p=${encodeURIComponent(pid)}&view=link&src=${encodeURIComponent(ext.surveyId || '')}`
        + `&sess=${encodeURIComponent(ext.sessionId || '')}`
      : '';
    const sourceMeta = isLinked
      ? ` · 출처: now-here-survey · 회차 ${esc(String(ext.sessionId || '').slice(0, 8))}`
        + (ext.syncedAt ? ` · 마지막 동기화 ${esc(fmtDate(ext.syncedAt))}` : '')
      : (survey.source ? ` · 출처: ${esc(survey.source)}` : '');

    // 보기 전환 — 상태를 쿼리 파라미터에 두어 뒤로가기로 되돌아갈 수 있게 한다.
    const byHref = `?p=${encodeURIComponent(pid)}&s=${encodeURIComponent(sid)}`;
    const onRespondent = byView === 'respondent';
    const headHtml = `
      ${crumbHtml(pid, ` · <a href="?p=${esc(pid)}">서베이 목록</a>`)}
      <div class="section-head" style="margin-top:0">
        <h2>${esc(survey.title)} ${statusBadge(survey.status)}</h2>
      </div>
      <p class="muted" style="margin:-8px 0 6px">${esc(survey.description || '')}</p>
      <p class="small muted">문항 ${questions.length}개 · 응답 ${agg?.responseCount ?? survey.responseCount ?? 0}건
        ${sourceMeta}
        ${survey.createdAt ? ` · ${esc(survey.createdAt)}` : ''}</p>
      <nav class="view-chips" aria-label="결과 보기 전환">
        <a href="${esc(byHref)}" class="${onRespondent ? '' : 'on'}"
          ${onRespondent ? '' : 'aria-current="page"'}>문항별</a>
        <a href="${esc(`${byHref}&by=respondent`)}" class="${onRespondent ? 'on' : ''}"
          ${onRespondent ? 'aria-current="page"' : ''}>응답자별</a>
      </nav>`;

    if (onRespondent) {
      renderRespondentView({
        pid, sid, survey, loadErr, headHtml,
        respondents: buildRespondents(questions, responses),
      });
      return;
    }

    app.innerHTML = `
      ${headHtml}
      <div class="card" style="margin-top:14px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span class="small muted">상태</span>
          <select data-status style="width:auto"${fromSource ? ' disabled' : ''}>
            ${['draft', 'open', 'closed'].map((s) =>
              `<option value="${s}"${survey.status === s ? ' selected' : ''}>${esc(STATUS_LABELS[s])}</option>`).join('')}
            ${survey.status === 'imported' ? `<option value="imported" selected>${esc(STATUS_LABELS.imported)}</option>` : ''}
          </select>
          ${fromSource ? `<span class="small muted">연동 서베이는 원본에서 진행합니다 — 여기서 응답을 받지 않습니다</span>`
            : `<button class="btn" data-copy-link>응답 링크 복사</button>`}
          ${fromSource && survey.status === 'open' ? `<button class="btn" data-close-public
            title="공개 응답 폼을 즉시 닫고 상태를 '임포트됨'으로 되돌립니다">공개 폼 닫기</button>` : ''}
          ${agg ? `<button class="btn" data-download
            title="서베이 정의와 집계 결과를 JSON 한 파일로 내려받습니다 (백업·외부 분석용)">집계 JSON 내보내기</button>` : ''}
          ${isLinked ? `<a class="btn" href="${esc(resyncHref)}"
            title="now-here-survey의 해당 회차를 다시 읽어옵니다 (원본은 변경되지 않습니다)">다시 동기화</a>` : ''}
          ${fromSource && sourceAdminUrl ? `<a class="btn" href="${esc(sourceAdminUrl)}"
            target="_blank" rel="noopener noreferrer"
            title="원본 설문(now-here-survey) 관리자 화면을 새 탭에서 엽니다">원본 관리 화면 ↗</a>` : ''}
        </div>
        <p class="small muted" style="margin-top:8px">
          ${fromSource
            ? `이 서베이는 now-here-survey에서 읽어온 <b>사본</b>입니다. 회차 진행·응답 수집은 원본에서만 하며,
               여기서는 결과 열람과 페르소나 차원 태깅만 합니다. 그래서 상태 변경과 공개 응답 폼은 막혀 있습니다.
               ${survey.status === 'open'
                 ? `<b style="color:var(--danger)">지금 공개 폼이 열려 있어 원본에서 가져온 문항(참가자 의견 포함)이
                    링크만 있으면 보입니다 — '공개 폼 닫기'로 즉시 닫으세요.</b>` : ''}`
            : `상태를 <b>진행 중</b>으로 두면 링크를 가진 누구나 로그인 없이 <b>문항만</b> 볼 수 있습니다
               (집계·응답 원본은 공개되지 않습니다). 마감하면 링크는 즉시 닫힙니다.`}
          ${agg ? '내보낸 JSON은 백업·외부 분석용이며 사이트 표시에는 쓰이지 않습니다 (데이터는 Firestore에만 저장됨).' : ''}
        </p>
      </div>
      ${dimCardHtml(questions)}
      <div class="section-head"><h2>결과</h2>
        ${aggSource === 'live' ? `<span class="badge accent">원본 응답 실시간 집계</span>`
          : aggSource === 'stored' ? `<span class="badge">저장된 집계 (${esc(agg.computedAt || '')})</span>` : ''}
      </div>
      ${agg
        ? questions.map((q, i) => `
          <div class="qcard">
            <div class="qtext">${i + 1}. ${esc(q.text)}
              <span class="badge">${esc(TYPE_LABELS[q.type] || q.type)}</span>
              ${q.personaDimension ? `<span class="badge accent">${esc(q.personaDimension)}</span>` : ''}
            </div>
            ${questionResultHtml(q, agg.byQuestion?.[q.id], agg.responseCount)}
          </div>`).join('')
        : `<p class="empty">아직 응답이 없습니다.<br>
           <span class="small">${fromSource
             ? '원본 회차에 응답이 쌓인 뒤 <b>다시 동기화</b>하면 여기에 결과가 나타납니다.'
             : '상태를 <b>진행 중</b>으로 바꾼 뒤 응답 링크를 공유해 응답을 모아보세요.'}</span></p>`}`;
    core.renderModeBanner(app);

    app.querySelector('[data-status]')?.addEventListener('change', async (ev) => {
      try {
        await core.saveSurvey(pid, { id: sid, status: ev.target.value });
        survey.status = ev.target.value;
        draw();
      } catch (e) { alert(e.message); ev.target.value = survey.status; }
    });
    app.querySelector('[data-copy-link]')?.addEventListener('click', async (ev) => {
      try {
        await navigator.clipboard.writeText(respondUrl);
        ev.target.textContent = '복사됨!';
        setTimeout(() => { ev.target.textContent = '응답 링크 복사'; }, 1500);
      } catch { prompt('아래 링크를 복사하세요:', respondUrl); }
    });
    // 이 수정 이전에 연동 서베이를 '진행 중'으로 바꿔둔 경우를 위한 탈출구 — 공개 폼을 즉시 닫는다.
    app.querySelector('[data-close-public]')?.addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        await core.saveSurvey(pid, { id: sid, status: 'imported' });
        survey.status = 'imported';
        await draw();
      } catch (e) { alert(e.message); ev.target.disabled = false; }
    });
    app.querySelector('[data-download]')?.addEventListener('click', () => {
      // 백업·외부 분석용 내보내기 (repo에 커밋하지 않는다 — 원본은 Firestore가 유일)
      const out = { ...survey, responseCount: agg.responseCount ?? survey.responseCount, aggregates: agg };
      downloadJson(out, `${sid}.json`);
    });
    app.querySelector('[data-save-dims]')?.addEventListener('click', async (ev) => {
      const btn = ev.target;
      const msg = app.querySelector('[data-dim-msg]');
      const picked = {};
      app.querySelectorAll('.dim-col select[data-qid]').forEach((sel) => { picked[sel.dataset.qid] = sel.value; });

      // merge 저장이라도 배열 필드는 통째로 교체된다 — 기존 questions를 전부 복사해
      // personaDimension만 갈아끼운 '완전한' 배열을 넘겨야 문항이 사라지지 않는다.
      const next = questions.map((q) => {
        const { personaDimension, ...rest } = q;
        const v = Object.prototype.hasOwnProperty.call(picked, q.id) ? picked[q.id] : (personaDimension || '');
        return v ? { ...rest, personaDimension: v } : rest;   // 빈 값이면 키 자체를 뺀다
      });

      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = '저장 중…';
      msg.textContent = '';
      msg.style.color = '';
      try {
        await core.saveSurvey(pid, { id: sid, questions: next });
        survey.questions = next;
        await draw();   // 결과 섹션의 차원 뱃지도 함께 갱신
        const fresh = app.querySelector('[data-dim-msg]');
        if (fresh) { fresh.textContent = '저장되었습니다.'; fresh.style.color = 'var(--accent)'; }
      } catch (e) {
        msg.style.color = 'var(--danger)';
        msg.textContent = `저장 실패: ${e.message}`;
        btn.disabled = false;
        btn.textContent = label;
      }
    });
  };

  await draw();
}

// ---------- 뷰 4: 응답 모드 (공개 폼) ----------
async function renderRespond(pid, sid) {
  // 응답자는 서베이 문서가 아니라 공개 폼 문서(public-forms)를 읽는다.
  // 서베이 문서에는 집계·응답 원본이 들어 있어 공개하면 안 되기 때문 (firestore.rules 참고).
  // 공개 폼은 status가 'open'일 때만 존재하므로 null과 non-open은 응답자에게 같은 상황이다.
  const survey = await core.getPublicForm(pid, sid);
  if (!survey || survey.status !== 'open') {
    app.innerHTML = `
      ${survey ? `<h2 style="margin:24px 0 8px">${esc(survey.title)}</h2>` : ''}
      <p class="empty">이 서베이는 현재 응답을 받지 않습니다 (마감되었거나 아직 공개되지 않음).
        ${state.degraded ? '<br><span class="small">연결 상태가 불안정할 수 있습니다. 잠시 후 새로고침해 주세요.</span>' : ''}</p>`;
    return;
  }
  document.title = survey.title;

  const questions = survey.questions || [];
  app.innerHTML = `
    <h2 style="margin:24px 0 4px">${esc(survey.title)}</h2>
    ${survey.description ? `<p class="muted" style="margin-bottom:8px">${esc(survey.description)}</p>` : ''}
    <p class="small muted" style="margin-bottom:20px">익명으로 제출됩니다 · 모든 문항 필수</p>
    <form data-respond-form novalidate>
      ${questions.map((q, i) => {
        const name = esc(q.id);
        let body = '';
        if (q.type === 'single') {
          body = (q.options || []).map((opt) => `
            <label class="opt-line"><input type="radio" name="${name}" value="${esc(opt)}"> ${esc(opt)}</label>`).join('');
        } else if (q.type === 'multi') {
          body = (q.options || []).map((opt) => `
            <label class="opt-line"><input type="checkbox" name="${name}" value="${esc(opt)}"> ${esc(opt)}</label>`).join('');
        } else if (q.type === 'likert') {
          const scale = q.scale || 5;
          body = `<div class="likert-row">
              ${Array.from({ length: scale }, (_, k) => `
                <label><input type="radio" name="${name}" value="${k + 1}" style="width:auto">${k + 1}</label>`).join('')}
            </div>
            <div class="likert-ends"><span>전혀 아니다</span><span>매우 그렇다</span></div>`;
        } else if (q.type === 'number') {
          body = `<input type="number" name="${name}" style="max-width:200px">`;
        } else {
          body = `<textarea name="${name}"></textarea>`;
        }
        return `<div class="qcard" data-qid="${name}">
          <div class="qtext">${i + 1}. ${esc(q.text)}</div>${body}
        </div>`;
      }).join('')}
      <div style="display:flex;justify-content:flex-end;margin-top:20px">
        <button type="submit" class="btn primary">제출하기</button>
      </div>
    </form>`;

  app.querySelector('[data-respond-form]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const answers = {};
    let firstMissing = null;
    app.querySelectorAll('.qcard').forEach((c) => c.classList.remove('q-missing'));

    for (const q of questions) {
      const card = app.querySelector(`.qcard[data-qid="${CSS.escape(q.id)}"]`);
      let value;
      if (q.type === 'single') {
        value = form.querySelector(`input[name="${CSS.escape(q.id)}"]:checked`)?.value;
      } else if (q.type === 'multi') {
        const checked = [...form.querySelectorAll(`input[name="${CSS.escape(q.id)}"]:checked`)].map((el) => el.value);
        value = checked.length ? checked : undefined;
      } else if (q.type === 'likert') {
        const v = form.querySelector(`input[name="${CSS.escape(q.id)}"]:checked`)?.value;
        value = v === undefined ? undefined : Number(v);
      } else if (q.type === 'number') {
        const raw = form.elements[q.id]?.value.trim();
        value = raw ? Number(raw) : undefined;
        if (value !== undefined && !Number.isFinite(value)) value = undefined;
      } else {
        const raw = form.elements[q.id]?.value.trim();
        value = raw || undefined;
      }
      if (value === undefined) {
        card?.classList.add('q-missing');
        if (!firstMissing) firstMissing = card;
      } else {
        answers[q.id] = value;
      }
    }

    if (firstMissing) {
      firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '제출 중…';
    try {
      await core.submitResponse(pid, sid, answers);
      app.innerHTML = `
        <h2 style="margin:24px 0 8px">${esc(survey.title)}</h2>
        <p class="empty">응답이 제출되었습니다. 참여해주셔서 감사합니다! 🙏</p>`;
    } catch (e) {
      alert(`제출에 실패했습니다: ${e.message}`);
      btn.disabled = false; btn.textContent = '제출하기';
    }
  });
}

// ---------- 뷰 5: now-here-survey 연동 (읽기 전용) ----------
// 이 화면은 외부 설문 서비스에서 **읽기만** 한다. survey-source.js는 GET과 로그인 POST 외에
// 어떤 요청도 보내지 않으므로, 여기서 무엇을 하든 원본 설문의 데이터·진행 상태는 바뀌지 않는다.

const SOURCE_STATUS_LABELS = { draft: '초안', live: '진행 중', ended: '종료' };

function sourceStatusBadge(status) {
  const cls = status === 'live' ? 'ok' : status === 'ended' ? 'accent' : '';
  return `<span class="badge ${cls}">${esc(SOURCE_STATUS_LABELS[status] || status || '-')}</span>`;
}

/** ISO/날짜 문자열 → YYYY-MM-DD (파싱 실패 시 앞 10자). */
function fmtDate(v) {
  if (!v) return '';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
}

/** 서베이 id 후보용 슬러그 — 한글 회차 이름이면 빈 문자열이 되므로 호출부에서 대체값을 쓴다. */
function slugifyId(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
}

function optionsSummary(q) {
  if (q.type === 'open') return '(주관식)';
  const opts = q.options || [];
  if (!opts.length) return '—';
  const head = opts.slice(0, 4).map((o) => esc(o)).join(' / ');
  return opts.length > 4 ? `${head} <span class="muted">외 ${opts.length - 4}개</span>` : head;
}

async function renderLinkView(pid) {
  const crumb = crumbHtml(pid, ` · <a href="?p=${esc(pid)}">서베이 목록</a>`);
  const adminUrl = core.safeUrl(SURVEY_SOURCE.adminUrl);
  const wantSurvey = qsParam('src');   // 상세 뷰의 "다시 동기화"로 들어온 경우
  const wantSession = qsParam('sess');

  const lk = {
    surveys: null, surveysErr: '',
    survey: null, sessions: null, sessionsErr: '',
    session: null, preview: null, previewErr: '', rawResponseCount: 0,
    dims: {}, existing: null, targetId: '',
  };

  // sessionStorage가 막혀 있어도(사생활 보호 모드 등) 화면은 떠야 한다.
  try { initSurveySource(); } catch { /* 미연결로 취급 */ }

  // ----- 조각 렌더러 -----
  const stepsHtml = () => {
    const n = !sourceState.connected ? 1 : !lk.preview ? 2 : 3;
    return `<div class="steps">
      ${['1 연결', '2 설문 · 회차 선택', '3 미리보기 · 가져오기'].map((s, i) =>
        `<span class="${i + 1 === n ? 'on' : ''}">${esc(s)}</span>`).join('')}
    </div>`;
  };

  const connectHtml = () => {
    if (sourceState.connected) {
      return `<div class="card link-bar">
        <span class="badge ok">연결됨</span>
        <span class="small">${esc(sourceState.email || '')}</span>
        <span style="flex:1"></span>
        ${adminUrl ? `<a class="btn" href="${esc(adminUrl)}" target="_blank" rel="noopener">설문 관리자 화면 ↗</a>` : ''}
        <button class="btn" data-disconnect>연결 해제</button>
      </div>`;
    }
    return `<div class="card">
      <h3>설문 시스템에 연결</h3>
      <p class="small" style="margin-top:8px">
        Persona Loop는 설문 데이터를 <b>읽기만</b> 합니다.
        기존 설문 서비스의 데이터나 진행 상태를 변경하지 않습니다.
      </p>
      <p class="small muted" style="margin-top:6px">
        now-here-survey는 관리자만 데이터를 읽을 수 있도록 잠겨 있어(RLS),
        <b>설문 관리자 계정</b>으로 로그인해야 합니다.
        로그인 정보는 이 브라우저 탭에만 보관되고 탭을 닫으면 사라집니다.
        ${adminUrl ? `· <a href="${esc(adminUrl)}" target="_blank" rel="noopener">설문 관리자 화면 열기 ↗</a>` : ''}
      </p>
      <form data-connect-form>
        <label for="nhs-email">이메일</label>
        <input type="text" id="nhs-email" data-email autocomplete="username" placeholder="admin@example.com">
        <label for="nhs-pw">비밀번호</label>
        <input type="password" id="nhs-pw" data-password autocomplete="current-password">
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
          <a class="btn" href="?p=${esc(pid)}">취소</a>
          <button type="submit" class="btn primary" data-connect-btn>연결하기</button>
        </div>
        <p class="small" data-connect-err style="color:var(--danger);margin-top:8px;white-space:pre-wrap"></p>
      </form>
    </div>`;
  };

  const surveysHtml = () => {
    if (!sourceState.connected) return '';
    if (lk.surveysErr) {
      return `<div class="section-head"><h2>설문 선택</h2></div>
        <div class="card"><p class="small" style="color:var(--danger)">설문 목록을 불러오지 못했습니다: ${esc(lk.surveysErr)}</p>
        <p style="margin-top:10px"><button class="btn" data-reload-surveys>다시 시도</button></p></div>`;
    }
    if (lk.surveys === null) return `<p class="empty">설문 목록을 불러오는 중…</p>`;
    if (!lk.surveys.length) return `<p class="empty">이 계정으로 볼 수 있는 설문이 없습니다.</p>`;
    return `<div class="section-head"><h2>설문 선택</h2></div>
      <div class="grid cols2">
        ${lk.surveys.map((s) => `
          <button class="card pick" type="button" data-pick-survey="${esc(s.id)}"
            aria-label="설문 선택: ${esc(s.title || '제목 없음')}"
            aria-pressed="${lk.survey && lk.survey.id === s.id ? 'true' : 'false'}">
            <h3>${esc(s.title || '(제목 없음)')}</h3>
            <p class="small muted">생성 ${esc(fmtDate(s.created_at))}</p>
          </button>`).join('')}
      </div>`;
  };

  const sessionsHtml = () => {
    if (!lk.survey) return '';
    let body;
    if (lk.sessionsErr) {
      body = `<div class="card"><p class="small" style="color:var(--danger)">회차를 불러오지 못했습니다: ${esc(lk.sessionsErr)}</p>
        <p style="margin-top:10px"><button class="btn" data-reload-sessions>다시 시도</button></p></div>`;
    } else if (lk.sessions === null) {
      body = `<p class="empty">회차를 불러오는 중…</p>`;
    } else if (!lk.sessions.length) {
      body = `<p class="empty">이 설문에는 아직 회차가 없습니다.</p>`;
    } else {
      body = `<div class="grid cols2">
        ${lk.sessions.map((s) => `
          <button class="card pick" type="button" data-pick-session="${esc(s.id)}"
            aria-label="회차 선택: ${esc(s.name || '이름 없는 회차')} (${esc(SOURCE_STATUS_LABELS[s.status] || s.status || '-')})"
            aria-pressed="${lk.session && lk.session.id === s.id ? 'true' : 'false'}">
            <h3>${esc(s.name || '(이름 없는 회차)')} ${sourceStatusBadge(s.status)}</h3>
            <p class="small muted">생성 ${esc(fmtDate(s.created_at))}${
              s.ended_at ? ` · 종료 ${esc(fmtDate(s.ended_at))}` : ''}</p>
          </button>`).join('')}
      </div>`;
    }
    return `<div class="section-head"><h2>회차 선택</h2></div>
      <p class="small muted" style="margin:-6px 0 12px">
        응답이 쌓인 회차를 고르세요 — <b>종료</b>된 회차가 가장 안전합니다.
        진행 중인 회차는 아직 응답이 들어오는 중이라 나중에 다시 동기화해야 할 수 있습니다.
      </p>
      ${body}`;
  };

  const previewHtml = () => {
    if (!lk.session) return '';
    if (lk.previewErr) {
      return `<div class="section-head"><h2>미리보기</h2></div>
        <div class="card"><p class="small" style="color:var(--danger)">회차 데이터를 불러오지 못했습니다: ${esc(lk.previewErr)}</p>
        <p style="margin-top:10px"><button class="btn" data-reload-preview>다시 시도</button></p></div>`;
    }
    if (!lk.preview) return `<p class="empty">회차 데이터를 불러오는 중…</p>`;

    const qs = lk.preview.definition.questions || [];
    const respondents = lk.preview.responses.length;
    return `<div class="section-head"><h2>미리보기</h2>
        <span class="badge">아직 가져오지 않음</span></div>
      <div class="card">
        <p class="small" style="margin-bottom:6px"><b>${esc(lk.preview.definition.title)}</b></p>
        <div class="num-summary">
          <span>문항 <b>${qs.length}</b>개</span>
          <span>응답자 <b>${respondents}</b>명</span>
          <span>응답 <b>${lk.rawResponseCount}</b>건</span>
        </div>
        <p class="small muted" style="margin-top:8px">
          안내(info) 페이지는 문항에서 제외되고, 자유 의견이 달린 문항은 <code>-c</code> 주관식 문항으로 따로 들어옵니다.
          참가자는 P1, P2 … 로 익명화되어 이름·아이디는 저장되지 않습니다.
        </p>
        ${respondents === 0 ? `<p class="small" style="color:var(--danger);margin-top:8px">
          이 회차에는 아직 응답이 없습니다. 문항 구조만 가져오게 됩니다.</p>` : ''}
      </div>

      <div class="banner info" style="margin-top:14px">
        <b>페르소나 차원 지정</b> — 각 문항이 페르소나의 어떤 면을 밝히는지 여기서 정해두면,
        나중에 페르소나 생성이 그 근거를 문항에 연결합니다. 이게 Persona Loop가 원본 설문에 더하는 값입니다.
        (가져온 뒤에도 서베이 상세 화면의 <b>페르소나 차원 태깅</b> 카드에서 언제든 바꿀 수 있습니다.)
      </div>
      <div class="table-wrap" style="margin-top:12px">
        <table>
          <thead><tr>
            <th style="width:44px">#</th><th style="width:110px">유형</th><th>문항</th>
            <th>선택지</th><th class="dim-col" style="width:150px">페르소나 차원</th>
          </tr></thead>
          <tbody>
            ${qs.map((q, i) => `
              <tr>
                <td class="small muted">${i + 1}</td>
                <td><span class="badge">${esc(TYPE_LABELS[q.type] || q.type)}</span></td>
                <td>${esc(q.text)}${q.description
                  ? `<br><span class="small muted">${esc(q.description)}</span>` : ''}</td>
                <td class="small muted">${optionsSummary(q)}</td>
                <td class="dim-col">${dimSelectHtml('dim', lk.dims[q.id] || '')
                  .replace('<select ', `<select data-qid="${esc(q.id)}" `)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  };

  const importHtml = () => {
    if (!lk.preview) return '';
    const resync = !!lk.existing;
    return `<div class="section-head"><h2>가져오기</h2></div>
      <div class="card">
        ${resync ? `<div class="banner" style="margin-bottom:14px">
          이 회차는 이미 <b>${esc(lk.existing.id)}</b>로 가져온 적이 있습니다.
          그대로 실행하면 <b>재동기화</b>가 되어, 이 서베이의 기존 연동 응답을 모두 지우고 새로 읽어온 응답으로 <b>교체</b>합니다.
          직접 입력한 응답이나 CSV로 임포트한 응답은 건드리지 않습니다.<br>
          기존 페르소나 차원 태깅은 문항 id가 같으면 유지됩니다 (위 표에 그대로 채워져 있습니다).
        </div>` : `<p class="small muted" style="margin-bottom:6px">
          같은 회차를 나중에 다시 가져오면 이 서베이의 연동 응답은 새 데이터로 교체됩니다 (중복이 쌓이지 않습니다).
        </p>`}
        <label for="nhs-target">서베이 ID (소문자 · 숫자 · 하이픈)</label>
        <input type="text" id="nhs-target" data-target-id value="${esc(lk.targetId)}"
          pattern="[a-z0-9-]+" ${resync ? 'readonly' : ''}>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px">
          <button class="btn primary" data-run-import>${resync ? '재동기화 실행' : '가져오기 실행'}</button>
        </div>
        <ol class="progress-log" data-log></ol>
      </div>`;
  };

  // ----- 렌더 + 이벤트 바인딩 -----
  const draw = () => {
    app.innerHTML = `${crumb}
      <div class="section-head" style="margin-top:0"><h2>now-here-survey 연동</h2></div>
      ${stepsHtml()}
      ${connectHtml()}
      ${surveysHtml()}
      ${sessionsHtml()}
      ${previewHtml()}
      ${importHtml()}`;
    core.renderModeBanner(app);
    bind();
  };

  const bind = () => {
    app.querySelector('[data-connect-form]')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = app.querySelector('[data-connect-btn]');
      const err = app.querySelector('[data-connect-err]');
      const email = app.querySelector('[data-email]').value.trim();
      const password = app.querySelector('[data-password]').value;
      err.textContent = '';
      if (!email || !password) { err.textContent = '이메일과 비밀번호를 모두 입력하세요.'; return; }
      btn.disabled = true;
      const label = btn.textContent;
      btn.textContent = '연결 중…';
      try {
        await connectSource(email, password);
        lk.surveys = null; lk.surveysErr = '';
        draw();
        loadSurveys();
      } catch (e) {
        err.textContent = e.message;   // 원문 그대로 (원인 파악에 필요)
        btn.disabled = false;
        btn.textContent = label;
      }
    });

    app.querySelector('[data-disconnect]')?.addEventListener('click', () => {
      disconnectSource();
      lk.surveys = null; lk.surveysErr = '';
      lk.survey = null; lk.sessions = null; lk.sessionsErr = '';
      lk.session = null; lk.preview = null; lk.previewErr = '';
      draw();
    });

    app.querySelector('[data-reload-surveys]')?.addEventListener('click', () => {
      lk.surveys = null; lk.surveysErr = ''; draw(); loadSurveys();
    });
    app.querySelector('[data-reload-sessions]')?.addEventListener('click', () => {
      lk.sessions = null; lk.sessionsErr = ''; draw(); loadSessions();
    });
    app.querySelector('[data-reload-preview]')?.addEventListener('click', () => {
      lk.preview = null; lk.previewErr = ''; draw(); loadPreview();
    });

    app.querySelectorAll('[data-pick-survey]').forEach((b) => b.addEventListener('click', () => {
      const s = (lk.surveys || []).find((x) => x.id === b.dataset.pickSurvey);
      if (!s || (lk.survey && lk.survey.id === s.id)) return;
      lk.survey = s;
      lk.sessions = null; lk.sessionsErr = '';
      lk.session = null; lk.preview = null; lk.previewErr = '';
      draw();
      loadSessions();
    }));

    app.querySelectorAll('[data-pick-session]').forEach((b) => b.addEventListener('click', () => {
      const s = (lk.sessions || []).find((x) => x.id === b.dataset.pickSession);
      if (!s || (lk.session && lk.session.id === s.id)) return;
      lk.session = s;
      lk.preview = null; lk.previewErr = ''; lk.dims = {};
      draw();
      loadPreview();
    }));

    app.querySelectorAll('.dim-col select[data-qid]').forEach((sel) => {
      sel.addEventListener('change', () => { lk.dims[sel.dataset.qid] = sel.value; });
    });

    app.querySelector('[data-run-import]')?.addEventListener('click', runImport);
  };

  // ----- 로더 (모두 try/catch — 실패해도 화면은 살아 있어야 한다) -----
  async function loadSurveys() {
    try {
      lk.surveys = await listSourceSurveys();
      if (wantSurvey && !lk.survey) {
        const s = lk.surveys.find((x) => x.id === wantSurvey);
        if (s) { lk.survey = s; draw(); await loadSessions(); return; }
      }
    } catch (e) {
      lk.surveys = []; lk.surveysErr = e.message;
    }
    draw();
  }

  async function loadSessions() {
    if (!lk.survey) return;
    const forSurvey = lk.survey.id;
    try {
      const rows = await listSourceSessions(forSurvey);
      if (lk.survey?.id !== forSurvey) return;  // 그새 다른 설문을 골랐다
      lk.sessions = rows;
      if (wantSession && !lk.session) {
        const s = rows.find((x) => x.id === wantSession);
        if (s) { lk.session = s; draw(); await loadPreview(); return; }
      }
    } catch (e) {
      if (lk.survey?.id !== forSurvey) return;  // 그새 다른 설문을 골랐다 — 그쪽 화면을 덮지 않는다
      lk.sessions = []; lk.sessionsErr = e.message;
    }
    draw();
  }

  async function loadPreview() {
    if (!lk.survey || !lk.session) return;
    const survey = lk.survey, session = lk.session;
    try {
      const [{ pages, slides }, participants, responses] = await Promise.all([
        getSourceStructure(survey.id),
        listSourceParticipants(session.id),
        listSourceResponses(session.id),
      ]);
      if (lk.session?.id !== session.id) return;  // 그새 다른 회차를 골랐다
      const conv = convertSession({ survey, session, pages, slides, participants, responses });
      lk.preview = conv;
      lk.rawResponseCount = responses.length;

      // 같은 회차를 이미 가져왔는지 확인 → 재동기화 모드
      lk.existing = null;
      try {
        const mine = await core.listSurveys(pid);
        if (lk.session?.id !== session.id) return;  // 목록을 읽는 사이 다른 회차를 골랐다
        lk.existing = mine.find((sv) => sv.externalRef && sv.externalRef.sessionId === session.id) || null;
      } catch { /* 목록 조회 실패는 치명적이지 않다 — 새로 만들기로 진행 */ }

      // 재동기화라면 기존 서베이의 태깅을 먼저 되살린다 (문항 id 기준).
      // saveSurvey는 merge지만 배열은 통째로 교체되므로, 여기서 채우지 않으면 기존 태깅이 조용히 사라진다.
      lk.dims = {};
      for (const q of (lk.existing?.questions || [])) {
        if (q && q.id && q.personaDimension) lk.dims[q.id] = q.personaDimension;
      }
      // 의견에서 생성된 문항은 페인포인트가 기본값 — 페르소나의 핵심 재료라서.
      // 단 위에서 되살린 기존 태깅은 덮어쓰지 않는다.
      conv.definition.questions.forEach((q) => {
        if (q.id.endsWith('-c') && !lk.dims[q.id]) lk.dims[q.id] = 'painPoints';
      });

      // 회차 이름이 한글이면 슬러그가 비거나 너무 짧다("3월 A조" → "3-a"). 그럴 땐 회차 id 앞자리를 쓴다.
      const slug = slugifyId(session.name);
      const fallback = slugifyId(String(session.id).slice(0, 8)) || 'session';
      lk.targetId = lk.existing ? lk.existing.id
        : `nhs-${slug.replace(/-/g, '').length >= 3 ? slug : fallback}`;
    } catch (e) {
      if (lk.session?.id !== session.id) return;  // 그새 다른 회차를 골랐다 — 그쪽 화면을 덮지 않는다
      lk.preview = null; lk.previewErr = e.message;
    }
    draw();
  }

  // ----- 실행 -----
  async function runImport(ev) {
    if (!lk.preview || !lk.session) return;
    const btn = ev.target;
    const idInput = app.querySelector('[data-target-id]');
    const id = (idInput?.value || '').trim();
    if (!/^[a-z0-9-]{2,40}$/.test(id)) { alert('서베이 ID는 소문자·숫자·하이픈 2~40자여야 합니다.'); return; }

    const log = app.querySelector('[data-log]');
    log.innerHTML = '';
    const say = (msg) => { const li = document.createElement('li'); li.textContent = msg; log.appendChild(li); };
    btn.disabled = true;

    const questions = lk.preview.definition.questions.map((q) => (
      lk.dims[q.id] ? { ...q, personaDimension: lk.dims[q.id] } : q));
    const rows = lk.preview.responses;

    try {
      const existing = await core.getSurvey(pid, id);
      if (existing && existing.externalRef?.sessionId !== lk.session.id) {
        throw new Error(`서베이 id '${id}'는 이미 다른 서베이가 쓰고 있습니다. 다른 id를 입력하세요.`);
      }
      // responseCount는 넣지 않는다 — importResponses(replace)가 실제 건수로 맞춘다.
      const def = {
        id, projectId: pid,
        title: lk.preview.definition.title,
        description: lk.preview.definition.description,
        status: 'imported',
        source: 'now-here-survey',
        auth: 'anonymous',
        externalRef: lk.preview.definition.externalRef,
        createdAt: existing?.createdAt || today(),
        questions,
      };
      if (existing) {
        say('기존 서베이를 찾았습니다 — 재동기화합니다.');
        say('서베이 정의 갱신 중…');
        await core.saveSurvey(pid, def);
      } else {
        say('서베이 정의 저장 중…');
        await core.createSurvey(pid, def);
      }
      say(`응답 ${rows.length}건 저장 중… (기존 연동 응답은 교체됩니다)`);
      const res = await core.importResponses(pid, id, rows, { source: 'now-here-survey', replace: true });
      say(`완료 — 문항 ${questions.length}개, 응답 ${res?.added ?? rows.length}건 저장`
        + `${res?.removed ? ` (기존 연동 응답 ${res.removed}건 교체)` : ''}.`);
      say('원본 설문(now-here-survey)은 변경되지 않았습니다.');
      const li = document.createElement('li');
      li.innerHTML = `<a href="?p=${esc(pid)}&s=${esc(id)}">→ 결과 보러 가기</a>`;
      log.appendChild(li);
    } catch (e) {
      say(`실패: ${e.message}`);
      btn.disabled = false;
    }
  }

  draw();
  if (sourceState.connected) await loadSurveys();
}
