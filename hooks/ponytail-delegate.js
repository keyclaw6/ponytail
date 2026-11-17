#!/usr/bin/env node
// ponytail — PreToolUse hook on the subagent tools (Claude Code Agent, Codex spawn_agent)
//
// A subagent prompt that starts with "/ponytail lite|full|ultra" gets that
// level's ruleset in place of the line (getSubagentPrompt); any other prompt
// passes through untouched.

const { getSubagentPrompt } = require('./ponytail-instructions');

// Claude Code names the prompt `prompt`, Codex `message`.
const FIELDS = ['prompt', 'message'];

let input = '';
let done = false;

function finish() {
  if (done) return;
  done = true;
  try {
    const toolInput = JSON.parse(input.replace(/^﻿/, '')).tool_input || {};
    const field = FIELDS.find((name) => typeof toolInput[name] === 'string');
    const prompt = field && getSubagentPrompt(toolInput[field]);
    if (!prompt) return;
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        // Both harnesses apply updatedInput only together with allow.
        permissionDecision: 'allow',
        updatedInput: { ...toolInput, [field]: prompt },
      },
    }));
  } catch (e) {
    // Silent fail: an unreadable payload starts the subagent unchanged.
  }
}

process.stdin.on('data', chunk => { input += chunk; });
// Never block the tool call (#443, #790): same fallback as the other hooks.
process.stdin.on('end', () => { finish(); process.exit(0); });
process.stdin.on('error', () => { finish(); process.exit(0); });
setTimeout(() => { finish(); process.exit(0); }, 1000);
