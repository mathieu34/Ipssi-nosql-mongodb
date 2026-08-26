# TP Jour 2 — Réponses

## Partie 0 — Contrôle P0

(Détails du téléchargement et de l'import : voir [README.md](README.md))

**Contrôle P0** :
```js
db.movies.countDocuments({})
db.comments.countDocuments({})
```
→ **movies: 23539**, **comments: 50304**

Document `movies` (`findOne()`) — on y repère les tableaux `genres`, `cast`, `directors`, et les sous-documents `imdb`, `tomatoes`, `awards` :
```json
{
  _id: ObjectId('573a1390f29313caabcd446f'),
  title: 'A Corner in Wheat',
  genres: ['Short', 'Drama'],
  cast: ['Frank Powell', 'Grace Henderson', 'James Kirkwood', 'Linda Arvidson'],
  directors: ['D.W. Griffith'],
  runtime: 14,
  num_mflix_comments: 1,
  released: ISODate('1909-12-13T00:00:00.000Z'),
  rated: 'G',
  awards: { wins: 1, nominations: 0, text: '1 win.' },
  year: 1909,
  imdb: { rating: 6.6, votes: 1375, id: 832 },
  countries: ['USA'],
  type: 'movie',
  tomatoes: {
    viewer: { rating: 3.6, numReviews: 109, meter: 73 },
    lastUpdated: ISODate('2015-05-11T18:36:53.000Z')
  }
}
```

Document `comments` (`findOne()`) — le champ `movie_id` est la référence vers `movies._id` *(Reference)* :
```json
{
  _id: ObjectId('5a9427648b0beebeb69579db'),
  name: 'Olly',
  email: "brenock_o'connor@gameofthron.es",
  movie_id: ObjectId('573a1390f29313caabcd413b'),
  text: 'Perspiciatis sit pariatur quas. ...',
  date: ISODate('2005-01-04T13:49:05.000Z')
}
```

## Partie 1 — Modélisation & intégrité référentielle

**Q1.** Total de films, de commentaires, et de genres distincts.
```js
db.movies.countDocuments({})
```
→ **23539**

```js
db.comments.countDocuments({})
```
→ **50304**

```js
db.movies.distinct("genres").length
```
→ **25**

**Q2.** *(Reference)* Commentaires orphelins (dont le `movie_id` ne correspond à aucun film).
```js
db.comments.aggregate([
  {
    $lookup: {
      from: "movies", 
      localField: "movie_id",
      foreignField: "_id",
      as: "film"
    }
  },
  { $match: { film: { $size:0 } } },
  { $count: "orphelins" }
])
```
→ Résultat : 9224

**Q3.** Films distincts référencés par au moins un commentaire.
```js
db.comments.aggregate([
  { $group: { _id: "$movie_id" } },
  { $count: "films" }
])
```
→ Résultat : 14245

**Q4. Computed Pattern — écart.**

(a) Films portant le champ `num_mflix_comments`, et pourcentage sur le total.
```js
db.movies.countDocuments({ num_mflix_comments: { $exists: true } })
```
→ Résultat : 15740 , soit **66.87 %** de **23539** (Q1)

(b) Sur le film **"The Taking of Pelham 1 2 3"** : relever `num_mflix_comments`, puis compter les vrais commentaires.
```js
db.movies.findOne({ title: "The Taking of Pelham 1 2 3" }, { num_mflix_comments: 1, _id: 1 })
```
→ `num_mflix_comments` = 437

```js
db.comments.countDocuments({ movie_id: ObjectId('573a13bff29313caabd5e91e') })
```
→ Résultat : 161

(c) Écart absolu : `437 − 161 = 276`. Écart en % (par rapport à la vraie valeur) : `276 / 161 × 100 ≈ 171.43 %`. Le compteur `num_mflix_comments` **sur-estime** largement — il affiche presque **2.7 fois** le nombre réel de commentaires (437 affichés contre 161 réellement présents).

(d) Un utilisateur voit **« 437 commentaires »** affiché sous la fiche du film (Q4b), mais en cliquant pour les consulter, il n'en trouve réellement que **161** (Q4c) — soit 276 commentaires « fantômes » qui n'existent pas dans la collection `comments`. Ça révèle le risque structurel des **compteurs dénormalisés** (Computed Pattern) : le champ pré-calculé n'est mis à jour que si l'application le fait explicitement à chaque écriture (insertion/suppression de commentaire), et dès qu'une opération oublie de le faire — import initial, suppression manuelle, bug, script de migration — le compteur diverge silencieusement de la réalité, sans qu'aucune contrainte de la base ne le signale ni ne l'empêche.

**Q5.** Films avec `year` stocké comme chaîne (pas entier).
```js
db.movies.countDocuments({ year: { $type: "string" } })
```
→ Résultat : 37

*Pourquoi `{ year: { $gte: 2000 } }` ignore-t-il silencieusement ces documents ?* → En BSON, les opérateurs de comparaison (`$gte`, `$lt`, etc.) respectent un **ordre de tri par type** : MongoDB ne compare une valeur à une autre que si elles sont de types compatibles dans cet ordre (les nombres entre eux, les chaînes entre elles, etc.). Un `year` stocké comme **string** (ex: `"2009"`) n'est jamais comparé aux entiers d'une requête comme `{ $gte: 2000 }`, qui attend implicitement un nombre — ces 37 documents sont donc silencieusement exclus du résultat, sans erreur ni avertissement, exactement comme s'ils n'existaient pas pour cette requête.

**Q6.** Films avec `imdb.rating` égal à la chaîne vide `""`.
```js
db.movies.countDocuments({ "imdb.rating": "" })
```
→ Résultat : 61

*En quoi est-ce un piège pour un calcul de moyenne ?* → Un pipeline `$group` avec `$avg: "$imdb.rating"` ignore silencieusement les valeurs non numériques comme `""` — ces 61 documents ne provoquent aucune erreur, ils sont simplement écartés du calcul sans avertissement. Le piège est donc double : la moyenne obtenue est correcte uniquement sur le sous-ensemble des films ayant une vraie note numérique, mais rien n'indique visuellement que 61 films ont été silencieusement exclus, sauf à comparer explicitement le nombre de documents utilisés dans l'agrégation au total de films — exactement le même type de piège de type que celui de Q5 sur `year`.

## Partie 2 — Indexation & explain()

(Tableau récapitulatif avant/après pour toutes les questions : voir [index_bench.md](index_bench.md))

**Q7. Index multi-clés.** Requête `db.movies.find({ genres: "Film-Noir" })`.

(a) Avant tout index :
```js
db.movies.find({ genres: "Film-Noir" }).explain("executionStats")
```
→ `stage: COLLSCAN`, `totalDocsExamined: 23539`, `nReturned: 105`. Aucun index utilisable, MongoDB parcourt toute la collection.

(b) Création de l'index adapté et re-mesure :
```js
db.movies.createIndex({ genres: 1 })
db.movies.find({ genres: "Film-Noir" }).explain("executionStats")
```
→ `stage: FETCH` (avec `inputStage: IXSCAN`), `totalDocsExamined: 105`, `totalKeysExamined: 105`, `nReturned: 105`. Le nombre de documents lus tombe de 23539 à 105 — MongoDB ne lit plus que les documents réellement pertinents, trouvés via l'index (`genres` est un champ tableau, donc l'index créé est bien un **index multi-clés**, une entrée par valeur du tableau).

