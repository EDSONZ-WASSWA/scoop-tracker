# Scoop Tracker

Scoop Tracker is a live stock, sales and refill system for an ice cream stand. It was built
for a university NoSQL course unit to show how MongoDB handles a small but real business problem.

Two people use it:

- **The seller** builds servings for customers, sells them and asks for refills when a flavor runs low.
- **The stock manager** handles refill requests, fills up tubs, manages flavors and sets the price.

The app updates itself every 3 seconds, so two browser windows (seller and manager) stay in sync
during a live demo.

## The main rule: one serving = exactly 4 scoops = UGX 1,000

- One sale is one serving (a cone, cup or tub) of **exactly 4 scoops**.
- One serving costs **UGX 1,000**, so one scoop is worth **UGX 250** (1,000 ÷ 4).
- Flavors can be mixed, for example 2 Vanilla + 1 Mango + 1 Chocolate, or 4 Vanilla.
- A serving with 3 or 5 scoops is never accepted. The browser blocks it, and the server checks
  again because it never trusts the browser.

None of these numbers is hard-coded. They are stored in the `settings` collection:

```json
{ "scoopsPerSale": 4, "pricePerSale": 1000, "currency": "UGX" }
```

The stock manager can change the scoops per serving, the price and the currency under
**Stock Manager → Sale settings**. A change only affects new sales. Old sales keep the amount
they were sold for, because each sale stores its own `amount`.

## Tech stack

| Part      | Choice                                                        |
|-----------|---------------------------------------------------------------|
| Database  | MongoDB with the official `mongodb` Node driver (no Mongoose) |
| Backend   | Node.js, Express 5, TypeScript                                |
| Frontend  | Plain HTML, CSS and TypeScript compiled with `tsc`            |
| Libraries | express, mongodb, cors, dotenv                                |

There is no frontend framework and no bundler. The browser loads the compiled files as native
ES modules. The app has only four screens, so a framework would add weight without solving a
problem. Mongoose is not used, so every database query in the code is the raw MongoDB query.

## How to run it on Windows

You need Node.js (version 20 or newer) and MongoDB Community Server, with the MongoDB service running.

```powershell
cd scoop-tracker
npm install
copy .env.example .env
npm run seed
npm run dev
```

Then open <http://localhost:3000>.

| Script           | What it does                                                    |
|------------------|-----------------------------------------------------------------|
| `npm run dev`    | Compiles the client, then runs the server with `tsx watch`      |
| `npm run build`  | Compiles the client to `public/js` and the server to `dist`     |
| `npm start`      | Runs the compiled server (run `npm run build` first)            |
| `npm run seed`   | Clears the database and loads the demo data                     |
| `npm run typecheck` | Checks both TypeScript projects without writing files        |

### Troubleshooting

- **"Could not connect to MongoDB"**: the MongoDB service is not running. Open *Services*
  (`services.msc`), find **MongoDB Server** and click *Start*, or run `net start MongoDB` in an
  administrator terminal. Also check that `MONGODB_URI` in `.env` is `mongodb://127.0.0.1:27017`.
- **"Port 3000 is already in use"**: another program is using the port. Close it, or set
  `PORT=3001` in `.env` and open <http://localhost:3001>.
- **TypeScript compile errors**: run `npm install` again so `typescript` and the `@types`
  packages are present, then run `npm run typecheck` to see the exact file and line.
- **The page loads but stays empty**: run `npm run seed` to load the flavors.
- **Old screens after a code change**: press Ctrl + F5 to reload without the browser cache.

## Why MongoDB and not a relational database

1. **A sale is naturally one document.** A serving with three flavors is stored as one sale
   document with the flavors embedded in an `items` array. A relational database would need a
   `sales` table and a `sale_items` table joined together for every read.
2. **Flavors do not all have the same fields.** Some are seasonal and have an end date, some are
   plant based, some contain nuts or have notes. MongoDB's flexible schema stores only the fields a
   flavor really has. A table would need many mostly empty columns.
3. **Atomic updates on one document are built in.** `$inc` with a condition in the filter changes
   stock safely in one step, which is exactly what a busy counter needs.
4. **The aggregation pipeline covers the reports.** Totals per hour, per day, per seller, per flavor
   and popular combinations are all done inside the database.
5. **It fits JavaScript.** Documents look like the JSON the browser already uses, so data moves
   from database to screen with very little conversion.

## The database

Database name: `scoop_tracker`. There are six collections.

### `settings` (one document)

```json
{ "scoopsPerSale": 4, "pricePerSale": 1000, "currency": "UGX" }
```

The server reads this on every sale, so the price can change without touching the code.

### `flavors`

