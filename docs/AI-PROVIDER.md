# AI 모델 제공자 — Gemini on Agent Platform

이 프로젝트의 AI 기능(persona-builder, demo-reviewer, 서베이 코칭)은
**Google Cloud의 Gemini Enterprise Agent Platform**(구 Vertex AI)에서 **Gemini 모델**로 돌린다.

> 2026-07-25 결정. 초기 설계는 Anthropic Claude API를 전제했으나 아래 이유로 변경됐다.

---

## 1. 왜 Gemini · 왜 Agent Platform인가

사용자가 Google Cloud 체험 크레딧을 보유하고 있고(**만료 2026-09-30**), 이 크레딧을 AI 비용에 쓰려면
**경로가 정확히 하나뿐**이기 때문이다.

Google Cloud 공식 문서 [Free Google Cloud features and trial offer](https://docs.cloud.google.com/free/docs/free-cloud-features)의
"크레딧을 쓸 수 없는 경우" 목록 원문:

> "You can't access or use the $300 credit for a generative AI partner model that is offered as a managed API,
> which is also known as model as a service."

> "The $300 credit can't pay for Gemini API in AI Studio costs."

| 경로 | 크레딧 적용 | 근거 |
|------|------------|------|
| Anthropic Claude 직접 API | ❌ | Google Cloud와 무관한 별도 청구 |
| **Agent Platform의 Claude** | ❌ | Google이 Claude를 "partner model = MaaS = managed API"로 분류 → 위 제외 문구와 단어 단위로 일치 |
| **AI Studio의 Gemini** (`generativelanguage.googleapis.com`) | ❌ | 위 문구에 명시적으로 제외 |
| **Agent Platform의 Gemini** (`aiplatform.googleapis.com`) | ✅ | 제외 목록 어디에도 없음 (자사 모델) |

즉 **Claude를 Agent Platform으로 우회 호출해도 크레딧은 줄지 않는다.** 코드만 바뀌고 절감은 0이다.

## 2. Vertex AI → Agent Platform 이름 변경

**Vertex AI는 사라지지 않았다. 이름이 바뀌었다.**

- 새 이름: **Gemini Enterprise Agent Platform** (문서·요금표에서는 "Agent Platform")
- **API 엔드포인트 `aiplatform.googleapis.com` 그대로** (2026-07-25 확인: 인증 없이 호출 시 `401 UNAUTHENTICATED` — API 정상 동작)
- 문서·요금 페이지 URL도 `cloud.google.com/vertex-ai/...` 유지
- 콘솔에서는 "Vertex AI"가 아니라 **"Agent Platform"** 으로 검색할 것
- API 활성화: `gcloud services enable aiplatform.googleapis.com`

## 3. SDK — `google-genai` 하나로 두 경로

```python
from google import genai

# 크레딧 적용 O — Agent Platform
client = genai.Client(enterprise=True, project="<GCP_PROJECT_ID>", location="global")

# 크레딧 적용 X — AI Studio (무료 등급 있음)
client = genai.Client(api_key="...")
```

환경변수로도 전환된다: `GOOGLE_GENAI_USE_ENTERPRISE=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`.

- ⚠️ 예전 예제의 **`vertexai=True`는 현재 `enterprise=True`** 로 바뀌었다. 옛 코드를 복사하면 여기서 막힌다.
- **이 플래그가 곧 과금 경계다.** 개발·디버깅은 AI Studio 무료 등급으로 하고,
  실제 페르소나 생성·데모 리뷰 세션만 `enterprise=True`로 돌리면 크레딧을 필요한 곳에만 쓴다.
- 인증은 API 키가 아니라 GCP ADC: `gcloud auth application-default login`

## 4. 모델 선택

| 용도 | 모델 | 단가 (입력/출력, 100만 토큰) |
|------|------|------------------------------|
| **demo-reviewer** (스크린샷 멀티턴) | Gemini 2.5 Flash | $0.30 / $2.50 |
| 더 높은 품질이 필요하면 | Gemini 3 Flash Preview | $0.50 / $3.00 |
| **persona-builder** (텍스트·배치) | 위 모델의 **배치 모드** | 표준가의 **50%** |

- **이미지 입력이 텍스트와 같은 단가다.** 스크린샷에 프리미엄이 없어 demo-reviewer에 유리하다
  (Claude는 고해상도 이미지가 비용을 지배했다).
- **`location="global"` 을 쓸 것.** 2026-07-01부터 non-global 엔드포인트에 **+10%** 가산이 붙는다.
- 서울(`asia-northeast3`)에서 쓸 수 있는 Gemini는 2.5 Flash뿐이다. 데이터 레지던시 요구가 없으면 global이 정답.
- 단가 출처: <https://cloud.google.com/vertex-ai/generative-ai/pricing>

## 5. 비용 감각

크레딧을 세션 수로 환산하면(세션당 20턴·스크린샷 포함 가정) **2.5 Flash 기준 1,000세션 이상**이다.
Claude Opus 5($5/$25) 대비 입력 1/16·출력 1/10 수준이라 비용 압박이 크게 줄었다.

**크레딧 소진을 목표로 삼지 말 것.** 태우려고 불필요한 세션을 돌리면 실질 가치가 0이다.
어차피 할 개발·테스트를 크레딧 적용 경로로 옮겨 **실지출을 아끼는 것**이 목표다.

또한 Firestore·Cloud Run·Cloud Storage는 무료 등급이 이 프로젝트 규모보다 훨씬 커서
(월 $1 미만) 인프라로는 크레딧이 거의 줄지 않는다. 크레딧은 사실상 **LLM 토큰 전용**이다.

## 6. 아직 검증되지 않은 것 (실행 전 반드시 확인)

1. **크레딧이 실제로 차감되는지** — 문서 해석은 위와 같지만 돈이 걸린 일이다.
   소액 호출을 한 번 날린 뒤 결제 콘솔의 크레딧 잔액이 줄었는지 **눈으로 확인**할 것.
2. **모델 쿼터** — 신규·업그레이드 프로젝트에서 생성형 모델 쿼터가 0으로 잠기고 자동 증액 요청이
   거절되는 사례가 다수 보고됐다(Claude 기준 확인, Gemini는 미확인). 0이면 지원 티켓이 필요하고
   수일~수십일이 걸릴 수 있다 — **크레딧 만료가 가까우므로 가장 먼저 확인할 것.**
3. **스크린샷의 토큰 환산율** — Gemini의 이미지 타일링 규칙을 확인하지 못했다. 세션 단가 추정의 정확도가 여기 달려 있다.
4. 크레딧 잔액은 **가입일로부터 원래의 90일 기간 안에** 소진해야 한다(유료 계정 업그레이드 후에도 동일).

## 7. 구현 규칙

- 모델 호출부는 **한 곳으로 모으고 모델명·제공자를 설정으로 뺀다.** 나중에 모델을 바꾸거나
  품질 비교(A/B)를 할 때 코드를 고치지 않기 위해서다.
- 실행 전 **예상 비용 고지**는 계속 유효하다 (CLAUDE.md §3). 단가가 낮아졌다고 고지를 생략하지 않는다.
- 세션 로그의 `costUsd`에 실제 사용량 기반 비용을 기록한다.
- API 키·서비스 계정 키는 **repo에 두지 않는다.** 로컬 실행은 ADC, Actions는 Secrets.
