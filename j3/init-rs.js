// init-rs.js
// Initialise le Replica Set rs0. mongo1 recoit une priority plus haute
// pour etre le PRIMARY naturel a l'initialisation (cf. Q2) et pour permettre
// d'observer un priority takeover quand il revient apres une panne (cf. Q19).
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "mongo1:27017", priority: 2 },
    { _id: 1, host: "mongo2:27017", priority: 1 },
    { _id: 2, host: "mongo3:27017", priority: 1 },
  ],
});
