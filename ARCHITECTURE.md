# Persona Loop — 아키텍처

> **v0.3 "비공개 기본"** — 모든 프로젝트 데이터는 Firestore에만 존재하고, 모든 화면은 로그인 게이트 뒤에 있다.
> repo에 남는 데이터는 가상의 샘플 시드 하나뿐이다. (이전 v0.2의 "repo = DB" 모델은 폐기)

## 전체 구성

```
┌─ GitHub Pages (public repo · 정적 UI, 빌드 없음) ───────────┐
│  index.html    apps/survey    apps/persona    apps/review   │
│  모든 화면 = admin 로그인 게이트(core.requireAdmin) 뒤      │
│  유일한 예외: 공개 응답 폼 — 링크만으로 비로그인 접근       │
└───────────────┬──────────────────────────▲──────────────────┘
                │ 읽기·쓰기(SDK)           │ 규칙이 매 요청 검사
                ▼                          │
┌─ Firebase — 유일한 데이터 저장소 ───────────────────────────┐
│ Auth      : Google 로그인 (OWNER 고정 + admins allowlist)   │
│ Firestore : admins/{email}                                  │
│             projects/{pid}                                  │
│               ├ surveys/{sid} ─ responses/{rid} ← 응답 원본 │
│               ├ public-forms/{sid} ← 문항만 복사 (공개)     │
│               ├ personas/{id}                               │
│               ├ reviews/{id}                                │
│               └ sessions/{id}                               │
│ 전부 admin 전용. 예외는 public-forms/{sid} 문서 1건의 읽기  │
└────────────────────────────▲────────────────────────────────┘
                             │ 결과 쓰기 (서비스 계정 — 향후 과제)
┌─ GitHub Actions — Agent 런타임 ─────────────────────────────┐
│ persona-builder (Claude API)                                │
│ demo-reviewer   (Playwright + Claude API)                   │
└─────────────────────────────────────────────────────────────┘

repo에 커밋되는 데이터: data/seed/sample/ (가상 샘플) 뿐 — 실데이터 0건
```

## 공개 범위

사이트 코드는 public repo에 있지만, **데이터는 하나도 public이 아니다.** 보호는 저장소 가시성이 아니라 Firestore 보안 규칙이 담당한다.

| 대상 | 공개 여부 | 어디서 보호되나 |
|------|-----------|-----------------|
| 사이트 코드 (HTML/CSS/JS, 스키마) | 🌐 공개 | — 비밀 없음 |
| Firebase 웹 config (`firebase-config.js`) | 🌐 공개 | 식별자일 뿐. 승인된 도메인 + 보안 규칙이 실제 보호 |
| 가상 샘플 시드 (`data/seed/sample/`) | 🌐 공개 | — 창작 데이터, 실제 응답·개인정보 없음 |
| 공개 응답 폼 (`public-forms/{sid}` 1건 — 문항만 복사) | 🌐 공개 (읽기) + 응답 제출 | rules: 해당 문서 `get`만 허용, `list` 불가 |
| 프로젝트 목록·정의 | 🔒 비공개 | rules: `isAdmin()` |
| 서베이 문서 (정의 + 집계) | 🔒 비공개 | rules: `isAdmin()` — 열린 서베이도 예외 없음 |
| **서베이 응답 원본** | 🔒 비공개 | rules: 열람·수정·삭제 admin 전용. 생성만, 공개 폼이 열려 있고(`formIsOpen`) 형태 검증(`isValidResponse`)을 통과할 때 허용 |
| 페르소나 | 🔒 비공개 | rules: `isAdmin()` |
| 리뷰 | 🔒 비공개 | rules: `isAdmin()` |
| 사용 세션 로그 | 🔒 비공개 | rules: `isAdmin()` |
| 관리자 목록 (`admins/`) | 🔒 비공개 | 본인 문서 `get`만 가능(로그인 직후 권한 판정용), 목록 조회는 admin, 추가·삭제는 OWNER |

응답자에게 노출되는 것은 **응답 링크로 지목한 `public-forms/{sid}` 문서 1건의 문항**뿐이다. 같은 프로젝트의 다른 서베이·응답·페르소나·리뷰는 링크를 가진 응답자에게도 보이지 않는다.

**왜 서베이 문서를 그대로 공개하지 않는가**: 서베이 문서에는 `aggregates`가 들어 있고, 주관식(open) 문항의 집계는 **응답 원문 그 자체**다. 문서를 통째로 공개하면 응답 링크를 받은 사람이 다른 사람들의 응답을 전부 읽게 된다. 그래서 "무엇을 공개할지"를 필드 단위로 정한 화이트리스트 문서(`public-forms/{sid}`)를 따로 두고, 폼을 그리는 데 필요한 `title`·`description`·`questions`·`status`만 복사한다. 서베이를 저장할 때마다 `core.js`의 `syncPublicForm()`이 이 문서를 갱신하고, `status`가 `'open'`이 아니게 되면 삭제한다.

