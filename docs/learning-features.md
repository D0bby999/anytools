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
| Languages (one page) | Languages, on the rail in Practise; a tab per language | Nothing: it links what is below |
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

## Maths answers, marked by value

A short or cloze question whose recorded answer is an expression or an equation is marked in Go, with no model call (`internal/capabilities/quiz/mathcheck`): both are evaluated at the same 24 sample points, so `2(x+1)`, `2x + 2` and `\frac{4x+4}{2}` are one answer, an equation equals any rearrangement of itself, and `x = 3` equals `3`. A bare number is compared by value when the reply is a number. The notation read is what people type and what MathLive writes: decimal commas, implicit multiplication, `^`, roots, `|x|`, the usual functions, π and a LaTeX subset. When the question asks to simplify, factorise or expand, an equal answer in another form is "Almost": right, scheduled as Hard. Units, matrices, intervals, solution sets, inequalities and proofs go to the model as before (owner decision 3).

The card offers a MathLive field for such a question (`math: true` in the question's view; the library is a lazy chunk, its fonts under `/tool-runtime/`), which works as a plain box until it loads. A reply the checker cannot read is not marked: the API answers 422 `unreadable_math` when the card asks (`ask_if_unreadable`), and the learner fixes it or sends it as text to the model. An exam's marking does not ask, so its unreadable answers go to the model.

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

Nothing in the toolkit calls a model, except a writing diagnosis that you ask for. **Worksheets are stored like notes: readable by the server, not encrypted at rest.** Do not put passwords, ID numbers, exact addresses or medical details in them.

## Languages, in one place

The Languages page (`/languages`) gathers the language practice below by skill, for every language the learner studies, not only English. A first visit asks which languages: those of the saved words are suggested and ticked, then the often learned, then a search over every ISO 639-1 language, named by the browser (`Intl.DisplayNames`). Each studied language is a tab with its words due; the page opens on the tab viewed last. The list lives in `vocab_languages` (`GET`/`PUT /v1/vocab/languages`); taking a language off hides its tab and keeps its words, which carry their own language as before.

A language's tab puts its vocabulary first, with "Review these" opening Mastery → Vocabulary narrowed to that language (`GET /v1/vocab/due?lang=`), then the diagnostic (a diagnostic started here is titled with the language), then listening, reading, speaking, writing, grammar and language for work. It adds no practice of its own; a listening or reading worksheet still starts from its video or document. The old `/english` answers with English's tab and adds English to the list.

Each language has a small profile in `ui/web/app/lib/languages.ts`: a dictionary to look a word up in (Jisho, MDBG, Naver, Cambridge, WordReference) besides Wiktionary in the learner's language, shown when saving a word and on a card's back; and what a reading is called (pinyin, furigana). Text marked `ja`, `zh` or `ko` falls back to that region's faces, so a Han character takes its regional form; foreign text is `dir="auto"` where it is typed.

## Language diagnostic

A four-skill diagnostic (the kind is still `english_diagnostic`; its text says "the language you are learning") with a CEFR self-check rated per skill, never averaged into one level. Each skill's evidence card opens the matching worksheet, prefilled. Listening and reading evidence start from the video or text you practise on, so the diagnostic names them and says where to begin.

## Listening practice

A video or an audio file has a "Practise listening" tab with up's listening audit: pick a 2–4 minute clip, listen in stages with the transcript put away, and log what you missed and why. Its delayed-shadowing line records you in the browser beside "Play segment" for the 5–20 second piece you chose. "Start a 14-day experiment" adds the fourteen-day table, one row per day, each opening on its day. On a YouTube video, "Now" uses the last moment you chose, because the embedded player's position cannot be read; on an uploaded file it uses the real position.

## Unknown words: five decisions

Saving a word now asks what to do with it first: skip, infer, look it up, learn, or verify. Each decision has its short record, and the suggested meaning stays hidden until you decide (for "infer", until you have written your own guess). **Only "learn" makes review cards.** Up advises five to eight words to learn per cycle; the page says so when you pass that, but does not stop you. "Practise using it" adds a production card: your own second scenario and one easily confused expression.

## Listening cards

A word saved from a video's or a recording's transcript can get a listening card: "Practise hearing it" in Mastery → Vocabulary. The review plays the line the word came from, cut to that line (a YouTube video in its embed, an uploaded file from this site), and you type the word you hear; it is marked like a cloze. The blanked line stays hidden until you ask for it. The moment is not stored with the word: the line's current timing is read from the transcript, so a re-transcribed video still plays the right piece. If the video is deleted, the card stays and is shown as a cloze. The idea is asbplayer's sentence cards; nothing of its code is used.

## Writing cards (Chinese and Japanese)

A Chinese or Japanese word being learned that has Han characters or kana can have a writing card ("Practise writing it" in the word list, `PATCH /v1/vocab/{id} {writing}`; card kind `write`). Its front is the meaning, the reading and the sentence with the word blanked; the learner draws the word one character at a time on a pad, each stroke checked as it is drawn by [hanzi-writer](https://github.com/chanind/hanzi-writer) (MIT). A wrong stroke fades and counts as a mistake; after three misses the stroke's start is hinted, and no stroke is ever forced right. "Show the character" draws it and counts as a miss. The rating is the learner's, suggested from the mistakes: none Good, one to three Hard, more or a character shown Again.

Stroke data is served one character at a time by `/strokes/<zh|ja>/<character>` (`ui/web/app/lib/strokes.server.ts`): Chinese from Make Me A Hanzi (9,574 characters, all 3,755 of GB2312's first level), Japanese from animCJK (all 2,136 jōyō kanji with Japanese stroke forms, and 177 kana). animCJK splits a stroke that crosses itself (あ, ぬ, ね, の…) for its animation; the route joins the parts back, so every basic kana is quizzed with its standard stroke count. Both data sets are Arphic PL (animCJK's other files LGPL), staged under `/tool-runtime/` with their licence texts (THIRD-PARTY-NOTICES.md).

## Read-aloud check

Select up to 80 words while reading and choose "Check my reading aloud". You record yourself (at most 30 seconds), and the page shows which words a speech engine did not hear, heard as another word, or heard that are not in the text; each state is said in words as well as colour. The passage must be on the stored page, as for saving a word. The take is heard on your own `stt` connection, or, if you have none, on the server's built-in transcription, which spends seconds from the same daily minutes as transcribing a document; the result names which one heard it. Nothing is stored. The comparison is word by word, done by AnyTools and not by a model; a contraction said in full ("do not" for "don't") and a hyphenated word said as two count as heard, but a number said in words is shown as heard differently. This checks whether a listener understood each word, not how close your accent is. The idea is gemini-teacher's and ai-pronunciation-trainer's; nothing of their code is used.

## Anki decks in and out

Mastery → Vocabulary → Anki decks imports an Anki deck (`.apkg`) and exports the words you are learning as one. The deck is read in the browser, from its newest collection (`collection.anki21b` from Anki 2.1.50 on, else `collection.anki21` or `collection.anki2`); you say, per note type, which field is the word, which the meaning and which an example sentence, and see the first ten words before anything is sent. Each word becomes a word to learn with a fresh schedule, a recognition card always and a cloze card when the sentence holds the word; a word already in your vocabulary in that language is left as it is. Imported words come up for review 20 a day from tomorrow, in deck order, and a second import carries on where the first left off, so a big deck does not fill Home's count or the daily reminder at once. They are not counted in the week's "five to eight". Images, sounds and Anki's review history are not imported. The export is one note type "AnyLearn word" (Term, Meaning, Sentence, Source) in a deck "AnyLearn", in Anki's schema 11, which Anki and AnkiDroid open; schedules start new there, and exporting again updates the same notes in Anki rather than doubling them. Written from Anki's documented file format and checked against genanki's schema; no Anki or genanki code is used.

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

Settings → Reminders sends one notification a day, at the hour you choose in your own time zone, saying how many things are due for review and, if your training week schedules a workout today that is not done yet, which one; tapping it opens Home. Nothing is sent on a day with neither, and there are no streaks. It is a web push to each browser you turn it on in, so it needs no account anywhere. On iPhone and iPad it works only once AnyLearn is on the Home Screen (Share, then Add to Home Screen); Settings → Reminders shows how, and Home says so once in Safari. The count is Home's "Due for review" total: mastery points, mistakes to practise, skill-card retests, vocabulary, book cards and worksheet reviews.

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

- **Plan.** Routines of exercises from a 1,324-exercise library (exercise names and steps in English, text only; body parts, equipment and muscles in your language), each logged as weight × reps, a timed hold, or cardio. Each weekday trains one routine or rests.
- **Workout.** Today's routine starts with every target already worked out. Ticking a set starts the rest timer, the screen stays on while the session is open, and finishing it names any new best set (a lift's first session sets its starting point and is not a record).
- **Progression.** Worked out from the log every time, never stored. Linear adds a step when every rep of every set was done; double climbs a rep range first; a timed hold adds seconds; body-weight work adds reps. A step is 5 kg (10 lb) for legs and 2.5 kg (5 lb) for everything else. A set not ticked, or short, is a miss; three misses in a row bring the weight down about 10 %. Each target says why in a sentence.
- **Progress.** A year heatmap of minutes trained, body weight against a goal, an estimated one-rep max per lift (Epley, not above 12 reps), and the sets each muscle group got in 7 and 30 days (a set counts once for the exercise's target muscle and half for each secondary one).
- **Coach.** On your `chat` model: a plan from a short intake (goal, experience, days, minutes, equipment, limits), a review of the last eight weeks that may answer "no change", and revisions in your own words. Each answer is checked against the library and the plan's limits, with one repair; the coach never sets a load for an exercise you have not lifted. It waits for Accept, and an accepted change can be undone. It sends your plan, logged sets, weigh-ins and intake answers, and nothing else of AnyLearn: not your name, your email or your documents.
- **With the studying.** Home shows "Body today" after what is due. On a low day it asks only for ten minutes of easy movement. Units are kg or lb; switching converts everything logged. The daily reminder (Settings → Reminders) also names the workout your week schedules today, until it is done.
