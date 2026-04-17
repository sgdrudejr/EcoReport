# EcoReport Impact Mapping 요청

날짜: 2026-04-10

---

## 내 현재 보유 계좌/종목

### ISA (ISA)
- 360750 TIGER 미국S&P500 (보유 20주)
- 458760 TIGER 미국배당다우존스스타데일리커... (보유 50주)

### 연금저축 (PENSION)
- 423160 KODEX KOFR금리액티브(합성) (보유 2주)
- 133690 TIGER 미국나스닥100 (보유 3주)
- 360750 TIGER 미국S&P500 (보유 20주)

### 토스증권 (TOSS)
- 434730 HANARO 원자력iSelect (보유 7주 (+0.11%))
- 251350 KODEX 선진국ESG액티브 (보유 15주 (-0.31%))
- 449450 PLUS V K생산 (보유 5주 (-0.60%))

### 한투 일반 (KIS_MAIN)
- 047810 한국항공우주 (보유 5주 (-0.29%))
- 064350 현대로템 (보유 1주 (+0.96%))
- 138910 KODEX 구리선물(H) (보유 58주 (+3.36%))
- 434730 HANARO 원자력iSelect (보유 2주 (+8.78%))
- 449450 PLUS K방산 (보유 7주 (+1.85%))

---

## 오늘 분석 요약

### EcoReport Quant 분석 스냅샷 (2026-04-10)
- 레짐: BULL
- 종합 스코어: 70.0/100
- 주요 종목 신호:
  - 133690 TIGER 미국나스닥100: HOLD (score: 62)
  - 138910 KODEX 구리선물(H): WATCH (score: 48)
  - 251350 KODEX 선진국ESG액티브: REDUCE (score: 39)
  - 360750 TIGER 미국S&P500: HOLD (score: 60)
  - 423160 KODEX KOFR금리액티브(합성): HOLD (score: 60)
  - 434730 HANARO 원자력iSelect: HOLD (score: 67)
  - 449450 PLUS K방산: HOLD (score: 69)
  - 458760 TIGER 미국배당다우존스스타데일리커...: HOLD (score: 64)
  - 047810 한국항공우주: BUY (score: 73)
  - 064350 현대로템: HOLD (score: 66)

---

### 오늘의 종합 브리핑 요약

# EcoReport Automation Cycle (2026-04-10)
- overallStatus: **warn**
- sameDayStatus: **incomplete**
- runDate: 2026-04-10
- effectiveMarketDate: 2026-04-10
- previousTradingDate: 2026-04-09
- runId: 2026-04-10-000045
- resolutionReason: today
- generatedAt: 2026-04-10T00:01:44.773Z
- logFile: /Users/seo/Documents/Playground/economy-report/logs/2026-04-10-000045-automation-cycle.log
- systemHealth: warn
- changeSummary: 전일(2026-04-09) 대비, 포트폴리오 점수 66→65, 레짐 SIDEWAYS 유지, 리포트 69→69건, 신규 포커스 TIGER 미국배당다우존스스타데일리커...·한국항공우주, 제외 PLUS K방산·TIGER 미국배당다우존스타겟커버드콜2호
## Completion Checklist
- [x] Baseline Daily System
- [x] Stage 1 Extracts
- [ ] Gemini Deep Research Web (warn)
- [x] Stage 1.6 Rich Briefing Overlay
- [x] Strategy Refresh After Deep Research
- [x] LLM Wiki Rebuild After First Synthesis
- [x] Stage 1.7 Follow-up Research Map
- [x] Stage 1.7 Gemini Follow-up Prompt
- [ ] Gemini Deep Research Follow-up Web (warn)
- [x] Stage 1.6 Rich Briefing Final
- [x] Strategy Refresh After Follow-up Research
- [x] LLM Wiki Rebuild After Round 2
- [x] Stage 1.8 Final Refinement Map
- [x] Stage 1.8 Gemini Final Refinement Prompt
- [ ] Gemini Deep Research Round 3 Web (warn)
- [x] Stage 1.6 Rich Briefing Final After Round 3
- [x] Strategy Refresh After Round 3
- [x] LLM Wiki Rebuild Final
- [ ] LLM Wiki Publish (warn)
- [x] Verify Outputs
- [ ] Push Data Branch (warn)
## Step Results
- [OK] Baseline Daily System (31s)
  - command: bash scripts/run-daily-system.sh --date 2026-04-10 --run-date 2026-04-10 --effective-market-date 2026-04-10 --run-id 2026-04-10-000045 --gemini-stage2 --skip-push --skip-verify --skip-strategy --skip-wiki --no-gemini-briefing
  - tail: 🧭 전략 파이프라인 건너뜀 (--skip-strategy) | 📚 LLM Wiki 단계 건너뜀 (--skip-wiki) | 📤 GitHub 동기화 건너뜀 (--skip-push) | 🩺 시스템 검증 건너뜀 (--skip-verify) | ⚠️ 소프트 실패 1건이 있었지만 파이프라인은 계속 완료했습니다. | ================================================== | ✅ EcoReport Daily System 종료 (run: 2026-04-10 / effective: 2026-04-10) | ==================================================
