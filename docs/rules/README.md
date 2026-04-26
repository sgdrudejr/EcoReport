# EcoReport Rules

이 디렉토리는 EcoReport를 사람이 아니라 에이전트 기준으로 안정적으로 운영하기 위한 규칙 레이어입니다.

역할은 세 가지입니다.

1. 투자 판단의 기본 철학을 고정한다.
2. Stage 1~4 사이의 출력 계약을 명시한다.
3. 자주 실패하는 패턴에 대한 수리 경로를 문서화한다.

권장 읽기 순서:

1. `core-beliefs.md`
2. `stage-contracts.md`
3. `quality-rubric.md`
4. `repair-playbooks.md`
5. `../failure-ledger.json`

운영 명령:

```bash
cd /Users/seo/Documents/Playground/economy-report
npm run verify -- --date YYYY-MM-DD
```

이 검증기는 일일 산출물이 "파일이 있느냐"만이 아니라 "앞 단계 근거가 다음 단계 액션으로 이어졌느냐"를 확인하는 데 목적이 있습니다.
