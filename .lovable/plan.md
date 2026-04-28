Ich habe die Ursache gefunden: Die Gruppe wird tatsächlich angelegt. Danach navigiert die App korrekt auf `/dashboard/groups/dream-100-querino`, aber der Detail-Query in `useGroup()` sucht gleichzeitig nach `id.eq.dream-100-querino` und `slug.eq.dream-100-querino`.

Da `id` eine UUID-Spalte ist, wirft Supabase bei einem Slug wie `dream-100-querino` den Fehler:

```text
invalid input syntax for type uuid: "dream-100-querino"
```

Dadurch kommt im UI kein Group-Datensatz an und die Seite zeigt fälschlich „Group not found“.

## Plan

1. `src/hooks/useGroups.ts` reparieren
   - `useGroup(idOrSlug)` so ändern, dass es vor dem Query prüft, ob der Wert eine UUID ist.
   - Wenn UUID: Query nach `id`.
   - Wenn kein UUID: Query nach `slug`.
   - Dadurch wird kein `id.eq.<slug>` mehr an Supabase geschickt.

2. Query-Cache konsistent halten
   - Nach dem Anlegen und Aktualisieren einer Gruppe weiterhin beide Cache-Keys invalidieren: `group.id` und `group.slug`.
   - Optional zusätzlich den aktuellen Detail-Key sauber treffen, damit die Detailseite sofort die richtige Gruppe lädt.

3. Verhalten nach Create prüfen
   - Neue Gruppe anlegen.
   - Erwartung: Navigation zu `/dashboard/groups/<slug>` zeigt direkt die Group-Detailseite statt „Group not found“.
   - Zusätzlich prüfen: direkte URL mit UUID funktioniert weiterhin, falls andere Stellen intern IDs verwenden.

## Technische Änderung

Die zentrale Änderung ist klein und risikoarm:

```ts
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const query = supabase
  .from("contact_groups")
  .select("*")
  .eq("user_id", user!.id);

const { data, error } = isUuid(idOrSlug)
  ? await query.eq("id", idOrSlug).maybeSingle()
  : await query.eq("slug", idOrSlug).maybeSingle();
```

Keine Migration, keine Schema-Änderung nötig.