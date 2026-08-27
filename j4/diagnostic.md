# diagnostic.md — Partie B5

## Q31 — `explain()` avant/après index

Requête étudiée : `db.trips.find({ "start station id": 476 })`

| | Avant index | Après `createIndex({"start station id":1})` |
|---|---|---|
| `stage` | `COLLSCAN` | `FETCH` (avec `IXSCAN` en entrée) |
| `totalKeysExamined` | — (pas d'index) | 36 |
| `totalDocsExamined` | 10000 | 36 |
| `nReturned` | 36 | 36 |
| Ratio `docsExamined/nReturned` | **277,8** | **1,0** |

**Commande exacte :**
```js
db.trips.find({ "start station id": 476 }).explain("executionStats")
db.trips.createIndex({ "start station id": 1 })
db.trips.find({ "start station id": 476 }).explain("executionStats")
```

**(c)** La valeur idéale du ratio est **1** (chaque document examiné est effectivement retourné,
aucun gaspillage) — atteinte ici après indexation. On ne l'atteint presque jamais en pratique
sans projection dédiée, dès que la requête a plusieurs critères ou qu'un index composé n'est que
partiellement sélectif : le moteur doit alors `FETCH` (aller lire le document complet sur disque)
pour vérifier des conditions que l'index seul ne peut pas trancher, ce qui peut faire examiner
plus de documents que ceux réellement renvoyés. Seule une requête **entièrement couverte par
l'index** (via une `projection` limitée aux champs indexés, sans `FETCH` du tout) garantit ce
ratio de façon systématique, y compris sur des filtres plus complexes.

---

## Q32 — Le profiler

**Commandes :**
```js
db.setProfilingLevel(1, { slowms: 0 })
db.trips.find({ "end station name": "W 52 St & 9 Ave" }).toArray()
db.trips.aggregate([{ $group: { _id: "$usertype", n: { $sum: 1 } } }]).toArray()
db.setProfilingLevel(0)
db.system.profile.find({ ns: "citibike.trips" }, { op:1, ns:1, millis:1, planSummary:1, _id:0 })
```

**Résultat — 2 entrées :**

| `op` | `ns` | `millis` | `planSummary` |
|---|---|---|---|
| `query` | `citibike.trips` | 3 | `COLLSCAN` |
| `command` | `citibike.trips` | 26 | `COLLSCAN` |

`planSummary: COLLSCAN` pour les deux opérations : ni `end station name` ni `usertype` ne sont
indexés, donc même l'agrégation (dont le `$group` doit d'abord tout lire) démarre par un balayage
complet. C'est précisément l'information que le profiler apporte et qu'`explain()` seul ne donne
pas : l'historique réel de ce qui a **effectivement tourné** sur la base pendant une fenêtre de
temps, sans qu'on ait besoin de deviner à l'avance quelle requête observer.

---

## Q33 — Les trois niveaux de profiling

| Niveau | Comportement |
|---|---|
| **0** | Profiler désactivé (valeur par défaut) |
| **1** | N'enregistre que les opérations plus lentes qu'un seuil `slowms` (mis à 0 en Q32 pour tout capturer en TP — jamais en prod) |
| **2** | Enregistre **absolument toutes** les opérations, quel que soit leur temps |

**En production : niveau 1**, avec un `slowms` réaliste (ex. **100 ms**, à ajuster selon le SLA
applicatif) — on veut voir les opérations lentes sans noyer `system.profile` sous le volume des
requêtes rapides normales.

**Deux risques du niveau 2 sur une base chargée :**
1. **Surcharge CPU/IO** — chaque opération, même triviale, déclenche une écriture supplémentaire
   dans `system.profile`, ajoutant de la latence à *toutes* les requêtes.
2. **Écrasement rapide de l'historique utile** — `db.system.profile.stats().capped` renvoie
   `true` : c'est une collection **capée** (taille fixe, FIFO). À volume d'écriture élevé (niveau
   2), les entrées les plus anciennes — potentiellement l'opération lente qu'on cherchait — sont
   **écrasées** avant même d'avoir pu être consultées.

---

## Q34 — Isoler les COLLSCAN lents dans `system.profile`

```js
const N = 100; // millisecondes
db.system.profile.find({ planSummary: "COLLSCAN", millis: { $gt: N } })
```

Testé avec `N=5` sur les 2 entrées capturées en Q32 : seule l'agrégation (26 ms) ressort, le
`find` (3 ms) est filtré. C'est exactement la requête à intégrer dans un tableau de bord de
production pour surveiller en continu les scans complets coûteux — le signal le plus direct d'un
index manquant sur une requête réellement exécutée par l'application.
