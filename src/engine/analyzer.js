import { evaluateRules } from './rules.js';
import { callAI } from './ai.js';

// Near-threshold ranges for advisory generation (Task 3)
const NEAR_THRESHOLD_LOOSE_MIN = 255;  // 300 * 0.85
const NEAR_THRESHOLD_LOOSE_MAX = 299;
const NEAR_THRESHOLD_PALLET_MIN = 425; // 500 * 0.85
const NEAR_THRESHOLD_PALLET_MAX = 499;

function detectNearThresholdSignals(input) {
  const { total_weight_lbs: weight, package_type, dock_available, consignee_type, location_type } = input;
  const effectivePkg = package_type === 'crated' ? 'palletized' : package_type;
  const signals = [];

  if (weight != null) {
    if (effectivePkg === 'loose' && weight >= NEAR_THRESHOLD_LOOSE_MIN && weight <= NEAR_THRESHOLD_LOOSE_MAX) {
      signals.push(`Weight (${weight} lbs) is within 15% of the ${effectivePkg === 'loose' ? '300' : '500'} lb liftgate threshold for loose freight.`);
    }
    if (effectivePkg === 'palletized' && weight >= NEAR_THRESHOLD_PALLET_MIN && weight <= NEAR_THRESHOLD_PALLET_MAX) {
      signals.push(`Weight (${weight} lbs) is within 15% of the 500 lb liftgate threshold for palletized freight.`);
    }
    if (dock_available === 'unknown' && weight > 200) {
      signals.push(`Dock availability unknown on a ${weight} lb shipment.`);
    }
  }

  if (consignee_type === 'unknown' && location_type === 'other') {
    signals.push('Both consignee type and location type are unknown/other.');
  }

  return signals;
}

function classifyCase(rulesResult, nearThresholdSignals) {
  const { recommendations } = rulesResult;
  const tasks = [];

  const hasAmbiguous = recommendations.some((r) => r.confidence >= 0.5 && r.confidence < 0.85);
  const hasMultiple = recommendations.length > 1;
  const noRulesFired = recommendations.length === 0;
  const hasNearThreshold = nearThresholdSignals.length > 0;

  if (hasMultiple) tasks.push('task1_explanation_refinement');
  if (hasAmbiguous) tasks.push('task2_ambiguity_review');
  if (noRulesFired && hasNearThreshold) tasks.push('task3_advisory_generation');

  return tasks;
}

function applyAIAdjustments(recommendations, aiResult) {
  if (!aiResult.success) return recommendations;

  return recommendations.map((rec) => {
    const adj = aiResult.adjustments.find((a) => a.accessorial === rec.accessorial);
    if (!adj || rec.confidence >= 0.85) return rec; // Don't touch high-confidence results

    let newConf = adj.adjusted_confidence;

    // Enforce guardrails
    const maxDelta = 0.10;
    if (Math.abs(newConf - rec.confidence) > maxDelta + 0.001) {
      newConf = rec.confidence + Math.sign(newConf - rec.confidence) * maxDelta;
    }
    if (newConf >= 0.85) newConf = 0.84; // Cannot cross recommended boundary
    if (newConf < 0.40) newConf = 0.40;  // Cannot suppress below 0.40

    newConf = Math.round(newConf * 100) / 100;

    return {
      ...rec,
      confidence: newConf,
      level: newConf >= 0.85 ? 'recommended' : 'review_suggested',
      source: 'ai',
      explanation: rec.explanation + (adj.rationale ? ` AI note: ${adj.rationale}` : ''),
    };
  });
}

export async function analyzeShipment(input, apiKey, classificationMeta = null) {
  const totalStart = performance.now();

  // Step 1: Run rules engine
  const rulesResult = evaluateRules(input);

  // Step 2: Detect near-threshold signals
  const nearThresholdSignals = detectNearThresholdSignals(input);

  // Step 3: Classify case
  const aiTasks = classifyCase(rulesResult, nearThresholdSignals);

  let finalRecommendations = [...rulesResult.recommendations];
  let finalAdvisories = [...rulesResult.advisories];
  let aiResult = null;
  let aiInvoked = false;

  // Step 4: Call AI if needed and API key available
  if (aiTasks.length > 0 && apiKey) {
    aiInvoked = true;
    aiResult = await callAI(input, rulesResult, aiTasks, apiKey);

    if (aiResult.success) {
      // Apply Task 1: refined explanation
      if (aiResult.refined_explanation && aiTasks.includes('task1_explanation_refinement')) {
        // Add refined explanation as a combined note on the first recommendation
        if (finalRecommendations.length > 0) {
          finalRecommendations[0] = {
            ...finalRecommendations[0],
            refined_explanation: aiResult.refined_explanation,
          };
        }
      }

      // Apply Task 2: confidence adjustments
      if (aiTasks.includes('task2_ambiguity_review')) {
        finalRecommendations = applyAIAdjustments(finalRecommendations, aiResult);
      }

      // Apply Task 3: advisories
      if (aiResult.advisories.length > 0) {
        for (const adv of aiResult.advisories) {
          finalAdvisories.push({
            type: 'near_threshold',
            message: adv.message,
            source: 'ai',
          });
        }
      }
    }
  }

  const totalElapsed = performance.now() - totalStart;

  return {
    recommendations: finalRecommendations,
    advisories: finalAdvisories,
    meta: {
      processing_time_ms: Math.round(totalElapsed * 100) / 100,
      rules_evaluated: rulesResult.meta.rules_evaluated,
      rules_fired: rulesResult.meta.rules_fired,
      ai_invoked: aiInvoked,
      ai_tasks: aiTasks,
      ai_success: aiResult?.success ?? null,
      ai_error: aiResult?.error ?? null,
      near_threshold_signals: nearThresholdSignals,
      ...(classificationMeta ? {
        classification_method: classificationMeta.classification_method,
        detected_address: classificationMeta.detected_address,
        parsed_consignee_type: classificationMeta.parsed_consignee_type,
        parsed_location_type: classificationMeta.parsed_location_type,
      } : {}),
    },
  };
}
