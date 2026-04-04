# EcoReport Stage 2 Strategy Exploration

오늘 날짜는 2026-04-05 입니다.
당신은 내 포트폴리오를 실제로 운용하는 전략 탐색 LLM입니다.
아래 Stage 1 연구 노트, 계좌 상태, 기술점수를 바탕으로 새로운 투자 전략 옵션을 설계하세요.
일반론보다 실제 운용 가능한 계좌별 대안을 제시하세요.

## 내 현재 계좌
- ISA(ISA): 평가 8,384,240원 / 예수금 6,277,490원 / 보유 KODEX KOFR금리액티브(합성)(423160) 4주, TIGER 미국배당+7%프리미엄다우존스(458760) 50주, TIGER코리아TOP10(2921050) 20주
- 연금저축(PENSION): 평가 1,512,270원 / 예수금 5,565,201원 / 보유 KODEX 골드선물(H)(132030) 2주, TIGER 미국나스닥100(133690) 3주, TIGER 미국S&P500(360750) 20주
- 토스증권(TOSS): 평가 1,298,790원 / 예수금 3,009,844원 / 보유 HANARO 원자력iSelect(434730) 7주, KODEX AI전력핵심설비(487240) 15주, PLUS K방산(449450) 5주

## 시장/섹터 브리핑
- rich briefing 없음

## 직접 관련 리포트 연구 노트
[]

## 매크로/전략 리포트 연구 노트
[]

## 기술점수 스냅샷
{
  "market_context": {
    "index": "KOSPI",
    "signal": "NEUTRAL",
    "vix": null,
    "score": 43,
    "close": 5377.3,
    "ma": {
      "ma5": 5283.962,
      "ma20": 5502.285,
      "ma60": 5317.8267,
      "ma120": 4658.6131
    },
    "rsi": 48.24,
    "alerts": []
  },
  "relevant_scores": [
    {
      "code": "423160",
      "name": "KODEX KOFR금리액티브(합성)",
      "score": 12,
      "signal": "SELL",
      "signal_reason": "주가가 20일선 아래에 위치, 중기 추세는 약세, MACD 모멘텀이 둔화",
      "rsi": 43.52,
      "bollinger_position": "lower_half"
    },
    {
      "code": "458760",
      "name": "TIGER 미국배당다우존스타겟커버드콜2호",
      "score": 76,
      "signal": "BUY",
      "signal_reason": "주가가 20일선 위에서 유지 중, 중기 추세는 우상향, MACD 모멘텀이 둔화",
      "rsi": 53.98,
      "bollinger_position": "upper_half"
    },
    {
      "code": "132030",
      "name": "KODEX 골드선물(H)",
      "score": 24,
      "signal": "REDUCE",
      "signal_reason": "주가가 20일선 아래에 위치, 중기 추세는 약세, MACD 모멘텀이 둔화",
      "rsi": 46.07,
      "bollinger_position": "lower_half"
    },
    {
      "code": "133690",
      "name": "TIGER 미국나스닥100",
      "score": 17,
      "signal": "SELL",
      "signal_reason": "주가가 20일선 아래에 위치, 중기 추세는 약세, MACD 모멘텀이 둔화",
      "rsi": 49.14,
      "bollinger_position": "lower_half"
    },
    {
      "code": "360750",
      "name": "TIGER 미국S&P500",
      "score": 70,
      "signal": "BUY",
      "signal_reason": "주가가 20일선 위에서 유지 중, 중기 추세는 약세, MACD 모멘텀이 우호적",
      "rsi": 49.54,
      "bollinger_position": "upper_half"
    },
    {
      "code": "434730",
      "name": "HANARO 원자력iSelect",
      "score": 43,
      "signal": "HOLD",
      "signal_reason": "주가가 20일선 아래에 위치, 중기 추세는 우상향, MACD 모멘텀이 둔화",
      "rsi": 47.43,
      "bollinger_position": "lower_half"
    },
    {
      "code": "487240",
      "name": "KODEX AI전력핵심설비",
      "score": 43,
      "signal": "HOLD",
      "signal_reason": "주가가 20일선 아래에 위치, 중기 추세는 우상향, MACD 모멘텀이 둔화",
      "rsi": 48.83,
      "bollinger_position": "lower_half"
    },
    {
      "code": "449450",
      "name": "PLUS K방산",
      "score": 60,
      "signal": "BUY",
      "signal_reason": "주가가 20일선 위에서 유지 중, 중기 추세는 우상향, MACD 모멘텀이 둔화",
      "rsi": 57.11,
      "bollinger_position": "upper_half"
    }
  ]
}

## 출력 요구사항
반드시 유효한 JSON으로만 답하세요.
문장은 짧게, 각 문자열은 1~2문장 이내로 유지하세요.
strategy_changes는 최대 4개, candidate_scores는 최대 8개까지만 반환하세요.
buy_candidates / trim_candidates / hold_candidates는 각 계좌당 최대 3개까지만 반환하세요.

{
  "date": "2026-04-05",
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
      "account_key": "ISA|PENSION|TOSS",
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
        "PENSION"
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
