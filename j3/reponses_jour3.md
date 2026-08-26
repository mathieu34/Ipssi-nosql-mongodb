# Réponses — TP Jour 3 : Réplication & haute disponibilité

## Partie 0 — Monter le Replica Set

### Q1

**Commande :**
```powershell
docker exec mongo1 mongosh --quiet --eval 'printjson(db.hello())'
docker exec mongo1 mongosh --quiet --eval 'try { db.test.insertOne({a:1}) } catch(e) { printjson(e) }'
```

**Sortie observée :** 

- `isWritablePrimary` vaut `false`.
- Le champ `primary` est **absent** de la réponse (pas de PRIMARY élu).
- `info` vaut `'Does not have a valid replica set config'`.
- `codeName` de l'erreur d'écriture est NotWritablePrimary.

**Conclusion :** un mongod lancé avec `--replSet` mais non initialisé n'est **ni primary ni secondary** — il connaît le nom du replica set auquel il doit appartenir (`isreplicaset: true`) mais n'a reçu aucune configuration de membres, donc aucune élection n'a eu lieu. Il refuse toute écriture faute de PRIMARY, mais n'est pas non plus un secondary fonctionnel (il ne réplique rien).

### Q2

**Commande :**
```powershell
docker exec mongo1 mongosh --quiet --eval "rs.status().members.map(m => m.name + ' ' + m.stateStr).join(' | ')"
```

**Sortie observée :**
```
mongo1:27017 PRIMARY | mongo2:27017 SECONDARY | mongo3:27017 SECONDARY
```

**Nœud PRIMARY :** `mongo1:27017`.

**Explication (`init-rs.js`) :** c'est le champ `priority` qui explique ce choix. Dans la configuration des membres, `mongo1` a `priority: 2` alors que `mongo2` et `mongo3` ont `priority: 1`. À priorité plus élevée, un membre est favorisé lors de l'élection initiale (et lors d'un futur *priority takeover*, cf. Q19) : c'est donc `mongo1` qui est élu PRIMARY.

### Q3

**Commande (depuis le primary, `docker exec -it mongo1 mongosh census`) :**
```js
db.zips.countDocuments({})
db.zips.distinct("state").length
db.zips.aggregate([{ $group: { _id: null, total: { $sum: "$pop" } } }])
```

**Sortie observée :**
```
> db.zips.countDocuments({})
29470

> db.zips.distinct("state").length
51

> db.zips.aggregate([{ $group: { _id: null, total: { $sum: "$pop" } } }])
[ { _id: null, total: 248709873 } ]
```

- Nombre de documents : **29 470**.
- États distincts : **51**.
- Population totale : **248 709 873** habitants.

**Le nombre d'États surprend-il ?** Oui si on s'attend à 50 — mais c'est normal : le champ `state` du dataset contient les codes à 2 lettres de tous les territoires couverts par les codes postaux américains, pas seulement les 50 États fédérés au sens strict. Le 51ᵉ code est **DC** (District of Columbia, où se trouve Washington), qui possède ses propres codes postaux mais n'est pas un État. C'est donc une réalité du recensement US, pas une erreur de données.

### Q4

**Commande :**
```js
db.zips.distinct("zip").length
db.zips.aggregate([{ $group: { _id: "$zip", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }])
db.zips.createIndex({ zip: 1 }, { unique: true })
```

**Sortie observée :**
```
> db.zips.distinct("zip").length
29467

> db.zips.aggregate([{ $group: { _id: "$zip", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }])
[
  { _id: '42223', count: 2 },
  { _id: '32350', count: 2 },
  { _id: '63673', count: 2 }
]

> db.zips.createIndex({ zip: 1 }, { unique: true })
MongoServerError: Index build failed ... E11000 duplicate key error collection: census.zips index: zip_1 dup key: { zip: "32350" }
codeName: 'DuplicateKey', code: 11000
```

**`zip` est-il une clé naturelle ?** Non, réfuté : 29 467 valeurs distinctes pour 29 470 documents, donc **3 doublons** exacts (`42223`, `32350`, `63673`, chacun 2 fois). L'index unique échoue avec `E11000 duplicate key error` (`codeName: DuplicateKey`) dès la première valeur en doublon rencontrée pendant la construction. Conclusion : on ne peut pas créer d'index unique sur `zip` sans d'abord dédupliquer les données (le dataset contient probablement des codes postaux réutilisés pour des zones différentes, ou des doublons d'import).

### Q5

**Commande :**
```js
db.zips.countDocuments({ pop: 0 })
```

**Sortie observée :**
```
> db.zips.countDocuments({ pop: 0 })
67
```

