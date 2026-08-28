(function(root) {
  "use strict";
  const LIBRE = Object.freeze([
    "ouvrir",
    // lancer Autour
    "explorer",
    // la carte, les catégories, les créneaux
    "voir",
    // un lieu, un événement
    "rechercher",
    "aide",
    // le champ libre d'Aide
    "urgence",
    // et l'urgence AVANT tout le reste
    "consulter",
    // une publication ouverte depuis un lien
    "itineraire"
  ]);
  const AVEC_COMPTE = Object.freeze([
    "publier",
    "favori",
    "notifications",
    "mes-publications",
    "modifier",
    "supprimer"
  ]);
  function exigeCompte(action) {
    return AVEC_COMPTE.indexOf(String(action || "")) >= 0;
  }
  const INVITATIONS = Object.freeze({
    publier: {
      titre: "Une derni\xE8re \xE9tape",
      texte: "Entre ton e-mail pour publier et pouvoir modifier ou supprimer cet \xE9v\xE9nement plus tard.",
      bouton: "Continuer"
    },
    favori: {
      titre: "Retrouve tes favoris partout",
      texte: "Connecte-toi avec ton e-mail.",
      bouton: "Continuer"
    },
    notifications: {
      titre: "\xCAtre pr\xE9venu",
      texte: "Entre ton e-mail pour recevoir les annonces des \xE9v\xE9nements que tu suis.",
      bouton: "Continuer"
    },
    "mes-publications": {
      titre: "Retrouve ce que tu as publi\xE9",
      texte: "Entre ton e-mail pour r\xE9cup\xE9rer tes publications, ici ou sur un autre t\xE9l\xE9phone.",
      bouton: "Continuer"
    },
    modifier: {
      titre: "Une derni\xE8re \xE9tape",
      texte: "Entre ton e-mail pour modifier cet \xE9v\xE9nement.",
      bouton: "Continuer"
    },
    supprimer: {
      titre: "Une derni\xE8re \xE9tape",
      texte: "Entre ton e-mail pour supprimer cet \xE9v\xE9nement.",
      bouton: "Continuer"
    },
    compte: {
      titre: "Ton compte",
      texte: "Une adresse e-mail suffit. Elle reste priv\xE9e et n\u2019appara\xEEt nulle part sur Autour.",
      bouton: "Continuer"
    }
  });
  function invitation(action) {
    return INVITATIONS[action] || INVITATIONS.compte;
  }
  const VISITEUR = "visiteur";
  const ANONYME = "anonyme";
  const CONNECTE = "connecte";
  function etatDe(session) {
    const u = session && session.user;
    if (!u) return VISITEUR;
    if (u.is_anonymous === true) return ANONYME;
    return u.email ? CONNECTE : ANONYME;
  }
  function peut(etat, action) {
    if (!exigeCompte(action)) return true;
    return etat === CONNECTE;
  }
  function nomAffiche(profil) {
    const pseudo = profil && typeof profil.display_name === "string" ? profil.display_name.trim() : "";
    return pseudo || "Habitant du quartier";
  }
  function normaliserEmail(valeur) {
    return String(valeur == null ? "" : valeur).trim().toLowerCase();
  }
  function emailValide(valeur) {
    const v = normaliserEmail(valeur);
    if (v.length < 6 || v.length > 254) return false;
    if (/\s/.test(v)) return false;
    return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(v);
  }
  function codeValide(valeur) {
    return /^\d{6}$/.test(String(valeur == null ? "" : valeur).trim());
  }
  function adresseDejaPrise(erreur) {
    const e = erreur || {};
    const code = String(e.code || e.error_code || "");
    if (/email_exists|user_already_exists|email_taken/i.test(code)) return true;
    const brut = String(e.message || e.msg || erreur || "");
    return /already (been )?(registered|in use|exists)|address already/i.test(brut);
  }
  function messageErreur(erreur) {
    const brut = String(erreur && (erreur.message || erreur.msg) || erreur || "");
    if (/rate|too many|after \d+ second/i.test(brut)) {
      return "Trop de tentatives. R\xE9essaie dans une minute.";
    }
    if (/invalid|expired|token/i.test(brut)) {
      return "Ce code n\u2019est plus valable. Demande-en un nouveau.";
    }
    if (/network|fetch|timeout/i.test(brut)) {
      return "Connexion impossible. V\xE9rifie ton r\xE9seau.";
    }
    if (/email/i.test(brut)) return "Cette adresse n\u2019a pas \xE9t\xE9 accept\xE9e.";
    return "Connexion impossible pour le moment.";
  }
  const CLE_ATTENTE = "autour:action-en-attente";
  const DELAI_ATTENTE_MS = 30 * 60 * 1e3;
  function memoire() {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage) return sessionStorage;
    } catch (e) {
    }
    return null;
  }
  function mettreEnAttente(action, charge) {
    if (!action) return null;
    const attente = { action: String(action), charge: charge || null, le: Date.now() };
    const m = memoire();
    if (m) {
      try {
        m.setItem(CLE_ATTENTE, JSON.stringify(attente));
      } catch (e) {
      }
    }
    return attente;
  }
  function attenteEnCours() {
    const m = memoire();
    if (!m) return null;
    let brut;
    try {
      brut = m.getItem(CLE_ATTENTE);
    } catch (e) {
      return null;
    }
    if (!brut) return null;
    let attente;
    try {
      attente = JSON.parse(brut);
    } catch (e) {
      oublierAttente();
      return null;
    }
    if (!attente || !attente.action) {
      oublierAttente();
      return null;
    }
    if (!(Number(attente.le) > Date.now() - DELAI_ATTENTE_MS)) {
      oublierAttente();
      return null;
    }
    return attente;
  }
  function reprendreAttente() {
    const attente = attenteEnCours();
    oublierAttente();
    return attente;
  }
  function oublierAttente() {
    const m = memoire();
    if (m) {
      try {
        m.removeItem(CLE_ATTENTE);
      } catch (e) {
      }
    }
  }
  function manoeuvre(etat) {
    return etat === ANONYME ? { methode: "lier", typeOtp: "email_change" } : { methode: "ouvrir", typeOtp: "email" };
  }
  root.AutourComptes = Object.freeze({
    LIBRE,
    AVEC_COMPTE,
    INVITATIONS,
    VISITEUR,
    ANONYME,
    CONNECTE,
    CLE_ATTENTE,
    DELAI_ATTENTE_MS,
    exigeCompte,
    invitation,
    etatDe,
    peut,
    nomAffiche,
    normaliserEmail,
    emailValide,
    codeValide,
    messageErreur,
    adresseDejaPrise,
    mettreEnAttente,
    attenteEnCours,
    reprendreAttente,
    oublierAttente,
    manoeuvre
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
