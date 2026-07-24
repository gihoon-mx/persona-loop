// Persona Loop — Survey 모듈
// 뷰 라우팅 (쿼리 파라미터, 뒤로가기 유지):
//   ?p=<pid>                     서베이 목록
//   ?p=<pid>&view=new            새 서베이 만들기 (admin)
//   ?p=<pid>&view=import         CSV 임포트 위저드 (admin)
//   ?p=<pid>&s=<sid>             상세/결과
//   ?p=<pid>&s=<sid>&mode=respond  응답자용 공개 폼 (미니멀)
import * as core from '../../packages/core/core.js';

const { esc, qsParam, state } = core;
const app = document.getElementById('app');

const projectId = qsParam('p');
const surveyId = qsParam('s');
const view = qsParam('view');
const mode = qsParam('mode');

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
  // 공유용 미니멀 화면 — 상단바 없이 서베이 제목만
  Promise.resolve(renderRespond(projectId, surveyId)).catch(fail);
} else {
  core.renderTopbar('../../');
  if (!projectId) {
    app.innerHTML = `<p class="empty">프로젝트를 먼저 선택하세요. <a href="../../">← 프로젝트 목록으로</a></p>`;
  } else if (surveyId) {
    Promise.resolve(renderDetail(projectId, surveyId)).catch(fail);
  } else if (view === 'import') {
    renderImportWizard(projectId);
  } else if (view === 'new') {
    renderNewSurvey(projectId);
  } else {
    Promise.resolve(renderList(projectId)).catch(fail);
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
  return `<select data-${name}>${DIMENSIONS.map(([v, l]) =>
    `<option value="${v}"${v === current ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
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

  const draw = () => {
    app.innerHTML = `
      ${crumbHtml(pid)}
      <div class="section-head" style="margin-top:0">
        <h2>서베이</h2>
        ${state.isAdmin ? `<span style="display:flex;gap:8px">
          <a class="btn" href="?p=${esc(pid)}&view=import">CSV 임포트</a>
          <a class="btn primary" href="?p=${esc(pid)}&view=new">+ 새 서베이</a>
        </span>` : ''}
      </div>
      <div class="grid cols2">
        ${surveys.length ? surveys.map((sv) => `
          <a class="card" href="?p=${esc(pid)}&s=${esc(sv.id)}">
            <h3>${esc(sv.title)} ${statusBadge(sv.status)}</h3>
            <p>${esc(sv.description || '')}</p>
            <p class="small muted">문항 ${(sv.questions || []).length}개 · 응답 ${sv.responseCount || 0}건</p>
          </a>`).join('')
          : `<div class="card"><p class="empty" style="padding:24px 0">아직 서베이가 없습니다.${state.isAdmin ? ' 새 서베이를 만들거나 CSV를 임포트해보세요.' : ''}</p></div>`}
      </div>`;
    core.renderModeBanner(app);
  };
  draw();
  core.onAuthChange(draw); // admin 여부에 따라 버튼 노출 갱신
}

// ---------- 뷰 1b: 새 서베이 만들기 (admin) ----------
function renderNewSurvey(pid) {
  if (state.mode === 'static') {
    app.innerHTML = `${crumbHtml(pid, ` · <a href="?p=${esc(pid)}">서베이 목록</a>`)}
      <p class="empty">서베이 생성은 Firebase 연결 후 사용 가능합니다. <a href="../../docs/FIREBASE-SETUP.md" target="_blank">연결 방법</a></p>`;
    core.renderModeBanner(app);
    return;
  }

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
      <div class="banner info" data-admin-hint style="display:${state.isAdmin ? 'none' : 'block'}">
        저장하려면 admin 계정으로 로그인해야 합니다.
      </div>
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
        await core.saveSurvey(pid, {
          id, projectId: pid, title, description: meta.description.trim(),
          status: 'draft', source: 'native', auth: 'anonymous',
          responseCount: 0, createdAt: today(), questions,
        });
        location.href = `?p=${encodeURIComponent(pid)}&s=${encodeURIComponent(id)}`;
      } catch (e) { alert(e.message); ev.target.disabled = false; }
    });
  };
  draw();
  core.onAuthChange(() => {
    const hint = app.querySelector('[data-admin-hint]');
    if (hint) hint.style.display = state.isAdmin ? 'none' : 'block';
  });
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
  if (state.mode === 'static') {
    app.innerHTML = `${crumb}
      <div class="section-head" style="margin-top:0"><h2>CSV 임포트</h2></div>
      <p class="empty">CSV 임포트는 Firebase 연결 후 사용 가능합니다.<br>
      <a href="../../docs/FIREBASE-SETUP.md" target="_blank">FIREBASE-SETUP 안내 보기</a></p>`;
    core.renderModeBanner(app);
    return;
  }

  // 위저드 상태
  const wz = { headers: [], dataRows: [], cols: [], tsIndex: -1 };

  const stepsHtml = (n) => `<div class="steps">
    ${['1 파일 선택', '2 매핑 확인', '3 실행'].map((s, i) =>
      `<span class="${i + 1 === n ? 'on' : ''}">${esc(s)}</span>`).join('')}
  </div>`;

  const headHtml = (n) => `${crumb}
    <div class="section-head" style="margin-top:0"><h2>CSV 임포트</h2></div>
    <div class="banner info" data-admin-hint style="display:${state.isAdmin ? 'none' : 'block'}">
      실제 저장(3단계)은 admin 계정으로 로그인해야 가능합니다.
    </div>
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
        await core.saveSurvey(pid, {
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
  core.onAuthChange(() => {
    const hint = app.querySelector('[data-admin-hint]');
    if (hint) hint.style.display = state.isAdmin ? 'none' : 'block';
  });
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

  let seq = 0;
  const draw = async () => {
    const my = ++seq;

    // 데이터 소스 우선순위: (a) firebase+admin 원본 → (b) 커밋된 aggregates → (c) 없음
    let agg = null, aggSource = null;
    if (state.mode === 'firebase' && state.isAdmin) {
      try {
        const responses = await core.listResponses(pid, sid);
        if (responses.length) { agg = computeAggregates(survey, responses); aggSource = 'live'; }
      } catch { /* 권한 없음 등 — 아래 fallback */ }
    }
    if (!agg && survey.aggregates) { agg = survey.aggregates; aggSource = 'committed'; }
    if (my !== seq) return; // 이후 draw가 시작됐으면 폐기

    const questions = survey.questions || [];
    const respondUrl = `${location.origin}${location.pathname}?p=${encodeURIComponent(pid)}&s=${encodeURIComponent(sid)}&mode=respond`;

    app.innerHTML = `
      ${crumbHtml(pid, ` · <a href="?p=${esc(pid)}">서베이 목록</a>`)}
      <div class="section-head" style="margin-top:0">
        <h2>${esc(survey.title)} ${statusBadge(survey.status)}</h2>
      </div>
      <p class="muted" style="margin:-8px 0 6px">${esc(survey.description || '')}</p>
      <p class="small muted">문항 ${questions.length}개 · 응답 ${agg?.responseCount ?? survey.responseCount ?? 0}건
        ${survey.source ? ` · 출처: ${esc(survey.source)}` : ''}
        ${survey.createdAt ? ` · ${esc(survey.createdAt)}` : ''}</p>
      ${state.isAdmin && state.mode === 'firebase' ? `
        <div class="card" style="margin-top:14px">
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <span class="small muted">상태</span>
            <select data-status style="width:auto">
              ${['draft', 'open', 'closed'].map((s) =>
                `<option value="${s}"${survey.status === s ? ' selected' : ''}>${esc(STATUS_LABELS[s])}</option>`).join('')}
              ${survey.status === 'imported' ? `<option value="imported" selected>${esc(STATUS_LABELS.imported)}</option>` : ''}
            </select>
            <button class="btn" data-copy-link>응답 링크 복사</button>
            ${agg ? `<button class="btn" data-download>집계 JSON 다운로드</button>` : ''}
          </div>
          <p class="small muted" style="margin-top:8px">다운로드한 JSON을 <code>data/projects/${esc(pid)}/surveys/${esc(sid)}.json</code>으로 커밋하면 정적 모드에서도 결과가 보입니다.</p>
        </div>` : ''}
      <div class="section-head"><h2>결과</h2>
        ${aggSource === 'live' ? `<span class="badge accent">원본 응답 실시간 집계</span>`
          : aggSource === 'committed' ? `<span class="badge">커밋된 집계 (${esc(agg.computedAt || '')})</span>` : ''}
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
        : `<p class="empty">응답 없음 또는 열람 권한 없음<br>
           <span class="small">원본 응답 열람은 admin 로그인 필요 · 정적 모드에서는 커밋된 집계(aggregates)만 표시됩니다</span></p>`}`;
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
    app.querySelector('[data-download]')?.addEventListener('click', () => {
      const out = { ...survey, responseCount: agg.responseCount ?? survey.responseCount, aggregates: agg };
      downloadJson(out, `${sid}.json`);
    });
  };

  draw();
  core.onAuthChange(() => draw());
}

// ---------- 뷰 4: 응답 모드 (공개 폼) ----------
async function renderRespond(pid, sid) {
  const survey = await core.getSurvey(pid, sid);
  if (!survey) {
    app.innerHTML = `<p class="empty">서베이를 찾을 수 없습니다.</p>`;
    return;
  }
  document.title = survey.title;

  if (survey.status !== 'open') {
    app.innerHTML = `
      <h2 style="margin:24px 0 8px">${esc(survey.title)}</h2>
      <p class="empty">마감된 서베이입니다. 참여해주셔서 감사합니다.</p>`;
    return;
  }

  const questions = survey.questions || [];
  app.innerHTML = `
    <h2 style="margin:24px 0 4px">${esc(survey.title)}</h2>
    ${survey.description ? `<p class="muted" style="margin-bottom:8px">${esc(survey.description)}</p>` : ''}
    <p class="small muted" style="margin-bottom:20px">익명으로 제출됩니다 · 모든 문항 필수</p>
    ${state.mode === 'static' ? `<div class="banner">지금은 읽기 전용 모드라 응답을 제출할 수 없습니다.</div>` : ''}
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
        <button type="submit" class="btn primary" ${state.mode === 'static' ? 'disabled' : ''}>제출하기</button>
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
