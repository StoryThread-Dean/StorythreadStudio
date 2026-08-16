# Releasing Storythread Studio

This is the runbook for cutting a new release. Most steps are automated by
`scripts\release.ps1`; the manual ones are flagged inline.

---

## One-time setup

These steps happen once, before your very first public release. Skip this
section after you've shipped v1.0.0.

### 1. Generate the updater signing keypair

The Tauri auto-updater verifies every downloaded bundle against a public
key embedded in the app. The matching private key signs each release.

> **Critical:** The public key bakes into the v1.0.0 binary. You can't
> change it later without making existing users manually reinstall.
> Generate it ONCE, store the private key safely, and use the same one
> for every release going forward.

From the `app/` folder:

```powershell
npm run tauri signer generate -- -w "$HOME\.tauri\storythread-studio.key"
```

This creates two files:
- `$HOME\.tauri\storythread-studio.key`     -- the private key (KEEP SAFE)
- `$HOME\.tauri\storythread-studio.key.pub` -- the public key

### 2. Embed the public key in the app

Open `app\src-tauri\tauri.conf.json` and replace the placeholder
`REPLACE_ME_WITH_YOUR_PUBLIC_KEY_FROM_TAURI_SIGNER_GENERATE` with the
contents of the `.pub` file (a single base64 string, no newlines).

Commit this change. The public key is meant to be public; only the
private key needs to stay secret.

### 3. Stash the private key safely

Open the private key file and copy its contents. Paste it into your
password manager (1Password, Bitwarden, etc.) under a "Storythread Studio
updater key" entry. If you set a password during keygen, store it next
to the key.

> **Before deleting the local file:** verify you can read the key from
> your password manager. You'll lose the ability to ship updates if you
> delete the file before saving it elsewhere AND lose your password
> manager copy.

### 4. Set up donation accounts

- **GitHub Sponsors**: apply at https://github.com/sponsors. Approval
  takes a few days to a couple of weeks. The Sponsor button appears on
  the repo automatically once `.github/FUNDING.yml` references your
  approved username and the program goes live for you.
- **Ko-fi**: sign up at https://ko-fi.com. Pick the username that
  matches the slug in `.github/FUNDING.yml` (`storythreadstudio` by
  default; update both files if you choose a different one).
- **Update both files** if your final usernames differ from the placeholders:
  - `.github/FUNDING.yml`
  - The hardcoded URLs in `app/src/components/about/AboutPanel.tsx`,
    `app/src/components/about/DonationPrompt.tsx`,
    `app/src/components/update/UpdateModal.tsx`,
    `app/src/components/update/PostUpdateBanner.tsx`,
    and `README.md`. Search for `StoryThread-Dean` and `storythreadstudio`.

### 5. Push v1.0.0 to GitHub

Once the keypair is set up and the public key is embedded, follow the
"Per release" workflow below for v1.0.0.

---

## Per release

Every subsequent release follows the same steps.

### 0. Update the documentation -- BEFORE anything else

**This is step zero because it kept being step never.** Every release so far has
needed the writer to ask "did you update the docs?", and by v2.0.1 the README
did not mention the Weave at all -- the headline feature of the previous major
version, missing from the page every new visitor lands on. `architecture.md`
described a per-book model-roles level that had been deleted. `features.md`
claimed the Weave brief reached one surface when it reached two.

Documentation drift raises no error, fails no test, and is invisible until
somebody reads it and is misled. So it is a gate, not a courtesy.

Walk this list. For each one, either update it or be able to say why it needed
nothing:

| File | Ask |
|---|---|
| `README.md` | Would a stranger learn this feature exists? Are the requirements still true (providers, keys, disk space)? |
| `docs/features.md` | Is the new behaviour described, and is anything it CHANGED still described the old way? |
| `docs/architecture.md` | New routes, new folders, new files on disk, changed resolution order? |
| `docs/product-scope.md` | Does this change what the product IS, or any locked rule? |
| `docs/roadmap.md` | Move what shipped out of Scheduled; record what was decided against and why. |
| The feature's own spec | If it has one, the behaviour change goes in the SAME commit as the spec change. |
| `CHANGELOG.md` | Step 1 below. |

The rule behind the rule: **where a doc and the code disagree, the code is right
and the doc is a bug.** Never fix a doc by describing the drift -- that erases
the evidence and leaves build, tests and docs mutually consistent and all three
wrong.

### 1. Update CHANGELOG.md

Move entries from `## [Unreleased]` into a new `## [X.Y.Z] - YYYY-MM-DD`
section just below it. Leave the `## [Unreleased]` heading in place with
empty subsections for the next round of work.

### 1b. Write `release-artifacts/vX.Y.Z-notes.md`

The CHANGELOG is for the repo. This file is for the **writer**, and it is what
they read in the update banner and on the GitHub Release page. `release.ps1`
picks it up automatically for `latest.json`.

**Keep it short and keep it human.** The v2.0.0 notes ran to nine thousand
characters and the update banner showed all of it. Nobody reads that.

- **Aim for a page.** If it is longer than the reader's patience, the important
  part is the part they did not reach.