**67 documents** ont une population de 0. Ce n'est pas forcément une erreur de saisie : un code postal `pop: 0` peut être une réalité métier — un ZIP dédié à une entreprise, une administration, une boîte postale (PO Box), une zone non résidentielle (aéroport, base militaire, parc industriel) — qui existe pour le routage postal sans population qui y habite réellement.

## Partie 1 — Anatomie du Replica Set et de l'oplog

### Q6

**Commande :**
```powershell
docker exec mongo1 mongosh --quiet --eval "printjson(rs.status())"
docker exec mongo1 mongosh --quiet --eval "printjson(rs.conf().settings)"
```

**Sortie observée :**
```
{
  chainingAllowed: true,
  heartbeatIntervalMillis: 2000,
  heartbeatTimeoutSecs: 10,
  electionTimeoutMillis: 10000,
  catchUpTimeoutMillis: -1,
  catchUpTakeoverDelayMillis: 30000,
  ...
}
```

`electionTimeoutMillis = 10000`, `heartbeatIntervalMillis = 2000` (valeurs par défaut, non modifiées dans `init-rs.js`).

**En français** : « un secondary déclare le primary mort au bout de **10 secondes** sans réponse, alors qu'il l'interroge toutes les **2 secondes**. »

### Q7

**Commande :**
```js
rs.status().members.map(m => ({name:m.name, stateStr:m.stateStr, health:m.health, lastHeartbeat:m.lastHeartbeat}))
```

**Sortie observée :**
```
[
  { name: 'mongo1:27017', stateStr: 'PRIMARY',   health: 1, lastHeartbeat: undefined },
  { name: 'mongo2:27017', stateStr: 'SECONDARY', health: 1, lastHeartbeat: ISODate('2026-08-26T13:07:48.072Z') },
  { name: 'mongo3:27017', stateStr: 'SECONDARY', health: 1, lastHeartbeat: ISODate('2026-08-26T13:07:48.072Z') }
]
```

Note : `lastHeartbeat` du membre `mongo1` (celui qu'on interroge, ici lui-même le PRIMARY) est `undefined` — un nœud ne s'envoie pas de heartbeat à lui-même, seuls les heartbeats reçus des *autres* membres sont horodatés.

Le champ qui indiquerait un nœud injoignable en production est **`health`** : il passe à `0` dès que le nœud ne répond plus aux heartbeats (couplé à un `stateStr` qui devient `(not reachable/healthy)`).

### Q8

**Commande :**
```powershell
docker exec mongo1 mongosh --quiet --eval "const l = db.getSiblingDB('local'); print('maxSize:', l.oplog.rs.stats().maxSize); print('total:', l.oplog.rs.countDocuments({}))"
```

**Sortie observée :**
```
maxSize: 134217728
total: 29943
```

134 217 728 octets = **128 Mio** exactement, fixé explicitement par `--oplogSize 128` dans la ligne `command:` de `docker-compose.rs.yml`. Sans ce paramètre, MongoDB aurait calculé une taille par défaut à partir de l'espace disque disponible (~5 % de l'espace libre, avec un plancher/plafond selon la version) — une valeur qui aurait varié d'une machine à l'autre.

### Q9

**Commande :**
```js
db.getSiblingDB("local").oplog.rs.countDocuments({ op: "i", ns: "census.zips" })
```

**Sortie observée :**
```
29470
```

Ce nombre est **strictement égal** au nombre de documents importés par `mongoimport` (29 470). Cela démontre que la réplication est **unitaire, document par document** : même si `mongoimport` envoie les documents au primary par lots (batches) de plusieurs milliers, l'oplog contient une entrée d'insertion par document, jamais une entrée "lot". Chaque opération doit pouvoir être rejouée indépendamment par un secondary.

### Q10

**Commande :**
```js
db.getSiblingDB("local").oplog.rs.findOne({ op: "i", ns: "census.zips" })
```

**Sortie observée :**
```js
{
  op: 'i',
  ns: 'census.zips',
  o: { _id: ObjectId('5c8eccc1caa187d17ca6ed1d'), city: 'BREMEN', zip: '35033', loc: { y: 33.973664, x: 87.004281 }, pop: 3448, state: 'AL' },
  o2: { _id: ObjectId('5c8eccc1caa187d17ca6ed1d') },
  ts: Timestamp({ t: 1787747588, i: 2 }),
  wall: ISODate('2026-08-26T12:33:08.344Z'),
  ...
}
```

