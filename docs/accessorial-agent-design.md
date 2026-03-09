# Accessorial Recommendation Agent - Design Document

## 1. Problem Framing

### The Problem

LTL shippers frequently miss required accessorials (liftgate, residential delivery, limited access) at shipment creation time. Carriers then invoice these charges after delivery, causing margin erosion, invoice disputes, and poor customer experience. The cost is not just financial: rebilling customers months later damages trust and increases churn.

### Hypotheses

**H1: User-provided shipment fields alone can predict 80%+ of missed accessorials.**
Most missed accessorials follow predictable patterns that are visible at the moment of shipment creation. A user who selects "residential" as consignee type almost always needs residential delivery. A 600 lb loose shipment with no dock almost always needs a liftgate. We don't need external APIs or historical data to catch these. We just need to ask the right questions and apply consistent logic.

**H2: A deterministic rules engine is sufficient for a POC; LLM adds value only as a future enhancement.**
For the three core accessorials (liftgate, residential delivery, limited access), the decision logic is well-understood in the freight industry. A rules engine with the right input fields can demonstrate the value proposition. LLM reasoning becomes valuable later for edge cases and free-text interpretation, but is not required to prove the concept works.

**H3: Users will adopt recommendations if confidence and reasoning are transparent.**
A black-box "add liftgate" suggestion gets ignored. A suggestion that says "Shipment weighs 600 lbs, package type is loose, and no dock is available at destination. Liftgate recommended (confidence: 0.92)" gets accepted. Transparency drives trust.

### Predictive Signals (POC Scope - All From User Input)

These are the signals available in the POC. All come from the shipment creation form. No external API calls, no historical lookups, no NLP.

1. **Consignee / location type** (user-selected dropdown) - directly determines residential delivery and limited access
2. **Total weight** (number input) - primary liftgate signal
3. **Package type** (dropdown: palletized / loose / crated) - modifies liftgate weight threshold
4. **Dock available at destination** (dropdown: yes / no / unknown) - critical liftgate modifier
5. **Number of handling units** (number) - bulk shipments to residential = liftgate signal boost

**Signals deferred to productionization:**
- Address classification via geocoding / USPS API (validate user-reported consignee type)
- Historical invoice data by address (repeat offenders)
- Free-text delivery notes NLP ("gate code", "call before delivery")
- Mixed-use zone classification
- Carrier-specific accessorial rules

### Success Criteria

| Metric | Target | Rationale |
|--------|--------|-----------|
| Precision | > 85% | False positives add unnecessary cost to shippers; must be high |
| Recall | > 70% | Missed recommendations maintain status quo, less harmful than false positives |
| Rules engine coverage | > 90% of test cases | POC should not depend on LLM to function |
| P95 latency | < 200ms | Rules-only engine should be near-instant |

### Key Tradeoff: Precision over Recall

A false positive (recommending liftgate when not needed) directly increases the shipper's cost. A false negative (missing a recommendation) maintains the current experience. We bias toward precision: only recommend when confidence is high. For borderline cases, we surface a lower-confidence suggestion as a "review" prompt rather than a firm recommendation.

---

## 2. Agent Architecture

### Core Principle

> Rules own deterministic recommendations. AI only assists on ambiguous cases by refining explanations, generating advisories, or making limited confidence adjustments under strict guardrails.

### System Flow (Hybrid)

```
Shipment Input (form fields)
     |
     v
[Input Validation] -- missing required fields --> Return error with specific field(s)
     |
     valid
     v
[Rules Engine] -- evaluates all rules, collects matches
     |
     v
[Case Classification]
     |
     +--> All results confidence >= 0.85 (high certainty)
     |      --> Return directly. No AI call.
     |
     +--> Any result confidence 0.5-0.84 (ambiguous zone)
     |      --> Send to AI for Task 1 (Explanation Refinement) + Task 2 (Ambiguity Review)
     |
     +--> No rules fired, but near-threshold or incomplete signals detected
     |      --> Send to AI for Task 3 (Advisory Generation)
     |
     +--> Clean no-trigger (commercial + warehouse + dock + under thresholds)
            --> Return empty. No AI call.
     |
     v
[Output Formatter]
     Recommendations:
       -- confidence >= 0.85 --> "Recommended" (green)
       -- confidence 0.5-0.84 --> "Review suggested" (yellow)
     Advisories:
       -- Near-threshold warnings, verify-dock prompts (blue/gray, separate section)
```

