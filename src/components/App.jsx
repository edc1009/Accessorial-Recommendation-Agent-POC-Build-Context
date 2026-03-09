import { useState } from 'react';
import ShipmentAnalyzer from './ShipmentAnalyzer.jsx';
import TestRunner from './TestRunner.jsx';
import SystemLog from './SystemLog.jsx';

const TABS = ['Shipment Analyzer', 'Test Runner', 'System Log'];

export default function App() {
  const [activeTab, setActiveTab] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [sessionLog, setSessionLog] = useState([]);

  const addLogEntry = (entry) => {
    setSessionLog((prev) => [{ ...entry, timestamp: new Date().toISOString() }, ...prev]);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Accessorial Recommendation Agent</h1>
            <p className="text-sm text-gray-500">Hybrid Rules Engine + AI for LTL Shipment Accessorials</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm text-gray-600 whitespace-nowrap">Claude API Key:</label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-..."
              className="border border-gray-300 rounded px-3 py-1.5 text-sm w-64 font-mono"
            />
            {apiKey ? (
              <span className="text-xs text-green-600 font-medium">AI enabled</span>
            ) : (
              <span className="text-xs text-gray-400">Rules-only mode</span>
            )}
          </div>
        </div>
        <p className="max-w-7xl mx-auto text-xs text-gray-400 mt-1">
          API key is stored in browser memory only, never sent to any server except Anthropic's API.
        </p>
      </header>

      {/* Tabs */}
      <div className="max-w-7xl mx-auto px-6">
        <nav className="flex gap-1 mt-4 border-b border-gray-200">
          {TABS.map((tab, i) => (
            <button
              key={tab}
              onClick={() => setActiveTab(i)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === i
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
              {i === 2 && sessionLog.length > 0 && (
                <span className="ml-1.5 bg-gray-200 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">
                  {sessionLog.length}
                </span>
              )}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {activeTab === 0 && <ShipmentAnalyzer apiKey={apiKey} addLogEntry={addLogEntry} />}
        {activeTab === 1 && <TestRunner />}
        {activeTab === 2 && <SystemLog entries={sessionLog} />}
      </main>
    </div>
  );
}
