# TP Jour 4 — Sharding appliqué, Performances & Diagnostic

## Prérequis

- Docker Desktop démarré, ~4 Go de RAM allouables (4 conteneurs pour le cluster shardé de la
  Partie A + 1 conteneur pour la Partie B).
- Arrêter les stacks des jours précédents si elles tournent encore :
  ```powershell
  docker compose -f ../j3/docker-compose.rs.yml down -v
  ```
  Le port **27017** doit être libre pour le conteneur `mongo-j4` de la Partie B.

## Partie A — Sharding appliqué

### Monter le cluster

```powershell
docker compose -f docker-compose.shard.yml up -d
docker exec cfg1 mongosh --quiet --eval 'rs.initiate({_id:"cfgRS",configsvr:true,members:[{_id:0,host:"cfg1:27017"}]})'
docker exec shardA mongosh --quiet --eval 'rs.initiate({_id:"shardA",members:[{_id:0,host:"shardA:27017"}]})'
docker exec shardB mongosh --quiet --eval 'rs.initiate({_id:"shardB",members:[{_id:0,host:"shardB:27017"}]})'
docker exec mongos mongosh --quiet --eval 'sh.addShard("shardA/shardA:27017"); sh.addShard("shardB/shardB:27017")'
docker exec mongos mongosh --quiet config --eval 'db.settings.updateOne({_id:"chunksize"},{$set:{value:1}},{upsert:true})'
```

Ce sont les 5 étapes que `setup-shard.sh` automatise sous Linux/macOS/WSL. **Sous Windows sans
WSL, ce script ne s'exécute pas** (pas d'interpréteur bash) — c'est pourquoi il est fourni ici en
version **texte à trou** commentée : il sert de support de compréhension pour répondre à la Q1
(rôle de chaque conteneur), pas de script à lancer tel quel. Les commandes PowerShell ci-dessus
sont celles réellement exécutées, en guillemets simples pour éviter les pièges d'échappement de
PowerShell avec les binaires natifs (`$set` interpolé, guillemets doubles avalés par
`CommandLineToArgvW`).

4 conteneurs, publiés sur les ports **27119 → 27122** (cfg1, shardA, shardB, mongos dans cet
ordre) — aucun conflit avec le port 27017 de la Partie B.

### Charger les données

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/neelabalan/mongodb-sample-dataset/main/sample_training/zips.json" -OutFile "zips.json"
docker cp zips.json mongos:/tmp/zips.json
docker exec mongos mongoimport --db census --collection zips --drop --file /tmp/zips.json
```

Puis, depuis `mongosh` connecté à `mongos` (`docker exec -it mongos mongosh`) :
```js
use census
sh.enableSharding("census")
db.zips.createIndex({ state: 1 })
sh.shardCollection("census.zips", { state: 1 })
```

Le détail des mesures (Q2 à Q9 : distribution, frontières de chunks, targeted vs broadcast, clé
hachée) est dans `reponses_jour4.md` et `bench_shard.md`.

**Laisser ce cluster allumé pendant toute la Partie B** : la vérification de la Q5(d) (purge des
documents orphelins) dépend d'un délai interne à MongoDB (`orphanCleanupDelaySecs`, 15 min par
défaut) qui ne s'écoule que cluster en marche.

## Partie B — Performances & diagnostic

### Charger les données

```powershell
docker compose up -d          # démarre mongo-j4 (port 27017)
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/neelabalan/mongodb-sample-dataset/main/sample_training/trips.json" -OutFile "trips.json"
docker cp trips.json mongo-j4:/tmp/trips.json
docker exec mongo-j4 mongoimport -u admin -p ipssi2025 --authenticationDatabase admin `
  --db citibike --collection trips --drop --file /tmp/trips.json
```

### Se connecter

```powershell
docker exec -it mongo-j4 mongosh -u admin -p ipssi2025 --authenticationDatabase admin citibike
```

Vérification rapide :
```js
db.trips.countDocuments({})   // doit renvoyer 10000
```

### Rejouer les pipelines et les requêtes géospatiales

```powershell
docker cp pipelines.js mongo-j4:/tmp/pipelines.js
docker exec -i mongo-j4 mongosh -u admin -p ipssi2025 --authenticationDatabase admin citibike /tmp/pipelines.js

docker cp geo.js mongo-j4:/tmp/geo.js
docker exec -i mongo-j4 mongosh -u admin -p ipssi2025 --authenticationDatabase admin citibike /tmp/geo.js
```

## Fichiers fournis

- `docker-compose.shard.yml` — cluster shardé (cfg1/shardA/shardB/mongos), mongo:7.0.
- `docker-compose.yml` — instance standalone `mongo-j4` (Partie B), mongo:7.0.

## Fichiers produits (livrables)

- `reponses_jour4.md` — Q1→Q34, R1→R4, Parties A/B/C, commande + résultat exact pour chaque
  question.
- `bench_shard.md` — distributions `state`/hachée avant-après, frontières de chunks, les 3
  `explain()` targeted vs broadcast, tableau de décision Q9(b).
- `pipelines.js` — pipelines des Parties B1 à B3, exécutable via `mongosh ... < pipelines.js`
  (testé).
- `geo.js` — requêtes géospatiales de la Partie B4, exécutable de la même façon (testé).
- `diagnostic.md` — tableaux `explain()` avant/après index, extraits `system.profile`.

Le "Pour aller plus loin" (GridFS, `$facet`, index partiel/TTL, time-series, démo sauvegarde/RBAC)
n'a pas été traité.

## Fin de séance

```powershell
docker compose down -v
docker compose -f docker-compose.shard.yml down -v
```
