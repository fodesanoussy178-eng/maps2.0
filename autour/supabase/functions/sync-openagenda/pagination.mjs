const MAX_PAGES = 100;

function cursorSignature(cursor) {
  return JSON.stringify(cursor);
}

function validCursor(cursor) {
  return Array.isArray(cursor) && cursor.length > 0 && cursor.every((item) =>
    typeof item === "string" || typeof item === "number");
}

/* Parcourt le curseur `after` de l'API v2. Le plafond et la mémoire des
   curseurs empêchent une réponse amont défectueuse de créer une boucle sans
   fin ou de monopoliser une Edge Function. */
export async function listOpenAgendaEvents({client, source, search, from, until, relative, apiKey,
  fetchImpl, maxPages = MAX_PAGES} = {}) {
  if (!client || typeof client.fetchEventsPage !== "function") {
    throw new TypeError("client OpenAgenda invalide");
  }
  const events = [];
  const seenCursors = new Set();
  let after = null;
  let pages = 0;
  let total = null;

  while (pages < maxPages) {
    const page = await client.fetchEventsPage({
      source, search, from, until, relative, after, apiKey, fetchImpl,
    });
    pages += 1;
    if (!page || !Array.isArray(page.events)) {
      throw new Error("page OpenAgenda invalide");
    }
    events.push(...page.events);
    total = page.total ?? total;

    if (page.after == null) break;
    if (!validCursor(page.after)) throw new Error("curseur OpenAgenda after invalide");
    if (!page.events.length) throw new Error("réponse OpenAgenda vide avec un curseur after");

    const signature = cursorSignature(page.after);
    if (seenCursors.has(signature)) throw new Error("curseur OpenAgenda after répété");
    seenCursors.add(signature);
    after = page.after;
  }

  if (pages >= maxPages && after !== null) {
    throw new Error(`pagination OpenAgenda interrompue après ${maxPages} pages`);
  }
  return {events, pages, total};
}

export {MAX_PAGES as OPENAGENDA_MAX_PAGES};
