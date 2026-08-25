# TP Jour 2 — MFlix

## Prérequis

- L'instance MongoDB du Jour 1 doit tourner (`docker compose up -d` depuis `j1/`) — conteneur `mongo-ipssi`.

## 1. Récupérer les données

> Note : l'URL du sujet (`neelabalan/mongodb-sampledataset`) renvoie une 404 — le vrai nom du dépôt est `mongodb-sample-dataset` (avec des tirets).

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/neelabalan/mongodb-sample-dataset/main/sample_mflix/movies.json" -OutFile "movies.json"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/neelabalan/mongodb-sample-dataset/main/sample_mflix/comments.json" -OutFile "comments.json"
```

Vérification (attendu : 23539 et 50304 lignes) :
```powershell
(Get-Content movies.json | Measure-Object -Line).Lines
(Get-Content comments.json | Measure-Object -Line).Lines
```

## 2. Importer dans MongoDB

```powershell
docker cp movies.json mongo-ipssi:/tmp/movies.json
docker cp comments.json mongo-ipssi:/tmp/comments.json
docker exec mongo-ipssi mongoimport -u admin -p ipssi2025 --authenticationDatabase admin --db mflix --collection movies --drop --file /tmp/movies.json
docker exec mongo-ipssi mongoimport -u admin -p ipssi2025 --authenticationDatabase admin --db mflix --collection comments --drop --file /tmp/comments.json
```

## 3. Se connecter (mongosh via Docker)

```powershell
docker exec -it mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin mflix
```

Vérification rapide une fois connecté :
```js
db.movies.countDocuments({})    // doit renvoyer 23539
db.comments.countDocuments({})  // doit renvoyer 50304
```

## Fichiers du dépôt

- `reponses_jour2.md` — réponses détaillées du TP (commandes + résultats)
- `analyses.js` — agrégations de la Partie 3
- `patterns.py` — script PyMongo (Partie 4)
- `transaction.js` — transaction ACID (Partie 5)
- `index_bench.md` — comparatif `explain()` avant/après index (Partie 2)