## 핵심 결정

### 1. 호스팅 — GitHub Pages, repo는 public 유지
- GitHub Free 플랜에서 Pages는 **public repo만** 지원. private으로 하려면 GitHub Pro($4/월) 필요.
- **v0.3부터는 public이어도 안전하다**: repo에 실데이터가 아예 없기 때문이다. 코드·가상 샘플 시드·공개돼도 무방한 Firebase 웹 config만 커밋되고, 프로젝트·응답·페르소나·리뷰는 전부 Firestore에 있으며 규칙으로 막혀 있다. 즉 **repo를 private으로 바꿔도 보안이 나아지지 않는다** → GitHub Pro 불필요.
- Claude API 키는 Actions Secrets에만 존재.
- 나중에 굳이 private이 필요하면: GitHub Pro 결제 or Firebase Hosting으로 이전(무료, private repo 가능). 구조 변경 없이 배포 대상만 바뀜.
- public repo는 Actions 무료 무제한이라는 보너스도 있음 (private은 월 2,000분 제한).

### 2. 데이터 — Firestore가 단일 저장소, repo는 코드 + 샘플 시드
- 프로젝트·서베이 정의·응답 원본·페르소나·리뷰·세션 로그가 **전부 Firestore에** 있다. `packages/core/core.js`는 Firestore에서만 읽고 쓴다 — 정적 JSON 폴백 경로는 없다.
- repo의 `data/seed/sample/`은 **가상의 데모 데이터**다. 관리자가 설정 화면에서 버튼 한 번으로 Firestore에 적재(`seedSampleProject()`)해 전체 흐름을 시연하고, 언제든 지울 수 있다.
- 스키마는 `packages/core/schemas/` 의 JSON Schema가 여전히 단일 기준.

**이 전환으로 잃은 것 (정직하게 기록)**
- v0.2에서는 `data/projects/<id>/`가 곧 DB였고, **`git diff`로 페르소나가 어떻게 바뀌었는지 추적**할 수 있었다. 서베이가 추가될 때마다 페르소나가 어떻게 갱신됐는지 커밋 히스토리에 그대로 남는 것이 이 설계의 가장 좋은 점이었다. v0.3에서 이 이점은 **사라졌다.**
- 대체 수단:
  1. **페르소나 문서의 `version` 필드** — 갱신할 때마다 올리고, 변경 근거(어떤 서베이가 추가돼서 무엇이 바뀌었는지)를 문서 안에 남긴다. 지금 당장 쓰는 방법.
  2. **스냅샷 내보내기 (향후)** — 프로젝트 전체를 JSON으로 내려받아 원하는 시점에 백업/비교. repo 커밋은 하지 않되 로컬에서 diff는 가능해진다. 자동 백업 트리거도 여기에 얹을 수 있다.
- 즉 "버전 관리"는 무료로 따라오던 것에서 **의식적으로 해야 하는 일**로 바뀌었다. 대신 실데이터가 public repo에 영원히 박히는 위험이 사라졌다.

### 3. 인증 — Firebase Auth (Google 로그인) + 2단 권한
- **OWNER**: `firestore.rules`의 `isOwner()`와 `packages/core/firebase-config.js`의 `OWNER_EMAIL`에 **하드코딩**(현재 `gihoon.mx@gmail.com`). allowlist가 비어도 절대 잠기지 않는 부트스트랩 보장. 관리자 추가·삭제 권한은 OWNER에게만 있다(권한 상승 체인 차단).
- **관리자(admin)**: Firestore `admins/{email}` 문서로 관리하며, 웹 **설정 화면**(우측 상단 "설정")에서 Google 이메일을 추가·삭제한다. 배포나 코드 수정 없이 즉시 반영된다.
- **모든 화면**은 `core.requireAdmin(container)` 게이트를 통과해야 그려진다. 비로그인 → 로그인 안내, 로그인했지만 allowlist 밖 → "접근 권한이 없습니다".
- **서베이 응답자**: 유일한 비로그인 예외. `status`가 `'open'`인 공개 폼 문서 `projects/{pid}/public-forms/{sid}` **1건**을 읽고(문항만 들어 있다) 그 서베이에 응답을 제출할 수 있다. 서베이 문서 자체는 읽지 못하며, 목록 조회(`list`)도 불가하므로 다른 서베이의 존재도 알 수 없다. 응답 생성에는 rules의 `isValidResponse()` 형태 검증(필드 구성·`source=='live'`·`respondent==null`·서버 시각)이 걸려 있다.
- Firebase 프로젝트: `persona-loop-de062`. Authorized domains에 `gihoon-mx.github.io` 등록 필요. 셋업 절차는 [docs/FIREBASE-SETUP.md](docs/FIREBASE-SETUP.md).

