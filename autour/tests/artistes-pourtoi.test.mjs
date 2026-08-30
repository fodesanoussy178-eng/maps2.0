import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {normaliserAnnonce} from "../supabase/functions/shared/annonces.mjs";

const lire = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
new Function("globalThis", lire("../annonces-taxonomie.js"))(globalThis);
new Function("globalThis", lire("../annonces-classement.js"))(globalThis);

test("les tags canoniques alimentent directement Pour toi par format, genre et artiste", () => {
  const maintenant = Date.now();
  const annonce = normaliserAnnonce({title: "Ninho en concert"}, {source: "openagenda"});
  const evenement = {
    id: "evt-ninho",
    title: "Ninho en concert",
    start_at: new Date(maintenant + 48 * 3600 * 1000).toISOString(),
    end_at: new Date(maintenant + 51 * 3600 * 1000).toISOString(),
    date_confidence: "exact",
    primary_source: "openagenda",
    metro_area: "paris",
    importance_level: "important",
    distance_m: 1500,
    ...annonce.fields,
  };
  const taxonomie = globalThis.AutourAnnoncesTaxonomie;
  const classement = globalThis.AutourAnnoncesClassement.classerPourToi([evenement], {
    now: maintenant,
    interests: ["artistes & concerts", "rap", "ninho"],
    distanceFor: () => 1500,
    metroArea: "paris",
    limit: 6,
  });
  assert.equal(classement.length, 1);
  assert.deepEqual(new Set(classement[0].matching_tags), new Set(["concert", "rap", "artist_ninho"]));
  assert.ok(taxonomie.tagsDe(evenement).includes("artist_ninho"));
});
