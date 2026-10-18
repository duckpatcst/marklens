// Unit tests for js/insights.js. Run from the project folder with: node --test
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const I = createRequire(import.meta.url)('../js/insights.js');

const row = (q, subject, topic, max, got, cause = got >= max ? 'None' : 'Unspecified') => ({ q: String(q), subject, topic, max, got, cause, type: 'Short answer' });
// the written example paper on the site
const EXAMPLE = [
  row(1, 'Maths', 'Algebra', 2, 2), row(2, 'Maths', 'Algebra', 3, 1, 'Units & signs'), row(3, 'Maths', 'Algebra', 1, 1),
  row(4, 'Maths', 'Geometry', 5, 2, 'Concept gap'), row(5, 'Maths', 'Geometry', 3, 2, 'Units & signs'), row(6, 'Maths', 'Geometry', 4, 1, 'Concept gap'),
  row(7, 'Maths', 'Trigonometry', 2, 2), row(8, 'Maths', 'Trigonometry', 5, 0, 'Incomplete / unattempted'),
  row(9, 'Maths', 'Statistics', 2, 2), row(10, 'Maths', 'Statistics', 4, 3, 'Careless / calculation'), row(11, 'Maths', 'Statistics', 3, 3), row(12, 'Maths', 'Statistics', 4, 2, 'Incomplete / unattempted')
];

test('subject names in their usual spellings', () => {
  assert.equal(I.canonSubject('PHYSICS'), 'Physics');
  assert.equal(I.canonSubject('Physics Section-A'), 'Physics');
  assert.equal(I.canonSubject('Part II: Mathematics'), 'Maths');
  assert.equal(I.canonSubject('Botany'), 'Botany');
  assert.equal(I.canonSubject('Algebra'), '');
  assert.equal(I.subjectFor('Electrostatics'), 'Physics');
  assert.equal(I.subjectFor('Organic chemistry'), 'Chemistry');
  assert.equal(I.subjectFor('Inorganic chemistry'), 'Chemistry');
  assert.equal(I.subjectFor('Human physiology'), 'Biology');
});

test('a one-subject paper split into sections is all one subject', () => {
  const c = I.classify([{ heading: 'Algebra', text: 'Solve 2x + 3 = 11' }, { heading: 'Geometry', text: 'Prove the angle sum' }, { heading: 'Trigonometry' }, { heading: 'Statistics' }, { heading: '', text: 'Describe a histogram' }]);
  assert.deepEqual(c.map(x => x.subject), ['Maths', 'Maths', 'Maths', 'Maths', 'Maths']);
  assert.deepEqual(c.map(x => x.lesson), ['Algebra', 'Geometry', 'Trigonometry', 'Statistics', 'Statistics and probability']);
});

test('subject headings, chapters and tags', () => {
  const c = I.classify([
    { subject: 'Physics', heading: 'Optics' }, { subject: 'Physics', heading: '' }, { heading: 'Physics' },
    { subject: 'Chemistry', tag: 'Mole concept' }, { subject: 'Science', text: 'State Ohm\'s law' }, { subject: 'Zoology', heading: '' }
  ]);
  assert.deepEqual(c.map(({ subject, lesson }) => ({ subject, lesson })), [
    { subject: 'Physics', lesson: 'Optics' }, { subject: 'Physics', lesson: 'General' }, { subject: 'Physics', lesson: 'General' },
    { subject: 'Chemistry', lesson: 'Mole concept' }, { subject: 'Science', lesson: 'Current electricity' }, { subject: 'Zoology', lesson: 'General' }
  ]);
  assert.equal(c[4].topic, 'Ohm\'s law and resistance');   // the topic inside the lesson, from the question's words
});

test('the paper\'s subject wins over a look-alike word', () => {
  // "angle" alone would be Geometry; in a Physics paper the velocity makes it Motion
  const c = I.classify([{ heading: 'Physics' }, { heading: 'Physics', text: 'A ball is thrown with velocity 20 m/s at an angle of 30 degrees' }]);
  assert.deepEqual(c[1], { subject: 'Physics', lesson: 'Motion', topic: 'Projectile motion' });
  assert.equal(I.lessonFor('Find cos 60 + sin 30').lesson, 'Trigonometry');
  assert.equal(I.lessonFor('Calculate the cost of fencing'), null);   // "cos" inside "cost" is not trigonometry
});