```json
{
  "_id": ObjectId("..."),
  "name": "Strawberry",
  "colorHex": "#E8798F",
  "category": "fruity",
  "allergens": ["milk"],
  "dietary": [],
  "stockScoops": 44,
  "capacityScoops": 60,
  "lowThreshold": 10,
  "isActive": true,
  "seasonal": true,
  "availableUntil": ISODate("..."),
  "notes": "Made with fresh local strawberries",
  "createdAt": ISODate("..."),
  "updatedAt": ISODate("...")
}
```

- **Flexible schema:** `seasonal`, `availableUntil`, `plantBase`, `containsNuts`, `notes` and
  `origin` exist on some flavors only. The Stock Manager table has an "Extra fields" column that
  shows which optional fields each document has. When the form leaves an optional field empty, it
  is removed with `$unset` instead of being saved as an empty value.
- **There is no price per flavor.** Every scoop costs the same.
- **The status colour is not stored.** It is calculated from the stock every time a flavor is
  read, in one function (`src/server/status.ts`), so it can never be out of date:

| Status   | Rule                               | Colour |
|----------|------------------------------------|--------|
| Sold out | `stockScoops = 0`                  | Grey   |
| Low      | `stockScoops <= lowThreshold`      | Red    |
| Getting low | `stockScoops <= lowThreshold × 2` | Orange |
| Good     | anything above that                | Green  |

### `sales` (one document per serving)

```json
{
  "_id": ObjectId("..."),
  "receiptNo": "R-0061",
  "items": [
    { "flavorId": ObjectId("..."), "flavorName": "Vanilla", "scoops": 2 },
    { "flavorId": ObjectId("..."), "flavorName": "Mango",   "scoops": 1 },
    { "flavorId": ObjectId("..."), "flavorName": "Chocolate", "scoops": 1 }
  ],
  "totalScoops": 4,
  "amount": 1000,
  "soldBy": "Shillah",
  "soldAt": ISODate("...")
}
```

- **Embedding:** the mixed flavors live inside the sale as an array. One read returns the whole
  receipt with no join. A serving never has more than a few items, so the array stays small, which
  is the situation where embedding is the right choice.
- **Denormalized `flavorName`:** the name is copied into each item. If a flavor is renamed or
  deactivated later, old receipts still show what was really sold, and reports do not need a lookup
  just to print a name.
- **`amount` is stored per sale:** if the price changes later, past sales keep their real value.

### `restock_requests`

```json
{
  "flavorId": ObjectId("..."), "flavorName": "Mango",
  "requestedBy": "Shillah", "requestedAt": ISODate("..."),
  "stockAtRequest": 8, "quantityRequested": 52,
  "note": "", "priority": "normal",
  "status": "pending", "handledBy": "Stock manager", "handledAt": ISODate("...")
}
```

`priority` is `"urgent"` when the stock is 0. `status` moves from `pending` to `fulfilled` or `rejected`.

### `stock_logs` (audit trail)

Every change to stock writes a log with `type` = `sale`, `restock`, `adjustment`, `reset` or
`rollback`, plus the `change`, the `balanceAfter`, who did it and when. This answers questions such
as "where did the Mango go?" without changing the flavor documents.

### `counters`

```json
{ "_id": "receipt", "seq": 61 }
```

Receipt numbers come from `findOneAndUpdate({ _id: "receipt" }, { $inc: { seq: 1 } })`. The
increment happens inside the database in one step, so two sales at the same moment never get
the same receipt number.

## Indexes

The server creates these indexes every time it starts (`src/server/db.ts`):

| Collection         | Index                                   | Why                                                       |
|--------------------|-----------------------------------------|-----------------------------------------------------------|
| `flavors`          | `{ name: 1 }` unique                    | No two flavors with the same name                         |
| `flavors`          | `{ stockScoops: 1 }`                    | Fast stock range queries                                  |
| `restock_requests` | `{ status: 1, requestedAt: -1 }`        | The inbox filters by status and sorts by date             |
| `restock_requests` | `{ flavorId: 1 }` unique, partial on `status: "pending"` | Only one pending request per flavor, enforced by the database |
| `sales`            | `{ soldAt: 1 }`                         | Today's totals and date reports                           |
| `sales`            | `{ "items.flavorId": 1 }` (multikey)    | Find sales that contain a flavor                          |
| `stock_logs`       | `{ flavorId: 1, at: -1 }`               | Audit trail of one flavor, newest first                   |

`items.flavorId` is a **multikey index**: because `items` is an array, MongoDB adds one index entry
for every flavor in every sale.

The **DB Demo** screen runs the same query twice with `explain("executionStats")`: once with the
index and once forced to scan the whole collection with `hint({ $natural: 1 })`. With the index
MongoDB examines only the matching documents (IXSCAN). Without it, it reads every sale (COLLSCAN).

## Selling without overselling: atomic `$inc` with rollback

When the seller presses **Sell serving**, the server (`src/server/services/salesService.ts`):

