// eval/run_ai_eval.mjs
// L1 (Format) + L2 (Guardrail) eval for AI layer
// Usage: node eval/run_ai_eval.mjs YOUR_API_KEY

import { fileURLToPath } from 'url';
import path from 'path';
import { evaluateRules } from '../src/engine/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.argv[2];
if (!API_KEY) {
    console.error('Usage: node eval/run_ai_eval.mjs YOUR_ANTHROPIC_API_KEY');
    process.exit(1);
}

// ── Near-threshold detection ───────────────────────────────────────────────

function detectNearThresholdSignals(input) {
    const { total_weight_lbs: weight, dock_available, forklift_available, consignee_type, location_type } = input;
    const normalize = v => (v == null ? 'unknown' : String(v).trim().toLowerCase());
    const signals = [];

    // Both unload signals unknown on a notable shipment
    if (normalize(dock_available) === 'unknown' && normalize(forklift_available) === 'unknown' && weight > 100) {
        signals.push(`Both dock and forklift availability unknown on ${weight} lb shipment`);
    }

    // Destination type completely ambiguous
    if (normalize(consignee_type) === 'unknown' &&
        (normalize(location_type) === 'other' || normalize(location_type) === 'unknown')) {
        signals.push('Consignee type and location type both unknown');
    }

    return signals;
}

function classifyCase(rulesResult, nearThresholdSignals) {
    const { recommendations, advisories } = rulesResult;
    const tasks = [];

    if (recommendations.length > 1) tasks.push('task1_explanation_refinement');
    if (recommendations.some(r => r.confidence >= 0.5 && r.confidence < 0.85)) tasks.push('task2_ambiguity_review');
    // Task 3: fires on rules-generated advisories OR near-threshold signals with no recommendations
    if (advisories.length > 0 || (recommendations.length === 0 && nearThresholdSignals.length > 0)) {
        tasks.push('task3_advisory_generation');
    }

    return tasks;
}

