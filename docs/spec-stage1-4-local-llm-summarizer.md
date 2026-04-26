# Spec: Stage 1.4 — Local LLM Chunk Summarizer + Research Agenda

## 배경 / 문제

Stage 1.5에서 Gemini Deep Research에 보내는 프롬프트가 ~14,000 토큰(93KB)에 달한다.
이 중 80%(38,974자)가 `핵심 리포트 요약` 섹션이며, 이로 인해 Gemini가 자주 중단된다.

Stage 1은 현재 **완전히 룰 기반**(LLM 없음)으로 100개 리포트에서 인사이트를 추출한다.
chunks.jsonl에는 1,877개 청크가 있으며 각 청크는 평균 수백 자다.

## 목표

1. **Stage 1.4**: Windows 로컬 Qwen(LM Studio)으로 청크를 저렴하게 요약
2. **Stage 1.4b**: Qwen API(클라우드)로 요약들을 토픽 단위 리서치 어젠다로 클러스터링
3. **Stage 1.5 분할**: Gemini 프롬프트를 3개(매크로 / 섹터·종목 / 신규후보)로 쪼개서
   각각 5,000자 이하로 유지. 리포트 본문 대신 **질문 + 키워드만** 전달

## 환경

- Mac (economy-report 프로젝트): `~/Documents/Playground/economy-report/`
- Windows (같은 로컬 네트워크): LM Studio에서 Qwen 로컬 실행 중
  - API: OpenAI 호환 `http://<WINDOWS_IP>:1234/v1`
  - 모델명: LM Studio에서 로드된 모델명 (런타임에 `/v1/models`로 확인)
  - IP/포트는 `.env`의 `LOCAL_LLM_BASE_URL`에서 읽음 (없으면 `http://localhost:1234/v1`)
- Qwen API (클라우드): `.env`의 `DASHSCOPE_API_KEY`, base_url `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`

## 새로 만들 파일

### 1. `scripts/collectors/summarize-report-chunks.py`

**역할**: Stage 1 청크 → 로컬 LLM 요약

**입력**
- `data/analysis-state/{date}/chunk-index/chunks.jsonl` (1,877개 청크)
- `data/analysis-state/{date}/stage1-report-extracts-v2.json` (100개 추출 인사이트, 우선순위 스코어 포함)

**동작**
1. stage1 추출 인사이트에서 `priority_score` 상위 30개 리포트 ID 선별
2. 해당 리포트의 청크만 필터링 (전체 1,877개 중 ~200~300개)
3. 로컬 LLM에 청크 배치 전송 (concurrency 4~8)
   - system: "You are a financial research summarizer. Summarize in Korean."
   - user: `[리포트명 / 브로커] {chunk.text}` → 150자 이내 핵심만
4. 리포트별로 청크 요약 병합 (리포트당 최대 400자)

**출력**: `data/analysis-state/{date}/stage1-chunk-summaries.json`
```json
{
  "date": "2026-04-20",
  "model": "qwen...",
  "source": "local_llm",
  "summaries": [
    {
      "report_id": "report_001",
      "title": "...",
      "broker": "...",
      "sector": "...",
      "summary": "150자 이내 핵심 요약",
      "priority_score": 88
    }
  ]
}
```

**CLI**
```bash
.venv/bin/python scripts/collectors/summarize-report-chunks.py --date 2026-04-20
.venv/bin/python scripts/collectors/summarize-report-chunks.py --date 2026-04-20 --top-n 30 --concurrency 6
```

**에러 처리**
- LOCAL_LLM_BASE_URL 미설정 또는 연결 실패 시 명확한 에러 메시지 출력 후 종료
- 개별 청크 요약 실패 시 해당 청크 스킵, 로그 출력 후 계속 진행

---

### 2. `scripts/build-stage1-4-research-agenda.py` (또는 .js)

**역할**: 요약들을 Qwen API(클라우드)로 토픽 클러스터링 → 리서치 어젠다 생성

**입력**
- `data/analysis-state/{date}/stage1-chunk-summaries.json`
- `data/analysis-state/{date}/stage1-report-extracts-v2.json` (sentiment, themes 등 메타)
- `data/portfolio/latest.json` (보유 종목 컨텍스트)

