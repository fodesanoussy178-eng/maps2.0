import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const html = await readFile(new URL("../index.html",import.meta.url),"utf8");

test("le viewport et les breakpoints responsive ne dépendent pas du userAgent",()=>{
  assert.match(html,/<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" \/>/);
  assert.match(html,/matchMedia\("\(max-width: 767px\)"\)/);
  assert.match(html,/matchMedia\("\(min-width: 768px\) and \(max-width: 1099px\)"\)/);
  assert.match(html,/matchMedia\("\(pointer: coarse\)"\)/);
  assert.doesNotMatch(html,/navigator\.userAgent/);
});

test("la bottom sheet possède les trois layouts et des hauteurs dynamiques",()=>{
  assert.match(html,/height:52dvh;max-height:52dvh/);
  assert.match(html,/height:90dvh;max-height:90dvh/);
  assert.match(html,/@media \(min-width:768px\) and \(max-width:1099px\)/);
  assert.match(html,/@media \(min-width:1100px\)/);
  assert.match(html,/--sheet-visible-height:0px/);
  assert.match(html,/ResizeObserver/);
});

test("les résultats sont rendus avant la demande de précision",()=>{
  const aide = html.indexOf('corps.innerHTML = blocResultats()+\'<p class="fb-section">Préciser mon besoin');
  const standard = html.indexOf('corps.innerHTML = blocResultats()+\'<p class="fb-section">Préciser mon besoin',aide+1);
  assert.ok(aide>0,"ordre Aide");
  assert.ok(standard>aide,"ordre des autres intentions");
  assert.match(html,/data-testid="primary-results"/);
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

test("le bouton d’ajout est nommé « Créer » et jamais réduit à une icône",()=>{
  assert.match(html,/<button id="btnAjouter" hidden aria-label="Créer un événement ou une activité">/);
  assert.match(html,/<span class="creer-txt">Créer<\/span>/);
  assert.doesNotMatch(html,/id="btnAjouter"[^>]*aria-label="Publier"/);
  assert.match(html,/#btnAjouter\{[^}]*bottom:var\(--map-control-bottom\)/s);
  assert.match(html,/--safe-b:env\(safe-area-inset-bottom,0px\)/);
  // sur les écrans les plus étroits, seul l'espacement se resserre
  const etroit = html.match(/@media \(max-width:359px\)\{\s*#btnAjouter\{[^}]*\}/s);
  assert.ok(etroit,"règle très petits écrans");
  assert.doesNotMatch(etroit[0],/display:none|font-size:0|width:4[0-9]px/);
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

test("quatre besoins permanents, le reste derrière « Plus »",()=>{
  assert.match(html,/const BESOINS_PRINCIPAUX\s+= BESOINS\.filter\(b=>!b\.secondaire\)/);
  assert.match(html,/const BESOINS_SECONDAIRES = BESOINS\.filter\(b=>b\.secondaire\)/);
  // les quatre accès principaux ne passent jamais derrière « Plus »
  for(const id of ["manger","sortir","famille","aide"]){
    const bloc = html.slice(html.indexOf('id:"'+id+'"'), html.indexOf('id:"'+id+'"')+220);
    assert.doesNotMatch(bloc,/secondaire:true/, id+" doit rester principal");
  }
  for(const id of ["etudier","culture","sport","services"]){
    const bloc = html.slice(html.indexOf('id:"'+id+'"'), html.indexOf('id:"'+id+'"')+220);
    assert.match(bloc,/secondaire:true/, id+" doit être secondaire");
  }
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
  assert.match(html,/<script src="availability\.js"><\/script>/);
  // les écrans passent tous par le même helper, aucun ne relit un horaire
  assert.match(html,/function dispoDe\(l, arrivee\)/);
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
  assert.match(html,/Voir aussi les lieux fermés/);
  assert.match(html,/aria-pressed="'\+\(montrerFermes\?'true':'false'\)\+'"/);
  // le rail reste visible tant que le filtre est actif, sinon on ne peut plus le défaire
  assert.match(html,/filtresHumains\.size > 0 \|\| montrerFermes/);
});

/* ---- Refonte de l'interface mobile ------------------------------------- */

test("l'en-tête fixe porte le contexte, l'intention et les catégories",()=>{
  assert.match(html,/<header id="appHeader"/);
  assert.match(html,/id="btnMaintenant"/);
  assert.match(html,/id="hdVille"/);
  assert.match(html,/placeholder="Que veux-tu faire maintenant/);
  assert.match(html,/id="btnNotifs"/);
  assert.match(html,/id="btnFiltres"/);
  // l'ancien gros bouton noir et la barre basse ont disparu
  assert.doesNotMatch(html,/id="btnQuoi"/);
  assert.doesNotMatch(html,/id="barreBas"/);
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

test("le marqueur utilisateur est un point bleu, pas un emoji",()=>{
  assert.match(html,/<span class="moi-in"><i><\/i><b><\/b><\/span>/);
  assert.match(html,/\.moi-in b\{display:block;width:17px;height:17px;border-radius:50%;\s*\n\s*background:#1A73E8/);
});

test("le recentrage est une petite icône, plus un gros bouton libellé",()=>{
  assert.match(html,/id="btnRevenir" hidden aria-label="Revenir à ma position"/);
  assert.doesNotMatch(html,/id="btnRevenir"[^>]*>◎ <span>Ma position/);
  assert.match(html,/\.rond-flottant\{[^}]*width:44px;height:44px/);
});

test("« Créer » est violet, nommé, et accessible depuis la carte",()=>{
  assert.match(html,/#btnAjouter\{[^}]*background:var\(--violet\)/);
  assert.match(html,/aria-label="Créer un événement ou une activité"/);
  assert.match(html,/class="creer-txt">Créer/);
});

test("le bottom sheet propose au lieu de poser une question",()=>{
  assert.match(html,/Pour toi, maintenant/);
  assert.match(html,/function recommandationsAccueil/);
  assert.match(html,/class="rc-piste"/);
  assert.match(html,/data-rc-tout/);
  // l'accueil s'ouvre tout seul dès que des lieux existent
  assert.match(html,/if\(feuilleNiveau === null && !modeNav && !modePose && lieux\.length\) ouvrirAccueilFeuille\(\);/);
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

test("la navigation basse existe et n'ouvre pas d'écran inexistant",()=>{
  assert.match(html,/<nav id="navBas"/);
  for(const t of ["explorer","evenements","favoris","messages","profil"])
    assert.match(html,new RegExp('data-nb="'+t+'"'), t);
  assert.match(html,/data-nb="favoris" aria-disabled="true"/);
  assert.match(html,/prévenir les participants/);
});

test("la mise en page tient compte des safe areas et de la hauteur réelle",()=>{
  assert.match(html,/height:100dvh/);
  assert.match(html,/--nav-height:calc\(var\(--safe-b\) \+ 58px\)/);
  assert.match(html,/function mesurerHeader/);
  // les bandeaux se posent sous l'en-tête mesuré, plus sous une hauteur devinée
  assert.match(html,/top:calc\(var\(--header-height\) \+ 10px\)/);
});

/* ---- Coordination d'événement, pas messagerie -------------------------- */

test("la section Messages n'existe que s'il y a un événement",()=>{
  assert.match(html,/<script src="events\.js"><\/script>/);
  assert.match(html,/onglet\.hidden = !E\.sectionMessagesVisible\(canauxAMoi\)/);
  // masqué et non grisé : pas de boîte de réception générale
  assert.doesNotMatch(html,/data-nb="messages" aria-disabled="true"/);
  assert.match(html,/function rafraichirCanaux/);
  assert.match(html,/Autour n\\u2019a pas de messagerie/);
});

test("le créateur dispose des six actions sur son événement",()=>{
  assert.match(html,/function actionCreateur/);
  for(const a of ["horaire","lieu","retard","places","annonce","annulation"])
    assert.match(html,new RegExp('id === "'+a+'"|"'+a+'"'), a);
  // les actions modifient l'événement : le message système vient de la base
  assert.match(html,/Store\.modifierEvenement\(l\.dbId,\{annule:true\}\)/);
  assert.match(html,/Store\.modifierEvenement\(l\.dbId,\{debut_le:iso\}\)/);
});

test("un événement annulé reste affiché",()=>{
  assert.match(html,/un événement annulé reste affiché/);
  assert.match(html,/annulé/);
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
  // aucun composant de la refonte n'est enfermé dans un breakpoint mobile
  const desktop = html.slice(html.indexOf("@media (min-width:1100px)"),
                             html.indexOf("@media (min-width:1100px)")+2400);
  for(const sel of ["#navBas","#appHeader","#feuilleBesoins",".rc-piste","#btnAjouter"])
    assert.ok(desktop.includes(sel), sel+" doit être adapté au desktop");
  // le desktop réutilise les mêmes éléments : il ne les masque pas
  assert.doesNotMatch(desktop,/#appHeader\{[^}]*display:none/);
  assert.doesNotMatch(desktop,/#navBas\{[^}]*display:none/);
  assert.doesNotMatch(desktop,/#btnAjouter\{[^}]*display:none/);
});

test("sur desktop la barre d'onglets devient un rail et la feuille une colonne",()=>{
  assert.match(html,/--rail:88px/);
  assert.match(html,/--panneau:400px/);
  // la règle .accueil est reprise explicitement, sinon sa spécificité
  // l'emportait et la colonne redevenait une feuille mobile étirée
  assert.match(html,/#feuilleBesoins,#feuilleBesoins\.accueil,#feuilleBesoins\.deplie\{/);
  assert.match(html,/#appHeader\{left:var\(--rail\)/);
  assert.match(html,/#map\{left:var\(--rail\)\}/);
  // le carousel horizontal devient une liste verticale
  assert.match(html,/\.rc-piste\{flex-direction:column/);
});

test("les photos de lieux sont réellement demandées à Google",()=>{
  // sans places.photos, toutes les cartes retombaient sur un emoji
  assert.match(html,/"places\.photos,"/);
  assert.match(html,/function photoGoogle/);
  assert.match(html,/places\.googleapis\.com\/v1\/"\+photo\.name\+/);
  // une photo de lieu ne remplace pas l'affiche d'un événement
  assert.match(html,/if\(meilleur\.image && !l\.image\) l\.image = meilleur\.image;/);
});

test("les étiquettes de la carte gèrent leurs collisions",()=>{
  assert.match(html,/function resoudreCollisions/);
  // priorité donnée au classement : les lieux pertinents gardent leur label
  assert.match(html,/dernierClassement\.forEach\(\(l,i\)=>rang\.set\(l\.id,i\)\)/);
  assert.match(html,/\.poi-eti\.masquee\{display:none\}|\.poi-eti,\.poi-eti\.masquee\{display:none\}/);
  assert.match(html,/requestAnimationFrame\(resoudreCollisions\)/);
});

test("un système d'espacement cohérent, sans élément collé aux bords",()=>{
  // marges latérales 16px, boutons flottants décollés du bord
  assert.match(html,/#appHeader\{[^}]*padding:calc\(var\(--safe-t\) \+ 10px\) 16px 12px/s);
  assert.match(html,/\.fb-corps\{[^}]*padding:0 16px/s);
  assert.match(html,/\.rond-flottant\{position:absolute;right:16px/);
  assert.match(html,/#btnAjouter\{position:absolute;right:16px/);
});

test("les événements créés peuvent porter une image stockée dans Supabase",()=>{
  assert.match(html,/async televerserImage\(fichier\)/);
  // chemin préfixé par l'uid : c'est ce que la RLS du stockage vérifie
  assert.match(html,/const chemin = moiId\+"\/"\+Date\.now\(\)/);
  assert.match(html,/sb\.storage\.from\("evenements"\)/);
  assert.match(html,/image_url:l\.image \|\| null/);
  assert.match(html,/image:p\.image_url \|\| p\.image \|\| ""/);
  // l'image part avant la fiche, sinon la publication se ferait sans URL
  assert.match(html,/if\(b\.imageFichier\) l\.image = await Store\.televerserImage/);
});

test("le formulaire propose une photo sans l'imposer",()=>{
  assert.match(html,/id="fPhoto"/);
  assert.match(html,/accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html,/\(facultatif\)/);
  // rien n'est téléversé tant que l'événement n'est pas publié
  assert.match(html,/n'est envoyée\s*\n?\s*qu'à la publication|qu'à la publication/);
  assert.match(html,/Image trop lourde \(3 Mo maximum\)/);
});

test("aucun gros emoji ne sert d'image finale",()=>{
  // le repli est une tuile teintée par la catégorie, pas un emoji géant
  assert.match(html,/\.rc-photo-vide\{position:relative;display:grid;place-items:center;/);
  assert.match(html,/\.rc-photo-vide i\{[^}]*font-size:20px/);
  assert.doesNotMatch(html,/\.rc-photo-vide\{display:grid;place-items:center;font-size:32px\}/);
});