// ── AI call ────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an LTL freight accessorial recommendation assistant. You help refine shipment accessorial recommendations.
You work with exactly three accessorials: liftgate, residential_delivery, limited_access.
You will receive the rules engine output and the original shipment data. You may be asked to perform one or more of these tasks:
Task 1 (Explanation Refinement): Combine multiple rule explanations into one coherent paragraph. Do NOT change any confidence scores or add/remove recommendations.
Task 2 (Ambiguity Review): For recommendations with confidence 0.50-0.84, you may adjust confidence by at most +-0.10. You CANNOT push confidence above 0.84. You CANNOT push confidence below 0.40. State what signal drove any adjustment.
Task 3 (Advisory Generation): Generate soft warnings for near-threshold cases. These are NOT formal recommendations. They appear in a separate "Advisories" section. Only reference the three known accessorials.
Respond with valid JSON only. No markdown, no explanation outside JSON. Use this exact schema:
{"refined_explanation": "string or null", "adjustments": [{"accessorial": "string", "original_confidence": 0, "adjusted_confidence": 0, "rationale": "string"}], "advisories": [{"message": "string", "related_accessorial": "string"}]}`;

async function callAI(input, rulesOutput, tasks) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 300,
                system: SYSTEM_PROMPT,
                messages: [{ role: 'user', content: JSON.stringify({ tasks, shipment: input, rules_output: { recommendations: rulesOutput.recommendations, advisories: rulesOutput.advisories } }) }],
            }),
            signal: controller.signal,
        });
        clearTimeout(timeout);
        if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
        const data = await resp.json();
        const text = data.content?.[0]?.text;
        if (!text) throw new Error('Empty AI response');
        const parsed = JSON.parse(text);
        return { success: true, raw: text, parsed, refined_explanation: parsed.refined_explanation || null, adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [], advisories: Array.isArray(parsed.advisories) ? parsed.advisories : [] };
    } catch (err) {
        clearTimeout(timeout);
        return { success: false, error: err.message, raw: null, parsed: null, refined_explanation: null, adjustments: [], advisories: [] };
    }
}

// ── Test cases designed to trigger AI ──────────────────────────────────────
// All inputs use v2 rules fields (forklift_available, etc.)

const AI_TEST_CASES = [
    {
        id: 'AI-001',
        name: 'Task 2: Ambiguous liftgate (no dock, no forklift, commercial)',
        expect_ai: true,
        expect_tasks: ['task2_ambiguity_review'],
        // liftgate score: dockNo(+0.35) + forkliftNo(+0.30) + loose>=150(+0.15) = 0.80 → review_suggested
        input: { consignee_type: 'commercial', location_type: 'warehouse', package_type: 'loose', total_weight_lbs: 200, handling_units: 1, dock_available: 'no', forklift_available: 'no' },
    },
    {
        id: 'AI-002',
        name: 'Task 1+2: Multiple recommendations + ambiguity (hospital + liftgate)',
        expect_ai: true,
        expect_tasks: ['task1_explanation_refinement', 'task2_ambiguity_review'],
        // limited_access(0.82) + liftgate(0.80) → both < 0.85 → Task 2; 2 recs → Task 1
        input: { consignee_type: 'commercial', location_type: 'hospital', package_type: 'loose', total_weight_lbs: 200, handling_units: 1, dock_available: 'no', forklift_available: 'no' },
    },
    {
        id: 'AI-003',
        name: 'Task 3: Advisory from rules (residential, unload equipment unknown)',
        expect_ai: true,
        expect_tasks: ['task3_advisory_generation'],
        // residential_delivery(0.95 recommended); liftgate score too low → no liftgate rec
        // advisories: liftgate_review + delivery_complexity → Task 3
        input: { consignee_type: 'residential', location_type: 'home', package_type: 'palletized', total_weight_lbs: 200, handling_units: 4, dock_available: 'unknown', forklift_available: 'unknown' },
    },
    {
        id: 'AI-004',
        name: 'Task 3: Near-threshold (unknown destination, both dock and forklift unknown)',
        expect_ai: true,
        expect_tasks: ['task3_advisory_generation'],
        // No recommendations; detectNearThresholdSignals fires (both unknown + weight > 100) → Task 3
        input: { consignee_type: 'unknown', location_type: 'other', package_type: 'loose', total_weight_lbs: 220, handling_units: 1, dock_available: 'unknown', forklift_available: 'unknown' },
    },
    {
        id: 'AI-005',
        name: 'No AI: High confidence residential delivery (dock + forklift available)',
        expect_ai: false,
        expect_tasks: [],
        // residential_delivery(0.95 recommended); liftgate suppressed (dockYes+forkliftYes); no advisories
        input: { consignee_type: 'residential', location_type: 'home', package_type: 'palletized', total_weight_lbs: 300, handling_units: 1, dock_available: 'yes', forklift_available: 'yes' },
    },
    {
        id: 'AI-006',
        name: 'No AI: Clean commercial warehouse with dock and forklift',
        expect_ai: false,
        expect_tasks: [],
        // No recommendations (liftgate suppressed, not residential, warehouse not limited_access); no advisories
        input: { consignee_type: 'commercial', location_type: 'warehouse', package_type: 'palletized', total_weight_lbs: 1200, handling_units: 2, dock_available: 'yes', forklift_available: 'yes' },
    },
    {
        id: 'AI-007',
        name: 'Degradation: Bad API key should fallback gracefully',
        expect_ai: true,
        expect_tasks: ['task3_advisory_generation'],
        // Same trigger as AI-004; bad key causes graceful failure
        input: { consignee_type: 'unknown', location_type: 'other', package_type: 'palletized', total_weight_lbs: 450, handling_units: 1, dock_available: 'unknown', forklift_available: 'unknown' },
        use_bad_key: true,
    },
];

const VALID_ACCESSORIALS = ['liftgate', 'residential_delivery', 'limited_access'];

// ── Run tests ──────────────────────────────────────────────────────────────

async function runTest(tc) {
    const checks = [];
    const rulesResult = evaluateRules(tc.input);
    const signals = detectNearThresholdSignals(tc.input);
    const aiTasks = classifyCase(rulesResult, signals);

    // Check: AI trigger correctness
    const shouldTrigger = aiTasks.length > 0;
    checks.push({
        name: 'AI trigger correct',
        pass: shouldTrigger === tc.expect_ai,
        detail: `Expected AI=${tc.expect_ai}, Got AI=${shouldTrigger} (tasks: ${aiTasks.join(',') || 'none'})`,
    });

    if (!shouldTrigger) {
        return { id: tc.id, name: tc.name, checks, aiCalled: false };
    }

    // Call AI
    const aiResult = tc.use_bad_key
        ? await callAI(tc.input, rulesResult, aiTasks, 'sk-bad-key-12345')
        : await callAI(tc.input, rulesResult, aiTasks);

    // ── Degradation test ──
    if (tc.use_bad_key) {
        checks.push({
            name: 'Graceful degradation (bad key)',
            pass: aiResult.success === false && aiResult.error != null,
            detail: aiResult.success ? 'AI should have failed but succeeded?!' : `Correctly failed: ${aiResult.error}`,
        });
        return { id: tc.id, name: tc.name, checks, aiCalled: true };
    }

    // ── L1: Format checks ──
    checks.push({
        name: 'L1: AI call succeeded',
        pass: aiResult.success === true,
        detail: aiResult.success ? 'OK' : `Failed: ${aiResult.error}`,
    });

    if (!aiResult.success) {
        return { id: tc.id, name: tc.name, checks, aiCalled: true };
    }

    // Check JSON structure
    const p = aiResult.parsed;
    checks.push({
        name: 'L1: Has refined_explanation field',
        pass: 'refined_explanation' in p,
        detail: `Type: ${typeof p.refined_explanation}`,
    });
    checks.push({
        name: 'L1: Has adjustments array',
        pass: Array.isArray(p.adjustments),
        detail: `Type: ${typeof p.adjustments}, isArray: ${Array.isArray(p.adjustments)}`,
    });
    checks.push({
        name: 'L1: Has advisories array',
        pass: Array.isArray(p.advisories),
        detail: `Type: ${typeof p.advisories}, isArray: ${Array.isArray(p.advisories)}`,
    });

    // Check all accessorials are valid enum values
    const allAccessorials = [
        ...aiResult.adjustments.map(a => a.accessorial),
        ...aiResult.advisories.map(a => a.related_accessorial),
    ].filter(Boolean);

    const invalidAccessorials = allAccessorials.filter(a => !VALID_ACCESSORIALS.includes(a));
    checks.push({
        name: 'L1: No hallucinated accessorial types',
        pass: invalidAccessorials.length === 0,
        detail: invalidAccessorials.length ? `Invalid: ${invalidAccessorials.join(', ')}` : `All valid: ${allAccessorials.join(', ') || '(none)'}`,
    });

    // Check adjustment fields have required properties
    for (const adj of aiResult.adjustments) {
        checks.push({
            name: `L1: Adjustment for "${adj.accessorial}" has all fields`,
            pass: adj.accessorial != null && adj.original_confidence != null && adj.adjusted_confidence != null && adj.rationale != null,
            detail: `accessorial=${adj.accessorial}, orig=${adj.original_confidence}, adj=${adj.adjusted_confidence}, rationale=${adj.rationale ? 'yes' : 'MISSING'}`,
        });
    }

    // ── L2: Guardrail checks ──
    for (const adj of aiResult.adjustments) {
        const delta = Math.abs(adj.adjusted_confidence - adj.original_confidence);
        checks.push({
            name: `L2: Adjustment delta ≤ 0.10 for "${adj.accessorial}"`,
            pass: delta <= 0.101,
            detail: `Original=${adj.original_confidence}, Adjusted=${adj.adjusted_confidence}, Delta=${delta.toFixed(3)}`,
        });
        checks.push({
            name: `L2: Adjusted confidence < 0.85 for "${adj.accessorial}"`,
            pass: adj.adjusted_confidence < 0.85,
            detail: `Adjusted=${adj.adjusted_confidence}`,
        });
        checks.push({
            name: `L2: Adjusted confidence ≥ 0.40 for "${adj.accessorial}"`,
            pass: adj.adjusted_confidence >= 0.40,
            detail: `Adjusted=${adj.adjusted_confidence}`,
        });
    }

    // Check advisory messages are non-empty
    for (const adv of aiResult.advisories) {
        checks.push({
            name: `L2: Advisory message is non-empty`,
            pass: adv.message && adv.message.length > 10,
            detail: `Message length=${adv.message?.length || 0}`,
        });
    }

    return { id: tc.id, name: tc.name, checks, aiCalled: true, rawAI: aiResult.raw };
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log('\n============================================');
console.log('  AI EVAL — L1 (Format) + L2 (Guardrails)');
console.log('============================================\n');

let totalChecks = 0;
let totalPass = 0;
let totalFail = 0;

for (const tc of AI_TEST_CASES) {
    const result = await runTest(tc);

    const passCount = result.checks.filter(c => c.pass).length;
    const failCount = result.checks.filter(c => !c.pass).length;
    totalChecks += result.checks.length;
    totalPass += passCount;
    totalFail += failCount;

    const icon = failCount === 0 ? '✅' : '❌';
    console.log(`${icon} [${result.id}] ${result.name}`);
    console.log(`   AI called: ${result.aiCalled ? 'Yes' : 'No'} | Checks: ${passCount}/${result.checks.length}`);

    for (const c of result.checks) {
        const ci = c.pass ? '  ✓' : '  ✗';
        console.log(`   ${ci} ${c.name}`);
        if (!c.pass) console.log(`     → ${c.detail}`);
    }
    console.log();
}

console.log('─'.repeat(50));
console.log(`TOTAL: ${totalPass}/${totalChecks} checks passed, ${totalFail} failed`);
if (totalFail === 0) {
    console.log('🎉 All L1 + L2 checks passed!');
} else {
    console.log(`⚠️  ${totalFail} check(s) failed — review above.`);
}
console.log();
