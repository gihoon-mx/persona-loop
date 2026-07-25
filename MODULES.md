# 모듈 레지스트리

한 세션 = 한 모듈 원칙 (now-here 방식). 모듈 단위로 작업·업데이트하고, 완료 시 WORKLOG.md 갱신을 커밋에 포함한다.

| ID | 모듈 | 경로 | 설명 | 상태 |
|----|------|------|------|------|
| M01 | site | `index.html` | 프로젝트 목록/생성 + 프로젝트 홈(모듈 진입점) + **설정 화면**(관리자 추가·삭제, 샘플 시드 적재) | ✅ v0.3 |
| M02 | core | `packages/core/` | 인증·**접근 게이트(`requireAdmin`)**·Firestore 데이터 API·스키마·공용 스타일 | ✅ v0.3 |
| M03 | survey-results | `apps/survey/` | 서베이 결과 대시보드 — **문항별 집계 ↔ 응답자별 보기** 전환 (응답자 1명의 전체 답변 프로필 + 무응답 표시 + 프로필 JSON 내보내기 = M05 입력) | ✅ v0.5 |
| M04 | survey-studio | `apps/survey/` | 서베이 생성·CSV 임포트·공개 응답 폼 (코칭 기능은 예정) | 🔶 코칭 예정 |
| M05 | persona-builder | `agents/persona-builder/` | **응답자별 프로필 → 개인 기반 페르소나 생성** (중심 응답자 선정 · 근거에 respondentLabel 필수 · behaviorModel 도출). Gemini(배치 모드), 결과는 Firestore에 기록 | 예정 (사양 확정 v0.5) |
| M06 | persona-app | `apps/persona/` | 페르소나 카드 뷰 + **응답 프로필 뷰**(중심 응답자의 답변 전체·모순) + **행동 모델 뷰** + 근거(evidence) 상세 | ✅ v0.5 (뷰어) |
| M07 | demo-reviewer | `agents/demo-reviewer/` | Playwright + Gemini 2.5 Flash로 데모 사용 + 리뷰 생성 (결과는 Firestore에 기록) | 예정 |
| M08 | review-app | `apps/review/` | 타입별 리뷰 뷰어 + 세션 리플레이 | ✅ v0.3 (뷰어) |
| M09 | infra | `.github/workflows/`, Firebase 설정 | 배포·보안 규칙·Agent 실행 파이프라인 | 🔶 Pages 완료 / v0.3 규칙 재게시 필요 |
| M10 | now-here-survey 연동 | `packages/core/survey-source.js` + `apps/survey/` | 외부 설문 시스템(Supabase)의 회차를 **읽기 전용**으로 가져오기 — 관리자 로그인·구조 변환·참가자 익명화·재동기화 ([가이드](docs/SURVEY-INTEGRATION.md)) | ✅ v0.4 |

## 규칙
- 스키마 변경은 반드시 M02(`packages/core/schemas/`)에서 먼저 — 앱과 에이전트는 스키마를 따른다.
- **페르소나는 응답자 개인에서 나온다.** 문항별 집계로 특성을 만들지 않으며, 모든 `evidence`에 `respondentLabel`(어느 응답자의 답인지)을 남긴다. 집계는 대표성 표시용 보조 정보다 (ARCHITECTURE.md §5).
- **M10 연동은 읽기 전용이다.** `survey-source.js`에 쓰기(POST/PATCH/DELETE/RPC) 코드를 추가하지 않는다. 원본은 운영 중인 서비스다.
- **AI 모델은 Gemini(Agent Platform)로 호출한다** — 제공자·SDK·단가의 단일 기준은 [docs/AI-PROVIDER.md](docs/AI-PROVIDER.md). 모델명·제공자는 설정으로 빼고 **호출부는 모듈마다 한 곳에** 모은다(모델 교체·A/B 비교 대비). 모델을 호출하는 기능은 실행 전 예상 비용을 고지한다(CLAUDE.md §3).
- **관리자 전용 화면은 그리기 전에 `core.requireAdmin(container)`를 통과시킨다.** `false`면 그 즉시 렌더링을 중단한다. 예외는 공개 서베이 응답 폼 하나뿐.
- **실데이터는 repo에 커밋하지 않는다.** 모든 프로젝트 데이터는 Firestore에만 저장한다. `data/seed/sample/`의 가상 샘플 시드만 예외.
- 데이터 출력은 반드시 `core.esc()`를 거친다.
- 관리자 목록은 Firestore `admins` 컬렉션 = 웹 설정 화면에서 관리. OWNER만 `firestore.rules` + `firebase-config.js`에 하드코딩되어 있고, 바꿀 때는 두 곳을 함께 수정한다.
- 버전: `index.html` footer의 `data-app-ver`를 사용자에게 보이는 변경마다 올린다 (major.minor.patch).
