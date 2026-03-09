# Codebase Assessment - Engineering & Architecture Review

This document provides a comprehensive, professional technical assessment of the Accessorial Recommendation Agent, tailored for engineering leadership and architectural review.

---

## 1. Problem Framing

**What hypotheses are you testing?**
- **H1: Intrinsic Data Predictability:** Shipment attributes provided at creation (e.g., location type, weight, package type) possess sufficient predictive power to identify >80% of missed accessorials organically, without relying on external API augmentations.
- **H2: Deterministic Foundation with AI Augmentation:** A deterministic rules engine can robustly handle the core classification logic, while LLMs provide targeted value in handling edge-case ambiguity and translating complex multi-rule outputs into transparent explanations.
- **H3: Explainability Drives Adoption:** Providing users with clear confidence scores and deterministic reasoning prevents "black-box" rejection and increases the recommendation acceptance rate.

**What signals are predictive?**
The system relies strictly on pre-submission shipment metadata (POC scope):
- **Location & Consignee Typology:** Critical for determining Residential Delivery and Limited Access requirements.
- **Dimensional & Physical Constraints:** Total weight and package configuration (palletized vs. loose).
- **Infrastructural Constraints:** Destination dock availability, which significantly modifies liftgate probability thresholds.
- **Cargo Density:** Number of handling units serving as a multiplier for limited-access probability in specific zoning scenarios.

**What does success look like?**
The definitive North Star metric is the reduction of the **Accessorial Miss Rate** (post-delivery rebilling frequency).
Technical success metrics encompass:
- **Precision (> 85%):** Prioritizing the minimization of false positives to prevent unnecessary shipper expenditure.
- **Recall (> 70%):** Capturing the majority of missed accessorials.
- **System Latency:** Maintaining sub-200ms P95 latency for the rules engine to avoid blocking the shipment creation workflow.

**What tradeoffs did you make?**
**Precision over Recall.** We architected the system to aggressively penalize false positives. A false negative preserves the baseline user experience, whereas a false positive directly erodes profit margins and customer trust. Consequently, ambiguous cases are intentionally downgraded from "Recommendations" to "Advisories," requiring human verification rather than automated application.

---

## 2. Agent Design

**What inputs did you use?**
A structured JSON payload representing standard shipment telemetry: `destination_address`, `consignee_type`, `location_type`, `package_type`, `total_weight_lbs`, `handling_units`, and `dock_available`.

**What architecture did you choose?**
A **Hybrid Deterministic-LLM Architecture**. The system defaults to a high-speed rules engine for exhaustive case evaluation. The LLM (AI Layer) acts as a specialized copilot, invoked exclusively for ambiguity resolution, explanation refinement, and near-threshold advisory generation, rather than primary decision-making.

**When does the agent trigger?**
The LLM component is invoked conditionally under three strict scenarios:
1. **Ambiguity Review:** When the deterministic confidence score falls within the operational gray zone (`0.50 - 0.84`).
2. **Explanation Refinement:** When multiple distinct accessorial rules trigger simultaneously, requiring a consolidated, human-readable rationale.
3. **Advisory Generation:** When no formal rules trigger, but parametric signals (e.g., weight) fall within a 15% margin of a critical threshold.

**When does it NOT trigger?**
The LLM is aggressively skipped when:
- The rules engine yields a high-confidence determination (`>= 0.85`), proceeding directly to output.
- The shipment cleanly circumvents all thresholds (e.g., standard commercial delivery with dock access).
- Required structural fields are excessively sparse, intentionally triggering a "refuse-to-decide" fallback.

**How does it produce confidence?**
Initial confidence intervals are deterministically assigned via the rules engine based on conditional logic matrices. If escalated to the LLM for Ambiguity Review, the AI is constrained by a programmatic guardrail limiting any confidence adjustment to a maximum delta of `±0.10`. Furthermore, the LLM is programmatically forbidden from elevating a score across the automated recommendation threshold (`0.85`), ensuring human-in-the-loop oversight for all borderline evaluations.

---

## 3. Guardrails (Critical)

**Performance**
- **Max Latency:** The rules engine is constrained to `< 50ms`. The LLM layer enforces a strict `15-second` hard timeout via an `AbortController`.
- **Blocking vs. Non-blocking:** The agent operates asynchronously and renders non-blocking UI components. The user's primary workflow (shipment execution) is never impeded by recommendation processing.
- **Timeout Logic:** Upon encountering an LLM timeout, the system executes graceful degradation, immediately surfacing the unaugmented rules engine output and bypassing intelligent refinement.

