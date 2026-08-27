// pipelines.js — TP Jour 4, Parties B1 à B3
// Exécutable via : mongosh -u admin -p ipssi2025 --authenticationDatabase admin citibike < pipelines.js
// (conteneur mongo-j4, port 27017)

// Q12 — Top 5 stations de départ
print("=== Q12: Top 5 stations de depart ===");
printjson(db.trips.aggregate([
  { $group: { _id: "$start station name", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 5 }
]).toArray());

// Q13 — Répartition par usertype (nombre de trajets + durée moyenne)
print("=== Q13: repartition par usertype ===");
printjson(db.trips.aggregate([
  { $group: { _id: "$usertype", n: { $sum: 1 }, dureeMoy: { $avg: "$tripduration" } } }
]).toArray());

// Q14 — Trajets par jour
print("=== Q14: trajets par jour ===");
printjson(db.trips.aggregate([
  { $group: { _id: { $dateTrunc: { date: "$start time", unit: "day" } }, n: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]).toArray());

// Q15 — Heure de pointe (top 5)
print("=== Q15: heure de pointe (top 5) ===");
printjson(db.trips.aggregate([
  { $group: { _id: { $hour: "$start time" }, n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 5 }
]).toArray());

// Q16 — Distribution des durées par bucket
print("=== Q16: distribution des durees ($bucket) ===");
printjson(db.trips.aggregate([
  { $bucket: {
      groupBy: "$tripduration",
      boundaries: [0, 300, 600, 1800, 3600, 1000000],
      output: { n: { $sum: 1 } }
  } }
]).toArray());

// Q17 — Boucles (départ = arrivée)
print("=== Q17: boucles (depart = arrivee) ===");
print(db.trips.countDocuments({ $expr: { $eq: ["$start station id", "$end station id"] } }));

// Q18 — Type de birth year, croisé avec usertype
print("=== Q18: birth year - type string vs int ===");
print("string: " + db.trips.countDocuments({ "birth year": { $type: "string" } }));
print("int: " + db.trips.countDocuments({ "birth year": { $type: "int" } }));
printjson(db.trips.aggregate([
  { $group: { _id: { u: "$usertype", t: { $type: "$birth year" } }, n: { $sum: 1 } } }
]).toArray());

// Q19 — Âge moyen (années numériques uniquement)
print("=== Q19: age moyen (birth year numerique) ===");
printjson(db.trips.aggregate([
  { $match: { "birth year": { $type: ["int", "long", "double"] } } },
  { $group: {
      _id: null,
      ageMoy: { $avg: { $subtract: [2016, "$birth year"] } },
      n: { $sum: 1 },
      plusVieux: { $min: "$birth year" }
  } }
]).toArray());

// Q20 — Valeurs aberrantes de durée
print("=== Q20: valeurs aberrantes ===");
print("> 3h: " + db.trips.countDocuments({ tripduration: { $gt: 10800 } }));
print("> 24h: " + db.trips.countDocuments({ tripduration: { $gt: 86400 } }));
printjson(db.trips.find({}, { tripduration: 1, usertype: 1, _id: 0 }).sort({ tripduration: -1 }).limit(3).toArray());

// Q21 — Durée moyenne par usertype, en excluant les trajets > 3h
print("=== Q21: duree moyenne par usertype, hors >3h ===");
printjson(db.trips.aggregate([
  { $match: { tripduration: { $lte: 10800 } } },
  { $group: { _id: "$usertype", n: { $sum: 1 }, dureeMoy: { $avg: "$tripduration" } } }
]).toArray());

// Q22 — $match en premier : deux pipelines équivalents, comparaison des plans
print("=== Q22: pipeline A ($match puis $group) ===");
var pipelineA = [
  { $match: { usertype: "Subscriber" } },
  { $group: { _id: "$start station id", n: { $sum: 1 } } }
];
printjson(db.trips.explain("executionStats").aggregate(pipelineA));

print("=== Q22: pipeline B ($group puis $match sur _id.u) ===");
var pipelineB = [
  { $group: { _id: { s: "$start station id", u: "$usertype" }, n: { $sum: 1 } } },
  { $match: { "_id.u": "Subscriber" } }
];
printjson(db.trips.explain("executionStats").aggregate(pipelineB));

// Q23 — La limite de l'optimiseur : $match sur une valeur agrégée
print("=== Q23: $group puis $match sur n (agregat) ===");
var pipelineC = [
  { $group: { _id: "$start station id", n: { $sum: 1 } } },
  { $match: { n: { $gt: 50 } } }
];
printjson(db.trips.explain("executionStats").aggregate(pipelineC));
print("nb stations > 50 departs: " + db.trips.aggregate(pipelineC.concat([{ $count: "nb" }])).toArray()[0].nb);

// Q24 — $merge : construction de la collection stations
print("=== Q24: construction de stations via $merge ===");
db.trips.aggregate([
  { $group: {
      _id: "$start station id",
      nom: { $first: "$start station name" },
      position: { $first: "$start station location" },
      departs: { $sum: 1 }
  } },
  { $merge: { into: "stations", whenMatched: "replace" } }
]);
print("nb stations: " + db.stations.countDocuments({}));
printjson(db.stations.find().sort({ departs: -1 }).limit(3).toArray());

// Q26 — $lookup : top 5 stations d'arrivée avec nom
print("=== Q26: top 5 stations d'arrivee (via $lookup sur stations) ===");
printjson(db.trips.aggregate([
  { $group: { _id: "$end station id", n: { $sum: 1 } } },
  { $sort: { n: -1 } },
  { $limit: 5 },
  { $lookup: { from: "stations", localField: "_id", foreignField: "_id", as: "station" } },
  { $unwind: "$station" },
  { $project: { _id: 0, station: "$station.nom", n: 1 } }
]).toArray());

// R3(b) — médiane (jeu non filtré), pour comparaison avec Q13/Q21
print("=== R3(b): mediane tripduration (non filtree) ===");
printjson(db.trips.aggregate([
  { $group: { _id: null, med: { $median: { input: "$tripduration", method: "approximate" } } } }
]).toArray());
