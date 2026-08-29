# DRAFT — upstream issue for `truefoundry/trueforge`

**Status:** draft. Post during PR 10 polish at https://github.com/truefoundry/trueforge/issues
(satisfies PROJECT_SPEC §12.4 — "one well-documented TrueForge issue or small PR"). Do not post
until we've confirmed the repro is still present on the then-current TrueForge version and re-run
it once. Everything below the line is the issue body, ready to paste.

Before posting: re-verify on a clean Windows shell, update the version/Node numbers if they've
moved, and trim this banner.

---

## Title

Standalone mode crashes on startup on native Windows (win32): ESM loader rejects absolute `C:\` path passed to dynamic `import()`

## Summary

On native Windows, `npx @truefoundry/trueforge` (standalone mode) crashes during startup and never
binds its port. The server logs:

```
Failed to start server: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. On Windows, absolute paths must be valid file:// URLs. Received protocol 'c:'
```

The same command works cleanly under WSL2 / Linux and (per docs) macOS. This makes standalone mode
unusable on native Windows.

## Environment

| | |
|---|---|
| TrueForge | v0.1.4 (standalone mode, via `npx @truefoundry/trueforge`) |
| OS | Windows 11 (win32) 10.0.26200 |
| Node | v24.18.1 (also expected on 22.14+; requirement is 22.14+) |
| npm | 11.3.0 |
| Shell | PowerShell |

## Steps to reproduce

1. On native Windows (not WSL), with Node ≥ 22.14 installed.
2. In any directory, run: `npx @truefoundry/trueforge`
3. Accept the install prompt for `@truefoundry/trueforge@0.1.4`.
4. Watch the banner print, then the server fail to start.

## Actual behavior

Startup banner prints, then (trimmed):

```
warn Local sandbox fallback is unavailable {"reason":"LocalSandboxProvider supports macOS and Linux only (got win32)"}
Failed to start server: Only URLs with a scheme in: file, data, and node are supported by the default ESM loader. On Windows, absolute paths must be valid file:// URLs. Received protocol 'c:'
```

The process exits without ever logging `Agent server listening on http://localhost:8790`. The port
is never bound.

## Expected behavior

The server starts and listens on `http://localhost:8790`, the same as it does on Linux/macOS. For
reference, a successful boot (observed under WSL2/Linux, same version) ends with:

```
info Standalone mode: sqlite at <...>/trueforge/db/db.sqlite
info Serving frontend from <...>/@truefoundry/trueforge/dist/_frontend
info Agent server listening on http://localhost:8790 (docs at /api/v1/docs)
```

## Root cause (analysis, from the error — not from reading bundled source)

The message is Node's standard ESM-on-Windows failure: a **dynamic `import()` is being handed a raw
absolute filesystem path** instead of a `file://` URL. On POSIX an absolute path (`/home/…`) is
tolerated, but on Windows an absolute path starts with a drive letter, so `C:\…` is parsed as a URL
with scheme `c:` and rejected — hence `Received protocol 'c:'`. This typically sits at a module /
plugin / frontend-asset loader that computes an absolute path and does `await import(absPath)`.

## Suggested fix

Convert absolute paths to `file://` URLs with `url.pathToFileURL()` before dynamic import. It is
cross-platform safe (it also produces a valid `file://` URL on POSIX):

```js
import { pathToFileURL } from "node:url";

// before
const mod = await import(absolutePath);

// after
const mod = await import(pathToFileURL(absolutePath).href);
```

If there are several such call sites, a small helper (`importPath(p) => import(pathToFileURL(p).href)`)
applied consistently is the clean fix. Grepping the dist for `import(` on a computed path should
surface the site(s).

## Secondary note (not the crash, but related to Windows support)

`Local sandbox fallback is unavailable … (got win32)` shows the local sandbox provider is
macOS/Linux-only. That is reasonable when a remote sandbox (e.g. Daytona) is configured, but
combined with the hard ESM crash it means native-Windows users can't start standalone at all. Once
the ESM issue is fixed, a one-line note in the docs — "on Windows, use WSL2 or a remote sandbox
provider" — would save users the diagnosis.

## Workaround (for other Windows users landing here)

Run under **WSL2 (Ubuntu)**: install Node ≥ 22.14 in the distro, then `npx @truefoundry/trueforge`
from a WSL shell; reach it from the Windows browser at `http://localhost:8790`. To enable the local
sandbox inside WSL, `apt-get install -y bubblewrap socat ripgrep`. Confirmed working on Node 24.
