---
name: ngx-translate-xlsx
description: Externalize an Angular app's hardcoded UI strings into @ngx-translate/core keys backed by an Excel (.xlsx) sheet, then compile the sheet to i18n JSON with the xlsxToJsonTranslate CLI. Trigger when the user wants to translate or internationalize Angular UI, externalize hardcoded strings (in any source language) into translation keys, add or fill translation keys in an .xlsx, add a new language column, find missing translations, or (re)generate i18n JSON from a translations spreadsheet.
license: MIT
metadata:
  version: '1.0'
---

# ngx-translate-xlsx

Externalize hardcoded UI strings in an Angular app into [`@ngx-translate/core`](https://github.com/ngx-translate/core)
keys, keep the source-of-truth in an Excel sheet, and compile that sheet to per-language JSON with
[`xlsxToJsonTranslate`](https://github.com/EtiennePasteur/xlsxToJsonTranslate).

Two layers, kept separate:
- **The `.xlsx`** is the editable source (one row per key, one column per language).
- **`xlsxToJsonTranslate`** compiles a chosen language column into nested JSON that ngx-translate loads.

This skill is for **incremental** work: translating a screen/component, filling missing strings, or
adding a language — not whole-app one-shots.

This skill is project-agnostic. It **discovers** the project's settings (translations file, i18n
output dir, key-namespace style) instead of assuming them. The only hard requirement is the workbook
layout below.

## Step 0 — Ensure ngx-translate is installed & configured

Do this first, every time. The translate pipe/keys are useless if the library isn't wired up.

1. **Installed?** Check `package.json` for `@ngx-translate/core` (and `@ngx-translate/http-loader` if
   the app loads JSON over HTTP). `npm ls @ngx-translate/core` confirms.
2. **Configured?** Search the app's bootstrap for a registration + a loader:
   - Standalone (Angular 15+): `provideTranslateService(...)` in `app.config.ts` (or wherever
     `ApplicationConfig`/`bootstrapApplication` providers live), with a `TranslateLoader`.
     `rg "provideTranslateService|TranslateLoader|TranslateModule" src`.
   - NgModule apps: `TranslateModule.forRoot({ loader: … })` in the root module.
3. **If either is missing → ASK the user** (do not auto-install): "ngx-translate isn't set up in this
   project — want me to install and configure it?" If they decline, stop and let them wire it up.
4. **If they accept**, set it up (adapt to the installed Angular + ngx-translate version):
   - Install: `npm i @ngx-translate/core @ngx-translate/http-loader`.
   - Pick the i18n output dir served at runtime: `public/i18n/` (Angular 18+ default static folder) or
     `src/assets/i18n/` (older). Create it.
   - Add an HTTP loader and register the service in the standalone config, e.g.:
     ```ts
     // app.config.ts
     import { provideHttpClient } from '@angular/common/http';
     import { provideTranslateService, TranslateLoader } from '@ngx-translate/core';
     import { HttpClient } from '@angular/common/http';
     import { inject } from '@angular/core';

     class JsonTranslateLoader implements TranslateLoader {
       private http = inject(HttpClient);
       getTranslation(lang: string) { return this.http.get(`i18n/${lang}.json`); }
     }

     export const appConfig = {
       providers: [
         provideHttpClient(),
         provideTranslateService({
           fallbackLang: 'en',            // your default source language
           loader: { provide: TranslateLoader, useClass: JsonTranslateLoader },
         }),
         // set the active language at startup (e.g. inject TranslateService and call .use(...))
       ],
     };
     ```
     The `provideTranslateService` config keys vary by version (v17 uses `fallbackLang`; older uses
     `defaultLanguage`, or `TranslateModule.forRoot`). Match the installed version — see the
     ngx-translate repo.
   - Confirm it builds (`npx ng build` or the project's lint/test) before translating anything.

Record the discovered/created **i18n output dir** and **loader URL prefix** (`i18n/`) — you'll use them
when compiling JSON.

## Prerequisites

- **`xlsxToJsonTranslate`** on PATH. If missing: `pipx install xlsxToJsonTranslate`
  (`which xlsxToJsonTranslate` to check).
- **Node** (for the bundled, dependency-free `scripts/xlsx-i18n.mjs` — no `npm install`, no `zip`/`unzip`).

## The workbook contract (must match the tool)

| col 0 | col 1 | col 2 | col 3 | … |
|-------|-------|-------|-------|---|
| `Informations` | `Key` | `en` | `fr` | … |
| Home page | `APP.HOME.TITLE` | Welcome | Bienvenue | |

- **Column 1 (the 2nd column) MUST be the `Key`** — `xlsxToJsonTranslate` reads the key from column
  index 1 (its default) and **you must NOT pass `-k`/`--keycolumn`** (a bug makes the value a string
  and crashes the tool — see `references/tooling.md`).
- **Each language is a column whose header cell is the lang code** (`en`, `fr`, …). The tool selects
  the column by exact header match for `-l <lang>`.
- **Keys are dotted** (`<NAMESPACE>.<NAME>`) → the tool builds nested JSON (`A.B.C` → `{A:{B:{C}}}`).
- Column 0 (`Informations`) is a free-text note for humans; the tool ignores it.

## Bundled script — `scripts/xlsx-i18n.mjs`

Run it from the project root (path is relative to this skill folder, i.e.
`<skill-dir>/scripts/xlsx-i18n.mjs`):

| Command | Purpose |
|---|---|
| `create <file> [--langs en,fr] [--force]` | Create a new workbook with the header row. |
| `dump <file> [--missing <lang>]` | Print all rows as JSON; `--missing <lang>` lists keys with an empty cell for that lang. |
| `add <file> [--rows <rows.json>] [--create] [--langs en,fr]` | Upsert rows (from a JSON file or stdin). New key → append; existing key → update the given language cells. Auto-adds referenced language columns. `--create` makes the file if absent. |
| `add-lang <file> <lang>` | Append an empty language column. |

Row JSON shape (array) accepted by `add` — nested or flat:
```json
[
  { "info": "Home page", "key": "APP.HOME.TITLE", "values": { "en": "Welcome", "fr": "Bienvenue" } },
  { "info": "Home page", "key": "APP.HOME.RESULTS-PLURAL", "en": "{{count}} results" }
]
```
It round-trips files edited in Excel (preserves other sheets/styles/columns). `{{param}}`
placeholders, accents, apostrophes and non-breaking spaces are preserved verbatim.

## Core workflow (translate a screen/component)

1. **Run Step 0** (ensure ngx-translate is set up).
2. **Locate the translations `.xlsx`** — ask the user, or search the repo for an existing `.xlsx`. If
   none, create one: `… create <file>` (choose the source language column(s), e.g. `--langs en` or
   `--langs en,fr`). Pick a workbook path with the user (e.g. at repo root or next to the i18n dir).
3. **Learn what exists** so you reuse keys/namespaces and avoid duplicates: `… dump <file>`.
4. **Find hardcoded strings** in the target file(s) — templates and TS (toasts, dialog/menu labels,
   aria labels, computed labels). Choose keys per `references/conventions.md`.
5. **Add the keys**: write the rows to a temp JSON and `… add <file> --rows /tmp/rows.json` (or pipe
   via stdin). Add `--create` if the file may not exist yet.
6. **Replace the strings in code** (full pattern catalog in `references/conventions.md`):
   - template text → `{{ "KEY" | translate }}`; element inputs → `[attr]="'KEY' | translate"`.
   - TS → `translateService.instant('KEY', { params })`.
   - components that translate their own inputs → pass the **key**, not text.
   - plurals → two keys (`…-SINGULAR`/`…-PLURAL`) chosen in code + `{{count}}`.
   - date/number format patterns → dedicated technical keys fed into the pipe.
7. **Compile JSON** — once per language; the Key is column 1, so **do NOT pass `--keycolumn`**:
   ```
   xlsxToJsonTranslate -i <file> -o <i18n-dir>/<lang>.json -l <lang>
   ```
   Use the i18n output dir discovered/created in Step 0.
8. **Verify**: run the project's lint + tests. If tests load the real JSON, regenerate it first.

## Add a new language

```
node <skill-dir>/scripts/xlsx-i18n.mjs add-lang <file> <lang>     # add the column
# fill it: in Excel, or `… add <file> --rows rows.json` with { key, values:{ <lang>: "..." } }
xlsxToJsonTranslate -i <file> -o <i18n-dir>/<lang>.json -l <lang>
```
Then make the app aware of the language (e.g. an allowed-languages list / language switcher) so the
loader can serve it.

## Translate missing strings

```
node <skill-dir>/scripts/xlsx-i18n.mjs dump <file> --missing <lang>   # keys with an empty cell
# translate them, `… add` the values, then re-compile <lang>.json
```

## Quick conventions (full catalog in `references/conventions.md`)

- Dotted keys; recommended style `<NAMESPACE>.<NAME>` (uppercase, dash-separated), one namespace per
  page/feature/popup. **Detect the project's existing prefix/style from the sheet and match it**; if
  starting fresh, pick a short, consistent scheme.
- A `COMMON` (or similar) namespace for strings shared across the app; a `TECHNICAL` namespace for
  locale-adapted format patterns (date/number formats fed to pipes).
- Preserve the source text exactly (accents, curly vs straight apostrophes, ellipsis `…`, NBSP).
- Don't translate genuine data/mock placeholders or developer-only logs; flag them to the user.

## Adapting to a project (discovery checklist)

- **Translations file**: ask the user or search for an existing `.xlsx`; else create one.
- **i18n output dir + URL prefix**: read them from the app's `TranslateLoader` (e.g. `i18n/${lang}.json`
  served from `public/i18n/` or `src/assets/i18n/`).
- **Key namespace**: detect from existing keys; don't impose one.
- **Languages**: the source language is the first language column; add others as needed.
- The bundled script and `xlsxToJsonTranslate` are otherwise project-independent. Keep the `Key` in
  column 1 (the tool's `--keycolumn` is unusable — see `references/tooling.md`).
