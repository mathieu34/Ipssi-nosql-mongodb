# TP Jour 3 — Réplication & haute disponibilité

## Prérequis

- Docker Desktop démarré, ~3 Go de RAM allouables.
- Le port **27017** libre : la stack du Jour 1 l'occupe, il faut l'arrêter avant de démarrer ce TP.
  ```powershell
  docker stop mongo-ipssi mongo-express-ipssi
  ```
- Python 3.10+ avec `pymongo>=4.6` :
  ```powershell
  pip install "pymongo>=4.6"
  ```

## Démarrer le Replica Set

```powershell
docker compose -f docker-compose.rs.yml up -d
docker compose -f docker-compose.rs.yml ps          # 3 conteneurs "running"
Get-Content init-rs.js -Raw | docker exec -i mongo1 mongosh   # initialise rs0 (mongo1 = primary)
```

Le projet Compose est nommé `rslab` (voir `name:` dans le fichier) : le réseau Docker
créé s'appelle donc `rslab_default`, quel que soit le nom du dossier.

## Charger les données

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/neelabalan/mongodb-sample-dataset/main/sample_training/zips.json" -OutFile "zips.json"
docker cp zips.json mongo1:/tmp/zips.json
docker exec mongo1 mongoimport --db census --collection zips --drop --file /tmp/zips.json
```

## Fichiers fournis

- `docker-compose.rs.yml` — 3 nœuds `mongod --replSet rs0` (mongo1/27017, mongo2/27018, mongo3/27019 côté hôte).
- `init-rs.js` — configuration initiale du replica set (mongo1 prioritaire).
- `watch_primary.py` — observe le cluster et horodate chaque changement de PRIMARY (Partie 3). Attend un ENTREE avant de démarrer son chrono, pour mesurer précisément un délai de bascule sur deux terminaux.

## Fichiers produits (livrables)

- `reponses_jour3.md` — Q1→Q28 (Parties 0 à 4 : montage du Replica Set, oplog, lecture/écriture, failover, write/read concern), commande + sortie observée.
- `failover.md` — tableau des mesures de bascule (Partie 3).

Ce TP s'arrête à la fin de la Partie 4 : la Partie 5 (résilience applicative avec `writer.py`), la Partie 6 (réflexion R1→R4) et les bonus n'ont pas été traités.

## Fin de séance

```powershell
docker compose -f docker-compose.rs.yml down -v
```
