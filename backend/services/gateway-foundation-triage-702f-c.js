'use strict';

const fs = require('fs');
const path = require('path');
const context = require('../data/gateway-review-context-702f-c.json');

const VERSION = 'GV-REC-702F-C';
const EXPECTED_INPUT_VERSION = 'GV-REC-702F-B';
const contextById = new Map((context.records || []).map(row => [row.cityId, row]));

function clean(v) { return String(v == null ? '' : v).trim(); }
function finite(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function topCandidate(row) { return row?.review?.topCandidate || row?.generatedCandidates?.[0] || null; }
function preferredEvidence(row) { return row?.currentMapping?.preferredEvidence || {}; }
function existingGatewayEvidence(row) { return row?.currentMapping?.existingGatewayEvidence || null; }

function automaticBucket(row) {
  const classification = clean(row?.review?.classification);
  const preferred = preferredEvidence(row);
  const top = topCandidate(row);
  const existingGatewayCode = clean(row?.currentMapping?.existingGatewayCode);
  const gatewayEvidence = existingGatewayEvidence(row);

  if (classification === 'no-nearby-scheduled-service-candidate') {
    return {
      bucket: 'no-nearby-candidate',
      recommendedAction: 'manual-provider-and-ground-access-review',
      reason: 'No nearby scheduled-service candidate met the bounded OurAirports review rules.'
    };
  }

  if (existingGatewayCode && gatewayEvidence?.scheduledService === true && classification === 'review-alternative-gateway-candidate') {
    return {
      bucket: 'preserve-existing-gateway-review',
      recommendedAction: 'preserve-current-gateway-until-product-review',
      reason: 'An existing scheduled-service gateway is already documented; a closer facility alone is not enough to replace it.'
    };
  }

  if (preferred.status === 'not-found-in-pinned-ourairports') {
    return {
      bucket: 'source-disagreement-or-code-retirement',
      recommendedAction: 'review-code-status-and-current-provider-support',
      reason: 'The current preferred code was not represented in the pinned OurAirports snapshot, so code status must be resolved before any replacement.'
    };
  }

  if (preferred.status === 'no-scheduled-service') {
    if (!top) {
      return {
        bucket: 'no-nearby-candidate',
        recommendedAction: 'manual-provider-and-ground-access-review',
        reason: 'The preferred airport lacks scheduled-service confirmation and no bounded replacement candidate was found.'
      };
    }
    const distanceKm = finite(top.distanceKm);
    const sameCountry = top.sameCountry === true;
    const passengerScale = ['large_airport', 'medium_airport'].includes(clean(top.type));

    if (sameCountry && passengerScale && distanceKm != null && distanceKm <= 40) {
      return {
        bucket: 'strong-replacement-candidate',
        recommendedAction: 'review-explicit-staging-mapping-correction',
        reason: 'The current preferred airport lacks scheduled-service confirmation and a nearby same-country large/medium scheduled-service candidate exists within 40 km.'
      };
    }
    if (!sameCountry) {
      return {
        bucket: 'cross-border-gateway-manual-review',
        recommendedAction: 'manual-border-transfer-and-provider-review',
        reason: 'The best bounded scheduled-service candidate is across an international border; geography alone cannot establish a practical gateway.'
      };
    }
    if (distanceKm != null && distanceKm > 200) {
      return {
        bucket: 'long-distance-gateway-manual-review',
        recommendedAction: 'manual-ground-transfer-and-provider-review',
        reason: 'The nearest bounded scheduled-service candidate is more than 200 km away.'
      };
    }
    if (distanceKm != null && distanceKm <= 120) {
      return {
        bucket: 'local-service-revalidation',
        recommendedAction: 'revalidate-local-airport-service-and-practical-gateway',
        reason: 'The preferred airport lacks scheduled-service confirmation, but a same-country scheduled-service facility exists within 120 km.'
      };
    }
    return {
      bucket: 'regional-gateway-manual-review',
      recommendedAction: 'manual-regional-gateway-and-transfer-review',
      reason: 'A same-country scheduled-service candidate exists, but the transfer is substantial enough to require product review.'
    };
  }

  if (classification === 'review-alternative-gateway-candidate') {
    if (existingGatewayCode) {
      return {
        bucket: 'preserve-existing-gateway-review',
        recommendedAction: 'preserve-current-gateway-until-product-review',
        reason: 'The destination already has an explicit gateway; a geographically closer alternative should not auto-replace it.'
      };
    }
    const distanceKm = finite(top?.distanceKm);
    if (distanceKm != null && distanceKm <= 30) {
      return {
        bucket: 'nearby-alternative-review',
        recommendedAction: 'compare-current-and-nearby-facilities',
        reason: 'A very nearby scheduled-service alternative exists, but the current mapping is also scheduled-service confirmed.'
      };
    }
    return {
      bucket: 'alternative-gateway-manual-review',
      recommendedAction: 'manual-airport-role-and-provider-review',
      reason: 'A scheduled-service alternative is worth review, but proximity and airport size alone are insufficient to replace the current mapping.'
    };
  }

  return {
    bucket: 'manual-review',
    recommendedAction: 'manual-foundation-review',
    reason: 'The row does not match a safe automatic triage rule.'
  };
}

function triageRow(row) {
  const reviewed = contextById.get(row.cityId) || null;
  const decision = reviewed ? {
    bucket: reviewed.bucket,
    recommendedAction: reviewed.recommendedAction,
    reason: reviewed.reason
  } : automaticBucket(row);
  const top = topCandidate(row);

  return {
    cityId: row.cityId,
    displayName: row.displayName,
    country: row.country,
    countryCode: row.countryCode,
    selectionTier: row.selectionTier,
    inputClassification: row?.review?.classification || null,
    currentMapping: {
      preferredAirportCode: row?.currentMapping?.preferredAirportCode || null,
      preferredStatus: row?.currentMapping?.preferredEvidence?.status || null,
      preferredScheduledService: row?.currentMapping?.preferredEvidence?.scheduledService === true,
      preferredDistanceKm: finite(row?.currentMapping?.preferredEvidence?.distanceKm),
      existingGatewayCode: row?.currentMapping?.existingGatewayCode || null,
      existingGatewayScheduledService: row?.currentMapping?.existingGatewayEvidence?.scheduledService === true
    },
    topCandidate: top ? {
      iata: top.iata || null,
      name: top.name || null,
      type: top.type || null,
      countryCode: top.countryCode || null,
      scheduledService: top.scheduledService === true,
      distanceKm: finite(top.distanceKm),
      sameCountry: top.sameCountry === true
    } : null,
    triage: {
      bucket: decision.bucket,
      recommendedAction: decision.recommendedAction,
      reason: decision.reason,
      reviewedContextApplied: Boolean(reviewed),
      issueType: reviewed?.issueType || null,
      evidence: reviewed?.evidence || []
    },
    safety: {
      routingChanged: false,
      automaticOverrideAllowed: false,
      activationChanged: false,
      requiresExactItineraryVerification: true,
      providerCallsPerformed: false
    }
  };
}

function buildReport(input) {
  if (!input || input.version !== EXPECTED_INPUT_VERSION) {
    throw new Error(`Expected ${EXPECTED_INPUT_VERSION} input report.`);
  }
  const queue = Array.isArray(input.reviewQueue) ? input.reviewQueue : [];
  const records = queue.map(triageRow);
  const bucketCounts = {};
  for (const row of records) bucketCounts[row.triage.bucket] = (bucketCounts[row.triage.bucket] || 0) + 1;
  const reviewedContextCount = records.filter(row => row.triage.reviewedContextApplied).length;

  return {
    ok: true,
    version: VERSION,
    generatedAt: new Date().toISOString(),
    input: {
      version: input.version,
      source: input.source || null,
      corrected702fBQueueCount: queue.length
    },
    reviewedContext: {
      taskId: context.taskId,
      asOf: context.asOf,
      recordCount: (context.records || []).length
    },
    policy: {
      reviewOnly: true,
      routingChanged: false,
      automaticOverrideAllowed: false,
      activationChanged: false,
      providerCallsPerformed: false,
      exactItineraryVerificationStillRequired: true,
      scheduledServiceMetadataIsNotExactAvailability: true
    },
    summary: {
      inputReviewQueueCount: queue.length,
      triagedCount: records.length,
      reviewedContextCount,
      bucketCounts,
      routingChanged: false,
      activationChanged: false
    },
    records
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--input') out.input = argv[++i];
    else if (argv[i] === '--out') out.out = argv[++i];
  }
  return out;
}

if (require.main === module) {
  const args = parseArgs(process.argv);
  if (!args.input || !args.out) {
    console.error('Usage: node gateway-foundation-triage-702f-c.js --input <702f-b-report.json> --out <triage.json>');
    process.exit(2);
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
  const output = buildReport(input);
  fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
  fs.writeFileSync(path.resolve(args.out), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output.summary, null, 2));
}

module.exports = {
  VERSION,
  EXPECTED_INPUT_VERSION,
  contextById,
  automaticBucket,
  triageRow,
  buildReport
};
