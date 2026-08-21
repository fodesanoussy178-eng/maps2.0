/* L'AFFICHE D'UN ÉVÉNEMENT OPENAGENDA, ET LE BUG QU'ELLE CACHAIT.

   CE QUI SE PASSAIT

   `normalize.mjs` cherchait une URL d'image en descendant l'objet `image` clé
   par clé, dans cet ordre :

       ["url", "full", "base", "original", "large", "medium", "thumbnail", "src", "@id"]

   Or OpenAgenda v2 ne rend pas une URL. Il rend un objet en DEUX morceaux :

       "image": {
         "base": "https://img.openagenda.com/main/",
         "filename": "5f3c1a....jpg",
         "size": {"width": 1500, "height": 1000},
         "variants": [{"filename": "5f3c1a....jpg", "type": "thumbnail", …}]
       }

   `base` est le troisième de la liste, c'est une chaîne, et elle commence par
   `https://`. La descente s'arrêtait donc là et rendait le RÉPERTOIRE :

       https://img.openagenda.com/main/          →  HTTP 400

   Ce n'est pas une image manquante : c'est une image PRÉSENTE dont on jetait
   la moitié du nom. Chaque événement illustré de l'agenda produisait cette
   URL, elle était écrite en base, servie au navigateur, et le `onerror` de la
   carte retirait sagement la balise — l'écran n'a jamais montré d'erreur, il
   a seulement montré des cartes sans photo.

   CE QU'ON FAIT

   On recompose le nom complet : `base` + `filename`. Et on va chercher, quand
   il existe, le variant le plus proche de ce qu'une carte affiche, plutôt que
   l'original à deux mégaoctets.

   Masquer l'erreur aurait consisté à filtrer les URL en 400. On fait
   l'inverse : on retrouve le champ d'origine, et on construit l'URL correcte.
   La garde `urlNommeUnFichier` reste en dernier rideau — si OpenAgenda change
   encore la forme de l'objet, on rendra `null`, jamais un répertoire. */

/* Ce que la carte de recommandation affiche : 74 px de haut, pleine largeur.
   Sur un écran à trois pixels physiques par point, 900 px de large couvre
   largement — et reste vingt fois plus léger que l'original. */
const LARGEUR_UTILE = 900;

function texte(valeur) {
  if (valeur == null) return "";
  if (typeof valeur === "string" || typeof valeur === "number") return String(valeur);
  if (Array.isArray(valeur)) return valeur.map(texte).find(Boolean) || "";
  if (typeof valeur === "object") {
    for (const cle of ["fr", "@value", "value", "label", "text", "content"]) {
      if (valeur[cle] != null) {
        const trouve = texte(valeur[cle]);
        if (trouve) return trouve;
      }
    }
  }
  return "";
}

/* UNE URL D'IMAGE NOMME UN FICHIER.

   `https://img.openagenda.com/main/` n'en nomme aucun : le dernier segment du
   chemin est vide. C'est la signature exacte du bug, et c'est aussi la seule
   vérification qui reste vraie si le format change encore. */