### 4. 데모 리뷰어 — "실제로 써봤다"를 만드는 방법
now-here가 직접 만든 앱이라는 점을 최대한 활용한다:

1. **Agent Bridge** (now-here 쪽에 추가하는 소형 모듈): `?agent=1` 쿼리로 진입 시
   - 주요 UI 요소에 `data-testid` 노출 → Agent의 조작 성공률 대폭 상승
   - geolocation mock 주입 가능 (페르소나별 "사는 동네"에서 앱을 쓰는 시나리오)
   - 애니메이션 축소 → 스크린샷 안정화
2. **실행**: GitHub Actions에서 Playwright가 실제 브라우저로 데모를 열고, Claude가 스크린샷을 보고 다음 행동을 결정하는 루프 (computer-use 방식). 페르소나별로 viewport(기기)·네트워크 속도·목표 시나리오("퇴근길에 우리 동네 경계 확인하기" 등)를 다르게 설정.
3. **산출물 — 사용 여정 로그(session log)**: 스텝별 [스크린샷 + 행동 + 페르소나의 속마음] 기록. 리뷰 뷰어에서 세션 리플레이로 보여주고, 최종 리뷰는 이 여정을 근거로 작성됨. "정말 써봤다"의 증거가 UI로 드러나는 게 이 플랫폼의 차별점.

### 5. 페르소나 — 근거 연결 필수
- 페르소나의 모든 특성(traits, painPoints 등)은 `evidence` 필드로 실제 서베이 응답 인용에 연결. 창작 페르소나와 구분되는 신뢰도의 핵심.
- 버전 관리는 git 히스토리가 아니라 **문서의 `version` 필드 + 갱신 사유 기록**으로 한다(§2 참고). 서베이가 추가되면 페르소나를 갱신하고 version을 올린다.

### 6. 리뷰 — 타입 고정 스키마, "실제 같은" 리얼리즘
- 리뷰 타입: `appstore`(별점+제목+본문+장단점), `blog`(장문 사용기), `sns`(짧은 스레드), `interview`(Q&A 녹취록), `ux_report`(전문가형 리포트).
- 리얼리즘 장치: 페르소나별 말투·문장 길이·별점 성향(후한/짠) 파라미터, 리뷰 길이 분산, 방문 세션 로그 인용.
- ⚠️ 용도 경계: 내부 의사결정·데모용. AI 생성 리뷰를 실제 사용자 리뷰인 것처럼 외부 게시하는 용도가 아님 (뷰어에 AI 생성 표시 유지).

### 7. 에이전트의 쓰기 경로 — 향후 과제
- v0.2에서 M05(persona-builder)·M07(demo-reviewer)는 결과를 **repo에 커밋**하도록 설계돼 있었다. v0.3에서는 데이터가 repo에 없으므로, 두 에이전트는 결과를 **Firestore에 직접 써야 한다**.
- 필요한 것: **Firebase 서비스 계정 키**(Admin SDK)를 GitHub Actions Secrets에 등록하고, 에이전트 스크립트가 Admin SDK로 `projects/<pid>/personas`·`reviews`·`sessions`에 쓰도록 구현. Admin SDK는 보안 규칙을 우회하므로 웹 클라이언트용 allowlist와 무관하게 동작한다.
- 아직 구현되지 않았다. 그때까지 페르소나·리뷰·세션은 웹 화면에서 수동으로 넣거나 샘플 시드로만 존재한다.
- 대안(더 단순): 에이전트를 Actions가 아니라 로컬에서 돌리고 결과를 웹 화면에서 붙여넣기. 서비스 계정 키를 만들지 않아도 되므로 초기에는 이쪽이 안전하다.

## 비용 발생 지점 (실행 전 항상 고지)

| 작업 | 비용 | 비고 |
|------|------|------|
| Pages 호스팅, Actions 실행 | 무료 | public repo |
| Firebase (Auth + Firestore) | 무료 티어로 충분 | 35명~수백 명 응답 규모 |
| 페르소나 생성 (Claude API) | 회당 수백 원 수준 | 서베이 응답 전체를 컨텍스트로 투입 |
| 데모 리뷰 세션 (Playwright + Claude API) | 세션당 대략 $0.5~2 | 스텝 수·스크린샷 해상도·모델에 따라 변동 |
| 서베이 코칭/생성 (Claude API) | 회당 수십~수백 원 | |

무료 범위(코드 작성, 배포, 데이터 정리)는 고지 없이 진행, **Claude API를 호출하는 작업은 실행 전 예상 비용을 먼저 알림**.
