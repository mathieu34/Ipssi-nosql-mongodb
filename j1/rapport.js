// rapport.js — rapport statistique sur nyc.restaurants
use("nyc");

// 1. Nombre total de restaurants
const total = db.restaurants.countDocuments({});
print("\n1. Nombre total de restaurants : " + total);

// 2. Top 5 des cuisines les plus fréquentes (via Map)
print("\n2. Top 5 des cuisines les plus fréquentes :");
const cuisines = db.restaurants.distinct("cuisine");
const cuisineMap = new Map();

cuisines.forEach(function (c) {
  const count =  db.restaurants.countDocuments({cuisine: c});
  cuisineMap.set(c, count);
});

const top5 = [...cuisineMap.entries()]
  .sort(function (a, b) { return (b[1] - a[1]); }) //tri decroissant
  .slice(0, 5);

top5.forEach(function (entry, i) {
  const nom = entry[0];
  const count = entry[1];
  print("  " + (i + 1) + ". " + nom + " : " + count);
});

// 3. Nombre de restaurants par arrondissement (via Map)
print("\n3. Nombre de restaurants par arrondissement :");
const boroughs = db.restaurants.distinct("borough");
const boroughMap = new Map();

boroughs.forEach(function (b) {
  const count = db.restaurants.countDocuments({borough: b});
  boroughMap.set(b, count);
});

boroughMap.forEach(function (count, borough) {
  print("  " + borough + " : " + count);
});

