# Daily Pipeline Runbook
> 이 문서는 **다른 모델/세션이 처음 봐도 전체 파이프라인을 실행할 수 있도록** 작성됩니다.
> 새 기능이 추가될 때마다 반드시 이 문서를 업데이트하세요.
> Last updated: 2026-04-17

---

## 전체 파이프라인 구조

```
[ PHASE 1: 원본 데이터 수집 ]
  1-A. 증권사 리포트 PDF 수집      collect-report-assets.sh
  1-B. KIS 포트폴리오 sync          sync-kis-portfolio.js
  1-C. StockEasy 수집               stockeasy_crawler.py

        ↓

[ PHASE 2: 로컬 LLM 요약 (Windows 192.168.0.218:8080) ]
  2-A. 증권사 리포트 청크 + 요약    run-local-report-orchestrator.sh
  2-B. StockEasy 산업리포트 압축    (stockeasy-context.md 생성, 코드 파싱)

        ↓

[ PHASE 3: Qwen 브리핑 ]
  3.   generate_briefing.py         chunks.jsonl → {date}-briefing.md

        ↓

[ PHASE 4: Gemini 딥리서치 (수동 or Chrome 자동화) ]
  4.   브리핑 + StockEasy + 포트폴리오 → Gemini Deep Research
       → {date}-deepresearch.md 저장

        ↓

[ PHASE 5: 인사이트 도출 ]
  5.   generate_insights.py         딥리서치 + 포트폴리오 → {date}-insights.md
       (portfolio_filter.py 자동 호출 + 검증 루프 + 물결표 정규화)
```

---

## 환경 전제조건

| 항목 | 값 |
|------|-----|
| 프로젝트 루트 | `/Users/seo/Documents/Playground/economy-report` |
| Python venv | `.venv/bin/python3` |
| Qwen API Key | `.env` 파일의 `QWEN_API_KEY` |
| Windows LLM | `http://192.168.0.218:8080/v1` |
| Windows MAC | `A0:AD:9F:CD:47:D2` (Wake-on-LAN용) |
| Windows 모델 | `Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf` |
| 포트폴리오 RAG | `data/portfolio/rag/{date}/merged-portfolio.md` |
| 리포트 청크 | `data/reports/{date}/rag/chunks.jsonl` |
| StockEasy 수집 | `data/stockeasy/{date}/` |
| 인사이트 출력 | `knowledge/daily/{date}-insights.md` |

---

## Phase 1: 원본 데이터 수집

### 1-A. 증권사 리포트 수집
```bash
cd /Users/seo/Documents/Playground/economy-report
bash scripts/collect-report-assets.sh --date 2026-04-17
```
- 네이버증권 + 신한투자증권 크롤링
- PDF 저장: `data/reports/{date}/*.pdf`
- 텍스트 추출: `data/reports/{date}/text/*.txt`
- 실패 시: 전날 데이터(`data/reports/{prev_date}/rag/chunks.jsonl`)로 진행

### 1-B. KIS 포트폴리오 sync
```bash
node scripts/sync-kis-portfolio.js --date 2026-04-17
# → data/portfolio/latest.json (3개 계좌: ISA/연금저축/토스/한투)
```

포트폴리오 RAG 코퍼스 생성:
```bash
node scripts/build-portfolio-rag-corpus.js --date 2026-04-17
# → data/portfolio/rag/2026-04-17/merged-portfolio.md
```

### 1-C. StockEasy 수집
```bash
.venv/bin/python3 scripts/stockeasy_crawler.py --date 2026-04-17
```
수집 항목:
- `sector` — 섹터 신호등/등락률/포지션/이격률/대표종목(RS)
- `briefing` — 당일 브리핑
- `rs` — 종합 RS (섹터별 강도)
- `report` — 기업리포트 (첫 페이지)
- `industry_report` — **산업리포트 전체 페이지** (당일 ~200건, bullet 요약 포함)
- `momentum` — 전략실 1호 보유/이탈/신규인입
- `peak` — 전략실 2호 보유/이탈/신규인입
- `value` — 전략실 3호 보유/이탈/신규인입

출력: `data/stockeasy/{date}/*.json`

**쿠키 인증**: Chrome에 StockEasy 로그인 상태 유지 필요 (browser-cookie3 자동 추출)

---

## Phase 2: 로컬 LLM 요약 (Windows)

