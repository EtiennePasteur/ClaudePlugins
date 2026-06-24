# TypeScript LSP in Claude Code

## What is LSP?

The **Language Server Protocol** (LSP) is an open standard that defines how editors and tools communicate with a language server. A language server provides language-aware features such as:

- Autocompletion
- Go-to-definition
- Find references
- Real-time diagnostics (type errors, unused variables, etc.)
- Hover information (type signatures, documentation)

LSP decouples language intelligence from any specific editor, so the same server can power VS Code, Neovim, and — relevant here — **Claude Code**.

## Why enable it in Claude Code?

When the TypeScript language server is active, Claude gains access to the same type information and diagnostics your editor uses. This means:

- **More accurate edits** — Claude sees real compiler errors before you do, and can fix them in the same pass.
- **Better navigation** — Claude can jump to definitions and find all references across your codebase.
- **Richer context** — type signatures and inferred types help Claude understand intent without reading every file.

## Prerequisites

Install the TypeScript language server and TypeScript globally:

```bash
npm install -g typescript-language-server typescript
```

> **Tip:** If you manage Node versions with nvm, make sure the global install is done under the Node version you use with Claude Code.

## Activating TypeScript LSP in Claude Code

Install the official `typescript-lsp` plugin from the Claude Code marketplace:

```bash
/plugin install typescript-lsp
```

This plugin connects Claude Code to the TypeScript language server you installed in the previous step, giving Claude access to type-aware diagnostics and navigation.

## Further reading

- [Claude Code documentation — Language Server Protocol](https://code.claude.com/docs/en/plugins-reference#lsp-servers)
