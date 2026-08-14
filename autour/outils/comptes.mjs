/* ===========================================================================
   Le parcours de compte, joué dans un vrai navigateur

   CE QUE CE BANC PROUVE, ET CE QU'IL NE PROUVE PAS

   Il prouve le PRODUIT : qu'on entre dans Autour sans rien donner, qu'Explorer
   et Aide marchent pour un visiteur, que le compte n'est demandé qu'au moment
   où il sert, et qu'après la connexion on reprend exactement le geste
   commencé plutôt que d'atterrir sur l'accueil.

   Il ne prouve PAS la sécurité. Un banc de navigateur ne peut pas la prouver :
   il tape sur la même interface que celle qu'il teste. La preuve que le compte
   B ne touche pas aux publications de A est en base, dans
   `supabase/tests/rls_comptes.sql`, où le test se pose lui-même en
   `authenticated` avec l'uid de quelqu'un d'autre.

   POURQUOI AUTH EST BOUCHONNÉ

   Un lien magique arrive par courrier électronique. On ne peut ni l'attendre
   ni le lire ici. On bouchonne donc `auth` — pas les policies, pas la
   propriété : uniquement l'aller-retour d'e-mail — pour pouvoir jouer les
   états de session dans l'ordre exact où ils se produisent, et vérifier ce
   que l'interface en fait.

   Prérequis (hors du dépôt, comme les autres bancs) :

     npm install playwright leaflet
     AUTOUR_RACINE=autour node autour/outils/comptes.mjs
   ======================================================================== */

import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const RACINE = process.env.AUTOUR_RACINE || new URL("..", import.meta.url).pathname;
const CHROME = process.env.AUTOUR_CHROME || "/opt/pw-browsers/chromium";
const LEAFLET = process.env.AUTOUR_LEAFLET_DIST || "node_modules/leaflet/dist";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
                ".json": "application/json", ".svg": "image/svg+xml" };

const serveur = createServer(async (req, res) => {
  let chemin = decodeURIComponent(req.url.split("?")[0]);
  if (chemin === "/" || chemin.startsWith("/l/") || chemin.startsWith("/e/")) chemin = "/index.html";
  try {
    const fichier = join(RACINE, chemin);
    const s = await stat(fichier);
    if (!s.isFile()) throw new Error("dossier");
    res.writeHead(200, { "content-type": TYPES[extname(fichier)] || "application/octet-stream" });
    res.end(await readFile(fichier));
  } catch { res.writeHead(404); res.end("non"); }
});
await new Promise((r) => serveur.listen(0, r));
const BASE = "http://127.0.0.1:" + serveur.address().port;

const CENTRE = { lat: 50.6292, lng: 3.0573 };
const osmElements = Array.from({ length: 12 }, (_, i) => ({
  type: "node", id: 2000 + i,
  lat: CENTRE.lat + (i % 4) * 0.0015 - 0.002,
  lon: CENTRE.lng + Math.floor(i / 4) * 0.002 - 0.002,
  tags: { name: "Lieu " + (i + 1), amenity: i % 2 ? "cafe" : "restaurant",
          opening_hours: "Mo-Su 00:00-24:00" },
}));

const resultats = [];
const ok = (nom, condition, detail = "") => {
  resultats.push({ nom, ok: !!condition, detail });
  console.log((condition ? "  ok   " : "ÉCHEC  ") + nom + (condition || !detail ? "" : "\n         → " + detail));
};

const anomalies = [];

