/* MarkLens insights: works out which subject and lesson each question belongs to, and turns the marks lost into a
   ranked plan that wins back the most marks for the least study time. Pure functions with no page access, so the
   same file runs in the browser (window.MarkLensInsights) and in Node for the tests (require('./js/insights.js')). */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MarkLensInsights = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- subjects and lessons ---------- */

  // Subject names as they appear on papers and answer keys
  const SUBJECTS = [
    ['Maths', /^(maths?|mathematics|elementary mathematics)$/i],
    ['Physics', /^physics$/i],
    ['Chemistry', /^chemistry$/i],
    ['Biology', /^(biology|bio|life science)$/i],
    ['Botany', /^botany$/i],
    ['Zoology', /^zoology$/i],
    ['Science', /^(science|general science|evs|environmental studies)$/i],
    ['English', /^english( language| literature| core)?$/i],
    ['Social science', /^(social science|social studies|sst)$/i],
    ['History', /^history$/i],
    ['Geography', /^geography$/i],
    ['Civics', /^(civics|political science|politics)$/i],
    ['Economics', /^economics$/i],
    ['Computer science', /^(computer science|computers?|computer applications|ict|informatics practices|information technology)$/i],
    ['Hindi', /^hindi$/i],
    ['Accountancy', /^(accountancy|accounts)$/i],
    ['Business studies', /^business studies$/i],
    ['Aptitude', /^(aptitude|reasoning|logical reasoning|general aptitude|mental ability)$/i],
    ['General knowledge', /^(general knowledge|gk|current affairs)$/i]
  ];
  // "Physics Section-A", "PHYSICS (Section B)", "Part I: Chemistry" -> "Physics", "Chemistry"
  const bare = s => String(s || '').replace(/\b(section|part|paper)\s*[-–:]?\s*([a-d]|[ivx]{1,3}|\d{1,2})\b/gi, ' ').replace(/[^A-Za-z &]/g, ' ').replace(/\s+/g, ' ').trim();
  function canonSubject(name){
    const b = bare(name);
    if (!b) return '';
    for (const [s, re] of SUBJECTS) if (re.test(b)) return s;
    return '';
  }

  // Lessons, tried in order against chapter headings, #tags and question text. The first match wins, so the more
  // specific patterns of each subject come before the general ones.
  const L = (subject, lesson, re) => ({ subject, lesson, re });
  const LESSONS = [
    // Maths
    L('Maths', 'Trigonometry', /\btrigonometr|\b(?:sin|cos|tan|cosec|sec|cot)(?:\b|(?=\d|\^|²))|heights and distances/i),
    L('Maths', 'Calculus', /\bcalculus|differentiat|\bintegra(?:l|te|tion)\b|\bderivative|\blimits? of|\bcontinuity|\bmaxima|\bminima|\bdy\/dx/i),
    L('Maths', 'Coordinate geometry', /\bcoordinate|\bslope of|\bstraight lines?\b|\bparabola|\bellipse|\bhyperbola|distance formula|section formula/i),
    L('Maths', 'Matrices and vectors', /\bmatri(?:x|ces)|\bdeterminant|\bvectors?\b|three dimensional geometry/i),
    L('Maths', 'Statistics and probability', /\bstatistic|\bprobabilit|\bmedian\b|\bmode\b|\bmean\b|\bvariance|standard deviation|\bhistogram|frequency (?:distribution|table)/i),
    L('Maths', 'Sequences and series', /\bsequences?\b|\bseries\b|\bprogressions?\b|\bA\.?P\.?\b|\bG\.?P\.?\b/),
    L('Maths', 'Permutations and combinations', /\bpermutation|\bcombination(?!\s+reaction)|\bbinomial/i),
    L('Maths', 'Mensuration', /\bmensuration|\barea of|\bperimeter|\bsurface area|\bvolume of|\bcylinder|\bcone\b|\bsphere|\bcuboid|\bhemisphere/i),
    L('Maths', 'Geometry', /\bgeometry|\btriangles?\b|\bcircles?\b|\bangles?\b|\bpolygon|\bcongruen|\bparallel lines|\bquadrilateral|\btheorem|\bconstruction|\bpythagoras/i),
    L('Maths', 'Number systems', /\bnumber systems?|\breal numbers|\birrational|\brational numbers|\bhcf\b|\blcm\b|prime factori/i),
    L('Maths', 'Algebra', /\balgebra|\bsolve\b|\bequations?\b|\bfactori[sz]|\bexpand\b|\bpolynomial|\bquadratic|\bsimplif|\binequalit|\bexpressions?\b|\bsets? and|\bvenn/i),
    // Physics
    L('Physics', 'Units and measurement', /\bunits and measurement|\bdimensional|significant figures|errors? in measurement/i),
    L('Physics', 'Semiconductors', /\bsemiconductor|\bdiodes?\b|\btransistor|\blogic gates?|p-?n junction|\brectifier/i),
    L('Physics', 'Modern physics', /\bphotoelectric|\bdual nature|\bde broglie|\batoms and nuclei|\bnuclear\b|\bnucleus\b|\bradioactiv|\bhalf[- ]life|\bx-?rays?\b|\bphotons?\b/i),
    L('Physics', 'Electrostatics', /\belectrostatic|electric (?:field|charges?|potential|flux|dipole)|\bcoulomb|\bcapacit|\bgauss/i),
    L('Physics', 'Magnetism and induction', /\bmagnet|\bbiot|\bsolenoid|\blorentz|electromagnetic induction|\blenz|\binductance|\binductor|alternating current|\btransformer/i),
    L('Physics', 'Current electricity', /\bcurrent electricity|\belectricity|electric current|\bcurrents?\b|\bvoltage|\bresistan|\bresistor|\bohm|\bcircuit|\bkirchhoff|\bpotentiometer|\bwheatstone|\bemf\b|internal resistance/i),
    L('Physics', 'Optics', /\boptics|\bincidence|\blight\b|\blens(?:es)?\b|\bmirrors?\b|\brefracti|\breflecti|\bprism|\binterference|\bdiffraction|\bpolari[sz]ation|double slit|focal length/i),
    L('Physics', 'Oscillations and waves', /\boscillation|simple harmonic|\bshm\b|\bpendulum|\bwaves?\b|\bsound\b|\bdoppler|\bresonance/i),
    L('Physics', 'Gravitation', /\bgravitation|\bgravity|\borbital|escape velocity|\bsatellite|\bkepler/i),
    L('Physics', 'Rotational motion', /\brotational|\btorque|moment of inertia|angular momentum|cent(?:re|er) of mass|\brolling/i),
    L('Physics', 'Thermal physics', /\bthermodynamics|\bheat\b|\btemperature|\bthermal|\bcalorimetr|kinetic theory|specific heat|\bcarnot/i),
    L('Physics', 'Properties of matter', /\belasticity|young'?s modulus|\bviscosity|surface tension|\bfluids?\b|\bbernoulli|\bbuoyan/i),
    L('Physics', 'Work, energy and power', /\bwork,? energy|kinetic energy|potential energy|\bpower\b|\bcollision|work done/i),
    L('Physics', 'Laws of motion', /laws of motion|\bmechanics|\bnewton|\bforces?\b|\bfriction|\bmomentum|\bimpulse/i),
    L('Physics', 'Motion', /\bkinematics|motion in a|\bvelocity|\bacceleration|\bdisplacement|\bprojectile|\bspeed\b/i),
    // Chemistry
    L('Chemistry', 'Mole concept', /mole concept|\bmoles?\b|molar mass|\bstoichiometr|\bavogadro|empirical formula|\bmolarity|some basic concepts/i),
    L('Chemistry', 'Atomic structure', /atomic structure|structure of (?:the )?atom|electronic configuration|quantum numbers?|\borbitals?\b|\bisotopes?/i),
    L('Chemistry', 'Periodic table', /\bperiodic|ioni[sz]ation (?:energy|enthalpy)|\belectronegativity|atomic radi/i),
    L('Chemistry', 'Chemical bonding', /chemical bond|\bbonding|\bcovalent|ionic bond|\bhybridi[sz]ation|\bvsepr|molecular orbital|hydrogen bond/i),
    L('Chemistry', 'Inorganic chemistry', /\binorganic|\b[pdfs]-block|coordination compounds?|transition elements?|\blanthan|\bactin|noble gas|\bhalogen/i),
    L('Chemistry', 'Organic chemistry', /\borganic|\bhydrocarbon|\balkanes?|\balkenes?|\balkynes?|\bbenzene|\baromatic|\balcohols?|\bphenols?|\bethers?\b|\baldehydes?|\bketones?|\bcarboxylic|\bamines?\b|\bhaloalkane|\bhaloarene|\bisomer|\biupac|functional group|\bpolymer|carbon and its compounds/i),
    L('Chemistry', 'Physical chemistry', /physical chemistry/i),
    L('Chemistry', 'Thermochemistry', /\benthalpy|\bentropy|\bgibbs|hess'?s law|\bthermochemi|chemical thermodynamics/i),
    L('Chemistry', 'Equilibrium', /\bequilibrium|le chatelier|\bpH\b|\bbuffer|solubility product/i),
    L('Chemistry', 'Redox and electrochemistry', /\bredox|\boxidation|\breduction\b|\belectrochem|\belectrolysis|\belectrode|\bgalvanic|\bnernst|\bcorrosion/i),
    L('Chemistry', 'Chemical kinetics', /chemical kinetics|rate of (?:a )?reaction|rate constant|order of (?:a )?reaction|activation energy/i),
    L('Chemistry', 'Solutions', /\bcolligative|\braoult|\bosmo(?:sis|tic)|\bmolality|vapou?r pressure|solutions and/i),
    L('Chemistry', 'States of matter', /states of matter|gas laws?|ideal gas|\bboyle|charles'?s? law/i),
    L('Chemistry', 'Acids, bases and salts', /\bacids?\b|\balkali|\bneutrali[sz]|\bindicator|\blitmus|\bacidic|basic salt/i),
    L('Chemistry', 'Metals and non-metals', /\bnon-?metals?|\bmetals?\b|\bmetallurgy|\bores?\b|\balloys?|reactivity series/i),
    L('Chemistry', 'Chemical reactions', /chemical reactions?|chemical equations?|displacement reaction|decomposition|combination reaction|\bprecipitat/i),
    // Biology
    L('Biology', 'Biotechnology', /\bbiotechnolog|\brecombinant|\bpcr\b|\bcloning|genetic engineering/i),
    L('Biology', 'Genetics and evolution', /\bgenetic|\bgenes?\b|\binheritance|\bmendel|\bdna\b|\brna\b|\bchromosom|\bheredity|\bevolution|\bmutation|\balleles?/i),
    L('Biology', 'Cell biology', /\bcells?\b|cell cycle|\bmitosis|\bmeiosis|\borganelle|\bmitochondri|\bchloroplast|cell division/i),
    L('Biology', 'Biomolecules', /\benzymes?|\bproteins?|\bcarbohydrates?|\blipids?|nucleic acids?|\bbiomolecule/i),
    L('Biology', 'Plant physiology', /plant physiology|\bphotosynthesis|\btranspiration|plant growth|plant hormones?|\bauxin|mineral nutrition|\bstomata|\bxylem|\bphloem/i),
    L('Biology', 'Reproduction', /\breproduct|\bgametes?|\bfertili[sz]ation|\bembryo|\bmenstrua|\bpollination|\bcontracept/i),
    L('Biology', 'Human physiology', /human physiology|\bdigesti|\brespiration|\bbreathing|\bheart\b|\bblood\b|\bcirculat|\bexcret|\bkidney|\bneural|\bnervous|\bbrain\b|\bhormones?|\bendocrine|\bmuscles?|\blocomotion|\bskeleton/i),
    L('Biology', 'Ecology', /\becolog|\becosystem|food (?:chain|web)|\bpopulation|\bbiodiversity|\benvironment|\bpollution/i),
    L('Biology', 'Health and disease', /\bdiseases?\b|\bimmun|\bvaccin|\bpathogen|\bmalaria|\bantibod|\bmicrobes/i),
    L('Biology', 'Plant structure', /morphology|anatomy of flowering|\bflowers?\b|\bseeds?\b|\bfruits?\b|\broots?\b|\bstems?\b|\bleaves\b|\bleaf\b/i),
    L('Biology', 'Diversity of life', /\bclassification|\bkingdom|\btaxonomy|\borganisms?|living world|\bbacteria|\bfungi|\bvirus/i),
    // English
    L('English', 'Writing', /\bwriting\b|\bessay|\bletter\b|\bcomposition|\barticle writing|\bnotice\b|\bdiary entry|\bspeech\b|write a (?:story|paragraph|report|letter|article)/i),
    L('English', 'Reading', /\breading\b|\bcomprehension|\bunseen passage|read the (?:passage|extract)/i),
    L('English', 'Literature', /\bpoem|\bpoet\b|\bpoetry|\bstanza|\bnovel\b|\bprose\b|\bdrama\b|\bliterature/i),
    L('English', 'Grammar', /\bgrammar|\btenses?\b|\bpunctuat|\bsynonym|\bantonym|passive voice|active voice|reported speech|\bpreposition|parts of speech|\bclauses?\b/i),
    // Social science
    L('History', 'History', /\brevolution|\bnationalism|\bcolonial|freedom struggle|\bempire\b|world war/i),
    L('Geography', 'Geography', /\bclimate|\bsoils?\b|\bagriculture|\blatitude|\blongitude|\bmonsoon|natural vegetation/i),
    L('Civics', 'Civics', /\bdemocracy|\bconstitution|\bparliament|\belections?\b|fundamental rights/i),
    L('Economics', 'Economics', /\beconomy|\bgdp\b|\bglobali[sz]ation|\binflation|\bdemand and supply|money and credit/i)
  ];
  // prefer: the paper's subject, so "angle" in a Physics paper is looked up among Physics lessons before Maths ones
  function lessonFor(text, prefer){
    const t = String(text || '');
    if (!t.trim()) return null;
    if (prefer) for (const x of LESSONS) if ((x.subject === prefer || sameFamily(x.subject, prefer)) && x.re.test(t)) return { subject: x.subject, lesson: x.lesson };
    for (const x of LESSONS) if (x.re.test(t)) return { subject: x.subject, lesson: x.lesson };
    return null;
  }
  const subjectFor = name => canonSubject(name) || (lessonFor(name) || {}).subject || '';
  const tidyName = s => String(s || '').replace(/\s+/g, ' ').replace(/^[\s:\-–]+|[\s:\-–]+$/g, '').slice(0, 60);

  // items: [{ subject: from a "Subject:" line, heading: the section or chapter heading, tag: a #tag, text: question text }]
  // returns [{ subject, lesson }] in the same order. A heading that names a subject sets the subject; any other heading
  // or tag is the lesson, and its subject comes from the lesson list. Questions whose subject is still unknown take the
  // paper's main subject, so a one-subject paper split into Algebra and Geometry is all Maths.
  function classify(items){
    const first = items.map(it => {
      const said = tidyName(it.subject), headSubj = canonSubject(it.heading), headLesson = headSubj ? '' : tidyName(it.heading), tag = tidyName(it.tag);
      return { headLesson, tag, subject: canonSubject(said) || said || headSubj || subjectFor(tag) || subjectFor(headLesson) };
    });
    const votes = new Map(), vote = s => votes.set(s, (votes.get(s) || 0) + 1);
    first.forEach(f => { if (f.subject) vote(f.subject); });
    if (!votes.size) items.forEach(it => { const g = lessonFor(it.text); if (g) vote(g.subject); });
    const main = ([...votes].sort((a, b) => b[1] - a[1])[0] || [''])[0];
    return items.map((it, i) => {
      const f = first[i], guess = lessonFor(it.text, f.subject || main);
      const subject = f.subject || (!f.tag && !f.headLesson && guess ? guess.subject : '') || main;
      const lesson = f.tag || f.headLesson || (guess && (guess.subject === subject || sameFamily(guess.subject, subject)) ? guess.lesson : '') || 'General';
      return { subject, lesson };
    });
  }
  // Botany and Zoology are Biology; Physics, Chemistry and Biology are Science; History and Geography are Social science
  const FAMILY = { Botany: 'Biology', Zoology: 'Biology', Physics: 'Science', Chemistry: 'Science', Biology: 'Science', History: 'Social science', Geography: 'Social science', Civics: 'Social science', Economics: 'Social science' };
  const sameFamily = (a, b) => FAMILY[a] === b || FAMILY[b] === a || (FAMILY[a] && FAMILY[a] === FAMILY[b] && FAMILY[a] !== 'Science');

  /* ---------- causes: how fast lost marks come back ---------- */

  // kind: habit = an exam habit that can be fixed before the next test; study = needs the lesson learned again.
  // ease: the share of these lost marks a student typically wins back after working on it (an estimate).
  // base + per: rough study hours: a fixed start-up cost, plus time for each lost mark.
  const CAUSE_INFO = {
    'Concept gap':              { kind: 'study', ease: 0.6,  base: 1.5,  per: 0.2 },
    'Wrong option':             { kind: 'study', ease: 0.5,  base: 1,    per: 0.08 },
    'Incomplete / unattempted': { kind: 'study', ease: 0.6,  base: 1,    per: 0.12 },
    'Unspecified':              { kind: 'study', ease: 0.5,  base: 1,    per: 0.12 },
    'Careless / calculation':   { kind: 'habit', ease: 0.8,  base: 0.5,  per: 0.05 },
    'Units & signs':            { kind: 'habit', ease: 0.9,  base: 0.25, per: 0.02 },
    'Presentation':             { kind: 'habit', ease: 0.8,  base: 0.25, per: 0.02 },
    'Time management':          { kind: 'habit', ease: 0.6,  base: 1,    per: 0.05 },
    'Bubbling error':           { kind: 'habit', ease: 0.95, base: 0.1,  per: 0 }
  };
  const info = c => CAUSE_INFO[c] || CAUSE_INFO.Unspecified;
  const HABIT_TITLE = {
    'Careless / calculation': 'Careless slips',
    'Units & signs': 'Units and signs',
    'Presentation': 'Presentation',
    'Time management': 'Running out of time',
    'Bubbling error': 'Bubbling mistakes'
  };
  const FIX = {
    'Concept gap': 'Re-learn the idea before doing more questions: summarise the topic in your own words, work three solved examples line by line, then try similar questions without notes.',
    'Careless / calculation': 'Slow down on the last step. Write one operation per line and keep five minutes at the end to re-check arithmetic and copied numbers.',
    'Incomplete / unattempted': 'Write partial working. Step marks are usually awarded even without a final answer. Practise timed attempts and never leave a question blank.',
    'Units & signs': 'Keep a unit and sign checklist. Write units on every line and circle negative signs when expanding or moving terms.',
    'Presentation': 'Label diagrams, state the formula before substituting, and underline final answers so every mark can be awarded.',
    'Time management': 'Budget time per mark (about 1.5 minutes each), take the easy marks first, and practise full papers under a timer.',
    'Wrong option': 'Go back to the concept behind each wrong question, then practise similar MCQs. When unsure, rule options out before choosing; on a paper with negative marking, skip a question you cannot narrow to two options.',
    'Bubbling error': 'Fill exactly one bubble per question, completely. Rub a changed answer out fully: a half-erased mark can count as a second answer.',
    'Unspecified': 'Compare these answers with the marking scheme to find where each mark went, then tag the reason in the table.'
  };
  const qLabel = q => /^\d/.test(String(q)) ? 'Q' + q : String(q);
  const list = qs => { const a = qs.map(qLabel); return a.length <= 6 ? a.join(', ') : a.slice(0, 5).join(', ') + ` and ${a.length - 5} more`; };
  function studyFix(lesson, subject, cause, qs, omr){
    const where = lesson === 'General' ? (subject ? `${subject}` : 'these questions') : lesson;
    const n = qs.length;
    switch (cause) {
      case 'Concept gap': return `Re-learn ${where} from your notes or textbook, work three solved examples line by line, then redo ${list(qs)} without help.`;
      case 'Wrong option': return `Revise ${where}, then practise 20 to 30 MCQs on it and read the solution of every one you get wrong. Redo ${list(qs)} last.`;
      case 'Incomplete / unattempted': return omr
        ? `You left ${n} ${n === 1 ? 'question' : 'questions'} in ${where} blank. Revise it until you can attempt questions like ${list(qs)}.`
        : `Practise ${where} questions under a timer and write every step; step marks count even without the final answer. Start with ${list(qs)}.`;
      default: return `Compare ${list(qs)} with the marking scheme to find what went wrong, then practise ${where} questions of the same kind.`;
    }
  }

  /* ---------- the analysis ---------- */

  const round = (n, s = 0.5) => Math.round(n / s) * s;
  const r1 = n => Math.round(n * 10) / 10;
  // status of one question, for the question map: full, part, zero, blank, wrong (OMR), multi (OMR, more than one bubble)
  function statusOf(r){
    if (!(r.max > 0)) return 'none';
    if (r.got >= r.max) return 'full';
    if (r.cause === 'Bubbling error') return 'multi';
    if (r.cause === 'Wrong option') return 'wrong';
    if (r.got > 0) return 'part';
    if (r.cause === 'Incomplete / unattempted') return 'blank';
    return 'zero';
  }
  const lostOf = r => Math.max(0, r.max - r.got);
  const causeOf = r => (r.cause && r.cause !== 'None') ? r.cause : 'Unspecified';

  // rows: [{ q, subject, topic (the lesson), max, got, cause }]. opts.omr marks a multiple-choice test.
  function analyze(rows, opts = {}){
    const R = rows.filter(r => r.max > 0).map(r => ({ ...r, subject: String(r.subject || '').trim(), lesson: String(r.topic || 'General').trim() || 'General' }));
    const total = R.reduce((a, r) => ({ got: a.got + r.got, max: a.max + r.max }), { got: 0, max: 0 });
    total.lost = total.max - total.got; total.pct = total.max ? total.got / total.max * 100 : 0;
    const counts = { n: R.length, full: 0, part: 0, zero: 0, blank: 0, wrong: 0, multi: 0 };
    R.forEach(r => { const s = statusOf(r); if (s in counts) counts[s]++; });

    // subjects and their lessons
    const subj = new Map();
    for (const r of R) {
      const s = subj.get(r.subject) || { name: r.subject, got: 0, max: 0, gain: 0, lessons: new Map() };
      const l = s.lessons.get(r.lesson) || { name: r.lesson, subject: r.subject, got: 0, max: 0, gain: 0, causes: {}, qs: [] };
      const lost = lostOf(r), c = causeOf(r);
      s.got += r.got; s.max += r.max; l.got += r.got; l.max += r.max;
      if (lost > 0) { l.causes[c] = (l.causes[c] || 0) + lost; l.qs.push(r.q); l.gain += lost * info(c).ease; s.gain += lost * info(c).ease; }
      s.lessons.set(r.lesson, l); subj.set(r.subject, s);
    }
    const fin = g => ({ ...g, lost: g.max - g.got, pct: g.max ? g.got / g.max * 100 : 0, gain: r1(g.gain) });
    const subjects = [...subj.values()].map(s => ({ ...fin(s), lessons: [...s.lessons.values()].map(fin).sort((a, b) => a.pct - b.pct || b.lost - a.lost) }))
      .sort((a, b) => b.gain - a.gain || a.pct - b.pct);

    // plan items: every lost mark belongs to exactly one item. Habit causes are grouped across the paper (one habit
    // fixes them everywhere); study causes are grouped by subject and lesson.
    const items = new Map();
    for (const r of R) {
      const lost = lostOf(r); if (lost <= 0) continue;
      const c = causeOf(r), inf = info(c);
      const id = inf.kind === 'habit' ? 'habit:' + c : 'study:' + JSON.stringify([r.subject, r.lesson]);   // safe in an HTML attribute
      const it = items.get(id) || { id, kind: inf.kind, subject: inf.kind === 'habit' ? '' : r.subject, lesson: inf.kind === 'habit' ? '' : r.lesson, causes: {}, lost: 0, gain: 0, qs: [], where: new Set() };
      it.causes[c] = (it.causes[c] || 0) + lost; it.lost += lost; it.gain += lost * inf.ease; it.qs.push(r.q);
      if (r.lesson !== 'General') it.where.add(r.lesson); else if (r.subject) it.where.add(r.subject);
      items.set(id, it);
    }
    const plan = [...items.values()].map(it => {
      const cs = Object.entries(it.causes).sort((a, b) => b[1] - a[1]), main = cs[0][0];
      const hours = Math.max(...cs.map(([c]) => info(c).base)) + cs.reduce((a, [c, l]) => a + info(c).per * l, 0);
      const title = it.kind === 'habit' ? HABIT_TITLE[main] || main : (it.lesson === 'General' ? (it.subject || 'Questions without a lesson') : it.lesson);
      const fix = it.kind === 'habit' ? FIX[main] : studyFix(it.lesson, it.subject, main, it.qs, !!opts.omr);
      return { id: it.id, kind: it.kind, title, subject: it.subject, lesson: it.lesson, cause: main, causes: cs.map(([name, lost]) => ({ name, lost })), lost: it.lost, gain: r1(it.gain), hours: Math.max(0.25, round(hours, 0.25)), rate: it.gain / hours, qs: it.qs, where: [...it.where], fix, noLessons: it.kind === 'study' && it.lesson === 'General' };
    }).filter(p => p.gain >= 0.25).sort((a, b) => b.rate - a.rate || b.gain - a.gain);

    // causes, split into habits and study
    const cm = new Map();
    for (const r of R) { const lost = lostOf(r); if (lost <= 0) continue; const c = causeOf(r); const x = cm.get(c) || { name: c, kind: info(c).kind, lost: 0, qs: [] }; x.lost += lost; x.qs.push(r.q); cm.set(c, x); }
    const causes = [...cm.values()].sort((a, b) => b.lost - a.lost);

    const reachAll = Math.min(total.max, total.got + plan.reduce((a, p) => a + p.gain, 0));
    return { total, counts, subjects, plan, causes, reachAll, split: timeSplit(subjects), quick: plan.find(p => p.kind === 'habit') || null };
  }

  // How to share the next 10 hours of revision: by subject when the paper has several, else by lesson. Time follows the
  // marks within reach; rounded to half hours that add up to 10.
  function timeSplit(subjects, total = 10){
    const multi = subjects.filter(s => s.gain > 0).length > 1;
    let parts = multi ? subjects.map(s => ({ name: s.name || 'Other', subject: s.name, gain: s.gain }))
      : (subjects[0] ? subjects[0].lessons.map(l => ({ name: l.name, subject: subjects[0].name, gain: l.gain })) : []);
    parts = parts.filter(p => p.gain > 0).sort((a, b) => b.gain - a.gain);
    if (parts.length > 5) { const rest = parts.slice(4); parts = parts.slice(0, 4).concat([{ name: 'Everything else', subject: '', gain: rest.reduce((a, p) => a + p.gain, 0), rest: true }]); }
    const sum = parts.reduce((a, p) => a + p.gain, 0);
    if (!sum) return { by: multi ? 'subject' : 'lesson', parts: [] };
    const steps = total * 2, raw = parts.map(p => p.gain / sum * steps), fl = raw.map(Math.floor);
    let left = steps - fl.reduce((a, b) => a + b, 0);
    raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } });
    return { by: multi ? 'subject' : 'lesson', parts: parts.map((p, i) => ({ ...p, hours: fl[i] / 2 })).filter(p => p.hours > 0) };
  }

  /* ---------- my papers: progress over several tests ---------- */

  function snapshot(rows, meta = {}){
    const a = analyze(rows, meta);
    return {
      id: meta.id || 'p' + Date.now().toString(36),
      at: meta.at || new Date().toISOString(),
      name: tidyName(meta.name) || 'Paper',
      mode: meta.mode || 'marked',
      got: r1(a.total.got), max: r1(a.total.max),
      subjects: a.subjects.map(s => ({ name: s.name, got: r1(s.got), max: r1(s.max), gain: s.gain, lessons: s.lessons.map(l => ({ name: l.name, got: r1(l.got), max: r1(l.max), gain: l.gain })) }))
    };
  }
  // Across saved papers: which subjects and lessons keep costing marks
  function acrossPapers(papers){
    const P = [...papers].sort((a, b) => String(a.at).localeCompare(String(b.at)));
    const subj = new Map(), less = new Map();
    for (const p of P) for (const s of p.subjects || []) {
      const x = subj.get(s.name) || { name: s.name, got: 0, max: 0, gain: 0, papers: 0, trend: [] };
      x.got += s.got; x.max += s.max; x.gain += s.gain || 0; x.papers++; x.trend.push({ at: p.at, pct: s.max ? s.got / s.max * 100 : 0 });
      subj.set(s.name, x);
      for (const l of s.lessons || []) {
        if (l.name === 'General') continue;
        const k = s.name + '\u0000' + l.name, y = less.get(k) || { name: l.name, subject: s.name, got: 0, max: 0, papers: 0 };
        y.got += l.got; y.max += l.max; y.papers++; less.set(k, y);
      }
    }
    const fin = g => ({ ...g, lost: r1(g.max - g.got), pct: g.max ? g.got / g.max * 100 : 0 });
    return {
      papers: P.map(p => ({ id: p.id, at: p.at, name: p.name, got: p.got, max: p.max, pct: p.max ? p.got / p.max * 100 : 0 })),
      subjects: [...subj.values()].map(fin).sort((a, b) => b.lost - a.lost),
      lessons: [...less.values()].map(fin).filter(l => l.papers > 1 && l.lost > 0).sort((a, b) => a.pct - b.pct).slice(0, 5)
    };
  }

  return { SUBJECTS, LESSONS, CAUSE_INFO, FIX, HABIT_TITLE, canonSubject, lessonFor, subjectFor, classify, statusOf, analyze, timeSplit, snapshot, acrossPapers, qLabel };
});
