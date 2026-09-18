-- ---------------------------------------------------------------------------
-- LOT 8 · 2 — LE LEXIQUE SOLIDAIRE
--
-- SEIZE TERMES, ET CE QU'ILS DÉMONTRENT
--
-- Sur dix-sept termes transmis, seize se vérifient par des sources publiques
-- et structurées — FINESS, SIRENE, textes réglementaires, sites d'association.
-- ZÉRO n'a nécessité un modèle. Le travail utile ici n'était pas d'ajouter de
-- l'intelligence : c'était d'écrire seize phrases en français clair, et de
-- savoir dire « je ne sais pas » pour le dix-septième.
--
-- CETTE TABLE DÉCRIT DES TYPES, PAS DES ÉTABLISSEMENTS. Elle ne contient
-- aucune adresse, aucun horaire, aucun numéro local. Une fiche réelle hérite
-- d'ici, puis est relue une par une (B.6.4) : ce qui est vrai de tous les CHRS
-- n'est pas forcément vrai de celui de la rue d'à côté.
--
-- LE MÊME TEXTE VIT DANS `autour/data/aide-solidarite-lexique.js`, parce que
-- le navigateur en a besoin sans base. Deux copies d'une même vérité
-- divergent toujours — sauf si quelque chose les compare :
-- `tests/solidarite-lexique.test.mjs` régénère ce bloc et refuse la moindre
-- différence.
-- ---------------------------------------------------------------------------

create table if not exists public.solidarite_lexique (
  terme              text primary key,
  nom                text not null,
  sous_type          text not null references public.place_sous_types(sous_type),
  -- Une à deux phrases, écrites pour un lecteur. Jamais un résumé de source.
  quoi_concretement  text not null
                     check (char_length(btrim(quoi_concretement)) between 20 and 400),
  -- NUL VEUT DIRE « À ÉTABLIR À LA RELECTURE », et c'est une information.
  -- On ne remplit ce champ que lorsque la porte d'entrée découle du
  -- dispositif lui-même : le 115 pour un CHRS partout en France, contre
  -- l'organisation locale d'un CCAS.
  mode_acces         text check (mode_acces in ('libre','rendez_vous','orientation','telephone')),
  cout               text check (cout in ('gratuit','participation','payant')),
  -- Nul n'est pas « non » : on ne promet pas l'anonymat à la place de qui
  -- ne l'a pas promis.
  anonymat           boolean,
  public_vise        text[] not null default '{}'::text[],
  telephone_cle      text,
  -- Faux = publier une adresse pour ce terme met des gens en danger, ou
  -- envoie quelqu'un devant un bureau qui ne reçoit pas.
  adresse_publiable  boolean not null default true,
  -- Vrai = ce nom désigne aussi un organisme qui gère d'autres lieux.
  aussi_gestionnaire boolean not null default false,
  a_confirmer        text,
  sources            text[] not null default '{}'::text[]
);

comment on table public.solidarite_lexique is
  'Seize termes solidaires traduits en français ordinaire. Décrit des types de structures, jamais des établissements.';
comment on column public.solidarite_lexique.mode_acces is
  'Rempli seulement quand la porte d''entrée est structurelle (le 115 pour un CHRS). Nul = à établir à la relecture.';
comment on column public.solidarite_lexique.adresse_publiable is
  'Faux pour SOLFA et la CMAO : une adresse de mise à l''abri met en danger, une adresse de coordination fait perdre un trajet.';

insert into public.solidarite_lexique
  (terme, nom, sous_type, quoi_concretement, mode_acces, cout, anonymat,
   public_vise, telephone_cle, adresse_publiable, aussi_gestionnaire,
   a_confirmer, sources)
