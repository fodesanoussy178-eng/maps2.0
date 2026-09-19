/* ---------------------------------------------------------------------------
   Reconnaître deux fois la même structure

   « Médiathèque André Malraux » à Tourcoing apparaît dans `events` sous
   « Tourcoing/Médiathèque André Malraux », dans `places` sous « Médiathèque
   André Malraux », et dans l'annuaire des entreprises sous « MEDIATHEQUE
   ANDRE MALRAUX ». Trois écritures, une structure. Sans clé de rapprochement,
   une récolte relancée demain crée trois lignes de plus, et le fondateur écrit
   trois fois à la même personne — ce qui est exactement le spam que le §8
   interdit, obtenu sans le vouloir.

   La clé est volontairement PAUVRE : nom normalisé + ville normalisée. Elle
   rapproche ce qui est manifestement identique et ne prétend rien de plus.
   Deux associations réellement différentes qui portent le même nom dans la
   même ville seront fusionnées à tort ; c'est un cas rare, visible à la
   relecture, et le prix à payer pour ne pas inventer une heuristique de
   ressemblance dont personne ne pourrait expliquer les décisions.
--------------------------------------------------------------------------- */

/* Le préfixe de commune qu'OpenAgenda colle devant ses lieux
   (« Tourcoing/Médiathèque… »). Il n'appartient pas au nom. */
const PREFIXE_COMMUNE = /^[A-ZÀ-Ÿ][\wÀ-ÿ'’\- ]{2,30}\s*\/\s*/;

export function normaliserTexte(valeur) {
  return String(valeur ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")   // accents
    .toLowerCase()
    .replace(/['’`]/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* Les mots qui ne distinguent rien. « Le Bistrot de St So » et « Bistrot St
   So » doivent se rapprocher ; « la » et « de » n'y aident pas. */
const MOTS_VIDES = new Set(["le", "la", "les", "l", "de", "du", "des", "d", "et", "a", "au", "aux"]);

export function nomNormalise(nom) {
  const brut = String(nom ?? "").replace(PREFIXE_COMMUNE, "");
  return normaliserTexte(brut).split(" ").filter((m) => m && !MOTS_VIDES.has(m)).join(" ");
}

export function nomAffiche(nom) {
  return String(nom ?? "").replace(PREFIXE_COMMUNE, "").trim();
}

export function cleDedup(nom, ville) {
  const n = nomNormalise(nom);
  const v = normaliserTexte(ville);
  if (!n || !v) return "";
  return `${n}@${v}`;
}

/* ---------------------------------------------------------------------------
   DEVINER UN TYPE, ET DIRE SUR QUOI

   Un type deviné qu'on ne peut pas justifier est une caractéristique inventée
   (§6). Chaque règle rend donc AUSSI la phrase qui l'explique, et c'est cette
   phrase qui part dans `fait_observe`. Quand aucune règle ne s'applique, le
   type reste `structure` — le mot le plus vague du vocabulaire, choisi exprès
   pour que « on ne sait pas » se lise comme tel.
--------------------------------------------------------------------------- */
const REGLES_TYPE = [
  [/\b(mediatheque|bibliotheque|ludotheque)\b/, "lieu_culturel", "le nom contient « médiathèque » ou « bibliothèque »"],
  [/\b(musee|muba|piscine musee)\b/, "lieu_culturel", "le nom contient « musée »"],
  [/\b(theatre|opera|conservatoire|cinema|studio national)\b/, "lieu_culturel", "le nom désigne une salle de spectacle ou de cinéma"],
  [/\b(zenith|aeronef|salle|grand palais|halle|arena)\b/, "lieu_de_sortie", "le nom désigne une salle accueillant du public"],
  [/\b(maison folie|ferme d en haut|centre culturel|maison de quartier|mjc)\b/, "lieu_culturel", "le nom désigne un équipement culturel de quartier"],
  [/\b(bistrot|cafe|bar|brasserie|restaurant|friterie)\b/, "commerce", "le nom désigne un commerce de bouche"],
  [/\b(universite|iut|ecole|lycee|campus|crous|estaca|hei|isen)\b/, "etablissement_etudiant", "le nom désigne un établissement d'enseignement"],
  [/\b(club|sportif|stade|gymnase|piscine)\b/, "club", "le nom désigne un équipement ou un club sportif"],
  [/\b(association|amicale|collectif|federation)\b/, "association", "le nom contient « association », « amicale » ou « collectif »"],
  [/\b(ville de|mairie|commune|metropole|departement)\b/, "collectivite", "le nom désigne une collectivité"],
  [/\b(jardin|parc|square|foret)\b/, "lieu_de_sortie", "le nom désigne un espace public de plein air"],
];

export function deduireType(nom, indice) {
  const n = normaliserTexte(nom);
  for (const [motif, type, pourquoi] of REGLES_TYPE) {
    if (motif.test(n)) return { type, pourquoi: `Type déduit du nom : ${pourquoi}.` };
  }
  /* L'indice vient de la donnée, pas du nom : `places.family` a été posée par
     la taxonomie d'Autour, elle vaut mieux qu'une expression régulière. */
  const parFamille = {
    culture: "lieu_culturel", bibliotheque: "lieu_culturel", cinema: "lieu_culturel",
    musique: "lieu_de_sortie", sport: "club", association: "association",
    commerce: "commerce", restauration: "commerce", patrimoine: "lieu_culturel",
    nature: "lieu_de_sortie",
  };
  if (indice && parFamille[indice]) {
    return {
      type: parFamille[indice],
      pourquoi: `Type déduit de la famille « ${indice} » posée par la taxonomie des lieux d'Autour.`,
    };
  }
  return { type: "structure", pourquoi: "Aucune règle de nom ni famille connue : le type reste indéterminé." };
}

/* ---------------------------------------------------------------------------
   FUSIONNER SANS PERDRE UNE SOURCE

   Deux candidats de même clé donnent UNE opportunité et DEUX sources. C'est
   l'inverse exact d'une colonne `source` unique, qui garderait la dernière vue
   et effacerait la première.
--------------------------------------------------------------------------- */
export function fusionner(candidats) {
  const parCle = new Map();
  let ignores = 0;

  for (const c of candidats || []) {
    if (!c || !c.cle) { ignores += 1; continue; }
    const existant = parCle.get(c.cle);
    if (!existant) { parCle.set(c.cle, { ...c, sources: [...(c.sources || [])] }); continue; }

    ignores += 1;
    for (const s of c.sources || []) {
      const deja = existant.sources.some((x) => x.source === s.source && (x.url || "") === (s.url || ""));
      if (!deja) existant.sources.push(s);
    }
    /* Ce qui manque se complète ; ce qui est déjà là ne se remplace pas. La
       première source qui a su répondre garde la main : elle est, par
       construction, celle qui vient des données d'Autour. */
    for (const champ of ["description", "canal", "code_insee", "zone_id", "place_id"]) {
      if (existant[champ] == null && c[champ] != null) existant[champ] = c[champ];
    }
    existant.faits = { ...(c.faits || {}), ...(existant.faits || {}) };
    if (existant.type === "structure" && c.type !== "structure") {
      existant.type = c.type;
      existant.type_pourquoi = c.type_pourquoi;
    }
  }
  return { opportunites: [...parCle.values()], doublons: ignores };
}
