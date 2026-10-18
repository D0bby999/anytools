package knowledge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/D0bby999/anytools/internal/authz"
	"github.com/D0bby999/anytools/internal/blob"
	mediafile "github.com/D0bby999/anytools/internal/connectors/media"
	"github.com/D0bby999/anytools/internal/connectors/youtube"
	"github.com/D0bby999/anytools/internal/media"
	"github.com/D0bby999/anytools/internal/providers"
	"github.com/D0bby999/anytools/internal/rag/parse"
)

// media_files.go — an uploaded audio or video file as a document
// (up-methods phase 15).
//
// up's listening template starts from a real clip, often a podcast, a
// recorded class or a meeting. Such a file is uploaded like a document but
// treated like a captionless video: it rests in needs_transcript, and the
// learner gives it a transcript the same three ways (an AI transcript by an
// engine they pick after seeing its cost, a subtitle file, or a paste). The
// transcript then becomes what the document parses, cites and shows, and
// the recording stays beside it for the viewer's native player.
//
// The engines are phase 21's. The built-in Whisper and the learner's speech
// key hear the stored recording, cut by the same ffmpeg step a video's audio
// is; the learner's Gemini key hears it through Gemini's Files API
// (connectors/media). Every engine's windows end as youtube.Parts, merged by
// youtube.Merge in FinishTranscription.

// ErrMediaTooLarge refuses a recording over MaxMediaBytes.
var ErrMediaTooLarge = fmt.Errorf("knowledge: audio and video files must be %d MB or smaller", MaxMediaBytes>>20)

// ErrNotRecording: the document has no recording to play.
var ErrNotRecording = errors.New("knowledge: this document is not an uploaded recording")

// LinkNotTranscribing refuses a cancel when no transcription is running.
const LinkNotTranscribing = "not_transcribing"

// mediaWaitingSentence is a new recording's needs_transcript reason.
const mediaWaitingSentence = "This recording has no transcript yet."

const unknownLengthSentence = "This file's length could not be read from it, so what a transcript costs is not known in advance. Confirm to go on."

// Gemini's documented token rates: a second of audio is 32 tokens
// (https://ai.google.dev/gemini-api/docs/audio, read 2026-10-16); a second of
// video at low media resolution about 100 (youtube.TokensPerSecond).
const audioTokensPerSecond = 32

func tokensPerSecond(doc *Document) int {
	if doc.SourceKind == SourceMedia && strings.HasPrefix(doc.MediaMIME, "audio/") {
		return audioTokensPerSecond
	}
	return youtube.TokensPerSecond
}

// uploadMedia stores a recording and its document, waiting for a transcript.
// Nothing is transcribed here: the learner chooses an engine on the page.
func (s *Service) uploadMedia(ctx context.Context, userID, kbID uuid.UUID, filename string, data []byte) (*UploadResult, error) {
	return s.storeMedia(ctx, userID, kbID, filename, filename, data)
}

// storeMedia is uploadMedia with the document's title apart from the name
// the bytes are sniffed by (a podcast episode is titled by its feed).
func (s *Service) storeMedia(ctx context.Context, userID, kbID uuid.UUID, filename, title string, data []byte) (*UploadResult, error) {
	deps, err := s.linkDeps()
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > MaxMediaBytes {
		return nil, ErrMediaTooLarge
	}
	format, ok := mediafile.Sniff(filename, data)
	if !ok {
		return nil, fmt.Errorf("%w: the file's contents are not the audio or video its name says", parse.ErrUnsupportedType)
	}
	media := &VideoMedia{}
	if seconds, ok := mediafile.Duration(format, data); ok {
		media.DurationSeconds = int(math.Ceil(seconds))
	}

	digest, err := s.blobs.PutOriginal(ctx, userID, data)
	if err != nil {
		return nil, err
	}
	size := int64(len(data))
	doc, err := deps.Store.CreateLinkDocument(ctx, Document{
		UserID: userID, KBID: kbID, SourceKind: SourceMedia, Title: documentTitle(title),
		MIME: format.MIME, Bytes: size, SHA256: digest,
		MediaSHA256: digest, MediaMIME: format.MIME, MediaBytes: size,
		Status: StatusNeedsTranscript, Error: mediaWaitingSentence, Media: media,
	})
	if err != nil {
		s.dropOriginalIfUnused(ctx, userID, digest)
		return nil, err
	}
	s.events.PublishStatus(userID, kbID, doc.ID, StatusNeedsTranscript, doc.Error, nil)
	return &UploadResult{Document: doc}, nil
}

