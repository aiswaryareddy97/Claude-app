# Poker Tracker

An iOS app for tracking buy-ins and cash-outs during a home poker game with
friends. One person hosts a game and gets a short shareable code; everyone
else joins with that code and the whole table sees live buy-ins, rebuys, and
cash-outs update in real time. At the end of the night the app calculates the
minimum set of payments needed to settle up.

Built with SwiftUI (iOS 17+) and Firebase (Anonymous Auth + Firestore) for
real-time sync across everyone's phones. There's also a functional plain
HTML/JS web version under `docs/` — same backend, no Xcode or App Store
needed, installable straight from Safari (see "Web app" below).

> **The web app (`docs/`) is the actively developed version.** Several
> rounds of changes — chip values, host-only controls — have landed there
> without being ported back to the Swift project, which still reflects an
> earlier "anyone at the table can record buy-ins" design. Treat
> `PokerTracker/` as a reference/starting point rather than up to date.

> **Note:** this was generated in a Linux cloud environment without Xcode, so
> the Swift code has not been compiled. Open it in Xcode and fix anything the
> compiler flags — the structure and logic below should get you most of the
> way there. The `docs/` web app has the same caveat for JS syntax issues,
> though it's much easier to check yourself: open it in a browser and read
> the console.

## Features

- **Host New Game** → generates a unique 5-character game code (e.g. `PK4X9`)
- **Join Game** → enter the code to watch the game live, synced via Firestore
- **Host-only controls** — only the host records buy-ins, cash-outs, and
  corrections; everyone else who joins by code sees it all update live but
  can't edit anything (see "Host-only controls" below)
- **Add Player** (host only) — add someone who doesn't have or want the
  app; the host records their buy-ins and cash-out like anyone else's
- **Delete Player** (host only) — undo adding the wrong person, but only
  while they have zero buy-ins recorded — once real money is tracked for
  them, they can't just be removed
- **Multiple buy-ins per player** (rebuys) and **cash out**, both host-only
- **Edit** a player's name, or an already-recorded buy-in or cash-out
  (host only, instant — see "Host-only controls")
- **End Game & Settle Up** (host only) — locks the game and computes who
  owes who, minimizing the number of payments
- **Chip values (optional)** — different games use different chip
  denominations (a $10 buy-in might hand out chips worth "500"). When
  hosting, the host can optionally say what a buy-in's chip stack is worth
  (e.g. "500" chips for a $10 buy-in); everyone can then enter buy-ins and
  cash-outs as chip counts instead of doing the conversion math, with a
  live readout of the dollar equivalent. Leave it blank to just use
  dollars directly, same as before. The host's last-used buy-in and chip
  value are remembered on their device and pre-filled next time they host
  — editing them before creating updates what's remembered.
- **Invite sheet with QR code** — tap the game code in the top bar to get a
  QR code, a shareable link, and copy/share buttons. Scanning the code (or
  opening the link) launches the app straight into Join Game with the code
  already filled in — no typing a 5-character code by hand.
- **Saved regular players** — names the host has manually added before show
  up as quick-tap chips next time they add a player, so a recurring table
  doesn't mean retyping the same names every week.
- **Activity log** — a collapsible, real-time list of who did what (buy-ins,
  cash-outs, corrections, players added/removed, host transfers, settings
  changes) with a timestamp for each. It's the non-host viewers' only
  window into *why* something changed, since they can't cause changes
  themselves.
- **Edit Game Settings** (host only) — change the game's name, default
  buy-in, or chip value after creation, from the gear icon in the top bar.
  Only affects buy-ins entered from then on.
- **Transfer Host** (host only) — hand hosting off to another player
  already in the game, from Game Settings. Useful if the original host has
  to step away mid-game.
- **Delete Game** (host only) — permanently remove a game and everyone in
  it, from Game Settings. A manual substitute for automatic cleanup of
  abandoned games (which would need a paid Cloud Functions plan).
- **Undo End Game** — if "End Game & Settle Up" was tapped by mistake, the
  host can reopen the game from the ended screen; it goes back to active
  and the stale settlement snapshot is discarded.
- **Optional blinds timer** — the host can start a shared, live-updating
  round timer (minutes per round + starting small blind, blinds double
  each round) that every device displays in sync, computed locally from a
  single start timestamp rather than ticking over the network.
- **Share Results** — from the settlement screen, share (or copy) a
  plain-text summary of everyone's net result and who owes who.
