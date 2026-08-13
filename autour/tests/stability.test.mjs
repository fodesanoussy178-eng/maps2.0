import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";

import lieuxHandler from "../api/lieux.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const apiLieux = await readFile(new URL("../api/lieux.js", import.meta.url), "utf8");

const debutCoordinateur = html.indexOf("async function coordonnerSourcesVersionnees");
const finCoordinateur = html.indexOf("/* Cache local des lieux OpenStreetMap", debutCoordinateur);
assert.ok(debutCoordinateur > 0 && finCoordinateur > debutCoordinateur,
  "le coordinateur de sources doit rester isolé et testable");
const coordonnerSourcesVersionnees = new Function(
  html.slice(debutCoordinateur, finCoordinateur)+";return coordonnerSourcesVersionnees;"
)();

const prochainTour = ()=>new Promise(resolve=>setImmediate(resolve));

function sourceDifferee(nom, publications, etat){
  let resoudre, rejeter;
  const promesse = new Promise((ok,ko)=>{ resoudre=ok; rejeter=ko; });
  return {
    nom, resoudre, rejeter,
    source:{
      charger:()=>promesse,
      publier:valeur=>{
        publications.push(nom);
        etat.set(nom,valeur);
        return Array.isArray(valeur) ? valeur.length > 0 : !!valeur;
      },
    },
  };
}

function requeteLieux(){
  const url = new URL("https://autour.test/api/lieux");
  url.searchParams.set("q", "[out:json][timeout:12];(nwr(around:900,48.85,2.35)[amenity];);out center 90;");
  return new Request(url);
}

