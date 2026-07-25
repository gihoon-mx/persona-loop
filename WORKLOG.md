# WORKLOG

멀티 세션 작업의 단일 상태 소스. 세션 시작 시 먼저 읽고, 작업 후 갱신해 커밋에 포함할 것.

## 2026-07-25 — v0.4.0: now-here-survey 연동 (M10)

이미 현장에서 운영 중인 설문 서비스 [now-here-survey](https://gihoon-mx.github.io/now-here-survey/)(Supabase)의 응답을 페르소나의 재료로 가져온다. Persona Loop는 설문을 새로 만들지 않는다 — 설문 설계·현장 진행은 원본이, 페르소나 차원 태깅·페르소나 생성·리뷰는 Persona Loop가 맡는다.

- **철저히 읽기 전용**: `packages/core/survey-source.js`에서 데이터에 닿는 경로는 GET만 보내는 `get()` 하나뿐. POST는 인증 토큰 발급·갱신 두 곳뿐이고 PATCH·DELETE·RPC·Realtime 구독은 없다. **원본의 데이터도 진행 상태도 바뀌지 않는다** (운영 중인 서비스이므로 협상 대상이 아님)
- **인증**: 원본 RLS가 전부 `to authenticated`라 anon 키만으로는 아무것도 안 읽힌다 → 설문 관리자 계정 로그인 필수. `connectSource()`가 로그인 직후 관리자 여부를 확인하고 아니면 즉시 끊는다. 토큰은 `sessionStorage`에만 (탭 닫으면 소멸 — 현장 공유 PC 고려)
- **구조 변환**(`convertSession()`): 페이지 순서 → 페이지 내 순서로 문항을 펴서 `q1`,`q2`… 재부여. `choice`→`single`/`multi`, `ox`→`single`(O·X), `text`→`open`, `info`는 제외. 문항별 자유 의견(`comment`)은 페르소나의 핵심 재료라 `<qid>-c` 주관식 문항으로 따로 담는다(의견이 달린 문항만)
- **익명화**: 참가자 실명·표시 이름·로그인 아이디·passcode는 가져오지 않는다. 회차 안에서만 유효한 `P1`, `P2` … 라벨만 저장(`respondentLabel`)
- **재동기화**: `importResponses(..., {source:'now-here-survey', replace:true})` — 같은 출처 응답을 지우고 다시 넣어 중복 누적 방지. 다른 출처(`live`·`import`)는 건드리지 않음. `responseCount`는 덮어쓰기로 갱신
- **personaDimension 태깅**: 연동 직후 각 문항에 페르소나 차원을 지정하는 것이 필수 단계 — 이 태깅이 페르소나 생성의 근거 연결 기준이 된다
- 스키마: `source`에 `now-here-survey` 추가, `externalRef{surveyId,sessionId,syncedAt}` 신설(재동기화 대상 식별)
- 문서: [docs/SURVEY-INTEGRATION.md](docs/SURVEY-INTEGRATION.md) 신규, ARCHITECTURE.md §8 + 구성 다이어그램, MODULES.md M10, CLAUDE.md 보안 원칙

### 다음 할 일
- [ ] **사용자**: 실제 연동 테스트 — 설문 관리자 계정으로 로그인 → 설문·회차 선택 → 회차 동기화 → 문항에 `personaDimension` 태깅까지 한 번 끝까지 돌려보기 (종료된 회차로 먼저 시도할 것)
- [ ] **사용자**: 연동 전에 원본의 자유 의견 본문에 실명·소속 같은 개인정보가 섞여 있지 않은지 확인 (발견 시 원본에서 수정 후 재동기화)

## 2026-07-25 — v0.3.0: 비공개 기본 (private by default)
- **전 화면 로그인 게이트**: 모든 앱이 `core.requireAdmin(container)`를 통과해야 렌더된다. 비로그인 → 로그인 안내, allowlist 밖 → "접근 권한이 없습니다". 유일한 예외는 공개 응답 폼
- **Firestore 단일 저장소로 이전**: `data/projects/` 삭제, 정적 JSON 폴백 경로 제거. repo에 남는 데이터는 가상 시드 `data/seed/sample/` 뿐 (설정 화면의 "샘플 데이터 불러오기"로 Firestore에 적재)
- **관리자 웹 관리**: 설정 화면에서 Firestore `admins` 컬렉션에 관리자 추가·삭제 (코드 수정·재배포 불필요). OWNER는 `firestore.rules`에 하드코딩 — allowlist가 비어도 잠기지 않고, 추가·삭제 권한은 OWNER 전용(권한 상승 체인 차단)
- **공개 응답 폼 분리**: 서베이 문서에는 aggregates(주관식 응답 원문)가 들어 있어 문서째로 공개하면 응답이 새어나간다 → 폼 렌더링에 필요한 필드만 복사한 `projects/{pid}/public-forms/{sid}` 문서를 따로 두고, 서베이 문서는 전부 admin 전용으로 잠금 (`syncPublicForm`이 status 변화에 맞춰 생성·삭제)
- **익명 응답 create 형태 검증**: rules의 `isValidResponse()`가 필드 구성(`answers`/`submittedAt`/`source`/`respondent`)·`source=='live'`·`respondent==null`·`submittedAt==request.time`을 강제 (필드 위조·대량 쓰기 남용 차단)
- **demoUrl 스킴 검증** (`http://`·`https://`만 허용), **서베이 id 중복 방지** (`createSurvey` — merge 저장이 기존 서베이를 조용히 덮어쓰던 문제), **응답 수 서버 집계** (`countResponses` — 응답 문서를 내려받지 않고 카운트)
- 문서 갱신: ARCHITECTURE.md(공개 범위·다이어그램), docs/FIREBASE-SETUP.md, 스키마 description, 에이전트 README의 출력 경로

### 다음 할 일
- [ ] **사용자**: Firebase 콘솔에서 `firestore.rules` v0.3 내용 **재게시** (커밋만으로는 적용되지 않는다 — 안 하면 예전 공개 읽기 규칙이 그대로 살아 있다)
- [ ] **사용자**: now-here 서베이 원본(40문항 × 35명) CSV 확보 → 사이트에서 프로젝트 생성 + CSV 임포트
- [ ] M04 서베이 코칭(문항 생성·personaDimension 커버리지 진단 — Claude API, 비용 고지 필요)
- [ ] M05/M07 에이전트의 Firestore 쓰기 경로 — Firebase 서비스 계정(Admin SDK) 키를 Actions Secrets에 등록하고 Admin SDK로 쓰도록 구현 (ARCHITECTURE.md §7). 그 전까지는 로컬 실행 + 웹 입력

## 2026-07-25 — Phase 0: 스캐폴딩
- repo 생성 (gihoon-mx/persona-loop, public) 및 초기 구조 커밋
- 설계 확정: ARCHITECTURE.md 참고 (Pages+Actions+Firebase 하이브리드, Google 로그인, repo=DB)
- Pages 배포 워크플로우 추가 (`.github/workflows/pages.yml`)
- 데이터 스키마 v0 작성 (`packages/core/schemas/`)
- 첫 프로젝트 `now-here` 등록 (`data/projects/now-here/project.json`)

## 2026-07-25 — v0.2.0: 프로젝트-우선 개편 + 3모듈 구현
- 첫 페이지를 **프로젝트 목록/생성 → 프로젝트 홈(모듈 진입)** 구조로 개편
- 공용 코어: `assets/styles.css`, `packages/core/core.js` (Firebase/static 이중 모드 데이터 API — Firestore 미스 시 repo 커밋 데이터 폴백/병합), `firebase-config.js`(placeholder), `firestore.rules`
- **Survey**: 목록 / 생성(문항 편집기) / CSV 임포트 위저드(상태머신 파서, type 자동 추론, personaDimension 태깅) / 결과 대시보드(실시간 집계·커밋된 집계) / 공개 응답 폼 / 집계 JSON 다운로드
- **Persona**: 카드 목록 + 근거(evidence) 연결 상세 뷰어 (문항 텍스트 매핑 포함)
- **Review**: 타입별 리뷰 뷰어(앱스토어/블로그/SNS/인터뷰/UX리포트) + 사용 세션 리플레이(속마음 타임라인·비용 표시)
- 샘플 프로젝트 `data/projects/sample/` — 전체 흐름 시연용 (서베이 1·페르소나 2·리뷰 3·세션 1, 페르소나 보이스와 리뷰 말투 일치)
- `docs/FIREBASE-SETUP.md` 추가. 멀티에이전트 빌드 후 교차 검증에서 major 2건(responseCount 이중 카운트, firebase 모드 정적 데이터 미병합) 포함 8건 수정
- 로컬 브라우저 검증 완료 (전 화면 콘솔 에러 0)

### 다음 할 일 (Phase 1 마무리)
- [x] **사용자**: Firebase 프로젝트 생성 (docs/FIREBASE-SETUP.md) → web config 전달 → `firebase-config.js` 반영
- 나머지 항목은 위 v0.3 "다음 할 일"로 이관 (repo에 집계 JSON 커밋 항목은 v0.3에서 불가능해져 폐기)
