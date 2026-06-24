# Translation conventions

The reproducible methodology behind this skill. It is project-agnostic: **detect the host project's
existing namespace/style from the workbook and match it** rather than imposing the examples below.
Examples use a neutral `APP` prefix.

## Key format & namespaces

- Dotted keys `<NAMESPACE>.<NAME>` — recommended style: uppercase, dash-separated words
  (`APP.SEARCH-PAGE.NO-CRITERIA-ERROR`). The top-level prefix is a project choice; if the sheet
  already uses one, reuse it; if starting fresh, pick a short app prefix (or omit it).
- **One namespace per page / feature / popup / overlay / table** (`SEARCH-PAGE`, `LOGIN-PAGE`,
  `USER-PAGE`, `EDIT-ACCESS-POPUP`, `…-TABLE`, …).
- A shared **`COMMON`** namespace for strings reused in ≥2 places (`CLOSE`, `CANCEL`, `SAVE`,
  `ERROR-TITLE`, `ERROR-RETRY-MESSAGE`, …). Promote to COMMON only when actually reused — don't
  pre-abstract.
- A **`TECHNICAL`** namespace for locale-adapted **format patterns**, not display copy (e.g.
  `DATE-FORMAT = dd/MM/yyyy`, `DATE-TIME-FORMAT = dd/MM/yyyy 'à' HH'h'mm`).
- Name by role, not by value: `CONFIRM-BUTTON`, `ERROR-TITLE`, `SUCCESS-TOAST`, `LABEL-EMAIL`,
  `PLACEHOLDER-CITY`, `<X>-SINGULAR` / `<X>-PLURAL`.

## Where & how to translate

**Templates (`.html`)**
- Text node → `{{ "APP.X.Y" | translate }}`.
- Element/component input → property binding: `[label]="'APP.X.Y' | translate"`,
  `[ariaLabel]="'APP.X.Y' | translate"`.
- Ternary → wrap each branch: `[message]="(cond ? 'APP.A' : 'APP.B') | translate"`.
- A `<br />` inside a sentence → split into two keys around the `<br />` (keep the tag in the template).
- Inline markup (`<strong>{{ data.x }}</strong>`) → translate the surrounding text fragments as keys
  and keep the markup/interpolation in the template; or use prefix keys like
  `('APP.X.PREFIX' | translate) + value` (the key's value can end with a trailing space, preserved).
- **Components that translate their own inputs** (a shared empty-state/breadcrumb component that pipes
  its inputs through `translate` internally) → pass the **key string**, not `| translate`.

**TypeScript**
- Inject `private readonly translateService = inject(TranslateService)`; use
  `this.translateService.instant('APP.X.Y', { param })` for: toast messages, dialog/menu item labels,
  computed/derived labels, tab/radio `value`+`text`, and any class field rendered as raw text.
- Add `TranslatePipe` to the standalone component `imports` when the template uses `| translate`.
- If a component registers a dynamic breadcrumb/label via a service, the route data key, the
  component's key constant, and the service call must all use the **same** translation key.

**Config objects rendered in templates** (field lists, table columns, group definitions)
- Store the **key** in the config and pipe in the template (`[label]="field.label | translate"`,
  `{{ col.label | translate }}`) → stays reactive to language changes.
- When the config value is consumed by a child component that needs resolved **text** (e.g. a
  toggle/select option), resolve it with `instant` at build time instead.

## Plurals & counts

Plain ngx-translate has no ICU. Use two keys chosen in code + interpolation:
- Keys: `…-SINGULAR = "{{count}} item"`, `…-PLURAL = "{{count}} items"`.
- Template: `{{ (n > 1 ? 'APP.X.ITEMS-PLURAL' : 'APP.X.ITEMS-SINGULAR') | translate: { count: n } }}`.
- TS: `translate.instant(n > 1 ? '…-PLURAL' : '…-SINGULAR', { count: n })`.
- Match the original boundary the legacy code used (e.g. `n > 1` means 0 and 1 use the singular form).

## Date / number formats

Externalize the pipe's format string as a `TECHNICAL` key and feed it in:
```html
{{ value | date: ("APP.TECHNICAL.DATE-TIME-FORMAT" | translate) }}
```
Single-quoted literals in a date pattern (`'à'`, `'h'`) are preserved through the xlsx → JSON compile,
so another locale can supply e.g. `MM/dd/yyyy 'at' hh:mm a`.

## Fidelity (don't corrupt the source text)

- Preserve exactly: accents, **curly `’` vs straight `'` apostrophes**, ellipsis `…`, and
  **non-breaking spaces** (common in product names and, in French, before `:` `?` `!`).
- An editor's Edit tool may normalize NBSP — for files containing NBSP, prefer a full-file write or a
  byte-precise tool (`perl`). The xlsx writer emits `<t xml:space="preserve">` and XML-escapes
  `& < >`, so leading/trailing spaces and NBSP survive round-trips.
- **Do not translate genuine data / mock placeholders** (sample names, demo values) or developer-only
  diagnostic logs/toasts. Flag them to the user instead of inventing keys.

## Tests

- Load the **real generated JSON** in the test harness — don't hand-mock translations. A common
  pattern is a static `TranslateLoader` that returns the imported `<lang>.json` (Angular test setups
  can `import data from '…/i18n/<lang>.json'` when `resolveJsonModule` is enabled) with the source
  language active.
- `instant` returns the **key** when a translation is missing, so assertions on translated text only
  pass when the JSON is regenerated first — regenerate before running tests.
- When you turn a previously-literal value into a key, update specs that asserted the literal: either
  assert the resolved value via the loaded `TranslateService`, or assert the key where the value is
  passed through unresolved.

## Worked example (neutral)

```
APP.COMMON.ERROR-RETRY-MESSAGE   = Try again in a moment or contact support if the problem persists.
APP.SEARCH-PAGE.RESULTS-SINGULAR = {{count}} result found
APP.SEARCH-PAGE.RESULTS-PLURAL   = {{count}} results found
APP.USER-PAGE.EDIT-ACCESS-BUTTON = Edit access
APP.CLIENT-PAGE.INHERITED-FROM   = Inherited from:␠   (trailing space, concatenated with data)
APP.TECHNICAL.DATE-TIME-FORMAT   = dd/MM/yyyy 'à' HH'h'mm
```