**동작**
1. 요약 30개를 Qwen API에 전송 (총 ~12,000자 → 압축되어 있으므로 저렴)
2. 프롬프트 지시:
   - 5~7개 토픽으로 클러스터링
   - 토픽 타입: `macro` / `sector` / `security` / `new_candidate`
   - 각 토픽 출력: label, type, summary(200자), questions(3개), keywords(5개), priority(1~100)
3. JSON 검증 후 저장

**출력**: `data/analysis-state/{date}/stage1-research-agenda.json`
```json
{
  "date": "2026-04-20",
  "model": "qwen3.5-397b-a17b",
  "topics": [
    {
      "label": "AI 전력 인프라",
      "type": "sector",
      "summary": "데이터센터 전력 수요 급증으로 변압기·전선 수주잔고 확대...",
      "questions": [
        "북미 데이터센터 전력망 투자 2026 업데이트와 국내 수혜 기업 현황은?",
        "변압기 리드타임 현황과 LS Electric·현대일렉트릭 수주잔고 추이는?",
        "FERC/IRA 전력 인프라 예산 집행 현황과 한국 기업 수출 비중은?"
      ],
      "keywords": ["LS Electric", "변압기", "데이터센터", "전력망", "AI 인프라"],
      "priority": 96,
      "accountKeys": ["ISA", "KIS_MAIN"]
    }
  ]
}
```

**CLI**
```bash
.venv/bin/python scripts/build-stage1-4-research-agenda.py --date 2026-04-20
node scripts/build-stage1-4-research-agenda.js --date 2026-04-20
```

---

### 3. `scripts/build-stage1-5-gemini-deep-research-prompt.js` 수정

**현재 문제**: `핵심 리포트 요약` 섹션이 38,974자

**수정 내용**
- `stage1-research-agenda.json`이 존재하면 해당 데이터 기반으로 프롬프트 생성
- `stage1-research-agenda.json`이 없으면 기존 로직 폴백 (하위 호환)
- 프롬프트를 3개 파일로 분할 출력:

| 파일 | 토픽 타입 | 목표 크기 |
|------|----------|----------|
| `07a-stage1-5-macro-prompt.md` | `macro` 토픽 | ~4,000자 |
| `07b-stage1-5-sector-prompt.md` | `sector` + `security` 토픽 | ~5,000자 |
| `07c-stage1-5-newcandidate-prompt.md` | `new_candidate` 토픽 | ~4,000자 |

**각 프롬프트 구조**
```
[역할] 너는 EcoReport의 딥리서치 파트너다.
[날짜] {date}
[목적] {macro/sector/신규후보} 집중 조사
[포트폴리오 컨텍스트] (간략, 500자 이내)
[StockEasy 시그널] (해당 섹터만, 500자 이내)

## 조사 요청 토픽

### {토픽명}
배경: {summary}
질문1: ...
질문2: ...
질문3: ...
핵심 키워드: ...

[출력 형식]
- 각 토픽마다 현황 / 계좌 번역 / No-Go 조건 / 체크포인트 작성
```

---

## package.json 추가 스크립트

```json
"stage1.4:summarize": ".venv/bin/python scripts/collectors/summarize-report-chunks.py",
"stage1.4:agenda": ".venv/bin/python scripts/build-stage1-4-research-agenda.py",
"stage1.5:prompt:a": "node scripts/build-stage1-5-gemini-deep-research-prompt.js --part macro",
"stage1.5:prompt:b": "node scripts/build-stage1-5-gemini-deep-research-prompt.js --part sector",
"stage1.5:prompt:c": "node scripts/build-stage1-5-gemini-deep-research-prompt.js --part newcandidate"
```

## .env 추가 항목

```env
# Windows LM Studio 로컬 LLM
LOCAL_LLM_BASE_URL=http://192.168.0.xxx:1234/v1
# 모델명 미지정 시 /v1/models에서 첫 번째 모델 자동 선택
LOCAL_LLM_MODEL=
```

## 전체 파이프라인 흐름 (수정 후)

