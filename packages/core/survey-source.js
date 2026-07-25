// now-here-survey(Supabase) 연동 — **읽기 전용** 클라이언트.
//
// 왜 읽기 전용인가: now-here-survey는 이미 현장에서 운영 중인 서비스다.
// Persona Loop는 그 응답을 페르소나의 재료로 가져다 쓸 뿐, 원본에는 절대 쓰지 않는다.
// 그래서 이 파일은 GET만 보낸다 (예외: 로그인 토큰 발급 POST 하나).
//
// 인증: Supabase RLS가 anon 역할에 아무 권한도 주지 않으므로, 설문 관리자 계정으로
// 로그인해야 읽을 수 있다. 로그인은 사용자가 직접 이 앱의 폼에 입력한다.
// 토큰은 sessionStorage에만 둔다 — 탭을 닫으면 사라진다(공유 PC 고려).

export const SURVEY_SOURCE = {
  name: 'now-here-survey',
  url: 'https://bpydykgjxawdjkozwvqm.supabase.co',
  // publishable(anon) 키 — 브라우저 노출을 전제로 설계된 공개 값.
  // 실제 접근 통제는 Postgres RLS가 담당한다 (now-here-survey/supabase/schema.sql).
  key: 'sb_publishable_zkxDbD6p_aZ198fN3sECTg_Oks8TvP8',
  adminUrl: 'https://gihoon-mx.github.io/now-here-survey/',
  repoUrl: 'https://github.com/gihoon-mx/now-here-survey',
};

const TOKEN_KEY = 'pl.surveySource.session';

export const sourceState = { email: null, connected: false };

function loadSession() {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveSession(s) {
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify(s)); } catch { /* 무시 */ }
  sourceState.email = s?.email || null;
  sourceState.connected = !!s?.access_token;
}

export function initSurveySource() {
  const s = loadSession();
  sourceState.email = s?.email || null;
  sourceState.connected = !!s?.access_token;
  return sourceState;
}

export function disconnectSource() {
  try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* 무시 */ }
  sourceState.email = null;
  sourceState.connected = false;
}

/** 설문 관리자 계정으로 로그인 (사용자가 직접 입력한 자격증명). */
export async function connectSource(email, password) {
  const res = await fetch(`${SURVEY_SOURCE.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: SURVEY_SOURCE.key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: String(email || '').trim(), password: String(password || '') }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || '로그인에 실패했습니다. 이메일과 비밀번호를 확인하세요.');
  }
  saveSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    email: data.user?.email || email,
  });
  if (!sourceState.connected) {
    throw new Error('이 브라우저에서 세션 저장(sessionStorage)이 차단되어 있어 연결할 수 없습니다.');
  }
  // 관리자 권한이 없으면 데이터가 하나도 안 보이므로 미리 확인한다.
  let admin;
  try {
    admin = await isSourceAdmin();
  } catch (e) {
    disconnectSource();
    throw new Error(`관리자 권한을 확인하지 못했습니다: ${e.message}`);
  }
  if (!admin) {
    disconnectSource();
    throw new Error('이 계정은 설문 시스템의 관리자가 아닙니다 (admins 테이블에 없음).');
  }
  return sourceState;
}

// 동시에 여러 요청이 401을 받으면 refresh_token을 각자 써버려 서로를 무효화한다.
// 진행 중인 갱신 하나를 공유한다.
let refreshing = null;
function refresh() {
  if (!refreshing) {
    refreshing = (async () => {
      const s = loadSession();
      if (!s?.refresh_token) return false;
      const res = await fetch(`${SURVEY_SOURCE.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: { apikey: SURVEY_SOURCE.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: s.refresh_token }),
      });
      if (!res.ok) { disconnectSource(); return false; }
      const data = await res.json();
      saveSession({ access_token: data.access_token, refresh_token: data.refresh_token, email: s.email });
      return true;
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** PostgREST GET 한 페이지. 이 모듈에서 데이터에 닿는 유일한 경로다 (쓰기 없음). */
async function getPage(path, { from = 0, to = null, retry = true } = {}) {
  const s = loadSession();
  if (!s?.access_token) throw new Error('설문 시스템에 연결되어 있지 않습니다.');
  const headers = {
    apikey: SURVEY_SOURCE.key,
    Authorization: `Bearer ${s.access_token}`,
    Accept: 'application/json',
  };
  if (to != null) { headers['Range-Unit'] = 'items'; headers.Range = `${from}-${to}`; }
  const res = await fetch(`${SURVEY_SOURCE.url}/rest/v1/${path}`, { headers });
  if (res.status === 401 && retry && (await refresh())) {
    return getPage(path, { from, to, retry: false });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 401 && /Invalid API key/i.test(body)) {
      throw new Error('설문 시스템 API 키가 올바르지 않습니다 (survey-source.js의 key 확인 필요).');
    }
    throw new Error(`설문 데이터를 읽지 못했습니다 (${res.status}). ${body.slice(0, 160)}`);
  }
  return { rows: await res.json(), contentRange: res.headers.get('Content-Range') };
}

