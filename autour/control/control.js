/* ---------------------------------------------------------------------------
   Le Control Center

   CE QU'IL EST : quatre écrans pour piloter les agents — un tableau de bord,
   la liste des opportunités, la file de validation, le journal. Rien de plus.
   Le but est de décider vite, pas de faire une démonstration.

   CE QU'IL N'EST PAS : une autorité. Tout ce que cette page affiche, elle
   l'obtient de PostgREST sous l'identité de la personne connectée. Les tables
   du socle agents n'accordent aucun privilège à `anon`, et chaque policy passe
   par `public.est_operateur()`. Quelqu'un qui ouvre /control sans être
   opérateur télécharge donc ce fichier, l'exécute, et obtient des listes vides
   — ce que la page lui dit franchement plutôt que de faire semblant de
   protéger quoi que ce soit côté navigateur.

   LA CONNEXION EST CELLE D'AUTOUR. Même Auth, même lien par e-mail, même SDK
   vendorisé. `shouldCreateUser: false` : on n'ouvre pas de compte depuis ici.
   Une adresse inconnue reçoit un refus, pas un compte neuf.
--------------------------------------------------------------------------- */
(function () {
  "use strict";

  const SUPABASE_URL = "https://sxnzyvcgwbwnpjnqmpkp.supabase.co";
  const SUPABASE_CLE = "sb_publishable_T4_3er0DEI9vX4YdEhPDIw_m3yV_FlM";

  const ecran = document.getElementById("ecran");
  const nav = document.getElementById("nav");
  let sb = null, moi = null, vue = vueDepuisURL();

  const $ = (html) => { const d = document.createElement("div"); d.innerHTML = html; return d; };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const heure = (iso) => iso ? new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
  const jour = (iso) => iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : "—";

  function vueDepuisURL() {
    const p = location.pathname.replace(/\/+$/, "");
    if (p.endsWith("/acquisition")) return "acquisition";
    if (p.endsWith("/validation")) return "validation";
    if (p.endsWith("/journal")) return "journal";
    return "tableau";
  }

  /* ===================================================================
     CONNEXION
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
    if (!session) return ecranConnexion();
    moi = session.user;

    /* L'APPARTENANCE EST DEMANDÉE AU SERVEUR, PAS DÉDUITE DU JETON. Un client
       peut écrire ce qu'il veut dans son propre stockage ; il ne peut pas
       faire répondre `true` à une fonction qui lit une table. */
    const { data: operateur, error } = await sb.rpc("est_operateur");
    if (error || !operateur) return ecranRefus(error);

    nav.hidden = false;
    nav.onclick = (e) => {
      const b = e.target.closest("button[data-vue]");
      if (!b) return;
      if (b.dataset.vue === "sortir") return sb.auth.signOut().then(() => location.reload());
      vue = b.dataset.vue;
      history.pushState({}, "", "/control" + (vue === "tableau" ? "" : "/" + vue));
      rendre();
    };
    addEventListener("popstate", () => { vue = vueDepuisURL(); rendre(); });
    rendre();
  }

  function ecranConnexion() {
    nav.hidden = true;
    ecran.innerHTML = `<div class="connexion">
      <h2>Espace privé</h2>
      <p>Entre l'adresse du compte opérateur. Un code à six chiffres arrive par e-mail.</p>
      <input id="mail" type="email" placeholder="adresse e-mail" autocomplete="email">
      <button class="act" id="envoyer">Recevoir le code</button>
      <p id="etat" class="meta"></p></div>`;
    const etat = document.getElementById("etat");
    document.getElementById("envoyer").onclick = async () => {
      const email = document.getElementById("mail").value.trim();
      if (!email) return;
      etat.textContent = "Envoi…";
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) { etat.className = "err"; etat.textContent = error.message; return; }
      etat.className = "meta";
      ecran.querySelector(".connexion").insertAdjacentHTML("beforeend",
        '<input id="code" inputmode="numeric" placeholder="code à six chiffres" style="margin-top:10px">' +
        '<button class="act" id="valider">Entrer</button>');
      document.getElementById("valider").onclick = async () => {
        const token = document.getElementById("code").value.trim();
        const { error: e2 } = await sb.auth.verifyOtp({ email, token, type: "email" });
        if (e2) { etat.className = "err"; etat.textContent = e2.message; return; }
        location.reload();
      };
      etat.textContent = "Code envoyé.";
    };
  }

  function ecranRefus(error) {
    nav.hidden = true;
    ecran.innerHTML = `<div class="connexion"><h2>Espace privé</h2>
      <p>Ce compte n'est pas opérateur du Control Center. Rien n'est accessible depuis ici.</p>
      ${error ? `<p class="meta">${esc(error.message)}</p>` : ""}
      <button class="act" id="sortir">Se déconnecter</button></div>`;
    document.getElementById("sortir").onclick = () => sb.auth.signOut().then(() => location.reload());
  }

  /* ===================================================================
     RENDU
     =================================================================== */
  function rendre() {
    nav.querySelectorAll("button[data-vue]").forEach((b) =>
      b.setAttribute("aria-current", b.dataset.vue === vue ? "page" : "false"));
    ecran.innerHTML = '<p class="vide">Chargement…</p>';
    ({ tableau: vueTableau, acquisition: vueAcquisition, validation: vueValidation, journal: vueJournal })[vue]()
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

  /* --- 1. TABLEAU DE BORD ------------------------------------------- */
  async function vueTableau() {
    const [agents, enCours, aValider, decouvertes, qualifiees, contacts, partenaires, erreurs] =
      await Promise.all([
        compter("agents", (q) => q.eq("actif", true)),
        compter("tasks", (q) => q.in("statut", ["file", "en_cours"])),
        compter("acquisition_contacts", (q) => q.eq("statut", "attente_validation")),
        compter("acquisition_opportunites"),
        compter("acquisition_opportunites", (q) => q.eq("statut", "qualifiee")),
        compter("acquisition_contacts"),
        compter("acquisition_opportunites", (q) => q.eq("statut", "partenaire")),
        compter("tasks", (q) => q.eq("statut", "echouee")),
      ]);

    /* LE COÛT IA EST UNE SOMME D'APPELS RÉELLEMENT FACTURÉS, pas une
       estimation. Tant qu'aucun modèle n'est appelé, il vaut zéro et la
       précision le dit — plutôt que d'afficher un zéro qu'on lirait comme
       « pas encore mesuré ». */
    const { data: couts } = await sb.from("runs").select("cout_eur");
    const cout = (couts || []).reduce((s, r) => s + Number(r.cout_eur || 0), 0);

    ecran.innerHTML = `
      <h2>Agents</h2>
      <div class="grille">
        ${tuile(agents, "Agents actifs")}
        ${tuile(enCours, "Tâches en cours", "file + en cours d'exécution")}
        ${tuile(aValider, "Tâches nécessitant validation", aValider ? "à relire dans « À valider »" : "")}
        ${tuile(erreurs, "Erreurs", erreurs ? "tâches épuisées après 3 tentatives" : "aucune tâche échouée")}
        ${tuile(cout.toFixed(2) + " €", "Coût IA", cout === 0 ? "aucun appel de modèle à ce jour" : "somme des appels journalisés")}
      </div>
      <h2>Acquisition</h2>
      <div class="grille">
        ${tuile(decouvertes, "Opportunités découvertes")}
        ${tuile(qualifiees, "Opportunités qualifiées")}
        ${tuile(contacts, "Contacts préparés", "aucun n'est envoyé par Autour")}
        ${tuile(partenaires, "Partenaires")}
      </div>
      <h2>Lancer une recherche</h2>
      <div class="carte">
        <div class="rangee">
          <input id="ville" placeholder="commune (ex. Tourcoing)" style="max-width:260px">
          <button class="act" id="lancer">Chercher dans cette commune</button>
        </div>
        <div class="rangee">
          <button class="act" id="qualifier">Qualifier les nouvelles</button>
          <button class="act" id="preparer">Préparer des contacts</button>
          <button class="act" id="mesurer">Mesurer l'entonnoir</button>
        </div>
        <p class="meta" id="retour">La tâche entre en file. L'agent la prend au prochain réveil,
          ou immédiatement si tu déclenches <code>private.invoke_agent_acquisition('work')</code>.</p>
      </div>
      <h2>Entonnoir</h2>
      <div id="entonnoir"><p class="vide">Chargement…</p></div>`;

    const retour = document.getElementById("retour");
    const creer = async (type, params) => {
      const { error } = await sb.from("tasks").insert({
        agent: "acquisition", type, params,
        demandee_par: moi.id, origine: "humain", statut: "file",
      });
      retour.className = error ? "err" : "meta";
      retour.textContent = error ? error.message : `Tâche « ${type} » créée, en file.`;
      if (!error) setTimeout(rendre, 1200);
    };
    document.getElementById("lancer").onclick = () => {
      const ville = document.getElementById("ville").value.trim();
      if (!ville) return;
      creer("acquisition_scan_city", { ville, zone_id: "mel" });
    };
    document.getElementById("qualifier").onclick = () => creer("acquisition_qualify", { limite: 200 });
    document.getElementById("preparer").onclick = () => creer("acquisition_prepare_contact", { limite: 3 });
    document.getElementById("mesurer").onclick = () => creer("acquisition_followup_analysis", {});

    const { data: etapes } = await sb.rpc("acquisition_entonnoir");
    document.getElementById("entonnoir").innerHTML = `<div class="carte">` +
      (etapes || []).map((e) => `<div class="critere"><b>${esc(e.etape.replace(/_/g, " "))}</b>
        ${e.mesurable ? `<strong>${e.valeur}</strong>` : `<span class="etiq inconnu">Données insuffisantes</span>
        <span class="pq">${esc(e.pourquoi_pas || "")}</span>`}</div>`).join("") + `</div>`;
  }

  /* --- 2. ACQUISITION ------------------------------------------------ */
  const FILTRES = { ville: "", type: "", statut: "", pertinence: "", confiance: "", famille: "" };

  async function vueAcquisition() {
    const [decouvertes, qualifiees, aExaminer, prepares, enAttente, partenaires] = await Promise.all([
      compter("acquisition_opportunites"),
      compter("acquisition_opportunites", (q) => q.eq("statut", "qualifiee")),
      compter("acquisition_opportunites", (q) => q.eq("statut", "a_examiner")),
      compter("acquisition_contacts"),
      compter("acquisition_contacts", (q) => q.eq("statut", "attente_validation")),
      compter("acquisition_opportunites", (q) => q.eq("statut", "partenaire")),
    ]);

    const { data: villes } = await sb.from("acquisition_vue").select("ville,type").limit(2000);
    const uniques = (cle) => [...new Set((villes || []).map((v) => v[cle]).filter(Boolean))].sort();

    ecran.innerHTML = `
      <div class="grille">
        ${tuile(decouvertes, "Découvertes")}${tuile(qualifiees, "Qualifiées")}
        ${tuile(aExaminer, "À examiner")}${tuile(prepares, "Contacts préparés")}
        ${tuile(enAttente, "Actions en attente")}${tuile(partenaires, "Partenaires obtenus")}
      </div>
      <h2>Opportunités</h2>
      <div class="filtres">
        <select id="f-ville"><option value="">toutes les villes</option>${uniques("ville").map((v) => `<option>${esc(v)}</option>`).join("")}</select>
        <select id="f-type"><option value="">tous les types</option>${uniques("type").map((v) => `<option>${esc(v)}</option>`).join("")}</select>
        <select id="f-statut"><option value="">tous les statuts</option>${
          ["nouvelle", "qualifiee", "a_examiner", "validee", "contact_prepare", "contacte", "reponse", "partenaire", "non_pertinente", "a_revoir"]
            .map((v) => `<option>${v}</option>`).join("")}</select>
        <select id="f-pertinence"><option value="">toute pertinence</option>${["eleve", "moyen", "faible", "inconnu"].map((v) => `<option>${v}</option>`).join("")}</select>
        <select id="f-confiance"><option value="">toute confiance</option>${["eleve", "moyen", "faible", "inconnu"].map((v) => `<option>${v}</option>`).join("")}</select>
        <select id="f-famille"><option value="">structures et gisements</option>
          <option value="structure">structures</option>
          <option value="opportunite_utilisateurs">gisements d'utilisateurs</option></select>
      </div>
      <div id="liste"><p class="vide">Chargement…</p></div>`;

    for (const cle of Object.keys(FILTRES)) {
      const el = document.getElementById("f-" + cle);
      el.value = FILTRES[cle];
      el.onchange = () => { FILTRES[cle] = el.value; liste(); };
    }
    liste();
  }

  async function liste() {
    const boite = document.getElementById("liste");
    let q = sb.from("acquisition_vue").select("*")
      .order("evalue_le", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false }).limit(200);
    for (const [cle, valeur] of Object.entries(FILTRES)) if (valeur) q = q.eq(cle, valeur);
    const { data, error } = await q;
    if (error) return boite.innerHTML = `<p class="vide err">${esc(error.message)}</p>`;
    if (!data.length) return boite.innerHTML = '<p class="vide">Aucune opportunité pour ces filtres.</p>';

    boite.innerHTML = data.map((o) => `
      <div class="carte" data-id="${o.id}">
        <h3>${esc(o.nom)}</h3>
        <p class="meta">${esc(o.ville)} · ${esc((o.type || "").replace(/_/g, " "))}
          ${o.famille === "opportunite_utilisateurs" ? " · gisement d'utilisateurs" : ""}
          · <b>${esc(o.statut)}</b></p>
        <div class="rangee">
          ${["pertinence", "accessibilite", "potentiel", "cout", "actualite", "confiance"]
            .map((c) => o[c] ? `<span class="etiq ${o[c]}">${c} ${o[c]}</span>` : "").join("")}
          ${o.evalue_le ? "" : '<span class="etiq">pas encore qualifiée</span>'}
        </div>
        ${o.prochaine_action ? `<p class="meta">→ ${esc(o.prochaine_action)}</p>` : ""}
        <p class="meta">${o.sources_nb || 0} source(s) · dernière collecte ${jour(o.derniere_collecte)}</p>
        <button class="act" data-fiche="${o.id}">Ouvrir la fiche</button>
      </div>`).join("");

    boite.onclick = (e) => {
      const b = e.target.closest("button[data-fiche]");
      if (b) fiche(b.dataset.fiche);
    };
  }

  /* --- 3. LA FICHE --------------------------------------------------- */
  async function fiche(id) {
    ecran.innerHTML = '<p class="vide">Chargement…</p>';
    const [{ data: o }, { data: sources }, { data: criteres }, { data: actions }, { data: contacts }] =
      await Promise.all([
        sb.from("acquisition_vue").select("*").eq("id", id).single(),
        sb.from("acquisition_sources").select("*").eq("opportunite_id", id).order("collecte_le"),
        sb.from("acquisition_qualifications").select("*").eq("opportunite_id", id),
        sb.from("acquisition_actions").select("*").eq("opportunite_id", id).order("le", { ascending: false }),
        sb.from("acquisition_contacts").select("*").eq("opportunite_id", id).order("created_at", { ascending: false }),
      ]);
    if (!o) return ecran.innerHTML = '<p class="vide err">Fiche introuvable.</p>';

    ecran.innerHTML = `
      <button class="act" id="retour">← Retour à la liste</button>
      <h2>${esc(o.nom)}</h2>
      <div class="carte">
        <p class="meta">${esc(o.ville)} · ${esc((o.type || "").replace(/_/g, " "))} ·
          ${o.famille === "opportunite_utilisateurs" ? "gisement d'utilisateurs" : "structure"} ·
          statut <b>${esc(o.statut)}</b></p>
        ${o.description ? `<p>${esc(o.description)}</p>` : '<p class="meta">Aucune description recopiée d\'une source.</p>'}
        ${o.prochaine_action ? `<p><b>Prochaine action proposée :</b> ${esc(o.prochaine_action)}</p>` : ""}
        <div class="rangee">
          <select id="statut">${["nouvelle", "qualifiee", "a_examiner", "validee", "contact_prepare", "contacte", "reponse", "partenaire", "non_pertinente", "a_revoir"]
            .map((s) => `<option ${s === o.statut ? "selected" : ""}>${s}</option>`).join("")}</select>
          <button class="act" id="majstatut">Changer le statut</button>
        </div>
      </div>

      <h2>Pourquoi elle est pertinente</h2>
      <div class="carte">${criteres.length ? criteres.map((c) => `
        <div class="critere"><b>${esc(c.critere)}</b>
          <span class="etiq ${c.niveau}">${c.niveau}</span>
          <span class="pq">${esc(c.pourquoi)}</span>
          ${c.fait_observe ? `<span class="pq">Fait observé : ${esc(c.fait_observe)}</span>` : ""}
          <span class="pq">Méthode : ${esc(c.methode)}${c.modele ? " (" + esc(c.modele) + ")" : ""}</span>
        </div>`).join("") : '<p class="vide">Pas encore qualifiée.</p>'}</div>

      <h2>Sources</h2>
      <div class="carte">${(sources || []).map((s) => `
        <div class="critere"><b>${esc(s.source)}</b>
          <span class="pq">${esc(s.intitule || "")}</span>
          ${s.url ? `<span class="pq"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url)}</a></span>` : '<span class="pq">Aucune URL : donnée interne d\'Autour.</span>'}
          <span class="pq">${esc(s.type_source)} · collectée le ${jour(s.collecte_le)}</span>
        </div>`).join("") || '<p class="vide">Aucune source.</p>'}</div>

      <h2>Informations publiques disponibles</h2>
      <div class="carte">${Object.keys(o.coordonnees_publiques || {}).length
        ? Object.entries(o.coordonnees_publiques).map(([k, v]) =>
            `<div class="critere"><b>${esc(k)}</b> ${esc(v.valeur || v)}
             <span class="pq">vu sur ${esc(v.vu_sur || "—")}</span></div>`).join("")
        : '<p class="vide">Aucune coordonnée publique relevée. Rien n\'a été deviné.</p>'}
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
        opportunite_id: id, action: "statut", detail: "Passée à « " + statut + " » par un opérateur", par: moi.id,
      });
      fiche(id);
    };
  }

  /* --- 4. À VALIDER ---------------------------------------------------
     L'écran où le fondateur décide. Il montre la cible, pourquoi elle a été
     retenue, les sources, et le message — dans cet ordre, parce que c'est
     l'ordre dans lequel on vérifie : on regarde d'abord si la structure
     mérite un message, et le texte ensuite.
     ------------------------------------------------------------------ */
  async function vueValidation() {
    const { data, error } = await sb.from("acquisition_contacts")
      .select("*, opportunite:acquisition_opportunites(id,nom,ville,type,faits)")
      .in("statut", ["attente_validation", "approuve", "reporte"])
      .order("created_at", { ascending: false }).limit(50);
    if (error) return ecran.innerHTML = `<p class="vide err">${esc(error.message)}</p>`;
    if (!data.length) return ecran.innerHTML = '<p class="vide">Rien à valider. L\'agent n\'a rien préparé, ou tout a été traité.</p>';

    ecran.innerHTML = "<h2>À valider</h2>" + data.map((c) => {
      const o = c.opportunite || {};
      return `<div class="carte" data-contact="${c.id}">
        <h3>${esc(o.nom || "—")}</h3>
        <p class="meta">${esc(o.ville || "")} · ${esc((o.type || "").replace(/_/g, " "))} ·
          canal proposé : ${esc(c.canal)} · <b>${esc(c.statut)}</b></p>
        <p><b>Pourquoi cette cible</b></p>
        <ul class="meta" style="margin:4px 0 8px;padding-left:18px">
          ${(c.faits_utilises || []).map((f) => `<li>${esc(f.fait)}${f.source_url
            ? ` — <a href="${esc(f.source_url)}" target="_blank" rel="noopener noreferrer">source</a>` : " — source interne"}</li>`).join("")
            || "<li>Aucun fait joint : ce brouillon n'aurait pas dû exister.</li>"}
        </ul>
        <p><b>Objet :</b> ${esc(c.objet)}</p>
        <textarea data-message>${esc(c.message_modifie || c.message)}</textarea>
        ${c.statut === "attente_validation" ? `<div class="rangee">
          <button class="act oui" data-act="approuve">Approuver</button>
          <button class="act non" data-act="refuse">Refuser</button>
          <button class="act" data-act="reporte">Plus tard</button>
        </div>
        <p class="meta">Approuver n'envoie rien : Autour n'a aucune fonction d'envoi.
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
      if (acte === "refuse") { patch.statut = "refuse"; patch.motif = prompt("Pourquoi ce refus ? (écrit dans l'historique)") || "Refusé sans motif."; }
      if (acte === "reporte") { patch.statut = "reporte"; patch.reporte_a = new Date(Date.now() + 14 * 864e5).toISOString(); }
      if (acte === "envoye_par_humain") { patch.statut = "envoye_par_humain"; patch.envoye_le = new Date().toISOString(); }

      const { data: maj, error } = await sb.from("acquisition_contacts").update(patch).eq("id", id).select().single();
      if (error) { alert(error.message); return; }
      await sb.from("acquisition_actions").insert({
        opportunite_id: maj.opportunite_id, action: "decision_" + acte,
        detail: patch.motif || ("Décision prise dans le Control Center : " + acte), par: moi.id,
      });
      vueValidation();
    };
  }

  /* --- 5. JOURNAL ----------------------------------------------------- */
  async function vueJournal() {
    const { data, error } = await sb.from("runs").select("*")
      .order("id", { ascending: false }).limit(120);
    if (error) return ecran.innerHTML = `<p class="vide err">${esc(error.message)}</p>`;
    ecran.innerHTML = `<h2>Journal de l'agent</h2>
      <p class="meta">Une ligne par étape, écrite au moment de l'étape. ${data.length} dernières.</p>
      <div class="carte journal">${data.map((r) => `
        <div><time>${heure(r.debut)}</time>
        <span>${esc(r.etape)} ${r.statut !== "succes" && r.statut !== "info"
          ? `<span class="etiq ${r.statut === "echec" ? "faible" : "moyen"}">${r.statut}</span>` : ""}
        — ${esc(r.message || "")}${r.duree_ms ? ` <span class="meta">(${r.duree_ms} ms)</span>` : ""}</span></div>`).join("")
      || '<p class="vide">Le journal est vide.</p>'}</div>`;
  }

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", demarrer);
  else demarrer();
})();
