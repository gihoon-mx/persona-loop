# WORKLOG

멀티 세션 작업의 단일 상태 소스. 세션 시작 시 먼저 읽고, 작업 후 갱신해 커밋에 포함할 것.

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
- [ ] **사용자**: Firebase 프로젝트 생성 (docs/FIREBASE-SETUP.md) → web config 전달 → `firebase-config.js` 반영
- [ ] **사용자**: now-here 서베이 원본(40문항 × 35명) CSV 확보 → 사이트에서 프로젝트 생성 + CSV 임포트
- [ ] 임포트 후 집계 JSON을 `data/projects/<id>/surveys/`에 커밋 (정적 모드에서도 결과 공개)
- [ ] M04 서베이 코칭(문항 생성·personaDimension 커버리지 진단 — Claude API, 비용 고지 필요)
