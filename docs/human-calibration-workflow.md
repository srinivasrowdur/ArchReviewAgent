# Human Calibration Workflow

This document defines the weekly human calibration loop for release failures and sampled production runs.

It complements:

- [Evaluation Plan](evaluation-plan.md)
- [Production Metrics](production-metrics.md)
- [Production Shadow Grading Runner](../evals/runProductionShadowGrading.ts)

The goal is to keep the evaluation system honest:

- confirm whether low scores reflect real product issues or grader mistakes
- identify dataset gaps
- identify grader-prompt weaknesses
- identify real application bugs

## 1. Cadence

Run this workflow once per week for production shadow-graded runs and after any release-eval run with meaningful failures.

Recommended rhythm:

- release review: on demand when a release comparison or semantic grader flags regressions
- production review: once per week on a sampled batch

## 2. Mandatory Review Queue

Every calibration session must include all of the following categories.

### 2.1 Low-Scoring Shadow-Graded Runs

Review all runs flagged by the shadow grader as low score.

Why:

- they are the highest-signal candidates for real quality problems
- they may expose grader over-sensitivity

### 2.2 All `unknown` Runs

Review every run where any guardrail ended as `unknown`.

Why:

- `unknown` is a high-friction user outcome
- rising `unknown` rates can indicate retrieval drift, source loss, or prompt regression

### 2.3 Recommendation-Changed Runs

Review all runs where the recommendation changed relative to the prior accepted baseline.

Why:

- recommendation changes are product-visible
- they may reflect valid evidence changes or instability in evidence quality

### 2.4 High-Latency Failures

Review failures with unusually high total duration or stage duration.

Why:

- long failures are often harder for users to interpret
- they can indicate retrieval stalls, timeout regressions, or poor fallback behavior

### 2.5 Release-Eval Failures

When a release comparison introduces new failures, review every new failing case before merge.

Why:

- release gating only works if new failures are triaged deliberately

## 3. Inputs for Each Review

For each run or case under review, gather:

- the relevant eval or shadow-grading summary JSON/Markdown artifact
- the final report text
- the stored trace metadata
- the key evidence snippets and URLs
- the grader outputs and flags
- the previous accepted baseline if recommendation drift is involved

## 4. Reviewer Checklist

Apply this checklist to every reviewed item.

### 4.1 Subject and Product Specificity

Check:

- did the report stay anchored to the requested product?
- did it drift to the parent company?
- is the `What this product does` section specific and accurate?

### 4.2 Guardrail Support

Check:

- does the cited evidence actually support the EU residency verdict?
- does the cited evidence actually support the enterprise deployment verdict?
- are any verdicts more optimistic than the evidence allows?

### 4.3 Recommendation Quality

Check:

- is the recommendation justified by the combined guardrail evidence?
- did the recommendation change for a good reason?
- if the recommendation changed, is that change product-visible and explainable?

### 4.4 Citation Relevance

Check:

- are citations on-topic?
- are they vendor-controlled when expected?
- are the findings concrete rather than generic marketing language?

### 4.5 System vs Grader Diagnosis

Decide which bucket the problem belongs to:

- the product output is wrong
- the grader is wrong
- the dataset expectation is wrong
- the evidence is insufficient
- the run is acceptable and should be marked as a false alarm

## 5. Calibration Outcomes

Every reviewed item must end in exactly one primary outcome.

### 5.1 `accepted_false_alarm`

Use when:

- the system output is acceptable
- the grader or threshold was too harsh

Follow-up:

- adjust grader thresholds or expected score ranges
- do not file a product bug

### 5.2 `dataset_gap`

Use when:

- the scenario is real and important
- the current eval dataset does not cover it well enough

Follow-up:

- add or update a deterministic or semantic eval case

### 5.3 `grader_prompt_issue`

Use when:

- the grader consistently misclassifies a valid or invalid pattern

Follow-up:

- update grader instructions
- add a regression case to keep the prompt honest

### 5.4 `product_bug`

Use when:

- the application behavior is genuinely wrong
- the report, routing, cache behavior, source handling, or presentation needs a code fix

Follow-up:

- file or link a GitHub issue
- document the concrete failing run ids or eval case ids

### 5.5 `needs_follow_up`

Use when:

- the evidence is ambiguous
- the reviewer cannot confidently classify the issue in the current session

Follow-up:

- collect more artifacts
- revisit in the next calibration session or convert into a smaller investigation task

## 6. Output Artifact

Use the template at:

- [Weekly Calibration Review Template](../evals/templates/weekly-calibration-review.md)

Store completed reviews under a dated file name, for example:

- `evals/reports/examples/weekly-calibration-2026-04-10.md`

The output artifact must include:

- review date
- reviewer
- input artifact sources
- reviewed run ids or case ids
- mandatory queue coverage
- decision for each reviewed item
- follow-up action required

## 7. Feedback Loop Into the Repo

This workflow only adds value if reviewer findings change the system deliberately.

### 7.1 When to Update the Dataset

Update or add eval cases when:

- a scenario was missing from the dataset
- a reviewer found a new realistic failure mode
- a recommendation drift pattern needs permanent regression coverage

### 7.2 When to Update Grader Prompts

Update grader prompts when:

- the same class of false alarm appears repeatedly
- the grader misses a clearly bad output more than once
- reviewers repeatedly disagree with grader reasoning

### 7.3 When to File a Product Issue

File or link a product issue when:

- retrieval quality regressed
- source filtering or cache behavior is wrong
- recommendation drift is not explainable by evidence
- the presentation layer obscures important distinctions

### 7.4 When to Tune Thresholds Only

Adjust score thresholds or expected ranges when:

- the grader is directionally correct
- the boundary is too strict or too loose
- no product bug exists

## 8. Definition of Done for a Calibration Session

A calibration session is complete when:

- every mandatory queue category was reviewed
- every reviewed item has a primary outcome
- every required follow-up has an owner or linked issue
- the review artifact is saved in a stable location

## 9. Minimal Weekly Workflow

1. Generate or collect the latest shadow-grading report.
2. Pull the mandatory queue:
   - low-score runs
   - unknown runs
   - recommendation-changed runs
   - high-latency failures
3. Open the weekly review template.
4. Review each item with the checklist.
5. Assign one primary outcome per item.
6. Create or link issues for `product_bug` and `needs_follow_up`.
7. Update datasets or grader prompts for `dataset_gap` and `grader_prompt_issue`.
8. Save the completed artifact.
