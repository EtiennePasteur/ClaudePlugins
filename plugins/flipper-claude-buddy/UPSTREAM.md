# Provenance

This plugin is **vendored** from Etienne's fork of `jxw1102/flipper-claude-buddy`.
It is not authored here — do not hand-edit it, as
`scripts/sync-flipper-claude-buddy-plugin.sh` overwrites this directory on
each sync. Fix things in the fork, push, then re-run the sync.

| | |
|---|---|
| Vendored from | <https://github.com/EtiennePasteur/flipper-claude-buddy> |
| Original upstream | <https://github.com/jxw1102/flipper-claude-buddy> |
| Path | `plugin` |
| Pinned commit | `ae7d276edc5f9c9a687aefeb82b4e474272f860e` |
| License | MIT — see [`LICENSE`](./LICENSE) (Copyright jxw1102) |

The fork carries a security hardening patch not present upstream: runtime
files (socket, pidfile, log, stats) moved out of the shared `/tmp` into a
per-user private directory, and the IPC socket created `0600` instead of
`0666`. See commit `756c46d` in the fork.

To update to the latest version, run from the repo root:

```bash
./scripts/sync-flipper-claude-buddy-plugin.sh
```
