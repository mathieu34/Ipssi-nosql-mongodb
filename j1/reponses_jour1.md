# TP Jour 1 — Réponses

## Partie 0 — Mise en place

Commande de connexion :
```
docker exec -it mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin nyc
```

```js
db.restaurants.findOne()
```
```json
{
  _id: ObjectId('6a8c15acd123aae9a1255377'),
  address: {
    building: '2300',
    coord: [ -73.8786113, 40.8502883 ],
    street: 'Southern Boulevard',
    zipcode: '10460'
  },
  borough: 'Bronx',
  cuisine: 'American',
  grades: [
    { date: ISODate('2014-05-28T00:00:00.000Z'), grade: 'A', score: 11 },
    { date: ISODate('2013-06-19T00:00:00.000Z'), grade: 'A', score: 4 },
    { date: ISODate('2012-06-15T00:00:00.000Z'), grade: 'A', score: 3 }
  ],
  name: 'Wild Asia',
  restaurant_id: '40357217'
}
```

**Point de contrôle P0** :
```js
db.restaurants.countDocuments({})
```
→ **25359**

## Partie 1 — Lecture & opérateurs

**Q1.** Total de restaurants.
```js
db.restaurants.countDocuments({})
```
→ **25359**

**Q2.** Types de cuisine distincts.
```js
db.restaurants.distinct("cuisine").length
```
→ **85**

**Q3.** Restaurants à Brooklyn.
```js
db.restaurants.countDocuments({borough:"Brooklyn"})
```
→ **6086**

**Q4.** Restaurants de cuisine French.
```js
db.restaurants.countDocuments({cuisine:"French"})
```
→ **344**

**Q5.** Manhattan ET Italian.
```js
db.restaurants.countDocuments({cuisine:"Italian", borough:"Manhattan"})
```
→ **621**

**Q6.** Bronx ET Chinese.
```js
db.restaurants.countDocuments({cuisine:"Chinese", borough:"Bronx"})
```
→ **323**

**Q7.** Restaurants nommés exactement "Subway".
```js
db.restaurants.countDocuments({name:"Subway"})
```
→ **421**

3 premiers (name + borough, sans `_id`), triés par borough croissant :
```js
db.restaurants.find({name:"Subway"}, {borough:1, _id:0}).sort({borough:1}).limit(3)
```
```json
[ { borough: 'Bronx' }, { borough: 'Bronx' }, { borough: 'Bronx' } ]
```

**Q8.** Cuisine parmi Japanese, Korean, Thai, Indian.
```js
db.restaurants.countDocuments({cuisine:{$in:["Japanese", "Korean", "Thai", "Indian"]}})
```
→ **1623**

**Q9. Le champ de recherche qui ment.**

(a) Sensible à la casse :
```js
db.restaurants.countDocuments({ name: /BBQ/ })
```
→ **0**

(b) Insensible à la casse :
```js
db.restaurants.countDocuments({ name: /BBQ/i })
```
→ **73**

(c) Écart : **73**. Échantillon (b) :
```js
db.restaurants.find({ name: /BBQ/i }, {name:1, _id:0}).limit(3)
```
```json
[
  { name: 'Dallas Bbq' },
  { name: 'Dallas Bbq' },
  { name: "Virgil'S Bbq" }
]
```
"Bbq" est toujours orthographié en casse mixte dans la base, jamais en majuscules — la version sensible à la casse (a) rate donc systématiquement tout, d'où l'écart total.

(d) Avec "House" :
```js
db.restaurants.countDocuments({ name: /House/ })   // 89
db.restaurants.countDocuments({ name: /House/i })  // 503
```
Échantillon insensible :
```json
[
  { name: 'Peter Luger Steakhouse' },
  { name: "Donohue'S Steak House" },
  { name: "Mcsorley'S Old Ale House" }
]
```
Cause différente de (c) : ici ce n'est pas une question d'orthographe incohérente, mais de **mots composés** — "house" apparaît en minuscule fondu dans un mot comme "Steakhouse", que seule la version insensible à la casse détecte.

(e) On prend la version **(b) insensible à la casse**, pour ne pas rater de résultats pertinents pour l'utilisateur. Pour la production, solution proposée : un **index de recherche textuelle** — soit l'index natif `$text` de MongoDB, soit un moteur dédié type **Atlas Search** (basé sur Lucene) — construit au Jour 2.

