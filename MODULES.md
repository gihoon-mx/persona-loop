# 모듈 레지스트리

한 세션 = 한 모듈 원칙 (now-here 방식). 모듈 단위로 작업·업데이트하고, 완료 시 WORKLOG.md 갱신을 커밋에 포함한다.

| ID | 모듈 | 경로 | 설명 | 상태 |
|----|------|------|------|------|
| M01 | site | `index.html` | 랜딩 + 공통 셸 (모듈 진입점) | 스캐폴드 |
| M02 | core | `packages/core/` | 데이터 스키마·공용 유틸 | 스캐폴드 |
| M03 | survey-results | `apps/survey/` | 서베이 결과 대시보드 (Phase 1: 기존 응답 임포트 뷰) | 예정 |
| M04 | survey-studio | `apps/survey/` | 서베이 생성·코칭 + 실시간 수집 (Firebase) | 예정 |
| M05 | persona-builder | `agents/persona-builder/` | 서베이 응답 → 페르소나 생성 (Claude API) | 예정 |
| M06 | persona-app | `apps/persona/` | 페르소나 카드 뷰·관리 | 예정 |
| M07 | demo-reviewer | `agents/demo-reviewer/` | Playwright + Claude로 데모 사용 + 리뷰 생성 | 예정 |
| M08 | review-app | `apps/review/` | 리뷰 뷰어 (앱마켓 스타일) + 세션 리플레이 | 예정 |
| M09 | infra | `.github/workflows/`, Firebase 설정 | 배포·Agent 실행 파이프라인 | 스캐폴드 |

## 규칙
- 스키마 변경은 반드시 M02(`packages/core/schemas/`)에서 먼저 — 앱과 에이전트는 스키마를 따른다.
- `data/projects/<id>/`에는 익명화·집계된 데이터만 커밋 (원본은 Firebase).
- 버전: `index.html` footer의 `data-app-ver`를 사용자에게 보이는 변경마다 올린다 (major.minor.patch).
