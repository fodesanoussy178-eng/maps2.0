/* ===========================================================================
   LES TROIS VOIES — la logique, sans réseau et sans base

   Tout ce fichier est pur : on lui donne une réponse déjà obtenue, il rend un
   verdict. C'est ce qui permet de le tester entièrement sans jeton, sans
   Supabase et sans dépendre de la disponibilité d'une API publique — exactement
   comme `sync-datatourisme/normalisation.mjs`.

   LE CONTRAT DE SORTIE EST LE MÊME POUR LES TROIS VOIES (A.5) :

     { statut: "ouvert" | "ferme_definitivement" | "inconnu",
       date_information: "AAAA-MM-JJ" | null,
       url_source: "https://…" | null,
       confiance: 0.0 }

   Et la règle qui le gouverne est mécanique, vérifiée ici et par la base, pas
   déclarée dans une invite : PAS D'URL EXPLOITABLE → `inconnu` → AUCUNE
   ÉCRITURE. Une voie qui ne sait pas doit pouvoir le dire sans coût.
=========================================================================== */

export const STATUTS = Object.freeze(["ouvert", "ferme_definitivement", "inconnu"]);

export const INCONNU = Object.freeze({
  statut: "inconnu", date_information: null, url_source: null, confiance: 0,
});

const texte = (v) => String(v == null ? "" : v).trim();