- `op: 'i'` → type insertion.
- `ns: 'census.zips'` → namespace cible.
- `o` → le **document complet** tel qu'il doit être inséré.
- `ts` → horodatage logique interne (Timestamp BSON, utilisé pour l'ordre et la reprise de synchronisation).
- `wall` → horodatage humain (date murale).

**Idempotence** : `o` contient le document entier, avec son `_id` déjà fixé. Rejouer cette entrée d'oplog une deuxième fois revient à réinsérer *exactement* le même document avec le même `_id` — MongoDB rejette la deuxième tentative comme un doublon de clé, donc l'état final de la collection est inchangé après 1 ou 2 exécutions. C'est ça, l'idempotence.

### Q11

**Commande :**
```js
db.zips.updateMany({ state: "TX" }, { $inc: { pop: 1 } })
db.getSiblingDB("local").oplog.rs.findOne({ op: "u", ns: "census.zips" })
```

**Sortie observée :**
```
> db.zips.updateMany({ state: "TX" }, { $inc: { pop: 1 } })
{ acknowledged: true, matchedCount: 1676, modifiedCount: 1676, upsertedCount: 0 }

> db.getSiblingDB("local").oplog.rs.findOne({ op: "u", ns: "census.zips" })
{
  op: 'u',
  ns: 'census.zips',
  o: { '$v': 2, diff: { u: { pop: 16863 } } },
  o2: { _id: ObjectId('5c8eccc1caa187d17ca74cf8') },
  ts: Timestamp({ t: 1787749691, i: 1 }),
  wall: ISODate('2026-08-26T13:08:11.257Z')
}
```

**Pas de `$inc` dans le champ `o`.** À la place, on trouve un `diff` avec la **valeur finale déjà calculée** (`pop: 16863`, c'est-à-dire l'ancienne valeur + 1). MongoDB ne réplique jamais l'opérateur `$inc` tel quel : il calcule le résultat sur le primary et enregistre ce résultat concret dans l'oplog.

**Pourquoi** : exactement pour la même raison qu'en Q10 — l'idempotence. Si l'oplog stockait littéralement `$inc: {pop: 1}`, rejouer l'entrée deux fois incrémenterait deux fois (résultat différent selon le nombre de replays). En stockant la valeur finale (`pop: 16863`), rejouer l'entrée 1 ou 10 fois donne toujours le même état final.

### Q12

**Commande :**
```js
db.getSiblingDB("local").oplog.rs.stats()
```

**Sortie observée :**
```
size: 12080371
count: 31644
maxSize: 134217728
```

**(a) Taille moyenne d'une opération** = `size / count` = 12 080 371 / 31 644 ≈ **381,8 octets/op**.

**(b) Capacité de l'oplog** = `maxSize / taille_moyenne` = 134 217 728 / 381,8 ≈ **351 600 opérations** avant que les plus anciennes ne soient écrasées.

**(c) Fenêtre de réplication à 300 écritures/s** = 351 600 / 300 ≈ 1172 s ≈ **0,33 heure** (~20 minutes).

Un secondary qui tombe le vendredi à 18 h ne peut **pas** rattraper le lundi à 9 h : l'écart (63 heures) dépasse très largement la fenêtre de réplication (20 minutes). L'oplog aura été écrasé plusieurs centaines de fois entre-temps. Il ne pourra pas reprendre par simple rejeu incrémental de l'oplog : MongoDB devra déclencher une **resynchronisation initiale complète** (initial sync : copie intégrale des données depuis un autre membre), coûteuse en temps et en bande passante.

## Partie 2 — Lire et écrire dans un Replica Set

### Q13

**Commande :**
```powershell
docker exec mongo2 mongosh --quiet census --eval "print(db.zips.countDocuments({}))"
```

**Sortie observée :**
```
29470
```

Oui, on obtient bien les données en se connectant directement à `mongo2` (un secondary). Historiquement, il fallait appeler `rs.secondaryOk()` (anciennement `rs.slaveOk()`) pour autoriser explicitement les lectures sur un secondary, sinon le shell refusait par défaut. Depuis les versions récentes de `mongosh`, quand on se connecte **directement** à un membre secondary (et non via la découverte complète du replica set), le shell positionne automatiquement le mode de lecture sur ce nœud unique — l'équivalent d'un `readPreference` qui autorise la lecture locale. L'ancienne commande n'est donc plus nécessaire dans ce cas précis de connexion directe.

### Q14

**Commande :**
```powershell
docker exec mongo2 mongosh --quiet census --eval "try { db.zips.insertOne({ test: 1 }) } catch(e) { printjson(e) }"
```

**Sortie observée :**
```
codeName: 'NotWritablePrimary'
code: 10107
errmsg: 'not primary'
```

MongoDB refuse l'écriture alors qu'il autorise la lecture parce que **toutes les écritures doivent transiter par le PRIMARY** (règle absolue de la réplication, rappelée dès la section 0.4 du sujet) : c'est le seul nœud dont les modifications sont ensuite propagées via l'oplog vers les secondaries. Autoriser l'écriture directe sur un secondary casserait l'ordre total des opérations et la cohérence du replica set. La lecture, elle, ne modifie rien : elle est donc tolérée localement, avec le risque du staleness vu en Q16.

### Q15

**Commande :**
```powershell
docker exec mongo1 mongosh --quiet --eval "rs.printSecondaryReplicationInfo()"

# puis, insertion de 1000 documents d'un coup dans census.charge :
docker exec mongo1 mongosh --quiet census --eval "const docs = []; for (let i = 0; i < 1000; i++) { docs.push({ n: i }); } printjson(db.charge.insertMany(docs))"

docker exec mongo1 mongosh --quiet --eval "rs.printSecondaryReplicationInfo()"
```

**Sortie observée (avant) :**
```
source: mongo2:27017 { syncedTo: '...13:09:38...', replLag: '0 secs (0 hrs) behind the primary ' }
source: mongo3:27017 { syncedTo: '...13:09:38...', replLag: '0 secs (0 hrs) behind the primary ' }
```

**Sortie observée (après 1000 inserts dans `census.charge`) :**
```
source: mongo2:27017 { syncedTo: '...13:09:47...', replLag: '0 secs (0 hrs) behind the primary ' }
source: mongo3:27017 { syncedTo: '...13:09:47...', replLag: '0 secs (0 hrs) behind the primary ' }
```

Le retard affiché reste à `0 secs` dans les deux cas (granularité à la seconde de cette commande, et charge très faible sur un cluster local en Docker sur la même machine) — mais on observe que `syncedTo` **avance bien** de 13:09:38 à 13:09:47, preuve que les secondaries ont effectivement rejoué les 1000 nouvelles opérations. Sur une machine plus chargée ou avec un réseau plus lent, ce retard ne serait pas nul : la réplication MongoDB est **asynchrone** — le primary confirme l'écriture (avec `w:1`) avant même que les secondaries l'aient reçue, ils rattrapent ensuite en arrière-plan à leur propre rythme.

### Q16

**Commande :**
```js
db.getMongo().setReadPref("primary");   db.zips.countDocuments({ state: "NY" })
db.getMongo().setReadPref("secondary"); db.zips.countDocuments({ state: "NY" })
```

**Sortie observée :**
```
primary:   1596
secondary: 1596
```

Résultat **identique** ici (cluster au repos, pas d'écriture concurrente pendant la lecture, réplication instantanée en local).

- **Cas où lire sur un secondary est acceptable** : un dashboard analytique ou un rapport de reporting interne (comme cette base census.zips, en gros statique) qui tolère quelques centaines de millisecondes de retard — on décharge le primary sans risque métier réel.
- **Cas dangereux (stale)** : afficher le solde d'un compte bancaire ou le stock disponible juste après une écriture (paiement, achat) — si l'utilisateur relit immédiatement sur un secondary en retard, il peut voir une valeur **périmée** (stale) qui ne reflète pas l'écriture qu'il vient de faire, avec un risque de double-achat ou de confusion.

## Partie 3 — Failover

### Q17

**Commande (2 terminaux, watcher avec pause ENTREE) :**
```powershell
# Terminal 1 :
python watch_primary.py localhost 27018
# affiche "primary actuel : mongo1:27017", puis ENTREE

# Terminal 2, immediatement apres l'ENTREE :
docker stop mongo1
```

**Sortie observée (Terminal 1) :**
```
[watch_primary] chronometre demarre (t+0.00s) - Ctrl+C pour arreter
t+   1.52s  [15:10:50.52]  primary -> mongo2:27017
```

**Délai mesuré : 1,52 s.** Nœud élu : **mongo2**.

Sur `SIGTERM`, `mongod` primary tente un *stepdown* contrôlé (il notifie les secondaries avant de céder son rôle, au lieu de les laisser découvrir la panne tout seuls). Quand un secondary est déjà à jour — cas d'un cluster au repos comme ici — ce stepdown et l'élection qui suit sont quasi instantanés.

### Q18

**Commande :**
```powershell
docker exec mongo2 mongosh --quiet --eval "printjson(rs.status().members.map(m => ({name:m.name, stateStr:m.stateStr, health:m.health})))"
```

**Sortie observée (pendant que mongo1 est arrêté) :**
```js
[
  { name: 'mongo1:27017', stateStr: '(not reachable/healthy)', health: 0 },
  { name: 'mongo2:27017', stateStr: 'PRIMARY',                 health: 1 },
  { name: 'mongo3:27017', stateStr: 'SECONDARY',                health: 1 }
]
```

`mongo1` a `stateStr: '(not reachable/healthy)'` et `health: 0` — c'est ainsi qu'un nœud injoignable se signale dans `rs.status()`.

### Q19

**Commande (2 terminaux, watcher avec pause ENTREE) :**
```powershell
# Terminal 1 :
python watch_primary.py localhost 27018
# affiche "primary actuel : mongo2:27017", puis ENTREE

# Terminal 2, immediatement apres l'ENTREE :
docker start mongo1
docker exec mongo1 mongosh --quiet --eval "print(db.hello().secondary)"
docker exec mongo1 mongosh --quiet --eval "print('priority mongo1:', rs.conf().members[0].priority)"
```

**Sortie observée (Terminal 1) :**
```
[watch_primary] chronometre demarre (t+0.00s) - Ctrl+C pour arreter
t+  12.69s  [15:21:01.11]  primary -> mongo1:27017
```
```
priority mongo1: 2
```

**État immédiat** (juste après `docker start`, avant la ligne ci-dessus) : mongo1 revient en **SECONDARY** (`db.hello().secondary` vaut `true`), pas directement PRIMARY — il doit d'abord rattraper son retard (oplog, cf. Q20) et être détecté sain par les autres membres.

**Redevient-il PRIMARY ?** Oui, au bout de **12,69 secondes**. C'est un *priority takeover* : `rs.conf().members[0].priority` vaut **2** pour mongo1, contre 1 pour mongo2/mongo3. Dès que mongo1 est de nouveau sain et à jour, MongoDB programme automatiquement une nouvelle élection pour lui redonner le rôle PRIMARY, conformément à sa priorité plus élevée.

**Nombre de bascules depuis le `docker stop` (Q17)** : **2** — (1) mongo1 → mongo2 lors de l'arrêt (Q17, 1,52 s), (2) mongo2 → mongo1 lors du retour de mongo1 (priority takeover, ci-dessus, 12,69 s).

**Argument contre les priorités asymétriques en production** : une priorité plus haute déclenche une bascule **supplémentaire** dès que le nœud favori revient, même si le primary en place (mongo2) fonctionnait très bien. Chaque bascule ferme des connexions client et coûte une fenêtre d'indisponibilité en écriture — ici, une seule panne réelle (Q17) a donc coûté **deux** bascules au total, la seconde étant purement cosmétique (aucune panne ne la justifiait, seulement une préférence de configuration). Des priorités égales entre tous les membres évitent ce yo-yo : le cluster resterait sur mongo2 tant que rien ne l'oblige à rebasculer.

### Q20

**Commande :**
```powershell
# sur le nouveau primary (mongo2), avant de redemarrer mongo1 :
docker exec mongo2 mongosh --quiet census --eval "printjson(db.pendant_panne.insertMany([{who:'mongo2', n:1},{who:'mongo2', n:2},{who:'mongo2', n:3}]))"

# puis, apres retour de mongo1, EN CONNEXION DIRECTE dessus (docker exec mongo1, pas d'URI replicaSet) :
docker exec mongo1 mongosh --quiet census --eval "printjson(db.pendant_panne.find({}).toArray())"
```

**Sortie observée (sur mongo1 après son retour) :**
```js
[
  { _id: ObjectId('...9b08'), who: 'mongo2', n: 2 },
  { _id: ObjectId('...9b07'), who: 'mongo2', n: 1 },
  { _id: ObjectId('...9b09'), who: 'mongo2', n: 3 }
]
```

Les 3 documents insérés pendant son absence sont bien présents sur mongo1. Le mécanisme utilisé est la **resynchronisation par l'oplog** (Partie 1) : à son retour, mongo1 se reconnecte au primary, compare son propre oplog à celui du primary et **rejoue** les opérations manquantes (ici 3 entrées `op: "i"` sur `census.pendant_panne`) jusqu'à rattraper l'état courant.

### Q21

**Commande (Terminal 1 : watcher relancé avec pause ENTREE ; Terminal 2 : la panne juste après ENTREE) :**
```powershell
# Terminal 1 :
python watch_primary.py localhost 27018
# affiche "primary actuel : mongo1:27017", puis ENTREE

# Terminal 2, immediatement apres l'ENTREE :
docker kill mongo1
```

**Sortie observée (Terminal 1) :**
```
[watch_primary] observation via localhost:27018
[watch_primary] primary actuel : mongo1:27017
[watch_primary] Appuyez sur ENTREE juste avant de declencher la panne (docker stop/kill/start), puis basculez immediatement sur l'autre terminal pour l'executer...

[watch_primary] chronometre demarre (t+0.00s) - Ctrl+C pour arreter
t+   2.41s  [16:27:27.08]  primary -> AUCUN PRIMARY
t+  11.47s  [16:27:36.14]  primary -> mongo3:27017
```

**Délai mesuré : 11,47 s**, contre **1,52 s** pour l'arrêt propre (Q17) — environ **7,5 fois plus lent**. Nœud élu : **mongo3** (mongo2 et mongo3 ont la même priorité, l'élection entre eux n'est pas déterministe).

**Ce que montre la ligne intermédiaire "AUCUN PRIMARY"** : `docker kill` (SIGKILL, aucun préavis) ne coupe pas la connexion TCP de façon instantanée du point de vue observé — il faut ici 2,41 s avant que mongo2 (le nœud interrogé) ne constate la perte de contact et efface son `primary`. Il ne peut ensuite pas encore élire de nouveau primary : il doit d'abord être **certain** que mongo1 est réellement mort et pas juste temporairement injoignable, ce qui est précisément le rôle du minuteur `electionTimeoutMillis`.

**Lien avec `electionTimeoutMillis` (10 000 ms, Q6)** : le délai total mesuré (11,47 s) est cette fois **légèrement supérieur** à `electionTimeoutMillis`. C'est cohérent : `electionTimeoutMillis` fixe le seuil **minimum** avant qu'un secondary ose déclencher une élection, pas un plafond — il faut ensuite le temps réel de la détection (ici 2,41 s, granularité de sondage comprise) puis celui du round d'élection et de la propagation du résultat aux autres membres (ici ≈9,06 s de plus), ce qui pousse mécaniquement le total un peu au-delà des 10 s nominaux.

**Pourquoi la panne brutale est tellement plus lente que l'arrêt propre** : sur `SIGTERM`, `mongod` primary a le temps de notifier proactivement sa mise hors service (stepDown contrôlé) — les secondaries n'ont pas besoin d'attendre un timeout, ils sont prévenus directement, d'où le 1,52 s mesuré en Q17. Sur `SIGKILL`, le processus meurt sans préavis : les secondaries n'ont **aucun moyen de le savoir** autrement qu'en constatant l'absence de heartbeats pendant `electionTimeoutMillis` — c'est un timeout de détection de panne, pas un temps d'élection en tant que tel.

### Q22

(tableau détaillé dans `failover.md`)

Synthèse rapide : arrêt propre **1,52 s**, panne brutale **11,47 s**, reprise de rôle (priority takeover) **12,69 s** (Q19). Aucune écriture n'a été perdue dans ces deux scénarios (aucune écriture n'était en cours pendant la bascule elle-même). L'écart entre arrêt propre et panne brutale est net (~7,5×) : un arrêt propre notifie les secondaries directement, une panne brutale les force à attendre `electionTimeoutMillis` puis le round d'élection.

### Q23

**Commande :**
```powershell
docker start mongo1                      # remise a 3 noeuds
docker stop mongo2 mongo3                # on coupe 2 noeuds sur 3
docker exec mongo1 mongosh --quiet --eval "print(db.hello().isWritablePrimary, rs.status().myState)"
# 15 secondes plus tard :
docker exec mongo1 mongosh --quiet --eval "print(db.hello().isWritablePrimary, rs.status().myState)"
```

**Sortie observée :**
```
--- immediat ---
true 1
--- 15s plus tard ---
false 2
```

**(a) Explication de l'écart entre les deux relevés** : au moment du `docker stop mongo2 mongo3`, mongo1 se trouvait être le **PRIMARY** (un priority takeover avait eu lieu entre-temps). Immédiatement après avoir isolé les 2 autres nœuds, mongo1 continue à se croire PRIMARY (`myState: 1`) — il n'a pas encore détecté la perte de la majorité. 15 secondes plus tard, mongo1 a dépassé le délai sans pouvoir joindre une majorité de membres votants : il **se rétrograde tout seul** en SECONDARY (`myState: 2`, `isWritablePrimary: false`). C'est un mécanisme de sécurité automatique : un primary qui ne voit plus la majorité du cluster ne peut plus garantir la cohérence de ses écritures, donc il abandonne son rôle.

**(b) Le survivant peut-il encore écrire / lire ?**
```powershell
docker exec mongo1 mongosh --quiet census --eval "try { db.zips.insertOne({test:'quorum'}) } catch(e) { print(e.codeName + ' | ' + e.message) }"
docker exec mongo1 mongosh --quiet census --eval "print(db.zips.countDocuments({}))"
```
```
ecriture -> codeName: NotWritablePrimary | not primary
lecture  -> 29470
```
**Écriture refusée** (`NotWritablePrimary`), **lecture toujours possible** (connexion directe à un secondary, lecture locale non garantie mais fonctionnelle).

**(c) Pourquoi 3 nœuds tolèrent 1 panne mais pas 2, et pourquoi 4 nœuds ne font pas mieux que 3** : une écriture n'est majoritairement confirmée, et une élection n'est valide, que si le nœud qui la porte obtient les votes d'une **majorité stricte** des membres votants (`⌊n/2⌋ + 1`). Pour **n = 3**, la majorité est **2** : perdre 1 nœud laisse encore 2 survivants → majorité atteignable, le cluster continue de fonctionner. Perdre 2 nœuds ne laisse plus qu'1 survivant → majorité (2) inatteignable, plus d'écriture possible (ce qu'on vient de prouver). Pour **n = 4**, la majorité est `⌊4/2⌋+1 = 3` : perdre 2 nœuds ne laisse que 2 survivants sur 4, **en dessous de la majorité (3)** — donc un set de 4 nœuds tolère toujours seulement **1** panne, exactement comme un set de 3, mais avec une machine de plus à payer et à maintenir pour rien. (Cette expérience est refaite explicitement en R1.)

