/* LE GENRE N'EST PAS LE FORMAT.

   `concert` dit la forme de la soirée ; `rap`, `pop`, `jazz` disent ce qu'on
   va y entendre. Les deux doivent coexister sur le même événement, sinon
   « Pour toi » ne sait répondre qu'à une des deux questions que les gens se
   posent : « je sors ce soir » et « j'écoute ça ».

   CE QUE CES TESTS PROTÈGENT

   Le vocabulaire déclarait douze genres ; deux seulement étaient posés — `rap`
   et `hip_hop`. Sur les 385 concerts de la base, sept portaient un genre, et
   c'était toujours le même. Rap n'était pas mis en avant : c'était le seul
   genre que la chaîne savait produire, donc le seul qu'un intérêt pouvait
   jamais rencontrer.

   L'autre moitié du travail est de ne pas surcorriger. Un genre faux ne se
   voit pas : il s'installe dans la surveillance de quelqu'un et lui envoie
   pendant des mois des soirées qu'il n'a pas demandées. Les faux positifs
   comptent donc autant que les vrais. */

import assert from "node:assert/strict";
import test from "node:test";
import { enrichirTagsAnnonce } from "../supabase/functions/shared/announcement-tags.mjs";

const tags = (record) => (enrichirTagsAnnonce(record) || {}).tags || [];

/* ==========================================================================
   1. LE CUMUL — un événement porte sa forme ET son genre
   ======================================================================== */

test("un concert de rap porte les deux, et le genre précis avec", () => {
  const t = tags({ title: "Concert de rap — Ninho", description: "le rappeur en live" });
  assert.ok(t.includes("concert"), "la forme");
  assert.ok(t.includes("rap"), "le genre");
});

test("un concert pop n’est plus muet sur son genre", () => {
  /* Le cas qui a motivé tout ceci : il rendait `["concert"]`, et le genre
     retombait dans `music`, qui ne personnalise rien. */
  const t = tags({ title: "Concert pop", description: "soirée pop en live" });
  assert.deepEqual([...t].sort(), ["concert", "pop"]);
});

test("chaque genre du vocabulaire sait enfin se poser", () => {
  const attendus = [
    [{ title: "Concert de jazz au Grand Mix" }, "jazz"],
    [{ title: "Soirée reggae dub" }, "reggae"],
    [{ title: "Concert rock", description: "groupe de rock" }, "rock"],
    [{ title: "Orchestre national — musique classique" }, "classical"],
    [{ title: "Soirée électro techno" }, "electro"],
    [{ title: "Concert R&B", description: "live r&b" }, "rnb"],
    [{ title: "Concert afrobeat" }, "afro"],
    [{ title: "Soirée K-pop" }, "kpop"],
    [{ title: "Soirée musique hip-hop", description: "concert hip hop" }, "hip_hop"],
  ];
  for (const [record, genre] of attendus) {
    assert.ok(tags(record).includes(genre),
      `${genre} devrait être reconnu dans « ${record.title} »`);
  }
});

test("le genre ne se replie jamais sur « music »", () => {
  /* `music` peut accompagner, il ne doit jamais remplacer : c'est lui qui
     faisait disparaître la différence entre une soirée pop et une soirée jazz. */
  const t = tags({ title: "Concert pop", description: "musique pop en live" });
  assert.ok(t.includes("pop"), "le genre survit à la présence du mot « musique »");
});

/* ==========================================================================
   2. LA PREUVE — un champ déclaré vaut mieux qu'une phrase
   ======================================================================== */

test("dans un champ « genres », le mot est la réponse", () => {
  /* Une source qui remplit `genres` a déjà fait le travail : on ne lui demande
     pas de contexte en plus. */
  assert.ok(tags({ title: "Le Grand Mix", genres: ["pop"] }).includes("pop"));
  assert.ok(tags({ title: "Soirée", genres: ["rock"] }).includes("rock"));
});

/* ==========================================================================
   3. LES PIÈGES — ce qui ressemble à un genre sans en être un
   ======================================================================== */

test("« pop » dans pop-up ou pop-corn n’est pas un genre musical", () => {
  assert.ok(!tags({ title: "Pop-up store", description: "boutique éphémère mode" }).includes("pop"));
  assert.ok(!tags({ title: "Pop up store" }).includes("pop"));
});

test("une soupe populaire n’est pas une soirée pop", () => {
  /* `\bpop\b` ne mord pas dans « populaire » — mais le test reste, parce que
     c'est le genre d'erreur qui enverrait une distribution alimentaire dans
     les recommandations de sortie de quelqu'un. */
  assert.ok(!tags({ title: "Soupe populaire", description: "distribution alimentaire" }).includes("pop"));
});

test("un classique du cinéma n’est pas de la musique classique", () => {
  const t = tags({ title: "Projection : un classique du cinéma" });
  assert.ok(!t.includes("classical"), "sans contexte musical, « classique » ne dit rien du genre");
  assert.ok(t.includes("cinema"), "et ce qu’il est vraiment reste reconnu");
});

test("l’électroménager n’a jamais fait danser personne", () => {
  assert.ok(!tags({ title: "Réparation électroménager" }).includes("electro"));
});

test("k-pop ne laisse pas traîner un « pop » orphelin", () => {
  const t = tags({ title: "Soirée K-pop" });
  assert.ok(t.includes("kpop"));
  assert.ok(!t.includes("pop"), "le genre est k-pop, pas pop : deux publics différents");
});

test("ce qui n’est pas musical ne reçoit aucun genre", () => {
  for (const record of [
    { title: "Exposition photo", description: "vernissage" },
    { title: "Braderie de Lille" },
    { title: "Match de football" },
  ]) {
    const genres = tags(record).filter((x) => [
      "rap", "hip_hop", "pop", "rock", "jazz", "electro", "rnb", "afro",
      "reggae", "kpop", "classical",
    ].includes(x));
    assert.deepEqual(genres, [], `« ${record.title} » ne doit porter aucun genre`);
  }
});
