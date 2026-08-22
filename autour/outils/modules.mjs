/* La liste de ce que la page charge. Elle n'appartient pas aux tests.

   Elle vivait dans `tests/empreintes.mjs`, et c'était sans conséquence tant
   que rien d'autre ne s'en servait. La commande de build de Vercel l'a rendue
   critique : `outils/alleger.mjs` en a besoin pour savoir quoi alléger, et
   `.vercelignore` écarte `tests/` du téléversement. Le build échouait donc en
   production sur un `ERR_MODULE_NOT_FOUND` — trouvé par `outils/production.mjs`
   avant qu'un déploiement ne le trouve pour nous.

   Cette liste est un manifeste de livraison. Les tests la lisent aussi, comme
   n'importe qui d'autre. */

/* Les modules que `index.html` charge lui-même, dans l'ordre où il les
   déclare. Chacun est servi en cache immuable, donc chacun porte l'empreinte
   de son contenu dans son URL. */
export const MODULES = [
  "availability.js", "comprendre.js", "donnees.js", "intentions.js", "comptes.js",
  "maintenant.js", "ordonnanceur.js", "contexte.js", "territoire.js", "plafonds.js", "aide.js",
  "signaux.js", "temporel.js", "explications.js", "events.js", "images.js", "core.js",
  "providers/normaliser.js", "providers/googlePlaces.js", "providers/datatourisme.js",
  "providers/osm.js", "providers/decouvertes.js",
  "mapProviders/googleMaps.js", "app.js",
];

/* Les modules que la page ne charge PAS : `app.js` va les chercher au besoin.
   Leur URL doit changer avec leur contenu pour exactement la même raison — ils
   sont servis en cache immuable — mais l'empreinte ne peut pas vivre dans
   `index.html`, qui ne les mentionne jamais. Elle vit dans
   `VERSIONS_DIFFEREES`, dans `app.js`. */
export const MODULES_DIFFERES = ["differe/ecrans.js"];
