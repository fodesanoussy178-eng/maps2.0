/* ===========================================================================
   LE LEXIQUE SOLIDAIRE — seize termes, seize phrases, et un inconnu assumé

   CE QUE CE FICHIER EST

   La traduction des sigles en français ordinaire. « CMP — santé » ne sert à
   personne ; « consultations psychologiques gratuites, sectorisées par votre
   adresse » sert immédiatement. Entre les deux, il n'y a pas d'intelligence à
   ajouter : il y a seize phrases à écrire, et elles sont ici.

   CE QU'IL N'EST PAS

   Ce n'est pas un annuaire. Aucune adresse, aucun horaire, aucun numéro de
   téléphone local. Il décrit des TYPES de structures, pas des établissements :
   ce qui est vrai de tous les CHRS, pas de celui de la rue d'à côté. Une fiche
   réelle hérite d'ici puis est relue, établissement par établissement.

   POURQUOI CERTAINS CHAMPS SONT NULS

   `mode_acces` n'est rempli que lorsqu'il est STRUCTUREL — quand il découle de
   la nature même du dispositif et non du choix d'une équipe locale. On entre
   dans un CHRS par le 115 partout en France ; on entre dans un CCAS comme la
   commune l'a décidé. Remplir le second par analogie avec le premier ferait
   perdre un trajet à quelqu'un qui n'en a pas les moyens. Nul veut donc dire
   « à établir lors de la relecture », et c'est une information, pas un trou.

   LES RÈGLES DE SÉCURITÉ SONT DANS LES DONNÉES, PAS DANS UNE NOTE

   `adresse_publiable: false` n'est pas un commentaire : `tests/solidarite-
   lexique.test.mjs` refuse le fichier si une fiche de mise à l'abri porte une
   adresse, et la migration 20260918090000 refuse l'écriture correspondante.

   SOURCES. Chaque entrée nomme ce qui l'atteste. Les termes vérifiables par la
   voie 1 (déterministe, gratuite) portent leur identifiant FINESS ou SIRET :
   ce sont ceux qu'un contrôle automatique peut confirmer sans rien dépenser.
=========================================================================== */

export const metadata = Object.freeze({
  redige: "2026-09-18",
  perimetre: "Métropole européenne de Lille",
  regle: "Types de structures. Aucune adresse, aucun horaire, aucun numéro local.",
  relecture: "obligatoire, établissement par établissement, avant toute publication",
});

/* Les quatre valeurs fermées, recopiées ici pour que le fichier se lise seul.
   La migration porte les mêmes contraintes, et le test vérifie qu'elles ne
   divergent pas. */
export const MODES_ACCES = Object.freeze(["libre", "rendez_vous", "orientation", "telephone"]);
export const COUTS = Object.freeze(["gratuit", "participation", "payant"]);