/**
 * 전량 조회. PostgREST는 한 번에 최대 1000행만 돌려주고 **초과분은 오류 없이 잘린다**.
 * 원본 앱도 같은 이유로 fetchAllRows()를 쓴다 (now-here-survey/src/lib/supabase.ts).
 * 40문항 × 35명이면 응답이 1400행이라 이 처리가 없으면 조용히 절반만 가져온다.
 */
const PAGE = 1000;
async function getAll(path) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { rows } = await getPage(path, { from, to: from + PAGE - 1 });
    out.push(...rows);
    if (rows.length < PAGE) return out;
    if (out.length > 200000) throw new Error('응답이 너무 많습니다. 관리자에게 문의하세요.');
  }
}

const get = async (path) => (await getPage(path)).rows;

/** 관리자 여부. 확인 자체가 실패한 경우와 '관리자가 아님'을 구분해야 하므로 예외를 삼키지 않는다. */
export async function isSourceAdmin() {
  const rows = await get('admins?select=user_id&limit=1');
  return Array.isArray(rows) && rows.length > 0; // RLS: 본인 행만 보인다
}

// ---------- 조회 ----------
export const listSourceSurveys = () =>
  get('surveys?select=id,title,created_at&order=created_at.desc');

export const listSourceSessions = (surveyId) =>
  get(`sessions?survey_id=eq.${surveyId}&select=id,name,status,started_at,ended_at,created_at&order=created_at`);

export async function getSourceStructure(surveyId) {
  const [pages, slides] = await Promise.all([
    get(`pages?survey_id=eq.${surveyId}&select=id,order_index,title&order=order_index`),
    get(`slides?survey_id=eq.${surveyId}&select=id,page_id,order_index,type,title,body,options,multi,required,comment_enabled&order=order_index`),
  ]);
  return { pages, slides };
}

/**
 * 참가자 — **id만** 가져온다.
 * 실명(display_name)·로그인 아이디는 Persona Loop에 필요 없고, 가져오지 않는 것이
 * 익명화의 실질이다. 특히 실명순으로 정렬해 P1·P2를 매기면 그 라벨이 곧 실명
 * 가나다순 순위가 되어 원본 명단만 있으면 되돌릴 수 있다 — id 정렬을 쓴다.
 */
export const listSourceParticipants = (sessionId) =>
  getAll(`participants?session_id=eq.${sessionId}&select=id&order=id`);

export const listSourceResponses = (sessionId) =>
  getAll(`responses?session_id=eq.${sessionId}&select=slide_id,participant_id,answer,comment,answered_at&order=participant_id,slide_id`);

// ---------- 변환: now-here-survey → Persona Loop 스키마 ----------

/** 문항 순서를 페이지 순서 → 페이지 내 순서로 편다. */
function orderSlides(pages, slides) {
  const order = new Map(pages.map((p) => [p.id, p.order_index]));
  return [...slides].sort(
    (a, b) => (order.get(a.page_id) ?? 0) - (order.get(b.page_id) ?? 0) || a.order_index - b.order_index,
  );
}

