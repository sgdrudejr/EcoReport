# Stage 2 LLM Provider 구성

## Canonical Provider: Gemini

Stage 2 전략 탐색의 기본(디폴트) provider는 **Gemini**입니다.

### 폴백 체인 (우선순위)

```
Gemini (gemini-2.5-flash) → Mock (휴리스틱)
```

| Provider | 스크립트 | 언어 | API Key |
|----------|----------|------|---------|
| Gemini | `build-stage2-strategy-gemini.py` | Python | `GEMINI_API_KEY` (.env) |
| Mock | `build-stage2-strategy-mock.js` | Node.js | 불필요 |

### 명시적 provider 지정

```bash
bash scripts/run-strategy-pipeline.sh --date 2026-04-10                  # 기본: Gemini → Mock
bash scripts/run-strategy-pipeline.sh --date 2026-04-10 --gemini-stage2  # Gemini only (+ mock fallback)
bash scripts/run-strategy-pipeline.sh --date 2026-04-10 --mock-stage2    # Mock only (테스트용)
bash scripts/run-strategy-pipeline.sh --date 2026-04-10 --gemini-stage2 --strict-gemini-stage2  # Gemini only, 실패 시 파이프라인 중단
```

### 왜 Gemini가 기본인가

- Gemini API 키가 이미 설정되어 있고 무료 Flash 모델 사용 가능
- 350KB 규모의 Stage 2 프롬프트를 안정적으로 처리
- 2026-04-06~10 5일 연속 테스트에서 실패 0건

---

## stage2-run-log.json 필드 명세

매 파이프라인 실행 시 `data/analysis-state/{DATE}/stage2-run-log.json`이 생성됩니다.

### 필드 정의

| 필드 | 타입 | 설명 |
|------|------|------|
| `date` | string | 기준 거래일 (YYYY-MM-DD) |
| `runId` | string | 파이프라인 실행 ID (`{run_date}-{HHMMSS}`) |
| `timestamp` | string | 로그 기록 시각 (UTC, ISO 8601) |
| `finalProvider` | string | 최종 사용된 provider. `"gemini"` \| `"mock"` |
| `finalStatus` | string | `"success"` = 1순위 provider 성공, `"fallback"` = 폴백 발동, `"explicit_mock"` = --mock-stage2 플래그 사용 |
| `totalElapsedSec` | number | Stage 2 전체 소요 시간 (초). 모든 시도 합산 |
| `attempts` | array | 시도 기록 배열 (시간 순) |

### attempts[] 각 항목

| 필드 | 타입 | 설명 |
|------|------|------|
| `provider` | string | 시도한 provider 이름 |
| `status` | string | `"success"` \| `"failed"` |
| `elapsed_sec` | number | 해당 시도 소요 시간 (초) |
| `error` | string \| null | 실패 시 에러 메시지 전문. 성공 시 `null` |

### 예시: 정상 실행

```json
{
  "date": "2026-04-09",
  "runId": "2026-04-11-103107",
  "timestamp": "2026-04-11T10:31:45Z",
  "finalProvider": "gemini",
  "finalStatus": "success",
  "totalElapsedSec": 37,
  "attempts": [
    { "provider": "gemini", "status": "success", "elapsed_sec": 37, "error": null }
  ]
}
```

### 예시: 폴백 발동

```json
{
  "date": "2026-04-09",
  "runId": "2026-04-11-103154",
  "timestamp": "2026-04-11T10:31:57Z",
  "finalProvider": "mock",
  "finalStatus": "fallback",
  "totalElapsedSec": 2,
  "attempts": [
    { "provider": "gemini", "status": "failed", "elapsed_sec": 1, "error": "API key not valid..." },
    { "provider": "mock", "status": "success", "elapsed_sec": 0, "error": null }
  ]
}
```

### 활용 방법

- **일간 점검**: `finalStatus`가 `"fallback"`인 날짜를 찾아 원인 파악
- **성능 추적**: `totalElapsedSec` 추이로 API 응답 속도 모니터링
- **장애 분석**: `attempts[].error`에서 rate limit, timeout 등 패턴 식별