export function urlNommeUnFichier(url) {
  const u = String(url == null ? "" : url).trim();
  if (!/^https?:\/\//i.test(u)) return false;
  const chemin = u.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
  const dernier = chemin.split("/").filter(Boolean).pop() || "";
  if (!dernier) return false;
  /* Un mot d'arborescence seul est un répertoire — sauf si autre chose
     désigne bien une ressource : une extension, ou des paramètres. C'est ce
     qui distingue `https://img.openagenda.com/main/` d'une URL d'API. La même
     nuance est écrite dans `images.js` et dans la fonction SQL, et un test
     compare les trois sur les mêmes cas. */
  const nommeUneRessource = /\.[a-z0-9]{2,5}$/i.test(dernier) || u.indexOf("?") >= 0;
  return nommeUneRessource || !/^(main|media|images?|photos?|thumb|thumbnails?)$/i.test(dernier);
}

function joindre(base, nom) {
  const b = String(base || "").trim();
  const n = String(nom || "").trim();
  if (!n) return "";
  if (/^https?:\/\//i.test(n)) return n;             // déjà absolu : rien à joindre
  if (!/^https?:\/\//i.test(b)) return "";
  return b.replace(/\/+$/, "") + "/" + n.replace(/^\/+/, "");
}

function surface(variant) {
  const taille = (variant && variant.size) || {};
  const l = Number(taille.width), h = Number(taille.height);
  return Number.isFinite(l) && Number.isFinite(h) ? l * h : 0;
}

/* CHOISIR LA BONNE TAILLE, PAS LA PLUS PETITE.

   Le fichier principal et ses variants sont mis en concurrence ensemble :
   on prend le PLUS PETIT qui reste assez large pour l'affichage, et à défaut
   le plus grand disponible. Ne regarder que les variants ferait servir une
   vignette de 400 px alors que l'original en fait 1500 — floue sur un écran
   dense, pour rien. */
function candidats(image) {
  const liste = (Array.isArray(image.variants) ? image.variants : [])
    .filter((v) => v && (v.filename || v.url))
    .map((v) => ({base: v.base || image.base, nom: v.filename || v.url, size: v.size}));
  if (image.filename) liste.push({base: image.base, nom: image.filename, size: image.size});
  return liste;
}

function meilleurCandidat(liste) {
  if (!liste.length) return null;
  const assezLarges = liste.filter((v) => Number((v.size || {}).width) >= LARGEUR_UTILE);
  if (assezLarges.length) return assezLarges.sort((a, b) => surface(a) - surface(b))[0];
  return liste.sort((a, b) => surface(b) - surface(a))[0];
}

/* LA RECONSTRUCTION. C'est le cœur du correctif.

   On accepte les quatre formes qu'OpenAgenda a servies au fil de ses
   versions : la chaîne nue, `originalImage`, `thumbnail`, et l'objet
   `base` + `filename` + `variants` de la v2. */
export function construireUrlImage(image) {
  if (image == null) return "";
  if (typeof image === "string") return urlNommeUnFichier(image) ? image : "";
  if (Array.isArray(image)) {
    for (const item of image) {
      const url = construireUrlImage(item);
      if (url) return url;
    }
    return "";
  }
  if (typeof image !== "object") return "";

  const base = String(image.base || "").trim();

  /* Le fichier recomposé — `base` + `filename` — mis en concurrence avec ses
     variants. C'est CE chemin qui rendait `.../main/` et donc 400. */
  const choisi = meilleurCandidat(candidats(image));
  if (choisi) {
    const url = joindre(choisi.base || base, choisi.nom);
    if (urlNommeUnFichier(url)) return url;
  }

  /* Enfin les formes historiques, qui portent déjà une URL entière. */
  for (const cle of ["originalImage", "thumbnail", "url", "src", "@id"]) {
    const valeur = image[cle];
    if (typeof valeur === "string" && urlNommeUnFichier(valeur)) return valeur;
    if (valeur && typeof valeur === "object") {
      const url = construireUrlImage(valeur);
      if (url) return url;
    }
  }

  /* `base` seule ne devient JAMAIS une URL. C'est la ligne qui manquait. */
  return "";
}

/* Le crédit photo d'OpenAgenda. Il existe, il était ignoré, et c'est lui qui
   permet d'écrire `image_author` au lieu d'une case vide. */
export function creditsImage(image, evenement) {
  const source = (image && typeof image === "object" ? image : {});
  return texte(source.credits ?? source.credit ?? source.author
    ?? (evenement && (evenement.imageCredits ?? evenement.imageCredit))) || "";
}

/* Le contrat d'Autour, rendu depuis un événement OpenAgenda brut. Les six
   champs sont ceux du résolveur client : une seule forme, des deux côtés. */
export function imageOpenAgenda(evenement, {sourceUrl = null, now = new Date()} = {}) {
  const brute = evenement && (evenement.image ?? evenement.originalImage ?? evenement.thumbnail);
  const url = construireUrlImage(brute);
  if (!url) return null;
  return {
    image_url: url,
    image_source: "openagenda",
    image_source_url: sourceUrl || "",
    image_author: creditsImage(brute, evenement),
    /* On n'invente pas une licence Creative Commons à l'affiche de quelqu'un :
       on dit d'où elle vient. C'est vérifiable, et c'est suffisant pour
       l'afficher — l'organisateur la publie pour qu'elle soit vue. */
    image_license: "affiche fournie par l’organisateur",
    image_updated_at: texte(evenement && evenement.updatedAt) || new Date(now).toISOString(),
  };
}

export const OPENAGENDA_IMAGE_LARGEUR = LARGEUR_UTILE;