### What AI Does NOT Do

- AI does not re-evaluate whether an accessorial applies from scratch
- AI does not override a high-confidence rules result (up or down)
- AI does not generate formal recommendations in no-rule-fired cases (only advisories)
- AI does not use "common sense" reasoning to flip a case from review to hard recommendation

### AI Task Definitions

#### Task 1: Explanation Refinement

When multiple rules fire on the same shipment, AI combines them into one coherent paragraph instead of returning three separate template sentences.

Input: rules fired, evidence fields, confidence scores
Output: a single natural-language explanation

Example: Rules output residential (0.95) + liftgate (0.92) + limited_access (0.60) separately. AI returns:
> "This shipment is going to a residential destination and weighs 500 lbs with no dock access, so residential delivery and liftgate are strongly recommended. There may also be limited-access constraints due to multiple handling units. Review that item manually."

This is the safest, lowest-risk AI task. It does not change any decision.

#### Task 2: Ambiguity Review

When a rule fires with confidence in the 0.5-0.84 range, AI can make a small adjustment.

Input: mid-confidence rule result, all shipment fields, conflicting/incomplete signals
Output: adjusted confidence (capped at +-0.10 from rules output), supporting rationale

**Hard constraints:**
- Maximum adjustment: +-0.10 from rules engine output
- AI cannot promote a result from "review suggested" to "recommended" (cannot cross the 0.85 boundary)
- AI cannot suppress a result that rules flagged (cannot push below 0.40)
- AI must state what signal drove the adjustment

Example: Rules give liftgate 0.75 (500 lbs palletized, dock unknown). AI sees location_type = "retail_store" and adjusts to 0.82 with rationale: "Retail stores typically lack loading docks. Dock availability should be confirmed, but liftgate is likely needed."

Note: This is still "review suggested" (0.82 < 0.85). AI helped refine the confidence but did not flip the decision.

#### Task 3: Advisory Generation

When no rules fire but the system detects near-threshold or ambiguous signals, AI generates a soft warning. This is NOT a recommendation. It appears in a separate "Advisories" section in the UI.

Input: shipment fields where signals are near thresholds or key context is missing
Output: advisory text, what the user should verify

Trigger conditions:
- Weight within 15% of a liftgate threshold (e.g., 260-299 lbs loose, 425-499 lbs palletized)
- dock = "unknown" on any shipment over 200 lbs
- consignee_type = "unknown" with location_type = "other"

Example: 290 lbs loose, dock = "no", commercial. Rules don't fire (under 300 lbs threshold). AI generates:
> Advisory: "Shipment weight (290 lbs) is close to the liftgate threshold. If additional items are added or weight is approximate, consider adding liftgate."

### Rules Engine - Detailed Logic

#### Liftgate Rules

| Condition | Confidence | Explanation Template |
|-----------|------------|---------------------|
| weight >= 300 lbs AND package_type = "loose" AND dock = "no" | 0.95 | Heavy loose freight ({weight} lbs) with no dock available. Liftgate required. |
| weight >= 300 lbs AND package_type = "loose" AND dock = "unknown" | 0.80 | Heavy loose freight ({weight} lbs) and dock availability not confirmed. Liftgate likely needed. |
| weight >= 500 lbs AND package_type = "palletized" AND dock = "no" | 0.92 | Palletized shipment ({weight} lbs) with no dock. Liftgate required for unloading. |
| weight >= 500 lbs AND package_type = "palletized" AND dock = "unknown" | 0.75 | Palletized shipment ({weight} lbs) and dock not confirmed. Verify dock availability or add liftgate. |
| weight >= 150 lbs AND package_type = "loose" AND dock = "no" AND consignee_type = "residential" | 0.93 | Residential delivery with loose freight ({weight} lbs) and no dock. Liftgate required. |
| weight >= 100 lbs AND consignee_type = "residential" AND dock = "no" | 0.70 | Residential delivery ({weight} lbs) without dock. Consider liftgate. |
| weight < 100 lbs AND package_type = "loose" | no trigger | Light loose freight typically hand-unloadable. |

**Design note:** Palletized shipments have a higher weight threshold (500 lbs) because pallets can sometimes be unloaded with a pallet jack if a dock is available. Loose freight has a lower threshold (300 lbs / 150 lbs residential) because it requires manual handling.

