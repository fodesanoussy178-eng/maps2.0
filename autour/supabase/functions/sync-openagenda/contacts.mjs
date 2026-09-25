/* ---------------------------------------------------------------------------
   LES COORDONNÉES QUE LA SOURCE DONNAIT DÉJÀ

   OpenAgenda publie, sur chaque fiche, un tableau `registration` : les moyens
   par lesquels l'organisateur veut être joint pour cet événement. Un lien de
   billetterie, un numéro, une adresse. Autour ne les lisait pas. La fiche
   affichait « Appeler » et « Site web » grisés alors que le numéro et l'URL
   étaient dans la réponse de l'API, à deux champs de distance.

   Ce module ne fait qu'une chose : transformer ce que la source dit en quatre
   valeurs utilisables par la fiche — `booking_url`, `phone`, `email`,
   `website` — et refuser de rendre ce qu'il ne sait pas valider.

   TROIS DÉCISIONS QUI MÉRITENT D'ÊTRE DITES

   1. UN LIEN TROUVÉ DANS LA DESCRIPTION N'EST PAS UNE BILLETTERIE.
      Quand `registration` porte un lien, la source affirme qu'on s'inscrit
      là : ce lien devient `booking_url`, et la fiche pourra proposer
      « Réserver ». Quand le lien n'a été que repêché dans le texte, on ne
      sait rien de plus que « l'organisateur a écrit cette adresse » : il
      devient `website`. La fiche l'affichera sous « Site web », sans
      promettre une réservation qui n'existe peut-être pas.

   2. UN NUMÉRO NON NORMALISABLE N'EST PAS ÉCRIT.
      La colonne `events.phone` porte une contrainte CHECK en E.164. Un
      numéro que `telephoneE164` ne sait pas ramener à cette forme ferait
      échouer l'INSERT de tout l'événement. On préfère une fiche sans
      téléphone à une synchronisation qui tombe.

   3. LE REPÊCHAGE DANS LE TEXTE RESTE UN REPÊCHAGE.
      La regex des numéros français reconnaît aussi, en théorie, une suite de
      nombres écrite comme « 05 06 07 08 09 ». Les séparateurs « / » et « : »
      sont exclus pour écarter les dates, et un chiffre collé avant ou après
      disqualifie le motif ; le risque résiduel est une suite de nombres à la
      typographie exactement téléphonique, ce qui reste rare dans une
      description d'événement. C'est le prix d'un fallback, et il n'entre en
      jeu que lorsque la source n'a rien fourni de structuré.
--------------------------------------------------------------------------- */

import {telephoneE164, urlPropre, courrielPropre, texteBrut,
  INDICATIF_PARENTHESE, TELEPHONE_FR} from "../shared/contacts.mjs";

/* Les primitives de normalisation sont communes à toutes les sources et
   vivent dans `shared/contacts.mjs`. Elles restent réexportées ici : les
   tests de ce module les appellent par son nom, et c'est bien lui qui décide
   ce qu'on fait d'un numéro une fois normalisé. */
export {telephoneE164};

const URL_TEXTE = /https?:\/\/[^\s<>"'`)\]}]+/g;
const COURRIEL_TEXTE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9.\-]*[A-Za-z0-9])?\.[A-Za-z]{2,}/g;

/* --------------------------------------------------------------------------
   LIRE `registration[]`

   Deux formes circulent selon l'agenda : des objets `{type, value}` et, sur
   des fiches plus anciennes, de simples chaînes. Quand le type manque, la
   valeur elle-même le dit — une adresse contient un « @ », un lien commence
   par « http », un numéro se normalise.
   ------------------------------------------------------------------------ */
function entreeRegistration(item) {
  if (item == null) return null;
  if (typeof item === "string" || typeof item === "number") {
    return {type: null, valeur: String(item).trim()};
  }
  if (typeof item !== "object") return null;
  const type = String(item.type ?? item.kind ?? item.name ?? "").trim().toLowerCase() || null;
  const valeur = texteBrut(item.value ?? item.data ?? item.url ?? item.link ?? item.contact ?? item.text ?? "").trim();
  return valeur ? {type, valeur} : null;
}

