import { useState, useCallback } from 'react';
import { analyzeShipment } from '../engine/analyzer.js';
import { classifyAddress, parseAddress } from '../engine/classifier.js';
import { PRESETS } from '../presets.js';
import ResultsPanel from './ResultsPanel.jsx';

const CONSIGNEE_TYPES = ['commercial', 'residential', 'unknown'];
const LOCATION_TYPES = [
  'warehouse', 'retail_store', 'home', 'apartment', 'school', 'church',
  'hospital', 'military_base', 'prison', 'construction_site', 'mine',
  'mall', 'government_building', 'other',
];
const PACKAGE_TYPES = ['palletized', 'loose', 'crated'];
const DOCK_OPTIONS = ['yes', 'no', 'unknown'];

const DEFAULT_FORM = {
  address: '',
  consignee_type: 'unknown',
  location_type: 'other',
  package_type: 'palletized',
  total_weight_lbs: '',
  handling_units: 1,
  dock_available: 'unknown',
  city: '',
  state: '',
  zip: '',
};

export default function ShipmentAnalyzer({ apiKey, addLogEntry }) {
  const [form, setForm] = useState(DEFAULT_FORM);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  // Track what the classifier detected vs what user may have overridden
  const [autoClassification, setAutoClassification] = useState(null);
  const [overrides, setOverrides] = useState({ consignee_type: false, location_type: false });

  const updateField = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const runClassification = useCallback((addressText) => {
    if (!addressText.trim()) {
      setAutoClassification(null);
      setOverrides({ consignee_type: false, location_type: false });
      return;
    }

    const classification = classifyAddress(addressText);
    const parsed = parseAddress(addressText);

    setAutoClassification(classification);
    setOverrides({ consignee_type: false, location_type: false });

    setForm((prev) => ({
      ...prev,
      consignee_type: classification.consignee_type,
      location_type: classification.location_type,
      city: parsed.city || prev.city,
      state: parsed.state || prev.state,
      zip: parsed.zip || prev.zip,
    }));
  }, []);

  const handleAddressChange = (value) => {
    setForm((prev) => ({ ...prev, address: value }));
  };

  const handleAddressBlur = () => {
    runClassification(form.address);
  };

  const handleAddressKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runClassification(form.address);
    }
  };

  const handleOverride = (field, value) => {
    updateField(field, value);
    setOverrides((prev) => ({ ...prev, [field]: true }));
  };

  const loadPreset = (preset) => {
    const classification = classifyAddress(preset.address);
    const parsed = parseAddress(preset.address);

    setAutoClassification(classification);
    setOverrides({ consignee_type: false, location_type: false });

    setForm({
      address: preset.address,
      consignee_type: classification.consignee_type,
      location_type: classification.location_type,
      package_type: preset.shipment.package_type,
      total_weight_lbs: preset.shipment.total_weight_lbs ?? '',
      handling_units: preset.shipment.handling_units,
      dock_available: preset.shipment.dock_available,
      city: parsed.city,
      state: parsed.state,
      zip: parsed.zip,
    });
    setResult(null);
  };

  const handleAnalyze = async () => {
    // Run classification if not yet done
    if (form.address.trim() && !autoClassification) {
      runClassification(form.address);
    }

    setLoading(true);

    const classificationMethod =
      overrides.consignee_type || overrides.location_type ? 'user_override' : 'auto';

    const input = {
      consignee_type: form.consignee_type,
      location_type: form.location_type,
      package_type: form.package_type,
      total_weight_lbs: form.total_weight_lbs === '' ? null : Number(form.total_weight_lbs),
      handling_units: Number(form.handling_units) || 1,
      dock_available: form.dock_available,
      destination_address: {
        city: form.city,
        state: form.state,
        zip: form.zip,
      },
    };

    const classificationMeta = {
      classification_method: classificationMethod,
      detected_address: form.address,
      parsed_consignee_type: autoClassification?.consignee_type ?? null,
      parsed_location_type: autoClassification?.location_type ?? null,
    };

    const output = await analyzeShipment(input, apiKey || null, classificationMeta);
    setResult(output);

    addLogEntry({
      input,
      rulesOutput: {
        recommendations: output.recommendations.filter((r) => r.source === 'rules'),
        meta: output.meta,
      },
      aiOutput: output.meta.ai_invoked
        ? {
            tasks: output.meta.ai_tasks,
            success: output.meta.ai_success,
            error: output.meta.ai_error,
          }
        : null,
      finalOutput: output,
    });

    setLoading(false);
  };

  return (
    <div>
      {/* Preset Buttons */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => loadPreset(p)}
            className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-300 rounded hover:bg-gray-50 transition-colors"
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Form */}
        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            Shipment Details
          </h2>
          <div className="space-y-4">
            {/* Address Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Destination Address
              </label>
              <input
                type="text"
                value={form.address}
                onChange={(e) => handleAddressChange(e.target.value)}
                onBlur={handleAddressBlur}
                onKeyDown={handleAddressKeyDown}
                placeholder="e.g., 123 Oak St, Pasadena, CA 91101"
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                Type an address and press Enter or click away to auto-classify
              </p>
            </div>

            {/* Classification Result */}
            {autoClassification && (
              <div className="bg-gray-50 border border-gray-200 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Classification
                  </span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                    Auto-detected
                  </span>
                </div>
                <div className="flex gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Consignee: </span>
                    <span className="font-medium text-gray-800">
                      {autoClassification.consignee_type}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Location: </span>
                    <span className="font-medium text-gray-800">
                      {autoClassification.location_type.replace(/_/g, ' ')}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Consignee Type with override tracking */}
            <ClassifiedSelect
              label="Consignee Type"
              value={form.consignee_type}
              options={CONSIGNEE_TYPES}
              onChange={(v) => handleOverride('consignee_type', v)}
              isOverridden={overrides.consignee_type}
              autoValue={autoClassification?.consignee_type}
            />

            {/* Location Type with override tracking */}
            <ClassifiedSelect
              label="Location Type"
              value={form.location_type}
              options={LOCATION_TYPES}
              onChange={(v) => handleOverride('location_type', v)}
              isOverridden={overrides.location_type}
              autoValue={autoClassification?.location_type}
            />

            <FormSelect
              label="Package Type"
              value={form.package_type}
              options={PACKAGE_TYPES}
              onChange={(v) => updateField('package_type', v)}
            />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Total Weight (lbs)</label>
                <input
                  type="number"
                  value={form.total_weight_lbs}
                  onChange={(e) => updateField('total_weight_lbs', e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Handling Units</label>
                <input
                  type="number"
                  value={form.handling_units}
                  onChange={(e) => updateField('handling_units', e.target.value)}
                  min="1"
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <FormSelect
              label="Dock Available"
              value={form.dock_available}
              options={DOCK_OPTIONS}
              onChange={(v) => updateField('dock_available', v)}
            />

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">City</label>
                <input
                  type="text"
                  value={form.city}
                  onChange={(e) => updateField('city', e.target.value)}
                  placeholder="City"
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">State</label>
                <input
                  type="text"
                  value={form.state}
                  onChange={(e) => updateField('state', e.target.value)}
                  placeholder="CA"
                  maxLength={2}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm uppercase"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">ZIP</label>
                <input
                  type="text"
                  value={form.zip}
                  onChange={(e) => updateField('zip', e.target.value)}
                  placeholder="90001"
                  maxLength={5}
                  className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="w-full bg-blue-600 text-white text-sm font-medium py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Analyzing...' : 'Analyze Shipment'}
            </button>
          </div>
        </div>

        {/* Results */}
        <div>
          {result ? (
            <ResultsPanel result={result} />
          ) : (
            <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-sm text-gray-400">
              Enter a destination address and shipment details, then click "Analyze Shipment" to see recommendations.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ClassifiedSelect({ label, value, options, onChange, isOverridden, autoValue }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <label className="block text-sm text-gray-600">{label}</label>
        {autoValue && !isOverridden && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-600">
            System classified: {autoValue.replace(/_/g, ' ')}
          </span>
        )}
        {isOverridden && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-50 text-amber-700">
            User override
          </span>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </div>
  );
}

function FormSelect({ label, value, options, onChange }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm bg-white"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt.replace(/_/g, ' ')}
          </option>
        ))}
      </select>
    </div>
  );
}