## Partie 4 — Write Concern & Read Concern

### Q24

**Commande :**
```powershell
docker exec mongo1 mongosh --quiet census --eval "printjson(db.demo.insertOne({ a: 1 }, { writeConcern: { w: 1 } })); printjson(db.demo.insertOne({ b: 1 }, { writeConcern: { w: 'majority' } }))"
```

**Sortie observée :** les deux réussissent (`acknowledged: true`, chacun avec son `insertedId`).

**Différence de garantie** : `w: 1` garantit seulement que le **primary** a appliqué l'écriture dans sa mémoire — rien sur les secondaries. `w: "majority"` attend que l'écriture soit répliquée et confirmée par une **majorité** des membres votants avant de répondre au client — c'est une garantie de durabilité bien plus forte face à un failover.

**Scénario de la Partie 3 où `w: 1` aurait pu perdre l'écriture** : en Q21 (panne brutale du primary), si une écriture `w: 1` venait d'être acquittée sur mongo1 juste avant le `docker kill`, mais n'avait pas encore eu le temps d'être répliquée sur mongo2/mongo3, elle disparaît purement et simplement — le nouveau primary élu (mongo3) ne l'a jamais vue. C'est le phénomène de **rollback**.

### Q25

**Commande :**
```powershell
docker exec mongo1 mongosh --quiet census --eval "try { printjson(db.demo.insertOne({ a: 1 }, { writeConcern: { w: 4, wtimeout: 3000 } })) } catch(e) { print('codeName: ' + e.codeName); print('message: ' + e.message) }"
```

