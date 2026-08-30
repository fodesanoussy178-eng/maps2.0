/* LE RÉSOLVEUR D'IMAGE. UN SEUL, POUR TOUT AUTOUR.

   Avant ce fichier, une photo pouvait arriver de quatre endroits qui ne se
   parlaient pas : `providers/googlePlaces.js` posait `photos[0]`,
   `api/datatourisme.js` posait `image` + `imageSource`, `versEvenement`
   étiquetait TOUTE image d'événement « datatourisme_licence » — y compris
   celles d'OpenAgenda — et `versLieu` recopiait `image_url` sans provenance.
   Quatre chemins, quatre vocabulaires, aucune règle commune sur les droits.

   Ici il n'y en a plus qu'un. Il répond à une seule question :

       « Quelle photo représente CE lieu, et de quel droit l'affiche-t-on ? »

   CE QU'IL RÉPOND

   Toujours la même forme — c'est le contrat demandé, et il ne varie pas selon
   la source qui a gagné :

       image_url          l'image à afficher, jamais rehébergée
       image_source       d'où elle vient (`openagenda`, `wikimedia_commons`…)
       image_source_url   la page où on peut vérifier
       image_author       qui l'a prise
       image_license      sous quelle licence on l'affiche
       image_updated_at   quand Autour a établi ce visuel

   L'ORDRE DES SOURCES, ET POURQUOI

     1. la source existante — une affiche officielle d'événement, une photo
        déposée par la structure : personne ne connaît le lieu mieux qu'elle ;
     2. les tags OSM `image`, `wikimedia_commons`, `wikidata` — portés PAR
        l'objet, donc rattachés à cet objet et à aucun autre ;
     3. Wikimedia/Wikidata, atteint depuis ces tags — licence lisible, auteur
        nommé, page source vérifiable ;
     4. une photo publiée dans Autour par quelqu'un du quartier ;
     5. Google Places, en dernier recours, affiché selon ses règles ;
     6. rien — et la tuile teintée reste, ce qui est une réponse honnête.

   TROIS RÈGLES QUI NE SE NÉGOCIENT PAS

   · UNE PHOTO REPRÉSENTE CE LIEU-CI. Aucune recherche par nom, aucune photo
     de catégorie, aucune vue de la ville. Un identifiant Wikidata n'est suivi
     que s'il est écrit sur l'objet lui-même — `brand:wikidata` désigne
     l'enseigne, `operator:wikidata` l'exploitant, `subject:wikidata` le sujet
     d'une statue : aucun des trois n'est le lieu, et tous sont refusés.

   · AUCUNE IMAGE GÉNÉRÉE. Un lieu réel n'est jamais illustré par une image de
     modèle. Autour n'en demande à personne, et refuse celles qui se déclarent
     comme telles dans leurs métadonnées.

   · RIEN N'EST RECOPIÉ. On référence des URL, on n'en télécharge aucune, on
     n'en réhéberge aucune. Un droit d'usage flou ne devient pas clair parce
     qu'on aurait copié le fichier.

   CE FICHIER NE DESSINE RIEN. Il rend des données ; le rendu existant s'en
   sert tel quel, aux mêmes emplacements, avec le même repli. Allumer les
   photos ne déplace pas un pixel — c'était déjà l'acquis de `docs/vignettes.md`,
   et ça le reste. */