const lexique = [
  {
    terme: "CCAS / CIAS",
    sigles: ["CCAS", "CIAS"],
    nom: "Centre communal (ou intercommunal) d'action sociale",
    sous_type: "action_sociale_generale",
    quoi_concretement:
      "Le guichet social de votre commune : aide financière d'urgence, domiciliation quand on n'a pas d'adresse, " +
      "et accompagnement pour les démarches et l'accès aux droits.",
    /* Chaque commune organise son accueil comme elle l'entend : guichet
       ouvert, rendez-vous, ou les deux selon le service demandé. */
    mode_acces: null,
    cout: "gratuit",
    anonymat: false,
    public_vise: ["habitants de la commune"],
    telephone_cle: null,
    adresse_publiable: true,
    aussi_gestionnaire: false,
    sources: ["code de l'action sociale et des familles, art. L123-4 et suivants", "data·inclusion"],
  },
  {
    terme: "FJT / MAJT",
    sigles: ["FJT", "MAJT"],
    nom: "Foyer de jeunes travailleurs",
    sous_type: "logement_jeunes",
    quoi_concretement:
      "Un logement meublé pour les jeunes qui travaillent, sont en apprentissage ou en études, avec une redevance " +
      "mensuelle et une équipe sur place. On y entre sur dossier, pas en se présentant.",
    mode_acces: "rendez_vous",
    cout: "payant",
    anonymat: false,
    public_vise: ["16-30 ans", "apprentis", "jeunes actifs", "étudiants"],
    telephone_cle: null,
    adresse_publiable: true,
    aussi_gestionnaire: false,
    /* Le sigle MAJT désigne un opérateur lillois ; son développement exact
       n'a pas été confirmé et n'est donc pas écrit ici. */
    a_confirmer: "développement du sigle MAJT, à vérifier localement",
    sources: ["FINESS catégorie 257 (foyer de jeunes travailleurs)", "UNHAJ"],
  },
  {
    terme: "Maison des adolescents",
    sigles: ["MDA"],
    nom: "Maison des adolescents",
    sous_type: "accueil_jeunes",
    quoi_concretement:
      "Un lieu gratuit où un adolescent — ou son parent — peut parler de santé, de mal-être, d'école ou de famille, " +
      "et rencontrer un psychologue, un médecin ou un éducateur sans passer par un médecin traitant.",
    mode_acces: null,
    cout: "gratuit",
    /* Les MDA annoncent le plus souvent un accueil confidentiel, mais toutes
       ne promettent pas l'anonymat. On ne promet pas à leur place. */
    anonymat: null,
    public_vise: ["11-25 ans", "parents", "familles"],
    telephone_cle: null,
    adresse_publiable: true,
    aussi_gestionnaire: false,
    sources: ["Association nationale des maisons des adolescents", "data·inclusion"],
  },
  {
    terme: "PAEJ",
    sigles: ["PAEJ"],
    nom: "Point accueil écoute jeunes",
    sous_type: "accueil_jeunes",
    quoi_concretement:
      "On y parle à un psychologue ou à un éducateur sans rendez-vous, gratuitement, et sans avoir à donner son nom. " +
      "Souvent ouvert aussi aux parents.",
    /* Le sans-rendez-vous et l'anonymat sont dans la définition même du
       dispositif : c'est ce qui le distingue d'une consultation. */
    mode_acces: "libre",
    cout: "gratuit",
    anonymat: true,
    public_vise: ["12-25 ans", "parents"],
    telephone_cle: null,
    adresse_publiable: true,
    aussi_gestionnaire: false,
    sources: ["cahier des charges national PAEJ (DGCS)", "data·inclusion"],
  },
  {
    terme: "CMP",
    sigles: ["CMP"],
    nom: "Centre médico-psychologique",
    sous_type: "sante_mentale",
    quoi_concretement:
      "Consultations psychiatriques et psychologiques du service public, prises en charge sans avance de frais. " +
      "Le CMP dont vous dépendez est celui de votre adresse : ce n'est pas au choix, et il faut appeler pour un premier rendez-vous.",
    /* La sectorisation et le premier appel sont structurels : ils valent pour
       tous les CMP, pas seulement pour ceux de la métropole. */
    mode_acces: "rendez_vous",
    cout: "gratuit",
    anonymat: false,
    public_vise: ["adultes", "enfants et adolescents selon le centre"],
    telephone_cle: null,
    adresse_publiable: true,
    aussi_gestionnaire: false,
    sources: ["FINESS catégorie 156 (centre médico-psychologique)", "sectorisation psychiatrique, code de la santé publique"],
  },
  {
    terme: "EPSM",
    sigles: ["EPSM"],
    nom: "Établissement public de santé mentale",
    sous_type: "sante_mentale",
    quoi_concretement:
      "L'hôpital public de psychiatrie du secteur. Il gère le plus souvent les CMP alentour : pour une première " +
      "consultation, c'est au CMP qu'on s'adresse, pas à l'hôpital.",
    mode_acces: "orientation",
    cout: "gratuit",
    anonymat: false,
    public_vise: ["adultes", "enfants et adolescents selon l'établissement"],
    telephone_cle: null,
    adresse_publiable: true,
    /* Il est les deux à la fois : un hôpital où l'on se rend, et l'organisme
       qui gère les CMP du secteur. La carte montre le premier ; le second ne
       sert qu'à rattacher les fiches entre elles. */
    aussi_gestionnaire: true,
    sources: ["FINESS catégorie 930 (centre hospitalier spécialisé en psychiatrie)"],
  },
  {
    terme: "Espaces écoute santé",
    sigles: [],
    nom: "Espace d'écoute psychologique de proximité",
    sous_type: "sante_mentale",
    quoi_concretement:
      "Quelques séances avec un psychologue, près de chez soi, le plus souvent organisées par la commune. " +
      "Ce qui est proposé et pour qui change d'une commune à l'autre.",
    mode_acces: null,
    cout: null,
    anonymat: null,
    public_vise: [],
    telephone_cle: null,
    adresse_publiable: true,
    aussi_gestionnaire: false,
    /* Pas de définition nationale : chaque commune nomme et organise le sien.
       Le vérifier commune par commune n'est pas une précaution, c'est la
       seule façon d'écrire quelque chose de vrai. */
    a_confirmer: "existence, nom exact et conditions, commune par commune",
    sources: ["dispositifs municipaux, sans cadre national"],
  },
  {
    terme: "CHRS",
    sigles: ["CHRS"],
    nom: "Centre d'hébergement et de réinsertion sociale",
    sous_type: "hebergement_urgence",
    quoi_concretement:
      "Hébergement et accompagnement social pour des personnes sans logement. On n'y entre pas en se présentant " +
      "à l'adresse : l'orientation passe par le 115 ou par un travailleur social.",
    mode_acces: "telephone",
    cout: "gratuit",
    anonymat: false,
    public_vise: ["adultes", "familles selon le centre"],
    /* B.6.2 — la fiche donne le 115, pas une porte. */
    telephone_cle: "115",
    adresse_publiable: true,
    aussi_gestionnaire: false,
    sources: ["FINESS catégorie 214 (CHRS)", "code de l'action sociale et des familles, art. L345-1"],
  },
  {
    terme: "CMAO",
    sigles: ["CMAO"],
    nom: "Coordination mobile d'accueil et d'orientation",
    sous_type: "hebergement_urgence",
    quoi_concretement:
      "C'est elle qui organise, dans le Nord, l'orientation des personnes sans abri vers un hébergement. " +
      "On la joint par le 115 : ce n'est pas un lieu où se rendre.",
    mode_acces: "telephone",
    cout: "gratuit",
    anonymat: false,
    public_vise: ["personnes sans abri"],
    telephone_cle: "115",
    /* Une fiche téléphonique. Publier une adresse enverrait des gens devant
       un bureau de coordination qui ne reçoit pas. */
    adresse_publiable: false,
    aussi_gestionnaire: false,
    sources: ["dispositif départemental du Nord, SIAO/115"],
  },
  {
    terme: "ABEJ Solidarité",
    sigles: ["ABEJ"],
    nom: "ABEJ Solidarité",
    sous_type: "aide_materielle",
    quoi_concretement:
      "Association lilloise pour les personnes sans abri : accueil de jour où se poser, se laver et manger, " +
      "consultations de santé, et hébergement. Plusieurs lieux, chacun avec ses propres horaires.",
    mode_acces: null,
    cout: "gratuit",
    anonymat: null,
    public_vise: ["personnes sans abri", "adultes"],
    telephone_cle: null,
    adresse_publiable: true,
    /* Elle gère plusieurs établissements : le siège n'est pas un accueil. */
    aussi_gestionnaire: true,
    sources: ["abej-solidarite.fr", "data·inclusion"],
  },
  {
    terme: "Croix-Rouge française",
    sigles: ["CRF"],
    nom: "Croix-Rouge française",
    sous_type: "aide_materielle",
    quoi_concretement:
      "Aide alimentaire, vestiboutique où l'on s'habille à petit prix, épiceries sociales et formation aux premiers " +
      "secours. Chaque unité locale décide de ce qu'elle ouvre, pour qui et quand.",
    mode_acces: null,
    cout: null,
    anonymat: false,
    public_vise: [],
    telephone_cle: null,
    adresse_publiable: true,
    aussi_gestionnaire: true,
    sources: ["croix-rouge.fr", "data·inclusion"],
  },
  {
    terme: "Les Fabuleuses",
    sigles: [],
    nom: "Les Fabuleuses",
    sous_type: "aide_materielle",
    quoi_concretement:
      "À Lille, pour les femmes en grande précarité : maraudes, vestiaire, produits d'hygiène et entretiens " +
      "individuels. Le local se visite sur rendez-vous.",
    mode_acces: "rendez_vous",
    cout: "gratuit",
    anonymat: null,
    public_vise: ["femmes", "femmes en grande précarité"],
    telephone_cle: null,
    adresse_publiable: true,
    aussi_gestionnaire: false,
    sources: ["lesfabuleuses.net"],
  },
  {
    terme: "SOLFA",
    sigles: ["SOLFA"],
    nom: "Solidarité femmes accueil",
    sous_type: "violences_femmes",
    quoi_concretement:
      "Écoute et accompagnement des femmes victimes de violences : démarches, droits, protection. " +
      "On publie la permanence d'accueil de jour et le 3919, jamais une adresse de mise à l'abri.",
    mode_acces: "telephone",
    cout: "gratuit",
    anonymat: true,
    public_vise: ["femmes victimes de violences"],
    /* B.6.1 — les adresses d'hébergement sont confidentielles. Les publier
       met des personnes en danger, et aucune amélioration de service ne
       justifie ce risque. */
    telephone_cle: "3919",
    adresse_publiable: false,
    aussi_gestionnaire: true,
    sources: ["3919 — Violences Femmes Info", "solfa-asso.fr"],
  },
  {
    terme: "Horizon 9",
    sigles: [],
    nom: "Horizon 9",
    sous_type: "accueil_jeunes",
    quoi_concretement:
      "Des éducateurs de rue qui vont à la rencontre des 12-25 ans et de leurs familles à Roubaix, Hem et Wattrelos. " +
      "On ne pousse pas une porte : ce sont eux qui viennent, et on peut les appeler.",
    mode_acces: null,
    cout: "gratuit",
    anonymat: null,
    public_vise: ["12-25 ans", "familles"],
    telephone_cle: null,
    adresse_publiable: true,
    aussi_gestionnaire: false,
    /* Vérifiable par la voie 1, sans dépenser un appel : ces deux
       identifiants s'interrogent gratuitement. */
    identifiants: { finess: "590050811", siret: "50922446500013" },
    sources: ["FINESS 590050811", "SIRENE 509 224 465 00013"],
  },
  {
    terme: "ALEFPA",
    sigles: ["ALEFPA"],
    nom: "Association laïque pour l'éducation, la formation, la prévention et l'autonomie",
    sous_type: "gestionnaire",
    quoi_concretement:
      "Une association qui gère des dizaines d'établissements sociaux et médico-sociaux. Ce n'est pas un lieu où " +
      "l'on se rend : cherchez l'établissement, pas le siège.",
    mode_acces: null,
    cout: null,
    anonymat: null,
    public_vise: [],
    telephone_cle: null,
    /* Le siège existe et a une adresse. Il n'a pas de point sur la carte :
       `sous_type = gestionnaire` n'est pas affiché (voir B.3). */
    adresse_publiable: true,
    aussi_gestionnaire: true,
    sources: ["alefpa.asso.fr", "FINESS — personne morale gestionnaire"],
  },
  {
    terme: "La Sauvegarde du Nord",
    sigles: [],
    nom: "La Sauvegarde du Nord",
    sous_type: "gestionnaire",
    quoi_concretement:
      "Une association qui gère de nombreux établissements du département : protection de l'enfance, addictions, " +
      "santé, médiation. On entre dans l'un de ses établissements, pas dans l'association.",
    mode_acces: null,
    cout: null,
    anonymat: null,
    public_vise: [],
    telephone_cle: null,
    adresse_publiable: true,
    aussi_gestionnaire: true,
    sources: ["lasauvegardedunord.fr", "FINESS — personne morale gestionnaire"],
  },
];

