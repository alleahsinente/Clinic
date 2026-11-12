alter table public.appointments
  add column if not exists visit_reason text,
  add column if not exists symptoms text[] not null default '{}',
  add column if not exists symptom_duration text,
  add column if not exists symptom_notes text,
  add column if not exists medical_conditions text[] not null default '{}',
  add column if not exists condition_notes text,
  add column if not exists medications text,
  add column if not exists allergies text,
  add column if not exists pregnancy_status text,
  add column if not exists wellbeing text,
  add column if not exists accessibility_needs text[] not null default '{}',
  add column if not exists accessibility_notes text,
  add column if not exists contact_preference text not null default 'no_preference',
  add column if not exists privacy_consent boolean not null default false,
  add column if not exists privacy_consent_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_visit_reason_length_check'
  ) then
    alter table public.appointments
      add constraint appointments_visit_reason_length_check
      check (visit_reason is null or char_length(btrim(visit_reason)) between 2 and 300);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_symptom_notes_length_check'
  ) then
    alter table public.appointments
      add constraint appointments_symptom_notes_length_check
      check (symptom_notes is null or char_length(symptom_notes) <= 1000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_condition_notes_length_check'
  ) then
    alter table public.appointments
      add constraint appointments_condition_notes_length_check
      check (condition_notes is null or char_length(condition_notes) <= 500);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_medications_length_check'
  ) then
    alter table public.appointments
      add constraint appointments_medications_length_check
      check (medications is null or char_length(medications) <= 1000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_allergies_length_check'
  ) then
    alter table public.appointments
      add constraint appointments_allergies_length_check
      check (allergies is null or char_length(allergies) <= 1000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_accessibility_notes_length_check'
  ) then
    alter table public.appointments
      add constraint appointments_accessibility_notes_length_check
      check (accessibility_notes is null or char_length(accessibility_notes) <= 500);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_symptoms_allowed_check'
  ) then
    alter table public.appointments
      add constraint appointments_symptoms_allowed_check
      check (symptoms <@ array[
        'fever', 'cough', 'colds', 'headache', 'severe_chest_pain',
        'heavy_bleeding', 'seizures', 'sudden_weakness', 'stomach_pain',
        'difficulty_breathing', 'body_aches', 'dizziness', 'other'
      ]::text[]);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_symptom_duration_allowed_check'
  ) then
    alter table public.appointments
      add constraint appointments_symptom_duration_allowed_check
      check (symptom_duration is null or symptom_duration in (
        'today', '1_3_days', 'more_than_week', 'more_than_month'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_medical_conditions_allowed_check'
  ) then
    alter table public.appointments
      add constraint appointments_medical_conditions_allowed_check
      check (
        medical_conditions <@ array[
          'hypertension', 'diabetes', 'asthma', 'heart_disease',
          'kidney_disease', 'tb', 'none', 'other'
        ]::text[]
        and (
          not ('none' = any(medical_conditions))
          or cardinality(medical_conditions) = 1
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_pregnancy_status_allowed_check'
  ) then
    alter table public.appointments
      add constraint appointments_pregnancy_status_allowed_check
      check (pregnancy_status is null or pregnancy_status in (
        'yes', 'no', 'unsure', 'prefer_not_to_say'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_wellbeing_allowed_check'
  ) then
    alter table public.appointments
      add constraint appointments_wellbeing_allowed_check
      check (wellbeing is null or wellbeing in (
        'good', 'a_bit_heavy', 'sad_or_anxious', 'prefer_to_talk'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_accessibility_needs_allowed_check'
  ) then
    alter table public.appointments
      add constraint appointments_accessibility_needs_allowed_check
      check (
        accessibility_needs <@ array[
          'wheelchair', 'mobility_assistance', 'seating_assistance',
          'pwd', 'senior', 'other', 'none'
        ]::text[]
        and (
          not ('none' = any(accessibility_needs))
          or cardinality(accessibility_needs) = 1
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.appointments'::regclass
      and conname = 'appointments_contact_preference_allowed_check'
  ) then
    alter table public.appointments
      add constraint appointments_contact_preference_allowed_check
      check (contact_preference in ('no_preference', 'call', 'text'));
  end if;
end;
$$;

create or replace function public.require_appointment_intake_consent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.visit_reason is null
     or char_length(btrim(new.visit_reason)) not between 2 and 300 then
    raise exception 'Please provide the main reason for your visit.';
  end if;

  if new.privacy_consent is distinct from true then
    raise exception 'Privacy consent is required to submit an appointment request.';
  end if;

  new.privacy_consent_at := now();
  return new;
end;
$$;

revoke all on function public.require_appointment_intake_consent() from public, anon, authenticated;

drop trigger if exists appointments_require_intake_consent on public.appointments;
create trigger appointments_require_intake_consent
  before insert on public.appointments
  for each row execute function public.require_appointment_intake_consent();

grant insert (
  student_id, service, appointment_date, time_slot, visit_reason, symptoms,
  symptom_duration, symptom_notes, medical_conditions, condition_notes,
  medications, allergies, pregnancy_status, wellbeing, accessibility_needs,
  accessibility_notes, contact_preference, privacy_consent
)
  on public.appointments to authenticated;
