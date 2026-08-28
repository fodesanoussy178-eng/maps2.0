/* L'EMPREINTE DE LA SOURCE, QUE PERSONNE NE STOCKAIT.

   CE QUI NE MARCHAIT PAS, ET DEPUIS QUAND

   Le navigateur calcule `empreinteSource(lieu)` — un condensé de ce qu'il sait
   du lieu : nom, position, horaires, dates, image — et l'envoie à
   `enrichir-lieu` sous `source_fingerprint`. Quand l'enrichissement lui revient,
   il refuse de l'appliquer si l'empreinte stockée ne correspond pas à la
   sienne :

       const compatible = !!e.source_fingerprint &&
                          e.source_fingerprint === empreinteSource(lieu);
       if (!compatible) return false;

   C'est la bonne règle : un horaire vérifié pour un lieu dont la source a
   changé depuis n'est plus une information, c'est un souvenir. Mais la colonne
   n'existait pas. La fonction ne lisait pas le champ, ne l'écrivait pas, et ne
   le relisait pas. `compatible` valait donc TOUJOURS faux, et `appliquer()`
   rendait TOUJOURS `false` : aucun enrichissement n'a jamais été posé sur un
   lieu. Le cache se remplissait, et personne ne s'en servait.

   CE QUE CETTE MIGRATION FAIT, ET RIEN DE PLUS

   Elle ajoute la colonne manquante. Elle est strictement additive : aucune
   donnée n'est lue, réécrite ou supprimée, et la colonne est NULLABLE parce
   que les lignes déjà en base ont été écrites sans empreinte.

   CE QUI ARRIVE AUX ANCIENNES LIGNES

   Rien de brutal. Leur `source_fingerprint` reste NULL, donc `compatible`
   reste faux pour elles, donc le navigateur les redemande — exactement ce
   qu'il fait déjà aujourd'hui pour toutes. La première vérification qui suit
   écrit l'empreinte, et la ligne devient utilisable. La correction se propage
   d'elle-même, sans backfill : on ne peut pas inventer l'empreinte d'une
   source qu'on n'a pas sous les yeux.

   POURQUOI `text` ET PAS UN TYPE PLUS ÉTROIT

   L'empreinte vaut aujourd'hui `v1-xxxxxxxx-xxxxxxxx` — vingt caractères, deux
   hachages FNV du même contenu sérialisé. Le préfixe `v1-` existe pour qu'une
   future règle de calcul puisse cohabiter avec l'ancienne sans migration de
   colonne. Un `text` sans contrainte de longueur laisse cette porte ouverte ;
   un `varchar(20)` la fermerait pour rien. */

alter table public.place_enrichments
  add column if not exists source_fingerprint text;

comment on column public.place_enrichments.source_fingerprint is
  'Empreinte de la source telle que le client la voyait au moment de la demande. '
  'Le client n''applique un enrichissement que si elle correspond encore à la sienne : '
  'NULL signifie « écrit avant que l''empreinte soit conservée », donc à revérifier.';
