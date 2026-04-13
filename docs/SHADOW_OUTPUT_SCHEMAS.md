# Shadow Output Schemas

이 문서는 shadow pipeline의 각 단계가 어떤 입력을 읽고 어떤 출력을 남기는지 빠르게 확인하기 위한 계약 문서입니다.

## Stage 0: chunk-index

### 입력

- `data/reports/{date}/index.json`
- `data/reports/{date}/text-manifest.json`
- `data/reports/{date}/text/*.txt`
- `data/portfolio/latest.json`

### 출력

- `data/analysis-state/{date}/chunk-index/chunks.jsonl`
- `data/analysis-state/{date}/chunk-index/stats.json`

### `chunks.jsonl` line schema

```json
{
  "chunk_id": "report_001__c0003",
  "report_id": "report_001",
  "broker": "신한투자증권",
  "title": "효성중공업 목표가 상향",
  "report_date": "2026-04-12",
  "chunk_seq": 3,
  "page_start": null,
  "page_end": null,
  "section_title": "실적 전망",
  "text": "...",
  "core_text": "...",
  "entities": ["005930", "35만원", "WTI", "12%"],
  "keywords": ["목표주가", "수주잔고", "투자의견"],
  "priority_score": 9,
  "chunk_flags": {
    "has_condition": true,
    "has_counterpoint": true,
    "has_target_price": true,
    "has_holding_match": false,
    "is_disclaimer": false
  }
}
```

### `stats.json`

```json
{
  "date": "2026-04-12",
  "report_count": 69,
  "chunk_count": 892,
  "disclaimer_removed_count": 71,
  "avg_chunk_chars": 847.3,
  "stage1_eligible_chunk_count": 234,
  "avg_top_chunks_per_report": 3.4,
  "index_fallback_used": false,
  "warnings": []
}
```

## Stage 1: stage1-shadow-extracts

### 입력

- `data/analysis-state/{date}/chunk-index/chunks.jsonl`
- `data/reports/{date}/index.json`

### 출력

- `data/analysis-state/{date}/stage1-shadow/stage1-shadow-extracts.json`

### schema

```json
{
  "date": "2026-04-10",
  "reportCount": 100,
  "selection": {
    "min_chunks_per_report": 1,
    "max_chunks_per_report": 6,
    "rule": "priority_score >= 5 or has_holding_match == true, excluding disclaimer chunks"
  },
  "quality": {
    "selectedChunkCount": 329,
    "avgSelectedChunksPerReport": 3.29,
    "reportsWithCondition": 83,
    "reportsWithCounterpoint": 84,
    "reportsWithBoth": 27
  },
  "extracts": [
    {
      "report_id": "report_001",
      "title": "....",
      "broker": "....",
      "report_type": "macro",
      "sector": "매크로",
      "themes": ["금리/매크로"],
      "selected_chunks": [],
      "claim": "....",
      "key_numbers": ["35만원", "2.1조"],
      "keep_condition": "....",
      "break_condition": "....",
      "bull_chunk": "....",
      "risk_chunk": "....",
      "quality": {
        "selected_chunk_count": 3,
        "condition_chunk_count": 2,
        "counterpoint_chunk_count": 1,
        "target_price_chunk_count": 1
      }
    }
  ]
}
```

## Stage 2: stage2-shadow-topic-buckets

### 입력

- `data/analysis-state/{date}/stage1-shadow/stage1-shadow-extracts.json`
- `data/portfolio/latest.json`

### 출력

- `data/analysis-state/{date}/stage2-shadow-topic-buckets.json`
- `data/analysis-state/{date}/stage2-shadow-topic-buckets.md`

### schema

```json
{
  "date": "2026-04-10",
  "source": "stage1-shadow",
  "reportCount": 100,
  "cardCount": 76,
  "bucketCount": 16,
  "topBuckets": ["지정학·리스크 레짐", "전력 인프라·원자력"],
  "buckets": [
    {
      "bucket_id": "geopolitics_regime",
      "bucket_label": "지정학·리스크 레짐",
      "description": "...",
      "reportCount": 9,
      "cardCount": 11,
      "commonClaims": ["..."],
      "conflictingClaims": ["..."],
      "keepConditions": ["..."],
      "breakConditions": ["..."],
      "topEvidenceCards": [],
      "topReports": ["..."],
      "matchedHoldings": [],
      "insightLines": ["..."]
    }
  ]
}
```

## Stage 3: stage3-shadow-final-insights

### 입력

- `data/analysis-state/{date}/stage2-shadow-topic-buckets.json`
- `data/analysis-state/{date}/stage3-quant-scores.json`
- `data/portfolio/latest.json`

### 출력

- `data/analysis-state/{date}/stage3-shadow-final-insights.json`
- `data/analysis-state/{date}/stage3-shadow-final-insights.md`

### schema

```json
{
  "date": "2026-04-10",
  "source": "stage2-shadow+stage3-quant",
  "market_regime": {
    "name": "BULL",
    "confidencePct": 63,
    "summary": "..."
  },
  "portfolio_summary": {
    "totalScore": 63,
    "note": "...",
    "accountCount": 4,
    "holdingCount": 10
  },
  "executive_summary": ["..."],
  "top_topics": [
    {
      "bucket_id": "power_grid",
      "bucket_label": "전력 인프라·원자력",
      "stance": "constructive",
      "thesis": "...",
      "keep_watch": "...",
      "risk_watch": "...",
      "decision_note": "조정 시 분할 관심",
      "evidence_note": "...",
      "source_reports": ["..."],
      "summary_lines": ["..."]
    }
  ],
  "secondary_topics": [],
  "portfolio_implications": [],
  "priority_actions": [
    {
      "scope": "전력 인프라·원자력",
      "action_type": "accumulate_on_pullback",
      "action": "조정 시 분할 관심",
      "why_now": "...",
      "evidence_bucket": "power_grid"
    }
  ],
  "watchpoints": ["..."],
  "dashboard_preview": {
    "headline": "...",
    "subhead": "...",
    "bullets": ["..."]
  }
}
```

## 다음 단계 계약

- Stage 4는 Stage 3 shadow의 `priority_actions`, `top_topics`, `dashboard_preview`를 계좌 실행 메모에 보조 입력으로 사용합니다.
- dashboard는 `Cycle Reports`와 `shadow-preview`에서 Stage 3 shadow를 직접 읽습니다.
- 운영 Stage 1~4 기본 계약은 유지하고, shadow는 보조 레이어로 계속 검증합니다.
