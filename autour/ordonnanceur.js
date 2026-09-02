(function (root) {
  "use strict";

  /* ===================================================================
     Rendre la main au navigateur

     CE QUI A ÉTÉ MESURÉ, ET CE QUE ÇA VEUT DIRE

     Sur un centre-ville dense — cent vingt lieux — le profil dit ceci :

       recommandationsAccueil   13 appels   3907 ms   pire : 443 ms
       rendre (marqueurs)        6 appels   2088 ms   pire : 944 ms

     Quatre secondes de fil principal occupé, en tranches de trois à neuf
     dixièmes de seconde. Pendant ce temps le navigateur ne peint rien, ne
     défile pas, n'enregistre pas un appui. Ce n'est pas « l'application
     attend le réseau » : les lieux étaient arrivés à 583 ms et les événements
     à 2,8 s. C'est « personne ne peut dessiner ».

     Et « Maintenant » en était la première victime : il se construit dans le
     MÊME `innerHTML` que la liste de recommandations. Il ne pouvait donc pas
     apparaître avant que le classement complet soit terminé — alors que sa
     propre sélection, elle, était prête depuis longtemps.

     CE QUE FAIT CE MODULE, ET CE QU'IL NE FAIT PAS

     Il ne rend rien plus rapide. Le travail total est exactement le même :
     c'est le contrat, les résultats finaux ne changent pas d'une virgule. Il
     le RÉPARTIT, pour que le navigateur reprenne la main entre deux morceaux
     et puisse peindre ce qui est déjà prêt.

     Un travail différé porte toujours un JETON. Si la zone change, si une
     autre recherche part, le jeton est périmé et le travail ne s'exécute
     jamais — plutôt que d'aboutir en écrasant l'écran avec le classement
     d'une ville qu'on a quittée.
     =================================================================== */

  /* `requestIdleCallback` est ce qu'on veut : il attend que le navigateur
     n'ait rien de mieux à faire. Safari ne l'a jamais implémenté, et c'est
     précisément la plateforme sur laquelle on ne peut pas se permettre de
     bloquer. Le repli n'essaie pas de l'imiter — il rend la main, ce qui est
     l'essentiel — et il porte le même contrat (`didTimeout`, `timeRemaining`)
     pour que l'appelant n'ait pas à savoir lequel des deux il utilise. */
  function planifier(fn, options) {
    const delai = (options && options.timeout) || 200;
    if (typeof root.requestIdleCallback === "function") {
      const id = root.requestIdleCallback(fn, { timeout: delai });
      return () => { try { root.cancelIdleCallback(id); } catch (e) {} };
    }
    /* Un `setTimeout(0)` rend parfois la main, mais sous WebKit il peut être
       rejoué avant le prochain frame et enchaîner plusieurs lots lourds. On
       impose d'abord une image, puis une tâche suivante : le geste a ainsi
       une vraie occasion de peindre, sans ajouter artificiellement les 200 à
       400 ms du timeout d'idle à chaque travail différé. */
    let minuterie = null;
    let frame = null;
    const lancer = () => {
      minuterie = setTimeout(() => fn({
        didTimeout: true,
        timeRemaining: () => 0,
      }), 0);
    };
    if (typeof root.requestAnimationFrame === "function") frame = root.requestAnimationFrame(lancer);
    else lancer();
    return () => {
      if (frame != null && root.cancelAnimationFrame) root.cancelAnimationFrame(frame);
      if (minuterie != null) clearTimeout(minuterie);
    };
  }

  /* ===================================================================
     UN TRAVAIL DIFFÉRÉ, ANNULABLE

     `differer` rend une fonction d'annulation. L'appelant garde la dernière,
     et l'appelle avant d'en programmer une autre : sans ça, dix arrivées de
     données en trois secondes programment dix classements dont neuf sont
     périmés avant même de commencer.
     =================================================================== */
  function differer(travail, options) {
    const o = options || {};
    let annule = false;
    const stop = planifier((echeance) => {
      if (annule) return;
      if (typeof o.valide === "function" && !o.valide()) return;
      travail(echeance);
    }, o);
    return () => { annule = true; stop(); };
  }

  /* ===================================================================
     PAR LOTS

     Découpe une liste et rend la main entre les morceaux. La taille du lot
     n'est pas fixée à l'avance : on traite tant qu'il reste du temps dans la
     tranche d'inactivité, et on s'arrête dès qu'il n'y en a plus. Une taille
     fixe se trompe toujours — trop grande sur un téléphone lent, trop petite
     sur un ordinateur, et de toute façon fausse dès que le contenu change.

     `LOT_MIN` existe pour ne pas dégénérer : sans lui, une tranche sans temps
     disponible ne traiterait aucun élément et la boucle tournerait sans jamais
     avancer.
     =================================================================== */
  const LOT_MIN = 8;
  const BUDGET_MS = 8;          // au-delà, on retient le fil trop longtemps

  function parLots(items, traiter, options) {
    const o = options || {};
    const liste = items || [];
    const lotMin = Number.isFinite(o.lotMin) && o.lotMin > 0 ? o.lotMin : LOT_MIN;
    const budget = Number.isFinite(o.budgetMs) && o.budgetMs > 0 ? o.budgetMs : BUDGET_MS;
    let i = 0;
    let annule = false;
    let stopCourant = null;

    return new Promise((fini) => {
      const tranche = (echeance) => {
        if (annule) return fini({ annule: true, traites: i });
        if (typeof o.valide === "function" && !o.valide()) {
          return fini({ annule: true, traites: i });
        }
        const debut = now();
        let dansCeLot = 0;
        while (i < liste.length) {
          traiter(liste[i], i);
          i += 1;
          dansCeLot += 1;
          const reste = echeance && typeof echeance.timeRemaining === "function"
            ? echeance.timeRemaining() : 0;
          if (dansCeLot >= lotMin && (reste <= 1 || now() - debut >= budget)) break;
        }
        if (typeof o.apresLot === "function") o.apresLot(i, liste.length);
        if (i >= liste.length) return fini({ annule: false, traites: i });
        stopCourant = planifier(tranche, o);
      };
      stopCourant = planifier(tranche, o);
      /* ANNULER DOIT RÉSOUDRE, PAS SEULEMENT ARRÊTER.

         Une première version se contentait de couper la tranche programmée.
         Le travail s'arrêtait bien — mais la promesse n'était jamais tenue, et
         tout appelant qui l'attendait restait suspendu pour toujours. Un test
         l'a montré en se bloquant ; en production ç'aurait été une ingestion
         qui ne se termine jamais après un changement de zone. */
      if (o.recevoirAnnulation) {
        o.recevoirAnnulation(() => {
          if (annule) return;
          annule = true;
          if (stopCourant) stopCourant();
          fini({ annule: true, traites: i });
        });
      }
    });
  }

  function now() {
    try { return performance.now(); } catch (e) { return Date.now(); }
  }

  root.AutourOrdonnanceur = Object.freeze({
    planifier, differer, parLots, LOT_MIN, BUDGET_MS,
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
