// eval/run_ai_eval.mjs
// L1 (Format) + L2 (Guardrail) eval for AI layer
// Usage: node eval/run_ai_eval.mjs YOUR_API_KEY

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_KEY = process.argv[2];
if (!API_KEY) {
    console.error('Usage: node eval/run_ai_eval.mjs YOUR_ANTHROPIC_API_KEY');
    process.exit(1);
}

// ── Inline rules engine ────────────────────────────────────────────────────

const LIMITED_ACCESS_LOCATIONS = [
    'school', 'church', 'hospital', 'military_base', 'prison',
    'construction_site', 'mine',
];

function evaluateRules(input) {
    const {
        consignee_type, location_type, package_type,
        total_weight_lbs: weight, handling_units, dock_available,
    } = input;
    const effectivePkg = package_type === 'crated' ? 'palletized' : package_type;
    const isResidential = consignee_type === 'residential';
    const hasWeight = weight != null && weight > 0;
    const matches = [];
    let rulesEvaluated = 0;

    if (hasWeight) {
        rulesEvaluated++;
        if (weight >= 300 && effectivePkg === 'loose' && dock_available === 'no')
            matches.push({ accessorial: 'liftgate', confidence: 0.95, rule: 'L1' });
        rulesEvaluated++;
        if (weight >= 300 && effectivePkg === 'loose' && dock_available === 'unknown')
            matches.push({ accessorial: 'liftgate', confidence: 0.80, rule: 'L2' });
        rulesEvaluated++;
        if (weight >= 500 && effectivePkg === 'palletized' && dock_available === 'no')
            matches.push({ accessorial: 'liftgate', confidence: 0.92, rule: 'L3' });
        rulesEvaluated++;
        if (weight >= 500 && effectivePkg === 'palletized' && dock_available === 'unknown')
            matches.push({ accessorial: 'liftgate', confidence: 0.75, rule: 'L4' });
        rulesEvaluated++;
        if (weight >= 150 && effectivePkg === 'loose' && dock_available === 'no' && isResidential)
            matches.push({ accessorial: 'liftgate', confidence: 0.93, rule: 'L5' });
        rulesEvaluated++;
        if (weight >= 100 && isResidential && dock_available === 'no')
            matches.push({ accessorial: 'liftgate', confidence: 0.70, rule: 'L6' });
    }
    if (hasWeight) rulesEvaluated++;

    rulesEvaluated++;
    if (consignee_type === 'residential')
        matches.push({ accessorial: 'residential_delivery', confidence: 0.95, rule: 'R1' });
    rulesEvaluated++;
    if (location_type === 'home' || location_type === 'apartment')
        matches.push({ accessorial: 'residential_delivery', confidence: 0.95, rule: 'R2' });
    rulesEvaluated++;
    if (LIMITED_ACCESS_LOCATIONS.includes(location_type))
        matches.push({ accessorial: 'limited_access', confidence: 0.90, rule: 'A1' });
    rulesEvaluated++;
    if (location_type === 'mall')
        matches.push({ accessorial: 'limited_access', confidence: 0.85, rule: 'A2' });
    rulesEvaluated++;
    if (location_type === 'government_building')
        matches.push({ accessorial: 'limited_access', confidence: 0.82, rule: 'A3' });
    rulesEvaluated++;
    if (isResidential && handling_units >= 3)
        matches.push({ accessorial: 'limited_access', confidence: 0.60, rule: 'A4' });

    const best = {};
    for (const m of matches) {
        if (!best[m.accessorial] || m.confidence > best[m.accessorial].confidence)
            best[m.accessorial] = m;
    }

    const recommendations = Object.values(best).map(m => ({
        accessorial: m.accessorial, confidence: m.confidence,
        level: m.confidence >= 0.85 ? 'recommended' : 'review_suggested',
        source: 'rules', explanation: `Rule ${m.rule} fired.`, rule: m.rule,
    }));

    return { recommendations, advisories: [], meta: { rules_evaluated: rulesEvaluated, rules_fired: matches.length, ai_invoked: false, ai_tasks: [] } };
}

