# Tooling cheat-sheet

## `xlsxToJsonTranslate` (Python CLI)

Repo: https://github.com/EtiennePasteur/xlsxToJsonTranslate · install: `pipx install xlsxToJsonTranslate`
· verified version: 0.1.3 (reads `.xlsx` via `xlrd` 1.2.0).

```
xlsxToJsonTranslate -i <input.xlsx> -o <output.json> -l <lang>
```

| Flag | Long | Default | Meaning |
|------|------|---------|---------|
| `-i` | `--ifile=`  | `translate-file.xlsx` | input workbook |
| `-o` | `--ofile=`  | `fr.json` | output JSON file |
| `-l` | `--lang=`   | `fr` | language = the **header name** of the column to export |
| `-k` | `--keycolumn=` | `1` | key column index (0-based) — **DO NOT USE, see below** |

### How it behaves
- Reads the **first worksheet only**.
- Key column = index `1` (0-based) → the **2nd column** must hold the dotted key.
- Language column is found by `row_values(0).index(<lang>)` → the header cell must **exactly equal**
  the `-l` value (`en`, `fr`, …). Missing header → the tool raises `ValueError` and exits.
- Dotted keys become nested JSON via `unflatten`: `A.B.C` → `{"A":{"B":{"C": "…"}}}`.
- Duplicate keys: last row wins (deep-merged).
- Interpolation placeholders (`{{count}}`, etc.) are copied **verbatim**.
- One run = one language. Run once per language to emit `en.json`, `fr.json`, …

### ⚠️ Gotcha: never pass `-k` / `--keycolumn`
The tool stores the flag value **without an `int()` cast**, so any explicit key column makes
`keyColumn` a string and the tool crashes with:
```
TypeError: list indices must be integers or slices, not str
```
Additionally the short `-k` is declared without an argument in `getopt`. **Only the default works.**
→ Put the `Key` in the **2nd column** and omit the flag entirely:
```
xlsxToJsonTranslate -i translations.xlsx -o <i18n-dir>/fr.json -l fr            # ✅ works
xlsxToJsonTranslate -i translations.xlsx -o <i18n-dir>/fr.json -l fr --keycolumn=1   # ❌ crashes
```

## `@ngx-translate/core` consumer wiring (generic)

Repo: https://github.com/ngx-translate/core · default interpolation uses `{{ param }}`.

- **Loader** — a `TranslateLoader` fetches the compiled JSON, conventionally from a URL prefix like
  `i18n/${lang}.json`. With `@ngx-translate/http-loader` or a small custom `HttpClient` loader. The
  files are served from the project's static dir (Angular 18+: `public/i18n/`; older: `src/assets/i18n/`).
- **Registration** — standalone apps: `provideTranslateService({ loader, fallbackLang })` in the
  `ApplicationConfig` providers; NgModule apps: `TranslateModule.forRoot({ loader })`. Config keys vary
  by major version (v17 `fallbackLang`; older `defaultLanguage`).
- **Usage** — template `{{ 'KEY' | translate }}` / `[attr]="'KEY' | translate"`; TS
  `translate.instant('KEY', { param })`. Add `TranslatePipe`/`TranslateModule` to standalone imports.
- **Active language** — set at startup (inject `TranslateService`, call `.use(lang)`), often from a
  user/browser preference gated by an allowed-languages list.
- **Tests** — to run against the real compiled JSON, provide a static `TranslateLoader` that returns
  the imported `<lang>.json` (enable `resolveJsonModule` to `import` it) and set the source language.

## Discover-then-regenerate (per project)

```
# 1. find where compiled JSON lives + its URL prefix → from the app's TranslateLoader
# 2. after editing the workbook (bundled script or Excel), recompile each language:
xlsxToJsonTranslate -i <translations.xlsx> -o <i18n-dir>/<lang>.json -l <lang>
# 3. run the project's checks
<project lint> && <project tests>
```
