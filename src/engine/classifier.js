/**
 * Address-driven auto-classification for consignee type and location type.
 * Pure frontend keyword matching — no external API calls.
 */

// Location type detection rules, checked in order (first match wins)
const LOCATION_RULES = [
  {
    type: 'school',
    patterns: [/\bschool\b/i, /\belementary\b/i, /\bmiddle\s+school\b/i, /\bhigh\s+school\b/i, /\bacademy\b/i, /\buniversity\b/i, /\bcollege\b/i],
  },
  {
    type: 'church',
    patterns: [/\bchurch\b/i, /\btemple\b/i, /\bmosque\b/i, /\bsynagogue\b/i, /\bchapel\b/i],
  },
  {
    type: 'hospital',
    patterns: [/\bhospital\b/i, /\bmedical\s+center\b/i, /\bclinic\b/i, /\bhealth\s+center\b/i],
  },
  {
    type: 'mall',
    patterns: [/\bmall\b/i, /\bshopping\s+center\b/i, /\bplaza\b/i],
  },
  {
    type: 'prison',
    patterns: [/\bprison\b/i, /\bcorrectional\b/i, /\bdetention\b/i, /\bjail\b/i],
  },
  {
    type: 'military_base',
    patterns: [/\bmilitary\b/i, /\bair\s+force\s+base\b/i, /\barmy\b/i, /\bnaval\b/i, /\bfort\b/i],
  },
  {
    type: 'construction_site',
    patterns: [/\bconstruction\b/i, /\bjob\s+site\b/i, /\bbuild\s+site\b/i],
  },
  {
    type: 'mine',
    patterns: [/\bmine\b/i, /\bmining\b/i, /\bquarry\b/i],
  },
  {
    type: 'storage_unit',
    patterns: [/\bstorage\b/i, /\bmini\s+storage\b/i, /\bself[- ]storage\b/i, /\bstorage\s+unit\b/i, /\bstorage\s+facility\b/i],
  },
  {
    type: 'government_building',
    patterns: [/\bcity\s+hall\b/i, /\bcourthouse\b/i, /\bgovernment\b/i, /\bfederal\s+building\b/i, /\bpost\s+office\b/i, /\bDMV\b/i],
  },
  {
    type: 'warehouse',
    patterns: [/\bwarehouse\b/i, /\bdistribution\s+center\b/i, /\bfulfillment\b/i, /\blogistics\b/i, /\bindustrial\b/i],
  },
  {
    type: 'retail_store',
    patterns: [/\bstore\b/i, /\bshop\b/i, /\bretail\b/i, /\bmarket\b/i, /\bsupermarket\b/i, /\bpharmacy\b/i, /\brestaurant\b/i],
  },
  {
    type: 'stadium',
    patterns: [/\bstadium\b/i, /\barena\b/i, /\bfield\b/i, /\bcoliseum\b/i, /\bcomplex\b/i, /\bcenter\b/i, /\bdome\b/i, /\bpavilion\b/i],
  },
];

// Residential indicator patterns
const APARTMENT_PATTERNS = [/\bapt\.?\b/i, /\bapartment\b/i, /\bunit\b/i, /\bsuite\b/i, /\bcondo\b/i, /\btownhouse\b/i, /\bresidence\b/i];

// Business keywords that prevent residential default
const BUSINESS_KEYWORDS = [
  /\bschool\b/i, /\belementary\b/i, /\bacademy\b/i, /\buniversity\b/i, /\bcollege\b/i,
  /\bchurch\b/i, /\btemple\b/i, /\bmosque\b/i, /\bsynagogue\b/i, /\bchapel\b/i,
  /\bhospital\b/i, /\bmedical\s+center\b/i, /\bclinic\b/i, /\bhealth\s+center\b/i,
  /\bmall\b/i, /\bshopping\s+center\b/i,
  /\bprison\b/i, /\bcorrectional\b/i, /\bdetention\b/i, /\bjail\b/i,
  /\bmilitary\b/i, /\bair\s+force\b/i, /\barmy\b/i, /\bnaval\b/i,
  /\bconstruction\b/i, /\bjob\s+site\b/i,
  /\bmine\b/i, /\bmining\b/i, /\bquarry\b/i,
  /\bstorage\b/i, /\bmini\s+storage\b/i, /\bself[- ]storage\b/i,
  /\bcity\s+hall\b/i, /\bcourthouse\b/i, /\bgovernment\b/i, /\bfederal\s+building\b/i, /\bpost\s+office\b/i, /\bDMV\b/i,
  /\bwarehouse\b/i, /\bdistribution\s+center\b/i, /\bfulfillment\b/i, /\blogistics\b/i, /\bindustrial\b/i,
  /\bstore\b/i, /\bshop\b/i, /\bretail\b/i, /\bmarket\b/i, /\bsupermarket\b/i, /\bpharmacy\b/i, /\brestaurant\b/i,
  /\binc\b/i, /\bllc\b/i, /\bcorp\b/i, /\bcompany\b/i, /\bco\.\b/i, /\bltd\b/i,
  /\boffice\b/i, /\bheadquarters\b/i, /\bcenter\b/i,
  /\bstadium\b/i, /\barena\b/i, /\bfield\b/i, /\bcoliseum\b/i, /\bcomplex\b/i, /\bdome\b/i, /\bpavilion\b/i,
];

