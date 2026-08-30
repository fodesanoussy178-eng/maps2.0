/* =========================================================================
   Autour — le corps de l'application.

   Ce fichier vivait en ligne dans `index.html`, à la fin d'un document de
   680 ko. Conséquence mesurée sur un téléphone, réseau mobile ordinaire :
   PAS UNE LIGNE de ce code ne s'exécutait avant que les 680 ko ne soient
   entièrement arrivés — 1,9 s à la première visite, et autant à CHAQUE visite
   suivante, puisqu'un document HTML se revalide alors qu'un fichier .js
   s'archive pour un an.

   Sorti ici, servi en cache immuable comme les autres modules :

                        avant        après
     document           1270 ms      316 ms
     interface vivante  1351 ms      411 ms
     premières cartes   1501 ms      591 ms

   C'est le même code, au même endroit dans l'ordre d'exécution — `defer`
   conserve l'ordre du document et place l'exécution juste après l'analyse,
   soit exactement là où le script en ligne se trouvait, en queue de corps.
   ========================================================================= */

function panne(titre, corps){
  const p = document.getElementById("panne");
  p.innerHTML = "<strong>"+titre+"</strong>"+corps+
    '<button onclick="document.getElementById(\'panne\').hidden=true">Fermer</button>';
  p.hidden = false;
}
/* Diagnostic. Silencieux par défaut : ces lignes servaient à mettre au point
   le pipeline, et elles partaient dans la console de tout le monde — du bruit,
   et un aperçu gratuit du fonctionnement interne. `__autourDebug = true` les
   rallume. Les vraies erreurs, elles, passent toujours par console.error. */
const TEMPS = window.AutourTemps;
const EXPLIQUE = window.AutourExplications;
const COMPRENDRE = window.AutourComprendre;
const SIGNAUX = window.AutourSignaux;
const DONNEES = window.AutourDonnees;
const AIDE = window.AutourAide;
const EVENEMENTS = window.AutourEvenements;
const ENTITES = window.AutourEntites;
/* LE RÉSOLVEUR D'IMAGE. IL N'Y EN A QU'UN.

   Toute question « quelle photo pour ce lieu, et de quel droit ? » passe par
   lui — les tags OSM, Wikimedia, une affiche d'événement, une photo Places.
   Le rendu ne l'appelle jamais : il lit `image` et `imageSource` comme avant,
   aux mêmes emplacements, avec le même repli teinté. Voir `images.js`. */
const IMAGES = window.AutourImages || null;

/* Cette normalisation appartenait historiquement au bloc GBFS. Le transport
   interne a disparu, mais la recherche, le classement et la déduplication
   l'utilisent toujours : elle doit donc vivre avec leurs dépendances communes. */
function sansAccents(s){
  if(COMPRENDRE && COMPRENDRE.sansAccents) return COMPRENDRE.sansAccents(s);
  return String(s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

const journal = {
  info(...a){ if(window.__autourDebug) console.info(...a); },
  warn(...a){ if(window.__autourDebug) console.warn(...a); },
};

/* Une exception est une information pour qui développe, jamais pour qui
   cherche où manger. « Ça a coincé · TypeError: undefined is not an object »
   s'affichait en plein écran sur mobile : c'était à la fois inutilisable et
   alarmant, et ça masquait une application qui, elle, continuait de marcher.
   Les erreurs vont dans la console ; l'écran, lui, garde ce qu'il montrait. */
window.addEventListener("error", e=>{
  console.error("Autour :", e && (e.error || e.message || e));
});
window.addEventListener("unhandledrejection", e=>{
  console.error("Autour · promesse rejetée :", e && e.reason);
});

const {
  FAMILY_CATEGORIES,
  classifyPlace,
  toCommonItem,
  matchesCategory,
  dedupeItems,
  groupLogicalPlaces,
  isDiscoveryCandidate,
  parseSearchQuery,
  isAvailableNow,
  rankResults,
} = window.AutourCore;

/* Déclarés ici parce que le démarrage les lit bien avant les blocs qui les
   définissent : sans ça, la zone morte temporelle casse le premier rendu. */
let villeDetectee = null;
let canauxAMoi = [];

/* ---- Recherche géographique ----------------------------------------------
   « Tourcoing », « Wazemmes » : on déplace la carte vers la zone et on
   n'affiche d'abord que trois à cinq résultats fortement pertinents. Le reste
   se charge derrière, sans bloquer. */
/* ---- Où est la personne, et à quel point le sait-on ----------------------
   Deux questions distinctes, deux variables. Les confondre a produit exactement
   le défaut qu'on corrige ici : une ville déduite d'une adresse IP s'est mise à
   valoir position, et l'application a annoncé « Lille » à quelqu'un qui n'y
   était pas.

   D'OÙ elle vient :
     · "gps"    — le navigateur l'a mesurée. SEULE source autorisée à dire où
                  est la personne.
     · "server" — déduite de l'adresse IP par le bord du réseau. Sur un réseau
                  mobile, c'est souvent la passerelle de l'opérateur, à des
                  dizaines de kilomètres. Cela sert à choisir la bonne zone de
                  données, rien d'autre.
     · "manual" — une zone choisie à la main.
     · null     — on ne sait pas, et on le dit.

   CE QU'ELLE VAUT :
     · "point"  — à quelques mètres. On peut parler en minutes de marche.
     · "ville"  — à quelques kilomètres. On ne peut rien promettre de précis.

   Déclaré ici parce que le démarrage et les premiers rendus le lisent
   immédiatement. */
let originePosition = null;          // "gps" | "server" | "manual" | null
let precisionPosition = null;        // "point" | "ville" | null
const positionConnue = ()=>originePosition !== null;
const positionPrecise = ()=>precisionPosition === "point";
const positionApprochee = ()=>positionConnue() && !positionPrecise();

/* ====================================================================
   LA ZONE ACTIVE, ET LA PORTÉE QUI VA AVEC

   Le mélange venait de ce qu'aucune ligne de code ne savait répondre à « de
   quelle zone parle-t-on en ce moment ? ». Chacune choisissait son point : la
   position physique, la ville cherchée, le centre de la carte. Résultat vécu :
   à Tourcoing, on cherche Lille, et il reste des lieux de Tourcoing dans
   « Maintenant », sur la carte et dans les recommandations.

   Il y a désormais DEUX choses, nommées, et une seule commande :

     · `positionMoi` — où la personne est physiquement. Elle sert au point
       bleu, à l'itinéraire, à « suis-je sur place ? ». Elle ne sélectionne
       plus rien.
     · `zoneActive`  — la zone dont Autour parle. C'est ELLE qui filtre les
       lieux, les événements, « Maintenant », les marqueurs, le classement et
       les clés de cache.

   LA PORTÉE (`porteeCourante`) est le numéro de la zone active. Tout travail
   asynchrone la note au départ et la revérifie à l'arrivée : une réponse de
   Tourcoing qui revient après le passage à Lille porte l'ancienne portée et
   est jetée, quelle que soit la source qui l'a produite. */
const CTX = window.AutourContexte || null;
const ECRANS_DIFFERES = [
  /* la fiche d'un lieu */
  "ouvrirFicheCompacte", "ouvrirDetail", "faitsAide",
  /* l'itinéraire */
  "afficherTrajet", "entrerNav", "itineraireOSRM", "dessinerSegments",
  "urlItineraireExterne", "liensItinerairesExternes",
  /* publier */
  "ouvrirChoixLieu", "dessinerFormulaire", "publier",
  "reessayerPublication", "annulerPublication", "continuerPublication",
  /* le compte, le profil et les canaux */
  "ouvrirEcranCompte", "rendreEcranCompte", "ouvrirProfil",
  "ouvrirMesPublications", "ouvrirCanaux", "envoyerLienCompte",
  "verifierCodeCompte", "enregistrerProfilCompte", "seDeconnecter",
  "chargerCanal", "actionCreateur", "partagerInviter",
];
const VERSIONS_DIFFEREES = {"differe/ecrans.js":"?v=c1ddb950"};

/* ---- Les écrans différés ------------------------------------------------
   Ouvrir la fiche d'un lieu, un itinéraire, le formulaire de publication ou
   le compte, ce sont des gestes — pas le démarrage. Leur code vit dans
   `differe/ecrans.js`, qui n'est pas chargé avec la page.

   Chaque nom ci-dessous existe quand même dès la première seconde, sous la
   forme d'une amorce : elle réclame le fichier, puis rappelle la vraie
   fonction, qui l'a remplacée entre-temps. L'appelant ne change pas, et
   l'écran ne se vide jamais — `charge()` garde ce qui est affiché et pose
   une pastille discrète le temps de l'aller-retour.

   Le fichier est de toute façon demandé à l'inactivité juste après le
   démarrage : en usage réel, il est là bien avant le premier appui. */
const MODULE_ECRANS = "differe/ecrans.js";
const modulesDifferes = new Map();

function auBesoin(module){
  const dejaLa = modulesDifferes.get(module);
  if(dejaLa) return dejaLa;
  const promesse = new Promise((tenu, rompu)=>{
    const balise = document.createElement("script");
    balise.src = module + (VERSIONS_DIFFEREES[module] || "");
    /* `async = false` sur une balise injectée : l'ordre d'exécution reste
       celui des injections. Un seul module aujourd'hui, mais la règle évite
       d'avoir à y repenser le jour où il y en aura deux. */
    balise.async = false;
    balise.onload = ()=>tenu(true);
    balise.onerror = ()=>rompu(new Error("module indisponible : "+module));
    document.head.appendChild(balise);
  }).catch(err=>{
    /* Un échec ne doit pas condamner le geste suivant : on oublie la
       promesse rompue pour qu'un nouvel appui retente le téléchargement. */
    modulesDifferes.delete(module);
    throw err;
  });
  modulesDifferes.set(module, promesse);
  return promesse;
}

/* L'amorce d'un écran : demander le module, puis passer la main à la vraie
   fonction. `amorce` marque celles-ci — si le module est arrivé sans la
   remplacer, on s'arrête là plutôt que de tourner en rond. */
function ecranAuBesoin(nom, args){
  charge("Ouverture…");
  return auBesoin(MODULE_ECRANS).then(()=>{
    charge(null);
    const vraie = window[nom];
    if(typeof vraie !== "function" || vraie.amorce === true)
      throw new Error("écran manquant : "+nom);
    return vraie.apply(null, args);
  }).catch(err=>{
    /* Un geste sans réponse est pire qu'un refus : la personne réappuie sans
       savoir. On retire l'indicateur, on le dit, et le prochain appui
       retentera le téléchargement. */
    charge(null);
    majSignalMaj(false);
    console.error("Écran différé :", err.message);
    toast("Écran indisponible — réessaie dans un instant");
  });
}

function amorcerEcrans(){
  ECRANS_DIFFERES.forEach(nom=>{
    const amorce = function(){ return ecranAuBesoin(nom, arguments); };
    amorce.amorce = true;
    window[nom] = amorce;
  });
}
amorcerEcrans();

/* Le préchargement : dès que le démarrage a rendu la main, on va chercher les
   écrans en tâche de fond. Il ne dispute rien au chemin critique — la tranche
   d'inactivité attend que le fil principal soit libre — et il fait que le
   premier appui trouve le module déjà là. */
function prechargerEcrans(){
  const aller = ()=>{ auBesoin(MODULE_ECRANS).catch(()=>{}); };
  if(ORDO && ORDO.differer) ORDO.differer(aller, {timeout:4000});
  else setTimeout(aller, 2000);
}

const PLAF = window.AutourPlafonds || null;
let zoneActive = null;
/* Contrat unique des résultats : tous les écrans lisent ce contexte, jamais
   le GPS brut. La position physique reste dans `positionMoi` pour le point
   bleu, les itinéraires et le bouton « revenir autour de moi » ; elle ne peut
   pas remettre des données dans une destination choisie. */
let activeLocationContext = null;
let porteeCourante = 0;
const porteeValide = (p)=> p === porteeCourante;

function contexteDepuisZone(zone){
  if(!zone) return null;
  const recherche = !!(zone.type === "recherche" ||
    (CTX && zone.type === CTX.TYPES.RECHERCHE));
  return Object.freeze({
    mode: recherche ? "destination" : "gps",
    source: recherche ? "search" : "gps",
    key: CTX ? CTX.idZone(zone) : zone.type+":"+zone.lat.toFixed(2)+","+zone.lng.toFixed(2),
    lat: zone.lat, lng: zone.lng,
    city: zone.nom || null,
    zone,
  });
}

function contexteLocalisationActif(){ return activeLocationContext; }
function destinationActive(){ return activeLocationContext?.mode === "destination"; }

/* Changer de destination doit être une frontière de données, pas seulement
   un filtre d'affichage. Les caches par coordonnées restent valides, mais les
   collections en mémoire sont vidées afin qu'aucun ancien objet ne puisse
   atteindre une surface avant la réponse de la nouvelle zone. */
function viderDonneesContexte(){
  permanentPlaces = [];
  datatourismePlaces = [];
  externalEvents = [];
  userPublications = [];
  lieux = [];
  publies = userPublications;
  dernierClassement = [];
  revisionLieux += 1;
  indexCategories.clear();
  zonesVues.clear();
  chargementsTemporaires.clear();
  derniersChargementsTemporaires.clear();
  requetesCouchesSupabase.clear();
  signaturesCouchesPubliees.clear();
  zonesResto.clear();
  restaurationsEnCours.clear();
  prechargementFait = false;
  prechargementEnCours = false;
  recoCache = null;
  recoBurstCache = null;
  generationAccueil += 1;
}

/* Le seul endroit qui change de zone. Il incrémente la portée — ce qui périme
   d'un coup tout travail en vol — et rend le nouveau numéro à l'appelant. */
function definirZoneActive(zone){
  if(CTX && zoneActive && zone && CTX.memeZone(zoneActive, zone)){
    activeLocationContext = activeLocationContext || contexteDepuisZone(zone);
    return porteeCourante;
  }
  zoneActive = zone || null;
  activeLocationContext = contexteDepuisZone(zoneActive);
  porteeCourante += 1;
  viderDonneesContexte();
  /* Les mémoires qui portent sur « les lieux qu'on montre » ne valent plus
     rien : elles ont été calculées pour l'autre ville. */
  oublierItemsMaintenant();
  recoCache = null;
  // le report d'affichage du §7 ne franchit pas une frontière de zone : garder
  // les cartes d'une ville qu'on vient de quitter serait afficher du faux
  dernierRecoRendu = null;
  selectionAccueil = null;
  /* Le bassin est une donnée de la zone, pas une préférence globale. Tant que
     la nouvelle résolution n'a pas répondu, conserver celui de la ville
     précédente permettait à « Pour toi » d'afficher des événements d'un autre
     bassin — particulièrement visible lors d'un Paris demandé depuis la MEL.
     Les réponses en vol sont en plus gardées sous la portée ci-dessous et ne
     pourront donc pas repeupler ces mémoires périmées. */
  bassinTerritorialActif = null;
  evenementsMetropole = [];
  metropoleEnCours = null;
  return porteeCourante;
}

/* La question posée partout où l'on montre quelque chose. Sans zone déclarée
   — tout début de session, avant la géolocalisation — on ne filtre rien :
   mieux vaut montrer ce qu'on a que de vider l'écran par principe. */
function dansZoneActive(l){
  const zone = activeLocationContext?.zone || zoneActive;
  if(!CTX || !zone) return true;
  return CTX.dansZone(l, zone, {vue: bornesVue()});
}

/* Entonnoir commun des trois surfaces géographiques : carte/Explorer,
   Maintenant et Pour toi partent tous du même ensemble avant d'appliquer
   leurs règles propres (temps, catégories ou surveillance). */
function elementsDuContexte(items){
  return (items || []).filter(dansZoneActive);
}
/* CE FILTRE EST APPELÉ UNE FOIS PAR LIEU, ET IL Y EN A CENT TRENTE.

   La première version demandait ses bornes à Leaflet à chaque appel. Cent
   trente `getBounds()` par passe, cinq passes par rendu, plusieurs rendus au
   démarrage : le banc de vitesse a vu le blocage du fil principal passer de
   1 815 à 2 556 ms sur un centre dense — un filtre qui ne fait rien de coûteux,
   rendu coûteux par la façon dont il pose sa question.

   Les bornes ne peuvent pas changer PENDANT un passage : un déplacement de
   carte est un autre tour de boucle. On les calcule donc une fois par tour, et
   la micro-tâche remet le compteur à zéro — ce qui rend l'oubli impossible,
   contrairement à une invalidation qu'il faudrait penser à écrire sur chaque
   événement de la carte. */
let bornesVueMemo = null;
function bornesVue(){
  if(bornesVueMemo) return bornesVueMemo.v;
  let v = null;
  if(map && map.getBounds){
    try{
      const b = map.getBounds();
      v = [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]];
    }catch(e){ v = null; }
  }
  bornesVueMemo = {v};
  queueMicrotask(()=>{ bornesVueMemo = null; });
  return v;
}
/* Le centre dont TOUT parle : classement, distances, sélection. Il vaut la
   ville cherchée dès qu'il y en a une, et la position physique sinon. */
function centreZoneActive(){
  if(activeLocationContext) return [activeLocationContext.lat, activeLocationContext.lng];
  if(zoneActive) return [zoneActive.lat, zoneActive.lng];
  return positionMoi;
}
const idZoneActive = ()=> CTX
  ? CTX.idZone(activeLocationContext?.zone || zoneActive)
  : (activeLocationContext?.key || "sans-zone");

/* LA DISTANCE AUSSI PART DE LA ZONE.

   « 12 km » sur chacune des cinq cartes de Lille n'apprend rien à quelqu'un
   qui prépare sa soirée à Lille : c'est la distance entre deux villes, répétée
   cinq fois. Ce qu'il veut savoir, c'est si les deux endroits qu'il compare
   sont à côté l'un de l'autre — et cela se mesure depuis la zone regardée.
   Sans ville cherchée, la zone EST la position : le calcul ne change pas d'un
   mètre pour l'immense majorité des usages. */
/* Le point de départ de toute REQUÊTE de données. Même règle que pour
   l'affichage : on demande à la zone dont on parle, jamais à celle qu'on a
   quittée. */
function centreDonnees(){ return centreZoneActive() || null; }
function chargerAideZone(options){
  const c = centreDonnees();
  return c ? chargerAide(c[0], c[1], options) : Promise.resolve([]);
}

function distanceDepuisZone(l){
  const c = centreZoneActive();
  if(!c || !l) return NaN;
  return distanceM(c[0], c[1], l.lat, l.lng);
}

let rechercheGeo = null;              // {nom, lat, lng} de la zone visée
/* La zone dont la feuille affiche les résultats. Null = recommandations
   habituelles. C'est ce qui permet aux résultats de survivre à l'arrivée des
   données, qui redessine la feuille une seconde plus tard.
   Déclaré ici, avec rechercheGeo : majFeuille2() le lit dès le premier rendu,
   bien avant le bloc qui définit ouvrirResultatsZone. */
let zoneAffichee = null;
/* ---- À distance un aperçu, sur place la découverte ------------------------
   Chercher « restaurant Lille » depuis Tourcoing et y être vraiment ne
   demandent pas la même réponse. De loin on se renseigne : quelques
   propositions suffisent, et en montrer trente serait promettre une
   connaissance du terrain qu'on n'a pas — ce qui a fermé, ce qui est plein,
   ce qui vaut le détour à cette heure-ci. Sur place, c'est l'inverse : il faut
   du choix, tout de suite.

   LA DISTANCE DÉCIDE, PAS LA FRONTIÈRE. Une limite communale ne se sent pas
   sous les pieds : quelqu'un à trois cents mètres du panneau « Lille » vit la
   même ville que celui qui est trois cents mètres après. Un seuil administratif
   lui donnerait pourtant deux expériences opposées. On gradue donc par
   kilomètres, et l'emprise ne sert qu'à reconnaître qu'on est DANS la ville —
   jamais à exclure quelqu'un qui la borde.

   Quatre régimes, du plus proche au plus lointain. Les seuils viennent de la
   métropole lilloise, qui est le terrain d'origine : Tourcoing→Roubaix fait
   cinq kilomètres et doit rester ouvert, Tourcoing→Lille en fait douze et
   devient un aperçu, Tourcoing→Paris deux cents et se réduit à l'essentiel. */
const REGIMES = {
  local:   { resultats: 10, rayon: 1500, limite: 300 },   // ici, ou tout contre
  proche:  { resultats:  5, rayon: 1200, limite: 120 },   // l'agglomération
  voisine: { resultats:  4, rayon: 1000, limite:  80 },   // la même région
  loin:    { resultats:  3, rayon:  800, limite:  50 },   // l'autre bout du pays
};
const SEUIL_LOCAL_M   = 8000;      // au-delà de Roubaix depuis Tourcoing
const SEUIL_PROCHE_M  = 30000;     // l'agglomération et ce qui la touche
const SEUIL_VOISINE_M = 120000;    // la région

function dansEmprise(coords, emprise){
  if(!coords || !Array.isArray(emprise) || emprise.length !== 2) return false;
  const [[sud, ouest], [nord, est]] = emprise;
  return coords[0] >= sud && coords[0] <= nord
      && coords[1] >= ouest && coords[1] <= est;
}

/* À quelle distance de la zone regardée sommes-nous, vraiment ?
   Sans zone visée, on est chez soi. Sans position mesurée par le navigateur,
   on ne peut pas AFFIRMER qu'on y est : une ville choisie à la main ou déduite
   de l'adresse IP n'est pas une présence, et n'ouvre donc jamais le régime
   local — c'est la même règle que pour la pastille de lieu. */
/* `depuis` et `mesuree` permettent de poser la question pour une position
   qu'on vient de recevoir mais pas encore adoptée : c'est ce qui laisse la
   veille reconnaître une arrivée AVANT de l'appliquer. */
function regimeZone(zone, depuis, mesuree){
  if(!zone) return "local";                    // pas de recherche : on est ici
  const pos = depuis || positionMoi;
  if(!pos) return "loin";
  const sure = mesuree === undefined ? positionPrecise() : !!mesuree;
  const d = distanceM(pos[0], pos[1], zone.lat, zone.lng);
  if(sure && (dansEmprise(pos, zone.emprise) || d <= SEUIL_LOCAL_M))
    return "local";
  if(d <= SEUIL_PROCHE_M)  return "proche";
  if(d <= SEUIL_VOISINE_M) return "voisine";
  return "loin";
}
/* Le même barème, mais à partir d'un point plutôt que d'une zone nommée.
   C'est ce qui protège les requêtes : la carte se recharge aussi toute seule
   quand elle bouge, et sans cela un déplacement vers Marseille repartait en
   pleine charge — la ville lointaine était interrogée par la porte de derrière.
   Ici la distance suffit : il ne s'agit pas de dire à quelqu'un où il est,
   seulement de décider combien on va demander. */
function regimePoint(lat, lng){
  /* Une carte déplacée après une recherche reste dans la destination
     choisie : le GPS ne doit pas réduire Paris à un chargement « lointain »
     depuis Tourcoing. Au repos, le point physique et le contexte GPS
     coïncident, donc le comportement local reste inchangé. */
  const reference = destinationActive() ? centreZoneActive() : positionMoi;
  if(!reference) return "local";
  const d = distanceM(reference[0], reference[1], lat, lng);
  if(d <= SEUIL_LOCAL_M)   return "local";
  if(d <= SEUIL_PROCHE_M)  return "proche";
  if(d <= SEUIL_VOISINE_M) return "voisine";
  return "loin";
}
/* `regimeZone` reste la mesure de présence physique utilisée uniquement par
   la veille GPS. Les résultats, eux, ont leur propre régime : une destination
   volontaire est locale pour le calcul demandé, quelle que soit la position
   réelle conservée pour le retour. */
function regimeZoneResultats(zone){
  const active = activeLocationContext;
  const memeDestination = destinationActive() && zone && (
    zone === rechercheGeo || (active.zone &&
      active.zone.lat === zone.lat && active.zone.lng === zone.lng));
  return memeDestination ? "local" : regimeZone(zone);
}
const reglagesZone = (zone)=> REGIMES[regimeZoneResultats(zone)];
const plafondPour = (zone)=> reglagesZone(zone).resultats;
const plafondResultats = ()=> plafondPour(rechercheGeo);
const surPlace = ()=> regimeZoneResultats(rechercheGeo) === "local";

/* Une requête est géographique si elle n'est pas, EXACTEMENT, un mot du
   vocabulaire de l'application : on ne géocode pas « pizza », mais on géocode
   « Bar-le-Duc ». Aucune ville n'est listée nulle part — c'est le géocodeur
   qui tranche, et lui seul. */
function ressembleAUneZone(q){
  const texte = (q||"").trim();
  if(texte.length < 3) return false;
  if(estTermeMetier(texte)) return false;
  /* Et surtout : ce morceau n'est pas du vocabulaire de l'application. Sans
     cette question, « un endroit calme où travailler » partait géocoder la
     commune « où travailler », et « ouvert tard après 20h » la commune
     « 20h ». Une ville, elle, n'est comprise par personne ici — c'est
     exactement ce qui la distingue. */
  if(COMPRENDRE && COMPRENDRE.estVocabulaire(texte, {
    cuisineDe: cuisineRecherchee, categorieDe: categorieRecherchee,
  })) return false;
  return /^[\p{L}\d\s'’-]+$/u.test(texte);
}

/* Cadrage : on suit l'emprise réelle de la zone, bornée des deux côtés.
   Sans borne haute, un hameau remplissait l'écran d'un seul pâté de maisons ;
   sans borne basse, une métropole s'affichait de si loin que plus aucune
   étiquette ne tenait. */
/* En deçà, la zone visible couvre trop de terrain pour qu'Overpass réponde
   quelque chose d'exploitable. Le cadrage d'une recherche s'aligne sur ce
   seuil : poser la carte plus loin la laissait sans aucun lieu, et rien ne
   disait pourquoi. */
const ZOOM_MIN_CHARGEMENT = 13;

const ZOOM_ZONE_MAX = 15;
/* La borne basse n'est pas choisie : c'est le seuil en dessous duquel le
   chargement des lieux ne part pas. Les laisser diverger posait la carte sur
   Paris ou Marseille au zoom 12, où aucun POI n'était demandé — carte au bon
   endroit, écran vide, aucune explication. */
const ZOOM_ZONE_MIN = ZOOM_MIN_CHARGEMENT;

async function rechercheGeographique(q, generationOuSignal){
  const generationRecherche = generationOuSignal && generationOuSignal.controleur
    ? generationOuSignal : null;
  const signal = generationRecherche ? generationRecherche.signal : generationOuSignal;
  const zone = await geocoderVille(q, null, signal);
  if(!zone || !map) return false;
  /* Le nom de la zone ne doit pas rester un filtre plein texte sur les lieux :
     une fois la carte à Lille, garder « lille » comme requête faisait remonter
     « Gare Lille Flandres » au titre de correspondance explicite — donc des
     arrêts de transport, que cette passe range précisément par défaut.
     La destination a servi à déplacer la carte ; son travail est fini. */
  recherche = "";
  if($("#rech")) $("#rech").value = "";

  if(zone.emprise){
    cadrerSur(zone.emprise, {maxZoom:ZOOM_ZONE_MAX, padding:[24,24], animate:true});
    surLaCarte((m)=>{ if(m.getZoom() < ZOOM_ZONE_MIN) m.setZoom(ZOOM_ZONE_MIN); }, "zoom-mini");
  }else{
    allerVers([zone.lat, zone.lng], ZOOM_ZONE_MAX, {duration:.8});
  }

  /* Un seul point de référence : celui que la carte montre effectivement.
     Le géocodeur donne aussi un « point de la commune » — mairie ou centroïde
     — qui n'est pas le centre de l'emprise. À Bordeaux les deux sont à 2,9 km
     l'un de l'autre : les lieux étaient chargés autour du centre affiché, puis
     classés depuis le point géocodé, et TOUS tombaient hors du rayon de
     recherche. Zéro résultat sur une ville pleine de lieux. */
  /* MAIS PAS LE CENTRE D'AVANT LE VOYAGE.

     Cette ligne lisait `map.getCenter()` juste après avoir lancé `cadrerSur`.
     Or ce cadrage est ANIMÉ : au moment où on l'interroge, la carte n'a pas
     bougé d'un pixel et rend encore le centre de la ville qu'on quitte. Mesuré
     au banc : la zone « Lille » naissait avec la latitude de Tourcoing, et la
     zone « Paris » avec celle de Lille. L'emprise sauvait le filtrage ; le
     classement, les distances et le point interrogé, eux, restaient à la
     ville précédente — exactement le mélange qu'on répare.

     On prend donc le centre de l'emprise : c'est là que la carte va se poser,
     et c'est le même point pour charger et pour classer — l'invariant qui
     avait été posé pour Bordeaux, où le point géocodé et le centre affiché
     sont à 2,9 km l'un de l'autre. */
  const e = zone.emprise;
  const c = map.getCenter();
  const centre = e ? [(e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2]
                   : (c ? [c.lat, c.lng] : [zone.lat, zone.lng]);
  /* L'emprise est retenue avec la zone : c'est elle qui dira ensuite si la
     personne est vraiment dans cette ville ou si elle la regarde de loin. */
  rechercheGeo = {nom:q, lat:centre[0], lng:centre[1], emprise:zone.emprise || null};
  /* LE BASCULEMENT DE CONTEXTE, EN UN SEUL GESTE.

     Tout ce qui suit dépend de cette ligne : la nouvelle portée périme les
     requêtes de l'ancienne zone (leur réponse sera jetée à l'arrivée), vide
     les mémoires de classement et de disponibilité, et libère la sélection
     d'accueil. À partir d'ici, `dansZoneActive` répond « non » pour tout ce
     qui vient d'ailleurs — marqueurs compris, puisque `rendre()` retire ce
     qu'il ne garde pas. */
  definirZoneActive(CTX ? CTX.zoneRecherche(q, centre, zone.emprise || null) : null);
  /* Cette génération pilote le CHANGEMENT de portée : elle naît donc dans
     l'ancienne zone et doit être rattachée à celle qu'elle vient de créer.
     Les générations de données, elles, restent volontairement périmées. */
  if(generationRecherche && generationsActives.get(generationRecherche.canal) === generationRecherche)
    generationRecherche.portee = porteeCourante;
  /* La génération qui a obtenu cette ville est encore celle que l'appelant
     doit valider juste après notre retour. L'annuler avec les anciennes
     requêtes laissait la carte bouger, mais empêchait le panneau de prendre le
     nouveau contexte. */
  annulerChargementsZone("recherche:zone");
  /* LE HUB DE LA VILLE DEMANDÉE D'ABORD. Les tuiles précalculées existent pour
     les grands centres ; si celle de la ville visée est là, elle remplit
     l'écran sans attendre Overpass. Elle porte la portée du moment : arrivée
     après un nouveau changement de zone, elle est jetée comme le reste. */
  precalculPourZone(centre[0], centre[1], porteeCourante);
  /* Choisir une ville à la main, c'est dire soi-même où l'on regarde : c'est
     donc une position, et une position VOULUE — mais à l'échelle d'une ville,
     pas d'un point. On l'enregistre comme telle quand on n'avait rien, sans
     jamais écraser une mesure du navigateur. */
  if(!positionPrecise()){
    originePosition = "manual"; precisionPosition = "ville";
  }

  /* Redessiner tout de suite, sans attendre le réseau. Deux raisons :
     · la zone peut être déjà chargée — chargerZone ne repart alors pas, aucune
       donnée n'arrive, et rien ne déclenchait de rendu : les marqueurs de la
       vue précédente restaient posés sur la nouvelle ville ;
     · même quand elle charge, on veut voir immédiatement ce qu'on a déjà
       plutôt qu'un écran figé pendant la requête. */
  selectionAccueil = null;      // les recommandations se recalculent pour ici
  rendre();
  majAccueil();
  /* En mode Aide, changer de commune doit chercher les points d'aide de LÀ.
     Sans ça, on regardait Lille avec les adresses de son quartier de départ. */
  if(modeAide) chargerAide(centre[0], centre[1]);

  // les lieux de la nouvelle zone arrivent derrière : l'interface n'attend pas
  /* La profondeur de la requête suit la distance : une ville où l'on n'est pas
     n'est interrogée que le nécessaire (voir REGIMES). */
  /* `ZOOM_ZONE_MIN` est le plancher que les deux branches du cadrage
     garantissent juste au-dessus : c'est donc le niveau le plus bas où la
     carte peut se poser, et le seul honnête à annoncer pendant qu'elle vole. */
  chargerZone(centre[0], centre[1],
    {reglages: reglagesZone(rechercheGeo), zoomVise: ZOOM_ZONE_MIN});
  majBoutons();
  return true;
}

/* ---- Favoris, côté écran ------------------------------------------------
   L'identité est anonyme : personne ne crée de compte. On ne la réclame donc
   qu'au premier favori — l'exploration reste possible sans rien signer.
   L'affichage est optimiste : le cœur bascule tout de suite, et se remet en
   place seulement si la base refuse. */
const favorisIds = new Set();
let favorisCharges = false;

/* Référence stable d'un lieu externe : sa source et son identifiant. */
function refFavori(l){
  if(!l) return "";
  if(l.dbId) return "";
  return (l.source || "osm")+":"+l.id;
}
function cleFavori(l){
  return l && l.dbId ? "pub:"+l.dbId : refFavori(l);
}
function estFavori(l){
  return favorisIds.has(cleFavori(l));
}

async function chargerFavoris(){
  if(favorisCharges) return;
  if(!(await connecter())) return;
  // Sans session, il n'existe encore aucun favori : la lecture publique ne
  // doit pas créer silencieusement un compte anonyme.
  if(!moiId) return;
  favorisCharges = true;
  const lignes = await Store.favoris();
  favorisIds.clear();
  lignes.forEach(f=>favorisIds.add(f.publication_id ? "pub:"+f.publication_id : f.lieu_ref));
  majCoeurs();
}

/* Bascule optimiste : l'écran répond immédiatement, la base suit. */
async function basculerFavori(l){
  const cle = cleFavori(l);
  if(!cle) return;
  const etait = favorisIds.has(cle);
  if(etait) favorisIds.delete(cle); else favorisIds.add(cle);
  majCoeurs();

  /* Le compte est demandé ICI, au moment où il apporte quelque chose : garder
     ce favori ailleurs que sur cet appareil. On rend d'abord le cœur à son
     état d'avant — il ne doit pas rester allumé derrière un écran de
     connexion — puis on met le geste en attente : il sera rejoué tel quel. */
  if(!estConnecte()){
    if(etait) favorisIds.add(cle); else favorisIds.delete(cle);
    majCoeurs();
    await exigerCompte("favori", {cle:cle});
    return;
  }
  const ok = etait ? await Store.retirerFavori(l) : await Store.ajouterFavori(l);
  if(!ok){
    if(etait) favorisIds.add(cle); else favorisIds.delete(cle);
    majCoeurs();
    toast("Impossible d’enregistrer ce favori");
    return;
  }
  majNavBas();
}

/* Remet tous les cœurs affichés en accord avec l'état courant. */
function majCoeurs(){
  document.querySelectorAll("[data-coeur]").forEach(b=>{
    const actif = favorisIds.has(b.dataset.coeur);
    b.classList.toggle("actif", actif);
    b.setAttribute("aria-pressed", String(actif));
    b.setAttribute("aria-label", actif ? "Retirer des favoris" : "Ajouter aux favoris");
  });
}

/* Le cœur lui-même : discret, et toujours au même endroit. */
function boutonCoeur(l){
  const cle = cleFavori(l);
  if(!cle) return "";
  const actif = favorisIds.has(cle);
  return '<button class="coeur'+(actif?" actif":"")+'" data-coeur="'+esc(cle)+'" '+
    'aria-pressed="'+actif+'" aria-label="'+(actif?"Retirer des favoris":"Ajouter aux favoris")+'">'+
    '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" '+
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+
    '<path d="M20.4 5.6a5 5 0 0 0-7.1 0L12 6.9l-1.3-1.3a5 5 0 1 0-7.1 7.1L12 21l8.4-8.3a5 5 0 0 0 0-7.1z"/>'+
    '</svg></button>';
}

/* Un seul branchement, délégué : les cœurs sont recréés à chaque rendu. */
document.addEventListener("click", (e)=>{
  const bouton = e.target.closest && e.target.closest("[data-coeur]");
  if(!bouton) return;
  e.preventDefault(); e.stopPropagation();
  const cle = bouton.dataset.coeur;
  const lieu = lieux.find(x=>cleFavori(x) === cle) || favorisEnMemoire.get(cle);
  if(lieu) basculerFavori(lieu);
});
const favorisEnMemoire = new Map();

/* ---- Ouvert / fermé : une seule source de vérité ------------------------
   Toute la question « est-ce que c'est ouvert » passe par availability.js.
   Aucun écran ne relit un opening_hours de son côté, sinon la carte et la
   fiche finissent par se contredire. */
const disponibilitesParObjet = new WeakMap();
let instantDisponibiliteDuTour = null;

function instantDisponibilite(){
  if(instantDisponibiliteDuTour != null) return instantDisponibiliteDuTour;
  instantDisponibiliteDuTour = instantCreneau().getTime();
  queueMicrotask(()=>{ instantDisponibiliteDuTour = null; });
  return instantDisponibiliteDuTour;
}

function dispoDe(l, arrivee, quand){
  const module = window.AutourAvailability;
  if(!module) return null;
  const opts = arguments[3] || {};
  // l'instant est paramétrable : le moteur temporel évalue une exposition
  // longue à un moment donné, pas forcément le créneau affiché
  const instant = quand == null ? instantDisponibilite() : quand;
  if(!l || (typeof l !== "object" && typeof l !== "function"))
    return module.getPlaceAvailability(l, instant, arrivee);
  let cache = disponibilitesParObjet.get(l);
  if(!cache){ cache = new Map(); disponibilitesParObjet.set(l, cache); }
  /* Les horaires des lieux permanents sont exprimés à la minute. Les garder
     pendant cette même minute évite de reparcourir leur planning à chaque
     arrivée de source. Un événement daté conserve l'instant exact : aucune
     frontière start/end n'est arrondie pour gagner du temps. */
  const cleTemps = estTemporaire(l) ? instant : Math.floor(instant / 60000);
  const cle = cleTemps+"|"+(arrivee == null ? "" : arrivee)+
    "|"+(opts.allowPointStatus === false ? "future" : "instant");
  if(cache.has(cle)) return cache.get(cle);
  const resultat = module.getPlaceAvailability(l, instant, arrivee, opts);
  if(cache.size >= 4) cache.clear();
  cache.set(cle, resultat);
  return resultat;
}

/* Le libellé exact demandé par cas : « Ouvert • ferme à 23:30 », « Fermé •
   ouvre à 14:00 », « Fermé aujourd'hui », « Horaires non renseignés »… */
function badgeDispo(l){
  if(estTemporaire(l)){
    const quand = horairesEvenement(l);
    return '<span class="'+(quand === "Horaires à vérifier" ? "inconnu" : "ouvert")+'">'+
      esc(quand || "Horaires à vérifier")+'</span>';
  }
  const d = dispoDe(l);
  if(!d) return "";
  if(d.status === "unknown") return '<span class="inconnu">'+esc(libelleHoraires(l))+'</span>';
  const classe = d.status === "open" || d.status === "closing_soon" ? "ouvert"
    : "ferme";
  return '<span class="'+classe+'">'+esc(d.label)+'</span>';
}

/* Un lieu fermé reste sur la carte — il peut servir plus tard — mais il ne
   doit jamais se lire comme un lieu ouvert. */
function estFerme(l){
  const d = dispoDe(l);
  return !!d && (d.status === "closed" || d.status === "permanently_closed");
}

/* ---- Transport : de « c'est à 800 m » à « vous y êtes dans 22 min » ------
   Le classement est synchrone, le calcul d'itinéraire ne l'est pas. On
   garde donc un cache d'ETA lu instantanément par le classement, et on le
   remplit en tâche de fond pour les seuls résultats visibles — puis on
   reclasse. Tant qu'un ETA n'est pas connu, core.js retombe sur la marche :
   l'écran n'attend jamais le réseau. */
/* ---- Jalons de démarrage -------------------------------------------------
   Chaque étape est marquée pour être mesurable au lieu d'être ressentie.
   `AutourPerf.rapport()` rend le tableau des durées depuis l'ouverture. */
const PERF = {
  vus: new Set(),
  lcp: 0,
  temps: Object.create(null),
  rendus: {panneau:0, carte:0},
  cpu: Object.create(null),
  erreurs: 0,
  reseau: {total:0, demarrage:0, parSource:Object.create(null)},
  demarrageTermine: false,
  expositionPlanifiee: false,
  exposer(){
    try{
      document.documentElement.dataset.autourPerf = JSON.stringify({
        temps:this.temps, reseau:this.reseau, rendus:this.rendus,
        cpu:this.cpu, erreurs:this.erreurs, demarrageTermine:this.demarrageTermine,
        cache:this.cache,
      });
    }catch(e){}
  },
  exposerBientot(){
    if(this.expositionPlanifiee) return;
    this.expositionPlanifiee = true;
    queueMicrotask(()=>{
      this.expositionPlanifiee = false;
      this.exposer();
    });
  },
  jalon(nom){
    // un jalon décrit un premier instant : le remarquer cent fois le noierait
    if(this.vus.has(nom)) return;
    this.vus.add(nom);
    try{
      this.temps[nom] = Math.round(performance.now());
      performance.mark("autour:"+nom);
    }catch(e){}
    this.exposer();
  },
  requete(source){
    const nom = String(source || "autre");
    this.reseau.total += 1;
    this.reseau.parSource[nom] = (this.reseau.parSource[nom] || 0) + 1;
    if(!this.demarrageTermine) this.reseau.demarrage += 1;
    this.exposer();
    /* Rendu : de quoi mesurer la DURÉE de cette requête-là. Un compteur dit
       combien de requêtes sont parties ; il ne dit pas laquelle a coûté deux
       secondes. Sans ça, « Autour est lent » reste une impression. */
    const depart = (typeof performance !== "undefined" ? performance.now() : Date.now());
    return ()=>this.fini(nom, depart);
  },
  /* Une source qui dépasse la seconde est nommée. C'est la seule façon de
     répondre à « qu'est-ce qui est lent ? » par autre chose qu'une hypothèse. */
  SEUIL_LENT_MS: 1000,
  fini(source, depart){
    const ms = Math.round((typeof performance !== "undefined"
      ? performance.now() : Date.now()) - depart);
    const c = this.cache;
    c.durees[source] = Math.max(c.durees[source] || 0, ms);
    if(ms >= this.SEUIL_LENT_MS && c.lentes.indexOf(source) < 0) c.lentes.push(source);
    this.exposer();
    return ms;
  },
  travail(nom, depart){
    const ms = Math.round((performance.now ? performance.now() : Date.now()) - depart);
    const ligne = this.cpu[nom] || (this.cpu[nom] = {nombre:0,totalMs:0,pireMs:0});
    ligne.nombre += 1;
    ligne.totalMs += ms;
    ligne.pireMs = Math.max(ligne.pireMs, ms);
    /* Plusieurs sous-phases sont mesurées dans une même pile d'exécution.
       Publier le JSON après chacune ajoutait au travail que l'on mesure ; une
       seule publication en microtâche conserve les mêmes chiffres exposés. */
    this.exposerBientot();
    return ms;
  },
  /* Le cache : combien de fois on a évité le réseau. Un « hit » n'est pas une
     statistique de confort — c'est la différence entre un écran utile en
     trois cents millisecondes et un écran vide pendant deux secondes. */
  cache: {hits:0, miss:0, parSource:Object.create(null),
          durees:Object.create(null), lentes:[]},
  touche(source, trouve){
    const nom = String(source || "autre");
    this.cache[trouve ? "hits" : "miss"] += 1;
    const p = this.cache.parSource[nom] || (this.cache.parSource[nom] = {hits:0, miss:0});
    p[trouve ? "hits" : "miss"] += 1;
    this.exposer();
  },
  finDemarrage(){ this.demarrageTermine = true; this.exposer(); },
  /* Une étape a une durée, pas seulement un instant. `mesure` la nomme pour
     qu'elle apparaisse telle quelle dans l'onglet Performance du navigateur —
     c'est ce qui permet de dire « la géolocalisation a coûté 900 ms » au lieu
     de le déduire de deux nombres. */
  mesure(nom, depuis, jusqua){
    try{ performance.measure(nom, "autour:"+depuis, "autour:"+jusqua); }catch(e){}
  },
  rapport(){
    const lignes = {};
    performance.getEntriesByType("paint")
      .forEach(e=>{ lignes[e.name] = Math.round(e.startTime); });
    if(this.lcp) lignes["largest-contentful-paint"] = Math.round(this.lcp);
    const nav = performance.getEntriesByType("navigation")[0];
    if(nav){
      lignes["dom-interactive"] = Math.round(nav.domInteractive);
      lignes["dom-content-loaded"] = Math.round(nav.domContentLoadedEventEnd);
    }
    performance.getEntriesByType("mark")
      .filter(m=>m.name.startsWith("autour:"))
      .forEach(m=>{ lignes[m.name.slice(7)] = Math.round(m.startTime); });
    // lecture chronologique : c'est l'ordre qui raconte le démarrage
    return Object.fromEntries(Object.entries(lignes).sort((a,b)=>a[1]-b[1]));
  },
  /* Les objectifs sont écrits ici pour que la mesure dise elle-même si elle
     les tient — sinon chacun garde en tête un chiffre différent. */
  OBJECTIFS: {"first-contentful-paint":1000, "largest-contentful-paint":2500,
              ui_ready:300, premier_lieu:1500},
  verdict(){
    const r = this.rapport(), out = {};
    Object.entries(this.OBJECTIFS).forEach(([k,cible])=>{
      if(r[k] != null) out[k] = r[k] + " ms / " + cible + " ms " + (r[k] <= cible ? "✓" : "✗");
    });
    return out;
  },
  /* La chaîne du démarrage, dans l'ordre où elle se déroule, chaque maillon
     avec son instant et ce qu'il a coûté. C'est ce tableau qui répond à la
     seule question qui compte : QUI retient la première suggestion.
     Un maillon absent n'a pas eu lieu — une source en panne, un cache vide —
     et c'est une information, pas un trou. */
  CHAINE: [
    ["boot UI",              "ui_ready"],
    ["position",             ["position_serveur","position_memoire","geolocation_ready","position_inconnue"]],
    ["cache local",          "cache_lu"],
    ["1re source locale",    "source_locale"],
    ["Overpass",             "overpass_done"],
    ["Nominatim",            "nominatim_done"],
    ["Supabase",             "supabase_pret"],
    ["classement",           "scoring_fait"],
    ["1re suggestion",       "premier_lieu"],
  ],
  chaine(){
    const r = this.rapport();
    const lire = (cle)=>{
      if(Array.isArray(cle)){
        const trouves = cle.map(c=>r[c]).filter(v=>v != null);
        return trouves.length ? Math.min(...trouves) : null;
      }
      return r[cle] != null ? r[cle] : null;
    };
    const lignes = [];
    let precedent = 0;
    this.CHAINE.forEach(([nom, cle])=>{
      const t = lire(cle);
      if(t == null){ lignes.push({etape:nom, a:"—", duree:"—"}); return; }
      lignes.push({etape:nom, a:t+" ms", duree:Math.max(0, t-precedent)+" ms"});
      precedent = Math.max(precedent, t);
    });
    return lignes;
  },
};
try{
  new PerformanceObserver((liste)=>{
    liste.getEntries().forEach(e=>{ PERF.lcp = e.startTime; });
  }).observe({type:"largest-contentful-paint", buffered:true});
}catch(e){}
window.AutourPerf = PERF;
window.addEventListener("error",()=>{ PERF.erreurs += 1; PERF.exposer(); });
window.addEventListener("unhandledrejection",()=>{ PERF.erreurs += 1; PERF.exposer(); });

/* ---- Un seul rendu par image ---------------------------------------------
   Chaque source de données (cache, Google, OpenStreetMap, événements,
   publications) appelait `rendre()`, `dessinerFiltres()` et `majAccueil()` en
   repartant à zéro — et `majAccueil()` rappelait `rendre()` et `majFeuille2()`.
   Cinq sources au démarrage : la carte était redessinée dix fois et la feuille
   quinze, pendant que le navigateur attendait pour peindre. Mesuré sur un
   téléphone d'entrée de gamme, cela représentait plus de trois secondes de fil
   principal bloqué, uniquement en travail refait.

   On note donc ce qu'il y a à refaire, et on le fait UNE fois à la prochaine
   image. Les fonctions restent appelables directement — un test, un clic ou
   une saisie ont le droit d'exiger un rendu immédiat. */
const aRefaire = {carte:false, accueil:false, filtres:false, feuille:false};
let renduPlanifie = 0;
let renduEnLot = false;

function planifierRendu(quoi){
  Object.assign(aRefaire, quoi || {});
  if(renduPlanifie) return;
  const executer = ()=>{
    renduPlanifie = 0;
    const q = Object.assign({}, aRefaire);
    aRefaire.carte = aRefaire.accueil = aRefaire.filtres = aRefaire.feuille = false;
    renduEnLot = true;
    try{
      if(q.accueil)  majAccueil();
      if(q.filtres)  dessinerFiltres();
      if(q.carte)    rendre();
      if(q.feuille || q.accueil || q.carte) majFeuille2();
    } finally { renduEnLot = false; }
    PERF.jalon("rendu_final");
  };
  renduPlanifie = typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(executer) : setTimeout(executer, 16);
}

/* Rendre la main au navigateur avant un gros calcul : sans ça, le premier
   affichage attend la fin du travail, et l'écran reste blanc alors que tout
   est déjà prêt à être peint. */
function apresPeinture(f){
  if(typeof requestAnimationFrame !== "function"){ setTimeout(f, 0); return; }
  requestAnimationFrame(()=>requestAnimationFrame(()=>f()));
}
/* `requestIdleCallback` SANS délai n'a aucune échéance : tant que le fil
   principal a du travail — et au démarrage il en a en permanence — il peut
   n'être jamais appelé. Un fond de carte confié à ce mécanisme n'arrivait
   donc jamais. Tout ce qui est différé ici est du confort, mais du confort
   qui doit finir par arriver : une seconde et demie au plus. */
const quandLibre = (f)=> window.requestIdleCallback
  ? window.requestIdleCallback(f, {timeout: 1500})
  : setTimeout(f, 400);

/* Le responsive décrit uniquement la présentation. Les requêtes et le
   classement ne dépendent jamais d'un userAgent ni d'un modèle d'appareil. */
function useResponsiveLayout(onChange){
  const medias = {
    mobile:window.matchMedia("(max-width: 767px)"),
    tablet:window.matchMedia("(min-width: 768px) and (max-width: 1099px)"),
    touch:window.matchMedia("(pointer: coarse)"),
  };
  const read = ()=>({
    isMobile:medias.mobile.matches,
    isTablet:medias.tablet.matches,
    isDesktop:!medias.mobile.matches && !medias.tablet.matches,
    isTouch:medias.touch.matches,
  });
  let value = read();
  const listeners = new Set();
  if(onChange) listeners.add(onChange);
  const notify = ()=>{
    value = read();
    listeners.forEach(listener=>listener(value));
  };
  Object.values(medias).forEach(media=>{
    if(media.addEventListener) media.addEventListener("change",notify);
    else media.addListener(notify);
  });
  if(onChange) onChange(value);
  return {
    get value(){ return value; },
    subscribe(listener){ listeners.add(listener); listener(value); return ()=>listeners.delete(listener); },
    destroy(){
      Object.values(medias).forEach(media=>{
        if(media.removeEventListener) media.removeEventListener("change",notify);
        else media.removeListener(notify);
      });
      listeners.clear();
    },
  };
}

let responsiveLayoutState = {isMobile:false,isTablet:false,isDesktop:true,isTouch:false};
/* Le premier callback responsive peut être exécuté dès la première frame.
   La référence doit donc sortir de la zone morte temporelle avant son abonnement. */
let map;
const responsiveLayout = useResponsiveLayout(layout=>{
  responsiveLayoutState = layout;
  document.body.dataset.layout = layout.isMobile ? "mobile" : layout.isTablet ? "tablet" : "desktop";
  document.body.classList.toggle("touch",layout.isTouch);
  requestAnimationFrame(()=>{
    synchroniserHauteurFeuille();
    if(map) map.invalidateSize({pan:false});
  });
});

/* La hauteur visible de la feuille, publiée en variable CSS : c'est elle qui
   tient les commandes de la carte juste au-dessus du panneau.

   DEUX ÉCONOMIES, ET ELLES SE VOIENT À L'ŒIL NU.

   Cette fonction est appelée par un `ResizeObserver`, donc à CHAQUE image des
   220 ms d'animation d'ouverture. Chaque appel faisait deux choses coûteuses :
   un `getBoundingClientRect()` — qui force un calcul de mise en page synchrone
   — et une écriture de propriété personnalisée sur `documentElement`, qui
   invalide le style du document entier. Treize fois par ouverture, sur un
   téléphone, pendant que l'animation essaie d'être fluide.

   On regroupe donc les rafales en une écriture par image, et on n'écrit que
   si la valeur a réellement changé. Le comportement est identique au pixel
   près ; ce qui disparaît, c'est le travail inutile. */
let hauteurFeuillePubliee = null;
let syncHauteurPlanifiee = false;

function mesurerHauteurFeuille(){
  syncHauteurPlanifiee = false;
  const feuille = document.getElementById("feuilleBesoins");
  const visible = feuille && !feuille.hidden && !responsiveLayoutState.isDesktop;
  const hauteur = visible ? Math.round(feuille.getBoundingClientRect().height) : 0;
  if(hauteur === hauteurFeuillePubliee) return;
  hauteurFeuillePubliee = hauteur;
  document.documentElement.style.setProperty("--sheet-visible-height",hauteur+"px");
}

function synchroniserHauteurFeuille(){
  if(syncHauteurPlanifiee) return;
  syncHauteurPlanifiee = true;
  requestAnimationFrame(mesurerHauteurFeuille);
}

const NOMS_COUCHES = Object.freeze({
  mainSheet:"mainSheet",
  placeDetails:"placeDetails",
  publishModal:"publishModal",
  confirmationDialog:"confirmationDialog",
  searchOverlay:"searchOverlay",
});

/* Sur desktop, l'exploration d'un besoin garde la recherche visible à côté
   du panneau, comme un outil de la carte et non comme une modale. Sur mobile
   elle conserve son comportement superposé et exclusif. La déclaration est
   placée ici pour que le gestionnaire de couches puisse partager cette règle. */
function rechercheDockeeDesktopDemandee(){
  return responsiveLayoutState.isDesktop && !modeNav && !modePose &&
    feuilleNiveau !== null && feuilleNiveau !== "racine" &&
    feuilleNiveau !== "plus" && feuilleNiveau !== "aide" &&
    !!BESOIN_DE(feuilleNiveau);
}

/* Une seule couche principale reste interactive. La sheet peut être suspendue
   derrière une fiche, mais elle est alors hidden et restaurée à la fermeture. */
const layerManager = {
  stack:[],
  activate(name){
    const confirmation = name === NOMS_COUCHES.confirmationDialog;
    const rechercheDockee = name === NOMS_COUCHES.searchOverlay &&
      rechercheDockeeDesktopDemandee();
    if(!confirmation) this.stack = this.stack.filter(x=>
      x === NOMS_COUCHES.confirmationDialog ||
      (rechercheDockee && x === NOMS_COUCHES.mainSheet));
    if(!this.stack.includes(name)) this.stack.push(name);
    const sheet = document.getElementById("feuilleBesoins");
    if(name !== NOMS_COUCHES.mainSheet && !rechercheDockee && sheet && !sheet.hidden){
      sheet.dataset.suspended = "true";
      sheet.hidden = true;
    }
    if(name !== NOMS_COUCHES.searchOverlay){
      const suggestions = document.getElementById("suggestions");
      if(suggestions) suggestions.hidden = true;
    }
    this.sync();
  },
  deactivate(name){
    this.stack = this.stack.filter(x=>x!==name);
    const sheet = document.getElementById("feuilleBesoins");
    const autrePrincipale = this.stack.some(x=>x!==NOMS_COUCHES.confirmationDialog);
    if(!autrePrincipale && sheet && sheet.dataset.suspended === "true" && feuilleNiveau !== null && !modePose && !modeNav){
      delete sheet.dataset.suspended;
      sheet.hidden = false;
      this.stack.push(NOMS_COUCHES.mainSheet);
    }
    this.sync();
  },
  top(){ return this.stack[this.stack.length-1] || null; },
  sync(){
    document.body.classList.toggle("ui-modal-open",this.stack.some(x=>
      [NOMS_COUCHES.placeDetails,NOMS_COUCHES.publishModal,NOMS_COUCHES.confirmationDialog].includes(x)));
    document.body.classList.toggle("sheet-open",this.stack.includes(NOMS_COUCHES.mainSheet));
    requestAnimationFrame(synchroniserHauteurFeuille);
  },
};

if(window.ResizeObserver){
  new ResizeObserver(()=>synchroniserHauteurFeuille()).observe(document.getElementById("feuilleBesoins"));
}

function normaliserItem(item, source){
  const normalise = toCommonItem(item, {source});
  if(normalise.isTemporary && ENTITES && ENTITES.normaliserEvenement){
    normalise.entity_type = "event";
    normalise.eventCanonical = normalise.eventCanonical || ENTITES.normaliserEvenement(Object.assign({}, normalise, {
      title:normalise.title || normalise.titre,
      event_source:normalise.event_source || normalise.primary_source || source,
      event_source_url:normalise.event_source_url || normalise.source_url || null,
    }));
    if(normalise.eventCanonical.title){
      normalise.title = normalise.titre = normalise.eventCanonical.title;
    }
    if(normalise.eventCanonical.description){
      normalise.description = normalise.eventCanonical.description;
    }
  }else if(ENTITES && ENTITES.normaliserLieu){
    normalise.entity_type = "place";
    normalise.placeCanonical = normalise.placeCanonical || ENTITES.normaliserLieu(normalise);
  }
  return normalise;
}

/* Toutes les vues passent par ce pointeur. Le repli ne sert qu'aux
   publications anciennes ou aux tests chargés sans le module événementiel. */
function donneesEvenement(l){
  if(!l || !estTemporaire(l)) return null;
  if(l.eventCanonical) return l.eventCanonical;
  if(ENTITES && ENTITES.normaliserEvenement){
    l.entity_type = "event";
    l.eventCanonical = ENTITES.normaliserEvenement(Object.assign({}, l, {
      title:l.title || l.titre,
      event_source:l.event_source || l.primary_source || null,
      event_source_url:l.event_source_url || l.source_url || null,
    }));
    return l.eventCanonical;
  }
  return l;
}

/* Même règle pour les lieux permanents : le renderer ne relit pas les champs
   historiques quand une fiche a été normalisée. La séparation est
   intentionnelle : un lieu peut avoir une photo et des horaires, mais jamais
   les dates, le tarif ou la provenance d'un événement voisin. */
function donneesLieu(l){
  if(!l || estTemporaire(l)) return null;
  if(l.placeCanonical) return l.placeCanonical;
  if(ENTITES && ENTITES.normaliserLieu){
    l.entity_type = "place";
    l.placeCanonical = ENTITES.normaliserLieu(l);
    return l.placeCanonical;
  }
  return l;
}

/* Le renderer ne choisit plus entre `image`, `image_url` et une image du
   fournisseur. Il reçoit le média du même objet canonique que le reste de la
   fiche, avec sa portée et sa provenance intactes. */
function mediaDe(l){
  if(!l) return {image_url:null,image_source:null,image_scope:"place",image_type:null};
  const canonique = estTemporaire(l) ? donneesEvenement(l) : donneesLieu(l);
  if(ENTITES && ENTITES.mediaCanonique && canonique) return ENTITES.mediaCanonique(canonique);
  return {
    image_url:l.image || l.image_url || null,
    image_source:l.imageSource || l.image_source || null,
    image_source_url:l.image_source_url || "",
    image_author:l.image_author || "",
    image_license:l.image_license || "",
    image_type:l.image_type || null,
    image_scope:estTemporaire(l) ? "event" : "place",
  };
}

function imageDe(l){
      const media = mediaDe(l);
  return media && media.image_url ? media.image_url : "";
}

function gratuitDe(l){
  if(!l) return false;
  const canonique = estTemporaire(l) ? donneesEvenement(l) : donneesLieu(l);
  return !!(canonique && canonique.is_free === true);
}

function correspondCategorie(item, categorie){
  return matchesCategory(item, categorie);
}

function correspondUneCategorie(item, categories){
  return [...categories].some(categorie=>correspondCategorie(item, categorie));
}

function estTemporaire(item){
  return !!(item && (item.entity_type === "event" || item.isTemporary === true));
}

/* ================================================================== */
/*  Catégories                                                        */
/* ================================================================== */

/* Couleur de pastille par famille de catégories. Différencier visuellement
   les marqueurs est ce qui permet de lire la carte sans lire les étiquettes.
   Une catégorie absente retombe sur le gris neutre. */
const COULEURS_CAT = {
  resto:"#F5741F", fastfood:"#F5741F", cafe:"#B4713C", marche:"#E0952A", food:"#F5741F",
  bar:"#D2337A", event:"#E23A8C", concert:"#E23A8C", spectacle:"#E23A8C", studio:"#E23A8C",
  cinema:"#7C3AED", musee:"#0FA3A3", biblio:"#0FA3A3", popup:"#B14FE0",
  parc:"#2E9E4F", terrain:"#2E9E4F", sport:"#2E9E4F", velo:"#2E9E4F",
  alimentaire:"#B82A3A", hebergement:"#B82A3A", sante:"#B82A3A", asso:"#B82A3A",
  emploi:"#B82A3A", collecte:"#B82A3A", securite:"#B82A3A",
  metro:"#2673E8", bus:"#2673E8", tram:"#2673E8", train:"#2673E8",
  mairie:"#5D6B63", ecole:"#5D6B63",
  toilettes:"#5D6B63", recharge:"#5D6B63", friperie:"#B14FE0", commerce:"#B14FE0",
  rencontre:"#E0952A", autre:"#5D6B63",
};

const CATS = {
  /* ---- couche événements : ce qui se passe, publié par les gens ---- */
  event:    {label:"Événement",  emoji:"🔊", eph:true},
  popup:    {label:"Pop-up",     emoji:"🧢", eph:true},
  rencontre:{label:"Rencontre",  emoji:"👋", eph:true},
  sport:    {label:"Sport",      emoji:"⚽", eph:true},
  collecte: {label:"Distribution & aide", emoji:"📦", eph:true},
  studio:   {label:"Studio",     emoji:"🎧", eph:true},
  food:     {label:"Street food",emoji:"🍜", eph:true},
  autre:    {label:"Autre",      emoji:"✨", eph:true},

  /* ---- couche permanente : la ville telle qu'elle existe ---- */
  resto:    {label:"Restaurants", emoji:"🍔", eph:false},
  fastfood: {label:"Fast-food",   emoji:"🍕", eph:false},
  cafe:     {label:"Cafés",       emoji:"☕", eph:false},
  bar:      {label:"Bars",        emoji:"🍺", eph:false},
  cinema:   {label:"Cinéma",      emoji:"🎬", eph:false},
  spectacle:{label:"Spectacles",  emoji:"🎭", eph:false},
  concert:  {label:"Concerts",    emoji:"🎵", eph:false},
  marche:   {label:"Marchés",     emoji:"🧺", eph:false},
  friperie: {label:"Friperies",   emoji:"👕", eph:false},
  commerce: {label:"Commerces",   emoji:"🛍️", eph:false},

  alimentaire:{label:"Aide alimentaire", emoji:"🥫", eph:false},
  asso:       {label:"Associations",     emoji:"🤝", eph:false},
  hebergement:{label:"Hébergement",      emoji:"🏠", eph:false},
  sante:      {label:"Santé",            emoji:"🩺", eph:false},
  emploi:     {label:"Emploi & droits",  emoji:"💼", eph:false},
  /* LA CATÉGORIE QUI N'EXISTAIT PAS, ET C'EST POURQUOI « SÉCURITÉ » NE RENDAIT
     RIEN. Un commissariat n'avait aucune case où atterrir : même posé à la
     main dans les données, il n'aurait pu être reconnu que par son nom. */
  securite:   {label:"Sécurité & protection", emoji:"🛡️", eph:false},

  biblio:   {label:"Bibliothèques", emoji:"📚", eph:false},
  coworking:{label:"Espaces de travail", emoji:"💻", eph:false},
  musee:    {label:"Musées",        emoji:"🖼️", eph:false},
  parc:     {label:"Parcs",         emoji:"🌳", eph:false},
  terrain:  {label:"Terrains",      emoji:"🏀", eph:false},
  ecole:    {label:"Écoles",        emoji:"🎓", eph:false},
  mairie:   {label:"Services",      emoji:"🏛️", eph:false},
  velo:     {label:"Stations vélo", emoji:"🚲", eph:false},
  metro:    {label:"Métro",         emoji:"🚇", eph:false},
  // « Bus & tram » mélangeait deux réseaux distincts : chercher un tram
  // renvoyait des arrêts de bus, et l'inverse
  bus:      {label:"Bus",           emoji:"🚌", eph:false},
  tram:     {label:"Tram",          emoji:"🚋", eph:false},
  train:    {label:"Gares",         emoji:"🚆", eph:false},
  recharge: {label:"Recharge",      emoji:"🔌", eph:false},
  toilettes:{label:"Toilettes",     emoji:"🚻", eph:false},
};

/* ---- L'icône dit le type réel, la catégorie dit le comportement ----------
   Une pharmacie et un hôpital partagent la catégorie « santé ». C'est ce qui
   les fait remonter ensemble dans Aide, et il ne faut surtout pas y toucher :
   quelqu'un qui cherche des soins doit trouver les deux. Mais sur la carte,
   un stéthoscope devant une pharmacie ne dit pas ce qu'on y trouve.

   Un sous-type ne change QUE l'icône. Aucune recherche, aucun filtre, aucun
   classement, aucun besoin d'Aide ne le regarde — la catégorie reste entière.
   C'est la seule façon de préciser un pictogramme sans déplacer un lieu hors
   de la famille où on doit pouvoir le retrouver. */
const SOUS_TYPES = [
  ["pharmacie", "💊", (t,type)=>
    t.amenity === "pharmacy" || t.healthcare === "pharmacy" || type === "pharmacy"],
];

const DESCRIPTEURS_SOUS_TYPE = new Map();

function categorieAffichee(l, defaut){
  const base = (l && CATS[l.cat]) || defaut || CATS.event;
  if(!l) return base;
  const tags = l.tags || {};
  const trouve = SOUS_TYPES.find(([,,teste])=>teste(tags, l.type || ""));
  if(!trouve) return base;
  /* Le descripteur affiné est mémorisé : `rendre()` passe ici une fois par
     marqueur et par image, il n'a pas à reconstruire un objet à chaque tour. */
  const cle = l.cat+"|"+trouve[0];
  let descripteur = DESCRIPTEURS_SOUS_TYPE.get(cle);
  if(!descripteur){
    descripteur = Object.assign({}, base, {emoji:trouve[1]});
    DESCRIPTEURS_SOUS_TYPE.set(cle, descripteur);
  }
  return descripteur;
}

/* Mission locale, France Travail et Cap emploi partagent le même tag OSM
   (office=employment_agency) alors qu'ils ne s'adressent pas au même public.
   On les distingue par le nom : envoyer un jeune au mauvais guichet, ou une
   personne en situation de handicap ailleurs qu'à Cap emploi, fait perdre
   un déplacement à quelqu'un qui en a besoin. */
const SERVICES = [
  [/mission\s*locale/i,                  "Mission locale · 16-25 ans"],
  [/france\s*travail|p[oô]le\s*emploi/i, "France Travail · demandeurs d’emploi"],
  [/cap\s*emploi/i,                      "Cap emploi · handicap"],
  [/maison\s*de\s*l['’ ]?emploi/i,       "Maison de l’emploi"],
  [/ccas|centre\s*communal/i,            "CCAS · aide sociale communale"],
  [/restos?\s*du\s*c(oe|œ|o)ur/i,        "Restos du Cœur"],
  [/secours\s*populaire/i,               "Secours populaire"],
  [/secours\s*catholique/i,              "Secours catholique"],
  [/croix[- ]rouge/i,                    "Croix-Rouge"],
  [/banque\s*alimentaire/i,              "Banque alimentaire"],
  [/emma(ü|u)s/i,                        "Emmaüs"],
];
/* Google range souvent McDonald's ou KFC en « restaurant », et OpenStreetMap
   n'est pas toujours plus fin. Mélanger une chaîne et un vrai restaurant fausse
   le classement : on les reclasse d'après l'enseigne. */
const CHAINES_FASTFOOD = /mc\s?do|burger\s?king|\bkfc\b|\bquick\b|subway|domino|pizza\s?hut|o'?tacos|five\s?guys|tacos|kebab|snack|friterie|frit|chicken|tender|nachos|sushi\s?shop|pok[eé]\b/i;
const CHAINES_CAFE     = /starbucks|paul\b|brioche\s?dor|columbus|costa\s?coffee|boulangerie|patisserie|maison\s?kayser|pain\s?quotidien/i;

/* Ce qu'un nom de structure sociale annonce. `amenity=social_facility` sans
   sous-tag ne dit pas ce qu'on y trouve — mais l'enseigne, elle, le dit
   presque toujours. « Foyer Notre-Dame », « CHRS Le Relais », « Résidence
   sociale Wazemmes » : personne n'hésite en lisant ça. */
const NOM_HEBERGEMENT = /foyer|chrs|\bcada\b|\bhuda\b|\bchu\b|residence sociale|maison relais|pension de famille|abri de nuit|halte de nuit|hebergement|dortoir|sans[- ]abri|\bsdf\b/;
const NOM_ALIMENTAIRE = /epicerie solidaire|banque alimentaire|restos? du c(o|oe)ur|soupe populaire|distribution alimentaire|aide alimentaire|colis alimentaire/;

function affinerCategorie(cat, nom, tags){
  /* Un tag partagé et sans sous-tag : c'est le nom qui décide. On le fait
     avant tout le reste, parce qu'un foyer rangé dans « asso » est un foyer
     qu'aucune recherche d'hébergement ne retrouvera. */
  if(cat === "asso" && tags && tags.amenity === "social_facility" && !tags.social_facility){
    const n = sansAccents(nom || "");
    if(NOM_ALIMENTAIRE.test(n)) return "alimentaire";
    if(NOM_HEBERGEMENT.test(n)) return "hebergement";
  }
  if(!nom) return cat;
  /* Un transport est établi par ses tags : aucun affinage de nom ne le
     rattrape. « Cinéma » dans « Métro Gare Lille Flandres » ne doit pas
     transformer une station en salle obscure. */
  if(CATS_TRANSPORT.has(cat)) return cat;
  if(classifyPlace({cat, title:nom}).includes("cinema")) return "cinema";
  if(cat === "resto" || cat === "fastfood" || cat === "cafe"){
    if(CHAINES_CAFE.test(nom))     return "cafe";
    if(CHAINES_FASTFOOD.test(nom)) return "fastfood";
  }
  return cat;
}

function preciserService(nom){
  for(const [re,lab] of SERVICES) if(re.test(nom||"")) return lab;
  return "";
}

/* Un vestiaire solidaire et une boutique de vêtements portent le même tag
   OSM. Dans le mode Aide, envoyer quelqu'un chez Zara sous « Vêtements »
   serait la même faute que confondre Carrefour et l'aide alimentaire : on
   marque donc ce qui relève réellement de la solidarité. */
const NOMS_SOLIDAIRES = /emma(ü|u)s|vestiaire|solidair|secours|croix[- ]rouge|caritas|abb[ée]\s*pierre|sdf|sans[- ]abri|social|entraide|resto|banque\s*alimentaire|ccas|samu\s*social|accueil\s*de\s*jour/i;
function estSolidaire(nom, tagCharite){
  return !!tagCharite || NOMS_SOLIDAIRES.test(nom||"") || !!preciserService(nom);
}

/* Classer une banque alimentaire ou un foyer d'urgence par étoiles n'a aucun
   sens : ces lieux sont toujours triés par distance, sans note ni palmarès. */
const SANS_CLASSEMENT = new Set(["alimentaire","asso","hebergement","emploi","sante","mairie"]);

/* ---- Ce qu'on ne propose jamais de soi-même ----------------------------
   Un collège, une préfecture ou un bureau de poste sont sur la carte parce
   qu'ils existent et qu'on doit pouvoir les retrouver par leur nom. Mais
   personne n'ouvre Autour pour qu'on lui suggère un lycée : ces lieux ne
   sont pas ouverts au public, on n'y entre pas parce qu'on passait devant.
   Ils restent donc silencieux tant qu'ils n'ont pas été demandés — par une
   recherche nommée, une catégorie choisie ou une intention qui les inclut. */
const JAMAIS_AUTO = new Set(["ecole","mairie"]);

/* ---- Les transports sont un moyen, pas une destination -------------------
   Un arrêt de bus n'est pas une proposition de sortie. Overpass en renvoie
   plusieurs centaines par quartier — bouches de métro, arrêts par sens,
   stations de vélo — et ils noyaient les lieux qu'on venait chercher.

   Ils continuent d'être CHARGÉS pour la découverte et les informations de
   lieu. Ils ne sont simplement pas DESSINÉS tant qu'on ne les a pas demandés
   — couche transport allumée ou recherche explicite de transport. */
const CATS_TRANSPORT = new Set(["metro","bus","tram","train","velo"]);

/* ---- Quel transport, exactement ? ---------------------------------------
   « Phalempins » et « Pont de Neuville » sont deux stations de la ligne 2 à
   Tourcoing. Elles s'affichaient avec une icône de vélo.

   La cause n'était pas la table des tags, qui les connaît : c'était la façon
   de la lire. `REQUETES.find` rend la PREMIÈRE règle qui correspond, dans
   l'ordre du fichier — et les stations de vélo y sont écrites avant les
   transports. Un objet qui porte à la fois `station=subway` et un tag de
   stationnement vélo — l'arceau à l'entrée de la station, tagué sur le même
   objet — était donc classé « vélo » parce que le vélo venait plus haut dans
   une liste. L'ordre d'un tableau décidait du mode de transport.

   Ici, c'est la SPÉCIFICITÉ qui décide, et elle est écrite noir sur blanc.
   Une station de métro porte `railway=station` ET `station=subway` : le
   second dit le mode, le premier dit seulement que c'est ferroviaire. On lit
   donc le plus précis d'abord, dans un ordre qui ne dépend d'aucune autre
   table.

   Envoyer quelqu'un chercher un vélo là où il y a un métro, ce n'est pas une
   icône de travers : c'est un trajet raté. */
function modeTransportOsm(t){
  if(!t) return null;
  /* Métro. `station=subway` est le tag qui porte le mode ; `railway=subway`
     et l'entrée de bouche disent la même chose autrement. */
  if(t.station === "subway" || t.subway === "yes" ||
     t.railway === "subway" || t.railway === "subway_entrance") return "metro";
  /* Tram. En France `railway=tram_stop`, ailleurs `station=light_rail`. */
  if(t.station === "light_rail" || t.railway === "tram_stop" ||
     t.railway === "tram" || t.tram === "yes" || t.light_rail === "yes") return "tram";
  /* Train. Volontairement APRÈS métro et tram : une station de métro est
     aussi `railway=station`, et lui rendre « gare » serait la même erreur à
     l'envers. */
  if(t.railway === "station" || t.railway === "halt" ||
     t.station === "train" || t.train === "yes") return "train";
  /* Bus et trolleybus. */
  if(t.highway === "bus_stop" || t.amenity === "bus_station" ||
     t.station === "bus" || t.bus === "yes" || t.trolleybus === "yes") return "bus";
  /* Vélo en dernier, et seulement si rien de ferroviaire n'a parlé : c'est
     exactement l'inversion qui produisait le bogue. */
  if(t.amenity === "bicycle_rental" || t.amenity === "bicycle_parking") return "velo";
  return null;
}

/* Le nom ne sert QU'EN DERNIER RECOURS, quand aucun tag ne dit le mode. Un
   objet dont le seul tag utile est `public_transport=station` existe : son
   enseigne — « Métro Phalempins », « Gare de Tourcoing » — est alors la seule
   information disponible. Elle ne prend jamais le pas sur un tag. */
const NOM_TRANSPORT = [
  [/\bm[ée]tros?\b/,                          "metro"],
  [/\btram(way)?s?\b/,                        "tram"],
  [/\b(gares?|haltes?)\b/,                    "train"],
  [/\b(arr[êe]ts? de bus|gare routi[èe]re)\b/,"bus"],
  [/\b(v[' ]?lille|v[ée]los?|cycles?)\b/,     "velo"],
];

function modeTransportNom(nom){
  const n = sansAccents(nom || "");
  for(const [re, mode] of NOM_TRANSPORT) if(re.test(n)) return mode;
  return null;
}

/* La règle trouvée dans REQUETES donne la famille ; les tags donnent le mode.
   Le mode ne l'emporte que si la règle décrivait DÉJÀ un transport : on ne
   transforme pas la boulangerie d'une gare en station de métro parce que le
   bâtiment porte `railway=station`. */
function categorieTransport(catRegle, nom, tags){
  if(!CATS_TRANSPORT.has(catRegle)) return catRegle;
  return modeTransportOsm(tags) || modeTransportNom(nom) || catRegle;
}

let coucheTransport = false;      // allumée par le bouton transports

function transportsDemandes(ctx){
  if(coucheTransport) return true;
  // une catégorie de transport explicitement choisie, ou tapée en toutes lettres
  if(catsActives && [...catsActives].some(c=>CATS_TRANSPORT.has(c))) return true;
  if(CATS_TRANSPORT.has(filtreActif)) return true;
  const q = ctx && ctx.q;
  return !!(q && CATS_TRANSPORT.has(categorieRecherchee(q)));
}

/* Les endroits où manger. Une cuisine tapée sans catégorie — « indien »,
   « pizza » — désigne d'abord l'un d'eux. */
const CATS_MANGER = ["resto","fastfood","cafe","marche","food"];

/* Ce que les gens tapent réellement dans la recherche, par catégorie. */
const SYNONYMES = {
  resto:["restaurant","resto","manger","brasserie","diner","dejeuner"],
  fastfood:["fast food","fastfood","kebab","burger","tacos","pizza","snack","friterie"],
  cafe:["cafe","coffee","boulangerie","salon de the","brunch"],
  bar:["bar","pub","biere","apero","boire","verre","cocktail"],
  cinema:["cinema","film","seance"],
  spectacle:["theatre","spectacle","scene","comedie"],
  concert:["concert","musique","boite","club","live"],
  marche:["marche","brocante","halles"],
  friperie:["friperie","fripe","vetement","seconde main","occasion","vintage","depot vente"],
  commerce:["commerce","boutique","magasin","courses","supermarche","epicerie","coiffeur"],
  alimentaire:["aide alimentaire","banque alimentaire","epicerie solidaire","soupe populaire","restos du coeur"],
  asso:["asso","association","ong","benevolat","solidarite","centre social","maison de quartier"],
  hebergement:["hebergement","dormir","abri","foyer","urgence","115","logement"],
  sante:["sante","hopital","pharmacie","medecin","docteur","dentiste","clinique","urgences",
         "psy","psychologue","psychiatre","psychotherapeute","cmp","sante mentale"],
  emploi:["emploi","mission locale","france travail","pole emploi","travail","insertion","cv"],
  biblio:["bibliotheque","mediatheque","livre","lecture","etudier","salle d etude","reviser"],
  coworking:["coworking","espace de travail","bureau partage","tiers lieu","travailler"],
  musee:["musee","galerie","expo","exposition"],
  parc:["parc","jardin","square","vert","promenade"],
  terrain:["terrain","sport","foot","basket","piscine","skate","gym","muscu"],
  ecole:["ecole","college","lycee","universite","fac","campus"],
  mairie:["mairie","poste","administration","service public","papiers"],
  velo:["velo","bike","station velo","libre service"],
  metro:["metro","station"],
  tram:["tram","tramway"],
  train:["train","gare","ter","sncf"],
  bus:["bus","tram","arret","transport"],
  recharge:["recharge","borne","electrique"],
  toilettes:["toilette","wc","sanitaire"],
  food:["street food","food truck","cantine"],
  event:["evenement","event","soiree","anime"],
  popup:["popup","pop up","vide grenier"],
  collecte:["collecte","don","donner","recolte","distribution","maraude"],
  rencontre:["rencontre","apero","cafe rencontre","discussion","entraide voisins"],
};

/* Le type de cuisine vit dans le tag OSM `cuisine` (valeurs anglaises) et dans
   les types Google `turkish_restaurant`. On traduit ce que les gens tapent. */
const CUISINES = {
  turc:"turkish", turque:"turkish", kebab:"kebab",
  africain:"african", africaine:"african", afrique:"african",
  senegalais:"senegalese", ivoirien:"ivorian", ethiopien:"ethiopian",
  camerounais:"cameroonian", congolais:"congolese", malien:"malian",
  marocain:"moroccan", tunisien:"tunisian", algerien:"algerian",
  maghrebin:"moroccan", couscous:"moroccan", tajine:"moroccan",
  libanais:"lebanese", syrien:"syrian", oriental:"lebanese",
  italien:"italian", pizza:"pizza", pates:"italian",
  asiatique:"asian", asie:"asian", wok:"asian",
  japonais:"japanese", sushi:"sushi", ramen:"ramen",
  chinois:"chinese", vietnamien:"vietnamese", thai:"thai", thailandais:"thai",
  coreen:"korean", indien:"indian", pakistanais:"pakistani",
  grec:"greek", portugais:"portuguese", espagnol:"spanish", tapas:"tapas",
  mexicain:"mexican", bresilien:"brazilian", peruvien:"peruvian",
  antillais:"caribbean", creole:"caribbean", americain:"american",
  burger:"burger", francais:"french", brasserie:"french",
  vegetarien:"vegetarian", vegan:"vegan", halal:"halal", casher:"kosher",
  poisson:"seafood", "fruits de mer":"seafood",
};

/* Nombres écrits en toutes lettres : « j'ai quinze euros » doit marcher comme
   « j'ai 15 euros ». La table est construite une seule fois au chargement. */
const MOTS_NOMBRES = (()=>{
  const u = ["","un","deux","trois","quatre","cinq","six","sept","huit","neuf"];
  const p = {0:"zero",1:"un",2:"deux",3:"trois",4:"quatre",5:"cinq",6:"six",7:"sept",
             8:"huit",9:"neuf",10:"dix",11:"onze",12:"douze",13:"treize",14:"quatorze",
             15:"quinze",16:"seize"};
  const m = new Map();
  for(const [n,mot] of Object.entries(p)) m.set(mot, Number(n));
  m.set("une",1);
  for(let i=7;i<=9;i++) m.set("dix "+u[i], 10+i);                    // dix-sept…
  const diz = {20:"vingt",30:"trente",40:"quarante",50:"cinquante",60:"soixante"};
  for(const [d,mot] of Object.entries(diz)){
    m.set(mot, Number(d));
    m.set(mot+" et un", Number(d)+1);
    for(let i=2;i<=9;i++) m.set(mot+" "+u[i], Number(d)+i);
  }
  m.set("soixante dix",70); m.set("soixante et onze",71);
  for(let i=2;i<=9;i++) m.set("soixante "+(p[10+i]||("dix "+u[i])), 70+i);
  m.set("quatre vingt",80); m.set("quatre vingts",80);
  for(let i=1;i<=9;i++) m.set("quatre vingt "+u[i], 80+i);
  m.set("quatre vingt dix",90);
  for(let i=1;i<=9;i++) m.set("quatre vingt "+(p[10+i]||("dix "+u[i])), 90+i);
  m.set("cent",100);
  return m;
})();

/* Index inversé : une seule table pour les cuisines et les catégories, au lieu
   de reparcourir toutes les listes à chaque frappe. */
const INDEX_MOTS = (()=>{
  const m = new Map();
  for(const [id,mots] of Object.entries(CUISINES))
    m.set(sansAccents(id), {cuisine:mots});
  for(const [mot,val] of Object.entries(CUISINES))
    m.set(sansAccents(mot), {cuisine:val});
  for(const [id,c] of Object.entries(CATS))
    m.set(sansAccents(c.label), {cat:id});
  for(const [id,mots] of Object.entries(SYNONYMES))
    mots.forEach(x=>{ if(!m.has(sansAccents(x))) m.set(sansAccents(x), {cat:id}); });
  return m;
})();

/* Repère un montant, en chiffres ou en lettres. */
function montantEuros(t){
  const chiffres = /(\d{1,3})\s*(?:e\b|eu\b|euros?|€)/.exec(t);
  if(chiffres) return Number(chiffres[1]);
  const avant = /([a-z ]{3,28})\s*(?:euros?|balles?|€)/.exec(t);
  if(!avant) return null;
  const mots = avant[1].trim().split(/\s+/);
  // on essaie la plus longue suite de mots qui forme un nombre connu
  for(let d=Math.max(0,mots.length-4); d<mots.length; d++){
    const cle = mots.slice(d).join(" ");
    if(MOTS_NOMBRES.has(cle)) return MOTS_NOMBRES.get(cle);
  }
  return null;
}

function cuisineRecherchee(q){
  const t = sansAccents(q).trim();
  if(t.length < 3) return null;
  const direct = INDEX_MOTS.get(t);          // correspondance exacte, immédiate
  if(direct && direct.cuisine) return direct.cuisine;
  for(const [mot,val] of Object.entries(CUISINES)){
    const m = sansAccents(mot);
    if(t.includes(m)) return val;
  }
  return null;
}

/* Rend « bar », « Bars » et « boire un verre » équivalents. */
function categorieRecherchee(q){
  const t = sansAccents(q).trim();
  if(t.length < 3) return null;
  const direct = INDEX_MOTS.get(t);          // correspondance exacte, immédiate
  if(direct && direct.cat) return direct.cat;
  for(const [id,c] of Object.entries(CATS)){
    if(sansAccents(c.label).includes(t)) return id;
  }
  for(const [id,mots] of Object.entries(SYNONYMES)){
    if(mots.some(m=>{ const s=sansAccents(m); return s.includes(t) || t.includes(s); })) return id;
  }
  return null;
}

/* ---- Cinq besoins, pas trente-trois catégories -------------------------
   L'utilisateur ne doit pas explorer une base de données : il choisit un
   besoin, et l'app traduit. Une catégorie interne peut servir plusieurs
   filtres, mais elle n'a qu'UN seul foyer dans l'interface — sinon on
   retrouve « Street food » à deux endroits et personne ne sait lequel
   cliquer. Les sous-choix restent courts et orientés vers une intention. */
const BESOINS = [
  { id:"manger", emoji:"🍴", label:"Manger", sous:[
      { label:"Restaurants",            cats:["resto"] },
      { label:"Fast-food",              cats:["fastfood"] },
      { label:"Cafés",                  cats:["cafe"] },
      { label:"Marchés et street food", cats:["marche","food"] },
  ]},
  { id:"sortir", emoji:"🎉", label:"Sortir", sous:[
      { label:"Événements",             cats:["event","studio"] },
      { label:"Concerts et spectacles", cats:["concert","spectacle"] },
      { label:"Bars",                   cats:["bar"] },
      { label:"Cinéma",                 cats:["cinema"] },
      { label:"En famille",             cats:["family"] },
      { label:"Sport",                  cats:["sport","terrain"] },
      { label:"Boutiques et fripes",    cats:["friperie","commerce","popup"] },
  ]},
  { id:"chiller", emoji:"☕", label:"Chiller", sous:[
      { label:"Cafés",                  cats:["cafe"] },
      { label:"Parcs et terrasses",     cats:["parc","park"] },
      { label:"Bibliothèques",          cats:["biblio","library"] },
      { label:"Bars tranquilles",       cats:["bar"] },
  ]},
  { id:"bouger", emoji:"⚽", label:"Bouger", sous:[
      { label:"Terrains et équipements",cats:["terrain","sport"] },
      { label:"Piscines",               cats:["swimming_pool"] },
      { label:"Plein air",              cats:["parc","park"] },
      { label:"Vélo",                   cats:["velo"] },
  ]},
  { id:"famille", emoji:"👨‍👩‍👧", label:"Famille", secondaire:true, sous:[
      { label:"Cinéma",                 cats:["cinema"] },
      { label:"Parcs et aires de jeux", cats:["parc","park","playground"] },
      { label:"Bibliothèques et musées",cats:["biblio","musee","library","museum"] },
      { label:"Piscines et loisirs",    cats:["swimming_pool","bowling_alley","zoo","educational_farm"] },
      { label:"Activités jeunesse",     cats:["kids_event","family_event","workshop","youth_activity"] },
  ]},
  // l'aide n'est pas une liste de cases : c'est un mode entier, avec ses
  // propres priorités et ses besoins écrits en français, pas en tags
  { id:"aide", emoji:"❤️", label:"Trouver de l’aide", aide:true },
  // ---- Derrière « Plus » : les besoins réels mais moins fréquents. Ils ne
  // méritent pas une place permanente à l'écran, ils méritent d'exister.
  { id:"etudier", emoji:"📚", label:"Étudier", secondaire:true, sous:[
      { label:"Bibliothèques",          cats:["biblio","library"] },
      { label:"Espaces de travail",     cats:["coworking"] },
      { label:"Cafés où s’installer",   cats:["cafe"] },
  ]},
  { id:"culture", emoji:"🎭", label:"Culture", secondaire:true, sous:[
      { label:"Musées",                 cats:["musee","museum"] },
      { label:"Cinéma",                 cats:["cinema"] },
      { label:"Concerts et spectacles", cats:["concert","spectacle"] },
      { label:"Expositions et ateliers",cats:["studio","workshop"] },
  ]},
  { id:"services", emoji:"🏙️", label:"Services autour de moi", secondaire:true, sous:[
      { label:"Transports",             cats:["metro","bus","velo"] },
      { label:"Bibliothèques et musées",cats:["biblio","coworking","musee"] },
      { label:"Parcs et équipements",   cats:["parc"] },
      { label:"Services publics",       cats:["mairie"] },
      { label:"Écoles",                 cats:["ecole"] },
      { label:"Toilettes et recharge",  cats:["toilettes","recharge"] },
  ]},
];
/* Quatre accès permanents, le reste derrière « Plus » : l'écran de départ
   doit tenir dans un regard, sans amputer l'application de ses besoins. */
/* Étiquettes lisibles des catégories internes, pour les cartes du carousel.
   Un lieu en porte souvent plusieurs : c'est le but de la classification
   pondérée, et la carte doit le montrer (« SORTIR • FAMILLE »). */
const ETIQUETTES_CAT = {
  eat:"MANGER", restaurant:"MANGER", cafe:"MANGER", market:"MANGER",
  outing:"SORTIR", bar:"SORTIR", concert:"SORTIR", show:"SORTIR", event:"SORTIR",
  family:"FAMILLE", kids_event:"FAMILLE", playground:"FAMILLE", family_event:"FAMILLE",
  culture:"CULTURE", museum:"CULTURE", cinema:"CULTURE",
  sport:"SPORT", park:"PLEIN AIR",
  study:"ÉTUDIER", library:"ÉTUDIER",
  help:"AIDE", food_aid:"AIDE", shelter:"AIDE", health:"AIDE",
  services:"SERVICES", transport:"TRANSPORT", buy:"BOUTIQUES",
};

/* Deux catégories différentes peuvent porter la même étiquette : `eat` et
   `restaurant` se lisent tous les deux « MANGER ». Sans déduplication, les
   cartes affichaient « MANGER • MANGER », ce qui se lit comme un bug parce
   que c'en est un. On prend donc les deux premières étiquettes DISTINCTES. */
function etiquettesLisibles(l){
  const vues = [];
  ((l && l.categories) || []).forEach(c=>{
    const e = ETIQUETTES_CAT[c];
    if(e && !vues.includes(e)) vues.push(e);
  });
  return vues.slice(0,2);
}

const BESOINS_PRINCIPAUX  = BESOINS.filter(b=>!b.secondaire);
const BESOINS_SECONDAIRES = BESOINS.filter(b=>b.secondaire);
const BESOIN_DE = id => BESOINS.find(b=>b.id === id);

/* ---- « Est-ce un mot de l'application, ou un nom de lieu ? » ---------------
   categorieRecherchee() cherche des SOUS-CHAÎNES, ce qui est juste pour une
   recherche mais faux pour cette question-là : « Bar-le-Duc » contient « bar »
   sans être un bar, et la commune n'était donc jamais géocodée.
   Ici la comparaison est EXACTE, sur le vocabulaire réellement défini —
   catégories, cuisines, besoins. Aucune ville n'y figure : c'est le géocodeur
   qui sait ce qui est un lieu, pas une liste écrite à la main. */
const MOTS_BESOINS = (()=>{
  const m = new Set();
  BESOINS.forEach(b=>{
    m.add(sansAccents(b.id));
    m.add(sansAccents(b.label));
    (b.sous||[]).forEach(s=>m.add(sansAccents(s.label)));
  });
  return m;
})();

function estTermeMetier(texte){
  const t = sansAccents(String(texte||"")).trim();
  if(!t) return false;
  return INDEX_MOTS.has(t) || MOTS_BESOINS.has(t);
}

/* [clé OSM, valeur, catégorie] — l'ordre compte : la première règle qui
   correspond gagne, donc les cas précis passent avant les cas généraux
   (social_facility=food_bank avant amenity=social_facility). */
const REQUETES = [
  // -- aide, en premier car ce sont des sous-tags d'amenity plus génériques
  ["social_facility","food_bank","alimentaire"], ["social_facility","soup_kitchen","alimentaire"],
  // amenity=food_bank existe aussi, sans la clé social_facility : les Restos
  // du Cœur et les banques alimentaires sont tagués des deux façons
  ["amenity","food_bank","alimentaire"],
  /* Un « foyer », en France, c'est presque tout sauf `social_facility=shelter`.
     Cette famille ne demandait que `shelter`, `group_home` et `refugee_site` :
     sur huit foyers lillois tagués comme ils le sont réellement dans OSM, six
     n'étaient même pas demandés. On couvre donc les valeurs qui portent le
     parc social français — CHRS, résidence sociale, maison relais, pension de
     famille, abri de nuit, foyer de jeunes travailleurs.
     `amenity=shelter` reste EXCLU à dessein : dans OSM c'est un abribus ou un
     abri de pique-nique, pas un hébergement. */
  ["social_facility","shelter","hebergement"],   ["social_facility","group_home","hebergement"],
  ["social_facility","homeless_shelter","hebergement"],
  ["social_facility","emergency_shelter","hebergement"],
  ["social_facility","assisted_living","hebergement"],
  ["social_facility","nursing_home","hebergement"],
  ["amenity","refugee_site","hebergement"], ["amenity","dormitory","hebergement"],
  // accueils de jour et permanences : ce sont eux qu'on cherche en premier
  // quand on a besoin d'aide, et aucun tag ne les ramenait
  ["social_facility","outreach","asso"], ["social_facility","day_centre","asso"],
  ["social_facility","clothing_bank","asso"],
  ["amenity","social_facility","asso"],          ["amenity","social_centre","asso"],
  ["office","association","asso"], ["office","ngo","asso"], ["office","charity","asso"],
  // une maison de quartier est une asso, pas une salle de spectacle : elle
  // était classée dans Sortir et n'apparaissait donc jamais dans Aide
  ["amenity","community_centre","asso"],
  ["community_centre","community_centre","asso"],
  ["club","social","asso"], ["club","charity","asso"], ["club","sport","asso"],
  ["club","culture","asso"], ["club","youth","asso"],
  ["office","employment_agency","emploi"],
  // government=* plutôt que office=government, trop large : il ramenait les
  // impôts et les annexes administratives dans les services d'aide à l'emploi
  ["government","employment_agency","emploi"], ["government","social_welfare","emploi"],
  ["government","public_service","mairie"], ["government","register_office","mairie"],
  // une maison des jeunes est un lieu d'aide, pas un équipement de loisir
  ["amenity","youth_centre","asso"],
  ["social_facility","food_sharing","alimentaire"],

  /* -- SÉCURITÉ ET PROTECTION -------------------------------------------
     LE TAG QUI N'ÉTAIT DEMANDÉ NULLE PART. Ni ici, ni dans l'outil de
     pré-calcul des zones. Aucun commissariat, aucune gendarmerie n'entrait
     donc jamais dans les données d'Autour — et « Sécurité » ne pouvait pas
     rendre un résultat qu'elle n'avait jamais reçu.
     `police=*` (national, municipal, gendarmerie) voyage avec l'objet et dit
     lequel des trois on a trouvé ; il n'a pas besoin d'être demandé. */
  ["amenity","police","securite"],

  // -- santé
  ["amenity","hospital","sante"], ["amenity","clinic","sante"],
  ["amenity","doctors","sante"],  ["amenity","pharmacy","sante"],
  ["amenity","dentist","sante"],  ["amenity","health_post","sante"],
  ["healthcare","centre","sante"], ["healthcare","doctor","sante"],
  ["healthcare","clinic","sante"], ["healthcare","hospital","sante"],
  ["healthcare","pharmacy","sante"], ["healthcare","dentist","sante"],
  ["healthcare","laboratory","sante"], ["healthcare","physiotherapist","sante"],
  ["healthcare","psychotherapist","sante"], ["healthcare","counselling","sante"],

  // -- boutiques : la friperie avant les vêtements neufs, sinon elle est absorbée
  ["shop","second_hand","friperie"], ["shop","charity","friperie"],
  ["shop","clothes","friperie"], ["shop","books","commerce"],
  ["shop","convenience","commerce"], ["shop","supermarket","commerce"],
  ["shop","greengrocer","commerce"], ["shop","butcher","commerce"],
  ["shop","hairdresser","commerce"], ["shop","bakery","cafe"],

  // -- manger
  ["amenity","restaurant","resto"], ["amenity","fast_food","fastfood"],
  ["amenity","cafe","cafe"],        ["amenity","marketplace","marche"],

  // -- sortir
  ["amenity","bar","bar"], ["amenity","pub","bar"], ["amenity","biergarten","bar"],
  ["amenity","cinema","cinema"], ["leisure","cinema","cinema"],
  ["amenity","theatre","spectacle"],
  ["amenity","arts_centre","spectacle"],
  ["amenity","nightclub","concert"], ["amenity","music_venue","concert"],

  // -- ville
  ["amenity","library","biblio"], ["amenity","public_bookcase","biblio"],
  // là où on peut réellement s'installer pour travailler : c'est ce que
  // demande « Étudier », pas un lycée dont les portes sont fermées au public
  ["amenity","coworking_space","coworking"], ["office","coworking","coworking"],
  ["tourism","museum","musee"], ["tourism","gallery","musee"],
  ["leisure","park","parc"], ["leisure","garden","parc"],
  ["leisure","playground","parc"], ["leisure","bowling_alley","terrain"],
  ["leisure","pitch","terrain"], ["leisure","skatepark","terrain"],
  ["leisure","sports_centre","terrain"], ["leisure","swimming_pool","terrain"],
  ["leisure","fitness_centre","terrain"],
  ["tourism","zoo","parc"], ["tourism","farm","parc"],
  ["amenity","school","ecole"], ["amenity","college","ecole"], ["amenity","university","ecole"],
  ["amenity","townhall","mairie"], ["amenity","post_office","mairie"],
  ["amenity","toilets","toilettes"],
  ["amenity","shower","toilettes"], ["amenity","public_bath","toilettes"],
  ["amenity","charging_station","recharge"],
  ["amenity","bicycle_rental","velo"], ["amenity","bicycle_parking","velo"],

  // -- transports
  ["station","subway","metro"], ["railway","subway_entrance","metro"],
  // une gare ferroviaire n'est pas une station de métro, et un arrêt de tram
  // n'est pas un arrêt de bus : la nomenclature de la carte doit dire le vrai
  // mode, sinon on envoie quelqu'un chercher un arrêt qui n'existe pas
  ["railway","station","train"], ["railway","halt","train"],
  ["railway","tram_stop","tram"], ["highway","bus_stop","bus"], ["amenity","bus_station","bus"],
];

/* ---- Les tags trop vagues pour n'appartenir qu'à une famille -------------
   `amenity=social_facility` sans sous-tag est, en France, le tag le plus
   répandu du secteur social : c'est aussi bien un foyer qu'une permanence,
   une épicerie solidaire ou un service social de secteur. REQUETES le range
   dans « asso », ce qui est le moins faux — mais avait une conséquence que
   personne ne voyait : une recherche « foyer », qui vise l'hébergement, ne le
   DEMANDAIT même pas à Overpass. Les foyers existaient, l'application ne les
   réclamait jamais.

   Ces tags-là sont donc demandés pour plusieurs familles à la fois. C'est le
   nom qui tranche ensuite (voir `affinerCategorie`) : mieux vaut ramener un
   lieu et le classer approximativement que ne jamais aller le chercher. */
const TAGS_PARTAGES = [
  ["amenity","social_facility", ["asso","hebergement","alimentaire"]],
];

/* ================================================================== */
/*  Publications partagées                                            */
/* ================================================================== */

/* Identité anonyme : aucun compte à remplir, aucune adresse mail. Explorer et
   lire restent publics. Une session n'est créée qu'au premier geste qui doit
   appartenir à quelqu'un (favori, participation ou publication). Pour publier,
   le seul renseignement demandé est un prénom ou pseudo d'affichage ; l'uid
   Supabase, jamais ce pseudo, reste l'unique preuve de propriété. */
const SUPABASE_URL = "https://sxnzyvcgwbwnpjnqmpkp.supabase.co";
const SUPABASE_CLE = "sb_publishable_T4_3er0DEI9vX4YdEhPDIw_m3yV_FlM";

const CLE_PSEUDO_CREATEUR = "autour:creator_name";
let sb = null, sbLecture = null, moiId = null, monPseudo = "";

/* LE BASSIN MÉTROPOLITAIN. « Pour toi » cherche dans toute la métropole, pas
   dans la commune où l'on se tient. Ces trois-là sont déclarés ici, et non
   près des fonctions qui les emploient, parce que `rafraichirMetropole()` est
   appelée pendant le chargement des couches — bien avant. */
let bassinTerritorialActif = null;
let evenementsMetropole = [];
let metropoleEnCours = null;
const METROPOLE_LIMITE = 300;
try{ monPseudo = String(localStorage.getItem(CLE_PSEUDO_CREATEUR) || "").trim().slice(0,50); }catch(e){}

/* LE SDK VIENT DE CHEZ NOUS, ET C'EST TOUTE L'AFFAIRE.

   Il était servi par un CDN tiers. Un bloqueur de publicités — `jsdelivr`
   figure sur des listes de filtrage courantes —, un réseau d'entreprise ou
   une panne de ce CDN suffisaient alors à rendre TOUT le service de comptes
   inaccessible : ni publication, ni connexion, ni favoris. Une dépendance
   extérieure décidait qu'une fonction entière de l'application n'existait
   plus, et un miroir n'y changeait rien : un filtre qui bloque un CDN par
   motif les bloque tous.

   Le fichier est donc dans le dépôt, servi par notre propre origine. Ce n'est
   pas un repli : c'est la seule source. Si elle tombe, la page elle-même n'est
   pas là, et la question ne se pose plus.

   La version est dans le NOM DU FICHIER, ce qui le rend immuable par
   construction : `vercel.json` archive tout `.js` pour un an, et changer de
   version change l'URL. Aucun tampon d'empreinte n'est donc nécessaire ici —
   contrairement aux modules, ce fichier ne change jamais sans que son nom
   change aussi.

   Provenance, pour qu'elle soit vérifiable :
     @supabase/supabase-js@2.108.2 · dist/umd/supabase.js
     récupéré par `npm pack` (qui vérifie l'intégrité auprès du registre)
     sha256 c123f7e874934778b7d89fee7dce8de26c858a2c3a92fd7a3f870394a6a2f91f

   200 ko bruts, 51 ko compressés — qui ne servent qu'aux comptes et aux
   publications. D'où le chargement paresseux : ce poids ne doit jamais peser
   sur le premier affichage, et il n'y pèse pas.

   UN ÉCHEC DE CHARGEMENT N'EST PAS UN VERDICT.

   Ce chargeur mémorisait sa promesse, y compris quand elle s'était résolue à
   « non ». Le premier échec — pendant le démarrage, où il est sans gravité —
   condamnait toute la session : les essais suivants répondaient « non » en
   zéro milliseconde, sans qu'aucune requête ne parte. Servir le fichier
   nous-mêmes rend ce cas rare, il ne le rend pas impossible : un réseau qui
   coupe au mauvais moment produit le même effet. L'échec n'est donc toujours
   pas mémorisé, et chaque essai repart d'une balise neuve — une balise dont
   `onerror` a tiré est morte.

   La patience dépend de qui demande. Au démarrage, quatre secondes : le SDK
   n'est pas sur le chemin critique et l'écran ne doit pas l'attendre. Quand
   c'est la personne qui a demandé quelque chose, on attend bien plus —
   revenir les mains vides lui coûte plus cher que d'attendre. */
const SUPABASE_SDK = Object.freeze(["/vendeur/supabase-2.108.2.js"]);
const SUPABASE_ATTENTE_DEMARRAGE = 4000;
const SUPABASE_ATTENTE_DEMANDE = 12000;

/* Ce que voit quelqu'un dont le réseau bloque le service de comptes. La phrase
   d'avant — « Connexion impossible pour le moment. » — décrivait un état sans
   jamais dire quoi en faire, et l'essai suivant renvoyait exactement la même
   chose. Celle-ci nomme la cause la plus fréquente et laisse une porte : le
   bouton, lui, retente désormais pour de bon. */
const MESSAGE_SERVICE_INJOIGNABLE =
  "Le service de connexion est injoignable. Un bloqueur de publicités ou le " +
  "réseau peut en être la cause. Réessaie, ou passe par un autre réseau.";

let pSupabase = null;
let pConnexion = null;

function chargerScriptSupabase(src, attente){
  return new Promise(ok=>{
    const el = document.createElement("script");
    let fini = false;
    const terminer = (disponible)=>{
      if(fini) return;
      fini = true;
      clearTimeout(gardeFou);
      ok(disponible);
    };
    // Version épinglée : une mise à jour du CDN ne doit pas changer le contrat
    // Auth au milieu d'une session Autour.
    el.src = src;
    el.onload = ()=>terminer(!!window.supabase);
    el.onerror = ()=>terminer(false);
    const gardeFou = setTimeout(()=>terminer(!!window.supabase), attente);
    PERF.requete("supabase_sdk");
    document.head.appendChild(el);
  });
}

function chargerSupabase(options){
  if(window.supabase) return Promise.resolve(true);
  // une tentative déjà en vol est partagée : deux appels simultanés ne doivent
  // pas injecter deux fois le SDK
  if(pSupabase) return pSupabase;
  const o = options || {};
  /* UNE ÉCHÉANCE, PAS UN DÉLAI PAR TENTATIVE. Deux miroirs à douze secondes
     chacun feraient vingt-quatre secondes de bouton « Envoi… », ce qui est
     pire que l'échec qu'on répare. Le budget est global : une origine bloquée
     échoue en quelques millisecondes et laisse presque tout le temps à la
     suivante ; une origine lente le consomme, et c'est juste — si le réseau
     traîne, le miroir traînera autant. */
  const echeance = Date.now() +
    (o.demande ? SUPABASE_ATTENTE_DEMANDE : SUPABASE_ATTENTE_DEMARRAGE);
  pSupabase = (async()=>{
    for(const src of SUPABASE_SDK){
      const reste = echeance - Date.now();
      if(reste < 250) break;
      if(await chargerScriptSupabase(src, reste)) return true;
      // `new URL(src)` lèverait sur un chemin relatif : on journalise le chemin
      journal.warn("Supabase indisponible : "+src);
    }
    return false;
  })();
  const promesse = pSupabase;
  promesse.then(disponible=>{
    /* On n'oublie que l'échec. Le succès reste mémorisé — mais de toute façon
       `window.supabase` répond alors avant même d'arriver ici. */
    if(!disponible && pSupabase === promesse) pSupabase = null;
  });
  return promesse;
}

function lireClaimsJwt(jeton){
  try{
    const partie = String(jeton || "").split(".")[1];
    if(!partie) return null;
    const base64 = partie.replace(/-/g,"+").replace(/_/g,"/") + "===".slice((partie.length+3)%4);
    return JSON.parse(atob(base64));
  }catch(e){ return null; }
}

function sessionJwtDecalee(session){
  if(!session || !session.access_token) return false;
  const claims = lireClaimsJwt(session.access_token);
  if(!claims) return false;
  const maintenant = Math.floor(Date.now()/1000);
  // Une petite dérive d'horloge est normale. Au-delà d'une minute, PostgREST
  // refuse le jeton avec « JWT issued at future ».
  return Number(claims.iat) > maintenant + 60 || Number(claims.exp) <= maintenant + 30;
}

async function reparerSession(session){
  if(!session || !sessionJwtDecalee(session)) return session || null;
  try{
    PERF.requete("supabase_refresh");
    const {data,error} = await sb.auth.refreshSession(session);
    if(error || !data || !data.session) throw error || new Error("session absente");
    return data.session;
  }catch(e){
    // Le refresh token invalide reste local au navigateur. On retire uniquement
    // cette session cassée ; aucune donnée Supabase n'est supprimée.
    try{ await sb.auth.signOut({scope:"local"}); }catch(e2){}
    return null;
  }
}

/* `demande` distingue les deux appelants : le démarrage, qui ne doit rien
   attendre, et un geste explicite, qui mérite qu'on insiste. */
async function connecter(options){
  if(sb) return sb;
  if(pConnexion) return pConnexion;
  pConnexion = (async()=>{
    if(!(await chargerSupabase(options))) return null;
    try{
      /* Les lectures publiques ne doivent jamais hériter d'un ancien JWT de
         session. C'est lui qui faisait échouer `publications_proches` avec
         « JWT issued at future » alors que la table est lisible publiquement. */
      sbLecture = window.supabase.createClient(SUPABASE_URL, SUPABASE_CLE, {
        auth:{persistSession:false, autoRefreshToken:false, detectSessionInUrl:false,
          storageKey:"autour-public-read-v1"}
      });
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_CLE);
      PERF.requete("supabase_session");
      const { data:{ session:sessionBrute }, error } = await sb.auth.getSession();
      if(error) throw error;
      appliquerSession(await reparerSession(sessionBrute));

      /* Une connexion peut arriver sans qu'on l'ait demandée depuis cet
         écran : le lien reçu par e-mail rouvre la page, et c'est Auth qui
         signale l'événement. On écoute donc plutôt que de sonder — et c'est
         ici, en un seul endroit, que l'action mise en attente reprend. */
      sb.auth.onAuthStateChange((evenement, s)=>{
        const avant = etatCompte;
        appliquerSession(s);
        if(etatCompte === "connecte" && avant !== "connecte"){
          chargerProfil().then(()=>{
            chargerFavoris(); rafraichirCanaux(); majNavBas();
            reprendreActionEnAttente();
          });
        }
        if(evenement === "SIGNED_OUT") majNavBas();
      });

      if(estConnecte()) chargerProfil();
      return sb;
    }catch(e){
      console.error("Identité anonyme indisponible :", e.message || e);
      sb = null;
      return null;
    }
  })();
  const resultat = await pConnexion;
  if(!resultat) pConnexion = null;
  return resultat;
}

/* LA SESSION ANONYME A DISPARU, ET C'EST LE FOND DE CETTE PASSE.

   Autour signait automatiquement chaque visiteur en anonyme. Ça donnait un
   `auth.uid()` sans rien demander — pratique — mais cet uid vivait dans le
   stockage d'un navigateur : vider son cache, et ses propres publications
   devenaient celles d'un inconnu, que plus personne ne pouvait modifier.

   La base refuse désormais toute écriture à une session anonyme. En fabriquer
   une ne servirait donc qu'à créer un compte fantôme de plus. Les écritures
   passent par `exigerCompte`, les lectures ne demandent toujours rien.

   Les sessions anonymes déjà existantes ne sont pas perdues : rattacher une
   adresse à l'une d'elles conserve son uid, donc ses publications. */

/* ==================================================================== */
/*  Le compte : demandé au moment où il sert, jamais à l'ouverture       */
/* ==================================================================== */
/* Ce que ce bloc pilote, `comptes.js` le décide : quelles actions exigent un
   compte, avec quels mots on le demande, et comment reprendre ce qui était
   commencé. Ce que ce bloc GARANTIT, en revanche, est nul — la garantie est
   en base (`created_by = auth.uid()` et les policies RLS). Contourner ce
   JavaScript ne donne pas un accès : ça donne un refus du serveur. */
const COMPTES = window.AutourComptes || null;

let session = null;          // la session Supabase, telle que Auth la rend
let monProfil = null;        // { display_name, notifications } — jamais l'e-mail
let etatCompte = COMPTES ? COMPTES.VISITEUR : "visiteur";

function estConnecte(){ return etatCompte === "connecte"; }

/* Une seule fonction met l'état à jour, et une seule met l'écran à jour après
   elle. Deux endroits qui recalculent « suis-je connecté ? » finissent
   toujours par ne plus être d'accord. */
function appliquerSession(s){
  session = s || null;
  moiId = session && session.user ? session.user.id : null;
  etatCompte = COMPTES ? COMPTES.etatDe(session) : (moiId ? "anonyme" : "visiteur");
  return etatCompte;
}

function monEmail(){
  return (session && session.user && session.user.email) || "";
}

/* Le pseudo public. Il ne participe JAMAIS à l'autorisation : le perdre ne
   retire aucune propriété, l'usurper n'en donne aucune. */
async function chargerProfil(){
  if(!sb || !moiId) { monProfil = null; return null; }
  try{
    const { data, error } = await sb.from("profiles")
      .select("display_name,notifications").eq("id", moiId).maybeSingle();
    if(error) throw error;
    monProfil = data || null;
    if(monProfil && monProfil.display_name) monPseudo = monProfil.display_name;
    lireConsultationCompte();
    return monProfil;
  }catch(e){
    console.error("Profil indisponible :", e.message || e);
    return null;
  }
}

/* LE PORTILLON.

   `exigerCompte` ne montre un écran que si l'action en demande un ET que la
   personne n'en a pas. Sinon elle exécute, tout de suite : une confirmation
   inutile est une friction de plus sur un geste déjà décidé.

   `reprise` est rejouée après la connexion — c'est elle qui évite de renvoyer
   quelqu'un à l'accueil avec son formulaire à refaire. */
/* La date de dernière consultation de « Pour toi » vit sur le compte quand la
   base la porte : c'est elle qui dit, sur un appareil neuf, ce qui est
   réellement nouveau. Tant que la colonne n'existe pas, la mémoire locale fait
   foi et on cesse d'interroger le compte. */
let consultationCompte = null;
let consultationCompteBloquee = false;

async function lireConsultationCompte(){
  if(consultationCompteBloquee || !sb || !moiId || !estConnecte()) return null;
  try{
    const { data, error } = await sb.from("profiles").select("pourtoi_consulte_le").eq("id", moiId).maybeSingle();
    if(error) throw error;
    const t = data && data.pourtoi_consulte_le ? Date.parse(data.pourtoi_consulte_le) : NaN;
    consultationCompte = Number.isFinite(t) ? t : null;
  }catch(e){
    consultationCompteBloquee = true;
    consultationCompte = null;
  }
  majPastillePourToi();
  return consultationCompte;
}

async function ecrireConsultationCompte(marque){
  if(consultationCompteBloquee || !sb || !moiId || !estConnecte()) return;
  try{
    const { error } = await sb.from("profiles").update({ pourtoi_consulte_le: new Date(marque).toISOString() }).eq("id", moiId);
    if(error) throw error;
    consultationCompte = marque;
  }catch(e){
    consultationCompteBloquee = true;
  }
}

const REPRISES = new Map();

function enregistrerReprise(action, fn){ REPRISES.set(action, fn); }

async function exigerCompte(action, charge){
  if(!COMPTES || !COMPTES.exigeCompte(action)) return true;
  await connecter();
  if(estConnecte()) return true;
  COMPTES.mettreEnAttente(action, charge || null);
  ouvrirEcranCompte(action);
  return false;
}

/* Reprendre après la connexion. Le lien reçu par e-mail fait QUITTER la page :
   au retour, cette fonction retrouve l'intention dans `sessionStorage` et la
   rejoue. Le code à six chiffres, lui, ne quitte pas la page — même chemin,
   même reprise, et rien à réapprendre. */
async function reprendreActionEnAttente(){
  if(!COMPTES) return;
  const attente = COMPTES.reprendreAttente();
  if(!attente) return;
  const reprise = REPRISES.get(attente.action);
  if(!reprise) return;
  try{ await reprise(attente.charge); }
  catch(e){ console.error("Reprise impossible :", e); }
}

/* Le pseudo est facultatif : publier ne doit pas dépendre de son existence.
   Avant, un `prompt()` bloquant le réclamait à la première publication et
   annuler ce prompt annulait la publication. */
async function assurerIdentitePublication(){
  if(!(await connecter())) return null;
  if(!estConnecte()) return null;
  return { id:moiId, name: monPseudo || (monProfil && monProfil.display_name) || null };
}

function estPublicationAMoi(l){
  return !!(l && l.dbId && moiId && l.creatorId === moiId);
}

function visuelPublication(p){
  const url = p.image_url || p.image || "";
  const source = p.verifie ? "structure" : "autour";
  const v = IMAGES && IMAGES.visuel({
    image_url:url, image_source:source,
    image_source_url:p.url || "",
    image_author:p.creator_name || "",
    image_license:IMAGES ? IMAGES.licenceImplicite(source) : "",
    image_updated_at:p.updated_at || p.cree_le || null,
    image_scope:"evenement",
  });
  if(!v) return {image:"", imageSource:"", image_scope:"evenement"};
  return {
    image:v.image_url, imageSource:v.image_source,
    image_url:v.image_url, image_source:v.image_source,
    image_source_url:v.image_source_url, image_author:v.image_author,
    image_license:v.image_license, image_updated_at:v.image_updated_at,
    image_type:v.image_type, image_confidence:v.image_confidence,
    image_width:v.image_width, image_height:v.image_height,
    image_scope:"evenement",
  };
}

function premiereDateObjet(objet, champs){
  const source = objet || {};
  for(const champ of champs){
    const valeur = source[champ];
    if(valeur == null || valeur === "") continue;
    const epoch = typeof valeur === "number" ? valeur : new Date(valeur).getTime();
    if(Number.isFinite(epoch)) return valeur;
  }
  return null;
}

function versLieu(p){
  /* `created_by` est le propriétaire canonique. `creator_id` demeure lu pour
     les réponses RPC antérieures à la migration : il ne sert jamais à donner
     une propriété à une publication qui n'en avait pas. */
  const createdBy = p.created_by || p.creator_id || null;
  return normaliserItem({
    id:"pub"+p.id, dbId:p.id, cat:p.cat, titre:p.titre,
    description:p.description || "", adresse:p.adresse || "", cp:p.cp || commune,
    quand:p.quand || "Bientôt", gratuit:p.gratuit, prix:p.prix, places:p.places,
    par: p.verifie ? "Structure vérifiée" : (p.creator_name || "Habitant du quartier"),
    creatorId:createdBy, creatorName:p.creator_name || "",
    verifie: p.verifie, mien: !!(moiId && createdBy === moiId),
    lat:p.lat, lng:p.lng,
    categories:Array.isArray(p.categories) ? p.categories : [p.cat],
    debutLe: (()=>{ const v = premiereDateObjet(p, ["start_at", "startAt", "debut_le", "debutLe"]);
      return v == null ? null : new Date(v).getTime(); })(),
    finLe: (()=>{ const v = premiereDateObjet(p, ["end_at", "endAt", "fin_le", "finLe"]);
      return v == null ? null : new Date(v).getTime(); })(),
    isTemporary:true, url:p.url || "",
    /* L'affiche d'une publication appartient à qui l'a déposée : c'est la
       provenance la plus claire qu'Autour possède, et la seule qui n'ait
       aucune contrainte d'attribution externe. */
    ...visuelPublication(p),
    /* Une annulation était enregistrée en base, écrite dans le canal, et
       perdue ici : la carte et la fiche affichaient l'événement comme s'il
       avait lieu. Quelqu'un se déplaçait pour rien. */
    status:p.status || (p.annule ? "cancelled" : "active"),
    annule: p.status === "cancelled" || !!p.annule
  }, "autour");
}

/* Passe par une fonction en base plutôt que par un select * : seules les
   colonnes affichées reviennent, la zone est filtrée côté serveur et les
   événements terminés sont écartés avant d'être transmis. */
/* CE QUE L'ON DEMANDE N'EST PAS CE QUE L'ON VOIT.

   Cette fonction interrogeait la base sur l'emprise VISIBLE. Sur un téléphone
   au zoom 16, cette emprise fait 590 mètres de large — un écran de 390 points
   à 1,5 mètre le point. Deux événements publiés à 380 et 560 mètres à l'ouest,
   soit sept minutes à pied, tombaient hors du rectangle et n'étaient donc
   jamais demandés. Sur un écran d'ordinateur, ou pendant le court moment où la
   carte n'est pas encore installée (l'ancien repli valait ±0,06°, soit huit
   kilomètres), les mêmes événements apparaissaient. D'où un défaut qui semblait
   capricieux : il dépendait de la largeur de l'écran.

   Les publications sont rares — quelques dizaines par ville, plafonnées à 120
   par requête. Les demander sur un rayon confortable ne coûte rien, et c'est
   le classement, pas la base, qui décide ensuite de ce qui mérite l'écran. */
const RAYON_PUBLICATIONS_M = 5000;

function emprisePublications(lat, lng){
  let dLat = RAYON_PUBLICATIONS_M / 111320;
  let dLng = RAYON_PUBLICATIONS_M /
    (111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180)));
  /* On élargit jusqu'à la vue quand elle est plus grande — explorer une région
     entière continue de ramener ce qu'on y voit — mais on reste CENTRÉ sur le
     point demandé. Faire l'union des deux rectangles produisait, le temps que
     la carte rattrape la position, une emprise allant de Paris à Tourcoing :
     une boîte de deux cents kilomètres pour chercher ce qui est à côté. */
  const vue = bornesVisibles();
  if(vue){
    const c = { lat:(Number(vue.s)+Number(vue.n))/2, lng:(Number(vue.o)+Number(vue.e))/2 };
    dLat = Math.max(dLat, Number(vue.n) - c.lat);
    dLng = Math.max(dLng, Number(vue.e) - c.lng);
  }
  return { s:lat-dLat, n:lat+dLat, o:lng-dLng, e:lng+dLng };
}

/* ---- Cache territorial Supabase -----------------------------------------
   Les publications et les événements canoniques étaient demandés par trois
   chemins voisins au démarrage (initialisation, zone et données temporaires).
   Le réseau recevait donc trois fois les deux mêmes RPC, plus trois résolutions
   de territoire. Cette couche possède une seule requête en vol par zone et un
   petit cache stale-while-revalidate : une réponse récente s'affiche sans
   attendre, puis une version plus fraîche la remplace uniquement si elle a
   réellement changé.

   La clé est la cellule géographique arrondie de la requête : elle reste la
   même pendant l'installation du contexte, mais Lille, Tourcoing et Paris ne
   peuvent jamais partager une entrée. Quatre
   zones au plus, trente minutes au plus — assez pour un retour en arrière,
   trop peu pour transformer un ancien statut temporel en vérité durable. */
const CLE_CACHE_COUCHES_SUPABASE = "autour:supabase-zones:v1";
const CACHE_COUCHE_FRAICHE_MS = 5 * 60 * 1000;
const CACHE_COUCHE_MAX_MS = 30 * 60 * 1000;
const CACHE_COUCHES_ZONES_MAX = 4;
const requetesCouchesSupabase = new Map();
const signaturesCouchesPubliees = new Map();
let cacheCouchesSupabaseMemo = null;

function cleCoucheSupabase(lat,lng){
  return "geo@"+Number(lat).toFixed(2)+","+Number(lng).toFixed(2);
}

function cacheCouchesSupabase(){
  if(cacheCouchesSupabaseMemo) return cacheCouchesSupabaseMemo;
  let cache = {};
  try{ cache = JSON.parse(localStorage.getItem(CLE_CACHE_COUCHES_SUPABASE) || "{}") || {}; }
  catch(e){ cache = {}; }
  const maintenant = Date.now();
  Object.keys(cache).forEach(cle=>{
    const entree = cache[cle];
    if(!entree || !Number.isFinite(entree.t) || maintenant-entree.t > CACHE_COUCHE_MAX_MS)
      delete cache[cle];
  });
  cacheCouchesSupabaseMemo = cache;
  return cache;
}

function ecrireCacheCouchesSupabase(cle, entree){
  const cache = cacheCouchesSupabase();
  cache[cle] = {
    t:entree.t,
    publications:entree.publications || [],
    evenements:entree.evenements || [],
  };
  const cles = Object.keys(cache).sort((a,b)=>(cache[b].t||0)-(cache[a].t||0));
  cles.slice(CACHE_COUCHES_ZONES_MAX).forEach(c=>delete cache[c]);
  try{ localStorage.setItem(CLE_CACHE_COUCHES_SUPABASE, JSON.stringify(cache)); }
  catch(e){
    /* Une image ou une longue description peut remplir le quota. On garde la
       zone courante, qui est précisément celle dont la prochaine ouverture a
       besoin, au lieu de rendre le cache entier inutilisable. */
    cles.slice(1).forEach(c=>delete cache[c]);
    try{ localStorage.setItem(CLE_CACHE_COUCHES_SUPABASE, JSON.stringify(cache)); }
    catch(e2){}
  }
}

function signatureCoucheSupabase(entree){
  const champs = (l)=>[
    l && l.id, l && l.titre, l && l.title,
    l && l.debutLe, l && l.finLe, l && l.start_at, l && l.end_at,
    l && l.temporalStatus, l && l.temporal_status,
    l && l.price_amount, l && l.price_text, l && l.is_free, l && l.audience,
    l && l.min_age, l && l.reservation_required, l && l.reservation_text,
    l && l.event_source, l && l.event_source_url, l && l.place_source,
    l && l.description,
    l && l.status, l && l.annule, l && l.cancelled,
    l && l.lat, l && l.lng, l && l.majLe, l && l.last_synced_at,
  ].join("~");
  return [
    ...(entree.publications || []).map(champs),
    "#",
    ...(entree.evenements || []).map(champs),
  ].join("|");
}

function coucheSupabaseToujoursCourante(cle, portee, lat, lng){
  if(!porteeValide(portee)) return false;
  const centre = centreDonnees();
  if(!centre) return false;
  return cleCoucheSupabase(centre[0], centre[1]) === cle &&
    distanceM(centre[0], centre[1], lat, lng) < 1600;
}

function publierCoucheSupabase(cle, entree, portee, lat, lng){
  if(!coucheSupabaseToujoursCourante(cle, portee, lat, lng)) return false;
  const signature = signatureCoucheSupabase(entree);
  if(signaturesCouchesPubliees.get(cle) === signature) return false;
  signaturesCouchesPubliees.set(cle, signature);
  fusionnerLots([
    {donnees:entree.publications, flux:"user"},
    {donnees:entree.evenements, flux:"external"},
  ]);
  return !!((entree.publications || []).length || (entree.evenements || []).length);
}

async function chargerPublications(lat,lng){
  if(!sbLecture) return null;
  const b = emprisePublications(lat, lng);
  const fini = PERF.requete("supabase_publications");
  try{
    const { data, error } = await sbLecture.rpc("publications_proches", {
      p_sud:Number(b.s), p_ouest:Number(b.o),
      p_nord:Number(b.n), p_est:Number(b.e), p_limite:120
    });
    if(error){ console.error("Lecture des publications :", error.message); return null; }
    return (data||[]).map(versLieu);
  } finally { fini(); }
}

/* ---- Les événements de la couche canonique -------------------------------

   D'OÙ VIENNENT LES ÉVÉNEMENTS, MAINTENANT.

   Ils venaient de DATAtourisme, appelée depuis le navigateur au moment où
   quelqu'un ouvrait Autour. L'écran attendait donc un fournisseur tiers pour
   se remplir, et une panne chez lui était une panne ici.

   Le sens de la flèche est inversé : `sync-datatourisme` lit le catalogue
   côté serveur, à froid, normalise, déduplique et range dans `events`. Cette
   page ne connaît plus qu'une porte, `evenements_proches`, et elle répond
   même si DATAtourisme est injoignable — avec des données un peu plus
   vieilles, ce que le journal de synchronisation sait dire.

   Le statut temporel arrive CALCULÉ. On ne le recalcule pas : `temporel.js`
   se contente de le traduire (voir STATUTS_CANONIQUES). Deux moteurs qui
   répondent chacun de leur côté finissent par diverger, et c'est toujours
   quelqu'un qui se déplace pour rien qui paie l'écart.

   Les publications Autour ne sont PAS demandées ici : elles continuent
   d'arriver par `publications_proches`, qui porte la propriété, les places et
   le prix. Les demander des deux côtés afficherait deux fois le même
   événement. */
/* Les six champs du contrat, tels que `evenements_proches` les rend. Quand la
   base est plus ancienne que la migration de provenance, `IMAGES` retrouve la
   source depuis l'hébergeur plutôt que de la deviner. */
function visuelEvenement(e){
  const v = IMAGES && IMAGES.visuelEvenement({
    image_url:e.image_url || "",
    image_source:e.image_source || (IMAGES && e.image_url ? IMAGES.normaliserAncienneSource({
      image:e.image_url, source:e.primary_source,
    }) : ""),
    image_source_url:e.image_source_url || e.source_url || "",
    image_author:e.image_author || "",
    image_license:e.image_license || "",
    image_updated_at:e.image_updated_at || e.last_synced_at || null,
    image_type:e.image_type || e.imageType || "",
    image_confidence:e.image_confidence || e.imageConfidence || "",
    image_width:e.image_width || e.imageWidth || null,
    image_height:e.image_height || e.imageHeight || null,
    image_scope:"evenement",
  });
  if(!v) return {image:"", imageSource:"", image_scope:"evenement"};
  return {
    image:v.image_url, imageSource:v.image_source,
    imageAttribution:IMAGES.creditObligatoire(v) && v.image_author
      ? [{name:v.image_author, url:v.image_source_url}] : null,
    image_url:v.image_url, image_source:v.image_source,
    image_source_url:v.image_source_url, image_author:v.image_author,
    image_license:v.image_license, image_updated_at:v.image_updated_at,
    image_type:v.image_type, image_confidence:v.image_confidence,
    image_width:v.image_width, image_height:v.image_height,
    image_scope:"evenement",
  };
}

function versEvenementCanonique(e){
  const premiere = (champs) => {
    for(const champ of champs){
      const valeur = e[champ];
      if(valeur == null || valeur === "") continue;
      const epoch = typeof valeur === "number" ? valeur : new Date(valeur).getTime();
      if(Number.isFinite(epoch)) return valeur;
    }
    return null;
  };
  const debutBrut = premiere(["start_at", "startAt", "debut_le", "debutLe"]);
  const finBrut = premiere(["end_at", "endAt", "fin_le", "finLe"]);
  const debut = debutBrut != null && debutBrut !== "" ? new Date(debutBrut).getTime() : null;
  const fin = finBrut != null && finBrut !== "" ? new Date(finBrut).getTime() : null;
  const villeContexte = (typeof activeLocationContext !== "undefined" && activeLocationContext?.city) ||
    ((typeof activeLocationContext !== "undefined" && activeLocationContext?.mode === "gps") ? commune : "");
  return normaliserItem({
    id:"evt"+e.id, dbId:e.id,
    cat:e.category || "event",
    titre:e.title,
    description:e.description || "",
    adresse:e.place_name || e.address || "",
    cp:[e.city, e.insee_code].filter(Boolean).join(" ") || villeContexte,
    lat:e.lat, lng:e.lng,
    debutLe:debut, finLe:fin,
    timezone:e.timezone || "Europe/Paris",
    start_at:e.start_at || null,
    end_at:e.end_at || null,
    /* Le verdict de la base, transmis intact. C'est lui qui décide de
       « Maintenant », pas la date ci-dessus. */
    temporalStatus:e.temporal_status,
    dateConfidence:e.date_confidence,
    /* LES MÉTADONNÉES DE RECOMMANDATION, TRANSMISES EXPLICITEMENT.

       `classerPourToi` ne travaille pas sur le titre : il apparie les
       `announcement_tags` aux envies suivies, borne par le bassin et pondère
       par l'importance. Aucun de ces champs n'était recopié ici — la fiche
       arrivait donc au classement sans un seul tag, `correspondances()` ne
       trouvait rien, et `classer()` rejetait TOUT. « Pour toi » était vide par
       construction, même une fois la course du territoire corrigée.

       Les deux graphies sont posées parce que les modules acceptent les deux
       et qu'aucune n'est plus canonique que l'autre à cet endroit. */
    announcement_tags:Array.isArray(e.announcement_tags) ? e.announcement_tags : [],
    announcementTags:Array.isArray(e.announcement_tags) ? e.announcement_tags : [],
    artist_names:Array.isArray(e.artist_names) ? e.artist_names : [],
    artistNames:Array.isArray(e.artist_names) ? e.artist_names : [],
    music_genres:Array.isArray(e.music_genres) ? e.music_genres : [],
    musicGenres:Array.isArray(e.music_genres) ? e.music_genres : [],
    event_kind:e.event_kind || null,
    eventKind:e.event_kind || null,
    performers:Array.isArray(e.performers) ? e.performers : [],
    metro_area:e.metro_area || null,
    metroArea:e.metro_area || null,
    territory_slug:e.territory_slug || null,
    importance_level:e.importance_level || "local",
    importanceLevel:e.importance_level || "local",
    importance_score:e.importance_score != null ? e.importance_score : null,
    announced_at:e.announced_at || null,
    announcedAt:e.announced_at || null,
    presale_at:e.presale_at || null,
    tickets_open_at:e.tickets_open_at || null,
    date_confidence:e.date_confidence,
    temporal_status:e.temporal_status,
    price_amount:e.price_amount,
    price_text:e.price_text,
    is_free:e.is_free,
    price_confidence:e.price_confidence,
    audience:e.audience,
    min_age:e.min_age,
    reservation_required:e.reservation_required,
    reservation_text:e.reservation_text,
    venue_name:e.venue_name || e.place_name || null,
    organizer_name:e.organizer_name || e.organizer || null,
    event_source:e.event_source || e.primary_source || null,
    event_source_url:e.event_source_url || e.source_url || null,
    place_source:e.place_source || null,
    primary_source:e.primary_source || null,
    primarySource:e.primary_source || null,
    lastSourceUpdate:e.last_source_update || null,
    lastSyncedAt:e.last_synced_at || null,
    last_source_update:e.last_source_update || null,
    last_synced_at:e.last_synced_at || null,
    isTemporary:true,
    annule:!!e.cancelled,
    status:e.cancelled ? "cancelled" : "active",
    par:e.event_source === "openagenda" ? "OpenAgenda"
      : e.event_source === "datatourisme" ? "DATAtourisme"
        : e.event_source || e.primary_source || "Source à vérifier",
    url:"",   // une fiche Autour ne redirige pas vers une URL fournisseur
    /* L'AFFICHE DE L'ÉVÉNEMENT, AVEC SA VRAIE PROVENANCE.

       Cette ligne écrivait `imageSource:"datatourisme_licence"` pour TOUTE
       image d'événement. Or DATAtourisme n'en fournit aucune — son connecteur
       écrit `image_url: null` — et les seules affiches en base viennent
       d'OpenAgenda. On étiquetait donc une affiche d'organisateur comme une
       image sous licence ouverte de catalogue, et `photoAutoriseeAide` la
       laissait passer sur ce faux titre.

       La provenance arrive maintenant de la base, où le connecteur l'a
       écrite. `image_scope` marque que c'est l'affiche de L'ÉVÉNEMENT : une
       photo du bâtiment ne viendra jamais la remplacer. */
    ...visuelEvenement(e),
    majLe:e.last_synced_at || null,
  }, e.primary_source || "datatourisme");
}

async function chargerEvenementsCanoniques(lat,lng,portee = porteeCourante){
  if(!sbLecture) return null;
  const b = emprisePublications(lat, lng);
  const porteeEvenements = portee;
  /* La résolution mutualise la synchronisation par territoire. Elle ne
     déclenche aucune collecte et n'influence ni l'interface ni le classement
     de cette requête ; une zone inconnue devient seulement un candidat DB. */
  const finTerritoire = PERF.requete("supabase_territoire");
  void Promise.resolve(sbLecture.rpc("resoudre_territoire", {
    p_lat:Number(lat), p_lng:Number(lng), p_nom:communeUtile() || null
  })).then(({data, error})=>{
    if(porteeEvenements !== porteeCourante) return;
    /* La résolution servait uniquement à mutualiser la synchronisation ; on
       retient désormais son résultat, parce que c'est lui qui nomme le bassin
       dans lequel « Pour toi » a le droit de chercher. */
    if(error){
      console.error("Résolution du territoire :", error.message);
      bassinTerritorialActif = null;
      return;
    }
    bassinTerritorialActif = Array.isArray(data) ? (data[0] || null) : (data || null);
    /* LE DÉCLENCHEMENT EST ICI, ET PAS AILLEURS. La résolution du territoire
       n'est pas attendue — pour ne pas retarder Explorer — mais le bassin ne
       porte un nom qu'une fois qu'elle a répondu. Le seul appel qui existait
       partait à la fin du chargement des couches : il arrivait presque
       toujours AVANT cette réponse, trouvait `bassinTerritorialActif` à null,
       sortait aussitôt, et rien ne réessayait jamais. « Pour toi » restait
       vide en permanence. On déclenche donc au moment exact où le bassin
       devient connu. `rafraichirMetropole` est idempotente, l'autre appel
       reste sans effet quand il double celui-ci. */
    rafraichirMetropole();
  }).catch(()=>{
    if(porteeEvenements === porteeCourante) bassinTerritorialActif = null;
  }).finally(finTerritoire);
  const fini = PERF.requete("supabase_evenements");
  try{
    const { data, error } = await sbLecture.rpc("evenements_proches", {
      p_sud:Number(b.s), p_ouest:Number(b.o),
      p_nord:Number(b.n), p_est:Number(b.e), p_limite:120
    });
    if(error){
      /* Une couche indisponible ne vide pas la carte : les autres sources
         restent, et l'utilisateur voit moins plutôt que rien. */
      console.error("Lecture des événements :", error.message);
      return null;
    }
    return (data||[]).map(versEvenementCanonique).filter(Boolean);
  } finally { fini(); }
}

async function rafraichirCoucheSupabase(cle, lat, lng, precedent, portee){
  if(requetesCouchesSupabase.has(cle)) return requetesCouchesSupabase.get(cle);
  let promesse;
  promesse = (async()=>{
    if(!(await connecter())) return precedent || {
      t:0, publications:[], evenements:[], okPublications:false, okEvenements:false,
    };
    const [publications, evenements] = await Promise.all([
      chargerPublications(lat,lng), chargerEvenementsCanoniques(lat,lng,portee)
    ]);
    const okPublications = Array.isArray(publications);
    const okEvenements = Array.isArray(evenements);
    const entree = {
      t:Date.now(),
      publications:okPublications ? publications : ((precedent && precedent.publications) || []),
      evenements:okEvenements ? evenements : ((precedent && precedent.evenements) || []),
      okPublications, okEvenements,
    };
    /* Une panne ne transforme jamais une réponse valide en tableau vide. */
    if(okPublications || okEvenements){
      cacheCouchesSupabase()[cle] = entree;
      ecrireCacheCouchesSupabase(cle, entree);
      publierCoucheSupabase(cle, entree, portee, lat, lng);
    }
    /* Hors du chemin critique, et après la couche locale : le bassin ne fait
       attendre personne, et le territoire vient d'être résolu — c'est lui qui
       donne son nom au bassin. */
    rafraichirMetropole();
    return entree;
  })().finally(()=>{
    if(requetesCouchesSupabase.get(cle) === promesse) requetesCouchesSupabase.delete(cle);
  });
  requetesCouchesSupabase.set(cle, promesse);
  return promesse;
}

function chargerCoucheSupabase(lat,lng){
  const cle = cleCoucheSupabase(lat,lng);
  const portee = porteeCourante;
  const cache = cacheCouchesSupabase();
  const entree = cache[cle];
  const age = entree ? Date.now()-entree.t : Infinity;
  if(entree && age <= CACHE_COUCHE_MAX_MS){
    PERF.touche("supabase_zone", true);
    publierCoucheSupabase(cle, entree, portee, lat, lng);
    if(age > CACHE_COUCHE_FRAICHE_MS)
      void rafraichirCoucheSupabase(cle, lat, lng, entree, portee);
    return Promise.resolve(Object.assign({},entree,{depuisCache:true}));
  }
  PERF.touche("supabase_zone", false);
  return rafraichirCoucheSupabase(cle, lat, lng, null, portee);
}

const Store = {
  get dispo(){ return !!sb; },
  /* Dépose l'affiche dans le bucket « evenements », sous le dossier de son
     auteur — c'est ce chemin que la RLS du stockage vérifie. Un échec d'envoi
     ne doit jamais empêcher la publication : l'événement compte plus que
     son image. */
  async televerserImage(fichier){
    if(!sb || !fichier || !moiId) return "";
    const extension = (fichier.type.split("/")[1] || "jpg").replace("jpeg","jpg");
    const chemin = moiId+"/"+Date.now()+"."+extension;
    const { error } = await sb.storage.from("evenements")
      .upload(chemin, fichier, {cacheControl:"3600", upsert:false});
    if(error){ console.error("Image refusée :", error.message); return ""; }
    const { data } = sb.storage.from("evenements").getPublicUrl(chemin);
    return (data && data.publicUrl) || "";
  },

  async publier(l){
    const identite = await assurerIdentitePublication();
    if(!sb || !identite) return null;
    const { data, error } = await sb.from("publications").insert({
      creator_id:identite.id, created_by:identite.id,
      creator_name:identite.name, status:"active",
      cat:l.cat, titre:l.titre, adresse:l.adresse, cp:l.cp, quand:l.quand,
      gratuit:l.gratuit, prix:l.prix, places:l.places,
      lat:l.lat, lng:l.lng,
      image_url:l.image || null,
      debut_le:l.debutLe ? new Date(l.debutLe).toISOString() : null,
      fin_le:l.finLe ? new Date(l.finLe).toISOString() : null
    }).select().single();
    if(error){
      console.error("Publication refusée :", error.message);
      toast(/row-level security|violates/i.test(error.message)
        ? "Limite de publications atteinte pour aujourd’hui"
        : "Publication impossible");
      return null;
    }
    return versLieu(data);
  },
  async supprimer(dbId){
    if(!sb || !dbId || !moiId) return false;
    const { data, error } = await sb.from("publications").delete()
      .eq("id", dbId).select("id");
    if(error){ console.error("Suppression refusée :", error.message); return false; }
    return !!(data && data.length === 1);
  },

  async annuler(dbId){
    if(!sb || !dbId || !moiId) return false;
    const { data, error } = await sb.from("publications")
      .update({status:"cancelled"}).eq("id", dbId).select("id,status");
    if(error){ console.error("Annulation refusée :", error.message); return false; }
    return !!(data && data.length === 1 && data[0].status === "cancelled");
  },

  /* ---- Favoris ------------------------------------------------------------
     Un favori vise soit une publication Autour, soit un lieu externe. Dans le
     second cas on garde un instantané : sans lui, la liste serait vide dès
     qu'on l'ouvre ailleurs qu'à l'endroit où on a enregistré. */
  async favoris(){
    if(!sb) return [];
    const { data, error } = await sb.from("favoris")
      .select("id,publication_id,lieu_ref,titre,cat,adresse,lat,lng,cree_le")
      .order("cree_le",{ascending:false});
    if(error){ console.error("Favoris indisponibles :", error.message); return []; }
    return data || [];
  },

  async ajouterFavori(l){
    if(!sb || !estConnecte()) return false;
    const ligne = {
      membre: moiId,
      publication_id: l.dbId || null,
      lieu_ref: l.dbId ? null : refFavori(l),
      titre: l.titre || "Sans titre",
      cat: l.cat || null,
      adresse: l.adresse || null,
      lat: Number(l.lat), lng: Number(l.lng),
    };
    const { error } = await sb.from("favoris").insert(ligne);
    // déjà en favori : l'index unique refuse, ce n'est pas une erreur à montrer
    if(error && !/duplicate|unique/i.test(error.message)){
      console.error("Favori refusé :", error.message); return false;
    }
    return true;
  },

  async retirerFavori(l){
    if(!sb || !estConnecte()) return false;
    const requete = sb.from("favoris").delete().eq("membre", moiId);
    const { error } = l.dbId
      ? await requete.eq("publication_id", l.dbId)
      : await requete.eq("lieu_ref", refFavori(l));
    if(error){ console.error("Retrait refusé :", error.message); return false; }
    return true;
  },

  /* ---- Canaux d'événement ------------------------------------------------
     Coordination locale, pas messagerie. Il n'existe aucun canal sans
     événement, donc aucune boîte de réception pour qui n'en a pas. */

  // Les canaux où j'ai une raison d'être : créé, inscrit, ou suivi.
  async mesCanaux(){
    if(!sb || !moiId) return [];
    const { data, error } = await sb.rpc("mes_canaux");
    if(error){ console.error("Canaux indisponibles :", error.message); return []; }
    return data || [];
  },

  async canalDe(dbId){
    if(!sb || !dbId) return null;
    const { data } = await sb.from("event_channels")
      .select("id,admin,ferme").eq("publication_id", dbId).maybeSingle();
    return data || null;
  },

  async messages(channelId){
    if(!sb || !channelId) return [];
    const { data } = await sb.from("event_messages")
      .select("id,genre,changement,corps,details,cree_le")
      .eq("channel_id", channelId).order("cree_le",{ascending:false}).limit(30);
    return data || [];
  },

  /* Les messages système ne s'écrivent pas d'ici : ils naissent du
     déclencheur qui observe la modification. On ne modifie donc que
     l'événement, et l'annonce suit toute seule. */
  async modifierEvenement(dbId, champs){
    if(!sb || !dbId || !moiId) return false;
    const permis = new Set(["titre","adresse","cp","quand","gratuit","prix","places",
                            "lat","lng","image_url","debut_le","fin_le"]);
    const propres = Object.fromEntries(Object.entries(champs || {}).filter(([cle])=>permis.has(cle)));
    if(!Object.keys(propres).length) return false;
    const { data, error } = await sb.from("publications")
      .update(propres).eq("id", dbId).select("id");
    if(error){ console.error("Modification refusée :", error.message); return false; }
    return !!(data && data.length === 1);
  },

  // Annonce libre et courte, réservée à l'administrateur par la RLS.
  async annoncer(channelId, corps){
    if(!sb || !channelId) return false;
    const texte = String(corps || "").trim();
    if(!texte || texte.length > 500) return false;
    const { error } = await sb.from("event_messages")
      .insert({channel_id:channelId, auteur:moiId, genre:"annonce", corps:texte});
    if(error){ console.error("Annonce refusée :", error.message); return false; }
    return true;
  },

  async rejoindre(channelId, role){
    if(!channelId || !sb || !estConnecte()) return false;
    const { error } = await sb.from("event_participants")
      .insert({channel_id:channelId, membre:moiId, role:role || "participant"});
    // déjà inscrit : ce n'est pas une erreur pour l'utilisateur
    if(error && !/duplicate|conflict/i.test(error.message)){
      console.error("Inscription refusée :", error.message); return false;
    }
    return true;
  },

  async quitter(channelId){
    if(!sb || !channelId) return false;
    const { error } = await sb.from("event_participants")
      .delete().eq("channel_id", channelId).eq("membre", moiId);
    return !error;
  },
};

/* ================================================================== */

/* Chaque flux reste séparé jusqu'à la fusion finale : une mise à jour
   DATAtourisme ne peut ainsi jamais effacer un lieu OSM ou une publication
   Autour déjà visible. */
let permanentPlaces=[], datatourismePlaces=[], externalEvents=[], userPublications=[];
let lieux=[], publies=userPublications, marqueurs=new Map(), etiquettes=[];
let filtreActif="tout", recherche="", modePose=false;
/* Le nom de commune tant qu'on ne le connaît pas. Il s'affiche dans des
   phrases (« autour de ton quartier »), mais ne doit jamais servir d'adresse
   sur une carte de résultat : « ton quartier » sous le nom d'un bar de Lille
   ne situe rien et se lit comme une erreur. */
const COMMUNE_INCONNUE = "ton quartier";
let coucheVille, moi, positionMoi=null, commune=COMMUNE_INCONNUE;

/* null = pas encore calculé · tableau = on n'affiche que ceux-là ·
   false = tu as demandé à tout voir, on ne revient plus en arrière tout seul */
let selectionAccueil = null;

/* Ce qu'on vient de publier reste à l'écran, quoi qu'en dise le classement.
   Un événement de demain soir n'a rien à faire dans « Pour toi, maintenant » —
   c'est la bonne règle, et elle avait pour conséquence que l'événement qu'on
   venait de créer disparaissait à la seconde où on appuyait sur « Publier ».
   On l'épingle donc dix minutes : le temps de vérifier que c'est bien ce qu'on
   voulait, et de le partager. Passé ce délai, il rentre dans le rang. */
const EPINGLE_MS = 10*60*1000;
const publicationsEpinglees = new Map();     // id → instant de publication

function epinglerPublication(id){ publicationsEpinglees.set(id, Date.now()); }
function idsEpingles(){
  const t = Date.now();
  publicationsEpinglees.forEach((quand,id)=>{
    if(t - quand > EPINGLE_MS) publicationsEpinglees.delete(id);
  });
  return [...publicationsEpinglees.keys()];
}
let routes=[]; // {couche, base}
let ligneCouches = []; // segments dessinés sur la carte pour l'itinéraire sélectionné
/* La vue que l'on regardait avant qu'un itinéraire ne recadre la carte.
   Mémorisée au premier tracé seulement : les tracés suivants (passer de
   « à pied » à « vélo ») ne doivent pas écraser le point de retour par un
   cadrage d'itinéraire. */
let vueAvantTrajet = null;
let modeNav = false;   // itinéraire plein écran : la carte n'affiche que le trajet

const $=(s)=>document.querySelector(s);
/* Déclaré ici, et pas à côté de mesurerHeader : cette fonction est appelée dès
   le premier rendu, donc bien avant le bas du script. */
const NAV_FLOTTANTE = matchMedia("(min-width:1100px)");
const hash=(s)=>{let h=0;for(let i=0;i<s.length;i++)h=(h<<5)-h+s.charCodeAt(i);return Math.abs(h)};
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const esc=(s)=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function alea(seed){let h=hash(String(seed))||1;return()=>{h=(h*1103515245+12345)&0x7fffffff;return (h>>8)%10000/10000;}}
function toast(t){const el=$("#toast");el.textContent=t;el.hidden=false;clearTimeout(el._t);el._t=setTimeout(()=>el.hidden=true,2400)}
/* Les messages d'état s'écrivaient dans l'écran d'accueil, qui ne s'affiche
   plus depuis que la carte démarre seule : ils étaient donc invisibles. */
function etat(t, montrer){
  const b = $("#bandeauGeo"), z = $("#bandeauTxt");
  if(!b || !z) return;
  z.textContent = t;
  if(montrer !== undefined) b.hidden = !montrer;
}
/* Un écran vide a besoin qu'on lui dise ce qu'on cherche. Un écran déjà rempli
   n'a besoin que de savoir que ça bouge : « Recherche des événements autour de
   ce point… » en gros au-dessus de propositions parfaitement lisibles donne
   l'impression que l'application recommence à zéro alors qu'elle complète. */
function ecranDejaRempli(){
  return Array.isArray(selectionAccueil) && selectionAccueil.length > 0;
}
function charge(t){
  const c=$("#charge");
  if(!t){ c.classList.remove("discret"); c.hidden=true; return; }
  if(ecranDejaRempli()){ majSignalMaj(true); return; }
  c.classList.remove("discret"); c.textContent=t; c.hidden=false;
}
/* Mise à jour silencieuse : l'écran garde ce qu'il montre, une pastille dit
   simplement que ça bouge derrière. */
function majSignalMaj(actif){
  const c=$("#charge");
  if(!c) return;
  if(actif){ c.classList.add("discret"); c.textContent="Mise à jour…"; c.hidden=false; }
  else { c.classList.remove("discret"); c.hidden=true; }
}

const SEARCH_STATES = Object.freeze({
  IDLE:"idle",
  REQUESTING_LOCATION:"requestingLocation",
  LOADING_PLACES:"loadingPlaces",
  LOADING_EVENTS:"loadingEvents",
  SUCCESS:"success",
  EMPTY:"empty",
  PARTIAL_ERROR:"partialError",
  LOCATION_DENIED:"locationDenied",
  NETWORK_ERROR:"networkError",
  OVERPASS_UNAVAILABLE:"overpassUnavailable",
});
const rechercheEtat = {
  location:SEARCH_STATES.IDLE,
  places:SEARCH_STATES.IDLE,
  events:SEARCH_STATES.IDLE,
  overpass:SEARCH_STATES.IDLE,
};
function definirEtatRecherche(canal,etat){
  rechercheEtat[canal] = etat;
  if(feuilleNiveau !== null) planifierRendu({feuille:true});
  // Un changement d'état ne doit pas reconstruire tous les marqueurs : les
  // chargements peuvent notifier plusieurs sources à la suite et bloqueraient
  // alors le thread principal. Seul le bandeau d'état dépend de cette valeur.
  if(map) majBandeauVide(selectionner().length);
}
/* Plusieurs canaux asynchrones peuvent enrichir les mêmes lieux, mais un seul
   contexte possède l'indicateur visuel d'une ressource. Sans cet identifiant,
   une ancienne recherche Aide pouvait remettre « vide » après qu'une nouvelle
   zone avait déjà publié ses résultats. */
const proprietairesEtatRecherche = new Map();
function prendreEtatRecherche(canal,generation){
  if(generation) proprietairesEtatRecherche.set(canal,generation.id);
}
function definirEtatRechercheVersionne(canal,etat,generation){
  if(!generation || proprietairesEtatRecherche.get(canal) !== generation.id) return false;
  definirEtatRecherche(canal,etat);
  return true;
}
function rechercheEnCours(){
  return rechercheEtat.location === SEARCH_STATES.REQUESTING_LOCATION ||
    rechercheEtat.places === SEARCH_STATES.LOADING_PLACES ||
    rechercheEtat.events === SEARCH_STATES.LOADING_EVENTS;
}
function etatErreurPartielle(){
  return rechercheEtat.overpass === SEARCH_STATES.OVERPASS_UNAVAILABLE ||
    rechercheEtat.places === SEARCH_STATES.PARTIAL_ERROR ||
    rechercheEtat.events === SEARCH_STATES.PARTIAL_ERROR;
}

/* ================================================================== */
/*  Overpass                                                          */
/* ================================================================== */

/* Uniquement des instances qui portent la planète entière. `overpass.osm.ch`
   figurait ici : c'est l'instance SUISSE, elle ne contient que la Suisse. Elle
   répondait « zéro objet » en huit dixièmes de seconde à toute requête
   française, et le tour de repli s'arrêtait là — une réponse valide, rapide, et
   complètement fausse. Constaté en produisant les jeux de zone de Lille. */
const SERVEURS = [
  "https://overpass.kumi.systems/api/interpreter",   // le plus rapide et le moins saturé
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

/* Notre propre origine d'abord. `/api/lieux` est un relais mis en cache par le
   CDN : la première personne d'un quartier paie l'attente d'Overpass une fois,
   côté serveur, et tous les suivants reçoivent la réponse en un aller-retour.
   C'est la seule façon de ne pas faire dépendre le démarrage d'une instance
   publique dont on ne maîtrise ni la charge ni la disponibilité.

   Si la route n'existe pas — développement local ou hébergement statique sans
   fonctions — les sources indépendantes restent disponibles. Rejouer la même
   panne directement depuis chaque téléphone ne constitue pas un repli. */
let relaisLieux = null;              // null = pas encore su, false = absent
let overpassEchecsConsecutifs = 0;
async function overpassRelaye(q, msMax, signal){
  if(relaisLieux === false) return {ok:false, elements:[], raison:"relais_absent"};
  try{
    const stop = new AbortController();
    const t = setTimeout(()=>stop.abort(), msMax || OVERPASS_DELAI_DEMANDE);
    if(signal) signal.addEventListener("abort", ()=>stop.abort(), {once:true});
    PERF.requete("overpass");
    const r = await fetch("/api/lieux?q="+encodeURIComponent(q), {signal:stop.signal});
    clearTimeout(t);
    // 404 : pas de fonction déployée ici. On note et on n'y revient plus.
    if(r.status === 404 || r.status === 405){
      relaisLieux = false;
      return {ok:false, elements:[], raison:"relais_absent"};
    }
    if(!r.ok) return {ok:false, elements:[], raison:"http_"+r.status};
    const j = await r.json();
    relaisLieux = true;
    PERF.jalon("relais_lieux");
    return j && Array.isArray(j.elements)
      ? {ok:true, elements:j.elements, raison:"relais"}
      : {ok:false, elements:[], raison:"reponse_invalide"};
  }catch(e){
    return {ok:false, elements:[], raison:signal && signal.aborted ? "annule" : "delai"};
  }
}

async function overpass(q, msMax, signal, viaRelais){
  const debut = Date.now();
  const budget = msMax || 14000;
  const simule = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) &&
    new URLSearchParams(location.search).get("simulateOverpassFailure") === "1";
  if(simule){
    journal.warn("Overpass : panne simulée pour le test local");
    return {ok:false, elements:[], raison:"simulee"};
  }
  /* Seules les requêtes de LIEUX passent par le relais. Le décor de la ville
     (routes, parcs, plans d'eau) a une autre forme, que le relais refuse à
     juste titre — l'y envoyer ne produisait que des 400 avant le repli. */
  if(viaRelais){
    /* Le relais et le client interrogeaient exactement les mêmes instances
       publiques. Après sept secondes perdues au relais, le prétendu fallback
       recommençait la même panne avec un budget déjà épuisé. Le vrai repli est
       désormais constitué des jeux de zone, de Google, de DATAtourisme et des
       publications Supabase ; aucune deuxième vague Overpass ne part d'ici. */
    return overpassRelaye(q, msMax, signal);
  }
  for(let i=0;i<SERVEURS.length;i++){
    const url = SERVEURS[i];
    if(signal && signal.aborted) return {ok:false, elements:[], raison:"annule"};
    // `msMax` est un budget TOTAL. L'ancien code l'accordait à chaque serveur :
    // une demande de 7 s pouvait donc rester en vol près d'une demi-minute.
    const restant = budget - (Date.now()-debut);
    if(restant < 600) break;
    const serveursRestants = SERVEURS.length-i;
    const delaiTentative = Math.max(500, Math.floor(restant/serveursRestants));
    try{
      const stop = new AbortController();
      const t = setTimeout(()=>stop.abort(), delaiTentative);
      // une nouvelle zone demandée annule vraiment la précédente : avant, la
      // requête partait quand même et seul son résultat était jeté
      if(signal) signal.addEventListener("abort", ()=>stop.abort(), {once:true});
      const r = await fetch(url,{method:"POST", signal:stop.signal,
        body:"data="+encodeURIComponent(q),
        headers:{"Content-Type":"application/x-www-form-urlencoded"}});
      clearTimeout(t);
      if(!r.ok){ journal.warn("Overpass", r.status, url); continue; }
      const j = await r.json();
      if(j && Array.isArray(j.elements)) return {ok:true, elements:j.elements, raison:"direct"};
    }catch(e){ journal.warn("Overpass injoignable :", url, e.name||e); }
  }
  // Overpass est un enrichissement opportuniste : ses relais publics peuvent
  // être saturés. L'absence de réponse déclenche le repli déjà affiché, ce
  // n'est donc pas une erreur applicative à envoyer dans la console visiteur.
  journal.warn("Overpass : aucun serveur n’a répondu");
  return {ok:false, elements:[], raison:"indisponible"};
}

/* ---------- géométrie de la ville ---------- */
async function geometrieVille(lat,lng){
  // requête légère : les serveurs publics refusent les grosses demandes
  const q1 = `[out:json][timeout:20];
(
way(around:800,${lat},${lng})[highway~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)$"];
way(around:800,${lat},${lng})[leisure~"^(park|garden|pitch)$"];
way(around:800,${lat},${lng})[landuse~"^(grass|forest|cemetery)$"];
way(around:800,${lat},${lng})[natural=water];
);
out geom;`;
  let resultat = await overpass(q1, 14000);
  let els = resultat.ok ? resultat.elements : null;
  if(els && els.length) return els;

  // seconde chance, encore plus petit
  const q2 = `[out:json][timeout:15];
way(around:450,${lat},${lng})[highway~"^(primary|secondary|tertiary|residential|pedestrian)$"];
out geom;`;
  resultat = await overpass(q2, 10000);
  return resultat.ok ? resultat.elements : null;
}

/* ---------- lieux remarquables ---------- */
/* Ce qu'on demande à l'ouverture : de quoi manger, sortir et se repérer.
   Les écoles, les administrations, les toilettes et les bornes de recharge
   ne sont jamais proposées d'office — les demander au démarrage allongeait
   la requête sans rien afficher de plus. Elles arrivent quand on ouvre le
   besoin correspondant. */
const CATS_DEPART = new Set(["resto","fastfood","cafe","marche","bar","cinema",
  "spectacle","concert","friperie","commerce","biblio","musee","parc"]);

/* Combien de temps on accepte d'attendre OpenStreetMap.
   Au démarrage : sept secondes, et l'écran vit déjà sans lui.
   Sur demande explicite : vingt-cinq, parce que la personne attend un
   résultat précis et qu'un écran vide serait une réponse fausse. */
const OVERPASS_DELAI_BOOT = 4500;
/* 6 s, pas 12. Douze secondes se défendaient sur le papier — « quand la
   personne a demandé quelque chose de précis, mieux vaut attendre que revenir
   les mains vides » — mais le raisonnement supposait qu'attendre ne coûte
   rien. Il coûte la seule chose qu'on ne peut pas rendre : la confiance qu'il
   se passe quelque chose. Au-delà de cinq ou six secondes sans retour, on ne
   patiente plus, on se demande si c'est cassé.
   Et l'arbitrage n'est plus « attendre ou rien » : ce qui est déjà à l'écran
   y reste pendant l'actualisation, la zone n'est pas marquée comme vue en cas
   d'échec, et le prochain déplacement de carte relance la requête. Couper à
   6 s ne perd donc que la requête, jamais les résultats. */
const OVERPASS_DELAI_DEMANDE = 6000;
/* Ce qu'on demande à l'ouverture : le quartier immédiat, et de quoi remplir
   cinq recommandations avec de la marge. Le reste vient au premier geste. */
const RAYON_BOOT = 900;
const PLAFOND_BOOT = 90;

/* LE VRAI NOM D'ABORD, LE LIBELLÉ DE CATÉGORIE EN DERNIER RECOURS.

   Une carte intitulée « Parcs » n'apprend rien : c'est le nom du filtre, pas
   celui du lieu. Or la source porte très souvent le nom réel ailleurs que dans
   `name` — sous sa forme officielle, sous l'enseigne, sous le nom du bâtiment,
   ou en français quand l'objet est multilingue.

   On épuise donc ces relevés AVANT de retomber sur la catégorie. Aucun n'est
   inventé : chacun est écrit tel quel dans la donnée d'origine, et chacun est
   un nom que les gens emploient pour désigner l'endroit. `operator` en est
   volontairement absent — « Ville de … » exploite un parc, ce n'est pas son
   nom, et l'afficher comme tel serait inventer.

   Ce qui n'a réellement aucun nom exploitable garde le libellé de catégorie et
   le drapeau `sansNom` — c'est ce drapeau qui autorise ensuite la
   déduplication à regrouper ce qui, à l'écran, est indistinguable. */
const CLES_NOM_OSM = ["name", "name:fr", "official_name", "official_name:fr",
  "alt_name", "short_name", "loc_name", "brand", "addr:housename"];

function nomReelOsm(tags){
  const t = tags || {};
  for(const cle of CLES_NOM_OSM){
    const valeur = t[cle];
    if(typeof valeur === "string" && valeur.trim().length >= 2) return valeur.trim();
  }
  return "";
}

async function vraisLieux(lat,lng,bornes,opts){
  const o = opts || {};
  // Une sous-requête par CLÉ (avec regex sur les valeurs) au lieu d'une par
  // couple clé/valeur : ~5 lignes au lieu de 40. Les serveurs publics saturaient
  // sur l'ancienne version, d'où les "lieux d'exemple" affichés à la place.
  const garder = o.cats ? new Set(o.cats) : (o.tout ? null : CATS_DEPART);
  const parCle = {};
  REQUETES.forEach(([k,v,cat])=>{
    if(garder && !garder.has(cat)) return;
    (parCle[k] = parCle[k] || []).push(v);
  });
  // les tags vagues appartiennent à plusieurs familles : on les demande dès
  // que l'une d'elles est cherchée, sans quoi « foyer » ne les voyait jamais
  TAGS_PARTAGES.forEach(([k,v,cats])=>{
    if(garder && !cats.some(c=>garder.has(c))) return;
    const liste = (parCle[k] = parCle[k] || []);
    if(!liste.includes(v)) liste.push(v);
  });
  if(!Object.keys(parCle).length) return [];
  // On interroge la zone effectivement affichée plutôt qu'un rayon fixe :
  // en vue serrée on ramène beaucoup moins, en vue large on couvre vraiment
  // ce que la personne regarde. Bornée pour ne pas demander une ville entière.
  /* Au démarrage on ne demande que le pâté de maisons, et pas trois cents
     objets. Ce n'est pas de l'économie de réseau : c'est ce qui suit derrière —
     normaliser, dédupliquer, regrouper et classer trois cents lieux coûte plus
     d'une seconde de fil principal sur un téléphone, avant qu'une seule carte
     n'apparaisse. Or on n'en montre que cinq. Le reste du quartier arrive au
     premier déplacement de carte, quand il y a quelqu'un pour le regarder. */
  const rayon = o.rayon || 1500;
  const plafond = o.limite || 300;
  const zone = bornes ? `(${bornes.s},${bornes.o},${bornes.n},${bornes.e})`
                      : `(around:${rayon},${lat},${lng})`;
  /* Pour Aide, l'élargissement reste dans l'aire administrative française
     d'Overpass. Cela évite qu'un rayon autour de Tourcoing bascule vers
     Mouscron sans que la personne l'ait demandé. */
  const zonePays = o.pays === "FR"
    ? (bornes
      ? `${zone}(area.fr)`
      : `(around:${rayon},${lat},${lng})(area.fr)`)
    : zone;
  const prefixePays = o.pays === "FR" ? 'area["ISO3166-1"="FR"]->.fr;' : "";
  const bloc = Object.entries(parCle).map(([k,vs])=>
    `nwr${zonePays}["${k}"~"^(${vs.join("|")})$"];`).join("");
  /* Le délai n'est pas le même selon le moment. Au démarrage, Overpass ne doit
     jamais être ce qu'on attend : le cache et le jeu rapide portent déjà
     l'écran, et une requête qui traîne vingt secondes ne fait que garder une
     pastille « mise à jour » allumée pour rien. On coupe court et on
     réessaiera au prochain déplacement de carte.
     Quand c'est la personne qui a demandé quelque chose de précis, en
     revanche, mieux vaut attendre que revenir les mains vides. */
  const delai = o.delai || OVERPASS_DELAI_DEMANDE;
  const resultat = await overpass(
    `[out:json][timeout:${Math.round(delai/1000)}];${prefixePays}(${bloc});out center ${plafond};`,
    delai, o.signal, true);
  if(!resultat.ok) return {ok:false, lieux:[], raison:resultat.raison};
  const lieuxOsm = resultat.elements.map(e=>{
    const t=e.tags||{}, p=e.center||e;
    if(!p.lat||!p.lon) return null;
    const regle = REQUETES.find(([k,v])=>t[k]===v);
    if(!regle) return null;
    const nom = nomReelOsm(t);
    /* Le mode réel d'abord — un objet ferroviaire n'est jamais une station de
       vélo —, puis les affinages de nom pour les familles qui en ont besoin. */
    const cat = affinerCategorie(categorieTransport(regle[2], nom, t), nom, t);
    const brut = {
      id:"osm"+e.type+e.id, cat,
      titre: nom || CATS[cat].label,
      description:t.description || t.note || "", tags:t,
      type:t.amenity || t.leisure || t.tourism || t.office || "",
      sansNom: !nom,                         // « un résultat sans nom exploitable »
      adresse: [t["addr:housenumber"],t["addr:street"]].filter(Boolean).join(" ") || nom,
      cp: [t["addr:postcode"],t["addr:city"]].filter(Boolean).join(" ") || commune,
      quand: t.opening_hours || "Voir sur place",
      cuisine: t.cuisine || "",              // turkish, african, pizza…
      tel: t.phone || t["contact:phone"] || "",
      url: t.website || t["contact:website"] || "",
      pmr: t.wheelchair === "yes" ? true : (t.wheelchair === "no" ? false : undefined),
      service: preciserService(nom),         // Mission locale ≠ France Travail
      solidaire: estSolidaire(nom, regle[1]==="charity" || /^(social_facility|social_centre)$/.test(regle[1])
                              || regle[0] === "social_facility"),
      // L'absence de `fee` ne signifie rien. Seul `fee=no` autorise Autour à
      // écrire « Gratuit » ; `fee=yes` atteste au contraire que c'est payant.
      gratuit: t.fee==="no" ? true : (t.fee==="yes" ? false : undefined),
      prix: t.fee==="no" ? 0 : (t.fee==="yes" ? 6 : null),
      places:null, qr:false, par:"OpenStreetMap", lat:p.lat, lng:p.lon,
      idOsm:e.type+e.id
    };
    const fournisseur = window.AutourProviders && AutourProviders.osm;
    const normalise = fournisseur ? fournisseur.normaliser(brut) : null;
    return normaliserItem(normalise ? Object.assign({},brut,AutourProviders.versInterne(normalise)) : brut, "openstreetmap");
  }).filter(Boolean);
  return {ok:true, lieux:lieuxOsm, raison:resultat.raison};
}

/* DATAtourisme passe exclusivement par notre fonction Vercel : la clé n'est
   ni dans cette page, ni dans une URL, ni dans un repli navigateur. La route
   arrondit déjà ses coordonnées côté serveur ; le client les arrondit aussi
   pour que quelques mètres de déplacement réemploient la même entrée CDN.

   CETTE ROUTE NE SERT PLUS QU'AUX LIEUX PERMANENTS.

   Elle rendait aussi les événements du catalogue. Ils arrivent désormais par
   la couche canonique (`evenements_proches`), déjà normalisés, datés et
   dédupliqués côté serveur. Les garder ici produirait deux fois le même
   événement — une fois avec un statut temporel calculé en base, une fois avec
   un statut deviné dans le navigateur — et c'est précisément la divergence
   qu'on cherche à supprimer.

   Le filtre est posé ici plutôt que dans `/api/datatourisme` : la route reste
   un miroir fidèle du catalogue, et c'est l'application qui décide de ce
   qu'elle en prend. Les musées, parcs et monuments continuent d'arriver
   normalement — ils répondent à « qu'est-ce qu'il y a autour de moi ? », pas à
   « qu'est-ce qui se passe maintenant ? ». */
/* ---- Découvertes ancrées (Gemini + recherche Google) ---------------------

   La dernière source, et la plus tardive de toutes. Elle répond à une question
   qu'aucun catalogue géographique ne sait traiter : « qu'est-ce qui se passe
   ici cette semaine ? ». Un modèle ancré sur la recherche va lire les pages
   municipales et les agendas locaux ; la route `/api/decouvertes` vérifie que
   chaque proposition cite bien une source et jette le reste.

   TROIS PROPRIÉTÉS QUI LA RENDENT INOFFENSIVE :

   · elle part APRÈS tout le reste et n'est jamais attendue — l'écran est déjà
     complet quand elle répond, et son silence ne se remarque pas ;
   · ses items n'ont pas de position. On ne pose donc RIEN sur la carte à
     partir d'elle seule : seules les découvertes qu'on arrive à rapprocher
     d'un lieu déjà connu — par leur nom normalisé, avec les mêmes outils que
     la déduplication — reçoivent des coordonnées et deviennent visibles ;
   · elle passe par `fusionner`, donc par la déduplication : une découverte qui
     décrit un événement déjà connu d'une autre source ne crée pas un doublon.

   Si la clé n'est pas configurée, la route répond une liste vide en succès et
   il ne se passe simplement rien. */
let relaisDecouvertes = null;
async function decouvertesAncrees(lat,lng,signal){
  if(relaisDecouvertes === false) return [];
  const fournisseur = window.AutourProviders && AutourProviders.decouvertes;
  if(!fournisseur) return [];
  try{
    PERF.requete("decouvertes");
    const reponse = await fournisseur.autour(lat,lng,{
      signal, angle:angleDecouvertes(), ville:communeUtile(),
    });
    // source absente (aucune clé) : on cesse d'appeler pour cette session
    if(!reponse.actif){ relaisDecouvertes = false; return []; }
    relaisDecouvertes = true;
    if(!reponse.items.length) return [];
    const {ancrees} = fournisseur.repartir(reponse.items, lieux);
    /* Seules celles qu'on sait situer entrent dans `lieux`. Les autres sont
       vraies mais non plaçables : les afficher sur une carte supposerait de
       leur inventer un point, ce qu'on ne fait jamais. */
    return ancrees.map(d=>normaliserItem(d, "gemini"));
  }catch(e){ return []; }
}

/* L'angle suit le créneau regardé : « Maintenant » cherche ce qui a lieu, les
   autres cherchent ce qui vient. Aucun texte de l'utilisateur ne part au
   modèle — la route n'accepte qu'un mot d'une liste fermée. */
function angleDecouvertes(){
  if(modeAide) return "decouvrir";
  if(catsActives && [...catsActives].some(c=>["resto","fastfood","cafe","bar"].includes(c)))
    return "manger";
  return creneau === "maintenant" ? "sortir" : "sortir";
}

/* Le nom de commune, uniquement s'il est réellement su. Une ville devinée
   enverrait le modèle chercher au mauvais endroit. */
function communeUtile(){
  if(zoneActive && CTX && zoneActive.type === CTX.TYPES.RECHERCHE && zoneActive.nom)
    return zoneActive.nom;
  return villeDetectee && commune && commune !== "ton quartier" ? commune : "";
}

let relaisDatatourisme = null;
async function lieuxDatatourisme(lat,lng,signal){
  if(relaisDatatourisme === false) return [];
  try{
    const fournisseur = window.AutourProviders && AutourProviders.datatourisme;
    if(!fournisseur) return [];
    PERF.requete("datatourisme");
    const places = await fournisseur.nearby(lat,lng,{signal});
    relaisDatatourisme = true;
    return places.map(p=>AutourProviders.versInterne(p))
      .filter(l=>l && !estTemporaire(l));
  }catch(e){ return []; }
}

/* Les événements institutionnels OpenAgenda arrivent désormais par la
   synchronisation serveur et la couche canonique Supabase. Cette fonction
   reste un repli inerte pour préserver le flux de chargement existant pendant
   la phase de test : le navigateur ne construit plus d'URL OpenAgenda, ne
   porte plus de clé fournisseur et ne décide plus du temps. */
async function evenementsOpenAgenda(){
  return null;
}

let dernierNom = [0,0];         // là où le nom de commune a été demandé

/* Nominatim, comme Overpass, passe par notre propre origine quand elle existe :
   sa politique d'usage plafonne à une requête par seconde et interdit le
   trafic massif depuis des clients, alors que le nom d'une commune ne change
   pas — c'est exactement ce qu'un cache doit absorber. Le repli direct reste
   en place pour le développement local et les hébergements sans fonctions. */
let relaisCommune = null;            // null = pas encore su, false = absent
const communesEnVol = new Map();     // une seule requête par quartier à la fois
async function communeRelayee(lat,lng){
  if(relaisCommune === false) return undefined;
  /* `nomCommune`, `detecterVille` et le rechargement de zone demandaient la
     même commune en même temps : trois requêtes parties avant que la première
     ne réponde, donc trois passages complets par Nominatim. On partage la
     promesse — le CDN ne peut pas dédoublonner ce qui part simultanément. */
  const cle = lat.toFixed(2)+","+lng.toFixed(2);
  if(communesEnVol.has(cle)) return communesEnVol.get(cle);
  const promesse = (async ()=>{
  try{
    PERF.requete("commune");
    const r = await fetch("/api/commune?lat="+lat+"&lng="+lng);
    if(r.status === 404 || r.status === 405){ relaisCommune = false; return undefined; }
    if(!r.ok) return null;
    const j = await r.json();
    relaisCommune = true;
    PERF.jalon("nominatim_done");
    return (j && j.commune) || null;
  }catch(e){ return undefined; }
  })();
  communesEnVol.set(cle, promesse);
  promesse.finally(()=>communesEnVol.delete(cle));
  return promesse;
}

async function nomCommune(lat,lng){
  const parRelais = await communeRelayee(lat,lng);
  if(parRelais !== undefined) return parRelais || "ton quartier";
  try{
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=12`);
    const j = await r.json(); const a=j.address||{};
    PERF.jalon("nominatim_done");
    return a.city||a.town||a.village||a.municipality||a.suburb||"ton quartier";
  }catch(e){ return "ton quartier"; }
}

/* ================================================================== */
/*  Dessin de la ville                                                */
/* ================================================================== */

const LARGEURS = {
  motorway:8, trunk:7, primary:6.5, secondary:5.5, tertiary:4.5,
  unclassified:3.4, residential:3.4, living_street:3, service:2,
  pedestrian:2.6, footway:1.2, path:1.2, cycleway:1.4, steps:1.2, track:1.4
};
const NOMMEES = new Set(["motorway","trunk","primary","secondary","tertiary","residential","pedestrian"]);

function dessinerVille(elements){
  const rendu = L.canvas({padding:.6});
  const surfaces=[], eaux=[], batis=[], voiesFond=[], voies=[];

  elements.forEach(e=>{
    if(!e.geometry || e.geometry.length<2) return;
    const pts = e.geometry.map(p=>[p.lat,p.lon]);
    const t = e.tags||{};

    if(t.building){ batis.push(pts); return; }
    if(t.natural==="water" || t.waterway){
      if(t.waterway && t.natural!=="water"){
        voies.push({pts,couleur:"var(--eau)",poids:4,type:"eau"});
      } else eaux.push(pts);
      return;
    }
    if(t.leisure || t.landuse){ surfaces.push({pts, vif: t.leisure==="pitch"}); return; }
    if(t.highway){
      const l = LARGEURS[t.highway];
      if(!l) return;
      const pieton = ["footway","path","steps","cycleway","track"].includes(t.highway);
      const vite = ["motorway","trunk","primary"].includes(t.highway);
      voiesFond.push({pts, poids:l+2.4, pieton, vite});
      voies.push({pts, poids:l, pieton, vite, nom:(NOMMEES.has(t.highway)?t.name:null)});
    }
  });

  const style = (o)=>Object.assign({renderer:rendu, interactive:false}, o);

  surfaces.forEach(s=>L.polygon(s.pts, style({stroke:false,
    fillColor:s.vif?"#CBDFC2":"var(--vert)", fillOpacity:1, pane:"villePane"})).addTo(coucheVille));
  eaux.forEach(p=>L.polygon(p, style({stroke:false, fillColor:"var(--eau)", fillOpacity:1, pane:"villePane"})).addTo(coucheVille));
  batis.forEach(p=>L.polygon(p, style({stroke:false, fillColor:"var(--bati)", fillOpacity:1, pane:"villePane"})).addTo(coucheVille));

  voiesFond.forEach(v=>{
    const c = L.polyline(v.pts, style({color: v.vite?"var(--vite-bord)":"var(--liseré)",
      weight:v.poids, opacity:v.pieton?0:1,
      lineJoin:"round", lineCap:"round", pane:"villePane"})).addTo(coucheVille);
    routes.push({couche:c, base:v.poids});
  });
  voies.forEach(v=>{
    const c = L.polyline(v.pts, style({
      color: v.type==="eau" ? "var(--eau)" : (v.vite ? "var(--vite)" : "var(--voie)"),
      weight: v.poids, lineJoin:"round", lineCap:"round",
      dashArray: v.pieton ? "3 4" : null,
      pane:"villePane"
    })).addTo(coucheVille);
    routes.push({couche:c, base:v.poids});

    if(v.nom && v.pts.length>2){
      const m = v.pts[Math.floor(v.pts.length/2)];
      etiquettes.push(L.marker(m,{
        icon:L.divIcon({className:"rue", html:'<span class="rue-in">'+esc(v.nom)+'</span>', iconSize:[0,0]}),
        interactive:false, keyboard:false, pane:"ruesPane"
      }));
    }
  });

  majEpaisseurs();
  majEtiquettes();
}

/* Fond approximatif : trame urbaine générée, quand OSM ne répond pas.
   Ce n'est pas ton vrai quartier — c'est un décor, pour ne pas laisser un écran vide. */
function grilleSecours(lat,lng){
  const rendu = L.canvas({padding:.6});
  const rnd = alea(lat.toFixed(3)+lng.toFixed(3));
  const angle = (rnd()-.5)*0.7;                 // la trame n'est jamais parfaitement N/S
  const pasX = 0.0016, pasY = 0.0011;
  const N = 9;
  const style = (o)=>Object.assign({renderer:rendu, interactive:false, pane:"villePane"}, o);

  // repère tourné
  const P = (i,j)=>{
    const x = i*pasX, y = j*pasY;
    return [ lat + (x*Math.sin(angle) + y*Math.cos(angle)),
             lng + (x*Math.cos(angle) - y*Math.sin(angle)) ];
  };

  // îlots
  for(let i=-N;i<N;i++) for(let j=-N;j<N;j++){
    if(rnd()<0.14) continue;
    const m = 0.16;
    const coins = [P(i+m,j+m), P(i+1-m,j+m), P(i+1-m,j+1-m), P(i+m,j+1-m)];
    L.polygon(coins, style({stroke:false, fillColor:"var(--bati)", fillOpacity:1})).addTo(coucheVille);
  }

  // deux espaces verts et un plan d'eau
  const vert1 = [P(-4,1),P(-1.6,1),P(-1.6,3.2),P(-4,3.2)];
  const vert2 = [P(2.2,-4),P(4.6,-4),P(4.6,-2),P(2.2,-2)];
  [vert1,vert2].forEach(v=>L.polygon(v, style({stroke:false,fillColor:"var(--vert)",fillOpacity:1})).addTo(coucheVille));
  L.polygon([P(-N,-2.4),P(N,-1.9),P(N,-1.3),P(-N,-1.8)],
    style({stroke:false,fillColor:"var(--eau)",fillOpacity:1})).addTo(coucheVille);

  // voies
  const trace = (pts, poids, vite)=>{
    const fond = L.polyline(pts, style({color: vite?"var(--vite-bord)":"var(--liseré)",
      weight:poids+2.4, lineJoin:"round", lineCap:"round"})).addTo(coucheVille);
    const dessus = L.polyline(pts, style({color: vite?"var(--vite)":"var(--voie)",
      weight:poids, lineJoin:"round", lineCap:"round"})).addTo(coucheVille);
    routes.push({couche:fond, base:poids+2.4});
    routes.push({couche:dessus, base:poids});
  };
  for(let i=-N;i<=N;i++){
    const grand = i%3===0;
    trace([P(i,-N),P(i,N)], grand?5.5:3.2, i===0);
  }
  for(let j=-N;j<=N;j++){
    const grand = j%3===0;
    trace([P(-N,j),P(N,j)], grand?5.5:3.2, false);
  }

  majEpaisseurs();
}

/* ================================================================== */
/*  Fond de carte : on essaie les vraies tuiles, on dessine sinon     */
/* ================================================================== */

/* L'ORDRE EST LE STYLE : le premier qui répond gagne la course.

   Voyager était en tête. C'est le style COLORÉ de CARTO — voies orangées,
   zones vertes et beiges soutenues, POI teintés. Il est joli et il est
   exactement ce qu'on ne veut pas : le fond y a autant de présence visuelle
   que les marqueurs d'Autour, qui s'y noient.

   Positron passe donc devant : gris-beige, très désaturé, conçu pour porter
   une couche de données par-dessus. C'est le rôle qu'on lui demande. Voyager
   reste en second, et OpenStreetMap en dernier — le plus chargé des trois,
   gardé uniquement parce qu'il est le repli qui ne tombe jamais.

   Ne pas remonter Voyager pour « faire plus vivant ». La lisibilité des
   éléments d'Autour prime sur la densité d'information du fond. */
const FONDS = [
  { nom:"CARTO Positron",
    url:"https://basemaps.cartocdn.com/rastertiles/positron/{z}/{x}/{y}{r}.png",
    opts:{subdomains:"abcd", maxZoom:20, crossOrigin:true,
      attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © CARTO'} },
  { nom:"CARTO Voyager",
    url:"https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    opts:{subdomains:"abcd", maxZoom:20, crossOrigin:true,
      attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>'} },
  { nom:"OpenStreetMap",
    url:"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    opts:{maxZoom:19, crossOrigin:true,
      attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'} }
];

/* Google Maps devient le fond principal dès que Places est disponible. Leaflet
   garde, pendant la migration, son calque de marqueurs et son moteur de
   collisions ; il ne fournit alors ni tuiles ni données Google. En cas
   d'échec du SDK (clé non autorisée, réseau hors ligne), CARTO/OSM restent un
   repli autonome et le provider Places ne renvoie rien. */
let promesseCarteGoogle = null;
let fondAutonomePose = false;
function attributionFondAutonome(){
  const attribution = document.querySelector("#attribution span");
  if(attribution) attribution.innerHTML = '© <a href="https://www.openstreetmap.org/copyright">OSM</a> · <a href="https://carto.com/attributions">CARTO</a>';
  const credits = document.getElementById("credits");
  if(credits) credits.textContent = "© OSM · CARTO";
}
function remettreFondAutonome(){
  if(!map || fondAutonomePose) return Promise.resolve(null);
  // Le repli suit toujours la zone déjà affichée. On ne fabrique jamais une
  // ville par défaut : sans position connue, la carte Leaflet a déjà un
  // centre, qui est le seul repère honnête à conserver.
  const centre = centreZoneActive() || [map.getCenter().lat,map.getCenter().lng];
  if(!centre || !Number.isFinite(centre[0]) || !Number.isFinite(centre[1])) return Promise.resolve(null);
  fondAutonomePose = true;
  return poserFond().then(fond=>{
    if(fond) return fond;
    quandLibre(()=>geometrieVille(centre[0],centre[1]).then(geo=>{
      if(geo && geo.length) dessinerVille(geo); else grilleSecours(centre[0],centre[1]);
    }));
    return null;
  });
}
window.addEventListener("autour:google-map-failed", ()=>{
  promesseCarteGoogle = Promise.resolve(false);
  attributionFondAutonome();
  remettreFondAutonome();
});
function preparerCarteGoogle(centre, zoom){
  const fournisseur = window.AutourMapProviders && AutourMapProviders.googleMaps;
  if(!fournisseur || !CLE_GOOGLE) return Promise.resolve(false);
  promesseCarteGoogle = fournisseur.activer(document.getElementById("map"), centre, zoom, CLE_GOOGLE)
    .then(ok=>{
      if(ok){
        const attribution = document.querySelector("#attribution span");
        if(attribution) attribution.innerHTML = "© Google";
        const credits = document.getElementById("credits");
        if(credits) credits.textContent = "© Google · Données des fournisseurs";
        if(map && fournisseur.lierLeaflet) fournisseur.lierLeaflet(map);
      }
      return ok;
    }).catch(()=>false);
  return promesseCarteGoogle;
}
async function googleMapsActif(){
  if(!promesseCarteGoogle) return false;
  const fournisseur = window.AutourMapProviders && AutourMapProviders.googleMaps;
  return !!(await promesseCarteGoogle) && !!(fournisseur && fournisseur.estActif && fournisseur.estActif());
}

/* renvoie true dès qu'un fournisseur affiche vraiment des tuiles */
function essayerFond(f){
  return new Promise(resolve=>{
    const couche = L.tileLayer(f.url, Object.assign({pane:"villePane"}, f.opts)).addTo(map);
    let ok = false, ko = 0, fini = false;
    const termine = (bon)=>{
      if(fini) return; fini = true;
      if(!bon) surLaCarte((m)=>m.removeLayer(couche));
      resolve(bon ? couche : null);
    };
    couche.on("tileload", ()=>{ ok = true; termine(true); });
    couche.on("tileerror", ()=>{ ko++; if(ko >= 4 && !ok) termine(false); });
    setTimeout(()=>termine(ok), 2200);
  });
}

/* Les trois fournisseurs sont sondés en même temps et le premier qui rend une
   tuile gagne : en file, un fournisseur muet coûtait 5 s avant d'essayer le
   suivant, soit 15 s dans le pire cas avant le moindre fond de carte. */
async function poserFond(){
  const essais = FONDS.map(f=>essayerFond(f).then(c=>c ? {f,c} : null));
  const gagnant = await Promise.race([
    ...essais.map(p=>p.then(r=>r || new Promise(()=>{}))),   // les échecs n'arbitrent pas
    Promise.allSettled(essais).then(()=>null)                // tous muets
  ]);
  // on retire les fonds arrivés après coup pour ne pas empiler les tuiles
  essais.forEach(p=>p.then(r=>{
    if(r && gagnant && r.c !== gagnant.c) surLaCarte((m)=>m.removeLayer(r.c));
  }));
  return gagnant ? gagnant.f.nom : null;
}

function majEpaisseurs(){
  if(!map) return;
  const f = clamp(Math.pow(2, map.getZoom()-16), .35, 3.2);
  routes.forEach(r=>{ try{ r.couche.setStyle({weight: r.base*f}); }catch(e){} });
}
/* ---- Collisions d'étiquettes --------------------------------------------
   Deux étiquettes qui se chevauchent sont illisibles toutes les deux. On
   parcourt les marqueurs du plus pertinent au moins, et on réduit à sa
   pastille tout label qui empiéterait sur un précédent. La carte reste
   peuplée sans devenir un mur de texte. */
let dernierClassement = [];
/* Étiquettes : aucune ne doit en recouvrir une autre, ni sortir de l'écran.
   La version précédente supposait une boîte fixe de 186 px alors que
   l'étiquette est dimensionnée par son texte (max-width 158 px + pastille) :
   les noms courts réservaient trop de place et s'effaçaient pour rien, les
   noms longs en bord de carte débordaient sans que personne ne le voie.

   On mesure donc la boîte réelle, et on la teste contre les bords. Une
   étiquette qui déborde à droite bascule à gauche de sa pastille — c'est le
   seul rattrapage possible sans déplacer le marqueur, qui lui doit rester
   exactement sur le lieu. Si elle ne tient d'aucun côté, elle s'efface : mieux
   vaut pas d'étiquette qu'un nom tronqué au bord de l'écran. */
const MARGE_ECRAN = 6;
const CELLULE_COLLISION = 128;
let collisionPlanifiee = 0;
/* Bumpée à chaque reconstruction des marqueurs. Elle entre dans la signature
   de collision : sans elle, deux vues identiques avec des marqueurs différents
   partageraient une signature et l'une ne serait jamais recalculée. */
let revisionMarqueurs = 0;
let derniereSignatureCollision = null;
/* Bumpée à chaque reconstruction de `lieux`. Elle entre dans la clé du cache de
   classement : une donnée nouvelle invalide le cache, un simple ré-appel non. */
let revisionLieux = 0;
/* Le classement réutilisé le temps d'une tâche synchrone (voir
   `recommandationsAccueil`). Vidé à la microtâche suivante. */
let recoBurstCache = null;

function resoudreCollisions(){
  if(!map) return;
  /* NE PAS RECALCULER POUR UNE VUE IDENTIQUE.

     Le placement des étiquettes ne dépend que du zoom, du centre, de la taille
     de la carte et de l'ensemble des marqueurs. Tant que rien de cela n'a
     changé « de manière pertinente », le résultat serait identique au pixel
     près. Sur un déplacement, plusieurs `moveend` peuvent viser le même point
     final ; sans ce garde-fou, on refaisait la passe — 120 `getBoundingClientRect`
     et le placement — pour rien. */
  const centre = map.getCenter();
  const taille0 = map.getSize ? map.getSize() : {x:innerWidth, y:innerHeight};
  const signature = map.getZoom()+"@"+centre.lat.toFixed(5)+","+centre.lng.toFixed(5)+
    "#"+marqueurs.size+"~"+revisionMarqueurs+"|"+derniereSelection.length+
    ":"+taille0.x+"x"+taille0.y;
  if(signature === derniereSignatureCollision) return;
  derniereSignatureCollision = signature;

  const assezPres = map.getZoom() >= 15;
  /* Priorité d'étiquette : l'ordre de la sélection de la CARTE, pas celui des
     recommandations de la feuille. Les deux divergent dès qu'on regarde une
     autre zone, et les lieux affichés se retrouvaient alors tous à égalité. */
  const rang = new Map();
  derniereSelection.forEach((x,i)=>rang.set(x.l.id, i));
  const priorite = ([id])=>rang.has(id) ? rang.get(id) : 9999;
  const conteneur = map.getContainer ? map.getContainer() : null;
  const cadre = conteneur ? conteneur.getBoundingClientRect() : {left:0, top:0};
  const taille = map.getSize ? map.getSize() : {x:innerWidth, y:innerHeight};

  /* Grille spatiale : une étiquette ne compare plus sa boîte à toutes les
     précédentes, seulement à celles des cellules qu'elle touche. Le coût passe
     de O(n²) à un voisinage borné, même avec plusieurs centaines de POI. */
  const grille = new Map();
  const cellules = (b)=>{
    const out=[];
    const x0=Math.floor(b.x/CELLULE_COLLISION), x1=Math.floor((b.x+b.w)/CELLULE_COLLISION);
    const y0=Math.floor(b.y/CELLULE_COLLISION), y1=Math.floor((b.y+b.h)/CELLULE_COLLISION);
    for(let x=x0;x<=x1;x++) for(let y=y0;y<=y1;y++) out.push(x+":"+y);
    return out;
  };
  const seCroisent = (a,b)=>a.x < b.x+b.w && b.x < a.x+a.w && a.y < b.y+b.h && b.y < a.y+a.h;
  const chevauche = (b)=>{
    const candidates = new Set();
    cellules(b).forEach(c=>(grille.get(c)||[]).forEach(x=>candidates.add(x)));
    return [...candidates].some(x=>seCroisent(b,x));
  };
  const enregistrer = (b)=>cellules(b).forEach(c=>{
    if(!grille.has(c)) grille.set(c,[]);
    grille.get(c).push(b);
  });

  const entrees = [...marqueurs.entries()]
    .filter(([id])=>!String(id).startsWith("grappe:"))
    .sort((a,b)=>priorite(a)-priorite(b))
    .map(([,m])=>{
      const el = m.getElement && m.getElement();
      /* LES CARTES D'ÉVÉNEMENT ÉTAIENT INVISIBLES À CE MOTEUR.
         Il ne connaissait que `.poi-eti` / `.poi-rond`. Les cartes blanches
         posées pour « Maintenant » n'entraient donc dans aucun test : jamais
         masquées, jamais basculées, jamais bornées à l'écran. Cinq événements
         dans cent mètres produisaient cinq cartes empilées et illisibles, et
         certaines débordaient de la fenêtre. Mesuré : 5 illisibles sur 5.
         Elles suivent la même mécanique — un texte qui peut s'effacer, une
         pastille qui reste toujours touchable. */
      const eti = el && el.querySelector(".poi-eti, .evc-txt");
      const rond = el && el.querySelector(".poi-rond, .evc-rond");
      return eti && rond ? {eti,rond} : null;
    }).filter(Boolean);

  // Toutes les écritures d'abord, toutes les mesures ensuite : auparavant le
  // basculement à gauche forçait un recalcul de layout par étiquette.
  entrees.forEach(({eti})=>eti.classList.remove("masquee","a-gauche"));
  if(conteneur) void conteneur.offsetWidth;

  /* LES PASTILLES OCCUPENT L'ÉCRAN, ELLES AUSSI.
     Seules les étiquettes étaient enregistrées dans la grille : une étiquette
     pouvait donc se poser exactement sur la pastille d'un autre marqueur, qui
     devenait à la fois illisible et intouchable. On réserve la place des
     pastilles AVANT de placer le moindre texte — un marqueur doit rester
     désignable même quand son nom disparaît. */
  /* UNE SEULE PASSE DE LECTURE. Étiquette ET pastille sont mesurées d'affilée,
     une fois chacune. La version précédente lisait la pastille DEUX fois — une
     fois pour réserver sa place, une fois pour placer l'étiquette — soit 3n
     `getBoundingClientRect` là où 2n suffisent. Toutes les écritures viennent
     après, sans jamais forcer un recalcul de mise en page entre deux lectures. */
  const boites = entrees.map(({eti,rond})=>({
    eti, r:eti.getBoundingClientRect(), rr:rond.getBoundingClientRect(),
  }));

  boites.forEach(({rr})=>{
    if(rr.width > 0 && rr.height > 0)
      enregistrer({x:rr.left-cadre.left, y:rr.top-cadre.top, w:rr.width, h:rr.height});
  });

  const decisions=[];
  boites.forEach(({eti,r,rr})=>{
      if(!assezPres){ decisions.push({eti,masquee:true,gauche:false}); return; }
      const droite = {x:r.left-cadre.left,y:r.top-cadre.top,w:r.width,h:r.height};
      const recouvrement = Math.min(10,Math.max(6,rr.width*.3));
      const gauche = {x:rr.left-cadre.left+recouvrement-r.width,
                      y:droite.y,w:droite.w,h:droite.h};
      const tient = (b)=> b.w > 0 && b.h > 0
        && b.x >= MARGE_ECRAN && b.x + b.w <= taille.x - MARGE_ECRAN
        && b.y >= MARGE_ECRAN && b.y + b.h <= taille.y - MARGE_ECRAN;
      let boite = droite, aGauche = false;
      if(!tient(boite) || chevauche(boite)){ boite=gauche; aGauche=true; }
      if(!tient(boite) || chevauche(boite)){
        decisions.push({eti,masquee:true,gauche:false}); return;
      }
      enregistrer(boite);
      decisions.push({eti,masquee:false,gauche:aGauche});
    });
  decisions.forEach(d=>{
    d.eti.classList.toggle("a-gauche",d.gauche);
    d.eti.classList.toggle("masquee",d.masquee);
  });
}

function planifierCollisions(){
  if(collisionPlanifiee) cancelAnimationFrame(collisionPlanifiee);
  collisionPlanifiee = requestAnimationFrame(()=>{
    collisionPlanifiee = 0;
    resoudreCollisions();
  });
}

function majEtiquettes(){
  if(!map) return;
  const montrer = map.getZoom() >= 16;
  etiquettes.forEach(m=>{
    const dedans = map.getBounds().pad(.1).contains(m.getLatLng());
    if(montrer && dedans){ if(!map.hasLayer(m)) m.addTo(map); }
    else if(map.hasLayer(m)) map.removeLayer(m);
  });
}

/* ================================================================== */
/*  Démarrage                                                         */
/* ================================================================== */

/* Ajoute sans écraser : chaque source arrive à son rythme et complète les
   précédentes, au lieu de remplacer la liste entière. */
/* Un événement terminé n'a plus rien à faire sur la carte. */
/* Passé : c'est le moteur temporel qui tranche, pour qu'un événement récurrent
   ne soit pas déclaré terminé sur la fin de sa première séance. */
function estPasse(l){
  if(estTemporaire(l)) return statutTemps(l).statut === TEMPS.STATUTS.PASSE;
  return l.endsAt != null && l.endsAt < Date.now();
}

function journaliserPipeline(source, brut, classes, dedupliques){
  const apresMaintenant = (dedupliques||[]).filter(l=>isAvailableNow(l, Date.now())).length;
  journal.info("[Autour][données]", {
    source,
    bruts:brut,
    apresClassification:(classes||[]).length,
    apresDeduplication:(dedupliques||[]).length,
    apresMaintenant
  });
}

/* Dernier filet de fusion : les sources peuvent arriver dans n'importe quel
   ordre et certaines étiquettes OSM ne se classent pas exactement comme leur
   type Google. Pour un établissement de restauration à moins de 80 m, le nom
   commercial fortement compatible reste une preuve suffisante. */
function estGooglePlaces(l){
  return !!(l && (l.source === "google_places" || l.idGoogle ||
    (l.sourceRefs && l.sourceRefs.googlePlaceId)));
}
function familleDedupLieu(l){
  return ["resto","fastfood","cafe","bar"].includes(l && l.cat) ? "restauration" : (l && l.cat);
}
function fusionnerFichesFournisseurs(candidats){
  const liste = candidats || [];
  const aGoogle = liste.some(estGooglePlaces);
  const aAutre = liste.some(l=>!estGooglePlaces(l));
  /* Sans les deux familles, aucun rapprochement n'est possible : parcourir
     toutes les paires ne pouvait donc que rendre la même liste. */
  if(!aGoogle || !aAutre) return liste.slice();
  const fusionnes=[];
  liste.forEach(l=>{
    const i=fusionnes.findIndex(existant=>{
      if(!l || !existant || estTemporaire(l) || estTemporaire(existant)) return false;
      if(estGooglePlaces(l) === estGooglePlaces(existant)) return false;
      if(familleDedupLieu(l) !== familleDedupLieu(existant)) return false;
      const proches=distanceM(l.lat,l.lng,existant.lat,existant.lng) <= 80;
      return proches && (nomsLieuxCompatibles(l.titre,existant.titre) ||
        adressesLieuxCompatibles(l.adresse,existant.adresse));
    });
    if(i<0){ fusionnes.push(l); return; }
    const existant=fusionnes[i], google=estGooglePlaces(l)?l:existant, autre=google===l?existant:l;
    const merged=Object.assign({},autre,google);
    merged.sources=[...new Set([...(autre.sources||[autre.source]),...(google.sources||[google.source])])];
    merged.categories=[...new Set([...(autre.categories||[]),...(google.categories||[])])];
    merged.sourceRefs=Object.assign({},autre.sourceRefs||{},google.sourceRefs||{});
    ["adresse","tel","url","horaires","description"].forEach(cle=>{
      merged[cle]=google[cle] || autre[cle] || "";
    });
    /* LA PHOTO NE SUIT PAS LA MÊME RÈGLE QUE L'ADRESSE.

       Google est la source la plus précise pour une adresse ou des horaires ;
       il est le DERNIER recours pour une photo. Prendre `google.image` d'office
       écrasait ici la façade Commons du côté OpenStreetMap par une photo de
       client — et lui faisait perdre au passage son auteur et sa licence.
       Le visuel le mieux placé gagne, avec toute sa provenance. */
    Object.assign(merged, visuelPrefere(google, autre));
    fusionnes[i]=merged;
  });
  return fusionnes;
}

/* Lequel des deux visuels représente le lieu ? L'ordre est celui du résolveur :
   une photo Places ne prend jamais la place d'une photo dont on connaît
   l'auteur et la licence. */
function visuelPrefere(a, b){
  const champs = ["image","imageSource","imageAttribution","image_url","image_source",
    "image_source_url","image_author","image_license","image_updated_at","image_scope",
    "image_type","image_confidence","image_width","image_height","image_fallback_reason"];
  const sources = IMAGES ? IMAGES.SOURCES : [];
  /* Plus le rang est bas, mieux c'est. Pas d'image du tout : hors concours.
     Une provenance qu'on ne reconnaît pas passe derrière toutes celles qu'on
     reconnaît — elle existe, mais on ne peut rien dire d'elle. */
  const rang = l=>{
    if(!l || !l.image) return Infinity;
    const i = sources.indexOf(l.imageSource);
    return i < 0 ? sources.length : i;
  };
  const gagnant = rang(a) <= rang(b) ? a : b;
  const out = {};
  if(rang(gagnant) === Infinity) return out;       // aucun des deux n'a de photo
  champs.forEach(cle=>{ if(gagnant[cle] !== undefined) out[cle] = gagnant[cle]; });
  return out;
}

function reconstruireLieux(){
  const toutes = [
    ...permanentPlaces,
    ...datatourismePlaces,
    ...externalEvents,
    ...userPublications
  ];
  /* Les fiches Aide ont une règle de rapprochement plus stricte que les
     commerces : SIRET/FINESS/identifiant source d'abord, sinon nom + adresse
     + coordonnées. Elles ne sont jamais rapprochées par un nom seul. */
  const aide = toutes.filter(l=>l && l.aideStructure === true);
  const autres = toutes.filter(l=>!l || l.aideStructure !== true);
  const aideDedup = window.AutourAideStructures
    ? AutourAideStructures.dedupe(aide)
    : aide;
  lieux = fusionnerFichesFournisseurs(dedupeItems([...autres,...aideDedup], distanceM));
  publies = userPublications;
  indexPerime = true;
  revisionLieux++;
}

/* ---- Index mémoire par catégorie -----------------------------------------
   Savoir en O(1) ce qu'on possède déjà : c'est ce qui permet à un changement
   de catégorie de ne déclencher aucune requête quand les lieux sont là. */
const indexCategories = new Map();
function reindexerCategories(){
  indexCategories.clear();
  lieux.forEach(l=>{
    // un lieu appartient à plusieurs catégories : il compte pour chacune
    new Set([l.cat, ...(l.categories||[])]).forEach(c=>{
      if(!c) return;
      if(!indexCategories.has(c)) indexCategories.set(c, []);
      indexCategories.get(c).push(l);
    });
  });
}
function lieuxDeCategorie(cat){ return indexCategories.get(cat) || []; }
function categorieEnMemoire(cat){ return lieuxDeCategorie(cat).length > 0; }

function fusionner(nouveaux, flux, opts){
  if(!nouveaux || !nouveaux.length) return false;
  const debutCpu = performance.now();
  // les lieux changent : la mémoire de disponibilité ne vaut plus rien
  oublierItemsMaintenant();
  const o = opts || {};
  const type = flux || "permanent";
  const source = nouveaux[0] && nouveaux[0].source || type;
  const classes = nouveaux.map(l=>l.categories ? l : normaliserItem(l, source))
    // une annulation reste une information utile et distincte d'une suppression
    .filter(l=>l.annule || !estPasse(l));
  const courant = type === "external" ? externalEvents
    : type === "user" ? userPublications
    : type === "datatourisme" ? datatourismePlaces : permanentPlaces;
  const parId = new Map(courant.map(l=>[l.id,l]));
  classes.forEach(l=>parId.set(l.id,l));
  const dedupliques = dedupeItems([...parId.values()], distanceM);
  if(type === "external") externalEvents = dedupliques;
  else if(type === "user") userPublications = dedupliques;
  else if(type === "datatourisme") datatourismePlaces = dedupliques;
  else permanentPlaces = dedupliques;
  journaliserPipeline(source, nouveaux.length, classes, dedupliques);
  PERF.travail("fusion:"+type, debutCpu);
  if(o.differerReconstruction) return true;
  finaliserFusion(o);
  return true;
}

function finaliserFusion(opts){
  const debutCpu = performance.now();
  const o = opts || {};
  reconstruireLieux();
  if(!window.__premiereDonnee){
    window.__premiereDonnee = true;
    performance.mark("autour:donnees");
    performance.measure("première donnée visible", "autour:script", "autour:donnees");
  }
  // l'index doit précéder le rendu : le classement et les filtres le lisent
  reindexerCategories();
  // `silencieux` : l'appelant sait déjà ce qu'il va afficher (le jeu rapide au
  // démarrage) et ne veut surtout pas d'un reclassement avant la première image
  if(!o.silencieux){
    // un seul rendu par image, quel que soit le nombre de sources qui arrivent
    planifierRendu({carte:true, accueil:true, filtres:true});
    ouvrirLieuPartage();    // le lieu d'un lien partagé s'ouvre dès qu'il arrive
  }
  /* De nouveaux événements peuvent concerner ce qu'on suit. Le panneau se
     remet à jour quand il est ouvert, jamais autrement : peindre une colonne
     invisible coûterait sans rien apporter. */
  if(document.body.classList.contains("pourtoi-ouvert")) majPourToi();
  else majPastillePourToi();
  PERF.travail("reconstruction", debutCpu);
}

/* Deux RPC Supabase arrivent ensemble. Mettre à jour leurs flux séparément
   mais reconstruire/dédupliquer la collection UNE seule fois conserve le
   résultat final tout en supprimant le travail quadratique intermédiaire. */
function fusionnerLots(lots, opts){
  let modifie = false;
  (lots || []).forEach(lot=>{
    if(fusionner(lot && lot.donnees, lot && lot.flux,
      Object.assign({},opts||{},{differerReconstruction:true}))) modifie = true;
  });
  if(modifie) finaliserFusion(opts);
  return modifie;
}

/* Une même génération peut interroger plusieurs fournisseurs en parallèle.
   Chaque réponse vérifie l'identifiant courant AVANT de publier ; une ancienne
   recherche peut donc finir côté réseau, mais elle ne touche plus l'écran ni
   l'état global. Le coordinateur rend les sources indépendantes : une panne
   ou une réponse lente n'empêche jamais les autres de devenir visibles. */
async function coordonnerSourcesVersionnees(sources, estCourante){
  let exploitable = false;
  const travaux = (sources || []).map(async source=>{
    try{
      const reponse = await source.charger();
      if(!estCourante()) return false;
      const publie = await source.publier(reponse);
      if(!estCourante()) return false;
      if(publie) exploitable = true;
      return !!publie;
    }catch(e){
      if(estCourante() && typeof source.echec === "function") source.echec(e);
      return false;
    }
  });
  await Promise.allSettled(travaux);
  return estCourante() && exploitable;
}

/* Cache local des lieux OpenStreetMap : revenir dans un quartier déjà vu
   l'affiche instantanément, sans réinterroger Overpass. */
const CACHE_HEURES = 24;
const cleCache = (lat,lng)=>"autour:lieux:v5:"+lat.toFixed(3)+","+lng.toFixed(3);

function lireCacheLieux(lat,lng){
  try{
    const brut = localStorage.getItem(cleCache(lat,lng));
    if(!brut) return null;
    const o = JSON.parse(brut);
    if(Date.now() - o.t > CACHE_HEURES*3600*1000) return null;
    return o.l;
  }catch(e){ return null; }         // navigation privée, quota plein…
}

/* La clé de cache est arrondie à ~110 m : ouvrir l'application vingt mètres
   plus loin ratait le cache et laissait l'écran vide en attendant Overpass.
   On accepte donc la zone connue la plus proche dans un rayon raisonnable. */
const CACHE_RAYON_M = 1200;
function lireCacheProche(lat,lng){
  const exact = lireCacheLieux(lat,lng);
  if(exact && exact.length) return exact;
  let meilleur = null, meilleureDistance = Infinity;
  try{
    for(let i = 0; i < localStorage.length; i += 1){
      const cle = localStorage.key(i);
      if(!cle || cle.indexOf("autour:lieux:v5:") !== 0) continue;
      const [cLat,cLng] = cle.slice(16).split(",").map(Number);
      if(!Number.isFinite(cLat) || !Number.isFinite(cLng)) continue;
      const d = distanceM(lat,lng,cLat,cLng);
      if(d > CACHE_RAYON_M || d >= meilleureDistance) continue;
      const o = JSON.parse(localStorage.getItem(cle) || "null");
      if(!o || Date.now() - o.t > CACHE_HEURES*3600*1000) continue;
      meilleur = o.l; meilleureDistance = d;
    }
  }catch(e){ return null; }
  return meilleur;
}

/* ---- Échantillon immédiat ------------------------------------------------
   Trois à cinq lieux réels, variés, affichés avant toute requête. Ils
   viennent du cache et des favoris — jamais d'un jeu inventé. La diversité
   est cherchée par famille : manger, sortir, culture, plein air, événement. */
const FAMILLES_ECHANTILLON = [
  ["resto","fastfood","marche","food"],
  ["cafe","bar"],
  ["cinema","musee","spectacle","concert"],
  ["parc","park","terrain","swimming_pool"],
  ["event","popup","rencontre","collecte","studio","sport","autre"],
];
const ECHANTILLON_MAX = 5;

function echantillonImmediat(candidats){
  const retenus = [];
  const vus = new Set();
  const prendre = (l)=>{
    if(!l || vus.has(l.id) || retenus.length >= ECHANTILLON_MAX) return;
    vus.add(l.id); retenus.push(l);
  };
  // les favoris d'abord : ce sont les lieux dont on sait qu'ils comptent
  candidats.filter(l=>estFavori(l)).forEach(prendre);
  // puis une entrée par famille, pour ne pas afficher cinq restaurants
  FAMILLES_ECHANTILLON.forEach(famille=>{
    if(retenus.length >= ECHANTILLON_MAX) return;
    prendre(candidats.find(l=>famille.includes(l.cat) && !vus.has(l.id)));
  });
  return retenus;
}

/* ---- Jeu de données rapide ----------------------------------------------
   Le cache de tuiles rend les lieux ; il ne rend pas les PROPOSITIONS. Au
   démarrage suivant, il fallait encore reclasser, filtrer temporellement et
   composer la feuille avant qu'une seule carte n'apparaisse — un demi-seconde
   de fil principal sur un téléphone, pendant laquelle l'écran est un
   squelette gris.

   On garde donc le résultat, pas seulement la matière : les quelques lieux
   retenus la dernière fois, dans l'ordre où ils l'étaient. À l'ouverture ils
   s'affichent tels quels, à la première image, sans rien recalculer. Le
   classement réel les remplace ensuite, sans jamais vider l'écran.

   Ce ne sont pas des données inventées : ce sont exactement celles qui
   étaient à l'écran il y a quelques heures, avec leur date. Ce qui a fermé
   depuis sera écarté par le moteur temporel dès le premier vrai classement. */
const CLE_RAPIDE = "autour:rapide:v1";
const RAPIDE_MAX = 50;              // ce qu'on garde en réserve pour la zone
const RAPIDE_HEURES = 24;
const RAPIDE_RAYON_M = 2000;
/* Les champs qui servent à dessiner une carte et à la reclasser. Le reste
   (description, mots-clés, géométrie) pèse sans rien apporter au premier
   affichage : on ne l'écrit pas. */
const CHAMPS_RAPIDE = ["id","autourId","entity_type","cat","categories","titre","adresse","cp","lat","lng","image","imageSource","imageAttribution",
  /* La provenance suit la photo jusque dans le cache. Une image sans son
     origine ne peut plus dire de quel droit on l'affiche à la réouverture :
     elle serait alors une image de source inconnue, donc à ne pas montrer. */
  "image_url","image_source","image_source_url","image_author","image_license","image_updated_at","image_scope",
  "image_type","image_confidence","image_width","image_height","image_fallback_reason",
  "note","avis","prix","gratuit","quand","cuisine","tags","pmr","source","sourceRefs",
  "par","isTemporary","debutLe","finLe","service","solidaire","sansNom","description",
  "event_kind","eventKind","start_at","end_at","timezone","temporal_status","temporalStatus",
  "date_confidence","dateConfidence","price_amount","price_text","is_free","price_confidence",
  "audience","min_age","reservation_required","reservation_text","venue_name","organizer_name",
  "event_source","event_source_url","place_source","place_source_url","entity_type"];

function estContenuGoogle(l){
  return !!(l && (l.source === "google_places" || (l.sourceRefs && l.sourceRefs.googlePlaceId)));
}

function alleger(l){
  const out = {};
  CHAMPS_RAPIDE.forEach(k=>{ if(l[k] !== undefined) out[k] = l[k]; });
  return out;
}

/* GOOGLE PLACES N'EST PAS UNE BIBLIOTHÈQUE PERMANENTE.

   `estContenuGoogle` écarte déjà les FICHES venues de Google. Il reste un
   chemin : un lieu OpenStreetMap qui, faute de mieux, a reçu une photo Places
   en repli. La fiche est conservable, la photo ne l'est pas — les règles de
   Google la veulent affichée en direct, avec son crédit, pas stockée. On la
   retire donc du cache, et elle sera redemandée si elle est encore le
   meilleur recours à la prochaine ouverture. */
function sansPhotoGoogle(l){
  if(!l || l.imageSource !== "google_places") return l;
  ["image","imageSource","imageAttribution","image_url","image_source",
   "image_source_url","image_author","image_license","image_updated_at","image_type",
   "image_confidence","image_width","image_height","image_fallback_reason"].forEach(k=>{ delete l[k]; });
  return l;
}

let dernierJeuRapide = 0;
function memoriserJeuRapide(choisis, reserve){
  if(!positionMoi || !choisis || !choisis.length) return;
  // une écriture par minute suffit : le classement bouge à chaque source qui
  // arrive, et sérialiser cinquante lieux à chaque fois coûterait plus cher
  // que ce que l'écriture fait gagner
  if(Date.now() - dernierJeuRapide < 60000) return;
  dernierJeuRapide = Date.now();
  quandLibre(()=>{
    try{
      const vus = new Set();
      const garder = [];
      [...choisis, ...(reserve || [])].forEach(l=>{
        // Les contenus Places restent transitoires : ni photo, ni horaires,
        // ni fiche ne sont recopiés dans le cache Autour.
        if(estContenuGoogle(l)) return;
        if(!l || vus.has(l.id) || garder.length >= RAPIDE_MAX) return;
        vus.add(l.id); garder.push(sansPhotoGoogle(alleger(l)));
      });
      localStorage.setItem(CLE_RAPIDE, JSON.stringify({
        t:Date.now(), zone:positionMoi, commune,
        choisis:choisis.filter(l=>!estContenuGoogle(l)).map(l=>l.id), lieux:garder,
      }));
    }catch(e){ /* quota plein : le cache de tuiles reste, on ne casse rien */ }
  });
}

/* ---- Le tout premier démarrage ------------------------------------------
   Le jeu rapide vient de la session précédente ; le cache de tuiles aussi. Un
   nouveau téléphone n'a ni l'un ni l'autre, et n'a donc que le réseau — c'est
   le seul cas où Autour dépendait encore d'un tiers pour afficher sa première
   ligne.

   On sert donc un jeu pré-calculé par zone, déposé à côté de l'application et
   mis en cache par le CDN comme un fichier statique : une requête vers notre
   propre origine, sans Overpass, sans Nominatim, sans permission. La clé est
   la coordonnée arrondie au dixième de degré — environ une agglomération —
   ce qui évite un index à télécharger d'abord.

   Ces fichiers sont produits par `outils/zones.mjs` (voir docs/zones.md). Leur
   absence n'est pas une panne : la fonction rend `null` et le démarrage suit
   son chemin habituel. Ce qu'on ne fabrique jamais, c'est un lieu : s'il n'y a
   pas de fichier pour la zone, il n'y a pas de proposition inventée. */
let zonesDisponibles = null;         // null = pas encore su, false = absentes
const cleZoneStatique = (lat,lng)=> lat.toFixed(1)+","+lng.toFixed(1);

/* Le fichier couvre la tuile entière — onze kilomètres sur sept — pour que
   n'importe qui dedans y trouve son quartier. Mais on n'en fusionne que le
   voisinage immédiat : normaliser, dédupliquer et regrouper cent soixante-dix
   lieux coûte près de trois secondes de fil principal sur un téléphone, pour
   en afficher cinq. Le reste de la tuile ne sert à rien tant qu'on n'a pas
   bougé — et si on bouge, les vraies sources auront répondu depuis longtemps. */
const RAPIDE_VOISINAGE = 25;

async function lieuxDeZone(lat,lng){
  if(zonesDisponibles === false) return null;
  try{
    const fini = PERF.requete("zone_statique");
    const r = await fetch("zones/"+cleZoneStatique(lat,lng)+".json");
    if(fini) fini();
    /* Une tuile trouvée est un démarrage sans réseau lointain : c'est le hub
       qui a fait son travail. Une tuile absente n'est pas une panne — elle dit
       qu'on est hors des zones précalculées, et c'est une information. */
    PERF.touche("zone_statique", r.ok);
    if(!r.ok){ if(r.status === 404) zonesDisponibles = false; return null; }
    const j = await r.json();
    if(!j || !Array.isArray(j.lieux) || !j.lieux.length) return null;
    zonesDisponibles = true;
    return j.lieux
      .map(l=>Object.assign({}, l, {_d:distanceM(lat,lng,l.lat,l.lng)}))
      .sort((a,b)=>a._d - b._d)
      .slice(0, RAPIDE_VOISINAGE)
      .map(l=>{ delete l._d; return l; });
  }catch(e){ return null; }
}

function lireJeuRapide(lat,lng){
  /* Chaque sortie de cette fonction est un « miss » : c'est le cache local, la
     source la plus rapide qui existe, et savoir combien de fois on la manque
     dit tout de la vitesse ressentie à la deuxième ouverture. */
  const manque = (raison)=>{ PERF.touche("jeu_rapide", false); return null; };
  try{
    const o = JSON.parse(localStorage.getItem(CLE_RAPIDE) || "null");
    if(!o || !o.lieux || !o.lieux.length) return manque("vide");
    const lieuxSansGoogle = o.lieux.filter(l=>!estContenuGoogle(l));
    if(lieuxSansGoogle.length !== o.lieux.length){
      o.lieux = lieuxSansGoogle;
      o.choisis = (o.choisis || []).filter(id=>lieuxSansGoogle.some(l=>l.id===id));
      try{ localStorage.setItem(CLE_RAPIDE,JSON.stringify(o)); }catch(e){}
    }
    if(!o.lieux.length) return manque("vide");
    if(Date.now() - o.t > RAPIDE_HEURES*3600*1000) return manque("perime");
    // le jeu décrit une zone : à l'autre bout de la France il ne décrit rien
    if(lat != null && o.zone &&
       distanceM(lat,lng,o.zone[0],o.zone[1]) > RAPIDE_RAYON_M) return manque("ailleurs");
    PERF.touche("jeu_rapide", true);
    return o;
  }catch(e){ return manque("illisible"); }
}

/* Le cache des zones n'était jamais purgé : une entrée par tuile de ~110 m,
   jusqu'à trois cents lieux chacune. En explorant, on finissait par saturer le
   quota du navigateur ; l'erreur était avalée par un catch vide, et l'écriture
   cessait sans que rien ne le dise. C'est pourtant ce cache qui porte
   l'affichage immédiat au démarrage : il se dégradait invisiblement.

   On plafonne donc le nombre de tuiles, et quand le quota saute malgré tout on
   fait de la place au lieu d'abandonner. */
const CACHE_TUILES_MAX = 40;

function tuilesCache(){
  const tuiles = [];
  try{
    for(let i = 0; i < localStorage.length; i += 1){
      const cle = localStorage.key(i);
      if(!cle || cle.indexOf("autour:lieux:v5:") !== 0) continue;
      let t = 0;
      try{ t = (JSON.parse(localStorage.getItem(cle)) || {}).t || 0; }catch(e){}
      tuiles.push({cle, t});
    }
  }catch(e){ return []; }
  return tuiles.sort((a,b)=>a.t - b.t);      // la plus ancienne en premier
}

function libererCache(combien){
  const tuiles = tuilesCache();
  let libere = 0;
  for(const tuile of tuiles){
    if(libere >= combien) break;
    try{ localStorage.removeItem(tuile.cle); libere += 1; }catch(e){}
  }
  return libere;
}

function ecrireCacheLieux(lat,lng,l){
  const cle = cleCache(lat,lng);
  const charge = JSON.stringify({t:Date.now(), l});
  // au-delà du plafond, on retire les zones les plus anciennes avant d'écrire
  // +1 : on fait la place de celle qu’on s’apprête à écrire, sinon le
  // plafond est dépassé d’une tuile en permanence
  const surplus = tuilesCache().length - CACHE_TUILES_MAX + 1;
  if(surplus > 0) libererCache(surplus);
  try{ localStorage.setItem(cle, charge); return true; }
  catch(e){
    // quota atteint : faire de la place et réessayer une fois, plutôt que de
    // renoncer silencieusement
    if(!libererCache(Math.max(5, Math.ceil(CACHE_TUILES_MAX / 4)))) return false;
    try{ localStorage.setItem(cle, charge); return true; }
    catch(e2){ return false; }
  }
}

/* Les lieux n'étaient chargés qu'autour du point de départ : explorer un autre
   quartier ne montrait plus rien. On recharge dès qu'on s'en éloigne assez,
   le cache local évitant de réinterroger ce qu'on a déjà vu. */
let dernierChargement = null;
let chargementEnCours = false;

const chargementsZone = new Map();
let numeroGeneration = 0;
const generationsActives = new Map();

/* Une réponse n'a le droit de modifier l'application que si elle appartient à
   la génération encore active de son canal. Changer de ville, recevoir le GPS
   ou choisir une autre catégorie annule la génération précédente ; les API
   non annulables peuvent finir, mais leur réponse est alors simplement jetée. */
function nouvelleGeneration(canal, cle, force){
  const precedente = generationsActives.get(canal);
  if(!force && precedente && precedente.cle === cle && !precedente.signal.aborted) return precedente;
  if(precedente) precedente.controleur.abort();
  const controleur = new AbortController();
  /* La portée voyage avec la requête. C'est ce qui rend l'ignorance des vieux
     résultats automatique : une réponse de Tourcoing partie avant la recherche
     « Lille » revient avec l'ancien numéro et n'est plus regardée — même si
     elle arrive dans le canal courant, même si elle a réussi. */
  const generation = {id:++numeroGeneration, canal, cle, controleur,
    signal:controleur.signal, portee:porteeCourante};
  generationsActives.set(canal,generation);
  return generation;
}
function generationCourante(generation){
  if(!generation || generation.signal.aborted) return false;
  if(!porteeValide(generation.portee)) return false;
  return generationsActives.get(generation.canal) === generation;
}
/* Changer de ville coupe court : toute requête en vol est avortée, la mémoire
   des chargements est vidée, et le garde-fou « on a déjà chargé à 800 m »
   est levé pour que la nouvelle zone parte vraiment. */
function annulerChargementsZone(saufCanal){
  generationsActives.forEach((g,canal)=>{
    if(canal === saufCanal) return;
    try{ g.controleur.abort(); }catch(e){}
    generationsActives.delete(canal);
  });
  chargementsZone.clear();
  chargementEnCours = false;
  dernierChargement = null;
}
function annulerGeneration(canal){
  const generation = generationsActives.get(canal);
  if(generation) generation.controleur.abort();
  generationsActives.delete(canal);
}
function terminerGeneration(generation){
  if(generationCourante(generation)) generationsActives.delete(generation.canal);
}

/* Bornes de la vue, ramenées à 5 km de côté au maximum : au-delà, la requête
   pèserait autant qu'une ville entière pour un écran qu'on ne lit plus. */
function bornesVisibles(){
  if(!map) return null;
  const b = map.getBounds(), c = b.getCenter();
  const dLat = Math.min(b.getNorth()-c.lat, 0.023);
  const dLng = Math.min(b.getEast()-c.lng, 0.023/Math.max(0.2,Math.cos(c.lat*Math.PI/180)));
  return { s:(c.lat-dLat).toFixed(5), n:(c.lat+dLat).toFixed(5),
           o:(c.lng-dLng).toFixed(5), e:(c.lng+dLng).toFixed(5) };
}

/* Ce qu'on a déjà demandé : zone arrondie + zoom + jeu de catégories. Revenir
   sur ses pas ne redemande rien, et changer de besoin ne redemande que ce qui
   manque. */
const zonesVues = new Set();
/* UNE CLÉ DE CACHE PORTE SA ZONE. « depart » ou « resto » tout court, c'est la
   même case pour Tourcoing et pour Lille : le premier arrivé sert le second, et
   la ville qu'on vient de demander reçoit les lieux de celle qu'on a quittée.
   La clé porte donc la zone active, la position, le zoom et les catégories. */
function cleZone(lat, lng, z, cats){
  return idZoneActive()+"#"+lat.toFixed(2)+","+lng.toFixed(2)+"@"+Math.round(z/2)+":"+(cats ? [...cats].sort().join("+") : "depart");
}

function chargerZone(lat, lng, opts){
  const o = opts || {};
  /* LE ZOOM D'UNE CARTE QUI VOLE N'EST PAS CELUI QU'ELLE VISE.

     Ce garde-fou existe pour une bonne raison : vue de très loin, une carte
     couvre un pays, et charger « ce qui est à l'écran » n'aurait aucun sens.
     Mais `cadrerSur` est ANIMÉ — pour aller de Paris à Rouen, Leaflet
     dézoome, traverse, puis rezoome. Interrogé pendant la traversée,
     `getZoom()` rend un niveau de survol, et le chargement était abandonné
     en silence.

     Mesuré au banc : « Rouen » demandé depuis Paris changeait bien de zone,
     de carte et de contexte — mais aucune requête ne partait, et l'écran
     restait vide. Deux villes de suite suffisaient à le déclencher.

     L'appelant qui vient de lancer le cadrage sait où la carte va se poser :
     il le dit, et c'est ce niveau-là qui décide. */
  const zoomVise = o.zoomVise != null ? o.zoomVise : (map ? map.getZoom() : 16);
  if(!o.sansCarte && (!map || zoomVise < ZOOM_MIN_CHARGEMENT)) return Promise.resolve([]);
  const zoom = zoomVise;
  const cle = cleZone(lat, lng, zoom, o.cats);
  const existant = chargementsZone.get(cle);
  if(!o.force && existant && generationCourante(existant.generation)) return existant;
  if(existant) chargementsZone.delete(cle);
  if(!o.force && zonesVues.has(cle)) return Promise.resolve([]);
  if(!o.force && !o.cats && dernierChargement &&
     distanceM(dernierChargement[0], dernierChargement[1], lat, lng) < 800) return Promise.resolve([]);

  const canal = o.cats ? "zone:categories" : "zone:exploration";
  const generation = nouvelleGeneration(canal,cle,!!o.force);
  const signal = generation.signal;
  chargementEnCours = true;
  prendreEtatRecherche("overpass",generation);
  if(!o.osmSeulement) prendreEtatRecherche("places",generation);
  if(generationCourante(generation)){
    if(!o.osmSeulement) definirEtatRechercheVersionne("places",SEARCH_STATES.LOADING_PLACES,generation);
    definirEtatRechercheVersionne("overpass",SEARCH_STATES.IDLE,generation);
  }
  const marqueDebut = "zone:debut:"+generation.id;
  try{ performance.mark(marqueDebut); }catch(e){}

  const enCache = lireCacheProche(lat,lng);
  let sourceExploitable = !!(enCache && enCache.length);
  if(sourceExploitable && generationCourante(generation)){
    // stale-while-revalidate : ce qu'on a s'affiche tout de suite, la mise à
    // jour arrive derrière et remplace sans vider l'écran
    fusionner(enCache);
    PERF.jalon("cached_pois_visible");
  }

  // allSettled : une source lente ou en panne ne retient pas les autres
  /* UNE VILLE LOINTAINE NE COÛTE PAS UNE VILLE ENTIÈRE.
     Quelqu'un à Lille qui tape « Marseille » déclenchait la même requête que
   s'il y était : toute l'emprise affichée, trois cents objets par-dessus —
   pour cinq cartes qu'il regardera dix secondes. On demande donc
     un rayon autour du centre plutôt que l'emprise entière, et beaucoup moins
     d'objets. La profondeur est réservée à l'endroit où l'on est vraiment. */
  const regl = o.reglages || REGIMES[regimePoint(lat, lng)];
  const large = regl === REGIMES.local;
  const travaux = [
    vraisLieux(lat, lng, large ? bornesVisibles() : null,
      {signal, cats:o.cats, delai:o.delai, rayon:regl.rayon, limite:regl.limite}).then(r=>{
      if(!generationCourante(generation)) return;
      if(r && r.ok){
        overpassEchecsConsecutifs = 0;
        // Une zone ne devient « vue » qu'après une réponse Overpass valide,
        // y compris une réponse vide légitime. Une panne reste donc retentable.
        zonesVues.add(cle);
        if(!o.cats) dernierChargement = [lat,lng];
        definirEtatRechercheVersionne("overpass",SEARCH_STATES.SUCCESS,generation);
        if(r.lieux.length){
          sourceExploitable = true;
          fusionner(r.lieux);
          if(!o.cats) ecrireCacheLieux(lat,lng,r.lieux);
          PERF.jalon("fresh_pois_ready");
        }
      }else{
        if(!r || r.raison !== "annule") overpassEchecsConsecutifs += 1;
        definirEtatRechercheVersionne("overpass",SEARCH_STATES.OVERPASS_UNAVAILABLE,generation);
      }
      PERF.jalon("overpass_done");
      try{
        const fin = "zone:osm:"+generation.id;
        performance.mark(fin);
        performance.measure("lieux OpenStreetMap", marqueDebut, fin);
      }catch(e){}
    })
  ];
  /* Une source touristique complémentaire, en parallèle d'OSM : elle ne
     bloque jamais l'écran et son échec garde exactement les données déjà là.
     La passe générale suffit ; rouvrir une catégorie ne redemande pas les
     mêmes cinquante POI touristiques. */
  if(!o.cats && !o.osmSeulement) travaux.push(
    lieuxDatatourisme(lat,lng,signal).then(r=>{
      if(!generationCourante(generation) || !r || !r.length) return;
      sourceExploitable = true;
      fusionner(r,"datatourisme");
      PERF.jalon("datatourisme_done");
    })
  );
  /* Les découvertes ancrées, en dernier et sans jamais retenir personne. Elles
     ne comptent pas comme « source exploitable » : l'écran ne doit pas
     dépendre d'elles pour décider s'il a quelque chose à montrer. */
  if(!o.cats && !o.osmSeulement) travaux.push(
    decouvertesAncrees(lat,lng,signal).then(r=>{
      if(!generationCourante(generation) || !r || !r.length) return;
      fusionner(r,"external");
      PERF.jalon("decouvertes_done");
    })
  );
  /* Places complète les candidats courants seulement lorsque la carte Google
     est réellement active. L'échec reste isolé : OSM, DATAtourisme et les
     publications continuent sans écran vide. */
  if(!o.cats && !o.osmSeulement && large) travaux.push(
    notesGoogle(lat,lng,{signal}).then(f=>{
      if(!generationCourante(generation) || !f || !f.length) return;
      sourceExploitable = true;
      greffeNotes(lieux,f);
      ajouterLieuxGoogle(f);
      PERF.jalon("google_pret");
    })
  );
  if(!o.cats && !o.osmSeulement) travaux.push(
    chargerCoucheSupabase(lat,lng).then(couche=>{
      if(!generationCourante(generation) || !couche) return;
      if((couche.publications || []).length){
        sourceExploitable = true;
        PERF.jalon("supabase_publications_ready");
      }
      if((couche.evenements || []).length){
        sourceExploitable = true;
        PERF.jalon("supabase_evenements_ready");
      }
    })
  );
  let promesse;
  promesse = Promise.allSettled(travaux).finally(()=>{
    if(chargementsZone.get(cle) === promesse) chargementsZone.delete(cle);
    chargementEnCours = chargementsZone.size > 0;
    if(generationCourante(generation)){
      if(!o.osmSeulement) definirEtatRechercheVersionne("places",sourceExploitable || lieux.length
        ? SEARCH_STATES.SUCCESS : SEARCH_STATES.EMPTY,generation);
      terminerGeneration(generation);
    }
  });
  promesse.generation = generation;
  chargementsZone.set(cle, promesse);
  return promesse;
}

/* Un besoin ouvert va chercher ce qui lui manque, et seulement ça. */
/* ---- Préchargement --------------------------------------------------------
   Pendant qu'on regarde l'écran d'accueil, on va chercher ce qu'on ouvrira
   probablement ensuite. L'ordre vient du profil d'usage réel quand il existe,
   sinon des besoins principaux. Jamais bloquant, jamais prioritaire sur le
   premier affichage. */
function categoriesProbables(){
  const comptees = (personnalisation && PROFIL && PROFIL.categories) || {};
  const parUsage = Object.keys(comptees).sort((a,b)=>comptees[b]-comptees[a]);
  const parDefaut = BESOINS_PRINCIPAUX.flatMap(b=>b.sous ? b.sous.flatMap(x=>x.cats) : []);
  // les favoris disent aussi ce qui compte pour cette personne
  const parFavoris = [...favorisEnMemoire.values()].map(l=>l && l.cat).filter(Boolean);
  return [...new Set([...parFavoris, ...parUsage, ...parDefaut])];
}

let prechargementFait = false;
let prechargementEnCours = false;
const PRECHARGEMENT_CATEGORIES_MAX = 2;
function prechargerCategories(){
  if(prechargementFait || prechargementEnCours || !map || overpassEchecsConsecutifs > 0) return;
  const transports = new Set(["bus","metro","tram","train"]);
  const manquantes = categoriesProbables()
    .filter(c=>!transports.has(c) && !categorieEnMemoire(c))
    .slice(0,PRECHARGEMENT_CATEGORIES_MAX);
  if(!manquantes.length) return;
  prechargementEnCours = true;
  chargerPourCats(manquantes).then(()=>{
    /* Une tentative n'est pas un chargement. On ne pose cette marque qu'après
       qu'au moins une catégorie ait réellement reçu un lieu exploitable. */
    prechargementFait = manquantes.some(c=>categorieEnMemoire(c));
    if(prechargementFait) PERF.jalon("fresh_pois_ready");
  }).finally(()=>{ prechargementEnCours = false; });
}

function chargerPourCats(cats){
  if(!map || !cats || !cats.length) return Promise.resolve([]);
  // Changer de catégorie ne doit rien redemander si les lieux sont déjà là :
  // c'est la différence entre un onglet instantané et deux secondes d'attente.
  const manquantes = cats.filter(c=>!categorieEnMemoire(c));
  if(!manquantes.length) return Promise.resolve([]);
  const c = map.getCenter();
  return chargerZone(c.lat, c.lng, {cats:manquantes});
}

const chargementsTemporaires = new Map();
const derniersChargementsTemporaires = new Map();
function chargerDonneesTemporaires(lat, lng, opts){
  const o = opts || {};
  const cle = lat.toFixed(2)+","+lng.toFixed(2);
  if(!o.force && chargementsTemporaires.has(cle)) return chargementsTemporaires.get(cle);
  const dernier = derniersChargementsTemporaires.get(cle) || 0;
  if(!o.force && Date.now()-dernier < 5*60*1000) return Promise.resolve([]);
  const generation = nouvelleGeneration("donnees:temporaires",cle,!!o.force);
  prendreEtatRecherche("events",generation);
  if(generationCourante(generation)){
    definirEtatRechercheVersionne("events",SEARCH_STATES.LOADING_EVENTS,generation);
    charge("Recherche des événements autour de ce point…");
  }
  let sourceExploitable = false;
  const travaux = [
    evenementsOpenAgenda(lat,lng).then(ev=>{
      if(!generationCourante(generation) || !Array.isArray(ev)) return;
      sourceExploitable = true;
      if(ev.length) fusionner(ev,"external");
    })
  ];
  /* Les deux RPC forment une seule couche territoriale : elle possède une
     requête en vol, une publication et une reconstruction de collection. */
  travaux.push(
    chargerCoucheSupabase(lat,lng).then(couche=>{
      if(!generationCourante(generation) || !couche) return;
      sourceExploitable = couche.okPublications || couche.okEvenements ||
        !!couche.depuisCache || sourceExploitable;
    })
  );
  let promesse;
  promesse = Promise.allSettled(travaux).then(resultats=>{
    if(!generationCourante(generation)) return;
    const erreurs = resultats.filter(x=>x.status === "rejected").length;
    if(erreurs === resultats.length) definirEtatRechercheVersionne("events",SEARCH_STATES.NETWORK_ERROR,generation);
    else if(erreurs) definirEtatRechercheVersionne("events",SEARCH_STATES.PARTIAL_ERROR,generation);
    else definirEtatRechercheVersionne("events",SEARCH_STATES.SUCCESS,generation);
    if(sourceExploitable) derniersChargementsTemporaires.set(cle,Date.now());
  }).finally(()=>{
    if(chargementsTemporaires.get(cle) === promesse) chargementsTemporaires.delete(cle);
    if(generationCourante(generation)){
      charge(null);
      planifierRendu({accueil:true, feuille:true});
      terminerGeneration(generation);
    }
  });
  chargementsTemporaires.set(cle, promesse);
  return promesse;
}

function chargerAutourDuPoint(lat, lng, opts){
  const o = opts || {};
  return Promise.allSettled([
    chargerZone(lat,lng,{force:!!o.force}),
    chargerDonneesTemporaires(lat,lng,{force:!!o.force})
  ]);
}

const chargementsEditoriaux = new Map();
function chargerEditorial(type){
  if(!map) return Promise.resolve([]);
  const c = map.getCenter();
  const cle = type+":"+c.lat.toFixed(2)+","+c.lng.toFixed(2);
  if(chargementsEditoriaux.has(cle)) return chargementsEditoriaux.get(cle);
  const cats = type === "family" ? ["cinema","parc","terrain","musee","biblio"]
    : type === "cinema" ? ["cinema"] : [];
  charge(type === "family" ? "Recherche des sorties en famille…"
    : type === "cinema" ? "Recherche des cinémas et projections…"
    : "Recherche des événements autour de toi…");
  const travaux = [chargerDonneesTemporaires(c.lat,c.lng)];
  if(cats.length) travaux.push(chargerZone(c.lat,c.lng,{cats}));
  const promesse = Promise.allSettled(travaux).finally(()=>{
    chargementsEditoriaux.delete(cle);
    charge(null);
    rendre(); majAccueil(); majFeuille2();
  });
  chargementsEditoriaux.set(cle, promesse);
  return promesse;
}

/* ---- La ville, connue avant que la page ne s'exécute ----------------------
   À froid, sans rien en mémoire, Autour ne savait pas où il était et devait
   attendre `navigator.geolocation` : une permission, puis un point GPS — entre
   deux cents millisecondes et huit secondes, et très souvent jamais. Rien ne
   pouvait être proposé avant, puisque « autour de toi » suppose un « toi ».

   Le serveur, lui, connaît la ville approximative de qui demande la page. Il
   la dépose dans un cookie sur la réponse qui porte `index.html` (voir
   `middleware.js`) : elle est donc lisible ICI, à l'analyse du script, sans un
   aller-retour de plus et sans rien demander.

   C'est la VILLE, pas la position : à quelques kilomètres près. On le note
   (`originePrecision`), et tout ce qui prétendrait à mieux — « à 4 minutes à
   pied » — attend le vrai point. */
function positionServeur(){
  try{
    const brut = (document.cookie.match(/(?:^|;\s*)autour_geo=([^;]*)/) || [])[1];
    if(!brut) return null;
    const o = JSON.parse(decodeURIComponent(brut));
    if(!o || !Number.isFinite(o.lat) || !Number.isFinite(o.lng)) return null;
    if(Math.abs(o.lat) > 90 || Math.abs(o.lng) > 180) return null;
    return o;
  }catch(e){ return null; }
}

/* Dernière position connue : évite de démarrer à Paris quelqu'un qui vit à
   Tourcoing, et permet d'afficher une carte utile avant toute géolocalisation. */
function positionMemorisee(){
  try{
    const v = JSON.parse(localStorage.getItem("autour:position")||"null");
    if(v && Math.abs(v[0])<=90 && Math.abs(v[1])<=180) return v;
  }catch(e){}
  return null;
}

/* Repli cartographique neutre quand aucune position, IP ou ville n'est connue.
   Ce point ne sert jamais à demander ou classer des données : il permet juste
   à la carte et à la recherche de rester utilisables sans favoriser une ville. */
const CENTRE_CARTE_FRANCE = [46.603354, 1.888334];

/* Point reproductible pour les contrôles locaux. Ignoré sur le site public,
   il permet de tester Tourcoing sans détourner la vraie géolocalisation. */
function positionLocaleDeTest(){
  if(!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return null;
  const valeur = new URLSearchParams(location.search).get("testPosition");
  if(!valeur) return null;
  const [lat,lng] = valeur.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat)<=90 && Math.abs(lng)<=180
    ? [lat,lng] : null;
}
/* La dernière position réelle. « Réelle » veut dire mesurée par le navigateur :
   une ville déduite d'une adresse IP n'entre JAMAIS ici. Sinon elle
   ressortirait au démarrage suivant déguisée en position mémorisée, et
   l'erreur deviendrait permanente — c'est précisément ce qu'on corrige. */
function memoriserPosition(c, source){
  if(source !== "gps") return false;
  try{ localStorage.setItem("autour:position", JSON.stringify(c)); return true; }
  catch(e){ return false; }
}

/* Safari ne répond pas à `navigator.permissions.query({name:"geolocation"})`.
   On garde donc trace de la réponse qu'il nous a déjà donnée : si la
   localisation a abouti au moins une fois sur cet appareil, elle aboutira
   encore sans redemander, et on peut la relancer d'office au démarrage.
   Un refus efface la trace — on ne harcèle pas quelqu'un qui a dit non. */
const CLE_GEO_OK = "autour:geo-autorisee";
function noterAutorisationGeo(ok){
  try{ if(ok) localStorage.setItem(CLE_GEO_OK, "1");
       else localStorage.removeItem(CLE_GEO_OK); }catch(e){}
}
function geoDejaAutorisee(){
  try{ return localStorage.getItem(CLE_GEO_OK) === "1"; }catch(e){ return false; }
}

/* L'onboarding reste volontairement distinct de l'autorisation navigateur :
   une seule petite valeur locale suffit à ne pas rejouer la séquence à chaque
   ouverture. Les coordonnées et le reste du fonctionnement de la carte ne
   dépendent pas de cette valeur. */
const CLE_ONBOARDING_LOCALISATION = "autour:onboarding-localisation";
const ETAPES_ONBOARDING = Object.freeze({BIENVENUE:"bienvenue", LOCALISATION:"localisation", TERMINE:"termine"});
let etapeOnboarding = null;

function lireEtapeOnboarding(){
  try{
    const etape = localStorage.getItem(CLE_ONBOARDING_LOCALISATION);
    return Object.values(ETAPES_ONBOARDING).includes(etape) ? etape : null;
  }catch(e){ return null; }
}
function memoriserEtapeOnboarding(etape){
  etapeOnboarding = etape;
  try{ localStorage.setItem(CLE_ONBOARDING_LOCALISATION, etape); }catch(e){}
}

const TEXTES_ONBOARDING = Object.freeze({
  bienvenue: {texte:"👋 Bienvenue sur Autour", action:"Commencer"},
  localisation: {texte:"📍 Autoriser votre localisation", action:"Autoriser"},
  preparation: {texte:"Autour prépare déjà autour de toi", action:null},
});
let onboardingTimer = null;

function afficherOnboarding(etape){
  const panneau = $("#onboardingLocalisation");
  const texte = $("#onboardingTxt");
  const action = $("#onboardingAction");
  const avatars = $("#onboardingAvatars");
  const contenu = TEXTES_ONBOARDING[etape];
  if(!panneau || !texte || !action || !contenu) return;
  clearTimeout(onboardingTimer);
  etapeOnboarding = etape;
  texte.textContent = contenu.texte;
  action.textContent = contenu.action || "";
  action.hidden = !contenu.action;
  if(avatars){
    if(!avatars.childElementCount){
      avatars.innerHTML = AVATARS_ONBOARDING.map((avatar)=>
        '<button type="button" data-avatar="'+esc(avatar)+'" ' +
          'aria-label="Choisir cet avatar" aria-pressed="false">'+avatar+'</button>'
      ).join("");
      avatars.querySelectorAll("[data-avatar]").forEach((bouton)=>{
        bouton.onclick = ()=>sauvegarderAvatar(bouton.dataset.avatar);
      });
    }
    avatars.hidden = etape !== "bienvenue";
    avatars.querySelectorAll("[data-avatar]").forEach((bouton)=>{
      bouton.setAttribute("aria-pressed", String(bouton.dataset.avatar === avatarChoisi()));
    });
  }
  panneau.hidden = false;
  if(etape === "preparation"){
    onboardingTimer = setTimeout(()=>{
      if(etapeOnboarding === "preparation") panneau.hidden = true;
    }, 1600);
  }
}
function cacherOnboarding(){
  clearTimeout(onboardingTimer);
  etapeOnboarding = lireEtapeOnboarding();
  const panneau = $("#onboardingLocalisation");
  if(panneau) panneau.hidden = true;
}
function terminerOnboardingLocalisation(resultat){
  memoriserEtapeOnboarding(ETAPES_ONBOARDING.TERMINE);
  cacherOnboarding();
  toast(resultat === "ok" ? "✓ C’est prêt" : "🧭 On continue sans position précise");
}

/* L'état réel de la permission, avec le repli qu'impose Safari. */
async function permissionPosition(){
  if(!navigator.geolocation) return "absent";
  try{
    if(navigator.permissions && navigator.permissions.query){
      const p = await navigator.permissions.query({name:"geolocation"});
      if(p && p.state) return p.state;          // granted | prompt | denied
    }
  }catch(e){ /* pas de réponse : on retombe sur ce qu'on a mémorisé */ }
  return geoDejaAutorisee() ? "granted" : "prompt";
}

/* ---- La carte, séparée du reste --------------------------------------------
   Leaflet vient d'un CDN : c'est la seule pièce d'Autour qu'un tiers peut
   retarder ou faire disparaître. Tant qu'elle était construite au milieu du
   démarrage, elle décidait de tout — un CDN lent repoussait les
   recommandations, un CDN muet laissait un écran de panne alors que le cache
   local contenait de quoi remplir la feuille.

   La carte est donc devenue une couche parmi d'autres : elle s'installe quand
   elle peut, éventuellement jamais, et le reste de l'application ne s'en
   aperçoit pas. */
/* ---- La carte, jamais appelée à vide -------------------------------------
   Leaflet vient d'un CDN et s'installe APRÈS le contenu essentiel : entre
   l'ouverture de l'application et son arrivée, il existe une fenêtre — courte
   sur fibre, longue sur un téléphone en 4G — pendant laquelle `map` n'existe
   pas. Une trentaine d'endroits l'appelaient directement ; dans cette fenêtre,
   ils levaient `undefined is not an object (evaluating 'map.flyTo')`. Sur
   mobile Safari, l'exception remontait jusqu'à l'écran.

   Une seule porte, donc. `surLaCarte(action)` exécute tout de suite si la
   carte est là, et sinon met l'action de côté pour la rejouer à l'installation.
   Rien n'est perdu, rien n'échoue, et si Leaflet ne vient jamais l'application
   continue sans carte — ce qu'elle sait déjà faire.

   La `cle` sert à ne pas rejouer un historique : dix déplacements empilés
   pendant le chargement, seul le dernier a du sens. */
const enAttenteDeCarte = [];
const ATTENTE_CARTE_MAX = 12;

function surLaCarte(action, cle){
  if(map){
    try{ action(map); }catch(e){ console.error("Autour · carte :", e); }
    return true;
  }
  if(cle){
    for(let i = enAttenteDeCarte.length - 1; i >= 0; i -= 1)
      if(enAttenteDeCarte[i].cle === cle) enAttenteDeCarte.splice(i, 1);
  }
  enAttenteDeCarte.push({action, cle});
  while(enAttenteDeCarte.length > ATTENTE_CARTE_MAX) enAttenteDeCarte.shift();
  return false;
}

function rejouerSurLaCarte(){
  const file = enAttenteDeCarte.splice(0, enAttenteDeCarte.length);
  file.forEach(({action})=>{
    try{ action(map); }catch(e){ console.error("Autour · carte différée :", e); }
  });
}

/* Le SEUL déplacement de carte de toute l'application. `zoom` accepte une
   fonction, pour exprimer « au moins 17 » sans lire `map.getZoom()` avant que
   la carte n'existe. */
function allerVers(coords, zoom, opts){
  const lat = coords && Number(coords[0]), lng = coords && Number(coords[1]);
  if(!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return surLaCarte((m)=>{
    const z = typeof zoom === "function" ? zoom(m) : zoom;
    m.flyTo([lat, lng], z == null ? m.getZoom() : z, Object.assign({duration:.7}, opts));
  }, "deplacement");
}

/* Cadrer une emprise : même règle, même file d'attente. */
function cadrerSur(bornes, opts){
  if(!bornes) return false;
  return surLaCarte((m)=>m.fitBounds(bornes, opts), "deplacement");
}

/* Lectures sûres : elles servent à décider, pas à afficher, et doivent donc
   rendre une valeur plausible même sans carte. */
function zoomCarte(defaut){ return map ? map.getZoom() : (defaut == null ? 16 : defaut); }
/* Le point que la carte regarde, sous la forme `{lat, lng}` qu'attendent les
   appelants. Sans carte, c'est la position — jamais une exception. */
function pointCarte(){
  if(map) return map.getCenter();
  const p = positionMoi || [0,0];
  return {lat:p[0], lng:p[1]};
}
/* Retirer le tracé d'itinéraire, avec ou sans carte. */
function effacerLignes(){
  const couches = ligneCouches;
  ligneCouches = [];
  if(!couches.length) return;
  surLaCarte((m)=>couches.forEach(c=>{ try{ m.removeLayer(c); }catch(e){} }));
}
function centreCarte(){
  if(!map) return positionMoi;
  const c = map.getCenter();
  return [c.lat, c.lng];
}

let carteEnAttente = null;

/* La feuille de style de Leaflet n'est plus bloquante — c'est ce qui a rendu
   le premier écran instantané, et on le garde. Mais elle ne fait pas que du
   décor : `.leaflet-pane{position:absolute}` et `.leaflet-container{overflow
   :hidden}` sont ce qui donne aux tuiles un endroit où se placer. Une carte
   construite avant elle pose ses tuiles dans le flux normal, décalées par le
   translate3d de Leaflet — c'est-à-dire nulle part. Le conteneur existait,
   l'attribution aussi, et les tuiles étaient invisibles.

   On attend donc la feuille de style avant de construire la carte. Elle vient
   du même CDN que leaflet.js, en général avant lui ; et si le CDN reste muet,
   le garde-fou ci-dessous la débloque pour que l'absence de style ne coûte
   jamais la carte elle-même. */
const CSS_CARTE_ATTENTE_MAX = 3000;
function lienStyleCarte(){ return document.querySelector('link[data-leaflet-css]'); }
function styleCartePret(){
  const lien = lienStyleCarte();
  if(!lien) return true;                       // pas de lien : rien à attendre
  return lien.media === "all";
}
/* Appelé par l'attribut `onload` du lien, et par le garde-fou. */
window.AutourCarteRemesurer = ()=>{
  try{
    if(map) map.invalidateSize();
    else installerCarte();                     // la carte n'attendait que ça
  }catch(e){ console.error("Autour · carte :", e); }
};
setTimeout(()=>{
  const lien = lienStyleCarte();
  if(lien && lien.media !== "all"){
    journal.warn("Feuille Leaflet lente : la carte s'installe sans attendre");
    lien.media = "all";
  }
  window.AutourCarteRemesurer();
}, CSS_CARTE_ATTENTE_MAX);

function installerCarte(){
  if(map || typeof L === "undefined" || !carteEnAttente) return false;
  if(!styleCartePret()) return false;          // rappelé par le `onload` du lien
  const {centre, partage} = carteEnAttente;
  carteEnAttente = null;
  PERF.jalon("map_init_debut");

  // ni contrôle de zoom, ni bandeau Leaflet : la carte doit se lire comme un
  // fond d'application. L'attribution reste due — elle est écrite en bas à
  // gauche (#attribution), le détail complet derrière le « ⓘ ».
  map = L.map("map",{zoomControl:false, attributionControl:false, tap:false, preferCanvas:true})
        .setView(centre, partage ? 17 : 16);
  const fournisseurGoogle = window.AutourMapProviders && AutourMapProviders.googleMaps;
  if(fournisseurGoogle && fournisseurGoogle.estActif()) fournisseurGoogle.lierLeaflet(map);
  map.createPane("villePane"); map.getPane("villePane").style.zIndex = 200;
  map.createPane("ruesPane");  map.getPane("ruesPane").style.zIndex = 350;
  map.getPane("ruesPane").style.pointerEvents = "none";

  PERF.jalon("map_ready");
  PERF.mesure("carte", "map_init_debut", "map_ready");
  coucheVille = L.layerGroup().addTo(map);

  /* Sans GPS, IP ou ville choisie, la carte reste consultable mais le point
     bleu n'est pas inventé. Il était auparavant posé à Tourcoing, ce qui
     transformait un simple repli technique en localisation affirmée. */
  if(positionMoi){
    moi = L.marker(positionMoi,{
      icon:L.divIcon({className:"mk mk-user",
        html:'<span class="moi-in"><i></i><b></b></span>', iconSize:[46,46], iconAnchor:[23,23]}),
      interactive:true, keyboard:true, title:"Vous êtes ici", zIndexOffset:400
    }).addTo(map);
    moi.on("click", ()=>toast("Vous êtes ici"));
  }

  document.body.classList.toggle("loin", map.getZoom() < 15);
  let minuteurRendu;
  /* CE QUE « LA VUE A CHANGÉ » VEUT DIRE.

     Pas « le centre a bougé d'un pixel ». Un doigt qui repose la carte trente
     mètres plus loin regarde exactement la même chose : reclasser, recomposer
     les marqueurs et redemander la zone pour ça, c'est dépenser une demi-
     seconde de fil principal pour un écran identique.

     L'empreinte de vue est donc le centre arrondi à environ cent mètres et le
     niveau de zoom. Tant qu'elle ne change pas, rien ne repart — ni le rendu,
     ni le réseau. Dès qu'elle change, tout repart normalement. */
  let empreinteVue = null;
  const empreinteDeLaVue = ()=>{
    const c = map.getCenter();
    return c.lat.toFixed(3)+","+c.lng.toFixed(3)+"@"+map.getZoom();
  };
  map.on("moveend zoomend", ()=>{
    const fournisseurGoogleActif = window.AutourMapProviders && AutourMapProviders.googleMaps;
    if(fournisseurGoogleActif) fournisseurGoogleActif.synchroniserDepuisLeaflet(map);
    document.body.classList.toggle("loin", map.getZoom() < 15);
    /* PENDANT UN GESTE GOOGLE, ON NE RECOMPOSE PAS À CHAQUE IMAGE.

       Chaque image du geste appelle `setView` pour garder les marqueurs collés
       à leur rue — ça, on le garde. Mais recomposer épaisseurs, étiquettes,
       boutons et collisions à chaque image, c'est la saccade elle-même : mesuré
       à 182 `resoudreCollisions` pour un déplacement de trois secondes. Le
       fournisseur réconcilie tout à `idle` (un dernier `setView` hors geste),
       et c'est là que cette cascade s'exécute — une fois. L'alignement ne
       bouge pas ; seul le travail redondant disparaît. */
    if(fournisseurGoogleActif && fournisseurGoogleActif.enGeste && fournisseurGoogleActif.enGeste())
      return;
    majEpaisseurs(); majEtiquettes(); majBoutons(); planifierCollisions();
    // temporisation : recomposer 400 marqueurs à chaque micro-déplacement
    // faisait saccader la carte sur téléphone
    // on ne relance rien tant que la carte bouge : un balayage de trois
    // secondes déclenchait une dizaine de requêtes pour un seul quartier
    clearTimeout(minuteurRendu);
    minuteurRendu = setTimeout(()=>{
      const vue = empreinteDeLaVue();
      if(vue === empreinteVue) return;   // même vue : rien à refaire
      empreinteVue = vue;
      rendre();                          // les grappes suivent le zoom
      const c = map.getCenter();
      chargerZone(c.lat, c.lng);         // et le quartier exploré se remplit
      chargerDonneesTemporaires(c.lat, c.lng);
      if(catsActives) chargerPourCats([...catsActives]);
      /* LA FEUILLE SUIT LA CARTE, MÊME QUAND AUCUNE DONNÉE N'ARRIVE.

         « Maintenant » et le classement se calculent depuis le point regardé.
         Déplacer la carte sur une autre ville change donc leur réponse — mais
         seul l'arrivée de nouvelles données déclenchait un rendu de la
         feuille. Quand la zone était déjà en cache, rien n'arrivait, rien ne
         se redessinait, et le bloc continuait d'afficher « rien en cours près
         de toi » au-dessus d'une carte pleine d'événements en cours. */
      planifierRendu({accueil:true, feuille:true});
      /* Le contexte territorial suit le point regardé — et il décide LUI-MÊME
         s'il faut réévaluer. Un déplacement de trente mètres ne déclenche
         rien ; quatre cents mètres ou un changement de zone, oui. Et
         réévaluer ne veut jamais dire rappeler une source. */
      reevaluerTerritorial();
    }, 350);
  });
  // toucher la carte referme la feuille : la carte reprend tout l'écran
  map.on("click", ()=>{ if(feuilleNiveau !== null) fermerFeuille2(); });
  window.addEventListener("autour:google-map-click", ()=>{ if(feuilleNiveau !== null) fermerFeuille2(); });

  // tout ce qui a été demandé pendant l'absence de carte se joue maintenant
  rejouerSurLaCarte();
  // les marqueurs n'existaient pas tant que la carte n'était pas là
  planifierRendu({carte:true});

  /* Le fond de carte part MAINTENANT, pas au premier temps mort.
     Il avait été confié à `quandLibre()` pendant la passe « instant-first »,
     avec l'idée qu'un fond de carte est du décor. C'était une erreur de
     raisonnement : les tuiles ne coûtent rien au fil principal — elles sont
     décodées par le navigateur, en parallèle, hors du chemin critique — mais
     leur DEMANDE, elle, était derrière un `requestIdleCallback` sans
     échéance. Résultat : la zone cartographique existait, l'attribution
     s'affichait (c'est notre propre élément), et aucune tuile n'était jamais
     réclamée. On revient au comportement d'avant : `poserFond()` est appelé
     dans la foulée de `L.map()`, exactement comme il l'était dans `demarrer()`. */
  (promesseCarteGoogle || Promise.resolve(false)).then(googleActif=>{
    const fournisseur = window.AutourMapProviders && AutourMapProviders.googleMaps;
    if(googleActif && fournisseur && fournisseur.estActif && fournisseur.estActif()) return;
    return remettreFondAutonome();
  });
  return true;
}

/* Le CDN peut avoir répondu avant nous, arriver plus tard, ou ne jamais
   arriver. Les trois cas mènent au même endroit : l'application marche. */
function attendreLeaflet(){
  if(installerCarte()) return;
  let balise = document.querySelector('script[data-leaflet]');
  if(!balise){
    /* Le script faisait partie du HTML avec `async`. Cela évitait le blocage
       de l'analyse, mais pas la concurrence réseau ni le coût de parsing : sur
       mobile, Leaflet arrivait parfois avant l'application et occupait le fil
       principal avant la première peinture. La carte est un décor, donc on la
       demande seulement ici, après le rendu initial. */
    balise = document.createElement("script");
    balise.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js";
    balise.async = true;
    balise.dataset.leaflet = "";
    document.head.appendChild(balise);
  }
  if(balise.dataset.autourEcoute === "1") return;
  balise.dataset.autourEcoute = "1";
  balise.addEventListener("load", ()=>{ installerCarte(); });
  balise.addEventListener("error", ()=>{
    carteEnAttente = null;
    journal.warn("Leaflet indisponible : Autour continue sans carte");
    toast("Carte indisponible · les propositions restent affichées");
  });
}

async function demarrer(coords){
  PERF.jalon("boot_debut");
  /* Sans position connue, l'application affichait Paris et l'annonçait comme
     « autour de toi », puis « rien d'ouvert autour de toi ». Elle affirmait
     deux choses fausses : qu'elle savait où on est, et qu'il n'y a rien.
     On garde un point de départ pour que la carte existe, mais on note que
     personne ne l'a choisi — et tout ce qui parle de « autour de toi » lit
     ce drapeau. */
  /* La hiérarchie de la position, par ordre de vérité décroissante.

     1. La dernière position GPS mémorisée. C'est une mesure réelle du
        navigateur, éventuellement d'il y a quelques heures : on la préfère
        toujours à l'IP, et on la rafraîchit tout de suite.
     2. La ville déduite de l'adresse IP. Elle sert UNIQUEMENT à choisir la
        bonne zone de données pour que l'écran se remplisse vite. Elle ne dit
        pas où est la personne, et l'interface ne le prétendra pas.
     3. Rien. Et on le dit, plutôt que d'afficher une ville au hasard.

     Aucune de ces trois n'attend le réseau ni une permission. */
  const duServeur = coords ? null : positionServeur();
  if(coords){
    originePosition = "gps"; precisionPosition = "point"; positionMoi = coords;
    PERF.jalon("position_gps_memorisee");
  }
  else if(duServeur){
    originePosition = "server"; precisionPosition = "ville";
    positionMoi = [duServeur.lat, duServeur.lng];
    // le nom sert à chercher les agendas et à étiqueter des adresses ; il n'est
    // jamais affiché comme « tu es ici » tant que la précision est « ville »
    if(duServeur.ville) commune = duServeur.ville;
    PERF.jalon("position_server");
  }
  else {
    originePosition = null; precisionPosition = null;
    positionMoi = null; commune = COMMUNE_INCONNUE;
  }
  PERF.jalon("position_" + (originePosition || "inconnue"));
  // un lien partagé décide de ce qu'on regarde, sans toucher à ta position
  const partage = lieuPartage();
  // un lien vers un événement ne porte pas de coordonnées : on reste sur la
  // position connue et c'est `ouvrirLieuPartage` qui recadre à l'arrivée
  const centre = partage && partage.lat != null
    ? [partage.lat, partage.lng] : (positionMoi || CENTRE_CARTE_FRANCE);
  carteEnAttente = {centre, partage};
  // Google Maps est un décor optionnel. Sa demande part après la première
  // peinture, afin que son SDK ne concurrence pas l'interface sur mobile.
  // `notesGoogle` attend cette promesse : aucun contenu Places n'est injecté
  // tant que la vraie carte Google n'est pas prête sous les marqueurs Autour.
  apresPeinture(()=>preparerCarteGoogle(centre, partage ? 17 : 16));

  /* La coquille — en-tête, navigation, bouton Aide, attribution — n'est plus
     masquée dans le HTML. Elle l'était, et c'était JavaScript qui la révélait :
     le navigateur avait donc tout ce qu'il fallait pour peindre l'écran, et
     attendait quand même l'analyse de trois cent soixante kilo-octets de
     script pour le faire. Mesuré sur un réseau mobile : sept cent cinquante
     millisecondes d'écran vide alors que la page était arrivée.

     Elle est désormais peinte dès que la feuille de style est lue. Cette ligne
     reste : elle sert au retour de navigation et à la sortie du mode pose, où
     ces éléments ont bel et bien été masqués. */
  ["#appHeader","#navBas","#btnAide","#btnTransports","#attribution"]
    .forEach(s=>$(s).hidden=false);
  PERF.jalon("ui_ready");         // l'écran est lisible et interactif
  majEnteteLieu();
  mesurerHeader();

  /* ÉTAPE 1 — ce qui s'affiche sans rien attendre.
     Le jeu rapide contient les propositions de la dernière session : elles
     sont posées telles quelles, dans leur ordre, avant tout classement et
     avant la carte. C'est ce que la personne voit à la première image. */
  /* À L'OUVERTURE, LA ZONE ACTIVE EST LA POSITION. C'est la seule fois où elle
     se pose toute seule ; ensuite il faut une recherche de ville ou « Revenir
     autour de moi » pour qu'elle bouge. Elle est posée AVANT le jeu rapide :
     celui-ci vient de la session précédente, et si la personne a déménagé de
     ville entre-temps, ses lieux ne doivent pas s'afficher ici. */
  if(CTX && positionMoi && !zoneActive) definirZoneActive(CTX.zoneMoi(positionMoi, commune));

  const rapide = positionMoi ? lireJeuRapide(positionMoi[0], positionMoi[1]) : null;
  if(rapide){
    if(rapide.commune) commune = rapide.commune;
    fusionner(rapide.lieux, "permanent", {silencieux:true});
    selectionAccueil = rapide.choisis;
  }
  dessinerFiltres();
  majRaccourcis(); majFiltres();   // quatre raccourcis, rien de plus ne s'ouvre

  /* L'accueil s'ouvre TOUT DE SUITE. Il attendait la réponse d'Overpass — une
     à trois secondes de carte nue devant quelqu'un qui vient d'arriver, ce qui
     se lit comme une application vide. */
  if(feuilleNiveau === null && !modeNav && !modePose){
    if(rapide) ouvrirFeuille2("racine");   // les cartes du jeu rapide, intactes
    else ouvrirAccueilFeuille();
  }
  if(rapide){ PERF.jalon("premier_lieu"); PERF.jalon("source_locale"); }

  /* Rien en mémoire : c'est le tout premier démarrage. On va chercher le jeu
     pré-calculé de la zone TOUT DE SUITE — avant la peinture, parce que c'est
     une requête, pas un calcul : elle part maintenant et répondra pendant que
     le reste s'installe. C'est le seul chemin qui donne une proposition à
     froid sans dépendre d'Overpass, de Nominatim ni d'une permission. */
  if(!rapide && positionMoi) demarrerSurZonePrecalculee(positionMoi[0], positionMoi[1]);

  /* ÉTAPE 2 — on rend la main au navigateur. Tout ce qui suit coûte du fil
     principal ou du réseau ; le faire avant la première peinture revenait à
     garder l'écran blanc pendant qu'on préparait ce qu'il devait montrer. */
  apresPeinture(()=>chargerLeDemarrage(rapide));

  /* ÉTAPE 3 — les écrans qu'on n'a pas encore ouverts. Le démarrage a rendu
     la main ; la tranche d'inactivité, elle, attend que le fil principal soit
     libre. Le module arrive donc APRÈS le premier écran utile, et bien avant
     le premier appui d'une vraie personne. */
  prechargerEcrans();

  /* ÉTAPE 4 — « Pour toi ». Il relit les événements déjà chargés, sans une
     seule requête de plus, et n'a donc aucune raison de passer avant la
     carte. */
  amorcerPourToi();

  /* ÉTAPE 5 — le contexte territorial temporaire. Il arrive en DERNIER, et
     c'est la place qui lui revient : sans lui, Autour est exactement Autour.
     Le cache long répond en général sans réseau — un périmètre ne change pas
     de la semaine — et une panne de la lecture ne fait rien apparaître, ce qui
     est le bon comportement.

     Le mode ne s'ouvre pas tout seul pour autant : le bouton apparaît, et
     c'est une personne qui décide. */
  if(TERR) apresPeinture(()=>{
    chargerContextesTerritoriaux().then(()=>{
      if(majContexteTerritorial() || boutonTerritorial()) planifierRendu({accueil:true, feuille:true});
    }).catch(()=>{});
  });
}

/* Le jeu de zone arrive et remplace le squelette, sans rien vider : s'il est
   déjà passé quelque chose de plus frais entre-temps, on ne touche à rien. */
function demarrerSurZonePrecalculee(lat,lng){
  const generation = nouvelleGeneration("zone:precalculee",lat.toFixed(2)+","+lng.toFixed(2));
  lieuxDeZone(lat,lng).then(depart=>{
    if(!generationCourante(generation) || !depart || !depart.length) return;
    if(lieux.length) return;          // le réseau a déjà répondu : tant mieux
    fusionner(depart);
    PERF.jalon("source_locale");
    PERF.jalon("premier_lieu");
    charge(null);
  }).catch(()=>{}).finally(()=>terminerGeneration(generation));
}

/* La même tuile précalculée, mais pour une ville qu'on vient de demander.
   `demarrerSurZonePrecalculee` ne peut pas servir ici : il renonce dès que la
   mémoire contient quelque chose — ce qui est juste au démarrage, où le réseau
   a pu répondre en premier, et faux après, où la mémoire est pleine des lieux
   d'une AUTRE ville. Le filtre de zone se charge du reste. */
function precalculPourZone(lat, lng, portee){
  lieuxDeZone(lat, lng).then(depart=>{
    if(!porteeValide(portee) || !depart || !depart.length) return;
    /* LA TUILE SERT À NE PAS RESTER DEVANT UN ÉCRAN VIDE — RIEN D'AUTRE.

       Une première version la posait toujours, et déclenchait un rendu complet
       pour l'afficher. Mesuré au banc, trois exécutions de suite : le premier
       lieu de la ville demandée arrivait à 2,6-3,5 s au lieu de 1,9 s. Un
       rendu complet coûte plusieurs centaines de millisecondes en centre
       dense, et celui-ci tombait précisément quand les données fraîches
       arrivaient — la tuile ne devançait donc rien, elle retardait tout.

       Elle ne s'affiche plus que si la zone n'a encore RIEN à montrer, ce qui
       est exactement le cas qu'elle est censée couvrir : réseau lent, Overpass
       qui traîne. Quand les données fraîches sont déjà là, elle se tait. */
    if(lieux.some(dansZoneActive)) return;
    fusionner(depart);
    PERF.jalon("hub_zone_demandee");
    planifierRendu({accueil:true, carte:true, feuille:true});
  }).catch(()=>{});
}

function avecDelai(promesse, ms, valeur, signal){
  return new Promise(resolve=>{
    let fini = false;
    const terminer = (resultat)=>{ if(fini) return; fini=true; clearTimeout(t); resolve(resultat); };
    const t = setTimeout(()=>terminer(valeur),ms);
    if(signal) signal.addEventListener("abort",()=>terminer(valeur),{once:true});
    Promise.resolve(promesse).then(terminer,()=>terminer(valeur));
  });
}

/* Tout ce qui a besoin du réseau ou d'un vrai calcul, une fois l'écran peint.
   Les sources partent ENSEMBLE : aucune n'attend le résultat d'une autre. */
function chargerLeDemarrage(rapide){
  if(!positionMoi){
    attendreLeaflet();
    proposerPosition();
    return;
  }
  const [lat,lng] = positionMoi;
  const generation = nouvelleGeneration("demarrage",lat.toFixed(3)+","+lng.toFixed(3));
  const signal = generation.signal;
  prendreEtatRecherche("places",generation);
  attendreLeaflet();

  // le contexte : la ville s'affiche sans attendre les lieux. Mais on ne nomme
  // pas la ville d'un point que personne n'a choisi — afficher « Paris » à
  // quelqu'un qui est à Lille est pire que ne rien afficher.
  if(positionConnue()) detecterVille(lat, lng);
  dernierNom = [lat,lng];

  definirEtatRechercheVersionne("places",SEARCH_STATES.LOADING_PLACES,generation);
  // pas de gros écran de chargement quand on a déjà quelque chose à montrer :
  // un simple « mise à jour… » discret, et les cartes précédentes restent
  if(rapide) majSignalMaj(true); else charge("Recherche autour de toi…");

  /* Le cache de tuiles : plus complet que le jeu rapide, mais il faut le
     reclasser. Il arrive donc juste après la première image, pas avant. */
  const enCache = lireCacheProche(lat,lng);
  PERF.jalon("cache_lu");
  if(enCache && enCache.length){
    fusionner(enCache);
    charge(null);
    PERF.jalon("cached_pois_visible");
    PERF.jalon("source_locale");
    PERF.jalon("premier_lieu");
  }

  const sourcePrete = (nom)=>{
    if(!generationCourante(generation)) return false;
    charge(null);
    definirEtatRechercheVersionne("places",SEARCH_STATES.SUCCESS,generation);
    PERF.jalon(nom);
    PERF.jalon("premier_lieu");
    planifierRendu({accueil:true, carte:true, filtres:true});
    return true;
  };

  /* Google, DATAtourisme et Supabase portent les premières recommandations.
     Chacun possède un délai borné et publie son résultat indépendamment : la
     source la plus lente ne garde plus l'interface en état de chargement. */
  const travaux = [
    avecDelai(nomCommune(lat,lng),2500,null,signal)
      .then(n=>{ if(generationCourante(generation) && n) commune = n; }),

    avecDelai(notesGoogle(lat,lng,{signal}),4000,[],signal).then(fiches=>{
      if(!generationCourante(generation) || !fiches || !fiches.length) return;
      greffeNotes(lieux,fiches);
      ajouterLieuxGoogle(fiches);
      sourcePrete("google_pret");
    }),

    avecDelai(lieuxDatatourisme(lat,lng,signal),4000,[],signal).then(reels=>{
      if(!generationCourante(generation) || !reels || !reels.length) return;
      fusionner(reels,"datatourisme");
      sourcePrete("datatourisme_done");
    }),

    /* Au démarrage à froid, la couche territoriale est une seule opération :
       cache éventuel d'abord, deux RPC parallèles ensuite, une publication.
       Les autres chemins du démarrage partagent exactement cette promesse. */
    avecDelai(chargerCoucheSupabase(lat,lng),4500,null,signal)
      .then(couche=>{
        if(!generationCourante(generation) || !couche) return;
        if((couche.publications || []).length)
          PERF.jalon("supabase_publications_ready");
        if((couche.evenements || []).length)
          PERF.jalon("supabase_evenements_ready");
        if((couche.publications || []).length || (couche.evenements || []).length)
          sourcePrete("supabase_pret");
      }),

    avecDelai(connecter().then(()=>Promise.allSettled([rafraichirCanaux(), chargerFavoris()])),4500,[],signal)
      .then(()=>{ if(generationCourante(generation)) PERF.jalon("supabase_pret"); }),
  ];

  Promise.allSettled(travaux).then(()=>{
    if(!generationCourante(generation)) return;
    definirEtatRechercheVersionne("places",lieux.length ? SEARCH_STATES.SUCCESS : SEARCH_STATES.EMPTY,generation);
    majSignalMaj(false);
    charge(null);
    PERF.jalon("demarrage_termine");
    PERF.mesure("démarrage", "boot_debut", "demarrage_termine");
    PERF.finDemarrage();
    terminerGeneration(generation);
    // Deux catégories au plus, et seulement bien après le démarrage. Une panne
    // Overpass désactive ce confort plutôt que de créer une nouvelle rafale.
    setTimeout(()=>{
      if(positionMoi && distanceM(lat,lng,positionMoi[0],positionMoi[1]) < 500)
        quandLibre(()=>prechargerCategories());
    },8000);
  });

  /* OpenAgenda arrive après la stabilisation des premières sources. Le lancer
     dans le premier `requestIdleCallback` ajoutait plusieurs requêtes pendant
     que Google, Supabase et DATAtourisme étaient encore en vol. */
  setTimeout(()=>{
    if(positionMoi && distanceM(lat,lng,positionMoi[0],positionMoi[1]) < 500)
      quandLibre(()=>chargerDonneesTemporaires(lat,lng,{sansPublications:true}));
  },5000);

  /* OSM n'est plus dans `travaux` : il enrichit quand il répond et son échec ne
     retarde ni le premier contenu, ni la fin du démarrage. Une seule requête
     étroite part ; le quartier complet attend un déplacement ou une demande. */
  chargerZone(lat,lng,{sansCarte:true, osmSeulement:true,
    delai:OVERPASS_DELAI_BOOT, reglages:{rayon:RAYON_BOOT,limite:PLAFOND_BOOT}});
}

/* Seuil au-delà duquel « autour de moi » ne décrit plus ce qu'on regarde.
   1200 m, soit un quartier : au-delà, les recommandations affichées ne sont
   plus celles de l'endroit où l'on est. Le seuil précédent (3 km) laissait le
   bouton absent après une recherche sur une commune voisine, alors que c'est
   exactement le moment où il sert. */
const ECART_HORS_ZONE = 1200;
function carteHorsPosition(){
  if(!map || !positionMoi) return false;
  // une recherche géographique déplace la carte par définition, quelle que
  // soit la distance parcourue
  if(rechercheGeo) return true;
  const c = map.getCenter();
  return distanceM(positionMoi[0], positionMoi[1], c.lat, c.lng) > ECART_HORS_ZONE;
}
function majBoutons(){
  const retour = $("#btnAutourDeMoi");
  if(retour) retour.hidden = !map || modePose || modeNav || !carteHorsPosition();
}

/* ================================================================== */
/*  Marqueurs                                                         */
/* ================================================================== */

/* Le masquage manuel par catégorie a disparu avec les petits yeux : une
   catégorie est choisie ou elle ne l'est pas, il n'y a pas de troisième
   état à comprendre. On nettoie l'ancien réglage au passage. */
try{ localStorage.removeItem("autour:masquees"); }catch(e){}

/* Une intention regroupe plusieurs catégories : « Manger » ne se réduit pas à
   une case, et demander à quelqu'un de cocher restos + fast-food + cafés +
   marchés est exactement le travail que l'app doit lui épargner. */
let catsActives = null;          // Set de catégories, ou null = tout
/* Actif par défaut : quelqu'un qui ouvre l'app cherche ce qui lui sert
   maintenant, pas l'inventaire de ce qui existe. Un bouton l'éteint. */
let filtreMaintenant = true;
let filtresHumains = new Set();  // gratuit · ouvert · proche · pmr

/* Certains filtres se lisent dans la donnée (ouvert, prix, accessibilité).
   D'autres se déduisent des catégories : personne ne publie « convient aux
   familles », mais un parc, une piscine ou un musée le sont par nature.
   C'est une heuristique assumée, pas une donnée inventée. */
const FILTRES_HUMAINS = [
  { id:"ouvert",  label:"Ouvert",          test:l=>{
      const d = dispoDe(l);
      return d ? d.isOpenNow : l.ouvert === true;
    } },
  { id:"proche",  label:"< 15 min à pied", test:(l,d)=>d < 1200 },
  { id:"gratuit", label:"Gratuit",         test:l=>gratuitDe(l) },
  { id:"budget",  label:"Petit budget",    test:l=>l.prixN != null && l.prixN <= 1 },
  { id:"famille", label:"En famille",      test:l=>
      correspondCategorie(l,"family") || FAMILY_CATEGORIES.some(c=>correspondCategorie(l,c)) },
  { id:"etudier", label:"Étudier",         cats:["biblio","coworking","cafe"] },
  { id:"monde",   label:"Rencontrer",      cats:["event","concert","bar","asso","terrain","popup","studio","sport","rencontre"] },
  { id:"libre",   label:"Sans réservation",cats:["parc","biblio","marche","fastfood","cafe","commerce",
                                                 "friperie","toilettes","terrain","musee","velo"] },
  { id:"pmr",     label:"Accessible PMR",  test:l=>l.pmr === true },
].map(f=> f.cats ? Object.assign(f, {test:l=>f.cats.some(c=>correspondCategorie(l,c))}) : f);

/* Les contraintes — par opposition aux envies. Elles n'ont qu'un seul foyer,
   le bouton Filtres, et s'y présentent dans cet ordre : c'est celui dans
   lequel on les cherche. « Gratuit » figurait aussi comme pastille d'intention
   à côté de Manger et Sortir ; deux entrées pour une seule notion, avec deux
   états à garder d'accord. */
const CONTRAINTES = ["ouvert","proche","gratuit","budget"];

/* Ce qu'on propose de chercher DANS une destination tapée. Deux entrées, pas
   six : la liste doit rester lisible sous le champ, et ces deux-là couvrent
   l'essentiel de ce qu'on cherche en arrivant quelque part. Les libellés
   viennent des besoins réels de l'application. */
const SUGGESTIONS_INTENTION = [
  { emoji:"🍴", label:"Manger" },
  { emoji:"🎉", label:"Sortir" },
];

/* Timeline : la même carte, à un autre moment de la journée. */
/* Quatre groupes de temps, pas un de plus. « Dans 1 heure » et « Demain »
   étaient des nuances de « maintenant » et de « à venir » : deux entrées de
   menu de plus pour la même décision. Ce qui n'est pas maintenant n'est pas
   perdu pour autant — il part dans l'un des trois autres groupes. */
const CRENEAUX = [
  { id:"maintenant", label:"Maintenant"  },
  { id:"soir",       label:"Ce soir",     heure:19 },
  { id:"weekend",    label:"Ce week-end", heure:16, weekend:true },
  { id:"avenir",     label:"À venir"      },
];
/* Le créneau choisi ↔ la section rendue par le moteur temporel. « Plus tard
   aujourd'hui » rejoint « ce soir » : personne ne distingue les deux quand il
   s'agit de décider de sortir. */
const SECTIONS_DU_CRENEAU = Object.freeze({
  maintenant:["maintenant"],
  soir:["ce_soir","aujourdhui"],
  weekend:["ce_week_end"],
  avenir:["a_venir"],
});
let creneau = "maintenant";

/* Instant de référence du créneau choisi : c'est lui qui décide des poids
   horaires et de la fenêtre dans laquelle un événement compte. */
function instantCreneau(){
  const c = CRENEAUX.find(x=>x.id===creneau) || CRENEAUX[0];
  const d = new Date();
  // le week-end : le prochain samedi, ou aujourd'hui si on y est déjà
  if(c.weekend){
    const jour = d.getDay();                       // 0 dimanche … 6 samedi
    if(jour !== 0 && jour !== 6) d.setDate(d.getDate() + (6 - jour));
  }
  if(c.heure != null){
    d.setHours(c.heure, 0, 0, 0);
    // « ce soir » quand il est déjà 21 h : c'est maintenant, pas dans le passé
    if(d.getTime() < Date.now()) return new Date();
  }
  return d;
}

/* Le contexte saisonnier du moment : mois, heure et vacances scolaires. Trois
   informations certaines, tirées du calendrier — aucune API météo, donc
   aucune dépendance de plus et aucune prévision qui se trompe. */
function contexteSaison(quand){
  if(!SIGNAUX) return null;
  const d = new Date(quand == null ? Date.now() : quand);
  return SIGNAUX.contexteSaison(d, !!vacancesScolaires(d));
}

/* Fermé pour une raison que les horaires ne disent pas. Aujourd'hui un seul
   cas, et il est réel : un établissement scolaire pendant les vacances. OSM
   n'y publie pas de calendrier, et la fiche reste « ouverte » tout l'été. */
/* Établissements dont les locaux ne sont pas ouverts au public : on ne va pas
   réviser dans un collège. Une université ou une médiathèque, si — d'où la
   distinction, qui porte sur le type et non sur le mot « école ». */
const SCOLAIRE_FERME = /\b(college|coll[èe]ge|lyc[ée]e|[ée]cole|groupe scolaire|primaire|maternelle|cr[èe]che)\b/i;

function scolaireNonAccessible(l){
  if(!l || l.cat !== "ecole") return false;
  const nom = String(l.titre || "");
  // universités, IUT, écoles supérieures : des campus, souvent traversables
  if(/\b(universit|iut\b|campus|sup[ée]rieur|grande [ée]cole|institut)/i.test(nom)) return false;
  return SCOLAIRE_FERME.test(nom) || !nom;
}

function horsService(l, quand){
  if(!l || l.cat !== "ecole") return false;
  // un collège n'est jamais un lieu où l'on va étudier : ses locaux ne sont
  // pas publics, vacances ou pas. Déprioriser, jamais supprimer — il reste
  // une information sur la carte et dans la recherche par nom.
  if(scolaireNonAccessible(l)) return true;
  return !!vacancesScolaires(new Date(quand == null ? Date.now() : quand));
}

/* La section temporelle d'un objet, telle que le moteur la calcule. */
function sectionDe(l, quand){
  const t = quand == null ? Date.now() : quand;
  return TEMPS.sectionTemporelle(statutTemps(l, t), t);
}

/* « Maintenant » : ce qui est vivant à cet instant, et rien d'autre. */
/* Le statut temporel d'un objet, calculé par le moteur qui fait autorité
   là-dessus. Un seul point d'entrée pour toute l'application : la carte, les
   cartes du carousel et les sections doivent lire la même chose. */
function statutTemps(l, quand){
  const t = quand == null ? Date.now() : quand;
  const disponibilite = (x,q)=>dispoDe(x, null, q);
  if(estTemporaire(l) && TEMPS.etatTemporalEvenement)
    return TEMPS.etatTemporalEvenement(donneesEvenement(l), t, {disponibilite});
  return TEMPS.statutTemporel(l, t, {disponibilite});
}

function libelleTemporelDe(l, quand, options){
  const t = quand == null ? Date.now() : quand;
  const etat = options && options.statut ? options.statut : statutTemps(l, t);
  const cible = estTemporaire(l) ? donneesEvenement(l) : l;
  return TEMPS.libelleTemporel(cible, t, Object.assign({}, options || {}, {
    disponibilite:(x,q)=>dispoDe(x, null, q), statut:etat,
  }));
}

function libelleDateDe(l, quand, options){
  const t = quand == null ? Date.now() : quand;
  const etat = options && options.statut ? options.statut : statutTemps(l, t);
  const cible = estTemporaire(l) ? donneesEvenement(l) : l;
  return TEMPS.libelleDate(cible, t, Object.assign({}, options || {}, {statut:etat}));
}

function estVivant(l){
  const t = instantCreneau().getTime();
  if(estTemporaire(l)){
    /* « Maintenant » n'accepte que ce qui a lieu ou commence dans les deux
       heures. L'ancienne règle laissait passer douze heures, et surtout elle
       laissait passer un événement SANS date : `startsAt` nul ne déclenchait
       aucun refus. C'est ce qui remplissait le bloc d'événements prévus des
       semaines plus tard. */
    if(creneau === "maintenant") return TEMPS.estMaintenant(statutTemps(l, t).statut);
    // les autres créneaux montrent leur groupe, calculé depuis l'instant réel :
    // un événement de samedi appartient au week-end, pas à « maintenant »
    const sections = SECTIONS_DU_CRENEAU[creneau] || [];
    return sections.includes(sectionDe(l));
  }
  // « Maintenant » retire ce qui est fermé, pas ce dont on ignore l'horaire :
  // la plupart des lieux OpenStreetMap n'ont aucune donnée d'ouverture, et
  // les exiger vidait la carte à l'ouverture de l'application
  // (un lieu dont on sait lire l'horaire est jugé dessus, les autres restent)
  return creneau === "maintenant" ? !estFerme(l) : true;
}

/* Le regroupement vit ici, dans l'unique entonnoir de ce qui peut s'afficher.
   Le placer plus loin — au moment de poser les marqueurs — laissait la liste
   de recommandations choisir cinq membres du même pôle avant que qui que ce
   soit ne les replie. Ce que la carte montre et ce que la feuille propose
   doivent voir le même monde.

   Rien n'est perdu : lieux[] garde tous les objets, et chaque représentant
   porte ses membres dans .regroupes. */
function visibles(){
  return groupLogicalPlaces(visiblesBruts(), distanceM);
}

function visiblesBruts(){
  const q = recherche.trim().toLowerCase();
  // au repos, la carte se limite à la poignée de lieux de la carte d'accueil.
  // Pas en mode Aide : là, on veut voir tous les points d'aide autour, la
  // carte d'accueil ne servant qu'à donner les premiers.
  if(Array.isArray(selectionAccueil) && !modeAide && !catsActives && !filtreMaintenant && !q)
    return lieux.filter(l=>selectionAccueil.includes(l.id) && dansZoneActive(l));

  const [mLat,mLng] = centreZoneActive() || positionMoi || [0,0];
  const epingles = idsEpingles();
  return lieux.filter(l=>{
    /* PREMIÈRE QUESTION, AVANT TOUTES LES AUTRES : ce lieu appartient-il à la
       zone dont on parle ? Les lieux s'accumulent — chercher Lille n'efface
       pas Tourcoing de la mémoire, et c'est très bien : y revenir doit être
       instantané. Mais tant qu'on regarde Lille, Tourcoing ne se dessine pas. */
    if(!dansZoneActive(l)) return false;
    /* Ce qu'on vient de publier passe tous les filtres. Le filtre « maintenant »
       est actif au repos ; un concert de demain soir n'est donc pas « vivant »,
       et l'événement qu'on venait de créer disparaissait de la carte à la
       seconde où on appuyait sur « Publier ». Publier doit montrer. */
    if(epingles.length && epingles.includes(l.id)) return true;
    // un point sans nom exploitable n'apprend rien : « Restaurants · 3 » sur
    // la carte au lieu d'une enseigne, personne ne sait où il va
    if(!nomExploitable(l)) return false;
    if(catsActives && !correspondUneCategorie(l,catsActives)) return false;
    if(!catsActives && filtreActif!=="tout" && !correspondCategorie(l,filtreActif)) return false;
    // une catégorie explicitement demandée reste visible même si masquée
    if(filtreMaintenant && !estVivant(l)) return false;
    if(filtresHumains.size){
      const d = distanceM(mLat,mLng,l.lat,l.lng);
      for(const f of FILTRES_HUMAINS)
        if(filtresHumains.has(f.id) && !f.test(l,d)) return false;
    }
    if(!q) return true;
    return (l.titre+" "+l.adresse+" "+(l.cuisine||"")).toLowerCase().includes(q);
  });
}

/* Toutes les heures affichées passent par ici : un « Arrivée 19:10 » calculé
   dans le fuseau du navigateur est faux dès que celui-ci diffère de celui du
   lieu — ce qui est le cas de tout serveur en UTC. */
function heureLocale(ts, l){
  const tz = (l && (l.timezone || l.timeZone)) ||
    (window.AutourAvailability && window.AutourAvailability.DEFAULT_TIMEZONE) || undefined;
  return new Date(ts).toLocaleTimeString("fr-FR",{hour:"2-digit",minute:"2-digit",timeZone:tz});
}

/* ---- Fiche compacte ------------------------------------------------------
   Un tap sur un marqueur n'ouvre plus un panneau plein écran : il pose une
   petite fiche au-dessus de la carte, qu'on lit sans perdre le contexte.
   « Voir » seulement ensuite ouvre le détail complet. */
/* Le lieu regardé. Quand il y en a un, la carte cesse d'être une liste de
   pastilles équivalentes : celle-là est mise en avant, les autres s'effacent.
   C'est ce qui fait de la carte un support de décision plutôt qu'un fond. */
let lieuEnAvant = null;

function mettreEnAvant(id){
  lieuEnAvant = id || null;
  document.body.classList.toggle("focus-lieu", !!lieuEnAvant);
  marqueurs.forEach((m, cle)=>{
    const el = m && m.getElement && m.getElement();
    if(el) el.classList.toggle("en-avant", !!lieuEnAvant && cle === lieuEnAvant);
  });
}

/* La liste des événements posés au même endroit. Elle réutilise la fiche
   compacte — même conteneur, même position, même fermeture : il n'y a pas un
   panneau de plus à connaître, seulement un contenu différent. */
function ouvrirPileCompacte(g){
  if(!Array.isArray(g) || !g.length) return;
  const f = $("#ficheCompacte");
  if(!f) return;
  mettreEnAvant(g[0].id);
  if(!responsiveLayoutState.isDesktop && feuilleNiveau !== null)
    reglerEtatFeuille("reduite");
  const t = Date.now();
  const ligne = (l)=>{
    const c = categorieAffichee(l);
    const etat = statutTemps(l, t);
    const quand = l.annule ? "Annulé"
      : libelleTemporelDe(l, t, {statut:etat});
    const dist = positionPrecise()
      ? formatDist(distanceDepuisZone(l)) : "";
    return '<button class="pl-l" data-pile="'+esc(l.id)+'">'+
      '<span class="pl-rond" style="background:'+(COULEURS_CAT[l.cat]||"#5D6B63")+'">'+
        c.emoji+'</span>'+
      '<span class="pl-txt"><b>'+esc(l.titre)+'</b>'+
        '<i>'+esc([quand, dist].filter(Boolean).join(" · "))+'</i></span>'+
      '<span class="pl-fl" aria-hidden="true">›</span></button>';
  };
  const lieu = g[0].adresse || g[0].cp || "";
  f.innerHTML =
    '<div class="pl-tete"><b>'+g.length+' événements ici</b>'+
      (lieu ? '<span>'+esc(lieu)+'</span>' : '')+'</div>'+
    '<div class="pl-liste">'+g.map(ligne).join("")+'</div>';
  f.hidden = false;
  f.querySelectorAll("[data-pile]").forEach(b=>b.onclick=()=>{
    const l = g.find(x=>x.id === b.dataset.pile);
    if(!l) return;
    fermerFicheCompacte(); pileEcrans=[];
    pousserEcran(()=>ouvrirDetail(l.id));
  });
}

function fermerFicheCompacte(){
  const f = $("#ficheCompacte");
  if(f){ f.hidden = true; f.innerHTML = ""; }
  mettreEnAvant(null);
}

/* La deuxième ligne d'une étiquette doit trancher : l'heure qui décide
   (début de séance), sinon la fermeture, sinon le temps de trajet. */
function sousTitreMarqueur(l){
  const heure = (t)=>heureLocale(t, l);
  const eta = positionPrecise() ? l.rankEta : null;
  const trajet = eta && Number.isFinite(eta.minutes) ? eta.minutes+" min" : "";

  // pour un événement, la date qui compte est la prochaine occurrence réelle,
  // pas le début de la période de récurrence
  if(estTemporaire(l)){
    const etat = statutTemps(l);
    const libelle = libelleTemporelDe(l, Date.now(), {statut: etat});
    if(libelle) return '<span'+(etat.statut===TEMPS.STATUTS.EN_COURS?' class="ouvre"':'')+'>'+
      esc(libelle)+(trajet ? " · "+trajet : "")+'</span>';
  }
  if(l.startsAt && l.startsAt > Date.now())
    return '<span>'+heure(l.startsAt)+(trajet ? " · "+trajet : "")+'</span>';

  const d = dispoDe(l);
  if(d && d.status === "open" && d.closesAtTime)
    return '<span class="ouvre">Ouvert jusqu’à '+d.closesAtTime+'</span>';
  if(d && (d.status === "closed" || d.status === "opening_soon") && d.opensAtTime)
    return '<span>Ouvre à '+d.opensAtTime+'</span>';
  return trajet ? '<span>'+trajet+'</span>' : '';
}

function htmlMarqueur(l){
  const c = categorieAffichee(l);

  /* CE QUI A LIEU MAINTENANT NE SE DESSINE PAS COMME UN COMMERCE.

     Un concert en cours et une boulangerie partageaient la même épingle :
     rond coloré + étiquette accolée. Rien ne disait, d'un coup d'œil sur la
     carte, lequel des deux est en train de se passer. Or c'est la question à
     laquelle Explorer doit répondre en premier.

     Un événement en cours prend donc une carte blanche posée sur la carte :
     icône, titre, lieu, puis la seule ligne qui décide — la distance et
     l'heure de fin. « jusqu'à 23:00 » vaut mieux que « en cours », qui
     n'indique pas s'il reste dix minutes ou trois heures.

     Le statut vient du moteur temporel, donc de Postgres pour les événements
     canoniques : un événement de demain ne peut pas prendre cette carte. */
  if(estTemporaire(l) && !l.annule && TEMPS.estMaintenant(statutTemps(l).statut)){
    const evenement = donneesEvenement(l);
    const dist = positionPrecise()
      ? formatDist(distanceDepuisZone(l)) : "";
    const fin = evenement && evenement.end_at ? heureLocale(evenement.end_at, l) : "";
    const bas = [dist, fin ? "jusqu’à "+fin : ""].filter(Boolean).join(" · ");
    const lieu = l.adresse || l.cp || "";
    return '<span class="mk-in"><div class="evc">'+
      '<span class="evc-rond" style="background:'+(COULEURS_CAT[l.cat]||"#5D6B63")+'">'+
        c.emoji+'</span>'+
      '<span class="evc-txt"><b>'+esc((evenement && evenement.title) || l.titre)+'</b>'+
        (lieu ? '<i>'+esc(lieu)+'</i>' : '')+
        (bas ? '<u>'+esc(bas)+'</u>' : '')+
      '</span></div></span>';
  }

  /* L'affiche inclinée reste, mais pour ce qui N'A PAS ENCORE LIEU : elle
     annonce un prix, des places, une date. Un événement en cours, lui, est
     passé par la carte blanche ci-dessus — la question n'est plus « combien
     ça coûte » mais « jusqu'à quand ça dure ». */
  if(estTemporaire(l)){
    const evenement = donneesEvenement(l);
    const tilt = ((hash(l.id)%700)/100-3.5).toFixed(2);
    // annulé : l'affiche reste, mais elle ne peut pas se lire comme un
    // événement qui a lieu — c'est tout l'intérêt de ne pas le supprimer
    /* Un envoi qui traîne se dit là où l'affiche dit son prix et ses places :
       c'est la ligne qu'on lit, et elle est assez grosse pour être lue de
       loin. Tant qu'il n'y a pas de retard, rien ne s'affiche — une
       publication qui part en trois cents millisecondes n'a rien à annoncer. */
    const envoi = l.envoi === "retard" ? '<span class="a-envoi">Envoi…</span>'
      : l.envoi === "echec" ? '<span class="a-envoi a-echec">Non publié · Réessayer</span>'
      : '';
    const tarif = EVENEMENTS && evenement ? EVENEMENTS.tarifEvenement(evenement) :
      (l.gratuit ? "Entrée libre" : (l.prix == null ? "Tarif à vérifier" : l.prix+" €"));
    return '<span class="mk-in"><div class="affiche '+((evenement ? evenement.is_free === true : l.gratuit)?'gratuit':'payant')+
      (l.annule?' annulee':'')+(l.envoi==="echec"?' a-rate':'')+'" style="--tilt:'+tilt+'deg">'+
      '<span class="a-haut"><span>'+c.emoji+'</span><span>'+
        (l.annule?'ANNULÉ':tarif)+'</span>'+
      (l.places!=null && !l.annule?'<span class="a-places">· '+l.places+' pl.</span>':'')+
      envoi+'</span>'+
      '<span class="a-titre">'+esc(l.titre)+'</span>'+
      // un événement sans adresse écrivait littéralement « undefined »
      (l.adresse ? '<span class="a-lieu">'+esc(l.adresse)+'</span>' : '')+
      '</div></span>';
  }
  // le lieu reste, l'événement se pose dessus : une pastille signale qu'il s'y
  // passe quelque chose aujourd'hui sans remplacer le commerce lui-même
  const evs = indexEvenements.get(l.titre) || 0;
  // un lieu fermé garde sa place sur la carte mais ne doit pas se lire comme
  // un lieu ouvert : marqueur atténué et badge explicite
  const ferme = estFerme(l);
  return '<span class="mk-in"><div class="poi'+(ferme?' poi-ferme':'')+'">'+
    '<span class="poi-rond" style="background:'+(COULEURS_CAT[l.cat]||"#5D6B63")+'">'+c.emoji+
      (evs ? '<i class="poi-pastille">'+evs+'</i>' : '')+
      (ferme ? '<i class="poi-ferme-badge">Fermé</i>' : '')+'</span>'+
    '<span class="poi-eti"><b>'+esc(l.titre)+'</b>'+sousTitreMarqueur(l)+'</span>'+
    '</div></span>';
}

/* Regroupement : au-delà d'un certain éloignement, des dizaines de pastilles
   se chevauchent et la carte devient illisible. On fusionne par cases de
   ~70 px d'écran, ce qui suit naturellement le zoom. */
const TAILLE_GRAPPE = 70;

/* Combien de recommandations gardent leur propre épingle, quel que soit le
   zoom. Sans elles, un quartier dense se réduisait à une seule grappe : la
   carte devenait juste, et parfaitement inutilisable — on demandait Paris et
   on obtenait un rond marqué « 24 ». */
const EPINGLES_PRIORITAIRES = 6;

function grouper(liste){
  if(map.getZoom() >= 16) return liste.map(l=>({seul:l}));
  // la liste sort de selectionner(), triée par score : son début est ce qu'on
  // recommande, et cela doit rester lisible un par un
  const epingles = new Set(liste.slice(0, EPINGLES_PRIORITAIRES).map(l=>l.id));
  const seuls = [], cases = new Map();
  liste.forEach(l=>{
    if(epingles.has(l.id)){ seuls.push({seul:l}); return; }
    if(!map){ seuls.push({seul:l}); return; }   // sans carte, rien à regrouper
    const p = map.latLngToLayerPoint([l.lat,l.lng]);
    const cle = Math.round(p.x/TAILLE_GRAPPE)+":"+Math.round(p.y/TAILLE_GRAPPE);
    if(!cases.has(cle)) cases.set(cle, []);
    cases.get(cle).push(l);
  });
  return seuls.concat([...cases.values()].map(g => g.length===1 ? {seul:g[0]} : {grappe:g}));
}

/* ---- Événements posés au même endroit -----------------------------------

   PÉRIMÈTRE : cette passe ne touche QUE les événements, et seulement ceux
   qu'on ne peut pas distinguer à l'œil au zoom courant. Elle ne change rien
   au regroupement général (`grouper`), qui reste réservé aux zooms lointains
   et aux lieux. Autour ne devient pas une carte à grappes.

   Le cas réel : une salle qui programme trois concerts le même soir, un
   centre culturel avec quatre ateliers, deux organisateurs qui publient à la
   même adresse. Les cartes se posaient exactement l'une sur l'autre — celles
   du dessous étaient invisibles ET intouchables. Mesuré sur quatre événements
   au même point : trois illisibles.

   Le seuil est en PIXELS D'ÉCRAN, pas en mètres : c'est bien « indissociable
   au niveau de zoom actuel » qu'on veut, et deux points à trente mètres sont
   confondus au zoom 14 mais parfaitement séparés au zoom 18. En dézoomant,
   des événements se rejoignent ; en zoomant, la pile se défait d'elle-même. */
const SEUIL_EMPILEMENT_PX = 24;

function empilerEvenements(items){
  if(!map) return items;
  const sortie = [], piles = [];
  items.forEach(item=>{
    const l = item.seul;
    // les grappes existantes et les lieux permanents passent sans être touchés
    if(!l || !estTemporaire(l)){ sortie.push(item); return; }
    const p = map.latLngToLayerPoint([l.lat, l.lng]);
    const proche = piles.find(pile=>
      Math.abs(pile.p.x - p.x) <= SEUIL_EMPILEMENT_PX &&
      Math.abs(pile.p.y - p.y) <= SEUIL_EMPILEMENT_PX);
    if(proche) proche.membres.push(l);
    else piles.push({p, membres:[l]});
  });
  piles.forEach(pile=>{
    if(pile.membres.length === 1) sortie.push({seul:pile.membres[0]});
    else sortie.push({pile:ordonnerPile(pile.membres)});
  });
  return sortie;
}

/* L'ordre demandé, et il a un sens : ce qui a lieu maintenant d'abord, puis
   ce qui commence le plus tôt, puis la pertinence pour départager. Les
   événements à venir se retrouvent naturellement en fin de liste — ils ne
   sont pas exclus, ils sont simplement moins urgents à lire. */
function ordonnerPile(membres){
  const t = Date.now();
  const rang = new Map(derniereSelection.map((x,i)=>[x.l.id, i]));
  const cle = (l)=>{
    const etat = statutTemps(l, t);
    const enCours = TEMPS.estMaintenant(etat.statut) ? 0 : 1;
    const debut = etat.debut == null ? Infinity : Math.abs(etat.debut - t);
    return [enCours, debut, rang.has(l.id) ? rang.get(l.id) : 9999];
  };
  return membres.slice().sort((a,b)=>{
    const ka = cle(a), kb = cle(b);
    return (ka[0]-kb[0]) || (ka[1]-kb[1]) || (ka[2]-kb[2]);
  });
}

/* Compté une fois par rendu plutôt qu'une fois par marqueur : rendre() tourne
   à chaque déplacement de carte, et parcourir tous les lieux pour chacun d'eux
   devenait quadratique dès quelques centaines de POI. */
let indexEvenements = new Map();
let indexPerime = true;          // recalculé seulement quand la liste change

function majIndexEvenements(){
  if(!indexPerime) return;
  indexPerime = false;
  indexEvenements = new Map();
  const permanents = lieux.filter(l=>!estTemporaire(l));
  const pas = .0015; // ~165 m nord/sud : neuf cases couvrent largement 80 m
  const grille = new Map();
  const cellule = (lat,lng)=>Math.floor(lat/pas)+":"+Math.floor(lng/pas);
  permanents.forEach(p=>{
    const cle=cellule(p.lat,p.lng);
    if(!grille.has(cle)) grille.set(cle,[]);
    grille.get(cle).push(p);
  });
  lieux.forEach(e=>{
    if(!estTemporaire(e)) return;
    // rattachement par proximité : comparer les noms ratait « Le Grand Mix »
    // face à « Grand Mix », et tout événement dont l'adresse est une rue
    let proche = null, dMin = 80;
    const cx=Math.floor(e.lat/pas), cy=Math.floor(e.lng/pas);
    const candidats=[];
    for(let x=cx-1;x<=cx+1;x++) for(let y=cy-1;y<=cy+1;y++)
      candidats.push(...(grille.get(x+":"+y)||[]));
    candidats.forEach(p=>{
      const d = distanceM(e.lat,e.lng,p.lat,p.lng);
      if(d < dMin){ dMin = d; proche = p; }
    });
    if(proche) indexEvenements.set(proche.titre, (indexEvenements.get(proche.titre)||0) + 1);
  });
}

/* Classement puis plafonnement : la carte ne porte que les mieux notés.
   Montrer trois cents épingles revient à n'en montrer aucune. */
let derniereSelection = [];
let ecartesAuto = 0;          // combien de lieux la règle a écartés au dernier rendu
let regroupesAuto = 0;        // combien d'objets le regroupement a repliés

/* Au repos — pas de recherche, pas de catégorie, pas de filtre — la carte ne
   porte qu'une poignée de recommandations. Tout le reste demeure chargé en
   mémoire et revient dès qu'on demande quelque chose : c'est l'AFFICHAGE qu'on
   restreint, jamais la donnée. */
const MARQUEURS_AU_REPOS = 6;

function auRepos(ctx){
  return !ctx.q && !catsActives && filtreActif === "tout" && !filtresHumains.size
         && !modeAide && !rechercheGeo;
}

function selectionner(){
  const t0 = performance.now();
  const ctx = contexteActuel();
  const brut = visibles();
  const repos = auRepos(ctx);
  const cible = repos ? MARQUEURS_AU_REPOS
              : ctx.large ? POIDS.PLAFOND_LARGE : POIDS.PLAFOND_SERRE;

  // écarter ce qui n'a rien à faire sur la carte tant qu'on ne l'a pas
  // demandé — écoles, administrations, transports, et tout ce qui est fermé à
  // l'instant regardé. Le repliement des doublons a déjà eu lieu dans
  // visibles() : ce qui arrive ici est déjà une liste d'endroits distincts.
  const admis = brut.filter(l=>proposableAuto(l, ctx));
  regroupesAuto = brut.reduce((n,l)=>n + ((l.nbRegroupes||1) - 1), 0);

  let notes = admis.map(l=>{
    const r = scoreLieu(l, ctx);
    return {l, score:r.score, raison:r.raison, niveau:niveauLieu(l, ctx, r.score)};
  });
  const avant = notes.length;
  if(modeAide && !montrerFermes) notes = ecarterFermesSiAlternative(notes);
  // ce que la RÈGLE a retiré : sert au bandeau « rien d'ouvert · tout voir ».
  // Le regroupement n'en fait pas partie — replier un pôle en un marqueur ne
  // cache rien, et le compter ici ferait proposer « tout voir » à tort.
  ecartesAuto = (brut.length - admis.length) + (avant - notes.length);

  // un filtre ou une recherche explicite lève le masquage du niveau C :
  // ce que l'utilisateur demande ne doit jamais lui être caché
  const explicite = !!(ctx.q || catsActives || filtreActif !== "tout" || filtresHumains.size);
  const retenus = (explicite ? notes : notes.filter(x=>x.niveau !== "C"))
    .sort((a,b)=>b.score - a.score)
    .slice(0, cible);

  derniereSelection = retenus;
  if(window.__autourDebug)
    journal.info("[Autour] reçus", brut.length, "· écartés d'office", ecartesAuto,
      "· regroupés", regroupesAuto, "· retenus", retenus.length,
      "· niveau A", notes.filter(x=>x.niveau==="A").length,
      "· classement", (performance.now()-t0).toFixed(1)+" ms",
      "· meilleur", retenus[0] ? retenus[0].l.titre+" ("+Math.round(retenus[0].score)+", "+retenus[0].raison+")" : "—");
  return retenus.map(x=>x.l);
}

function raisonDe(id){
  const x = derniereSelection.find(y=>y.l.id === id);
  return x ? x.raison : "";
}

/* La carte se vide surtout la nuit ou le dimanche : dire pourquoi vaut mieux
   qu'un écran blanc, et l'échappatoire reste à un doigt. */
function majBandeauVide(retenus){
  const b = $("#bandeauVide");
  if(!b) return;
  // un seul bandeau à la fois : celui de la géolocalisation passe avant
  const erreurPartielle = etatErreurPartielle();
  /* `etatDonnees` porte la règle : position inconnue, position en cours de
     détermination et recherche en cours excluent toutes le « vide », et une
     panne n'est pas un vide. Le bandeau se contente de la lire. */
  const etat = etatDonnees(retenus);
  const videReel = etat === ETATS_DONNEES.READY_WITHOUT_RESULTS &&
    lieux.length > 0 && !montrerFermes;
  // tant qu'on ignore où se trouve la personne, on ne peut pas affirmer qu'il
  // n'y a rien autour d'elle : on ne sait même pas de quel « autour » il s'agit
  // Une source secondaire en panne n'est pas un écran vide. Si la carte montre
  // déjà des lieux, le grand bandeau donnait l'impression que tout avait échoué.
  // Et quand la feuille est ouverte, elle porte elle-même un état compact : on
  // évite le doublon visible dans la référence de production.
  const erreurSansResultat = erreurPartielle && retenus === 0 && feuilleNiveau === null;
  const montrer = (erreurSansResultat || videReel)
    && !modeNav && $("#bandeauGeo").hidden;
  b.hidden = !montrer;
  if(!montrer) return;
  if(erreurPartielle){
    $("#videTxt").textContent = "Certains lieux n’ont pas pu être chargés.";
    $("#videOk").textContent = "Réessayer";
    $("#videOk").dataset.action = "retry";
    $("#videOk").hidden = false;
    return;
  }
  $("#videTxt").textContent = ecartesAuto
    ? "Rien d’ouvert à proximité pour le moment."
    : "Rien à afficher dans cette zone.";
  $("#videOk").textContent = "Tout voir";
  $("#videOk").dataset.action = "all";
  $("#videOk").hidden = !ecartesAuto;
}

/* Combien de marqueurs la carte supporte-t-elle vraiment ? Dézoomé, quelques
   centaines de pastilles ne donnent aucune information : on garde les
   meilleures recommandations et ce que les gens ont publié, le reste revient
   au zoom ou se lit dans la feuille. */
const MARQUEURS_MAX_DEZOOME = 10;
/* La liste reçue sort déjà de selectionner(), triée par score : on garde son
   début. Elle se classait auparavant d'après dernierClassement, une liste
   construite ailleurs (les recommandations de la feuille) — dès que les deux
   ne se recouvraient plus, aucun lieu n'avait de rang et la carte se vidait
   entièrement. C'est ce qui arrivait après un déplacement vers une autre
   ville : le classement de la feuille parlait encore de l'ancienne zone. */
function limiterMarqueurs(liste){
  if(!map || map.getZoom() >= 16) return liste;
  const retenus = new Set(liste.slice(0, MARQUEURS_MAX_DEZOOME).map(l=>l.id));
  // un événement publié n'est jamais masqué : c'est la raison d'être de l'app
  liste.forEach(l=>{ if(estTemporaire(l)) retenus.add(l.id); });
  return liste.filter(l=>retenus.has(l.id));
}

/* Un marqueur reste en place pendant les petits mouvements de carte, mais les
   données Places peuvent arriver après son premier dessin. Cette empreinte
   évite un redessin massif tout en mettant à jour son nom, son statut ou sa
   position quand une source meilleure enrichit le même lieu. */
function empreinteMarqueur(l){
  return [l.titre,l.cat,l.lat,l.lng,l.ouvert,l.ferme,l.note,l.avis,l.envoi,l.annule]
    .map(v=>v==null?"":String(v)).join("|");
}

function rendre(){
  const debutCpu = performance.now();
  PERF.rendus.carte += 1;
  PERF.exposer();
  // la pastille ne dépend pas de la carte : elle doit suivre même si Leaflet
  // n'est pas arrivé, sinon elle reste muette là où l'application marche
  majBadgeMaintenant();
  if(!map){ PERF.travail("rendu_carte", debutCpu); return; }
  majIndexEvenements();
  if(!rendre.mesure){ rendre.mesure = true; PERF.jalon("markers_ready"); }
  // en navigation, la carte n'appartient qu'à l'itinéraire
  if(modeNav){
    marqueurs.forEach(m=>map.removeLayer(m));
    marqueurs.clear();
    PERF.travail("rendu_carte", debutCpu);
    return;
  }
  const garder = new Set();
  const choisis = limiterMarqueurs(selectionner());
  majBandeauVide(choisis.length);
  /* La carte ne reconstruit plus le panneau. Les deux consomment la même
     sélection, mais sont planifiés séparément : un zoom ou un changement de
     marqueur ne doit pas recréer tous les boutons et perdre le focus. */
  empilerEvenements(grouper(choisis)).forEach(item=>{
    if(item.seul){
      const l = item.seul;
      garder.add(l.id);
      const existant = marqueurs.get(l.id);
      if(existant){
        const empreinte=empreinteMarqueur(l);
        existant._lieu=l;
        /* Pas de reconstruction à chaque rendu : on ne remplace l'icône que
           si les informations réellement visibles ont changé. */
        if(existant._empreinte !== empreinte){
          existant._empreinte=empreinte;
          existant._envoi = l.envoi;
          existant.setLatLng([l.lat,l.lng]);
          existant.setIcon(L.divIcon({className:"mk "+(estTemporaire(l)?"mk-eph":"mk-fix"), html:htmlMarqueur(l), iconSize:[0,0]}));
        }
        return;
      }
      const eph = estTemporaire(l);
      const m = L.marker([l.lat,l.lng],{
        icon:L.divIcon({className:"mk "+(eph?"mk-eph":"mk-fix"), html:htmlMarqueur(l), iconSize:[0,0]}),
        riseOnHover:true, zIndexOffset: eph?200:0
      }).addTo(map);
      m._lieu=l; m._envoi=l.envoi; m._empreinte=empreinteMarqueur(l);
      m.on("click", ()=>{
        const courant=m._lieu;
        // une affiche qui n'est pas partie se retente d'un appui : c'est le
        // geste qu'on fait naturellement quand on lit « Réessayer »
        if(courant.envoi === "echec"){ reessayerPublication(courant.id); return; }
        mettreAJourProfil("clic", courant.cat); ouvrirFicheCompacte(courant);
      });
      marqueurs.set(l.id,m);
      return;
    }
    /* Une pile d'événements : UN marqueur, celui de tête, plus un compteur.
       On ne dessine pas une grappe anonyme — la carte de l'événement le plus
       urgent reste lisible, et le « +2 » dit qu'il y a autre chose ici. */
    if(item.pile){
      const g = item.pile, tete = g[0];
      const id = "pile:"+tete.id+"x"+g.length;
      garder.add(id);
      const existant = marqueurs.get(id);
      if(existant){ existant._pile = g; return; }
      const m = L.marker([tete.lat,tete.lng],{
        icon:L.divIcon({className:"mk mk-eph mk-pile",
          html:htmlMarqueur(tete)+'<i class="evc-plus">+'+(g.length-1)+'</i>',
          iconSize:[0,0]}),
        riseOnHover:true, zIndexOffset:220
      }).addTo(map);
      m._pile = g;
      m.on("click", ()=>{
        mettreAJourProfil("clic", tete.cat);
        ouvrirPileCompacte(m._pile);
      });
      marqueurs.set(id, m);
      return;
    }
    const g = item.grappe;
    const lat = g.reduce((s,l)=>s+l.lat,0)/g.length;
    const lng = g.reduce((s,l)=>s+l.lng,0)/g.length;
    const id = "grappe:"+lat.toFixed(4)+","+lng.toFixed(4)+"x"+g.length;
    garder.add(id);
    if(marqueurs.has(id)) return;
    // l'emoji dominant dit de quoi la grappe est faite : « 🍽 18 » se lit,
    // « 18 » n'apprend rien
    const parCat = {};
    g.forEach(x=>{ parCat[x.cat] = (parCat[x.cat]||0) + 1; });
    const dominante = Object.keys(parCat).sort((a,b)=>parCat[b]-parCat[a])[0];
    const emo = (CATS[dominante]||{}).emoji || "";
    const m = L.marker([lat,lng],{
      icon:L.divIcon({className:"mk",
        html:'<span class="mk-in"><div class="grappe">'+emo+' '+g.length+'</div></span>',
        iconSize:[0,0]}),
      zIndexOffset:100
    }).addTo(map);
    m.on("click", ()=>allerVers([lat,lng], (mc)=>Math.min(mc.getZoom()+2, 17), {duration:.55}));
    marqueurs.set(id,m);
  });
  marqueurs.forEach((m,id)=>{ if(!garder.has(id)){ map.removeLayer(m); marqueurs.delete(id); } });
  /* L'ensemble des marqueurs vient d'être reconstruit : la résolution de
     collisions ne peut plus se fier à sa signature de vue précédente. */
  revisionMarqueurs++;
  // un redessin ne doit pas effacer la mise en avant du lieu regardé
  if(lieuEnAvant) mettreEnAvant(lieuEnAvant);
  // les étiquettes se départagent une fois les marqueurs réellement posés ; un
  // seul frame reste en attente même si plusieurs sources arrivent ensemble.
  planifierCollisions();
  PERF.travail("rendu_carte", debutCpu);
}

/* ================================================================== */
/*  Feuilles                                                          */
/* ================================================================== */

/* Pile d'écrans : Explorer → liste d'une catégorie → fiche d'un lieu.
   Chaque entrée est la fonction capable de réafficher son écran, ce qui rend
   le retour arrière possible sans dupliquer le rendu. */
let pileEcrans = [];
let typeFeuille = null;
/* La feuille de détail porte DEUX panneaux, jamais deux fiches : celui du lieu
   — ce que c'est — et celui du déplacement — comment y aller. `Y aller`
   bascule de l'un à l'autre sans rien reconstruire, « Retour » revient.
   Le défilement du lieu est retenu au passage : revenir doit reposer l'œil là
   où il en était, pas en haut d'une fiche qu'on avait déjà parcourue. */
let modeFeuille = "lieu";
let defilementFiche = 0;
let publicationModifiee = false;
let dernierFocusFeuille = null;
let profondeurHistorique = 0;
let ignorerProchainPop = false;
let actionApresAbandon = null;

function pousserEcran(fn){
  pileEcrans.push(fn);
  fn();
  history.pushState({autour:true, profondeur:pileEcrans.length}, "", location.href);
  profondeurHistorique++;
}

/* Basculer entre les deux panneaux. Rien n'est rendu, rien n'est demandé : on
   masque l'un, on montre l'autre. C'est ce qui rend le passage instantané et
   ce qui garantit qu'aucune requête de la fiche n'est rejouée au retour. */
function basculerModeFeuille(mode){
  const f = $("#feuille");
  const lieu = $("#ficheLieu");
  const itineraire = $("#ficheItineraire");
  if(!f || !lieu || !itineraire || mode === modeFeuille) return false;
  const versItineraire = mode === "itineraire";
  if(versItineraire) defilementFiche = f.scrollTop;
  modeFeuille = versItineraire ? "itineraire" : "lieu";
  lieu.hidden = versItineraire;
  itineraire.hidden = !versItineraire;
  /* Le « Retour » de la pile d'écrans appartient à la fiche du lieu. En mode
     itinéraire il y en aurait deux côte à côte, qui ne ramèneraient pas au
     même endroit. */
  const pile = f.querySelector("#btnRetour");
  if(pile) pile.hidden = versItineraire;
  f.scrollTop = versItineraire ? 0 : defilementFiche;
  return true;
}

function retourEcran(){
  if(profondeurHistorique > 0){ history.back(); return; }
  pileEcrans.pop();
  const precedent = pileEcrans[pileEcrans.length-1];
  if(precedent) precedent(); else demanderFermetureFeuille();
}

function ouvrirFeuille(html, options){
  const o = options || {};
  $("#voile").hidden=false;
  const f=$("#feuille");
  if(f.hidden) dernierFocusFeuille = document.activeElement;
  typeFeuille = o.kind || (typeFeuille === "publication" && pileEcrans.length > 1 ? "publication" : "contenu");
  layerManager.activate(typeFeuille === "publication" ? NOMS_COUCHES.publishModal : NOMS_COUCHES.placeDetails);
  f.setAttribute("aria-label", o.ariaLabel || (typeFeuille === "publication" ? "Publier un événement" : "Panneau Autour"));
  modeFeuille = "lieu";
  defilementFiche = 0;
  const retour = pileEcrans.length > 1
    ? '<button class="retour" id="btnRetour">‹ Retour</button>' : '';
  f.innerHTML='<button class="feuille-x" id="feuilleX" aria-label="Fermer">✕</button>'+
    '<button class="poignee" aria-label="Fermer"></button>'+retour+html;
  f.hidden=false;
  f.scrollTop = 0;
  f.querySelector("#feuilleX").onclick=()=>demanderFermetureFeuille();
  f.querySelector(".poignee").onclick=()=>demanderFermetureFeuille();
  const r = f.querySelector("#btnRetour");
  if(r) r.onclick = retourEcran;
  requestAnimationFrame(()=>{
    const cible = f.querySelector("input:not([disabled]),button:not([disabled]),select:not([disabled]),textarea:not([disabled])");
    if(cible) cible.focus({preventScroll:true});
  });
}
function fermerFeuille(options){
  const o = options || {};
  const profondeur = profondeurHistorique;
  const coucheFermee = typeFeuille === "publication" ? NOMS_COUCHES.publishModal : NOMS_COUCHES.placeDetails;
  pileEcrans = [];
  typeFeuille = null;
  if(!o.preserverPublication) publicationModifiee = false;
  $("#voile").hidden=true; $("#feuille").hidden=true;
  $("#abandonVoile").hidden=true;
  layerManager.deactivate(NOMS_COUCHES.confirmationDialog);
  layerManager.deactivate(coucheFermee);
  if(o.nettoyerHistorique !== false && profondeur > 0){
    profondeurHistorique = 0;
    ignorerProchainPop = true;
    history.go(-profondeur);
  }
  const avaitTrajet = ligneCouches.length > 0;
  effacerLignes();
  /* ON REVENAIT CHEZ SOI, PAS LÀ OÙ ON REGARDAIT.
     Cadrer un itinéraire dézoome souvent au point de réduire les lieux à des
     pastilles : il faut donc bien recadrer en fermant. Mais recadrer sur
     `positionMoi`, c'était ramener la carte sur le GPS de la personne — alors
     qu'elle explorait peut-être Roubaix depuis Lille. Elle ouvrait un parc,
     regardait le trajet, fermait la fiche, et se retrouvait à dix kilomètres
     de ce qu'elle était en train de lire, sans avoir rien demandé.
     On restaure la vue exacte d'avant le tracé. `positionMoi` ne sert plus que
     de dernier recours, quand aucune vue n'a été mémorisée. */
  if(avaitTrajet){
    if(vueAvantTrajet) allerVers(vueAvantTrajet.centre, vueAvantTrajet.zoom, {duration:.6});
    else if(positionMoi) allerVers(positionMoi, 16, {duration:.6});
  }
  vueAvantTrajet = null;
  const cible = dernierFocusFeuille;
  dernierFocusFeuille = null;
  requestAnimationFrame(()=>{
    const retour = cible && document.contains(cible) && cible.getClientRects().length
      ? cible : $('[data-nb="creer"]');
    if(retour && !retour.hidden) retour.focus();
  });
}

function afficherConfirmationAbandon(action){
  actionApresAbandon = action || (()=>fermerFeuille());
  const v = $("#abandonVoile");
  v.hidden = false;
  layerManager.activate(NOMS_COUCHES.confirmationDialog);
  $("#abandonContinuer").focus();
}

function demanderFermetureFeuille(action){
  const fermer = action || (()=>fermerFeuille());
  if(typeFeuille === "publication" && publicationModifiee){
    afficherConfirmationAbandon(fermer);
    return;
  }
  fermer();
}

$("#voile").onclick=()=>demanderFermetureFeuille();
$("#feuille").onclick=e=>e.stopPropagation();
$("#abandonDialog").onclick=e=>e.stopPropagation();
$("#abandonVoile").onclick=continuerPublication;
$("#abandonContinuer").onclick=continuerPublication;
$("#abandonConfirmer").onclick=()=>{
  const action = actionApresAbandon || (()=>fermerFeuille());
  actionApresAbandon = null;
  publicationModifiee = false;
  $("#abandonVoile").hidden=true;
  layerManager.deactivate(NOMS_COUCHES.confirmationDialog);
  action();
};

window.addEventListener("popstate", ()=>{
  if(ignorerProchainPop){ ignorerProchainPop=false; return; }
  if(profondeurHistorique > 0 && !$("#feuille").hidden){
    profondeurHistorique--;
    if(pileEcrans.length > 1){
      pileEcrans.pop();
      pileEcrans[pileEcrans.length-1]();
      return;
    }
    if(typeFeuille === "publication" && publicationModifiee){
      history.pushState({autour:true, profondeur:1}, "", location.href);
      profondeurHistorique++;
      afficherConfirmationAbandon(()=>fermerFeuille());
      return;
    }
    fermerFeuille({nettoyerHistorique:false});
    return;
  }
  if(ignorerPopFeuilleBesoins){ ignorerPopFeuilleBesoins=false; return; }
  if(historiqueFeuilleBesoins && feuilleNiveau !== null){
    historiqueFeuilleBesoins=false;
    fermerFeuille2({nettoyerHistorique:false});
    return;
  }
});

function elementsFocusables(conteneur){
  return [...conteneur.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(el=>!el.hidden && el.getClientRects().length);
}

document.addEventListener("keydown", e=>{
  const abandonOuvert = !$("#abandonVoile").hidden;
  const feuilleOuverte = !$("#feuille").hidden;
  if(e.key === "Escape"){
    if(abandonOuvert){ e.preventDefault(); continuerPublication(); return; }
    if(feuilleOuverte){
      e.preventDefault();
      if(pileEcrans.length > 1) retourEcran(); else demanderFermetureFeuille();
      return;
    }
    if(modeNav){ e.preventDefault(); quitterNav(); return; }
    /* AVANT la feuille de besoins, et la raison est dans le CSS, pas dans une
       préférence : `#pourToi` est à z-index 900, `#feuilleBesoins` à 640. Le
       panneau est donc littéralement par-dessus, et Escape ferme ce qu'on voit
       au-dessus. Placé après, il ne s'exécutait jamais — la feuille d'accueil
       est ouverte quasiment tout le temps, et elle interceptait la touche. */
    if(pourToiOuvert()){ e.preventDefault(); fermerPourToi(); return; }
    if(feuilleNiveau !== null){ e.preventDefault(); fermerFeuille2(); return; }
    if(modePose){ e.preventDefault(); fermerModePose(); return; }
    if($("#rech") && $("#rech").value){ e.preventDefault(); $("#btnFermerRech").click(); }
    return;
  }
  if(e.key !== "Tab" || (!abandonOuvert && !feuilleOuverte)) return;
  const conteneur = abandonOuvert ? $("#abandonDialog") : $("#feuille");
  const focusables = elementsFocusables(conteneur);
  if(!focusables.length){ e.preventDefault(); conteneur.focus(); return; }
  const premier = focusables[0], dernier = focusables[focusables.length-1];
  if(e.shiftKey && document.activeElement === premier){ e.preventDefault(); dernier.focus(); }
  else if(!e.shiftKey && document.activeElement === dernier){ e.preventDefault(); premier.focus(); }
});

/* BALAYER POUR FERMER, SANS CONFISQUER LE DÉFILEMENT.

   Ce panneau défile (`overflow-y:auto`) et écoutait le balayage sur
   lui-même : tirer la liste vers le bas de plus de quatre-vingt-dix pixels —
   c'est-à-dire faire défiler normalement — la fermait. Un seul geste, deux
   comportements concurrents, dont un que personne n'a demandé.

   Un balayage ne ferme donc que s'il PART DU HAUT et n'a rien fait défiler.
   C'est la règle des panneaux natifs : en haut de liste, tirer vers le bas
   ferme ; partout ailleurs, tirer vers le bas fait défiler, un point c'est
   tout. On relit `scrollTop` à l'arrivée parce qu'un geste peut commencer en
   haut et défiler quand même — dans ce cas il a servi à défiler, pas à
   fermer. */
let debutBalayageFeuille = null;
const feuilleDetail = $("#feuille");
feuilleDetail.addEventListener("touchstart", e=>{
  if(e.touches.length > 1){ debutBalayageFeuille = null; return; }  // pincement
  const t=e.changedTouches[0];
  debutBalayageFeuille={x:t.clientX, y:t.clientY, scroll:feuilleDetail.scrollTop};
},{passive:true});
feuilleDetail.addEventListener("touchend", e=>{
  if(!debutBalayageFeuille) return;
  const depart = debutBalayageFeuille;
  debutBalayageFeuille=null;
  if(depart.scroll > 2) return;                    // on ne partait pas du haut
  if(feuilleDetail.scrollTop > 2) return;          // le geste a servi à défiler
  const t=e.changedTouches[0], dy=t.clientY-depart.y;
  const dx=Math.abs(t.clientX-depart.x);
  if(dy>90 && dx<70) demanderFermetureFeuille();
},{passive:true});
// un geste interrompu n'est pas un geste : il ne doit rien déclencher plus tard
feuilleDetail.addEventListener("touchcancel", ()=>{ debutBalayageFeuille=null; },
  {passive:true});

/* Google renvoie les sept lignes d'horaires en commençant par lundi ;
   getDay() commence par dimanche, d'où le décalage. */
function horaireDuJour(l){
  if(!l.horaires || !l.horaires.length) return "";
  const i = (new Date().getDay() + 6) % 7;
  const ligne = l.horaires[i] || "";
  return ligne.replace(/^[^:]*:\s*/, "");        // « Lundi : 9h–18h » → « 9h–18h »
}

/* UN ÉVÉNEMENT PORTE SES HEURES DANS SES DATES, PAS DANS `opening_hours`.

   `libelleHoraires` ne connaissait que deux sources : la grille hebdomadaire
   d'un commerce, et le `quand` d'une fiche OSM. Un événement canonique n'a ni
   l'une ni l'autre — `versEvenementCanonique` pose `debutLe` et `finLe`, et
   rien ne les traduisait. Le vide-greniers du Touquet Saint-Gérard s'affichait
   donc « Horaires inconnus » alors que la base connaît 12h00–18h00 avec
   `date_confidence = exact`.

   Quand la source ne donne que le jour, on écrit le jour et on s'arrête :
   inventer une heure serait pire que de n'en donner aucune. */
function horairesEvenement(l){
  const estUnEvenement = l && (l.isTemporary === true || l.entity_type === "event" || l.eventCanonical);
  if(!estUnEvenement) return "";
  const T = (typeof window !== "undefined" && window.AutourTemps) ||
    (typeof globalThis !== "undefined" && globalThis.AutourTemps);
  const evenement = (typeof donneesEvenement === "function" ? donneesEvenement(l) : null) || l;
  const libelle = T && T.libelleDate
    ? T.libelleDate(evenement, Date.now(), {ignoreStatus:true}) : "";
  return libelle && libelle !== "Date à vérifier" ? libelle : "Horaires à vérifier";
}

function libelleHoraires(l){
  /* Une fiche d'événement ne lit jamais son horaire dans le texte historique
     d'un lieu : la période structurée, et elle seule, décide. */
  const evenement = horairesEvenement(l);
  if(evenement && evenement !== "Horaires à vérifier") return evenement;
  if(!l) return "Horaires inconnus";
  if(estTemporaire(l)) return "Horaires à vérifier";
  /* Pour un lieu permanent, le badge et le détail doivent parler au même
     résolveur. Cela empêche un `24/7` OSM suspect de réapparaître comme une
     ouverture certaine dans la fiche. */
  const dispo = dispoDe(l);
  if(dispo && (dispo.status !== "unknown" || dispo.conflict || dispo.suspect24h7))
    return dispo.label;
  const horaire = horaireDuJour(l);
  if(horaire) return horaire;
  if(l.quand && !/^(Voir sur place|Horaires indicatifs)$/i.test(l.quand)) return l.quand;
  const lieu = donneesLieu(l);
  return ENTITES && ENTITES.horaireLieu && lieu
    ? ENTITES.horaireLieu(lieu) : "Horaires inconnus";
}

function horairesSemaine(l){
  if(!l.horaires || !l.horaires.length) return "";
  const dispo = dispoDe(l);
  if(dispo && (dispo.conflict || dispo.suspect24h7 || dispo.status === "unknown"))
    return '<p class="horaires-verif">'+esc(libelleHoraires(l))+'</p>';
  const aujourdhui = (new Date().getDay() + 6) % 7;
  return '<details class="horaires"><summary>Horaires de la semaine</summary>'+
    l.horaires.map((h,i)=>
      '<div class="h-ligne'+(i===aujourdhui?' h-jour':'')+'">'+esc(h)+'</div>').join("")+
    '</details>';
}

/* Enregistrer : un repère qu'on retrouve, gardé sur l'appareil. */
let gardes = new Set();
try{ gardes = new Set(JSON.parse(localStorage.getItem("autour:gardes")||"[]")); }catch(e){}
const estGarde = (id)=>gardes.has(id);
function basculerGarde(id){
  if(gardes.has(id)) gardes.delete(id); else gardes.add(id);
  try{ localStorage.setItem("autour:gardes", JSON.stringify([...gardes])); }catch(e){}
  return gardes.has(id);
}

/* ---- « À quoi ça sert ? » -----------------------------------------------
   Le texte vient du moteur d'explications : d'abord ce que publie la source
   ouverte ou la structure, sinon ce qu'OpenStreetMap en dit, sinon ce que fait
   ce type de structure. La provenance est écrite : une explication de réseau
   ne doit pas se lire comme une phrase écrite par l'antenne du coin. */
function blocExplication(l){
  if(estTemporaire(l)) return "";
  if(!EXPLIQUE) return "";
  const e = EXPLIQUE.explication(l);
  if(!e.texte && !e.public) return "";
  return '<section class="expli" id="expliBloc" data-pour="'+esc(String(l.id))+'" '+
    'data-source="'+esc(e.source||"")+'">'+
    (e.texte ? '<p class="expli-txt">'+esc(e.texte)+'</p>' : '')+
    (e.public ? '<p class="expli-public">'+esc(e.public)+'</p>' : '')+
    (e.mention ? '<p class="expli-src">'+esc(e.mention)+'</p>' : '')+
    '</section>';
}

/* Les informations sociales d'une fiche Aide restent celles du réseau ou de
   la structure. Google peut compléter une fiche commerciale, jamais inventer
   des conditions d'accès, un public accueilli ou une gratuité. */
function completerExplication(l){
  if(!l || !l.idGoogle || estFicheAide(l) || l.description) return;
  if(estTemporaire(l)) return;
  descriptifGoogle(l.idGoogle).then(texte=>{
    if(!texte) return;
    l.description=texte;
    const bloc=$("#expliBloc");
    if(bloc && bloc.dataset.pour===String(l.id)) bloc.outerHTML=blocExplication(l);
  });
}

function noteVacances(l){
  if(l.cat !== "ecole") return "";
  const v = vacancesScolaires(new Date());
  if(!v) return "";
  return '<p class="non-verifie">Nous sommes '+(v.sur ? "en " : "probablement en ")+v.nom+
    ' : l’établissement est sans doute fermé.</p>';
}

function urlSiteSure(value){
  if(!value) return "";
  try{
    const url = new URL(String(value));
    return /^https?:$/.test(url.protocol) ? url.href : "";
  }catch(e){ return ""; }
}

function estFicheAide(l){
  return !!(modeAide && l && (SET_AIDE.has(l.cat) || l.aideRaison));
}

function attributionPhoto(l){
  const brut = l && l.imageAttribution;
  const auteurs = Array.isArray(brut) ? brut : (brut ? [{name:brut,url:""}] : []);
  if(!auteurs.length) return "";
  return auteurs.map(a=>{
    const nom = esc(a && a.name || "");
    const url = urlSiteSure(a && a.url);
    return url ? '<a href="'+esc(url)+'" target="_blank" rel="noopener">© '+nom+'</a>' : '© '+nom;
  }).join(" · ");
}

function provenanceImage(l){
  if(!l) return "";
  const media = mediaDe(l);
  const photo = l.imageAttribution ? attributionPhoto(l) : "";
  if(photo) return "Photo : "+photo;
  const url = urlSiteSure(media.image_source_url || l.imageSourceUrl);
  if(!url) return "";
  const noms = {
    openagenda:"Agenda officiel", datatourisme:"DATAtourisme",
    structure:"Organisateur", site_officiel:"Lieu officiel",
    autour:"Autour", wikimedia_commons:"Wikimedia Commons",
  };
  const nom = noms[media.image_source || l.imageSource] || "Source déclarée";
  return '<a href="'+esc(url)+'" target="_blank" rel="noopener">Source : '+esc(nom)+'</a>';
}

/* Une image est un fait, pas une décoration : les fiches Aide n'emploient que
   des photos dont on sait dire l'origine — une licence ouverte explicite, une
   structure vérifiée, Commons, l'affiche d'un organisateur, le site officiel
   du lieu, ou une photo Google affichée avec son crédit.

   La liste n'est plus recopiée ici : c'est celle du résolveur, et les sources
   qu'il apprend à reconnaître y entrent sans qu'on ait à y penser. Les deux
   étiquettes historiques restent acceptées, le temps que le cache local des
   anciennes sessions se renouvelle.

   Ce qui n'a pas de provenance connue garde la couverture graphique de
   catégorie, sans aucune pénalité dans le classement. */
function photoAutoriseeAide(l){
  if(!l || !l.image) return "";
  const origine = l.imageSource || "";
  if(IMAGES && IMAGES.SOURCES.includes(origine)) return l.image;
  return ["datatourisme_licence", "autour_verifie"].includes(origine) ? l.image : "";
}

function couvertureAide(l, c){
  const photo = photoAutoriseeAide(l);
  const teinte = COULEURS_CAT[l.cat] || "#B82A3A";
  return '<figure class="aide-couverture" style="--teinte:'+teinte+'">'+
    '<span aria-hidden="true">'+c.emoji+'</span>'+
    (photo ? '<img src="'+esc(photo)+'" loading="lazy" decoding="async" alt=""'+
      ' onload="imageEvenementChargee(this)" onerror="imageEvenementErreur(this)">' : '')+
    (photo && l.imageAttribution ? '<figcaption>Photo : '+attributionPhoto(l)+'</figcaption>' : '')+
    '</figure>';
}

function couvertureEvenement(l, c){
  const media = mediaDe(l);
  const photo = media && media.image_url ? media.image_url : "";
  const teinte = COULEURS_CAT[l && l.cat] || "#E23A8C";
  const typeImage = media && media.image_type || "";
  return '<figure class="event-couverture'+(photo?'':' image-absente')+'"'+
    (typeImage ? ' data-image-type="'+esc(typeImage)+'"' : '')+
    ' data-image-scope="evenement"'+
    ' style="--teinte:'+teinte+'">'+
    fallbackVisuelEvenement(l, c, "event-fallback-detail")+
    (photo ? '<img src="'+esc(photo)+'" loading="lazy" decoding="async" alt=""'+
      ' onload="imageEvenementChargee(this)" onerror="imageEvenementErreur(this)">' : '')+
    (photo && provenanceImage(l) ? '<figcaption>'+provenanceImage(l)+'</figcaption>' : '')+
    '</figure>';
}

function couvertureLieu(l, c){
  if(!l) return "";
  const media = mediaDe(l);
  const photo = media && media.image_url ? media.image_url : "";
  return '<figure class="aide-couverture'+(photo?'':' sans-photo')+'"'+
    (media.image_type ? ' data-image-type="'+esc(media.image_type)+'"' : '')+
    ' data-image-scope="lieu"'+
    ' style="--teinte:'+(COULEURS_CAT[l.cat]||"#5D6B63")+'">'+
    '<span aria-hidden="true">'+c.emoji+'</span>'+
    (photo ? '<img src="'+esc(photo)+'" loading="lazy" decoding="async" alt=""'+
      ' onload="imageEvenementChargee(this)" onerror="imageEvenementErreur(this)">' : '')+
    (photo && l.imageAttribution ? '<figcaption>Photo : '+attributionPhoto(l)+'</figcaption>' : '')+'</figure>';
}

function sourceAide(l){
  const source = l && (l.source || ((l.sources || [])[0])) || "";
  const libelles = {
    openstreetmap:"OpenStreetMap", google_places:"Google Maps", datatourisme:"DATAtourisme",
    autour:"Autour", openagenda:"Agenda officiel",
  };
  return libelles[source] || (l && l.par) || "Source non renseignée";
}

function libelleSourceEvenement(source){
  const libelles = {
    openagenda:"OpenAgenda",
    datatourisme:"DATAtourisme",
    venue_official:"Site officiel du lieu",
    organizer_official:"Site officiel de l’organisateur",
    openstreetmap:"OpenStreetMap",
    autour:"Autour",
  };
  return libelles[source] || source || "Source à vérifier";
}

function dateMiseAJourAide(l){
  const brute = l && (l.updated_at || l.updatedAt || l.horairesVusLe || l.prixVuLe || l.created_at);
  const date = brute ? new Date(brute) : null;
  return date && Number.isFinite(date.getTime())
    ? date.toLocaleDateString("fr-FR", {day:"numeric", month:"long", year:"numeric"}) : "";
}

function statutAide(l){
  if(estTemporaire(l)){
    return TEMPS.libelleTemporel(l, Date.now(), {disponibilite:(x,t)=>dispoDe(x, null, t)});
  }
  return libelleOuverture(l);
}

/* ================================================================== */
/*  Trajet : marche et vélo internes via OSRM. Voiture et transports */
/*  sont délégués aux applications qui maintiennent ces réseaux.      */
/* ================================================================== */

const VITESSES_KMH = { pied:4.5, velo:15 }; // repli si OSRM est injoignable
const EMOJI_MODE = { pied:"🚶", velo:"🚲" };
const LABEL_MODE = { pied:"À pied", velo:"Vélo" };

function quitterNav(){
  if(!modeNav) return;
  modeNav = false;
  document.body.classList.remove("nav");
  $("#navBarre").hidden = true;
  ["#navBas","#appHeader","#btnTransports","#attribution"]
    .forEach(s=>{ const el=$(s); if(el) el.hidden = false; });
  majFiltres(); majRaccourcis();
  effacerLignes();
  $("#voile").hidden = false; $("#feuille").hidden = false;  // la fiche revient
  rendre();                                                   // et les marqueurs aussi
  majBoutons();
}

/* serveurs de démonstration publics OSRM (FOSSGIS/OpenStreetMap.de) — gratuits,
   sans clé, mais non garantis pour un usage intensif : on bascule sur une
   estimation à vol d'oiseau s'ils ne répondent pas */
const OSRM_PROFILS = {
  pied:    "https://routing.openstreetmap.de/routed-foot/route/v1/foot/",
  velo:    "https://routing.openstreetmap.de/routed-bike/route/v1/bike/"
};

function tempsTrajetMinutes(distanceMetres, kmh){
  return Math.max(1, Math.round((distanceMetres/1000) / kmh * 60));
}


function coordonneeItineraire(point){
  return Number(point[0]).toFixed(6)+","+Number(point[1]).toFixed(6);
}

/* Un lien qui ouvre vraiment le lieu chez l'autre personne, au lieu de la
   déposer sur la carte sans contexte. */
/* ---- Adresses partageables ----------------------------------------------
   Les liens étaient de la forme `#l=lat,lng|titre`. Un fragment n'est jamais
   envoyé au serveur : aucune plateforme ne peut en tirer un titre, une image
   ni une description, et tous les liens partagés se ressemblaient donc.

   Les liens émis sont maintenant des chemins — `/l/<lat>,<lng>/<titre>` pour
   un lieu, `/e/<id>` pour un événement publié — que Vercel réécrit vers
   l'application. C'est la forme qu'une fonction serveur pourra intercepter
   pour poser de vraies métadonnées Open Graph (voir docs/partage-og.md).
   Les anciens liens continuent d'ouvrir exactement le même lieu : la lecture
   accepte les deux formes, et ce n'est pas près de changer. */
const slug = (t)=>String(t||"").toLowerCase()
  .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").slice(0,60);

function lienVers(l){
  const u = new URL(location.href);
  u.hash = "";
  u.search = "";
  // un événement publié a une identité stable côté base : on la garde
  if(l.dbId){
    u.pathname = "/e/"+encodeURIComponent(l.dbId)+(slug(l.titre) ? "/"+slug(l.titre) : "");
    return u.toString();
  }
  u.pathname = "/l/"+l.lat.toFixed(5)+","+l.lng.toFixed(5)+
    (slug(l.titre) ? "/"+slug(l.titre) : "");
  return u.toString();
}

function lieuPartage(){
  // forme actuelle : /l/<lat>,<lng>[/<titre>] ou /e/<id>[/<titre>]
  const chemin = /^\/(l|e)\/([^/]+)(?:\/([^/]*))?\/?$/.exec(location.pathname||"");
  if(chemin){
    const [, type, cle, titre] = chemin;
    if(type === "e") return { dbId:decodeURIComponent(cle), lat:null, lng:null,
                              titre: titre ? decodeURIComponent(titre) : "" };
    const c = /^(-?[\d.]+),(-?[\d.]+)$/.exec(decodeURIComponent(cle));
    if(c) return { lat:parseFloat(c[1]), lng:parseFloat(c[2]),
                   titre: titre ? decodeURIComponent(titre) : "" };
  }
  // forme historique : #l=lat,lng|titre — les liens déjà partagés vivent
  const m = /^#l=(-?[\d.]+),(-?[\d.]+)(?:\|(.*))?$/.exec(location.hash||"");
  if(!m) return null;
  return { lat:parseFloat(m[1]), lng:parseFloat(m[2]),
           titre: m[3] ? decodeURIComponent(m[3]) : "" };
}

/* Une fois les lieux chargés, on ouvre celui que le lien désignait. */
let partageOuvert = false;
function ouvrirLieuPartage(){
  if(partageOuvert) return;
  const p = lieuPartage();
  if(!p) return;
  const cible = p.dbId != null
    ? lieux.find(l=>String(l.dbId) === String(p.dbId))
    : lieux.find(l=>distanceM(l.lat,l.lng,p.lat,p.lng) < 60);
  if(!cible) return;                 // les lieux ne sont pas encore tous arrivés
  partageOuvert = true;
  allerVers([cible.lat,cible.lng], 17, {duration:.8});
  setTimeout(()=>{ pileEcrans=[]; pousserEcran(()=>ouvrirDetail(cible.id)); }, 850);
}

async function partagerLieu(l){
  const url = lienVers(l);
  const txt = l.titre+" — "+l.adresse+", "+l.cp+" · "+l.quand;
  try{
    if(navigator.share) await navigator.share({title:l.titre,text:txt,url});
    else { await navigator.clipboard.writeText(txt+"\n"+url); toast("Lien copié"); }
  }catch(e){}
}
async function partagerApp(){
  try{
    if(navigator.share) await navigator.share({title:"Autour",text:"Ce qui se passe autour de toi",url:location.href});
    else { await navigator.clipboard.writeText(location.href); toast("Lien copié"); }
  }catch(e){}
}

/* ================================================================== */
/*  Publication                                                       */
/* ================================================================== */

let brouillon=null, retourFormulaire=false;

/* ---------- dates ---------- */
function aujourdHui(){ const d=new Date(); d.setMinutes(0,0,0); return d; }
function isoDate(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function prochaineHeure(){
  const d=new Date(); d.setMinutes(0,0,0); d.setHours(d.getHours()+1);
  return String(d.getHours()).padStart(2,"0")+":00";
}
function prochainSamedi(){
  const d=aujourdHui(); const j=d.getDay();
  d.setDate(d.getDate() + ((6-j)+7)%7 || 7);
  return d;
}
function libelleQuand(b){
  if(!b.date) return "";
  const [a,m,j] = b.date.split("-").map(Number);
  const d = new Date(a, m-1, j);
  const jour = new Intl.DateTimeFormat("fr-FR",{weekday:"long",day:"numeric",month:"long"}).format(d);
  const h = b.heure ? " · " + b.heure.replace(":","h") : "";
  const f = (b.heure && b.fin) ? " → " + b.fin.replace(":","h") : "";
  return jour.charAt(0).toUpperCase()+jour.slice(1) + h + f;
}

function ouvrirModePose(){
  modePose=true;
  $("#viseur").hidden=false; $("#poseBarre").hidden=false;
  $("#navBas").hidden=true; $("#btnTransports").hidden=true;
  $("#btnPartager").hidden=true;
  $("#feuilleBesoins").hidden=true;
  $("#poseBarre .txt").textContent = retourFormulaire
    ? "Déplace la carte pour corriger l’endroit."
    : "Déplace la carte : l’épingle se pose ici.";
}
function fermerModePose(){
  modePose=false;
  $("#viseur").hidden=true; $("#poseBarre").hidden=true;
  $("#navBas").hidden=false; $("#btnTransports").hidden=false;
  majBoutons();
  majRaccourcis(); majFeuille2();
}
/* Décode n'importe quel format que le navigateur sait lire — HEIC compris sur
   iOS —, applique l'orientation EXIF, borne le grand côté et réencode en JPEG.
   Rend null si le décodage échoue : on retombe alors sur le fichier d'origine
   plutôt que de bloquer la publication. */
const IMAGE_COTE_MAX = 1600;
async function preparerImage(fichier){
  if(!fichier || !/^image\//.test(fichier.type || "")) return null;
  try{
    const bitmap = await createImageBitmap(fichier, {imageOrientation:"from-image"});
    const ratio = Math.min(1, IMAGE_COTE_MAX / Math.max(bitmap.width, bitmap.height));
    const largeur = Math.max(1, Math.round(bitmap.width * ratio));
    const hauteur = Math.max(1, Math.round(bitmap.height * ratio));
    const toile = document.createElement("canvas");
    toile.width = largeur; toile.height = hauteur;
    toile.getContext("2d").drawImage(bitmap, 0, 0, largeur, hauteur);
    if(bitmap.close) bitmap.close();
    const blob = await new Promise(r=>toile.toBlob(r, "image/jpeg", .82));
    if(!blob) return null;
    return new File([blob], "affiche.jpg", {type:"image/jpeg", lastModified:Date.now()});
  }catch(e){
    return null;   // format illisible : on laisse le fichier d'origine tenter sa chance
  }
}

function nouveauBrouillon(){
  const c=pointCarte();
  // le type a déjà été choisi à l'étape précédente : on ne le redemande pas
  return {lat:c.lat, lng:c.lng, titre:"", adresse:"", cat:typeAvantPose || "popup",
          date:isoDate(aujourdHui()), heure:prochaineHeure(), fin:"",
          gratuit:true, prix:5, limite:false, places:20, qr:false,
          imageFichier:null, imageApercu:""};
}
function validerPose(){
  const c = pointCarte();
  if(retourFormulaire && brouillon){
    brouillon.lat=c.lat; brouillon.lng=c.lng;
    publicationModifiee = true;
  }else{
    brouillon = nouveauBrouillon();
    publicationModifiee = false;
  }
  // « C'est là » choisit un point de recherche. Il n'altère jamais le repère
  // bleu de géolocalisation, qui continue de représenter uniquement l'utilisateur.
  chargerAutourDuPoint(c.lat,c.lng,{force:true});
  retourFormulaire = false;
  fermerModePose();
  pileEcrans = [];
  pousserEcran(dessinerFormulaire);
}

/* Lieux permanents proches où rien n'est encore prévu aujourd'hui : proposer
   une adresse qui existe déjà évite les événements posés au milieu de nulle part. */
function lieuxLibres(){
  const [lat,lng] = positionMoi;
  return lieux
    .filter(l=>!estTemporaire(l))
    .filter(l=>!indexEvenements.get(l.titre))
    .map(l=>Object.assign({}, l, {dist:distanceM(lat,lng,l.lat,l.lng)}))
    .sort((a,b)=>a.dist-b.dist)
    .slice(0,15);
}

async function chercherAdresse(q){
  try{
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=json&limit=6&q="+
      encodeURIComponent(q));
    if(!r.ok) return [];
    return (await r.json()).map(a=>({
      nom:a.display_name, lat:parseFloat(a.lat), lng:parseFloat(a.lon)
    }));
  }catch(e){ console.error("Recherche d’adresse :", e); return []; }
}

/* ---- Publication immédiate ------------------------------------------------
   Publier attendait le téléversement de l'affiche PUIS l'insertion en base
   avant que quoi que ce soit n'apparaisse : sur un réseau moyen, plusieurs
   secondes pendant lesquelles le formulaire restait ouvert et rien ne disait
   si ça avait marché. Or l'événement, on le connaît entièrement au moment où
   on appuie sur « Publier » — le serveur ne fait que le confirmer.

   L'affiche est donc posée sur la carte tout de suite, et l'aller-retour se
   fait derrière. S'il traîne, ça se voit : le statut s'écrit sur l'affiche
   elle-même, à la place du prix et du nombre de places, en gros. Et s'il
   échoue, l'affiche le dit et se retente d'un appui — le brouillon n'est
   jamais perdu en silence. */
const ATTENTE_VISIBLE_MS = 2000;   // au-delà, on annonce le retard
const publicationsEnVol = new Map();

function marquerPublication(id, etat){
  const p = userPublications.find(x=>x.id === id);
  if(!p) return;
  p.envoi = etat;                  // "envoi" | "retard" | "echec" | undefined
  reconstruireLieux();
  planifierRendu({carte:true, feuille:true});
}

/* ================================================================== */

/* ================================================================== */
/*  Classement d'une catégorie                                        */
/* ================================================================== */

/* ======================================================================
   Fournisseur Google Places (façade de compatibilité)

   La page ne lit plus aucune réponse Places : le provider la normalise dans
   le contrat Autour (`autourId`, `name`, `photos`, `sourceRefs`…), puis cette
   façade alimente le noyau historique. La clé est une clé navigateur
   restreinte aux référents et aux SDK/API Google nécessaires ; ce n'est pas
   une clé serveur et aucun autre secret n'est envoyé au navigateur.
   ====================================================================== */
const CLE_GOOGLE = "AIzaSyAFjDL4NtNNaTFhD-tbN4escj8xQ9Mpio4";
const GOOGLE_CONFIG = Object.freeze({apiKey:CLE_GOOGLE, defaultCategory:"commerce"});
const TYPES_RESTO = ["restaurant","cafe","bar","bakery","meal_takeaway"];
const NIVEAU_PRIX = window.AutourProviders && AutourProviders.googlePlaces
  ? AutourProviders.googlePlaces.niveauxPrix : {};
const SYMBOLE_PRIX = ["Gratuit","€","€€","€€€","€€€€"];
const AVEC_PRIX = new Set(["resto","fastfood","cafe","bar","commerce","friperie","marche"]);
const CAT_GOOGLE = window.AutourProviders && AutourProviders.googlePlaces
  ? AutourProviders.googlePlaces.typesVersCategorie : {};

function providerGoogle(){
  return window.AutourProviders && AutourProviders.googlePlaces;
}
function ficheGoogleInterne(fiche){
  const p = window.AutourProviders && AutourProviders.versInterne
    ? AutourProviders.versInterne(fiche) : null;
  if(!p) return null;
  return Object.assign(p, {
    nom:p.titre, type:(fiche && fiche.primaryType) || "", adresse:p.adresse || p.titre,
    image:p.image || "", idGoogle:(p.sourceRefs || {}).googlePlaceId || p.idGoogle || "",
    descriptionSource:p.description ? "google" : "",
  });
}
function photoGoogle(place){
  const fournisseur = providerGoogle();
  return fournisseur && fournisseur.normaliserPlace
    ? ((ficheGoogleInterne(fournisseur.normaliserPlace(place, GOOGLE_CONFIG)) || {}).image || "") : "";
}
function mapperPlace(place){
  const fournisseur = providerGoogle();
  return fournisseur ? ficheGoogleInterne(fournisseur.normaliserPlace(place, GOOGLE_CONFIG)) : null;
}

/* Les descriptions et compléments restent volatils : aucune réponse Places
   n'est recopiée dans le stockage local ou dans Supabase. */
async function descriptifGoogle(idGoogle){
  const fournisseur = providerGoogle();
  if(!fournisseur || !idGoogle) return "";
  try{
    const fiche = await fournisseur.details(idGoogle, GOOGLE_CONFIG);
    return fiche && fiche.description || "";
  }catch(e){ journal.warn("Descriptif Google indisponible"); return ""; }
}
async function enrichirGoogle(idGoogle){
  const fournisseur = providerGoogle();
  if(!fournisseur || !idGoogle) return null;
  try{ return ficheGoogleInterne(await fournisseur.details(idGoogle, GOOGLE_CONFIG)); }
  catch(e){ journal.warn("Enrichissement Google indisponible"); return null; }
}
const MAX_ENRICHIS = 5;

/* ---- Le calque vérifié : lire, puis demander -----------------------------

   `enrichir-lieu` est une fonction Edge protégée par `verify_jwt`. On l'appelle
   avec la clé PUBLIABLE — la même que pour toutes les autres lectures Supabase,
   publique par construction. Aucun secret privé ne descend dans la page, et
   `GEMINI_API_KEY` ne quitte jamais Supabase.

   Rien de ceci n'est attendu : l'écran a déjà été peint quand ça part. */
const ENR = window.AutourEnrichissements || null;

async function calqueVerifie(cles){
  if(!ENR || !cles.length || !(await connecter()) || !sbLecture) return new Map();
  const fini = PERF.requete("supabase_enrichissements");
  try{
    /* Une seule requête pour toute la vague : on ne demande pas lieu par lieu.
       Le cache est lisible par tous — c'est une lecture ordinaire, pas un
       appel de modèle, et elle ne coûte rien. */
    const { data, error } = await sbLecture
      .from("place_enrichments").select("*").in("place_key", cles.slice(0,50));
    if(error) return new Map();
    return new Map((data||[]).map(e=>[e.place_key, e]));
  }catch(e){ return new Map(); }
  finally{ fini(); }
}

async function demanderVerification(lieu, raisons){
  const cle = ENR && ENR.cleLieu(lieu.titre, lieu.lat, lieu.lng);
  if(!cle) return null;

  /* LE JETON DE LA PERSONNE, PAS LA CLÉ PUBLIABLE.

     `enrichir-lieu` garde `verify_jwt: true`, et c'est bien ce qu'on veut :
     elle veut savoir QUI demande. La clé publiable ne dit rien là-dessus —
     elle est dans la page, donc tout le monde l'a — et l'envoyer en
     `authorization` revenait à frapper à la porte sans se nommer.

     C'est `sb` qui porte la session. `sbLecture` est délibérément sans session
     (`persistSession:false`, stockage séparé) pour que les lectures publiques
     n'héritent jamais d'un vieux JWT : lui demander un jeton ne rendrait
     jamais rien.

     Personne de connectée : on ne demande rien, et on ne baisse surtout pas la
     garde côté serveur. Le lieu s'affiche avec ce qu'Autour sait déjà. */
  let session = null;
  try{
    if(!(await connecter())) return null;
    ({ data:{ session } } = await sb.auth.getSession());
  }catch(e){ return null; }
  if(!session || !session.access_token) return null;

  /* La réservation vient APRÈS le jeton : un candidat écarté faute de session
     ne doit pas rester marqué « déjà demandé », sinon il ne serait plus jamais
     vérifié une fois la personne connectée. */
  if(!ENR._reserver(cle)) return null;
  const fini = PERF.requete("enrichir_lieu");
  try{
    const r = await fetch(SUPABASE_URL+"/functions/v1/enrichir-lieu", {
      method:"POST",
      headers:{"content-type":"application/json",
        apikey:SUPABASE_CLE, authorization:"Bearer "+session.access_token},
      body:JSON.stringify({
        nom:lieu.titre, lat:lieu.lat, lng:lieu.lng,
        commune:lieu.cp || "", adresse:lieu.adresse || "",
        categorie:lieu.cat || "", horaires:lieu.quand || "",
      }),
      signal:AbortSignal.timeout(20000),
    });
    if(!r.ok) return null;
    const json = await r.json();
    /* Le serveur vient de dire que le plafond du jour est atteint. Insister
       lieu après lieu ne changera rien : on arrête d'ouvrir cette porte pour
       le reste de la session. */
    if(json && json.raison === "budget du jour atteint") budgetVerificationEpuise = true;
    journal.info("enrichissement", lieu.titre, raisons.join(","), json.origine || "?");
    return json && json.enrichissement ? json.enrichissement : null;
  }catch(e){
    /* Une panne du modèle, un délai, un réseau coupé : Autour garde ce qu'il
       montrait. C'est la seule propriété qui compte ici. */
    return null;
  }finally{ ENR._liberer(); fini(); }
}

function enrichirCandidats(classement, intention, redessiner){
  if(!DONNEES || !Array.isArray(classement)) return;
  const rendre1 = ()=>{ if(typeof redessiner === "function") redessiner(); };

  /* ---- Google : ce qui existait déjà, inchangé ---- */
  const aDemander = classement.filter(l=>l.idGoogle &&
    DONNEES.manque(l, intention, {disponibilite:(x,t)=>dispoDe(x, null, t)}).length).slice(0,MAX_ENRICHIS);
  Promise.all(aDemander.map(async l=>{
    const f = await enrichirGoogle(l.idGoogle); if(!f) return;
    ["prixN","horaires","ouvert","tel","url","note","avis","image"].forEach(cle=>{
      if(f[cle] != null && f[cle] !== "") l[cle] = f[cle];
    });
  })).then(rendre1);

  /* ---- Les photos réelles : après la peinture, et jamais attendues -------

     Les cartes sont déjà posées, avec leur tuile teintée. Le résolveur va
     voir si un vrai visuel existe pour les quelques lieux qu'on montre — les
     tags OSM d'abord, Wikimedia ensuite, Places en dernier — et repeint
     seulement s'il en trouve un. Une panne de Commons, un réseau coupé, un
     lieu sans photo : l'écran garde exactement ce qu'il montrait. C'est la
     seule propriété qui compte ici, et elle tient parce que rien de ceci
     n'est sur le chemin d'un rendu.

     `planifierRendu` regroupe les repeints par image : dix photos qui
     arrivent en rafale ne produisent pas dix rendus. */
  if(IMAGES) IMAGES.resoudreLot(classement, {redessiner:rendre1}).catch(()=>{});

  /* ---- Le calque vérifié : cache d'abord, appel ensuite ---- */
  if(!ENR) return;
  const candidats = classement.slice(0, ENR.MAX_CANDIDATS)
    .map(l=>({l, cle:ENR.cleLieu(l.titre, l.lat, l.lng), raisons:ENR.manques(l)}))
    .filter(x=>x.cle && x.raisons.length);
  if(!candidats.length) return;

  calqueVerifie(candidats.map(x=>x.cle)).then(async connus=>{
    let change = false;
    const aVerifier = [];
    candidats.forEach(x=>{
      const e = connus.get(x.cle);
      /* LE CACHE AVANT TOUT NOUVEL APPEL. Une entrée encore fraîche répond
         sans rien dépenser ; une entrée périmée s'affiche quand même — elle
         reste vraie plus souvent que rien — et déclenche une revérification. */
      if(e && ENR.appliquer(x.l, e)) change = true;
      const frais = e && e.expires_at && Date.parse(e.expires_at) > Date.now();
      if(!frais) aVerifier.push(x);
    });
    if(change) rendre1();
    for(const x of aVerifier){
      /* CE QUI MANQUE ENCORE, APRÈS LE CALQUE — pas ce qui manquait avant.

         `manques` avait été calculé sur le lieu NU. Le cache vient d'y poser
         des horaires, une programmation, une URL officielle : redemander une
         vérification pour ce qui vient d'être répondu est la dépense la plus
         inutile du système. On recalcule donc, et c'est le nouveau reste qui
         décide. */
      const restants = ENR.manques(x.l);
      const decision = deciderVerification(x.l, restants, connus.get(x.cle));
      if(!decision.autorise) continue;
      const e = await demanderVerification(x.l, decision.manques.length
        ? [...decision.manques] : x.raisons);
      if(e && ENR.appliquer(x.l, e)) rendre1();
    }
  });
}

/* LE BUDGET DU SERVEUR, VU DEPUIS LE NAVIGATEUR.

   Le plafond réel est côté base — c'est lui qui borne le coût, et lui seul.
   Mais quand il est atteint, continuer à frapper à la porte pour chaque lieu
   de chaque vague ne sert rien : le serveur répondra la même chose. La réponse
   le dit ; on l'écoute, et on cesse pour cette session. */
let budgetVerificationEpuise = false;

/* Les quatre portes, dans l'ordre. `territoire.js` les tient, et il est le
   seul à les tenir : ce fichier ne fait que lui donner ce qu'il sait. */
function deciderVerification(lieu, restants, entree){
  if(!TERR) return {autorise:restants.length > 0, manques:restants};
  const decision = TERR.enrichissementAutorise(lieu, {
    maintenant: Date.now(),
    manques: restants,
    cacheExpireLe: entree && entree.expires_at,
    budgetRestant: budgetVerificationEpuise ? 0 : 1,
    /* Une entrée produite par une source officielle a déjà répondu : ce qui
       ne figure plus dans `restants` a été rempli par elle. */
    sourceOfficielle: !!(entree && entree.source_priority &&
      entree.source_priority !== "tiers"),
  });
  if(decision.autorise){ compterTerritorial("territorial_gemini_requested"); return decision; }
  compterTerritorial(decision.raison === TERR.REFUS.BUDGET
    ? "territorial_gemini_budget_blocked"
    : "territorial_gemini_skipped_fresh_data");
  return decision;
}
async function chercherGoogle(q, lat, lng, opts){
  const o = opts || {};
  const fournisseur = providerGoogle();
  if(!fournisseur || !(await googleMapsActif())) return [];
  try{
    return (await fournisseur.search(q,lat,lng,GOOGLE_CONFIG,{signal:o.signal}))
      .map(ficheGoogleInterne).filter(Boolean);
  }
  catch(e){ if(!(e && e.name === "AbortError")) journal.warn("Recherche Google indisponible"); return []; }
}
async function placesGoogle(lat,lng,types,signal){
  const fournisseur = providerGoogle();
  if(!fournisseur || !(await googleMapsActif())) return [];
  try{
    PERF.requete("google_places");
    return (await fournisseur.nearby(lat,lng,GOOGLE_CONFIG,{types,signal})).map(ficheGoogleInterne).filter(Boolean);
  }
  catch(e){ if(!(e && e.name === "AbortError")) journal.warn("Google Places indisponible"); return []; }
}
async function notesGoogle(lat,lng,opts){
  const o = opts || {};
  const listes = [placesGoogle(lat,lng,null,o.signal)];
  if(o.resto) listes.push(placesGoogle(lat,lng,TYPES_RESTO,o.signal));
  const fiches = (await Promise.all(listes)).flat();
  const uniques = new Map();
  fiches.forEach(f=>{ if(f && f.nom) uniques.set(f.idGoogle || f.nom+"|"+f.lat.toFixed(4),f); });
  return [...uniques.values()];
}
const zonesResto = new Set();
const restaurationsEnCours = new Map();
function completerRestauration(opts){
  if(!centreDonnees()) return Promise.resolve([]);
  /* La restauration se complète dans la zone dont on parle, pas là où l'on
     dort : chercher Lille depuis Tourcoing allait chercher les restaurants de
     Tourcoing et les versait dans la carte de Lille. */
  const o=opts||{}, [lat,lng]=centreZoneActive()||positionMoi, cle=idZoneActive()+"#"+lat.toFixed(2)+","+lng.toFixed(2);
  if(o.force) zonesResto.delete(cle);
  if(zonesResto.has(cle)) return Promise.resolve([]);
  if(restaurationsEnCours.has(cle)) return restaurationsEnCours.get(cle);
  const generation = nouvelleGeneration("zone:restauration",cle,!!o.force);
  let promesse;
  promesse = placesGoogle(lat,lng,TYPES_RESTO,generation.signal).then(f=>{
    if(!generationCourante(generation) || !f.length) return [];
    // La zone n'est retenue qu'après une réponse réellement exploitable.
    zonesResto.add(cle);
    greffeNotes(lieux,f); ajouterLieuxGoogle(f); majAccueil();
    if(feuilleNiveau === "manger") majFeuille2();
    return f;
  }).catch(()=>[]).finally(()=>{
    if(restaurationsEnCours.get(cle) === promesse) restaurationsEnCours.delete(cle);
    terminerGeneration(generation);
  });
  restaurationsEnCours.set(cle,promesse);
  return promesse;
}
function ajouterLieuxGoogle(fiches,catDefaut){
  const ajouts=[];
  (fiches||[]).forEach(f=>{
    if(!f || !f.nom) return;
    const service=preciserService(f.nom);
    let cat=affinerCategorie(CAT_GOOGLE[f.type] || f.cat || f.autourCat || catDefaut,f.nom);
    if(/Mission locale|France Travail|Cap emploi|Maison de l’emploi/.test(service)) cat="emploi";
    else if(!cat && service) cat="asso";
    const dejaPresent=lieux.find(l=>{
      if(!l || estTemporaire(l) || distanceM(l.lat,l.lng,f.lat,f.lng)>=80) return false;
      const memeAdresse=adressesLieuxCompatibles(l.adresse,f.adresse);
      return (memeAdresse || nomsLieuxCompatibles(l.titre,f.nom)) &&
        (memeAdresse || familleDedupLieu(l)===familleDedupLieu({cat}));
    });
    if(!cat || dejaPresent){
      if(dejaPresent){
        appliquerFicheGoogle(dejaPresent,f);
        const canonique=permanentPlaces.find(l=>l.id===dejaPresent.id);
        if(canonique && canonique!==dejaPresent) appliquerFicheGoogle(canonique,f);
        planifierRendu({carte:true,accueil:true,feuille:true});
      }
      return;
    }
    ajouts.push(normaliserItem(Object.assign({},f,{id:f.id || f.autourId,cat,titre:f.nom,
      description:f.description||"",quand:"Voir sur place",
      gratuit:f.gratuit === true || f.prixN === 0 ? true : undefined,
      prix:f.prixN === 0 ? 0 : null,places:null,qr:false,
      par:"Google Maps",service,solidaire:f.solidaire===true||estSolidaire(f.nom,false),
      isAidProvider: f.isAidProvider === true ? true :
        (f.isAidProvider === false ? false : undefined),
      imageSource:f.imageSource||"google_places"}),"google_places"));
  });
  if(ajouts.length) fusionner(ajouts,"permanent");
  return ajouts.length;
}
function nomsLieuxCompatibles(nomA,nomB){
  const nettoyer=nom=>sansAccents(nom||"").replace(/[^a-z0-9]+/g," ").trim();
  const a=nettoyer(nomA),b=nettoyer(nomB); if(!a||!b) return false;
  if(a===b) return true;
  const ignorer=new Set(["le","la","les","de","du","des","chez","restaurant","resto","cafe","bar","brasserie","snack","fast","food","boulangerie"]);
  const mots=nom=>[...new Set(nom.split(/\s+/).filter(m=>m.length>2&&!ignorer.has(m)))];
  const aa=mots(a),bb=mots(b), communs=aa.filter(m=>bb.includes(m));
  if(aa.length===1 && bb.length===1 ? communs[0] && communs[0].length>=5
    : communs.length>=2 && communs.length/Math.min(aa.length,bb.length)>=2/3) return true;
  /* Une saisie OSM peut contenir une faute isolée alors que Places ajoute un
     suffixe de zone. Ce n'est pas une permission de fusionner deux homonymes :
     on exige le même premier mot, un autre mot long identique et une seule
     paire de mots suffisamment proche. */
  const distanceEdition=(x,y)=>{
    const ligne=Array.from({length:y.length+1},(_,i)=>i);
    for(let i=1;i<=x.length;i++){
      let diagonal=ligne[0]; ligne[0]=i;
      for(let j=1;j<=y.length;j++){
        const precedent=ligne[j];
        ligne[j]=Math.min(ligne[j]+1,ligne[j-1]+1,diagonal+(x[i-1]===y[j-1]?0:1));
        diagonal=precedent;
      }
    }
    return ligne[y.length];
  };
  const premierCommun=a.split(/\s+/)[0]===b.split(/\s+/)[0] && a.split(/\s+/)[0].length>=4;
  const autreCommun=communs.some(m=>m.length>=5);
  const fauteIsolee=aa.some(x=>x.length>=5 && bb.some(y=>y.length>=5 &&
    distanceEdition(x,y)<=Math.max(1,Math.floor(Math.max(x.length,y.length)*.2))));
  if(premierCommun && autreCommun && fauteIsolee) return true;
  /* La comparaison ci-dessus privilégie l'absence de faux positif. Entre une
     fiche OSM et Places, on peut aussi rencontrer une unique faute de frappe
     ou une ville ajoutée au nom commercial. À moins de 80 m (appelant), le
     premier mot doit être identique et le préfixe compact quasi identique. */
  const premierA=a.split(/\s+/)[0], premierB=b.split(/\s+/)[0];
  const compactA=a.replace(/\s/g,""), compactB=b.replace(/\s/g,"");
  if(!premierA || premierA.length<4 || premierA!==premierB || Math.min(compactA.length,compactB.length)<12) return false;
  const court=compactA.length<=compactB.length?compactA:compactB;
  const long=compactA.length<=compactB.length?compactB:compactA;
  let ligne=Array.from({length:court.length+1},(_,i)=>i);
  for(let i=1;i<=court.length;i++){
    let diagonal=ligne[0]; ligne[0]=i;
    for(let j=1;j<=court.length;j++){
      const precedent=ligne[j];
      ligne[j]=Math.min(ligne[j]+1,ligne[j-1]+1,diagonal+(court[i-1]===long[j-1]?0:1));
      diagonal=precedent;
    }
  }
  return 1-ligne[court.length]/court.length>=.9;
}
function adressesLieuxCompatibles(adresseA,adresseB){
  const nettoyer=adresse=>sansAccents(adresse||"").replace(/[^a-z0-9]+/g," ").trim();
  const a=nettoyer(adresseA),b=nettoyer(adresseB);
  return a.length>=8 && b.length>=8 && (a.includes(b) || b.includes(a));
}
function appliquerFicheGoogle(l,f){
  if(!l||!f) return;
  // La géométrie Places devient la référence d'un établissement homonyme :
  // l'identité reste Autour, les références OSM et Google restent toutes deux
  // attachées à la fiche pour permettre un futur changement de fournisseur.
  if(Number.isFinite(Number(f.lat)) && Number.isFinite(Number(f.lng))){ l.lat=f.lat; l.lng=f.lng; }
  // Le nom de Places est le nom commercial affiché par défaut. Une publication
  // Autour garde cependant exactement le titre choisi par son créateur.
  if(l.source!=="autour" && !l.dbId && f.nom){ l.titre=f.nom; l.title=f.nom; }
  ["note","avis","ouvert","prixN","horaires","tel","url","pmr","idGoogle","description",
   "accesSanteDocumente"].forEach(cle=>{
    if(f[cle] != null && f[cle] !== "") l[cle]=f[cle];
  });
  if(f.image && !l.image){ l.image=f.image; l.imageSource=f.imageSource||"google_places"; }
  l.sourceRefs=Object.assign({},l.sourceRefs||{},f.sourceRefs||{},f.idGoogle?{googlePlaceId:f.idGoogle}:{});
}
function greffeNotes(liste,fiches){
  (liste||[]).forEach(l=>{
    let meilleur=null,dMin=150;
    (fiches||[]).forEach(f=>{ const d=distanceM(l.lat,l.lng,f.lat,f.lng);
      if(d<dMin && (nomsLieuxCompatibles(l.titre,f.nom) || adressesLieuxCompatibles(l.adresse,f.adresse))){dMin=d;meilleur=f;} });
    if(meilleur){ appliquerFicheGoogle(l,meilleur);
      const canonique=permanentPlaces.find(x=>x.id===l.id); if(canonique&&canonique!==l) appliquerFicheGoogle(canonique,meilleur); }
  });
  planifierRendu({carte:true,accueil:true,feuille:true});
}

function distanceM(lat1,lng1,lat2,lng2){
  const R=6371000, r=Math.PI/180;
  const dLat=(lat2-lat1)*r, dLng=(lng2-lng1)*r;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
const formatDist = (m)=> m<1000 ? Math.round(m/10)*10+" m" : (m/1000).toFixed(1)+" km";

/* Certaines recommandations gardent leur distance de classement, d'autres
   repassent par leur objet d'origine avant « Voir tout ». Dans ce second cas,
   on la recalcule depuis la zone effectivement regardée. Sans coordonnées
   exploitables, mieux vaut ne rien afficher que promettre « NaN km ». */
function distancePourListe(l){
  const fournie = Number(l && l.dist);
  if(Number.isFinite(fournie)) return fournie;
  const calculee = distanceDepuisZone(l);
  return Number.isFinite(calculee) ? calculee : null;
}

/* événements éphémères qui se passent dans un lieu donné */
function evenementsDe(lieu){
  return lieux.filter(l=>dansZoneActive(l) && estTemporaire(l) && l.adresse === lieu.titre);
}

/* "auto" = pertinence · "note" = les mieux notés · "distance" = les plus proches */
let triListe = "auto";

function classerLieux(liste, sansPalmares){
  /* Depuis le point REGARDÉ, pas depuis soi. Classer les lieux d'une autre
     ville par leur distance à sa propre position les met tous à 220 km les uns
     des autres à un mètre près : l'ordre devient arbitraire, et ce qui compte
     dans cette ville-là n'arrive jamais en tête. Chez soi les deux points
     coïncident, et rien ne change. */
  const [lat,lng] = pointDeReference() || positionMoi;
  const dedans = (liste || []).filter(dansZoneActive).map(l=>{
    const d = distanceM(lat,lng,l.lat,l.lng);
    const evs = estTemporaire(l) ? [] : evenementsDe(l);
    return Object.assign({}, l, {dist:d, evs:evs.length, mien:!!l.mien});
  });

  dedans.sort((a,b)=>{
    // une banque alimentaire ou un foyer ne se classe pas : le plus proche d'abord
    if(sansPalmares) return a.dist - b.dist;
    if(triListe === "distance") return a.dist - b.dist;
    if(triListe === "prix"){
      // le moins cher d'abord, et à prix égal le mieux noté : le but est de
      // trouver ce qui fait économiser sans tomber sur ce que personne n'aime
      const pa = a.prixN==null ? 9 : a.prixN, pb = b.prixN==null ? 9 : b.prixN;
      if(pa !== pb) return pa - pb;
      const na = a.note||0, nb = b.note||0;
      if(na !== nb) return nb - na;
      return a.dist - b.dist;
    }
    if(triListe === "note"){
      // le nombre d'avis départage : 4,8 sur 6 avis pèse moins que 4,6 sur 800
      const na=a.note||0, nb=b.note||0;
      if(na !== nb) return nb - na;
      const va=a.avis||0, vb=b.avis||0;
      if(va !== vb) return vb - va;
      return a.dist - b.dist;
    }
    if(a.mien !== b.mien) return a.mien ? -1 : 1;          // tes ajouts d'abord
    if(a.note && b.note && a.note !== b.note) return b.note - a.note;  // note si dispo
    if(a.evs !== b.evs) return b.evs - a.evs;              // là où il se passe un truc
    return a.dist - b.dist;                                // sinon, le plus proche
  });
  return dedans;
}

function classer(cat){
  return classerLieux(lieux.filter(l=>correspondCategorie(l,cat)), SANS_CLASSEMENT.has(cat));
}

function ouvrirListe(cat){
  const c = CATS[cat]; if(!c) return;
  mettreAJourProfil("categorie", cat);
  // l'aide n'est cherchée que si quelqu'un la demande : dix recherches
  // facturées à chaque ouverture de l'app seraient absurdes
  if(SANS_CLASSEMENT.has(cat) && centreDonnees())
    chargerAideZone().then(()=>{
      if(filtreActif === cat) ouvrirListe(cat);
    });
  afficherListe(c.emoji, c.label, classer(cat), SANS_CLASSEMENT.has(cat),
                ()=>ouvrirListe(cat));
}

/* Une seule mise en page pour les listes d'une catégorie et les résultats de
   recherche. `sansPalmares` masque le tri et les notes (lieux d'aide). */
/* AU BOUT DE LA LISTE, UNE INTENTION — PAS CINQUANTE RÉSULTATS DE PLUS.

   Ni pagination infinie ni « Charger plus » : les deux transforment une
   sélection en catalogue, et personne ne choisit dans un catalogue. Quand la
   sélection s'arrête, ce qui manque n'est pas du volume, c'est une autre
   question — un autre moment, une autre catégorie, un autre endroit. */
function suitesUtiles(connus, montres){
  const gestes = [];
  if(creneau === "maintenant"){
    gestes.push(['<button class="suite" data-suite="soir">Ce soir</button>']);
    gestes.push(['<button class="suite" data-suite="weekend">Ce week-end</button>']);
  }
  gestes.push(['<button class="suite" data-suite="categorie">Changer de catégorie</button>']);
  gestes.push(['<button class="suite" data-suite="zone">Explorer cette zone</button>']);
  /* On ne dit combien on en connaît QUE lorsque la sélection s'arrête avant :
     « 8 sur 8 » n'apprend rien, « 10 sur 42 » explique la coupe. */
  const note = connus > montres
    ? '<p class="suite-note">Autour en connaît '+connus+' ici. En voici les '+
      montres+' meilleures — la suite passe par une autre envie.</p>' : '';
  return '<div class="suites">'+note+
    '<div class="suites-gestes">'+gestes.map(g=>g[0]).join("")+'</div></div>';
}

function afficherListe(emoji, titre, l, sansPalmares, redessiner, connus){
  /* Une liste peut être recalculée après l'arrivée d'une réponse réseau. Le
     garde-fou reste ici aussi : aucune porte de rendu ne peut réintroduire un
     élément de la ville quittée, même si son appelant possède encore une
     référence ancienne. */
  l = (l || []).filter(dansZoneActive);
  const avecNotes = l.some(x=>x.note);
  const avecPrix  = l.some(x=>x.prixN != null);
  const critere = sansPalmares
    ? "Trié par distance. Ces lieux ne sont pas classés : ils rendent tous le même service."
    : triListe === "prix"
      ? (avecPrix ? "Du moins cher au plus cher, à prix égal le mieux noté. Le niveau de prix vient de Google, pas des commentaires."
                  : "Aucun niveau de prix connu ici : l’ordre retombe sur la distance.")
    : triListe === "distance" ? "Du plus proche au plus loin."
    : triListe === "note"
      ? (avecNotes ? "Les mieux notés d’abord, à note égale le plus commenté."
                   : "Aucune note disponible ici : l’ordre retombe sur la distance.")
      : (avecNotes ? "Classé par note, puis par ce qui s’y passe, puis par distance."
                   : "Classé par ce qui s’y passe, puis par distance.");

  const tris = [["auto","Pertinence"],["note","Mieux notés"],["distance","Plus proches"]];
  // « Moins cher » n'apparaît que là où le prix veut dire quelque chose
  if(avecPrix || l.some(x=>AVEC_PRIX.has(x.cat))) tris.push(["prix","Moins cher"]);
  const barreTri = sansPalmares ? "" : '<div class="tri-barre">'+
    tris.map(([id,lab])=>'<button class="tri'+(triListe===id?" actif":"")+'" data-tri="'+id+'">'+lab+'</button>')
      .join("")+
    '</div>';

  const lignes = l.map((x,i)=>{
    const c = categorieAffichee(x, {emoji:"📍"});
    const distance = distancePourListe(x);
    const sous = [];
    if(x.note && !sansPalmares) sous.push('<span class="rang-note">★ '+x.note.toFixed(1)+
      (x.avis?' <span style="font-weight:500;color:var(--ink2)">('+x.avis+')</span>':'')+'</span>');
    const badge = badgeDispo(x);
    if(badge) sous.push(badge);
    if(x.cuisine) sous.push(esc(x.cuisine.replace(/[_;]/g," ")));
    if(x.prixN != null) sous.push('<span class="prix-n">'+SYMBOLE_PRIX[x.prixN]+'</span>');
    if(x.service) sous.push('<span class="service">'+esc(x.service)+'</span>');
    sous.push(esc(x.adresse||""));
    // horaires réels quand OpenStreetMap les connaît
    sous.push(esc(libelleHoraires(x)));
    return '<button class="rang" data-va="'+esc(x.id)+'">'+
      '<span class="rang-n">'+(i+1)+'</span>'+
      '<span class="rang-emoji">'+c.emoji+'</span>'+
      '<span class="rang-txt"><span class="rang-nom">'+esc(x.titre)+
        (x.mien?'<span class="badge mien">Ton ajout</span>':'')+
        (x.evs?'<span class="badge">'+x.evs+' ce soir</span>':'')+'</span>'+
      '<span class="rang-sous">'+sous.join(" · ")+'</span></span>'+
      (Number.isFinite(distance)
        ? '<span class="rang-dist">'+formatDist(distance)+'</span>' : '')+'</button>';
  }).join("");

  ouvrirFeuille(
    '<div class="liste-tete"><h2>'+emoji+' '+esc(titre)+'</h2>'+
    '<span class="liste-compte">'+l.length+' autour</span></div>'+
    barreTri+
    '<p class="liste-tri">'+critere+'</p>'+
    (l.length ? lignes : '<p class="liste-vide">Rien de ce type dans le coin.<br>Tu peux en poser un avec le bouton +.</p>')+
    (l.length ? suitesUtiles(Number.isFinite(connus) ? connus : l.length, l.length) : "")
  );

  $("#feuille").querySelectorAll("[data-suite]").forEach(b=>b.onclick=()=>{
    const quoi = b.dataset.suite;
    if(quoi === "soir" || quoi === "weekend"){
      creneau = quoi === "soir" ? "soir" : "weekend";
      filtreMaintenant = false;
      fermerFeuille(); pileEcrans = [];
      ouvrirFeuille2("racine"); majFeuille2(); rendre(); majFiltres();
      return;
    }
    // les deux autres ramènent à l'écran où l'on choisit : catégories et carte
    fermerFeuille(); pileEcrans = [];
    if(quoi === "zone") fermerFeuille2(); else ouvrirFeuille2("racine");
  });

  $("#feuille").querySelectorAll("[data-tri]").forEach(b=>b.onclick=()=>{
    triListe = b.dataset.tri;
    redessiner();          // même écran, nouvel ordre : on n'empile pas de retour
  });

  $("#feuille").querySelectorAll("[data-va]").forEach(b=>b.onclick=()=>{
    const id = b.dataset.va, cible = lieux.find(x=>x.id===id);
    if(!cible) return;
    allerVers([cible.lat,cible.lng], (mc)=>Math.max(mc.getZoom(),17), {duration:.7});
    pousserEcran(()=>ouvrirDetail(id));   // le retour ramène à la liste
  });
}

/* Recherche libre : « bar » ouvre le classement des bars, « chez Momo »
   cherche par nom. Dans les deux cas on retombe sur la même liste classée. */
function ouvrirResultats(q){
  // « restaurant turc », « africain », « sushi » : la cuisine passe avant la
  // catégorie, sinon « restaurant turc » ouvrirait juste tous les restaurants
  const cuisine = cuisineRecherchee(q);
  if(cuisine){
    const trouves = lieux.filter(l=>{
      const c = sansAccents(l.cuisine||"");
      return c && (c.includes(cuisine) || cuisine.includes(c));
    });
    if(trouves.length){
      pileEcrans = [];
      pousserEcran(()=>afficherListe("🍽️", "« "+q+" »",
        classerLieux(trouves, false), false, ()=>ouvrirResultats(q)));
      return;
    }
  }
  const cat = categorieRecherchee(q);
  if(cat){
    filtreActif = cat; dessinerFiltres(); rendre();
    if(SANS_CLASSEMENT.has(cat) && centreDonnees()) chargerAideZone();
    pileEcrans = [];
    pousserEcran(()=>ouvrirListe(cat));
    // OSM ignore beaucoup d'équipements publics : on demande à Google et on
    // complète la liste sans faire attendre devant un écran vide
    completerParGoogle(q, cat, ()=>ouvrirListe(cat));
    return;
  }
  const t = sansAccents(q);
  const trouves = lieux.filter(l=>
    sansAccents(l.titre+" "+(l.adresse||"")+" "+(l.cuisine||"")).includes(t));
  const montrer = ()=>{
    const encore = lieux.filter(l=>
      sansAccents(l.titre+" "+(l.adresse||"")+" "+(l.cuisine||"")).includes(t));
    afficherListe("🔎", "« "+q+" »", classerLieux(encore, false), false,
                  ()=>ouvrirResultats(q));
  };
  pileEcrans = [];
  pousserEcran(montrer);
  completerParGoogle(q, null, montrer);
}

/* ================================================================== */
/*  Aide sociale : les grands réseaux, cherchés nommément             */
/* ================================================================== */

/* OpenStreetMap cartographie très mal l'aide alimentaire, et les portails
   open data ne couvrent pas toutes les métropoles. Chercher les réseaux par
   leur nom donne des adresses et surtout des HORAIRES DE DISTRIBUTION réels,
   qui sont l'information vitale ici : « mardi 14h-16h » vaut mieux que
   l'existence d'un point sur une carte. */
const RESEAUX_AIDE = [
  { q:"Restos du Cœur",             cat:"alimentaire", besoins:["manger"], solidaire:true },
  { q:"Banque Alimentaire",         cat:"alimentaire", besoins:["manger"], solidaire:true },
  { q:"épicerie solidaire",         cat:"alimentaire", besoins:["manger"], solidaire:true },
  { q:"distribution alimentaire",   cat:"alimentaire", besoins:["manger"], solidaire:true },
  { q:"Secours Populaire",          cat:"alimentaire", besoins:["manger","vetements","autre"], solidaire:true },
  { q:"Secours Catholique",         cat:"asso", besoins:["logement","papiers","autre"], solidaire:true },
  { q:"Croix-Rouge",                cat:"asso", besoins:["sante","manger","vetements","autre"], solidaire:true },
  { q:"CCAS action sociale",        cat:"emploi", besoins:["logement","travail","papiers","famille","autre"], solidaire:true },
  { q:"accueil de jour sans-abri",  cat:"hebergement", besoins:["logement","hygiene","securite"], urgent:true, solidaire:true },
  { q:"hébergement d'urgence",      cat:"hebergement", besoins:["logement","securite"], urgent:true, solidaire:true },
  // accès aux droits et insertion : trois guichets distincts qu'OSM range
  // sous le même tag, et qui ne reçoivent pas les mêmes personnes
  { q:"Mission locale",             cat:"emploi", besoins:["travail","jeunes"], solidaire:true },
  { q:"France Travail",             cat:"emploi", besoins:["travail"] },
  { q:"France Services accès aux droits", cat:"emploi", besoins:["papiers","autre"], solidaire:true },
  { q:"vestiaire solidaire vêtements", cat:"friperie", besoins:["vetements","autre"], solidaire:true },
  { q:"bains-douches municipaux",   cat:"toilettes", besoins:["hygiene","autre"], solidaire:true },

  // Santé courante : ces lieux sont utiles, mais ne sont jamais présentés
  // comme gratuits sans donnée explicite de la fiche.
  { q:"pharmacie",                  cat:"sante", besoins:["sante"], santeIntentions:["medicaments"] },
  { q:"hôpital urgences",           cat:"sante", besoins:["sante"], santeIntentions:["hopital"], urgent:true },
  { q:"médecin généraliste",        cat:"sante", besoins:["sante"], santeIntentions:["soins"] },
  { q:"centre de santé",            cat:"sante", besoins:["sante"], santeIntentions:["soins"] },
  { q:"kinésithérapeute physiothérapeute", cat:"sante", besoins:["sante"], santeIntentions:["soins"] },
  { q:"dentiste clinique dentaire", cat:"sante", besoins:["sante"], santeIntentions:["dentaire"] },
  { q:"laboratoire analyses médicales", cat:"sante", besoins:["sante"], santeIntentions:["depistage"] },
  { q:"centre de dépistage CeGIDD", cat:"sante", besoins:["sante"], santeIntentions:["depistage","sexuelle"], accesAdapte:true, solidaire:true },
  { q:"Planning Familial",          cat:"sante", besoins:["sante","famille"], santeIntentions:["sexuelle"], solidaire:true },
  { q:"PMI protection maternelle infantile", cat:"sante", besoins:["sante","famille"], santeIntentions:["sexuelle"], solidaire:true },
  { q:"PASS permanence accès aux soins", cat:"sante", besoins:["sante"],
    santeIntentions:["acces","soins","medicaments","hopital","dentaire","depistage","sexuelle"],
    accesAdapte:true, solidaire:true },

  // Soutien psychologique : Text Search complète les types Google, qui ne
  // proposent pas de type de requête « psychologist ». Les réseaux publics ou
  // pris en charge restent distingués d'un cabinet privé.
  { q:"CMP centre médico-psychologique", cat:"sante", besoins:["parler"],
    santeIntentions:["mentale","acces"], accesAdapte:true, solidaire:true },
  { q:"CMPP centre médico-psycho-pédagogique", cat:"sante", besoins:["parler","famille","jeunes"],
    santeIntentions:["mentale","acces"], accesAdapte:true, solidaire:true },
  { q:"BAPU bureau aide psychologique universitaire", cat:"sante", besoins:["parler","jeunes"],
    santeIntentions:["mentale","acces"], accesAdapte:true, solidaire:true },
  { q:"PAEJ point accueil écoute jeunes", cat:"sante", besoins:["parler","jeunes"],
    santeIntentions:["mentale"], solidaire:true },
  { q:"Maison des adolescents psychologue", cat:"sante", besoins:["parler","jeunes"],
    santeIntentions:["mentale"], solidaire:true },
  { q:"Santé Psy Étudiant psychologue", cat:"sante", besoins:["parler","jeunes"],
    santeIntentions:["mentale","acces"], accesAdapte:true, solidaire:true },
  { q:"Mon soutien psy psychologue conventionné", cat:"sante", besoins:["parler"],
    santeIntentions:["mentale"] },
];

/* Une zone n'est chargée que pour le besoin qui l'a demandée. Une recherche
   générale faite à l'ouverture d'Aide ne doit jamais empêcher la recherche
   ciblée qui suit (« pharmacie », « psy », etc.). */
const zonesAideChargees = new Map();
const chargementsAideEnCours = new Map();
const AIDE_RAYON_RECHARGE = 5000;
const RAYON_AIDE = window.AutourAideRayon || null;
/* Les besoins que la phrase n'a pas nommés mais que la taxonomie propose. Ils
   entrent dans la recherche, à poids réduit : élargir n'est pas détourner. */
let besoinsSecondairesAide = [];
const POIDS_BESOIN_SECONDAIRE = .6;
/* Le palier réellement atteint. L'écran doit pouvoir dire « ces aides sont
   plus loin » plutôt que laisser croire au coin de la rue. */
let rayonAideAtteint = RAYON_AIDE ? RAYON_AIDE.premier() : 3000;
let aideEnCours = false;      // pour distinguer « on cherche » de « rien trouvé »
let aideEtrangersEcartes = false;

/* Aide reste en France par défaut. Un fournisseur qui ne donne pas de pays
   n'est pas inventé comme étranger ; en revanche un code ou une adresse
   explicitement belge ne doit jamais être mélangé aux résultats français. */
function codePaysAide(l){
  const tags = (l && l.tags) || {};
  const brut = l && (l.country_code || l.countryCode || l.pays || l.country ||
    tags["addr:country"] || tags.country);
  if(brut){
    const v = sansAccents(brut).replace(/[^a-z]/g, "");
    if(v === "fr" || v === "france" || v === "fra") return "FR";
    if(v === "be" || v === "belgique" || v === "belgium" || v === "belgie") return "BE";
    if(v.length === 2 || v.length === 3) return v.toUpperCase();
  }
  const texte = [l && l.adresse, l && l.cp, l && l.titre, l && l.title]
    .filter(Boolean).join(" ");
  if(/\b(?:belgique|belgium|belgie|mouscron|moeskroen|courtrai|kortrijk)\b/i.test(texte)) return "BE";
  return null;
}

function estAideFrance(l){
  const pays = codePaysAide(l);
  return !pays || pays === "FR";
}

function resultatsAideDansTerritoire(liste){
  const retenus = [];
  (liste || []).forEach(l=>{
    if(!dansZoneActive(l)) return;
    if(!estAideFrance(l)){ aideEtrangersEcartes = true; return; }
    retenus.push(l);
  });
  return retenus;
}

const TYPES_GOOGLE_AIDE = new Set([
  "association_or_organization", "non_profit_organization", "social_services_organization",
  "welfare_organization", "employment_agency", "government_office", "local_government_office",
  "city_hall", "post_office", "hospital", "general_hospital", "medical_center",
  "medical_clinic", "dental_clinic", "dentist", "medical_lab", "physiotherapist",
  "pharmacy", "doctor", "drugstore",
]);
const TYPES_GOOGLE_TOURISTIQUES = new Set([
  "hotel", "lodging", "hostel", "motel", "guest_house", "tourist_attraction",
  "museum", "art_gallery", "historic_site", "monument",
]);

function fournisseurGoogleAide(f, cat){
  const types = [f && f.primaryType, f && f.type, ...((f && f.categories) || [])]
    .filter(Boolean).map(s=>String(s).toLowerCase());
  if(types.some(t=>TYPES_GOOGLE_TOURISTIQUES.has(t))) return false;
  if(TYPES_GOOGLE_AIDE.has(String(f && (f.primaryType || f.type) || "").toLowerCase())) return true;
  return cat === "sante" && types.some(t=>TYPES_GOOGLE_AIDE.has(t));
}

/* ---- Le modèle, branché sur l'appel qui existe déjà -----------------------

   `aide-contexte-ia.js` préparait le contexte et vérifiait ce qui revient,
   mais personne ne l'appelait. Le voici branché — sur `enrichir-lieu`, la
   fonction Edge qu'Autour utilise déjà, avec un `mode: "aide"`. Pas une
   seconde route, pas une seconde clé, pas un second budget : la clé Gemini
   reste où elle est, le plafond du jour reste le même, et une panne du modèle
   reste ce qu'elle a toujours été — l'écran garde ce qu'il montrait.

   LE MODÈLE NE VIENT JAMAIS EN PREMIER. Autour classe, l'écran s'affiche, et
   c'est SEULEMENT ensuite qu'on demande un second regard. Ce qui revient est
   un ORDRE sur des lieux déjà là ; tout identifiant qu'Autour n'a pas envoyé
   est jeté par `valider()` avant même d'être lu.

   LA PHRASE NE SURVIT PAS À LA DEMANDE. Elle vit dans cette variable le temps
   de l'appel, et nulle part ailleurs : ni journal, ni base, ni métrique. */
const IA_AIDE = window.AutourAideContexteIA || null;
let phraseAideCourante = null;   // en mémoire, le temps de l'écran
let ordreModeleAide = null;      // le verdict validé, ou null
let cleOrdreModeleAide = null;   // l'état pour lequel il a été demandé
let demandeOrdreAideEnCours = false;

/* Choisir une catégorie au bouton, reformuler, revenir en arrière : dans tous
   ces cas la phrase d'avant ne décrit plus la demande. On l'oublie — et avec
   elle l'ordre qu'elle avait produit. Une phrase privée qui survit à l'écran
   sur lequel elle a été tapée est une phrase qu'on n'a plus de raison de
   garder. */
function oublierPhraseAide(){
  phraseAideCourante = null;
  besoinsExprimesAide = [];
  besoinsSecondairesAide = [];
  ordreModeleAide = null;
  cleOrdreModeleAide = null;
}

function contexteAideChargement(){
  const besoins = typeof besoinsSelectionnesAide === "function"
    ? besoinsSelectionnesAide().slice() : [];
  const choix = typeof sousAideChoisi === "function" ? sousAideChoisi() : null;
  const urgence = !!(choix && choix.urgentSeul);
  return {
    besoins,
    urgence,
    santeIntentions: Array.isArray(intentionsSanteAide) ? intentionsSanteAide.slice() : [],
    cats: choix && Array.isArray(choix.cats) ? choix.cats.slice() : CATS_AIDE.slice(),
    cle: urgence ? "urgence" : ((besoins.slice().sort().join("+") || "general")+
      (intentionsSanteAide.length ? "|"+intentionsSanteAide.slice().sort().join("+") : "")),
  };
}

function reseauxPourContexteAide(contexte){
  if(contexte.urgence) return RESEAUX_AIDE.filter(r=>r.urgent).slice(0,6);
  if(!contexte.besoins.length) return [];
  const principal = contexte.besoins[0];
  const correspond = r=>(r.besoins || []).some(id=>contexte.besoins.includes(id));
  let eligibles = [
    ...RESEAUX_AIDE.filter(r=>(r.besoins || []).includes(principal)),
    ...RESEAUX_AIDE.filter(r=>correspond(r) && !(r.besoins || []).includes(principal)),
  ];
  const intentions = contexte.santeIntentions || [];
  const services = intentions.filter(id=>id !== "acces");
  if(services.length)
    eligibles = eligibles.filter(r=>(r.santeIntentions || []).some(id=>services.includes(id)));
  if(intentions.includes("acces"))
    eligibles = eligibles.filter(r=>r.accesAdapte === true);
  return eligibles.slice(0,6);
}

async function chargerAide(lat,lng,options){
  const o = options || {};
  const contexte = contexteAideChargement();
  const cleZoneAide = idZoneActive()+"|"+contexte.cle;
  const deja = zonesAideChargees.get(cleZoneAide);
  if(o.force) zonesAideChargees.delete(cleZoneAide);
  else if(deja && distanceM(deja[0], deja[1], lat, lng) < AIDE_RAYON_RECHARGE) return;

  const cleChargement = idZoneActive()+"|"+lat.toFixed(2)+","+lng.toFixed(2)+"|"+contexte.cle;
  if(!o.force && chargementsAideEnCours.has(cleChargement))
    return chargementsAideEnCours.get(cleChargement);

  const generation = nouvelleGeneration("zone:aide",cleChargement,!!o.force);
  prendreEtatRecherche("places",generation);
  prendreEtatRecherche("overpass",generation);
  aideEnCours = true;
  definirEtatRechercheVersionne("places",SEARCH_STATES.LOADING_PLACES,generation);
  definirEtatRechercheVersionne("overpass",SEARCH_STATES.IDLE,generation);
  // Laisse la feuille s'afficher avant de normaliser un éventuel cache.
  // Le double passage rAF → tâche garantit au navigateur un premier paint.
  const promesse = (async()=>{
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    try{
      const exploitable = await chargerAideVraiment(lat,lng,generation,contexte);
      if(exploitable && generationCourante(generation))
        zonesAideChargees.set(cleZoneAide,[lat,lng]);
    }
    finally{
      if(generationCourante(generation)){
        aideEnCours = false;
        const trouve = contexte.besoins.length
          ? lieux.some(l=>dansZoneActive(l) && AIDE && AIDE.estSolution(l,contexte.besoins))
          : lieux.some(l=>dansZoneActive(l) && correspondUneCategorie(l,SET_AIDE));
        definirEtatRechercheVersionne("places",trouve ? SEARCH_STATES.SUCCESS : SEARCH_STATES.EMPTY,generation);
        terminerGeneration(generation);
      }
    }
  })();
  chargementsAideEnCours.set(cleChargement,promesse);
  try{ return await promesse; }
  finally{
    if(chargementsAideEnCours.get(cleChargement) === promesse)
      chargementsAideEnCours.delete(cleChargement);
  }
}

/* L'ANNUAIRE PUBLIC. France Travail, missions locales : ces structures ont une
   identité officielle et un type normalisé qu'OpenStreetMap ne donne pas. On
   les demande donc EN PREMIER, et OSM complète ensuite les objets non
   référencés — il ne remplace jamais cette source.

   Chaque besoin est transmis au fournisseur ; la taxonomie décide ensuite ce
   qui est réellement une solution. Une recherche générale audite les dix. */
function besoinsPourCollecteAide(contexte){
  const choisis=contexte && Array.isArray(contexte.besoins) ? contexte.besoins.filter(Boolean) : [];
  if(choisis.length) return choisis;
  return AIDE && Array.isArray(AIDE.BESOINS_GRILLE) ? AIDE.BESOINS_GRILLE.map(b=>b.id) :
    ["manger","logement","travail","papiers","sante","jeunes","parler","famille","securite","autre"];
}
async function lieuxAideInstitutionnels(lat, lng, contexte, signal){
  const fournisseur = window.AutourProviders && AutourProviders.aideInstitutionnelle;
  const besoins = besoinsPourCollecteAide(contexte);
  if(!fournisseur || !besoins.length) return [];
  try{
    const places = await fournisseur.nearby(lat, lng, { needs:besoins, radius:15000, signal });
    return places.map(p=> AutourProviders.versInterne(p)).filter(Boolean);
  }catch(e){
    return [];
  }
}

/* Les trois inventaires structurés ont le même point d'entrée applicatif,
   mais restent trois adapters séparés côté fournisseur. La taxonomie est
   appliquée après leur projection commune, jamais dans cette collecte. */
async function lieuxAideSource(source, lat, lng, contexte, signal){
  const fournisseur = window.AutourProviders && AutourProviders[source];
  if(!fournisseur) return [];
  try{
    const places = await fournisseur.nearby(lat, lng, {
      needs:besoinsPourCollecteAide(contexte), radius:15000, signal,
      records:source === "aideAutour" ? permanentPlaces : undefined,
    });
    return places.map(p=>AutourProviders.versInterne(p)).filter(Boolean);
  }catch(e){ return []; }
}

async function lieuxAideAutour(lat, lng, contexte, signal){
  const fournisseur = window.AutourProviders && AutourProviders.aideAutour;
  if(!fournisseur) return [];
  try{
    const places = await fournisseur.nearby(lat, lng, {
      needs:contexte && contexte.besoins || [], radius:15000, signal, records:permanentPlaces,
    });
    return places.map(p=>AutourProviders.versInterne(p)).filter(Boolean);
  }catch(e){ return []; }
}

async function chargerAideVraiment(lat,lng,generation,contexte){
  charge("Recherche des points d’aide…");
  aideEtrangersEcartes = false;
  /* Les sources sociales et ouvertes passent d'abord. Elles portent les
     catégories et conditions d'accès ; Google ne sert ensuite qu'à compléter
     une structure correspondante (position, téléphone, site, horaires, photo). */
  const catsContexte = contexte.besoins.some(id=>id === "sante" || id === "parler")
    ? ["sante"]
    : contexte.cats.filter(cat=>CATS_AIDE.includes(cat));
  const reseaux = reseauxPourContexteAide(contexte);
  const exploitable = await coordonnerSourcesVersionnees([
    {
      /* Ce qu'Autour connaît déjà : publications et lieux persistés. Ils
         restent une source à part, puis sont corroborés par les référentiels. */
      charger:()=>lieuxAideAutour(lat, lng, contexte, generation.signal),
      publier:(locaux)=>{
        const retenus=resultatsAideDansTerritoire(locaux || []);
        if(retenus.length) fusionner(retenus,"permanent");
        return !!retenus.length;
      },
    },
    {
      /* L'annuaire public d'abord : il donne le type normalisé et l'identité
         officielle. OSM arrive ensuite compléter, jamais remplacer. */
      charger: ()=> lieuxAideInstitutionnels(lat, lng, contexte, generation.signal),
      publier: (locaux)=>{
        const retenus = resultatsAideDansTerritoire(locaux || []);
        if(retenus.length) fusionner(retenus, "permanent");
        return !!retenus.length;
      }
    },
    {
      charger:()=>lieuxAideSource("aideDora",lat,lng,contexte,generation.signal),
      publier:(locaux)=>{
        const retenus=resultatsAideDansTerritoire(locaux || []);
        if(retenus.length) fusionner(retenus,"permanent");
        return !!retenus.length;
      },
    },
    {
      charger:()=>lieuxAideSource("aideFiness",lat,lng,contexte,generation.signal),
      publier:(locaux)=>{
        const retenus=resultatsAideDansTerritoire(locaux || []);
        if(retenus.length) fusionner(retenus,"permanent");
        return !!retenus.length;
      },
    },
    {
      /* ---- LE RAYON PROGRESSIF ------------------------------------------

         On demandait neuf kilomètres, une fois, et personne ne savait à quelle
         distance les résultats avaient été trouvés. En centre-ville c'était la
         moitié de la métropole ; à la campagne, une permanence à douze
         kilomètres n'existait pas.

         On cherche donc d'abord très localement, et on n'élargit QUE si l'on
         n'a pas assez de structures fiables. On ne complète jamais une liste
         courte pour atteindre un chiffre : deux structures fiables valent
         mieux que dix douteuses.

         Chaque palier interroge OpenStreetMap et fusionne ; le compte se fait
         ensuite sur ce que l'écran retiendrait vraiment — `estSolutionAideLiee`,
         c'est-à-dire le classement complet, pas le nombre d'objets ramenés. */
      charger:async()=>{
        const cats = catsContexte.length ? catsContexte : CATS_AIDE;
        let palier = RAYON_AIDE ? RAYON_AIDE.premier() : 3000;
        let dernierResultat = null;
        for(;;){
          const r = await vraisLieux(lat,lng,null,
            {cats, rayon:palier, limite:180, pays:"FR", signal:generation.signal});
          if(!generationCourante(generation)) return r;
          const locaux = r && r.ok ? resultatsAideDansTerritoire(r.lieux) : [];
          dernierResultat = r && r.ok ? Object.assign({}, r, {lieux:locaux}) : r;
          if(locaux.length) fusionner(locaux,"permanent");
          if(!RAYON_AIDE) break;
          const retenus = lieux.filter(estSolutionAideLiee);
          const verdict = RAYON_AIDE.evaluer(retenus, palier);
          rayonAideAtteint = palier;
          if(!verdict.elargir) break;
          palier = verdict.prochain;
        }
        return dernierResultat;
      },
      publier:r=>{
        const osm = r && r.ok ? r.lieux : [];
        definirEtatRechercheVersionne("overpass",r && r.ok
          ? SEARCH_STATES.SUCCESS : SEARCH_STATES.OVERPASS_UNAVAILABLE,generation);
        /* La fusion a déjà eu lieu, palier par palier : republier ici
           écraserait le travail des paliers précédents. */
        return osm.length > 0;
      },
      echec:()=>definirEtatRechercheVersionne("overpass",SEARCH_STATES.OVERPASS_UNAVAILABLE,generation),
    },
    {
      charger:()=>lieuxDatatourisme(lat,lng,generation.signal),
      publier:tourisme=>{
        const locaux = resultatsAideDansTerritoire(tourisme || []);
        if(locaux.length) fusionner(locaux,"datatourisme");
        return !!locaux.length;
      },
    },
    {
      charger:async()=>{
        const garder = [];
        await Promise.all(reseaux.map(async r=>{
          const res = await chercherGoogle(r.q, lat, lng,{signal:generation.signal});
          if(!generationCourante(generation)) return;
          res.forEach(f=>{
            // on écarte ce qui est trop loin : une distribution à 20 km n'aide personne
            if(distanceM(lat,lng,f.lat,f.lng) > 15000) return;
            if(!dansZoneActive(f) || !estAideFrance(f)){ aideEtrangersEcartes = true; return; }
            f.solidaire = !!r.solidaire;
            f.accesSanteDocumente = r.accesAdapte === true;
            f.isAidProvider = fournisseurGoogleAide(f, r.cat);
            garder.push({f, cat:r.cat});
          });
        }));
        return garder;
      },
      publier:garder=>{
        const parCategorie = new Map();
        (garder || []).forEach(({f,cat})=>{
          if(!parCategorie.has(cat)) parCategorie.set(cat,[]);
          parCategorie.get(cat).push(f);
        });
        parCategorie.forEach((fiches,cat)=>ajouterLieuxGoogle(fiches,cat));
        return !!(garder && garder.length);
      },
    },
  ], ()=>generationCourante(generation));
  if(generationCourante(generation)){
    charge(null);
    majAccueil();
  }
  return exploitable;
}

/* « restaurant à Lille » depuis Roubaix : on détecte la ville visée, on s'y
   déplace et on classe les résultats de là-bas. Sans ça, la recherche restait
   collée à la position courante. */
function villeRecherchee(q){
  // \b ne marche pas devant « à » : le caractère accentué n'est pas un mot ASCII
  const m = /(?:^|\s)(?:a|à|sur|vers|dans)\s+([A-Za-zÀ-ÿ][\wÀ-ÿ'’-]{2,}(?:[ -][A-Za-zÀ-ÿ][\wÀ-ÿ'’-]+){0,3})\s*$/.exec(q.trim());
  return m ? m[1].trim() : null;
}

/* Géocodage générique — aucune ville n'est connue d'avance.
   Deux raisons de ne plus se contenter du premier résultat :
     · les homonymes. « Roubaix » existe ailleurs qu'en France ; à importance
       comparable, on préfère le plus proche de l'endroit regardé, ce qui ne
       privilégie aucun pays mais suit l'utilisateur ;
     · l'étendue. Nominatim renvoie une emprise : s'en servir évite d'afficher
       un arrondissement quand on a demandé Paris, ou trois départements quand
       on a demandé un quartier. Un zoom fixe ne peut pas convenir aux deux. */
const ECART_IMPORTANCE = 0.15;   // en deçà, deux résultats se valent

async function geocoderVille(nom, pres, signal){
  try{
    const r = await fetch("https://nominatim.openstreetmap.org/search?format=jsonv2"+
      "&limit=5&addressdetails=0&q="+encodeURIComponent(nom),
      {signal,headers:{"Accept-Language":"fr"}});
    if(!r.ok) return null;
    const j = await r.json();
    if(!j.length) return null;

    const depuis = pres || positionMoi;
    const meilleure = j.reduce((m,x)=>Math.max(m, Number(x.importance)||0), 0);
    const candidats = j.filter(x=>meilleure - (Number(x.importance)||0) <= ECART_IMPORTANCE);
    const choisi = depuis
      ? candidats.reduce((a,x)=>{
          const d = distanceM(depuis[0], depuis[1], parseFloat(x.lat), parseFloat(x.lon));
          return (a && a.d <= d) ? a : {x, d};
        }, null).x
      : candidats[0];

    const bb = choisi.boundingbox;                   // [sud, nord, ouest, est]
    return {
      lat: parseFloat(choisi.lat), lng: parseFloat(choisi.lon),
      nom: choisi.display_name || nom,
      emprise: Array.isArray(bb) && bb.length === 4
        ? [[parseFloat(bb[0]), parseFloat(bb[2])], [parseFloat(bb[1]), parseFloat(bb[3])]]
        : null,
    };
  }catch(e){ return null; }
}

/* Recherche dans une autre ville : on affiche les résultats de Google
   directement, au lieu de les filtrer sur les lieux déjà chargés ici. */
async function rechercherAilleurs(phrase, ville){
  const generation = nouvelleGeneration("recherche:ailleurs",phrase+"|"+ville,true);
  charge("Recherche à "+ville+"…");
  try{
    const zone = await geocoderVille(ville,null,generation.signal);
    if(!generationCourante(generation)) return;
    const pos = zone ? [zone.lat, zone.lng] : null;
    if(zone){
      /* Ce chemin historique (« restaurant à Paris ») doit avoir exactement
         le même contexte que la recherche directe d'une ville. Sinon Google
         ramenait bien Paris, mais le reste de l'interface restait au GPS. */
      rechercheGeo = {nom:ville, lat:zone.lat, lng:zone.lng, emprise:zone.emprise || null};
      definirZoneActive(CTX ? CTX.zoneRecherche(ville, pos, zone.emprise || null) : null);
      if(generationsActives.get(generation.canal) === generation)
        generation.portee = porteeCourante;
      annulerChargementsZone("recherche:ailleurs");
      allerVers(pos, 13, {duration:.8});
    }
    const depuis = pos || centreDonnees();
    if(!depuis) return;
    const res = await chercherGoogle(phrase, depuis[0], depuis[1],{signal:generation.signal});
    if(!generationCourante(generation)) return;
    charge(null);
    if(!res.length){ toast("Rien trouvé à "+ville); return; }

    ajouterLieuxGoogle(res, "commerce");

    // on retrouve les lieux tout juste ajoutés par leur identifiant calculé
    const ids = new Set(res.map(f=>"g"+hash(f.nom+f.lat)));
    const trouves = lieux.filter(l=>ids.has(l.id) && dansZoneActive(l));
    if(!trouves.length){ toast("Rien trouvé à "+ville); return; }

    // `classerLieux` lit le contexte actif : le GPS n'est jamais remplacé,
    // même temporairement, pour calculer une liste distante.
    const classes = classerLieux(trouves, false);

    /* Même règle que pour les résultats de zone : « restaurant à Lille » tapé
       depuis Tourcoing est une question posée de loin, et on y répond par un
       aperçu. Ce chemin-ci affiche une liste plein écran — sans ce plafond, la
       même recherche donnait cinq résultats par une porte et trente par l'autre. */
    const montres = classes.slice(0, plafondPour(rechercheGeo));

    selectionAccueil = false;
    fermerFeuille2();
    pileEcrans = [];
    pousserEcran(()=>afficherListe("📍", esc(ville), montres, false,
      ()=>rechercherAilleurs(phrase, ville)));
  }finally{
    if(generationCourante(generation)){
      charge(null);
      terminerGeneration(generation);
    }
  }
}

/* Ajoute les résultats Google à la liste déjà affichée, sans la bloquer. */
function completerParGoogle(q, catDefaut, redessiner){
  const centre = centreDonnees();
  if(!centre) return;
  const generation = nouvelleGeneration("recherche:complement",q+"|"+(catDefaut||""),true);
  chercherGoogle(q, centre[0], centre[1],{signal:generation.signal}).then(res=>{
    if(!generationCourante(generation) || !res.length) return;
    if(ajouterLieuxGoogle(res, catDefaut)) redessiner();
  }).finally(()=>terminerGeneration(generation));
}

/* ================================================================== */

/* ================================================================== */
/*  Accueil : trois choses utiles maintenant, pas quatre cents épingles */
/* ================================================================== */

/* Ce qui compte change avec l'heure. À une heure du matin, une pharmacie ou
   un hébergement d'urgence valent mieux qu'un musée fermé depuis longtemps. */
const MOMENTS = [
  // la mairie a disparu d'ici : elle était favorisée tous les matins alors
  // que personne n'ouvre l'app pour qu'on lui propose un guichet
  { de:6,  a:11, nom:"ce matin",
    poids:{cafe:3, marche:3, emploi:2, sante:2, alimentaire:2, coworking:2} },
  { de:11, a:14, nom:"ce midi",
    poids:{resto:3, alimentaire:3, fastfood:2, cafe:2, marche:2} },
  { de:14, a:18, nom:"cet après-midi",
    poids:{biblio:2, coworking:2, musee:2, parc:2, asso:2, emploi:2, terrain:2, friperie:2, commerce:2} },
  { de:18, a:23, nom:"ce soir",
    poids:{concert:4, spectacle:4, bar:3, resto:3, cinema:3, fastfood:2} },
  { de:23, a:6,  nom:"cette nuit",
    poids:{sante:3, hebergement:3, bar:2, fastfood:2} },
];

function momentActuel(){
  const h = instantCreneau().getHours();
  return MOMENTS.find(m => m.de < m.a ? (h>=m.de && h<m.a) : (h>=m.de || h<m.a)) || MOMENTS[0];
}

/* Propositions posées avant la moindre frappe : à 8 h on ne cherche pas la
   même chose qu'à 23 h, et écrire sa demande est déjà un effort. Quatre
   raccourcis suffisent — au-delà on ne choisit plus, on lit une liste. */
const SUGGESTIONS_MOMENT = {
  "ce matin": [
    {t:"Petit-déjeuner",   cats:["cafe"]},
    {t:"Bosser au calme",  cats:["biblio","coworking","cafe"]},
    {t:"Marché",           cats:["marche"]},
    {t:"Prendre l’air",    cats:["parc"]},
  ],
  "ce midi": [
    {t:"Manger",           cats:["resto","fastfood","food"]},
    {t:"Pas cher",         f:"budget"},
    {t:"Près de moi",      f:"proche"},
    {t:"Ouvert maintenant",f:"ouvert"},
  ],
  "cet après-midi": [
    {t:"Étudier",          cats:["biblio","coworking","cafe"]},
    {t:"Prendre l’air",    cats:["parc"]},
    {t:"Fripes & pop-up",  cats:["friperie","popup","marche"]},
    {t:"Bouger",           cats:["terrain","sport"]},
  ],
  "ce soir": [
    {t:"Restaurant",       cats:["resto"]},
    {t:"Sortir",           cats:["concert","spectacle","bar","event"]},
    {t:"Cinéma",           cats:["cinema"]},
    {t:"Surprends-moi",    hasard:true},
  ],
  "cette nuit": [
    {t:"Ouvert maintenant",f:"ouvert"},
    {t:"Pharmacie",        cats:["sante"]},
    {t:"Rentrer",          cats:["metro","bus","velo"]},
    {t:"Un abri",          modeAide:true, sous:"dormir"},
  ],
};

function suggestionsDuMoment(){
  return SUGGESTIONS_MOMENT[momentActuel().nom] || SUGGESTIONS_MOMENT["cet après-midi"];
}

function appliquerSuggestion(s){
  const z = $("#suggestions"); if(z) z.hidden = true;
  const r = $("#rech"); if(r) r.blur();
  if(s.hasard){ surprendre(); return; }
  // « Un abri » à deux heures du matin : on entre dans le mode Aide, direct
  // sur le bon besoin, sans passer par un écran de plus
  if(s.modeAide){
    if(!modeAide) basculerAide();
    sousAide = s.sous || null;
    majFiltres(); rendre(); majAccueil(); majFeuille2();
    return;
  }
  if(s.f){
    filtresHumains.add(s.f);
    if(s.f === "famille") chargerEditorial("family");
    toutAfficher(); majFiltres();
    toast(s.t);
    return;
  }
  catsActives = new Set(s.cats);
  filtreActif = "tout";
  selectionAccueil = false;
  chargerPourCats(s.cats);
  if(s.cats.includes("family")) chargerEditorial("family");
  else if(s.cats.includes("cinema")) chargerEditorial("cinema");
  else if(s.cats.includes("event")) chargerEditorial("events");
  if(s.aide && centreDonnees()) chargerAideZone();
  mettreAJourProfil("categorie", s.cats[0]);
  dessinerFiltres(); majFiltres(); rendre();
  toast(s.t);
}

/* Une même rangée de raccourcis, rendue au même endroit dans deux contextes :
   sous la barre de recherche et dans la carte d'accueil. */
function rangeeSuggestions(){
  return '<div class="sg-rapides">'+suggestionsDuMoment().map((s,i)=>
    '<button class="sg-rapide" data-sug="'+i+'">'+esc(s.t)+'</button>').join("")+'</div>';
}

function brancherSuggestions(zone){
  const liste = suggestionsDuMoment();
  zone.querySelectorAll("[data-sug]").forEach(b=>
    b.onclick=()=>{
      zone.hidden=true;
      layerManager.deactivate(NOMS_COUCHES.searchOverlay);
      appliquerSuggestion(liste[Number(b.dataset.sug)]);
    });
}

/* ================================================================== */
/*  Moteur de pertinence                                              */
/* ================================================================== */

/* Tous les poids au même endroit : les régler doit être une modification de
   configuration, pas une chasse dans le code. */
const POIDS = {
  motCle:            40,   // la recherche prime sur tout le reste
  ouvert:            25,
  tresProche:        20,   // moins de RAYON_PROCHE mètres
  evenementImminent: 20,   // commence dans les deux heures
  categorieRecente:  40,   // tu es revenu plusieurs fois dessus : le signal doit peser
  populaire:         10,
  recent:            10,   // publié aujourd'hui
  moment:            14,   // pertinence horaire de la catégorie
  mien:              40,
  ferme:            -70,
  eloigne:          -15,
  ignore:           -10,
  DECROISSANCE:     800,   // mètres : au-delà l'envie de se déplacer chute
  RAYON_PROCHE:     400,
  PLAFOND_SERRE:     24,   // marqueurs max en vue rapprochée
  PLAFOND_LARGE:     14,
  SEUIL_NIVEAU_B:    45,   // en dessous, le lieu passe en niveau C (masqué)
};

/* ---- Profil local : des compteurs, rien de sensible, rien d'envoyé --------
   L'avatar est uniquement un repère visuel choisi dans une liste fermée : il
   ne constitue pas un champ démographique et ne quitte jamais le navigateur. */
const AVATARS_ONBOARDING = Object.freeze(["🧍🏻", "🧍🏼", "🧍🏽", "🧍🏾", "🧍🏿"]);
const PROFIL_VIDE = { categories:{}, recherches:[], heures:{}, rayon:1200,
                      ignores:{}, vu:0, avatar:"" };
let PROFIL = (()=>{
  try{ return Object.assign({}, PROFIL_VIDE,
       JSON.parse(localStorage.getItem("autour:profil")||"{}")); }
  catch(e){ return Object.assign({}, PROFIL_VIDE); }
})();
let personnalisation = localStorage.getItem("autour:perso") !== "non";

function enregistrerProfil(){
  try{ localStorage.setItem("autour:profil", JSON.stringify(PROFIL)); }catch(e){}
}

/* L'AVATAR. Ces deux fonctions étaient appelées sans jamais être définies :
   `avatarChoisi` depuis `majEnteteLieu`, qui s'exécute dans `demarrer()`. La
   ReferenceError coupait donc l'amorçage AVANT la carte — Explorer restait
   vide alors qu'une fiche ouverte par URL, qui ne passe pas par là,
   fonctionnait. Le défaut était invisible tant que la production servait
   l'ancien arbre, qui n'a pas d'avatar.

   L'avatar vit dans PROFIL comme le reste des préférences et ne quitte jamais
   le navigateur. On n'écrit que ce que la liste fermée propose. */
function avatarChoisi(){
  return PROFIL && typeof PROFIL.avatar === "string" ? PROFIL.avatar : "";
}

function sauvegarderAvatar(avatar){
  PROFIL.avatar = AVATARS_ONBOARDING.includes(avatar) ? avatar : "";
  enregistrerProfil();
  majEnteteLieu();
  const avatars = $("#onboardingAvatars");
  if(avatars) avatars.querySelectorAll("[data-avatar]").forEach((bouton)=>{
    bouton.setAttribute("aria-pressed", String(bouton.dataset.avatar === avatarChoisi()));
  });
}

function mettreAJourProfil(action, valeur){
  if(!personnalisation) return;
  const h = new Date().getHours();
  PROFIL.heures[h] = (PROFIL.heures[h]||0) + 1;
  if(action === "categorie" && valeur)
    PROFIL.categories[valeur] = (PROFIL.categories[valeur]||0) + 1;
  if(action === "clic" && valeur){
    PROFIL.categories[valeur] = (PROFIL.categories[valeur]||0) + 2;  // un clic vaut plus qu'un survol
    PROFIL.vu++;
  }
  if(action === "recherche" && valeur){
    PROFIL.recherches.unshift(String(valeur).slice(0,40));
    PROFIL.recherches = PROFIL.recherches.slice(0,12);
  }
  if(action === "ignore" && valeur)
    PROFIL.ignores[valeur] = (PROFIL.ignores[valeur]||0) + 1;
  enregistrerProfil();
}

/* Catégories sur lesquelles tu reviens : au moins deux fois, et au-dessus
   de la moyenne, sinon un clic isolé suffirait à orienter toute la carte. */
function obtenirInteretsProbables(){
  const e = Object.entries(PROFIL.categories);
  if(!e.length) return [];
  const moyenne = e.reduce((s,[,n])=>s+n,0) / e.length;
  return e.filter(([,n])=>n >= 2 && n >= moyenne)
          .sort((a,b)=>b[1]-a[1]).slice(0,4).map(([c])=>c);
}

function reinitialiserProfil(){
  PROFIL = Object.assign({}, PROFIL_VIDE, {categories:{}, ignores:{}, heures:{}, recherches:[]});
  enregistrerProfil();
  toast("Préférences effacées");
  rendre(); majAccueil();
}

/* ---- Contexte : tout ce que le score doit savoir, calculé une seule fois ---- */
function contexteActuel(){
  const d = instantCreneau();
  const c = map ? map.getCenter() : null;
  return {
    t: d.getTime(), heure: d.getHours(), jour: d.getDay(),
    moment: momentActuel(),
    centre: c ? [c.lat, c.lng] : positionMoi,
    /* Point de référence du classement. Normalement soi ; mais quand on est
       parti voir ailleurs, « loin de chez toi » n'est plus un défaut du lieu :
       tout Paris est loin de Tourcoing, et la pénalité de distance écartait
       alors l'intégralité des résultats de la zone demandée. */
    moi: centreZoneActive() || [0,0],
    /* La vraie position, pour ce qui parle bien de la personne — un itinéraire
       part d'où l'on est, pas d'où l'on regarde. */
    positionReelle: positionMoi || [0,0],
    q: sansAccents(recherche.trim()),
    interets: personnalisation ? obtenirInteretsProbables() : [],
    large: map ? map.getZoom() < 15 : false
  };
}

/* ---- Vacances scolaires -----------------------------------------------
   Sert uniquement à ne pas laisser croire qu'un établissement scolaire est
   ouvert. Les dates de la Toussaint, de Noël et de l'été sont nationales ;
   celles de février et d'avril dépendent de la zone (A, B ou C) et on ne
   sait pas dans laquelle se trouve la personne : on les signale alors comme
   probables plutôt que de les affirmer. */
function vacancesScolaires(d){
  const m = d.getMonth() + 1, j = d.getDate();
  if(m === 7 || m === 8) return {nom:"vacances d’été", sur:true};
  if(m === 9 && j <= 1)  return {nom:"vacances d’été", sur:true};
  if(m === 10 && j >= 18) return {nom:"vacances de la Toussaint", sur:true};
  if(m === 11 && j <= 2)  return {nom:"vacances de la Toussaint", sur:true};
  if(m === 12 && j >= 20) return {nom:"vacances de Noël", sur:true};
  if(m === 1 && j <= 5)   return {nom:"vacances de Noël", sur:true};
  if(m === 2 || (m === 3 && j <= 9))  return {nom:"vacances d’hiver", sur:false};
  if((m === 4 && j >= 8) || (m === 5 && j <= 10)) return {nom:"vacances de printemps", sur:false};
  return null;
}

/* Une catégorie « silencieuse » redevient visible dès qu'on la demande :
   en tapant son nom, en la choisissant dans Explorer, ou par une intention
   qui l'inclut explicitement (« Je viens d'arriver » a besoin de la mairie).  */
function demandeExplicite(l, ctx){
  if(catsActives && correspondUneCategorie(l,catsActives)) return true;
  if(correspondCategorie(l,filtreActif)) return true;
  if(!ctx.q || ctx.q.length < 3) return false;
  if(sansAccents(l.titre).includes(ctx.q)) return true;   // « lycée Baggio »
  return categorieRecherchee(ctx.q) === l.cat;            // « collège », « mairie »
}

/* Le filtre unique qui décide de ce qui a le droit de s'inviter sur la
   carte sans qu'on l'ait demandé. Mieux vaut cinq propositions justes que
   trente approximatives : ce qui est fermé ou fermé au public dégage. */
/* Quand il n'y a vraiment plus rien d'ouvert — une nuit, un dimanche — la
   carte vide est honnête mais inutilisable. On propose alors de lever la
   règle, à la demande, et le bandeau le dit. */
let montrerFermes = false;

/* ================================================================== */
/*  Mode Aide                                                          */
/* ================================================================== */

/* Chercher où manger ce soir et chercher où dormir cette nuit ne sont pas
   la même recherche. Le mode Aide ne filtre pas la carte : il change ce que
   « pertinent » veut dire. Une note Google ne compte plus, une porte ouverte
   compte énormément, et l'urgence du besoin passe devant la découverte. */
let modeAide = false;

const CATS_AIDE = ["alimentaire","hebergement","asso","emploi","sante","toilettes",
  "collecte","securite","mairie"];
const SET_AIDE  = new Set(CATS_AIDE);

/* Six besoins écrits comme on les dit, pas comme la base les nomme. « Aide
   alimentaire » est un intitulé d'administration ; « manger gratuitement ou
   à petit prix » est ce que la personne cherche. Le second se comprend sans
   avoir jamais utilisé l'app. */
/* Les besoins, dans les mots de tout le monde. Ils viennent de `aide.js` :
   une seule table, partagée par l'écran, la recherche libre et les tests.
   L'ancienne liste posait la question autrement — « Parler à une association »,
   « Emploi et droits » — c'est-à-dire par l'organigramme plutôt que par le
   problème. On demande maintenant « de quoi as-tu besoin ? ». */
const SOUS_AIDE = (AIDE ? AIDE.BESOINS_GRILLE : []).map(b=>({
  id:b.id, emoji:b.emoji, label:b.label, cats:b.cats,
}));
/* L'urgence n'est pas un besoin de plus : c'est une gravité. Elle traverse
   tous les besoins et remonte ce qui accueille sans rendez-vous. Elle garde
   donc sa place, à part et au-dessus. */
const AIDE_URGENCE = {id:"urgence", emoji:"🚨", label:"Urgence", urgentSeul:true,
  cats:["hebergement","sante","asso","alimentaire"]};
let sousAide = null;          // id du besoin actif, ou null
/* Ce qu'Aide a compris d'une phrase qui ne la concerne pas. Null la plupart
   du temps : il ne s'affiche que le temps de proposer la bonne porte.
   Déclaré ICI, avec les autres états d'Aide, et non près de son producteur :
   `majFeuille2` le lit, et `majFeuille2` peut être appelée par le démarrage
   avant que le script n'ait atteint le bas du fichier. Un `let` non encore
   évalué aurait alors levé une ReferenceError au premier rendu. */
let redirectionExplorer = null;
/* Les besoins réellement reconnus dans une phrase libre, séparés des
   suggestions taxonomiques. L'âge est conservé à part s'il a été dit
   d'elle-même. Rien de plus n'est retenu : pas de profil, pas de phrase. */
let besoinsExprimesAide = [];
let besoinsAide = [];
let ageDeclare = null;
// Sous-intentions normalisées uniquement en mémoire. Elles affinent la
// recherche sans ajouter de cases ni conserver la phrase saisie.
let intentionsSanteAide = [];

function sousAideChoisi(){
  if(sousAide === "urgence") return AIDE_URGENCE;
  return sousAide ? SOUS_AIDE.find(x=>x.id===sousAide) : null;
}          // id du sous-filtre actif, ou null

/* Ce qu'on risque à ne pas trouver. Dormir dehors ou renoncer à des soins ne
   se compare pas à récupérer un vêtement : à distance égale, l'urgent passe. */
const URGENCE = {
  hebergement:5, sante:5, alimentaire:4, collecte:4,
  asso:3, emploi:3, friperie:2, toilettes:2, mairie:2, food:3,
};
const URGENT_AU_NOM = /urgence|\b115\b|samu\s*social|sans[- ]abri|maraude|accueil\s*de\s*jour|halte\s*de\s*nuit|nuit[ée]e/i;

const POIDS_AIDE = {
  ouvert:        130,   // 1. une porte ouverte maintenant prime sur tout
  aujourdhui:     60,   // 2. sinon : ouvre encore aujourd'hui
  proximite:      90,   // 3. proximité, décroissance douce
  DECROISSANCE: 1600,   // on marche plus loin pour manger que pour un café
  urgence:        13,   // 4. multiplié par le niveau d'urgence (1 à 5)
  pertinence:     165,  // un réseau spécialisé gagne sur une catégorie large
  solidaire:      25,
  verifie:        18,
  ferme:        -140,
  inconnu:       -20,   // horaires inconnus : utile, mais après ce qui est sûr
};

/* « Disponible aujourd'hui » : vrai, faux, ou null quand on ne sait pas.
   Inventer une réponse ici ferait se déplacer quelqu'un pour rien. */
function disponibleAujourdhui(l){
  if(estTemporaire(l)){
    // sans date exploitable on ne sait pas : dire « oui » ferait se déplacer
    // quelqu'un pour un événement dont personne ne connaît le jour
    const etat = statutTemps(l);
    if(etat.statut === TEMPS.STATUTS.INCONNU) return null;
    if(etat.statut === TEMPS.STATUTS.PASSE) return false;
    return etat.statut !== TEMPS.STATUTS.A_VENIR;
  }
  const h = horaireDuJour(l);
  if(h) return !/ferm/i.test(h);
  if(l.ouvert === true) return true;
  return null;
}

function niveauUrgence(l){
  let u = URGENCE[l.cat] || 1;
  if(URGENT_AU_NOM.test(l.titre+" "+(l.service||""))) u += 2;
  return Math.min(7, u);
}

/* Score du mode Aide : l'ordre demandé, dans l'ordre. */
function scoreAide(l, ctx){
  const dMoi = distanceM(ctx.moi[0], ctx.moi[1], l.lat, l.lng);
  const dVue = ctx.centre ? distanceM(ctx.centre[0], ctx.centre[1], l.lat, l.lng) : dMoi;
  let s = 0, raisons = [];

  if(l.ouvert === true){ s += POIDS_AIDE.ouvert; raisons.push([POIDS_AIDE.ouvert,"Ouvert maintenant"]); }
  else if(l.ouvert === false) s += POIDS_AIDE.ferme;

  const dispo = disponibleAujourdhui(l);
  if(dispo === true && l.ouvert !== true){
    s += POIDS_AIDE.aujourdhui;
    raisons.push([POIDS_AIDE.aujourdhui,"Ouvre encore aujourd’hui"]);
  }else if(dispo === null) s += POIDS_AIDE.inconnu;

  const p = POIDS_AIDE.proximite * Math.exp(-Math.min(dMoi,dVue) / POIDS_AIDE.DECROISSANCE);
  s += p;
  if(dMoi < 700) raisons.push([p,"À quelques minutes"]);

  const u = niveauUrgence(l);
  s += u * POIDS_AIDE.urgence;
  if(u >= 5) raisons.push([u*POIDS_AIDE.urgence,"Service d’urgence"]);

  const besoins = besoinsSelectionnesAide();
  if(AIDE && besoins.length){
    const p = besoins.map(id=>AIDE.pertinence(l, id, {large:true}))
      .filter(x=>x.direct).sort((a,b)=>b.poids-a.poids)[0];
    if(p){
      const valeur = p.poids * POIDS_AIDE.pertinence;
      s += valeur;
      raisons.push([valeur, p.raison]);
    }
  }

  if(l.solidaire){ s += POIDS_AIDE.solidaire; raisons.push([POIDS_AIDE.solidaire,"Structure solidaire"]); }
  // le service n'ajoute pas de points — il n'y a pas de raison de mieux
  // classer une Mission locale qu'un CCAS — mais il passe devant la distance
  // dans ce qu'on affiche : savoir à qui s'adresse le guichet évite le trajet
  // de trop, et la distance est déjà écrite à côté
  if(l.service) raisons.push([POIDS_AIDE.ouvert - 1, l.service]);
  if(l.verifie) s += POIDS_AIDE.verifie;
  // ni note ni nombre d'avis : on ne classe pas une distribution alimentaire
  // par étoiles, et les mieux notées ne sont pas les plus utiles

  raisons.sort((a,b)=>b[0]-a[0]);
  return { score:s, raison: raisons.length ? raisons[0][1] : "Point d’aide" };
}

/* Le sous-filtre actif, ou le mode Aide entier s'il n'y en a pas. */
function catsAideActives(){
  const s = sousAide && SOUS_AIDE.find(x=>x.id === sousAide);
  return s ? new Set(s.cats) : SET_AIDE;
}

function besoinsSelectionnesAide(){
  return besoinsAide.length ? besoinsAide :
    (sousAide && sousAide !== "urgence" ? [sousAide] : []);
}

/* Une catégorie large comme « association » sert à charger les données, mais
   ne suffit pas à recommander une structure pour un besoin précis. Le contrat
   est identique pour le panneau et les marqueurs : aucune solution hors sujet
   ne peut apparaître sur l'un sans apparaître sur l'autre. */
function estSolutionAideLiee(l){
  if(!dansZoneActive(l)) return false;
  const choix = sousAideChoisi();
  if(choix && choix.urgentSeul) return niveauUrgence(l) >= 5;
  const besoins = besoinsSelectionnesAide();
  if(!besoins.length) return correspondUneCategorie(l, catsAideActives());
  const liee = !!(AIDE && AIDE.estSolution(l, besoins));
  if(!liee) return false;
  if((sousAide === "sante" || sousAide === "parler") && AIDE.estSolutionSante)
    return AIDE.estSolutionSante(l,intentionsSanteAide,
      {exigerAccesAdapte:intentionsSanteAide.includes("acces")});
  return true;
}

function proposableAuto(l, ctx){
  // une publication toute fraîche est proposable par construction : c'est la
  // personne devant l'écran qui vient de l'écrire
  if(publicationsEpinglees.has(l.id)) return true;
  if(modeAide){
    // Un besoin sélectionné ferme vraiment la sélection : une association
    // voisine mais non reliée à « Logement » ou « Santé » ne prend jamais la
    // place d'une solution dans le panneau ni sur la carte.
    if(!estSolutionAideLiee(l)) return false;
    const s = sousAide && SOUS_AIDE.find(x=>x.id === sousAide);
    if(s && s.solidaireSeul && !l.solidaire) return false;
    // « Urgence » ne montre que ce qui reçoit en urgence : un club de sport
    // classé « association » n'a rien à faire dans cette liste-là
    if(s && s.urgentSeul && niveauUrgence(l) < 5) return false;
    return true;   // le tri fermé/ouvert se fait plus loin, par catégorie
  }
  if(demandeExplicite(l, ctx)) return true;
  if(JAMAIS_AUTO.has(l.cat)) return false;
  // un arrêt n'est pas une destination : il reste chargé, mais ne se dessine
  // que si on a allumé la couche ou cherché explicitement un transport
  if(CATS_TRANSPORT.has(l.cat) && !transportsDemandes(ctx)) return false;
  // « fermé » veut dire fermé maintenant : sur le créneau de ce soir ou de
  // demain, l'information de Google ne dit plus rien du moment regardé.
  // Le bouton « Maintenant » suffit désormais à déclencher ce masquage : c'est
  // ce qu'il annonce. « Lieux fermés » dans les filtres le lève.
  if((creneau === "maintenant" || filtreMaintenant) && !montrerFermes && estFerme(l)) return false;
  return true;
}

/* « Les structures fermées ne doivent pas être proposées si une alternative
   ouverte existe. » La comparaison se fait catégorie par catégorie : cinq
   distributions ouvertes ne remplacent pas l'hébergement d'urgence fermé,
   et masquer celui-ci parce qu'un autre service est ouvert serait faux. */
function ecarterFermesSiAlternative(liste){
  const ouvertes = new Set();
  liste.forEach(x=>{ if(x.l.ouvert === true) ouvertes.add(x.l.cat); });
  return liste.filter(x=> x.l.ouvert !== false || !ouvertes.has(x.l.cat));
}

/* Score explicable : chaque terme est nommé, et la raison affichée à
   l'utilisateur est simplement le terme qui a le plus pesé. */
function scoreLieu(l, ctx){
  if(modeAide) return scoreAide(l, ctx);
  let s = 0, raisons = [];
  const dMoi = distanceM(ctx.moi[0], ctx.moi[1], l.lat, l.lng);
  const dVue = ctx.centre ? distanceM(ctx.centre[0], ctx.centre[1], l.lat, l.lng) : dMoi;
  const eph = estTemporaire(l);

  // proximité au centre regardé, pas seulement à toi : explorer une autre
  // zone doit y faire remonter les lieux
  s += 120 * Math.exp(-Math.min(dMoi, dVue) / POIDS.DECROISSANCE);
  if(dMoi < POIDS.RAYON_PROCHE){ s += POIDS.tresProche; raisons.push([POIDS.tresProche,"Près de toi"]); }
  if(dMoi > 2500) s += POIDS.eloigne;

  if(ctx.q && sansAccents(l.titre+" "+(l.cuisine||"")).includes(ctx.q)){
    s += POIDS.motCle; raisons.push([POIDS.motCle,"Correspond à ta recherche"]);
  }
  if(l.ouvert === true){ s += POIDS.ouvert; raisons.push([POIDS.ouvert,"Ouvert maintenant"]); }
  if(l.ouvert === false) s += POIDS.ferme;

  if(eph){
    s += 55;
    if(l.startsAt && l.startsAt > ctx.t && l.startsAt < ctx.t + 2*3600e3){
      s += POIDS.evenementImminent; raisons.push([POIDS.evenementImminent+55,"Commence bientôt"]);
    }else if(l.startsAt && l.startsAt <= ctx.t && (!l.endsAt || l.endsAt >= ctx.t)){
      raisons.push([55,"Ça se passe maintenant"]);
    }else if(l.startsAt && l.startsAt > ctx.t){
      raisons.push([55,"À venir"]);
    }else raisons.push([55,"Horaire à vérifier"]);
  }

  const pm = (ctx.moment.poids[l.cat]||0);
  if(pm){ s += pm*POIDS.moment; raisons.push([pm*POIDS.moment,"Sélectionné pour "+ctx.moment.nom]); }

  if(ctx.interets.includes(l.cat)){
    s += POIDS.categorieRecente;
    raisons.push([POIDS.categorieRecente,"Tu regardes souvent "+((CATS[l.cat]||{}).label||"ça").toLowerCase()]);
  }
  if(PROFIL.ignores[l.cat]) s += POIDS.ignore * Math.min(3, PROFIL.ignores[l.cat]);

  if(l.avis){
    const p = Math.min(POIDS.populaire, Math.log10(l.avis+1)*5);
    s += p; if(p > 6) raisons.push([p,"Apprécié dans le quartier"]);
  }
  if(l.note) s += (l.note - 3.5) * 8;
  if(l.mien) s += POIDS.mien;
  if(l.verifie) s += 12;

  raisons.sort((a,b)=>b[0]-a[0]);
  return { score:s, raison: raisons.length ? raisons[0][1] : "Autour de toi" };
}

/* Trois niveaux. A : incontournables, toujours là. B : pertinents dans le
   contexte. C : le reste, masqué mais retrouvé par recherche ou catégorie. */
function niveauLieu(l, ctx, sc){
  // en mode Aide, rien n'est « secondaire » : tout ce qui a passé le filtre
  // mérite d'être vu, c'est le classement qui fait le tri
  if(modeAide) return "A";
  const dMoi = distanceM(ctx.moi[0], ctx.moi[1], l.lat, l.lng);
  const eph = estTemporaire(l);
  if(l.mien) return "A";
  if(dMoi < 250) return "A";
  if(eph && (!l.debutLe || l.debutLe < ctx.t + 6*3600e3)) return "A";
  if(["sante","hebergement","alimentaire"].includes(l.cat) && ctx.heure >= 21) return "A";
  return sc >= POIDS.SEUIL_NIVEAU_B ? "B" : "C";
}

/* ================================================================== */
/*  Bottom sheet : un besoin, puis ses sous-choix. Jamais les deux.    */
/* ================================================================== */

/* null = fermée · "racine" = les cinq besoins · sinon l'id du besoin.
   La feuille ne s'ouvre jamais toute seule : l'écran de départ, c'est la
   carte, et rien d'autre. */
let feuilleNiveau = null;
let sousChoisi = null;          // index du sous-choix coché, ou null
let historiqueFeuilleBesoins = false;
let ignorerPopFeuilleBesoins = false;
let dernierFocusMainSheet = null;

/* Un lieu sans nom exploitable n'a rien à dire. Sauf là où le nom n'a
   jamais existé : des toilettes publiques ou un arrêt de bus sont utiles
   sans s'appeler quelque chose. */
const NOM_FACULTATIF = new Set(["toilettes","recharge","velo","metro","bus","parc","terrain"]);
function nomExploitable(l){
  // un libellé vide n'est jamais affichable, quelle que soit la catégorie
  if(!l.titre || l.titre.trim().length < 2) return false;
  if(NOM_FACULTATIF.has(l.cat)) return true;
  return !l.sansNom;
}

/* Rayon de travail. « Élargir » le double au lieu d'inventer des résultats. */
let rayonRecherche = 2500;
/* LE RAYON DE RECHERCHE N'EST PAS LE PÉRIMÈTRE DE LA ZONE.

   2 500 m autour du centre : c'est ce qui définit « près d'ici » quand on
   explore son quartier, et c'est juste. Mais quand on regarde une ville
   déclarée, la zone a une emprise — celle de Lille fait treize kilomètres de
   large — et le classement écartait silencieusement tout ce qui dépassait le
   rayon. Mesuré : 46 lieux dans la zone, 40 rendus par « Voir tout ». Six
   manquaient, dessinés sur la carte mais absents de la liste qui promet tout.

   La zone est le périmètre ; le rayon sert à classer ce qui est proche, pas à
   décider ce qui existe. */
function rayonDeLaZone(){
  const zone = activeLocationContext?.zone || zoneActive;
  if(!CTX || !zone) return rayonRecherche;
  return Math.max(rayonRecherche, CTX.rayonZone(zone) + CTX.MARGE_M);
}

/* L'intention structurée de la recherche en cours, telle que `comprendre.js`
   l'a lue. Elle voyage jusqu'au classement (contraintes dures / préférences)
   et jusqu'aux puces affichées, qui permettent d'en retirer un morceau. */
let intentionCourante = null;

function elargirZone(){
  rayonRecherche = Math.min(rayonRecherche * 2, 20000);
  surLaCarte((m)=>m.setZoom(Math.max(12, m.getZoom() - 1)), "zoom");
  const centre = centreZoneActive() || positionMoi;
  if(centre) chargerZone(centre[0], centre[1], {force:true});
  toast("Zone élargie à " + Math.round(rayonRecherche/1000) + " km");
  rendre(); majAccueil();
}

/* Combien de lieux réellement montrables se cachent derrière un sous-choix.
   Sert à ne jamais afficher une catégorie à zéro. */
function compterCats(cats){
  const set = new Set(cats);
  const [lat,lng] = centreZoneActive() || (map ? [map.getCenter().lat, map.getCenter().lng] : [0,0]);
  let n = 0;
  for(const l of lieux){
    if(!dansZoneActive(l)) continue;
    if(!correspondUneCategorie(l,set)) continue;
    if(!nomExploitable(l)) continue;
    if(filtreMaintenant && !estVivant(l)) continue;
    if(distanceM(lat,lng,l.lat,l.lng) > rayonRecherche) continue;
    n++;
    if(n > 99) break;
  }
  return n;
}

function typeEditorial(sousChoix){
  const cats = (sousChoix && sousChoix.cats) || [];
  if(cats.includes("family")) return "family";
  if(cats.includes("cinema")) return "cinema";
  if(cats.includes("event")) return "events";
  return "autre";
}

function categoriesClassementFeuille(){
  if(feuilleNiveau === "aide"){
    const choix = sousAideChoisi();
    return choix ? choix.cats : CATS_AIDE;
  }
  const besoin = BESOIN_DE(feuilleNiveau);
  if(!besoin || !besoin.sous) return [];
  if(sousChoisi !== null && besoin.sous[sousChoisi]) return besoin.sous[sousChoisi].cats;
  return [...new Set(besoin.sous.flatMap(x=>x.cats))];
}

function classementFeuille(){
  if(feuilleNiveau === null || feuilleNiveau === "racine" || feuilleNiveau === "plus") return [];
  const centre = centreZoneActive() || (map ? [map.getCenter().lat,map.getCenter().lng] : [0,0]);
  let candidats = lieux.filter(l=>dansZoneActive(l) && nomExploitable(l));
  if(feuilleNiveau === "aide"){
    const choix = sousAideChoisi();
    if(choix && choix.urgentSeul) candidats = candidats.filter(l=>niveauUrgence(l)>=5);
  }
  const classement = rankResults(candidats,{
    intent:feuilleNiveau,
    intention:intentionCourante,
    categories:categoriesClassementFeuille(),
    position:centre,
    now:instantCreneau().getTime(),
    nowOnly:filtreMaintenant && !montrerFermes,
    radius:feuilleNiveau === "aide" ? Math.max(rayonRecherche,6000) : rayonRecherche,
    distanceBetween:distanceM,
    horsService,
    saison:contexteSaison(),
    /* Le contexte territorial entre ici comme la saison : un signal de plus
       dans le MÊME score. Aide y compris — il n'existe pas d'« Aide Braderie »,
       seulement l'Aide d'Autour, où les structures temporaires du moment
       remontent par la même ontologie et les mêmes règles. */
    territorial:contexteTerritorialClassement(),
  });
  return classement;
}

function reinitialiserScrollFeuille(){
  requestAnimationFrame(()=>{
    const corps = $("#fbCorps");
    if(corps) corps.scrollTo({top:0,behavior:"auto"});
  });
}

/* Une réponse tardive peut enrichir la liste, mais elle ne doit pas déplacer
   la carte que la personne est en train de lire. On mémorise le premier lieu
   visible et son décalage ; après le rendu groupé, ce même lieu revient au
   même pixel. Le focus clavier est restauré quand l'élément existe encore. */
function instantanePanneau(corps){
  if(!corps) return null;
  const cadre = corps.getBoundingClientRect();
  const ancre = [...corps.querySelectorAll("[data-ac]")]
    .find(el=>el.getBoundingClientRect().bottom > cadre.top + 1);
  const actif = document.activeElement && corps.contains(document.activeElement)
    ? document.activeElement : null;
  return {
    niveau:feuilleNiveau,
    scrollTop:corps.scrollTop,
    id:ancre && ancre.getAttribute("data-ac"),
    decalage:ancre ? ancre.getBoundingClientRect().top - cadre.top : 0,
    focusId:actif && actif.getAttribute("data-ac"),
  };
}
function restaurerPanneau(corps, instantane){
  if(!corps || !instantane || instantane.niveau !== feuilleNiveau) return;
  requestAnimationFrame(()=>{
    if(instantane.niveau !== feuilleNiveau) return;
    corps.scrollTop = instantane.scrollTop;
    /* EN HAUT, LA POSITION DE LECTURE EST LE HAUT.

       L'ancre sert à ne pas déplacer la carte qu'on est en train de lire
       quand une réponse tardive enrichit la liste au-dessus d'elle. Mais
       lorsqu'on n'a pas défilé du tout, il n'y a pas de carte en cours de
       lecture : il y a le début du panneau. Appliquer quand même la
       correction faisait défiler PAR-DESSUS tout ce qui venait d'être inséré
       plus haut — onglets de temps et bloc « nouveau » compris — pour garder
       à sa place une recommandation que personne ne regardait. */
    if(instantane.scrollTop > 0 && instantane.id){
      const ancre = [...corps.querySelectorAll("[data-ac]")]
        .find(el=>el.getAttribute("data-ac") === instantane.id);
      if(ancre){
        const delta = ancre.getBoundingClientRect().top - corps.getBoundingClientRect().top - instantane.decalage;
        if(Math.abs(delta) > 1) corps.scrollTop += delta;
      }
    }
    if(instantane.focusId){
      const cible = [...corps.querySelectorAll("[data-ac]")]
        .find(el=>el.getAttribute("data-ac") === instantane.focusId);
      if(cible) cible.focus({preventScroll:true});
    }
  });
}

/* Trois hauteurs : réduite (poignée + titre), moyenne (les recommandations),
   étendue (l'exploration). On garde la signature booléenne des appels
   existants — true = étendue, false = moyenne. */
function etatFeuille(){
  const f = $("#feuilleBesoins");
  if(!f) return "moyenne";
  return f.classList.contains("deplie") ? "deplie"
       : f.classList.contains("reduite") ? "reduite" : "moyenne";
}
function reglerEtatFeuille(etat){
  const feuille = $("#feuilleBesoins");
  if(!feuille) return;
  feuille.classList.toggle("deplie", etat === "deplie");
  feuille.classList.toggle("reduite", etat === "reduite");
  const poignee = $("#fbPoignee");
  poignee.setAttribute("aria-expanded", String(etat === "deplie"));
  poignee.setAttribute("aria-label",
    etat === "deplie" ? "Réduire la feuille"
    : etat === "reduite" ? "Afficher les suggestions" : "Agrandir la feuille");
  requestAnimationFrame(synchroniserHauteurFeuille);
}
function reglerFeuilleDeplie(deplie){
  reglerEtatFeuille(deplie ? "deplie" : "moyenne");
}

function ouvrirFeuille2(niveau){
  const etaitFermee = feuilleNiveau === null;
  if(etaitFermee) dernierFocusMainSheet = document.activeElement;
  feuilleNiveau = niveau;
  sousChoisi = null;
  const f = $("#feuilleBesoins");
  f.hidden = false;
  delete f.dataset.suspended;
  reglerFeuilleDeplie(false);
  layerManager.activate(NOMS_COUCHES.mainSheet);
  majFeuille2();
  reinitialiserScrollFeuille();
  if(etaitFermee){
    history.pushState({autourBesoins:true},"",location.href);
    historiqueFeuilleBesoins=true;
  }
  // ouvrir un besoin déclenche sa recherche : c'est le moment où elle sert
  const b = BESOIN_DE(niveau);
  /* Aide n'a pas de `sous` — c'est un mode entier, pas une liste de cases.
     Cette branche testait `b.sous`, si bien qu'ouvrir Aide ne chargeait
     AUCUNE catégorie d'aide. Et comme `CATS_DEPART` n'en contient aucune non
     plus — au démarrage on ramène des commerces et des loisirs — l'écran
     d'aide n'avait à afficher que ce qui avait pu arriver là par hasard.
     C'est la raison principale pour laquelle « il n'y a aucun lieu d'aide » :
     ils n'étaient jamais demandés, dans aucune ville. */
  const cats = (niveau === "aide" || (b && b.aide)) ? CATS_AIDE
             : (b && b.sous) ? b.sous.flatMap(x=>x.cats)
             : null;
  if(cats){
    const manquantes = cats.filter(c=>!CATS_DEPART.has(c));
    if(manquantes.length) chargerPourCats(manquantes);
    if(niveau === "manger") completerRestauration();
    if(niveau === "famille") chargerEditorial("family");
    if(niveau === "sortir") chargerEditorial("events");
  }
}

function fermerFeuille2(options){
  const o = options || {};
  feuilleNiveau = null;
  sousChoisi = null;
  const f = $("#feuilleBesoins");
  if(!f) return;
  f.hidden = true;
  delete f.dataset.suspended;
  reglerFeuilleDeplie(false);
  layerManager.deactivate(NOMS_COUCHES.mainSheet);
  synchroniserRechercheDesktop();
  majRaccourcis();
  if(o.nettoyerHistorique !== false && historiqueFeuilleBesoins){
    historiqueFeuilleBesoins=false;
    ignorerPopFeuilleBesoins=true;
    history.back();
  }
  const focus = dernierFocusMainSheet;
  dernierFocusMainSheet = null;
  requestAnimationFrame(()=>{
    const cible = focus && document.contains(focus) ? focus : $("#rech");
    if(cible && !cible.hidden) cible.focus({preventScroll:true});
  });
}

/* Rendu de la feuille. Trois écrans possibles, jamais mélangés. */
function majFeuille2(){
  const debutCpu = performance.now();
  try{
  const f = $("#feuilleBesoins");
  if(!f || feuilleNiveau === null || modeNav || modePose){
    if(f) f.hidden = true;
    synchroniserRechercheDesktop();
    synchroniserHauteurFeuille();
    return;
  }
  PERF.rendus.panneau += 1;
  PERF.exposer();
  f.hidden = false;
  synchroniserRechercheDesktop();

  const corps = $("#fbCorps");
  const stabilite = instantanePanneau(corps);
  const retour = $("#fbRetour");
  f.classList.remove("accueil");

  // Une recherche de zone occupe la feuille jusqu'à ce qu'on en sorte. Sans
  // cette branche, les lieux de la zone arrivaient d'Overpass une seconde plus
  // tard, déclenchaient un rendu, et « Pour toi, maintenant » remplaçait les
  // résultats de la recherche qu'on venait tout juste de lancer.
  if(feuilleNiveau === "racine" && zoneAffichee){
    remplirResultatsZone(zoneAffichee.nom, zoneAffichee.intention);
    restaurerPanneau(corps, stabilite);
    synchroniserHauteurFeuille();
    return;
  }

  if(feuilleNiveau === "racine"){
    // L'accueil ne pose plus de question : il propose. Les besoins sont dans
    // les pills de l'en-tête, la feuille sert à montrer des lieux.
    const groupe = CRENEAUX.find(x=>x.id===creneau) || CRENEAUX[0];
    /* Quand le bloc « ⚡ Maintenant (3) » est là, il EST la section
       « maintenant ». Garder « Pour toi, maintenant » juste en dessous
       affichait les mêmes événements une seconde fois, sous une seconde
       étiquette qui dit la même chose : deux lectures pour une information.
       Le carrousel devient alors ce qu'il est réellement — les lieux autour,
       pas ce qui s'y passe. */
    /* UN SEUL « AUTOUR DE TOI », ET C'EST LE BAS DU PANNEAU.

       Le bloc « ⚡ Maintenant » dit ce qui se passe ; cette section-ci dit ce
       qu'il y a. Les nommer différemment selon qu'un concert est en cours ou
       non faisait changer le titre d'une section sous les yeux, pour un
       contenu qui, lui, ne changeait pas de nature. */
    const titre = creneau === "maintenant" ? "Autour de toi" : groupe.label;
    $("#fbTitre").textContent = titre;
    retour.hidden = true;
    // le titre vit dans le corps (avec « Voir tout ») : la barre ferait doublon
    f.classList.add("accueil");
    /* Sur desktop, la référence montre un aperçu de sept cartes puis les
       transports et les liens. « Voir tout » conserve l'accès au classement
       complet ; le mobile garde son défilement progressif plus long. */
    /* ================================================================
       DEUX TEMPS, ET C'EST TOUT L'OBJET DE CETTE PASSE.

       `recommandationsAccueil` classe l'ensemble des lieux. Le profil l'a
       mesurée : treize appels, 3 907 ms cumulées, 443 ms pour le pire. Elle
       vivait dans le MÊME `innerHTML` que le bloc « Maintenant » — qui, lui,
       est prêt en quelques millisecondes. Maintenant attendait donc un
       classement dont il n'a aucun besoin, et l'écran restait figé.

       On peint donc d'abord tout ce qui est bon marché — dont « Maintenant »
       — avec la zone de recommandations à sa place, occupée par le squelette
       qui s'y affichait déjà. Puis on classe pendant une tranche
       d'inactivité, et on remplace le squelette par les cartes.

       Rien ne bouge au-dessus : le squelette occupe la place, et l'en-tête
       « Voir tout » est rendue tout de suite. Ce qui change, c'est le moment
       où le navigateur reprend la main — entre les deux, il peut peindre,
       défiler, et enregistrer un appui. */
    const jeton = ++generationAccueil;
    if(annulerRecoDifferee){ annulerRecoDifferee(); annulerRecoDifferee = null; }

    corps.innerHTML =
      blocOuRegarder()+
      chipsHTML()+
      /* Sur grand écran elles vivent dans la barre du haut : les rendre ici
         aussi les ferait exister deux fois pour un lecteur d'écran. */
      (NAV_FLOTTANTE.matches ? "" : besoinsRapidesHTML())+
      ongletsTemps()+
      blocNouveauPourToi()+
      blocMaintenantAccueil()+
      blocAideAccueil()+
      '<div class="rc-tete"><strong>'+esc(titre)+'</strong>'+
        '<button class="rc-tout" data-rc-tout="1">Voir tout →</button></div>'+
      /* Les six grandes portes d'abord — c'est par elles qu'on retrouve les
         lieux permanents et les commodités —, le classement ensuite. */
      (creneau === "maintenant" ? grilleRaccourcisAutour() : "")+
      '<div data-reco-zone="1">'+recoDejaCalculee(jeton)+'</div>'+
      (creneau === "maintenant" ? blocTransports() : "")+
      piedFeuille();

    /* Le classement est-il déjà fait pour cet état exact ? Alors il est déjà
       posé ci-dessus, et il n'y a rien à différer. Sans cette question, un
       simple changement d'onglet reclasserait tout pour un résultat
       identique. */
    if(!recoCache || recoCache.cle !== cleReco()){
      annulerRecoDifferee = ORDO
        ? ORDO.differer(()=>poserRecommandations(jeton, titre),
            {timeout:300, valide:()=>generationAccueil === jeton})
        : (poserRecommandations(jeton, titre), null);
    }
  }else if(feuilleNiveau === "plus"){
    $("#fbTitre").textContent = "Plus de catégories";
    retour.hidden = false;
    corps.innerHTML = BESOINS_SECONDAIRES.map(b=>
      '<button class="bn" data-bn="'+b.id+'"><em>'+b.emoji+'</em><b>'+esc(b.label)+'</b></button>'
    ).join("");
  }else if(feuilleNiveau === "aide"){
    $("#fbTitre").textContent = "Aide";
    retour.hidden = !sousAide;
    /* On ne commence PAS par une carte de structures. Tant qu'aucun besoin
       n'est choisi, l'écran pose une seule question — « de quoi as-tu
       besoin ? » — et propose de l'écrire en toutes lettres. Les solutions
       viennent après, jamais avant. */
    corps.innerHTML = redirectionExplorer ? ecranRedirectionExplorer()
      : sousAide ? ecranSolutionsAide() : ecranBesoinsAide();
  }else{
    const b = BESOIN_DE(feuilleNiveau);
    if(!b){ fermerFeuille2(); return; }
    $("#fbTitre").textContent = b.emoji+" "+b.label;
    retour.hidden = false;
    // Les catégories éditoriales restent accessibles même à zéro : l'état
    // vide explique quoi faire et permet de relancer une recherche plus large.
    const choix = b.sous.map((s,i)=>({s, i, n:compterCats(s.cats)}));
    const selection = sousChoisi === null ? null : choix.find(x=>x.i===sousChoisi);
    corps.innerHTML = blocResultats()+'<p class="fb-section">Préciser mon besoin</p>'+choix.map(x=>
      '<button class="bn'+(sousChoisi===x.i?" actif":"")+'" data-sc="'+x.i+'">'+
      '<b>'+esc(x.s.label)+'</b><i>'+x.n+'</i></button>').join("")+
      (selection && selection.n===0 && !rechercheEnCours() ? messageVide(typeEditorial(selection.s)) : "");
  }

  brancherFeuille2();
  restaurerPanneau(corps, stabilite);
  requestAnimationFrame(synchroniserHauteurFeuille);
  } finally {
    PERF.travail("rendu_panneau", debutCpu);
  }
}

/* Trois liens discrets, tout en bas : le hasard, le partage, et le réglage
   de personnalisation — qui doit rester accessible puisqu'on l'a promis.
   Du texte, pas des boutons : ils ne concurrencent pas l'action principale. */
function piedFeuille(){
  return '<div class="fb-pied">'+
    '<button data-pied="hasard">🎲 Surprends-moi</button>'+
    '<button data-pied="partage">↗ Partager Autour</button>'+
    '<button data-pied="perso">'+(personnalisation ? "Ne plus personnaliser" : "Personnaliser")+'</button>'+
    '</div>';
}

/* « Aucun résultat » est une impasse : ça dit à quelqu'un qu'il n'y a rien,
   alors que ça veut dire qu'on n'a rien trouvé. La nuance compte, et les
   sorties doivent être là. */
function messageVide(type){
  /* Sans point de départ, « cette zone » serait une affirmation vide. Les
     choix suivants sont disponibles immédiatement, sans attendre Overpass,
     Google, la géolocalisation ni une quelconque donnée inventée. */
  if(!positionConnue()) return '<div class="fb-vide" data-vide="inconnu">'+
    '<p>Je ne sais pas encore où chercher.</p>'+blocOuRegarder()+'</div>';
  return '<div class="fb-vide" data-vide="'+esc(type||"autre")+'">'+
    'Je n’ai rien trouvé dans cette zone. Ça ne veut pas dire qu’il n’y a rien.'+
    '<div class="etat-vide-actions">'+
      '<button data-vide-action="5km">Élargir à 5 km</button>'+
      '<button data-vide-action="tout">Voir toutes les catégories</button>'+
      '<button data-vide-action="publier">Publier un événement</button>'+
    '</div></div>';
}

/* Trois lignes grises à la forme d'une recommandation. Une phrase seule
   (« Recherche autour de toi… ») se lit comme un écran vide qui s'excuse ;
   un squelette montre ce qui arrive et fait patienter sans mentir. */
function squeletteHTML(n){
  return '<div class="sq" data-testid="squelette" role="status" aria-live="polite">'+
    '<span class="sq-dit">On cherche ce qui vaut le détour autour de toi…</span>'+
    Array.from({length:n||3}, ()=>
      '<span class="sq-carte"><span class="sq-img"></span>'+
        '<span class="sq-txt"><i></i><i class="court"></i></span></span>').join("")+
    '</div>';
}

/* ===================================================================
   LES CINQ ÉTATS, À UN SEUL ENDROIT

   La décision « qu'est-ce que j'affiche quand il n'y a rien à l'écran ? »
   était prise à trois endroits — le bandeau flottant, le statut de groupe, le
   statut de recherche — chacun avec ses propres conditions. Trois lectures du
   même monde, qui peuvent se contredire : le bandeau disait « rien autour »
   pendant que la feuille affichait encore des squelettes.

   Une seule fonction répond désormais, et les trois affichages la lisent.

   L'ORDRE DES TESTS EST LA RÈGLE MÉTIER :

     · on ne parle jamais de « rien autour de toi » avant de savoir où est
       « toi » — l'ignorance de la position passe donc avant tout ;
     · une recherche en cours n'est pas un résultat vide ;
     · une PANNE n'est pas un résultat vide non plus. Un timeout, un 500 ou
       une géolocalisation refusée doivent se dire comme des pannes, jamais
       comme « il n'y a rien ici » — c'est la même phrase pour l'utilisateur,
       mais ce n'est pas la même information, et l'une des deux est fausse ;
     · des résultats déjà là gagnent sur une source secondaire en panne : on
       montre ce qu'on a, et on signale la mise à jour incomplète ailleurs.
   =================================================================== */
const ETATS_DONNEES = Object.freeze({
  LOCATION_UNKNOWN:      "location_unknown",
  LOCATION_LOADING:      "location_loading",
  DATA_LOADING:          "data_loading",
  READY_WITH_RESULTS:    "ready_with_results",
  READY_WITHOUT_RESULTS: "ready_without_results",
  ERROR:                 "error",
});

function panneTechnique(){
  return rechercheEtat.overpass === SEARCH_STATES.OVERPASS_UNAVAILABLE ||
    rechercheEtat.places === SEARCH_STATES.OVERPASS_UNAVAILABLE ||
    rechercheEtat.places === SEARCH_STATES.NETWORK_ERROR ||
    rechercheEtat.events === SEARCH_STATES.NETWORK_ERROR ||
    etatErreurPartielle();
}

function etatDonnees(nombreResultats){
  const n = Number(nombreResultats) || 0;
  if(rechercheEtat.location === SEARCH_STATES.REQUESTING_LOCATION)
    return ETATS_DONNEES.LOCATION_LOADING;
  if(!positionConnue())
    return ETATS_DONNEES.LOCATION_UNKNOWN;
  if(rechercheEnCours())
    return n ? ETATS_DONNEES.READY_WITH_RESULTS : ETATS_DONNEES.DATA_LOADING;
  if(n) return ETATS_DONNEES.READY_WITH_RESULTS;
  if(panneTechnique()) return ETATS_DONNEES.ERROR;
  return ETATS_DONNEES.READY_WITHOUT_RESULTS;
}

/* ==================================================================== */
/*  « Autour cherche » : l'indicateur qui ne bloque rien                */
/* ==================================================================== */
/* Il dit une seule chose : le travail continue en arrière-plan. Il est donc
   petit, calme, posé SOUS les résultats déjà lisibles, et il ne prend jamais
   la place de quoi que ce soit — la carte, la liste et les gestes restent
   entièrement utilisables pendant qu'il tourne. Aucun voile, aucun écran
   plein, aucune ligne qui saute.

   Et il disparaît tout seul. Pas quand le réseau a fini — ça peut ne jamais
   arriver si une source traîne —, mais dès qu'il y a de quoi choisir. Au-delà
   de ce seuil, continuer à afficher « je cherche » ne renseigne plus
   personne : ça inquiète au-dessus d'une liste déjà bonne. */
const ASSEZ_DE_RESULTATS = 4;

function indicateurRechercheHTML(nombreResultats){
  if(Number(nombreResultats) >= ASSEZ_DE_RESULTATS) return "";
  return '<div class="fb-statut cherche" role="status" aria-live="polite" '+
    'data-testid="indicateur-recherche">'+
    '<i class="cherche-pastille" aria-hidden="true"></i>'+
    '<span>Autour cherche autour de toi…</span></div>';
}

function statutRechercheHTML(nombreResultats){
  // Quand des résultats issus du cache ou d'une première source sont déjà là,
  // ils restent au premier plan. Trois squelettes au-dessus d'eux donnaient
  // l'impression que la liste n'avait pas chargé alors qu'elle était utilisable.
  const etat = etatDonnees(nombreResultats);
  // on ne dit jamais « il n'y a rien » avant de savoir où l'on regarde
  if(etat === ETATS_DONNEES.LOCATION_LOADING) return squeletteHTML(3);
  if(etat === ETATS_DONNEES.LOCATION_UNKNOWN)
    return '<div class="fb-statut">Active ta position ou choisis un endroit sur la carte.</div>';
  if(etat === ETATS_DONNEES.DATA_LOADING) return squeletteHTML(3);
  if(rechercheEnCours() && nombreResultats) return indicateurRechercheHTML(nombreResultats);
  const sourceIndisponible = panneTechnique();
  if(nombreResultats && sourceIndisponible)
    return '<div class="fb-statut partiel"><span>Résultats disponibles · mise à jour incomplète</span>'+
      '<button data-etat-action="retry">Actualiser</button></div>';
  if(rechercheEtat.overpass === SEARCH_STATES.OVERPASS_UNAVAILABLE || rechercheEtat.places === SEARCH_STATES.OVERPASS_UNAVAILABLE)
    return '<div class="fb-statut erreur">Certains lieux n’ont pas pu être chargés. Réessayer.'+
      '<br><button data-etat-action="retry">Réessayer</button></div>';
  if(rechercheEtat.places === SEARCH_STATES.NETWORK_ERROR || rechercheEtat.events === SEARCH_STATES.NETWORK_ERROR)
    return '<div class="fb-statut erreur">Connexion indisponible. Réessayer.'+
      '<br><button data-etat-action="retry">Réessayer</button></div>';
  if(etatErreurPartielle())
    return '<div class="fb-statut erreur">Certains lieux n’ont pas pu être chargés. Réessayer.'+
      '<br><button data-etat-action="retry">Réessayer</button></div>';
  if(!nombreResultats)
    return '<div class="fb-statut">Rien d’ouvert à proximité pour le moment.'+
      '<br><button data-etat-action="all">Voir tous les lieux</button>'+
      '<button data-etat-action="aide">Trouver de l’aide</button></div>';
  return "";
}

/* La distance seule remplirait l'aperçu Manger de cinq lignes OSM sans photo,
   note ni horaire alors que Google vient de fournir des fiches complètes à
   quelques minutes de là. On garde trois places pour les premiers du vrai
   classement et on réserve au plus deux places à des résultats documentés.
   Leur ordre relatif reste celui du classement : la donnée ne devient jamais
   un passe-droit illimité sur la proximité. */
function selectionResultatsFeuille(classement, limite){
  const items = classement.slice(0, limite);
  if(feuilleNiveau !== "manger" || items.length < limite) return items;
  const complet = l=>!!(l && imageDe(l) && Number.isFinite(Number(l.note)) &&
    Number(l.avis) > 0 && Array.isArray(l.horaires) && l.horaires.length);
  const objectif = Math.min(2, classement.filter(complet).length);
  let presents = items.filter(complet).length;
  if(presents >= objectif) return items;
  const deja = new Set(items.map(l=>l.id));
  const candidats = classement.filter(l=>complet(l) && !deja.has(l.id));
  for(const candidat of candidats){
    const aRemplacer = items.map((l,i)=>({l,i})).reverse().find(x=>!complet(x.l));
    if(!aRemplacer) break;
    items[aRemplacer.i] = candidat;
    presents += 1;
    if(presents >= objectif) break;
  }
  const rang = new Map(classement.map((l,i)=>[l.id,i]));
  return items.sort((a,b)=>(rang.get(a.id)||0)-(rang.get(b.id)||0));
}

/* Les cinq meilleures recommandations appartiennent à l'intention ouverte,
   pas à une ancienne sélection d'accueil. Elles précèdent toujours les menus. */
function blocResultats(){
  const classement = classementFeuille();
  const items = selectionResultatsFeuille(classement,5);
  const statut = statutRechercheHTML(items.length);
  const chargement = rechercheEnCours();
  const ouverts = classement.filter(l=>l.ouvert === true || (l.isTemporary && isAvailableNow(l,Date.now()))).length;
  /* Les cinq emplacements existent déjà pendant leur chargement : garder leur
     titre stabilise la hiérarchie et évite que tout le panneau saute quand les
     données arrivent. Il s'agit d'une capacité d'aperçu, pas d'un faux compte
     de résultats confirmés. */
  const nombreAffiche = items.length || (chargement ? 5 : 0);
  const entete = '<div class="fb-resultats-tete" data-testid="primary-results">'+
    '<strong>'+nombreAffiche+' '+(nombreAffiche>1?'solutions':'solution')+' près de toi</strong>'+
    '<span>'+(ouverts ? ouverts+' '+(ouverts>1?'ouvertes':'ouverte') : 'Les mieux classées')+'</span></div>';
  if(!items.length) return (nombreAffiche ? entete : "")+statut;
  const liste = items.map((l,index)=>{
    const c = categorieAffichee(l, {emoji:"📍"});
    const bouts = ['<span class="raison">'+esc(l.rankReason)+'</span>'];
    if(l.note) bouts.push("★ "+l.note.toFixed(1)+
      (l.avis ? " ("+Number(l.avis).toLocaleString("fr-FR")+" avis)" : ""));
    // dans l'aide, le nom seul ne suffit pas : « CCAS » ne dit rien tant
    // qu'on n'a pas eu besoin d'un CCAS. Une ligne dit à quoi ça sert.
    const aQuoi = EXPLIQUE && SET_AIDE.has(l.cat) ? EXPLIQUE.resumeCourt(l, 110) : "";
    /* Les petites lignes de résultat n'ont pas la place d'afficher une
       attribution complète — 46 px de côté ne portent pas un crédit lisible.
       Une photo qui EXIGE son crédit à côté d'elle reste donc réservée à la
       carte de recommandation et à la fiche, qui ont un `figcaption`. La règle
       ne nomme plus Google : elle vaut pour Places comme pour une CC-BY de
       Commons, et laisse passer ce qui n'a rien à créditer — CC0, domaine
       public, photo déposée par la structure elle-même. */
    const media = mediaDe(l);
    const photoVisible = media.image_url && !(IMAGES && IMAGES.creditObligatoire(media));
    const photo = photoVisible
      ? '<span class="ac-photo" data-image-type="'+esc(media.image_type||"")+'" data-image-scope="'+
          esc(media.image_scope||"")+'" style="--teinte:'+(COULEURS_CAT[l.cat]||"#5D6B63")+'">'+
          '<i>'+c.emoji+'</i><img loading="lazy" decoding="async" fetchpriority="low" alt="" '+
          'src="'+esc(media.image_url)+'" onload="this.classList.add(\'vue\');imageEvenementChargee(this)" onerror="this.remove()"></span>'
      : '';
    return '<button class="ac-item" data-ac="'+esc(l.id)+'">'+
      '<span class="ac-emoji">'+(index+1)+'</span>'+
      photo+
      '<span class="ac-txt"><span class="ac-nom">'+esc(l.titre)+'</span>'+
      (aQuoi ? '<span class="ac-expli">'+esc(aQuoi)+'</span>' : '')+
      '<span class="ac-sous">'+bouts.join(" · ")+'</span></span>'+
      '<span class="ac-dist" aria-hidden="true">'+c.emoji+'</span></button>';
  }).join("")+(classement.length>5
    ? '<span class="fb-plus">Fais défiler pour préciser · '+(classement.length-5)+' autres résultats</span>' : "");
  // Les erreurs non bloquantes et la mise à jour se lisent après les réponses,
  // jamais avant elles. Si la liste est vide, l'état reste naturellement seul.
  return entete+liste+statut;
}

/* ---- « Pour toi, maintenant » -------------------------------------------
   L'écran d'accueil ne demande plus « que veux-tu faire ? » avant de montrer
   quoi que ce soit : il propose. Le classement est le même que celui des
   besoins, sans filtre de catégorie — donc soumis aux mêmes règles
   d'ouverture, d'ETA et de faisabilité. */
/* Ce que l'accueil considère. Aide, services et transport gardent leur entrée
   dédiée : les mélanger à Explorer faisait remonter un hôtel ou un lycée au
   seul motif qu'il est proche. */
const CATS_ACCUEIL = ()=>[...new Set(
  BESOINS_PRINCIPAUX.filter(b=>!b.aide).flatMap(b=>b.sous ? b.sous.flatMap(x=>x.cats) : []))]
  .filter(c=>!CATS_TRANSPORT.has(c));

/* `tout` lève les restrictions d'affichage — et elles seules. « Voir tout »
   promet la liste complète de la zone ; sous l'onglet « Maintenant », le filtre
   d'utilisabilité en retirait silencieusement tout ce qui n'est pas ouvert à
   la seconde. Mesuré depuis Lille : 46 lieux dans la zone, 40 sous « Voir
   tout ». Un bouton qui promet tout et en cache six ne se rattrape pas — on ne
   sait pas ce qu'on n'a pas vu. Les règles de fond (un nom lisible, une
   catégorie demandée, la zone active) restent, elles. */
/* ==================================================================== */
/*  Diversité de la sélection                                           */
/* ==================================================================== */
/* Autour n'est pas un annuaire. Les premières lignes doivent se lire comme un
   choix — un parc, un endroit où manger, une activité, quelque chose qui se
   passe — et non comme la sortie brute d'un catalogue géographique, où quatre
   parcs voisins occupent les quatre premières places parce qu'ils sont les
   quatre objets les plus proches.

   MAIS LA VARIÉTÉ N'EST PAS UNE FIN. On ne la demande que là où la sélection
   est une PROPOSITION : l'accueil, qui ne présuppose rien de ce qu'on cherche.
   Dès que la personne a dit ce qu'elle veut — une catégorie cochée, une
   recherche écrite, un besoin d'aide ouvert —, la répétition est la bonne
   réponse : qui demande « pizzeria » veut des pizzerias, et qui cherche où
   dormir veut tous les hébergements. */
function diversiteDemandee(){
  if(modeAide) return null;
  if(catsActives && catsActives.size) return null;
  if(intentionCourante) return null;
  if(rechercheTexte()) return null;
  return {fenetre:ACCUEIL_MAX + 3};
}

/* La recherche libre en cours, s'il y en a une. Elle est lue à plusieurs
   endroits : autant qu'elle ait un nom. */
function rechercheTexte(){
  const champ = $("#rech");
  return champ && champ.value ? champ.value.trim() : "";
}

function recommandationsCeSoir(limite){
  const M = window.AutourMaintenant;
  const centre = centreZoneActive() || (map ? [map.getCenter().lat, map.getCenter().lng] : null);
  if(!M || typeof M.selectionCeSoir !== "function" || !centre) return [];
  const soir = TEMPS && TEMPS.fenetreSoir
    ? TEMPS.fenetreSoir(Date.now(), "Europe/Paris") : null;
  const choix = M.selectionCeSoir(lieux.filter(dansZoneActive), {
    maintenant:Date.now(),
    position:centre,
    positionConnue:true,
    rayonMax:rayonDeLaZone(),
    places:3,
    soirDebut:soir && soir.debut,
    soirFin:soir && soir.fin,
    /* Le matin, ce wrapper interdit à availability.js de transformer un
       état ponctuel en promesse pour ce soir. Une grille datée, elle, est
       bien évaluée à l'heure de la plage. */
    disponibilite:(x,t)=>dispoDe(x, null, t, {allowPointStatus:false}),
    statutTemporel:(x,t)=>statutTemps(x, t),
  });
  return Number.isFinite(limite) ? choix.slice(0, Math.min(3, Math.max(0, limite))) : choix;
}

function recommandationsAccueil(limite, options){
  const toutMontrer = !!(options && options.tout);
  /* Le classement partait de `positionMoi`. À Tourcoing, chercher Lille
     laissait donc les recommandations être classées depuis Tourcoing : les
     lieux lillois étaient tous « loin », ceux de Tourcoing tous « près », et
     l'accueil de Lille remontait des adresses de Tourcoing. Le centre est
     celui de la zone dont on parle — c'est soi quand on n'a rien cherché. */
  const centre = centreZoneActive() || (map ? [map.getCenter().lat, map.getCenter().lng] : null);
  if(!centre) return [];
  // Rien de classé encore ? On montre tout de suite un échantillon réel et
  // varié tiré du cache et des favoris, plutôt qu'un écran vide. Il sera
  // remplacé silencieusement dès que le classement complet arrive.
  if(!lieux.length) return [];

  /* « Ce soir » ne s'arrête pas au calendrier. Après les événements et les
     séances, il sonde les activités puis les lieux pertinents réellement
     ouverts pendant la plage — même si la consultation a lieu le matin. */
  if(creneau === "soir" && !modeAide){
    const couche = recommandationsCeSoir(limite);
    return couche;
  }

  /* Trois des quatre groupes ne parlent que d'événements : un restaurant n'a
     pas de « ce week-end », il a des horaires. On ne classe donc que les
     éphémères hors de « maintenant », et on les range par date réelle. */
  const groupe = creneau === "maintenant";

  /* UNE MÊME LISTE CLASSÉE UNE FOIS, PAS TROIS.

     Ouvrir un panneau enchaîne, dans la MÊME tâche synchrone, le classement de
     la carte, celui de l'accueil et celui du panneau — souvent avec des
     paramètres identiques. Chaque appel refaisait tout `rankResults` (mesuré à
     ~280 ms sur 120 lieux). Comme aucun état ne change entre deux appels d'une
     même tâche, on garde le classement le temps de cette tâche et on le
     réutilise. Le cache meurt à la microtâche suivante : au prochain état, tout
     est recalculé. C'est sans risque de péremption — rien ne peut changer entre
     deux instructions synchrones. */
  const cleBurst = (groupe?"g":"s")+"|"+creneau+"|"+(toutMontrer?"1":"0")+"|"+
    (catsActives&&catsActives.size?[...catsActives].sort().join(","):"")+"|"+
    (filtreMaintenant?"1":"0")+"|"+(montrerFermes?"1":"0")+"|"+(modeAide?"1":"0")+"|"+
    centre[0].toFixed(4)+","+centre[1].toFixed(4)+"|r"+revisionLieux;
  if(!recoBurstCache){ recoBurstCache = new Map(); queueMicrotask(()=>{ recoBurstCache = null; }); }
  let classement = recoBurstCache.get(cleBurst);
  if(!classement){
    const candidats = groupe
      ? lieux.filter(l=>dansZoneActive(l) && nomExploitable(l) && isDiscoveryCandidate(l))
      : lieux.filter(l=>dansZoneActive(l) && estTemporaire(l) && nomExploitable(l));
    classement = rankResults(candidats,{
      intent:groupe ? "explorer" : "sortir",
      intention:intentionCourante,
      /* Une recherche qui a posé des catégories les impose ici aussi : sans ça,
         « un endroit calme où travailler » reposait le filtre puis affichait les
         recommandations génériques, catégories comprises. À défaut, toutes les
         catégories des besoins principaux — l'accueil ne présélectionne pas une
         intention, il montre ce qui est réellement faisable. */
      categories: catsActives && catsActives.size ? [...catsActives] : CATS_ACCUEIL(),
      position:centre,
      now:Date.now(),
      // le filtre « maintenant » n'a de sens que dans le groupe « maintenant » :
      // ailleurs c'est la section temporelle qui trie
      nowOnly:!toutMontrer && groupe && filtreMaintenant && !montrerFermes,
      radius:rayonDeLaZone(),
      distanceBetween:distanceM,
      horsService,
      saison:contexteSaison(),
      diversite:diversiteDemandee(),
      territorial:contexteTerritorialClassement(),
    });
    recoBurstCache.set(cleBurst, classement);
  }

  if(!groupe){
    const sections = SECTIONS_DU_CRENEAU[creneau] || [];
    const retenus = classement.filter(l=>sections.includes(l.rankSection))
      .sort((a,b)=>(a.rankStart||0)-(b.rankStart||0));
    return Number.isFinite(limite) ? retenus.slice(0, limite || 12) : retenus;
  }

  // sert aussi à décider quelles étiquettes survivent aux collisions
  dernierClassement = classement;
  const tout = avecEpingles(classement);
  return Number.isFinite(limite) ? tout.slice(0, limite || 12) : tout;
}

/* Ce qu'on vient de publier ouvre la liste. Le classement fait bien son
   travail en n'y mettant pas un concert de demain soir ; mais après avoir
   appuyé sur « Publier », la première question est « est-ce que c'est bien
   passé ? », et la réponse doit être sur la première ligne. */
function avecEpingles(classement){
  const epingles = idsEpingles();
  if(!epingles.length) return classement;
  const devant = [];
  epingles.forEach(id=>{
    const dansClassement = classement.find(l=>l.id === id);
    const l = dansClassement || lieux.find(x=>x.id === id);
    if(l && !devant.includes(l)) devant.push(l);
  });
  if(!devant.length) return classement;
  const ids = new Set(devant.map(l=>l.id));
  return devant.concat(classement.filter(l=>!ids.has(l.id)));
}

/* ==================================================================== */
/*  Aide : partir du problème                                            */
/* ==================================================================== */

/* Une phrase libre devient un ou plusieurs besoins normalisés, plus l'âge si
   la personne l'a donné d'elle-même. La phrase, elle, n'est conservée nulle
   part : ni journal, ni profil. C'est la seule façon honnête de traiter
   « j'ai plus assez pour manger ». */
function lancerBesoinAide(phrase){
  if(!AIDE) return;
  /* La phrase telle qu'elle a été tapée, gardée en mémoire vive le temps de
     l'écran : le modèle en a besoin pour comprendre « je dors dehors ». Elle
     n'entre dans aucune table, aucun journal, aucune métrique, et le prochain
     besoin choisi l'efface. */
  phraseAideCourante = String(phrase || "").slice(0, 300) || null;
  ordreModeleAide = null; cleOrdreModeleAide = null;

  /* « Mon vélo est cassé » n'est pas une demande d'aide sociale.
     Avant, cette phrase tombait dans « autre » et l'écran répondait par les
     structures qui orientent — un CCAS pour un pneu crevé. On traduit à la
     place de l'utilisateur : on nomme ce qu'on a compris, et on propose la
     porte d'Explorer. Sans jamais lui demander de choisir une catégorie. */
  const domaine = AIDE.domaineDeLaPhrase ? AIDE.domaineDeLaPhrase(phrase) : {domaine:"aide"};
  if(domaine.domaine === "explorer"){
    redirectionExplorer = domaine;
    besoinsExprimesAide = [];
    besoinsAide = []; besoinsSecondairesAide = []; sousAide = null;
    intentionsSanteAide = [];
    majFeuille2(); reinitialiserScrollFeuille();
    return;
  }
  redirectionExplorer = null;

  /* UNE PHRASE PEUT DEMANDER PLUSIEURS CHOSES.

     « mon copain me frappe » ne demande pas une chose mais trois : se mettre
     en sécurité, parler à quelqu'un, et peut-être dormir ailleurs ce soir.
     `intentions()` sépare les besoins que la phrase exprime des suggestions
     qui viennent de la taxonomie.

     Les suggestions ÉLARGISSENT la recherche ; elles ne la détournent pas.
     Leur poids est réduit au classement (voir `POIDS_BESOIN_SECONDAIRE`) et
     elles restent toujours derrière un résultat correspondant à un besoin
     exprimé. */
  const lecture = AIDE.intentions ? AIDE.intentions(phrase) : null;
  const exprimes = lecture && Array.isArray(lecture.besoinsExprimes)
    ? lecture.besoinsExprimes.slice()
    : lecture && Array.isArray(lecture.besoins)
      ? lecture.besoins.slice()
      : AIDE.besoinsDepuisPhrase(phrase).map(x=>x.id);
  const trouves = exprimes.map(id=>({id}));
  const santeTrouvee = trouves.some(x=>x.id === "sante" || x.id === "parler");
  intentionsSanteAide = santeTrouvee && AIDE.intentionsSanteDepuisPhrase
    ? AIDE.intentionsSanteDepuisPhrase(phrase).map(x=>x.id) : [];
  const age = AIDE.ageDepuisPhrase(phrase);
  if(age != null) ageDeclare = age;
  if(AIDE.estUrgent(phrase) && !trouves.length){
    sousAide = "urgence";
    besoinsExprimesAide = [];
    besoinsAide = []; besoinsSecondairesAide = [];
  }else if(exprimes.length){
    const dits = exprimes;
    const secondaires = lecture
      ? lecture.secondaryNeeds.filter(id=>dits.indexOf(id) < 0) : [];
    besoinsExprimesAide = dits.slice();
    besoinsAide = dits.concat(secondaires);
    besoinsSecondairesAide = secondaires;
    sousAide = dits[0];
  }else{
    /* Rien de reconnu, et ce n'est pas une réparation non plus.
       On affichait alors les structures générales avec un toast « je n'ai pas
       bien compris » : Autour laissait croire qu'il pouvait orienter sur
       n'importe quoi, et proposait un CCAS pour une question qui n'a rien de
       social. Il vaut mieux dire ce qu'on sait faire — c'est plus court, plus
       honnête, et ça évite un déplacement inutile. */
    besoinsExprimesAide = [];
    besoinsAide = []; besoinsSecondairesAide = []; sousAide = null;
    intentionsSanteAide = [];
    /* Mais on ne renvoie pas la personne à un mur. Le routeur d'intentions
       rend au plus trois lectures possibles de sa phrase — jamais six, un
       menu long est une façon polie de lui rendre le problème. On les
       propose, avec leur icône ET leur mot : rien ne dépend du dessin seul. */
    const ROUTEUR = window.AutourIntentions;
    const lectures = ROUTEUR ? (ROUTEUR.router(phrase).suggestions || []) : [];
    redirectionExplorer = {horsPerimetre:true, propositions:lectures.slice(0,3),
                           requete:phrase};
  }
  chargerAideSiBesoin();
  majFeuille2(); reinitialiserScrollFeuille(); rendre();
}

function chargerAideSiBesoin(force){
  if(!centreDonnees()) return;
  chargerAideZone({force:!!force}).catch(()=>{});
}

/* Un rappel discret sur l'accueil : Aide existe, et elle parle de problèmes
   concrets. Une ligne, jamais un panneau — et seulement dans « Maintenant »,
   là où l'on cherche ce qui est faisable tout de suite. */
function blocAideAccueil(){
  if(creneau !== "maintenant" || modeAide) return "";
  return '<button class="aide-bloc" data-aide-accueil="1">'+
    '<em>🤝</em><span><b>Besoin d’un coup de main&nbsp;?</b>'+
    '<i>Manger, logement, travail, papiers, santé…</i></span>'+
    '<u>Voir →</u></button>';
}

/* Écran 1 — la question, et rien d'autre. Dix besoins écrits comme on les
   dit, plus l'urgence à part, plus un champ pour expliquer avec ses mots.
   Aucune structure n'est nommée à ce stade : « CCAS » ne veut rien dire tant
   qu'on n'a pas eu besoin d'un CCAS. */
function ecranBesoinsAide(){
  /* L'ordre est le message. Quelqu'un qui ouvre cet écran en urgence ne doit
     pas avoir à lire dix cases avant de trouver la porte d'entrée : l'urgence
     passe donc avant tout, y compris avant la question. Puis une phrase qui
     dit ce que fait Aide — sans elle, l'écran se lit comme une grille de
     cases sans promesse. La question vient ensuite, les besoins après, et
     l'expression libre en dernier pour ceux qui n'ont trouvé leur cas dans
     aucune case. */
  return '<section class="ab" data-testid="aide-besoins">'+

    // 0 · ce qu'est cet écran, en deux lignes
    '<p class="ab-entete"><b>❤️ Aide autour de toi</b>'+
      '<i>Trouve rapidement les structures et services qui peuvent t’aider '+
      'près de chez toi.</i></p>'+

    // 1 · l'urgence, en premier et impossible à manquer. Elle dit aussi ce
    //     qu'Autour n'est pas : une application d'orientation ne remplace pas
    //     un service d'urgence, et le laisser croire serait dangereux.
    '<button class="ab-urgence" data-sa="urgence" data-testid="aide-urgence">'+
      '<span class="abu-haut"><em>'+AIDE_URGENCE.emoji+'</em>'+
        '<b>Besoin d’aide urgente&nbsp;?</b></span>'+
      '<span class="abu-quoi">Santé, mise à l’abri, hébergement d’urgence, '+
        'danger immédiat</span>'+
      '<span class="abu-cta">Pour une situation urgente, commence ici →</span>'+
    '</button>'+
    /* Une note de bas de bloc, pas un paragraphe : elle doit être lue, sans
       repousser la question sous le pli. */
    '<p class="ab-secours">Danger immédiat&nbsp;: <b>15</b> · <b>17</b> · '+
      '<b>18</b> · <b>112</b> · <b>115</b>. Prévention du suicide&nbsp;: <b>3114</b>. '+
      'Autour oriente, il ne remplace pas les secours.</p>'+

    // 2 · ce que fait Aide, en une phrase et sans mot d'administration
    '<p class="ab-promesse">Explique ton besoin&nbsp;: Autour te propose les '+
      'aides et les structures utiles autour de toi.</p>'+

    // 3 · la question
    '<p class="ab-titre">De quoi as-tu besoin&nbsp;?</p>'+

    // 4 · les besoins
    '<div class="ab-grille">'+SOUS_AIDE.map(b=>
      '<button class="ab-besoin" data-sa="'+esc(b.id)+'">'+
        '<em>'+b.emoji+'</em><b>'+esc(b.label)+'</b></button>').join("")+
    '</div>'+

    // 5 · l'expression libre, pour ce qui n'entre dans aucune case
    '<p class="ab-sous">Ou explique-le simplement&nbsp;:</p>'+
    '<form class="ab-form" id="formBesoin">'+
      '<input id="champBesoin" type="search" enterkeyhint="search" autocomplete="off" '+
        'placeholder="« je n’ai rien à manger »" '+
        'aria-label="Explique ce dont tu as besoin">'+
      '<button type="submit" class="ab-ok">Chercher</button>'+
    '</form>'+
    /* Trois exemples plutôt qu'un : un seul placeholder se lit comme le
       format attendu, trois se lisent comme une invitation à écrire ses
       propres mots. Et la dernière ligne évite le voyage inutile — quelqu'un
       qui vient pour une réparation le sait avant de taper, au lieu de
       l'apprendre après. */
    '<p class="ab-exemples">« je dors dehors » · '+
      '« j’ai besoin d’aide pour une démarche » · '+
      '« j’ai 20 ans et je trouve pas de travail »</p>'+
    '<p class="ab-ailleurs-note">Pour une réparation, un commerce ou un '+
      'service, utilise Explorer.</p>'+
    '<p class="ab-vie">Ce que tu écris ici reste sur ton téléphone. '+
      'Autour n’en garde que le besoin (« manger », « travail »), jamais ta phrase.</p>'+
    '</section>';
}

/* Écran 1 bis — « ça ressemble plutôt à une réparation ».

   Trois lignes, un bouton, et rien d'autre. Pas de popup, pas de nouveau
   panneau : le même endroit, un contenu différent. La personne n'a qu'une
   décision à prendre, et elle est écrite en toutes lettres — on ne lui
   demande pas dans quelle catégorie classer sa demande. */
function ecranRedirectionExplorer(){
  const r = redirectionExplorer || {};

  /* Hors périmètre : on ne devine pas, et on ne renvoie pas vers une liste de
     structures sociales choisies au hasard. On nomme ce qu'Aide sait faire —
     la liste vient du modèle (AIDE.PERIMETRE), jamais recopiée ici — et on
     laisse deux portes ouvertes : reformuler, ou aller chercher dans Explorer. */
  if(r.horsPerimetre){
    const domaines = (AIDE && AIDE.PERIMETRE) || [];
    /* Les lectures possibles avant la liste des domaines : on demande d'abord
       « c'était plutôt ça ? », on n'explique qu'ensuite ce qu'Aide sait faire.
       Chaque proposition porte son icône ET son mot — jamais l'un sans
       l'autre, sinon le sens dépend de la reconnaissance d'un dessin. */
    const props = (r.propositions || []).slice(0,3);
    const choix = props.length
      ? '<div class="aba-lectures">'+props.map(p=>
          '<button class="aba-lecture" data-aide-lecture="'+esc(p.id)+'">'+
            '<span aria-hidden="true">'+esc(p.icone)+'</span> '+esc(p.label)+
          '</button>').join("")+'</div>'
      : "";
    return '<section class="ab-ailleurs" data-testid="aide-hors-perimetre">'+
      '<p class="aba-titre">Je ne suis pas sûr d’avoir compris.</p>'+
      (props.length ? '<p class="aba-sous">C’était plutôt&nbsp;:</p>'+choix : "")+
      '<p class="aba-sous">Aide oriente vers&nbsp;: '+
        esc(domaines.join(", "))+'.</p>'+
      '<button class="aba-cta" data-aide-reformuler="1">Reformuler ma demande</button>'+
      '<button class="aba-rester" data-aide-general="1">Voir les structures qui orientent</button>'+
      '</section>';
  }

  return '<section class="ab-ailleurs" data-testid="aide-redirection">'+
    '<p class="aba-titre">Ça ressemble plutôt à '+esc(r.libelle || "une recherche de commerce")+'.</p>'+
    '<p class="aba-sous">Ce n’est pas ce qu’Aide sait faire, mais Explorer, oui.</p>'+
    '<button class="aba-cta" data-vers-explorer="1">'+
      'Chercher '+esc(r.requete || "")+' autour de moi →</button>'+
    '<button class="aba-rester" data-aide-rester="1">Non, j’ai besoin d’aide</button>'+
    '</section>';
}

/* Écran 2 — les solutions. Permanentes ET temporaires dans la même liste :
   une distribution ce soir vaut mieux qu'un guichet ouvert demain, et c'est
   le moteur temporel existant qui les date, pas un second moteur. */
function ecranSolutionsAide(){
  const besoin = sousAideChoisi();
  const liste = solutionsAide();
  const titre = besoin ? besoin.emoji+" "+besoin.label : "Aide";
  if(!liste.length) return enteteBesoinAide(titre)+aucuneSolutionHTML();
  return enteteBesoinAide(titre)+
    annonceRayonAideHTML(liste)+
    '<div class="as-liste" data-testid="primary-results">'+
      liste.map(carteAide).join("")+'</div>'+
    (liste.length >= 3 ? '<button class="as-plus" data-as-plus="1">Voir plus loin</button>' : "");
}

/* QUAND LE RAYON A ÉTÉ ÉLARGI, ON LE DIT.

   Sans cette ligne, quelqu'un part pour ce qu'il croit être le coin de la rue
   et marche une heure. Elle n'apparaît que lorsqu'il y a quelque chose à
   annoncer — au premier palier, le silence est la bonne réponse — et elle
   annonce la distance RÉELLE des résultats, pas le palier interrogé.

   Une phrase, dans le style de statut qui existe déjà. Le design de l'écran
   Aide ne bouge pas. */
function annonceRayonAideHTML(liste){
  if(!RAYON_AIDE) return "";
  const a = RAYON_AIDE.annonce(liste, rayonAideAtteint);
  return a ? '<p class="fb-statut" data-testid="aide-rayon-elargi">'+esc(a.texte)+'</p>' : "";
}

function enteteBesoinAide(titre){
  /* « Compris » est une transcription de la phrase, jamais la liste élargie
     pour le classement. Un choix manuel n'a pas de phrase : dans ce seul cas,
     on affiche le besoin sélectionné comme avant. */
  const besoins = phraseAideCourante
    ? besoinsExprimesAide
    : (besoinsAide.length ? besoinsAide : (sousAide ? [sousAide] : []));
  const puces = besoins.map(id=>{
    const b = AIDE && AIDE.BESOIN_DE(id);
    return b ? '<button class="cp" data-besoin-off="'+esc(id)+'">'+esc(b.label)+
      '<i aria-hidden="true">✕</i></button>' : "";
  }).join("")+(ageDeclare != null
    ? '<button class="cp" data-besoin-off="age">'+ageDeclare+' ans<i aria-hidden="true">✕</i></button>' : "");
  return '<div class="as-tete"><strong>'+esc(titre)+'</strong></div>'+
    (puces ? '<div class="cps"><span class="cps-titre">Compris&nbsp;:</span>'+puces+'</div>' : "");
}

/* CE QU'ON DEMANDE AU MODÈLE, ET CE QU'ON EN ACCEPTE.

   L'état exact pour lequel un ordre a été demandé. Sans cette clé, chaque
   repeint de l'écran — un onglet, un défilement, une carte qui reçoit sa photo
   — relancerait un appel de modèle pour un résultat identique. */
function cleOrdreAide(candidats){
  const centre = centreZoneActive() || (map ? [map.getCenter().lat, map.getCenter().lng] : [0,0]);
  return [
    besoinsSelectionnesAide().join("+"),
    phraseAideCourante || "",
    rayonAideAtteint,
    centre[0].toFixed(3), centre[1].toFixed(3),
    candidats.length,
  ].join("|");
}

function demanderOrdreAide(candidats){
  if(!IA_AIDE || demandeOrdreAideEnCours || budgetVerificationEpuise) return;
  const cle = cleOrdreAide(candidats);
  if(cle === cleOrdreModeleAide) return;      // déjà demandé pour cet état
  /* L'état a changé : l'ordre d'avant ne vaut plus. Le garder « en attendant »
     appliquerait à cette liste-ci un classement calculé pour une autre — la
     panne la plus discrète possible, et la plus fausse. */
  ordreModeleAide = null;
  const centre = centreZoneActive() || (map ? [map.getCenter().lat, map.getCenter().lng] : null);
  if(!centre) return;

  const contexte = IA_AIDE.contexte({
    userLat: centre[0], userLng: centre[1],
    selectedCity: villeDetectee || null,
    currentRadius: rayonAideAtteint,
    requestedHelpCategory: sousAideChoisi() ? sousAideChoisi().id : null,
    userFreeText: phraseAideCourante,
    candidatePlaces: candidats,
  });

  demandeOrdreAideEnCours = true;
  cleOrdreModeleAide = cle;                   // même en cas d'échec : on ne réessaie pas en boucle
  const fini = PERF.requete("aide_ordre_modele");
  (async ()=>{
    try{
      if(!(await connecter())) return;
      const { data:{ session } } = await sb.auth.getSession();
      if(!session || !session.access_token) return;
      const r = await fetch(SUPABASE_URL+"/functions/v1/enrichir-lieu", {
        method:"POST",
        headers:{"content-type":"application/json",
          apikey:SUPABASE_CLE, authorization:"Bearer "+session.access_token},
        body:JSON.stringify({mode:"aide", contexte}),
        signal:AbortSignal.timeout(18000),
      });
      if(!r.ok) return;
      const json = await r.json();
      if(json && json.raison === "budget du jour atteint"){ budgetVerificationEpuise = true; return; }
      if(!json || !json.ordre) return;

      /* LA GARANTIE EST ICI, PAS DANS L'INVITE. Le serveur a déjà filtré ; on
         refait le travail, parce que ne pas le refaire reviendrait à faire
         confiance à une réponse pour se protéger d'elle-même. */
      const valide = IA_AIDE.valider(json.ordre, contexte);
      if(valide.aInvente) journal.warn("aide : le modèle a proposé "+
        valide.rejets.length+" élément(s) hors données — écartés");
      if(!valide.rankedPlaceIds.length) return;
      /* La clé voyage AVEC le verdict : c'est ce qui garantit qu'un ordre
         arrivé en retard ne s'applique pas à une liste qui a changé entre-temps. */
      ordreModeleAide = Object.assign({cle}, valide);
      /* L'écran se repeint avec le même design : seul l'ordre a changé. */
      if(feuilleNiveau === "aide" && sousAide) majFeuille2();
    }catch(e){
      /* Modèle indisponible, réseau coupé, délai dépassé : Autour garde son
         propre ordre, qui est déjà à l'écran. */
    }finally{ demandeOrdreAideEnCours = false; fini(); }
  })();
}

/* Le classement de l'aide : les mêmes règles que partout — moteur temporel,
   contraintes dures, distance — plus la pertinence du besoin. */
function solutionsAide(limite){
  const centre = centreZoneActive() || (map ? [map.getCenter().lat, map.getCenter().lng] : null);
  if(!centre || !AIDE) return [];
  const besoins = besoinsSelectionnesAide();
  const choix = sousAideChoisi();
  let candidats = lieux.filter(l=>dansZoneActive(l) && nomExploitable(l) && estSolutionAideLiee(l));

  /* LES CAPACITÉS VOYAGENT AVEC LE LIEU. Le classement en a besoin — une
     structure spécialisée passe devant une association qui « peut aussi » —
     et l'écran s'en sert pour dire pourquoi elle est là. On les calcule une
     fois, ici, plutôt que dans chaque comparaison. */
  const CLASSEMENT = window.AutourAideClassement || null;
  if(CLASSEMENT) candidats = candidats.map(l=>{
    const v = CLASSEMENT.capacites(l);
    return Object.assign({}, l, {capacitesAide:v.capacites, confianceAide:v.confiance,
                                 verdictAide:{confiance:v.confiance,
                                              certaine:Object.keys(v.detail)
                                                .some(k=>v.detail[k].accorde && v.detail[k].certaine)}});
  });

  const classement = rankResults(candidats, {
    intent:"aide",
    intention:intentionCourante,
    // le filtrage métier est déjà fait ci-dessus ; toutes les catégories
    // d'aide restent admises ici pour qu'un réseau connu, rangé « asso », ne
    // soit pas éliminé par son seul tag technique.
    categories:[...new Set([...CATS_AIDE, "mairie", "friperie", "food"])],
    position:centre,
    now:Date.now(),
    // en aide, on ne cache jamais ce qui est fermé : savoir qu'un guichet
    // ouvre demain à 9 h est une information, pas un déchet
    nowOnly:false,
    radius:Math.max(rayonRecherche, 6000),
    distanceBetween:distanceM,
    territorial:contexteTerritorialClassement(),
  });

  // pertinence du besoin : elle passe devant tout le reste du tri
  const exprimes = new Set(besoinsExprimesAide.length
    ? besoinsExprimesAide : besoins);
  const notes = classement.map(l=>{
    /* À poids égal, la raison la plus précise gagne : « tu cherches du
       travail » explique mieux la présence d'une Mission locale que « tu es
       jeune ». On note donc chaque besoin, et on garde le meilleur couple
       (poids, précision). */
    const vus = besoins.map(id=>{
      const p = AIDE.pertinence(l, id, {large:true});
      const exprime = exprimes.has(id);
      /* Un besoin que la phrase n'a pas nommé compte, mais moins : une écoute
         ne doit pas passer devant une mise à l'abri quand on cherche où
         dormir. */
      const facteur = !exprime && besoinsSecondairesAide.indexOf(id) >= 0
        ? POIDS_BESOIN_SECONDAIRE : 1;
      return {poids:p.poids * facteur, raison:p.raison, sur:!!p.sur,
              direct:!!p.direct,
              precis: p.sur || (id !== "jeunes" && id !== "autre"), exprime};
    }).filter(x=>x.poids > 0 && x.direct)
      .sort((a,b)=> b.poids - a.poids || (b.precis?1:0) - (a.precis?1:0));
    /* Une structure qui répond à un besoin exprimé reste dans le groupe
       prioritaire, même si elle répond aussi à une suggestion taxonomique.
       La distance et l'ouverture ne peuvent pas inverser ces deux groupes. */
    const meilleur = vus.find(x=>x.exprime) || vus[0];
    if(!besoins.length) return {l, poids: SET_AIDE.has(l.cat) ? .5 : 0, raison:"", sur:false};
    return {l, poids: meilleur ? meilleur.poids : 0,
            raison: meilleur ? meilleur.raison : "", sur: !!(meilleur && meilleur.sur),
            exprime: !!(meilleur && meilleur.exprime)};
  }).filter(x=>x.poids > 0);

  notes.sort((a,b)=>
    // Les besoins exprimés sont un groupe prioritaire : une suggestion
    // taxonomique ne peut jamais les remplacer, même si elle est plus proche.
    Number(b.exprime) - Number(a.exprime) ||
    // Lien réel au besoin, puis disponibilité / horizon, puis marche : une
    // association voisine ne gagne jamais sur une permanence adaptée.
    b.poids - a.poids ||
    prioriteDisponibiliteAide(b.l) - prioriteDisponibiliteAide(a.l) ||
    /* L'ordre du produit, écrit une seule fois dans `aide-classement.js` :
       preuve certaine, confiance, spécialisation réelle, disponibilité,
       distance, fraîcheur. Pour Aide, la pertinence passe avant la quantité. */
    (CLASSEMENT ? CLASSEMENT.comparer(a.l, b.l) : 0) ||
    (a.l.rankDistance||0) - (b.l.rankDistance||0));

  /* L'ORDRE D'AUTOUR EST COMPLET ICI. Ce qui suit ne le remplace pas : le
     modèle réordonne une liste déjà juste, et s'il n'a rien dit — pas encore
     répondu, indisponible, ou budget atteint — c'est cet ordre-là qui sort.

     Le second regard est demandé sur la liste ENTIÈRE, pas sur les cinq
     premiers : un modèle qui ne verrait que le haut du classement ne pourrait
     jamais remonter la structure qui répond vraiment. */
  const ordonnes = notes.map(x=>Object.assign(x.l, {aideRaison:x.raison, aideSur:x.sur,
                                                     aideExprime:x.exprime}));
  if(IA_AIDE){
    demanderOrdreAide(ordonnes);
    if(ordreModeleAide && ordreModeleAide.cle === cleOrdreAide(ordonnes)){
      /* Le modèle peut affiner l'ordre dans chaque groupe, mais ne peut pas
         mettre une suggestion taxonomique devant un besoin exprimé. */
      return IA_AIDE.appliquer(ordonnes, ordreModeleAide).sort((a,b)=>
        Number(b.aideExprime) - Number(a.aideExprime)).slice(0, limite || 5);
    }
  }
  return ordonnes.slice(0, limite || 5);
}

/* Une aide ponctuelle n'a de valeur que si l'on peut encore s'y présenter :
   en cours, imminente, aujourd'hui, demain, semaine, puis plus tard. Les
   structures permanentes ouvertes restent juste derrière les deux premiers
   cas et avant celles dont les horaires sont inconnus. */
function prioriteDisponibiliteAide(l){
  if(estTemporaire(l)){
    const etat = statutTemps(l);
    if(etat.statut === TEMPS.STATUTS.EN_COURS) return 60;
    if(etat.statut === TEMPS.STATUTS.IMMINENT) return 50;
    if(etat.statut === TEMPS.STATUTS.PLUS_TARD) return 40;
    if(etat.statut !== TEMPS.STATUTS.A_VENIR || etat.debut == null) return 0;
    const jours = Math.round((etat.debut - Date.now()) / 86400000);
    return jours <= 1 ? 30 : jours <= 7 ? 20 : 10;
  }
  const d = dispoDe(l);
  if(d && d.isOpenNow) return 35;
  if(d && d.status !== "unknown") return 25;
  return 20;
}

function ouvertOuImminent(l){
  if(estTemporaire(l)) return TEMPS.estMaintenant(statutTemps(l).statut);
  const d = dispoDe(l);
  return !!(d && d.isOpenNow);
}

/* Une carte d'aide répond à sept questions d'un coup d'œil : c'est quoi,
   pourquoi c'est proposé, est-ce ouvert, est-ce pour moi, où, gratuit,
   et à quelle condition. Rien n'y est inventé : ce qui n'est pas connu est
   annoncé comme tel. */
function carteAide(l){
  favorisEnMemoire.set(cleFavori(l), l);
  const c = categorieAffichee(l, {emoji:"🤝"});
  const photo = photoAutoriseeAide(l);
  const eph = estTemporaire(l);
  const quand = eph
    ? TEMPS.libelleTemporel(l, Date.now(), {disponibilite:(x,t)=>dispoDe(x, null, t)})
    : libelleOuverture(l);
  const etat = eph ? statutTemps(l).statut : null;
  const chaud = eph ? TEMPS.estMaintenant(etat) : ouvertOuImminent(l);

  const expl = EXPLIQUE ? EXPLIQUE.explication(l) : null;
  const cond = AIDE.conditionDe(l);
  const pour = AIDE.convient(l, {age:ageDeclare});
  const dist = positionMoi ? formatDist(distanceDepuisZone(l)) : "";
  /* Pas de durée depuis une position approchée : « 16 min » calculé à partir
     d'un point à plusieurs kilomètres est un chiffre faux, et il a l'air juste. */
  const eta = positionPrecise() && l.rankEta && Number.isFinite(l.rankEta.minutes)
    ? l.rankEta.minutes+" min" : "";

  return '<div class="ac-aide" role="button" tabindex="0" data-ac="'+esc(l.id)+'">'+
    '<div class="aa-tete"><span class="aa-emoji">'+c.emoji+'</span>'+
      '<span class="aa-nom">'+esc(l.titre)+'</span>'+boutonCoeur(l)+
      '<span class="aa-visuel" style="--teinte:'+(COULEURS_CAT[l.cat]||"#B82A3A")+'"><i>'+c.emoji+'</i>'+
        (photo ? '<img loading="lazy" decoding="async" alt="" src="'+esc(photo)+'" onload="this.classList.add(\'vue\')">' : '')+
      '</span></div>'+
    (expl && expl.texte
      ? '<p class="aa-quoi">'+esc(EXPLIQUE.resumeCourt(l, 150))+'</p>' : '')+
    '<p class="aa-quand'+(chaud?' chaud':'')+'">'+esc(quand)+
      (dist ? ' · '+esc(eta || dist) : '')+'</p>'+
    /* Une correspondance de réseau est une certitude ; une simple parenté de
       catégorie n'en est pas une, et la phrase doit le dire. Sans cette
       nuance, « ce lieu répond à ton besoin » se lit comme une promesse. */
    (l.aideRaison
      ? '<p class="aa-pourquoi"><b>'+(l.aideSur
          ? 'Pourquoi c’est proposé&nbsp;:' : 'Peut aider, à vérifier&nbsp;:')+'</b> '+esc(l.aideRaison)+
        (AIDE.pourquoi(l, besoinsAide, {age:ageDeclare}).includes("ans")
          ? " " + esc(AIDE.pourquoi(l, besoinsAide, {age:ageDeclare}).split(". ").pop()) : "")+'</p>' : '')+
    (cond ? '<p class="aa-cond">'+esc(cond.texte)+
      '<i>'+(cond.source === "reseau" ? "En général, dans ce réseau" : "Source : "+cond.source)+'</i></p>' : '')+
    (pour === false ? '<p class="aa-hors">Ce réseau ne correspond pas à l’âge que tu as indiqué.</p>' : '')+
    '<p class="aa-bas">'+(l.gratuit === true ? 'Gratuit · ' : '')+esc(l.adresse||"")+
      (l.tel ? ' · <a href="tel:'+esc(String(l.tel).replace(/\s/g,""))+'">Appeler</a>' : '')+'</p>'+
    (fiableAide(l) ? '' : '<p class="aa-verif">À vérifier avant de se déplacer.</p>')+
    '</div>';
}

/* Ce qu'on sait vraiment de l'ouverture d'un lieu permanent. */
function libelleOuverture(l){
  const d = dispoDe(l);
  if(!d) return "Horaires non renseignés";
  if(d.status === "unknown") return d.label || "Horaires non renseignés";
  if(d.status === "permanently_closed") return "Définitivement fermé";
  if(d.isOpenNow) return d.closesAtTime ? "Ouvert jusqu’à "+d.closesAtTime : "Ouvert";
  if(d.opensAtTime) return d.reason || ("Ouvre à "+d.opensAtTime);
  return "Fermé";
}

/* Une information est fiable quand elle vient d'une source datée et sûre.
   À défaut, on le dit — plutôt que d'envoyer quelqu'un devant une porte
   close avec l'assurance du contraire. */
function fiableAide(l){
  if(!DONNEES) return true;
  const h = DONNEES.normaliserHoraires(l, Date.now(), (x,t)=>dispoDe(x, null, t));
  return h.confidence >= .8;
}

/* Aucun résultat n'est jamais « aucun résultat » : c'est une impasse. On dit
   ce qu'on n'a pas trouvé, et on propose quatre sorties réelles. */
function aucuneSolutionHTML(){
  return '<div class="as-vide" data-testid="aide-vide">'+
    '<p class="as-vide-titre">'+(aideEtrangersEcartes
      ? 'Aucune aide fiable trouvée dans ce territoire. Élargir la recherche&nbsp;?'
      : 'Je n’ai pas trouvé de solution suffisamment fiable autour de cette zone.')+
      '</p>'+
    '<p class="as-vide-sous">Ça ne veut pas dire qu’il n’y en a pas.</p>'+
    '<div class="as-vide-actions">'+
      '<button class="pdep-btn pdep-fort" data-as-plus="1">Chercher plus loin</button>'+
      '<button class="pdep-btn" data-as="ville">Changer de ville</button>'+
      '<button class="pdep-btn" data-as="general">Voir les structures générales</button>'+
      '<button class="pdep-btn" data-as="reformuler">Reformuler mon besoin</button>'+
    '</div></div>';
}

/* ---- Ce qu'Autour a compris ---------------------------------------------
   Une phrase comme « un endroit calme pour bosser ce soir moins de 15 € à
   Lille » déclenche cinq décisions. Les garder invisibles, c'est laisser
   quelqu'un devant une liste inexplicable quand l'une d'elles est fausse.
   Chaque interprétation est donc une puce, et chaque puce se retire. */
function puceCouleur(type){
  return type === "contrainte" ? "dure" : type === "zone" ? "zone" : "";
}

function chipsHTML(){
  const st = intentionCourante;
  if(!st || !st.chips || !st.chips.length) return "";
  return '<div class="cps" data-testid="chips-comprises">'+
    '<span class="cps-titre">Compris&nbsp;:</span>'+
    st.chips.map(c=>
      '<button class="cp '+puceCouleur(c.type)+'" data-chip="'+esc(c.id)+'" '+
        'aria-label="Retirer : '+esc(c.label)+'">'+
        esc(c.label)+'<i aria-hidden="true">✕</i></button>').join("")+
    '</div>';
}

/* Retirer une interprétation : on ampute l'intention et on rejoue le
   classement, sans repasser par l'analyse du texte — sinon le mot retiré
   reviendrait aussitôt. */
function retirerChip(id){
  if(!intentionCourante || !COMPRENDRE) return;
  intentionCourante = COMPRENDRE.sansChip(intentionCourante, id);
  const [type, valeur] = String(id).split(":");
  if(type === "cat" && catsActives){
    catsActives.delete(valeur);
    if(!catsActives.size) catsActives = null;
  }
  if(type === "intention" || type === "cuisine"){ catsActives = null; filtreActif = "tout"; }
  if(type === "creneau"){ creneau = "maintenant"; filtreMaintenant = true; }
  if(type === "budget"){ filtresHumains.delete("budget"); filtresHumains.delete("gratuit"); }
  if(type === "proche") filtresHumains.delete("proche");
  if(type === "signal"){
    const f = FILTRE_DU_SIGNAL[valeur];
    if(f) filtresHumains.delete(f);
  }
  if(type === "zone"){ revenirAutourDeMoi(); return; }
  dessinerFiltres(); majFiltres(); rendre(); majFeuille2();
}

/* ==================================================================== */
/*  LE CONTEXTE TERRITORIAL TEMPORAIRE — 🧺                              */
/* ==================================================================== */
/* CE QUE CE BLOC BRANCHE, ET CE QU'IL NE BRANCHE PAS.

   Il ne branche PAS une seconde carte, ni un second moteur, ni un second
   système d'événements. Il pose une couche de contexte sur celui qui existe :
   pendant une manifestation qui transforme temporairement une ville, le même
   moteur reçoit un renseignement de plus, et rien d'autre ne change.

   La règle du produit ne bouge pas non plus : QUOI + QUAND + OÙ. Le mode ne
   raconte rien, il classe autrement.

   Toute la logique vit dans `territoire.js`, qui ne connaît ni le DOM ni la
   carte et se teste seul. Ici il n'y a que du câblage : lire la configuration,
   savoir où l'on regarde, décider quand réévaluer, et dessiner. */
const TERR = window.AutourTerritoire || null;

/* La configuration lue en base, telle quelle. Elle ne contient aucun
   événement : un nom, une emoji, une fenêtre de temps, des zones, des sources
   officielles. Les événements, eux, restent là où ils ont toujours été. */
let contextesTerritoriaux = [];
let contexteTerritorial = null;
let zoneTerritoriale = null;
let modeTerritorial = false;
/* La mémoire de la dernière évaluation : c'est elle qui permet de ne PAS
   recalculer parce que le GPS a varié de huit mètres. */
let etatTerritorial = null;
let contextesEnVol = null;

const CLE_CACHE_CONTEXTES = "autour:contextes-territoriaux:v1";

/* UN PÉRIMÈTRE NE CHANGE PAS DE LA SEMAINE.

   C'est exactement le genre d'information qui mérite un cache long, et le mode
   doit pouvoir démarrer sans réseau : à 14 h 30 le samedi, personne ne doit
   attendre qu'une API redécouvre la ville. Le TTL vient de `territoire.js`,
   par nature d'information — pas d'un nombre écrit ici. */
function lireCacheContextes(){
  try{
    const brut = JSON.parse(localStorage.getItem(CLE_CACHE_CONTEXTES) || "null");
    if(!brut || !Array.isArray(brut.lignes)) return null;
    return brut;
  }catch(e){ return null; }
}

function ecrireCacheContextes(lignes){
  try{
    localStorage.setItem(CLE_CACHE_CONTEXTES,
      JSON.stringify({t:Date.now(), lignes:lignes.slice(0, 200)}));
  }catch(e){}
}

/* La lecture. Elle ne déclenche aucune collecte, n'écrit rien, et ne bloque
   jamais un rendu : ce qui est en cache sert immédiatement, la mise à jour
   arrive derrière. Une panne de Supabase laisse donc le mode fonctionner sur
   le dernier périmètre connu. */
function chargerContextesTerritoriaux(){
  if(!TERR) return Promise.resolve([]);
  const cache = lireCacheContextes();
  if(cache){
    contextesTerritoriaux = TERR.depuisLignes(cache.lignes);
    PERF.touche("contextes_territoriaux", true);
    compterTerritorial("territorial_cache_hit");
    if(!TERR.perime(cache.t, TERR.NATURES.PERIMETRE)) return Promise.resolve(contextesTerritoriaux);
  }else{
    PERF.touche("contextes_territoriaux", false);
    compterTerritorial("territorial_cache_miss");
  }
  if(contextesEnVol) return contextesEnVol;
  contextesEnVol = (async()=>{
    if(!(await connecter()) || !sbLecture) return contextesTerritoriaux;
    const ref = pointDeReference();
    const fini = PERF.requete("supabase_contextes");
    try{
      const { data, error } = await sbLecture.rpc("contextes_territoriaux", {
        p_lat: Array.isArray(ref) ? Number(ref[0]) : null,
        p_lng: Array.isArray(ref) ? Number(ref[1]) : null,
      });
      if(error){
        /* Une configuration illisible n'est pas une panne d'Autour : le mode
           n'apparaît pas, et tout le reste continue exactement comme avant. */
        console.error("Contextes territoriaux :", error.message);
        return contextesTerritoriaux;
      }
      const lignes = data || [];
      ecrireCacheContextes(lignes);
      contextesTerritoriaux = TERR.depuisLignes(lignes);
      majContexteTerritorial();
      return contextesTerritoriaux;
    } finally { fini(); contextesEnVol = null; }
  })();
  return contextesEnVol;
}

/* Quel contexte, et dans quelle zone ? La réponse suit LE POINT REGARDÉ, pas
   la position physique : quelqu'un à Tourcoing qui regarde volontairement
   Wazemmes doit obtenir Wazemmes. C'est la règle d'Autour depuis `contexte.js`,
   et elle ne change pas parce qu'une manifestation a lieu. */
function majContexteTerritorial(){
  if(!TERR) return false;
  const ref = pointDeReference();
  const avant = contexteTerritorial && contexteTerritorial.slug;
  const avantZone = zoneTerritoriale && zoneTerritoriale.slug;
  contexteTerritorial = TERR.contexteActif(contextesTerritoriaux, Date.now(), ref);
  zoneTerritoriale = contexteTerritorial ? TERR.zoneDe(ref, contexteTerritorial) : null;
  /* Le contexte a pu disparaître pendant que l'application était ouverte —
     la manifestation se termine, il est minuit. Le mode se referme tout seul :
     aucun code à retirer après le week-end. */
  if(!contexteTerritorial && modeTerritorial){
    modeTerritorial = false;
    reglerBattementTerritorial();
  }
  /* On ne compte PAS le changement de zone ici : `reevaluerTerritorial` le
     fait déjà, et c'est lui qui sait si le changement mérite une réévaluation.
     Deux compteurs pour un même fait donneraient un chiffre faux. */
  return avant !== (contexteTerritorial && contexteTerritorial.slug) ||
    avantZone !== (zoneTerritoriale && zoneTerritoriale.slug);
}

/* Le bouton, ou rien. `territoire.js` décide des trois états — annonce,
   actif, disparu — et il n'y a rien à retirer à la main le lundi. */
function boutonTerritorial(){
  return TERR && contexteTerritorial ? TERR.bouton(contexteTerritorial, Date.now()) : null;
}

/* Les entrées rapides du moment : les quatre habituelles, et le contexte
   temporaire juste à côté de « ⚡ Maintenant » quand il existe. C'est le seul
   endroit où le mode s'affiche : pas de carte spéciale, pas d'écran différent,
   pas de thème graphique — Autour reste Autour. */
function besoinsDuMoment(){
  const b = boutonTerritorial();
  if(!b) return BESOINS_RAPIDES;
  const rapides = BESOINS_RAPIDES.slice();
  const apresMaintenant = rapides.findIndex(x=>x.id === "maintenant");
  const entree = {id:"territorial", emoji:b.emoji, label:b.libelle,
                  annonce:!b.actif};
  rapides.splice(apresMaintenant < 0 ? rapides.length : apresMaintenant + 1, 0, entree);
  return rapides;
}

/* Ce que le moteur de classement reçoit — et c'est TOUT ce qu'il reçoit. Le
   contexte et la zone, rien de plus : les points sont calculés par
   `territoire.js`, et ils s'ajoutent au score existant. */
function contexteTerritorialClassement(){
  if(!TERR || !contexteTerritorial) return null;
  if(TERR.phase(contexteTerritorial, Date.now()) !== TERR.PHASES.PENDANT) return null;
  return {contexte:contexteTerritorial, zone:zoneTerritoriale};
}

/* ---- QUAND RÉÉVALUER ------------------------------------------------------

   Deux choses que ce code ne confond pas :

     RECALCULER    distance, temps d'accès, classement — depuis ce qu'on a
                   déjà. Gratuit, local, aucune requête.
     RESYNCHRONISER rappeler OpenAgenda, DATAtourisme, Overpass ou le modèle.
                   Ne dépend QUE de l'âge des données, jamais d'un déplacement.

   Un GPS qui varie de huit mètres ne déclenche rien. Quatre cents mètres, un
   changement de zone, une information expirée ou un retour au premier plan
   après une longue absence, oui. */
function reevaluerTerritorial(options){
  if(!TERR || !contexteTerritorial) return null;
  const o = options || {};
  const zoneAvant = zoneTerritoriale && zoneTerritoriale.slug;
  majContexteTerritorial();
  const courant = {
    maintenant: Date.now(),
    position: positionMoi,
    centre: pointDeReference(),
    zone: zoneTerritoriale ? zoneTerritoriale.slug : null,
    ouverture: !!o.ouverture,
    retourPremierPlan: !!o.retourPremierPlan,
    donnees: {
      [TERR.NATURES.PERIMETRE]: (lireCacheContextes() || {}).t || null,
    },
  };
  const verdict = TERR.doitReevaluer(etatTerritorial, courant);
  if(verdict.recalculer){
    compterTerritorial("territorial_recompute");
    etatTerritorial = Object.assign({}, courant, {expireLe: Date.now() + TERR.TTL[TERR.NATURES.TEMPOREL]});
    /* Recalculer, c'est repartir de ce qu'on a. Aucune requête ne part d'ici,
       et c'est exactement ce qu'on veut le jour où cent mille personnes sont
       au même endroit. */
    oublierItemsMaintenant();
    planifierRendu({accueil:true, feuille:true});
  }
  if(verdict.resynchroniser) void chargerContextesTerritoriaux();
  if(zoneAvant !== courant.zone) compterTerritorial("territorial_zone_changed");
  return verdict;
}

/* ---- LE TEMPS QUI PASSE PENDANT QU'ON REGARDE -----------------------------

   « Se termine à 15 h » devient faux à 15 h, que la carte ait bougé ou non.
   Rien dans Autour ne rafraîchit périodiquement — c'est un choix, et il tient
   tant qu'on regarde des lieux dont les horaires ne changent pas dans la
   minute. Une manifestation, elle, se joue à l'heure près : une activité
   terminée doit sortir du classement tout de suite, pas au prochain
   déplacement de carte.

   Le battement n'existe donc QUE pendant que le mode est ouvert et que
   quelqu'un regarde, et il ne fait que recalculer : aucune requête ne part de
   là. Sa période est celle de l'information la plus périssable — elle vient de
   `territoire.js`, pas d'un nombre écrit ici. */
let battementTerritorial = null;

function reglerBattementTerritorial(){
  const doitBattre = modeTerritorial && !!contexteTerritorial &&
    (typeof document === "undefined" || document.visibilityState !== "hidden");
  if(doitBattre === (battementTerritorial !== null)) return;
  if(!doitBattre){
    clearInterval(battementTerritorial);
    battementTerritorial = null;
    return;
  }
  battementTerritorial = setInterval(()=>{
    if(!modeTerritorial || !contexteTerritorial){ reglerBattementTerritorial(); return; }
    reevaluerTerritorial();
  }, TERR.TTL[TERR.NATURES.TEMPOREL]);
}

/* ---- OUVRIR LE MODE -------------------------------------------------------
   Le même écran, la même feuille, le même créneau « maintenant ». Ce qui
   change est le classement, pas l'interface. */
function ouvrirModeTerritorial(){
  if(!contexteTerritorial) return;
  if(modeAide) basculerAide();
  modeTerritorial = true;
  creneau = "maintenant";
  filtreMaintenant = true;
  ongletCourant = "explorer";
  marquerNavigation("explorer");
  contexteExplorer = null;
  compterTerritorial("territorial_mode_opened");
  reevaluerTerritorial({ouverture:true});
  ouvrirFeuille2("racine");
  reinitialiserScrollFeuille();
  rendre();
  majFeuille2();
  reglerBattementTerritorial();
}

function fermerModeTerritorial(){
  if(!modeTerritorial) return;
  modeTerritorial = false;
  reglerBattementTerritorial();
  planifierRendu({accueil:true, feuille:true});
}

/* ---- « UTILE AUTOUR DE TOI » ---------------------------------------------

   Un bloc court, APRÈS les propositions, jamais à leur place. Ces objets ne
   deviennent pas des événements pour autant : des toilettes restent un
   service, une station reste une station, et un poste de secours passe par le
   système Aide existant — même ontologie, mêmes règles.

   `estFerme` est déjà l'autorité d'Autour sur « c'est fermé » : un service
   fermé n'aide personne, et on ne le propose pas. */
function servicesTerritoriaux(){
  if(!TERR || !modeTerritorial || !contexteTerritorial) return [];
  const ref = pointDeReference();
  if(!Array.isArray(ref)) return [];
  return TERR.services(lieux.filter(dansZoneActive).map(l=>({
    id:l.id, cat:l.cat, titre:l.titre, lat:l.lat, lng:l.lng,
    ouvert: estFerme(l) ? false : (l.ouvert == null ? null : l.ouvert),
  })), {position:ref, rayonMax:Math.min(1500, rayonRegarde())});
}

function blocServicesTerritoriaux(){
  const services = servicesTerritoriaux();
  if(!services.length) return "";
  return '<section class="tsv" data-testid="services-territoriaux">'+
    '<p class="tsv-tete">UTILE AUTOUR DE TOI</p>'+
    '<ul class="tsv-l">'+services.map(s=>
      '<li><button data-tsv="'+esc(s.item.id)+'">'+
        '<em aria-hidden="true">'+s.emoji+'</em>'+
        '<b>'+esc(s.label)+'</b>'+
        '<u>'+esc(formatDist(s.distance))+'</u></button></li>').join("")+
    '</ul></section>';
}

/* ---- L'EN-TÊTE DU MODE ----------------------------------------------------

   À Tourcoing pendant la Braderie, le bouton peut exister — mais ouvrir le
   mode ne doit JAMAIS laisser croire qu'on est dans le périmètre. On dit la
   distance, et on propose de recentrer. C'est une phrase et un bouton, pas un
   écran de plus. */
function enTeteTerritoriale(){
  if(!TERR || !modeTerritorial || !contexteTerritorial) return "";
  const b = boutonTerritorial();
  if(!b) return "";
  const ref = pointDeReference();
  const dedans = TERR.dansPerimetre(ref, contexteTerritorial);
  const loin = dedans ? null : TERR.distanceAuPerimetre(ref, contexteTerritorial);
  const sous = b.phase === TERR.PHASES.AVANT
    ? "Le programme, avant que ça commence"
    : dedans
      ? (zoneTerritoriale ? zoneTerritoriale.nom : "Autour de toi")
      : (loin != null ? "À "+formatDist(loin)+" du périmètre" : "Hors du périmètre");
  return '<section class="tterr" data-testid="entete-territoriale" '+
    'data-tterr-phase="'+esc(b.phase)+'">'+
    '<p class="tterr-tete"><em aria-hidden="true">'+esc(b.emoji)+'</em>'+
      '<b>'+esc(b.libelle.toUpperCase())+'</b></p>'+
    '<p class="tterr-sous">'+esc(sous)+'</p>'+
    (dedans ? "" :
      '<button class="tterr-recentrer" data-tterr-recentrer="1">Recentrer sur '+
        esc(contexteTerritorial.zones.length ? contexteTerritorial.nom : "le périmètre")+
      '</button>')+
    '</section>';
}

/* ---- CE QU'ON MESURE, ET CE QU'ON N'ÉCRIT JAMAIS --------------------------

   Des compteurs. Aucune phrase saisie dans Aide, aucun identifiant, aucune
   position : `territoire.js` refuse tout nom hors de sa liste gelée, et la
   fonction Postgres refuse une deuxième fois. Ce qui remonte est un slug de
   zone — « wazemmes » — et un entier.

   L'envoi est différé et grouppé : il ne doit jamais peser sur un rendu, et il
   n'a aucune importance s'il n'arrive pas. */
function compterTerritorial(nom, valeur, zone){
  if(!TERR) return;
  if(!TERR.compter(nom, valeur == null ? 1 : valeur,
      zone || (zoneTerritoriale && zoneTerritoriale.slug) || null)) return;
  /* Groupé, différé, et sans importance s'il n'arrive pas. Le garde-fou de
     `planifierEnvoiMetriques` fait qu'appeler ceci cent fois en une seconde
     ne produit qu'un seul envoi. */
  planifierEnvoiMetriques();
}

let envoiMetriquesPlanifie = false;
function envoyerMetriquesTerritoriales(){
  if(!TERR || !contexteTerritorial || !sbLecture) return;
  const rapport = TERR.rapport();
  const noms = Object.keys(rapport.compteurs);
  if(!noms.length) return;
  TERR.oublier();
  const slug = contexteTerritorial.slug;
  noms.forEach(nom=>{
    void Promise.resolve(sbLecture.rpc("compter_metrique_territoriale", {
      p_context:slug, p_metrique:nom, p_valeur:rapport.compteurs[nom], p_zone:null,
    })).catch(()=>{});
  });
  Object.entries(rapport.zones).forEach(([zone, lignes])=>{
    Object.entries(lignes).forEach(([nom, valeur])=>{
      void Promise.resolve(sbLecture.rpc("compter_metrique_territoriale", {
        p_context:slug, p_metrique:nom, p_valeur:valeur, p_zone:zone,
      })).catch(()=>{});
    });
  });
}

function planifierEnvoiMetriques(){
  if(envoiMetriquesPlanifie || !TERR) return;
  envoiMetriquesPlanifie = true;
  const envoyer = ()=>{ envoiMetriquesPlanifie = false; envoyerMetriquesTerritoriales(); };
  if(ORDO) ORDO.differer(envoyer, {timeout:4000});
  else setTimeout(envoyer, 4000);
}

/* ---- Les besoins rapides ------------------------------------------------
   Quatre entrées, pas dix : les trois envies les plus fréquentes et l'aide.
   Elles vivaient dans la loupe, c'est-à-dire nulle part pour qui n'ouvre pas
   la recherche. Ici, elles disent en une ligne ce que l'application sait
   faire — ce qui est la première chose à comprendre.

   Une cinquième peut s'ajouter, temporairement : le contexte territorial, à
   côté de « ⚡ Maintenant », pendant la seule période où il existe. */
const BESOINS_RAPIDES = [
  {id:"manger", emoji:"🍜", label:"Manger"},
  {id:"sortir", emoji:"🎉", label:"Sortir"},
  {id:"maintenant", emoji:"⚡", label:"Maintenant"},
  {id:"aide", emoji:"❤️", label:"Aide"},
];

/* Le même geste, où que les boutons soient posés — barre du haut sur grand
   écran, panneau sur mobile. */
function brancherBesoinsRapides(racine){
  if(!racine) return;
  racine.querySelectorAll("[data-br]").forEach(b=>b.onclick=()=>{
    const id = b.dataset.br;
    if(id === "aide"){ if(!modeAide) basculerAide(); ouvrirFeuille2("aide"); return; }
    /* Le contexte temporaire : le même écran, le même créneau, la même
       feuille. Rouvrir le bouton quand le mode est déjà ouvert le referme —
       c'est une bascule, comme Aide. */
    if(id === "territorial"){
      if(modeTerritorial){ fermerModeTerritorial(); majFeuille2(); rendre(); return; }
      ouvrirModeTerritorial(); return;
    }
    if(id === "maintenant"){
      modeTerritorial = false;
      creneau = "maintenant"; filtreMaintenant = true;
      majFeuille2(); rendre(); majFiltres(); return;
    }
    if(modeAide) basculerAide();
    ouvrirFeuille2(id);
  });
}

function besoinsRapidesHTML(){
  return '<div class="br" data-testid="besoins-rapides">'+
    besoinsDuMoment().map(b=>{
      const actif = b.id === "territorial" ? modeTerritorial
        : b.id === "maintenant" ? (creneau === "maintenant" && !modeTerritorial)
        : b.id === "aide" ? modeAide
        : !!(catsActives && feuilleNiveau === b.id);
      /* L'annonce se lit comme une annonce : le bouton existe, il n'est pas
         encore la commande principale. Une nuance, pas un thème. */
      return '<button class="br-b'+(actif?" actif":"")+
        (b.annonce?" br-annonce":"")+'" data-br="'+b.id+'">'+
        '<em>'+b.emoji+'</em>'+esc(b.label)+'</button>';
    }).join("")+'</div>';
}

/* ---- Les quatre groupes de temps, en tête de l'accueil -------------------
   « Maintenant », « Autour de moi », « Pour toi » et « Explorer » disaient à
   peu près la même chose par quatre portes différentes. Il n'en reste qu'une :
   Explorer, et à l'intérieur le temps. */
/* Combien d'événements ont VRAIMENT lieu en ce moment.

   Le comptage ne réinterprète rien : il demande son statut au moteur temporel,
   qui pour un événement canonique se contente de relayer le verdict de
   Postgres. Un événement de demain ne peut donc pas entrer dans ce nombre,
   même si le classement le trouve pertinent — c'est exactement la garantie
   demandée : « Maintenant » ne se remplit jamais artificiellement. */
function compterMaintenant(){
  const t = Date.now();
  return elementsDuContexte(lieux).reduce((n,l)=>{
    if(!estTemporaire(l) || l.annule) return n;
    return TEMPS.estMaintenant(statutTemps(l, t).statut) ? n+1 : n;
  }, 0);
}

/* La pastille suit le comptage, et le comptage suit le moteur temporel.
   Elle disparaît à zéro plutôt que d'afficher « Maintenant · 0 » : un compteur
   à zéro occupe la même place et demande la même lecture pour ne rien dire. */
/* LA PASTILLE ET LE BLOC DOIVENT DIRE LE MÊME NOMBRE.

   Elle comptait avec `compterMaintenant`, qui ne connaît que les événements
   temporaires et les juge au moteur temporel. Le bloc, lui, compte avec le
   moteur de disponibilité : événements en cours, séances, activités, lieux
   ouverts. Deux comptages différents sous le même mot — la pastille annonçait
   « 0 » (donc restait cachée) au-dessus d'un bloc qui proposait trois choses.

   Un seul comptage désormais, celui du bloc, et il porte déjà la zone active :
   la pastille de Lille ne compte pas ce qui se passe à Tourcoing. */
function majBadgeMaintenant(){
  const badge = $("#badgeMaintenant");
  if(!badge) return;
  const n = (modeNav || modePose || modeAide) ? 0 : totalMaintenant();
  badge.hidden = n === 0;
  if(n === 0) return;
  const compte = $("#bmCompte");
  /* Le bloc n'en montre jamais plus de trois : la pastille annonce ce qu'on
     va effectivement voir, pas ce qui existe en base. */
  if(compte) compte.textContent = String(Math.min(n, MAINTENANT_APERCU));
  /* « Près de toi » est faux dès qu'on regarde une autre ville — et c'est
     exactement le moment où la phrase compte. Elle nomme donc la zone. */
  const sous = badge.querySelector(".bm-sous");
  const ou = zoneActive && CTX && zoneActive.type === CTX.TYPES.RECHERCHE && zoneActive.nom
    ? "À " + zoneActive.nom + " en ce moment" : "En cours près de toi";
  if(sous) sous.textContent = ou;
  badge.setAttribute("aria-label", n + " chose" + (n > 1 ? "s" : "") + " à faire — " + ou);
}

/* Ce qui a lieu MAINTENANT, en tête de la feuille et sous sa propre étiquette.

   Le classement mélangeait les événements en cours aux commerces ouverts,
   triés par pertinence : trois concerts et une boulangerie dans la même
   liste, sans que rien ne distingue « ça se passe » de « c'est ouvert ». Les
   événements en cours sont peu nombreux — c'est justement ce qui les rend
   précieux — et ils passent donc devant, comptés et nommés.

   Le bloc n'existe pas s'il n'y a rien : pas de titre orphelin au-dessus du
   vide. Et il ne s'affiche que dans « Maintenant » — dans « Ce soir » ou
   « À venir », il parlerait d'autre chose que de l'onglet ouvert. */
function evenementsMaintenant(){
  const t = Date.now();
  return elementsDuContexte(lieux).filter(l=>estTemporaire(l) && !l.annule &&
    TEMPS.estMaintenant(statutTemps(l, t).statut));
}

/* Ce que la ligne dit du TEMPS dépend de ce qu'elle est. Écrire « jusqu'à
   20:00 » sous un cinéma dont la séance commence à 20:00 dirait exactement le
   contraire de la vérité. */
function tempsMaintenant(l){
  const M = window.AutourMaintenant;
  const evenement = estTemporaire(l) ? donneesEvenement(l) : null;
  const debutLe = evenement && evenement.start_at != null
    ? new Date(evenement.start_at).getTime() : l.debutLe;
  const finLe = evenement && evenement.end_at != null
    ? new Date(evenement.end_at).getTime() : l.finLe;
  if(M && l.nature === M.NATURES.SEANCE && debutLe){
    const dans = Math.round((debutLe - Date.now()) / 60000);
    return dans > 0 ? "commence dans "+dans+" min" : "commence maintenant";
  }
  if(M && (l.nature === M.NATURES.OUVERT || l.nature === M.NATURES.ACTIVITE)){
    /* Pour un lieu, c'est `availability.js` qui écrit l'heure — le même texte
       que partout ailleurs dans Autour, pas une seconde formulation. */
    const d = dispoDe(l);
    if(d && d.closesAtTime) return "ouvert jusqu’à "+d.closesAtTime;
    return "ouvert";
  }
  return finLe ? "jusqu’à "+heureLocale(finLe, l) : "";
}

function ligneMaintenant(l){
  const c = categorieAffichee(l);
  /* Regarder Paris depuis Lille affichait « 220 km » sous chaque concert : une
     mesure exacte et parfaitement inutile. On ne montre une distance que
     lorsqu'on est dans la zone regardée ; sinon le lieu se suffit. */
  const dist = jeSuisDansLaZoneRegardee()
    ? formatDist(distanceDepuisZone(l)) : "";
  const bas = [dist, tempsMaintenant(l)].filter(Boolean).join(" · ");
  const lieu = l.adresse || l.cp || "";
  return '<button class="mn-l" data-mn="'+esc(l.id)+'">'+
    '<span class="mn-rond" style="background:'+(COULEURS_CAT[l.cat]||"#5D6B63")+'">'+
      c.emoji+'</span>'+
    '<span class="mn-txt"><b>'+esc(l.titre)+'</b>'+
      (lieu ? '<i>'+esc(lieu)+'</i>' : '')+
      (bas ? '<u>'+esc(bas)+'</u>' : '')+'</span>'+
    '<span class="mn-fl" aria-hidden="true">›</span></button>';
}

const ORDO = window.AutourOrdonnanceur || null;

/* ==================================================================== */
/*  POUR TOI — ce qui vient d'apparaître et qui te concerne              */
/* ==================================================================== */
/* Le panneau ne fabrique rien. Il regarde les événements DÉJÀ chargés par le
   chemin critique, garde ceux qui se rattachent à une envie cochée, et les
   présente avec la raison de leur présence. Aucune requête ne part d'ici :
   sans donnée, il le dit et propose de choisir des envies.

   Il est peint APRÈS le chemin critique — c'est une information secondaire,
   elle n'a pas le droit de retarder la carte ni « Maintenant ». */

const ENVIES = window.AutourEnvies || null;
const ANNONCES = window.AutourAnnoncesClassement || null;
const TAXONOMIE_ANNONCES = window.AutourAnnoncesTaxonomie || null;
const POURTOI_TOUT_MAX = 300;
const CLE_POURTOI_VU = "autour:pourtoi-vu:v1";
const CLE_POURTOI_MASQUES = "autour:pourtoi-masque:v1";
const POURTOI_MAX = 6;

/* LA PASTILLE « +N » DE POUR TOI.

   Elle compte les nouveautés, elle ne dit pas seulement qu'il y en a. Son
   registre est SÉPARÉ de « vu » : être annoncé dans la pastille ne grise pas
   la carte, sinon ouvrir le panneau effacerait ce qu'on venait signaler. */
const CLE_POURTOI_ANNONCE = "autour:pourtoi-annonce:v1";
const CLE_POURTOI_CONSULTE = "autour:pourtoi-consulte:v1";
const POURTOI_PASTILLE_MAX = 9;
const POURTOI_MEMOIRE_MAX = 400;

/* « Détecté il y a… » n'a de sens que sur une découverte récente. Au-delà,
   l'événement n'est plus une nouvelle : il est simplement au programme. */
const POURTOI_NOUVEAU_MS = 72 * 3600 * 1000;

function marquesVues(){
  try{ const v = JSON.parse(localStorage.getItem(CLE_POURTOI_VU) || "[]");
    return new Set(Array.isArray(v) ? v : []); }
  catch(e){ return new Set(); }
}

function ecrireMarquesVues(ids){
  try{ localStorage.setItem(CLE_POURTOI_VU, JSON.stringify([...ids].slice(-200))); }
  catch(e){}
}

function marquesMasquees(){
  try{ const v = JSON.parse(localStorage.getItem(CLE_POURTOI_MASQUES) || "[]");
    return new Set(Array.isArray(v) ? v.map(String) : []); }
  catch(e){ return new Set(); }
}

function ecrireMarquesMasquees(ids){
  try{ localStorage.setItem(CLE_POURTOI_MASQUES, JSON.stringify([...ids].slice(-200))); }
  catch(e){}
}

function masquerPourToi(id){
  const masquees = marquesMasquees();
  masquees.add(String(id));
  ecrireMarquesMasquees(masquees);
}

/* Depuis combien de temps Autour connaît cet événement. La date vient de la
   synchronisation en base (`last_synced_at`) : c'est une vraie mesure, pas une
   impression d'actualité. Sans elle, on n'écrit rien. */
function detecteDepuis(l){
  const t = l && l.majLe ? new Date(l.majLe).getTime() : NaN;
  if(!Number.isFinite(t)) return null;
  const ms = Date.now() - t;
  if(ms < 0 || ms > POURTOI_NOUVEAU_MS) return null;
  const h = Math.floor(ms / 3600000);
  if(h < 1) return "détecté il y a moins d’une heure";
  if(h < 24) return "détecté il y a "+h+" h";
  const j = Math.floor(h / 24);
  return "détecté il y a "+j+" jour"+(j > 1 ? "s" : "");
}

/* Les propositions : des événements à venir, rattachés à une envie suivie.
   Le plus récemment détecté d'abord — c'est ce que le panneau annonce. */
/* Un doublon rattaché à un événement canonique n'est jamais proposé : il
   ferait compter deux fois la même soirée. */
function estCanonique(l){
  if(!l) return false;
  const maitre = l.duplicate_of || l.duplicateOf;
  return !maitre || String(maitre) === String(l.id);
}

async function chargerEvenementsMetropole(bassin){
  if(!sbLecture || !bassin) return [];
  /* On ne demande plus un rectangle de 25 km — on demandait bien 25 km, et
     `evenements_proches` les ramenait à 5 : elle recalcule son rayon d'après
     le territoire qui contient le centre, et pour quelqu'un à Tourcoing c'est
     Tourcoing, rayon 5 km. Le bassin métropolitain n'existait donc pas à
     l'exécution.

     `evenements_bassin` pose l'autre question : non pas « qu'y a-t-il à moins
     de N kilomètres » mais « qu'y a-t-il dans MON bassin ». L'appartenance
     territoriale décide, la distance ne plafonne plus rien — c'est le
     classement qui la pondère ensuite. `Maintenant` continue de passer par
     `evenements_proches`, inchangée. */
  const fini = PERF.requete("supabase_metropole");
  try{
    const { data, error } = await sbLecture.rpc("evenements_bassin", {
      p_group_slug: String(bassin),
      p_limite: METROPOLE_LIMITE
    });
    if(error){
      journal.warn("Bassin métropolitain indisponible :", error.message);
      return [];
    }
    /* `metro_area` vient de la base, qui sait à quel territoire l'événement
       appartient. On ne l'écrase pas par le bassin de la personne : affirmer
       que tout ce qui est à 25 km est « du même bassin » ferait passer pour
       métropolitain ce qui ne l'est pas. */
    return (Array.isArray(data) ? data : []).map(versEvenementCanonique).filter(Boolean);
  }catch(error){
    journal.warn("Bassin métropolitain indisponible :", error?.message || error);
    return [];
  }finally{
    fini();
  }
}

function rafraichirMetropole(){
  /* Le bassin ne dépend pas de l'endroit exact où l'on se tient : se déplacer
     de Tourcoing à Lille ne change pas la métropole. La clé de cache est donc
     le bassin lui-même, et non des coordonnées. */
  const bassin = bassinTerritorialActif?.group_slug || bassinTerritorialActif?.groupSlug || null;
  if(!bassin || metropoleEnCours === bassin) return;
  const porteeMetropole = porteeCourante;
  metropoleEnCours = bassin;
  chargerEvenementsMetropole(bassin).then((liste)=>{
    /* Un changement de ville peut arriver pendant la lecture du bassin. Une
       réponse MEL arrivée après une recherche Paris ne doit jamais repeupler
       « Pour toi » ; la portée et le nom du bassin doivent encore être ceux
       qui ont lancé cette requête. */
    const bassinCourant = bassinTerritorialActif?.group_slug || bassinTerritorialActif?.groupSlug || null;
    if(porteeMetropole !== porteeCourante || bassinCourant !== bassin) return;
    /* Une liste vide n'est pas un résultat : c'est un chargement qui n'a rien
       ramené, souvent parce que le réseau a flanché. Garder la clé de cache
       interdirait tout nouvel essai jusqu'au rechargement de la page. */
    if(!liste.length){ metropoleEnCours = null; return; }
    evenementsMetropole = liste;
    majPourToi();
  }).catch(()=>{
    if(porteeMetropole === porteeCourante) metropoleEnCours = null;
  });
}

function bassinPourToi(){
  /* `lieux` d'abord — il porte les publications et l'état le plus frais —,
     puis ce que la métropole ajoute et que la carte locale ne voyait pas. Un
     identifiant déjà présent n'est jamais remplacé. */
  /* Le bassin est chargé en dehors du rayon local : il doit néanmoins rester
     borné par le contexte de destination. Sinon une réponse MEL ou un cache
     de la ville précédente pouvait traverser jusqu'à « Pour toi ». */
  const locaux = elementsDuContexte(lieux).filter(estCanonique);
  if(!evenementsMetropole.length) return locaux;
  const vus = new Set(locaux.map((l)=> l && l.id));
  return locaux.concat(elementsDuContexte(evenementsMetropole)
    .filter((l)=>l && !vus.has(l.id) && estCanonique(l)));
}

function lieuParId(id){
  /* OUVRIR CE QU'ON PROPOSE.

     « Pour toi » puise dans `bassinPourToi()`, donc aussi dans ce que le
     bassin métropolitain a ramené. Ces événements-là ne sont dans `lieux` que
     s'ils tombaient déjà dans le rayon local ; les autres n'existent que dans
     `evenementsMetropole`. `ouvrirDetail` ne cherchait que dans `lieux` : la
     carte se comportait comme un bouton, le gestionnaire partait, et
     l'ouverture sortait en silence sur son `if(!l) return`. Rien ne se
     passait, sans la moindre erreur pour le dire.

     La résolution suit désormais le même ordre que `bassinPourToi` : `lieux`
     d'abord, qui porte l'état le plus frais, la métropole ensuite. */
  if(id == null) return null;
  const cle = String(id);
  const dansContexte = typeof dansZoneActive === "function" ? dansZoneActive : ()=>true;
  return lieux.find((x)=> x && String(x.id) === cle && dansContexte(x))
      || evenementsMetropole.find((x)=> x && String(x.id) === cle && dansContexte(x))
      || null;
}

function pourquoiAnnonce(x){
  return {
    /* Le classement produit cette phrase à partir des tags qui ont réellement
       matché. Aucun libellé n'est déduit du domaine général de l'événement. */
    texte: x.reason || "correspondance explicite avec une envie suivie",
    solide: true
  };
}

function dateAnnonceProposition(value){
  if(!value) return "";
  const t = new Date(value).getTime();
  if(!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("fr-FR", {
    day:"numeric", month:"long", year:"numeric", hour:"2-digit", minute:"2-digit"
  });
}

function groupesInteretsPourToi(propositions){
  if(!TAXONOMIE_ANNONCES) return [];
  const groupes = new Map();
  const ordre = (ENVIES ? ENVIES.choisies() : []).map((id)=>{
    const canonique = TAXONOMIE_ANNONCES.normaliserInteret(id);
    return { id:canonique, label: TAXONOMIE_ANNONCES.INTEREST_LABELS[canonique] || String(id) };
  });
  propositions.forEach((proposition)=>{
    const ids = new Set((proposition.matchedInterests || []).map((id)=> TAXONOMIE_ANNONCES.normaliserInteret(id)));
    ids.forEach((id)=>{
      const entree = ordre.find((item)=> item.id === id);
      if(!entree) return;
      if(!groupes.has(id)) groupes.set(id, { id, label: entree.label, propositions: [] });
      groupes.get(id).propositions.push(proposition);
    });
  });
  return ordre.map((item)=> groupes.get(item.id)).filter(Boolean);
}

function propositionsPourToi(limite = POURTOI_MAX){
  if(!ENVIES || !ENVIES.choisies().length || !ANNONCES) return [];
  const vues = marquesVues();
  /* Le classement vit dans `annonces-classement.js`, pas ici : c'est lui qui
     sait apparier tags et envies, et il travaille sur le bassin entier. */
  const classes = ANNONCES.classerPourToi(bassinPourToi(), {
    now: Date.now(),
    interests: ENVIES.choisies(),
    seenIds: [...vues],
    hiddenIds: [...marquesMasquees()],
    limit: Number.isFinite(Number(limite)) ? Math.max(0, Number(limite)) : POURTOI_MAX,
    distanceFor: (event)=> distanceDepuisZone(event),
    metroArea: bassinTerritorialActif?.group_slug || bassinTerritorialActif?.groupSlug || null,
    territorySlug: bassinTerritorialActif?.slug || null
  });
  return classes.map((classe)=>({
    l: classe.event,
    groupe: classe.group,
    groupeLabel: ANNONCES.libelleGroupe(classe.group),
    pourquoi: pourquoiAnnonce(classe),
    nouveau: classe.isNew ? detecteDepuis(classe.event) : null,
    vu: classe.seen,
    score: classe.score,
    matchedInterests: Array.isArray(classe.matched_interests) ? classe.matched_interests : []
  }));
}

/* La date d'un événement, écrite par le moteur temporel — le même texte que
   partout ailleurs dans Autour. Sans date exploitable, la ligne disparaît. */
function dateProposition(l){
  const T = window.AutourTemps;
  const cible = estTemporaire(l) ? donneesEvenement(l) : l;
  const libelle = T && T.libelleDate ? T.libelleDate(cible, Date.now()) : "";
  return libelle && libelle !== "Date à vérifier" ? libelle : "";
}

function fallbackVisuelEvenement(l, c, classe){
  const f = IMAGES && IMAGES.fallbackEvenement
    ? IMAGES.fallbackEvenement(l && l.cat) : {key:"event", emoji:(c && c.emoji) || "✨"};
  return '<span class="'+classe+' event-fallback event-fallback-'+esc(f.key || "event")+'" aria-hidden="true">'+
    '<i>'+esc(f.emoji || (c && c.emoji) || "✨")+'</i><small>Visuel Autour</small></span>';
}

/* Les images sont décoratives dans les listes : une panne réseau les retire
   proprement et laisse la composition Autour en place. Le même gestionnaire
   sert à la fiche, où il retire aussi un crédit qui ne correspondrait plus à
   une image visible. */
function imageEvenementErreur(img){
  if(!img) return;
  const parent = img.parentElement;
  const figure = img.closest ? img.closest("figure") : null;
  if(parent) parent.classList.add("image-absente");
  if(figure){
    figure.classList.add("image-absente", "sans-photo");
    const credit = figure.querySelector("figcaption");
    if(credit) credit.remove();
  }
  img.remove();
}

function imageEvenementChargee(img){
  if(!img) return;
  const parent = img.parentElement;
  if(parent) parent.classList.add("image-ready");
  img.classList.add("image-ready");
  const figure = img.closest ? img.closest("figure") : null;
  const cadre = img.closest ? img.closest("[data-image-type],[data-image-scope]") : parent;
  const type = cadre && cadre.dataset ? cadre.dataset.imageType : "";
  const scope = cadre && cadre.dataset && cadre.dataset.imageScope ||
    (figure && figure.classList.contains("event-couverture") ? "evenement" : "lieu");
  const presentation = IMAGES && IMAGES.modeImage
    ? IMAGES.modeImage({image_type:type, image_scope:scope,
        image_width:img.naturalWidth, image_height:img.naturalHeight}) : null;
  if(presentation){
    img.style.objectFit = presentation.object_fit;
    if(!presentation.can_upscale){
      img.style.width = "auto";
      img.style.height = "auto";
      img.style.maxWidth = "100%";
      img.style.maxHeight = "100%";
      img.style.margin = "auto";
    }
  }
  if(!figure) return;
  const classes = figure.classList.contains("event-couverture") && IMAGES && IMAGES.ratioImage
    ? IMAGES.ratioImage(img.naturalWidth, img.naturalHeight,
        type).split(/\s+/).filter(Boolean)
    : [];
  figure.classList.remove("event-couverture-paysage", "event-couverture-portrait",
    "event-couverture-carre", "event-couverture-inconnue", "event-couverture-basse",
    "event-couverture-affiche");
  figure.classList.add(...classes, "image-ready");
}

function visuelCarteEvenement(l, c, taille){
  const classeImage = taille === "npt" ? "npt-img" : "pt-img";
  const classeConteneur = taille === "npt" ? "npt-image-shell" : "pt-image-shell";
  const media = mediaDe(l);
  return '<span class="'+classeConteneur+'" data-image-type="'+esc(media.image_type||"")+
    '" data-image-scope="'+esc(media.image_scope||"")+'" aria-hidden="true">'+
    fallbackVisuelEvenement(l, c, "event-fallback-carte")+
    '<img class="'+classeImage+'" src="'+esc(media.image_url)+'" alt="" loading="lazy" decoding="async"'+
      ' onload="imageEvenementChargee(this)" onerror="imageEvenementErreur(this)">'+
    '</span>';
}

function carteProposition(x){
  const l = x.l;
  const dist = jeSuisDansLaZoneRegardee() ? formatDist(distanceDepuisZone(l)) : "";
  const ville = (l.cp || l.adresse || "").trim();
  const lieuLigne = [ville, dist].filter(Boolean).join(" · ");
  const date = dateProposition(l);
  const c = categorieAffichee(l);
  /* L'image est celle de la source, sous licence. Sans image, un pictogramme
     de catégorie — jamais une photo d'illustration prise ailleurs. */
  const visuel = imageDe(l)
    ? visuelCarteEvenement(l, c, "pt")
    : '<span class="pt-img pt-img-vide pt-image-shell event-fallback-carte" aria-hidden="true">'+
      fallbackVisuelEvenement(l, c, "")+'</span>';
  const statut = x.groupe === "nouvelles_annonces"
    ? (x.nouveau
      ? '<b class="pt-neuf">NOUVELLE ANNONCE</b><span>'+esc(x.nouveau)+'</span>'
      : '<b class="pt-neuf">ANNONCE PUBLIÉE</b>')
    : '<b class="pt-neuf">À NE PAS MANQUER</b>';
  return '<article class="pt-carte'+(x.vu?" pt-vu":"")+'" data-pt="'+esc(l.id)+'"'+
    ' role="button" tabindex="0" aria-label="Ouvrir '+esc(l.titre)+'">'+
    visuel+
    '<div class="pt-txt">'+
      '<p class="pt-haut">'+
        statut+
      '</p>'+
      '<h3>'+esc(l.titre)+'</h3>'+
      (date ? '<p class="pt-date">'+esc(date)+'</p>' : '')+
      (lieuLigne ? '<p class="pt-lieu">'+esc(lieuLigne)+'</p>' : '')+
      '<p class="pt-pourquoi"><span aria-hidden="true">✨</span>'+
        'Pourquoi Autour te le montre</p>'+
      '<p class="pt-raison">'+esc(x.pourquoi.texte)+'</p>'+
      actionsProposition(l)+
    '</div>'+
  '</article>';
}

/* Le rang d'actions d'une proposition.

   LA RÉFÉRENCE MONTRE AUSSI « Me prévenir ». Il n'est pas là, et c'est
   délibéré : Autour n'a aujourd'hui aucun mécanisme de notification — ni
   permission demandée, ni service worker, ni file de rappels. Un bouton qui
   dirait « tu seras prévenu » promettrait quelque chose que rien ne tient, et
   c'est pire que son absence.

   Quand ce mécanisme existera, il s'ajoute ICI, sans toucher au reste de la
   carte : une entrée de plus dans ce rang, un état par événement à côté de
   `marquesVues` — même forme, même stockage —, et le bouton bascule cet état.
   La carte, elle, ne bouge pas. */
function actionsProposition(l){
  return '<p class="pt-actions">'+
    /* Même règle qu'en fiche : le lien n'existe que si une source vérifiée
       l'a réellement trouvé. Rien n'est affiché « au cas où ». */
    (l.ticket_url
      ? '<a class="pt-billet" href="'+esc(l.ticket_url)+'" target="_blank" rel="noopener">'+
        'Billetterie</a>' : '')+
    '<button class="pt-action" data-pt-save="'+esc(l.id)+'" aria-label="Enregistrer">'+
      (estFavori(l) ? "Enregistré" : "Enregistrer")+'</button>'+
    '<button class="pt-action" data-pt-share="'+esc(l.id)+'" aria-label="Partager">Partager</button>'+
    '<button class="pt-action pt-action-discret" data-pt-hide="'+esc(l.id)+'" aria-label="Masquer">Masquer</button>'+
    '<button class="pt-voir" data-pt-voir="'+esc(l.id)+'">Voir →</button>'+
  '</p>';
}

/* « Tes surveillances » : ce qui est coché, et la porte pour en changer. */
function blocSurveillances(){
  if(!ENVIES) return "";
  const suivies = ENVIES.details();
  return '<section class="pt-envies">'+
    '<div class="pt-envies-tete"><strong>Tes surveillances</strong>'+
      '<button id="ptGerer">Gérer</button></div>'+
    (suivies.length
      ? '<div class="pt-envies-liste">'+suivies.map(e=>
          '<span class="pt-envie"><em aria-hidden="true">'+e.emoji+'</em>'+
          esc(e.label)+'</span>').join("")+
          '<button class="pt-envie pt-envie-plus" id="ptPlus" aria-label="Ajouter une envie">+</button>'+
        '</div>'
      : '<p class="pt-envies-vide">Choisis ce que tu veux suivre : '+
        'Autour te préviendra quand quelque chose arrive.</p>')+
    (ENVIES.persistant() ? ''
      : '<p class="pt-envies-vide">Ton navigateur n’enregistre pas ces choix : '+
        'ils vaudront pour cette visite seulement.</p>')+
    '</section>';
}

function rendreGroupePourToi(label, identifiant, propositions){
  if(!propositions.length) return "";
  const visibles = propositions.slice(0, 2);
  const reste = propositions.slice(2);
  return '<section class="pt-groupe" data-testid="'+identifiant+'"><h3 class="pt-groupe-titre">'+esc(label)+'</h3>'
    + visibles.map(carteProposition).join("")
    + (reste.length
        ? '<div class="pt-groupe-suite" data-pt-suite="'+esc(identifiant)+'" hidden>'+reste.map(carteProposition).join("")+'</div>'
          + '<button class="pt-action pt-liste-plus" data-pt-expand="'+esc(identifiant)+'" aria-expanded="false">Voir les '+propositions.length+' \u2192</button>'
        : "")
    + '</section>';
}

/* Le registre de ce qui a DÉJÀ ÉTÉ ANNONCÉ, borné pour ne pas croître sans
   fin. Il ne se confond pas avec « vu » : on peut avoir été prévenu d'une
   annonce sans l'avoir lue. */
function marquesAnnoncees(){
  try{
    const v = JSON.parse(localStorage.getItem(CLE_POURTOI_ANNONCE) || "[]");
    return new Set(Array.isArray(v) ? v : []);
  }catch(e){ return new Set(); }
}

function ecrireMarquesAnnoncees(ids){
  try{
    localStorage.setItem(CLE_POURTOI_ANNONCE, JSON.stringify([...ids].slice(-POURTOI_MEMOIRE_MAX)));
  }catch(e){}
}

function ecrireConsultationPourToi(marque){
  try{ localStorage.setItem(CLE_POURTOI_CONSULTE, String(marque)); }catch(e){}
}

function retenirAnnoncees(propositions){
  const annoncees = marquesAnnoncees();
  let ajouts = 0;
  (propositions||[]).forEach((x)=>{
    const id = x && x.l ? x.l.id : null;
    if(id == null || annoncees.has(id)) return;
    annoncees.add(id);
    ajouts++;
  });
  if(ajouts) ecrireMarquesAnnoncees(annoncees);
  return ajouts;
}

function nouveautesPourToi(propositions){
  const annoncees = marquesAnnoncees();
  if(!annoncees.size && consultationCompte){
    /* Ce compte a déjà consulté « Pour toi » ailleurs : ce qui est là n'est
       pas neuf pour lui, seule la suite le sera. */
    retenirAnnoncees(propositions);
    return [];
  }
  return (propositions||[]).filter((x)=> x && x.l && x.l.id != null && !annoncees.has(x.l.id));
}

function noterConsultationPourToi(propositions){
  const ajouts = retenirAnnoncees(propositions);
  const premiere = !consultationCompte;
  const marque = Date.now();
  ecrireConsultationPourToi(marque);
  /* Le compte n'est touché que quand la consultation apprend quelque chose :
     repeindre un panneau déjà ouvert ne doit pas écrire à chaque
     rafraîchissement de données. */
  if(ajouts || premiere) ecrireConsultationCompte(marque);
}

function peindrePastillePourToi(nombre){
  const compte = Math.max(0, Number(nombre) || 0);
  const pastille = $("#notifPastille");
  if(pastille){
    pastille.hidden = !compte;
    pastille.textContent = compte ? (compte > POURTOI_PASTILLE_MAX ? POURTOI_PASTILLE_MAX + "+" : "+" + compte) : "";
  }
  const cloche = $("#btnNotifs");
  if(cloche) cloche.setAttribute("aria-label", compte ? "Pour toi, " + compte + " nouveauté" + (compte > 1 ? "s" : "") : "Pour toi");
}

function majPastillePourToi(){
  peindrePastillePourToi(nouveautesPourToi(propositionsPourToi(POURTOI_TOUT_MAX)).length);
}

function majPourToi(){
  const panneau = $("#pourToi");
  const corps = $("#ptCorps");
  if(!panneau || !corps) return;
  const debutCpu = performance.now();
  const propositions = propositionsPourToi(POURTOI_TOUT_MAX);
  const suivies = ENVIES ? ENVIES.choisies().length : 0;

  let contenu;
  if(!suivies){
    /* Aucune envie cochée : le panneau ne se remplit pas de « suggestions »
       génériques, il explique à quoi il sert. */
    contenu = '<p class="pt-vide">Rien à suivre pour l’instant. '+
      'Dis à Autour ce qui t’intéresse et il te préviendra quand ça arrive.</p>';
  }else if(!propositions.length){
    contenu = '<p class="pt-vide">Rien de neuf dans cette zone pour ce que tu suis. '+
      'Autour continue de regarder.</p>';
  }else{
    /* Groupé par envie, et non en liste plate : « Rap · 4 » dit pourquoi
       chaque carte est là. Deux cartes visibles par groupe, le reste derrière
       un bouton — le panneau reste lisible quand la métropole donne beaucoup. */
    contenu = groupesInteretsPourToi(propositions).map((groupe)=> rendreGroupePourToi(
      groupe.label + " · " + groupe.propositions.length,
      "pourtoi-interet-" + groupe.id,
      groupe.propositions
    )).join("");
    if(!contenu) contenu = '<p class="pt-vide">Rien de neuf dans cette zone pour ce que tu suis. '+
      'Autour continue de regarder.</p>';
  }
  /* Les surveillances restent EN HAUT : c'est ce que la personne a demandé
     explicitement de suivre, ça passe avant ce qu'Autour propose. */
  corps.innerHTML = blocSurveillances() + contenu;

  const nonVues = propositions.filter(x=>!x.vu && x.groupe === "nouvelles_annonces").length;
  const toutVu = $("#ptToutVu");
  if(toutVu) toutVu.hidden = !nonVues;
  /* Ouvert, le panneau expose les nouveautés : on les note comme annoncées et
     la pastille retombe. Fermé, elle compte ce qui n'a jamais été exposé. */
  if(pourToiOuvert()){
    noterConsultationPourToi(propositions);
    peindrePastillePourToi(0);
  }else{
    peindrePastillePourToi(nouveautesPourToi(propositions).length);
  }
  brancherPourToi(propositions);
  PERF.travail("pour_toi", debutCpu);
}

function brancherPourToi(propositions){
  const corps = $("#ptCorps");
  if(!corps) return;
  const ouvrirDetailPourToi = (id)=>{
    marquerVu([id]);
    if(!NAV_FLOTTANTE.matches) fermerPourToi();
    pileEcrans = [];
    pousserEcran(()=>ouvrirDetail(id));
  };
  /* Un clic standard est volontaire ici : il couvre souris, pointer et tap
     Safari sans ajouter un `pointerup` concurrent qui ouvrirait la fiche deux
     fois sur les navigateurs mobiles. Les contrôles internes sortent avant la
     porte de la carte et gardent leur propre action. */
  corps.querySelectorAll("[data-pt]").forEach((carte)=>{
    carte.onclick = (event)=>{
      const cible = event.target;
      if(cible && cible.closest && cible.closest("a,button")) return;
      ouvrirDetailPourToi(carte.dataset.pt);
    };
    carte.onkeydown = (event)=>{
      const cible = event.target;
      if(cible && cible.closest && cible.closest("a,button")) return;
      if(event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      ouvrirDetailPourToi(carte.dataset.pt);
    };
  });
  corps.querySelectorAll(".pt-billet").forEach((lien)=>lien.onclick=(event)=>{
    event.stopPropagation();
  });
  corps.querySelectorAll("[data-pt-voir]").forEach((b)=>b.onclick=(event)=>{
    event.stopPropagation();
    ouvrirDetailPourToi(b.dataset.ptVoir);
  });
  corps.querySelectorAll("[data-pt-expand]").forEach((b)=>{
    b.onclick = (event)=>{
      event.stopPropagation();
      const groupe = b.closest(".pt-groupe");
      const suite = groupe ? groupe.querySelector("[data-pt-suite]") : null;
      if(!suite) return;
      suite.hidden = false;
      b.hidden = true;
      b.setAttribute("aria-expanded", "true");
    };
  });
  corps.querySelectorAll("[data-pt-save]").forEach((b)=>{
    b.onclick = async (event)=>{
      event.stopPropagation();
      const item = propositions.find((x)=>String(x.l.id) === String(b.dataset.ptSave));
      if(!item) return;
      await basculerFavori(item.l);
      b.textContent = estFavori(item.l) ? "Enregistré" : "Enregistrer";
    };
  });
  corps.querySelectorAll("[data-pt-share]").forEach((b)=>{
    b.onclick = async (event)=>{
      event.stopPropagation();
      const item = propositions.find((x)=>String(x.l.id) === String(b.dataset.ptShare));
      if(item) await partagerLieu(item.l);
    };
  });
  corps.querySelectorAll("[data-pt-hide]").forEach((b)=>{
    b.onclick = (event)=>{
      event.stopPropagation();
      masquerPourToi(b.dataset.ptHide);
      majPourToi();
      toast("Annonce masquée");
    };
  });
  const gerer = ()=>ouvrirEnvies();
  if($("#ptGerer")) $("#ptGerer").onclick = gerer;
  if($("#ptPlus")) $("#ptPlus").onclick = gerer;
  const toutVu = $("#ptToutVu");
  if(toutVu) toutVu.onclick = ()=>{
    marquerVu(propositions.map(x=>x.l.id));
    majPourToi();
  };
}

function marquerVu(ids){
  const vues = marquesVues();
  ids.forEach(id=>vues.add(id));
  ecrireMarquesVues(vues);
}

/* ---- L'écran « Gérer ses envies » ---------------------------------------
   Une liste à cocher, rien de plus. Chaque geste est enregistré tout de
   suite : il n'y a pas de « valider » à oublier. */
function ouvrirEnvies(){
  if(!ENVIES) return;
  if(!NAV_FLOTTANTE.matches) fermerPourToi();
  pileEcrans = [];
  pousserEcran(()=>{
    ouvrirFeuille(
      '<h2 class="titre">Tes envies</h2>'+
      '<p class="env-intro">Ce que tu coches sert à classer « Pour toi » et, '+
        'plus tard, à te prévenir. Rien d’autre n’est déduit de ton usage.</p>'+
      '<div class="env-liste" id="envListe"></div>',
      {ariaLabel:"Choisir tes envies"});
    peindreEnvies();
  });
}

function peindreEnvies(){
  const zone = $("#envListe");
  if(!zone || !ENVIES) return;
  zone.innerHTML = ENVIES.CATALOGUE.map(e=>{
    const on = ENVIES.suivie(e.id);
    return '<button type="button" class="env-b'+(on?" actif":"")+'" '+
      'data-env="'+esc(e.id)+'" aria-pressed="'+on+'">'+
      '<em aria-hidden="true">'+e.emoji+'</em><b>'+esc(e.label)+'</b>'+
      '<span class="env-etat" aria-hidden="true">'+(on?"✓":"+")+'</span></button>';
  }).join("");
  zone.querySelectorAll("[data-env]").forEach(b=>b.onclick=()=>{
    ENVIES.basculer(b.dataset.env);
    peindreEnvies();
    majPourToi();
  });
}

/* ---- Ouvrir et fermer le panneau ---------------------------------------- */
function ouvrirPourToi(){
  const p = $("#pourToi");
  if(!p) return;
  p.hidden = false;
  document.body.classList.add("pourtoi-ouvert");
  majPourToi();
}

function fermerPourToi(){
  const p = $("#pourToi");
  if(!p) return;
  document.body.classList.remove("pourtoi-ouvert");
  /* Sur grand écran le panneau fait partie du décor : il reste en place. */
  if(!NAV_FLOTTANTE.matches) p.hidden = true;
}

/* Le panneau est-il visible ? La question a deux réponses selon l'écran — sur
   mobile c'est `hidden`, sur bureau c'est la classe du body qui commande le
   `display:none` de la colonne — et les trois sorties (✕, dehors, Escape) ont
   besoin de la MÊME réponse. L'écrire une fois est ce qui garantit qu'elles ne
   divergeront pas. */
function pourToiOuvert(){
  const p = $("#pourToi");
  if(!p) return false;
  return NAV_FLOTTANTE.matches
    ? document.body.classList.contains("pourtoi-ouvert")
    : !p.hidden;
}

function basculerPourToi(){
  if(!$("#pourToi")) return;
  if(pourToiOuvert()) return fermerPourToi();
  ouvrirPourToi();
}

/* ---- Les quatre envies rapides, ici ou là ------------------------------- */
/* Un seul jeu de boutons. Sur grand écran il vit dans la barre du haut, sur
   mobile dans le panneau : jamais aux deux endroits, sinon un même geste
   existerait deux fois pour un lecteur d'écran. */
function poserBesoinsRapides(){
  const hote = $("#barreEnvies");
  if(!hote) return;
  const enTete = NAV_FLOTTANTE.matches;
  hote.hidden = !enTete;
  hote.innerHTML = enTete ? besoinsRapidesHTML() : "";
  if(enTete) brancherBesoinsRapides(hote);
}

/* ==================================================================== */
/*  Le classement de l'accueil, différé et annulable                    */
/* ==================================================================== */
/* `generationAccueil` fait office de jeton : chaque rendu l'incrémente, et un
   travail différé ne s'exécute que s'il porte encore le dernier. Sans lui,
   changer de zone pendant un classement laissait ce classement aboutir et
   écraser l'écran avec les lieux de la ville qu'on venait de quitter. */
let generationAccueil = 0;
let annulerRecoDifferee = null;
let annulerPourToiDifferee = null;
let recoCache = null;             // {cle, html}

/* La clé décrit TOUT ce dont le classement dépend. Deux rendus qui partagent
   cette clé partagent forcément leur résultat — c'est ce qui évite de
   reclasser treize fois pendant un démarrage, et c'est aussi ce qui garantit
   qu'on ne sert jamais un classement périmé. */
function cleReco(){
  const r = pointDeReference();
  return [lieux.length, creneau, filtreActif, triListe,
          montrerFermes ? 1 : 0,
          catsActives ? [...catsActives].sort().join("+") : "",
          filtresHumains ? [...filtresHumains].sort().join("+") : "",
          r ? r[0].toFixed(3)+","+r[1].toFixed(3) : "?"].join("|");
}

/* Ce qu'on peut poser TOUT DE SUITE.

   Trois réponses, dans cet ordre :

     1. le classement déjà calculé, s'il vaut encore pour cet état exact ;
     2. À DÉFAUT, LE DERNIER CLASSEMENT RENDU POUR CETTE MÊME ZONE. C'est le
        point du §7 : une source lente qui répond fait changer la clé, et
        l'ancienne version rendait alors des squelettes — la liste
        DISPARAISSAIT pour réapparaître une fraction de seconde plus tard,
        exactement l'impression de gel qu'on cherche à supprimer. Les cartes
        précédentes sont encore vraies : elles restent en place jusqu'à ce
        que les nouvelles soient prêtes, et le remplacement est alors
        silencieux, sans trou ni saut ;
     3. et seulement si on n'a jamais rien montré ici, le squelette.

   Ce report ne franchit jamais une frontière de zone : `definirZoneActive`
   efface cette mémoire en même temps que le cache, parce que les cartes d'une
   ville qu'on vient de quitter seraient, elles, fausses. */
let dernierRecoRendu = null;      // {portee, html}

function recoDejaCalculee(){
  if(recoCache && recoCache.cle === cleReco()) return recoCache.html;
  if(dernierRecoRendu && dernierRecoRendu.portee === porteeCourante && dernierRecoRendu.html)
    return dernierRecoRendu.html;
  return statutGroupeHTML();
}

/* Le classement lui-même, exécuté pendant une tranche d'inactivité. Il ne
   touche QUE la zone des recommandations : rien au-dessus ne bouge, et
   surtout pas le bloc « Maintenant » ni la navigation. */
function poserRecommandations(jeton, titre){
  const debutCpu = performance.now();
  try{
  if(jeton !== generationAccueil) return;      // la zone a changé entre-temps
  const corps = $("#fbCorps");
  const zone = corps && corps.querySelector("[data-reco-zone]");
  if(!zone) return;

  const enCours = (creneau === "maintenant" && !modeAide) ? evenementsMaintenant() : [];
  let reco = recommandationsAccueil(7);
  // un événement déjà listé dans « Maintenant » ne se répète pas ici
  if(enCours.length){
    const dejaListes = new Set(enCours.slice(0, MAINTENANT_APERCU).map(l=>l.id));
    reco = reco.filter(l=>!dejaListes.has(l.id));
  }
  /* le classement peut ne rien rendre au tout début (aucun ETA, aucun
     horaire) : on montre alors l'échantillon varié du cache plutôt qu'un
     écran vide */
  if(!reco.length && creneau === "maintenant") reco = echantillonImmediat(lieux.filter(nomExploitable));
  if(reco.length) PERF.jalon("cached_pois_visible");

  /* Des cartes, sinon l'indicateur discret par-dessus ce qui est déjà là.
     Un classement qui ne rend rien PENDANT qu'une source charge n'est pas un
     vide à annoncer : c'est un travail en cours, et ce qu'on affichait
     jusque-là reste vrai. On ne remplace donc jamais des cartes existantes
     par un état — seulement par de meilleures cartes. */
  const html = reco.length
    ? '<div class="rc-piste rc-colonne" data-testid="primary-results">'+
        reco.map(carteRecommandation).join("")+'</div>'+
        indicateurRechercheHTML(reco.length)
    : (dernierRecoRendu && dernierRecoRendu.portee === porteeCourante && dernierRecoRendu.html
        && rechercheEnCours()
        ? dernierRecoRendu.html
        : statutGroupeHTML());

  /* Une dernière vérification APRÈS le calcul : classer cent trente lieux
     prend des centaines de millisecondes, et la carte a pu bouger pendant ce
     temps. Poser un résultat périmé est exactement ce qu'on cherche à éviter. */
  if(jeton !== generationAccueil) return;
  recoCache = {cle:cleReco(), html};
  if(reco.length) dernierRecoRendu = {portee:porteeCourante, html};
  zone.innerHTML = html;
  /* Les gestes de ces cartes n'existaient pas quand la feuille a été branchée :
     on les rebranche sur la zone qu'on vient de remplir, et sur elle seule. */
  brancherGestesRecommandations(zone);
  PERF.jalon("recommandations_posees");
  /* HORS DU CHEMIN CRITIQUE, ET APRÈS LA PEINTURE.

     Les cartes sont posées, l'écran est utile. C'est seulement maintenant
     qu'on va voir s'il manque quelque chose aux meilleurs candidats — et ce
     qui reviendra ne remplacera rien : ça complétera, ou ça n'arrivera pas.
     `enrichirCandidats` existait déjà pour Google et n'était appelée nulle
     part ; elle l'est enfin, et elle porte maintenant les deux sources. */
  if(ORDO) ORDO.differer(()=>enrichirCandidats(pourToi, intentionCourante,
      ()=>{ if(jeton === generationAccueil) planifierRendu({accueil:true, feuille:true}); }),
    {timeout:1500, valide:()=>jeton === generationAccueil});
  } finally {
    PERF.travail("recommandations", debutCpu);
  }
}

const MAINTENANT_APERCU = (window.AutourMaintenant || {}).PLACES || 3;
/* Trois dans le bloc, dix derrière « Voir tout ». Ce n'est pas une limite
   technique : c'est ce qui distingue une sélection d'un annuaire. */
const MAINTENANT_TOUT = 10;

/* Ce que `maintenant.js` a besoin de savoir d'un lieu, et rien de plus. Le
   statut vient du moteur temporel, qui le tient du backend : on ne le
   recalcule pas ici, on le transmet. */
/* LE TEMPS D'Y ALLER — NOMINAL, ET C'EST VOLONTAIRE.

   Sert à demander à `availability.js` si le lieu sera ENCORE ouvert à
   l'arrivée, pas seulement s'il l'est maintenant.

   Une première version le déduisait de la distance exacte. Ça paraissait plus
   juste, et ça coûtait cher : la réponse dépendait alors du point de
   référence, donc changeait à chaque image PENDANT que la carte vole vers sa
   destination. La mémoire ne retenait plus rien, et l'analyse des horaires de
   cent trente lieux repartait de zéro à chaque rendu — 539 ms mesurées, six
   fois de suite.

   Dix minutes nominales suffisent, et disent la même chose : c'est la marge
   PAR TYPE de lieu qui fait le vrai travail (arriver au musée trois minutes
   avant la fermeture n'est pas une visite ; `availability.js` le sait déjà).
   Le résultat ne dépend plus que du lieu et de l'heure — donc il se retient. */
const APPROCHE_NOMINALE_MS = 10 * 60000;
function arriveeEstimee(t){ return t + APPROCHE_NOMINALE_MS; }

function versItemMaintenant(l, t){
  /* Le verdict temporel est TRANSMIS, jamais recopié sous forme de chaîne :
     c'est `temporel.js` qui connaît le vocabulaire du backend, et lui seul. */
  const statut = statutTemps(l, t).statut;
  const evenement = estTemporaire(l);
  const canonique = evenement ? donneesEvenement(l) : null;
  const epoch = (value) => {
    if(value == null || value === "") return null;
    const parsed = typeof value === "number" ? value : new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  };
  const debutLe = canonique ? epoch(canonique.start_at) : l.debutLe;
  const finLe = canonique ? epoch(canonique.end_at) : l.finLe;

  /* Pour un LIEU, c'est `availability.js` qui fait autorité — et lui seul.
     Il distingue quatre états là où un booléen n'en distingue que deux :
     « ouvert », « fermé », « fermé définitivement » et « horaires inconnus ».
     Confondre le dernier avec le premier envoie quelqu'un devant une porte
     close ; le confondre avec le deuxième vide le bloc pour rien. */
  let ouvert = null, ouvertALArrivee = null;
  if(!evenement){
    const dispo = dispoDe(l, arriveeEstimee(t), t);
    if(dispo){
      ouvert = dispo.status === "open" ? true
             : dispo.status === "unknown" ? null : false;
      ouvertALArrivee = dispo.isOpenAtArrival;
    }
  }

  return {
    id:l.id, estEvenement:evenement, annule:!!l.annule,
    enCours: TEMPS.estMaintenant(statut),
    dateIncertaine: statut === "unknown",
    start_at:canonique ? canonique.start_at : null,
    end_at:canonique ? canonique.end_at : null,
    debutLe, finLe, lat:l.lat, lng:l.lng,
    ferme:estFerme(l),
    categorie:l.cat, ouvert, ouvertALArrivee,
    /* Le calque vérifié, transmis tel quel. Le moteur en fait ce qu'il veut —
       exclure une fermeture confirmée, remonter une programmation en cours —
       et c'est lui seul qui décide : ce fichier ne fait que porter. */
    current_status:l.current_status || null,
    temporary_closed:l.temporary_closed == null ? null : l.temporary_closed,
    programme_now:Array.isArray(l.programme_now) ? l.programme_now : null,
  };
}

/* ==================================================================== */
/*  « AUTOUR » DE QUOI ?                                                 */
/* ==================================================================== */
/* IL Y AVAIT TROIS RÉPONSES, ET C'EST CE QUI A CASSÉ.

   Autour connaît trois points : là où vous ÊTES (`positionMoi`), la ville que
   vous avez DEMANDÉE (`rechercheGeo`), et ce que la carte MONTRE
   (`map.getCenter()`). Chaque partie du code en choisissait un :

     · le chargement des données   → le centre de la carte  (juste)
     · le classement des lieux     → positionMoi            (faux ailleurs)
     · les distances affichées     → positionMoi            (faux ailleurs)
     · le filtre de « Maintenant » → positionMoi            (FAUX, et fatal)

   Les trois premiers se contentaient de mal classer. Le quatrième EXCLUAIT :
   taper « Paris » depuis Lille chargeait bien les concerts parisiens en cours,
   puis les refusait tous à 220 km — et le bloc affichait « rien en cours près
   de toi » au-dessus d'une carte pleine d'événements en cours.

   Il n'y a donc plus qu'une réponse : le point qu'on REGARDE. Chez soi, la
   carte est centrée sur soi et les deux coïncident ; ailleurs, c'est la ville
   qu'on regarde qui commande. */
function pointDeReference(){
  /* Une destination est un contexte explicite : même pendant l'animation de
     la carte, les scores, distances et surfaces parlent déjà de cette ville.
     Pour le mode GPS, on conserve la liberté d'explorer la vue courante. */
  if(destinationActive()) return centreZoneActive();
  const c = centreCarte();
  return (Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    ? c : positionMoi;
}

/* Suis-je À l'endroit que je regarde ? Au-delà, « à 300 m » ne veut plus rien
   dire : ces 300 mètres partent d'un point où je ne suis pas. On cesse alors
   d'afficher une distance plutôt que d'en afficher une fausse. */
const SEUIL_MEME_ZONE_M = 30000;
function jeSuisDansLaZoneRegardee(){
  if(destinationActive()) return !!centreZoneActive();
  if(!positionPrecise() || !positionMoi) return false;
  const r = pointDeReference();
  if(!Array.isArray(r)) return false;
  return distanceM(positionMoi[0], positionMoi[1], r[0], r[1]) <= SEUIL_MEME_ZONE_M;
}

/* Le contexte de la sélection, lu une seule fois par rendu. Deux endroits qui
   décident séparément « est-ce qu'on cherche encore ? » finissent toujours par
   ne plus être d'accord, et c'est l'écran qui clignote. */
/* JUSQU'OÙ « AUTOUR » VA-T-IL ?

   Un rayon fixe de trois kilomètres a une deuxième façon de se tromper, plus
   discrète que la première : `allerVers` décale volontairement le centre de la
   carte pour que le point visé ne soit pas caché par la feuille du bas. Sur
   une ville affichée au zoom 13, ce décalage vaut sept kilomètres — et les
   événements parfaitement visibles à l'écran tombaient hors du rayon.

   « Autour » suit donc ce qu'on VOIT. Ce qui tient dans la carte affichée est
   autour ; trois kilomètres restent le plancher, pour qu'un zoom serré ne
   réduise pas la sélection au pâté de maisons. */
function rayonRegarde(){
  const socle = (window.AutourMaintenant || {}).RAYON_MAX_M || 3000;
  if(!map || !map.getBounds) return socle;
  try{
    const b = map.getBounds(), c = b.getCenter();
    const demiDiagonale = distanceM(c.lat, c.lng, b.getNorth(), b.getEast());
    return Math.max(socle, demiDiagonale);
  }catch(e){ return socle; }
}

function contexteMaintenant(){
  const ref = pointDeReference();
  return {
    rayonMax: rayonRegarde(),
    maintenant: Date.now(),
    position: Array.isArray(ref) && Number.isFinite(ref[0]) ? ref : null,
    /* Choisir une ville, c'est dire soi-même où l'on regarde : on sait donc
       parfaitement de quoi on parle, même sans la moindre mesure GPS. */
    positionConnue: positionConnue() || !!rechercheGeo,
    positionEnCours: rechercheEtat.location === SEARCH_STATES.REQUESTING_LOCATION
      && !rechercheGeo,
    positionRefusee: rechercheEtat.location === SEARCH_STATES.LOCATION_DENIED
      && !rechercheGeo,
    chargement: rechercheEnCours(),
    panne: panneTechnique(),
    /* CE QUE LA PERSONNE A EXPLICITEMENT DEMANDÉ.

       « Maintenant » écarte les commodités — supermarché, pharmacie, métro —
       parce qu'une sélection de trois places ne doit pas se remplir de
       l'annuaire des commerces ouverts. Mais « pharmacie ouverte maintenant »
       est une demande, pas une suggestion : ce qui a été nommé revient.

       Rien n'est deviné ici : on ne transmet que des catégories choisies dans
       l'interface ou comprises dans une phrase tapée. */
    categoriesDemandees: categoriesDemandees(),
  };
}

/* Les catégories que la personne a nommées, par un filtre, une pastille de
   catégorie ou une phrase que `comprendre.js` a interprétée. */
function categoriesDemandees(){
  const dites = new Set();
  if(catsActives) catsActives.forEach(c=>dites.add(c));
  if(filtreActif && filtreActif !== "tout") dites.add(filtreActif);
  const q = intentionCourante && intentionCourante.chips;
  if(q) q.forEach(c=>{ if(c && c.type === "cat" && c.id) dites.add(String(c.id).split(":")[1]); });
  return [...dites];
}

/* La sélection elle-même : au plus trois, jamais complétée artificiellement. */
/* CE QUE COÛTE CETTE FONCTION, ET POURQUOI ELLE SE SOUVIENT.

   `dispoDe` analyse une chaîne `opening_hours` — un petit langage à part
   entière — pour CHAQUE lieu. Sur un centre-ville dense, cent vingt lieux.
   `selectionMaintenant` et `totalMaintenant` l'appelaient chacune de leur
   côté, à chaque rendu : deux cent quarante analyses par image, et le banc a
   mesuré près de six secondes avant la première proposition.

   Une minute de mémoire suffit à tout régler. Un horaire d'ouverture ne change
   pas d'une image à l'autre ; il ne change même pas d'une minute à l'autre. La
   clé porte donc la minute, le nombre de lieux et le point de référence — les
   trois seules choses dont le résultat dépend. */
let itemsMemo = {cle:null, items:null};

/* LA MÉMOIRE PAR LIEU, ET POURQUOI ELLE COMPTE PLUS QUE L'AUTRE.

   Le profil a mesuré 530 ms pour un seul passage sur cent trente lieux, et
   trois passages pendant un démarrage — une fusion en invalide un. Or entre
   deux fusions, cent vingt-cinq des cent trente lieux sont EXACTEMENT les
   mêmes : on repayait l'analyse de leurs horaires pour rien.

   La mémoire par lieu porte donc sur (identifiant, minute, point de
   référence) : les trois seules choses dont le résultat dépend. Un lieu déjà
   vu ne coûte plus rien ; seuls les nouveaux sont analysés. Le résultat est
   identique au millième près — c'est la même fonction, appelée une fois au
   lieu de trois. */
const dispoMemo = new Map();
const DISPO_MEMO_MAX = 600;      // au-delà, on repart : ce n'est qu'un cache

function itemMemoise(l, t, minute){
  const cle = l.id + "|" + minute;
  const vu = dispoMemo.get(cle);
  if(vu) return vu;
  const item = versItemMaintenant(l, t);
  if(dispoMemo.size > DISPO_MEMO_MAX) dispoMemo.clear();
  dispoMemo.set(cle, item);
  return item;
}

function itemsMaintenant(ctx){
  const minute = Math.floor(ctx.maintenant / 60000);
  /* La zone entre dans la clé, et les lieux d'ailleurs n'entrent pas dans la
     liste. Sans le premier, revenir à Tourcoing servait la mémoire de Lille ;
     sans le second, « Maintenant » à Lille proposait un café de Tourcoing
     encore présent en mémoire. */
  const source = lieux.filter(dansZoneActive);
  const cle = idZoneActive() + "|" + minute + "|" + source.length;
  if(itemsMemo.cle === cle) return itemsMemo.items;
  const items = source.map(l=>itemMemoise(l, ctx.maintenant, minute));
  itemsMemo = {cle, items};
  return items;
}

/* Le nombre de lieux ne change pas toujours quand leur CONTENU change — une
   fusion peut remplacer un lieu par une meilleure version sans en changer le
   compte. On oublie donc la LISTE à chaque fusion. La mémoire par lieu, elle,
   survit : elle est indexée par identifiant, et un lieu remplacé porte un
   identifiant qu'on n'a pas encore vu. */
function oublierItemsMaintenant(){ itemsMemo = {cle:null, items:null}; }

function selectionMaintenant(){
  const M = window.AutourMaintenant;
  if(!M) return [];
  const ctx = contexteMaintenant();
  const retenus = M.selection(itemsMaintenant(ctx), ctx);
  const parId = new Map(lieux.map(l=>[l.id, l]));
  /* La nature (`event_now`, `open_now`…) voyage avec le lieu : c'est elle qui
     dira à l'affichage s'il faut écrire « jusqu'à 23 h » ou « séance à 20 h ». */
  return retenus.map(i=>{
    const l = parId.get(i.id);
    return l ? Object.assign({}, l, {nature:i.nature}) : null;
  }).filter(Boolean);
}

function totalMaintenant(){
  const M = window.AutourMaintenant;
  if(!M) return 0;
  const ctx = contexteMaintenant();
  return M.total(itemsMaintenant(ctx), ctx);
}

/* ==================================================================== */
/*  Le bloc « Maintenant » — LA PLACE EST RÉSERVÉE, TOUJOURS            */
/* ==================================================================== */
/* CE QUI CASSAIT.

   Cette fonction rendait une chaîne vide tant qu'il n'y avait rien à montrer.
   La géolocalisation prend une seconde, les événements une autre : pendant ce
   temps la section n'existait pas, et les boutons du dessous occupaient sa
   place. Quand les données arrivaient, le bloc s'insérait et poussait tout
   vers le bas — sous le doigt de quelqu'un qui était en train d'appuyer.

   La section est désormais rendue DANS LES QUATRE ÉTATS, avec la même hauteur
   réservée (`--mn-hauteur`, trois lignes plus l'en-tête). Ce qui change à
   l'intérieur, c'est le contenu ; jamais l'encombrement.

   Et pendant la collecte, on montre un état léger et neutre — pas un message,
   pas une explication : rien qui demande à être lu et qui disparaîtra. */
/* CE QUE « MAINTENANT » NE DIT PAS DE LUI-MÊME.

   Le bloc est volontairement minuscule — trois lignes — et c'est un choix de
   produit qu'on ne touche pas. Mais un choix de produit et une couverture
   incomplète se ressemblent à l'écran : deux propositions au-dessus d'une
   ville entière, ça peut vouloir dire « voici la sélection » ou « nos sources
   ne savent presque rien d'ici », et rien ne permettait de distinguer les
   deux. Quelqu'un en conclut qu'il ne se passe rien dans sa ville.

   Une ligne, discrète, uniquement quand la sélection est maigre ET qu'une
   source manque encore à l'appel. Elle ne s'excuse pas et ne meuble pas : elle
   dit ce qui est vrai — la recherche continue, ou une source n'a pas répondu.
   Dès que trois propositions tiennent debout, elle disparaît : la sélection
   parle alors d'elle-même. */
function aveuCouvertureMaintenant(combienAffiches){
  if(combienAffiches >= MAINTENANT_APERCU) return "";
  const cherche = rechercheEnCours();
  const panne = panneTechnique();
  if(!cherche && !panne) return "";
  return '<p class="mn-couverture" role="status">'+
    (cherche ? 'Autour cherche encore : d’autres propositions peuvent arriver.'
             : 'Une source n’a pas répondu — il se passe peut-être plus de choses qu’ici.')+
    '</p>';
}

/* ---- « ✨ NOUVEAU POUR TOI » -------------------------------------------

   LA MÊME CHOSE QUE « POUR TOI », VUE D'AILLEURS.

   Ce bloc ne calcule rien et ne connaît aucune donnée que le panneau de
   droite n'ait déjà : il prend la PREMIÈRE proposition non lue de
   `propositionsPourToi()` et la dessine autrement. Une seconde source de
   vérité voudrait dire deux classements à garder d'accord, et un jour deux
   réponses différentes à la même question.

   Il disparaît complètement quand il n'y a rien à annoncer. « Nouveau » veut
   dire nouveau : une proposition non lue MAIS déjà connue depuis une semaine
   n'est pas une nouvelle, c'est le programme — elle reste à droite, elle
   n'ouvre pas le panneau de gauche. */
function nouveauPourToi(){
  const propositions = propositionsPourToi();
  return propositions.find(x=>!x.vu && x.nouveau) || null;
}

function blocNouveauPourToi(){
  if(creneau !== "maintenant" || modeAide) return "";
  const x = nouveauPourToi();
  if(!x) return "";
  const l = x.l;
  const c = categorieAffichee(l);
  const visuel = imageDe(l)
    ? visuelCarteEvenement(l, c, "npt")
    : '<span class="npt-img npt-img-vide npt-image-shell event-fallback-carte" aria-hidden="true">'+
      fallbackVisuelEvenement(l, c, "")+'</span>';
  /* Date et lieu, tels quels : sans date exploitable la ligne disparaît
     plutôt que d'écrire une approximation. */
  const bas = [dateProposition(l), (l.cp || l.adresse || "").trim()]
    .filter(Boolean).join(" · ");
  return '<section class="npt" data-testid="nouveau-pour-toi">'+
    '<p class="npt-tete"><em aria-hidden="true">✨</em>NOUVEAU POUR TOI</p>'+
    '<button class="npt-l" data-npt="'+esc(l.id)+'">'+
      visuel+
      '<span class="npt-txt"><b>'+esc(l.titre)+'</b>'+
        (bas ? '<i>'+esc(bas)+'</i>' : '')+'</span>'+
      '<span class="npt-fl" aria-hidden="true">›</span>'+
    '</button></section>';
}

function blocMaintenantAccueil(){
  if(creneau !== "maintenant" || modeAide) return "";
  const M = window.AutourMaintenant;
  if(!M) return "";

  const liste = selectionMaintenant();
  const combien = totalMaintenant();
  const ctx = contexteMaintenant();
  const etat = M.etat(Object.assign({resultats:liste.length}, ctx));

  /* CE QU'ON MESURE, ET POURQUOI CES DEUX INSTANTS-LÀ.

     « Autour est lent » ne se corrige pas : ça ne désigne rien. Les deux
     instants qui comptent pour quelqu'un qui ouvre l'application sont le
     PREMIER contenu utile — la première chose faisable qu'il voit — et le
     moment où le bloc est complet. Entre les deux, l'écran est déjà utile :
     c'est exactement ce qu'on veut, et c'est ce qu'il faut pouvoir prouver. */
  if(liste.length >= 1) PERF.jalon("maintenant_premier");
  if(liste.length >= MAINTENANT_APERCU) PERF.jalon("maintenant_complet");
  const mots = M.textes(etat, ctx);

  /* LE COMPTEUR DOIT DONNER UNE IMPRESSION DE SÉLECTION, PAS D'ANNUAIRE.

     « Maintenant (189) » au-dessus de trois lignes se lit comme un catalogue
     dont on ne montrerait qu'un fragment — et il donne envie de chercher les
     186 autres, qui n'existent pas en tant que propositions. Ce que Autour
     propose réellement est plafonné à dix ; le compteur ne dépasse donc pas ce
     qu'on peut effectivement ouvrir. Au-delà, il le dit autrement : « 10+ »
     annonce l'abondance sans promettre une liste. */
  const proposables = PLAF ? Math.min(combien, PLAF.limiteMaintenant()) : combien;
  const affiche = PLAF && combien > PLAF.limiteMaintenant()
    ? PLAF.limiteMaintenant()+"+" : String(proposables);
  const tete = '<p class="mn-tete"><em aria-hidden="true">⚡</em><b>Maintenant</b>'+
    (etat === M.ETATS.READY && combien ? '<span>('+affiche+')</span>' : '')+'</p>';

  let corps;
  if(etat === M.ETATS.READY){
    /* « Voir tout » ne promet que ce qu'il ouvrira réellement : la liste
       dépliée est plafonnée à dix, annoncer le total en promettrait davantage. */
    const derriere = Math.min(combien, MAINTENANT_TOUT);
    corps = liste.map(ligneMaintenant).join("")+
      (derriere > liste.length
        ? '<button class="mn-tout" data-mn-tout="1">Voir tout ('+derriere+')</button>'
        : '')+
      aveuCouvertureMaintenant(liste.length);
  }else if(etat === M.ETATS.LOADING){
    /* Trois barres grises, sans texte. Elles occupent exactement la place des
       trois lignes à venir : quand les vraies arrivent, rien ne bouge. */
    corps = '<div class="mn-attente" aria-hidden="true">'+
      '<i></i><i></i><i></i></div>';
  }else{
    corps = '<div class="mn-rien" role="status">'+
      '<p>'+esc(mots.ligne)+'</p>'+
      (mots.sortie
        ? '<button class="mn-sortie" data-mn-sortie="'+esc(etat)+'">'+
            esc(mots.sortie)+'</button>'
        : '')+
      '</div>';
  }

  /* Combien de propositions le mode a réellement servies. C'est un nombre,
     pas un contenu : aucune trace de ce qui a été proposé à qui. */
  if(modeTerritorial && etat === M.ETATS.READY)
    compterTerritorial("territorial_results_count", liste.length);

  /* L'en-tête du contexte AVANT, les services APRÈS. Le bloc « Maintenant »
     lui-même ne change pas d'une ligne : c'est le même moteur, la même
     sélection, les mêmes trois places. Ce qui l'entoure dit seulement dans
     quel contexte on le lit. */
  return (modeTerritorial ? enTeteTerritoriale() : "")+
    '<section class="mn" data-testid="maintenant-liste" '+
    'data-mn-etat="'+esc(etat)+'" aria-busy="'+(etat === M.ETATS.LOADING)+'">'+
    tete+'<div class="mn-corps">'+corps+'</div></section>'+
    (modeTerritorial ? blocServicesTerritoriaux() : "");
}

function ongletsTemps(){
  const enCours = compterMaintenant();
  return '<div class="ong-temps" role="tablist" aria-label="Quand">'+
    CRENEAUX.map(c=>{
      const maintenant = c.id === "maintenant";
      // l'éclair est permanent : c'est un repère, pas une décoration qui
      // apparaît et disparaît sous les yeux
      const libelle = maintenant ? "⚡ "+c.label : c.label;
      /* Même règle sur l'onglet : on n'affiche pas un total qu'on ne peut pas
         ouvrir. */
      const ouvrables = PLAF ? Math.min(enCours, PLAF.limiteMaintenant()) : enCours;
      const compte = maintenant && enCours
        ? '<span class="ong-compte" aria-hidden="true">'+
          (PLAF && enCours > PLAF.limiteMaintenant() ? ouvrables+"+" : ouvrables)+
          '</span>' : '';
      const lu = maintenant && enCours
        ? ' aria-label="'+esc(c.label)+' : '+enCours+' événement'+(enCours>1?'s':'')+' en cours"' : '';
      return '<button class="ong'+(maintenant?' ong-maintenant':'')+
        (c.id===creneau?' actif':'')+'" role="tab" '+
        'aria-selected="'+(c.id===creneau)+'" data-creneau="'+c.id+'"'+lu+'>'+
        esc(libelle)+compte+'</button>';
    }).join("")+
    '</div>';
}

/* Ce qu'on écrit quand un groupe est vide. Jamais « rien autour de toi »
   quand on ignore où est « toi ». */
function statutGroupeHTML(){
  /* Tant que la recherche tourne, on montre ce qui arrive — pas un état.
     Dire « choisis un point de départ » ou « rien autour » pendant qu'une API
     répond encore, c'est décrire un vide qu'on n'a pas constaté. */
  const etatGroupe = etatDonnees(0);
  // squelettes discrets tant qu'on cherche : jamais un écran vide, jamais un
  // gros changement de mise en page quand les données finissent par arriver
  if(etatGroupe === ETATS_DONNEES.LOCATION_LOADING ||
     etatGroupe === ETATS_DONNEES.DATA_LOADING) return squeletteHTML(3);
  if(etatGroupe === ETATS_DONNEES.LOCATION_UNKNOWN)
    return '<p class="fb-statut">Choisis un point de départ pour voir ce qui '+
           'se passe autour.</p>';
  /* « Maintenant » vide n'est pas une impasse. La règle temporelle refuse d'y
     faire entrer un événement de demain — c'est voulu — mais l'écran doit
     alors dire où sont passés ces événements, sinon le refus ressemble à une
     panne. Une phrase, une sortie, et la sortie mène à l'onglet d'à côté. */
  if(creneau === "maintenant"){
    const technique = statutRechercheHTML(0);
    // une vraie panne ou une position refusée parle d'elle-même : on ne la
    // recouvre pas d'un message rassurant
    if(technique && !/Rien d’ouvert à proximité/.test(technique)) return technique;
    return '<div class="fb-statut" data-testid="maintenant-vide">'+
      'Rien en cours près de toi.'+
      '<br><button data-creneau-vers="avenir">Voir ce qui arrive bientôt →</button>'+
      '<button data-etat-action="all">Voir tous les lieux</button></div>';
  }
  const groupe = CRENEAUX.find(x=>x.id===creneau) || CRENEAUX[0];
  return '<p class="fb-statut">Rien d’annoncé pour « '+esc(groupe.label.toLowerCase())+
    ' » dans cette zone.<br>Les événements arrivent au fil des publications.</p>';
}

/* ---- « Où est-ce que je regarde ? » --------------------------------------
   Sans position connue, l'application affichait un point par défaut et le
   commentait comme s'il s'agissait du quartier de la personne. Elle dit
   maintenant ce qu'elle sait — c'est-à-dire rien — et propose les deux gestes
   qui débloquent la situation, plus les intentions pour commencer quand même. */
function blocOuRegarder(){
  if(positionConnue()) return "";
  const intentions = [...BESOINS_PRINCIPAUX.slice(0,4).map(b=>({id:b.id, emoji:b.emoji, label:b.label})),
    {id:"aide", emoji:"❤️", label:"Aide"}];
  return '<section class="pdep" data-testid="ou-regarder">'+
    '<p class="pdep-titre">Où veux-tu regarder ?</p>'+
    '<div class="pdep-actions">'+
      '<button class="pdep-btn pdep-fort" data-ou="position">⌖ Utiliser ma position</button>'+
      '<button class="pdep-btn" data-ou="ville">Choisir une ville</button>'+
    '</div>'+
    '<p class="pdep-sous">Ou commence par une envie :</p>'+
    '<div class="pdep-envies">'+intentions.map(i=>
      '<button class="pdep-envie" data-ou-besoin="'+esc(i.id)+'">'+
      '<em>'+i.emoji+'</em>'+esc(i.label)+'</button>').join("")+'</div>'+
    '</section>';
}

/* ---- « Pourquoi celui-là ? » --------------------------------------------
   Une recommandation sans raison se lit comme un résultat au hasard. Une
   seule étiquette, la plus décisive, tirée de ce qu'on sait réellement du
   lieu — jamais d'un classement interne qu'on ne peut pas expliquer. */
function raisonCourte(l){
  if(l.annule) return null;
  if(estTemporaire(l)){
    const etat = statutTemps(l);
    if(etat.statut === TEMPS.STATUTS.EN_COURS) return {t:"⚡ En cours", c:"chaud"};
    if(etat.statut === TEMPS.STATUTS.IMMINENT) return {t:"⚡ Commence bientôt", c:"chaud"};
    const section = TEMPS.sectionTemporelle(etat, Date.now());
    if(section === "ce_soir") return {t:"Ce soir", c:""};
    if(section === "ce_week_end") return {t:"Ce week-end", c:""};
    return {t:"Éphémère", c:""};
  }
  const d = dispoDe(l);
  // « ferme bientôt » avant « ouvert » : c'est l'information qui fait partir
  /* JUSQU'À QUELLE HEURE : c'est la moitié de l'information, et elle vivait
     ailleurs — dans une ligne « Ferme à 22:00 » posée deux rangs plus bas, que
     la liste compacte n'affiche plus. « Ouvert » tout seul ne dit pas si l'on
     a le temps d'y aller ; « Ouvert · jusqu'à 22:00 » le dit. */
  if(d && d.isOpenNow && d.closesAtTime && fermeDansMoinsDUneHeure(d))
    return {t:"Ferme bientôt · "+d.closesAtTime, c:"tiede"};
  if(d && d.isOpenNow)
    return {t: d.closesAtTime ? "Ouvert · jusqu’à "+d.closesAtTime : "Ouvert maintenant",
            c:"ouvert"};
  /* `gratuit` vaut `true` par défaut sur tout lieu OpenStreetMap sans tag
     `fee` — c'est-à-dire sur presque tous. L'afficher tel quel collait
     « Gratuit » sur des restaurants. On ne le dit que si une source le dit. */
  const prix = DONNEES ? DONNEES.normaliserPrix(l) : null;
  if(prix && prix.level === 0 && prix.confidence >= .8) return {t:"Gratuit", c:""};
  /* « Apprécié » est une affirmation sur ce que pensent les gens : elle exige
     de vrais avis, en nombre. Trente suffisaient à faire d'une note de 4,4 une
     réputation ; on demande cinquante avis et 4,5, et surtout que la note
     vienne d'une source qui compte réellement des avis (Google). Sans ça,
     l'étiquette dit quelque chose que la donnée ne dit pas. */
  const avis = Number(l.avis);
  if(Number.isFinite(Number(l.note)) && Number(l.note) >= 4.5
     && Number.isFinite(avis) && avis >= 50)
    return {t:"Apprécié autour de toi", c:""};
  /* Pas de repli sur la distance : la carte affiche déjà le temps de trajet,
     et « À 4 min » juste au-dessus de « 4 min » ne dit rien de plus. Mieux
     vaut aucune étiquette qu'une étiquette qui répète. */
  return null;
}

function fermeDansMoinsDUneHeure(d){
  if(!d || !d.closesAtTime) return false;
  const [h,m] = String(d.closesAtTime).split(":").map(Number);
  if(!Number.isFinite(h)) return false;
  const n = new Date();
  let reste = (h*60 + (m||0)) - (n.getHours()*60 + n.getMinutes());
  if(reste < -12*60) reste += 24*60;          // fermeture après minuit
  return reste > 0 && reste <= 60;
}

/* Une carte du carousel : photo, catégories, note, temps réel de trajet. */
function carteRecommandation(l){
  favorisEnMemoire.set(cleFavori(l), l);
  const evenement = estTemporaire(l) ? donneesEvenement(l) : null;
  const cibleTemporel = evenement || l;
  const c = categorieAffichee(l, {emoji:"📍"});
  // même règle que pour les cartes d'aide : aucune durée tant que le point
  // n'est pas mesuré par le navigateur
  const eta = positionPrecise() ? l.rankEta : null;
  const dispo = l.rankAvailability;
  const cats = etiquettesLisibles(l).join(" • ")
    || (CATS[l.cat] ? CATS[l.cat].nom || l.cat : l.cat);
  const media = mediaDe(l);

  // Une vraie photo si on en a une ; sinon une tuile teintée par la catégorie.
  // Jamais un gros emoji en guise d'image : ça se lit comme une image manquante.
  const teinte = COULEURS_CAT[l.cat] || "#5D6B63";
  // <img loading="lazy"> plutôt qu'un background : le navigateur ne télécharge
  // que ce qui approche du viewport, et les résultats s'affichent sans
  // attendre la moindre image. La tuile teintée sert de placeholder.
  const visuel = '<figure class="rc-photo rc-photo-vide" data-image-type="'+esc(media.image_type||"")+
      '" data-image-scope="'+esc(media.image_scope||"")+'" style="--teinte:'+teinte+'">'+
      '<i>'+c.emoji+'</i>'+
      (media.image_url
        ? '<img loading="lazy" decoding="async" alt="" src="'+esc(media.image_url)+'" '+
          'onload="this.classList.add(\'vue\');window.AutourPerf&&AutourPerf.jalon(\'images_ready\');imageEvenementChargee(this)" '+
          'onerror="imageEvenementErreur(this)">'
        : '')+
      (media.image_url && l.imageAttribution ? '<figcaption>Photo : '+attributionPhoto(l)+'</figcaption>' : '')+
    '</figure>';

  const minutes = eta && Number.isFinite(eta.minutes) ? eta.minutes+" min" : "";
  /* Le détail du trajet n'a d'intérêt que s'il APPREND quelque chose : quand
     le trajet est une marche de six minutes, « 6 min » puis « 🚶 6 min » puis
     « Arrivée 01:14 » font trois lignes pour une seule information, et
     repoussent la recommandation suivante sous le pli. */
  const detail = [];
  const marcheSeule = eta && eta.walkMinutes && eta.walkMinutes === eta.minutes
    && !(eta.lines && eta.lines.length);
  if(eta && eta.walkMinutes && !marcheSeule) detail.push('🚶 '+eta.walkMinutes+' min');
  if(eta && eta.lines && eta.lines.length) detail.push('🚇 '+esc(eta.lines[0]));
  // l'heure d'arrivée compte pour ce qui ferme ou ce qui commence ; pour un
  // événement déjà en cours, elle ne décide de rien
  const dejaEnCours = estTemporaire(l) &&
    statutTemps(l).statut === TEMPS.STATUTS.EN_COURS;
  /* L'heure d'arrivée est un temps de trajet déguisé : elle se calcule depuis
     le point de départ. Depuis une zone approximative, « Arrivée 03:07 » est
     aussi faux que « 16 min », et bien plus crédible. L'horaire de fermeture,
     lui, ne dépend pas de nous : il reste. */
  const arrivee = l.rankArrival && !dejaEnCours && positionPrecise()
    ? "Arrivée "+heureLocale(l.rankArrival, l)
    : (dispo && dispo.closesAtTime ? "Ferme à "+dispo.closesAtTime : "");

  // La date réelle passe devant le temps de trajet : « Commence dans 35 min »
  // fait décider d'y aller, « 9 min à pied » ne décide de rien tout seul.
  // Sur un lieu permanent la ligne n'apporte rien (« Maintenant » sur une
  // boulangerie ouverte est du bruit) : on la réserve aux événements.
  const quand = estTemporaire(l)
    ? TEMPS.libelleTemporel(cibleTemporel, instantCreneau().getTime(),
        {disponibilite:(x,t)=>dispoDe(x, null, t), statut: statutTemps(l, instantCreneau().getTime())})
    : "";
  const etatQuand = quand ? statutTemps(l, instantCreneau().getTime()).statut : "";
  const classeQuand = etatQuand === TEMPS.STATUTS.EN_COURS ? " en-cours"
    : etatQuand === TEMPS.STATUTS.IMMINENT ? " imminent"
    : etatQuand === TEMPS.STATUTS.INCONNU ? " flou" : "";

  /* OÙ C'EST. Une ligne discrète sous le nom : la salle pour un concert, le
     quartier ou la rue pour un lieu. Sans elle, cinq lignes se ressemblent —
     « Santa », « Vice-Versa 2 », « Café Méo » ne disent pas où l'on va, et la
     référence visuelle les fait toutes suivre de leur adresse. On ne répète
     pas le titre quand l'adresse EST le titre : c'est le cas des lieux sans
     nom, où la carte porterait deux fois la même chose. */
  /* Sur un lieu OpenStreetMap sans numéro de rue, l'adresse VAUT le nom : la
     ligne répéterait le titre. On se rabat alors sur la commune, qui situe au
     moins le quartier. */
  const ou = l.adresse && l.adresse !== l.titre ? l.adresse
    : (l.cp && l.cp !== l.titre && l.cp !== COMMUNE_INCONNUE ? l.cp : "");

  /* LA DISTANCE, PAS LE TEMPS DE TRAJET, EN VALEUR FORTE. « 3 min » en violet
     annonçait une interaction là où il n'y a qu'une mesure — et le violet est
     réservé à ce sur quoi on appuie. La référence donne « 450 m » en gris à
     droite ; le temps de marche reste à côté, en plus discret, quand on sait
     vraiment d'où l'on part. */
  const d = distanceDepuisZone(l);
  const dist = Number.isFinite(d) ? formatDist(d) : "";

  /* LE CINÉMA : PAS DE SÉANCES, ET C'EST UN CHOIX.

     Annoncer « Séance 21:40 » demande un horaire fiable, par salle et par
     film, mis à jour toutes les heures. Nous ne l'avons pas. Une séance
     inventée ou périmée envoie quelqu'un devant une porte close — c'est
     exactement le genre de promesse qu'Autour ne tient pas.

     Ce qu'on sait, on le dit : c'est un cinéma, il est ouvert jusqu'à telle
     heure, il est à telle distance, et voici son site pour la programmation.
     Le lien s'ouvre à côté sans quitter Autour. */
  const siteCinema = l.cat === "cinema" && l.url ? l.url : "";

  // Un <button> ne peut pas en contenir un autre : le parseur extrait le cœur
  // et disloque la carte. On utilise donc un conteneur avec rôle de bouton.
  return '<div class="rc-carte'+(l.annule?' annulee':'')+'" role="button" tabindex="0" data-ac="'+esc(l.id)+'">'+
    visuel+
    '<span class="rc-corps">'+
      // une annulation remplace la catégorie : c'est ce qu'il faut lire d'abord
      /* La couleur de la catégorie vit ICI et nulle part ailleurs sur la carte :
         une ligne de onze pixels. C'est ce que « avec parcimonie » veut dire —
         assez pour reconnaître un concert d'un café d'un coup d'œil, trop peu
         pour transformer la liste en arc-en-ciel. */
      '<span class="rc-haut"><span class="rc-cats" style="--cat:'+teinte+'">'+
        (l.annule ? '<b class="rc-annule">Annulé</b>' : esc(cats))+'</span>'+boutonCoeur(l)+'</span>'+
      '<span class="rc-nom">'+esc(l.titre)+'</span>'+
      (ou ? '<span class="rc-ou">'+esc(ou)+'</span>' : '')+
      (quand ? '<span class="rc-quand'+classeQuand+'" data-testid="carte-quand">'+esc(quand)+'</span>' : '')+
      (()=>{ const r = raisonCourte(l);
        // sur un événement, la date dit déjà pourquoi : pas deux fois
        return r && !quand
          ? '<span class="rc-pourquoi '+r.c+'" data-testid="carte-pourquoi">'+esc(r.t)+'</span>' : ''; })()+
      '<span class="rc-ligne">'+
        (l.note ? '<span class="rc-note">★ '+l.note.toFixed(1).replace(".",",")+
          (l.avis?' <i>('+l.avis+')</i>':'')+'</span>' : '<span class="rc-note"></span>')+
        '<span class="rc-mesure">'+
          (dist ? '<span class="rc-dist">'+esc(dist)+'</span>' : '')+
          (minutes ? '<span class="rc-min">'+minutes+'</span>' : '')+
        '</span>'+
      '</span>'+
      (siteCinema
        ? '<a class="rc-lien" href="'+esc(siteCinema)+'" target="_blank" rel="noopener"'+
          ' onclick="event.stopPropagation()">Voir le cinéma</a>' : '')+
      (detail.length ? '<span class="rc-trajet">'+detail.join(" ")+'</span>' : '')+
      (arrivee ? '<span class="rc-arrivee">'+esc(arrivee)+'</span>' : '')+
    '</span></div>';
}

/* Les arrêts restent des données de découverte. Le bouton Transport révèle
   leur couche ; il ne lance plus de moteur de départs ou de correspondances. */
/* ==================================================================== */
/*  AUTOUR DE TOI — les catégories générales, en gros et en bas          */
/* ==================================================================== */
/* « Maintenant » propose ce qu'il y a d'intéressant à faire là, tout de
   suite. Il ne contient donc plus les commodités — supermarché, pharmacie,
   métro — qui prenaient ses trois places (voir COMMODITES dans
   maintenant.js). Elles ne disparaissent pas pour autant : c'est ICI qu'on
   les retrouve, avec tous les lieux permanents, par de gros raccourcis qu'on
   vise sans réfléchir.

   Chaque raccourci ouvre une famille qui existe déjà dans BESOINS : rien
   n'est réinventé, on donne juste une porte plus large à ce qui était
   derrière « Plus ». */
const RACCOURCIS_AUTOUR = [
  {id:"activites", emoji:"🏃", label:"Activités", teinte:"#2E9E4F", besoin:"bouger"},
  {id:"culture",   emoji:"🏛️", label:"Culture",   teinte:"#6D3BEB", besoin:"culture"},
  {id:"musique",   emoji:"🎵", label:"Musique",   teinte:"#E0316E", besoin:"culture",
   sous:"Concerts et spectacles"},
  {id:"lieux",     emoji:"☕", label:"Lieux",     teinte:"#8A5A2B", besoin:"chiller"},
  {id:"sports",    emoji:"⚽", label:"Sports",    teinte:"#2673E8", besoin:"bouger",
   sous:"Terrains et équipements"},
  {id:"plus",      emoji:"⋯",  label:"Plus",      teinte:"#5D6B63", besoin:"plus"},
];

function grilleRaccourcisAutour(){
  return '<section class="adt" data-testid="autour-de-toi">'+
    '<div class="adt-grille">'+
      RACCOURCIS_AUTOUR.map(r=>
        '<button class="adt-b" data-adt="'+esc(r.id)+'">'+
          '<span class="adt-rond" style="background:'+r.teinte+'">'+r.emoji+'</span>'+
          '<span class="adt-lab">'+esc(r.label)+'</span></button>').join("")+
    '</div></section>';
}

/* Ouvrir un raccourci, c'est ouvrir la famille correspondante — et, quand le
   raccourci vise plus précis que la famille, sa sous-catégorie. On cherche
   celle-ci par son LIBELLÉ : un indice se décale dès qu'on ajoute une entrée
   à la liste, un libellé non. */
function ouvrirRaccourciAutour(id){
  const r = RACCOURCIS_AUTOUR.find(x=>x.id === id);
  if(!r) return;
  if(modeAide) basculerAide();
  ouvrirFeuille2(r.besoin);
  if(!r.sous) return;
  const b = BESOIN_DE(r.besoin);
  const i = b && b.sous ? b.sous.findIndex(x=>x.label === r.sous) : -1;
  /* `ouvrirFeuille2` a déjà demandé les catégories de toute la famille : la
     sous-catégorie n'est qu'un filtre sur ce qui arrive, pas une requête de
     plus. */
  if(i >= 0){ sousChoisi = i; majFeuille2(); rendre(); }
}

function blocTransports(){
  if(!coucheTransport) return "";
  return '<div class="tr-bloc">'+
    '<span class="tr-icone" aria-hidden="true">🚌</span>'+
    '<span class="tr-txt"><span class="tr-titre">Transports autour de toi</span>'+
      '<span class="tr-lignes">Arrêts et stations affichés sur la carte</span></span>'+
    '</div>';
}

function brancherFeuille2(){
  const corps = $("#fbCorps");

  // « Voir tout » : la liste complète des recommandations de l'accueil
  // rôle de bouton : Entrée et Espace doivent l'activer comme un vrai bouton
  corps.querySelectorAll('[role="button"][data-ac]').forEach(x=>x.onkeydown=e=>{
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); x.click(); }
  });

  corps.querySelectorAll("[data-rc-tout]").forEach(b=>b.onclick=()=>{
    const groupe = CRENEAUX.find(x=>x.id===creneau) || CRENEAUX[0];
    /* « TOUT » VEUT DIRE TOUT. Le plafond de soixante était invisible : sur un
       centre dense on ne voyait pas ce qu'on ne voyait pas. La liste est
       longue, elle défile — c'est exactement ce que le bouton promet. */
    /* LE PLAFOND EST UN MAXIMUM, PAS UN OBJECTIF. On demande la liste
       complète — c'est elle qui donne le compteur honnête — puis on coupe.
       Rien n'est complété : sept excellentes valent mieux que dix. */
    const connus = recommandationsAccueil(Infinity, {tout:true});
    const tout = PLAF
      ? PLAF.appliquer(connus, creneau === "maintenant"
          ? PLAF.limiteMaintenant() : PLAF.limiteExplorer(connus.length))
      : connus;
    pileEcrans = [];
    /* « Voir tout » ouvre la même section en grand : elle porte donc le même
       nom que celle qu'on vient de quitter. */
    pousserEcran(()=>afficherListe("✨",
      creneau === "maintenant" ? "Autour de toi" : groupe.label,
      tout, false, ()=>b.click(), connus.length));
  });

  corps.querySelectorAll("[data-chip]").forEach(b=>b.onclick=()=>retirerChip(b.dataset.chip));

  // le retour posé en fin de liste passe par le même chemin que le bouton
  // flottant : une seule porte pour revenir à sa zone, comme convenu
  corps.querySelectorAll("[data-retour-moi]").forEach(b=>b.onclick=revenirAutourDeMoi);

  brancherBesoinsRapides(corps);

  /* Ouvrir depuis ce bloc, c'est l'avoir lu : il disparaît, et la carte
     correspondante passe en « vu » à droite. Une seule notion de « lu ». */
  corps.querySelectorAll("[data-npt]").forEach(b=>b.onclick=()=>{
    const id = b.dataset.npt;
    marquerVu([id]);
    pileEcrans = [];
    pousserEcran(()=>ouvrirDetail(id));
  });

  corps.querySelectorAll("[data-adt]").forEach(b=>b.onclick=()=>
    ouvrirRaccourciAutour(b.dataset.adt));
  corps.querySelectorAll("[data-adt-tout]").forEach(b=>b.onclick=()=>
    ouvrirFeuille2("plus"));

  corps.querySelectorAll("[data-aide-accueil]").forEach(b=>b.onclick=()=>{
    if(!modeAide) basculerAide();
    ouvrirFeuille2("aide");
  });

  /* ---- Aide : le besoin d'abord ---- */
  corps.querySelectorAll("[data-sa]").forEach(b=>b.onclick=()=>{
    sousAide = b.dataset.sa;
    besoinsAide = sousAide === "urgence" ? [] : [sousAide];
    intentionsSanteAide = sousAide === "parler" ? ["mentale"] : [];
    oublierPhraseAide();
    chargerAideSiBesoin();
    majFeuille2(); reinitialiserScrollFeuille(); rendre();
  });
  const form = $("#formBesoin");
  if(form) form.onsubmit = (e)=>{
    e.preventDefault();
    const champ = $("#champBesoin");
    const phrase = (champ && champ.value || "").trim();
    if(!phrase) return;
    if(champ) champ.blur();
    lancerBesoinAide(phrase);
  };
  corps.querySelectorAll("[data-besoin-off]").forEach(b=>b.onclick=()=>{
    const id = b.dataset.besoinOff;
    if(id === "age"){ ageDeclare = null; }
    else {
      besoinsExprimesAide = besoinsExprimesAide.filter(x=>x !== id);
      besoinsAide = besoinsAide.filter(x=>x !== id);
      if(sousAide === id) sousAide = besoinsAide[0] || null;
      if(sousAide !== "sante" && sousAide !== "parler") intentionsSanteAide = [];
    }
    majFeuille2();
  });
  corps.querySelectorAll("[data-as-plus]").forEach(b=>b.onclick=()=>{
    elargirZone(); chargerAideSiBesoin(true); majFeuille2();
  });

  /* La bascule vers Explorer, recherche déjà écrite. Un seul geste : on ne
     dépose pas la personne devant un champ vide en lui laissant retaper ce
     qu'elle vient d'écrire. */
  function basculerVersExplorer(requete){
    redirectionExplorer = null;
    if(modeAide) basculerAide();
    // pas de fermeture suivie d'une réouverture : voir la note de l'onglet
    // Explorer sur le rechargement provoqué par le va-et-vient d'historique
    ouvrirAccueilFeuille();
    ongletCourant = "explorer";
    marquerNavigation("explorer");
    // la recherche préparée remplace le contexte d'avant : la reposer
    // par-dessus rouvrirait l'écran qu'on vient justement de quitter
    contexteExplorer = null;
    if(requete){
      recherche = requete;
      const champ = $("#rech");
      if(champ) champ.value = requete;
      ouvrirResultats(requete);
    }
  }
  corps.querySelectorAll("[data-vers-explorer]").forEach(b=>b.onclick=()=>{
    basculerVersExplorer((redirectionExplorer || {}).requete || "");
  });
  /* Une lecture proposée est choisie : un geste, et on est dans le bon écran.
     « Un lieu près de moi » repasse par Explorer avec la phrase déjà écrite ;
     tout le reste est un besoin d'Aide qu'on ouvre directement. */
  corps.querySelectorAll("[data-aide-lecture]").forEach(b=>b.onclick=()=>{
    const id = b.dataset.aideLecture;
    if(id === "lieu"){
      basculerVersExplorer((redirectionExplorer || {}).requete || "");
      return;
    }
    redirectionExplorer = null;
    oublierPhraseAide();
    besoinsAide = (AIDE && AIDE.BESOIN_DE(id)) ? [id] : [];
    sousAide = besoinsAide[0] || "autre";
    intentionsSanteAide = [];
    chargerAideSiBesoin();
    majFeuille2(); reinitialiserScrollFeuille();
  });
  // reformuler : on revient à la question, champ vide
  corps.querySelectorAll("[data-aide-reformuler]").forEach(b=>b.onclick=()=>{
    redirectionExplorer = null;
    besoinsAide = []; sousAide = null; intentionsSanteAide = []; oublierPhraseAide();
    majFeuille2(); reinitialiserScrollFeuille();
  });
  // « montre-moi quand même les structures » : le choix reste à la personne
  corps.querySelectorAll("[data-aide-general]").forEach(b=>b.onclick=()=>{
    redirectionExplorer = null;
    besoinsAide = []; sousAide = "autre"; intentionsSanteAide = []; oublierPhraseAide();
    majFeuille2();
  });
  // « non, j'ai bien besoin d'aide » : on s'est trompé, on revient à la question
  corps.querySelectorAll("[data-aide-rester]").forEach(b=>b.onclick=()=>{
    redirectionExplorer = null;
    besoinsAide = []; sousAide = "autre"; intentionsSanteAide = []; oublierPhraseAide();
    majFeuille2();
  });
  corps.querySelectorAll("[data-as]").forEach(b=>b.onclick=()=>{
    const quoi = b.dataset.as;
    if(quoi === "ville"){ ouvrirRecherche(); const c=$("#rech"); if(c) c.placeholder = "Dans quelle ville ?"; return; }
    if(quoi === "general"){ besoinsAide = []; sousAide = "autre"; intentionsSanteAide = []; oublierPhraseAide(); majFeuille2(); return; }
    if(quoi === "reformuler"){ besoinsAide = []; sousAide = null; intentionsSanteAide = []; oublierPhraseAide(); majFeuille2(); return; }
  });

  /* Une ligne de « Maintenant » ouvre son événement. Un geste, pas un menu. */
  corps.querySelectorAll("[data-mn]").forEach(b=>b.onclick=()=>{
    const l = lieux.find(x=>x.id === b.dataset.mn);
    if(!l) return;
    pileEcrans = [];
    pousserEcran(()=>ouvrirDetail(l.id));
  });
  /* Un service du bloc « utile autour de toi » s'ouvre comme n'importe quel
     autre lieu : c'est un lieu, il l'est resté. */
  corps.querySelectorAll("[data-tsv]").forEach(b=>b.onclick=()=>{
    const l = lieux.find(x=>x.id === b.dataset.tsv);
    if(!l) return;
    pileEcrans = [];
    pousserEcran(()=>ouvrirDetail(l.id));
  });
  /* Regarder le périmètre depuis Tourcoing est légitime — s'y croire ne l'est
     pas. Le bouton déplace explicitement le regard, par le chemin de cadrage
     qui existe déjà. */
  corps.querySelectorAll("[data-tterr-recentrer]").forEach(b=>b.onclick=()=>{
    if(!contexteTerritorial || !contexteTerritorial.zones.length) return;
    const z = contexteTerritorial.zones[0];
    rechercheGeo = {nom:contexteTerritorial.nom, lat:z.lat, lng:z.lng, emprise:null};
    if(CTX) definirZoneActive(CTX.zoneRecherche(contexteTerritorial.nom, [z.lat, z.lng], null));
    allerVers([z.lat, z.lng], 15);
    reevaluerTerritorial({ouverture:true});
    chargerAutourDuPoint(z.lat, z.lng, {force:true});
    majFeuille2();
  });
  corps.querySelectorAll("[data-mn-tout]").forEach(b=>b.onclick=()=>{
    /* Ce qui a lieu, par le chemin qui existe déjà — et pas plus de dix.
       « Maintenant » n'est pas un inventaire : trois propositions dans le
       bloc, dix au maximum derrière « Voir tout ». Au-delà, la promesse
       change de nature et la qualité se dilue dans le remplissage. */
    pileEcrans = [];
    pousserEcran(()=>afficherListe("⚡", "Maintenant",
      classerLieux(evenementsMaintenant(), false).slice(0, MAINTENANT_TOUT), false,
      ()=>{ pileEcrans = []; majFeuille2(); }));
  });

  /* La sortie d'un bloc vide ou en erreur. Elle ne laisse jamais dans une
     impasse : vide → ce qui ouvre autour ; position inconnue → choisir un
     point de départ ; panne → réessayer. Chacune passe par un chemin qui
     existe déjà, plutôt que d'en inventer un quatrième. */
  corps.querySelectorAll("[data-mn-sortie]").forEach(b=>b.onclick=()=>{
    const M = window.AutourMaintenant;
    const ctx = contexteMaintenant();
    if(ctx.positionRefusee || !ctx.positionConnue){ ouvrirRecherche(); return; }
    if(b.dataset.mnSortie === (M && M.ETATS.ERROR)){
      // le même chemin de relance que partout ailleurs, pas un second
      const centre = pointCarte();
      rechercheEtat.overpass = SEARCH_STATES.IDLE;
      definirEtatRecherche("places", SEARCH_STATES.LOADING_PLACES);
      chargerAutourDuPoint(centre.lat, centre.lng, {force:true});
      majFeuille2();
      return;
    }
    // « vide » : Explorer reste accessible, et c'est là qu'on l'envoie
    if(creneau !== "maintenant"){ majFeuille2(); return; }
    montrerFermes = false;
    filtreActif = "tout";
    if(catsActives) catsActives.clear();
    majFeuille2(); reinitialiserScrollFeuille();
  });

  /* Le pont depuis « Maintenant » vide vers « À venir ». Il passe par le même
     chemin qu'un appui sur l'onglet : un seul comportement à maintenir. */
  corps.querySelectorAll("[data-creneau-vers]").forEach(b=>b.onclick=()=>{
    const cible = b.dataset.creneauVers;
    if(creneau === cible) return;
    creneau = cible;
    filtreMaintenant = creneau === "maintenant";
    majFeuille2(); reinitialiserScrollFeuille(); rendre();
  });

  // les quatre groupes de temps : un seul geste, aucune page de plus
  corps.querySelectorAll("[data-creneau]").forEach(b=>b.onclick=()=>{
    if(creneau === b.dataset.creneau) return;
    const cible = b.dataset.creneau;
    creneau = cible;
    // « n'afficher que ce qui est utilisable » n'a de sens que dans
    // « maintenant » : ailleurs c'est la date qui trie, pas l'ouverture
    filtreMaintenant = creneau === "maintenant";
    /* Le geste répond avant le classement. Le bouton choisi prend son état
       dans le même événement ; carte, contenu et filtres suivent au prochain
       frame. Sur CPU ralenti, « Ce soir » attendait autrement 250 ms avant de
       seulement paraître sélectionné. */
    const barre = b.closest("[role=tablist]");
    if(barre) barre.querySelectorAll("[data-creneau]").forEach(onglet=>{
      const actif = onglet === b;
      onglet.classList.toggle("actif", actif);
      onglet.setAttribute("aria-selected", String(actif));
    });
    reinitialiserScrollFeuille();
    apresPeinture(()=>{
      if(creneau === cible)
        planifierRendu({feuille:true, carte:true, filtres:true});
    });
  });

  // sans position connue : les deux gestes qui débloquent, et les envies
  corps.querySelectorAll("[data-ou]").forEach(b=>b.onclick=()=>{
    if(b.dataset.ou === "position"){ suivreMaPosition(); return; }
    ouvrirRecherche();
    const champ = $("#rech");
    if(champ){ champ.value = ""; champ.placeholder = "Dans quelle ville ?"; }
  });
  corps.querySelectorAll("[data-ou-besoin]").forEach(b=>b.onclick=()=>{
    const id = b.dataset.ouBesoin;
    if(id === "aide"){ if(!modeAide) basculerAide(); return; }
    ouvrirFeuille2(id);
  });

  corps.querySelectorAll("[data-bn]").forEach(b=>b.onclick=()=>{
    const id = b.dataset.bn;
    if(id === "aide"){ if(!modeAide) basculerAide(); ouvrirFeuille2("aide"); return; }
    if(modeAide) basculerAide();
    ouvrirFeuille2(id);
  });

  corps.querySelectorAll("[data-sc]").forEach(b=>b.onclick=()=>{
    const bes = BESOIN_DE(feuilleNiveau);
    const i = Number(b.dataset.sc);
    // retoucher le choix coché le décoche : tout le besoin revient
    sousChoisi = (sousChoisi === i) ? null : i;
    catsActives = sousChoisi === null ? null : new Set(bes.sous[i].cats);
    filtreActif = "tout";
    if(sousChoisi !== null){
      mettreAJourProfil("categorie", bes.sous[i].cats[0]);
      // on ne va chercher ces catégories qu'ici, au moment où on les demande
      chargerPourCats(bes.sous[i].cats);
      const editorial = typeEditorial(bes.sous[i]);
      if(editorial !== "autre") chargerEditorial(editorial);
      if(feuilleNiveau === "manger") completerRestauration();
    }
    rendre(); majAccueil(); majFeuille2(); majRaccourcis(); reinitialiserScrollFeuille();
  });

  corps.querySelectorAll("[data-sa]").forEach(b=>b.onclick=()=>{
    sousAide = (sousAide === b.dataset.sa) ? null : b.dataset.sa;
    rendre(); majAccueil(); majFeuille2(); reinitialiserScrollFeuille();
  });

  corps.querySelectorAll("[data-etat-action]").forEach(b=>b.onclick=()=>{
    const action = b.dataset.etatAction;
    if(action === "aide"){
      if(!modeAide) basculerAide();
      ouvrirFeuille2("aide");
      return;
    }
    if(action === "all"){
      filtreMaintenant = false;
      montrerFermes = true;
      majFiltres(); rendre(); majFeuille2(); reinitialiserScrollFeuille();
      return;
    }
    const centre = pointCarte();
    rechercheEtat.overpass = SEARCH_STATES.IDLE;
    definirEtatRecherche("places",SEARCH_STATES.LOADING_PLACES);
    chargerAutourDuPoint(centre.lat,centre.lng,{force:true});
    if(feuilleNiveau === "manger") completerRestauration({force:true});
  });

  corps.querySelectorAll("[data-elargir]").forEach(b=>b.onclick=elargirZone);
  corps.querySelectorAll("[data-vide-action]").forEach(b=>b.onclick=()=>{
    const action = b.dataset.videAction;
    if(action === "5km"){
      rayonRecherche = Math.max(rayonRecherche,5000);
      surLaCarte((m)=>m.setZoom(Math.min(m.getZoom(),14)), "zoom");
      const centre = map.getCenter();
      chargerAutourDuPoint(centre.lat,centre.lng,{force:true});
      if(sousChoisi !== null){
        const besoin = BESOIN_DE(feuilleNiveau);
        const sous = besoin && besoin.sous[sousChoisi];
        const editorial = typeEditorial(sous);
        if(editorial !== "autre") chargerEditorial(editorial);
      }
      toast("Recherche élargie à 5 km");
      return;
    }
    if(action === "tout"){
      catsActives=null; sousChoisi=null; selectionAccueil=false;
      rendre(); majAccueil(); majFeuille2(); majRaccourcis();
      return;
    }
    fermerFeuille2();
    retourFormulaire=false;
    ouvrirModePose();
  });

  corps.querySelectorAll("[data-pied]").forEach(b=>b.onclick=()=>{
    const q = b.dataset.pied;
    if(q === "hasard"){ fermerFeuille2(); surprendre(); return; }
    if(q === "partage"){ partagerApp(); return; }
    personnalisation = !personnalisation;
    try{ localStorage.setItem("autour:perso", personnalisation ? "oui" : "non"); }catch(e){}
    if(!personnalisation) reinitialiserProfil();
    rendre(); majAccueil(); majFeuille2();
    toast(personnalisation ? "Suggestions personnalisées" : "Préférences oubliées");
  });

  brancherGestesRecommandations(corps);
}

/* Les gestes d'une carte de lieu, branchés sur un fragment plutôt que sur la
   feuille entière. C'est ce qui permet de remplir la zone des recommandations
   APRÈS coup — le classement arrive une tranche d'inactivité plus tard — sans
   rebrancher tout le panneau, et sans laisser des cartes muettes. */
function brancherGestesRecommandations(racine){
  if(!racine) return;
  racine.querySelectorAll('[role="button"][data-ac]').forEach(x=>x.onkeydown=e=>{
    if(e.key === "Enter" || e.key === " "){ e.preventDefault(); x.click(); }
  });
  racine.querySelectorAll("[data-ac]").forEach(b=>b.onclick=()=>{
    const id = b.dataset.ac, cible = lieux.find(x=>x.id===id);
    if(!cible) return;
    mettreAJourProfil("clic", cible.cat);
    allerVers([cible.lat,cible.lng], 17, {duration:.5});
    pileEcrans = [];
    pousserEcran(()=>ouvrirDetail(id));
  });
  racine.querySelectorAll("[data-coeur]").forEach(()=>{});  // délégué globalement
}

/* Les quatre raccourcis du bas : le chemin court vers le même endroit. */
function majRaccourcis(){
  const z = $("#raccourcis");
  if(!z) return;
  // quatre raccourcis permanents + « Plus » : le rail reste lisible d'un
  // coup d'œil au pouce, les besoins secondaires sont à un tap de là
  const plusActif = feuilleNiveau === "plus" ||
    !!(BESOIN_DE(feuilleNiveau) || {}).secondaire;
  /* Aide ne figure plus dans ce rail : elle a son bouton permanent sur la
     carte. Elle y était enfermée derrière la loupe, alors que c'est ce qu'on
     doit pouvoir atteindre le plus vite — et l'avoir aux deux endroits aurait
     fait deux états à tenir d'accord pour une seule chose.
     « Gratuit » a quitté ce rail pour la même raison : c'est une CONTRAINTE,
     et son seul foyer est le bouton filtres. */
  const ordre = BESOINS_PRINCIPAUX.filter(b=>b.id !== "aide");
  z.innerHTML = ordre.map(b=>{
    const actif = feuilleNiveau === b.id;
    return '<button class="rc'+(actif?" actif":"")+'" data-rc="'+b.id+'">'+
      '<em>'+b.emoji+'</em>'+esc(b.label.replace(" autour de moi",""))+
      '</button>';
  }).join("") +
    '<button class="rc'+(plusActif?" actif":"")+'" data-rc="plus"><em>•••</em>Plus</button>';
  z.querySelectorAll("[data-rc]").forEach(b=>b.onclick=()=>{
    const id = b.dataset.rc;
    if(id === "plus"){
      if(modeAide) basculerAide();
      if(feuilleNiveau === "plus"){ fermerFeuille2(); return; }
      ouvrirFeuille2("plus");
      if(!rechercheDockeeDesktopDemandee()) fermerRecherche({force:true});
      return;
    }
    if(id === "aide"){
      if(modeAide){ basculerAide(); fermerFeuille2(); return; }
      basculerAide(); ouvrirFeuille2("aide"); return;
    }
    if(modeAide) basculerAide();
    if(feuilleNiveau === id){ fermerFeuille2(); return; }
    ouvrirFeuille2(id);
    /* Sur téléphone, le choix rend l'écran à la feuille. Sur desktop, la
       recherche devient au contraire le bloc docké de la référence. */
    if(!rechercheDockeeDesktopDemandee()) fermerRecherche({force:true});
  });
}

/* Barre de filtres humains, visible seulement quand on explore. En mode
   Aide, la même barre porte les six besoins : un seul rail de boutons à
   lire, jamais deux superposés. */
function majFiltres(){
  const b = $("#btnLieu");
  if(b) b.classList.toggle("inconnu", !positionConnue());
  const z = $("#filtresHumains");
  if(!z) return;

  // en mode Aide, les six besoins tiennent lieu de filtres, et ils sont
  // affichés dans la feuille : ce rail-là reste vide
  if(modeAide){ z.hidden = true; z.innerHTML = ""; return; }

  // Le rail ne sort plus tout seul : soit on a ouvert « Filtres », soit un
  // filtre est déjà actif et doit rester défaisable. L'écran de départ reste
  // donc nu — c'est ce qui permet de le comprendre en une seconde.
  const demande = z.dataset.force === "1";
  const actifs = filtresHumains.size > 0 || montrerFermes;
  const montrer = demande || actifs;
  z.hidden = !montrer;
  // vidée et pas seulement masquée : en sortant du mode Aide, les six besoins
  // restaient dans le document, prêts à réapparaître au prochain affichage
  if(!montrer){ z.innerHTML = ""; return; }

  // Trois filtres au maximum sous les catégories : au-delà, la ligne
  // redevient un mur d'options. Les filtres déjà actifs passent devant, puis
  // les contraintes courantes — ce sont elles qu'on vient chercher ici depuis
  // qu'elles ne sont plus exposées ailleurs.
  const place = (id)=>{ const i = CONTRAINTES.indexOf(id); return i === -1 ? 99 : i; };
  const rang = (f)=> (filtresHumains.has(f.id) ? 0 : 100) + place(f.id);
  const ordonnes = FILTRES_HUMAINS.slice().sort((a,b)=>rang(a)-rang(b));
  const visibles = demande ? ordonnes : ordonnes.filter(f=>filtresHumains.has(f.id));
  z.innerHTML = visibles.slice(0,3).map(f=>
    '<button class="fh'+(filtresHumains.has(f.id)?' actif':'')+'" data-fh="'+f.id+'">'+
      f.label+'</button>').join("") +
    // les lieux fermés ne reviennent que sur demande explicite : c'est un
    // choix de l'utilisateur, jamais un défaut
    ((demande || montrerFermes)
      ? '<button class="fh'+(montrerFermes?' actif':'')+'" data-fermes="1" '+
        'aria-pressed="'+(montrerFermes?'true':'false')+'">Lieux fermés</button>' : "");
  z.querySelectorAll("[data-fh]").forEach(x=>x.onclick=()=>{
    const id = x.dataset.fh;
    if(filtresHumains.has(id)) filtresHumains.delete(id); else filtresHumains.add(id);
    if(id === "famille" && filtresHumains.has(id)) chargerEditorial("family");
    majFiltres(); rendre();
  });
  const bascule = z.querySelector("[data-fermes]");
  if(bascule) bascule.onclick=()=>{
    montrerFermes = !montrerFermes;
    majFiltres(); rendre(); majFeuille2();
  };
}

/* Un clic pour entrer, un clic pour sortir. Rien n'est chargé tant que le
   mode n'est pas demandé : l'ouverture de l'app ne paie pas ce mode. */
function basculerAide(){
  modeAide = !modeAide;
  // on repart toujours de la question : « de quoi as-tu besoin ? »
  sousAide = null;
  besoinsExprimesAide = [];
  besoinsAide = [];
  besoinsSecondairesAide = [];
  intentionsSanteAide = [];
  redirectionExplorer = null;
  document.body.classList.toggle("aide", modeAide);

  // on sort de toute sélection en cours : le mode Aide repart d'une page nette
  catsActives = null;
  sousChoisi = null;
  filtreActif = "tout";
  filtresHumains.clear();
  recherche = ""; if($("#rech")) $("#rech").value = "";
  selectionAccueil = null;
  montrerFermes = false;
  $("#suggestions").hidden = true;

  majFiltres(); majRaccourcis();
  // Ouvrir la feuille doit rester instantané même si beaucoup de marqueurs
  // sont déjà en cache. La carte se reclasse juste après le premier paint.
  requestAnimationFrame(()=>setTimeout(()=>{ rendre(); majAccueil(); },0));

  if(modeAide && centreDonnees()){
    // les réseaux d'aide arrivent après coup, la carte est déjà utilisable
    chargerAideZone()
      .then(()=>{ rendre(); majAccueil(); majFeuille2(); });
  }
}

function basculerMaintenant(){
  filtreMaintenant = !filtreMaintenant;
  majFiltres(); rendre(); majAccueil(); majFeuille2();
}

/* Indicateur de vie du quartier. Ce n'est pas une donnée officielle mais un
   comptage de ce que l'app connaît réellement autour de toi ; le libellé le
   dit, pour qu'on ne le prenne pas pour une mesure. */
function vitalite(){
  const centre = centreZoneActive();
  if(!centre) return null;
  const [lat,lng] = centre;
  const proches = lieux.filter(l=>dansZoneActive(l) && distanceM(lat,lng,l.lat,l.lng) < 900);
  const ouverts = proches.filter(l=>l.ouvert === true).length;
  const evs = proches.filter(l=>estTemporaire(l) && !estPasse(l)).length;
  const score = ouverts + evs*5;
  if(score >= 25) return {p:"🟢", t:"Quartier très vivant", n:ouverts, e:evs};
  if(score >= 8)  return {p:"🟡", t:"Activité normale",     n:ouverts, e:evs};
  return {p:"🔴", t:"Quartier calme", n:ouverts, e:evs};
}

/* ---- Surprise contrôlée ----------------------------------------------
   Un tirage uniforme proposait aussi bien une pharmacie qu'un concert, et
   pouvait resservir le même lieu trois fois de suite. On compose désormais
   70 % de pertinence, 20 % de découverte — ce que tu ne regardes jamais —
   et 10 % de hasard, en excluant ce qui ne peut pas convenir.            */
const MEMOIRE_SURPRISES = 12;
let surprisesVues = (()=>{
  try{ return JSON.parse(localStorage.getItem("autour:surprises")||"[]"); }
  catch(e){ return []; }
})();
function memoriserSurprise(id){
  surprisesVues.unshift(id);
  surprisesVues = surprisesVues.slice(0, MEMOIRE_SURPRISES);
  try{ localStorage.setItem("autour:surprises", JSON.stringify(surprisesVues)); }catch(e){}
}

const CATS_SANS_INTERET = ["metro","bus","toilettes","recharge","velo","commerce"];

function choisirSurprise(liste, ctx, profil){
  const depuis = ctx.moi && ctx.moi[0] ? ctx.moi : ctx.centre;   // géoloc refusée : le centre de la carte suffit
  const possibles = liste.filter(l=>{
    if(l.ouvert === false) return false;                       // fermé : inutile
    if(JAMAIS_AUTO.has(l.cat)) return false;                   // une surprise n'est jamais une administration
    if(!l.titre || l.titre.length < 3) return false;           // fiche sans information
    if(CATS_SANS_INTERET.includes(l.cat)) return false;
    if(surprisesVues.includes(l.id)) return false;             // déjà proposé récemment
    if((profil.ignores[l.cat]||0) >= 3) return false;          // tu l'écartes systématiquement
    return distanceM(depuis[0], depuis[1], l.lat, l.lng) <= 2500;
  });
  if(!possibles.length) return null;

  const notes = possibles.map(l=>{
    const r = scoreLieu(l, ctx);
    // découverte : plus tu as consulté une catégorie, moins elle surprend
    const vues = (profil.categories[l.cat]||0);
    const decouverte = 100 / (1 + vues);
    return { l, raison:r.raison,
             total: 0.7*r.score + 0.2*decouverte + 0.1*(Math.random()*100) };
  }).sort((a,b)=>b.total - a.total);

  // on tire dans le haut du panier : toujours le premier ne surprendrait plus
  const haut = notes.slice(0, Math.min(5, notes.length));
  return haut[Math.floor(Math.random()*haut.length)];
}

function surprendre(){
  if(!map) return;
  const ctx = contexteActuel();
  const choix = choisirSurprise(lieux, ctx, PROFIL);
  if(!choix){
    toast(surprisesVues.length ? "Plus rien de neuf dans le coin" : "Rien à proposer pour l’instant");
    return;
  }
  const l = choix.l;
  memoriserSurprise(l.id);
  const depuis = (ctx.moi && ctx.moi[0]) ? ctx.moi : ctx.centre;
  const d = distanceM(depuis[0], depuis[1], l.lat, l.lng);
  const c = categorieAffichee(l, {emoji:"📍", label:""});

  allerVers([l.lat, l.lng], 17, {duration:.7});
  pileEcrans = [];
  pousserEcran(()=>{
    ouvrirFeuille(
      '<p class="sp-tete">🎲 Surprise</p>'+
      '<h2 class="titre">'+esc(l.titre)+'</h2>'+
      '<p class="resume">'+
        '<span>'+c.emoji+' '+esc(c.label)+'</span>'+
        '<span>'+formatDist(d)+'</span>'+
        '<span>'+tempsTrajetMinutes(d, VITESSES_KMH.pied)+' min à pied</span>'+
        (l.ouvert === true  ? '<span class="ouvert">Ouvert</span>' :
         l.ouvert === false ? '<span class="ferme">Fermé</span>' : '')+
        (l.note ? '<span>★ '+l.note.toFixed(1)+'</span>' : '')+
      '</p>'+
      '<p class="sp-raison">'+esc(choix.raison)+'</p>'+
      '<div class="actions">'+
        '<button class="act act-1" id="spAller">Y aller</button>'+
        '<button class="act" id="spEncore">Une autre surprise</button>'+
        '<button class="act" id="spFiche">Voir la fiche</button>'+
      '</div>'+
      '<div class="trajet" id="trajet" hidden></div>'
    );
    $("#spAller").onclick  = ()=>afficherTrajet(l);
    $("#spEncore").onclick = ()=>{ mettreAJourProfil("ignore", l.cat); surprendre(); };
    $("#spFiche").onclick  = ()=>pousserEcran(()=>ouvrirDetail(l.id));
  });
}

/* « Autour IA » : aucune génération, aucun résultat inventé. La phrase est
   traduite en intention structurée par `comprendre.js`, puis en filtres
   existants — cuisine, catégorie, budget, créneau — et c'est l'app qui fait
   le reste.

   Cette fonction garde la forme que tout le code attend d'elle
   (`{cats, filtres, creneau, cuisine, dit}`) et y ajoute `structure` :
   l'intention complète, avec sa séparation entre contraintes et préférences.
   L'ancienne version reconnaissait une douzaine de mots par expressions
   régulières et perdait le montant d'un budget en route — « moins de 30
   euros » posait le filtre « gratuit ». */

/* Correspondance entre les signaux de l'ontologie et les filtres humains qui
   existaient déjà. Un seul endroit, pour que les deux ne divergent pas. */
const FILTRE_DU_SIGNAL = Object.freeze({
  travail:"etudier", etude:"etudier", calme:"etudier",
  famille:"famille", accessible:"pmr",
  adapte_groupes:"monde", festif:"monde",
  pas_cher:"budget",
});

function interpreter(phrase){
  const act = {cats:null, filtres:new Set(), creneau:null, cuisine:null, dit:[], structure:null};
  if(!COMPRENDRE) return act;

  const st = COMPRENDRE.analyser(phrase, {
    cuisineDe: cuisineRecherchee,
    categorieDe: categorieRecherchee,
    libelleCategorie: (c)=>(CATS[c]||{}).label || c,
  });
  act.structure = st;
  act.cuisine = st.cuisine;

  const cats = new Set(st.categories);
  /* Une cuisine sans catégorie laissait le champ des catégories VIDE : on ne
     cherchait donc plus des restaurants du tout, seulement des fiches dont le
     tag cuisine correspond. Or ce tag est renseigné sur une minorité de lieux
     dans OpenStreetMap — d'où des écrans vides là où le quartier est plein de
     restaurants. Une cuisine désigne d'abord un endroit où manger. */
  if(st.cuisine) CATS_MANGER.forEach(c=>cats.add(c));
  if(cats.size) act.cats = cats;

  // les filtres humains restent la mécanique d'affichage : on y traduit ce
  // que l'intention a compris, sans perdre le détail (il vit dans `structure`)
  st.ambiance.forEach(a=>{ const f = FILTRE_DU_SIGNAL[a.id]; if(f) act.filtres.add(f); });
  st.contraintes.forEach(c=>{
    if(c.type === "signal"){ const f = FILTRE_DU_SIGNAL[c.id]; if(f) act.filtres.add(f); }
  });
  /* Le budget ne passe PLUS par les filtres humains. Leur test est binaire
     (`l.prixN != null && l.prixN <= 1`) : un lieu dont on ignore le prix y
     échoue, si bien que « manger pour moins de 15 € » rendait un écran vide.
     La contrainte structurée, elle, n'exclut que ce qu'on sait trop cher. */
  if(st.preferences.some(p=>p.type === "proche")) act.filtres.add("proche");
  if(st.groupe === "famille") act.filtres.add("famille");

  act.creneau = st.horaire.creneau;
  act.dit = st.chips.filter(c=>c.type !== "zone").map(c=>c.label);
  /* Ce que personne n'a compris : on le compte, localement, pour savoir quels
     synonymes ajouter. Seul le résidu est noté — jamais la phrase.

     Et jamais en mode Aide : « j'ai plus assez pour manger » décrit une
     situation personnelle, pas une requête à optimiser. Le besoin normalisé
     (`alimentation`) suffit à faire le travail, et il ne s'écrit nulle part. */
  if(st.reste && !modeAide) COMPRENDRE.noterReste(st.reste);
  return act;
}

function appliquerPhrase(phrase){
  mettreAJourProfil("recherche", phrase);
  const ville = villeRecherchee(phrase);
  if(ville){ rechercherAilleurs(phrase, ville); return; }
  const a = interpreter(phrase);
  // l'intention structurée voyage jusqu'au classement ET jusqu'aux puces
  intentionCourante = a.structure;
  if(!a.dit.length){
    intentionCourante = null;
    ouvrirResultats(phrase);            // rien de compris : recherche classique
    return;
  }
  catsActives = a.cats;
  filtresHumains = a.filtres;
  if(a.creneau){ creneau = a.creneau; filtreMaintenant = true; }
  filtreActif = "tout";
  selectionAccueil = false;
  dessinerFiltres(); majFiltres(); rendre();

  if(a.cuisine){
    /* La cuisine TRIE, elle n'exclut pas. Filtrer strictement dessus ne
       laissait que les fiches dont OpenStreetMap connaît le tag — une
       minorité — et « restaurant indien » rendait un écran vide au milieu
       d'un quartier plein de restaurants. On montre donc tous les endroits où
       manger, en plaçant devant ceux dont la cuisine correspond. */
    const manger = lieux.filter(l=>[...a.cats].some(c=>correspondCategorie(l,c)));
    const correspond = l=>{
      const c = sansAccents(l.cuisine||"");
      return !!c && (c.includes(a.cuisine) || a.cuisine.includes(c));
    };
    const classes = classerLieux(manger, false);
    const trouves = [...classes.filter(correspond), ...classes.filter(l=>!correspond(l))];
    pileEcrans = [];
    pousserEcran(()=>afficherListe("🍽️", "« "+phrase+" »",
      trouves, false, ()=>appliquerPhrase(phrase)));
    toast("Compris : "+a.dit.join(" · "));
    return;
  }

  /* Et surtout : montrer le résultat. La fonction posait les filtres, dessinait
     la carte et affichait un toast — mais laissait la feuille sur ce qu'elle
     contenait avant la recherche. Les catégories demandées sont aussi allées
     chercher : « où bosser » ne peut pas trouver de bibliothèque si aucune
     n'a été chargée. */
  if(catsActives && catsActives.size) chargerPourCats([...catsActives]);
  /* `ouvrirAccueilFeuille` remet les catégories à zéro — c'est ce qu'on veut
     quand on revient à l'accueil, pas après une recherche qui vient justement
     d'en poser. On ouvre donc la feuille sans effacer ce qu'on a compris. */
  const garde = catsActives;
  ouvrirAccueilFeuille();
  catsActives = garde;
  rendre();
  majFeuille2();
  toast("Compris : "+a.dit.join(" · "));
}

function toutAfficher(){
  selectionAccueil = false;
  rendre();
}

/* Ce que l'accueil garde. Sept recommandations au maximum, mais surtout : aucune
   ligne de remplissage. Une proposition qui ne passe pas la barre est une
   proposition en moins, pas une proposition médiocre de plus. */
const ACCUEIL_MAX = 7;
const ACCUEIL_SEUIL = 55;

function majAccueil(){
  const debutCpu = performance.now();
  /* La carte n'est plus une condition. Elle vient d'un CDN, elle peut manquer
     ou arriver en retard ; les recommandations, elles, ne dépendent que des
     lieux et de la position. Les faire attendre Leaflet rendait l'application
     entièrement vide quand le CDN toussait. */
  majBadgeMaintenant();
  if(!centreDonnees() || modeNav){ PERF.travail("accueil", debutCpu); return; }
  if(selectionAccueil === false){ PERF.travail("accueil", debutCpu); return; }
  const ctx = contexteActuel();
  /* Le point de référence est celui du classement — soi, ou la zone qu'on est
     parti voir. Chercher « Paris » depuis Tourcoing déplaçait bien la carte,
     mais les recommandations restaient calculées autour de Tourcoing : à
     250 km, plus rien ne passait le rayon, et la carte de Paris n'affichait
     qu'un ou deux marqueurs restés de l'ancienne zone. */
  const [lat,lng] = ctx.moi;

  // en mode Aide on accepte d'aller plus loin : cinq kilomètres pour un
  // hébergement d'urgence, ce n'est pas la même chose que pour un café
  const rayon = modeAide ? 6000 : 2500;
  let debutEtape = performance.now();
  const visiblesAccueil = visibles();
  PERF.travail("accueil:visibles", debutEtape);
  debutEtape = performance.now();
  let notes = visiblesAccueil
    .filter(l=>nomExploitable(l) && proposableAuto(l, ctx));
  PERF.travail("accueil:filtrage", debutEtape);
  debutEtape = performance.now();
  notes = notes
    .map(l=>Object.assign({}, l, {dist:distanceM(lat,lng,l.lat,l.lng)}))
    .filter(l=>l.dist < rayon)
    .map(l=>{ const r = scoreLieu(l, ctx); return Object.assign(l, {score:r.score, raison:r.raison}); })
    .sort((a,b)=>b.score - a.score);
  PERF.travail("accueil:classement", debutEtape);
  if(modeAide && !montrerFermes)
    notes = ecarterFermesSiAlternative(notes.map(l=>({l}))).map(x=>x.l);
  /* La réserve du jeu rapide : les meilleurs candidats du quartier, seuil
     compris. Elle est prise AVANT le filtre du seuil — au prochain démarrage,
     l'heure aura changé et un lieu écarté ce soir peut très bien être le bon
     demain matin. */
  const reserve = notes.slice(0, RAPIDE_MAX);

  /* Ce qu'on vient de publier passe devant tout le reste : c'est la seule
     chose à l'écran dont on sait avec certitude qu'elle intéresse la personne
     qui regarde — elle vient de l'écrire. */
  const choisis = [];
  const epingles = idsEpingles();
  if(epingles.length){
    const vus = new Set();
    epingles.forEach(id=>{
      if(vus.has(id) || choisis.length >= ACCUEIL_MAX) return;
      // la version classée si elle existe (elle porte le trajet et l'horaire),
      // sinon l'objet brut — mais dans tous les cas, à l'écran
      const l = notes.find(x=>x.id === id) || lieux.find(x=>x.id === id);
      if(!l) return;
      vus.add(id); choisis.push(l);
    });
    notes = notes.filter(l=>!vus.has(l.id));
  }
  if(modeAide){
    // couvrir les besoins plutôt que trôner cinq banques alimentaires : un
    // seul lieu par catégorie, le meilleur. Et pas de seuil — si le seul
    // hébergement du secteur est fermé, il doit quand même s'afficher, sinon
    // quelqu'un qui cherche où dormir ne voit rien du tout.
    const vues = new Set();
    notes.forEach(l=>{
      if(choisis.length >= ACCUEIL_MAX || vues.has(l.cat)) return;
      vues.add(l.cat); choisis.push(l);
    });
    notes.forEach(l=>{ if(choisis.length < ACCUEIL_MAX && !choisis.includes(l)) choisis.push(l); });
  }else{
    notes = notes.filter(l=>l.score >= ACCUEIL_SEUIL);
    // on réserve une place à un événement s'il en existe un : sans ça, les
    // commerces bien notés rafleraient toutes les lignes et l'app perdrait
    // exactement ce qui la distingue
    const ev = notes.find(l=>estTemporaire(l));
    if(ev) choisis.push(ev);
    notes.forEach(l=>{ if(choisis.length < ACCUEIL_MAX && !choisis.includes(l)) choisis.push(l); });
  }

  /* La feuille et la carte doivent raconter exactement la même sélection.
     Le moteur commun écarte les événements terminés et les lieux fermés quand
     leurs horaires le disent, puis impose l'ordre temporel des événements.
     L'ancien score historique reste utile pour le jeu rapide, mais ne décide
     plus seul des marqueurs de « Pour toi, maintenant ». */
  if(!modeAide && creneau === "maintenant"){
    /* LE CLASSEMENT COMPLET NE BLOQUE PLUS LE FIL.

       C'est le second appel à `recommandationsAccueil` — celui qui décide des
       marqueurs — et le profil l'a mesuré à 1 169 ms pour le pire. Il vivait
       ici, en plein milieu du rendu, si bien que « Maintenant » ne pouvait pas
       s'afficher tant qu'il n'était pas terminé, alors qu'il n'en dépend pas.

       On garde donc le choix précédent — celui du score historique, déjà
       calculé juste au-dessus — puis on affine pendant une tranche
       d'inactivité. La sélection finale est exactement la même ; seul le
       moment où elle arrive change, et entre les deux la carte reste vivante.

       Le jeton est celui de l'accueil : si la zone change entre-temps, ce
       travail ne s'exécute jamais plutôt que d'imposer les marqueurs d'une
       ville qu'on a quittée. */
    const jetonCarte = ++generationAccueil;
    if(annulerPourToiDifferee){ annulerPourToiDifferee(); annulerPourToiDifferee = null; }
    const affiner = ()=>{
      const debutAffinage = performance.now();
      if(jetonCarte !== generationAccueil) return;
      const pourToi = recommandationsAccueil(ACCUEIL_MAX);
      if(!pourToi.length || jetonCarte !== generationAccueil){
        PERF.travail("classement_differe", debutAffinage); return;
      }
      const ids = pourToi.slice(0,ACCUEIL_MAX).map(l=>l.id);
      // rien n'a changé : on ne redessine pas pour un résultat identique
      if(ids.join("|") === (selectionAccueil || []).join("|")){
        PERF.travail("classement_differe", debutAffinage); return;
      }
      selectionAccueil = ids;
      PERF.jalon("selection_affinee");
      rendre();
      if(feuilleNiveau !== null) majFeuille2();
      PERF.travail("classement_differe", debutAffinage);
    };
    annulerPourToiDifferee = ORDO
      ? ORDO.differer(affiner, {timeout:400, valide:()=>jetonCarte === generationAccueil})
      : (affiner(), null);
  }

  selectionAccueil = choisis.map(l=>l.id);
  if(choisis.length) PERF.jalon("scoring_fait");
  // ce qu'on vient de choisir servira au prochain démarrage : c'est la seule
  // façon d'avoir des propositions réelles à l'image suivant l'ouverture
  memoriserJeuRapide(choisis, reserve);

  // le rendu appartient à la feuille : ici on ne fait que choisir
  if(renduEnLot){ PERF.travail("accueil", debutCpu); return; }
  if(feuilleNiveau !== null) majFeuille2();
  rendre();
  PERF.travail("accueil", debutCpu);
}

/* Le nom est conservé : plusieurs endroits l'appellent après une publication
   ou une suppression. Il n'y a plus de piste de filtres à dessiner : les
   quatre raccourcis et la feuille disent déjà où on en est. */
function dessinerFiltres(){ majRaccourcis(); }

/* On ne demande plus la permission avant de construire quoi que ce soit :
   la carte s'affiche tout de suite à la dernière position connue, et glisse
   vers l'utilisateur dès que la géolocalisation répond. Un refus ou un échec
   laisse une application parfaitement utilisable. */
/* Ce que fait une mesure du navigateur quand elle arrive. Écrit une fois, et
   utilisé par les deux chemins : la demande explicite (bouton, démarrage) et
   la veille continue. `discret` distingue les deux — une veille qui recentre
   la carte pendant qu'on la fait glisser du doigt serait insupportable. */
function appliquerPosition(p, opts){
  const o = opts || {};
  const c = [p.coords.latitude, p.coords.longitude];
  const destinationAvant = destinationActive();
  noterAutorisationGeo(true);
  memoriserPosition(c, "gps");

  /* Le GPS REMPLACE tout ce qui précède, il ne le complète pas. Venir
     d'une ville déduite d'une adresse IP et arriver sur le vrai point,
     c'est potentiellement un saut de plusieurs dizaines de kilomètres :
     la ville, les distances, les temps de trajet, les recommandations et
     la carte doivent tous être refaits, pas seulement rafraîchis. */
  const venaitDeLApproximation = positionApprochee();
  const premiereFois = !positionConnue();
  // le régime AVANT que cette mesure ne change la donne
  const regimeAvant = regimeZone(rechercheGeo);
  const bouge = premiereFois || venaitDeLApproximation || !positionMoi
    || distanceM(positionMoi[0],positionMoi[1],c[0],c[1]) > 150;
  if(bouge && !destinationAvant){
    annulerGeneration("demarrage");
    annulerGeneration("zone:precalculee");
  }
  positionMoi = c;
  originePosition = "gps";
  precisionPosition = "point";     // désormais on peut parler en minutes
  /* La zone active suit la position UNIQUEMENT quand c'est elle qu'on regarde.
     Explorer Lille et recevoir une mesure GPS de Tourcoing ne doit rien
     changer à ce qui s'affiche : c'est le point bleu qui bouge, pas la zone. */
  if(bouge && CTX && (!zoneActive || zoneActive.type === CTX.TYPES.MOI))
    definirZoneActive(CTX.zoneMoi(c, commune));

  $("#bandeauGeo").hidden = true;
  if(venaitDeLApproximation){
    // tout ce qui avait été déduit de l'IP est faux jusqu'à preuve du
    // contraire : on efface, on ne corrige pas
    villeDetectee = null;
    commune = "ton quartier";
    $("#hdVille").textContent = "Autour de toi";
  }
  majEnteteLieu();
  detecterVille(c[0], c[1]);
  if(moi) moi.setLatLng(c);          // la pastille bleue suit toujours, elle
  /* La carte ne se recentre que si on l'a demandé. Pendant une veille, elle
     appartient à la personne qui la regarde. */
  if(bouge && !o.discret) allerVers(c, 16, {duration:.9});
  planifierRendu({accueil:true, carte:true, feuille:true, filtres:true});

  if(bouge && !destinationAvant){
    // le quartier réel se charge — court délai : on est encore au
    // démarrage, et l'écran montre déjà quelque chose
    chargerZone(c[0], c[1], {delai:OVERPASS_DELAI_BOOT});
    chargerDonneesTemporaires(c[0], c[1]);
    /* Le GPS peut répondre avant Leaflet. `chargerZone` sait alors attendre
       sans carte, mais l'ancien chemin de démarrage quittait la zone avant
       de lancer Google/DATAtourisme/Supabase : les événements arrivaient,
       les lieux permanents non. Rejouer le démarrage après la peinture garde
       le premier écran tactile rapide et garantit toutes les sources. */
    if(!map) apresPeinture(()=>chargerLeDemarrage(null));
    // le nom de commune n'est redemandé que si on a réellement changé de
    // coin : deux appels au démarrage pour la même ville, c'est un de trop
    if(venaitDeLApproximation ||
       distanceM(c[0],c[1], dernierNom[0], dernierNom[1]) > 2000){
      dernierNom = c;
      const generationCommune = nouvelleGeneration("contexte:commune",c[0].toFixed(2)+","+c[1].toFixed(2),true);
      nomCommune(c[0],c[1]).then(n=>{
        if(generationCourante(generationCommune) && n) commune = n;
      }).finally(()=>terminerGeneration(generationCommune));
    }
  }
  /* ARRIVER DANS LA VILLE QU'ON REGARDAIT.
     On consultait Lille depuis Tourcoing : cinq propositions, une requête
     légère. Si le GPS dit maintenant qu'on y est, la promesse doit être
     tenue sans que personne n'ait rien à faire — l'aperçu devient la
     découverte, et cette fois on interroge le quartier pour de bon. */
  if(regimeAvant !== "local" && regimeZone(rechercheGeo) === "local"){
    journal.info("Arrivée dans la zone regardée : passage en mode local");
    chargerZone(rechercheGeo.lat, rechercheGeo.lng,
      {force:true, reglages:REGIMES.local});
    planifierRendu({accueil:true, feuille:true, carte:true});
    toast("Tu es à "+rechercheGeo.nom+" · voici ce qu’il y a vraiment autour");
  }
  // on ne le dit qu'au premier coup, et seulement si l'écran ne savait pas
  // vraiment où l'on est : sinon c'est une notification pour rien
  else if(!o.discret && (premiereFois || venaitDeLApproximation))
    toast("Position trouvée · autour de toi");
  definirEtatRecherche("location",SEARCH_STATES.SUCCESS);
}

/* ---- La veille ------------------------------------------------------------
   Il n'y avait qu'un seul appel de géolocalisation, à la demande, et il
   acceptait un relevé vieux de DEUX MINUTES. Deux conséquences, et la seconde
   est la pire : une position obtenue au démarrage n'était plus jamais mise à
   jour. Traverser la ville, entrer dans celle qu'on regardait, sortir du
   quartier — Autour ne s'en apercevait pas. Il fallait penser à appuyer sur un
   bouton pour que l'application redevienne juste, ce qui est exactement
   l'inverse de ce qu'elle promet.

   On veille donc en continu, tant que l'écran est allumé et regardé. La veille
   s'arrête dès que l'onglet passe en arrière-plan : suivre quelqu'un qui ne
   nous regarde pas coûterait sa batterie pour rien. */
const VEILLE_MIN_M = 120;        // en deçà, c'est du bruit de capteur
const VEILLE_MIN_MS = 20000;     // et on ne refait pas le quartier plus souvent
let veilleId = null;
let dernierePriseEnCompte = 0;

function veillerSurLaPosition(){
  if(veilleId !== null) return;
  if(!navigator.geolocation || !navigator.geolocation.watchPosition) return;
  if(document.visibilityState === "hidden") return;
  try{
    veilleId = navigator.geolocation.watchPosition(
      p=>{
        const c = [p.coords.latitude, p.coords.longitude];
        const d = positionMoi
          ? distanceM(positionMoi[0], positionMoi[1], c[0], c[1]) : Infinity;
        /* Franchir la limite d'un régime prime sur tout le reste : c'est
           précisément l'instant qu'on attendait, et le faire attendre vingt
           secondes de plus serait reproduire le défaut qu'on corrige. */
        const bascule = regimeZone(rechercheGeo, c, true) !== regimeZone(rechercheGeo);
        if(!bascule){
          if(d < VEILLE_MIN_M) return;
          if(Date.now() - dernierePriseEnCompte < VEILLE_MIN_MS) return;
        }
        dernierePriseEnCompte = Date.now();
        appliquerPosition(p, {discret:true});
      },
      ()=>{ /* une veille qui échoue n'est pas un refus : on garde ce qu'on a */ },
      {enableHighAccuracy:true, maximumAge:0, timeout:20000}
    );
  }catch(e){ console.error("Autour · veille de position :", e); }
}

function arreterLaVeille(){
  if(veilleId === null) return;
  try{ navigator.geolocation.clearWatch(veilleId); }catch(e){}
  veilleId = null;
}

document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "hidden"){ arreterLaVeille(); return; }
  /* Au retour, on ne se contente pas de reprendre la veille : entre-temps la
     personne a pu faire dix kilomètres, et le premier relevé de la veille peut
     tarder. On redemande donc tout de suite. */
  if(geoDejaAutorisee()){ veillerSurLaPosition(); suivreMaPosition({silencieux:true}); }
});

/* LA BATTERIE ET LES COMPTEURS NE SONT PAS LA MÊME QUESTION, ET N'ONT DONC PAS
   LE MÊME ÉCOUTEUR. Celui du dessus décide de suivre ou non quelqu'un ; celui
   ci-dessous ne fait que rendre des entiers avant que l'onglet ne parte, et
   réévaluer au retour. Les mêler ferait dépendre l'un des priorités de
   l'autre. */
document.addEventListener("visibilitychange", ()=>{
  if(document.visibilityState === "hidden"){
    /* Partir est le bon moment : ce sont des entiers, ils ne pèsent rien, et
       ils n'ont jamais eu le droit de peser sur un rendu. */
    envoyerMetriquesTerritoriales();
    /* Et recalculer pour un écran que personne ne regarde coûterait une
       batterie pour rien. */
    reglerBattementTerritorial();
    return;
  }
  /* Le retour au premier plan APRÈS UNE ABSENCE SUFFISANTE réévalue : « en
     cours » a pu devenir « terminé » pendant qu'on regardait ailleurs. Cinq
     minutes est le seuil ; en deçà, rien ne bouge. */
  reevaluerTerritorial({retourPremierPlan:true});
  reglerBattementTerritorial();
});

let localisationEnCours = false;

function suivreMaPosition(opts){
  const o = opts || {};
  if(!navigator.geolocation){
    definirEtatRecherche("location",SEARCH_STATES.LOCATION_DENIED);
    if(o.onboarding || o.reproposer) terminerOnboardingLocalisation("refus");
    else etat("Choisis un endroit sur la carte : ce navigateur ne sait pas te localiser.", true);
    return;
  }
  // Le démarrage, le bouton et le retour au premier plan peuvent se croiser.
  // Une seule demande navigateur à la fois évite les réponses dans le désordre.
  if(localisationEnCours) return;
  localisationEnCours = true;
  if(o.onboarding || o.reproposer) afficherOnboarding("preparation");
  definirEtatRecherche("location",SEARCH_STATES.REQUESTING_LOCATION);
  PERF.jalon("geolocation_demandee");
  navigator.geolocation.getCurrentPosition(
    p=>{
      localisationEnCours = false;
      PERF.jalon("geolocation_ready");
      PERF.mesure("géolocalisation", "geolocation_demandee", "geolocation_ready");
      appliquerPosition(p, {discret: !!o.silencieux || !!o.onboarding || !!o.reproposer});
      if(o.onboarding || o.reproposer) terminerOnboardingLocalisation("ok");
      // une fois la permission acquise, on ne la redemande plus : on veille
      veillerSurLaPosition();
    },
    (err)=>{
      localisationEnCours = false;
      // un refus efface l'autorisation mémorisée : on ne relancera plus d'office
      if(err && err.code === 1) noterAutorisationGeo(false);
      definirEtatRecherche("location",SEARCH_STATES.LOCATION_DENIED);
      if(o.onboarding || o.reproposer) terminerOnboardingLocalisation("refus");
      else if(!o.silencieux) proposerPosition();
    },
    /* Trente secondes, pas deux minutes. Un relevé récent rend la réponse
       instantanée — c'est tout l'intérêt du cache — mais au-delà d'une demi-
       minute il décrit un endroit où l'on n'est peut-être plus. La veille
       prend le relais derrière, avec `maximumAge:0`. */
    {enableHighAccuracy:true, timeout:8000, maximumAge:30000}
  );
}

/* Le bandeau qui propose la localisation. Il dit ce qu'on sait — et surtout ce
   qu'on ne sait pas. Une zone déduite d'une adresse IP n'est pas « ton
   quartier » : c'est une approximation à plusieurs kilomètres, et le dire est
   la seule façon de donner envie de la corriger. */
function proposerPosition(){
  etat(positionApprochee()
    ? "Zone approximative · active ta position pour être précis."
    : positionConnue()
      ? "Position indisponible · on garde ton dernier quartier."
      : "Active ta position ou choisis un endroit sur la carte.", true);
}

/* La demande ne part qu'après le geste d'onboarding. Une autorisation déjà
   obtenue peut ensuite être rafraîchie silencieusement, mais un premier écran
   ou un refus ne relance jamais la permission tout seul. */
async function demarrerLocalisation(){
  etapeOnboarding = lireEtapeOnboarding();
  if(etapeOnboarding !== ETAPES_ONBOARDING.TERMINE){
    afficherOnboarding(etapeOnboarding === ETAPES_ONBOARDING.LOCALISATION
      ? "localisation" : "bienvenue");
    return;
  }
  const etatPerm = await permissionPosition();
  PERF.jalon("permission_" + etatPerm);
  if(etatPerm === "granted") suivreMaPosition({silencieux:true});
}

function lancerOnboardingLocalisation(){
  memoriserEtapeOnboarding(ETAPES_ONBOARDING.LOCALISATION);
  afficherOnboarding("localisation");
  /* Laisser une peinture passer rend la transition perceptible, puis réutilise
     exactement la même porte `suivreMaPosition` que les autres gestes. */
  requestAnimationFrame(()=>suivreMaPosition({onboarding:true}));
}

$("#onboardingAction").onclick=()=>{
  if(etapeOnboarding === ETAPES_ONBOARDING.LOCALISATION){
    suivreMaPosition({onboarding:true});
    return;
  }
  lancerOnboardingLocalisation();
};
$("#bandeauOk").onclick=()=>{ $("#bandeauGeo").hidden = true; suivreMaPosition({reproposer:true}); };
$("#bandeauOk").textContent = "Utiliser ma position";
$("#videOk").onclick=()=>{
  $("#bandeauVide").hidden = true;
  if($("#videOk").dataset.action === "retry"){
    const centre=pointCarte();
    rechercheEtat.overpass=SEARCH_STATES.IDLE;
    chargerAutourDuPoint(centre.lat,centre.lng,{force:true});
    return;
  }
  montrerFermes = true;
  toast("Les lieux fermés sont affichés"); rendre();
};

/* Démarrage immédiat : l'interface s'affiche sans attendre l'onboarding ni la
   permission. La demande navigateur reste un geste explicite ; une permission
   déjà accordée peut seulement être rafraîchie ensuite en silence. */
performance.mark("autour:script");
PERF.jalon("script");
/* `demarrer()` peut appeler majEnteteLieu immédiatement en mode de test : ce
   vocabulaire doit donc exister avant le premier démarrage, pas seulement plus
   bas avec les gestionnaires de navigation. */
const ETIQUETTES_LIEU = ["Choisir un endroit", "Zone approximative", "Autour de toi"];
const positionTest = positionLocaleDeTest();
demarrer(positionTest || positionMemorisee());
if(!positionTest) demarrerLocalisation();
PERF.mesure("boot UI", "script", "ui_ready");
/* La recherche est désormais toujours visible : elle porte l'intention
   («&nbsp;que veux-tu faire&nbsp;?»), elle ne se déplie plus. La croix
   n'apparaît que s'il y a quelque chose à effacer. */
/* La recherche n'occupe plus l'écran en permanence : elle s'ouvre à la loupe
   et se referme entièrement, rendant la carte à l'utilisateur. */
function ouvrirRecherche(){
  $("#rechercheOverlay").hidden = false;
  $("#appHeader").hidden = true;
  majRaccourcis();
  layerManager.activate(NOMS_COUCHES.searchOverlay);
  requestAnimationFrame(()=>$("#rech").focus());
}
function fermerRecherche(options){
  const force = !!(options && options.force);
  const dockee = !force && rechercheDockeeDesktopDemandee();
  $("#rechercheOverlay").hidden = !dockee;
  $("#appHeader").hidden = dockee;
  $("#suggestions").hidden = true;
  layerManager.deactivate(NOMS_COUCHES.searchOverlay);
}

/* Le grand bloc de recherche de l'état catégorie est le même formulaire que
   la loupe de l'accueil. Il apparaît sans voler le focus, reste branché aux
   suggestions et filtres, puis redevient une superposition sur téléphone. */
function synchroniserRechercheDesktop(){
  const overlay = $("#rechercheOverlay");
  const header = $("#appHeader");
  if(!overlay || !header) return;
  const etaitDockee = overlay.classList.contains("recherche-dockee");
  const dockee = rechercheDockeeDesktopDemandee();
  overlay.classList.toggle("recherche-dockee", dockee);
  if(dockee){
    overlay.hidden = false;
    header.hidden = true;
    majRaccourcis();
    return;
  }
  if(etaitDockee){
    overlay.hidden = true;
    header.hidden = false;
    $("#suggestions").hidden = true;
    layerManager.deactivate(NOMS_COUCHES.searchOverlay);
  }
}
responsiveLayout.subscribe(()=>synchroniserRechercheDesktop());
$("#btnLoupe").onclick = ouvrirRecherche;

/* ---- Pour toi : la cloche l'ouvre, la taille d'écran décide de sa forme --
   Sur grand écran c'est une colonne du décor ; sur mobile un tiroir. Le même
   panneau dans les deux cas — il n'y a pas deux écrans à maintenir. */
if($("#btnNotifs")) $("#btnNotifs").onclick = basculerPourToi;
if($("#ptFermer")) $("#ptFermer").onclick = fermerPourToi;

/* ---- Sortir du panneau : trois gestes, un seul comportement --------------

   Il n'y en avait qu'un et il était caché : la cloche, qu'il fallait deviner.
   Sur la colonne de bureau, le ✕ était même masqué à dessein — le panneau
   faisait partie du décor, donc on ne le fermait pas. Sauf qu'on veut le
   fermer, et que « Gérer » n'est pas une sortie : il ouvre les surveillances,
   c'est tout ce qu'il a jamais fait, et ce n'est pas à lui de porter ça.

   LE CLIC EN DEHORS SE LIT AU `pointerdown`, PAS AU `click`. Un `click` sur la
   carte arrive après que Leaflet a déjà réagi ; le `pointerdown` ferme avant,
   et c'est ce qu'on attend d'un panneau posé par-dessus.

   LA CLOCHE EST EXPLICITEMENT EXCLUE. Elle est « en dehors » du panneau : sans
   cette exception, un appui dessus fermerait au `pointerdown` puis rouvrirait
   au `click`, et le panneau clignoterait au lieu de basculer. */
document.addEventListener("pointerdown", (e)=>{
  if(!pourToiOuvert()) return;
  const p = $("#pourToi");
  if(!p || p.contains(e.target)) return;
  const cloche = $("#btnNotifs");
  if(cloche && cloche.contains(e.target)) return;   // c'est la bascule, pas un dehors
  fermerPourToi();
});

function accorderPourToiALEcran(){
  poserBesoinsRapides();
  const p = $("#pourToi");
  if(!p) return;
  if(NAV_FLOTTANTE.matches){
    /* La colonne fait partie de la composition : elle est là d'emblée. */
    p.hidden = false;
    document.body.classList.add("pourtoi-ouvert");
  }else{
    p.hidden = true;
    document.body.classList.remove("pourtoi-ouvert");
  }
  majPourToi();
}

if(NAV_FLOTTANTE.addEventListener) NAV_FLOTTANTE.addEventListener("change", accorderPourToiALEcran);
else if(NAV_FLOTTANTE.addListener) NAV_FLOTTANTE.addListener(accorderPourToiALEcran);

/* Le panneau est une information SECONDAIRE : il attend que le chemin
   critique ait rendu la main. Il ne déclenche aucune requête — il relit les
   événements déjà chargés — donc l'attendre ne coûte rien à personne. */
function amorcerPourToi(){
  const poser = ()=>accorderPourToiALEcran();
  if(ORDO) ORDO.differer(poser, {timeout:1200});
  else setTimeout(poser, 400);
}
$("#btnFermerRech").onclick=()=>{
  $("#rech").value=""; recherche=""; $("#suggestions").hidden=true;
  fermerRecherche(); rendre(); majAccueil();
};

/* Les filtres humains vivaient dans un rail flottant que rien n'annonçait :
   ils ont maintenant un bouton dédié dans l'en-tête. */
$("#btnFiltres").onclick=()=>{
  const z = $("#filtresHumains");
  const ouvert = !z.hidden && z.dataset.force === "1";
  z.dataset.force = ouvert ? "" : "1";
  $("#btnFiltres").setAttribute("aria-expanded", ouvert ? "false" : "true");
  majFiltres();
};

/* Attribution repliée : obligatoire mais discrète. */
$("#btnCredits").onclick=()=>{
  const c = $("#credits");
  c.hidden = !c.hidden;
  $("#btnCredits").setAttribute("aria-expanded", String(!c.hidden));
};

/* Mesure réelle de l'en-tête et de la barre du bas : leurs hauteurs dépendent
   de la safe area, de la taille de police système et du retour à la ligne des
   pills. Les deviner faisait chevaucher la fiche compacte et la navigation. */
/* Les hauteurs réelles sont republiées en variables CSS : deviner 58px pour
   une barre qui en fait 70 décalait tout ce qui s'y accroche.
   Sur desktop la navigation flotte au-dessus de la carte : sa hauteur ne doit
   réserver aucune place (--nav-height:0), mais reste utile pour poser ce qui
   se range juste au-dessus d'elle (--nav-flottante). Sans cette distinction,
   la mesure en ligne l'emportait sur la règle du media query et la carte se
   retrouvait rognée par le bas. NAV_FLOTTANTE est déclaré en haut du script. */
function mesurerHeader(){
  const h = $("#appHeader");
  if(h && !h.hidden){
    document.documentElement.style.setProperty("--header-height", h.offsetHeight+"px");
    document.documentElement.style.setProperty("--header-bas",
      Math.round(h.getBoundingClientRect().bottom)+"px");
  }
  const n = $("#navBas");
  if(n && !n.hidden){
    const haut = n.offsetHeight;
    document.documentElement.style.setProperty("--nav-flottante", haut+"px");
    document.documentElement.style.setProperty("--nav-height",
      NAV_FLOTTANTE.matches ? "0px" : haut+"px");
  }
}
NAV_FLOTTANTE.addEventListener("change", mesurerHeader);
addEventListener("resize", mesurerHeader);
if(window.ResizeObserver){
  const observateur = new ResizeObserver(mesurerHeader);
  if($("#appHeader")) observateur.observe($("#appHeader"));
  if($("#navBas")) observateur.observe($("#navBas"));
}
/* Suggestions puisées dans l'index déjà construit et dans les lieux déjà
   chargés : aucune requête, donc aucun effet sur le temps de chargement. */
function suggerer(q){
  const z = $("#suggestions");
  if(!z) return;
  const t = sansAccents(q).trim();

  // rien de tapé : on propose ce qui correspond à l'heure qu'il est
  if(!t){
    z.innerHTML = rangeeSuggestions();
    brancherSuggestions(z);
    z.hidden = false;
    layerManager.activate(NOMS_COUCHES.searchOverlay);
    return;
  }

  const vus = new Set(), sug = [];

  /* Destination ou intention ? « Lille » et « cinéma » ne demandent pas la
     même chose, et rien ne le disait : la liste ne proposait que des
     catégories et des lieux déjà chargés, si bien qu'en tapant un nom de
     commune on ne voyait aucune façon d'y aller.
     On ne DÉCIDE pas ici que « Lille » est une ville — on le propose, et c'est
     le géocodeur qui tranchera au moment de valider. */
  const decoupe = parseSearchQuery(q, DECOUPAGE);
  const dest = decoupe.destination;
  if(dest && ressembleAUneZone(dest)){
    sug.push({emo:"📍", lab:dest, sous:"destination", texte:dest});
    vus.add(dest);
    if(decoupe.intention){
      // requête déjà composée : on la reprend telle quelle, explicitée
      const compose = decoupe.intention+" à "+dest;
      sug.push({emo:"🧭", lab:compose, sous:"intention · destination", texte:compose});
      vus.add(compose);
    }else{
      // sinon on montre CE QU'ON PEUT y chercher, avec les intentions réelles
      // de l'application — pas des exemples inventés
      SUGGESTIONS_INTENTION.forEach(b=>{
        const compose = b.label+" à "+dest;
        sug.push({emo:b.emoji, lab:compose, sous:"intention · destination", texte:compose});
        vus.add(compose);
      });
    }
  }

  for(const [mot,cible] of INDEX_MOTS){
    if(sug.length >= 6) break;
    if(!mot.startsWith(t) && !mot.includes(t)) continue;
    const cat = cible.cat, emo = cat ? (CATS[cat]||{}).emoji : "🍽️";
    const lab = cat ? (CATS[cat]||{}).label : mot;
    if(vus.has(lab)) continue;
    vus.add(lab);
    sug.push({emo, lab, sous: cat ? "catégorie" : "cuisine", q: mot});
  }
  lieux.forEach(l=>{
    if(sug.length >= 10) return;
    if(!sansAccents(l.titre).includes(t) || vus.has(l.titre)) return;
    vus.add(l.titre);
    sug.push({emo:categorieAffichee(l, {}).emoji||"📍", lab:l.titre, sous:"lieu", id:l.id});
  });

  if(!sug.length){ z.hidden = true; layerManager.deactivate(NOMS_COUCHES.searchOverlay); return; }
  z.innerHTML = sug.map((x,i)=>
    '<button class="sg" data-sg="'+i+'"><span class="sg-emo">'+x.emo+'</span>'+
    '<span>'+esc(x.lab)+'</span><span class="sg-sous">'+x.sous+'</span></button>').join("");
  z.querySelectorAll("[data-sg]").forEach(b=>b.onclick=()=>{
    const x = sug[Number(b.dataset.sg)];
    z.hidden = true; layerManager.deactivate(NOMS_COUCHES.searchOverlay); $("#rech").blur();
    if(x.id){ pileEcrans=[]; pousserEcran(()=>ouvrirDetail(x.id)); return; }
    // une suggestion de destination emprunte exactement le même chemin que la
    // touche Retour : un seul comportement à comprendre, un seul à maintenir
    if(x.texte){ $("#rech").value = x.texte; lancerRecherche(); return; }
    appliquerPhrase(x.q);
  });
  z.hidden = false;
  layerManager.activate(NOMS_COUCHES.searchOverlay);
}

let minuteurSug;
$("#rech").onfocus=()=>suggerer($("#rech").value);
let minuteurRenduRecherche;
$("#rech").oninput=e=>{
  recherche = e.target.value;
  if(recherche) toutAfficher();
  /* LES SUGGESTIONS D'ABORD, LES MARQUEURS ENSUITE.

     `rendre()` recompose les marqueurs de la carte : sur un centre-ville c'est
     des centaines d'objets, et c'était fait À CHAQUE LETTRE. Taper huit
     caractères déclenchait huit recompositions complètes, pendant lesquelles
     le clavier ne répond plus — ce qui se vit comme « la recherche est
     longue » alors que rien n'est encore parti sur le réseau.

     Ce que la personne regarde en tapant, ce sont les suggestions, pas la
     carte derrière le clavier. Elles restent donc au rythme de la frappe ; la
     carte, elle, attend une pause. */
  clearTimeout(minuteurSug);
  minuteurSug = setTimeout(()=>suggerer(recherche), 130);
  clearTimeout(minuteurRenduRecherche);
  minuteurRenduRecherche = setTimeout(()=>rendre(), 260);
};
/* Valider la recherche : une seule entrée pour la touche Retour du clavier,
   le bouton « rechercher » d'iOS et un éventuel appui sur la loupe. Le clavier
   se ferme d'abord (blur), sinon il masque la carte qu'on vient de déplacer. */
$("#formRech").addEventListener("submit", e=>{ e.preventDefault(); lancerRecherche(); });

async function lancerRecherche(){
  const champ = $("#rech");
  const q = (champ.value || "").trim();
  if(!q) return;
  champ.blur();                 // referme le clavier avant de bouger la carte
  fermerRecherche({force:true});
  zoneAffichee = null;          // une nouvelle recherche remplace la précédente
  intentionCourante = null;     // et son interprétation avec elle

  // « cinéma Lille », « restaurant Roubaix », « activité enfant Tourcoing » :
  // on sépare avant d'interroger quoi que ce soit
  const {intention, destination} = parseSearchQuery(q, DECOUPAGE);

  // une destination plausible déplace la carte ; l'intention, s'il y en a une,
  // devient le filtre appliqué une fois sur place
  if(destination && ressembleAUneZone(destination)){
    /* UNE RECHERCHE EN REMPLACE UNE AUTRE, Y COMPRIS EN VOL.

       Le géocodeur partait sans possibilité d'annulation : taper une ville,
       se raviser et en taper une autre laissait les deux requêtes courir, et
       c'est la PREMIÈRE ARRIVÉE qui déplaçait la carte. Sur réseau lent, on
       atterrissait donc régulièrement dans la ville qu'on venait d'abandonner.

       La génération « recherche:zone » rend l'abandon automatique : la
       nouvelle recherche avorte la précédente, et une réponse tardive qui ne
       porte plus la génération courante n'est simplement plus regardée. */
    const generation = nouvelleGeneration("recherche:zone", destination, true);
    charge("Recherche de "+destination+"…");
    const trouvee = await rechercheGeographique(destination, generation);
    if(!generationCourante(generation)) return;   // une autre recherche a pris la main
    charge(null);
    terminerGeneration(generation);
    if(trouvee){
      if(intention) appliquerIntention(intention, destination);
      else intentionCourante = null;
      ouvrirResultatsZone(destination, intention);
      return;
    }
    /* Le géocodeur n'a rien trouvé. C'est lui qui fait autorité sur ce qui est
       un lieu : plutôt que de deviner mieux, on relit la requête entière comme
       une demande. « bar à vin » vise ainsi les bars, et non la commune
       imaginaire « vin » que le découpage avait isolée. */
    if(!intention){ toast("Lieu introuvable : "+destination); return; }
  }
  appliquerPhrase(q);        // même compréhension que la barre « Autour IA »
}

/* Une intention reconnue, au-delà des seules catégories. Tolérante par
   construction : elle sert à découper le DÉBUT d'une phrase, où l'on préfère
   reconnaître trop que pas assez. « chiller », « sortir » et « bouger » sont
   des besoins et non des catégories — ils n'étaient reconnus nulle part, si
   bien que « chiller Bordeaux » partait entier au géocodeur.
   « activité enfant » n'est ni l'un ni l'autre : c'est l'interprète de phrases
   qui le comprend, via son filtre famille. */
const FILTRES_INTENTION = new Set(["famille","etudier","monde","libre"]);

/* Les trois questions que pose le découpage d'une requête, réunies ici pour
   qu'elles ne divergent jamais entre la barre de recherche et les
   suggestions :
     · isIntent      — tolérant, pour reconnaître un morceau de phrase ;
     · isWholeIntent — strict, pour ne pas confisquer « Bar-le-Duc » ;
     · isDestination — ce morceau peut-il être un lieu ? Sans lui, on coupait
       n'importe où : « Lille restaurant indien » visait « indien ». */
const DECOUPAGE = {
  isIntent: (t)=>intentionConnue(t),
  isWholeIntent: (t)=>estTermeMetier(t),
  isDestination: (t)=>ressembleAUneZone(t),
};

function intentionConnue(t){
  const texte = String(t||"").trim();
  if(!texte) return false;
  if(estTermeMetier(texte)) return true;
  // reconnaissance par sous-chaîne : « restaurant italien » n'est un terme
  // exact ni de CATS ni de CUISINES, mais désigne bien une intention
  if(categorieRecherchee(texte) || cuisineRecherchee(texte)) return true;
  const a = interpreter(texte);
  if(a && a.cats && a.cats.size) return true;
  // seuls les filtres qui décrivent CE QU'ON CHERCHE comptent ici ; « gratuit »
  // ou « pas loin » sont des contraintes, elles ne font pas une intention
  return !!(a && a.filtres && [...a.filtres].some(f=>FILTRES_INTENTION.has(f)));
}

/* Applique l'intention extraite d'une requête composée, sans toucher à la
   position : la carte a déjà bougé vers la destination. */
function appliquerIntention(intention, zone){
  const a = interpreter(intention);
  intentionCourante = a.structure;
  if(intentionCourante && zone){
    intentionCourante.zone = zone;
    if(!intentionCourante.chips.some(c=>c.type === "zone"))
      intentionCourante.chips.unshift({id:"zone", type:"zone", label:zone});
  }
  if(a && a.cats && a.cats.size){ catsActives = a.cats; filtreActif = "tout"; }
  else {
    // un besoin (« sortir », « chiller ») porte plusieurs catégories : elles
    // valent mieux qu'une seule, quand il s'agit d'un besoin et non d'une cat
    const bes = BESOINS.find(b=>sansAccents(b.id) === sansAccents(intention)
                              || sansAccents(b.label) === sansAccents(intention));
    if(bes && bes.sous){ catsActives = new Set(bes.sous.flatMap(x=>x.cats)); filtreActif = "tout"; }
    else {
      const cat = categorieRecherchee(intention);
      if(cat){ catsActives = null; filtreActif = cat; }
    }
  }
  // les contraintes tapées dans la même phrase (« gratuit », « pas loin »,
  // un budget en euros) s'appliquent aussi : elles font partie de la demande
  if(a && a.filtres && a.filtres.size) a.filtres.forEach(f=>filtresHumains.add(f));
  if(a && a.creneau){ creneau = a.creneau; filtreMaintenant = true; }
  selectionAccueil = false;
  dessinerFiltres(); majFiltres();

  /* Et surtout : aller chercher les lieux de ces catégories. Choisir un besoin
     dans le rail les chargeait, une recherche non — « restaurant Lille »
     déplaçait la carte et posait le filtre, mais n'affichait que ce que le
     chargement générique avait ramené au passage. Or celui-ci se partage un
     plafond de trois cents objets entre TOUTES les catégories de départ : en
     centre-ville dense, les restaurants s'y font évincer.
     chargerPourCats ne repart pas si les lieux sont déjà là. */
  if(catsActives && catsActives.size) chargerPourCats([...catsActives]);
  else if(filtreActif !== "tout") chargerPourCats([filtreActif]);
}

/* Après un déplacement de carte : trois à cinq résultats forts, pas un mur.
   Le reste continue d'arriver et se classera derrière. */
function ouvrirResultatsZone(nom, intention){
  zoneAffichee = {nom, intention:intention || ""};
  feuilleNiveau = "racine";
  $("#feuilleBesoins").hidden = false;
  if(!remplirResultatsZone(nom, intention)) return;
  brancherFeuille2();
  reglerEtatFeuille("moyenne");
}

/* Une liste courte sans explication passe pour une base de données pauvre.
   On dit donc ce qui se passe, en une ligne : c'est un aperçu, et il s'ouvrira
   tout seul une fois sur place. Rien à faire, aucun bouton — la promesse est
   tenue par la géolocalisation, pas par un réglage. */
function noteApercu(nom){
  const r = regimeZoneResultats(rechercheGeo);
  if(r === "local") return "";
  /* On dit la distance dans les mots, pas en kilomètres : « un peu plus loin »
     se comprend sans calcul, et c'est bien de cela qu'il s'agit. */
  const ou = r === "proche" ? "Tu n’y es pas encore"
           : r === "voisine" ? "C’est à quelques dizaines de kilomètres"
           : "C’est loin d’ici";
  return '<p class="rc-apercu">'+ou+' : voici un aperçu de '+esc(nom)+'. '+
    'Sur place, Autour montre tout ce qu’il connaît du quartier.</p>';
}

/* Le retour, écrit en fin de liste. Il ne s'affiche que s'il y a bien un
   ailleurs à quitter et un chez-soi connu où revenir — sans position mesurée,
   proposer « retourner à » ne promettrait rien. */
function retourVersMoiHTML(){
  if(!rechercheGeo || !positionMoi || !positionConnue()) return "";
  const chezMoi = commune && commune !== "ton quartier" ? commune : "ma position";
  return '<button class="rc-retour" data-retour-moi="1">'+
    '<span class="rc-retour-ic" aria-hidden="true">⌖</span>'+
    '<span class="rc-retour-txt"><b>Revenir autour de moi</b>'+
      '<i>Retourner à '+esc(chezMoi)+'</i></span>'+
    '<span class="rc-retour-fl" aria-hidden="true">›</span></button>';
}

function remplirResultatsZone(nom, intention){
  const centre = centreZoneActive();
  if(!centre) return false;
  // une intention explicite restreint le vivier : « cinéma Lille » ne doit pas
  // remonter des restaurants parce qu'ils sont mieux notés
  const vivier = lieux.filter(dansZoneActive).filter(nomExploitable).filter(l=>
    !catsActives || correspondUneCategorie(l, catsActives));
  const forts = rankResults(groupLogicalPlaces(vivier, distanceM), {
    intent:"sortir",
    intention:intentionCourante,
    categories:[...new Set(BESOINS_PRINCIPAUX.flatMap(b=>b.sous ? b.sous.flatMap(x=>x.cats) : []))],
    position:centre,
    now:instantCreneau().getTime(),
    nowOnly:filtreMaintenant && !montrerFermes,
    radius:rayonDeLaZone(),
    distanceBetween:distanceM,
    /* Quand l'intention a déjà été traduite en catégories, c'est LE filtre :
       repasser son texte ici en ajoutait un second, qui écartait tout ce dont
       le nom ne contient pas les mots tapés. « restaurant indien » ne laissait
       ainsi que les fiches portant le tag cuisine — une minorité — au lieu de
       tous les restaurants de la zone. */
    requete: catsActives ? "" : (intention || ""),
  }).slice(0, plafondResultats());

  $("#fbTitre").textContent = nom;
  $("#fbRetour").hidden = true;
  $("#feuilleBesoins").classList.add("accueil");
  const corps = $("#fbCorps");
  const titre = intention ? intention+" · "+nom : nom;
  /* UNE VILLE CHERCHÉE RESTE EXPLORER, PAS UN AUTRE ÉCRAN.

     Cette feuille ne portait qu'un titre et une liste. On perdait, en tapant
     « Lille », tout ce qui fait l'écran d'accueil : les quatre intentions
     (Manger, Sortir, Maintenant, Favoris) et les quatre moments (Maintenant,
     Ce soir, Ce week-end, À venir). Or c'est exactement ce qu'on vient
     chercher dans une ville où l'on n'est pas — « qu'est-ce que je peux y
     faire, et quand ». La référence visuelle montre ces deux rangées au-dessus
     de la liste : ce sont les mêmes composants que l'accueil, à l'identique. */
  corps.innerHTML =
    chipsHTML()+
    besoinsRapidesHTML()+
    ongletsTemps()+
    /* DIRE QU'ON REGARDE AILLEURS, ET PAS SEULEMENT OÙ.

       Le titre affichait « Lille ». Mais « Lille » tout seul se lit aussi bien
       comme « tu es à Lille » que comme « tu regardes Lille » — et depuis
       Tourcoing c'est la seconde lecture qui est vraie. La référence pose une
       pastille « Recherche : Lille » à côté du titre : deux mots qui disent
       que ce panneau répond à une question posée, pas à une position. */
    '<div class="rc-tete"><strong>'+esc(titre)+'</strong>'+
      (rechercheGeo ? '<span class="rc-contexte">Recherche&nbsp;: '+esc(nom)+'</span>' : '')+
      '<button class="rc-tout" data-rc-tout="1">Voir tout →</button></div>'+
    (forts.length
      ? '<div class="rc-piste" data-testid="primary-results">'+
          forts.map(carteRecommandation).join("")+'</div>'+ noteApercu(nom)
      : '<p class="liste-vide">Les lieux de cette zone arrivent…</p>')+
    /* LA SORTIE EST AU BOUT DE LA LISTE, PAS SEULEMENT DANS UN COIN DE CARTE.
       Le bouton flottant existe en haut à droite, mais quelqu'un qui vient de
       parcourir cinq propositions lilloises a les yeux en bas du panneau, pas
       dans l'angle opposé de l'écran. La référence pose donc le retour là où
       finit la lecture, et il dit vers OÙ l'on revient : « Retourner à
       Tourcoing » se comprend sans avoir à s'en souvenir. */
    retourVersMoiHTML();
  brancherFeuille2();
  return true;
}
/* On pense d'abord à ce qu'on crée, ensuite à l'endroit. Demander « déplace
   la carte pour poser l'épingle » avant même de savoir de quoi il s'agit
   inversait l'ordre naturel. */
function ouvrirCreation(){
  const eph = Object.entries(CATS).filter(([,c])=>c.eph);
  ouvrirFeuille(
    '<div class="liste-tete"><h2>Que veux-tu ajouter&nbsp;?</h2></div>'+
    '<div class="creer-choix">'+eph.map(([id,c])=>
      '<button class="creer-type" data-type="'+id+'">'+
        '<em>'+c.emoji+'</em><b>'+esc(c.label)+'</b></button>').join("")+'</div>');
  $("#feuille").querySelectorAll("[data-type]").forEach(b=>b.onclick=()=>{
    typeAvantPose = b.dataset.type;
    fermerFeuille();
    ouvrirModePose();
  });
}
let typeAvantPose = null;

$("#btnPoseOk").onclick=validerPose;
/* Revenir à soi : la carte reprend sa position, la recherche est relâchée et
   l'accueil retrouve ses recommandations locales. */
/* Revenir à sa position : une action géographique, appelée par le bouton
   flottant comme par la pastille de lieu de l'en-tête. */
/* LE SEUL CHEMIN DE RETOUR. Rien d'autre ne remet la zone active sur la
   position physique : ni un mouvement de carte, ni l'arrivée de données, ni un
   filtre. C'était la condition posée — une seule porte, dans un sens comme
   dans l'autre. */
function revenirAutourDeMoi(){
  if(!positionMoi || !positionPrecise()) { suivreMaPosition({reproposer:true}); return; }
  definirZoneActive(CTX ? CTX.zoneMoi(positionMoi, commune) : null);
  annulerChargementsZone();
  rechercheGeo = null;
  intentionCourante = null;
  zoneAffichee = null;          // la feuille reprend ses recommandations locales
  recherche = ""; if($("#rech")) $("#rech").value = "";
  catsActives = null; filtreActif = "tout";
  allerVers(positionMoi, 16, {duration:.6});
  chargerZone(positionMoi[0], positionMoi[1]);
  rendre(); majAccueil();
  if(feuilleNiveau !== null) majFeuille2(); else ouvrirAccueilFeuille();
  majBoutons();
}
$("#btnAutourDeMoi").onclick = revenirAutourDeMoi;

$("#btnPartager").onclick=partagerApp;
$("#navFermer").onclick=quitterNav;

/* Le bouton transports allume la couche des arrêts et ouvre l'accueil pour
   expliquer ce qui vient d'apparaître. Un second appui range la couche. Sans
   cet interrupteur, les arrêts ne seraient plus atteignables dans Explorer. */
/* Aide : un interrupteur, comme la couche transport. Le même geste entre et
   sort du mode, et son état se voit sans avoir à ouvrir quoi que ce soit. */
$("#btnAide").onclick=()=>{
  const b = $("#btnAide");
  if(modeAide){ basculerAide(); fermerFeuille2(); }
  else { basculerAide(); ouvrirFeuille2("aide"); }
  b.setAttribute("aria-pressed", modeAide ? "true" : "false");
  b.classList.toggle("actif", modeAide);
};

$("#btnTransports").onclick=()=>{
  coucheTransport = !coucheTransport;
  $("#btnTransports").setAttribute("aria-pressed", coucheTransport ? "true" : "false");
  $("#btnTransports").classList.toggle("actif", coucheTransport);
  rendre();
  if(coucheTransport){
    if(feuilleNiveau === null) ouvrirAccueilFeuille();
    reglerFeuilleDeplie(true);
  }
};

/* ---- Navigation basse ---------------------------------------------------
   « Messages » ne sert qu'à prévenir les participants d'un événement qu'on a
   publié : il ne s'active donc que si on a publié quelque chose. « Favoris »
   n'existe pas encore et le dit, plutôt que d'ouvrir un écran vide. */
/* Mes canaux : créés, rejoints ou suivis. C'est la seule chose qui fait
   exister la section Messages — il n'y a pas de boîte de réception générale. */
async function rafraichirCanaux(){
  canauxAMoi = await Store.mesCanaux();
  majNavBas();
}
/* Prévenir les participants n'est pas une messagerie : ça vit sur l'événement
   qu'on a créé, pas dans un onglet permanent. La pastille sur « Profil »
   signale simplement qu'un de mes événements attend quelque chose. */
function majNavBas(){
  const nav = $("#navBas");
  if(!nav) return;
  const E = window.AutourEvents;
  const onglet = nav.querySelector('[data-nb="profil"]');
  if(!onglet || !E) return;
  const attente = E.nonLus(canauxAMoi);
  onglet.classList.toggle("avec-pastille", attente > 0);
}
/* L'onglet allumé doit toujours dire où l'on est. La surbrillance était posée
   dans le gestionnaire de clic uniquement : toute navigation déclenchée par le
   code — « Trouver de l'aide » depuis un état vide, la bascule vers Explorer
   depuis Aide — laissait donc l'onglet précédent allumé. On voyait « Aide »
   souligné en étant dans Explorer. */
/* ---- Le contexte d'Explorer survit à un aller-retour ---------------------

   Explorer → Aide → Explorer rendait une page neuve : catégories relâchées,
   filtres vidés, recherche effacée, créneau ramené au départ. Quelqu'un qui
   avait réglé « Ce soir », coché « gratuit » et cherché « concert » repartait
   de zéro pour avoir jeté un œil à Aide. La carte, elle, ne bougeait pas —
   c'est tout le reste qui était perdu.

   On photographie donc Explorer en le quittant, et on le repose en revenant.
   La remise à plat reste entière quand on ENTRE dans Aide : ce mode doit
   partir d'une page nette, c'est une décision produit qui ne change pas. Ce
   qu'on rétablit, c'est l'état d'avant. */
let contexteExplorer = null;
let ongletCourant = "explorer";

function capturerContexteExplorer(){
  const corps = $("#fbCorps");
  contexteExplorer = {
    creneau, filtreActif, recherche, montrerFermes,
    catsActives: catsActives ? new Set(catsActives) : null,
    filtresHumains: [...filtresHumains],
    selectionAccueil: Array.isArray(selectionAccueil) ? selectionAccueil.slice() : selectionAccueil,
    // « aide » n'est pas un état d'Explorer : on y revient par la racine
    niveau: (feuilleNiveau === "aide" || feuilleNiveau == null) ? "racine" : feuilleNiveau,
    scroll: corps ? corps.scrollTop : 0,
  };
}

function restaurerContexteExplorer(){
  const c = contexteExplorer;
  contexteExplorer = null;
  if(!c) return false;
  creneau = c.creneau;
  filtreActif = c.filtreActif;
  recherche = c.recherche;
  montrerFermes = c.montrerFermes;
  catsActives = c.catsActives;
  filtresHumains.clear();
  c.filtresHumains.forEach(x=>filtresHumains.add(x));
  selectionAccueil = c.selectionAccueil;
  filtreMaintenant = creneau === "maintenant";
  const champ = $("#rech");
  if(champ) champ.value = recherche;
  majFiltres(); rendre(); majAccueil();
  ouvrirFeuille2(c.niveau);
  /* Le scroll se repose APRÈS le rendu de la feuille : `ouvrirFeuille2`
     appelle `reinitialiserScrollFeuille`, qui remet à zéro. Deux frames
     d'attente pour que la hauteur réelle du contenu soit connue, sinon le
     navigateur borne la position à la hauteur d'une feuille encore vide. */
  const corps = $("#fbCorps");
  if(corps && c.scroll > 0) requestAnimationFrame(()=>requestAnimationFrame(()=>{
    corps.scrollTop = c.scroll;
  }));
  return true;
}

function marquerNavigation(id){
  const nav = $("#navBas");
  if(!nav) return;
  nav.querySelectorAll(".nb").forEach(x=>x.classList.toggle("actif", x.dataset.nb === id));
}

/* Un appui sur « ⚡ Maintenant · 3 » ouvre la liste de ces trois-là. Pas un
   menu, pas une page : le créneau « maintenant » et la feuille, c'est-à-dire
   exactement ce que l'onglet du même nom fait déjà. */
$("#badgeMaintenant").onclick = ()=>{
  if(modeAide) basculerAide();
  creneau = "maintenant";
  filtreMaintenant = true;
  ongletCourant = "explorer";
  marquerNavigation("explorer");
  contexteExplorer = null;
  // même raison qu'ailleurs : rouvrir sans fermer, l'historique reste sain
  ouvrirFeuille2("racine");
  reinitialiserScrollFeuille();
  rendre();
};

$("#navBas").querySelectorAll("[data-nb]").forEach(b=>b.onclick=()=>{
  const id = b.dataset.nb;
  if(b.getAttribute("aria-disabled") === "true"){
    toast("Bientôt disponible.");
    return;
  }
  // photographier Explorer AVANT que quoi que ce soit ne le remette à plat
  if(ongletCourant === "explorer" && id !== "explorer") capturerContexteExplorer();
  ongletCourant = id;
  marquerNavigation(id);
  if(id === "explorer"){
    if(modeAide) basculerAide();
    /* ON NE FERME PAS POUR ROUVRIR AUSSITÔT.
       `fermerFeuille2()` fait `history.back()`, `ouvrirFeuille2()` fait
       `pushState()`. Les enchaîner dans le même geste lance deux opérations
       d'historique asynchrones qui se croisent : le push atterrit avant le
       back, l'entrée est consommée deux fois, et au bout de quelques
       allers-retours d'onglets le `back()` finit par sortir du document —
       la page se RECHARGE. Carte reconstruite, données refetchées, contexte
       perdu, exactement ce que cette passe doit supprimer.
       La feuille reste ouverte ; on ne fait que changer ce qu'elle montre. */
    /* Le modal de Créer / Favoris / Profil, lui, doit bien se fermer : sinon
       il reste posé PAR-DESSUS la feuille d'Explorer qu'on vient de rouvrir,
       et deux panneaux principaux se superposent. Le rechargement de page
       corrigé juste au-dessus masquait ce défaut — il remettait tout à zéro. */
    const modal = $("#feuille");
    if(modal && !modal.hidden) demanderFermetureFeuille();
    if(!restaurerContexteExplorer()) ouvrirAccueilFeuille();
    return;
  }
  if(id === "aide"){
    // on repart toujours de la question, jamais d'une liste de structures
    if(!modeAide) basculerAide(); else { sousAide = null; besoinsExprimesAide = []; besoinsAide = []; besoinsSecondairesAide = []; intentionsSanteAide = []; }
    ouvrirFeuille2("aide"); return;
  }
  /* Créer et Favoris demandent un compte — mais SEULEMENT ici, au moment du
     geste. L'onglet reste visible et cliquable pour tout le monde : le cacher
     reviendrait à ne pas dire qu'Autour se publie. */
  if(id === "creer"){
    retourFormulaire=false;
    exigerCompte("publier").then(ok=>{ if(ok) ouvrirCreation(); });
    return;
  }
  if(id === "favoris"){
    exigerCompte("favori").then(ok=>{ if(ok) ouvrirFavoris(); });
    return;
  }
  if(id === "profil"){ ouvrirProfil(); return; }
});

/* Ce qui reprend après une connexion. Chaque entrée est le geste exact qui a
   déclenché la demande de compte, rejoué à l'identique : on ne dépose personne
   sur l'accueil avec « c'est bon, recommencez ». */
enregistrerReprise("publier", ()=>{
  /* Le brouillon est encore en mémoire : on relance la publication elle-même.
     S'il a été abandonné entre-temps, on rouvre au moins le formulaire plutôt
     que de publier un brouillon vide. */
  if(brouillon && brouillon.titre) return publier();
  ouvrirCreation();
});

enregistrerReprise("favori", async(charge)=>{
  const cle = charge && charge.cle;
  if(!cle) return ouvrirFavoris();
  const lieu = lieux.find(x=>cleFavori(x) === cle) || favorisEnMemoire.get(cle);
  if(lieu) return basculerFavori(lieu);
  return ouvrirFavoris();
});

enregistrerReprise("mes-publications", ()=>ouvrirMesPublications());
enregistrerReprise("notifications", ()=>ouvrirProfil());
enregistrerReprise("compte", ()=>ouvrirProfil());
enregistrerReprise("modifier", (charge)=>{
  const l = charge && charge.dbId && lieux.find(x=>x.dbId === charge.dbId);
  if(l){ pileEcrans=[]; pousserEcran(()=>ouvrirDetail(l.id)); }
});
enregistrerReprise("supprimer", (charge)=>{
  const l = charge && charge.dbId && lieux.find(x=>x.dbId === charge.dbId);
  if(l){ pileEcrans=[]; pousserEcran(()=>ouvrirDetail(l.id)); }
});

/* ==================================================================== */
/*  L'écran de compte : une adresse, et on reprend où on en était        */
/* ==================================================================== */
/* Il n'apparaît jamais tout seul. Il est toujours la réponse à un geste qu'on
   vient de faire — publier, mettre en favori — et son titre le dit avec les
   mots de CE geste-là. « Connectez-vous pour continuer » n'explique rien :
   c'est une porte, pas une raison. */
let compteEnCours = { action:"compte", email:"", typeOtp:"email", envoye:false };

/* ==================================================================== */
/*  Profil                                                               */
/* ==================================================================== */

/* Ce que j'ai enregistré. L'instantané stocké permet d'afficher un favori même
   si son lieu n'est pas chargé dans la zone courante. */
async function ouvrirFavoris(){
  await chargerFavoris();
  const lignes = await Store.favoris();
  lignes.forEach(f=>{
    const cle = f.publication_id ? "pub:"+f.publication_id : f.lieu_ref;
    favorisIds.add(cle);
    if(!favorisEnMemoire.has(cle)) favorisEnMemoire.set(cle, {
      id:cle, dbId:f.publication_id || null, source:(f.lieu_ref||"").split(":")[0],
      titre:f.titre, cat:f.cat, adresse:f.adresse, lat:f.lat, lng:f.lng,
    });
  });

  const corps = lignes.length
    ? lignes.map(f=>{
        const cle = f.publication_id ? "pub:"+f.publication_id : f.lieu_ref;
        const c = CATS[f.cat] || {emoji:"📍"};
        return '<div class="ac-item" role="button" tabindex="0" data-fav="'+esc(cle)+'">'+
          '<span class="ac-emoji">'+c.emoji+'</span>'+
          '<span class="ac-txt"><span class="ac-nom">'+esc(f.titre)+'</span>'+
          '<span class="ac-sous">'+esc(f.adresse || (c.label || ""))+'</span></span>'+
          boutonCoeur({dbId:f.publication_id, id:cle, source:(f.lieu_ref||"").split(":")[0]})+
          '</div>';
      }).join("")
    : '<p class="liste-vide">Aucun favori pour l’instant.<br>'+
      'Touche le cœur sur un lieu ou un événement pour l’enregistrer.</p>';

  ouvrirFeuille(
    '<div class="liste-tete"><h2>♡ Favoris</h2>'+
    '<span class="liste-compte">'+lignes.length+'</span></div>'+corps);

  $("#feuille").querySelectorAll("[data-fav]").forEach(b=>b.onclick=(e)=>{
    if(e.target.closest("[data-coeur]")) return;   // le cœur ne navigue pas
    const l = lieux.find(x=>cleFavori(x) === b.dataset.fav);
    if(l){ fermerFeuille(); ouvrirFicheCompacte(l); }
    else toast("Ce lieu n’est pas chargé dans cette zone");
  });
  majCoeurs();
}

/* ---- Ville détectée -----------------------------------------------------
   Reverse-geocoding Nominatim, une seule fois par position. En cas d'échec,
   l'en-tête garde « Autour de toi » : on n'affiche pas une ville devinée. */
/* Ce que l'en-tête dit du lieu regardé. Tant que personne n'a donné sa
   position ni choisi de ville, il le dit — au lieu de faire croire que le
   point affiché est « autour de toi ». */
function majEnteteLieu(){
  const v = $("#hdVille");
  const avatar = $("#hdAvatar");
  if(avatar){
    const choix = avatarChoisi();
    avatar.textContent = choix;
    avatar.hidden = !choix;
  }
  if(!v) return;
  if(!positionConnue()){ v.textContent = "Choisir un endroit"; return; }
  /* Une ville déduite d'une adresse IP ne s'écrit JAMAIS dans cette pastille.
     Sur un réseau mobile elle désigne souvent la passerelle de l'opérateur, à
     des dizaines de kilomètres : afficher « Lille » à quelqu'un qui est à
     Tourcoing est une affirmation fausse, et c'est celle qui a été signalée.
     On dit donc ce qu'on sait vraiment — qu'on regarde une zone, sans plus. */
  if(positionApprochee()){ v.textContent = "Zone approximative"; return; }
  if(ETIQUETTES_LIEU.includes(v.textContent)) v.textContent = "Autour de toi";
}

async function detecterVille(lat,lng){
  const cle = lat.toFixed(2)+","+lng.toFixed(2);
  if(villeDetectee === cle) return;
  const generation = nouvelleGeneration("contexte:ville",cle);
  /* Le nom de commune est demandé même sur une zone approchée — il sert aux
     agendas et aux adresses. Mais il ne s'AFFICHE que si la position est un
     vrai point : sinon la pastille se remettrait à nommer une ville où l'on
     n'est peut-être pas. */
  const nommable = ()=>positionPrecise();
  const parRelais = await communeRelayee(lat,lng);
  if(!generationCourante(generation)) return;
  if(parRelais !== undefined){
    if(parRelais){
      villeDetectee = cle;
      if(nommable()){ $("#hdVille").textContent = parRelais; mesurerHeader(); }
    }
    terminerGeneration(generation);
    return;
  }
  try{
    const stop = new AbortController();
    const t = setTimeout(()=>stop.abort(), 6000);
    const r = await fetch("https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=12&lat="+
      lat+"&lon="+lng, {signal:stop.signal, headers:{"Accept-Language":"fr"}});
    clearTimeout(t);
    if(!r.ok || !generationCourante(generation)) return;
    const j = await r.json();
    if(!generationCourante(generation)) return;
    const a = j.address || {};
    const nom = a.city || a.town || a.village || a.municipality || a.county;
    villeDetectee = cle;
    if(nom && nommable()){
      $("#hdVille").textContent = nom;
      mesurerHeader();
    }
  }catch(e){ /* silencieux : l'en-tête reste neutre plutôt que faux */ }
  finally{ terminerGeneration(generation); }
}

/* L'ancien gros bouton noir « Que faire autour de moi ? » a disparu : la
   feuille s'ouvre d'elle-même au démarrage sur « Pour toi, maintenant », et
   les pills de l'en-tête donnent l'accès direct aux besoins. */
function ouvrirAccueilFeuille(){
  if(modeAide) basculerAide();
  catsActives = null; sousChoisi = null; filtreActif = "tout";
  rendre(); majAccueil();
  ouvrirFeuille2("racine");
}
$("#fbFermer").onclick = fermerFeuille2;
$("#fbRetour").onclick = ()=>{
  // revenir aux quatre besoins : on relâche la sélection en cours
  if(modeAide) basculerAide();
  const venaitDePlus = (BESOIN_DE(feuilleNiveau) || {}).secondaire;
  catsActives = null; sousChoisi = null;
  // un besoin atteint via « Plus » y retourne : le retour défait le dernier
  // pas, il ne renvoie pas à la case départ
  rendre(); majAccueil(); ouvrirFeuille2(venaitDePlus ? "plus" : "racine"); majRaccourcis();
};
/* Poignée : compacte ⇄ dépliée. Un balayage vers le bas réduit d'abord la
   feuille, puis la ferme ; vers le haut il la développe.

   UN GESTE, UNE SEULE CONSÉQUENCE.

   Cette poignée écoutait `pointerup` ET `click`. Or un navigateur émet les
   deux : tirer la poignée vers le haut faisait donc « réduite → moyenne » au
   relâchement, puis « moyenne → dépliée » au clic qui suivait. La feuille
   sautait deux crans pour un seul geste, et un appui bref sur place, que le
   glissement ignorait, était quand même cyclé par le clic. C'est exactement
   ce qui se lit comme « le panneau bug » et « ça se déclenche tout seul ».

   Les deux entrées sont conservées — le clic reste la seule que connaissent
   le clavier et les technologies d'assistance — mais elles ne se recouvrent
   plus : dès qu'un glissement a tranché, il consomme le clic qui le suit. */
const poigneeFeuille = $("#fbPoignee");
const CRAN_HAUT = -45, CRAN_BAS = 70;
let glissementFeuille = null;
let glissementAAgi = false;

function cyclerFeuille(){
  const suivant = {reduite:"moyenne", moyenne:"deplie", deplie:"reduite"};
  reglerEtatFeuille(suivant[etatFeuille()]);
}
function reduireDUnCran(){
  const etat = etatFeuille();
  if(etat === "deplie") reglerEtatFeuille("moyenne");
  else if(etat === "moyenne") reglerEtatFeuille("reduite");
  else fermerFeuille2();
}
function relacherPoignee(e){
  if(!glissementFeuille) return;
  try{ poigneeFeuille.releasePointerCapture(glissementFeuille.id); }catch(err){}
  glissementFeuille = null;
}

poigneeFeuille.onclick = ()=>{
  // un glissement vient de décider : ce clic n'est que son écho
  if(glissementAAgi){ glissementAAgi = false; return; }
  cyclerFeuille();
};
poigneeFeuille.addEventListener("pointerdown",e=>{
  glissementFeuille={id:e.pointerId,y:e.clientY};
  glissementAAgi = false;
  try{ poigneeFeuille.setPointerCapture(e.pointerId); }catch(err){}
});
poigneeFeuille.addEventListener("pointerup",e=>{
  if(!glissementFeuille || glissementFeuille.id!==e.pointerId) return;
  const dy=e.clientY-glissementFeuille.y;
  relacherPoignee(e);
  // vers le haut : on monte d'un cran ; vers le bas : on descend d'un cran,
  // et on ne ferme que depuis l'état déjà réduit
  if(dy < CRAN_HAUT){
    glissementAAgi = true;
    reglerEtatFeuille(etatFeuille() === "reduite" ? "moyenne" : "deplie");
    return;
  }
  if(dy > CRAN_BAS){ glissementAAgi = true; reduireDUnCran(); }
  // entre les deux, c'est un appui : on ne fait rien et on laisse le clic agir
});
/* Un geste interrompu — un appel qui arrive, un doigt qui sort de l'écran —
   doit rendre la poignée à son état de repos. Sans ça le glissement restait
   « en cours » et le geste suivant se comparait à une origine périmée. */
poigneeFeuille.addEventListener("pointercancel",relacherPoignee);
/* La pastille de lieu : recentrer si on sait où on est, demander sinon.
   C'est la seule commande géographique — « Autour de moi » n'est plus un
   concept concurrent de « Maintenant », c'est ce geste-là. */
$("#btnLieu").onclick = ()=>{
  /* Tant qu'on n'a pas le vrai point, ce bouton le demande. Il testait
     `positionConnue()`, qui répond « oui » depuis que la ville peut venir de
     l'adresse IP : la pastille se contentait donc de recentrer sur une ville
     approchée, et plus rien dans l'écran ne permettait de demander la vraie
     position. Quelqu'un que le navigateur n'a jamais localisé restait sur une
     ville à plusieurs kilomètres, sans aucun moyen d'y remédier. */
  if(!positionPrecise()){ suivreMaPosition({reproposer:true}); return; }
  if(zoneAffichee || rechercheGeo){ revenirAutourDeMoi(); return; }
  allerVers(positionMoi, 16, {duration:.6});
};
