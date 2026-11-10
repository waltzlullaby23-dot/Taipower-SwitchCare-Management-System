-- SwitchCare v12.1: separate receipt document number from issue document number.
-- Non-destructive migration: add one nullable column, add an index, replace one RPC.
begin;

alter table public.usage_records
  add column if not exists return_document_no text;

create index if not exists idx_usage_records_return_document_no
  on public.usage_records(return_document_no);

create or replace function public.return_switch(
 p_switch_id uuid,p_event_date date,p_document_no text default null,p_note text default null
)
returns void language plpgsql security definer set search_path=public as $$
declare
 v_old public.switches; v_new public.switches; v_usage public.usage_records;
 v_charge public.charge_records; v_cycle integer; v_start date; v_next date;
begin
 select * into v_old from public.switches where id=p_switch_id for update;
 if not found then raise exception '設備不存在'; end if;
 if v_old.state<>'領用中' then raise exception '目前不是領用中狀態，無法退庫'; end if;
 if p_event_date is null or p_event_date>current_date then raise exception '退庫日期不可空白或晚於今天'; end if;
 if v_old.issue_date is not null and p_event_date<v_old.issue_date then raise exception '退庫日期不可早於領用日期'; end if;

 select * into v_charge from public.charge_records
 where switch_id=p_switch_id order by cycle_no desc limit 1 for update;
 v_start := coalesce(v_old.cycle_start_date,v_charge.start_date,v_old.last_charge_date,v_old.entry_date);
 v_next := coalesce(v_old.next_charge_date,v_charge.due_date,
   (coalesce(v_old.last_charge_date,v_start)+interval '6 months')::date);
 if v_next is null then raise exception '無法判定原充電週期，請先檢查設備主檔及充電履歷'; end if;

 update public.switches
 set state='在庫',return_date=p_event_date,cycle_start_date=v_start,next_charge_date=v_next,
     send_date=null,transfer_no=null
 where id=p_switch_id returning * into v_new;

 select * into v_usage from public.usage_records
 where switch_id=p_switch_id and status='領用中'
   and coalesce(event_kind,'領用')='領用'
 order by issue_date desc limit 1 for update;
 if found then
   update public.usage_records
   set return_date=p_event_date,status='已退庫',
       return_document_no=nullif(trim(p_document_no),''),
       note=coalesce(p_note,note)
   where id=v_usage.id;
 else
   insert into public.usage_records(
     switch_id,issue_date,issue_no,return_date,return_document_no,status,note,event_kind
   ) values(
     p_switch_id,coalesce(v_old.issue_date,p_event_date),v_old.issue_no,p_event_date,
     nullif(trim(p_document_no),''),'已退庫',
     '找不到對應領用紀錄，系統補建歷史紀錄','領用'
   );
 end if;

 select * into v_charge from public.charge_records
 where switch_id=p_switch_id order by cycle_no desc limit 1 for update;
 if found and v_charge.status in ('因領用中止','待充電') then
   update public.charge_records
   set status='待充電',start_date=coalesce(start_date,v_start),due_date=coalesce(due_date,v_next),
       note=concat_ws('；',nullif(note,''),'退庫後沿用原充電週期')
   where id=v_charge.id;
 else
   select coalesce(max(cycle_no),0)+1 into v_cycle from public.charge_records where switch_id=p_switch_id;
   insert into public.charge_records(switch_id,cycle_no,start_date,due_date,status,note)
   values(p_switch_id,v_cycle,v_start,v_next,'待充電','退庫後沿用原充電週期（未重設到期日）');
 end if;

 perform public.log_event(v_new,'退庫',p_document_no,
   '退庫後沿用原充電週期；下次充電日不因領用或退庫而延後',
   to_jsonb(v_old),to_jsonb(v_new));
end; $$;

revoke all on function public.return_switch(uuid,date,text,text) from public;
revoke all on function public.return_switch(uuid,date,text,text) from anon;
grant execute on function public.return_switch(uuid,date,text,text) to authenticated;

comment on column public.usage_records.issue_no is
  '本處發料／領用單號；退庫時不得覆寫';
comment on column public.usage_records.return_document_no is
  '本處收料／用餘退回單號，與 issue_no 分開保存';

commit;
notify pgrst, 'reload schema';