**Q10.** Code postal "10462".
```js
db.restaurants.countDocuments({"address.zipcode": "10462"})
```
→ **150**

**Q11.** Name du restaurant `restaurant_id: "30075445"`.
```js
db.restaurants.find({restaurant_id:"30075445"}, {name:1, _id:0})
```
```json
[ { name: 'Morris Park Bake Shop' } ]
```

## Partie 2 — Tableaux & sous-documents

**Q12.** Au moins une note avec score > 50.
```js
db.restaurants.countDocuments({"grades.score": {$gt: 50}})
```
→ **349**

**Q13. « Mal noté » — mais quand ?**

(a) Au moins un grade "C" (n'importe quand) :
```js
db.restaurants.countDocuments({"grades.grade": "C"})
```
→ **2706**

(b) Première entrée du tableau égale à "C" :
```js
db.restaurants.countDocuments({"grades.0.grade": "C"})
```
→ **220**

(c) Écart entre (a) et (b) : **2706 − 220 = 2486**.
```js
db.restaurants.findOne({}, {grades:1, _id:0})
```
```json
{
  grades: [
    { date: ISODate('2014-05-28T00:00:00.000Z'), grade: 'A', score: 11 },
    { date: ISODate('2013-06-19T00:00:00.000Z'), grade: 'A', score: 4 },
    { date: ISODate('2012-06-15T00:00:00.000Z'), grade: 'A', score: 3 }
  ]
}
```
L'entrée d'indice 0 est la **plus ancienne**. La requête (b), basée sur `grades.0.grade`, donne donc le grade **historique le plus ancien**, pas l'état actuel du restaurant. C'est la requête (a) qui répond à « restaurants **actuellement** mal notés » au sens large (mal notés à un moment de leur histoire) — mais si on veut vraiment l'état le plus récent, il faudrait plutôt regarder la **dernière** entrée du tableau, pas la première.

**Q14.** Tableau `grades` vide.
```js
db.restaurants.countDocuments({grades: {$size:0}})
```
→ **738**

Pourquoi un tableau peut être vide : une inspection peut être planifiée puis annulée/reportée (restaurant fermé, accès refusé, incident empêchant l'inspecteur de noter), ou le restaurant vient d'ouvrir et n'a pas encore été inspecté.

**Q15.** Restaurants avec au moins 6 notes.
```js
db.restaurants.countDocuments({"grades.5": {$exists: true}})
```
→ **3865**

**Q16.** Première note = "A".
```js
db.restaurants.countDocuments({"grades.0.grade": "A"})
```
→ **20687**

**Q17. Le piège `$elemMatch`.**

(a) Requête naïve :
```js
db.restaurants.countDocuments({"grades.grade": "B", "grades.score": { $gt:20 }})
```
→ **4908**

(b) Avec `$elemMatch` :
```js
db.restaurants.countDocuments({ grades: { $elemMatch: { grade: "B", score: { $gt: 20 } } } })
```
→ **4280**

(c) `$elemMatch` renvoie moins de documents car il exige que grade "B" et score > 20 soient vrais sur **le même** sous-document du tableau, alors que la requête naïve les cherche indépendamment n'importe où dans le tableau ; c'est **(b)** qui répond réellement à la question métier.

**Q18. Anomalies de qualité.**

(a) Notes avec score négatif :
```js
db.restaurants.countDocuments({"grades.score": {$lt: 0}})
```
→ **13**

Un score négatif n'a pas de sens métier (sauf si le barème de notation n'est pas standard de 0 à 20).

(b) Moyenne avec négatifs :
```js
db.restaurants.aggregate([{ $unwind: "$grades" }, { $group: { _id: null, moy: { $avg: "$grades.score" } } }])
```
→ **11.434842161583735**

Moyenne sans négatifs :
```js
db.restaurants.aggregate([
  { $unwind: "$grades" },
  { $match: { "grades.score": { $gte: 0 } } },
  { $group: { _id: null, moy: { $avg: "$grades.score" } } }
])
```
→ **11.436572235838051**

(c) Écart : `(11.436572235838051 - 11.434842161583735) / 11.434842161583735 × 100 ≈ 0.0151 %`. L'écart est quasi nul — les quelques notes négatives ont un impact statistique négligeable sur la moyenne globale, donc pas de nettoyage en urgence justifié pour cet usage.

**Q19.** Restaurant avec la note maximale.
```js
db.restaurants.find({}, {name: 1, "grades.score": 1, _id:0}).sort({"grades.score": -1}).limit(1)
```
```json
[
  {
    grades: [
      { score: 11 }, { score: 131 }, { score: 11 },
      { score: 25 }, { score: 11 }, { score: 13 }
    ],
    name: "Murals On 54/Randolphs'S"
  }
]
```
→ **name: "Murals On 54/Randolphs'S", score max: 131**

## Partie 3 — Création & mise à jour

**Q20.** Insertion du restaurant fictif.
```js
db.restaurants.insertOne({
  name: "MP",
  borough: "Montpellier",
  cuisine: "French",
  address: {
    coord: [3.8767, 43.6108],
    building: "290",
    street: "avenue nina simone",
    zipcode: "34000"
  },
  grades: [{ grade: "A", score: 7, date: new Date() }]
})
```
Vérification :
```js
db.restaurants.findOne({name:"MP"})
```
```json
{
  _id: ObjectId('6a8c65633f3272f5ff058f87'),
  name: 'MP',
  borough: 'Montpellier',
  cuisine: 'French',
  address: {
    coord: [ 3.8767, 43.6108 ],
    building: '290',
    street: 'avenue nina simone',
    zipcode: '34000'
  },
  grades: [ { grade: 'A', score: 7, date: ISODate('2026-08-24T15:38:11.353Z') } ]
}
```

**Q21.** `$push` sur `restaurant_id: "30075445"`.
```js
db.restaurants.updateOne(
  { restaurant_id: "30075445" },
  { $push: { grades: { grade: "A", score: 3, date: new Date() } } }
)
```
```json
{
  acknowledged: true,
  insertedId: null,
  matchedCount: 1,
  modifiedCount: 1,
  upsertedCount: 0
}
```
→ Ce restaurant a maintenant **6 notes**.

**Q22.** `$set risque: "eleve"` en masse.
```js
db.restaurants.updateMany({"grades.score": {$gt: 50}}, {$set: {risque: "eleve"}})
```
→ **matchedCount: 349, modifiedCount: 349**

**Q23.** `$set label_qualite: true` sur cuisine French.
```js
db.restaurants.updateMany({cuisine:"French"}, {$set: {label_qualite: true}})
```
→ **modifiedCount: 344**

## Partie 4 — Suppression & qualité de données

**Q24.** Documents `borough: "Missing"`.
```js
db.restaurants.countDocuments({ borough: "Missing" })
```
→ **51**

**Q25.** Suppression.
```js
db.restaurants.deleteMany({ borough: "Missing" })
```
→ **deletedCount: 51**
```js
db.restaurants.countDocuments({})
```
→ **25308**

**Q26. Décision de gouvernance.**

(a) `738 / 25308 × 100 ≈ 2.92 %`

(b) On a supprimé les `borough: "Missing"` car cette information est **irrécupérable** — impossible de deviner rétroactivement l'arrondissement d'un restaurant sans donnée source. On garde les tableaux `grades` vides car ils ne sont **pas une erreur irréversible** : ce sont des restaurants qui n'ont simplement pas encore été inspectés, et le champ pourra légitimement se remplir dans le futur avec de nouvelles inspections.

## Partie 5 — Automatisation

**Q27.** Copie et exécution du script :
```powershell
docker cp rapport.js mongo-ipssi:/tmp/rapport.js
docker exec mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin nyc /tmp/rapport.js
```
(équivalent à cette forme : `docker exec -i mongo-ipssi mongosh -u admin -p ipssi2025 --authenticationDatabase admin nyc < rapport.js`)

Sortie obtenue :
```
1. Nombre total de restaurants : 25309

2. Top 5 des cuisines les plus fréquentes :
  1. American : 6173
  2. Chinese : 2412
  3. Café/Coffee/Tea : 1210
  4. Pizza : 1162
  5. Italian : 1069

3. Nombre de restaurants par arrondissement :
  Bronx : 2338
  Brooklyn : 6086
  Manhattan : 10259
  Montpellier : 1
  Queens : 5656
  Staten Island : 969
```

**Écart sur le total** : 25309 (rapport) − 25359 (Q1) = **−50**.

Détail opération par opération :
- **Q20** (insertion du restaurant fictif "MP") : **+1** document
- **Q25** (suppression des `borough: "Missing"`) : **−51** documents (`deletedCount: 51`)
- Net : `+1 − 51 = −50` → cohérent avec l'écart observé

Aucune autre question de la Partie 3 (Q21, Q22, Q23) ne modifie le nombre de documents : `$push`, `$set` ne font qu'ajouter/modifier des champs sur des documents existants, sans en créer ni en supprimer.

**Valeur d'arrondissement inédite** : `Montpellier` (1 restaurant) — provient directement du restaurant fictif inséré en Q20 (`borough: "Montpellier"`), qui n'existait pas dans le jeu de données d'origine.

**Q28.** Export de la collection `restaurants` limitée à `Staten Island` :
```powershell
docker exec mongo-ipssi mongoexport --username admin --password ipssi2025 --authenticationDatabase admin --db nyc --collection restaurants --query '{"borough":"Staten Island"}' --out /tmp/staten_island.json
docker cp mongo-ipssi:/tmp/staten_island.json staten_island.json
```
```
2026-08-25T08:05:50.295+0000	exported 969 records
```
-> **969 lignes** dans l'export (cohérent avec le comptage `Staten Island : 969` du rapport Q27).

## Partie 6 — Réflexion

**R1. Les 5 V, chiffrés.**
**Volume** : 25 359 restaurants (Q1) pour un seul jeu de données municipal — à l'échelle de toutes les villes suivies par ce type de service, le volume réel serait bien supérieur. **Variété** : 85 cuisines distinctes (Q2), et une structure interne hétérogène d'un document à l'autre — 738 restaurants ont un tableau `grades` vide (Q14) tandis que 3 865 en ont au moins 6 (Q15) ; le modèle document absorbe naturellement cette irrégularité de schéma, impossible sans jointures variables en relationnel strict. **Véracité** : 13 documents portent un score négatif (Q18a), ce qui ne déplace la moyenne globale que de 0,0151 % (Q18b) — l'erreur est réelle mais son impact statistique est négligeable ; à l'inverse, les 51 documents `borough: "Missing"` (Q24) sont une erreur bien plus grave car irrécupérable par la requête.

**R2. CAP & BASE, appliqué à ce service.**
Prenons le restaurant de la Q11, **"Morris Park Bake Shop"** (`restaurant_id: "30075445"`), qui vient d'être fermé pour insalubrité. **(a) Cohérence (C)** : en cas de partition réseau, le nœud isolé refuse de répondre plutôt que de risquer une réponse obsolète — l'usager qui consulte la fiche voit une erreur ou un timeout, mais jamais d'information fausse. **(b) Disponibilité (A)** : l'application répond toujours, y compris depuis un nœud isolé n'ayant pas encore reçu la mise à jour de fermeture — l'usager voit alors une fiche potentiellement obsolète indiquant le restaurant encore ouvert et bien noté. Pour ce service de santé publique, je choisirais **C** : le dommage accepté est une **indisponibilité ponctuelle** (l'usager ne peut pas consulter la fiche pendant quelques secondes), jugé bien moins grave qu'un usager se rendant dans un restaurant fermé pour insalubrité sur la foi d'une donnée périmée.

**R3. Embarqué vs référencé — le calcul.**
**(a)** Sur le restaurant de la Q21 (`restaurant_id: "30075445"`, 6 notes après le `$push`), `bsonsize(db.restaurants.findOne({restaurant_id:"30075445"}))` renvoie **524 octets** (note : `Object.bsonsize` n'existe pas dans cette version de `mongosh`, la fonction globale `bsonsize()` a été utilisée à la place). Taille moyenne estimée par note : `524 / 6 ≈ 87,3 octets`. **(b)** Pour 520 notes (inspection hebdomadaire pendant 10 ans, cf. Q15) : `520 × 87,3 ≈ 45 400 octets ≈ 44,3 Ko`, à comparer à la **limite BSON de 16 Mo (16 777 216 octets)** — le modèle embarqué tient très largement, 44,3 Ko ne représentant que ≈ 0,27 % de la limite. **(c)** Avantage : un `findOne` unique récupère le restaurant et tout son historique de notes en un seul accès disque, sans jointure. Limite : chaque `$push` réécrit le document entier, ce qui devient coûteux bien avant le plafond de 16 Mo si la fréquence d'ajout est beaucoup plus élevée qu'une inspection hebdomadaire (logs, capteurs, activité utilisateur). Je basculerais vers un modèle référencé dès que le tableau dépasserait quelques milliers d'entrées par entité, pour des raisons de performance d'écriture, bien avant d'atteindre la limite technique.


