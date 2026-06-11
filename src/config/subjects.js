// src/config/subjects.js — Subject definitions, exam types, and curriculum map
// Immutable config: no business logic, no I/O
// Covers: JAMB/SSCE (secondary) + Post-UTME + University GST + Professional exams

export const EXAM_TYPES = {
  // ─── Secondary ────────────────────────────────────
  JAMB:      { id: 'jamb',      label: 'JAMB/UTME',              compulsorySubject: 'english' },
  SSCE:      { id: 'ssce',      label: 'WAEC/SSCE',               compulsorySubject: 'english' },
  NECO:      { id: 'neco',      label: 'NECO',                     compulsorySubject: 'english' },

  // ─── University ────────────────────────────────────
  POST_UTME: { id: 'post_utme', label: 'Post-UTME / DE Screening', compulsorySubject: 'english' },
  GST:       { id: 'gst',       label: 'University GST (100-Level)', compulsorySubject: 'gst_english' },
  SQUAD:     { id: 'squad',     label: 'Departmental Courses',     compulsorySubject: null },

  // ─── Professional ──────────────────────────────────
  ICAN:      { id: 'ican',      label: 'ICAN (Accounting)',        compulsorySubject: null },
};

export const SUBJECTS = {
  // ═══════════ SECONDARY (JAMB/SSCE/NECO) ═══════════

  english: {
    id: 'english', name: 'English Language', compulsory: true, icon: '📖',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['comprehension','lexis_and_structure','oral_english','summary','essay_writing','sentence_interpretation','antonyms_synonyms','figures_of_speech','register','punctuation_and_spelling'],
  },
  mathematics: {
    id: 'mathematics', name: 'Mathematics', compulsory: false, icon: '🔢',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['algebra','geometry','trigonometry','statistics','probability','number_bases','sets','indices_logarithms','mensuration','coordinate_geometry','calculus','vectors','matrices_determinants','variation','inequalities'],
  },
  physics: {
    id: 'physics', name: 'Physics', compulsory: false, icon: '⚡',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['mechanics','heat_energy','waves','light_optics','electricity_magnetism','modern_physics','nuclear_physics','simple_machines','fluids','sound','gravitational_field','electromagnetic_induction','semiconductors'],
  },
  chemistry: {
    id: 'chemistry', name: 'Chemistry', compulsory: false, icon: '🧪',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['atomic_structure','chemical_bonding','stoichiometry','organic_chemistry','electrochemistry','acids_bases_salts','periodic_table','chemical_kinetics','redox_reactions','metals_and_compounds','environmental_chemistry','industrial_chemistry'],
  },
  biology: {
    id: 'biology', name: 'Biology', compulsory: false, icon: '🧬',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['cell_biology','genetics','ecology','evolution','human_physiology','plant_physiology','microbiology','classification','nutrition','reproduction','nervous_system','excretion','photosynthesis'],
  },
  economics: {
    id: 'economics', name: 'Economics', compulsory: false, icon: '📊',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['demand_supply','market_structures','national_income','money_banking','international_trade','public_finance','inflation','unemployment','economic_systems','factors_of_production','budget','petroleum_economy'],
  },
  government: {
    id: 'government', name: 'Government', compulsory: false, icon: '🏛️',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['constitutional_development','political_systems','arms_of_government','electoral_systems','political_parties','public_administration','federalism','nigeria_foreign_policy','international_organizations','military_rule','pre_colonial_administration','colonial_administration'],
  },
  literature: {
    id: 'literature', name: 'Literature in English', compulsory: false, icon: '📚',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['drama','prose','poetry','literary_terms','literary_appreciation','african_literature','shakespeare','contemporary_authors','literary_devices','figures_of_speech'],
  },
  commerce: {
    id: 'commerce', name: 'Commerce', compulsory: false, icon: '🏪',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['trade','business_organization','marketing','advertising','transport','warehousing','insurance','banking','international_trade','e_commerce','company_law','consumer_protection'],
  },
  accounting: {
    id: 'accounting', name: 'Accounting', compulsory: false, icon: '📒',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['double_entry','trial_balance','final_accounts','depreciation','bank_reconciliation','partnership_accounts','company_accounts','manufacturing_accounts','ratio_analysis','cost_accounting','budgeting','public_sector_accounting'],
  },
  geography: {
    id: 'geography', name: 'Geography', compulsory: false, icon: '🌍',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['physical_geography','human_geography','map_reading','climatology','geomorphology','population_studies','settlement','environmental_hazards','economic_geography','regional_geography_africa','remote_sensing','surveying'],
  },
  crs: {
    id: 'crs', name: 'Christian Religious Studies', compulsory: false, icon: '✝️',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['old_testament','new_testament','church_history','christian_ethics','biblical_interpretation','life_of_christ','pauline_epistles','prophets','christian_worship','social_issues'],
  },
  agric_science: {
    id: 'agric_science', name: 'Agricultural Science', compulsory: false, icon: '🌾',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['crop_production','animal_husbandry','soil_science','agricultural_economics','farm_management','agro_processing','pest_control','irrigation','fisheries','forestry','agricultural_extension','farm_mechanization'],
  },

  // ═══════════ UNIVERSITY GST (100-Level, all students) ═══════════

  gst_english: {
    id: 'gst_english', name: 'GST: Communication in English', compulsory: true, icon: '📖',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['grammar_review','academic_writing','referencing_styles','public_speaking','reading_comprehension','technical_writing','critical_thinking','library_skills','research_methods_basics','oral_presentation'],
  },
  gst_logic: {
    id: 'gst_logic', name: 'GST: Philosophy & Logic', compulsory: false, icon: '🧠',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['deductive_reasoning','inductive_reasoning','fallacies','syllogisms','truth_tables','symbolic_logic','scientific_method','epistemology_basics','argument_analysis','critical_reasoning'],
  },
  gst_nigeria: {
    id: 'gst_nigeria', name: 'GST: Nigerian Peoples & Culture', compulsory: false, icon: '🇳🇬',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['ethnic_groups','pre_colonial_societies','colonial_administration','independence_movement','traditional_politics','cultural_heritage','religious_diversity','contemporary_issues','national_integration','nigerian_constitution_basics'],
  },
  gst_entrepreneurship: {
    id: 'gst_entrepreneurship', name: 'GST: Entrepreneurship', compulsory: false, icon: '💡',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['business_ideas','business_plan','marketing_basics','financial_literacy','legal_structures','funding_sources','risk_management','innovation','social_enterprise','digital_business'],
  },
  gst_computer: {
    id: 'gst_computer', name: 'GST: Computer Appreciation', compulsory: false, icon: '💻',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['computer_hardware','software_basics','operating_systems','ms_office','internet_basics','email_usage','digital_literacy','cybersecurity_basics','data_management','ict_in_society'],
  },
  gst_statistics: {
    id: 'gst_statistics', name: 'GST: Basic Statistics', compulsory: false, icon: '📈',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['descriptive_stats','probability_basics','sampling_methods','data_presentation','measures_central_tendency','measures_dispersion','correlation','regression_basics','hypothesis_testing','statistical_software'],
  },

  // ═══════════ FACULTY COURSES (100L/200L) ═══════════

  // ─── Engineering ────────────────────────────────
  engineering_math: {
    id: 'engineering_math', name: 'Engineering Mathematics', compulsory: false, icon: '🔧',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['differential_equations','linear_algebra','complex_analysis','numerical_methods','laplace_transforms','fourier_series','vector_calculus','partial_differential_equations','probability_engineering','optimisation'],
  },
  thermodynamics: {
    id: 'thermodynamics', name: 'Thermodynamics', compulsory: false, icon: '🔥',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['laws_thermodynamics','heat_engines','entropy','carnot_cycle','rankine_cycle','refrigeration','gas_laws','phase_changes','heat_transfer','energy_conversion'],
  },
  electrical_circuits: {
    id: 'electrical_circuits', name: 'Electrical Circuits', compulsory: false, icon: '⚡',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['ohms_law','kirchhoff_laws','thevenin_norton','ac_circuits','rc_rl_rlc','resonance','three_phase','transformers','semiconductors','operational_amplifiers'],
  },

  // ─── Medicine / Health Sciences ──────────────────
  anatomy: {
    id: 'anatomy', name: 'Human Anatomy', compulsory: false, icon: '🦴',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['skeletal_system','muscular_system','nervous_system','cardiovascular','respiratory_system','digestive_system','urinary_system','reproductive_system','endocrine_system','lymphatic_system'],
  },
  physiology: {
    id: 'physiology', name: 'Human Physiology', compulsory: false, icon: '🫀',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['cell_physiology','blood_physiology','cardiac_physiology','respiratory_physiology','renal_physiology','gastrointestinal','endocrine_physiology','neurophysiology','muscle_physiology','homeostasis'],
  },
  biochemistry: {
    id: 'biochemistry', name: 'Biochemistry', compulsory: false, icon: '🧬',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['carbohydrates','proteins','lipids','enzymes','nucleic_acids','metabolism','vitamins','hormones','molecular_biology','clinical_biochemistry'],
  },

  // ─── Law ────────────────────────────────────────
  constitutional_law: {
    id: 'constitutional_law', name: 'Constitutional Law', compulsory: false, icon: '⚖️',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['fundamental_rights','separation_of_powers','rule_of_law','judicial_review','federalism','legislative_powers','executive_powers','constitutional_interpreation','citizenship','state_of_emergency'],
  },
  nigerian_legal_system: {
    id: 'nigerian_legal_system', name: 'Nigerian Legal System', compulsory: false, icon: '📜',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['sources_of_law','court_hierarchy','judicial_precedent','customary_law','sharia_law','received_english_law','statutory_interpreation','legal_profession','alternative_dispute_resolution','access_to_justice'],
  },

  // ─── Business / Social Sciences ──────────────────
  microeconomics: {
    id: 'microeconomics', name: 'Microeconomics', compulsory: false, icon: '📊',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['consumer_theory','producer_theory','market_equilibrium','elasticity','perfect_competition','monopoly','oligopoly','game_theory','welfare_economics','market_failure'],
  },
  macroeconomics: {
    id: 'macroeconomics', name: 'Macroeconomics', compulsory: false, icon: '🌍',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['gdp_measurement','inflation','unemployment','fiscal_policy','monetary_policy','exchange_rates','balance_of_payments','economic_growth','business_cycles','international_trade_theory'],
  },
  financial_accounting: {
    id: 'financial_accounting', name: 'Financial Accounting', compulsory: false, icon: '📒',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['accounting_framework','double_entry','trial_balance','income_statement','balance_sheet','cash_flow','inventory_valuation','depreciation_methods','ratio_analysis','ifrs_basics'],
  },
  political_science: {
    id: 'political_science', name: 'Introduction to Political Science', compulsory: false, icon: '🏛️',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['political_theory','comparative_politics','international_relations','political_ideologies','democracy','authoritarianism','political_parties','elections','public_policy','global_governance'],
  },
  sociology: {
    id: 'sociology', name: 'Introduction to Sociology', compulsory: false, icon: '👥',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['sociological_theory','social_stratification','culture','socialisation','deviance','family','religion','race_ethnicity','gender','social_change'],
  },

  // ─── Sciences ────────────────────────────────────
  organic_chemistry: {
    id: 'organic_chemistry', name: 'Organic Chemistry', compulsory: false, icon: '🧪',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['hydrocarbons','functional_groups','reaction_mechanisms','stereochemistry','aromatic_compounds','carbonyl_chemistry','amines','spectroscopy','synthesis','polymers'],
  },
  calculus: {
    id: 'calculus', name: 'Advanced Calculus', compulsory: false, icon: '∫',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['limits','differentiation','integration','partial_derivatives','multiple_integrals','differential_equations','sequences_series','taylor_series','vector_calculus','applications'],
  },
  genetics: {
    id: 'genetics', name: 'Genetics', compulsory: false, icon: '🧬',
    allocation: { min: 10, max: 10, weight: 1.0 },
    topics: ['mendelian_genetics','chromosomes','dna_replication','transcription','translation','mutations','genetic_engineering','population_genetics','epigenetics','genomics'],
  },
};

