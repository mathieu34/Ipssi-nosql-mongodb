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


