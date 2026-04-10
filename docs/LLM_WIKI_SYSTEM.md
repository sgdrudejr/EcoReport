# EcoReport LLM Wiki System

## 목표

EcoReport를 단발성 일일 리포트 생성기에서, 시간이 갈수록 수익 판단이 빨라지는 `persistent investment wiki`로 전환합니다.

핵심은 간단합니다.

- 원문/정량 데이터는 `data/`
- 일일 산출물은 `knowledge/daily/`, `reports/daily/`
- 누적 의사결정 메모리는 `knowledge/wiki/`

즉, EcoReport의 Stage 1~4는 하루치 판단 엔진이고, `knowledge/wiki/`는 그 판단을 잊지 않게 하는 기억 계층입니다.

여기에 최근 추가된 레이어는 두 가지입니다.

- `Stage 1.7 follow-up reindex`: 1차 리포트 추출과 전략 산출 이후, 다시 봐야 할 키워드/종목/계좌를 한 번 더 인덱싱하는 레이어
- `wiki memory`: 운영 규칙, research backlog, decision journal을 쌓아 다음 질문에서 같은 실패를 반복하지 않게 하는 레이어

## 왜 이게 돈과 연결되는가

돈을 버는 투자 시스템은 "정보를 많이 읽는 시스템"이 아니라 아래를 반복적으로 잘하는 시스템입니다.

1. 어떤 자산이 실제 자금 배치 우선순위인지 좁히기
2. 왜 그 자산이 유리한지 근거를 유지하기
3. 언제 틀리는지 무효화 조건을 관리하기
4. 나중에 다시 같은 리서치를 반복하지 않기

지금 EcoReport는 1일 단위 실행은 잘합니다.
하지만 장기적으로 가장 가치 있는 판단이 채팅, 프롬프트, 일회성 보고서에 흩어질 위험이 있습니다.

`LLM Wiki` 레이어는 그 손실을 막습니다.

## 위키가 기억해야 하는 것

### 1. Account Playbooks

각 계좌는 "무슨 종목을 들고 있나"보다 "무슨 역할을 해야 하나"가 더 중요합니다.

- ISA: 인컴/헤지/완충
- 연금저축: 장기 미국 코어 복리
- 토스증권: 전술 테마 노출

그래서 계좌 페이지는 현재 보유, 목표 배분, 오늘 행동, 다음 확인 포인트를 계속 누적해야 합니다.

### 2. Security Thesis Pages

종목/ETF 페이지는 단순 설명서가 아니라 투자 thesis 페이지여야 합니다.

각 페이지는 최소한 아래를 담아야 합니다.

- 왜 이 자산이 돈을 벌 수 있는가
- 어떤 계좌와 카테고리에서 이겨야 하는가
- 최근 근거는 무엇인가
- 무엇이 thesis를 무효화하는가
- 지금은 `buy / watch / trim / hold` 중 어디인가

### 3. Daily Decision Logs

매일 나온 Stage 4 실행 계획은 하루 지나면 버려질 것이 아니라, 누적 로그로 남아야 합니다.
그래야 "며칠 전부터 계속 후보에 남는 자산"과 "하루 반짝 후보"를 구분할 수 있습니다.

### 4. Follow-up Research Backlog

하루 실행을 다 돌린 뒤에도 남는 질문이 있습니다.

- 왜 이 종목은 리포트 근거가 아직 얕은가
- 왜 이 계좌는 이 카테고리를 먼저 보강해야 하는가
- 무엇을 더 확인해야 매수/보류 판단을 바꿀 수 있는가

이런 항목은 당일에 사라지지 말고 `research backlog`로 남겨 다음 회차의 재인덱싱과 2차 Deep Research 질문으로 이어져야 합니다.

## 운영 규칙

### 새 리포트가 들어오면

1. Stage 1 extract 생성
2. impact-map으로 계좌/종목 영향 확정
3. Stage 3/4로 점수와 실행안 생성
4. `knowledge/wiki/`로 컴파일
5. 중요한 해석은 보강해서 다시 wiki에 기록
6. 아직 얕은 토픽은 follow-up reindex와 2차 Deep Research 질문으로 넘김

### 좋은 위키 페이지의 판정 기준

좋은 페이지는 읽고 나서 바로 행동이 줄어들어야 합니다.

- 무엇을 더 읽어야 하는지
- 무엇을 사도 되는지
- 무엇을 아직 사면 안 되는지
- 무엇이 틀리면 바로 접어야 하는지

## 현재 구현

자동 컴파일 스크립트:

```bash
node scripts/build-llm-wiki.js --date YYYY-MM-DD
```

생성/갱신 대상:

- `knowledge/wiki/index.md`
- `knowledge/wiki/log.md`
- `knowledge/wiki/overview.md`
- `knowledge/wiki/daily/YYYY-MM-DD.md`
- `knowledge/wiki/accounts/*.md`
- `knowledge/wiki/securities/*.md`
- `knowledge/wiki/memory/operating-rules.md`
- `knowledge/wiki/memory/research-backlog.md`
- `knowledge/wiki/memory/decision-journal.md`

## 수익화 관점의 실제 활용법

이 위키는 아래 세 가지 질문에 답할 때 가장 유용합니다.

1. 오늘 새 돈을 넣는다면 어느 계좌의 어떤 카테고리에 먼저 넣어야 하나
2. 기존 보유 중 리포트 근거가 약해진 자산은 무엇인가
3. 며칠째 계속 살아남는 고확신 후보는 무엇인가

이 세 질문에 빨리 답할수록, 감정이 아니라 누적 근거로 매수/보류/축소를 결정할 확률이 올라갑니다.
