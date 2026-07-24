# Persona Loop — 아키텍처

## 전체 구성

```
┌─ GitHub Pages (정적 UI) ──────────────────────────────┐
│  apps/survey    apps/persona    apps/review           │
│  (관리 콘솔은 Firebase Auth Google 로그인 필요)          │
└──────────────┬────────────────────────▲───────────────┘
               │ 쓰기(응답)              │ 읽기(집계·페르소나·리뷰 JSON)
               ▼                        │
┌─ Firebase ────────────┐   ┌─ GitHub Repo (= DB) ──────┐
│ Firestore: 응답 원본    │   │ data/projects/<id>/       │
│ Auth: Google 로그인     │──▶│  surveys/ personas/       │
│ (원본은 비공개 유지)     │집계│  reviews/ sessions/       │
└───────────────────────┘   └────────────▲──────────────┘
                                         │ 결과 커밋
                            ┌─ GitHub Actions ───────────┐
                            │ persona-builder (Claude API)│
                            │ demo-reviewer (Playwright   │
                            │   + Claude API)             │
                            └────────────────────────────┘
```

## 핵심 결정

### 1. 호스팅 — GitHub Pages, repo는 public 유지
- GitHub Free 플랜에서 Pages는 **public repo만** 지원. private으로 하려면 GitHub Pro($4/월) 필요.
- public이어도 안전한 이유: 민감 데이터(응답 원본, 개인정보)는 Firebase에만 있고, repo에는 **익명화·집계된 데이터만** 커밋. Claude API 키는 Actions Secrets에만 존재. Firebase 웹 config는 원래 공개되는 값(도메인 제한으로 보호).
- 나중에 private이 꼭 필요하면: GitHub Pro 결제 or 호스팅을 Firebase Hosting으로 이전(무료, private repo 가능). 구조 변경 없이 배포 대상만 바뀜.
- public repo는 Actions 무료 무제한이라는 보너스도 있음 (private은 월 2,000분 제한).

### 2. 데이터 — repo가 DB, Firebase는 수집·인증 담당
- `data/projects/<project-id>/` 폴더 하나 = 프로젝트 하나. 서베이 정의·집계, 페르소나, 리뷰, 사용 세션 로그가 전부 JSON으로 쌓임. git 히스토리가 곧 버전 관리.
- Firestore에는 서베이 **응답 원본**만 저장 (응답자 식별 정보 포함 가능성이 있으므로 비공개). Actions 또는 콘솔에서 익명화·집계 후 repo에 커밋.
- 스키마는 `packages/core/schemas/` 의 JSON Schema가 단일 기준.

### 3. 인증 — Firebase Auth (Google 로그인)
- **관리 콘솔**(서베이 생성·페르소나 관리·Agent 실행 트리거): Google 로그인 필수 + Firestore rules에서 admin 이메일 allowlist로 제한 (초기: gihoon.mx@gmail.com).
- **서베이 응답자**: 기본 익명 (링크만으로 응답 가능, 진입 장벽 최소화). 서베이별 설정으로 Google 로그인 요구 가능 (중복 응답 방지가 필요할 때).
- Firebase 프로젝트: 신규 `persona-loop` 프로젝트 생성 권장 (now-here와 관심사 분리). Authorized domains에 `gihoon-mx.github.io` 추가 필요 — now-here에서 이미 해본 셋업과 동일.

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
- 페르소나도 JSON + git 히스토리로 버전 관리 (서베이가 추가되면 페르소나 업데이트, diff로 변화 추적).

### 6. 리뷰 — 타입 고정 스키마, "실제 같은" 리얼리즘
- 리뷰 타입: `appstore`(별점+제목+본문+장단점), `blog`(장문 사용기), `sns`(짧은 스레드), `interview`(Q&A 녹취록), `ux_report`(전문가형 리포트).
- 리얼리즘 장치: 페르소나별 말투·문장 길이·별점 성향(후한/짠) 파라미터, 리뷰 길이 분산, 방문 세션 로그 인용.
- ⚠️ 용도 경계: 내부 의사결정·데모용. AI 생성 리뷰를 실제 사용자 리뷰인 것처럼 외부 게시하는 용도가 아님 (뷰어에 AI 생성 표시 유지).

## 비용 발생 지점 (실행 전 항상 고지)

| 작업 | 비용 | 비고 |
|------|------|------|
| Pages 호스팅, Actions 실행 | 무료 | public repo |
| Firebase (Auth + Firestore) | 무료 티어로 충분 | 35명~수백 명 응답 규모 |
| 페르소나 생성 (Claude API) | 회당 수백 원 수준 | 서베이 응답 전체를 컨텍스트로 투입 |
| 데모 리뷰 세션 (Playwright + Claude API) | 세션당 대략 $0.5~2 | 스텝 수·스크린샷 해상도·모델에 따라 변동 |
| 서베이 코칭/생성 (Claude API) | 회당 수십~수백 원 | |

무료 범위(코드 작성, 배포, 데이터 정리)는 고지 없이 진행, **Claude API를 호출하는 작업은 실행 전 예상 비용을 먼저 알림**.
