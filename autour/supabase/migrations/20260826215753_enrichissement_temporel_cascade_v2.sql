-- Cache de la cascade temporelle : les observations restent lisibles même
-- lorsqu'une affiche et une source structurée se contredisent.
alter table public.place_enrichments
  add column if not exists temporal_data jsonb not null default '{}'::jsonb,
  add column if not exists temporal_observations jsonb not null default '[]'::jsonb,
  add column if not exists temporal_conflicts jsonb not null default '[]'::jsonb;

comment on column public.place_enrichments.temporal_data is
  'Donnée temporelle fusionnée : périodes, jours actifs, heures et provenance par champ.';
comment on column public.place_enrichments.temporal_observations is
  'Toutes les observations structurées, textuelles, poster ou web conservées.';
comment on column public.place_enrichments.temporal_conflicts is
  'Contradictions conservées entre observations temporelles.';
