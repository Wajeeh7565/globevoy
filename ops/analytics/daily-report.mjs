#!/usr/bin/env node
// GV-ANALYTICS-9A: one-day report from the activity table (read-only Query on one DAY#
// partition; needs the analyst read policy). Prints searches, budgets, origins, trips and
// cities shown, live-check failures and recommendation feedback (views, bookings clicks,
// saves, "show other trips"), plus feedback per role and click-through by search.
//   node ops/analytics/daily-report.mjs --day 2026-11-29 [--json]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { summarize } = require('./daily-report-lib.cjs');

const arg = n => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : null; };
const day = arg('--day') || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { console.error('--day YYYY-MM-DD'); process.exit(2); }
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const db = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' });
const items = []; let start;
do {
  const r = await db.send(new QueryCommand({ TableName: 'globevoy-production-activity-events', KeyConditionExpression: 'PK = :d', ExpressionAttributeValues: { ':d': { S: 'DAY#' + day } }, ConsistentRead: true, ...(start ? { ExclusiveStartKey: start } : {}) }));
  items.push(...(r.Items || [])); start = r.LastEvaluatedKey;
} while (start);
const out = summarize(items, Date.now() / 1000);
if (process.argv.includes('--json')) console.log(JSON.stringify({ day, ...out }, null, 1));
else {
  console.log(`GlobeVoy activity ${day} (backend actions, not unique people)`);
  console.log(`  trip searches ${out.searches.total}: ${JSON.stringify(out.searches.byOutcome)}`);
  console.log(`  budgets  ${JSON.stringify(out.budgets)}`);
  console.log(`  origins  ${JSON.stringify(out.topOrigins)}`);
  console.log(`  trips shown per search ${out.shown.tripsPerSearch}; live checks ${out.shown.liveChecks}, failed ${out.shown.failedChecks} (${out.shown.failRatePct}%)`);
  console.log(`  top cities shown ${JSON.stringify(out.shown.topCities)}`);
  console.log(`  feedback ${JSON.stringify(out.feedback.byAction)}; by role ${JSON.stringify(out.feedback.byRole)}`);
  console.log(`  searches with any click ${out.feedback.searchesWithClick} of ${out.feedback.linkedSearches} linked; "show other trips" on ${out.feedback.searchesWithShowOther}`);
}
