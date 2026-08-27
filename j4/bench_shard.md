# bench_shard.md — Partie A

## Distribution — `census.zips` shardée sur `{ state: 1 }`

**Avant découpage manuel (Q2)**
```
Shard shardA at shardA/shardA:27017
{ data: '2.15MiB', docs: 29470, chunks: 1 }
Shard shardB at shardB/shardB:27017
{ data: '1006KiB', docs: 9242, chunks: 1 }
Totals: { data: '3.13MiB', docs: 38712, chunks: 2,
  shardA: '68.68 % data / 76.12 % docs',
  shardB: '31.31 % data / 23.87 % docs' }
```

**Après 4 `splitAt` supplémentaires (FL, MI, NY, TX) — Q4**
```
Shard shardA: chunks: 4
Shard shardB: chunks: 2
Totals: { data: '3.13MiB', docs: 38712, chunks: 6,
  shardA: '68.68 % data / 76.12 % docs',
  shardB: '31.31 % data / 23.87 % docs' }
```
→ Chunks doublés (2 → 6) mais répartition en % strictement inchangée.

## Distribution — `census.zips_hashed` shardée sur `{ _id: "hashed" }`

```
Shard shardA: docs: 14517, chunks: 2  (49.26 % docs / 49.26 % data)
Shard shardB: docs: 14953, chunks: 2  (50.73 % docs / 50.73 % data)
Totals: { docs: 29470, chunks: 4 }
```
4 chunks pré-répartis dès `shardCollection`, avant même l'import — aucun `splitAt` manuel.

## Frontières de chunks — `census.zips`

Avant Q4 (2 chunks) :
```
shardA [KY -> MaxKey]
shardB [MinKey -> KY]
```

Après Q4 (6 chunks) :
```
shardA [KY -> MI]
shardA [MI -> NY]
shardA [NY -> TX]
shardA [TX -> MaxKey]
shardB [MinKey -> FL]
shardB [FL -> KY]
```

## Les 3 `explain()` — targeted vs broadcast

### 1) `census.zips` — `find({ state: "NY" })` → **TARGETED**
```js
db.zips.find({ state: "NY" }).explain("executionStats")
```
```
winningPlan.stage  : SINGLE_SHARD
shards interrogés  : [ shardA ]
nReturned          : 1596
totalDocsExamined  : 1596
ratio examined/returned : 1.0
```

### 2) `census.zips` — `find({ city: "NEW YORK" })` → **BROADCAST**
```js
db.zips.find({ city: "NEW YORK" }).explain("executionStats")
```
```
winningPlan.stage  : SHARD_MERGE
shards interrogés  : [ shardB, shardA ]
nReturned          : 40
totalDocsExamined  : 38712
ratio examined/returned : 967.8
```

### 3) `census.zips_hashed` — `find({ state: "NY" })` (même requête, clé hachée) → **BROADCAST**
```js
db.zips_hashed.find({ state: "NY" }).explain("executionStats")
```
```
winningPlan.stage  : SHARD_MERGE
shards interrogés  : [ shardA, shardB ]
nReturned          : 1596
totalDocsExamined  : 29470
ratio examined/returned : 18.5
```

**Démonstration du compromis :** la même requête métier (`state: "NY"`) est *targeted* sur
`{state:1}` et *broadcast* sur `{_id:"hashed"}` — la clé qui équilibre le mieux le volume est
celle qui dessert le moins bien la requête métier dominante.

## Tableau de décision (Q9b)

| Shard key candidate | Cardinalité | Distribution mesurée | Requêtes métier ciblées ? | Verdict |
|---|---|---|---|---|
| `{ state: 1 }` | Basse (~50 valeurs) | 76.1 % / 23.9 % docs, stable même après découpage | Oui sur `state` ; Non sur `city` | **Rejeté** — déséquilibre persistant, risque de chunk jumbo |
| `{ _id: "hashed" }` | Très haute (unique) | 49.3 % / 50.7 % (quasi parfait) | Non — même `state` devient broadcast | **Rejeté** — bon équilibre, ciblage perdu partout |
| `{ zip: 1 }` | Haute, **pas unique** (Jour 3 Q4 : doublons, `unique:true` a échoué en `E11000`) | Non mesurée (non shardée) | Ciblée seulement si l'appli filtre sur `zip`, or le besoin dominant filtre sur `state` | **Rejeté** — hors besoin métier réel |
| `{ state: 1, zip: 1 }` | Haute (composée) | Non mesurée | Oui sur `state` (préfixe de la clé composée) ; Non sur `city` | **Meilleur compromis** — ciblage conservé + granularité plus fine que `state` seul |

## Vérification Q5(d) — faite en fin de Partie B

```js
db.zips.countDocuments({})        // 29470
db.zips.estimatedDocumentCount()  // 29470
```
Prédiction confirmée (détail dans `reponses_jour4.md`, Q5d).