(function (racine) {
  "use strict";

  /* ==================================================================== */
  /*  Vocabulaire                                                         */
  /* ==================================================================== */

  /* Les provenances possibles, dans l'ordre de préférence. `image_source` ne
     prend jamais une autre valeur : c'est ce qui rend la provenance lisible
     par les tests, par les écrans, et par la personne qui débogue. */
  const SOURCES = Object.freeze([
    "openagenda",          // affiche officielle d'un événement
    "datatourisme",        // catalogue public, licence ouverte explicite
    "structure",           // déposée par la structure qui tient le lieu
    "autour",              // publiée dans Autour par quelqu'un du quartier
    "site_officiel",       // tag OSM `image` pointant le site du lieu lui-même
    "wikimedia_commons",   // Commons, atteint par tag ou par Wikidata
    "artist_official",     // visuel officiel lié explicitement à l'artiste
    "organizer_official",  // visuel officiel lié explicitement à l'organisateur
    "venue_official",      // visuel officiel lié explicitement au lieu
    "institutional",       // source institutionnelle déclarée
    "google_places",       // repli, affiché selon les règles Google
  ]);

  /* Ce qui vient d'ailleurs que du lieu lui-même : une affiche d'événement ne
     doit jamais être remplacée par une photo du bâtiment, et une photo de
     bâtiment ne doit jamais se faire passer pour l'affiche. */
  const PORTEES = Object.freeze({LIEU: "lieu", EVENEMENT: "evenement"});

  /* Une image d'événement n'est pas une image de lieu. Ce vocabulaire reste
     côté rendu tant que la base ne porte pas de colonne `image_type` : on ne
     crée pas de migration pour déduire après coup une information que la
     source n'a pas fournie. */
  const TYPES_EVENEMENT = Object.freeze([
    "event_poster", "artist", "organizer", "venue", "institutional", "fallback",
  ]);
  const TYPES_LIEU = Object.freeze(["place_photo", "institutional", "wikimedia", "fallback"]);

  /* Fallbacks graphiques Autour. Ils sont volontairement déterminés par la
     catégorie canonique, jamais par le titre : une image de concert ne doit
     pas apparaître parce qu'un mot ressemble à un autre événement. */
  const FALLBACKS_EVENEMENT = Object.freeze({
    concert: {key: "concert", emoji: "🎤", label: "Concert"},
    cinema: {key: "cinema", emoji: "🎬", label: "Cinéma"},
    manga: {key: "manga", emoji: "🎯", label: "Manga / anime"},
    exposition: {key: "exposition", emoji: "🖼", label: "Exposition"},
    sport: {key: "sport", emoji: "⚽", label: "Sport"},
    theatre: {key: "theatre", emoji: "🎭", label: "Théâtre"},
    festival: {key: "festival", emoji: "🎪", label: "Festival"},
    food: {key: "food", emoji: "🍜", label: "Food"},
    nightlife: {key: "nightlife", emoji: "🌙", label: "Vie nocturne"},
    event: {key: "event", emoji: "✨", label: "Événement"},
  });

  /* Une image Commons se sert en miniature : la version d'origine d'une photo
     de façade pèse régulièrement plusieurs mégaoctets, et une carte de 74 px
     de haut n'en a aucun usage. 800 px couvre l'écran le plus dense sans
     jamais approcher le poids de l'original. */
  const LARGEUR_VIGNETTE = 800;

  /* ==================================================================== */
  /*  Ce qu'on accepte d'afficher                                         */
  /* ==================================================================== */

  /* Les licences sous lesquelles Autour affiche une image sans rien demander
     à personne. La liste est volontairement courte et explicite : « pas de
     licence indiquée » n'y figure pas, et ne doit jamais y figurer. */
  const LICENCES_LIBRES =
    /(^|[^a-z])(cc0|cc[ -]?by([ -]?sa)?([ -]?\d(\.\d)?)?|public[ -]domain|pd[ -](old|us|art)|domaine[ -]public|etalab|odbl|open[ -]data)([^a-z]|$)/i;

  /* Ce qui n'est PAS libre, même si le texte contient par ailleurs « cc ».
     `fair use` et `non-free` sont les étiquettes que Commons emploie pour les
     fichiers qu'on n'a pas le droit de réutiliser hors de Wikipédia. */
  const LICENCES_REFUSEES = /(fair[ -]use|non[ -]free|nc[ -]nd|by[ -]nc|tous droits|all rights reserved|copyright(ed)?\b(?![ -]free))/i;

  /* UNE IMAGE DE MODÈLE N'EST PAS UNE PHOTO DU LIEU.

     Commons accepte les images générées à condition qu'elles se déclarent :
     c'est cette déclaration qu'on lit. Les hébergeurs de génération sont
     refusés au niveau de l'URL, avant même de regarder les métadonnées. */
  const MARQUES_IA =
    /\b(ai[ -]generated|generated by ai|ai[ -]art|midjourney|stable[ -]diffusion|dall[ -]?e|imagen|firefly|generative[ -]ai|image generee par (une )?ia|ia generative)\b/i;
  const HOTES_IA =
    /(^|\.)(openai|oaidalleapi[a-z0-9]*|midjourney|cdn\.midjourney|stability|replicate|leonardo\.ai|civitai)\.(com|ai|io|net|org)$/i;

  /* ==================================================================== */
  /*  Outils sans effet de bord                                           */
  /* ==================================================================== */

  function texte(valeur) {
    return valeur == null ? "" : String(valeur);
  }

  /* Commons rend l'auteur en HTML — un lien, parfois deux, parfois une phrase
     entière. On n'affiche jamais ce HTML : on en extrait le texte. */
  function texteBrut(valeur) {
    return texte(valeur)
      .replace(/<[^>]*>/g, " ")
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function hote(url) {
    const m = /^https?:\/\/([^/?#]+)/i.exec(texte(url));
    return m ? m[1].toLowerCase().replace(/^www\./, "") : "";
  }

  /* LA VALIDATION QUI ATTRAPE LE BUG OPENAGENDA.

     `https://img.openagenda.com/main/` a été servi pendant des semaines : le
     connecteur lisait le champ `base` de l'objet image et s'arrêtait là, sans
     jamais y coller le `filename`. Le résultat est une URL de RÉPERTOIRE —
     elle se termine par une barre oblique, elle ne nomme aucun fichier — et
     OpenAgenda répond 400.

     La construction correcte est faite en amont (`sync-openagenda/image.mjs`,
     et la migration qui répare les lignes déjà écrites). Ce qui suit est la
     garde du dernier mètre : quelle que soit la source, une URL qui ne nomme
     pas un fichier n'est pas une image, et n'entre pas dans une carte. */
  function urlImageValide(url) {
    const u = texte(url).trim();
    if (!/^https:\/\//i.test(u)) return false;         // jamais de http nu, jamais de data:
    if (HOTES_IA.test(hote(u))) return false;
    return cheminNommeUnFichier(u);
  }

  /* LA MÊME RÈGLE, DITE DANS TROIS LANGAGES.

     Elle vit ici pour le navigateur, dans `sync-openagenda/image.mjs` pour le
     connecteur, et dans `public.image_url_nomme_un_fichier` pour la base. Les
     trois se prononcent sur les mêmes cas, et un test les compare ligne à
     ligne — c'est ce qui les empêche de diverger.

     Ce qu'elle dit : une URL d'image nomme une RESSOURCE. Le chemin de
     `https://img.openagenda.com/main/` se termine sur rien du tout — c'est un
     répertoire, et c'est la signature exacte du bug.

     Le mot d'arborescence seul (`/main`, `/thumbnails`) est refusé lui aussi,
     mais seulement quand rien d'autre ne désigne une ressource : ni extension,
     ni paramètres. Sans cette nuance, l'URL photo de Google Places — qui se
     termine par `/media?key=…` — serait rejetée à tort. */
  function cheminNommeUnFichier(url) {
    const u = texte(url).trim();
    const chemin = u.replace(/^https?:\/\/[^/]+/i, "").split(/[?#]/)[0];
    const dernier = chemin.split("/").filter(Boolean).pop() || "";
    if (!dernier) return false;
    const nommeUneRessource = /\.[a-z0-9]{2,5}$/i.test(dernier) || u.indexOf("?") >= 0;
    return nommeUneRessource || !/^(main|media|images?|photos?|thumb|thumbnails?)$/i.test(dernier);
  }

  function licenceLibre(licence) {
    const l = texteBrut(licence);
    if (!l) return false;
    if (LICENCES_REFUSEES.test(l)) return false;
    return LICENCES_LIBRES.test(l);
  }

  function sentIA(...valeurs) {
    /* « générée » et « generee » désignent la même chose : on compare sans
       accents, sinon la déclaration en français passait à travers. */
    const dit = texteBrut(valeurs.filter(Boolean).join(" "))
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return MARQUES_IA.test(dit);
  }

  /* ==================================================================== */
  /*  Le contrat rendu                                                    */
  /* ==================================================================== */

  /* Le seul constructeur d'un visuel. Tout ce qui sort d'ici a été validé :
     une URL qui nomme un fichier, une source connue, et — quand la source
     l'exige — une licence lisible. Ce qui ne passe pas rend `null`, et `null`
     veut dire « garde le placeholder », jamais « affiche quand même ». */
  function visuel(entree) {
    const e = entree || {};
    const url = texte(e.image_url || e.url).trim();
    const source = texte(e.image_source || e.source).trim();
    if (!urlImageValide(url)) return null;
    if (SOURCES.indexOf(source) < 0) return null;

    const auteur = texteBrut(e.image_author != null ? e.image_author : e.author);
    const licence = texteBrut(e.image_license != null ? e.image_license : e.license);
    const pageSource = texte(e.image_source_url || e.sourceUrl).trim();

    /* Une image de modèle ne représente pas un lieu réel. On regarde tout ce
       qu'on sait d'elle — auteur, licence, description, URL. */
    if (sentIA(auteur, licence, e.description, url)) return null;

    /* Wikimedia n'entre que sous licence libre EXPLICITE. Sans licence
       lisible, le droit d'usage n'est pas clair, et le placeholder reste. */
    if (source === "wikimedia_commons" && !licenceLibre(licence)) return null;

    return {
      image_url: url,
      image_type: texte(e.image_type || e.imageType) ||
        (e.image_scope === PORTEES.EVENEMENT ? "event_poster" : "place_photo"),
      image_source: source,
      image_source_url: pageSource || "",
      image_author: auteur || "",
      image_license: licence || "",
      image_updated_at: texte(e.image_updated_at || e.updatedAt) || new Date().toISOString(),
      image_confidence: texte(e.image_confidence || e.imageConfidence) ||
        (source === "autour" ? "medium" : "high"),
      image_width: Number.isFinite(Number(e.image_width || e.width)) ? Number(e.image_width || e.width) : null,
      image_height: Number.isFinite(Number(e.image_height || e.height)) ? Number(e.image_height || e.height) : null,
      image_fallback_reason: texte(e.image_fallback_reason || e.fallbackReason) || null,
      image_scope: e.image_scope === PORTEES.EVENEMENT ? PORTEES.EVENEMENT : PORTEES.LIEU,
    };
  }

  /* QUI DOIT VOIR SON CRÉDIT À CÔTÉ DE LA PHOTO ?

     Google impose l'attribution à côté de l'image, et les licences CC-BY /
     CC-BY-SA aussi. CC0, le domaine public, une photo déposée par la
     structure elle-même : rien à afficher.

     C'est ce qui décide si une vignette peut entrer dans une ligne de
     résultat de 46 px — qui ne porte pas d'attribution lisible — ou si elle
     reste réservée à la carte et à la fiche, qui ont un `figcaption`. La
     règle existait déjà, écrite en dur pour Google seul ; elle est maintenant
     dite une fois, pour toutes les sources. */
  function creditObligatoire(v) {
    if (!v) return false;
    if (v.image_source === "google_places") return true;
    const l = texteBrut(v.image_license);
    if (/cc0|public[ -]domain|domaine[ -]public|pd[ -]/i.test(l)) return false;
    /* `imageAttribution` est la forme que le rendu connaît déjà : un lieu qui
       la porte a un crédit à afficher, quel que soit le champ qui l'a écrit. */
    const auteur = texteBrut(v.image_author) || auteurDepuisAttribution(v.imageAttribution);
    return /cc[ -]?by/i.test(l) || !!auteur;
  }

  /* ==================================================================== */
  /*  1. La source existante                                              */
  /* ==================================================================== */

  /* L'AFFICHE OFFICIELLE PASSE AVANT LE BÂTIMENT.

     Un concert au Grand Mix a une affiche ; le Grand Mix a une façade. Les
     deux sont vraies, une seule dit ce qui se passe ce soir. Quand l'objet
     porte déjà une image de sa propre source, elle gagne — et rien de ce qui
     suit n'est même demandé. */
  function depuisSourceExistante(l) {
    if (!l) return null;
    /* Déjà résolu dans cette session : on ne rejoue pas la chaîne. */
    if (l.image_url && l.image_source) return visuel({...l,
      image_scope: estEvenement(l) ? PORTEES.EVENEMENT : PORTEES.LIEU,
    });

    const url = texte(l.image || l.image_url);
    if (!url) return null;
    const source = normaliserAncienneSource(l);
    if (!source) return null;
    /* GOOGLE N'EST PAS UNE « SOURCE EXISTANTE ».

       `providers/versInterne` pose la photo Places dans `image` dès que la
       fiche arrive : la traiter comme un acquis la placerait au rang 1 et
       aucune photo Commons ne serait jamais demandée pour un lieu que Google
       connaît aussi. Elle redescend donc à sa place — le dernier recours — et
       `depuisGoogle` sait la retrouver là où elle est déjà posée. */
    if (source === "google_places") return null;
    return visuel({
      image_url: url,
      image_source: source,
      image_source_url: texte(l.image_source_url || l.url),
      image_author: l.image_author || auteurDepuisAttribution(l.imageAttribution),
      image_license: texte(l.image_license || licenceImplicite(source)),
      image_updated_at: l.image_updated_at || l.majLe || null,
      image_scope: estEvenement(l) ? PORTEES.EVENEMENT : PORTEES.LIEU,
    });
  }

  /* Les étiquettes historiques, ramenées au vocabulaire unique. `versEvenement`
     posait « datatourisme_licence » sur TOUTE image d'événement, y compris les
     affiches OpenAgenda : c'est la provenance qu'on répare ici, en regardant
     d'où l'objet vient réellement plutôt que ce qu'il prétend. */
  function normaliserAncienneSource(l) {
    const declaree = texte(l.imageSource || l.image_source);
    if (SOURCES.indexOf(declaree) >= 0) return declaree;
    if (declaree === "datatourisme_licence") return "datatourisme";
    if (declaree === "autour_verifie") return "structure";
    /* Les deux étiquettes existaient avant le vocabulaire commun. Elles sont
       des alias de provenance, pas de nouvelles sources acceptées. */
    if (declaree === "venue_official") return "site_officiel";
    if (declaree === "organizer_official") return "structure";
    const h = hote(l.image || l.image_url);
    if (/openagenda\.com$/.test(h)) return "openagenda";
    if (/wikimedia\.org$/.test(h) || /wikipedia\.org$/.test(h)) return "wikimedia_commons";
    if (/googleapis\.com$/.test(h)) return "google_places";
    if (/supabase\.(co|in)$/.test(h)) return l.verifie ? "structure" : "autour";
    const provenance = texte(l.source || (l.sources || [])[0]);
    if (provenance === "openagenda" || provenance === "datatourisme") return provenance;
    if (provenance === "venue_official") return "site_officiel";
    if (provenance === "organizer_official") return "structure";
    if (provenance === "autour") return l.verifie ? "structure" : "autour";
    return "";
  }

  function typeImageEvenement(source, declare) {
    if (TYPES_EVENEMENT.indexOf(texte(declare)) >= 0 && texte(declare) !== "fallback") {
      return texte(declare);
    }
    if (source === "structure") return "organizer";
    if (source === "site_officiel") return "venue";
    if (source === "artist_official") return "artist";
    if (source === "organizer_official") return "organizer";
    if (source === "venue_official") return "venue";
    if (source === "institutional") return "institutional";
    if (source === "datatourisme") return "institutional";
    if (source === "wikimedia_commons") return "institutional";
    return "event_poster";
  }

  /* Entrée dédiée aux événements : elle ne consulte aucune recherche, ne
     remonte pas les photos Google Places et exige une provenance déclarée.
     Le résolveur de lieux conserve son comportement historique séparément. */
  function visuelEvenement(entree) {
    const e = entree || {};
    const declaree = texte(e.image_source || e.imageSource).trim();
    if (declaree === "google_places") return null;
    const source = SOURCES.indexOf(declaree) >= 0
      ? declaree
      : normaliserAncienneSource({image_source: declaree, image: e.image_url || e.image,
        source: e.source || e.primary_source});
    if (!source || source === "google_places") return null;
    const v = visuel({...e, image_source: source, image_scope: PORTEES.EVENEMENT});
    if (!v) return null;
    return {
      ...v,
      image_type: typeImageEvenement(source, e.image_type || e.imageType),
      image_confidence: texte(e.image_confidence || e.imageConfidence) ||
        (source === "autour" ? "medium" : "high"),
      image_width: Number.isFinite(Number(e.image_width || e.width)) ? Number(e.image_width || e.width) : null,
      image_height: Number.isFinite(Number(e.image_height || e.height)) ? Number(e.image_height || e.height) : null,
      image_fallback_reason: texte(e.image_fallback_reason || e.fallbackReason) || null,
    };
  }

  /* Les médias d'un événement sont cherchés dans sa propre source. Une photo
     de salle n'est admissible qu'à travers un champ de fallback explicite ;
     le simple fait qu'un événement partage un lieu ne suffit pas. */
  function depuisMediaEvenement(l) {
    if (!l) return null;
    const declaredSource = texte(l.image_source || l.imageSource).trim();
    const declaredType = texte(l.image_type || l.imageType).trim();
    const sourcePublieeCommeMediaEvenement = ["openagenda", "datatourisme", "structure",
      "artist_official", "organizer_official", "institutional"].includes(declaredSource) ||
      (declaredSource === "venue_official" && declaredType === "event_poster");
    const mediaEvenementExplicite = l.image_scope !== PORTEES.LIEU &&
      l.image_scope !== "place" && !!(l.event_image_url || l.eventImageUrl || l.event_image_source ||
        l.eventImageSource || l.image_scope === PORTEES.EVENEMENT || sourcePublieeCommeMediaEvenement);
    const direct = visuelEvenement({
      image_url: l.event_image_url || l.eventImageUrl ||
        (mediaEvenementExplicite ? (l.image_url || l.image) : ""),
      image_source: l.event_image_source || l.eventImageSource ||
        (mediaEvenementExplicite ? (l.image_source || l.imageSource) : ""),
      image_source_url: l.event_image_source_url || l.eventImageSourceUrl || l.image_source_url,
      image_author: l.event_image_author || l.eventImageAuthor || l.image_author,
      image_license: l.event_image_license || l.eventImageLicense || l.image_license,
      image_type: l.event_image_type || l.eventImageType || l.image_type,
      image_width: l.event_image_width || l.eventImageWidth || l.image_width,
      image_height: l.event_image_height || l.eventImageHeight || l.image_height,
      image_scope: PORTEES.EVENEMENT,
      source: l.event_source || l.primary_source || l.source,
    });
    if (direct) return direct;

    const candidates = [l.event_media, l.eventMedia, l.official_event_media,
      l.officialEventMedia].flatMap((value) => Array.isArray(value) ? value : [value])
      .filter(Boolean);
    for (const candidate of candidates) {
      const v = visuelEvenement({...candidate, image_scope: PORTEES.EVENEMENT,
        image_source: candidate.image_source || candidate.source});
      if (v) return v;
    }

    const venueUrl = l.venue_image_url || l.venueImageUrl || l.place_image_url || l.placeImageUrl;
    if (!venueUrl) return null;
    const venue = visuelEvenement({
      image_url: venueUrl,
      image_source: l.venue_image_source || l.venueImageSource || l.place_image_source || l.placeImageSource,
      image_source_url: l.venue_image_source_url || l.venueImageSourceUrl || l.place_image_source_url,
      image_author: l.venue_image_author || l.venueImageAuthor,
      image_license: l.venue_image_license || l.venueImageLicense,
      image_type: "venue",
      image_width: l.venue_image_width || l.venueImageWidth,
      image_height: l.venue_image_height || l.venueImageHeight,
      image_scope: PORTEES.EVENEMENT,
    });
    return venue ? {...venue, image_fallback_reason: "venue_fallback", image_confidence: "medium"} : null;
  }

  function fallbackEvenement(categorie) {
    const cat = texte(categorie).toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (/manga|anime/.test(cat)) return FALLBACKS_EVENEMENT.manga;
    if (/concert|musique|rap|artiste/.test(cat)) return FALLBACKS_EVENEMENT.concert;
    if (/cinema|film|projection/.test(cat)) return FALLBACKS_EVENEMENT.cinema;
    if (/exposition|expo|musee|galerie/.test(cat)) return FALLBACKS_EVENEMENT.exposition;
    if (/football|sport|match|tournoi/.test(cat)) return FALLBACKS_EVENEMENT.sport;
    if (/theatre|spectacle|danse|opera/.test(cat)) return FALLBACKS_EVENEMENT.theatre;
    if (/festival/.test(cat)) return FALLBACKS_EVENEMENT.festival;
    if (/food|gastronomie|resto|restaurant/.test(cat)) return FALLBACKS_EVENEMENT.food;
    if (/nocturne|nightlife|club|bar/.test(cat)) return FALLBACKS_EVENEMENT.nightlife;
    return FALLBACKS_EVENEMENT.event;
  }

  /* Classe de présentation pure : elle est partagée par le rendu et les
     tests. Une petite image ne devient jamais un grand fond flou. */
  /* UNE AFFICHE N'EST PAS UNE PHOTO, ET SON RATIO NE DIT PAS QUOI EN FAIRE.

     La forme seule décidait : tout ce qui dépasse 1.35 partait en `cover`,
     donc recadré. Sur une photo de salle c'est le bon choix ; sur une affiche
     paysage, cela coupe le titre, la date ou le nom du lieu — c'est-à-dire
     l'information elle-même. Le type déclaré tranche donc avant le ratio, et
     la forme continue d'être posée pour que le cadre garde sa hauteur. */
  function ratioImage(width, height, type) {
    const affiche = String(type || "") === "event_poster" ? " event-couverture-affiche" : "";
    const w = Number(width), h = Number(height);
    if (!(w > 0) || !(h > 0)) return "event-couverture-inconnue" + affiche;
    const ratio = w / h;
    const forme = ratio >= 1.35 ? "paysage" : ratio <= 0.75 ? "portrait" : "carre";
    /* Une seule dimension courte ne suffit pas à signaler un upscale visible :
       une affiche 500×1200 est affichée en réduction dans son cadre portrait.
       On réserve donc l'état « basse » aux sources dont les deux dimensions
       sont inférieures au seuil de rendu. */
    return "event-couverture-" + forme + (w < 600 && h < 600 ? " event-couverture-basse" : "") + affiche;
  }

  /* Le ratio décrit la géométrie ; le type et la provenance décrivent la
     manière de la montrer. Une affiche ne peut pas être recadrée comme une
     photo de façade, même lorsqu'elle est plus large que haute. */
  function modeImage(media) {
    const m = media || {};
    const type = texte(m.image_type || m.imageType);
    const scope = texte(m.image_scope || m.imageScope);
    const eventScope = scope === PORTEES.EVENEMENT || scope === "event";
    const fit = eventScope || type === "event_poster"
      ? "contain" : "cover";
    const width = Number(m.image_width || m.width), height = Number(m.image_height || m.height);
    return {
      object_fit: fit,
      low_resolution: width > 0 && height > 0 && width < 600 && height < 600,
      can_upscale: !(width > 0 && height > 0 && width < 600 && height < 600),
    };
  }

  /* Ce qu'on peut affirmer sans le lire : une affiche déposée par l'organisme
     qui organise l'événement est publiée par lui pour être vue. On ne lui
     invente pas une licence Creative Commons — on dit d'où elle vient. */
  function licenceImplicite(source) {
    if (source === "openagenda") return "affiche fournie par l’organisateur";
    if (source === "datatourisme") return "licence ouverte (catalogue DATAtourisme)";
    if (source === "structure") return "fournie par la structure";
    if (source === "autour") return "publiée dans Autour";
    if (source === "site_officiel") return "site officiel du lieu";
    if (source === "google_places") return "Google Places (attribution requise)";
    return "";
  }

  function auteurDepuisAttribution(brut) {
    if (!brut) return "";
    if (typeof brut === "string") return brut;
    const liste = Array.isArray(brut) ? brut : [brut];
    return liste.map((a) => texteBrut(a && a.name)).filter(Boolean).join(", ");
  }

  function estEvenement(l) {
    return !!(l && (l.entity_type === "event" || l.entityType === "event" ||
      l.isTemporary === true || l.temporaire === true || l.eventCanonical ||
      l.image_scope === PORTEES.EVENEMENT));
  }

  /* ==================================================================== */
  /*  2. Les tags OSM                                                     */
  /* ==================================================================== */

  /* CE QUI DÉSIGNE LE LIEU, ET CE QUI DÉSIGNE AUTRE CHOSE.

     `wikidata` est l'objet. `brand:wikidata` est l'enseigne — le suivre
     donnerait le logo de la chaîne pour la boulangerie du coin.
     `operator:wikidata` est l'exploitant, `subject:wikidata` le personnage
     représenté par une statue, `architect:wikidata` l'architecte. Aucun n'est
     le lieu. Ils sont refusés explicitement, parce que c'est exactement la
     façon dont une photo « de la bonne catégorie » finit sur la mauvaise
     fiche. */
  const TAGS_INTERDITS = Object.freeze([
    "brand:wikidata", "operator:wikidata", "subject:wikidata",
    "architect:wikidata", "artist:wikidata", "network:wikidata",
    "brand:wikipedia", "operator:wikipedia",
  ]);

  function tagsDuLieu(l) {
    const t = (l && l.tags) || {};
    return t && typeof t === "object" ? t : {};
  }

  function depuisTagsOsm(l) {
    const t = tagsDuLieu(l);
    const commons = texte(t.wikimedia_commons).trim();
    const wikidata = texte(t.wikidata).trim();
    return {
      /* `image=*` est une URL libre : elle n'est retenue que si on peut dire
         de qui elle est (voir `imageOsmAutorisee`). */
      image: texte(t.image).trim(),
      commons: /^(File|Fichier|Category|Catégorie):/i.test(commons) ? commons : "",
      wikidata: /^Q\d+$/.test(wikidata) ? wikidata : "",
    };
  }

  /* Le tag `image` d'OpenStreetMap pointe n'importe où. Deux cas seulement
     sont clairs, et on s'y tient :

       · Wikimedia — la licence est lisible, on repasse par Commons ;
       · le site officiel du lieu — l'exploitant publie sa propre photo de son
         propre établissement ; c'est le seul cas où « pas de licence écrite »
         ne veut pas dire « droit inconnu ».

     Tout le reste est l'image de quelqu'un d'autre sur le serveur de
     quelqu'un d'autre : on ne l'affiche pas, et on ne la copie surtout pas. */
  function imageOsmAutorisee(l) {
    const t = tagsDuLieu(l);
    const url = texte(t.image).trim();
    if (!urlImageValide(url)) return null;
    const h = hote(url);
    if (/wikimedia\.org$/.test(h) || /wikipedia\.org$/.test(h)) return {commons: fichierCommonsDepuisUrl(url)};
    const officiels = [t.website, t["contact:website"], l && l.url]
      .map((u) => hote(u)).filter(Boolean);
    if (officiels.indexOf(h) < 0) return null;
    return {
      visuel: visuel({
        image_url: url,
        image_source: "site_officiel",
        image_source_url: texte(t.website || t["contact:website"] || (l && l.url)),
        image_author: texte(l && (l.titre || l.title)),
        image_license: licenceImplicite("site_officiel"),
      }),
    };
  }

  function fichierCommonsDepuisUrl(url) {
    const m = /\/(?:commons\/)?(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i.exec(texte(url))
      || /Special:FilePath\/([^/?#]+)/i.exec(texte(url))
      || /\/wiki\/(?:File|Fichier):([^/?#]+)/i.exec(texte(url));
    return m ? "File:" + decodeURIComponent(m[1]) : "";
  }

  /* ==================================================================== */
  /*  3. Wikimedia Commons et Wikidata                                    */
  /* ==================================================================== */

  const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
  const WIKIDATA_API = "https://www.wikidata.org/w/api.php";

  function urlApiCommons(titre) {
    return COMMONS_API + "?action=query&format=json&origin=*&formatversion=2" +
      "&prop=imageinfo&iiprop=url%7Cextmetadata%7Ctimestamp&iiextmetadatafilter=" +
      encodeURIComponent("Artist|LicenseShortName|License|Credit|ImageDescription|Categories|DateTime") +
      "&iiurlwidth=" + LARGEUR_VIGNETTE +
      "&titles=" + encodeURIComponent(titre);
  }

  function urlApiCommonsCategorie(categorie) {
    /* Une catégorie n'est pas une image : on demande ses membres de type
       fichier, et on ne prend que le premier — un choix stable, pas un choix
       « au hasard » qui changerait la photo d'une visite à l'autre. */
    return COMMONS_API + "?action=query&format=json&origin=*&formatversion=2" +
      "&list=categorymembers&cmtype=file&cmsort=sortkey&cmlimit=8&cmtitle=" +
      encodeURIComponent(categorie);
  }

  function urlApiWikidata(qid) {
    return WIKIDATA_API + "?action=wbgetclaims&format=json&origin=*&property=P18&entity=" +
      encodeURIComponent(qid);
  }

  function pageCommons(titre) {
    return "https://commons.wikimedia.org/wiki/" + encodeURIComponent(texte(titre).replace(/ /g, "_"));
  }

  /* Lire une réponse Commons. C'est une fonction PURE : elle ne demande rien,
     elle interprète. Les tests s'en servent sans réseau, et c'est ce qui rend
     la règle de licence éprouvable. */
  function lireCommons(charge, titre) {
    const pages = charge && charge.query && charge.query.pages;
    const page = Array.isArray(pages) ? pages[0]
      : (pages && typeof pages === "object" ? Object.values(pages)[0] : null);
    const info = page && Array.isArray(page.imageinfo) ? page.imageinfo[0] : null;
    if (!info) return null;
    const meta = info.extmetadata || {};
    const champ = (nom) => texteBrut(meta[nom] && meta[nom].value);
    /* `thumburl` est la miniature demandée ; `url` est l'original, qui peut
       peser plusieurs mégaoctets. On préfère toujours la miniature. */
    return visuel({
      image_url: texte(info.thumburl || info.url),
      image_source: "wikimedia_commons",
      image_source_url: texte(info.descriptionurl) || pageCommons(titre || (page && page.title)),
      image_author: champ("Artist") || champ("Credit"),
      image_license: champ("LicenseShortName") || champ("License"),
      image_updated_at: texte(info.timestamp) || null,
      description: [champ("ImageDescription"), champ("Categories"), champ("Credit")].join(" "),
    });
  }

  function lireCategorieCommons(charge) {
    const membres = charge && charge.query && charge.query.categorymembers;
    if (!Array.isArray(membres)) return "";
    const fichier = membres.map((m) => texte(m && m.title))
      .find((titre) => /^(File|Fichier):/i.test(titre) && /\.(jpe?g|png|webp)$/i.test(titre));
    return fichier || "";
  }

  function lireWikidata(charge) {
    const revendications = charge && charge.claims && charge.claims.P18;
    if (!Array.isArray(revendications) || !revendications.length) return "";
    const valeur = revendications[0] && revendications[0].mainsnak
      && revendications[0].mainsnak.datavalue && revendications[0].mainsnak.datavalue.value;
    const nom = texte(valeur).trim();
    return nom ? "File:" + nom : "";
  }

  /* ==================================================================== */
  /*  4 et 5. Photo Autour, puis Google en dernier                        */
  /* ==================================================================== */

  function depuisPhotoAutour(l) {
    if (!l) return null;
    const photo = (Array.isArray(l.photosAutour) ? l.photosAutour : [])
      .find((p) => p && urlImageValide(p.url));
    if (!photo) return null;
    return visuel({
      image_url: photo.url,
      image_source: photo.verifie ? "structure" : "autour",
      image_source_url: texte(photo.pageUrl || l.url),
      image_author: texte(photo.auteur || l.creatorName || l.par),
      image_license: licenceImplicite(photo.verifie ? "structure" : "autour"),
      image_updated_at: photo.depuis || null,
    });
  }

  /* GOOGLE EST UN REPLI, PAS UNE BIBLIOTHÈQUE.

     Trois propriétés le maintiennent à sa place, et elles sont vérifiées :

       · il n'est consulté que si tout le reste a échoué ;
       · son crédit est obligatoire — `creditObligatoire` le dit, et les
         emplacements sans place pour un crédit ne l'affichent pas ;
       · rien n'en est conservé. `estContenuGoogle` écarte déjà ces fiches du
         jeu rapide ; `persistable()` refuse en plus le visuel lui-même, pour
         qu'une photo Places ne se glisse pas dans le cache par un lieu qui,
         lui, serait conservable. */
  function depuisGoogle(l) {
    if (!l) return null;
    const photos = (Array.isArray(l.photosGoogle) ? l.photosGoogle : []).slice();
    /* La fiche Places pose déjà sa photo dans `image` : on la lit là plutôt
       que de redemander la fiche pour rien. */
    if (normaliserAncienneSource(l) === "google_places" && texte(l.image)) {
      photos.push({url: texte(l.image), attribution: l.imageAttribution});
    }
    const photo = photos.find((p) => p && urlImageValide(p.url));
    if (!photo) return null;
    return visuel({
      image_url: photo.url,
      image_source: "google_places",
      image_source_url: l.idGoogle ? "https://www.google.com/maps/place/?q=place_id:" + encodeURIComponent(l.idGoogle) : "",
      image_author: auteurDepuisAttribution(photo.attribution),
      image_license: licenceImplicite("google_places"),
    });
  }

  function persistable(v) {
    return !!v && v.image_source !== "google_places";
  }

  /* ==================================================================== */
  /*  L'enchaînement                                                      */
  /* ==================================================================== */

  const MAX_CANDIDATS = 8;      // par vague : on n'illustre que ce qu'on montre
  const MAX_SIMULTANEES = 3;    // au-delà, le navigateur sérialise de toute façon
  const DELAI_MS = 8000;        // rien n'attend ceci : mieux vaut couper court
  const memoire = new Map();    // clé de lieu → visuel | null
  const enVol = new Map();      // clé de lieu → promesse en cours
  let sorties = 0;

  function cle(l) {
    if (!l) return "";
    const prefixe = estEvenement(l) ? "event:" : "place:";
    if (l.autourId) return prefixe + String(l.autourId);
    if (l.id) return prefixe + String(l.id);
    const nom = texte(l.titre || l.title).toLowerCase();
    const y = Number(l.lat), x = Number(l.lng);
    if (!nom || !Number.isFinite(y) || !Number.isFinite(x)) return "";
    return prefixe + nom + "@" + y.toFixed(4) + "," + x.toFixed(4);
  }

  async function json(url, options) {
    const o = options || {};
    const chercher = o.fetch || racine.fetch;
    if (typeof chercher !== "function") return null;
    try {
      const r = await chercher(url, {
        signal: o.signal || (typeof AbortSignal !== "undefined" && AbortSignal.timeout
          ? AbortSignal.timeout(o.delai || DELAI_MS) : undefined),
        headers: {accept: "application/json"},
      });
      if (!r || !r.ok) return null;
      return await r.json();
    } catch (e) { return null; }
  }

  /* Commons, de bout en bout : un titre de fichier, une miniature, une page
     source, un auteur, une licence. Une catégorie passe d'abord par ses
     membres — une catégorie n'est pas une image. */
  async function resoudreCommons(titre, options) {
    let fichier = texte(titre).trim();
    if (!fichier) return null;
    if (/^(Category|Catégorie):/i.test(fichier)) {
      fichier = lireCategorieCommons(await json(urlApiCommonsCategorie(fichier), options));
      if (!fichier) return null;
    }
    return lireCommons(await json(urlApiCommons(fichier), options), fichier);
  }

  async function resoudreWikidata(qid, options) {
    const fichier = lireWikidata(await json(urlApiWikidata(qid), options));
    return fichier ? resoudreCommons(fichier, options) : null;
  }

  /* Chaîne événementielle : seules les images attachées à l'événement ou
     explicitement fournies comme fallback de sa salle sont admissibles. */
  async function resoudreEvenement(lieu, options) {
    const o = options || {};
    const k = cle(lieu);
    if (k && memoire.has(k)) return memoire.get(k);
    if (k && enVol.has(k)) return enVol.get(k);

    const travail = (async () => depuisMediaEvenement(lieu))();

    if (k) enVol.set(k, travail);
    try {
      const v = await travail;
      if (k) memoire.set(k, v);
      return v;
    } finally { if (k) enVol.delete(k); }
  }

  /* Chaîne lieu permanent : références portées par le lieu, Commons, Autour,
     puis Google. Ce chemin ne peut jamais être utilisé par un événement. */
  async function resoudreLieu(lieu, options) {
    const o = options || {};
    const k = cle(lieu);
    if (k && memoire.has(k)) return memoire.get(k);
    if (k && enVol.has(k)) return enVol.get(k);

    const travail = (async () => {
      const existante = depuisSourceExistante(lieu);
      /* Une photo Autour est le rang 4 : si le lieu porte aussi un média
         officiel exploitable dans ses tags, laisser l'ancienne photo gagner
         ici inverserait l'ordre de priorité. Elle sera reprise après les
         sources institutionnelles et Commons. */
      if (existante && existante.image_source !== "autour") return existante;

      /* 2. et 3. les tags OSM, puis ce qu'ils désignent chez Wikimedia */
      const tags = depuisTagsOsm(lieu);
      const osmImage = imageOsmAutorisee(lieu);
      if (osmImage && osmImage.visuel) return osmImage.visuel;
      const candidatsCommons = [];
      if (osmImage && osmImage.commons) candidatsCommons.push(osmImage.commons);
      if (tags.commons) candidatsCommons.push(tags.commons);
      for (const titre of candidatsCommons) {
        const v = await resoudreCommons(titre, o);
        if (v) return v;
      }
      if (tags.wikidata) {
        const v = await resoudreWikidata(tags.wikidata, o);
        if (v) return v;
      }

      /* 4. une photo publiée dans Autour */
      const autour = depuisPhotoAutour(lieu);
      if (autour) return autour;

      /* 5. Google, et seulement maintenant */
      if (o.google !== false) {
        const g = depuisGoogle(lieu);
        if (g) return g;
      }

      /* 6. rien. Le placeholder reste, et c'est une réponse. */
      return null;
    })();

    if (k) enVol.set(k, travail);
    try {
      const v = await travail;
      if (k) memoire.set(k, v);
      return v;
    } finally { if (k) enVol.delete(k); }
  }

  function resoudre(lieu, options) {
    return estEvenement(lieu) ? resoudreEvenement(lieu, options) : resoudreLieu(lieu, options);
  }

  /* Une vague : au plus `MAX_CANDIDATS` lieux, au plus `MAX_SIMULTANEES`
     appels en vol. `redessiner` est appelé à chaque visuel trouvé — jamais
     avec un rendu bloquant derrière : l'appelant décide quand repeindre. */
  async function resoudreLot(lieux, options) {
    const o = options || {};
    const liste = (Array.isArray(lieux) ? lieux : []).slice(0, o.max || MAX_CANDIDATS);
    const file = liste.slice();
    const trouves = [];
    async function ouvrier() {
      for (;;) {
        const l = file.shift();
        if (!l) return;
        if (sorties >= MAX_SIMULTANEES) { file.unshift(l); return; }
        sorties += 1;
        try {
          const v = await resoudre(l, o);
          if (v) {
            trouves.push({lieu: l, visuel: v});
            if (appliquer(l, v) && typeof o.redessiner === "function") o.redessiner();
          }
        } finally { sorties -= 1; }
      }
    }
    await Promise.all(Array.from({length: Math.min(MAX_SIMULTANEES, file.length)}, ouvrier));
    return trouves;
  }

  /* ==================================================================== */
  /*  Poser le visuel sur un lieu                                         */
  /* ==================================================================== */

  /* AUCUN CHANGEMENT DE DESSIN.

     Le rendu existant lit `image`, `imageSource` et `imageAttribution`. On
     continue de les écrire, exactement dans la forme qu'il attend, et on
     ajoute à côté les six champs du contrat. Une carte dessinée avant ce
     fichier et une carte dessinée après ont le même HTML — l'une a une photo,
     l'autre a sa tuile teintée. */
  function appliquer(lieu, v) {
    if (!lieu || !v) return false;
    /* L'AFFICHE OFFICIELLE NE SE FAIT PAS REMPLACER PAR LE BÂTIMENT.

       La garde ne se déclenche que si l'affiche est DÉJÀ là : un événement qui
       n'en a pas peut très bien recevoir la photo de la salle en attendant —
       c'est mieux qu'une tuile vide — et la vraie affiche la remplacera dès
       qu'elle arrivera, puisqu'elle sera de portée « evenement ». */
    if (lieu.image && lieu.image_scope === PORTEES.EVENEMENT
        && v.image_scope !== PORTEES.EVENEMENT) return false;
    /* Une fiche événement canonique ne prend jamais une image de lieu à la
       faveur d'une fusion. Le seul repli autorisé est celui que le résolveur
       a marqué `venue_fallback`. */
    if (estEvenement(lieu) && lieu.entity_type === "event" &&
        v.image_scope !== PORTEES.EVENEMENT && v.image_fallback_reason !== "venue_fallback") return false;
    if (lieu.image === v.image_url && lieu.image_source === v.image_source) return false;

    lieu.image_url = v.image_url;
    lieu.image_source = v.image_source;
    lieu.image_source_url = v.image_source_url;
    lieu.image_author = v.image_author;
    lieu.image_license = v.image_license;
    lieu.image_updated_at = v.image_updated_at;
    lieu.image_scope = v.image_scope;
    lieu.image_type = v.image_type || null;
    lieu.image_confidence = v.image_confidence || null;
    lieu.image_width = v.image_width || null;
    lieu.image_height = v.image_height || null;
    lieu.image_fallback_reason = v.image_fallback_reason || null;

    const canonique = lieu.eventCanonical || lieu.placeCanonical;
    if (canonique) Object.assign(canonique, {
      image_url: v.image_url,
      image_type: v.image_type || null,
      image_source: v.image_source,
      image_source_url: v.image_source_url || "",
      image_author: v.image_author || "",
      image_license: v.image_license || "",
      image_confidence: v.image_confidence || null,
      image_width: v.image_width || null,
      image_height: v.image_height || null,
      image_scope: canonique.entity_type === "event" ? PORTEES.EVENEMENT : PORTEES.LIEU,
    });

    lieu.image = v.image_url;
    lieu.imageSource = v.image_source;
    lieu.imageAttribution = creditObligatoire(v) && v.image_author
      ? [{name: v.image_author, url: v.image_source_url}] : null;
    return true;
  }

  function oublier() { memoire.clear(); enVol.clear(); sorties = 0; }

  racine.AutourImages = {
    SOURCES, PORTEES, LARGEUR_VIGNETTE, MAX_CANDIDATS, MAX_SIMULTANEES,
    TAGS_INTERDITS,
    /* décisions pures — éprouvables sans réseau */
    urlImageValide, licenceLibre, sentIA, visuel, creditObligatoire, persistable,
    depuisSourceExistante, normaliserAncienneSource, visuelEvenement, typeImageEvenement,
    fallbackEvenement, ratioImage, modeImage, TYPES_EVENEMENT, TYPES_LIEU,
    depuisMediaEvenement, depuisTagsOsm, imageOsmAutorisee,
    depuisPhotoAutour, depuisGoogle, fichierCommonsDepuisUrl, licenceImplicite,
    lireCommons, lireCategorieCommons, lireWikidata,
    urlApiCommons, urlApiCommonsCategorie, urlApiWikidata, pageCommons,
    /* enchaînement */
    cle, resoudre, resoudreEvenement, resoudreLieu, resoudreLot, resoudreCommons, resoudreWikidata, appliquer,
    _oublier: oublier,
    _etat: () => ({memoire: memoire.size, enVol: enVol.size, sorties}),
  };
})(typeof window !== "undefined" ? window : globalThis);
