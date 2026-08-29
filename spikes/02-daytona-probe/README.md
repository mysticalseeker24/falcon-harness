# Spike 02 — one Daytona sandbox boots the app AND probes it

**Unknown (PROJECT_SPEC §10.2 / TOOLS.md §4):** can a single Daytona sandbox both boot a trivial
Express app and let a probe hit it on `localhost` inside the same sandbox? This is the shape of
the real run (boot `vulnbank`, generate + run the probe). No standalone code to run on your host —
Daytona is TrueForge's sandbox tool and the API key lives in the harness, so the agent drives it.

## Precondition

Daytona API key entered in TrueForge (Settings → sandbox/connectors — see the manual setup steps).

## Drive it from the TrueForge chat

Paste this to the agent (it has the sandbox tool):

> Provision a Daytona sandbox. Inside it:
> 1. Create `app.js` and `package.json` with exactly the contents I give below.
> 2. Run `npm install`, then start the app in the background (`node app.js &`) on port 3000.
> 3. Wait for it to listen, then **in the same sandbox** run `curl -s localhost:3000/data`
>    (or generate a tiny fetch script and run it).
> 4. Report the HTTP status and the full response body.
>
> `app.js`:
> ```js
> <paste spikes/02-daytona-probe/app.js>
> ```
> `package.json`:
> ```json
> <paste spikes/02-daytona-probe/package.json>
> ```

The point is that the agent **generates and runs the probe itself** inside the sandbox — that is
the sandboxed-execution criterion the judges must see (TOOLS.md §7 / SKILL.md).

## PASS criterion

The probe returns **HTTP 200** and a body containing `"secret": "tenant-a-balance-42000"`, all
within the same sandbox. That answers the unknown YES.

## If it fails — fallback

If one sandbox cannot both boot and probe (port binding, background process, or localhost
reachability issues), take the spec fallback: deploy the target to a **Render URL** and have the
sandbox probe that URL instead. Both count as sandboxed execution (PROJECT_SPEC §10.2). Record
"single sandbox" vs "Render URL" in the repo-root **Spike results** table.
