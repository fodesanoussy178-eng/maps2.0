/* SONDE NEUTRALISÉE.

   Elle a servi à une seule question — l'Interactions API rend-elle des
   `url_citation` avec la clé de production — et la réponse est acquise :
   oui en texte libre, non sous `response_format`.

   Son travail est fini. Elle ne touche plus à rien, n'appelle plus aucune API
   et ne dépense rien. Le MCP Supabase ne sait pas supprimer une fonction ;
   pour l'effacer vraiment :

       supabase functions delete canary-gemini --project-ref sxnzyvcgwbwnpjnqmpkp
*/
Deno.serve(() =>
  new Response(JSON.stringify({
    etat: "neutralisee",
    note: "sonde de diagnostic terminée ; supprimer avec supabase functions delete canary-gemini",
  }), {
    status: 410,
    headers: {"Content-Type": "application/json", "Cache-Control": "no-store"},
  }));
