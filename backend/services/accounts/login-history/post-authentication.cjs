'use strict';
// Separate Cognito-only entry point. Never attach this to the public API.
const POOL = 'us-east-2_gr7p2ySyA';
const CLIENT = 'h41vnimofe8dq3rsprjqg7aom';
const TABLE = 'globevoy-production-login-history';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(event, context, now, retentionDays) {
  if (event?.triggerSource !== 'PostAuthentication_Authentication' ||
      event.region !== 'us-east-2' || event.userPoolId !== POOL ||
      event.callerContext?.clientId !== CLIENT ||
      !UUID.test(event.request?.userAttributes?.sub || '') ||
      !UUID.test(context?.awsRequestId || '') ||
      !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90 ||
      !Number.isFinite(now)) return null;
  const sub = event.request.userAttributes.sub;
  // The invocation ID deduplicates this invocation only, NOT new Cognito invocations.
  return {
    PK: { S: `USER#${sub}` }, SK: { S: `AUTH#${context.awsRequestId}` },
    authenticatedAt: { S: new Date(now).toISOString() },
    expiresAt: { N: String(Math.floor(now / 1000) + retentionDays * 86400) },
    schemaVersion: { N: '1' }, kind: { S: 'cognito_post_authentication_observed' }
  };
}
function createHandler({ env = process.env, clock = Date.now, put, metric = () => {} } = {}) {
  return async function handler(event, context) {
    if (env.LOGIN_HISTORY_ENABLED !== 'true') return event;
    const item = record(event, context, clock(), Number(env.LOGIN_HISTORY_RETENTION_DAYS));
    if (!item) { metric('Rejected'); return event; }
    if (env.LOGIN_HISTORY_TABLE !== TABLE) { metric('Rejected'); return event; }
    try {
      await put({ TableName: TABLE, Item: item,
        ConditionExpression: 'attribute_not_exists(PK) AND attribute_not_exists(SK)' });
      metric('Recorded');
    } catch (error) {
      metric(error?.name === 'ConditionalCheckFailedException' ? 'Duplicate' : 'WriteFailed');
    }
    // Do not change Cognito response or make ordinary writer errors fail authentication.
    return event;
  };
}
let client;
exports.handler = createHandler({
  put: async input => {
    const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
    // Bounded SDK operation; Cognito's synchronous trigger deadline is five seconds.
    client ||= new DynamoDBClient({ region: 'us-east-2', maxAttempts: 1,
      requestHandler: { connectionTimeout: 300, requestTimeout: 700 } });
    return client.send(new PutItemCommand(input), { abortSignal: AbortSignal.timeout(900) });
  },
  // Never log the event, error object, user ID or authentication metadata.
  metric: status => console.log(JSON.stringify({ loginHistory: status }))
});
exports.createHandler = createHandler;
exports.record = record;
