# TP Jour 1 — NoSQL & MongoDB

## Prérequis

- Docker Desktop installé et démarré

## 1. Lancer l'infrastructure

```powershell
docker compose up -d
docker compose ps   # les 2 conteneurs doivent être "running"
```

Ça démarre :
- **mongo** (MongoDB 7.0) sur `localhost:27017`, identifiants `admin` / `ipssi2025`
- **mongo-express** (interface web d'admin) sur [http://localhost:8081](http://localhost:8081), identifiants `admin` / `pass`

## 2. Récupérer le jeu de données

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/mongodb/docs-assets/primer-dataset/primer-dataset.json" -OutFile "primer-dataset.json"
```

## 3. Importer dans MongoDB

Copier le fichier dans le conteneur, puis l'importer dans la base `nyc`, collection `restaurants` :

```powershell
docker cp primer-dataset.json mongo-ipssi:/tmp/primer-dataset.json
docker exec mongo-ipssi mongoimport --username admin --password ipssi2025 --authenticationDatabase admin --db nyc --collection restaurants --drop --file /tmp/primer-dataset.json
```

## 4. Se connecter

**Shell (mongosh)** :
```powershell
docker exec -it mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin nyc
```

**Interface graphique** : [http://localhost:8081](http://localhost:8081) (mongo-express)

**Alternative — MongoDB Compass** avec l'URI :
```
mongodb://admin:ipssi2025@localhost:27017/?authSource=admin
```

Vérification rapide une fois connecté :
```js
db.restaurants.countDocuments({})   // doit renvoyer 25359
```

## 5. Lancer le script de rapport

```powershell
docker cp rapport.js mongo-ipssi:/tmp/rapport.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin nyc /tmp/rapport.js
```

## Fichiers du dépôt

- `docker-compose.yml` — infrastructure MongoDB + mongo-express
- `rapport.js` — script de rapport statistique (Partie 5)
- `reponses_jour1.md` — réponses détaillées du TP (commandes + résultats)
- `capture_express.png` — capture d'écran de mongo-express