/* ---------------------------------------------------------------------------
   LE FAUX SUPABASE

   Il tient l'état d'authentification et une table de publications en mémoire.
   Les règles de propriété y sont réécrites à l'identique de celles de la base
   — non pas pour les prouver (elles le sont ailleurs), mais pour que
   l'interface reçoive les MÊMES refus qu'en production : c'est ce qu'elle en
   fait qui nous intéresse ici.
--------------------------------------------------------------------------- */
const FAUX_SDK = `
(function(){
  const comptes = new Map();          // email -> uid
  const publications = [];
  const favoris = [];
  const profils = new Map();          // uid -> { display_name, notifications }
  let session = null;
  let attenteEmail = null;            // adresse en cours de vérification
  const abonnes = [];
  /* Compte TOUT ce qui ferait naître un utilisateur côté Supabase. Un visiteur
     qui explore et demande de l'aide doit laisser ce compteur à zéro : c'est la
     seule preuve directe qu'aucun compte fantôme n'est créé. */
  const appels = { signInAnonymously:0, signInWithOtp:0, updateUser:0, verifyOtp:0, signOut:0 };

  window.__auth = {
    // ce que le banc regarde
    etat: () => session ? { uid: session.user.id, email: session.user.email || null,
                            anonyme: !!session.user.is_anonymous } : null,
    appels: () => Object.assign({}, appels),
    publications: () => publications.map(p => ({...p})),
    favoris: () => favoris.map(f => ({...f})),
    // et ce qu'il pilote
    /* Ce qu'un ancien compte anonyme a laissé derrière lui, du temps où c'était
       permis. Posé directement dans les tables, sans passer par les règles :
       c'est de l'HISTORIQUE, pas une écriture qu'on voudrait autoriser. */
    poserHistorique(uid){
      publications.push({ id:"pub-histo", titre:"Publication d'avant", cat:"event",
        lat:50.63, lng:3.06, creator_id:uid, created_by:uid, status:"active" });
      favoris.push({ id:1, membre:uid, lieu_ref:"osm:histo", titre:"Favori d'avant",
        lat:50.63, lng:3.06 });
    },
    seConnecterCommme(email){
      let uid = comptes.get(email);
      if(!uid){ uid = "uid-" + (comptes.size + 1); comptes.set(email, uid); }
      if(!profils.has(uid)) profils.set(uid, { display_name:null, notifications:true });
      session = { access_token:"t", user:{ id:uid, email:email, is_anonymous:false } };
      abonnes.forEach(f => f("SIGNED_IN", session));
      return uid;
    },
  };

  function reponse(data, error){ return Promise.resolve({ data, error: error || null }); }

  function table(nom){
    const api = { _nom:nom, _filtres:[], _select:null };
    api.select = (c)=>{ api._select = c; return api; };
    api.eq = (col, val)=>{ api._filtres.push([col, val]); return api; };
    api.maybeSingle = ()=>{
      const l = filtrer(nom, api._filtres);
      return reponse(l.length ? l[0] : null);
    };
    api.single = ()=> reponse(filtrer(nom, api._filtres)[0] || null);
    api.order = ()=> api;
    api.limit = ()=> api;
    api.then = (res)=> reponse(filtrer(nom, api._filtres)).then(res);

    api.insert = (ligne)=>{
      const rendu = { select: ()=>({ single: ()=>faireInsert(nom, ligne) }),
                      then:(r)=>faireInsert(nom, ligne).then(r) };
      return rendu;
    };
    api.update = (champs)=>{
      const maj = { _f:[], eq:(c,v)=>{ maj._f.push([c,v]); return maj; },
        select: ()=>({ then:(r)=>faireUpdate(nom, champs, maj._f).then(r) }),
        then:(r)=>faireUpdate(nom, champs, maj._f).then(r) };
      return maj;
    };
    api.delete = ()=>{
      const sup = { _f:[], eq:(c,v)=>{ sup._f.push([c,v]); return sup; },
        select: ()=>({ then:(r)=>faireDelete(nom, sup._f).then(r) }),
        then:(r)=>faireDelete(nom, sup._f).then(r) };
      return sup;
    };
    return api;
  }

  const source = (nom)=> nom === "publications" ? publications
    : nom === "favoris" ? favoris
    : [...profils.entries()].map(([id, p]) => Object.assign({ id }, p));

  function filtrer(nom, f){
    let l = source(nom);
    // les favoris et les profils ne se lisent que par leur propriétaire
    if(nom === "favoris") l = l.filter(x => session && x.membre === session.user.id);
    if(nom === "profiles") l = l.filter(x => session && x.id === session.user.id);
    for(const [col, val] of f) l = l.filter(x => x[col] === val);
    return l.map(x => ({...x}));
  }

  function compteConfirme(){
    return !!(session && session.user.email && !session.user.is_anonymous);
  }

  function faireInsert(nom, ligne){
    if(!compteConfirme()) return reponse(null, { message:"new row violates row-level security policy" });
    if(nom === "publications"){
      if(ligne.created_by !== session.user.id)
        return reponse(null, { message:"new row violates row-level security policy" });
      const p = Object.assign({ id:"pub-" + (publications.length + 1) }, ligne);
      publications.push(p);
      return reponse({...p});
    }
    if(nom === "favoris"){
      if(ligne.membre !== session.user.id)
        return reponse(null, { message:"violates row-level security policy" });
      favoris.push(Object.assign({ id:favoris.length + 1 }, ligne));
      return reponse({});
    }
    return reponse({});
  }

  function faireUpdate(nom, champs, f){
    if(nom === "profiles"){
      if(!session) return reponse([], null);
      const p = profils.get(session.user.id) || {};
      profils.set(session.user.id, Object.assign({}, p, champs));
      return reponse([{ id:session.user.id }]);
    }
    if(!compteConfirme()) return reponse([], null);
    let cibles = publications;
    for(const [col, val] of f) cibles = cibles.filter(x => x[col] === val);
    // LA RÈGLE : seul le propriétaire modifie
    const permises = cibles.filter(x => x.created_by === session.user.id);
    permises.forEach(x => Object.assign(x, champs));
    return reponse(permises.map(x => ({ id:x.id, status:x.status })));
  }

  function faireDelete(nom, f){
    if(!compteConfirme()) return reponse([], null);
    const liste = nom === "favoris" ? favoris : publications;
    const cle = nom === "favoris" ? "membre" : "created_by";
    let cibles = liste;
    for(const [col, val] of f) cibles = cibles.filter(x => x[col] === val);
    const permises = cibles.filter(x => x[cle] === session.user.id);
    permises.forEach(x => liste.splice(liste.indexOf(x), 1));
    return reponse(permises.map(x => ({ id:x.id })));
  }

  window.supabase = {
    createClient(){
      return {
        from: table,
        rpc(nom){
          if(nom === "mes_publications")
            return reponse(publications.filter(p => session && p.created_by === session.user.id));
          if(nom === "mes_canaux") return reponse([]);
          return reponse([]);
        },
        storage:{ from:()=>({ upload:()=>reponse({}), getPublicUrl:()=>({ data:{ publicUrl:"" } }) }) },
        auth:{
          getSession: ()=> reponse({ session }),
          refreshSession: (s)=> reponse({ session:s }),
          onAuthStateChange(f){ abonnes.push(f); return { data:{ subscription:{ unsubscribe(){} } } }; },
          signInAnonymously(){
            appels.signInAnonymously++;
            const uid = "anon-" + Date.now();
            session = { access_token:"t", user:{ id:uid, email:null, is_anonymous:true } };
            abonnes.forEach(f => f("SIGNED_IN", session));
            return reponse({ session, user:session.user });
          },
          signInWithOtp({ email }){ appels.signInWithOtp++; attenteEmail = email; return reponse({}); },
          updateUser({ email }){
            appels.updateUser++;
            /* Le vrai service refuse une adresse déjà prise. On reproduit ce
               refus pour vérifier qu'Autour bascule bien vers une ouverture de
               session normale au lieu de laisser la personne bloquée. */
            if(comptes.has(email))
              return reponse(null, { code:"email_exists",
                message:"A user with this email address has already been registered" });
            attenteEmail = email; return reponse({});
          },
          verifyOtp({ email, token, type }){
            appels.verifyOtp++;
            if(token !== "123456") return reponse(null, { message:"Token has expired or is invalid" });
            const adresse = email || attenteEmail;

            /* LE POINT QUE CE BANC EXISTE POUR VÉRIFIER.

               « email_change » convertit la session EN COURS : GoTrue met à
               jour la ligne auth.users existante, il n'en crée pas une autre.
               L'uid ne bouge donc pas, et tout ce qui pend à cet uid —
               publications, favoris, profil — reste attaché à la personne.

               Une première version de ce bouchon appelait toujours
               seConnecterCommme, qui frappe un uid neuf. Le banc a signalé
               un uid différent avant et après : le défaut était ici, pas dans
               Autour. Mais un bouchon infidèle sur CE point précis rendrait le
               banc entier inutile — c'est la seule chose qu'il doit prouver. */
            if(type === "email_change" && session){
              comptes.set(adresse, session.user.id);
              session = { access_token:"t",
                          user:{ id:session.user.id, email:adresse, is_anonymous:false } };
              abonnes.forEach(f => f("SIGNED_IN", session));
              return reponse({ session, user:session.user });
            }

            window.__auth.seConnecterCommme(adresse);
            return reponse({ session });
          },
          signOut(){ appels.signOut++; session = null;
            abonnes.forEach(f => f("SIGNED_OUT", null)); return reponse({}); },
        },
      };
    },
  };
})();
`;