test("une génération obsolète ne peut plus publier dans l'état global",()=>{
  assert.match(html,/const generationsActives = new Map\(\);/);
  assert.match(html,/if\(precedente\) precedente\.controleur\.abort\(\);/);
  assert.match(html,/generationsActives\.get\(generation\.canal\) === generation/);
  assert.match(html,/const proprietairesEtatRecherche = new Map\(\);/);
  assert.match(html,/proprietairesEtatRecherche\.get\(canal\) !== generation\.id/);

  const debut = html.indexOf("function chargerZone");
  const fin = html.indexOf("function categoriesProbables", debut);
  const zone = html.slice(debut, fin);
  assert.ok(debut > 0 && fin > debut);
  assert.match(zone,/const signal = generation\.signal;/);
  assert.ok((zone.match(/generationCourante\(generation\)/g)||[]).length >= 5,
    "chaque source asynchrone doit vérifier sa génération avant de fusionner");
  assert.match(zone,/if\(r && r\.ok\)\{[\s\S]*?zonesVues\.add\(cle\);[\s\S]*?dernierChargement = \[lat,lng\]/);
  assert.doesNotMatch(html,/datatourismeEnVol/,
    "une promesse annulée ne doit pas être partagée par la génération suivante");
  assert.match(html,/nouvelleGeneration\("recherche:ailleurs",phrase\+"\|"\+ville,true\)/);
  assert.match(html,/nouvelleGeneration\("contexte:ville",cle\)/);
  assert.match(html,/nouvelleGeneration\("contexte:commune"/);
});

test("Google, DATAtourisme, Supabase et OSM publient dans n'importe quel ordre sans vider l'état", async()=>{
  const ordres = [
    ["google","datatourisme","supabase","osm"],
    ["osm","supabase","google","datatourisme"],
    ["supabase","google","osm","datatourisme"],
  ];
  for(const ordre of ordres){
    const publications = [], etat = new Map();
    const sources = Object.fromEntries(["google","datatourisme","supabase","osm"]
      .map(nom=>[nom,sourceDifferee(nom,publications,etat)]));
    const fin = coordonnerSourcesVersionnees(
      Object.values(sources).map(x=>x.source), ()=>true);
    for(const nom of ordre){
      sources[nom].resoudre([{id:nom}]);
      await prochainTour();
      assert.deepEqual(publications,ordre.slice(0,publications.length),
        "chaque réponse exploitable doit enrichir immédiatement sans attendre la plus lente");
      assert.equal(etat.size,publications.length,
        "une publication ne doit jamais effacer les sources déjà reçues");
    }
    assert.equal(await fin,true);
    assert.deepEqual(publications,ordre);
    assert.equal(etat.size,4);
  }
});

test("une source en panne n'empêche pas les autres et une génération périmée ne publie rien", async()=>{
  const publications = [], etat = new Map();
  const google = sourceDifferee("google",publications,etat);
  const osm = sourceDifferee("osm",publications,etat);
  const fin = coordonnerSourcesVersionnees([google.source,osm.source],()=>true);
  osm.rejeter(new Error("Overpass indisponible"));
  google.resoudre([{id:"g1"}]);
  assert.equal(await fin,true);
  assert.deepEqual(publications,["google"]);

  let courante = true;
  const tardive = sourceDifferee("tardive",publications,etat);
  const ancienne = coordonnerSourcesVersionnees([tardive.source],()=>courante);
  courante = false;
  tardive.resoudre([{id:"obsolete"}]);
  assert.equal(await ancienne,false);
  assert.deepEqual(publications,["google"],"une réponse obsolète ne doit pas toucher l'état");
});

test("la recherche Aide lance OSM, DATAtourisme et Google en parallèle",()=>{
  const debut = html.indexOf("async function chargerAideVraiment");
  const fin = html.indexOf("/* « restaurant à Lille »,",debut);
  const aide = html.slice(debut,fin);
  assert.match(aide,/coordonnerSourcesVersionnees\(\[/);
  assert.match(aide,/charger:\(\)=>vraisLieux/);
  assert.match(aide,/charger:\(\)=>lieuxDatatourisme/);
  assert.match(aide,/charger:async\(\)=>\{/);
  assert.match(aide,/chercherGoogle\(r\.q/);
  assert.doesNotMatch(aide,/const \[osmResultat, tourisme\] = await Promise\.all/,
    "Overpass ne doit plus retenir Google ni DATAtourisme");
});

test("le démarrage borne les sources primaires et laisse OSM hors du groupe critique",()=>{
  const debut = html.indexOf("function chargerLeDemarrage");
  const finCritique = html.indexOf("Promise.allSettled(travaux)", debut);
  const critique = html.slice(debut, finCritique);
  assert.match(critique,/avecDelai\(notesGoogle\(lat,lng,\{signal\}\),4000,\[\],signal\)/);
  assert.match(critique,/avecDelai\(lieuxDatatourisme\(lat,lng,signal\),4000,\[\],signal\)/);
  assert.match(critique,/avecDelai\(connecter\(\)\.then\(\(\)=>chargerPublications\(lat,lng\)\),4500,\[\],signal\)/);
  assert.doesNotMatch(critique,/vraisLieux\(/);
  assert.match(html,/chargerZone\(lat,lng,\{sansCarte:true, osmSeulement:true,/);
  assert.match(html,/finDemarrage\(\)\{ this\.demarrageTermine = true; this\.exposer\(\); \}/);
  assert.match(html,/reseau: \{total:0, demarrage:0, parSource:Object\.create\(null\)\}/);
});

test("le démarrage ne précharge aucun transport et au plus deux catégories",()=>{
  const debut = html.indexOf("const CATS_DEPART");
  const fin = html.indexOf("const OVERPASS_DELAI_BOOT", debut);
  const depart = html.slice(debut, fin);
  for(const mode of ["metro","bus","tram","train"])
    assert.doesNotMatch(depart,new RegExp('"'+mode+'"'));
  assert.match(html,/const PRECHARGEMENT_CATEGORIES_MAX = 2;/);
  assert.match(html,/if\(prechargementFait \|\| prechargementEnCours \|\| !map \|\| overpassEchecsConsecutifs > 0\) return;/);
  assert.match(html,/prechargementFait = manquantes\.some\(c=>categorieEnMemoire\(c\)\);/);
  const resto = html.slice(html.indexOf("function completerRestauration"),html.indexOf("function ajouterLieuxGoogle"));
  assert.ok(resto.indexOf("if(!generationCourante(generation) || !f.length)") < resto.indexOf("zonesResto.add(cle)"));
});

test("les lectures Supabase publiques n'héritent jamais du JWT de session",()=>{
  assert.match(html,/@supabase\/supabase-js@2\.108\.2/);
  assert.match(html,/storageKey:"autour-public-read-v1"/);
  assert.match(html,/persistSession:false, autoRefreshToken:false, detectSessionInUrl:false/);
  assert.match(html,/function sessionJwtDecalee\(session\)/);
  assert.match(html,/Number\(claims\.iat\) > maintenant \+ 60/);
  assert.match(html,/sb\.auth\.refreshSession\(session\)/);
  assert.match(html,/sb\.auth\.signOut\(\{scope:"local"\}\)/);
  assert.match(html,/const \{ data, error \} = await sbLecture\.rpc\("publications_proches"/);

  const fonctions = html.match(/function lireClaimsJwt\(jeton\)\{[\s\S]*?\n\}\n\nfunction sessionJwtDecalee\(session\)\{[\s\S]*?\n\}/);
  assert.ok(fonctions,"les gardes JWT doivent rester testables séparément");
  const {sessionJwtDecalee} = new Function(fonctions[0]+";return {sessionJwtDecalee};")();
  const jeton = (claims)=>"x."+Buffer.from(JSON.stringify(claims)).toString("base64url")+".x";
  const maintenant = Math.floor(Date.now()/1000);
  assert.equal(sessionJwtDecalee({access_token:jeton({iat:maintenant+120,exp:maintenant+3600})}),true);
  assert.equal(sessionJwtDecalee({access_token:jeton({iat:maintenant,exp:maintenant+3600})}),false);
  assert.equal(sessionJwtDecalee({access_token:jeton({iat:maintenant-3600,exp:maintenant-1})}),true);
});

test("le relais Overpass couvre les instances et annule les départs tardifs", {concurrency:false}, async()=>{
  const avantFetch = globalThis.fetch;
  const appels = [];
  globalThis.fetch = (url, options={})=>{
    appels.push(String(url));
    if(String(url).includes("overpass-api.de"))
      return new Promise(resolve=>setTimeout(()=>resolve(new Response(JSON.stringify({elements:[{type:"node",id:2}]}),
        {status:200,headers:{"content-type":"application/json"}})),10));
    return new Promise((resolve,reject)=>{
      options.signal?.addEventListener("abort",()=>reject(new DOMException("annulé","AbortError")),{once:true});
    });
  };
  try{
    const debut = Date.now();
    const reponse = await lieuxHandler(requeteLieux());
    const corps = await reponse.json();
    assert.equal(reponse.status,200);
    assert.equal(corps.elements[0].id,2);
    assert.ok(Date.now()-debut < 1200,"la seconde instance doit couvrir la première sans attendre son timeout");
    await new Promise(resolve=>setTimeout(resolve,400));
    assert.equal(appels.length,2,"la troisième tentative différée ne doit pas partir après une réponse");
  }finally{ globalThis.fetch = avantFetch; }
});

test("une réponse Overpass vide est exploitable mais brièvement mise en cache", {concurrency:false}, async()=>{
  const avantFetch = globalThis.fetch;
  globalThis.fetch = async()=>new Response(JSON.stringify({elements:[]}),
    {status:200,headers:{"content-type":"application/json"}});
  try{
    const reponse = await lieuxHandler(requeteLieux());
    assert.equal(reponse.status,200);
    assert.deepEqual(await reponse.json(),{elements:[]});
    assert.match(reponse.headers.get("cache-control")||"",/s-maxage=900/);
  }finally{ globalThis.fetch = avantFetch; }
});

test("une panne Overpass totale répond vite et n'est jamais mise en cache", {concurrency:false}, async()=>{
  const avantFetch = globalThis.fetch;
  const avantWarn = console.warn;
  globalThis.fetch = async()=>new Response("indisponible",{status:503});
  console.warn = ()=>{};
  try{
    const debut = Date.now();
    const reponse = await lieuxHandler(requeteLieux());
    assert.equal(reponse.status,503);
    assert.equal(reponse.headers.get("cache-control"),"no-store");
    assert.ok(Date.now()-debut < 1500,"une panne franche ne doit pas consommer le budget de neuf secondes");
  }finally{ globalThis.fetch = avantFetch; console.warn = avantWarn; }
});

test("les collisions utilisent des index spatiaux et un seul rendu par frame",()=>{
  assert.match(html,/const CELLULE_COLLISION = 128;/);
  assert.match(html,/const grille = new Map\(\);/);
  assert.doesNotMatch(html,/boites\.some\(/);
  assert.match(html,/if\(collisionPlanifiee\) cancelAnimationFrame\(collisionPlanifiee\);/);
  assert.match(html,/const pas = \.0015;/);
  assert.match(html,/for\(let x=cx-1;x<=cx\+1;x\+\+\) for\(let y=cy-1;y<=cy\+1;y\+\+\)/);
  assert.match(apiLieux,/const DECALAGE_SERVEUR_MS = 350/);
});
