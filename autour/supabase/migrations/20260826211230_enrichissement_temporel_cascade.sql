alter table public.place_enrichments
  add column if not exists temporal_data jsonb not null default '{}'::jsonb,
  add column if not exists temporal_observations jsonb not null default '[]'::jsonb,
  add column if not exists temporal_conflicts jsonb not null default '[]'::jsonb;

comment on column public.place_enrichments.temporal_data is
  'Temporalité normalisée utilisée par Maintenant : périodes, jours actifs et horaires, avec provenance gagnante dans provenance.';
comment on column public.place_enrichments.temporal_observations is
  'Toutes les observations temporelles conservées, y compris les sources moins prioritaires et les contradictions.';
comment on column public.place_enrichments.temporal_conflicts is
  'Contradictions à rang de source équivalent ; elles rendent le champ incertain au lieu de choisir arbitrairement.';