### 2-A. Windows 깨우기
```bash
.venv/bin/python3 -c "
from scripts.report_orchestrator.power import wake_windows
r = wake_windows('A0:AD:9F:CD:47:D2')
print(r)
"
# WoL 패킷 전송 → 약 60초 후 LLM 서버 응답
```

연결 확인:
```bash
curl -s --connect-timeout 5 http://192.168.0.218:8080/v1/models
# 또는
.venv/bin/python3 scripts/test_local_llm_connection.py
```

### 2-B. 증권사 리포트 청크 + 요약
```bash
bash scripts/run-local-report-orchestrator.sh --date 2026-04-17
```
- PDF → 텍스트 → 청크(7~9K자) → 청크별 JSON 요약 → 리포트별 병합 → 최종 마켓뷰
- 출력:
  - `reports/chunks/{date}/*.json`
  - `reports/chunk_summaries/{date}/*.json`
  - `reports/report_summaries/{date}/*.json`
  - `reports/merged/final_market_view.md` ← **브리핑에 활용**
  - `reports/merged/by_category/*.json`

옵션:
```bash
# 샘플 1건만
bash scripts/run-local-report-orchestrator.sh --date 2026-04-17 --limit 1

# 딥 모드
bash scripts/run-local-report-orchestrator.sh --date 2026-04-17 --detail deep

# 청크만 생성 (LLM 없이)
bash scripts/run-local-report-orchestrator.sh --date 2026-04-17 --chunks-only
```

### 2-C. StockEasy 컨텍스트 마크다운 생성
```bash
python3 << 'EOF'
# data/stockeasy/{date}/*.json → data/stockeasy/{date}/stockeasy-context.md
# (LLM 불필요 — 코드 파싱으로 구조화)
# 내용: 섹터신호 + RS강도 + 전략실신규인입/이탈 + 산업리포트 섹터별 핵심 요약
EOF
```
※ 현재는 파이프라인 내 인라인으로 처리. 별도 스크립트로 분리 예정.

---

## Phase 3: Qwen 브리핑 생성

```bash
DATE=2026-04-17

.venv/bin/python3 scripts/generate_briefing.py \
  --input data/reports/$DATE/rag/chunks.jsonl \
  --output knowledge/daily/$DATE-briefing.md \
  --model qwen3.5-flash \
  --max-chunks 80 --min-chunks 60 \
  --run-date $DATE --effective-market-date $DATE
```
- 입력: `chunks.jsonl` (593~800개 청크 중 요약 관련 80개 선별)
- 출력: `knowledge/daily/{date}-briefing.md` + `.meta.json`

---

## Phase 4: Gemini 딥리서치

### 딥리서치 프롬프트 생성 + 클립보드 복사
```bash
python3 << 'EOF'
from pathlib import Path
import subprocess

DATE = "2026-04-17"
briefing = Path(f"knowledge/daily/{DATE}-briefing.md").read_text(encoding="utf-8")
stockeasy = Path(f"data/stockeasy/{DATE}/stockeasy-context.md").read_text(encoding="utf-8")
portfolio = Path(f"data/portfolio/rag/{DATE}/merged-portfolio.md").read_text(encoding="utf-8")

prompt = f"""[딥리서치 요청]
...(표준 프롬프트)...

[브리핑]\n{briefing[:8000]}
[StockEasy]\n{stockeasy}
[포트폴리오]\n{portfolio[:6000]}
"""
out = Path(f"knowledge/daily/{DATE}-deepresearch-prompt.md")
out.write_text(prompt, encoding="utf-8")
subprocess.run(["pbcopy"], input=prompt.encode("utf-8"))
print(f"클립보드 복사 완료: {len(prompt):,}자")
EOF
```

### Gemini 실행
1. `gemini.google.com/app` 접속
2. **Deep Research** 선택
3. `Cmd+V` 붙여넣기 → 실행 (~10~15분)
4. 결과 전체 복사 → `knowledge/daily/{date}-deepresearch.md` 저장

---

## Phase 5: 인사이트 도출

```bash
DATE=2026-04-17

.venv/bin/python3 scripts/generate_insights.py \
  --deepresearch knowledge/daily/$DATE-deepresearch.md \
  --portfolio data/portfolio/rag/$DATE/merged-portfolio.md \
  --briefing knowledge/daily/$DATE-briefing.md \
  --output knowledge/daily/$DATE-insights.md \
  --date $DATE \
  --model qwen3.5-flash
```