/* ---------------------------------------------------------------------------
   CE QUI N'A PAS ÉTÉ VÉRIFIÉ, ET QUI LE RESTE

   `ALORE` a été transmis avec les seize autres. Aucune source fiable ne l'a
   confirmé : ni FINESS, ni SIRENE, ni un site d'association. Il ne reçoit donc
   ni sous-type, ni phrase, ni mode d'accès.

   Ce n'est pas un trou dans le travail : c'est le principe 1.2 appliqué. Un
   sigle qu'on développe au jugé devient une fiche fausse, et une fiche fausse
   dans ce domaine envoie quelqu'un quelque part pour rien. Il reste ici, en
   UNKNOWN, pour que la question revienne à la personne qui a transmis la
   liste — et pour qu'on ne le « redécouvre » pas dans six mois.
--------------------------------------------------------------------------- */
export const nonVerifies = Object.freeze([
  Object.freeze({
    terme: "ALORE",
    statut: "UNKNOWN",
    raison: "aucune source fiable trouvée : ni FINESS, ni SIRENE, ni site d'association",
    action: "confirmer auprès de la personne qui a transmis la liste",
  }),
]);

export const parSousType = Object.freeze(lexique.reduce((index, entree) => {
  (index[entree.sous_type] = index[entree.sous_type] || []).push(entree.terme);
  return index;
}, {}));

export default Object.freeze(lexique.map(Object.freeze));
