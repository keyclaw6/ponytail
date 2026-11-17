#!/usr/bin/env node
// ponytail — Claude Code SessionStart activation hook (also Codex, Copilot,
// Grok, CodeBuddy and Cursor sessionStart)
//
// Runs on every session start:
//   1. Writes flag file at $CLAUDE_CONFIG_DIR/.ponytail-active (defaults to ~/.claude; statusline reads this)
//   2. Emits ponytail ruleset as hidden SessionStart context
//   3. Detects missing statusline config and emits setup nudge

const fs = require('fs');
const path = require('path');
const { getDefaultMode, getClaudeDir, isShellSafe } = require('./ponytail-config');
const { getPonytailInstructions } = require('./ponytail-instructions');
const {
  bindSession,
  clearMode,
  cursorRuleNotice,
  cursorRulePath,
  isCodeBuddy,
  isCodex,
  isCopilot,
  isCursor,
  readMode,
  setMode,
  writeHookOutput,
} = require('./ponytail-runtime');

const claudeDir = getClaudeDir();
const settingsPath = path.join(claudeDir, 'settings.json');

function activate(mode) {
  // "off" mode — skip activation entirely, don't write flag or emit rules
  if (mode === 'off') {
    clearMode();
    process.exit(0);
  }

  // Cursor with the always-on rule in the workspace: the rule already carries the
  // ruleset and would contradict any other level, so leave the flag alone and
  // hand the model a one-line notice instead of a second copy (#817).
  if (isCursor) {
    const rule = cursorRulePath();
    if (rule) {
      try {
        writeHookOutput('SessionStart', mode, cursorRuleNotice(rule));
      } catch (e) {
        // Silent fail — stdout closed/EPIPE at hook exit must not surface as a hook failure
      }
      process.exit(0);
    }
  }

  // 1. Write flag file
  try {
    setMode(mode);
  } catch (e) {
    // Silent fail -- flag is best-effort, don't block the hook
  }

  // 2. Emit the ponytail ruleset, filtered to the active intensity level.
  let output = getPonytailInstructions(mode);

  // 2b. Codebase map: what already exists, so "reuse first" costs no search. Fail open: a map
  // that cannot be built must never block or slow the session start.
  if (mode !== 'review' && process.env.PONYTAIL_MAP !== '0') try {
    const map = require('./ponytail-map').buildMap(process.cwd());
    if (map) output += '\n\n' + map;
  } catch (e) { /* no map */ }

  // 3. Detect missing statusline config — nudge Claude to help set it up
  if (!isCodex && !isCopilot && !isCursor && !isCodeBuddy) try {
    const isWindows = process.platform === 'win32';
    let statusCommand = null;
    if (fs.existsSync(settingsPath)) {
      // Strip UTF-8 BOM some editors prepend on Windows (breaks JSON.parse)
      const raw = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
      const settings = JSON.parse(raw);
      if (settings.statusLine) {
        statusCommand = String(settings.statusLine.command || '');
      }
    }

    // A statusLine already set up before #1032 can still run a script from a
    // plugin version that has since been deleted. Only absolute paths are checked,
    // so ~ or $HOME forms are never mistaken for missing files.
    const ref = statusCommand &&
      statusCommand.match(/"([^"]*ponytail-statusline\.(?:sh|ps1))"|(\S*ponytail-statusline\.(?:sh|ps1))/);
    const refPath = ref ? (ref[1] || ref[2]) : null;
    // isShellSafe keeps quotes, newlines and shell metacharacters from
    // settings.json out of the model context.
    // On Windows only drive-letter or UNC paths count: a Git Bash path such as
    // /c/Users/... is absolute to Node but does not resolve, so it would be
    // flagged as broken while it works.
    const checkable = refPath && isShellSafe(refPath) && path.isAbsolute(refPath) &&
      (!isWindows || /^([A-Za-z]:[\\/]|\\\\)/.test(refPath));
    const stalePath = checkable && !fs.existsSync(refPath) ? refPath : null;

    // The plugin root is a versioned cache dir (.../ponytail/4.12.0/) that Claude
    // Code deletes on update, so a statusLine pointing into it goes blank after the
    // next update (#1032). Point it at a copy in the config dir instead. A statusLine
    // that already runs ponytail keeps its script type, so its copy stays fresh.
    const usePs1 = refPath ? refPath.endsWith('.ps1') : isWindows;
    const scriptName = usePs1 ? 'ponytail-statusline.ps1' : 'ponytail-statusline.sh';
    const scriptPath = path.join(claudeDir, scriptName);

    // Nudge at most once — the flag file marks that the user has already seen
    // (and implicitly declined) the statusline setup offer. Repeating it every
    // session start turns a helpful hint into a nag. A broken path is nudged once
    // per path: the flag records it.
    const nudgeFlagPath = path.join(claudeDir, '.ponytail-statusline-nudged');
    let nudged = null;
    try { nudged = fs.readFileSync(nudgeFlagPath, 'utf8'); } catch (e) { /* not nudged yet */ }
    const nudge = stalePath ? nudged !== stalePath : statusCommand === null && nudged === null;

    // Refresh the copy every session so script fixes ship with plugin updates.
    // Copy to a new temp file, then rename: the rename replaces a symlink at
    // scriptPath instead of writing through it, and a concurrent session never
    // runs a half-written script.
    if (nudge || fs.existsSync(scriptPath)) {
      const tmpPath = scriptPath + '.' + process.pid + '.tmp';
      try {
        fs.copyFileSync(path.join(__dirname, scriptName), tmpPath, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(tmpPath, 0o644);
        fs.renameSync(tmpPath, scriptPath);
      } finally {
        try { fs.unlinkSync(tmpPath); } catch (e) { /* renamed */ }
      }
    }

    if (nudge) {
      try { fs.writeFileSync(nudgeFlagPath, stalePath || ''); } catch (e) { /* best-effort */ }
      if (stalePath) {
        output += "\n\n" +
          "STATUSLINE BROKEN: The statusLine in " + settingsPath + " runs " + stalePath +
          ", which no longer exists (the ponytail plugin was updated and its old version removed), " +
          "so the ponytail badge is blank. Replace that path with " + scriptPath + ", which survives updates, " +
          "quoting it for your shell. Keep the rest of the command. " +
          "Proactively offer to fix this for the user on first interaction.";
      } else if (isShellSafe(scriptPath)) {
        const command = isWindows
          ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
          : `bash "${scriptPath}"`;
        const statusLineSnippet =
          '"statusLine": { "type": "command", "command": ' + JSON.stringify(command) + ' }';
        output += "\n\n" +
          "STATUSLINE SETUP NEEDED: The ponytail plugin includes a statusline badge showing active mode " +
          "(e.g. [PONYTAIL], [PONYTAIL:ULTRA]). It is not configured yet. " +
          "To enable, add this to " + settingsPath + ": " +
          statusLineSnippet + " " +
          "Proactively offer to set this up for the user on first interaction.";
      } else {
        // ponytail: config dir path has shell metacharacters; don't embed it in a
        // command snippet; have the agent wire it up by hand instead.
        output += "\n\n" +
          "STATUSLINE SETUP NEEDED: The ponytail plugin includes a statusline badge showing active mode. " +
          "Its path contains characters unsafe to embed in a shell command, so configure it manually: " +
          "add a statusLine command of type \"command\" that runs " + scriptName +
          " from " + claudeDir + " to " + settingsPath + ", quoting/escaping the path for your shell. " +
          "Proactively offer to set this up for the user on first interaction.";
      }
    }
  } catch (e) {
    // Silent fail — don't block session start over statusline detection
  }

  try {
    writeHookOutput('SessionStart', mode, output);
  } catch (e) {
    // Silent fail — stdout closed/EPIPE at hook exit must not surface as a hook failure
  }
}

