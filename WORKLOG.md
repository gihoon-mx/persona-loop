# WORKLOG

멀티 세션 작업의 단일 상태 소스. 세션 시작 시 먼저 읽고, 작업 후 갱신해 커밋에 포함할 것.

## 2026-07-25 — Phase 0: 스캐폴딩
- repo 생성 (gihoon-mx/persona-loop, public) 및 초기 구조 커밋
- 설계 확정: ARCHITECTURE.md 참고 (Pages+Actions+Firebase 하이브리드, Google 로그인, repo=DB)
- Pages 배포 워크플로우 추가 (`.github/workflows/pages.yml`)
- 데이터 스키마 v0 작성 (`packages/core/schemas/`)
- 첫 프로젝트 `now-here` 등록 (`data/projects/now-here/project.json`)

### 다음 할 일 (Phase 1)
- [ ] 기존 now-here 서베이 원본 데이터 확보 (40문항 × 35명 — 내보내기 형식 확인 필요: Google Forms CSV?)
- [ ] 임포터 작성 → `data/projects/now-here/surveys/`에 정의+집계 커밋
- [ ] `apps/survey/` 결과 대시보드 (읽기 전용, 로그인 불필요 버전부터)
- [ ] Firebase 프로젝트 생성 + Google 로그인 셋업 (사용자 콘솔 작업 필요)
