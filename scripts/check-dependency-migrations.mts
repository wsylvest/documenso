import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '..');
const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
for (const [location, metadata] of Object.entries(lock.packages) as [string, { version?: string; link?: boolean }][]) {
  assert(!/(?:^|\/)node_modules\/(?:inflight|oslo)$/.test(location), location);
  if (location.endsWith('/node_modules/glob') || location === 'node_modules/glob') {
    assert.equal(metadata.version, '13.0.6');
  }
  if (/node_modules\/(?:lodash.get|node-domexception)$/.test(location)) {
    assert.equal(metadata.link, true, `Deprecated implementation was reintroduced: ${location}`);
  }
}

const sdkRequire = createRequire(require.resolve('@team-plain/typescript-sdk'));
const get = sdkRequire('lodash.get');
assert.equal(
  get({ properties: { eventType: { const: 'customer.created' } } }, 'properties.eventType.const'),
  'customer.created',
);
assert.equal(get({ webhookMetadata: { webhookTargetVersion: '1' } }, 'webhookMetadata.webhookTargetVersion'), '1');
assert.equal(
  get(
    { definitions: { webhookMetadata: { properties: { webhookTargetVersion: { const: '1' } } } } },
    'definitions.webhookMetadata.properties.webhookTargetVersion.const',
  ),
  '1',
);
assert.equal(get(null, 'webhookMetadata.webhookTargetVersion'), undefined);
assert.equal(get({ webhookMetadata: null }, 'webhookMetadata.webhookTargetVersion'), undefined);
assert.equal(get({ webhookMetadata: { webhookTargetVersion: null } }, 'webhookMetadata.webhookTargetVersion'), null);

const blobRequire = createRequire(require.resolve('fetch-blob'));
assert.equal(blobRequire('node-domexception'), globalThis.DOMException);
assert.equal(new (blobRequire('node-domexception'))('unreadable', 'NotReadableError').name, 'NotReadableError');

const { glob } = require('glob');
assert((await glob('package.json', { cwd: root })).includes('package.json'));
const inngestRequire = createRequire(require.resolve('inngest'));
const { serializeError, deserializeError, errorConstructors } = inngestRequire('serialize-error-cjs');
const { NonRetriableError } = require('inngest');
errorConstructors.set('NonRetriableError', NonRetriableError);
const original = new NonRetriableError('migration check', { cause: new TypeError('cause') });
const restored = deserializeError(serializeError(original));
assert(restored instanceof NonRetriableError);
assert.equal(restored.message, original.message);
assert.equal(restored.cause.message, 'cause');
console.log('Dependency migration checks passed');
