# Learning features

A short guide to what each study feature does, what it costs on your own AI key, and where it stops. Every model call uses your connections from Settings; AnyLearn has no key of its own.

| Feature | Where | What it costs on your key |
|---|---|---|
| Practise your mistakes | Quiz → Practise your mistakes, Home, a mastery path | Nothing, except marking a free-text answer (one call) |
| Explain it back | Mastery session | One call to teach a point (cached), one to judge each explanation |
| Exams | Quiz → Exams | Reading the paper (your `parse` model), writing the mock (one call per question), marking written answers |
| Web pages and YouTube | A knowledge base → Add a link | A parse and an index, like an upload; a Gemini transcription when a video's captions cannot be read |
| Video study notes | A video → Study notes | One call to your reading model per language |
| Diagrams | "Draw it" under an answer, a solution or a selection | One call, and at most one repair |
| Papers | Research (automatic), a knowledge base → Related papers | One call for the search queries; paper searches are free |
| Vocabulary and read-aloud | Reading, Mastery → Vocabulary | One call when you ask for words to save; reading aloud is free |
| Skill evidence cards | Loop → a learning state | Nothing |
| Learner profile | Settings → Profile | One call a night, only if you turn consolidation on |
| Audio overview | A knowledge base or a report → Audio overview | One call for the script; then the server's built-in voices (free, daily minutes), your own speech key on the `tts` route, or the browser |
| Living books | A knowledge base → Make a book | One call for the outline, then one per block |
| Toolkit (worksheets) | Toolkit, from More, the Loop and a learning state | Nothing, except a writing diagnosis |
| Languages (one page) | Languages, in the sidebar under Part III · Practise; a tab per language | Nothing: it links what is below |
| Language diagnostic | Languages, Toolkit → Language, a skill card in the Loop | Nothing |
| Listening practice | A video or an audio file → Practise listening | Nothing |
| Unknown-word decisions and production cards | The reader's word picker, Mastery → Vocabulary | One call when you ask for words to save, as before |
| Listening cards | Mastery → Vocabulary → Practise hearing it | Nothing |
| Read-aloud check | Reading → select a passage → Check my reading aloud | A transcription on your `stt` key, or the server's built-in engine (free, from the daily minutes) |
| Anki decks in and out | Mastery → Vocabulary → Anki decks | Nothing: the deck is read and written in your browser |
| Share to AnyLearn | Android: Share → AnyLearn, with the app installed | As Add a link: a parse and an index |
| Kindle and KOReader highlights | A knowledge base → Add → Highlights | As an upload: a parse and an index per book |
| Writing revision | Toolkit → Writing evidence | One call per pass you ask to have diagnosed |
| Reading in five passes | A PDF or a text document → Read in five passes | Nothing; "Save the word" asks for words like the reader does |
| Grammar evidence and error map | Toolkit → Language | Nothing |
| Speaking recordings | Toolkit → Speaking evidence | Nothing; recordings use server storage |
| Projects and case reviews | Toolkit → Projects | Nothing |
| Life toolkit | Toolkit → Life (private) | Nothing, and never sent to a model |
| Day-90 close | Loop → a cycle | Nothing |
| Write your own version first | Settings → Account; Chat and Solve | Nothing extra: the three lines go with your message |
| Review everything due | Home, Mastery → Review everything due | As a mastery session: one call per new question |
| Bad-day minimum | Home → Today, a learning state | Nothing |
| Audio and video files | A knowledge base → upload | A transcription (built-in, or your `stt` key), then an index |
| Photos of pages and notes | A knowledge base → upload | Your `parse` model reads each photo, then an index |
| Podcast feeds and YouTube playlists | A knowledge base → Add a link | Nothing for the feed; each episode as an audio file or a video |
| Documentation sites and GitHub repositories | A knowledge base → Add a site, Add a repository | An index of every page or file (`embed`); no other call |
| Spreadsheets | A knowledge base → upload | An index only; read locally |
| Zotero | A knowledge base → Add from Zotero; Research | An index of each item added; research may search it as a tool |
| Body (training) | Body, Home → Body today | Nothing to log or progress; the coach is one call on your `chat` model per plan, review or revision, and at most one repair |

## The first visit

Home greets a learner who has not studied yet as new ("Welcome", not "Welcome back") and asks what they want to learn: a language, their own material, an exam, research, training, or Skip (plans 261022-1210, phase 7). The answer is `users.study_focus` (`PUT /v1/me/study-focus`; null until asked, empty when skipped), changeable under Settings → Account. Choosing a language asks which, adds it to the studied languages, and offers its first words from the Library's word lists (NGSL 1–500 for English), which start in today's review. Home then leaves out the parts made for another purpose (`lib/study-focus.ts`: Languages and Vocabulary for languages, timed exams, Research, Body) with "Show every part" beside them; what is due is never filtered, and every part stays in the menu.

## The language explanations are written in

What a model writes for the learner (a study plan, a lesson, an explain-back's feedback, a quiz question's explanation, the reading tutor's answer, "Find words to save"'s gloss) is in the learner's interface language, with terms, quotations and examples from their documents kept as they are (plans 261022-1210, phase 4). The rule is one section, `locale.ExplainRule`, added to the system prompt from the request context (`locale.FromContext`, which `httpx.WithLanguage` fills); a background job has no language and follows its material, as before. A quiz question, its options and its answer stay in the passages' language, which on a language being studied is the reading practised.

A mastery path may choose another ("Explain in" when it is created and on its page, `PATCH /v1/mastery/paths/{id}`): the learner's language, the documents' (`source`, no rule), or a studied language. A lesson offers the other of the learner's and the documents' language; each language is its own cached lesson (`kp_explanations.lang`).

**Points not in the documents.** A proposed plan's points are each embedded on the knowledge base's own route and measured against its nearest passage (`retrieve.Nearest`, cosine similarity). Because the scale differs by embedding model, the mark is relative: a point below 0.8 of the plan's median and 0.08 under it is "Not found in your documents" (`mastery.OutsideSource`). The editor names them under their module; one kept on approval stays marked (`knowledge_points.outside_source`). A base indexed with another model is not measured, and the plan says so.

## Maths answers, marked by value

