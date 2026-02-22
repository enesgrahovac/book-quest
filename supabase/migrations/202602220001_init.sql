create extension if not exists pgcrypto;

create table if not exists public.learner_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  education_level text,
  learning_goals text,
  interests text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.learner_preferences (
  learner_id uuid primary key references public.learner_profiles(id) on delete cascade,
  preferred_tutor_character text not null default 'supportive-coach',
  preferred_pace text not null default 'self-paced',
  preferred_assessment_style text not null default 'mixed',
  updated_at timestamptz not null default now()
);

create table if not exists public.learner_markdown_state (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  doc_key text not null check (doc_key in ('SOUL', 'PROFILE', 'PREFERENCES', 'MEMORY', 'TUTOR_PERSONA')),
  content_md text not null,
  version integer not null default 1,
  updated_by text not null default 'system',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (learner_id, doc_key)
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  title text not null,
  description text,
  source_type text not null check (source_type in ('pdf', 'ai_generated')),
  unlock_mode text not null default 'gated',
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_materials (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  material_type text not null check (material_type in ('pdf', 'note', 'external_link')),
  original_filename text,
  storage_path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.learning_units (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  unit_number integer not null,
  title text not null,
  summary text,
  objectives text[] not null default '{}',
  prerequisite_unit_id uuid references public.learning_units(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (course_id, unit_number)
);

create table if not exists public.assessments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  unit_id uuid references public.learning_units(id) on delete set null,
  assessment_kind text not null check (assessment_kind in ('homework', 'quiz', 'midterm', 'final')),
  title text not null,
  total_points integer not null default 100,
  unlock_threshold numeric(5,2) not null default 0.70,
  created_at timestamptz not null default now()
);

create table if not exists public.assessment_questions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  question_order integer not null,
  question_type text not null check (question_type in ('mcq', 'free_form')),
  prompt text not null,
  choices jsonb,
  answer_key jsonb not null,
  concept_tags text[] not null default '{}',
  points integer not null default 1,
  created_at timestamptz not null default now(),
  unique (assessment_id, question_order)
);

create table if not exists public.assessment_submissions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments(id) on delete cascade,
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  status text not null default 'submitted' check (status in ('started', 'submitted', 'graded')),
  score numeric(5,2),
  submitted_at timestamptz,
  graded_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.submission_answers (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.assessment_submissions(id) on delete cascade,
  question_id uuid not null references public.assessment_questions(id) on delete cascade,
  response jsonb not null,
  is_correct boolean,
  feedback text,
  created_at timestamptz not null default now(),
  unique (submission_id, question_id)
);

create table if not exists public.concept_mastery (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  concept text not null,
  mastery_score numeric(5,2) not null default 0,
  evidence_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (learner_id, course_id, concept)
);

create table if not exists public.course_unlocks (
  learner_id uuid not null references public.learner_profiles(id) on delete cascade,
  unit_id uuid not null references public.learning_units(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  reason text not null default 'completed_prerequisite',
  primary key (learner_id, unit_id)
);

alter table public.learner_profiles enable row level security;
alter table public.learner_preferences enable row level security;
alter table public.learner_markdown_state enable row level security;
alter table public.courses enable row level security;
alter table public.course_materials enable row level security;
alter table public.learning_units enable row level security;
alter table public.assessments enable row level security;
alter table public.assessment_questions enable row level security;
alter table public.assessment_submissions enable row level security;
alter table public.submission_answers enable row level security;
alter table public.concept_mastery enable row level security;
alter table public.course_unlocks enable row level security;

create policy "Learner can read own profile"
  on public.learner_profiles
  for select
  using (id = auth.uid());

create policy "Learner can upsert own profile"
  on public.learner_profiles
  for all
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Learner can manage own preferences"
  on public.learner_preferences
  for all
  using (learner_id = auth.uid())
  with check (learner_id = auth.uid());

create policy "Learner can manage own markdown state"
  on public.learner_markdown_state
  for all
  using (learner_id = auth.uid())
  with check (learner_id = auth.uid());

create policy "Learner can manage own courses"
  on public.courses
  for all
  using (learner_id = auth.uid())
  with check (learner_id = auth.uid());

create policy "Learner can manage own submissions"
  on public.assessment_submissions
  for all
  using (learner_id = auth.uid())
  with check (learner_id = auth.uid());

create policy "Learner can see own unlocks"
  on public.course_unlocks
  for all
  using (learner_id = auth.uid())
  with check (learner_id = auth.uid());

create policy "Learner can see own concept mastery"
  on public.concept_mastery
  for all
  using (learner_id = auth.uid())
  with check (learner_id = auth.uid());

create policy "Course-linked records are visible to owner"
  on public.course_materials
  for select
  using (
    exists (
      select 1
      from public.courses c
      where c.id = course_materials.course_id
      and c.learner_id = auth.uid()
    )
  );

create policy "Course-linked records are visible for units"
  on public.learning_units
  for select
  using (
    exists (
      select 1
      from public.courses c
      where c.id = learning_units.course_id
      and c.learner_id = auth.uid()
    )
  );

create policy "Course-linked records are visible for assessments"
  on public.assessments
  for select
  using (
    exists (
      select 1
      from public.courses c
      where c.id = assessments.course_id
      and c.learner_id = auth.uid()
    )
  );

create policy "Question visibility follows assessment ownership"
  on public.assessment_questions
  for select
  using (
    exists (
      select 1
      from public.assessments a
      join public.courses c on c.id = a.course_id
      where a.id = assessment_questions.assessment_id
      and c.learner_id = auth.uid()
    )
  );

create policy "Answers visible to submission owner"
  on public.submission_answers
  for select
  using (
    exists (
      select 1
      from public.assessment_submissions s
      where s.id = submission_answers.submission_id
      and s.learner_id = auth.uid()
    )
  );
