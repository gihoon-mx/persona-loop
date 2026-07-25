# WORKLOG

멀티 세션 작업의 단일 상태 소스. 세션 시작 시 먼저 읽고, 작업 후 갱신해 커밋에 포함할 것.

## 2026-07-25 — AI 제공자 전환 결정: Claude API → Gemini on Agent Platform

**결정 근거와 상세는 [docs/AI-PROVIDER.md](docs/AI-PROVIDER.md)가 단일 기준이다.** 요약:

- 사용자가 GCP 체험 크레딧을 보유(만료 **2026-09-30**). 이 크레딧을 AI 비용에 쓰려면 경로가 하나뿐이다 —
  Google 공식 문서가 **"생성형 AI 파트너 모델(MaaS)"과 "AI Studio의 Gemini API"를 크레딧 사용 대상에서 명시적으로 제외**한다.
  Claude는 Agent Platform에서 partner model로 분류되므로 **Vertex로 우회 호출해도 크레딧이 적용되지 않는다.**
  크레딧이 확실히 먹는 것은 **Agent Platform의 Gemini**뿐이다.
- **Vertex AI는 사라진 게 아니라 "Gemini Enterprise Agent Platform"으로 이름이 바뀌었다.**
  엔드포인트 `aiplatform.googleapis.com`은 그대로 살아 있다(2026-07-25 확인). 콘솔에서는 "Agent Platform"으로 검색할 것.
- SDK는 `google-genai` 하나. **`enterprise=True`가 곧 과금 경계다** — 켜면 Agent Platform(크레딧 적용), 끄면 AI Studio(무료 등급).
  예전 예제의 `vertexai=True`는 현재 `enterprise=True`로 바뀌었다.
- 모델: demo-reviewer = **Gemini 2.5 Flash**($0.30/$2.50 per 1M, 이미지 입력도 같은 단가), persona-builder = **배치 모드**(50% 할인).
  `location="global"` 권장(2026-07-01부터 non-global +10%).
- 문서 정리 완료: CLAUDE.md·ARCHITECTURE.md·MODULES.md·README.md·두 에이전트 README의 Claude 전제를 Gemini 기준으로 교체.

### 다음 할 일
- [ ] **사용자(최우선)**: GCP 프로젝트에서 Agent Platform API 활성화(`gcloud services enable aiplatform.googleapis.com`) 후
      **Gemini 쿼터가 0이 아닌지 확인**. 신규·업그레이드 프로젝트에서 쿼터가 0으로 잠기는 사례가 보고돼 있고,
      풀려면 지원 티켓이 필요해 수일~수십일이 걸릴 수 있다. 크레딧 만료가 가까워 일정상 가장 큰 위험이다.
- [ ] **사용자**: 소액 호출 1회 후 결제 콘솔에서 **크레딧이 실제로 차감되는지 눈으로 확인** (문서 해석은 맞지만 돈이 걸린 일이다)
- [ ] **사용자(선택)**: Firebase 프로젝트를 같은 결제 계정에 연결 — 크레딧 소진 효과는 거의 없지만
      스크린샷 저장용 Cloud Storage의 Blaze 요건이 풀리고 실제 비용은 무료 등급 안이다

### ⚠️ v0.5.0 검증 미완료 (인수인계 주의)
v0.5.0 작업 중 교차 검증 에이전트 2개가 **API 529(서버 과부하)로 실패**해 끝까지 돌지 못했다.
빌더 자체 검증(스키마 검증 스크립트·렌더 스모크)은 통과했으나, **독립 검증은 이뤄지지 않았다.**
다음 세션에서 아래를 확인할 것:
- 샘플 페르소나 2건의 모든 `evidence`에 `respondentLabel`이 있고 `questionId`가 `sv-sample.json`에 실존하는가
- `behaviorModel` 각 항목이 실제 응답에서 도출 가능한가 (지어낸 항목이 없는가)
- 응답자별 보기에서 `respondentLabel`이 없는 응답(CSV·공개 폼)·복수 선택·무응답이 제대로 렌더되는가
- 내보낸 프로필 JSON이 `answerProfile` 스키마와 일치하는가

## 2026-07-25 — v0.5.0: 페르소나를 개인 응답 기반으로 전환

**"페르소나는 문항별로 만드는 게 아니라, 각 응답자 개인이 문항에 어떻게 답했는지를 분석해서 만든다. 그래야 이 사람이 유사 서비스에서 어떻게 행동할지 대변할 수 있다."**

