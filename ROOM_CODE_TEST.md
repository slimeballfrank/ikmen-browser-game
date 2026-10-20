# Room-code multiplayer test build

This branch adds an experimental browser WebRTC transport to the existing Ikemen GO browser port. It is not ready for public matches until the Worker is deployed and two separate browsers complete a real match.

## Deploy the room-code signaling service

1. Create or sign in to a Cloudflare account.
2. Install Node.js on a computer.
3. Open the worker directory in a terminal.
4. Run npm install, then npx wrangler login, then npm run deploy.
5. Copy the deployed workers.dev URL.
6. Replace the placeholder URL in patches/room-code.js with that URL, commit, and let the test build run again.

The Worker only exchanges WebRTC setup messages. Actual match bytes are intended to flow directly between the two browsers. This prototype uses a public STUN server and does not include a TURN relay, so some network combinations may fail.

## Test procedure

1. Upload the test ZIP from GitHub Actions to a separate draft itch.io project.
2. Open it in two independent browser sessions, such as regular Chrome and an Incognito window.
3. In both games, open the game's Netplay option. The host leaves the server/IP field blank; the second player enters the displayed four-character code.
4. Do not consider the room code alone proof of success. Verify peer-to-peer status and complete a match. Start with delay-based netplay; rollback has not been verified.


Build status: experimental patch; successful compilation and real two-browser gameplay are required before calling it ready.

Build script updated to apply source edits with explicit marker checks.
