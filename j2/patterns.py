from pymongo import MongoClient, UpdateOne, DESCENDING

client = MongoClient("mongodb://admin:ipssi2025@localhost:27017/?authSource=admin")
db = client["mflix"]
movies = db["movies"]
comments = db["comments"]


def real_comment_counts():
    pipeline = [{"$group": {"_id": "$movie_id", "count": {"$sum": 1}}}]
    return {doc["_id"]: doc["count"] for doc in comments.aggregate(pipeline)}


def q16_reconciliation():
    counts = real_comment_counts()
    incoherent = 0
    total_with_field = 0
    for movie in movies.find({"num_mflix_comments": {"$exists": True}}, {"num_mflix_comments": 1}):
        total_with_field += 1
        real = counts.get(movie["_id"], 0)
        if real != movie["num_mflix_comments"]:
            incoherent += 1
    print(f"Q16 - films portant le champ : {total_with_field}")
    print(f"Q16 - films avec compteur incoherent : {incoherent}")
    return counts, incoherent


def q17_fix_counters(counts):
    ops = []
    for movie in movies.find({}, {"num_mflix_comments": 1}):
        real = counts.get(movie["_id"], 0)
        if movie.get("num_mflix_comments") != real:
            ops.append(UpdateOne({"_id": movie["_id"]}, {"$set": {"num_mflix_comments": real}}))
    if ops:
        result = movies.bulk_write(ops)
        print(f"Q17 - modifiedCount : {result.modified_count}")
    else:
        print("Q17 - modifiedCount : 0 (rien a corriger)")


def q18_subset_pattern(counts):
    top10 = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)[:10]
    for movie_id, _ in top10:
        recent = list(
            comments.find(
                {"movie_id": movie_id},
                {"name": 1, "text": 1, "date": 1, "_id": 0},
            )
            .sort("date", DESCENDING)
            .limit(3)
        )
        movies.update_one({"_id": movie_id}, {"$set": {"recent_comments": recent}})

    sample = movies.find_one({"_id": top10[0][0]}, {"title": 1, "recent_comments": 1, "_id": 0})
    print(f"Q18 - film verifie : {sample['title']}")
    print(f"Q18 - nb sous-documents dans recent_comments : {len(sample['recent_comments'])}")


if __name__ == "__main__":
    counts, _ = q16_reconciliation()
    q17_fix_counters(counts)
    q16_reconciliation()
    q18_subset_pattern(counts)
    client.close()
