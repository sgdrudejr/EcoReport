# 2026-04-30 Risky Claim Mini Review Prompt

너는 EcoReport 품질 검수자다. 전체 리포트를 다시 요약하지 말고, 아래에 자동으로 표시된 위험 claim만 재검토한다.

- run_date: 2026-04-30
- effective_market_date: 2026-04-30
- run_id: 2026-04-30-021135

반환 형식은 JSON만 허용한다.

```json
{
  "date": "2026-04-30",
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

1. id=claim_001_ab918b / severity=high / reasons=thin_evidence, risky_language, hold
claim: 반도체 업종의 이익 상향이 KOSPI 상승 모멘텀을 주도하며, 기술적 과열 (RSI 70.9) 에도 상승 지속 가능성 있음
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

2. id=claim_003_44782c / severity=high / reasons=thin_evidence, risky_language, hold
claim: 기관 매수세는 지수 상승을 주도하고 있으나, 외국인 매도 및 미국 빅테크 실적 우려로 인해 기술주 밸류체인 조정 불가피
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

3. id=claim_004_370c89 / severity=high / reasons=thin_evidence, risky_language, hold
claim: 중국의 기술 도약과 고금리 장기화가 글로벌 자동차 및 반도체 산업의 구조적 재편을 가속화할 것
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

4. id=claim_006_00ce00 / severity=low / reasons=single_source_family, risky_language
claim: 정부 주도 정책 (친환경 에너지, 실손보험 개혁, K-ICS) 이 관련 산업의 구조적 전환을 가속화하고 있다.
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

5. id=claim_020_f34baa / severity=low / reasons=single_source_family, risky_language
claim: 게임 및 일부 보험/통신 섹터는 규제 심의 결과와 BSR(브랜드 성장률) 둔화, IoT 회선 감소로 인해 단기적 실적 하방 압력이 구조적 성장 모멘텀보다 우세할 수 있다.
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

6. id=claim_021_a66457 / severity=low / reasons=single_source_family, risky_language
claim: AI 모델 개발 비용 대비 수익성 불확실성과 CSM(-) 조정 지속 가능성은 성장 모멘텀의 질적 저하를 시사한다.
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

7. id=claim_023_46cfd1 / severity=high / reasons=thin_evidence, risky_language, hold
claim: 탄소배출권 시장이 유가 상승과 동조화되며 국내 KOC/i-KOC 가격 차이 확대는 구조적 기회
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

8. id=claim_025_b4f9cd / severity=low / reasons=single_source_family, risky_language
claim: 대우건설 및 한화솔루션은 실적 상회에도 불구하고 선행 주가 반영 또는 수익성 전환 지속성 불확실성으로 인해 매수 타이밍을 신중히 고려해야 함.
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

9. id=claim_028_b2edad / severity=high / reasons=thin_evidence, risky_language, hold
claim: UAE 의 OPEC 탈퇴로 인해 중장기적으로 유가 하방 압력 (재정균형 유가 $49.9/bbl) 이 발생하여 에너지 섹터의 구조적 약세가 예상됨.
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

10. id=claim_030_e98084 / severity=high / reasons=thin_evidence, risky_language, hold
claim: 시장 상단 확장 변수: A) 반도체 이익 상향이 지수 상승을 주도함 / B) 비반도체 업종 확산이 없으면 상승 모멘텀이 제한될 수 있음
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

11. id=claim_039_cbeeb3 / severity=low / reasons=risky_language
claim: BOJ 의 정책 방향성과 금리 인상 시점: A) 6 월 회의에서 추가 금리 인상 가능성이 높아짐 (물가 상방 리스크 및 위원 내 의견 불일치) / B) 4 월 회의에서 금리 동결이 확정되었으며, 6 월 이후 추가 인상 여부는 불확실하나 매파적 해석이 지배적임
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

12. id=claim_041_d50214 / severity=low / reasons=single_source_family, risky_language
claim: 유가 전망 및 에너지 섹터 대응: A) 중동 지정학적 리스크 (호르무즈 해협 봉쇄 등) 로 인해 유가 급등 및 공급 차질 우려가 우세하여 에너지 섹터 수혜 예상 / B) UAE 의 OPEC 탈퇴 및 재정균형 유가 하락으로 인해 중장기 유가 하방 압력이 우세하여 에너지 섹터 약세 예상
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

13. id=claim_044_2c2043 / severity=high / reasons=thin_evidence, risky_language, hold
claim: 2026 년 1 분기 조정 EBIT 43 억달러 (+22%) 달성 / 조정 EPS 3.70 달러 (+33.1%) 로 가이던스 상향 / 2026 년 10 억~15 억달러 규모의 EV 구조조정 후 손익 개선 / 관세 환급금 수령 시점 불확실성
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

14. id=claim_050_ed67ed / severity=high / reasons=thin_evidence, risky_language, hold
claim: 2026~2028 년 총주주환원율 50% 유지로 업종 내 최고 배당 성장성 확보 / 2026 년 1 분기 실적은 컨센서스 부합 및 흑전 전환 예상 / 강력한 주주환원 정책 / 특별배당 지연 가능성 (FCF 및 배당정책 연동 구조)
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

15. id=claim_051_6b0304 / severity=high / reasons=thin_evidence, risky_language, hold
claim: 2025 년 매출 340 억 원 (+29.1%) 성장 / 영업손실 -99 억 원으로 적자 폭 축소 / 정부 디지털 전환 정책 확대 / 영업손실 지속 및 수익성 전환 불확실성
task: 원문 근거 ID만 기준으로 retain|soften|hold|remove 중 하나를 고르고, 1문장 이유를 JSON으로 반환.

