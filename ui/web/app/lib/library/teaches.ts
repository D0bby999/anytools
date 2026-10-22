/**
 * library/teaches.ts
 * Which language an item is FOR learning (the private design notes,
 * phase 6), apart from the language it is written in: a French textbook
 * written in English teaches French. The Library's "For learning" filter and
 * the Languages tab's shelf read it.
 *
 * Read from the title, conservatively: a missed textbook is still under
 * Languages; one shelved under the wrong language misleads. Linguistics,
 * literature and books for teachers are left untagged.
 */
import type { LibraryItem } from "~/lib/library/types";

const LANGUAGE_NAMES: Record<string, string> = {
  arabic: "ar", bangla: "bn", chinese: "zh", mandarin: "zh", english: "en", french: "fr", german: "de",
  hindi: "hi", indonesian: "id", italian: "it", japanese: "ja", khmer: "km", korean: "ko", persian: "fa",
  portuguese: "pt", punjabi: "pa", russian: "ru", spanish: "es", swahili: "sw", kiswahili: "sw",
  telugu: "te", tibetan: "bo", urdu: "ur", malayalam: "ml", yoruba: "yo",
};
const NAMES = Object.keys(LANGUAGE_NAMES).join("|");

/** "Elementary Arabic I", "Let's Chat! Korean", "Basic Urdu", "German 101", MIT's "Chinese I (Regular)". */
const COURSE = new RegExp(
  `^(?:(?:basic|elementary|beginning|intermediate|advanced|first-year|introductory|introduction to|let's chat!)\\s+(${NAMES})\\b` +
    `|(${NAMES})\\s+(?:[ivx]+\\b|\\d{3}\\b|introductory\\b|oer\\b|for\\b))`,
  "i",
);

/** Titles that name no language, by what they teach. */
const NAMED: [RegExp, string][] = [
  [/^(?:Français|Tout un Monde|Chapeau!|Au Boulot!|CITOYEN\.NE\.S|Sons & Lettres|Avant-Première|Liberté\b)/, "fr"],
  [/^(?:Trayectos|Semillas|Libro Libre|Yo puedo|Recorridos|Comunidades|¡Voy en camino!|Palabras propias|Salón de Clase|Carreras: Español|Maletín Médico|Mi Voz|Español down under|Spanish I:|Beginning Spanish|¡Que viva la música!|Conversaciones Corrientes|Ahora Entendemos)/, "es"],
  [/^(?:Oral Communication in Spanish|Spanish Conversation and Composition|La hora del cuento en español)/, "es"],
  [/^(?:Deutsch im Blick|A Foundation Course in Reading German|Germany Today: Intensive Study of German Language)/, "de"],
  [/^(?:Portuguese Advanced Conversation|Accelerated Introductory Portuguese)/, "pt"],
  [/^Project-Based Language Learning for Chinese/, "zh"],
  [/^(?:Spunti|Piacere!|Tutt\* a tavola|D'accordo!)/, "it"],
  [/^(?:Bate-Papo|Conversa Brasileira|ClicaBrasil|Português para principiantes)/, "pt"],
  [/^(?:Hujambo!|Elementary Swahili)/, "sw"],
  [/^Kreyòl Pale/, "ht"],
  [/^Yorùbá Yé Mi/, "yo"],
  [/^Her Şey Bir Merhaba/, "tr"],
  [/^(?:Korean Through Folktales|Korean in One Bite|Beginning Korean)/, "ko"],
  [/^(?:Mastering Mandarin Sounds|Learning Chinese: A Foundation Course)/, "zh"],
  [/^(?:Kanji Learning|Kana$|Beginning Japanese|Preadvanced Japanese|Japanese Introductory)/, "ja"],
  [/^(?:Телемосты|Decoding the 1920s: A Reader for Advanced Learners of Russian)/, "ru"],
  [/^Introduction to Arabic: Egyptian Arabic/, "ar"],
];

/** English for people learning it: ESL textbooks and MIT's ELS subjects, never a teacher's guide. */
const ENGLISH_LEARNERS = [
  /\bESL\b(?!.*teacher)/i,
  /English Communication/i,
  /Non-Native Speakers of English/i,
  /for Bilingual Students/i,
  /\(ELS\)/,
  /^Communication Beginnings/,
  /^Welcome to Springfield/,
  /^Explorations 1: Grammar/,
  /^In the Community: An Intermediate Integrated Skills/,
  /^Listening, Speaking, and Pronunciation$/,
  /^High-Intermediate Academic Communication$/,
  /^Communicating in American Culture/,
];

const TEACHER = /\bteach(?:ers?|ing)\b|\bteacher's\b|for Language Teachers/i;

/** The language an item teaches, or undefined. */
export function teachesOf(item: Pick<LibraryItem, "kind" | "subject" | "language" | "name" | "teaches">): string | undefined {
  if (item.teaches) return item.teaches;
  if (item.subject !== "languages") return undefined;
  // A word list or a deck is its language's words.
  if (item.kind === "words" || item.kind === "deck") return item.language === "mul" ? undefined : item.language.split("-")[0];
  if (TEACHER.test(item.name)) return undefined;
  // A title that starts with a language names it, before any English rule:
  // "Spanish for Bilingual Students" teaches Spanish.
  const course = COURSE.exec(item.name);
  if (course) return LANGUAGE_NAMES[(course[1] ?? course[2] ?? "").toLowerCase()];
  for (const [re, lang] of NAMED) if (re.test(item.name)) return lang;
  if (ENGLISH_LEARNERS.some((re) => re.test(item.name))) return "en";
  return undefined;
}