**Sortie observée :**
```
codeName: UnsatisfiableWriteConcern
message: Not enough data-bearing nodes
duree: 0.715s
```

MongoDB refuse **immédiatement** (0,7 s, essentiellement le temps de démarrage de `mongosh` — pas 3 s) au lieu d'attendre le `wtimeout`, parce que `w: 4` est **structurellement impossible** à satisfaire sur un replica set qui ne compte que 3 membres porteurs de données : ce n'est pas une question de timing (les nœuds pourraient revenir), c'est une question de configuration (il n'y aura jamais de 4ᵉ nœud). MongoDB détecte ce cas dès la réception de la requête et renvoie `UnsatisfiableWriteConcern` sans même tenter l'écriture en attente. **Note :** en vérifiant `db.demo.find()` après coup, le document `{a:1}` de cette tentative **a quand même été écrit localement** sur le primary — seul l'acquittement du write concern a échoué (cf. Q26).

### Q26

**Commande :**
```powershell
docker stop mongo3
docker exec mongo1 mongosh --quiet census --eval "
try { printjson(db.demo.insertOne({ b: 1 }, { writeConcern: { w: 'majority', wtimeout: 3000 } })) } catch(e) { print('ECHEC majority: ' + e.codeName) }
try { printjson(db.demo.insertOne({ c: 1 }, { writeConcern: { w: 3, wtimeout: 3000 } })) } catch(e) { print('ECHEC w:3: ' + e.codeName) }
print(db.demo.countDocuments({}));
"
```

