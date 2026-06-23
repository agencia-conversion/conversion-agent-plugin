#!/usr/bin/env bash
# SessionStart hook for the Conversion Agent plugin.
#
# Emits a single JSON context stub that tells Claude to act as the Consultor
# de SEO, loading the playbook from the `/conversion-agent:orchestrator` skill
# — the canonical, auto-synced playbook in plugin-first. A local CLAUDE.md is
# honored only if a legacy materialization happened to leave one on disk;
# nothing writes CLAUDE.md to disk anymore, so the skill is the source of truth.
#
# Self-heal (one-time): the legacy CLI-era bootstrap used to set
# `~/.claude/settings.json -> statusLine -> "conversion statusline"`. That CLI
# is decommissioned, so the command no longer exists and the statusline breaks.
# If we find that exact stale value we remove it. We never touch a statusLine
# set by the user or another plugin. (A plugin-provided statusline is backlog.)
#
# Must run in <100ms; the self-heal runs at most once per install (flag-gated),
# so the steady-state path is just the `cat` below.

set -euo pipefail

SETTINGS="$HOME/.claude/settings.json"
HEAL_FLAG="$HOME/.claude/conversion-agent-statusline-healed"

if [ ! -f "$HEAL_FLAG" ]; then
  if [ -f "$SETTINGS" ] && command -v python3 >/dev/null 2>&1; then
    python3 - "$SETTINGS" <<'PY' 2>/dev/null || true
import json, sys
path = sys.argv[1]
try:
    with open(path) as f:
        data = json.load(f)
except Exception:
    sys.exit(0)
sl = data.get("statusLine")
if isinstance(sl, dict) and sl.get("command") == "conversion statusline":
    data.pop("statusLine", None)
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
PY
  fi
  touch "$HEAL_FLAG" 2>/dev/null || true
fi

cat <<'EOF'
{"type":"context","content":"Conversion Agent plugin ativo. Se esta pasta é um project Conversion (tem `.conversion/manifest.json`), atue como Consultor de SEO da Conversion seguindo o playbook `/conversion-agent:orchestrator` (use o CLAUDE.md local apenas se existir — caso contrário a skill é a fonte canônica). Fora de um project, invoque `/conversion-agent:orchestrator` para carregar o playbook a partir do pedido do usuário. Nunca cite o agent `conversion-orchestrator` (não existe mais); a main session é o consultor."}
EOF
