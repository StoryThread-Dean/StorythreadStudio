# The app icon

`app-icon.svg` is the source of truth for everything in `src-tauri/icons/`.
Regenerate with, from `app/`:

    npm run tauri icon src-tauri/icon-source/app-icon.svg
    rm -rf src-tauri/icons/android src-tauri/icons/ios

The second line is not optional housekeeping: the generator emits 35 Android
and iOS files this project has no use for. Storythread ships as a Windows
desktop app.

`tauri.conf.json` names only five of the outputs (`32x32.png`, `128x128.png`,
`128x128@2x.png`, `icon.icns`, `icon.ico`); the Square*Logo set is for a
Microsoft Store listing. Do not edit any of them by hand.

## What it is

A spool of thread: two flanges, a wound body, and the thread coming off it.
Filled rather than outlined, on `#070724`.

## Why filled, and why a spool

Four other drawings were tried against the real 32px and 128px renders before
this one, and the failures are the useful part:

- **A needle with a round eye.** Reads as a KEY. A circle on a diagonal stem
  is the universal key silhouette and there is no getting round it.
- **A needle with the thread floating near the eye.** Two unrelated objects.
- **A needle with the thread looped around the shaft**, matching the
  reference art. Reads as a LEAF with a pin through it: a loop aligned with
  the shaft makes an almond.
- **A needle with a slot eye and the thread sweeping off it.** The best of
  the four and still wrong. Verdict: "looks more like a backwards slanted P
  than needle with thread."

The common thread is that outline art does not survive being an app icon.
`components/icons/index.tsx` draws at 2px on a 24 grid to sit beside 11px
text, inheriting a known colour from what is around it. An app icon is a
standalone object at 16px on somebody's wallpaper, with no inherited colour
and no guaranteed contrast. Scaled there, a 2px stroke is about one and a
third pixels wide.

A spool works because its silhouette is blocky. Wide flange, narrow body,
wide flange survives at any size, and the thread grooves are knocked out in
the tile colour rather than added as more lines.

## The ground

`#070724`, the "Black Russian" from the palette discussion. It was proposed
as an accent and had nowhere to go, being far too dark to be one on a dark
interface. Behind a light mark it is exactly right, and this is the only
place in the app that colour appears.

The mark is `#90CAF9`, the app's accent.

## What it was before

The Tauri scaffold default, a yellow and cyan swirl, dated to the day the
project was created and never touched. There was no source file, which is
part of why it survived so long.

## Regenerating the files is not enough. THE APP WILL STILL SHOW THE OLD ICON.

This one costs an afternoon if you do not know it.

The icon is not read at runtime. It is compiled INTO the executable as a
Windows resource, by `tauri_build::build()` in `build.rs` at compile time. So
a new `icon.ico` on disk changes nothing until the Rust binary is rebuilt --
and cargo does not rebuild it, because cargo only re-runs a build script when
something it was told to watch changes. A `.ico` under `icons/` is not on that
list. Nothing errors; the build succeeds; the app opens wearing the old icon.

The full sequence, from `app/`:

    npm run tauri icon src-tauri/icon-source/app-icon.svg
    rm -rf src-tauri/icons/android src-tauri/icons/ios

    # Make the build script re-run. tauri-build DOES watch tauri.conf.json,
    # so touching it is enough and takes seconds.
    #   PowerShell:  (Get-Item src-tauri/tauri.conf.json).LastWriteTime = Get-Date
    #   Git Bash:    touch src-tauri/tauri.conf.json

    npm run tauri dev        # or: npm run tauri build

If it somehow still shows the old one, `cargo clean -p storythread-studio`
from `src-tauri/` and rebuild. That is the hammer and it is rarely needed.

### Checking it actually worked

Do not trust your eyes for this, because of the cache warning below. The
images inside an `.ico` are stored byte-identically inside the PE, so you can
just look for them:

    python -c "
    import pathlib,struct
    exe=pathlib.Path('src-tauri/target/debug/storythread-studio.exe').read_bytes()
    ico=pathlib.Path('src-tauri/icons/icon.ico').read_bytes()
    n=struct.unpack('<H',ico[4:6])[0]
    hits=sum(ico[struct.unpack('<I',ico[6+i*16+12:6+i*16+16])[0]:][:struct.unpack('<I',ico[6+i*16+8:6+i*16+12])[0]] in exe for i in range(n))
    print(f'{hits}/{n} icon images embedded')"

### And then Windows lies to you

WINDOWS CACHES SHELL ICONS HARD. A correctly rebuilt app can keep showing the
previous icon in the taskbar, in Explorer, and on a pinned shortcut until the
icon cache is cleared or the machine restarts. The window's own title-bar and
alt-tab icon update immediately, so check there first.

During testing, "it did not change" is not evidence.
