-- Réduit l'association aux animations explicitement rattachées à la Braderie
-- de Lille. Les petites braderies locales restent des événements autonomes.
update public.territorial_contexts
set metadata = metadata || jsonb_build_object(
      'association_terms', jsonb_build_array(
        'braderie de lille',
        'braderie des enfants',
        'pré-braderie',
        'braderie du cours st-so',
        'braderie 2026 au bistrot'
      )
    ),
    updated_at = now()
where slug = 'braderie-lille-2026'
  and major_event_motif_titre = 'braderie de lille';
