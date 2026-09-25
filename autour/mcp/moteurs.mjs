/* ===========================================================================
   LES MOTEURS D'AUTOUR, CHARGÉS TELS QUELS CÔTÉ SERVEUR

   L'intégration ChatGPT ne devait recréer aucun moteur. La question était donc
   : peut-on exécuter, dans une fonction serveur, EXACTEMENT les modules que la
   page charge ? Mesuré le 25/09/2026 : les quarante modules de
   `outils/modules.mjs` s'importent dans Node sans une seule erreur, à deux
   exceptions près qui ne concernent pas ce serveur — `mapProviders/googleMaps.js`
   (une carte) et `app.js` (le document, le DOM, les écrans).

   Ce fichier ne fait donc qu'une chose : les charger DANS L'ORDRE DU MANIFESTE
   de livraison, et rendre les objets globaux qu'ils publient. `temporel.js`
   décide du temps, `maintenant.js` de ce qui est possible tout de suite,
   `aide-*.js` de ce qui aide, `core.js` de la taxonomie et de la diversité.
   Aucune de ces règles n'est réécrite ici, et c'est le point : ChatGPT verra
   ce que voit l'application, classé comme l'application le classe.

   L'ORDRE N'EST PAS DÉCORATIF. `core.js` lit `pertinence.js` et
   `contexte-moteur.js` ; `aide.js` lit `aide-intentions.js` ; les providers
   lisent `aide-structures.js`. Charger dans un autre ordre donne des modules
   à moitié câblés — c'est pour cela qu'on relit le manifeste plutôt que de
   tenir une seconde liste.
   ======================================================================== */

import "./fenetre.mjs";

/* LES IMPORTS SONT STATIQUES, ET CE N'EST PAS UN DÉTAIL DE STYLE.

   La première version bouclait sur `MODULES` avec `await import("../" + m)`.
   C'est correct dans Node, et intenable en production : le constructeur de
   paquets de l'hébergeur ne peut pas résoudre un chemin calculé, donc aucun de
   ces quarante-six fichiers ne serait embarqué dans la fonction déployée. Le
   serveur démarrerait, puis échouerait au premier appel — sur une erreur de
   module introuvable, c'est-à-dire là où personne ne regarde.

   La liste ci-dessous est donc écrite, dans l'ordre du manifeste de livraison,
   et un test vérifie qu'elle ne s'écarte jamais de `outils/modules.mjs`. */
import "../availability.js";
import "../comprendre.js";
import "../donnees.js";
import "../aide-intentions.js";
import "../intentions.js";
import "../comptes.js";
import "../maintenant.js";
import "../ordonnanceur.js";
import "../zones-autonomes.js";
import "../adresse.js";
import "../contexte.js";
import "../territoire.js";
import "../plafonds.js";
import "../annonces-taxonomie.js";
import "../annonces-classement.js";
import "../envies.js";
import "../apprentissage.js";
import "../pertinence.js";
import "../cycle-evenement.js";
import "../grille.js";
import "../contexte-moteur.js";
import "../enrichissements.js";
import "../aide-taxonomie.js";
import "../aide-classement.js";
import "../aide-structures.js";
import "../aide-rayon.js";
import "../aide-contexte-ia.js";
import "../aide.js";
import "../signaux.js";
import "../temporel.js";
import "../evenements-canoniques.js";
import "../entites-canoniques.js";
import "../explications.js";
import "../events.js";
import "../images.js";
import "../core.js";
import "../providers/normaliser.js";
import "../providers/googlePlaces.js";
import "../providers/datatourisme.js";
import "../providers/osm.js";
import "../providers/decouvertes.js";
import "../providers/aideInstitutionnelle.js";
import "../providers/aideAutour.js";
import "../providers/aideDora.js";
import "../providers/aideFiness.js";
import "../providers/aideDecouverte.js";

/* Ce que la page charge et que le serveur n'a pas à charger : `app.js` EST
   l'interface (document, écrans, gestes) et `mapProviders/` est une carte.
   Aucun des deux ne s'importe sans DOM, et aucun n'a de rôle ici. */
export const HORS_SERVEUR = Object.freeze(["mapProviders/googleMaps.js", "app.js"]);

let charges = null;

export async function moteurs() {
  if (charges) return charges;
  charges = Object.freeze({
    AIDE: globalThis.AutourAide,
    AIDE_CLASSEMENT: globalThis.AutourAideClassement,
    AIDE_RAYON: globalThis.AutourAideRayon,
    AIDE_STRUCTURES: globalThis.AutourAideStructures,
    AIDE_TAXONOMIE: globalThis.AutourAideTaxonomie,
    ANNONCES_CLASSEMENT: globalThis.AutourAnnoncesClassement,
    ANNONCES_TAXONOMIE: globalThis.AutourAnnoncesTaxonomie,
    AVAILABILITY: globalThis.AutourAvailability,
    COMPRENDRE: globalThis.AutourComprendre,
    CORE: globalThis.AutourCore,
    DONNEES: globalThis.AutourDonnees,
    ENTITES: globalThis.AutourEntites,
    EVENEMENTS: globalThis.AutourEvenements,
    IMAGES: globalThis.AutourImages,
    INTENTIONS: globalThis.AutourIntentions,
    MAINTENANT: globalThis.AutourMaintenant,
    PROVIDERS: globalThis.AutourProviders,
    TEMPS: globalThis.AutourTemps,
    ZONES: globalThis.AutourZones,
  });
  return charges;
}

/* Un manquant est une panne de chargement, pas un cas à contourner : un
   serveur qui répondrait sans `maintenant.js` inventerait son propre
   classement, ce que ce chantier interdit explicitement. */
export async function moteursVerifies() {
  const m = await moteurs();
  const absents = Object.entries(m).filter(([, valeur]) => !valeur).map(([nom]) => nom);
  if (absents.length) throw new Error("moteurs_absents:" + absents.join(","));
  return m;
}
