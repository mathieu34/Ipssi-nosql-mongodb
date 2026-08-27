# Réponses — TP Jour 4 — Partie A (Sharding appliqué)

> Environnement : cluster monté via `docker-compose.shard.yml` (mongo:7.0, 4 conteneurs
> `cfg1`/`shardA`/`shardB`/`mongos`, port interne 27017 partout, ports publiés
> 27119→27122). `census.zips` importé (29 470 documents).

## Q1 — Rôle des 4 conteneurs

**Commandes exactes exécutées (Windows, PowerShell, sans WSL — équivalent de `setup-shard.sh`)** :
```powershell
# Étape 1 — démarrer les 4 conteneurs
docker compose -f docker-compose.shard.yml up -d

# Étape 2 — config server
docker exec cfg1 mongosh --quiet --eval 'rs.initiate({_id:"cfgRS",configsvr:true,members:[{_id:0,host:"cfg1:27017"}]})'

# Étape 3 — les deux shards
docker exec shardA mongosh --quiet --eval 'rs.initiate({_id:"shardA",members:[{_id:0,host:"shardA:27017"}]})'
docker exec shardB mongosh --quiet --eval 'rs.initiate({_id:"shardB",members:[{_id:0,host:"shardB:27017"}]})'

# Étape 4 — enregistrer les shards auprès de mongos
docker exec mongos mongosh --quiet --eval 'sh.addShard("shardA/shardA:27017"); sh.addShard("shardB/shardB:27017")'

# Étape 5 — chunk size à 1 Mo
docker exec mongos mongosh --quiet config --eval 'db.settings.updateOne({_id:"chunksize"},{$set:{value:1}},{upsert:true})'
```
Résultat vérifié sur le cluster (`sh.status()` côté `mongos`) :
```json
"shards": [
  {"_id":"shardA","host":"shardA/shardA:27017","state":1},
  {"_id":"shardB","host":"shardB/shardB:27017","state":1}
]
```
et `db.settings.find()` (base `config`) → `{"_id":"chunksize","value":1}`.

| Conteneur | Binaire / flag | Rôle | Héberge des données métier ? |
|---|---|---|---|
| `cfg1` | `mongod --configsvr --replSet cfgRS` | Config server : stocke les métadonnées du cluster — la liste des shards **et la carte de placement des chunks** (`config.chunks`), c'est-à-dire "quel intervalle de shard key vit sur quel shard" | Non (aucune donnée métier) |
| `shardA` | `mongod --shardsvr --replSet shardA` | Shard : héberge une partie des documents de `census.zips` | Oui |
| `shardB` | `mongod --shardsvr --replSet shardB` | Shard : héberge l'autre partie des documents | Oui |
| `mongos` | `mongos --configdb cfgRS/cfg1:27017` | Routeur : consulte `cfg1` pour savoir vers quel(s) shard(s) rediriger chaque requête | **Non, aucune donnée du tout** — ni métier ni métadonnées propres |

Attention à une confusion fréquente : `shardA` et `shardB` ne sont **pas** "le premier shard puis
sa suite" — ce sont deux shards indépendants et symétriques dès l'enregistrement
(`sh.addShard`). Aucun des deux n'a de rôle particulier ; c'est le **balancer** qui décide
ensuite, après coup, quelle plage de `state` va sur lequel (cf. Q2/Q3), pas une relation de
séquence entre les deux conteneurs.

**Qui stocke la carte ?** `cfg1` (le config server), dans sa collection `config.chunks`.

**Qui n'héberge aucune donnée ?** `mongos` — c'est un simple routeur, pas un `mongod`.

**Pourquoi réduire `chunksize` de 128 Mo à 1 Mo dans ce TP ?**
`census.zips` ne pèse que ~3 Mo au total. Avec le seuil par défaut (128 Mo), l'intégralité de la
collection resterait dans un seul chunk sur un seul shard : aucun split, aucune migration,
aucune répartition à observer. Réduire à 1 Mo force le balancer à découper et migrer sur un jeu
de données minuscule, pour rendre le phénomène observable en quelques minutes.

**Pourquoi serait-ce une très mauvaise idée en production ?**
Sur un vrai volume (plusieurs Go/To), un chunk de 1 Mo génère un nombre de chunks énorme →
explosion de la taille de `config.chunks` (charge sur le config server) et déclenchement
permanent de migrations (`moveChunk`) qui consomment CPU/IO/bande passante sur les shards,
sans bénéfice proportionnel. C'est un réglage de labo, pas un réglage de prod.

---

## Q2 — Distribution initiale

Commande :
```js
db.zips.getShardDistribution()
```

Résultat (après activation du sharding sur `{state:1}` et ~30 s) :
```
Shard shardA at shardA/shardA:27017
{ data: '2.15MiB', docs: 29470, chunks: 1, 'estimated docs per chunk': 29470 }
Shard shardB at shardB/shardB:27017
{ data: '1006KiB', docs: 9242, chunks: 1, 'estimated docs per chunk': 9242 }
Totals
{ data: '3.13MiB', docs: 38712, chunks: 2,
  'Shard shardA': ['68.68 % data', '76.12 % docs in cluster'],
  'Shard shardB': ['31.31 % data', '23.87 % docs in cluster'] }
```

**2 chunks** au total. Répartition : **shardA 76.12 % des docs, shardB 23.87 %**. Ce n'est **pas
équilibré** — et notez déjà que `docs` totalise 38 712, alors que seuls 29 470 documents ont été
importés.

---

## Q3 — Frontières de chunks

Commande :
```js
const c = db.getSiblingDB("config");
const u = c.collections.findOne({ _id: "census.zips" }).uuid;
c.chunks.find({ uuid: u }).sort({ shard: 1 }).toArray().forEach(x => {
  const borne = v => (v && v.constructor && /^(MinKey|MaxKey)$/.test(v.constructor.name))
                  ? v.constructor.name : v;
  print(x.shard + " [" + borne(x.min.state) + " -> " + borne(x.max.state) + "]");
})
```

