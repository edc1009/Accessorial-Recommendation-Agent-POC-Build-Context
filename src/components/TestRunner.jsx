import { useState } from 'react';
import { evaluateRules } from '../engine/rules.js';
import testDataset from '../../docs/test-dataset.json';

function runTests() {
  const results = testDataset.map((tc) => {
    const output = evaluateRules(tc.input);
    const actualAccessorials = output.recommendations.map((r) => r.accessorial).sort();
    const expectedAccessorials = [...(tc.expected.accessorials || [])].sort();

    // Check accessorial match
    const accessorialsMatch =
      actualAccessorials.length === expectedAccessorials.length &&
      actualAccessorials.every((a, i) => a === expectedAccessorials[i]);

    // Check confidence minimums
    let confidencePass = true;
    const confidenceDetails = {};
    for (const rec of output.recommendations) {
      const minKey = `${rec.accessorial}_confidence_min`;
      const expectedMin = tc.expected[minKey];
      confidenceDetails[rec.accessorial] = rec.confidence;
      if (expectedMin != null && rec.confidence < expectedMin) {
        confidencePass = false;
      }
    }

    const pass = accessorialsMatch && confidencePass;

    return {
      test_id: tc.test_id,
      category: tc.category,
      description: tc.description,
      expected: expectedAccessorials,
      actual: actualAccessorials,
      confidences: confidenceDetails,
      expectedConfidences: Object.fromEntries(
        Object.entries(tc.expected)
          .filter(([k]) => k.endsWith('_confidence_min'))
          .map(([k, v]) => [k.replace('_confidence_min', ''), v])
      ),
      pass,
      accessorialsMatch,
      confidencePass,
    };
  });

  return results;
}

function computeMetrics(results) {
  const accessorialTypes = ['liftgate', 'residential_delivery', 'limited_access'];
  const metrics = {};

  for (const type of accessorialTypes) {
    let tp = 0, fp = 0, fn = 0;
    for (const r of results) {
      const expected = r.expected.includes(type);
      const actual = r.actual.includes(type);
      if (expected && actual) tp++;
      else if (!expected && actual) fp++;
      else if (expected && !actual) fn++;
    }
    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 1;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    metrics[type] = { tp, fp, fn, precision, recall, f1 };
  }

  // Overall (micro-average)
  let totalTp = 0, totalFp = 0, totalFn = 0;
  for (const m of Object.values(metrics)) {
    totalTp += m.tp;
    totalFp += m.fp;
    totalFn += m.fn;
  }
  const overallPrecision = totalTp + totalFp > 0 ? totalTp / (totalTp + totalFp) : 1;
  const overallRecall = totalTp + totalFn > 0 ? totalTp / (totalTp + totalFn) : 1;
  const overallF1 = overallPrecision + overallRecall > 0
    ? (2 * overallPrecision * overallRecall) / (overallPrecision + overallRecall)
    : 0;

  return { byType: metrics, overall: { precision: overallPrecision, recall: overallRecall, f1: overallF1 } };
}

function pct(n) {
  return (n * 100).toFixed(1) + '%';
}

