# Accessorial Recommendation Agent — POC

A working proof-of-concept for an AI-assisted accessorial recommendation system for LTL shipments, built for FreightPOP's TMS platform.

---

## What This Is

When shippers book LTL freight, they frequently miss required accessorials — Liftgate, Residential Delivery, Limited Access — at creation time. Carriers invoice these charges after delivery, causing margin erosion, invoice disputes, and customer rebilling months later.

This POC demonstrates a **Hybrid Deterministic-LLM agent** that surfaces missed accessorials in real-time, during the shipment creation workflow, before the quote is finalized.

**Live demo:** run `npm install && npm run dev`, then open `http://localhost:5173`.

---

## Running the Project

```bash
npm install
npm run dev        # Starts local dev server on http://localhost:5173

# Offline rules eval (no API key required)
node eval/run_eval.mjs

# AI layer eval (requires Anthropic API key)
node eval/run_ai_eval.mjs sk-ant-YOUR_KEY_HERE
```

The app runs entirely in the browser. The Claude API key is entered in the UI header and is stored only in browser memory — never sent to any server except Anthropic's API directly.

---

## Assessment Response

### 1. Problem Framing

**What hypotheses are we testing?**

| Hypothesis | Description |
|-----------|-------------|
| H1: Intrinsic Predictability | Shipment attributes available at creation time (consignee type, weight, package type, dock availability) possess sufficient predictive power to identify > 80% of missed accessorials — without any external API augmentation. |
| H2: Deterministic Foundation | A rules engine can handle core classification robustly. LLM adds value only for edge-case ambiguity, explanation refinement, and near-threshold advisories. |
| H3: Explainability Drives Adoption | Clear confidence scores and deterministic reasoning prevent "black-box" rejection and increase recommendation acceptance. |

**What signals are predictive?**

All signals in the POC come from the shipment creation form — no external API calls, no historical lookups:

- **Consignee / location type** — determines Residential Delivery and Limited Access
- **Total weight** — primary liftgate signal
- **Package type** (palletized / loose / crated) — modifies liftgate weight threshold
- **Dock availability** — critical liftgate modifier; "unknown" reduces confidence score
- **Handling units** — residential + ≥ 3 units triggers delivery complexity advisory

The `classifier.js` module adds a bonus signal: it auto-classifies a typed address string using keyword pattern matching (e.g., "school", "hospital", "apt", "LLC") to pre-fill consignee type and location type. Users can override this classification and the UI tracks the override with an "User override" badge.

**What does success look like?**

| Metric | Target |
|--------|--------|
| Precision | > 85% |
| Recall | > 70% |
| Rules engine P95 latency | < 200ms (actual: < 5ms) |
| Rules-only coverage | > 90% of test cases |

**What tradeoffs were made?**

