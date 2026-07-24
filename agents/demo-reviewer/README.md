# demo-reviewer (M07)

페르소나 Agent가 데모 서비스를 실제 브라우저(Playwright)로 사용하고 리뷰를 작성.

## 흐름
1. 페르소나 로드 → 목표 시나리오·환경(viewport/네트워크/geolocation) 설정
2. 데모를 `?agent=1`(agent bridge)로 열고, [스크린샷 → Claude가 페르소나로서 다음 행동 결정 → Playwright 실행] 루프
3. 스텝별 [스크린샷 + 행동 + 속마음] 기록 → Firestore `projects/<pid>/sessions/{id}` (session.schema.json)
4. 세션 로그를 근거로 리뷰 생성 → Firestore `projects/<pid>/reviews/{id}` (review.schema.json, 타입별 포맷)

> v0.3부터 산출물은 repo가 아니라 Firestore에 저장된다. Actions에서 쓰려면 Firebase 서비스 계정(Admin SDK) 키를 Secrets에 등록해야 한다 (ARCHITECTURE.md §7 — 아직 미구현). 대안: 로컬 실행 후 웹 화면에서 입력.

## 스크린샷
- 세션 로그의 `screenshot`은 **`http(s)://` 절대 URL만** 뷰어에 표시된다. repo 상대경로(구 `data/projects/…`)는 더 이상 존재하지 않으므로 "스크린샷 없음"으로 처리된다.
- 따라서 스크린샷을 남기려면 **Firebase Storage 등 외부 저장소에 업로드하고 그 URL을 기록**해야 한다 (향후 과제 — 현재 미구현).

## agent bridge (데모 서비스 쪽 요구사항)
- `?agent=1` 진입 시: 주요 UI에 `data-testid` 노출, geolocation mock 허용, 애니메이션 축소
- now-here는 직접 만든 앱이므로 이 모듈을 now-here repo에 추가하는 작업이 선행됨

## 비용
세션당 대략 $0.5~2 (스텝 수·모델에 따라). 실행 전 항상 고지, 세션 로그에 `costUsd` 기록.