자동 처리 항목:
- `portfolio_filter.py` 호출 → 브리핑 키워드 기반 관련 보유종목만 필터
- Self-Correction 검증 루프 → 리스크 가이드라인 위반 체크
- 물결표 정규화 → `～∼〜` → `~`
- 출력: `{date}-insights.md` + `.meta.json`

---

## 폴백 전략

| 상황 | 대응 |
|------|------|
| 증권사 리포트 수집 실패 | 전날 `chunks.jsonl` 사용 |
| Windows LLM 응답 없음 | WoL 재시도 → 그래도 안되면 `--provider qwen`으로 Qwen API 대체 |
| Gemini 딥리서치 실패 | Qwen으로 대체: `generate_insights.py --skip-deepresearch` |
| StockEasy 쿠키 만료 | Chrome에서 `stockeasy.intellio.kr` 재로그인 후 재실행 |

---

## 빠른 실행 (전체 자동화 예정)

```bash
cd /Users/seo/Documents/Playground/economy-report
DATE=$(date +%F)

# Phase 1: 수집 (병렬)
bash scripts/collect-report-assets.sh --date $DATE &
node scripts/sync-kis-portfolio.js --date $DATE &
.venv/bin/python3 scripts/stockeasy_crawler.py --date $DATE &
wait

# Phase 1 마무리
node scripts/build-portfolio-rag-corpus.js --date $DATE
node scripts/build-report-rag-corpus.js --date $DATE

# Phase 2: 로컬 LLM
bash scripts/run-local-report-orchestrator.sh --date $DATE

# Phase 3: 브리핑
.venv/bin/python3 scripts/generate_briefing.py \
  --input data/reports/$DATE/rag/chunks.jsonl \
  --output knowledge/daily/$DATE-briefing.md \
  --model qwen3.5-flash --max-chunks 80 --min-chunks 60 \
  --run-date $DATE --effective-market-date $DATE

# Phase 4: Gemini 딥리서치 → 수동 실행
# (knowledge/daily/$DATE-deepresearch-prompt.md 생성 후 클립보드 복사)

# Phase 5: 인사이트
.venv/bin/python3 scripts/generate_insights.py \
  --deepresearch knowledge/daily/$DATE-deepresearch.md \
  --portfolio data/portfolio/rag/$DATE/merged-portfolio.md \
  --briefing knowledge/daily/$DATE-briefing.md \
  --output knowledge/daily/$DATE-insights.md \
  --date $DATE --model qwen3.5-flash
```

---

## 핵심 파일 위치 요약

```
scripts/
  collect-report-assets.sh         증권사 리포트 수집
  sync-kis-portfolio.js             KIS 포트폴리오 sync
  build-portfolio-rag-corpus.js     포트폴리오 RAG 생성
  build-report-rag-corpus.js        리포트 RAG 청크 생성
  stockeasy_crawler.py              StockEasy 전체 수집
  run-local-report-orchestrator.sh  Windows LLM 요약 파이프라인
  generate_briefing.py              Qwen 브리핑 생성
  generate_insights.py              Qwen 인사이트 도출
  portfolio_filter.py               Relevant Chunking
  report_orchestrator/
    config.py                       설정 (엔드포인트/모델/청크 파라미터)
    llm.py                          LLM 클라이언트
    pipeline.py                     메인 파이프라인
    power.py                        Windows Wake-on-LAN / 종료

config/
  local-report-orchestrator.json    Windows LLM 설정
    windows_host: 192.168.0.218
    windows_mac:  A0:AD:9F:CD:47:D2
    base_url:     http://192.168.0.218:8080/v1
    model:        Qwen_Qwen3.5-35B-A3B-IQ2_M.gguf

data/
  reports/{date}/rag/chunks.jsonl   리포트 청크
  portfolio/rag/{date}/merged-portfolio.md
  stockeasy/{date}/                 StockEasy raw JSON
  stockeasy/{date}/stockeasy-context.md  정제된 컨텍스트
  portfolio/latest.json             KIS 최신 잔고

knowledge/daily/
  {date}-briefing.md                Qwen 브리핑
  {date}-deepresearch-prompt.md     Gemini 입력 프롬프트
  {date}-deepresearch.md            Gemini 딥리서치 결과
  {date}-insights.md                최종 인사이트

reports/merged/
  final_market_view.md              로컬 LLM 최종 마켓뷰
  by_category/*.json                카테고리별 요약
```