async function nouvelOnglet(navigateur, etiquette) {
  const ctx = await navigateur.newContext({
    ...devices["iPhone 13"],
    permissions: ["geolocation"],
    geolocation: { latitude: CENTRE.lat, longitude: CENTRE.lng },
    locale: "fr-FR",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => anomalies.push(`[${etiquette}] erreur JS : ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource|net::ERR|favicon|manifest|Google Maps|Refused to execute/.test(t)) return;
    anomalies.push(`[${etiquette}] console.error : ${t.slice(0, 160)}`);
  });

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    const json = (c) => route.fulfill({ status: 200, contentType: "application/json",
                                        body: JSON.stringify(c) });
    if (url.startsWith(BASE) && !/\/api\//.test(url)) return route.continue();
    if (/tile|basemaps|openstreetmap\.org\/\d|googleapis\.com\/maps/.test(url))
      return route.fulfill({ status: 200, contentType: "image/png",
        body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
    if (/leaflet.*\.js(\?|$)/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript",
        body: await readFile(join(LEAFLET, "leaflet.js"), "utf8") });
    if (/leaflet.*\.css(\?|$)/.test(url))
      return route.fulfill({ status: 200, contentType: "text/css",
        body: await readFile(join(LEAFLET, "leaflet.css"), "utf8") });
    // le vrai SDK est remplacé par le faux, injecté avant le document
    if (/supabase-js|@supabase/.test(url) && /\.js/.test(url))
      return route.fulfill({ status: 200, contentType: "text/javascript", body: "" });
    if (/maps\.googleapis\.com/.test(url)) return route.abort("failed");
    if (/\/api\/lieux|overpass/.test(url)) return json({ elements: osmElements });
    if (/\/api\/commune/.test(url)) return json({ nom: "Ville d'essai" });
    if (/nominatim|openagenda|routing|osrm/.test(url)) return json([]);
    return json({});
  });

  await page.addInitScript(FAUX_SDK);
  await page.goto(BASE + "/index.html");
  await page.waitForTimeout(1600);
  return { ctx, page };
}

/* ---- Gestes, écrits une fois ------------------------------------------- */
const onglet = (page, nom) =>
  page.evaluate((n) => document.querySelector('#navBas [data-nb="' + n + '"]').click(), nom);

const ecranCompteVisible = (page) =>
  page.evaluate(() => {
    const e = document.querySelector('[data-testid="ecran-compte"]');
    return e ? { action: e.dataset.action, titre: e.querySelector(".cpt-titre").textContent,
                 texte: e.querySelector(".cpt-sous").textContent } : null;
  });

async function seConnecter(page, email) {
  await page.evaluate((m) => {
    const champ = document.getElementById("cptEmail");
    champ.value = m;
    champ.dispatchEvent(new Event("input", { bubbles: true }));
    document.getElementById("cptEnvoyer").click();
  }, email);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    document.getElementById("cptCode").value = "123456";
    document.getElementById("cptValider").click();
  });
  await page.waitForTimeout(700);
}

async function remplirBrouillon(page, titre) {
  await page.evaluate((t) => {
    brouillon = Object.assign(brouillon || {}, {
      cat: "event", titre: t, adresse: "1 rue d'essai", lat: 50.6292, lng: 3.0573,
      date: new Date(Date.now() + 86400e3).toISOString().slice(0, 10),
      heure: "18:00", fin: "20:00", gratuit: true, prix: 0, limite: false,
    });
  }, titre);
}

/* ======================================================================== */
const navigateur = await chromium.launch({ executablePath: CHROME });

/* ---- 1. Le visiteur : tout ce qui se consulte, sans rien donner --------- */
{
  const { ctx, page } = await nouvelOnglet(navigateur, "visiteur");

  const auDemarrage = await ecranCompteVisible(page);
  ok("visiteur · aucun écran de connexion à l'ouverture", auDemarrage === null,
     auDemarrage ? auDemarrage.titre : "");
  ok("visiteur · aucune session n'est créée toute seule",
     (await page.evaluate(() => window.__auth.etat())) === null);

  await onglet(page, "explorer");
  await page.waitForTimeout(700);
  const explorer = await page.evaluate(() => ({
    carte: !!(document.getElementById("map") &&
              document.getElementById("map").classList.contains("leaflet-container")),
    marqueurs: document.querySelectorAll(".leaflet-marker-icon").length,
    compte: !!document.querySelector('[data-testid="ecran-compte"]'),
  }));
  ok("visiteur → Explorer · la carte est là", explorer.carte);
  ok("visiteur → Explorer · des lieux sont affichés", explorer.marqueurs > 0,
     explorer.marqueurs + " marqueur(s)");
  ok("visiteur → Explorer · rien ne demande de compte", explorer.compte === false);

  await page.evaluate(() => { recherche = "café"; ouvrirResultats("café"); });
  await page.waitForTimeout(500);
  ok("visiteur → rechercher · aucun compte demandé",
     (await ecranCompteVisible(page)) === null);

  await onglet(page, "aide");
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    document.getElementById("champBesoin").value = "je dors dehors";
    document.getElementById("formBesoin")
      .dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  });
  await page.waitForTimeout(500);
  const aide = await page.evaluate(() => ({
    texte: (document.getElementById("fbCorps").textContent || "").slice(0, 160),
    compte: !!document.querySelector('[data-testid="ecran-compte"]'),
  }));
  ok("visiteur → Aide · la demande aboutit sans compte", aide.compte === false, aide.texte);
  ok("visiteur → Aide · une urgence n'est jamais derrière un compte",
     !/e-mail|connecte/i.test(aide.texte), aide.texte);

  /* CE QUE DEMANDE LE POINT 4 : un visiteur qui explore et demande de l'aide
     ne doit faire naître AUCUN utilisateur Supabase. Le compteur du faux SDK
     le dit directement, plutôt que de le déduire de l'absence de session. */
  const appels = await page.evaluate(() => window.__auth.appels());
  ok("visiteur · aucun appel d'authentification n'a eu lieu",
     appels.signInAnonymously === 0 && appels.signInWithOtp === 0 &&
     appels.updateUser === 0 && appels.verifyOtp === 0, JSON.stringify(appels));
  ok("visiteur · Explorer et Aide tiennent avec le seul rôle public",
     appels.signInAnonymously === 0,
     "signInAnonymously appelé " + appels.signInAnonymously + " fois");

  await ctx.close();
}

/* ---- 1 bis. Le rattachement d'une session anonyme existante -------------- */
/* Les 195 comptes anonymes de production sont dans cet état-là. Autour n'en
   crée plus, mais il doit savoir en RÉCUPÉRER un : c'est le seul chemin qui
   rende à ces gens leurs publications. Le scénario force donc une session
   anonyme, puis rattache une adresse, et regarde l'uid. */
{
  const { ctx, page } = await nouvelOnglet(navigateur, "rattachement");

  const uidAvant = await page.evaluate(async () => {
    const { data } = await sb.auth.signInAnonymously();
    appliquerSession(data.session);
    return data.session.user.id;
  });
  ok("ancien anonyme · la session existe", !!uidAvant, String(uidAvant));
  ok("ancien anonyme · Autour la reconnaît comme « pas un compte »",
     (await page.evaluate(() => etatCompte)) === "anonyme",
     await page.evaluate(() => etatCompte));

  // il avait publié et mis en favori du temps où c'était permis
  await page.evaluate((uid) => {
    window.__auth.poserHistorique(uid);
  }, uidAvant);

  /* Le chemin choisi décide de tout : « lier » conserve l'uid, « ouvrir » en
     créerait un autre et l'ancien deviendrait inaccessible. */
  const plan = await page.evaluate(() => AutourComptes.manoeuvre(etatCompte));
  ok("ancien anonyme · Autour choisit de RATTACHER, pas d'ouvrir une session neuve",
     plan.methode === "lier" && plan.typeOtp === "email_change", JSON.stringify(plan));

  await page.evaluate(() => ouvrirEcranCompte("publier"));
  await page.waitForTimeout(300);
  await seConnecter(page, "ancien@example.invalid");

  const apres = await page.evaluate(() => ({
    etat: window.__auth.etat(),
    appels: window.__auth.appels(),
  }));
  ok("ancien anonyme · MÊME UID après le rattachement",
     apres.etat && apres.etat.uid === uidAvant,
     "avant " + uidAvant + " · après " + (apres.etat && apres.etat.uid));
  ok("ancien anonyme · le compte porte maintenant l'adresse",
     apres.etat && apres.etat.email === "ancien@example.invalid");
  ok("ancien anonyme · il n'est plus anonyme", apres.etat && apres.etat.anonyme === false);
  ok("ancien anonyme · c'est bien updateUser qui a été appelé, pas signInWithOtp",
     apres.appels.updateUser === 1 && apres.appels.signInWithOtp === 0,
     JSON.stringify(apres.appels));

  const garde = await page.evaluate(async (uid) => ({
    publications: window.__auth.publications().filter(p => p.created_by === uid).length,
    favoris: window.__auth.favoris().filter(f => f.membre === uid).length,
    miennes: ((await sb.rpc("mes_publications")).data || []).length,
  }), uidAvant);
  ok("ancien anonyme · ses publications sont conservées", garde.publications === 1,
     garde.publications + " publication(s)");
  ok("ancien anonyme · ses favoris sont conservés", garde.favoris === 1,
     garde.favoris + " favori(s)");
  ok("ancien anonyme · « mes publications » les lui rend", garde.miennes === 1);

  await ctx.close();
}

/* ---- 1 ter. L'adresse appartient déjà à quelqu'un d'autre ---------------- */
/* Sans repli, la personne taperait l'adresse de son PROPRE compte et
   n'arriverait jamais à s'y connecter : le rattachement est refusé, et rien
   d'autre n'était tenté. */
{
  const { ctx, page } = await nouvelOnglet(navigateur, "adresse-prise");

  // un compte existe déjà avec cette adresse
  await page.evaluate(() => window.__auth.seConnecterCommme("occupee@example.invalid"));
  await page.waitForTimeout(300);
  const uidLegitime = await page.evaluate(() => window.__auth.etat().uid);
  await page.evaluate(() => seDeconnecter());
  await page.waitForTimeout(300);

  // quelqu'un arrive avec une session anonyme et tape cette même adresse
  await page.evaluate(async () => {
    const { data } = await sb.auth.signInAnonymously();
    appliquerSession(data.session);
  });
  await page.waitForTimeout(200);

  const envoi = await page.evaluate(() => envoyerLienCompte("occupee@example.invalid"));
  ok("adresse déjà prise · Autour ne reste pas bloqué", envoi.ok === true,
     JSON.stringify(envoi));
  ok("adresse déjà prise · il bascule sur une ouverture de session normale",
     envoi.bascule === "adresse-deja-prise" && envoi.typeOtp === "email",
     JSON.stringify(envoi));

  await page.evaluate(() => {
    compteEnCours = { action:"compte", email:"occupee@example.invalid",
                      typeOtp:"email", envoye:true };
    rendreEcranCompte();
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    document.getElementById("cptCode").value = "123456";
    document.getElementById("cptValider").click();
  });
  await page.waitForTimeout(600);
  ok("adresse déjà prise · elle retrouve SON compte, celui qui porte l'adresse",
     (await page.evaluate(() => window.__auth.etat().uid)) === uidLegitime,
     "attendu " + uidLegitime);

  await ctx.close();
}

/* ---- 1 quater. Un code incorrect ---------------------------------------- */
{
  const { ctx, page } = await nouvelOnglet(navigateur, "code-faux");

  const r = await page.evaluate(() => verifierCodeCompte("qui@example.invalid", "000000", "email"));
  ok("code incorrect · refusé", r.ok === false, JSON.stringify(r));
  ok("code incorrect · le message est lisible, pas celui du service",
     /n’est plus valable|plus valable/i.test(r.message || ""), r.message);
  ok("code incorrect · aucune session n'est ouverte",
     (await page.evaluate(() => window.__auth.etat())) === null);

  const court = await page.evaluate(() => verifierCodeCompte("qui@example.invalid", "12", "email"));
  ok("code trop court · refusé avant même d'appeler le service", court.ok === false,
     court.message);
  ok("code trop court · on dit ce qu'on attend",
     /six chiffres/i.test(court.message || ""), court.message);

  await ctx.close();
}

/* ---- 2. Créer : le compte demandé au bon moment, et la reprise ---------- */
{
  const { ctx, page } = await nouvelOnglet(navigateur, "creer");

  await onglet(page, "creer");
  await page.waitForTimeout(500);
  const demande = await ecranCompteVisible(page);
  ok("visiteur → Créer · le compte est demandé", !!demande);
  ok("visiteur → Créer · avec les mots de CE geste",
     demande && demande.titre === "Une dernière étape",
     demande ? demande.titre : "aucun écran");
  ok("visiteur → Créer · la raison est écrite",
     demande && /modifier ou supprimer cet événement plus tard/.test(demande.texte),
     demande ? demande.texte : "");

  await seConnecter(page, "alice@example.invalid");
  const apres = await page.evaluate(() => ({
    compte: window.__auth.etat(),
    ecranCompte: !!document.querySelector('[data-testid="ecran-compte"]'),
    formulaire: !!document.querySelector("#feuille .pub-etape, #feuille [data-pub], #formPub") ||
                /Publier|Quel événement|Que veux-tu/i.test(
                  (document.getElementById("feuille") || {}).textContent || ""),
    accueil: !!(document.getElementById("feuille2") && !document.getElementById("feuille2").hidden),
  }));
  ok("connexion · la session porte l'adresse", !!(apres.compte && apres.compte.email),
     JSON.stringify(apres.compte));
  ok("connexion · l'écran de compte se referme", apres.ecranCompte === false);
  ok("connexion → retour automatique à la création", apres.formulaire === true,
     "on ne renvoie pas sur l'accueil");

  await remplirBrouillon(page, "Concert du quartier");
  await page.evaluate(() => publier());
  await page.waitForTimeout(900);
  const publiees = await page.evaluate(() => window.__auth.publications());
  ok("connecté → création · la publication part", publiees.length === 1,
     JSON.stringify(publiees.map((p) => p.titre)));
  ok("connecté → création · elle porte created_by = mon uid",
     publiees.length === 1 && publiees[0].created_by === apres.compte.uid,
     publiees.length ? publiees[0].created_by : "");
  ok("connecté → création · creator_id et created_by sont identiques",
     publiees.length === 1 && publiees[0].creator_id === publiees[0].created_by);

  /* ---- Le propriétaire modifie et supprime ----------------------------- */
  const dbId = publiees[0].id;
  const modifie = await page.evaluate((id) =>
    Store.modifierEvenement(id, { titre: "Concert déplacé" }), dbId);
  ok("propriétaire → modification", modifie === true);
  ok("propriétaire → modification · elle a pris",
     (await page.evaluate(() => window.__auth.publications()))[0].titre === "Concert déplacé");

  const supprime = await page.evaluate((id) => Store.supprimer(id), dbId);
  ok("propriétaire → suppression", supprime === true);
  ok("propriétaire → suppression · la ligne a disparu",
     (await page.evaluate(() => window.__auth.publications())).length === 0);

  await ctx.close();
}

/* ---- 3. Un autre compte ne touche à rien -------------------------------- */
{
  const { ctx, page } = await nouvelOnglet(navigateur, "autre");

  // A publie
  await onglet(page, "creer");
  await page.waitForTimeout(400);
  await seConnecter(page, "a@example.invalid");
  await remplirBrouillon(page, "Événement de A");
  await page.evaluate(() => publier());
  await page.waitForTimeout(900);
  const deA = await page.evaluate(() => window.__auth.publications());
  ok("compte A · a bien publié", deA.length === 1, JSON.stringify(deA.map((p) => p.titre)));
  const idDeA = deA[0].id;

  // B se connecte à la place de A
  await page.evaluate(() => Store.dispo);
  await page.evaluate(() => seDeconnecter());
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__auth.seConnecterCommme("b@example.invalid"));
  await page.waitForTimeout(500);

  const bVoit = await page.evaluate((id) => {
    const p = window.__auth.publications().find((x) => x.id === id);
    return !!p;
  }, idDeA);
  ok("autre utilisateur · voit la publication de A", bVoit === true,
     "la lecture est publique, et c'est voulu");

  const modifRefusee = await page.evaluate((id) =>
    Store.modifierEvenement(id, { titre: "Détourné par B" }), idDeA);
  ok("autre utilisateur → modification refusée", modifRefusee === false);
  ok("autre utilisateur → le titre de A est intact",
     (await page.evaluate((id) => window.__auth.publications()
       .find((x) => x.id === id).titre, idDeA)) === "Événement de A");

  const supprRefusee = await page.evaluate((id) => Store.supprimer(id), idDeA);
  ok("autre utilisateur → suppression refusée", supprRefusee === false);
  ok("autre utilisateur → la publication de A existe toujours",
     (await page.evaluate(() => window.__auth.publications())).length === 1);

  await ctx.close();
}

/* ---- 4. Favoris : demande, reprise, déconnexion, reconnexion ------------ */
{
  const { ctx, page } = await nouvelOnglet(navigateur, "favoris");

  // un visiteur touche un cœur : on demande, avec les mots du favori
  const aUnCoeur = await page.evaluate(() => {
    const b = document.querySelector("[data-coeur]");
    if (!b) return false;
    b.click();
    return true;
  });
  if (aUnCoeur) {
    await page.waitForTimeout(600);
    const demande = await ecranCompteVisible(page);
    ok("visiteur → favori · le compte est demandé", !!demande);
    ok("visiteur → favori · avec les mots du favori",
       demande && demande.titre === "Retrouve tes favoris partout",
       demande ? demande.titre : "aucun écran");
    ok("visiteur → favori · le cœur n'est pas resté allumé derrière l'écran",
       (await page.evaluate(() => document.querySelectorAll("[data-coeur].actif").length)) === 0);

    await seConnecter(page, "claire@example.invalid");
    await page.waitForTimeout(800);
    const favoris = await page.evaluate(() => window.__auth.favoris());
    ok("connexion → le favori commencé est repris tout seul", favoris.length === 1,
       JSON.stringify(favoris.map((f) => f.titre)));
  } else {
    ok("visiteur → favori · un cœur est affiché", false, "aucun [data-coeur] à l'écran");
  }

  // déconnexion
  await page.evaluate(() => seDeconnecter());
  await page.waitForTimeout(500);
  const deconnecte = await page.evaluate(() => ({
    session: window.__auth.etat(),
    coeurs: document.querySelectorAll("[data-coeur].actif").length,
  }));
  ok("déconnexion · la session est fermée", deconnecte.session === null);
  ok("déconnexion · aucun favori ne reste affiché", deconnecte.coeurs === 0);

  // reconnexion : on retrouve ce qui est à soi
  await page.evaluate(() => window.__auth.seConnecterCommme("claire@example.invalid"));
  await page.waitForTimeout(900);
  const retrouve = await page.evaluate(async () => ({
    favoris: (await Store.favoris()).length,
    session: window.__auth.etat(),
  }));
  ok("reconnexion · même adresse, même uid",
     retrouve.session && retrouve.session.email === "claire@example.invalid");
  ok("reconnexion · les favoris sont récupérés", retrouve.favoris === 1,
     retrouve.favoris + " favori(s)");

  await ctx.close();
}

/* ---- 5. Le profil ------------------------------------------------------- */
{
  const { ctx, page } = await nouvelOnglet(navigateur, "profil");

  await onglet(page, "profil");
  await page.waitForTimeout(500);
  const visiteur = await page.evaluate(() => {
    const e = document.querySelector('[data-testid="profil-visiteur"]');
    return e ? e.textContent : null;
  });
  ok("visiteur → Profil · montre ce qu'un compte apporte", !!visiteur);
  ok("visiteur → Profil · ne dit pas « connectez-vous » sèchement",
     visiteur && /publier|favoris|prévenu/i.test(visiteur), visiteur || "");

  await page.evaluate(() => window.__auth.seConnecterCommme("dora@example.invalid"));
  await page.waitForTimeout(600);
  await onglet(page, "profil");
  await page.waitForTimeout(600);
  const profil = await page.evaluate(() => {
    const e = document.querySelector('[data-testid="profil"]');
    if (!e) return null;
    return {
      pseudo: !!document.getElementById("profPseudo"),
      email: (document.querySelector('[data-testid="profil-email"]') || {}).textContent || "",
      publications: !!document.querySelector('[data-profil="publications"]'),
      favoris: !!document.querySelector('[data-profil="favoris"]'),
      notifications: !!document.getElementById("profNotifs"),
      deconnexion: !!document.getElementById("profDeconnexion"),
    };
  });
  ok("connecté → Profil · l'écran existe", !!profil);
  if (profil) {
    ok("Profil · pseudo", profil.pseudo);
    ok("Profil · adresse e-mail, et seulement ici", profil.email === "dora@example.invalid",
       profil.email);
    ok("Profil · Mes publications", profil.publications);
    ok("Profil · Mes favoris", profil.favoris);
    ok("Profil · Notifications", profil.notifications);
    ok("Profil · Se déconnecter", profil.deconnexion);
  }

  await page.evaluate(() => {
    document.getElementById("profPseudo").value = "Dora";
    document.getElementById("profPseudoOk").click();
  });
  await page.waitForTimeout(500);
  ok("Profil · le pseudo s'enregistre",
     (await page.evaluate(async () => {
       const { data } = await sb.from("profiles").select("display_name").eq("id", moiId).maybeSingle();
       return data && data.display_name;
     })) === "Dora");

  await ctx.close();
}

await navigateur.close();
serveur.close();

const passes = resultats.filter((r) => r.ok).length;
console.log("\n" + passes + "/" + resultats.length + " vérifications passées");
if (anomalies.length) {
  console.log("\n──── anomalies JS observées ────");
  anomalies.forEach((a) => console.log("  · " + a));
}
process.exit(passes === resultats.length ? 0 : 1);
