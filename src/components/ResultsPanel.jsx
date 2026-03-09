import { useState } from 'react';

function ConfidenceBadge({ level }) {
  if (level === 'recommended') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
        Recommended
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-800">
      Review Suggested
    </span>
  );
}

function SourceTag({ source }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs ${source === 'ai' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
      }`}>
      {source}
    </span>
  );
}

function AccessorialName({ name }) {
  const display = name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return <span className="font-semibold text-gray-900">{display}</span>;
}

export default function ResultsPanel({ result }) {
  const [metaOpen, setMetaOpen] = useState(false);

  if (!result) return null;

  const { recommendations, advisories, meta } = result;

  return (
    <div className="space-y-6">
      {/* Recommendations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">
            Recommendations
          </h3>
          {meta.detected_address && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(meta.detected_address)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1 bg-blue-50 px-2 py-1 rounded border border-blue-100 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Verify on Google Maps
            </a>
          )}
        </div>

        {recommendations.length === 0 ? (
          advisories.length > 0 ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="flex h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
                <span className="text-sm font-bold text-amber-800">Action Required: Review Recommended</span>
              </div>
              <p className="text-sm text-amber-700">
                No automatic rules were triggered, but the AI flagged potential risks. Please verify the destination details below.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-500">
              No accessorials recommended for this shipment.
            </div>
          )
        ) : (
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <div key={rec.accessorial} className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <AccessorialName name={rec.accessorial} />
                    <span className="text-sm font-mono text-gray-600">
                      {Math.round(rec.confidence * 100)}%
                    </span>
                    <ConfidenceBadge level={rec.level} />
                    <SourceTag source={rec.source} />
                  </div>

                  {/* Accuracy Rating */}
                  <div className="flex items-center gap-1">
                    <button
                      title="Accurate"
                      className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                      onClick={() => alert(`Thank you! Marked ${rec.accessorial} as accurate.`)}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                      </svg>
                    </button>
                    <button
                      title="Inaccurate"
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      onClick={() => alert(`We'll investigate why ${rec.accessorial} was flagged incorrectly.`)}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14H5.236a2 2 0 01-1.789-2.894l3.5-7A2 2 0 018.737 3h4.018c.163 0 .326.02.485.06L17 4m-7 10v5a2 2 0 002 2h.095c.5 0 .905-.405.905-.905 0-.714.211-1.412.608-2.006L17 13V4m-7 10h2m5-10h2a2 2 0 012 2v6a2 2 0 01-2 2h-2.5" />
                      </svg>
                    </button>
                  </div>
                </div>

                <p className="text-sm text-gray-600">{rec.explanation}</p>
                {rec.refined_explanation && (
                  <p className="text-sm text-purple-700 mt-2 italic border-l-2 border-purple-200 pl-3">{rec.refined_explanation}</p>
                )}

                {/* Direct Actions */}
                <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-end gap-2">
                  <button
                    className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-md transition-colors"
                    onClick={() => alert(`Ignored ${rec.accessorial}`)}
                  >
                    Dismiss
                  </button>
                  <button
                    className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 rounded-md shadow-sm transition-colors"
                    onClick={() => alert(`Added ${rec.accessorial} to shipment charges.`)}
                  >
                    Add to Billing
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
        }
      </div>

      {/* Advisories */}
      {advisories.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Advisories
          </h3>
          <div className="space-y-2">
            {advisories.map((adv, i) => (
              <div key={i} className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-blue-600 uppercase">Advisory</span>
                  <SourceTag source={adv.source} />
                </div>
                <p className="text-sm text-blue-800">{adv.message}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meta (collapsible) */}
      <div>
        <button
          onClick={() => setMetaOpen(!metaOpen)}
          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
        >
          <span>{metaOpen ? '\u25BC' : '\u25B6'}</span>
          Processing Details
        </button>
        {metaOpen && (
          <div className="mt-2 bg-gray-50 border border-gray-200 rounded p-3 text-xs text-gray-500 space-y-1 font-mono">
            <div>Processing time: {meta.processing_time_ms}ms</div>
            <div>Rules evaluated: {meta.rules_evaluated}</div>
            <div>Rules fired: {meta.rules_fired}</div>
            <div>AI invoked: {meta.ai_invoked ? 'Yes' : 'No'}</div>
            {meta.ai_tasks.length > 0 && <div>AI tasks: {meta.ai_tasks.join(', ')}</div>}
            {meta.ai_error && <div className="text-red-500">AI error: {meta.ai_error}</div>}
            {meta.near_threshold_signals?.length > 0 && (
              <div>Near-threshold signals: {meta.near_threshold_signals.join('; ')}</div>
            )}
            {meta.classification_method && (
              <>
                <div className="border-t border-gray-200 pt-1 mt-1">Classification</div>
                <div>Classification method: {meta.classification_method}</div>
                {meta.detected_address && <div>Detected address: {meta.detected_address}</div>}
                {meta.parsed_consignee_type && <div>Parsed consignee type: {meta.parsed_consignee_type}</div>}
                {meta.parsed_location_type && <div>Parsed location type: {meta.parsed_location_type}</div>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