- **Plain language, around a fifth-grade reading level.** "Your hero is small in
  chapter one and stronger later" beats "trait validity windows scoped by
  anchor". The writer is a novelist, not an engineer.
- **Personable, casual but professional.** Write like a person telling somebody
  what changed, not like a compliance document.
- **Lead with what they GET**, then how to reach it. Skip the reasoning, the
  internals, the file names and the task ids -- those live in the commit
  message and the spec, where somebody looking for them will find them.
- **One short paragraph per thing**, with a heading they can skim.
- Fixes can be one line each. "It never worked. Now it does." is a complete
  and honest entry.
- `--`, never an em dash, same as everywhere else in this project.

### 2. Export your signing key

In a new PowerShell session (so the key isn't ambient longer than
necessary):

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "<paste the contents of your .key file here>"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<your password if you set one>"
```

> Don't paste these into a script file you commit. They live in the
> shell session only.

### 3. Run the release script

From the repo root:

```powershell
.\scripts\release.ps1 -Version X.Y.Z
```

This:
- Bumps the version in `package.json`, `tauri.conf.json`, `Cargo.toml`
- Builds the backend exe via PyInstaller
- Builds the Tauri bundle (signed with your private key)
- Generates `release-artifacts/latest.json` with the signature, version,
  notes (extracted from your CHANGELOG's Unreleased section), and the
  GitHub Releases URL where the installer will live
- Copies the installer + .sig next to the manifest

### 4. Commit and push

```powershell
git add CHANGELOG.md app/package.json app/src-tauri/tauri.conf.json app/src-tauri/Cargo.toml
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

### 5. Create the GitHub Release

**Write `release-artifacts/vX.Y.Z-notes.md` first** -- one file per release,
holding only that release's notes. This step used to say `--notes-file
CHANGELOG.md`, which would publish the ENTIRE history as one release's notes:
every version back to v1.0.0, on the page a first-time visitor lands on. The
per-version file is also what `latest.json` is checked against, so the in-app
update banner and the GitHub page say the same thing.

Then either via the website (paste the notes, drag the three files from
`release-artifacts/` onto the upload zone) or via the `gh` CLI:

```powershell
gh release create vX.Y.Z `
  --title "Storythread Studio vX.Y.Z" `
  --notes-file release-artifacts/vX.Y.Z-notes.md `
  "release-artifacts/Storythread Studio_X.Y.Z_x64_en-US.msi" `
  "release-artifacts/Storythread Studio_X.Y.Z_x64_en-US.msi.sig" `
  release-artifacts/latest.json
```

**Name the files exactly. Do not use a wildcard.** This step used to say
`release-artifacts/Storythread*.msi`, and that folder accumulates every
installer you have ever built -- ten of them by v2.0.1. The wildcard would have
attached three hundred megabytes of superseded versions to the new release.
`release.ps1` now moves old installers into `release-artifacts/archive/` on
every run, so the folder cannot punish a wildcard, but the exact name is still
the right thing to type. The script prints it at the end.

> **Check for a stray tag before you start.** If `git tag -l vX.Y.Z` finds one
> from an aborted attempt, `gh release create` will attach the release to that
> old commit rather than the one you just built. Delete it locally and on the
> remote first.

### 6. Verify the update flow

After the release goes live, open an installed copy of the previous
version on a Windows machine. Within ~30 seconds of launch, the update
banner should appear. Click "View details" to confirm the notes look
right, then "Download & Install" to verify the signature check passes
and the new version installs cleanly.

If it works on a copy you control, real users will get the same flow
the next time they launch.

---

## Troubleshooting

### "Update failed: signature verification failed"

The public key in the running app doesn't match the private key that
signed the new bundle. This means either:
- You generated a new keypair and forgot to update `tauri.conf.json`
- Your environment has the wrong private key exported

Fix: regenerate the public key from your private key
(`npm run tauri signer sign` will print it), update `tauri.conf.json`,
re-release.

### "PyInstaller fails with hidden import error"

The frozen exe is missing a transitive dependency. Open
`backend/backend.spec` and add the missing module to the `hiddenimports`
list, then rerun.

### "SmartScreen warning is back stronger"

Microsoft's SmartScreen ranks executables by reputation. New releases
start near zero and gain trust as more users install them. Each release
resets some reputation. Workarounds:
- Get a code-signing certificate ($100-300/year from Sectigo, DigiCert,
  SSL.com)
- Submit your installer to Microsoft for analysis at
  https://www.microsoft.com/en-us/wdsi/filesubmission once per release

The README warns users about this on the install page.

### "The auto-update banner never appears"

Run through the checks in order:
1. Is the running version actually older than `latest.json` reports?
   (`https://github.com/StoryThread-Dean/StorythreadStudio/releases/latest/download/latest.json`)
2. Is the running version a release build (`tauri build`), not a dev
   build? The hook short-circuits in dev to avoid signature errors.
3. Did the GitHub Release tag match the version in `latest.json`?
4. Is the public key in `tauri.conf.json` the matching pair to the
   key that signed the release?
