-- SwitchCare Enterprise v11.5 migration
-- Enables real manual document upload through Supabase Storage.
-- Existing data is preserved. No DROP TABLE / TRUNCATE.

alter table if exists public.documents add column if not exists transfer_no text;
create index if not exists idx_documents_transfer_no on public.documents(transfer_no);

-- Allow authenticated operators to create and read document metadata.
drop policy if exists documents_insert_authenticated on public.documents;
create policy documents_insert_authenticated on public.documents for insert to authenticated with check (true);
drop policy if exists documents_update_authenticated on public.documents;
create policy documents_update_authenticated on public.documents for update to authenticated using (true) with check (true);
grant insert, update on public.documents to authenticated;

-- Private bucket for official SwitchCare documents.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('switchcare-documents','switchcare-documents',false,52428800,
  array['application/pdf','image/jpeg','image/png','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update set public=false, file_size_limit=52428800;

drop policy if exists switchcare_documents_read on storage.objects;
create policy switchcare_documents_read on storage.objects
for select to authenticated
using (bucket_id = 'switchcare-documents');

drop policy if exists switchcare_documents_insert on storage.objects;
create policy switchcare_documents_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'switchcare-documents');

drop policy if exists switchcare_documents_update on storage.objects;
create policy switchcare_documents_update on storage.objects
for update to authenticated
using (bucket_id = 'switchcare-documents')
with check (bucket_id = 'switchcare-documents');
