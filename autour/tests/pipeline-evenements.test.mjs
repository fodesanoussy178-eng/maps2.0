import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const fonction = await readFile(
  new URL("../supabase/functions/sync-datatourisme/index.ts", import.meta.url), "utf8");
const workflow = await readFile(
  new URL("../../.github/workflows/evenements-sync.yml", import.meta.url), "utf8");
const doc = await readFile(
  new URL("../docs/evenements-canoniques.md", import.meta.url), "utf8");

/* Le pipeline repose sur une séparation qu'il est facile de défaire sans s'en
   apercevoir : QUI a le droit d'appeler n'est pas AVEC QUOI on écrit.

   Avant, GitHub détenait `SUPABASE_SERVICE_ROLE_KEY` pour franchir la
   vérification de JWT. Un secret de dépôt qui fuit donnait alors un accès
   complet à la base, RLS contourné — pour un droit qui n'aurait jamais dû
   dépasser « demander un import que la planification fait déjà ». */

/* ====================================================================== */
/*  Aucune clé Supabase hors de Supabase                                  */
/* ====================================================================== */

test("le workflow ne détient aucune clé Supabase", () => {
  assert.doesNotMatch(workflow, /SUPABASE_SERVICE_ROLE_KEY/,
    "GitHub ne doit plus jamais porter la clé de service");
  /* Les motifs visent des NOMS DE CLÉ, pas des sous-chaînes : « canoniques »
     contient « anon », et un test qui trébuche là-dessus finit désactivé. */
  assert.doesNotMatch(workflow, /\bSERVICE_KEY\b|\bSECRET_KEYS?\b|sb_secret|\bANON_KEY\b/i);
  // il n'envoie pas non plus d'en-tête d'autorisation Supabase
  assert.doesNotMatch(workflow, /Authorization:\s*Bearer/);
});

test("le workflow n'utilise que les deux secrets prévus", () => {
  const utilises = [...workflow.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(utilises)].sort(),
    ["EVENT_SYNC_SECRET", "SUPABASE_FUNCTIONS_URL"]);
});

test("le secret voyage dans x-sync-secret, et nulle part ailleurs", () => {
  assert.match(workflow, /--header "x-sync-secret: \$\{SYNC_SECRET\}"/);
  // jamais dans l'URL : une URL se journalise, un en-tête beaucoup moins
  assert.doesNotMatch(workflow, /[?&][a-z_]*secret=/i);
});

test("aucune valeur secrète n'est écrite dans le dépôt", () => {
  for (const source of [workflow, fonction, doc]) {
    assert.doesNotMatch(source, /sb_secret_[A-Za-z0-9_-]{10,}/, "clé secrète en clair");
    assert.doesNotMatch(source, /eyJhbGciOi[A-Za-z0-9._-]{20,}/, "JWT en clair");
  }
});

/* ====================================================================== */
/*  La fonction écrit avec la clé moderne                                 */
/* ====================================================================== */

test("la clé d'écriture est lue dans le dictionnaire moderne", () => {
  assert.match(fonction, /Deno\.env\.get\("SUPABASE_SECRET_KEYS"\)/);
  // c'est un dictionnaire JSON, pas une chaîne : plusieurs clés nommées
  // coexistent, ce qui est ce qui rend une rotation possible sans coupure
  assert.match(fonction, /JSON\.parse\(dictionnaire\)/);
  assert.match(fonction, /Deno\.env\.get\("SUPABASE_SECRET_KEY_NAME"\) \?\? "default"/);
});

test("la clé de service héritée n'est plus lue nulle part", () => {
  assert.doesNotMatch(fonction, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("une clé absente donne un 503 qui nomme le problème, pas un 500 muet", () => {
  /* La lecture est paresseuse : au chargement du module, une configuration
     incomplète ferait échouer la fonction ENTIÈRE — y compris la porte
     d'authentification, qui n'a pourtant pas besoin de la clé. */
  assert.match(fonction, /let cleMemorisee: string \| null = null;/);
  assert.match(fonction, /function cleSecrete\(\): string \{\s*\n\s*if \(cleMemorisee\)/);
  assert.match(fonction, /return new Response\(JSON\.stringify\(\{error: `configuration : \$\{message\}`\}\),\s*\n\s*\{status: 503/);
});

/* ====================================================================== */
/*  La porte, et rien avant elle                                          */
/* ====================================================================== */

test("le secret est vérifié avant tout travail", () => {
  const handler = fonction.slice(fonction.indexOf("Deno.serve("));
  const porte = handler.indexOf("memeSecret(fourni, SYNC_SECRET)");
  const premiereEcriture = handler.indexOf("ouvrirCourse(");
  const premiereLecture = handler.indexOf("zones(demandee)");
  assert.ok(porte > 0 && porte < premiereEcriture && porte < premiereLecture,
    "un appel non autorisé ne doit ni écrire, ni lire, ni rien apprendre");
});

test("le secret se compare en temps constant", () => {
  /* `!==` s'arrête au premier caractère différent : la durée de la réponse
     renseigne alors sur la longueur du préfixe correct. */
  assert.match(fonction, /async function memeSecret\(fourni: string, attendu: string\)/);
  assert.match(fonction, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(fonction, /ecart \|= x\[i\] \^ y\[i\]/);
  assert.doesNotMatch(fonction, /fourni !== SYNC_SECRET/);
});

test("un secret non configuré refuse tout le monde", () => {
  // sinon une fonction déployée sans son secret serait ouverte à l'internet
  const bloc = /async function memeSecret[\s\S]*?\n\}/.exec(fonction)[0];
  assert.match(bloc, /if \(!attendu\) return false;/);
});

test("la réponse d'un refus ne dit rien de plus que « non »", () => {
  assert.match(fonction, /\{error: "non autoris/);
  const handler = fonction.slice(fonction.indexOf("Deno.serve("));
  const refus = handler.slice(0, handler.indexOf("CLE_DATATOURISME"));
  assert.doesNotMatch(refus, /SYNC_SECRET\.length|attendu\.length/);
});

/* ====================================================================== */
/*  La matrice et la planification restent ce qu'elles étaient            */
/* ====================================================================== */

test("les six zones et leur planification sont conservées", () => {
  const matrice = /zone: \[([^\]]+)\]/.exec(workflow)[1];
  assert.deepEqual(matrice.split(",").map((z) => z.trim()),
    ["lille", "paris", "lyon", "marseille", "bordeaux", "toulouse"]);
  assert.match(workflow, /- cron: "10 4,10,16,22 \* \* \*"/);
  assert.match(workflow, /fail-fast: false/, "une zone qui échoue n'emporte pas les autres");
});

test("aucune ville n'est nommée dans la fonction", () => {
  // les zones sont des lignes d'une table, jamais des conditions dans le code
  for (const ville of ["lille", "paris", "lyon", "marseille", "bordeaux", "toulouse"])
    assert.doesNotMatch(fonction, new RegExp(ville, "i"));
  assert.match(fonction, /event_areas\?select=/);
});

/* ====================================================================== */
/*  La documentation dit ce que le code fait                              */
/* ====================================================================== */

test("la doc décrit le déploiement sans vérification de JWT et la clé moderne", () => {
  assert.match(doc, /--no-verify-jwt/);
  assert.match(doc, /SUPABASE_SECRET_KEYS/);
  assert.doesNotMatch(doc, /-H "Authorization: Bearer \$SERVICE_KEY"/);
});
