(function (root) {
  "use strict";

  /* ---- Coordination d'événement ------------------------------------------
     Autour n'a pas de messagerie. Il a des canaux d'événement : un créateur
     qui annonce, des participants qui reçoivent. Rien ne s'ouvre entre deux
     personnes qui ne partagent pas un événement, et la section Messages
     n'existe pas pour qui n'a aucun événement en cours.

     Ce module ne contient que des décisions et des libellés — pas d'accès
     réseau — pour rester vérifiable. */

  /* La section Messages n'apparaît que s'il y a une raison. Un canal dont
     l'événement est passé ou annulé cesse d'en être une : la boîte se vide
     d'elle-même au lieu de devenir un historique. */
  function canauxActifs(canaux, now) {
    const instant = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    const T = root.AutourTemps;
    return (canaux || []).filter((canal) => {
      if (!canal) return false;
      // un événement annulé reste consultable un temps : c'est justement
      // l'annonce que les participants doivent voir
      const valeurFin = canal.fin_le || canal.end_at || canal.endAt || canal.finLe;
      const fin = valeurFin == null ? null : T && T.toEpochInZone
        ? T.toEpochInZone(valeurFin, canal.timezone || canal.timeZone)
        : new Date(valeurFin).getTime();
      if (fin != null && Number.isFinite(fin) && fin < instant - 24 * 3600000) return false;
      return true;
    });
  }

  function sectionMessagesVisible(canaux, now) {
    return canauxActifs(canaux, now).length > 0;
  }

  /* Nombre d'annonces non lues, tous canaux actifs confondus. */
  function nonLus(canaux, now) {
    return canauxActifs(canaux, now)
      .reduce((total, canal) => total + (Number(canal.non_lus) || 0), 0);
  }

  const ETIQUETTES_CHANGEMENT = Object.freeze({
    horaire: "Horaire modifié",
    lieu: "Nouveau lieu",
    retard: "Retard annoncé",
    places: "Places",
    annulation: "Événement annulé",
  });

  /* Un message système porte son type : l'affichage le rend visuellement
     distinct d'une annonce libre, au lieu de tout aplatir en texte. */
  function decrireMessage(message) {
    const m = message || {};
    const systeme = m.genre === "systeme";
    return {
      systeme,
      etiquette: systeme ? (ETIQUETTES_CHANGEMENT[m.changement] || "Mise à jour") : "Annonce",
      corps: String(m.corps || "").trim(),
      changement: m.changement || null,
      urgent: m.changement === "annulation" || m.changement === "retard",
      cree_le: m.cree_le || null,
    };
  }

  /* Les six actions du créateur, dans l'ordre où elles servent réellement.
     `champs` décrit ce qui change dans l'événement ; le message système est
     produit par la base à partir de ce changement, jamais écrit ici. */
  const ACTIONS_CREATEUR = Object.freeze([
    Object.freeze({id: "horaire", label: "Changer l’heure", champ: "debut_le"}),
    Object.freeze({id: "lieu", label: "Changer le lieu", champ: "adresse"}),
    Object.freeze({id: "retard", label: "Annoncer un retard", annonce: true}),
    Object.freeze({id: "places", label: "Limiter les places", champ: "places"}),
    Object.freeze({id: "annonce", label: "Envoyer une annonce", annonce: true}),
    Object.freeze({id: "annulation", label: "Annuler l’événement", champ: "status", danger: true}),
  ]);

  function actionsPour(canal, moi) {
    // seul l'administrateur du canal dispose de ces actions
    if (!canal || !moi || canal.admin !== moi || canal.ferme) return [];
    return ACTIONS_CREATEUR.slice();
  }

  /* Texte d'un retard : on annonce des minutes, pas une heure absolue —
     c'est ce que le créateur connaît au moment où il le tape. */
  function texteRetard(minutes) {
    const valeur = Math.round(Number(minutes));
    if (!Number.isFinite(valeur) || valeur <= 0) return null;
    return "Retard annoncé : environ " + valeur + " min.";
  }

  /* ---- Partage / invitation ----------------------------------------------
     Le partage natif quand il existe, sinon des cibles explicites. Aucune
     n'ouvre de compte ni ne demande d'autorisation. */
  function ciblesPartage(url, texte) {
    const lien = String(url || "");
    const message = String(texte || "").trim();
    const complet = message ? message + " " + lien : lien;
    return [
      {id: "lien", label: "Copier le lien", href: null, valeur: lien},
      {id: "sms", label: "SMS", href: "sms:?&body=" + encodeURIComponent(complet)},
      {id: "whatsapp", label: "WhatsApp", href: "https://wa.me/?text=" + encodeURIComponent(complet)},
      {id: "telegram", label: "Telegram",
       href: "https://t.me/share/url?url=" + encodeURIComponent(lien) +
             "&text=" + encodeURIComponent(message)},
      {id: "facebook", label: "Facebook",
       href: "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(lien)},
      {id: "email", label: "E-mail",
       href: "mailto:?subject=" + encodeURIComponent(message || "Autour") +
             "&body=" + encodeURIComponent(complet)},
    ];
  }

  function texteInvitation(evenement) {
    const e = evenement || {};
    const bouts = [e.titre || e.title].filter(Boolean);
    if (e.adresse) bouts.push(e.adresse);
    if (e.quand) bouts.push(e.quand);
    return bouts.join(" · ");
  }

  root.AutourEvents = Object.freeze({
    ETIQUETTES_CHANGEMENT,
    ACTIONS_CREATEUR,
    canauxActifs,
    sectionMessagesVisible,
    nonLus,
    decrireMessage,
    actionsPour,
    texteRetard,
    ciblesPartage,
    texteInvitation,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
