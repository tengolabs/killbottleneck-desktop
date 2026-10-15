import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jeStarsiServer, tokenZUlozeni } from '../lib/server.js';

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (obsah) => `${b64({ alg: 'HS256' })}.${b64(obsah)}.podpis`;
const TED = Date.parse('2026-10-15T08:00:00Z');

test('přihlášení z úložiště stránky', () => {
  const token = jwt({ id: 'abc123def456ghi', exp: TED / 1000 + 3600 });
  assert.deepEqual(tokenZUlozeni(JSON.stringify({ token, record: { id: 'abc123def456ghi' } }), TED),
    { token, uzivatel: 'abc123def456ghi', vyprselo: false });
  assert.equal(tokenZUlozeni(JSON.stringify({ token, model: { id: 'stary1' } }), TED).uzivatel, 'stary1', 'starší SDK ukládalo „model“');
  assert.equal(tokenZUlozeni(JSON.stringify({ token }), TED).uzivatel, 'abc123def456ghi', 'id z tokenu');
});

test('propadlý token se pozná bez dotazu na server', () => {
  const token = jwt({ id: 'u1', exp: TED / 1000 - 1 });
  assert.equal(tokenZUlozeni(JSON.stringify({ token, record: { id: 'u1' } }), TED).vyprselo, true);
});

test('nepřihlášen nebo nesmysl', () => {
  for (const ulozeni of [null, '', 'nejson', '{}', JSON.stringify({ token: '' }), JSON.stringify({ token: 'x.y.z', record: { id: '../../x' } })]) {
    assert.equal(tokenZUlozeni(ulozeni, TED), null, String(ulozeni));
  }
});

test('starší server', () => {
  assert.equal(jeStarsiServer('v0.15.2-beta'), true);
  assert.equal(jeStarsiServer('0.16'), false);
  assert.equal(jeStarsiServer('v0.80-beta'), false);
  assert.equal(jeStarsiServer('1.0.0'), false);
  assert.equal(jeStarsiServer('dev'), false, 'vývojovou stavbu nevarovat');
  assert.equal(jeStarsiServer(''), false);
});
