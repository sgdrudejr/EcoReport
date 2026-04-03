이 증권사 리포트를 EcoReport용 깊은 리포트 추출 스키마 v2로 정리하세요.
의견과 사실을 명확히 구분하고, 단순 요약보다 "내 포트폴리오에 어떤 의미가 있는지"를 우선하세요.

{
  "schema_version": 2,
  "report_type": "stock|industry|macro|theme|strategy",
  "broker": "증권사명",
  "title": "리포트 제목",
  "date": "YYYY-MM-DD",
  "sector": "반도체|전력기기|방산|원자력|2차전지|바이오|금융|소비재|매크로|기타",
  "tickers": ["005930"],
  "related_holdings_in_my_portfolio": ["360750"],
  "related_accounts": ["ISA", "PENSION"],
  "opinion": "BUY|HOLD|SELL|OVERWEIGHT|UNDERWEIGHT|NEUTRAL",
  "target_price": {"005930": 320000},
  "target_change": "상향|유지|하향|신규|없음",
  "key_thesis": "핵심 주장 1줄",
  "key_points": ["핵심 포인트1", "핵심 포인트2", "핵심 포인트3"],
  "key_numbers": [
    {
      "label": "중요 수치 이름",
      "value": "수치",
      "why_it_matters": "왜 중요한지"
    }
  ],
  "what_changed": "이전 컨센서스나 기존 논리 대비 바뀐 점. 없으면 null",
  "bull_case": ["상방 논리1", "상방 논리2"],
  "bear_case": ["하방 논리1", "하방 논리2"],
  "catalysts": ["촉매1", "촉매2"],
  "risks": ["리스크1", "리스크2"],
  "new_info": "새로운 사실이나 수치. 없으면 null",
  "themes": ["온디바이스AI", "HBM4"],
  "theme_stage": "초기|성장|성숙|과열",
  "thesis_novelty": "HIGH|MED|LOW",
  "sentiment_score": 0.7,
  "supply_chain": ["관련 밸류체인 키워드"],
  "portfolio_impacts": [
    {
      "target_type": "holding|account|theme",
      "target_code": "360750",
      "target_name": "TIGER 미국S&P500",
      "account_key": "PENSION",
      "direction": "positive|negative|mixed|neutral",
      "horizon": "1w|1m|3m|6m",
      "strength": 0.65,
      "reason": "내 포트폴리오 관점 영향 이유",
      "action_hint": "보강|보류|감축|관찰"
    }
  ],
  "time_horizon_summary": {
    "1w": "1주 관점 요약",
    "1m": "1개월 관점 요약",
    "3m": "3개월 관점 요약",
    "6m": "6개월 관점 요약"
  },
  "confidence": "HIGH|MEDIUM|LOW",
  "evidence_notes": [
    "근거 문장 또는 숫자 요약 1",
    "근거 문장 또는 숫자 요약 2"
  ]
}

반드시 유효한 JSON 객체만 출력하세요.
다른 텍스트, 설명, 마크다운 코드펜스를 포함하지 마세요.
