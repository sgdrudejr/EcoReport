# EcoReport Stage 2 Strategy Exploration

실행일은 2026-04-09, 기준 거래일은 2026-04-09 입니다.
오늘 날짜는 2026-04-09 입니다.
당신은 내 포트폴리오를 실제로 운용하는 전략 탐색 LLM입니다.
아래 Stage 1 연구 노트, 계좌 상태, 기술점수를 바탕으로 새로운 투자 전략 옵션을 설계하세요.
일반론보다 실제 운용 가능한 계좌별 대안을 제시하세요.

## 내 현재 계좌
- ISA(ISA): 평가 8,384,240원 / 예수금 6,277,490원 / 보유 TIGER 미국S&P500(360750) 20주, TIGER 미국배당다우존스스타데일리커...(458760) 50주
- 연금저축(PENSION): 평가 1,512,270원 / 예수금 1,515,100원 / 보유 KODEX KOFR금리액티브(합성)(423160) 2주, TIGER 미국나스닥100(133690) 3주, TIGER 미국S&P500(360750) 20주
- 토스증권(TOSS): 평가 1,297,665원 / 예수금 1,000,945원 / 보유 HANARO 원자력iSelect(434730) 7주, KODEX 선진국ESG액티브(251350) 15주, PLUS V K생산(449450) 5주
- 한투 일반(KIS_MAIN): 평가 3,037,064원 / 예수금 2,653,714원 / 보유 KODEX 구리선물(H)(138910) 58주, HANARO 원자력iSelect(434730) 2주, PLUS K방산(449450) 3주

## 시장/섹터 브리핑
- rich briefing 없음

## 직접 관련 리포트 연구 노트
[]

## 매크로/전략 리포트 연구 노트
[]

## 기술점수 스냅샷
{
  "market_context": {},
  "relevant_scores": []
}

## 출력 요구사항
반드시 유효한 JSON으로만 답하세요.
문장은 짧게, 각 문자열은 1~2문장 이내로 유지하세요.
strategy_changes는 최대 4개, candidate_scores는 최대 8개까지만 반환하세요.
buy_candidates / trim_candidates / hold_candidates는 각 계좌당 최대 3개까지만 반환하세요.

{
  "date": "2026-04-09",
  "macro_view": {
    "regime": "BULL|SIDEWAYS|BEAR|HIGH_VOL",
    "confidence": "HIGH|MEDIUM|LOW",
    "summary": "시장 레짐 요약"
  },
  "strategy_changes": [
    {
      "theme": "예: AI 인프라",
      "direction": "reinforce|reduce|watch",
      "why_now": "왜 지금 중요한지",
      "source_reports": [
        "report_012"
      ]
    }
  ],
  "account_actions": [
    {
      "account_key": "ISA|PENSION|TOSS|KIS_MAIN",
      "bias": "aggressive_add|selective_add|hold|defensive",
      "rationale": "계좌 운용 핵심 논리",
      "buy_candidates": [
        "360750"
      ],
      "trim_candidates": [
        "132030"
      ],
      "hold_candidates": [
        "458760"
      ],
      "reserve_cash_note": "현금 운영 원칙"
    }
  ],
  "candidate_scores": [
    {
      "code": "360750",
      "name": "TIGER 미국S&P500",
      "stance": "buy|hold|trim|watch",
      "target_accounts": [
        "ISA"
      ],
      "horizon": "1m|3m|6m",
      "confidence": "HIGH|MEDIUM|LOW",
      "thesis": "핵심 투자 논리",
      "risks": [
        "위험요인"
      ]
    }
  ],
  "portfolio_risks": [
    "핵심 위험 1",
    "핵심 위험 2"
  ]
}