```
Stage 0    chunk-index 빌드
Stage 1    룰 기반 인사이트 추출 (100개)
Stage 1.4a summarize-report-chunks.py  ← Windows 로컬 Qwen (비용 0)
             청크 1,877개 중 상위 30개 리포트 ~200청크 요약
Stage 1.4b build-stage1-4-research-agenda.py  ← Qwen API (소량)
             30개 요약 → 5~7개 토픽 + 질문 3개씩 클러스터링
Stage 1.5a/b/c  분할 Gemini 프롬프트 생성 (각 5,000자 이하)
             → 수동으로 Gemini에 붙여넣기 (3번)
Stage 1.6  Rich Briefing (Qwen API, 기존)
Stage 1.7  Follow-up map + 2차 프롬프트 (기존)
Stage 1.8  Final refinement map + 3차 프롬프트 (기존)
Stage 2    Qwen 전략 생성 (기존)
Stage 2.5  KIS ETF 매칭 (신규)
Stage 3~4  정량 스코어링 + 실행 계획 (기존)
```

## 구현 우선순위

1. `summarize-report-chunks.py` — Windows LLM 연결 + 청크 요약
2. `build-stage1-4-research-agenda.py` — Qwen API 클러스터링
3. `build-stage1-5-gemini-deep-research-prompt.js` 수정 — 분할 프롬프트

## 운영 방법론 (담당 분리)

| 단계 | 담당 | 역할 |
|------|------|------|
| Stage 1.4a | 맥미니 + 로컬 LLM(LM Studio) | 맥미니가 청크 선별/병합, 로컬 LLM이 청크 요약 |
| Stage 1.4b | 맥미니 + Qwen API | 맥미니가 입력 구성/검증, Qwen이 토픽 클러스터링 |
| Stage 1.5 (a/b/c) | 맥미니 | 토픽 타입별 프롬프트 분할 생성 |
| Deep Research 실행 | Gemini + 사용자 | `07a/07b/07c`를 순차로 붙여넣어 실행 |
| Stage 1.6+ | 맥미니 + Qwen | 기존 브리핑/전략/정량 파이프라인 실행 |

## 실행 방식 (실전 커맨드)

```bash
# 1) Stage 1.4a: 로컬 LLM 청크 요약 (실패 시 에러 종료)
npm run stage1.4:summarize -- --date 2026-04-22 --top-n 30 --concurrency 6

# 2) Stage 1.4b: Qwen API 어젠다 생성
#    (stage1-chunk-summaries.json 없으면 stage1 extracts 폴백)
npm run stage1.4:agenda -- --date 2026-04-22

# 3) Stage 1.5: 분할 프롬프트 생성
npm run stage1.5:prompt:a -- --date 2026-04-22
npm run stage1.5:prompt:b -- --date 2026-04-22
npm run stage1.5:prompt:c -- --date 2026-04-22

# 또는 한 번에 생성 (07a/07b/07c + legacy 07 파일)
npm run stage1.5:prompt -- --date 2026-04-22
```

## 산출물 체크리스트

- `data/analysis-state/{date}/stage1-chunk-summaries.json`
- `data/analysis-state/{date}/stage1-research-agenda.json`
- `knowledge/daily/manual-kit/{date}/07a-stage1-5-macro-prompt.md`
- `knowledge/daily/manual-kit/{date}/07b-stage1-5-sector-prompt.md`
- `knowledge/daily/manual-kit/{date}/07c-stage1-5-newcandidate-prompt.md`
- `knowledge/daily/manual-kit/{date}/07-stage1-5-gemini-deep-research-prompt.md` (하위 호환 복사본)

## 주의사항

- Windows LM Studio IP는 하드코딩 금지. 반드시 `.env`의 `LOCAL_LLM_BASE_URL`에서 읽을 것
- 로컬 LLM 연결 실패 시 Stage 1.4a를 건너뛰고 Stage 1.4b에서 기존 stage1 extracts를 직접 사용하는 폴백 구현
- 프롬프트 분할(a/b/c)은 `stage1-research-agenda.json` 없을 때도 토픽 타입 추론으로 동작해야 함
- 기존 `07-stage1-5-gemini-deep-research-prompt.md` 파일명은 하위 호환을 위해 `07a`의 심링크 또는 사본으로 유지
