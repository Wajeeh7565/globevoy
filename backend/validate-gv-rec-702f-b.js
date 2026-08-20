'use strict';

const assert = require('assert');
const enrichment = require('./services/ourairports-gateway-enrichment-702f-b');
const source = require('./data/ourairports-source-702f-b.json');

const CSV = [
  '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"',
  '1,"MMUN","large_airport","Cancun International Airport",21.0365,-86.8771,20,"NA","MX","MX-ROO","Cancun","yes","MMUN","CUN","MMUN",,,,',
  '2,"MMTL","medium_airport","Tulum International Airport",20.1721,-87.6603,48,"NA","MX","MX-ROO","Tulum","yes","MMTL","TQO","MMTL",,,,',
  '3,"TEST","small_airport","Old Local Airport",20.2200,-87.4800,10,"NA","MX","MX-ROO","Tulum","no",,"OLD","TEST",,,,',
  '4,"MZBZ","medium_airport","Philip S. W. Goldson International Airport",17.5391,-88.3082,15,"NA","BZ","BZ-BZ","Belize City","yes","MZBZ","BZE","MZBZ",,,,'
].join('\n');

const city = {
  cityId: 'tulum-mx',
  displayName: 'Tulum',
  country: 'Mexico',
  countryCode: 'MX',
  latitude: 20.2114,
  longitude: -87.4654,
  selectionTier: 'current-500',
  origin: {
    preferredAirportCode: 'OLD',
    airportCodes: ['OLD'],
    requiresGatewayTransfer: true,
    gateway: { airportCode: 'CUN' }
  },
  providers: {
    travelpayouts: {
      preferredAirportCode: 'OLD',
      airportCodes: ['OLD'],
      gateway: { airportCode: 'CUN' }
    }
  }
};

function main() {
  assert.strictEqual(enrichment.VERSION, 'GV-REC-702F-B');
  assert.strictEqual(source.commit, '55fd4071c99668a29f9d3625d72405c44074ef2f');
  assert.strictEqual(source.gitBlobSha, 'b95a254e2d970ecb37320d645abced90c6d1a95f');
  assert.strictEqual(source.policy.routingChanged, false);

  const parsed = enrichment.parseAirportsCsv(CSV);
  assert.strictEqual(parsed.length, 4, 'all valid-IATA airport records should remain available for evidence comparison');
  assert.strictEqual(parsed.find(row => row.iata === 'OLD').scheduledService, false);
  assert.strictEqual(parsed.find(row => row.iata === 'TQO').scheduledService, true);

  const scheduled = parsed.filter(row => row.scheduledService);
  const byIata = new Map(parsed.map(row => [row.iata, row]));
  const currentEvidence = enrichment.airportEvidence('OLD', city, byIata);
  assert.strictEqual(currentEvidence.status, 'no-scheduled-service');
  assert.strictEqual(currentEvidence.scheduledService, false);

  const gatewayEvidence = enrichment.airportEvidence('CUN', city, byIata);
  assert.strictEqual(gatewayEvidence.status, 'scheduled-service-confirmed');

  const nearby = enrichment.nearbyCandidates(city, scheduled, 8);
  assert(nearby.some(row => row.iata === 'TQO'), 'TQO should be generated as a nearby scheduled-service candidate');
  assert(nearby.some(row => row.iata === 'CUN'), 'CUN should remain available as a practical scheduled-service gateway candidate');
  assert(!nearby.some(row => row.iata === 'OLD'), 'unscheduled airports must never become generated gateway candidates');

  const enriched = enrichment.enrichCity(city, scheduled, byIata);
  assert.strictEqual(enriched.currentMapping.preferredEvidence.status, 'no-scheduled-service');
  assert.strictEqual(enriched.currentMapping.existingGatewayEvidence.scheduledService, true);
  assert.strictEqual(enriched.review.classification, 'review-current-preferred-not-confirmed');
  assert.strictEqual(enriched.review.priority, 'high');
  assert.strictEqual(enriched.review.routingChanged, false);
  assert.strictEqual(enriched.review.automaticOverrideAllowed, false);

  const report = enrichment.buildReport(CSV, { registryRecords: [city] });
  assert.strictEqual(report.summary.curatedCityCount, 1);
  assert.strictEqual(report.summary.preferredAirportExistsWithoutScheduledService, 1);
  assert.strictEqual(report.summary.reviewQueueCount, 1);
  assert.strictEqual(report.policy.routingChanged, false);
  assert.strictEqual(report.policy.providerCallsPerformed, false);
  assert.strictEqual(report.records.length, 1);

  console.log('GV-REC-702F-B validation PASS');
  console.log(JSON.stringify({
    version: report.version,
    sourceCommit: report.source.commit,
    sourceBlob: report.source.gitBlobSha,
    reviewClassification: report.records[0].review.classification,
    generatedCandidates: report.records[0].generatedCandidates.map(row => row.iata),
    routingChanged: report.summary.routingChanged
  }, null, 2));
}

main();
