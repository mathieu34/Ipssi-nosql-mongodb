from pymongo import MongoClient

client = MongoClient("mongodb://localhost:27018/?directConnection=true")
db = client["mflix"]


def make_callback(comment_id, movie_id, force_error):
    def callback(session):
        db.comments.delete_one({"_id": comment_id}, session=session)
        if force_error:
            raise RuntimeError("Erreur simulee apres la suppression du commentaire")
        db.movies.update_one(
            {"_id": movie_id}, {"$inc": {"num_mflix_comments": -1}}, session=session
        )
    return callback


def moderate(comment_id, movie_id, force_error=False):
    with client.start_session() as session:
        try:
            session.with_transaction(make_callback(comment_id, movie_id, force_error))
            print("Transaction commitee.")
        except Exception as e:
            print(f"Transaction annulee : {e}")


demo_movie = db.movies.find_one({"title": "The Taking of Pelham 1 2 3"})
demo_movie_id = demo_movie["_id"]

# --- Scenario 1 : succes ---
comment1 = db.comments.find_one({"movie_id": demo_movie_id})
movie_before = db.movies.find_one({"_id": demo_movie_id})
print("=== Etat avant ===")
print("comment existe:", db.comments.count_documents({"_id": comment1["_id"]}) == 1)
print("num_mflix_comments avant:", movie_before["num_mflix_comments"])

moderate(comment1["_id"], demo_movie_id, force_error=False)

movie_after_success = db.movies.find_one({"_id": demo_movie_id})
print("=== Apres transaction reussie ===")
print("comment existe encore:", db.comments.count_documents({"_id": comment1["_id"]}) == 1)
print("num_mflix_comments apres:", movie_after_success["num_mflix_comments"])

# --- Scenario 2 : echec au milieu -> tout doit etre annule ---
comment2 = db.comments.find_one({"movie_id": demo_movie_id})
movie_before2 = db.movies.find_one({"_id": demo_movie_id})

moderate(comment2["_id"], demo_movie_id, force_error=True)

movie_after_abort = db.movies.find_one({"_id": demo_movie_id})
print("=== Apres transaction annulee (abortTransaction automatique) ===")
print("comment existe encore (doit etre True):", db.comments.count_documents({"_id": comment2["_id"]}) == 1)
print(
    "num_mflix_comments inchange (doit etre True):",
    movie_before2["num_mflix_comments"] == movie_after_abort["num_mflix_comments"],
    f"({movie_before2['num_mflix_comments']} vs {movie_after_abort['num_mflix_comments']})",
)

client.close()