/**
 * Detect location_type from address string.
 * Returns the first matched type or 'other'.
 */
function detectLocationType(address) {
  for (const rule of LOCATION_RULES) {
    for (const pattern of rule.patterns) {
      if (pattern.test(address)) {
        return rule.type;
      }
    }
  }
  return null; // null means no specific location type matched
}

/**
 * Check if address has residential apartment/unit indicators.
 */
function hasApartmentIndicators(address) {
  return APARTMENT_PATTERNS.some((p) => p.test(address));
}

/**
 * Check if address contains any business keywords.
 */
function hasBusinessKeywords(address) {
  return BUSINESS_KEYWORDS.some((p) => p.test(address));
}

/**
 * Parse city, state, ZIP from the end of an address string.
 * Handles formats like:
 *   "123 Oak St, Pasadena, CA 91101"
 *   "Lincoln Elementary School, 400 Main St, Phoenix, AZ 85001"
 */
export function parseAddress(address) {
  const result = { city: '', state: '', zip: '' };
  if (!address || !address.trim()) return result;

  const trimmed = address.trim();

  // Try to extract ZIP (5 digits at the end)
  const zipMatch = trimmed.match(/\b(\d{5})(?:-\d{4})?\s*$/);
  if (zipMatch) {
    result.zip = zipMatch[1];
  }

  // Remove ZIP from the end for further parsing
  const withoutZip = trimmed.replace(/,?\s*\d{5}(?:-\d{4})?\s*$/, '').trim();

  // Try to extract state (2-letter abbreviation at the end)
  const stateMatch = withoutZip.match(/,?\s+([A-Z]{2})\s*$/i);
  if (stateMatch) {
    result.state = stateMatch[1].toUpperCase();
  }

  // Remove state from the end
  const withoutState = withoutZip.replace(/,?\s+[A-Z]{2}\s*$/i, '').trim();

  // City is the last comma-separated segment
  const parts = withoutState.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length > 0) {
    result.city = parts[parts.length - 1];
  }

  return result;
}

/**
 * Classify an address string into consignee_type and location_type.
 *
 * @param {string} address - Raw address string
 * @returns {{ consignee_type: string, location_type: string }}
 */
export function classifyAddress(address) {
  if (!address || !address.trim()) {
    return { consignee_type: 'unknown', location_type: 'other' };
  }

  // Step 1: Detect location type from keywords
  const detectedLocation = detectLocationType(address);

  if (detectedLocation) {
    // Matched a specific location type
    let consignee_type;

    if (detectedLocation === 'home' || detectedLocation === 'apartment') {
      consignee_type = 'residential';
    } else if (detectedLocation === 'warehouse' || detectedLocation === 'retail_store') {
      consignee_type = 'commercial';
    } else {
      // school, church, hospital, mall, prison, military_base,
      // construction_site, mine, government_building, stadium
      consignee_type = 'commercial';
    }

    return { consignee_type, location_type: detectedLocation };
  }

  // Step 2: No specific location matched — check for apartment indicators
  if (hasApartmentIndicators(address)) {
    return { consignee_type: 'residential', location_type: 'apartment' };
  }

  // Step 3: No business keywords → default to residential + home
  // This is the key design decision: plain addresses default to residential
  if (!hasBusinessKeywords(address)) {
    return { consignee_type: 'residential', location_type: 'home' };
  }

  // Step 4: Has business keywords but didn't match a specific location type
  return { consignee_type: 'unknown', location_type: 'other' };
}
