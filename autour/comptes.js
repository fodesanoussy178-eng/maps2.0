(function (root) {
  "use strict";

  /* ===================================================================
     Le compte arrive quand il sert, et pas avant

     LE PROBLÈME QU'ON NE VEUT PAS AVOIR

     Un écran de connexion à l'ouverture est un péage. Quelqu'un qui cherche
     une distribution alimentaire ce soir, ou un endroit où dormir, n'a pas à
     donner une adresse e-mail avant de savoir si Autour lui sert à quelque
     chose. Aide, Explorer, la recherche, la carte, une publication qu'on
     ouvre depuis un lien : tout cela marche sans rien donner, et l'urgence
     plus que le reste.

     CE QU'UN COMPTE APPORTE VRAIMENT

     Autour signait ses visiteurs en anonyme. C'était discret, mais une
     session anonyme vit dans le stockage d'un navigateur : vider son cache ou
     changer de téléphone, et ses propres publications devenaient celles d'un
     inconnu — plus personne ne pouvait les modifier, pas même leur auteur.

     Un compte sert donc exactement à ce qui doit SURVIVRE à l'appareil :
     publier, retrouver ses publications, les modifier, les supprimer, garder
     ses favoris, être prévenu. Rien d'autre. Cette liste est écrite ici une
     fois, et l'interface la lit — elle ne la redevine pas écran par écran.

     CE QUE CE FICHIER NE FAIT PAS

     Il ne protège rien. La protection est en base : `created_by = auth.uid()`
     et des policies RLS qui refusent tout le reste. Ce module décide QUAND
     demander, et avec quels mots ; si quelqu'un le contourne, il obtient un
     refus du serveur, pas un accès.
     =================================================================== */

  /* ===================================================================
     1. CE QU'ON PEUT FAIRE SANS COMPTE, ET CE QUI EN DEMANDE UN
     =================================================================== */
  const LIBRE = Object.freeze([
    "ouvrir",           // lancer Autour
    "explorer",         // la carte, les catégories, les créneaux
    "voir",             // un lieu, un événement
    "rechercher",
    "aide",             // le champ libre d'Aide
    "urgence",          // et l'urgence AVANT tout le reste
    "consulter",        // une publication ouverte depuis un lien
    "itineraire",
  ]);

  const AVEC_COMPTE = Object.freeze([
    "publier",
    "favori",
    "notifications",
    "mes-publications",
    "modifier",
    "supprimer",
  ]);

  function exigeCompte(action) {
    return AVEC_COMPTE.indexOf(String(action || "")) >= 0;
  }

  /* ===================================================================
     2. LES MOTS DE CHAQUE DEMANDE

     Une invitation à créer un compte doit dire ce que le compte APPORTE, au
     moment précis où il l'apporte. « Connectez-vous pour continuer » ne dit
     rien : c'est une porte, pas une raison.

     Le titre est une promesse, la ligne en dessous est ce qu'on obtient. Nulle
     part il n'est question de « créer un compte » : on entre une adresse, et
     c'est tout ce qu'on demande — jamais de nom, d'âge, de téléphone ni
     d'adresse postale.
     =================================================================== */
  const INVITATIONS = Object.freeze({
    publier: {
      titre: "Une dernière étape",
      texte: "Entre ton e-mail pour publier et pouvoir modifier ou supprimer " +
             "cet événement plus tard.",
      bouton: "Continuer",
    },
    favori: {
      titre: "Retrouve tes favoris partout",
      texte: "Connecte-toi avec ton e-mail.",
      bouton: "Continuer",
    },
    notifications: {
      titre: "Être prévenu",
      texte: "Entre ton e-mail pour recevoir les annonces des événements que " +
             "tu suis.",
      bouton: "Continuer",
    },
    "mes-publications": {
      titre: "Retrouve ce que tu as publié",
      texte: "Entre ton e-mail pour récupérer tes publications, ici ou sur un " +
             "autre téléphone.",
      bouton: "Continuer",
    },
    modifier: {
      titre: "Une dernière étape",
      texte: "Entre ton e-mail pour modifier cet événement.",
      bouton: "Continuer",
    },
    supprimer: {
      titre: "Une dernière étape",
      texte: "Entre ton e-mail pour supprimer cet événement.",
      bouton: "Continuer",
    },
    compte: {
      titre: "Ton compte",
      texte: "Une adresse e-mail suffit. Elle reste privée et n’apparaît nulle " +
             "part sur Autour.",
      bouton: "Continuer",
    },
  });

  function invitation(action) {
    return INVITATIONS[action] || INVITATIONS.compte;
  }

  /* ===================================================================
     3. L'ÉTAT DE LA SESSION

     Trois états, pas deux. « Anonyme » est celui d'Autour avant cette
     passe : une session existe, elle porte un uid, et pourtant ce n'est pas
     un compte — elle ne survit pas à l'appareil, et la base lui refuse
     désormais toute écriture. Confondre « a une session » et « a un compte »
     est exactement l'erreur qui laissait croire à quelqu'un que sa
     publication lui appartenait.
     =================================================================== */
  const VISITEUR = "visiteur";
  const ANONYME  = "anonyme";
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

  /* L'adresse affichée nulle part ailleurs : sur son propre écran de profil,
     et seulement là. Une adresse ne devient jamais un pseudo par défaut —
     « marie.dupont@… » afficherait un nom de famille au monde entier. */
  function nomAffiche(profil) {
    const pseudo = profil && typeof profil.display_name === "string"
      ? profil.display_name.trim() : "";
    return pseudo || "Habitant du quartier";
  }

  /* ===================================================================
     4. L'ADRESSE E-MAIL

     Validée juste assez pour éviter une faute de frappe évidente. Une
     validation stricte refuse des adresses valides et n'apporte rien : c'est
     l'envoi du lien qui tranche.
     =================================================================== */
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

  /* ===================================================================
     5. LES MESSAGES D'ERREUR

     Le message brut d'un service d'authentification est écrit pour un
     développeur : « For security purposes, you can only request this after
     23 seconds ». On traduit, et on ne montre jamais l'original — il peut
     contenir l'adresse, et il dit parfois si un compte existe.
     =================================================================== */
  function messageErreur(erreur) {
    const brut = String((erreur && (erreur.message || erreur.msg)) || erreur || "");
    if (/rate|too many|after \d+ second/i.test(brut)) {
      return "Trop de tentatives. Réessaie dans une minute.";
    }
    if (/invalid|expired|token/i.test(brut)) {
      return "Ce code n’est plus valable. Demande-en un nouveau.";
    }
    if (/network|fetch|timeout/i.test(brut)) {
      return "Connexion impossible. Vérifie ton réseau.";
    }
    if (/email/i.test(brut)) return "Cette adresse n’a pas été acceptée.";
    return "Connexion impossible pour le moment.";
  }

  /* ===================================================================
     6. L'ACTION MISE EN ATTENTE

     Après une connexion, on reprend ce qui était commencé. Renvoyer quelqu'un
     à l'accueil lui fait recommencer un formulaire qu'il venait de remplir —
     et c'est le meilleur moyen de lui faire abandonner.

     L'attente est écrite dans `sessionStorage` parce que le lien magique fait
     QUITTER la page : au retour, le JavaScript est rechargé de zéro et une
     variable n'aurait pas survécu. `sessionStorage` meurt avec l'onglet, ce
     qui est exactement la durée de vie voulue.

     `charge` ne contient jamais rien de sensible : un identifiant de
     publication, une clé de favori. Le brouillon en cours reste en mémoire.
     =================================================================== */
  const CLE_ATTENTE = "autour:action-en-attente";
  const DELAI_ATTENTE_MS = 30 * 60 * 1000;   // au-delà, l'intention a changé

  function memoire() {
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage) return sessionStorage;
    } catch (e) { /* Safari en navigation privée : on continue sans */ }
    return null;
  }

  function mettreEnAttente(action, charge) {
    if (!action) return null;
    const attente = { action: String(action), charge: charge || null, le: Date.now() };
    const m = memoire();
    if (m) {
      try { m.setItem(CLE_ATTENTE, JSON.stringify(attente)); } catch (e) {}
    }
    return attente;
  }

  function attenteEnCours() {
    const m = memoire();
    if (!m) return null;
    let brut;
    try { brut = m.getItem(CLE_ATTENTE); } catch (e) { return null; }
    if (!brut) return null;
    let attente;
    try { attente = JSON.parse(brut); } catch (e) { oublierAttente(); return null; }
    if (!attente || !attente.action) { oublierAttente(); return null; }
    if (!(Number(attente.le) > Date.now() - DELAI_ATTENTE_MS)) {
      oublierAttente();
      return null;
    }
    return attente;
  }

  /* Se consomme une fois. Reprendre deux fois la même action publierait deux
     fois le même événement. */
  function reprendreAttente() {
    const attente = attenteEnCours();
    oublierAttente();
    return attente;
  }

  function oublierAttente() {
    const m = memoire();
    if (m) { try { m.removeItem(CLE_ATTENTE); } catch (e) {} }
  }

  /* ===================================================================
     7. QUELLE MANŒUVRE D'AUTHENTIFICATION

     Deux chemins, et le choix n'est pas cosmétique :

       · une session ANONYME existe déjà → on lui RATTACHE l'adresse
         (`updateUser`). L'uid ne change pas, donc les publications et les
         favoris déjà posés sous cet uid restent ceux de la personne. C'est
         toute la migration : rien n'est réécrit, rien n'est transféré.

       · aucune session → on ouvre une session par e-mail (`signInWithOtp`).

     Le type de vérification suit le chemin choisi, et se tromper de type fait
     échouer la vérification avec un message incompréhensible.
     =================================================================== */
  function manoeuvre(etat) {
    return etat === ANONYME
      ? { methode: "lier", typeOtp: "email_change" }
      : { methode: "ouvrir", typeOtp: "email" };
  }

  root.AutourComptes = Object.freeze({
    LIBRE, AVEC_COMPTE, INVITATIONS,
    VISITEUR, ANONYME, CONNECTE,
    CLE_ATTENTE, DELAI_ATTENTE_MS,
    exigeCompte, invitation, etatDe, peut, nomAffiche,
    normaliserEmail, emailValide, codeValide, messageErreur,
    mettreEnAttente, attenteEnCours, reprendreAttente, oublierAttente,
    manoeuvre,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
