(function(root) {
  "use strict";
  function canauxActifs(canaux, now) {
    const instant = Number.isFinite(Number(now)) ? Number(now) : Date.now();
    return (canaux || []).filter((canal) => {
      if (!canal) return false;
      const fin = canal.fin_le ? new Date(canal.fin_le).getTime() : null;
      if (fin != null && Number.isFinite(fin) && fin < instant - 24 * 36e5) return false;
      return true;
    });
  }
  function sectionMessagesVisible(canaux, now) {
    return canauxActifs(canaux, now).length > 0;
  }
  function nonLus(canaux, now) {
    return canauxActifs(canaux, now).reduce((total, canal) => total + (Number(canal.non_lus) || 0), 0);
  }
  const ETIQUETTES_CHANGEMENT = Object.freeze({
    horaire: "Horaire modifi\xE9",
    lieu: "Nouveau lieu",
    retard: "Retard annonc\xE9",
    places: "Places",
    annulation: "\xC9v\xE9nement annul\xE9"
  });
  function decrireMessage(message) {
    const m = message || {};
    const systeme = m.genre === "systeme";
    return {
      systeme,
      etiquette: systeme ? ETIQUETTES_CHANGEMENT[m.changement] || "Mise \xE0 jour" : "Annonce",
      corps: String(m.corps || "").trim(),
      changement: m.changement || null,
      urgent: m.changement === "annulation" || m.changement === "retard",
      cree_le: m.cree_le || null
    };
  }
  const ACTIONS_CREATEUR = Object.freeze([
    Object.freeze({ id: "horaire", label: "Changer l\u2019heure", champ: "debut_le" }),
    Object.freeze({ id: "lieu", label: "Changer le lieu", champ: "adresse" }),
    Object.freeze({ id: "retard", label: "Annoncer un retard", annonce: true }),
    Object.freeze({ id: "places", label: "Limiter les places", champ: "places" }),
    Object.freeze({ id: "annonce", label: "Envoyer une annonce", annonce: true }),
    Object.freeze({ id: "annulation", label: "Annuler l\u2019\xE9v\xE9nement", champ: "status", danger: true })
  ]);
  function actionsPour(canal, moi) {
    if (!canal || !moi || canal.admin !== moi || canal.ferme) return [];
    return ACTIONS_CREATEUR.slice();
  }
  function texteRetard(minutes) {
    const valeur = Math.round(Number(minutes));
    if (!Number.isFinite(valeur) || valeur <= 0) return null;
    return "Retard annonc\xE9 : environ " + valeur + " min.";
  }
  function ciblesPartage(url, texte) {
    const lien = String(url || "");
    const message = String(texte || "").trim();
    const complet = message ? message + " " + lien : lien;
    return [
      { id: "lien", label: "Copier le lien", href: null, valeur: lien },
      { id: "sms", label: "SMS", href: "sms:?&body=" + encodeURIComponent(complet) },
      { id: "whatsapp", label: "WhatsApp", href: "https://wa.me/?text=" + encodeURIComponent(complet) },
      {
        id: "telegram",
        label: "Telegram",
        href: "https://t.me/share/url?url=" + encodeURIComponent(lien) + "&text=" + encodeURIComponent(message)
      },
      {
        id: "facebook",
        label: "Facebook",
        href: "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(lien)
      },
      {
        id: "email",
        label: "E-mail",
        href: "mailto:?subject=" + encodeURIComponent(message || "Autour") + "&body=" + encodeURIComponent(complet)
      }
    ];
  }
  function texteInvitation(evenement) {
    const e = evenement || {};
    const bouts = [e.titre || e.title].filter(Boolean);
    if (e.adresse) bouts.push(e.adresse);
    if (e.quand) bouts.push(e.quand);
    return bouts.join(" \xB7 ");
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
    texteInvitation
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
