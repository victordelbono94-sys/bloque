-- Bloque · foto de perfil: la de Google por defecto, o una propia subida a Storage (bucket público "avatares").
alter table public.personas add column if not exists avatar_url text check (avatar_url is null or avatar_url ~ '^https://');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatares', 'avatares', true, 1048576, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

-- Cada uno sube, cambia o borra solo su carpeta (avatares/<su id>/...). Verlas es público.
create policy avatares_ver_propio on storage.objects for select to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatares_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatares_cambiar on storage.objects for update to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatares_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'avatares' and (storage.foldername(name))[1] = auth.uid()::text);

-- Los que ya estaban: la foto de su cuenta de Google. (Las cuentas nuevas la toman desde la app al terminar la bienvenida.)
update public.personas p set avatar_url = coalesce(u.raw_user_meta_data->>'avatar_url', u.raw_user_meta_data->>'picture')
from auth.users u where u.id = p.id and p.avatar_url is null;