**dock = "unknown" routing:** A dock-unknown case does NOT automatically escalate to AI. It only goes to AI if the rules confidence lands in the 0.5-0.84 range. Example: 800 lbs loose + dock unknown gives rules confidence 0.80, which is in the ambiguous zone, so it goes to AI. But 800 lbs loose + residential + dock unknown would stack to very high confidence via the residential liftgate rule (0.93), so it skips AI entirely.

#### Residential Delivery Rules

| Condition | Confidence | Explanation Template |
|-----------|------------|---------------------|
| consignee_type = "residential" | 0.95 | Destination marked as residential. Residential delivery accessorial required by most carriers. |
| location_type = "home" OR "apartment" | 0.95 | Delivery to {location_type}. Residential delivery accessorial applies. |

**Design note:** In the POC, residential detection is entirely user-reported. This is the biggest gap vs. production (where we would validate against geocoding). Acknowledged as a known limitation.

#### Limited Access Rules

| Condition | Confidence | Explanation Template |
|-----------|------------|---------------------|
| location_type IN ("school", "church", "hospital", "military_base", "prison", "construction_site", "mine") | 0.90 | {location_type} is classified as a limited access location by most LTL carriers. |
| location_type = "mall" OR "shopping_center" | 0.85 | Malls and shopping centers often have restricted delivery windows and access points. Limited access likely applies. |
| location_type = "government_building" | 0.82 | Government facilities typically require limited access designation. Verify with carrier. |
| consignee_type = "residential" AND handling_units >= 3 | 0.60 | Multiple handling units ({handling_units}) to a residential address may face access constraints. Review recommended. |

**Design note on mall/government cases:** Limited access is determined by location type, not shipment weight. A 20 lb package to a mall still qualifies as limited access per carrier policy. However, AI (Task 2) may adjust the display priority or explanation tone for very light shipments to these locations, without removing the recommendation itself. The accessorial still applies; only the urgency of the callout changes.

#### Rule Stacking

Multiple accessorials can fire on the same shipment. Each accessorial is evaluated independently. All qualifying recommendations are returned.

Examples:
- Residential + Liftgate: consignee_type = "residential", weight = 400 lbs, loose, dock = "no" fires both residential delivery (0.95) and liftgate (0.93). Both are high confidence, returned directly without AI.
- Limited Access + Liftgate: location_type = "construction_site", weight = 800 lbs, palletized, dock = "no" fires both limited access (0.90) and liftgate (0.92). Both high confidence, no AI needed.
- Mixed confidence stacking: location_type = "government_building" (0.82) + liftgate (0.75, palletized dock unknown). Both in ambiguous zone, so AI is invoked for Task 1 (explanation refinement) and Task 2 (ambiguity review on both).

### Input Schema

```json
{
  "shipment_id": "string (optional)",
  "destination_address": {
    "city": "string",
    "state": "string",
    "zip": "string"
  },
  "consignee_type": "commercial | residential | unknown",
  "location_type": "warehouse | retail_store | home | apartment | school | church | hospital | military_base | prison | construction_site | mine | mall | government_building | other",
  "package_type": "palletized | loose | crated",
  "total_weight_lbs": "number",
  "handling_units": "number",
  "dock_available": "yes | no | unknown"
}
```

### Output Schema

```json
{
  "recommendations": [
    {
      "accessorial": "liftgate",
      "confidence": 0.92,
      "level": "recommended",
      "source": "rules",
      "explanation": "Palletized shipment (800 lbs) with no dock. Liftgate required for unloading."
    },
    {
      "accessorial": "limited_access",
      "confidence": 0.90,
      "level": "recommended",
      "source": "rules",
      "explanation": "Construction site is classified as a limited access location by most LTL carriers."
    }
  ],
  "advisories": [
    {
      "type": "near_threshold",
      "message": "Shipment weight (290 lbs) is close to the liftgate threshold. If additional items are added or weight is approximate, consider adding liftgate.",
      "source": "ai"
    }
  ],
  "meta": {
    "processing_time_ms": 12,
    "rules_evaluated": 14,
    "rules_fired": 2,
    "ai_invoked": false,
    "ai_tasks": []
  }
}
```

### When the Agent Does NOT Trigger

