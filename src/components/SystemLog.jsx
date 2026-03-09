import { useState } from 'react';

function LogEntry({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const { timestamp, input, aiOutput, finalOutput } = entry;

  const recSummary = finalOutput.recommendations.length > 0
    ? finalOutput.recommendations.map((r) => `${r.accessorial} (${Math.round(r.confidence * 100)}%)`).join(', ')
    : 'none';

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-xs font-mono text-gray-400">
              {new Date(timestamp).toLocaleTimeString()}
            </span>
            {finalOutput.meta.ai_invoked && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">AI</span>
            )}
          </div>
          <div className="text-sm text-gray-700">
            <span className="font-medium">{input.consignee_type}</span>
            {' / '}
            <span>{input.location_type}</span>
            {' / '}
            <span>{input.package_type}</span>
            {input.total_weight_lbs != null && ` / ${input.total_weight_lbs} lbs`}
            {' / dock: '}
            <span>{input.dock_available}</span>
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            Recommendations: {recSummary}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
        >
          {expanded ? 'Collapse' : 'Details'}
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-3 text-xs font-mono">
          <div>
            <div className="text-gray-500 mb-1 font-sans font-medium">Input</div>
            <pre className="bg-gray-50 rounded p-2 overflow-x-auto text-gray-600">
              {JSON.stringify(input, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-gray-500 mb-1 font-sans font-medium">Rules Output</div>
            <pre className="bg-gray-50 rounded p-2 overflow-x-auto text-gray-600">
              {JSON.stringify(
                finalOutput.recommendations.filter((r) => r.source === 'rules'),
                null, 2
              )}
            </pre>
          </div>
          {aiOutput && (
            <div>
              <div className="text-purple-600 mb-1 font-sans font-medium">AI Output</div>
              <pre className="bg-purple-50 rounded p-2 overflow-x-auto text-purple-700">
                {JSON.stringify(aiOutput, null, 2)}
              </pre>
            </div>
          )}
          <div>
            <div className="text-gray-500 mb-1 font-sans font-medium">Final Output</div>
            <pre className="bg-gray-50 rounded p-2 overflow-x-auto text-gray-600">
              {JSON.stringify(finalOutput, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SystemLog({ entries }) {
  if (entries.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-400">
        No requests processed yet. Use the Shipment Analyzer to generate log entries.
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">
        Audit Trail ({entries.length} entries)
      </h2>
      <div className="space-y-3">
        {entries.map((entry, i) => (
          <LogEntry key={i} entry={entry} />
        ))}
      </div>
    </div>
  );
}
