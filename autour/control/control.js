/* ---------------------------------------------------------------------------
   AGORA — le poste de pilotage

   CE QU'IL EST : huit écrans pour piloter les agents d'Autour. Vue générale,
   acquisition, territoires, validation, tâches, journal, opérateur. Rien de
   plus : le but est de décider vite, pas de faire une démonstration.

   CE QU'IL N'EST PAS : une autorité. Tout ce que cette page affiche, elle
   l'obtient de PostgREST sous l'identité de la personne connectée. Les tables
   du socle agents n'accordent aucun privilège à `anon`, et chaque policy passe
   par `public.est_operateur()`, qui exige TROIS choses : une session non
   anonyme, une ligne d'opérateur, et le code AGORA entré dans les douze
   dernières heures.

   LE CODE N'EST PAS DANS CE FICHIER, et il ne peut pas y être. Ce script
   envoie ce que la personne tape à `agora_ouvrir`, qui le compare à une
   empreinte HMAC rangée dans le schéma `private`. Il ne connaît ni le code, ni
   l'empreinte, ni le sel — et un navigateur qui télécharge ce fichier
   n'apprend rien d'autre que l'existence d'un champ de saisie.

   TROIS ÉTATS, TROIS ÉCRANS. Pas connecté → on demande une adresse. Connecté
   mais pas opérateur → on le dit et on s'arrête. Opérateur mais verrou fermé →
   on demande le code. C'est `agora_etat()` qui tranche, côté serveur.
--------------------------------------------------------------------------- */
(function () {
  "use strict";

  const SUPABASE_URL = "https://sxnzyvcgwbwnpjnqmpkp.supabase.co";
  const SUPABASE_CLE = "sb_publishable_T4_3er0DEI9vX4YdEhPDIw_m3yV_FlM";
  const PAR_PAGE = 25;

  const ecran = document.getElementById("ecran");
  const nav = document.getElementById("nav");
  let sb = null, moi = null, vue = vueDepuisURL();

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const heure = (iso) => iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
  const jour = (iso) => iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";

  function vueDepuisURL() {
    const p = location.pathname.replace(/\/+$/, "");
    for (const v of ["acquisition", "territoires", "validation", "taches", "journal", "operateur"]) {
      if (p.endsWith("/" + v)) return v;
    }
    return "tableau";
  }

  /* ===================================================================
     ENTRER
     =================================================================== */
  async function demarrer() {
    if (!window.supabase) {
      ecran.innerHTML = '<p class="vide err">Le SDK Supabase n\'a pas pu être chargé.</p>';
      return;
    }
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_CLE, {
      auth: { storageKey: "autour-control-v1" },
    });

    const { data: { session } } = await sb.auth.getSession();
    if (!session) return ecranAdresse();
    moi = session.user;

    /* L'état est demandé AU SERVEUR. Un client peut écrire ce qu'il veut dans
       son propre stockage ; il ne peut pas faire répondre « ouvert » à une
       fonction qui lit une table. */
    const { data: etat, error } = await sb.rpc("agora_etat");
    if (error) return ecranErreur(error.message);
    if (!etat.operateur) return ecranRefus();
    if (!etat.ouvert) return ecranCode();

    nav.hidden = false;
    nav.onclick = (e) => {
      const b = e.target.closest("button[data-vue]");
      if (!b) return;
      if (b.dataset.vue === "sortir") {
        return sb.rpc("agora_fermer").then(() => location.reload());
      }
      vue = b.dataset.vue;
      history.pushState({}, "", "/control" + (vue === "tableau" ? "" : "/" + vue));
      rendre();
    };
    addEventListener("popstate", () => { vue = vueDepuisURL(); rendre(); });
    rendre();
  }

  function ecranErreur(m) {
    nav.hidden = true;
    ecran.innerHTML = `<div class="connexion"><h2>AGORA</h2><p class="err">${esc(m)}</p></div>`;
  }

  function ecranAdresse() {
    nav.hidden = true;
    ecran.innerHTML = `<div class="connexion">
      <h2>AGORA</h2>
      <p>Espace privé. Entre l'adresse du compte opérateur. L'e-mail contient
         soit un code à six chiffres à recopier ici, soit un lien à ouvrir —
         les deux marchent.</p>
      <input id="mail" type="email" placeholder="adresse e-mail" autocomplete="email">
      <button class="act" id="envoyer">Recevoir le code</button>
      <p id="etat" class="meta"></p></div>`;
    const etat = document.getElementById("etat");
    document.getElementById("envoyer").onclick = async () => {
      const email = document.getElementById("mail").value.trim();
      if (!email) return;
      etat.textContent = "Envoi…";
      /* `shouldCreateUser: false` : on n'ouvre pas de compte depuis ici. Une
         adresse inconnue reçoit un refus, pas un compte neuf. */
      /* DEUX CHEMINS POUR LE MÊME JETON, PARCE QU'ON NE MAÎTRISE PAS LE
         GABARIT D'E-MAIL.

         `signInWithOtp` envoie le gabarit « Magic Link » de Supabase. S'il ne
         contient que `{{ .ConfirmationURL }}`, la personne reçoit un LIEN et
         aucun chiffre — mesuré, et l'écran promettait des chiffres qui
         n'arrivaient jamais.

         `emailRedirectTo` fait revenir ce lien sur /control, où ce client-ci
         ramasse la session tout seul (`detectSessionInUrl` est actif par
         défaut) — et c'est bien CE client qu'il faut, parce qu'il a son propre
         `storageKey` : une session ouverte sur l'application publique ne serait
         pas vue par AGORA.

         Le champ « code » reste affiché : si le gabarit porte `{{ .Token }}`,
         les six chiffres marchent aussi. On ne choisit pas à la place de la
         configuration, on accepte les deux. */
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: false,
          emailRedirectTo: location.origin + "/control",
        },
      });
      if (error) { etat.className = "err"; etat.textContent = error.message; return; }
      etat.className = "meta";
      ecran.querySelector(".connexion").insertAdjacentHTML("beforeend",
        '<input id="jeton" inputmode="numeric" placeholder="code reçu par e-mail" style="margin-top:10px">' +
        '<button class="act" id="valider">Continuer</button>');
      document.getElementById("valider").onclick = async () => {
        const token = document.getElementById("jeton").value.trim();
        const { error: e2 } = await sb.auth.verifyOtp({ email, token, type: "email" });
        if (e2) { etat.className = "err"; etat.textContent = e2.message; return; }
        location.reload();
      };
      etat.textContent = "E-mail envoyé. Recopie le code s'il y en a un, "
                       + "sinon ouvre le lien : il ramène ici, déjà connecté.";
    };
  }

  /* LE SECOND VERROU. Il est de nature différente du premier : l'adresse dit
     QUI tu es, le code dit que c'est bien toi, maintenant, devant l'écran. */
  function ecranCode() {
    nav.hidden = true;
    ecran.innerHTML = `<div class="connexion">
      <h2>AGORA</h2>
      <p>Code d'accès.</p>
      <input id="code" type="password" inputmode="text" autocomplete="off"
             autocapitalize="off" spellcheck="false" placeholder="code">
      <button class="act" id="ouvrir">Ouvrir</button>
      <p id="etat" class="meta">Le code est vérifié par le serveur. Cinq essais
         par quart d'heure.</p>
      <button class="act" id="sortir" style="margin-top:14px">Changer de compte</button></div>`;
    const etat = document.getElementById("etat");
    const champ = document.getElementById("code");
    champ.focus();

    const tenter = async () => {
      const code = champ.value;
      if (!code) return;
      etat.className = "meta"; etat.textContent = "Vérification…";
      const { data, error } = await sb.rpc("agora_ouvrir", { p_code: code });
      champ.value = "";                 // jamais laissé dans le champ
      if (error) { etat.className = "err"; etat.textContent = error.message; return; }
      if (data.ouvert) return location.reload();
      etat.className = "err";
      etat.textContent = data.raison === "trop_d_essais"
        ? "Trop d'essais. Réessaie dans un quart d'heure."
        : `Code refusé. ${data.essais_restants ?? 0} essai(s) avant blocage.`;
    };
    document.getElementById("ouvrir").onclick = tenter;
    champ.onkeydown = (e) => { if (e.key === "Enter") tenter(); };
    document.getElementById("sortir").onclick = () => sb.auth.signOut().then(() => location.reload());
  }

  function ecranRefus() {
    nav.hidden = true;
    ecran.innerHTML = `<div class="connexion"><h2>AGORA</h2>
      <p>Ce compte n'est pas opérateur. Rien n'est accessible depuis ici.</p>
      <button class="act" id="sortir">Se déconnecter</button></div>`;
    document.getElementById("sortir").onclick = () => sb.auth.signOut().then(() => location.reload());
  }

  /* ===================================================================
     RENDU
     =================================================================== */
  const VUES = {};

  function rendre() {
    nav.querySelectorAll("button[data-vue]").forEach((b) =>
      b.setAttribute("aria-current", b.dataset.vue === vue ? "page" : "false"));
    ecran.innerHTML = '<p class="vide">Chargement…</p>';
    (VUES[vue] || VUES.tableau)()
      .catch((e) => { ecran.innerHTML = `<p class="vide err">${esc(e.message || e)}</p>`; });
  }

  const compter = async (table, filtre) => {
    let q = sb.from(table).select("*", { count: "exact", head: true });
    if (filtre) q = filtre(q);
    const { count } = await q;
    return count ?? 0;
  };

  function tuile(n, libelle, precision) {
    return `<div class="tuile"><div class="n">${n}</div><div class="l">${esc(libelle)}
      ${precision ? `<small>${esc(precision)}</small>` : ""}</div></div>`;
  }

  /* Ce qui n'existe pas est écrit comme n'existant pas. Aucune statistique
     n'est inventée pour remplir une case. */
  const AGENTS_PREVUS = [
    ["Data", "collecte et fraîcheur des données"],
    ["Vérification", "cohérence entre systèmes"],
    ["Qualité", "qualité des fiches et des sources"],
    ["Recommendation", "ce qu'Autour propose à qui"],
    ["Growth", "quels canaux produisent de l'usage"],
    ["City Rollout", "quand une ville a assez de contenu"],
    ["Dev", "maintenance technique"],
  ];

  /* --- 1. VUE GÉNÉRALE ---------------------------------------------- */
  VUES.tableau = async function () {
    const [{ data: agents }, enCours, aValider, decouvertes, qualifiees,
           avecCanal, contacts, partenaires, erreurs] = await Promise.all([
      sb.from("agents").select("slug,nom,mission,actif"),
      compter("tasks", (q) => q.in("statut", ["file", "en_cours"])),
      compter("acquisition_contacts", (q) => q.eq("statut", "attente_validation")),
      compter("acquisition_opportunites"),
      compter("acquisition_opportunites", (q) => q.eq("statut", "qualifiee")),
      compter("acquisition_canaux", (q) => q.eq("statut", "trouve")),
      compter("acquisition_contacts"),
      compter("acquisition_opportunites", (q) => q.eq("statut", "partenaire")),
      compter("tasks", (q) => q.eq("statut", "echouee")),
    ]);

    /* LE COÛT EST UNE SOMME D'APPELS RÉELLEMENT FACTURÉS. Tant qu'aucun modèle
       n'est appelé il vaut zéro, et la précision le dit — plutôt qu'un zéro
       qu'on lirait comme « pas encore mesuré ». */
    const debutJour = new Date(); debutJour.setHours(0, 0, 0, 0);
    const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
    const [{ data: coutsJour }, { data: coutsMois }] = await Promise.all([
      sb.from("runs").select("cout_eur").gte("debut", debutJour.toISOString()),
      sb.from("runs").select("cout_eur").gte("debut", debutMois.toISOString()),
    ]);
    const somme = (l) => (l || []).reduce((s, r) => s + Number(r.cout_eur || 0), 0);

    const { data: couverture } = await sb.rpc("acquisition_couverture");
    const parPays = {};
    for (const t of couverture || []) {
      const cle = t.pays === "FR" ? (t.portee === "metropole" ? "MEL" : "France") : "International";
      parPays[cle] = parPays[cle] || { territoires: 0, opportunites: 0, canal: 0 };
      parPays[cle].territoires += 1;
      parPays[cle].opportunites += Number(t.opportunites || 0);
      parPays[cle].canal += Number(t.avec_canal || 0);
    }

    const { data: sourcesKo } = await sb.from("runs")
      .select("etape,message,debut").eq("statut", "partiel")
      .gte("debut", debutMois.toISOString()).order("id", { ascending: false }).limit(5);
    const insuffisant = await compter("acquisition_canaux", (q) => q.eq("statut", "non_trouve"));

    ecran.innerHTML = `
      <h2>Agents</h2>
      <div class="carte">
        ${(agents || []).map((a) => `<div class="agent">
          <span class="pastille ${a.actif ? "on" : ""}"></span>${esc(a.nom)}
          <span class="quoi">${esc(a.mission.slice(0, 70))}</span></div>`).join("")}
        ${AGENTS_PREVUS.map(([n, quoi]) => `<div class="agent">
          <span class="pastille"></span><span style="color:var(--doux)">${esc(n)}</span>
          <span class="quoi">${esc(quoi)} — pas encore construit</span></div>`).join("")}
      </div>

      <h2>Activité</h2>
      <div class="grille">
        ${tuile(decouvertes, "Opportunités découvertes")}
        ${tuile(qualifiees, "Opportunités qualifiées")}
        ${tuile(avecCanal, "Canaux trouvés")}
        ${tuile(contacts, "Contacts préparés", "aucun n'est envoyé par Autour")}
        ${tuile(aValider, "Actions à valider")}
        ${tuile(enCours, "Tâches en cours")}
        ${tuile(partenaires, "Partenaires")}
      </div>

      <h2>Territoires</h2>
      <div class="grille">
        ${["MEL", "France", "International"].map((k) => {
          const d = parPays[k] || { territoires: 0, opportunites: 0, canal: 0 };
          return tuile(d.opportunites, k,
            `${d.territoires} territoire(s) · ${d.canal} avec canal`);
        }).join("")}
      </div>

      <h2>Coûts</h2>
      <div class="grille">
        ${tuile(somme(coutsJour).toFixed(2) + " €", "Coût IA du jour",
          somme(coutsJour) === 0 ? "aucun appel de modèle aujourd'hui" : "")}
        ${tuile(somme(coutsMois).toFixed(2) + " €", "Coût IA du mois",
          somme(coutsMois) === 0 ? "aucun appel de modèle ce mois-ci" : "")}
      </div>

      <h2>Erreurs</h2>
      <div class="grille">
        ${tuile(erreurs, "Tâches échouées", erreurs ? "épuisées après 3 tentatives" : "aucune")}
        ${tuile((sourcesKo || []).length, "Sources en défaut", "étapes « partiel » ce mois-ci")}
        ${tuile(insuffisant, "Données insuffisantes", "canal cherché, non trouvé")}
      </div>
      ${(sourcesKo || []).length ? `<div class="carte journal">${sourcesKo.map((r) => `
        <div><time>${jour(r.debut)}</time><span>${esc(r.etape)} — ${esc((r.message || "").slice(0, 150))}</span></div>`).join("")}</div>` : ""}

      <h2>Entonnoir</h2>
      <div id="entonnoir"><p class="vide">Chargement…</p></div>`;

    const { data: etapes } = await sb.rpc("acquisition_entonnoir");
    document.getElementById("entonnoir").innerHTML = `<div class="carte">` +
      (etapes || []).map((e) => `<div class="critere"><b>${esc(e.etape.replace(/_/g, " "))}</b>
        ${e.mesurable ? `<strong>${e.valeur}</strong>`
          : `<span class="etiq inconnu">Données insuffisantes</span>
             <span class="pq">${esc(e.pourquoi_pas || "")}</span>`}</div>`).join("") + `</div>`;
  };

  /* --- 2. ACQUISITION ----------------------------------------------- */
  const FILTRES = { pays: "", ville: "", type: "", statut: "", pertinence: "", confiance: "", famille: "" };
  let avecCanalSeulement = false;
  let page = 0;

  VUES.acquisition = async function () {
    const [decouvertes, qualifiees, aExaminer, canaux, enAttente, partenaires] = await Promise.all([
      compter("acquisition_opportunites"),
      compter("acquisition_opportunites", (q) => q.eq("statut", "qualifiee")),
      compter("acquisition_opportunites", (q) => q.eq("statut", "a_examiner")),
      compter("acquisition_canaux", (q) => q.eq("statut", "trouve")),
      compter("acquisition_contacts", (q) => q.eq("statut", "attente_validation")),
      compter("acquisition_opportunites", (q) => q.eq("statut", "partenaire")),
    ]);

    /* Les listes de filtres viennent de ce qui existe VRAIMENT en base, pas
       d'une énumération écrite ici qui se désynchroniserait. */
    const { data: distincts } = await sb.from("acquisition_vue")
      .select("pays,ville,type,region").limit(2000);
    const uniques = (cle) => [...new Set((distincts || []).map((v) => v[cle]).filter(Boolean))].sort();

    ecran.innerHTML = `
      <div class="grille">
        ${tuile(decouvertes, "Découvertes")}${tuile(qualifiees, "Qualifiées")}
        ${tuile(aExaminer, "À examiner")}${tuile(canaux, "Canaux trouvés")}
        ${tuile(enAttente, "Actions en attente")}${tuile(partenaires, "Partenaires")}
      </div>
      <h2>Opportunités</h2>
      <div class="filtres">
        <select id="f-pays"><option value="">tous les pays</option>${uniques("pays").map((v) => `<option>${esc(v)}</option>`).join("")}</select>
        <select id="f-ville"><option value="">toutes les villes</option>${uniques("ville").map((v) => `<option>${esc(v)}</option>`).join("")}</select>
        <select id="f-type"><option value="">tous les types</option>${uniques("type").map((v) => `<option>${esc(v)}</option>`).join("")}</select>
        <select id="f-statut"><option value="">tous les statuts</option>${
          ["nouvelle","qualifiee","a_examiner","validee","contact_prepare","contacte","reponse","partenaire","non_pertinente","a_revoir"]
            .map((v) => `<option>${v}</option>`).join("")}</select>
        <select id="f-pertinence"><option value="">toute pertinence</option>${["eleve","moyen","faible","inconnu"].map((v) => `<option>${v}</option>`).join("")}</select>
        <select id="f-confiance"><option value="">toute confiance</option>${["eleve","moyen","faible","inconnu"].map((v) => `<option>${v}</option>`).join("")}</select>
        <select id="f-famille"><option value="">structures et gisements</option>
          <option value="structure">structures</option>
          <option value="opportunite_utilisateurs">gisements d'utilisateurs</option></select>
        <label class="meta" style="display:flex;align-items:center;gap:6px">
          <input type="checkbox" id="f-canal" style="width:auto" ${avecCanalSeulement ? "checked" : ""}>
          canal disponible</label>
      </div>
      <div id="liste"><p class="vide">Chargement…</p></div>`;

    for (const cle of Object.keys(FILTRES)) {
      const el = document.getElementById("f-" + cle);
      if (!el) continue;
      el.value = FILTRES[cle];
      el.onchange = () => { FILTRES[cle] = el.value; page = 0; liste(); };
    }
    document.getElementById("f-canal").onchange = (e) => {
      avecCanalSeulement = e.target.checked; page = 0; liste();
    };
    liste();
  };

  /* LA PAGINATION N'EST PAS UN CONFORT. Charger dix mille opportunités au
     premier affichage rendrait l'écran inutilisable le jour où il y en aura
     dix mille — c'est-à-dire exactement le jour où il servirait le plus. */
  async function liste() {
    const boite = document.getElementById("liste");
    let q = sb.from("acquisition_vue")
      .select("*", { count: "exact" })
      .order("evalue_le", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(page * PAR_PAGE, page * PAR_PAGE + PAR_PAGE - 1);
    for (const [cle, valeur] of Object.entries(FILTRES)) if (valeur) q = q.eq(cle, valeur);
    if (avecCanalSeulement) q = q.not("canal", "is", null);

    const { data, error, count } = await q;
    if (error) return boite.innerHTML = `<p class="vide err">${esc(error.message)}</p>`;
    if (!data.length) return boite.innerHTML = '<p class="vide">Aucune opportunité pour ces filtres.</p>';

    const pages = Math.max(1, Math.ceil((count || 0) / PAR_PAGE));
    boite.innerHTML = data.map((o) => `
      <div class="carte">
        <h3>${esc(o.nom)}</h3>
        <p class="meta">${esc(o.ville)}${o.pays && o.pays !== "FR" ? " (" + esc(o.pays) + ")" : ""}
          · ${esc((o.type || "").replace(/_/g, " "))}
          ${o.famille === "opportunite_utilisateurs" ? " · gisement d'utilisateurs" : ""}
          · <b>${esc(o.statut)}</b></p>
        <div class="rangee">
          ${["pertinence","accessibilite","potentiel","cout","actualite","confiance","facilite_contact"]
            .map((c) => o[c] ? `<span class="etiq ${o[c]}">${c.replace(/_/g, " ")} ${o[c]}</span>` : "").join("")}
          ${o.evalue_le ? "" : '<span class="etiq">pas encore qualifiée</span>'}
        </div>
        ${o.canal_principal
          ? `<p class="meta">Canal : <b>${esc(o.canal_type)}</b> — ${esc(o.canal_principal)}</p>`
          : `<p class="meta">Canal : ${o.canal_verifie_le ? "non trouvé" : "pas encore cherché"}</p>`}
        ${o.prochaine_action ? `<p class="meta">→ ${esc(o.prochaine_action)}</p>` : ""}
        <button class="act" data-fiche="${o.id}">Ouvrir la fiche</button>
      </div>`).join("")
      + `<div class="pagination">
           <button class="act" data-page="${page - 1}" ${page === 0 ? "disabled" : ""}>←</button>
           <span>page ${page + 1} / ${pages} · ${count} opportunité(s)</span>
           <button class="act" data-page="${page + 1}" ${page + 1 >= pages ? "disabled" : ""}>→</button>
         </div>`;

    boite.onclick = (e) => {
      const f = e.target.closest("button[data-fiche]");
      if (f) return fiche(f.dataset.fiche);
      const p = e.target.closest("button[data-page]");
      if (p && !p.disabled) { page = Number(p.dataset.page); liste(); }
    };
  }

  /* --- 3. LA FICHE --------------------------------------------------- */
  async function fiche(id) {
    ecran.innerHTML = '<p class="vide">Chargement…</p>';
    const [{ data: o }, { data: sources }, { data: criteres },
           { data: canaux }, { data: actions }, { data: contacts }] = await Promise.all([
      sb.from("acquisition_vue").select("*").eq("id", id).single(),
      sb.from("acquisition_sources").select("*").eq("opportunite_id", id).order("collecte_le"),
      sb.from("acquisition_qualifications").select("*").eq("opportunite_id", id),
      sb.from("acquisition_canaux").select("*").eq("opportunite_id", id).order("verifie_le"),
      sb.from("acquisition_actions").select("*").eq("opportunite_id", id).order("le", { ascending: false }),
      sb.from("acquisition_contacts").select("*").eq("opportunite_id", id).order("created_at", { ascending: false }),
    ]);
    if (!o) return ecran.innerHTML = '<p class="vide err">Fiche introuvable.</p>';

    ecran.innerHTML = `
      <button class="act" id="retour">← Retour</button>
      <h2>${esc(o.nom)}</h2>
      <div class="carte">
        <p class="meta">${esc(o.ville)} · ${esc(o.pays)} ${o.region ? "· " + esc(o.region) : ""}
          · ${esc((o.type || "").replace(/_/g, " "))}
          ${o.territoire_nom ? "· territoire " + esc(o.territoire_nom) : ""}
          · statut <b>${esc(o.statut)}</b></p>
        ${o.description ? `<p>${esc(o.description)}</p>` : '<p class="meta">Aucune description recopiée d\'une source.</p>'}
        ${o.raison_pertinence ? `<p><b>Pourquoi elle peut servir Autour :</b> ${esc(o.raison_pertinence)}</p>` : ""}
        ${o.prochaine_action ? `<p><b>Prochaine action proposée :</b> ${esc(o.prochaine_action)}</p>` : ""}
        <div class="rangee">
          <select id="statut">${["nouvelle","qualifiee","a_examiner","validee","contact_prepare","contacte","reponse","partenaire","non_pertinente","a_revoir"]
            .map((s) => `<option ${s === o.statut ? "selected" : ""}>${s}</option>`).join("")}</select>
          <button class="act" id="majstatut">Changer le statut</button>
        </div>
      </div>

      <h2>Qualification</h2>
      <div class="carte">${criteres.length ? criteres.map((c) => `
        <div class="critere"><b>${esc(c.critere.replace(/_/g, " "))}</b>
          <span class="etiq ${c.niveau}">${c.niveau}</span>
          <span class="pq">${esc(c.pourquoi)}</span>
          ${c.fait_observe ? `<span class="pq">Fait observé : ${esc(c.fait_observe)}</span>` : ""}
          <span class="pq">Méthode : ${esc(c.methode)}${c.modele ? " (" + esc(c.modele) + ")" : ""}</span>
        </div>`).join("") : '<p class="vide">Pas encore qualifiée.</p>'}</div>

      <h2>Canal public</h2>
      <div class="carte">${(canaux || []).length ? canaux.map((c) => `
        <div class="critere"><b>${esc(c.type.replace(/_/g, " "))}</b>
          ${c.statut === "trouve"
            ? `${/^https?:/.test(c.valeur) ? `<a href="${esc(c.valeur)}" target="_blank" rel="noopener noreferrer">${esc(c.valeur)}</a>` : esc(c.valeur)}
               <span class="pq">source : ${esc(c.source)} · confiance ${esc(c.confiance)} · vérifié le ${jour(c.verifie_le)}</span>`
            : `<span class="etiq inconnu">Canal non trouvé</span>
               <span class="pq">Cherché le ${jour(c.verifie_le)} dans ${esc(c.source)}, sans correspondance.</span>`}
        </div>`).join("") : '<p class="vide">Canal pas encore cherché.</p>'}</div>

      <h2>Sources</h2>
      <div class="carte">${(sources || []).map((s) => `
        <div class="critere"><b>${esc(s.source)}</b>
          <span class="pq">${esc(s.intitule || "")}</span>
          ${s.url ? `<span class="pq"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a></span>` : '<span class="pq">Aucune URL : donnée interne d\'Autour.</span>'}
          <span class="pq">${esc(s.type_source)} · collectée le ${jour(s.collecte_le)}</span>
        </div>`).join("") || '<p class="vide">Aucune source.</p>'}
        <details><summary>Faits observés (bruts)</summary>
          <pre style="white-space:pre-wrap;font-size:12px;color:var(--doux)">${esc(JSON.stringify(o.faits || {}, null, 2))}</pre>
          <p class="meta">Mesurés le ${jour(o.faits_mesures_le)}.</p></details></div>

      ${contacts.length ? `<h2>Contacts préparés</h2>` + contacts.map((c) => `
        <div class="carte"><p class="meta">${esc(c.canal)} · <b>${esc(c.statut)}</b> · ${jour(c.created_at)}</p>
        <p><b>${esc(c.objet)}</b></p>
        <pre style="white-space:pre-wrap;font-size:13px">${esc(c.message_modifie || c.message)}</pre></div>`).join("") : ""}

      <h2>Historique</h2>
      <div class="carte journal">${(actions || []).map((a) => `
        <div><time>${jour(a.le)} ${heure(a.le)}</time>
        <span>${esc(a.action)} — ${esc(a.detail || "")}${a.par ? "" : " (agent)"}</span></div>`).join("")
        || '<p class="vide">Aucune action.</p>'}</div>`;

    document.getElementById("retour").onclick = () => rendre();
    document.getElementById("majstatut").onclick = async () => {
      const statut = document.getElementById("statut").value;
      const { error } = await sb.from("acquisition_opportunites").update({ statut }).eq("id", id);
      if (!error) await sb.from("acquisition_actions").insert({
        opportunite_id: id, action: "statut",
        detail: "Passée à « " + statut + " » par un opérateur", par: moi.id,
      });
      fiche(id);
    };
  }

  /* --- 4. TERRITOIRES ------------------------------------------------ */
  VUES.territoires = async function () {
    const { data, error } = await sb.rpc("acquisition_couverture");
    if (error) return ecran.innerHTML = `<p class="vide err">${esc(error.message)}</p>`;

    const groupes = { "MEL / Hauts-de-France": [], "France": [], "International": [] };
    for (const t of data || []) {
      const cle = t.pays !== "FR" ? "International"
        : (t.portee === "metropole" ? "MEL / Hauts-de-France" : "France");
      groupes[cle].push(t);
    }

    ecran.innerHTML = Object.entries(groupes).map(([titre, lignes]) => `
      <h2>${esc(titre)}</h2>
      ${lignes.length ? `<div class="carte"><table>
        <tr><th>Territoire</th><th>Statut</th><th>Couverture</th><th>Opportunités</th>
            <th>Qualifiées</th><th>Canal</th><th>Dernière</th><th></th></tr>
        ${lignes.map((t) => `<tr>
          <td><b>${esc(t.nom)}</b><br><span class="meta">${esc(t.slug)}</span></td>
          <td>${esc(t.statut)}</td>
          <td><span class="etiq ${t.couverture === "bonne" ? "eleve" : (t.couverture === "partielle" ? "moyen" : "faible")}">${esc(t.couverture)}</span></td>
          <td>${t.opportunites}</td><td>${t.qualifiees}</td><td>${t.avec_canal}</td>
          <td>${t.derniere_recherche ? jour(t.derniere_recherche) : "jamais"}
              ${t.a_revoir ? '<br><span class="etiq moyen">à revoir</span>' : ""}</td>
          <td><button class="act" data-balayer="${esc(t.slug)}" data-pays="${esc(t.pays)}">Balayer</button></td>
        </tr>`).join("")}
      </table></div>` : '<p class="vide">Aucun territoire.</p>'}`).join("")
      + `<p class="meta" id="retour-t">Un territoire balayé récemment n'est pas rebalayé :
         l'agent lit son échéance avant de lancer la moindre requête.</p>`;

    ecran.onclick = async (e) => {
      const b = e.target.closest("button[data-balayer]");
      if (!b) return;
      const type = b.dataset.pays === "FR" ? "acquisition_scan_territory" : "acquisition_scan_international";
      const { error: err } = await sb.from("tasks").insert({
        agent: "acquisition", type, params: { territoire: b.dataset.balayer },
        demandee_par: moi.id, origine: "humain", statut: "file",
      });
      const retour = document.getElementById("retour-t");
      retour.className = err ? "err" : "meta";
      retour.textContent = err ? err.message
        : `Tâche « ${type} » créée pour ${b.dataset.balayer}. L'agent la prendra au prochain réveil.`;
    };
  };

  /* --- 5. À VALIDER -------------------------------------------------- */
  VUES.validation = async function () {
    const { data, error } = await sb.from("acquisition_contacts")
      .select("*, opportunite:acquisition_opportunites(id,nom,ville,pays,type,faits,raison_pertinence)")
      .in("statut", ["attente_validation", "approuve", "reporte"])
      .order("created_at", { ascending: false }).limit(50);
    if (error) return ecran.innerHTML = `<p class="vide err">${esc(error.message)}</p>`;
    if (!data.length) return ecran.innerHTML = '<p class="vide">Rien à valider.</p>';

    ecran.innerHTML = "<h2>À valider</h2>" + data.map((c) => {
      const o = c.opportunite || {};
      return `<div class="carte" data-contact="${c.id}">
        <h3>${esc(o.nom || "—")}</h3>
        <p class="meta">${esc(o.ville || "")} · ${esc((o.type || "").replace(/_/g, " "))}
          · canal proposé : ${esc(c.canal)} · <b>${esc(c.statut)}</b></p>
        ${o.raison_pertinence ? `<p class="meta">${esc(o.raison_pertinence)}</p>` : ""}
        <p><b>Pourquoi cette cible</b></p>
        <ul class="meta" style="margin:4px 0 8px;padding-left:18px">
          ${(c.faits_utilises || []).map((f) => `<li>${esc(f.fait)}${f.source_url
            ? ` — <a href="${esc(f.source_url)}" target="_blank" rel="noopener noreferrer">source</a>` : " — source interne"}</li>`).join("")
            || "<li>Aucun fait joint : ce brouillon n'aurait pas dû exister.</li>"}
        </ul>
        <p><b>Objet :</b> ${esc(c.objet)}</p>
        <textarea data-message>${esc(c.message_modifie || c.message)}</textarea>
        ${c.statut === "attente_validation" ? `<div class="rangee">
          <button class="act oui" data-act="approuve">Valider</button>
          <button class="act non" data-act="refuse">Refuser</button>
          <button class="act" data-act="reporte">Plus tard</button>
        </div>
        <p class="meta">Valider n'envoie rien : Autour n'a aucune fonction d'envoi.
          Le message devient bon à copier dans ta propre messagerie.</p>`
        : `<div class="rangee">
          <button class="act" data-act="envoye_par_humain">J'ai envoyé ce message</button></div>
          <p class="meta">À cliquer après ton envoi : c'est ce qui donne un point de départ à la mesure.</p>`}
      </div>`;
    }).join("");

    ecran.onclick = async (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      const carte = b.closest("[data-contact]");
      const id = carte.dataset.contact;
      const acte = b.dataset.act;
      const texte = carte.querySelector("[data-message]").value;

      const patch = { decide_par: moi.id, decide_le: new Date().toISOString() };
      if (acte === "approuve") { patch.statut = "approuve"; patch.message_modifie = texte; }
      if (acte === "refuse") { patch.statut = "refuse"; patch.motif = prompt("Pourquoi ce refus ?") || "Refusé sans motif."; }
      if (acte === "reporte") { patch.statut = "reporte"; patch.reporte_a = new Date(Date.now() + 14 * 864e5).toISOString(); }
      if (acte === "envoye_par_humain") { patch.statut = "envoye_par_humain"; patch.envoye_le = new Date().toISOString(); }

      const { data: maj, error } = await sb.from("acquisition_contacts").update(patch).eq("id", id).select().single();
      if (error) { alert(error.message); return; }
      await sb.from("acquisition_actions").insert({
        opportunite_id: maj.opportunite_id, action: "decision_" + acte,
        detail: patch.motif || ("Décision prise dans AGORA : " + acte), par: moi.id,
      });
      VUES.validation();
    };
  };

  /* --- 6. TÂCHES ----------------------------------------------------- */
  VUES.taches = async function () {
    const [{ data: taches }, { data: contrats }] = await Promise.all([
      sb.from("tasks").select("*").order("cree_le", { ascending: false }).limit(40),
      sb.from("task_permissions").select("*").order("type"),
    ]);

    ecran.innerHTML = `
      <h2>Lancer</h2>
      <div class="carte">
        <div class="rangee">
          <select id="t-type">${(contrats || []).map((c) =>
            `<option value="${esc(c.type)}">${esc(c.libelle)}</option>`).join("")}</select>
          <input id="t-params" placeholder='{"ville":"Tourcoing"}' style="max-width:320px">
          <button class="act" id="t-creer">Créer la tâche</button>
        </div>
        <p class="meta" id="t-retour">Les paramètres sont du JSON. Exemples :
          <code>{"ville":"Lille"}</code>, <code>{"territoire":"fr-paris"}</code>,
          <code>{"territoire":"fr-lyon","force":true}</code>.</p>
      </div>

      <h2>Contrats</h2>
      <div class="carte"><table>
        <tr><th>Type</th><th>Sources autorisées</th><th>Coût max</th><th>Contact externe</th></tr>
        ${(contrats || []).map((c) => `<tr>
          <td><b>${esc(c.type)}</b><br><span class="meta">${esc(c.notes || "")}</span></td>
          <td class="meta">${(c.sources_autorisees || []).map(esc).join(", ") || "—"}</td>
          <td>${Number(c.cout_max_eur).toFixed(2)} €</td>
          <td>${c.contact_externe ? '<span class="etiq faible">oui</span>'
                                  : '<span class="etiq eleve">jamais</span>'}</td>
        </tr>`).join("")}
      </table>
      <p class="meta">« Jamais » est une contrainte de schéma, pas un réglage :
        <code>check (contact_externe = false)</code>. La changer demande une migration.</p></div>

      <h2>Dernières tâches</h2>
      <div class="carte"><table>
        <tr><th>Type</th><th>Cible</th><th>Statut</th><th>Créée</th><th>Résultat</th></tr>
        ${(taches || []).map((t) => `<tr>
          <td>${esc(t.type.replace("acquisition_", ""))}</td>
          <td class="meta">${esc(t.params?.ville || t.params?.territoire || "—")}</td>
          <td><span class="etiq ${t.statut === "echouee" ? "faible" : (t.statut === "terminee" ? "eleve" : "moyen")}">${esc(t.statut)}</span></td>
          <td class="meta">${jour(t.cree_le)} ${heure(t.cree_le)}</td>
          <td class="meta">${esc(t.erreur || JSON.stringify(t.resultat || {}).slice(0, 110))}</td>
        </tr>`).join("")}
      </table></div>`;

    document.getElementById("t-creer").onclick = async () => {
      const retour = document.getElementById("t-retour");
      let params = {};
      try { params = JSON.parse(document.getElementById("t-params").value || "{}"); }
      catch (e) { retour.className = "err"; retour.textContent = "JSON invalide."; return; }
      const { error } = await sb.from("tasks").insert({
        agent: "acquisition", type: document.getElementById("t-type").value,
        params, demandee_par: moi.id, origine: "humain", statut: "file",
      });
      retour.className = error ? "err" : "meta";
      retour.textContent = error ? error.message : "Tâche créée, en file.";
      if (!error) setTimeout(VUES.taches, 900);
    };
  };

  /* --- 7. JOURNAL ----------------------------------------------------- */
  VUES.journal = async function () {
    const { data, error } = await sb.from("runs").select("*")
      .order("id", { ascending: false }).limit(150);
    if (error) return ecran.innerHTML = `<p class="vide err">${esc(error.message)}</p>`;
    ecran.innerHTML = `<h2>Journal de l'agent</h2>
      <p class="meta">Une ligne par étape, écrite au moment de l'étape. ${data.length} dernières.</p>
      <div class="carte journal">${data.map((r) => `
        <div><time>${jour(r.debut)} ${heure(r.debut)}</time>
        <span>${esc(r.etape)} ${r.statut !== "succes" && r.statut !== "info"
          ? `<span class="etiq ${r.statut === "echec" ? "faible" : "moyen"}">${r.statut}</span>` : ""}
        — ${esc(r.message || "")}${r.duree_ms ? ` <span class="meta">(${r.duree_ms} ms)</span>` : ""}</span></div>`).join("")
      || '<p class="vide">Le journal est vide.</p>'}</div>`;
  };

  /* --- 8. OPÉRATEUR ---------------------------------------------------- */
  VUES.operateur = async function () {
    const [{ data: etat }, { data: operateurs }, { data: tentatives }] = await Promise.all([
      sb.rpc("agora_etat"),
      sb.from("control_operateurs").select("*"),
      sb.from("runs").select("id").limit(1),
    ]);

    ecran.innerHTML = `
      <h2>Cette session</h2>
      <div class="carte">
        <div class="critere"><b>Compte</b> ${esc(moi.email || moi.id)}</div>
        <div class="critere"><b>Opérateur</b> <span class="etiq ${etat.operateur ? "eleve" : "faible"}">${etat.operateur ? "oui" : "non"}</span></div>
        <div class="critere"><b>Verrou AGORA</b> <span class="etiq eleve">ouvert</span>
          <span class="pq">jusqu'à ${etat.expire_le ? new Date(etat.expire_le).toLocaleString("fr-FR") : "—"}</span></div>
        <div class="critere"><b>Session anonyme</b> <span class="etiq ${etat.anonyme ? "faible" : "eleve"}">${etat.anonyme ? "oui" : "non"}</span>
          <span class="pq">une session anonyme est refusée même avec le bon code</span></div>
        <div class="rangee"><button class="act non" id="verrouiller">Verrouiller maintenant</button></div>
      </div>

      <h2>Opérateurs déclarés</h2>
      <div class="carte">
        ${(operateurs || []).map((o) => `<div class="critere"><b>${esc(o.role)}</b>
          <span class="pq">${esc(o.user_id)}${o.note ? " — " + esc(o.note) : ""}
          · déclaré le ${jour(o.cree_le)}</span></div>`).join("")}
        <p class="meta">Un opérateur s'ajoute depuis le SQL Editor du projet, jamais
          depuis cet écran : l'autorisation ne doit pas pouvoir s'accorder elle-même.</p>
      </div>

      <h2>Ce que l'agent ne peut pas faire</h2>
      <div class="carte">
        <div class="critere"><b>Envoyer un message</b>
          <span class="pq">Aucune fonction d'envoi n'existe dans le code, et
            <code>task_permissions.contact_externe</code> porte un CHECK qui l'empêche d'être vrai.</span></div>
        <div class="critere"><b>Dépenser</b>
          <span class="pq">Chaque type de tâche porte un plafond <code>cout_max_eur</code>. Tous sont à 0 ou 0,05 €.</span></div>
        <div class="critere"><b>Lire une source non déclarée</b>
          <span class="pq">La liste blanche est en base. Le code sait lire l'annuaire des entreprises ;
            il ne le fait que si une ligne l'y autorise.</span></div>
        <div class="critere"><b>Supprimer</b>
          <span class="pq">Aucune policy ne donne DELETE à l'opérateur ni à l'agent sur les tables d'acquisition.</span></div>
      </div>`;

    document.getElementById("verrouiller").onclick = () =>
      sb.rpc("agora_fermer").then(() => location.reload());
  };

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", demarrer);
  else demarrer();
})();