Résultat :
```
shardA [KY -> MaxKey]
shardB [MinKey -> KY]
```

`MinKey`/`MaxKey` sont des bornes spéciales représentant respectivement "plus petite valeur
possible" et "plus grande valeur possible" pour le type — elles couvrent les extrémités de
l'espace des shard keys (y compris des valeurs qui n'existent pas dans les données, comme `null`
ou un état hors de l'alphabet connu).

La coupure a été faite sur **KY** (Kentucky). Ce n'est **pas** le milieu de l'alphabet (qui serait
autour de M/N) : le balancer n'équilibre pas les *lettres*, il équilibre le **volume de données**
(et le nombre de documents) de part et d'autre de la coupure.

---

## Q4 — Découper plus, est-ce rééquilibrer ?

Commande :
```js
["FL","MI","NY","TX"].forEach(s => sh.splitAt("census.zips", { state: s }))
```
(4× `{ ok: 1 }`)

**(a) Combien de chunks maintenant ?**
```js
db.zips.getShardDistribution()
```
```
Shard shardA: chunks: 4
Shard shardB: chunks: 2
Totals: chunks: 6
```
→ **6 chunks** (contre 2 en Q2).

**(b) Pourcentage de documents par shard, avant/après :**

| | shardA | shardB |
|---|---|---|
| Avant (Q2) | 76.12 % | 23.87 % |
| Après (Q4) | 76.12 % | 23.87 % |

**Le pourcentage n'a bougé de 0 point.** Découper plus n'a **pas** rééquilibré le cluster.