// Compaction and resume re-run SessionStart inside the same conversation, so
// they keep the live level (compaction also stays off after "stop ponytail")
// instead of resetting to the default. Claude Code and Codex pass the trigger as
// `source` on stdin; reading it there keeps the hook entry, and the trust Codex
// gave it, unchanged.
let input = '';
let done = false;

// A Claude Code subagent compacts with its parent's session id and its own
// agent_id. A level its prompt carried (ponytail-delegate.js puts the ruleset at
// the start of that prompt) is the subagent's alone, so it is read back from the
// start of the subagent's transcript rather than kept in the parent's state.
// Claude Code 2.1 keeps that transcript at <session>/subagents/agent-<id>.jsonl
// beside the parent's; anywhere else it is simply not found.
function subagentLevel(data) {
  let fd;
  try {
    const file = path.join(path.dirname(data.transcript_path), data.session_id,
      'subagents', 'agent-' + data.agent_id + '.jsonl');
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(4096);
    const firstLine = head.toString('utf8', 0, fs.readSync(fd, head, 0, head.length, 0)).split('\n', 1)[0];
    const match = firstLine.match(/"(?:content|text)":"PONYTAIL MODE ACTIVE — level: (lite|full|ultra)\\n/);
    return match && match[1];
  } catch (e) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function finish() {
  if (done) return;
  done = true;
  let data = {};
  try {
    // Strip UTF-8 BOM some shells prepend when piping (breaks JSON.parse)
    data = JSON.parse(input.replace(/^\uFEFF/, '')) || {};
    bindSession(data.session_id);
  } catch (e) {
    // No payload, or an unparseable one: treat it as a fresh session
  }
  const { source, session_id: sessionId } = data;
  const carried = source === 'compact' && data.agent_id && !readMode() && subagentLevel(data);
  if (carried) {
    try { writeHookOutput('SessionStart', carried, getPonytailInstructions(carried)); } catch (e) { /* EPIPE */ }
    return;
  }
  // Resuming continues a conversation too (T3 Code resumes its threads after a
  // restart). Only a session id says whose level it is.
  if (source === 'compact') activate(readMode() || 'off');
  else if (source === 'resume' && sessionId) activate(readMode() || getDefaultMode());
  else activate(getDefaultMode());
}

process.stdin.on('data', chunk => { input += chunk; });
// Never hang the session start (#443, #790): like the mode tracker, recover on a
// stdin error or after a short ref'd fallback, and start at the default level.
process.stdin.on('end', () => { finish(); process.exit(0); });
process.stdin.on('error', () => { finish(); process.exit(0); });
setTimeout(() => { finish(); process.exit(0); }, 1000);