export default function TestRunner() {
  const [results, setResults] = useState(null);
  const [metrics, setMetrics] = useState(null);

  const handleRun = () => {
    const r = runTests();
    setResults(r);
    setMetrics(computeMetrics(r));
  };

  const passCount = results?.filter((r) => r.pass).length ?? 0;
  const totalCount = results?.length ?? 0;

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={handleRun}
          className="bg-blue-600 text-white text-sm font-medium py-2 px-5 rounded hover:bg-blue-700 transition-colors"
        >
          Run All Tests
        </button>
        {results && (
          <span className={`text-sm font-medium ${passCount === totalCount ? 'text-green-600' : 'text-red-600'}`}>
            {passCount}/{totalCount} passed
          </span>
        )}
        <span className="text-xs text-gray-400">Tests run rules-only (no AI)</span>
      </div>

      {results && (
        <>
          {/* Results Table */}
          <div className="overflow-x-auto mb-8">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-gray-100 text-left">
                  <th className="px-3 py-2 border border-gray-200 font-medium">Test ID</th>
                  <th className="px-3 py-2 border border-gray-200 font-medium">Description</th>
                  <th className="px-3 py-2 border border-gray-200 font-medium">Expected</th>
                  <th className="px-3 py-2 border border-gray-200 font-medium">Actual</th>
                  <th className="px-3 py-2 border border-gray-200 font-medium">Confidence</th>
                  <th className="px-3 py-2 border border-gray-200 font-medium text-center">Result</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.test_id} className={r.pass ? '' : 'bg-red-50'}>
                    <td className="px-3 py-2 border border-gray-200 font-mono text-xs">{r.test_id}</td>
                    <td className="px-3 py-2 border border-gray-200">{r.description}</td>
                    <td className="px-3 py-2 border border-gray-200">
                      {r.expected.length === 0 ? (
                        <span className="text-gray-400">none</span>
                      ) : (
                        <div className="space-y-0.5">
                          {r.expected.map((a) => (
                            <div key={a} className="text-xs">
                              {a.replace(/_/g, ' ')}
                              {r.expectedConfidences[a] != null && (
                                <span className="text-gray-400 ml-1">
                                  (min {pct(r.expectedConfidences[a])})
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 border border-gray-200">
                      {r.actual.length === 0 ? (
                        <span className="text-gray-400">none</span>
                      ) : (
                        <div className="space-y-0.5">
                          {r.actual.map((a) => {
                            const isExtra = !r.expected.includes(a);
                            return (
                              <div key={a} className={`text-xs ${isExtra ? 'text-red-600 font-medium' : ''}`}>
                                {a.replace(/_/g, ' ')}
                                {isExtra && ' (extra)'}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 border border-gray-200 font-mono text-xs">
                      {Object.entries(r.confidences).map(([a, c]) => (
                        <div key={a}>
                          {a.replace(/_/g, ' ')}: {pct(c)}
                        </div>
                      ))}
                    </td>
                    <td className="px-3 py-2 border border-gray-200 text-center">
                      {r.pass ? (
                        <span className="text-green-600 font-bold">PASS</span>
                      ) : (
                        <span className="text-red-600 font-bold">FAIL</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Metrics Summary */}
          {metrics && (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
                Evaluation Metrics
              </h3>
              <table className="w-full text-sm border-collapse mb-4">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-2 border border-gray-200 font-medium">Accessorial</th>
                    <th className="px-3 py-2 border border-gray-200 font-medium text-center">TP</th>
                    <th className="px-3 py-2 border border-gray-200 font-medium text-center">FP</th>
                    <th className="px-3 py-2 border border-gray-200 font-medium text-center">FN</th>
                    <th className="px-3 py-2 border border-gray-200 font-medium text-center">Precision</th>
                    <th className="px-3 py-2 border border-gray-200 font-medium text-center">Recall</th>
                    <th className="px-3 py-2 border border-gray-200 font-medium text-center">F1</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(metrics.byType).map(([type, m]) => (
                    <tr key={type}>
                      <td className="px-3 py-2 border border-gray-200">{type.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2 border border-gray-200 text-center">{m.tp}</td>
                      <td className="px-3 py-2 border border-gray-200 text-center">{m.fp}</td>
                      <td className="px-3 py-2 border border-gray-200 text-center">{m.fn}</td>
                      <td className="px-3 py-2 border border-gray-200 text-center font-medium">{pct(m.precision)}</td>
                      <td className="px-3 py-2 border border-gray-200 text-center font-medium">{pct(m.recall)}</td>
                      <td className="px-3 py-2 border border-gray-200 text-center font-medium">{pct(m.f1)}</td>
                    </tr>
                  ))}
                  <tr className="bg-blue-50 font-semibold">
                    <td className="px-3 py-2 border border-gray-200">Overall (micro)</td>
                    <td className="px-3 py-2 border border-gray-200 text-center" colSpan={3}></td>
                    <td className="px-3 py-2 border border-gray-200 text-center">{pct(metrics.overall.precision)}</td>
                    <td className="px-3 py-2 border border-gray-200 text-center">{pct(metrics.overall.recall)}</td>
                    <td className="px-3 py-2 border border-gray-200 text-center">{pct(metrics.overall.f1)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