v0.4까지는 "35명 중 71%가 X" 같은 **집계**를 근거로 페르소나를 만들었다. 그건 통계 요약이지 사람이 아니다 — 71%의 X와 64%의 Y를 동시에 고른 응답자가 실제로는 0명일 수 있고, 그렇게 만든 페르소나는 존재하지 않는 사람이라 행동을 예측할 수 없다. 페르소나의 단위를 **응답자 개인**으로 되돌리고, 집계는 "이 사람이 다수인지 소수인지"를 알려주는 보조 정보로 강등했다.

- **스키마 전면 개정** (`persona.schema.json`): `basis`(individual|cluster) · `sourceRespondents`(익명 라벨 + primary/supporting) · `answerProfile`(중심 응답자의 답변 전체 + `contradictions`) · `behaviorModel` · `confidence` · `clusterSize` · `populationNote` · `revisionNote` 신설. **`evidence[]`에 `respondentLabel` 필수** — 근거는 "특정 사람의 특정 답변"이어야 하고, 집계(`populationContext`)는 선택 보조 필드로 내려갔다
- **`behaviorModel` 신설** — 페르소나의 목적은 묘사가 아니라 대변이다. `firstMoves`·`decisionDrivers`·`dealBreakers`·`successMoment`·`comparisonAnchors`·`effortTolerance`·`helpSeeking`을 근거와 함께 적고, demo-reviewer가 데모를 쓸 때 이 규칙을 그대로 실행한다
- **`answerProfile` 신설** — 중심 응답자가 실제로 낸 40문항 답변 전체를 페르소나 옆에 나란히 두어 "창작이 아님"을 증명한다. 원문(`answer`·`comment`)과 해석(`readAs`)을 필드로 분리. 모순(`contradictions`)은 감추지 않는다 — 매끈한 페르소나는 가짜다
- **응답자별 보기 신설** (M03, `apps/survey/`): 결과 화면을 문항별 집계 ↔ 응답자별 프로필로 전환. 응답 문서 1건 = 응답자 1명이라 데이터는 원래 있었고, 화면이 문항별로만 접고 있었을 뿐이다. `respondentLabel`이 없는 응답(CSV·공개 폼)은 "응답 #n"으로 표기(정렬 고정). **전체 프로필 JSON**(응답자 전원)·**응답 프로필 JSON**(1명)이 `answerProfile` 형태로 내려받히며 그대로 persona-builder의 입력이 된다
- **페르소나 뷰어 확장** (M06): 응답 프로필 뷰·행동 모델 뷰·근거의 응답자 라벨 표시
- **에이전트 사양 재작성**: `agents/persona-builder/README.md`가 M05의 구현 사양이 됐다 — 입력(응답자별 프로필) / 6단계 방법(프로필 구성 → 패턴 묶기 → 중심 응답자 선정 → 특성 도출 → behaviorModel 도출 → 모순·신뢰도) / 금지 사항 / 저장 전 자기 점검. `agents/demo-reviewer/README.md`는 behaviorModel을 실행 규칙으로 쓰도록 갱신(dealBreaker 조우 시 `gave_up`·`abandoned`로 즉시 종료, effortTolerance별 스텝 예산, decisionDrivers = 리뷰 평가 축)
- **샘플 재작성**: `data/seed/sample/`의 페르소나를 새 스키마에 맞춰 다시 씀 (응답 프로필·행동 모델 포함)
- 문서: ARCHITECTURE.md §5 "페르소나 — 개인 응답 기반"으로 재작성, MODULES.md M03·M05·M06 갱신

### 다음 할 일
- [ ] **M05 persona-builder 구현** — 사양은 `agents/persona-builder/README.md`에 확정돼 있다. 로컬 실행(서비스 계정 키 불필요) + 결과를 웹 화면에서 입력하는 경로부터 만들 것. 모델 비용은 응답자 수에 비례하므로 실행 전 고지 필수 (Gemini — docs/AI-PROVIDER.md)
- [ ] **사용자**: 결과 화면에서 응답자별 보기 → JSON 내보내기를 한 번 돌려보고, 라벨·무응답 표기가 실제 데이터에서 제대로 나오는지 확인 (연동 회차는 P1·P2…, CSV 임포트는 "응답 #n")
- [ ] 페르소나 뷰어에 응답 프로필과 페르소나를 좌우로 나란히 놓는 대조 뷰(넓은 화면) 검토

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
- [ ] M04 서베이 코칭(문항 생성·personaDimension 커버리지 진단 — Gemini, 비용 고지 필요)
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
