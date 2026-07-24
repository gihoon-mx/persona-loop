// Persona Loop 공용 코어 — 인증 + 데이터 API. 모든 페이지는 이 모듈만 통해 데이터에 접근한다.
// 두 모드로 동작:
//  - firebase: firebase-config.js에 config가 있으면 Firestore/Auth 사용 (읽기+쓰기)
//  - static:   config가 null이면 repo에 커밋된 JSON만 읽는 읽기 전용 모드 (배포 데모/미설정 상태)
import { firebaseConfig, adminEmails } from './firebase-config.js';

export const SITE_ROOT = new URL('../../', import.meta.url).href;
export const state = {
  mode: firebaseConfig ? 'firebase' : 'static',
  user: null,
  isAdmin: false,
  // Firestore가 응답하지 않을 때(DB 미생성·오프라인·권한) true로 바뀌고 정적 데이터로 계속 동작한다.
  degraded: false,
};

// Firestore SDK는 DB가 없거나 네트워크가 막히면 reject 대신 무한 재시도한다.
// 읽기 경로는 반드시 이 헬퍼로 감싸 화면이 멈추지 않게 한다.
const READ_TIMEOUT_MS = 6000;
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Firestore 응답 없음 (${label})`)), READ_TIMEOUT_MS)),
  ]).catch((e) => {
    state.degraded = true;
    console.warn('[persona-loop] Firestore 읽기 실패 → 정적 데이터로 대체:', e.message);
    return null; // 호출부가 정적 폴백을 쓰도록
  });
}

let fb = null; // { auth, db, fns } — firebase 모드에서만 채워짐
const authListeners = [];
let initPromise = null;

export function initCore() {
  if (!initPromise) initPromise = _init();
  return initPromise;
}

async function _init() {
  if (state.mode !== 'firebase') return state;
  const V = '10.12.2';
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  fb = { auth: authMod.getAuth(app), db: fsMod.getFirestore(app), authMod, fs: fsMod };
  fb.authMod.onAuthStateChanged(fb.auth, (user) => {
    state.user = user;
    state.isAdmin = !!user && adminEmails.includes(user.email);
    authListeners.forEach((cb) => cb(user));
  });
  return state;
}

export function onAuthChange(cb) {
  authListeners.push(cb);
  if (state.mode === 'static') cb(null); // static 모드는 즉시 비로그인 확정
}

const AUTH_ERRORS = {
  'auth/unauthorized-domain': `이 도메인(${location.hostname})이 Firebase 승인된 도메인에 없습니다.\n`
    + 'Firebase 콘솔 > Authentication > Settings > 승인된 도메인에 추가하세요.',
  'auth/operation-not-allowed': 'Google 로그인이 활성화되지 않았습니다.\n'
    + 'Firebase 콘솔 > Authentication > Sign-in method에서 Google을 사용 설정하세요.',
  'auth/popup-blocked': '브라우저가 로그인 팝업을 차단했습니다. 팝업을 허용한 뒤 다시 시도하세요.',
  'auth/popup-closed-by-user': '로그인 창이 닫혔습니다.',
};

export async function signIn() {
  await initCore();
  if (!fb) throw new Error('Firebase 미설정 — docs/FIREBASE-SETUP.md 참고');
  const provider = new fb.authMod.GoogleAuthProvider();
  try {
    await fb.authMod.signInWithPopup(fb.auth, provider);
  } catch (e) {
    throw new Error(AUTH_ERRORS[e.code] || `로그인 실패: ${e.code || e.message}`);
  }
}

export async function signOutUser() {
  if (fb) await fb.authMod.signOut(fb.auth);
}

function requireDb() {
  if (!fb) throw new Error('쓰기는 Firebase 연결 후에 가능합니다 (현재 읽기 전용 모드)');
  return fb;
}

// ---------- 정적 JSON (repo 커밋 데이터 — 페르소나/리뷰/세션은 항상 여기서 읽음) ----------
export async function fetchStaticJson(relPath) {
  try {
    const res = await fetch(new URL(relPath, SITE_ROOT));
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** kind: 'personas' | 'reviews' | 'sessions' — index.json 매니페스트({files:[...]}) 기반 */
export async function listArtifacts(projectId, kind) {
  const idx = await fetchStaticJson(`data/projects/${projectId}/${kind}/index.json`);
  if (!idx || !Array.isArray(idx.files)) return [];
  const items = await Promise.all(
    idx.files.map((f) => fetchStaticJson(`data/projects/${projectId}/${kind}/${f}`)),
  );
  return items.filter(Boolean);
}

// ---------- 프로젝트 ----------
// firebase 모드에서도 repo에 커밋된 정적 데이터(sample 등)는 계속 보여야 한다:
// 목록은 Firestore + 정적 병합(같은 id는 Firestore 우선), 단건은 Firestore 미스 시 정적 폴백.
async function listStaticProjects() {
  const idx = await fetchStaticJson('data/projects/index.json');
  if (!idx) return [];
  const items = await Promise.all(
    idx.projects.map((id) => fetchStaticJson(`data/projects/${id}/project.json`)),
  );
  return items.filter(Boolean);
}

export async function listProjects() {
  await initCore();
  if (!fb) return listStaticProjects();
  const { fs, db } = fb;
  const [snap, staticItems] = await Promise.all([
    withTimeout(fs.getDocs(fs.query(fs.collection(db, 'projects'), fs.orderBy('createdAt', 'desc'))), 'projects'),
    listStaticProjects(),
  ]);
  if (!snap) return staticItems;
  const live = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const liveIds = new Set(live.map((p) => p.id));
  return [...live, ...staticItems.filter((p) => !liveIds.has(p.id))];
}

export async function getProject(id) {
  await initCore();
  const staticPath = `data/projects/${id}/project.json`;
  if (!fb) return fetchStaticJson(staticPath);
  const { fs, db } = fb;
  const snap = await withTimeout(fs.getDoc(fs.doc(db, 'projects', id)), `project ${id}`);
  return snap?.exists() ? { id: snap.id, ...snap.data() } : fetchStaticJson(staticPath);
}

export async function createProject({ id, name, description = '', demoUrl = '' }) {
  const { fs, db } = requireDb();
  if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new Error('id는 소문자·숫자·하이픈 2~40자');
  const ref = fs.doc(db, 'projects', id);
  const existing = await withTimeout(fs.getDoc(ref), `project ${id}`);
  if (existing?.exists() || (await fetchStaticJson(`data/projects/${id}/project.json`))) {
    throw new Error(`프로젝트 id '${id}'가 이미 존재합니다`);
  }
  await writeWithTimeout(
    fs.setDoc(ref, { name, description, demoUrl, status: 'active', createdAt: fs.serverTimestamp() }));
}

// ---------- 서베이 ----------
async function listStaticSurveys(projectId) {
  const idx = await fetchStaticJson(`data/projects/${projectId}/surveys/index.json`);
  if (!idx || !Array.isArray(idx.files)) return [];
  const items = await Promise.all(
    idx.files.map((f) => fetchStaticJson(`data/projects/${projectId}/surveys/${f}`)),
  );
  return items.filter(Boolean);
}

export async function listSurveys(projectId) {
  await initCore();
  if (!fb) return listStaticSurveys(projectId);
  const { fs, db } = fb;
  const [snap, staticItems] = await Promise.all([
    withTimeout(fs.getDocs(fs.collection(db, 'projects', projectId, 'surveys')), `surveys ${projectId}`),
    listStaticSurveys(projectId),
  ]);
  if (!snap) return staticItems;
  const live = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const liveIds = new Set(live.map((s) => s.id));
  return [...live, ...staticItems.filter((s) => !liveIds.has(s.id))];
}

export async function getSurvey(projectId, surveyId) {
  await initCore();
  const staticPath = `data/projects/${projectId}/surveys/${surveyId}.json`;
  if (!fb) return fetchStaticJson(staticPath);
  const { fs, db } = fb;
  const snap = await withTimeout(
    fs.getDoc(fs.doc(db, 'projects', projectId, 'surveys', surveyId)), `survey ${surveyId}`);
  return snap?.exists() ? { id: snap.id, ...snap.data() } : fetchStaticJson(staticPath);
}

// 쓰기는 서버 ack까지 기다린다 — Firestore가 닿지 않으면 무한 대기하므로 명시적으로 실패시킨다.
const WRITE_TIMEOUT_MS = 20000;
function writeWithTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('Firestore에 저장하지 못했습니다 (응답 없음). 네트워크와 Firestore 설정을 확인하세요.')),
      WRITE_TIMEOUT_MS)),
  ]);
}

export async function saveSurvey(projectId, survey) {
  const { fs, db } = requireDb();
  const { id, ...data } = survey;
  await writeWithTimeout(fs.setDoc(fs.doc(db, 'projects', projectId, 'surveys', id), data, { merge: true }));
}

/** 응답 폼 제출 (익명 허용 — rules에서 survey.status=='open'일 때만 허용) */
export async function submitResponse(projectId, surveyId, answers) {
  const { fs, db } = requireDb();
  await writeWithTimeout(
    fs.addDoc(fs.collection(db, 'projects', projectId, 'surveys', surveyId, 'responses'), {
      answers, submittedAt: fs.serverTimestamp(), source: 'live',
      respondent: state.user ? state.user.uid : null,
    }));
}

/** CSV 임포트 등 대량 쓰기 (admin). rows: [{answers:{qid:value}, submittedAt?}]
 *  responseCount는 여기서 increment로 갱신한다 — 호출부는 saveSurvey에 responseCount를 넣지 말 것 (이중 카운트). */
export async function importResponses(projectId, surveyId, rows) {
  const { fs, db } = requireDb();
  const col = fs.collection(db, 'projects', projectId, 'surveys', surveyId, 'responses');
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const batch = fs.writeBatch(db);
    rows.slice(i, i + CHUNK).forEach((row) => {
      batch.set(fs.doc(col), {
        answers: row.answers,
        submittedAt: row.submittedAt || null,
        source: 'import',
        respondent: null,
      });
    });
    await writeWithTimeout(batch.commit());
  }
  await writeWithTimeout(fs.setDoc(fs.doc(db, 'projects', projectId, 'surveys', surveyId),
    { responseCount: fs.increment(rows.length) }, { merge: true }));
}

/** 응답 열람 (rules상 admin만 가능). 실패·타임아웃 시 빈 배열 — 호출부는 커밋된 집계로 폴백한다. */
export async function listResponses(projectId, surveyId) {
  const { fs, db } = requireDb();
  const snap = await withTimeout(
    fs.getDocs(fs.collection(db, 'projects', projectId, 'surveys', surveyId, 'responses')),
    `responses ${surveyId}`);
  return snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
}

// ---------- UI 헬퍼 ----------
export function qsParam(name) {
  return new URLSearchParams(location.search).get(name);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** 모든 페이지 공통 상단바. <header class="topbar"></header>에 렌더 */
export function renderTopbar(rootHref = SITE_ROOT) {
  const el = document.querySelector('header.topbar');
  if (!el) return;
  const render = () => {
    const u = state.user;
    el.innerHTML = `
      <a class="logo" href="${rootHref}">Persona <span>Loop</span></a>
      <div class="auth">${
        state.mode === 'static'
          ? `<span class="badge">읽기 전용</span>`
          : u
            ? `${u.photoURL ? `<img class="avatar" src="${esc(u.photoURL)}" alt="">` : ''}
               <span>${esc(u.email)}${state.isAdmin ? ' <span class="badge accent">admin</span>' : ''}</span>
               <button class="btn" data-signout>로그아웃</button>`
            : `<button class="btn primary" data-signin>Google 로그인</button>`
      }</div>`;
    el.querySelector('[data-signin]')?.addEventListener('click', () => signIn().catch((e) => alert(e.message)));
    el.querySelector('[data-signout]')?.addEventListener('click', () => signOutUser());
  };
  onAuthChange(render);
  render();
}

/** 읽기 전용(static) 또는 Firestore 장애(degraded) 상태를 컨테이너 맨 위에 안내 */
export function renderModeBanner(container) {
  if (!container) return;
  let html = null;
  if (state.mode === 'static') {
    html = `🔧 Firebase가 아직 연결되지 않아 <b>읽기 전용 모드</b>로 동작 중입니다 (repo에 커밋된 데이터만 표시).
      연결 방법: <a href="${SITE_ROOT}docs/FIREBASE-SETUP.md" target="_blank">FIREBASE-SETUP</a>`;
  } else if (state.degraded) {
    html = `⚠️ Firestore에 연결하지 못해 <b>repo에 커밋된 데이터만</b> 표시하고 있습니다.
      Firestore 데이터베이스 생성과 보안 규칙 게시가 끝났는지 확인하세요:
      <a href="${SITE_ROOT}docs/FIREBASE-SETUP.md" target="_blank">FIREBASE-SETUP 4단계</a>`;
  }
  if (!html) return;
  const div = document.createElement('div');
  div.className = 'banner';
  div.innerHTML = html;
  container.prepend(div);
}