values
  ('CCAS / CIAS',
   'Centre communal (ou intercommunal) d''action sociale',
   'action_sociale_generale',
   'Le guichet social de votre commune : aide financière d''urgence, domiciliation quand on n''a pas d''adresse, et accompagnement pour les démarches et l''accès aux droits.',
   null,
   'gratuit',
   false,
   array['habitants de la commune'],
   null,
   true,
   false,
   null,
   array['code de l''action sociale et des familles, art. L123-4 et suivants', 'data·inclusion']),
  ('FJT / MAJT',
   'Foyer de jeunes travailleurs',
   'logement_jeunes',
   'Un logement meublé pour les jeunes qui travaillent, sont en apprentissage ou en études, avec une redevance mensuelle et une équipe sur place. On y entre sur dossier, pas en se présentant.',
   'rendez_vous',
   'payant',
   false,
   array['16-30 ans', 'apprentis', 'jeunes actifs', 'étudiants'],
   null,
   true,
   false,
   'développement du sigle MAJT, à vérifier localement',
   array['FINESS catégorie 257 (foyer de jeunes travailleurs)', 'UNHAJ']),
  ('Maison des adolescents',
   'Maison des adolescents',
   'accueil_jeunes',
   'Un lieu gratuit où un adolescent — ou son parent — peut parler de santé, de mal-être, d''école ou de famille, et rencontrer un psychologue, un médecin ou un éducateur sans passer par un médecin traitant.',
   null,
   'gratuit',
   null,
   array['11-25 ans', 'parents', 'familles'],
   null,
   true,
   false,
   null,
   array['Association nationale des maisons des adolescents', 'data·inclusion']),
  ('PAEJ',
   'Point accueil écoute jeunes',
   'accueil_jeunes',
   'On y parle à un psychologue ou à un éducateur sans rendez-vous, gratuitement, et sans avoir à donner son nom. Souvent ouvert aussi aux parents.',
   'libre',
   'gratuit',
   true,
   array['12-25 ans', 'parents'],
   null,
   true,
   false,
   null,
   array['cahier des charges national PAEJ (DGCS)', 'data·inclusion']),
  ('CMP',
   'Centre médico-psychologique',
   'sante_mentale',
   'Consultations psychiatriques et psychologiques du service public, prises en charge sans avance de frais. Le CMP dont vous dépendez est celui de votre adresse : ce n''est pas au choix, et il faut appeler pour un premier rendez-vous.',
   'rendez_vous',
   'gratuit',
   false,
   array['adultes', 'enfants et adolescents selon le centre'],
   null,
   true,
   false,
   null,
   array['FINESS catégorie 156 (centre médico-psychologique)', 'sectorisation psychiatrique, code de la santé publique']),
  ('EPSM',
   'Établissement public de santé mentale',
   'sante_mentale',
   'L''hôpital public de psychiatrie du secteur. Il gère le plus souvent les CMP alentour : pour une première consultation, c''est au CMP qu''on s''adresse, pas à l''hôpital.',
   'orientation',
   'gratuit',
   false,
   array['adultes', 'enfants et adolescents selon l''établissement'],
   null,
   true,
   true,
   null,
   array['FINESS catégorie 930 (centre hospitalier spécialisé en psychiatrie)']),
  ('Espaces écoute santé',
   'Espace d''écoute psychologique de proximité',
   'sante_mentale',
   'Quelques séances avec un psychologue, près de chez soi, le plus souvent organisées par la commune. Ce qui est proposé et pour qui change d''une commune à l''autre.',
   null,
   null,
   null,
   '{}'::text[],
   null,
   true,
   false,
   'existence, nom exact et conditions, commune par commune',
   array['dispositifs municipaux, sans cadre national']),
  ('CHRS',
   'Centre d''hébergement et de réinsertion sociale',
   'hebergement_urgence',
   'Hébergement et accompagnement social pour des personnes sans logement. On n''y entre pas en se présentant à l''adresse : l''orientation passe par le 115 ou par un travailleur social.',
   'telephone',
   'gratuit',
   false,
   array['adultes', 'familles selon le centre'],
   '115',
   true,
   false,
   null,
   array['FINESS catégorie 214 (CHRS)', 'code de l''action sociale et des familles, art. L345-1']),
  ('CMAO',
   'Coordination mobile d''accueil et d''orientation',
   'hebergement_urgence',
   'C''est elle qui organise, dans le Nord, l''orientation des personnes sans abri vers un hébergement. On la joint par le 115 : ce n''est pas un lieu où se rendre.',
   'telephone',
   'gratuit',
   false,
   array['personnes sans abri'],
   '115',
   false,
   false,
   null,
   array['dispositif départemental du Nord, SIAO/115']),
  ('ABEJ Solidarité',
   'ABEJ Solidarité',
   'aide_materielle',
   'Association lilloise pour les personnes sans abri : accueil de jour où se poser, se laver et manger, consultations de santé, et hébergement. Plusieurs lieux, chacun avec ses propres horaires.',
   null,
   'gratuit',
   null,
   array['personnes sans abri', 'adultes'],
   null,
   true,
   true,
   null,
   array['abej-solidarite.fr', 'data·inclusion']),
  ('Croix-Rouge française',
   'Croix-Rouge française',
   'aide_materielle',
   'Aide alimentaire, vestiboutique où l''on s''habille à petit prix, épiceries sociales et formation aux premiers secours. Chaque unité locale décide de ce qu''elle ouvre, pour qui et quand.',
   null,
   null,
   false,
   '{}'::text[],
   null,
   true,
   true,
   null,
   array['croix-rouge.fr', 'data·inclusion']),
  ('Les Fabuleuses',
   'Les Fabuleuses',
   'aide_materielle',
   'À Lille, pour les femmes en grande précarité : maraudes, vestiaire, produits d''hygiène et entretiens individuels. Le local se visite sur rendez-vous.',
   'rendez_vous',
   'gratuit',
   null,
   array['femmes', 'femmes en grande précarité'],
   null,
   true,
   false,
   null,
   array['lesfabuleuses.net']),
  ('SOLFA',
   'Solidarité femmes accueil',
   'violences_femmes',
   'Écoute et accompagnement des femmes victimes de violences : démarches, droits, protection. On publie la permanence d''accueil de jour et le 3919, jamais une adresse de mise à l''abri.',
   'telephone',
   'gratuit',
   true,
   array['femmes victimes de violences'],
   '3919',
   false,
   true,
   null,
   array['3919 — Violences Femmes Info', 'solfa-asso.fr']),
  ('Horizon 9',
   'Horizon 9',
   'accueil_jeunes',
   'Des éducateurs de rue qui vont à la rencontre des 12-25 ans et de leurs familles à Roubaix, Hem et Wattrelos. On ne pousse pas une porte : ce sont eux qui viennent, et on peut les appeler.',
   null,
   'gratuit',
   null,
   array['12-25 ans', 'familles'],
   null,
   true,
   false,
   null,
   array['FINESS 590050811', 'SIRENE 509 224 465 00013']),
  ('ALEFPA',
   'Association laïque pour l''éducation, la formation, la prévention et l''autonomie',
   'gestionnaire',
   'Une association qui gère des dizaines d''établissements sociaux et médico-sociaux. Ce n''est pas un lieu où l''on se rend : cherchez l''établissement, pas le siège.',
   null,
   null,
   null,
   '{}'::text[],
   null,
   true,
   true,
   null,
   array['alefpa.asso.fr', 'FINESS — personne morale gestionnaire']),
  ('La Sauvegarde du Nord',
   'La Sauvegarde du Nord',
   'gestionnaire',
   'Une association qui gère de nombreux établissements du département : protection de l''enfance, addictions, santé, médiation. On entre dans l''un de ses établissements, pas dans l''association.',
   null,
   null,
   null,
   '{}'::text[],
   null,
   true,
   true,
   null,
   array['lasauvegardedunord.fr', 'FINESS — personne morale gestionnaire'])