- [OK] Stage 1 Extracts (1s)
  - command: node scripts/build-stage1-report-extracts.js --date 2026-04-10 --run-date 2026-04-10 --effective-market-date 2026-04-10 --run-id 2026-04-10-000045
  - tail: /Users/seo/Documents/Playground/economy-report/data/analysis-state/2026-04-10/stage1-report-extracts-v2.json
- [WARN] Gemini Deep Research Web (0s)
  - command: npm run stage1.5:gemini:run -- --date 2026-04-10 --poll-sec 30 --timeout-sec 1800
  - reason: Gemini Deep Research Web 실패 (exit 1)
  - tail: end tell |   end if |   delay 1 |   return URL of front document | end tell | 2026-04-10 09:01:18.167 osascript[88240:11547033] Error received in message reply handler: Connection invalid | 2026-04-10 09:01:18.167 osascript[88240:11547036] Connection Invalid error for service com.apple.hiservices-xpcservice. | 186:197: syntax error: 속성은(는) 이 식별자 뒤에 올 수 없습니다. (-2740)
  - debug: Safari가 잠겨 있지 않은지, Gemini 로그인 상태인지, Deep Research 도구가 노출되는지 확인하세요.
- [OK] Stage 1.6 Rich Briefing Overlay (
...(이하 생략)

---

### 머니토링 실시간 시황/이벤트 레이어
- 머니토링 12건 중 포트폴리오 직결 0건, 계좌 테마 연결 7건, 관심종목 연결 6건, 딥리서치 후보 5건을 추렸습니다.
- [100점] 외국인·기관, 2026년 4월 증시 상위 20종목 순매수 집중 / 계좌 테마 기준으로는 ISA의 미국인덱스, 연금저축의 현금파킹, 연금저축의 나스닥100 판단과 맞물립니다. 핵심 시그널은 중동/유가입니다.
- [81점] LS·SK증권, 효성중공업 목표주가 상향하며 매수 유지 / 계좌 테마 기준으로는 토스증권의 방산, 한투 일반의 방산 판단과 맞물립니다. 핵심 시그널은 방산/국방입니다.
- [77점] 앤스로픽·코어위브, AI 인프라 임대 계약 체결 / 계좌 테마 기준으로는 ISA의 미국인덱스, 연금저축의 나스닥100, 연금저축의 S&P500 판단과 맞물립니다. 핵심 시그널은 AI 인프라/전력입니다.
- [75점] 2025년부터 미국 AI 인프라 전력 부족 지속 전망 / 계좌 테마 기준으로는 ISA의 미국인덱스, 연금저축의 나스닥100, 연금저축의 S&P500 판단과 맞물립니다. 핵심 시그널은 AI 인프라/전력입니다.
- [63점] CoreWeave, Meta와 210억 달러 AI 클라우드 공급 계약 / 계좌 테마 기준으로는 ISA의 미국인덱스, 연금저축의 나스닥100, 연금저축의 S&P500 판단과 맞물립니다. 핵심 시그널은 AI 인프라/전력입니다.
- 딥리서치 후보
  - 외국인·기관, 2026년 4월 증시 상위 20종목 순매수 집중 / 질문: 중동/유가 이슈가 단기 헤드라인인지, 실제 공급 차질과 가격 전이로 이어지는지 확인하세요.
  - LS·SK증권, 효성중공업 목표주가 상향하며 매수 유지 / 질문: 방산 수요 확대가 실제 수주 공시와 마진 개선으로 연결되는지 확인하세요.
  - 앤스로픽·코어위브, AI 인프라 임대 계약 체결 / 질문: AI 인프라 뉴스가 실제 수주·실적과 ETF 편입 종목 모멘텀으로 이어지는지 검증하세요.

---

## 요청

위 리포트/분석 내용이 내 보유 종목/계좌에 어떤 영향을 주는지
아래 JSON 형식으로만 출력하세요.

보유 종목이 없는 계좌는 현금 배치 관점에서 분석해주세요.
관련 없는 경우 impacts 배열을 비워두세요.

```json
[
  {
    "reportId": "report_001",
    "title": "리포트 제목 또는 주제",
    "impacts": [
      {
        "targetType": "holding|cash|account",
        "targetCode": "종목코드 또는 계좌키(ISA/TOSS/PENSION/KIS_MAIN)",
        "accountKey": "ISA|TOSS|PENSION|KIS_MAIN",
        "direction": "positive|negative|neutral",
        "horizon": "1d|1w|1m|3m|6m",
        "strength": 0.0,
        "reason": "영향 이유 (2줄 이내)"
      }
    ]
  }
]
```

반드시 유효한 JSON 배열만 출력하세요. 설명 텍스트 없이 JSON만.
