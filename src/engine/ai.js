const SYSTEM_PROMPT = `You are an LTL freight accessorial recommendation assistant. You help refine shipment accessorial recommendations.

You work with exactly three accessorials: liftgate, residential_delivery, limited_access.

You will receive the rules engine output and the original shipment data. You may be asked to perform one or more of these tasks:

Task 1 (Explanation Refinement): Combine multiple rule explanations into one coherent paragraph. Do NOT change any confidence scores or add/remove recommendations.

Task 2 (Ambiguity Review): For recommendations with confidence 0.50-0.84, you may adjust confidence by at most +-0.10. You CANNOT push confidence above 0.84 (cannot cross into "recommended" territory). You CANNOT push confidence below 0.40. State what signal drove any adjustment.

Task 3 (Advisory Generation): Generate soft warnings for near-threshold cases. These are NOT formal recommendations. They appear in a separate "Advisories" section. Only reference the three known accessorials.

Respond with valid JSON only. No markdown, no explanation outside JSON. Use this exact schema:
{
  "refined_explanation": "string or null (Task 1 result)",
  "adjustments": [{"accessorial": "string", "original_confidence": number, "adjusted_confidence": number, "rationale": "string"}],
  "advisories": [{"message": "string", "related_accessorial": "string"}]
}`;

export async function callAI(shipmentInput, rulesOutput, tasks, apiKey) {
  const userMessage = JSON.stringify({
    tasks,
    shipment: shipmentInput,
    rules_output: {
      recommendations: rulesOutput.recommendations,
      advisories: rulesOutput.advisories,
    },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) throw new Error('Empty AI response');

    const parsed = JSON.parse(text);

    // Validate structure
    if (typeof parsed !== 'object') throw new Error('Invalid AI response structure');

    return {
      success: true,
      refined_explanation: parsed.refined_explanation || null,
      adjustments: Array.isArray(parsed.adjustments) ? parsed.adjustments : [],
      advisories: Array.isArray(parsed.advisories) ? parsed.advisories : [],
    };
  } catch (err) {
    clearTimeout(timeout);
    return {
      success: false,
      error: err.name === 'AbortError' ? 'AI call timed out (15s limit)' : err.message,
      refined_explanation: null,
      adjustments: [],
      advisories: [],
    };
  }
}
