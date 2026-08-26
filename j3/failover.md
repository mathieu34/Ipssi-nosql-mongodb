# Failover — mesures de bascule

Mesuré avec `watch_primary.py` (version avec pause ENTREE : le chrono démarre exactement au moment où l'on appuie sur ENTREE, juste avant de déclencher la panne dans le second terminal — pas de reconstruction ni de recoupement entre deux horloges).

| Scénario | Commande | Délai mesuré | Nœud élu | Écritures perdues ? |
|---|---|---|---|---|
| Arrêt propre | `docker stop mongo1` | **1,52 s** | mongo2 | Aucune (test isolé, pas d'écriture en cours) |
| Panne brutale | `docker kill mongo1` | **11,47 s** (perte de contact détectée à +2,41 s, élection à +11,47 s) | mongo3 | Aucune (test isolé, pas d'écriture en cours) |
| Retour du nœud | `docker start mongo1` | **12,69 s** de reprise du rôle PRIMARY (*priority takeover*) | mongo1 | N/A — mongo1 rattrape via l'oplog (prouvé en Q20 : documents écrits pendant son absence retrouvés intacts) |

**Sortie brute (`docker stop mongo1`, Q17) :**
```
[watch_primary] chronometre demarre (t+0.00s) - Ctrl+C pour arreter
t+   1.52s  [15:10:50.52]  primary -> mongo2:27017
```

**Sortie brute (`docker start mongo1`, Q19) :**
```
[watch_primary] chronometre demarre (t+0.00s) - Ctrl+C pour arreter
t+  12.69s  [15:21:01.11]  primary -> mongo1:27017
```

**Sortie brute (`docker kill mongo1`, Q21) :**
```
[watch_primary] primary actuel : mongo1:27017
[watch_primary] chronometre demarre (t+0.00s) - Ctrl+C pour arreter
t+   2.41s  [16:27:27.08]  primary -> AUCUN PRIMARY
t+  11.47s  [16:27:36.14]  primary -> mongo3:27017
```

## Commentaire (pour la DSI)

Sur un cluster au repos, un arrêt planifié (maintenance) bascule en **1,52 seconde** — quasi imperceptible pour les clients (une écriture tentée pile pendant cette fenêtre échouerait tout de même avec `NotWritablePrimary`, cf. Q14, mais la fenêtre est très courte) car le primary sortant notifie proactivement les secondaries avant de s'arrêter (stepdown contrôlé sur `SIGTERM`) au lieu de les laisser attendre un timeout. Une panne serveur brutale (crash, coupure) coûte en revanche **11,47 secondes** d'indisponibilité en écriture : `electionTimeoutMillis` (10 000 ms) fixe un seuil minimum avant qu'un secondary n'ose déclencher une élection, mais le délai réel observé y ajoute le temps de détection effective et le round d'élection lui-même — d'où un total légèrement supérieur aux 10 s nominaux. Chiffre à retenir pour le SLA : **environ 12 secondes par panne brutale**, largement sous le seuil de 43 minutes/mois du SLA 99,9 %, tant que ces évènements restent rares (moins de ~200 pannes brutales/mois à ce rythme, un ordre de grandeur jamais atteint en usage normal).