// ── Near-threshold detection ───────────────────────────────────────────────

function detectNearThresholdSignals(input) {
    const { total_weight_lbs: weight, package_type, dock_available, consignee_type, location_type } = input;
    const effectivePkg = package_type === 'crated' ? 'palletized' : package_type;
    const signals = [];
    if (weight != null) {
        if (effectivePkg === 'loose' && weight >= 255 && weight <= 299) signals.push(`Weight near loose threshold`);
        if (effectivePkg === 'palletized' && weight >= 425 && weight <= 499) signals.push(`Weight near palletized threshold`);
        if (dock_available === 'unknown' && weight > 200) signals.push(`Dock unknown on ${weight} lb shipment`);
    }
    if (consignee_type === 'unknown' && location_type === 'other') signals.push('Both consignee and location unknown');
    return signals;
}

function classifyCase(rulesResult, nearThresholdSignals) {
    const { recommendations } = rulesResult;
    const tasks = [];
    if (recommendations.length > 1) tasks.push('task1_explanation_refinement');
    if (recommendations.some(r => r.confidence >= 0.5 && r.confidence < 0.85)) tasks.push('task2_ambiguity_review');
    if (recommendations.length === 0 && nearThresholdSignals.length > 0) tasks.push('task3_advisory_generation');
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

const AI_TEST_CASES = [
    {
        id: 'AI-001',
        name: 'Task 2: Ambiguous liftgate (palletized, dock unknown)',
        expect_ai: true,
        expect_tasks: ['task2_ambiguity_review'],
        input: { consignee_type: 'commercial', location_type: 'retail_store', package_type: 'palletized', total_weight_lbs: 600, handling_units: 1, dock_available: 'unknown' },
    },
    {
        id: 'AI-002',
        name: 'Task 1+2: Multi-rule + ambiguity (gov building + heavy loose)',
        expect_ai: true,
        expect_tasks: ['task1_explanation_refinement', 'task2_ambiguity_review'],
        input: { consignee_type: 'commercial', location_type: 'government_building', package_type: 'loose', total_weight_lbs: 350, handling_units: 2, dock_available: 'no' },
    },
    {
        id: 'AI-003',
        name: 'Task 3: Near-threshold advisory (palletized 480 lbs, dock unknown)',
        expect_ai: true,
        expect_tasks: ['task3_advisory_generation'],
        input: { consignee_type: 'commercial', location_type: 'warehouse', package_type: 'palletized', total_weight_lbs: 480, handling_units: 1, dock_available: 'unknown' },
    },
    {
        id: 'AI-004',
        name: 'Task 3: Unknown address, moderate weight',
        expect_ai: true,
        expect_tasks: ['task3_advisory_generation'],
        input: { consignee_type: 'unknown', location_type: 'other', package_type: 'loose', total_weight_lbs: 220, handling_units: 1, dock_available: 'unknown' },
    },
    {
        id: 'AI-005',
        name: 'No AI: High confidence residential + liftgate',
        expect_ai: false,
        expect_tasks: [],
        input: { consignee_type: 'residential', location_type: 'home', package_type: 'loose', total_weight_lbs: 450, handling_units: 2, dock_available: 'no' },
    },
    {
        id: 'AI-006',
        name: 'No AI: Clean commercial warehouse',
        expect_ai: false,
        expect_tasks: [],
        input: { consignee_type: 'commercial', location_type: 'warehouse', package_type: 'palletized', total_weight_lbs: 1200, handling_units: 2, dock_available: 'yes' },
    },
    {
        id: 'AI-007',
        name: 'Degradation: Bad API key should fallback gracefully',
        expect_ai: true,
        expect_tasks: ['task3_advisory_generation'],
        input: { consignee_type: 'unknown', location_type: 'other', package_type: 'palletized', total_weight_lbs: 450, handling_units: 1, dock_available: 'unknown' },
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
    const savedKey = API_KEY;
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
