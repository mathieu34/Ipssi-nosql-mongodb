// geo.js — TP Jour 4, Partie B4 (index géospatial 2dsphere)
// Exécutable via : mongosh -u admin -p ipssi2025 --authenticationDatabase admin citibike < geo.js
// Point de référence : Times Square [-73.9855, 40.7580] (longitude, latitude)

var timesSquare = { type: "Point", coordinates: [-73.9855, 40.7580] };

// Q27 — $near SANS index : doit échouer
print("=== Q27: $near sans index (erreur attendue) ===");
try {
  db.trips.find({ "start station location": {
    $near: { $geometry: timesSquare, $maxDistance: 500 }
  } }).toArray();
} catch (e) {
  print("ERREUR: " + e.message);
}

// Q28 — Créer l'index 2dsphere, relancer $near
print("=== Q28: creation index 2dsphere + $near ===");
db.trips.createIndex({ "start station location": "2dsphere" });
var near500 = db.trips.find({ "start station location": {
  $near: { $geometry: timesSquare, $maxDistance: 500 }
} }).toArray();
print("nb resultats: " + near500.length);
print("5 premiers noms (ordre $near, du plus proche au plus loin):");
printjson(near500.slice(0, 5).map(function (x) { return x["start station name"]; }));

// Q29 — countDocuments avec $near : échoue (near exige un tri).
// Solution : $geoWithin + $centerSphere (rayon en radians = km / 6378.1)
print("=== Q29a: countDocuments avec $near (erreur attendue) ===");
try {
  db.trips.countDocuments({ "start station location": {
    $near: { $geometry: timesSquare, $maxDistance: 500 }
  } });
} catch (e) {
  print("ERREUR: " + e.message);
}

print("=== Q29b: $geoWithin + $centerSphere ===");
var rayon500m  = 0.5 / 6378.1;
var rayon1000m = 1   / 6378.1;
print("moins de 500 m: " + db.trips.countDocuments({ "start station location": {
  $geoWithin: { $centerSphere: [timesSquare.coordinates, rayon500m] }
} }));
print("moins de 1000 m: " + db.trips.countDocuments({ "start station location": {
  $geoWithin: { $centerSphere: [timesSquare.coordinates, rayon1000m] }
} }));

// Q30 — $geoNear sur la collection stations (Q24), stations < 1 km
// $geoNear doit être le PREMIER stage (nécessite l'index géospatial
// de la collection source, perdu si un stage précédent transforme les docs)
print("=== Q30: $geoNear sur stations, < 1 km de Times Square ===");
db.stations.createIndex({ position: "2dsphere" });
printjson(db.stations.aggregate([
  { $geoNear: {
      near: timesSquare,
      distanceField: "distance",
      maxDistance: 1000,
      spherical: true
  } },
  { $project: { _id: 0, nom: 1, distance: { $round: ["$distance", 0] }, departs: 1 } }
]).toArray());
