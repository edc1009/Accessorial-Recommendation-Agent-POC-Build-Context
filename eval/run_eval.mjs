// eval/run_eval.mjs
// Runs the rules engine against test-dataset.json and prints Precision/Recall/F1

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { evaluateRules } from '../src/engine/rules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    const { recommendations: recs } = evaluateRules(tc.input);
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
