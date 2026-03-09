# Carrier Rate Manual vs POC Rules — Comparison Report

**Carrier**: FedEx Freight  
**Manual Effective Date**: January 5, 2026  
**Comparison Date**: March 8, 2026  

---

## 1. Liftgate ✅ No Change Needed

| Item | FedEx Manual | POC Rule | Status |
|------|-------------|----------|--------|
| Weight Threshold | **No weight threshold** — charges when needed | loose ≥300lbs, palletized ≥500lbs | ✅ OK |
| Residential Auto-Liftgate | No | No | ✅ Match |

**Note**: FedEx doesn't define weight thresholds for liftgate. Our POC uses weight as a *predictive signal* (predicting when liftgate will likely be needed), which is the correct approach. The design doc already acknowledges this in "What Could Go Wrong" §3.

---

## 2. Residential Delivery ✅ No Change Needed

| Item | FedEx Manual | POC Rule | Status |
|------|-------------|----------|--------|
| Definition | Home, private residence, home-based business | residential, home, apartment | ✅ Match |
| Fee | $243.00/shipment | N/A (recommendation only) | — |

**Note**: FedEx includes "locations where a business is operated from a home" — these addresses look residential and our classifier would catch them.

---

## 3. Limited Access ⚠️ Updated

| FedEx Location Type | In POC? | Action |
|--------------------|---------|--------|
| Schools | ✅ `school` | — |
| Churches / places of worship | ✅ `church` | — |
| Individual (mini) storage units | ❌ → ✅ **Added** `storage_unit` | Rules + classifier updated |
| Commercial not open to public | ❌ | Hard to detect from address; deferred |

FedEx says "includes but is not limited to", so our additional types (hospital, military_base, prison, construction_site, mine, mall, government_building) are valid.

### Changes Made
- Added `storage_unit` to `LIMITED_ACCESS_LOCATIONS` in `rules.js`
- Added `storage_unit` patterns to `classifier.js` (storage, mini storage, self-storage)
- Added TC-031, TC-032 test cases to `test-dataset.json`
- Updated `run_eval.mjs` inline rules

---

## 4. Other Accessorials (Future Scope)

| Accessorial | FedEx Item | Description | Priority |
|-------------|-----------|-------------|----------|
| Inside Delivery | Item 566 | 室內取貨或送貨 | Medium |
| Notification Prior to Delivery | Item 750-3 | 送貨前通知 | Low |
| Detention | Item 500 | 車輛留滯費 | Low |
| Custom Delivery Window | Item 761 | 自定義送貨時間窗 | Medium |

---

## Raw Carrier Data

```json
{
  "carrier_name": "FedEx Freight",
  "effective_date": "JANUARY 5, 2026",
  "liftgate_fee": "varies by region (see Item 890)",
  "residential_fee": "$243.00/shipment",
  "limited_access_fee": "$229.00/shipment (US), $76.00 (Mexico)"
}
```
