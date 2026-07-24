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

## 3. 비용 고지

Claude API를 호출하는 기능(페르소나 생성, 데모 리뷰 세션 약 $0.5~2/건, 서베이 코칭)은
**실행 전에 예상 비용을 사용자에게 알리고 진행**한다. 코드 작성·배포·데이터 정리는 고지 없이 진행한다.

## 4. 버전

사용자에게 보이는 변경마다 `data-app-ver`(모든 페이지 footer)를 올린다.
