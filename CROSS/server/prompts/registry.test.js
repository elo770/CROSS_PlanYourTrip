import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PROMPT_VERSION, getPromptSet, listPromptVersions } from './registry.js'

test('prompt registry exposes a baseline and the structured default', () => {
  assert.deepEqual(listPromptVersions().map((item) => item.version), ['v0-baseline', 'v1-structured'])
  assert.equal(getPromptSet().version, DEFAULT_PROMPT_VERSION)
})

test('unknown prompt versions safely fall back to the default', () => {
  assert.equal(getPromptSet('missing').version, DEFAULT_PROMPT_VERSION)
  assert.match(getPromptSet('v1-structured').extractionSystem, /day block/)
})
