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
  // trois hauteurs : réduite (poignée + titre), moyenne, étendue
  assert.match(html,/#feuilleBesoins\.reduite\{height:144px;max-height:144px\}/);
  assert.match(html,/height:45dvh;max-height:45dvh/);
  assert.match(html,/#feuilleBesoins\.deplie\{height:80dvh;max-height:80dvh\}/);
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
  // « Gratuit » est un filtre réel exposé comme pill, pas une fausse catégorie
  assert.match(html,/data-filtre="gratuit"/);
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
  assert.match(html,/data-fermes="1"/);
  assert.match(html,/aria-pressed="'\+\(montrerFermes\?'true':'false'\)\+'"/);
  // le rail reste visible tant qu'un filtre est actif, sinon on ne peut plus le défaire
  assert.match(html,/const actifs = filtresHumains\.size > 0 \|\| montrerFermes;/);
  // …et il ne sort pas tout seul : il faut avoir ouvert « Filtres »
  assert.match(html,/const demande = z\.dataset\.force === "1";/);
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

test("« Créer » reste atteignable en un tap depuis l'écran principal",()=>{
  assert.match(html,/if\(id === "creer"\)\{ retourFormulaire=false; ouvrirCreation\(\); return; \}/);
  assert.match(html,/function ouvrirCreation/);
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

test("la navigation basse suit le produit",()=>{
  assert.match(html,/<nav id="navBas"/);
  for(const t of ["explorer","maintenant","creer","favoris","profil"])
    assert.match(html,new RegExp('data-nb="'+t+'"'), t);
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
  // les bandeaux se posent sous l'en-tête mesuré, plus sous une hauteur devinée
  assert.match(html,/top:calc\(var\(--header-height\) \+ 10px\)/);
});

/* ---- Coordination d'événement, pas messagerie -------------------------- */

test("prévenir les participants vit sur l'événement, pas dans une boîte",()=>{
  assert.match(html,/<script src="events\.js"><\/script>/);
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
  const desktop = html.slice(html.indexOf("@media (min-width:1100px)"),
                             html.indexOf("@media (min-width:1100px)")+2400);
  for(const sel of ["#navBas","#appHeader","#feuilleBesoins",".rc-piste"])
    assert.ok(desktop.includes(sel), sel+" doit être adapté au desktop");
  assert.doesNotMatch(desktop,/#appHeader\{[^}]*display:none/);
  assert.doesNotMatch(desktop,/#navBas\{[^}]*display:none/);
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
  assert.match(html,/#appHeader\{[^}]*padding:calc\(var\(--safe-t\) \+ 8px\) 16px 10px/s);
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
  // l'image part avant la fiche, sinon la publication se ferait sans URL
  assert.match(html,/if\(b\.imageFichier\) l\.image = await Store\.televerserImage/);
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
  assert.match(html,/\["#navBas","#appHeader","#btnTransports","#btnCredits"\]/);
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
  for(const jalon of ["interface","carte","geolocalisation","premiers-lieux","overpass-fin","marqueurs"])
    assert.match(html,new RegExp('PERF\\.jalon\\("'+jalon+'"\\)'), jalon);
  assert.match(html,/first-contentful-paint/);
});

test("changer de catégorie ne relance pas Overpass si les lieux sont en mémoire",()=>{
  assert.match(html,/const enMemoire = new Set\(lieux\.map\(l=>l\.cat\)\);/);
  assert.match(html,/if\(!manquantes\.length\) return Promise\.resolve\(\[\]\);/);
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

test("l'identité n'est réclamée qu'au moment du favori",()=>{
  assert.match(html,/l'identité anonyme n'est réclamée qu'ici, au moment où elle sert/);
  assert.match(html,/if\(!\(await connecter\(\)\)\)\{/);
});

test("un tap sur un marqueur ouvre la fiche compacte, pas le panneau complet",()=>{
  assert.match(html,/m\.on\("click", \(\)=>\{ mettreAJourProfil\("clic", l\.cat\); ouvrirFicheCompacte\(l\); \}\);/);
  assert.match(html,/function ouvrirFicheCompacte/);
  assert.match(html,/class="fc-voir">Voir/);
  // « Voir » seulement ensuite ouvre le détail
  assert.match(html,/fermerFicheCompacte\(\); pileEcrans=\[\]; pousserEcran\(\(\)=>ouvrirDetail\(l\.id\)\);/);
});

test("la fiche compacte propose Partager et, au créateur, Prévenir",()=>{
  assert.match(html,/const mien = !!\(l\.dbId && moiId && l\.auteur === moiId\);/);
  assert.match(html,/l\.dbId \? '<button class="fc-part">Partager<\/button>' : ''/);
  assert.match(html,/mien \? '<button class="fc-prevenir">Prévenir<\/button>' : ''/);
});
