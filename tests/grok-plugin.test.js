#!/usr/bin/env node
// Grok Build loads Ponytail through its native skill system. Lifecycle-hook
// stdout is passive in Grok, so this adapter must not register any hooks.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

test('Grok manifest is a skill-only adapter with no lifecycle hooks', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, 'ponytail');
  assert.equal(manifest.hooks, undefined);
  assert.equal(manifest.mcpServers, undefined);
  assert.ok(!fs.existsSync(path.join(root, 'hooks', 'hooks.json')));
  assert.ok(!fs.existsSync(path.join(root, '.grok-plugin', 'hooks.json')));
});

// Fork: every skill except the review is kept from the model and runs only when
// the user names it, so ponytail stays off until /ponytail (upstream lets the
// model auto-invoke it). The review is the agents' code review skill, so the
// model may use it.
test('only the review is offered to the model, in every host', () => {
  for (const id of fs.readdirSync(path.join(root, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name)) {
    const dir = path.join(root, 'skills', id);
    const hidden = id !== 'ponytail-review';
    const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
    assert.equal(/^disable-model-invocation: true$/m.test(skill), hidden, id);
    assert.match(fs.readFileSync(path.join(dir, 'agents', 'openai.yaml'), 'utf8'),
      new RegExp(`^policy:\\n {2}allow_implicit_invocation: ${!hidden}$`, 'm'), id);
  }
});

test('Grok marketplace resolves a subdirectory with the same skills as direct installation', () => {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, '.grok-plugin', 'marketplace.json'), 'utf8'));
  const entry = catalog.plugins.find((plugin) => plugin.name === 'ponytail');
  const pluginRoot = path.resolve(root, entry.source);
  // Grok rejects a marketplace source of "./", even though direct installation works.
  assert.notEqual(pluginRoot, root, 'marketplace source must name a subdirectory');
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'plugin.json'), 'utf8'));
  assert.equal(manifest.name, entry.name);
  assert.equal(manifest.hooks, undefined);
  assert.equal(manifest.mcpServers, undefined);
  assert.equal(path.resolve(pluginRoot, manifest.skills), path.join(root, 'skills'));
});