// openRecording opens a media document's stored recording for a
// transcription, streamed rather than read into memory. A recording gone
// from its store is unreadable for good; any other failure may pass, and
// the job retries.
func (s *Service) openRecording(ctx context.Context, doc *Document) (*blob.File, error) {
	if doc.MediaSHA256 == "" {
		return nil, errTerminal{errAudioUnavailable}
	}
	f, err := s.blobs.OpenOriginal(ctx, doc.UserID, doc.MediaSHA256)
	if _, ok := blob.Unavailable(err); ok {
		// In the learner's Drive, and out of reach until they act: another
		// attempt now would meet the same answer (drive-user-storage
		// phase 3).
		return nil, errTerminal{err}
	}
	if errors.Is(err, blob.ErrNotFound) {
		return nil, errTerminal{fmt.Errorf("%w: the recording is missing", media.ErrUnreadable)}
	}
	if err != nil {
		return nil, err
	}
	return f, nil
}

// materializeRecording copies a recording into a job directory for ffmpeg
// and ffprobe, which need a path; the directory's cleanup removes it.
func (s *Service) materializeRecording(ctx context.Context, doc *Document, dir string) (string, error) {
	f, err := s.openRecording(ctx, doc)
	if err != nil {
		return "", err
	}
	defer f.Close()
	return media.Materialize(dir, "recording", f)
}

// Recording is an uploaded recording opened for playback.
type Recording struct {
	Content io.ReadSeekCloser
	MIME    string
	Digest  string
	ModTime time.Time
}

// OpenRecording opens a media document's recording. A document of any other
// kind has none.
func (s *Service) OpenRecording(ctx context.Context, userID, docID uuid.UUID) (*Recording, error) {
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return nil, err
	}
	if doc.SourceKind != SourceMedia || doc.MediaSHA256 == "" {
		return nil, ErrNotRecording
	}
	f, err := s.blobs.OpenOriginal(ctx, userID, doc.MediaSHA256)
	if blob.Gone(err) {
		return nil, ErrNotRecording
	}
	if err != nil {
		return nil, err
	}
	return &Recording{Content: f, MIME: doc.MediaMIME, Digest: doc.MediaSHA256, ModTime: doc.CreatedAt}, nil
}

// ─────────────────────────────────────────────────────────────── cancel

// TranscriptionJobs finds and stops a document's transcription
// (jobs.Queue's ActiveFor and RequestCancel).
type TranscriptionJobs interface {
	ActiveFor(ctx context.Context, userID uuid.UUID, kind string, documentID uuid.UUID) (uuid.UUID, bool, error)
	RequestCancel(ctx context.Context, userID, jobID uuid.UUID) (bool, error)
}

// CancelTranscription asks a running transcription to stop after the window
// in flight (jobs.RunUnits checks between windows). The windows already
// heard are dropped with it, and the document goes back to needs_transcript.
func (s *Service) CancelTranscription(ctx context.Context, userID, docID uuid.UUID) error {
	deps, err := s.linkDeps()
	if err != nil {
		return err
	}
	doc, err := s.store.GetDocument(ctx, userID, docID)
	if err != nil {
		return err
	}
	if !doc.Timed() {
		return linkErr(LinkNotVideo, "that document is not a video or a recording", nil)
	}
	if deps.Jobs == nil {
		return ErrLinksUnavailable
	}
	for _, kind := range []string{jobKindTranscribeVideo, jobKindTranscribeBuiltin} {
		id, ok, err := deps.Jobs.ActiveFor(ctx, userID, kind, docID)
		if err != nil {
			return err
		}
		if !ok {
			continue
		}
		if stopped, err := deps.Jobs.RequestCancel(ctx, userID, id); err != nil || stopped {
			return err
		}
	}
	return linkErr(LinkNotTranscribing, "nothing is transcribing this now", nil)
}

// ──────────────────────────────────────────── Gemini, through its Files API

// FileUpload is a recording to send to Gemini's Files API. Open is called
// for each upload made (a key that refuses it hands the next key a fresh
// reader).
type FileUpload struct {
	Open func() (io.ReadCloser, error)
	Size int64
	MIME string
	Name string
}

// FileTranscribers is the learner's Gemini keys hearing an uploaded file.
// Wired to byok in internal/app; this package never sees a key.
type FileTranscribers interface {
	// OpenFile starts a session. Nothing is uploaded until a window needs it.
	OpenFile(ctx context.Context, userID uuid.UUID, f FileUpload) (FileSession, error)
}

// FileSession is one job attempt's uploaded copy of a recording.
type FileSession interface {
	// TranscribeWindow hears one window. billed counts the provider calls
	// made, even when it fails.
	TranscribeWindow(ctx context.Context, w youtube.Window) (part *youtube.Part, billed int, err error)
	// Close deletes every copy the session uploaded.
	Close(ctx context.Context)
}