**Q8. Index composé & règle ESR.** Films `Drama`, `year >= 2000`, triés par `imdb.rating` décroissant.

(a) Nombre de films correspondant au filtre :
```js
db.movies.countDocuments({ genres: "Drama", year: { $gte: 2000 } })
```
→ **7761**

(b) Règle ESR (**E**quality → **S**ort → **R**ange) : `genres` est un filtre d'**égalité** stricte (`"Drama"`), `imdb.rating` sert au **tri**, `year` est une condition de **plage** (`$gte`). L'ordre correct est donc `genres` → `imdb.rating` → `year` :
```js
db.movies.createIndex({ genres: 1, "imdb.rating": -1, year: 1 })
```
Justification : placer l'égalité en premier permet à MongoDB de réduire immédiatement l'ensemble de documents à un sous-ensemble contigu dans l'index ; placer le tri en second permet de lire cet index déjà dans l'ordre voulu (`imdb.rating` décroissant) sans étape `SORT` en mémoire ; la plage (`year`) est placée en dernier car un `$gte`/`$lte` casse la contiguïté de l'index pour tout champ placé après lui — la mettre avant `imdb.rating` aurait empêché le tri d'être couvert par l'index.

(c) Vérification que le tri est couvert par l'index :
```js
db.movies.find({ genres: "Drama", year: { $gte: 2000 } }).sort({ "imdb.rating": -1 }).explain("executionStats")
```
→ `winningPlan.stage: FETCH`, `inputStage: IXSCAN` — **aucune étape `SORT` en mémoire** dans le plan gagnant, le tri est bien couvert par l'ordre de l'index. `totalDocsExamined: 7761`, `totalKeysExamined: 7834`, `nReturned: 7761`.

