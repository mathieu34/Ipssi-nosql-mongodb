// analyses.js — Partie 3 : agrégations analytiques sur mflix
use("mflix");

print("=== Q11. Top 5 des genres par nombre de films ===");
printjson(db.movies.aggregate([
  { $unwind: "$genres" },
  { $group: { _id: "$genres", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 5 }
]).toArray());

print("\n=== Q12. Top 3 des décennies par nombre de films ===");
printjson(db.movies.aggregate([
  { $match: { year: { $type: "int" } } },
  { $group: { _id: { $subtract: ["$year", { $mod: ["$year", 10] }] }, count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 3 }
]).toArray());

print("\n=== Q13. Note IMDB moyenne des films Drama (notes numeriques uniquement) ===");
printjson(db.movies.aggregate([
  { $match: { genres: "Drama", "imdb.rating": { $type: "number" } } },
  { $group: { _id: null, avgRating: { $avg: "$imdb.rating" }, count: { $sum: 1 } } },
  { $project: { _id: 0, avgRating: { $round: ["$avgRating", 4] }, count: 1 } }
]).toArray());

print("\n=== Q14. Top 3 realisateurs par nombre de films ===");
printjson(db.movies.aggregate([
  { $unwind: "$directors" },
  { $group: { _id: "$directors", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 3 }
]).toArray());

print("\n=== Q15. Top 5 des films les plus commentes (lookup inverse) ===");
printjson(db.comments.aggregate([
  { $group: { _id: "$movie_id", count: { $sum: 1 } } },
  { $sort: { count: -1 } },
  { $limit: 5 },
  { $lookup: { from: "movies", localField: "_id", foreignField: "_id", as: "movie" } },
  { $unwind: "$movie" },
  { $project: { _id: 0, title: "$movie.title", count: 1 } }
]).toArray());
