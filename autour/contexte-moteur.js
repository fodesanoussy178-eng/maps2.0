/* LE CONTEXT ENGINE — « où, quand, jusqu'où, et pour qui ».

   CE QU'IL RÉPARE. La question « dans quel contexte sommes-nous ? » avait six
   réponses partielles, éparpillées dans `app.js` : `contexteActuel()` pour
   l'heure et le moment, `contexteSaison()` pour la saison, `instantCreneau()`
   pour l'instant de référence, `centreZoneActive()` pour le point regardé,
   `rayonDeLaZone()` pour la portée, `contexteTerritorialClassement()` pour la
   manifestation en cours. Chacune juste, aucune complète, et rien qui garantit
   qu'elles parlent du même instant — `contexteActuel()` lit `instantCreneau()`
   au moment où il s'exécute, `contexteSaison()` relit `Date.now()` au sien.
   Un rendu à cheval sur minuit ou sur un changement de créneau pouvait donc
   mélanger deux contextes dans le même écran.

   CE QU'IL FAIT. Un seul objet, gelé, calculé une fois, passé à qui en a
   besoin. Il n'INVENTE rien : chaque champ vient du module qui fait déjà
   autorité sur lui — `signaux.js` pour la saison, `temporel.js` pour les
   fenêtres, `zones-autonomes.js` pour l'identité de zone, `contexte.js` pour
   la zone active, `apprentissage.js` pour les signaux implicites. Si un module
   est absent, le champ est `null` : jamais une valeur de repli qui aurait
   l'air vraie.

   CE QU'IL NE FAIT PAS. Il ne charge rien, ne dessine rien, ne connaît ni la
   carte, ni le DOM, ni le réseau, ni aucune ville. C'est la règle qui rend
   `territoire.js`, `temporel.js` et `contexte.js` testables sans navigateur,
   et elle vaut ici aussi.

   IL NE CLASSE PAS NON PLUS. Le Context Engine dit ce qui est vrai du moment
   et du lieu ; c'est le Recommendation Engine qui en tire un ordre. Les
   mélanger, c'est se retrouver avec un contexte qui dépend du résultat qu'on
   voulait obtenir. */
