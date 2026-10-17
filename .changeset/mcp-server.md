---
'@elvisgastelum/configure-env': minor
---

`configure-env mcp` serves the project's env files to agents over the Model Context Protocol, on stdio. Its tools read (`list_variables`, `get_value`, `check`, `history`, `get_schema`) and write (`set_values`, `generate_secret`, `unset`, `apply`, `fix_gitignore`, `update_schema`) through the CLI's own commands, masking every secret. None reveals a value: `set_values` refuses a secret variable, and `request_secret` answers the `configure-env set --prompt KEY` command the user types the secret with. `configure-env install mcp` registers the server for Claude Code, Cursor, VS Code, Codex or Gemini CLI, in the project or for the user, asking in a terminal and taking `--scope`, `--agent`, `--runner` and `--force`; it keeps every other entry of each configuration.
