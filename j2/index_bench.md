# index_bench.md — Comparatif explain() avant / après index

## Q7 — Index multi-clés sur `genres`

Requête : `db.movies.find({ genres: "Film-Noir" })`

| État | stage | totalDocsExamined | totalKeysExamined | nReturned |
|---|---|---|---|---|
| Avant index | COLLSCAN | 23539 | 0 | 105 |
| Après `createIndex({ genres: 1 })` | FETCH (via IXSCAN) | 105 | 105 | 105 |

Index créé : `db.movies.createIndex({ genres: 1 })` — index multi-clés automatique (le champ `genres` est un tableau).

## Q8 — Index composé (règle ESR) sur `genres`, `imdb.rating`, `year`

Requête : `db.movies.find({ genres: "Drama", year: { $gte: 2000 } }).sort({ "imdb.rating": -1 })`

| État | stage | totalDocsExamined | totalKeysExamined | nReturned | SORT en mémoire ? |
|---|---|---|---|---|---|
| Avant index composé | COLLSCAN (attendu) | 23539 | 0 | 7761 | Oui |
| Après `createIndex({ genres: 1, "imdb.rating": -1, year: 1 })` | FETCH (via IXSCAN) | 7761 | 7834 | 7761 | **Non** |

Ordre ESR : `genres` (Equality) → `imdb.rating` (Sort) → `year` (Range).

## Q9 — Index text sur `title` + `plot`

| Recherche | Méthode | Résultat |
|---|---|---|
| "Godfather" | `$regex: /Godfather/` (sur `title` seul) | 5 |
| "godfather" | `$text: { $search: "godfather" }` (`title` + `plot`, insensible casse, stemming) | 12 |
| "godfathers" (pluriel) | `$text: { $search: "godfathers" }` | 12 (identique — stemming) |

Index créé : `db.movies.createIndex({ title: "text", plot: "text" })`, supprimé en Q10 une fois la démonstration terminée.

## Q10 — Index existants sur `movies`

Avant suppression (4 index) :
| name | key |
|---|---|
| `_id_` | `{ _id: 1 }` (auto, non créé manuellement) |
| `genres_1` | `{ genres: 1 }` |
| `genres_1_imdb.rating_-1_year_1` | `{ genres: 1, "imdb.rating": -1, year: 1 }` |
| `title_text_plot_text` | `{ title: "text", plot: "text" }` |

Après `db.movies.dropIndex("title_text_plot_text")` : 3 index restants (`_id_`, `genres_1`, `genres_1_imdb.rating_-1_year_1`).