Rules-only (no AI call):
- All rules fire at >= 0.85 confidence (high certainty path)
- No rules fire and no near-threshold signals detected (clean no-trigger path)
- consignee_type = "commercial" AND location_type = "warehouse" AND dock = "yes"
- User has already manually selected the relevant accessorials

AI is invoked only when:
- Any rule fires with confidence 0.5-0.84
- No rules fire but near-threshold or ambiguous signals are detected
- Multiple rules fire and explanation refinement would improve clarity

---

## 3. Guardrails

### Performance

| Guardrail | Implementation |
|-----------|---------------|
| Rules engine latency | < 50ms. No external API calls. Runs synchronously. |
| AI latency | 2s hard timeout on AI call. If AI times out, return rules-only results with a flag. |
| Non-blocking | Recommendations appear as a suggestion panel beside the form. Users can submit without acting on them. |
| Graceful degradation | If rules engine encounters unexpected input, return "unable to evaluate" rather than a bad recommendation. If AI fails, rules results still display. |

### AI-Specific Constraints

| Guardrail | Implementation |
|-----------|---------------|
| Confidence adjustment cap | AI can adjust rules confidence by maximum +-0.10. Cannot cross the 0.85 "recommended" boundary upward. Cannot push below 0.40. |
| No independent recommendations | AI cannot generate a formal recommendation that rules did not flag. In no-rule-fired cases, AI can only produce advisories. |
| No decision overrides | AI cannot override a high-confidence (>= 0.85) rules result in either direction. |
| Fixed output set | Both recommendations and advisories must reference the known accessorial enum: liftgate, residential_delivery, limited_access. No free-form accessorial suggestions. |
| Structured output enforcement | AI must return JSON matching the defined schema. Any malformed response is discarded and rules-only results are used. |

### Safety

| Guardrail | Implementation |
|-----------|---------------|
| No guessing on missing data | If consignee_type = "unknown" AND location_type = "other", do not recommend residential or limited access. Only weight-based liftgate rules can still fire (with reduced confidence). |
| Confidence transparency | Every recommendation and advisory shows its confidence score, source (rules or ai), and a plain-English explanation. User always sees the reasoning. |
| Refuse to decide | If both consignee_type and weight are missing, return "insufficient data" with a prompt to complete the form. |
| Audit logging | Every request logged with full input, rules output, AI output (if invoked), final merged output, and timestamp. Supports post-hoc error attribution (rules error vs AI error). |
| Recommendation vs advisory separation | UI clearly separates "Recommendations" (actionable, add this accessorial) from "Advisories" (informational, verify this). Users should never confuse the two. |

### Cost

| Guardrail | Implementation |
|-----------|---------------|
| AI call gating | AI is only invoked when rules output falls in the ambiguous zone (0.5-0.84) or near-threshold advisory conditions are met. Estimated ~20-30% of shipments. |
| Token budget | Max 500 input tokens + 200 output tokens per AI call. System prompt is cached and reused. |
| Model selection | Use smallest capable model (Claude Haiku or equivalent). Upgrade only if eval shows quality gap. |
| Cost ceiling (production) | Track daily AI spend per tenant. Alert at $10/day; hard stop at $50/day. |

---

## 4. Evaluation Framework

### Offline Evaluation

**Test dataset structure:**
- 30 synthetic shipment scenarios with ground truth labels
- Each case specifies: all input fields, expected accessorial(s), expected confidence range, and rationale

**Test case categories:**

| Category | Count | Purpose |
|----------|-------|---------|
| Clear residential + heavy | 4 | Should fire both residential + liftgate |
| Clear commercial with dock | 4 | Should fire nothing |
| Limited access locations | 4 | Should fire limited access, possibly liftgate |
| Heavy loose freight, no dock | 4 | Should fire liftgate only |
| Borderline weight (near thresholds) | 4 | Tests threshold precision |
| Unknown/missing fields | 4 | Tests graceful handling, refuse-to-decide |
| Multi-accessorial stacking | 3 | Tests that multiple recommendations return correctly |
| No accessorial needed | 3 | Should return empty, tests false positive rate |

**Metrics measured:**
- Precision and recall per accessorial type
- Overall F1 score
- False positive breakdown: which clean cases got wrong recommendations
- False negative breakdown: which cases should have triggered but didn't
- Confidence calibration: do high-confidence predictions actually correlate with correctness?

### Online Evaluation (Post-POC Plan)

**A/B test design:**
- Control: current flow, no recommendations
- Treatment: recommendation panel shown