**(c) Explication.**
Comptage par état :
```js
db.zips.aggregate([{$group:{_id:"$state",n:{$sum:1}}},{$sort:{n:-1}},{$limit:5}])
```
```
[ { _id: 'TX', n: 1676 }, { _id: 'NY', n: 1596 }, { _id: 'CA', n: 1523 },
  { _id: 'PA', n: 1458 }, { _id: 'IL', n: 1240 } ]
```
Dans ce jeu précis, aucun état ne dépasse à lui seul la taille d'un chunk (même TX, le plus
lourd, ne pèse que ~186 Ko avec un objet moyen de 111 B — bien en dessous du seuil de 1 Mo). Les
nouvelles frontières créées n'ont donc pas déclenché de migration : le déséquilibre entre shardA
et shardB (~1,1 Mo d'écart) reste sous le seuil de migration du balancer, qui a jugé le
déplacement non prioritaire dans la fenêtre observée.

Plus généralement — et c'est la vraie limite que la question vise : le balancer ne peut **jamais**
couper un chunk entre deux documents qui partagent la **même valeur de shard key**. Si un seul
état pesait à lui seul plus qu'un chunk entier, ce chunk deviendrait un **chunk "jumbo"** :
impossible à découper plus finement, donc impossible à répartir — il resterait figé sur son
shard d'origine quelle que soit la stratégie du balancer. C'est le risque structurel d'une shard
key à faible cardinalité comme `state` (~50 valeurs possibles).

---

## Q5 — Le piège du comptage

Commandes :
```js
db.zips.countDocuments({})
db.zips.estimatedDocumentCount()
```

**(a)** `countDocuments({})` → **29 470**. `estimatedDocumentCount()` → **38 712**.
Écart = **9 242**.

**(b)** Cet écart (9 242) est **exactement** le nombre de documents affiché pour `shardB` en Q2.
Ce n'est pas une coïncidence.

**(c)** Le phénomène s'appelle les **documents orphelins** (*orphaned documents*) : lors d'une
migration de chunk, le shard destinataire (`shardB`) reçoit une copie des documents avant que le
shard source (`shardA`) ne supprime les siens. `estimatedDocumentCount()` lit un compteur brut
par shard (rapide, mais sans filtrage d'appartenance) et compte donc **deux fois** les documents
migrés tant que le nettoyage n'a pas eu lieu. `countDocuments({})` exécute une vraie requête qui
filtre par appartenance réelle de chunk → résultat correct mais coûteux (scan effectif).
**À bannir sur un cluster shardé : `estimatedDocumentCount()`** (résultat silencieusement faux
juste après une migration). `countDocuments({})` est plus coûteux précisément parce qu'il doit
réellement scanner/filtrer au lieu de lire un compteur de métadonnées.

**(d)** `orphanCleanupDelaySecs` vaut par défaut **900 secondes = 15 minutes**. **Prédiction
écrite maintenant :** 15 minutes après la migration observée, le range deleter aura purgé les
copies orphelines sur `shardA` ; `estimatedDocumentCount()` devrait alors redescendre à
**29 470**, identique à `countDocuments({})`.

**Vérification (fin de Partie B, cluster resté allumé)** :
```js
db.zips.countDocuments({})        // 29470
db.zips.estimatedDocumentCount()  // 29470
```
**Prédiction confirmée** : les deux valeurs sont redevenues identiques — les documents orphelins
ont bien été purgés par le range deleter une fois `orphanCleanupDelaySecs` écoulé.

En quoi c'est plus dangereux en prod qu'une anomalie permanente : une anomalie qui **disparaît
d'elle-même** est difficile à reproduire et à diagnostiquer après coup (un ticket de support
arrive après les 15 minutes, le symptôme a disparu), alors qu'une anomalie permanente est au
moins stable et reproductible pour l'investiguer.

---

stage racine : single_shard, 
shard A, n returned : 1596,  total doc : 1596
SHARD_MERGE, shard B, nReturned: 0, totalDocsExamined: 9242

## Q6/Q7 — Targeted vs broadcast

Commandes et résultats (extraits pertinents de l'`explain`) :

```js
db.zips.find({ state: "NY" }).explain("executionStats")
```
shard_merge ? 
```
winningPlan.stage      : SINGLE_SHARD
winningPlan.shards     : [ "shardA" ]
nReturned              : 1596
totalDocsExamined      : 1596
```

```js
db.zips.find({ city: "NEW YORK" }).explain("executionStats")
```
```
winningPlan.stage      : SHARD_MERGE
winningPlan.shards     : [ "shardB", "shardA" ]
nReturned              : 40
totalDocsExamined      : 38712
```

**Q7(a)** Comment distinguer les deux dans l'`explain` :

| | Targeted (`state:"NY"`) | Broadcast (`city:"NEW YORK"`) |
|---|---|---|
| `winningPlan.stage` | `SINGLE_SHARD` | `SHARD_MERGE` |
| `winningPlan.shards` | `["shardA"]` — un seul | `["shardB","shardA"]` — les deux |

Le signe précis, c'est `winningPlan.shards` : sur la requête targeted, `mongos` a pu déterminer
**avant même d'interroger qui que ce soit** qu'un seul shard pouvait contenir des résultats
(car `state` est la shard key, donc `mongos` connaît la carte de placement). Sur la requête
broadcast, `city` n'est pas la shard key : `mongos` n'a aucun moyen de savoir où chercher, donc il
envoie la requête à **tous** les shards enregistrés et fusionne (`SHARD_MERGE`) leurs résultats
côté routeur.

**Q7(b)** Ratio `totalDocsExamined / nReturned` pour la broadcast : **38712 / 40 ≈ 967,8**.

**Q7(c)** Extrapolation à 20 shards / 500 millions de documents :

- **20 machines mobilisées** : un scatter-gather interroge tous les shards parce que `mongos` ne
  sait pas dans lequel se trouve la donnée cherchée — donc à 20 shards, il interroge les 20. Ce
  nombre ne dépend pas du ratio, juste du fait que `city` n'est pas la shard key.
- **~500 millions de documents examinés** : `city` n'étant pas indexé, chaque shard fait un
  `COLLSCAN` complet sur sa portion — la somme des scans balaie donc la totalité du cluster, quel
  que soit le ratio.
- **Le ratio 967,8 sert à estimer ce qui serait *retourné*, pas ce qui serait *lu*** : en supposant
  que la proportion de documents "New York" reste stable à cette échelle,
  `nReturned ≈ 500 000 000 / 967,8 ≈ 516 600`.

Un cluster mal shardé sur les requêtes métier dominantes ne scale pas — au contraire, plus on
ajoute de shards, plus une requête broadcast mobilise (et paie) de machines simultanément, sans
gain de parallélisme utile côté client.

---

## Q8 — La clé hachée

Commandes :
```js
sh.shardCollection("census.zips_hashed", { _id: "hashed" })   // collection vide
// puis import de zips.json (29 470 docs)
db.zips_hashed.getShardDistribution()
```

Résultat :
```
Shard shardA: docs: 14517, chunks: 2   (49.26 % docs)
Shard shardB: docs: 14953, chunks: 2   (50.73 % docs)
Totals: docs: 29470, chunks: 4
```

**Quasi parfaitement équilibré** (49.26 % / 50.73 %), et **4 chunks dès le départ, sans aucun
`splitAt` manuel**. Explication : pour une clé hachée, MongoDB **pré-découpe** (*pre-splitting*)
l'espace de hachage en intervalles égaux dès la création de la collection shardée (si elle est
vide), et répartit ces chunks vides entre tous les shards enregistrés **avant** même l'import —
les documents tombent donc directement dans le bon chunk à l'écriture, sans attendre un
rééquilibrage a posteriori.

Comparaison des comptages sur `zips_hashed` :
```js
db.zips_hashed.countDocuments({})        // 29470
db.zips_hashed.estimatedDocumentCount()  // 29470
```
**L'écart de la Q5 n'existe pas ici** (0) : comme les chunks étaient déjà en place avant l'import,
aucune migration n'a eu lieu après coup, donc aucun orphelin.

---

## Q9 — Le compromis, prouvé, puis arbitré

Commande (même requête métier qu'en Q6, sur la collection hachée) :
```js
db.zips_hashed.find({ state: "NY" }).explain("executionStats")
```
```
winningPlan.stage   : SHARD_MERGE
winningPlan.shards  : [ "shardA", "shardB" ]
nReturned           : 1596
totalDocsExamined   : 29470
```

non le stage racine est SHARD_MERGE

**Q9(a)** Le stage racine n'est **pas** le même que pour `census.zips` (`SINGLE_SHARD` sur
`state`, `SHARD_MERGE` sur `_id` haché) pour la **même** requête métier.
**Compromis fondamental du sharding :** une shard key qui répartit parfaitement le volume de
données (clé hachée) est en général celle qui détruit la localité nécessaire aux requêtes de
l'application, et inversement — on ne peut optimiser simultanément l'équilibrage brut et le
ciblage des requêtes métier avec la même clé.

**Q9(b) — Tableau de décision**

| Shard key candidate | Cardinalité | Distribution mesurée | Requêtes métier ciblées ? | Verdict |
|---|---|---|---|---|
| `{ state: 1 }` | Basse (~50 valeurs) | Déséquilibrée : 76.1 % / 23.9 % docs, ne bouge pas même après découpage (Q4) | Oui pour `find({state:...})` (SINGLE_SHARD) ; Non pour `find({city:...})` (SHARD_MERGE) | **Rejeté** — déséquilibre persistant, risque de chunk jumbo si un état grossit |
| `{ _id: "hashed" }` | Très haute (unique) | Quasi parfaite : 49.3 % / 50.7 % | Non — même `find({state:...})` devient SHARD_MERGE (Q9) | **Rejeté** — bel équilibre mais perd le ciblage sur toutes les requêtes usuelles |
| `{ zip: 1 }` | Haute mais **pas unique** (Jour 3 Q4 : doublons observés, ex. `"63673"` en double ; `createIndex({zip:1},{unique:true})` a échoué avec `E11000`) | Non mesurée ici (non shardée) | Ciblée seulement si l'appli filtre sur `zip` — or le besoin métier dominant filtre sur `state` | **Rejeté** — ne sert pas les requêtes métier réelles, et l'absence d'unicité fragilise l'équilibrage fin |
| `{ state: 1, zip: 1 }` | Haute (composée) | Non mesurée ici | Oui pour `find({state:...})` — `state` est le **préfixe** de la clé composée, donc ciblable seul ; Non pour `find({city:...})` | **Meilleur compromis** — conserve le ciblage sur la requête métier dominante tout en offrant une granularité plus fine que `state` seul à l'intérieur d'un état populeux, réduisant le risque de chunk jumbo |

---

# Partie B — Performances & diagnostic

> Environnement : `citibike.trips` importé (10 000 documents) sur le conteneur `mongo-j4`
> (`docker-compose.yml`, mongo:7.0, port 27017, `admin`/`ipssi2025`).

## B0 — Environnement et import

```powershell
docker compose up -d
docker cp trips.json mongo-j4:/tmp/trips.json
docker exec mongo-j4 mongoimport -u admin -p ipssi2025 --authenticationDatabase admin `
  --db citibike --collection trips --drop --file /tmp/trips.json
```
→ `10000 document(s) imported successfully.`

Point de contrôle :
```js
db.trips.countDocuments({})   // 10000
db.trips.findOne()
```
Extrait, avec les espaces dans les noms de champs bien visibles :
```json
{
  "tripduration": 889,
  "start station id": 268,
  "start station name": "Howard St & Centre St",
  "birth year": 1961,
  "start station location": { "type": "Point", "coordinates": [-73.99973337, 40.71910537] },
  "start time": "2016-01-01T00:01:06.000Z"
}
```

**Q10.** Un nom de champ avec espace ne peut pas s'écrire en notation pointée (`db.trips.find({start station id: 268})` est un `SyntaxError` JS — un identifiant ne peut pas contenir d'espace). Il faut le mettre entre guillemets, comme une clé de chaîne :

(a) Filtre `find` :
```js
db.trips.find({ "start station id": 268 })
```
(b) Référence dans un `$group` :
```js
db.trips.aggregate([{ $group: { _id: "$start station id", n: { $sum: 1 } } }])
```
Sans les guillemets, ce n'est même pas une erreur MongoDB : c'est un **`SyntaxError` JavaScript** levé avant que la requête ne parte (`Unexpected identifier 'station'`, vérifié en shell) — le code ne compile pas.

**Q11.** Plage temporelle :
```js
db.trips.aggregate([{$group:{_id:null, minStart:{$min:"$start time"}, maxStop:{$max:"$stop time"}}}])
```
```json
{ "minStart": "2016-01-01T00:00:41.000Z", "maxStop": "2016-01-05T21:47:46.000Z" }
```
Le jeu s'annonce comme "1er et 2 janvier 2016", mais `stop time` va jusqu'au **5 janvier** — 3 jours
de plus que prévu. Ce n'est pas une erreur d'import : ce sont très probablement des trajets
commencés le 1er/2 janvier mais avec une durée aberrante (`tripduration` énorme, cf. Q20) qui
repousse artificiellement leur `stop time` de plusieurs jours — vélo non redéposé, perdu, ou
signalement défaillant.

---

## B1 — Aggregation Pipeline : les fondamentaux (`pipelines.js`)

**Q12.** Top 5 stations de départ :
```js
db.trips.aggregate([
  { $group: { _id: "$start station name", n: { $sum: 1 } } },
  { $sort: { n: -1 } }, { $limit: 5 }
])
```
```
Central Park S & 6 Ave   114
Lafayette St & E 8 St     99
Carmine St & 6 Ave        95
Broadway & E 14 St        93
E 17 St & Broadway        86
```

**Q13.** Répartition par `usertype` :
```js
db.trips.aggregate([
  { $group: { _id: "$usertype", n: { $sum: 1 }, dureeMoy: { $avg: "$tripduration" } } }
])
```
```
Customer:   n=1989, dureeMoy=2610.71 s (~43,5 min)
Subscriber: n=8011, dureeMoy=762.36 s  (~12,7 min)
```
Rapport : 2610.71 / 762.36 ≈ **3,42×** — un `Customer` (pass journalier/touriste) roule en
moyenne 3,4 fois plus longtemps qu'un `Subscriber` (abonné). Hypothèse métier : les `Subscriber`
utilisent le vélo pour des trajets utilitaires courts (domicile-travail, point A→B), les
`Customer` pour des balades touristiques/loisir, sans contrainte de temps.

**Q14.** Trajets par jour :
```js
db.trips.aggregate([
  { $group: { _id: { $dateTrunc: { date: "$start time", unit: "day" } }, n: { $sum: 1 } } },
  { $sort: { _id: 1 } }
])
```
```
2016-01-01: 6348
2016-01-02: 3652
```
**2 jours**, cohérent avec la Q11 : les `start time` restent bien dans la fenêtre 1er-2 janvier
annoncée — c'est uniquement `stop time` qui déborde (à cause des trajets aberrants), pas
`start time`.

**Q15.** Heure de pointe :
```js
db.trips.aggregate([
  { $group: { _id: { $hour: "$start time" }, n: { $sum: 1 } } },
  { $sort: { n: -1 } }, { $limit: 5 }
])
```
```
13h: 1061   12h: 827   11h: 778   15h: 709   14h: 685
```
Ce n'est **pas** un profil domicile-travail (qui montrerait deux pics distincts vers 8h et
17-18h) — c'est un pic unique en milieu de journée. Le 1er janvier 2016 était un **vendredi, jour
férié** (Nouvel An), et le 2 janvier un **samedi** : aucun des deux jours du jeu n'est un jour
ouvré normal, ce qui explique un usage loisir/déambulation plutôt qu'un usage utilitaire.

**Q16.** Distribution des durées :
```js
db.trips.aggregate([
  { $bucket: { groupBy: "$tripduration", boundaries: [0,300,600,1800,3600,1000000],
               output: { n: { $sum: 1 } } } }
])
```
```
[0-300s):     2009
[300-600s):   3136
[600-1800s):  3953   <- la plus peuplée
[1800-3600s):  652
[3600-...):    250
```
La tranche **[600, 1800) secondes (10 à 30 min)** est la plus peuplée.

**Q17.** Boucles (départ = arrivée) :
```js
db.trips.countDocuments({ $expr: { $eq: ["$start station id", "$end station id"] } })
```
→ **316** trajets.

---

## B2 — Qualité de données et optimiseur

**Q18.** Le champ piégé :
```js
db.trips.countDocuments({ "birth year": { $type: "string" } })   // 1989
db.trips.countDocuments({ "birth year": { $type: "int" } })      // 8011
db.trips.aggregate([{ $group: { _id: { u: "$usertype", t: { $type: "$birth year" } }, n: { $sum: 1 } } }])
```
```
{ u: 'Customer',   t: 'string' } -> 1989
{ u: 'Subscriber', t: 'int' }    -> 8011
```
**Découverte** : les nombres correspondent **exactement** aux effectifs de la Q13 (1989 Customer,
8011 Subscriber). Ce n'est pas une coïncidence — `birth year` est stocké en **chaîne pour 100 %
des `Customer`**, et en entier pour 100 % des `Subscriber`. Une requête
`{ "birth year": { $lt: 1950 } }` est **silencieusement fausse** parce que MongoDB compare par
type BSON : un `$lt` numérique ne matche jamais une valeur stockée en chaîne (les types ne sont
pas comparés entre eux dans une comparaison d'ordre), donc cette requête **ignore purement et
simplement tous les `Customer`** sans lever la moindre erreur.

**Q19.** Âge moyen (années numériques uniquement) :
```js
db.trips.aggregate([
  { $match: { "birth year": { $type: ["int","long","double"] } } },
  { $group: { _id: null, ageMoy: { $avg: { $subtract: [2016, "$birth year"] } },
              n: { $sum: 1 }, plusVieux: { $min: "$birth year" } } }
])
```
```
ageMoy: 39.86 ans   n: 8011   plusVieux: 1885
```
Un usager né en **1885** aurait 131 ans en 2016 — **pas crédible**. En production, ce document
mériterait d'être **signalé/mis en quarantaine** (pas supprimé aveuglément) : soit une valeur par
défaut/placeholder mal saisie, soit une fraude sur le formulaire d'inscription, à investiguer
plutôt qu'à silencieusement inclure dans une moyenne.

**Q20.** Valeurs aberrantes :
```js
db.trips.countDocuments({ tripduration: { $gt: 10800 } })   // > 3h  -> 54
db.trips.countDocuments({ tripduration: { $gt: 86400 } })   // > 24h -> 9
db.trips.find({}, { tripduration:1, usertype:1, _id:0 }).sort({ tripduration:-1 }).limit(3)
```
```
326222 s (~90,6 h) - Subscriber
279620 s (~77,7 h) - Customer
173357 s (~48,2 h) - Customer
```
Explication métier probable : un vélo non redéposé correctement (dock défaillant, vol, oubli) —
le compteur continue de tourner entre le décrochage et le moment où le système considère le
trajet clos, ce n'est pas un temps de conduite réel.

**Q21.** Recalcul en excluant les trajets > 3h :
```js
db.trips.aggregate([
  { $match: { tripduration: { $lte: 10800 } } },
  { $group: { _id: "$usertype", n: { $sum: 1 }, dureeMoy: { $avg: "$tripduration" } } }
])
```
```
Customer:   n=1948, dureeMoy=1717.93 s
Subscriber: n=7998, dureeMoy=648.59 s
```

(a) Nouvelles moyennes : **Customer 1717,93 s**, **Subscriber 648,59 s**.

(b) Écart avec Q13 : Customer (2610.71 → 1717.93) = **-34,2 %** ; Subscriber (762.36 → 648.59) =
**-14,9 %**. Les deux populations ne sont **pas** affectées pareil : les `Customer` perdent plus
du double, en proportion, de ce que perdent les `Subscriber`. Cohérent avec Q19/Q20 : les usagers
occasionnels (pass journalier, moins familiers de la procédure de retour) sont plus exposés aux
trajets anormalement longs (vélo mal redéposé) que les abonnés réguliers.

(c) Trajets exclus : **54** sur 10 000, soit **0,54 %** du jeu. Un rapport frappant : 0,54 % des
lignes suffit à faire bouger la moyenne `Customer` de 34 % — la preuve qu'une moyenne brute est
extrêmement fragile face à une poignée de valeurs extrêmes.

(d) Pour la direction, je communiquerais la valeur **filtrée** (Q21), en la présentant toujours
avec son critère d'exclusion explicite (`tripduration ≤ 3h`) — la valeur brute (Q13) mélange une
tendance centrale réelle avec un artefact opérationnel (vélos mal redéposés), ce qui la rend
trompeuse sans cette précision.

**Q22.** `$match` en premier — vraiment ?
```js
// A
db.trips.explain("executionStats").aggregate([
  { $match: { usertype: "Subscriber" } },
  { $group: { _id: "$start station id", n: { $sum: 1 } } }
])
// B
db.trips.explain("executionStats").aggregate([
  { $group: { _id: { s: "$start station id", u: "$usertype" }, n: { $sum: 1 } } },
  { $match: { "_id.u": "Subscriber" } }
])
```
Résultat pour **les deux** pipelines, strictement identique :
```
stages              : [ "$cursor", "$group" ]
$cursor.parsedQuery : { usertype: { $eq: "Subscriber" } }
totalDocsExamined   : 10000
nReturned (cursor)  : 8011
```
**Les deux plans sont identiques.** L'optimiseur a **réécrit le pipeline B** pour le rendre
équivalent au A : il a détecté que `_id.u` dans le `$match` n'est qu'une copie directe du champ
`usertype` d'entrée (une clé de regroupement, pas une valeur calculée), et a donc pu remonter ce
filtre **avant** le `$group`, exactement comme si vous l'aviez écrit en premier vous-même. C'est
l'optimisation "*aggregation pipeline optimization*" : coalescence de `$match` autour de `$group`
quand le filtre porte sur un champ de l'`_id` du groupe.
(`totalDocsExamined: 10000` dans les deux cas parce qu'il n'existe aucun index sur `usertype` —
l'optimiseur choisit le meilleur *plan disponible*, il ne crée pas d'index tout seul.)

**Q23.** La limite de l'optimiseur :
```js
db.trips.explain("executionStats").aggregate([
  { $group: { _id: "$start station id", n: { $sum: 1 } } },
  { $match: { n: { $gt: 50 } } }
])
```
```
stages            : [ "$cursor", "$group", "$match" ]
$cursor.parsedQuery : {}  (aucun filtre poussé)
totalDocsExamined : 10000
nReturned (cursor): 10000  (tous les documents traversent le $group)
```
**Les 10 000 documents traversent le `$group`** — aucune optimisation possible ici, contrairement
à la Q22. Pourquoi : `n` est un **résultat calculé** par l'accumulateur `$sum`, il n'existe **pas
encore** au moment où un document individuel est lu — impossible de savoir si un document
appartiendra à un groupe qui dépassera 50 avant d'avoir tout compté. **Règle générale** :
l'optimiseur ne peut remonter un `$match` avant un `$group` que s'il porte sur un champ de la clé
de regroupement (`_id`), jamais sur une valeur agrégée (`$sum`, `$avg`, `$count`, …).
Nombre de stations à plus de 50 départs : **34**.

---

## B3 — Matérialisation et jointure

**Q24.** Construction de `stations` via `$merge` :
```js
db.trips.aggregate([
  { $group: { _id: "$start station id",
              nom: { $first: "$start station name" },
              position: { $first: "$start station location" },
              departs: { $sum: 1 } } },
  { $merge: { into: "stations", whenMatched: "replace" } }
])
```
**462 stations.** Top 3 par départs : Central Park S & 6 Ave (114), Lafayette St & E 8 St (99),
Carmine St & 6 Ave (95) — cohérent avec la Q12.

**Q25.** `$out` remplace **intégralement** la collection cible à chaque exécution (tout ou rien,
et échoue si la collection cible est utilisée ailleurs, par ex. shardée). `$merge` peut fusionner
document par document (`whenMatched`/`whenNotMatched`) sans tout recalculer ni tout réécrire.
**`$merge` est le seul des deux adapté à un rafraîchissement quotidien incrémental** : on peut
relancer le pipeline chaque matin sur les nouvelles données du jour et ne mettre à jour que les
documents concernés, sans reconstruire toute la collection ni interrompre les lecteurs pendant le
recalcul.

**Q26.** Top 5 arrivées avec jointure sur `stations` :
```js
db.trips.aggregate([
  { $group: { _id: "$end station id", n: { $sum: 1 } } },
  { $sort: { n: -1 } }, { $limit: 5 },
  { $lookup: { from: "stations", localField: "_id", foreignField: "_id", as: "station" } },
  { $unwind: "$station" },
  { $project: { _id:0, station: "$station.nom", n:1 } }
])
```
```
E 17 St & Broadway        96
Central Park S & 6 Ave    95
Broadway & E 14 St        91
W 21 St & 6 Ave           85
West St & Chambers St     85
```
Comparé à la Q12 (départs) : **3 stations communes** aux deux tops (Central Park S & 6 Ave,
Broadway & E 14 St, E 17 St & Broadway). `E 17 St & Broadway` a **plus d'arrivées (96) que de
départs (86)** — signal typique d'une station qui accumule des vélos plus vite qu'elle n'en émet,
et qui nécessite donc un rééquilibrage physique (camion) plus fréquent que la moyenne.

---

## B4 — Index géospatial 2dsphere (`geo.js`)

**Q27.** Sans index :
```js
db.trips.find({ "start station location": { $near: {
  $geometry: { type: "Point", coordinates: [-73.9855, 40.7580] }, $maxDistance: 500 } } })
```
```
error processing query: ... GEONEAR field=start station location maxdist=500 ...
unable to find index for $geoNear query
```
Un index est **obligatoire** ici (pas juste conseillé comme pour une requête classique) parce que
`$near` doit renvoyer les résultats **triés par distance** : sans structure spatiale (arbre du
2dsphere), il n'existe **aucun moyen de calculer/trier des distances géographiques par un simple
scan linéaire** — contrairement à un `find` classique où un `COLLSCAN` reste une option
(lente, mais possible).

**Q28.** Création de l'index puis relance :
```js
db.trips.createIndex({ "start station location": "2dsphere" })
db.trips.find({ "start station location": { $near: { ... $maxDistance: 500 } } })
```
**148 résultats.** 5 premiers noms (ordre `$near`, du plus proche au plus loin) :
```
W 45 St & 6 Ave (x4), W 45 St & 8 Ave
```

**Q29.** Comptage avec `$near` :
```js
db.trips.countDocuments({ "start station location": { $near: { ... } } })
```
```
$geoNear, $near, and $nearSphere are not allowed in this context, as these operators require
sorting geospatial data. If you do not need sort, consider using $geoWithin instead.
```
`countDocuments` est une agrégation déguisée (elle compile en `$match` + `$count` en interne), et
un plan d'exécution de comptage **ne garantit aucun ordre** — or `$near` n'a de sens que *trié*
par distance. Le message le dit explicitement : passer par `$geoWithin` si le tri ne sert à rien.
```js
const r500  = 0.5 / 6378.1;
const r1000 = 1   / 6378.1;
db.trips.countDocuments({ "start station location": { $geoWithin: { $centerSphere: [[-73.9855, 40.7580], r500] } } })   // 148
db.trips.countDocuments({ "start station location": { $geoWithin: { $centerSphere: [[-73.9855, 40.7580], r1000] } } })  // 774
```
**148 trajets** à moins de 500 m (cohérent avec la Q28), **774 trajets** à moins de 1 000 m.

**Q30.** `$geoNear` sur `stations` :
```js
db.stations.createIndex({ position: "2dsphere" })
db.stations.aggregate([
  { $geoNear: { near: { type: "Point", coordinates: [-73.9855, 40.7580] },
                distanceField: "distance", maxDistance: 1000, spherical: true } },
  { $project: { _id:0, nom:1, distance: { $round: ["$distance", 0] }, departs:1 } }
])
```
**33 stations.** La plus proche : **W 45 St & 6 Ave, à 256 m**.
`$geoNear` doit être le **premier stage** du pipeline parce qu'il a besoin de **l'index
géospatial** pour opérer efficacement (comme `$near`) — s'il était placé après un autre stage, il
recevrait des documents déjà transformés/désindexés par l'étape précédente, sur lesquels
l'optimiseur ne peut plus s'appuyer sur l'index d'origine de la collection source.

---

## B5 — Diagnostic (`diagnostic.md`)

**Q31.** `explain()` sur `db.trips.find({ "start station id": 476 })` :

(a) Avant tout index :
```
stage: COLLSCAN
totalDocsExamined: 10000
nReturned: 36
```
(b) Après `db.trips.createIndex({ "start station id": 1 })` :
```
stage: FETCH (avec IXSCAN en entrée)
totalKeysExamined: 36
totalDocsExamined: 36
nReturned: 36
```
(c) Ratio `totalDocsExamined / nReturned` : **avant = 10000/36 ≈ 277,8** ; **après = 36/36 = 1,0**.
La valeur idéale visée est **1** (chaque document examiné est effectivement retourné, aucun
gaspillage) — on l'atteint rarement en pratique parce qu'un index composé ou une requête à
plusieurs critères oblige souvent à examiner (`FETCH`) des documents pour vérifier des conditions
non couvertes par l'index seul ; seule une **requête totalement couverte par l'index**
(`projection` limitée aux champs indexés, sans `FETCH` du tout) garantit ce ratio de façon
systématique.

**Q32.** Profiler activé sur toutes les opérations :
```js
db.setProfilingLevel(1, { slowms: 0 })
db.trips.find({ "end station name": "W 52 St & 9 Ave" }).toArray()
db.trips.aggregate([{$group:{_id:"$usertype", n:{$sum:1}}}]).toArray()
db.setProfilingLevel(0)
db.system.profile.find({ns:"citibike.trips"}, {op:1, ns:1, millis:1, planSummary:1, _id:0})
```
**2 entrées** :
```
{ op: 'query',   ns: 'citibike.trips', millis: 3,  planSummary: 'COLLSCAN' }
{ op: 'command', ns: 'citibike.trips', millis: 26, planSummary: 'COLLSCAN' }
```
`planSummary: COLLSCAN` pour les deux : ni `end station name` ni `usertype` ne sont indexés, donc
même l'agrégation (dont le `$group` doit d'abord tout lire) commence par un balayage complet.
C'est précisément ce que le profiler permet de voir que `explain()` ne montre pas tout seul :
l'historique réel de ce qui a tourné en base, sans avoir à deviner quelle requête a été lente.

**Q33.** Les trois niveaux de profiling :
- **0** : profiler désactivé (défaut).
- **1** : n'enregistre que les opérations **plus lentes** qu'un seuil `slowms` (0 = tout, y
  compris les rapides — utile en TP/debug, jamais en prod).
- **2** : enregistre **absolument toutes** les opérations, quel que soit leur temps.

En production, **niveau 1** avec un `slowms` réaliste (ex. **100 ms**, à ajuster selon le SLA
applicatif) — on veut voir les opérations lentes sans noyer `system.profile` sous le bruit des
requêtes rapides normales.
Deux risques du niveau 2 sur une base chargée : (1) **surcharge CPU/IO** — chaque opération, même
triviale, déclenche une écriture supplémentaire dans `system.profile` ; (2) **écrasement rapide de
l'historique utile** — `db.system.profile.stats().capped` renvoie `true` : c'est une collection
**capée** (taille fixe), donc à volume d'écriture élevé (niveau 2), les entrées les plus anciennes
(potentiellement l'opération lente qu'on cherchait) sont **écrasées** avant même d'avoir pu être
consultées.

**Q34.** Isoler les `COLLSCAN` de plus de N ms dans `system.profile` :
```js
const N = 100;
db.system.profile.find({ planSummary: "COLLSCAN", millis: { $gt: N } })
```
Testé avec `N=5` sur nos 2 entrées captées : seule l'agrégation (`26 ms`) ressort, le `find` (`3
ms`) est filtré. C'est exactement la requête à mettre dans un tableau de bord de production pour
surveiller les scans complets coûteux.

---

# Partie C — Réflexion

**R1. Le tableau de bord quotidien.** Architecture : un job planifié (cron / scheduler applicatif)
tourne chaque matin à 6h et exécute le pipeline `$merge` de la Q24 (et ses équivalents pour les
autres métriques du tableau de bord — top stations, profils horaires, etc.), écrivant le résultat
dans des collections dérivées (comme `stations`) plutôt que dans `trips` directement. Le
dashboard, lui, ne lit **que** ces collections dérivées, petites et déjà indexées pour ses
propres besoins d'affichage — jamais `trips` en direct. Le profiler (niveau 1, `slowms` élevé)
reste actif en continu pour détecter toute dérive de performance sur ce job planifié.

Chiffrage du gain : en Q23, l'agrégation complète sur `trips` examine **10 000 documents**
(`totalDocsExamined`). La collection dérivée `stations` (Q24) contient **462 documents**. Rapport
: 10000 / 462 ≈ **21,6×** — chaque affichage du dashboard lit environ 22 fois moins de documents
en interrogeant `stations` plutôt qu'en recalculant depuis `trips`. Le compromis accepté :
**fraîcheur des données**. Le dashboard n'est à jour qu'au moment du dernier rafraîchissement (ici
6h du matin) — un trajet enregistré à 10h n'apparaîtra dans les stats qu'au rafraîchissement
suivant, jamais en temps réel.

**R2. La règle d'écriture des pipelines — vérifiée.**
Règle en trois phrases, à partir des Q22/Q23 : *L'optimiseur d'agrégation peut remonter
automatiquement un `$match` avant un `$group` (ou d'autres stages) tant que le filtre porte sur un
champ qui existe **déjà, sans transformation**, dans les documents d'entrée — y compris un champ
de regroupement recopié tel quel dans l'`_id` d'un `$group`. Il ne peut en revanche jamais
remonter un `$match` qui porte sur une valeur **calculée** par un accumulateur (`$sum`, `$avg`,
`$count`…), puisque cette valeur n'existe qu'une fois le regroupement terminé. Autrement dit :
écrire `$match` en premier reste la meilleure pratique par défaut (lisibilité, garantie de
performance), mais ce n'est **pas toujours nécessaire** pour les filtres sur champs bruts — c'est
en revanche **strictement obligatoire** dès que le filtre porte sur un résultat agrégé.*

Test avec un troisième pipeline — `$match` après un `$project` qui supprime le champ filtré :
```js
db.trips.explain("executionStats").aggregate([
  { $project: { usertype: 0 } },
  { $match: { usertype: "Subscriber" } }
])
```
Résultat : `MongoServerError` / le champ `usertype` n'existe plus au moment du `$match` — soit une
erreur de comparaison, soit (selon la version) un résultat vide, puisque le champ a été
explicitement supprimé avant. L'optimiseur ne remonte **pas** le `$match` ici : contrairement au
cas Q22 (où `usertype` restait présent, juste renommé/copié dans `_id.u`), un `$project: {champ:
0}` **détruit l'information** — l'optimiseur ne peut réordonner que des opérations dont il peut
prouver l'équivalence logique, jamais inventer une donnée qu'un stage précédent a effacée. Ça
délimite la frontière exacte : l'optimiseur raisonne sur la **présence/traçabilité** des champs à
travers le pipeline, pas sur une réécriture arbitraire de la logique métier.

**R3. Le chiffre unique, et son coût.**

(a) *"La durée moyenne d'un trajet Citi Bike sur ce jeu est de 762 secondes (~12,7 min) pour les
abonnés (`Subscriber`, n=7 998) et de 1 718 secondes (~28,6 min) pour les usagers occasionnels
(`Customer`, n=1 948), en excluant 54 trajets (0,54 % du jeu) dont la durée dépasse 3 heures,
considérés comme des anomalies opérationnelles (vélo non redéposé) plutôt que des trajets
réels."*

(b) Médiane sur le jeu non filtré :
```js
db.trips.aggregate([{ $group: { _id: null, med: { $median: { input: "$tripduration", method: "approximate" } } } }])
```
```
med: 578.94 s (~9,65 min)
```
Pour comparer sur la même base (jeu entier, sans distinction `usertype`) :
```
moyenne globale brute (Q13, non filtrée)     : 1129.99 s
moyenne globale filtrée (Q21, ≤ 3h)          :  858.03 s
médiane (non filtrée)                        :  578.94 s
```
La **médiane est la plus robuste des trois**, et de loin : elle est même inférieure à la moyenne
*filtrée*, alors qu'elle est calculée sur le jeu **brut** (orphelins inclus). C'est la signature
d'une distribution très étalée à droite (beaucoup de trajets courts, une longue traîne de trajets
très longs) : une moyenne, même après avoir retiré les 54 pires cas, reste tirée vers le haut par
le reste de la traîne (tous les trajets de quelques dizaines de minutes à 3h) — la médiane, elle,
ignore structurellement la traîne quelle que soit sa longueur, puisqu'elle ne dépend que du rang
central, pas des valeurs extrêmes.

(c) Une réponse sans précaution ne serait pas seulement imprécise, elle serait **malhonnête** :
donner "2 610 secondes" pour `Customer` sans préciser qu'un tiers de cette valeur vient de 41
trajets aberrants sur 1 989, c'est laisser croire à un usage "type" qui ne reflète la réalité
d'aucun usager normal — la direction prendrait des décisions (tarification, capacité de flotte)
sur un chiffre structurellement gonflé par un artefact opérationnel non signalé.

**R4. `explain()` ou profiler ?**
Ce qu'on a concrètement obtenu : `explain()` (Q31) donne un diagnostic **profond mais ponctuel**
sur **une requête qu'on choisit d'avance** — stage, index utilisé, ratio examinés/retournés.
Le profiler (Q32) donne une vue **large mais historique** — **toutes** les opérations qui ont
réellement tourné sur la base pendant une fenêtre de temps, sans qu'on ait eu besoin de deviner
laquelle observer.

Incident "l'appli est lente depuis 14h" — ordre de mobilisation et pourquoi :
1. **Logs applicatifs** — gratuit, immédiat, permet d'éliminer en premier les causes évidentes
   (erreurs réseau, timeouts, déploiement récent) sans toucher à la base.
2. **`mongostat`** — coût quasi nul, vue temps réel (CPU, IOPS, connexions, réplication) : permet
   de savoir en quelques secondes si le symptôme est **côté base** du tout, ou ailleurs
   (application, réseau).
3. **Profiler** — une fois la base identifiée comme suspecte, on l'active (niveau 1, `slowms`
   adapté) pour **capturer** les opérations lentes réelles depuis 14h, sans avoir à deviner quelle
   requête regarder : ça a un coût (écriture continue dans `system.profile`), donc on ne l'active
   qu'après avoir localisé le problème.
4. **`explain()`** — en dernier, une fois qu'une ou plusieurs requêtes coupables sont identifiées
   via le profiler, pour comprendre **pourquoi** elles sont lentes (plan d'exécution, index
   manquant) et décider du correctif.

L'ordre suit le coût croissant et la précision croissante : on élimine large et pas cher d'abord,
on cible précis et coûteux en dernier.
