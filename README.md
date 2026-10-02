# React + TypeScript + Vite

## Portable build (Windows 7 / any PC without Node)

The easiest option is the hosted copy, rebuilt automatically on every push to
`main`: https://anvinzac.github.io/MPFour/ — open it in Chrome or Edge 109+.
Folders are read locally in the browser; nothing is uploaded.

To build the file yourself, on a machine with Node 20+, run:

```bash
npm run build:portable
```

This writes a single self-contained `dist-portable/index.html`. Copy it to the
target PC and open it in **Chrome 109+** or **Edge 109+** (109 is the last
version for Windows 7). No server is needed; favorites are stored in the
browser instead of SQLite.

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
