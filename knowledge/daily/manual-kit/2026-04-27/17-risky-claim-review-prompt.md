# 2026-04-27 Risky Claim Mini Review Prompt

너는 EcoReport 품질 검수자다. 전체 리포트를 다시 요약하지 말고, 아래에 자동으로 표시된 위험 claim만 재검토한다.

- run_date: 2026-04-27
- effective_market_date: 2026-04-27
- run_id: 2026-04-27-033354

반환 형식은 JSON만 허용한다.

```json
{
  "date": "2026-04-27",
  "reviews": [
    {
      "id": "claim id",
      "decision": "retain|soften|hold|remove",
      "reason": "짧은 한국어 이유",
      "safer_claim": "soften인 경우만 더 보수적인 표현"
    }
  ]
}
```

## Claims

1. id=claim_001_a12425 / severity=low / reasons=risky_language
claim: 일본 증시, 실적 시즌 진입에 따른 반도체/방산/은행 주도 예상
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

2. id=claim_003_778259 / severity=low / reasons=risky_language
claim: 2 월 M2 증가율 반등은 자금 성격의 구조적 전환을 확인하는 핵심 지표
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

3. id=claim_008_710014 / severity=low / reasons=risky_language
claim: 이란-미국 협상 결렬로 인한 지정학적 불확실성 확대 후 휴전 연장 소식으로 리스크 완화
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

4. id=claim_038_a94afd / severity=high / reasons=thin_evidence, risky_language, hold
claim: LNGC 저선가 물량 비중 감소로 영업이익률 개선 예상 / 유조선 운임 급등 및 신조 수주 단가 상승 수혜 / 중동 정세 변화 및 호르무즈 긴장 지속 / 컨테이너 선대 공급 과잉 (2026F +4.6%, 2027F +7.5%)
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

5. id=claim_048_9aecee / severity=high / reasons=thin_evidence, risky_language, hold
claim: 중동전쟁 휴전 연장 소식으로 지정학적 리스크가 완화되며 미 증시가 상승 마감하고 국내 코스피가 6,400pt를 돌파했다. SK하이닉스와 현대차 등 주요 기업의 1분기 실적 발표 기대감으로 반도체와 전기차 관련주가 강세를 보였으며, 알루미늄 공급 차질 우려로 비철금속 업종이 급등했다.
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

