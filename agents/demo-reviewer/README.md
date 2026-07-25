# demo-reviewer (M07)

페르소나 Agent가 데모 서비스를 실제 브라우저(Playwright)로 사용하고 리뷰를 작성.

이 에이전트는 페르소나를 "참고"하지 않는다. 페르소나의 **`behaviorModel`을 실행 규칙으로 삼는다** — 무엇을 먼저 하는지, 무엇을 보고 판단하는지, 어디서 그만두는지가 전부 거기에 적혀 있고 각 항목은 실제 응답자의 답변에 걸려 있다(persona.schema.json / agents/persona-builder).

## 흐름
1. 페르소나 로드 → **`behaviorModel`을 행동 계획으로 변환** + 환경(viewport/네트워크/geolocation) 설정
2. 데모를 `?agent=1`(agent bridge)로 열고, [스크린샷 → Claude가 페르소나로서 다음 행동 결정 → Playwright 실행] 루프
3. 스텝별 [스크린샷 + 행동 + 속마음] 기록 → Firestore `projects/<pid>/sessions/{id}` (session.schema.json)
4. 세션 로그를 근거로 리뷰 생성 → Firestore `projects/<pid>/reviews/{id}` (review.schema.json, 타입별 포맷)

> v0.3부터 산출물은 repo가 아니라 Firestore에 저장된다. Actions에서 쓰려면 Firebase 서비스 계정(Admin SDK) 키를 Secrets에 등록해야 한다 (ARCHITECTURE.md §7 — 아직 미구현). 대안: 로컬 실행 후 웹 화면에서 입력.

## behaviorModel → 세션 실행 규칙

### 시작 — `firstMoves`가 초기 행동 계획이다
- 세션의 처음 몇 스텝은 `firstMoves`를 **순서대로** 시도하는 것으로 시작한다. 화면을 보고 즉흥적으로 정하지 않는다.
- 화면에 그에 해당하는 것이 없으면 "그것을 찾는 행동"이 스텝이 되고, `thought`에 기대와 어긋난 지점을 적는다 (`outcome: "confused"`). 이 어긋남이 리뷰에서 가장 값진 부분이다.
- `firstMoves`를 다 소진한 뒤부터 시나리오 목표(`scenario`)를 향해 자유롭게 움직인다.

### 종료 — `dealBreakers`를 만나면 그 자리에서 끝낸다
- `dealBreakers` 중 하나에 해당하는 상황(가입 강요, 권한 요구, 광고 등 페르소나가 적어 둔 조건)을 만나면 **그 스텝의 `outcome`을 `gave_up`으로 기록하고 세션을 종료**한다. 세션 `result`는 `abandoned`.
- 그 뒤로 스텝을 이어 붙이지 않는다. 억지로 완주시키면 "실제로 써봤다"는 기록이 거짓이 된다. **중간에 나가버린 세션도 정당한 결과물**이고, 오히려 가장 강한 신호다.
- 리뷰는 그 지점까지만 근거로 쓴다. 보지 못한 화면에 대해 평하지 않는다.

### 인내심 — `effortTolerance`가 스텝 예산을 정한다

| `effortTolerance` | `confused` 누적 상한 | 총 스텝 상한 (권장) |
|---|---|---|
| `low` | 2회 → 이탈 | 8 |
| `mid` | 4회 → 이탈 | 15 |
| `high` | 6회 → 이탈 | 25 |

- 상한에 걸려 끝나는 세션은 마지막 스텝 `outcome: "gave_up"`, 세션 `result: "abandoned"`.
- 목표에 닿았지만 일부만 해낸 경우는 `partial`, `successMoment`가 실제로 일어났으면 `completed`.
- `helpSeeking`이 `often`이면 막혔을 때 도움말·문의 탐색을 스텝으로 넣는다. `never`면 도움말을 **절대 열지 않는다** — 헤매거나 나간다. `rarely`면 이탈 직전에 한 번만.

### 평가 — `decisionDrivers`가 리뷰의 축이다
- `pros`/`cons`는 아무 인상이나 나열하지 않고 **각 `decisionDriver`가 충족됐는지/깨졌는지**로 정리한다. driver 하나가 pros나 cons 중 한쪽에 대응하는 것이 기본형이다.
- `appstore` 타입의 `rating`도 충족된 driver 수와 dealBreaker 조우 여부로 정한다(dealBreaker를 만났으면 낮은 별점 + `abandoned` 세션 인용). 여기에 `voice.ratingBias`(후함/짠편)를 얹는다.
- `suggestions`는 세션에서 실제로 막힌 지점에서만 나온다.

### 비교 — `comparisonAnchors`는 리뷰에서 언급된다
- 리뷰 본문에서 "○○는 이걸 이렇게 하던데" 식으로 비교 대상으로 등장시킨다. 사람은 새 서비스를 진공에서 평가하지 않는다.
- **응답에 등장한 서비스만** 쓴다. 유명하다는 이유로 다른 이름을 끌어오지 않는다.

### 모순 — `answerProfile.contradictions`를 행동으로 드러낸다
- 페르소나가 말로는 A라고 했지만 실제로는 B를 택하는 순간을 세션에 남길 수 있다("위치 공유는 꺼려진다"고 답한 사람이 주변 추천을 보려고 권한을 허용). `thought`에 그 망설임을 적는다.
- 리뷰에서도 스스로 흔들리는 서술을 허용한다. 일관되게 다듬지 않는다.

### 환경 — `techProfile`
- `techProfile.device` → 세션 `environment.viewport` (예: iPhone → `390x844`)
- `techProfile.network` → 속도 조건(`fast`/`normal`/`slow`) — 느린 조건에서만 드러나는 문제가 있다
- `techProfile.savviness` → 조작 숙련도. `low`면 스크롤·뒤로가기 같은 기본 동작에서도 헤맬 수 있다
- geolocation은 agent bridge로 mock 주입

## 스크린샷
- 세션 로그의 `screenshot`은 **`http(s)://` 절대 URL만** 뷰어에 표시된다. repo 상대경로(구 `data/projects/…`)는 더 이상 존재하지 않으므로 "스크린샷 없음"으로 처리된다.
- 따라서 스크린샷을 남기려면 **Firebase Storage 등 외부 저장소에 업로드하고 그 URL을 기록**해야 한다 (향후 과제 — 현재 미구현).

## agent bridge (데모 서비스 쪽 요구사항)
- `?agent=1` 진입 시: 주요 UI에 `data-testid` 노출, geolocation mock 허용, 애니메이션 축소
- now-here는 직접 만든 앱이므로 이 모듈을 now-here repo에 추가하는 작업이 선행됨

## 비용
세션당 대략 $0.5~2 (스텝 수·모델에 따라). 실행 전 항상 고지, 세션 로그에 `costUsd` 기록.
`effortTolerance`가 `low`인 페르소나는 스텝이 적어 더 싸다 — 비용을 아끼려고 상한을 늘리거나 줄이지 말 것. 스텝 예산은 페르소나의 성격이지 예산 항목이 아니다.