**Q9. Index text.**

(a) Films dont le titre contient exactement "Godfather" :
```js
db.movies.countDocuments({ title: { $regex: /Godfather/ } })
```
→ **5**

(b) Création de l'index text et recherche `$text` :
```js
db.movies.createIndex({ title: "text", plot: "text" })
db.movies.countDocuments({ $text: { $search: "godfather" } })
```
→ **12**

(c) Écart : `12 − 5 = 7`. Trois films trouvés uniquement par (b) :
```js
db.movies.find({ $text: { $search: "godfather" } }, { title: 1, plot: 1, _id: 0 })
```
```json
[
  { "title": "Jane Austen's Mafia!", "plot": "Takeoff on the Godfather with the son of a mafia king taking over for his dying father" },
  { "title": "The Nutcracker in 3D", "plot": "... this is a tale of a little girl, whose godfather gives her a special doll one Christmas Eve." },
  { "title": "C(r)ook", "plot": "... The mafia godfather suspects treason." }
]
```
Ils sortent car le mot "godfather" apparaît dans leur **`plot`**, pas dans leur `title` — la requête `$regex` de (a) ne filtrait que sur `title`, tandis que l'index text couvre **les deux champs** (`title` et `plot`) simultanément.

(d) Recherche sur le pluriel :
```js
db.movies.countDocuments({ $text: { $search: "godfathers" } })
```
→ **12**, exactement le même résultat qu'en (b). Ça confirme le **stemming** : `$text` réduit "godfathers" à sa racine ("godfather") avant de chercher, donc singulier et pluriel donnent le même résultat. Un `$regex` sur `/godfathers/` n'aurait trouvé, lui, quasiment aucun résultat (0 ou 1), puisqu'il cherche la chaîne exacte "godfathers" sans aucune notion de racine grammaticale.

(e) Cas où `$regex` reste préférable à `$text` : la recherche d'une **sous-chaîne à l'intérieur d'un mot**, comme un numéro de série, une référence produit ou un fragment de code (ex. chercher "1234" dans "REF-1234-X"). `$text` découpe le contenu en **mots entiers** et ne peut pas retrouver un fragment interne à un token — seul `$regex` (non ancré) peut matcher une sous-chaîne arbitraire, peu importe sa position dans le mot.

**Q10.** Index de `movies` :
```js
db.movies.getIndexes()
```
→ 4 index avant suppression : `_id_`, `genres_1` (Q7), `genres_1_imdb.rating_-1_year_1` (Q8), `title_text_plot_text` (Q9). Le seul **non créé manuellement** est `_id_` — il est généré automatiquement par MongoDB dès la création de la collection, jamais besoin de le recréer.

Suppression de l'index text :
```js
db.movies.dropIndex("title_text_plot_text")
```
→ `{ nIndexesWas: 4, ok: 1 }`. Il ne reste plus que 3 index (`_id_`, `genres_1`, `genres_1_imdb.rating_-1_year_1`).

