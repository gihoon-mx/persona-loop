// Persona Loop 공용 코어 — 인증 + 권한 + 데이터 API.
// v0.3 설계(비공개 기본):
//   - 모든 프로젝트 데이터는 Firestore에만 저장된다. repo에는 코드와 (가상의) 샘플 시드만 있다.
//   - 화면은 admin 로그인 게이트 뒤에 있다. 유일한 예외는 서베이 공개 응답 폼.
//   - admin 목록은 Firestore `admins` 컬렉션 = 웹 설정 화면에서 관리. OWNER는 규칙에 고정.
import { firebaseConfig, OWNER_EMAIL } from './firebase-config.js';

export const SITE_ROOT = new URL('../../', import.meta.url).href;
export { OWNER_EMAIL };

export const state = {
  mode: firebaseConfig ? 'firebase' : 'unconfigured',
  user: null,
  isAdmin: false,
  isOwner: false,
  ready: false,     // 인증·권한 판정 완료 여부
  degraded: false,  // Firestore 도달 실패 (네트워크·설정 문제)
};

let fb = null;
const authListeners = [];
let initPromise = null;

// Firestore SDK는 DB가 없거나 네트워크가 막히면 reject 대신 무한 재시도한다.
// 읽기 경로는 반드시 이 헬퍼로 감싸 화면이 멈추지 않게 한다.
const READ_TIMEOUT_MS = 8000;
function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Firestore 응답 없음 (${label})`)), READ_TIMEOUT_MS)),
  ]).catch((e) => {
    // 권한 거부는 "정상적인 거절"이다 (닫힌 서베이를 비로그인으로 여는 등).
    // 연결 장애로 오인해 degraded 배너를 띄우지 않는다.
    if (e && e.code === 'permission-denied') return null;
    state.degraded = true;
    console.warn('[persona-loop] Firestore 읽기 실패:', e.message);
    return null;
  });
}

// 쓰기는 서버 ack까지 기다린다 — 닿지 않으면 명시적으로 실패시킨다.
const WRITE_TIMEOUT_MS = 20000;
function writeWithTimeout(promise) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(
      () => reject(new Error('Firestore에 저장하지 못했습니다 (응답 없음). 네트워크와 Firestore 설정을 확인하세요.')),
      WRITE_TIMEOUT_MS)),
  ]);
}

export function initCore() {
  if (!initPromise) initPromise = _init();
  return initPromise;
}

async function _init() {
  if (state.mode !== 'firebase') { state.ready = true; return state; }
  const V = '10.12.2';
  const [appMod, authMod, fsMod] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(firebaseConfig);
  fb = { auth: authMod.getAuth(app), db: fsMod.getFirestore(app), authMod, fs: fsMod };

  // 첫 인증 상태 판정이 끝날 때까지 기다렸다가 resolve — 페이지가 권한을 알고 그리도록.
  await new Promise((resolve) => {
    let first = true;
    fb.authMod.onAuthStateChanged(fb.auth, async (user) => {
      state.user = user;
      const perm = await resolveAdmin(user);
      state.isAdmin = perm.isAdmin;
      state.isOwner = perm.isOwner;
      state.ready = true;
      authListeners.forEach((cb) => cb(user));
      if (first) { first = false; resolve(); }
    });
  });
  return state;
}

// 규칙(isOwner/isAdmin)과 판정 조건을 정확히 일치시킨다: 인증된 이메일 + 소문자 정규화.
async function resolveAdmin(user) {
  if (!user || !user.email || !user.emailVerified) return { isAdmin: false, isOwner: false };
  const email = user.email.toLowerCase();
  if (email === OWNER_EMAIL.toLowerCase()) return { isAdmin: true, isOwner: true };
  const snap = await withTimeout(fb.fs.getDoc(fb.fs.doc(fb.db, 'admins', email)), 'admin check');
  return { isAdmin: !!(snap && snap.exists()), isOwner: false };
}

export function onAuthChange(cb) {
  authListeners.push(cb);
  if (state.ready) cb(state.user);
}

// ---------- 인증 ----------
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
    location.reload(); // 권한 판정을 깨끗한 상태에서 다시 하도록
  } catch (e) {
    throw new Error(AUTH_ERRORS[e.code] || `로그인 실패: ${e.code || e.message}`);
  }
}

export async function signOutUser() {
  if (fb) { await fb.authMod.signOut(fb.auth); location.reload(); }
}

function requireDb() {
  if (!fb) throw new Error('Firebase 미설정 — docs/FIREBASE-SETUP.md 참고');
  return fb;
}

// ---------- 접근 게이트 ----------
/** 관리자 전용 화면 게이트. 접근 가능하면 true, 아니면 안내 화면을 그리고 false를 반환한다. */
export async function requireAdmin(container) {
  await initCore();
  if (state.mode !== 'firebase') {
    container.innerHTML = `<div class="banner">🔧 Firebase가 설정되지 않았습니다.
      <a href="${SITE_ROOT}docs/FIREBASE-SETUP.md" target="_blank">FIREBASE-SETUP</a>을 참고하세요.</div>`;
    return false;
  }
  if (state.isAdmin) return true;

  container.innerHTML = state.user
    ? `<div class="gate">
         <h2>접근 권한이 없습니다</h2>
         <p class="muted">${esc(state.user.email)} 계정은 이 워크스페이스의 허용 목록에 없습니다.<br>
           관리자에게 접근 권한 추가를 요청하세요.</p>
         <p><button class="btn" data-gate-signout>다른 계정으로 로그인</button></p>
       </div>`
    : `<div class="gate">
         <h2>Persona Loop</h2>
         <p class="muted">이 워크스페이스의 데이터는 비공개입니다.<br>허용된 Google 계정으로 로그인하세요.</p>
         <p><button class="btn primary" data-gate-signin>Google로 로그인</button></p>
       </div>`;
  container.querySelector('[data-gate-signin]')?.addEventListener('click', (ev) => {
    ev.target.disabled = true;
    signIn().catch((e) => { alert(e.message); ev.target.disabled = false; });
  });
  container.querySelector('[data-gate-signout]')?.addEventListener('click', () => signOutUser());
  return false;
}

// ---------- 관리자 allowlist ----------
export async function listAdmins() {
  const { fs, db } = requireDb();
  const snap = await withTimeout(fs.getDocs(fs.collection(db, 'admins')), 'admins');
  const rows = snap ? snap.docs.map((d) => ({ email: d.id, ...d.data() })) : [];
  rows.sort((a, b) => a.email.localeCompare(b.email));
  return rows;
}

export async function addAdmin(email) {
  const { fs, db } = requireDb();
  const clean = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) throw new Error('올바른 이메일 주소를 입력하세요.');
  if (clean === OWNER_EMAIL) throw new Error('소유자 계정은 이미 상시 관리자입니다.');
  await writeWithTimeout(fs.setDoc(fs.doc(db, 'admins', clean), {
    addedAt: fs.serverTimestamp(),
    addedBy: state.user ? state.user.email : null,
  }));
}

export async function removeAdmin(email) {
  const { fs, db } = requireDb();
  await writeWithTimeout(fs.deleteDoc(fs.doc(db, 'admins', String(email).trim().toLowerCase())));
}

// ---------- 프로젝트 ----------
export async function listProjects() {
  await initCore();
  const { fs, db } = requireDb();
  const snap = await withTimeout(
    fs.getDocs(fs.query(fs.collection(db, 'projects'), fs.orderBy('createdAt', 'desc'))), 'projects');
  return snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
}

export async function getProject(id) {
  await initCore();
  const { fs, db } = requireDb();
  const snap = await withTimeout(fs.getDoc(fs.doc(db, 'projects', id)), `project ${id}`);
  return snap && snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** href에 넣어도 안전한 http(s) URL만 통과시킨다 (javascript: 스킴 차단). */
export function safeUrl(url) {
  return /^https?:\/\//i.test(String(url || '')) ? String(url) : '';
}

export async function createProject({ id, name, description = '', demoUrl = '' }) {
  const { fs, db } = requireDb();
  if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new Error('id는 소문자·숫자·하이픈 2~40자');
  if (demoUrl && !safeUrl(demoUrl)) throw new Error('데모 URL은 http:// 또는 https://로 시작해야 합니다.');
  const ref = fs.doc(db, 'projects', id);
  const existing = await withTimeout(fs.getDoc(ref), `project ${id}`);
  if (existing && existing.exists()) throw new Error(`프로젝트 id '${id}'가 이미 존재합니다`);
  await writeWithTimeout(fs.setDoc(ref, {
    name, description, demoUrl, status: 'active', createdAt: fs.serverTimestamp(),
  }));
}

// ---------- 서베이 ----------
export async function listSurveys(projectId) {
  await initCore();
  const { fs, db } = requireDb();
  const snap = await withTimeout(
    fs.getDocs(fs.collection(db, 'projects', projectId, 'surveys')), `surveys ${projectId}`);
  return snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
}

/** 서베이 1건 (정의 + 집계). admin 전용 — 응답자용 공개 폼은 getPublicForm()을 쓴다. */
export async function getSurvey(projectId, surveyId) {
  await initCore();
  const { fs, db } = requireDb();
  const snap = await withTimeout(
    fs.getDoc(fs.doc(db, 'projects', projectId, 'surveys', surveyId)), `survey ${surveyId}`);
  return snap && snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** 새 서베이 생성 — 같은 id가 있으면 거부한다 (saveSurvey는 merge라 조용히 덮어쓰므로). */
export async function createSurvey(projectId, survey) {
  if (!/^[a-z0-9-]{2,40}$/.test(survey.id || '')) throw new Error('id는 소문자·숫자·하이픈 2~40자');
  if (await getSurvey(projectId, survey.id)) {
    throw new Error(`서베이 id '${survey.id}'가 이미 존재합니다. 다른 id를 사용하세요.`);
  }
  await saveSurvey(projectId, survey);
}

export async function saveSurvey(projectId, survey) {
  const { fs, db } = requireDb();
  const { id, ...data } = survey;
  await writeWithTimeout(fs.setDoc(fs.doc(db, 'projects', projectId, 'surveys', id), data, { merge: true }));
  await syncPublicForm(projectId, id);
}

/** 공개 응답 폼 문서를 서베이와 동기화한다.
 *  status가 'open'이면 폼을 그리는 데 필요한 필드만 복사하고, 아니면 공개 문서를 삭제한다.
 *  집계·응답수·응답 원본은 절대 복사하지 않는다 — 이 문서는 비로그인 사용자가 읽을 수 있다. */
async function syncPublicForm(projectId, surveyId) {
  const { fs, db } = requireDb();
  const ref = fs.doc(db, 'projects', projectId, 'public-forms', surveyId);
  const survey = await getSurvey(projectId, surveyId);
  if (!survey || survey.status !== 'open') {
    await writeWithTimeout(fs.deleteDoc(ref)).catch(() => {}); // 없으면 무시
    return;
  }
  await writeWithTimeout(fs.setDoc(ref, {
    title: survey.title || '',
    description: survey.description || '',
    questions: survey.questions || [],
    status: 'open',
    updatedAt: fs.serverTimestamp(),
  }));
}

/** 공개 응답 폼 읽기 — 비로그인 응답자가 쓰는 유일한 읽기 경로. */
export async function getPublicForm(projectId, surveyId) {
  await initCore();
  const { fs, db } = requireDb();
  const snap = await withTimeout(
    fs.getDoc(fs.doc(db, 'projects', projectId, 'public-forms', surveyId)), `form ${surveyId}`);
  return snap && snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

/** 응답 수를 서버에서 집계 (문서를 내려받지 않음). 실패 시 null. */
export async function countResponses(projectId, surveyId) {
  const { fs, db } = requireDb();
  if (!fs.getCountFromServer) return null;
  const snap = await withTimeout(
    fs.getCountFromServer(fs.collection(db, 'projects', projectId, 'surveys', surveyId, 'responses')),
    `count ${surveyId}`);
  return snap ? snap.data().count : null;
}

/** 응답 폼 제출 (익명 — rules의 isValidResponse()가 이 형태를 그대로 강제한다).
 *  필드 구성을 바꾸면 firestore.rules의 isValidResponse()도 함께 고칠 것. */
export async function submitResponse(projectId, surveyId, answers) {
  const { fs, db } = requireDb();
  await writeWithTimeout(
    fs.addDoc(fs.collection(db, 'projects', projectId, 'surveys', surveyId, 'responses'), {
      answers, submittedAt: fs.serverTimestamp(), source: 'live', respondent: null,
    }));
}

/** CSV 임포트 등 대량 쓰기 (admin). rows: [{answers:{qid:value}, submittedAt?}]
 *  responseCount는 여기서 increment로 갱신한다 — 호출부는 saveSurvey에 responseCount를 넣지 말 것. */
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

/** 응답 열람 (admin 전용). 실패 시 빈 배열. */
export async function listResponses(projectId, surveyId) {
  const { fs, db } = requireDb();
  const snap = await withTimeout(
    fs.getDocs(fs.collection(db, 'projects', projectId, 'surveys', surveyId, 'responses')),
    `responses ${surveyId}`);
  return snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
}

// ---------- 산출물 (페르소나 · 리뷰 · 세션) ----------
const ARTIFACT_KINDS = ['personas', 'reviews', 'sessions'];

/** kind: 'personas' | 'reviews' | 'sessions' */
export async function listArtifacts(projectId, kind) {
  await initCore();
  if (!ARTIFACT_KINDS.includes(kind)) throw new Error(`알 수 없는 kind: ${kind}`);
  const { fs, db } = requireDb();
  const snap = await withTimeout(
    fs.getDocs(fs.collection(db, 'projects', projectId, kind)), `${kind} ${projectId}`);
  return snap ? snap.docs.map((d) => ({ id: d.id, ...d.data() })) : [];
}

export async function saveArtifact(projectId, kind, artifact) {
  if (!ARTIFACT_KINDS.includes(kind)) throw new Error(`알 수 없는 kind: ${kind}`);
  const { fs, db } = requireDb();
  const { id, ...data } = artifact;
  await writeWithTimeout(fs.setDoc(fs.doc(db, 'projects', projectId, kind, id), data, { merge: true }));
}

// ---------- 샘플 시드 ----------
/** repo의 가상 샘플 데이터(data/seed/sample/)를 Firestore에 적재한다. admin 전용. */
export async function seedSampleProject() {
  const { fs, db } = requireDb();
  const manifest = await fetchStaticJson('data/seed/sample/manifest.json');
  if (!manifest) throw new Error('샘플 시드 파일을 찾을 수 없습니다.');
  const pid = manifest.project.id;

  const { id: _pid, ...projectData } = manifest.project;
  await writeWithTimeout(fs.setDoc(fs.doc(db, 'projects', pid), {
    ...projectData, createdAt: fs.serverTimestamp(), isSample: true,
  }));

  for (const [kind, files] of Object.entries(manifest.collections)) {
    for (const file of files) {
      const doc = await fetchStaticJson(`data/seed/sample/${kind}/${file}`);
      if (!doc) continue;
      const { id, ...data } = doc;
      await writeWithTimeout(fs.setDoc(fs.doc(db, 'projects', pid, kind, id), data));
    }
  }
  return pid;
}

async function fetchStaticJson(relPath) {
  try {
    const res = await fetch(new URL(relPath, SITE_ROOT));
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
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
        u
          ? `${u.photoURL ? `<img class="avatar" src="${esc(u.photoURL)}" alt="">` : ''}
             <span>${esc(u.email)}${state.isOwner ? ' <span class="badge accent">owner</span>'
               : state.isAdmin ? ' <span class="badge accent">admin</span>' : ''}</span>
             ${state.isOwner ? `<a class="btn" href="${rootHref}?view=settings">설정</a>` : ''}
             <button class="btn" data-signout>로그아웃</button>`
          : `<button class="btn primary" data-signin>Google 로그인</button>`
      }</div>`;
    el.querySelector('[data-signin]')?.addEventListener('click', (ev) => {
      ev.target.disabled = true;
      signIn().catch((e) => { alert(e.message); ev.target.disabled = false; });
    });
    el.querySelector('[data-signout]')?.addEventListener('click', () => signOutUser());
  };
  onAuthChange(render);
  render();
}

/** Firestore 도달 실패 시에만 경고 배너를 삽입한다. */
export function renderModeBanner(container) {
  if (!container) return;
  let html = null;
  if (state.mode !== 'firebase') {
    html = `🔧 Firebase가 설정되지 않았습니다.
      <a href="${SITE_ROOT}docs/FIREBASE-SETUP.md" target="_blank">FIREBASE-SETUP</a> 참고`;
  } else if (state.degraded) {
    html = `⚠️ Firestore에 연결하지 못했습니다. 네트워크 상태와
      <a href="${SITE_ROOT}docs/FIREBASE-SETUP.md" target="_blank">Firestore 설정</a>을 확인하세요.`;
  }
  if (!html) return;
  const div = document.createElement('div');
  div.className = 'banner';
  div.innerHTML = html;
  container.prepend(div);
}