test('question status for the map', () => {
  assert.equal(I.statusOf(row(1, '', '', 2, 2)), 'full');
  assert.equal(I.statusOf(row(1, '', '', 3, 1, 'Concept gap')), 'part');
  assert.equal(I.statusOf(row(1, '', '', 3, 0, 'Concept gap')), 'zero');
  assert.equal(I.statusOf(row(1, '', '', 3, 0, 'Incomplete / unattempted')), 'blank');
  assert.equal(I.statusOf(row(1, '', '', 4, -1, 'Wrong option')), 'wrong');
  assert.equal(I.statusOf(row(1, '', '', 4, -1, 'Bubbling error')), 'multi');
  assert.equal(I.statusOf(row(1, '', '', 0, 0)), 'none');
});

test('the example paper: totals, ranked plan and what is within reach', () => {
  const a = I.analyze(EXAMPLE);
  assert.deepEqual([a.total.got, a.total.max, a.total.lost], [21, 38, 17]);
  assert.deepEqual(a.counts, { n: 12, full: 5, part: 6, zero: 0, blank: 1, wrong: 0, multi: 0 });
  // quickest marks first: the units-and-signs habit (3 marks lost, minutes to fix) beats re-learning Geometry
  assert.deepEqual(a.plan.map(p => p.title), ['Units and signs', 'Trigonometry', 'Careless slips', 'Geometry', 'Statistics']);
  assert.equal(a.plan[0].kind, 'habit');
  assert.deepEqual(a.plan[0].qs, ['2', '5']);
  assert.equal(a.plan[0].gain, 2.7);
  assert.equal(a.quick.title, 'Units and signs');
  // every lost mark is in exactly one plan item
  assert.equal(a.plan.reduce((s, p) => s + p.lost, 0), 17);
  assert.equal(Math.round(a.reachAll * 10) / 10, 32.3);
  assert.ok(a.reachAll <= a.total.max);
  // lessons, weakest first
  assert.deepEqual(a.subjects[0].lessons.map(l => l.name), ['Trigonometry', 'Geometry', 'Algebra', 'Statistics']);
});

test('study time as percentages: whole numbers that add up to 100, most to the most marks within reach', () => {
  const s = I.analyze(EXAMPLE).share;
  assert.equal(s.by, 'lesson');
  assert.equal(s.parts.reduce((a, p) => a + p.pct, 0), 100);
  for (const p of s.parts) assert.ok(Number.isInteger(p.pct) && p.pct > 0);
  assert.equal(s.parts[0].name, 'Geometry');                         // the most marks to win back (+3.6) and slow to fix
  const habits = s.parts.find(p => p.kind === 'habit');
  assert.ok(habits, 'exam habits get a share of their own');
  assert.deepEqual(habits.inner.map(x => x.name).sort(), ['Careless slips', 'Units and signs']);
  assert.equal(habits.inner.reduce((a, x) => a + x.pct, 0), habits.pct);
  // more marks to win back means more time, other things equal
  const two = I.timeShare([{ kind: 'study', subject: 'Physics', lesson: 'Optics', gain: 8, hours: 2 }, { kind: 'study', subject: 'Chemistry', lesson: 'Mole concept', gain: 2, hours: 2 }],
    [{ name: 'Physics', gain: 8 }, { name: 'Chemistry', gain: 2 }]);
  assert.equal(two.by, 'subject');
  assert.ok(two.parts[0].name === 'Physics' && two.parts[0].pct > two.parts[1].pct);
  assert.equal(two.parts[0].pct + two.parts[1].pct, 100);
  assert.deepEqual(I.toPercents([1, 1, 1]), [34, 33, 33]);
});

test('weak topics: biggest losses first, with each topic\'s share of the paper', () => {
  const R = EXAMPLE.map(r => ({ ...r, sub: r.q === '4' ? 'Angle sum property' : r.q === '6' ? 'Pythagoras theorem' : '' }));
  const T = I.analyze(R).topics;
  assert.equal(T[0].name, 'Trigonometry');                           // 5 marks lost
  const pyth = T.find(t => t.name === 'Pythagoras theorem');
  assert.equal(pyth.lesson, 'Geometry'); assert.equal(pyth.level, 'weak');
  assert.equal(Math.round(pyth.portion * 10) / 10, 10.5);             // 4 of the paper's 38 marks
  assert.equal(T.reduce((a, t) => a + t.max, 0), 38);                // every mark belongs to one topic
  assert.ok(T.find(t => t.name === 'Algebra' && t.level === 'shaky'));
});

