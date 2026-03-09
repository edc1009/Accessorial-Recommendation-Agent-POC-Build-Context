// eval/run_eval.mjs
// Runs the rules engine against test-dataset.json and prints Precision/Recall/F1

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Inline rules engine (copied from src/engine/rules.js) ──────────────────

const LIMITED_ACCESS_LOCATIONS = [
    'school', 'church', 'hospital', 'military_base', 'prison',
    'construction_site', 'mine', 'storage_unit',
];

function evaluateRules(input) {
    const {
        consignee_type,
        location_type,
        package_type,
        total_weight_lbs: weight,
        handling_units,
        dock_available,
    } = input;

    const effectivePkg = package_type === 'crated' ? 'palletized' : package_type;
    const isResidential = consignee_type === 'residential';
    const hasWeight = weight != null && weight > 0;

    const matches = [];

    if (hasWeight) {
        if (weight >= 300 && effectivePkg === 'loose' && dock_available === 'no')
            matches.push({ accessorial: 'liftgate', confidence: 0.95, rule: 'L1' });

        if (weight >= 300 && effectivePkg === 'loose' && dock_available === 'unknown')
            matches.push({ accessorial: 'liftgate', confidence: 0.80, rule: 'L2' });

        if (weight >= 500 && effectivePkg === 'palletized' && dock_available === 'no')
            matches.push({ accessorial: 'liftgate', confidence: 0.92, rule: 'L3' });

        if (weight >= 500 && effectivePkg === 'palletized' && dock_available === 'unknown')
            matches.push({ accessorial: 'liftgate', confidence: 0.75, rule: 'L4' });

        if (weight >= 150 && effectivePkg === 'loose' && dock_available === 'no' && isResidential)
            matches.push({ accessorial: 'liftgate', confidence: 0.93, rule: 'L5' });

        if (weight >= 100 && isResidential && dock_available === 'no')
            matches.push({ accessorial: 'liftgate', confidence: 0.70, rule: 'L6' });
    }

    if (consignee_type === 'residential')
        matches.push({ accessorial: 'residential_delivery', confidence: 0.95, rule: 'R1' });

    if (location_type === 'home' || location_type === 'apartment')
        matches.push({ accessorial: 'residential_delivery', confidence: 0.95, rule: 'R2' });

    if (LIMITED_ACCESS_LOCATIONS.includes(location_type))
        matches.push({ accessorial: 'limited_access', confidence: 0.90, rule: 'A1' });

    if (location_type === 'mall')
        matches.push({ accessorial: 'limited_access', confidence: 0.85, rule: 'A2' });

    if (location_type === 'government_building')
        matches.push({ accessorial: 'limited_access', confidence: 0.82, rule: 'A3' });

    if (isResidential && handling_units >= 3)
        matches.push({ accessorial: 'limited_access', confidence: 0.60, rule: 'A4' });

    // Deduplicate: keep highest confidence per accessorial
    const best = {};
    for (const m of matches) {
        if (!best[m.accessorial] || m.confidence > best[m.accessorial].confidence)
            best[m.accessorial] = m;
    }

    return Object.values(best);
}

// ── Load test dataset ──────────────────────────────────────────────────────

const dataset = JSON.parse(
    readFileSync(path.join(__dirname, '../docs/test-dataset.json'), 'utf8')
);

// ── Run tests ──────────────────────────────────────────────────────────────

const ACCESSORIAL_TYPES = ['liftgate', 'residential_delivery', 'limited_access'];

let passCount = 0;
const failures = [];

const perTypeStats = {};
for (const t of ACCESSORIAL_TYPES) perTypeStats[t] = { tp: 0, fp: 0, fn: 0 };