- **History tab** — past games and your net result, saved on-device, plus
  lifetime totals (games played, overall net, win/loss record, best night)
  across everything saved locally.
- **Resume in-progress game** — if the app is killed mid-game, Home offers a
  "Rejoin" shortcut
- **Offline resilience** — the web app caches Firestore data locally, so a
  spotty connection at the poker table doesn't lose in-progress edits; they
  sync once the connection's back.

## Project layout

```
PokerTracker/
  project.yml              # XcodeGen spec — generates the .xcodeproj
  firestore.rules          # Firestore security rules
  PokerTracker/
    App/                   # App entry point, root auth gate, tab bar
    Models/                # Game, Player, HistoryEntry, SettlementTransaction
    Services/               # Firestore access, auth, code gen, settlement math, local history
    Views/
      Home/                # Name entry, Host/Join sheets
      GameRoom/             # Live game screen, buy-in/cash-out sheets, settlement
      History/              # Past games list + detail
    Extensions/
    Resources/
      GoogleService-Info.plist   # PLACEHOLDER — replace with your real one
```

The `.xcodeproj` itself is **not** checked in — it's generated from
`project.yml` with [XcodeGen](https://github.com/yonaskolb/XcodeGen) so the
repo stays diff-friendly. You'll generate it locally in step 4 below.

## Setup

### 1. Create a Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com) and
   create a new project (Google Analytics is optional, skip it).
2. Add an iOS app to the project. Use the bundle ID
   `com.example.pokertracker` (or pick your own — see step 5 if you change it).
3. Download the generated `GoogleService-Info.plist`.

### 2. Enable Anonymous Authentication

In the Firebase console: **Build → Authentication → Sign-in method →
Anonymous → Enable**.

Anonymous auth gives each phone a stable identity without asking friends to
create accounts — good enough for a home game. (A future version could swap
in Sign in with Apple if you want history to follow you across devices.)

### 3. Create a Firestore database

**Build → Firestore Database → Create database** (production mode is fine).
Then go to the **Rules** tab and paste in the contents of `firestore.rules`
from this repo, and publish. These rules ensure:
- only signed-in users can read/write
- only the person who created a game can end it
- you can join yourself, or the host can add anyone (including a player
  without their own device)
- only the host can record buy-ins, cash-outs, and corrections
- only the host can remove a player, and only before any money has been
  recorded for them — enforced server-side, not just in the UI

### 4. Install XcodeGen and generate the Xcode project

```bash
brew install xcodegen
cd PokerTracker   # this repo's root, where project.yml lives
xcodegen generate
open PokerTracker.xcodeproj
```

Xcode will resolve the Firebase Swift Package (`firebase-ios-sdk`)
automatically on first open — this can take a minute.

### 5. Add your real Firebase config

Replace the placeholder file at
`PokerTracker/Resources/GoogleService-Info.plist` with the real file you
downloaded in step 1. **The app will crash on launch until you do this.**

If you used a different bundle ID than `com.example.pokertracker`, update
`PRODUCT_BUNDLE_IDENTIFIER` in `project.yml` to match, then re-run
`xcodegen generate`.

### 6. Run it

Pick a simulator (or your device, with your Apple ID as the signing team in
Xcode's Signing & Capabilities tab) and hit Run. To test the multiplayer
flow, run the app on two simulators at once (or a simulator + your phone):
host a game on one, join with the code on the other, and watch buy-ins sync
live.

## Web app (`docs/`) — the same app, no Xcode required

`docs/` is a second, fully functional client for the exact same backend: a
plain HTML/CSS/vanilla-JS PWA (no build step, no framework) that talks to
the same Firestore schema and rules as the Swift app, using the Firebase
Web SDK. It's what's actually running if you added this site to your
iPhone's home screen via Safari — install it once and future pushes to
`docs/` update it automatically.

- `docs/index.html` — page shell + all CSS, plus a CDN `<script>` tag for
  the `qrcode-generator` library used by the Invite sheet's QR code
- `docs/app.js` — everything else: Firebase init/auth, game/player
  operations (`createGame`, `joinGame`, `addManualPlayer`, `deletePlayer`,
  `renamePlayer`, `addBuyIn`, `setCashOut`, `editPlayerEntry`, `endGame`,
  `reopenGame`, `updateGameSettings`, `transferHost`, `deleteGame`,
  `startTimer`/`resetTimer`, `logActivity`), the settlement algorithm, and
  localStorage-based history and saved-player-name lists
- `docs/firebase-config.js` — the only file you need to edit to connect it
  to your backend
- `docs/manifest.json` + icon PNGs — makes it installable

### Connecting it to Firebase

1. In the **same Firebase project** you made for the iOS app (or a fresh
   one, if you're only using the web version): **Project settings → General
   → Your apps → Add app → Web (`</>`)** → give it any nickname → Register.
   Firebase shows you a `firebaseConfig` object.
2. Paste those values into `docs/firebase-config.js`, replacing the
   `REPLACE_ME` placeholders.
3. Make sure Anonymous Auth and Firestore (with `firestore.rules` applied)
   are set up in that project — same steps 2–3 under **Setup** above.
4. Commit and push. If GitHub Pages is already on for this repo
   (**Settings → Pages → Deploy from a branch**, this branch, `/docs`),
   it redeploys within a minute or two of any push.
5. Reopen the app from your home screen icon (a full close-and-reopen, not
   just backgrounding it, if it was showing the old static preview) — it's
   now the real, live app instead of a mockup.

Because it's the same Firestore schema, an iOS build and the web app can
join the exact same game and see each other's buy-ins live, once both are
pointed at the same Firebase project.

## How the game code works

- The host taps **Host New Game**, and `GameService.createGame` picks a
  random 5-character code (avoiding ambiguous characters like `0`/`O`,
  `1`/`I`/`L`), checks Firestore to make sure it's not already in use, and
  creates a `games/{code}` document plus a `players/{code}/{uid}` entry for
  the host.
- Friends tap **Join Game**, type the code, and the app adds them as a
  player under that same game document.
- Everyone in the game listens to the same Firestore document and
  subcollection in real time, so buy-ins and cash-outs appear on all phones
  within a second or two.

## Host-only controls

Only the host can write anything — add a buy-in, cash someone out, correct
an existing entry, add or remove a player, or end the game. Everyone else
who joins with the code is view-only: they watch the same live board (name,
buy-in totals, net, settlement once it's done) but never see an action
button. This is enforced twice — the UI simply doesn't render those
controls for non-hosts, and the Firestore rules independently reject any
write that isn't from the host, so it holds even against a modified client.

Two things follow from that:

- **Corrections are instant.** There's no one else who could have written
  a value in the first place, so there's nothing to get a second opinion
  on — the host taps Edit, picks the entry, saves. (Earlier versions had a
  co-player approval flow for this; it's been removed since it no longer
  served a purpose once only one person can write at all.)
- **Adding a player without their own device** starts them with *zero*
  buy-ins — the host records their first buy-in as a separate step. That's
  what makes **Delete Player** meaningful in the UI: the button only shows
  up while a player has no buy-ins and hasn't cashed out, so it reads as an
  "undo a mistake" action rather than a way to erase someone's money
  mid-game. A player who *joins themselves* via the code always arrives
  with their first buy-in already recorded, so in practice they're
  essentially never delete-eligible — which is the point. This particular
  restriction is UI-level accident prevention, not a security boundary: the
  host can already edit or zero out any buy-in/cash-out, so the security
  rules only require that the request come from the host, the same as
  every other write. **Delete Game** relies on that — it needs to remove
  every player regardless of buy-ins as part of tearing down the whole
  game.

One known rough edge: if the host manually adds someone and that person
*also* later joins themselves with the code, they end up as two separate
rows (different underlying IDs) rather than merging into one. Not handled
today — if it comes up, delete the empty manual placeholder before the
real join happens.

## Settlement algorithm

At game end, each player's net is `cashOut - totalBuyIn`. `SettlementCalculator`
sorts players into creditors (net > 0) and debtors (net < 0) and greedily
matches the largest debtor against the largest creditor, repeating until
everyone is settled — this minimizes the number of payments needed.

## Ideas for a v2

- Venmo/PayPal deep links on the settlement screen, so a payment starts
  pre-filled straight from "who pays who"
- Push notifications when someone joins or cashes out
- Sign in with Apple so history follows you across devices/reinstalls
- Let players self-report buy-ins with a per-player PIN instead of open
  table-wide editing
- Automatic cleanup of abandoned games (needs a paid Cloud Functions plan;
  **Delete Game** is the manual stand-in for now)
