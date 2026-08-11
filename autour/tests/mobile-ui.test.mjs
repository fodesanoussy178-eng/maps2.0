import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html",import.meta.url),"utf8");
/* Le démarrage à froid ne tient pas qu'au client : la ville vient du bord du
   réseau, les lieux d'un relais mis en cache, et le tout premier lancement
   d'un jeu pré-calculé. Ces fichiers font partie du chemin critique. */
const middleware = await readFile(new URL("../middleware.js",import.meta.url),"utf8");
const apiLieux = await readFile(new URL("../api/lieux.js",import.meta.url),"utf8");
const apiCommune = await readFile(new URL("../api/commune.js",import.meta.url),"utf8");
const zones = await readFile(new URL("../outils/zones.mjs",import.meta.url),"utf8");
const temporel = await readFile(new URL("../temporel.js",import.meta.url),"utf8");
const core = await readFile(new URL("../core.js",import.meta.url),"utf8");
const comprendre = await readFile(new URL("../comprendre.js",import.meta.url),"utf8");
const signaux = await readFile(new URL("../signaux.js",import.meta.url),"utf8");
const aide = await readFile(new URL("../aide.js",import.meta.url),"utf8");
const donnees = await readFile(new URL("../donnees.js",import.meta.url),"utf8");
const explications = await readFile(new URL("../explications.js",import.meta.url),"utf8");

