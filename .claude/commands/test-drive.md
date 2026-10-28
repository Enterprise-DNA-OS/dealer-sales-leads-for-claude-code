---
description: Send a customer out on a test drive with the licence sighted, and book the car back in.
---

1. Ask the salesperson for the licence number and expiry off the card in front of them. Never take it from memory or from last time: the CLI refuses a drive without it.
2. Run `node scripts/leads.mjs drive L-xxxx --vehicle=<stock> --licence=<number> --expires=<date> --json`.
3. When the car is back: `back <stock or lead> --odometer=<km>`.
4. `npm run docs -- test-drive-record` renders the signed record for the file.
5. `drives --out` shows any car still out. One out for hours is the first item on `/attention`.
