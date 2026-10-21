package app

import (
	"github.com/D0bby999/anytools/internal/api/worksheetapi"
	"github.com/D0bby999/anytools/internal/capabilities/writingdiag"
	"github.com/D0bby999/anytools/internal/config"
	"github.com/D0bby999/anytools/internal/learning/worksheet"
	"github.com/D0bby999/anytools/internal/runtime"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// wire_worksheet.go assembles up's worksheet engine (the private design notes,
// phase 0). Kinds register themselves from their own files in
// internal/learning/worksheet; nothing here names one.

// buildWorksheets builds the worksheet handler. Review dates are the
// learner's local days, so the service reads their zone.
//
// Phase 7: recordings are per-row objects in the knowledge subsystem's
// ObjectStore, and the same store is the knowledge service's
// RecordingCleaner, so deleting a document or a knowledge base deletes the
// recording files of the worksheets attached to it before their rows go.
func buildWorksheets(pool *pg.Pool, kb knowledgeSubsystem) *worksheetapi.Handler {
	// The engine's example kind, every field type, so the form can be tried
	// on a development server. Never in production.
	if config.IsDevelopmentEnv() {
		worksheet.RegisterExample()
	}
	sheets := pg.NewWorksheetStore(pool).WithObjects(kb.objects)
	if kb.service != nil {
		kb.service.SetRecordingCleaner(sheets)
	}
	return worksheetapi.NewHandler(worksheet.NewService(sheets, pg.NewUserStore(pool), nil))
}

// buildWritingDiagnosis is phase 4's diagnosis of a writing evidence card's
// revision passes, on the learner's chat route. It reads the draft through
// the worksheet service (the only reader of answers) and writes only its own
// table.
func buildWritingDiagnosis(pool *pg.Pool, providers runtime.ChatProviderResolver) *writingdiag.Service {
	sheets := worksheet.NewService(pg.NewWorksheetStore(pool), pg.NewUserStore(pool), nil)
	return writingdiag.NewService(pg.NewWorksheetDiagnosisStore(pool), sheets, providers)
}