// ─── Subject Presets ──────────────────────────────────

export const SUBJECT_PRESETS = {
  // Secondary
  science:        { label: '🔬 Sciences',              subjects: ['english','mathematics','physics','chemistry','biology'] },
  commercial:     { label: '💼 Commercial',             subjects: ['english','mathematics','economics','commerce','accounting'] },
  arts:           { label: '🎭 Arts',                   subjects: ['english','literature','government','crs'] },
  social_science: { label: '📊 Social Science',         subjects: ['english','mathematics','economics','government','geography'] },

  // University GST
  uni_gst_full:   { label: '🎓 GST (Full — 100L)',     subjects: ['gst_english','gst_logic','gst_nigeria','gst_entrepreneurship','gst_computer','gst_statistics'] },
  uni_gst_core:   { label: '📚 GST (Core Only)',        subjects: ['gst_english','gst_logic','gst_nigeria'] },

  // University — Faculty presets
  uni_medicine:   { label: '🏥 Medicine (Pre-clinical)', subjects: ['anatomy','physiology','biochemistry'] },
  uni_engineering:{ label: '🔧 Engineering (200L)',     subjects: ['engineering_math','thermodynamics','electrical_circuits'] },
  uni_law:        { label: '⚖️ Law (100L)',            subjects: ['constitutional_law','nigerian_legal_system'] },
  uni_business:   { label: '💼 Business/Econ (100L)',   subjects: ['microeconomics','macroeconomics','financial_accounting'] },
  uni_social:     { label: '👥 Social Sciences (100L)', subjects: ['political_science','sociology','macroeconomics'] },
  uni_science:    { label: '🔬 Pure Sciences (200L)',   subjects: ['organic_chemistry','calculus','genetics'] },
};

// Provisional exam-season start dates (update when JAMB/WAEC publish official
// timetables). daysToExam() rolls to the next year automatically once passed.
export const EXAM_TARGET_DATES = {
  jamb: '04-20',       // UTME usually starts late April
  ssce: '05-03',       // WAEC May/June series
  neco: '06-21',       // NECO June/July series
  post_utme: '08-01',
};

export function daysToExam(examId, now = new Date()) {
  const md = EXAM_TARGET_DATES[examId];
  if (!md) return null;
  const [m, d] = md.split('-').map(Number);
  let target = new Date(Date.UTC(now.getUTCFullYear(), m - 1, d));
  if (target < now) target = new Date(Date.UTC(now.getUTCFullYear() + 1, m - 1, d));
  const days = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
  return { days, year: target.getUTCFullYear() };
}

export const DIFFICULTY_MIX = { easy: 0.30, medium: 0.40, hard: 0.30 };
export const QUESTIONS_PER_SUBJECT = 10;
export const TRIAL_DAYS = 2;

export function formatTopic(topic) {
  return topic.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