test('a multiple-choice test across subjects: focus subject, negative marks and bubbling', () => {
  const R = [];
  const add = (subject, lesson, list) => list.forEach(([got, cause]) => R.push({ q: String(R.length + 1), subject, topic: lesson, max: 4, got, cause, type: 'MCQ' }));
  add('Physics', 'Optics', [[4, 'None'], [-1, 'Wrong option'], [-1, 'Wrong option'], [0, 'Incomplete / unattempted']]);
  add('Physics', 'Laws of motion', [[4, 'None'], [4, 'None']]);
  add('Chemistry', 'General', [[4, 'None'], [4, 'None'], [-1, 'Bubbling error'], [4, 'None']]);
  const a = I.analyze(R, { omr: true });
  assert.equal(a.total.got, 21);
  assert.equal(a.subjects[0].name, 'Physics');                       // the most marks to win back
  assert.equal(a.share.by, 'subject');
  assert.equal(a.share.parts.filter(p => p.kind === 'study')[0].name, 'Physics');
  assert.equal(a.plan[0].title, 'Bubbling mistakes');                // fastest fix
  const optics = a.plan.find(p => p.title === 'Optics');
  assert.equal(optics.lost, 14);                                     // 2 wrong x (4 + 1) + 1 blank x 4
  assert.match(optics.fix, /Revise Optics/);
  assert.equal(a.counts.wrong, 2); assert.equal(a.counts.multi, 1); assert.equal(a.counts.blank, 1);
});

test('nothing to plan when nothing was lost', () => {
  const a = I.analyze([row(1, 'Maths', 'Algebra', 2, 2), row(2, 'Maths', 'Algebra', 3, 3)]);
  assert.equal(a.plan.length, 0); assert.equal(a.reachAll, 5); assert.equal(a.share.parts.length, 0); assert.equal(a.quick, null);
});

test('my papers: progress and the subjects that keep costing marks', () => {
  const p1 = I.snapshot([row(1, 'Physics', 'Optics', 10, 4, 'Concept gap'), row(2, 'Chemistry', 'Mole concept', 10, 8, 'Careless / calculation')], { name: 'Unit test 1', at: '2026-09-01T00:00:00Z' });
  const p2 = I.snapshot([row(1, 'Physics', 'Optics', 10, 5, 'Concept gap'), row(2, 'Chemistry', 'Mole concept', 10, 9, 'Careless / calculation')], { name: 'Unit test 2', at: '2026-10-01T00:00:00Z' });
  assert.equal(p1.got, 12); assert.equal(p1.subjects.length, 2);
  const A = I.acrossPapers([p2, p1]);
  assert.deepEqual(A.papers.map(p => p.name), ['Unit test 1', 'Unit test 2']);   // oldest first
  assert.equal(A.subjects[0].name, 'Physics'); assert.equal(A.subjects[0].lost, 11);
  assert.equal(A.lessons[0].name, 'Optics'); assert.equal(A.lessons[0].papers, 2);
});

test('topics inside lessons, from the question\'s own words', () => {
  assert.equal(I.topicFor('An object is placed 30 cm from a convex lens of focal length 20 cm', 'Optics'), 'Lenses');
  assert.equal(I.topicFor('Explain total internal reflection with a diagram', 'Optics'), 'Refraction');
  assert.equal(I.topicFor('Magnifying power of a compound microscope', 'Ray optics and optical instruments', 'Physics'), 'Optical instruments');
  assert.equal(I.topicFor('In a monohybrid cross between Tt and Tt find the ratio', 'Genetics', 'Biology'), 'Mendelian inheritance');
  assert.equal(I.topicFor('Find the probability of drawing a red ball from a bag', 'Statistics'), 'Probability');
  assert.equal(I.topicFor('Anything at all', 'A lesson nobody knows'), '');
  // a note on the question wins over the guess
  assert.equal(I.classify([{ heading: 'Optics', text: 'focal length of a lens', chapter: 'Ray optics', sub: 'Lens formula' }])[0].topic, 'Lens formula');
});

test('exam subjects: SSC and bank section names', () => {
  assert.equal(I.canonSubject('General Intelligence and Reasoning'), 'Reasoning');
  assert.equal(I.canonSubject('Quantitative Aptitude'), 'Quantitative aptitude');
  assert.equal(I.canonSubject('English Comprehension'), 'English');
  assert.equal(I.canonSubject('General Awareness'), 'General awareness');
  assert.equal(I.canonSubject('GK'), 'General awareness');
});