1. Checks the request: `items` is a non-empty list, every `scoops` is a positive whole number,
   the total after merging duplicates is exactly `scoopsPerSale` ("A serving must be exactly 4
   scoops, you sent 3"), and every flavor exists and is active.
2. Deducts each flavor with one conditional update:

   ```js
   db.flavors.updateOne(
     { _id: flavorId, stockScoops: { $gte: n } },
     { $inc: { stockScoops: -n }, $set: { updatedAt: now } }
   )
   ```

   The filter only matches while at least `n` scoops are left, and `$inc` changes the number inside
   the database in one step. If two sellers try to take the last scoop at the same moment, the first
   update matches and the second one matches nothing (`matchedCount: 0`). Stock can never go below zero.

3. If any flavor fails, the flavors already deducted are put back with the opposite `$inc`, a
   `rollback` stock log is written, and the seller gets a clear message such as "Only 1 scoop of
   Mango left".
4. Only when every flavor succeeded does it take a receipt number, insert **one** sale document and
   write one `sale` stock log per flavor.

A multi-document transaction would also make this all-or-nothing, but transactions need a replica
set. A default local MongoDB install is a single standalone server, so the app uses this
compensation (rollback) approach, which works on any MongoDB.

Other atomic operations in the app:

- **Fill up** uses an update pipeline, `[{ $set: { stockScoops: "$capacityScoops" } }]`, so the
  copy from capacity to stock happens in one write.
- **Fulfil request** first changes the request with `{ _id, status: "pending" }` in the filter, so
  two managers clicking at once cannot both fill the same request.

## Aggregation pipelines (Reports screen)

Every number on the Reports screen comes from an aggregation pipeline (`src/server/services/reportService.ts`).
Click **Show the query** under any report to see the exact pipeline that was run.

| Report                         | Main stages                                                                 |
|--------------------------------|-----------------------------------------------------------------------------|
| Money today and all time       | `$facet` with `$match` on `soldAt`, `$group` with `$sum`                   |
| Money per hour of the day      | `$group` by `$hour` (with the local time zone), `$sort`                     |
| Money per day, last 7 days     | `$match`, `$group` by `$dateToString` `"%Y-%m-%d"`, `$sort`                 |
| Scoops and money per flavor    | `$unwind: "$items"`, `$group` by flavor, `$lookup` for the colour, `$project` with `$multiply` by the scoop value |
| Top 5 flavors                  | First five rows of the per-flavor result                                    |
| Money per seller               | `$group` by `soldBy`, `$sort`                                               |
| Popular flavor combinations    | `$project` with `$sortArray` on `items.flavorName`, `$group`, `$sort`, `$limit` |
| Refill times and counts        | `$facet`: `$avg` of `handledAt - requestedAt`, and `$group` per flavor with `$cond` |

`$unwind` is the important one for embedding: it turns one serving with three flavors into three
rows, so scoops can be counted per flavor even though they were stored together.

The **Daily closing** box checks that `scoops ÷ 4 = servings` and `servings × UGX 1,000 = money`,
so the cash in the till can be reconciled at the end of the day.

The sell screen also has a **Show the query** panel. After a sale it shows the real `updateOne`
deductions, the counter `findOneAndUpdate` and the `insertOne` for the sale.

The flavor list itself is an aggregation too: `$match` for the filters, then `$lookup` into
`restock_requests` to mark flavors that already have a pending refill.

## REST API

| Method | Path | Purpose |
|--------|------|---------|
| GET / PUT | `/api/settings` | Read or change scoops per serving, price and currency |
| GET | `/api/flavors?q=&excludeAllergen=&dietary=&lowOnly=` | Flavors with computed `status` |
| POST | `/api/flavors` | Add a flavor |
| PUT | `/api/flavors/:id` | Edit a flavor |
| PATCH | `/api/flavors/:id/deactivate` | Take a flavor off sale |
| POST | `/api/flavors/:id/fill` | Fill a tub to capacity |
| POST | `/api/flavors/:id/adjust` | Set stock after counting |
| POST | `/api/sales` | Sell a serving `{ items: [{ flavorId, scoops }], soldBy }` |
| GET | `/api/sales/today` | Today's servings, scoops, money and the latest 10 sales |
| POST | `/api/requests` | Request a refill |
| GET | `/api/requests?status=pending` | Requests by status (comma separated) |
| PATCH | `/api/requests/:id/fulfil` | Fill up and close a request |
| PATCH | `/api/requests/:id/reject` | Reject a request |
| GET | `/api/reports/summary`, `/money-by-hour`, `/money-by-day`, `/by-flavor`, `/by-seller`, `/combos`, `/refill-times` | Reports, each with the query used |
| GET | `/api/demo/explain?query=recent\|flavor` | Index comparison with `explain` |
| POST | `/api/demo/rush` | Sell a random serving every second for 15 seconds |
| POST | `/api/demo/invalid-sale` | Send a 3-scoop and a 5-scoop sale to the API |
| POST | `/api/demo/reset` | Restore the starting stock and clear sales, requests, logs and counters |

Errors always come back as `{ "error": "message" }` with a fitting status code: 400 for invalid
input or an invalid id, 404 when something does not exist, 409 for conflicts such as not enough stock.

## Seed data

`npm run seed` clears the database and loads:

- the settings (4 scoops, UGX 1,000, currency UGX)
- 12 flavors: Vanilla, Chocolate, Strawberry, Mango, Passion Fruit, Jackfruit, Coconut (vegan),
  Pistachio (contains nuts), Cookies and Cream, Mint Choc Chip, Salted Caramel and Banana.
  Chocolate and Passion Fruit start orange, Mango and Pistachio red, and Jackfruit sold out, so
  every colour shows at once.
- 60 past sales over the last 7 days, all exactly 4 scoops for UGX 1,000
- two pending refill requests and a few handled ones, so the reports have data

## Project structure

```
scoop-tracker/
  src/
    shared/types.ts          types used by both server and browser
    server/
      index.ts               Express app and startup
      db.ts                  connection and indexes
      errors.ts              HttpError and the error middleware
      status.ts              calculateStatus
      validate.ts            small input checks
      flavorValidation.ts    flavor form checks
      models.ts              database document types
      seed.ts, seedData.ts   demo data
      routes/                one file per API area
      services/              sales (atomic deduction and rollback), stock, flavors,
                             requests, reports, settings, demo
    client/
      main.ts                navigation, polling and startup
      api.ts                 typed fetch helpers
      ui.ts                  toast, dialog, escapeHtml, formatting
      sell.ts, sellCards.ts, serving.ts   sell screen and serving builder
      manager.ts, flavorForm.ts           stock manager screen
      reports.ts, charts.ts               reports and CSS bar charts
      demo.ts                DB demo screen
  public/
    index.html, style.css    page and styles (compiled JS goes to public/js)
```

## Presentation script

### Talking points

1. **The problem:** an ice cream stand needs live stock, sales and refills. One serving is exactly
   4 scoops for UGX 1,000, and flavors can be mixed.
2. **Why MongoDB:** a mixed serving is one document with the flavors embedded, flavors have
   different optional fields, and stock changes need safe atomic updates.
3. **Embedding and denormalization:** a sale carries its items and the flavor names, so one read
   gives the full receipt and old receipts stay correct after a rename.
4. **No overselling:** a conditional `updateOne` with `$inc` cannot take more scoops than exist.
   If one flavor fails, the others are rolled back.
5. **Never trust the browser:** the Sell button is locked below 4 scoops, and the server checks the
   total again and rejects anything else with a 400.
6. **Settings in the database:** price, serving size and currency come from `settings`, so the shop
   can change them without new code.
7. **Indexes:** a unique name, a compound inbox index, a multikey index on embedded items and a
   partial unique index that stops duplicate pending refills. `explain` proves they are used.
8. **Aggregation:** `$unwind`, `$group`, `$dateToString`, `$hour`, `$lookup` and `$sortArray`
   produce every report inside the database.

### 5-minute demo order

1. **Sell screen.** Point out the colours: green, orange, red, grey (sold out) and the red banner.
2. **Build a mixed cone:** add 2 × Vanilla and 1 × Mango. The panel shows "3 of 4 scoops" and the
   button says "Add 1 more scoop" and is locked.
3. Add 1 × Chocolate. The button becomes "Sell serving (UGX 1,000)". All "Add scoop" buttons are
   now disabled, so a 5th scoop cannot be added.
4. **Sell it.** A toast shows the receipt number. The money panel goes up by UGX 1,000 and the
   stock numbers drop.
5. **Open "Show the query"** under the serving panel and show the real `updateOne` with
   `$gte` and `$inc`, and the single `insertOne` for the sale.
6. **Sell Pistachio or Mango until the card is red**, then click **Request refill**, add a note
   and send it. The card shows "Refill requested" and the Stock Manager badge goes up.
7. **Stock Manager.** The request is in the inbox (urgent ones first). Click **Fill up**. Go back to
   Sell: the flavor is green and full again.
8. **Reports.** Show money today and all time, the 7-day chart, scoops per flavor, the popular
   combinations and the Daily closing check. Open "Show the query" on the combinations report to
   show `$sortArray` and `$group`.
9. **DB Demo → Try an invalid sale.** The server answers HTTP 400 to both the 3-scoop and the
   5-scoop serving.
10. **DB Demo → Run query.** Compare documents examined with and without the index.
11. If there is time, click **Start rush** and watch the Sell screen change on its own. Before the
    next presentation, use **Reset demo data** or run `npm run seed`.
