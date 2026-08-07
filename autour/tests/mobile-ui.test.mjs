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

test("« Plus » est atteignable depuis la feuille et depuis le rail du bas",()=>{
  assert.match(html,/data-bn="plus"/);
  assert.match(html,/data-rc="plus"/);
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
