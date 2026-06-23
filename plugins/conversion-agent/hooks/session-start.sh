#!/usr/bin/env bash
# SessionStart hook for the Conversion Skills plugin.
#
# 1) Best-effort statusline bootstrap. Conversion Skills owns
#    `~/.claude/settings.json -> statusLine` once per install (gated by a
#    flag file at ~/.claude/conversion-skills-statusline-bootstrap). Runs
#    only when no statusLine is configured at all — never overrides
#    another plugin's value.
# 2) Emits a single JSON stub that tells Claude to load the Consultor de
#    SEO playbook from either the local CLAUDE.md (if inside a
#    project-root) or the /conversion-agent:orchestrator skill.
#
# Must run in <100ms; python3 startup is ~50ms which is acceptable. If
# python3 is unavailable, we silently skip the bootstrap and emit the
# context as before.

set -euo pipefail

SETTINGS="$HOME/.claude/settings.json"
FLAG="$HOME/.claude/conversion-skills-statusline-bootstrap"

if [ ! -f "$FLAG" ] && command -v python3 >/dev/null 2>&1; then
  if [ -f "$SETTINGS" ]; then
    HAS_STATUS=$(python3 -c "
import sys, json
try:
    with open('$SETTINGS') as f:
        d = json.load(f)
    print('yes' if 'statusLine' in d else 'no')
except Exception:
    print('error')
" 2>/dev/null || echo "error")

    if [ "$HAS_STATUS" = "no" ]; then
      python3 -c "
import json
with open('$SETTINGS') as f:
    d = json.load(f)
d['statusLine'] = {'type': 'command', 'command': 'conversion statusline'}
with open('$SETTINGS', 'w') as f:
    json.dump(d, f, indent=2)
    f.write('\n')
" 2>/dev/null && touch "$FLAG"
    elif [ "$HAS_STATUS" = "yes" ]; then
      # Already configured (ours or someone else's) — never tries again.
      touch "$FLAG"
    fi
    # On parse error: leave the flag absent so a subsequent session can retry.
  else
    # No settings.json yet — create with our statusLine so first-time
    # users get the rodapé without running `conversion init`.
    mkdir -p "$HOME/.claude"
    python3 -c "
import json
with open('$SETTINGS', 'w') as f:
    json.dump({'statusLine': {'type': 'command', 'command': 'conversion statusline'}}, f, indent=2)
    f.write('\n')
" 2>/dev/null && touch "$FLAG"
  fi
fi

cat <<'EOF'
{"type":"context","content":"Conversion Agent plugin ativo. Se esta pasta tem `.conversion/manifest.json`, siga o CLAUDE.md local — você é o Consultor de SEO da Conversion. Caso contrário, invoque `/conversion-agent:orchestrator` para carregar o playbook e atuar como Consultor de SEO a partir do pedido do usuário. Nunca cite `conversion-orchestrator` agent (não existe mais); a main session é o consultor."}
EOF
