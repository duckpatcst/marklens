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
    ['English', /^english( language| literature| core| comprehension| language and comprehension)?$/i],
    ['Social science', /^(social science|social studies|sst)$/i],
    ['History', /^history$/i],
    ['Geography', /^geography$/i],
    ['Civics', /^(civics|political science|politics)$/i],
    ['Economics', /^economics$/i],
    ['Computer science', /^(computer science|computers?|computer applications|ict|informatics practices|information technology)$/i],
    ['Hindi', /^hindi$/i],
    ['Accountancy', /^(accountancy|accounts)$/i],
    ['Business studies', /^business studies$/i],
    ['Reasoning', /^(reasoning|reasoning ability|logical reasoning|general intelligence( (and|&) reasoning)?|mental ability)$/i],
    ['Quantitative aptitude', /^(quantitative aptitude|quant|quantitative ability|numerical ability|mathematical abilit(y|ies)|data interpretation)$/i],
    ['Aptitude', /^(aptitude|general aptitude)$/i],
    ['General awareness', /^(general awareness|general knowledge|gk|current affairs|general studies|gs)$/i]
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
    L('Biology', 'Genetics and evolution', /\bgenetic|\bgenes?\b|\binheritance|\bmendel|\bdna\b|\brna\b|\bchromosom|\bheredity|\bevolution|\bmutation|\balleles?|\bmonohybrid|\bdihybrid|\bphenotyp|\bgenotyp/i),
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
  // Topics inside each lesson, tried in order against the question's own words, so a weak lesson can be narrowed down to
  // the topic that cost the marks ("Optics" -> "Lenses"). Lessons named in other ways ("Ray optics and optical
  // instruments") are matched to these through the lesson list.
  const T = (name, re) => [name, re];
  const TOPICS = {
    // Maths
    'Trigonometry': [T('Heights and distances', /heights? and distances?|angle of (?:elevation|depression)|\btower\b|\bshadow\b/i), T('Inverse trigonometry', /\binverse trig|\b(?:sin|cos|tan)\s*(?:\^\s*\(?\s*-\s*1|⁻¹|-1\b)|\barc(?:sin|cos|tan)/i),
      T('Trigonometric identities', /\bidentit|prove that|sin\s*\^?\s*2|sin²|cos\s*\^?\s*2|cos²|sec\s*\^?\s*2/i), T('Trigonometric equations', /general solution|principal solution/i), T('Trigonometric ratios', /\bratios?\b|value of|\b(?:sin|cos|tan)\s*\d/i)],
    'Calculus': [T('Differential equations', /differential equation|order and degree/i), T('Area under curves', /area (?:under|bounded|enclosed|between)/i), T('Definite integrals', /definite integral|\bintegral\b.*\bfrom\b/i),
      T('Integration', /\bintegra/i), T('Applications of derivatives', /\bmaxim|\bminim|increasing|decreasing|\btangent|\bnormal\b|rate of change|approximat/i), T('Continuity and differentiability', /continu|differentiab/i),
      T('Limits', /\blimits?\b|\blim\b/i), T('Differentiation', /differentiat|derivative|dy\/dx/i)],
    'Coordinate geometry': [T('Conic sections', /parabola|ellipse|hyperbola|conic/i), T('Circles', /\bcircle/i), T('Straight lines', /straight lines?|\bslope|equation of (?:a |the )?line|intercept/i), T('Distance and section formula', /distance|section formula|mid-?point|collinear|area of (?:a |the )?triangle/i)],
    'Matrices and vectors': [T('Determinants', /determinant|cramer/i), T('Matrices', /matri(?:x|ces)/i), T('3D geometry', /three dimensional|\b3-?d\b|direction (?:cosines|ratios)|\bplanes?\b/i), T('Vectors', /vector|dot product|cross product|scalar product/i)],
    'Statistics and probability': [T('Probability', /probabilit|\bdice?\b|\bcoins?\b|\bcards?\b|\bbag\b|at random/i), T('Dispersion', /variance|standard deviation|mean deviation|dispersion/i),
      T('Graphs of data', /histogram|bar (?:chart|graph)|ogive|pie (?:chart|diagram)|frequency polygon/i), T('Mean, median and mode', /\bmean\b|\bmedian\b|\bmode\b|average/i)],
    'Sequences and series': [T('Geometric progressions', /geometric|\bG\.?P\.?\b/), T('Arithmetic progressions', /arithmetic|\bA\.?P\.?\b|\bn(?:th|-th) term|common difference/i)],
    'Permutations and combinations': [T('Binomial theorem', /binomial/i), T('Permutations', /permutation|arrange/i), T('Combinations', /combination|choose|select|committee/i)],
    'Mensuration': [T('Surface area and volume', /surface area|volume|cylinder|\bcone\b|sphere|cuboid|\bcube\b|hemisphere|frustum/i), T('Areas of plane figures', /area|perimeter|sector|segment|circumference/i)],
    'Geometry': [T('Constructions', /construct/i), T('Circles', /\bcircles?\b|\btangents?\b|\bchords?\b|\barcs?\b|cyclic/i), T('Triangles', /triangle|pythagoras|similar|congruen|\bbpt\b|basic proportionality/i),
      T('Quadrilaterals', /quadrilateral|parallelogram|rhombus|trapezium|rectangle|square/i), T('Lines and angles', /parallel lines|transversal|\bangles?\b|\blines?\b/i)],
    'Number systems': [T('Rational and irrational numbers', /irrational|rational|decimal expansion|surd/i), T('HCF, LCM and primes', /\bhcf\b|\blcm\b|\bprime|euclid|factori[sz]ation/i)],
    'Algebra': [T('Complex numbers', /complex numbers?|\biota\b|argand|\bmodulus|\bconjugate/i), T('Polynomials', /polynomial|\bzeroe?s\b|factori[sz]|remainder theorem/i),
      T('Quadratic equations', /quadratic|discriminant|nature of (?:the )?roots|x\s*\^\s*2|x²/i), T('Linear equations', /linear equations?|pair of (?:linear )?equations|simultaneous|\bsolve\b[^.]*=/i),
      T('Inequalities', /inequalit/i), T('Sets, relations and functions', /\bsets?\b|venn|\brelations?\b|\bfunctions?\b|\bdomain\b|\brange\b/i), T('Logarithms and exponents', /logarithm|\blog\b|exponent|\bindices\b|\bpowers?\b/i)],
    // Physics
    'Optics': [T('Wave optics', /interference|young|double slit|diffraction|polari[sz]|coherent|fringe/i), T('Optical instruments', /microscope|telescope|human eye|\beye\b|myopia|hypermetropia|presbyopia|magnifying power/i),
      T('Prism and dispersion', /\bprism|dispersion|deviation|spectrum|rainbow|scattering/i), T('Mirrors', /\bmirror/i), T('Lenses', /\blens|focal length|\bpower of|lens maker/i),
      T('Refraction', /refracti|snell|total internal reflection|critical angle|apparent depth/i), T('Mirrors', /reflection/i)],
    'Current electricity': [T('Kirchhoff\'s laws and circuits', /kirchhoff|\bnetwork|wheatstone|meter bridge|metre bridge|potentiometer|series and parallel|combination of resist/i), T('Cells and emf', /\bemf\b|internal resistance|\bcells?\b/i),
      T('Heating effect and power', /heating|\bpower\b|joule|\bkwh\b|electric energy|energy consumed|\bwatt/i), T('Ohm\'s law and resistance', /\bohm|resistan|resistivity|drift|conductor/i)],
    'Electrostatics': [T('Capacitors', /capacit|dielectric/i), T('Gauss\'s law', /gauss|\bflux/i), T('Electric dipole', /dipole/i), T('Electric potential', /potential|equipotential/i), T('Coulomb\'s law and electric field', /coulomb|electric field|field lines|\bcharges?\b/i)],
    'Magnetism and induction': [T('Alternating current', /alternating|\blcr\b|\blc\b|impedance|reactance|\brms\b|power factor|resonan/i), T('Transformers', /transformer/i),
      T('Electromagnetic induction', /induction|faraday|\blenz|induced|inductance|eddy/i), T('Force on moving charges', /lorentz|cyclotron|force on (?:a )?(?:moving )?charge|velocity selector/i),
      T('Magnetic effect of current', /biot|amp[eè]re|solenoid|toroid|current.carrying|magnetic field (?:due|at|of)/i), T('Magnetism and matter', /bar magnet|magnetic moment|diamagnet|paramagnet|ferromagnet|earth'?s magnet/i)],
    'Modern physics': [T('Photoelectric effect', /photoelectric|work function|threshold|stopping potential/i), T('Matter waves', /de broglie|dual nature|matter wave/i), T('Radioactivity', /radioactiv|half[- ]life|\bdecay|alpha|beta|gamma/i),
      T('Nuclei', /nucle|binding energy|mass defect|fission|fusion/i), T('Atoms', /\bbohr|hydrogen atom|spectral|energy levels?|rutherford/i), T('X-rays and photons', /x-?rays?|photons?/i)],
    'Semiconductors': [T('Logic gates', /logic gates?|\bnand\b|\bnor\b|\band gate|\bor gate|\bnot gate|truth table/i), T('Transistors', /transistor|amplifier/i), T('Diodes', /diode|rectifier|p-?n junction|zener|led\b/i)],
    'Oscillations and waves': [T('Simple harmonic motion', /simple harmonic|\bshm\b|oscillat|\bspring\b|pendulum/i), T('Sound', /\bsound|doppler|\bbeats\b|organ pipe|\becho/i), T('Waves', /\bwaves?\b|wavelength|frequency|standing|stationary|string/i)],
    'Gravitation': [T('Satellites and orbits', /satellite|orbit|escape velocity|kepler|geostationary/i), T('Gravitational field and potential', /potential|field|acceleration due to gravity|\bg\b/i), T('Law of gravitation', /gravitation|gravity/i)],
    'Rotational motion': [T('Rolling motion', /rolling/i), T('Moment of inertia', /moment of inertia|radius of gyration/i), T('Angular momentum', /angular momentum/i), T('Torque', /torque|couple/i), T('Centre of mass', /cent(?:re|er) of mass/i)],
    'Thermal physics': [T('Thermodynamics', /thermodynamic|carnot|isothermal|adiabatic|heat engine|refrigerator|entropy/i), T('Kinetic theory of gases', /kinetic theory|rms speed|degrees? of freedom|mean free path/i),
      T('Heat transfer', /conduction|convection|radiation|stefan|newton'?s law of cooling|wien/i), T('Thermal expansion', /expansion/i), T('Calorimetry', /calorimetr|specific heat|latent heat/i)],
    'Properties of matter': [T('Elasticity', /elastic|young'?s modulus|stress|strain|bulk modulus/i), T('Surface tension', /surface tension|capillar/i), T('Fluids', /fluid|bernoulli|viscosity|pressure|buoyan|archimedes|pascal/i)],
    'Work, energy and power': [T('Collisions', /collision/i), T('Power', /\bpower\b/i), T('Energy conservation', /kinetic energy|potential energy|conservation of (?:mechanical )?energy/i), T('Work', /\bwork\b/i)],
    'Laws of motion': [T('Circular motion', /circular motion|centripetal|banking/i), T('Friction', /friction/i), T('Momentum and impulse', /momentum|impulse|recoil/i), T('Newton\'s laws', /newton|inertia|\bforces?\b|tension|pulley/i)],
    'Motion': [T('Projectile motion', /projectile|angle of projection|at an angle|horizontal range|maximum height|time of flight/i), T('Relative velocity', /relative/i), T('Motion graphs', /graph/i), T('Equations of motion', /velocity|acceleration|displacement|\bspeed\b|distance|free fall/i)],
    'Units and measurement': [T('Dimensions', /dimension/i), T('Errors and significant figures', /\berrors?\b|significant|least count|vernier|screw gauge/i), T('Units', /\bunits?\b|\bsi\b/i)],
    // Chemistry
    'Mole concept': [T('Empirical and molecular formula', /empirical|molecular formula|percentage composition/i), T('Concentration terms', /molarity|molality|normality|mole fraction|ppm/i),
      T('Stoichiometry', /stoichiometr|limiting reagent|balanced|yield/i), T('Moles and molar mass', /\bmoles?\b|avogadro|molar mass|atomic mass/i)],
    'Atomic structure': [T('Quantum numbers and orbitals', /quantum numbers?|\borbitals?\b|nodes?/i), T('Electronic configuration', /electronic configuration|aufbau|hund|pauli/i), T('Bohr\'s model', /\bbohr|hydrogen spectrum|spectral lines?/i),
      T('Subatomic particles and isotopes', /proton|neutron|electron|isotope|isobar/i)],
    'Periodic table': [T('Periodic trends', /ioni[sz]ation|electronegativ|electron (?:gain|affinity)|atomic radi|ionic radi|trend/i), T('Classification of elements', /\bperiods?\b|\bgroups?\b|\bblock\b|modern periodic/i)],
    'Chemical bonding': [T('Molecular orbital theory', /molecular orbital|bond order|paramagnetic|diamagnetic/i), T('Hybridisation and shapes', /hybridi[sz]|vsepr|shapes?\b|geometry|bond angle/i), T('Hydrogen bonding', /hydrogen bond/i),
      T('Ionic and covalent bonds', /ionic|covalent|lewis|octet|lattice|polar/i)],
    'Organic chemistry': [T('Biomolecules and polymers', /polymer|biomolecule|carbohydrate|protein|vitamin|nucleic/i), T('Amines', /\bamines?\b|diazonium|aniline/i), T('Carboxylic acids', /carboxylic|\besters?\b|amide/i),
      T('Aldehydes and ketones', /aldehyde|ketone|carbonyl/i), T('Alcohols, phenols and ethers', /alcohol|phenol|\bethers?\b/i), T('Haloalkanes and haloarenes', /haloalkane|haloarene|\bsn1\b|\bsn2\b|alkyl halide/i),
      T('Aromatic compounds', /benzene|aromatic/i), T('Hydrocarbons', /alkane|alkene|alkyne|hydrocarbon/i), T('Isomerism and naming', /isomer|iupac|nomenclature|name the/i),
      T('Reaction mechanisms', /mechanism|nucleophil|electrophil|carbocation|inductive|resonance|hyperconjugation/i), T('Carbon compounds', /carbon and its compounds|homologous|functional group|covalent/i)],
    'Inorganic chemistry': [T('Coordination compounds', /coordination|ligand|crystal field|werner/i), T('d- and f-block elements', /d-?block|f-?block|transition|lanthan|actin/i), T('p-block elements', /p-?block|halogen|noble gas|group 1[3-8]/i),
      T('s-block elements', /s-?block|alkali metal|alkaline earth/i), T('Hydrogen', /hydrogen/i)],
    'Thermochemistry': [T('Entropy and Gibbs energy', /entropy|gibbs|spontan/i), T('Enthalpy and Hess\'s law', /enthalpy|hess|heat of|bond energy/i), T('First law and internal energy', /first law|internal energy|work done|state function/i)],
    'Equilibrium': [T('Ionic equilibrium', /\bpH\b|buffer|ionic|hydrolysis|solubility product|\bksp\b|\bka\b|\bkb\b|acid|base/i), T('Chemical equilibrium', /le chatelier|equilibrium constant|\bkc\b|\bkp\b/i)],
    'Redox and electrochemistry': [T('Electrochemical cells', /galvanic|electrode potential|nernst|emf of|cell potential|daniell/i), T('Electrolysis', /electrolysis|faraday/i), T('Conductance', /conductance|conductivity|kohlrausch/i),
      T('Corrosion', /corrosion|rusting/i), T('Redox reactions', /redox|oxidation number|oxidi[sz]|reduc/i)],
    'Chemical kinetics': [T('Activation energy', /activation|arrhenius|catalys/i), T('Half-life', /half[- ]life/i), T('Rate law and order', /order|rate law|rate constant|rate of/i)],
    'Solutions': [T('Colligative properties', /colligative|osmo|elevation|depression|freezing|boiling|van'?t hoff/i), T('Raoult\'s law', /raoult|vapou?r pressure|azeotrop/i), T('Concentration terms', /molality|molarity|mole fraction/i)],
    'States of matter': [T('Solid state', /solid state|unit cell|crystal|packing|lattice/i), T('Gas laws', /gas laws?|boyle|charles|ideal gas|real gas|van der waals|pv\s*=\s*nrt/i)],
    'Acids, bases and salts': [T('pH scale', /\bpH\b/), T('Indicators', /indicator|litmus|phenolphthalein/i), T('Salts', /\bsalts?\b|baking soda|washing soda|bleaching|plaster/i), T('Neutralisation', /neutrali/i)],
    'Metals and non-metals': [T('Metallurgy', /metallurgy|\bores?\b|extraction|refining|roasting|calcination/i), T('Reactivity series', /reactivity/i), T('Properties of metals and non-metals', /metal|non-?metal|malleab|ductil/i)],
    'Chemical reactions': [T('Balancing equations', /balanc/i), T('Oxidation and reduction', /oxidation|reduction|rancid|corrosion/i), T('Types of reactions', /displacement|decomposition|combination|double|precipitat|exothermic|endothermic/i)],
    // Biology
    'Genetics and evolution': [T('Molecular basis of inheritance', /\bdna\b|\brna\b|replication|transcription|translation|genetic code|operon|genome/i), T('Evolution', /evolution|darwin|natural selection|hardy|speciation|fossil|origin of life/i),
      T('Sex determination and disorders', /sex determination|disorder|syndrome|pedigree|sex-linked|colou?r blind|haemophilia/i), T('Mendelian inheritance', /mendel|monohybrid|dihybrid|dominan|recessive|allele|\bcross\b|inheritance/i)],
    'Cell biology': [T('Cell division', /mitosis|meiosis|cell cycle|cell division/i), T('Cell organelles', /organelle|mitochondri|chloroplast|nucleus|membrane|ribosome|golgi|lysosome|endoplasmic/i), T('Cell structure', /\bcells?\b/i)],
    'Biomolecules': [T('Enzymes', /enzyme/i), T('Proteins and amino acids', /protein|amino/i), T('Carbohydrates and lipids', /carbohydrate|lipid|sugar|starch|fat/i)],
    'Plant physiology': [T('Photosynthesis', /photosynth|calvin|light reaction|\bc4\b|chlorophyll/i), T('Respiration in plants', /glycolysis|krebs|respiration|fermentation/i), T('Transport in plants', /transpiration|xylem|phloem|stomata|osmosis|absorption/i),
      T('Plant growth and hormones', /auxin|gibberellin|cytokinin|abscisic|ethylene|hormone|growth|photoperiod/i), T('Mineral nutrition', /mineral|nitrogen fixation|nutrient/i)],
    'Reproduction': [T('Reproductive health', /contracept|reproductive health|\bivf\b|\bstd\b|infertility/i), T('Human reproduction', /menstrua|sperm|ovum|ovar|testis|gametogenesis|placenta|human reproduction|pregnan/i),
      T('Reproduction in plants', /pollination|double fertili[sz]ation|flower|embryo sac|pollen|seed/i), T('Asexual reproduction', /asexual|budding|fission|vegetative/i)],
    'Human physiology': [T('Neural control', /neural|nervous|neuron|brain|reflex|synapse|\beye\b|\bear\b/i), T('Hormones and endocrine glands', /hormone|endocrine|gland|thyroid|insulin|pituitary/i), T('Excretion', /excret|kidney|nephron|urine/i),
      T('Circulation', /\bheart\b|\bblood\b|circulat|cardiac/i), T('Breathing', /breathing|respirat|lungs?|alveol/i), T('Digestion', /digesti|stomach|intestin|liver/i), T('Locomotion and movement', /muscle|locomotion|skeleton|joint|bone/i)],
    'Ecology': [T('Ecosystem and energy flow', /ecosystem|food chain|food web|energy flow|pyramid|trophic|decomposition|succession/i), T('Biodiversity and conservation', /biodiversity|conservation|endangered|extinct|sanctuary|hotspot/i),
      T('Populations', /population/i), T('Environmental issues', /pollution|environment|ozone|greenhouse|global warming/i)],
    'Health and disease': [T('Immunity', /immun|antibod|vaccin|antigen|allerg/i), T('Microbes in human welfare', /microbe|antibiotic|biogas|sewage/i), T('Diseases', /disease|malaria|pathogen|typhoid|cancer|aids|\bhiv\b/i)],
    'Biotechnology': [T('Applications of biotechnology', /transgenic|\bbt\b|gene therapy|insulin|gmo?\b|genetically modified/i), T('Tools of biotechnology', /recombinant|restriction|vector|plasmid|\bpcr\b|cloning|electrophoresis/i)],
    'Diversity of life': [T('Animal kingdom', /phylum|chordat|animal kingdom|vertebrat|invertebrat/i), T('Plant kingdom', /plant kingdom|algae|bryophyt|pteridophyt|gymnosperm|angiosperm/i),
      T('Microbes and the five kingdoms', /bacteria|fungi|virus|monera|protist|kingdom/i), T('Classification', /classification|taxonomy|binomial nomenclature/i)],
    'Plant structure': [T('Plant anatomy', /anatomy|tissue|meristem|vascular/i), T('Flower, fruit and seed', /flower|fruit|seed|inflorescence/i), T('Root, stem and leaf', /\broots?\b|\bstems?\b|\bleaf\b|\bleaves\b/i)],
    // English
    'Grammar': [T('Tenses', /tenses?/i), T('Voice and narration', /passive|active voice|reported speech|narration|direct speech/i), T('Vocabulary', /synonym|antonym|meaning|word|idiom|phrase/i), T('Sentence correction', /error|correct|punctuat|preposition|article|clause/i)],
    'Writing': [T('Letter writing', /\bletter\b/i), T('Notices and messages', /notice|message|advertisement|invitation/i), T('Essays and articles', /essay|article|speech|report|story|paragraph|diary/i)],
    'Reading': [T('Comprehension', /comprehension|passage|extract|read/i)]
  };
  // the lesson in TOPICS that a lesson name means ("Ray optics and optical instruments" -> "Optics")
  function topicLesson(lesson, subject){
    const l = String(lesson || '');
    if (TOPICS[l]) return l;
    const g = lessonFor(l, subject);
    return g && TOPICS[g.lesson] ? g.lesson : '';
  }
  // the topic of a question inside its lesson, from the question's own words ('' when none fits)
  function topicFor(text, lesson, subject){
    const t = String(text || ''), key = topicLesson(lesson, subject);
    if (!t.trim() || !key) return '';
    const hit = TOPICS[key].find(([, re]) => re.test(t));
    return hit ? hit[0] : '';
  }

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

  // items: [{ subject: from a "Subject:" line, heading: the section or chapter heading, tag: a #tag, text: question text,
  //           and from a "## Subject > Chapter > Topic" note on the question itself: asSubject, chapter, sub }]
  // returns [{ subject, lesson, topic }] in the same order. A heading that names a subject sets the subject; any other
  // heading, tag or chapter note is the lesson, and its subject comes from the lesson list. Questions whose subject is
  // still unknown take the paper's main subject, so a one-subject paper split into Algebra and Geometry is all Maths.
  // The topic is the note's topic, or the topic inside the lesson that the question's own words point to ('' if none).
  function classify(items){
    const first = items.map(it => {
      const said = tidyName(it.subject), headSubj = canonSubject(it.heading), headLesson = headSubj ? '' : tidyName(it.heading);
      const own = tidyName(it.chapter) || tidyName(it.tag), noted = tidyName(it.asSubject);   // named for this question alone
      return { headLesson, own, subject: canonSubject(said) || said || canonSubject(noted) || noted || headSubj || subjectFor(own) || subjectFor(headLesson) };
    });
    const votes = new Map(), vote = s => votes.set(s, (votes.get(s) || 0) + 1);
    first.forEach(f => { if (f.subject) vote(f.subject); });
    if (!votes.size) items.forEach(it => { const g = lessonFor(it.text); if (g) vote(g.subject); });
    const main = ([...votes].sort((a, b) => b[1] - a[1])[0] || [''])[0];
    return items.map((it, i) => {
      const f = first[i], guess = lessonFor(it.text, f.subject || main);
      const subject = f.subject || (!f.own && !f.headLesson && guess ? guess.subject : '') || main;
      const lesson = f.own || f.headLesson || (guess && (guess.subject === subject || sameFamily(guess.subject, subject)) ? guess.lesson : '') || 'General';
      const topic = tidyName(it.sub) || (lesson !== 'General' ? topicFor(it.text, lesson, subject) : '');
      return { subject, lesson, topic };
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
    'Wrong answer':             { kind: 'study', ease: 0.5,  base: 1,    per: 0.1 },
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
    'Wrong answer': 'Work each wrong numerical answer again from the start, check units and rounding, and practise similar questions until the method is automatic.',
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
      case 'Wrong answer': return `Revise the method for ${where}, then work 10 to 15 numerical questions on it to the final value. Redo ${list(qs)} last.`;
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
    if (r.cause === 'Wrong option' || r.cause === 'Wrong answer') return 'wrong';
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

    // topics: the finest level known for each question (the topic, else its lesson), with the share of the paper each
    // one covers, so a big portion scored badly stands out from a one-mark slip
    const tm = new Map();
    for (const r of R) {
      const sub = String(r.sub || '').trim(), id = JSON.stringify([r.subject, r.lesson, sub]);
      const t = tm.get(id) || { id, subject: r.subject, lesson: r.lesson, sub, got: 0, max: 0, gain: 0, n: 0, qs: [], lostQs: [] };
      const lost = lostOf(r);
      t.got += r.got; t.max += r.max; t.n++; t.qs.push(r.q);
      if (lost > 0) { t.lostQs.push(r.q); t.gain += lost * info(causeOf(r)).ease; }
      tm.set(id, t);
    }
    const topics = [...tm.values()].map(t => {
      const pct = t.max ? t.got / t.max * 100 : 0;
      return { ...t, name: t.sub || (t.lesson !== 'General' ? t.lesson : (t.subject || 'Other questions')), lost: t.max - t.got, gain: r1(t.gain), pct,
        portion: total.max ? t.max / total.max * 100 : 0, level: pct < 50 ? 'weak' : pct < 75 ? 'shaky' : 'strong' };
    }).sort((a, b) => b.lost - a.lost || a.pct - b.pct);

    // question types (MCQ, numerical, short and long answers)
    const ty = new Map();
    for (const r of R) { const k = r.type || 'Other', g = ty.get(k) || { name: k, got: 0, max: 0, n: 0 }; g.got += r.got; g.max += r.max; g.n++; ty.set(k, g); }
    const types = [...ty.values()].map(g => ({ ...g, pct: g.max ? g.got / g.max * 100 : 0 }));

    const reachAll = Math.min(total.max, total.got + plan.reduce((a, p) => a + p.gain, 0));
    return { total, counts, subjects, topics, types, plan, causes, reachAll, share: timeShare(plan, subjects), quick: plan.find(p => p.kind === 'habit') || null };
  }

  // Whole percentages that add up to `total` (largest remainder first)
  function toPercents(values, total = 100){
    const sum = values.reduce((a, v) => a + v, 0);
    if (!(sum > 0)) return values.map(() => 0);
    const raw = values.map(v => v / sum * total), fl = raw.map(Math.floor);
    let left = Math.round(total - fl.reduce((a, b) => a + b, 0));
    raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { fl[i]++; left--; } });
    return fl;
  }
  const lessonLabel = (lesson, subject) => lesson && lesson !== 'General' ? lesson : (subject ? `${subject}, other questions` : 'Other questions');

  // Where study time should go, as percentages: by subject when the paper has several, else by lesson. Exam habits
  // (careless slips, units, timing, bubbling) are one share of their own, since one habit fixes them in every subject.
  // Each item wins back its marks with diminishing returns: g * (1 - e^(-k t / h)), with k = ln 10 so the item's
  // hours win back about 90% of its gain. Time is shared so that the last minute spent anywhere wins back as much as
  // anywhere else: subjects with more marks to win back get more time, and slow-to-fix ones get the time they need.
  function timeShare(plan, subjects){
    const multi = subjects.filter(s => s.gain > 0).length > 1, by = multi ? 'subject' : 'lesson';
    const items = plan.filter(p => p.gain > 0 && p.hours > 0);
    if (!items.length) return { by, parts: [] };
    const K = Math.log(10), budget = items.reduce((a, p) => a + p.hours, 0), sum = a => a.reduce((x, y) => x + y, 0);
    const alloc = lam => items.map(p => Math.max(0, p.hours / K * Math.log(K * p.gain / (p.hours * lam))));
    let lo = 1e-9, hi = Math.max(...items.map(p => K * p.gain / p.hours));
    for (let i = 0; i < 100; i++) { const mid = Math.sqrt(lo * hi); if (sum(alloc(mid)) > budget) lo = mid; else hi = mid; }
    const t = alloc(hi), T = sum(t) || 1;
    const groups = new Map();
    items.forEach((p, i) => {
      const habit = p.kind === 'habit', name = habit ? 'Exam habits' : multi ? (p.subject || 'Other') : lessonLabel(p.lesson, p.subject);
      const g = groups.get(name) || { name, kind: habit ? 'habit' : 'study', subject: habit ? '' : p.subject, t: 0, gain: 0, inner: new Map() };
      g.t += t[i]; g.gain += p.gain;
      const inner = habit ? p.title : multi ? lessonLabel(p.lesson, '') : '';
      if (inner) g.inner.set(inner, (g.inner.get(inner) || 0) + t[i]);
      groups.set(name, g);
    });
    const G = [...groups.values()].sort((a, b) => b.t - a.t || b.gain - a.gain), pc = toPercents(G.map(g => g.t / T));
    return { by, parts: G.map((g, i) => {
      const ins = [...g.inner].sort((a, b) => b[1] - a[1]), ip = toPercents(ins.map(x => x[1]), pc[i]);
      return { name: g.name, kind: g.kind, subject: g.subject, pct: pc[i], gain: r1(g.gain), inner: ins.map(([name], k) => ({ name, pct: ip[k] })).filter(x => x.pct > 0) };
    }).filter(p => p.pct > 0) };
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

  return { SUBJECTS, LESSONS, TOPICS, CAUSE_INFO, FIX, HABIT_TITLE, canonSubject, lessonFor, topicFor, subjectFor, classify, statusOf, analyze, timeShare, toPercents, snapshot, acrossPapers, qLabel };
});
