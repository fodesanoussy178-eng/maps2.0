/*
 * Coquille critique d'Autour.
 *
 * Elle ne connaît ni les données ni la carte : elle rend le premier geste
 * visible, puis demande le moteur complet dès que cette petite surface est
 * opérationnelle. Le HTML possède déjà la navigation et les états initiaux ;
 * ce fichier ne fait que prolonger cette interaction pendant le chargement.
 */
(() => {
  const marquer = (nom, instant) => {
    try {
      const t = Number(instant);
      performance.mark("autour:" + nom, Number.isFinite(t) ? {startTime:t} : undefined);
    } catch (e) {}
  };

  try {
    const ressource = performance.getEntriesByType("resource")
      .find((r) => /\/autour-shell\.js(?:\?|$)/.test(r.name));
    marquer("shell_telecharge", ressource && ressource.responseEnd);
  } catch (e) {}
  marquer("shell_evalue");

  /* Le pont inline accuse déjà réception des taps avant le moteur. Cette
     seconde écoute couvre le cas le plus tôt — pointerdown — sur Safari : le
     retour actif apparaît au contact, sans attendre la synthèse de `click`. */
  document.addEventListener("pointerdown", (event) => {
    const cible = event.target instanceof Element
      ? event.target.closest("#btnAide,[data-nb]") : null;
    if (!cible) return;
    if (cible.matches("[data-nb]")) {
      const nav = cible.closest("#navBas");
      if (nav) nav.querySelectorAll("[data-nb]")
        .forEach((bouton) => bouton.classList.toggle("actif", bouton === cible));
    } else {
      cible.classList.add("actif");
      cible.setAttribute("aria-pressed", "true");
    }
    if (!window.__autourShellReaction) {
      window.__autourShellReaction = true;
      marquer("shell_reaction");
    }
  }, true);

  const lien = document.querySelector('link[data-autour-moteur="1"]');
  const url = lien && lien.href;
  try {
    const moteur = performance.getEntriesByType("resource")
      .find((r) => /\/autour\.js(?:\?|$)/.test(r.name));
    if (moteur && Number.isFinite(moteur.startTime))
      marquer("bundle_telecharge_debut", moteur.startTime);
  } catch (e) {}
  const charger = () => {
    if (!url || window.__autourMoteurCharge) return;
    window.__autourMoteurCharge = true;
    marquer("shell_ready");
    const script = document.createElement("script");
    script.src = url;
    script.async = false;
    script.defer = true;
    document.head.appendChild(script);
  };
  charger();
})();
