┌─────────────────────────────────────────────────────────────┐
│                    SCOOP TRACKER NO-SQL MAP                  │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Sell a mixed cone] ─────► EMBEDDING (items array)         │
│        │                                                     │
│        └─► DENORMALIZATION (flavorName copied in)           │
│        └─► ATOMIC $inc (no overselling)                     │
│        └─► COMPENSATION / ROLLBACK (if one flavor fails)    │
│                                                             │
│  [Receipt number R-0061] ──► COUNTER PATTERN ($inc seq)     │
│                                                             │
│  [Flavors with different   ──► FLEXIBLE SCHEMA              │
│   optional fields]              (ignoreUndefined, $unset)   │
│                                                             │
│  [One pending refill       ──► PARTIAL UNIQUE INDEX          │
│   per flavor]                                                  │
│                                                             │
│  [Reports: hourly/daily/   ──► AGGREGATION PIPELINE         │
│   per-flavor/combos]           ($unwind, $group, $facet,    │
│                                  $lookup, $sortArray)       │
│                                                             │
│  [Show the query + explain]──► IXSCAN vs COLLSCAN           │
│                                                             │
└─────────────────────────────────────────────────────────────┘

## Part B — Trade-Off Table (DOMINANT #1)
This is the most important section ."why didn't we just use X?" 

### 1. Why MongoDB, not a relational database (MySQL/PostgreSQL)? "Because a single ice cream serving can have a mix of flavors — 2 Vanilla, 1 Mango, 1 Chocolate. In a relational database I would need two tables: one for the sale and one for the sale-items, and join them every time I read a receipt. In MongoDB, all the scoops sit inside one sale document as an array. One read gives the full receipt. Also, flavors don't all have the same fields — some are seasonal, some are vegan, some have nuts. A table would have many empty columns; MongoDB stores only the fields a flavor actually has."
### 2. Why no transactions? Why rollback instead? "MongoDB multi-document transactions need a replica set — that's at least three database servers. For this project I used a single local MongoDB, which is a standalone server and doesn't support transactions. So instead I use compensation: I deduct each flavor one by one with an atomic`$inc` , and if any flavor fails, I put back the scoops I already took (rollback). The effect is the same as a transaction — all-or-nothing — but it works on any MongoDB setup."
### 3. Why raw mongodb driver, not Mongoose? "Mongoose is an ODM that adds a schema layer on top of MongoDB. For a NoSQL course, I wanted to show the actual MongoDB queries — the real`updateOne` ,`$inc` , aggregation pipeline stages — without an abstraction hiding them. Using the raw driver means every query in the code is exactly what MongoDB receives."
### 4. Why embed items in the sale instead of a sale_items collection? "A serving never has more than a few flavors, so the array stays small. Embedding means one read returns the whole receipt with no join. If I used a separate collection, every time I showed a receipt I'd have to query twice — once for the sale, once for its items. Embedding is the right choice when the related data is small and always read together."
### 5. Why copy flavorName into each sale item (denormalization)? "If I only stored the`flavorId` and the flavor gets renamed or deleted later, old receipts would show the wrong name or no name. By copying the name into the sale, each receipt keeps a permanent record of what was actually sold at that moment. Reports also don't need to look up the flavors collection just to print a name."
### 6. Why is the stock status (green/orange/red/grey) NOT stored in the database? "Because status is calculated from`stockScoops` every time a flavor is read. If I stored it, it could become stale — the stock changes but the status color wouldn't update until someone saved it again. By computing it on the fly in one function, the status can never be out of date."
### 7. Why store pricePerSale and scoopsPerSale in a settings collection instead of code? "If the price or serving size is hard-coded, changing it means editing the code and re-deploying. By storing them in a`settings` collection that the server reads on every sale, the stock manager can change the price or scoops per serving from the UI, and it takes effect immediately for new sales. Old sales keep their own`amount` field, so they're not affected by price changes."
## Part C — Live Query Walkthrough (DOMINANT #2)
This is where we proves we understand by reading real queries.

### Demo 1 — The Atomic $inc (no overselling)
Where: Sell screen → build a 4-scoop serving → click Sell serving → open Show the query

The query on screen:
js

`db.flavors.updateOne(
  { _id: ObjectId("..."), stockScoops: { $gte: 2 } },
  { $inc: { stockScoops: -2 }, $set: { updatedAt: ... } }
)`

Presenter Script:
 "This is the heart of the system. The filter has two conditions: the right flavor`_id` , and`stockScoops: { $gte: 2 }` — meaning there must be at least 2 scoops left. The update uses`$inc` to subtract 2.

Why this is atomic: MongoDB checks the filter and applies the`$inc` in one single step inside the database. Nothing can happen in between. So if two sellers try to buy the last scoop at the exact same moment, the first seller's update matches and the stock drops. The second seller's update finds`stockScoops` is now less than what they need — it matches zero documents, and the sale fails. Stock can never go below zero.

`matchedCount` is the field I check — if it's 1, the deduction succeeded; if 0, there wasn't enough stock."
### Demo 2 — Rollback (compensation)
Where: Sell a serving where one flavor has enough but another doesn't — watch the error message.

