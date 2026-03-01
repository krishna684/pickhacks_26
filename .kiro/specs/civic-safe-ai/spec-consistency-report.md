# CivicSafe AI Spec Consistency Report

Date: 2026-03-01  
Scope: Cross-check between `.kiro/specs/civic-safe-ai/requirements.md` and `.kiro/specs/civic-safe-ai/design.md`

## Executive Summary

- Overall alignment is strong: all 15 requirements are represented in the design, and the correctness properties provide direct requirement traceability.
- Main issues are not absence of coverage, but **spec precision** and **implementation realism**.
- Priority fixes: remove/justify route model mismatch (`BALANCED` route type), tighten non-testable acceptance criteria, and add operational controls for uptime/security/compliance claims.

## Coverage Matrix (Requirement -> Design -> Status)

| Req | Requirement Title | Primary Design Coverage | Status | Notes |
|---|---|---|---|---|
| R1 | Safe Route Calculation | Safe Router Service, Property 1 | Covered | Good functional coverage; route scoring and segment model present. |
| R2 | AI-Powered Route Explanations | Safe Router + Gemini, Property 2 | Partial | “Clear language” and <=3s response are not fully operationalized in design tests/SLOs. |
| R3 | Crowdsourced Safety Data Collection | UI Components, Property 3, Cache strategy | Partial | 2-tap UX and 5-minute update target not tied to explicit instrumentation/monitoring. |
| R4 | Complaint Submission and Classification | Complaint Triage Engine, Complaint model, Property 4/5 | Covered | Complete input/capture/triage structure present. |
| R5 | AI-Powered Complaint Triage | Triage pipeline, Property 5/6/7 | Covered | Confidence threshold and manual review flow are represented. |
| R6 | Operator Dashboard and Management | Operator dashboard section, Property 8-11 | Covered | Sorting, detail view, assignment, hotspot visibility covered. |
| R7 | Daily AI Safety Summaries | Property 12, Operator UI summary reports | Partial | Delivery SLA (8:00 AM local) missing scheduling/job design details. |
| R8 | Safety Impact Simulation | Safety Simulator interfaces, Property 13 | Covered | Infrastructure toggles and recalculation path represented. |
| R9 | What-If Analysis Tools | Scenario interfaces, Property 14 | Covered | Save/compare/rank/export/feasibility are specified. |
| R10 | Auth and Role Management | Auth0 in architecture, User model, Property 15 | Partial | 8-hour inactivity timeout and audit log control details are underspecified. |
| R11 | Real-Time Data Processing | Cache/refresh strategy, Property 16 | Partial | 99.5% uptime and 10k concurrency are stated, but no capacity/SLO implementation plan. |
| R12 | Data Integration and API Management | API/export properties 17-20 | Partial | Daily imports/webhook contract and schema governance need concrete interface contracts. |
| R13 | Mobile App Performance | Mobile app UI notes, Property 21 | Partial | 3s load, <50MB storage, <5% battery/hr lack measurable test harness definitions. |
| R14 | Data Privacy and Security | Security testing, Property 22/23 | Partial | GDPR + deletion/export process exists conceptually; data lifecycle and DSR workflow details missing. |
| R15 | Accessibility and Inclusivity | Accessibility section, Property 24 | Partial | WCAG testing present, but explicit conformance evidence criteria not defined. |

## Cross-Spec Mismatches

1. Route type mismatch
   - Requirements define user choice between fastest and safest.
   - Design `RouteType` includes `BALANCED`.
   - Risk: ambiguous product behavior, inconsistent UI and tests.

2. Architecture maturity mismatch
   - Design assumes production microservices and full cloud scaling.
   - Current project structure appears MVP-oriented (single app + server entrypoint).
   - Risk: planning and implementation drift, unrealistic delivery expectations.

3. Testability gap for qualitative criteria
   - Phrases such as “clear language”, “authenticity via reputation”, and “without performance degradation” need quantifiable thresholds.
   - Risk: acceptance ambiguity and disputed completion status.

## Testability Findings

### Well-Testable Areas
- Route generation completeness and score bounds.
- Complaint classification enums/confidence ranges.
- Operator sort and state transitions.
- Scenario save/compare/rank behaviors.

### Weakly-Testable Areas (Need measurable criteria)
- Language clarity in AI responses.
- Privacy compliance claims (GDPR-local policy mapping).
- Mobile battery/storage performance constraints.
- Uptime/concurrency commitments without SLO instrumentation definition.

## Recommended Spec Edits (High Priority)

1. Resolve route model drift (R1)
   - Option A (simplest): remove `BALANCED` from design route model.
   - Option B: add requirement and acceptance criteria for balanced route behavior.

2. Add non-functional verification appendix
   - Define explicit SLOs/SLIs for latency, uptime, and throughput.
   - Include measurement method, environment, and pass/fail thresholds.

3. Formalize compliance controls (R14)
   - Add data retention schedule, deletion workflow stages, and audit events.
   - Map GDPR-related controls to specific system components.

4. Formalize operational jobs (R7, R12)
   - Add scheduler design for daily summaries and daily external imports.
   - Define retry, idempotency, and failure alert behavior.

5. Accessibility conformance evidence (R15)
   - Add required evidence artifacts (axe reports, manual screen reader scripts, defect thresholds).

## Suggested Requirement Wording Tightening

- Replace “clear, non-technical language” with a measurable readability target and review process.
- Replace “validate report authenticity using location verification and user reputation scoring” with explicit validation checks and thresholds.
- Replace “without performance degradation” with percentile latency/error targets at 10,000 active users.

## Proposed Next Actions

1. Update requirements to resolve `BALANCED` ambiguity.
2. Add a “Non-Functional Requirements Verification” section to design.
3. Create a traceability table artifact (R1-R15 -> Property IDs -> Test files) once implementation begins.

---

If needed, this report can be converted into direct patch edits for both source files (`requirements.md` and `design.md`) in a follow-up step.
