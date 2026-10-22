/**
 * methods.ts
 * The learning-methods guide (the private design notes; research
 * in the private design notes): each method,
 * how strong the evidence is, the studies behind it, where AnyLearn does it,
 * and its videos. The words are in public/locales/<lang>/methods.json.
 */
import videoData from "~/data/methods/videos.json";

export const METHOD_SLUGS = [
  "retrieval",
  "spacing",
  "sleep",
  "judge",
  "interleaving",
  "elaboration",
  "explain",
  "examples",
  "dual",
  "generate",
  "deliberate",
  "breaks",
  "myths",
] as const;
export type MethodSlug = (typeof METHOD_SLUGS)[number];

export function isMethodSlug(s: string): s is MethodSlug {
  return (METHOD_SLUGS as readonly string[]).includes(s);
}

/** How strong the evidence is: what the guide says before anything else. */
export type Evidence = "strong" | "moderate" | "limited" | "myth";

export const EVIDENCE: Record<MethodSlug, Evidence> = {
  retrieval: "strong",
  spacing: "strong",
  judge: "moderate",
  sleep: "strong",
  interleaving: "moderate",
  elaboration: "moderate",
  explain: "moderate",
  examples: "moderate",
  dual: "moderate",
  generate: "moderate",
  deliberate: "moderate",
  breaks: "limited",
  myths: "myth",
};

export const EVIDENCE_ORDER: Evidence[] = ["strong", "moderate", "limited", "myth"];

/** A study, as its reference list gives it; each was checked against Crossref. */
export type Source = { cite: string; title: string; doi: string };

const S = {
  dunlosky: { cite: "Dunlosky et al. (2013)", title: "Improving Students' Learning With Effective Learning Techniques", doi: "10.1177/1529100612453266" },
  roediger: { cite: "Roediger & Karpicke (2006)", title: "Test-Enhanced Learning", doi: "10.1111/j.1467-9280.2006.01693.x" },
  adesope: { cite: "Adesope, Trevisan & Sundararajan (2017)", title: "Rethinking the Use of Tests: A Meta-Analysis of Practice Testing", doi: "10.3102/0034654316689306" },
  cepeda: { cite: "Cepeda et al. (2006)", title: "Distributed practice in verbal recall tasks: A review and quantitative synthesis", doi: "10.1037/0033-2909.132.3.354" },
  karpicke: { cite: "Karpicke, Butler & Roediger (2009)", title: "Metacognitive strategies in student learning: Do students practise retrieval when they study on their own?", doi: "10.1080/09658210802647009" },
  bjork: { cite: "Bjork (2018)", title: "Being Suspicious of the Sense of Ease and Undeterred by the Sense of Difficulty", doi: "10.1177/1745691617690642" },
  rasch: { cite: "Rasch & Born (2013)", title: "About Sleep's Role in Memory", doi: "10.1152/physrev.00032.2012" },
  rohrer: { cite: "Rohrer & Taylor (2007)", title: "The shuffling of mathematics problems improves learning", doi: "10.1007/s11251-007-9015-8" },
  kornell: { cite: "Kornell & Bjork (2008)", title: "Learning Concepts and Categories: Is Spacing the \"Enemy of Induction\"?", doi: "10.1111/j.1467-9280.2008.02127.x" },
  brunmair: { cite: "Brunmair & Richter (2019)", title: "Similarity matters: A meta-analysis of interleaved learning and its moderators", doi: "10.1037/bul0000209" },
  chi: { cite: "Chi et al. (1994)", title: "Eliciting Self-Explanations Improves Understanding", doi: "10.1207/s15516709cog1803_3" },
  fiorella13: { cite: "Fiorella & Mayer (2013)", title: "The relative benefits of learning by teaching and teaching expectancy", doi: "10.1016/j.cedpsych.2013.06.001" },
  fiorella16: { cite: "Fiorella & Mayer (2016)", title: "Eight Ways to Promote Generative Learning", doi: "10.1007/s10648-015-9348-9" },
  sweller: { cite: "Sweller & Cooper (1985)", title: "The Use of Worked Examples as a Substitute for Problem Solving in Learning Algebra", doi: "10.1207/s1532690xci0201_3" },
  clark: { cite: "Clark & Paivio (1991)", title: "Dual coding theory and education", doi: "10.1007/BF01320076" },
  slamecka: { cite: "Slamecka & Graf (1978)", title: "The generation effect: Delineation of a phenomenon", doi: "10.1037/0278-7393.4.6.592" },
  richland: { cite: "Richland, Kornell & Kao (2009)", title: "The pretesting effect: Do unsuccessful retrieval attempts enhance learning?", doi: "10.1037/a0016496" },
  kornell09: { cite: "Kornell, Hays & Bjork (2009)", title: "Unsuccessful retrieval attempts enhance subsequent learning", doi: "10.1037/a0015729" },
  ericsson: { cite: "Ericsson, Krampe & Tesch-Römer (1993)", title: "The role of deliberate practice in the acquisition of expert performance", doi: "10.1037/0033-295X.100.3.363" },
  macnamara: { cite: "Macnamara, Hambrick & Oswald (2014)", title: "Deliberate Practice and Performance in Music, Games, Sports, Education, and Professions: A Meta-Analysis", doi: "10.1177/0956797614535810" },
  biwer: { cite: "Biwer et al. (2023)", title: "Understanding effort regulation: Comparing 'Pomodoro' breaks and self-regulated breaks", doi: "10.1111/bjep.12593" },
  pashler: { cite: "Pashler et al. (2008)", title: "Learning Styles: Concepts and Evidence", doi: "10.1111/j.1539-6053.2009.01038.x" },
} satisfies Record<string, Source>;

