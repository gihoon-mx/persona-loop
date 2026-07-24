# demo-reviewer (M07)

페르소나 Agent가 데모 서비스를 실제 브라우저(Playwright)로 사용하고 리뷰를 작성.

## 흐름
1. 페르소나 로드 → 목표 시나리오·환경(viewport/네트워크/geolocation) 설정
2. 데모를 `?agent=1`(agent bridge)로 열고, [스크린샷 → Claude가 페르소나로서 다음 행동 결정 → Playwright 실행] 루프
3. 스텝별 [스크린샷 + 행동 + 속마음] 기록 → `data/projects/<id>/sessions/` (session.schema.json)
4. 세션 로그를 근거로 리뷰 생성 → `data/projects/<id>/reviews/` (review.schema.json, 타입별 포맷)

## agent bridge (데모 서비스 쪽 요구사항)
- `?agent=1` 진입 시: 주요 UI에 `data-testid` 노출, geolocation mock 허용, 애니메이션 축소
- now-here는 직접 만든 앱이므로 이 모듈을 now-here repo에 추가하는 작업이 선행됨

## 비용
세션당 대략 $0.5~2 (스텝 수·모델에 따라). 실행 전 항상 고지, 세션 로그에 `costUsd` 기록.
