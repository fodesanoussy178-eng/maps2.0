/* Les providers historiques se terminent par `})(window)` : ils supposent un
   navigateur. C'est la seule concession à faire pour exécuter le produit côté
   serveur, et les tests la font déjà depuis le début — `globalThis` EST l'objet
   global ici.

   CE FICHIER DOIT ÊTRE IMPORTÉ EN PREMIER. Les imports d'un module ES sont
   évalués avant son corps : poser `window` dans `moteurs.mjs` lui-même
   arriverait trop tard, et `providers/normaliser.js` échouerait au chargement
   avec un `window is not defined` — une panne qui ne se voit qu'en production,
   au premier appel. */
if (typeof globalThis.window === "undefined") globalThis.window = globalThis;
export const FENETRE_POSEE = true;
