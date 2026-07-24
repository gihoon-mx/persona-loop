# WORKLOG

멀티 세션 작업의 단일 상태 소스. 세션 시작 시 먼저 읽고, 작업 후 갱신해 커밋에 포함할 것.

## 2026-07-25 — v0.3.0: 비공개 기본 (private by default)
- **전 화면 로그인 게이트**: 모든 앱이 `core.requireAdmin(container)`를 통과해야 렌더된다. 비로그인 → 로그인 안내, allowlist 밖 → "접근 권한이 없습니다". 유일한 예외는 공개 응답 폼
- **Firestore 단일 저장소로 이전**: `data/projects/` 삭제, 정적 JSON 폴백 경로 제거. repo에 남는 데이터는 가상 시드 `data/seed/sample/` 뿐 (설정 화면의 "샘플 데이터 불러오기"로 Firestore에 적재)
- **관리자 웹 관리**: 설정 화면에서 Firestore `admins` 컬렉션에 관리자 추가·삭제 (코드 수정·재배포 불필요). OWNER는 `firestore.rules`에 하드코딩 — allowlist가 비어도 잠기지 않고, 추가·삭제 권한은 OWNER 전용(권한 상승 체인 차단)
- **공개 응답 폼 분리**: 서베이 문서에는 aggregates(주관식 응답 원문)가 들어 있어 문서째로 공개하면 응답이 새어나간다 → 폼 렌더링에 필요한 필드만 복사한 `projects/{pid}/public-forms/{sid}` 문서를 따로 두고, 서베이 문서는 전부 admin 전용으로 잠금 (`syncPublicForm`이 status 변화에 맞춰 생성·삭제)
- **익명 응답 create 형태 검증**: rules의 `isValidResponse()`가 필드 구성(`answers`/`submittedAt`/`source`/`respondent`)·`source=='live'`·`respondent==null`·`submittedAt==request.time`을 강제 (필드 위조·대량 쓰기 남용 차단)
- **demoUrl 스킴 검증** (`http://`·`https://`만 허용), **서베이 id 중복 방지** (`createSurvey` — merge 저장이 기존 서베이를 조용히 덮어쓰던 문제), **응답 수 서버 집계** (`countResponses` — 응답 문서를 내려받지 않고 카운트)
- 문서 갱신: ARCHITECTURE.md(공개 범위·다이어그램), docs/FIREBASE-SETUP.md, 스키마 description, 에이전트 README의 출력 경로

### 다음 할 일
- [ ] **사용자**: Firebase 콘솔에서 `firestore.rules` v0.3 내용 **재게시** (커밋만으로는 적용되지 않는다 — 안 하면 예전 공개 읽기 규칙이 그대로 살아 있다)
- [ ] **사용자**: now-here 서베이 원본(40문항 × 35명) CSV 확보 → 사이트에서 프로젝트 생성 + CSV 임포트
- [ ] M04 서베이 코칭(문항 생성·personaDimension 커버리지 진단 — Claude API, 비용 고지 필요)
- [ ] M05/M07 에이전트의 Firestore 쓰기 경로 — Firebase 서비스 계정(Admin SDK) 키를 Actions Secrets에 등록하고 Admin SDK로 쓰도록 구현 (ARCHITECTURE.md §7). 그 전까지는 로컬 실행 + 웹 입력

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
- [x] **사용자**: Firebase 프로젝트 생성 (docs/FIREBASE-SETUP.md) → web config 전달 → `firebase-config.js` 반영
- 나머지 항목은 위 v0.3 "다음 할 일"로 이관 (repo에 집계 JSON 커밋 항목은 v0.3에서 불가능해져 폐기)
