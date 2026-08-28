-- Privilèges : ramener anon et authenticated à ce que les policies autorisent.
-- Voir autour/supabase/migrations/20260808120000_privileges_moindre_portee.sql

revoke all on public.favoris from anon;
revoke all on public.favoris from authenticated;
grant select, insert, delete on public.favoris to authenticated;

revoke all on public.event_channels from anon, authenticated;
grant select on public.event_channels to anon, authenticated;

revoke all on public.event_participants from anon, authenticated;
grant select, insert, update, delete on public.event_participants to authenticated;

revoke all on public.event_messages from anon, authenticated;
grant select on public.event_messages to anon, authenticated;
grant insert on public.event_messages to authenticated;

revoke all on public.mobility_datasets from anon, authenticated;
grant select on public.mobility_datasets to anon, authenticated;

revoke all on public.mobility_coverage from anon, authenticated;
grant select on public.mobility_coverage to anon, authenticated;

revoke all on public.mobility_sync_runs from anon, authenticated;

revoke all on public.publications from anon, authenticated;
grant select on public.publications to anon, authenticated;
grant insert, update, delete on public.publications to authenticated;

revoke all on function public.creer_canal_evenement() from public, anon, authenticated;
revoke all on function public.journaliser_modification_evenement() from public, anon, authenticated;
revoke all on function public.mobility_touch_updated_at() from public, anon, authenticated;

revoke all on function public.mes_canaux() from public, anon;
grant execute on function public.mes_canaux() to authenticated;
