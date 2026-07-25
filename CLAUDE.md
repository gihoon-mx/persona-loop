# Persona Loop — 작업 규칙

## 0. 신원 확인 (작업 시작 전 필수)

이 프로젝트는 **`gihoon-mx` GitHub 계정 권한을 가진 사람만** 이어서 작업한다.
어떤 변경 작업이든 시작하기 전에 활성 계정을 확인할 것:

```bash
gh auth status
```

- 활성 계정이 `gihoon-mx`(로그인 표기는 `gihoonmx-source`일 수 있음)가 **아니면 작업을 중단**하고 그 사실을 보고한다.
  전환: `gh auth switch --user gihoonmx-source`
- 이 저장소는 `gihoon-mx` 단독 소유이며 push 권한자도 그 계정뿐이다. 다른 계정으로 커밋·push하지 말 것.
- Firebase(`persona-loop-de062`) 콘솔 접근과 앱의 admin 권한도 소유자 계정에 묶여 있다.
  즉 이 프로젝트를 실제로 이어가려면 **repo 권한 + Firebase admin** 둘 다 필요하다.

읽기(코드 열람·설명)는 제한하지 않는다. 위 규칙은 **쓰기·배포·데이터 접근**에 적용된다.

## 1. 상태 파악 순서

세션 시작 시 이 순서로 읽는다. 이 저장소가 프로젝트 상태의 단일 소스이며, 외부 메모리에 의존하지 않는다.

1. `WORKLOG.md` — 진행 상태·다음 할 일 (작업 후 갱신해 커밋에 포함)
2. `MODULES.md` — 모듈 레지스트리와 작업 규칙 (한 세션 = 한 모듈)
3. `ARCHITECTURE.md` — 설계 결정과 공개 범위
4. `docs/FIREBASE-SETUP.md` — Firebase 상태·절차

## 2. 보안 원칙 (v0.3 비공개 기본)

- **실데이터를 repo에 커밋하지 않는다.** 프로젝트·서베이·응답·페르소나·리뷰·세션은 Firestore에만 둔다.
  `data/seed/sample/`의 창작 샘플만 예외다.
- 모든 화면은 `core.requireAdmin()` 게이트 뒤에 둔다. 예외는 공개 응답 폼(`?mode=respond`) 하나뿐이다.
- 공개되는 Firestore 문서는 `projects/{pid}/public-forms/{sid}` 뿐이며, 폼 렌더링에 필요한 필드만 담는다.
  서베이 문서에는 집계(주관식 응답 원문)가 들어 있으므로 절대 공개 대상에 넣지 말 것.
- `firestore.rules`를 고쳤다면 **콘솔에 붙여넣고 게시해야** 적용된다. 커밋만으로는 효과가 없다.
  게시 후 검증: `bash tools/check-rules.sh`
- 비밀값(서비스 계정 키·API 키)은 repo에 두지 않는다. GitHub Actions Secrets만 사용한다.
- **GCP 자격증명(ADC)·서비스 계정 키도 repo에 두지 않는다.** 로컬 실행은 `gcloud auth application-default login`(ADC)으로,
  Actions는 Secrets로 인증한다. `application_default_credentials.json`·키 JSON을 프로젝트 폴더로 복사하지 말 것.
- **now-here-survey(외부 설문 시스템)는 읽기 전용으로만 접근한다.** 현장에서 운영 중인 서비스이므로 `packages/core/survey-source.js`에
  쓰기 코드(POST/PATCH/PUT/DELETE, Supabase RPC, Realtime 구독)를 추가하지 않는다 — 허용되는 POST는 인증 토큰 발급·갱신뿐이다.
  연동 계정 토큰은 `sessionStorage`에만 두고, 참가자 실명·로그인 아이디·passcode는 가져오지 않는다 (`docs/SURVEY-INTEGRATION.md`).

## 3. AI 모델 호출과 비용 고지

이 프로젝트의 AI 기능은 **Google Gemini(Agent Platform, 구 Vertex AI)** 로 돌린다. 근거·SDK·모델 선택은
[docs/AI-PROVIDER.md](docs/AI-PROVIDER.md)가 단일 기준이다.

**비용 고지**: 모델을 호출하는 기능(페르소나 생성, 데모 리뷰 세션 **약 $0.15~0.3/건 추정**, 서베이 코칭)은
**실행 전에 예상 비용을 사용자에게 알리고 진행**한다. 코드 작성·배포·데이터 정리는 고지 없이 진행한다.
단가가 Claude 시절보다 크게 낮아졌지만 **고지 규칙 자체는 그대로 유지**한다 — 위 수치는 실측이 아니라 추정이며,
실제 사용량은 세션 로그의 `costUsd`에 기록해 추정을 교정한다.

**모델 호출부 규칙**: 모델명·제공자·엔드포인트는 **설정(환경변수·설정 파일)으로 빼고, 호출 코드는 한 곳에 모은다.**
나중에 모델을 바꾸거나 품질을 A/B로 비교할 때 호출부 한 곳만 고치면 되도록 한다. 에이전트 스크립트 곳곳에
모델 id를 하드코딩하지 않는다.

## 4. 버전

사용자에게 보이는 변경마다 `data-app-ver`(모든 페이지 footer)를 올린다.
