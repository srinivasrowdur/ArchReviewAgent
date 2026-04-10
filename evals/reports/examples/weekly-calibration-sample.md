# Weekly Calibration Review

Review date: 2026-04-10

Reviewer: Example reviewer

Input artifacts:

- Release comparison artifact: `evals/reports/release-compare-sample/summary.md`
- Shadow-grading artifact: `evals/reports/production-shadow-grading-sample/summary.md`
- Additional logs or traces: local trace inspection output for `Miro`

## Mandatory Queue Coverage

- Low-scoring runs reviewed: yes
- `unknown` runs reviewed: yes
- Recommendation-changed runs reviewed: yes
- High-latency failures reviewed: yes
- Release-eval failures reviewed: no release failures this week

## Reviewed Items

### Item 1

- Run ID or case ID: `dbx-unknown`
- Source artifact: production shadow-grading summary
- Category: low-score and `unknown`
- Summary: Databricks run landed in `unknown` for EU residency with mixed evidence relevance.
- Reviewer checklist notes:
  - Subject specificity: acceptable
  - Guardrail support: evidence is too thin for a supported verdict
  - Recommendation quality: current recommendation is acceptable but confidence is low
  - Citation relevance: mixed
  - System vs grader diagnosis: grader is directionally correct
- Primary outcome: `dataset_gap`
- Follow-up action: add a curated Databricks case with thin-evidence expectations
- Linked issue or PR: `#15` dataset follow-up

### Item 2

- Run ID or case ID: `miro-new`
- Source artifact: production shadow-grading summary
- Category: recommendation-changed
- Summary: recommendation changed from yellow to green on a cache-hit path.
- Reviewer checklist notes:
  - Subject specificity: acceptable
  - Guardrail support: evidence is relevant but not strong enough for a green recommendation
  - Recommendation quality: optimistic
  - Citation relevance: mixed
  - System vs grader diagnosis: real product concern
- Primary outcome: `product_bug`
- Follow-up action: investigate recommendation optimism in retained-baseline presentation path
- Linked issue or PR: create follow-up issue

## Session Outcomes

- Dataset updates required: 1
- Grader prompt updates required: 0
- Product bugs filed: 1
- Threshold-only tuning: none
- Deferred follow-ups: none

## Sign-Off

- Workflow completed: yes
- Notes for next calibration session: review whether the Databricks dataset addition reduces repeat low-score false alarms