A short or cloze question whose recorded answer is an expression or an equation is marked in Go, with no model call (`internal/capabilities/quiz/mathcheck`): both are evaluated at the same 24 sample points, so `2(x+1)`, `2x + 2` and `\frac{4x+4}{2}` are one answer, an equation equals any rearrangement of itself, and `x = 3` equals `3`. A bare number is compared by value when the reply is a number. The notation read is what people type and what MathLive writes: decimal commas, implicit multiplication, `^`, roots, `|x|`, the usual functions, π and a LaTeX subset. When the question asks to simplify, factorise or expand, an equal answer in another form is "Almost": right, scheduled as Hard. Units, matrices, intervals, solution sets, inequalities and proofs go to the model as before (owner decision 3).

The card offers a MathLive field for such a question (`math: true` in the question's view; the library is a lazy chunk, its fonts under `/tool-runtime/`), which works as a plain box until it loads. A reply the checker cannot read is not marked: the API answers 422 `unreadable_math` when the card asks (`ask_if_unreadable`), and the learner fixes it or sends it as text to the model. An exam's marking does not ask, so its unreadable answers go to the model.


Beyond expressions, the checker reads (`mathcheck/structures.go`, `units.go`):

- **Intervals, sets, vectors and matrices.** `(2, 5]` is compared bracket by bracket (an infinite end's bracket aside; `]2;5]` is the French way of writing it), unions in any order, sets in any order, tuples, vectors and matrices part by part with `(` and `[` alike. An inequality in one variable (`2 < x <= 5`, `x >= 3`) is its interval. With semicolons between parts, a comma is a decimal comma (`(1,5; 3]`).
- **Quantities.** A number and a unit's symbol, compared in SI units: `5 m` is `500 cm`, `60 km/h` is `16.67 m/s` (a converted answer may be rounded to its last digit), `2 kWh` is `7.2 MJ`. An equal value in another unit is right, unless the question names the recorded unit ("convert 5 m to cm"): then it is *almost* (`almost_why: "unit"`); the right number with no unit is *almost* too (`"no_unit"`). Temperatures in °C or °F and units not in the table go to the model, as do words. A lone letter against a number (`5m`) stays the product 5·m.

Proofs stay with the model: no checker reads an argument.
## Code exercises (Python)

A code question (type `code`) is a small Python exercise answered with code that its tests check, in the learner's browser: Pyodide (MPL-2.0, unmodified, under `/tool-runtime/pyodide@314.0.7/`) runs in a Web Worker (`ui/web/app/workers/python.worker.ts`), so Stop ends a run and a run is stopped at 30 seconds. The server never runs code. Pyodide's script, wasm and lock file are brotli-compressed at build (`precompress` in `scripts/tool-runtime.json`, quality 11, kept in `node_modules/.cache` by sha256) and sent compressed to a browser that takes br: the wasm is 2.7 MB on the wire instead of 9.6 (3.2 compressed on the fly). The worker's progress counts against each file's own size (`X-File-Size`). The question's `code` holds the module the tests import, the starting code and the tests, shown before the attempt; its solution is `answer`, shown after. The harness (`lib/python-harness.ts`) runs plain `test_*` functions and unittest classes and reports each test with its message and line, and what the code printed.

Before an exercise runs, the worker is cut off: `fetch`, `XMLHttpRequest`, `WebSocket`, `caches`, `indexedDB`, `BroadcastChannel` and `Worker` are removed from its global and every prototype behind it, because an exercise may have been written from an untrusted document and the worker shares the app's origin (its code could otherwise call the app's routes with the learner's session). In production the worker's script also has its own policy (`ui/web/server.mjs`): no `eval` or `Function`, and nothing loaded or fetched but `/assets/` and `/tool-runtime/`, so a run cannot `import()` an app page with the learner's session, load a font from elsewhere or send anything away (checked in a browser: `js.eval`, `Function`, `loadPackage` to another site and to an app page, `FontFace`, all refused). The dev server does not set it. Runs are practice and send nothing. When every declared test passes, the attempt is sent with the results; after a failed run the learner can ask for the solution, which sends it as not passed. Go marks it from the results (`JudgeModeTests`): right only when every `def test_…` the exercise declares was reported passed; the learner can override as on every question. The editor is CodeMirror 6 with the app's ink in both themes; on a phone, instructions, code and tests are tabs.

Code questions come from the learner's Python material (ask for "Code (Python)" when generating a quiz: the model writes starting code, tests importing `solution`, and a solution, checked structurally before saving) or from the starter set: Quiz → "Add the Python exercises" puts 18 exercises from Exercism's Python track (MIT, credited on each) into a knowledge base "Python basics", once (`POST /v1/quiz/starters`). Exams do not use code questions.

## Practise your mistakes

Every question you answer wrong, in a quiz, an exam or a mastery session, waits in Practice until you get it right twice **on two different days** in your own time zone. Two right answers a minute apart prove the answer was still on screen, not that you remember it. Your time zone is taken from your browser the first time you sign in; change it in Settings → Account.

## Explain it back

For concept and design points, a mastery session first teaches the point from your documents, then asks you to explain it in your own words. The model lists what is missing or wrong, citing the passage that covers it. On paths created after this feature arrived, a module is finished only when each such point has been explained. If you think the judgement is wrong, you can overrule it; the record says it was your call.

## Exams

Upload a past paper (PDF, a photo or a document). AnyLearn lists its questions for you to check and correct, then writes a new paper of the same shape from a knowledge base. Written answers are marked against a rubric with partial credit; below 70 % counts as a mistake and goes to Practice. The reading of a scanned paper can be wrong: the review step is where you fix it.

## Web pages and YouTube

A web page (HTML or PDF, up to 5 MB) becomes a document; it can be re-checked daily and re-indexed only when it changes. A public YouTube video becomes a transcript you can cite by the second.

A video opens beside its transcript. When the creator's description lists chapters, they head the transcript, and the transcript says whose captions it is (the creator's, YouTube's automatic ones, an AI transcript, or yours).

**Study notes.** Press "Write study notes" to have your reading model split the video into sections, each with a short summary and its key points. Every time in the notes plays that moment. When the video has chapters, the sections are the creator's chapters. Notes can be written in another language (for example Vietnamese notes of an English lecture) and downloaded as a Markdown file whose times link to the video. AnyLearn checks every time against the transcript and drops one that is not in it. If the transcript is replaced later, the notes say they may be out of date. Notes cover videos up to about three hours.

**Limits.** YouTube usually blocks caption fetching from servers. AnyLearn then offers to have your **Gemini key** transcribe the public video: Google reads it, the video is never downloaded here, and the transcript is labelled "AI transcript" because it can mishear words. The free tier covers about 8 hours of video a day. Private and unlisted videos cannot be transcribed; upload a subtitle file or paste the transcript instead.

## Diagrams

Press "Draw it" to get a flowchart, timeline, mind map or chart of an answer. Nothing is drawn unless you ask. A diagram that cannot be drawn shows its source instead.

## Papers

For scholarly questions, research also searches OpenAlex (then arXiv). A knowledge base can list recent related papers; adding one imports its PDF only under an open licence, otherwise a note with the abstract and a link. Without an OpenAlex key you get 20 free paper searches a day; a free key (Settings → Search keys) raises that.

## Vocabulary and read-aloud

Select text while reading to save a word. It becomes two cards (meaning, and fill-in-the-blank) on their own review schedule. "Read aloud" uses your browser's voices, which are free. Some browsers have few voices for Vietnamese (Apple devices have one); the reader says when none is available.

## Skill evidence cards

For reading, writing, speaking, listening, vocabulary or grammar: record an unaided first attempt, practise, then retest after a delay (14 days, or 5 for a reader's field note). The retest cannot be saved early, and your first attempt stays hidden until the retest is saved, so you are not cued by it.

## Learner profile

What AnyLearn should remember about how you study: your preferences, goals, what you find hard. You write entries yourself. If you turn on nightly consolidation, it suggests entries from your activity, and nothing is used until you accept it.

## Audio overview

A host and an expert talk through a knowledge base or a report, citing it, and say so when the material does not cover something. The script comes first. "Speak it" then lists only the ways that have voices for the script's language, each with its cost:

- **Built-in (free, about N minutes):** the server's own Kokoro, when it runs one, within your daily minutes. English (and Kokoro's other languages), never Vietnamese.
- **Your OpenAI key, or your own speech server:** the characters it will bill, and a price link.
- **Read it in the browser:** your browser's own voices, free, nothing stored.

The finished audio names the engine and the two voices that spoke it. Overviews spoken with Gemini before this change still play.

## Living books

A knowledge base becomes a book: you approve an outline, and each chapter is written from your own documents, with explanations, diagrams, quizzes and flash cards that join Mastery → Book cards.

## AI-judged feedback

Marking free-text answers, judging explanations, reading exam papers and consolidating the profile are done by your model. They can be wrong. Each is shown with its reasons and can be overruled, and the record keeps who decided.

## Toolkit

The toolkit holds 27 worksheets taken from up's templates (`byoungd/up` at `f13ff2d`), in three groups: language, projects and life. Each worksheet has the sections, fields, tables and options of its source, and is checked against them when it is saved. Many carry up's review dates, counted from the day that matters (a draft, a delivery, a first pass) on your local day. They appear on Home when due, and a dated retest row cannot be filled in before its date. A worksheet that is not private can be added to a learning state's evidence. Every worksheet downloads as Markdown.

**Quick versions.** A worksheet with more than twelve fields opens on its quick version: three to five of its fields, chosen per kind in `internal/learning/worksheet/quick.go`, with "Open the full worksheet" one click away (remembered per worksheet in the browser). A quick field is the full worksheet's own field, and a section save sends only the fields it shows, which the API merges by field. Each quick version holds the field its reviews count from, and a "this happened on" date (`today` in the kind) starts as the learner's day when the worksheet is created, so a quick worksheet is scheduled like a full one. `quick_test.go` runs every kind's quick version alone through validation, its checks and the scheduler. The Toolkit and Languages links read "Start (5 min)" for such a kind.

Nothing in the toolkit calls a model, except a writing diagnosis that you ask for. **Worksheets are stored like notes: readable by the server, not encrypted at rest.** Do not put passwords, ID numbers, exact addresses or medical details in them.

## Languages, in one place

The Languages page (`/languages`) gathers the language practice below by skill, for every language the learner studies, not only English. A first visit asks which languages: those of the saved words are suggested and ticked, then the often learned, then a search over every ISO 639-1 language, named by the browser (`Intl.DisplayNames`). Each studied language is a tab with its words due; the page opens on the tab viewed last. The list lives in `vocab_languages` (`GET`/`PUT /v1/vocab/languages`); taking a language off hides its tab and keeps its words, which carry their own language as before.

A language's tab puts its vocabulary first, with "Review these" opening Mastery → Vocabulary narrowed to that language (`GET /v1/vocab/due?lang=`), then the diagnostic (a diagnostic started here is titled with the language), then listening, reading, speaking, writing, grammar and language for work. It adds no practice of its own; a listening or reading worksheet still starts from its video or document. The old `/english` answers with English's tab and adds English to the list.

Each language has a small profile in `ui/web/app/lib/languages.ts`: a dictionary to look a word up in (Jisho, MDBG, Naver, Cambridge, WordReference) besides Wiktionary in the learner's language, shown when saving a word and on a card's back; and what a reading is called (pinyin, furigana). Text marked `ja`, `zh` or `ko` falls back to that region's faces, so a Han character takes its regional form; foreign text is `dir="auto"` where it is typed.

## Language diagnostic

A four-skill diagnostic (the kind is still `english_diagnostic`; its text says "the language you are learning") with a CEFR self-check rated per skill, never averaged into one level. The self-check's table is part of the quick version, and the levels chosen show in one line at the top of the worksheet, labelled as the learner's own estimate. Each skill's evidence card opens the matching worksheet, prefilled. Listening and reading evidence start from the video or text you practise on, so the diagnostic names them and says where to begin.

## Listening practice

A video or an audio file has a "Practise listening" tab with up's listening audit: pick a 2–4 minute clip, listen in stages with the transcript put away, and log what you missed and why. Its delayed-shadowing line records you in the browser beside "Play segment" for the 5–20 second piece you chose. "Start a 14-day experiment" adds the fourteen-day table, one row per day, each opening on its day. On a YouTube video, "Now" uses the last moment you chose, because the embedded player's position cannot be read; on an uploaded file it uses the real position.

## Unknown words: five decisions

Saving a word now asks what to do with it first: skip, infer, look it up, learn, or verify. Each decision has its short record, and the suggested meaning stays hidden until you decide (for "infer", until you have written your own guess). **Only "learn" makes review cards.** Up advises five to eight words to learn per cycle; the page says so when you pass that, but does not stop you. "Practise using it" adds a production card: your own second scenario and one easily confused expression.

The common case is one click (plans 261022-1210, phase 3). "Find words to save" asks the reading model, in the same call, for each word's sense in the learner's interface language when it is not the passage's (`gloss`), how it is said (stress or a respelling, never guessed IPA) and its collocation from the passage (`internal/capabilities/reading/terms.go`). "Learn this word" saves it to learn with that sense as its meaning, the passage's sense shown beside it, and the record prefilled (the cue is the passage sentence with the word blanked); "Other ways to keep it" opens the five decisions, prefilled the same way. A word to learn may leave its record empty: this relaxes up's "each field filled" for `learn` only (`CheckRecord`), because a required three-field form in front of every word stopped the English walkthrough's learner saving words at all.

**Mistakes from chat.** Under a chat answer, "Save mistakes to review" asks the chat model once for the mistakes the answer corrected in the learner's previous message (`POST /v1/chat/messages/{id}/corrections`, budget `generate`). The server keeps one only if the learner's message holds the wrong words (`chat.FilterCorrections`). The learner unticks any and saves the rest (`…/corrections/save`): each becomes a word to learn with origin `chat` and no document, its term the right words, its meaning why, its cue what was written, a cloze card when the corrected sentence holds the words, and optionally a production card ("You wrote: …"). They are due today and are not paced behind imports.

**An example on the card.** A recognition card for a word met in no sentence (a Library word list, an Anki deck without sentences) looks up Tatoeba's first sentence, with its translation, and Lingua Libre's first recording as the card is shown, and shows them with their credits once it is answered (`components/vocab/card-example.tsx`). "Keep this sentence" stores it as "Use this sentence" does.

## Listening cards

A word saved from a video's or a recording's transcript can get a listening card: "Practise hearing it" in Mastery → Vocabulary. The review plays the line the word came from, cut to that line (a YouTube video in its embed, an uploaded file from this site), and you type the word you hear; it is marked like a cloze. The blanked line stays hidden until you ask for it. The moment is not stored with the word: the line's current timing is read from the transcript, so a re-transcribed video still plays the right piece. If the video is deleted, the card stays and is shown as a cloze. The idea is asbplayer's sentence cards; nothing of its code is used.

## Writing cards (Chinese and Japanese)

A Chinese or Japanese word being learned that has Han characters or kana can have a writing card ("Practise writing it" in the word list, `PATCH /v1/vocab/{id} {writing}`; card kind `write`). Its front is the meaning, the reading and the sentence with the word blanked; the learner draws the word one character at a time on a pad, each stroke checked as it is drawn by [hanzi-writer](https://github.com/chanind/hanzi-writer) (MIT). A wrong stroke fades and counts as a mistake; after three misses the stroke's start is hinted, and no stroke is ever forced right. "Show the character" draws it and counts as a miss. The rating is the learner's, suggested from the mistakes: none Good, one to three Hard, more or a character shown Again.

Stroke data is served one character at a time by `/strokes/<zh|ja>/<character>` (`ui/web/app/lib/strokes.server.ts`): Chinese from Make Me A Hanzi (9,574 characters, all 3,755 of GB2312's first level), Japanese from animCJK (all 2,136 jōyō kanji with Japanese stroke forms, and 177 kana). animCJK splits a stroke that crosses itself (あ, ぬ, ね, の…) for its animation; the route joins the parts back, so every basic kana is quizzed with its standard stroke count. Both data sets are Arphic PL (animCJK's other files LGPL), staged under `/tool-runtime/` with their licence texts (THIRD-PARTY-NOTICES.md).

## Read-aloud check

Select up to 80 words while reading and choose "Check my reading aloud". You record yourself (at most 30 seconds), and the page shows which words a speech engine did not hear, heard as another word, or heard that are not in the text; each state is said in words as well as colour. The passage must be on the stored page, as for saving a word. The take is heard on your own `stt` connection, or, if you have none, on the server's built-in transcription, which spends seconds from the same daily minutes as transcribing a document; the result names which one heard it. Nothing is stored. The comparison is word by word, done by AnyTools and not by a model; a contraction said in full ("do not" for "don't") and a hyphenated word said as two count as heard, but a number said in words is shown as heard differently. This checks whether a listener understood each word, not how close your accent is. The idea is gemini-teacher's and ai-pronunciation-trainer's; nothing of their code is used.

## Anki decks in and out

Mastery → Vocabulary → Anki decks imports an Anki deck (`.apkg`) and exports the words you are learning as one. The deck is read in the browser, from its newest collection (`collection.anki21b` from Anki 2.1.50 on, else `collection.anki21` or `collection.anki2`); you say, per note type, which field is the word, which the meaning and which an example sentence, and see the first ten words before anything is sent. Each word becomes a word to learn with a fresh schedule, a recognition card always and a cloze card when the sentence holds the word; a word already in your vocabulary in that language is left as it is. Imported words come up for review 20 a day from today (from tomorrow before plans 261022-1210 phase 3, which left a first day with nothing to review), in deck order, and a second import carries on where the first left off, so a big deck does not fill Home's count or the daily reminder at once. They are not counted in the week's "five to eight". Images, sounds and Anki's review history are not imported. The export is one note type "AnyLearn word" (Term, Meaning, Sentence, Source) in a deck "AnyLearn", in Anki's schema 11, which Anki and AnkiDroid open; schedules start new there, and exporting again updates the same notes in Anki rather than doubling them. Written from Anki's documented file format and checked against genanki's schema; no Anki or genanki code is used.

## Decks: a library and general cards

Mastery → Decks holds decks that are not vocabulary (owner decision 5): their cards are a front and a back (card kind `card`, no note, in `card_decks`; `GET/POST /v1/decks`, `DELETE /v1/decks/{id}`, `POST /v1/decks/{id}/cards` in batches of 200). They are reviewed in their own queue (`GET /v1/vocab/due?deck=cards`), counted in Home's total and the daily reminder, and come up 20 new a day from today, continuing after earlier deck imports, in the deck's order; a front the deck already has is a duplicate. Deleting a deck deletes its cards.

The library (`ui/web/app/lib/deck-library.ts`) says each deck's licence before anything is fetched. A deck AnyLearn may ship is bundled as text and added in one tap: Ultimate Geography v5.3 (public domain, images excluded) in English, Spanish and Portuguese, 435–436 country ↔ capital cards, written by `ui/web/scripts/decks/ultimate-geography.mjs`. Others (non-commercial or unlicensed) are links; the learner brings the file to "From a file", which reads an `.apkg` or a CrowdAnki `.zip` in the browser, maps fields to front and back (plus one more for the back), shows the first ten and imports. A vocabulary deck still goes through Mastery → Vocabulary's importer.

Both importers read a deck lazily (zip.js over the file): only the zip's directory and the collection or `deck.json` are read and inflated, never the media, so a deck of several hundred megabytes with audio costs what its text costs.

Ultimate Geography comes as three decks in each of English, Spanish and Portuguese, with one language choice for the three: capitals (both ways), flags (221) and maps (319). A flag or map card shows its picture on the front (`vocab_cards.image`: `{src, source, licence}`, `src` a file staged under `/tool-runtime/`, the API refusing any other) and credits it on the back by its source page and licence. The pictures are extracted at build from the release zip, pinned by sha256 (`extract` in `scripts/tool-runtime.json`); SVGs are served sandboxed, so one opened directly runs nothing. Imported Anki and CrowdAnki files still leave their media out.

A learner has at most 100 decks and 50,000 general cards in all (`vocab.MaxDecksPerLearner`, `MaxDeckCardsPerLearner`; AnKing's medical deck, about 35,000 notes, fits). Both are counted under the user's row lock. A batch that reaches the cards' limit adds what fits and reports the rest as `over_limit`; the importers stop sending and say how many were not added.

## Library

Library (`/library`, under Read; the private design notes) is ready material from open sources for every profession, filtered by kind, field and language, mostly English (owner, 2026-10-21). The sixteen fields (the private design notes) are business and management, economics and finance, law, medicine and health, engineering, computing and programming, natural sciences, mathematics, social sciences, humanities and arts, education, communication and media, languages, study and life skills, general knowledge and fitness; each source's script files its items by the source's own subjects or departments. With no field and no search the first screen shows each field's first three items and a link to all of it. In any list English material comes first, then material in many languages, then the rest, and within each the sources take turns, so free-programming-books' thousands of links do not fill a page; each source's script writes its items in a featured order (MIT's courses with lecture videos, undergraduate and recent first; the Open Textbook Library's reusable books with a PDF first), so a field's first items are representative. A first screen is built once per kind and language (`findByField`); by default the learner's interface language is shown after English, and search ignores accents. The catalogue is built (`ui/web/app/lib/library/catalogue.server.ts`) from bundled data in `ui/web/app/data/library/`, each file written by a pinned script under `ui/web/scripts/library/` or `scripts/`; `ui/web/scripts/library/export.mjs` turns it into `internal/library/catalogue.json.gz` (a vitest fails when that is stale), which the API loads into Postgres at start unless the same or a later export is already loaded, or on `anytools library import` (the private design notes); until the first load the page says the Library is being loaded. One row per item holds each fact the page uses: field, kind, language, level, hours, year, certificate (free, badge, or for a fee with its price), rating and its number of reviews, popularity (views or downloads), whether the licence lets anyone reuse it; `library_item_scores` holds a textbook's average per review criterion. The page asks the API for one screen: sorted as recommended, best rated (a rating weighed by its reviews, (rating × n + 4 × 3) / (n + 3)), most used, shortest or newest, always English first, and filtered by level, certificate (any, free, for a fee), video and reusable licence. Each item shows its certificate, rating, level, hours, year and popularity first; a rated textbook's criteria fold out with a link to its reviews. Review text is the reviewers' and is not copied. Every item says its size, language, licence in words and source. One action puts it where it is used:

- **Decks**: the deck library above, added to Decks.
- **Word lists**: NGSL and NAWL (CC BY-SA 4.0), HSK 2.0 and 3.0 (meanings from CC-CEDICT, CC BY-SA), JLPT N5–N1 (Waller's lists, CC BY, with JMdict's meanings, CC BY-SA), one level (at most 1,000 words; larger ones in parts of 500) at a time into the language's words, paced 20 new a day after any import still coming up. Each word records `origin` `library:<level>` (migration 1790310000) and shows the list and its credit.
- **Question sets**: Open Trivia DB (5,295), ARC Easy and Challenge (7,752), GSM8K (8,792 word problems, marked by value) and Exercism's Python track (120), one part (at most 100) at a time into a knowledge base's Quiz (`POST /v1/quiz/starters` with `set` and `part`; duplicates by prompt). Each explanation ends with its set's credit.
- **Body**: the exercise library, opened in Body. free-exercise-db was tried and taken out: its photos and steps were scraped from bodybuilding.com.
- **Courses and videos, books**: free-programming-books (CC BY 4.0) in English, Vietnamese, Spanish and Portuguese, added to a knowledge base through the link import (a YouTube playlist becomes a feed). Project Gutenberg's most read public-domain books in nine languages, added the same way from their HTML edition.
- **Textbooks**: OpenStax's live books and the Open Textbook Library's (1,825, 1,684 in English, in every field, each with its own licence), opened at their page, with their PDF where the link is one. A whole textbook is usually past the link import's 5 MB and the 400 pages a knowledge base reads from one file (`parse.DefaultMaxPages`), so the page says to upload the chapters needed; for a book whose licence forbids commercial use it adds that the upload is for the learner's own study.
- **Courses across fields**: MIT OpenCourseWare's 2,591 courses (CC BY-NC-SA) by department, term, level and instructors, 398 with lecture videos, opened at MIT. MITx Online's 108 courses that are free to take and give a certificate for a fee (Certificate of Completion or MicroMasters credential, 29 to 1,000 USD; one gives no fee and says so), with weeks and hours, opened at MIT. From three CC0 lists in sindresorhus/awesome: awesome-math's free textbooks, notes and video courses (paid ones left out), awesome-certificates' free courses with provider, level and hours, and awesome-youtubers' channels (/c/ and /user/ links too, read from the channel's page), added through the link import (a channel as a feed). As with free-programming-books, a list's link is the owner's work, labelled "free to read or watch at its source"; the import copies the page into the learner's own knowledge base at their request, as Knowledge → Add a link does for any page.
- **Link only**: what AnyLearn may not copy (up's word lists and guide, MIT OpenCourseWare's courses, Khan Academy, the THPT exam papers, non-commercial decks) opens at its source with the reason.

Licences and changes are in `THIRD-PARTY-NOTICES.md`; share-alike data files keep their licence beside the MIT code.


**Shelves for learning a language** (plans 261022-1210, phase 6). Each item may say which language it is for learning, apart from the one it is written in (`library_items.teaches`): a French textbook in English teaches French. It is read from the title in `ui/web/app/lib/library/teaches.ts`, conservatively (a word list or deck is its own language; course and textbook titles naming a language; ESL books and MIT's ELS subjects for English, never a teacher's guide; linguistics and literature untagged). "For learning" filters by it (`?teaches=`), and then the material may be written in any language; "Language" is now "Written in". A language's tab links its shelf. Four sources for English learners were added, each licence read at its source on 2026-10-22: VOA Learning English (public domain with credit, agency stories excluded; opened at the source to choose a lesson, whose address the learner adds), Wikibooks' English as a Second Language (CC BY-SA, added as a link), Global Storybooks in English (each story CC BY or CC BY-NC, so link only) and USA Learns (free with an account, link only).
## Example sentences and recordings

A saved word's "Sentences and sound" asks, from the server and only when opened, Tatoeba for sentences with the word and their translation into the learner's language, and Wikimedia Commons for Lingua Libre's recordings (for English also Wiktionary's through the Free Dictionary API). Each shows its author, licence and page. "Use this sentence" keeps it as the word's newest context, credited (`POST /v1/vocab/{id}/sentence`), and gives a word being learned its fill-in card. `internal/connectors/wordsources` caches answers a week and plays only recordings it found; Tatoeba is slow (about 30 s on 2026-10-21) and has a 45 s timeout.

## Share to AnyLearn

With AnyLearn installed on an Android phone (Chrome → Install app), Share from YouTube, a browser or a podcast app lists AnyLearn. It opens a page that shows the link and the knowledge base you used last; Add puts the link there exactly as Knowledge → Add a link does, so a playlist or a podcast feed becomes a feed, and then opens that knowledge base. A share with no web link says so. iPhone and iPad cannot do this: Safari does not let web apps receive shares.

## Kindle and KOReader highlights

A knowledge base's Add → Highlights takes a Kindle's `documents/My Clippings.txt` or a KOReader JSON export. The file is read in the browser; you see the books and tick the ones to add, and each becomes a Markdown document (the title, the author, each highlight quoted with its page, location and date, and the note written on it), uploaded like any file, so it can be read, asked about with citations, quizzed and mined for words. Bookmarks are dropped, and a highlight edited on the Kindle is kept once, as last written. The Kindle's own wording is recognised in English, Spanish, Portuguese, French and German; an entry of a kind not recognised is kept as a highlight. Uploads are not de-duplicated, so a book whose document is already in the knowledge base is shown unticked. The idea is vocabsieve's and fyodor's; nothing of their code is used.

## Writing revision

The writing evidence worksheet keeps your unaided draft and five revision passes, each with one question. "Diagnose this pass" sends the draft to your `chat` model, which returns at most three issues, each quoting your draft, with its basis, a confidence and how it might be wrong. **It never rewrites your text**: a quote not in the draft, or one covering most of it, is dropped. You write each pass's "after" yourself. One call per diagnosis; the same draft and pass are not diagnosed twice.

## Reading in five passes

A PDF or a text document has "Read in five passes" in its activity panel: five passes, each with one job and an output box. At the fourth pass (rebuild with the text and dictionary closed) the page hides the document and the tutor until you mark it done. "Mark a barrier" on a selection adds a row to the six-layer barrier map; choosing a layer shows its next step. A barrier on the vocabulary layer offers "Save the word", which opens the word picker on that passage.

## Grammar evidence and the error map

Up's grammar evidence template, and an error map with contrast cards built from the grammar chapter's error and contrast sections, since up has no template for it.

## Speaking recordings

The speaking evidence worksheet records in the browser: baseline and retest takes, and a five-level shadowing ladder from imitation to your own sentences. If level four fails, the ladder asks you to shorten and rebuild from three keywords. **Limits:** 10 minutes per recording, 30 per worksheet, 500 MB per person. **Recordings are raw audio, kept until you delete them**, the worksheet, the document it is attached to, or your account. Only you can play them. The microphone is allowed for this site only.

## Projects and case reviews

An artifact brief (with reviews after delivery), a job-search English evidence card, an AI case review, an AI project scorecard, and a narrative case review. The narrative review is private, like the life toolkit.

Four more follow up's newer templates:

- **A consistency plan.** Started from a learning state, its three versions are prefilled from the state's next task and minimum, for you to confirm.
- **An AI evaluation.** The pass rate per version counts failures and timeouts.
- **An AI trend radar.**
- **A startup experiment.**

## Life toolkit

A choice brief, an attention audit, a relationship conversation card, a recovery reset, the five weekly questions, a care and shared responsibility card, and the self-reflection cards from up's part 6. **They are private**: their words never reach a model, a resume text, evidence suggestions, review or chain pages, or Home's due list. Up's warnings apply: do not record other people's information without their consent, and seek qualified help when anyone is in danger. They are not encrypted at rest; that is a later upgrade.

## Day-90 close

From day 84 of a cycle, its page offers "Close this cycle": up's four columns (ability, artifact, cost, unknowns), its six questions, and one destination for every result: continue, transfer, repair or stop. A "stop" needs its three actions (the grounds, where reusable material is archived, who was told). The next cycle starts from the results you continue or transfer.

## Write your own version first

With Settings → Account → "Write your own version first" on, Chat and Solve ask for three short lines before sending: what you understand now, what you are least sure of, and what would show you have learned it. The server refuses a message without them. After the answer you can write a retell.

## Review everything due

When due points span two or more mastery paths, Home and Mastery offer "Review everything due". The session never serves two points of the same module in a row while another module has something due, and each item names its path and module. Explain-backs stay in their path.

## Language

AnyLearn is written in English, Vietnamese, Spanish and Portuguese. A new account starts in the language its sign-in page was shown in (the language menu there, or the page you came from); Settings → Account changes it, and the review reminder follows it. The Toolkit's worksheets are in it too, their exports included; what you write in them stays as you wrote it. Your documents can be in any language, and chat answers in the language you ask in.

## Review reminder

Settings → Reminders sends one notification a day, at the hour you choose in your own time zone, saying how many things are due for review and, if your training week schedules a workout today that is not done yet, which one; tapping it opens Home. Nothing is sent on a day with neither. When a study streak is running, the reminder ends with how long it is. It is a web push to each browser you turn it on in, so it needs no account anywhere. On iPhone and iPad it works only once AnyLearn is on the Home Screen (Share, then Add to Home Screen); Settings → Reminders shows how, and Home says so once in Safari. The count is Home's "Due for review" total: mastery points, mistakes to practise, skill-card retests, vocabulary, book cards and worksheet reviews.

## Learning methods

`/methods` explains how to study so that it lasts, drawing on research
(the private design notes; research in
the private design notes).

The methods are grouped by how strong the evidence is:

- **Strong:** testing yourself, spacing study out, judging by tests rather than by feeling, and sleep.
- **Moderate:**
  - interleaving
  - asking why and how
  - explaining in your own words (the Feynman technique)
  - worked and concrete examples
  - words with pictures
  - trying before being told
  - practising weak spots
- **Limited:** focus blocks with breaks (Pomodoro).
- **Myths:** learning styles, and rereading and highlighting.

Each method's page has:

- what it is, why it works, four steps, the usual mistake, and one thing to try today
- links to where AnyLearn does it
- the studies, each with a DOI checked against Crossref
- videos: the learner's language first, then English

Each video sits behind a play button that loads YouTube's privacy-enhanced player, links to
YouTube, and has an "Add to my knowledge" button. That button puts the video into a knowledge
base named "Learning methods" (made the first time), in the learner's language, through the link
import, so its captions become a document to quiz and ask about.

A "Search YouTube for more" link opens YouTube's own search in the learner's words; there is no
live search on the server. `ui/web/scripts/methods/videos.mjs` checks the pinned videos again
(public, embeddable, spoken language).

## Progress and study circles

**Progress** (`/progress`) counts what you have done from the work itself
(the private design notes):

- **A study day** is a day, in your time zone, with at least one of these:
  - a card review (words, decks, book cards)
  - an answered question (quizzes, mastery, mistakes, exams)
  - an explain-back
  - a finished workout
  - a speaking recording
  - a reading highlight
  - a skill-card entry

  Days before yesterday are kept as counted, so deleting a deck does not unmake the days you
  studied it.
- **Streak.** Each week (Monday first) forgives up to your rest days (0 to 2, one by default).
  A missed day uses one of them and the streak goes on; one more ends it. Today not studied yet
  never breaks it.
- **Weekly goal.** You choose 1 to 7 study days a week (four by default). The page shows the
  weeks in a row you met it.
- **Level** is a number of study days: 1, 3, 7, 14, 30, 60, 100, 150, 200, 300, 365, 500, 730
  and 1,000. It never goes down.
- **What the studying produced:**
  - cards in long-term memory (a stability of 21 days or more) out of those being learnt
  - knowledge points mastered
  - the share answered right in the last 30 days
  - workouts, recordings, highlights and explain-backs passed

  Each links to its page.
- **Also on the page:** a year's calendar, the last twelve weeks, and milestones with the day
  each was first reached.

Home's facts line shows the streak, the week and the level. When a streak is running, the
review reminder says how long it is.

**Study with friends** (`/circles`):

- Start a circle and send its invite link (`/circles?join=CODE`) to a friend, or join one by its
  code. A circle holds up to 20 members, and you can be in up to 10 circles.
- Each member picks the name the circle sees. Members see each other's study days this week
  against their goal, streak, level and last study day. Nobody sees what anyone studies, their
  documents or their email.
- You can cheer each member on once a day; cheers show on the circle, on `/circles` and on Home.
- There is no ranking. The circle's goal is that everyone meets their own week.
- The earliest member owns the circle: they rename it, make a new code (the old link stops
  working) and remove members. When the owner leaves, the next earliest member owns it; when the
  last member leaves, the circle is deleted.

## Public profile

`/showcase` makes a page of the learner's own at `/u/<handle>`, to send to someone as proof
of how they study or to show it off (the private design notes).

- **What is on it.**
  - The learner's own words: a name, a headline, up to three "about" blocks and up to five
    links. They are marked as theirs.
  - What AnyLearn counted, which they cannot edit: study days, the streak, weeks meeting the
    goal, the level, the year's calendar, the milestones with their dates, and outcomes. The
    page says the day these are counted through. Outcomes are totals, never a share right.
- **Private by default.**
  - Nothing is public until "Public" is ticked and saved. An unpublished page and a missing
    one are the same 404.
  - Search: "Let Google and other search engines show it" is ticked for a new page, and the
    learner can untick it. A public page with it ticked is in `sitemap.xml` (robots.txt
    allows `/u/`) and has:
    - a canonical address per language (`/u/<handle>?lang=vi`, …), with the bare address as
      `x-default`;
    - hreflang links between them;
    - a schema.org `ProfilePage` naming the person and their links.

    Without it, the page says `noindex` and is shared by its link only.
  - The server sends only the data of the blocks on the page, so a hidden calendar never
    leaves it.
  - Deleting the page, or the account, frees the handle.
- **Sharing.** Copy the link. A shared link unfurls into a card (`/u/<handle>/og.png`) with
  the name, the headline and, only if the page shows them, study days, streak and level.
- **The design is a document.** A page is a versioned JSON document: a `theme` (an accent,
  one of the five part colours) and `blocks` in order. The editor adds, removes and orders
  blocks and picks the accent, with a live preview.

### Extending the design

The page was built so learners can design more of it later without rework:

| To add | Server (`internal/showcase/design.go`) | Web |
|---|---|---|
| A block type | an entry in `blockSpecs` (how many, whether it shows counted data, its `fields`, a `check` for them) | `BLOCK_SPECS` in `app/lib/showcase/design.ts`, a view in `BLOCK_VIEWS` (`components/showcase/showcase-view.tsx`), its words in `showcase.json` |
| A block option | a field on `Block`, its JSON name in that type's `fields`, checked in its `check` | a control in `BlockFields` (`routes/showcase.tsx`), used by the view |
| A theme option | a field on `Theme`, checked in `Design.check` | applied on `ShowcaseView`'s wrapper; a control under "Look" |
| A change to stored pages | `DesignVersion + 1` and a case in `upgrade` that rewrites the old version | `DESIGN_VERSION` |

- On save, unknown types and fields (and a field its type does not take) are refused, never
  dropped, so a page cannot carry markup or styles the server did not check. Text with a
  control, direction or zero-width character is refused too.
- A stored page is read leniently, so a rule tightened later does not empty pages saved
  before it. A block the running version cannot take is left out and the editor says so. A
  design it cannot read at all shows no blocks, never blocks the learner may have hidden.
- A milestone goes out as its kind, target and date only, never the learner's current total.
  A page with no counted block is not counted at all.
- `app/test/showcase.test.tsx` fails when the two registries disagree.

## Bad-day minimum

A learning state has a minimum contract: when to downshift, what is still worth keeping on a bad day, and when to ask for help. Home's "Today" shows the next task and its minimum; switching on "Low day" shows only the minimum. An interruption records up's six lines (what happened, the resistance, the task reduced to, within 24 hours, what not to repay, a review date). Three interruptions with the same resistance bring up's advice to change the conditions, with links to the cycle's weekly capacity and to a recovery reset. **"When to ask for help" is never sent to a model**; the other two answers go with a state-linked chat.

## Audio and video files

Upload `.mp3 .wav .m4a .ogg .oga .opus .webm .mp4 .mpeg .mov` (up to 500 MB). The file plays in the page, and its transcript is cited by the second. Nothing is transcribed until you choose an engine and see its cost or time first:

- **Built-in (free, slower):** the server's own Whisper, when it runs one, within your daily minutes (120 by default).
- **Your `stt` key:** Groq (whose free tier is on your own account), OpenAI, or your own OpenAI-compatible Whisper server; Gemini reads the file through its Files API, and the file is deleted there afterwards.
- **A subtitle file or a pasted transcript**, free.

The transcript is labelled "AI transcript" and names its engine. A YouTube video without captions gets the same choice; the built-in engine fetches its audio to a temporary file only to transcribe it. YouTube may block a data-centre server; the page then offers Gemini on the video's URL, an upload, or a pasted transcript.

## Photos of pages and notes

Upload `.png .jpg .jpeg .webp .heic` (up to 20 MB each), each as its own document or up to 30 as one document, a page per photo. Your browser scales a large photo down and drops its location data before upload (a HEIC photo outside Safari is uploaded as it is). Your `parse` model reads each photo, handwriting included, and marks what it cannot read; the page shows each photo beside its reading, so you can check it.

## Podcast feeds and YouTube playlists

"Add a link" takes a podcast feed, a YouTube playlist or a channel (up to 20 feeds per knowledge base). The feed's page lists its episodes; you tick the ones to add. A podcast episode becomes an audio file and a YouTube entry a video; neither is transcribed automatically. Feeds are checked daily and new entries are marked "New"; with auto-add on, new entries are added, at most 5 per feed a day. Without a key, YouTube lists only a playlist's latest 15 videos; a **YouTube Data API key** (Settings → Search keys) lists up to 500.

## Documentation sites and GitHub repositories

**A site:** a start URL, a depth (0–3) and a page limit (50 by default, at most 200). AnyLearn follows links under the start URL's path, obeys `robots.txt`, and fetches politely. Each page is a document cited by its URL; sites re-sync weekly, and pages that disappear are marked, never silently deleted.

**A repository:** a GitHub URL, an optional branch, folder and file types (documentation files by default; code files if you add them). Caps: 2 MB per file, 2,000 files and 100 MB per repository. A private repository needs a **GitHub token** (fine-grained, read-only contents) under Settings → Search keys. Re-sync checks the latest commit and re-indexes only changed files.

Every page and file is embedded on your `embed` key; nothing else calls a model.

## Spreadsheets

Upload `.xlsx`, `.csv` or `.tsv` (up to 50 MB). Each visible sheet becomes a page headed with its name, read locally with no model; hidden sheets are skipped and the page says so. Dates read as the sheet shows them, long numbers keep every digit, and formulas show their last value. Citations name the sheet.

## Zotero

With your Zotero user id and a read-only API key (Settings → Search keys), a knowledge base can add items from your library: one with a PDF in your Zotero storage comes in as that file (up to 50 MB), any other as a note with its metadata, abstract and link. An item is added once. Research may also search your library while a connection exists.

## Body: training beside studying

Body keeps a training log in the same app, because the mind that studies lives in a body that needs moving. Its behaviour follows [openGym](https://github.com/DuarteSantos8/openGym), rewritten (openGym is AGPL-3.0; nothing of its code is reused).

- **Plan.** Routines of exercises from a 1,324-exercise library (exercise names and steps in English, text only; some names in Spanish and Portuguese from wger, CC BY-SA, credited, with a link to wger's page and its video; body parts, equipment and muscles in your language), each logged as weight × reps, a timed hold, or cardio. Each weekday trains one routine or rests.
- **Workout.** Today's routine starts with every target already worked out. Ticking a set starts the rest timer, the screen stays on while the session is open, and finishing it names any new best set (a lift's first session sets its starting point and is not a record).
- **Progression.** Worked out from the log every time, never stored. Linear adds a step when every rep of every set was done; double climbs a rep range first; a timed hold adds seconds; body-weight work adds reps. A step is 5 kg (10 lb) for legs and 2.5 kg (5 lb) for everything else. A set not ticked, or short, is a miss; three misses in a row bring the weight down about 10 %. Each target says why in a sentence.
- **Progress.** A year heatmap of minutes trained, body weight against a goal, an estimated one-rep max per lift (Epley, not above 12 reps), and the sets each muscle group got in 7 and 30 days (a set counts once for the exercise's target muscle and half for each secondary one).
- **Coach.** On your `chat` model: a plan from a short intake (goal, experience, days, minutes, equipment, limits), a review of the last eight weeks that may answer "no change", and revisions in your own words. Each answer is checked against the library and the plan's limits, with one repair; the coach never sets a load for an exercise you have not lifted. It waits for Accept, and an accepted change can be undone. It sends your plan, logged sets, weigh-ins and intake answers, and nothing else of AnyLearn: not your name, your email or your documents.
- **With the studying.** Home shows "Body today" after what is due. On a low day it asks only for ten minutes of easy movement. Units are kg or lb; switching converts everything logged. The daily reminder (Settings → Reminders) also names the workout your week schedules today, until it is done.