**Precision over recall.** A false positive (recommending an accessorial the shipper doesn't need) directly increases freight cost and erodes trust. A false negative maintains the existing baseline experience. Ambiguous cases are demoted from "Recommended" (≥ 0.85) to "Review Suggested" (0.50–0.84) rather than being promoted to firm recommendations.

---

### 2. Agent Design

**What inputs does the agent use?**

```json
{
  "consignee_type": "commercial | residential | unknown",
  "location_type": "warehouse | retail_store | home | apartment | school | church | hospital | military_base | prison | construction_site | mine | mall | government_building | other",
  "package_type": "palletized | loose | crated",
  "total_weight_lbs": 450,
  "handling_units": 2,
  "dock_available": "yes | no | unknown",
  "destination_address": { "city": "...", "state": "...", "zip": "..." }
}
```

**What architecture was chosen?**

A **Hybrid Deterministic-LLM** pipeline. The rules engine (`src/engine/rules.js`) is the primary decision-maker. The LLM (`src/engine/ai.js`) acts as a constrained assistant, invoked only for specific, gated tasks.

```
Address Input → [classifier.js] Auto-classify consignee/location type
                                         │
Shipment Fields ─────────────────────────┘
                                         │
                               [rules.js] Evaluate all rules
                                         │
                          [analyzer.js] Case classification
                                         │
               ┌─────────────────────────┴──────────────────────────┐
               │                                                     │
        High confidence (≥ 0.85)                    Ambiguous (0.50–0.84) OR
        OR clean no-trigger                         near-threshold signals
               │                                                     │
        Return directly.                    [ai.js] Claude Sonnet API call
        No AI call.                         (15s timeout, max 300 tokens)
                                                                     │
                                            Apply guardrailed adjustments
                                                                     │
                                              ─────────────────────────────
                                              Final output:
                                              - recommendations (Recommended / Review Suggested)
                                              - advisories (informational only)
                                              - meta (timing, rules fired, AI tasks)
```

**When does the AI trigger?**

The `classifyCase()` function in `analyzer.js` determines AI invocation. Three tasks can be assigned:

| Task | Trigger Condition | AI Role |
|------|-------------------|---------|
| Task 1: Explanation Refinement | Multiple recommendations fired | Merge separate rule explanations into one coherent paragraph. No confidence changes. |
| Task 2: Ambiguity Review | Any recommendation has confidence 0.50–0.84 | Adjust confidence ± 0.10 max. Cannot cross 0.85 boundary upward. |
| Task 3: Advisory Generation | No rules fired but near-threshold signals detected | Generate soft warnings only. Not formal recommendations. |

**When does the AI NOT trigger?**

- All rules fire at ≥ 0.85 (high-certainty path — go direct)
- No rules fire and no near-threshold signals (clean no-trigger — return empty)
- Standard commercial warehouse with dock available (immediate suppression)
- Missing required fields (refuse-to-decide — prompt user to complete form)

**How is confidence produced?**

Rules assign deterministic base scores from conditional logic:

- `residential_delivery`: `0.95` flat when consignee type is residential or location matches residential set
- `liftgate`: Additive scoring — dock_no (`+0.35`), forklift_no (`+0.30`), weight thresholds (`+0.08–0.20`), residential flag (`+0.05`); dock_yes + forklift_yes → score forced to `0`
- `limited_access`: `0.82` base for known limited-access location types, plus modifier signals; capped at `0.98`

If Task 2 is assigned, the AI can adjust by ≤ ± 0.10. Hard guardrail: `newConf = 0.84` if AI attempts to push to `0.85+`. The adjusted confidence, not the AI's raw output, is what gets displayed.

---

### 3. Guardrails

#### Performance

| Guardrail | Implementation |
|-----------|----------------|
| Rules engine latency | Runs synchronously in < 5ms (target: < 50ms). Uses `performance.now()` to measure and include in output `meta`. |
| AI hard timeout | `AbortController` with `setTimeout(() => controller.abort(), 15000)` in `ai.js:31`. On timeout, falls back to rules-only output with `ai_success: false` in meta. |
| Non-blocking UI | `handleAnalyze()` in `ShipmentAnalyzer.jsx` is `async`. The "Analyze Shipment" button shows a loading state; the primary shipment workflow is never blocked. |
| Graceful degradation | If AI call fails for any reason (timeout, API error, malformed JSON), `callAI()` returns `{ success: false, adjustments: [], advisories: [] }`. `applyAIAdjustments()` returns recommendations unchanged if `aiResult.success` is false. |

#### Cost

| Guardrail | Implementation |
|-----------|----------------|
| AI call gating | LLM invoked only when `aiTasks.length > 0`. Estimated ~20–30% of shipments hit the ambiguous zone. The other 70–80% pay zero AI cost. |
| Token budget | `max_tokens: 300` hard-coded in `ai.js:44`. System prompt is compact and reused across all calls. |
| Model selection | Uses `claude-sonnet-4-20250514`. Production would switch to Haiku unless eval shows quality gap. |
| Spend ceilings (production plan) | Tenant-level daily alert at $10, hard stop at $50. Not implemented in POC (browser-side prototype). |

#### Safety

| Guardrail | Implementation |
|-----------|----------------|
| Hallucination prevention | AI system prompt hardcodes the allowed accessorial set: `liftgate`, `residential_delivery`, `limited_access`. `run_ai_eval.mjs` checks every AI response for out-of-enum accessorials and fails the test if any appear. |
| Confidence boundary enforcement | `applyAIAdjustments()` in `analyzer.js:50–77` enforces: max delta of `0.10`, cap at `0.84` (cannot cross recommended boundary), floor at `0.40`. These are applied programmatically after receiving the AI response — the AI cannot bypass them. |
| Low-confidence suppression | Recommendations below `0.50` are not surfaced. The UI distinguishes `recommended` (≥ 0.85, green) from `review_suggested` (0.50–0.84, yellow). Scores below `0.40` are suppressed entirely. |
| Refuse-to-decide | When both consignee type and location type are unknown/other and weight is missing, the rules engine fires no rules. `detectNearThresholdSignals()` checks for this condition and can send it to AI only for Task 3 advisories — not formal recommendations. |
| Audit logging | Every analysis run logs `{ input, rulesOutput, aiOutput, finalOutput, timestamp }` to `sessionLog` state in `App.jsx`. Visible in the "System Log" tab. Supports post-hoc attribution of rules errors vs. AI errors. |
| Output schema validation | `ai.js:65` parses AI response as JSON and validates it's an object before returning. `run_ai_eval.mjs` verifies all required fields (`refined_explanation`, `adjustments`, `advisories`) and their types in L1 checks. |

---

### 4. Evaluation Framework

#### Offline Evaluation

**Test dataset:** `docs/test-dataset.json` — 37 synthetic shipment cases with ground-truth labels covering:
- Clear residential + heavy freight (fires both residential + liftgate)
- Clear commercial with dock (fires nothing — FP validation)
- Limited access location types
- Heavy loose freight, no dock
- Borderline weight near thresholds
- Missing / unknown fields (refuse-to-decide validation)
- Multi-accessorial stacking
- No-accessorial-needed cases

**How precision/recall are measured:**

`eval/run_eval.mjs` runs the rules engine against every test case and computes per-type TP, FP, FN:

```
For each accessorial type (liftgate, residential_delivery, limited_access):
  TP: expected AND predicted
  FP: not expected BUT predicted
  FN: expected BUT not predicted

Precision = TP / (TP + FP)
Recall    = TP / (TP + FN)
F1        = 2 * P * R / (P + R)
```

Design targets are automatically checked and printed:
```
Target check (from design doc):
  Precision ≥ 85%: ✅ PASS (XX.X%)
  Recall    ≥ 70%: ✅ PASS (XX.X%)
```

**AI layer evaluation:**

`eval/run_ai_eval.mjs` runs 7 AI-specific test cases covering:

| Level | Check Type | Examples |
|-------|-----------|---------|
| L1: Format | JSON schema compliance | Has `refined_explanation`, `adjustments`, `advisories` fields; all accessorials within valid enum |
| L2: Guardrails | Confidence boundary enforcement | Delta ≤ 0.10; adjusted confidence < 0.85; adjusted confidence ≥ 0.40 |
| Degradation | Bad API key fallback | AI fails gracefully; rules output still returned |
| Trigger correctness | AI fires exactly when expected | Test cases for both "should trigger" and "should NOT trigger" scenarios |

**Failure types observed in development:**

- **Rule false positives:** Ground-truth label desynchronization (rule threshold update not reflected in expected label)
- **AI confidence boundary violations:** Early prompts allowed AI to output `0.85`; caught by L2 checks, resolved by adding explicit cap in `applyAIAdjustments()`
- **Near-threshold double-counting:** Advisory fired when a formal recommendation already covered the same accessorial; resolved by checking `recommendations.length > 0` before Task 3 advisory generation

#### Online Evaluation (Phase 2 Plan)

**A/B test design:**
- Control: existing FreightPOP LTL flow, no recommendation panel
- Treatment: recommendation panel shown (non-blocking, suggest-only)

**Leading metrics (weeks 1–8):**
- Recommendation acceptance rate (target > 60%)
- User override rate — explicit decline tracker
- Shipment creation time delta (must not increase meaningfully)

**Lagging metrics (months 2–6):**
- Invoice dispute rate reduction
- Accessorial surprise charge frequency
- Customer rebilling rate
- Net margin impact per shipment cohort

#### Human-in-the-Loop

**Override feedback loop:**
- User declining a recommendation logs `{ predicted, confidence, user_action: "declined" }`
- Carrier invoicing an accessorial that was NOT recommended → false negative flag
- Monthly threshold review: accumulate override + invoice data to calibrate rule weights

**Prediction vs. outcome shadow ledger:**

```
shipment_id | predicted        | confidence | user_action | carrier_invoiced | outcome
SHP-001     | liftgate         | 0.92       | accepted    | yes              | true_positive
SHP-002     | residential      | 0.95       | declined    | yes              | false_negative
SHP-003     | limited_access   | 0.60       | accepted    | no               | false_positive
SHP-004     | (none)           | —          | —           | liftgate         | missed
```

---

### 5. Rollout Strategy

**Phase 1: Shadow Mode (2–4 weeks)**
- Agent runs on every LTL shipment, predictions logged silently
- Zero UI exposure, zero user impact
- Goal: validate Precision > 85% and Recall > 70% on real data
- Pass/fail gate before any user-visible rollout

**Phase 2: Suggest-Only (4–8 weeks)**
- Non-blocking recommendation panel shown for `confidence ≥ 0.70`
- Users must explicitly click to accept; never silently applied
- Goal: acceptance rate > 60%, no regression in shipment creation time

**Phase 3: Auto-Apply (post-validation)**
- High-confidence predictions (`≥ 0.95`) pre-select accessorial in the form
- User retains 1-click revert
- Requires explicit customer opt-in
- Only enabled after Phase 2 confirms precision > 90% at this confidence tier

**Confidence threshold for auto-apply:** `≥ 0.95`, validated by Phase 2 precision data at that tier.

**Kill criteria:**

| Condition | Action |
|-----------|--------|
| Precision < 80% in any 7-day rolling window | Revert to previous phase |
| User override rate > 40% | Pause, investigate top declined recommendations |
| Any auto-applied accessorial causes carrier API payload rejection | Immediately disable auto-apply |

**What could go wrong:**

1. **GIGO — user misreports consignee type.** User marks "commercial" for a residential address. POC trusts user input. Mitigation: Phase 1 shadow mode quantifies systematic misreporting; production adds USPS/Geocoding API pre-validation.

2. **Automation bias.** Users blindly accept wrong recommendations, inflating costs. Mitigation: every recommendation shows confidence score and plain-English reasoning; explicit click required to accept.

3. **Carrier threshold mismatch.** Different carriers define liftgate thresholds differently (some at 150 lbs, some at 200 lbs). POC uses conservative defaults. Production: per-carrier rule sets.

4. **Rule stacking fatigue.** Shipments triggering 3 accessorials at once may overwhelm users. Mitigation: UI limits display to top-2 highest confidence; monitor alert fatigue in Phase 2.

5. **Error attribution in hybrid mode.** Wrong recommendation could trace to rules, AI adjustment, or merge logic. Mitigation: System Log tab stores `rulesOutput` and `aiOutput` separately for every request.

---

## Architecture Map

```
src/
├── engine/
│   ├── rules.js          # Deterministic rules engine — all scoring logic
│   ├── analyzer.js       # Orchestrator — runs rules, classifies case, calls AI, merges output
│   ├── ai.js             # Claude API client — AbortController timeout, JSON schema validation
│   └── classifier.js     # Address keyword classifier — auto-detects consignee/location type
├── components/
│   ├── App.jsx           # Tab layout, API key state, session log accumulator
│   ├── ShipmentAnalyzer.jsx  # Main form, preset loader, override tracking
│   ├── ResultsPanel.jsx  # Recommendations + advisories display
│   ├── TestRunner.jsx    # In-browser test runner against test-dataset.json
│   └── SystemLog.jsx     # Per-session audit log viewer
├── presets.js            # 4 quick-load scenario presets
└── main.jsx              # React entry point

eval/
├── run_eval.mjs          # Offline rules eval — precision/recall/F1 against test-dataset.json
└── run_ai_eval.mjs       # AI layer eval — L1 format + L2 guardrail checks (7 test cases)

docs/
├── test-dataset.json     # 37-case ground-truth dataset
├── accessorial-agent-design.md  # Full design document
└── carrier-rate-mapping.md
```

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Frontend | React 19 + Vite + Tailwind CSS v4 | Lightweight, zero-backend POC; runs entirely in browser |
| AI | Claude Sonnet via Anthropic API | Direct browser-to-API call; structured JSON output |
| Eval | Node.js ESM scripts | Zero dependency; runs against source files directly |
| Build | Vite | Fast HMR during development |

---

## Known Limitations (POC Scope)

- **No address geocoding.** Consignee type is user-reported. Production would validate against USPS or Google Geocoding API.
- **No historical data.** Repeat-offender addresses (known residential addresses flagged commercial by users) would boost confidence in production.
- **No carrier-specific rules.** Liftgate thresholds are conservative defaults. Production would allow per-carrier configuration.
- **Browser-side API key.** For demo purposes only. Production would proxy through a backend with server-side key management and per-tenant spend tracking.
- **Synthetic test dataset.** Ground truth labels were hand-crafted. Production eval uses real carrier invoices as ground truth.
