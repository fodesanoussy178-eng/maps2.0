-- ---------------------------------------------------------------------------
-- `evenements_majeurs` : retirer aussi MAINTAIN
--
-- `20260905115107_rls_tables_reference.sql` a révoqué INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES et TRIGGER, en croyant laisser SELECT seul.
-- `information_schema.role_table_grants` le confirmait — mais cette vue ne
-- connaît pas MAINTAIN, le privilège apparu en PostgreSQL 17. Seul `relacl`
-- le montrait : `anon=rm/postgres`, où le `m` restait.
--
-- MAINTAIN ne modifie aucune ligne, mais il autorise VACUUM, ANALYZE, CLUSTER,
-- REINDEX et LOCK TABLE. Sur une table de sept lignes le dégât tient à la
-- disponibilité, pas à l'intégrité — cela reste un droit que personne n'a de
-- raison d'avoir. Les quatre autres tables n'étaient pas concernées : elles
-- ont reçu `revoke all privileges`, qui couvre MAINTAIN.
--
-- Après cette migration : `anon=r/postgres`, SELECT et rien d'autre.
-- ---------------------------------------------------------------------------

revoke maintain on public.evenements_majeurs from anon, authenticated;
