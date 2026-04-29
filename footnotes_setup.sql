-- Create service_providers table
create table service_providers (
  id text primary key,
  name text not null,
  sort_order int default 0
);

-- Create footnotes table
create table footnotes (
  id text primary key,
  provider_id text references service_providers(id),
  text text not null,
  marker text not null default '',
  is_on boolean default true,
  sort_order int default 0
);

-- Add footnotes_disabled column to apartment_config
alter table apartment_config add column footnotes_disabled jsonb default '[]';

-- Insert service providers
insert into service_providers (id, name, sort_order) values
  ('rsakums', 'Rīgas Siltums', 1),
  ('cleanr', 'Clean R SIA', 2)
on conflict do nothing;

-- Insert initial footnotes
insert into footnotes (id, provider_id, text, marker, is_on, sort_order) values
  ('fn_cirk', 'rsakums', 'Siltumenerģijas cirkulācijas maksa kārtējā mēnesī', '*', true, 1),
  ('fn_atk', 'cleanr', 'Atkritumu izvešana — Clean R SIA', '**', true, 2),
  ('fn_koplel', null, 'Koplietošanas telpu elektrības patēriņš', '***', true, 3)
on conflict do nothing;