export const SOURCES: Record<MethodSlug, Source[]> = {
  retrieval: [S.roediger, S.adesope, S.dunlosky],
  spacing: [S.cepeda, S.dunlosky],
  judge: [S.karpicke, S.bjork],
  sleep: [S.rasch],
  interleaving: [S.rohrer, S.kornell, S.brunmair],
  elaboration: [S.dunlosky],
  explain: [S.chi, S.fiorella13, S.fiorella16],
  examples: [S.sweller],
  dual: [S.clark],
  generate: [S.slamecka, S.richland, S.kornell09],
  deliberate: [S.ericsson, S.macnamara],
  breaks: [S.biwer],
  myths: [S.pashler, S.dunlosky],
};

/** Where AnyLearn does the method; labelKey is in the methods namespace's `do`. */
export const DO_IT: Record<MethodSlug, { to: string; labelKey: string }[]> = {
  retrieval: [
    { to: "/quiz/practice", labelKey: "practice" },
    { to: "/mastery/review", labelKey: "review" },
    { to: "/mastery/vocabulary", labelKey: "vocabulary" },
  ],
  spacing: [
    { to: "/mastery/review", labelKey: "review" },
    { to: "/settings/reminders", labelKey: "reminders" },
    { to: "/mastery/decks", labelKey: "decks" },
  ],
  judge: [
    { to: "/progress", labelKey: "progress" },
    { to: "/quiz/practice", labelKey: "practice" },
  ],
  sleep: [
    { to: "/settings/reminders", labelKey: "reminders" },
    { to: "/progress", labelKey: "progress" },
  ],
  interleaving: [
    { to: "/mastery/review", labelKey: "reviewAll" },
    { to: "/quiz/practice", labelKey: "practice" },
  ],
  elaboration: [
    { to: "/chat", labelKey: "chat" },
    { to: "/notebooks", labelKey: "notebooks" },
  ],
  explain: [
    { to: "/mastery", labelKey: "explainBack" },
    { to: "/settings/account", labelKey: "ownVersion" },
  ],
  examples: [
    { to: "/solve", labelKey: "solve" },
    { to: "/chat", labelKey: "chat" },
  ],
  dual: [
    { to: "/chat", labelKey: "diagrams" },
    { to: "/notebooks", labelKey: "notebooks" },
  ],
  generate: [
    { to: "/settings/account", labelKey: "ownVersion" },
    { to: "/quiz/practice", labelKey: "practice" },
  ],
  deliberate: [
    { to: "/quiz/practice", labelKey: "mistakes" },
    { to: "/toolkit", labelKey: "toolkit" },
    { to: "/body", labelKey: "body" },
  ],
  breaks: [
    { to: "/home", labelKey: "lowDay" },
    { to: "/progress", labelKey: "progress" },
  ],
  myths: [
    { to: "/quiz/practice", labelKey: "practice" },
    { to: "/mastery/review", labelKey: "review" },
  ],
};

export type MethodVideo = {
  id: string;
  lang: string;
  methods: string[];
  title: string;
  channel: string;
  seconds: number;
  published: string;
};

const VIDEOS = videoData.videos as MethodVideo[];

/** Every video the guide lists: the only ones "Add to my knowledge" takes. */
export const VIDEO_IDS = new Set(VIDEOS.map((v) => v.id));

/** The day the videos were last checked on YouTube. */
export const VIDEOS_CHECKED = videoData.checked;

/** A method's ("overview" for the front page) videos: the learner's language first, then English. */
export function videosFor(method: MethodSlug | "overview", ui: string): MethodVideo[] {
  const of = VIDEOS.filter((v) => v.methods.includes(method));
  const mine = ui === "en" ? [] : of.filter((v) => v.lang === ui);
  return [...mine, ...of.filter((v) => v.lang === "en")];
}

/** YouTube's own search for more, in the learner's words. */
export function searchURL(query: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
}

/** The privacy-enhanced player for a video. */
export function playerURL(id: string) {
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?autoplay=1&rel=0`;
}