export function urlExploitable(valeur) {
  const v = texte(valeur);
  if (!/^https?:\/\/[^\s]+$/i.test(v)) return null;
  try {
    const url = new URL(v);
    /* Ni `localhost`, ni une IP nue : une source qu'on ne peut pas rouvrir
       plus tard depuis un autre poste n'est pas une source. */
    if (!/\./.test(url.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function dateISO(valeur) {
  const v = texte(valeur).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(v + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : v;
}

/* Le point de passage obligé. Tout ce qui sort d'une voie traverse cette
   fonction, y compris ce qui vient du modèle : c'est le code appelant qui
   applique la règle, jamais le producteur qui promet de l'appliquer. */
export function validerContrat(brut) {
  const p = brut && typeof brut === "object" ? brut : {};
  const statut = STATUTS.includes(texte(p.statut)) ? texte(p.statut) : "inconnu";
  const url = urlExploitable(p.url_source);
  const confiance = Number(p.confiance);
  if (statut === "inconnu" || !url) return { ...INCONNU };
  return {
    statut,
    date_information: dateISO(p.date_information),
    url_source: url,
    confiance: Number.isFinite(confiance) ? Math.min(1, Math.max(0, confiance)) : 0,
  };
}

/* ===========================================================================
   VOIE 1 — DÉTERMINISTE, GRATUITE, ILLIMITÉE
=========================================================================== */

/* SIRENE, via l'API Recherche d'entreprises. L'état administratif d'un
   établissement est une donnée publique, structurée et qui fait foi : `A`
   actif, `F` fermé. C'est exactement la question qu'on pose, et elle ne coûte
   rien. On lit l'établissement qui porte le SIRET demandé — jamais le premier
   venu, sinon un siège actif masquerait une antenne fermée. */
export function statutDepuisSirene(corps, siret, urlSource) {
  const resultats = Array.isArray(corps && corps.results) ? corps.results : [];
  const cible = texte(siret).replace(/\s+/g, "");
  let etablissement = null;
  for (const resultat of resultats) {
    const candidats = [
      ...(Array.isArray(resultat.matching_etablissements) ? resultat.matching_etablissements : []),
      ...(resultat.siege ? [resultat.siege] : []),
    ];
    etablissement = candidats.find((e) => texte(e && e.siret).replace(/\s+/g, "") === cible) || etablissement;
  }
  if (!etablissement) return { ...INCONNU };
  const etat = texte(etablissement.etat_administratif).toUpperCase();
  if (etat !== "A" && etat !== "F") return { ...INCONNU };
  return validerContrat({
    statut: etat === "F" ? "ferme_definitivement" : "ouvert",
    date_information: dateISO(etablissement.date_fermeture) ||
      dateISO(etablissement.date_derniere_mise_a_jour) || null,
    url_source: urlSource,
    /* Un registre administratif ne se trompe pas sur l'existence juridique.
       Il peut retarder de quelques semaines sur la réalité du rideau, d'où
       « presque certain » et non « certain ». */
    confiance: 0.95,
  });
}

/* FINESS pour les établissements sanitaires et médico-sociaux. Même forme :
   un état publié, pas une interprétation. */
export function statutDepuisFiness(fiche, urlSource) {
  const p = fiche && typeof fiche === "object" ? fiche : {};
  const etat = texte(p.etatObjet || p.etat || p.statutFonctionnement).toUpperCase();
  const fermeture = dateISO(p.dateFermeture || p.date_fermeture);
  if (!etat && !fermeture) return { ...INCONNU };
  const ferme = fermeture != null || ["FERME", "F", "I", "INACTIF"].includes(etat);
  return validerContrat({
    statut: ferme ? "ferme_definitivement" : "ouvert",
    date_information: fermeture || dateISO(p.dateMaj || p.date_maj),
    url_source: urlSource,
    confiance: 0.93,
  });
}

/* `HEAD` sur `official_url`. ATTENTION À CE QUE ÇA PROUVE, ET SURTOUT À CE QUE
   ÇA NE PROUVE PAS : une page qui répond ne dit pas qu'un lieu est ouvert, et
   un 404 ne dit pas qu'il a fermé — un site refait, une migration, un domaine
   qui expire produisent le même code. Ce signal ne produit donc JAMAIS de
   proposition à lui seul. Il corrobore, ou il alerte. */
export function signalHead(statutHttp) {
  const code = Number(statutHttp);
  if (!Number.isFinite(code)) return { joignable: null, alerte: null };
  if (code >= 200 && code < 400) return { joignable: true, alerte: null };
  if (code === 404 || code === 410) return { joignable: false, alerte: "page_disparue" };
  /* 403, 429, 5xx : le serveur parle, il refuse. Ce n'est pas une disparition. */
  return { joignable: null, alerte: null };
}

/* LE DIFF OVERPASS À 48 H N'EST PAS DÉFINI ICI, ET C'EST VOULU.

   `outils/zones.mjs` produit les tuiles dans GitHub Actions, sous Node, et il
   y écrit déjà le champ `disparus` de chaque tuile : les lieux présents au
   cycle N et absents au cycle N+1. C'est lui qui possède la comparaison, avec
   la récolte qui la rend possible.

   Ce fichier-ci est déployé séparément, sous un autre runtime. Lui faire
   porter l'utilitaire obligerait un outil de CI à importer une fonction Edge
   pour s'exécuter — une dépendance à contresens, qui casse au premier
   changement de plateforme. Si une voie a besoin de cette comparaison un
   jour, c'est elle qui importera `outils/zones.mjs`, jamais l'inverse.

   La voie 1 n'en a pas besoin pour l'instant : elle lit le signal déjà écrit
   dans la tuile, elle ne le recalcule pas. */

/* ===========================================================================
   VOIE 2 — HTTP STRUCTURÉ, GRATUITE

   Le JSON-LD `schema.org/Event` que beaucoup de sites culturels et de
   billetteries exposent dans leur `<head>`, plus les flux RSS. C'est
   probablement le gisement principal pour les événements absents d'OpenAgenda
   et de DATAtourisme, et il ne coûte rien.

   Instagram et Facebook sont hors jeu : leurs CGU interdisent la collecte.
=========================================================================== */

export function extraireJsonLd(html) {
  const blocs = [];
  const source = texte(html);
  for (const m of source.matchAll(
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const valeur = JSON.parse(m[1].trim());
      /* Un bloc mal formé n'invalide pas la page : les autres sont lus. */
      if (valeur && typeof valeur === "object") blocs.push(valeur);
    } catch { /* bloc illisible : ignoré, jamais réparé à la main */ }
  }
  return blocs;
}

/* `@graph`, tableaux imbriqués, objet seul : trois emballages pour la même
   chose. On les aplatit avant de regarder les types. */
function aplatirLd(valeur, sortie = []) {
  if (Array.isArray(valeur)) { valeur.forEach((v) => aplatirLd(v, sortie)); return sortie; }
  if (!valeur || typeof valeur !== "object") return sortie;
  sortie.push(valeur);
  if (valeur["@graph"]) aplatirLd(valeur["@graph"], sortie);
  return sortie;
}

const TYPES_EVENEMENT = /(^|\/)((Music|Theater|Screening|Festival|Social|Sports|Exhibition|Comedy|Dance|Literary|Food|Education|Business|Childrens|Visual|Course|Delivery|Public|Sale)?Event)$/i;

function estEvenement(noeud) {
  const types = Array.isArray(noeud["@type"]) ? noeud["@type"] : [noeud["@type"]];
  return types.some((t) => TYPES_EVENEMENT.test(texte(t)));
}

function lieuDe(noeud) {
  const lieu = noeud.location;
  const premier = Array.isArray(lieu) ? lieu[0] : lieu;
  if (!premier) return null;
  if (typeof premier === "string") return { nom: texte(premier), adresse: "", lat: null, lng: null };
  const adresse = premier.address;
  const a = typeof adresse === "string" ? { streetAddress: adresse } : (adresse || {});
  const geo = premier.geo || {};
  const nombre = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  return {
    nom: texte(premier.name),
    adresse: [a.streetAddress, a.postalCode, a.addressLocality].map(texte).filter(Boolean).join(", "),
    lat: nombre(geo.latitude), lng: nombre(geo.longitude),
  };
}

/* On rend ce que la page DÉCLARE, avec l'URL de la page. Aucun champ n'est
   complété, deviné ni reformulé : un événement sans date reste sans date, et
   c'est ce qui le fera écarter plus loin plutôt que d'être affiché à tort. */
export function evenementsJsonLd(html, urlPage) {
  const url = urlExploitable(urlPage);
  const noeuds = extraireJsonLd(html).flatMap((bloc) => aplatirLd(bloc));
  return noeuds.filter(estEvenement).map((noeud) => ({
    titre: texte(noeud.name),
    debut: texte(noeud.startDate) || null,
    fin: texte(noeud.endDate) || null,
    statut: texte(noeud.eventStatus).split("/").pop() || null,
    url: urlExploitable(noeud.url) || url,
    lieu: lieuDe(noeud),
    source: url,
  })).filter((e) => e.titre && e.debut);
}

/* Un événement annulé est le seul verdict qu'une page structurée donne sans
   ambiguïté. « Reporté » n'est pas « annulé » : on ne les confond pas. */
export function statutDepuisEvenementLd(evenement) {
  const statut = texte(evenement && evenement.statut);
  if (/^EventCancelled$/i.test(statut)) {
    return validerContrat({
      statut: "ferme_definitivement",
      date_information: dateISO(new Date().toISOString()),
      url_source: evenement.url || evenement.source,
      confiance: 0.9,
    });
  }
  if (/^EventScheduled$/i.test(statut)) {
    return validerContrat({
      statut: "ouvert",
      date_information: dateISO(evenement.debut) || dateISO(new Date().toISOString()),
      url_source: evenement.url || evenement.source,
      confiance: 0.8,
    });
  }
  return { ...INCONNU };
}

/* Les flux RSS et Atom. Pas de dépendance XML : on ne construit pas un arbre,
   on lit des éléments dont la forme est stable depuis vingt ans. Un flux
   qu'on ne sait pas lire ne produit rien — jamais un titre approximatif. */
export function articlesRss(xml, urlFlux) {
  const source = texte(xml);
  const items = [];
  const decoder = (v) => texte(v)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#3[49];/g, "'").replace(/&amp;/g, "&")
    .trim();
  const champ = (bloc, nom) => {
    const m = bloc.match(new RegExp("<" + nom + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + nom + ">", "i"));
    return m ? decoder(m[1]) : "";
  };
  for (const m of source.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)) {
    const bloc = m[2];
    const lien = champ(bloc, "link") ||
      (bloc.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || "";
    const item = {
      titre: champ(bloc, "title"),
      url: urlExploitable(lien),
      publie: champ(bloc, "pubDate") || champ(bloc, "published") || champ(bloc, "updated") || null,
      resume: champ(bloc, "description") || champ(bloc, "summary"),
      flux: urlExploitable(urlFlux),
    };
    if (item.titre && item.url) items.push(item);
  }
  return items;
}

/* ===========================================================================
   L'ORDRE DES VOIES

   Ce n'est pas une préférence de style : c'est une règle de dépense. Environ
   330 objets par cycle passent par la voie 3, et les dépenser sur ce que
   SIRENE donne gratuitement, c'est ne pas les avoir pour le reste.
=========================================================================== */

export const ORDRE_DES_VOIES = Object.freeze(["deterministe", "http", "grounde"]);

/* Rend la première voie qui a tranché. « Tranché » veut dire : autre chose
   qu'`inconnu`. Une voie qui répond `inconnu` n'a rien coûté de plus que son
   appel, et la suivante prend le relais. */
export function premierVerdict(verdicts) {
  for (const voie of ORDRE_DES_VOIES) {
    const v = verdicts && verdicts[voie];
    if (v && v.statut && v.statut !== "inconnu") return { voie, ...validerContrat(v) };
  }
  return { voie: null, ...INCONNU };
}
