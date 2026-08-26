#!/usr/bin/env python3
"""Observe un Replica Set MongoDB et affiche chaque changement de PRIMARY.

Interroge un noeud fixe (connexion directe, sans decouverte de topologie) toutes
les 300 ms via `hello()` et imprime un horodatage relatif a chaque fois que le
champ `primary` change de valeur. Sert de chronometre pour la Partie 3.

Le script attend un ENTREE avant de demarrer son chronometre (t+0.00s) : appuyez
juste avant de declencher la panne dans l'autre terminal (docker stop/kill/start),
pour que le t+X.XXs affiche ensuite soit le vrai delai mesure, sans avoir a
recouper deux horloges de terminaux differents.

Usage:
    python watch_primary.py                       # observe via mongo2:27017 (depuis un conteneur sur rslab_default)
    python watch_primary.py mongo3                 # observe via un autre noeud, meme reseau
    python watch_primary.py localhost 27018        # depuis l'hote, via le port mappe de mongo2 (27017=mongo1, 27018=mongo2, 27019=mongo3)
"""
import sys
import time
from datetime import datetime

from pymongo import MongoClient
from pymongo.errors import PyMongoError

HOST = sys.argv[1] if len(sys.argv) > 1 else "mongo2"
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 27017
POLL_INTERVAL = 0.3  # secondes


def current_primary(client: MongoClient):
    try:
        hello = client.admin.command("hello")
        return hello.get("primary")
    except PyMongoError:
        return None


def main() -> None:
    uri = f"mongodb://{HOST}:{PORT}/?directConnection=true&serverSelectionTimeoutMS=2000"
    client = MongoClient(uri)

    primary = current_primary(client)
    print(f"[watch_primary] observation via {HOST}:{PORT}")
    print(f"[watch_primary] primary actuel : {primary or 'AUCUN PRIMARY'}")
    input("[watch_primary] Appuyez sur ENTREE juste avant de declencher la panne (docker stop/kill/start), "
          "puis basculez immediatement sur l'autre terminal pour l'executer...\n")

    start = time.monotonic()
    last_primary = primary if primary else "AUCUN PRIMARY"
    print(f"[watch_primary] chronometre demarre (t+0.00s) - Ctrl+C pour arreter")

    while True:
        elapsed = time.monotonic() - start
        primary = current_primary(client)
        label = primary if primary else "AUCUN PRIMARY"
        if label != last_primary:
            now = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            print(f"t+{elapsed:7.2f}s  [{now}]  primary -> {label}")
            last_primary = label
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n[watch_primary] arret")