*Pourquoi un index inutilisé est-il un coût pur ?* → Un index occupe de la RAM en continu (pour rester performant il doit tenir en mémoire) et **ralentit chaque écriture** sur la collection, puisque MongoDB doit le maintenir à jour à chaque `insert`/`update`/`delete` — sans jamais apporter le moindre bénéfice en lecture s'il n'est pas utilisé par le planificateur de requêtes. C'est un coût net, à surveiller via `$indexStats`.

## Partie 3 — Agrégation analytique

(Pipelines complets exécutables : voir [analyses.js](analyses.js))

**Q11.** Top 5 des genres par nombre de films.
```js
db.movies.aggregate([
  { $unwind: "$genres" },
  { $group: { _id: "$genres", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 5 }
])
```
→
| Genre | Films |
|---|---|
| Drama | 13789 |
| Comedy | 7024 |
| Romance | 3665 |
| Crime | 2678 |
| Thriller | 2658 |

**Q12.** Nombre de films par décennie — top 3.
```js
db.movies.aggregate([
  { $match: { year: { $type: "int" } } },
  { $group: { _id: { $subtract: ["$year", { $mod: ["$year", 10] }] }, count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 3 }
])
```
→
| Décennie | Films |
|---|---|
| 2000 | 7749 |
| 2010 | 5972 |
| 1990 | 3773 |

