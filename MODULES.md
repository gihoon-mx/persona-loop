# 모듈 레지스트리

한 세션 = 한 모듈 원칙 (now-here 방식). 모듈 단위로 작업·업데이트하고, 완료 시 WORKLOG.md 갱신을 커밋에 포함한다.

| ID | 모듈 | 경로 | 설명 | 상태 |
|----|------|------|------|------|
| M01 | site | `index.html` | 프로젝트 목록/생성 + 프로젝트 홈 (모듈 진입점) | ✅ v0.2 |
| M02 | core | `packages/core/` | 스키마·데이터 API (Firebase/static 이중 모드)·공용 스타일 | ✅ v0.2 |
| M03 | survey-results | `apps/survey/` | 서베이 결과 대시보드 (실시간 집계 + 커밋된 집계) | ✅ v0.2 |
| M04 | survey-studio | `apps/survey/` | 서베이 생성·CSV 임포트·공개 응답 폼 (코칭 기능은 예정) | 🔶 코칭 예정 |
| M05 | persona-builder | `agents/persona-builder/` | 서베이 응답 → 페르소나 생성 (Claude API) | 예정 |
| M06 | persona-app | `apps/persona/` | 페르소나 카드 뷰 + 근거(evidence) 상세 | ✅ v0.2 (뷰어) |
| M07 | demo-reviewer | `agents/demo-reviewer/` | Playwright + Claude로 데모 사용 + 리뷰 생성 | 예정 |
| M08 | review-app | `apps/review/` | 타입별 리뷰 뷰어 + 세션 리플레이 | ✅ v0.2 (뷰어) |
| M09 | infra | `.github/workflows/`, Firebase 설정 | 배포·Agent 실행 파이프라인 | 🔶 Pages 완료, Firebase 대기 |

## 규칙
- 스키마 변경은 반드시 M02(`packages/core/schemas/`)에서 먼저 — 앱과 에이전트는 스키마를 따른다.
- `data/projects/<id>/`에는 익명화·집계된 데이터만 커밋 (원본은 Firebase).
- 버전: `index.html` footer의 `data-app-ver`를 사용자에게 보이는 변경마다 올린다 (major.minor.patch).