function typeDeduit(valeur) {
  if (/^mailto:/i.test(valeur) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valeur)) return "email";
  if (/^https?:\/\//i.test(valeur)) return "link";
  if (/^tel:/i.test(valeur)) return "phone";
  return telephoneE164(valeur) ? "phone" : null;
}

function lireRegistration(event) {
  const sortie = {booking_url: null, phone: null, email: null};
  const brut = event?.registration ?? event?.registrations ?? event?.inscription;
  const entrees = (Array.isArray(brut) ? brut : [brut]).map(entreeRegistration).filter(Boolean);
  for (const {type, valeur} of entrees) {
    const genre = type && ["link", "url", "website", "web", "phone", "tel", "telephone", "email", "mail", "e-mail"].includes(type)
      ? type : typeDeduit(valeur);
    if (!genre) continue;
    if (!sortie.booking_url && ["link", "url", "website", "web"].includes(genre)) {
      sortie.booking_url = urlPropre(valeur);
    } else if (!sortie.phone && ["phone", "tel", "telephone"].includes(genre)) {
      sortie.phone = telephoneE164(valeur.replace(/^tel:/i, ""));
    } else if (!sortie.email && ["email", "mail", "e-mail"].includes(genre)) {
      sortie.email = courrielPropre(valeur);
    }
  }
  return sortie;
}

/* Le site déclaré par l'organisateur, quand l'agenda le porte séparément. */
function siteDeclare(event) {
  const candidats = [event?.website, event?.officialWebsite, event?.siteWeb, event?.homepage];
  const liens = Array.isArray(event?.links) ? event.links : [];
  for (const candidat of [...candidats, ...liens]) {
    const url = urlPropre(candidat);
    if (url) return url;
  }
  return null;
}

/* --------------------------------------------------------------------------
   LE REPÊCHAGE DANS LE TEXTE
   ------------------------------------------------------------------------ */
export function coordonneesDansTexte(texte, {exclure = []} = {}) {
  const source = texteBrut(texte);
  const interdites = new Set(exclure.filter(Boolean).map((valeur) => String(valeur).replace(/\/+$/, "")));
  const url = (source.match(URL_TEXTE) || [])
    .map(urlPropre)
    .find((valeur) => valeur && !interdites.has(valeur.replace(/\/+$/, "")) && !/openagenda\.com/i.test(valeur)) || null;
  const email = (source.match(COURRIEL_TEXTE) || []).map(courrielPropre).find(Boolean) || null;
  const phone = (source.replace(INDICATIF_PARENTHESE, " ").match(TELEPHONE_FR) || [])
    .map(telephoneE164).find(Boolean) || null;
  return {url, email, phone};
}

/* --------------------------------------------------------------------------
   LE POINT D'ENTRÉE

   `sourceUrl` n'est pas modifié ici : il reste ce que `normalize.mjs` a
   calculé. Il est seulement passé pour qu'un lien du texte pointant vers la
   fiche OpenAgenda elle-même ne soit pas présenté comme « le site ».
   ------------------------------------------------------------------------ */
export function contactsOpenAgenda(event, {sourceUrl = null, textes = []} = {}) {
  const structure = lireRegistration(event);
  const site = siteDeclare(event);
  const manque = !structure.booking_url && !structure.phone && !structure.email && !site;

  let repeche = {url: null, email: null, phone: null};
  if (manque || !structure.phone || !structure.email) {
    for (const texte of textes) {
      const trouve = coordonneesDansTexte(texte, {exclure: [sourceUrl]});
      repeche = {
        url: repeche.url || trouve.url,
        email: repeche.email || trouve.email,
        phone: repeche.phone || trouve.phone,
      };
    }
  }

  return {
    booking_url: structure.booking_url,
    phone: structure.phone || repeche.phone,
    email: structure.email || repeche.email,
    /* Le lien repêché atterrit ici, et jamais dans `booking_url` : voir la
       première décision en tête de fichier. */
    website: site || (structure.booking_url ? null : repeche.url),
  };
}
