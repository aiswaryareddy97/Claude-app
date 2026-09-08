# End-to-end tests for the web app

Drives the real `docs/app.js` in a headless browser against an in-memory
stand-in for Firebase, so the whole flow — hosting, buy-ins, rebuys,
cash-outs, Player IDs, settlement — runs as actual user interaction
rather than unit-tested pieces.

```bash
node test/run-tests.js
```

Needs Playwright and a Chromium build. In this environment:
`/opt/node22/lib/node_modules/playwright` and `/opt/pw-browsers/chromium`
(both paths are at the top of `run-tests.js` if yours differ).

## How it works

`page.route` intercepts the Firebase CDN imports and serves `fake-auth.js`
and `fake-firestore.js` instead. The fake keeps its data in the Node
process, so several pages can act as **separate devices sharing one
backend** — which is the only way to meaningfully test that a player
added on the host's phone shows up on their own.

The fake applies `arrayUnion` and `deleteField` for real and hands back
live `Timestamp` objects, so money math and ordering bugs surface here
instead of in production.

## What it does not cover

Firestore security rules. The fake enforces no permissions, so a rules
mistake (the "Missing or insufficient permissions" class of bug) will
still pass here — those need the Firebase emulator or a real project.
