'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHandler, record, handler } = require('../../backend/services/accounts/login-history/post-authentication.cjs');
const sub = '11111111-1111-4111-8111-111111111111';
const context = { awsRequestId: '22222222-2222-4222-8222-222222222222' };
const now = Date.parse('2026-11-16T23:59:59.999Z');
const env = { LOGIN_HISTORY_ENABLED: 'true', LOGIN_HISTORY_TABLE: 'globevoy-production-login-history', LOGIN_HISTORY_RETENTION_DAYS: '30' };
function event() { return { triggerSource: 'PostAuthentication_Authentication', region: 'us-east-2', userPoolId: 'us-east-2_gr7p2ySyA', callerContext: { clientId: 'h41vnimofe8dq3rsprjqg7aom' }, request: { userAttributes: { sub, email: 'private@example.invalid' }, clientMetadata: { password: 'never-store', token: 'never-store', ip: '192.0.2.1' } }, response: {} }; }
function setup(overrides = {}) {
  const writes = [], metrics = [];
  return { writes, metrics, run: createHandler({ env, clock: () => now, put: async x => writes.push(x), metric: x => metrics.push(x), ...overrides }) };
}
test('disabled by default, including the real exported handler; no SDK/AWS calls', async () => {
  const x = setup({ env: {} }); const e = event();
  assert.equal(await x.run(e, context), e); assert.equal(x.writes.length, 0);
  assert.equal(await handler(e, context), e);
});
test('verified pool/client/sub and invocation create ONLY whitelisted attributes; UTC and exact TTL', async () => {
  const x = setup(), e = event(), before = JSON.stringify(e);
  assert.equal(await x.run(e, context), e); assert.equal(JSON.stringify(e), before);
  const item = x.writes[0].Item;
  assert.deepEqual(Object.keys(item).sort(), ['PK','SK','authenticatedAt','expiresAt','kind','schemaVersion'].sort());
  assert.equal(item.authenticatedAt.S, '2026-11-16T23:59:59.999Z');
  assert.equal(+item.expiresAt.N, Math.floor(now / 1000) + 30 * 86400);
  assert.equal(item.PK.S, `USER#${sub}`);
  assert.ok(!JSON.stringify(item).includes('never-store'));
});
for (const source of ['TokenGeneration_RefreshTokens','TokenGeneration_HostedAuth','PreAuthentication_Authentication', undefined]) {
  test(`ignores non-post-authentication ${source}; no writer calls`, async () => {
    const x = setup(), e = event(); e.triggerSource = source;
    assert.equal(await x.run(e, context), e); assert.equal(x.writes.length, 0);
  });
}
for (const field of ['pool','client','sub','region','invocation']) {
  test(`rejects wrong/missing ${field}`, async () => {
    const x = setup(), e = event(); let c = context;
    if (field === 'pool') e.userPoolId = 'staging';
    if (field === 'client') e.callerContext.clientId = 'staging';
    if (field === 'sub') e.request.userAttributes.sub = 'email@example.invalid';
    if (field === 'region') e.region = 'us-east-1';
    if (field === 'invocation') c = {};
    await x.run(e, c); assert.equal(x.writes.length, 0);
  });
}
test('invalid retention or table fails closed', async () => {
  for (const days of [undefined, '0', '-1', '91', '1.5', 'NaN']) {
    const x = setup({ env: { ...env, LOGIN_HISTORY_RETENTION_DAYS: days } });
    await x.run(event(), context); assert.equal(x.writes.length, 0);
  }
  const x = setup({ env: { ...env, LOGIN_HISTORY_TABLE: 'saved-trips' } });
  await x.run(event(), context); assert.equal(x.writes.length, 0);
});
test('conditional write prevents same invocation replay without changing original expiry', async () => {
  const items = new Map(), metrics = [];
  const run = createHandler({ env, clock: () => now, metric: x => metrics.push(x), put: async p => {
    assert.equal(p.ConditionExpression, 'attribute_not_exists(PK) AND attribute_not_exists(SK)');
    const k = p.Item.PK.S + p.Item.SK.S;
    if (items.has(k)) throw Object.assign(new Error('secret must not be logged'), { name: 'ConditionalCheckFailedException' });
    items.set(k, p.Item);
  } });
  await run(event(), context); await run(event(), context);
  assert.equal(items.size, 1); assert.deepEqual(metrics, ['Recorded','Duplicate']);
});
test('different invocation is explicitly a distinct observation, NOT guaranteed distinct login', () => {
  assert.notEqual(record(event(), context, now, 30).SK.S,
    record(event(), { awsRequestId: '33333333-3333-4333-8333-333333333333' }, now, 30).SK.S);
});
test('write failure never blocks authentication and logs only sanitized status', async () => {
  const x = setup({ put: async () => { throw new Error('password token user sub'); } });
  const e = event(); assert.equal(await x.run(e, context), e);
  assert.deepEqual(x.metrics, ['WriteFailed']);
});
test('day boundary and user separation', () => {
  const a = record(event(), context, now + 1, 30);
  const e = event(); e.request.userAttributes.sub = '44444444-4444-4444-8444-444444444444';
  const b = record(e, context, now, 30);
  assert.equal(a.authenticatedAt.S, '2026-11-17T00:00:00.000Z');
  assert.notEqual(a.PK.S, b.PK.S);
});
test('review template is isolated, disabled, least privilege and does NOT attach/modify pool or production API', () => {
  const t = JSON.parse(fs.readFileSync('ops/login-history/stack.json', 'utf8'));
  const types = Object.values(t.Resources).map(x => x.Type);
  assert.ok(!types.includes('AWS::Cognito::UserPool'));
  assert.ok(!types.includes('AWS::Lambda::Url'));
  const fn = t.Resources.Function.Properties;
  assert.equal(fn.Environment.Variables.LOGIN_HISTORY_ENABLED, 'false');
  assert.equal(fn.Runtime, 'nodejs24.x');
  assert.deepEqual(t.Resources.WriterRole.Properties.Policies[0].PolicyDocument.Statement[0].Action, 'dynamodb:PutItem');
  assert.equal(t.Resources.ReaderPolicy.Properties.PolicyDocument.Statement[0].Action, 'dynamodb:Query');
  assert.equal(t.Resources.Table.DeletionPolicy, 'Retain');
  assert.deepEqual(t.Resources.Table.Properties.TimeToLiveSpecification, { AttributeName: 'expiresAt', Enabled: true });
  const source = fs.readFileSync('backend/services/accounts/login-history/post-authentication.cjs','utf8');
  assert.match(source, /maxAttempts: 1/); assert.match(source, /AbortSignal.timeout\(900\)/);
});

for (const name of ['TimeoutError', 'AbortError', 'AccessDeniedException', 'ProvisionedThroughputExceededException']) {
  test(`sanitized ${name} failure returns original Cognito response`, async () => {
    const x = setup({ put: async () => { throw Object.assign(new Error('private'), { name }); } });
    const e = event(); assert.equal(await x.run(e, context), e);
    assert.deepEqual(x.metrics, ['WriteFailed']);
  });
}
