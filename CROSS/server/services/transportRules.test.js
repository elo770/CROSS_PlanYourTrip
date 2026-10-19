import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultTransportMode } from '../../src/lib/transportRules.js'

test('uses the confirmed two-kilometre default threshold', () => {
  assert.equal(defaultTransportMode(1999), 'walk')
  assert.equal(defaultTransportMode(2000), 'walk')
  assert.equal(defaultTransportMode(2001), 'drive')
})
