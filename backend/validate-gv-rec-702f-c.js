'use strict';

const assert = require('assert');
const triage = require('./services/cities/gateways/gateway-foundation-triage-702f-c');
const context = require('./data/gateway-review-context-702f-c.json');

function row({
  cityId,
  displayName = cityId,
  country = 'Test',
  countryCode = 'TT',
  classification = 'review-current-preferred-not-confirmed',
  preferredCode = 'OLD',
  preferredStatus = 'no-scheduled-service',
  preferredScheduled = false,
  preferredDistanceKm = 5,
  existingGatewayCode = null,
  existingGatewayScheduled = false,
  top = null
}) {
  return {
    cityId,
    displayName,
    country,
    countryCode,
    selectionTier: 'current-500',
    currentMapping: {
      preferredAirportCode: preferredCode,
      preferredEvidence: {
        status: preferredStatus,
        scheduledService: preferredScheduled,
        distanceKm: preferredDistanceKm
      },
      existingGatewayCode,
      existingGatewayEvidence: existingGatewayCode ? { scheduledService: existingGatewayScheduled } : null
    },
    generatedCandidates: top ? [top] : [],
    review: {
      classification,
      topCandidate: top,
      priority: 'high'
    }
  };
}

function candidate(iata, distanceKm, sameCountry = true, type = 'large_airport') {
  return { iata, name: `${iata} Airport`, type, countryCode: sameCountry ? 'TT' : 'XX', scheduledService: true, distanceKm, sameCountry };
}

function main() {
  assert.strictEqual(triage.VERSION, 'GV-REC-702F-C');
  assert.strictEqual(context.asOf, '2026-08-20');
  assert.strictEqual(context.reviewOnly, true);
  assert.strictEqual(context.records.length, 8, 'expected exactly eight reviewed special-case holds');
  assert.strictEqual(new Set(context.records.map(r => r.cityId)).size, 8, 'review context IDs must be unique');
  assert.strictEqual(context.records.filter(r => r.bucket === 'registry-integrity-hold').length, 4);
  assert.strictEqual(context.records.filter(r => r.bucket === 'operational-airspace-hold').length, 4);
  assert(!context.records.some(r => r.cityId === 'tasiilaq-gl'), 'Tasiilaq must not be reintroduced after 702F-B-R1 correction');

  const fixtures = [
    row({ cityId: 'beijing-cn', displayName: 'Beijing', countryCode: 'CN', preferredCode: 'NAY', top: candidate('PEK', 25.2, true, 'large_airport') }),
    row({ cityId: 'detroit-us', displayName: 'Detroit', countryCode: 'US', preferredCode: 'DET', top: candidate('DTW', 28.5, true, 'large_airport') }),
    row({ cityId: 'homalin-mm', countryCode: 'MM', preferredCode: 'HOX', top: candidate('IMF', 103.6, false, 'large_airport') }),
    row({ cityId: 'geneina-sd', countryCode: 'SD', preferredCode: 'EGN', top: candidate('ELF', 309, true, 'medium_airport') }),
    row({ cityId: 'ann-mm', countryCode: 'MM', preferredCode: 'VBA', top: candidate('KYP', 64, true, 'medium_airport') }),
    row({ cityId: 'bafoussam-cm', countryCode: 'CM', preferredCode: 'BFX', top: candidate('DLA', 180.7, true, 'large_airport') }),
    row({ cityId: 'kalabo-zm', countryCode: 'ZM', preferredCode: 'KLB', classification: 'no-nearby-scheduled-service-candidate', top: null }),
    row({ cityId: 'tripoli-ly', countryCode: 'LY', preferredCode: 'TIP', preferredStatus: 'not-found-in-pinned-ourairports', top: candidate('MJI', 9.5, true, 'large_airport') }),
    row({ cityId: 'whistler-ca', countryCode: 'CA', classification: 'review-alternative-gateway-candidate', preferredCode: 'YVR', preferredStatus: 'scheduled-service-confirmed', preferredScheduled: true, existingGatewayCode: 'YVR', existingGatewayScheduled: true, top: candidate('YWS', 3.1, true, 'seaplane_base') }),
    row({ cityId: 'flagstaff-us', countryCode: 'US', classification: 'review-alternative-gateway-candidate', preferredCode: 'GCN', preferredStatus: 'scheduled-service-confirmed', preferredScheduled: true, top: candidate('FLG', 6.7, true, 'medium_airport') }),
    row({ cityId: 'saint-martin-mf', countryCode: 'MF', classification: 'review-alternative-gateway-candidate', preferredCode: 'SFG', preferredStatus: 'scheduled-service-confirmed', preferredScheduled: true, top: candidate('JNB', 11.5, false, 'large_airport') }),
    row({ cityId: 'kyiv-ua', countryCode: 'UA', preferredCode: 'IEV', top: candidate('RWN', 308.5, true, 'medium_airport') })
  ];

  const input = { version: 'GV-REC-702F-B', source: { fixture: true }, reviewQueue: fixtures };
  const report = triage.buildReport(input);
  const byId = new Map(report.records.map(r => [r.cityId, r]));

  assert.strictEqual(byId.get('beijing-cn').triage.bucket, 'strong-replacement-candidate');
  assert.strictEqual(byId.get('detroit-us').triage.bucket, 'strong-replacement-candidate');
  assert.strictEqual(byId.get('homalin-mm').triage.bucket, 'cross-border-gateway-manual-review');
  assert.strictEqual(byId.get('geneina-sd').triage.bucket, 'long-distance-gateway-manual-review');
  assert.strictEqual(byId.get('ann-mm').triage.bucket, 'local-service-revalidation');
  assert.strictEqual(byId.get('bafoussam-cm').triage.bucket, 'regional-gateway-manual-review');
  assert.strictEqual(byId.get('kalabo-zm').triage.bucket, 'no-nearby-candidate');
  assert.strictEqual(byId.get('tripoli-ly').triage.bucket, 'source-disagreement-or-code-retirement');
  assert.strictEqual(byId.get('whistler-ca').triage.bucket, 'preserve-existing-gateway-review');
  assert.strictEqual(byId.get('flagstaff-us').triage.bucket, 'nearby-alternative-review');
  assert.strictEqual(byId.get('saint-martin-mf').triage.bucket, 'registry-integrity-hold');
  assert.strictEqual(byId.get('saint-martin-mf').triage.reviewedContextApplied, true);
  assert.strictEqual(byId.get('kyiv-ua').triage.bucket, 'operational-airspace-hold');
  assert.strictEqual(byId.get('kyiv-ua').triage.reviewedContextApplied, true);

  for (const r of report.records) {
    assert.strictEqual(r.safety.routingChanged, false);
    assert.strictEqual(r.safety.automaticOverrideAllowed, false);
    assert.strictEqual(r.safety.activationChanged, false);
    assert.strictEqual(r.safety.requiresExactItineraryVerification, true);
    assert.strictEqual(r.safety.providerCallsPerformed, false);
  }
  assert.strictEqual(report.policy.reviewOnly, true);
  assert.strictEqual(report.policy.routingChanged, false);
  assert.strictEqual(report.policy.activationChanged, false);
  assert.strictEqual(report.policy.providerCallsPerformed, false);

  console.log('GV-REC-702F-C validation PASS');
  console.log(JSON.stringify({
    version: report.version,
    fixtureCount: report.summary.triagedCount,
    reviewedContextCount: report.summary.reviewedContextCount,
    buckets: report.summary.bucketCounts,
    routingChanged: report.summary.routingChanged,
    activationChanged: report.summary.activationChanged
  }, null, 2));
}

main();