(function (root) {
  "use strict";

  const FUSEAU = "Europe/Paris";

  /* Les moments de la journée. Ils vivaient dans `app.js` sous le nom
     `MOMENTS`, mêlés aux poids de catégories qui, eux, appartiennent au
     classement. Ici ne reste que la DÉCOUPE — quelle heure est quel moment —
     parce que c'est un fait, pas une préférence.

     LES BORNES SONT CELLES D'`app.js`, AU CHIFFRE PRÈS. Une découpe « plus
     propre » qui ferait commencer le matin à 5 h changerait ce que quelqu'un
     voit à 5 h du matin, sans que personne l'ait demandé. Déplacer du code
     n'est pas une occasion de déplacer un comportement. */
  const MOMENTS = Object.freeze([
    Object.freeze({ id: "matin",       nom: "ce matin",        de: 6,  a: 11 }),
    Object.freeze({ id: "midi",        nom: "ce midi",         de: 11, a: 14 }),
    Object.freeze({ id: "apres_midi",  nom: "cet après-midi",  de: 14, a: 18 }),
    Object.freeze({ id: "soir",        nom: "ce soir",         de: 18, a: 23 }),
    Object.freeze({ id: "nuit",        nom: "cette nuit",      de: 23, a: 6  }),
  ]);

  function momentDe(heure) {
    const h = Number(heure);
    if (!Number.isFinite(h)) return MOMENTS[0];
    return MOMENTS.find((m) => (m.de < m.a ? (h >= m.de && h < m.a) : (h >= m.de || h < m.a))) || MOMENTS[0];
  }

  function point(valeur) {
    if (Array.isArray(valeur) && Number.isFinite(Number(valeur[0])) && Number.isFinite(Number(valeur[1])))
      return Object.freeze([Number(valeur[0]), Number(valeur[1])]);
    if (valeur && Number.isFinite(Number(valeur.lat)) && Number.isFinite(Number(valeur.lng)))
      return Object.freeze([Number(valeur.lat), Number(valeur.lng)]);
    return null;
  }

  /* L'instant de référence. Il est passé par l'appelant quand un créneau
     décale le point de vue (« ce week-end » se juge depuis samedi matin, pas
     depuis mercredi soir) ; sinon c'est maintenant. Il est fixé UNE FOIS et
     tous les champs en dérivent : c'est ce qui garantit qu'un écran ne
     mélange pas deux instants. */
  function contexte(entrees) {
    const e = entrees || {};
    const instant = Number.isFinite(Number(e.instant)) ? Number(e.instant) : Date.now();
    const date = new Date(instant);
    const fuseau = e.fuseau || FUSEAU;

    /* UN MODULE PASSÉ EXPLICITEMENT À `null` EST UN MODULE ABSENT, pas une
       invitation à prendre celui du global. Sans cette distinction, un test
       qui vérifie « que rend le contexte quand `signaux.js` n'est pas là ? »
       lisait quand même le vrai module et ne vérifiait rien. C'est la même
       nuance que « prix inconnu » contre « gratuit » ailleurs dans ce
       programme : une absence n'est pas une valeur. */
    const fourni = (nom, defaut) =>
      Object.prototype.hasOwnProperty.call(e, nom) ? e[nom] : defaut;
    const signaux = fourni("signaux", root.AutourSignaux);
    const temps = fourni("temps", root.AutourTemps);
    const zones = fourni("zones", root.AutourZones);
    const modele = fourni("modele", root.AutourApprentissage);

    const heure = date.getHours();
    const jour = date.getDay();
    const vacances = e.vacances || null;

    /* La saison : mois, heure et vacances scolaires. Trois informations
       certaines tirées du calendrier — aucune API météo, donc aucune
       dépendance de plus et aucune prévision qui se trompe. */
    const saison = signaux && typeof signaux.contexteSaison === "function"
      ? signaux.contexteSaison(date, !!vacances) : null;
    const nuit = signaux && typeof signaux.nuit === "function" ? !!signaux.nuit(date) : null;

    const creneau = e.creneau ? String(e.creneau) : null;
    const fenetre = creneau && temps && typeof temps.fenetreSurface === "function"
      ? temps.fenetreSurface(creneau, instant, fuseau) : null;

    const zoneId = e.zone && (e.zone.id || e.zone.zone_id || e.zone.zoneId)
      ? String(e.zone.id || e.zone.zone_id || e.zone.zoneId) : null;
    const definition = zoneId && zones && typeof zones.definition === "function"
      ? zones.definition(zoneId) : null;

    const regarde = point(e.regarde) || point(e.zone && e.zone.centre) || null;
    const moi = point(e.moi) || null;

    /* LES SIGNAUX IMPLICITES, et le contrat qui les accompagne : ils sortent
       d'ici sous forme de vecteur borné, pas de liste d'admission. Le Context
       Engine ne peut donc pas être détourné pour faire entrer quelque chose
       dans un feed — il ne sait que pondérer ce qui y est déjà. */
    const perso = modele && typeof modele.vecteur === "function" ? modele.vecteur(instant) : null;
    const personnalisation = modele && typeof modele.actif === "function" ? modele.actif() : false;

    return Object.freeze({
      instant,
      fuseau,
      heure,
      jour,
      weekend: jour === 0 || jour === 6,
      nuit,
      moment: momentDe(heure),
      saison,
      vacances,
      creneau,
      fenetre: fenetre ? Object.freeze(Object.assign({}, fenetre)) : null,
      zone: Object.freeze({
        id: zoneId,
        label: definition ? definition.label : (e.zone && e.zone.label) || null,
        centre: definition ? Object.freeze([definition.lat, definition.lng]) : null,
        rayonM: Number.isFinite(Number(e.rayonM)) ? Number(e.rayonM)
          : (definition ? definition.radiusM : null),
      }),
      point: Object.freeze({ regarde, moi }),
      /* Regarder ailleurs n'est pas y être. Le classement se fait depuis ce
         qu'on regarde ; un itinéraire part d'où l'on est. Les deux voyagent,
         et c'est à l'appelant de choisir le bon — mais il ne peut plus les
         confondre faute d'en avoir un seul sous la main. */
      surPlace: !!(regarde && moi && regarde[0] === moi[0] && regarde[1] === moi[1]),
      personnalisation,
      perso: perso || Object.freeze({}),
      territorial: e.territorial || null,
      intention: e.intention || null,
    });
  }

  root.AutourContexteMoteur = Object.freeze({ MOMENTS, FUSEAU, momentDe, contexte });
})(typeof globalThis !== "undefined" ? globalThis : window);
