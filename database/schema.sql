-- SwitchCare Enterprise v4 / Supabase PostgreSQL
create extension if not exists pgcrypto;

create table if not exists public.switches (
  id uuid primary key default gen_random_uuid(),
  material_no varchar(10) not null check (material_no ~ '^[0-9]{10}$'),
  type text not null,
  taipower_no text not null unique,
  rating_type text not null check (rating_type in ('新品','舊品')),
  warehouse text,
  location text,
  entry_date date not null,
  state text not null default '在庫' check (state in ('在庫','領用中','送檢充電','充電中','停用')),
  cycle_start_date date,
  last_charge_date date,
  next_charge_date date,
  issue_date date,
  return_date date,
  issue_no text,
  transfer_no text,
  send_date date,
  remark text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_switches_state on public.switches(state);
create index if not exists idx_switches_next_charge on public.switches(next_charge_date);
create index if not exists idx_switches_material on public.switches(material_no);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  switch_id uuid references public.switches(id),
  event_at timestamptz not null default now(),
  event_type text not null,
  material_no text,
  taipower_no text,
  document_no text,
  actor_email text,
  note text,
  old_data jsonb,
  new_data jsonb
);
create index if not exists idx_audit_switch on public.audit_log(switch_id);
create index if not exists idx_audit_time on public.audit_log(event_at desc);

create or replace function public.actor_email() returns text
language sql stable as $$ select coalesce(auth.jwt()->>'email','system') $$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists trg_switches_touch on public.switches;
create trigger trg_switches_touch before update on public.switches for each row execute function public.touch_updated_at();

create or replace function public.audit_switch_changes() returns trigger
language plpgsql security definer set search_path=public as $$
declare
  evt text;
  doc text;
  note_text text;
begin
  if tg_op='INSERT' then
    insert into public.audit_log(switch_id,event_type,material_no,taipower_no,actor_email,new_data,note)
    values(new.id,'建立設備',new.material_no,new.taipower_no,public.actor_email(),to_jsonb(new),'建立開關設備');
    return new;
  elsif tg_op='UPDATE' then
    doc:=coalesce(new.transfer_no,new.issue_no);
    if old.state is distinct from new.state then
      if new.state='領用中' then
        evt:='領用'; note_text:='領用後停止充電計時';
      elsif old.state='領用中' and new.state='在庫' then
        evt:='退庫'; note_text:='退庫視同重新入庫，重新起算6個月';
      elsif new.state='送檢充電' then
        evt:='送檢充電'; note_text:='送檢檢修課充電';
      elsif old.state in ('送檢充電','充電中') and new.state='在庫' then
        evt:='充電完成'; note_text:='完成充電並重新起算6個月';
      else
        evt:='狀態變更'; note_text:='狀態由 '||old.state||' 變更為 '||new.state;
      end if;
      insert into public.audit_log(switch_id,event_type,material_no,taipower_no,document_no,actor_email,old_data,new_data,note)
      values(new.id,evt,new.material_no,new.taipower_no,doc,public.actor_email(),to_jsonb(old),to_jsonb(new),note_text);
    else
      insert into public.audit_log(switch_id,event_type,material_no,taipower_no,document_no,actor_email,old_data,new_data,note)
      values(new.id,'資料修改',new.material_no,new.taipower_no,doc,public.actor_email(),to_jsonb(old),to_jsonb(new),'設備主檔修改');
    end if;
    return new;
  end if;
  return old;
end; $$;

drop trigger if exists trg_switches_audit on public.switches;
create trigger trg_switches_audit after insert or update on public.switches for each row execute function public.audit_switch_changes();

-- 領用：停止充電計時，清除下一次充電日。
create or replace function public.issue_switch(p_switch_id uuid,p_event_date date,p_document_no text default null,p_note text default null)
returns void language plpgsql security invoker as $$
begin
  update public.switches set state='領用中',issue_date=p_event_date,issue_no=p_document_no,cycle_start_date=null,next_charge_date=null,transfer_no=null,send_date=null,remark=p_note where id=p_switch_id and state='在庫';
  if not found then raise exception '設備不存在或目前不是在庫狀態'; end if;
end; $$;

-- 退庫：視同重新入庫，退庫日重新起算6個月。
create or replace function public.return_switch(p_switch_id uuid,p_event_date date,p_document_no text default null,p_note text default null)
returns void language plpgsql security invoker as $$
begin
  update public.switches set state='在庫',return_date=p_event_date,cycle_start_date=p_event_date,next_charge_date=(p_event_date + interval '6 months')::date,issue_no=coalesce(p_document_no,issue_no),remark=p_note where id=p_switch_id and state='領用中';
  if not found then raise exception '設備不存在或目前不是領用中狀態'; end if;
end; $$;

create or replace function public.send_switch_for_charge(p_switch_id uuid,p_event_date date,p_transfer_no text,p_note text default null)
returns void language plpgsql security invoker as $$
begin
  update public.switches set state='送檢充電',send_date=p_event_date,transfer_no=p_transfer_no,remark=p_note where id=p_switch_id and state='在庫';
  if not found then raise exception '設備目前不是在庫狀態，無法送檢'; end if;
end; $$;

create or replace function public.complete_switch_charge(p_switch_id uuid,p_event_date date,p_transfer_no text default null,p_note text default null)
returns void language plpgsql security invoker as $$
begin
  update public.switches set state='在庫',last_charge_date=p_event_date,cycle_start_date=p_event_date,next_charge_date=(p_event_date + interval '6 months')::date,transfer_no=null,send_date=null,remark=p_note where id=p_switch_id and state in ('送檢充電','充電中');
  if not found then raise exception '設備目前不是送檢充電或充電中狀態'; end if;
end; $$;

alter table public.switches enable row level security;
alter table public.audit_log enable row level security;

drop policy if exists switches_select_authenticated on public.switches;
create policy switches_select_authenticated on public.switches for select to authenticated using (true);
drop policy if exists switches_insert_authenticated on public.switches;
create policy switches_insert_authenticated on public.switches for insert to authenticated with check (true);
drop policy if exists switches_update_authenticated on public.switches;
create policy switches_update_authenticated on public.switches for update to authenticated using (true) with check (true);
drop policy if exists audit_select_authenticated on public.audit_log;
create policy audit_select_authenticated on public.audit_log for select to authenticated using (true);
revoke delete on public.switches from authenticated;
revoke delete on public.audit_log from authenticated;

-- 讓前端只能呼叫函式／讀取必要資料；函式內部仍由RLS與狀態條件保護。
grant execute on function public.issue_switch(uuid,date,text,text) to authenticated;
grant execute on function public.return_switch(uuid,date,text,text) to authenticated;
grant execute on function public.send_switch_for_charge(uuid,date,text,text) to authenticated;
grant execute on function public.complete_switch_charge(uuid,date,text,text) to authenticated;