on conflict (terme) do update set
  nom = excluded.nom, sous_type = excluded.sous_type,
  quoi_concretement = excluded.quoi_concretement, mode_acces = excluded.mode_acces,
  cout = excluded.cout, anonymat = excluded.anonymat,
  public_vise = excluded.public_vise, telephone_cle = excluded.telephone_cle,
  adresse_publiable = excluded.adresse_publiable,
  aussi_gestionnaire = excluded.aussi_gestionnaire,
  a_confirmer = excluded.a_confirmer, sources = excluded.sources;

-- B.6.1 et B.6.2, écrites une deuxième fois ici : le lexique est ce dont
-- héritent les fiches, donc c'est ici que la règle doit être infalsifiable.
alter table public.solidarite_lexique
  drop constraint if exists solidarite_lexique_mise_a_l_abri_sans_adresse;
alter table public.solidarite_lexique
  add constraint solidarite_lexique_mise_a_l_abri_sans_adresse check (
    sous_type <> 'violences_femmes' or adresse_publiable = false
  );

alter table public.solidarite_lexique
  drop constraint if exists solidarite_lexique_urgence_par_le_115;
alter table public.solidarite_lexique
  add constraint solidarite_lexique_urgence_par_le_115 check (
    sous_type <> 'hebergement_urgence'
    or (telephone_cle = '115' and mode_acces in ('telephone','orientation'))
  );

alter table public.solidarite_lexique enable row level security;
drop policy if exists "lexique solidaire: lecture publique" on public.solidarite_lexique;
create policy "lexique solidaire: lecture publique" on public.solidarite_lexique
  for select to anon, authenticated using (true);
revoke all on public.solidarite_lexique from anon, authenticated;
grant select on public.solidarite_lexique to anon, authenticated;
grant all on public.solidarite_lexique to service_role;


-- ---------------------------------------------------------------------------
-- CE QUI RESTE INCONNU, ET QUI EST ÉCRIT POUR QUE LA QUESTION REVIENNE
--
-- `ALORE` a été transmis avec les seize autres. Aucune source fiable ne l'a
-- confirmé. Il n'obtient ni sous-type, ni phrase : un sigle développé au
-- jugé devient une fiche fausse, et une fiche fausse dans ce domaine envoie
-- quelqu'un quelque part pour rien. Cette table existe pour qu'on ne le
-- « redécouvre » pas dans six mois comme une nouveauté.
-- ---------------------------------------------------------------------------
create table if not exists public.solidarite_termes_inconnus (
  terme      text primary key,
  raison     text not null,
  action     text not null,
  signale_le date not null default current_date
);

comment on table public.solidarite_termes_inconnus is
  'Les termes transmis qu''aucune source n''a confirmés. Un inconnu assumé vaut mieux qu''une fiche inventée.';

insert into public.solidarite_termes_inconnus (terme, raison, action) values
  ('ALORE',
   'aucune source fiable trouvée : ni FINESS, ni SIRENE, ni site d''association',
   'confirmer auprès de la personne qui a transmis la liste')
on conflict (terme) do nothing;

alter table public.solidarite_termes_inconnus enable row level security;
revoke all on public.solidarite_termes_inconnus from anon, authenticated;
grant all on public.solidarite_termes_inconnus to service_role;