// probeRecording asks ffprobe for a recording's length, from a copy in a
// job directory of its own.
func (s *Service) probeRecording(ctx context.Context, doc *Document) (float64, bool) {
	dir, cleanup, err := media.JobDir(s.links.Audio.TmpRoot, "probe-"+doc.ID.String())
	if err != nil {
		return 0, false
	}
	defer cleanup()
	path, err := s.materializeRecording(ctx, doc, dir)
	if err != nil {
		return 0, false
	}
	d, err := s.links.Audio.Media.Duration(ctx, path)
	return d, err == nil
}

// runGeminiFile is one attempt of a Gemini job on a recording: upload it
// once, hear each window as a unit (a retry resumes after the stored ones),
// and delete the upload before returning, whatever happened.
func (s *Service) runGeminiFile(ctx context.Context, doc *Document, p TranscribeJobPayload, run AudioUnits) (int, error) {
	deps := s.links
	// Opened once up front, so a recording gone from its store fails the
	// job before anything is uploaded.
	f, err := s.openRecording(ctx, doc)
	if err != nil {
		return 0, err
	}
	f.Close()
	seconds := p.DurationSeconds
	if seconds <= 0 && deps.Audio != nil && deps.Audio.Media != nil {
		// The header did not say; ffprobe may, and a long file is then
		// windowed instead of asked for in one answer.
		if d, ok := s.probeRecording(ctx, doc); ok {
			seconds = int(math.Ceil(d))
		}
	}
	windows, err := youtube.Windows(seconds)
	if err != nil {
		return 0, errTerminal{err}
	}

	sess, err := deps.FileTranscribers.OpenFile(ctx, doc.UserID, FileUpload{
		Open: func() (io.ReadCloser, error) {
			f, err := s.openRecording(ctx, doc)
			if err != nil {
				return nil, err
			}
			return f, nil
		},
		Size: doc.MediaBytes, MIME: doc.MediaMIME, Name: "anytools-recording",
	})
	if err != nil {
		return 0, err
	}
	defer sess.Close(context.WithoutCancel(ctx))

	err = run(len(windows), func(ctx context.Context, i int) (int, error) {
		part, billed, err := sess.TranscribeWindow(ctx, windows[i])
		if err != nil {
			return billed, err
		}
		raw, err := json.Marshal(part)
		if err != nil {
			return billed, err
		}
		return billed, deps.Objects.PutObject(ctx, doc.UserID, transcriptObjects, windowObject(p.DocumentID, i), raw)
	})
	return len(windows), err
}

// recordingSentence is the needs_transcript reason for a recording whose
// transcription stopped.
func recordingSentence(engine string, err error) string {
	var he *providers.HTTPError
	switch {
	case err != nil && err.Error() == "cancelled":
		return "The transcription was cancelled."
	case errors.Is(err, mediafile.ErrFileFailed):
		return "Gemini could not process this file. Try another engine, or upload subtitles or paste the transcript."
	case errors.Is(err, youtube.ErrTooLong):
		return "This recording is too long to transcribe here."
	case errors.Is(err, authz.ErrNoAccess):
		return "The recording is no longer available."
	case engine == EngineGemini && errors.As(err, &he) && he.Status == 429:
		return "Gemini's limit was reached. Try again later, or choose another engine."
	case engine == EngineGemini && errors.As(err, &he) && (he.Status == 401 || he.Status == 403):
		return "Gemini refused the request. Check the key on your Speech to text or Parse route, or choose another engine."
	case engine == EngineGemini && errors.As(err, &he) && he.Status >= 400 && he.Status < 500:
		return "Gemini could not read this file. Try another engine, or upload subtitles or paste the transcript."
	case engine == EngineGemini && (errors.Is(err, youtube.ErrNoTranscript) || errors.Is(err, youtube.ErrEmptyTranscript)):
		return "Gemini returned no usable transcript. Try again, or choose another engine."
	case engine == EngineGemini:
		return "The AI transcript could not be made. Try again, or upload subtitles or paste the transcript."
	case errors.Is(err, errAudioLongerThanBooked):
		return "The recording is longer than its header said, so the built-in engine stopped. Try another engine."
	case errors.Is(err, media.ErrUnreadable), errors.Is(err, media.ErrWindowTooLarge):
		return "The recording's audio could not be read."
	case errors.Is(err, youtube.ErrEmptyTranscript):
		return "No speech was heard in this recording."
	}
	return audioSentence(engine, err)
}