**Sortie observée :**
```
{ acknowledged: true, insertedId: ObjectId('...e399') }     // w: "majority" -> OK (2/3 = majorite)
ECHEC w:3 -> codeName: WriteConcernFailed                    // w:3 -> timeout (mongo3 down)
count final: 5
```

**(a)** `w: "majority"` **passe** (2 nœuds sur 3 suffisent pour une majorité), `w: 3` **échoue** avec `codeName: WriteConcernFailed` (il exige les 3, mais mongo3 est arrêté).

**(b) Décompte réel** : `db.demo.find({})` montre **5 documents** au total (`a`×2, `b`×2, `c`×1), incluant le document de la tentative `w: 4` de Q25 **et** celui de la tentative `w: 3` en échec ici. Si "échec de write concern" signifiait "rien n'a été écrit", on n'en attendrait que **3** (les deux succès non ambigus de Q24 + celui de Q26 `w:"majority"`). **Écart : +2 documents** — les deux écritures qui ont "échoué" ont malgré tout été appliquées localement sur le primary.

**(c)** Un échec de write concern ne signifie **pas** "l'écriture n'a pas eu lieu" — il signifie seulement "je n'ai pas pu confirmer qu'assez de membres l'ont reçue **dans le délai imparti**". Le document existe déjà sur le primary dès l'appel `insertOne`, indépendamment du sort du write concern. **Conséquence pour une application qui rejoue l'écriture après une erreur de write concern** : elle risque d'insérer le même document **deux fois** (doublon), puisque la première tentative a en réalité réussi côté stockage — c'est un piège classique si l'application traite "erreur de write concern" comme équivalent à "échec total".