Presenter Script:
 "Suppose I order 2 Vanilla and 2 Mango. Vanilla has stock, so it's deducted first. Then Mango only has 1 scoop left — its`updateOne` returns`matchedCount: 0` . At that point the system has already taken Vanilla's scoops, so it must put them back.

It runs the opposite`$inc` — adding the scoops back — and writes a`rollback` entry to the`stock_logs` audit trail. Then I get a clear message: 'Only 1 scoop of Mango left.' Nothing is lost, nothing is double-charged."
### Demo 3 — The Counter Pattern (receipt numbers)
Where: After a sale, the receipt number (e.g.,`R-0061` ) appears.

The query:

`db.counters.findOneAndUpdate(
  { _id: "receipt" },
  { $inc: { seq: 1 } },
  { upsert: true, returnDocument: "after" }
)`

Presenter Script:
 "Receipt numbers come from a single counter document.`$inc: { seq: 1 }` increments the number atomically inside the database. Because it's atomic, two sales at the same moment will always get different numbers — one gets 60, the next gets 61. No duplicates.`upsert: true` means if the counter doesn't exist yet, it's created starting at 1."
### Demo 4 — IXSCAN vs COLLSCAN (the index proof)
Where: DB Demo screen → Run query

Presenter Script:
 "This runs the exact same query twice and asks MongoDB to`explain` how it did it.

- With the index: MongoDB does an IXSCAN — it uses the index like a book's table of contents and jumps straight to the matching documents. It examines very few keys.
- Without the index (forced with`hint({ $natural: 1 })` ): MongoDB does a COLLSCAN — it reads every single document in the collection to find the matches.
You can see the difference in`totalDocsExamined` . With the index it's small; without it, it's the entire collection. This is why indexes matter — they turn a full shelf-rummage into a direct lookup."
### Demo 5 — Aggregation with $unwind (per-flavor report)
Where: Reports → Show the query on the per-flavor report.

The pipeline:

js

`[
  { $unwind: "$items" },
  { $group: {
      _id: "$items.flavorId",
      name: { $first: "$items.flavorName" },
      scoops: { $sum: "$items.scoops" }
  }},
  { $lookup: { from: "flavors", localField: "_id", foreignField: "_id", as: "flavor" } },
  { $project: { ... colorHex, value: { $multiply: ["$scoops", 250] } } },
  { $sort: { scoops: -1 } }
]`

Presenter Script:
 "This report answers: how many scoops of each flavor were sold, and how much money each earned?

- `$unwind: "$items"` — one sale has multiple flavors in an array.`$unwind` splits each sale into one row per flavor, so I can count them individually.
- `$group` — I group by`flavorId` , take the name, and sum up all the scoops.
- `$lookup` — I pull the flavor's color from the`flavors` collection so the chart can be colored.
- `$project` with`$multiply` — I calculate the money value: scoops × 250 (the price per scoop).
- `$sort` — most popular flavor first.
All of this happens inside the database — the server just receives the final numbers."
### Demo 6 — $sortArray for flavor combinations
Where: Reports → Show the query on the Popular Combinations report.

The pipeline:

`[
  { $project: { flavors: { $sortArray: { input: "$items.flavorName", sortBy: 1 } } } },
  { $group: { _id: "$flavors", servings: { $sum: 1 } } },
  { $sort: { servings: -1 } },
  { $limit: 10 }
]`

Presenter Script:
 "This finds the most popular flavor mixes. The tricky part: 'Mango + Vanilla' and 'Vanilla + Mango' are the same combination, but the array order differs. So I use `$sortArray` to sort the flavor names alphabetically first. Then `$group` groups identical combinations, and I count and sort them. Without`$sortArray` , the same mix would be counted as two different groups."
### Demo 7 — The Partial Unique Index (one pending refill per flavor)
Where: Try to request a refill for a flavor that already has a pending request — it gets blocked.

Presenter Script:
 "I have a partial unique index on`restock_requests` :`{ flavorId: 1 }` with`partialFilterExpression: { status: "pending" }` . This means the database itself enforces that there can only be one pending request per flavor. Two sellers clicking 'Request refill' at the same time — one succeeds, the other gets a duplicate key error. The database enforces the rule, not my code, so it's impossible to break."
## Part D — The Narrative Flow (opening & closing)
Opening line (memorize):
 "Scoop Tracker is a live stock, sales, and refill system for an ice cream stand. One serving is exactly 4 scoops for UGX 1,000, and flavors can be mixed. I built it on MongoDB to show how a document database handles a small but real business problem — especially the parts that are hard in a relational database: mixed items in one receipt, flavors with different fields, and safe stock updates at a busy counter."
Closing line:
 "In summary, MongoDB let me store each receipt as one document with its scoops embedded, update stock atomically so no one can oversell, use indexes to make queries fast, and run all my reports through aggregation pipelines inside the database. The flexible schema means flavors can have different optional fields, and the counter pattern gives me unique receipt numbers. Every design choice was about matching the document model to the real business problem."
 