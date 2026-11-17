# ponytail-review: maintainer record (keyclaw6 fork)

Fork-only record; ponytail's normal use never opens it.

## 2026-11-17: the agents' one review skill (D406)

**Decision.** Kristian made `ponytail-review` the one code review skill for his
agents in every harness, replacing Claude Code's `code-review` and Codex's
`review-agent`, improved with `review-agent`'s precision rules ("Please go
ahead", D406, after: "just finding a lot of issue is not nessaryly a good
things, if there are all super niche egde cases or false"). It is visible to the
model again; the other ponytail skills stay hidden and the mode stays off.

**Added.** From `review-agent`: only defects the change brings in (not
pre-existing, intentional, style or speculative); a case shown from the code;
confirmed against tests and call sites; the whole change read after the first
finding; the author would fix it; never invent a finding; read AGENTS.md and
CLAUDE.md; review a branch from its merge base. Load now decides scale
findings only.

**Evidence.** Trial on Dotfiles 843e830 (the comparison report is in
ryote-os 7f186d1; the trial outputs and these reruns are reported with D406). The one clearly real, would-fix defect there: the
installer's hidden-skills check reads only `skills/ponytail` of six skills
(found by `code-review high` only). 5.1.2 said "Ship". Three clean reruns
on Opus 5.5 (a 5.1.2 copy with only the review body swapped; medium and high
effort; two of them with the depth passes below) also said "Ship": no false or
niche findings, one valid duplication note at high effort, the real defect
missed each time. Each run confirmed the live copies pass the check and
stopped. The old text at high effort did the same. A fourth run is excluded:
the new fork sat next to the repo and the review judged against it.

**Rejected.** Two depth passes taken from `code-review` (name the job of every
removed line; check the change against its own promises) were tried and
removed: they did not change the outcome on this commit.

**Open.** Hypothesis, not shown: a single pass misses what a multi-angle review
finds, because it stops once the happy path passes and does not try negative
cases. Options not taken yet: independent finder passes with a verification
vote (like `code-review`), or a terse agent output. Test on a few more real
diffs before adding either.