test("le viewport et les breakpoints responsive ne dépendent pas du userAgent",()=>{
  assert.match(html,/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" \/>/);
  assert.match(html,/matchMedia\("\(max-width: 767px\)"\)/);
  assert.match(html,/matchMedia\("\(min-width: 768px\) and \(max-width: 1099px\)"\)/);
  assert.match(html,/matchMedia\("\(pointer: coarse\)"\)/);
  assert.doesNotMatch(html,/navigator\.userAgent/);
});

test("la bottom sheet possède les trois layouts et des hauteurs dynamiques",()=>{
  // trois hauteurs : réduite (poignée + titre), moyenne, étendue
  assert.match(html,/#feuilleBesoins\.reduite\{height:144px;max-height:144px\}/);
  assert.match(html,/height:58dvh;max-height:58dvh/);
  assert.match(html,/#feuilleBesoins\.deplie\{height:80dvh;max-height:80dvh\}/);
  assert.match(html,/@media \(min-width:768px\) and \(max-width:1099px\)/);
  assert.match(html,/@media \(min-width:1100px\)/);
  assert.match(html,/--sheet-visible-height:0px/);
  assert.match(html,/ResizeObserver/);
});

test("les résultats sont rendus avant la demande de précision",()=>{
  // pour les intentions ordinaires : les résultats, puis le choix de préciser
  const standard = html.indexOf('corps.innerHTML = blocResultats()+\'<p class="fb-section">Préciser mon besoin');
  assert.ok(standard>0,"ordre des intentions");
  assert.match(html,/data-testid="primary-results"/);
  // l'aide, elle, fait exactement l'inverse et c'est voulu : on ne commence
  // pas par des structures, on commence par la question
  assert.match(html,/corps\.innerHTML = sousAide \? ecranSolutionsAide\(\) : ecranBesoinsAide\(\);/);
});

test("les couches et actions tactiles essentielles ont un contrat central",()=>{
  for(const layer of ["mainSheet","placeDetails","publishModal","confirmationDialog","searchOverlay"])
    assert.match(html,new RegExp(layer));
  assert.match(html,/\.fb-retour,\.fb-x\{flex-shrink:0;width:44px;height:44px/);
  assert.match(html,/\.feuille-x\{[^}]*width:44px;height:44px/s);
  assert.match(html,/button:focus-visible,input:focus-visible,a:focus-visible,summary:focus-visible/);
  assert.match(html,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html,/pointerdown/);
  assert.match(html,/pointerup/);
});

test("« Créer » est un onglet nommé, plus un bouton flottant en double",()=>{
  // le FAB violet faisait doublon avec l'onglet : il est supprimé
  assert.doesNotMatch(html,/id="btnAjouter"/);
  assert.match(html,/data-nb="creer" aria-label="Créer un événement ou une activité"/);
  assert.match(html,/<i class="nb-plus">/);
  assert.match(html,/\.nb-plus\{[^}]*background:var\(--violet\)/s);
  assert.match(html,/--safe-b:env\(safe-area-inset-bottom,0px\)/);
});

test("le parcours de publication couvre les six familles annoncées",()=>{
  for(const label of ["Événement","Pop-up","Rencontre","Sport","Distribution & aide","Autre"])
    assert.match(html,new RegExp('label:"'+label.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+'"'));
  assert.match(html,/const eph=Object\.entries\(CATS\)\.filter\(\(\[,c\]\)=>c\.eph\)/);
});

test("l’entrée dans Aide laisse peindre la feuille et fusionne le cache en lot",()=>{
  assert.match(html,/await new Promise\(resolve=>requestAnimationFrame\(\(\)=>setTimeout\(resolve,0\)\)\)/);
  assert.match(html,/const fiches = o\.l\.map\(x=>Object\.assign\(\{\},x\.f,\{autourCat:x\.cat\}\)\)/);
  assert.match(html,/ajouterLieuxGoogle\(fiches\)/);
  assert.match(html,/CAT_GOOGLE\[f\.type\] \|\| f\.autourCat \|\| catDefaut/);
  assert.doesNotMatch(html,/o\.l\.forEach\(x=>ajouterLieuxGoogle\(\[x\.f\], x\.cat\)\)/);
});

test("les accès principaux suivent l'intention, pas la nomenclature",()=>{
  assert.match(html,/const BESOINS_PRINCIPAUX\s+= BESOINS\.filter\(b=>!b\.secondaire\)/);
  assert.match(html,/const BESOINS_SECONDAIRES = BESOINS\.filter\(b=>b\.secondaire\)/);
  for(const id of ["manger","sortir","chiller","bouger","aide"]){
    const bloc = html.slice(html.indexOf('id:"'+id+'"'), html.indexOf('id:"'+id+'"')+240);
    assert.doesNotMatch(bloc,/secondaire:true/, id+" doit rester principal");
  }
  // Famille, Culture, Étudier et Services restent accessibles derrière « Plus »
  for(const id of ["famille","culture","etudier","services"]){
    const bloc = html.slice(html.indexOf('id:"'+id+'"'), html.indexOf('id:"'+id+'"')+240);
    assert.match(bloc,/secondaire:true/, id+" doit être secondaire");
  }
  // « Gratuit » est une contrainte, pas une intention : un seul foyer, les
  // filtres. Il était exposé aux DEUX endroits, avec deux états à maintenir.
  assert.doesNotMatch(html,/data-filtre="gratuit"/);
  assert.match(html,/const CONTRAINTES = \["ouvert","proche","gratuit","budget"\];/);
  assert.match(html,/\{ id:"gratuit", label:"Gratuit"/);
});

test("« Plus » est atteignable depuis les pills de l’en-tête",()=>{
  // depuis la refonte, les besoins vivent dans les pills et non plus dans la
  // feuille : celle-ci sert à montrer des lieux, pas à poser une question
  assert.match(html,/data-rc="plus"/);
  assert.match(html,/id="raccourcis" class="pills"/);
  assert.match(html,/feuilleNiveau === "plus"/);
  // le retour depuis un besoin secondaire revient à « Plus », pas à la racine
  assert.match(html,/ouvrirFeuille2\(venaitDePlus \? "plus" : "racine"\)/);
});

test("le classement consomme un ETA réel et n'attend jamais le réseau",()=>{
  assert.match(html,/etaFor:l=>etaConnu\(l, centre\)/);
  assert.match(html,/prechargerEta\(classement, centre/);
  // un échec d'itinéraire est mémorisé, sinon le reclassement boucle
  assert.match(html,/etaParLieu\.set\(cleEta\(l, centre\), null\)/);
});

test("aucun horaire n'est inventé faute de clé transport",()=>{
  assert.match(html,/const CLE_TRANSPORT = ""/);
  assert.match(html,/navitia: CLE_TRANSPORT \? \{token:CLE_TRANSPORT\} : null/);
});

test("l'état ouvert/fermé a une seule source de vérité",()=>{
  assert.match(html,/<script src="availability\.js\?v=[a-f0-9]{8}"><\/script>/);
  // les écrans passent tous par le même helper, aucun ne relit un horaire
  assert.match(html,/function dispoDe\(l, arrivee, quand\)/);
  // le moteur temporel fait autorité sur le « quand »
  assert.match(html,/<script src="temporel\.js\?v=[a-f0-9]{8}"><\/script>/);
  assert.match(html,/function statutTemps\(l, quand\)\{/);
  assert.match(html,/function badgeDispo\(l\)/);
  assert.doesNotMatch(html,/x\.ouvert === true\)\s+sous\.push/);
  assert.doesNotMatch(html,/l\.ouvert === false && creneau === "maintenant"/);
});

test("un lieu fermé est atténué et badgé sur la carte, jamais masqué",()=>{
  assert.match(html,/poi-ferme-badge">Fermé/);
  assert.match(html,/\.poi-ferme\{opacity:\.55;filter:grayscale\(1\)\}/);
  // style distinct de celui d'un lieu ouvert
  assert.match(html,/\.poi-ferme \.poi-rond\{border-style:dashed/);
});

test("les lieux fermés ne reviennent que sur demande explicite",()=>{
  assert.match(html,/data-fermes="1"/);
  assert.match(html,/data-fermes="1"/);
  assert.match(html,/aria-pressed="'\+\(montrerFermes\?'true':'false'\)\+'"/);
  // le rail reste visible tant qu'un filtre est actif, sinon on ne peut plus le défaire
  assert.match(html,/const actifs = filtresHumains\.size > 0 \|\| montrerFermes;/);
  // …et il ne sort pas tout seul : il faut avoir ouvert « Filtres »
  assert.match(html,/const demande = z\.dataset\.force === "1";/);
});

/* ---- Refonte de l'interface mobile ------------------------------------- */

test("l'en-tête est une pastille flottante, la carte domine",()=>{
  assert.match(html,/<header id="appHeader"/);
  // flottant, pas une bande blanche pleine largeur qui repousse la carte
  assert.match(html,/#appHeader\{position:absolute;top:calc\(var\(--safe-t\) \+ 10px\);left:12px;right:12px/);
  assert.match(html,/#appHeader\{[^}]*background:none/s);
  assert.match(html,/id="hdVille"/);
  assert.match(html,/id="btnLoupe"/);
  assert.match(html,/id="btnNotifs"/);
  // la recherche permanente a disparu de l'en-tête
  assert.doesNotMatch(html,/<header id="appHeader"[\s\S]{0,900}<input id="rech"/);
  assert.doesNotMatch(html,/id="btnQuoi"/);
});

test("la carte est un décor : ni zoom Leaflet, ni attribution posée dessus",()=>{
  assert.match(html,/attributionControl:false/);
  assert.match(html,/zoomControl:false/);
  assert.match(html,/\.leaflet-control-zoom,\.leaflet-control-attribution\{display:none!important\}/);
  // …mais l'attribution reste due, repliée derrière un « ⓘ »
  assert.match(html,/id="btnCredits"/);
  assert.match(html,/openstreetmap\.org\/copyright/);
  assert.match(html,/carto\.com\/attributions/);
});

test("la recherche universelle garde un seul formulaire, quel que soit le contexte",()=>{
  assert.equal((html.match(/id="formRech"/g) || []).length, 1);
  assert.equal((html.match(/id="rech"/g) || []).length, 1);
  assert.match(html,/function synchroniserRechercheDesktop\(\)/);
  assert.match(html,/lancerRecherche\(\);/);
});

test("le marqueur utilisateur est un point bleu, pas un emoji",()=>{
  assert.match(html,/<span class="moi-in"><i><\/i><b><\/b><\/span>/);
  assert.match(html,/\.moi-in b\{display:block;width:17px;height:17px;border-radius:50%;\s*\n\s*background:#1A73E8/);
});

test("un seul contrôle ramène à sa position",()=>{
  // la pastille ronde « revenir » et le bouton « Autour de moi » faisaient la
  // même chose ; il ne reste que celui qui dit ce qu'il fait
  assert.doesNotMatch(html,/btnRevenir/);
  assert.match(html,/id="btnAutourDeMoi" hidden>⌖ Revenir autour de moi<\/button>/);
  assert.match(html,/\.rond-flottant\{[^}]*width:44px;height:44px/);
});

test("« Créer » reste atteignable en un tap depuis l'écran principal",()=>{
  assert.match(html,/if\(id === "creer"\)\{ retourFormulaire=false; ouvrirCreation\(\); return; \}/);
  assert.match(html,/function ouvrirCreation/);
});

test("le bottom sheet propose au lieu de poser une question",()=>{
  assert.match(html,/Pour toi, maintenant/);
  assert.match(html,/function recommandationsAccueil/);
  assert.match(html,/class="rc-piste"/);
  assert.match(html,/data-rc-tout/);
  // l'accueil s'ouvre tout seul — et sans attendre que des lieux existent.
  // Avec le jeu rapide il s'ouvre directement sur les propositions gardées,
  // sinon sur le squelette ; dans les deux cas avant toute requête.
  assert.match(html,/if\(feuilleNiveau === null && !modeNav && !modePose\)\{\s*\n\s*if\(rapide\) ouvrirFeuille2\("racine"\);/);
  assert.match(html,/else ouvrirAccueilFeuille\(\);/);
  assert.doesNotMatch(html,/!modePose && lieux\.length\) ouvrirAccueilFeuille/);
});

test("« Pour toi, maintenant » peut se fermer sur mobile",()=>{
  assert.match(html,/#feuilleBesoins\.accueil \.fb-tete\{position:absolute/);
  assert.match(html,/#feuilleBesoins\.accueil \.fb-x\{box-shadow/);
  assert.match(html,/\$\("#fbFermer"\)\.onclick = fermerFeuille2;/);
  // la règle mobile est réinitialisée dans le panneau desktop
  assert.match(html,/#feuilleBesoins\.accueil \.fb-tete\{position:relative;top:auto;right:auto/);
});

test("les prochains départs n'inventent jamais d'horaire",()=>{
  assert.match(html,/Prochains départs à proximité/);
  assert.match(html,/Aucune donnée temps réel disponible ici/);
  assert.match(html,/typeof T\.nextDepartures !== "function"/);
});

test("les heures affichées suivent le fuseau du lieu",()=>{
  assert.match(html,/function heureLocale\(ts, l\)/);
  assert.match(html,/timeZone:tz/);
  // plus aucun formatage d'heure sans fuseau explicite dans les cartes
  assert.doesNotMatch(html,/rankArrival\)\.toLocaleTimeString\("fr-FR",\{hour:"2-digit",minute:"2-digit"\}\)/);
});

test("la navigation basse suit le produit",()=>{
  assert.match(html,/<nav id="navBas"/);
  for(const t of ["explorer","creer","favoris","profil"])
    assert.match(html,new RegExp('data-nb="'+t+'"'), t);
  // « Autour de moi » et « Pour toi » ouvraient le même écran : un seul reste
  assert.doesNotMatch(html,/data-nb="maintenant"/);
  // Messages n'est plus un onglet permanent : prévenir les participants vit
  // sur l'événement qu'on a créé
  assert.doesNotMatch(html,/data-nb="messages"/);
  // Favoris n'est plus un onglet mort : il liste ce qui est enregistré
  assert.doesNotMatch(html,/data-nb="favoris" aria-disabled/);
  assert.match(html,/if\(id === "favoris"\)\{ ouvrirFavoris\(\); return; \}/);
});

test("la mise en page tient compte des safe areas et de la hauteur réelle",()=>{
  assert.match(html,/height:100dvh/);
  assert.match(html,/--nav-height:calc\(var\(--safe-b\) \+ 58px\)/);
  assert.match(html,/function mesurerHeader/);
  // les bandeaux se posent sous le bord bas mesuré de l'en-tête, plus sous une
  // hauteur devinée — et plus sous sa seule hauteur, qui ignorait son décalage
  assert.match(html,/top:calc\(var\(--header-bas\) \+ 10px\)/);
  assert.match(html,/setProperty\("--header-height", h\.offsetHeight\+"px"\)/);
});

/* ---- Coordination d'événement, pas messagerie -------------------------- */

test("prévenir les participants vit sur l'événement, pas dans une boîte",()=>{
  assert.match(html,/<script src="events\.js\?v=[a-f0-9]{8}"><\/script>/);
  assert.match(html,/function rafraichirCanaux/);
  // aucune boîte de réception générale
  assert.doesNotMatch(html,/data-nb="messages"/);
  assert.match(html,/onglet\.classList\.toggle\("avec-pastille", attente > 0\)/);
  assert.match(html,/Autour n\\u2019a pas de messagerie/);
});

test("le créateur dispose des six actions sur son événement",()=>{
  assert.match(html,/function actionCreateur/);
  for(const a of ["horaire","lieu","retard","places","annonce","annulation"])
    assert.match(html,new RegExp('id === "'+a+'"|"'+a+'"'), a);
  // les actions modifient l'événement : le message système vient de la base
  assert.match(html,/Store\.annuler\(l\.dbId\)/);
  assert.match(html,/Store\.modifierEvenement\(l\.dbId,\{debut_le:iso\}\)/);
});

test("un événement annulé reste affiché",()=>{
  assert.match(html,/une annulation reste une information utile et distincte d'une suppression/);
  assert.match(html,/\.filter\(l=>l\.annule \|\| !estPasse\(l\)\)/);
});

test("le partage couvre le natif et des cibles explicites",()=>{
  assert.match(html,/function partagerInviter/);
  assert.match(html,/Partager \/ Inviter/);
  assert.match(html,/navigator\.share/);
  assert.match(html,/E\.ciblesPartage\(url, texte\)/);
});

test("publier crée le canal et fait apparaître la section",()=>{
  assert.match(html,/publier crée le canal côté base/);
  const i = html.indexOf('fusionner([enligne], "user")');
  assert.ok(i > 0);
  assert.match(html.slice(i, i+220),/rafraichirCanaux\(\)/);
});

test("le nouveau design s'applique à toutes les tailles, sans seconde application",()=>{
  const desktop = html.slice(html.indexOf("@media (min-width:1100px)"),
                             html.indexOf("@media (min-width:1100px)")+2400);
  for(const sel of ["#navBas","#feuilleBesoins"])
    assert.ok(desktop.includes(sel), sel+" doit être adapté au desktop");
  assert.doesNotMatch(desktop,/#appHeader\{[^}]*display:none/);
  assert.doesNotMatch(desktop,/#navBas\{[^}]*display:none/);
});

test("sur desktop la carte occupe toute la fenêtre, sans rail ni sidebar",()=>{
  const desktop = html.slice(html.indexOf("@media (min-width:1100px)"),
                             html.indexOf("/* ---- grappes de marqueurs"));

  // plus aucun rail : la carte n'est décalée par rien
  assert.doesNotMatch(html,/--rail:/);
  assert.match(desktop,/#map\{left:0;right:0;top:0;bottom:0\}/);
  // rien ne réserve de hauteur en bas : la navigation flotte
  assert.match(desktop,/--nav-height:0px/);

  // navigation : une pastille flottante en bas à gauche, jamais pleine hauteur
  assert.match(desktop,/#navBas\{top:auto;bottom:var\(--marge-desktop\);left:var\(--decalage-desktop\);right:auto;width:440px/);
  assert.match(desktop,/border-radius:99px/);

  /* Le panneau tient la gauche, la carte la droite : on lit ce qu'on peut
     faire avant de regarder où c'est. L'en-tête et la recherche se décalent
     donc à droite du panneau quand il est ouvert, et reviennent à gauche
     quand la carte a toute la fenêtre. */
  assert.match(desktop,/#feuilleBesoins\.reduite\{\s*\n\s*left:var\(--marge-desktop\);right:auto/);
  assert.match(desktop,/#appHeader\{left:var\(--decalage-desktop\);right:auto/);
  assert.match(desktop,/body:not\(\.sheet-open\) #appHeader\{left:var\(--marge-desktop\)\}/);
  assert.match(desktop,/#rechercheOverlay\{left:var\(--decalage-desktop\);right:auto/);

  // panneau de résultats : temporaire et fermable, pas une sidebar. La règle
  // .accueil est reprise explicitement, sinon sa spécificité l'emportait et
  // le panneau redevenait une feuille mobile étirée.
  assert.match(desktop,/#feuilleBesoins,#feuilleBesoins\.accueil,#feuilleBesoins\.deplie,\s*#feuilleBesoins\.reduite\{/);
  assert.match(desktop,/width:var\(--panneau\)/);
  assert.match(html,/--panneau:530px/);
  // la croix reste atteignable même sur l'accueil : c'est elle qui rend
  // l'espace à la carte
  assert.match(desktop,/#feuilleBesoins\.accueil \.fb-tete\{[\s\S]*?display:flex/);

  // le carousel horizontal devient une liste verticale
  assert.match(desktop,/\.rc-piste\{flex-direction:column/);
});

test("la hauteur mesurée de la navigation ne rogne pas la carte sur desktop",()=>{
  // la mesure en ligne l'emporte sur le media query : elle doit donc publier
  // elle-même 0 quand la navigation flotte, sinon la carte perd 60px en bas
  assert.match(html,/matchMedia\("\(min-width:1100px\)"\)/);
  assert.match(html,/NAV_FLOTTANTE\.matches \? "0px" : haut\+"px"/);
  assert.match(html,/setProperty\("--nav-flottante", haut\+"px"\)/);
  // l'attribution se range au-dessus de la pastille, pas dessous
  assert.match(html,/#attribution\{left:auto;right:var\(--marge-desktop\);bottom:8px/);
});

test("sur desktop une catégorie garde la recherche réelle à côté du panneau",()=>{
  assert.match(html,/function rechercheDockeeDesktopDemandee\(\)/);
  assert.match(html,/responsiveLayoutState\.isDesktop && !modeNav && !modePose/);
  assert.match(html,/overlay\.classList\.toggle\("recherche-dockee", dockee\)/);
  // Suggestions et panneau restent deux surfaces simultanément interactives.
  assert.match(html,/rechercheDockee && x === NOMS_COUCHES\.mainSheet/);
  assert.match(html,/responsiveLayout\.subscribe\(\(\)=>synchroniserRechercheDesktop\(\)\)/);
  assert.match(html,/const actif = feuilleNiveau === b\.id;/);
  // Même sélection sur desktop et mobile : sept recommandations et leurs
  // marqueurs, pas un apercu différent selon la taille d'écran.
  assert.match(html,/let reco = recommandationsAccueil\(7\)/);
  assert.match(html,/const nombreAffiche = items\.length \|\| \(chargement \? 5 : 0\)/);
});

test("ce qui se range sous l'en-tête s'accroche à son bord bas, pas à sa hauteur",()=>{
  // l'en-tête flotte : il ne commence pas à 0, et son décalage haut change
  // selon le breakpoint. S'accrocher à --header-height le recouvrait.
  assert.match(html,/--header-bas:calc\(var\(--safe-t\) \+ 54px\)/);
  assert.match(html,/setProperty\("--header-bas",\s*\n?\s*Math\.round\(h\.getBoundingClientRect\(\)\.bottom\)\+"px"\)/);
  for(const sel of ["#bandeauGeo,#bandeauVide","#charge"])
    assert.ok(html.includes(sel+"{position:absolute;top:calc(var(--header-bas) + 10px)") ||
              html.includes(sel+"{position:absolute;left:16px;right:16px;\n  top:calc(var(--header-bas) + 10px)"),
              sel+" doit s'accrocher au bord bas de l'en-tête");
});

test("les photos de lieux sont réellement demandées à Google",()=>{
  // sans places.photos, toutes les cartes retombaient sur un emoji
  assert.match(html,/"places\.photos,"/);
  assert.match(html,/function photoGoogle/);
  assert.match(html,/places\.googleapis\.com\/v1\/"\+photo\.name\+/);
  // une photo de lieu ne remplace pas l'affiche d'un événement
  assert.match(html,/if\(meilleur\.image && !l\.image\) l\.image = meilleur\.image;/);
  // le lieu ajouté par Google ne perd pas son image lors de la normalisation
  assert.match(html,/image:f\.image \|\| ""/);
  // et le démarrage rapide la conserve pour la session suivante
  assert.match(html,/const CHAMPS_RAPIDE = \["id","cat","categories","titre","adresse","cp","lat","lng","image",/);
  // les résultats de catégorie affichent la photo sans la mettre sur le chemin critique
  assert.match(html,/class="ac-photo"/);
  assert.match(html,/loading="lazy" decoding="async" fetchpriority="low"/);
});

test("Manger rend visibles les fiches Google complètes dès leur arrivée",()=>{
  assert.match(html,/if\(feuilleNiveau === "manger"\) majFeuille2\(\);/);
  assert.match(html,/function selectionResultatsFeuille\(classement, limite\)\{/);
  assert.match(html,/const objectif = Math\.min\(2, classement\.filter\(complet\)\.length\);/);
  assert.match(html,/const items = selectionResultatsFeuille\(classement,5\);/);
  assert.match(html,/toLocaleString\("fr-FR"\)\+" avis\)"/);
});

test("une fiche Google n'est jamais greffée au seul prétexte qu'elle est proche",()=>{
  assert.match(html,/function nomsLieuxCompatibles\(nomA, nomB\)\{/);
  assert.match(html,/if\(d >= dMin \|\| !nomsLieuxCompatibles\(nomL, nomF\)\) return;/);
  assert.doesNotMatch(html,/const score = memeNom \? d\/4 : d;/);
});

test("une source partielle ne masque pas des résultats déjà utilisables",()=>{
  assert.match(html,/if\(rechercheEnCours\(\)\) return nombreResultats/);
  assert.match(html,/Résultats disponibles · mise à jour incomplète/);
  assert.match(html,/return entete\+liste\+statut;/);
  assert.match(html,/const erreurSansResultat = erreurPartielle && retenus === 0 && feuilleNiveau === null;/);
  // une tentative Google vide reste retentable, notamment depuis Manger
  assert.match(html,/if\(!f \|\| !f\.length\)\{ zonesResto\.delete\(cle\); return \[\]; \}/);
  assert.match(html,/if\(feuilleNiveau === "manger"\) completerRestauration\(\{force:true\}\);/);
});

test("les transports sont chargés mais pas dessinés sans qu'on les demande",()=>{
  assert.match(html,/const CATS_TRANSPORT = new Set\(\["metro","bus","tram","train","velo"\]\);/);
  assert.match(html,/if\(CATS_TRANSPORT\.has\(l\.cat\) && !transportsDemandes\(ctx\)\) return false;/);
  // trois portes d'entrée, et rien d'autre
  assert.match(html,/if\(coucheTransport \|\| modeNav \|\| itineraireOuvert\) return true;/);
  assert.match(html,/if\(catsActives && \[\.\.\.catsActives\]\.some\(c=>CATS_TRANSPORT\.has\(c\)\)\) return true;/);
  assert.match(html,/return !!\(q && CATS_TRANSPORT\.has\(categorieRecherchee\(q\)\)\);/);
  // le bouton transports est un interrupteur de couche
  assert.match(html,/coucheTransport = !coucheTransport;/);
  // ouvrir un itinéraire les rend pertinents, le refermer les range
  assert.match(html,/itineraireOuvert = true;/);
  assert.match(html,/if\(itineraireOuvert\)\{ itineraireOuvert = false; rendre\(\); \}/);
  // la requête Overpass n'est PAS amputée : la donnée reste chargée
  assert.match(html,/node\(around:800,\$\{lat\},\$\{lng\}\)\[highway=bus_stop\]/);
});

test("le plafond de marqueurs suit l'ordre de la sélection de la carte",()=>{
  // il se fiait à dernierClassement, construit ailleurs : dès que les deux
  // listes ne se recouvraient plus — après un déplacement vers une autre ville
  // — aucun lieu n'avait de rang et la carte se vidait entièrement
  assert.match(html,/const retenus = new Set\(liste\.slice\(0, MARQUEURS_MAX_DEZOOME\)\.map\(l=>l\.id\)\);/);
  assert.doesNotMatch(html,/dernierClassement\.forEach\(\(l,i\)=>rang/);
  // un événement publié reste malgré tout affiché
  assert.match(html,/liste\.forEach\(l=>\{ if\(estTemporaire\(l\)\) retenus\.add\(l\.id\); \}\);/);
});

test("le classement se réfère à la zone regardée quand on est parti ailleurs",()=>{
  // « loin de chez toi » n'est pas un défaut d'un lieu quand on regarde
  // volontairement une autre ville : tout Paris est loin de Tourcoing, et la
  // pénalité de distance écartait l'intégralité des résultats demandés
  assert.match(html,/moi: \(rechercheGeo \? \[rechercheGeo\.lat, rechercheGeo\.lng\] : positionMoi\) \|\| \[0,0\],/);
  assert.match(html,/positionReelle: positionMoi \|\| \[0,0\],/);
  assert.match(html,/const \[lat,lng\] = ctx\.moi;/);
});

test("au repos la carte ne porte qu'une poignée de recommandations",()=>{
  assert.match(html,/const MARQUEURS_AU_REPOS = 6;/);
  assert.match(html,/function auRepos\(ctx\)\{/);
  assert.match(html,/const cible = repos \? MARQUEURS_AU_REPOS/);
  // au repos = rien de demandé ; une recherche ou un filtre lève le plafond
  assert.match(html,/return !ctx\.q && !catsActives && filtreActif === "tout" && !filtresHumains\.size/);
});

test("les objets qui désignent le même endroit sont repliés en un marqueur",()=>{
  // le repliement vit dans l'unique entonnoir de ce qui peut s'afficher :
  // placé plus loin, la liste de recommandations choisissait cinq membres du
  // même pôle avant que quiconque ne les replie
  assert.match(html,/function visibles\(\)\{\s*\n\s*return groupLogicalPlaces\(visiblesBruts\(\), distanceM\);\s*\n\}/);
  assert.match(html,/function visiblesBruts\(\)\{/);
  assert.match(html,/regroupesAuto = brut\.reduce\(\(n,l\)=>n \+ \(\(l\.nbRegroupes\|\|1\) - 1\), 0\);/);
  // le regroupement ne compte pas comme un masquage : sinon le bandeau
  // proposerait « tout voir » alors que rien n'a été caché
  assert.match(html,/ecartesAuto = \(brut\.length - admis\.length\) \+ \(avant - notes\.length\);/);
  // et la liste de résultats d'une zone est repliée elle aussi
  assert.match(html,/rankResults\(groupLogicalPlaces\(vivier, distanceM\)/);
});

test("les résultats d'une zone survivent à l'arrivée des données",()=>{
  // Overpass répond une seconde après le déplacement de carte et redessine la
  // feuille : sans cet état, « Pour toi, maintenant » écrasait les résultats
  assert.match(html,/let zoneAffichee = null;/);
  assert.match(html,/if\(feuilleNiveau === "racine" && zoneAffichee\)\{/);
  assert.match(html,/remplirResultatsZone\(zoneAffichee\.nom, zoneAffichee\.intention\);/);
  // et il se relâche quand on revient à soi ou qu'on relance une recherche
  assert.match(html,/zoneAffichee = null;\s*\/\/ la feuille reprend ses recommandations locales/);
  assert.match(html,/zoneAffichee = null;\s*\/\/ une nouvelle recherche remplace la précédente/);
  // déclaré tôt : majFeuille2 le lit dès le premier rendu
  const decl = html.indexOf("let zoneAffichee = null;");
  assert.ok(decl < html.indexOf("function majFeuille2"), "zoneAffichee doit précéder majFeuille2");
});

test("« Maintenant » masque les lieux fermés, les filtres les rendent",()=>{
  assert.match(html,/if\(\(creneau === "maintenant" \|\| filtreMaintenant\) && !montrerFermes && estFerme\(l\)\) return false;/);
  assert.match(html,/data-fermes="1"/);
  assert.match(html,/montrerFermes = !montrerFermes;/);
});

test("les étiquettes ne sortent pas de l'écran et ne se recouvrent pas",()=>{
  assert.match(html,/const MARGE_ECRAN = 6;/);
  // mesure réelle : le marqueur est centré par une transformée CSS, une boîte
  // calculée à la main donnait une position fausse
  assert.match(html,/const r = eti\.getBoundingClientRect\(\);/);
  assert.match(html,/b\.x >= MARGE_ECRAN && b\.x \+ b\.w <= taille\.x - MARGE_ECRAN/);
  assert.match(html,/b\.y >= MARGE_ECRAN && b\.y \+ b\.h <= taille\.y - MARGE_ECRAN/);
  // seconde chance de l'autre côté de la pastille avant de s'effacer
  assert.match(html,/eti\.classList\.add\("a-gauche"\);/);
  assert.match(html,/\.poi-eti\.a-gauche\{order:-1/);
});

test("les étiquettes de la carte gèrent leurs collisions",()=>{
  assert.match(html,/function resoudreCollisions/);
  // priorité donnée à la sélection de la CARTE, pas aux recommandations de la
  // feuille : les deux divergent dès qu'on regarde une autre zone, et tous les
  // lieux affichés se retrouvaient alors à égalité
  assert.match(html,/derniereSelection\.forEach\(\(x,i\)=>rang\.set\(x\.l\.id, i\)\)/);
  assert.match(html,/\.poi-eti\.masquee\{display:none\}|\.poi-eti,\.poi-eti\.masquee\{display:none\}/);
  assert.match(html,/requestAnimationFrame\(resoudreCollisions\)/);
});

test("un système d'espacement cohérent, sans élément collé aux bords",()=>{
  assert.match(html,/#rechercheOverlay\{[^}]*padding:calc\(var\(--safe-t\) \+ 10px\) 16px 14px/s);
  assert.match(html,/\.fb-corps\{[^}]*padding:0 16px/s);
  assert.match(html,/\.rond-flottant\{position:absolute;right:16px/);
});

test("les événements créés peuvent porter une image stockée dans Supabase",()=>{
  assert.match(html,/async televerserImage\(fichier\)/);
  // chemin préfixé par l'uid : c'est ce que la RLS du stockage vérifie
  assert.match(html,/const chemin = moiId\+"\/"\+Date\.now\(\)/);
  assert.match(html,/sb\.storage\.from\("evenements"\)/);
  assert.match(html,/image_url:l\.image \|\| null/);
  assert.match(html,/image:p\.image_url \|\| p\.image \|\| ""/);
  // l'image monte pendant que l'affiche est déjà sur la carte : la publication
  // est optimiste, mais l'insertion en base porte bien l'URL définitive
  assert.match(html,/const image = b\.imageFichier \? await Store\.televerserImage\(b\.imageFichier\) : "";/);
  assert.match(html,/Store\.publier\(Object\.assign\(\{\}, l, \{image\}\)\)/);
  // et un aperçu local s'affiche tout de suite, sans attendre le téléversement
  assert.match(html,/image: b\.imageFichier \? URL\.createObjectURL\(b\.imageFichier\) : "",/);
});

test("le formulaire propose une photo sans l'imposer",()=>{
  assert.match(html,/id="fPhoto"/);
  assert.match(html,/\(facultatif\)/);
  // rien n'est téléversé tant que l'événement n'est pas publié
  assert.match(html,/qu'à la publication/);
  // le refus ne tombe qu'après tentative de réduction
  assert.match(html,/Image trop lourde, même après réduction/);
});

test("aucun gros emoji ne sert d'image finale",()=>{
  // le repli est une tuile teintée par la catégorie, pas un emoji géant
  assert.match(html,/\.rc-photo-vide\{position:relative;display:grid;place-items:center;/);
  assert.match(html,/\.rc-photo-vide i\{[^}]*font-size:20px/);
  assert.doesNotMatch(html,/\.rc-photo-vide\{display:grid;place-items:center;font-size:32px\}/);
});

/* ---- Passe simplification + performance -------------------------------- */

test("le carousel de catégories ne coupe jamais une pill aux bords",()=>{
  assert.match(html,/\.pills\{[^}]*padding-inline:16px;scroll-padding-inline:16px/s);
  assert.match(html,/\.pills\{[^}]*overflow-x:auto/s);
  assert.match(html,/scroll-snap-type:x proximity/);
  assert.match(html,/\.pills\{[^}]*scrollbar-width:none/s);
  assert.match(html,/\.rc\{scroll-snap-align:start\}/);
});

test("les filtres ne flottent plus sur la carte et sont limités à trois",()=>{
  assert.match(html,/#filtresHumains\{display:flex/);
  assert.doesNotMatch(html,/#filtresHumains\{position:absolute/);
  assert.match(html,/visibles\.slice\(0,3\)/);
  // ils ne sortent que sur demande, ou si un filtre est déjà actif
  assert.match(html,/const montrer = demande \|\| actifs;/);
});

test("Partager ne vit plus sur la carte",()=>{
  assert.match(html,/\["#navBas","#appHeader","#btnTransports","#attribution"\]/);
  assert.doesNotMatch(html,/\$\("#btnPartager"\)\.hidden=false/);
  assert.match(html,/Partager ne vit que sur la fiche d'un lieu/);
});

test("les marqueurs sont plafonnés quand la carte est dézoomée",()=>{
  assert.match(html,/const MARQUEURS_MAX_DEZOOME = 10;/);
  assert.match(html,/function limiterMarqueurs/);
  assert.match(html,/const choisis = limiterMarqueurs\(selectionner\(\)\);/);
  // un événement publié n'est jamais masqué
  assert.match(html,/if\(estTemporaire\(l\)\) retenus\.add\(l\.id\);/);
});

test("les images du carousel sont paresseuses et n'attendent rien",()=>{
  assert.match(html,/loading="lazy" decoding="async"/);
  assert.match(html,/\.rc-photo img\{position:absolute;inset:0;z-index:2/);
  assert.match(html,/\.rc-photo img\.vue\{opacity:1\}/);
});

test("les étapes de démarrage sont mesurables",()=>{
  assert.match(html,/window\.AutourPerf = PERF;/);
  for(const jalon of ["ui_ready","map_ready","geolocation_ready","cached_pois_visible",
                      "fresh_pois_ready","transport_ready","images_ready","markers_ready"])
    // le guillemet est parfois échappé dans une chaîne : on cherche le nom
    assert.match(html,new RegExp("jalon\\(.{0,2}"+jalon), jalon);
  assert.match(html,/first-contentful-paint/);
  // un jalon décrit un premier instant : il ne se remarque qu'une fois
  assert.match(html,/if\(this\.vus\.has\(nom\)\) return;/);
});

test("changer de catégorie ne relance pas Overpass si les lieux sont en mémoire",()=>{
  // index O(1) plutôt qu'un balayage de la liste à chaque changement
  assert.match(html,/const indexCategories = new Map\(\);/);
  assert.match(html,/function categorieEnMemoire/);
  assert.match(html,/const manquantes = cats\.filter\(c=>!categorieEnMemoire\(c\)\);/);
  assert.match(html,/if\(!manquantes\.length\) return Promise\.resolve\(\[\]\);/);
  // l'index précède le rendu, sinon le classement lirait un état périmé
  assert.match(html,/l'index doit précéder le rendu/);
});

test("créer demande QUOI avant OÙ",()=>{
  assert.match(html,/function ouvrirCreation/);
  assert.match(html,/Que veux-tu ajouter/);
  assert.match(html,/creer-type" data-type="/);
  // le bouton n'ouvre plus directement le mode pose
  assert.doesNotMatch(html,/\$\("#btnAjouter"\)\.onclick=\(\)=>\{ retourFormulaire=false; ouvrirModePose\(\); \};/);
  // le type choisi préremplit le brouillon au lieu d'être redemandé
  assert.match(html,/cat:typeAvantPose \|\| "popup"/);
});

test("l'envoi d'image accepte ce que produit réellement un téléphone",()=>{
  // accept restreint à jpeg/png/webp excluait le HEIC des iPhone : envoyer une
  // photo depuis un téléphone était de fait impossible
  assert.match(html,/id="fPhoto" accept="image\/\*"/);
  assert.doesNotMatch(html,/accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html,/function preparerImage/);
  assert.match(html,/imageOrientation:"from-image"/);      // EXIF respecté
  assert.match(html,/const IMAGE_COTE_MAX = 1600;/);
  assert.match(html,/toBlob\(r, "image\/jpeg", \.82\)/);
  // un format illisible ne bloque pas la publication
  assert.match(html,/return null;   \/\/ format illisible/);
});

/* ---- Favoris et fiche compacte ----------------------------------------- */

test("les favoris couvrent un lieu externe comme un événement Autour",()=>{
  assert.match(html,/function refFavori/);
  assert.match(html,/publication_id: l\.dbId \|\| null/);
  assert.match(html,/lieu_ref: l\.dbId \? null : refFavori\(l\)/);
  // instantané conservé : sans lui la liste serait vide hors de la zone
  assert.match(html,/titre: l\.titre \|\| "Sans titre"/);
});

test("le cœur bascule immédiatement et se remet en place si la base refuse",()=>{
  assert.match(html,/async function basculerFavori/);
  assert.match(html,/if\(etait\) favorisIds\.delete\(cle\); else favorisIds\.add\(cle\);/);
  // rétablissement en cas d'échec
  assert.match(html,/if\(etait\) favorisIds\.add\(cle\); else favorisIds\.delete\(cle\);/);
  assert.match(html,/Impossible d’enregistrer ce favori/);
});

test("l'identité anonyme n'est créée qu'au premier geste qui en a besoin",()=>{
  assert.match(html,/l'identité anonyme n'est créée qu'ici, au moment où elle sert/);
  assert.match(html,/if\(!\(await assurerSessionAnonyme\(\)\)\)\{/);
  // une simple lecture initialise le client, elle ne crée pas  un utilisateur
  const connecter = html.slice(html.indexOf("async function connecter"), html.indexOf("let pSessionAnonyme"));
  assert.doesNotMatch(connecter,/signInAnonymously/);
});

test("un tap sur un marqueur ouvre la fiche compacte, pas le panneau complet",()=>{
  assert.match(html,/mettreAJourProfil\("clic", l\.cat\); ouvrirFicheCompacte\(l\);/);
  // sauf une affiche dont l'envoi a échoué : l'appui la retente
  assert.match(html,/if\(l\.envoi === "echec"\)\{ reessayerPublication\(l\.id\); return; \}/);
  assert.match(html,/function ouvrirFicheCompacte/);
  assert.match(html,/class="fc-voir">Voir/);
  // « Voir » seulement ensuite ouvre le détail
  assert.match(html,/fermerFicheCompacte\(\); pileEcrans=\[\]; pousserEcran\(\(\)=>ouvrirDetail\(l\.id\)\);/);
});

test("la fiche compacte propose Partager et, au créateur, Prévenir",()=>{
  assert.match(html,/const mien = estPublicationAMoi\(l\);/);
  assert.match(html,/l\.dbId \? '<button class="fc-part">Partager<\/button>' : ''/);
  assert.match(html,/mien \? '<button class="fc-prevenir">Prévenir<\/button>' : ''/);
});

/* ---- Démarrage perçu ---------------------------------------------------- */

test("le cache est retrouvé même si on ouvre l'app un peu plus loin",()=>{
  // la clé est arrondie à ~110 m : sans tolérance, un pas de côté ratait le cache
  assert.match(html,/const CACHE_RAYON_M = 1200;/);
  assert.match(html,/function lireCacheProche/);
  assert.match(html,/const enCache = lireCacheProche\(lat,lng\);/);
});

test("l'échantillon immédiat est réel et varié, jamais inventé",()=>{
  assert.match(html,/const ECHANTILLON_MAX = 5;/);
  assert.match(html,/function echantillonImmediat/);
  // les favoris d'abord, puis une entrée par famille
  assert.match(html,/candidats\.filter\(l=>estFavori\(l\)\)\.forEach\(prendre\)/);
  assert.match(html,/FAMILLES_ECHANTILLON\.forEach/);
  // il sort des lieux déjà chargés, pas d'un jeu fabriqué
  assert.match(html,/echantillonImmediat\(lieux\.filter\(nomExploitable\)\)/);
});

test("le préchargement suit l'usage réel et ne bloque jamais",()=>{
  assert.match(html,/function categoriesProbables/);
  assert.match(html,/PROFIL\.categories/);
  assert.match(html,/const parFavoris = \[\.\.\.favorisEnMemoire\.values\(\)\]/);
  assert.match(html,/window\.requestIdleCallback \|\| \(f=>setTimeout\(f, 1200\)\)/);
  assert.match(html,/quandLibre\(\(\)=>prechargerCategories\(\)\);/);
});

/* ---- Le fond de carte ---------------------------------------------------
   Deux régressions de la passe « instant-first » avaient rendu la carte
   vide : le fond confié à un `requestIdleCallback` sans échéance, et la
   carte construite avant la feuille de style qui place ses tuiles. Ces
   quatre contrôles tiennent les deux fermées. */

test("le fond de carte est demandé dans la foulée de L.map, pas au repos",()=>{
  const debut = html.indexOf('map = L.map("map"');
  const fin   = html.indexOf("function attendreLeaflet");
  assert.ok(debut > 0 && fin > debut);
  const corps = html.slice(debut, fin);
  // poserFond() est appelé directement, jamais derrière un différé
  assert.match(corps,/\n  poserFond\(\)\.then\(fond=>\{/);
  assert.doesNotMatch(corps,/quandLibre\(\(\)=>\{[\s\S]*poserFond\(\)/);
});

test("rien de différé n'attend un temps mort qui peut ne jamais venir",()=>{
  // sans `timeout`, requestIdleCallback n'a aucune échéance : au démarrage,
  // le fil principal ne se tait pas, et le rappel n'arrive jamais
  assert.match(html,/window\.requestIdleCallback\s*\n?\s*\?\s*window\.requestIdleCallback\(f, \{timeout: 1500\}\)/);
});

test("la carte n'est pas construite avant la feuille de style de Leaflet",()=>{
  assert.match(html,/function styleCartePret\(\)/);
  assert.match(html,/if\(!styleCartePret\(\)\) return false;/);
  // et l'arrivée de la feuille installe la carte restée en attente
  assert.match(html,/else installerCarte\(\);/);
});

test("un CDN muet coûte le style, jamais la carte",()=>{
  assert.match(html,/const CSS_CARTE_ATTENTE_MAX = 3000;/);
  assert.match(html,/lien\.media = "all";/);
});

/* ---- Retrouver ce qu'on a publié ----------------------------------------- */

test("les publications ne sont pas demandées sur le seul rectangle visible",()=>{
  /* `chargerPublications` interrogeait la base sur l'emprise VISIBLE. Sur un
     téléphone au zoom 16 elle fait 589 m de large (390 points à 1,5 m). Deux
     événements publiés à 380 et 560 m tombaient dehors et n'étaient jamais
     demandés — alors qu'ils s'affichaient sur un écran large. Un défaut qui
     dépendait de la largeur de l'écran, donc invisible en développement. */
  assert.match(html,/const RAYON_PUBLICATIONS_M = 5000;/);
  assert.match(html,/function emprisePublications\(lat, lng\)\{/);
  assert.match(html,/const b = emprisePublications\(lat, lng\);/);
  // l'ancien repli ±0,06° ne doit pas revenir déguisé
  assert.doesNotMatch(html,/const b = bornesVisibles\(\) \|\|/);
});

test("l'emprise des publications reste centrée sur le point demandé",()=>{
  /* Faire l'union avec la vue produisait, le temps que la carte rattrape la
     position, une boîte allant de Paris à Tourcoing. */
  assert.match(html,/dLat = Math\.max\(dLat, Number\(vue\.n\) - c\.lat\);/);
  assert.match(html,/dLng = Math\.max\(dLng, Number\(vue\.e\) - c\.lng\);/);
  assert.match(html,/return \{ s:lat-dLat, n:lat\+dLat, o:lng-dLng, e:lng\+dLng \};/);
});

/* ---- À distance un aperçu, sur place la découverte ------------------------
   Une ville qu'on regarde de loin et une ville où l'on est ne méritent pas la
   même réponse — ni le même coût. La graduation se fait par kilomètres et non
   par frontière communale : quelqu'un à trois cents mètres du panneau vit la
   même ville que celui qui est trois cents mètres après. */

test("quatre régimes gradués par distance, pas une frontière",()=>{
  assert.match(html,/const REGIMES = \{/);
  for(const [nom, n] of [["local",10],["proche",5],["voisine",4],["loin",3]])
    assert.match(html, new RegExp(nom+":\\s*\\{ resultats:\\s*"+n),
      "le régime "+nom+" doit montrer "+n+" résultats");
  assert.match(html,/const SEUIL_LOCAL_M   = 8000;/);
  assert.match(html,/const SEUIL_PROCHE_M  = 30000;/);
  assert.match(html,/const SEUIL_VOISINE_M = 120000;/);
  // l'emprise reconnaît qu'on est DANS la ville, elle n'exclut jamais un riverain
  assert.match(html,/dansEmprise\(pos, zone\.emprise\) \|\| d <= SEUIL_LOCAL_M/);
});

test("seul le GPS ouvre le régime local",()=>{
  // une ville choisie à la main ou déduite de l'IP n'est pas une présence
  assert.match(html,/const sure = mesuree === undefined \? positionPrecise\(\) : !!mesuree;/);
  assert.match(html,/if\(sure && \(dansEmprise/);
  assert.match(html,/if\(!pos\) return "loin";/);
});

test("une ville lointaine n'est pas interrogée comme une ville où l'on est",()=>{
  // le rayon et le plafond suivent le régime…
  assert.match(html,/const regl = o\.reglages \|\| REGIMES\[regimePoint\(lat, lng\)\];/);
  assert.match(html,/rayon:regl\.rayon, limite:regl\.limite/);
  // …et l'emprise entière n'est demandée qu'en local
  assert.match(html,/large \? bornesVisibles\(\) : null/);
  // Google non plus : ses notes ne serviront à personne, et chaque appel est facturé
  assert.match(html,/if\(!o\.cats && large\) travaux\.push\(/);
  /* `regimePoint` protège aussi les rechargements déclenchés par la carte :
     sans lui, un déplacement vers Marseille repartait en pleine charge par la
     porte de derrière. */
  assert.match(html,/function regimePoint\(lat, lng\)\{/);
});

test("la position est veillée, pas seulement demandée",()=>{
  /* Il n'y avait qu'un `getCurrentPosition`, à la demande, acceptant un relevé
     vieux de DEUX MINUTES. Pire : une fois obtenue au démarrage, la position
     n'était plus jamais mise à jour. Traverser la ville ne changeait rien tant
     qu'on n'appuyait pas sur le bouton. Mesuré : jamais remarqué. */
  assert.match(html,/navigator\.geolocation\.watchPosition\(/);
  assert.match(html,/function veillerSurLaPosition\(\)\{/);
  assert.match(html,/function arreterLaVeille\(\)\{/);
  // la veille lit toujours frais ; la demande ponctuelle tolère 30 s, pas 120
  assert.match(html,/\{enableHighAccuracy:true, maximumAge:0, timeout:20000\}/);
  assert.match(html,/\{enableHighAccuracy:true, timeout:8000, maximumAge:30000\}/);
  assert.doesNotMatch(html,/maximumAge:120000/);
});

test("la veille s'arrête quand personne ne regarde",()=>{
  // suivre quelqu'un dont l'écran est éteint coûterait sa batterie pour rien
  assert.match(html,/document\.addEventListener\("visibilitychange"/);
  assert.match(html,/if\(document\.visibilityState === "hidden"\)\{ arreterLaVeille\(\); return; \}/);
  // et au retour on redemande tout de suite : la personne a pu faire dix km
  assert.match(html,/veillerSurLaPosition\(\); suivreMaPosition\(\{silencieux:true\}\);/);
});

test("la veille ne vole pas la carte à qui la regarde",()=>{
  // un recentrage pendant qu'on fait glisser la carte du doigt serait odieux
  assert.match(html,/if\(bouge && !o\.discret\) allerVers\(c, 16/);
  assert.match(html,/appliquerPosition\(p, \{discret:true\}\);/);
  // un franchissement de régime passe devant les garde-fous : c'est l'instant attendu
  assert.match(html,/const bascule = regimeZone\(rechercheGeo, c, true\) !== regimeZone\(rechercheGeo\);/);
  assert.match(html,/if\(!bascule\)\{/);
  assert.match(html,/const VEILLE_MIN_M = 120;/);
  assert.match(html,/const VEILLE_MIN_MS = 20000;/);
});

test("arriver dans la ville regardée fait basculer en mode local, tout seul",()=>{
  assert.match(html,/const regimeAvant = regimeZone\(rechercheGeo\);/);
  assert.match(html,/if\(regimeAvant !== "local" && regimeZone\(rechercheGeo\) === "local"\)\{/);
  // et on redemande le quartier pour de bon, cette fois
  assert.match(html,/\{force:true, reglages:REGIMES\.local\}\);/);
  assert.match(html,/planifierRendu\(\{accueil:true, feuille:true, carte:true\}\);/);
});

test("une liste courte dit qu'elle est courte exprès",()=>{
  assert.match(html,/function noteApercu\(nom\)\{/);
  assert.match(html,/if\(r === "local"\) return "";/);
  // aucun bouton, aucun réglage : la promesse est tenue par la géolocalisation
  assert.doesNotMatch(html,/rc-apercu[^"]*"><button/);
  assert.match(html,/\.rc-apercu\{/);
});

/* ---- Chercher un foyer ---------------------------------------------------
   « J'ai tapé foyer à Lille, il n'a rien trouvé. » La famille Hébergement ne
   demandait que `social_facility=shelter|group_home` et `amenity=refugee_site`
   — trois valeurs, quand le parc social français en utilise une dizaine. Et
   `amenity=social_facility`, le tag le plus répandu du secteur, était rangé
   dans « asso » : une recherche d'hébergement ne le DEMANDAIT même pas. */

test("l'hébergement couvre les tags qui portent réellement le parc social",()=>{
  for(const v of ["homeless_shelter","emergency_shelter","assisted_living","nursing_home"])
    assert.match(html, new RegExp('\\["social_facility","'+v+'","hebergement"\\]'),
      v+" n'est pas demandé");
  assert.match(html,/\["amenity","dormitory","hebergement"\]/);
});

test("un abribus n'entre jamais dans l'hébergement",()=>{
  // `amenity=shelter` est un abri de bus : il n'a rien à faire ici
  assert.doesNotMatch(html,/\["amenity","shelter","hebergement"\]/);
});

test("un tag vague est demandé pour toutes les familles qu'il peut servir",()=>{
  assert.match(html,/const TAGS_PARTAGES = \[/);
  assert.match(html,/\["amenity","social_facility", \["asso","hebergement","alimentaire"\]\]/);
  // et le constructeur de requête les ajoute vraiment
  assert.match(html,/TAGS_PARTAGES\.forEach\(\(\[k,v,cats\]\)=>\{/);
  assert.match(html,/if\(garder && !cats\.some\(c=>garder\.has\(c\)\)\) return;/);
});

test("ouvrir Aide charge réellement les catégories d'aide",()=>{
  /* Le besoin « aide » n'a pas de `sous` — c'est un mode entier, pas une
     liste de cases. La branche de chargement testait `b.sous` : ouvrir Aide
     ne demandait donc AUCUNE catégorie, et `CATS_DEPART` n'en contient pas
     davantage. Mesuré : zéro requête, zéro lieu, dans toutes les villes. */
  assert.match(html,/const cats = \(niveau === "aide" \|\| \(b && b\.aide\)\) \? CATS_AIDE/);
  assert.match(html,/: \(b && b\.sous\) \? b\.sous\.flatMap\(x=>x\.cats\)/);
  assert.match(html,/if\(cats\)\{\s*\n\s*const manquantes = cats\.filter\(c=>!CATS_DEPART\.has\(c\)\);/);
  // et le besoin « aide » est bien celui qui n'a pas de sous-catégories
  assert.match(html,/\{ id:"aide", emoji:"❤️", label:"Trouver de l’aide", aide:true \}/);
});

test("un social_facility sans sous-tag est classé par son nom",()=>{
  assert.match(html,/const NOM_HEBERGEMENT = /);
  assert.match(html,/const NOM_ALIMENTAIRE = /);
  assert.match(html,/function affinerCategorie\(cat, nom, tags\)\{/);
  assert.match(html,/tags\.amenity === "social_facility" && !tags\.social_facility/);
  // et le classifieur lui passe bien les tags, sinon la règle ne sert à rien
  assert.match(html,/affinerCategorie\(regle\[2\], t\.name, t\)/);
  // « foyer » doit rester le mot qui mène à l'hébergement
  assert.match(html,/hebergement:\["hebergement","dormir","abri","foyer"/);
});

/* ---- Carte dominante ---------------------------------------------------- */

test("la recherche est un bouton loupe, pas une barre permanente",()=>{
  assert.match(html,/id="btnLoupe" aria-label="Rechercher"/);
  assert.match(html,/function ouvrirRecherche/);
  assert.match(html,/function fermerRecherche/);
  assert.match(html,/<div id="rechercheOverlay" hidden/);
  // les catégories vivent dans l'overlay : l'écran de départ reste nu
  assert.match(html,/<div id="rechercheOverlay"[\s\S]{0,1600}id="raccourcis" class="pills"/);
});

test("la touche Retour du clavier lance réellement la recherche",()=>{
  // un vrai <form> : c'est lui qui fait valider la touche « rechercher » des
  // claviers mobiles. Écouter keydown seul laissait iOS sans action.
  assert.match(html,/<form class="ro-barre" id="formRech" role="search"/);
  assert.match(html,/enterkeyhint="search"/);
  assert.match(html,/\$\("#formRech"\)\.addEventListener\("submit", e=>\{ e\.preventDefault\(\); lancerRecherche\(\); \}\)/);
  // le clavier se referme avant que la carte ne bouge, sinon il la masque
  assert.match(html,/champ\.blur\(\);\s+\/\/ referme le clavier/);
  assert.match(html,/fermerRecherche\(\);/);
  // les boutons de la barre ne soumettent pas le formulaire
  assert.match(html,/id="btnFermerRech" type="button"/);
  assert.match(html,/id="btnFiltres" type="button"/);
});

test("les suggestions distinguent une destination d'une intention",()=>{
  // en tapant un nom de commune, la liste ne proposait que des catégories et
  // des lieux déjà chargés : aucune façon visible d'aller là-bas
  assert.match(html,/const decoupe = parseSearchQuery\(q, DECOUPAGE\);/);
  assert.match(html,/if\(dest && ressembleAUneZone\(dest\)\)\{/);
  assert.match(html,/sug\.push\(\{emo:"📍", lab:dest, sous:"destination", texte:dest\}\);/);
  assert.match(html,/sous:"intention · destination"/);
  assert.match(html,/const SUGGESTIONS_INTENTION = \[/);
  // une suggestion de destination emprunte le même chemin que la touche Retour
  assert.match(html,/if\(x\.texte\)\{ \$\("#rech"\)\.value = x\.texte; lancerRecherche\(\); return; \}/);
});

test("changer de catégorie ne relance pas le réseau si les lieux sont là",()=>{
  assert.match(html,/const manquantes = cats\.filter\(c=>!categorieEnMemoire\(c\)\);/);
  assert.match(html,/if\(!manquantes\.length\) return Promise\.resolve\(\[\]\);/);
  // le rail de besoins passe bien par ce filtre — Aide comprise, désormais
  assert.match(html,/const manquantes = cats\.filter\(c=>!CATS_DEPART\.has\(c\)\);/);
  assert.match(html,/if\(manquantes\.length\) chargerPourCats\(manquantes\);/);
});

test("le nom accessible du panneau ne porte plus l'ancien CTA",()=>{
  // « Que faire autour de moi ? » était invisible à l'œil mais annoncé tel
  // quel par un lecteur d'écran avant le premier rendu
  assert.doesNotMatch(html,/id="fbTitre">Que faire autour de moi/);
  assert.match(html,/<span class="fb-titre" id="fbTitre">Pour toi, maintenant<\/span>/);
});

test("une requête composée sépare destination et intention",()=>{
  // un seul jeu de prédicats, partagé par la barre et les suggestions
  assert.match(html,/parseSearchQuery\(q, DECOUPAGE\)/);
  assert.match(html,/const DECOUPAGE = \{/);
  assert.match(html,/isIntent: \(t\)=>intentionConnue\(t\),/);
  assert.match(html,/isWholeIntent: \(t\)=>estTermeMetier\(t\),/);
  // sans ce troisième prédicat on coupait n'importe où : « Lille restaurant
  // indien » visait la destination « indien »
  assert.match(html,/isDestination: \(t\)=>ressembleAUneZone\(t\),/);
  assert.match(html,/if\(destination && ressembleAUneZone\(destination\)\)\{/);
  // la zone accompagne l'intention : c'est ce qui produit la puce [Lille]
  assert.match(html,/if\(intention\) appliquerIntention\(intention, destination\);/);
  assert.match(html,/ouvrirResultatsZone\(destination, intention\);/);
  // un géocodage muet ne se fait pas passer pour un succès
  assert.match(html,/toast\("Lieu introuvable : "\+destination\)/);
});

test("une recherche géographique déplace la carte et montre peu de résultats",()=>{
  assert.match(html,/function ressembleAUneZone/);
  assert.match(html,/function rechercheGeographique/);
  assert.match(html,/\.slice\(0, plafondResultats\(\)\)/);
  // on ne géocode pas « pizza », mais on géocode « Bar-le-Duc » : la
  // comparaison est exacte, plus par sous-chaîne
  assert.match(html,/if\(estTermeMetier\(texte\)\) return false;/);
});

test("aucune ville n'est écrite dans le code",()=>{
  // le seul savoir territorial vient du géocodeur. Une condition du genre
  // « si la ville vaut Lille » figerait le produit sur un terrain.
  const code = html.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code,/===\s*["']Lille["']/i);
  assert.doesNotMatch(code,/ville\s*===/i);
  // pas de liste de communes en dur non plus
  assert.doesNotMatch(code,/\[\s*["']Paris["']\s*,/i);
});

test("le cadrage suit l'emprise réelle de la zone, bornée des deux côtés",()=>{
  // un zoom fixe ne peut convenir à la fois à un hameau et à une métropole
  assert.match(html,/const ZOOM_ZONE_MAX = 15;/);
  // la borne basse n'est pas choisie : c'est le seuil de chargement lui-même.
  // Les laisser diverger posait la carte sur Paris au zoom 12, où chargerZone
  // refuse de partir — bon endroit, écran vide, aucune explication.
  assert.match(html,/const ZOOM_ZONE_MIN = ZOOM_MIN_CHARGEMENT;/);
  assert.match(html,/if\(!map \|\| map\.getZoom\(\) < ZOOM_MIN_CHARGEMENT\) return Promise\.resolve\(\[\]\);/);
  // et il doit être déclaré avant d'être lu : une zone morte temporelle ici
  // casse tout le script au démarrage
  assert.ok(html.indexOf("const ZOOM_MIN_CHARGEMENT = 13;") <
            html.indexOf("const ZOOM_ZONE_MIN = ZOOM_MIN_CHARGEMENT;"),
    "ZOOM_MIN_CHARGEMENT doit précéder ZOOM_ZONE_MIN");
  assert.match(html,/cadrerSur\(zone\.emprise, \{maxZoom:ZOOM_ZONE_MAX/);
  assert.match(html,/if\(m\.getZoom\(\) < ZOOM_ZONE_MIN\) m\.setZoom\(ZOOM_ZONE_MIN\);/);
  // repli si le géocodeur ne fournit pas d'emprise
  assert.match(html,/allerVers\(\[zone\.lat, zone\.lng\], ZOOM_ZONE_MAX/);
});

test("le géocodeur départage les homonymes sans privilégier un pays",()=>{
  assert.match(html,/limit=5/);
  assert.match(html,/const ECART_IMPORTANCE = 0\.15;/);
  // à importance comparable, le plus proche de l'endroit regardé
  assert.match(html,/const d = distanceM\(depuis\[0\], depuis\[1\], parseFloat\(x\.lat\), parseFloat\(x\.lon\)\);/);
  assert.match(html,/boundingbox/);
});

test("le nom de la zone cesse d'être un filtre plein texte une fois arrivé",()=>{
  // sinon « Lille » faisait remonter « Gare Lille Flandres » au titre de
  // correspondance explicite — donc des arrêts, que cette passe range
  const i = html.indexOf("async function rechercheGeographique");
  const bloc = html.slice(i, i + 1800);
  assert.match(bloc,/recherche = "";/);
  assert.match(bloc,/if\(\$\("#rech"\)\) \$\("#rech"\)\.value = "";/);
});

test("un seul point de référence après un déplacement : celui de la carte",()=>{
  // le géocodeur donne aussi un « point de la commune » qui n'est pas le
  // centre de l'emprise — 2,9 km d'écart à Bordeaux. Charger autour de l'un et
  // classer depuis l'autre mettait tous les lieux hors du rayon de recherche.
  assert.match(html,/const c = map\.getCenter\(\);/);
  assert.match(html,/const centre = c \? \[c\.lat, c\.lng\] : \[zone\.lat, zone\.lng\];/);
  assert.match(html,/rechercheGeo = \{nom:q, lat:centre\[0\], lng:centre\[1\], emprise:zone\.emprise \|\| null\};/);
  assert.match(html,/chargerZone\(centre\[0\], centre\[1\], \{reglages: reglagesZone\(rechercheGeo\)\}\);/);
  // et il est fixé APRÈS le cadrage, sinon il décrit l'ancienne vue
  assert.ok(html.indexOf("map.fitBounds(zone.emprise") <
            html.indexOf("rechercheGeo = {nom:q, lat:centre[0]"),
    "le point de référence se lit après le cadrage");
});

test("les recommandations gardent leur épingle malgré le regroupement",()=>{
  // un quartier dense se réduisait à une seule grappe : la carte devenait
  // juste et inutilisable — on demandait Paris, on obtenait un rond « 24 »
  assert.match(html,/const EPINGLES_PRIORITAIRES = 6;/);
  assert.match(html,/const epingles = new Set\(liste\.slice\(0, EPINGLES_PRIORITAIRES\)\.map\(l=>l\.id\)\);/);
  assert.match(html,/if\(epingles\.has\(l\.id\)\)\{ seuls\.push\(\{seul:l\}\); return; \}/);
});

test("le vocabulaire métier se compare exactement, pas par sous-chaîne",()=>{
  assert.match(html,/const MOTS_BESOINS = \(\(\)=>\{/);
  // déclaré APRÈS BESOINS, qu'il parcourt : l'inverse levait une zone morte
  // temporelle qui cassait tout le script au démarrage
  assert.ok(html.indexOf("const BESOINS = [") < html.indexOf("const MOTS_BESOINS"),
    "MOTS_BESOINS doit suivre BESOINS");
  assert.match(html,/function estTermeMetier\(texte\)\{/);
  assert.match(html,/return INDEX_MOTS\.has\(t\) \|\| MOTS_BESOINS\.has\(t\);/);
  // les besoins « chiller », « sortir », « bouger » comptent comme intentions
  assert.match(html,/const FILTRES_INTENTION = new Set\(\["famille","etudier","monde","libre"\]\);/);
  // un besoin applique toutes ses catégories, pas une seule
  assert.match(html,/if\(bes && bes\.sous\)\{ catsActives = new Set\(bes\.sous\.flatMap\(x=>x\.cats\)\);/);
  // les contraintes tapées dans la phrase s'appliquent aussi
  assert.match(html,/if\(a && a\.filtres && a\.filtres\.size\) a\.filtres\.forEach\(f=>filtresHumains\.add\(f\)\);/);
});

test("« Revenir autour de moi » apparaît dès que la carte s'est déplacée",()=>{
  assert.match(html,/id="btnAutourDeMoi"/);
  // un quartier, pas trois kilomètres : une recherche sur la commune voisine
  // déplaçait la carte sans faire apparaître le bouton
  assert.match(html,/const ECART_HORS_ZONE = 1200;/);
  assert.match(html,/function carteHorsPosition/);
  // une recherche géographique déplace la carte par définition
  assert.match(html,/if\(rechercheGeo\) return true;/);
  assert.match(html,/retour\.hidden = !map \|\| modePose \|\| modeNav \|\| !carteHorsPosition\(\)/);
});

test("la navigation nomme le produit",()=>{
  for(const t of ["explorer","creer","favoris","profil"])
    assert.match(html,new RegExp('data-nb="'+t+'"'), t);
  assert.match(html,/Explorer\n  <\/button>/);
  // le temps se choisit DANS Explorer, pas dans la barre du bas
  assert.match(html,/function ongletsTemps\(\)\{/);
  for(const label of ["Maintenant","Ce soir","Ce week-end","À venir"])
    assert.match(html,new RegExp('label:"'+label.replace("À","À")+'"'), label);
});

/* ---- Trajets : ne jamais annoncer un transport qui ne circule pas ------- */

test("aucun trajet en transport sans ligne desservant les deux bouts",()=>{
  // l'ancienne version prenait l'arrêt le plus proche de chaque côté, du même
  // type, et affirmait qu'on pouvait aller de l'un à l'autre : elle envoyait
  // prendre un métro entre deux stations qu'aucune ligne ne relie
  assert.match(html,/const lignesCommunes = TRANSIT\.sharedLines\(lignesDepart, lignesArrivee\);/);
  assert.match(html,/if\(arrets && arrets\.length && lignesCommunes\.length\)\{/);
  // les modes proposés sortent des lignes réelles, plus des arrêts trouvés
  assert.match(html,/const modesDesservis = \[\.\.\.new Set\(lignesCommunes\.map\(x=>x\.mode\)\)\];/);
  assert.match(html,/for\(const type of modesDesservis\)\{/);
  // la requête demande les relations type=route qui contiennent un arrêt proche
  assert.match(html,/rel\(bn\.arrets\)\["type"="route"\]/);
  assert.match(html,/function lignesAutour\(lat,lng\)/);
});

test("l'étape nomme le mode et la ligne, et borne ce qu'elle affirme",()=>{
  assert.match(html,/txt:LABEL_MODE\[type\]\+" "\+nomLignes\+" à "\+monte\.nom/);
  assert.match(html,/sous:"attente moyenne estimée · sens à vérifier sur place"/);
  assert.match(html,/correspondances non vérifiées/);
  // et quand rien ne relie les deux points, on le dit au lieu de se taire
  assert.match(html,/Aucune ligne ne dessert à la fois ces arrêts/);
});

test("le mode d'un arrêt se lit dans ses tags, jamais par défaut",()=>{
  assert.match(html,/function typeArret\(t\)\{/);
  // une gare ferroviaire n'est pas un métro
  assert.match(html,/if\(rail === "station" \|\| rail === "halt"\)\{/);
  assert.match(html,/return tags\.train === "no" \? null : "train";/);
  // un tram n'est pas un bus
  assert.match(html,/if\(rail === "tram_stop" \|\| tags\.tram === "yes" \|\| tags\.light_rail === "yes"\) return "tram";/);
  assert.match(html,/\["railway","tram_stop","tram"\]/);
  assert.match(html,/\["railway","station","train"\], \["railway","halt","train"\]/);
  // rien de reconnu : pas de type, donc pas de mode annoncé
  assert.match(html,/return null;\s*\/\/ on ne devine pas/);
  // Google : transit_station est générique, il ne vaut pas « bus »
  assert.match(html,/transit_station:null/);
  assert.doesNotMatch(html,/ARRET_GOOGLE\[p\.primaryType\] \|\| "bus"/);
  // Bus et tram ne partagent plus une seule catégorie
  assert.match(html,/tram:     \{label:"Tram"/);
  assert.match(html,/train:    \{label:"Gares"/);
  assert.doesNotMatch(html,/label:"Bus & tram"/);
});

test("un seul jeu de prédicats pour la barre et les suggestions",()=>{
  // « Lille restaurant indien » : la carte ne bougeait pas, parce que le
  // découpage ne cherchait la destination qu'en fin de phrase et ne vérifiait
  // jamais que le morceau restant pouvait être un lieu
  assert.match(html,/const DECOUPAGE = \{/);
  assert.match(html,/isDestination: \(t\)=>ressembleAUneZone\(t\),/);
  const n = (html.match(/parseSearchQuery\(q, DECOUPAGE\)/g) || []).length;
  assert.equal(n, 2, "la barre et les suggestions partagent le même découpage");
});

/* ---- Aide : atteignable et couvrant la zone regardée ------------------- */

test("« Trouver de l'aide » est un contrôle permanent de la carte",()=>{
  // il vivait dans le rail des intentions, donc derrière la loupe : ce n'est
  // pas une envie parmi d'autres, ça doit être à un doigt
  // plus de `hidden` : la coquille est peinte par le navigateur, pas révélée
  // par le script — c'est ce qui fait apparaître l'écran avant l'analyse du JS
  assert.match(html,/id="btnAide" aria-pressed="false"/);
  assert.doesNotMatch(html,/id="btnAide" hidden/);
  assert.match(html,/#btnAide\{bottom:calc\(var\(--map-control-bottom\) \+ 108px\)\}/);
  assert.match(html,/#btnAide\.actif\{/);
  assert.match(html,/\$\("#btnAide"\)\.onclick=\(\)=>\{/);
  // affiché et masqué avec les autres contrôles de carte
  assert.match(html,/\["#appHeader","#navBas","#btnAide","#btnTransports","#attribution"\]/);
  // et il n'existe plus dans le rail : un seul foyer, un seul état
  assert.match(html,/const ordre = BESOINS_PRINCIPAUX\.filter\(b=>b\.id !== "aide"\);/);
  assert.doesNotMatch(html,/data-rc="aide"/);
});

test("l'aide se recharge quand on regarde une autre commune",()=>{
  // un booléen à un coup : après un déplacement vers Lille, l'écran d'aide
  // montrait encore les adresses du quartier de départ
  assert.doesNotMatch(html,/let aideChargee = false;/);
  assert.match(html,/let aideChargeeAutour = null;/);
  assert.match(html,/const AIDE_RAYON_RECHARGE = 5000;/);
  assert.match(html,/distanceM\(aideChargeeAutour\[0\], aideChargeeAutour\[1\], lat, lng\) < AIDE_RAYON_RECHARGE\) return;/);
  assert.match(html,/if\(modeAide\) chargerAide\(centre\[0\], centre\[1\]\);/);
});

test("les réseaux d'aide et leurs tags couvrent ce qu'on cherche vraiment",()=>{
  for(const reseau of ["Restos du Cœur","Banque Alimentaire","Secours Populaire",
                       "Mission locale","France Travail","hébergement d'urgence"])
    assert.ok(html.includes(reseau), reseau+" doit être cherché");
  // et sans Google, OSM doit suffire : les tags réellement utilisés
  assert.match(html,/\["amenity","food_bank","alimentaire"\]/);
  assert.match(html,/\["social_facility","outreach","asso"\], \["social_facility","day_centre","asso"\]/);
  assert.match(html,/\["amenity","refugee_site","hebergement"\]/);
  assert.match(html,/\["healthcare","centre","sante"\]/);
});

test("une cuisine trie les résultats, elle ne les exclut pas",()=>{
  // le tag cuisine n'est renseigné que sur une minorité de fiches OSM :
  // filtrer dessus rendait un écran vide au milieu d'un quartier de restaurants
  assert.match(html,/const CATS_MANGER = \["resto","fastfood","cafe","marche","food"\];/);
  assert.match(html,/if\(st\.cuisine\) CATS_MANGER\.forEach\(c=>cats\.add\(c\)\);/);
  assert.match(html,/const manger = lieux\.filter\(l=>\[\.\.\.a\.cats\]\.some\(c=>correspondCategorie\(l,c\)\)\);/);
  assert.match(html,/const trouves = \[\.\.\.classes\.filter\(correspond\), \.\.\.classes\.filter\(l=>!correspond\(l\)\)\];/);
  // et le classement d'une zone ne rajoute pas un second filtre textuel
  assert.match(html,/requete: catsActives \? "" : \(intention \|\| ""\),/);
});

/* ---- Passe d'audit : annulation, cache, chargement, journal ------------- */

test("un événement annulé ne se lit jamais comme un événement qui a lieu",()=>{
  // la colonne, le déclencheur et le bouton existaient ; le champ se perdait
  // dans versLieu, et la carte l'affichait comme normal
  assert.match(html,/annule: p\.status === "cancelled" \|\| !!p\.annule/);
  // « Maintenant » l'écarte : le moteur temporel range une annulation en passé
  assert.match(temporel,/if \(source\.annule\) return \{ statut: STATUTS\.PASSE/);
  // sur la carte : affiche conservée mais barrée et mentionnée
  assert.match(html,/\(l\.annule\?' annulee':''\)/);
  assert.match(html,/\(l\.annule\?'ANNULÉ':/);
  assert.match(html,/\.affiche\.annulee \.a-titre\{text-decoration:line-through\}/);
  // sur les cartes et la fiche compacte
  assert.match(html,/l\.annule \? '<b class="rc-annule">Annulé<\/b>' : esc\(cats\)/);
  assert.match(html,/l\.annule \? "Annulé" :/);
});

test("le cache des zones s'évince au lieu d'échouer en silence",()=>{
  assert.match(html,/const CACHE_TUILES_MAX = 40;/);
  assert.match(html,/function tuilesCache\(\)\{/);
  assert.match(html,/function libererCache\(combien\)\{/);
  // trié du plus ancien au plus récent : c'est ce qu'on évince d'abord
  assert.match(html,/return tuiles\.sort\(\(a,b\)=>a\.t - b\.t\);/);
  // quota atteint : on fait de la place et on réessaie, une fois
  assert.match(html,/if\(!libererCache\(Math\.max\(5, Math\.ceil\(CACHE_TUILES_MAX \/ 4\)\)\)\) return false;/);
  assert.doesNotMatch(html,/localStorage\.setItem\(cleCache\(lat,lng\), JSON\.stringify\(\{t:Date\.now\(\), l\}\)\); \}\s*\n\s*catch\(e\)\{\}/);
});

test("une recherche charge les lieux de la catégorie qu'elle pose",()=>{
  // choisir un besoin dans le rail les chargeait, une recherche non :
  // « restaurant Lille » n'affichait que ce que le chargement générique avait
  // ramené, en se partageant 300 objets avec toutes les autres catégories
  assert.match(html,/if\(catsActives && catsActives\.size\) chargerPourCats\(\[\.\.\.catsActives\]\);/);
  assert.match(html,/else if\(filtreActif !== "tout"\) chargerPourCats\(\[filtreActif\]\);/);
});

test("les diagnostics ne partent plus dans la console de tout le monde",()=>{
  assert.match(html,/const journal = \{/);
  assert.match(html,/info\(\.\.\.a\)\{ if\(window\.__autourDebug\) console\.info\(\.\.\.a\); \},/);
  // plus aucun appel direct hors la définition du journal
  const directs = (html.match(/\bconsole\.(info|warn)\(/g) || []).length;
  assert.equal(directs, 2, "seuls les deux appels internes au journal subsistent");
  // les vraies erreurs restent visibles
  assert.ok((html.match(/\bconsole\.error\(/g) || []).length > 10);
  // déclaré avant son premier usage : une zone morte temporelle ici casse tout
  assert.ok(html.indexOf("const journal = {") < html.indexOf("journal.warn("),
    "le journal doit précéder son premier appel");
});

test("la carte d'un événement montre sa date avant son temps de trajet",()=>{
  // « 9 min à pied » ne dit pas si l'événement a lieu ce soir ou dans trois mois
  assert.match(html,/const quand = estTemporaire\(l\)\s*\n\s*\? TEMPS\.libelleTemporel\(/);
  // dans le DOM, la date précède la ligne qui porte le temps de trajet
  const quand = html.indexOf('<span class="rc-quand');
  const ligne = html.indexOf(`'<span class="rc-ligne">'`);
  assert.ok(quand > 0 && ligne > 0 && quand < ligne,
    "la date doit être écrite avant la ligne note/trajet");
  // et le trajet s'efface visuellement quand une date occupe la carte
  assert.match(html,/\.rc-carte:has\(\.rc-quand\) \.rc-min\{/);
  // un lieu permanent n'a pas de ligne « Maintenant » : ce serait du bruit
  assert.match(html,/estTemporaire\(l\)\s*\n\s*\? TEMPS\.libelleTemporel/);
});

test("les événements futurs partent dans des groupes, ils ne disparaissent pas",()=>{
  // quatre groupes, pas un de plus
  assert.match(html,/const SECTIONS_DU_CRENEAU = Object\.freeze\(\{/);
  assert.match(html,/soir:\["ce_soir","aujourdhui"\],/);
  assert.match(html,/weekend:\["ce_week_end"\],/);
  assert.match(html,/avenir:\["a_venir"\],/);
  // le rangement vient du moteur temporel, pas d'une règle réécrite ici
  assert.match(html,/const retenus = classement\.filter\(l=>sections\.includes\(l\.rankSection\)\)/);
  // et à l'intérieur d'un groupe, c'est l'heure qui ordonne
  assert.match(html,/\.sort\(\(a,b\)=>\(a\.rankStart\|\|0\)-\(b\.rankStart\|\|0\)\);/);
  assert.ok(html.indexOf("const SECTIONS_DU_CRENEAU") < html.indexOf("SECTIONS_DU_CRENEAU[creneau]"),
    "SECTIONS_DU_CRENEAU doit précéder son premier usage");
});

test("OpenAgenda transmet toutes ses séances, pas seulement la première",()=>{
  // une série hebdomadaire datée sur `firstTiming` était jugée sur une séance
  // passée depuis des mois
  assert.match(html,/const occurrencesDe = \(evt\)=>\{/);
  assert.match(html,/Array\.isArray\(evt\.timings\) && evt\.timings\.length/);
  assert.match(html,/const occurrences = occurrencesDe\(evt\);/);
  assert.match(html,/const seance = occurrenceUtile\(occurrences\);/);
  assert.match(html,/debutLe: seance \? seance\.start : null,/);
  // plus aucune lecture directe du premier créneau
  assert.doesNotMatch(html,/evt\.nextTiming \|\| evt\.firstTiming \|\| \(evt\.timings\|\|\[\]\)\[0\]/);
});

test("le classement tranche le temps avant de calculer la pertinence",()=>{
  // la proximité ne doit jamais faire remonter un événement futur
  assert.match(core,/const survivants = \[\];/);
  assert.match(core,/if \(temporary && etat && etat\.statut === temps\.STATUTS\.PASSE\) return;/);
  assert.match(core,/if \(ctx\.nowOnly\) \{/);
  assert.match(core,/const disponible = temps && etat/);
  assert.ok(core.indexOf("survivants.push(") < core.indexOf("return survivants.map("),
    "le filtre temporel doit précéder le calcul du score");
  // le statut calculé est exposé, il n'est pas recalculé autrement ailleurs
  assert.match(core,/rankTemporal: etat \? etat\.statut : null,/);
  assert.match(core,/rankSection: temporalSection,/);
});

test("la proximité de date des événements passe avant leur trajet",()=>{
  assert.match(core,/function compareEventDate\(a, b\) \{/);
  assert.match(core,/startsAt: temporalStart, temporalDistance, temporary, quality,/);
  const tri = core.indexOf("}).filter(Boolean).sort((a, b) =>");
  const date = core.indexOf("compareEventDate(a, b)", tri);
  const eta = core.indexOf("compareEta(a, b)", tri);
  assert.ok(date > 0 && eta > 0 && date < eta,
    "l'échéance d'un événement doit être comparée avant sa proximité géographique");
});

test("une exposition fermée annonce sa réouverture, pas le début de sa période",()=>{
  assert.match(temporel,/const ouvre = dispo\.opensAt \? Date\.parse\(dispo\.opensAt\) : NaN;/);
  assert.match(temporel,/\{ debut: suivant, dansMs: suivant - t \}/);
  // et elle n'est jamais « imminente » : ce n'est pas un événement qui commence
  assert.doesNotMatch(temporel,/statut: STATUTS\.IMMINENT, periodeLongue/);
});

test("dans l'aide, chaque lieu dit à quoi il sert",()=>{
  // « CCAS », « Mission locale », « Banque alimentaire » : des noms qui ne
  // veulent rien dire tant qu'on n'a pas eu besoin de s'en servir
  assert.match(html,/<script src="explications\.js\?v=[a-f0-9]{8}"><\/script>/);
  assert.match(html,/const EXPLIQUE = window\.AutourExplications;/);
  // la fiche détaillée porte le descriptif complet
  assert.match(html,/function blocExplication\(l\)\{/);
  assert.match(html,/blocExplication\(l\)\+/);
  // la liste et la fiche posée sur la carte en portent une ligne
  assert.match(html,/const aQuoi = EXPLIQUE && SET_AIDE\.has\(l\.cat\) \? EXPLIQUE\.resumeCourt\(l, 110\) : "";/);
  assert.match(html,/const aQuoi = EXPLIQUE && SET_AIDE\.has\(l\.cat\) \? EXPLIQUE\.resumeCourt\(l, 130\) : "";/);
  // la provenance est toujours écrite : une explication de réseau ne doit pas
  // se lire comme une phrase écrite par l'antenne du coin
  assert.match(html,/e\.mention \? '<p class="expli-src">'/);
  // deux lignes au plus dans la liste : elle sert à choisir, pas à lire
  assert.match(html,/\.ac-expli\{display:-webkit-box;-webkit-line-clamp:2;/);
});

test("le descriptif Google est demandé lieu par lieu, jamais par zone",()=>{
  // ces résumés sont facturés dans une formule plus chère : les demander pour
  // les vingt fiches de chaque zone coûterait cher pour un texte non lu
  assert.match(html,/const CHAMPS_DESCRIPTIF = "id,generativeSummary,editorialSummary";/);
  assert.doesNotMatch(html,/CHAMPS_PLACE = "[^"]*generativeSummary/);
  assert.doesNotMatch(html,/CHAMPS_PLACE = "[^"]*editorialSummary/);
  // réservé à l'aide, et une seule fois par lieu
  assert.match(html,/if\(!SET_AIDE\.has\(l\.cat\)\) return;/);
  assert.match(html,/if\(!EXPLIQUE \|\| !l \|\| !l\.idGoogle \|\| l\.resumeGoogle\) return;/);
  assert.match(html,/const connu = descriptifEnCache\(idGoogle\);\s*\n\s*if\(connu != null\) return connu;/);
  // l'identifiant Google doit être demandé pour pouvoir aller le chercher
  assert.match(html,/CHAMPS_PLACE = "places\.id,/);
  // un échec n'efface rien : l'explication générique reste
  assert.match(html,/journal\.warn\("Descriptif Google: HTTP", r\.status\);/);
  // le résumé généré n'est pas ouvert à toutes les clés : refus ⇒ repli sur
  // l'éditorial, une fois, plutôt que perdre le descriptif
  assert.match(html,/if\(r\.status === 400 && champsDescriptif !== CHAMPS_DESCRIPTIF_SOBRE\)\{/);
  // une erreur client ne se réessaie pas à chaque ouverture, une panne serveur si
  assert.match(html,/if\(r\.status < 500\) descriptifs\.set\(idGoogle, ""\);/);
});

test("aucune explication n'est écrite pour une ville en particulier",()=>{
  // le fichier d'explications ne connaît que des réseaux et des tags ; on
  // regarde le code, pas les commentaires, qui citent des villes en exemple
  const code = explications.replace(/\/\*[\s\S]*?\*\//g,"").replace(/^\s*\/\/.*$/gm,"");
  assert.doesNotMatch(code,/if\s*\(?\s*ville/i);
  for(const ville of ["Lille","Tourcoing","Roubaix","Paris","Lyon","Marseille"])
    assert.doesNotMatch(code, new RegExp(ville,"i"), ville+" ne doit pas y figurer");
});

/* ---- Passe de finition produit ------------------------------------------ */

test("sans position connue, l'application ne prétend pas savoir où on est",()=>{
  // elle affichait Paris, l'annonçait « autour de toi », puis « rien d'ouvert
  // autour de toi » : deux affirmations fausses d'affilée
  assert.match(html,/let originePosition = null;/);
  assert.match(html,/const positionConnue = \(\)=>originePosition !== null;/);
  // trois provenances, aucune ne devine : la dernière mesure du navigateur,
  // la zone déduite de l'adresse IP, ou rien du tout
  assert.match(html,/originePosition = "gps"; precisionPosition = "point"; positionMoi = coords;/);
  assert.match(html,/originePosition = "server"; precisionPosition = "ville";/);
  assert.match(html,/else \{ originePosition = null; precisionPosition = null;/);
  // le nom de la ville n'est pas deviné depuis un point que personne n'a choisi
  assert.match(html,/if\(positionConnue\(\)\) detecterVille\(lat, lng\);/);
  assert.match(html,/if\(!positionConnue\(\)\)\{ v\.textContent = "Choisir un endroit"; return; \}/);
  // et surtout : plus jamais « rien autour de toi » quand on ignore où est « toi »
  assert.match(html,/const erreurSansResultat = erreurPartielle && retenus === 0 && feuilleNiveau === null;/);
  assert.match(html,/const montrer = \(erreurSansResultat \|\| \(videReel && positionConnue\(\)\)\)/);
  // déclaré avant son premier usage
  assert.ok(html.indexOf("let originePosition = null;") < html.indexOf("positionConnue()"),
    "originePosition doit précéder son premier usage");
});

test("un état utile s'affiche immédiatement, même sans permission",()=>{
  assert.match(html,/function blocOuRegarder\(\)\{/);
  assert.match(html,/data-ou="position">⌖ Utiliser ma position/);
  assert.match(html,/data-ou="ville">Choisir une ville/);
  // `.ou` désignait déjà le bloc « où » de la publication : deux classes de
  // même nom se marchaient dessus et cassaient la mise en page
  assert.match(html,/<section class="pdep" data-testid="ou-regarder">/);
  assert.match(html,/\.pdep\{display:block;/);
  // les intentions principales, plus l'aide
  assert.match(html,/BESOINS_PRINCIPAUX\.slice\(0,4\)\.map/);
  assert.match(html,/\{id:"aide", emoji:"❤️", label:"Aide"\}/);
  // le cache local reste utilisé tel quel : rien n'attend la permission
  assert.match(html,/const enCache = lireCacheProche\(lat,lng\);/);
});

test("la pastille de l'en-tête est géographique, pas temporelle",()=>{
  // « Maintenant » y était en double avec les onglets de la feuille
  assert.doesNotMatch(html,/id="btnMaintenant"/);
  assert.match(html,/<button id="btnLieu" title="Recentrer sur ma position">/);
  assert.match(html,/\$\("#btnLieu"\)\.onclick = \(\)=>\{/);
  assert.match(html,/if\(zoneAffichee \|\| rechercheGeo\)\{ revenirAutourDeMoi\(\); return; \}/);
  // « Revenir autour de moi » est la même action, pas un concept concurrent
  assert.match(html,/function revenirAutourDeMoi\(\)\{/);
  assert.match(html,/\$\("#btnAutourDeMoi"\)\.onclick = revenirAutourDeMoi;/);
});

test("une étiquette de catégorie ne se répète pas sur une carte",()=>{
  // `eat` et `restaurant` se lisent tous deux « MANGER » : les cartes
  // affichaient « MANGER • MANGER »
  assert.match(html,/function etiquettesLisibles\(l\)\{/);
  assert.match(html,/if\(e && !vues\.includes\(e\)\) vues\.push\(e\);/);
  assert.doesNotMatch(html,/filter\(x=>ETIQUETTES_CAT\[x\]\)\.slice\(0,2\)/);
});

test("une station n'est pas une destination de découverte",()=>{
  // elle arrivait en tête de « Sortir » : ouverte 24 h/24, tout près, et
  // rattachée à `sport` par le vélo
  assert.match(core,/const transportDemande = categories\.some\(\(c\) => TRANSPORT_CATEGORIES\.includes\(c\)\);/);
  assert.match(core,/const forceTransport = bestCategoryWeight\(item, TRANSPORT_CATEGORIES\);/);
  assert.match(core,/if \(forceDemandee < forceTransport\) return null;/);
  // et l'accueil ne les demande pas du tout
  assert.match(html,/\.filter\(c=>!CATS_TRANSPORT\.has\(c\)\);/);
});

test("les liens partagés ont une adresse propre, sans casser les anciens",()=>{
  assert.match(html,/u\.pathname = "\/e\/"\+encodeURIComponent\(l\.dbId\)/);
  assert.match(html,/u\.pathname = "\/l\/"\+l\.lat\.toFixed\(5\)\+","\+l\.lng\.toFixed\(5\)\+/);
  // la lecture accepte les deux formes : des liens sont déjà partagés
  assert.match(html,/const chemin = \/\^\\\/\(l\|e\)\\\//);
  assert.match(html,/forme historique : #l=lat,lng\|titre/);
  assert.match(html,/const m = \/\^#l=/);
});

test("l'attribution cartographique est lisible sur la carte",()=>{
  // elle vivait entièrement derrière le « ⓘ », c'est-à-dire nulle part
  assert.match(html,/<div id="attribution">/);
  assert.match(html,/openstreetmap\.org\/copyright[^>]*>OSM<\/a>/);
  assert.match(html,/carto\.com\/attributions[^>]*>CARTO<\/a>/);
  assert.match(html,/#attribution\{position:absolute/);
});

test("plus aucun texte sous 11 px, et les cibles font 44 px",()=>{
  // on relève toutes les tailles de police déclarées dans la feuille de style
  const styles = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
  const tailles = [...styles.matchAll(/font-size:([\d.]+)px/g)].map(m=>parseFloat(m[1]));
  // seule exception : la pastille de comptage d'un marqueur, qui est un chiffre
  // dans un rond de 15 px et non un texte à lire
  const pastille = /\.poi-pastille\{[^}]*font-size:10px/.test(styles);
  assert.ok(pastille, "la pastille de comptage garde sa taille de puce");
  const trop = tailles.filter(t=>t < 11 && t !== 10);
  assert.deepEqual(trop, [], "aucune taille sous 11 px : "+trop.join(", "));
  assert.equal(tailles.filter(t=>t === 10).length, 1, "une seule exception admise");
  // les onglets de temps et le cœur des cartes sont visables au pouce
  assert.match(html,/\.ong\{flex:0 0 auto;min-height:44px/);
  assert.match(html,/\.rc-haut \.coeur\{width:44px;height:44px/);
  assert.match(html,/\.rc-tout\{[^}]*min-height:44px/);
});

/* ---- Comprendre une phrase ---------------------------------------------- */

test("la compréhension des phrases est branchée sur la recherche",()=>{
  assert.match(html,/<script src="comprendre\.js\?v=[a-f0-9]{8}"><\/script>/);
  assert.match(html,/<script src="signaux\.js\?v=[a-f0-9]{8}"><\/script>/);
  assert.match(html,/const COMPRENDRE = window\.AutourComprendre;/);
  // `interpreter` délègue au module au lieu de refaire des expressions
  assert.match(html,/const st = COMPRENDRE\.analyser\(phrase, \{/);
  assert.match(html,/cuisineDe: cuisineRecherchee,/);
  assert.match(html,/categorieDe: categorieRecherchee,/);
  // et l'intention structurée voyage jusqu'au classement
  assert.match(html,/let intentionCourante = null;/);
  const occurrences = (html.match(/intention:intentionCourante,/g) || []).length;
  assert.ok(occurrences >= 3, "les trois classements reçoivent l'intention : "+occurrences);
});

test("le budget ne passe plus par un filtre qui traite l'inconnu comme un refus",()=>{
  // `l.prixN != null && l.prixN <= 1` écartait tout lieu sans prix connu :
  // « manger pour moins de 15 € » rendait un écran vide
  assert.doesNotMatch(html,/if\(st\.budget\.max != null && st\.budget\.max <= 20\) act\.filtres\.add\("budget"\);/);
  assert.match(html,/Le budget ne passe PLUS par les filtres humains/);
  assert.match(core,/if \(contrainte\.type === "budget"\)/);
  assert.match(core,/return false;\s*\/\/ prix inconnu : on ne tranche pas/);
});

test("un mot de vocabulaire n'est jamais géocodé comme une ville",()=>{
  // « un endroit calme où travailler » partait chercher la commune
  // « où travailler » ; « après 20h » la commune « 20h »
  assert.match(html,/if\(COMPRENDRE && COMPRENDRE\.estVocabulaire\(texte, \{/);
  assert.match(comprendre,/function estVocabulaire\(fragment, options\) \{/);
  assert.match(comprendre,/const MOTS_OUTILS = new RegExp/);
  assert.match(comprendre,/if \(HEURE_SEULE\.test\(t\)\) return true;/);
});

test("ce qu'Autour a compris s'affiche en puces retirables",()=>{
  assert.match(html,/function chipsHTML\(\)\{/);
  assert.match(html,/data-testid="chips-comprises"/);
  assert.match(html,/function retirerChip\(id\)\{/);
  assert.match(html,/intentionCourante = COMPRENDRE\.sansChip\(intentionCourante, id\);/);
  assert.match(html,/corps\.querySelectorAll\("\[data-chip\]"\)\.forEach\(b=>b\.onclick=\(\)=>retirerChip\(b\.dataset\.chip\)\);/);
  // une contrainte ne se lit pas comme une envie
  assert.match(html,/\.cp\.dure\{background:var\(--ink\)/);
  // `.chip` désignait déjà les pastilles du formulaire : pas de collision
  assert.match(html,/préfixe `cp`/);
});

test("les contraintes dures sont appliquées avant tout calcul de pertinence",()=>{
  assert.match(core,/function contrainteRefusee\(item, contrainte, profil, dispo\)/);
  assert.match(core,/const refuse = intention\.contraintes\.some\(\(c\) => contrainteRefusee\(item, c, profil, dispo\)\);/);
  assert.ok(core.indexOf("const refuse = intention.contraintes.some") <
            core.indexOf("const categoryFit = bestCategoryWeight(item, categories);"),
    "les contraintes passent avant la pertinence de catégorie");
  // une donnée inconnue n'est jamais un « non »
  assert.match(core,/return ok === false;\s*\/\/ inconnu : on laisse passer/);
  assert.match(core,/if \(v == null\) return;\s*\/\/ inconnu : neutre, ni bonus ni malus/);
});

test("l'adéquation passe devant la distance dans le tri",()=>{
  // le tri regardait la distance bien avant le score : « où bosser » plaçait
  // le bar d'en face devant la bibliothèque
  assert.match(core,/fit: Math\.round\(adequation \* 4\) \/ 4\},/);
  assert.match(core,/\(b\.rankBreakdown\.fit \|\| 0\) - \(a\.rankBreakdown\.fit \|\| 0\) \|\|/);
  const tri = core.indexOf("}).filter(Boolean).sort((a, b) =>");
  const fit = core.indexOf("(b.rankBreakdown.fit || 0)", tri);
  const eta = core.indexOf("compareEta(a, b)", tri);
  assert.ok(fit > 0 && eta > 0 && fit < eta, "l'adéquation est comparée avant le trajet");
});

test("un signal ne s'invente jamais",()=>{
  assert.match(signaux,/const PLAFOND_INFERENCE = 0\.75;/);
  // le wifi ne vient que d'un tag, jamais d'une catégorie
  assert.match(signaux,/\["internet_access", \(v\) =>/);
  assert.doesNotMatch(signaux,/PAR_CATEGORIE = Object\.freeze\(\{[^}]*wifi/);
  // une donnée publiée l'emporte sur une inférence
  assert.match(signaux,/une donnée publiée l'emporte toujours sur une inférence/);
});

/* ---- Aide : un pilier, pas une fonction secondaire ---------------------- */

test("Aide est une entrée principale, nommée et distincte du cœur",()=>{
  assert.match(html,/<button class="nb nb-aide" data-nb="aide">/);
  // le mot est écrit : une icône seule ne dit pas ce que c'est
  assert.match(html,/<\/svg>\s*\n\s*Aide\s*\n\s*<\/button>/);
  // le cœur revient à Aide — c'est là qu'il dit quelque chose — et Favoris
  // passe au signet pour que les deux se distinguent
  assert.match(html,/Le cœur revient à Aide/);
  assert.match(html,/<button class="nb" data-nb="favoris">\s*\n\s*<svg[^>]*><path d="M6\.5 3\.5h11/);
  for(const t of ["explorer","aide","creer","favoris","profil"])
    assert.match(html,new RegExp('data-nb="'+t+'"'), t);
  // un rappel discret sur l'accueil, une ligne et pas un panneau
  assert.match(html,/function blocAideAccueil\(\)\{/);
  assert.match(html,/Besoin d’un coup de main/);
  assert.match(html,/if\(creneau !== "maintenant" \|\| modeAide\) return "";/);
});

test("Aide commence par la question, jamais par des structures",()=>{
  assert.match(html,/corps\.innerHTML = sousAide \? ecranSolutionsAide\(\) : ecranBesoinsAide\(\);/);
  assert.match(html,/<p class="ab-titre">De quoi as-tu besoin&nbsp;\?<\/p>/);
  // entrer dans l'aide repart toujours de la question
  assert.match(html,/if\(!modeAide\) basculerAide\(\); else \{ sousAide = null; besoinsAide = \[\]; \}/);
  assert.match(html,/\/\/ on repart toujours de la question/);
  // dix besoins, dans les mots de tout le monde, plus l'urgence à part
  assert.match(html,/const AIDE_URGENCE = \{id:"urgence"/);
  assert.match(aide,/BESOINS = Object\.freeze\(\[/);
});

test("l'aide mélange structures permanentes et opportunités temporaires",()=>{
  assert.match(html,/function rangTemporelAide\(l\)\{/);
  // le moteur temporel existant date les deux : pas de second moteur
  assert.match(html,/TEMPS\.estMaintenant\(etat\.statut\)\) return 3;/);
  assert.match(html,/return section === "a_venir" \? 0 : 1;/);
  assert.match(html,/rangTemporelAide\(b\.l\) - rangTemporelAide\(a\.l\)/);
  // et la carte d'aide affiche la date réelle d'un événement
  assert.match(html,/TEMPS\.libelleTemporel\(l, Date\.now\(\)/);
});

test("une carte d'aide dit pourquoi, à quelle condition, et ce qu'on ignore",()=>{
  assert.match(html,/Pourquoi c’est proposé&nbsp;:/);
  // une parenté de catégorie n'est pas une certitude, et la phrase le dit
  assert.match(html,/'Peut aider, à vérifier&nbsp;:'/);
  assert.match(html,/const cond = AIDE\.conditionDe\(l\);/);
  assert.match(html,/En général, dans ce réseau/);
  assert.match(html,/function fiableAide\(l\)\{/);
  assert.match(html,/À vérifier avant de se déplacer\./);
});

test("aucune solution trouvée n'est jamais une impasse",()=>{
  assert.match(html,/function aucuneSolutionHTML\(\)\{/);
  assert.match(html,/Je n’ai pas trouvé de solution suffisamment fiable/);
  for(const sortie of ["Chercher plus loin","Changer de ville",
                       "Voir les structures générales","Reformuler mon besoin"])
    assert.match(html,new RegExp(sortie), sortie);
  // et le message générique ne dit plus « aucun résultat » non plus
  assert.doesNotMatch(html,/'Aucun résultat trouvé à proximité\.'/);
});

test("le mode Aide ne journalise aucune phrase",()=>{
  assert.match(html,/if\(st\.reste && !modeAide\) COMPRENDRE\.noterReste\(st\.reste\);/);
  assert.match(html,/jamais en mode Aide/);
  // la phrase d'aide ne produit que des besoins normalisés
  assert.match(html,/const trouves = AIDE\.besoinsDepuisPhrase\(phrase\);/);
  assert.match(html,/Ce que tu écris ici reste sur ton téléphone/);
  // le journal filtre ce qui ressemble à une donnée personnelle
  assert.match(comprendre,/const SENSIBLE = /);
  assert.match(comprendre,/if \(SENSIBLE\.test\(brut\.toLowerCase\(\)\)\) return false;/);
});

test("on n'enrichit que les meilleurs candidats, jamais une zone",()=>{
  assert.match(html,/const MAX_ENRICHIS = 5;/);
  assert.match(html,/if\(aDemander\.length >= MAX_ENRICHIS\) break;/);
  assert.match(html,/if\(!DONNEES\.manque\(l, intention, \{disponibilite:\(x,t\)=>dispoDe\(x, null, t\)\}\)\.length\) continue;/);
  // le modèle normalisé porte source, confiance et date
  assert.match(donnees,/source: null, confidence: 0, updated_at: null,/);
  assert.match(donnees,/function depassePlafond\(prix, plafond\)/);
  assert.match(donnees,/if \(!prix \|\| prix\.confidence <= 0\) return null;/);
});

test("dans Aide, l'urgence passe avant tout le reste",()=>{
  // elle était sous les dix besoins : il fallait descendre pour la trouver,
  // exactement l'inverse de ce qu'il faut quand c'est urgent
  const corps = html.slice(html.indexOf("function ecranBesoinsAide()"),
                           html.indexOf("function ecranSolutionsAide()"));
  const rang = (motif)=>corps.search(motif);
  const urgence  = rang(/data-testid="aide-urgence"/);
  const promesse = rang(/class="ab-promesse"/);
  const question = rang(/class="ab-titre">De quoi as-tu besoin/);
  const grille   = rang(/class="ab-grille"/);
  const champ    = rang(/id="formBesoin"/);
  assert.ok(urgence > 0, "le bloc urgence existe");
  assert.ok(urgence < promesse, "urgence avant la promesse");
  assert.ok(promesse < question, "promesse avant la question");
  assert.ok(question < grille, "question avant les catégories");
  assert.ok(grille < champ, "catégories avant le champ libre");
  // et il se comprend en une seconde
  assert.match(html,/<b>Besoin d’aide urgente&nbsp;\?<\/b>/);
  // et l'écran dit ce qu'Autour n'est pas : orienter n'est pas secourir
  assert.match(html,/Autour oriente, il ne remplace pas les secours/);
  assert.match(html,/Danger immédiat&nbsp;: <b>15<\/b>/);
  assert.match(html,/Santé, mise à l’abri, hébergement d’urgence, /);
  assert.match(html,/Pour une situation urgente, commence ici/);
  // visuellement distinct : le seul fond coloré de la feuille
  assert.match(html,/\.ab-urgence\{[^}]*border:2px solid #B82A3A/);
  // la grille suit la largeur du conteneur, pas celle de la fenêtre : une
  // règle en `min-width:768px` posait trois colonnes dans un panneau de 500 px
  assert.match(html,/\.ab-grille\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(148px,1fr\)\)/);
  assert.doesNotMatch(html,/@media \(min-width:768px\)\{ \.ab-grille/);
});

test("Aide dit ce qu'elle fait avant de poser ses cases",()=>{
  assert.match(html,/Explique ton besoin&nbsp;: Autour te propose les/);
  assert.match(html,/aides et les structures utiles autour de toi\./);
  // une phrase, pas un pavé, et sans mot d'administration
  const promesse = /'<p class="ab-promesse">([^']*)'\+\s*\n\s*'([^']*)'/.exec(html);
  assert.ok(promesse, "la promesse est écrite");
  const texte = (promesse[1]+promesse[2]).replace(/&nbsp;/g," ");
  assert.ok(texte.length < 140, "courte : "+texte.length+" caractères");
  for(const jargon of ["dispositif","bénéficiaire","orientation","prestation"])
    assert.ok(!texte.toLowerCase().includes(jargon), jargon);
});

test("le bouton flottant dit « Aide » sans qu'on ait à cliquer",()=>{
  assert.match(html,/<button class="capsule-flottante" id="btnAide"/);
  assert.match(html,/<b>Aide<\/b>\s*\n<\/button>/);
  // un cœur seul se lit « favoris » — et Favoris en porte un dans la barre
  assert.match(html,/Une capsule, pas un rond/);
  assert.doesNotMatch(html,/<button class="rond-flottant" id="btnAide"/);
  // compact, à droite, et la cible reste visable au pouce
  assert.match(html,/\.capsule-flottante\{[^}]*right:16px/);
  assert.match(html,/\.capsule-flottante\{[^}]*min-height:44px/);
});

/* ---- Passe produit : comprendre en cinq secondes ------------------------ */

test("pendant le chargement, un squelette — jamais « rien autour »",()=>{
  assert.match(html,/function squeletteHTML\(n\)\{/);
  assert.match(html,/data-testid="squelette"/);
  assert.match(html,/On cherche ce qui vaut le détour autour de toi…/);
  // le squelette passe AVANT tout message de vide, mais seulement quand aucune
  // réponse issue du cache ou d'une première source n'est déjà utilisable
  assert.match(html,/if\(rechercheEnCours\(\)\) return nombreResultats/);
  const statut = html.indexOf("function statutRechercheHTML(");
  const enCours = html.indexOf("if(rechercheEnCours()) return nombreResultats", statut);
  const rien = html.indexOf("Rien d’ouvert à proximité", statut);
  assert.ok(enCours > 0 && rien > 0 && enCours < rien,
    "le chargement se dit avant le vide");
  // le groupe temporel aussi : on ne parle pas de vide pendant qu'on charge
  assert.match(html,/if\(rechercheEnCours\(\)\) return squeletteHTML\(3\);\s*\n\s*if\(!positionConnue\(\)\)/);
  // et l'accueil s'ouvre sans attendre Overpass
  assert.match(html,/L'accueil s'ouvre TOUT DE SUITE\./);
});

test("l'accueil propose quatre besoins rapides",()=>{
  assert.match(html,/const BESOINS_RAPIDES = \[/);
  for(const l of ["Manger","Sortir","Maintenant","Aide"])
    assert.match(html,new RegExp('label:"'+l+'"'), l);
  assert.match(html,/data-testid="besoins-rapides"/);
  assert.match(html,/besoinsRapidesHTML\(\)\+\s*\n\s*ongletsTemps\(\)/);
});

test("chaque recommandation dit pourquoi elle est là",()=>{
  assert.match(html,/function raisonCourte\(l\)\{/);
  for(const r of ["En cours","Commence bientôt","Ce soir","Ce week-end","Éphémère",
                  "Ferme bientôt","Ouvert maintenant","Gratuit","Apprécié autour de toi"])
    assert.match(html,new RegExp(r.replace("É","É")), r);
  // pas de repli sur la distance : la carte affiche déjà le temps de trajet
  assert.doesNotMatch(html,/return \{t:"À " \+ l\.rankEta\.minutes/);
  assert.match(html,/data-testid="carte-pourquoi"/);
  // « Gratuit » ne vient jamais du défaut OpenStreetMap
  assert.match(html,/if\(prix && prix\.level === 0 && prix\.confidence >= \.8\) return \{t:"Gratuit"/);
  // sur un événement, la date dit déjà pourquoi : pas deux étiquettes
  assert.match(html,/return r && !quand/);
});

test("sélectionner un lieu concentre la carte sur lui",()=>{
  assert.match(html,/function mettreEnAvant\(id\)\{/);
  assert.match(html,/document\.body\.classList\.toggle\("focus-lieu", !!lieuEnAvant\);/);
  assert.match(html,/body\.focus-lieu \.leaflet-marker-icon\{opacity:\.35/);
  assert.match(html,/body\.focus-lieu \.leaflet-marker-icon\.en-avant\{opacity:1/);
  // la mise en avant survit à un redessin
  assert.match(html,/if\(lieuEnAvant\) mettreEnAvant\(lieuEnAvant\);/);
  // et se relâche quand on referme la fiche
  assert.match(html,/if\(f\)\{ f\.hidden = true; f\.innerHTML = ""; \}\s*\n\s*mettreEnAvant\(null\);/);
});

test("un établissement scolaire fermé pour vacances n'est pas recommandé",()=>{
  assert.match(html,/function horsService\(l, quand\)\{/);
  assert.match(html,/if\(!l \|\| l\.cat !== "ecole"\) return false;/);
  assert.match(html,/return !!vacancesScolaires\(new Date\(quand == null \? Date\.now\(\) : quand\)\);/);
  // relégué, pas supprimé : ça reste une information
  assert.match(core,/if \(typeof ctx\.horsService === "function" && ctx\.horsService\(item, now\)\) \{\s*\n\s*availability = 0;/);
  const occurrences = (html.match(/^\s+horsService,$/gm) || []).length;
  assert.ok(occurrences >= 2, "branché sur les classements : "+occurrences);
});

/* ---- Passe de finition : gel de la V1 ----------------------------------- */

test("sur desktop, les recommandations tiennent la gauche et la carte la droite",()=>{
  const desktop = html.slice(html.indexOf("@media (min-width:1100px)"),
                             html.indexOf("/* ---- grappes de marqueurs"));
  assert.match(desktop,/#feuilleBesoins\.reduite\{\s*\n\s*left:var\(--marge-desktop\);right:auto/);
  // ce qui vivait à gauche se décale à droite du panneau
  assert.match(desktop,/#appHeader\{left:var\(--decalage-desktop\)/);
  assert.match(desktop,/#navBas\{top:auto;bottom:var\(--marge-desktop\);left:var\(--decalage-desktop\)/);
  // les flottants et l'attribution longent le bord droit
  assert.match(desktop,/#attribution\{left:auto;right:var\(--marge-desktop\)/);
  assert.match(desktop,/#bandeauGeo,#bandeauVide\{left:auto;right:var\(--marge-desktop\)/);
  // l'organisation mobile ne bouge pas : la feuille monte toujours du bas
  assert.match(html,/#feuilleBesoins\{position:absolute;left:8px;right:8px;bottom:0/);
});

test("la saison vient du calendrier, jamais d'une API météo",()=>{
  assert.match(signaux,/function saisonDe\(date\)/);
  assert.match(signaux,/function contexteSaison\(date, vacances\)/);
  assert.match(signaux,/hiver:\s*\{ dehors: -\.3, interieur: \.3 \}/);
  // l'heure sert aussi : la nuit, une terrasse vaut moins
  assert.match(signaux,/function nuit\(date\)/);
  // et les vacances scolaires valorisent le familial
  assert.match(signaux,/if \(vacances\) bonus\.famille = \(bonus\.famille \|\| 0\) \+ \.3;/);
  // aucune dépendance météo nulle part
  assert.doesNotMatch(html,/openweather|weatherapi|meteo\.|api\.meteo/i);
  // ça ordonne, ça n'exclut pas, et seulement sur un signal connu
  assert.match(core,/if \(v == null\) return;\s*\/\/ inconnu : aucun effet/);
  assert.match(core,/score \+= v \* poids \* 90;/);
});

test("un collège n'est pas proposé comme lieu d'étude",()=>{
  assert.match(html,/function scolaireNonAccessible\(l\)\{/);
  assert.match(html,/const SCOLAIRE_FERME = /);
  // les campus et écoles supérieures ne sont pas concernés
  assert.match(html,/if\(\/\\b\(universit\|iut\\b\|campus\|sup\[ée\]rieur\|grande \[ée\]cole\|institut\)\/i\.test\(nom\)\) return false;/);
  assert.match(html,/if\(scolaireNonAccessible\(l\)\) return true;/);
  // déprioriser, jamais supprimer
  assert.match(core,/availability = 0;\s*\n\s*score -= 400;/);
});

test("« apprécié » exige de vrais avis, en nombre",()=>{
  assert.match(html,/Number\(l\.note\) >= 4\.5/);
  assert.match(html,/Number\.isFinite\(avis\) && avis >= 50/);
  // le seuil précédent — 4,4 sur trente avis — ne suffisait pas
  assert.doesNotMatch(html,/Number\(l\.note\) >= 4\.4 && Number\(l\.avis\) >= 30/);
});

test("la clé Google est documentée, et son absence ne casse rien",()=>{
  assert.match(html,/Restriction d'application → Sites web \(référents HTTP\)/);
  assert.match(html,/https:\/\/autour\.eu\/\*/);
  assert.match(html,/https:\/\/www\.autour\.eu\/\*/);
  assert.match(html,/https:\/\/autour\.vercel\.app\/\*/);
  // chaque appel vérifie la clé avant de partir
  const gardes = (html.match(/if\(!CLE_GOOGLE/g) || []).length;
  assert.ok(gardes >= 5, "tous les appels Google sont gardés : "+gardes);
});

/* ==========================================================================
   Passe « instant-first » : ce qui décide du temps entre l'ouverture et
   l'écran utilisable
   ======================================================================== */

test("chaque étape du démarrage est mesurée, pas ressentie",()=>{
  // les jalons attendus, du script à la fin du démarrage
  for(const jalon of ["script","boot_debut","ui_ready","premier_lieu","map_ready",
                      "geolocation_demandee","geolocation_ready","overpass_done",
                      "google_pret","supabase_pret","demarrage_termine","rendu_final"])
    assert.match(html, new RegExp('PERF\\.jalon\\("'+jalon+'"\\)'), jalon+" doit être marqué");
  // durées nommées, lisibles dans l'onglet Performance du navigateur
  assert.match(html,/mesure\(nom, depuis, jusqua\)/);
  assert.match(html,/PERF\.mesure\("géolocalisation", "geolocation_demandee", "geolocation_ready"\)/);
  assert.match(html,/PERF\.mesure\("démarrage", "boot_debut", "demarrage_termine"\)/);
  // LCP et DOMContentLoaded font partie du rapport
  assert.match(html,/type:"largest-contentful-paint", buffered:true/);
  assert.match(html,/lignes\["dom-content-loaded"\] = Math\.round\(nav\.domContentLoadedEventEnd\)/);
  // et les objectifs sont écrits, pour que la mesure dise elle-même si elle tient
  assert.match(html,/OBJECTIFS: \{"first-contentful-paint":1000, "largest-contentful-paint":2500,/);
});

test("un seul rendu par image, quel que soit le nombre de sources",()=>{
  assert.match(html,/function planifierRendu\(quoi\)\{/);
  // fusionner ne redessine plus trois fois de suite
  assert.match(html,/planifierRendu\(\{carte:true, accueil:true, filtres:true\}\);/);
  assert.doesNotMatch(html,/reindexerCategories\(\);\s*\n\s*rendre\(\);\s*\n\s*dessinerFiltres\(\);/);
  // les fonctions ne se rappellent pas entre elles pendant un lot
  assert.match(html,/if\(feuilleNiveau !== null && !renduEnLot\) majFeuille2\(\);/);
  assert.match(html,/if\(renduEnLot\) return;/);
});

test("rien de lourd avant la première peinture",()=>{
  assert.match(html,/function apresPeinture\(f\)\{/);
  assert.match(html,/requestAnimationFrame\(\(\)=>requestAnimationFrame\(\(\)=>f\(\)\)\)/);
  // le cache complet, les requêtes et la carte viennent APRÈS
  assert.match(html,/apresPeinture\(\(\)=>chargerLeDemarrage\(rapide\)\);/);
  const peinture = html.indexOf("apresPeinture(()=>chargerLeDemarrage(rapide));");
  assert.ok(peinture > 0 && peinture < html.indexOf("function chargerLeDemarrage"),
    "demarrer() se termine sur la peinture, le reste suit");
});

test("le jeu rapide affiche les propositions de la dernière session",()=>{
  assert.match(html,/const CLE_RAPIDE = "autour:rapide:v1";/);
  assert.match(html,/const RAPIDE_MAX = 50;/);
  assert.match(html,/function memoriserJeuRapide\(choisis, reserve\)\{/);
  assert.match(html,/function lireJeuRapide\(lat,lng\)\{/);
  // il n'est lu que s'il décrit vraiment l'endroit où l'on est
  assert.match(html,/distanceM\(lat,lng,o\.zone\[0\],o\.zone\[1\]\) > RAPIDE_RAYON_M\) return null;/);
  assert.match(html,/if\(Date\.now\(\) - o\.t > RAPIDE_HEURES\*3600\*1000\) return null;/);
  // et il est posé sans déclencher de reclassement avant la première image
  assert.match(html,/fusionner\(rapide\.lieux, "permanent", \{silencieux:true\}\);/);
  // l'écriture ne se fait pas sur le fil critique
  assert.match(html,/quandLibre\(\(\)=>\{\s*\n\s*try\{\s*\n\s*const vus = new Set\(\);/);
});

test("Overpass n'est jamais ce qu'on attend au démarrage",()=>{
  assert.match(html,/const OVERPASS_DELAI_BOOT = 7000;/);
  assert.match(html,/const OVERPASS_DELAI_DEMANDE = 25000;/);
  assert.match(html,/vraisLieux\(lat,lng,null,\{delai:OVERPASS_DELAI_BOOT,/);
  assert.match(html,/rayon:RAYON_BOOT, limite:PLAFOND_BOOT\}\)/);
  assert.match(html,/const RAYON_BOOT = 900;/);
  assert.match(html,/const PLAFOND_BOOT = 90;/);
  // et le quartier entier arrive derrière, sans rien retarder
  assert.match(html,/PERF\.jalon\("quartier_complet"\);/);
  // le délai voyage jusqu'à la requête
  assert.match(html,/const delai = o\.delai \|\| OVERPASS_DELAI_DEMANDE;/);
  assert.doesNotMatch(html,/overpass\(`\[out:json\]\[timeout:25\];/);
});

test("la carte est une couche, pas une condition",()=>{
  assert.match(html,/function installerCarte\(\)\{/);
  assert.match(html,/function attendreLeaflet\(\)\{/);
  assert.match(html,/leaflet\.js" async data-leaflet/);
  // sans Leaflet, l'application vit : plus d'écran de panne
  assert.doesNotMatch(html,/panne\("Carte indisponible"/);
  assert.match(html,/Carte indisponible · les propositions restent affichées/);
  // les recommandations ne dépendent plus de la carte
  assert.match(html,/function majAccueil\(\)\{[\s\S]{0,400}if\(!positionMoi \|\| modeNav\) return;/);
  // et la feuille de style de Leaflet ne bloque plus la première peinture
  assert.match(html,/<link rel="stylesheet" media="print" data-leaflet-css/);
});

test("la géolocalisation part avec l'interface et se voit à l'arrivée",()=>{
  // lancée AVANT demarrer(), pas après
  const geo = html.indexOf("if(!positionTest) demarrerLocalisation();");
  const dem = html.indexOf("demarrer(positionTest || positionMemorisee());");
  assert.ok(geo > 0 && dem > 0 && geo < dem, "la position est demandée en parallèle");
  // plus de bandeau « Recherche de ta position… » à côté d'un bouton « Activer »
  assert.doesNotMatch(html,/etat\("Recherche de ta position…", true\);/);
  // à l'arrivée, l'écran change : en-tête, ville, point bleu, propositions
  assert.match(html,/\$\("#bandeauGeo"\)\.hidden = true;/);
  assert.match(html,/majEnteteLieu\(\);\s*\n\s*detecterVille\(c\[0\], c\[1\]\);/);
  assert.match(html,/planifierRendu\(\{accueil:true, carte:true, feuille:true, filtres:true\}\);/);
  assert.match(html,/else if\(!o\.discret && \(premiereFois \|\| venaitDeLApproximation\)\)\s*\n\s*toast\("Position trouvée · autour de toi"\);/);
  // et le quartier réel se charge
  assert.match(html,/chargerZone\(c\[0\], c\[1\], \{delai:OVERPASS_DELAI_BOOT\}\);/);
});

test("la mise à jour se signale, elle ne vide pas l'écran",()=>{
  assert.match(html,/function majSignalMaj\(actif\)\{/);
  assert.match(html,/c\.textContent="Mise à jour…"/);
  assert.match(html,/#charge\.discret\{/);
  // quand on a déjà quelque chose à montrer, pas de gros chargement
  assert.match(html,/if\(rapide\) majSignalMaj\(true\); else charge\("Recherche autour de toi…"\);/);
});

test("un événement publié apparaît tout de suite, et son retard se voit",()=>{
  // l'affiche est posée avant l'aller-retour réseau
  const pose = html.indexOf('fusionner([l], "user");');
  const reseau = html.indexOf("const minuteurRetard = setTimeout");
  assert.ok(pose > 0 && reseau > pose, "l'affiche précède le réseau");
  assert.match(html,/const ATTENTE_VISIBLE_MS = 2000;/);
  assert.match(html,/function marquerPublication\(id, etat\)\{/);
  // le statut s'écrit là où l'affiche dit son prix et ses places
  assert.match(html,/<span class="a-envoi">Envoi…<\/span>/);
  assert.match(html,/<span class="a-envoi a-echec">Non publié · Réessayer<\/span>/);
  assert.match(html,/\(l\.places!=null && !l\.annule\?'<span class="a-places">/);
  assert.match(html,/\.a-envoi\{flex-basis:100%/);
  // un marqueur déjà posé suit le changement d'état
  assert.match(html,/if\(existant\._envoi !== l\.envoi\)\{/);
  // et l'échec se retente
  assert.match(html,/async function reessayerPublication\(id\)\{/);
});

test("ce qu'on vient de publier reste à l'écran",()=>{
  assert.match(html,/const EPINGLE_MS = 10\*60\*1000;/);
  assert.match(html,/function epinglerPublication\(id\)\{/);
  assert.match(html,/epinglerPublication\(l\.id\);\s*\n\s*fusionner\(\[l\], "user"\);/);
  // il passe le filtre « maintenant », le classement et la liste
  assert.match(html,/if\(epingles\.length && epingles\.includes\(l\.id\)\) return true;/);
  assert.match(html,/if\(publicationsEpinglees\.has\(l\.id\)\) return true;/);
  assert.match(html,/return avecEpingles\(classement\)\.slice\(0, limite \|\| 12\);/);
  // et l'épingle suit l'identifiant que la base attribue
  assert.match(html,/publicationsEpinglees\.delete\(l\.id\);\s*\n\s*epinglerPublication\(enligne\.id\);/);
  // déclarés avant leur premier usage
  assert.ok(html.indexOf("const publicationsEpinglees") < html.indexOf("function visiblesBruts"),
    "publicationsEpinglees doit précéder visiblesBruts");
});

/* ==========================================================================
   Démarrage à froid : aucune première suggestion ne doit dépendre d'un tiers
   ======================================================================== */

test("la ville est connue avant que la page ne s'exécute",()=>{
  // le cookie est posé par le bord du réseau, sur la réponse du document
  assert.match(middleware,/x-vercel-ip-latitude/);
  assert.match(middleware,/x-vercel-ip-city/);
  assert.match(middleware,/set-cookie/);
  assert.match(middleware,/autour_geo=/);
  // lisible par le script de la page : le cookie posé ne porte pas HttpOnly
  const pose = /"autour_geo=" \+[\s\S]*?\);/.exec(middleware);
  assert.ok(pose, "le cookie doit être posé");
  assert.doesNotMatch(pose[0],/HttpOnly/i);
  assert.match(middleware,/SameSite=Lax/);
  // rien de plus que deux nombres et un nom : pas d'identifiant, pas de trace
  assert.doesNotMatch(middleware,/x-vercel-ip-(?!latitude|longitude|city|country)/);
  assert.match(middleware,/runtime: "edge"/);
  // et le client le lit
  assert.match(html,/function positionServeur\(\)\{/);
  assert.match(html,/document\.cookie\.match\(\/\(\?:\^\|;\\s\*\)autour_geo=/);
});

test("une position de ville ne se fait pas passer pour un point GPS",()=>{
  // deux axes séparés : d'où elle vient, et ce qu'elle vaut
  assert.match(html,/let originePosition = null;\s+\/\/ "gps" \| "server" \| "manual" \| null/);
  assert.match(html,/let precisionPosition = null;\s+\/\/ "point" \| "ville" \| null/);
  assert.match(html,/const positionPrecise = \(\)=>precisionPosition === "point";/);
  assert.match(html,/const positionApprochee = \(\)=>positionConnue\(\) && !positionPrecise\(\);/);
  // aucun temps de trajet tant qu'on n'a que la zone
  assert.match(html,/if\(!TRANSIT \|\| !positionMoi \|\| !positionPrecise\(\)\) return;/);
  assert.match(html,/const eta = positionPrecise\(\) \? l\.rankEta : null;/);
  assert.match(html,/const eta = positionPrecise\(\) && l\.rankEta/);
  // la vraie géolocalisation, elle, débloque la précision
  assert.match(html,/precisionPosition = "point";\s+\/\/ désormais on peut parler en minutes/);
  // déclarés avant leur premier usage
  assert.ok(html.indexOf("let precisionPosition") < html.indexOf("positionPrecise()"),
    "precisionPosition doit précéder son premier usage");
});

test("Overpass et Nominatim passent par notre propre origine",()=>{
  assert.match(html,/async function overpassRelaye\(q, msMax, signal\)\{/);
  assert.match(html,/fetch\("\/api\/lieux\?q="\+encodeURIComponent\(q\)/);
  assert.match(html,/async function communeRelayee\(lat,lng\)\{/);
  assert.match(html,/fetch\("\/api\/commune\?lat="\+lat\+"&lng="\+lng\)/);
  // une route absente n'est demandée qu'une fois, puis on passe en direct
  assert.match(html,/if\(r\.status === 404 \|\| r\.status === 405\)\{ relaisLieux = false; return undefined; \}/);
  assert.match(html,/if\(relaisCommune === false\) return undefined;/);
  // une seule requête de commune en vol à la fois
  assert.match(html,/if\(communesEnVol\.has\(cle\)\) return communesEnVol\.get\(cle\);/);
  // seules les requêtes de lieux passent par le relais : le décor a une autre forme
  assert.match(html,/async function overpass\(q, msMax, signal, viaRelais\)\{/);
  assert.match(html,/if\(viaRelais\)\{/);
});

test("le relais Overpass n'est pas un relais ouvert",()=>{
  assert.match(apiLieux,/const FORME = \//);
  assert.match(apiLieux,/if \(!FORME\.test\(q\)\) return refus/);
  assert.match(apiLieux,/if \(q\.length > LONGUEUR_MAX\)/);
  assert.match(apiLieux,/if \(!sortie \|\| sortie > SORTIE_MAX\)/);
  // et il mutualise : c'est tout l'intérêt
  assert.match(apiLieux,/s-maxage=86400, stale-while-revalidate=604800/);
  // plusieurs instances : une muette ne fait pas tomber la route
  assert.ok((apiLieux.match(/api\/interpreter/g)||[]).length >= 3);
  // chaque instance reçoit son propre signal : un timeout du premier ne doit
  // jamais annuler instantanément toutes les suivantes
  assert.match(apiLieux,/for \(const serveur of SERVEURS\) \{[\s\S]*?const arret = AbortSignal\.timeout/);
  assert.match(apiLieux,/const restant = DELAI_TOTAL_MS - \(Date\.now\(\) - debut\);/);
  // si le relais entier tombe, le chemin direct du client reste un vrai repli
  assert.match(html,/if\(!r\.ok\) return r\.status >= 500 \? undefined : null;/);
  assert.match(apiCommune,/s-maxage=2592000/);
  assert.match(apiCommune,/user-agent/i, "la politique de Nominatim demande de s'identifier");
});

test("au tout premier démarrage, une source qui ne dépend de personne",()=>{
  assert.match(html,/async function lieuxDeZone\(lat,lng\)\{/);
  assert.match(html,/fetch\("zones\/"\+cleZoneStatique\(lat,lng\)\+"\.json"\)/);
  assert.match(html,/if\(!rapide && positionMoi\) demarrerSurZonePrecalculee/);
  // 404 : on note et on ne redemande plus
  assert.match(html,/if\(r\.status === 404\) zonesDisponibles = false;/);
  // et surtout : rien n'est inventé quand la zone n'existe pas
  assert.match(html,/if\(!depart \|\| !depart\.length\) return;/);
  // le générateur existe et n'écrit rien qu'il n'ait reçu
  assert.match(zones,/aucun lieu exploitable — tuile ignorée/);
  assert.match(zones,/if \(!p\.lat \|\| !p\.lon \|\| !t\.name\) return null;/);
  // il écrit sous la clé EXACTE que le client calcule, sinon les fichiers
  // produits ne seraient jamais demandés
  assert.match(zones,/const cleTuile = \(lat, lng\) => lat\.toFixed\(1\) \+ "," \+ lng\.toFixed\(1\);/);
  assert.match(html,/const cleZoneStatique = \(lat,lng\)=> lat\.toFixed\(1\)\+","\+lng\.toFixed\(1\);/);
  // et il couvre la tuile entière, pas seulement son centre : 0,1° font
  // onze kilomètres sur sept, le classement n'en garde que 2,5
  assert.match(zones,/const DEMI_TUILE = 0\.05;/);
  assert.match(zones,/function eclaircir\(lieux, b\)/);
});

test("la coquille est peinte par le navigateur, pas par le script",()=>{
  for(const id of ["appHeader","navBas","btnAide","btnTransports","attribution"])
    assert.doesNotMatch(html, new RegExp('id="'+id+'"[^>]*\\shidden'),
      id+" ne doit plus attendre JavaScript pour exister");
  // la ligne qui les révélait reste : elle sert au retour de navigation
  assert.match(html,/\["#appHeader","#navBas","#btnAide","#btnTransports","#attribution"\]\s*\n\s*\.forEach\(s=>\$\(s\)\.hidden=false\);/);
});

test("la chaîne du démarrage est lisible maillon par maillon",()=>{
  for(const [nom] of [["boot UI"],["position"],["cache local"],["1re source locale"],
                      ["Overpass"],["Nominatim"],["Supabase"],["classement"],["1re suggestion"]])
    assert.ok(html.includes('"'+nom+'"'), "la chaîne doit nommer « "+nom+" »");
  assert.match(html,/chaine\(\)\{/);
  assert.match(html,/PERF\.jalon\("cache_lu"\)/);
  assert.match(html,/PERF\.jalon\("source_locale"\)/);
  assert.match(html,/PERF\.jalon\("scoring_fait"\)/);
  assert.match(html,/PERF\.jalon\("nominatim_done"\)/);
  // l'objectif de coquille est celui qu'on s'est donné
  assert.match(html,/ui_ready:300/);
});

test("un jeu de zone couvre la tuile, le démarrage n'en paie que le voisinage",()=>{
  // le fichier décrit onze kilomètres sur sept…
  assert.match(zones,/const PLAFOND = 150;/);
  assert.match(zones,/const GRILLE = 6;/);
  // dont une part réservée à l'aide, qui perdrait sinon toujours au nombre
  assert.match(zones,/const PLAFOND_AIDE = 70;/);
  // …mais fusionner cent lieux coûte des secondes de fil principal pour en
  // afficher cinq : on ne prend que les plus proches
  assert.match(html,/const RAPIDE_VOISINAGE = 25;/);
  assert.match(html,/\.sort\(\(a,b\)=>a\._d - b\._d\)\s*\n\s*\.slice\(0, RAPIDE_VOISINAGE\)/);
  // et la marque de distance ne survit pas au tri
  assert.match(html,/\.map\(l=>\{ delete l\._d; return l; \}\)/);
});

test("une instance régionale ne décide pas qu'un quartier est vide",()=>{
  // `overpass.osm.ch` ne contient que la Suisse : elle répondait « zéro objet »
  // en huit dixièmes de seconde à toute requête française, et les trois chemins
  // acceptaient cette réponse. Constaté en produisant les zones de Lille.
  for (const [nom, source] of [["le client", html], ["le relais", apiLieux], ["le générateur", zones]])
    assert.doesNotMatch(source, /"https:\/\/overpass\.osm\.ch/, nom+" ne doit plus l'interroger");
  // et une réponse vide n'est plus une réponse, où qu'elle arrive
  assert.match(apiLieux,/if \(!j\.elements\.length\) continue;/);
  assert.match(zones,/if \(!j\.elements\.length\) \{/);
  // surtout, le relais ne met jamais un quartier vide en cache pour la journée
  const avantCache = apiLieux.indexOf("if (!j.elements.length) continue;");
  const cache = apiLieux.indexOf('"cache-control": "public, s-maxage=86400');
  assert.ok(avantCache > 0 && avantCache < cache,
    "le garde-fou doit précéder la mise en cache");
});

test("une ville déduite de l'IP ne coupe pas l'accès à la vraie position",()=>{
  // `positionConnue()` répond « oui » dès qu'une ville est déduite de l'adresse
  // IP. La pastille de l'en-tête — le seul bouton toujours visible — testait
  // ça et se contentait alors de recentrer : plus aucun moyen, dans tout
  // l'écran, de demander la vraie position.
  assert.match(html,/if\(!positionPrecise\(\)\)\{ suivreMaPosition\(\); return; \}/);
  assert.doesNotMatch(html,/if\(!positionConnue\(\)\)\{ suivreMaPosition\(\); return; \}/);
  // et le message d'échec ne prétend pas garder un quartier qu'on n'a jamais eu
  assert.match(html,/"Zone approximative · active ta position pour être précis\."/);
  assert.match(html,/"Position indisponible · on garde ton dernier quartier\."/);
});

/* ==========================================================================
   La hiérarchie de la localisation : une seule source dit où l'on est
   ======================================================================== */

test("l'adresse IP choisit une zone de données, jamais la position",()=>{
  // seul le GPS peut définir la position réelle
  assert.match(html,/positionMoi = c;\s*\n\s*originePosition = "gps";\s*\n\s*precisionPosition = "point";/);
  // la ville déduite de l'IP ne s'écrit jamais dans la pastille
  assert.match(html,/if\(positionApprochee\(\)\)\{ v\.textContent = "Zone approximative"; return; \}/);
  // ni via le géocodage inverse, qui ne nomme que sur un vrai point
  assert.match(html,/const nommable = \(\)=>positionPrecise\(\);/);
  assert.match(html,/if\(parRelais && nommable\(\)\)/);
  assert.match(html,/if\(nom && nommable\(\)\)/);
  // aucune durée de trajet depuis un point approximatif
  assert.match(html,/const eta = positionPrecise\(\) \? l\.rankEta : null;/);
});

test("une position déduite de l'IP n'entre jamais dans localStorage",()=>{
  assert.match(html,/function memoriserPosition\(c, source\)\{\s*\n\s*if\(source !== "gps"\) return false;/);
  // un seul appelant, et c'est la mesure du navigateur
  const appels = html.match(/memoriserPosition\([^)]*\)/g) || [];
  const vrais = appels.filter((a) => !a.includes("c, source"));
  assert.deepEqual(vrais, ['memoriserPosition(c, "gps")'],
    "seule la géolocalisation du navigateur enregistre une position");
});

test("le GPS remplace l'approximation, il ne la complète pas",()=>{
  assert.match(html,/const venaitDeLApproximation = positionApprochee\(\);/);
  // tout ce qui avait été déduit de l'IP est effacé, pas corrigé
  assert.match(html,/villeDetectee = null;\s*\n\s*commune = "ton quartier";\s*\n\s*etaParLieu\.clear\(\);/);
  // et la zone est rechargée même si le déplacement est court
  assert.match(html,/const bouge = premiereFois \|\| venaitDeLApproximation/);
  assert.match(html,/if\(venaitDeLApproximation \|\|\s*\n\s*distanceM\(c\[0\],c\[1\], dernierNom\[0\], dernierNom\[1\]\) > 2000\)/);
});

test("la permission décide du démarrage, et Safari n'est pas oublié",()=>{
  assert.match(html,/async function permissionPosition\(\)\{/);
  assert.match(html,/navigator\.permissions\.query\(\{name:"geolocation"\}\)/);
  // Safari ne répond pas : on se souvient de l'autorisation déjà obtenue,
  // sinon il faudrait réappuyer à chaque ouverture
  assert.match(html,/return geoDejaAutorisee\(\) \? "granted" : "prompt";/);
  assert.match(html,/const CLE_GEO_OK = "autour:geo-autorisee";/);
  assert.match(html,/noterAutorisationGeo\(true\);/);
  // un refus efface la trace : on ne relance plus d'office
  assert.match(html,/if\(err && err\.code === 1\) noterAutorisationGeo\(false\);/);
  // accordée → on mesure tout de suite ; sinon on propose, sans forcer
  assert.match(html,/if\(etatPerm === "granted"\)\{ suivreMaPosition\(\); return; \}/);
  assert.match(html,/proposerPosition\(\);/);
  assert.match(html,/\$\("#bandeauOk"\)\.textContent = "Utiliser ma position";/);
});

test("choisir une ville à la main est une position, à l'échelle d'une ville",()=>{
  assert.match(html,/originePosition = "manual"; precisionPosition = "ville";/);
  // et cela n'écrase jamais une mesure du navigateur
  assert.match(html,/if\(!positionPrecise\(\)\)\{\s*\n\s*originePosition = "manual";/);
});

test("l'heure d'arrivée est un temps de trajet, elle obéit à la même règle",()=>{
  // « Arrivée 03:07 » se calcule depuis le point de départ : depuis une zone
  // approximative c'est aussi faux que « 16 min », et bien plus crédible
  assert.match(html,/const arrivee = l\.rankArrival && !dejaEnCours && positionPrecise\(\)/);
  // l'heure de fermeture, elle, ne dépend pas d'où l'on est
  assert.match(html,/dispo && dispo\.closesAtTime \? "Ferme à "\+dispo\.closesAtTime/);
});

/* ==========================================================================
   La carte n'est jamais appelée avant d'exister
   ======================================================================== */

test("aucun déplacement de carte n'appelle Leaflet directement",()=>{
  /* Leaflet s'installe APRÈS le contenu essentiel : entre l'ouverture et son
     arrivée, `map` n'existe pas. Sur mobile Safari, un `map.flyTo` dans cette
     fenêtre levait « undefined is not an object » — et l'exception remontait
     jusqu'à l'écran. Tout passe désormais par une porte unique. */
  for(const methode of ["flyTo","setView","panTo","fitBounds"]){
    const directs = (html.match(new RegExp("\\bmap\\." + methode + "\\(", "g")) || []);
    assert.equal(directs.length, 0,
      "map." + methode + "() est appelé directement " + directs.length + " fois");
  }
  assert.match(html,/function surLaCarte\(action, cle\)\{/);
  assert.match(html,/function allerVers\(coords, zoom, opts\)\{/);
  assert.match(html,/function cadrerSur\(bornes, opts\)\{/);
  // une action demandée sans carte est mise de côté, pas perdue
  assert.match(html,/enAttenteDeCarte\.push\(\{action, cle\}\);/);
  assert.match(html,/function rejouerSurLaCarte\(\)\{/);
  // et rejouée dès l'installation
  const install = html.indexOf("function installerCarte()");
  const rejoue = html.indexOf("rejouerSurLaCarte();", install);
  assert.ok(rejoue > install && rejoue < html.indexOf("function attendreLeaflet"),
    "la file doit être rejouée à l'installation de la carte");
});

test("aucune lecture de carte ne suppose que la carte existe",()=>{
  // les points d'entrée qui lisaient `map.getCenter()` sans garde
  assert.match(html,/function pointCarte\(\)\{\s*\n\s*if\(map\) return map\.getCenter\(\);/);
  assert.match(html,/function zoomCarte\(defaut\)\{ return map \?/);
  assert.match(html,/function effacerLignes\(\)\{/);
  // le regroupement des marqueurs a besoin d'une projection : sans carte,
  // chaque lieu reste seul plutôt que de faire planter le rendu
  assert.match(html,/if\(!map\)\{ seuls\.push\(\{seul:l\}\); return; \}/);
});

test("une exception technique ne s'affiche jamais à l'utilisateur",()=>{
  assert.doesNotMatch(html,/panne\("Ça a coincé"/);
  // elle va dans la console, avec les promesses rejetées
  assert.match(html,/window\.addEventListener\("error", e=>\{\s*\n\s*console\.error\("Autour :"/);
  assert.match(html,/window\.addEventListener\("unhandledrejection"/);
  // et les actions de carte échouées se journalisent sans casser l'écran
  assert.match(html,/catch\(e\)\{ console\.error\("Autour · carte :", e\); \}/);
});

test("l'instance Leaflet n'est jamais réassignée",()=>{
  const assignations = (html.match(/^\s*map = /gm) || []);
  assert.equal(assignations.length, 1, "une seule création de carte");
  // et elle est protégée contre une seconde installation
  assert.match(html,/if\(map \|\| typeof L === "undefined" \|\| !carteEnAttente\) return false;/);
});
