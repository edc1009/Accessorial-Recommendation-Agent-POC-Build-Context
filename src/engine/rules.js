const LIMITED_ACCESS_LOCATION_TYPES = new Set([
    'school',
    'church',
    'hospital',
    'military_base',
    'prison',
    'construction_site',
    'mine',
    'mini_storage',
    'storage_unit',
    'fairgrounds',
    'carnival',
    'convention_center',
    'expo_center',
    'airport',
    'pier',
    'wharf',
    'mall',
    'government_building',
    'courthouse',
    'daycare',
    'country_club',
    'park',
    'library',
    'marina',
    'golf_course',
]);

const RESIDENTIAL_LOCATION_TYPES = new Set([
    'home',
    'apartment',
    'condo',
    'townhouse',
    'mobile_home',
    'farm',
    'home_business',
    'private_residence',
]);

export function evaluateRules(input) {
    const start = performance.now();

    const {
        consignee_type,
        location_type,
        package_type,
        total_weight_lbs: weight,
        handling_units = 0,
        dock_available = 'unknown',
        forklift_available = 'unknown',
        open_to_public = 'unknown',
        security_check_required = 'unknown',
        appointment_only = 'unknown',
        restricted_vehicle_entry = 'unknown',
    } = input;

    const effectivePkg = package_type === 'crated' ? 'palletized' : package_type;
    const normalizedLocationType = normalizeValue(location_type);
    const isResidential =
        normalizeValue(consignee_type) === 'residential' ||
        RESIDENTIAL_LOCATION_TYPES.has(normalizedLocationType);

    const hasWeight = Number.isFinite(weight) && weight > 0;

    const matches = [];
    const advisories = [];
    let rulesEvaluated = 0;

    // ── Residential Delivery ────────────────────────────────────────

    rulesEvaluated++;
    {
        let score = 0;
        const evidence = [];

        if (normalizeValue(consignee_type) === 'residential') {
            score += 0.95;
            evidence.push('Destination marked as residential');
        }

        if (RESIDENTIAL_LOCATION_TYPES.has(normalizedLocationType)) {
            score = Math.max(score, 0.95);
            evidence.push(`Location type is ${formatLocationType(normalizedLocationType)}`);
        }

        if (score > 0) {
            matches.push({
                accessorial: 'residential_delivery',
                confidence: clamp(score),
                explanation:
                    evidence.length > 1
                        ? `${evidence.join('. ')}. Residential delivery accessorial applies.`
                        : `${evidence[0]}. Residential delivery accessorial applies.`,
                rule: 'R1',
            });
        }
    }

    // ── Limited Access ──────────────────────────────────────────────

    rulesEvaluated++;
    {
        let score = 0;
        const evidence = [];

        if (LIMITED_ACCESS_LOCATION_TYPES.has(normalizedLocationType)) {
            score += 0.82;
            evidence.push(
                `${formatLocationType(normalizedLocationType)} is commonly treated as a limited access location`
            );
        }

        if (isTrue(open_to_public) === false) {
            score += 0.12;
            evidence.push('Location is not open to the general public');
        }

        if (isTrue(security_check_required) === true) {
            score += 0.12;
            evidence.push('Security check is required before access');
        }

        if (isTrue(appointment_only) === true) {
            score += 0.08;
            evidence.push('Delivery requires appointment-only coordination');
        }

        if (isTrue(restricted_vehicle_entry) === true) {
            score += 0.10;
            evidence.push('Vehicle entry is restricted');
        }

        // Suppression for standard public commercial locations with no special restrictions
        const standardAccessConditions =
            !LIMITED_ACCESS_LOCATION_TYPES.has(normalizedLocationType) &&
            isTrue(open_to_public) === true &&
            isTrue(security_check_required) === false &&
            isTrue(appointment_only) !== true &&
            isTrue(restricted_vehicle_entry) !== true;

        if (!standardAccessConditions && score >= 0.60) {
            matches.push({
                accessorial: 'limited_access',
                confidence: clamp(score),
                explanation: `${evidence.join('. ')}. Limited access likely applies.`,
                rule: 'A1',
            });
        }
    }

    // ── Liftgate ────────────────────────────────────────────────────

    rulesEvaluated++;
    {
        let score = 0;
        const evidence = [];

        const dockNo = normalizeValue(dock_available) === 'no';
        const dockYes = normalizeValue(dock_available) === 'yes';
        const dockUnknown = normalizeValue(dock_available) === 'unknown';

        const forkliftNo = normalizeValue(forklift_available) === 'no';
        const forkliftYes = normalizeValue(forklift_available) === 'yes';
        const forkliftUnknown = normalizeValue(forklift_available) === 'unknown';

        if (dockNo) {
            score += 0.35;
            evidence.push('No loading dock available');
        }

        if (forkliftNo) {
            score += 0.30;
            evidence.push('No forklift available');
        }

        if (hasWeight) {
            if (effectivePkg === 'loose' && weight >= 150) {
                score += 0.15;
                evidence.push(`Loose freight is heavy (${weight} lbs)`);
            } else if (effectivePkg === 'loose' && weight >= 300) {
                score += 0.20;
                evidence.push(`Loose freight is very heavy (${weight} lbs)`);
            }

            if (effectivePkg === 'palletized' && weight >= 500) {
                score += 0.15;
                evidence.push(`Palletized shipment is heavy (${weight} lbs)`);
            }

            if (isResidential && weight >= 100) {
                score += 0.08;
                evidence.push(`Residential delivery weight is ${weight} lbs`);
            }
        }

        if (isResidential) {
            score += 0.05;
            evidence.push('Destination is residential');
        }

        if (dockUnknown) {
            score -= 0.08;
        }

        if (forkliftUnknown) {
            score -= 0.08;
        }

        // Strong suppression when unload capability is clearly present
        if (dockYes && forkliftYes) {
            score = 0;
        }

        if (score >= 0.55) {
            matches.push({
                accessorial: 'liftgate',
                confidence: clamp(score),
                explanation: `${dedupeStrings(evidence).join('. ')}. Liftgate service is likely needed.`,
                rule: 'L1',
            });
        } else if (
            hasWeight &&
            isResidential &&
            (dockUnknown || forkliftUnknown) &&
            weight >= 100
        ) {
            advisories.push({
                type: 'review',
                topic: 'liftgate_review',
                explanation: `Residential shipment (${weight} lbs) has incomplete unload-equipment details. Verify dock and forklift availability.`,
            });
        }
    }

    // ── Delivery Complexity Advisory ────────────────────────────────

    rulesEvaluated++;
    if (isResidential && handling_units >= 3) {
        advisories.push({
            type: 'review',
            topic: 'delivery_complexity',
            explanation: `Residential shipment with ${handling_units} handling units may need appointment, inside delivery, or unloading review.`,
        });
    }

    // ── Deduplicate: keep highest confidence per accessorial ───────

    const bestByAccessorial = {};
    for (const m of matches) {
        const existing = bestByAccessorial[m.accessorial];
        if (!existing || m.confidence > existing.confidence) {
            bestByAccessorial[m.accessorial] = m;
        }
    }

    const recommendations = Object.values(bestByAccessorial).map((m) => ({
        accessorial: m.accessorial,
        confidence: round2(m.confidence),
        level: m.confidence >= 0.85 ? 'recommended' : 'review_suggested',
        source: 'rules',
        explanation: m.explanation,
        rule: m.rule,
    }));

    const elapsed = performance.now() - start;

    return {
        recommendations,
        advisories,
        meta: {
            processing_time_ms: round2(elapsed),
            rules_evaluated: rulesEvaluated,
            rules_fired: matches.length,
            ai_invoked: false,
            ai_tasks: [],
        },
    };
}

function normalizeValue(value) {
    if (value == null) return 'unknown';
    return String(value).trim().toLowerCase();
}

function isTrue(value) {
    const normalized = normalizeValue(value);
    if (normalized === 'yes' || normalized === 'true') return true;
    if (normalized === 'no' || normalized === 'false') return false;
    return 'unknown';
}

function clamp(value, min = 0, max = 0.98) {
    return Math.min(max, Math.max(min, value));
}

function round2(value) {
    return Math.round(value * 100) / 100;
}

function dedupeStrings(items) {
    return [...new Set(items.filter(Boolean))];
}

function formatLocationType(type) {
    return String(type)
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}
