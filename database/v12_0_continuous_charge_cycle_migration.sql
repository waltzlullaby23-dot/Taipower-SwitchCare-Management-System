-- SwitchCare v12.0: continuous six-month charging cycle during internal issue.
-- Non-destructive: preserves existing equipment, usage, charge and audit history.
begin;

-- Restore the active cycle for currently issued devices affected by the old pause rule.
-- Completed historical cycles are not modified.
with latest_paused as (
  select distinct on (switch_id) id, switch_id, start_date, due_date, cycle_no
  from public.charge_records
  where status = '因領用中止'
  order by switch_id, cycle_no desc
)
update public.switches s
set cycle_start_date = coalesce(s.cycle_start_date, p.start_date),
    next_charge_date = coalesce(s.next_charge_date, p.due_date)
from latest_paused p
where s.id = p.switch_id and s.state = '領用中';

with latest_paused as (
  select distinct on (switch_id) id, switch_id
  from public.charge_records
  where status = '因領用中止'
  order by switch_id, cycle_no desc
)
update public.charge_records c
set status = '待充電',
    note = concat_ws('；', nullif(c.note,''), '規則修正：領用期間充電週期持續計算')
from latest_paused p
join public.switches s on s.id = p.switch_id
where c.id = p.id and s.state = '領用中';

-- Fallback for legacy issued devices whose cycle dates were cleared and had no usable charge row.
update public.switches s
set cycle_start_date = coalesce(s.cycle_start_date,s.last_charge_date,s.entry_date),
    next_charge_date = coalesce(
      s.next_charge_date,
      (coalesce(s.last_charge_date,s.cycle_start_date,s.entry_date)+interval '6 months')::date
    )
where s.state='領用中' and s.next_charge_date is null;

-- Ensure every currently issued device has one active pending cycle row.
insert into public.charge_records(switch_id,cycle_no,start_date,due_date,status,note)
select s.id,
       coalesce((select max(c.cycle_no)+1 from public.charge_records c where c.switch_id=s.id),1),
       coalesce(s.cycle_start_date,s.last_charge_date,s.entry_date),
       s.next_charge_date,
       '待充電',
       'v12.0規則修復：領用期間充電週期持續計算'
from public.switches s
where s.state='領用中'
  and s.next_charge_date is not null
  and not exists (
    select 1 from public.charge_records c
    where c.switch_id=s.id and c.status='待充電'
  );

create or replace function public.issue_switch_with_recipient(
 p_switch_id uuid,p_event_date date,p_document_no text,p_note text,p_recipient_unit text
)
returns void language plpgsql security definer set search_path=public as $$
declare v_old public.switches; v_new public.switches;
begin
 select * into v_old from public.switches where id=p_switch_id for update;
 if not found then raise exception '設備不存在'; end if;
 if v_old.state<>'在庫' then raise exception '目前不是在庫狀態，無法領用'; end if;
 if p_event_date is null or p_event_date>current_date then raise exception '領用日期不可空白或晚於今天'; end if;
 update public.switches
 set state='領用中',issue_date=p_event_date,issue_no=p_document_no,
     send_date=null,transfer_no=null,active_usage_note=p_note,
     active_recipient_unit=nullif(trim(p_recipient_unit),'')
 where id=p_switch_id returning * into v_new;
 insert into public.usage_records(
   switch_id,issue_date,issue_no,status,note,event_kind,recipient_unit
 ) values(p_switch_id,p_event_date,p_document_no,'領用中',p_note,'領用',nullif(trim(p_recipient_unit),''));
 perform public.log_event(v_new,'領用',p_document_no,
   coalesce(p_note,'領用期間充電週期持續計算'),to_jsonb(v_old),to_jsonb(v_new));
end; $$;

create or replace function public.issue_switch(
 p_switch_id uuid,p_event_date date,p_document_no text default null,p_note text default null
)
returns void language plpgsql security definer set search_path=public as $$
declare v_old public.switches; v_new public.switches;
begin
 select * into v_old from public.switches where id=p_switch_id for update;
 if not found then raise exception '設備不存在'; end if;
 if v_old.state<>'在庫' then raise exception '目前不是在庫狀態，無法領用'; end if;
 if p_event_date is null or p_event_date>current_date then raise exception '領用日期不可空白或晚於今天'; end if;
 update public.switches
 set state='領用中',issue_date=p_event_date,issue_no=p_document_no,
     send_date=null,transfer_no=null,remark=p_note
 where id=p_switch_id returning * into v_new;
 insert into public.usage_records(switch_id,issue_date,issue_no,status,note,event_kind)
 values(p_switch_id,p_event_date,p_document_no,'領用中',p_note,'領用');
 perform public.log_event(v_new,'領用',p_document_no,
   coalesce(p_note,'領用期間充電週期持續計算'),to_jsonb(v_old),to_jsonb(v_new));
end; $$;

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
     issue_no=coalesce(p_document_no,issue_no),send_date=null,transfer_no=null,remark=p_note
 where id=p_switch_id returning * into v_new;

 select * into v_usage from public.usage_records
 where switch_id=p_switch_id and status='領用中'
   and coalesce(event_kind,'領用')='領用'
 order by issue_date desc limit 1 for update;
 if found then
   update public.usage_records set return_date=p_event_date,status='已退庫',note=coalesce(p_note,note)
   where id=v_usage.id;
 else
   insert into public.usage_records(switch_id,issue_date,issue_no,return_date,status,note,event_kind)
   values(p_switch_id,coalesce(v_old.issue_date,p_event_date),v_old.issue_no,p_event_date,
     '已退庫','找不到對應領用紀錄，系統補建歷史紀錄','領用');
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

revoke all on function public.issue_switch_with_recipient(uuid,date,text,text,text) from public;
revoke all on function public.issue_switch_with_recipient(uuid,date,text,text,text) from anon;
revoke all on function public.issue_switch(uuid,date,text,text) from public;
revoke all on function public.issue_switch(uuid,date,text,text) from anon;
revoke all on function public.return_switch(uuid,date,text,text) from public;
revoke all on function public.return_switch(uuid,date,text,text) from anon;
grant execute on function public.issue_switch_with_recipient(uuid,date,text,text,text) to authenticated;
grant execute on function public.issue_switch(uuid,date,text,text) to authenticated;
grant execute on function public.return_switch(uuid,date,text,text) to authenticated;

commit;
notify pgrst, 'reload schema';