**Leading metrics (weeks):**
- Recommendation acceptance rate (target > 60%)
- Override rate (user declines suggestion)
- Shipment creation time (should not increase meaningfully)

**Lagging metrics (months):**
- Invoice dispute rate reduction
- Accessorial surprise charge rate
- Customer rebilling frequency
- Net margin impact per shipment

### Human-in-the-Loop

**Override feedback loop:**
- When user declines a recommendation, log decline + optional reason
- When carrier invoices an accessorial that was NOT recommended, flag as false negative
- When carrier does NOT invoice a recommended accessorial that user accepted, flag as false positive
- Monthly review: adjust rule thresholds based on accumulated override and invoice data

**Prediction vs. outcome logging:**

```
| shipment_id | predicted       | confidence | user_action | carrier_invoiced | outcome        |
|-------------|-----------------|------------|-------------|------------------|----------------|
| SHP-001     | liftgate        | 0.92       | accepted    | yes              | true_positive  |
| SHP-002     | residential     | 0.95       | declined    | yes              | false_negative |
| SHP-003     | limited_access  | 0.60       | accepted    | no               | false_positive |
| SHP-004     | (none)          | -          | -           | liftgate         | missed         |
```

---

## 5. Rollout Strategy

### Phased Plan

**Phase 1: Shadow Mode (2-4 weeks)**
- Agent runs on every LTL shipment but results are NOT shown to users
- All predictions logged against actual carrier invoices
- Goal: validate precision > 85% and recall > 70% on real data
- Zero user impact, zero risk

**Phase 2: Suggest-Only (4-8 weeks)**
- Recommendations shown as non-blocking suggestions
- Users can accept, decline, or ignore
- Display threshold: confidence >= 0.7
- Goal: acceptance rate > 60%, no increase in shipment creation time

**Phase 3: Auto-Apply (post-validation)**
- High-confidence recommendations (>= 0.95) pre-selected in the form (user can still uncheck)
- Only enabled after Phase 2 confirms precision > 90% at this threshold
- Requires explicit customer opt-in

### Kill Criteria

| Condition | Action |
|-----------|--------|
| Precision below 80% in any rolling 7-day window | Revert to previous phase |
| User override rate exceeds 40% | Pause, investigate top declined recommendations |
| Any auto-applied accessorial causes carrier rejection | Immediately disable auto-apply |

### What Could Go Wrong

1. **User-reported consignee type is wrong.** A user marks "commercial" but it's actually residential. Rules engine trusts user input in the POC. Production version validates against geocoding API. Mitigation: Phase 1 shadow mode catches systematic misreporting before users see recommendations.

2. **Users blindly accept all suggestions.** If recommendations are wrong, blind acceptance makes things worse. Mitigation: show confidence and reasoning, require explicit click to accept, never silently add accessorials.

3. **Threshold values don't match carrier policies.** Different carriers define liftgate thresholds differently (some at 150 lbs, some at 200 lbs). POC uses conservative thresholds. Production version could adjust per carrier.

4. **Rule stacking creates too many suggestions.** A shipment that triggers 3 accessorials at once may overwhelm users. Mitigation: limit display to top 2-3 highest confidence recommendations. Monitor in Phase 2.

5. **Error attribution in hybrid mode.** When a recommendation is wrong, it could be a rules error, an AI adjustment error, or a merging logic error. Mitigation: audit log records rules output and AI output separately, so post-hoc analysis can pinpoint the source. Every AI confidence adjustment includes the rationale.

6. **Advisory/recommendation confusion.** Users might treat advisories as firm recommendations or ignore recommendations thinking they're just advisories. Mitigation: UI uses distinct visual treatment (green for recommended, yellow for review, gray for advisory). User testing in Phase 2 should validate this distinction works.

---

## Appendix: Productionization Enhancements

Features intentionally excluded from POC but planned for production:

- **Address validation API** (USPS / Google Geocoding) to verify user-reported consignee type
- **Historical invoice data** to boost confidence for repeat addresses with known accessorial patterns
- **Free-text delivery notes NLP** to extract signals like "gate code required" or "call before delivery"
- **LLM reasoning layer** for ambiguous cases where rules return mid-range confidence
- **Carrier-specific rule sets** (different weight thresholds per carrier)
- **LLM cost guardrails** (token budgets, spend ceilings, model selection optimization)
