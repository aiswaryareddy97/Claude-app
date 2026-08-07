# Poker Tracker

An iOS app for tracking buy-ins and cash-outs during a home poker game with
friends. One person hosts a game and gets a short shareable code; everyone
else joins with that code and the whole table sees live buy-ins, rebuys, and
cash-outs update in real time. At the end of the night the app calculates the
minimum set of payments needed to settle up.

Built with SwiftUI (iOS 17+) and Firebase (Anonymous Auth + Firestore) for
real-time sync across everyone's phones.

> **Note:** this was generated in a Linux cloud environment without Xcode, so
> the code has not been compiled. Open it in Xcode and fix anything the
> compiler flags — the structure and logic below should get you most of the
> way there.

## Features

- **Host New Game** → generates a unique 5-character game code (e.g. `PK4X9`)
- **Join Game** → enter the code to join instantly, live-synced via Firestore
- **Multiple buy-ins per player** (rebuys) — swipe a player row to add one
- **Cash out** — swipe a player row, enter their final chip count
- **Edit requests** — correcting an already-recorded buy-in or cash-out
  (as opposed to entering a brand-new one) needs another player at the
  table to accept it first; swipe a player row the other direction to
  request a correction
- **End Game & Settle Up** (host only) — locks the game and computes who
  owes who, minimizing the number of payments
- **History tab** — past games and your net result, saved on-device
- **Resume in-progress game** — if the app is killed mid-game, Home offers a
  "Rejoin" shortcut

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
- you can only create your own player entry (but any participant can record
  buy-ins/cash-outs at the table, since one person is usually running the
  chip counts)

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

## How edit requests work

Adding a fresh buy-in or a player's first cash-out is instant, same as
before. Correcting a value that's already been recorded is different: it
creates a pending `editRequests` document instead of touching the player's
data directly. Every other phone in the game sees it in a **Pending
Requests** section; anyone except whoever filed the request can tap Accept
(which applies the change) or Reject (which just dismisses it). This keeps
one person from unilaterally rewriting the numbers after the fact, while
still letting any two people at the table resolve a mistake without
needing the host specifically.

## Settlement algorithm

At game end, each player's net is `cashOut - totalBuyIn`. `SettlementCalculator`
sorts players into creditors (net > 0) and debtors (net < 0) and greedily
matches the largest debtor against the largest creditor, repeating until
everyone is settled — this minimizes the number of payments needed.

## Ideas for a v2

- QR code join (scan instead of typing the code)
- Push notifications when someone joins or cashes out
- Sign in with Apple so history follows you across devices/reinstalls
- Let players self-report buy-ins with a per-player PIN instead of open
  table-wide editing
