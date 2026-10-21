package app

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/D0bby999/anytools/internal/api/classroomapi"
	"github.com/D0bby999/anytools/internal/api/photosapi"
	"github.com/D0bby999/anytools/internal/connectors/classroom"
	"github.com/D0bby999/anytools/internal/connectors/drive"
	"github.com/D0bby999/anytools/internal/connectors/gphotos"
	"github.com/D0bby999/anytools/internal/store/pg"
)

// buildClassroom is Google Classroom (learning-tool-connections phase 6), on
// the Google grant Drive holds. Nil without Drive.
func buildClassroom(pool *pg.Pool, google *drive.Service, kb knowledgeSubsystem) (*classroomapi.Handler, *classroom.Service) {
	if google == nil {
		return nil, nil
	}
	svc := classroom.NewService(google, pg.NewClassroomStore(pool), kbBridge{kb: kb})
	return classroomapi.NewHandler(svc), svc
}

// classroomCheckInterval: a class's new materials are counted once a day.
const classroomCheckInterval = 24 * time.Hour

// startClassroomCheck counts what is new in every linked class, daily. It
// imports nothing: the learner chooses.
func startClassroomCheck(ctx context.Context, wg *sync.WaitGroup, svc *classroom.Service) {
	wg.Add(1)
	go func() {
		defer wg.Done()
		ticker := time.NewTicker(classroomCheckInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				passCtx, cancel := context.WithTimeout(ctx, time.Hour)
				classes, failed := svc.Check(passCtx)
				cancel()
				if classes > 0 {
					slog.Info("classroom: daily check", "classes", classes, "failed", failed)
				}
			}
		}
	}()
}

// buildPhotos is Google Photos' picker (learning-tool-connections phase 7).
func buildPhotos(google *drive.Service, kb knowledgeSubsystem) *photosapi.Handler {
	if google == nil {
		return nil
	}
	return photosapi.NewHandler(gphotos.NewService(google), kbBridge{kb: kb})
}