for (const tc of dataset) {
    const recs = evaluateRules(tc.input);
    const actual = recs.map(r => r.accessorial).sort();
    const expected = [...(tc.expected.accessorials || [])].sort();

    // Accessorial match
    const accessorialsMatch =
        actual.length === expected.length &&
        actual.every((a, i) => a === expected[i]);

    // Confidence minimums
    let confidencePass = true;
    for (const rec of recs) {
        const minKey = `${rec.accessorial}_confidence_min`;
        if (tc.expected[minKey] != null && rec.confidence < tc.expected[minKey]) {
            confidencePass = false;
        }
    }

    const pass = accessorialsMatch && confidencePass;
    if (pass) passCount++;
    else failures.push({ tc, actual, expected, recs });

    // Per-type TP/FP/FN
    for (const type of ACCESSORIAL_TYPES) {
        const inExpected = expected.includes(type);
        const inActual = actual.includes(type);
        if (inExpected && inActual) perTypeStats[type].tp++;
        else if (!inExpected && inActual) perTypeStats[type].fp++;
        else if (inExpected && !inActual) perTypeStats[type].fn++;
    }
}

// ── Compute metrics ────────────────────────────────────────────────────────

function pct(n) { return (n * 100).toFixed(1) + '%'; }

console.log('\n========================================');
console.log('  ACCESSORIAL RECOMMENDATION AGENT EVAL');
console.log('========================================\n');

console.log(`Overall pass rate: ${passCount}/${dataset.length} (${pct(passCount / dataset.length)})\n`);

let totalTp = 0, totalFp = 0, totalFn = 0;

console.log('Per-accessorial metrics:');
console.log('─'.repeat(72));
console.log(
    'Accessorial'.padEnd(24),
    'TP'.padStart(4), 'FP'.padStart(4), 'FN'.padStart(4),
    'Precision'.padStart(12), 'Recall'.padStart(10), 'F1'.padStart(8)
);
console.log('─'.repeat(72));

for (const [type, s] of Object.entries(perTypeStats)) {
    const precision = s.tp + s.fp > 0 ? s.tp / (s.tp + s.fp) : 1;
    const recall = s.tp + s.fn > 0 ? s.tp / (s.tp + s.fn) : 1;
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    totalTp += s.tp; totalFp += s.fp; totalFn += s.fn;

    console.log(
        type.replace(/_/g, ' ').padEnd(24),
        String(s.tp).padStart(4), String(s.fp).padStart(4), String(s.fn).padStart(4),
        pct(precision).padStart(12), pct(recall).padStart(10), pct(f1).padStart(8)
    );
}

const overallP = totalTp + totalFp > 0 ? totalTp / (totalTp + totalFp) : 1;
const overallR = totalTp + totalFn > 0 ? totalTp / (totalTp + totalFn) : 1;
const overallF1 = overallP + overallR > 0 ? 2 * overallP * overallR / (overallP + overallR) : 0;

console.log('─'.repeat(72));
console.log(
    'OVERALL (micro)'.padEnd(24),
    String(totalTp).padStart(4), String(totalFp).padStart(4), String(totalFn).padStart(4),
    pct(overallP).padStart(12), pct(overallR).padStart(10), pct(overallF1).padStart(8)
);
console.log('─'.repeat(72));

// ── Design targets ─────────────────────────────────────────────────────────

console.log('\nTarget check (from design doc):');
console.log(`  Precision ≥ 85%: ${overallP >= 0.85 ? '✅ PASS' : '❌ FAIL'} (${pct(overallP)})`);
console.log(`  Recall    ≥ 70%: ${overallR >= 0.70 ? '✅ PASS' : '❌ FAIL'} (${pct(overallR)})`);

// ── Failure breakdown ──────────────────────────────────────────────────────

if (failures.length > 0) {
    console.log(`\nFailed cases (${failures.length}):`);
    console.log('─'.repeat(60));
    for (const { tc, actual, expected, recs } of failures) {
        console.log(`[${tc.test_id}] ${tc.description}`);
        console.log(`  Expected : ${expected.length ? expected.join(', ') : '(none)'}`);
        console.log(`  Actual   : ${actual.length ? actual.join(', ') : '(none)'}`);
        const confStr = recs.map(r => `${r.accessorial}=${pct(r.confidence)}`).join(', ');
        if (confStr) console.log(`  Conf     : ${confStr}`);
        console.log(`  Rationale: ${tc.rationale}`);
        console.log();
    }
} else {
    console.log('\n🎉 All tests passed!');
}