**Q13.** Note IMDB moyenne des films Drama (notes numériques uniquement).
```js
db.movies.aggregate([
  { $match: { genres: "Drama", "imdb.rating": { $type: "number" } } },
  { $group: { _id: null, avgRating: { $avg: "$imdb.rating" }, count: { $sum: 1 } } },
  { $project: { _id: 0, avgRating: { $round: ["$avgRating", 4] }, count: 1 } }
])
```
→ **avgRating: 6.8305**, sur **13751** films comptés (à comparer aux 13789 films Drama de Q11 — l'écart de 38 correspond aux notes non numériques exclues par le `$type: "number"`, cohérent avec le piège identifié en Q6).

**Q14.** Top 3 réalisateurs par nombre de films.
```js
db.movies.aggregate([
  { $unwind: "$directors" },
  { $group: { _id: "$directors", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 3 }
])
```
→
| Réalisateur | Films |
|---|---|
| Woody Allen | 40 |
| John Ford | 35 |
| Takashi Miike | 34 |

**Q15.** *(Reference)* `$lookup` inversé — top 5 des films les plus commentés. Le `$lookup` est nécessaire précisément parce que `comments` et `movies` sont **référencées** (pas imbriquées) : sans lien direct dans le document, il faut une jointure explicite pour retrouver le titre.
```js
db.comments.aggregate([
  { $group: { _id: "$movie_id", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 5 },
  { $lookup: { from: "movies", localField: "_id", foreignField: "_id", as: "movie" } },
  { $unwind: "$movie" },
  { $project: { _id: 0, title: "$movie.title", count: 1 } }
])
```
→
| Titre | Commentaires |
|---|---|
| The Taking of Pelham 1 2 3 | 161 |
| 50 First Dates | 158 |
| Ocean's Eleven | 158 |
| Terminator Salvation | 158 |
| About a Boy | 158 |

(cohérent avec Q4b : "The Taking of Pelham 1 2 3" a bien 161 vrais commentaires, contre 437 affichés par le compteur désynchronisé.)

## Partie 4 — Drivers : PyMongo

(Script complet exécutable : voir [patterns.py](patterns.py). Connexion via un unique `MongoClient` global).

**Q16. Computed Pattern — réconciliation.**

Fonction `q16_reconciliation()` : `comments.aggregate([{ $group: { _id: "$movie_id", count: { $sum: 1 } } }])` chargé dans un dict Python `{movie_id: count}`, puis comparaison avec `num_mflix_comments` pour chaque film portant ce champ.
```
Q16 - films portant le champ : 15740
Q16 - films avec compteur incoherent : 12244
```
→ **12244 films sur 15740** ont un compteur `num_mflix_comments` incohérent avec la réalité, soit **77.79 %** des films portant ce champ — une désynchronisation massive, pas un cas isolé.

**Q17. *(Computed Pattern)* Correction du compteur.**

Fonction `q17_fix_counters()` : `bulk_write` avec une `UpdateOne` par film dont la valeur stockée diffère de la vraie valeur (recalculée depuis le dict de Q16), y compris les films qui n'avaient pas encore le champ.
```
Q17 - modifiedCount : 20043
```
→ **20043** documents modifiés = **12244** compteurs corrigés + **7799** films qui n'avaient pas encore le champ (`23539 − 15740 = 7799`), maintenant tous à jour.

Re-vérification (après relance de `q16_reconciliation()`) :
```
Q16 - films portant le champ : 23539
Q16 - films avec compteur incoherent : 0
```
→ Tous les films portent désormais le champ, avec **0 incohérence**.

**Q18. Subset Pattern** *(Embed)* — variante d'imbrication qui ne garde qu'un sous-ensemble borné plutôt que la totalité.

Fonction `q18_subset_pattern()` : pour les 10 films les plus commentés (déjà identifiés via le dict de comptage), embarque un champ `recent_comments` avec les 3 commentaires les plus récents (`sort("date", DESCENDING).limit(3)`), projetés sur `{ name, text, date }`.
```
Q18 - film verifie : The Taking of Pelham 1 2 3
Q18 - nb sous-documents dans recent_comments : 3
```
→ c'est vérifié : le tableau contient bien **3** sous-documents.

*Pourquoi n'embarque-t-on que 3 commentaires et pas les 161 ?* → C'est une application directe du **Subset Pattern** : n'imbriquer qu'un aperçu borné (les 3 plus récents) plutôt que la totalité, pour deux raisons. D'abord la **taille du document** : un film comme celui-ci a 161 commentaires réels (Q4b/Q15) et ce nombre croît sans limite dans le temps — l'embarquer intégralement romprait la règle "taille bornée" de l'embed (rappel cours Partie 1) et dégraderait les performances d'écriture à chaque nouveau commentaire (tout le document est réécrit). Ensuite l'**usage applicatif** : une fiche film n'affiche généralement qu'un aperçu des derniers avis en page principale — la liste complète, elle, reste consultable via une requête paginée séparée sur la collection `comments` (qui reste la source de vérité, référencée par `movie_id`).

## Partie 5 — Transaction ACID multi-documents

Instance dédiée avec replica set (les transactions l'exigent) :
```powershell
docker run -d --name mongo-rs -p 27018:27017 mongo:7.0 --replSet rs0
docker exec mongo-rs mongosh --port 27017 --eval "rc = rs.initiate()"
```
Puis réimport de `movies` et `comments` sur cette instance (sans authentification, non configurée sur ce conteneur) :
```powershell
docker cp movies.json mongo-rs:/tmp/movies.json
docker cp comments.json mongo-rs:/tmp/comments.json
docker exec mongo-rs mongoimport --port 27017 --db mflix --collection movies --drop --file /tmp/movies.json
docker exec mongo-rs mongoimport --port 27017 --db mflix --collection comments --drop --file /tmp/comments.json
```
→ **23539** films, **50304** commentaires réimportés avec succès.

**Q19. Scénario modération (PyMongo).** Script complet : voir [transaction.py](transaction.py). Connexion sur `localhost:27018`.

```python
def make_callback(comment_id, movie_id, force_error):
    def callback(session):
        db.comments.delete_one({"_id": comment_id}, session=session)
        if force_error:
            raise RuntimeError("Erreur simulee apres la suppression du commentaire")
        db.movies.update_one({"_id": movie_id}, {"$inc": {"num_mflix_comments": -1}}, session=session)
    return callback

def moderate(comment_id, movie_id, force_error=False):
    with client.start_session() as session:
        try:
            session.with_transaction(make_callback(comment_id, movie_id, force_error))
            print("Transaction commitee.")
        except Exception as e:
            print(f"Transaction annulee : {e}")
```
`session.with_transaction(...)` est utilisé : il encapsule `start_transaction`/`commit_transaction`, retente automatiquement sur `TransientTransactionError`, et **annule** (`abort_transaction`) puis relève l'exception si le callback échoue pour une autre raison — ici notre `RuntimeError` simulée.

**Scénario 1 — succès** (sur un commentaire réel de "The Taking of Pelham 1 2 3", `num_mflix_comments` initial = 436) :
```
comment existe: True
num_mflix_comments avant: 436
Transaction commitee.
comment existe encore: False
num_mflix_comments apres: 435
```
→ Les deux opérations (suppression + décrément) sont appliquées **ensemble** : le commentaire disparaît, le compteur passe de 436 à 435.

**Scénario 2 — échec forcé au milieu de la transaction** (`force_error=True`, exception levée juste après le `delete_one` mais avant l'`update_one`) :
```
Transaction annulee : Erreur simulee apres la suppression du commentaire
comment existe encore (doit etre True): True
num_mflix_comments inchange (doit etre True): True (435 vs 435)
```
→ Malgré le `delete_one` déjà exécuté **dans** la transaction, l'annulation automatique déclenchée par `with_transaction` sur l'exception fait que **rien** n'est appliqué : le commentaire est toujours présent, le compteur reste inchangé (435 avant et après). Aucune modification partielle n'est visible depuis l'extérieur de la transaction.

**Ce que garantit chaque lettre d'A-C-I-D ici :**
- **Atomicity** : `deleteOne` + `updateOne` forment un seul bloc indivisible — soit les deux réussissent (`commitTransaction`), soit aucun n'est appliqué (`abortTransaction`), jamais un état intermédiaire où le commentaire est supprimé mais le compteur pas encore décrémenté (le scénario 2 le prouve directement).
- **Consistency** : la transaction fait passer la base d'un état cohérent (commentaire présent + compteur juste) à un autre état cohérent (commentaire absent + compteur juste), sans jamais exposer l'état incohérent intermédiaire "commentaire supprimé mais compteur pas encore décrémenté".
- **Isolation** : pendant que la transaction est en cours (entre `startTransaction` et `commitTransaction`/`abortTransaction`), aucune autre session ne voit les écritures partielles — un lecteur externe voit soit l'état complet d'avant, soit l'état complet d'après, jamais un entre-deux.
- **Durability** : une fois `commitTransaction()` retourné avec succès, les deux écritures (suppression + décrément) sont persistées de façon durable, garanties par le mécanisme de réplication du replica set (même minimal, comme ici avec `rs0`).


## Partie 6 — Réflexion

**R1. *(Reference)* Ce que le SGBD ne fait plus pour vous.**

Ce qui passe du SGBD vers l'application, c'est la **responsabilité de garantir l'intégrité référentielle** : MongoDB n'impose aucune contrainte de type `FOREIGN KEY` sur `movie_id`, contrairement à un SGBD relationnel — rien n'empêche un commentaire de référencer un film inexistant, ni ne le signale automatiquement. C'est donc à l'application de vérifier elle-même la validité de ses références, si elle veut cette garantie.

Chiffré : **9224 commentaires orphelins** (Q2) sur **50304 commentaires au total** (Q1), soit `9224 / 50304 × 100 ≈ 18.34 %` — près d'**un commentaire sur cinq** pointe dans le vide.

Deux stratégies côté application, avec leur coût :

1. **Validation à l'écriture** : avant d'insérer un commentaire, l'application vérifie que le film existe (`db.movies.findOne({_id: movie_id})`) et refuse l'insertion sinon. *Coût* : **performance** — une requête de lecture supplémentaire à chaque insertion. *Limite* : **couverture partielle** — protège seulement à la création ; si le film est supprimé après coup, ses commentaires deviennent orphelins malgré tout, sans qu'aucune vérification ne s'en aperçoive.

2. **Job de réconciliation périodique** : relancer régulièrement une agrégation comme celle de Q2 pour détecter (et nettoyer ou signaler) les orphelins déjà présents. *Coût* : **complexité** — développer, planifier et surveiller cette tâche de fond. *Limite* : **couverture partielle** aussi — entre deux exécutions, des orphelins existent temporairement ; ce n'est pas une prévention en temps réel, seulement un rattrapage.

**R2. *(Reference)* Embed vs reference — la borne.**

Relation film ↔ commentaires : **référencer** est le bon choix. La relation est **1:beaucoup** (un film peut avoir des centaines de commentaires — 161 pour le plus commenté, Q15), l'entité liée **existe indépendamment** (un commentaire est modérable, supprimable, consultable "par utilisateur" sans dépendre du film), et surtout le nombre de commentaires est **amené à croître sans limite** dans le temps — exactement le cas où le cours dit d'éviter l'embed ("Éviter si la sous-doc grossit sans limite").

Poids d'un commentaire (Q15/R3, même méthode qu'au Jour 1) :
```js
bsonsize(db.comments.findOne({_id: ObjectId('5a9427648b0beebeb69579db')}))
```
→ **308 octets**

Pour le film le plus commenté (161 commentaires, Q15) :
`308 × 161 = 49588 octets ≈ 49.6 Ko`

**Ce n'est pas la limite des 16 Mo qui tranche** — 49.6 Ko ne représente que ≈ 0.3 % de cette limite, on en est très loin. Ce qui tranche réellement, c'est **autre chose** : la **croissance non bornée dans le temps** (161 aujourd'hui, potentiellement des milliers dans quelques années pour un film culte) et le **cycle de vie indépendant** des commentaires (chaque nouveau commentaire forcerait la réécriture complète du document film si tout était imbriqué, et un utilisateur doit pouvoir consulter son propre historique de commentaires à travers plusieurs films sans dépendre d'eux).

**Cas précis où l'on imbriquerait quand même** : si le nombre de commentaires par film restait **strictement borné par construction** — par exemple en n'embarquant qu'un sous-ensemble curaté et plafonné, comme le fait déjà le **Subset Pattern** de la Q18 (les 3 derniers commentaires seulement). On imbrique alors cet aperçu borné pour un accès rapide en une seule lecture, tout en gardant l'historique complet référencé dans `comments` comme source de vérité.

**R3. ESR — vérifié par l'expérience.**

Règle ESR (**E**quality → **S**ort → **R**ange) : placer l'égalité en premier permet à MongoDB de réduire immédiatement l'ensemble de documents à un sous-ensemble contigu dans l'index ; placer le tri en second permet de lire cet index déjà dans l'ordre voulu (`imdb.rating` décroissant) sans étape `SORT` en mémoire ; la plage (`year`) est placée en dernier car un `$gte`/`$lte` casse la contiguïté de l'index (sinon toutes années confondues, l'ordre n'est plus globalement trié par rating) pour tout champ placé après lui — la mettre avant `imdb.rating` aurait empêché le tri d'être couvert par l'index.

Preuve par l'expérience — création du second index, dans le mauvais ordre :
```js
db.movies.createIndex({ genres: 1, year: 1, "imdb.rating": -1 })
```
Puis forçage de chaque index via `.hint()` sur la même requête (`{genres:"Drama", year:{$gte:2000}}.sort({"imdb.rating":-1})`) :

(a) **Un stage `SORT` apparaît-il ?**

| Index (ordre) | winningPlan | totalKeysExamined | totalDocsExamined | executionTimeMillis |
|---|---|---|---|---|
| ESR : `{genres:1, "imdb.rating":-1, year:1}` (Q8) | `FETCH ← IXSCAN` (**pas de SORT**) | 7834 | 7761 | 16 |
| Mauvais ordre : `{genres:1, year:1, "imdb.rating":-1}` | `FETCH ← SORT ← IXSCAN` (**SORT présent**) | 7761 | 7761 | 38 |

Oui — avec le mauvais ordre, un stage `SORT` s'intercale bien entre `IXSCAN` et `FETCH`, exactement comme prédit : l'index range les résultats par année d'abord, donc l'ordre global par `imdb.rating` n'est plus garanti, et MongoDB doit retrier les 7761 documents en mémoire après le scan (`sortPattern: {"imdb.rating": -1}`, `totalDataSizeSorted: 625437` octets, `usedDisk: false`).

(b) **Écart entre les deux.** Fait notable : l'index dans le mauvais ordre examine même **légèrement moins** de clés (7761 vs 7834) — logique, puisque `year` y sert de vraie borne de plage exploitée directement par l'index (`indexBounds: year: ["2000, inf.0"]`), sans les quelques clés "gaspillées" que Q8 examinait à cause du filtrage tardif de `year` (cf. l'écart de 73 déjà expliqué en Q8c). Pourtant, c'est bien le **mauvais ordre qui est le plus coûteux au global** : `38 ms` contre `16 ms`, soit **+22 ms, environ 2.4× plus lent**. Le coût ne vient donc pas du nombre de clés lues, mais entièrement de l'étape `SORT` supplémentaire, qui doit bufferiser puis trier 7761 documents en mémoire — un travail que l'index ESR évite totalement en délivrant déjà les résultats dans l'ordre.

(c) **Si le tri en mémoire dépassait la limite autorisée.** Ici `totalDataSizeSorted: 625437` octets (≈ 610 Ko) reste très loin de la limite — visible dans `serverParameters.internalQueryMaxBlockingSortMemoryUsageBytes: 104857600` (100 Mo sur cette version de MongoDB 7.0 ; historiquement documenté à 32 Mo dans les versions plus anciennes, mais le principe reste identique). Si un tri `find().sort()` sans index couvrant dépassait cette limite, MongoDB refuserait par défaut de continuer et lèverait une erreur du type `QueryExceededMemoryLimitNoDiskUseAllowed` (*"Sort exceeded memory limit of ... bytes, but did not opt in to external sorting"*). Pour l'éviter, il faut explicitement autoriser MongoDB à écrire les données temporaires sur disque via `.allowDiskUse()` sur le curseur (`db.movies.find(...).sort(...).allowDiskUse()`) — ça permet au tri de continuer au-delà de la RAM autorisée, au prix d'un ralentissement (I/O disque au lieu de mémoire).

**R4. *(Computed Pattern)* Le bénéfice et sa facture.**

**Bénéfice, chiffré** : sans le Computed Pattern, afficher le nombre de commentaires d'un film obligerait à faire un `countDocuments({movie_id: ...})` sur `comments` à **chaque affichage** de fiche film. D'après Q3, **14245 films distincts** sont réellement concernés (référencés par au moins un commentaire) — sur une plateforme à fort trafic, ce serait donc potentiellement des milliers de requêtes de comptage répétées à chaque consultation de page, alors qu'avec `num_mflix_comments` pré-calculé, cette information est déjà présente dans le document `movies` qu'on a de toute façon chargé pour afficher la fiche — **zéro requête supplémentaire**.

**Risque, chiffré** : d'après Q16, sur les **15740 films** portant le champ `num_mflix_comments`, **12244** avaient un compteur **incohérent** avec la réalité, soit **77.79 %** — plus des trois quarts des compteurs affichés étaient faux avant correction (Q17). C'est un taux d'erreur massif, pas un cas marginal.

**Conclusion** : ce pattern n'est acceptable en production **qu'à la condition d'un mécanisme fiable de mise à jour du compteur à chaque écriture** — typiquement une mise à jour **atomique** du compteur dans la même transaction que l'insertion/suppression du commentaire (exactement le principe démontré en Q19 avec `$inc` dans une transaction ACID), complétée par un job de réconciliation périodique (Q16/Q17) pour rattraper les dérives résiduelles (imports, migrations, bugs). Sans cette discipline, comme le prouvent nos 77.79 % d'incohérences, le gain de performance se paie directement en fiabilité des données affichées à l'utilisateur.