### Q27

**Commande :**
```powershell
docker exec mongo1 mongosh --quiet census --eval "printjson(db.demo.insertOne({ d: 1 }, { writeConcern: { w: 'majority', j: true, wtimeout: 3000 } }))"
```

**Sortie observée :** `{ acknowledged: true, insertedId: ObjectId('...303a') }`

`j: true` garantit en plus que l'écriture a été **journalisée sur disque** (write-ahead log de WiredTiger) sur les membres qui l'ont acquittée, pas seulement appliquée en mémoire. Le coût est une **latence supplémentaire** (attendre un flush disque/journal, plus lent qu'une simple écriture mémoire).

**Lien avec la panne totale de courant** : sans `j: true`, une écriture confirmée uniquement en mémoire (non encore journalisée) est **perdue** si les 3 machines s'éteignent brutalement en même temps (pas de fenêtre pour un failover classique — il n'y a plus personne à qui basculer). Avec `j: true`, l'écriture a déjà été rendue durable sur disque avant l'acquittement : au redémarrage, elle sera retrouvée dans le journal, même sans réseau ni réplication.

### Q28

**Commande (pour illustrer, sur le document `c:1` de Q26 dont l'écriture avait "échoué" en `w:3` mais était déjà majoritairement répliquée puisque 2/3 nœuds étaient up) :**
```js
db.demo.find({c:1}).readConcern('local')
db.demo.find({c:1}).readConcern('majority')
```
**Sortie observée :**
```
rs0 [direct: primary] census> db.demo.find({c:1}).readConcern('local')
[ { _id: ObjectId('6a8eff49874f1e3bea31e39a'), c: 1 } ]

rs0 [direct: primary] census> db.demo.find({c:1}).readConcern('majority')
[ { _id: ObjectId('6a8eff49874f1e3bea31e39a'), c: 1 } ]
```
Identique dans les deux cas ici (le document était déjà répliqué sur les 2 nœuds up, donc déjà majoritaire).

**Ce que change `readConcern: "majority"` par rapport à `"local"`, du point de vue utilisateur** : `"local"` renvoie tout ce que **ce nœud précis** a en mémoire à l'instant T, y compris des écritures qui ne sont peut-être confirmées nulle part ailleurs — exactement le cas du document `c:1` de Q26, écrit localement sur le primary malgré l'échec du write concern `w:3`. Si ce primary tombait avant que cette écriture n'atteigne la majorité, elle pourrait être **annulée par rollback**, et un utilisateur qui l'aurait lue en `readConcern: "local"` aurait vu une donnée qui, rétrospectivement, n'a jamais existé pour le reste du cluster. `readConcern: "majority"` ne renvoie que des données déjà confirmées par une majorité de membres — donc garanties de survivre à un futur failover, au prix d'une latence de lecture légèrement supérieure (et d'un léger décalage par rapport aux toutes dernières écritures).