/** 선택지는 문자열 또는 {label, description} 두 형식이 섞여 있을 수 있다. */
function optionLabels(options) {
  if (!Array.isArray(options)) return [];
  return options.map((o) => (typeof o === 'string' ? o : (o?.label ?? ''))).filter(Boolean);
}

function answerToValue(answer) {
  if (!answer) return null;
  if (answer.text != null) return answer.text;
  if (Array.isArray(answer.choices)) return answer.choices;
  if (answer.choice != null) return answer.choice;
  return null;
}

/**
 * 회차(session) 하나를 Persona Loop의 서베이 정의 + 응답 배열로 변환한다.
 * - `info`(안내 페이지)는 문항이 아니므로 제외한다.
 * - 항목별 자유 의견(comment)은 페르소나의 핵심 재료라, 의견이 하나라도 있으면
 *   `<qid>-c` 라는 주관식 문항을 따로 만들어 담는다.
 * - 참가자는 이름을 가져오지 않고 P1, P2 … 로 익명화한다 (개인정보 최소 수집).
 */
export function convertSession({ survey, session, pages, slides, participants, responses }) {
  // 안내(info) 페이지도 순서에 포함한다 — 원본은 안내 페이지에도 의견을 남길 수 있고,
  // 그 의견이야말로 페르소나의 재료다. 다만 '문항'으로는 만들지 않는다.
  const all = orderSlides(pages, slides);
  const qid = new Map(); // slide.id → 문항 id 접두사
  const questions = [];

  all.forEach((slide, i) => {
    const id = `q${i + 1}`;
    qid.set(slide.id, id);
    if (slide.type === 'info') return; // 응답이 없는 안내 페이지
    const options = optionLabels(slide.options);
    const type = slide.type === 'text' ? 'open'
      : slide.type === 'ox' ? 'single'
      : slide.multi ? 'multi' : 'single';
    const q = { id, type, text: slide.title };
    if (slide.body) q.description = slide.body;
    if (type !== 'open') q.options = options.length ? options : (slide.type === 'ox' ? ['O', 'X'] : []);
    questions.push(q);
  });

  // 의견이 실제로 달린 항목만 주관식 문항을 추가로 만든다 (안내 페이지 포함).
  const withComment = new Set(responses.filter((r) => r.comment && r.comment.trim()).map((r) => r.slide_id));
  all.forEach((slide) => {
    if (!withComment.has(slide.id)) return;
    const base = qid.get(slide.id);
    const label = slide.type === 'info' ? `[의견·안내] ${slide.title}` : `[의견] ${slide.title}`;
    questions.push({ id: `${base}-c`, type: 'open', text: label });
  });

  // 참가자 익명화 — id만 가져왔으므로 실명과의 연결고리가 애초에 없다.
  const anon = new Map(participants.map((p, i) => [p.id, `P${i + 1}`]));
  const byParticipant = new Map();
  for (const r of responses) {
    const base = qid.get(r.slide_id);
    if (!base) continue; // 이 회차의 설문에 속하지 않는 항목
    const key = r.participant_id;
    if (!byParticipant.has(key)) byParticipant.set(key, { answers: {}, submittedAt: null });
    const row = byParticipant.get(key);
    const value = answerToValue(r.answer);
    if (value != null && value !== '') row.answers[base] = value;
    if (r.comment && r.comment.trim()) row.answers[`${base}-c`] = r.comment.trim();
    if (r.answered_at && (!row.submittedAt || r.answered_at < row.submittedAt)) row.submittedAt = r.answered_at;
  }

  const rows = [...byParticipant.entries()]
    .filter(([, row]) => Object.keys(row.answers).length > 0)
    .map(([pid, row]) => ({ ...row, respondentLabel: anon.get(pid) || null }));

  return {
    definition: {
      title: `${survey.title} — ${session.name || '회차'}`,
      description: `now-here-survey에서 연동된 설문입니다 (회차: ${session.name || '-'}).`,
      status: 'imported',
      source: 'now-here-survey',
      externalRef: { surveyId: survey.id, sessionId: session.id, syncedAt: new Date().toISOString() },
      questions,
    },
    responses: rows,
  };
}