**Cost**
- **Runaway Usage Prevention:** AI invocation is gated behind deterministic classification. We estimate triggering the LLM on < 30% of aggregate volume. The architecture also enforces hard token limits (max 300 output tokens) and caches system prompts. Production scaling incorporates tenant-level daily spend ceilings ($10 alert / $50 hard stop).
- **Trigger Definition Constraints:** As stated, AI operates exclusively on delineated edge cases, vastly reducing LLM dependency compared to zero-shot pipeline designs.

**Safety**
- **Preventing Hallucinated Suggestions:** The LLM's output parser enforces strict JSON schema validation. The allowed accessorial domain is hardcoded (`liftgate`, `residential_delivery`, `limited_access`). Any deviation or hallucinated configuration is discarded at the parsing layer.
- **Handling Low-Confidence Output:** Outputs below `0.85` are structurally demoted to a UI state of "Review Suggested" (warning tier). Outputs completely degraded below `0.40` are suppressed entirely.
- **Refuse to Decide Formulation:** In conditions of severe data paucity (e.g., unknown consignee, unknown location, omitted weight), the deterministic engine aborts evaluation and prompts the user for necessary field completion rather than extrapolating intent.

---

## 4. Evaluation Framework (Most Important)

**Offline Validation**
- **Test Dataset:** A synthetic, 37-case deterministic dataset encompassing high-frequency scenarios, constrained environments, boundary thresholds, sparse variable matrices, and AI-specific edge cases.
- **Metrics Measurement:** Evaluated via automated continuous integration scripts (`run_eval.mjs`, `run_ai_eval.mjs`) simulating structural inputs and verifying programmatic JSON schema compliance, guardrail enforcement bounds, and expected semantic outputs.
- **Failure Types Observed:** We continuously audit for Rule False Positives (often tracing to ground-truth label desynchronization) and AI Confidence Boundary Violations (e.g., LLM attempting to assign `0.85` instead of `0.84`), which confirmed the robust efficacy of our programmatic caps.

**Online Evaluation Deployment (Phase 2)**
- **A/B Testing Infrastructure:** Rollout entails a traffic split: Control (legacy flow, establishing baseline miss rate) vs. Treatment (Agent UI panel enabled).
- **Leading Metrics:** Recommendation Acceptance Rate (target `> 60%`), User Override Rate (explicit dismissal tracker), and Impact on Shipment Creation Time (workflow friction).
- **Lagging Metrics:** Month-over-month reduction in Invoice Dispute Rates, Accessorial Rebilling Frequency, and Net Margin Impact per shipment cohort.

**Human-in-the-Loop Integration**
- **Override Value Loop:** User rejections populate a direct telemetry database. Monthly actuarial review of override frequencies informs iterative adjustments to rule thresholds (e.g., elevating liftgate thresholds for specific commercial cohorts).
- **Prediction vs. Outcome Reconciliation:** A shadow ledger tracks `[Predicted Variable, Confidence, User Action]`. Post-delivery, this is joined against the `[Carrier Invoice Outcome]` to algorithmically classify True Positives, False Positives, False Negatives, and True Negatives.

---

## 5. Rollout Strategy

**Safe Release Pipeline**
- **Phase 1: Shadow Mode (2-4 Weeks):** Inference runs in production on live telemetry without UI exposure. Predictions are silently logged and reconciled against eventual carrier invoices to validate real-world Precision/Recall drift without exposing the user to alpha-stage UI.
- **Phase 2: Suggest-Only (4-8 Weeks):** Non-blocking UI recommendations deploy for `confidence >= 0.70`. Users must explicitly opt-in to accept suggestions.
- **Phase 3: Auto-Apply:** High-confidence (`>= 0.95`) predictions auto-populate form state, retaining a 1-click revert option.

**Confidence Threshold for Auto-apply**
A strict **`>= 0.95`** programmatic threshold, corroborated by a baseline validation period exhibiting >90% precision at that specific confidence tier.

**Kill Criteria**
- Precision degrades to `< 80%` within any 7-day trailing window.
- User Override Rate organically climbs above `40%`, indicating acute UX degradation, alert fatigue, or model drift.
- Discovery of any automated application resulting in carrier API payload rejection.

**What could go wrong?**
1. **Garbage In, Garbage Out (GIGO):** Willful or accidental misclassification by users (e.g., tagging a residence as "commercial"). *Mitigation:* Shadow mode quantification; future iterations involve USPS/Google Geocoding API pre-validation.
2. **Automation Bias:** Users blindly accepting flawed recommendations, inflating shipper costs. *Mitigation:* Enforcing explanatory transparency and isolating "Advisories" from "Recommendations" visually.
3. **Operational Overload (Rule Stacking):** Shipments manifesting 3+ accessorials inducing alert fatigue. *Mitigation:* UI truncation projecting only the top-2 highest confidence signals.
