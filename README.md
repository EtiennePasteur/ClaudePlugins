# epasteur-claude-plugins

Etienne Pasteur's personal [Claude Code](https://docs.claude.com/en/docs/claude-code) plugin marketplace.

Repository: <https://github.com/EtiennePasteur/epasteur-claude-plugins>

## Use this marketplace

```bash
/plugin marketplace add EtiennePasteur/epasteur-claude-plugins
```

Then browse and install plugins with `/plugin`.

## Repository layout

```
epasteur-claude-plugins/
├── .claude-plugin/
│   └── marketplace.json    # marketplace manifest — lists available plugins
├── plugins/                # plugin sources live here
├── doc/                    # standalone guides (not tied to a plugin)
└── README.md
```

## Good practices

- [TypeScript LSP in Claude Code](doc/good-practices/typescript-lsp.md) — enable type-aware diagnostics and navigation in Claude Code.

## Adding a plugin

1. Create the plugin under `plugins/<plugin-name>/` with its own manifest:

   ```
   plugins/<plugin-name>/
   ├── .claude-plugin/
   │   └── plugin.json       # plugin manifest (name, version, ...)
   ├── commands/             # optional: slash commands (.md)
   ├── agents/               # optional: subagents (.md)
   ├── skills/               # optional: skills (SKILL.md)
   ├── hooks/                # optional: hooks.json
   └── .mcp.json             # optional: MCP servers
   ```

   A minimal `plugin.json`:

   ```json
   {
     "name": "<plugin-name>",
     "description": "What this plugin does.",
     "version": "0.1.0",
     "author": { "name": "Etienne Pasteur", "email": "me@etiennepasteur.com" }
   }
   ```

2. Register it in `.claude-plugin/marketplace.json` by appending to the `plugins` array:

   ```json
   {
     "name": "<plugin-name>",
     "source": "./plugins/<plugin-name>",
     "description": "What this plugin does.",
     "version": "0.1.0"
   }
   ```

3. Validate and reload:

   ```bash
   claude plugin validate .
   /plugin marketplace update epasteur-claude-plugins
   ```
