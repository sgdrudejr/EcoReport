# StockPilot Docs Set

StockPilot 문서 4종 세트의 진입점입니다.

가장 먼저 볼 문서:

1. [stockpilot_master_playbook.md](stockpilot_master_playbook.md)
2. [stockpilot_agent_brief.md](stockpilot_agent_brief.md)
3. [stockpilot_data_spec.md](stockpilot_data_spec.md)
4. [stockpilot_v1_gap_analysis.md](stockpilot_v1_gap_analysis.md)

문서 역할:

- `stockpilot_master_playbook.md`
  - v1.0 -> v2.0까지의 전체 실행 계획
  - Task 목표, 산출물, 에이전트 프롬프트, Gate Review 포함
- `stockpilot_agent_brief.md`
  - 퀀트 스코어링 에이전트가 따라야 할 결정론적 수식 사양
- `stockpilot_data_spec.md`
  - 데이터 원천, 스키마, 적재 계층, 갱신 주기 설계
- `stockpilot_v1_gap_analysis.md`
  - v1.0 공백과 우선순위별 개선 로드맵

운영 원칙:

- 수식의 소스 오브 트루스는 `stockpilot_agent_brief.md`
- 데이터 계약의 소스 오브 트루스는 `stockpilot_data_spec.md`
- 실행 순서와 우선순위의 소스 오브 트루스는 `stockpilot_master_playbook.md`
- 왜 이런 태스크가 필요한지의 근거는 `stockpilot_v1_gap_analysis.md`
