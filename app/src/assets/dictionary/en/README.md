# Vendored English dictionary (Hunspell)

`en.aff` and `en.dic` are the Hunspell affix + dictionary files used by the
editor's right-click spell-check corrections (see `src/utils/spellcheck.ts`).

## Why are these committed instead of imported from npm?

They come from the [`dictionary-en`](https://www.npmjs.com/package/dictionary-en)
package, but that package can't be imported directly here:

- Its loader (`index.js`) reads the files with Node's `fs` module, which does
  not exist in the Tauri WebView at runtime.
- Its `package.json` `exports` field only exposes `index.js`, so Vite refuses
  to resolve subpath imports like `dictionary-en/index.aff?raw`.

Vendoring the raw files and importing them with Vite's `?raw` sidesteps both
problems and guarantees the data is bundled into the production build.

## How to refresh

```powershell
# from app/
npm install dictionary-en@latest
Copy-Item node_modules/dictionary-en/index.aff src/assets/dictionary/en/en.aff
Copy-Item node_modules/dictionary-en/index.dic src/assets/dictionary/en/en.dic
Copy-Item node_modules/dictionary-en/license   src/assets/dictionary/en/LICENSE
```

## License

The dictionary data is licensed separately from this project. See `LICENSE`
in this folder (originally `dictionary-en`'s license: MIT AND BSD).
